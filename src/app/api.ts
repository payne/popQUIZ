import type {
  AnswersResponse,
  ApiErrorBody,
  ApiErrorCode,
  CreateQuizRequest,
  JoinResponse,
  QuizInfo,
  ResultsResponse,
  SubmitResponse,
} from '../shared/api.ts';
import type { Answer } from '../shared/quiz.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'offline',
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'offline', 'No connection — check your signal and try again.');
  }
  const data = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const err = data as ApiErrorBody | null;
    throw new ApiError(res.status, err?.code ?? 'server_error', err?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  createQuiz: (req: CreateQuizRequest) => request<JoinResponse>('POST', '/quizzes', req),
  getQuiz: (code: string) => request<QuizInfo>('GET', `/quizzes/${code}`),
  join: (code: string, name: string) => request<JoinResponse>('POST', `/quizzes/${code}/participants`, { name }),
  close: (code: string, token: string) => request<QuizInfo>('POST', `/quizzes/${code}/close`, undefined, token),
  saveAnswers: (code: string, token: string, answers: { i: number; choice: number }[]) =>
    request<AnswersResponse>('PUT', `/quizzes/${code}/answers`, { answers }, token),
  /** Leaderboard for anyone; with a submitted participant's token, also the per-question breakdown. */
  results: (code: string, token?: string) => request<ResultsResponse>('GET', `/quizzes/${code}/results`, undefined, token),
  submit: (code: string, token: string, answers: Answer[]) =>
    request<SubmitResponse>('POST', `/quizzes/${code}/submit`, { answers }, token),
};
