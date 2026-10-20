const test = require('node:test');
const assert = require('node:assert/strict');
const LimitModel = require('./model.js');

const epsilons = [0.08, 0.2, 0.35, 1.2];
const keys = [
  'c-damped-sin', 'c-exp-decay', 'c-monotone', 'c-rational',
  'd-alt-harmonic', 'd-sin-scatter', 'd-monotone', 'd-positive-decay'
];

test('exports the eight original models with the documented API', () => {
  assert.deepEqual(Object.keys(LimitModel.models), keys);
  for (const key of keys) {
    const model = LimitModel.getModel(key);
    assert.equal(typeof model.name, 'string');
    assert.ok(model.mode === 'continuous' || model.mode === 'discrete');
    assert.match(model.expression, /a/);
    assert.equal(typeof model.fn, 'function');
    assert.equal(typeof model.bound, 'function');
    assert.equal(typeof model.threshold, 'function');
  }
  assert.equal(LimitModel.getModel('missing'), LimitModel.models['c-damped-sin']);
});

test('analytic envelopes bound sampled model errors and thresholds are sufficient', () => {
  for (const key of keys) {
    const model = LimitModel.getModel(key);
    for (const epsilon of epsilons) {
      const limit = LimitModel.threshold(key, epsilon);
      assert.ok(Number.isFinite(limit) && limit > 0, `${key} threshold at ${epsilon}`);
      if (model.mode === 'continuous') {
        for (const x of [limit + 1e-7, limit + 0.1, limit + 3, limit + 100]) {
          assert.ok(model.bound(x) < epsilon, `${key}: envelope at x=${x}, ε=${epsilon}`);
          assert.ok(Math.abs(model.fn(x, 2) - 2) <= model.bound(x) + 1e-12 * Math.max(1, model.bound(x)), `${key}: sample at x=${x}`);
        }
      } else {
        assert.ok(Number.isInteger(limit));
        for (const n of [limit + 1, limit + 3, limit + 100]) {
          assert.ok(model.bound(n) < epsilon, `${key}: envelope at n=${n}, ε=${epsilon}`);
          assert.ok(Math.abs(model.fn(n, 2) - 2) <= model.bound(n) + 1e-12 * Math.max(1, model.bound(n)), `${key}: sample at n=${n}`);
        }
      }
      assert.match(LimitModel.proof(key, epsilon), /包络/);
      assert.ok(LimitModel.extent(key, epsilon) >= 25);
    }
  }
});

test('continuous threshold rounds upward and equality at X is outside the strict neighborhood', () => {
  const key = 'c-rational';
  const epsilon = 0.5;
  const X = LimitModel.threshold(key, epsilon);
  assert.equal(X, 6);
  assert.equal(LimitModel.getModel(key).bound(X), epsilon);
  assert.ok(LimitModel.getModel(key).bound(X + 1e-6) < epsilon);
  assert.match(LimitModel.proof(key, epsilon), /X = 6/);
});

test('discrete threshold respects positive integer N and strict n > N semantics', () => {
  const key = 'd-positive-decay';
  const epsilon = 3.6 / Math.pow(4, 0.8);
  const N = LimitModel.threshold(key, epsilon);
  assert.equal(N, 4);
  assert.equal(LimitModel.getModel(key).bound(N), epsilon);
  assert.ok(LimitModel.getModel(key).bound(N + 1) < epsilon);
  assert.equal(LimitModel.threshold('d-monotone', 100), 1);
});

test('extent uses the configured epsilon range and leaves room beyond the sufficient limit', () => {
  for (const key of keys) {
    const model = LimitModel.getModel(key);
    for (const epsilon of [0.001, 0.08, 0.35, 1.2, 8]) {
      const controlled = Math.max(0.08, Math.min(1.2, epsilon));
      const limit = LimitModel.threshold(key, controlled);
      const span = LimitModel.extent(key, epsilon);
      assert.ok(span >= 25);
      assert.ok(model.mode === 'discrete' ? span >= Math.ceil(limit * 1.55) : span >= limit * 1.55);
      if (model.mode === 'discrete') assert.ok(Number.isInteger(span));
    }
  }
});

test('invalid thresholds and values are rejected', () => {
  for (const epsilon of [0, -1, NaN, Infinity]) {
    assert.throws(() => LimitModel.threshold('c-rational', epsilon), RangeError);
    assert.throws(() => LimitModel.extent('c-rational', epsilon), RangeError);
    assert.throws(() => LimitModel.proof('c-rational', epsilon), RangeError);
  }
  assert.throws(() => LimitModel.value('c-rational', -1, 2), RangeError);
  assert.throws(() => LimitModel.value('d-alt-harmonic', 0, 2), RangeError);
  assert.throws(() => LimitModel.value('d-alt-harmonic', 1.5, 2), RangeError);
  assert.throws(() => LimitModel.value('c-rational', 2, NaN), TypeError);
});

test('all envelopes are positive and decreasing on their domains', () => {
  for (const key of keys) {
    const bound = LimitModel.getModel(key).bound;
    const samples = key.startsWith('c-') ? [0, 0.1, 1, 10, 100] : [1, 2, 10, 100, 1000];
    for (const x of samples) {
      assert.ok(bound(x) > 0, `${key}: positive at ${x}`);
      assert.ok(bound(key.startsWith('c-') ? x + 0.5 : x + 1) < bound(x), `${key}: decreasing after ${x}`);
    }
  }
});
