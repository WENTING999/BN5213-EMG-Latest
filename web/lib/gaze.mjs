import {Emitter} from './core.mjs';
import {loadOptionalCamera} from './optional-eye.mjs';

// Mouse selection and the common input bridge stay available without a camera module.
export class GazeAdapter extends Emitter {
  constructor({cameraLoader=loadOptionalCamera}={}) {
    super();this.cameraLoader=cameraLoader;this.camera=null;this.mode='mouse_simulation';this.pointer=null;this.validated=false;this.latest=null;
  }
  startMouse() {
    this.mode='mouse_simulation';this.validated=false;
    if(!this.mouseListener){
      this.mouseListener=event=>{this.pointer={x:event.clientX,y:event.clientY};};
      window.addEventListener('pointermove',this.mouseListener);window.addEventListener('blur',()=>{this.pointer=null;});
    }
    if(!this.mouseTimer)this.mouseTimer=setInterval(()=>{if(this.mode==='mouse_simulation')this.emitData(this.pointer,null);},50);
    this.emit('mode',{source:this.mode});
  }
  emitData(data,elapsed) {
    const received=performance.now(),tracked=this.mode!=='webgazer' || !!this.camera?.isTracking(received);
    const valid=tracked && !!data && Number.isFinite(data.x) && Number.isFinite(data.y) && data.x>=0 && data.y>=0 && data.x<=innerWidth && data.y<=innerHeight;
    this.latest={source:this.mode,x:data?.x??null,y:data?.y??null,valid,tracked,elapsed,received};this.emit('data',this.latest);
  }
  async startCamera() {
    this.validated=false;
    if(!this.camera){
      const {CameraGaze}=await this.cameraLoader();
      this.camera=new CameraGaze({onData:(data,elapsed)=>this.emitData(data,elapsed),onMode:mode=>{this.mode=mode;this.emit('mode',{source:mode});}});
    }
    await this.camera.start();
  }
  train(x,y){return this.camera?.train(x,y)??false;}
  hidePreview(){this.camera?.hidePreview();}
  async stopCamera(){await this.camera?.stop();this.mode='none';this.latest=null;this.validated=false;}
  async useMouse(){await this.stopCamera();this.startMouse();}
}
