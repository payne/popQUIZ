// Anonymous usage counts: a random id per device (localStorage) and one "open" ping per session.
// The server only stores a hash of the id; nothing here identifies a person.

import { getString, setString } from './storage.ts';

const DEVICE_KEY = 'pq:device';
const LAST_OPEN_KEY = 'pq:last-open';
/** Opening the app again within this long counts as the same session. */
const SESSION_GAP_MS = 30 * 60 * 1000;

let memoryId: string | null = null;

/** This device's random id, created on first use. Falls back to a per-page-load id if storage is blocked. */
export function deviceId(): string {
  const stored = getString(DEVICE_KEY);
  if (stored) return stored;
  const id = memoryId ?? crypto.randomUUID().replace(/-/g, '');
  setString(DEVICE_KEY, id);
  memoryId = id;
  return id;
}

/** Records an app session, at most once per SESSION_GAP_MS. Silent on failure (offline, rate limited). */
export async function recordOpen(now = Date.now()): Promise<void> {
  const last = Number(getString(LAST_OPEN_KEY) ?? 0);
  if (now - last < SESSION_GAP_MS) return;
  setString(LAST_OPEN_KEY, String(now));
  try {
    const res = await fetch('/api/usage/open', { method: 'POST', headers: { 'X-PQ-Device': deviceId() } });
    if (!res.ok) setString(LAST_OPEN_KEY, String(last));
  } catch {
    setString(LAST_OPEN_KEY, String(last)); // offline: try again next time
  }
}
