// Map loading (original .MNE format), random generation, and RLE for the network.
import { MAP_W, MAP_H, T, TREASURES, TREASURE_WEIGHTS, MONSTER_CHARS, LEVELS, LEVEL_EXT } from './const.js';

// A parsed map: { tiles: Uint8Array, treasures: Map(idx->tid), monsters: [{x,y,type}], spawns: [[x,y]..] }

function charToTile(b) {
  const c = String.fromCharCode(b);
  if (c === '0') return T.DIRT;
  if (c === '1') return T.SOLID;
  if (c >= '2' && c <= '4') return T.ROCK_SOFT;
  if (c === '5' || c === '6') return T.ROCK_MED;
  if ((c >= '7' && c <= '9') || c === 'A') return T.ROCK_HARD;
  if (c >= 'B' && c <= 'F') return T.ROCK_VHARD;
  if (c >= 'G' && c <= 'Z') return T.DIRT;      // special objects: bury a surprise
  if (c >= 'a' && c <= 'z') return T.EMPTY;     // monster spawn
  if (b >= 128) return T.DIRT;                  // treasure buried in dirt
  return T.DIRT;
}

export function parseMNE(bytes, withMonsters) {
  const tiles = new Uint8Array(MAP_W * MAP_H).fill(T.DIRT);
  const treasures = new Map();
  const monsters = [];
  let x = 0, y = 0;
  for (const b of bytes) {
    if (b === 13) continue;
    if (b === 10) { x = 0; y++; continue; }
    if (x < MAP_W && y < MAP_H) {
      const i = y * MAP_W + x;
      tiles[i] = charToTile(b);
      if (b >= 128) treasures.set(i, b % TREASURES.length);
      const c = String.fromCharCode(b);
      if (withMonsters && c >= 'a' && c <= 'z') {
        monsters.push({ x: x + 0.5, y: y + 0.5, type: MONSTER_CHARS[c] || 'blob' });
      }
      if (c >= 'G' && c <= 'Z') treasures.set(i, 255); // weapon crate marker
    }
    x++;
  }
  sealBorder(tiles);
  return { tiles, treasures, monsters };
}

function sealBorder(tiles) {
  for (let x = 0; x < MAP_W; x++) { tiles[x] = T.BORDER; tiles[(MAP_H - 1) * MAP_W + x] = T.BORDER; }
  for (let y = 0; y < MAP_H; y++) { tiles[y * MAP_W] = T.BORDER; tiles[y * MAP_W + MAP_W - 1] = T.BORDER; }
}

export async function loadLevel(name, withMonsters) {
  const res = await fetch(`assets/levels/${name}.${LEVEL_EXT}`);
  if (!res.ok) throw new Error(`level ${name} not found`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return parseMNE(buf, withMonsters);
}

// mulberry32 — deterministic PRNG so host/practice maps are reproducible from a seed
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMap(seed, treasureCount, withMonsters) {
  const rnd = rng(seed);
  const tiles = new Uint8Array(MAP_W * MAP_H).fill(T.DIRT);
  const treasures = new Map();
  const monsters = [];

  // rock blobs of varying hardness
  const blobs = 90 + ((rnd() * 40) | 0);
  for (let b = 0; b < blobs; b++) {
    const cx = 2 + rnd() * (MAP_W - 4), cy = 2 + rnd() * (MAP_H - 4);
    const r = 1 + rnd() * 4;
    const kind = [T.ROCK_SOFT, T.ROCK_SOFT, T.ROCK_MED, T.ROCK_MED, T.ROCK_HARD, T.ROCK_VHARD, T.SOLID][(rnd() * 7) | 0];
    for (let y = Math.max(1, cy - r) | 0; y <= Math.min(MAP_H - 2, cy + r); y++)
      for (let x = Math.max(1, cx - r) | 0; x <= Math.min(MAP_W - 2, cx + r); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r && rnd() > d / r * 0.55) tiles[y * MAP_W + x] = kind;
      }
  }
  // a few open caverns
  for (let c = 0; c < 8; c++) {
    const cx = 3 + rnd() * (MAP_W - 6), cy = 3 + rnd() * (MAP_H - 6), r = 1.5 + rnd() * 2.5;
    for (let y = Math.max(1, cy - r) | 0; y <= Math.min(MAP_H - 2, cy + r); y++)
      for (let x = Math.max(1, cx - r) | 0; x <= Math.min(MAP_W - 2, cx + r); x++)
        if (Math.hypot(x - cx, y - cy) <= r) tiles[y * MAP_W + x] = T.EMPTY;
  }
  sealBorder(tiles);

  // treasures buried in dirt, weighted by value
  const totalW = TREASURE_WEIGHTS.reduce((a, b) => a + b, 0);
  let placed = 0, guard = 0;
  while (placed < treasureCount && guard++ < 8000) {
    const x = 1 + ((rnd() * (MAP_W - 2)) | 0), y = 1 + ((rnd() * (MAP_H - 2)) | 0);
    const i = y * MAP_W + x;
    if (tiles[i] !== T.DIRT && tiles[i] !== T.ROCK_SOFT || treasures.has(i)) continue;
    let roll = rnd() * totalW, tid = 0;
    for (let k = 0; k < TREASURE_WEIGHTS.length; k++) { roll -= TREASURE_WEIGHTS[k]; if (roll <= 0) { tid = k; break; } }
    treasures.set(i, tid);
    placed++;
  }
  // some weapon crates
  for (let k = 0; k < 6; k++) {
    const x = 1 + ((rnd() * (MAP_W - 2)) | 0), y = 1 + ((rnd() * (MAP_H - 2)) | 0);
    const i = y * MAP_W + x;
    if ((tiles[i] === T.DIRT || tiles[i] === T.ROCK_SOFT) && !treasures.has(i)) treasures.set(i, 255);
  }
  if (withMonsters) {
    const types = Object.keys((/** @type {any} */ (MONSTER_CHARS))).map(c => MONSTER_CHARS[c]);
    const n = 4 + ((rnd() * 5) | 0);
    for (let k = 0; k < n; k++) {
      const x = 4 + rnd() * (MAP_W - 8), y = 4 + rnd() * (MAP_H - 8);
      monsters.push({ x, y, type: types[(rnd() * types.length) | 0] });
    }
  }
  return { tiles, treasures, monsters };
}

// carve the four corner spawn chambers and return spawn points
export function carveSpawns(map, nPlayers) {
  const corners = [[3, 3], [MAP_W - 4, 3], [3, MAP_H - 4], [MAP_W - 4, MAP_H - 4]];
  const spawns = [];
  for (let p = 0; p < nPlayers; p++) {
    const [cx, cy] = corners[p % 4];
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        const i = y * MAP_W + x;
        if (map.tiles[i] !== T.BORDER) { map.tiles[i] = T.EMPTY; map.treasures.delete(i); }
      }
    spawns.push([cx + 0.5, cy + 0.5]);
  }
  return spawns;
}

export function pickRandomLevel(rnd) { return LEVELS[(rnd() * LEVELS.length) | 0]; }

// top up a loaded level with random buried treasures until it holds `target`
export function sprinkleTreasures(map, target, rnd) {
  const totalW = TREASURE_WEIGHTS.reduce((a, b) => a + b, 0);
  let have = [...map.treasures.values()].filter(t => t !== 255).length;
  let guard = 0;
  while (have < target && guard++ < 8000) {
    const x = 1 + ((rnd() * (MAP_W - 2)) | 0), y = 1 + ((rnd() * (MAP_H - 2)) | 0);
    const i = y * MAP_W + x;
    if ((map.tiles[i] !== T.DIRT && map.tiles[i] !== T.ROCK_SOFT) || map.treasures.has(i)) continue;
    let roll = rnd() * totalW, tid = 0;
    for (let k = 0; k < TREASURE_WEIGHTS.length; k++) { roll -= TREASURE_WEIGHTS[k]; if (roll <= 0) { tid = k; break; } }
    map.treasures.set(i, tid);
    have++;
  }
}

// ---- serialization for the network ----
export function encodeMap(map) {
  const rle = [];
  const t = map.tiles;
  let run = 1;
  for (let i = 1; i <= t.length; i++) {
    if (i < t.length && t[i] === t[i - 1] && run < 255) run++;
    else { rle.push(run, t[i - 1]); run = 1; }
  }
  return {
    rle,
    treasures: [...map.treasures.entries()],
    monsters: map.monsters,
  };
}

export function decodeMap(enc) {
  const tiles = new Uint8Array(MAP_W * MAP_H);
  let i = 0;
  for (let k = 0; k < enc.rle.length; k += 2) {
    const run = enc.rle[k], v = enc.rle[k + 1];
    tiles.fill(v, i, i + run); i += run;
  }
  return { tiles, treasures: new Map(enc.treasures), monsters: enc.monsters || [] };
}
