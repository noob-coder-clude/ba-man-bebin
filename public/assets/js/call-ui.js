/**
 * Call UI: the little video dock that lives on top of the player.
 *
 * Two layouts, one DOM:
 *   · normal      → a slim, collapsible strip pinned to a corner of the
 *                   player, deliberately out of the way of the movie.
 *   · fullscreen  → a picture-in-picture pod floating over the video,
 *                   draggable, 16:9 or a small circle.
 *
 * It also owns the ducking engine, because the two are inseparable: the
 * film only ducks while a call is running.
 */

import { t } from './i18n.js';
import { createCallEngine } from './call.js';
import { createDucker } from './ducking.js';

const SETTINGS_KEY = 'bmb.call.settings';

function loadSettings() {
  try {
    return { ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

const initials = (name) => (name || '?').trim().slice(0, 2).toUpperCase();

export function initCall({ socket, shell, toast, attachDuckSink, isFullscreen }) {
  const settings = loadSettings();

  const ducker = createDucker();
  if (typeof settings.duckThreshold === 'number') ducker.setThreshold(settings.duckThreshold);
  if (typeof settings.duckFloor === 'number') ducker.setFloor(settings.duckFloor);
  ducker.setEnabled(settings.duckEnabled !== false);

  const el = {
    pod: document.getElementById('callPod'),
    tiles: document.getElementById('callTiles'),
    count: document.getElementById('callCount'),
    collapse: document.getElementById('callCollapse'),
    grip: document.getElementById('callGrip'),
    startBtn: document.getElementById('callStartBtn'),
    micBtn: document.getElementById('callMic'),
    camBtn: document.getElementById('callCam'),
    modeBtn: document.getElementById('callMode'),
    hangBtn: document.getElementById('callHang'),
    duckBtn: document.getElementById('callDuckBtn'),
    duckPanel: document.getElementById('duckPanel'),
    duckToggle: document.getElementById('duckToggle'),
    duckSense: document.getElementById('duckSense'),
    duckSenseVal: document.getElementById('duckSenseVal'),
    duckDepth: document.getElementById('duckDepth'),
    duckDepthVal: document.getElementById('duckDepthVal'),
    duckClose: document.getElementById('duckClose'),
    duckState: document.getElementById('duckState'),
  };

  if (!el.pod) return null;

  const engine = createCallEngine({
    socket,
    selfId: socket.id,
    maxPeers: 4,
    on: {
      localStream: ({ stream, mode }) => {
        upsertTile('self', { name: t('call.you'), stream, muted: true, self: true, video: mode === 'video' });
        ducker.addVoice('self', stream);
        ducker.setVoiceActive('self', engine.micOn);
        startDucking();
      },
      stream: ({ peerId, stream }) => {
        const peer = roster.get(peerId);
        upsertTile(peerId, {
          name: peer?.name || '…',
          color: peer?.color,
          stream,
          video: peer?.video !== false,
        });
        ducker.addVoice(peerId, stream);
      },
      peerState: ({ peerId, state }) => {
        const tile = tiles.get(peerId);
        if (tile) tile.root.dataset.state = state;
      },
      peerGone: ({ peerId }) => {
        ducker.removeVoice(peerId);
        removeTile(peerId);
      },
      needsRelay: ({ peerId }) => {
        const peer = roster.get(peerId);
        const who = peer?.name ? `${peer.name}: ` : '';
        toast(`⚠️ ${who}${t('call.needRelay')}`);
        const tile = tiles.get(peerId);
        if (tile) {
          tile.root.classList.add('is-stalled');
          tile.status.textContent = t('call.needRelayShort');
        }
      },
      selfState: ({ mic, cam, mode }) => {
        ducker.setVoiceActive('self', mic);
        const tile = tiles.get('self');
        if (tile) {
          tile.root.classList.toggle('is-muted', !mic);
          tile.root.classList.toggle('is-camoff', !cam || mode !== 'video');
        }
        renderControls();
      },
      left: () => {
        stopDucking();
        tiles.forEach((_tile, id) => removeTile(id));
        roster.clear();
        renderControls();
      },
      error: ({ error, stage }) => {
        if (stage === 'camera') toast(`⚠️ ${t('call.cameraFailed')}`);
        else if (error?.name) console.warn('[call]', error.name, error.message);
      },
    },
  });

  /* ---------------------------------------------------------------- */
  /* Tiles                                                              */
  /* ---------------------------------------------------------------- */

  /** peerId -> { root, video, avatar, status } */
  const tiles = new Map();
  /** peerId -> { id, name, color, video, audio } as broadcast by the server */
  const roster = new Map();

  function upsertTile(id, { name, color, stream, muted, self, video = true }) {
    let tile = tiles.get(id);

    if (!tile) {
      const root = document.createElement('div');
      root.className = `ctile${self ? ' ctile--self' : ''}`;
      root.dataset.peer = id;

      const media = document.createElement('video');
      media.autoplay = true;
      media.playsInline = true;
      // Our own tile is always muted: hearing yourself is an echo machine.
      media.muted = Boolean(muted);
      root.appendChild(media);

      const avatar = document.createElement('span');
      avatar.className = 'ctile__avatar';
      root.appendChild(avatar);

      const label = document.createElement('span');
      label.className = 'ctile__name';
      root.appendChild(label);

      const status = document.createElement('span');
      status.className = 'ctile__status';
      root.appendChild(status);

      const badges = document.createElement('span');
      badges.className = 'ctile__badges';
      badges.innerHTML = '<i class="ctile__mic" aria-hidden="true">🔇</i>';
      root.appendChild(badges);

      el.tiles.appendChild(root);
      tile = { root, video: media, avatar, label, status };
      tiles.set(id, tile);
    }

    if (name) {
      tile.label.textContent = name;
      tile.avatar.textContent = initials(name);
    }
    if (color) tile.avatar.style.background = color;
    if (stream && tile.video.srcObject !== stream) {
      tile.video.srcObject = stream;
      tile.video.play?.().catch(() => { /* autoplay policy; muted tiles still play */ });
    }
    tile.root.classList.toggle('is-camoff', !video);
    updateCount();
    return tile;
  }

  function removeTile(id) {
    const tile = tiles.get(id);
    if (!tile) return;
    // Detach the stream before dropping the node so the decoder is released.
    tile.video.srcObject = null;
    tile.root.remove();
    tiles.delete(id);
    updateCount();
  }

  function updateCount() {
    el.count.textContent = String(tiles.size);
    el.pod.classList.toggle('is-solo', tiles.size <= 1);
    el.pod.dataset.tiles = String(Math.min(tiles.size, 4));
  }

  /* ---------------------------------------------------------------- */
  /* Ducking                                                            */
  /* ---------------------------------------------------------------- */

  function startDucking() {
    attachDuckSink?.(ducker);
    ducker.start();
  }

  function stopDucking() {
    ducker.stop();
    ducker.clearSink();
    el.pod.classList.remove('is-ducking');
    if (el.duckState) el.duckState.textContent = t('call.duckIdle');
  }

  ducker.onChange(({ speaking }) => {
    el.pod.classList.toggle('is-ducking', speaking);
    if (el.duckState) el.duckState.textContent = speaking ? t('call.duckActive') : t('call.duckIdle');
  });

  /** Re-point the ducker after the room switches to another video source. */
  function refreshDuckSink() {
    if (!engine.joined) return;
    attachDuckSink?.(ducker);
  }

  /* ---------------------------------------------------------------- */
  /* Controls                                                           */
  /* ---------------------------------------------------------------- */

  function renderControls() {
    const on = engine.joined;
    el.pod.hidden = !on;
    el.pod.classList.toggle('is-audio', engine.mode === 'audio');

    if (el.startBtn) {
      el.startBtn.classList.toggle('is-active', on);
      el.startBtn.textContent = on ? t('call.leave') : t('call.start');
    }

    el.micBtn.classList.toggle('is-off', !engine.micOn);
    el.micBtn.textContent = engine.micOn ? '🎤' : '🔇';
    el.micBtn.title = engine.micOn ? t('call.muteMic') : t('call.unmuteMic');
    el.micBtn.setAttribute('aria-label', el.micBtn.title);

    el.camBtn.classList.toggle('is-off', !engine.camOn);
    el.camBtn.textContent = engine.camOn ? '🎥' : '🚫';
    el.camBtn.disabled = engine.mode !== 'video';
    el.camBtn.title = engine.camOn ? t('call.stopCam') : t('call.startCam');
    el.camBtn.setAttribute('aria-label', el.camBtn.title);

    el.modeBtn.title = engine.mode === 'video' ? t('call.toAudio') : t('call.toVideo');
    el.modeBtn.setAttribute('aria-label', el.modeBtn.title);
    el.modeBtn.classList.toggle('is-audio', engine.mode === 'audio');
  }

  async function startCall() {
    if (engine.joined) return;
    el.startBtn?.setAttribute('disabled', 'disabled');
    try {
      const res = await engine.join({ video: settings.preferVideo !== false });
      if (!res.ok) {
        if (res.error === 'call_full') toast(`⚠️ ${t('call.full').replace('{n}', res.max ?? 4)}`);
        else if (res.error === 'not_in_room') toast(`⚠️ ${t('call.notInRoom')}`);
        else toast(`⚠️ ${t('call.failed')}`);
        return;
      }
      if (!res.relayAvailable && (res.peers?.length || 0) > 0) {
        // Not an error yet — just so the 10s warning later makes sense.
        console.info('[call] STUN only, no TURN configured');
      }
      renderControls();
      applyLayout();
    } catch (err) {
      if (err?.name === 'NotAllowedError') toast(`⚠️ ${t('call.permission')}`);
      else if (err?.code === 'unsupported') toast(`⚠️ ${t('call.unsupported')}`);
      else toast(`⚠️ ${t('call.failed')}`);
    } finally {
      el.startBtn?.removeAttribute('disabled');
    }
  }

  function endCall() {
    engine.leave();
    renderControls();
  }

  el.startBtn?.addEventListener('click', () => (engine.joined ? endCall() : startCall()));
  el.hangBtn.addEventListener('click', endCall);

  el.micBtn.addEventListener('click', () => engine.setMic(!engine.micOn));
  el.camBtn.addEventListener('click', () => engine.setCam(!engine.camOn));

  // The ✕ on the pod: video call ⇄ voice call, WITHOUT hanging up.
  el.modeBtn.addEventListener('click', async () => {
    el.modeBtn.disabled = true;
    try {
      const next = engine.mode === 'video' ? 'audio' : 'video';
      const res = await engine.setMode(next);
      if (res.ok) {
        settings.preferVideo = res.mode === 'video';
        saveSettings({ preferVideo: settings.preferVideo });
        toast(res.mode === 'video' ? t('call.nowVideo') : t('call.nowAudio'));
      }
    } finally {
      el.modeBtn.disabled = false;
      renderControls();
    }
  });

  el.collapse.addEventListener('click', () => {
    const collapsed = el.pod.classList.toggle('is-collapsed');
    saveSettings({ collapsed });
    el.collapse.setAttribute('aria-expanded', String(!collapsed));
  });
  if (settings.collapsed) {
    el.pod.classList.add('is-collapsed');
    el.collapse.setAttribute('aria-expanded', 'false');
  }

  /* --- ducking panel ------------------------------------------------ */

  if (el.duckPanel) {
    const syncPanel = () => {
      el.duckToggle.checked = ducker.enabled;
      // Slider runs "low sensitivity → high sensitivity", i.e. inverse of
      // the RMS threshold, which is the intuitive direction for a human.
      el.duckSense.value = String(Math.round((0.16 - ducker.config.rmsThreshold) * 1000));
      el.duckSenseVal.textContent = ducker.config.rmsThreshold.toFixed(3);
      el.duckDepth.value = String(Math.round(ducker.config.duckFloor * 100));
      el.duckDepthVal.textContent = `${Math.round(ducker.config.duckFloor * 100)}%`;
    };

    el.duckBtn?.addEventListener('click', () => {
      el.duckPanel.hidden = !el.duckPanel.hidden;
      if (!el.duckPanel.hidden) syncPanel();
    });
    el.duckClose?.addEventListener('click', () => { el.duckPanel.hidden = true; });

    el.duckToggle.addEventListener('change', () => {
      ducker.setEnabled(el.duckToggle.checked);
      saveSettings({ duckEnabled: el.duckToggle.checked });
    });

    el.duckSense.addEventListener('input', () => {
      const threshold = Math.max(0.01, 0.16 - Number(el.duckSense.value) / 1000);
      ducker.setThreshold(threshold);
      el.duckSenseVal.textContent = threshold.toFixed(3);
      saveSettings({ duckThreshold: threshold });
    });

    el.duckDepth.addEventListener('input', () => {
      const floor = Number(el.duckDepth.value) / 100;
      ducker.setFloor(floor);
      el.duckDepthVal.textContent = `${el.duckDepth.value}%`;
      saveSettings({ duckFloor: floor });
    });

    syncPanel();
  }

  /* ---------------------------------------------------------------- */
  /* Layout: corner strip ⇄ draggable PiP                               */
  /* ---------------------------------------------------------------- */

  const pip = { x: null, y: null, dragging: false, moved: false, dx: 0, dy: 0 };

  function applyLayout() {
    const full = Boolean(isFullscreen?.());
    el.pod.classList.toggle('is-pip', full);
    if (!full) {
      // Back to the docked strip: drop any drag offset.
      el.pod.style.left = '';
      el.pod.style.top = '';
      pip.x = null;
      pip.y = null;
      return;
    }
    if (pip.x === null) {
      const bounds = shell.getBoundingClientRect();
      const size = el.pod.getBoundingClientRect();
      pip.x = Math.max(8, bounds.width - size.width - 16);
      pip.y = 16;
    }
    placePip();
  }

  function placePip() {
    const bounds = shell.getBoundingClientRect();
    const size = el.pod.getBoundingClientRect();
    pip.x = Math.min(Math.max(8, pip.x), Math.max(8, bounds.width - size.width - 8));
    pip.y = Math.min(Math.max(8, pip.y), Math.max(8, bounds.height - size.height - 8));
    el.pod.style.left = `${pip.x}px`;
    el.pod.style.top = `${pip.y}px`;
  }

  function onPointerDown(event) {
    if (!el.pod.classList.contains('is-pip')) return;
    if (event.target.closest('button, input, label')) return;
    pip.dragging = true;
    pip.moved = false;
    const rect = el.pod.getBoundingClientRect();
    pip.dx = event.clientX - rect.left;
    pip.dy = event.clientY - rect.top;
    el.pod.classList.add('is-dragging');
    el.grip.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!pip.dragging) return;
    const bounds = shell.getBoundingClientRect();
    pip.x = event.clientX - bounds.left - pip.dx;
    pip.y = event.clientY - bounds.top - pip.dy;
    pip.moved = true;
    placePip();
    // Keep the movie's touch gestures from reacting to a drag.
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerUp(event) {
    if (!pip.dragging) return;
    pip.dragging = false;
    el.pod.classList.remove('is-dragging');
    el.grip.releasePointerCapture?.(event.pointerId);
  }

  el.grip.addEventListener('pointerdown', onPointerDown);
  el.grip.addEventListener('pointermove', onPointerMove, { passive: false });
  el.grip.addEventListener('pointerup', onPointerUp);
  el.grip.addEventListener('pointercancel', onPointerUp);

  // Double-tapping the pod in PiP flips between 16:9 and a small circle.
  el.grip.addEventListener('dblclick', () => {
    if (!el.pod.classList.contains('is-pip')) return;
    const round = el.pod.classList.toggle('is-round');
    saveSettings({ pipRound: round });
    placePip();
  });
  if (settings.pipRound) el.pod.classList.add('is-round');

  document.addEventListener('fullscreenchange', applyLayout);
  document.addEventListener('webkitfullscreenchange', applyLayout);
  window.addEventListener('resize', () => {
    if (el.pod.classList.contains('is-pip')) placePip();
  });

  /* ---------------------------------------------------------------- */
  /* Room roster events                                                 */
  /* ---------------------------------------------------------------- */

  socket.on('call:peer-joined', ({ peer, peers }) => {
    syncRoster(peers);
    if (!engine.joined || peer.id === socket.id) return;
    engine.addPeer(peer.id);
    toast(`📞 ${peer.name} ${t('call.joined')}`);
    warnIfCrowded(peers.length);
  });

  socket.on('call:peer-left', ({ peerId, peers }) => {
    syncRoster(peers);
    if (peerId === socket.id) return;
    // Explicit teardown: close the RTCPeerConnection and drop it from the
    // map, otherwise stale ICE keeps retrying against a ghost.
    engine.removePeer(peerId);
  });

  socket.on('call:peer-state', ({ peer, peers }) => {
    syncRoster(peers);
    const tile = tiles.get(peer.id);
    if (!tile) return;
    tile.root.classList.toggle('is-muted', !peer.audio);
    tile.root.classList.toggle('is-camoff', !peer.video);
    tile.label.textContent = peer.name;
  });

  function syncRoster(peers = []) {
    roster.clear();
    peers.forEach((p) => roster.set(p.id, p));
    renderHint(peers.length);
    peers.forEach((p) => {
      if (p.id === socket.id) return;
      const tile = tiles.get(p.id);
      if (tile) {
        tile.label.textContent = p.name;
        tile.avatar.textContent = initials(p.name);
        if (p.color) tile.avatar.style.background = p.color;
      }
    });
  }

  /**
   * Above 4 participants a mesh needs ~2.4 Mbps upload per person, which a
   * typical Iranian mobile connection cannot hold. The server normally caps
   * this at 4, so it only fires if the operator raised MAX_CALL_PEERS —
   * but then they really should hear about it.
   */
  function warnIfCrowded(count) {
    if (count > 4) toast(`⚠️ ${t('call.crowded')}`);
  }

  /** Let people see the call is full *before* they click "start call". */
  function renderHint(count = roster.size) {
    const hint = document.getElementById('callHint');
    if (!hint) return;
    if (!count) {
      hint.textContent = t('call.hint');
      hint.classList.remove('is-full');
      return;
    }
    const full = count >= 4;
    hint.textContent = full ? t('call.hintFull') : t('call.hintCount').replace('{n}', count);
    hint.classList.toggle('is-full', full);
  }

  // Leaving the page mid-call must not leave a zombie peer in the room.
  window.addEventListener('pagehide', () => engine.joined && engine.leave());

  document.addEventListener('langchange', () => {
    renderControls();
    renderHint();
  });

  renderControls();
  renderHint(0);
  updateCount();

  return {
    engine,
    ducker,
    refreshDuckSink,
    /** Seed the roster from the room:join snapshot. */
    syncRoster,
    applyLayout,
    end: endCall,
    get joined() { return engine.joined; },
  };
}
