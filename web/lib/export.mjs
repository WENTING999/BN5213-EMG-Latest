import {csv} from './core.mjs';

const encoder = new TextEncoder();
const crcTable = Array.from({length: 256}, (_, i) => {
  let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function header(length) { const bytes = new Uint8Array(length); return {bytes, view: new DataView(bytes.buffer)}; }
export function zipStore(files) {
  const chunks = [], central = []; let offset = 0, centralSize = 0;
  for (const [name, content] of Object.entries(files)) {
    const fileName = encoder.encode(name), data = typeof content === 'string' ? encoder.encode(content) : content, crc = crc32(data);
    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(12, 33, true); // Valid DOS date, 1980-01-01.
    local.view.setUint32(14, crc, true); local.view.setUint32(18, data.length, true); local.view.setUint32(22, data.length, true); local.view.setUint16(26, fileName.length, true);
    chunks.push(local.bytes, fileName, data);
    const entry = header(46);
    entry.view.setUint32(0, 0x02014b50, true); entry.view.setUint16(4, 20, true); entry.view.setUint16(6, 20, true); entry.view.setUint16(8, 0x0800, true);
    entry.view.setUint16(14, 33, true);
    entry.view.setUint32(16, crc, true); entry.view.setUint32(20, data.length, true); entry.view.setUint32(24, data.length, true); entry.view.setUint16(28, fileName.length, true); entry.view.setUint32(42, offset, true);
    central.push(entry.bytes, fileName); centralSize += 46 + fileName.length; offset += 30 + fileName.length + data.length;
  }
  const end = header(22), count = Object.keys(files).length;
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, count, true); end.view.setUint16(10, count, true); end.view.setUint32(12, centralSize, true); end.view.setUint32(16, offset, true);
  const parts = [...chunks, ...central, end.bytes], result = new Uint8Array(offset + centralSize + 22); let position = 0;
  for (const part of parts) { result.set(part, position); position += part.length; }
  return result;
}

export const EMG_COLUMNS = ['seq', 'segment', 'device_t_us', 'device_t_ms', 'received_perf_ms', 'aligned_perf_ms', 'session_ms', 'phase', 'adc0', 'filtered0', 'feature0', 'threshold0', 'rate0', 'rate_threshold0', 'quality0', 'active0', 'adc1', 'filtered1', 'feature1', 'threshold1', 'rate1', 'rate_threshold1', 'quality1', 'active1', 'missed_slots', 'sequence_gaps', 'source', 'sync_method', 'sync_rtt_ms', 'sync_fit_residual_ms', 'calibration_id', 'amplitude_threshold0', 'activation_path0', 'amplitude_threshold1', 'activation_path1'];
export const GAZE_COLUMNS = ['received_perf_ms', 'session_ms', 'source', 'x', 'y', 'valid', 'aoi', 'webgazer_elapsed_ms', 'viewport_width', 'viewport_height'];
export const EVENT_COLUMNS = ['id', 'type', 'perf_ms', 'session_ms', 'source', 'details'];
export const TRIAL_COLUMNS = ['trial_id', 'round', 'mode', 'targets', 'buses', 'stimulus_perf_ms', 'lock_perf_ms', 'selected_bus', 'emg_onset_perf_ms', 'emg_confirmed_perf_ms', 'reaction_ms', 'gaze_to_emg_ms', 'outcome', 'score_delta', 'valid_for_timing', 'timing_exclusion', 'observer_stand_perf_ms', 'observer_seated_perf_ms', 'observer_interval_ms', 'emg_source', 'gaze_source'];

export function sessionFiles(snapshot) {
  return {
    'metadata.json': JSON.stringify(snapshot.metadata, null, 2),
    'emg.csv': csv(snapshot.emg, EMG_COLUMNS),
    'gaze.csv': csv(snapshot.gaze, GAZE_COLUMNS),
    'events.csv': csv(snapshot.events, EVENT_COLUMNS),
    'trials.csv': csv(snapshot.trials, TRIAL_COLUMNS),
    'README.txt': 'BN5213 recording. Inspect metadata.json first. SIMULATION, firmware_simulation and mouse rows are not physiological observations.\nEMG is a rectified/smoothed sensor envelope in ADC counts, not skin microvolts or force.\nSerial alignment is estimated using ping round trips; physical monitor/camera/analogue delays were not measured.\nObserver confirmation times are manual markers and do not validate actual standing duration or leg balance.\n'
  };
}

export function downloadBytes(bytes, name, type = 'application/zip') {
  const url = URL.createObjectURL(new Blob([bytes], {type}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
