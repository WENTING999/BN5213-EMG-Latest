// Causal features of the board's 200 Hz ENVELOPE, not raw bipolar surface EMG.
// Thresholds are fitted to seated rest; this is an activation detector, not a posture classifier.
function quantile(values, fraction) {
  const sorted = [...values].sort((a,b)=>a-b), i = (sorted.length-1)*fraction;
  if (!sorted.length) return 0;
  return sorted[Math.floor(i)] + (sorted[Math.ceil(i)]-sorted[Math.floor(i)])*(i-Math.floor(i));
}
function limits(values, floor, sensitivity) {
  const median = quantile(values,.5), mad = 1.4826*quantile(values.map(x=>Math.abs(x-median)),.5);
  return {median, mad, on:quantile(values,.95)+Math.max(3*mad,floor)*sensitivity,
    off:median+Math.max(1.5*mad,floor*.5)*sensitivity};
}
const pathName=mask=>mask===3?'amplitude+burst':mask===1?'amplitude':mask===2?'burst':null;
export class BurstProcessor {
  constructor(options={}) {
    this.config={algorithm:'envelope_hybrid_v2',sampleRate:200,medianSamples:3,notchHz:50,notchQ:15,
      lowpassHz:25,trendTauMs:180,windowMs:120,onHoldMs:30,offHoldMs:150,refractoryMs:1200,
      maxGapMs:100,minEnergy:4,minRate:.8,minAmplitude:10,sensitivity:1,artifactRecoveryMs:200,...options};
    if (![0,50,60].includes(this.config.notchHz) || ![.7,1,1.5].includes(this.config.sensitivity)) throw new Error('Unsupported detector setting');
    this.reset();
  }
  reset() {
    this.baseline=null;this.threshold=null;this.offThreshold=null;this.rateThreshold=null;this.rateOffThreshold=null;
    this.amplitudeThreshold=null;this.amplitudeOffThreshold=null;this.activePath=null;
    this.calibration=null;this.active=false;this.candidate=null;this.releaseCandidate=null;this.lastOnset=-Infinity;
    this.lastTime=null;this.filtered=null;this.referencePeak=null;this.invalidUntil=-Infinity;this.clearFilters();
  }
  clearFilters() {
    this.rawWindow=[];this.featureWindow=[];this.notchState=[0,0,0,0];this.lp1=null;this.lp2=null;this.trend=null;this.previousClean=null;
  }
  beginBaseline(durationMs=5000) {
    if (!Number.isFinite(durationMs)||durationMs<1500) throw new Error('Baseline must be at least 1500 ms');
    this.baseline=null;this.threshold=null;this.offThreshold=null;this.rateThreshold=null;this.rateOffThreshold=null;
    this.amplitudeThreshold=null;this.amplitudeOffThreshold=null;this.activePath=null;
    this.active=false;this.candidate=null;this.releaseCandidate=null;this.lastOnset=-Infinity;
    this.calibration={start:null,duration:durationMs,settle:Math.min(1000,durationMs/2),energy:[],rate:[],clean:[],gaps:0,clipped:0,n:0};
  }
  notch(value) {
    const {notchHz,sampleRate,notchQ}=this.config;
    if (!notchHz) return value;
    const omega=2*Math.PI*notchHz/sampleRate,alpha=Math.sin(omega)/(2*notchQ),a0=1+alpha,c=Math.cos(omega);
    const [x1,x2,y1,y2]=this.notchState;
    const y=(value-2*c*x1+x2+2*c*y1-(1-alpha)*y2)/a0;
    this.notchState=[value,x1,y,y1];return y;
  }
  update(adc,timeMs,seq=null) {
    if (!Number.isFinite(adc)||adc<0||adc>1023||!Number.isFinite(timeMs)) throw new Error('Invalid EMG sample');
    const events=[],dt=this.lastTime===null?1000/this.config.sampleRate:timeMs-this.lastTime;
    if(dt<0)throw new Error('EMG time moved backwards; reset the processor');
    const gap=this.lastTime!==null&&dt>this.config.maxGapMs;
    if(gap){this.clearFilters();this.active=false;this.activePath=null;this.candidate=null;this.releaseCandidate=null;
      this.invalidUntil=timeMs+this.config.artifactRecoveryMs;if(this.calibration)this.calibration.gaps++;
      events.push({type:'signal_gap',timeMs,gapMs:dt});}
    this.lastTime=timeMs;
    const clipped=adc>=1020||adc<=1;
    if(clipped)this.invalidUntil=timeMs+this.config.artifactRecoveryMs;
    this.rawWindow.push(adc);if(this.rawWindow.length>this.config.medianSamples)this.rawWindow.shift();
    const median=quantile(this.rawWindow,.5),cleanInput=this.notch(median);
    const alpha=1-Math.exp(-2*Math.PI*this.config.lowpassHz*(gap?1000/this.config.sampleRate:dt)/1000);
    this.lp1=this.lp1===null?cleanInput:this.lp1+alpha*(cleanInput-this.lp1);
    this.lp2=this.lp2===null?this.lp1:this.lp2+alpha*(this.lp1-this.lp2);
    this.filtered=Math.max(0,Math.min(1023,this.lp2));
    this.trend=this.trend===null?this.filtered:this.trend+(1-Math.exp(-dt/this.config.trendTauMs))*(this.filtered-this.trend);
    const residual=this.filtered-this.trend,delta=this.previousClean===null?0:Math.abs(this.filtered-this.previousClean);
    this.previousClean=this.filtered;
    this.featureWindow.push({timeMs,residual,delta});
    while(this.featureWindow.length&&timeMs-this.featureWindow[0].timeMs>=this.config.windowMs)this.featureWindow.shift();
    const residualMean=this.featureWindow.reduce((s,p)=>s+p.residual,0)/this.featureWindow.length;
    const energy=Math.sqrt(this.featureWindow.reduce((s,p)=>s+(p.residual-residualMean)**2,0)/this.featureWindow.length);
    const rate=this.featureWindow.reduce((s,p)=>s+p.delta,0)/this.featureWindow.length;
    const quality=timeMs<this.invalidUntil?'artifact_recovery':'ok';
    let progress=0;
    if(this.calibration){
      const c=this.calibration;c.start??=timeMs;const elapsed=timeMs-c.start;progress=Math.min(1,elapsed/c.duration);
      c.n++;if(clipped)c.clipped++;
      if(elapsed>=c.settle){c.energy.push(energy);c.rate.push(rate);c.clean.push(this.filtered);}
      if(elapsed>=c.duration){
        const required=this.config.sampleRate*(c.duration-c.settle)/1000*.7;
        const failed=c.gaps||c.energy.length<required?'insufficient_continuous_samples':c.clipped>c.n*.01?'saturated_baseline':null;
        if(failed)events.push({type:'baseline_failed',timeMs,reason:failed});
        else{
          const e=limits(c.energy,this.config.minEnergy,this.config.sensitivity),r=limits(c.rate,this.config.minRate,this.config.sensitivity);
          const mean=c.clean.reduce((s,x)=>s+x,0)/c.clean.length;
          this.baseline={mean,sd:Math.sqrt(c.clean.reduce((s,x)=>s+(x-mean)**2,0)/c.clean.length),n:c.clean.length,durationMs:elapsed,energy:e,rate:r};
          this.threshold=e.on;this.offThreshold=e.off;this.rateThreshold=r.on;this.rateOffThreshold=r.off;
          this.amplitudeThreshold=mean+Math.max(3*this.baseline.sd,this.config.minAmplitude)*this.config.sensitivity;
          this.amplitudeOffThreshold=mean+Math.max(1.5*this.baseline.sd,this.config.minAmplitude/2)*this.config.sensitivity;
          this.baseline.amplitude={on:this.amplitudeThreshold,off:this.amplitudeOffThreshold};
          events.push({type:'baseline_ready',timeMs,baseline:{...this.baseline},threshold:this.threshold,rateThreshold:this.rateThreshold,amplitudeThreshold:this.amplitudeThreshold});
        }this.calibration=null;
      }
    }else if(this.baseline){
      if(quality!=='ok'){
        this.candidate=null;this.releaseCandidate=null;this.activePath=null;
        if(this.active){this.active=false;events.push({type:'release',onsetMs:timeMs,confirmedMs:timeMs,reason:'artifact'});}
      }else if(!this.active){
        const paths=(this.filtered>this.amplitudeThreshold?1:0) | (energy>this.threshold&&rate>this.rateThreshold?2:0);
        if(paths && timeMs-this.lastOnset>=this.config.refractoryMs){
          this.candidate??={timeMs,seq,paths};this.candidate.paths|=paths;
          if(timeMs-this.candidate.timeMs>=this.config.onHoldMs){
            this.active=true;this.lastOnset=this.candidate.timeMs;this.activePath=pathName(this.candidate.paths);
            events.push({type:'activation',onsetMs:this.candidate.timeMs,confirmedMs:timeMs,onsetSeq:this.candidate.seq,
              algorithm:this.config.algorithm,activationPath:this.activePath,amplitude:this.filtered,amplitudeThreshold:this.amplitudeThreshold,
              feature:energy,threshold:this.threshold,rate,rateThreshold:this.rateThreshold,windowMs:this.config.windowMs});
            this.candidate=null;
          }
        }else this.candidate=null;
      }else if(this.filtered<this.amplitudeOffThreshold && (energy<this.offThreshold||rate<this.rateOffThreshold)){
        this.releaseCandidate??=timeMs;
        if(timeMs-this.releaseCandidate>=this.config.offHoldMs){this.active=false;this.activePath=null;events.push({type:'release',onsetMs:this.releaseCandidate,confirmedMs:timeMs});this.releaseCandidate=null;}
      }else this.releaseCandidate=null;
    }
    return {adc,filtered:this.filtered,feature:energy,rate,threshold:this.threshold,rateThreshold:this.rateThreshold,quality,
      amplitudeThreshold:this.amplitudeThreshold,activationPath:this.activePath,
      active:this.active,calibrated:!!this.baseline,calibrating:!!this.calibration,progress,relativePercent:null,clipped,events};
  }
}
