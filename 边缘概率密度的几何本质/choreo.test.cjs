const test = require('node:test');
const assert = require('node:assert/strict');
const { sample, boundaries } = require('./choreo.js');

test('每个阶段边界的几何连续，任意跳转均可确定重绘', () => {
  const keys = ['u', 'focus', 'unfold', 'fill', 'integration', 'transfer', 'receipt', 'traceMin', 'traceMax'];
  for (const range of [[-3, 3], [0, 2]]) {
    for (const anchor of [range[0], (range[0] + range[1]) / 2, range[1]]) {
      for (const t of [...boundaries.slice(1), 11.5, 14.5]) {
        const before = sample(t - 1e-8, anchor, range);
        const after = sample(t, anchor, range);
        for (const key of keys) assert.ok(Math.abs(before[key] - after[key]) < 1e-6, `${t} ${key}`);
      }
      assert.deepEqual(sample(8.3, anchor, range), sample(8.3, anchor, range));
    }
  }
});
test('完整扫描连续访问全域并返回原截面', () => {
  const range = [-3, 3], anchor = .6;
  assert.equal(sample(11.5, anchor, range).u, 3);
  assert.equal(sample(14.5, anchor, range).u, -3);
  const end = sample(16, anchor, range);
  assert.ok(Math.abs(end.u - anchor) < 1e-10);
  assert.equal(end.traceMin, -3); assert.equal(end.traceMax, 3);
});
test('手动探索保留时刻、位置与已有教学揭示程度', () => {
  const frame = sample(13, 1.7, [0, 2], true);
  assert.equal(frame.u, 1.7); assert.equal(frame.t, 13);
  assert.equal(frame.transfer, 1); assert.equal(frame.scanning, false);
});
