import { useEffect, useRef, useState } from 'preact/hooks';
import type { Pool } from '../../shared/pool.ts';
import { questionMap } from '../../shared/quiz.ts';
import type { LocalSession } from '../session.ts';
import { Confirm, Modal } from './Modal.tsx';

interface QuizViewProps {
  pool: Pool;
  session: LocalSession;
  /** Applies a change to the latest session (functional update). */
  onChange: (fn: (s: LocalSession) => LocalSession) => void;
  onSubmit: () => void;
}

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export function QuizView({ pool, session, onChange, onSubmit }: QuizViewProps) {
  const { spec, answers, flags, current } = session;
  const total = spec.items.length;
  const q = questionMap(pool).get(spec.items[current]!);
  const answered = answers.filter((a) => a !== null).length;
  const blanks = total - answered;
  const [confirming, setConfirming] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const go = (i: number) => {
    if (i < 0 || i >= total) return;
    onChange((s) => ({ ...s, current: i }));
    setNavOpen(false);
  };
  const step = (delta: number) =>
    onChange((s) => {
      const i = s.current + delta;
      return i < 0 || i >= total ? s : { ...s, current: i };
    });
  const choose = (choice: number) =>
    onChange((s) => {
      const next = s.answers.slice();
      next[s.current] = choice; // tapping the chosen answer again keeps it (no accidental clears)
      return { ...s, answers: next };
    });
  const toggleFlag = () =>
    onChange((s) => {
      const next = s.flags.slice();
      next[s.current] = !next[s.current];
      return { ...s, flags: next };
    });

  // Move focus to the question on navigation so screen readers announce it.
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), [current]);

  // Keyboard: A–D or 1–4 to answer, ←/→ to move, F to flag.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirming || zoom || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, dialog, .menu.open')) return;
      if (document.querySelector('.menu.open, dialog[open]')) return;
      const k = e.key.toLowerCase();
      const idx = 'abcd'.indexOf(k) >= 0 ? 'abcd'.indexOf(k) : '1234'.indexOf(k);
      if (idx >= 0 && k.length === 1) choose(idx);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (k === 'f') toggleFlag();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  if (!q) {
    return (
      <div class="quiz-missing">
        <p class="error">Question {spec.items[current]} is no longer in the {pool.name} pool.</p>
        <button type="button" class="btn" onClick={() => step(1)}>
          Skip
        </button>
      </div>
    );
  }

  const navigator = (
    <nav class="navgrid" aria-label="All questions">
      {spec.items.map((_, i) => (
        <button
          type="button"
          class={[
            'navcell',
            answers[i] !== null && 'answered',
            flags[i] && 'flagged',
            i === current && 'current',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-current={i === current ? 'step' : undefined}
          aria-label={`Question ${i + 1}${answers[i] !== null ? ', answered' : ''}${flags[i] ? ', flagged' : ''}`}
          onClick={() => go(i)}
        >
          {i + 1}
        </button>
      ))}
    </nav>
  );

  return (
    <div class="quiz">
      <div class="quiz-main">
        <div class="quiz-top">
          <span class="qcount">
            Q {current + 1} <span class="muted">of {total}</span>
          </span>
          <span class="muted qid">{q.id}</span>
          <button type="button" class="link nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}>
            {answered}/{total} answered ▾
          </button>
        </div>
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered} aria-label="Answered">
          <div style={{ width: `${(answered / total) * 100}%` }} />
        </div>

        {navOpen && <div class="nav-inline">{navigator}</div>}

        <h2 class="question" tabIndex={-1} ref={headingRef}>
          {q.q}
        </h2>

        {q.fig && (
          <button type="button" class="figure" onClick={() => setZoom(true)} aria-label={`Figure ${q.fig} — tap to enlarge`}>
            <img src={`/figures/${q.fig}.png`} alt={`Figure ${q.fig}`} />
            <span class="figure-hint">Tap to enlarge</span>
          </button>
        )}

        <div class="answers" role="radiogroup" aria-label="Answers">
          {q.a.map((text, i) => (
            <button
              type="button"
              role="radio"
              aria-checked={answers[current] === i}
              class={`answer${answers[current] === i ? ' chosen' : ''}`}
              onClick={() => choose(i)}
            >
              <span class="letter">{LETTERS[i]}</span>
              <span>{text}</span>
            </button>
          ))}
        </div>

        <div class="quiz-actions">
          <button type="button" class="btn" disabled={current === 0} onClick={() => step(-1)}>
            ← Prev
          </button>
          <button type="button" class={`btn flag${flags[current] ? ' on' : ''}`} aria-pressed={flags[current]} onClick={toggleFlag}>
            {flags[current] ? '⚑ Flagged' : '⚐ Review later'}
          </button>
          {current < total - 1 ? (
            <button type="button" class="btn btn-primary" onClick={() => step(1)}>
              Next →
            </button>
          ) : (
            <button type="button" class="btn btn-primary" onClick={() => setConfirming(true)}>
              Submit
            </button>
          )}
        </div>
      </div>

      <aside class="quiz-side">
        <h3>Questions</h3>
        {navigator}
        <p class="legend">
          <span class="navcell answered" aria-hidden="true" /> answered <span class="navcell flagged" aria-hidden="true" /> flagged
        </p>
        <button type="button" class="btn btn-primary" onClick={() => setConfirming(true)}>
          Submit quiz
        </button>
      </aside>

      {confirming && (
        <Confirm
          title={blanks ? `${blanks} unanswered — submit anyway?` : 'Submit your answers?'}
          confirmLabel="Submit"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onSubmit();
          }}
        >
          {blanks > 0 && <p>Unanswered questions count as wrong.</p>}
          {flags.some(Boolean) && <p>You still have {flags.filter(Boolean).length} flagged for review.</p>}
          <p>You can't change your answers after submitting.</p>
        </Confirm>
      )}

      {zoom && q.fig && (
        <Modal title={`Figure ${q.fig}`} onClose={() => setZoom(false)} actions={<button type="button" class="btn" onClick={() => setZoom(false)}>Close</button>}>
          <img class="figure-zoom" src={`/figures/${q.fig}.png`} alt={`Figure ${q.fig}`} />
        </Modal>
      )}
    </div>
  );
}
