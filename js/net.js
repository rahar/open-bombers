// WebRTC networking via PeerJS (free public broker for signalling; game data is P2P).
const PREFIX = 'open-bombers-mb311-';

export function makeCode() {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[(Math.random() * chars.length) | 0];
  return c;
}

export class Host {
  constructor(code, cb) {
    this.code = code;
    this.cb = cb;               // {onReady, onError, onJoin(conn), onLeave(conn), onData(conn, msg)}
    this.conns = new Map();     // peerId -> conn
    this.peer = new Peer(PREFIX + code, { debug: 1 });
    this.peer.on('open', () => cb.onReady && cb.onReady());
    this.peer.on('error', err => cb.onError && cb.onError(err));
    this.peer.on('connection', conn => {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        cb.onJoin && cb.onJoin(conn);
      });
      conn.on('data', msg => cb.onData && cb.onData(conn, msg));
      const bye = () => {
        if (this.conns.delete(conn.peer)) cb.onLeave && cb.onLeave(conn);
      };
      conn.on('close', bye);
      conn.on('error', bye);
    });
  }
  sendTo(conn, msg) { if (conn.open) conn.send(msg); }
  broadcast(msg) { for (const c of this.conns.values()) if (c.open) c.send(msg); }
  destroy() { try { this.peer.destroy(); } catch (e) {} }
}

// ---------------------------------------------------------------------------
// Serverless game directory: the first lobby visitor claims a well-known peer
// id and becomes the registry; everyone else connects to it as a client.
// Hosts (re-)announce their room every few seconds, entries expire after 30s,
// and if the registry peer disappears the remaining clients race to take over.
const DIR_ID = PREFIX + 'directory-v1';
const GAME_TTL = 30000;

export class Directory {
  constructor(cb) {
    this.cb = cb || {};
    this.destroyed = false;
    this.role = null;
    this.games = new Map();     // server role: code -> {game, ts}
    this.conns = new Set();     // server role
    this.conn = null;           // client role
    this._last = null;          // our own announcement, resent on reconnect
    this._connect();
  }

  _connect() {
    if (this.destroyed) return;
    const peer = new Peer(DIR_ID, { debug: 0 });
    this.peer = peer;
    let settled = false;
    peer.on('open', () => { if (!settled) { settled = true; this._becomeServer(); } });
    peer.on('error', err => {
      if (err.type === 'unavailable-id' && !settled) {
        settled = true;
        try { peer.destroy(); } catch (e) {}
        this._becomeClient();
      } else if (!settled) {
        settled = true;
        this._retry();
      }
    });
  }

  _becomeServer() {
    this.role = 'server';
    this.cb.onRole && this.cb.onRole('server');
    this.peer.on('connection', conn => {
      conn.on('open', () => {
        this.conns.add(conn);
        if (conn.open) conn.send({ t: 'games', list: this._list() });
      });
      conn.on('data', m => this._serverMsg(conn, m));
      const bye = () => this.conns.delete(conn);
      conn.on('close', bye);
      conn.on('error', bye);
    });
    this._pruneTimer = setInterval(() => this._prune(), 10000);
    if (this._last) this._serverMsg(null, { t: 'announce', game: this._last });
    this._emit();
  }

  _serverMsg(conn, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'announce' && m.game && typeof m.game.code === 'string') {
      this.games.set(m.game.code, { ...m.game, ts: Date.now() });
      this._broadcast();
    } else if (m.t === 'withdraw' && typeof m.code === 'string') {
      this.games.delete(m.code);
      this._broadcast();
    } else if (m.t === 'list' && conn && conn.open) {
      conn.send({ t: 'games', list: this._list() });
    }
  }

  _list() { return [...this.games.values()].map(({ ts, ...g }) => g); }
  _prune() {
    let changed = false;
    const now = Date.now();
    for (const [c, g] of this.games) if (now - g.ts > GAME_TTL) { this.games.delete(c); changed = true; }
    if (changed) this._broadcast();
  }
  _broadcast() {
    const msg = { t: 'games', list: this._list() };
    for (const c of this.conns) if (c.open) c.send(msg);
    this._emit();
  }
  _emit() { this.cb.onGames && this.cb.onGames(this._list()); }

  _becomeClient() {
    if (this.destroyed) return;
    this.role = 'client';
    this.cb.onRole && this.cb.onRole('client');
    const peer = new Peer({ debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(DIR_ID, { reliable: true });
      this.conn = conn;
      conn.on('open', () => {
        conn.send({ t: 'list' });
        if (this._last) conn.send({ t: 'announce', game: this._last });
      });
      conn.on('data', m => {
        if (m && m.t === 'games') this.cb.onGames && this.cb.onGames(m.list);
      });
      conn.on('close', () => this._retry());
      conn.on('error', () => this._retry());
    });
    peer.on('error', err => {
      if (err.type === 'peer-unavailable') this._retry();
    });
  }

  _retry() {
    if (this.destroyed || this._retrying) return;
    this._retrying = true;
    try { this.peer.destroy(); } catch (e) {}
    this.conn = null;
    setTimeout(() => {
      this._retrying = false;
      this._connect();                       // race to claim the directory id
    }, 400 + Math.random() * 1600);
  }

  announce(game) {
    this._last = game;
    if (this.role === 'server') this._serverMsg(null, { t: 'announce', game });
    else if (this.conn && this.conn.open) this.conn.send({ t: 'announce', game });
  }
  withdraw(code) {
    this._last = null;
    if (this.role === 'server') { this.games.delete(code); this._broadcast(); }
    else if (this.conn && this.conn.open) this.conn.send({ t: 'withdraw', code });
  }
  destroy() {
    this.destroyed = true;
    clearInterval(this._pruneTimer);
    try { this.peer.destroy(); } catch (e) {}
  }
}

export class Client {
  constructor(code, meta, cb) {
    this.cb = cb;               // {onOpen, onData, onClose, onError}
    this.peer = new Peer({ debug: 1 });
    this.conn = null;
    this.peer.on('error', err => {
      if (err.type === 'peer-unavailable') cb.onError && cb.onError(new Error('Room not found. Check the code.'));
      else cb.onError && cb.onError(err);
    });
    this.peer.on('open', () => {
      const conn = this.peer.connect(PREFIX + code.toUpperCase(), { metadata: meta, reliable: true });
      this.conn = conn;
      conn.on('open', () => cb.onOpen && cb.onOpen());
      conn.on('data', msg => cb.onData && cb.onData(msg));
      conn.on('close', () => cb.onClose && cb.onClose());
      conn.on('error', err => cb.onError && cb.onError(err));
    });
  }
  send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); }
  destroy() { try { this.peer.destroy(); } catch (e) {} }
}
