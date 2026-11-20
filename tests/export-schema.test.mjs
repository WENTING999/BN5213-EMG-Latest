import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {makeFiles,makeZip} from '../web/lib/integrated-export.mjs';
test('Burst export preserves raw ADC, separates feature units and marks automatic progression as unverified standing',()=>{
 const snapshot={metadata:{participant:'FIXTURE',condition:'gaze_emg',simulated_emg:true,validation_fixture:true,counts:{emg:1,gaze:0,events:1}},
  emg:[{adc0:243,filtered0:170.7,feature0:25.1,threshold0:17.5,rate0:3.2,rate_threshold0:2.1,quality0:'ok',source:'simulation',amplitude_threshold0:250,activation_path0:'burst'}],
  gaze:[],events:[{id:1,type:'emg_activation',source:'simulation'}]};
 const game={id:'FIXTURE',status:'completed',attempts:[{id:'T1',confirmationType:'emg',gazePerfMs:1000,emgOnsetPerfMs:1200,emgConfirmedPerfMs:1230,
  confirmationPerfMs:1200,searchPerfMs:800,emgSource:'simulation',repCompletedAt:'fixture',validForTiming:true,movement:{source:'emg_activation',standingVerified:false}}]};
 const files=makeFiles(snapshot,game);assert.match(files['emg.csv'],/feature0,threshold0,rate0,rate_threshold0,quality0/);
 assert.match(files['emg.csv'],/243,170.7,25.1,17.5,3.2,2.1,ok/);assert.match(files['trials.csv'],/emg_activation,false/);
 assert.equal(JSON.parse(files['metadata.json']).format,'BN5213_UI_EMG_3');
 assert.match(files['emg.csv'],/amplitude_threshold0,activation_path0/);assert.match(files['emg.csv'],/250,burst/);
 writeFileSync(new URL('../validation/BURST_SCHEMA_SIMULATED_FIXTURE.zip',import.meta.url),makeZip(snapshot,game));
});
