'use strict';
// React 版「ぴょいっとアイコンパズル。」のサーバー。
// 静的ファイル配信（Range 対応）に、対戦用の中継（WebSocket）を足したもの。
// 2026-11-21: 音声などの部分取得（Range）に未対応で、Safari では
// BGM（<audio>要素）が再生できなかったため、Range 対応を足した。
// 2026-11-22: 対戦の中継を追加。合言葉（4桁）の部屋と自動マッチングの
// 待ち列を持ち、対戦中のメッセージは相手へそのまま転送する。
// 中継はゲームの内容には関与しない（盤面の同期はクライアント同士で
// イベントとスナップショットを送り合う）。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.m4a': 'audio/mp4', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (pathname === '/') pathname = '/index.html';
  const full = path.join(__dirname, pathname);
  if (!full.startsWith(__dirname)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = TYPES[path.extname(full)] || 'application/octet-stream';
    const ct = type.startsWith('audio/') || type.startsWith('image/') ? type : `${type}; charset=utf-8`;
    const size = st.size;
    const m = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (m) {
      let start = m[1] === '' ? 0 : Number(m[1]);
      let end = m[2] === '' ? size - 1 : Number(m[2]);
      if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
      if (start >= size || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      end = Math.min(end, size - 1);
      res.writeHead(206, {
        'Content-Type': ct, 'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
      });
      return fs.createReadStream(full, { start, end }).pipe(res);
    }
    res.writeHead(200, {
      'Content-Type': ct, 'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes', 'Content-Length': size,
    });
    fs.createReadStream(full).pipe(res);
  });
});

/* ==== 対戦の中継（WebSocket、依存なしの最小実装） ==== */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const rooms = new Map(); // code -> { host, guest }
let queueWaiter = null;  // 自動マッチングの待機者（1人だけ保持）

function wsSend(ws, obj) {
  if (ws._dead) return;
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = data.length;
  let head;
  if (len < 126) { head = Buffer.from([0x81, len]); }
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  try { ws.write(Buffer.concat([head, data])); } catch (_) { /* 切断済み */ }
}

function cleanName(name) {
  const s = String(name || '').slice(0, 20).trim();
  return s || 'プレイヤー';
}

function pairUp(a, b) {
  a._peer = b; b._peer = a;
  a._roomCode = b._roomCode = null;
  const seed = crypto.randomInt(1, 2 ** 31);
  wsSend(a, { t: 'matched', seed, opp: b._name, host: a._isHost === true });
  wsSend(b, { t: 'matched', seed, opp: a._name, host: b._isHost === true });
}

function detach(ws, notifyPeer) {
  if (queueWaiter === ws) queueWaiter = null;
  if (ws._roomCode) {
    const room = rooms.get(ws._roomCode);
    if (room) {
      rooms.delete(ws._roomCode);
      const other = room.host === ws ? room.guest : room.host;
      if (other && other !== ws) {
        other._roomCode = null;
        if (notifyPeer) wsSend(other, { t: 'peerLeft' });
        if (other._peer === ws) other._peer = null;
      }
    }
    ws._roomCode = null;
  }
  if (ws._peer) {
    const peer = ws._peer;
    ws._peer = null;
    if (peer._peer === ws) peer._peer = null;
    if (notifyPeer) wsSend(peer, { t: 'peerLeft' });
  }
  ws._isHost = false;
}

function handleMessage(ws, text) {
  let m;
  try { m = JSON.parse(text); } catch (_) { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'create') {
    detach(ws, true);
    ws._name = cleanName(m.name);
    ws._isHost = true;
    let code;
    do { code = String(crypto.randomInt(0, 10000)).padStart(4, '0'); } while (rooms.has(code));
    rooms.set(code, { host: ws, guest: null });
    ws._roomCode = code;
    wsSend(ws, { t: 'created', code });
  } else if (m.t === 'join') {
    const room = rooms.get(String(m.code || ''));
    if (!room) { wsSend(ws, { t: 'error', reason: 'notfound' }); return; }
    if (room.guest || room.host === ws) { wsSend(ws, { t: 'error', reason: 'full' }); return; }
    detach(ws, true);
    ws._name = cleanName(m.name);
    ws._isHost = false;
    room.guest = ws;
    ws._roomCode = room.host._roomCode;
    pairUp(room.host, ws);
  } else if (m.t === 'queue') {
    detach(ws, true);
    ws._name = cleanName(m.name);
    if (queueWaiter && queueWaiter !== ws && !queueWaiter._dead) {
      const host = queueWaiter;
      queueWaiter = null;
      host._isHost = true; ws._isHost = false;
      pairUp(host, ws);
    } else {
      queueWaiter = ws;
      wsSend(ws, { t: 'queued' });
    }
  } else if (m.t === 'cancel') {
    detach(ws, true);
    wsSend(ws, { t: 'cancelled' });
  } else if (m.t === 'leave') {
    detach(ws, true);
  } else if (m.t === 'msg') {
    if (ws._peer) wsSend(ws._peer, { t: 'msg', data: m.data });
  }
}

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) { socket.destroy(); return; }
  if (pathname !== '/versus') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket._dead = false;
  socket._peer = null;
  socket._roomCode = null;
  socket._name = 'プレイヤー';
  socket._isHost = false;
  socket._alive = true;
  if (head && head.length) socket.unshift(head);
  let buf = Buffer.alloc(0);
  let frag = null;
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.subarray(off, off + len);
      if (masked) {
        const mask = buf.subarray(maskOff, maskOff + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      buf = buf.subarray(off + len);
      if (op === 8) { socket.end(); return; }
      if (op === 9) { // ping → pong
        const pong = Buffer.concat([Buffer.from([0x8a, payload.length]), payload]);
        try { socket.write(pong); } catch (_) { /* noop */ }
        continue;
      }
      if (op === 10) { socket._alive = true; continue; }
      if (op === 1 || op === 2 || op === 0) {
        frag = frag ? Buffer.concat([frag, payload]) : payload;
        if (fin) {
          const text = frag.toString('utf8');
          frag = null;
          handleMessage(socket, text);
        }
      }
    }
  });
  const onGone = () => {
    if (socket._dead) return;
    socket._dead = true;
    detach(socket, true);
  };
  socket.on('close', onGone);
  socket.on('error', onGone);
});

// 死活監視：30秒ごとに ping し、応答がなければ落とす
const heartbeat = setInterval(() => {
  const seen = new Set();
  const visit = ws => {
    if (!ws || seen.has(ws)) return;
    seen.add(ws);
    if (ws._dead) return;
    if (ws._alive === false) { try { ws.destroy(); } catch (_) { /* noop */ } return; }
    ws._alive = false;
    const ping = Buffer.from([0x89, 0]);
    try { ws.write(ping); } catch (_) { /* noop */ }
    if (ws._peer) visit(ws._peer);
  };
  for (const room of rooms.values()) { visit(room.host); visit(room.guest); }
  visit(queueWaiter);
}, 30000);
heartbeat.unref();

if (require.main === module) {
  const port = Number(process.env.PORT) || 3098;
  const host = process.env.HOST || '0.0.0.0';
  server.listen(port, host, () => {
    console.log(`React版 起動：http://127.0.0.1:${port}/`);
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const net of entries || []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`同じWi-Fiの端末：http://${net.address}:${port}/`);
      }
    }
  });
}
module.exports = { server };
