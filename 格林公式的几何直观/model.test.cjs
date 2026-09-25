const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = {};
const file = path.join(__dirname, 'model.js');
if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
const m = context.GreenModel;
const near = (a, b, tol = 1e-9, msg = '') =>
  assert.ok(Math.abs(a - b) < tol, `${msg} ${a} != ${b} (tol ${tol})`);

test('模型已实现，光滑场旋度等于 ∂Q/∂x − ∂P/∂y', () => {
  assert.ok(m, 'GreenModel 尚未实现');
  const f = m.SMOOTH;
  [[0.7, 0.5], [-1.3, 0.42], [2, -2]].forEach(([x, y]) => {
    const h = 1e-6;
    const dQ = (f.Q(x + h, y) - f.Q(x - h, y)) / (2 * h);
    const dP = (f.P(x, y + h) - f.P(x, y - h)) / (2 * h);
    near(dQ - dP, f.curl(x, y), 1e-6, `curl at ${x},${y}`);
    near(f.dQdx(x, y), dQ, 1e-6);
    near(f.dPdy(x, y), dP, 1e-6);
  });
});

test('单个微元：四边环流之和精确等于旋度 × dx dy', () => {
  const e = m.microEdges();
  near(e.bottom, 0.06666666666666665, 1e-12, 'bottom');
  near(e.right, 0.32, 1e-12, 'right');
  near(e.top, -0.026666666666666636, 1e-12, 'top');
  near(e.left, -0.24, 1e-12, 'left');
  const c = m.MICRO.center;
  const total = m.microTotal();
  near(total, m.SMOOTH.curl(c.x, c.y) * m.MICRO.h * m.MICRO.h, 1e-12, '微元净环流');
  near(total, 0.12, 1e-12);
});

test('阶段一：闭合曲线线积分与旋度面积分完全一致，并等于区域面积', () => {
  const L = m.blob();
  assert.ok(m.signedArea(L) > 0, '外边界必须逆时针');
  const line = m.polylineIntegral(L, m.SMOOTH, true);
  const area = m.polygonDoubleIntegral(L, (x, y) => m.SMOOTH.curl(x, y));
  near(line, area, 1e-10, '格林公式');
  near(area, m.ANALYTIC.blobArea, 2e-3, '解析面积（折线离散）');
  near(m.signedArea(L), m.ANALYTIC.blobArea, 2e-3);
  near(m.polygonDoubleIntegral(L, (x, y) => 4 * y), 0, 1e-9, '对称使 ∬4y = 0');
  [[m.MICRO.x0, m.MICRO.y0], [m.MICRO.x1, m.MICRO.y0], [m.MICRO.x1, m.MICRO.y1], [m.MICRO.x0, m.MICRO.y1]]
    .forEach(([x, y]) => assert.ok(m.pointInPolygon({ x, y }, L), `微元角点 ${x},${y} 应在 L 内部`));
});

test('阶段二：补线法三个数值满足 ∮ = ∬，且 ∫L1 = ∮ − ∫L2', () => {
  const arc = m.parabolaArc();
  const closed = arc.concat(m.AXIS_SEGMENT.slice(1));
  const loop = m.polylineIntegral(closed, m.SMOOTH, true);
  const axis = m.polylineIntegral(m.AXIS_SEGMENT, m.SMOOTH, false);
  const open = m.polylineIntegral(arc, m.SMOOTH, false);
  near(loop, m.ANALYTIC.phase2Loop, 1e-3, '∮(L1+L2)');
  near(axis, m.ANALYTIC.phase2Axis, 1e-12, '∫L2 只剩 P dx');
  near(open, m.ANALYTIC.phase2Arc, 1e-3, '∫L1');
  near(loop - axis, open, 1e-12, '回写恒等式');
  assert.ok(m.signedArea(closed) > 0, '补线后应为逆时针正向');
  const area = m.polygonDoubleIntegral(closed, (x, y) => m.SMOOTH.curl(x, y));
  near(area, loop, 1e-10, '∮ = ∬');
});

test('阶段三：奇异场旋度为 0，外环与顺时针内环各自 ±2π，割线精确相消', () => {
  const f = m.SINGULAR;
  near(f.curl(0.3, -0.7), 0);
  const ccwCircle = m.innerCircle(1, 0, 400).slice(0, 400).reverse();
  near(m.polylineIntegral(ccwCircle, f, true), m.ANALYTIC.circulation, 1e-8, '单位圆 2π（400 段折线）');

  const outer = m.blob();
  assert.equal(Math.round(m.windingNumber(outer, { x: 0, y: 0 })), 1, '奇点在外环内部');
  const contour = m.buildCutContour(outer, 0.32, 0.6);
  const parts = m.compositeIntegral(contour, f);
  near(parts.outer, m.ANALYTIC.circulation, 1e-7, '外环 2π');
  near(parts.inner, -m.ANALYTIC.circulation, 1e-7, '顺时针内环 −2π');
  near(parts.cutIn + parts.cutOut, 0, 1e-12, '割线一进一出完全抵消');
  near(parts.total, 0, 1e-7, '复合边界环流为 0');
  const annulus = m.polygonDoubleIntegral(outer, (x, y) => f.curl(x, y));
  near(annulus, 0, 1e-12, '环形区域旋度恒 0');
});

test('网格求和随 N 增大收敛到面积分，抵消后的外轮廓逼近原曲线', () => {
  const L = m.blob();
  const exact = m.polygonDoubleIntegral(L, (x, y) => m.SMOOTH.curl(x, y));
  const err = n => {
    const g = m.makeGrid(n, -1.6, 1.6);
    return Math.abs(m.gridSum(g, m.insideMask(g, L), (x, y) => m.SMOOTH.curl(x, y)) - exact);
  };
  const e8 = err(8), e16 = err(16), e32 = err(32);
  assert.ok(e32 < e8, `e32=${e32} 应小于 e8=${e8}`);
  assert.ok(e32 / exact < 0.02, '32×32 相对误差应小于 2%');
  assert.ok(e16 / exact < 0.02, '16×16 相对误差应小于 2%');

  const g = m.makeGrid(16, -1.6, 1.6);
  const mask = m.insideMask(g, L);
  const inside = m.countInside(mask);
  assert.ok(inside > 80 && inside < 220, `内部格子数 ${inside} 数量级`);
  const contacts = m.contactEdges(g, mask);
  const bounds = m.boundaryEdges(g, mask);
  assert.ok(contacts.length > bounds.length, '内部接触边应多于外轮廓边');
});

test('方向敏感：把 L 反向，线积分变号', () => {
  const L = m.blob(1.2, 64);
  const cw = L.slice().reverse();
  near(m.polylineIntegral(L, m.SMOOTH, true), -m.polylineIntegral(cw, m.SMOOTH, true), 1e-10);
});
