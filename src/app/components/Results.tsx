import { useState } from 'preact/hooks';
import type { Pool } from '../../shared/pool.ts';
import { questionMap, scoreQuiz } from '../../shared/quiz.ts';
import { formatDuration, type LocalSession } from '../session.ts';

interface ResultsProps {
  pool: Pool;
  session: LocalSession;
  onNewQuiz: () => void;
}

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export function Results({ pool, session, onNewQuiz }: ResultsProps) {
  const { spec, answers } = session;
  const score = scoreQuiz(pool, spec, answers);
  const byId = questionMap(pool);
  const rows = spec.items.map((id, i) => ({ i, q: byId.get(id), a: answers[i] ?? null }));
  const missed = rows.filter((r) => r.q && r.a !== r.q.c);
  const [filter, setFilter] = useState<'missed' | 'all'>(missed.length ? 'missed' : 'all');
  const shown = filter === 'missed' ? missed : rows;

  return (
    <div class="results">
      <section class={`scorecard${score.passed === true ? ' pass' : score.passed === false ? ' practice' : ''}`}>
        <p class="muted">
          {pool.name} · {spec.mode === 'full' ? 'Full exam' : `Custom · ${spec.items.length} questions`}
        </p>
        <p class="score">
          {score.correct}/{score.total} <span class="pct">({score.percent}%)</span>
        </p>
        {score.passed === true && <p class="verdict">PASS ✅</p>}
        {score.passed === false && (
          <p class="verdict">
            Practice — {pool.passing - score.correct} more to pass
          </p>
        )}
        <p class="muted">
          {session.submittedAt && `Time: ${formatDuration(session.submittedAt - session.startedAt)}`}
          {score.answered < score.total && ` · ${score.total - score.answered} left blank`}
          {spec.mode === 'full' && ` · Pass mark ${pool.passing}/${pool.examSize}`}
        </p>
        {session.autoSubmitted && <p class="muted small">The quiz was closed, so your answers were submitted automatically.</p>}
        <button type="button" class="btn btn-primary" onClick={onNewQuiz}>
          New quiz
        </button>
      </section>

      <div class="segmented" role="radiogroup" aria-label="Show">
        <button type="button" role="radio" aria-checked={filter === 'missed'} onClick={() => setFilter('missed')}>
          Missed ({missed.length})
        </button>
        <button type="button" role="radio" aria-checked={filter === 'all'} onClick={() => setFilter('all')}>
          All ({rows.length})
        </button>
      </div>

      {shown.length === 0 && <p class="muted center">Nothing missed — nice work! 🎉</p>}

      <ol class="review">
        {shown.map(({ i, q, a }) =>
          q ? (
            <li class={a === q.c ? 'right' : 'wrong'}>
              <p class="review-head">
                <strong>Q{i + 1}</strong> <span class="muted">{q.id}</span>
                {a === null && <span class="tag">blank</span>}
              </p>
              <p class="review-q">{q.q}</p>
              {q.fig && <img class="review-fig" src={`/figures/${q.fig}.png`} alt={`Figure ${q.fig}`} loading="lazy" />}
              <ul class="review-answers">
                {q.a.map((text, k) => (
                  <li class={[k === q.c && 'correct', k === a && k !== q.c && 'yours-wrong'].filter(Boolean).join(' ')}>
                    <span class="letter">{LETTERS[k]}</span>
                    <span>{text}</span>
                    {k === q.c && <span class="mark" aria-label="correct answer">✓</span>}
                    {k === a && k !== q.c && <span class="mark" aria-label="your answer">✗ yours</span>}
                  </li>
                ))}
              </ul>
            </li>
          ) : (
            <li class="wrong">
              <p class="muted">Question {spec.items[i]} is no longer in the pool.</p>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
