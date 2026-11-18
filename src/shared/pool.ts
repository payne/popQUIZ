// Shape of the generated question-pool JSON (public/pools/<id>.json).
// Shared by the build script, the front end, and the Worker.

export type PoolId = 'tech' | 'general' | 'extra';

export interface PoolQuestion {
  /** Official question id, e.g. "T1A01". */
  id: string;
  /** Group id, e.g. "T1A". A full exam takes one question from each group. */
  group: string;
  /** Question text. */
  q: string;
  /** Answers A–D, always in the official order. */
  a: [string, string, string, string];
  /** Index (0–3) of the correct answer. */
  c: number;
  /** FCC rule reference, e.g. "97.1", when the pool lists one. */
  ref?: string;
  /** Figure id, e.g. "T-1" → /figures/T-1.png. */
  fig?: string;
}

export interface PoolGroup {
  id: string;
  title: string;
}

export interface PoolSubelement {
  id: string;
  title: string;
  groups: PoolGroup[];
}

export interface Pool {
  id: PoolId;
  name: string;
  element: number;
  /** e.g. "2026-2030" */
  version: string;
  effective: { from: string; to: string };
  examSize: number;
  passing: number;
  source: string;
  subelements: PoolSubelement[];
  questions: PoolQuestion[];
  /** Ids withdrawn by NCVEC errata; never used. */
  deleted: string[];
}
