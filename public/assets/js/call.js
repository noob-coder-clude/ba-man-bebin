/**
 * WebRTC mesh calls for a watch-party room (phase 2).
 *
 * Topology: full mesh, no SFU. Each participant holds one RTCPeerConnection
 * per other participant, so N people = N·(N-1)/2 connections and every
 * browser uploads N-1 streams.
 *
 *   3 people →  3 connections, 1.2 Mbps up
 *   4 people →  6 connections, 1.8 Mbps up   ← supported ceiling
 *   5 people → 10 connections, 2.4 Mbps up   ← breaks on Iranian mobile
 *
 * Glare (both sides firing an offer at the same instant) is avoided with one
 * deterministic rule instead of full perfect-negotiation bookkeeping:
 *
 *      the peer with the LEXICOGRAPHICALLY SMALLER socket id offers.
 *
 * Both browsers evaluate the same comparison on the same two ids and always
 * reach the opposite conclusion, so exactly one offer crosses each edge.
 * With 4 participants that is exactly 6 offers and 6 answers, no collisions.
 *
 * Media never touches our server — only SDP and ICE do, over Socket.IO.
 */

/** getUserMedia constraints. Echo cancellation is NOT optional here: */
export const AUDIO_CONSTRAINTS = Object.freeze({
  // Without this, the film coming out of your speakers goes back into your
  // mic, out of everyone else's speakers, and you get a howling feedback
  // loop that also permanently triggers the ducking.
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
});

/** Modest video: a mesh is upload-bound, 640×360 keeps ~600kbps per stream. */
export const VIDEO_CONSTRAINTS = Object.freeze({
  width: { ideal: 640, max: 1280 },
  height: { ideal: 360, max: 720 },
  frameRate: { ideal: 24, max: 30 },
  facingMode: 'user',
});

/** How long a connection may sit in checking/connecting before we blame NAT. */
const CONNECT_TIMEOUT_MS = 10_000;

const FALLBACK_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/**
 * Fetch iceServers from our own backend, so TURN credentials never sit in
 * the JS bundle and can be rotated (or added later) server-side.
 */
export async function fetchIceConfig() {
  try {
    const res = await fetch('/api/ice', { cache: 'no-store' });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    return {
      iceServers: Array.isArray(data.iceServers) && data.iceServers.length ? data.iceServers : FALLBACK_ICE,
      relayAvailable: Boolean(data.relayAvailable),
    };
  } catch {
    return { iceServers: FALLBACK_ICE, relayAvailable: false };
  }
}

export function createCallEngine({ socket, selfId, maxPeers = 4, on = {} }) {
  const emit = (name, payload) => { try { on[name]?.(payload); } catch { /* UI error, keep the call alive */ } };

  /** peerId -> { pc, stream, timer, restarted, state, warnedRelay } */
  const peers = new Map();

  let localStream = null;
  let iceConfig = { iceServers: FALLBACK_ICE, relayAvailable: false };
  let joined = false;
  let mode = 'video';      // 'video' | 'audio'
  let micOn = true;
  let camOn = true;
  let myId = selfId || socket.id;

  /* ---------------------------------------------------------------- */
  /* Local media                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Ask for mic (+camera). Falls back to audio-only if there is no camera
   * or the user denies it — a voice call is better than no call.
   */
  async function acquireMedia(wantVideo) {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('unsupported');
      err.code = 'unsupported';
      throw err;
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: wantVideo ? VIDEO_CONSTRAINTS : false,
      });
    } catch (err) {
      if (wantVideo && ['NotFoundError', 'OverconstrainedError', 'NotReadableError'].includes(err.name)) {
        // No usable camera: degrade to voice instead of failing outright.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
        mode = 'audio';
        return stream;
      }
      throw err;
    }
  }

  function localVideoTrack() {
    return localStream?.getVideoTracks()[0] || null;
  }

  function localAudioTrack() {
    return localStream?.getAudioTracks()[0] || null;
  }

  /* ---------------------------------------------------------------- */
  /* Peer connections                                                   */
  /* ---------------------------------------------------------------- */

  /** True when *we* are the side responsible for sending the offer. */
  const iAmOfferer = (peerId) => String(myId) < String(peerId);

  function createPeer(peerId) {
    const existing = peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: iceConfig.iceServers,
      // Trickle everything; bundling keeps it to a single transport.
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 2,
    });

    const entry = {
      pc,
      stream: new MediaStream(),
      timer: null,
      restarted: false,
      state: 'new',
      warnedRelay: false,
      makingOffer: false,
      pendingCandidates: [],
    };
    peers.set(peerId, entry);

    // Fixed transceivers, created up front and in a fixed order.
    // This is what lets "video ↔ audio" later be a pure replaceTrack:
    // the m-lines already exist, so switching never renegotiates and can
    // never re-introduce glare mid-call.
    const audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });
    entry.audioSender = audioTx.sender;
    entry.videoSender = videoTx.sender;

    const aTrack = localAudioTrack();
    const vTrack = mode === 'video' && camOn ? localVideoTrack() : null;
    if (aTrack) audioTx.sender.replaceTrack(aTrack).catch(() => {});
    if (vTrack) videoTx.sender.replaceTrack(vTrack).catch(() => {});

    pc.onicecandidate = ({ candidate }) => {
      socket.emit('call:ice-candidate', { to: peerId, candidate: candidate ? candidate.toJSON() : null });
    };

    pc.ontrack = ({ track }) => {
      entry.stream.addTrack(track);
      track.addEventListener('ended', () => {
        try { entry.stream.removeTrack(track); } catch { /* gone */ }
      });
      emit('stream', { peerId, stream: entry.stream });
    };

    pc.onconnectionstatechange = () => handleState(peerId, entry);
    pc.oniceconnectionstatechange = () => handleState(peerId, entry);

    // Should not fire (transceivers are fixed), but if a browser decides it
    // must renegotiate, only the designated offerer is allowed to act —
    // otherwise we would recreate exactly the glare the rule prevents.
    pc.onnegotiationneeded = async () => {
      if (!iAmOfferer(peerId) || entry.makingOffer) return;
      await sendOffer(peerId, entry);
    };

    armTimeout(peerId, entry);
    return entry;
  }

  /**
   * "connecting" forever is the classic symptom of a NAT that STUN cannot
   * punch through. Rather than a silent black tile, say it out loud.
   */
  function armTimeout(peerId, entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      const st = entry.pc?.connectionState;
      if (st === 'connected' || st === 'closed') return;
      if (entry.warnedRelay) return;
      entry.warnedRelay = true;
      emit('needsRelay', { peerId, relayAvailable: iceConfig.relayAvailable });
    }, CONNECT_TIMEOUT_MS);
  }

  function handleState(peerId, entry) {
    const st = entry.pc.connectionState;
    if (st === entry.state) return;
    entry.state = st;
    emit('peerState', { peerId, state: st });

    if (st === 'connected') {
      clearTimeout(entry.timer);
      entry.timer = null;
      entry.warnedRelay = false;
      return;
    }

    if (st === 'failed') {
      clearTimeout(entry.timer);
      // One ICE restart: covers a Wi-Fi→4G handover or a NAT rebind.
      if (!entry.restarted && iAmOfferer(peerId)) {
        entry.restarted = true;
        sendOffer(peerId, entry, { iceRestart: true });
        armTimeout(peerId, entry);
        return;
      }
      if (!entry.warnedRelay) {
        entry.warnedRelay = true;
        emit('needsRelay', { peerId, relayAvailable: iceConfig.relayAvailable });
      }
    }
  }

  async function sendOffer(peerId, entry, options) {
    try {
      entry.makingOffer = true;
      const offer = await entry.pc.createOffer(options);
      if (entry.pc.signalingState !== 'stable' && !options?.iceRestart) return;
      await entry.pc.setLocalDescription(offer);
      socket.emit('call:offer', { to: peerId, description: entry.pc.localDescription.toJSON() });
    } catch (err) {
      emit('error', { peerId, error: err });
    } finally {
      entry.makingOffer = false;
    }
  }

  /** Candidates that arrive before the remote description must wait. */
  async function flushCandidates(entry) {
    const queued = entry.pendingCandidates;
    entry.pendingCandidates = [];
    for (const candidate of queued) {
      try { await entry.pc.addIceCandidate(candidate); } catch { /* stale */ }
    }
  }

  function closePeer(peerId) {
    const entry = peers.get(peerId);
    if (!entry) return;
    clearTimeout(entry.timer);
    // Detach handlers first: a closing pc still fires state events, and a
    // late callback would happily resurrect the entry we are deleting.
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.oniceconnectionstatechange = null;
    entry.pc.onnegotiationneeded = null;
    entry.pc.getSenders().forEach((s) => { try { s.replaceTrack(null); } catch { /* closing */ } });
    try { entry.pc.close(); } catch { /* already closed */ }
    entry.stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* remote track */ } });
    peers.delete(peerId);
    emit('peerGone', { peerId });
  }

  function closeAllPeers() {
    [...peers.keys()].forEach(closePeer);
    peers.clear();
  }

  /* ---------------------------------------------------------------- */
  /* Signalling                                                         */
  /* ---------------------------------------------------------------- */

  async function onOffer({ from, description }) {
    if (!joined || !from || !description) return;
    // Enforce the rule on the receiving side too: an offer from someone we
    // are supposed to be offering to means both sides are confused.
    if (iAmOfferer(from)) return;

    const entry = peers.get(from) || createPeer(from);
    try {
      await entry.pc.setRemoteDescription(description);
      await flushCandidates(entry);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      socket.emit('call:answer', { to: from, description: entry.pc.localDescription.toJSON() });
    } catch (err) {
      emit('error', { peerId: from, error: err });
    }
  }

  async function onAnswer({ from, description }) {
    const entry = peers.get(from);
    if (!entry || !description) return;
    if (entry.pc.signalingState !== 'have-local-offer') return;
    try {
      await entry.pc.setRemoteDescription(description);
      await flushCandidates(entry);
    } catch (err) {
      emit('error', { peerId: from, error: err });
    }
  }

  async function onCandidate({ from, candidate }) {
    const entry = peers.get(from);
    if (!entry) return;
    if (!candidate) return; // end-of-candidates
    if (!entry.pc.remoteDescription) {
      entry.pendingCandidates.push(candidate);
      return;
    }
    try { await entry.pc.addIceCandidate(candidate); } catch { /* stale candidate */ }
  }

  function bindSocket() {
    socket.on('call:offer', onOffer);
    socket.on('call:answer', onAnswer);
    socket.on('call:ice-candidate', onCandidate);
  }

  function unbindSocket() {
    socket.off('call:offer', onOffer);
    socket.off('call:answer', onAnswer);
    socket.off('call:ice-candidate', onCandidate);
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                         */
  /* ---------------------------------------------------------------- */

  /** Connect to the peers that were already in the call when we joined. */
  function connectToExisting(existingPeers) {
    existingPeers.forEach(({ id }) => {
      if (id === myId) return;
      const entry = createPeer(id);
      // Only one side offers, the other just waits for it.
      if (iAmOfferer(id)) sendOffer(id, entry);
    });
  }

  /** A newcomer appeared: same rule decides who reaches out. */
  function addPeer(peerId) {
    if (!joined || peerId === myId || peers.has(peerId)) return;
    const entry = createPeer(peerId);
    if (iAmOfferer(peerId)) sendOffer(peerId, entry);
  }

  async function join({ video = true } = {}) {
    if (joined) return { ok: true, already: true };
    mode = video ? 'video' : 'audio';
    myId = socket.id;

    iceConfig = await fetchIceConfig();
    localStream = await acquireMedia(mode === 'video');
    micOn = true;
    camOn = mode === 'video' && Boolean(localVideoTrack());
    if (mode === 'video' && !camOn) mode = 'audio';

    const ack = await new Promise((resolve) => {
      socket.emit('call:join', { video: camOn, audio: micOn }, resolve);
    });

    if (!ack?.ok) {
      stopLocalStream();
      return { ok: false, error: ack?.error || 'join_failed', max: ack?.max ?? maxPeers };
    }

    joined = true;
    bindSocket();
    emit('localStream', { stream: localStream, mode });
    connectToExisting(ack.peers || []);
    return { ok: true, peers: ack.peers || [], mode, relayAvailable: iceConfig.relayAvailable };
  }

  function stopLocalStream() {
    localStream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* gone */ } });
    localStream = null;
  }

  function leave() {
    if (!joined) return;
    joined = false;
    unbindSocket();
    socket.emit('call:leave', {});
    // Every dead connection must be closed AND removed from the map, or
    // the next call reuses a corpse and never negotiates.
    closeAllPeers();
    stopLocalStream();
    emit('left', {});
  }

  function setMic(enabled) {
    micOn = Boolean(enabled);
    const track = localAudioTrack();
    if (track) track.enabled = micOn;
    if (joined) socket.emit('call:state', { audio: micOn, video: camOn });
    emit('selfState', { mic: micOn, cam: camOn, mode });
  }

  function setCam(enabled) {
    camOn = Boolean(enabled) && mode === 'video';
    const track = localVideoTrack();
    if (track) track.enabled = camOn;
    if (joined) socket.emit('call:state', { audio: micOn, video: camOn });
    emit('selfState', { mic: micOn, cam: camOn, mode });
  }

  /**
   * Video ↔ voice without dropping the call.
   * Because both m-lines already exist, we only swap the track that feeds
   * the video sender: no new SDP, no reconnection, no glare window.
   */
  async function setMode(next) {
    const wanted = next === 'video' ? 'video' : 'audio';
    if (wanted === mode) return { ok: true, mode };

    if (wanted === 'audio') {
      const track = localVideoTrack();
      if (track) {
        track.stop();
        localStream.removeTrack(track);
      }
      for (const entry of peers.values()) {
        try { await entry.videoSender?.replaceTrack(null); } catch { /* closing */ }
      }
      mode = 'audio';
      camOn = false;
    } else {
      let track = localVideoTrack();
      if (!track) {
        try {
          const cam = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
          track = cam.getVideoTracks()[0];
          localStream.addTrack(track);
        } catch (err) {
          emit('error', { error: err, stage: 'camera' });
          return { ok: false, error: err.name || 'camera_failed' };
        }
      }
      for (const entry of peers.values()) {
        try { await entry.videoSender?.replaceTrack(track); } catch { /* closing */ }
      }
      mode = 'video';
      camOn = true;
    }

    if (joined) socket.emit('call:state', { audio: micOn, video: camOn });
    emit('localStream', { stream: localStream, mode });
    emit('selfState', { mic: micOn, cam: camOn, mode });
    return { ok: true, mode };
  }

  return {
    join,
    leave,
    addPeer,
    removePeer: closePeer,
    setMic,
    setCam,
    setMode,
    get joined() { return joined; },
    get mode() { return mode; },
    get micOn() { return micOn; },
    get camOn() { return camOn; },
    get localStream() { return localStream; },
    get peerIds() { return [...peers.keys()]; },
    get peerCount() { return peers.size; },
    get relayAvailable() { return iceConfig.relayAvailable; },
    remoteStream(peerId) { return peers.get(peerId)?.stream || null; },
  };
}
