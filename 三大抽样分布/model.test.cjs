'use strict';

const assert = require('node:assert/strict');
const model = require('./model.js');

function close(actual, expected, tolerance, label) {
  assert.ok(Number.isFinite(actual), `${label}: expected finite value, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${label}: ${actual} differs from ${expected}`);
}

function integrateTransformed(key, params, n = 20000) {
  let sum = 0;
  for (let i = 0; i <= n; i += 1) {
    const u = i / n;
    let x;
    let jacobian;
    if (key === 't') {
      const angle = Math.PI * (u - 0.5);
      x = Math.tan(angle);
      jacobian = Math.PI / Math.cos(angle) ** 2;
    } else {
      const ratio = u / (1 - u);
      x = key === 'f' ? ratio ** 2 : ratio;
      jacobian = key === 'f' ? 2 * u / (1 - u) ** 3 : 1 / (1 - u) ** 2;
    }
    const value = (u === 1) ? 0 : model.pdf(key, x, params) * jacobian;
    sum += (i === 0 || i === n ? 1 : i % 2 === 0 ? 2 : 4) * value;
  }
  return sum / (3 * n);
}

close(model.pdf('chi', 0, { df: 2 }), 0.5, 1e-14, 'chi-square df=2 density at zero');
close(model.pdf('f', 0, { df1: 2, df2: 8 }), 1, 1e-14, 'F(2,8) density at zero');

for (const alpha of [0.01, 0.05, 0.1, 0.5, 0.9, 0.99]) {
  const x = model.upperQuantile('chi', alpha, { df: 2 });
  close(x, -2 * Math.log(alpha), 2e-12, `chi-square df=2 ISF(${alpha}) closed form`);
  const t = model.upperQuantile('t', alpha, { df: 1 });
  close(t, 1 / Math.tan(Math.PI * alpha), 2e-12, `Cauchy ISF(${alpha}) closed form`);
  close(model.upperQuantile('f', alpha, { df1: 2, df2: 2 }), (1 - alpha) / alpha, 2e-12, `F(2,2) ISF(${alpha}) closed form`);
}

close(model.upperQuantile('chi', 0.05, { df: 8 }), 15.5073130559, 2e-10, 'chi-square table value');
close(model.upperQuantile('t', 0.05, { df: 8 }), 1.8595480375, 2e-10, 't table value');
close(model.upperQuantile('f', 0.05, { df1: 5, df2: 10 }), 3.3258345304, 2e-10, 'F table value');

for (const [key, params] of [
  ['chi', { df: 2 }], ['chi', { df: 8 }], ['chi', { df: 30 }],
  ['t', { df: 1 }], ['t', { df: 8 }], ['t', { df: 30 }],
  ['f', { df1: 2, df2: 1 }], ['f', { df1: 5, df2: 10 }], ['f', { df1: 20, df2: 30 }]
]) {
  for (const alpha of [0.01, 0.05, 0.1, 0.5, 0.9, 0.99]) {
    const q = model.upperQuantile(key, alpha, params);
    assert.ok(Number.isFinite(q), `${key} ISF ${JSON.stringify(params)} alpha=${alpha} finite`);
    close(model.survival(key, q, params), alpha, 2e-9, `${key} inverse survival ${JSON.stringify(params)} alpha=${alpha}`);
  }
}

for (const x of [-10, -2, -0.1, 0, 0.1, 2, 10]) {
  close(model.pdf('t', x, { df: 7 }), model.pdf('t', -x, { df: 7 }), 1e-14, `t pdf symmetry x=${x}`);
  close(model.survival('t', x, { df: 7 }) + model.survival('t', -x, { df: 7 }), 1, 2e-14, `t tail symmetry x=${x}`);
}

for (const alpha of [0.01, 0.05, 0.1, 0.5, 0.9]) {
  for (const [df1, df2] of [[2, 2], [5, 10], [20, 10]]) {
    const direct = model.upperQuantile('f', alpha, { df1, df2 });
    const reciprocal = 1 / model.upperQuantile('f', 1 - alpha, { df1: df2, df2: df1 });
    close(direct, reciprocal, 5e-10, `F reciprocal df=${df1},${df2} alpha=${alpha}`);
  }
}

for (const [key, params] of [['chi', { df: 2 }], ['t', { df: 1 }], ['f', { df1: 2, df2: 1 }], ['chi', { df: 30 }], ['t', { df: 30 }], ['f', { df1: 20, df2: 30 }]]) {
  close(integrateTransformed(key, params), 1, 3e-5, `${key} transformed density integral ${JSON.stringify(params)}`);
}

for (const [key, params] of [['chi', { df: 2 }], ['t', { df: 1 }], ['f', { df1: 2, df2: 1 }]]) {
  const view = model.prepare(key, params, 0.01);
  assert.ok(view.xMin < view.upper && view.upper < view.xMax, `${key} window contains upper point`);
  assert.ok(view.points.some(point => point.x === view.upper), `${key} samples upper point exactly`);
  assert.ok(view.points.some(point => point.x === view.lower), `${key} samples lower point exactly`);
  assert.ok(view.points.some(point => point.x === 0), `${key} samples origin exactly`);
  assert.ok(view.points.some(point => point.x === 0 && point.y > 0), `${key} origin peak is visible`);
  assert.ok(Number.isFinite(view.yMax) && view.yMax > 0, `${key} finite positive yMax`);
  assert.ok(view.omittedLeft >= 0 && view.omittedRight >= 0 && view.omittedLeft < 1 && view.omittedRight < 1, `${key} reports finite omitted probabilities`);
}

assert.throws(() => model.pdf('chi', 1, { df: 1 }), RangeError);
assert.throws(() => model.pdf('t', 1, { df: 31 }), RangeError);
assert.throws(() => model.pdf('f', 1, { df1: 21, df2: 10 }), RangeError);
assert.throws(() => model.upperQuantile('chi', 0, { df: 2 }), RangeError);
assert.throws(() => model.pdf('unknown', 1, {}), RangeError);

console.log('sampling model tests passed');
