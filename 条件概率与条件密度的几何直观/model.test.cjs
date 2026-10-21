const  {
  test
}
=require('node:test');
const assert=require('node:assert/strict');
const M=require('./model.js');
const C=require('./choreo.js');
const close=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const integrate=(f,a,b,n=20000)=> {
  let sum=0;
  for(let i=0;i<n;i++)sum+=f(a+(i+.5)*(b-a)/n);
  return sum*(b-a)/n;
}
;
for(const id of ['normal','triangle','ramp'])for(const dir of ['x','y'])test(`${id} ${dir}: normalization, mean and interval`,()=> {
  for(const c of id==='normal'?[-2.4,0,2.4]:[.05,.6,1.95]) {
    const s=M.slice(id,c,dir,.85);const lo=id==='normal'?-12:s.lo,hi=id==='normal'?12:s.hi;close(integrate(s.raw,lo,hi),s.area);close(integrate(s.pdf,lo,hi),1);close(integrate(u=>u*s.pdf(u),lo,hi),s.mean);close(s.probability(lo,hi),1);const a=Math.max(lo,.4),b=Math.min(hi,1.2);if(b>a)close(s.probability(a,b),integrate(s.pdf,a,b),3e-7);assert.equal(s.probability(2,1),0);
  }
}
);
test('zero marginal and clipped empty intervals',()=> {
  assert.equal(M.slice('triangle',2,'y').valid,false);assert.equal(M.slice('triangle',0,'x').probability(0,1),null);close(M.slice('triangle',.6,'y').probability(-3,3),1);close(M.slice('ramp',.8).probability(-3,-1),0);
}
);
test('normal CDF retains full distribution beyond plotted domain',()=> {
  close(M.slice('normal',2.4,'y',.85).probability(-12,12),1);close(M.cdf(0),.5,1e-7);
}
);
test('finite slab converges but differs at finite width',()=> {
  const args=['normal',1,'y',.8,-.5,.5];const exact=M.slice('normal',1,'y',.8).probability(-.5,.5);const thick=M.slab(...args,.5),thin=M.slab(...args,.001);assert.ok(Math.abs(thick.probability-exact)>1e-4);close(thin.probability,exact,1e-6);assert.equal(M.slab(...args,0),null);
}
);
test('choreography continuous, deterministic, ordered',()=> {
  for(const t of [1,2,3]) {
    const a=C.sample(t-1e-8),b=C.sample(t+1e-8);for(const k of ['focus','cut','extract','normalize','interval'])close(a[k],b[k]);
  }
  assert.equal(C.sample(1).extract,0);assert.equal(C.sample(2).normalize,0);assert.equal(C.sample(3).interval,0);assert.deepEqual(C.sample(2.6),C.sample(2.6));assert.equal(C.sample(4).receipt[3],1);
}
);
test('boundary captions remain visible when stepping',()=> {
  for(const t of [0,1,2,3,4])assert.equal(C.sample(t).textAlpha,1);for(const t of [1,2,3]) {
    assert.equal(C.sample(t-1e-8).textPhase,C.sample(t+1e-8).textPhase);close(C.sample(t-1e-8).textAlpha,C.sample(t+1e-8).textAlpha);
  }
}
);
