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

// 3. 120°圆弧段：θ ∈ [30°, 150°]，弧长 = r · 2π/3
const semi = M.CURVES.semicircle;
assert.equal(semi.label, '120°圆弧段');
assert.equal(semi.short, '120°圆弧');
close(M.arcLength(semi), semi.radius * (TAU_3()), 2e-3, 'semicircle arcLength');
function TAU_3() { return (2 * Math.PI) / 3; }

// 4. 抛物线弧长与解析式对照
const para = M.CURVES.parabola;
const anti = (x) => (x * Math.sqrt(1 + 4 * x * x)) / 2 + Math.asinh(2 * x) / 4;
close(M.arcLength(para), anti(para.b) - anti(para.a), 1e-5, 'parabola arcLength');

// 5. 直线 + 线性密度：Simpson 精确
const exact = Math.hypot(1, 0.6) * (0.8 * 2 * 2 + 0.35 * 2 - (0.8 * 0.01 + 0.35 * 0.1));
close(M.totalMass(line, M.DENSITIES.gradient), exact, 1e-9, 'line gradient mass');

// 6. 三条曲线、两种密度的分段近似随 N 增大收敛到数值参考值。
// 直线部分量本身就是精确的，误差受浮点舍入支配；只对曲线弯曲的情况要求严格单调。
for (const c of Object.values(M.CURVES)) {
  for (const d of Object.values(M.DENSITIES)) {
    const errors = [4, 16, 64, 256, 1024].map((N) => {
      const st = M.stats(c, d, N);
      assert.ok(st.L <= st.exactL + 1e-9, `${c.id}/${d.id}: chord length <= arc length`);
      return Math.abs(st.M - st.exactM);
    });
    assert.ok(errors[errors.length - 1] < 5e-4, `${c.id}/${d.id}: mass approximation converges`);
    if (c !== M.CURVES.line) {
      for (let i = 1; i < errors.length; i++) {
        assert.ok(errors[i] < errors[i - 1], `${c.id}/${d.id}: mass error decreases with N`);
      }
    }
  }
}

// 有限步长下弦长严格短于抛物线弧长；圆弧负斜率段和零斜率点均保持有限。
const coarsePara = M.stats(para, M.DENSITIES.uniform, 4);
assert.ok(coarsePara.L < coarsePara.exactL, 'finite chord sum is shorter than curved arc');
const semiSegments = M.segments(semi, M.DENSITIES.uniform, 11);
assert.ok(semiSegments.some((s) => s.slope < 0), 'arc includes negative-slope segments');
semiSegments.forEach((s) => {
  assert.ok(Number.isFinite(s.slope) && Number.isFinite(s.dsSlope) && Number.isFinite(s.dm), 'arc segment values stay finite');
});
const zeroSlope = semiSegments.find((s) => Math.abs(s.slope) < 1e-12);
assert.ok(zeroSlope, 'arc includes a zero-slope midpoint');
assert.ok(Number.isFinite(zeroSlope.dsSlope), 'zero-slope arc segment length is finite');

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
