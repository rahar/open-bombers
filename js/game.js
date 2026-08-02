// Host-authoritative simulation. Practice mode runs the same code without a network.
import {
  MAP_W, MAP_H, T, TILE_INFO, TREASURES, WEAPON_BY_ID, SELECTABLE,
  MONSTERS, KILL_BOUNTY, SURVIVE_BONUS, walkable, diggable,
} from './const.js';
import { rng } from './map.js';

const PLAYER_R = 0.36;          // collision radius in tiles
const BASE_SPEED = 5.2;         // tiles / second
const DIG_RATE = 60;            // dig hp per second per dig power
const FIRE_TICK = 0.13;
const FIRE_DPS = 55;
const MONSTER_TOUCH_CD = 0.8;

let nextId = 1;

export class Game {
  constructor(options) {
    this.opt = options;               // {rounds,time,treasures,cash,damage,darkness,monsters}
    this.players = [];                // persistent across rounds
    this.round = 0;
    this.phase = 'shop';
    this.events = [];
    this.rnd = rng((Math.random() * 1e9) | 0);
  }

  addPlayer(id, name, color) {
    const p = {
      id, name, color,
      cash: this.opt.cash, digPower: 1, permDig: 1,
      inv: { small: WEAPON_BY_ID.small.start || 0 },
      sel: 'small',
      wins: 0, kills: 0,
      x: 0, y: 0, dir: 2, moving: false, digging: false,
      hp: 100, alive: true,
      input: { dx: 0, dy: 0 },
      digCd: 0, touchCd: 0,
    };
    this.players.push(p);
    return p;
  }
  removePlayer(id) { this.players = this.players.filter(p => p.id !== id); }
  player(id) { return this.players.find(p => p.id === id); }

  // ---- round lifecycle ----
  startRound(map, spawns) {
    this.round++;
    this.phase = 'game';
    this.tiles = map.tiles;
    this.tileHp = new Float32Array(MAP_W * MAP_H);
    this.treasures = new Map(map.treasures);
    this.initialTreasures = [...this.treasures.keys()].filter(i => this.treasures.get(i) !== 255).length;
    this.bombs = [];
    this.fires = new Map();
    this.fireAcc = 0;
    this.timeLeft = this.opt.time;
    this.monsters = [];
    if (this.opt.monsters) {
      for (const m of map.monsters) {
        const info = MONSTERS[m.type];
        if (info) this.monsters.push({
          id: nextId++, type: m.type, x: m.x, y: m.y, hp: info.hp,
          dx: 0, dy: 0, think: 0,
        });
      }
    }
    this.players.forEach((p, i) => {
      const [sx, sy] = spawns[i % spawns.length];
      p.x = sx; p.y = sy; p.hp = 100; p.alive = true;
      p.digPower = p.permDig;
      p.dir = 2; p.moving = false; p.input = { dx: 0, dy: 0 };
      if (!SELECTABLE.some(w => (p.inv[w] || 0) > 0)) p.inv.small = (p.inv.small || 0) + 1;
      if (!((p.inv[p.sel] || 0) > 0)) p.sel = SELECTABLE.find(w => (p.inv[w] || 0) > 0) || 'small';
    });
    this.events = [];
  }

  emit(e) { this.events.push(e); }
  flushEvents() { const ev = this.events; this.events = []; return ev; }

  tileAt(x, y) {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return T.BORDER;
    return this.tiles[(y | 0) * MAP_W + (x | 0)];
  }
  setTile(i, t) { this.tiles[i] = t; this.tileHp[i] = 0; this.emit({ e: 'tile', i, t }); }

  // ---- input from players (host applies directly; net layer routes remote input here) ----
  setInput(pid, inp) {
    const p = this.player(pid);
    if (!p || !p.alive) return;
    if (inp.dx !== undefined) { p.input.dx = Math.sign(inp.dx); p.input.dy = Math.sign(inp.dy); }
    if (inp.sel) this.cycleWeapon(p);
    if (inp.drop) this.dropWeapon(p);
    if (inp.det) this.detonateRemotes(p);
  }

  cycleWeapon(p) {
    const owned = SELECTABLE.filter(w => (p.inv[w] || 0) > 0);
    if (!owned.length) return;
    const cur = owned.indexOf(p.sel);
    p.sel = owned[(cur + 1) % owned.length];
    this.emit({ e: 'sound', s: 'kili', pid: p.id });
  }

  dropWeapon(p) {
    const w = WEAPON_BY_ID[p.sel];
    if (!w || (p.inv[w.id] || 0) <= 0) return;
    const tx = p.x | 0, ty = p.y | 0, i = ty * MAP_W + tx;

    if (w.kind === 'use') {           // medikit
      if (p.hp >= 100) return;
      p.hp = Math.min(100, p.hp + 40);
      p.inv[w.id]--;
      this.emit({ e: 'hurt', pid: p.id, hp: p.hp });
      this.emit({ e: 'sound', s: 'kili' });
      return;
    }
    if (w.kind === 'spray') {         // urethane: fill up to 3 open tiles ahead
      const [dx, dy] = dirVec(p.dir);
      let n = 0;
      for (let k = 1; k <= 3 && n < 3; k++) {
        const x = tx + dx * k, y = ty + dy * k;
        const j = y * MAP_W + x;
        if (this.tileAt(x, y) === T.EMPTY && !this.entityOnTile(x, y)) { this.setTile(j, T.URETHANE); n++; }
        else break;
      }
      if (n) { p.inv[w.id]--; this.emit({ e: 'sound', s: 'urethan' }); }
      return;
    }
    if (w.kind === 'plate') {         // steel plate ahead
      const [dx, dy] = dirVec(p.dir);
      const x = tx + dx, y = ty + dy, j = y * MAP_W + x;
      if (this.tileAt(x, y) === T.EMPTY && !this.entityOnTile(x, y)) {
        this.setTile(j, T.STEEL);
        p.inv[w.id]--;
        this.emit({ e: 'sound', s: 'picaxe' });
      }
      return;
    }
    // bombs / mines / remotes / napalm: one per tile
    if (this.bombs.some(b => (b.x | 0) === tx && (b.y | 0) === ty)) return;
    p.inv[w.id]--;
    const b = {
      id: nextId++, wid: w.id, kind: w.kind, x: tx + 0.5, y: ty + 0.5,
      owner: p.id, fuse: w.kind === 'bomb' || w.kind === 'napalm' ? w.fuse : Infinity,
    };
    this.bombs.push(b);
    this.emit({ e: 'bomb', b: { id: b.id, wid: b.wid, x: b.x, y: b.y, owner: b.owner } });
    this.emit({ e: 'sound', s: 'picaxe' });
  }

  detonateRemotes(p) {
    for (const b of this.bombs) if (b.owner === p.id && b.kind === 'remote') b.fuse = 0.05;
  }

  entityOnTile(x, y) {
    return this.players.some(p => p.alive && (p.x | 0) === x && (p.y | 0) === y)
      || this.monsters.some(m => (m.x | 0) === x && (m.y | 0) === y);
  }

  // ---- main tick ----
  tick(dt) {
    if (this.phase !== 'game') return;
    for (const p of this.players) if (p.alive) this.movePlayer(p, dt);
    for (const p of this.players) if (p.alive) this.collectAt(p);
    this.tickBombs(dt);
    this.tickFire(dt);
    if (this.opt.monsters) this.tickMonsters(dt);
    this.timeLeft -= dt;
    this.checkRoundEnd();
  }

  movePlayer(p, dt) {
    const { dx, dy } = p.input;
    p.moving = false; p.digging = false;
    if (!dx && !dy) return;
    if (dx) p.dir = dx > 0 ? 1 : 3;
    else if (dy) p.dir = dy > 0 ? 2 : 0;
    const sp = BASE_SPEED * dt;
    let nx = p.x, ny = p.y;
    if (dx) nx = moveAxis(this, p.x, p.y, dx * sp, 0);
    if (dy) ny = moveAxis(this, nx, p.y, 0, dy * sp, nx);
    if (nx !== p.x || ny !== p.y) { p.x = nx; p.y = ny; p.moving = true; }
    else {
      // blocked: dig the tile we're pushing against
      const tx = (p.x + dx * (PLAYER_R + 0.18)) | 0;
      const ty = (p.y + dy * (PLAYER_R + 0.18)) | 0;
      this.dig(p, tx, ty, dt);
    }
  }

  dig(p, tx, ty, dt) {
    const i = ty * MAP_W + tx;
    const t = this.tileAt(tx, ty);
    if (!diggable(t)) return;
    const info = TILE_INFO[t];
    if (!isFinite(info.digHp)) return;
    p.digging = true;
    this.tileHp[i] += DIG_RATE * p.digPower * dt;
    if (this.tileHp[i] >= info.digHp) {
      this.setTile(i, T.EMPTY);
      this.emit({ e: 'sound', s: 'picaxe' });
    }
  }

  collectAt(p) {
    const tx = p.x | 0, ty = p.y | 0, i = ty * MAP_W + tx;
    if (this.tiles[i] !== T.EMPTY) return;
    const tid = this.treasures.get(i);
    if (tid === undefined) return;
    this.treasures.delete(i);
    if (tid === 255) {
      // weapon crate: random goodies
      const pool = ['small', 'small', 'big', 'mine', 'remote', 'ureth', 'napalm', 'dyna'];
      const wid = pool[(this.rnd() * pool.length) | 0];
      const n = 1 + ((this.rnd() * 2) | 0);
      p.inv[wid] = (p.inv[wid] || 0) + n;
      this.emit({ e: 'treasure', i, rm: 1 });
      this.emit({ e: 'crate', pid: p.id, wid, n });
    } else {
      const tr = TREASURES[tid];
      p.cash += tr.value;
      this.emit({ e: 'treasure', i, rm: 1 });
      this.emit({ e: 'pickup', pid: p.id, tid, value: tr.value, cash: p.cash, x: tx, y: ty });
    }
    this.emit({ e: 'sound', s: 'kili' });
  }

  tickBombs(dt) {
    for (const b of this.bombs) {
      if (b.kind === 'mine') {
        const victim = this.players.find(p => p.alive && p.id !== b.owner && Math.hypot(p.x - b.x, p.y - b.y) < 0.55)
          || this.monsters.find(m => Math.hypot(m.x - b.x, m.y - b.y) < 0.55);
        if (victim) b.fuse = 0.02;
      }
      if (isFinite(b.fuse)) b.fuse -= dt;
    }
    const exploding = this.bombs.filter(b => b.fuse <= 0);
    if (exploding.length) {
      this.bombs = this.bombs.filter(b => b.fuse > 0);
      for (const b of exploding) this.explode(b);
    }
  }

  explode(b) {
    const w = WEAPON_BY_ID[b.wid];
    const cx = b.x, cy = b.y, r = w.radius, power = w.power;
    this.emit({ e: 'boom', x: cx, y: cy, r, big: r >= 4, id: b.id });
    this.emit({ e: 'sound', s: r >= 5 ? 'explos3' : r >= 3.5 ? 'explos1' : 'pikkupom' });

    // terrain
    for (let y = Math.max(1, cy - r) | 0; y <= Math.min(MAP_H - 2, cy + r) | 0; y++) {
      for (let x = Math.max(1, cx - r) | 0; x <= Math.min(MAP_W - 2, cx + r) | 0; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const i = y * MAP_W + x;
        const t = this.tiles[i];
        if (t === T.BORDER || t === T.EMPTY) continue;
        // power falls off toward the blast edge; edges of hard rock crumble more easily than cores
        const eff = power * (d < r * 0.55 ? 1 : 0.6);
        const hard = TILE_INFO[t].hard;
        if (hard <= eff) {
          if (this.treasures.has(i)) {
            const tid = this.treasures.get(i);
            if (this.rnd() < 0.55 && tid !== 255) { this.treasures.delete(i); this.emit({ e: 'treasure', i, rm: 1 }); }
          }
          this.setTile(i, T.EMPTY);
        } else if (hard <= eff + 1.2) {
          this.tileHp[i] += TILE_INFO[t].digHp * 0.55;
          if (this.tileHp[i] >= TILE_INFO[t].digHp) this.setTile(i, T.EMPTY);
        }
      }
    }
    // players & monsters
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < r + PLAYER_R) {
        const dmg = w.dmg * Math.max(0.15, 1 - d / (r + 0.5)) * this.opt.damage;
        this.hurtPlayer(p, dmg, b.owner);
      }
    }
    for (const m of this.monsters) {
      const d = Math.hypot(m.x - cx, m.y - cy);
      if (d < r + 0.4) this.hurtMonster(m, w.dmg * Math.max(0.2, 1 - d / (r + 0.5)), b.owner);
    }
    // chain reactions
    for (const ob of this.bombs) {
      const d = Math.hypot(ob.x - cx, ob.y - cy);
      if (d < r && ob.fuse > 0.18) ob.fuse = 0.12 + this.rnd() * 0.12;
    }
    // napalm ignition
    if (b.kind === 'napalm') {
      const budget = { left: 75 };
      this.igniteTile(cx | 0, cy | 0, budget);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.igniteTile((cx | 0) + dx, (cy | 0) + dy, budget);
    }
  }

  igniteTile(x, y, budget) {
    if (x < 1 || y < 1 || x >= MAP_W - 1 || y >= MAP_H - 1) return;
    const i = y * MAP_W + x;
    const t = this.tiles[i];
    if (t !== T.EMPTY && t !== T.URETHANE && t !== T.DIRT) return;
    if (this.fires.has(i) || budget.left <= 0) return;
    if (t !== T.EMPTY) this.setTile(i, T.EMPTY);   // napalm burns dirt & urethane away
    budget.left--;
    this.fires.set(i, { life: 2.2 + this.rnd() * 1.6, budget });
    this.emit({ e: 'fire', add: [i] });
  }

  tickFire(dt) {
    if (!this.fires.size) return;
    this.fireAcc += dt;
    const doSpread = this.fireAcc >= FIRE_TICK;
    if (doSpread) this.fireAcc = 0;
    const rm = [];
    for (const [i, f] of this.fires) {
      f.life -= dt;
      if (f.life <= 0) { this.fires.delete(i); rm.push(i); continue; }
      if (doSpread && f.budget.left > 0 && this.rnd() < 0.75) {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const [dx, dy] = dirs[(this.rnd() * 4) | 0];
        const x = (i % MAP_W) + dx, y = ((i / MAP_W) | 0) + dy;
        const t = this.tileAt(x, y);
        if (t === T.EMPTY || t === T.URETHANE) this.igniteTile(x, y, f.budget);
      }
    }
    if (rm.length) this.emit({ e: 'fire', rm });
    // burn entities
    for (const p of this.players) {
      if (p.alive && this.fires.has((p.y | 0) * MAP_W + (p.x | 0))) this.hurtPlayer(p, FIRE_DPS * dt * this.opt.damage, null);
    }
    for (const m of this.monsters) {
      if (this.fires.has((m.y | 0) * MAP_W + (m.x | 0))) this.hurtMonster(m, FIRE_DPS * dt, null);
    }
  }

  hurtPlayer(p, dmg, byId) {
    if (!p.alive) return;
    p.hp -= dmg;
    this.emit({ e: 'hurt', pid: p.id, hp: p.hp });
    if (p.hp <= 0) {
      p.alive = false; p.hp = 0;
      const killer = byId != null && byId !== p.id ? this.player(byId) : null;
      if (killer && killer.alive) { killer.cash += KILL_BOUNTY; killer.kills++; }
      this.emit({ e: 'die', pid: p.id, by: killer ? killer.id : null, bounty: killer ? KILL_BOUNTY : 0 });
      this.emit({ e: 'sound', s: 'aargh' });
    }
  }

  hurtMonster(m, dmg, byId) {
    m.hp -= dmg;
    if (m.hp <= 0 && !m.dead) {
      m.dead = true;
      const info = MONSTERS[m.type];
      const killer = byId != null ? this.player(byId) : null;
      if (killer) killer.cash += info.bounty;
      this.monsters = this.monsters.filter(x => x !== m);
      this.emit({ e: 'mdie', mid: m.id, x: m.x, y: m.y, bounty: killer ? info.bounty : 0, pid: killer ? killer.id : null });
      this.emit({ e: 'sound', s: 'karjaisu' });
    }
  }

  tickMonsters(dt) {
    for (const m of this.monsters) {
      const info = MONSTERS[m.type];
      m.think -= dt;
      if (m.think <= 0) {
        m.think = 0.3 + this.rnd() * 0.4;
        let target = null, best = 9;
        for (const p of this.players) {
          if (!p.alive) continue;
          const d = Math.hypot(p.x - m.x, p.y - m.y);
          if (d < best) { best = d; target = p; }
        }
        if (target) {
          const ax = target.x - m.x, ay = target.y - m.y;
          if (Math.abs(ax) > Math.abs(ay)) { m.dx = Math.sign(ax); m.dy = 0; }
          else { m.dx = 0; m.dy = Math.sign(ay); }
          if (this.rnd() < 0.25) { const t = m.dx; m.dx = m.dy; m.dy = t; } // wobble
        } else {
          const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]];
          [m.dx, m.dy] = dirs[(this.rnd() * 5) | 0];
        }
      }
      const sp = info.speed * dt;
      let nx = m.x, ny = m.y;
      if (m.dx) nx = moveAxis(this, m.x, m.y, m.dx * sp, 0, undefined, 0.3);
      if (m.dy) ny = moveAxis(this, nx, m.y, 0, m.dy * sp, nx, 0.3);
      if (nx === m.x && ny === m.y) m.think = 0; else { m.x = nx; m.y = ny; }
      // touch damage
      m.touchCd = (m.touchCd || 0) - dt;
      if (m.touchCd <= 0) {
        for (const p of this.players) {
          if (p.alive && Math.hypot(p.x - m.x, p.y - m.y) < 0.6) {
            this.hurtPlayer(p, info.dmg * this.opt.damage, null);
            m.touchCd = MONSTER_TOUCH_CD;
            break;
          }
        }
      }
    }
  }

  checkRoundEnd() {
    let reason = null;
    const alive = this.players.filter(p => p.alive);
    const realTreasures = [...this.treasures.values()].filter(t => t !== 255).length;
    if (this.timeLeft <= 0) reason = 'Time is up!';
    else if (this.initialTreasures > 0 && realTreasures === 0) reason = 'All treasures collected!';
    else if (this.players.length >= 2 && alive.length <= 1) reason = alive.length ? `${alive[0].name} is the last one standing!` : 'Everybody died!';
    else if (this.players.length === 1 && alive.length === 0) reason = 'You died!';
    if (!reason) return;
    this.phase = 'shop';
    for (const p of alive) p.cash += SURVIVE_BONUS;
    let best = null;
    for (const p of this.players) if (p.alive && (!best || p.cash > best.cash)) best = p;
    if (best) best.wins++;
    this.emit({
      e: 'roundend', reason,
      final: this.round >= this.opt.rounds,
      players: this.players.map(p => ({ id: p.id, name: p.name, cash: p.cash, wins: p.wins, kills: p.kills, alive: p.alive })),
    });
    this.emit({ e: 'sound', s: 'applause' });
  }

  // ---- shop (host validates) ----
  buy(pid, wid) {
    const p = this.player(pid);
    const w = WEAPON_BY_ID[wid];
    if (!p || !w || this.phase !== 'shop' || p.cash < w.price) return false;
    p.cash -= w.price;
    if (w.kind === 'perm') p.permDig += w.digBonus;
    else p.inv[wid] = (p.inv[wid] || 0) + 1;
    return true;
  }
  sell(pid, wid) {
    const p = this.player(pid);
    const w = WEAPON_BY_ID[wid];
    if (!p || !w || w.kind === 'perm' || this.phase !== 'shop' || !(p.inv[wid] > 0)) return false;
    p.inv[wid]--;
    p.cash += Math.floor(w.price * 0.7);
    return true;
  }

  snapshot() {
    return {
      t: this.timeLeft,
      p: this.players.map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), p.dir, Math.round(p.hp), p.alive ? 1 : 0, p.sel, p.moving ? 1 : 0, p.digging ? 1 : 0, p.cash, p.digPower, p.inv[p.sel] || 0, p.wins]),
      m: this.monsters.map(m => [m.id, m.type, +m.x.toFixed(2), +m.y.toFixed(2)]),
      b: this.bombs.map(b => [b.id, b.wid, b.x, b.y, b.owner]),
    };
  }
}

function dirVec(dir) { return [[0, -1], [1, 0], [0, 1], [-1, 0]][dir]; }

// axis-separated collision against solid tiles;
// returns the new coordinate for whichever axis has a non-zero delta (x if both are zero)
function moveAxis(g, x, y, dx, dy, _nx, r = PLAYER_R) {
  let nx = x + dx, ny = y + dy;
  if (!dx && !dy) return x;
  if (dx) {
    const edge = nx + Math.sign(dx) * r;
    const tx = edge | 0;
    for (const ty of [Math.floor(y - r + 0.02), Math.floor(y + r - 0.02)]) {
      if (!walkable(g.tileAt(tx, ty))) {
        nx = Math.sign(dx) > 0 ? tx - r - 0.001 : tx + 1 + r + 0.001;
        break;
      }
    }
    // gentle corner slide: nudge toward tile center on the free axis
    return nx;
  }
  if (dy) {
    const edge = ny + Math.sign(dy) * r;
    const ty = edge | 0;
    const px = _nx !== undefined ? _nx : x;
    for (const tx of [Math.floor(px - r + 0.02), Math.floor(px + r - 0.02)]) {
      if (!walkable(g.tileAt(tx, ty))) {
        ny = Math.sign(dy) > 0 ? ty - r - 0.001 : ty + 1 + r + 0.001;
        break;
      }
    }
    return ny;
  }
  return dx ? nx : ny;
}

export { moveAxis, PLAYER_R, BASE_SPEED };
