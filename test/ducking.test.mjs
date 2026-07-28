/**
 * Ducking algorithm tests.
 *
 * ducking.js is browser code, so we stub the small slice of Web Audio it
 * touches and then drive it with synthetic audio. The point is to pin down
 * the tuned behaviour, especially:
 *   · a short pause mid-sentence must NOT let the movie jump back up
 *   · room tone / fan / breathing must not trigger it
 *   · the reaction must be audible within ~150ms
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

/* ------------------------------------------------------------------ */
/* Minimal Web Audio + timer stubs                                      */
/* ------------------------------------------------------------------ */

let now = 0;          // AudioContext.currentTime, seconds
let wallClock = 0;    // Date.now(), ms
const pending = [];   // scheduled setInterval callbacks

/** Level the fake microphone is currently producing (RMS, 0..1). */
let micLevel = 0;

class FakeAudioParam {
  constructor() {
    this.value = 1;
    this.target = 1;
    this.startedAt = 0;
    this.startValue = 1;
    this.timeConstant = 0;
  }

  setValueAtTime(v, t) {
    this.value = v;
    this.target = v;
    this.startValue = v;
    this.startedAt = t;
    this.timeConstant = 0;
  }

  /** The real exponential approach: v(t) = target + (v0-target)·e^(-t/τ) */
  setTargetAtTime(target, startTime, timeConstant) {
    this.startValue = this.valueAt(startTime);
    this.target = target;
    this.startedAt = startTime;
    this.timeConstant = timeConstant;
  }

  valueAt(t) {
    if (!this.timeConstant) return this.target;
    const dt = Math.max(0, t - this.startedAt);
    return this.target + (this.startValue - this.target) * Math.exp(-dt / this.timeConstant);
  }
}

class FakeNode {
  constructor() { this.gain = new FakeAudioParam(); }
  connect(next) { return next; }
  disconnect() {}
}

class FakeAnalyser extends FakeNode {
  constructor() {
    super();
    this.fftSize = 2048;
    this.smoothingTimeConstant = 0;
  }

  /** Emit a sine whose RMS equals the requested micLevel. */
  getFloatTimeDomainData(buf) {
    const amplitude = micLevel * Math.SQRT2;
    for (let i = 0; i < buf.length; i += 1) buf[i] = amplitude * Math.sin((2 * Math.PI * i) / 64);
  }
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.destination = new FakeNode();
  }

  get currentTime() { return now; }
  createAnalyser() { return new FakeAnalyser(); }
  createGain() { return new FakeNode(); }
  createMediaStreamSource() { return new FakeNode(); }
  createMediaElementSource() { return new FakeNode(); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; }
}

function installEnv() {
  now = 0;
  wallClock = 1_000_000;
  micLevel = 0;
  pending.length = 0;

  globalThis.window = { AudioContext: FakeAudioContext, location: { href: 'https://x.test/room/a' } };
  globalThis.AudioContext = FakeAudioContext;
  globalThis.MediaStream = class {};
  globalThis.URL = URL;

  globalThis.setInterval = (fn, ms) => {
    const handle = { fn, ms, next: wallClock + ms };
    pending.push(handle);
    return handle;
  };
  globalThis.clearInterval = (handle) => {
    const i = pending.indexOf(handle);
    if (i >= 0) pending.splice(i, 1);
  };

  Date.now = () => wallClock;
}

/** Advance simulated time, firing the level meter on its 50ms schedule. */
function advance(ms) {
  const end = wallClock + ms;
  for (;;) {
    const due = pending.filter((h) => h.next <= end).sort((a, b) => a.next - b.next)[0];
    if (!due) break;
    const step = due.next - wallClock;
    wallClock += step;
    now += step / 1000;
    due.next += due.ms;
    due.fn();
  }
  const rest = end - wallClock;
  wallClock = end;
  now += rest / 1000;
}

const realDateNow = Date.now;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

let createDucker;
let DUCK_DEFAULTS;

beforeEach(async () => {
  installEnv();
  ({ createDucker, DUCK_DEFAULTS } = await import('../public/assets/js/ducking.js'));
});

afterEach(() => {
  Date.now = realDateNow;
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
});

/* ------------------------------------------------------------------ */

/** A ducker wired to a GainNode sink, as a real <video> would be. */
function makeDucker(overrides) {
  const ducker = createDucker(overrides);
  ducker.addVoice('self', { getAudioTracks: () => [{}] });
  // Route to a same-origin element so the graph (GainNode) path is used.
  ducker.attachElement({ volume: 1, currentSrc: 'blob:https://x.test/abc', crossOrigin: null });
  ducker.start();
  return ducker;
}

/** Read the gain the sink would actually be applying right now. */
function gainOf(ducker) {
  return ducker.gain;
}

describe('ducking constants', () => {
  it('uses the measured/tuned values', () => {
    assert.equal(DUCK_DEFAULTS.sampleMs, 50);
    assert.equal(DUCK_DEFAULTS.rmsThreshold, 0.06);
    assert.equal(DUCK_DEFAULTS.duckFloor, 0.25);
    assert.equal(DUCK_DEFAULTS.holdMs, 800);
    assert.equal(DUCK_DEFAULTS.timeConstant, 0.15);
  });
});

describe('speech detection threshold (0.06 RMS)', () => {
  const quiet = [
    ['silent room', 0.004],
    ['PC fan / air conditioning', 0.02],
    ['breathing', 0.035],
    ['movie leaking from the speakers', 0.05],
  ];

  quiet.forEach(([label, level]) => {
    it(`ignores ${label} (rms ${level})`, () => {
      const ducker = makeDucker();
      micLevel = level;
      advance(2000);
      assert.equal(ducker.speaking, false, `${label} must not duck the movie`);
      assert.equal(gainOf(ducker), 1);
      ducker.destroy();
    });
  });

  const loud = [
    ['a whisper', 0.07],
    ['normal speech', 0.15],
    ['someone excited', 0.4],
  ];

  loud.forEach(([label, level]) => {
    it(`ducks for ${label} (rms ${level})`, () => {
      const ducker = makeDucker();
      micLevel = level;
      advance(300);
      assert.equal(ducker.speaking, true, `${label} should duck the movie`);
      ducker.destroy();
    });
  });
});

describe('reaction speed', () => {
  it('detects speech within one sample period (50ms)', () => {
    const ducker = makeDucker();
    micLevel = 0.2;
    advance(60);
    assert.equal(ducker.speaking, true, 'the meter runs every 50ms, so this must already be flagged');
    ducker.destroy();
  });

  it('has audibly pulled the movie down 150ms after speech starts', () => {
    // Measured on the element.volume sink, which integrates the very same
    // curve the GainNode gets via setTargetAtTime.
    const ducker = createDucker();
    ducker.addVoice('self', { getAudioTracks: () => [{}] });
    const element = { volume: 1, currentSrc: 'https://other.test/m.mp4', crossOrigin: null };
    ducker.attachElement(element);
    ducker.start();

    micLevel = 0.2;
    advance(150);

    assert.equal(ducker.speaking, true);
    // 1 → 0.25 with τ=0.15: after one time constant ~63% of the way down.
    assert.ok(element.volume < 0.56, `expected a clearly audible drop, got ${element.volume}`);
    assert.ok(element.volume > 0.25, 'but not slammed straight to the floor');
    ducker.destroy();
  });

  it('follows the exponential curve of setTargetAtTime (τ=0.15)', () => {
    // Verified against the sink directly: after one time constant the gain
    // has covered ~63% of the distance from 1.0 down to the 0.25 floor.
    const param = new FakeAudioParam();
    param.setTargetAtTime(0.25, 0, 0.15);
    const after150ms = param.valueAt(0.15);
    assert.ok(after150ms < 0.54 && after150ms > 0.5, `expected ~0.526, got ${after150ms}`);
    const after450ms = param.valueAt(0.45);
    assert.ok(after450ms < 0.29, `should be nearly at the floor, got ${after450ms}`);
  });
});

describe('hold window (800ms) — the anti-pumping rule', () => {
  it('does NOT un-duck during a short pause mid-sentence', () => {
    const ducker = makeDucker();

    micLevel = 0.2;        // "so anyway, I was thinking…"
    advance(600);
    assert.equal(ducker.speaking, true);

    micLevel = 0.01;       // …a breath, a comma, 400ms of nothing
    advance(400);
    assert.equal(ducker.speaking, true, 'a 400ms pause must not bounce the volume back up');

    micLevel = 0.2;        // "…that we should watch the sequel"
    advance(300);
    assert.equal(ducker.speaking, true);

    ducker.destroy();
  });

  it('survives several short gaps in a row without pumping', () => {
    const ducker = makeDucker();
    const flips = [];
    ducker.onChange(({ speaking }) => flips.push(speaking));

    micLevel = 0.2;
    advance(400);
    for (let i = 0; i < 5; i += 1) {
      micLevel = 0.01;
      advance(300); // gap, well inside the 800ms hold
      micLevel = 0.2;
      advance(400);
    }

    // Exactly one transition: silence → speaking. No oscillation.
    assert.deepEqual(flips, [true], `volume pumped up and down: ${JSON.stringify(flips)}`);
    ducker.destroy();
  });

  it('does release after a real 800ms silence', () => {
    const ducker = makeDucker();

    micLevel = 0.2;
    advance(500);
    assert.equal(ducker.speaking, true);

    micLevel = 0.005;
    advance(700);
    assert.equal(ducker.speaking, true, 'still inside the hold window at 700ms');

    advance(250); // now past 800ms
    assert.equal(ducker.speaking, false, 'should release once the pause is genuinely long');

    ducker.destroy();
  });

  it('restores the movie to full volume after releasing', () => {
    const ducker = makeDucker();
    micLevel = 0.2;
    advance(600);
    micLevel = 0;
    advance(2000);
    assert.equal(ducker.speaking, false);
    assert.equal(gainOf(ducker), 1);
    ducker.destroy();
  });
});

describe('muted microphone', () => {
  it('a muted mic cannot duck the movie', () => {
    const ducker = makeDucker();
    ducker.setVoiceActive('self', false);
    // The gate zeroes the signal before the analyser, so the meter reads 0.
    // Simulate that by keeping the level at silence.
    micLevel = 0;
    advance(1000);
    assert.equal(ducker.speaking, false);
    ducker.destroy();
  });
});

describe('user controls', () => {
  it('disabling ducking releases immediately', () => {
    const ducker = makeDucker();
    micLevel = 0.3;
    advance(400);
    assert.equal(ducker.speaking, true);

    ducker.setEnabled(false);
    assert.equal(gainOf(ducker), 1);
    advance(500);
    assert.equal(ducker.speaking, false, 'disabled means never duck');
    ducker.destroy();
  });

  it('sensitivity and depth are adjustable within sane bounds', () => {
    const ducker = makeDucker();

    ducker.setThreshold(0.02);
    assert.equal(ducker.config.rmsThreshold, 0.02);
    ducker.setThreshold(0);      // rejected
    ducker.setThreshold(5);      // rejected
    assert.equal(ducker.config.rmsThreshold, 0.02);

    ducker.setFloor(0.5);
    assert.equal(ducker.config.duckFloor, 0.5);
    ducker.setFloor(-1);         // rejected
    ducker.setFloor(2);          // rejected
    assert.equal(ducker.config.duckFloor, 0.5);

    ducker.destroy();
  });

  it('a lowered threshold picks up quieter speech', () => {
    const ducker = makeDucker({ rmsThreshold: 0.02 });
    micLevel = 0.03; // below the default 0.06, above this custom 0.02
    advance(300);
    assert.equal(ducker.speaking, true);
    ducker.destroy();
  });
});

describe('remote peers', () => {
  it('a remote peer talking ducks the movie for me too', () => {
    const ducker = createDucker();
    // No local mic at all — only the far end is producing audio.
    ducker.addVoice('peer-42', { getAudioTracks: () => [{}] });
    ducker.attachElement({ volume: 1, currentSrc: 'blob:https://x.test/abc', crossOrigin: null });
    ducker.start();

    micLevel = 0.18;
    advance(300);
    assert.equal(ducker.speaking, true, 'the film must duck when a friend talks, not only when I do');

    ducker.destroy();
  });

  it('removing a voice does not leave it feeding the meter', () => {
    const ducker = makeDucker();
    ducker.addVoice('peer-1', { getAudioTracks: () => [{}] });
    assert.equal(ducker.hasVoices(), true);
    ducker.removeVoice('peer-1');
    ducker.removeVoice('self');
    assert.equal(ducker.hasVoices(), false);
    ducker.destroy();
  });
});

describe('sink selection', () => {
  it('uses the Web Audio graph for same-origin / blob media', () => {
    const ducker = createDucker();
    ducker.addVoice('self', { getAudioTracks: () => [{}] });
    ducker.attachElement({ volume: 1, currentSrc: 'blob:https://x.test/abc', crossOrigin: null });
    assert.equal(ducker.sinkKind, 'graph');
    ducker.destroy();
  });

  it('falls back to element.volume for tainted cross-origin media', () => {
    const ducker = createDucker();
    ducker.addVoice('self', { getAudioTracks: () => [{}] });
    ducker.attachElement({ volume: 1, currentSrc: 'https://other.test/movie.mp4', crossOrigin: null });
    assert.equal(ducker.sinkKind, 'volume');
    ducker.destroy();
  });

  it('supports an external sink for the YouTube iframe', () => {
    const ducker = createDucker();
    ducker.addVoice('self', { getAudioTracks: () => [{}] });
    const applied = [];
    ducker.attachExternal((g) => applied.push(g));
    ducker.start();

    micLevel = 0.25;
    advance(600);
    assert.ok(applied.length > 0, 'the external sink should have been driven');
    assert.ok(applied[applied.length - 1] < 0.4, 'YouTube volume should have been pulled down');
    ducker.destroy();
  });

  it('ramps the volume sink smoothly rather than stepping', () => {
    const ducker = createDucker();
    ducker.addVoice('self', { getAudioTracks: () => [{}] });
    const element = { volume: 1, currentSrc: 'https://other.test/movie.mp4', crossOrigin: null };
    ducker.attachElement(element);
    ducker.start();

    micLevel = 0.25;
    advance(50);
    const first = element.volume;
    // One 50ms step of a τ=0.15 exponential covers 1-e^(-1/3) ≈ 28% of the
    // way from 1.0 to 0.25, i.e. ~0.79 — a smooth slide, not a jump.
    assert.ok(first < 1 && first > 0.75, `first step should be gradual, got ${first}`);

    advance(150);
    const later = element.volume;
    assert.ok(later < first, 'should keep descending');
    assert.ok(later < 0.6, `should be well down after 200ms, got ${later}`);

    advance(1000);
    assert.ok(Math.abs(element.volume - 0.25) < 0.02, `should settle at the floor, got ${element.volume}`);

    ducker.destroy();
  });

  it('respects the viewer\'s own volume as the new 100%', () => {
    const ducker = createDucker();
    ducker.addVoice('self', { getAudioTracks: () => [{}] });
    const element = { volume: 0.5, currentSrc: 'https://other.test/movie.mp4', crossOrigin: null };
    ducker.attachElement(element);
    ducker.start();

    micLevel = 0.25;
    advance(1500);
    // Ducked to 25% *of the user's 50%*, not to an absolute 0.25.
    assert.ok(Math.abs(element.volume - 0.125) < 0.02, `expected ~0.125, got ${element.volume}`);

    ducker.destroy();
  });
});
