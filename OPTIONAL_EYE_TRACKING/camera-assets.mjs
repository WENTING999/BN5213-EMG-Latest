export const FACE_MESH_ASSETS = Object.freeze([
  'face_mesh.binarypb', 'face_mesh_solution_packed_assets.data', 'face_mesh_solution_packed_assets_loader.js',
  'face_mesh_solution_simd_wasm_bin.js', 'face_mesh_solution_simd_wasm_bin.wasm', 'face_mesh_solution_simd_wasm_bin.data',
  'face_mesh_solution_wasm_bin.js', 'face_mesh_solution_wasm_bin.wasm'
]);
export const FACE_MESH_BASE = new URL('./mediapipe/face_mesh/', import.meta.url).href;
export async function checkFaceMeshAssets({fetcher=globalThis.fetch,base=FACE_MESH_BASE}={}) {
  for(const name of FACE_MESH_ASSETS) {
    const url=new URL(name,base).href;
    let response;
    try { response=await fetcher(url,{method:'HEAD',cache:'no-store'}); }
    catch(error) { throw new Error(`FaceMesh asset cannot be reached: ${name}. Restart START_HERE.cmd and reload this page. ${error.message}`); }
    if(!response.ok)throw new Error(`FaceMesh asset missing (HTTP ${response.status}): ${name}. Restore the EMG model assets and reload this page. Camera permission is not the cause of this file error.`);
  }
}
export function cameraStartError(error,stage) {
  const detail=error?.message||String(error);
  if(error?.name==='NotAllowedError')return new Error('Camera permission was denied. Allow camera access for this localhost page, then try again.');
  if(error?.name==='NotFoundError')return new Error('No camera device was found. Connect or enable a camera, then try again.');
  if(error?.name==='NotReadableError')return new Error('The camera is unavailable or in use by another application. Close other camera applications and retry.');
  return new Error(`Eye-tracker initialization failed during ${stage}: ${detail}. Reload the page before retrying; an opened video preview alone does not mean gaze tracking is ready.`);
}
export async function stopGazeEngine(engine,documentRoot=globalThis.document) {
  const video=documentRoot?.getElementById(engine?.params?.videoElementId||'webgazerVideoFeed');
  for(const track of video?.srcObject?.getTracks?.()??[])track.stop();
  if(typeof engine?.clearGazeListener==='function')engine.clearGazeListener();
  if(typeof engine?.end==='function'){try{await engine.end();}catch{/* A partially initialized engine may have no preview DOM. */}}
}
