#!/usr/bin/env node
/**
 * Pixel Agent Workspace office (default-layout-3.json), modelled on the
 * project's design reference: one large top-down room with a band of city
 * windows, three work desks with dual monitors, a kitchen corner with a neon
 * cat, a velvet lounge on a rug, a bean-bag nook, lamps, lanterns, plants and
 * cats. Everything is regular furniture — interactive, walkable, editable.
 *
 * Run: node scripts/paw-art/build-reference-layout.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = path.join(ROOT, 'webview-ui/public/assets');

const COLS = 26;
const ROWS = 18;
const VOID = 255;
const WALL = 0;
const WOOD = 7;

const WALL_COLOR = { h: 268, s: 34, b: -72, c: -40 };
const FLOOR_COLOR = { h: 288, s: 24, b: -40, c: -62 };

const tiles = [];
const tileColors = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    let t = VOID;
    if (r === 1 && c >= 0 && c < COLS) t = WALL;
    else if (r >= 2 && r <= 16 && (c === 0 || c === COLS - 1)) t = WALL;
    else if (r >= 2 && r <= 16) t = WOOD;
    tiles.push(t);
    tileColors.push(t === WALL ? { ...WALL_COLOR } : t === WOOD ? { ...FLOOR_COLOR } : null);
  }
}

// Rugs (carpet tiles): a patterned lounge rug and a smaller centre rug.
const carpetTiles = new Array(COLS * ROWS).fill(null);
const rug = (c0, r0, c1, r1, variant, color, accentColor) => {
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) carpetTiles[r * COLS + c] = { variant, color, accentColor };
};
rug(2, 10, 9, 15, 1, { h: 330, s: 40, b: -45, c: -20 }, { h: 300, s: 35, b: -10, c: 0 });
rug(12, 9, 15, 14, 2, { h: 280, s: 40, b: -40, c: -20 }, { h: 320, s: 45, b: -5, c: 0 });

const furniture = [];
let n = 0;
const add = (type, col, row, extra = {}) =>
  furniture.push({ uid: `paw-ref-${++n}`, type, col, row, ...extra });
const VELVET = { h: 284, s: 46, b: -18, c: 0 };

// Top wall: bookshelves, hanging plants, the window band, clock, neon cat.
add('DOUBLE_BOOKSHELF', 1, 0);
add('HANGING_PLANT', 3, 0);
[
  'PAW_WINDOW_CITY',
  'PAW_WINDOW_CITY_B',
  'PAW_WINDOW_CITY',
  'PAW_WINDOW_CITY_B',
  'PAW_WINDOW_CITY',
].forEach((w, i) => add(w, 4 + i * 2, 0));
add('HANGING_PLANT', 14, 0);
add('CLOCK', 15, 0);
add('DOUBLE_BOOKSHELF', 16, 0);
add('PAW_NEON_CAT', 19, 0);
add('DOUBLE_BOOKSHELF', 22, 0);
add('HANGING_PLANT', 24, 0);

// Kitchen corner.
add('PAW_FRIDGE', 18, 2);
add('PAW_KITCHEN_COUNTER', 19, 2);
add('PAW_COFFEE_MACHINE', 21, 2);
add('PLANT_2', 23, 2);

// Three work desks under the windows, each with dual monitors, a lantern and a chair.
for (const dc of [3, 8, 13]) {
  add('DESK_FRONT', dc, 3);
  add('PAW_DUAL_MONITOR_OFF', dc, 3);
  add('PAW_LANTERN', dc + 2, 4);
  add('CUSHIONED_BENCH', dc + 1, 5);
}
add('PLANT', 1, 2);
add('PLANT_2', 11, 6);
add('BIN', 7, 6);

// A fourth desk on the right, as in the reference.
add('DESK_FRONT', 19, 8);
add('PAW_DUAL_MONITOR_OFF', 19, 8);
add('PAW_LANTERN', 21, 9);
add('CUSHIONED_BENCH', 20, 10);
add('PLANT', 23, 7);
add('PAW_FLOOR_LAMP', 17, 7);

// Lounge on the rug: velvet sofas around a coffee table, lamp, plants.
add('SOFA_FRONT', 5, 11, { color: VELVET });
add('SOFA_SIDE', 4, 12, { color: VELVET });
add('COFFEE_TABLE', 5, 12);
add('SOFA_SIDE:left', 7, 12, { color: VELVET });
add('SOFA_BACK', 5, 14, { color: VELVET });
add('PAW_LANTERN', 5, 12);
add('COFFEE', 6, 13);
add('PAW_FLOOR_LAMP', 2, 10);
add('PLANT', 9, 10);
add('LARGE_PLANT', 1, 14);

// Bean-bag nook, bottom right.
add('PAW_LOUNGE_BEANBAG', 20, 13);
add('PAW_FLOOR_LAMP', 22, 12);
add('LARGE_PLANT', 23, 14);
add('PLANT_2', 18, 14);

// Odds and ends.
add('CACTUS', 16, 14);
add('PLANT_2', 11, 15);
add('POT', 10, 8);

const layout = {
  version: 1,
  cols: COLS,
  rows: ROWS,
  layoutRevision: 3,
  tiles,
  tileColors,
  carpetTiles,
  furniture,
  pets: [
    { id: 'paw-cat-1', petType: 1 },
    { id: 'paw-cat-2', petType: 1 },
  ],
};

fs.writeFileSync(
  path.join(ASSETS, 'default-layout-3.json'),
  JSON.stringify(layout, null, 2) + '\n',
);
console.log(`wrote default-layout-3.json (${COLS}×${ROWS}, ${furniture.length} items)`);
