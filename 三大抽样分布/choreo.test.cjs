const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('./choreo.js');

test('几何与区域权重在教学阶段边界连续',()=>{
  const keys=['tailLevel','move','focus','rightReveal','leftReveal','leftWeight','rightWeight'];
  for(const alpha of [.01,.05,.1])for(const t of C.boundaries.slice(1)){
    const before=C.sample(t-1e-8,alpha),after=C.sample(t,alpha);
    for(const key of keys)assert.ok(Math.abs(before[key]-after[key])<1e-6,`${t} ${key}`);
  }
});
test('同点互补不移动分位点，换点才改变右尾概率',()=>{
  assert.equal(C.sample(4.5,.05).tailLevel,.05);
  assert.equal(C.sample(7,.05).tailLevel,.05);
  assert.ok(Math.abs(C.sample(10,.05).tailLevel-.95)<1e-12);
  assert.equal(C.sample(6.5,.05).leftWeight,1);
  assert.equal(C.sample(12.3,.05).rightWeight,1);
  assert.equal(C.sample(15,.05).leftWeight,1);
});
test('任意时刻都能确定重绘且显示权重保持合法',()=>{
  for(let i=0;i<=300;i++){
    const t=i/20,f=C.sample(t,.01);
    assert.deepEqual(f,C.sample(t,.01));
    for(const key of ['leftWeight','rightWeight','move'])assert.ok(f[key]>=-1e-10&&f[key]<=1+1e-10,key);
    assert.ok(Math.abs((1-f.tailLevel)+f.tailLevel-1)<1e-14);
  }
});

test('阶段停靠点均为可独立阅读的完成态',()=>{
  const frames=C.stops.map(t=>C.sample(t,.05));
  assert.deepEqual(frames.map(f=>f.phase),[0,1,2,3,4,5]);
  assert.equal(frames[0].focus,1);
  assert.equal(frames[1].rightWeight,1);assert.equal(frames[1].rightReveal,1);
  assert.equal(frames[2].leftWeight,1);assert.equal(frames[2].leftReveal,1);
  assert.equal(frames[3].move,1);assert.equal(frames[3].leftWeight,1);
  assert.equal(frames[4].rightWeight,1);assert.equal(frames[5].leftWeight,1);
});
