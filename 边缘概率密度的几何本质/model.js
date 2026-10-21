(function (root) {
  'use strict';

  const NORMAL_RANGE = [-3, 3];
  const SQUARE_RANGE = [0, 2];
  const SQRT_2PI = Math.sqrt(2 * Math.PI);

  function validRho(rho) {
    return Number.isFinite(rho) && Math.abs(rho) < 1;
  }

  function inRange(value, range) {
    return Number.isFinite(value) && value >= range[0] && value <= range[1];
  }

  function integrate(fn, a, b, n = 2000) {
    if (![a, b].every(Number.isFinite)) return NaN;
    const steps = Math.max(1, Math.floor(Number.isFinite(n) ? n : 2000));
    if (a === b) return 0;
    const h = (b - a) / steps;
    let sum = (fn(a) + fn(b)) / 2;
    for (let i = 1; i < steps; i += 1) sum += fn(a + i * h);
    return sum * h;
  }

  function integrateMidpoint(fn, a, b, n = 2000) {
    if (a === b) return 0;
    const steps = Math.max(1, Math.floor(Number.isFinite(n) ? n : 2000));
    const h = (b - a) / steps;
    let sum = 0;
    for (let i = 0; i < steps; i += 1) sum += fn(a + (i + 0.5) * h);
    return sum * h;
  }

  const models = {
    normal: {
      name: '二维正态分布',
      range: NORMAL_RANGE,
      joint(x, y, rho = 0.4) {
        if (!validRho(rho) || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
        const oneMinusRho2 = 1 - rho * rho;
        const exponent = -(x * x - 2 * rho * x * y + y * y) / (2 * oneMinusRho2);
        return Math.exp(exponent) / (2 * Math.PI * Math.sqrt(oneMinusRho2));
      },
      marginal(u) {
        return Number.isFinite(u) ? Math.exp(-0.5 * u * u) / SQRT_2PI : 0;
      },
      bounds(u) {
        return inRange(u, NORMAL_RANGE) ? [...NORMAL_RANGE] : [0, 0];
      },
      peak(rho = 0.4) {
        return validRho(rho) ? 1 / (2 * Math.PI * Math.sqrt(1 - rho * rho)) : 0;
      }
    },
    triangle: {
      name: '三角形域二维均匀分布',
      range: SQUARE_RANGE,
      joint(x, y) {
        return inRange(x, SQUARE_RANGE) && inRange(y, SQUARE_RANGE) && y <= 2 - x ? 0.5 : 0;
      },
      marginal(u) {
        return inRange(u, SQUARE_RANGE) ? 0.5 * (2 - u) : 0;
      },
      bounds(u) {
        return inRange(u, SQUARE_RANGE) ? [0, 2 - u] : [0, 0];
      },
      peak() { return 0.5; }
    },
    ramp: {
      name: '斜坡分布 f(x,y)=(x+y)/8',
      range: SQUARE_RANGE,
      joint(x, y) {
        return inRange(x, SQUARE_RANGE) && inRange(y, SQUARE_RANGE) ? (x + y) / 8 : 0;
      },
      marginal(u) {
        return inRange(u, SQUARE_RANGE) ? (u + 1) / 4 : 0;
      },
      bounds(u) {
        return inRange(u, SQUARE_RANGE) ? [...SQUARE_RANGE] : [0, 0];
      },
      peak() { return 0.5; }
    }
  };

  function slice(key, dir, u, rho = 0.4, count = 120) {
    const model = models[key];
    if (!model) throw new RangeError(`Unknown density model: ${key}`);
    if (dir !== 'x' && dir !== 'y') throw new RangeError(`Unknown slice direction: ${dir}`);

    const bounds = model.bounds(u);
    const area = model.marginal(u);
    const n = Math.max(2, Math.floor(Number.isFinite(count) ? count : 120));
    const [a, b] = bounds;
    const points = [];

    if (b > a) {
      const step = (b - a) / (n - 1);
      for (let i = 0; i < n; i += 1) {
        const v = i === n - 1 ? b : a + i * step;
        const density = dir === 'x' ? model.joint(u, v, rho) : model.joint(v, u, rho);
        points.push({ v, density, conditional: area > 0 ? density / area : null });
      }
    }

    const visibleArea = b > a
      ? integrateMidpoint((v) => dir === 'x' ? model.joint(u, v, rho) : model.joint(v, u, rho), a, b)
      : 0;

    return { points, area, visibleArea, conditionalDefined: area > 0, bounds };
  }

  const api = { models, slice, integrate };
  root.DensityModel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
