import { describe, expect, it } from 'vitest';

import {
  createCharacter,
  type LeisureHooks,
  updateCharacter,
} from '../src/office/engine/characters.js';
import {
  computeSpots,
  isLeisureEligible,
  type LeisureCharacter,
  LeisureDirector,
} from '../src/office/life/leisure.js';
import type { PlacedFurniture, Seat } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

// 8×6 room of floor tiles.
const COLS = 8;
const ROWS = 6;
const tileMap = Array.from({ length: ROWS }, () =>
  Array.from({ length: COLS }, () => TileType.FLOOR_1),
);
const inRoom = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS;

describe('computeSpots', () => {
  it('stands in front of furniture and facing it', () => {
    const furniture: PlacedFurniture[] = [{ uid: 'c', type: 'COFFEE', col: 3, row: 0 }];
    const spots = computeSpots(furniture, new Map(), inRoom);
    expect(spots).toEqual([{ col: 3, row: 1, activity: 'coffee', face: Direction.UP }]);
  });

  it('turns free sofa seats into sitting spots, skipping assigned ones', () => {
    const furniture: PlacedFurniture[] = [{ uid: 's', type: 'SOFA_FRONT', col: 2, row: 4 }];
    const seats = new Map<string, Seat>([
      ['s', { uid: 's', seatCol: 2, seatRow: 4, facingDir: Direction.DOWN, assigned: false }],
      ['s:1', { uid: 's:1', seatCol: 3, seatRow: 4, facingDir: Direction.DOWN, assigned: true }],
    ]);
    const spots = computeSpots(furniture, seats, inRoom);
    expect(spots).toEqual([
      { col: 2, row: 4, face: Direction.DOWN, activity: 'sofa', seatKey: '2,4' },
    ]);
  });

  it('ignores furniture with no free tile around it', () => {
    const furniture: PlacedFurniture[] = [{ uid: 'b', type: 'BOOKSHELF', col: 0, row: 0 }];
    expect(computeSpots(furniture, new Map(), () => false)).toEqual([]);
  });
});

describe('LeisureDirector', () => {
  it('never hands the same spot to two characters', () => {
    const d = new LeisureDirector(() => 0.999); // always the last option
    const furniture: PlacedFurniture[] = [{ uid: 'c', type: 'COFFEE', col: 3, row: 0 }];
    d.refresh(1, furniture, new Map(), inRoom);
    const a = createCharacter(1, 0, null, null);
    const b = createCharacter(2, 0, null, null);
    a.isActive = false;
    b.isActive = false;
    b.path = [{ col: 0, row: 0 }]; // walking, so not a chat partner
    a.path = [{ col: 0, row: 0 }];
    expect(d.pick(a, [a, b], inRoom)?.activity).toBe('coffee');
    expect(d.pick(b, [a, b], inRoom)).toBeNull();
    d.release(1);
    expect(d.pick(b, [a, b], inRoom)?.activity).toBe('coffee');
  });

  it('only working-free characters are eligible', () => {
    const ch = createCharacter(1, 0, null, null);
    expect(isLeisureEligible(ch)).toBe(false); // new characters start active
    ch.isActive = false;
    expect(isLeisureEligible(ch)).toBe(true);
  });
});

describe('updateCharacter with leisure', () => {
  function run(ch: LeisureCharacter, hooks: LeisureHooks, seconds: number) {
    const walkable = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) walkable.push({ col: c, row: r });
    for (let t = 0; t < seconds; t += 0.05) {
      updateCharacter(ch, 0.05, walkable, new Map(), tileMap, new Set(), hooks);
    }
  }

  it('walks an idle character to the spot and drops it when work starts', () => {
    const ch = createCharacter(1, 0, null, null) as LeisureCharacter;
    ch.isActive = false;
    ch.state = CharacterState.IDLE;
    ch.wanderTimer = 0;
    let arrived = 0;
    const hooks: LeisureHooks = {
      pick: () => ({ col: 5, row: 3, face: Direction.UP, activity: 'window' }),
      arrive: (c) => {
        arrived++;
        const l = (c as LeisureCharacter).leisure!;
        l.arrived = true;
        c.dir = l.face;
        c.wanderTimer = 100;
      },
      release: () => {},
    };
    run(ch, hooks, 6);
    expect(arrived).toBe(1);
    expect([ch.tileCol, ch.tileRow]).toEqual([5, 3]);
    expect(ch.leisure?.activity).toBe('window');
    expect(ch.dir).toBe(Direction.UP);

    ch.isActive = true;
    run(ch, hooks, 0.1);
    expect(ch.leisure).toBeNull();
  });
});
