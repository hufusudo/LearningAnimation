const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const nearVec = (a, b, eps = 1e-9) => a.every((v, i) => near(v, b[i], eps));

// 例：L₁ 过 (0,0,2) 沿 x 轴，L₂ 过 (2,1,−1) 沿 y 轴，距离为 3，公法向 (0,0,1)
const P1 = [0, 0, 2], d1 = [1, 0, 0], P2 = [2, 1, -1], d2 = [0, 1, 0];

test('位置关系：异面、平行、重合、相交各自判别正确', () => {
  assert.equal(M.classify(P1, d1, P2, d2), 'skew');
  assert.equal(M.classify([0, 0, 0], [1, 0, 0], [0, 2, 0], [1, 0, 0]), 'parallel');
  assert.equal(M.classify([0, 0, 0], [1, 0, 0], [5, 0, 0], [1, 0, 0]), 'coincident');
  assert.equal(M.classify([0, 0, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]), 'intersect');
});

test('公垂线长度为 3，端点为 Q₁ = (2,0,2)、Q₂ = (2,0,−1)，且与两直线都垂直', () => {
  const cs = M.commonSegment(P1, d1, P2, d2);
  assert.ok(near(cs.d, 3));
  assert.ok(nearVec(cs.Q1, [2, 0, 2]));
  assert.ok(nearVec(cs.Q2, [2, 0, -1]));
  assert.ok(near(M.dot(M.sub(cs.Q2, cs.Q1), d1), 0));
  assert.ok(near(M.dot(M.sub(cs.Q2, cs.Q1), d2), 0));
});

test('未滑动时 AB 沿公法向的投影即 (2,1,−3)·(0,0,1)，距离 3，垂足 (0,0,−1)', () => {
  const f = M.frameA(P1, d1, P2, d2, 0, 0);
  assert.equal(f.kind, 'skew');
  assert.ok(nearVec(f.n, [0, 0, 1]));
  assert.ok(near(f.signed, -3));
  assert.ok(near(f.d, 3));
  assert.ok(nearVec(f.F, [0, 0, -1]));
});

test('距离不变量：任取 A、B，AB 沿公法向的投影长度恒为 d', () => {
  for (let ta = -4; ta <= 4; ta += 0.5) {
    for (let ub = -4; ub <= 4; ub += 0.5) {
      const f = M.frameA(P1, d1, P2, d2, ta, ub);
      assert.ok(near(f.d, 3, 1e-9), `ta=${ta} ub=${ub} d=${f.d}`);
    }
  }
});

test('滑到终点：AB 与两直线都垂直、且平行于 n，长度恰为 d', () => {
  const end = M.slideParams(P1, d1, P2, d2, 1);
  const f = M.frameA(P1, d1, P2, d2, end.ta, end.ub);
  assert.ok(near(M.dot(f.AB, d1), 0));
  assert.ok(near(M.dot(f.AB, d2), 0));
  assert.ok(M.len(M.cross(f.AB, f.n)) < 1e-9);
  assert.ok(near(M.len(f.AB), 3));
});

test('滑动途中 |AB| 始终不小于 d，起点等于 |P₁P₂|', () => {
  const start = M.frameA(P1, d1, P2, d2, 0, 0);
  assert.ok(near(M.len(start.AB), M.len(M.sub(P2, P1))));
  for (let s = 0; s <= 1 + 1e-12; s += 0.02) {
    const p = M.slideParams(P1, d1, P2, d2, s);
    const f = M.frameA(P1, d1, P2, d2, p.ta, p.ub);
    assert.ok(M.len(f.AB) >= 3 - 1e-9, `s=${s} |AB|=${M.len(f.AB)}`);
  }
});

test('平行时不滑动，距离为过 P₂ 的垂线长度', () => {
  const Pa = [0, 0, 0], da = [1, 0, 0], Pb = [0, 2, 0], db = [1, 0, 0];
  assert.equal(M.classify(Pa, da, Pb, db), 'parallel');
  assert.deepEqual(M.slideParams(Pa, da, Pb, db, 1), { ta: 0, ub: 0 });
  assert.ok(near(M.frameA(Pa, da, Pb, db).d, 2));
});

test('B：投影线沿 n 落下，落点都在过 L′ 的同一条直线上', () => {
  const C = [0.2, 0, 3.4], d = M.unit([1, 0.65, -1.4]), alpha = 0.3;
  const f = M.frameB(C, d, alpha);
  f.samples.forEach(s => {
    assert.ok(near(M.dot(s.foot, f.n), 0), '落点在 π 上');
    assert.ok(M.len(M.cross(M.sub(s.X, s.foot), f.n)) < 1e-9, '投影线平行于 n');
    assert.ok(M.len(M.cross(M.sub(s.foot, f.projC), f.dir)) < 1e-9, '落点在 L′ 上');
  });
});

test('B：辅助平面 π′ 含 L，且含所有投影线（法向 n × v 与二者都垂直）', () => {
  const C = [-0.9, 0.4, 0], d = M.unit([1, 0.8, 0]), alpha = -0.4;
  const f = M.frameB(C, d, alpha);
  assert.ok(f.aux, '非退化时辅助平面法向存在');
  assert.ok(near(M.dot(f.aux, d), 0), 'π′ 的法向垂直于 L');
  assert.ok(near(M.dot(f.aux, f.n), 0), 'π′ 的法向垂直于 n，故 π′ 平行于 n');
  f.samples.forEach(s => assert.ok(near(M.dot(f.aux, M.sub(s.foot, C)), 0, 1e-9), '投影线的落点也在 π′ 中'));
});

test('B：L′ 位于 π 上，交点（若存在）同时在 L 与 π 上', () => {
  const C = [0.2, 0, 3.4], d = M.unit([1, 0.65, -1.4]), alpha = 0.25;
  const f = M.frameB(C, d, alpha);
  assert.ok(near(M.dot(f.Lp[0], f.n), 0) && near(M.dot(f.Lp[1], f.n), 0));
  assert.ok(f.pierce);
  assert.ok(near(M.dot(f.pierce, f.n), 0));
  assert.ok(M.len(M.cross(M.sub(f.pierce, C), d)) < 1e-9);
});

test('B：L 垂直于 π 时投影退化为一点', () => {
  const f = M.frameB([0.9, 0.7, 3.2], [0, 0, -1], 0);
  assert.equal(f.isPend, true);
  f.samples.forEach(s => assert.ok(M.len(M.sub(s.foot, f.projC)) < 1e-9));
});
