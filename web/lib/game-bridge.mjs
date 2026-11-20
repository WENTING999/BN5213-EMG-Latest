import {DwellTracker} from './core.mjs';

// Only translates validated input events. The supplied UI owns trials and counters.
export class GameBridge {
  constructor(game, emg, {now = () => performance.now()} = {}) {
    this.game = game; this.emg = emg; this.now = now;
    this.condition = 'gaze_emg'; this.gazeSource = 'mouse_simulation';
    this.dwell = new DwellTracker(300, 150, 500); this.warmupGazePerfMs = null;
  }
  reset() { this.dwell.reset(); }
  gaze(aoi, time = this.now(), source = this.gazeSource) {
    const state = this.game.getState();
    if (state.paused) return;
    const result = this.dwell.update(aoi, time);
    if (result.newlyLocked) this.select(result.locked, source);
  }
  select(route, source = this.gazeSource) {
    const state = this.game.getState();
    if (state.paused || !this.emg.ready()) return false;
    if (state.phase === 'warmup') {
      const accepted = this.game.inputs.warmupGazeLocked({source});
      if(accepted)this.warmupGazePerfMs=this.now();
      if (accepted && this.condition === 'gaze_only') this.game.inputs.warmupFootPressConfirmed({source: source + ':gaze_only'});
      return accepted;
    }
    const accepted = this.game.inputs.gazeTarget(String(route), {source, dwellMs: source === 'mouse_simulation' ? null : 300});
    if (accepted && this.condition === 'gaze_only') this.game.inputs.emgConfirmed({source, confirmationType: 'gaze_only', onsetPerfMs: this.now()});
    return accepted;
  }
  activation(event) {
    const state = this.game.getState(), attempt = state.currentAttempt;
    if (state.paused || this.condition !== 'gaze_emg' || event.channel !== 0 || !event.synchronized || !this.emg.ready()) return false;
    if (state.phase === 'warmup' && state.warmupStep === 1) {
      if(!Number.isFinite(event.perfMs)||this.warmupGazePerfMs===null||event.perfMs<this.warmupGazePerfMs)return false;
      // The processor has already checked a short multi-sample activation. No 0.5 s hold.
      return this.game.inputs.warmupFootPressConfirmed({source: this.emg.source});
    }
    if (!attempt?.gazePerfMs || attempt.confirmedAt || !Number.isFinite(event.perfMs) || event.perfMs < attempt.gazePerfMs) {
      this.emg.mark('confirmation_rejected', {reason: 'no_gaze_lock_at_emg_onset', onset_perf_ms: event.perfMs});
      return false;
    }
    if (this.gazeSource !== 'mouse_simulation' && this.dwell.at(event.perfMs) !== attempt.selectedRoute) {
      this.emg.mark('confirmation_rejected', {reason: 'gaze_not_fresh_at_emg_onset', onset_perf_ms: event.perfMs});
      return false;
    }
    return this.game.inputs.emgConfirmed({source: this.emg.source, confirmationType: 'emg', onsetPerfMs: event.perfMs, confirmedPerfMs: event.confirmedPerfMs, detector: event.algorithm ?? 'envelope_hybrid_v2'});
  }
  release() {} // Rearming is handled by the processor's quiet interval and refractory period.
}
