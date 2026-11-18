import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Pool } from '../src/shared/pool.ts';
import { buildCustomQuiz, buildFullExam, buildQuiz, customRange, questionMap, scoreQuiz, seededRng } from '../src/shared/quiz.ts';

const load = (id: string): Pool => JSON.parse(readFileSync(new URL(`../public/pools/${id}.json`, import.meta.url), 'utf8'));
const tech = load('tech');
const extra = load('extra');

describe('buildFullExam', () => {
  it('takes exactly one question per group, in syllabus order', () => {
    for (const pool of [tech, extra]) {
      const items = buildFullExam(pool, seededRng(1));
      const groups = pool.subelements.flatMap((s) => s.groups.map((g) => g.id));
      expect(items).toHaveLength(pool.examSize);
      expect(items.map((id) => questionMap(pool).get(id)!.group)).toEqual(groups);
    }
  });

  it('varies the chosen questions between builds', () => {
    expect(buildFullExam(tech, seededRng(1))).not.toEqual(buildFullExam(tech, seededRng(2)));
  });
});

describe('buildCustomQuiz', () => {
  it('draws the requested count from the chosen subelements without repeats', () => {
    const items = buildCustomQuiz(tech, 20, ['T5', 'T6'], seededRng(3));
    expect(items).toHaveLength(20);
    expect(new Set(items).size).toBe(20);
    for (const id of items) expect(['T5', 'T6']).toContain(id.slice(0, 2));
  });

  it('allows every question in the selection', () => {
    const { max } = customRange(tech, ['T9']);
    expect(max).toBe(23);
    expect(buildCustomQuiz(tech, max, ['T9'], seededRng(4)).sort()).toEqual(
      tech.questions.filter((q) => q.group.startsWith('T9')).map((q) => q.id).sort(),
    );
  });

  it('rejects counts outside 1…available and empty selections', () => {
    expect(() => buildCustomQuiz(tech, 0, ['T1'])).toThrow(/between 1 and 68/);
    expect(() => buildCustomQuiz(tech, 69, ['T1'])).toThrow(/between 1 and 68/);
    expect(() => buildCustomQuiz(tech, 10, [])).toThrow(/at least one/);
  });
});

describe('scoreQuiz', () => {
  const quiz = buildQuiz(tech, { mode: 'full' }, seededRng(5));
  const key = quiz.items.map((id) => questionMap(tech).get(id)!.c);

  it('passes a full exam at the pass mark and not below it', () => {
    const atPass = key.map((c, i) => (i < tech.passing ? c : (c + 1) % 4));
    expect(scoreQuiz(tech, quiz, atPass)).toMatchObject({ correct: 26, total: 35, answered: 35, passed: true, percent: 74 });
    const below = key.map((c, i) => (i < tech.passing - 1 ? c : (c + 1) % 4));
    expect(scoreQuiz(tech, quiz, below).passed).toBe(false);
  });

  it('counts blanks as wrong', () => {
    const blanks = key.map((c, i) => (i < 30 ? c : null));
    expect(scoreQuiz(tech, quiz, blanks)).toMatchObject({ correct: 30, answered: 30, total: 35 });
  });

  it('gives no pass/fail for custom quizzes', () => {
    const custom = buildQuiz(tech, { mode: 'custom', count: 10, subelements: ['T1'] }, seededRng(6));
    expect(scoreQuiz(tech, custom, []).passed).toBeUndefined();
  });
});
