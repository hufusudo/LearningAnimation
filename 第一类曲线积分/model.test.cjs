const test = require('node:test');
const assert = require('node:assert/strict');

let model;
try {
  model = require('./model.js');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes('./model.js')) throw error;
  model = {};
}

test('constant density accumulates the sampled arc length', () => {
  assert.equal(typeof model.integrate, 'function');
  const result = model.integrate('one', 4);
  assert.ok(Math.abs(result.sum - 3.9) < 1e-12);
  assert.ok(Math.abs(result.exact - 3.9) < 1e-12);
});

test('fine partitions approach the independently calculated reference values', () => {
  assert.equal(typeof model.integrate, 'function');
  const references = [
    ['one', 3.9],
    ['x', 8.954901237936562],
    ['onePlusY2', 5.771869043987191]
  ];

  for (const [density, expected] of references) {
    const result = model.integrate(density, 128);
    assert.ok(Math.abs(result.exact - expected) < 1e-11, `${density} reference changed`);
    assert.ok(Math.abs(result.sum - expected) < 0.001, `${density} did not converge`);
  }
});

test('reversing the curve leaves the arc-length sum unchanged', () => {
  assert.equal(typeof model.integrate, 'function');
  for (const density of ['one', 'x', 'onePlusY2']) {
    assert.equal(model.integrate(density, 17, false).sum, model.integrate(density, 17, true).sum);
  }
});

test('refining the partition reduces the visible error for the varying density', () => {
  assert.equal(typeof model.integrate, 'function');
  const coarse = model.integrate('onePlusY2', 4);
  const fine = model.integrate('onePlusY2', 128);
  assert.ok(coarse.error > 0.01);
  assert.ok(fine.error < coarse.error / 100);
});

test('a short arc is longer than its dx-dy chord, and the gap shrinks as it is refined', () => {
  assert.equal(typeof model.segmentGeometry, 'function');
  const coarse = model.segmentGeometry(4, 0);
  const fine = model.segmentGeometry(128, 0);
  const expectedCoarseChord = 2 * Math.sin(.975 / 2);

  assert.ok(Math.abs(coarse.ds - .975) < 1e-12);
  assert.ok(Math.abs(coarse.chord - expectedCoarseChord) < 1e-12);
  assert.ok(Math.abs(Math.hypot(coarse.dx, coarse.dy) - coarse.chord) < 1e-12);
  assert.ok(coarse.ds > coarse.chord);
  assert.ok(fine.ds - fine.chord < (coarse.ds - coarse.chord) / 100);
});

test('reversing a segment changes dx and dy signs without changing ds', () => {
  assert.equal(typeof model.segmentGeometry, 'function');
  const forward = model.segmentGeometry(8, 1);
  const reverse = model.segmentGeometry(8, 6, true);

  assert.ok(Math.abs(forward.dx + reverse.dx) < 1e-12);
  assert.ok(Math.abs(forward.dy + reverse.dy) < 1e-12);
  assert.equal(forward.ds, reverse.ds);
});
