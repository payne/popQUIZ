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
}

export interface JoinRequest {
  name: string;
}

export interface ParticipantInfo {
  pid: string;
  name: string;
  joinedAt: number;
  finished: boolean;
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

export type ApiErrorCode =
  | 'bad_request'
  | 'invalid_name'
  | 'name_taken'
  | 'not_found'
  | 'closed'
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
