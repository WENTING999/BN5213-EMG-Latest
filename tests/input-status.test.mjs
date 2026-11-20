import test from 'node:test';
import assert from 'node:assert/strict';
import {inputStatus,serialErrorMessage} from '../web/lib/input-status.mjs';
import {chartBounds} from '../web/lib/signal-chart.mjs';

test('USB-only state explicitly requires selecting a browser serial port',()=>{
 const s=inputStatus();assert.equal(s.code,'disconnected');assert.match(s.action,/USB power alone/);assert.match(s.action,/Connect Arduino/);
 assert.equal(inputStatus({connecting:true}).code,'connecting');
});
test('An open port with missing or incompatible firmware is not reported as live EMG',()=>{
 assert.equal(inputStatus({connected:true,now:1000,connectedAt:500}).code,'booting');
 assert.equal(inputStatus({connected:true,now:10000,connectedAt:500}).code,'firmware_missing');
 assert.equal(inputStatus({connected:true,parseErrors:1}).code,'firmware_missing');
 assert.equal(inputStatus({connected:true,info:{version:1}}).code,'no_samples');
});
test('Sample, baseline and clock readiness are distinct and stale data cannot appear ready',()=>{
 const args={connected:true,info:{version:1},now:3000,latest:{row:{received_perf_ms:2900},results:[{calibrating:true}],sync:{ready:false}}};
 assert.equal(inputStatus(args).code,'calibrating');args.latest.results[0].calibrating=false;assert.equal(inputStatus(args).code,'baseline_needed');
 args.baseline={mean:75};assert.equal(inputStatus(args).code,'synchronizing');args.latest.sync.ready=true;assert.equal(inputStatus(args).code,'ready');
 args.now=5000;assert.equal(inputStatus(args).code,'stale');args.now=3000;args.baselineError='missing';assert.equal(inputStatus(args).code,'baseline_failed');
});
test('Port chooser cancellation and a busy port give actionable English instructions',()=>{
 assert.match(serialErrorMessage({name:'NotFoundError'}),/No serial port selected/);
 assert.match(serialErrorMessage({name:'NetworkError'}),/Close Arduino Serial Monitor/);
 assert.match(serialErrorMessage({name:'SecurityError'}),/localhost/);
});
test('Auto zoom makes small valid signals visible without changing ADC samples or thresholds',()=>{
 const history=[[0,74,75,85],[5,76,75.1,85]],saved=JSON.stringify(history),[low,high]=chartBounds(history);
 assert.ok(low<74 && high>85 && high-low>=20 && high-low<100);assert.equal(JSON.stringify(history),saved);
 assert.deepEqual(chartBounds(history,true),[0,1023]);assert.deepEqual(chartBounds([]),[0,1023]);
 for(const input of [[[0,0,0,null]],[[0,1023,1023,1023]],[[0,0,1023,1023]]]){const [a,b]=chartBounds(input);assert.ok(a>=0 && b<=1023 && b>a);}
});
