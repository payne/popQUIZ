import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Pool, PoolId } from '../../shared/pool.ts';
import { NAME_MAX, normalizeName, type JoinResponse } from '../../shared/api.ts';
import { CUSTOM_PRESETS, customRange, scoreQuiz } from '../../shared/quiz.ts';
import { api, ApiError } from '../api.ts';
import { loadPool, POOL_CHOICES } from '../pools.ts';
import { usePwa } from '../pwa.ts';
import { navigate } from '../router.ts';
import { listSessions, type LocalSession } from '../session.ts';
import { getString, setString } from '../storage.ts';
import { Turnstile, TURNSTILE_SITE_KEY } from './Turnstile.tsx';

interface HomeProps {
  onCreated: (r: JoinResponse) => void;
}

type CountChoice = (typeof CUSTOM_PRESETS)[number] | 'other';

export function Home({ onCreated }: HomeProps) {
  const pwa = usePwa();
  const [name, setName] = useState(() => getString('pq:name') ?? '');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // "I'm human" token (single use); a new one is requested after each attempt.
  const [botToken, setBotToken] = useState<string | null>(null);
  const [botReset, setBotReset] = useState(0);
  const needBotToken = !!TURNSTILE_SITE_KEY && !botToken;
  const [poolId, setPoolId] = useState<PoolId>(() => (getString('pq:lastPool') as PoolId | null) ?? 'tech');
  const [pool, setPool] = useState<Pool | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'full' | 'custom'>('full');
  const [countChoice, setCountChoice] = useState<CountChoice>(10);
  const [otherCount, setOtherCount] = useState('');
  const [subs, setSubs] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    setPool(null);
    setLoadError(null);
    loadPool(poolId)
      .then((p) => {
        if (!live) return;
        setPool(p);
        setSubs(p.subelements.map((s) => s.id));
      })
      .catch((e: Error) => live && setLoadError(e.message));
    setString('pq:lastPool', poolId);
    return () => {
      live = false;
    };
  }, [poolId]);

  const range = useMemo(() => (pool ? customRange(pool, subs) : { min: 0, max: 0 }), [pool, subs]);
  const count = countChoice === 'other' ? Number.parseInt(otherCount, 10) : countChoice;
  const countError =
    mode === 'custom' && pool
      ? subs.length === 0
        ? 'Pick at least one subelement.'
        : !Number.isInteger(count) || count < range.min || count > range.max
          ? `Choose between ${range.min} and ${range.max} questions.`
          : null
      : null;

  const subCount = (id: string) => pool?.questions.filter((q) => q.group.startsWith(id)).length ?? 0;
  const toggleSub = (id: string) => setSubs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const cleanName = normalizeName(name);

  const start = async (e: Event) => {
    e.preventDefault();
    if (!pool || countError || !cleanName || busy || needBotToken) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const turnstileToken = botToken ?? undefined;
      const r = await api.createQuiz(
        mode === 'full'
          ? { pool: pool.id, mode: 'full', name: cleanName, turnstileToken }
          : { pool: pool.id, mode: 'custom', count, subelements: subs, name: cleanName, turnstileToken },
      );
      setString('pq:name', cleanName);
      onCreated(r);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not start the quiz.');
      setBotReset((n) => n + 1); // the token was used up
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="home" onSubmit={start}>
      <section>
        <h1>Pop Quiz</h1>
        <p class="lede">FCC amateur radio practice exams — take one together and compare results.</p>
      </section>

      <fieldset>
        <legend>Exam</legend>
        <div class="cards">
          {POOL_CHOICES.map((p) => (
            <label class={`card${poolId === p.id ? ' selected' : ''}`}>
              <input type="radio" name="pool" checked={poolId === p.id} onChange={() => setPoolId(p.id)} />
              <span class="card-title">{p.name}</span>
              <span class="card-sub">
                Element {p.element} · {p.version}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Questions</legend>
        <div class="segmented wide" role="radiogroup">
          <button type="button" role="radio" aria-checked={mode === 'full'} onClick={() => setMode('full')}>
            Full exam
          </button>
          <button type="button" role="radio" aria-checked={mode === 'custom'} onClick={() => setMode('custom')}>
            Custom
          </button>
        </div>

        {mode === 'full' && pool && (
          <p class="muted">
            {pool.examSize} questions, one from each topic group, just like the real exam. Pass mark: {pool.passing} correct.
          </p>
        )}

        {mode === 'custom' && pool && (
          <div class="custom">
            <div class="chips" role="radiogroup" aria-label="Number of questions">
              {CUSTOM_PRESETS.map((n) => (
                <button type="button" role="radio" class="chip" aria-checked={countChoice === n} onClick={() => setCountChoice(n)}>
                  {n}
                </button>
              ))}
              <button type="button" role="radio" class="chip" aria-checked={countChoice === 'other'} onClick={() => setCountChoice('other')}>
                Other
              </button>
              {countChoice === 'other' && (
                <input
                  class="count-input"
                  type="number"
                  inputMode="numeric"
                  min={range.min}
                  max={range.max}
                  placeholder={`${range.min}–${range.max}`}
                  aria-label="Number of questions"
                  value={otherCount}
                  onInput={(e) => setOtherCount((e.currentTarget as HTMLInputElement).value)}
                />
              )}
            </div>

            <div class="subs-head">
              <span>Topics</span>
              <button
                type="button"
                class="link"
                onClick={() => setSubs(subs.length === pool.subelements.length ? [] : pool.subelements.map((s) => s.id))}
              >
                {subs.length === pool.subelements.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <ul class="subs">
              {pool.subelements.map((s) => (
                <li>
                  <label>
                    <input type="checkbox" checked={subs.includes(s.id)} onChange={() => toggleSub(s.id)} />
                    <span class="sub-id">{s.id}</span>
                    <span class="sub-title">{s.title}</span>
                    <span class="sub-count">{subCount(s.id)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!pool && !loadError && <p class="muted">Loading questions…</p>}
        {loadError && <p class="error">{loadError}</p>}
      </fieldset>

      <fieldset>
        <legend>
          <label for="name">Your call sign or nickname</label>
        </legend>
        <input
          id="name"
          class="text-input"
          autoComplete="nickname"
          autoCapitalize="characters"
          maxLength={NAME_MAX}
          placeholder="e.g. KC1ABC or Sam"
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
        <p class="muted small">Shown to everyone in the quiz.</p>
      </fieldset>

      {countError && <p class="error">{countError}</p>}
      {pwa.online && <Turnstile onToken={setBotToken} onError={setSubmitError} resetKey={botReset} />}
      {submitError && <p class="error">{submitError}</p>}
      <button
        type="submit"
        class="btn btn-primary btn-big"
        disabled={!pool || !!countError || !cleanName || busy || !pwa.online || needBotToken}
      >
        {busy
          ? 'Starting…'
          : !pwa.online
            ? 'Starting a quiz needs a connection'
            : needBotToken
              ? 'Checking you’re human…'
              : 'Start quiz'}
      </button>
      <p class="muted small center">You'll get a link to share from the ☰ menu.</p>

      <YourQuizzes />

      <p class="fineprint">
        Questions from the official NCVEC public-domain question pools. Names and answers are stored for 30 days, then deleted.
      </p>
    </form>
  );
}

/** Quizzes this browser has joined, so people can get back to them. */
function YourQuizzes() {
  const [sessions] = useState<LocalSession[]>(listSessions);
  if (sessions.length === 0) return null;
  return (
    <section class="your-quizzes">
      <h2>Your quizzes</h2>
      <ul>
        {sessions.slice(0, 10).map((s) => (
          <li>
            <a
              href={`/${s.code}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/${s.code}`);
              }}
            >
              <span class="yq-code">{s.code}</span>
              <span class="yq-what">
                {POOL_CHOICES.find((p) => p.id === s.spec.pool)?.name} · {s.spec.mode === 'full' ? 'Full exam' : `${s.spec.items.length} questions`}
              </span>
              <SessionStatus s={s} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SessionStatus({ s }: { s: LocalSession }) {
  const [score, setScore] = useState<string | null>(null);
  useEffect(() => {
    if (!s.submittedAt) return;
    loadPool(s.spec.pool)
      .then((p) => {
        const r = scoreQuiz(p, s.spec, s.answers);
        setScore(`${r.correct}/${r.total}`);
      })
      .catch(() => {});
  }, [s]);
  if (!s.submittedAt) {
    const n = s.answers.filter((a) => a !== null).length;
    return <span class="yq-status working">In progress · {n}/{s.spec.items.length}</span>;
  }
  return <span class="yq-status">Done{score ? ` · ${score}` : ''}</span>;
}
