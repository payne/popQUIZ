import { afterEach, describe, expect, it, vi } from 'vitest';
import { needsSync, pendingIndices, syncOnce, unsentCount } from '../src/app/sync.ts';
import type { LocalSession } from '../src/app/session.ts';

const base = (over: Partial<LocalSession> = {}): LocalSession => ({
  code: 'ABCDEF',
  pid: 'p',
  token: 't',
  name: 'Sam',
  creator: false,
  spec: { pool: 'tech', poolVersion: '2026-2030', mode: 'custom', items: ['A', 'B', 'C', 'D', 'E'] },
  answers: [0, 1, null, 3, null],
  synced: [0, null, null, 2, null],
  flags: [false, false, false, false, false],
  current: 0,
  startedAt: 0,
  ...over,
});

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('pending answers', () => {
  it('finds answers the server does not have (new or changed)', () => {
    expect(pendingIndices(base())).toEqual([1, 3]);
    expect(unsentCount(base())).toBe(2);
    expect(needsSync(base({ synced: [0, 1, null, 3, null] }))).toBe(false);
  });

  it('counts an unsent submit', () => {
    const s = base({ synced: [0, 1, null, 3, null], submittedAt: 1 });
    expect(needsSync(s)).toBe(true);
    expect(unsentCount(s)).toBe(1);
    expect(needsSync({ ...s, submitSynced: true })).toBe(false);
  });
});

describe('syncOnce', () => {
  it('sends only the changed answers and marks them synced', async () => {
    const fetch = mockFetch(200, { saved: 2 });
    const s = base();
    const apply = await syncOnce(s);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/quizzes/ABCDEF/answers');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ answers: [{ i: 1, choice: 1 }, { i: 3, choice: 3 }] });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer t');
    expect(apply(s).synced).toEqual([0, 1, null, 3, null]);
  });

  it('keeps an answer pending if it changed while the request was in flight', async () => {
    mockFetch(200, { saved: 2 });
    const s = base();
    const apply = await syncOnce(s);
    const changed = { ...s, answers: [0, 2, null, 3, null] }; // Q2 changed 1 → 2 meanwhile
    expect(pendingIndices(apply(changed))).toEqual([1]);
  });

  it('submits the full answer list and records the server score', async () => {
    const fetch = mockFetch(200, { score: 2, total: 5, finishedAt: 9, alreadyFinished: false });
    const s = base({ submittedAt: 5 });
    const next = (await syncOnce(s))(s);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ answers: [0, 1, null, 3, null] });
    expect(next).toMatchObject({ submitSynced: true, serverScore: 2, synced: [0, 1, null, 3, null] });
  });

  it('throws on network failure so the caller retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(syncOnce(base())).rejects.toMatchObject({ code: 'offline' });
  });

  it('auto-submits locally when the server says the quiz closed', async () => {
    mockFetch(410, { error: 'closed', code: 'closed' });
    const s = base();
    const next = (await syncOnce(s))(s);
    expect(next.autoSubmitted).toBe(true);
    expect(next.submittedAt).toBeGreaterThan(0);
    expect(needsSync(next)).toBe(true); // the submit itself is still to be sent
  });

  it('stops syncing when the quiz is gone', async () => {
    mockFetch(404, { error: 'No quiz', code: 'not_found' });
    const s = base();
    const next = (await syncOnce(s))(s);
    expect(next.syncStopped).toMatch(/no longer exists/);
    expect(needsSync(next)).toBe(false);
  });
});
