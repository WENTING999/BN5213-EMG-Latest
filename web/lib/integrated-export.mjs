import {csv} from './core.mjs';
import {EMG_COLUMNS, GAZE_COLUMNS, EVENT_COLUMNS, zipStore} from './export.mjs';
export const CONTEXT = ['game_phase','attempt_id','set_number','rep_number','condition'];
export const TRIALS = ['id','setNumber','repNumber','targetRoute','selectedRoute','isCorrect','confirmationType','memoryPerfMs','searchPerfMs','gazePerfMs','confirmationPerfMs','emgOnsetPerfMs','emgConfirmedPerfMs','searchTimeMs','selectionReactionMs','gazeToConfirmationMs','repCompletedAt','completionSource','standingVerified','validForTiming','timingExclusion','gazeSource','emgSource','observerStandAt','observerSeatedAt','observerIntervalMs'];
export const PUPIL = ['received_perf_ms','session_ms','source','left_mm','right_mm','left_px','right_px','quality','source_timestamp','source_clock',...CONTEXT];
export function makeFiles(snapshot, game, pupil = []) {
  const trials = (game?.attempts || []).map(a => ({...a,
    selectionReactionMs: a.confirmationPerfMs != null && a.searchPerfMs != null ? a.confirmationPerfMs - a.searchPerfMs : null,
    gazeToConfirmationMs: a.confirmationPerfMs != null && a.gazePerfMs != null ? a.confirmationPerfMs - a.gazePerfMs : null,
    completionSource:a.movement?.source,standingVerified:a.movement?.standingVerified,
    observerStandAt: a.movement?.observerStandAt, observerSeatedAt: a.movement?.observerSeatedAt, observerIntervalMs: a.movement?.observerIntervalMs}));
  const metadata = {...snapshot.metadata, format: 'BN5213_UI_EMG_3', game_session_id: game?.id, game_status: game?.status,
    protocol: game?.protocol, pupil_available: pupil.length > 0, pupil_rows: pupil.length, counts: {...snapshot.metadata.counts, trials: trials.length},
    source_notes: 'UI source snapshot: fixed route-number memory game. No six-level difficulty implementation or pupil model weights were supplied.',
    advancement_limit: 'Task advances automatically after input confirmation. EMG activation does not verify standing posture, completed standing, sitting or standing duration.',
    condition_limit: 'Mouse simulation is an interface demo, not a gaze-only physiological condition. Task accuracy is selection accuracy, not a diagnosis or direct memory measure.'};
  return {
    'metadata.json': JSON.stringify(metadata, null, 2),
    'game_session.json': JSON.stringify(game, null, 2),
    'emg.csv': csv(snapshot.emg, [...EMG_COLUMNS,...CONTEXT]),
    'gaze.csv': csv(snapshot.gaze, [...GAZE_COLUMNS,'source_timestamp','source_clock',...CONTEXT]),
    'pupil.csv': csv(pupil, PUPIL),
    'events.csv': csv(snapshot.events, EVENT_COLUMNS),
    'trials.csv': csv(trials, TRIALS),
    'README.txt': 'Read metadata.json before analysis. All *_perf_ms use this page performance.now() clock; session_ms is relative to recording start. Device clock alignment is estimated, not physically validated.\nSIMULATION/firmware_simulation/mouse_simulation are not human measurements. Blank pupil.csv means no pupil data, not zero diameter. Do not mix mm and pixels.\nEMG is the board envelope in ADC counts, not raw skin microvolts, force or pressure. filtered0 is a denoised envelope; feature0 is detrended envelope RMS; threshold0 is its burst threshold, not an amplitude threshold for filtered0. The burst path also requires rate0 above rate_threshold0. The alternative amplitude path compares filtered0 with amplitude_threshold0. activation_path0 records amplitude, burst or amplitude+burst; both paths must settle before rearming.\nTask progression follows an activation, not verified standing. standingVerified=false; no standing duration or bilateral balance is inferred. Detector thresholds, filters and baseline are saved in metadata.\nExclude trials with validForTiming=false from reaction-time analysis. Aborted and fast-demo sessions must be filtered explicitly. Separate conditions, gaze sources and EMG sources.\n'
  };
}
export function makeZip(snapshot, game, pupil) { return zipStore(makeFiles(snapshot,game,pupil)); }
