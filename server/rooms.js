/**
 * In-memory room store.
 * A room keeps the shared playback state and the list of connected members.
 * Everything is ephemeral on purpose — no database needed to run the site.
 */

const rooms = new Map();

const ROOM_TTL_MS = 1000 * 60 * 60 * 6; // rooms are dropped 6h after last activity

export const AVATAR_COLORS = [
  '#f472b6', '#a78bfa', '#60a5fa', '#34d399',
  '#fbbf24', '#fb7185', '#22d3ee', '#c084fc',
];

export function normalizeRoomId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 32);
}

export function createRoomId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 8; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (i === 3) id += '-';
  }
  return id;
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

export function ensureRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      hostId: null,
      source: null, // { kind: 'youtube' | 'file', value, title }
      state: {
        playing: false,
        time: 0,
        updatedAt: Date.now(),
        rate: 1,
      },
      members: new Map(), // socketId -> { id, name, color, isHost }
      // Everyone currently in the voice/video call (a subset of members).
      // socketId -> { id, name, color, video, audio, joinedAt }
      call: new Map(),
      messages: [], // last 100 chat messages
    };
    rooms.set(roomId, room);
  }
  return room;
}

export function roomSnapshot(room) {
  return {
    id: room.id,
    hostId: room.hostId,
    source: room.source,
    state: projectedState(room),
    members: [...room.members.values()],
    call: callPeers(room),
    messages: room.messages.slice(-60),
  };
}

/** Participants of the WebRTC call in this room. */
export function callPeers(room) {
  return room?.call ? [...room.call.values()] : [];
}

/** Add a member to the call roster. Returns the peer record. */
export function joinCall(room, socketId, { video, audio } = {}) {
  const member = room.members.get(socketId);
  if (!member) return null;
  const peer = {
    id: socketId,
    name: member.name,
    color: member.color,
    video: video !== false,
    audio: audio !== false,
    joinedAt: Date.now(),
  };
  room.call.set(socketId, peer);
  room.updatedAt = Date.now();
  return peer;
}

/** Remove a member from the call roster. Returns true if they were in it. */
export function leaveCall(room, socketId) {
  if (!room?.call?.has(socketId)) return false;
  room.call.delete(socketId);
  room.updatedAt = Date.now();
  return true;
}

/** Update mic/camera flags of a peer already in the call. */
export function updateCallPeer(room, socketId, patch = {}) {
  const peer = room?.call?.get(socketId);
  if (!peer) return null;
  if (typeof patch.video === 'boolean') peer.video = patch.video;
  if (typeof patch.audio === 'boolean') peer.audio = patch.audio;
  room.updatedAt = Date.now();
  return peer;
}

/** Extrapolate the current playhead so late joiners land on the right frame. */
export function projectedState(room) {
  const { playing, time, updatedAt, rate } = room.state;
  if (!playing) return { playing, time, rate, serverTime: Date.now() };
  const elapsed = (Date.now() - updatedAt) / 1000;
  return {
    playing,
    time: Math.max(0, time + elapsed * (rate || 1)),
    rate,
    serverTime: Date.now(),
  };
}

export function setState(room, { playing, time, rate }) {
  room.state = {
    playing: Boolean(playing),
    time: Number.isFinite(time) ? Math.max(0, time) : room.state.time,
    rate: Number.isFinite(rate) && rate > 0 ? rate : room.state.rate,
    updatedAt: Date.now(),
  };
  room.updatedAt = Date.now();
  return projectedState(room);
}

export function addMessage(room, message) {
  room.messages.push(message);
  if (room.messages.length > 100) room.messages.shift();
  room.updatedAt = Date.now();
}

export function removeRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (room && room.members.size === 0) rooms.delete(roomId);
}

export function stats() {
  let users = 0;
  for (const room of rooms.values()) users += room.members.size;
  return { rooms: rooms.size, users };
}

// Periodic cleanup of stale rooms.
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.members.size === 0 && now - room.updatedAt > ROOM_TTL_MS) rooms.delete(id);
  }
}, 1000 * 60 * 10).unref?.();
