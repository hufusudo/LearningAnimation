const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('./choreo.js'),M=require('./model.js');
const visual=v=>Object.fromEntries(Object.entries(v).filter(([k])=>!['step','progress','time'].includes(k)));
function near(a,b){for(const k of Object.keys(a))assert.ok(Math.abs(a[k]-b[k])<1e-9,`${k}: ${a[k]} != ${b[k]}`);}
test('every adjacent step shares exactly the same visual boundary',()=>{
  for(const key of Object.keys(M.models))for(const epsilon of [.16,.7,1.2]){
    const params={key,epsilon};
    for(let i=0;i<7;i++)near(visual(C.stepView(params,i,1)),visual(C.stepView(params,i+1,0)));
  }
});
test('seeking is deterministic and the reduced epsilon retains an analytic tail guarantee',()=>{
  for(const key of Object.keys(M.models)){
    const params={key,epsilon:.7},original=C.sample(params,14.4);
    C.sample(params,17);C.sample(params,1);assert.deepEqual(C.sample(params,14.4),original);
    const end=C.sample(params,18);assert.equal(end.epsilon,.35);assert.equal(end.threshold,M.threshold(key,.35));assert.equal(end.safe,1);assert.ok(end.probe>end.threshold);
    assert.equal(C.sample(params,-5).time,0);assert.equal(C.sample(params,99).time,18);
  }
});
test('the old guarantee is withdrawn before epsilon shrinks and the new one waits for the threshold',()=>{
  const params={key:'c-damped-sin',epsilon:.7};
  assert.equal(C.sample(params,9.32).safe,0);
  for(let t=9.4;t<12.4;t+=.08){const v=C.sample(params,t);assert.ok(v.safe<.999);}
  const v=C.sample(params,12.99);assert.equal(v.safe,1);assert.equal(v.threshold,M.threshold(params.key,.35));
});
