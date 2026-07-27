/**
 * Smart movie-audio ducking — Web Audio API only, no AI.
 *
 * The idea: while somebody in the call is actually talking, pull the film's
 * volume down to a floor; when the talking stops, bring it back. A neural
 * VAD would only add latency (and this box has 2 cores), so we use the
 * primitive the platform already ships: an AnalyserNode + RMS.
 *
 * These constants are the tuned/measured set — do not "improve" them
 * casually, they are a package:
 *
 *   sampleMs      50    polling interval of the level meter
 *   rmsThreshold  0.06  above this = speech. Room tone, a PC fan, breathing
 *                       and the film leaking out of the speakers all sit
 *                       below it; a whisper sits above it.
 *   duckFloor     0.25  film drops to 25%, not to zero — you still follow
 *                       the scene while answering.
 *   holdMs        800   keep ducking for 800ms after the last loud sample.
 *                       This is the important one: a short pause mid-sentence
 *                       must NOT bounce the volume back up, otherwise the
 *                       soundtrack pumps up and down and drives you mad.
 *   timeConstant  0.15  setTargetAtTime constant → audibly reacts in ~150ms
 *                       yet never clicks.
 */

export const DUCK_DEFAULTS = Object.freeze({
  sampleMs: 50,
  rmsThreshold: 0.06,
  duckFloor: 0.25,
  holdMs: 800,
  timeConstant: 0.15,
});

/**
 * A media element may only ever have ONE MediaElementAudioSourceNode, and
 * creating it re-routes the element's output through the graph forever.
 * Cache it so re-attaching after a source switch does not throw.
 */
const elementSources = new WeakMap();

/** Web Audio can only see an element's audio if the media is not tainted. */
function canRouteThroughWebAudio(el) {
  const src = el.currentSrc || el.src || '';
  if (!src) return false;
  // blob: (local file, torrent, hls.js/MSE) and data: are same-origin.
  if (src.startsWith('blob:') || src.startsWith('data:')) return true;
  try {
    if (new URL(src, window.location.href).origin === window.location.origin) return true;
  } catch { /* not parseable — fall through */ }
  // A cross-origin file that loaded *at all* with crossorigin="anonymous"
  // already passed CORS, so it is not tainted either.
  return Boolean(el.crossOrigin);
}

export function createDucker(overrides = {}) {
  const cfg = { ...DUCK_DEFAULTS, ...overrides };

  let ctx = null;
  let analyser = null;
  let sampleBuf = null;
  let byteBuf = null;
  let timer = null;

  /** id -> { stream, source, gate } — one entry per voice we listen to. */
  const voices = new Map();

  let enabled = true;
  let running = false;
  let speaking = false;
  let lastLoudAt = 0;
  let lastRms = 0;

  /**
   * The thing whose volume we bend.
   *   { kind: 'graph',    el, gain }  → real GainNode (preferred)
   *   { kind: 'volume',   el }        → element.volume (tainted media)
   *   { kind: 'external', apply }     → YouTube iframe API, etc.
   */
  let sink = null;
  let appliedGain = 1;      // gain the sink currently has (0..1)
  let baseVolume = 1;       // the user's own volume, before ducking
  let selfVolumeWrite = false;
  let onChange = null;

  function ensureContext() {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    analyser = ctx.createAnalyser();
    // 2048 samples ≈ 43ms at 48kHz — one full window per 50ms tick.
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0; // time-domain data, smoothing is a no-op
    sampleBuf = new Float32Array(analyser.fftSize);
    byteBuf = new Uint8Array(analyser.fftSize);
    // The analyser is a dead end on purpose: voices are *heard* through their
    // own <video>/<audio> elements. Routing them to the destination too would
    // double them up and break echo cancellation.
    return ctx;
  }

  /** Chrome suspends the context until a gesture; nudge it whenever we can. */
  async function resume() {
    if (ctx && ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* user gesture still pending */ }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Voice inputs (local mic + every remote peer)                       */
  /* ---------------------------------------------------------------- */

  /**
   * Feed one MediaStream into the level meter.
   * The local mic is the obvious one, but remote peers matter just as much:
   * the film has to duck when your friend talks, not only when you do.
   */
  function addVoice(id, stream) {
    if (!stream || voices.has(id)) return;
    if (!stream.getAudioTracks().length) return;
    if (!ensureContext()) return;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const gate = ctx.createGain();
      gate.gain.value = 1;
      source.connect(gate).connect(analyser);
      voices.set(id, { stream, source, gate });
      resume();
    } catch {
      /* stream ended between the check and the wiring */
    }
  }

  function removeVoice(id) {
    const voice = voices.get(id);
    if (!voice) return;
    try { voice.source.disconnect(); } catch { /* already gone */ }
    try { voice.gate.disconnect(); } catch { /* already gone */ }
    voices.delete(id);
  }

  /** Muted mic must not duck the film — gate it out of the meter. */
  function setVoiceActive(id, active) {
    const voice = voices.get(id);
    if (voice) voice.gate.gain.value = active ? 1 : 0;
  }

  function hasVoices() {
    return voices.size > 0;
  }

  /* ---------------------------------------------------------------- */
  /* Output sink                                                        */
  /* ---------------------------------------------------------------- */

  function clearSink() {
    if (sink) applyGain(1, true);
    sink = null;
    appliedGain = 1;
  }

  /** Route a <video>/<audio> element's audio through a GainNode. */
  function attachElement(el) {
    clearSink();
    if (!el) return;

    baseVolume = el.volume;

    if (ensureContext() && canRouteThroughWebAudio(el)) {
      try {
        let source = elementSources.get(el);
        if (!source) {
          source = ctx.createMediaElementSource(el);
          elementSources.set(el, source);
        }
        const gain = ctx.createGain();
        gain.gain.value = 1;
        try { source.disconnect(); } catch { /* first attach */ }
        source.connect(gain).connect(ctx.destination);
        sink = { kind: 'graph', el, gain };
        resume();
        return;
      } catch {
        /* fall through to the volume-based sink */
      }
    }

    // Tainted or no Web Audio: bend element.volume instead. Same curve,
    // computed by hand on every tick.
    sink = { kind: 'volume', el };
  }

  /** For sources we cannot touch with Web Audio at all (YouTube iframe). */
  function attachExternal(apply) {
    clearSink();
    if (typeof apply === 'function') sink = { kind: 'external', apply };
  }

  /** The user moved the volume slider — that becomes the new 100%. */
  function noteUserVolume(volume) {
    if (selfVolumeWrite) return;
    const g = appliedGain || 1;
    baseVolume = Math.min(1, Math.max(0, volume / g));
  }

  function applyGain(gain, immediate = false) {
    appliedGain = gain;
    if (!sink) return;

    if (sink.kind === 'graph') {
      const now = ctx.currentTime;
      if (immediate) sink.gain.gain.setValueAtTime(gain, now);
      // The whole point of setTargetAtTime: an exponential approach with a
      // 0.15s constant. Reaches ~63% of the way in 150ms, no zipper noise.
      else sink.gain.gain.setTargetAtTime(gain, now, cfg.timeConstant);
      return;
    }

    if (sink.kind === 'volume') {
      selfVolumeWrite = true;
      sink.el.volume = Math.min(1, Math.max(0, baseVolume * gain));
      selfVolumeWrite = false;
      return;
    }

    if (sink.kind === 'external') {
      try { sink.apply(gain); } catch { /* player went away */ }
    }
  }

  /* ---------------------------------------------------------------- */
  /* The meter                                                          */
  /* ---------------------------------------------------------------- */

  function readRms() {
    if (!analyser) return 0;
    if (analyser.getFloatTimeDomainData) {
      analyser.getFloatTimeDomainData(sampleBuf);
      let sum = 0;
      for (let i = 0; i < sampleBuf.length; i += 1) sum += sampleBuf[i] * sampleBuf[i];
      return Math.sqrt(sum / sampleBuf.length);
    }
    // Older Safari: 8-bit time domain, centred on 128.
    analyser.getByteTimeDomainData(byteBuf);
    let sum = 0;
    for (let i = 0; i < byteBuf.length; i += 1) {
      const v = (byteBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / byteBuf.length);
  }

  /**
   * For the volume-based sink there is no setTargetAtTime, so we integrate
   * the identical exponential ourselves once per tick:
   *   g += (target - g) * (1 - e^(-dt/τ))
   */
  function stepManualGain(target) {
    const alpha = 1 - Math.exp(-(cfg.sampleMs / 1000) / cfg.timeConstant);
    let next = appliedGain + (target - appliedGain) * alpha;
    if (Math.abs(next - target) < 0.005) next = target;
    return next;
  }

  function tick() {
    if (!analyser) return;

    const rms = readRms();
    lastRms = rms;

    const now = Date.now();
    if (rms >= cfg.rmsThreshold) lastLoudAt = now;

    // Hold window: a breath or a comma mid-sentence keeps us ducked.
    const wasSpeaking = speaking;
    speaking = enabled && lastLoudAt > 0 && (now - lastLoudAt) < cfg.holdMs;

    const target = speaking ? cfg.duckFloor : 1;

    if (sink?.kind === 'graph' || sink?.kind === 'external') {
      // Graph: let setTargetAtTime do the ramp, only re-arm on change.
      // External: YouTube's setVolume is a step, so we shape it here.
      if (sink.kind === 'graph') {
        if (wasSpeaking !== speaking) applyGain(target);
      } else {
        const next = stepManualGain(target);
        if (Math.abs(next - appliedGain) > 0.001) applyGain(next);
      }
    } else if (sink?.kind === 'volume') {
      const next = stepManualGain(target);
      if (Math.abs(next - appliedGain) > 0.001) applyGain(next);
    }

    if (wasSpeaking !== speaking) onChange?.({ speaking, rms, gain: appliedGain });
  }

  function start() {
    if (running) return;
    if (!ensureContext()) return;
    running = true;
    resume();
    timer = setInterval(tick, cfg.sampleMs);
  }

  function stop() {
    running = false;
    clearInterval(timer);
    timer = null;
    speaking = false;
    lastLoudAt = 0;
    applyGain(1, true);
    onChange?.({ speaking: false, rms: 0, gain: 1 });
  }

  function destroy() {
    stop();
    [...voices.keys()].forEach(removeVoice);
    clearSink();
    if (ctx) {
      try { ctx.close(); } catch { /* already closed */ }
      ctx = null;
      analyser = null;
    }
  }

  return {
    config: cfg,
    start,
    stop,
    destroy,
    resume,
    addVoice,
    removeVoice,
    setVoiceActive,
    hasVoices,
    attachElement,
    attachExternal,
    clearSink,
    noteUserVolume,
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) {
        speaking = false;
        lastLoudAt = 0;
        applyGain(1);
        onChange?.({ speaking: false, rms: lastRms, gain: 1 });
      }
    },
    /** Sensitivity slider: lower threshold = picks up quieter speech. */
    setThreshold(value) {
      const v = Number(value);
      if (Number.isFinite(v) && v > 0 && v < 1) cfg.rmsThreshold = v;
    },
    /** Strength slider: how far down the film goes while someone talks. */
    setFloor(value) {
      const v = Number(value);
      if (Number.isFinite(v) && v >= 0 && v <= 1) cfg.duckFloor = v;
    },
    onChange(fn) { onChange = fn; },
    get enabled() { return enabled; },
    get running() { return running; },
    get speaking() { return speaking; },
    get level() { return lastRms; },
    get gain() { return appliedGain; },
    get sinkKind() { return sink?.kind || null; },
  };
}
