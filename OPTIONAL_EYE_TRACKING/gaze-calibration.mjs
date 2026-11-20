// Observe tracking readiness without changing WebGazer or retaining eye images.
export function watchEyeFrames(tracker, onFrame) {
  if (typeof tracker?.getEyePatches !== 'function') throw new Error('The eye tracker does not expose eye features. Reload the page and retry.');
  const original = tracker.getEyePatches;
  const wrapped = async function (...args) {
    try {
      const patches = await original.apply(this, args);
      onFrame(!!patches && ['left','right'].every(side => patches[side]?.width > 0 && patches[side]?.height > 0));
      return patches;
    } catch (error) { onFrame(false); throw error; }
  };
  tracker.getEyePatches = wrapped;
  return () => { if (tracker.getEyePatches === wrapped) tracker.getEyePatches = original; };
}

export function trainingFrameReady(frame, lastFrameId, now) {
  return !!frame?.tracked && frame.id !== lastFrameId && Number.isFinite(frame.at) && now >= frame.at && now-frame.at <= 1000;
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a,b)=>a-b), middle = Math.floor(ordered.length/2);
  return ordered.length%2 ? ordered[middle] : (ordered[middle-1]+ordered[middle])/2;
}
export const VALIDATION_RULES = Object.freeze({settleMs:350,minDurationMs:1600,maxDurationMs:4000,minSamples:5});
export class ValidationWindow {
  constructor(point, viewport, start) { this.point=point; this.viewport=viewport; this.start=start; this.errors=[]; }
  add(data, now) {
    if (now-this.start <= VALIDATION_RULES.settleMs || now-this.start > VALIDATION_RULES.maxDurationMs || data.tracked !== true || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
    // Off-screen predictions are accuracy errors, not missing samples.
    this.errors.push(Math.hypot(data.x-this.point[0]*this.viewport.width,data.y-this.point[1]*this.viewport.height));
  }
  inspect(now) {
    const elapsed=now-this.start, count=this.errors.length;
    return {done:elapsed>=VALIDATION_RULES.minDurationMs && (count>=VALIDATION_RULES.minSamples || elapsed>=VALIDATION_RULES.maxDurationMs),
      sample_count:count,median_error_px:count>=VALIDATION_RULES.minSamples ? median(this.errors) : null,elapsed_ms:elapsed};
  }
}
export function validationReport(points, viewport, validatedAt=new Date().toISOString()) {
  const enough=points.length===5 && points.every(p=>p.sample_count>=VALIDATION_RULES.minSamples && Number.isFinite(p.median_error_px));
  const error=enough?median(points.map(p=>p.median_error_px)):null, limit=Math.min(120,.12*Math.min(viewport.width,viewport.height));
  const passed=enough && error<=limit;
  return {passed,reason:!enough?'insufficient_samples':passed?'passed':'accuracy',median_error_px:error,
    point_errors_px:points.map(p=>p.median_error_px),point_sample_counts:points.map(p=>p.sample_count),
    acceptance_limit_px:limit,rules:VALIDATION_RULES,viewport,validated_at:validatedAt};
}
export function validationMessage(result) {
  const counts=result.point_sample_counts.join(', '), limit=result.acceptance_limit_px.toFixed(0);
  if(result.passed)return `Validation passed: median error ${result.median_error_px.toFixed(0)} px (limit ${limit} px). Eye samples per point: ${counts}.`;
  if(result.reason==='insufficient_samples')return `Validation needs more tracked eye samples: ${counts} (at least 5 per point). Face the camera with both eyes visible, improve lighting, and recalibrate. Each point already waits up to 4 seconds.`;
  return `Validation accuracy failed: median error ${result.median_error_px.toFixed(0)} px, limit ${limit} px. Eye samples per point: ${counts}. Keep your head still, look at each dot before clicking, and recalibrate.`;
}
