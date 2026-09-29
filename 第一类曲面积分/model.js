/* 曲面 Σ: z = 0.45 + e^{-(x²+y²)/5} + 0.30·sin(1.4x + 1.1y) + 0.16x，D = [-2,2]²。
   单位：cm / g / g·cm⁻²。动画与测试共用同一份数学。 */
(function (root) {
  'use strict';

  const DOMAIN = Object.freeze({ x0: -2, x1: 2, y0: -2, y1: 2 });
  const RHO_MIN = 0.8;
  const RHO_MAX = 3.6;

  const bump = (x, y) => Math.exp(-(x * x + y * y) / 5);
  const wave = (x, y) => 1.4 * x + 1.1 * y;

  const z = (x, y) => 0.45 + bump(x, y) + 0.30 * Math.sin(wave(x, y)) + 0.16 * x;
  const zx = (x, y) => -0.4 * x * bump(x, y) + 0.42 * Math.cos(wave(x, y)) + 0.16;
  const zy = (x, y) => -0.4 * y * bump(x, y) + 0.33 * Math.cos(wave(x, y));

  // dS = dSFactor · dx dy，cos γ = 1 / dSFactor
  const slope = (x, y) => Math.hypot(zx(x, y), zy(x, y));
  const dSFactor = (x, y) => Math.sqrt(1 + zx(x, y) ** 2 + zy(x, y) ** 2);
  const cosGamma = (x, y) => 1 / dSFactor(x, y);
  // 未归一化的斜面法向量 n = (-z_x, -z_y, 1)
  const rawNormal = (x, y) => [-zx(x, y), -zy(x, y), 1];
  const unitNormal = (x, y) => {
    const s = dSFactor(x, y);
    return [-zx(x, y) / s, -zy(x, y) / s, 1 / s];
  };

  let rangeCache = null;
  function zRange() {
    if (rangeCache) return rangeCache;
    let lo = Infinity, hi = -Infinity;
    const steps = 400;
    for (let i = 0; i <= steps; i++) {
      const x = DOMAIN.x0 + (DOMAIN.x1 - DOMAIN.x0) * i / steps;
      for (let j = 0; j <= steps; j++) {
        const v = z(x, DOMAIN.y0 + (DOMAIN.y1 - DOMAIN.y0) * j / steps);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    rangeCache = [lo, hi];
    return rangeCache;
  }

  // 面密度：uniform 恒为 1；gradient 高处重、低处轻（只依赖高度 z）
  function rho(x, y, mode) {
    if (mode === 'uniform') return 1;
    const [lo, hi] = zRange();
    return RHO_MIN + (RHO_MAX - RHO_MIN) * (z(x, y) - lo) / (hi - lo);
  }

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => Math.hypot(a[0], a[1], a[2]);
  const triArea = (a, b, c) => norm(cross(sub(b, a), sub(c, a))) / 2;

  // 一块曲面小方片 ΔS_i 的四个角（数学坐标）
  function cellCorners(n, i, j) {
    const dx = (DOMAIN.x1 - DOMAIN.x0) / n, dy = (DOMAIN.y1 - DOMAIN.y0) / n;
    const xa = DOMAIN.x0 + i * dx, xb = xa + dx;
    const ya = DOMAIN.y0 + j * dy, yb = ya + dy;
    return [
      [xa, ya, z(xa, ya)], [xb, ya, z(xb, ya)],
      [xb, yb, z(xb, yb)], [xa, yb, z(xa, yb)]
    ];
  }

  // 小方片面积（按实际画出来的两块三角形求和，与三维网格一致）
  function cellArea(n, i, j) {
    const [a, b, c, d] = cellCorners(n, i, j);
    return triArea(a, b, c) + triArea(a, c, d);
  }

  function cellCenter(n, i, j) {
    const dx = (DOMAIN.x1 - DOMAIN.x0) / n, dy = (DOMAIN.y1 - DOMAIN.y0) / n;
    return [DOMAIN.x0 + (i + 0.5) * dx, DOMAIN.y0 + (j + 0.5) * dy];
  }

  // 中点法求和：面积与质量（就是仪表牌上滚动的数）
  function sums(n, mode) {
    let area = 0, mass = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = cellArea(n, i, j);
        const [cx, cy] = cellCenter(n, i, j);
        area += a;
        mass += rho(cx, cy, mode) * a;
      }
    }
    return { area, mass, cells: n * n };
  }

  // 精确值：∬ √(1+z_x²+z_y²) dxdy 与 ∬ ρ √(1+z_x²+z_y²) dxdy
  let exactCache = {};
  function exact(mode, res = 420) {
    const key = `${mode}|${res}`;
    if (exactCache[key]) return exactCache[key];
    const dx = (DOMAIN.x1 - DOMAIN.x0) / res, dy = (DOMAIN.y1 - DOMAIN.y0) / res;
    let area = 0, mass = 0;
    for (let i = 0; i < res; i++) {
      const x = DOMAIN.x0 + (i + 0.5) * dx;
      for (let j = 0; j < res; j++) {
        const y = DOMAIN.y0 + (j + 0.5) * dy;
        const jacobian = dSFactor(x, y);
        area += jacobian * dx * dy;
        mass += rho(x, y, mode) * jacobian * dx * dy;
      }
    }
    exactCache[key] = { area, mass };
    return exactCache[key];
  }

  root.SurfaceModel = Object.freeze({
    DOMAIN, RHO_MIN, RHO_MAX,
    z, zx, zy, slope, dSFactor, cosGamma, rawNormal, unitNormal,
    zRange, rho, cellCorners, cellArea, cellCenter, sums, exact
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
