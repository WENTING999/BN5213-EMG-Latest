import {ValidationWindow,validationReport,validationMessage} from './gaze-calibration.mjs';

export function installCameraCalibration({gaze,$,message,refresh,attempt,onStart=()=>{}}) {
let calibration=null,cameraStarting=false;
// User-initiated camera calibration. Never train on task clicks.
const trainPoints = [[.1,.1],[.5,.1],[.9,.1],[.1,.5],[.5,.5],[.9,.5],[.1,.9],[.5,.9],[.9,.9]];
const checkPoints = [[.3,.25],[.7,.25],[.5,.5],[.3,.75],[.7,.75]];
let calClicks=0,calIndex=0,calLastClick=0,calTimer=null,validationPoints=[];
function calPosition(point) { $('calPoint').style.left=`${point[0]*100}%`; $('calPoint').style.top=`${point[1]*100}%`; }
function cancelCalibration() { clearTimeout(calTimer); calibration=null; $('calibrationOverlay').hidden=true; }
function validatePoint() {
  if(!calibration) return;
  if(calIndex >= checkPoints.length) {
    gaze.validationResult=validationReport(validationPoints,{width:innerWidth,height:innerHeight});
    const passed=gaze.validationResult.passed; gaze.validated=passed;
    $('cameraResult').textContent=validationMessage(gaze.validationResult);
    cancelCalibration(); gaze.hidePreview(); message($('cameraResult').textContent,!passed); refresh(); return;
  }
  const point=checkPoints[calIndex]; calPosition(point);
  const window=calibration.window=new ValidationWindow(point,{width:innerWidth,height:innerHeight},performance.now());
  $('calInstructions').textContent=`Validation ${calIndex+1}/5: look at the dot without clicking. Keep your head still.`;
  const check=()=>{
    if(calibration?.window!==window)return;
    const result=window.inspect(performance.now());
    if(!result.done){$('calInstructions').textContent=`Validation ${calIndex+1}/5: keep looking at the dot. Tracked eye samples ${result.sample_count}/5; waiting for more frames. Do not click.`;calTimer=setTimeout(check,300);return;}
    validationPoints.push(result);calIndex++;validatePoint();
  };
  calTimer=setTimeout(check,1600);
}
$('cameraCalibrate').onclick=()=>attempt(async()=>{
  if(cameraStarting || calibration)return;
  cameraStarting=true;refresh();
  try {
    gaze.validationResult=null;onStart();
    await gaze.startCamera(); gaze.hidePreview(); calibration={stage:'train'};calIndex=0;calClicks=0;calLastClick=0;
    $('calibrationOverlay').hidden=false;calPosition(trainPoints[0]);
    $('calInstructions').textContent='Calibration 1/9: look at the dot and click it slowly 5 times. Keep your head still.';
  } catch(error) { $('cameraResult').textContent=error.message;throw error; }
  finally {cameraStarting=false;refresh();}
});
$('calPoint').onclick=()=>{
  if(calibration?.stage!=='train' || performance.now()-calLastClick<200) return;
  calLastClick=performance.now();const p=trainPoints[calIndex];
  if(!gaze.train(p[0]*innerWidth,p[1]*innerHeight)){$('calInstructions').textContent=`Calibration ${calIndex+1}/9: waiting for a fresh tracked eye frame (${calClicks}/5). Face the camera with both eyes visible, then click slowly.`;return;}
  calClicks++;
  if(calClicks===5){calIndex++;calClicks=0;}
  if(calIndex===trainPoints.length){calibration.stage='validate';calIndex=0;validationPoints=[];validatePoint();}
  else {calPosition(trainPoints[calIndex]);$('calInstructions').textContent=`Calibration ${calIndex+1}/9: look at the dot and click slowly (${calClicks}/5).`;}
};
$('calCancel').onclick=()=>{gaze.validated=false;cancelCalibration();message('Calibration cancelled. Try again or choose Mouse gaze test.');refresh();};

return {active:()=>!!calibration,busy:()=>cameraStarting||!!calibration,consume:data=>{if(calibration?.stage==='validate')calibration.window?.add(data,performance.now());},cancel:reason=>{gaze.validated=false;cancelCalibration();if(reason){$('cameraResult').textContent=reason;message(reason,true);}refresh();}};
}
