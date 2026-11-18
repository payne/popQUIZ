import type { QuestionStat } from '../../shared/api.ts';
import type { Pool } from '../../shared/pool.ts';
import { questionMap, type Answer } from '../../shared/quiz.ts';

const LETTERS = ['A', 'B', 'C', 'D'] as const;

interface GroupAnswersProps {
  pool: Pool;
  breakdown: QuestionStat[];
  finishedCount: number;
  myAnswers: Answer[];
}

/** How the group answered each question, most-missed first — the discussion starter. */
export function GroupAnswers({ pool, breakdown, finishedCount, myAnswers }: GroupAnswersProps) {
  const byId = questionMap(pool);
  const rightShare = (s: QuestionStat) => (finishedCount ? (s.counts[s.correct as 0] ?? 0) / finishedCount : 0);
  const sorted = breakdown.slice().sort((a, b) => rightShare(a) - rightShare(b) || a.i - b.i);

  return (
    <ol class="review group">
      {sorted.map((s) => {
        const q = byId.get(s.id);
        if (!q) return null;
        const right = s.counts[s.correct as 0] ?? 0;
        const mine = myAnswers[s.i] ?? null;
        return (
          <li class={right === finishedCount ? 'right' : 'wrong'}>
            <p class="review-head">
              <strong>Q{s.i + 1}</strong> <span class="muted">{q.id}</span>
              <span class="tag">
                {right} of {finishedCount} got it
              </span>
            </p>
            <p class="review-q">{q.q}</p>
            {q.fig && <img class="review-fig" src={`/figures/${q.fig}.png`} alt={`Figure ${q.fig}`} loading="lazy" />}
            <ul class="review-answers bars">
              {q.a.map((text, k) => {
                const n = s.counts[k as 0];
                const pct = finishedCount ? Math.round((n / finishedCount) * 100) : 0;
                return (
                  <li class={[k === s.correct && 'correct', k === mine && 'mine'].filter(Boolean).join(' ')}>
                    <span class="letter">{LETTERS[k]}</span>
                    <span class="bar-text">
                      {text}
                      <span class="bar" aria-hidden="true">
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span class="mark">
                      {n}
                      {k === s.correct && ' ✓'}
                      {k === mine && <span class="you"> you</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
            {s.blank > 0 && <p class="muted small">{s.blank} left it blank</p>}
          </li>
        );
      })}
    </ol>
  );
}
