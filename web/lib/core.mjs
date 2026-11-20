export class Emitter {
  constructor() { this.listeners = new Map(); }
  on(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
    return () => this.listeners.get(name)?.delete(callback);
  }
  emit(name, value) { for (const fn of this.listeners.get(name) || []) fn(value); }
}

export class LineFramer {
  constructor(maxLength = 256) { this.maxLength = maxLength; this.buffer = ''; this.dropping = false; this.errors = 0; }
  push(text) {
    const lines = [];
    for (const char of text) {
      if (char === '\n') {
        if (!this.dropping && this.buffer.trim()) lines.push(this.buffer.replace(/\r$/, ''));
        this.buffer = ''; this.dropping = false;
      } else if (!this.dropping) {
        this.buffer += char;
        if (this.buffer.length > this.maxLength) { this.errors++; this.buffer = ''; this.dropping = true; }
      }
    }
    return lines;
  }
}

function uint(text, maximum = 0xffffffff) {
  if (!/^\d+$/.test(text)) throw new Error('Invalid unsigned integer');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > maximum) throw new Error('Integer outside protocol range');
  return value;
}

export function parseLine(line) {
  if (line.startsWith('#')) return {type: 'comment', text: line};
  const p = line.split(',');
  if (p[0] === 'I' && p.length === 7 && p[1] === 'BN5213') {
    const info = {type: 'info', version: uint(p[2]), sampleRate: uint(p[3], 2000), channels: uint(p[4], 2), adcMax: uint(p[5], 65535), simulated: p[6] === 'SIM'};
    if (info.version !== 1 || !info.sampleRate || !info.channels || info.adcMax !== 1023 || !['REAL', 'SIM'].includes(p[6])) throw new Error('Unsupported device configuration');
    return info;
  }
  if (p[0] === 'D' && p.length === 6) {
    const adc1 = p[4] === '-1' ? null : uint(p[4], 1023);
    return {type: 'sample', seq: uint(p[1]), rawUs: uint(p[2]), adc: [uint(p[3], 1023), adc1], missed: uint(p[5])};
  }
  if (p[0] === 'P' && p.length === 4) return {type: 'pong', id: uint(p[1]), rxUs: uint(p[2]), txUs: uint(p[3])};
  if (p[0] === 'M' && p.length === 3) return {type: 'marker', id: uint(p[1]), rawUs: uint(p[2])};
  if (p[0] === 'E') return {type: 'device_error', text: p.slice(1).join(',')};
  throw new Error('Unrecognized line; upload firmware/BN5213_EMG/BN5213_EMG.ino');
}

const WRAP = 0x100000000;
export class DeviceTimeline {
  constructor() { this.lastRaw = null; this.lastSeq = null; this.wraps = 0; this.segment = 0; }
  sample(rawUs, seq) {
    let reset = false;
    const wrapped = this.lastRaw !== null && rawUs < this.lastRaw && this.lastRaw - rawUs > WRAP / 2;
    const seqWrapped = this.lastSeq !== null && seq < this.lastSeq && this.lastSeq - seq > WRAP / 2;
    if (this.lastRaw !== null && ((rawUs < this.lastRaw && !wrapped) || (seq < this.lastSeq && !seqWrapped))) {
      this.segment++; this.wraps = 0; reset = true;
    } else if (wrapped) this.wraps++;
    const missing = this.lastSeq === null || reset ? 0 : Math.max(0, (seq - this.lastSeq + WRAP) % WRAP - 1);
    this.lastRaw = rawUs; this.lastSeq = seq;
    return {deviceMs: (rawUs + this.wraps * WRAP) / 1000, segment: this.segment, reset, missing};
  }
  near(rawUs) {
    if (this.lastRaw === null) return null;
    const latest = this.lastRaw + this.wraps * WRAP;
    const candidates = [-1, 0, 1].map(d => rawUs + (this.wraps + d) * WRAP);
    return candidates.reduce((a, b) => Math.abs(a - latest) < Math.abs(b - latest) ? a : b) / 1000;
  }
}

export class ClockMapper {
  constructor() { this.reset(); }
  reset() { this.points = []; this.slope = 1; this.offset = null; this.rtt = null; this.residual = null; this.lastHost = null; }
  add(hostSend, hostReceive, deviceRxMs, deviceTxMs) {
    const rtt = hostReceive - hostSend - (deviceTxMs - deviceRxMs);
    if (![hostSend, hostReceive, deviceRxMs, deviceTxMs, rtt].every(Number.isFinite) || rtt < 0 || rtt > 250 || deviceTxMs < deviceRxMs) return false;
    this.points.push({d: (deviceRxMs + deviceTxMs) / 2, h: (hostSend + hostReceive) / 2, rtt});
    this.points = this.points.slice(-40); this.lastHost = hostReceive;
    const selected = [...this.points].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(3, Math.ceil(this.points.length / 2)));
    const meanD = selected.reduce((s, p) => s + p.d, 0) / selected.length;
    const meanH = selected.reduce((s, p) => s + p.h, 0) / selected.length;
    const span = Math.max(...selected.map(p => p.d)) - Math.min(...selected.map(p => p.d));
    this.slope = 1;
    if (selected.length >= 5 && span >= 20000) {
      const variance = selected.reduce((s, p) => s + (p.d - meanD) ** 2, 0);
      const covariance = selected.reduce((s, p) => s + (p.d - meanD) * (p.h - meanH), 0);
      const candidate = covariance / variance;
      if (candidate >= 0.98 && candidate <= 1.02) this.slope = candidate;
    }
    this.offset = meanH - this.slope * meanD;
    this.rtt = Math.min(...selected.map(p => p.rtt));
    this.residual = Math.sqrt(selected.reduce((s, p) => s + (p.h - (this.slope * p.d + this.offset)) ** 2, 0) / selected.length);
    return true;
  }
  ready(now) { return this.points.length >= 3 && this.rtt <= 100 && now - this.lastHost < 15000; }
  map(deviceMs, now) { return this.ready(now) ? this.slope * deviceMs + this.offset : null; }
  status(now) { return {ready: this.ready(now), method: this.slope === 1 ? 'ping_offset' : 'ping_linear', rtt_ms: this.rtt, residual_ms: this.residual, slope: this.slope, points: this.points.length}; }
}

export class EnvelopeProcessor {
  constructor(options = {}) {
    this.config = {sampleRate: 200, tauMs: 20, onSigma: 3, offSigma: 1.5, minOn: 10, minOff: 5, onHoldMs: 30, offHoldMs: 50, refractoryMs: 300, maxGapMs: 100, ...options};
    this.reset();
  }
  reset() {
    this.filtered = null; this.lastTime = null; this.lastSeq = null; this.calibration = null;
    this.baseline = null; this.threshold = null; this.offThreshold = null; this.active = false;
    this.candidate = null; this.releaseCandidate = null; this.lastOnset = -Infinity; this.referencePeak = null;
  }
  beginBaseline(durationMs = 5000) {
    if (!Number.isFinite(durationMs) || durationMs < 1500) throw new Error('Baseline must be at least 1500 ms');
    this.baseline = null; this.threshold = null; this.offThreshold = null; this.referencePeak = null;
    this.active = false; this.candidate = null; this.releaseCandidate = null; this.lastOnset = -Infinity;
    this.calibration = {start: null, duration: durationMs, settle: 500, n: 0, mean: 0, m2: 0, gaps: 0};
  }
  setReferencePeak(adc) {
    if (!this.baseline || !Number.isFinite(adc) || adc <= this.baseline.mean + this.config.minOn || adc > 1023) throw new Error('Invalid reference peak');
    this.referencePeak = adc;
  }
  update(adc, timeMs, seq = null) {
    if (!Number.isFinite(adc) || adc < 0 || adc > 1023 || !Number.isFinite(timeMs)) throw new Error('Invalid EMG sample');
    const events = [];
    const dt = this.lastTime === null ? 1000 / this.config.sampleRate : timeMs - this.lastTime;
    if (dt < 0) throw new Error('EMG time moved backwards; reset the processor');
    const gap = this.lastTime !== null && dt > this.config.maxGapMs;
    if (gap) {
      this.candidate = null; this.releaseCandidate = null; this.active = false;
      if (this.calibration) this.calibration.gaps++;
      events.push({type: 'signal_gap', timeMs, gapMs: dt});
    }
    this.filtered = this.filtered === null || gap ? adc : this.filtered + (1 - Math.exp(-dt / this.config.tauMs)) * (adc - this.filtered);
    this.lastTime = timeMs; this.lastSeq = seq;
    if (this.calibration) {
      const c = this.calibration;
      if (c.start === null) c.start = timeMs;
      const elapsed = timeMs - c.start;
      if (elapsed >= c.settle) { c.n++; const delta = this.filtered - c.mean; c.mean += delta / c.n; c.m2 += delta * (this.filtered - c.mean); }
      if (elapsed >= c.duration) {
        const sd = c.n > 1 ? Math.sqrt(Math.max(0, c.m2 / (c.n - 1))) : 0;
        const required = this.config.sampleRate * (c.duration - c.settle) / 1000 * 0.7;
        const on = c.mean + Math.max(this.config.onSigma * sd, this.config.minOn);
        if (c.n < required || c.gaps || on >= 1020) {
          events.push({type: 'baseline_failed', timeMs, reason: on >= 1020 ? 'saturated_baseline' : 'insufficient_continuous_samples'});
        } else {
          this.baseline = {mean: c.mean, sd, n: c.n, durationMs: elapsed}; this.threshold = on;
          this.offThreshold = c.mean + Math.max(this.config.offSigma * sd, this.config.minOff);
          events.push({type: 'baseline_ready', timeMs, baseline: {...this.baseline}, threshold: this.threshold, offThreshold: this.offThreshold});
        }
        this.calibration = null;
      }
    } else if (this.baseline) {
      if (!this.active) {
        this.releaseCandidate = null;
        if (this.filtered > this.threshold && timeMs - this.lastOnset >= this.config.refractoryMs) {
          if (!this.candidate) this.candidate = {timeMs, seq};
          if (timeMs - this.candidate.timeMs >= this.config.onHoldMs) {
            this.active = true; this.lastOnset = this.candidate.timeMs;
            events.push({type: 'activation', onsetMs: this.candidate.timeMs, confirmedMs: timeMs, onsetSeq: this.candidate.seq});
            this.candidate = null;
          }
        } else this.candidate = null;
      } else if (this.filtered < this.offThreshold) {
        if (this.releaseCandidate === null) this.releaseCandidate = timeMs;
        if (timeMs - this.releaseCandidate >= this.config.offHoldMs) {
          this.active = false; events.push({type: 'release', onsetMs: this.releaseCandidate, confirmedMs: timeMs}); this.releaseCandidate = null;
        }
      } else this.releaseCandidate = null;
    }
    const progress = this.calibration && this.calibration.start !== null ? Math.min(1, (timeMs - this.calibration.start) / this.calibration.duration) : 0;
    const relative = this.baseline && this.referencePeak ? (this.filtered - this.baseline.mean) / (this.referencePeak - this.baseline.mean) * 100 : null;
    return {adc, filtered: this.filtered, threshold: this.threshold, active: this.active, calibrated: !!this.baseline, calibrating: !!this.calibration, progress, relativePercent: relative, clipped: adc >= 1020, events};
  }
}

export class DwellTracker {
  constructor(dwellMs = 300, maxGapMs = 150, lockExpiryMs = 500) { this.dwellMs = dwellMs; this.maxGapMs = maxGapMs; this.lockExpiryMs = lockExpiryMs; this.reset(); }
  reset() { this.candidate = null; this.start = null; this.lastTime = null; this.locked = null; this.lastInside = null; this.history = []; }
  update(id, timeMs) {
    const gap = this.lastTime !== null && timeMs - this.lastTime > this.maxGapMs;
    this.lastTime = timeMs;
    if (gap || id === null || id !== this.candidate) { this.candidate = id; this.start = id === null ? null : timeMs; }
    // Expire BEFORE accepting a newly arrived prediction. A stopped camera
    // must not keep an old selection alive indefinitely.
    if (this.locked !== null && timeMs > this.lastInside + this.lockExpiryMs) this.setLock(null, this.lastInside + this.lockExpiryMs);
    if (id !== null && id === this.locked) {
      this.lastInside = timeMs;
      this.history.at(-1).validUntil = timeMs + this.lockExpiryMs;
    }
    let newlyLocked = false;
    if (id !== null && timeMs - this.start >= this.dwellMs && this.locked !== id) { this.lastInside = timeMs; this.setLock(id, timeMs); newlyLocked = true; }
    return {locked: this.locked, candidate: id, progress: id === null ? 0 : Math.min(1, (timeMs - this.start) / this.dwellMs), newlyLocked};
  }
  setLock(id, timeMs) { this.locked = id; this.history.push({id, timeMs, validUntil: id === null ? Infinity : this.lastInside + this.lockExpiryMs}); this.history = this.history.slice(-200); }
  at(timeMs) { const entry = [...this.history].reverse().find(p => p.timeMs <= timeMs); return entry && timeMs <= entry.validUntil ? entry.id : null; }
}

export function csv(rows, columns) {
  const escape = value => {
    if (value === null || value === undefined) return '';
    let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (typeof value === 'string' && /^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '\uFEFF' + [columns.join(','), ...rows.map(row => columns.map(c => escape(row[c])).join(','))].join('\r\n');
}

export class Recorder extends Emitter {
  constructor(limit = 240000) { super(); this.limit = limit; this.recording = false; this.reset(); }
  reset(metadata = {}) { this.metadata = {format: 'BN5213_EMG_1', ...metadata}; this.emg = []; this.gaze = []; this.events = []; this.trials = []; }
  start(metadata) { if (this.recording) throw new Error('Already recording'); this.reset(metadata); this.recording = true; }
  stop() { this.recording = false; }
  push(type, row) {
    if (!this.recording) return;
    if (this.emg.length >= this.limit || this.gaze.length >= this.limit || this.events.length >= 30000) { this.recording = false; this.emit('limit', {reason: 'recording_memory_limit'}); return; }
    this[type].push(row);
  }
  snapshot() { return {metadata: {...this.metadata, counts: {emg: this.emg.length, gaze: this.gaze.length, events: this.events.length, trials: this.trials.length}}, emg: this.emg, gaze: this.gaze, events: this.events, trials: this.trials}; }
}
