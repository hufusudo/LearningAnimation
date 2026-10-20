const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');
const exp = M.buildPartition('polyline', 'vortex', 12);
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);

test('every event end equals the next event beginning', () => {
  for (let step=0;step<exp.count*5-1;step++) {
    assert.deepEqual(C.sampleStep(exp,step,1), C.sampleStep(exp,step+1,0));
  }
});

test('seeking backward and replaying gives the same complete view', () => {
  const before=C.sample(exp,31.875);
  C.sample(exp,0);C.sample(exp,58);C.sample(exp,4.3);
  assert.deepEqual(C.sample(exp,31.875),before);
});

test('work only enters the ledger after the chip lands', () => {
  const index=2, step=index*5+4, s=exp.segments[index];
  for(const p of [0,.15,.5,.7,.72])near(C.sampleStep(exp,step,p).cumulative.work,s.before.work);
  const middle=C.sampleStep(exp,step,.86);
  near(middle.cumulative.work,(s.before.work+s.after.work)/2);
  near(C.sampleStep(exp,step,1).cumulative.work,s.after.work);
});

test('projections appear separately before the sum', () => {
  let v=C.sampleStep(exp,1,.5).details.at(-1);
  assert.ok(v.x>0&&v.x<1);assert.equal(v.y,0);assert.equal(v.result,0);
  v=C.sampleStep(exp,2,.5).details.at(-1);
  assert.equal(v.x,1);assert.ok(v.y>0&&v.y<1);assert.equal(v.result,0);
  v=C.sampleStep(exp,3,.5).details.at(-1);
  assert.equal(v.x,1);assert.equal(v.y,1);assert.ok(v.result>0&&v.result<1);
});

test('the particle travels continuously between adjacent directed chords', () => {
  for(let i=0;i<exp.count-1;i++) {
    const end=C.sampleStep(exp,i*5+4,1).marker;
    near(end.x,exp.segments[i].end.x);near(end.y,exp.segments[i].end.y);
  }
  const first=C.sample(exp,0),last=C.sample(exp,C.duration(exp));
  assert.deepEqual(first.marker,exp.segments[0].start);
  near(last.marker.x,exp.segments.at(-1).end.x);near(last.marker.y,exp.segments.at(-1).end.y);
  near(last.cumulative.work,exp.total.work);assert.equal(last.completed,exp.count);
});

test('finite values and cumulative continuity across every phase boundary', () => {
  for(let step=1;step<exp.count*5;step++) {
    const time=C.boundary(step), a=C.sample(exp,time-1e-7),b=C.sample(exp,time+1e-7);
    assert.ok(Math.hypot(a.marker.x-b.marker.x,a.marker.y-b.marker.y)<1e-5);
    assert.ok(Math.abs(a.cumulative.work-b.cumulative.work)<1e-5);
    assert.ok(Number.isFinite(b.cumulative.work));
  }
});


test('completed count updates on every exact segment boundary', () => {
  for(let i=1;i<=exp.count;i++) {
    const v=C.sample(exp,C.boundary(i*5));
    assert.equal(v.completed,i);
    near(v.cumulative.work,exp.segments[i-1].after.work);
  }
});
