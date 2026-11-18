// Pop Quiz API Worker. Static assets (the PWA) are served by Workers Static Assets;
// only /api/* reaches this code (see wrangler.jsonc run_worker_first).

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type {
  AnswersRequest,
  AnswersResponse,
  ApiErrorCode,
  CreateQuizRequest,
  JoinRequest,
  JoinResponse,
  LeaderRow,
  QuestionStat,
  QuizInfo,
  ResultsResponse,
  SubmitRequest,
  SubmitResponse,
} from '../shared/api.ts';
import { CODE_RE, JOIN_WINDOW_MS, RETENTION_MS, nameKey, normalizeName } from '../shared/api.ts';
import type { Pool, PoolId } from '../shared/pool.ts';
import { buildQuiz, scoreQuiz, type Answer, type QuizSpec } from '../shared/quiz.ts';
import { cryptoRng, newCode, newId, sha256Hex } from './crypto.ts';
import tech from '../../public/pools/tech.json';
import general from '../../public/pools/general.json';
import extra from '../../public/pools/extra.json';

export interface Env {
  DB: D1Database;
  /** Turnstile secret (wrangler secret). When unset, bot checks are skipped — local tests only. */
  TURNSTILE_SECRET?: string;
  RL_CREATE?: RateLimit;
  RL_JOIN?: RateLimit;
  RL_WRITE?: RateLimit;
  RL_READ?: RateLimit;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const POOLS: Record<PoolId, Pool> = {
  tech: tech as unknown as Pool,
  general: general as unknown as Pool,
  extra: extra as unknown as Pool,
};

type Ctx = Context<{ Bindings: Env }>;

class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 500,
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

// ---------- rate limits & bot check ----------

const clientIp = (c: Ctx) => c.req.header('CF-Connecting-IP') ?? 'unknown';

async function rateLimit(limiter: RateLimit | undefined, key: string): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key });
  if (!success) throw new ApiError(429, 'rate_limited', 'Too many requests — wait a moment and try again');
}

// Reads (quiz info, results polling), per client IP.
app.use('/quizzes/*', async (c, next) => {
  if (c.req.method === 'GET') await rateLimit(c.env.RL_READ, `ip:${clientIp(c)}`);
  await next();
});

/** Verifies a Turnstile token with Cloudflare. Skipped only when no secret is configured (tests). */
async function verifyTurnstile(c: Ctx, token: unknown): Promise<void> {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) return;
  if (typeof token !== 'string' || !token) throw new ApiError(403, 'bot_check', 'Please complete the “I’m human” check');
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  const ip = c.req.header('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  let ok = false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    ok = ((await r.json()) as { success?: boolean }).success === true;
  } catch {
    throw new ApiError(500, 'server_error', 'Could not verify the “I’m human” check — try again');
  }
  if (!ok) throw new ApiError(403, 'bot_check', 'The “I’m human” check failed or expired — try again');
}

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
  answered: number;
}

export function isClosed(q: Pick<QuizRow, 'closes_at' | 'closed_at'>, now: number): boolean {
  return q.closed_at !== null || now >= q.closes_at;
}

async function getQuizRow(db: D1Database, code: string): Promise<QuizRow> {
  const row = await db.prepare('SELECT * FROM quizzes WHERE code = ?').bind(code).first<QuizRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No quiz with that code');
  return row;
}

/**
 * A quiz whose 7-day window ran out without being closed: record it as closed at `closes_at`
 * and score everyone still working from the answers the server has. Idempotent.
 */
async function finalizeExpired(db: D1Database, q: QuizRow, now: number): Promise<QuizRow> {
  if (q.closed_at !== null || now < q.closes_at) return q;
  await db.prepare('UPDATE quizzes SET closed_at = ? WHERE code = ? AND closed_at IS NULL').bind(q.closes_at, q.code).run();
  await finalizeUnfinished(db, q, q.closes_at);
  return { ...q, closed_at: q.closes_at };
}

async function quizInfo(db: D1Database, q: QuizRow, now = Date.now()): Promise<QuizInfo> {
  q = await finalizeExpired(db, q, now);
  const { results } = await db
    .prepare(
      `SELECT p.pid, p.display_name, p.joined_at, p.finished_at,
              (SELECT COUNT(*) FROM answers a WHERE a.pid = p.pid) AS answered
         FROM participants p WHERE p.code = ? ORDER BY p.joined_at`,
    )
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
      answered: p.answered,
    })),
  };
}

/** Resolves the bearer token to a participant of this quiz. */
async function requireParticipant(c: Ctx, code: string): Promise<{ pid: string; finished_at: number | null }> {
  const token = c.req.header('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new ApiError(401, 'unauthorized', 'Missing participant token');
  const row = await c.env.DB.prepare('SELECT pid, finished_at FROM participants WHERE code = ? AND token_hash = ?')
    .bind(code, await sha256Hex(token))
    .first<{ pid: string; finished_at: number | null }>();
  if (!row) throw new ApiError(401, 'unauthorized', 'Unknown participant token');
  await rateLimit(c.env.RL_WRITE, `pid:${row.pid}`);
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
  await rateLimit(c.env.RL_CREATE, `ip:${clientIp(c)}`);
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
  await verifyTurnstile(c, body.turnstileToken);

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
  await rateLimit(c.env.RL_JOIN, `ip:${clientIp(c)}`);
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
    await c.env.DB.prepare('UPDATE quizzes SET closed_at = ? WHERE code = ? AND closed_at IS NULL').bind(now, code).run();
    await finalizeUnfinished(c.env.DB, row, now);
  }
  return c.json(await quizInfo(c.env.DB, await getQuizRow(c.env.DB, code), now));
});

/** Save answers changed since the last sync. Rejected once the person has submitted or the quiz has closed. */
app.put('/quizzes/:code/answers', async (c) => {
  const code = requireCode(c.req.param('code'));
  const me = await requireParticipant(c, code);
  const body = await readJson<AnswersRequest>(c);
  const row = await getQuizRow(c.env.DB, code);
  const now = Date.now();
  if (me.finished_at !== null) throw new ApiError(409, 'finished', 'Your answers were already submitted');
  if (isClosed(row, now)) throw new ApiError(410, 'closed', 'This quiz is closed');

  const total = (JSON.parse(row.items_json) as string[]).length;
  const answers = Array.isArray(body.answers) ? body.answers : null;
  if (!answers || answers.length === 0 || answers.length > total) throw new ApiError(400, 'bad_request', 'Expected 1 or more answers');
  for (const a of answers) {
    if (!a || !Number.isInteger(a.i) || a.i < 0 || a.i >= total || !Number.isInteger(a.choice) || a.choice < 0 || a.choice > 3) {
      throw new ApiError(400, 'bad_request', 'Each answer needs a question index and a choice 0–3');
    }
  }
  await c.env.DB.batch(answers.map((a) => upsertAnswer(c.env.DB, me.pid, a.i, a.choice, now)));
  return c.json({ saved: answers.length } satisfies AnswersResponse);
});

/**
 * Final submit with the full answer list. Idempotent: if the person was already finalised
 * (submitted before, or the quiz closed), their recorded score is returned and nothing changes.
 * After the quiz has closed, only answers that reached the server before closing count.
 */
app.post('/quizzes/:code/submit', async (c) => {
  const code = requireCode(c.req.param('code'));
  const me = await requireParticipant(c, code);
  const body = await readJson<SubmitRequest>(c);
  const row = await getQuizRow(c.env.DB, code);
  const items = JSON.parse(row.items_json) as string[];
  const now = Date.now();

  if (me.finished_at === null && !isClosed(row, now)) {
    const answers = body.answers;
    if (!Array.isArray(answers) || answers.length !== items.length) {
      throw new ApiError(400, 'bad_request', `Expected ${items.length} answers (null for blanks)`);
    }
    const writes = [];
    for (let i = 0; i < answers.length; i++) {
      const a = answers[i];
      if (a === null) continue;
      if (!Number.isInteger(a) || (a as number) < 0 || (a as number) > 3) throw new ApiError(400, 'bad_request', 'Answers must be 0–3 or null');
      writes.push(upsertAnswer(c.env.DB, me.pid, i, a as number, now));
    }
    if (writes.length) await c.env.DB.batch(writes);
  }
  if (me.finished_at === null) await finalizeUnfinished(c.env.DB, row, now, me.pid);

  const p = await c.env.DB.prepare('SELECT finished_at, score FROM participants WHERE pid = ?')
    .bind(me.pid)
    .first<{ finished_at: number; score: number | null }>();
  return c.json({
    score: p?.score ?? 0,
    total: items.length,
    finishedAt: p?.finished_at ?? now,
    alreadyFinished: me.finished_at !== null,
  } satisfies SubmitResponse);
});

/**
 * Leaderboard for anyone with the link; per-question breakdown only for a participant who has
 * submitted (Bearer token). Individual answers are never exposed — only totals.
 */
app.get('/quizzes/:code/results', async (c) => {
  const code = requireCode(c.req.param('code'));
  const now = Date.now();
  const row = await finalizeExpired(c.env.DB, await getQuizRow(c.env.DB, code), now);
  const pool = POOLS[row.pool];
  const items = JSON.parse(row.items_json) as string[];

  const { results: people } = await c.env.DB.prepare(
    `SELECT p.pid, p.display_name, p.joined_at, p.finished_at, p.score,
            (SELECT COUNT(*) FROM answers a WHERE a.pid = p.pid) AS answered
       FROM participants p WHERE p.code = ?`,
  )
    .bind(code)
    .all<ParticipantRow & { score: number | null }>();

  const leaderboard: LeaderRow[] = people.map((p) => {
    const finished = p.finished_at !== null;
    const score = finished ? (p.score ?? 0) : null;
    return {
      pid: p.pid,
      name: p.display_name,
      finished,
      answered: p.answered,
      score,
      timeMs: finished ? p.finished_at! - p.joined_at : null,
      passed: finished && row.mode === 'full' ? score! >= pool.passing : null,
    };
  });
  leaderboard.sort((a, b) =>
    a.finished !== b.finished
      ? a.finished
        ? -1
        : 1
      : a.finished
        ? b.score! - a.score! || a.timeMs! - b.timeMs!
        : b.answered - a.answered || a.name.localeCompare(b.name),
  );

  // Optional viewer identity: breakdown only once they've submitted.
  let breakdown: QuestionStat[] | null = null;
  const token = c.req.header('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (token) {
    const viewer = await c.env.DB.prepare('SELECT finished_at FROM participants WHERE code = ? AND token_hash = ?')
      .bind(code, await sha256Hex(token))
      .first<{ finished_at: number | null }>();
    if (viewer && viewer.finished_at !== null) {
      const { results: picks } = await c.env.DB.prepare(
        `SELECT a.q_index, a.choice, COUNT(*) AS n FROM answers a JOIN participants p ON p.pid = a.pid
          WHERE p.code = ? AND p.finished_at IS NOT NULL GROUP BY a.q_index, a.choice`,
      )
        .bind(code)
        .all<{ q_index: number; choice: number; n: number }>();
      const finishedCount = leaderboard.filter((r) => r.finished).length;
      const byId = new Map(pool.questions.map((q) => [q.id, q]));
      breakdown = items.map((id, i) => ({ i, id, counts: [0, 0, 0, 0], blank: finishedCount, correct: byId.get(id)?.c ?? -1 }));
      for (const p of picks) {
        const stat = breakdown[p.q_index];
        if (!stat || p.choice < 0 || p.choice > 3) continue;
        stat.counts[p.choice as 0 | 1 | 2 | 3] += p.n;
        stat.blank -= p.n;
      }
    }
  }

  return c.json({
    code,
    mode: row.mode,
    total: items.length,
    passing: row.mode === 'full' ? pool.passing : null,
    closed: isClosed(row, now),
    leaderboard,
    breakdown,
    finishedCount: leaderboard.filter((r) => r.finished).length,
  } satisfies ResultsResponse);
});

function upsertAnswer(db: D1Database, pid: string, i: number, choice: number, now: number) {
  return db
    .prepare(
      `INSERT INTO answers (pid, q_index, choice, answered_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (pid, q_index) DO UPDATE SET choice = excluded.choice, answered_at = excluded.answered_at`,
    )
    .bind(pid, i, choice, now);
}

/** Scores and marks finished every unfinished participant (or just `onlyPid`) from the answers the server has. */
async function finalizeUnfinished(db: D1Database, row: QuizRow, now: number, onlyPid?: string): Promise<void> {
  const pool = POOLS[row.pool];
  const spec: QuizSpec = { pool: row.pool, poolVersion: row.pool_version, mode: row.mode, items: JSON.parse(row.items_json) };
  const people = onlyPid
    ? [{ pid: onlyPid }]
    : (await db.prepare('SELECT pid FROM participants WHERE code = ? AND finished_at IS NULL').bind(row.code).all<{ pid: string }>())
        .results;
  if (people.length === 0) return;

  const { results } = await db
    .prepare(
      `SELECT a.pid, a.q_index, a.choice FROM answers a JOIN participants p ON p.pid = a.pid
        WHERE p.code = ? AND p.finished_at IS NULL`,
    )
    .bind(row.code)
    .all<{ pid: string; q_index: number; choice: number }>();
  const byPid = new Map<string, Answer[]>();
  for (const r of results) {
    const list = byPid.get(r.pid) ?? spec.items.map(() => null);
    list[r.q_index] = r.choice;
    byPid.set(r.pid, list);
  }
  await db.batch(
    people.map(({ pid }) =>
      db
        .prepare('UPDATE participants SET finished_at = ?, score = ? WHERE pid = ? AND finished_at IS NULL')
        .bind(now, scoreQuiz(pool, spec, byPid.get(pid) ?? []).correct, pid),
    ),
  );
}

/** Daily cron: delete quizzes older than 30 days; finalise quizzes whose join window ended. */
export async function dailyCleanup(env: Env, now = Date.now()): Promise<{ deleted: number; finalized: number }> {
  const del = await env.DB.prepare('DELETE FROM quizzes WHERE created_at < ?').bind(now - RETENTION_MS).run();
  const { results: expired } = await env.DB.prepare(
    `SELECT * FROM quizzes WHERE closed_at IS NULL AND closes_at <= ? LIMIT 500`,
  )
    .bind(now)
    .all<QuizRow>();
  for (const q of expired) await finalizeExpired(env.DB, q, now);
  return { deleted: del.meta.changes ?? 0, finalized: expired.length };
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      dailyCleanup(env).then((r) => console.log(`cleanup: deleted ${r.deleted} rows, finalized ${r.finalized} expired quizzes`)),
    );
  },
} satisfies ExportedHandler<Env>;
