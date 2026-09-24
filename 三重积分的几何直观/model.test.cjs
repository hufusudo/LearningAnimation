const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = {};
const file = path.join(__dirname, 'model.js');
if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
const m = context.IntegralModel;
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const midpoint = (fn, a, b, n = 180) => {
  const h = (b - a) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += fn(a + (i + 0.5) * h) * h;
  return sum;
};

test('体外不计质量；球体边界和密度极值正确', () => {
  assert.ok(m, '积分模型尚未实现');
  assert.equal(m.inside(0, 0, 1), true);
  assert.equal(m.inside(1, 1, 0), false);
  near(m.density(0, 0, -1), 0.5);
  near(m.density(Math.sqrt(0.75), 0, 0.5), 1.625);
});

test('投影法：上下边界内沿 z 积分，再覆盖圆形投影', () => {
  assert.ok(m);
  const result = midpoint(r => {
    const h = m.halfHeight(r, 0);
    return 2 * Math.PI * r * midpoint(z => m.density(r, 0, z), -h, h, 30);
  }, 0, 1, 2000);
  near(result, 5.026548245743669, 0.00005);
  near(m.halfHeight(0.6, 0), 0.8);
});

test('截面法与柱坐标法：加权截面积沿 z 累积得到同一质量', () => {
  assert.ok(m);
  const direct = midpoint(z => midpoint(r => 2 * Math.PI * m.cylindricalIntegrand(r, 0, z), 0, Math.sqrt(1 - z * z), 160), -1, 1, 400);
  near(direct, 5.026548245743669, 0.00006);
  near(midpoint(m.sliceMass, -1, 1, 1000), 5.026548245743669, 0.000003);
});

test('球坐标必须包含 r²sinφ；从北极扫至南极覆盖整个球', () => {
  assert.ok(m);
  const mass = midpoint(phi => midpoint(r => 2 * Math.PI * m.sphericalIntegrand(r, 0, phi), 0, 1, 400), 0, Math.PI, 400);
  near(mass, 5.026548245743669, 0.00002);
  near(m.sphericalIntegrand(0.5, 0, 0), 0);
  near(m.sphericalIntegrand(1, 0, Math.PI / 2), 1.5);
});

test('进度质量单调，开头为零，结束为解析总质量', () => {
  assert.ok(m);
  for (const method of ['projection', 'section', 'cylindrical', 'spherical']) {
    near(m.accumulatedMass(method, 0), 0);
    near(m.accumulatedMass(method, 1), 5.026548245743669);
    let previous = 0;
    for (let i = 0; i <= 200; i++) {
      const current = m.accumulatedMass(method, i / 200);
      assert.ok(current >= previous - 1e-10, method);
      previous = current;
    }
  }
  near(m.accumulatedMass('section', 0.5), 2.1205750411731104);
  near(m.accumulatedMass('spherical', 0.5), 2.905973204570559);
});

test('球坐标中 r 的水平投影等于 r sinφ，南半球 z 为负', () => {
  assert.ok(m);
  const p = m.sphericalPoint(0.8, Math.PI / 3, 2 * Math.PI / 3);
  near(Math.hypot(p.x, p.y), 0.6928203230275509);
  near(p.z, -0.4);
  near(Math.hypot(p.x, p.y, p.z), 0.8);
});
