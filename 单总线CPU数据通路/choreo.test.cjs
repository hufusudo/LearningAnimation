'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');
const seq = M.buildSequence('ADD_MEM');

function near(a, b, epsilon = 1e-6) {
  assert.ok(Math.abs(a - b) <= epsilon, `${a} not near ${b}`);
}

function nearDeep(a, b, path = '$') {
  if (typeof a === 'number' && typeof b === 'number') return near(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    assert.equal(a.length, b.length, path);
    a.forEach((v, i) => nearDeep(v, b[i], `${path}[${i}]`));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);
    for (const key of Object.keys(a)) nearDeep(a[key], b[key], `${path}.${key}`);
    return;
  }
  assert.equal(a, b, path);
}

test('任意时刻采样可重现，不依赖采样顺序且不污染序列', () => {
  const before = JSON.stringify(seq);
  const times = [0, 0.17, 1.234, 7.91, 18.6, seq.duration - 0.3, seq.duration];
  const first = times.map(t => C.sample(seq, t));
  for (let i = times.length - 1; i >= 0; i--) assert.deepEqual(C.sample(seq, times[i]), first[i]);
  assert.equal(JSON.stringify(seq), before);
});

test('数据在 .65 到达之前不写目标，.8 之后显示新值', () => {
  const i = seq.steps.findIndex(s => s.route === 'data-mdr');
  const start = i * 4;
  const target = seq.steps[i].target;
  const oldValue = seq.steps[i].before[target];
  const newValue = seq.steps[i].after[target];
  const beforeArrival = C.sample(seq, start + 4 * 0.65);
  assert.equal(beforeArrival.values[target].value, oldValue);
  assert.ok(beforeArrival.values[target].alpha > 0);
  const afterLatch = C.sample(seq, start + 4 * 0.8);
  assert.equal(afterLatch.values[target].value, newValue);
  assert.equal(afterLatch.values[target].alpha, 1);
});

test('段内路径按总弧长线性前进', () => {
  const path = [[0, 0], [3, 0], [3, 4]];
  assert.deepEqual(C.pointOnPath(path, 0), { x: 0, y: 0 });
  assert.deepEqual(C.pointOnPath(path, 3 / 7), { x: 3, y: 0 });
  nearDeep(C.pointOnPath(path, 0.5), { x: 3, y: 0.5 });
  nearDeep(C.pointOnPath(path, 1), { x: 3, y: 4 });
});

test('减少动效把非边界时刻直接采样到该步步末', () => {
  const frame = C.sample(seq, 5.2, true);
  near(frame.t, 8);
  assert.equal(frame.index, 1);
  assert.deepEqual(frame.state, seq.steps[1].after);
});

test('相邻步边界视觉连续，忽略明确允许不同的元数据与隐藏坐标', () => {
  for (let i = 0; i + 1 < seq.steps.length; i++) {
    const left = C.sample(seq, (i + 1) * 4 - 1e-8);
    const right = C.sample(seq, (i + 1) * 4);
    for (const key of ['values', 'title', 'why', 'phase', 'activity']) nearDeep(left[key], right[key], `step ${i} ${key}`);
    near(left.packet.alpha, right.packet.alpha);
    near(left.tag.alpha, right.tag.alpha);
  }
});
