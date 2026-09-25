(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  root.CurveIntegralModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CURVE = Object.freeze({ cx: 2, cy: 0, radius: 1, start: -1.05, end: 2.85 });
  const DENSITIES = Object.freeze({
    one: Object.freeze({ label: 'f = 1', shortLabel: '恒定密度' }),
    x: Object.freeze({ label: 'f = x', shortLabel: '随位置变化' }),
    onePlusY2: Object.freeze({ label: 'f = 1 + y²', shortLabel: '弯曲分布' })
  });

  function pointAt(t) {
    return {
      x: CURVE.cx + CURVE.radius * Math.cos(t),
      y: CURVE.cy + CURVE.radius * Math.sin(t)
    };
  }

  function densityAt(name, t) {
    const { x, y } = pointAt(t);
    if (name === 'one') return 1;
    if (name === 'x') return x;
    if (name === 'onePlusY2') return 1 + y * y;
    throw new RangeError(`未知的密度函数：${name}`);
  }

  function segmentGeometry(n, index, reversed = false) {
    if (!Number.isInteger(n) || n < 1) throw new RangeError('分段数必须是正整数');
    if (!Number.isInteger(index) || index < 0 || index >= n) throw new RangeError('线段位置超出范围');
    const start = reversed ? CURVE.end : CURVE.start;
    const end = reversed ? CURVE.start : CURVE.end;
    const step = (end - start) / n;
    const t0 = start + index * step;
    const t1 = t0 + step;
    const p0 = pointAt(t0);
    const p1 = pointAt(t1);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;

    return {
      t0,
      t1,
      ds: CURVE.radius * Math.abs(step),
      dx,
      dy,
      chord: Math.hypot(dx, dy)
    };
  }

  function exactIntegral(name, from = CURVE.start, to = CURVE.end) {
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const span = end - start;
    const { radius, cx } = CURVE;
    if (name === 'one') return radius * span;
    if (name === 'x') return cx * radius * span + radius * radius * (Math.sin(end) - Math.sin(start));
    if (name === 'onePlusY2') {
      return radius * ((1 + radius * radius / 2) * span - radius * radius / 4 * (Math.sin(2 * end) - Math.sin(2 * start)));
    }
    throw new RangeError(`未知的密度函数：${name}`);
  }

  function integrate(name, n, reversed = false) {
    if (!Number.isInteger(n) || n < 1) throw new RangeError('分段数必须是正整数');
    if (!Object.hasOwn(DENSITIES, name)) throw new RangeError(`未知的密度函数：${name}`);

    const start = Math.min(CURVE.start, CURVE.end);
    const end = Math.max(CURVE.start, CURVE.end);
    const deltaT = (end - start) / n;
    const deltaS = CURVE.radius * deltaT;
    let sum = 0;

    for (let i = 0; i < n; i += 1) {
      const midpoint = start + (i + 0.5) * deltaT;
      sum += densityAt(name, midpoint) * deltaS;
    }

    const exact = exactIntegral(name);
    return { sum, exact, error: Math.abs(sum - exact), deltaS, reversed: Boolean(reversed) };
  }

  return { CURVE, DENSITIES, pointAt, densityAt, segmentGeometry, exactIntegral, integrate };
});
