// API tests against a real local D1 (workerd via wrangler's getPlatformProxy, in-memory, never remote).

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { app, dailyCleanup, isClosed, type Env } from '../src/worker/index.ts';
import { CODE_RE, normalizeName, nameKey, type JoinResponse, type QuizInfo, type ResultsResponse } from '../src/shared/api.ts';
import { newCode } from '../src/worker/crypto.ts';

let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let env: Env;

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
  // No bot check or rate limits for the functional tests (they have their own tests below).
  env = { DB: proxy.env.DB };
  const sql = readFileSync(join(import.meta.dirname, '../migrations/0001_init.sql'), 'utf8')
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  await env.DB.batch(sql.map((s) => env.DB.prepare(s)));
}, 30_000);

afterAll(async () => {
  await proxy?.dispose();
});

async function call(method: string, path: string, body?: unknown, token?: string, useEnv: Env = env, ip?: string) {
  const headers: Record<string, string> = {};
  if (ip) headers['CF-Connecting-IP'] = ip;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, useEnv);
  return { status: res.status, body: (await res.json()) as any };
}

const create = (extra: Record<string, unknown> = {}) =>
  call('POST', '/quizzes', { pool: 'tech', mode: 'full', name: 'N3PAY', ...extra });

describe('create quiz', () => {
  it('builds a full exam and makes the creator the first participant', async () => {
    const { status, body } = await create();
    expect(status).toBe(201);
    const r = body as JoinResponse;
    expect(r.quiz.code).toMatch(CODE_RE);
    expect(r.quiz.items).toHaveLength(35);
    expect(r.quiz.creatorPid).toBe(r.pid);
    expect(r.quiz.participants).toEqual([expect.objectContaining({ pid: r.pid, name: 'N3PAY', finished: false })]);
    expect(r.quiz.closed).toBe(false);
    expect(r.quiz.closesAt - r.quiz.createdAt).toBe(7 * 24 * 3600 * 1000);
    expect(r.token.length).toBeGreaterThan(30);
  });

  it('builds a custom quiz from chosen subelements', async () => {
    const { status, body } = await create({ mode: 'custom', count: 12, subelements: ['T5'] });
    expect(status).toBe(201);
    expect(body.quiz.items).toHaveLength(12);
    for (const id of body.quiz.items) expect(id.startsWith('T5')).toBe(true);
  });

  it('rejects bad input', async () => {
    expect((await create({ pool: 'novice' })).body.code).toBe('bad_request');
    expect((await create({ mode: 'custom', count: 3, subelements: ['T5'] })).body.error).toMatch(/between 5 and/);
    expect((await create({ name: '   ' })).body.code).toBe('invalid_name');
    expect((await create({ name: 'x'.repeat(21) })).status).toBe(400);
    expect((await call('POST', '/quizzes', 'nope')).status).toBe(400);
  });

  it('never exposes token hashes', async () => {
    const { body } = await create();
    const info = await call('GET', `/quizzes/${body.quiz.code}`);
    expect(JSON.stringify(info.body)).not.toMatch(/token/i);
  });
});

describe('join quiz', () => {
  it('lets others join, with the same questions, and lists them', async () => {
    const { body: created } = await create();
    const code = created.quiz.code.toLowerCase(); // codes are case-insensitive
    const { status, body } = await call('POST', `/quizzes/${code}/participants`, { name: 'Bob' });
    expect(status).toBe(201);
    expect(body.quiz.items).toEqual(created.quiz.items);
    expect(body.quiz.participants.map((p: { name: string }) => p.name)).toEqual(['N3PAY', 'Bob']);
  });

  it('rejects duplicate names case-insensitively', async () => {
    const { body: created } = await create({ name: 'Alice' });
    const r = await call('POST', `/quizzes/${created.quiz.code}/participants`, { name: '  ALICE ' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('name_taken');
  });

  it('404s unknown and malformed codes', async () => {
    expect((await call('GET', '/quizzes/ZZZZZZ')).status).toBe(404);
    expect((await call('GET', '/quizzes/O0O0O0')).status).toBe(404);
    expect((await call('POST', '/quizzes/abc/participants', { name: 'x' })).status).toBe(404);
  });
});

describe('close quiz', () => {
  it('only the creator can close; closing blocks joins and finishes everyone', async () => {
    const { body: c } = await create();
    const code = c.quiz.code;
    const { body: bob } = await call('POST', `/quizzes/${code}/participants`, { name: 'Bob' });

    expect((await call('POST', `/quizzes/${code}/close`)).status).toBe(401);
    expect((await call('POST', `/quizzes/${code}/close`, undefined, 'bogus')).status).toBe(401);
    expect((await call('POST', `/quizzes/${code}/close`, undefined, bob.token)).status).toBe(403);

    const closed = await call('POST', `/quizzes/${code}/close`, undefined, c.token);
    expect(closed.status).toBe(200);
    const info = closed.body as QuizInfo;
    expect(info.closed).toBe(true);
    expect(info.participants.every((p) => p.finished)).toBe(true);

    const late = await call('POST', `/quizzes/${code}/participants`, { name: 'Carol' });
    expect(late.status).toBe(410);
    expect(late.body.code).toBe('closed');

    // A token for one quiz is not valid for another.
    const { body: other } = await create();
    expect((await call('POST', `/quizzes/${other.quiz.code}/close`, undefined, c.token)).status).toBe(401);
  });

  it('treats quizzes past their join window as closed', () => {
    expect(isClosed({ closes_at: 1000, closed_at: null }, 999)).toBe(false);
    expect(isClosed({ closes_at: 1000, closed_at: null }, 1000)).toBe(true);
    expect(isClosed({ closes_at: 1000, closed_at: 5 }, 0)).toBe(true);
  });
});

describe('names and codes', () => {
  it('normalises names', () => {
    expect(normalizeName('  Mary   Ann ')).toBe('Mary Ann');
    expect(normalizeName('')).toBeNull();
    expect(normalizeName('a​b')).toBeNull(); // zero-width space
    expect(normalizeName(42)).toBeNull();
    expect(normalizeName('📻'.repeat(20))).toBe('📻'.repeat(20)); // counts characters, not UTF-16 units
    expect(nameKey('ＫＣ１ＡＢＣ')).toBe(nameKey('kc1abc'));
  });

  it('generates readable codes', () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(CODE_RE);
  });
});

describe('answers and submit', () => {
  const pool = JSON.parse(readFileSync(join(import.meta.dirname, '../public/pools/tech.json'), 'utf8')) as {
    questions: { id: string; c: number }[];
  };
  const keyFor = (items: string[]) => items.map((id) => pool.questions.find((q) => q.id === id)!.c);

  it('saves answers, reports progress, and scores on submit', async () => {
    const { body: c } = await create();
    const code = c.quiz.code;
    const key = keyFor(c.quiz.items);

    // Sync three answers (two right, one wrong), then change one.
    const r1 = await call('PUT', `/quizzes/${code}/answers`, { answers: [{ i: 0, choice: key[0] }, { i: 1, choice: key[1] }, { i: 2, choice: (key[2]! + 1) % 4 }] }, c.token);
    expect(r1).toMatchObject({ status: 200, body: { saved: 3 } });
    await call('PUT', `/quizzes/${code}/answers`, { answers: [{ i: 2, choice: key[2] }] }, c.token);

    const info = await call('GET', `/quizzes/${code}`);
    expect(info.body.participants[0]).toMatchObject({ answered: 3, finished: false });

    // Final submit with the full list: 30 correct, 5 blank.
    const final = key.map((k, i) => (i < 30 ? k : null));
    const sub = await call('POST', `/quizzes/${code}/submit`, { answers: final }, c.token);
    expect(sub.body).toMatchObject({ score: 30, total: 35, alreadyFinished: false });

    // Submitting again changes nothing; further answers are rejected.
    const again = await call('POST', `/quizzes/${code}/submit`, { answers: key }, c.token);
    expect(again.body).toMatchObject({ score: 30, alreadyFinished: true });
    const late = await call('PUT', `/quizzes/${code}/answers`, { answers: [{ i: 34, choice: key[34] }] }, c.token);
    expect(late).toMatchObject({ status: 409, body: { code: 'finished' } });
  });

  it('validates answers', async () => {
    const { body: c } = await create();
    const code = c.quiz.code;
    const bad = (answers: unknown) => call('PUT', `/quizzes/${code}/answers`, { answers }, c.token);
    expect((await bad([{ i: 35, choice: 0 }])).status).toBe(400);
    expect((await bad([{ i: 0, choice: 4 }])).status).toBe(400);
    expect((await bad([{ i: -1, choice: 0 }])).status).toBe(400);
    expect((await bad([])).status).toBe(400);
    expect((await call('PUT', `/quizzes/${code}/answers`, { answers: [{ i: 0, choice: 0 }] })).status).toBe(401);
    expect((await call('POST', `/quizzes/${code}/submit`, { answers: [0] }, c.token)).status).toBe(400);
  });

  it('closing scores everyone from the answers that reached the server', async () => {
    const { body: c } = await create();
    const code = c.quiz.code;
    const key = keyFor(c.quiz.items);
    const { body: bob } = await call('POST', `/quizzes/${code}/participants`, { name: 'Bob' });
    await call('PUT', `/quizzes/${code}/answers`, { answers: [0, 1, 2, 3].map((i) => ({ i, choice: key[i] })) }, bob.token);

    await call('POST', `/quizzes/${code}/close`, undefined, c.token);

    // Bob's late answers are refused; his submit returns the score from what was synced (4).
    expect((await call('PUT', `/quizzes/${code}/answers`, { answers: [{ i: 5, choice: key[5] }] }, bob.token)).status).toBe(409);
    const sub = await call('POST', `/quizzes/${code}/submit`, { answers: key }, bob.token);
    expect(sub.body).toMatchObject({ score: 4, alreadyFinished: true });
    const mine = await call('POST', `/quizzes/${code}/submit`, { answers: key }, c.token);
    expect(mine.body).toMatchObject({ score: 0, alreadyFinished: true });
  });

  it("can't write to another participant's answers", async () => {
    const { body: a } = await create();
    const { body: b } = await create();
    const r = await call('PUT', `/quizzes/${a.quiz.code}/answers`, { answers: [{ i: 0, choice: 0 }] }, b.token);
    expect(r.status).toBe(401);
  });
});

describe('results', () => {
  const pool = JSON.parse(readFileSync(join(import.meta.dirname, '../public/pools/tech.json'), 'utf8')) as {
    questions: { id: string; c: number }[];
  };
  const keyFor = (items: string[]) => items.map((id) => pool.questions.find((q) => q.id === id)!.c);

  it('ranks by score then time, lists people still working, and gates the breakdown', async () => {
    const { body: c } = await create({ name: 'Ann' });
    const code = c.quiz.code;
    const key = keyFor(c.quiz.items);
    const join = async (name: string) => (await call('POST', `/quizzes/${code}/participants`, { name })).body as JoinResponse;
    const bob = await join('Bob');
    const cat = await join('Cat');
    const dan = await join('Dan');

    // Ann: all correct. Bob: 20 correct. Cat: 30 correct (Q1 answered B wrongly). Dan: still working, 3 answered.
    const wrong = (k: number) => (k + 1) % 4;
    await call('POST', `/quizzes/${code}/submit`, { answers: key }, c.token);
    await call('POST', `/quizzes/${code}/submit`, { answers: key.map((k, i) => (i < 20 ? k : null)) }, bob.token);
    await call('POST', `/quizzes/${code}/submit`, { answers: key.map((k, i) => (i === 0 ? wrong(k) : i < 31 ? k : null)) }, cat.token);
    await call('PUT', `/quizzes/${code}/answers`, { answers: [0, 1, 2].map((i) => ({ i, choice: wrong(key[i]!) })) }, dan.token);

    const anon = await call('GET', `/quizzes/${code}/results`);
    const r = anon.body as ResultsResponse;
    expect(r.leaderboard.map((x) => [x.name, x.score, x.passed])).toEqual([
      ['Ann', 35, true],
      ['Cat', 30, true],
      ['Bob', 20, false],
      ['Dan', null, null],
    ]);
    expect(r.leaderboard[3]).toMatchObject({ finished: false, answered: 3, timeMs: null });
    expect(r.finishedCount).toBe(3);
    expect(r.passing).toBe(26);
    expect(r.breakdown).toBeNull(); // no token → no breakdown

    // No peeking: Dan hasn't submitted.
    expect((await call('GET', `/quizzes/${code}/results`, undefined, dan.token)).body.breakdown).toBeNull();

    // Ann has submitted: totals over finished people only (Dan's in-progress picks excluded).
    const mine = (await call('GET', `/quizzes/${code}/results`, undefined, c.token)).body as ResultsResponse;
    const q0 = mine.breakdown![0]!;
    expect(q0.correct).toBe(key[0]);
    expect(q0.counts[key[0]!]).toBe(2); // Ann, Bob
    expect(q0.counts[wrong(key[0]!)]).toBe(1); // Cat
    expect(q0.blank).toBe(0);
    const q34 = mine.breakdown![34]!;
    expect(q34.counts.reduce((a, b) => a + b, 0)).toBe(1); // only Ann answered the last one
    expect(q34.blank).toBe(2);
    expect(JSON.stringify(mine)).not.toMatch(/token/i);
  });

  it('404s unknown quizzes', async () => {
    expect((await call('GET', '/quizzes/ZZZZZZ/results')).status).toBe(404);
  });
});

describe('bot check (Turnstile)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const withSecret = () => ({ DB: env.DB, TURNSTILE_SECRET: 'secret' }) as Env;

  it('requires a token and verifies it with Cloudflare', async () => {
    const verify = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      const ok = form.get('response') === 'good' && form.get('secret') === 'secret';
      return new Response(JSON.stringify({ success: ok }));
    });
    vi.stubGlobal('fetch', verify);
    const req = { pool: 'tech', mode: 'full', name: 'N3PAY' };
    expect((await call('POST', '/quizzes', req, undefined, withSecret())).body.code).toBe('bot_check');
    expect((await call('POST', '/quizzes', { ...req, turnstileToken: 'bad' }, undefined, withSecret())).status).toBe(403);
    const ok = await call('POST', '/quizzes', { ...req, turnstileToken: 'good' }, undefined, withSecret(), '203.0.113.9');
    expect(ok.status).toBe(201);
    expect(String(verify.mock.calls.at(-1)![0])).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect((verify.mock.calls.at(-1)![1]?.body as FormData).get('remoteip')).toBe('203.0.113.9');
  });

  it('is not needed to join', async () => {
    const { body: c } = await create();
    expect((await call('POST', `/quizzes/${c.quiz.code}/participants`, { name: 'Bob' }, undefined, withSecret())).status).toBe(201);
  });
});

describe('rate limits', () => {
  /** A limiter that allows `n` calls per key. */
  const limiter = (n: number) => {
    const seen = new Map<string, number>();
    return {
      keys: seen,
      limit: async ({ key }: { key: string }) => {
        seen.set(key, (seen.get(key) ?? 0) + 1);
        return { success: seen.get(key)! <= n };
      },
    } as unknown as RateLimit & { keys: Map<string, number> };
  };

  it('limits quiz creation per IP', async () => {
    const RL_CREATE = limiter(2);
    const e = { DB: env.DB, RL_CREATE } as Env;
    const req = { pool: 'tech', mode: 'full', name: 'N3PAY' };
    expect((await call('POST', '/quizzes', req, undefined, e, '198.51.100.1')).status).toBe(201);
    expect((await call('POST', '/quizzes', req, undefined, e, '198.51.100.1')).status).toBe(201);
    const third = await call('POST', '/quizzes', req, undefined, e, '198.51.100.1');
    expect(third).toMatchObject({ status: 429, body: { code: 'rate_limited' } });
    expect((await call('POST', '/quizzes', req, undefined, e, '198.51.100.2')).status).toBe(201); // other IP
  });

  it('limits answer writes per participant and reads per IP', async () => {
    const { body: c } = await create();
    const RL_WRITE = limiter(1);
    const RL_READ = limiter(1);
    const e = { DB: env.DB, RL_WRITE, RL_READ } as Env;
    const put = () => call('PUT', `/quizzes/${c.quiz.code}/answers`, { answers: [{ i: 0, choice: 1 }] }, c.token, e);
    expect((await put()).status).toBe(200);
    expect((await put()).status).toBe(429);
    expect([...RL_WRITE.keys.keys()]).toEqual([`pid:${c.pid}`]);
    expect((await call('GET', `/quizzes/${c.quiz.code}/results`, undefined, undefined, e, '192.0.2.5')).status).toBe(200);
    expect((await call('GET', `/quizzes/${c.quiz.code}`, undefined, undefined, e, '192.0.2.5')).status).toBe(429);
  });
});

describe('expiry and daily cleanup', () => {
  it('finalises a quiz whose 7 days ran out, scoring people still working', async () => {
    const { body: c } = await create();
    const code = c.quiz.code;
    const { body: bob } = await call('POST', `/quizzes/${code}/participants`, { name: 'Bob' });
    await call('PUT', `/quizzes/${code}/answers`, { answers: [{ i: 0, choice: 0 }] }, bob.token);
    // Pretend it was created 8 days ago.
    const past = Date.now() - 8 * 24 * 3600 * 1000;
    await env.DB.prepare('UPDATE quizzes SET created_at = ?, closes_at = ? WHERE code = ?').bind(past, past + 7 * 24 * 3600 * 1000, code).run();

    const r = (await call('GET', `/quizzes/${code}/results`)).body as ResultsResponse;
    expect(r.closed).toBe(true);
    expect(r.leaderboard.every((x) => x.finished)).toBe(true);
    const row = await env.DB.prepare('SELECT closed_at, closes_at FROM quizzes WHERE code = ?').bind(code).first<{ closed_at: number; closes_at: number }>();
    expect(row!.closed_at).toBe(row!.closes_at);
  });

  it('deletes quizzes older than 30 days with their people and answers', async () => {
    const { body: old } = await create();
    const { body: fresh } = await create();
    await call('PUT', `/quizzes/${old.quiz.code}/answers`, { answers: [{ i: 0, choice: 0 }] }, old.token);
    const longAgo = Date.now() - 31 * 24 * 3600 * 1000;
    await env.DB.prepare('UPDATE quizzes SET created_at = ?, closes_at = ? WHERE code = ?').bind(longAgo, longAgo + 7 * 24 * 3600 * 1000, old.quiz.code).run();

    const r = await dailyCleanup(env);
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    expect((await call('GET', `/quizzes/${old.quiz.code}`)).status).toBe(404);
    expect((await call('GET', `/quizzes/${fresh.quiz.code}`)).status).toBe(200);
    const orphans = await env.DB.prepare('SELECT COUNT(*) AS n FROM participants WHERE pid = ?').bind(old.pid).first<{ n: number }>();
    expect(orphans!.n).toBe(0);
    const orphanAnswers = await env.DB.prepare('SELECT COUNT(*) AS n FROM answers WHERE pid = ?').bind(old.pid).first<{ n: number }>();
    expect(orphanAnswers!.n).toBe(0);
  });
});
