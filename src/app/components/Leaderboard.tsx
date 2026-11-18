import type { ResultsResponse } from '../../shared/api.ts';
import { formatDuration } from '../session.ts';

interface LeaderboardProps {
  data: ResultsResponse;
  myPid?: string;
}

export function Leaderboard({ data, myPid }: LeaderboardProps) {
  const finished = data.leaderboard.filter((r) => r.finished);
  const working = data.leaderboard.filter((r) => !r.finished);
  return (
    <div class="board">
      {finished.length === 0 && <p class="muted">Nobody has finished yet.</p>}
      {finished.length > 0 && (
        <ol class="board-list">
          {finished.map((r, i) => {
            // Same score and time → same place.
            const prev = finished[i - 1];
            const place = prev && prev.score === r.score && prev.timeMs === r.timeMs ? null : i + 1;
            return (
              <li class={r.pid === myPid ? 'me' : ''}>
                <span class="place" aria-label={place ? `Place ${place}` : 'Tied'}>
                  {place ?? '='}
                </span>
                <span class="board-name">
                  {r.name}
                  {r.pid === myPid && <span class="muted"> (you)</span>}
                </span>
                <span class="board-score">
                  {r.score}/{data.total}
                  <span class="muted small"> {Math.round(((r.score ?? 0) / data.total) * 100)}%</span>
                </span>
                {data.mode === 'full' && <span class={`badge ${r.passed ? 'pass' : 'practice'}`}>{r.passed ? 'PASS' : 'Practice'}</span>}
                <span class="board-time muted small">{r.timeMs !== null ? formatDuration(r.timeMs) : ''}</span>
              </li>
            );
          })}
        </ol>
      )}
      {working.length > 0 && (
        <>
          <h3 class="h-small muted">Still working</h3>
          <ul class="board-list working">
            {working.map((r) => (
              <li class={r.pid === myPid ? 'me' : ''}>
                <span class="place">·</span>
                <span class="board-name">
                  {r.name}
                  {r.pid === myPid && <span class="muted"> (you)</span>}
                </span>
                <span class="board-score muted">
                  in progress ({r.answered}/{data.total})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
