export function confirmationStatus(state,result,ready) {
  if(state.paused)return {code:'paused',title:'Session paused',action:'Resume the session, then make a new activation.'};
  if(!ready)return {code:'not_ready',title:'Input not ready',action:'Check the connection, resting baseline and clock in EMG setup.'};
  if(state.warmupStep===2&&state.phase==='warmup'||state.currentAttempt?.confirmedAt)return {code:'confirmed',title:'Activation confirmed',action:'The game advances automatically. No observer buttons are required.'};
  if(state.phase==='game'&&!state.currentAttempt?.findShownAt)return {code:'memory',title:'Remember the bus number',action:'Wait for the bus choices. Relax before the next activation.'};
  if(state.phase==='warmup'?state.warmupStep!==1:!state.currentAttempt?.gazePerfMs)return {code:'select',title:'Select a bus first',action:'Click a bus or lock it with gaze, then make one new activation.'};
  if(result?.quality!=='ok')return {code:'artifact',title:'Signal quality warning',action:'Clipped or interrupted data cannot confirm a selection. Check EMG setup.'};
  if(result.active)return {code:'release',title:'Wait for the signal to settle',action:'A previous activation is still active. Let it return to QUIET, then make a new activation.'};
  if(result.feature>result.threshold&&result.rate>result.rateThreshold)return {code:'checking',title:'Checking a short burst',action:'A short multi-sample activation is enough. No 0.5-second hold is needed.'};
  return {code:'waiting',title:'Waiting for a new EMG burst',action:result.rate<=result.rateThreshold?'Waveform change is below the resting-noise limit. A slow wave alone does not confirm.':'Burst energy is below its calibrated threshold. No 0.5-second hold is needed.'};
}
