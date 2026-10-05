(function (root) {
  'use strict';
  const FIELD = Object.freeze({ p:1, q:1, r:1.2 });
  const DOMAIN = Object.freeze({ min:0.15, max:1.15 });
  function surface(x,y,type) {
    if (type === 'plane') return { z:1.9-0.5*x-0.5*y, fx:-0.5, fy:-0.5 };
    if (type === 'hemisphere') { const z=Math.sqrt(3.2-x*x-y*y); return { z:z, fx:-x/z, fy:-y/z }; }
    return { z:1.8-0.45*(x*x+y*y), fx:-0.9*x, fy:-0.9*y };
  }
  function patch(type,x0=0.45,y0=0.45,dx=0.5,dy=0.5,side=1) {
    const cx=x0+dx/2, cy=y0+dy/2, at=surface(cx,cy,type);
    const vertices=[[x0,y0],[x0+dx,y0],[x0+dx,y0+dy],[x0,y0+dy]].map(v=>[v[0],v[1],at.z+at.fx*(v[0]-cx)+at.fy*(v[1]-cy)]);
    const areaVector=[-at.fx*dx*dy*side,-at.fy*dx*dy*side,dx*dy*side];
    const area=Math.hypot(...areaVector);
    return { vertices, center:[cx,cy,at.z], areaVector, area, normal:areaVector.map(v=>v/area) };
  }
  function components(areaVector,field=FIELD) {
    const p=field.p*areaVector[0],q=field.q*areaVector[1],r=field.r*areaVector[2];
    return { p,q,r,net:p+q+r };
  }
  function planeFlux(theta,side=1) { return FIELD.r*1.4*1.4*Math.cos(theta)*side; }
  function cells(type,count=8,side=1,field=FIELD) {
    const width=(DOMAIN.max-DOMAIN.min)/count,result=[];
    for(let j=0;j<count;j++) for(let k=0;k<count;k++) {
      const i=j%2?count-1-k:k, x=DOMAIN.min+i*width,y=DOMAIN.min+j*width;
      const at=surface(x+width/2,y+width/2,type);
      result.push({ x,y,width,values:components([-at.fx*width*width*side,-at.fy*width*width*side,width*width*side],field) });
    }
    return result;
  }
  function total(type,count=8,side=1) {
    return cells(type,count,side).reduce((sum,cell)=> {
      for(const key of ['p','q','r','net']) sum[key]+=cell.values[key]; return sum;
    },{p:0,q:0,r:0,net:0});
  }
  const model=Object.freeze({FIELD,DOMAIN,surface,patch,components,planeFlux,cells,total});
  if(typeof module!=='undefined'&&module.exports) module.exports=model; else root.SurfaceFluxModel=model;
})(typeof window!=='undefined'?window:globalThis);
