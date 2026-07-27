/**
 * Integration test for the phase-2 call signalling.
 *
 * Runs the real server and drives it with real Socket.IO clients. There is
 * no browser here, so RTCPeerConnection is simulated — but the part we care
 * about (who offers whom, how many edges exist, whether teardown is clean)
 * lives in the signalling layer, and that is exercised for real.
 *
 *   node --test test/
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import { io as ioClient } from 'socket.io-client';

const PORT = 3999;
const URL = `http://127.0.0.1:${PORT}`;

let server;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${URL}/healthz`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await wait(150);
  }
  throw new Error('server did not start');
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = ioClient(URL, { transports: ['websocket'], forceNew: true });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

const emitAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

before(async () => {
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', MAX_CALL_PEERS: '4' },
    stdio: 'ignore',
  });
  await waitForServer();
});

after(() => {
  server?.kill('SIGKILL');
});

/* ------------------------------------------------------------------ */

describe('/api/ice', () => {
  it('serves STUN even with no TURN configured', async () => {
    const res = await fetch(`${URL}/api/ice`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(data.iceServers) && data.iceServers.length > 0);
    // No TURN_URL in env → STUN-only, and the client is told so.
    assert.equal(data.turn, false);
    assert.equal(data.relayAvailable, false);
    const flat = JSON.stringify(data.iceServers);
    assert.ok(flat.includes('stun:'), 'expected at least one stun: url');
  });

  it('never caches (credentials may be short-lived)', async () => {
    const res = await fetch(`${URL}/api/ice`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

describe('call signalling', () => {
  /** Join a room and then the call. Returns the socket + call ack. */
  async function joinRoomAndCall(roomId, name) {
    const socket = await connect();
    const joined = await emitAck(socket, 'room:join', { roomId, name });
    assert.ok(joined.ok, `room join failed: ${JSON.stringify(joined)}`);
    const call = await emitAck(socket, 'call:join', { video: true, audio: true });
    return { socket, call };
  }

  it('applies the "lower socket id offers" rule to build a 4-way mesh with exactly 6 edges and no glare', async () => {
    const roomId = 'mesh-test';
    const peers = [];
    for (const name of ['A', 'B', 'C', 'D']) {
      // Sequential joins mirror how people actually arrive.
      peers.push(await joinRoomAndCall(roomId, name));
    }

    assert.equal(peers.length, 4);
    peers.forEach(({ call }) => assert.ok(call.ok, JSON.stringify(call)));

    // Each newcomer is handed everyone who was already there.
    assert.deepEqual(peers.map((p) => p.call.peers.length), [0, 1, 2, 3]);

    const ids = peers.map((p) => p.socket.id);

    // Replay the client-side rule over every unordered pair.
    const edges = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        // Exactly one side must consider itself the offerer.
        const aOffers = String(a) < String(b);
        const bOffers = String(b) < String(a);
        assert.notEqual(aOffers, bOffers, 'both or neither peer would offer — glare');
        edges.push([aOffers ? a : b, aOffers ? b : a]);
      }
    }

    // N(N-1)/2 = 6 for four participants.
    assert.equal(edges.length, 6);
    // Every edge is unique and directed exactly one way.
    assert.equal(new Set(edges.map(([f, t]) => `${f}->${t}`)).size, 6);

    // Now prove the *server* actually relays one offer per edge and that
    // the receiving side is always the higher id.
    const received = [];
    peers.forEach(({ socket }) => {
      socket.on('call:offer', ({ from }) => received.push([from, socket.id]));
    });

    edges.forEach(([from, to]) => {
      const sender = peers.find((p) => p.socket.id === from);
      sender.socket.emit('call:offer', { to, description: { type: 'offer', sdp: 'v=0\r\n' } });
    });

    await wait(400);
    assert.equal(received.length, 6, 'expected exactly 6 offers, one per edge');
    received.forEach(([from, to]) => assert.ok(String(from) < String(to), 'offer went the wrong way'));

    peers.forEach(({ socket }) => socket.disconnect());
    await wait(200);
  });

  it('rejects a 5th caller instead of silently degrading everyone', async () => {
    const roomId = 'full-test';
    const peers = [];
    for (const name of ['A', 'B', 'C', 'D']) peers.push(await joinRoomAndCall(roomId, name));
    peers.forEach(({ call }) => assert.ok(call.ok));

    const fifth = await joinRoomAndCall(roomId, 'E');
    assert.equal(fifth.call.ok, undefined);
    assert.equal(fifth.call.error, 'call_full');
    assert.equal(fifth.call.max, 4);

    [...peers, fifth].forEach(({ socket }) => socket.disconnect());
    await wait(200);
  });

  it('tells the room when a peer leaves the call but stays in the room', async () => {
    const roomId = 'leave-test';
    const a = await joinRoomAndCall(roomId, 'A');
    const b = await joinRoomAndCall(roomId, 'B');

    const left = new Promise((resolve) => a.socket.once('call:peer-left', resolve));
    await emitAck(b.socket, 'call:leave', {});
    const event = await left;

    assert.equal(event.peerId, b.socket.id);
    assert.equal(event.peers.length, 1, 'only A should remain in the call');
    // B is still a room member — chat and playback keep working.
    const sync = await emitAck(b.socket, 'player:request-sync', {});
    assert.ok(sync.state, 'B was kicked out of the room, it should only leave the call');

    a.socket.disconnect();
    b.socket.disconnect();
    await wait(200);
  });

  it('cleans up the call roster when a peer disconnects abruptly', async () => {
    const roomId = 'drop-test';
    const a = await joinRoomAndCall(roomId, 'A');
    const b = await joinRoomAndCall(roomId, 'B');

    const bId = b.socket.id; // the client clears .id once disconnected
    const left = new Promise((resolve) => a.socket.once('call:peer-left', resolve));
    b.socket.disconnect(); // no call:leave — simulates a closed tab / dead link
    const event = await left;

    assert.equal(event.peerId, bId);
    assert.equal(event.peers.length, 1);

    // And the slot is genuinely free again.
    const c = await joinRoomAndCall(roomId, 'C');
    assert.ok(c.call.ok);
    assert.equal(c.call.peers.length, 1);

    a.socket.disconnect();
    c.socket.disconnect();
    await wait(200);
  });

  it('refuses to relay signalling from someone who is not in the call', async () => {
    const roomId = 'guard-test';
    const a = await joinRoomAndCall(roomId, 'A');

    const lurker = await connect();
    await emitAck(lurker, 'room:join', { roomId, name: 'Lurker' });

    let got = false;
    a.socket.on('call:offer', () => { got = true; });
    lurker.emit('call:offer', { to: a.socket.id, description: { type: 'offer', sdp: 'v=0\r\n' } });
    await wait(300);
    assert.equal(got, false, 'a non-participant must not be able to signal');

    a.socket.disconnect();
    lurker.disconnect();
    await wait(200);
  });

  it('drops malformed SDP and oversized candidates', async () => {
    const roomId = 'sanitise-test';
    const a = await joinRoomAndCall(roomId, 'A');
    const b = await joinRoomAndCall(roomId, 'B');

    const seen = [];
    b.socket.on('call:offer', (p) => seen.push(p));
    b.socket.on('call:ice-candidate', (p) => seen.push(p));

    a.socket.emit('call:offer', { to: b.socket.id, description: { type: 'answer', sdp: 'v=0' } }); // wrong type
    a.socket.emit('call:offer', { to: b.socket.id, description: { sdp: 'v=0' } });                 // no type
    a.socket.emit('call:offer', { to: b.socket.id, description: { type: 'offer', sdp: 'x'.repeat(70000) } });
    a.socket.emit('call:ice-candidate', { to: b.socket.id, candidate: { candidate: 'x'.repeat(2000) } });
    a.socket.emit('call:offer', { to: a.socket.id, description: { type: 'offer', sdp: 'v=0' } });  // self

    await wait(300);
    assert.equal(seen.length, 0, `nothing malformed should be relayed, got ${JSON.stringify(seen)}`);

    // A well-formed one still goes through.
    const ok = new Promise((resolve) => b.socket.once('call:offer', resolve));
    a.socket.emit('call:offer', { to: b.socket.id, description: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' } });
    const payload = await ok;
    assert.equal(payload.from, a.socket.id);
    assert.equal(payload.description.type, 'offer');

    a.socket.disconnect();
    b.socket.disconnect();
    await wait(200);
  });

  it('broadcasts mic/camera state so tiles stay in sync', async () => {
    const roomId = 'state-test';
    const a = await joinRoomAndCall(roomId, 'A');
    const b = await joinRoomAndCall(roomId, 'B');

    const changed = new Promise((resolve) => a.socket.once('call:peer-state', resolve));
    b.socket.emit('call:state', { audio: false, video: false });
    const event = await changed;

    assert.equal(event.peer.id, b.socket.id);
    assert.equal(event.peer.audio, false);
    assert.equal(event.peer.video, false);

    a.socket.disconnect();
    b.socket.disconnect();
    await wait(200);
  });
});
