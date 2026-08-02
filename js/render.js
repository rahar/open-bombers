// Canvas renderer using the original Mine Bombers graphics (decoded from the
// game's SPY files into assets/gfx). Native 640x480 layout: 30px HUD + 64x45
// map of 10x10 tiles, displayed pixel-doubled via CSS.
import { MAP_W, MAP_H, TILE, HUD_H, T, TREASURES, WEAPON_BY_ID, PLAYER_COLORS, MONSTERS } from './const.js';
import { rng } from './map.js';

function px(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(x, y, w, h); }
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export const sprites = {};   // name -> canvas (10x10 originals + generated)
let sheetImg = null, sheetIdx = null, hudImg = null;

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

function cut(name) {
  const [sx, sy] = sheetIdx[name];
  const c = makeCanvas(TILE, TILE);
  c.getContext('2d').drawImage(sheetImg, sx, sy, TILE, TILE, 0, 0, TILE, TILE);
  return c;
}

function tinted(base, fn) {
  const c = makeCanvas(base.width, base.height);
  const g = c.getContext('2d');
  g.drawImage(base, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) fn(d.data, i);
  g.putImageData(d, 0, 0);
  return c;
}

// recolor the miner's blue clothes to a player color
function minerVariant(base, col) {
  const [cr, cg, cb] = col;
  return tinted(base, (d, i) => {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (b > r + 12 && b > g + 12) {          // blueish cloth pixel
      const lum = (r + g + b) / (3 * 130);
      d[i] = Math.min(255, cr * lum);
      d[i + 1] = Math.min(255, cg * lum);
      d[i + 2] = Math.min(255, cb * lum);
    }
  });
}

function bombSprite(wid) {
  const c = makeCanvas(16, 16), g = c.getContext('2d');
  if (wid === 'mine') {
    px(g, 4, 9, 8, 4, '#666'); px(g, 5, 8, 6, 2, '#999'); px(g, 7, 7, 2, 2, '#f00');
  } else if (wid === 'remote') {
    px(g, 4, 6, 8, 8, '#385'); px(g, 5, 7, 6, 3, '#7fd'); px(g, 10, 3, 2, 4, '#ccc'); px(g, 10, 2, 2, 1, '#f44');
  } else if (wid === 'napalm') {
    px(g, 4, 4, 8, 10, '#a33'); px(g, 4, 6, 8, 2, '#dd3'); px(g, 4, 10, 8, 2, '#dd3'); px(g, 7, 2, 2, 2, '#666');
  } else if (wid === 'ureth') {
    px(g, 4, 5, 8, 9, '#ce8'); px(g, 5, 3, 6, 2, '#886'); px(g, 7, 1, 2, 2, '#886');
  } else if (wid === 'plate') {
    px(g, 2, 2, 12, 12, '#8892a0'); px(g, 3, 3, 10, 10, '#aab4c2'); px(g, 4, 4, 2, 2, '#667');
    px(g, 10, 4, 2, 2, '#667'); px(g, 4, 10, 2, 2, '#667'); px(g, 10, 10, 2, 2, '#667');
  } else if (wid === 'medkit') {
    px(g, 2, 4, 12, 10, '#eee'); px(g, 7, 5, 2, 8, '#e33'); px(g, 4, 8, 8, 2, '#e33');
  } else if (wid === 'pick' || wid === 'drill') {
    px(g, 3, 11, 10, 2, '#963'); px(g, 6, 2, 3, 10, '#963'); px(g, 2, 2, 11, 3, '#aab');
    if (wid === 'drill') px(g, 2, 2, 11, 3, '#dd3');
  } else {
    const rad = wid === 'nuke' ? 7 : (wid === 'dyna' || wid === 'big') ? 6 : 4;
    g.fillStyle = wid === 'nuke' ? '#222' : '#111';
    g.beginPath(); g.arc(8, 9, rad, 0, 7); g.fill();
    px(g, 6, 9 - rad + 2, 2, 2, '#556');
    px(g, 8, 9 - rad - 2, 1, 3, '#a86');
    px(g, 8, 9 - rad - 3, 1, 1, '#fd3');
    if (wid === 'dyna') { px(g, 3, 5, 4, 9, '#c33'); px(g, 9, 5, 4, 9, '#c33'); px(g, 3, 8, 10, 2, '#eee'); }
    if (wid === 'nuke') { g.fillStyle = '#fd3'; g.font = '8px monospace'; g.fillText('☢', 5, 12); }
  }
  return c;
}

export async function loadAssets() {
  const [sheet, idx, hud] = await Promise.all([
    loadImage('assets/gfx/sprites.png'),
    fetch('assets/gfx/sprites.json').then(r => r.json()),
    loadImage('assets/gfx/hud.png'),
  ]);
  sheetImg = sheet; sheetIdx = idx; hudImg = hud;

  for (const name of Object.keys(sheetIdx)) sprites[name] = cut(name);

  // tile mapping to original textures
  sprites.tiles = {
    [T.EMPTY]: sprites.tunnel,
    [T.DIRT]: sprites.sand,
    [T.ROCK_SOFT]: sprites.sandrock,
    [T.ROCK_MED]: sprites.rock,
    [T.ROCK_HARD]: sprites.brick,
    [T.ROCK_VHARD]: tinted(sprites.brick, (d, i) => { d[i] *= 0.62; d[i + 1] *= 0.62; d[i + 2] *= 0.62; }),
    [T.SOLID]: tinted(sprites.rock, (d, i) => { d[i] *= 0.6; d[i + 1] *= 0.6; d[i + 2] *= 0.6; }),
    [T.STEEL]: sprites.metal,
    [T.URETHANE]: sprites.urethane,
    [T.BORDER]: tinted(sprites.metal, (d, i) => { d[i] *= 0.55; d[i + 1] *= 0.55; d[i + 2] *= 0.55; }),
  };
  sprites.gems = TREASURES.map(t => sprites[t.sprite]);
  sprites.monsters = {};
  for (const k of Object.keys(MONSTERS)) sprites.monsters[k] = sprites[MONSTERS[k].sprite];
  sprites.bombs = {};
  for (const wid of ['small', 'big', 'dyna', 'nuke', 'napalm', 'mine', 'remote', 'ureth', 'plate', 'medkit'])
    sprites.bombs[wid] = bombSprite(wid);
  sprites.bombs.pick = sprites.pickL;
  sprites.bombs.drill = sprites.drill;
  sprites.bombs.medkit = sprites.firstaid;
  // player variants from the original tiny miner
  const rgb = [[224, 64, 64], [64, 96, 224], [48, 176, 64], [216, 176, 32]];
  sprites.players = rgb.map(col => minerVariant(sprites.miner, col));
}

export function buildSprites() { /* kept for API compatibility; assets load via loadAssets() */ }

// ---------- renderer ----------
export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    this.mapCv = makeCanvas(MAP_W * TILE, MAP_H * TILE);
    this.mapG = this.mapCv.getContext('2d');
    this.fx = [];
    this.floats = [];
    this.particles = [];
    this.shake = 0;
    this.animT = 0;
  }

  drawFullMap(tiles) {
    for (let i = 0; i < tiles.length; i++) this.patchTile(tiles, i);
  }
  patchTile(tiles, i) {
    const x = (i % MAP_W) * TILE, y = ((i / MAP_W) | 0) * TILE;
    this.mapG.drawImage(sprites.tiles[tiles[i]], x, y);
  }

  addBoom(x, y, r, big) {
    this.fx.push({ x, y, r, t: 0 });
    this.shake = Math.max(this.shake, big ? 9 : 3);
    const rr = rng((x * 31 + y * 57) | 0);
    for (let i = 0; i < (big ? 50 : 20); i++) {
      const a = rr() * Math.PI * 2, sp = 1.5 + rr() * 4;
      this.particles.push({
        x: x * TILE, y: y * TILE, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
        t: 0.5 + rr() * 0.6, col: ['#ffb040', '#ff7020', '#996644', '#555555'][(rr() * 4) | 0],
      });
    }
  }
  addFloat(x, y, txt, col = '#7fff5c') { this.floats.push({ x: x * TILE, y: y * TILE, txt, t: 1.6, col }); }

  render(view, dt) {
    this.animT += dt;
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, this.cv.width, this.cv.height);

    let ox = 0, oy = HUD_H;
    if (this.shake > 0) {
      ox += (Math.random() - 0.5) * this.shake;
      oy += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 30);
    }
    g.save();
    g.translate(ox, oy);
    g.drawImage(this.mapCv, 0, 0);

    // treasures (visible buried in the ground, like the original)
    for (const [i, tid] of view.treasures) {
      const x = (i % MAP_W) * TILE, y = ((i / MAP_W) | 0) * TILE;
      g.drawImage(tid === 255 ? sprites.crate : sprites.gems[tid], x, y);
    }
    // bombs
    for (const b of view.bombs) {
      const [id, wid, bx, by, owner] = b;
      if ((wid === 'mine' || wid === 'remote') && owner !== view.meId) continue;
      g.drawImage(sprites.bombs[wid], (bx - 0.5) * TILE, (by - 0.5) * TILE, TILE, TILE);
      if (wid !== 'mine' && Math.sin(this.animT * 12 + id) > 0.4) {
        g.globalAlpha = 0.6; g.fillStyle = '#ff4020';
        g.fillRect((bx - 0.5) * TILE + 4, (by - 0.5) * TILE + 4, 2, 2);
        g.globalAlpha = 1;
      }
    }
    // fire
    for (const i of view.fires) {
      const x = (i % MAP_W) * TILE, y = ((i / MAP_W) | 0) * TILE;
      const f = Math.sin(this.animT * 17 + i * 3.7) * 0.5 + 0.5;
      g.fillStyle = `rgb(${200 + f * 55},${60 + f * 120},10)`;
      g.fillRect(x, y, TILE, TILE);
      g.fillStyle = `rgba(255,240,120,${0.3 + f * 0.4})`;
      g.fillRect(x + 2, y + 2 + f * 2, TILE - 4, TILE - 4 - f * 2);
    }
    // monsters
    for (const m of view.monsters) {
      const [id, type, mx, my] = m;
      const bob = Math.sin(this.animT * 8 + id);
      g.drawImage(sprites.monsters[type], (mx - 0.5) * TILE, (my - 0.5) * TILE + bob);
    }
    // players
    for (const p of view.players) {
      if (!p.alive) continue;
      const bob = (p.moving || p.digging) ? (((this.animT * 8) | 0) % 2) : 0;
      const spr = sprites.players[p.color];
      g.save();
      if (p.dir === 3) {  // face left: mirror
        g.translate(p.x * TILE, 0); g.scale(-1, 1); g.translate(-p.x * TILE, 0);
      }
      g.drawImage(spr, (p.x - 0.5) * TILE, (p.y - 0.5) * TILE - bob);
      g.restore();
      if (p.digging && bob) {
        g.fillStyle = '#c89050';
        const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][p.dir];
        g.fillRect((p.x + dx * 0.6) * TILE - 1, (p.y + dy * 0.6) * TILE - 1, 3, 3);
      }
      g.font = '8px monospace'; g.textAlign = 'center';
      g.fillStyle = PLAYER_COLORS[p.color].light;
      g.fillText(p.name, p.x * TILE, (p.y - 0.9) * TILE);
    }
    // explosions
    this.fx = this.fx.filter(f => (f.t += dt) < 0.45);
    for (const f of this.fx) {
      const k = f.t / 0.45;
      const rad = f.r * TILE * (0.4 + k * 0.7);
      const gr = g.createRadialGradient(f.x * TILE, f.y * TILE, rad * 0.2, f.x * TILE, f.y * TILE, rad);
      gr.addColorStop(0, `rgba(255,250,200,${0.9 * (1 - k)})`);
      gr.addColorStop(0.5, `rgba(255,140,30,${0.8 * (1 - k)})`);
      gr.addColorStop(1, 'rgba(120,40,10,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(f.x * TILE, f.y * TILE, rad, 0, 7); g.fill();
    }
    // particles
    this.particles = this.particles.filter(p => (p.t -= dt) > 0);
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.2;
      g.fillStyle = p.col;
      g.fillRect(p.x, p.y, 2, 2);
    }
    // floating texts
    this.floats = this.floats.filter(f => (f.t -= dt) > 0);
    g.font = 'bold 9px monospace'; g.textAlign = 'center';
    for (const f of this.floats) {
      f.y -= dt * 14;
      g.fillStyle = f.col; g.globalAlpha = Math.min(1, f.t);
      g.fillText(f.txt, f.x, f.y);
      g.globalAlpha = 1;
    }
    // darkness
    if (view.darkness) {
      const me = view.players.find(p => p.id === view.meId);
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.94)';
      g.beginPath();
      g.rect(0, 0, MAP_W * TILE, MAP_H * TILE);
      if (me && me.alive) {
        const R = 7.5 * TILE;
        g.arc(me.x * TILE, me.y * TILE, R, 0, Math.PI * 2, true);
      }
      g.fill('evenodd');
      if (me && me.alive) {
        const R = 7.5 * TILE;
        const grd = g.createRadialGradient(me.x * TILE, me.y * TILE, R * 0.55, me.x * TILE, me.y * TILE, R);
        grd.addColorStop(0, 'rgba(0,0,0,0)');
        grd.addColorStop(1, 'rgba(0,0,0,0.94)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(me.x * TILE, me.y * TILE, R, 0, 7); g.fill();
      }
      g.restore();
    }
    // timer / round chip over the map corner
    g.font = 'bold 10px monospace'; g.textAlign = 'right';
    const t = Math.max(0, view.timeLeft | 0);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(MAP_W * TILE - 92, 2, 90, 13);
    g.fillStyle = t < 20 ? '#ff5040' : '#e8e0c8';
    g.fillText(`${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}`, MAP_W * TILE - 58, 12);
    g.fillStyle = '#c8a050';
    g.fillText(`R${view.round}/${view.rounds} ♦${view.treasureCount}`, MAP_W * TILE - 4, 12);
    g.restore();

    this.drawHud(view);
  }

  drawHud(view) {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(hudImg, 0, 0);           // original 640x30 HUD strip
    view.players.forEach((p, idx) => {
      if (idx > 3) return;
      const x = idx * 160;
      // name in the black name box
      g.font = 'bold 8px monospace'; g.textAlign = 'left';
      g.fillStyle = p.alive ? PLAYER_COLORS[p.color].light : '#777';
      g.fillText(p.name + (p.alive ? '' : ' ✝'), x + 47, 8);
      // dig power + cash in the value boxes
      g.fillStyle = '#e8e0c8';
      g.fillText(String(p.digPower), x + 66, 18);
      g.fillStyle = '#ffd24a';
      g.fillText('$' + p.cash, x + 66, 27);
      // selected weapon in the left column
      const w = sprites.bombs[p.sel];
      if (w) {
        g.fillStyle = '#000';
        g.fillRect(x + 1, 1, 13, 21);
        g.strokeStyle = p.id === view.meId ? '#ffcc33' : '#555';
        g.strokeRect(x + 1.5, 1.5, 12, 20);
        g.drawImage(w, x + 2, 2, 11, 11);
        g.font = '8px monospace'; g.textAlign = 'center';
        g.fillStyle = '#fff';
        g.fillText(String(p.inv ? (p.inv[p.sel] || 0) : 0), x + 7, 21);
      }
      // wins tally
      g.font = '7px monospace'; g.textAlign = 'left';
      g.fillStyle = '#9f9';
      g.fillText('W' + (p.wins ?? 0), x + 2, 28);
      // health: black out the missing part of the vertical bar
      const hp = Math.max(0, Math.min(100, p.hp)) / 100;
      g.fillStyle = '#000';
      g.fillRect(x + 142, 1, 16, Math.round(28 * (1 - hp)));
      if (!p.alive) { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x + 112, 0, 21, 30); }
    });
    // unused panels dimmed
    for (let idx = view.players.length; idx < 4; idx++) {
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(idx * 160, 0, 160, 30);
    }
  }
}
