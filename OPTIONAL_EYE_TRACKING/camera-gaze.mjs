import {checkFaceMeshAssets,FACE_MESH_BASE,cameraStartError,stopGazeEngine} from './camera-assets.mjs';
import {watchEyeFrames,trainingFrameReady} from './gaze-calibration.mjs';

// Optional WebGazer implementation. The EMG application does not import this eagerly.
export class CameraGaze {
  constructor({onData=()=>{},onMode=()=>{}}={}) {
    this.onData=onData;this.onMode=onMode;this.running=false;this.faceFrame=null;this.frameId=0;this.lastTrainFrame=null;
  }
  isTracking(now=performance.now()) { return this.running && !!this.faceFrame?.tracked && now-this.faceFrame.at<=1000; }
  async start() {
    if(this.running && window.webgazer){await window.webgazer.clearData();this.lastTrainFrame=null;window.webgazer.showVideoPreview(true);return;}
    if(!window.isSecureContext)throw new Error('Camera input requires localhost or HTTPS. Open the app using START_HERE.cmd.');
    await checkFaceMeshAssets();
    if(!window.webgazer)await new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=new URL('./vendor/webgazer.js',import.meta.url).href;
      script.onload=resolve;script.onerror=()=>reject(new Error('WebGazer could not load from OPTIONAL_EYE_TRACKING/vendor/webgazer.js. Restore the optional folder or choose another gaze source.'));document.head.appendChild(script);
    });
    const engine=window.webgazer;this.running=true;this.onMode('webgazer');let stage='camera and FaceMesh startup';
    try {
      engine.params.faceMeshSolutionPath=FACE_MESH_BASE;
      this.restoreEyeWatcher?.();this.faceFrame=null;this.lastTrainFrame=null;
      this.restoreEyeWatcher=watchEyeFrames(engine.getTracker(),tracked=>{if(this.running)this.faceFrame={tracked,at:performance.now(),id:++this.frameId};});
      engine.saveDataAcrossSessions(false);
      engine.setGazeListener((data,elapsed)=>{if(this.running)this.onData(data,elapsed);});
      await engine.begin();stage='calibration setup';await engine.clearData();
      engine.removeMouseEventListeners(); // Never train on subsequent game clicks.
      engine.showPredictionPoints(false);engine.setVideoViewerSize?.(160,120);engine.showVideoPreview(true);
    } catch(error) {await this.stop();throw cameraStartError(error,stage);}
  }
  train(x,y) {
    if(!this.running || !trainingFrameReady(this.faceFrame,this.lastTrainFrame,performance.now()))return false;
    window.webgazer.recordScreenPosition(x,y,'click');this.lastTrainFrame=this.faceFrame.id;return true;
  }
  hidePreview() {if(this.running && window.webgazer)window.webgazer.showVideoPreview(false);}
  async stop() {
    const wasRunning=this.running;this.running=false;
    this.restoreEyeWatcher?.();this.restoreEyeWatcher=null;this.faceFrame=null;this.lastTrainFrame=null;
    if(wasRunning && window.webgazer)await stopGazeEngine(window.webgazer);
    this.onMode('none');
  }
}
