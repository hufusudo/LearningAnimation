'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

test('every transition joins exactly: endpoint equals next start', () => {
  for (const values of [...M.PRESETS.map(p => p.values), [1, 1, 1], [-999, 4, -999, 0, 4, 999, 4, 3]]) {
    const seq = M.buildSequence(values);
    let previous = C.sample(seq, 0);
    for (const step of seq.steps) {
      assert.deepEqual(C.frame(step.before, step.after, step, 0, seq.watch), previous, `${step.type} at ${step.start}`);
      previous = C.frame(step.before, step.after, step, 1, seq.watch);
      assert.deepEqual(C.sample(seq, step.end), previous);
    }
    assert.deepEqual(C.sample(seq, seq.duration + 100), previous);
  }
});

test('each boundary is continuous when approached from either side', () => {
  const seq = M.buildSequence([5, 8, 5, 2]);
  function near(a, b, path = '') {
    if (typeof a === 'number') assert.ok(Math.abs(a - b) < .0001, `${path}: ${a} vs ${b}`);
    else if (a && typeof a === 'object') for (const key of Object.keys(a)) near(a[key], b[key], `${path}.${key}`);
    else assert.deepEqual(a, b, path);
  }
  for (const step of seq.steps.slice(0, -1)) {
    near(C.sample(seq, step.end - 1e-8), C.sample(seq, step.end + 1e-8));
  }
});

test('exchange preserves identity, separates tracks, and receipts follow motion', () => {
  const seq = M.buildSequence([5, 8, 5, 2]);
  const step = seq.steps.find(s => s.type === 'swap');
  const start = C.frame(step.before, step.after, step, 0, seq.watch);
  const mid = C.frame(step.before, step.after, step, .47, seq.watch);
  const end = C.frame(step.before, step.after, step, 1, seq.watch);
  assert.equal(start.items.find(i => i.id === 0).x, 0);
  assert.equal(end.items.find(i => i.id === 0).x, 3);
  assert.equal(end.items.find(i => i.id === 3).x, 0);
  assert.ok(Math.abs(mid.items.find(i => i.id === 0).x - 1.5) < 1e-10);
  assert.equal(mid.items.find(i => i.id === 0).y, 75);
  assert.equal(mid.items.find(i => i.id === 3).y, -75);
  assert.equal(mid.swap.text, '0');
  assert.equal(mid.order.alpha, 0, 'old order receipt is hidden before the crossing');
  assert.equal(end.swap.text, '1');
  assert.equal(end.order.text, '同值身份已逆序');
  assert.equal(end.boundary, start.boundary, 'exchange does not also lock a position');
});

test('scan moves cursor only; min moves in a separate update', () => {
  const seq = M.buildSequence([5, 8, 5, 2]);
  const scan = seq.steps.find(s => s.type === 'compare' && s.after.j === 3);
  const end = C.frame(scan.before, scan.after, scan, 1, seq.watch);
  assert.equal(end.j.pos, 3);
  assert.equal(end.min.pos, 0);
  const update = seq.steps[seq.steps.indexOf(scan) + 1];
  assert.equal(update.type, 'update');
  assert.equal(C.frame(update.before, update.after, update, 1, seq.watch).min.pos, 3);
  assert.deepEqual(end.items.map(i => i.x), [0, 1, 2, 3]);
});

test('sampling is deterministic, input-independent and safe for reverse seeking', () => {
  const seq = M.buildSequence([3, 3, 1]);
  const before = JSON.stringify(seq);
  const expected = C.sample(seq, 6.42);
  for (const t of [seq.duration, 0, 4.5, 3, 8.1]) C.sample(seq, t);
  assert.deepEqual(C.sample(seq, 6.42), expected);
  assert.equal(JSON.stringify(seq), before);
  assert.deepEqual(C.sample(seq, NaN), C.sample(seq, 0));
  const unique = M.buildSequence([1, 2, 3]);
  assert.equal(C.sample(unique, unique.duration).order.text, '本例无同值元素');
});
