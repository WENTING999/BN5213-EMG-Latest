import {Emitter, DeviceTimeline, ClockMapper, Recorder} from './core.mjs';
import {BurstProcessor} from './burst-processor.mjs';
import {SimulationTransport, SerialTransport} from './transports.mjs';
import {sessionFiles, zipStore, downloadBytes} from './export.mjs';

export class EmgController extends Emitter {
  constructor({now = () => performance.now(), seed = 5213} = {}) {
    super(); this.now = now; this.seed = seed; this.transport = null; this.detectorOptions = {}; this.processors = [new BurstProcessor()];
    this.timeline = new DeviceTimeline(); this.mapper = new ClockMapper(); this.recorder = new Recorder();
    this.info = null; this.source = 'disconnected'; this.latest = null; this.eventId = 0; this.calibrationId = 0; this.connected = false; this.baselineSamples = [];
    this.pendingPings = new Map(); this.parseErrors = 0; this.sequenceGaps = 0;
    this.recorder.on('limit', event => { this.mark('recording_limit', event); this.emit('recording_limit', event); });
  }
  async connectSimulation() { return this.connect(new SimulationTransport({now: this.now, seed: this.seed})); }
  async connectSerial() { return this.connect(new SerialTransport()); }
  async connect(transport) {
    if (this.recorder.recording) throw new Error('Stop and export the current recording before changing the input source.');
    await this.disconnect(); this.timeline = new DeviceTimeline(); this.mapper.reset(); this.pendingPings.clear();
    this.processors = [new BurstProcessor(this.detectorOptions)]; this.info = null; this.latest = null; this.baselineSamples = []; this.sequenceGaps = 0; this.parseErrors = 0; this.source = transport.kind; this.transport = transport;
    transport.on('message', message => { try { this.handleMessage(message); } catch (error) { this.emit('error', error); } });
    transport.on('parse_error', event => { this.parseErrors++; this.emit('parse_error', event); });
    transport.on('error', error => this.emit('error', error));
    transport.on('closed', event => { this.connected = false; clearInterval(this.pingTimer); this.mark('source_closed', event); this.emit('closed', event); });
    try { await transport.start(); }
    catch (error) { await transport.stop().catch(() => {}); this.transport = null; this.source = 'disconnected'; throw error; }
    if (transport.kind === 'serial') this.pingTimer = setInterval(() => this.ping(), 700);
    this.connected = true; this.emit('connected', {source: this.source});
  }
  async disconnect() {
    clearInterval(this.pingTimer);
    const old = this.transport; this.transport = null;
    if (old) await old.stop();
    this.source = 'disconnected'; this.connected = false; this.emit('disconnected', {});
  }
  handleMessage(message) {
    const received = this.now();
    if (message.type === 'info') {
      const changed = !this.info || this.info.channels !== message.channels || this.info.sampleRate !== message.sampleRate || this.info.simulated !== message.simulated;
      if (this.info && changed) {
        this.baselineSamples = []; this.latest = null;
        this.mark('device_configuration_changed', {previous: this.info, next: message});
        this.emit('baseline_invalidated', {reason: 'device_configuration_changed'});
      }
      this.info = message;
      this.source = this.transport.kind === 'simulation' ? 'simulation' : message.simulated ? 'firmware_simulation' : 'serial';
      if (changed) this.processors = Array.from({length: message.channels}, () => new BurstProcessor({...this.detectorOptions,sampleRate: message.sampleRate}));
      this.mark('device_info', message); this.emit('info', message); return;
    }
    if (message.type === 'pong') {
      const pending = this.pendingPings.get(message.id); this.pendingPings.delete(message.id);
      const rx = this.timeline.near(message.rxUs), tx = this.timeline.near(message.txUs);
      if (pending !== undefined && rx !== null && tx !== null) this.mapper.add(pending, received, rx, tx);
      return;
    }
    if (message.type === 'marker') { this.mark('device_marker_echo', {marker_id: message.id, device_raw_us: message.rawUs, device_ms: this.timeline.near(message.rawUs)}, received, false); return; }
    if (message.type === 'device_error') { this.mark('device_error', {message: message.text}); return; }
    if (message.type !== 'sample' || !this.info) return;
    const clock = this.timeline.sample(message.rawUs, message.seq);
    if (clock.reset) {
      this.mapper.reset(); this.processors.forEach(p => p.reset()); this.pendingPings.clear(); this.baselineSamples = [];
      this.mark('device_reset', {segment: clock.segment}); this.emit('baseline_invalidated', {reason: 'device_reset'});
    }
    this.sequenceGaps += clock.missing;
    const results = this.processors.map((processor, index) => {
      const adc = message.adc[index];
      if (adc === null || adc === undefined) throw new Error('Device channel count does not match samples');
      return processor.update(adc, clock.deviceMs, message.seq);
    });
    const simulated = this.transport.kind === 'simulation';
    const aligned = simulated ? this.transport.startPerf + clock.deviceMs : this.mapper.map(clock.deviceMs, received);
    const status = simulated ? {ready: true, method: 'simulation_shared_clock', rtt_ms: 0, residual_ms: 0} : this.mapper.status(received);
    const plausible = aligned !== null && aligned <= received + 30 && received - aligned < 1000;
    const row = {
      seq: message.seq, segment: clock.segment, device_t_us: message.rawUs, device_t_ms: clock.deviceMs,
      received_perf_ms: received, aligned_perf_ms: plausible ? aligned : null, session_ms: plausible && this.sessionStart !== undefined ? aligned - this.sessionStart : null,
      adc0: message.adc[0], filtered0: results[0].filtered, threshold0: results[0].threshold, active0: Number(results[0].active),
      feature0: results[0].feature, rate0: results[0].rate, rate_threshold0: results[0].rateThreshold, quality0: results[0].quality,
      amplitude_threshold0: results[0].amplitudeThreshold, activation_path0: results[0].activationPath,
      adc1: message.adc[1], filtered1: results[1]?.filtered ?? null, threshold1: results[1]?.threshold ?? null, active1: results[1] ? Number(results[1].active) : null,
      feature1: results[1]?.feature ?? null, rate1: results[1]?.rate ?? null, rate_threshold1: results[1]?.rateThreshold ?? null, quality1: results[1]?.quality ?? null,
      amplitude_threshold1: results[1]?.amplitudeThreshold ?? null, activation_path1: results[1]?.activationPath ?? null,
      missed_slots: message.missed, sequence_gaps: this.sequenceGaps, source: this.source,
      sync_method: plausible ? status.method : 'unavailable', sync_rtt_ms: status.rtt_ms, sync_fit_residual_ms: status.residual_ms, calibration_id: this.calibrationId,
      phase: results.some(r => r.calibrating) ? 'baseline' : this.recorder.recording ? 'recording' : 'monitor'
    };
    if (row.phase === 'baseline' || results.some(r => r.events.some(e => e.type === 'baseline_ready'))) this.baselineSamples.push({...row, phase: 'baseline'});
    this.recorder.push('emg', row); this.latest = {row, results, sync: {...status, ready: plausible}};
    this.emit('sample', this.latest);
    results.forEach((result, channel) => {
      for (const event of result.events) {
        const deviceEventTime = event.onsetMs ?? event.timeMs ?? clock.deviceMs;
        const eventPerf = simulated ? this.transport.startPerf + deviceEventTime : this.mapper.map(deviceEventTime, received);
        const payload = {...event, channel, source: this.source, deviceMs: deviceEventTime, perfMs: eventPerf, confirmedPerfMs: aligned, synchronized: plausible && eventPerf !== null};
        this.mark('emg_' + event.type, payload, eventPerf ?? received, false);
        this.emit(event.type, payload);
      }
    });
  }
  ping() {
    if (this.transport?.kind !== 'serial' || !this.info) return;
    const id = ++this.eventId, sent = this.now(); this.pendingPings.set(id, sent);
    for (const [key, time] of this.pendingPings) if (sent - time > 3000) this.pendingPings.delete(key);
    this.transport.send('P,' + id).catch(error => this.emit('error', error));
  }
  calibrate(durationMs = 5000) {
    if (!this.info || !this.latest) throw new Error('Connect an input source and wait for valid samples first.');
    this.calibrationId++; this.baselineSamples = [];
    this.processors.forEach(p => p.beginBaseline(durationMs)); this.mark('baseline_start', {duration_ms: durationMs, calibration_id: this.calibrationId});
    this.emit('baseline_start', {durationMs});
  }
  configureDetector(options) {
    if(this.recorder.recording)throw new Error('Stop and export the recording before changing detector settings.');
    const next={...this.detectorOptions,...options};new BurstProcessor(next);this.detectorOptions=next;
    this.processors=Array.from({length:this.info?.channels??1},()=>new BurstProcessor({...next,sampleRate:this.info?.sampleRate??200}));
    this.baselineSamples=[];this.emit('baseline_invalidated',{reason:'detector_settings_changed'});
  }
  setHold(value) { if (this.transport?.kind === 'simulation') this.transport.setHold(value); }
  pulse() { if (this.transport?.kind === 'simulation') this.transport.pulse(); }
  ready() { return this.connected && !!this.latest?.sync.ready && this.now() - this.latest.row.received_perf_ms < 1000 && this.processors.every(p => !!p.baseline); }
  startRecording({participant = 'P001', ...metadata} = {}) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(participant)) throw new Error('Participant ID must contain 1-32 letters, digits, underscores or hyphens.');
    if (!this.ready()) throw new Error('Connect the input, complete a resting baseline, and wait for clock synchronization.');
    this.sessionStart = this.now();
    this.recorder.start({participant, software_version: '1.4.0-emg', started_at: new Date().toISOString(), browser_time_origin: performance.timeOrigin,
      emg_source: this.source, simulated_emg: this.source !== 'serial', device: this.info, detector_config: this.processors[0].config,
      baseline: this.processors.map(p => p.baseline), units: {adc: 'ADC counts of sensor envelope; filtered columns retain envelope units', amplitude_threshold: 'ADC counts of denoised envelope; amplitude path compares filtered columns with amplitude_threshold columns', activation_path: 'amplitude, burst, amplitude+burst, or blank when inactive', feature: 'RMS of detrended, denoised envelope in ADC counts; threshold columns use feature units', rate: 'Mean absolute sample difference of denoised envelope, ADC counts/sample', device_time: 'microseconds / milliseconds', browser_time: 'performance.now milliseconds', gaze: 'viewport CSS pixels'},
      timing_limit: 'Estimated serial clock mapping; monitor, webcam and analogue delays have not been physically measured.',
      measurement_limit: 'One EMG channel cannot verify completed standing, true standing duration, memory content, EEG, or left/right balance.', ...metadata});
    for (const sample of this.baselineSamples) this.recorder.push('emg', {...sample, session_ms: sample.aligned_perf_ms === null ? null : sample.aligned_perf_ms - this.sessionStart});
    this.mark('recording_start', {source: this.source, included_baseline_samples: this.baselineSamples.length}); this.emit('recording_start', {});
  }
  stopRecording() {
    this.mark('recording_stop', {}); this.recorder.metadata.finished_at = new Date().toISOString();
    this.recorder.metadata.final_baseline = this.processors.map(p => p.baseline);
    this.recorder.metadata.parser_errors = this.parseErrors; this.recorder.stop(); this.emit('recording_stop', {});
  }
  mark(type, details = {}, perfMs = this.now(), sendToDevice = true) {
    const event = {id: ++this.eventId, type, perf_ms: perfMs, session_ms: this.sessionStart === undefined ? null : perfMs - this.sessionStart, source: this.source, details};
    this.recorder.push('events', event); this.emit('event', event);
    if (sendToDevice && this.transport?.kind === 'serial' && this.info) this.transport.send('M,' + event.id).catch(error => this.emit('error', error));
    return event;
  }
  recordGaze({source, x = null, y = null, valid = false, aoi = null, webgazerElapsed = null, width, height}, perfMs = this.now()) {
    const row = {received_perf_ms: perfMs, session_ms: this.sessionStart === undefined ? null : perfMs - this.sessionStart, source, x, y, valid, aoi,
      webgazer_elapsed_ms: webgazerElapsed, viewport_width: width, viewport_height: height};
    this.recorder.push('gaze', row); return row;
  }
  exportZip() {
    const snapshot = this.recorder.snapshot();
    if (!snapshot.emg.length && !snapshot.events.length) throw new Error('No recording is available. Record a signal or complete a session first.');
    const suffix = snapshot.metadata.simulated_emg ? '_SIMULATED' : '_SERIAL';
    downloadBytes(zipStore(sessionFiles(snapshot)), `${snapshot.metadata.participant || 'session'}_${new Date().toISOString().replace(/[:.]/g, '-')}${suffix}.zip`);
  }
}
