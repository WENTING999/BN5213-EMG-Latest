# Integration contract

Version 1.4.0 improves the EMG-local camera calibration and validation diagnostics and combines amplitude with short-burst activation. Both EMG rest calibration and gaze calibration remain before Start Session. The original game layout, independent eye repository, Arduino firmware and automatic task advancement are unchanged. The static server binds only to 127.0.0.1. No physiological data are uploaded.

## Real serial path

The supplied Uno sketch defaults to `BN_EMG_SIMULATION=0`, one real A0 channel at 200 Hz and 115200 baud. The browser must explicitly request and open a port. USB power alone does not connect the page. Live viewing is independent of Start Session and recording.

`input-status.mjs` separates browser port selection, device boot, protocol recognition, sample receipt, baseline collection, clock synchronization and stale data. Incompatible lines are counted as protocol errors, never converted into simulated or guessed EMG. The live chart provides labelled ADC axes, auto zoom and fixed 0–1023 scale. Zoom affects rendering only.

## Game bridge

`window.CatchYourBus` retains the source UI contract, with pause(reason), resume(), endSession(reason) and complete current-attempt snapshots. `GameBridge` translates inputs; the original UI owns trials and counters. Do not bypass the bridge for production confirmation or counting.

Gaze is locked after a continuous 300 ms dwell. A gap over 150 ms resets the candidate. Historical gaze validity expires 500 ms after its last matching sample. An EMG candidate onset must be at or after the UI gaze lock and match valid historical gaze at onset; future gaze cannot retroactively confirm an earlier activation. Mouse gaze test substitutes only gaze selection; a real serial source remains real EMG.

Gaze-only confirms immediately after locking and keeps EMG confirmation fields blank. The EMG adapter configures advanceOnConfirmation=true: an accepted confirmation schedules a pause-aware 650 ms feedback interval, then completes one task selection. Observer buttons and the warmup 500 ms hold are removed. A new activation onset must still follow selection. A held or earlier activation cannot confirm a later target.

Completion metadata records source=emg_activation (or gaze_confirmation) and standingVerified=false. This counts confirmed selections, not completed physical stands or standing duration. Legacy movement inputs remain available for compatibility, but no measurements are invented.

## Hybrid envelope activation detector

The production controller uses BurstProcessor in burst-processor.mjs. The older EnvelopeProcessor remains in core.mjs for legacy compatibility tests and is not the current controller's detector. ADC samples are never overwritten.

Defaults: a causal three-sample median; 50 Hz biquad notch (Q=15; optional 60 Hz/off); two cascaded exponential low-pass stages with pole frequency 25 Hz; a 180 ms trend estimate; a 120 ms window. The feature is centered RMS of the detrended, denoised envelope, combined with mean absolute adjacent-sample change of that envelope. It is not spectral analysis or RMS of raw skin EMG.

A five-second seated-rest calibration ignores its first second. Each threshold is the resting 95th percentile plus sensitivity times max(3 times robust MAD scale, feature floor). Energy floor=4 ADC counts; rate floor=0.8 ADC counts/sample. The burst path requires both features above their limits. The amplitude path uses the denoised envelope above rest mean + sensitivity times max(3 SD, 10 ADC counts). Either path must provide 30 ms of evidence. Release requires both a quiet amplitude (below mean + sensitivity times max(1.5 SD, 5)) and quiet burst features (energy or rate below its release limit) for 150 ms. The onset refractory period is 1200 ms. A held amplitude cannot rearm merely because its rapid-change features settle. Clipping near either ADC rail and data gaps block confirmations and impose a 200 ms recovery interval. Baseline gaps, insufficient samples and excessive clipping fail calibration.

The displayed envelope and detector feature have separate plots. Raw ADC overlay defaults off; raw data remain in emg.csv. Feature columns and their units are explicitly stored, along with filter settings and baseline statistics. Threshold columns now refer to feature RMS, not envelope amplitude; archives use format BN5213_UI_EMG_3.

The feature choice is an engineering hypothesis for this board envelope. Two screenshots do not validate posture classification or detection accuracy. Cable/electrode motion can resemble a burst. Independent labelled recordings are required before reporting accuracy. Background: [Delsys signal analysis](https://delsys.com/downloads/TECHNICALNOTE/103-emg-signal-analysis.pdf) describes RMS amplitude analysis; [Delsys signal quality](https://delsys.com/support/emgworks/signal-quality-monitor/) describes interference and movement contamination. These sources do not validate this project's filter settings or classifier.

## External gaze

Wait for `bn5213:ready`, select External eye tracker in the UI, and verify tracker calibration and viewport coordinates. Call from a local page adapter:

```js
window.BN5213Inputs.pushGaze({
  source: 'tracker-name-and-version',
  x: prediction.x, y: prediction.y, valid: prediction.valid,
  timestamp: prediction.timestamp, clock: 'tracker_clock_description'
});
```

Coordinates must already be converted to this page's viewport CSS pixels. The app computes AOIs from visible bus elements; a supplied bus ID is not accepted as gaze truth. Alternatively dispatch a same-page `bn5213:gaze` CustomEvent with the sample in detail.

No Python socket, remote service or cross-origin postMessage control is opened automatically. A teammate supplying Python output must provide an authorized local transport and bridge it into this API.

## External pupil input

```js
window.BN5213Inputs.pushPupil({
  source: 'pupil-model-name-and-version',
  left_mm: result.leftDiameterMm, right_mm: result.rightDiameterMm,
  quality: result.quality,
  timestamp: result.frameTimestamp, clock: 'video_monotonic_ms'
});
```

Use left_px/right_px for image pixels; never place pixels in millimetre fields. Missing measurements are null. Diameter fields accept finite positive numbers only. Quality is recorded as supplied and is not a standardized confidence measure. A same-page `bn5213:pupil` event is also supported.

Receipt time uses performance.now(); original timestamps and clock descriptions are stored separately. Receipt time is not image exposure time. Establish and validate a clock transform before combining remote clocks or offline frames. No interpolation, pixel-to-mm conversion, workload inference or automatic difficulty adjustment is performed.

getStatus() returns sources, readiness, recording state and pupil row count. The supplied pupil repository has no checkpoint or usable real-time endpoint; no actual pupil inference is bundled.

## Serial protocol

UTF-8/ASCII newline-delimited records:

```text
I,BN5213,1,200,1,1023,REAL
D,seq,t_us,adc0,adc1_or_-1,missedSlots
P,id,rx_us,tx_us
M,id,receipt_us
```

The page sends I for metadata, P,id for clock estimation, and M,id for command-receipt markers. M echoes are not physical display timestamps. Device micros wrap is unwrapped; a restart invalidates calibration and stops the task. The optional second channel is recorded sequentially and does not infer leg balance.

The legacy EnvelopeProcessor, retained only for compatibility tests, uses 20 ms exponential smoothing and its own threshold/release timing. Production uses the hybrid detector described above. Candidate onset and confirmation time are retained separately. The signal is a sensor envelope in ADC counts, not raw skin microvolts, force or pressure.

## Recording and limits

Eight-file ZIP: metadata.json, game_session.json, emg.csv, gaze.csv, pupil.csv, events.csv, trials.csv and README.txt. A baseline can have negative session_ms. Keep simulated sources, mouse gaze, fast-demo sessions, aborted sessions and timing-excluded trials separate during analysis. Timestamps and serial clock fits are software estimates; monitor, webcam and analogue delays have not been physically calibrated.

Raw samples remain in page memory until export. History contains summaries only. New recording is gated until previous raw data have been exported. The recording cap prevents unlimited growth; it is not persistent storage. Recorder trial rows are derived from the UI session on export.

## Compatibility

The provided source is a fixed route-number memory task with 3 sets of 10 repetitions. This integration adds 4/6/9 choices and gaze-only/gaze+EMG conditions; the six-level adaptive interface mentioned in chat was not supplied. Legacy warmupFootPressConfirmed() and warmup.footPressConfirmedAt remain for compatibility; confirmationType and confirmationSource clarify what actually confirmed practice. The legacy name is not a pressure measurement.

All application text is English. Only the user-guide documents and their HTML generator contain Chinese instructional text. Original user-provided filesystem paths remain unchanged in provenance metadata.

## Calibration readiness and independent validation (1.4.0)

The camera adapter observes successful left/right eye-patch extraction without retaining images or modifying the vendor bundle. A training click counts only on a tracked frame less than one second old and only once per frame. No face means no counted training click. Camera/model startup still uses the pinned local FaceMesh assets.

Independent five-point validation excludes the first 350 ms of each target and requires at least five finite, tracked predictions at each point. Collection normally lasts 1600 ms and extends to at most 4000 ms for low frame rates. Off-screen finite predictions count as accuracy errors instead of disappearing as missing samples. The unchanged acceptance rule is median of the five point-median errors <= min(120 px, 12% of the shorter viewport dimension), with all points sufficiently sampled. Too few samples and excessive error now produce different messages with point counts and measured error. Reports are saved in gaze_validation metadata. A resize cancels calibration and requires a new run.

These changes repair collection and diagnostics; they do not establish accuracy on a real person or guarantee that a specific webcam can pass. Node fixtures contain no face images. Browser QA uses the local model smoke test and explicitly simulated EMG only.

The existing sample CSV columns are retained. amplitude_threshold0/1 and activation_path0/1 are appended. Activation events include activationPath and the amplitude threshold. The format remains BN5213_UI_EMG_3 with additive fields; detector_config.algorithm identifies envelope_hybrid_v2.

## Removable camera implementation

OPTIONAL_EYE_TRACKING contains camera-gaze.mjs, calibration-ui.mjs, gaze-calibration.mjs, camera-assets.mjs, vendor and mediapipe resources. The server maps /OPTIONAL_EYE_TRACKING/ into that directory with a resolved-path boundary check. The EMG host reads /eye-module-status.json before dynamically loading the optional module. No eager import from the EMG core requires that folder.

After stopping/exporting and restarting the server/page, renaming or removing this folder disables only the WebGazer option. Arduino EMG, mouse gaze and the existing external-coordinate interface remain available. The host still retains generic source-selection UI, common input routing and hidden calibration DOM/CSS; none of those load the removed camera implementation. An external teammate implementation must supply viewport coordinates through BN5213Inputs.pushGaze; removing the optional folder does not automatically connect a different tracker. Tests that exercise the optional implementation require the folder to be present.
