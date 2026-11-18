import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { docxParagraphs, parsePool, type PoolMeta } from '../scripts/pool-parser.ts';
import type { Pool } from '../src/shared/pool.ts';

const meta: PoolMeta = {
  id: 'tech',
  name: 'Technician',
  element: 2,
  version: 'test',
  effective: { from: '2026-07-01', to: '2030-06-30' },
  examSize: 2,
  passing: 2,
  source: 'test.docx',
  figures: ['T-1', 'E7-3'],
};

// A tiny pool: an errata section that repeats a header (must be ignored), the syllabus, then the body.
const sample = [
  'Errata',
  'T1A01 – change the question to read:',
  'T1A01 (D) [97.1]',
  'SUBELEMENT T1 - IGNORED ERRATA COPY [9 Exam Questions - 9 Groups]',
  'FCC Element 2 Question Pool Syllabus',
  'SUBELEMENT T1 - COMMISSION’S RULES [2 Exam Questions - 2 Groups]  3 Questions',
  'T1A Purpose of the service',
  'T1B Frequency allocations',
  'SUBELEMENT T1 - COMMISSION’S RULES [2 Exam Questions - 2 Groups]',
  'T1A Purpose of the service',
  'T1A01 (C) [97.1]',
  'What is the purpose?',
  'A. One',
  'B. Two',
  'C. Three',
  'D. All these choices are correct',
  '~~',
  '',
  'T1A02 Question Deleted (section not renumbered)',
  '',
  'T1B01 (A)[97.301]',
  'What does component 1 in figure T-1 do?',
  'A. Resists',
  '',
  'B. Amplifies',
  'C. Rectifies',
  'D. Radiates',
  '~~',
  'T1B02 (B) ',
  'Using Figure E73 (sic), which is it?',
  'A. a',
  'B. b',
  'C. c',
  'D. d',
  '~~',
];

describe('parsePool', () => {
  const pool = parsePool(sample, meta);

  it('ignores the errata section before the syllabus', () => {
    expect(pool.questions.map((q) => q.id)).toEqual(['T1A01', 'T1B01', 'T1B02']);
    expect(pool.subelements).toHaveLength(1);
    expect(pool.subelements[0]!.title).toBe('Commission’s Rules');
  });

  it('reads groups from the syllabus', () => {
    expect(pool.subelements[0]!.groups).toEqual([
      { id: 'T1A', title: 'Purpose of the service' },
      { id: 'T1B', title: 'Frequency allocations' },
    ]);
  });

  it('keeps answers in official order with the correct index', () => {
    const q = pool.questions[0]!;
    expect(q.a).toEqual(['One', 'Two', 'Three', 'All these choices are correct']);
    expect(q.c).toBe(2);
    expect(q.ref).toBe('97.1');
    expect(q.group).toBe('T1A');
  });

  it('records withdrawn questions', () => {
    expect(pool.deleted).toEqual(['T1A02']);
  });

  it('detects figures, including the missing-hyphen typo', () => {
    expect(pool.questions[1]!.fig).toBe('T-1');
    expect(pool.questions[2]!.fig).toBe('E7-3');
    expect(pool.questions[0]!.fig).toBeUndefined();
  });

  it('rejects a syllabus whose group count does not match the exam size', () => {
    expect(() => parsePool(sample, { ...meta, examSize: 35 })).toThrow(/2 groups in syllabus, expected 35/);
  });

  it('rejects malformed answer blocks', () => {
    const broken = sample.map((l) => (l === 'C. Three' ? 'X. Three' : l));
    expect(() => parsePool(broken, meta)).toThrow(/T1A01: expected answer C/);
  });
});

describe('docxParagraphs', () => {
  it('joins runs, decodes entities, and normalises whitespace', () => {
    const xml =
      '<w:body><w:p><w:r><w:t>T1A01</w:t></w:r><w:r><w:t xml:space="preserve"> (C) </w:t></w:r></w:p>' +
      '<w:p/><w:p><w:r><w:t>A &amp; B&#8217;s</w:t><w:tab/><w:t>x</w:t></w:r></w:p></w:body>';
    expect(docxParagraphs(xml)).toEqual(['T1A01 (C)', '', 'A & B’s x']);
  });
});

describe('generated pools (public/pools/*.json)', () => {
  const expected = {
    tech: { examSize: 35, passing: 26, questions: 409 },
    general: { examSize: 35, passing: 26, questions: 423 },
    extra: { examSize: 50, passing: 37, questions: 599 },
  } as const;

  for (const [id, exp] of Object.entries(expected)) {
    describe(id, () => {
      const pool: Pool = JSON.parse(readFileSync(new URL(`../public/pools/${id}.json`, import.meta.url), 'utf8'));
      const groups = pool.subelements.flatMap((s) => s.groups.map((g) => g.id));

      it('has the expected size and pass mark', () => {
        expect(pool.examSize).toBe(exp.examSize);
        expect(pool.passing).toBe(exp.passing);
        expect(groups).toHaveLength(exp.examSize);
        expect(pool.questions).toHaveLength(exp.questions);
      });

      it('has well-formed, unique questions in every group', () => {
        const ids = new Set<string>();
        for (const q of pool.questions) {
          expect(ids.has(q.id)).toBe(false);
          ids.add(q.id);
          expect(q.a).toHaveLength(4);
          expect(q.c).toBeGreaterThanOrEqual(0);
          expect(q.c).toBeLessThan(4);
          expect(groups).toContain(q.group);
          expect(q.id.startsWith(q.group)).toBe(true);
        }
        for (const g of groups) expect(pool.questions.some((q) => q.group === g)).toBe(true);
      });

      it('excludes withdrawn questions', () => {
        for (const d of pool.deleted) expect(ids(pool)).not.toContain(d);
      });

      it('has an image for every referenced figure', () => {
        for (const q of pool.questions.filter((q) => q.fig)) {
          expect(existsSync(new URL(`../public/figures/${q.fig}.png`, import.meta.url)), q.fig).toBe(true);
        }
      });
    });
  }
});

const ids = (pool: Pool) => pool.questions.map((q) => q.id);
