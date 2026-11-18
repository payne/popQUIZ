import { useEffect, useState } from 'preact/hooks';
import type { Pool } from '../shared/pool.ts';
import type { QuizSpec } from '../shared/quiz.ts';
import { Home } from './components/Home.tsx';
import { Menu } from './components/Menu.tsx';
import { QuizView } from './components/QuizView.tsx';
import { Results } from './components/Results.tsx';
import { loadPool } from './pools.ts';
import { applyUpdate, dismissUpdate, usePwa } from './pwa.ts';
import { loadSession, newSession, saveSession, type LocalSession } from './session.ts';

export function App() {
  const [session, setSession] = useState<LocalSession | null>(loadSession);
  const [pool, setPool] = useState<Pool | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pwa = usePwa();

  const poolId = session?.spec.pool;
  useEffect(() => {
    if (!poolId) return;
    let live = true;
    setPoolError(null);
    loadPool(poolId)
      .then((p) => live && setPool(p))
      .catch((e: Error) => live && setPoolError(e.message));
    return () => {
      live = false;
    };
  }, [poolId]);

  // Persist every change. Updates go through functional setState so rapid taps/keys never
  // overwrite each other with a stale session.
  useEffect(() => saveSession(session), [session]);
  const update = (s: LocalSession | null) => setSession(s);
  const patch = (fn: (s: LocalSession) => LocalSession) => setSession((prev) => (prev ? fn(prev) : prev));
  const start = (spec: QuizSpec) => {
    update(newSession(spec));
    scrollTo(0, 0);
  };
  const submit = () => {
    patch((s) => (s.submittedAt ? s : { ...s, submittedAt: Date.now() }));
    scrollTo(0, 0);
  };
  const newQuiz = () => update(null);

  const inProgress = !!session && !session.submittedAt;
  const ready = session && pool?.id === session.spec.pool ? pool : null;

  return (
    <div class="app">
      <header class="topbar">
        <button type="button" class="brand" onClick={() => !inProgress && newQuiz()} aria-label="Pop Quiz home" disabled={inProgress}>
          <img src="/icons/icon.svg" alt="" width="28" height="28" />
          <span>Pop Quiz</span>
        </button>
        {!pwa.online && <span class="offline-pill">Offline</span>}
        <button type="button" class="icon-btn" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          ☰
        </button>
      </header>

      <main class="content">
        {!session && <Home onStart={start} />}
        {session && poolError && <p class="error">{poolError}</p>}
        {session && !ready && !poolError && <p class="muted center">Loading…</p>}
        {session && ready && !session.submittedAt && <QuizView pool={ready} session={session} onChange={patch} onSubmit={submit} />}
        {session && ready && session.submittedAt && <Results pool={ready} session={session} onNewQuiz={newQuiz} />}
      </main>

      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} onNewQuiz={session ? newQuiz : undefined} quizInProgress={inProgress} />

      {pwa.needRefresh && (
        <div class="toast" role="status">
          {/* Only ever applied when the person taps Reload; progress is in localStorage, so it's safe mid-quiz. */}
          <span>Update available</span>
          <button type="button" class="btn btn-primary" onClick={() => void applyUpdate()}>
            Reload
          </button>
          <button type="button" class="icon-btn" aria-label="Dismiss" onClick={dismissUpdate}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
