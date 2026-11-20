export function chartBounds(history,fullScale=false) {
  if(fullScale)return [0,1023];
  let low=Infinity,high=-Infinity;
  for(const point of history)for(const value of point.slice(1,4))if(Number.isFinite(value)){low=Math.min(low,value);high=Math.max(high,value);}
  if(!Number.isFinite(low))return [0,1023];
  const padding=Math.max(5,(high-low)*.15),span=Math.min(1023,Math.max(20,high-low+padding*2)),center=(high+low)/2;
  const bottom=Math.max(0,Math.min(1023-span,center-span/2));
  return [bottom,Math.min(1023,bottom+span)];
}
export function drawSignal(canvas,history,{now,fullScale=false,showRaw=true,label='ADC counts'}={}) {
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,left=64,right=w-16,top=26,bottom=h-36;
  const start=now-8000,visible=history.filter(p=>p[0]>=start).map(p=>showRaw?p:[p[0],null,p[2],p[3]]),[min,max]=chartBounds(visible,fullScale);
  ctx.clearRect(0,0,w,h);ctx.font='17px Segoe UI, sans-serif';ctx.fillStyle='#536656';ctx.fillText(label,left,18);
  for(let i=0;i<=4;i++){
    const y=top+(bottom-top)*i/4;ctx.strokeStyle='#e4ebe2';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
    ctx.fillText((max-(max-min)*i/4).toFixed(0),8,y+5);
  }
  ctx.fillText('-8 s',left,h-9);ctx.fillText('now',right-34,h-9);
  if(!visible.length){ctx.fillStyle='#617663';ctx.fillText('Waiting for Arduino samples',left+25,(top+bottom)/2);return;}
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  for(const [index,color] of [[1,'#6f94b8'],[2,'#255c48'],[3,'#bd7431']]){
    ctx.strokeStyle=color;ctx.lineWidth=index===2?2.4:1.5;ctx.beginPath();let begun=false;
    for(const p of visible){if(!Number.isFinite(p[index]))continue;const x=left+(p[0]-start)/8000*(right-left),y=bottom-(p[index]-min)/(max-min)*(bottom-top);if(!begun){ctx.moveTo(x,y);begun=true;}else ctx.lineTo(x,y);}ctx.stroke();
  }
  ctx.restore();
}
