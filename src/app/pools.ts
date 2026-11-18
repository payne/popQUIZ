import type { Pool, PoolId } from '../shared/pool.ts';

export const POOL_CHOICES: { id: PoolId; name: string; element: number; version: string; examSize: number; passing: number }[] = [
  { id: 'tech', name: 'Technician', element: 2, version: '2026–2030', examSize: 35, passing: 26 },
  { id: 'general', name: 'General', element: 3, version: '2023–2027', examSize: 35, passing: 26 },
  { id: 'extra', name: 'Amateur Extra', element: 4, version: '2024–2028', examSize: 50, passing: 37 },
];

const cache = new Map<PoolId, Promise<Pool>>();

/** Fetches /pools/<id>.json once per page load (served from the service-worker precache when offline). */
export function loadPool(id: PoolId): Promise<Pool> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/pools/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`Could not load the ${id} question pool (${r.status})`);
      return r.json() as Promise<Pool>;
    });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}
