// localStorage wrappers that never throw (private mode, blocked storage, quota).
// All keys used by the app start with "pq:".

export function getJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function setJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the app still works for this page load */
  }
}

export function getString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setString(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Removes every "pq:" key (used by "Reset everything"). */
export function clearAppStorage(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('pq:')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
