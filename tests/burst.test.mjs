import test from 'node:test';
import assert from 'node:assert/strict';
import {BurstProcessor} from '../web/lib/burst-processor.mjs';

const rest=t=>200+65*Math.sin(2*Math.PI*.4*t/1000)+25*Math.sin(2*Math.PI*50*t/1000)+3*Math.sin(2*Math.PI*17*t/1000);
function fixture(options={}){
 const p=new BurstProcessor(options);p.beginBaseline(5000);let time=0;const events=[],rows=[];
 const feed=(duration,fn=rest)=>{for(let end=time+duration;time<end;time+=5){const r=p.update(Math.round(fn(time)),time,time/5);rows.push(r);events.push(...r.events);}return rows.at(-1);};
 feed(5010);assert.ok(p.baseline);return {p,feed,events,rows,get time(){return time;}};
}
test('Slow seated waves and stationary 50 Hz ripple do not repeatedly trigger after a matched rest calibration',()=>{
 const x=fixture();x.feed(15000);assert.equal(x.events.filter(e=>e.type==='activation').length,0);
});
test('A short irregular burst is detected without an amplitude plateau or 0.5 second hold',()=>{
 const x=fixture();x.feed(1000);const start=x.time;
 x.feed(220,t=>rest(t)+75*Math.sin(2*Math.PI*12*(t-start)/1000));x.feed(500);
 const events=x.events.filter(e=>e.type==='activation');assert.equal(events.length,1);assert.ok(events[0].confirmedMs<start+220);
 assert.equal(events[0].confirmedMs-events[0].onsetMs,30);assert.equal(events[0].algorithm,'envelope_hybrid_v2');assert.match(events[0].activationPath,/burst/);
});
test('Isolated ADC spikes are rejected and clipped input is marked instead of becoming a game activation',()=>{
 const x=fixture();const start=x.time;
 x.feed(5000,t=>(t-start)%500===0?900:rest(t));assert.equal(x.events.filter(e=>e.type==='activation').length,0);
 const result=x.feed(250,()=>1023);assert.equal(result.quality,'artifact_recovery');assert.equal(result.active,false);
 assert.equal(x.events.filter(e=>e.type==='activation').length,0);
});
test('Sustained rapid activity produces one activation until a quiet release and refractory interval',()=>{
 const x=fixture();const start=x.time;x.feed(3000,t=>rest(t)+80*Math.sin(2*Math.PI*12*(t-start)/1000));
 assert.equal(x.events.filter(e=>e.type==='activation').length,1);x.feed(1800);const next=x.time;
 x.feed(220,t=>rest(t)+80*Math.sin(2*Math.PI*12*(t-next)/1000));assert.equal(x.events.filter(e=>e.type==='activation').length,2);
});
test('Causal notch and low-pass filtering reduce the displayed ripple while preserving original ADC values',()=>{
 const p=new BurstProcessor(),rows=[];
 for(let t=0;t<4000;t+=5)rows.push(p.update(140+40*Math.sin(2*Math.PI*50*t/1000),t));
 const tail=rows.slice(-200),raw=Math.max(...tail.map(r=>r.adc))-Math.min(...tail.map(r=>r.adc)),clean=Math.max(...tail.map(r=>r.filtered))-Math.min(...tail.map(r=>r.filtered));
 assert.equal(raw,80);assert.ok(clean<raw*.15);assert.equal(tail.at(-1).adc,rows.at(-1).adc);
});
test('Discontinuous or saturated rest cannot calibrate; a data gap resets the feature window',()=>{
 const p=new BurstProcessor();p.beginBaseline(1500);p.update(140,0);assert.equal(p.update(140,1500).events.at(-1).reason,'insufficient_continuous_samples');
 const q=new BurstProcessor();q.beginBaseline(1500);let r;for(let t=0;t<=1500;t+=5)r=q.update(1023,t);
 assert.equal(r.events.at(-1).reason,'saturated_baseline');
 const x=fixture();const result=x.p.update(140,x.time+200);assert.ok(result.events.some(e=>e.type==='signal_gap'));assert.equal(result.active,false);assert.equal(result.quality,'artifact_recovery');
});

test('A smooth contraction can confirm through amplitude even when rapid-change evidence stays below its limit',()=>{
 const p=new BurstProcessor({notchHz:0});p.beginBaseline(2000);let events=[];
 for(let t=0;t<=2010;t+=5)p.update(100,t);
 for(let t=2015;t<=4015;t+=5){const r=p.update(100+Math.min(60,(t-2015)*.03),t);events.push(...r.events);}
 const activations=events.filter(e=>e.type==='activation');assert.equal(activations.length,1);
 assert.equal(activations[0].activationPath,'amplitude');assert.ok(activations[0].rate<activations[0].rateThreshold);
 assert.equal(p.active,true);assert.ok(p.amplitudeThreshold>p.baseline.mean);
});

test('Held amplitude does not rearm through low burst energy; quiet release permits a subsequent activation',()=>{
 const p=new BurstProcessor({notchHz:0});p.beginBaseline(2000);let events=[];
 const feed=(start,end,value)=>{for(let t=start;t<=end;t+=5){const r=p.update(value,t);events.push(...r.events);}};
 feed(0,2010,100);feed(2015,7010,180);
 assert.equal(events.filter(e=>e.type==='activation').length,1);assert.equal(p.active,true);
 assert.ok(p.featureWindow.at(-1).delta<.001);
 feed(7015,9010,100);assert.equal(p.active,false);feed(9015,10010,180);
 assert.equal(events.filter(e=>e.type==='activation').length,2);
});
