// Save slots in localStorage. Every access is guarded: storage can be missing (private
// windows, blocked site data) or full, and the game must still run without it.

export interface SlotInfo {
  slot: string;
  label: string;
  turn: number;
  nation: string;
  savedAt: string;
}

export const SLOT_NAMES = ['Slot 1', 'Slot 2', 'Slot 3'] as const;
/** Written after every resolved turn of a solo campaign; "Continue" picks it up. */
export const AUTOSAVE = 'Autosave';

const INDEX = 'brink.slots.v1';
const DATA = (slot: string) => `brink.save.v1.${slot}`;

export function listSlots(): SlotInfo[] {
  try {
    const raw = localStorage.getItem(INDEX);
    return raw ? (JSON.parse(raw) as SlotInfo[]) : [];
  } catch {
    return [];
  }
}

export function writeSlot(info: SlotInfo, text: string): boolean {
  try {
    localStorage.setItem(DATA(info.slot), text);
    const rest = listSlots().filter((s) => s.slot !== info.slot);
    localStorage.setItem(INDEX, JSON.stringify([...rest, info].sort((a, b) => a.slot.localeCompare(b.slot))));
    return true;
  } catch {
    return false;
  }
}

export function readSlot(slot: string): string | null {
  try {
    return localStorage.getItem(DATA(slot));
  } catch {
    return null;
  }
}

/** The most recently written slot, for "Continue". */
export function latestSlot(slots: readonly SlotInfo[]): SlotInfo | null {
  return slots.reduce<SlotInfo | null>((best, s) => (!best || s.savedAt > best.savedAt ? s : best), null);
}

const PREFS = 'brink.prefs.v1';

export interface Prefs {
  nation?: string;
  animate?: boolean;
  name?: string;
  /** The guided first match was finished or skipped. */
  tutorialDone?: boolean;
  muted?: boolean;
  /** Campaign length picked on the setup screen. */
  length?: 'quick' | 'standard';
}

export function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}

export function writePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...readPrefs(), ...p }));
  } catch {
    // Preferences are a convenience; losing them is fine.
  }
}
