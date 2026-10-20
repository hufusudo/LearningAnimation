'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

for (const mode of ['recursive', 'single']) {
  test(`${mode}: every event begins and ends at its exact snapshot`, () => {
    for (const values of [M.PRESETS.classic, M.PRESETS.sorted, M.PRESETS.duplicates, [-999, 999, 0], [5]]) {
      const trace = M.buildTrace(values, mode);
      trace.events.forEach((event, index) => {
        assert.deepEqual(C.transition(trace, event, 0), C.frame(trace, event.before));
        assert.deepEqual(C.transition(trace, event, 1), C.frame(trace, event.after));
        assert.deepEqual(C.sample(trace, index + 1), C.frame(trace, event.after));
        if (index + 1 < trace.duration) {
          assert.deepEqual(C.transition(trace, event, 1), C.transition(trace, trace.events[index + 1], 0));
        }
      });
    }
  });
}

test('a moving token exists once, travels continuously, and hands over at the destination', () => {
  const trace = M.buildTrace(M.PRESETS.classic);
  for (const event of trace.events.filter(event => ['lift', 'fill', 'place'].includes(event.kind))) {
    const start = C.transition(trace, event, 0), end = C.transition(trace, event, 1);
    const movingIndex = start.tokens.findIndex((token, i) => token.x !== end.tokens[i].x || token.y !== end.tokens[i].y);
    assert.ok(movingIndex >= 0);
    let previous = start.tokens[movingIndex];
    for (let i = 1; i <= 100; i++) {
      const view = C.transition(trace, event, i / 100);
      assert.equal(new Set(view.tokens.map(token => token.id)).size, trace.initial.cells.length);
      assert.ok(view.slots.filter(slot => slot.hole > 0).length <= 1, 'only one hole label may be visible');
      const token = view.tokens[movingIndex];
      assert.ok(Math.hypot(token.x - previous.x, token.y - previous.y) < 24);
      previous = token;
    }
    const midway = C.transition(trace, event, .45).tokens[movingIndex];
    assert.ok(midway.x !== start.tokens[movingIndex].x || midway.y !== start.tokens[movingIndex].y);
    assert.deepEqual(C.transition(trace, event, .1).tokens.map(token => [token.x, token.y]), start.tokens.map(token => [token.x, token.y]));
    assert.deepEqual(C.transition(trace, event, .73).tokens.map(token => [token.x, token.y]), end.tokens.map(token => [token.x, token.y]));
  }
});

test('guidance precedes motion, counter receipts follow it, tags do not cross boundaries', () => {
  const trace = M.buildTrace(M.PRESETS.classic);
  const event = trace.events.find(event => event.kind === 'fill');
  assert.ok(C.transition(trace, event, .12).focus.alpha > 0);
  assert.equal(C.transition(trace, event, .5).stats.moves.text, String(event.before.moves));
  assert.equal(C.transition(trace, event, .95).stats.moves.text, String(event.after.moves));
  assert.equal(C.transition(trace, event, .6).tag.alpha, 0);
  assert.ok(C.transition(trace, event, .9).tag.alpha > 0);
  assert.equal(C.transition(trace, event, 1).tag.alpha, 0);
});

test('arbitrary seeks are deterministic, clamp to bounds, and reduced motion uses event endpoints', () => {
  const trace = M.buildTrace(M.PRESETS.duplicates);
  const frozen = JSON.stringify(trace);
  const a = C.sample(trace, 12.47);
  C.sample(trace, 50.68);
  C.sample(trace, 2.1);
  assert.deepEqual(C.sample(trace, 12.47), a);
  assert.deepEqual(C.sample(trace, -10), C.frame(trace, trace.initial));
  assert.deepEqual(C.sample(trace, Infinity), C.frame(trace, trace.initial));
  assert.deepEqual(C.sample(trace, 1e6), C.frame(trace, trace.events.at(-1).after));
  assert.deepEqual(C.sample(trace, 12.47, true), C.frame(trace, trace.events[12].after));
  assert.equal(JSON.stringify(trace), frozen);
});
