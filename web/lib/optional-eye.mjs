// The only link from the EMG core to the removable camera implementation.
export const EYE_MODULE_BASE=new URL('../../OPTIONAL_EYE_TRACKING/',import.meta.url);
export async function loadOptionalEye({fetcher=globalThis.fetch,loader=()=>import(new URL('calibration-ui.mjs',EYE_MODULE_BASE).href)}={}) {
  try {
    const response=await fetcher('/eye-module-status.json',{cache:'no-store'});
    if(!response.ok || !(await response.json()).available)return {available:false,error:'Optional camera eye tracking is not installed. Mouse gaze and the external gaze adapter remain available.'};
    return {available:true,module:await loader()};
  } catch(error) {return {available:false,error:'Optional camera eye tracking could not load. Restore OPTIONAL_EYE_TRACKING or use mouse/external gaze. '+error.message};}
}
export async function loadOptionalCamera() {
  try{return await import(new URL('camera-gaze.mjs',EYE_MODULE_BASE).href);}
  catch{throw new Error('Optional camera module is unavailable. Restore OPTIONAL_EYE_TRACKING and restart the server, or choose mouse/external gaze.');}
}
