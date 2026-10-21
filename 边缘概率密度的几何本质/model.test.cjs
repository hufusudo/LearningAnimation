const test = require('node:test');
const assert = require('node:assert/strict');
const DensityModel = require('./model.js');

const { models, slice, integrate } = DensityModel;
const close = (actual, expected, tolerance = 1e-5) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
};
const midpoint = (fn, a, b, count = 1000) => {
  const width = (b - a) / count;
  let total = 0;
  for (let i = 0; i < count; i += 1) total += fn(a + (i + 0.5) * width);
  return total * width;
};

test('marginal densities normalize', () => {
  for (const key of Object.keys(models)) {
    const model = models[key];
    const [a, b] = key === 'normal' ? [-8, 8] : model.range;
    close(integrate(model.marginal, a, b, 4000), 1, 2e-5);
    if (key !== 'normal') assert.equal(model.joint(a - 1, a), 0);
  }
});

test('joint densities normalize over their two-dimensional supports', () => {
  for (const rho of [-0.8, 0.4, 0.8]) {
    const probability = midpoint((x) => midpoint(
      (y) => models.normal.joint(x, y, rho), -10, 10, 500,
    ), -8, 8, 500);
    close(probability, 1, 2e-6);
  }

  const triangleProbability = midpoint((x) => midpoint(
    (y) => models.triangle.joint(x, y), 0, 2 - x, 200,
  ), 0, 2, 200);
  const rampProbability = midpoint((x) => midpoint(
    (y) => models.ramp.joint(x, y), 0, 2, 300,
  ), 0, 2, 300);
  close(triangleProbability, 1, 2e-5);
  close(rampProbability, 1, 2e-5);
});

test('slices are symmetric in direction and area equals the exact marginal', () => {
  for (const key of Object.keys(models)) {
    const u = key === 'normal' ? 0.35 : 0.7;
    const xSlice = slice(key, 'x', u, 0.4, 81);
    const ySlice = slice(key, 'y', u, 0.4, 81);
    close(xSlice.area, models[key].marginal(u));
    close(ySlice.area, models[key].marginal(u));
    close(xSlice.visibleArea, ySlice.visibleArea);
    for (let i = 0; i < xSlice.points.length; i += 1) {
      close(xSlice.points[i].v, ySlice.points[i].v, 1e-12);
      close(xSlice.points[i].density, ySlice.points[i].density, 1e-12);
    }
  }
});

test('conditional slices normalize for finite-support models and zero-area slices are undefined', () => {
  for (const key of ['triangle', 'ramp']) {
    const result = slice(key, 'x', 0.7);
    close(integrate((v) => models[key].joint(0.7, v) / result.area,
      result.bounds[0], result.bounds[1]), 1, 2e-3);
    assert.ok(result.points.every((point) => point.conditional !== null));
  }

  const zero = slice('triangle', 'x', 2);
  assert.equal(zero.area, 0);
  assert.equal(zero.visibleArea, 0);
  assert.equal(zero.conditionalDefined, false);
  assert.deepEqual(zero.points, []);
  assert.deepEqual(slice('triangle', 'x', 3).bounds, [0, 0]);
  assert.deepEqual(slice('normal', 'x', 4).bounds, [0, 0]);
});

test('normal peak reflects positive and negative correlation magnitudes', () => {
  const expected = 1 / (2 * Math.PI * Math.sqrt(1 - 0.8 ** 2));
  close(models.normal.peak(0.8), expected);
  close(models.normal.peak(-0.8), expected);
  close(models.normal.joint(0, 0, 0.8), expected);
  close(models.normal.joint(0, 0, -0.8), expected);
});

test('normal conditional density integrates to one and has mean rho times the fixed coordinate', () => {
  const u = 0.7;
  for (const rho of [-0.8, 0.4, 0.8]) {
    const conditional = (v) => models.normal.joint(u, v, rho) / models.normal.marginal(u);
    close(midpoint(conditional, -10, 10, 4000), 1, 2e-10);
    close(midpoint((v) => v * conditional(v), -10, 10, 4000), rho * u, 2e-9);
  }
});

test('triangle and ramp models retain their boundary values and marginal endpoints', () => {
  assert.equal(models.triangle.joint(0, 2), 0.5);
  assert.equal(models.triangle.joint(1, 1), 0.5);
  assert.equal(models.triangle.joint(1, 1.01), 0);
  assert.equal(models.triangle.marginal(0), 1);
  assert.equal(models.triangle.marginal(2), 0);
  assert.deepEqual(models.triangle.bounds(2), [0, 0]);

  assert.equal(models.ramp.joint(0, 0), 0);
  assert.equal(models.ramp.joint(2, 2), 0.5);
  assert.equal(models.ramp.marginal(0), 0.25);
  assert.equal(models.ramp.marginal(2), 0.75);
  assert.deepEqual(models.ramp.bounds(0), [0, 2]);
});

test('visible normal slice is explicitly truncated while area remains the full marginal', () => {
  const result = slice('normal', 'x', 0.5);
  close(result.area, models.normal.marginal(0.5));
  assert.deepEqual(result.bounds, [-3, 3]);
  assert.ok(result.visibleArea < result.area);
  assert.equal(result.points.length, 120);
});

