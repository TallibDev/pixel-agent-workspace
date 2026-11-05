/**
 * Free time for characters whose agent is confirmed idle or waiting for the
 * user (upstream's `isActive === false`). Pure game logic: no AI calls, no
 * effect on what the office reports about the agent — the label always says
 * "Idle" first, the pastime second.
 *
 * Spots come from furniture already in the layout (coffee machine, sofas,
 * windows, bookshelves, plants, paintings) and from other idle characters
 * (a chat). Upstream's random wander stays as the fallback.
 */
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import type { Character, PlacedFurniture, Seat } from '../types.js';
import { Direction } from '../types.js';

export type LeisureActivity =
  'coffee' | 'sofa' | 'window' | 'reading' | 'plant' | 'painting' | 'chat';

export interface LeisureSpot {
  col: number;
  row: number;
  face: Direction;
  activity: LeisureActivity;
  /** Seat key `col,row` to unblock while pathing (sofa seats are furniture tiles). */
  seatKey?: string;
  /** For a chat: the character being visited. */
  partnerId?: number;
}

/** Live leisure state on a character (optional field, absent upstream). */
export interface CharacterLeisure {
  activity: LeisureActivity;
  face: Direction;
  sit: boolean;
  partnerId?: number;
  /** Set on arrival; until then the character is still walking there. */
  arrived: boolean;
}

export type LeisureCharacter = Character & { leisure?: CharacterLeisure | null };

const WEIGHT: Record<LeisureActivity, number> = {
  coffee: 3,
  sofa: 3,
  window: 3,
  chat: 2,
  reading: 2,
  plant: 1,
  painting: 1,
};
/** Weight of upstream's plain random stroll. */
const STROLL_WEIGHT = 1.5;

export const DWELL_SEC: Record<LeisureActivity, [number, number]> = {
  coffee: [6, 12],
  sofa: [12, 25],
  window: [8, 16],
  chat: [8, 14],
  reading: [10, 20],
  plant: [4, 8],
  painting: [4, 8],
};

function activityFor(type: string): LeisureActivity | null {
  const t = type.toUpperCase();
  if (t.includes('COFFEE') && !t.includes('TABLE')) return 'coffee';
  if (t.includes('WINDOW')) return 'window';
  if (t.includes('BOOKSHELF')) return 'reading';
  if (t.includes('PLANT') || t.includes('CACTUS')) return 'plant';
  if (t.includes('PAINTING')) return 'painting';
  return null;
}

const SOFA_TYPES = ['SOFA', 'CUSHIONED_BENCH', 'PAW_LOUNGE'];

function isSofaType(type: string): boolean {
  const t = type.toUpperCase();
  return SOFA_TYPES.some((s) => t.startsWith(s));
}

/** Direction a character standing at (col,row) must face to look at (tc,tr). */
function faceToward(col: number, row: number, tc: number, tr: number): Direction {
  if (tr < row) return Direction.UP;
  if (tr > row) return Direction.DOWN;
  return tc < col ? Direction.LEFT : Direction.RIGHT;
}

/**
 * Standing spots next to furniture and free sofa seats. `isFree(col,row)` is
 * true for a walkable, unblocked floor tile.
 */
export function computeSpots(
  furniture: readonly PlacedFurniture[],
  seats: ReadonlyMap<string, Seat>,
  isFree: (col: number, row: number) => boolean,
): LeisureSpot[] {
  const spots: LeisureSpot[] = [];
  const byUid = new Map(furniture.map((f) => [f.uid, f]));

  for (const item of furniture) {
    const activity = activityFor(item.type);
    if (!activity) continue;
    const entry = getCatalogEntry(item.type);
    const w = entry?.footprintW ?? 1;
    const h = entry?.footprintH ?? 1;
    // Prefer the tile in front (below), then the sides, then behind.
    const candidates: Array<[number, number]> = [];
    for (let dc = 0; dc < w; dc++) candidates.push([item.col + dc, item.row + h]);
    for (let dr = 0; dr < h; dr++) {
      candidates.push([item.col - 1, item.row + dr], [item.col + w, item.row + dr]);
    }
    for (let dc = 0; dc < w; dc++) candidates.push([item.col + dc, item.row - 1]);
    const found = candidates.find(([c, r]) => isFree(c, r));
    if (!found) continue;
    const [col, row] = found;
    const targetCol = Math.min(Math.max(col, item.col), item.col + w - 1);
    const targetRow = Math.min(Math.max(row, item.row), item.row + h - 1);
    spots.push({ col, row, activity, face: faceToward(col, row, targetCol, targetRow) });
  }

  for (const seat of seats.values()) {
    if (seat.assigned) continue;
    const item = byUid.get(seat.uid.split(':')[0]);
    if (!item || !isSofaType(item.type)) continue;
    spots.push({
      col: seat.seatCol,
      row: seat.seatRow,
      face: seat.facingDir,
      activity: 'sofa',
      seatKey: `${seat.seatCol},${seat.seatRow}`,
    });
  }
  return spots;
}

/** Free tile next to `partner` from which `ch` can face them. */
function chatSpot(
  partner: Character,
  isFree: (col: number, row: number) => boolean,
): LeisureSpot | null {
  const around: Array<[number, number]> = [
    [partner.tileCol + 1, partner.tileRow],
    [partner.tileCol - 1, partner.tileRow],
    [partner.tileCol, partner.tileRow + 1],
    [partner.tileCol, partner.tileRow - 1],
  ];
  const found = around.find(([c, r]) => isFree(c, r));
  if (!found) return null;
  const [col, row] = found;
  return {
    col,
    row,
    activity: 'chat',
    face: faceToward(col, row, partner.tileCol, partner.tileRow),
    partnerId: partner.id,
  };
}

/** A character counts as free for leisure only when its agent is not active. */
export function isLeisureEligible(ch: Character): boolean {
  return !ch.isActive && !ch.isSubagent && ch.matrixEffect === null;
}

export class LeisureDirector {
  private spots: LeisureSpot[] = [];
  private layoutKey: unknown = null;
  /** Spot key → character id that claimed it. */
  private readonly claims = new Map<string, number>();

  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** Recompute spots when the layout (or seat assignment) changed. */
  refresh(
    layoutKey: unknown,
    furniture: readonly PlacedFurniture[],
    seats: ReadonlyMap<string, Seat>,
    isFree: (col: number, row: number) => boolean,
  ): void {
    this.layoutKey = layoutKey;
    this.spots = computeSpots(furniture, seats, isFree);
    for (const [key] of this.claims) {
      if (!this.spots.some((s) => spotKey(s) === key)) this.claims.delete(key);
    }
  }

  isStale(layoutKey: unknown): boolean {
    return this.layoutKey !== layoutKey;
  }

  get spotCount(): number {
    return this.spots.length;
  }

  release(chId: number): void {
    for (const [key, id] of this.claims) if (id === chId) this.claims.delete(key);
  }

  /**
   * Pick a pastime for `ch`, or null for upstream's random stroll.
   * `others` are the other characters (for a chat partner).
   */
  pick(
    ch: Character,
    others: Iterable<Character>,
    isFree: (col: number, row: number) => boolean,
  ): LeisureSpot | null {
    this.release(ch.id);
    const options: Array<{ spot: LeisureSpot | null; weight: number }> = [
      { spot: null, weight: STROLL_WEIGHT },
    ];
    for (const s of this.spots) {
      const claimedBy = this.claims.get(spotKey(s));
      if (claimedBy !== undefined && claimedBy !== ch.id) continue;
      if (s.col === ch.tileCol && s.row === ch.tileRow) continue;
      options.push({ spot: s, weight: WEIGHT[s.activity] });
    }
    for (const other of others) {
      if (other.id === ch.id || !isLeisureEligible(other)) continue;
      if (other.path.length > 0) continue; // only visit someone standing still
      const s = chatSpot(other, isFree);
      if (s) options.push({ spot: s, weight: WEIGHT.chat });
    }
    const total = options.reduce((sum, o) => sum + o.weight, 0);
    let roll = this.random() * total;
    for (const o of options) {
      roll -= o.weight;
      if (roll <= 0) {
        if (o.spot) this.claims.set(spotKey(o.spot), ch.id);
        return o.spot;
      }
    }
    return null;
  }
}

function spotKey(s: LeisureSpot): string {
  return `${s.activity}:${s.col},${s.row}`;
}

export function dwellSeconds(
  activity: LeisureActivity,
  random: () => number = Math.random,
): number {
  const [min, max] = DWELL_SEC[activity];
  return min + random() * (max - min);
}

export function opposite(dir: Direction): Direction {
  switch (dir) {
    case Direction.UP:
      return Direction.DOWN;
    case Direction.DOWN:
      return Direction.UP;
    case Direction.LEFT:
      return Direction.RIGHT;
    default:
      return Direction.LEFT;
  }
}
