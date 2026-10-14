// ponytail: PeerJS transport only. Ceiling: public broker, host dies with tab, no reconnect.
// Upgrade path: own signaling worker / Supabase Realtime if rooms must outlive host.
(function (root) {
  function accuracy(p) {
    const a = Number(p.answered) || 0;
    const c = Number(p.correct) || 0;
    return a > 0 ? c / a : (c > 0 ? 1 : 0);
  }

  // Fair order for any room size: more correct first, then higher accuracy,
  // then less total answering time. Shared by decideWinner and rank so the
  // 1v1 crown and the N-player board can never disagree.
  function comparePlayers(a, b) {
    const ad = !!a.disconnected, bd = !!b.disconnected;
    if (ad && !bd) return 1;
    if (bd && !ad) return -1;
    if (a.correct !== b.correct) return b.correct - a.correct;
    const aa = accuracy(a), ab = accuracy(b);
    if (aa !== ab) return ab - aa;
    return a.ms - b.ms;
  }

  function decideWinner(a, b) {
    const c = comparePlayers(a, b);
    return c < 0 ? 'a' : c > 0 ? 'b' : 'draw';
  }

  // N-player standings: most correct wins, accuracy then total time break ties.
  // Each entry: { id, name, correct, answered, ms }. Returns a sorted copy (best first).
  function rank(players) {
    return (players || []).slice().sort(comparePlayers);
  }

  function makeCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) {
      s += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return s;
  }

  function Multi() {
    this.peer = null;
    this.conn = null; // guest: the single link to the host
    this.conns = {}; // host: guest peer id -> connection
    this.role = null;
    this.code = null;
    this.handlers = {};
  }

  Multi.prototype.on = function (event, fn) {
    this.handlers[event] = fn;
  };

  Multi.prototype.emit = function (event, data) {
    const fn = this.handlers[event];
    if (fn) fn(data);
  };

  Multi.prototype.openConns = function () {
    const out = [];
    const ids = Object.keys(this.conns);
    for (let i = 0; i < ids.length; i++) {
      const c = this.conns[ids[i]];
      if (c && c.open) out.push(ids[i]);
    }
    return out;
  };

  // Optional reuseCode reclaims the same room after a refresh so waiting
  // guests can rejoin it. Falls back to a fresh code when invalid/absent.
  Multi.prototype.createRoom = function (reuseCode) {
    const self = this;
    this.leave();
    this.role = 'host';
    const want = String(reuseCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    this.code = want.length === 6 ? want : makeCode();
    const Peer = root.Peer;
    if (!Peer) {
      this.emit('error', 'PeerJS not loaded');
      return;
    }
    this.peer = new Peer('ttm-' + this.code);
    this.peer.on('open', function () {
      self.emit('room-ready', self.code);
    });
    this.peer.on('connection', function (conn) {
      self.setupConn(conn, conn.peer);
    });
    this.peer.on('error', function (err) {
      self.emit('error', (err && err.type) || 'peer-error');
    });
  };

  Multi.prototype.joinRoom = function (code) {
    const self = this;
    this.leave();
    const Peer = root.Peer;
    if (!Peer) {
      this.emit('error', 'PeerJS not loaded');
      return;
    }
    this.role = 'guest';
    this.code = String(code || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
    if (this.code.length !== 6) {
      this.emit('error', 'invalid-code');
      return;
    }
    this.peer = new Peer();
    this.peer.on('open', function () {
      const conn = self.peer.connect('ttm-' + self.code, { reliable: true });
      self.setupConn(conn);
    });
    this.peer.on('error', function (err) {
      self.emit('error', (err && err.type) || 'peer-error');
    });
  };

  Multi.prototype.setupConn = function (conn, peerId) {
    const self = this;
    if (this.role === 'host' && peerId) {
      this.conns[peerId] = conn;
    } else {
      this.conn = conn;
    }
    conn.on('open', function () {
      self.emit('connected', peerId || null);
    });
    conn.on('data', function (data) {
      if (!data || !data.type) return;
      if (!data.from) data.from = peerId || 'host';
      self.emit(data.type, data);
    });
    conn.on('close', function () {
      self.emit('peer-closed', peerId || 'host');
    });
    conn.on('error', function () {
      self.emit('peer-closed', peerId || 'host');
    });
  };

  function trySend(conn, obj) {
    if (conn && conn.open) {
      try {
        conn.send(obj);
      } catch (e) {}
    }
  }

  // Guest: send to host. Host: broadcast to every open guest conn.
  Multi.prototype.send = function (obj) {
    if (this.role === 'host') {
      const ids = Object.keys(this.conns);
      for (let i = 0; i < ids.length; i++) trySend(this.conns[ids[i]], obj);
      return;
    }
    trySend(this.conn, obj);
  };

  Multi.prototype.sendTo = function (id, obj) {
    trySend(this.conns[id], obj);
  };

  // Host: rebroadcast one guest's message to all other guests.
  Multi.prototype.relay = function (obj, exceptId) {
    const ids = Object.keys(this.conns);
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] === exceptId) continue;
      trySend(this.conns[ids[i]], obj);
    }
  };

  Multi.prototype.drop = function (id) {
    const c = this.conns[id];
    delete this.conns[id];
    if (c) {
      try {
        c.close();
      } catch (e) {}
    }
  };

  Multi.prototype.leave = function () {
    if (this.conn) {
      try {
        this.conn.close();
      } catch (e) {}
    }
    const ids = Object.keys(this.conns);
    for (let i = 0; i < ids.length; i++) {
      try {
        this.conns[ids[i]].close();
      } catch (e) {}
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {}
    }
    this.peer = null;
    this.conn = null;
    this.conns = {};
  };

  const api = {
    Multi: Multi,
    decideWinner: decideWinner,
    rank: rank,
    makeCode: makeCode,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MathSprintMulti = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
