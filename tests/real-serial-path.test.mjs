import test from 'node:test';
import assert from 'node:assert/strict';
import {SerialTransport} from '../web/lib/transports.mjs';
import {EmgController} from '../web/lib/emg-controller.mjs';

test('REAL protocol travels through Web Serial parsing, baseline, clock mapping, activation and recording without simulation fallback',async()=>{
 let hostTime=1000,deviceMs=0,input,closed=false;
 const encoder=new TextEncoder(),send=line=>input.enqueue(encoder.encode(line+'\n'));
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const port={
  readable:new ReadableStream({start(controller){input=controller;}}),
  writable:new WritableStream({write(bytes){
   const command=new TextDecoder().decode(bytes).trim(),[kind,id]=command.split(',');
   if(kind==='I')send('I,BN5213,1,200,1,1023,REAL');
   if(kind==='P')send(`P,${id},${deviceMs*1000},${deviceMs*1000}`);
   if(kind==='M')send(`M,${id},${deviceMs*1000}`);
  }}),async open(){},async close(){closed=true;}
 };
 const transport=new SerialTransport({serial:{async requestPort(){return port;}}});
 const c=new EmgController({now:()=>hostTime}),activations=[];c.on('activation',event=>activations.push(event));
 const sample=async(ms,adc=75)=>{deviceMs=ms;hostTime=1000+ms;send(`D,${ms/5},${ms*1000},${adc},-1,0`);await flush();};
 try{
  await c.connect(transport);await flush();assert.equal(c.source,'serial');assert.equal(c.ready(),false);
  await sample(0);c.calibrate(5000);
  for(let i=0;i<3;i++){c.ping();await flush();}
  for(let ms=5;ms<=5010;ms+=5)await sample(ms);
  assert.equal(c.ready(),true);c.startRecording({participant:'SERIAL_TEST'});
  for(let ms=5015;ms<=5140;ms+=5)await sample(ms,620);
  assert.equal(activations.length,1);assert.equal(activations[0].source,'serial');assert.equal(activations[0].synchronized,true);
  assert.ok(activations[0].confirmedPerfMs>=activations[0].perfMs+30);
  c.stopRecording();const snapshot=c.recorder.snapshot();assert.equal(snapshot.metadata.simulated_emg,false);
  assert.ok(snapshot.emg.length>900);assert.ok(snapshot.emg.every(row=>row.source==='serial'));assert.equal(snapshot.emg.at(-1).adc0,620);
  assert.equal(c.parseErrors,0);
 }finally{await c.disconnect();}
 assert.equal(closed,true);assert.equal(c.ready(),false);
});
