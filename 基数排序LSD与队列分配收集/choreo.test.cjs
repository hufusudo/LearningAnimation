'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');
const datasets = [...Object.values(M.PRESETS), Array(8).fill(0), Array(8).fill(999), [999, 0, 42, 0, 42, 999, 1, 10]];

test('每步终点严格等于下一步起点，包括数位、队头、计数与解说', () => {
  for (const data of datasets) {
    const seq = M.build(data);
    for (let i = 0; i < seq.steps.length - 1; i++) assert.deepEqual(C.view(seq, i, 1), C.view(seq, i + 1, 0));
    assert.deepEqual(C.sample(seq, -10), C.view(seq, 0, 0));
    assert.deepEqual(C.sample(seq, 999), C.view(seq, 54, 1));
  }
});

test('采样可倒退复现，每个时刻身份守恒、坐标有限、不越界', () => {
  for (const data of datasets) {
    const seq = M.build(data);
    for (let t = 0; t <= 55; t += .125) {
      const frame = C.sample(seq, t);
      assert.equal(frame.cards.length, 8);
      assert.equal(new Set(frame.cards.map(c => c.id)).size, 8);
      for (const c of frame.cards) {
        assert.ok(c.x >= 39 && c.x <= 1060 && c.y >= 15 && c.y <= 570);
        assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
      }
      C.sample(seq, Math.max(0, t - 5));
      assert.deepEqual(C.sample(seq, t), frame);
    }
  }
});

test('引导先于移动，移动结束后计数与回执才出现，每步仅一个卡片移动', () => {
  const seq = M.build(M.PRESETS.conflict);
  seq.steps.forEach((step, index) => {
    if (!['distribute', 'collect'].includes(step.kind)) return;
    const initial = C.view(seq, index, 0);
    const guide = C.view(seq, index, .15);
    assert.ok(guide.cards[step.item].focus > 0);
    assert.deepEqual([guide.cards[step.item].x, guide.cards[step.item].y], [initial.cards[step.item].x, initial.cards[step.item].y]);
    const mid = C.view(seq, index, .5);
    const moved = mid.cards.filter((c, id) => c.x !== initial.cards[id].x || c.y !== initial.cards[id].y);
    assert.deepEqual(moved.map(c => c.id), [step.item]);
    assert.equal(mid.stats.text, String(step.before.processed));
    assert.equal(mid.tag.alpha, 0);
    const landed = C.view(seq, index, .88);
    const final = C.view(seq, index, 1);
    assert.equal(landed.cards[step.item].x, final.cards[step.item].x);
    assert.equal(landed.cards[step.item].y, final.cards[step.item].y);
    assert.ok(landed.tag.alpha > 0);
  });
});

test('八个元素同桶时分格容纳，队头出队后不把其他元素跳位', () => {
  const seq = M.build(Array(8).fill(424));
  const distributed = C.sample(seq, 9);
  assert.equal(new Set(distributed.cards.map(c => c.y)).size, 8);
  assert.ok(distributed.cards.every(c => c.y >= 273 && c.y <= 504));
  const collect = seq.steps.findIndex(s => s.kind === 'collect');
  const before = C.view(seq, collect, 0), after = C.view(seq, collect, 1);
  before.cards.slice(1).forEach((c, i) => assert.deepEqual(c, after.cards[i + 1]));
});

test('数位窗只在阶段步移动，终态与模型排序一致', () => {
  const seq = M.build(M.PRESETS.classic);
  const digit = seq.steps.findIndex(s => s.before.pass !== s.after.pass);
  const mid = C.view(seq, digit, .5);
  assert.ok(mid.digit > 0 && mid.digit < 1);
  const end = C.sample(seq, 55);
  assert.ok(end.cards.every(c => c.done === 1));
  assert.deepEqual([...end.cards].sort((a, b) => a.x - b.x).map(c => c.id), seq.result.map(c => c.id));
});

test('折线路径按长度匀速，不在转角重复缩放时间', () => {
  const points = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 30, y: 10 }];
  assert.deepEqual(C.along(points, .25), { x: 0, y: 10 });
  assert.deepEqual(C.along(points, .5), { x: 10, y: 10 });
  assert.deepEqual(C.along(points, 1), { x: 30, y: 10 });
});
