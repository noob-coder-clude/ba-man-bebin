/**
 * Rooms-registry + room-card tests.
 *
 * Uses the real rooms.js in-memory store and the registry on top.
 * Covers:
 *   · room card generation (public-safe metadata)
 *   · publish / unpublish (host-only)
 *   · public listing, sorting, pagination, search
 *   · stale-entry cleanup
 *   · registry stats
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import * as rooms from '../server/rooms.js';
import { buildCard, buildCards, buildCardTiny } from '../server/room-card.js';
import {
  publishRoom,
  unpublishRoom,
  isPublished,
  listPublicRooms,
  publicRoomCount,
  cleanupRoom,
  registryStats,
} from '../server/rooms-registry.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const TEST_IDS = ['tst-aaaa', 'tst-bbbb', 'tst-cccc'];

function seedRooms() {
  const r1 = rooms.ensureRoom('tst-aaaa');
  r1.members.set('host-1', { id: 'host-1', name: 'Alice', color: '#f00', isHost: true });
  r1.hostId = 'host-1';
  r1.source = { kind: 'youtube', value: 'https://youtube.com/watch?v=abc', title: 'Test Movie' };

  const r2 = rooms.ensureRoom('tst-bbbb');
  r2.members.set('host-2', { id: 'host-2', name: 'Bob', color: '#0f0', isHost: true });
  r2.hostId = 'host-2';
  r2.source = { kind: 'direct', value: 'https://example.com/movie.mp4', title: 'Another Film' };

  // Empty room — no members, no source.
  rooms.ensureRoom('tst-cccc');
}

function teardownRooms() {
  for (const id of TEST_IDS) {
    cleanupRoom(id);
    const r = rooms.getRoom(id);
    if (r) r.members.clear();
    rooms.removeRoomIfEmpty(id);
  }
}

beforeEach(() => {
  teardownRooms();
  seedRooms();
});

afterEach(() => {
  teardownRooms();
});

/* ================================================================== */
/* room-card                                                            */
/* ================================================================== */

describe('room-card', () => {
  it('buildCard returns public-safe metadata without socket IDs', () => {
    const room = rooms.getRoom('tst-aaaa');
    const card = buildCard(room);

    assert.equal(card.id, 'tst-aaaa');
    assert.equal(card.members, 1);
    assert.equal(card.source.kind, 'youtube');
    assert.equal(card.source.title, 'Test Movie');
    assert.ok(card.createdAt > 0);
    // No internal fields leaked.
    assert.equal(card.hostId, undefined);
    assert.equal(card.state, undefined);
    assert.equal(card.call, undefined);
  });

  it('buildCard omits source when room has none', () => {
    const room = rooms.getRoom('tst-cccc');
    const card = buildCard(room);
    assert.equal(card.source, null);
  });

  it('buildCard returns null for null/undefined room', () => {
    assert.equal(buildCard(null), null);
    assert.equal(buildCard(undefined), null);
  });

  it('buildCards sorts by updatedAt descending', () => {
    const r1 = rooms.getRoom('tst-aaaa');
    const r2 = rooms.getRoom('tst-bbbb');
    r2.updatedAt = r1.updatedAt + 1000;

    const cards = buildCards([r1, r2]);
    assert.equal(cards[0].id, 'tst-bbbb');
    assert.equal(cards[1].id, 'tst-aaaa');
  });

  it('buildCards respects limit and offset', () => {
    const r1 = rooms.getRoom('tst-aaaa');
    const r2 = rooms.getRoom('tst-bbbb');
    r1.updatedAt = 1000;
    r2.updatedAt = 2000;

    const page1 = buildCards([r1, r2], { limit: 1, offset: 0 });
    assert.equal(page1.length, 1);
    assert.equal(page1[0].id, 'tst-bbbb');

    const page2 = buildCards([r1, r2], { limit: 1, offset: 1 });
    assert.equal(page2.length, 1);
    assert.equal(page2[0].id, 'tst-aaaa');
  });

  it('buildCardTiny returns only id and member count', () => {
    const room = rooms.getRoom('tst-aaaa');
    const tiny = buildCardTiny(room);
    assert.equal(tiny.id, 'tst-aaaa');
    assert.equal(tiny.members, 1);
    assert.equal(tiny.source, undefined);
    assert.equal(tiny.createdAt, undefined);
  });

  it('buildCardTiny returns null for null room', () => {
    assert.equal(buildCardTiny(null), null);
  });
});

/* ================================================================== */
/* rooms-registry — publish / unpublish                                 */
/* ================================================================== */

describe('rooms-registry — publish / unpublish', () => {
  it('host can publish their room', () => {
    const ok = publishRoom('tst-aaaa', 'host-1');
    assert.equal(ok, true);
    assert.equal(isPublished('tst-aaaa'), true);
  });

  it('non-host cannot publish a room', () => {
    const ok = publishRoom('tst-aaaa', 'impostor-99');
    assert.equal(ok, false);
    assert.equal(isPublished('tst-aaaa'), false);
  });

  it('cannot publish a non-existent room', () => {
    const ok = publishRoom('no-such-room', 'host-1');
    assert.equal(ok, false);
  });

  it('host can unpublish their room', () => {
    publishRoom('tst-aaaa', 'host-1');
    const ok = unpublishRoom('tst-aaaa', 'host-1');
    assert.equal(ok, true);
    assert.equal(isPublished('tst-aaaa'), false);
  });

  it('non-host cannot unpublish a room', () => {
    publishRoom('tst-aaaa', 'host-1');
    const ok = unpublishRoom('tst-aaaa', 'impostor-99');
    assert.equal(ok, false);
    assert.equal(isPublished('tst-aaaa'), true);
  });
});

/* ================================================================== */
/* rooms-registry — public listing                                      */
/* ================================================================== */

describe('rooms-registry — public listing', () => {
  it('listPublicRooms returns only published rooms as cards', () => {
    publishRoom('tst-aaaa', 'host-1');
    const cards = listPublicRooms();
    assert.equal(cards.length, 1);
    assert.equal(cards[0].id, 'tst-aaaa');
    assert.equal(cards[0].members, 1);
    assert.equal(cards[0].source.kind, 'youtube');
  });

  it('listPublicRooms sorts by most recently updated', () => {
    publishRoom('tst-aaaa', 'host-1');
    publishRoom('tst-bbbb', 'host-2');

    const r1 = rooms.getRoom('tst-aaaa');
    const r2 = rooms.getRoom('tst-bbbb');
    r2.updatedAt = r1.updatedAt + 5000;

    const cards = listPublicRooms();
    assert.equal(cards[0].id, 'tst-bbbb');
    assert.equal(cards[1].id, 'tst-aaaa');
  });

  it('listPublicRooms supports text search by room id', () => {
    publishRoom('tst-aaaa', 'host-1');
    publishRoom('tst-bbbb', 'host-2');

    const cards = listPublicRooms({ query: 'aaaa' });
    assert.equal(cards.length, 1);
    assert.equal(cards[0].id, 'tst-aaaa');
  });

  it('listPublicRooms supports text search by source title', () => {
    publishRoom('tst-aaaa', 'host-1');
    publishRoom('tst-bbbb', 'host-2');

    const cards = listPublicRooms({ query: 'another' });
    assert.equal(cards.length, 1);
    assert.equal(cards[0].id, 'tst-bbbb');
  });

  it('listPublicRooms respects pagination', () => {
    publishRoom('tst-aaaa', 'host-1');
    publishRoom('tst-bbbb', 'host-2');

    const page1 = listPublicRooms({ limit: 1, offset: 0 });
    assert.equal(page1.length, 1);
    const page2 = listPublicRooms({ limit: 1, offset: 1 });
    assert.equal(page2.length, 1);
    assert.notEqual(page1[0].id, page2[0].id);
  });

  it('listPublicRooms prunes stale entries (empty rooms)', () => {
    // tst-cccc has no members → should be pruned during listing.
    // We need a host in tst-cccc to publish it.  Let's add one temporarily.
    const r3 = rooms.getRoom('tst-cccc');
    r3.members.set('host-3', { id: 'host-3', name: 'Carol', color: '#00f', isHost: true });
    r3.hostId = 'host-3';
    publishRoom('tst-cccc', 'host-3');

    // Now remove the member so the room is empty.
    r3.members.clear();

    const cards = listPublicRooms();
    const found = cards.find((c) => c.id === 'tst-cccc');
    assert.equal(found, undefined, 'empty room should be pruned from listing');
  });
});

/* ================================================================== */
/* rooms-registry — cleanup and stats                                   */
/* ================================================================== */

describe('rooms-registry — cleanup and stats', () => {
  it('cleanupRoom removes room from the public set', () => {
    publishRoom('tst-aaaa', 'host-1');
    assert.equal(isPublished('tst-aaaa'), true);
    cleanupRoom('tst-aaaa');
    assert.equal(isPublished('tst-aaaa'), false);
  });

  it('publicRoomCount returns the number of active public rooms', () => {
    assert.equal(publicRoomCount(), 0);
    publishRoom('tst-aaaa', 'host-1');
    assert.equal(publicRoomCount(), 1);
    publishRoom('tst-bbbb', 'host-2');
    assert.equal(publicRoomCount(), 2);
  });

  it('registryStats includes publicRooms alongside global stats', () => {
    publishRoom('tst-aaaa', 'host-1');
    const s = registryStats();
    assert.equal(s.publicRooms, 1);
    assert.ok(Number.isFinite(s.rooms));
    assert.ok(Number.isFinite(s.users));
  });
});
