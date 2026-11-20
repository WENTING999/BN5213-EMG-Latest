import {EmgController} from './lib/emg-controller.mjs';
import {GazeAdapter} from './lib/gaze.mjs';
import {GameBridge} from './lib/game-bridge.mjs';
import {makeZip} from './lib/integrated-export.mjs';
import {downloadBytes} from './lib/export.mjs';
import {inputStatus, serialErrorMessage} from './lib/input-status.mjs';
import {drawSignal} from './lib/signal-chart.mjs';
import {loadOptionalEye} from './lib/optional-eye.mjs';

const fragment = await fetch('./research-panel.html');
if (!fragment.ok) throw new Error('Research panel could not load. Start with START_HERE.cmd.');
document.body.insertAdjacentHTML('beforeend', await fragment.text());
const $ = id => document.getElementById(id), game = window.CatchYourBus;
const emg = new EmgController(), gaze = new GazeAdapter(), bridge = new GameBridge(game, emg);
game.configure({autoCompleteMovement: false, advanceOnConfirmation: true, mouseInputEnabled: false, inputReady: false, busCount: 4});
const fast = new URLSearchParams(location.search).get('fast') === '1';
$('protocolLabel').textContent = `${fast ? 'FAST DEMO - not for study data' : 'STANDARD SESSION'} · ${game.config.totalSets} sets x ${game.config.repsPerSet} repetitions`;
document.querySelector('.prototype-tag').innerHTML = '<i></i> GAZE + EMG';
let autoBaseline = false, calibrating = false, lastGame = null, pupilRows = [], signalHistory = [], featureHistory = [], externalLast = null;
let saved = true, cameraCalibration = null, eyeAvailable = false, clippedSince = null, lastPupil = null;
let lastReady = false, currentPhase = 'safety', currentAttemptId = '', currentContext = {};
let lastValidGaze = null;
let connecting = false, connectedAt = 0, samplesReceived = 0, baselineError = null, lastProtocolError = '';

function message(text, error = false) { $('emgMessage').textContent = text; $('emgMessage').classList.toggle('error', error); }
function active() { return game.getState().session?.status === 'in_progress'; }
function context(state = game.getState()) {
  return {game_phase: state.paused ? 'paused' : state.phase, attempt_id: state.currentAttempt?.id ?? null, set_number: state.currentAttempt?.setNumber ?? null,
    rep_number: state.currentAttempt?.repNumber ?? null, condition: bridge.condition};
}
function gazeReady() { return bridge.gazeSource === 'mouse_simulation' || lastValidGaze !== null && performance.now() - lastValidGaze < 1000 && (bridge.gazeSource === 'webgazer' && gaze.validated || bridge.gazeSource === 'external' && $('externalValidated').checked); }
function ready() { return emg.ready() && gazeReady() && /^[A-Za-z0-9_-]{1,32}$/.test($('participantId').value) && (emg.source !== 'serial' || $('hardwareVerified').checked); }
function metadata() {
  return {software_version: '1.4.0-emg', participant: $('participantId').value, condition: bridge.condition, gaze_source: bridge.gazeSource,
    gaze_validated: bridge.gazeSource === 'webgazer' ? gaze.validated : bridge.gazeSource === 'external' ? $('externalValidated').checked : false,
    gaze_validation: gaze.validationResult ?? null, emgSource: emg.source, busCount: Number($('gridSelect').value), fast_demo: fast,
    hardware_verification_declared: $('hardwareVerified').checked, advancement:'automatic_after_input_confirmation', standing_verified:false, stimulus_timing: 'Browser DOM update timestamp; physical display onset unmeasured',
    pupil_integration: 'External input only; supplied inference repository has no model checkpoint'};
}
function refresh() {
  const state = game.getState(), running = state.session?.status === 'in_progress', recording = emg.recorder.recording;
  const now = performance.now();
  const health = inputStatus({connecting,connected:emg.connected,info:emg.info,latest:emg.latest,baseline:emg.processors[0]?.baseline,baselineError,now,connectedAt,parseErrors:emg.parseErrors});
  $('connectionHealth').dataset.state = health.code;
  $('connectionTitle').textContent = health.title;
  $('connectionAction').textContent = health.action;
  $('portCheck').textContent = emg.connected ? 'Port: opened' : connecting ? 'Port: waiting for selection' : 'Port: not opened';
  $('firmwareCheck').textContent = emg.info ? `Firmware: BN5213 v${emg.info.version} - ${emg.source === 'serial' ? 'REAL' : 'SIMULATED'}` : 'Firmware: not detected';
  $('samplesCheck').textContent = `Samples: ${samplesReceived}${emg.latest ? ` - latest ${Math.max(0,now-emg.latest.row.received_perf_ms).toFixed(0)} ms ago` : ' received'}`;
  $('baselineCheck').textContent = emg.processors[0]?.baseline ? 'Baseline: ready' : calibrating ? 'Baseline: collecting 5 s' : baselineError ? 'Baseline: failed' : 'Baseline: not ready';
  $('serialDiagnostics').textContent = `Valid samples: ${samplesReceived}. Protocol errors: ${emg.parseErrors}.${lastProtocolError ? ` Last error: ${lastProtocolError}` : ''}`;
  const pendingExport = !saved && emg.recorder.emg.length > 0 && !recording;
  const canStart = ready() && !recording && !pendingExport;
  $('warmupSubtitle').textContent = bridge.condition === 'gaze_only' ? 'Look at the bus to confirm your selection.' : 'Look at the bus, then confirm with a muscle activation.';
  game.configure({inputReady: canStart, busCount: Number($('gridSelect').value), sessionMetadata: metadata()});
  if(pendingExport && state.phase === 'safety') $('safetyHint').textContent = 'Export the previous recording ZIP before starting a new session.';
  lastReady = canStart;
  for (const id of ['participantId','conditionSelect','gridSelect','gazeSelect','externalValidated','hardwareVerified','cameraCalibrate','detectorSensitivity','filterMains']) $(id).disabled = running || recording;
  $('cameraCalibrate').disabled ||= !eyeAvailable;
  if(cameraCalibration?.busy()) { $('cameraCalibrate').disabled=true; $('gazeSelect').disabled=true; }
  $('connectSim').disabled = running || recording || connecting || emg.connected;
  $('connectSerial').disabled = running || recording || connecting || emg.connected || !('serial' in navigator);
  $('disconnectEmg').disabled = !emg.connected;
  $('calibrateEmg').disabled = !emg.latest || running || recording;
  $('simPulse').disabled = !emg.ready() || emg.source !== 'simulation' || state.paused;
  $('benchRecord').disabled = !emg.ready() || running || recording || pendingExport;
  $('benchStop').disabled = !recording || running;
  $('pauseTask').disabled = !running || state.paused;
  $('endTask').disabled = !running;
  $('downloadData').disabled = !emg.recorder.emg.length || recording;
  $('resumeTask').disabled = !ready();
  $('pauseOverlay').hidden = !state.paused;
  $('pauseExplanation').textContent = `Reason: ${state.pauseReason || ''}. Restore the inputs, then resume. A disconnect or device restart requires a new session.`;
  $('barSource').textContent = emg.source === 'simulation' ? 'SOFTWARE SIMULATION - not human EMG' : emg.source === 'firmware_simulation' ? 'FIRMWARE SIMULATION - generated samples' : emg.source === 'serial' ? 'SERIAL · Arduino' : 'EMG DISCONNECTED';
  $('barSource').className = emg.source === 'serial' ? 'source-real' : 'source-sim';
  $('barStatus').textContent = `${recording ? 'RECORDING' : health.title} · ${bridge.condition === 'gaze_only' ? 'Gaze only' : 'Gaze + EMG'} · ${bridge.gazeSource}`;
  $('sourceValue').textContent = `${emg.source} · ${emg.info?.sampleRate || '—'} Hz`;
  $('clockValue').textContent = emg.latest?.sync.ready ? `Clock ready - RTT ${emg.latest.sync.rtt_ms?.toFixed(1) ?? '—'} ms` : 'Clock not ready';
  const counts = emg.recorder;
  $('recordCounts').textContent = `${recording ? 'Recording' : saved ? 'Export requested / not started' : 'Stopped - export ZIP now'} · EMG ${counts.emg.length} rows - Gaze ${counts.gaze.length} rows - Pupil ${pupilRows.length} rows - Events ${counts.events.length} rows`;
  $('pupilStatus').textContent = lastPupil === null ? 'Pupil input: not connected. No pupil diameter or workload is generated.' : `Pupil input: ${pupilRows.length} rows - latest sample ${((performance.now()-lastPupil)/1000).toFixed(1)} s ago`;
  $('monitorSource').textContent = $('barSource').textContent;
  $('monitorValues').textContent = $('featureValue').textContent + ' | ' + $('baselineValue').textContent;
  $('monitorStatus').textContent = health.title + '. ' + health.action;
}
function startRecording(kind) {
  if (!saved && emg.recorder.emg.length && !confirm('The previous raw recording has not been exported. Starting again will replace it in memory. Continue?')) return false;
  emg.startRecording({...metadata(), recording_kind: kind}); pupilRows = []; lastGame = null; saved = false;
  return true;
}
function stopRecording(reason, state) {
  if (state?.session) lastGame = structuredClone(state.session);
  emg.recorder.metadata.stop_reason = reason;
  if (emg.recorder.recording) emg.stopRecording();
  else emg.recorder.metadata.finished_at ??= new Date().toISOString();
  refresh();
}
async function attempt(action) { try { await action(); refresh(); } catch (error) { message(error.message, true); refresh(); } }
async function connect(simulated) {
  if(connecting)return;
  connecting = true; autoBaseline = true; signalHistory = []; featureHistory = []; clippedSince = null;
  baselineError = null; samplesReceived = 0; lastProtocolError = ''; calibrating = false;
  $('signalValue').textContent = 'ADC —'; $('baselineValue').textContent = 'No baseline'; $('baselineProgress').value = 0;
  refresh();
  try {
    await (simulated ? emg.connectSimulation() : emg.connectSerial());
    connectedAt = performance.now();
    message(simulated ? 'SOFTWARE SIMULATION connected. Generated data only.' : 'Serial port opened. Wait for firmware and samples; baseline starts automatically.');
  } catch(error) { throw new Error(serialErrorMessage(error)); }
  finally { connecting = false; }
}
$('connectSim').onclick = () => attempt(() => connect(true));
$('connectSerial').onclick = () => attempt(() => connect(false));
$('disconnectEmg').onclick = () => attempt(async () => { game.endSession('operator_disconnect'); if (emg.recorder.recording) stopRecording('operator_disconnect'); await emg.disconnect(); message('Disconnected. Click Connect Arduino to reconnect.'); });
$('calibrateEmg').onclick = () => attempt(() => emg.calibrate(5000));
$('simPulse').onclick = () => emg.pulse();
$('benchRecord').onclick = () => attempt(() => { if(startRecording('bench_monitor')) message('Recording signal only. Click Stop recording, then Export ZIP.'); });
$('benchStop').onclick = () => stopRecording('operator_stop');
$('downloadData').onclick = () => attempt(() => {
  const score = $('workloadScore').value;
  emg.recorder.metadata.subjective_workload_0_10 = score === '' ? null : Number(score);
  const bytes = makeZip(emg.recorder.snapshot(), lastGame, pupilRows);
  const filename = `${emg.recorder.metadata.participant || 'P001'}_${emg.recorder.metadata.condition}_${emg.recorder.metadata.simulated_emg ? 'SIMULATED' : 'SERIAL'}_${new Date().toISOString().replace(/[:.]/g,'-')}.zip`;
  downloadBytes(bytes,filename); saved = true; message('ZIP download requested. Check browser Downloads and keep the file before leaving this page.');
});
// Route the original dashboard export to the complete synchronized archive.
const oldReport = $('exportReport'), reportButton = oldReport.cloneNode(true);
oldReport.replaceWith(reportButton);
reportButton.textContent = 'Export EMG + task ZIP';
reportButton.onclick = () => {
  $('emgPanel').hidden = false;
  if(!emg.recorder.recording && emg.recorder.emg.length) $('downloadData').click();
  else message('Stop the current recording first. ZIP contains the current raw recording; history contains summaries only.',true);
};
$('openPanel').onclick = $('pauseOpen').onclick = () => { if(active()) game.pause('research_panel_opened'); $('emgPanel').hidden = false; };
$('closePanel').onclick = () => { $('emgPanel').hidden = true; };
$('pauseTask').onclick = () => game.pause('operator_pause');
$('resumeTask').onclick = () => { if(ready()) { bridge.dwell.reset(); game.resume(); } };
$('endTask').onclick = () => game.endSession('operator_end');
$('detectorSensitivity').onchange = $('filterMains').onchange = () => attempt(() => {
  emg.configureDetector({sensitivity:Number($('detectorSensitivity').value),notchHz:Number($('filterMains').value)});
  if(emg.latest)emg.calibrate(5000);
});
$('openSignal').onclick = () => { if(active()) game.pause('signal_view_opened'); $('signalMonitor').hidden = false; refresh(); };
$('closeSignal').onclick = () => { $('signalMonitor').hidden = true; };
for (const id of ['participantId','conditionSelect','gridSelect','hardwareVerified','externalValidated']) $(id).addEventListener('change', () => {
  bridge.condition = $('conditionSelect').value; refresh();
});
$('gazeSelect').onchange = () => attempt(async () => {
  bridge.reset(); bridge.gazeSource = $('gazeSelect').value; gaze.validationResult = null; lastValidGaze = null;
  $('cameraOptions').hidden = bridge.gazeSource !== 'webgazer'; $('externalOptions').hidden = bridge.gazeSource !== 'external';
  if (bridge.gazeSource === 'mouse_simulation') await gaze.useMouse(); else await gaze.stopCamera();
  message(bridge.gazeSource === 'mouse_simulation' ? 'Mouse gaze test selected. Click a bus to lock it. Real EMG still comes from Arduino; M works only with software simulation.' : bridge.gazeSource === 'webgazer' ? 'Click Start camera and calibrate. Complete independent validation before a session.' : 'Connect your tracker using BN5213Inputs.pushGaze and verify its viewport coordinates.');
});

document.addEventListener('click', event => {
  if (bridge.gazeSource !== 'mouse_simulation' || !lastReady && !active()) return;
  const card = event.target.closest('#warmupBus, #busGrid .bus-card');
  if (card) bridge.select(card.id === 'warmupBus' ? 'warmup' : card.dataset.route, 'mouse_simulation');
});
window.addEventListener('keydown', event => {
  if (event.code === 'Escape') { game.pause('escape_key'); return; }
  if (event.code !== 'KeyM' || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.target.isContentEditable) return;
  event.preventDefault(); if(emg.ready() && !game.getState().paused) emg.setHold(true);
});
window.addEventListener('keyup', event => { if(event.code === 'KeyM') emg.setHold(false); });
window.addEventListener('blur', () => { emg.setHold(false); if(active()) game.pause('window_focus_lost'); });
document.addEventListener('visibilitychange', () => { if(document.hidden && active()) game.pause('page_hidden'); });
window.addEventListener('resize', () => {
  if(cameraCalibration?.active()) cameraCalibration.cancel('Viewport changed during calibration. Start camera and calibrate again.');
  if(bridge.gazeSource === 'webgazer') gaze.validated = false;
  if(bridge.gazeSource === 'external') $('externalValidated').checked = false;
  if(active()) game.pause('viewport_changed');
});
window.addEventListener('beforeunload', event => { if(!saved && emg.recorder.emg.length) { event.preventDefault(); event.returnValue = ''; } });

game.subscribe(event => {
  currentPhase = event.state.phase; currentAttemptId = event.state.currentAttempt?.id ?? ''; currentContext = context(event.state);
  if (event.type === 'session_started') {
    try { if(!startRecording('game')) { game.endSession('previous_recording_not_exported'); return; } }
    catch(error) { message(error.message,true); game.endSession('recording_start_failed'); return; }
  }
  emg.mark('ui_' + event.type, {detail:event.detail, ...currentContext}, event.perfMs);
  if (['trial_memory_shown','trial_search_started','new_session_ready','session_paused'].includes(event.type)) bridge.reset();
  if (event.type === 'session_started') $('emgPanel').hidden = true;
  if (event.type === 'warmup_gaze_locked' && bridge.condition === 'gaze_only') $('warmupNote').textContent = 'Gaze-only practice complete.';
  if (event.type === 'session_completed' || event.type === 'session_aborted') stopRecording(event.type, event.state);
  refresh();
});
emg.on('sample', data => {
  samplesReceived++;
  Object.assign(data.row,currentContext);
  signalHistory.push([data.row.received_perf_ms,data.row.adc0,data.row.filtered0,null]);
  featureHistory.push([data.row.received_perf_ms,null,data.row.feature0,data.row.threshold0]);
  if(signalHistory.length > 1600) signalHistory.shift();
  if(featureHistory.length > 1600) featureHistory.shift();
  if(autoBaseline) { autoBaseline = false; emg.calibrate(5000); }
  const result = data.results[0];
  $('baselineProgress').value = emg.processors[0].baseline ? 1 : result.progress;
  $('signalValue').textContent = `ADC ${data.row.adc0} · Denoised ${data.row.filtered0?.toFixed(1)} · ${!result.calibrated ? result.calibrating ? 'CALIBRATING' : 'NO BASELINE' : result.active ? 'ACTIVATION DETECTED' : 'QUIET'}`;
  $('featureValue').textContent = `Amplitude ${result.filtered.toFixed(1)} / ${result.amplitudeThreshold?.toFixed(1)??'--'} · Burst energy ${result.feature.toFixed(1)} / ${result.threshold?.toFixed(1)??'--'} · Waveform change ${result.rate.toFixed(1)} / ${result.rateThreshold?.toFixed(1)??'--'} · Quality: ${result.quality}${result.activationPath ? ' · Path: '+result.activationPath : ''}`;
  $('lossValue').textContent = `Sequence gaps ${data.row.sequence_gaps} - MCU missed ${data.row.missed_slots} - Protocol errors ${emg.parseErrors}`;
  if(result.clipped) { clippedSince ??= performance.now(); if(performance.now()-clippedSince > 500 && active()) game.pause('signal_saturated'); } else clippedSince = null;
});
emg.on('baseline_start', () => { calibrating = true; baselineError = null; $('baselineValue').textContent='Calibrating seated rest';$('baselineProgress').value=0;message('Collecting a 5-second baseline. Keep the measured muscle relaxed. Do not simulate activation.'); });
emg.on('baseline_ready', () => { calibrating = false; $('baselineValue').textContent = `Rest calibrated · Amplitude threshold ${emg.latest?.row.amplitude_threshold0?.toFixed(1) ?? '—'} · Burst threshold ${emg.latest?.row.threshold0?.toFixed(1) ?? '—'}`; message('Rest calibration complete. Check a short muscle activation before starting. Either a clear amplitude increase or a short burst can confirm the selected bus; the task then advances automatically. No 0.5-second hold.'); refresh(); });
emg.on('baseline_failed', event => { calibrating = false; baselineError = event.reason || 'baseline_failed'; $('baselineValue').textContent = 'Baseline failed'; message('Baseline did not pass: ' + (event.reason || 'missing, saturated or discontinuous samples') + '. Keep the muscle relaxed and click Recalibrate baseline.',true); refresh(); });
emg.on('activation', event => bridge.activation(event));
emg.on('release', () => bridge.release());
emg.on('signal_gap', () => { if(active()) game.pause('emg_signal_gap'); });
emg.on('closed', () => { calibrating = false; game.endSession('source_closed'); if(emg.recorder.recording) stopRecording('source_closed'); message('Input disconnected. Export the recording, reconnect and recalibrate.',true); refresh(); });
emg.on('parse_error', event => { lastProtocolError = event.message; });
emg.on('baseline_invalidated', event => { calibrating=false;$('baselineValue').textContent='No baseline';$('baselineProgress').value=0;game.endSession(event.reason); if(emg.recorder.recording) stopRecording(event.reason); message('Device or detector settings changed. Start a new resting baseline.',true); refresh(); });
emg.on('recording_limit', () => { game.endSession('recording_memory_limit'); stopRecording('recording_memory_limit'); message('Recording stopped at the memory limit. Export ZIP now.',true); });
emg.on('error', error => { if(active()) game.pause('input_error'); message(error.message,true); });

function findAOI(x,y) {
  const state = game.getState();
  const nodes = state.phase === 'warmup' ? [$('warmupBus')] : state.phase === 'game' && state.currentAttempt?.findShownAt ? [...document.querySelectorAll('#busGrid .bus-card')] : [];
  const hit = nodes.find(node => { const r=node.getBoundingClientRect(); return x>=r.left && x<=r.right && y>=r.top && y<=r.bottom; });
  return hit ? hit.id === 'warmupBus' ? 'warmup' : hit.dataset.route : null;
}
function consumeGaze(data, raw = {}) {
  if(data.valid) lastValidGaze = data.received;
  cameraCalibration?.consume(data);
  const aoi = data.valid ? findAOI(data.x,data.y) : null;
  const row = emg.recordGaze({source:data.source,x:data.x,y:data.y,valid:data.valid,aoi,webgazerElapsed:data.elapsed,width:innerWidth,height:innerHeight}, data.received);
  Object.assign(row,context(),{source_timestamp:raw.timestamp ?? null,source_clock:raw.clock ?? null});
  if (data.source !== 'mouse_simulation' && !cameraCalibration?.active() && gazeReady()) bridge.gaze(aoi,data.received,data.source);
}
gaze.on('data', consumeGaze);
gaze.startMouse();
function pushGaze(input) {
  if(bridge.gazeSource !== 'external') return false;
  const time = performance.now(), valid = input?.valid === true && Number.isFinite(input.x) && Number.isFinite(input.y) && input.x >= 0 && input.y >= 0 && input.x <= innerWidth && input.y <= innerHeight;
  externalLast = time;
  consumeGaze({source:'external:' + String(input.source || 'unspecified').slice(0,80),x:valid?input.x:null,y:valid?input.y:null,valid,received:time},input);
  return true;
}
function pushPupil(input) {
  if(!input || typeof input.source !== 'string' || !input.source.trim()) return false;
  const number = value => Number.isFinite(value) && value > 0 ? value : null;
  const now = performance.now(), row = {received_perf_ms:now,session_ms:emg.sessionStart == null ? null : now-emg.sessionStart,source:input.source.slice(0,80),
    left_mm:number(input.left_mm),right_mm:number(input.right_mm),left_px:number(input.left_px),right_px:number(input.right_px),quality:Number.isFinite(input.quality)?input.quality:null,
    source_timestamp: input.timestamp ?? null, source_clock:input.clock ?? null,...context()};
  lastPupil = now;
  if(emg.recorder.recording) {
    if(pupilRows.length >= 240000) { game.endSession('pupil_memory_limit'); stopRecording('pupil_memory_limit'); return false; }
    pupilRows.push(row);
  }
  return true;
}
window.BN5213Inputs = Object.freeze({version:'1.4.0',pushGaze,pushPupil,getStatus:()=>({emgSource:emg.source,gazeSource:bridge.gazeSource,ready:ready(),recording:emg.recorder.recording,pupilRows:pupilRows.length})});
window.dispatchEvent(new Event('bn5213:ready'));
window.addEventListener('bn5213:gaze', event => pushGaze(event.detail));
window.addEventListener('bn5213:pupil', event => pushPupil(event.detail));

// The optional camera module is loaded separately; its absence never blocks EMG or mouse gaze.
const eyeModule=await loadOptionalEye();
try {
  if(eyeModule.available){cameraCalibration=eyeModule.module.installCameraCalibration({gaze,$,message,refresh,attempt,onStart:()=>{lastValidGaze=null;}});eyeAvailable=true;}
  else $('cameraResult').textContent=eyeModule.error;
} catch(error){$('cameraResult').textContent='Optional camera setup failed. Mouse and external gaze remain available. '+error.message;}
$('gazeSelect').querySelector('option[value="webgazer"]').disabled=!eyeAvailable;

setInterval(()=>{
  if(active() && !emg.ready()) game.pause('emg_data_stale_or_unsynchronized');
  if(active() && bridge.gazeSource!=='mouse_simulation') {
    const last=lastValidGaze;
    if(last==null || performance.now()-last>1000) game.pause('gaze_data_stale');
  }
  refresh();
  const now=performance.now(),featureOptions={now,label:'Burst energy (ADC RMS)',showRaw:false};
  if(!$('emgPanel').hidden){
    drawSignal($('emgChart'),signalHistory,{now,fullScale:$('chartScale').value==='full',showRaw:$('showRaw').checked,label:'Denoised envelope (ADC counts)'});
    drawSignal($('featureChart'),featureHistory,featureOptions);
  }
  if(!$('signalMonitor').hidden) drawSignal($('largeEmgChart'),featureHistory,featureOptions);
},100);
if(!('serial' in navigator)) message('Web Serial is unavailable. Open this page in desktop Chrome or Edge for real Arduino input.');
refresh();
