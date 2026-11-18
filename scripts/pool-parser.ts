// Turns the paragraph text of an NCVEC question-pool .docx into a Pool.
// Pure functions only (no file IO) so they can be unit tested.

import { unzipSync, strFromU8 } from 'fflate';
import type { Pool, PoolGroup, PoolId, PoolQuestion, PoolSubelement } from '../src/shared/pool.ts';

export interface PoolMeta {
  id: PoolId;
  name: string;
  element: number;
  version: string;
  effective: { from: string; to: string };
  examSize: number;
  passing: number;
  source: string;
  /** Figure ids in the order their images appear in word/media (image1, image2, …). */
  figures: string[];
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return XML_ENTITIES[e] ?? m;
  });
}

/** Normalise whitespace (incl. non-breaking spaces and tabs) and trim. */
export function clean(s: string): string {
  return s.replace(/[ \t\s]+/g, ' ').trim();
}

/** Extracts the plain text of every paragraph in word/document.xml. */
export function docxParagraphs(documentXml: string): string[] {
  const out: string[] = [];
  for (const p of documentXml.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? []) {
    let text = '';
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>/g)) {
      text += m[1] === undefined ? ' ' : decodeXml(m[1]);
    }
    out.push(clean(text));
  }
  return out;
}

export interface DocxContents {
  paragraphs: string[];
  /** word/media files sorted by their number: image1, image2, … */
  media: { name: string; data: Uint8Array }[];
}

export function readDocx(bytes: Uint8Array): DocxContents {
  const files = unzipSync(bytes);
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('word/document.xml not found');
  const media = Object.entries(files)
    .filter(([n]) => n.startsWith('word/media/'))
    .map(([n, data]) => ({ name: n.slice('word/media/'.length), data }))
    .sort((a, b) => num(a.name) - num(b.name));
  return { paragraphs: docxParagraphs(strFromU8(doc)), media };
}

const num = (name: string) => Number(name.match(/\d+/)?.[0] ?? 0);

const HEADER = /^([TGE]\d[A-Z])(\d{2})\s*\(([A-D])\)\s*(?:\[([^\]]*)\])?\s*$/;
const DELETED = /^([TGE]\d[A-Z]\d{2})\s+Question Deleted/i;
const ANSWER = /^([A-D])\.\s*(.*)$/;
const SUBELEMENT = /^SUBELEMENT ([TGE]\d)\s*[-–]\s*(.+?)[\s\-–]*\[/;
const GROUP = /^([TGE]\d[A-Z])\s+(\S.*)$/;
// Allows a missing hyphen: the Extra pool has typos "Figure E73" / "Figure E92".
const FIGURE = /\bfigure ([TGE]\d?)-?(\d+)\b/i;

export function parsePool(paragraphs: string[], meta: PoolMeta): Pool {
  const subelements: PoolSubelement[] = [];
  const subById = new Map<string, PoolSubelement>();
  const groupIds = new Set<string>();
  const questions: PoolQuestion[] = [];
  const deleted: string[] = [];
  const seen = new Set<string>();

  // The errata summary at the top of each file repeats some question headers and SUBELEMENT
  // lines; the pool proper starts at the "FCC Element N Question Pool Syllabus" heading.
  const start = paragraphs.findIndex((p) => /^FCC Element \d Question Pool Syllabus/i.test(p));
  if (start < 0) throw new Error(`${meta.id}: syllabus heading not found`);

  for (let i = start; i < paragraphs.length; i++) {
    const line = paragraphs[i]!;

    const sub = line.match(SUBELEMENT);
    if (sub) {
      const [, id, title] = sub as unknown as [string, string, string];
      if (!subById.has(id)) {
        const s: PoolSubelement = { id, title: titleCase(title), groups: [] };
        subById.set(id, s);
        subelements.push(s);
      }
      continue;
    }

    const del = line.match(DELETED);
    if (del) {
      if (!deleted.includes(del[1]!)) deleted.push(del[1]!);
      continue;
    }

    const head = line.match(HEADER);
    if (head) {
      const [, group, n, letter, ref] = head as unknown as [string, string, string, string, string | undefined];
      const id = group + n;
      if (seen.has(id)) throw new Error(`${id}: duplicate question`);
      seen.add(id);

      // Question text runs until the "A." line; answers A–D follow; "~~" ends the block.
      const textParts: string[] = [];
      let j = i + 1;
      while (j < paragraphs.length && !/^A\./.test(paragraphs[j]!)) {
        if (paragraphs[j]) textParts.push(paragraphs[j]!);
        j++;
      }
      const answers: string[] = [];
      for (const expected of ['A', 'B', 'C', 'D']) {
        while (j < paragraphs.length && paragraphs[j] === '') j++;
        const m = paragraphs[j]?.match(ANSWER);
        if (!m || m[1] !== expected) throw new Error(`${id}: expected answer ${expected}, got ${JSON.stringify(paragraphs[j])}`);
        answers.push(m[2]!);
        j++;
      }
      while (j < paragraphs.length && paragraphs[j] === '') j++;
      if (paragraphs[j] !== '~~') throw new Error(`${id}: expected "~~" after answers, got ${JSON.stringify(paragraphs[j])}`);

      const q = textParts.join(' ');
      if (!q) throw new Error(`${id}: empty question text`);
      if (answers.some((a) => !a)) throw new Error(`${id}: empty answer`);
      const figMatch = q.match(FIGURE);
      const fig = figMatch ? `${figMatch[1]}-${figMatch[2]}` : undefined;
      const question: PoolQuestion = {
        id,
        group,
        q,
        a: answers as PoolQuestion['a'],
        c: 'ABCD'.indexOf(letter),
      };
      if (ref?.trim()) question.ref = ref.trim();
      if (fig) question.fig = fig.toUpperCase();
      questions.push(question);
      i = j;
      continue;
    }

    // Group lines ("T1A Purpose and …") appear in the syllabus before any questions.
    const grp = line.match(GROUP);
    if (grp && questions.length === 0) {
      const [, id, title] = grp as unknown as [string, string, string];
      const s = subById.get(id.slice(0, 2));
      if (s && !groupIds.has(id)) {
        groupIds.add(id);
        s.groups.push({ id, title } satisfies PoolGroup);
      }
    }
  }

  const pool: Pool = {
    id: meta.id,
    name: meta.name,
    element: meta.element,
    version: meta.version,
    effective: meta.effective,
    examSize: meta.examSize,
    passing: meta.passing,
    source: meta.source,
    subelements,
    questions: questions.filter((q) => !deleted.includes(q.id)),
    deleted,
  };
  validatePool(pool, meta);
  return pool;
}

/** "COMMISSION’S RULES" → "Commission’s Rules" */
function titleCase(s: string): string {
  const small = new Set(['and', 'or', 'of', 'the', 'to', 'in', 'for', 'a', 'an', 'on']);
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w) ? w : w.replace(/^\p{L}/u, (c) => c.toUpperCase())))
    .join(' ')
    .replace(/\b(Rf|Ac|Dc|Fcc|Hf|Vhf|Uhf)\b/g, (m) => m.toUpperCase());
}

export function validatePool(pool: Pool, meta: Pick<PoolMeta, 'examSize' | 'figures'>): void {
  const groups = pool.subelements.flatMap((s) => s.groups.map((g) => g.id));
  if (groups.length !== meta.examSize) {
    throw new Error(`${pool.id}: ${groups.length} groups in syllabus, expected ${meta.examSize} (one exam question per group)`);
  }
  const groupSet = new Set(groups);
  for (const q of pool.questions) {
    if (!groupSet.has(q.group)) throw new Error(`${q.id}: group ${q.group} not in syllabus`);
    if (q.fig && !meta.figures.includes(q.fig)) throw new Error(`${q.id}: unknown figure ${q.fig}`);
  }
  for (const g of groups) {
    if (!pool.questions.some((q) => q.group === g)) throw new Error(`${pool.id}: group ${g} has no questions`);
  }
}
