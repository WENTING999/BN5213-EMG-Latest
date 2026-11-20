# Validation - 1.4.0-emg - 2026-11-20

## Scope and decisions

Only EMG project files are updated. EMG rest calibration and gaze calibration retain their pre-session positions. The original game HTML, app.js lifecycle, styles.css, emg.css and Arduino firmware match the prior delivered files byte for byte. No participant diagnostic card or manual observer gate has been added. The unchanged UI engine retains its embedded version; the integration and acquisition metadata identify 1.4.0-emg.

The camera implementation is now optional: OPTIONAL_EYE_TRACKING contains calibration, camera startup and all local WebGazer/FaceMesh dependencies and licenses. The core lazily loads this folder and disables only the camera option when it is absent. The old active copies under web/vendor and web/mediapipe are relocated, with originals preserved in the deployment backup.

## Checks completed

- 54 Node tests pass (NODE_TEST_REPORT_V140.txt). Tests include the actual serial parser/controller path using explicitly labelled fixtures, calibrated hybrid amplitude/burst detection, smooth contractions, brief bursts, quiet waves, isolated spikes, clipping, gaps, held-signal rearm prevention, gaze-onset ordering, pause/abort behavior, automatic game advancement, recording and additive CSV fields.
- Eye tests verify fresh distinct tracked-frame training, zero-width/missing-eye rejection, low-frame-rate validation extension up to four seconds, sample-count versus accuracy diagnostics, and out-of-screen errors. Acceptance limits and the minimum five samples at each of five points are unchanged.
- Syntax checks pass for the integration and optional calibration UI modules. Application strings remain English; operating guides are Chinese.
- The independently read ZIP fixture passes tools/validate_archive.py, including CSV counts, CRC and unverified-standing semantics.
- Browser QA at the staged application verified the existing gaze selector and pre-session camera calibration button remain in their prior position. No camera access was requested.
- The actual WebGazer FaceMesh detector loaded the relocated local JavaScript, WASM, graph and data files and processed a blank canvas. Visible PASS, zero faces; no camera, microphone or personal images used.
- A separate fixture physically omitted OPTIONAL_EYE_TRACKING. Its camera choice was disabled, external gaze remained selectable, software EMG calibrated before Start Session, practice accepted a new activation, and one game selection advanced automatically to 1/2. No browser console errors were recorded. NO_OPTIONAL_EYE_GAME_V140.jpg and .txt record this explicitly simulated check. This is not a human EMG measurement.

## Limits

No physical Arduino, electrodes or user webcam calibration was exercised by the agent. Software checks do not establish physiological accuracy or verify a completed stand. The old screenshot's combined message cannot determine whether the user's actual failure was sample count or accuracy; the new diagnostics make the next attempt distinguishable. No extra software installation is required for the bundled camera assets.

Restart START_HERE.cmd after this update: the Python server now serves the removable module from its own directory. The detailed Chinese guides explain recalibration and optional-module removal/recovery.
