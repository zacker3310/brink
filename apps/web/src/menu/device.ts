import { readSettings, type Motion } from '../arena/quality';

// Device-level front-door plumbing: Brink's own motion setting on the page root, and the browser's
// install prompt kept for the Settings screen.

/** Reduced or no motion: the menus and coach drop their animations (front.css), the title stills. */
export function applyMotion(m: Motion = readSettings().motion): void {
  if (typeof document === 'undefined') return;
  if (m === 'full') delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = 'reduced';
}

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    for (const l of listeners) l();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    for (const l of listeners) l();
  });
}

export type InstallState = 'installed' | 'prompt' | 'ios' | 'unavailable';

export function installState(): InstallState {
  if (typeof window === 'undefined') return 'unavailable';
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return 'installed';
  if (deferred) return 'prompt';
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'ios';
  return 'unavailable';
}

export function onInstallChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function install(): Promise<boolean> {
  if (!deferred) return false;
  const p = deferred;
  deferred = null;
  await p.prompt();
  const r = await p.userChoice;
  for (const l of listeners) l();
  return r.outcome === 'accepted';
}
