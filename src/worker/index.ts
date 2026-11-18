// Pop Quiz API Worker. Static assets (the PWA) are served by Workers Static Assets;
// only /api/* reaches this code (see wrangler.jsonc run_worker_first).

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { CreateQuizRequest, JoinRequest, JoinResponse, ApiErrorCode, QuizInfo } from '../shared/api.ts';
import { CODE_RE, JOIN_WINDOW_MS, nameKey, normalizeName } from '../shared/api.ts';
import type { Pool, PoolId } from '../shared/pool.ts';
import { buildQuiz } from '../shared/quiz.ts';
import { cryptoRng, newCode, newId, sha256Hex } from './crypto.ts';
import tech from '../../public/pools/tech.json';
import general from '../../public/pools/general.json';
import extra from '../../public/pools/extra.json';

export interface Env {
  DB: D1Database;
}

const POOLS: Record<PoolId, Pool> = {
  tech: tech as unknown as Pool,
  general: general as unknown as Pool,
  extra: extra as unknown as Pool,
};

type Ctx = Context<{ Bindings: Env }>;

class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 500,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const app = new Hono<{ Bindings: Env }>().basePath('/api');

app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});
app.use('*', bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: 'Request too large', code: 'bad_request' }, 400) }));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message, code: err.code }, err.status);
  console.error(err);
  return c.json({ error: 'Something went wrong', code: 'server_error' }, 500);
});
app.notFound((c) => c.json({ error: 'Not found', code: 'not_found' }, 404));

// ---------- helpers ----------

async function readJson<T>(c: Ctx): Promise<Partial<T>> {
  try {
    const body = await c.req.json();
    if (body && typeof body === 'object') return body as Partial<T>;
  } catch {
    /* fall through */
  }
  throw new ApiError(400, 'bad_request', 'Expected a JSON body');
}

function requireName(raw: unknown): string {
  const name = normalizeName(raw);
  if (!name) throw new ApiError(400, 'invalid_name', 'Enter a call sign or nickname (1–20 characters)');
  return name;
}

function requireCode(raw: string): string {
  const code = raw.toUpperCase();
  if (!CODE_RE.test(code)) throw new ApiError(404, 'not_found', 'No quiz with that code');
  return code;
}

interface QuizRow {
  code: string;
  pool: PoolId;
  pool_version: string;
  mode: 'full' | 'custom';
  items_json: string;
  created_at: number;
  closes_at: number;
  closed_at: number | null;
  creator_pid: string | null;
}

interface ParticipantRow {
  pid: string;
  display_name: string;
  joined_at: number;
  finished_at: number | null;
}

export function isClosed(q: Pick<QuizRow, 'closes_at' | 'closed_at'>, now: number): boolean {
  return q.closed_at !== null || now >= q.closes_at;
}

async function getQuizRow(db: D1Database, code: string): Promise<QuizRow> {
  const row = await db.prepare('SELECT * FROM quizzes WHERE code = ?').bind(code).first<QuizRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No quiz with that code');
  return row;
}

async function quizInfo(db: D1Database, q: QuizRow, now = Date.now()): Promise<QuizInfo> {
  const { results } = await db
    .prepare('SELECT pid, display_name, joined_at, finished_at FROM participants WHERE code = ? ORDER BY joined_at')
    .bind(q.code)
    .all<ParticipantRow>();
  return {
    code: q.code,
    pool: q.pool,
    poolVersion: q.pool_version,
    mode: q.mode,
    items: JSON.parse(q.items_json) as string[],
    createdAt: q.created_at,
    closesAt: q.closes_at,
    closedAt: q.closed_at,
    closed: isClosed(q, now),
    creatorPid: q.creator_pid,
    participants: results.map((p) => ({
      pid: p.pid,
      name: p.display_name,
      joinedAt: p.joined_at,
      finished: p.finished_at !== null,
    })),
  };
}

/** Resolves the bearer token to a participant of this quiz. */
async function requireParticipant(c: Ctx, code: string): Promise<{ pid: string }> {
  const token = c.req.header('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new ApiError(401, 'unauthorized', 'Missing participant token');
  const row = await c.env.DB.prepare('SELECT pid FROM participants WHERE code = ? AND token_hash = ?')
    .bind(code, await sha256Hex(token))
    .first<{ pid: string }>();
  if (!row) throw new ApiError(401, 'unauthorized', 'Unknown participant token');
  return row;
}

/** Inserts a participant; maps the UNIQUE(code, name_key) violation to a friendly 409. */
function participantInsert(db: D1Database, code: string, pid: string, tokenHash: string, name: string, now: number) {
  return db
    .prepare(
      'INSERT INTO participants (pid, code, token_hash, display_name, name_key, joined_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(pid, code, tokenHash, name, nameKey(name), now);
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

// ---------- routes ----------

app.get('/health', (c) => c.json({ ok: true }));

/** Create a quiz; the creator joins it in the same request. */
app.post('/quizzes', async (c) => {
  const body = await readJson<CreateQuizRequest>(c);
  const name = requireName(body.name);
  const pool = POOLS[body.pool as PoolId];
  if (!pool) throw new ApiError(400, 'bad_request', 'Unknown exam');

  let spec;
  try {
    spec =
      body.mode === 'full'
        ? buildQuiz(pool, { mode: 'full' }, cryptoRng)
        : body.mode === 'custom'
          ? buildQuiz(
              pool,
              {
                mode: 'custom',
                count: Number(body.count),
                subelements: Array.isArray(body.subelements) ? body.subelements.map(String) : [],
              },
              cryptoRng,
            )
          : null;
  } catch (e) {
    throw new ApiError(400, 'bad_request', (e as Error).message);
  }
  if (!spec) throw new ApiError(400, 'bad_request', 'Mode must be "full" or "custom"');

  const now = Date.now();
  const pid = newId();
  const token = newId(32);
  const tokenHash = await sha256Hex(token);

  // Retry on the (very unlikely) code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          'INSERT INTO quizzes (code, pool, pool_version, mode, items_json, created_at, closes_at, creator_pid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(code, pool.id, pool.version, spec.mode, JSON.stringify(spec.items), now, now + JOIN_WINDOW_MS, pid),
        participantInsert(c.env.DB, code, pid, tokenHash, name, now),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
    const quiz = await quizInfo(c.env.DB, await getQuizRow(c.env.DB, code), now);
    return c.json({ pid, token, name, quiz } satisfies JoinResponse, 201);
  }
  throw new ApiError(500, 'server_error', 'Could not allocate a quiz code');
});

app.get('/quizzes/:code', async (c) => {
  const code = requireCode(c.req.param('code'));
  return c.json(await quizInfo(c.env.DB, await getQuizRow(c.env.DB, code)));
});

app.post('/quizzes/:code/participants', async (c) => {
  const code = requireCode(c.req.param('code'));
  const body = await readJson<JoinRequest>(c);
  const name = requireName(body.name);
  const now = Date.now();
  const row = await getQuizRow(c.env.DB, code);
  if (isClosed(row, now)) throw new ApiError(410, 'closed', 'This quiz is closed to new people');

  const pid = newId();
  const token = newId(32);
  try {
    await participantInsert(c.env.DB, code, pid, await sha256Hex(token), name, now).run();
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, 'name_taken', `Someone in this quiz is already called “${name}”`);
    throw e;
  }
  const quiz = await quizInfo(c.env.DB, row, now);
  return c.json({ pid, token, name, quiz } satisfies JoinResponse, 201);
});

/** Creator closes the quiz early: no new joins; anyone still working is auto-submitted. */
app.post('/quizzes/:code/close', async (c) => {
  const code = requireCode(c.req.param('code'));
  const { pid } = await requireParticipant(c, code);
  const row = await getQuizRow(c.env.DB, code);
  if (row.creator_pid !== pid) throw new ApiError(403, 'forbidden', 'Only the person who started this quiz can close it');
  const now = Date.now();
  if (row.closed_at === null) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE quizzes SET closed_at = ? WHERE code = ? AND closed_at IS NULL').bind(now, code),
      c.env.DB.prepare('UPDATE participants SET finished_at = ? WHERE code = ? AND finished_at IS NULL').bind(now, code),
    ]);
  }
  return c.json(await quizInfo(c.env.DB, await getQuizRow(c.env.DB, code), now));
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
