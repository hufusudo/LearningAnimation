/**
 * 计算行为检查：node model.test.cjs
 */
const assert = require('assert');
const M = require('./model.js');

const close = (a, b, tol, msg) => {
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
};

// 1. 直线弧长精确可算
const line = M.CURVES.line;
close(M.arcLength(line), Math.hypot(line.b - line.a, 0.6 * (line.b - line.a)), 1e-9, 'line arcLength');

// 2. 均匀密度下 质量 == 弧长（物理自洽）
for (const key of Object.keys(M.CURVES)) {
  const c = M.CURVES[key];
  close(M.totalMass(c, M.DENSITIES.uniform), M.arcLength(c), 1e-9, `${key}: M(uniform) == L`);
}

// 3. 半圆弧：θ ∈ [30°, 150°]，弧长 = r · 2π/3
const semi = M.CURVES.semicircle;
close(M.arcLength(semi), semi.radius * (TAU_3()), 2e-3, 'semicircle arcLength');
function TAU_3() { return (2 * Math.PI) / 3; }

// 4. 抛物线弧长与解析式对照
const para = M.CURVES.parabola;
const anti = (x) => (x * Math.sqrt(1 + 4 * x * x)) / 2 + Math.asinh(2 * x) / 4;
close(M.arcLength(para), anti(para.b) - anti(para.a), 1e-5, 'parabola arcLength');

// 5. 直线 + 线性密度：Simpson 精确
const exact = Math.hypot(1, 0.6) * (0.8 * 2 * 2 + 0.35 * 2 - (0.8 * 0.01 + 0.35 * 0.1));
close(M.totalMass(line, M.DENSITIES.gradient), exact, 1e-9, 'line gradient mass');

// 6. 分段累加随 N 增大收敛到精确值（弦长恒 ≤ 弧长）
let prevErr = Infinity;
for (const N of [4, 16, 64, 256, 1024]) {
  const st = M.stats(para, M.DENSITIES.gradient, N);
  assert.ok(st.L <= st.exactL + 1e-9, 'chord length never exceeds arc length');
  const err = Math.abs(st.M - st.exactM);
  assert.ok(err < prevErr + 1e-12, 'mass error decreases with N');
  prevErr = err;
}
{
  const st = M.stats(para, M.DENSITIES.gradient, 2048);
  assert.ok(Math.abs(st.M - st.exactM) / st.exactM < 5e-4, 'mass converges');
}

// 7. 微元内部一致性：dm = rho * ds，ds = sqrt(dx^2 + dy^2)
const segs = M.segments(para, M.DENSITIES.gradient, 32);
segs.forEach((s) => {
  close(s.ds, Math.hypot(s.dx, s.dy), 1e-12, 'segment ds pythagoras');
  close(s.dm, s.rho * s.ds, 1e-12, 'segment dm');
  close(s.rho, s.xm + s.ym, 1e-12, 'segment rho = x + y');
  assert.ok(s.dsSlope > 0, 'slope form positive');
});

// 8. 密度范围
const rng = M.densityRange(para, M.DENSITIES.gradient);
assert.ok(rng.max > rng.min, 'density range non-degenerate');
assert.ok(rng.min >= 0, 'density non-negative');

console.log('✅ model.test.cjs 全部通过');
