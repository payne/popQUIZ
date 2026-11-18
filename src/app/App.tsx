import { useCallback, useEffect, useState } from 'preact/hooks';
import type { JoinResponse, QuizInfo } from '../shared/api.ts';
import type { Pool } from '../shared/pool.ts';
import { api, ApiError } from './api.ts';
import { Home } from './components/Home.tsx';
import { Join } from './components/Join.tsx';
import { Menu, type QuizMenu } from './components/Menu.tsx';
import { Confirm } from './components/Modal.tsx';
import { QuizView } from './components/QuizView.tsx';
import { Results } from './components/Results.tsx';
import { Share } from './components/Share.tsx';
import { WhosIn } from './components/WhosIn.tsx';
import { LeaderboardDialog } from './components/LeaderboardDialog.tsx';
import { loadPool, POOL_CHOICES } from './pools.ts';
import { applyUpdate, dismissUpdate, usePwa } from './pwa.ts';
import { codeFromPath, navigate, usePath } from './router.ts';
import { dropLegacySession, loadSession, saveSession, sessionFromJoin, type LocalSession } from './session.ts';
import { flushAll, unsentCount, useAnswerSync } from './sync.ts';

dropLegacySession();

type Dialog = null | 'share' | 'qr' | 'whos-in' | 'close-quiz' | 'leaderboard';

export function App() {
  const path = usePath();
  const code = codeFromPath(path);
  const pwa = usePwa();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  // Unknown paths go home; lower-case codes are rewritten to the canonical /CODE.
  useEffect(() => {
    if (!code && path !== '/') navigate('/', true);
    else if (code && path !== `/${code}`) navigate(`/${code}`, true);
  }, [code, path]);

  // ----- this quiz's local session (answers live here first) -----
  const [session, setSession] = useState<LocalSession | null>(() => (code ? loadSession(code) : null));
  useEffect(() => setSession(code ? loadSession(code) : null), [code]);
  useEffect(() => {
    if (session) saveSession(session);
  }, [session]);
  // Functional updates so rapid taps/keys never overwrite each other with a stale session.
  const patch = useCallback((fn: (s: LocalSession) => LocalSession) => setSession((prev) => (prev ? fn(prev) : prev)), []);

  // ----- send answers to the server (localStorage first, then sync) -----
  const syncStatus = useAnswerSync(session, patch, pwa.online);
  const unsent = session ? unsentCount(session) : 0;
  // At startup, also flush other quizzes that still have unsent answers.
  useEffect(() => {
    if (pwa.online) void flushAll(code ?? undefined);
  }, [pwa.online]);

  // ----- server view of the quiz (who's in, closed?) -----
  const [info, setInfo] = useState<QuizInfo | null>(null);
  const [infoError, setInfoError] = useState<ApiError | null>(null);
  const refreshInfo = useCallback(async () => {
    if (!code) return;
    try {
      const i = await api.getQuiz(code);
      if (i.code === code) {
        setInfo(i);
        setInfoError(null);
      }
    } catch (e) {
      setInfoError(e instanceof ApiError ? e : new ApiError(0, 'server_error', 'Could not load the quiz'));
    }
  }, [code]);
  useEffect(() => {
    setInfo(null);
    setInfoError(null);
    void refreshInfo();
  }, [code]);
  useEffect(() => {
    if (pwa.online && infoError?.code === 'offline') void refreshInfo();
  }, [pwa.online]);

  // When the quiz closes (creator or 7-day limit), anyone still working is submitted automatically.
  useEffect(() => {
    if (info?.closed && session && !session.submittedAt) {
      patch((s) => (s.submittedAt ? s : { ...s, submittedAt: info.closedAt ?? info.closesAt, autoSubmitted: true }));
    }
  }, [info?.closed, session?.submittedAt]);

  // ----- question pool for this quiz -----
  const poolId = session?.spec.pool ?? info?.pool;
  const [pool, setPool] = useState<Pool | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
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

  const joined = (r: JoinResponse) => {
    const s = sessionFromJoin(r);
    saveSession(s);
    setInfo(r.quiz);
    if (r.quiz.code === code) setSession(s);
    else navigate(`/${r.quiz.code}`);
  };
  const submit = () => {
    patch((s) => (s.submittedAt ? s : { ...s, submittedAt: Date.now() }));
    scrollTo(0, 0);
  };
  const [closeError, setCloseError] = useState<string | null>(null);
  const closeQuiz = async () => {
    if (!session) return;
    try {
      setInfo(await api.close(session.code, session.token));
      setDialog(null);
    } catch (e) {
      setCloseError(e instanceof ApiError ? e.message : 'Could not close the quiz');
    }
  };

  const ready = session && pool?.id === session.spec.pool ? pool : null;
  const poolName = POOL_CHOICES.find((p) => p.id === poolId)?.name ?? 'ham radio';
  const quizMenu: QuizMenu | undefined =
    code && session
      ? {
          code,
          onShare: () => setDialog('share'),
          onQr: () => setDialog('qr'),
          onWhosIn: () => setDialog('whos-in'),
          onLeaderboard: () => setDialog('leaderboard'),
          onCloseQuiz: session.creator && !info?.closed ? () => (setCloseError(null), setDialog('close-quiz')) : undefined,
          participantCount: info?.participants.length,
        }
      : undefined;

  let content;
  if (!code) {
    content = <Home onCreated={joined} />;
  } else if (session) {
    content = poolError ? (
      <p class="error">{poolError}</p>
    ) : !ready ? (
      <p class="muted center">Loading…</p>
    ) : session.submittedAt ? (
      <Results pool={ready} session={session} onNewQuiz={() => navigate('/')} syncStatus={syncStatus} />
    ) : (
      <QuizView pool={ready} session={session} onChange={patch} onSubmit={submit} syncStatus={syncStatus} unsent={unsent} />
    );
  } else if (info) {
    content = <Join info={info} onJoined={joined} />;
  } else if (infoError) {
    content = (
      <div class="home">
        <h1>{infoError.code === 'not_found' ? `No quiz “${code}”` : 'Can’t load this quiz'}</h1>
        <p class="lede">
          {infoError.code === 'not_found'
            ? 'Check the link or code — quizzes are deleted after 30 days.'
            : infoError.code === 'offline'
              ? 'Joining a quiz needs a connection. It will load when you’re back online.'
              : infoError.message}
        </p>
        <button type="button" class="btn btn-primary" onClick={() => navigate('/')}>
          Start a new quiz
        </button>
      </div>
    );
  } else {
    content = <p class="muted center">Loading quiz {code}…</p>;
  }

  return (
    <div class="app">
      <header class="topbar">
        <a
          class="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          aria-label="Pop Quiz home"
        >
          <img src="/icons/icon.svg" alt="" width="28" height="28" />
          <span>Pop Quiz</span>
        </a>
        {code && session && (
          <button type="button" class="code-pill" onClick={() => setDialog('share')} aria-label={`Share quiz ${code}`}>
            {code}
          </button>
        )}
        {!pwa.online && <span class="offline-pill">Offline</span>}
        <button type="button" class="icon-btn" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => {
            setMenuOpen(true);
            if (code && pwa.online) void refreshInfo(); // fresh "Who's in (n)" count
          }}
        >
          ☰
        </button>
      </header>

      <main class="content">{content}</main>

      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} onNewQuiz={() => navigate('/')} quiz={quizMenu} />

      {code && (dialog === 'share' || dialog === 'qr') && (
        <Share code={code} poolName={poolName} qrFirst={dialog === 'qr'} onClose={() => setDialog(null)} />
      )}
      {session && dialog === 'whos-in' && (
        <WhosIn info={info} myPid={session.pid} onRefresh={() => void refreshInfo()} onClose={() => setDialog(null)} />
      )}
      {session && dialog === 'leaderboard' && (
        <LeaderboardDialog code={session.code} token={session.token} myPid={session.pid} onClose={() => setDialog(null)} />
      )}
      {dialog === 'close-quiz' && (
        <Confirm title="Close this quiz?" confirmLabel="Close quiz" danger onCancel={() => setDialog(null)} onConfirm={() => void closeQuiz()}>
          <p>Nobody new can join, and anyone still working is submitted with the answers they have so far.</p>
          <p>Everyone can still see their results.</p>
          {!pwa.online && <p class="error">You're offline — closing needs a connection.</p>}
          {closeError && <p class="error">{closeError}</p>}
        </Confirm>
      )}

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
