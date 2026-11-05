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
  /** Windows: by day they cast sun shafts of this width (office pixels). */
  sunWidth?: number;
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
  sun?: boolean;
}

const KINDS: LightKind[] = [
  {
    match: (t) => t.includes('DESK_LAMP') || t.includes('LANTERN'),
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
    sun: true,
  },
  {
    match: (t) => (t.startsWith('PC') || t.includes('MONITOR')) && t.includes('_ON'),
    color: LIGHT_COLOR.monitorOn,
    radius: 2.4,
    intensity: 0.45,
    reveal: 0.7,
    ox: 0.5,
    oy: 0.3,
    flicker: 0.04,
  },
  {
    match: (t) => t.startsWith('PC') || t.includes('MONITOR'),
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
      sunWidth: kind.sun ? w : undefined,
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

/**
 * Draw the time-of-day pass over an already rendered frame.
 * `nightness`: 0 = full day (sun shafts, lamps off), 1 = full night.
 */
export function renderLighting(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  lights: readonly LightSource[],
  nightness = 1,
  timeSec = 0,
  tileMap?: TileTypeVal[][],
): void {
  if (width <= 0 || height <= 0) return;
  const day = 1 - nightness;
  ctx.save();
  if (tileMap) ctx.clip(officeClip(tileMap, offsetX, offsetY, zoom));
  if (day > 0.01) renderDaylight(ctx, width, height, offsetX, offsetY, zoom, lights, day);
  // Dusk and dawn: a warm cast strongest half-way through the change.
  const dusk = Math.sin(Math.PI * Math.min(1, Math.max(0, nightness)));
  if (dusk > 0.02) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = lightRgba(LIGHT_COLOR.dusk, 0.12 * dusk);
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
  if (nightness <= 0.01) return;
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
  dc.fillStyle = NIGHT_AMBIENT;
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
  if (tileMap) ctx.clip(officeClip(tileMap, offsetX, offsetY, zoom));
  ctx.globalAlpha = nightness;
  ctx.drawImage(darkCanvas, 0, 0);

  // 2. Coloured glow (additive).
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    const flicker = l.flicker ? 1 - l.flicker + l.flicker * Math.sin(timeSec * 7 + i * 1.7) : 1;
    const a = l.intensity * flicker * nightness;
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

/** Path covering every non-void tile (plus the wall sprites' extra row above). */
function officeClip(
  tileMap: TileTypeVal[][],
  offsetX: number,
  offsetY: number,
  zoom: number,
): Path2D {
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
  return clip;
}

/** Daylight: a soft warm wash and sun shafts falling from every window. */
function renderDaylight(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  lights: readonly LightSource[],
  day: number,
): void {
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = lightRgba(LIGHT_COLOR.daylight, 0.06 * day);
  ctx.fillRect(0, 0, width, height);
  const t = TILE_SIZE * zoom;
  for (const l of lights) {
    if (!l.sunWidth) continue;
    const w = l.sunWidth * zoom;
    const x0 = offsetX + l.x * zoom - w / 2;
    const y0 = offsetY + l.y * zoom;
    const len = 4.5 * t;
    const slant = 1.2 * t; // afternoon sun from the upper left
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, lightRgba(LIGHT_COLOR.sun, 0.26 * day));
    g.addColorStop(1, lightRgba(LIGHT_COLOR.sun, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.1 * w, y0);
    ctx.lineTo(x0 + 0.9 * w, y0);
    ctx.lineTo(x0 + 0.9 * w + slant, y0 + len);
    ctx.lineTo(x0 + 0.1 * w + slant, y0 + len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
