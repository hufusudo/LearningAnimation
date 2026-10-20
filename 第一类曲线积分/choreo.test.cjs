const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('./choreo.js');
for(const N of [4,8,10,11,128]) {
  const seq=C.build(N);
  test(`N=${N}: all action boundaries are visually continuous`,()=>{
    const numeric=['density','split','extract','triangle','differential','mass','result','textAlpha','tagAlpha','guide','focus'];
    for(const t of seq.boundaries.slice(1,-1)) {
      const a=C.sample(seq,t-1e-8).view,b=C.sample(seq,t+1e-8).view;
      for(const k of numeric)assert.ok(Math.abs(a[k]-b[k])<1e-5,`${t}: ${k} ${a[k]} ${b[k]}`);
      a.fills.forEach((x,i)=>assert.ok(Math.abs(x-b.fills[i])<1e-5,`${t} fill ${i}`));
    }
  });
  test(`N=${N}: rewind and final sum preserve mass accounting`,()=>{
    const times=[0,2.1,seq.starts[6]+.4,seq.duration,4.1,seq.starts[6]+1.14];
    const frames=times.map(t=>C.sample(seq,t));
    times.forEach((t,i)=>assert.deepEqual(C.sample(seq,t),frames[i]));
    assert.ok(C.sample(seq,0).view.fills.every(v=>v===0));
    assert.ok(C.sample(seq,seq.duration).view.fills.every(v=>v===1));
    for(let j=0;j<Math.min(N,10);j++) {
      const v=C.sample(seq,seq.starts[6]+(j+.69)*.65).view;
      assert.equal(v.fills[j],0,'mass is added only after flight arrival');
    }
  });
}

test('超过十段时仅前十段逐段飞行，余段共用快速扫过与单步边界',()=>{
  for(const N of [11,16,64,128]) {
    const seq=C.build(N), start=seq.starts[6], sweepStart=start+10*.65;
    assert.ok(Math.abs(seq.starts[7]-sweepStart-1.2)<1e-10);
    assert.equal(seq.boundaries.filter(t=>t>start&&t<seq.starts[7]).length,10);
    const before=C.sample(seq,sweepStart).view;
    assert.ok(before.fills.slice(0,10).every(v=>v===1));
    assert.ok(before.fills.slice(10).every(v=>v===0));
    let previous=before.fills;
    for(let i=1;i<=120;i++) {
      const t=sweepStart+1.2*i/120, v=C.sample(seq,t).view;
      assert.equal(v.moving,false);
      assert.equal(v.flight,0);
      v.fills.forEach((fill,j)=>assert.ok(fill>=previous[j]&&fill>=0&&fill<=1));
      previous=v.fills;
    }
    assert.ok(previous.every(v=>v===1));
    const middle=C.sample(seq,sweepStart+.6).view;
    assert.ok(middle.fills.slice(10).some(v=>v>0));
    assert.ok(middle.fills.slice(10).some(v=>v<1));
    assert.deepEqual(C.sample(seq,sweepStart).view,before,'rewind restores sweep start');
  }
});

test('十段及以下保留完整逐段累加时长',()=>{
  for(const N of [4,8,10]) {
    const seq=C.build(N);
    assert.ok(Math.abs(seq.starts[7]-seq.starts[6]-N*.65)<1e-10);
    assert.equal(seq.sweepDuration,0);
    assert.equal(seq.boundaries.filter(t=>t>seq.starts[6]&&t<seq.starts[7]).length,N-1);
  }
});
