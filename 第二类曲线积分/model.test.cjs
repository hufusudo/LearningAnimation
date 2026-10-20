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

test('partition accumulators equal the sum of their segment contributions', () => {
  for (const path of ['polyline', 'parabola', 'semicircle']) {
    for (const field of ['vortex', 'radial', 'constant']) {
      const partition = M.buildPartition(path, field, 12);
      near(partition.segments.reduce((sum, segment) => sum + segment.wx, 0), partition.total.wx, 1e-12);
      near(partition.segments.reduce((sum, segment) => sum + segment.wy, 0), partition.total.wy, 1e-12);
      near(partition.segments.reduce((sum, segment) => sum + segment.work, 0), partition.total.work, 1e-12);
      near(partition.total.wx + partition.total.wy, partition.total.work, 1e-12);
      assert.equal(partition.count, partition.segments.length);
    }
  }
});

test('reverse partition pairs identical chord midpoints and negates every segment contribution', () => {
  for (const path of ['polyline', 'parabola', 'semicircle']) {
    const forward = M.buildPartition(path, 'vortex', 12);
    const reverse = M.buildPartition(path, 'vortex', 12, true);
    near(reverse.total.wx, -forward.total.wx, 1e-12);
    near(reverse.total.wy, -forward.total.wy, 1e-12);
    near(reverse.total.work, -forward.total.work, 1e-12);
    for (let i = 0; i < 12; i++) {
      const a = forward.segments[i], b = reverse.segments[11 - i];
      near(a.midpoint.x, b.midpoint.x, 1e-12);
      near(a.midpoint.y, b.midpoint.y, 1e-12);
      near(a.dx, -b.dx, 1e-12);
      near(a.dy, -b.dy, 1e-12);
      near(a.wx, -b.wx, 1e-12);
      near(a.wy, -b.wy, 1e-12);
      near(a.work, -b.work, 1e-12);
    }
  }
});

test('uniform parameter partition retains all polyline corners', () => {
  const partition = M.buildPartition('polyline', 'constant', 12);
  for (const t of [1 / 3, 2 / 3]) {
    const point = M.pointAt('polyline', t);
    const boundary = partition.segments.find(segment =>
      Math.hypot(segment.end.x - point.x, segment.end.y - point.y) < 1e-12
    );
    assert.ok(boundary, `missing polyline vertex at t=${t}`);
  }
});

test('radial field has zero midpoint-chord work on every semicircle partition segment', () => {
  for (const count of [6, 12, 24]) {
    const partition = M.buildPartition('semicircle', 'radial', count);
    assert.ok(partition.segments.every(segment => segment.work === 0));
    assert.equal(partition.total.work, 0);
  }
});

test('semicircle vortex partition converges to the analytic integral', () => {
  const exact = -Math.PI * 1.65 ** 2;
  const errors = [6, 12, 24].map(count => Math.abs(M.buildPartition('semicircle', 'vortex', count).total.work - exact));
  assert.ok(errors[1] < errors[0]);
  assert.ok(errors[2] < errors[1]);
});

test('parabola vortex partition converges toward the independently integrated value 76/15', () => {
  const exact = 76 / 15;
  const errors = [6, 12, 24].map(count => Math.abs(M.buildPartition('parabola', 'vortex', count).total.work - exact));
  assert.ok(errors[1] < errors[0]);
  assert.ok(errors[2] < errors[1]);
  near(M.buildPartition('parabola', 'vortex', 24).total.work, exact, 0.02);
});

test('partition rejects counts that would fail to preserve polyline corners', () => {
  for (const count of [0, -3, 5, 12.5]) {
    assert.throws(() => M.buildPartition('polyline', 'vortex', count), /positive multiple of 3/);
  }
});
