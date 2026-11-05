/**
 * Night lighting for the office (Canvas 2D, no extra engine).
 *
 * The scene is drawn as usual; this pass then lays a deep-violet darkness over
 * it, cuts soft holes where light sources are, and adds coloured glows on top
 * (additive). Light sources come from furniture types in the layout plus a
 * faint personal light on every character so nobody disappears in the dark.
 *
 * Cost: one offscreen fill plus one radial gradient per light per frame.
 */
import { LIGHT_COLOR, lightHoleColor, lightRgba, NIGHT_AMBIENT } from '../../constants.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import type { Character, PlacedFurniture, TileType as TileTypeVal } from '../types.js';
import { TILE_SIZE, TileType } from '../types.js';

export interface LightSource {
  /** Centre in office pixels (unzoomed). */
  x: number;
  y: number;
  /** Radius in tiles. */
  radius: number;
  color: string;
  /** Glow strength 0..1 (additive pass). */
  intensity: number;
  /** How much darkness it removes 0..1. */
  reveal: number;
  flicker?: number;
}

interface LightKind {
  match: (type: string) => boolean;
  color: string;
  radius: number;
  intensity: number;
  reveal: number;
  /** Light origin inside the footprint, as fractions of its pixel size. */
  ox: number;
  oy: number;
  flicker?: number;
}

const KINDS: LightKind[] = [
  {
    match: (t) => t.includes('DESK_LAMP'),
    color: LIGHT_COLOR.deskLamp,
    radius: 3.2,
    intensity: 0.5,
    reveal: 0.85,
    ox: 0.5,
    oy: 0.4,
  },
  {
    match: (t) => t.includes('FLOOR_LAMP'),
    color: LIGHT_COLOR.floorLamp,
    radius: 4.2,
    intensity: 0.5,
    reveal: 0.85,
    ox: 0.5,
    oy: 0.3,
  },
  {
    match: (t) => t.includes('NEON'),
    color: LIGHT_COLOR.neon,
    radius: 3.4,
    intensity: 0.42,
    reveal: 0.55,
    ox: 0.4,
    oy: 0.5,
    flicker: 0.06,
  },
  {
    match: (t) => t.includes('WINDOW'),
    color: LIGHT_COLOR.window,
    radius: 3.6,
    intensity: 0.28,
    reveal: 0.55,
    ox: 0.5,
    oy: 0.95,
  },
  {
    match: (t) => t.startsWith('PC') && t.includes('_ON'),
    color: LIGHT_COLOR.monitorOn,
    radius: 2.4,
    intensity: 0.45,
    reveal: 0.7,
    ox: 0.5,
    oy: 0.3,
    flicker: 0.04,
  },
  {
    match: (t) => t.startsWith('PC'),
    color: LIGHT_COLOR.monitorIdle,
    radius: 1.6,
    intensity: 0.18,
    reveal: 0.4,
    ox: 0.5,
    oy: 0.3,
  },
  {
    match: (t) => t.includes('COFFEE_MACHINE'),
    color: LIGHT_COLOR.coffeeMachine,
    radius: 2,
    intensity: 0.3,
    reveal: 0.5,
    ox: 0.5,
    oy: 0.3,
  },
  {
    match: (t) => t.includes('FRIDGE'),
    color: LIGHT_COLOR.fridge,
    radius: 1.4,
    intensity: 0.14,
    reveal: 0.35,
    ox: 0.5,
    oy: 0.5,
  },
];

export interface NightSettings {
  /** 0 = no darkness (day), 1 = full night. */
  strength: number;
  /** Darkness colour. */
  ambient: string;
}

export const DEFAULT_NIGHT: NightSettings = { strength: 1, ambient: NIGHT_AMBIENT };

/** Light sources for a layout. The furniture list may contain animated on-state
 *  types (PC_FRONT_ON_2 …); pass the rendered types so monitors glow while used. */
export function collectLights(
  furniture: readonly Pick<PlacedFurniture, 'type' | 'col' | 'row'>[],
  characters: readonly Character[],
): LightSource[] {
  const lights: LightSource[] = [];
  for (const f of furniture) {
    const type = f.type.toUpperCase();
    const kind = KINDS.find((k) => k.match(type));
    if (!kind) continue;
    const entry = getCatalogEntry(f.type);
    const w = (entry?.footprintW ?? 1) * TILE_SIZE;
    const h = (entry?.footprintH ?? 1) * TILE_SIZE;
    lights.push({
      x: f.col * TILE_SIZE + w * kind.ox,
      y: f.row * TILE_SIZE + h * kind.oy,
      radius: kind.radius,
      color: kind.color,
      intensity: kind.intensity,
      reveal: kind.reveal,
      flicker: kind.flicker,
    });
  }
  for (const ch of characters) {
    if (ch.matrixEffect === 'despawn') continue;
    lights.push({
      x: ch.x,
      y: ch.y - TILE_SIZE * 0.6,
      radius: 1.5,
      color: LIGHT_COLOR.person,
      intensity: 0.08,
      reveal: 0.45,
    });
  }
  return lights;
}

let darkCanvas: HTMLCanvasElement | null = null;

/** Draw the night pass over an already rendered frame. */
export function renderLighting(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  lights: readonly LightSource[],
  night: NightSettings = DEFAULT_NIGHT,
  timeSec = 0,
  tileMap?: TileTypeVal[][],
): void {
  if (night.strength <= 0 || width <= 0 || height <= 0) return;
  if (!darkCanvas) darkCanvas = document.createElement('canvas');
  if (darkCanvas.width !== width || darkCanvas.height !== height) {
    darkCanvas.width = width;
    darkCanvas.height = height;
  }
  const dc = darkCanvas.getContext('2d');
  if (!dc) return;

  // 1. Darkness with soft holes.
  dc.globalCompositeOperation = 'source-over';
  dc.clearRect(0, 0, width, height);
  dc.fillStyle = night.ambient;
  dc.fillRect(0, 0, width, height);
  dc.globalCompositeOperation = 'destination-out';
  for (const l of lights) {
    const x = offsetX + l.x * zoom;
    const y = offsetY + l.y * zoom;
    const r = l.radius * TILE_SIZE * zoom;
    const g = dc.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, lightHoleColor(l.reveal));
    g.addColorStop(0.55, lightHoleColor(l.reveal * 0.45));
    g.addColorStop(1, lightHoleColor(0));
    dc.fillStyle = g;
    dc.fillRect(x - r, y - r, r * 2, r * 2);
  }

  ctx.save();
  // Light stays inside the office: clip to every non-void tile.
  if (tileMap) {
    const s = TILE_SIZE * zoom;
    const clip = new Path2D();
    for (let r = 0; r < tileMap.length; r++) {
      const row = tileMap[r];
      let start = -1;
      for (let c = 0; c <= row.length; c++) {
        const inside = c < row.length && row[c] !== TileType.VOID;
        if (inside && start < 0) start = c;
        if (!inside && start >= 0) {
          clip.rect(offsetX + start * s, offsetY + r * s - s, (c - start) * s, s * 2);
          start = -1;
        }
      }
    }
    ctx.clip(clip);
  }
  ctx.globalAlpha = night.strength;
  ctx.drawImage(darkCanvas, 0, 0);

  // 2. Coloured glow (additive).
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    const flicker = l.flicker ? 1 - l.flicker + l.flicker * Math.sin(timeSec * 7 + i * 1.7) : 1;
    const a = l.intensity * flicker * night.strength;
    if (a <= 0.01) continue;
    const x = offsetX + l.x * zoom;
    const y = offsetY + l.y * zoom;
    const r = l.radius * TILE_SIZE * zoom * 0.85;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, lightRgba(l.color, a));
    g.addColorStop(1, lightRgba(l.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}
