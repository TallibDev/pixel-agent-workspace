#!/usr/bin/env node
/**
 * Builds the Pixel Agent Workspace night office (default-layout-2.json) from
 * upstream's default layout: night palette for floors and walls, big windows
 * onto the city, a neon sign, desk and floor lamps, a kitchen with a coffee
 * machine, and a violet lounge. The server picks the highest-numbered default.
 *
 * Run: node scripts/paw-art/build-night-layout.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = path.join(ROOT, 'webview-ui/public/assets');
const base = JSON.parse(fs.readFileSync(path.join(ASSETS, 'default-layout-1.json'), 'utf8'));

const COLORS = {
  0: { h: 268, s: 34, b: -72, c: -40 }, // walls: deep plum
  7: { h: 22, s: 42, b: -52, c: -70 }, // work room: dark warm wood
  1: { h: 262, s: 42, b: -46, c: -72 }, // lounge: violet
  9: { h: 266, s: 12, b: -36, c: -22 }, // kitchen tiles
};

const layout = structuredClone(base);
layout.layoutRevision = 2;
layout.tileColors = layout.tiles.map((t, i) => (COLORS[t] ? { ...COLORS[t] } : base.tileColors[i]));

// Wall decor making room for windows: drop the right room's paintings, move the clock.
const REMOVE = new Set(['SMALL_PAINTING', 'LARGE_PAINTING', 'SMALL_PAINTING_2']);
layout.furniture = layout.furniture.filter((f) => !REMOVE.has(f.type));
for (const f of layout.furniture) {
  if (f.type === 'CLOCK') f.col = 6;
  // Violet velvet sofas and benches.
  if (f.type.startsWith('SOFA') || f.type === 'CUSHIONED_BENCH') {
    f.color = { h: 284, s: 46, b: -18, c: 0 };
  }
}

let n = 0;
const add = (type, col, row, extra = {}) =>
  layout.furniture.push({ uid: `paw-night-${++n}`, type, col, row, ...extra });

// Windows onto the night city (wall row 9–10).
add('PAW_WINDOW_CITY', 4, 9);
add('PAW_WINDOW_CITY', 12, 9);
add('PAW_WINDOW_CITY_B', 14, 9);
// Neon sign over the lounge.
add('PAW_NEON_SIGN', 16, 9);
// Desk lamps on both front desks, floor lamps in the corners.
add('PAW_DESK_LAMP', 2, 12);
add('PAW_DESK_LAMP', 8, 12);
add('PAW_FLOOR_LAMP', 1, 10);
add('PAW_FLOOR_LAMP', 18, 12);
// Kitchen corner: fridge, counter, coffee machine.
add('PAW_FRIDGE', 11, 18);
add('PAW_KITCHEN_COUNTER', 12, 18);
add('PAW_COFFEE_MACHINE', 14, 18);

fs.writeFileSync(
  path.join(ASSETS, 'default-layout-2.json'),
  JSON.stringify(layout, null, 2) + '\n',
);
console.log(`wrote default-layout-2.json with ${layout.furniture.length} items`);
