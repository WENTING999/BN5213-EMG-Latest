export function inputStatus({connecting=false,connected=false,info=null,latest=null,baseline=null,baselineError=null,now=0,connectedAt=0,parseErrors=0}={}) {
  const result=(code,title,action)=>({code,title,action});
  if(connecting)return result('connecting','Select the Arduino port','Choose the Uno USB serial port in the browser dialog.');
  if(!connected)return result('disconnected','Not connected to a serial port','USB power alone does not connect this page. Upload the firmware, then click Connect Arduino.');
  if(!info)return now-connectedAt>8000 || parseErrors>0
    ?result('firmware_missing','Port open, but firmware is not recognized','Upload the supplied BN5213_EMG.ino, close Serial Monitor, disconnect here, then reconnect. This page cannot read a sketch that only prints ADC numbers.')
    :result('booting','Port open; waiting for firmware','The Uno may restart when its port opens. Wait a few seconds.');
  if(!latest)return result('no_samples','Firmware detected; no samples yet','The page recognizes the device, but its sample stream has not arrived. Check the uploaded sketch and USB connection.');
  if(now-latest.row.received_perf_ms>1000)return result('stale','Sample stream stopped','No fresh samples for over one second. Check USB and serial-port ownership. Reconnect if the stream does not recover.');
  if(baselineError)return result('baseline_failed','Baseline failed','Keep the muscle relaxed and click Recalibrate baseline. Check for clipping or missing samples.');
  if(latest.results[0].calibrating)return result('calibrating','Collecting resting baseline','Keep the measured muscle relaxed for five seconds. The live signal is already visible.');
  if(!baseline)return result('baseline_needed','Samples received; baseline required','Click Recalibrate baseline and remain relaxed for five seconds.');
  if(!latest.sync.ready)return result('synchronizing','Baseline complete; synchronizing clock','Wait for the serial clock estimate. Live viewing works while the clock is being synchronized.');
  return result('ready','Live input ready','Watch the denoised amplitude and burst features. A new amplitude increase or short burst can confirm a locked bus.');
}

export function serialErrorMessage(error) {
  if(error?.name==='NotFoundError')return 'No serial port selected. Click Connect Arduino and choose the Uno USB serial port.';
  if(['NetworkError','InvalidStateError'].includes(error?.name))return 'Could not open the serial port. Close Arduino Serial Monitor, Serial Plotter and other pages using this port, then reconnect.';
  if(error?.name==='SecurityError')return 'Serial access was blocked. Open the app on localhost in desktop Chrome or Edge and select the port yourself.';
  return error?.message || 'Serial connection failed. Check the USB cable and port selection.';
}
