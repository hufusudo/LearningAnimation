/**
 * 第一类曲线积分 · 纯计算模型（视图无关）
 * 曲线统一表示为 y = f(x)，x ∈ [a, b]，因此弧长微元可写成
 *   ds = sqrt(1 + [y'(x)]^2) dx
 * 所有数值积分使用自适应步长足够细的 Simpson 法，保证参考值稳定。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CurveModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAU = Math.PI * 2;

  /** 曲线预设：全部是定义在 [a, b] 上的显函数 y = f(x) */
  const CURVES = {
    parabola: {
      id: 'parabola',
      label: '抛物线段 y = x²',
      short: '抛物线',
      tex: 'y = x^{2}',
      a: 0.05,
      b: 1.4,
      y(x) { return x * x; },
      dy(x) { return 2 * x; }
    },
    semicircle: {
      id: 'semicircle',
      label: '半圆弧线',
      short: '半圆弧',
      tex: 'y = \\sqrt{1.21-(x-1.1)^{2}}',
      // 圆心 (1.1, 0)，半径 1.1，取 θ ∈ [30°, 150°]，避免端点出现竖直切线
      a: 1.1 - 1.1 * Math.cos(Math.PI / 6),
      b: 1.1 + 1.1 * Math.cos(Math.PI / 6),
      y(x) { return Math.sqrt(Math.max(1.21 - (x - 1.1) * (x - 1.1), 0)); },
      dy(x) {
        const u = 1.21 - (x - 1.1) * (x - 1.1);
        return -(x - 1.1) / Math.sqrt(Math.max(u, 1e-12));
      },
      radius: 1.1
    },
    line: {
      id: 'line',
      label: '直线对照',
      short: '直线',
      tex: 'y = 0.6x + 0.35',
      a: 0.1,
      b: 2.0,
      y(x) { return 0.6 * x + 0.35; },
      dy() { return 0.6; }
    }
  };

  /** 线密度分布 */
  const DENSITIES = {
    uniform: {
      id: 'uniform',
      label: '均匀 ρ = 1',
      tex: '\\rho = 1',
      rho() { return 1; }
    },
    gradient: {
      id: 'gradient',
      label: '渐变 ρ = x + y',
      tex: '\\rho = x + y',
      rho(x, y) { return x + y; }
    }
  };

  const simpson = (f, a, b, n) => {
    const steps = n % 2 === 0 ? n : n + 1;
    const h = (b - a) / steps;
    let sum = f(a) + f(b);
    for (let i = 1; i < steps; i++) {
      sum += f(a + i * h) * (i % 2 === 0 ? 2 : 4);
    }
    return (sum * h) / 3;
  };

  /** 采样曲线（等 x 步长） */
  function sample(curve, n) {
    const out = [];
    const h = (curve.b - curve.a) / n;
    for (let i = 0; i <= n; i++) {
      const x = curve.a + i * h;
      out.push({ x, y: curve.y(x) });
    }
    return out;
  }

  /** 精确弧长 L = ∫ sqrt(1 + y'^2) dx */
  function arcLength(curve, n) {
    return simpson((x) => Math.sqrt(1 + curve.dy(x) * curve.dy(x)), curve.a, curve.b, n || 2048);
  }

  /** 精确总质量 M = ∫ rho(x, y(x)) sqrt(1 + y'^2) dx */
  function totalMass(curve, density, n) {
    return simpson(
      (x) => density.rho(x, curve.y(x)) * Math.sqrt(1 + curve.dy(x) * curve.dy(x)),
      curve.a, curve.b, n || 2048
    );
  }

  /**
   * 把曲线切成 N 段微元。
   * ds 采用弦长 sqrt(dx^2 + dy^2)（与图上勾股三角形完全一致），
   * dsSlope 采用斜率形式 sqrt(1 + y'^2) * dx（与微分代换一致）。
   */
  function segments(curve, density, N) {
    const out = [];
    const h = (curve.b - curve.a) / N;
    for (let i = 0; i < N; i++) {
      const x0 = curve.a + i * h;
      const x1 = x0 + h;
      const xm = (x0 + x1) / 2;
      const y0 = curve.y(x0);
      const y1 = curve.y(x1);
      const ym = curve.y(xm);
      const dx = x1 - x0;
      const dy = y1 - y0;
      const ds = Math.hypot(dx, dy);
      const slope = curve.dy(xm);
      const dsSlope = Math.sqrt(1 + slope * slope) * dx;
      const rho = density.rho(xm, ym);
      out.push({
        i, x0, x1, xm, y0, y1, ym, dx, dy, slope,
        ds, dsSlope, rho,
        dm: rho * ds
      });
    }
    return out;
  }

  /** 当前 N 下的近似统计 + 高精度参考值 */
  function stats(curve, density, N) {
    const segs = segments(curve, density, N);
    let L = 0;
    let M = 0;
    let maxDm = 0;
    for (const s of segs) {
      L += s.ds;
      M += s.dm;
      if (s.dm > maxDm) maxDm = s.dm;
    }
    return {
      segs, L, M, maxDm,
      exactL: arcLength(curve),
      exactM: totalMass(curve, density)
    };
  }

  /** 曲线取值范围（带 padding），用于建立视图变换 */
  function bounds(curve, padFrac) {
    const pts = sample(curve, 240);
    let x0 = curve.a;
    let x1 = curve.b;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    const px = (x1 - x0) * padFrac;
    const py = (y1 - y0) * padFrac || padFrac;
    return { x0: x0 - px, x1: x1 + px, y0: y0 - py, y1: y1 + py };
  }

  /** 线密度取值范围（用于配色图例） */
  function densityRange(curve, density) {
    const pts = sample(curve, 200);
    let min = Infinity;
    let max = -Infinity;
    for (const p of pts) {
      const v = density.rho(p.x, p.y);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min < 1e-9) max = min + 1;
    return { min, max };
  }

  /** 曲线上离给定世界坐标最近的点（用于探针读数） */
  function nearest(curve, wx, wy, n) {
    const pts = sample(curve, n || 400);
    let best = pts[0];
    let bd = Infinity;
    for (const p of pts) {
      const d = (p.x - wx) * (p.x - wx) + (p.y - wy) * (p.y - wy);
      if (d < bd) { bd = d; best = p; }
    }
    return { point: best, dist: Math.sqrt(bd) };
  }

  return {
    CURVES,
    DENSITIES,
    TAU,
    sample,
    arcLength,
    totalMass,
    segments,
    stats,
    bounds,
    densityRange,
    nearest
  };
});
