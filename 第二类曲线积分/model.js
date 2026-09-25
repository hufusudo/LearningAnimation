(function (root) {
  'use strict';
  const PI = Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function pointAt(t) { return {x: -2 + 4*t, y: .72*Math.sin(PI*t)}; }
  function forceAt(x, y, field = 'assist') {
    return field === 'mixed' ? {P: .3 + .1*y, Q: 1.8 + .15*x} :
      {P: 1 + .16*y, Q: .55*Math.cos(PI*(x+2)/4)};
  }
  function workTo(t, field = 'assist') {
    if (field === 'mixed') return {
      x: 1.2*t + .288/PI*(1-Math.cos(PI*t)),
      y: .72*((1.5+.6*t)*Math.sin(PI*t)+.6/PI*(Math.cos(PI*t)-1))
    };
    return {x: 4*t+.4608/PI*(1-Math.cos(PI*t)), y:.198*PI*t+.099*Math.sin(2*PI*t)};
  }
  const arc = [0];
  for (let i=1;i<=1000;i++) {
    const a=pointAt((i-1)/1000), b=pointAt(i/1000);
    arc.push(arc[i-1]+Math.hypot(b.x-a.x,b.y-a.y));
  }
  function arcAt(t) {
    const k=clamp(t,0,1)*1000, i=Math.min(999,Math.floor(k));
    return arc[i]+(arc[i+1]-arc[i])*(k-i);
  }
  function parameterAtArcFraction(fraction) {
    const target=clamp(fraction,0,1)*arc[1000];
    let lo=0, hi=1000;
    while(lo<hi) { const m=(lo+hi)>>1; if(arc[m]<target) lo=m+1; else hi=m; }
    if(!lo) return 0;
    return (lo-1+(target-arc[lo-1])/(arc[lo]-arc[lo-1]))/1000;
  }
  function partition(n, field='assist', reverse=false) {
    const segments=[];
    for(let i=0;i<n;i++) {
      const a=i/n,b=(i+1)/n, mid=pointAt((a+b)/2);
      const p0=pointAt(reverse?b:a),p1=pointAt(reverse?a:b);
      const f=forceAt(mid.x,mid.y,field),dx=p1.x-p0.x,dy=p1.y-p0.y;
      const length=Math.hypot(dx,dy),wx=f.P*dx,wy=f.Q*dy;
      segments.push({index:i,a,b,p0,p1,mid,P:f.P,Q:f.Q,dx,dy,length,
        arc:arcAt(b)-arcAt(a),wx,wy,work:wx+wy,along:(wx+wy)/length});
    }
    return reverse?segments.reverse():segments;
  }
  function accumulation(segments, progress) {
    const length=segments.reduce((s,d)=>s+d.length,0),target=clamp(progress,0,1)*length;
    let passed=0,x=0,y=0,index=0,fraction=0;
    for(let i=0;i<segments.length;i++) {
      const d=segments[i], amount=clamp((target-passed)/d.length,0,1);
      x+=d.wx*amount;y+=d.wy*amount;
      if(target>=passed) {index=i;fraction=amount;}
      passed+=d.length;
    }
    return {x,y,work:x+y,index,fraction,length};
  }
  const api={pointAt,forceAt,workTo,partition,accumulation,arcAt,parameterAtArcFraction};
  root.LineIntegralModel=api;
  if(typeof module !== 'undefined' && module.exports) module.exports=api;
})(typeof window === 'undefined' ? globalThis : window);
