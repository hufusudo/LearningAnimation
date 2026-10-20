'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, buildSequence } = require('./model.js');

function assertHeap(state) {
  for (let i = 0; i < state.active.length; i++) {
    if (!state.active[i]) continue;
    for (const child of [2 * i + 1, 2 * i + 2]) {
      if (child < state.active.length && state.active[child]) {
        assert.ok(state.active[i].value <= state.active[child].value, `heap at ${i}->${child}`);
      }
    }
  }
}
function statesOf(result) {
  return [result.initial, ...result.steps.map(s => s.after), result.final];
}
function verify(input, capacity) {
  const original = [...input];
  const result = buildSequence(input, capacity);
  assert.deepEqual(input, original);
  assert.deepEqual(result.input, original);
  assert.equal(result.duration, result.steps.length);
  assert.deepEqual(result.final.runs.flat().map(t => t.value).sort((a, b) => a - b), [...input].sort((a, b) => a - b));
  assert.equal(result.final.runs.flat().length, input.length);
  for (const run of result.final.runs) {
    for (let i = 1; i < run.length; i++) assert.ok(run[i - 1].value <= run[i].value);
  }
  for (const state of statesOf(result)) {
    assert.ok(state.active.filter(Boolean).length + state.frozen.length + Number(!!state.pending) <= capacity);
    const owned = [
      ...result.tokens.slice(state.inputIndex), ...state.active.filter(Boolean),
      ...state.frozen, ...(state.pending ? [state.pending] : []), ...state.runs.flat()
    ];
    assert.equal(owned.length, result.tokens.length);
    assert.equal(new Set(owned.map(t => t.id)).size, result.tokens.length);
  }
  for (let i = 0; i < result.steps.length; i++) {
    const step = result.steps[i];
    assert.ok(step.message.length <= 40);
    assert.deepEqual(step.before, i ? result.steps[i - 1].after : result.initial);
    if (['ready', 'select'].includes(step.type)) assertHeap(step.after);
    if (step.type === 'swap') {
      assert.equal(new Set(step.after.active.filter(Boolean).map(t => t.id)).size, step.after.active.filter(Boolean).length);
    }
  }
  return result;
}

test('textbook preset yields the expected replacement-selection runs', () => {
  const { final } = verify(PRESETS.textbook, 6);
  assert.deepEqual(final.runs.map(run => run.map(t => t.value)), [
    [29, 38, 39, 46, 49, 51, 61],
    [1, 3, 14, 15, 27, 30, 48, 52, 63, 89],
    [4, 13, 24, 33, 46, 58, 76]
  ]);
});
// 不用堆的独立参考算法：线性查找最小值，核对堆实现的分段结果。
function reference(input, capacity) {
  let active = input.slice(0, capacity), frozen = [], index = active.length;
  const runs = [[]];
  while (active.length || frozen.length) {
    if (!active.length) { active = frozen; frozen = []; runs.push([]); }
    const min = Math.min(...active);
    active.splice(active.indexOf(min), 1);
    runs.at(-1).push(min);
    if (index < input.length) {
      const value = input[index++];
      (value >= min ? active : frozen).push(value);
    }
  }
  return runs;
}
test('all presets and deterministic varied inputs agree with a non-heap reference', () => {
  let seed = 21;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % 31 - 15; };
  const inputs = [...Object.values(PRESETS), ...Array.from({ length: 20 }, (_, i) => Array.from({ length: i * 2 }, random))];
  for (const input of inputs) for (let capacity = 1; capacity <= 8; capacity++) {
    const result = verify(input, capacity);
    assert.deepEqual(result.final.runs.map(run => run.map(t => t.value)), reference(input, capacity));
  }
});
test('duplicate values retain distinct token identities', () => {
  const r = verify([3, 1, 1, 2, 1, 3], 3);
  assert.equal(new Set(r.tokens.map(t => t.id)).size, 6);
  assert.equal(new Set(r.final.runs.flat().map(t => t.id)).size, 6);
});
test('reverse, ascending, capacity one, and shorter-than-capacity inputs', () => {
  verify(PRESETS.reverse, 4);
  verify([1, 2, 3, 4, 5], 3);
  verify([8, 7, 6, 5], 1);
  verify([4, 2], 8);
});
test('empty input retains a single empty run', () => {
  const r = verify([], 1);
  assert.deepEqual(r.final.runs, [[]]);
  assert.deepEqual(r.initial.runs, [[]]);
});
test('invalid input and capacity throw explicit errors', () => {
  assert.throws(() => buildSequence('1,2', 2), /input must be an array/);
  assert.throws(() => buildSequence([1, Infinity], 2), /finite integers/);
  assert.throws(() => buildSequence([1, 1.5], 2), /finite integers/);
  assert.throws(() => buildSequence(new Array(3), 2), /finite integers/);
  for (const n of [0, 9, 1.5, NaN]) assert.throws(() => buildSequence([], n), /capacity must be an integer from 1 to 8/);
});
test('snapshots do not share mutable collections and browser/CommonJS APIs are exposed', () => {
  const r = verify([2, 1, 2], 2);
  assert.equal(typeof buildSequence, 'function');
  assert.deepEqual(Object.keys(PRESETS), ['textbook', 'nearly_sorted', 'reverse']);
  for (const step of r.steps) {
    assert.notEqual(step.before.active, step.after.active);
    assert.notEqual(step.before.runs, step.after.runs);
    if (step.before.runs.length && step.after.runs.length) assert.notEqual(step.before.runs[0], step.after.runs[0]);
  }
});
