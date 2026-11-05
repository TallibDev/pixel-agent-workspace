#!/usr/bin/env node
/**
 * Pixel Agent Workspace — original characters.
 *
 * Six characters drawn pixel by pixel in code and written as character sheets
 * in the Pixel Agents format (webview-ui/public/assets/characters/char_N.png):
 *   112×96 = 7 frames (16×32) × 3 rows (down, up, right; left is mirrored).
 *   Frames: 0 walk A · 1 stand · 2 walk B · 3–4 typing · 5–6 reading.
 * Typing/reading are seated poses (the engine lowers them onto the chair).
 *
 * Run: node scripts/paw-art/generate-characters.mjs [--preview out.png]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pngjs from 'pngjs';

const { PNG } = pngjs;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.PAW_CHAR_OUT ?? path.join(ROOT, 'webview-ui/public/assets/characters');
const FW = 16;
const FH = 32;

// ── Colour helpers ───────────────────────────────────────────────────────
function parse(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]) {
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
/** Darken/lighten towards a violet night tint (shadows lean purple, not grey). */
function shade(hex, amount) {
  const [r, g, b] = parse(hex);
  if (amount < 0) {
    const k = 1 + amount;
    return toHex([r * k + 18 * -amount, g * k + 8 * -amount, b * k + 40 * -amount]);
  }
  return toHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
}

// ── Frame canvas ─────────────────────────────────────────────────────────
class Frame {
  constructor() {
    this.c = Array.from({ length: FH }, () => new Array(FW).fill(null));
  }
  set(x, y, col) {
    if (x >= 0 && y >= 0 && x < FW && y < FH && col) this.c[y][x] = col;
  }
  rect(x, y, w, h, col) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, col);
  }
  get(x, y) {
    return x >= 0 && y >= 0 && x < FW && y < FH ? this.c[y][x] : null;
  }
  clear(x, y) {
    if (x >= 0 && y >= 0 && x < FW && y < FH) this.c[y][x] = null;
  }
  /** Dark outline on every empty pixel touching the silhouette. */
  outline(col) {
    const add = [];
    for (let y = 0; y < FH; y++)
      for (let x = 0; x < FW; x++) {
        if (this.c[y][x]) continue;
        if (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].some(([dx, dy]) => this.get(x + dx, y + dy) && this.get(x + dx, y + dy) !== col)
        )
          add.push([x, y]);
      }
    for (const [x, y] of add) this.c[y][x] = col;
  }
  flipX() {
    const f = new Frame();
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) f.c[y][FW - 1 - x] = this.c[y][x];
    return f;
  }
}

// ── Characters (internal specs only — the app never shows these names) ──
const CAST = [
  {
    skin: '#f2c5a0',
    hair: '#1f1a2e',
    hairStyle: 'bob',
    top: '#6a4bd8',
    topStyle: 'hoodie',
    pants: '#2c2a44',
    shoes: '#e9e6f5',
    acc: 'headphones',
    accCol: '#5fe6ff',
  },
  {
    skin: '#a86b4a',
    hair: '#2b1d1a',
    hairStyle: 'curly',
    top: '#e8833a',
    topStyle: 'bomber',
    pants: '#33405c',
    shoes: '#1f1b2b',
    acc: null,
    inner: '#f4f1ff',
  },
  {
    skin: '#f6d7c3',
    hair: '#c8452f',
    hairStyle: 'ponytail',
    top: '#2f9e9a',
    topStyle: 'cardigan',
    pants: '#3b2f4a',
    shoes: '#6b3a2a',
    acc: 'glasses',
    accCol: '#2a1f33',
    inner: '#f2e6d0',
  },
  {
    skin: '#d9a07a',
    hair: '#5a3b26',
    hairStyle: 'short',
    top: '#3f7a4a',
    topStyle: 'jacket',
    pants: '#4a3a30',
    shoes: '#2a1f1a',
    acc: 'beanie',
    accCol: '#e0b13a',
    inner: '#e8e2d0',
  },
  {
    skin: '#f0d0b8',
    hair: '#d8d8ea',
    hairStyle: 'spiky',
    top: '#2a2438',
    topStyle: 'turtleneck',
    pants: '#1e1a2a',
    shoes: '#ff4fd8',
    acc: null,
    accCol: '#ff4fd8',
  },
  {
    skin: '#6e4330',
    hair: '#1c1412',
    hairStyle: 'afro',
    top: '#f2c94c',
    topStyle: 'sweater',
    pants: '#2f3a5a',
    shoes: '#f4f1ff',
    acc: 'headband',
    accCol: '#ff7ad9',
  },
];

const OUTLINE = '#1a1222';

// ── Body parts ───────────────────────────────────────────────────────────
/** Head (dir: 'down' | 'up' | 'right'), `oy` = vertical offset. */
function drawHead(f, ch, dir, oy) {
  const skin = ch.skin;
  const skinS = shade(skin, -0.18);
  const hair = ch.hair;
  const hairS = shade(hair, -0.25);
  const hairL = shade(hair, 0.18);
  const y0 = 6 + oy;
  // Skull 10×10 with rounded corners.
  f.rect(3, y0, 10, 10, skin);
  f.clear(3, y0);
  f.clear(12, y0);
  f.clear(3, y0 + 9);
  f.clear(12, y0 + 9);
  f.rect(11, y0 + 3, 1, 6, skinS); // jaw shadow
  if (dir === 'up') {
    f.rect(3, y0 - 1, 10, 10, hair);
    f.clear(3, y0 - 1);
    f.clear(12, y0 - 1);
    f.rect(11, y0, 2, 8, hairS);
    f.rect(4, y0, 3, 1, hairL);
    f.set(2, y0 + 5, skin); // ears
    f.set(13, y0 + 5, skinS);
  } else if (dir === 'down') {
    // Hair cap + fringe
    f.rect(3, y0 - 1, 10, 4, hair);
    f.clear(3, y0 - 1);
    f.clear(12, y0 - 1);
    f.rect(3, y0 + 3, 1, 4, hair);
    f.rect(12, y0 + 3, 1, 4, hairS);
    f.rect(5, y0, 3, 1, hairL);
    // Face
    f.set(5, y0 + 5, OUTLINE);
    f.set(5, y0 + 6, OUTLINE);
    f.set(10, y0 + 5, OUTLINE);
    f.set(10, y0 + 6, OUTLINE);
    f.set(4, y0 + 7, shade(skin, 0.0) === skin ? '#f29a9a' : skin); // blush
    f.set(11, y0 + 7, '#e88a8a');
    f.set(7, y0 + 8, skinS);
    f.set(8, y0 + 8, skinS);
  } else {
    // Profile, facing right: hair covers the back of the head.
    f.rect(3, y0 - 1, 9, 4, hair);
    f.clear(3, y0 - 1);
    f.rect(3, y0 + 3, 4, 5, hair);
    f.rect(3, y0 + 3, 1, 5, hairS);
    f.rect(5, y0, 3, 1, hairL);
    f.set(13, y0 + 6, skin); // nose
    f.set(10, y0 + 5, OUTLINE);
    f.set(10, y0 + 6, OUTLINE);
    f.set(7, y0 + 5, skinS); // ear
    f.set(7, y0 + 6, skinS);
    f.set(11, y0 + 8, skinS);
  }
  drawHairStyle(f, ch, dir, y0);
  drawHeadAccessory(f, ch, dir, y0);
}

function drawHairStyle(f, ch, dir, y0) {
  const hair = ch.hair;
  const hairS = shade(hair, -0.25);
  const hairL = shade(hair, 0.2);
  switch (ch.hairStyle) {
    case 'bob':
      if (dir !== 'right') {
        f.rect(2, y0 + 2, 1, 7, hair);
        f.rect(13, y0 + 2, 1, 7, hairS);
        if (dir === 'down') f.rect(3, y0 + 7, 1, 2, hair);
      } else {
        f.rect(2, y0 + 1, 1, 8, hairS);
        f.rect(3, y0 + 8, 4, 1, hair);
      }
      break;
    case 'curly':
      for (const [x, y] of [
        [3, -2],
        [5, -2],
        [7, -2],
        [9, -2],
        [11, -2],
        [2, 0],
        [13, 0],
        [2, 2],
        [13, 2],
      ]) {
        f.set(x, y0 + y, hair);
      }
      f.set(6, y0 - 1, hairL);
      f.set(10, y0, hairL);
      break;
    case 'ponytail':
      if (dir === 'up') {
        f.rect(7, y0 + 8, 2, 5, hair);
        f.set(8, y0 + 12, hairS);
        f.rect(7, y0 + 7, 2, 1, ch.accCol ? '#ffd27a' : hairL);
      } else if (dir === 'right') {
        f.rect(1, y0 + 2, 2, 6, hair);
        f.set(1, y0 + 7, hairS);
        f.set(3, y0 + 2, '#ffd27a');
      } else {
        f.rect(13, y0 + 4, 1, 5, hairS);
      }
      break;
    case 'short':
      f.rect(4, y0 - 2, 8, 1, hair);
      break;
    case 'spiky':
      for (const [x, y] of [
        [4, -3],
        [6, -3],
        [8, -3],
        [10, -3],
        [3, -2],
        [5, -2],
        [7, -2],
        [9, -2],
        [11, -2],
      ]) {
        f.set(x, y0 + y, y === -3 ? hairL : hair);
      }
      if (dir === 'right') f.set(13, y0 + 1, hair);
      break;
    case 'afro':
      f.rect(2, y0 - 3, 12, 4, hair);
      f.rect(1, y0 - 1, 1, 6, hair);
      f.rect(14, y0 - 1, 1, 6, hairS);
      f.clear(2, y0 - 3);
      f.clear(13, y0 - 3);
      f.rect(4, y0 - 3, 3, 1, hairL);
      if (dir === 'up') f.rect(2, y0 + 1, 12, 7, hair);
      break;
  }
}

function drawHeadAccessory(f, ch, dir, y0) {
  const a = ch.accCol;
  switch (ch.acc) {
    case 'headphones':
      f.rect(3, y0 - 2, 10, 1, shade(a, -0.35));
      if (dir === 'down' || dir === 'up') {
        f.rect(1, y0 + 3, 2, 3, a);
        f.rect(13, y0 + 3, 2, 3, shade(a, -0.3));
      } else {
        f.rect(6, y0 + 3, 2, 3, a);
      }
      break;
    case 'glasses':
      if (dir === 'down') {
        f.rect(4, y0 + 4, 3, 3, null);
        for (const gx of [4, 9]) {
          f.set(gx, y0 + 4, a);
          f.set(gx + 1, y0 + 4, a);
          f.set(gx + 2, y0 + 4, a);
          f.set(gx, y0 + 6, a);
          f.set(gx + 2, y0 + 6, a);
          f.set(gx, y0 + 5, a);
          f.set(gx + 2, y0 + 5, a);
        }
        f.set(7, y0 + 5, a);
        f.set(8, y0 + 5, a);
      } else if (dir === 'right') {
        f.rect(9, y0 + 4, 3, 1, a);
        f.set(9, y0 + 5, a);
        f.set(11, y0 + 5, a);
        f.set(9, y0 + 6, a);
        f.set(11, y0 + 6, a);
        f.rect(7, y0 + 4, 2, 1, a);
      }
      break;
    case 'beanie':
      f.rect(3, y0 - 3, 10, 4, a);
      f.clear(3, y0 - 3);
      f.clear(12, y0 - 3);
      f.rect(3, y0, 10, 1, shade(a, -0.25));
      f.set(7, y0 - 4, shade(a, 0.3));
      f.set(8, y0 - 4, shade(a, 0.3));
      f.rect(5, y0 - 2, 1, 2, shade(a, -0.12));
      f.rect(9, y0 - 2, 1, 2, shade(a, -0.12));
      break;
    case 'headband':
      f.rect(2, y0 + 1, 12, 1, a);
      f.set(13, y0 + 1, shade(a, -0.3));
      break;
  }
}

/** Torso + arms. `arms` describes hand positions for the pose. */
function drawTorso(f, ch, dir, oy, arms) {
  const top = ch.top;
  const topS = shade(top, -0.22);
  const topL = shade(top, 0.15);
  const y0 = 17 + oy;
  const skin = ch.skin;
  f.rect(7, y0 - 1, 2, 1, shade(skin, -0.18)); // neck
  const x0 = dir === 'right' ? 5 : 4;
  const w = dir === 'right' ? 6 : 8;
  f.rect(x0, y0, w, 8, top);
  f.rect(x0 + w - 1, y0, 1, 8, topS);
  f.rect(x0, y0, w, 1, topL);
  // Outfit details
  const inner = ch.inner ?? shade(top, 0.35);
  if (dir === 'down') {
    switch (ch.topStyle) {
      case 'hoodie':
        f.rect(6, y0, 4, 1, topS);
        f.set(6, y0 + 1, '#f4f1ff');
        f.set(9, y0 + 1, '#f4f1ff');
        f.rect(6, y0 + 5, 4, 2, topS);
        break;
      case 'bomber':
      case 'jacket':
      case 'cardigan':
        f.rect(7, y0, 2, 8, inner);
        f.set(7, y0 + 7, topS);
        if (ch.topStyle === 'bomber') f.rect(4, y0 + 7, 8, 1, shade(top, -0.35));
        if (ch.topStyle === 'cardigan') {
          f.set(6, y0 + 3, '#ffd27a');
          f.set(6, y0 + 5, '#ffd27a');
        }
        break;
      case 'turtleneck':
        f.rect(6, y0 - 1, 4, 2, topL);
        f.rect(4, y0 + 4, 8, 1, ch.accCol);
        break;
      case 'sweater':
        f.rect(5, y0 + 3, 6, 1, '#ff7ad9');
        f.rect(5, y0 + 5, 6, 1, '#7fe3ff');
        break;
    }
  } else if (dir === 'up') {
    if (ch.topStyle === 'hoodie') f.rect(5, y0, 6, 2, topS);
    if (ch.topStyle === 'bomber') f.rect(4, y0 + 7, 8, 1, shade(top, -0.35));
    if (ch.topStyle === 'turtleneck') f.rect(6, y0 - 1, 4, 1, topL);
  } else {
    if (ch.topStyle !== 'hoodie' && ch.topStyle !== 'turtleneck' && ch.topStyle !== 'sweater') {
      f.rect(10, y0, 1, 8, inner);
    }
    if (ch.topStyle === 'hoodie') f.rect(5, y0, 2, 2, topS);
    if (ch.topStyle === 'turtleneck') f.rect(6, y0 + 4, 5, 1, ch.accCol);
    if (ch.topStyle === 'sweater') f.rect(6, y0 + 3, 4, 1, '#ff7ad9');
  }
  // Arms: each { x, y, len } sleeve column ending in a hand.
  for (const a of arms) {
    const sleeve = a.back ? topS : top;
    f.rect(a.x, y0 + a.y, a.w ?? 1, a.len, sleeve);
    if (a.hand !== false)
      f.rect(a.hx ?? a.x, y0 + a.y + a.len, a.w ?? 1, 1, a.back ? shade(skin, -0.18) : skin);
  }
}

/** Legs for walking/standing. `stride` −1, 0, 1. */
function drawLegs(f, ch, dir, oy, stride) {
  const p = ch.pants;
  const pS = shade(p, -0.25);
  const s = ch.shoes;
  const sS = shade(s, -0.3);
  const y0 = 25 + oy;
  if (dir === 'right') {
    if (stride === 0) {
      f.rect(6, y0, 4, 5, p);
      f.rect(9, y0, 1, 5, pS);
      f.rect(6, y0 + 5, 5, 2, s);
      f.rect(6, y0 + 6, 5, 1, sS);
    } else {
      // Front leg forward, back leg behind.
      f.rect(4, y0, 3, 4, pS);
      f.rect(3, y0 + 4, 3, 2, sS);
      f.rect(8, y0, 3, 4, p);
      f.rect(9, y0 + 4, 4, 2, s);
      f.rect(9, y0 + 5, 4, 1, sS);
    }
    return;
  }
  const lift = (side) => (stride === 0 ? 0 : side === stride ? 1 : 0);
  for (const [side, x] of [
    [-1, 5],
    [1, 8],
  ]) {
    const l = lift(side);
    f.rect(x, y0, 3, 5 - l, side === 1 ? pS : p);
    f.rect(x, y0 + 5 - l, 3, 2, s);
    f.rect(x, y0 + 6 - l, 3, 1, sS);
  }
}

/** Seated legs: thighs only (the chair and desk hide the rest). */
function drawSeatedLegs(f, ch, dir, oy) {
  const p = ch.pants;
  const y0 = 25 + oy;
  if (dir === 'right') {
    f.rect(6, y0, 6, 2, p);
    f.rect(6, y0 + 2, 6, 1, shade(p, -0.25));
  } else {
    f.rect(5, y0, 6, 2, p);
    f.rect(5, y0 + 2, 6, 1, shade(p, -0.25));
  }
}

function drawTablet(f, dir, oy, phase) {
  const body = '#2a2438';
  const screen = '#5fd4ff';
  const y0 = 20 + oy;
  if (dir === 'down') {
    f.rect(5, y0, 6, 4, body);
    f.rect(6, y0 + 1, 4, 2, screen);
    f.set(6 + phase * 2, y0 + 1, '#d6fbff');
  } else if (dir === 'right') {
    f.rect(11, y0, 2, 4, body);
    f.set(12, y0 + 1, screen);
    f.set(12, y0 + 2, screen);
  }
}

// ── Poses ────────────────────────────────────────────────────────────────
function walkFrame(ch, dir, phase) {
  const f = new Frame();
  const stride = phase === 1 ? 0 : phase === 0 ? -1 : 1;
  const bob = phase === 1 ? 0 : -1;
  drawLegs(f, ch, dir, 0, stride);
  let arms;
  if (dir === 'right') {
    arms = stride === 0 ? [{ x: 8, y: 1, len: 5 }] : [{ x: stride < 0 ? 9 : 6, y: 1, len: 5 }];
  } else {
    const swing = (side) => (stride === 0 ? 0 : side === stride ? -1 : 1);
    arms = [
      { x: 3, y: 1 + Math.max(0, swing(-1)), len: 5 },
      { x: 12, y: 1 + Math.max(0, swing(1)), len: 5, back: dir === 'down' ? false : false },
    ];
  }
  drawTorso(f, ch, dir, bob, arms);
  drawHead(f, ch, dir, bob);
  f.outline(OUTLINE);
  return f;
}

function typeFrame(ch, dir, phase) {
  const f = new Frame();
  drawSeatedLegs(f, ch, dir, 0);
  let arms;
  if (dir === 'down') {
    arms = [
      { x: 4, y: 3, len: 2 + phase, hx: 5 },
      { x: 11, y: 3, len: 3 - phase, hx: 10 },
    ];
  } else if (dir === 'up') {
    arms = [
      { x: 3, y: 1, len: 3 - phase, hand: false },
      { x: 12, y: 1, len: 2 + phase, hand: false },
    ];
  } else {
    arms = [{ x: 9, y: 3, len: 1, w: 3, hx: 12 + phase }];
  }
  drawTorso(f, ch, dir, 0, arms);
  drawHead(f, ch, dir, dir === 'up' ? 0 : phase === 1 ? 0 : 0);
  f.outline(OUTLINE);
  return f;
}

function readFrame(ch, dir, phase) {
  const f = new Frame();
  drawSeatedLegs(f, ch, dir, 0);
  let arms;
  if (dir === 'down') {
    arms = [
      { x: 4, y: 3, len: 3, hx: 4 },
      { x: 11, y: 3, len: 3, hx: 11 },
    ];
  } else if (dir === 'up') {
    arms = [
      { x: 3, y: 1, len: 3, hand: false },
      { x: 12, y: 1, len: 3, hand: false },
    ];
  } else {
    arms = [{ x: 9, y: 3, len: 1, w: 2, hx: 10 }];
  }
  drawTorso(f, ch, dir, 0, arms);
  drawTablet(f, dir, 0, phase);
  drawHead(f, ch, dir, phase); // a slow nod while reading
  f.outline(OUTLINE);
  return f;
}

function sheet(ch) {
  const png = new PNG({ width: FW * 7, height: FH * 3 });
  const dirs = ['down', 'up', 'right'];
  dirs.forEach((dir, row) => {
    const frames = [
      walkFrame(ch, dir, 0),
      walkFrame(ch, dir, 1),
      walkFrame(ch, dir, 2),
      typeFrame(ch, dir, 0),
      typeFrame(ch, dir, 1),
      readFrame(ch, dir, 0),
      readFrame(ch, dir, 1),
    ];
    frames.forEach((fr, col) => {
      for (let y = 0; y < FH; y++)
        for (let x = 0; x < FW; x++) {
          const c = fr.c[y][x];
          if (!c) continue;
          const [r, g, b] = parse(c);
          const i = ((row * FH + y) * png.width + col * FW + x) * 4;
          png.data[i] = r;
          png.data[i + 1] = g;
          png.data[i + 2] = b;
          png.data[i + 3] = 255;
        }
    });
  });
  return png;
}

fs.mkdirSync(OUT, { recursive: true });
CAST.forEach((ch, i) => {
  const file = path.join(OUT, `char_${i}.png`);
  fs.writeFileSync(file, PNG.sync.write(sheet(ch)));
  console.log(`wrote ${path.relative(ROOT, file)}`);
});
