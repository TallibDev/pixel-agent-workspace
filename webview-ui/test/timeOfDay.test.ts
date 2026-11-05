import { describe, expect, it } from 'vitest';

import {
  advanceWorldTime,
  getTimeMode,
  nightnessAt,
  setTimeMode,
  targetNightness,
  TRANSITION_SEC,
  typeForTimeOfDay,
} from '../src/office/life/timeOfDay.js';

const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m);

describe('nightnessAt (Auto)', () => {
  it('is full night late, full day midday, and ramps at dawn and dusk', () => {
    expect(nightnessAt(at(2))).toBe(1);
    expect(nightnessAt(at(23))).toBe(1);
    expect(nightnessAt(at(12))).toBe(0);
    expect(nightnessAt(at(6, 30))).toBeCloseTo(0.5, 5);
    expect(nightnessAt(at(19, 30))).toBeCloseTo(0.5, 5);
  });
});

describe('targetNightness', () => {
  it('fixes day and night, follows the clock in auto', () => {
    expect(targetNightness('day', at(23))).toBe(0);
    expect(targetNightness('night', at(12))).toBe(1);
    expect(targetNightness('auto', at(12))).toBe(0);
  });
});

describe('advanceWorldTime', () => {
  it('eases toward the target instead of jumping', () => {
    setTimeMode('night');
    advanceWorldTime(10, at(12)); // settle at night
    setTimeMode('day');
    const half = advanceWorldTime(TRANSITION_SEC / 2, at(12));
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    expect(advanceWorldTime(TRANSITION_SEC, at(12))).toBe(0);
    expect(getTimeMode()).toBe('day');
  });
});

describe('typeForTimeOfDay', () => {
  it('swaps window views at the midpoint only', () => {
    expect(typeForTimeOfDay('PAW_WINDOW_CITY', 0.2)).toBe('PAW_WINDOW_CITY_DAY');
    expect(typeForTimeOfDay('PAW_WINDOW_CITY', 0.8)).toBe('PAW_WINDOW_CITY');
    expect(typeForTimeOfDay('DESK_FRONT', 0)).toBe('DESK_FRONT');
  });
});
