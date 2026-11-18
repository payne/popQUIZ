import type { Pool, PoolQuestion } from '../../shared/pool.ts';

/**
 * HamStudy.org explanation page for a question. HamStudy has one page per
 * question group (e.g. /browse/tech2026/T5B) with an anchor per question.
 * The pool code is the pool id plus the year it took effect.
 */
export function explainUrl(pool: Pool, q: PoolQuestion): string {
  const year = pool.effective.from.slice(0, 4);
  return `https://hamstudy.org/browse/${pool.id}${year}/${q.group}#${q.id}`;
}

/** The question's official id, linking to its explanation in a new tab. */
export function QuestionId({ pool, q, class: cls = 'muted' }: { pool: Pool; q: PoolQuestion; class?: string }) {
  return (
    <a
      class={`qid-link ${cls}`}
      href={explainUrl(pool, q)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Explanation of ${q.id} on HamStudy.org (opens in a new tab)`}
    >
      {q.id}
    </a>
  );
}
