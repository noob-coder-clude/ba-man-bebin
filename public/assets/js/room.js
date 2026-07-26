import { initLangSwitch, t } from './i18n.js';

initLangSwitch();

/* ------------------------------------------------------------------ */
/* Elements + state                                                     */
/* ------------------------------------------------------------------ */

const roomId = window.location.pathname.split('/').filter(Boolean).pop();
document.getElementById('roomId').textContent = roomId;

const el = {
  shell: document.getElementById('playerShell'),
  empty: document.getElementById('playerEmpty'),
  ytHost: document.getElementById('ytHost'),
  video: document.getElementById('localVideo'),
  sourceInput: document.getElementById('sourceInput'),
  loadBtn: document.getElementById('loadBtn'),
  testBtn: document.getElementById('testBtn'),
  kindBadge: document.getElementById('kindBadge'),
  proxyToggle: document.getElementById('proxyToggle'),
  proxyWrap: document.getElementById('proxyWrap'),
  probe: document.getElementById('probe'),
  probeIcon: document.getElementById('probeIcon'),
  probeTitle: document.getElementById('probeTitle'),
  probeList: document.getElementById('probeList'),
  probeClose: document.getElementById('probeClose'),
  torrentHud: document.getElementById('torrentHud'),
  torrentProgress: document.getElementById('torrentProgress'),
  torrentMeta: document.getElementById('torrentMeta'),
  fileBtn: document.getElementById('fileBtn'),
  fileInput: document.getElementById('fileInput'),
  syncBtn: document.getElementById('syncBtn'),
  members: document.getElementById('members'),
  memberCount: document.getElementById('memberCount'),
  chatList: document.getElementById('chatList'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  reactions: document.getElementById('reactions'),
  roleBadge: document.getElementById('roleBadge'),
  copyBtn: document.getElementById('copyBtn'),
  modal: document.getElementById('nameModal'),
  nameForm: document.getElementById('nameForm'),
  nameInput: document.getElementById('nameInput'),
  toast: document.getElementById('toast'),
};

const state = {
  me: null,
  isHost: false,
  source: null,
  suppress: false, // ignore local player events triggered by remote sync
  ytReady: false,
  ytPlayer: null,
  pendingSource: null,
  lastProbe: null, // report for the link currently in the input
  hls: null, // hls.js instance
  torrent: null, // { client, torrent } for magnet playback
};

let socket = null;
let toastTimer;

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 3200);
}

const initials = (name) => (name || '?').trim().slice(0, 2).toUpperCase();
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------ */
/* YouTube helpers                                                      */
/* ------------------------------------------------------------------ */

function parseYouTubeId(url) {
  const value = String(url || '').trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const u = new URL(value);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1, 12) || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
    const m = u.pathname.match(/\/(embed|shorts|live)\/([\w-]{11})/);
    if (m) return m[2];
  } catch {
    /* not a URL */
  }
  return null;
}

window.onYouTubeIframeAPIReady = () => {
  state.ytReady = true;
  if (state.pendingSource) {
    const pending = state.pendingSource;
    state.pendingSource = null;
    applySource(pending.source, pending.playback);
  }
};

function createYtPlayer(videoId, playback) {
  el.empty.classList.add('hidden');
  el.video.classList.add('hidden');
  el.ytHost.classList.remove('hidden');

  if (state.ytPlayer?.loadVideoById) {
    state.ytPlayer.loadVideoById({ videoId, startSeconds: playback?.time || 0 });
    if (!playback?.playing) setTimeout(() => state.ytPlayer.pauseVideo(), 250);
    return;
  }

  el.ytHost.innerHTML = '<div id="ytFrame"></div>';
  // eslint-disable-next-line no-undef
  state.ytPlayer = new YT.Player('ytFrame', {
    videoId,
    width: '100%',
    height: '100%',
    playerVars: { autoplay: 0, rel: 0, modestbranding: 1, playsinline: 1, origin: window.location.origin },
    events: {
      onReady: () => {
        if (playback) {
          state.suppress = true;
          state.ytPlayer.seekTo(playback.time || 0, true);
          if (playback.playing) state.ytPlayer.playVideo();
          else state.ytPlayer.pauseVideo();
          setTimeout(() => { state.suppress = false; }, 700);
        }
      },
      onStateChange: onYtStateChange,
    },
  });
}

function onYtStateChange(event) {
  if (!state.isHost || state.suppress) return;
  // eslint-disable-next-line no-undef
  const YTS = YT.PlayerState;
  if (event.data === YTS.PLAYING) emitControl(true, state.ytPlayer.getCurrentTime(), 'play');
  if (event.data === YTS.PAUSED) emitControl(false, state.ytPlayer.getCurrentTime(), 'pause');
}

/* ------------------------------------------------------------------ */
/* Unified player interface (YouTube or <video>)                        */
/* ------------------------------------------------------------------ */

const player = {
  get kind() {
    return state.source?.kind || null;
  },
  currentTime() {
    if (this.kind === 'youtube') return state.ytPlayer?.getCurrentTime?.() ?? 0;
    return el.video.currentTime || 0;
  },
  seek(time) {
    if (this.kind === 'youtube') state.ytPlayer?.seekTo?.(time, true);
    else el.video.currentTime = time;
  },
  play() {
    if (this.kind === 'youtube') state.ytPlayer?.playVideo?.();
    else el.video.play().catch(() => {});
  },
  pause() {
    if (this.kind === 'youtube') state.ytPlayer?.pauseVideo?.();
    else el.video.pause();
  },
};

/* ------------------------------------------------------------------ */
/* Source loading: youtube · direct (mp4/HLS, optional proxy) · torrent */
/* ------------------------------------------------------------------ */

const proxied = (url) => `/api/media/proxy?url=${encodeURIComponent(url)}`;

/** Tear down whatever engine is currently running before switching source. */
function teardownPlayback() {
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  if (state.torrent) {
    try {
      state.torrent.client.destroy();
    } catch { /* already gone */ }
    state.torrent = null;
  }
  el.torrentHud.hidden = true;
  el.video.removeAttribute('src');
  el.video.load?.();
}

function showVideoElement() {
  el.empty.classList.add('hidden');
  el.ytHost.classList.add('hidden');
  el.video.classList.remove('hidden');
}

/** Play a direct URL (mp4/webm/m3u8), optionally routed through our server. */
function playDirect(source, playback) {
  const raw = source.value;
  const url = source.proxy ? proxied(raw) : raw;
  showVideoElement();

  const isHls = source.hls || /\.m3u8(\?|#|$)/i.test(raw);

  if (isHls) {
    // Safari plays HLS natively; everyone else needs hls.js.
    if (el.video.canPlayType('application/vnd.apple.mpegurl')) {
      el.video.src = url;
    } else if (window.Hls?.isSupported()) {
      state.hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
      state.hls.loadSource(url);
      state.hls.attachMedia(el.video);
      state.hls.on(window.Hls.Events.ERROR, (_e, data) => {
        if (data?.fatal) toast(`⚠️ ${t('probe.failTitle')}`);
      });
    } else {
      toast(`⚠️ ${t('probe.container')}`);
      return;
    }
  } else {
    el.video.src = url;
  }

  el.video.controls = state.isHost;
  if (playback) setTimeout(() => applyPlaybackState(playback), 400);
}

/** Stream a magnet/torrent peer-to-peer, straight into the <video> element. */
async function playTorrent(source, playback) {
  showVideoElement();
  el.torrentHud.hidden = false;
  el.torrentProgress.style.width = '0%';
  el.torrentMeta.textContent = t('torrent.connecting');

  let WebTorrent;
  try {
    ({ default: WebTorrent } = await import('https://cdn.jsdelivr.net/npm/webtorrent@2.5.1/dist/webtorrent.min.js'));
  } catch {
    el.torrentMeta.textContent = t('torrent.failed');
    toast(`⚠️ ${t('torrent.failed')}`);
    return;
  }

  const client = new WebTorrent();
  state.torrent = { client, torrent: null };
  el.torrentMeta.textContent = t('torrent.searching');

  client.on('error', () => {
    el.torrentMeta.textContent = t('torrent.failed');
  });

  client.add(source.value, (torrent) => {
    if (!state.torrent) return; // switched source while connecting
    state.torrent.torrent = torrent;

    const file = torrent.files
      .filter((f) => /\.(mp4|webm|mkv|avi|mov|m4v)$/i.test(f.name))
      .sort((a, b) => b.length - a.length)[0];

    if (!file) {
      el.torrentMeta.textContent = t('torrent.noVideo');
      toast(`⚠️ ${t('torrent.noVideo')}`);
      return;
    }

    file.streamTo(el.video);
    el.video.controls = state.isHost;
    if (playback) setTimeout(() => applyPlaybackState(playback), 1200);

    const fmt = (bytes) => {
      const units = ['B', 'KB', 'MB', 'GB'];
      let n = bytes;
      let i = 0;
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
      return `${n.toFixed(1)} ${units[i]}`;
    };

    const tick = () => {
      if (!state.torrent?.torrent) return;
      const pct = Math.min(100, torrent.progress * 100);
      el.torrentProgress.style.width = `${pct}%`;
      el.torrentMeta.textContent =
        `${pct.toFixed(1)}% · ${t('torrent.peers')}: ${torrent.numPeers} · `
        + `${t('torrent.speed')}: ${fmt(torrent.downloadSpeed)}/s · `
        + `${t('torrent.downloaded')}: ${fmt(torrent.downloaded)}`;
      if (torrent.progress >= 1) setTimeout(() => { el.torrentHud.hidden = true; }, 2500);
    };

    torrent.on('download', tick);
    torrent.on('done', tick);
    tick();
  });
}

function applySource(source, playback) {
  teardownPlayback();
  state.source = source;
  if (!source) return;

  updateKindBadge(source.kind);

  if (source.kind === 'youtube') {
    el.video.classList.add('hidden');
    if (!state.ytReady) {
      state.pendingSource = { source, playback };
      return;
    }
    createYtPlayer(source.value, playback);
    return;
  }

  if (source.kind === 'direct') {
    playDirect(source, playback);
    return;
  }

  if (source.kind === 'torrent') {
    playTorrent(source, playback);
    return;
  }

  // Local file: each viewer must open the same file themselves.
  el.empty.classList.remove('hidden');
  el.ytHost.classList.add('hidden');
  if (!el.video.src) toast(t('room.fileNote'));
}

function updateKindBadge(kind) {
  if (!kind) {
    el.kindBadge.hidden = true;
    return;
  }
  const labels = { youtube: 'YouTube', direct: 'Direct', torrent: 'Torrent', file: 'File' };
  el.kindBadge.textContent = labels[kind] || kind;
  el.kindBadge.className = 'badge badge--kind';
  el.kindBadge.hidden = false;
}

/** Align local playback with the authoritative server state. */
function applyPlaybackState(playback) {
  if (!playback || !state.source) return;
  if (state.source.kind === 'file' && !el.video.src) return;
  // Nothing to sync against until the media element has metadata.
  if (['direct', 'torrent'].includes(state.source.kind) && el.video.readyState === 0) return;

  state.suppress = true;
  const target = playback.time + (playback.playing ? (Date.now() - playback.serverTime) / 1000 : 0);
  const drift = Math.abs(player.currentTime() - target);
  if (drift > 0.6) player.seek(target);
  if (playback.playing) player.play();
  else player.pause();
  setTimeout(() => { state.suppress = false; }, 600);
}

function isPlaying() {
  if (state.source?.kind === 'youtube') {
    // 1 === YT.PlayerState.PLAYING (avoid touching YT before the API loads)
    return state.ytPlayer?.getPlayerState?.() === 1;
  }
  // hls.js and torrent streams attach via MediaSource, so check readiness
  // rather than the src attribute alone.
  const hasMedia = Boolean(el.video.src || el.video.srcObject || el.video.readyState > 0);
  return hasMedia && !el.video.paused;
}

function emitControl(playing, time, reason) {
  socket?.emit('player:control', { playing, time, reason, rate: 1 });
}

/* Local <video> events (host only) */
['play', 'pause', 'seeked'].forEach((evt) => {
  el.video.addEventListener(evt, () => {
    if (!state.isHost || state.suppress) return;
    emitControl(!el.video.paused, el.video.currentTime, evt);
  });
});

/* ------------------------------------------------------------------ */
/* UI rendering                                                         */
/* ------------------------------------------------------------------ */

function renderMembers(members, hostId) {
  el.memberCount.textContent = members.length;
  el.members.innerHTML = '';
  members.forEach((m) => {
    const node = document.createElement('span');
    node.className = 'member';
    node.innerHTML = `<span class="avatar" style="background:${m.color}">${escapeHtml(initials(m.name))}</span>
      <span>${escapeHtml(m.name)}</span>${m.id === hostId ? ' 🎬' : ''}`;
    if (state.isHost && m.id !== state.me?.id) {
      node.style.cursor = 'pointer';
      node.title = 'Make host';
      node.addEventListener('click', () => socket.emit('room:transfer-host', { memberId: m.id }));
    }
    el.members.appendChild(node);
  });
}

function setRole(isHost) {
  state.isHost = isHost;
  el.roleBadge.textContent = isHost ? t('room.host') : t('room.viewer');
  el.roleBadge.classList.toggle('badge--host', isHost);
  el.loadBtn.disabled = !isHost;
  el.testBtn.disabled = !isHost;
  el.sourceInput.disabled = !isHost;
  el.proxyToggle.disabled = !isHost;
  el.proxyWrap.style.opacity = isHost ? '1' : '0.5';
  // Picking a local file is always allowed — it never leaves the browser,
  // and viewers need it to follow along when the host shares a file.
  el.fileBtn.disabled = false;
  if (state.source?.kind !== 'file') el.video.controls = isHost;
}

function addMessage(message) {
  const wrap = document.createElement('div');

  if (message.type === 'system') {
    wrap.className = 'msg msg--system';
    const verb = message.event === 'join' ? t('room.joined') : t('room.left');
    wrap.textContent = `${message.name} ${verb}`;
  } else {
    const mine = message.senderId === state.me?.id;
    wrap.className = `msg${mine ? ' msg--me' : ''}`;
    const time = new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    wrap.innerHTML = `<div class="msg__meta"><b style="color:${message.color}">${escapeHtml(message.from)}</b> · ${time}</div>
      <div class="msg__body">${escapeHtml(message.text)}</div>`;
  }

  el.chatList.appendChild(wrap);
  el.chatList.scrollTop = el.chatList.scrollHeight;
}

function floatEmoji(emoji) {
  const node = document.createElement('div');
  node.className = 'floating-emoji';
  node.textContent = emoji;
  node.style.left = `${10 + Math.random() * 70}%`;
  node.style.bottom = '90px';
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2500);
}

/* ------------------------------------------------------------------ */
/* Socket wiring                                                        */
/* ------------------------------------------------------------------ */

function connect(name) {
  // eslint-disable-next-line no-undef
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    socket.emit('room:join', { roomId, name }, (res) => {
      if (res?.error) {
        toast(`⚠️ ${res.error}`);
        return;
      }
      state.me = res.me;
      setRole(res.me.isHost);
      renderMembers(res.room.members, res.room.hostId);
      el.chatList.innerHTML = '';
      res.room.messages.forEach(addMessage);
      if (res.room.source) applySource(res.room.source, res.room.state);
    });
  });

  socket.on('room:member-joined', ({ members, hostId, message }) => {
    addMessage(message);
    renderMembers(members, hostId);
    // Push the current playhead so the newcomer lands on the exact frame.
    if (state.isHost && state.source) {
      const time = player.currentTime();
      if (Number.isFinite(time)) emitControl(isPlaying(), time, 'newcomer');
    }
  });

  socket.on('room:member-left', ({ members, hostId, message }) => {
    addMessage(message);
    if (hostId === state.me?.id && !state.isHost) {
      setRole(true);
      toast(t('room.hostNow'));
    }
    renderMembers(members, hostId);
  });

  socket.on('room:members', ({ members, hostId }) => {
    const amHost = hostId === state.me?.id;
    if (amHost !== state.isHost) {
      setRole(amHost);
      if (amHost) toast(t('room.hostNow'));
    }
    renderMembers(members, hostId);
  });

  socket.on('player:source', ({ source, state: playback }) => {
    applySource(source, playback);
  });

  socket.on('player:sync', ({ state: playback }) => {
    applyPlaybackState(playback);
  });

  socket.on('chat:message', addMessage);
  socket.on('chat:reaction', ({ emoji }) => floatEmoji(emoji));

  socket.on('disconnect', () => toast(t('room.disconnected')));
  socket.io.on('reconnect', () => toast(t('room.reconnected')));
}

/* ------------------------------------------------------------------ */
/* Event handlers                                                       */
/* ------------------------------------------------------------------ */

el.nameForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = el.nameInput.value.trim() || 'Guest';
  localStorage.setItem('bmb.name', name);
  el.modal.classList.remove('is-open');
  connect(name);
});

const savedName = localStorage.getItem('bmb.name');
if (savedName) el.nameInput.value = savedName;

/* ------------------------------------------------------------------ */
/* Playability test ("قبلش تست بگیره پخش میشه یا نه")                   */
/* ------------------------------------------------------------------ */

const fmtBytes = (bytes) => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(1)} ${units[i]}`;
};

const PROBE_ERRORS = {
  timeout: 'probe.errTimeout',
  unreachable: 'probe.errUnreachable',
  dns_failed: 'probe.errDns',
  blocked_address: 'probe.errBlocked',
  unsupported_protocol: 'probe.errProtocol',
  invalid_url: 'probe.errInvalid',
  unsupported_link: 'probe.errUnsupported',
  too_many_redirects: 'probe.errUnreachable',
};

function showProbe(variant, title, items, icon) {
  el.probe.hidden = false;
  el.probe.className = `probe probe--${variant}`;
  el.probeIcon.textContent = icon;
  el.probeIcon.className = 'probe__icon';
  el.probeTitle.textContent = title;
  el.probeList.innerHTML = '';
  items.forEach(({ text, tone }) => {
    const li = document.createElement('li');
    if (tone) li.className = `is-${tone}`;
    li.textContent = text;
    el.probeList.appendChild(li);
  });
}

function setProbeLoading() {
  el.probe.hidden = false;
  el.probe.className = 'probe';
  el.probeIcon.textContent = '⏳';
  el.probeIcon.className = 'probe__icon spin';
  el.probeTitle.textContent = t('room.testing');
  el.probeList.innerHTML = '';
}

/** Run the test and return the source descriptor to load (or null). */
async function testLink({ silent = false } = {}) {
  const url = el.sourceInput.value.trim();
  if (!url) {
    toast(t('room.enterLink'));
    return null;
  }

  if (!silent) setProbeLoading();

  let data;
  try {
    const res = await fetch('/api/media/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    data = await res.json();
  } catch {
    showProbe('fail', t('probe.failTitle'), [{ text: t('probe.errUnreachable'), tone: 'bad' }], '❌');
    return null;
  }

  // --- YouTube -----------------------------------------------------
  if (data.kind === 'youtube') {
    state.lastProbe = data;
    updateKindBadge('youtube');
    showProbe('ok', t('probe.ytTitle'), [
      { text: `${t('probe.kind')}: YouTube`, tone: 'good' },
      { text: `ID: ${data.source.value}`, tone: 'good' },
    ], '✅');
    return { kind: 'youtube', value: data.source.value, title: data.source.title || url };
  }

  // --- Torrent -----------------------------------------------------
  if (data.kind === 'torrent') {
    state.lastProbe = data;
    updateKindBadge('torrent');
    showProbe('warn', t('probe.torrentTitle'), [
      { text: `${t('probe.kind')}: Torrent / Magnet`, tone: 'good' },
      { text: data.source.title || '—' },
      { text: t('probe.torrentNote'), tone: 'warn' },
      { text: t('probe.torrentP2P'), tone: 'warn' },
    ], '🧲');
    return { kind: 'torrent', value: data.source.value, title: data.source.title };
  }

  // --- Unsupported --------------------------------------------------
  if (data.kind !== 'direct') {
    state.lastProbe = null;
    updateKindBadge(null);
    showProbe('fail', t('probe.failTitle'), [
      { text: t(PROBE_ERRORS[data.error] || 'probe.errUnsupported'), tone: 'bad' },
    ], '❌');
    return null;
  }

  // --- Direct link ---------------------------------------------------
  const report = data.report || {};
  state.lastProbe = data;
  updateKindBadge('direct');

  if (!data.playable) {
    const reason = report.error
      ? t(PROBE_ERRORS[report.error] || 'probe.errUnreachable')
      : `${t('probe.errStatus')}: HTTP ${report.status}`;
    showProbe('fail', t('probe.failTitle'), [{ text: reason, tone: 'bad' }], '❌');
    return null;
  }

  const items = [{ text: t('probe.reachable'), tone: 'good' }];
  if (report.contentType) items.push({ text: `${t('probe.contentType')}: ${report.contentType}` });
  if (report.sizeBytes) items.push({ text: `${t('probe.size')}: ${fmtBytes(report.sizeBytes)}` });
  if (report.isHls) items.push({ text: t('probe.hls'), tone: 'good' });

  items.push(report.seekable
    ? { text: t('probe.seekable'), tone: 'good' }
    : { text: t('probe.noSeek'), tone: 'warn' });

  // The key bit for the "works in Iran and abroad" requirement: when the
  // origin refuses cross-origin playback we transparently switch to the proxy.
  if (data.proxy) {
    el.proxyToggle.checked = true;
    el.proxyWrap.classList.add('is-on');
    items.push({ text: t('probe.corsClosed'), tone: 'warn' });
  } else {
    items.push({ text: t('probe.corsOpen'), tone: 'good' });
  }

  const warnings = report.warnings || [];
  if (warnings.includes('not_video_content_type')) items.push({ text: t('probe.notVideo'), tone: 'warn' });
  if (warnings.includes('container_may_not_play')) items.push({ text: t('probe.container'), tone: 'warn' });

  const hasWarning = warnings.length > 0 || data.proxy || !report.seekable;
  showProbe(hasWarning ? 'warn' : 'ok',
    hasWarning ? t('probe.warnTitle') : t('probe.okTitle'),
    items,
    hasWarning ? '⚠️' : '✅');

  return {
    kind: 'direct',
    value: report.finalUrl || url,
    title: data.source.title || url,
    hls: Boolean(report.isHls),
    proxy: el.proxyToggle.checked,
  };
}

el.testBtn.addEventListener('click', async () => {
  el.testBtn.disabled = true;
  try {
    await testLink();
  } finally {
    el.testBtn.disabled = false;
  }
});

el.probeClose.addEventListener('click', () => { el.probe.hidden = true; });

// Re-testing is required whenever the link changes.
el.sourceInput.addEventListener('input', () => {
  state.lastProbe = null;
  updateKindBadge(null);
});

el.proxyToggle.addEventListener('change', () => {
  el.proxyWrap.classList.toggle('is-on', el.proxyToggle.checked);
});

/** Load = test (if not already tested) then broadcast to the room. */
el.loadBtn.addEventListener('click', async () => {
  if (!state.isHost) {
    toast(t('room.onlyHost'));
    return;
  }
  if (!el.sourceInput.value.trim()) {
    toast(t('room.enterLink'));
    return;
  }

  el.loadBtn.disabled = true;
  try {
    const source = await testLink();
    if (!source) return; // the probe panel already explains why

    if (source.kind === 'direct') source.proxy = el.proxyToggle.checked;
    socket.emit('player:source', source);
  } finally {
    el.loadBtn.disabled = false;
  }
});

el.fileBtn.addEventListener('click', () => el.fileInput.click());

el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files?.[0];
  if (!file) return;
  teardownPlayback();
  el.video.src = URL.createObjectURL(file);
  showVideoElement();
  el.video.controls = true;
  updateKindBadge('file');
  if (state.isHost) socket.emit('player:source', { kind: 'file', value: file.name, title: file.name });
  else state.source = { kind: 'file', value: file.name };
  toast(t('room.fileNote'));
});

el.syncBtn.addEventListener('click', () => {
  socket?.emit('player:request-sync', {}, (res) => {
    if (res?.state) applyPlaybackState(res.state);
  });
});

el.chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = el.chatInput.value.trim();
  if (!text) return;
  socket?.emit('chat:message', { text });
  el.chatInput.value = '';
});

el.reactions.addEventListener('click', (event) => {
  const emoji = event.target.closest('button')?.dataset.emoji;
  if (emoji) socket?.emit('chat:reaction', { emoji });
});

el.copyBtn.addEventListener('click', async () => {
  const link = window.location.href;
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const tmp = document.createElement('input');
    tmp.value = link;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
  }
  toast(t('room.copied'));
});

/* Host heartbeat: keep everyone aligned every 5 seconds. */
setInterval(() => {
  if (!state.isHost || !state.source || !socket?.connected) return;
  const time = player.currentTime();
  if (!Number.isFinite(time)) return;
  emitControl(isPlaying(), time, 'heartbeat');
}, 5000);

/* Keep translated bits in sync when the language changes. */
function refreshDynamicText() {
  setRole(state.isHost);
  el.sourceInput.placeholder = t('room.sourcePlaceholderAny');
  el.proxyWrap.title = t('room.proxyHint');
}

document.addEventListener('langchange', refreshDynamicText);
refreshDynamicText();
