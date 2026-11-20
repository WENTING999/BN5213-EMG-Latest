import test from 'node:test';
import assert from 'node:assert/strict';
import {GameBridge} from '../web/lib/game-bridge.mjs';
import {makeFiles} from '../web/lib/integrated-export.mjs';

function setup(){
 let now=1000, confirmations=[], reps=[], marks=[];
 const state={phase:'game',paused:false,currentAttempt:{id:'T1',gazePerfMs:null,selectedRoute:null,confirmedAt:null}};
 const game={getState:()=>state, inputs:{
  gazeTarget:(route,meta)=>{if(state.currentAttempt.selectedRoute)return false;state.currentAttempt.gazePerfMs=now;state.currentAttempt.selectedRoute=route;state.currentAttempt.gazeSource=meta.source;return true;},
  emgConfirmed:p=>{if(state.currentAttempt.confirmedAt)return false;confirmations.push(p);state.currentAttempt.confirmedAt='yes';return true;},
  repCompleted:p=>{if(state.currentAttempt.repCompletedAt)return false;reps.push(p);state.currentAttempt.repCompletedAt='yes';return true;}
 }};
 const emg={source:'simulation',ready:()=>true,mark:(...args)=>marks.push(args)};
 const bridge=new GameBridge(game,emg,{now:()=>now});
 return{bridge,state,confirmations,reps,marks,setTime:x=>now=x};
}
test('EMG onset before gaze lock is rejected even if confirmation callback arrives after the lock',()=>{
 const x=setup();x.bridge.select('33');assert.equal(x.bridge.activation({channel:0,synchronized:true,perfMs:999,confirmedPerfMs:1040}),false);assert.equal(x.confirmations.length,0);
 assert.equal(x.bridge.activation({channel:0,synchronized:true,perfMs:1010,confirmedPerfMs:1040}),true);assert.equal(x.confirmations.length,1);assert.equal(x.reps.length,0);
});
test('Gaze-only confirmation does not claim EMG source or complete a repetition automatically',()=>{
 const x=setup();x.bridge.condition='gaze_only';x.bridge.select('33');assert.equal(x.confirmations[0].confirmationType,'gaze_only');assert.equal(x.confirmations[0].source,'mouse_simulation');assert.equal(x.reps.length,0);
 assert.equal(x.bridge.activation({channel:0,synchronized:true,perfMs:1100}),false);
});
test('Bridge confirms once and no longer exposes a manual observer gate',()=>{
 const x=setup();x.bridge.select('33');assert.equal(x.bridge.activation({channel:0,synchronized:true,perfMs:1020}),true);
 assert.equal(x.bridge.activation({channel:0,synchronized:true,perfMs:1030}),false);
 assert.equal(x.confirmations.length,1);assert.equal(x.bridge.observerStand,undefined);assert.equal(x.bridge.observerSeated,undefined);
});
test('Stale gaze and unsynchronized events cannot confirm a selected bus',()=>{
 const x=setup();x.bridge.gazeSource='webgazer';x.bridge.gaze('33',700);x.bridge.gaze('33',800);x.bridge.gaze('33',900);x.bridge.gaze('33',1000);
 assert.equal(x.bridge.activation({channel:0,synchronized:false,perfMs:1050}),false);
 assert.equal(x.bridge.activation({channel:0,synchronized:true,perfMs:1600}),false);assert.equal(x.confirmations.length,0);
 assert.equal(x.bridge.activation({channel:0,synchronized:true,perfMs:1020}),true);
});
test('Paused trial rejects confirmation',()=>{
 const x=setup();x.bridge.select('33');x.state.paused=true;assert.equal(x.bridge.activation({channel:0,synchronized:true,perfMs:1020}),false);
});
test('Fresh gaze dwell uses receipt clock and requires a continuous 300 ms',()=>{
 const x=setup();x.bridge.gazeSource='external';for(let t=0;t<=300;t+=100){x.setTime(1000+t);x.bridge.gaze('33',1000+t,'external:tracker');}
 assert.equal(x.state.currentAttempt.gazeSource,'external:tracker');assert.equal(x.state.currentAttempt.gazePerfMs,1300);assert.equal(x.bridge.activation({channel:0,synchronized:true,perfMs:1200}),false);
});
test('Integrated export keeps missing pupils empty, separates conditions, and derives timing from monotonic timestamps',()=>{
 const snapshot={metadata:{simulated_emg:true,condition:'gaze_only',counts:{emg:1}},emg:[{adc0:75}],gaze:[],events:[]};
 const game={id:'G1',status:'completed',protocol:{sets:1,repsPerSet:2,fastMode:true},attempts:[{id:'T1',searchPerfMs:1000,gazePerfMs:1300,confirmationPerfMs:1300,confirmationType:'gaze_only',emgOnsetPerfMs:null,validForTiming:false,timingExclusion:'page_hidden'}]};
 const files=makeFiles(snapshot,game,[]), meta=JSON.parse(files['metadata.json']);assert.equal(Object.keys(files).length,8);assert.equal(meta.pupil_available,false);assert.equal(meta.protocol.fastMode,true);
 const [columns,line]=files['trials.csv'].replace(/^\uFEFF/,'').split('\r\n');const values=Object.fromEntries(columns.split(',').map((k,i)=>[k,line.split(',')[i]]));
 assert.equal(values.emgOnsetPerfMs,'');assert.equal(values.selectionReactionMs,'300');assert.equal(values.gazeToConfirmationMs,'0');assert.equal(values.validForTiming,'false');assert.equal(files['pupil.csv'].split('\r\n').length,1);
});
