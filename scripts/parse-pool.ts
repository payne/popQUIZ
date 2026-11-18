// Builds public/pools/<id>.json and public/figures/<fig>.png from the NCVEC .docx files in pools-src/.
// Usage: npm run pools
// Figures are trimmed and converted with ImageMagick (`magick`) when it is installed;
// otherwise the embedded images are copied as-is.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { readDocx, parsePool, type PoolMeta } from './pool-parser.ts';

const ROOT = new URL('..', import.meta.url).pathname;

export const POOLS: PoolMeta[] = [
  {
    id: 'tech',
    name: 'Technician',
    element: 2,
    version: '2026-2030',
    effective: { from: '2026-07-01', to: '2030-06-30' },
    examSize: 35,
    passing: 26,
    source: 'tech-2026.docx',
    figures: ['T-1', 'T-2', 'T-3'],
  },
  {
    id: 'general',
    name: 'General',
    element: 3,
    version: '2023-2027',
    effective: { from: '2023-07-01', to: '2027-06-30' },
    examSize: 35,
    passing: 26,
    source: 'general-2023.docx',
    figures: ['G7-1'],
  },
  {
    id: 'extra',
    name: 'Amateur Extra',
    element: 4,
    version: '2024-2028',
    effective: { from: '2024-07-01', to: '2028-06-30' },
    examSize: 50,
    passing: 37,
    source: 'extra-2024.docx',
    figures: ['E5-1', 'E6-1', 'E6-2', 'E6-3', 'E7-1', 'E7-2', 'E7-3', 'E9-1', 'E9-2', 'E9-3'],
  },
];

function hasMagick(): boolean {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const poolDir = join(ROOT, 'public/pools');
  const figDir = join(ROOT, 'public/figures');
  mkdirSync(poolDir, { recursive: true });
  mkdirSync(figDir, { recursive: true });
  const magick = hasMagick();
  if (!magick) console.warn('ImageMagick not found: copying figures without trimming');

  for (const meta of POOLS) {
    const docx = readDocx(readFileSync(join(ROOT, 'pools-src', meta.source)));
    const pool = parsePool(docx.paragraphs, meta);
    writeFileSync(join(poolDir, `${meta.id}.json`), JSON.stringify(pool));

    if (docx.media.length !== meta.figures.length) {
      throw new Error(`${meta.id}: ${docx.media.length} images in docx, expected ${meta.figures.length}`);
    }
    const tmp = mkdtempSync(join(tmpdir(), 'pq-fig-'));
    try {
      docx.media.forEach((m, i) => {
        const fig = meta.figures[i]!;
        const src = join(tmp, m.name);
        writeFileSync(src, m.data);
        if (magick) {
          // Trim the page whitespace around the drawing, keep a small margin, cap the width.
          execFileSync('magick', [src, '-trim', '+repage', '-bordercolor', 'white', '-border', '16', '-resize', '1200x1200>', '-strip', join(figDir, `${fig}.png`)]);
        } else {
          writeFileSync(join(figDir, `${fig}${extname(m.name)}`), m.data);
        }
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }

    const figs = pool.questions.filter((q) => q.fig).length;
    console.log(
      `${meta.id}: ${pool.questions.length} questions, ${pool.subelements.length} subelements, ` +
        `${pool.subelements.reduce((n, s) => n + s.groups.length, 0)} groups, ${pool.deleted.length} withdrawn, ${figs} with figures`,
    );
  }
}

main();
