// A person's local copy of one quiz, saved to localStorage under "pq:quiz:<CODE>" on every change.
// It holds the participant token (their identity for that quiz), the question list, and their answers,
// so a started quiz keeps working offline. Step 4 adds syncing answers to the server.

import type { JoinResponse } from '../shared/api.ts';
import type { Answer, QuizSpec } from '../shared/quiz.ts';
import { getJSON, setJSON, setString } from './storage.ts';

export interface LocalSession {
  code: string;
  pid: string;
  token: string;
  name: string;
  creator: boolean;
  spec: QuizSpec;
  answers: Answer[];
  flags: boolean[];
  current: number;
  startedAt: number;
  submittedAt?: number;
  /** Submitted because the quiz closed, not by the person. */
  autoSubmitted?: boolean;
}

const PREFIX = 'pq:quiz:';
const key = (code: string) => PREFIX + code;

export function sessionFromJoin(r: JoinResponse): LocalSession {
  const q = r.quiz;
  return {
    code: q.code,
    pid: r.pid,
    token: r.token,
    name: r.name,
    creator: q.creatorPid === r.pid,
    spec: { pool: q.pool, poolVersion: q.poolVersion, mode: q.mode, items: q.items },
    answers: q.items.map(() => null),
    flags: q.items.map(() => false),
    current: 0,
    startedAt: Date.now(),
  };
}

function valid(s: LocalSession | null): s is LocalSession {
  return !!s && typeof s.code === 'string' && typeof s.token === 'string' && Array.isArray(s.spec?.items) && Array.isArray(s.answers);
}

export function loadSession(code: string): LocalSession | null {
  const s = getJSON<LocalSession>(key(code));
  return valid(s) ? s : null;
}

export function saveSession(s: LocalSession): void {
  setJSON(key(s.code), s);
}

/** Every quiz this browser has joined, newest first. */
export function listSessions(): LocalSession[] {
  const out: LocalSession[] = [];
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(PREFIX)) continue;
      const s = getJSON<LocalSession>(k);
      if (valid(s)) out.push(s);
    }
  } catch {
    /* storage unavailable */
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** Step 2 kept a single unshared quiz under "pq:local"; quizzes now always live on the server. */
export function dropLegacySession(): void {
  setString('pq:local', null);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}
