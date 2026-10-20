(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LimitModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const models = {
    'c-damped-sin': {
      name: '阻尼正弦振荡', mode: 'continuous',
      expression: 'f(x) = a + 2.5 sin(2x) / (x^0.85 + 0.4)',
      fn: (x, a) => a + (2.5 * Math.sin(2 * x)) / (Math.pow(x, 0.85) + 0.4),
      bound: x => 2.5 / (Math.pow(x, 0.85) + 0.4),
      root: epsilon => Math.pow(Math.max(0, 2.5 / epsilon - 0.4), 1 / 0.85),
      envelope: '2.5 / (x^0.85 + 0.4)'
    },
    'c-exp-decay': {
      name: '指数衰减余弦波', mode: 'continuous',
      expression: 'f(x) = a + 2.8 exp(-0.18x) cos(1.2x)',
      fn: (x, a) => a + 2.8 * Math.exp(-0.18 * x) * Math.cos(1.2 * x),
      bound: x => 2.8 * Math.exp(-0.18 * x),
      root: epsilon => Math.max(0, Math.log(2.8 / epsilon) / 0.18),
      envelope: '2.8 exp(-0.18x)'
    },
    'c-monotone': {
      name: '单调双曲逼近', mode: 'continuous',
      expression: 'f(x) = a - 3.2 / (x^0.8 + 1)',
      fn: (x, a) => a - 3.2 / (Math.pow(x, 0.8) + 1),
      bound: x => 3.2 / (Math.pow(x, 0.8) + 1),
      root: epsilon => Math.pow(Math.max(0, 3.2 / epsilon - 1), 1 / 0.8),
      envelope: '3.2 / (x^0.8 + 1)'
    },
    'c-rational': {
      name: '有理波动衰减', mode: 'continuous',
      expression: 'f(x) = a + 3.5 cos(1.2x) / (x + 1)',
      fn: (x, a) => a + (3.5 * Math.cos(1.2 * x)) / (x + 1),
      bound: x => 3.5 / (x + 1),
      root: epsilon => Math.max(0, 3.5 / epsilon - 1),
      envelope: '3.5 / (x + 1)'
    },
    'd-alt-harmonic': {
      name: '交错衰减数列', mode: 'discrete',
      expression: 'u_n = a + 3.5 (-1)^n / n^0.75',
      fn: (n, a) => a + (3.5 * Math.pow(-1, n)) / Math.pow(n, 0.75),
      bound: n => 3.5 / Math.pow(n, 0.75),
      root: epsilon => Math.pow(3.5 / epsilon, 1 / 0.75),
      envelope: '3.5 / n^0.75'
    },
    'd-sin-scatter': {
      name: '散点周期震荡', mode: 'discrete',
      expression: 'u_n = a + 3.0 sin(1.2n) / n^0.65',
      fn: (n, a) => a + (3.0 * Math.sin(1.2 * n)) / Math.pow(n, 0.65),
      bound: n => 3.0 / Math.pow(n, 0.65),
      root: epsilon => Math.pow(3.0 / epsilon, 1 / 0.65),
      envelope: '3.0 / n^0.65'
    },
    'd-monotone': {
      name: '单调递增数列', mode: 'discrete',
      expression: 'u_n = a - 3.2 / sqrt(n)',
      fn: (n, a) => a - 3.2 / Math.sqrt(n),
      bound: n => 3.2 / Math.sqrt(n),
      root: epsilon => Math.pow(3.2 / epsilon, 2),
      envelope: '3.2 / sqrt(n)'
    },
    'd-positive-decay': {
      name: '单边递减收敛', mode: 'discrete',
      expression: 'u_n = a + 3.6 / n^0.8',
      fn: (n, a) => a + 3.6 / Math.pow(n, 0.8),
      bound: n => 3.6 / Math.pow(n, 0.8),
      root: epsilon => Math.pow(3.6 / epsilon, 1 / 0.8),
      envelope: '3.6 / n^0.8'
    }
  };

  for (const model of Object.values(models)) {
    model.threshold = epsilon => thresholdFor(model, epsilon);
  }

  function getModel(key) {
    return models[key] || models['c-damped-sin'];
  }

  function validEpsilon(epsilon) {
    if (!Number.isFinite(epsilon) || epsilon <= 0) throw new RangeError('epsilon must be a positive finite number');
  }

  function thresholdFor(model, epsilon) {
    validEpsilon(epsilon);
    const root = model.root(epsilon);
    if (model.mode === 'continuous') return Math.max(0.1, Math.ceil(root * 100) / 100);
    const tolerance = 1e-12 * Math.max(1, Math.abs(root));
    return Math.max(1, Math.floor(root + tolerance));
  }

  function threshold(key, epsilon) {
    return thresholdFor(getModel(key), epsilon);
  }

  function value(key, x, a) {
    const model = getModel(key);
    if (!Number.isFinite(x) || !Number.isFinite(a)) throw new TypeError('x and a must be finite numbers');
    if (model.mode === 'continuous' ? x < 0 : !Number.isInteger(x) || x < 1) {
      throw new RangeError(model.mode === 'continuous' ? 'x must be nonnegative' : 'n must be a positive integer');
    }
    return model.fn(x, a);
  }

  function extent(key, epsilon) {
    validEpsilon(epsilon);
    const controlledEpsilon = Math.max(0.08, Math.min(1.2, epsilon));
    const limit = threshold(key, controlledEpsilon);
    const span = Math.max(25, limit * 1.55);
    return getModel(key).mode === 'discrete' ? Math.ceil(span) : span;
  }

  function proof(key, epsilon) {
    const model = getModel(key);
    const limit = thresholdFor(model, epsilon);
    const label = model.mode === 'continuous' ? 'X' : 'N';
    const relation = model.mode === 'continuous' ? 'x > X' : 'n > N';
    return `|误差| ≤ ${model.envelope}；取 ${label} = ${String(limit)} 后，${relation} 时包络 < ε = ${String(epsilon)}。`;
  }

  return { models, getModel, threshold, value, extent, proof };
});
