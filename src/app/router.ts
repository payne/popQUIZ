// Routes: "/" (home), "/about", "/usage", and "/<CODE>" (a quiz). Share links are pq.n3pay.net/<CODE>.

import { useEffect, useState } from 'preact/hooks';
import { CODE_RE } from '../shared/api.ts';

const EVENT = 'pq:navigate';

export function navigate(path: string, replace = false): void {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  dispatchEvent(new Event(EVENT));
  scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    addEventListener('popstate', update);
    addEventListener(EVENT, update);
    return () => {
      removeEventListener('popstate', update);
      removeEventListener(EVENT, update);
    };
  }, []);
  return path;
}

/** "/k7xm2p" → "K7XM2P"; null for "/" or anything that isn't a quiz code. */
export function codeFromPath(path: string): string | null {
  const code = path.replace(/^\/+|\/+$/g, '').toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export const shareUrl = (code: string) => `${location.origin}/${code}`;
