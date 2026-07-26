import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import { Server as SocketServer } from 'socket.io';

import {
  AVATAR_COLORS,
  addMessage,
  createRoomId,
  ensureRoom,
  getRoom,
  normalizeRoomId,
  projectedState,
  removeRoomIfEmpty,
  roomSnapshot,
  setState,
  stats,
} from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_ROOM_USERS = Number(process.env.MAX_ROOM_USERS || 50);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", 'https://www.youtube.com', 'https://s.ytimg.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'media-src': ["'self'", 'blob:', 'data:', 'https:'],
        'frame-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
        'connect-src': ["'self'", 'ws:', 'wss:'],
        'upgrade-insecure-requests': null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(compression());
app.use(express.json({ limit: '32kb' }));

app.use(
  express.static(PUBLIC_DIR, {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: process.uptime(), ...stats() }));
app.get('/api/stats', (_req, res) => res.json(stats()));

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

app.get('/room/:id', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'room.html')));
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
    const kind = payload.kind === 'file' ? 'file' : 'youtube';
    room.source = { kind, value: clean(payload.value, 500), title: clean(payload.title, 120) };
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
