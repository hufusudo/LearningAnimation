const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SAMPLE, makeItems, buildTrace } = require('./model.js');

for (const mode of ['direct', 'binary']) {
  test(mode + ': 排序、稳定性和元素守恒', () => {
    for (const values of [SAMPLE, [], [1], [1, 2, 3], [4, 3, 2, 1], [5, 5, 5], [2, 1, 2, 1]]) {
      const items = makeItems(values);
      const steps = buildTrace(items, mode);
      const final = steps.at(-1);
      assert.deepEqual(final.array.map(x => x.value), values.slice().sort((a, b) => a - b));
      for (const step of steps) {
        const present = step.array.filter(Boolean).concat(step.temp || []);
        assert.deepEqual(present.map(x => x.id).sort((a, b) => a - b), items.map(x => x.id));
      }
      const expected = items.slice().sort((a, b) => a.value - b.value);
      assert.deepEqual(final.array.map(x => x.id), expected.map(x => x.id));
      assert.equal(final.completedPasses, Math.max(0, values.length - 1));
    }
  });
}
test('两种算法右移相同，折半减少本例比较次数', () => {
  const items = makeItems(SAMPLE);
  const direct = buildTrace(items, 'direct').at(-1);
  const binary = buildTrace(items, 'binary').at(-1);
  assert.equal(binary.shifts, direct.shifts);
  assert.ok(binary.comparisons < direct.comparisons);
  const inversions = SAMPLE.reduce((sum, value, i) => sum + SAMPLE.slice(i + 1).filter(x => x < value).length, 0);
  assert.equal(binary.shifts, inversions);
});
test('折半的中点、比较和单边界移动各自成步，含 high = -1', () => {
  const steps = buildTrace(makeItems(SAMPLE), 'binary');
  assert.ok(steps.some(x => x.high === -1));
  steps.forEach((step, index) => {
    const prev = steps[index - 1];
    if (step.phase === 'mid') {
      assert.equal(step.mid, Math.floor((step.low + step.high) / 2));
      assert.ok(step.low <= step.high);
    }
    if (step.phase === 'locate') {
      assert.equal(prev.phase, 'mid');
      assert.equal(step.low, prev.low);
      assert.equal(step.high, prev.high);
    }
    if (step.phase === 'narrow') {
      assert.equal(prev.phase, 'locate');
      assert.equal(Number(step.low !== prev.low) + Number(step.high !== prev.high), 1);
      assert.ok(step.low >= prev.low && step.high <= prev.high);
    }
    if (step.phase === 'position') assert.ok(step.low > step.high);
  });
});
