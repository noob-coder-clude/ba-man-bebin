/**
 * call.js (browser mesh engine) tests.
 *
 * RTCPeerConnection / getUserMedia are stubbed, and two engine instances are
 * wired to each other through a fake Socket.IO bus. That is enough to verify
 * the things that actually bite in production:
 *   · exactly one offer per edge (the glare rule)
 *   · 4 peers → 6 connections
 *   · leaving closes every pc AND empties the map
 *   · video ⇄ audio is a replaceTrack, never a renegotiation
 *   · a stuck "connecting" raises the TURN warning after 10s
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

/* ------------------------------------------------------------------ */
/* Stubs                                                                */
/* ------------------------------------------------------------------ */

class FakeTrack {
  constructor(kind) {
    this.kind = kind;
    this.enabled = true;
    this.stopped = false;
    this.listeners = {};
  }

  stop() { this.stopped = true; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
}

class FakeMediaStream {
  constructor(tracks = []) { this.tracks = [...tracks]; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
  addTrack(t) { if (!this.tracks.includes(t)) this.tracks.push(t); }
  removeTrack(t) { this.tracks = this.tracks.filter((x) => x !== t); }
}

class FakeSender {
  constructor(kind) { this.kind = kind; this.track = null; this.replaceCalls = 0; }
  async replaceTrack(track) { this.track = track; this.replaceCalls += 1; }
}

/** Every pc created during a test, so we can assert on teardown. */
let allPcs = [];

class FakeRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.signalingState = 'stable';
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.closed = false;
    this.senders = [];
    this.offersCreated = 0;
    this.answersCreated = 0;
    this.addedCandidates = [];
    allPcs.push(this);
  }

  addTransceiver(kind) {
    const sender = new FakeSender(kind);
    this.senders.push(sender);
    return { sender };
  }

  getSenders() { return this.senders; }

  async createOffer(options) {
    this.offersCreated += 1;
    return { type: 'offer', sdp: `offer-${this.offersCreated}${options?.iceRestart ? '-restart' : ''}`, toJSON() { return { type: this.type, sdp: this.sdp }; } };
  }

  async createAnswer() {
    this.answersCreated += 1;
    return { type: 'answer', sdp: `answer-${this.answersCreated}`, toJSON() { return { type: this.type, sdp: this.sdp }; } };
  }

  async setLocalDescription(desc) {
    this.localDescription = { ...desc, toJSON: () => ({ type: desc.type, sdp: desc.sdp }) };
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(c) { this.addedCandidates.push(c); }

  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }

  /** Test helper: drive a state transition. */
  _setState(state) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

/** A two-way in-memory Socket.IO stand-in. */
function createBus() {
  const sockets = new Map();
  return {
    make(id) {
      const handlers = new Map();
      const socket = {
        id,
        emit(event, payload, ack) {
          if (typeof ack === 'function') return ack({ ok: true, peers: [] });
          const target = payload?.to && sockets.get(payload.to);
          if (target) target._deliver(event, { ...payload, from: id });
          return undefined;
        },
        on(event, fn) { (handlers.get(event) || handlers.set(event, []).get(event)).push(fn); },
        off(event, fn) {
          const list = handlers.get(event) || [];
          const i = list.indexOf(fn);
          if (i >= 0) list.splice(i, 1);
        },
        _deliver(event, payload) { (handlers.get(event) || []).forEach((fn) => fn(payload)); },
        _handlers: handlers,
      };
      // `on` above is buggy for the first registration; make it explicit:
      socket.on = (event, fn) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(fn);
      };
      sockets.set(id, socket);
      return socket;
    },
    sockets,
  };
}

const tick = () => new Promise((r) => setImmediate(r));
const settle = async (n = 12) => { for (let i = 0; i < n; i += 1) await tick(); };

let createCallEngine;
let AUDIO_CONSTRAINTS;
let gumCalls;

beforeEach(async () => {
  allPcs = [];
  gumCalls = [];

  globalThis.RTCPeerConnection = FakeRTCPeerConnection;
  globalThis.MediaStream = FakeMediaStream;

  // Node 22 exposes `navigator` as a getter-only global, so replace the
  // property descriptor rather than assigning to it.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      mediaDevices: {
        async getUserMedia(constraints) {
          gumCalls.push(constraints);
          const tracks = [];
          if (constraints.audio) tracks.push(new FakeTrack('audio'));
          if (constraints.video) tracks.push(new FakeTrack('video'));
          return new FakeMediaStream(tracks);
        },
      },
    },
  });
  globalThis.window = { location: { href: 'https://x.test/room/a' } };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ iceServers: [{ urls: ['stun:stun.test:3478'] }], relayAvailable: false }),
  });

  ({ createCallEngine, AUDIO_CONSTRAINTS } = await import('../public/assets/js/call.js'));
});

afterEach(() => {
  mock.timers.reset();
});

/* ------------------------------------------------------------------ */

describe('getUserMedia constraints', () => {
  it('always requests echo cancellation, noise suppression and AGC', async () => {
    // Without echoCancellation the movie leaks speaker → mic and howls.
    assert.equal(AUDIO_CONSTRAINTS.echoCancellation, true);
    assert.equal(AUDIO_CONSTRAINTS.noiseSuppression, true);
    assert.equal(AUDIO_CONSTRAINTS.autoGainControl, true);
  });

  it('passes them through on join', async () => {
    const bus = createBus();
    const socket = bus.make('aaa');
    const engine = createCallEngine({ socket, selfId: 'aaa' });
    await engine.join({ video: true });

    assert.equal(gumCalls.length, 1);
    assert.deepEqual(gumCalls[0].audio, AUDIO_CONSTRAINTS);
    assert.ok(gumCalls[0].video, 'video was requested');
  });

  it('degrades to a voice call when there is no camera', async () => {
    globalThis.navigator.mediaDevices.getUserMedia = async (c) => {
      gumCalls.push(c);
      if (c.video) {
        const err = new Error('no cam');
        err.name = 'NotFoundError';
        throw err;
      }
      return new FakeMediaStream([new FakeTrack('audio')]);
    };

    const bus = createBus();
    const engine = createCallEngine({ socket: bus.make('aaa'), selfId: 'aaa' });
    const res = await engine.join({ video: true });

    assert.equal(res.ok, true);
    assert.equal(engine.mode, 'audio', 'should fall back to voice rather than fail');
  });
});

describe('glare avoidance — "lower socket id offers"', () => {
  /** Wire N engines through one bus and have them all join. */
  async function meshOf(ids) {
    const bus = createBus();
    const engines = new Map();
    const roster = [];

    for (const id of ids) {
      const socket = bus.make(id);
      // call:join ack hands back everyone already present.
      socket.emit = ((inner) => (event, payload, ack) => {
        if (event === 'call:join' && typeof ack === 'function') {
          ack({ ok: true, peers: roster.map((r) => ({ id: r })), max: 4 });
          return undefined;
        }
        return inner(event, payload, ack);
      })(socket.emit.bind(socket));

      const engine = createCallEngine({ socket, selfId: id });
      await engine.join({ video: true });
      await settle();

      // Tell the incumbents about the newcomer, exactly like the server does.
      roster.forEach((other) => engines.get(other).addPeer(id));
      await settle();

      roster.push(id);
      engines.set(id, engine);
    }
    return { engines, bus };
  }

  it('creates exactly 6 connections for 4 participants', async () => {
    const { engines } = await meshOf(['p1', 'p2', 'p3', 'p4']);

    // Each engine holds 3 peers → 12 endpoints → 6 undirected edges.
    [...engines.values()].forEach((e) => assert.equal(e.peerCount, 3));
    const endpoints = [...engines.values()].reduce((n, e) => n + e.peerCount, 0);
    assert.equal(endpoints / 2, 6, 'a 4-way mesh must be exactly 6 connections');
  });

  it('sends exactly one offer per edge — never two', async () => {
    await meshOf(['p1', 'p2', 'p3', 'p4']);

    // 6 edges → 6 offers in total. Two offers on one edge would be glare.
    const offers = allPcs.reduce((n, pc) => n + pc.offersCreated, 0);
    assert.equal(offers, 6, `expected 6 offers, got ${offers}`);

    // The other end of each edge answered exactly once.
    const answers = allPcs.reduce((n, pc) => n + pc.answersCreated, 0);
    assert.equal(answers, 6, `expected 6 answers, got ${answers}`);

    // No single connection ever both offered and answered.
    allPcs.forEach((pc) => {
      assert.ok(
        pc.offersCreated === 0 || pc.answersCreated === 0,
        'a connection that both offered and answered means the rule broke',
      );
    });
  });

  it('answers, and never counter-offers, when it is the higher id', async () => {
    const bus = createBus();

    const lowSocket = bus.make('aaa');
    const highSocket = bus.make('zzz');

    const low = createCallEngine({ socket: lowSocket, selfId: 'aaa' });
    const high = createCallEngine({ socket: highSocket, selfId: 'zzz' });

    lowSocket.emit = ((inner) => (e, p, ack) => (e === 'call:join' && ack ? ack({ ok: true, peers: [] }) : inner(e, p, ack)))(lowSocket.emit.bind(lowSocket));
    highSocket.emit = ((inner) => (e, p, ack) => (e === 'call:join' && ack ? ack({ ok: true, peers: [{ id: 'aaa' }] }) : inner(e, p, ack)))(highSocket.emit.bind(highSocket));

    await low.join({ video: true });
    await high.join({ video: true });
    await settle();
    low.addPeer('zzz');
    await settle(20);

    const lowPc = allPcs.find((pc) => pc.offersCreated > 0);
    const highPc = allPcs.find((pc) => pc.answersCreated > 0);

    assert.ok(lowPc, '"aaa" (lower id) must have produced the offer');
    assert.ok(highPc, '"zzz" (higher id) must have produced the answer');
    assert.equal(highPc.offersCreated, 0, 'the higher id must never counter-offer');
    assert.equal(lowPc.answersCreated, 0, 'the lower id must never answer');
  });
});

describe('teardown', () => {
  it('closes every RTCPeerConnection and empties the map on leave', async () => {
    const bus = createBus();
    const socket = bus.make('aaa');
    socket.emit = ((inner) => (e, p, ack) => (e === 'call:join' && ack
      ? ack({ ok: true, peers: [{ id: 'bbb' }, { id: 'ccc' }, { id: 'ddd' }] })
      : inner(e, p, ack)))(socket.emit.bind(socket));

    const engine = createCallEngine({ socket, selfId: 'aaa' });
    await engine.join({ video: true });
    await settle();

    assert.equal(engine.peerCount, 3);
    const before = allPcs.length;
    assert.ok(before >= 3);

    const localTracks = engine.localStream.getTracks();
    engine.leave();

    assert.equal(engine.peerCount, 0, 'the peer map must be empty, not just closed');
    assert.deepEqual(engine.peerIds, []);
    allPcs.forEach((pc) => assert.equal(pc.closed, true, 'every pc must be close()d'));
    localTracks.forEach((t) => assert.equal(t.stopped, true, 'the camera/mic light must go out'));
    assert.equal(engine.localStream, null);
    assert.equal(engine.joined, false);
  });

  it('removePeer closes just that one and drops it from the map', async () => {
    const bus = createBus();
    const socket = bus.make('aaa');
    socket.emit = ((inner) => (e, p, ack) => (e === 'call:join' && ack
      ? ack({ ok: true, peers: [{ id: 'bbb' }, { id: 'ccc' }] })
      : inner(e, p, ack)))(socket.emit.bind(socket));

    const engine = createCallEngine({ socket, selfId: 'aaa' });
    await engine.join({ video: true });
    await settle();
    assert.equal(engine.peerCount, 2);

    engine.removePeer('bbb');
    assert.equal(engine.peerCount, 1);
    assert.deepEqual(engine.peerIds, ['ccc']);
    // Closing must be idempotent — a duplicate peer-left must not throw.
    engine.removePeer('bbb');
    assert.equal(engine.peerCount, 1);
  });

  it('detaches handlers before closing so no late event resurrects a peer', async () => {
    const bus = createBus();
    const socket = bus.make('aaa');
    socket.emit = ((inner) => (e, p, ack) => (e === 'call:join' && ack
      ? ack({ ok: true, peers: [{ id: 'bbb' }] })
      : inner(e, p, ack)))(socket.emit.bind(socket));

    const engine = createCallEngine({ socket, selfId: 'aaa' });
    await engine.join({ video: true });
    await settle();

    const pc = allPcs[0];
    engine.removePeer('bbb');

    assert.equal(pc.onconnectionstatechange, null);
    assert.equal(pc.onicecandidate, null);
    assert.equal(pc.ontrack, null);
    // A late transition from the browser must be a no-op now.
    pc._setState('failed');
    assert.equal(engine.peerCount, 0);
  });
});

describe('video ⇄ voice without dropping the call', () => {
  async function joined() {
    const bus = createBus();
    const socket = bus.make('aaa');
    socket.emit = ((inner) => (e, p, ack) => (e === 'call:join' && ack
      ? ack({ ok: true, peers: [{ id: 'bbb' }] })
      : inner(e, p, ack)))(socket.emit.bind(socket));
    const engine = createCallEngine({ socket, selfId: 'aaa' });
    await engine.join({ video: true });
    await settle();
    return engine;
  }

  it('switches to voice by replacing the track, not renegotiating', async () => {
    const engine = await joined();
    const pcCountBefore = allPcs.length;
    const videoSender = allPcs[0].senders.find((s) => s.kind === 'video');
    const offersBefore = allPcs[0].offersCreated;

    const res = await engine.setMode('audio');

    assert.equal(res.ok, true);
    assert.equal(engine.mode, 'audio');
    assert.equal(videoSender.track, null, 'the video track should have been replaced with null');
    assert.equal(allPcs.length, pcCountBefore, 'no new connection may be created');
    assert.equal(allPcs[0].closed, false, 'the call must stay up');
    assert.equal(allPcs[0].offersCreated, offersBefore, 'no renegotiation → no glare window');
  });

  it('switches back to video the same way', async () => {
    const engine = await joined();
    await engine.setMode('audio');
    const offersBefore = allPcs[0].offersCreated;

    const res = await engine.setMode('video');

    assert.equal(res.ok, true);
    assert.equal(engine.mode, 'video');
    const videoSender = allPcs[0].senders.find((s) => s.kind === 'video');
    assert.ok(videoSender.track, 'a fresh camera track should be attached');
    assert.equal(allPcs[0].closed, false);
    assert.equal(allPcs[0].offersCreated, offersBefore);
  });

  it('stops the camera hardware when going voice-only', async () => {
    const engine = await joined();
    const camTrack = engine.localStream.getVideoTracks()[0];
    await engine.setMode('audio');
    assert.equal(camTrack.stopped, true, 'the camera LED must actually turn off');
    assert.equal(engine.localStream.getVideoTracks().length, 0);
  });
});

describe('mic / camera toggles', () => {
  it('mutes by disabling the track, keeping the connection alive', async () => {
    const bus = createBus();
    const socket = bus.make('aaa');
    socket.emit = ((inner) => (e, p, ack) => (e === 'call:join' && ack ? ack({ ok: true, peers: [] }) : inner(e, p, ack)))(socket.emit.bind(socket));
    const engine = createCallEngine({ socket, selfId: 'aaa' });
    await engine.join({ video: true });

    const audio = engine.localStream.getAudioTracks()[0];
    engine.setMic(false);
    assert.equal(audio.enabled, false);
    assert.equal(engine.micOn, false);
    assert.equal(audio.stopped, false, 'muting must not release the microphone');

    engine.setMic(true);
    assert.equal(audio.enabled, true);
  });
});

describe('stuck connections', () => {
  it('warns "TURN required" after 10s of not connecting, instead of failing silently', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });

    const bus = createBus();
    const socket = bus.make('aaa');
    socket.emit = ((inner) => (e, p, ack) => (e === 'call:join' && ack
      ? ack({ ok: true, peers: [{ id: 'bbb' }] })
      : inner(e, p, ack)))(socket.emit.bind(socket));

    const warnings = [];
    const engine = createCallEngine({
      socket,
      selfId: 'aaa',
      on: { needsRelay: (p) => warnings.push(p) },
    });
    await engine.join({ video: true });
    await settle();

    assert.equal(warnings.length, 0, 'must not warn immediately');

    mock.timers.tick(9000);
    assert.equal(warnings.length, 0, 'still within the grace period at 9s');

    mock.timers.tick(1500);
    assert.equal(warnings.length, 1, 'should speak up once 10s have passed');
    assert.equal(warnings[0].peerId, 'bbb');
    assert.equal(warnings[0].relayAvailable, false, 'and say that no relay is configured');
  });

  it('does not warn when the connection succeeds in time', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });

    const bus = createBus();
    const socket = bus.make('aaa');
    socket.emit = ((inner) => (e, p, ack) => (e === 'call:join' && ack
      ? ack({ ok: true, peers: [{ id: 'bbb' }] })
      : inner(e, p, ack)))(socket.emit.bind(socket));

    const warnings = [];
    const engine = createCallEngine({ socket, selfId: 'aaa', on: { needsRelay: (p) => warnings.push(p) } });
    await engine.join({ video: true });
    await settle();

    allPcs[0]._setState('connected');
    mock.timers.tick(20000);

    assert.equal(warnings.length, 0);
  });
});
