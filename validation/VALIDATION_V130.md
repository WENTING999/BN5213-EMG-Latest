# EMG burst update validation - 2026-11-20

Release 1.3.0-emg. Scope is the EMG project only. The source UI and pupil repositories, gaze.mjs and Arduino firmware are unchanged. Runtime labels and code are English; the user guide is Chinese.

## Automated checks

43 Node tests pass with zero failures. Tests cover the current BurstProcessor plus legacy parsing, clock mapping, rollover, acquisition, gaze history, recording and UI contracts. Added cases exercise slowly varying seated-style envelopes with 50 Hz ripple, a 220 ms oscillatory burst, isolated spikes, clipping, repeated-trigger protection, denoised amplitude, calibration failure, and feature-gap reset. These are generated fixtures and are not measurements of the user's sitting or standing.

An actual-app flow test feeds generated ADC values through BurstProcessor and GameBridge, passes warmup using a burst under 0.5 seconds, and verifies one automatic task completion with source=emg_activation and standingVerified=false. Another test checks that the 650 ms progression timer freezes on pause and cannot complete an aborted task.

The existing REAL serial-path test injects generated protocol bytes through SerialTransport, clock alignment, the production controller and recorder. This checks software plumbing only. No physical serial port, camera or body-connected device was opened.

BURST_SCHEMA_SIMULATED_FIXTURE.zip is explicitly synthetic. Python's independent ZIP/CSV validator checks CRC, counts, raw ADC, feature fields, timestamp order and unverified-standing semantics. Legacy archives remain compatible with the validator's version gate.

## Browser checks

A separate local browser tab used explicitly labelled SOFTWARE SIMULATION with mouse gaze. A 200 ms key activation passed warmup. Two selected buses were confirmed and task counts advanced automatically without observer controls. Source labels stayed simulated. A game export was requested through the UI. No download-wait hook or physical acquisition was used.

The new card places energy, threshold and signal state above the warmup bus and in the game heading. Denoised envelope and burst energy have separate axes; raw overlay defaults off. The Chinese guide and settings controls are checked separately. Screenshots in this folder are interface examples with generated input, not evidence of human EMG classification accuracy.

## Limits

No labelled raw recording accompanied the user's screenshots, so no real detection accuracy, sensitivity/specificity or subject-specific optimal threshold is reported. Motion/electrode artifacts can still produce accepted bursts. The application detects envelope activation; it does not verify posture or completed standing. It deliberately records standingVerified=false and does not invent standing times or bilateral measurements.

Filter and feature settings are engineering defaults. Rest calibration and independent checks with real recordings are necessary. Firmware protocol and sampling remain unchanged, so no Arduino upload is required for this update.
