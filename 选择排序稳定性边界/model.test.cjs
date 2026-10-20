'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, parseInput, buildSequence, label, inversions } = require('./model.js');

test('preset contracts and selection-sort counts/results', () => {
  assert.deepEqual(PRESETS.map(p => p.id), ['edge', 'dup', 'classic', 'sorted', 'desc']);
  assert.deepEqual(PRESETS.map(p => p.values), [
    [5, 8, 5, 2], [5, 5, 3, 8], [49, 38, 65, 97, 76, 13, 27],
    [10, 20, 30, 40, 50, 60, 70], [70, 60, 50, 40, 30, 20, 10]
  ]);
  assert.doesNotMatch(PRESETS.find(p => p.id === 'desc').name, /最坏交换/);
  for (const { values } of PRESETS) {
    const model = buildSequence(values);
    assert.deepEqual(model.summary.final.map(x => x.value), [...values].sort((a, b) => a - b));
    assert.equal(model.summary.comp, values.length * (values.length - 1) / 2);
    assert.ok(model.summary.swap <= values.length - 1);
  }
});

test('edge example shows stable-boundary crossing and exact swaps', () => {
  const model = buildSequence([5, 8, 5, 2]);
  assert.deepEqual(model.steps.find(step => step.type === 'swap').after.arr.map(label), ['2', '8', '5_B', '5_A']);
  assert.deepEqual(model.summary.final.map(label), ['2', '5_B', '5_A', '8']);
  assert.equal(model.summary.swap, 3);
  assert.deepEqual(model.watch, [0, 2]);
  assert.equal(model.summary.unstable, true);
  assert.equal(model.summary.everInverted, true);
});

test('strict-less comparison leaves equal candidate unchanged; descending swaps floor(n/2)', () => {
  const dup = buildSequence([5, 5, 3]);
  const equal = dup.steps.find(step => step.type === 'compare' && step.after.tag === '相等不更新');
  assert.equal(equal.after.min, 0);
  assert.equal(equal.after.tag, '相等不更新');
  const descending = buildSequence([8, 7, 6, 5, 4, 3]);
  assert.equal(descending.summary.swap, 3);
});

test('watch selects the first new inversion even when it occurs after the first swap', () => {
  const model = buildSequence([1, 0, 1, 0, 0]);
  const swaps = model.steps.filter(step => step.type === 'swap');
  assert.equal(inversions(swaps[0].after.arr).length, 0);
  assert.deepEqual(model.watch, inversions(swaps[1].after.arr)[0]);
  assert.notEqual(swaps[0].after.tag, '同值逆序');
  assert.equal(swaps[1].after.tag, '同值逆序');
});

test('input validation and delimiters', () => {
  assert.deepEqual(parseInput('1, 2，-3; 4；5'), [1, 2, -3, 4, 5]);
  for (const text of ['', '1 2', '1 2 3 4 5 6 7 8 9', '1 2 x', '1.2 2 3', '1000 2 3', '-1000 2 3']) {
    assert.throws(() => parseInput(text), Error);
  }
  for (const values of [[1, 2], Array(9).fill(1), [1, 2, 1000], [1, 2, 2.1]]) {
    assert.throws(() => buildSequence(values), Error);
  }
});

test('identity inversions, no-duplicate result, and snapshots are independent', () => {
  const model = buildSequence([9, 7, 5]);
  assert.equal(model.summary.unstable, false);
  assert.equal(model.summary.everInverted, false);
  assert.equal(model.summary.hasDuplicates, false);
  assert.deepEqual(inversions([{ id: 2, value: 1 }, { id: 1, value: 1 }]), [[1, 2]]);
  assert.equal(model.initial.i, null);
  assert.deepEqual(model.boundaries, [0, ...model.steps.map(step => step.end)]);
  assert.ok(Math.abs(model.duration - model.steps.reduce((total, step) => total + step.duration, 0)) < 1e-9);
  let prior = model.initial;
  for (const step of model.steps) {
    assert.deepEqual(step.before, prior);
    assert.notEqual(step.before, step.after);
    assert.notEqual(step.before.arr, step.after.arr);
    assert.ok(step.duration > 0);
    assert.deepEqual(step.end, step.start + step.duration);
    prior = step.after;
  }
  model.steps[0].after.arr[0].value = 999;
  assert.notEqual(model.initial.arr[0].value, 999);
});

test('all short inputs obey ordering and immutable transition contracts', () => {
  function visit(prefix, left) {
    if (!left) {
      const m = buildSequence(prefix);
      assert.deepEqual(m.summary.final.map(x => x.value), [...prefix].sort((a, b) => a - b));
      assert.equal(m.summary.comp, prefix.length * (prefix.length - 1) / 2);
      for (let i = 1; i < m.steps.length; i++) assert.deepEqual(m.steps[i].before, m.steps[i - 1].after);
      return;
    }
    for (let value = 0; value < 3; value++) visit([...prefix, value], left - 1);
  }
  for (let n = 3; n <= 5; n++) visit([], n);
});
