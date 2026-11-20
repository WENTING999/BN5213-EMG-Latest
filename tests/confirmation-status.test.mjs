import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationStatus} from '../web/lib/confirmation-status.mjs';
test('Live status explains energy/rate gates and automatic progression without posture claims',()=>{
 const state={phase:'warmup',warmupStep:1},result={quality:'ok',feature:10,threshold:15,rate:1,rateThreshold:2};
 assert.equal(confirmationStatus(state,result,true).code,'waiting');
 assert.equal(confirmationStatus(state,{...result,active:true},true).code,'release');
 assert.equal(confirmationStatus(state,{...result,quality:'artifact_recovery'},true).code,'artifact');
 assert.equal(confirmationStatus({...state,warmupStep:2},result,true).code,'confirmed');
 assert.equal(confirmationStatus({...state,paused:true},result,true).code,'paused');
 assert.equal(confirmationStatus(state,result,false).code,'not_ready');
});
