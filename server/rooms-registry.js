/**
 * Rooms registry — opt-in public listing of active rooms.
 *
 * By default rooms are **private** (not listed).  The host must explicitly
 * mark a room as public for it to appear in the registry.  This is the
 * safest default: most watch-parties are between friends and should not be
 * discoverable by strangers.
 *
 * The registry is powered by the in-memory room store from rooms.js; no
 * separate data structure is needed — we just track a Set of room IDs that
 * are publicly listed.
 */

import { getRoom, stats } from './rooms.js';
import { buildCard, buildCards } from './room-card.js';

/** Set of room IDs whose host has opted into public listing. */
const publicRooms = new Set();

/** Max rooms returned by listPublicRooms(). */
const MAX_LIST = 100;

/**
 * Mark a room as publicly listed.  Only the host can do this.
 *
 * @param {string} roomId
 * @param {string} socketId  — must be the room's host
 * @returns {boolean} success
 */
export function publishRoom(roomId, socketId) {
  const room = getRoom(roomId);
  if (!room || room.hostId !== socketId) return false;
  publicRooms.add(roomId);
  room.updatedAt = Date.now();
  return true;
}

/**
 * Un-publish a room (make it private again).
 *
 * @param {string} roomId
 * @param {string} socketId  — must be the room's host
 * @returns {boolean} success
 */
export function unpublishRoom(roomId, socketId) {
  const room = getRoom(roomId);
  if (!room || room.hostId !== socketId) return false;
  publicRooms.delete(roomId);
  room.updatedAt = Date.now();
  return true;
}

/**
 * Check whether a room is publicly listed.
 *
 * @param {string} roomId
 * @returns {boolean}
 */
export function isPublished(roomId) {
  return publicRooms.has(roomId);
}

/**
 * List all public rooms as room cards, sorted by most-recently-updated.
 *
 * @param {object} [options]
 * @param {number} [options.limit=50]   — max rooms to return
 * @param {number} [options.offset=0]   — pagination offset
 * @param {string} [options.query='']   — filter by room id or source title
 * @returns {object[]} cards
 */
export function listPublicRooms({ limit = 50, offset = 0, query = '' } = {}) {
  const effectiveLimit = Math.min(limit, MAX_LIST);
  const rooms = [];

  for (const roomId of publicRooms) {
    const room = getRoom(roomId);
    if (!room || room.members.size === 0) {
      // Stale entry — room was emptied but not cleaned from the set yet.
      publicRooms.delete(roomId);
      continue;
    }
    rooms.push(room);
  }

  // Optional text search: match against room id or source title.
  let filtered = rooms;
  if (query) {
    const q = query.toLowerCase();
    filtered = rooms.filter((r) => {
      if (r.id.includes(q)) return true;
      if (r.source?.title?.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  return buildCards(filtered, { limit: effectiveLimit, offset });
}

/**
 * Total number of publicly listed rooms (for stats).
 */
export function publicRoomCount() {
  // Prune stale entries while counting.
  let count = 0;
  for (const roomId of publicRooms) {
    if (getRoom(roomId)) {
      count += 1;
    } else {
      publicRooms.delete(roomId);
    }
  }
  return count;
}

/**
 * Clean up: remove a room from the public set when it is destroyed.
 * Called from rooms.js' removeRoomIfEmpty or the disconnect handler.
 *
 * @param {string} roomId
 */
export function cleanupRoom(roomId) {
  publicRooms.delete(roomId);
}

/**
 * Registry stats (extends the global stats object).
 */
export function registryStats() {
  return {
    publicRooms: publicRoomCount(),
    ...stats(),
  };
}
