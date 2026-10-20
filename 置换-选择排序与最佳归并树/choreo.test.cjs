'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

test('every adjacent endpoint is exactly the next starting frame', () => {
  for (const input of Object.values(M.PRESETS)) for (const capacity of [4, 6, 8]) {
    const seq = M.buildSequence(input, capacity);
    assert.deepEqual(C.sampleStep(seq, seq.steps[0], 0), C.stateFrame(seq, seq.initial));
    for (let i = 0; i < seq.steps.length - 1; i++) {
      assert.deepEqual(C.sampleStep(seq, seq.steps[i], 1), C.sampleStep(seq, seq.steps[i + 1], 0), `boundary ${i}`);
    }
    assert.deepEqual(C.sample(seq, seq.duration), C.stateFrame(seq, seq.final));
  }
});
test('scrubbing forward, backward and repeatedly gives identical frames without mutations', () => {
  const seq = M.buildSequence(M.PRESETS.textbook, 6), original = JSON.stringify(seq);
  const times = [0, .5, 4.2, 22.45, seq.duration - .1, seq.duration];
  const frames = times.map(t => C.sample(seq, t));
  times.slice().reverse().forEach(t => C.sample(seq, t));
  times.forEach((t, i) => assert.deepEqual(C.sample(seq, t), frames[i]));
  assert.equal(JSON.stringify(seq), original);
});
test('flying records have a single identity and linear movement after guidance, before receipt', () => {
  const seq = M.buildSequence(M.PRESETS.textbook, 6);
  for (const step of seq.steps.filter(s => ['load', 'read', 'emit', 'activate', 'freeze'].includes(s.type))) {
    const start = C.sampleStep(seq, step, 0).tokens.find(t => t.id === step.tokenId);
    const end = C.sampleStep(seq, step, 1).tokens.find(t => t.id === step.tokenId);
    const early = C.sampleStep(seq, step, .15).tokens.find(t => t.id === step.tokenId);
    const middle = C.sampleStep(seq, step, .43).tokens.find(t => t.id === step.tokenId);
    const landed = C.sampleStep(seq, step, .69).tokens.find(t => t.id === step.tokenId);
    assert.equal(early.x, start.x); assert.equal(early.y, start.y);
    const expected = C.pointAlong(C.flightPoints(step.type, start, end), .5);
    assert.ok(Math.abs(middle.x - expected.x) < 1e-8);
    assert.ok(Math.abs(middle.y - expected.y) < 1e-8);
    assert.equal(landed.x, end.x); assert.equal(landed.y, end.y);
    const frame = C.sampleStep(seq, step, .8);
    assert.equal(new Set(frame.tokens.map(t => t.id)).size, seq.tokens.length);
    assert.ok(frame.tag.opacity > 0);
    assert.equal(C.sampleStep(seq, step, .5).tag.opacity, 0);
  }
});
test('frozen records are never drawn as children of the active heap', () => {
  const seq = M.buildSequence(M.PRESETS.textbook, 6);
  for (const step of seq.steps) {
    const frame = C.sampleStep(seq, step, 1);
    step.after.frozen.forEach(token => {
      const view = frame.tokens.find(t => t.id === token.id);
      assert.equal(view.zone, 'frozen'); assert.equal(view.y, 495);
    });
    frame.edges.filter(e => e.opacity > 0).forEach(edge => {
      assert.ok(step.after.active[edge.child]);
      assert.ok(step.after.active[Math.floor((edge.child - 1) / 2)]);
    });
  }
});
test('flight paths are arc-length linear and avoid the decision text band', () => {
  assert.deepEqual(C.pointAlong([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }], .5), { x: 100, y: 100 });
  for (const type of ['freeze', 'activate']) {
    const end = type === 'freeze' ? { x: 365, y: 495 } : { x: 550, y: 240 };
    const points = C.flightPoints(type, { x: 100, y: 290 }, end);
    for (let p = 0; p <= 1; p += .01) {
      const at = C.pointAlong(points, p);
      assert.ok(!(at.x > 35 && at.x < 281 && at.y > 335 && at.y < 425), `${type} intersects decision text`);
    }
  }
});
test('counts change only after the main action and crossfade when the integer changes', () => {
  const seq = M.buildSequence([4, 2, 3], 2);
  const emit = seq.steps.find(s => s.type === 'emit');
  assert.equal(C.sampleStep(seq, emit, .65).counts.output, 0);
  assert.ok(C.sampleStep(seq, emit, .82).countOpacity.output < .01);
  assert.equal(C.sampleStep(seq, emit, .96).counts.output, 1);
  assert.equal(C.sampleStep(seq, emit, .96).countOpacity.output, 1);
});
test('selection remains visible at boundaries and reduced-motion endpoint frames', () => {
  const seq = M.buildSequence([3, 1, 1, 2, 1], 3);
  const step = seq.steps.find(s => s.type === 'select');
  const frame = C.sampleStep(seq, step, 1);
  assert.equal(frame.focus[0].id, step.after.selected);
  assert.equal(frame.focus[0].opacity, 1);
  assert.notEqual(seq.tokens[1].id, seq.tokens[2].id);
});
