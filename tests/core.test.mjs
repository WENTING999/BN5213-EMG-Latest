import test from 'node:test';
import assert from 'node:assert/strict';
import {LineFramer, parseLine, DeviceTimeline, ClockMapper, EnvelopeProcessor, DwellTracker, Recorder, csv} from '../web/lib/core.mjs';
import {crc32, zipStore, sessionFiles} from '../web/lib/export.mjs';
import {writeFileSync, mkdirSync} from 'node:fs';

test('Serial chunks may split numbers or contain multiple CRLF records', () => {
  const f = new LineFramer(50);
  assert.deepEqual(f.push('D,1,500'), []);
  const lines = f.push('0,75,-1,0\r\nD,2,10000,76,-1,0\n');
  assert.equal(parseLine(lines[0]).rawUs, 5000);
  assert.equal(parseLine(lines[1]).adc[1], null);
  assert.deepEqual(f.push('x'.repeat(51) + '\nI,BN5213,1,200,1,1023,REAL\n'), ['I,BN5213,1,200,1,1023,REAL']);
  assert.equal(f.errors, 1);
});
test('Wrong firmware, voltage-range ADC values and invalid metadata are rejected', () => {
  for (const line of ['ADC:400', 'D,1,3,1024,-1,0', 'D,1,3,-10,-1,0', 'D,1.5,3,70,-1,0', 'I,BN5213,2,200,1,1023,REAL', 'I,BN5213,1,200,0,1023,SIM']) assert.throws(() => parseLine(line));
  assert.equal(parseLine('I,BN5213,1,200,2,1023,SIM').simulated, true);
});
test('UNO micros rollover stays continuous; reboot starts a new segment', () => {
  const t = new DeviceTimeline(); t.sample(0xfffffff0, 100);
  const rollover = t.sample(4984, 101);
  assert.equal(rollover.reset, false); assert.equal(rollover.deviceMs, (0x100000000+4984)/1000);
  assert.equal(t.near(6000), (0x100000000+6000)/1000);
  assert.equal(t.sample(9984, 104).missing, 2);
  const reboot = t.sample(1000, 1); assert.equal(reboot.reset, true); assert.equal(reboot.segment, 1); assert.equal(reboot.deviceMs, 1);
});
test('Clock estimate rejects impossible RTT and expires; measured drift is fitted', () => {
  const c = new ClockMapper(); assert.equal(c.map(0,0), null);
  assert.equal(c.add(100,90,1,2), false);
  for (let i=0;i<12;i++) { const d=i*5000, h=d*1.001+1000; c.add(h-5,h+5,d,d); }
  assert.ok(Math.abs(c.map(20000,57000)-21020)<.01);
  assert.ok(Math.abs(c.slope-1.001)<1e-8);
  assert.equal(c.ready(80000), false);
});
function calibrated(options={}) {
  const p = new EnvelopeProcessor(options); p.beginBaseline(2000);
  for(let t=0;t<=2000;t+=5)p.update(75,t);
  assert.ok(p.baseline); return p;
}
test('Baseline, sustained activation and hysteretic release retain onset and confirmation times', () => {
  const p=calibrated(), events=[];
  for(let t=2005;t<=2200;t+=5)events.push(...p.update(400,t,t/5).events);
  const on=events.find(e=>e.type==='activation'); assert.ok(on); assert.equal(on.confirmedMs-on.onsetMs,30);
  for(let t=2205;t<=2600;t+=5)events.push(...p.update(75,t).events);
  assert.equal(events.filter(e=>e.type==='activation').length,1);
  assert.ok(events.some(e=>e.type==='release')); assert.equal(p.active,false);
});
test('Short spikes, data gaps, missing baseline samples and clipping are handled', () => {
  const p=calibrated({tauMs:.1});
  for(let t=2005;t<=2030;t+=5)assert.equal(p.update(t===2010?500:75,t).events.some(e=>e.type==='activation'),false);
  p.update(500,2035); assert.equal(p.update(500,2200).events[0].type,'signal_gap'); assert.equal(p.active,false);
  const q=new EnvelopeProcessor();q.beginBaseline(2000);q.update(75,0);
  assert.ok(q.update(75,2000).events.some(e=>e.type==='baseline_failed'));
  const r=new EnvelopeProcessor();r.beginBaseline(1500);let result;
  for(let t=0;t<=1500;t+=5)result=r.update(1023,t);
  assert.equal(result.clipped,true);assert.equal(result.events[0].reason,'saturated_baseline');
});
test('Recalibration removes the previous reference and requires a new baseline', () => {
  const p=calibrated();p.setReferencePeak(400);p.beginBaseline(1500);
  assert.equal(p.baseline,null);assert.equal(p.referencePeak,null);
});
test('Dwell history excludes future locks and expires if gaze callbacks stop', () => {
  const d=new DwellTracker();for(let t=0;t<=300;t+=50)d.update('33',t);
  assert.equal(d.at(299),null);assert.equal(d.at(310),'33');assert.equal(d.at(801),null);
  d.update('33',1000);assert.equal(d.locked,null);
  for(let t=1050;t<=1300;t+=50)d.update('58',t);
  assert.equal(d.at(1310),null);d.update('58',1350);assert.equal(d.at(1360),'58');
});
test('Gaze lock persists briefly outside its AOI, then expires despite other AOIs', () => {
  const d=new DwellTracker();for(let t=0;t<=300;t+=50)d.update('33',t);
  d.update('58',350);d.update('58',400);d.update('58',600);d.update('58',801);
  assert.equal(d.locked,null);assert.equal(d.at(790),'33');assert.equal(d.at(801),null);
});
test('Memory limit stops recording; later samples do not silently keep accumulating', () => {
  const r=new Recorder(2);let limit=0;r.on('limit',()=>limit++);r.start({simulated_emg:true});
  for(let i=0;i<5;i++)r.push('emg',{adc0:75});
  assert.equal(r.emg.length,2);assert.equal(r.recording,false);assert.equal(limit,1);
});
test('CSV supports JSON, commas, Unicode, and prevents string formula injection', () => {
  const out=csv([{a:'=SUM(1,2)',b:-5,c:'Bus"é',d:['33','58']}],['a','b','c','d']);
  assert.ok(out.startsWith('\uFEFFa,b,c,d'));assert.ok(out.includes('"\'=SUM(1,2)"'));assert.ok(out.includes(',-5,'));assert.ok(out.includes('Bus""é'));
});
test('ZIP CRC and six exported files are independently readable by Python zipfile', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  const r=new Recorder();r.start({participant:'TEST',simulated_emg:true});r.push('emg',{adc0:75,source:'simulation'});r.stop();
  const bytes=zipStore({...sessionFiles(r.snapshot()),'unicode_é.txt':'SIMULATED, not human data'});
  mkdirSync(new URL('../validation/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../validation/export_fixture.zip',import.meta.url),bytes);
  assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
});
