import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Pool, PoolId } from '../../shared/pool.ts';
import { buildQuiz, CUSTOM_PRESETS, customRange, type QuizSpec } from '../../shared/quiz.ts';
import { loadPool, POOL_CHOICES } from '../pools.ts';
import { getString, setString } from '../storage.ts';

interface HomeProps {
  onStart: (spec: QuizSpec) => void;
}

type CountChoice = (typeof CUSTOM_PRESETS)[number] | 'other';

export function Home({ onStart }: HomeProps) {
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

  const start = (e: Event) => {
    e.preventDefault();
    if (!pool || countError) return;
    onStart(buildQuiz(pool, mode === 'full' ? { mode: 'full' } : { mode: 'custom', count, subelements: subs }));
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

      {countError && <p class="error">{countError}</p>}
      <button type="submit" class="btn btn-primary btn-big" disabled={!pool || !!countError}>
        Start
      </button>

      <p class="fineprint">
        Questions from the official NCVEC public-domain question pools. Names and answers are stored for 30 days, then deleted.
      </p>
    </form>
  );
}
