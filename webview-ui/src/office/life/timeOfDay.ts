/**
 * Time of day for the office world: Day, Night or Auto (local clock).
 *
 * `nightness` is the single world parameter (0 = full day, 1 = full night).
 * The render loop calls `advanceWorldTime(dt)` every frame, which eases the
 * current value toward the target so switching modes or dusk/dawn in Auto
 * fade the lighting, the window views and the lamps smoothly.
 */
import { useSyncExternalStore } from 'react';

export type TimeMode = 'day' | 'night' | 'auto';
export const TIME_MODES: readonly TimeMode[] = ['day', 'night', 'auto'];

const STORAGE_KEY = 'paw.timeMode';
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const env = globalThis as { localStorage?: KeyValueStorage };

function loadMode(): TimeMode {
  try {
    const v = env.localStorage?.getItem(STORAGE_KEY);
    if (v === 'day' || v === 'night' || v === 'auto') return v;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

let mode: TimeMode = loadMode();
const listeners = new Set<() => void>();

export function getTimeMode(): TimeMode {
  return mode;
}

export function setTimeMode(next: TimeMode): void {
  if (next === mode) return;
  mode = next;
  try {
    env.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    /* applies for this page only */
  }
  for (const l of listeners) l();
}

export function useTimeMode(): TimeMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getTimeMode,
    getTimeMode,
  );
}

/**
 * Night amount for the local clock: full night 20:30–05:30, full day
 * 07:30–18:30, linear dawn and dusk in between.
 */
export function nightnessAt(date: Date): number {
  const h = date.getHours() + date.getMinutes() / 60;
  const ramp = (from: number, to: number, x: number) =>
    Math.min(1, Math.max(0, (x - from) / (to - from)));
  if (h < 5.5 || h >= 20.5) return 1;
  if (h < 7.5) return 1 - ramp(5.5, 7.5, h); // dawn
  if (h < 18.5) return 0;
  return ramp(18.5, 20.5, h); // dusk
}

export function targetNightness(m: TimeMode, date: Date): number {
  if (m === 'day') return 0;
  if (m === 'night') return 1;
  return nightnessAt(date);
}

/** Seconds for a full day↔night fade. */
export const TRANSITION_SEC = 2.2;

let current: number | null = null;

/** Ease the world toward its target; returns the current nightness. */
export function advanceWorldTime(dt: number, now: Date = new Date()): number {
  const target = targetNightness(mode, now);
  if (current === null) {
    current = target;
    return current;
  }
  const step = Math.max(0, dt) / TRANSITION_SEC;
  if (Math.abs(target - current) <= step) current = target;
  else current += Math.sign(target - current) * step;
  return current;
}

/** Last computed world nightness (for code outside the render loop). */
export function getWorldNightness(): number {
  return current ?? targetNightness(mode, new Date());
}

/** Furniture whose sprite follows the time of day: night type → day type. */
const DAY_VARIANTS: Record<string, string> = {
  PAW_WINDOW_CITY: 'PAW_WINDOW_CITY_DAY',
  PAW_WINDOW_CITY_B: 'PAW_WINDOW_CITY_B_DAY',
};

/** Type to render for `type` at the given nightness (switches at dusk midpoint). */
export function typeForTimeOfDay(type: string, nightness: number): string {
  if (nightness >= 0.5) return type;
  return DAY_VARIANTS[type] ?? type;
}
