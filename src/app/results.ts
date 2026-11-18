import { useCallback, useEffect, useState } from 'preact/hooks';
import type { ResultsResponse } from '../shared/api.ts';
import { api, ApiError } from './api.ts';

const POLL_MS = 12_000;

/**
 * Loads quiz results and refreshes them every 12 s while people are still working
 * and the quiz is open (and the tab is visible). `key` changes force a reload
 * (e.g. once this person's submit reaches the server, the breakdown unlocks).
 */
export function useResults(code: string, token: string | undefined, online: boolean, key: unknown = null) {
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api.results(code, token));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'server_error', 'Could not load results'));
    }
  }, [code, token]);

  useEffect(() => {
    if (online) void refresh();
  }, [refresh, online, key]);

  const live = !data || (!data.closed && data.leaderboard.some((r) => !r.finished));
  useEffect(() => {
    if (!online || !live) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh, online, live]);

  return { data, error, refresh, live };
}
