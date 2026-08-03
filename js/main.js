// App orchestration: menus, lobby, shop, input, host & client game loops.
import { MAP_W, MAP_H, T, WEAPONS, WEAPON_BY_ID, SELECTABLE, TREASURES, PLAYER_COLORS, LEVELS, TICK_RATE } from './const.js';
import { loadLevel, generateMap, carveSpawns, pickRandomLevel, sprinkleTreasures, encodeMap, decodeMap, rng } from './map.js';
import { Game, moveAxis } from './game.js';
import { loadAssets, sprites, Renderer } from './render.js';
import { initAudio, playSound, playBoom, playMusic, stopMusic } from './audio.js';
import { Host, Client, Directory, makeCode } from './net.js';

const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');
const screens = ['menu', 'join', 'lobby', 'shop', 'results'];
function screen(name) { for (const s of screens) (s === name ? show : hide)(s); }
function screenNone() { for (const s of screens) hide(s); }

const renderer = new Renderer($('game'));
const assetsReady = loadAssets().catch(e => { console.error('asset load failed', e); });

// ---------------- state ----------------
const S = {
  mode: null,          // 'host' | 'client' | 'practice'
  net: null,           // Host or Client instance
  game: null,          // Game (host/practice only)
  dir: null,           // Directory (public game list)
  roomCode: null,
  started: false,      // host: first round has begun, no more joins
  myId: 0,
  options: null,
  lobby: [],           // [{pid,name,color}]
  ready: new Set(),
  playing: false,
  // client replica
  rep: null,
  pred: { x: 0, y: 0 },
  shopMe: null,        // {cash, inv, permDig}
  final: false,
};

window.__ob = S;   // debug handle

function readOptions() {
  return {
    rounds: +$('opt-rounds').value,
    time: +$('opt-time').value,
    treasures: +$('opt-treasures').value,
    cash: +$('opt-cash').value,
    damage: +$('opt-damage').value,
    darkness: +$('opt-darkness').value === 1,
    monsters: +$('opt-monsters').value === 1,
    level: $('opt-level').value,
  };
}
function myName() { return ($('opt-name').value.trim() || 'MINER').toUpperCase().slice(0, 10); }
function myColor() { return +$('opt-color').value; }

// populate level list
{
  const sel = $('opt-level');
  const gen = document.createElement('option');
  gen.value = 'generated'; gen.textContent = 'Generated caves';
  sel.appendChild(gen);
  for (const l of LEVELS) {
    const o = document.createElement('option');
    o.value = l; o.textContent = l.toUpperCase();
    sel.appendChild(o);
  }
  $('opt-name').value = 'MINER' + ((Math.random() * 90 + 10) | 0);
}

// ---------------- input ----------------
const held = { up: 0, down: 0, left: 0, right: 0 };
let lastSent = { dx: 0, dy: 0 };

function curDir() {
  return { dx: held.right - held.left, dy: held.down - held.up };
}
function pushInput() {
  const d = curDir();
  if (d.dx === lastSent.dx && d.dy === lastSent.dy) return;
  lastSent = d;
  if (S.mode === 'client') S.net.send({ t: 'in', ...d });
  else if (S.game) S.game.setInput(S.myId, d);
}
function action(a) {
  if (!S.playing) return;
  if (S.mode === 'client') S.net.send({ t: 'act', a });
  else if (S.game) S.game.setInput(S.myId, { [a]: 1 });
}

const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
};
window.addEventListener('keydown', e => {
  if (!S.playing || e.repeat) return;
  const k = KEYMAP[e.code];
  if (k) { held[k] = 1; pushInput(); e.preventDefault(); return; }
  if (e.code === 'Space') { action('drop'); e.preventDefault(); }
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Tab') { action('sel'); e.preventDefault(); }
  else if (e.code === 'KeyX' || e.code === 'ControlLeft' || e.code === 'ControlRight') { action('det'); e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (k) { held[k] = 0; pushInput(); }
});

// ---------------- lobby UI ----------------
function renderLobby() {
  const ul = $('lobby-players');
  ul.innerHTML = '';
  for (const p of S.lobby) {
    const li = document.createElement('li');
    li.textContent = `● ${p.name}`;
    li.style.color = PLAYER_COLORS[p.color].light;
    ul.appendChild(li);
  }
  if (S.mode === 'host') {
    $('btn-start').classList.toggle('hidden', false);
    $('btn-start').disabled = S.lobby.length < 1;
    $('lobby-status').textContent = S.lobby.length < 2 ? 'Waiting for players… (you can also start solo)' : '';
  } else {
    $('btn-start').classList.add('hidden');
    $('lobby-status').textContent = 'Waiting for the host to start…';
  }
}

function freeColor(want) {
  const used = S.lobby.map(p => p.color);
  if (!used.includes(want)) return want;
  for (let c = 0; c < PLAYER_COLORS.length; c++) if (!used.includes(c)) return c;
  return want;
}

// ---------------- host ----------------
$('btn-host').onclick = async () => {
  await initAudio(); await assetsReady;
  playMusic('huippe');
  const code = makeCode();
  S.mode = 'host';
  S.myId = 0;
  S.options = readOptions();
  S.game = new Game(S.options);
  S.lobby = [{ pid: 0, name: myName(), color: myColor() }];
  S.ready = new Set();
  $('room-code').textContent = '…';
  screen('lobby');
  renderLobby();

  let nextPid = 1;
  S.roomCode = code;
  S.started = false;
  S.net = new Host(code, {
    onReady: () => {
      $('room-code').textContent = code;
      startAnnouncing();
    },
    onError: err => {
      if (err.type === 'unavailable-id') location.reload();
      else $('lobby-status').textContent = 'Network error: ' + (err.type || err.message);
    },
    onJoin: conn => {
      if (S.started || S.playing || S.game.round > 0) { S.net.sendTo(conn, { t: 'reject', reason: 'Game already running.' }); return; }
      if (S.lobby.length >= 4) { S.net.sendTo(conn, { t: 'reject', reason: 'Room is full (4 players).' }); return; }
      const meta = conn.metadata || {};
      const pid = nextPid++;
      conn._pid = pid;
      const p = { pid, name: (meta.name || 'GUEST').slice(0, 10), color: freeColor(meta.color | 0) };
      S.lobby.push(p);
      S.net.sendTo(conn, { t: 'hello', pid, options: S.options });
      broadcastLobby();
      renderLobby();
    },
    onLeave: conn => {
      const pid = conn._pid;
      S.lobby = S.lobby.filter(p => p.pid !== pid);
      S.ready.delete(pid);
      if (S.game) S.game.removePlayer(pid);
      broadcastLobby();
      renderLobby();
      checkAllReady();
    },
    onData: (conn, msg) => hostOnData(conn, msg),
  });
};

function broadcastLobby() {
  S.net && S.net.broadcast({ t: 'lobby', players: S.lobby });
  if (S.mode === 'host') announceGame();
}

// ---------------- public game directory ----------------
function announceGame() {
  if (!S.dir || !S.roomCode || S.started) return;
  S.dir.announce({
    code: S.roomCode,
    host: myName(),
    players: S.lobby.length,
    max: 4,
  });
}

function startAnnouncing() {
  if (S.dir) return;
  S.dir = new Directory({});
  announceGame();
  S.announceTimer = setInterval(announceGame, 8000);
}

function stopAnnouncing() {
  clearInterval(S.announceTimer);
  if (S.dir) {
    if (S.roomCode) S.dir.withdraw(S.roomCode);
    const dir = S.dir;
    S.dir = null;
    setTimeout(() => dir.destroy(), 500);   // let the withdraw flush first
  }
}

function renderPublicGames(list) {
  const box = $('public-games');
  if (!box) return;
  box.innerHTML = '';
  const open = (list || []).filter(g => g.players < g.max);
  if (!open.length) {
    box.innerHTML = '<p class="hint pg-empty">No public games right now — host one!</p>';
    return;
  }
  for (const g of open) {
    const row = document.createElement('div');
    row.className = 'pg-row';
    const name = document.createElement('span');
    name.className = 'pg-name';
    name.textContent = `${g.host}'s game`;
    const info = document.createElement('span');
    info.className = 'pg-info';
    info.textContent = `${g.players}/${g.max} players · ${g.code}`;
    const btn = document.createElement('button');
    btn.textContent = 'JOIN';
    btn.onclick = () => {
      $('join-code').value = g.code;
      $('btn-join-go').click();
    };
    row.appendChild(name); row.appendChild(info); row.appendChild(btn);
    box.appendChild(row);
  }
}

function hostOnData(conn, msg) {
  const pid = conn._pid;
  const g = S.game;
  switch (msg.t) {
    case 'in': g.setInput(pid, { dx: msg.dx | 0, dy: msg.dy | 0 }); break;
    case 'act': g.setInput(pid, { [msg.a]: 1 }); break;
    case 'buy':
      if (g.buy(pid, msg.wid)) sendShopUpdate(pid);
      break;
    case 'sell':
      if (g.sell(pid, msg.wid)) sendShopUpdate(pid);
      break;
    case 'ready':
      S.ready.add(pid);
      broadcastReady();
      checkAllReady();
      break;
  }
}

function sendShopUpdate(pid) {
  const p = S.game.player(pid);
  S.net && S.net.broadcast({ t: 'shopup', pid, cash: p.cash, inv: p.inv, digPower: p.permDig });
  renderShopIfOpen();
}
function broadcastReady() {
  S.net && S.net.broadcast({ t: 'readyup', ready: [...S.ready] });
  updateShopStatus();
}

$('btn-start').onclick = () => hostEnterShop(true);

function hostEnterShop(firstTime) {
  // materialize lobby into game players on first start
  if (firstTime) {
    for (const lp of S.lobby) if (!S.game.player(lp.pid)) S.game.addPlayer(lp.pid, lp.name, lp.color);
    S.started = true;
    stopAnnouncing();
  }
  S.game.phase = 'shop';
  S.ready = new Set();
  for (const conn of S.net ? S.net.conns.values() : []) {
    const p = S.game.player(conn._pid);
    if (p) S.net.sendTo(conn, { t: 'shop', round: S.game.round + 1, rounds: S.options.rounds, you: { cash: p.cash, inv: p.inv, permDig: p.permDig } });
  }
  openShop(S.game.player(S.myId));
}

function checkAllReady() {
  if (S.mode !== 'host' && S.mode !== 'practice') return;
  if (!S.game || S.game.phase !== 'shop') return;
  const need = S.game.players.map(p => p.id);
  if (need.every(id => S.ready.has(id))) hostStartRound();
}

async function hostStartRound() {
  const opt = S.options;
  const seed = (Math.random() * 1e9) | 0;
  const rnd = rng(seed);
  let map;
  const pick = opt.level === 'random' ? pickRandomLevel(rnd) : opt.level;
  if (pick === 'generated') {
    map = generateMap(seed, opt.treasures, opt.monsters);
  } else {
    map = await loadLevel(pick, opt.monsters);
    sprinkleTreasures(map, opt.treasures, rnd);
  }
  const spawns = carveSpawns(map, Math.max(2, S.game.players.length));
  S.game.startRound(map, spawns);
  renderer.drawFullMap(S.game.tiles);
  renderer.fx = []; renderer.particles = []; renderer.floats = [];

  if (S.net) {
    const enc = encodeMap({ tiles: S.game.tiles, treasures: S.game.treasures, monsters: [] });
    S.net.broadcast({
      t: 'round',
      round: S.game.round, rounds: opt.rounds, time: opt.time,
      darkness: opt.darkness,
      enc,
      players: S.game.players.map(p => ({ pid: p.id, name: p.name, color: p.color, x: p.x, y: p.y })),
    });
  }
  screenNone();
  S.playing = true;
  playMusic('oeku');
}

// host simulation runs on a timer so it survives tab-backgrounding;
// browsers throttle timers in hidden tabs, so run catch-up steps based on real elapsed time
let lastTick = performance.now();
setInterval(() => {
  if ((S.mode !== 'host' && S.mode !== 'practice') || !S.playing || !S.game) { lastTick = performance.now(); return; }
  const now = performance.now();
  const steps = Math.max(1, Math.min(45, Math.round((now - lastTick) * TICK_RATE / 1000)));
  lastTick = now;
  for (let i = 0; i < steps; i++) {
    S.game.tick(1 / TICK_RATE);
    hostTickNo++;
  }
  const events = S.game.flushEvents();
  if (events.length) {
    applyEvents(events, true);
    S.net && S.net.broadcast({ t: 'ev', v: events });
  }
  if (S.net && hostTickNo >= 2) { hostTickNo = 0; S.net.broadcast({ t: 'st', s: S.game.snapshot() }); }
}, 1000 / TICK_RATE);
let hostTickNo = 0;

// ---------------- practice ----------------
$('btn-practice').onclick = async () => {
  await initAudio(); await assetsReady;
  playMusic('huippe');
  S.mode = 'practice';
  S.myId = 0;
  S.options = readOptions();
  S.game = new Game(S.options);
  S.lobby = [{ pid: 0, name: myName(), color: myColor() }];
  S.game.addPlayer(0, myName(), myColor());
  S.game.phase = 'shop';
  S.ready = new Set();
  openShop(S.game.player(0));
};

// ---------------- client ----------------
$('btn-join').onclick = () => {
  screen('join');
  $('join-code').value = '';
  $('join-status').textContent = '';
  $('join-code').focus();
  if (!S.dir) S.dir = new Directory({ onGames: renderPublicGames });
};
$('btn-join-back').onclick = () => {
  if (S.dir) { S.dir.destroy(); S.dir = null; }
  screen('menu');
};
$('btn-join-go').onclick = async () => {
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length !== 4) { $('join-status').textContent = 'Code is 4 characters.'; return; }
  await initAudio(); await assetsReady;
  playMusic('huippe');
  $('join-status').textContent = 'Connecting…';
  S.mode = 'client';
  S.net = new Client(code, { name: myName(), color: myColor() }, {
    onOpen: () => { $('join-status').textContent = 'Connected, waiting for host…'; },
    onError: err => { $('join-status').textContent = err.message || ('Error: ' + err.type); },
    onClose: () => {
      alert('Connection to host lost.');
      location.reload();
    },
    onData: msg => clientOnData(msg),
  });
};

function clientOnData(msg) {
  switch (msg.t) {
    case 'reject':
      $('join-status').textContent = msg.reason;
      S.net.destroy(); S.net = null; S.mode = null;
      break;
    case 'hello':
      S.myId = msg.pid;
      S.options = msg.options;
      if (S.dir) { S.dir.destroy(); S.dir = null; }   // done browsing
      screen('lobby');
      $('room-code').textContent = $('join-code').value.trim().toUpperCase();
      break;
    case 'lobby':
      S.lobby = msg.players;
      renderLobby();
      break;
    case 'shop':
      S.playing = false;
      S.shopMe = msg.you;
      S.shopRound = msg.round; S.shopRounds = msg.rounds;
      S.ready = new Set();
      openShop(null);
      break;
    case 'shopup':
      if (msg.pid === S.myId && S.shopMe) { S.shopMe.cash = msg.cash; S.shopMe.inv = msg.inv; S.shopMe.permDig = msg.digPower; renderShopIfOpen(); }
      break;
    case 'readyup':
      S.ready = new Set(msg.ready);
      updateShopStatus();
      break;
    case 'round': clientStartRound(msg); break;
    case 'st': clientSnapshot(msg.s); break;
    case 'ev': applyEvents(msg.v, false); break;
  }
}

function clientStartRound(msg) {
  const map = decodeMap(msg.enc);
  S.rep = {
    tiles: map.tiles,
    treasures: map.treasures,
    fires: new Set(),
    bombs: [],
    timeLeft: msg.time,
    round: msg.round, rounds: msg.rounds,
    darkness: msg.darkness,
    players: new Map(msg.players.map(p => [p.pid, {
      id: p.pid, name: p.name, color: p.color,
      x: p.x, y: p.y, tx: p.x, ty: p.y,
      dir: 2, hp: 100, alive: true, sel: 'small', moving: false, digging: false,
      cash: 0, digPower: 1, inv: {}, wins: 0,
    }])),
    monsters: new Map(),
  };
  const me = S.rep.players.get(S.myId);
  S.pred = { x: me.x, y: me.y };
  renderer.drawFullMap(map.tiles);
  renderer.fx = []; renderer.particles = []; renderer.floats = [];
  screenNone();
  S.playing = true;
  playMusic('oeku');
}

function clientSnapshot(s) {
  if (!S.rep) return;
  S.rep.timeLeft = s.t;
  const seen = new Set();
  for (const row of s.p) {
    const [id, x, y, dir, hp, alive, sel, moving, digging, cash, digPower, selCount, wins] = row;
    const p = S.rep.players.get(id);
    if (!p) continue;
    seen.add(id);
    p.tx = x; p.ty = y;
    if (id === S.myId) {
      // reconcile prediction
      const err = Math.hypot(S.pred.x - x, S.pred.y - y);
      if (err > 1.2 || !alive) { S.pred.x = x; S.pred.y = y; }
      else { S.pred.x += (x - S.pred.x) * 0.18; S.pred.y += (y - S.pred.y) * 0.18; }
    } else { p.dir = dir; p.moving = !!moving; p.digging = !!digging; }
    p.hp = hp; p.alive = !!alive; p.sel = sel;
    p.cash = cash; p.digPower = digPower; p.inv = { [sel]: selCount }; p.wins = wins;
  }
  const monsterSeen = new Set();
  for (const [id, type, x, y] of s.m) {
    monsterSeen.add(id);
    let m = S.rep.monsters.get(id);
    if (!m) { m = { id, type, x, y, tx: x, ty: y }; S.rep.monsters.set(id, m); }
    m.tx = x; m.ty = y;
  }
  for (const id of [...S.rep.monsters.keys()]) if (!monsterSeen.has(id)) S.rep.monsters.delete(id);
  S.rep.bombs = s.b;
}

// ---------------- shared event application (FX + client replica) ----------------
function applyEvents(events, isHost) {
  const tiles = isHost ? (S.game && S.game.tiles) : (S.rep && S.rep.tiles);
  for (const ev of events) {
    switch (ev.e) {
      case 'tile':
        if (!tiles) break;
        if (!isHost) tiles[ev.i] = ev.t;
        renderer.patchTile(tiles, ev.i);
        break;
      case 'treasure':
        if (!isHost && S.rep) S.rep.treasures.delete(ev.i);
        break;
      case 'fire':
        if (!isHost && S.rep) {
          for (const i of ev.add || []) S.rep.fires.add(i);
          for (const i of ev.rm || []) S.rep.fires.delete(i);
        }
        break;
      case 'boom':
        renderer.addBoom(ev.x, ev.y, ev.r, ev.big);
        break;
      case 'pickup': {
        renderer.addFloat(ev.x, ev.y - 0.5, `+$${ev.value}`);
        break;
      }
      case 'crate':
        if (ev.pid === S.myId) renderer.addFloat(predPos().x, predPos().y - 1, `${ev.n}× ${WEAPON_BY_ID[ev.wid].name}`, '#66bfff');
        break;
      case 'die': {
        const name = playerName(ev.pid);
        renderer.addFloat(posOf(ev.pid).x, posOf(ev.pid).y - 1, `☠ ${name}`, '#ff5040');
        if (ev.by != null) renderer.addFloat(posOf(ev.by).x, posOf(ev.by).y - 1, `+$${ev.bounty}`, '#7fff5c');
        break;
      }
      case 'mdie':
        if (ev.bounty && ev.pid != null) renderer.addFloat(ev.x, ev.y - 0.5, `+$${ev.bounty}`, '#7fff5c');
        break;
      case 'sound':
        playSound(ev.s);
        break;
      case 'roundend':
        onRoundEnd(ev);
        break;
    }
  }
}
function playerName(pid) {
  const lp = S.lobby.find(p => p.pid === pid);
  return lp ? lp.name : '?';
}
function posOf(pid) {
  if (S.mode === 'client') {
    const p = S.rep && S.rep.players.get(pid);
    return p ? { x: p.tx, y: p.ty } : { x: MAP_W / 2, y: MAP_H / 2 };
  }
  const p = S.game && S.game.player(pid);
  return p ? { x: p.x, y: p.y } : { x: MAP_W / 2, y: MAP_H / 2 };
}
function predPos() { return S.mode === 'client' ? S.pred : posOf(S.myId); }

// ---------------- round end / results ----------------
function onRoundEnd(ev) {
  S.playing = false;
  S.final = ev.final;
  setTimeout(() => {
    const sorted = [...ev.players].sort((a, b) => b.cash - a.cash || b.wins - a.wins);
    $('results-title').textContent = ev.final ? 'GAME OVER' : `ROUND OVER`;
    let html = `<p style="color:#ffcc33">${ev.reason}</p>`;
    // winner portrait from the original game art
    if (sorted.length) {
      const winLobby = S.lobby.find(l => l.pid === sorted[0].id);
      if (winLobby !== undefined) {
        const pfx = ['pun', 'sin', 'vih', 'kel'][winLobby.color] || 'pun';
        const kind = ev.final ? 'voit' : (sorted.length > 1 && sorted[0].cash === sorted[1].cash ? 'draw' : 'voit');
        html += `<img src="assets/gfx/portraits/${pfx}${kind}.png" alt="" style="height:120px;image-rendering:pixelated;margin:4px auto;display:block">`;
      }
    }
    sorted.forEach((p, i) => {
      const win = ev.final && i === 0;
      html += `<div class="r-row ${win ? 'winner' : ''}"><span>${win ? '👑 ' : ''}${p.name}</span><span>$${p.cash} · ${p.wins} wins · ${p.kills} kills</span></div>`;
    });
    if (ev.final && sorted.length > 1) html += `<p style="color:#7fff5c;margin-top:10px">${sorted[0].name} WINS THE GAME!</p>`;
    $('results-body').innerHTML = html;
    $('btn-results-ok').classList.toggle('hidden', S.mode === 'client');
    $('btn-results-ok').textContent = ev.final ? 'REMATCH — BACK TO SHOP' : 'CONTINUE TO SHOP';
    screen('results');
  }, 1200);
}

$('btn-results-ok').onclick = () => {
  if (S.mode === 'client') return;
  if (S.final) {
    // rematch: reset the match, keep the lobby
    S.game.round = 0;
    for (const p of S.game.players) {
      p.cash = S.options.cash; p.wins = 0; p.kills = 0; p.permDig = 1;
      p.inv = { small: WEAPON_BY_ID.small.start || 0 };
      p.sel = 'small';
    }
    S.final = false;
  }
  if (S.mode === 'practice') { S.ready = new Set(); S.game.phase = 'shop'; openShop(S.game.player(0)); }
  else hostEnterShop(false);
};

// ---------------- shop ----------------
let shopOpen = false;

function shopData() {
  if (S.mode === 'client') return S.shopMe;
  const p = S.game.player(S.myId);
  return p ? { cash: p.cash, inv: p.inv, permDig: p.permDig } : null;
}

function openShop(_p) {
  shopOpen = true;
  playMusic('huippe');
  const round = S.mode === 'client' ? S.shopRound : S.game.round + 1;
  const rounds = S.mode === 'client' ? S.shopRounds : S.options.rounds;
  $('shop-round').textContent = `ROUND ${Math.min(round, rounds)}/${rounds}`;
  $('btn-ready').disabled = false;
  $('btn-ready').textContent = 'READY — ENTER MINE';
  buildShopGrid();
  renderShopIfOpen();
  updateShopStatus();
  screen('shop');
}

function buildShopGrid() {
  const grid = $('shop-grid');
  grid.innerHTML = '';
  for (const w of WEAPONS) {
    const div = document.createElement('div');
    div.className = 'shop-item';
    div.dataset.wid = w.id;
    const icon = document.createElement('canvas');
    icon.width = 16; icon.height = 16;
    icon.style.width = '40px'; icon.style.height = '40px';
    const ig = icon.getContext('2d');
    ig.imageSmoothingEnabled = false;
    if (sprites.bombs && sprites.bombs[w.id]) ig.drawImage(sprites.bombs[w.id], 0, 0, 16, 16);
    const info = document.createElement('div');
    info.className = 'si-info';
    div.appendChild(icon); div.appendChild(info);
    div.onclick = () => shopBuy(w.id);
    div.oncontextmenu = e => { e.preventDefault(); shopSell(w.id); };
    grid.appendChild(div);
  }
}

function renderShopIfOpen() {
  if (!shopOpen) return;
  const me = shopData();
  if (!me) return;
  $('shop-cash').textContent = me.cash;
  for (const div of $('shop-grid').children) {
    const w = WEAPON_BY_ID[div.dataset.wid];
    const owned = w.kind === 'perm' ? null : (me.inv[w.id] || 0);
    const info = div.querySelector('.si-info');
    info.innerHTML = `<div class="si-name">${w.name}</div>` +
      `<div><span class="si-price">$${w.price}</span>` +
      (owned !== null ? ` · <span class="si-owned">own ${owned}</span>` : ` · <span class="si-owned">dig ${me.permDig}</span>`) +
      `</div>` + (w.desc ? `<div>${w.desc}</div>` : '');
    div.classList.toggle('cant', me.cash < w.price);
  }
  const inv = SELECTABLE.filter(id => (me.inv[id] || 0) > 0)
    .map(id => `${WEAPON_BY_ID[id].name}×${me.inv[id]}`).join(' · ');
  $('shop-inv').textContent = 'INVENTORY: ' + (inv || 'empty') + ` · dig power ${me.permDig} · left-click buy, right-click sell (70%)`;
}

function shopBuy(wid) {
  if (S.mode === 'client') { S.net.send({ t: 'buy', wid }); return; }
  if (S.game.buy(S.myId, wid)) {
    playSound('kili');
    if (S.net) sendShopUpdate(S.myId); else renderShopIfOpen();
  }
}
function shopSell(wid) {
  if (S.mode === 'client') { S.net.send({ t: 'sell', wid }); return; }
  if (S.game.sell(S.myId, wid)) {
    if (S.net) sendShopUpdate(S.myId); else renderShopIfOpen();
  }
}

$('btn-ready').onclick = () => {
  $('btn-ready').disabled = true;
  $('btn-ready').textContent = 'WAITING…';
  if (S.mode === 'client') S.net.send({ t: 'ready' });
  else { S.ready.add(S.myId); broadcastReady(); checkAllReady(); }
};

function updateShopStatus() {
  if (!shopOpen) return;
  const total = S.mode === 'client' ? S.lobby.length : (S.game ? S.game.players.length : 1);
  $('shop-status').textContent = S.ready.size ? `${S.ready.size}/${total} ready…` : '';
}

// ---------------- back buttons ----------------
$('btn-lobby-back').onclick = () => location.reload();

// ---------------- render loop ----------------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (S.playing) {
    if (S.mode === 'client') renderClient(dt);
    else renderHost(dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function renderHost(dt) {
  const g = S.game;
  const view = {
    treasures: g.treasures,
    fires: g.fires.keys(),
    bombs: g.bombs.map(b => [b.id, b.wid, b.x, b.y, b.owner]),
    players: g.players.map(p => ({
      id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, dir: p.dir,
      hp: p.hp, alive: p.alive, sel: p.sel, moving: p.moving, digging: p.digging,
      cash: p.cash, digPower: p.digPower, inv: p.inv, wins: p.wins,
    })),
    monsters: g.monsters.map(m => [m.id, m.type, m.x, m.y]),
    meId: S.myId,
    timeLeft: g.timeLeft,
    round: g.round, rounds: S.options.rounds,
    darkness: S.options.darkness,
    treasureCount: [...g.treasures.values()].filter(t => t !== 255).length,
  };
  renderer.render(view, dt);
}

function renderClient(dt) {
  const rep = S.rep;
  if (!rep) return;
  // predict own movement locally for a lag-free feel
  const me = rep.players.get(S.myId);
  if (me && me.alive) {
    const d = curDir();
    const tileWorld = { tileAt: (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) ? T.BORDER : rep.tiles[(y | 0) * MAP_W + (x | 0)] };
    if (d.dx || d.dy) {
      const sp = 5.2 * dt;
      let nx = S.pred.x, ny = S.pred.y;
      if (d.dx) nx = moveAxis(tileWorld, S.pred.x, S.pred.y, d.dx * sp, 0);
      if (d.dy) ny = moveAxis(tileWorld, nx, S.pred.y, 0, d.dy * sp, nx);
      me.moving = nx !== S.pred.x || ny !== S.pred.y;
      me.digging = !me.moving;
      S.pred.x = nx; S.pred.y = ny;
      if (d.dx) me.dir = d.dx > 0 ? 1 : 3; else if (d.dy) me.dir = d.dy > 0 ? 2 : 0;
    } else { me.moving = false; me.digging = false; }
    me.x = S.pred.x; me.y = S.pred.y;
  }
  // interpolate everyone else
  const LERP = Math.min(1, dt * 14);
  for (const p of rep.players.values()) {
    if (p.id === S.myId && p.alive) continue;
    p.x += (p.tx - p.x) * LERP;
    p.y += (p.ty - p.y) * LERP;
  }
  const monsters = [];
  for (const m of rep.monsters.values()) {
    m.x += (m.tx - m.x) * LERP;
    m.y += (m.ty - m.y) * LERP;
    monsters.push([m.id, m.type, m.x, m.y]);
  }
  rep.timeLeft -= dt;   // smooth countdown between snapshots

  const view = {
    treasures: rep.treasures,
    fires: rep.fires,
    bombs: rep.bombs,
    players: [...rep.players.values()],
    monsters,
    meId: S.myId,
    timeLeft: rep.timeLeft,
    round: rep.round, rounds: rep.rounds,
    darkness: rep.darkness,
    treasureCount: [...rep.treasures.values()].filter(t => t !== 255).length,
  };
  renderer.render(view, dt);
}
