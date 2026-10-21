(function (root) {
  'use strict';

  const EPSILON = 3e-14;
  const MAX_ITERATIONS = 300;
  const TINY = 1e-300;
  const GAMMA_COEFFICIENTS = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7
  ];

  function logGamma(z) {
    if (!(z > 0)) return NaN;
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    const shifted = z - 1;
    let sum = 0.99999999999980993;
    for (let i = 0; i < GAMMA_COEFFICIENTS.length; i += 1) sum += GAMMA_COEFFICIENTS[i] / (shifted + i + 1);
    const t = shifted + GAMMA_COEFFICIENTS.length - 0.5;
    return 0.9189385332046727 + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
  }

  function logBeta(a, b) { return logGamma(a) + logGamma(b) - logGamma(a + b); }

  function regularizedGammaQ(a, x) {
    if (x <= 0) return 1;
    if (!Number.isFinite(x)) return 0;
    if (x < a + 1) {
      let term = 1 / a;
      let sum = term;
      let ap = a;
      for (let n = 1; n <= MAX_ITERATIONS; n += 1) {
        ap += 1;
        term *= x / ap;
        sum += term;
        if (Math.abs(term) <= Math.abs(sum) * EPSILON) break;
      }
      const p = sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
      return Math.max(0, Math.min(1, 1 - p));
    }
    let b = x + 1 - a;
    let c = 1 / TINY;
    let d = 1 / (b || TINY);
    let h = d;
    for (let i = 1; i <= MAX_ITERATIONS; i += 1) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < TINY) d = TINY;
      c = b + an / c;
      if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < EPSILON) break;
    }
    return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - logGamma(a)) * h));
  }

  function betaContinuedFraction(a, b, x) {
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - qab * x / qap;
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAX_ITERATIONS; m += 1) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c;
      if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c;
      if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < EPSILON) break;
    }
    return h;
  }

  function regularizedBeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const front = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - logBeta(a, b));
    if (x < (a + 1) / (a + b + 2)) return Math.max(0, Math.min(1, front * betaContinuedFraction(a, b, x) / a));
    return Math.max(0, Math.min(1, 1 - front * betaContinuedFraction(b, a, 1 - x) / b));
  }

  function checkParameters(key, params) {
    if (!params || typeof params !== 'object') throw new TypeError('params must be an object');
    if (key === 'chi' || key === 't') {
      const min = key === 'chi' ? 2 : 1;
      if (!Number.isInteger(params.df) || params.df < min || params.df > 30) throw new RangeError(`${key} df must be an integer from ${min} to 30`);
    } else if (key === 'f') {
      if (!Number.isInteger(params.df1) || params.df1 < 2 || params.df1 > 20) throw new RangeError('f df1 must be an integer from 2 to 20');
      if (!Number.isInteger(params.df2) || params.df2 < 1 || params.df2 > 30) throw new RangeError('f df2 must be an integer from 1 to 30');
    } else throw new RangeError('key must be chi, t, or f');
  }

  function pdf(key, x, params) {
    checkParameters(key, params);
    if (Number.isNaN(x)) return NaN;
    if (key === 'chi') {
      if (x < 0 || x === Infinity) return 0;
      const a = params.df / 2;
      if (x === 0) return params.df === 2 ? 0.5 : 0;
      return Math.exp((a - 1) * Math.log(x) - x / 2 - a * Math.log(2) - logGamma(a));
    }
    if (key === 't') {
      if (!Number.isFinite(x)) return 0;
      const df = params.df;
      return Math.exp(logGamma((df + 1) / 2) - logGamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log1p(x * x / df));
    }
    if (x < 0 || x === Infinity) return 0;
    const a = params.df1 / 2;
    const b = params.df2 / 2;
    if (x === 0) return params.df1 === 2 ? (params.df1 / params.df2) * Math.exp(-logBeta(a, b)) : 0;
    return Math.exp(a * Math.log(params.df1 / params.df2) + (a - 1) * Math.log(x) - logBeta(a, b) - ((params.df1 + params.df2) / 2) * Math.log1p((params.df1 / params.df2) * x));
  }

  function survival(key, x, params) {
    checkParameters(key, params);
    if (Number.isNaN(x)) return NaN;
    if (key === 'chi') return x <= 0 ? 1 : regularizedGammaQ(params.df / 2, x / 2);
    if (key === 't') {
      if (x === 0) return 0.5;
      const halfTail = 0.5 * regularizedBeta(params.df / (params.df + x * x), params.df / 2, 0.5);
      return x > 0 ? halfTail : 1 - halfTail;
    }
    if (x <= 0) return 1;
    const z = params.df2 / (params.df2 + params.df1 * x);
    return regularizedBeta(z, params.df2 / 2, params.df1 / 2);
  }

  function upperQuantile(key, alpha, params) {
    checkParameters(key, params);
    if (!(alpha > 0 && alpha < 1)) throw new RangeError('alpha must be between 0 and 1');
    if (key === 't' && alpha === 0.5) return 0;
    let low = key === 't' ? -1 : 0;
    let high = 1;
    while (survival(key, high, params) > alpha && high < 1e300) high *= 2;
    while (key === 't' && survival(key, low, params) < alpha && low > -1e300) low = low * 2 - 1;
    for (let i = 0; i < 110; i += 1) {
      const mid = low + (high - low) / 2;
      if (survival(key, mid, params) > alpha) low = mid;
      else high = mid;
    }
    return low + (high - low) / 2;
  }

  function addRange(set, start, end, count) {
    if (!(end > start)) return;
    for (let i = 0; i <= count; i += 1) set.add(start + (end - start) * i / count);
  }

  function prepare(key, params, alpha) {
    checkParameters(key, params);
    if (!(alpha > 0 && alpha < 1)) throw new RangeError('alpha must be between 0 and 1');
    const upper = upperQuantile(key, alpha, params);
    const lower = upperQuantile(key, 1 - alpha, params);
    const mode = key === 'chi'
      ? Math.max(0, params.df - 2)
      : key === 't' ? 0
        : params.df1 > 2 ? ((params.df1 - 2) / params.df1) * (params.df2 / (params.df2 + 2)) : 0;
    let xMin;
    let xMax;
    if (key === 't') {
      const extent = Math.max(4.5, Math.abs(upper) * 1.25, Math.abs(lower) * 1.25, mode + 1);
      xMin = -extent;
      xMax = extent;
    } else {
      xMin = 0;
      xMax = Math.max(5, upper * 1.25, lower * 1.25, mode * 1.3 + 1);
    }

    const values = new Set([xMin, xMax, upper, lower, 0, mode]);
    addRange(values, xMin, xMax, 520);
    const focus = Math.max(0.35, Math.min(4, (xMax - xMin) / 18));
    for (const center of [0, mode, upper, lower]) {
      addRange(values, Math.max(xMin, center - focus), Math.min(xMax, center + focus), 140);
      if (key !== 't') {
        for (let i = 0; i <= 100; i += 1) {
          const radius = focus * (i / 100) ** 2;
          const left = center - radius;
          const right = center + radius;
          if (left >= xMin) values.add(left);
          if (right <= xMax) values.add(right);
        }
      }
    }
    const points = [...values].filter(x => x >= xMin && x <= xMax).sort((a, b) => a - b).map(x => ({ x, y: pdf(key, x, params) }));
    const peak = Math.max(pdf(key, mode, params), ...points.map(point => point.y));
    const yMax = Math.max(peak * 1.12, Number.EPSILON);
    const omittedLeft = key === 't' ? 1 - survival('t', xMin, params) : 0;
    const omittedRight = survival(key, xMax, params);
    return { upper, lower, xMin, xMax, yMax, points, omittedLeft, omittedRight };
  }

  const api = { pdf, survival, upperQuantile, prepare };
  root.SamplingModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
