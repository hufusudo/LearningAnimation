const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const near = (actual, expected, tolerance = 0.015) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test('clockwise semicircle in the vortex field does negative work', () => {
  const route = M.buildTrajectory('semicircle', 'vortex');
  near(M.stateAt(route, 1, false).work, -Math.PI * 1.65 ** 2);
  near(M.stateAt(route, 1, true).work, Math.PI * 1.65 ** 2);
});

test('radial field work equals the endpoint potential difference on a bent path', () => {
  const route = M.buildTrajectory('polyline', 'radial');
  near(M.stateAt(route, 1, false).work, -0.51875);
});

test('constant force adds horizontal and vertical endpoint contributions', () => {
  const route = M.buildTrajectory('polyline', 'constant');
  const end = M.stateAt(route, 1, false);
  near(end.wx, 4.94);
  near(end.wy, 1.295);
  near(end.work, 6.235);
});

test('reverse motion keeps force and position but flips the local displacement and work', () => {
  const route = M.buildTrajectory('polyline', 'vortex');
  const forward = M.microAt(route, 0.43, false);
  const reverse = M.microAt(route, 0.57, true);
  near(forward.origin.x, reverse.origin.x, 0.02);
  near(forward.origin.y, reverse.origin.y, 0.02);
  near(forward.P, reverse.P, 0.02);
  near(forward.Q, reverse.Q, 0.02);
  near(forward.dx, -reverse.dx, 0.02);
  near(forward.dy, -reverse.dy, 0.02);
  near(forward.work, -reverse.work, 0.02);
});

test('reverse accumulated work is the negative of the matching forward remainder', () => {
  const route = M.buildTrajectory('polyline', 'vortex');
  const total = M.stateAt(route, 1, false);
  const forward = M.stateAt(route, 0.6, false);
  const reverse = M.stateAt(route, 0.4, true);
  near(reverse.wx, forward.wx - total.wx);
  near(reverse.wy, forward.wy - total.wy);
  near(reverse.work, forward.work - total.work);
});

test('reverse micro displacement leaves a polyline corner along the incoming segment', () => {
  const route = M.buildTrajectory('polyline', 'vortex');
  const cornerArc = route.samples[600].arc / route.length;
  const micro = M.microAt(route, 1 - cornerArc, true);
  assert.ok(micro.dx < 0);
  assert.ok(micro.dy < 0);
});

test('zero-work field does not turn floating-point noise into positive and negative flow bars', () => {
  const route = M.buildTrajectory('semicircle', 'radial');
  assert.ok(M.workBins(route, false, 72).every(value => value === 0));
});

test('bent vortex route keeps both positive and negative local work', () => {
  const route = M.buildTrajectory('polyline', 'vortex');
  const bins = M.workBins(route, false, 72);
  assert.ok(bins.some(value => value > 0));
  assert.ok(bins.some(value => value < 0));
});
