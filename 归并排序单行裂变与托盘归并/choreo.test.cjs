const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

for (const values of [undefined, [3,2,3,1,2,1,3,1], [8,7,6,5,4,3,2,1], [1], [5,4,3,2,1]]) {
  test(`all visual boundaries are canonical: ${values || 'default'}`, () => {
    const seq = M.build(values);
    for (let i=0;i<seq.events.length;i++) {
      const e=seq.events[i];
      assert.deepEqual(C.sampleEvent(e,seq.cards,0),C.scene(e.before,seq.cards));
      assert.deepEqual(C.sampleEvent(e,seq.cards,1),C.scene(e.after,seq.cards));
      if(i) assert.deepEqual(C.sampleEvent(seq.events[i-1],seq.cards,1),C.sampleEvent(e,seq.cards,0));
      for(const p of [.001,.12,.3,.5,.73,.85,.999]) {
        const v=C.sampleEvent(e,seq.cards,p);
        v.cards.forEach(c=>{
          assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
          assert.ok(c.x>=0 && c.x+C.CW<=C.W);
          assert.ok(c.y>=0 && c.y+C.CH<=C.H);
        });
        assert.deepEqual(v,C.sampleEvent(e,seq.cards,p));
      }
    }
  });
}

test('one identity flies linearly, guide comes first, pointer and counts follow landing', () => {
  const seq=M.build(),e=seq.events.find(e=>e.kind==='take');
  const start=C.sampleEvent(e,seq.cards,0),guide=C.sampleEvent(e,seq.cards,.15),middle=C.sampleEvent(e,seq.cards,.47),land=C.sampleEvent(e,seq.cards,.73),end=C.sampleEvent(e,seq.cards,1);
  const id=e.card;
  assert.equal(guide.cards[id].y,start.cards[id].y);
  assert.ok(guide.effect.guideAlpha>0);
  assert.equal(middle.cards[id].y,(start.cards[id].y+end.cards[id].y)/2);
  assert.equal(land.cards[id].y,end.cards[id].y);
  assert.deepEqual(land.stats,start.stats);
  assert.deepEqual(land.pointers,start.pointers);
  seq.cards.filter(c=>c.id!==id).forEach(c=>{
    assert.equal(middle.cards[c.id].x,start.cards[c.id].x);
    assert.equal(middle.cards[c.id].y,start.cards[c.id].y);
  });
});

test('comparison does not move data; lift and gap closure are separate', () => {
  const seq=M.build();
  for(const e of seq.events) {
    const a=C.scene(e.before,seq.cards),b=C.scene(e.after,seq.cards);
    if(e.kind==='compare') assert.deepEqual(a.cards.map(c=>[c.x,c.y]),b.cards.map(c=>[c.x,c.y]));
    if(e.kind==='lift') a.cards.forEach((c,i)=>assert.equal(c.x,b.cards[i].x));
    if(e.kind==='close') a.cards.forEach((c,i)=>assert.equal(c.y,b.cards[i].y));
  }
});

test('time sampling is seek-order independent and clamps bounds',()=>{
  const seq=M.build();
  const times=[0,seq.duration*.91,seq.duration*.2,seq.duration,seq.duration*.4];
  const snapshots=times.map(t=>C.sample(seq,t));
  times.reverse().forEach(t=>assert.deepEqual(C.sample(seq,t),snapshots.find(s=>s.t===t)));
  assert.deepEqual(C.sample(seq,-10).view,C.scene(seq.initial,seq.cards));
  assert.deepEqual(C.sample(seq,Infinity).view,C.scene(seq.initial,seq.cards));
  assert.deepEqual(C.sample(seq,seq.duration+10).view,C.scene(seq.events.at(-1).after,seq.cards));
});
