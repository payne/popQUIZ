import { useState } from 'preact/hooks';
import type { Pool } from '../../shared/pool.ts';
import { questionMap, scoreQuiz } from '../../shared/quiz.ts';
import { usePwa } from '../pwa.ts';
import { useResults } from '../results.ts';
import { formatDuration, type LocalSession } from '../session.ts';
import type { SyncStatus } from '../sync.ts';
import { GroupAnswers } from './GroupAnswers.tsx';
import { Leaderboard } from './Leaderboard.tsx';
import { QuestionId } from './QuestionId.tsx';

interface ResultsProps {
  pool: Pool;
  session: LocalSession;
  onNewQuiz: () => void;
  syncStatus: SyncStatus;
}

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export function Results({ pool, session, onNewQuiz, syncStatus }: ResultsProps) {
  const { spec, answers } = session;
  const score = scoreQuiz(pool, spec, answers);
  const byId = questionMap(pool);
  const rows = spec.items.map((id, i) => ({ i, q: byId.get(id), a: answers[i] ?? null }));
  const missed = rows.filter((r) => r.q && r.a !== r.q.c);
  const [filter, setFilter] = useState<'missed' | 'all'>(missed.length ? 'missed' : 'all');
  const shown = filter === 'missed' ? missed : rows;

  const pwa = usePwa();
  // Reload once our submit reaches the server: that unlocks the group breakdown.
  const results = useResults(session.code, session.token, pwa.online, session.submitSynced);
  const data = results.data;
  const others = (data?.leaderboard.length ?? 1) > 1;
  const [tab, setTab] = useState<'board' | 'group' | 'mine'>('board');

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
        {!session.submitSynced && !session.syncStopped && (
          <p class="muted small">{syncStatus === 'waiting' ? 'Offline — your results will be sent when you reconnect.' : 'Sending your results…'}</p>
        )}
        {session.submitSynced && session.serverScore !== undefined && session.serverScore !== score.correct && (
          <p class="muted small">
            Recorded score: {session.serverScore}/{score.total} — some answers didn't reach the server before the quiz closed.
          </p>
        )}
        {session.syncStopped && <p class="error small">{session.syncStopped}</p>}
        <button type="button" class="btn btn-primary" onClick={onNewQuiz}>
          New quiz
        </button>
      </section>

      <div class="tabs" role="tablist" aria-label="Results">
        <button type="button" role="tab" aria-selected={tab === 'board'} onClick={() => setTab('board')}>
          🏆 Leaderboard{data ? ` (${data.leaderboard.length})` : ''}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'group'} onClick={() => setTab('group')}>
          👥 Group answers
        </button>
        <button type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>
          📝 Your answers
        </button>
      </div>

      {tab !== 'mine' && !data && (
        <p class="muted center">{pwa.online ? (results.error ? results.error.message : 'Loading results…') : 'Results need a connection.'}</p>
      )}

      {tab === 'board' && data && (
        <section>
          <Leaderboard data={data} myPid={session.pid} />
          {results.live && <p class="muted small center">Updates automatically while people are still working.</p>}
          {!others && <p class="muted small center">Share the quiz from the ☰ menu to compare with friends.</p>}
        </section>
      )}

      {tab === 'group' && data && (
        data.breakdown ? (
          <section>
            <p class="muted small">
              How the {data.finishedCount} {data.finishedCount === 1 ? 'person' : 'people'} who finished answered — most-missed first.
              {results.live && ' Updates as more people finish.'}
            </p>
            <GroupAnswers pool={pool} breakdown={data.breakdown} finishedCount={data.finishedCount} myAnswers={answers} />
          </section>
        ) : (
          <p class="muted center">
            {session.submitSynced ? 'Loading…' : 'Group answers unlock once your submit reaches the server.'}
          </p>
        )
      )}

      {tab === 'mine' && (
      <>
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
                <strong>Q{i + 1}</strong> <QuestionId pool={pool} q={q} />
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
      </>
      )}
    </div>
  );
}
