// Request/response shapes for the Worker API (/api/*). Shared by the Worker and the front end.

import type { PoolId } from './pool.ts';
import type { QuizMode } from './quiz.ts';

export const NAME_MAX = 20;
export const JOIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** 32 symbols: digits and capitals without 0/O and 1/I, easy to read aloud. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;
export const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export interface CreateQuizRequest {
  pool: PoolId;
  mode: QuizMode;
  /** Custom quizzes only. */
  count?: number;
  /** Custom quizzes only: subelement ids, e.g. ["T5", "T6"]. */
  subelements?: string[];
  /** The creator's call sign or nickname. */
  name: string;
  /** Cloudflare Turnstile token from the "I'm human" check. */
  turnstileToken?: string;
}

export interface JoinRequest {
  name: string;
}

export interface ParticipantInfo {
  pid: string;
  name: string;
  joinedAt: number;
  finished: boolean;
  /** How many questions the server has an answer for (progress, e.g. "22/35"). */
  answered: number;
}

export interface QuizInfo {
  code: string;
  pool: PoolId;
  poolVersion: string;
  mode: QuizMode;
  items: string[];
  createdAt: number;
  /** When joining stops (7 days after creation) unless closed earlier. */
  closesAt: number;
  closedAt: number | null;
  /** True once the creator closed it or the join window ended. */
  closed: boolean;
  creatorPid: string | null;
  participants: ParticipantInfo[];
}

/** Returned by create and join. Keep `token` secret: it is the participant's identity. */
export interface JoinResponse {
  pid: string;
  token: string;
  name: string;
  quiz: QuizInfo;
}

/** Answers changed since the last sync; `i` is the question index, `choice` 0–3. */
export interface AnswersRequest {
  answers: { i: number; choice: number }[];
}

export interface AnswersResponse {
  saved: number;
}

/** Final submit: the full answer list (null = blank). */
export interface SubmitRequest {
  answers: (number | null)[];
}

export interface SubmitResponse {
  score: number;
  total: number;
  finishedAt: number;
  /** True when the server had already finalised this person (e.g. the quiz was closed). */
  alreadyFinished: boolean;
}

export interface LeaderRow {
  pid: string;
  name: string;
  finished: boolean;
  /** Answers the server has (progress for people still working). */
  answered: number;
  /** Server-recorded score; null until finished. */
  score: number | null;
  /** Time from joining to finishing; null until finished. */
  timeMs: number | null;
  /** Full exams only; null for custom quizzes or unfinished people. */
  passed: boolean | null;
}

/** How everyone who has submitted answered one question. */
export interface QuestionStat {
  i: number;
  id: string;
  /** Picks for A, B, C, D. */
  counts: [number, number, number, number];
  blank: number;
  correct: number;
}

export interface ResultsResponse {
  code: string;
  mode: QuizMode;
  total: number;
  /** Pass mark for full exams; null for custom quizzes. */
  passing: number | null;
  closed: boolean;
  /** Finished people (score desc, then faster time), then people still working. */
  leaderboard: LeaderRow[];
  /**
   * Per-question breakdown over finished participants. Only returned to a participant who has
   * submitted ("no peeking"); null otherwise.
   */
  breakdown: QuestionStat[] | null;
  finishedCount: number;
}

export type ApiErrorCode =
  | 'bad_request'
  | 'invalid_name'
  | 'name_taken'
  | 'not_found'
  | 'closed'
  | 'finished'
  | 'rate_limited'
  | 'bot_check'
  | 'unauthorized'
  | 'forbidden'
  | 'pool_mismatch'
  | 'server_error';

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
}

/** Trims and collapses whitespace; returns null when the name is not allowed. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  const len = [...name].length;
  if (len < 1 || len > NAME_MAX) return null;
  if (/[\p{Cc}\p{Cf}]/u.test(name)) return null; // control / invisible formatting characters
  return name;
}

/** Key used to reject duplicate names in a quiz (case- and width-insensitive). */
export function nameKey(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('en-US');
}
