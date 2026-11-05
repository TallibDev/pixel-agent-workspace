#!/usr/bin/env node
/**
 * Pixel Agent Workspace — original furniture art.
 *
 * Every sprite here is drawn pixel by pixel in code (no third-party art) and
 * written as PNG + manifest.json in the Pixel Agents furniture asset format:
 *   webview-ui/public/assets/furniture/PAW_<NAME>/
 *
 * Run: node scripts/paw-art/generate-art.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pngjs from 'pngjs';

const { PNG } = pngjs;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'webview-ui/public/assets/furniture');

// ── Palette (night office) ───────────────────────────────────────────────
const C = {
  out: '#1b1424',
  wood0: '#3b2a3f',
  wood1: '#5a4060',
  wood2: '#7a5878',
  sill: '#8c6a86',
  sky0: '#141236',
  sky1: '#221a52',
  sky2: '#3a2466',
  sky3: '#5a2f78',
  bld0: '#0e0b20',
  bld1: '#17123a',
  bld2: '#211a4c',
  winY: '#ffd27a',
  winO: '#ffb347',
  winC: '#7fe3ff',
  neonM: '#ff4fd8',
  neonMcore: '#ffc2f2',
  neonMhalo: '#8a2a78',
  neonC: '#5fe6ff',
  neonCcore: '#d6fbff',
  neonChalo: '#1f5e7a',
  moon: '#f3e9c6',
  star: '#c9c3ff',
  plate: '#1a1024',
  plateEdge: '#2e1f3c',
  brass0: '#6b5230',
  brass1: '#b08a4a',
  brass2: '#e2c07a',
  shade0: '#c26a1e',
  shade1: '#e9a24c',
  shade2: '#ffcf7a',
  glow: '#fff0c2',
  pole: '#3a2f3f',
  pole1: '#5b4b60',
  cab0: '#4a3340',
  cab1: '#6b4a5a',
  cab2: '#8a6474',
  top0: '#2f2a3e',
  top1: '#4b4660',
  top2: '#6c6788',
  chrome0: '#6f6f86',
  chrome1: '#a9a9c0',
  chrome2: '#dcdcee',
  red: '#ff5a6a',
  green: '#6cffb0',
  cup: '#f4f1ff',
  coffee: '#5a3422',
  fridge0: '#9d98b6',
  fridge1: '#c9c4dc',
  fridge2: '#ebe8f6',
  steel: '#7b8296',
  water: '#4aa3d6',
};

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

class Sprite {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4);
  }
  set(x, y, color) {
    y += this.oy ?? 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !color) return;
    const [r, g, b, a] = hex(color);
    const i = (y * this.w + x) * 4;
    this.px.set([r, g, b, a], i);
  }
  rect(x, y, w, h, color) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color);
  }
  hline(x0, x1, y, color) {
    for (let x = x0; x <= x1; x++) this.set(x, y, color);
  }
  vline(x, y0, y1, color) {
    for (let y = y0; y <= y1; y++) this.set(x, y, color);
  }
  outlineRect(x, y, w, h, color) {
    this.hline(x, x + w - 1, y, color);
    this.hline(x, x + w - 1, y + h - 1, color);
    this.vline(x, y, y + h - 1, color);
    this.vline(x + w - 1, y, y + h - 1, color);
  }
  save(file) {
    const png = new PNG({ width: this.w, height: this.h });
    png.data = Buffer.from(this.px);
    fs.writeFileSync(file, PNG.sync.write(png));
  }
}

/** Deterministic RNG so the art is stable across runs. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── Window with the night city (wall, 2×2 tiles) ─────────────────────────
function drawWindow(seed) {
  const s = new Sprite(32, 32);
  const r = rng(seed);
  // Sky gradient (rows 2..26)
  const sky = [C.sky0, C.sky0, C.sky1, C.sky1, C.sky1, C.sky2, C.sky2, C.sky3];
  for (let y = 2; y <= 26; y++) {
    const band = sky[Math.min(sky.length - 1, Math.floor(((y - 2) / 25) * sky.length))];
    s.hline(2, 29, y, band);
  }
  // Stars and moon
  for (let i = 0; i < 9; i++) s.set(3 + Math.floor(r() * 26), 3 + Math.floor(r() * 8), C.star);
  s.rect(22, 4, 3, 3, C.moon);
  s.set(21, 5, C.moon);
  s.set(25, 5, C.moon);
  s.set(23, 3, C.moon);
  s.set(24, 4, C.sky1); // crescent bite
  s.set(24, 5, C.sky1);
  // Far skyline
  let x = 2;
  while (x <= 29) {
    const bw = 2 + Math.floor(r() * 3);
    const bh = 6 + Math.floor(r() * 7);
    s.rect(x, 27 - bh, bw, bh, C.bld2);
    x += bw;
  }
  // Near skyline with lit windows
  x = 2;
  while (x <= 29) {
    const bw = 3 + Math.floor(r() * 4);
    const bh = 5 + Math.floor(r() * 10);
    const top = 27 - bh;
    s.rect(x, top, Math.min(bw, 30 - x), bh, r() < 0.5 ? C.bld0 : C.bld1);
    for (let wy = top + 2; wy < 26; wy += 2) {
      for (let wx = x + 1; wx < Math.min(x + bw - 1, 29); wx += 2) {
        const roll = r();
        if (roll < 0.34) s.set(wx, wy, roll < 0.2 ? C.winY : roll < 0.28 ? C.winO : C.winC);
      }
    }
    // An antenna light now and then
    if (bh > 11 && r() < 0.6) {
      s.set(x + 1, top - 1, C.bld0);
      s.set(x + 1, top - 2, C.red);
    }
    x += bw;
  }
  // A neon strip on one building
  const nx = 6 + Math.floor(r() * 16);
  s.vline(nx, 17, 22, C.neonM);
  s.vline(nx + 1, 18, 21, C.neonMhalo);
  // Frame: outline, wood, mullions, sill
  s.outlineRect(0, 0, 32, 30, C.out);
  s.outlineRect(1, 1, 30, 28, C.wood1);
  s.hline(2, 29, 1, C.wood2);
  s.vline(15, 2, 26, C.wood1);
  s.vline(16, 2, 26, C.wood0);
  s.hline(2, 29, 14, C.wood1);
  s.hline(2, 29, 15, C.wood0);
  s.rect(0, 27, 32, 3, C.wood1);
  s.hline(0, 31, 27, C.sill);
  s.hline(0, 31, 30, C.out);
  s.hline(1, 30, 31, C.wood0);
  // Glass sheen
  s.set(4, 4, '#4b3f8a');
  s.set(5, 3, '#4b3f8a');
  s.set(19, 17, '#4b3f8a');
  s.set(20, 16, '#4b3f8a');
  return s;
}

// ── Neon sign: a coffee cup with steam (wall, 2×1 tiles) ─────────────────
function drawNeonSign() {
  // Drawn on a 32×32 canvas (2×2 wall footprint, like upstream wall decor) with
  // the sign centred on the wall face; the top and bottom rows stay transparent.
  const s = new Sprite(32, 32);
  s.oy = 9;
  s.rect(1, 2, 30, 12, C.plate);
  s.outlineRect(0, 1, 32, 14, C.plateEdge);
  s.set(2, 3, C.out);
  s.set(29, 3, C.out);
  s.set(2, 12, C.out);
  s.set(29, 12, C.out);
  const tube = (pts, core, color, halo) => {
    for (const [x, y] of pts) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const i = ((y + dy + (s.oy ?? 0)) * 32 + (x + dx)) * 4;
        if (s.px[i + 3] === 0 || s.px[i] === hex(C.plate)[0]) s.set(x + dx, y + dy, halo);
      }
    }
    for (const [x, y] of pts) s.set(x, y, color);
    for (const [x, y] of pts.filter((_, i) => i % 3 === 1)) s.set(x, y, core);
  };
  // Cup body
  const cup = [];
  for (let x = 6; x <= 15; x++) cup.push([x, 7]);
  for (let y = 8; y <= 11; y++) cup.push([6, y], [15, y]);
  for (let x = 7; x <= 14; x++) cup.push([x, 12]);
  cup.push([16, 8], [17, 8], [18, 9], [18, 10], [17, 11], [16, 11]);
  tube(cup, C.neonMcore, C.neonM, C.neonMhalo);
  // Steam
  const steam = [
    [8, 5],
    [9, 4],
    [8, 3],
    [11, 5],
    [12, 4],
    [11, 3],
    [14, 5],
    [13, 4],
  ];
  tube(steam, C.neonCcore, C.neonC, C.neonChalo);
  // "</>" glyph on the right
  const code = [
    [22, 6],
    [21, 7],
    [20, 8],
    [21, 9],
    [22, 10],
    [24, 11],
    [25, 9],
    [25, 8],
    [26, 6],
    [27, 6],
    [28, 7],
    [29, 8],
    [28, 9],
    [27, 10],
  ];
  tube(code, C.neonCcore, C.neonC, C.neonChalo);
  return s;
}

// ── Desk lamp (on desks, 1×1) ────────────────────────────────────────────
function drawDeskLamp() {
  const s = new Sprite(16, 16);
  // Base
  s.rect(4, 13, 7, 2, C.brass0);
  s.hline(5, 9, 13, C.brass1);
  s.hline(3, 11, 15, C.out);
  // Arm
  s.vline(7, 7, 12, C.brass1);
  s.vline(8, 7, 12, C.brass0);
  s.set(8, 6, C.brass1);
  s.set(9, 5, C.brass1);
  // Shade
  s.rect(6, 2, 7, 3, C.shade1);
  s.hline(7, 11, 1, C.shade0);
  s.hline(6, 12, 2, C.shade2);
  s.hline(5, 13, 5, C.out);
  s.rect(6, 5, 7, 1, C.glow);
  s.set(5, 3, C.out);
  s.set(13, 3, C.out);
  s.set(6, 1, C.out);
  s.set(12, 1, C.out);
  return s;
}

// ── Floor lamp (1×2, top row walk-behind) ────────────────────────────────
function drawFloorLamp() {
  const s = new Sprite(16, 32);
  // Shade (rows 2..11)
  for (let y = 2; y <= 10; y++) {
    const half = 3 + Math.floor((y - 2) / 2);
    s.hline(8 - half, 7 + half, y, y < 4 ? C.shade2 : y < 8 ? C.shade1 : C.shade0);
  }
  for (let y = 2; y <= 10; y++) {
    const half = 3 + Math.floor((y - 2) / 2);
    s.set(8 - half - 1, y, C.out);
    s.set(8 + half, y, C.out);
  }
  s.hline(4, 11, 1, C.out);
  s.hline(2, 13, 11, C.glow);
  s.hline(1, 14, 12, C.out);
  // Pole
  s.vline(7, 13, 28, C.pole1);
  s.vline(8, 13, 28, C.pole);
  // Base
  s.rect(4, 29, 8, 2, C.pole);
  s.hline(5, 10, 29, C.pole1);
  s.hline(3, 12, 31, C.out);
  return s;
}

// ── Coffee machine on a cabinet (1×2, top row walk-behind) ───────────────
function drawCoffeeMachine() {
  const s = new Sprite(16, 32);
  // Machine body (rows 3..16)
  s.rect(3, 3, 10, 13, C.chrome1);
  s.rect(3, 3, 10, 2, C.chrome2);
  s.vline(12, 3, 15, C.chrome0);
  s.outlineRect(2, 2, 12, 15, C.out);
  // Display + buttons
  s.rect(5, 6, 6, 2, C.top0);
  s.set(6, 6, C.green);
  s.set(9, 7, C.red);
  // Spout and cup
  s.rect(6, 9, 4, 1, C.chrome0);
  s.vline(7, 10, 11, C.chrome0);
  s.rect(6, 12, 4, 3, C.cup);
  s.hline(6, 9, 12, C.coffee);
  s.set(10, 13, C.cup);
  // Cabinet / counter (rows 17..31)
  s.rect(0, 17, 16, 2, C.top2);
  s.hline(0, 15, 17, '#8f8ab0');
  s.rect(1, 19, 14, 11, C.cab1);
  s.vline(1, 19, 29, C.cab2);
  s.vline(14, 19, 29, C.cab0);
  s.vline(8, 20, 28, C.cab0);
  s.set(6, 24, C.brass2);
  s.set(10, 24, C.brass2);
  s.hline(0, 15, 30, C.cab0);
  s.hline(0, 15, 31, C.out);
  s.vline(0, 17, 31, C.out);
  s.vline(15, 17, 31, C.out);
  return s;
}

// ── Fridge (1×2, top row walk-behind) ────────────────────────────────────
function drawFridge() {
  const s = new Sprite(16, 32);
  s.rect(2, 1, 12, 30, C.fridge1);
  s.vline(2, 1, 30, C.fridge2);
  s.vline(13, 1, 30, C.fridge0);
  s.hline(2, 13, 11, C.fridge0);
  s.outlineRect(1, 0, 14, 32, C.out);
  s.vline(11, 4, 8, C.steel);
  s.vline(11, 14, 20, C.steel);
  // Magnets: a little colour in the kitchen
  s.set(5, 4, C.neonM);
  s.set(7, 6, C.winY);
  s.set(5, 16, C.neonC);
  s.rect(4, 18, 3, 3, '#fff6e0');
  s.set(5, 19, C.red);
  return s;
}

// ── Kitchen counter with sink and kettle (2×2, top row walk-behind) ──────
function drawCounter() {
  const s = new Sprite(32, 32);
  // Back wall items (rows 4..16): kettle and jar
  s.rect(4, 9, 7, 7, C.steel);
  s.hline(5, 9, 8, C.chrome1);
  s.rect(6, 7, 3, 1, C.out);
  s.set(11, 10, C.steel);
  s.set(12, 11, C.steel);
  s.outlineRect(3, 8, 9, 9, C.out);
  s.set(7, 12, C.red);
  s.rect(24, 10, 5, 6, '#c9a46a');
  s.hline(24, 28, 9, C.wood1);
  s.outlineRect(23, 9, 7, 8, C.out);
  // Counter top (rows 16..18)
  s.rect(0, 16, 32, 3, C.top2);
  s.hline(0, 31, 16, '#8f8ab0');
  // Sink
  s.rect(13, 16, 8, 2, C.steel);
  s.hline(14, 19, 17, C.water);
  s.vline(17, 12, 15, C.chrome1);
  s.set(16, 12, C.chrome1);
  // Cabinets (rows 19..31)
  s.rect(1, 19, 30, 11, C.cab1);
  s.vline(1, 19, 29, C.cab2);
  s.vline(30, 19, 29, C.cab0);
  for (const vx of [10, 21]) s.vline(vx, 20, 28, C.cab0);
  for (const kx of [7, 13, 18, 24]) s.set(kx, 24, C.brass2);
  s.hline(0, 31, 30, C.cab0);
  s.hline(0, 31, 31, C.out);
  s.vline(0, 16, 31, C.out);
  s.vline(31, 16, 31, C.out);
  return s;
}

// ── Write assets ─────────────────────────────────────────────────────────
const ITEMS = [
  {
    id: 'PAW_WINDOW_CITY',
    name: 'Night City Window',
    category: 'wall',
    canPlaceOnWalls: true,
    w: 32,
    h: 32,
    fw: 2,
    fh: 2,
    draw: () => drawWindow(7),
  },
  {
    id: 'PAW_WINDOW_CITY_B',
    name: 'Night City Window (east)',
    category: 'wall',
    canPlaceOnWalls: true,
    w: 32,
    h: 32,
    fw: 2,
    fh: 2,
    draw: () => drawWindow(31),
  },
  {
    id: 'PAW_NEON_SIGN',
    name: 'Neon Coffee Sign',
    category: 'wall',
    canPlaceOnWalls: true,
    w: 32,
    h: 32,
    fw: 2,
    fh: 2,
    draw: drawNeonSign,
  },
  {
    id: 'PAW_DESK_LAMP',
    name: 'Desk Lamp',
    category: 'decor',
    canPlaceOnSurfaces: true,
    w: 16,
    h: 16,
    fw: 1,
    fh: 1,
    draw: drawDeskLamp,
  },
  {
    id: 'PAW_FLOOR_LAMP',
    name: 'Floor Lamp',
    category: 'decor',
    w: 16,
    h: 32,
    fw: 1,
    fh: 2,
    bg: 1,
    draw: drawFloorLamp,
  },
  {
    id: 'PAW_COFFEE_MACHINE',
    name: 'Coffee Machine',
    category: 'misc',
    w: 16,
    h: 32,
    fw: 1,
    fh: 2,
    bg: 1,
    draw: drawCoffeeMachine,
  },
  {
    id: 'PAW_FRIDGE',
    name: 'Fridge',
    category: 'misc',
    w: 16,
    h: 32,
    fw: 1,
    fh: 2,
    bg: 1,
    draw: drawFridge,
  },
  {
    id: 'PAW_KITCHEN_COUNTER',
    name: 'Kitchen Counter',
    category: 'misc',
    w: 32,
    h: 32,
    fw: 2,
    fh: 2,
    bg: 1,
    draw: drawCounter,
  },
];

for (const item of ITEMS) {
  const dir = path.join(OUT, item.id);
  fs.mkdirSync(dir, { recursive: true });
  item.draw().save(path.join(dir, `${item.id}.png`));
  const manifest = {
    id: item.id,
    name: item.name,
    category: item.category,
    type: 'asset',
    canPlaceOnWalls: item.canPlaceOnWalls ?? false,
    canPlaceOnSurfaces: item.canPlaceOnSurfaces ?? false,
    backgroundTiles: item.bg ?? 0,
    width: item.w,
    height: item.h,
    footprintW: item.fw,
    footprintH: item.fh,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, dir)}`);
}
