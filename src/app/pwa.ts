// Service worker registration, update prompt, install prompt, online status,
// and the ☰ menu's "Reload app" / "Reset everything" actions.

import { useEffect, useState } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';
import { clearAppStorage } from './storage.ts';

export interface PwaState {
  /** A new version is waiting; shown as a toast. Never applied automatically. */
  needRefresh: boolean;
  /** The browser offered an install prompt (Chrome/Edge/Android). */
  canInstall: boolean;
  /** Running as an installed app. */
  installed: boolean;
  online: boolean;
}

export const isIOS =
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let state: PwaState = {
  needRefresh: false,
  canInstall: false,
  installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  online: navigator.onLine,
};
const listeners = new Set<(s: PwaState) => void>();
function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function usePwa(): PwaState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    return () => void listeners.delete(setS);
  }, []);
  return s;
}

let updateSW: ((reload?: boolean) => Promise<void>) | undefined;
let installEvent: BeforeInstallPromptEvent | undefined;

export function initPwa(): void {
  updateSW = registerSW({
    onNeedRefresh: () => set({ needRefresh: true }),
  });
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // no automatic mini-infobar; offered from the ☰ menu instead
    installEvent = e as BeforeInstallPromptEvent;
    set({ canInstall: true });
  });
  addEventListener('appinstalled', () => {
    installEvent = undefined;
    set({ canInstall: false, installed: true });
  });
  addEventListener('online', () => set({ online: true }));
  addEventListener('offline', () => set({ online: false }));
}

export function dismissUpdate(): void {
  set({ needRefresh: false });
}

/** User chose "Reload" on the update toast: activate the waiting service worker and reload. */
export async function applyUpdate(): Promise<void> {
  if (updateSW) await updateSW(true);
  else location.reload();
}

export async function promptInstall(): Promise<void> {
  if (!installEvent) return;
  await installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = undefined;
  set({ canInstall: false, installed: outcome === 'accepted' || state.installed });
}

/**
 * "Reload app": unregister the service worker, delete every cache, and reload from the network.
 * Keeps localStorage (quiz progress, names, settings). Callers must check `online` first.
 */
export async function reloadApp(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* no service worker support */
  }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* no Cache Storage */
  }
  location.reload();
}

/** "Reset everything": like a first visit — also clears all saved progress. */
export async function resetEverything(): Promise<void> {
  clearAppStorage();
  await reloadApp();
}
