// The person's local quiz session, saved to localStorage on every change.
// Step 3 will key sessions by quiz code (pq:<CODE>) and add a server sync queue.

import type { Answer, QuizSpec } from '../shared/quiz.ts';
import { getJSON, setJSON, setString } from './storage.ts';

export interface LocalSession {
  spec: QuizSpec;
  answers: Answer[];
  flags: boolean[];
  current: number;
  startedAt: number;
  submittedAt?: number;
}

const KEY = 'pq:local';

export function newSession(spec: QuizSpec): LocalSession {
  return {
    spec,
    answers: spec.items.map(() => null),
    flags: spec.items.map(() => false),
    current: 0,
    startedAt: Date.now(),
  };
}

export function loadSession(): LocalSession | null {
  const s = getJSON<LocalSession>(KEY);
  if (!s || !Array.isArray(s.spec?.items) || !Array.isArray(s.answers)) return null;
  return s;
}

export function saveSession(s: LocalSession | null): void {
  if (s) setJSON(KEY, s);
  else setString(KEY, null);
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
