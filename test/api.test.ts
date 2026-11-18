// API tests against a real local D1 (workerd via wrangler's getPlatformProxy, in-memory, never remote).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { app, isClosed, type Env } from '../src/worker/index.ts';
import { CODE_RE, normalizeName, nameKey, type JoinResponse, type QuizInfo } from '../src/shared/api.ts';
import { newCode } from '../src/worker/crypto.ts';

let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let env: Env;

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
  env = proxy.env;
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

async function call(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
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
