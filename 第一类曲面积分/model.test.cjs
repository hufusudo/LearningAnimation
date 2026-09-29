const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'model.js'), 'utf8'), context);
const m = context.SurfaceModel;

const near = (a, b, tol = 1e-6, msg = '') =>
  assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} != ${b} (tol ${tol})`);

test('模型已实现，曲面严格位于投影底板之上', () => {
  assert.ok(m, 'SurfaceModel 尚未实现');
  for (let i = 0; i <= 80; i++) {
    const x = -2 + 4 * i / 80;
    for (let j = 0; j <= 80; j++) {
      const y = -2 + 4 * j / 80;
      assert.ok(m.z(x, y) > 0.05, `z(${x},${y}) = ${m.z(x, y)} 接近或低于底板`);
    }
  }
  const [lo, hi] = m.zRange();
  assert.ok(lo > 0.05 && hi > lo + 0.5, `z 范围异常: [${lo}, ${hi}]`);
});

test('z_x、z_y 是 z 的真实偏导（中心差分校验）', () => {
  const h = 1e-4;
  for (const [x, y] of [[-1.3, 0.7], [0.4, -1.6], [0, 0], [1.9, 1.1]]) {
    near((m.z(x + h, y) - m.z(x - h, y)) / (2 * h), m.zx(x, y), 1e-6, `zx@${x},${y}`);
    near((m.z(x, y + h) - m.z(x, y - h)) / (2 * h), m.zy(x, y), 1e-6, `zy@${x},${y}`);
  }
});

test('cos γ 与 dS 因子互为倒数，且 0 < cos γ ≤ 1', () => {
  for (const [x, y] of [[-0.6, 0.5], [0, 0], [2, -2], [-1.7, 1.2]]) {
    const c = m.cosGamma(x, y);
    assert.ok(c > 0 && c <= 1, `cosγ 越界: ${c}`);
    near(c * m.dSFactor(x, y), 1, 1e-12, 'cosγ · dS 因子');
    near(m.dSFactor(x, y), Math.sqrt(1 + m.zx(x, y) ** 2 + m.zy(x, y) ** 2), 1e-12);
  }
});

test('法向量 n=(-z_x,-z_y,1) 归一化后与 k=(0,0,1) 的点积等于 cos γ', () => {
  for (const [x, y] of [[-0.6, 0.5], [1.2, -0.4], [-2, 2]]) {
    const n = m.unitNormal(x, y);
    near(Math.hypot(...n), 1, 1e-12, '单位法向量模长');
    near(n[2], m.cosGamma(x, y), 1e-12, 'n·k = cosγ');
    near(m.rawNormal(x, y)[0], -m.zx(x, y), 1e-12);
  }
});

test('均匀密度 ρ≡1，渐变密度随高度单调增大且落在 [0.8, 3.6]', () => {
  near(m.rho(0, 0, 'uniform'), 1, 1e-12);
  near(m.rho(-2, 2, 'uniform'), 1, 1e-12);
  let previous = -Infinity;
  // 沿高度升序取样，密度必须单调不减
  const samples = [];
  for (let i = 0; i <= 60; i++) {
    const x = -2 + 4 * i / 60;
    for (let j = 0; j <= 60; j++) {
      const y = -2 + 4 * j / 60;
      samples.push([m.z(x, y), m.rho(x, y, 'gradient')]);
    }
  }
  samples.sort((a, b) => a[0] - b[0]);
  for (const [zz, r] of samples) {
    assert.ok(r >= m.RHO_MIN - 1e-9 && r <= m.RHO_MAX + 1e-9, `ρ 越界 ${r}`);
    assert.ok(r >= previous - 1e-9, `ρ 未随高度单调: ${r} < ${previous}`);
    previous = r;
  }
});

test('单块碎片：ΔS_i ≈ ΔxΔy / cos γ（以直代曲的面积补偿）', () => {
  const n = 16;
  const dx = 4 / n, dy = 4 / n;
  for (const [i, j] of [[4, 11], [8, 8], [15, 2]]) {
    const [cx, cy] = m.cellCenter(n, i, j);
    const approx = dx * dy / m.cosGamma(cx, cy);
    const actual = m.cellArea(n, i, j);
    near(actual, approx, approx * 0.02, `cell(${i},${j})`);
  }
});

test('细分越密，ΣΔS 与 ΣρΔS 收敛到精确二重积分', () => {
  const exactUniform = m.exact('uniform');
  const exactGrad = m.exact('gradient');
  let previousError = Infinity;
  for (const n of [4, 8, 16, 32]) {
    const s = m.sums(n, 'gradient');
    const error = Math.abs(s.mass - exactGrad.mass);
    assert.ok(error < previousError, `n=${n} 误差未减小`);
    previousError = error;
    // 均匀密度时质量恒等于面积
    const u = m.sums(n, 'uniform');
    near(u.mass, u.area, 1e-9, '均匀密度 M = S');
  }
  const s64 = m.sums(32, 'gradient');
  assert.ok(Math.abs(s64.area - exactUniform.area) / exactUniform.area < 2e-3, '面积收敛');
  assert.ok(Math.abs(s64.mass - exactGrad.mass) / exactGrad.mass < 3e-3, '质量收敛');
  assert.ok(exactGrad.mass > exactUniform.area, '渐变密度总质量应大于 ρ≡1 的基准');
});
