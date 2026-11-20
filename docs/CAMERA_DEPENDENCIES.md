# Local camera tracker dependency

The original WebGazer 3.5.3 package uses @tensorflow-models/face-landmarks-detection 1.0.6 with MediaPipe runtime. Its configured solutionPath requires local FaceMesh assets that are not contained in the minified WebGazer JavaScript alone.

This release supplies @mediapipe/face_mesh 0.4.1633559619 from the official npm registry. Package metadata requires the compatible ~0.4.0 release family. The archive integrity is checked against npm SHA-512 metadata. Full provenance and per-file checksums are in OPTIONAL_EYE_TRACKING/mediapipe/face_mesh/ASSET_MANIFEST.json; the license copy is LICENSE-2.0.txt in that directory.

Official sources:

- https://registry.npmjs.org/@mediapipe/face_mesh/0.4.1633559619
- https://registry.npmjs.org/@tensorflow-models/face-landmarks-detection/1.0.6
- https://github.com/brownhci/WebGazer/blob/master/src/facemesh.mjs
- https://www.apache.org/licenses/LICENSE-2.0

These files are static web dependencies. Users do not need to install Python packages, Node.js packages, a new browser, a camera application or an Arduino library to apply this repair. The existing local Python launcher remains sufficient.

The diagnostic route /validation/facemesh-smoke.html uses a blank canvas and the bundled tracker to test WASM/model loading without acquiring camera data. It is separate from the participant interface.
