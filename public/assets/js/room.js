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

function applySource(source, playback) {
  state.source = source;
  if (!source) return;

  if (source.kind === 'youtube') {
    if (!state.ytReady) {
      state.pendingSource = { source, playback };
      return;
    }
    createYtPlayer(source.value, playback);
  } else {
    // Local file: each viewer must open the same file themselves.
    el.empty.classList.remove('hidden');
    el.ytHost.classList.add('hidden');
    if (!el.video.src) toast(t('room.fileNote'));
  }
}

/** Align local playback with the authoritative server state. */
function applyPlaybackState(playback) {
  if (!playback || !state.source) return;
  if (state.source.kind === 'file' && !el.video.src) return;

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
  return Boolean(el.video.src) && !el.video.paused;
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
  el.sourceInput.disabled = !isHost;
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

el.loadBtn.addEventListener('click', () => {
  if (!state.isHost) return toast(t('room.onlyHost'));
  const videoId = parseYouTubeId(el.sourceInput.value);
  if (!videoId) return toast(t('room.invalidUrl'));
  socket.emit('player:source', { kind: 'youtube', value: videoId, title: el.sourceInput.value });
  return undefined;
});

el.fileBtn.addEventListener('click', () => el.fileInput.click());

el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files?.[0];
  if (!file) return;
  el.video.src = URL.createObjectURL(file);
  el.video.classList.remove('hidden');
  el.empty.classList.add('hidden');
  el.ytHost.classList.add('hidden');
  el.video.controls = true;
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

/* Keep the role badge translated when the language changes. */
document.addEventListener('langchange', () => setRole(state.isHost));
