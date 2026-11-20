import test from 'node:test';
import assert from 'node:assert/strict';
import {Emitter} from '../web/lib/core.mjs';
import {EmgController} from '../web/lib/emg-controller.mjs';

class FakeTransport extends Emitter {
  constructor(){super();this.kind='simulation';this.startPerf=1000;}
  async start(){this.emit('message',{type:'info',version:1,sampleRate:200,channels:1,adcMax:1023,simulated:true});}
  async stop(){this.emit('closed',{reason:'test'});}
  async send(){}
}
async function setup(){
  let time=1000;const c=new EmgController({now:()=>time}),transport=new FakeTransport();await c.connect(transport);
  const sample=(t,adc=75,seq=t/5)=>{time=1000+t;transport.emit('message',{type:'sample',seq,rawUs:t*1000,adc:[adc,null],missed:0});};
  sample(0);c.calibrate(2000);for(let t=5;t<=2010;t+=5)sample(t);
  return{c,transport,sample};
}
test('Controller retains negative-time baseline and explicit source on all recorded streams',async()=>{
  const {c,sample}=await setup();assert.equal(c.ready(),true);c.startRecording({participant:'TEST',gaze_source:'mouse_simulation'});
  sample(2015);c.recordGaze({source:'mouse_simulation',x:50,y:70,valid:true,aoi:'33',width:800,height:600});c.mark('bus_array_onset');c.stopRecording();
  const snap=c.recorder.snapshot();assert.ok(snap.emg[0].session_ms<0);assert.equal(snap.metadata.simulated_emg,true);
  assert.equal(snap.metadata.detector_config.algorithm,'envelope_hybrid_v2');assert.ok(snap.emg.at(-1).amplitude_threshold0>0);assert.equal(snap.emg.at(-1).activation_path0,null);
  assert.equal(snap.emg.at(-1).source,'simulation');assert.equal(snap.gaze[0].source,'mouse_simulation');assert.ok(snap.events.some(e=>e.type==='recording_stop'));await c.disconnect();
});
test('Device reboot invalidates calibration and does not carry old baseline into next recording',async()=>{
  const {c,sample}=await setup();sample(1,75,1);assert.equal(c.ready(),false);assert.equal(c.baselineSamples.length,0);assert.throws(()=>c.startRecording());await c.disconnect();
});
test('Disconnect prevents recording and a new source needs its own calibration',async()=>{
  const {c}=await setup();await c.disconnect();assert.equal(c.ready(),false);assert.throws(()=>c.startRecording());await c.connect(new FakeTransport());assert.equal(c.ready(),false);await c.disconnect();
});
