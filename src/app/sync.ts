// Sends locally saved answers to the server. Answers are always written to localStorage first
// (session.ts); this module sends the difference between `answers` and `synced`, then the final
// submit. Failures leave everything queued; the App retries on reconnect, on return to the tab,
// and on a timer.

import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiError, api } from './api.ts';
import { listSessions, saveSession, type LocalSession } from './session.ts';

/** Question indexes whose local answer the server doesn't have yet. */
export function pendingIndices(s: LocalSession): number[] {
  const out: number[] = [];
  s.answers.forEach((a, i) => {
    if (a !== null && a !== s.synced[i]) out.push(i);
  });
  return out;
}

export function needsSync(s: LocalSession): boolean {
  if (s.syncStopped) return false;
  return pendingIndices(s).length > 0 || (!!s.submittedAt && !s.submitSynced);
}

/** Count of answers (plus an unsent submit) still waiting to reach the server. */
export function unsentCount(s: LocalSession): number {
  if (s.syncStopped) return 0;
  return pendingIndices(s).length + (s.submittedAt && !s.submitSynced ? 1 : 0);
}

export type SyncPatch = (prev: LocalSession) => LocalSession;

/**
 * One sync round for a session. Resolves to a patch to apply to the latest session state
 * (answers may have changed while the request was in flight). Throws ApiError on
 * transient failures (offline, 5xx) so the caller can retry later.
 */
export async function syncOnce(s: LocalSession): Promise<SyncPatch> {
  if (s.syncStopped) return (p) => p;
  try {
    if (s.submittedAt && !s.submitSynced) {
      const r = await api.submit(s.code, s.token, s.answers);
      return (p) => ({ ...p, synced: p.answers.slice(), submitSynced: true, serverScore: r.score });
    }
    const idx = pendingIndices(s);
    if (idx.length === 0) return (p) => p;
    const sent = idx.map((i) => ({ i, choice: s.answers[i]! }));
    await api.saveAnswers(s.code, s.token, sent);
    return (p) => {
      const synced = p.synced.slice();
      for (const { i, choice } of sent) synced[i] = choice;
      return { ...p, synced };
    };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    // Permanent outcomes: stop retrying.
    if (e.code === 'finished' || e.code === 'closed') {
      // The server has already finalised this person (quiz closed). The App's quiz-info refresh
      // auto-submits locally; the submit call then returns the recorded score.
      return (p) => ({ ...p, synced: p.answers.slice(), ...(p.submittedAt ? {} : { submittedAt: Date.now(), autoSubmitted: true }) });
    }
    if (e.code === 'unauthorized' || e.code === 'not_found') {
      return (p) => ({ ...p, syncStopped: e.code === 'not_found' ? 'This quiz no longer exists on the server.' : 'The server no longer recognises you in this quiz.' });
    }
    if (e.code === 'bad_request') {
      return (p) => ({ ...p, syncStopped: e.message });
    }
    throw e; // offline / server_error → retry later
  }
}

/**
 * Tries to send everything waiting in every saved quiz (used by "Reload app" and at startup).
 * Returns how many items are still unsent afterwards.
 */
export async function flushAll(skipCode?: string): Promise<number> {
  let remaining = 0;
  for (const s of listSessions()) {
    if (s.code === skipCode) continue;
    let cur = s;
    for (let round = 0; round < 3 && needsSync(cur); round++) {
      try {
        cur = (await syncOnce(cur))(cur);
        saveSession(cur);
      } catch {
        break;
      }
    }
    remaining += unsentCount(cur);
  }
  return remaining;
}

// ---------- hook ----------


export type SyncStatus = 'saved' | 'saving' | 'waiting' | 'stopped';

/**
 * Keeps one session synced: debounces after changes, retries with backoff on failure,
 * and retries immediately on reconnect or when the tab becomes visible.
 */
export function useAnswerSync(
  session: LocalSession | null,
  patch: (fn: SyncPatch) => void,
  online: boolean,
): SyncStatus {
  const [tick, setTick] = useState(0);
  const [failures, setFailures] = useState(0);
  const inFlight = useRef(false);
  const latest = useRef(session);
  latest.current = session;

  useEffect(() => {
    // Reconnected or back on the tab: retry now instead of waiting out the backoff.
    const bump = () => {
      if (document.visibilityState !== 'visible') return;
      setFailures(0);
      setTick((t) => t + 1);
    };
    addEventListener('online', bump);
    document.addEventListener('visibilitychange', bump);
    return () => {
      removeEventListener('online', bump);
      document.removeEventListener('visibilitychange', bump);
    };
  }, []);

  useEffect(() => {
    if (!session || !online || !needsSync(session) || inFlight.current) return;
    // Quick debounce batches rapid taps; backoff after failures (2 s, 4 s … max 60 s).
    const delay = failures === 0 ? 600 : Math.min(60_000, 1000 * 2 ** failures);
    const t = setTimeout(async () => {
      const s = latest.current;
      if (!s || !needsSync(s) || inFlight.current) return;
      inFlight.current = true;
      try {
        patch(await syncOnce(s));
        setFailures(0);
      } catch {
        setFailures((f) => f + 1);
      } finally {
        inFlight.current = false;
        setTick((x) => x + 1); // re-check: more answers may have arrived meanwhile
      }
    }, delay);
    return () => clearTimeout(t);
  }, [session, online, tick, failures]);

  if (!session) return 'saved';
  if (session.syncStopped) return 'stopped';
  if (!needsSync(session)) return 'saved';
  return online && failures < 3 ? 'saving' : 'waiting';
}
