import { useSyncExternalStore } from 'react';

// Phones (and a phone on its side) get their own game screen: a full-bleed map, a thumb dock and
// sheets, instead of the desktop's rails and floating panels.

const QUERY = '(max-width: 760px), (max-height: 500px) and (pointer: coarse)';

function subscribe(cb: () => void): () => void {
  const m = window.matchMedia(QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

export function isPhone(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(QUERY).matches;
}

export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, isPhone, () => false);
}
