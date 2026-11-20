# Camera asset repair - 2026-11-20

Release 1.3.2-emg repairs the missing local MediaPipe dependency within EMG only. The user reported HTTP 404 for /mediapipe/face_mesh/face_mesh_solution_simd_wasm_bin.js while a camera preview was already visible. This is a missing tracker-runtime resource, not evidence that a new camera application must be installed.

## Dependency and safeguards

- Added the official npm @mediapipe/face_mesh version 0.4.1633559619, compatible with the bundled @tensorflow-models/face-landmarks-detection 1.0.6 peer requirement ~0.4.0.
- Verified npm SHA-512 archive integrity, recorded per-file SHA-256 and byte sizes, and bundled the Apache 2.0 license. Runtime files and model assets are served from the local EMG web directory. The original WebGazer bundle is unchanged.
- Added asset HEAD checks before camera acquisition, an explicit solutionPath, precise permission/device/runtime error messages, and stream cleanup on initialization failure or stop.
- Added explicit WASM, data and binary-graph MIME types. No package installer, executable installer, global environment change or remote camera service is required.

## Verification

- All 46 Node tests pass. Three new tests check missing-resource diagnostics, camera error classification and track cleanup, npm file checksums and WASM magic bytes.
- In a separate browser page, the actual bundled WebGazer tracker initialized with the local assets and processed a blank 128x128 canvas successfully. Visible result: PASS, detected faces=0. No camera permission, real video, microphone or personal image was requested by this test.
- This verifies the resource-loading failure reported by the user. It does not measure the user's camera, face tracking quality or calibration accuracy.
- Game layout, EMG burst processor, firmware and the independent UI/pupil repositories remain unchanged. No diagnostic card is added to game or warmup.

## User restart

Close the failed old page, stop its old START_HERE command window with Ctrl+C, run START_HERE.cmd again, then select WebGazer camera gaze and start calibration. Reloading is necessary because the failed runtime may remain cached in the old page.
