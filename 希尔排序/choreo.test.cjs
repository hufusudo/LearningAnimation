'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

for (const key of ['classic', 'counter']) {
  const sequence = M.buildSequence(key);
  test(`${key}: every boundary matches its snapshot and the next step exactly`, () => {
    for (let i = 0; i < sequence.steps.length; i++) {
      const step = sequence.steps[i];
      const start = C.sampleStep(step, 0, sequence.items), end = C.sampleStep(step, 1, sequence.items);
      assert.deepEqual(start, C.stable(step.before, sequence.items));
      assert.deepEqual(end, C.stable(step.after, sequence.items));
      assert.deepEqual(C.sample(sequence, i + 1), end);
      if (i + 1 < sequence.steps.length) assert.deepEqual(end, C.sampleStep(sequence.steps[i + 1], 0, sequence.items));
    }
  });
  test(`${key}: every intermediate frame is deterministic, finite and preserves identity`, () => {
    for (const p of [0.01, 0.1, 0.2, 0.35, 0.5, 0.68, 0.8, 0.95, 0.999]) {
      for (const step of sequence.steps) {
        const a = C.sampleStep(step, p, sequence.items);
        C.sample(sequence, sequence.duration);
        assert.deepEqual(C.sampleStep(step, p, sequence.items), a);
        assert.deepEqual(a.tokens.map(token => token.id), sequence.items.map(item => item.id));
        assert.ok(a.tokens.every(token => Number.isFinite(token.x) && Number.isFinite(token.y)));
        assert.ok(a.holes.every(alpha => alpha >= 0 && alpha <= 1));
        assert.ok(a.groups.alpha >= 0 && a.groups.alpha <= 1);
      }
    }
  });
}

test('guidance precedes movement, receipts follow movement, only one token moves', () => {
  const sequence = M.buildSequence('counter');
  for (const step of sequence.steps.filter(s => ['lift', 'shift', 'insert'].includes(s.kind))) {
    const start = C.sampleStep(step, 0, sequence.items);
    const guided = C.sampleStep(step, 0.15, sequence.items);
    assert.ok(guided.focus && guided.focus.alpha > 0);
    assert.deepEqual(guided.tokens, start.tokens);
    assert.equal(guided.tag, null);
    const middle = C.sampleStep(step, 0.45, sequence.items);
    assert.equal(middle.tokens.filter((token, i) => token.x !== start.tokens[i].x || token.y !== start.tokens[i].y).length, 1);
    assert.equal(middle.moves, step.before.moves);
    assert.equal(middle.inversions, step.before.inversions);
    const landed = C.sampleStep(step, 0.68, sequence.items);
    assert.deepEqual(landed.tokens, C.sampleStep(step, 1, sequence.items).tokens);
    assert.ok(C.sampleStep(step, 0.84, sequence.items).tag);
    assert.equal(C.sampleStep(step, 0.95, sequence.items).moves, step.after.moves);
  }
});

test('horizontal shift and elevated insertion express the real direction without overshoot', () => {
  const sequence = M.buildSequence();
  for (const step of sequence.steps.filter(s => ['shift', 'insert'].includes(s.kind))) {
    const start = C.sampleStep(step, 0, sequence.items).tokens.find(v => v.id === step.focus);
    const end = C.sampleStep(step, 1, sequence.items).tokens.find(v => v.id === step.focus);
    for (const p of [0.25, 0.4, 0.55, 0.65]) {
      const token = C.sampleStep(step, p, sequence.items).tokens.find(v => v.id === step.focus);
      assert.ok(token.x >= Math.min(start.x, end.x) && token.x <= Math.max(start.x, end.x));
      assert.ok(token.y >= Math.min(start.y, end.y) && token.y <= Math.max(start.y, end.y));
      if (step.kind === 'shift') assert.equal(token.y, C.UPPER_Y);
    }
    if (step.kind === 'insert') {
      assert.equal(C.sampleStep(step, 0.4, sequence.items).tokens.find(v => v.id === step.focus).y, C.TEMP_Y);
    }
  }
});

test('a whole group rises before insertion starts and returns without changing other groups', () => {
  const sequence = M.buildSequence();
  for (const step of sequence.steps.filter(s => ['group-lift', 'group-lower'].includes(s.kind))) {
    const start = C.sampleStep(step, 0, sequence.items), mid = C.sampleStep(step, 0.45, sequence.items), end = C.sampleStep(step, 1, sequence.items);
    const indices = C.indicesOf(step.before, sequence.items.length);
    const ids = indices.map(index => step.before.slots[index]);
    assert.equal(ids.length, sequence.items.length / step.before.gap);
    assert.deepEqual(C.sampleStep(step, 0.15, sequence.items).tokens, start.tokens, 'highlight the group before moving');
    assert.ok(C.sampleStep(step, 0.15, sequence.items).groupFocus);
    for (let i = 0; i < sequence.items.length; i++) {
      if (ids.includes(start.tokens[i].id)) {
        assert.notDeepEqual(mid.tokens[i], start.tokens[i]);
        assert.equal(end.tokens[i].y, step.kind === 'group-lift' ? C.UPPER_Y : C.MAIN_Y);
      } else assert.deepEqual(end.tokens[i], start.tokens[i]);
    }
    assert.deepEqual(C.sampleStep(step, 0.68, sequence.items).tokens, end.tokens);
  }
});

test('sorted prefix grows only after insertion lands; upstairs indices preserve original mapping', () => {
  const sequence = M.buildSequence();
  for (const step of sequence.steps) {
    if (step.kind === 'insert') {
      const a = C.sampleStep(step, 0.65, sequence.items), b = C.sampleStep(step, 1, sequence.items);
      assert.equal(a.work.prefix, C.stable(step.before, sequence.items).work.prefix);
      assert.equal(b.work.prefix, a.work.prefix + 1);
    }
    if (['lift', 'shift', 'insert', 'compare'].includes(step.kind)) {
      const frame = C.sampleStep(step, 0.45, sequence.items);
      const visible = frame.upperSlots.filter(slot => slot.alpha > 0);
      assert.deepEqual(visible.map(slot => slot.index), C.indicesOf(step.before, sequence.items.length));
      assert.ok(frame.tokens.filter(token => token.y !== C.MAIN_Y).length >= visible.length);
    }
  }
});

test('comparison line draws after guidance, no data moves during comparison', () => {
  const sequence = M.buildSequence('counter');
  const step = sequence.steps.find(s => s.kind === 'compare');
  assert.equal(C.sampleStep(step, 0.1, sequence.items).connector, null);
  const a = C.sampleStep(step, 0.3, sequence.items), b = C.sampleStep(step, 0.6, sequence.items);
  assert.ok(a.connector.draw < b.connector.draw);
  assert.equal(b.connector.draw, 1);
  assert.deepEqual(a.tokens, b.tokens);
  assert.equal(C.sampleStep(step, 1, sequence.items).connector, null);
});

test('reversal receipt appears only after the first real crossing lands', () => {
  const sequence = M.buildSequence('counter'), i = sequence.reversalTime - 1;
  assert.equal(C.sample(sequence, i + 0.65).order.text, 'original');
  assert.equal(C.sample(sequence, i + 0.95).order.text, 'reversed');
  assert.equal(C.sample(sequence, sequence.duration).order.text, 'reversed');
  assert.equal(C.sample(M.buildSequence(), 10000).order.text, 'original');
});

test('sampling clamps invalid and out-of-range times to explicit end states', () => {
  const sequence = M.buildSequence();
  assert.deepEqual(C.sample(sequence, NaN), C.sample(sequence, 0));
  assert.deepEqual(C.sample(sequence, -10), C.sample(sequence, 0));
  assert.deepEqual(C.sample(sequence, 1e6), C.sample(sequence, sequence.duration));
});
