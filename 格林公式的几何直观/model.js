/* 格林公式演示共享数值模型：向量场、边界多边形、线积分 / 面积分 / 网格求和。
   线积分用每段两点 Gauss 求积（对三次以下多项式精确），面积分用扇形三角化 + 三边中点求积（对二次以下多项式精确）。 */
(function (root) {
  'use strict';

  /* ---- 光滑场：P = x² − y²，Q = 2xy + x，旋度 ∂Q/∂x − ∂P/∂y = 1 + 4y ---- */
  const SMOOTH = {
    id: 'smooth',
    P: (x, y) => x * x - y * y,
    Q: (x, y) => 2 * x * y + x,
    curl: (x, y) => 1 + 4 * y,
    dQdx: (x, y) => 2 * y + 1,
    dPdy: (x, y) => -2 * y
  };

  /* ---- 奇异场：F = (−y, x) / (x² + y²)，原点外旋度恒为 0，绕原点一圈做功 2π ---- */
  const SINGULAR = {
    id: 'singular',
    P: (x, y) => { const r2 = x * x + y * y || 1e-12; return -y / r2; },
    Q: (x, y) => { const r2 = x * x + y * y || 1e-12; return x / r2; },
    curl: () => 0
  };

  /* ---- 两点 Gauss–Legendre（[0,1] 区间，权重各 1/2） ---- */
  const GAUSS_T = [0.5 - 0.5 / Math.sqrt(3), 0.5 + 0.5 / Math.sqrt(3)];

  function polylineIntegral(pts, field, closed) {
    const n = pts.length;
    const segs = closed ? n : n - 1;
    let sum = 0;
    for (let i = 0; i < segs; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      for (let g = 0; g < 2; g++) {
        const t = GAUSS_T[g];
        const x = a.x + dx * t;
        const y = a.y + dy * t;
        sum += (field.P(x, y) * dx + field.Q(x, y) * dy) * 0.5;
      }
    }
    return sum;
  }

  function signedArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  }

  /* 面积重心（用于扇形三角化的内点） */
  function polygonCentroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const w = p.x * q.y - q.x * p.y;
      a += w;
      cx += (p.x + q.x) * w;
      cy += (p.y + q.y) * w;
    }
    if (Math.abs(a) < 1e-12) {
      let sx = 0, sy = 0;
      pts.forEach(p => { sx += p.x; sy += p.y; });
      return { x: sx / pts.length, y: sy / pts.length };
    }
    return { x: cx / (3 * a), y: cy / (3 * a) };
  }

  function triangleIntegral(a, b, c, f) {
    const area = Math.abs(signedArea([a, b, c]));
    const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const m2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    const m3 = { x: (c.x + a.x) / 2, y: (c.y + a.y) / 2 };
    return area / 3 * (f(m1.x, m1.y) + f(m2.x, m2.y) + f(m3.x, m3.y));
  }

  /* 扇形三角化：以内点为公共顶点（区域须关于该点星形） */
  function polygonDoubleIntegral(pts, f) {
    const o = polygonCentroid(pts);
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      sum += triangleIntegral(o, a, b, f);
    }
    return sum;
  }

  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > pt.y) !== (b.y > pt.y) &&
        pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  /* 绕数：奇点是否被外边界包住 */
  function windingNumber(poly, pt) {
    let w = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const a1 = Math.atan2(a.y - pt.y, a.x - pt.x);
      const a2 = Math.atan2(b.y - pt.y, b.x - pt.x);
      let d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      w += d;
    }
    return w / (2 * Math.PI);
  }

  /* ---- 形状：关于 x 轴对称的花瓣形闭域（保证形心落在 x 轴上，∬4y dA = 0） ---- */
  const BLOB = { radius: 1.22, a: 0.15, b: 0.11, segments: 256 };

  function blob(radius, segments, a, b) {
    const R = radius === undefined ? BLOB.radius : radius;
    const n = segments === undefined ? BLOB.segments : segments;
    const ca = a === undefined ? BLOB.a : a;
    const cb = b === undefined ? BLOB.b : b;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      const r = R * (1 + ca * Math.cos(2 * th) + cb * Math.cos(3 * th));
      pts.push({ x: r * Math.cos(th), y: r * Math.sin(th) });
    }
    return pts;
  }

  /* 抛物线弧：起点 A(2,0)，终点 B(−2,0)，y = 1 − x²/4 */
  function parabolaArc(segments) {
    const n = segments === undefined ? 240 : segments;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const x = 2 - 4 * (i / n);
      pts.push({ x, y: 1 - x * x / 4 });
    }
    return pts;
  }

  /* 补线 L2：从 B(−2,0) 直达 A(2,0)，落在 x 轴上，dy = 0 */
  const AXIS_SEGMENT = [{ x: -2, y: 0 }, { x: 2, y: 0 }];

  /* ---- 网格：按中心取样，接触边 / 外轮廓边 ---- */
  const GRID = { extent: 1.6, n: 16, min: 8, max: 32 };

  function makeGrid(n, lo, hi) {
    return { n, lo, hi, h: (hi - lo) / n };
  }

  function cellCenter(g, i, j) {
    return { x: g.lo + (i + 0.5) * g.h, y: g.lo + (j + 0.5) * g.h };
  }

  /* 返回布尔矩阵 inside[j][i]：中心落在区域内的格子 */
  function insideMask(g, poly) {
    const mask = [];
    for (let j = 0; j < g.n; j++) {
      const row = [];
      for (let i = 0; i < g.n; i++) row.push(pointInPolygon(cellCenter(g, i, j), poly));
      mask.push(row);
    }
    return mask;
  }

  function gridSum(g, mask, f) {
    let sum = 0;
    for (let j = 0; j < g.n; j++) {
      for (let i = 0; i < g.n; i++) {
        if (!mask[j][i]) continue;
        const c = cellCenter(g, i, j);
        sum += f(c.x, c.y) * g.h * g.h;
      }
    }
    return sum;
  }

  function countInside(mask) {
    let k = 0;
    mask.forEach(row => row.forEach(v => { if (v) k++; }));
    return k;
  }

  /* 内部接触边：上下 / 左右相邻两格共享的边 */
  function contactEdges(g, mask) {
    const edges = [];
    for (let j = 0; j < g.n; j++) {
      for (let i = 0; i < g.n; i++) {
        if (!mask[j][i]) continue;
        if (i + 1 < g.n && mask[j][i + 1]) {
          const x = g.lo + (i + 1) * g.h;
          edges.push({ x1: x, y1: g.lo + j * g.h, x2: x, y2: g.lo + (j + 1) * g.h });
        }
        if (j + 1 < g.n && mask[j + 1][i]) {
          const y = g.lo + (j + 1) * g.h;
          edges.push({ x1: g.lo + i * g.h, y1: y, x2: g.lo + (i + 1) * g.h, y2: y });
        }
      }
    }
    return edges;
  }

  /* 格子并集的外轮廓边（未被抵消的部分，逼近 L） */
  function boundaryEdges(g, mask) {
    const edges = [];
    const has = (i, j) => i >= 0 && j >= 0 && i < g.n && j < g.n && mask[j][i];
    for (let j = 0; j < g.n; j++) {
      for (let i = 0; i < g.n; i++) {
        if (!mask[j][i]) continue;
        const x0 = g.lo + i * g.h, y0 = g.lo + j * g.h, x1 = x0 + g.h, y1 = y0 + g.h;
        if (!has(i - 1, j)) edges.push({ x1: x0, y1: y0, x2: x0, y2: y1 });
        if (!has(i + 1, j)) edges.push({ x1: x1, y1: y0, x2: x1, y2: y1 });
        if (!has(i, j - 1)) edges.push({ x1: x0, y1: y0, x2: x1, y2: y0 });
        if (!has(i, j + 1)) edges.push({ x1: x0, y1: y1, x2: x1, y2: y1 });
      }
    }
    return edges;
  }

  /* ---- 挖洞法复合边界：外环 + 割线进 + 内环(顺时针) + 割线出 ---- */
  function cutAnglePoint(poly, angle) {
    let best = poly[0], bestD = Infinity;
    poly.forEach(p => {
      const th = Math.atan2(p.y, p.x);
      let d = Math.abs(th - angle);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < bestD) { bestD = d; best = p; }
    });
    return best;
  }

  function innerCircle(radius, angle, segments) {
    const n = segments === undefined ? 200 : segments;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const th = angle - (i / n) * Math.PI * 2; /* 顺时针 */
      pts.push({ x: radius * Math.cos(th), y: radius * Math.sin(th) });
    }
    return pts;
  }

  function buildCutContour(outer, radius, angle, segments) {
    const from = cutAnglePoint(outer, angle);
    const inner = innerCircle(radius, angle, segments);
    const to = inner[0];
    const back = inner[inner.length - 1];
    return {
      outer, inner,
      cutIn: [from, to],
      cutOut: [back, from],
      junction: from
    };
  }

  function compositeIntegral(contour, field) {
    const cutIn = polylineIntegral(contour.cutIn, field, false);
    const cutOut = polylineIntegral(contour.cutOut, field, false);
    const outer = polylineIntegral(contour.outer, field, true);
    const inner = polylineIntegral(contour.inner, field, true);
    return { outer, inner, cutIn, cutOut, total: outer + inner + cutIn + cutOut };
  }

  /* ---- 单个微元（右栏特写）：与主网格一致的格子 ---- */
  const MICRO = {
    x0: 0.6, y0: 0.4, h: 0.2,
    get x1() { return this.x0 + this.h; },
    get y1() { return this.y0 + this.h; },
    get center() { return { x: this.x0 + this.h / 2, y: this.y0 + this.h / 2 }; }
  };

  function microEdges() {
    const { x0, y0, x1, y1 } = MICRO;
    return {
      bottom: polylineIntegral([{ x: x0, y: y0 }, { x: x1, y: y0 }], SMOOTH, false),
      right: polylineIntegral([{ x: x1, y: y0 }, { x: x1, y: y1 }], SMOOTH, false),
      top: polylineIntegral([{ x: x1, y: y1 }, { x: x0, y: y1 }], SMOOTH, false),
      left: polylineIntegral([{ x: x0, y: y1 }, { x: x0, y: y0 }], SMOOTH, false)
    };
  }

  function microTotal() {
    const e = microEdges();
    return e.bottom + e.right + e.top + e.left;
  }

  /* 解析参考值 */
  const ANALYTIC = {
    blobArea: Math.PI * BLOB.radius ** 2 * (1 + BLOB.a ** 2 / 2 + BLOB.b ** 2 / 2),
    phase2Loop: 104 / 15,       /* ∮(L1+L2) = ∬_D (1+4y) dA = 8/3 + 64/15 */
    phase2Axis: 16 / 3,         /* ∫_L2 P dx = ∫_{-2}^{2} x² dx（dy = 0）*/
    phase2Arc: 8 / 5,           /* ∫_L1 = ∮ − ∫_L2 = 1.6 */
    circulation: 2 * Math.PI    /* 奇异场绕原点一圈 */
  };

  root.GreenModel = Object.freeze({
    SMOOTH, SINGULAR, BLOB, MICRO, ANALYTIC, AXIS_SEGMENT, GRID,
    polylineIntegral, signedArea, polygonCentroid, polygonDoubleIntegral,
    pointInPolygon, windingNumber,
    blob, parabolaArc,
    makeGrid, cellCenter, insideMask, gridSum, countInside, contactEdges, boundaryEdges,
    cutAnglePoint, innerCircle, buildCutContour, compositeIntegral,
    microEdges, microTotal
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
