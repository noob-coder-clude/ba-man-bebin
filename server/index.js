import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import { Server as SocketServer } from 'socket.io';

import { detectSource, probeDirect, proxyStream } from './media.js';
import { transcodeStream } from './transcode.js';
import { handleYoutubeCookies } from './youtube.js';
import { handleUpdater } from './updater.js';
import { clientConfig, listDomains, requestHost } from './domains.js';
import { handleIce } from './ice.js';
import {
  AVATAR_COLORS,
  addMessage,
  callPeers,
  createRoomId,
  ensureRoom,
  getRoom,
  joinCall,
  leaveCall,
  normalizeRoomId,
  projectedState,
  removeRoomIfEmpty,
  roomSnapshot,
  setState,
  stats,
  updateCallPeer,
} from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_ROOM_USERS = Number(process.env.MAX_ROOM_USERS || 50);

/**
 * Mesh calls are O(n²): with N people every browser uploads N-1 streams.
 * Simulated at 600 kbps per outgoing stream:
 *   4 people → 1.8 Mbps up   (fine)
 *   5 people → 2.4 Mbps up   (struggles on a typical Iranian mobile uplink)
 * So 4 is the supported ceiling; beyond it we warn instead of pretending.
 */
const MAX_CALL_PEERS = Number(process.env.MAX_CALL_PEERS || 4);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", 'blob:', 'https://www.youtube.com', 'https://s.ytimg.com', 'https://cdn.jsdelivr.net'],
        'worker-src': ["'self'", 'blob:'],
        'child-src': ["'self'", 'blob:'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        // blob: + https: so torrent streams and direct links both play.
        // mediastream: is for the WebRTC call tiles (video.srcObject).
        'media-src': ["'self'", 'blob:', 'data:', 'mediastream:', 'https:', 'http:'],
        'frame-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
        // wss: is needed for WebTorrent tracker/peer connections.
        'connect-src': ["'self'", 'ws:', 'wss:', 'https:', 'http:', 'blob:'],
        'upgrade-insecure-requests': null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(compression());
app.use(express.json({ limit: '32kb' }));

handleYoutubeCookies(app);
handleUpdater(app);
handleIce(app);

app.use(
  express.static(PUBLIC_DIR, {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

/**
 * Reachability beacon. Deliberately tiny, uncached and CORS-open so a browser
 * on mirror A can test whether mirror B answers for *this particular user*.
 * That client-side race is what actually detects filtering — see domains.js.
 */
app.get('/ping', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, host: requestHost(req), t: Date.now() });
});

app.get('/healthz', (_req, res) => res.json({
  ok: true,
  uptime: process.uptime(),
  domains: listDomains(),
  ...stats(),
}));

app.get('/api/stats', (_req, res) => res.json(stats()));

/** System info for the graphical status page. */
app.get('/api/system', (_req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const loadAvg = os.loadavg();

  // Try to detect ffmpeg / yt-dlp versions (may not be installed)
  let ffmpegVer = null;
  let ytdlpVer = null;
  try { ffmpegVer = execSync('ffmpeg -version 2>/dev/null', { timeout: 3000 }).toString().split('\n')[0].trim(); } catch {}
  try { ytdlpVer = execSync('yt-dlp --version 2>/dev/null', { timeout: 3000 }).toString().trim(); } catch {}

  const healthPct = Math.round(
    ((1 - loadAvg[0] / cpus.length) * 0.4 +
     (freeMem / totalMem) * 0.6) * 100
  );

  res.json({
    ok: true,
    uptime: process.uptime(),
    uptimeHuman: formatDuration(process.uptime()),
    healthPct,
    rooms: stats().rooms,
    users: stats().users,
    cpu: {
      model: cpus[0]?.model || 'unknown',
      cores: cpus.length,
      loadAvg: loadAvg.map((v) => v.toFixed(2)),
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      totalHuman: fmtBytes(totalMem),
      freeHuman: fmtBytes(freeMem),
      usedHuman: fmtBytes(totalMem - freeMem),
    },
    nodeVersion: process.version,
    ffmpeg: ffmpegVer,
    ytdlp: ytdlpVer,
  });
});

function formatDuration(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(1)} ${units[i]}`;
}

/** Mirrors + soft country hint, consumed by the client on page load. */
app.get('/api/config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(clientConfig(req));
});

app.post('/api/rooms', (_req, res) => {
  let id = createRoomId();
  while (getRoom(id)) id = createRoomId();
  ensureRoom(id);
  res.status(201).json({ id, url: `/room/${id}` });
});

app.get('/api/rooms/:id', (req, res) => {
  const id = normalizeRoomId(req.params.id);
  const room = getRoom(id);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  return res.json({ id: room.id, members: room.members.size, source: room.source });
});

/* ---------------------------------------------------------------- */
/* Media: detection, playability test, proxy streaming                */
/* ---------------------------------------------------------------- */

/** Classify a pasted link without touching the network. */
app.post('/api/media/detect', (req, res) => {
  const url = String(req.body?.url || '').slice(0, 4096);
  res.json(detectSource(url));
});

/**
 * "قبلش یه تست بگیره پخش میشه یا نه" — check a link before loading it,
 * so the host learns about a dead/blocked/unplayable source up front
 * instead of everyone staring at a black player.
 */
app.post('/api/media/probe', async (req, res) => {
  const url = String(req.body?.url || '').slice(0, 4096);
  const detected = detectSource(url);

  if (detected.kind === 'youtube') {
    return res.json({ kind: 'youtube', playable: true, source: detected, proxy: false });
  }

  if (detected.kind === 'torrent') {
    // Torrents are streamed peer-to-peer in the browser; reachability
    // depends on live seeders, which only the client can determine.
    return res.json({
      kind: 'torrent',
      playable: true,
      needsClientCheck: true,
      source: detected,
      proxy: false,
    });
  }

  if (detected.kind !== 'direct') {
    return res.status(400).json({ kind: 'unknown', playable: false, error: 'unsupported_link' });
  }

  const report = await probeDirect(url);
  return res.json({
    kind: 'direct',
    playable: Boolean(report.ok),
    proxy: Boolean(report.recommendProxy),
    source: { ...detected, hls: report.isHls ?? detected.hls },
    report,
  });
});

/**
 * Stream any reachable video through this server. Guarantees the viewer's
 * browser only talks to our origin, so CORS and geo-restrictions on the
 * upstream host stop mattering.
 */
app.get('/api/media/proxy', async (req, res) => {
  const url = String(req.query.url || '');
  if (!url) return res.status(400).json({ error: 'missing_url' });
  return proxyStream(url, req, res);
});

app.get('/api/media/transcode', async (req, res) => {
  const url = String(req.query.url || '');
  const mode = String(req.query.mode || 'remux');
  if (!url) return res.status(400).json({ error: 'missing_url' });
  return transcodeStream(url, req, res, mode);
});

app.get('/room/:id', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'room.html')));
app.get('/status', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'status.html')));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use((_req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(','), methods: ['GET', 'POST'] },
  pingTimeout: 20000,
});

const clean = (value, max = 200) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

io.on('connection', (socket) => {
  let joinedRoom = null;

  socket.on('room:join', (payload = {}, ack) => {
    const roomId = normalizeRoomId(payload.roomId);
    if (!roomId) return ack?.({ error: 'invalid_room' });

    const room = ensureRoom(roomId);
    if (room.members.size >= MAX_ROOM_USERS) return ack?.({ error: 'room_full' });

    const name = clean(payload.name, 24) || 'Guest';
    const color = AVATAR_COLORS[room.members.size % AVATAR_COLORS.length];
    const isHost = room.members.size === 0 || !room.hostId;

    const member = { id: socket.id, name, color, isHost };
    room.members.set(socket.id, member);
    if (isHost) room.hostId = socket.id;

    joinedRoom = roomId;
    socket.join(roomId);

    const systemMessage = { type: 'system', event: 'join', name, at: Date.now() };
    addMessage(room, systemMessage);

    socket.to(roomId).emit('room:member-joined', {
      member,
      members: [...room.members.values()],
      hostId: room.hostId,
      message: systemMessage,
    });
    ack?.({ ok: true, me: member, room: roomSnapshot(room) });
    return undefined;
  });

  socket.on('player:source', (payload = {}) => {
    const room = joinedRoom && getRoom(joinedRoom);
    if (!room || room.hostId !== socket.id) return;

    const allowed = ['youtube', 'file', 'direct', 'torrent'];
    const kind = allowed.includes(payload.kind) ? payload.kind : 'youtube';

    room.source = {
      kind,
      value: clean(payload.value, 4096),
      title: clean(payload.title, 160),
      proxy: Boolean(payload.proxy),
      hls: Boolean(payload.hls),
    };
    setState(room, { playing: false, time: 0, rate: 1 });
    io.to(room.id).emit('player:source', { source: room.source, state: projectedState(room) });
  });

  socket.on('player:control', (payload = {}) => {
    const room = joinedRoom && getRoom(joinedRoom);
    if (!room || room.hostId !== socket.id) return;
    const state = setState(room, {
      playing: payload.playing,
      time: Number(payload.time),
      rate: Number(payload.rate) || room.state.rate,
    });
    socket.to(room.id).emit('player:sync', { state, reason: payload.reason || 'host' });
  });

  socket.on('player:request-sync', (_payload, ack) => {
    const room = joinedRoom && getRoom(joinedRoom);
    if (!room) return ack?.({ error: 'not_in_room' });
    return ack?.({ state: projectedState(room), source: room.source });
  });

  socket.on('chat:message', (payload = {}) => {
    const room = joinedRoom && getRoom(joinedRoom);
    const member = room?.members.get(socket.id);
    if (!room || !member) return;
    const text = clean(payload.text, 500);
    if (!text) return;
    const message = {
      type: 'chat',
      id: `${Date.now()}-${socket.id.slice(0, 5)}`,
      from: member.name,
      color: member.color,
      senderId: socket.id,
      text,
      at: Date.now(),
    };
    addMessage(room, message);
    io.to(room.id).emit('chat:message', message);
  });

  socket.on('chat:reaction', (payload = {}) => {
    const room = joinedRoom && getRoom(joinedRoom);
    const member = room?.members.get(socket.id);
    if (!room || !member) return;
    const emoji = clean(payload.emoji, 8);
    if (!emoji) return;
    io.to(room.id).emit('chat:reaction', { emoji, from: member.name, at: Date.now() });
  });

  socket.on('chat:typing', (payload = {}) => {
    const room = joinedRoom && getRoom(joinedRoom);
    const member = room?.members.get(socket.id);
    if (!room || !member) return;
    socket.to(room.id).emit('chat:typing', { name: member.name, typing: Boolean(payload.typing) });
  });

  /* ---------------------------------------------------------------- */
  /* WebRTC calls: signalling only — media never touches this server.   */
  /* ---------------------------------------------------------------- */

  /**
   * Join the room's call. The ack carries the list of peers already in it;
   * the client then decides who offers to whom using the "lower socket id
   * offers" rule, which is what keeps a 4-way mesh at exactly 6 clean
   * connections with zero glare (no two peers offering each other at once).
   */
  socket.on('call:invite', () => {
    const room = joinedRoom && getRoom(joinedRoom);
    const member = room?.members.get(socket.id);
    if (!room || !member) return;
    socket.to(room.id).emit('call:invite', { id: socket.id, name: member.name, count: room.call.size });
  });

  socket.on('call:join', (payload = {}, ack) => {
    const room = joinedRoom && getRoom(joinedRoom);
    const member = room?.members.get(socket.id);
    if (!room || !member) return ack?.({ error: 'not_in_room' });

    const already = room.call.has(socket.id);
    if (!already && room.call.size >= MAX_CALL_PEERS) {
      return ack?.({ error: 'call_full', max: MAX_CALL_PEERS, peers: callPeers(room) });
    }

    const peer = joinCall(room, socket.id, { video: payload.video, audio: payload.audio });
    if (!peer) return ack?.({ error: 'not_in_room' });

    // Peers as seen *before* this join — the newcomer connects to these.
    const others = callPeers(room).filter((p) => p.id !== socket.id);
    socket.to(room.id).emit('call:peer-joined', { peer, peers: callPeers(room) });
    return ack?.({ ok: true, me: peer, peers: others, max: MAX_CALL_PEERS });
  });

  /** Leave the call but stay in the room (chat + video keep working). */
  socket.on('call:leave', (_payload, ack) => {
    const room = joinedRoom && getRoom(joinedRoom);
    if (!room) return ack?.({ error: 'not_in_room' });
    if (leaveCall(room, socket.id)) {
      io.to(room.id).emit('call:peer-left', { peerId: socket.id, peers: callPeers(room) });
    }
    return ack?.({ ok: true });
  });

  /** Mic / camera toggles — pure UI state, so everyone can render it. */
  socket.on('call:state', (payload = {}) => {
    const room = joinedRoom && getRoom(joinedRoom);
    if (!room) return;
    const peer = updateCallPeer(room, socket.id, {
      video: typeof payload.video === 'boolean' ? payload.video : undefined,
      audio: typeof payload.audio === 'boolean' ? payload.audio : undefined,
    });
    if (!peer) return;
    io.to(room.id).emit('call:peer-state', { peer, peers: callPeers(room) });
  });

  /**
   * Relay SDP / ICE to exactly one peer in the same room.
   * Everything is addressed point-to-point: the server never broadcasts
   * signalling, so a 4-way mesh stays 6 independent negotiations.
   */
  const MAX_SDP = 64 * 1024; // real offers are ~4-8 KB; this is a sane ceiling

  const relay = (event, project) => (payload = {}) => {
    const room = joinedRoom && getRoom(joinedRoom);
    if (!room || !room.call.has(socket.id)) return;
    const targetId = clean(payload.to, 64);
    if (!targetId || targetId === socket.id || !room.members.has(targetId)) return;
    const body = project(payload);
    if (!body) return;
    io.to(targetId).emit(event, { ...body, from: socket.id });
  };

  const projectSdp = (kind) => (payload) => {
    const desc = payload.description || payload.sdp;
    const sdp = typeof desc?.sdp === 'string' ? desc.sdp : null;
    if (!sdp || sdp.length > MAX_SDP) return null;
    const type = desc.type === kind ? kind : null;
    if (!type) return null;
    return { description: { type, sdp } };
  };

  socket.on('call:offer', relay('call:offer', projectSdp('offer')));
  socket.on('call:answer', relay('call:answer', projectSdp('answer')));
  socket.on('call:ice-candidate', relay('call:ice-candidate', (payload) => {
    const c = payload.candidate;
    // null candidate = end-of-candidates; browsers send it and it is valid.
    if (c === null) return { candidate: null };
    if (!c || typeof c.candidate !== 'string' || c.candidate.length > 1024) return null;
    return {
      candidate: {
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid.slice(0, 64) : null,
        sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : null,
        usernameFragment: typeof c.usernameFragment === 'string' ? c.usernameFragment.slice(0, 256) : undefined,
      },
    };
  }));

  socket.on('room:transfer-host', (payload = {}) => {
    const room = joinedRoom && getRoom(joinedRoom);
    if (!room || room.hostId !== socket.id) return;
    const target = room.members.get(clean(payload.memberId, 64));
    if (!target) return;
    const current = room.members.get(socket.id);
    if (current) current.isHost = false;
    target.isHost = true;
    room.hostId = target.id;
    io.to(room.id).emit('room:members', { members: [...room.members.values()], hostId: room.hostId });
  });

  socket.on('disconnect', () => {
    if (!joinedRoom) return;
    const room = getRoom(joinedRoom);
    if (!room) return;
    const member = room.members.get(socket.id);
    room.members.delete(socket.id);

    // Drop them from the call roster too, otherwise everyone keeps a dead
    // RTCPeerConnection around and the thumbnail strip shows a ghost.
    if (leaveCall(room, socket.id)) {
      io.to(room.id).emit('call:peer-left', { peerId: socket.id, peers: callPeers(room) });
    }

    if (room.hostId === socket.id) {
      const next = room.members.values().next().value;
      room.hostId = next ? next.id : null;
      if (next) next.isHost = true;
    }

    if (member) {
      const systemMessage = { type: 'system', event: 'leave', name: member.name, at: Date.now() };
      addMessage(room, systemMessage);
      io.to(room.id).emit('room:member-left', {
        memberId: socket.id,
        members: [...room.members.values()],
        hostId: room.hostId,
        message: systemMessage,
      });
    }

    removeRoomIfEmpty(joinedRoom);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`▶ Ba Man Bebin running on http://localhost:${PORT}`);
});

const shutdown = () => {
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
