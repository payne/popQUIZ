// Quiz building and scoring. Shared by the front end and (from step 3) the Worker,
// which will build each quiz once so every participant gets the same questions.

import type { Pool, PoolId, PoolQuestion } from './pool.ts';

export type QuizMode = 'full' | 'custom';

export interface QuizSpec {
  pool: PoolId;
  poolVersion: string;
  mode: QuizMode;
  /** Question ids in display order. Answer choices are never shuffled (official A–D order). */
  items: string[];
}

/** Returns a float in [0, 1). Injectable so tests are deterministic. */
export type Rng = () => number;

export const CUSTOM_MIN = 5;
export const CUSTOM_PRESETS = [10, 20] as const;

/** One random question from each group, in syllabus (pool) order — like a printed VE exam. */
export function buildFullExam(pool: Pool, rng: Rng = Math.random): string[] {
  return pool.subelements.flatMap((s) =>
    s.groups.map((g) => {
      const inGroup = pool.questions.filter((q) => q.group === g.id);
      if (inGroup.length === 0) throw new Error(`No questions in group ${g.id}`);
      return pick(inGroup, rng).id;
    }),
  );
}

/** Questions available to a custom quiz drawn from the given subelements. */
export function customCandidates(pool: Pool, subelementIds: readonly string[]): PoolQuestion[] {
  const subs = new Set(subelementIds);
  return pool.questions.filter((q) => subs.has(q.group.slice(0, 2)));
}

/** The allowed question-count range for a custom quiz over these subelements. */
export function customRange(pool: Pool, subelementIds: readonly string[]): { min: number; max: number } {
  const max = customCandidates(pool, subelementIds).length;
  return { min: Math.min(CUSTOM_MIN, max), max };
}

/** `count` random questions from the chosen subelements, no repeats, in random order. */
export function buildCustomQuiz(pool: Pool, count: number, subelementIds: readonly string[], rng: Rng = Math.random): string[] {
  const candidates = customCandidates(pool, subelementIds);
  const { min, max } = customRange(pool, subelementIds);
  if (max === 0) throw new Error('Choose at least one subelement');
  if (!Number.isInteger(count) || count < min || count > max) {
    throw new Error(`Choose between ${min} and ${max} questions`);
  }
  return shuffle(candidates, rng)
    .slice(0, count)
    .map((q) => q.id);
}

export function buildQuiz(
  pool: Pool,
  opts: { mode: 'full' } | { mode: 'custom'; count: number; subelements: readonly string[] },
  rng: Rng = Math.random,
): QuizSpec {
  const items = opts.mode === 'full' ? buildFullExam(pool, rng) : buildCustomQuiz(pool, opts.count, opts.subelements, rng);
  return { pool: pool.id, poolVersion: pool.version, mode: opts.mode, items };
}

/** An answer is the chosen index 0–3, or null when unanswered. */
export type Answer = number | null;

export interface Score {
  correct: number;
  total: number;
  answered: number;
  percent: number;
  /** Only for full exams: whether `correct` meets the pool's pass mark. */
  passed?: boolean;
}

export function scoreQuiz(pool: Pool, quiz: QuizSpec, answers: readonly Answer[]): Score {
  const byId = questionMap(pool);
  let correct = 0;
  let answered = 0;
  quiz.items.forEach((id, i) => {
    const a = answers[i];
    if (a === null || a === undefined) return;
    answered++;
    if (byId.get(id)?.c === a) correct++;
  });
  const total = quiz.items.length;
  const score: Score = { correct, total, answered, percent: total ? Math.round((correct / total) * 100) : 0 };
  if (quiz.mode === 'full') score.passed = correct >= pool.passing;
  return score;
}

const maps = new WeakMap<Pool, Map<string, PoolQuestion>>();
export function questionMap(pool: Pool): Map<string, PoolQuestion> {
  let m = maps.get(pool);
  if (!m) {
    m = new Map(pool.questions.map((q) => [q.id, q]));
    maps.set(pool, m);
  }
  return m;
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Fisher–Yates; returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Small seeded PRNG (mulberry32) for tests and reproducible builds. */
export function seededRng(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
