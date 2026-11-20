import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {GameBridge} from '../web/lib/game-bridge.mjs';
import {BurstProcessor} from '../web/lib/burst-processor.mjs';

// Minimal DOM and controllable browser timers exercise the original app's actual flow.
function setup(query='?fast=1&sets=2&reps=1') {
 let clock=100,taskId=0;const tasks=new Map();
 class Element {
  constructor(){this.children=[];this.dataset={};this.style={};this.listeners={};this.textContent='';this.disabled=false;this.checked=true;const set=new Set();this.classList={add:x=>set.add(x),remove:x=>set.delete(x),contains:x=>set.has(x),toggle:(x,on)=>on?set.add(x):set.delete(x)};}
  addEventListener(type,fn){this.listeners[type]=fn;} setAttribute(){} append(...els){this.children.push(...els);} appendChild(e){this.children.push(e);} replaceChildren(){this.children=[];} insertAdjacentHTML(){} remove(){}
  querySelectorAll(){return this.children;} click(){this.listeners.click?.({preventDefault(){}});}
  get lastElementChild(){return this.children.at(-1) || (this.children[0]=new Element());}
 }
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const checks=['bloodPressure','secureSeat','someoneNearby','feelingWell'].map(value=>Object.assign(new Element(),{value}));get('safetyChecklist').children=checks;
 get('patientPeriod').value='4';
 const document={getElementById:get,querySelectorAll:()=>checks,createElement:()=>new Element(),body:new Element(),head:new Element()};
 const schedule=(fn,ms)=>{const id=++taskId;tasks.set(id,{fn,at:clock+ms});return id;};
 const window={},storage=new Map();
 const sandbox={window,document,location:{search:query},URLSearchParams,performance:{now:()=>clock},console,
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},setTimeout:schedule,setInterval:schedule,clearTimeout:id=>tasks.delete(id),clearInterval:id=>tasks.delete(id)};
 vm.runInNewContext(fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8'),sandbox);
 const tick=ms=>{const end=clock+ms;while(true){const next=[...tasks.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;clock=next[1].at;tasks.delete(next[0]);next[1].fn();}clock=end;};
 return {game:window.CatchYourBus,get,tick,now:()=>clock};
}
test('UI cannot start before input readiness and does not auto-count a confirmed selection',()=>{
 const {game,get,tick}=setup('?fast=1&sets=1&reps=2');get('startSessionButton').click();assert.equal(game.getState().session,null);
 game.configure({inputReady:true,busCount:4});get('startSessionButton').click();game.inputs.warmupGazeLocked();game.inputs.warmupFootPressConfirmed();tick(1400);
 const route=game.getState().currentAttempt.targetRoute;game.inputs.gazeTarget(route,{source:'mouse_simulation'});game.inputs.emgConfirmed({source:'simulation'});tick(15000);
 assert.equal(game.getState().session.completedReps,0);assert.equal(game.getState().currentAttempt.gazeSource,'mouse_simulation');
 assert.equal(game.inputs.repCompleted({source:'manual_observer'}),true);assert.equal(game.inputs.repCompleted({source:'manual_observer'}),false);assert.equal(game.getState().session.completedReps,1);
});

test('A short measured burst passes warmup and automatically advances an actual UI trial without observer buttons',()=>{
 const x=setup('?fast=1&sets=1&reps=2'),p=new BurstProcessor(),emg={source:'serial',ready:()=>!!p.baseline,mark(){}};
 const bridge=new GameBridge(x.game,emg,{now:x.now});
 function feed(duration,fn){const end=x.now()+duration;while(x.now()<end){
  const result=p.update(fn(x.now()),x.now());
  for(const event of result.events)if(event.type==='activation')bridge.activation({channel:0,synchronized:true,perfMs:event.onsetMs,confirmedPerfMs:event.confirmedMs,algorithm:event.algorithm});
  x.tick(5);
 }}
 // Generated fixture, not a physical body measurement.
 const quiet=()=>140;p.beginBaseline(1500);feed(1510,quiet);
 x.game.configure({inputReady:true,advanceOnConfirmation:true});x.get('startSessionButton').click();
 bridge.select('warmup');let start=x.now();feed(220,t=>140+70*Math.sin(2*Math.PI*12*(t-start)/1000));
 assert.equal(x.game.getState().warmupStep,2,'practice must not require a 0.5 s hold');
 feed(1600,quiet);const attempt=x.game.getState().currentAttempt;bridge.select(attempt.targetRoute);
 start=x.now();feed(220,t=>140+70*Math.sin(2*Math.PI*12*(t-start)/1000));
 assert.equal(x.game.getState().currentAttempt.confirmationType,'emg');
 assert.equal(x.game.getState().session.completedReps,0);feed(700,quiet);
 const session=x.game.getState().session;assert.equal(session.completedReps,1);
 assert.equal(session.attempts[0].movement.source,'emg_activation');assert.equal(session.attempts[0].movement.standingVerified,false);
 assert.equal(session.attempts[0].movement.observerStandAt,undefined);
});

test('Automatic progression freezes on pause and cannot complete an aborted trial',()=>{
 const x=setup('?fast=1&sets=1&reps=2');x.game.configure({inputReady:true,advanceOnConfirmation:true});x.get('startSessionButton').click();
 x.game.inputs.warmupGazeLocked();x.game.inputs.warmupFootPressConfirmed();x.tick(1400);
 x.game.inputs.gazeTarget(x.game.getState().currentAttempt.targetRoute);x.game.inputs.emgConfirmed();x.tick(200);x.game.pause('test_pause');x.tick(10000);
 assert.equal(x.game.getState().session.completedReps,0);x.game.resume();x.tick(449);assert.equal(x.game.getState().session.completedReps,0);x.tick(1);
 assert.equal(x.game.getState().session.completedReps,1);x.tick(1400);
 x.game.inputs.gazeTarget(x.game.getState().currentAttempt.targetRoute);x.game.inputs.emgConfirmed();x.game.endSession('source_closed');x.tick(10000);
 assert.equal(x.game.getState().session.completedReps,1);assert.equal(x.game.getState().session.status,'aborted');
});

test('Smooth amplitude confirmation also advances the original practice and game, without retriggering while held',()=>{
 const x=setup('?fast=1&sets=1&reps=2'),p=new BurstProcessor({notchHz:0}),emg={source:'serial',ready:()=>!!p.baseline,mark(){}};
 const bridge=new GameBridge(x.game,emg,{now:x.now});let accepted=0;
 function feed(duration,fn){const end=x.now()+duration;while(x.now()<end){
  const result=p.update(fn(x.now()),x.now());
  for(const event of result.events)if(event.type==='activation'){
   accepted+=Number(bridge.activation({channel:0,synchronized:true,perfMs:event.onsetMs,confirmedPerfMs:event.confirmedMs,algorithm:event.algorithm}));
  }x.tick(5);
 }}
 const quiet=()=>140;p.beginBaseline(1500);feed(1510,quiet);
 x.game.configure({inputReady:true,advanceOnConfirmation:true});x.get('startSessionButton').click();bridge.select('warmup');
 let start=x.now();feed(1000,t=>140+Math.min(60,(t-start)*.03));assert.equal(x.game.getState().warmupStep,2);
 feed(2000,quiet);bridge.select(x.game.getState().currentAttempt.targetRoute);
 start=x.now();feed(1000,t=>140+Math.min(60,(t-start)*.03));feed(3000,()=>170);
 assert.equal(x.game.getState().session.completedReps,1);assert.equal(accepted,2);assert.equal(p.active,true);
 assert.equal(x.game.getState().session.attempts[0].movement.standingVerified,false);
});
test('Rest countdown freezes while paused, resumes remaining time, and requires Continue',()=>{
 const {game,get,tick}=setup();game.configure({inputReady:true});get('startSessionButton').click();game.inputs.warmupGazeLocked();game.inputs.warmupFootPressConfirmed();tick(1400);
 game.inputs.gazeTarget(game.getState().currentAttempt.targetRoute);game.inputs.emgConfirmed();game.inputs.repCompleted();assert.equal(game.getState().phase,'rest');tick(1100);assert.equal(get('restCountdown').textContent,'00:04');
 game.pause('test_pause');tick(10000);assert.equal(get('restCountdown').textContent,'00:04');game.resume();tick(4000);assert.equal(get('restCountdown').textContent,'00:00');assert.equal(game.getState().phase,'rest');
 get('continueSetButton').click();assert.equal(game.getState().currentSet,2);assert.equal(game.getState().phase,'game');
});
test('Gaze-only trials retain blank EMG fields; abort preserves an unfinished trial with exclusion reason',()=>{
 const {game,get,tick}=setup();game.configure({inputReady:true});get('startSessionButton').click();game.inputs.warmupGazeLocked();game.inputs.warmupFootPressConfirmed({source:'mouse_simulation:gaze_only'});tick(1400);
 game.inputs.gazeTarget(game.getState().currentAttempt.targetRoute);game.inputs.emgConfirmed({confirmationType:'gaze_only',source:'mouse_simulation',onsetPerfMs:1500});
 let a=game.getState().currentAttempt;assert.equal(a.emgConfirmedAt,null);assert.equal(a.emgSource,null);assert.equal(a.confirmationType,'gaze_only');
 game.endSession('operator_end');const s=game.getState().session;assert.equal(s.status,'aborted');assert.equal(s.attempts.length,1);assert.equal(s.attempts[0].validForTiming,false);assert.equal(s.attempts[0].timingExclusion,'operator_end');
 assert.equal(s.warmup.confirmationType,'gaze_only');
});
