import test from 'node:test';
import assert from 'node:assert/strict';
import {watchEyeFrames,trainingFrameReady,ValidationWindow,validationReport,validationMessage} from '../OPTIONAL_EYE_TRACKING/gaze-calibration.mjs';
import {GazeAdapter} from '../web/lib/gaze.mjs';
import {loadOptionalEye} from '../web/lib/optional-eye.mjs';

const patches={left:{width:20,height:10},right:{width:20,height:10}};
test('Only fresh, distinct frames with two eye patches can count as calibration training',async()=>{
  const states=[], tracker={result:patches,async getEyePatches(){return this.result;}}, original=tracker.getEyePatches;
  const restore=watchEyeFrames(tracker,value=>states.push(value));
  assert.equal(await tracker.getEyePatches(),patches);
  tracker.result=false;await tracker.getEyePatches();
  tracker.result={...patches,right:{width:0,height:10}};await tracker.getEyePatches();
  assert.deepEqual(states,[true,false,false]);restore();assert.equal(tracker.getEyePatches,original);
  assert.equal(trainingFrameReady({tracked:true,at:500,id:1},null,600),true);
  assert.equal(trainingFrameReady({tracked:true,at:500,id:1},1,600),false);
  assert.equal(trainingFrameReady({tracked:true,at:500,id:2},1,1501),false);
  assert.equal(trainingFrameReady({tracked:false,at:500,id:2},1,600),false);
});

test('Actual gaze adapter rejects untracked and duplicate-frame training, and restores its watcher on stop',async()=>{
  const oldWindow=globalThis.window,oldFetch=globalThis.fetch,oldWidth=globalThis.innerWidth,oldHeight=globalThis.innerHeight;
  let trained=0;const tracker={async getEyePatches(){return patches;}}, original=tracker.getEyePatches;
  const engine={params:{},getTracker:()=>tracker,saveDataAcrossSessions(){},setGazeListener(){},async begin(){await tracker.getEyePatches();},
    async clearData(){},removeMouseEventListeners(){},showPredictionPoints(){},showVideoPreview(){},recordScreenPosition(){trained++;},clearGazeListener(){},end(){}};
  globalThis.window={webgazer:engine,isSecureContext:true};globalThis.fetch=async()=>({ok:true});globalThis.innerWidth=1000;globalThis.innerHeight=800;
  const gaze=new GazeAdapter();
  try {
    assert.equal(gaze.train(100,100),false);await gaze.startCamera();
    assert.equal(gaze.train(100,100),true);assert.equal(gaze.train(100,100),false);assert.equal(trained,1);
    await tracker.getEyePatches();assert.equal(gaze.train(200,100),true);
    gaze.camera.faceFrame.tracked=false;assert.equal(gaze.train(200,100),false);
    gaze.emitData({x:100,y:100},0);assert.equal(gaze.latest.valid,false);
    await gaze.stopCamera();assert.equal(tracker.getEyePatches,original);assert.equal(gaze.train(200,100),false);
  } finally { globalThis.window=oldWindow;globalThis.fetch=oldFetch;globalThis.innerWidth=oldWidth;globalThis.innerHeight=oldHeight; }
});

test('A missing optional eye folder disables only camera setup, without eagerly importing camera code',async()=>{
  let loads=0;
  const result=await loadOptionalEye({fetcher:async()=>({ok:true,json:async()=>({available:false})}),loader:async()=>{loads++;throw new Error('must not load');}});
  assert.equal(result.available,false);assert.equal(loads,0);
  const gaze=new GazeAdapter({cameraLoader:async()=>{throw new Error('optional folder absent');}});
  await assert.rejects(gaze.startCamera(),/optional folder absent/);assert.equal(gaze.mode,'mouse_simulation');assert.equal(gaze.train(10,10),false);
  const oldWidth=globalThis.innerWidth,oldHeight=globalThis.innerHeight;globalThis.innerWidth=1000;globalThis.innerHeight=800;
  try{gaze.emitData({x:100,y:100},0);assert.equal(gaze.latest.valid,true);assert.equal(gaze.latest.source,'mouse_simulation');}
  finally{globalThis.innerWidth=oldWidth;globalThis.innerHeight=oldHeight;}
});

test('Validation extends low-frame-rate collection while keeping the minimum sample count and four-second deadline',()=>{
  const win=new ValidationWindow([.5,.5],{width:1000,height:800},0);
  win.add({tracked:true,x:500,y:400},200); // Settling is excluded.
  for(const t of [800,1300])win.add({tracked:true,x:500,y:400},t);
  assert.equal(win.inspect(1600).done,false);
  for(const t of [1800,2300,2800])win.add({tracked:true,x:500,y:400},t);
  assert.equal(win.inspect(2800).done,true);assert.equal(win.inspect(2800).sample_count,5);assert.equal(win.inspect(2800).median_error_px,0);
  const empty=new ValidationWindow([.5,.5],{width:1000,height:800},0);
  empty.add({tracked:false,x:500,y:400},800);empty.add({tracked:true,x:NaN,y:400},900);
  assert.equal(empty.inspect(3999).done,false);assert.equal(empty.inspect(4000).done,true);assert.equal(empty.inspect(4000).median_error_px,null);
});

test('Off-screen predictions fail accuracy instead of being misreported as missing samples',()=>{
  const win=new ValidationWindow([.5,.5],{width:1000,height:800},0);
  for(let t=400;t<=800;t+=100)win.add({tracked:true,valid:false,x:-500,y:400},t);
  const point=win.inspect(1600),report=validationReport(Array(5).fill(point),{width:1000,height:800});
  assert.equal(report.reason,'accuracy');assert.equal(report.median_error_px,1000);assert.equal(report.acceptance_limit_px,96);
  assert.match(validationMessage(report),/median error 1000 px, limit 96 px/);
  const insufficient=validationReport([{sample_count:3,median_error_px:null},...Array(4).fill(point)],{width:1000,height:800});
  assert.equal(insufficient.reason,'insufficient_samples');assert.match(validationMessage(insufficient),/3, 5, 5, 5, 5/);
  assert.equal(validationReport(Array(5).fill({sample_count:5,median_error_px:20}),{width:1000,height:800}).passed,true);
});
