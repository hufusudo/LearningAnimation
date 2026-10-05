const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('./model.js');
const close=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,a+' ≠ '+b);
test('upward water: positive along upward normal, zero edge-on, reversed sign on orientation flip',()=>{
  close(M.planeFlux(0),2.352); close(M.planeFlux(Math.PI/2),0);
  close(M.planeFlux(Math.PI),-2.352); close(M.planeFlux(0,-1),-2.352);
});
test('true projected polygon areas equal the signed area vector components',()=>{
  for(const type of ['paraboloid','plane','hemisphere']) {
    const patch=M.patch(type);
    [[1,2],[2,0],[0,1]].forEach(([a,b],axis)=>{
      const area=patch.vertices.reduce((sum,v,i)=>{
        const next=patch.vertices[(i+1)%4]; return sum+v[a]*next[b]-next[a]*v[b];
      },0)/2;
      close(area,patch.areaVector[axis]); close(patch.normal[axis]*patch.area,patch.areaVector[axis]);
    });
    const values=M.components(patch.areaVector); close(values.net,values.p+values.q+values.r);
    close(M.components(M.patch(type,0.45,0.45,0.5,0.5,-1).areaVector).net,-values.net);
  }
});
test('whole-surface sums match analytic plane and paraboloid flux',()=>{
  for(const n of [4,8,32]) {
    close(M.total('plane',n).net,2.2); close(M.total('paraboloid',n).net,2.37);
    close(M.total('paraboloid',n,-1).net,-2.37);
  }
});
test('sphere sums converge under refinement',()=>{
  const finer=M.total('hemisphere',256).net;
  close(M.total('hemisphere',128).net,finer,0.0001);
  assert.ok(Math.abs(M.total('hemisphere',8).net-finer)<0.01);
});
