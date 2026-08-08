/**
 * Room card — public-safe metadata for a room.
 *
 * Used by the rooms-registry to build the list of discoverable rooms on the
 * home page.  A "card" is the minimum data a guest needs to decide whether
 * to join: room id, member count, source type/title, and when it was created.
 * Socket IDs and internal state are never exposed.
 */

/**
 * Build a room card from an internal room object.
 *
 * @param {object} room  — the room record from rooms.js
 * @returns {object} card — { id, members, source, createdAt }
 */
export function buildCard(room) {
  if (!room) return null;

  const source = room.source
    ? {
        kind: room.source.kind || 'unknown',
        title: room.source.title || null,
      }
    : null;

  return {
    id: room.id,
    members: room.members.size,
    source,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

/**
 * Build cards for a list of rooms, sorted by most-recently-updated first.
 *
 * @param {Iterable<object>} roomList
 * @param {object} [options]
 * @param {number} [options.limit=50]  — max cards to return
 * @param {number} [options.offset=0]  — skip this many (for pagination)
 * @returns {object[]}
 */
export function buildCards(roomList, { limit = 50, offset = 0 } = {}) {
  const cards = [];
  for (const room of roomList) {
    const card = buildCard(room);
    if (card) cards.push(card);
  }

  // Most-recently-updated first (active rooms on top).
  cards.sort((a, b) => b.updatedAt - a.updatedAt);

  return cards.slice(offset, offset + limit);
}

/**
 * Minimal card returned when only the id and live count are needed
 * (e.g. for the status page or a lightweight poll).
 */
export function buildCardTiny(room) {
  if (!room) return null;
  return { id: room.id, members: room.members.size };
}
