const test = require('node:test');
const assert = require('node:assert/strict');
require('./model.js');
const M = globalThis.GreenModel;
const near = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-10, `${message}: ${a} != ${b}`);
for (const n of [3, 6, 9]) test(`${n}列：每条内部边正反配对、外边逆时针，环流独立求积守恒`, () => {
  const g = M.makeTiling(n), m = 2 * n / 3;
  assert.equal(g.cells.length, n * m);
  assert.equal(g.internal.length, (n - 1) * m + (m - 1) * n);
  assert.equal(g.boundary.length, 2 * (m + n));
  assert.equal(g.cells.length * 4, g.internal.length * 2 + g.boundary.length);
  g.internal.forEach(pair => {
    const [a, b] = pair.edges;
    assert.deepEqual(a.a, b.b); assert.deepEqual(a.b, b.a);
    near(a.value + b.value, 0, pair.key);
  });
  g.cells.forEach(cell => {
    near(cell.circulation, cell.area);
    let signedArea = 0;
    cell.edges.forEach(e => { signedArea += (e.a.x * e.b.y - e.b.x * e.a.y) / 2; });
    near(signedArea, cell.area, '逆时针面积为正');
  });
  // 不调用总和，独立按四边路径积分核对，逆向则变号。
  const p = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 }];
  const sides = p.map((a, i) => M.integral(a, p[(i + 1) % 4]));
  [0, 3, 3, 0].forEach((v, i) => near(sides[i], v));
  const outer = sides.reduce((s, v) => s + v, 0);
  near(g.outer, outer); near(g.total, outer); near(outer, 6);
  near(M.integral(p[0], p[3]), -M.integral(p[3], p[0]));
  // 抵消不仅仅成立于本例：用不同多项式场验证任意公共边反向恒等式。
  const field = { P: (x, y) => x * x - y * y, Q: (x, y) => x * y + x };
  g.internal.forEach(({ edges: [a, b] }) => near(M.integral(a.a, a.b, field) + M.integral(b.a, b.b, field), 0));
});
test('旋度由偏导独立计算为 1；网格非法值拒绝', () => {
  const h = 1e-5;
  [[0,0], [1.1,1.8], [3,2]].forEach(([x,y]) => near((M.FIELD.Q(x+h,y)-M.FIELD.Q(x-h,y))/(2*h) - (M.FIELD.P(x,y+h)-M.FIELD.P(x,y-h))/(2*h), 1));
  assert.throws(() => M.makeTiling(4), RangeError);
});
