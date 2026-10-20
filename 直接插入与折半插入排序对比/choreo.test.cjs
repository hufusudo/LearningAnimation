const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SAMPLE, makeItems, buildTrace } = require('./model.js');
const { frame, sample } = require('./choreo.js');
function near(a, b, path = '') {
  if (typeof a === 'number') assert.ok(Math.abs(a - b) < 1e-9, path + ': ' + a + ' vs ' + b);
  else if (a && typeof a === 'object') {
    assert.deepEqual(Object.keys(a), Object.keys(b));
    Object.keys(a).forEach(key => near(a[key], b[key], path + '.' + key));
  } else assert.equal(a, b, path);
}
for (const mode of ['direct', 'binary']) {
  const steps = buildTrace(makeItems(SAMPLE), mode);
  test(mode + ': 每步终点等于下一步起点', () => {
    for (let i = 1; i < steps.length - 1; i++) {
      near(frame(steps[i - 1], steps[i], 1), frame(steps[i], steps[i + 1], 0), 'step ' + i);
    }
  });
  test(mode + ': 任意拖动和倒退均确定', () => {
    const first = sample(steps, 8.43);
    sample(steps, steps.length - 1);
    sample(steps, 0);
    assert.deepEqual(sample(steps, 8.43), first);
  });
}
test('边界指针在步内线性移动，先引导，再移动，再更新计数', () => {
  const steps = buildTrace(makeItems(SAMPLE), 'binary');
  const index = steps.findIndex(x => x.phase === 'narrow');
  const a = steps[index - 1];
  const b = steps[index];
  const key = a.low !== b.low ? 'low' : 'high';
  const middle = frame(a, b, 0.44);
  assert.ok(middle.pointers[key].index > Math.min(a[key], b[key]));
  assert.ok(middle.pointers[key].index < Math.max(a[key], b[key]));
  assert.equal(frame(a, b, 0.1).pointers[key].index, a[key]);
  const compare = steps.findIndex(x => x.phase === 'locate');
  assert.equal(frame(steps[compare - 1], steps[compare], 0.6).comparisons, steps[compare - 1].comparisons);
  assert.equal(frame(steps[compare - 1], steps[compare], 1).comparisons, steps[compare].comparisons);
});
test('取数到 temp 和插入都是连续路径', () => {
  const steps = buildTrace(makeItems(SAMPLE), 'binary');
  const first = frame(steps[0], steps[1], 0.44).tiles.find(x => x.id === 1);
  assert.ok(first.temp > 0 && first.temp < 1);
  const index = steps.findIndex(x => x.phase === 'insert');
  const inserted = frame(steps[index - 1], steps[index], 0.44).tiles.find(x => x.id === 1);
  assert.ok(inserted.temp > 0 && inserted.temp < 1);
});
