// Cloudflare Turnstile ("I'm human" check) for creating a quiz. Usually invisible
// (appearance: interaction-only); it only shows a checkbox when Cloudflare is unsure.

import { useEffect, useRef } from 'preact/hooks';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY;

let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile failed to load')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Turnstile failed to load'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

interface TurnstileProps {
  onToken: (token: string | null) => void;
  onError: (message: string) => void;
  /** Change this value to get a fresh token (tokens are single-use). */
  resetKey: number;
}

export function Turnstile({ onToken, onError, resetKey }: TurnstileProps) {
  const el = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const cbs = useRef({ onToken, onError });
  cbs.current = { onToken, onError };

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let gone = false;
    loadTurnstile()
      .then((t) => {
        if (gone || !el.current) return;
        id.current = t.render(el.current, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: 'interaction-only',
          action: 'create-quiz',
          theme: 'auto',
          callback: (token: string) => cbs.current.onToken(token),
          'expired-callback': () => cbs.current.onToken(null),
          'error-callback': () => {
            cbs.current.onToken(null);
            cbs.current.onError('The “I’m human” check couldn’t run. Check your connection and try again.');
          },
        });
      })
      .catch(() => cbs.current.onError('The “I’m human” check couldn’t load. Check your connection and try again.'));
    return () => {
      gone = true;
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetKey && id.current) {
      cbs.current.onToken(null);
      window.turnstile?.reset(id.current);
    }
  }, [resetKey]);

  return <div ref={el} class="turnstile" />;
}
