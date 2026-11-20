import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {checkFaceMeshAssets,FACE_MESH_ASSETS,cameraStartError,stopGazeEngine} from '../OPTIONAL_EYE_TRACKING/camera-assets.mjs';
test('Missing FaceMesh resources identify the exact HTTP failure before camera startup',async()=>{
 await assert.rejects(checkFaceMeshAssets({base:'http://localhost:8765/mediapipe/face_mesh/',fetcher:async()=>({ok:false,status:404})}),/FaceMesh asset missing \(HTTP 404\)/);
 const calls=[];await checkFaceMeshAssets({base:'http://localhost:8765/mediapipe/face_mesh/',fetcher:async(url,options)=>{calls.push([url,options.method]);return {ok:true};}});
 assert.equal(calls.length,FACE_MESH_ASSETS.length);assert.ok(calls.every(([url,method])=>url.startsWith('http://localhost:8765/mediapipe/face_mesh/')&&method==='HEAD'));
});
test('Camera startup distinguishes permissions and runtime initialization; cleanup stops all tracks',async()=>{
 assert.match(cameraStartError({name:'NotAllowedError',message:'denied'},'startup').message,/permission was denied/);
 assert.match(cameraStartError(new TypeError('t is not a function'),'camera and FaceMesh startup').message,/Eye-tracker initialization failed/);
 let stopped=0,ended=0;await stopGazeEngine({params:{videoElementId:'video'},clearGazeListener(){},end(){ended++;throw new Error('partial DOM');}},
  {getElementById:()=>({srcObject:{getTracks:()=>[{stop(){stopped++;}},{stop(){stopped++;}}]}})});
 assert.equal(stopped,2);assert.equal(ended,1);
});
test('Pinned MediaPipe model files match the recorded npm integrity manifest and real WASM headers',()=>{
 const root=new URL('../OPTIONAL_EYE_TRACKING/mediapipe/face_mesh/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('ASSET_MANIFEST.json',root)));
 assert.equal(manifest.version,'0.4.1633559619');
 for(const item of manifest.files){const data=readFileSync(new URL(item.path,root));assert.equal(data.length,item.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),item.sha256);}
 for(const name of FACE_MESH_ASSETS.filter(x=>x.endsWith('.wasm')))assert.deepEqual([...readFileSync(new URL(name,root)).subarray(0,4)],[0,97,115,109]);
});
