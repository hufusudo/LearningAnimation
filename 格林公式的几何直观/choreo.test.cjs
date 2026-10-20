const test = require('node:test');
const assert = require('node:assert/strict');
require('./model.js'); require('./choreo.js');
const M = globalThis.GreenModel, C = globalThis.GreenChoreo;
function visual(s) {
  return [s.visible, s.cancel, s.boundary, s.formula, ...Object.values(s.panels), s.focus, s.tokenAlpha];
}
for (const n of [3, 6, 9]) {
  const g = M.makeTiling(n), seq = C.sequence(g);
  test(`${n}列：步骤几何连续，倒退不依赖历史，外圈从不移动`, () => {
    for (const step of seq.steps.slice(1)) {
      const a = visual(C.sample(g, seq, step.start - 1e-8));
      const b = visual(C.sample(g, seq, step.start));
      const va = a.flat(), vb = b.flat();
      va.forEach((v, i) => assert.ok(Math.abs(v - vb[i]) < 1e-6, `${step.name} ${i} ${v}/${vb[i]}`));
    }
    const before = C.sample(g, seq, 14);
    C.sample(g, seq, seq.total); C.sample(g, seq, 0);
    assert.deepEqual(C.sample(g, seq, 14), before);
    const initial = C.sample(g, seq, 0), end = C.sample(g, seq, seq.total);
    assert.equal(initial.visible[0], 1); assert.equal(initial.cancelled, 0);
    assert.equal(end.cancelled, g.internal.length); assert.equal(end.formula, 1);
    // 模型的外边在采样中没有被修改，也没有被混入内部抵消。
    assert.equal(g.boundary.length, 2 * (g.n + g.m));
    end.cancel.forEach(v => assert.equal(v, 1));
  });
  test(`${n}列：逐对抵消一次只有一对处于过渡，可单步到每对完成`, () => {
    const start = seq.steps[4].start, finish = seq.steps[4].end;
    let lastCount = 1;
    for (let t = start; t <= finish; t += .041) {
      const s = C.sample(g, seq, t);
      assert.ok(s.cancel.filter(x => x > 0 && x < 1).length <= 1);
      assert.ok(s.cancelled >= lastCount); lastCount = s.cancelled;
    }
    for (let i = 1; i < g.internal.length; i++) {
      const event = seq.cancellations[i - 1];
      const time = start + event.start + .94 * event.duration;
      assert.equal(C.sample(g, seq, time).cancelled, i + 1);
    }
  });
  test(`${n}列：减少动效保持全部教学状态`, () => {
    seq.steps.forEach(step => {
      const s = C.sample(g, seq, step.start, true);
      assert.equal(s.p, 1);
      assert.ok(Object.values(s.panels).some(v => v === 1), step.name + " 需有静态解释");
      s.visible.forEach(v => assert.ok(v === 0 || v === 1));
    });
    assert.equal(C.sample(g, seq, seq.total, true).cancelled, g.internal.length);
    const start = seq.steps[4].start;
    assert.equal(C.sample(g, seq, start, true).cancelled, 1);
    for (let i = 1; i < g.internal.length; i++) {
      assert.equal(C.sample(g, seq, start + seq.cancellations[i - 1].start + .94 * seq.cancellations[i - 1].duration, true).cancelled, i + 1);
    }
  });
}

test('逐对阶段最多慢放10次，其余在2.4秒内连续快速扫过', () => {
  for (const n of [3, 6, 9]) {
    const g = M.makeTiling(n), seq = C.sequence(g), step = seq.steps[4];
    assert.equal(seq.cancellations.filter(e => !e.fast).length, Math.min(10, g.internal.length - 1));
    seq.cancellations.filter(e => !e.fast).forEach(e => assert.equal(e.duration, 2.4));
    assert.ok(step.duration <= 26.4);
    if (g.internal.length > 11) {
      assert.equal(seq.fastDuration, 2.4);
      const midpoint = C.sample(g, seq, step.start + seq.detailedDuration + 1.2);
      assert.equal(midpoint.fast, true);
      assert.equal(midpoint.focus, 0, '快速段不反复闪动单条边提示');
      assert.ok(midpoint.cancelled > 11);
      const before = C.sample(g, seq, step.start + seq.detailedDuration - 1e-8);
      const after = C.sample(g, seq, step.start + seq.detailedDuration);
      visual(before).flat().forEach((v,i) => assert.ok(Math.abs(v - visual(after).flat()[i]) < 1e-6));
    }
    assert.equal(C.sample(g, seq, step.end).cancelled, g.internal.length);
  }
});
