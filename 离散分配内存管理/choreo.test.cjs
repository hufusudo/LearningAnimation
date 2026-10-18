const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

const scns = M.MODE_KEYS.map((key) => M.build(key));
const JUST_BEFORE_END = 1 - 1e-9;

test('边界无跳变：上一步终点的画面等于下一步起点的画面', () => {
  for (const scn of scns) {
    for (let i = 0; i + 1 < scn.steps.length; i++) {
      const s = scn.steps[i];
      const n = scn.steps[i + 1];
      const end = C.snapshot(C.viewAt(scn, s.start + s.dur * JUST_BEFORE_END));
      const next = C.snapshot(C.viewAt(scn, n.start));
      assert.deepEqual(end, next, `${scn.key} 第 ${i} 步与第 ${i + 1} 步之间跳变`);
    }
  }
});

test('飞行芯片只在步内出现：步首与步末都不残留', () => {
  for (const scn of scns) {
    for (const s of scn.steps) {
      for (const t of [s.start, s.start + s.dur * JUST_BEFORE_END]) {
        const v = C.viewAt(scn, t);
        assert.ok(v.chips.every((c) => c.alpha < 1e-6), `${scn.key} 第 ${s.index} 步边界有残留芯片`);
      }
    }
  }
});

test('每个状态变化先有引导：建表、写表项、装入时外环先亮', () => {
  for (const scn of scns) {
    for (const s of scn.steps) {
      if (!['table', 'write', 'load'].includes(s.kind)) continue;
      const v = C.viewAt(scn, s.start + s.dur * 0.2);
      const top = Math.max(0, ...v.rings.map((r) => r.alpha));
      assert.ok(top > 0.8, `${scn.key} 第 ${s.index} 步（${s.action}）引导不明显`);
    }
  }
});

test('减少动效：每步直接到步末画面', () => {
  for (const scn of scns) {
    for (const s of scn.steps) {
      const reduced = C.snapshot(C.viewAt(scn, s.start, { reduce: true }));
      const end = C.snapshot(C.viewAt(scn, s.start + s.dur * JUST_BEFORE_END));
      assert.deepEqual(reduced, end, `${scn.key} 第 ${s.index} 步减少动效时画面不对`);
    }
  }
});

test('最后一步的画面等于最终状态：页框归属、公式结果与访存次数', () => {
  for (const scn of scns) {
    const v = C.viewAt(scn, scn.total);
    const fin = scn.steps[scn.steps.length - 1].after;
    if (scn.key !== 'seg') {
      const shown = v.frames.map((f) => (f.top && f.topAlpha >= 0.5 ? f.top : f.base).label);
      assert.deepEqual(shown, fin.frames.map((o) => C.ownerInfo(o).label), scn.key);
    } else {
      assert.equal(v.frags.length, 2, '分段结束时应标出两块碎片');
    }
    assert.equal(v.formula.res.text, `= ${C.hex(scn.result.pa)}`, scn.key);
    assert.equal(v.formula.res.alpha, 1, scn.key);
    assert.equal(v.formula.count, `访存 ${scn.memTotal}/${scn.memTotal}`, scn.key);
  }
});

test('步界上的时刻（含浮点误差）归入后一步，“下一步”不会原地踏步', () => {
  for (const scn of scns) {
    scn.steps.forEach((s, k) => {
      if (k === 0) return;
      for (const d of [0, -1e-12, 1e-12]) {
        assert.equal(C.locate(scn, s.start + d).i, k, `${scn.key} 第 ${k} 步起点（偏移 ${d}）归错了步`);
      }
    });
  }
});

test('时刻到步的映射：起点、终点单调，任意时刻可拖动', () => {
  for (const scn of scns) {
    assert.equal(C.locate(scn, 0).i, 0);
    const end = C.locate(scn, scn.total);
    assert.equal(end.i, scn.steps.length - 1);
    assert.equal(end.p, 1);
    let last = -1;
    for (let t = 0; t <= scn.total; t += 0.05) {
      const { i, p } = C.locate(scn, t);
      assert.ok(i >= last, `${scn.key} 时刻 ${t.toFixed(2)} 倒退到了更早的步`);
      assert.ok(p >= 0 && p <= 1);
      last = i;
    }
  }
});
