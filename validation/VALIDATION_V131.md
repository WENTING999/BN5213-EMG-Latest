# UI restoration and input-mode access - 2026-11-20

Release 1.3.1-emg updates the EMG project only. Burst processing, automatic progression, gaze adapter, pupil input, firmware and source project folders are unchanged.

- Removed confirmationMonitor markup, its runtime insertion/update code and all associated CSS. Warmup/game no longer show Select a bus first, Burst energy, Threshold or Signal state diagnostic cards.
- Restored emg.css to the exact pre-monitor layout saved before 1.3.0. Original styles.css remains unchanged.
- Kept all three existing gaze choices: mouse simulation, WebGazer camera gaze and external tracker input. Moved them above charts. The existing software test section is expanded by default and appears beside the mode-selection area rather than below two plots.
- Chinese guide now explains camera permissions, nine-point training (five clicks each), five-point independent validation, camera versus mouse gaze, and serial versus software EMG sources.
- All 43 existing Node tests pass. No new algorithm tests are needed for removing the presentation-only card. The 1.3.0 detector validation remains applicable.
- Browser QA checks that WebGazer selection reveals Start camera and calibrate, external selection reveals its verification control, and software simulation remains selectable. Warmup and game are checked without the diagnostic card. Actual camera permission, gaze accuracy and physical Arduino input are not exercised.

No camera or physiological data are obtained by this validation. Screenshots use explicitly labelled software simulation. See NODE_TEST_REPORT_V131.txt and the *_V131.jpg interface screenshots.
