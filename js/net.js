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
