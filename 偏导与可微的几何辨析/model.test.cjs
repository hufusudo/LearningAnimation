/**
 * 数学层测试（设计方案 §8 数学验收，命令行可跑）：
 *   node --test 偏导与可微的几何辨析   或   npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = {};
const file = path.join(__dirname, 'model.js');
if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
const M = context.PDModel;
const near = (a, b, tol = 1e-6, msg = '') =>
  assert.ok(Math.abs(a - b) < tol, `${msg} ${a} != ${b} (tol ${tol})`);
// vm 上下文里的对象与测试进程不是同一个 realm，比较前转成普通对象
const plain = (v) => JSON.parse(JSON.stringify(v));

// 汉字与全角标点记 1，其余字符记 0.5；提示与结果 ≤ 26，导览旁白 ≤ 40
function hanWidth(s) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    w += c >= 0x2e80 && c !== 0x3000 ? 1 : 0.5;
  }
  return w;
}

test('真值表：5 样本 × 4 概念与设计方案 §3.1 一致，顺序为入门在前', () => {
  assert.ok(M, '数学模型尚未加载');
  const expected = {
    F0: { A: true, B: true, C: true, D: true },
    F1: { A: true, B: false, C: false, D: false },
    F2: { A: false, B: true, C: false, D: false },
    F3: { A: true, B: true, C: false, D: false },
    F4: { A: true, B: true, C: false, D: true }
  };
  for (const id of Object.keys(expected)) assert.deepEqual(plain(M.byId[id].truth), expected[id], id);
  assert.deepEqual(plain(M.order), ['F1', 'F2', 'F3', 'F4', 'F0']);
});

test('集合区域：F0∈偏导连续，F4∈可微∖偏导连续，F3∈(偏导存在∩连续)∖可微，F1∈偏导存在∖连续，F2∈连续∖偏导存在', () => {
  assert.equal(M.region('F0'), 'C');
  assert.equal(M.region('F4'), 'D');
  assert.equal(M.region('F3'), 'AB');
  assert.equal(M.region('F1'), 'A');
  assert.equal(M.region('F2'), 'B');
});

test('嵌套：C⇒D⇒A∧B 对每个样本成立；每条不成立的推导都有前提真、结论假的反例', () => {
  for (const s of M.samples) {
    if (s.truth.C) assert.ok(s.truth.D, `${s.id} C⇒D`);
    if (s.truth.D) assert.ok(s.truth.A && s.truth.B, `${s.id} D⇒A∧B`);
  }
  for (const imp of M.IMPLICATIONS) {
    if (imp.valid) continue;
    const s = M.byId[imp.counter];
    assert.ok(imp.from.every((c) => s.truth[c]), `${imp.counter} 前提应为真`);
    assert.ok(!s.truth[imp.to], `${imp.counter} 结论应为假`);
  }
});

test('F0：解析梯度与中心差分误差 < 1e-6；P 处偏导为 (0.59, 0)', () => {
  const { f, grad } = M.byId.F0;
  for (const [x, y] of [[0.3, -0.2], [-1.1, 0.7], [0.05, 0.9]]) {
    const h = 1e-5;
    const nx = (f(x + h, y) - f(x - h, y)) / (2 * h);
    const ny = (f(x, y + h) - f(x, y - h)) / (2 * h);
    near(grad(x, y).x, nx, 1e-6, 'fx');
    near(grad(x, y).y, ny, 1e-6, 'fy');
  }
  const h = 1e-6;
  near((f(h, 0) - f(-h, 0)) / (2 * h), 0.59, 1e-6, 'P 处中心差分');
  near(M.partialAt('F0', 'x'), 0.59, 1e-12);
  near(M.partialAt('F0', 'y'), 0, 1e-12);
});

test('F1：坐标轴截线恒为 0；沿 45° 近 P 处高度为 0.5，P 处为 0（断开）', () => {
  for (const t of [1e-3, -1e-3, 0.2, -0.7]) near(M.lineValue('F1', 0, t), 0, 1e-12, `θ=0 t=${t}`);
  assert.deepEqual(plain(M.sliceSlopes('F1', 0)), { left: 0, right: 0, twoSided: true });
  assert.equal(M.partialAt('F1', 'x'), 0);
  assert.equal(M.partialAt('F1', 'y'), 0);
  near(M.lineValue('F1', 45, 1e-6), 0.5, 1e-9, '45° 近 P');
  near(M.lineValue('F1', 45, 0.3), 0.5, 1e-9, '45° 远处应为常数');
  near(M.limitAlong('F1', 45), 0.5, 1e-9, '45° 极限');
  assert.equal(M.value('F1', 0, 0), 0);
  assert.equal(M.sliceSlopes('F1', 45).twoSided, false);
});

test('F1：误差比随距离缩小而增大（不可微）', () => {
  assert.ok(M.errorRatio('F1', 1e-3) > 400);
  assert.ok(M.errorRatio('F1', 1e-2) > 40);
  assert.ok(M.errorRatio('F1', 1e-3) > M.errorRatio('F1', 1e-2));
});

test('F2：截线为 |t|，任何方向都是折角（左 −1、右 +1）；没有偏导与切平面', () => {
  for (const th of [0, 17, 45, 90, 135]) {
    assert.deepEqual(plain(M.sliceSlopes('F2', th)), { left: -1, right: 1, twoSided: false });
    near(M.lineValue('F2', th, 1e-3), 1e-3, 1e-12);
    near(M.lineValue('F2', th, -1e-3), 1e-3, 1e-12);
    assert.equal(M.tangentSlope('F2', th), null);
    near(M.lineSlope('F2', th, 1e-6), 1, 1e-9, `θ=${th} 右侧`);
    near(M.lineSlope('F2', th, -1e-6), -1, 1e-9, `θ=${th} 左侧`);
  }
  assert.equal(M.partialAt('F2', 'x'), null);
  assert.equal(M.errorAbs('F2', 0.1), null);
});

test('F3：误差比恒为 0.5（不可微）；沿 45° 两侧斜率为 ∓0.5；坐标轴方向平坦', () => {
  for (const d of [0.1, 0.01, 0.001]) near(M.errorRatio('F3', d), 0.5, 1e-9, `d=${d}`);
  const s45 = M.sliceSlopes('F3', 45);
  near(s45.left, -0.5, 1e-12);
  near(s45.right, 0.5, 1e-12);
  assert.equal(s45.twoSided, false);
  near(M.lineSlope('F3', 45, 1e-7), 0.5, 1e-6);
  near(M.lineSlope('F3', 45, -1e-7), -0.5, 1e-6);
  near(M.secant('F3', 45, 1e-3), 0.5, 1e-9, '正向割线');
  near(M.secant('F3', 45, -1e-3), -0.5, 1e-9, '反向割线');
  const s0 = M.sliceSlopes('F3', 0);
  near(s0.left, 0, 1e-12);
  near(s0.right, 0, 1e-12);
  assert.equal(s0.twoSided, true);
  for (let i = 0; i < 200; i++) {
    const x = Math.sin(i * 1.7) * 0.3;
    const y = Math.cos(i * 0.9) * 0.4;
    assert.ok(Math.abs(M.value('F3', x, y)) <= Math.hypot(x, y) / 2 + 1e-12, `F3 连续界 (${x}, ${y})`);
  }
});

test('F4：误差比 ≤ 距离并趋于 0（可微）；沿 x 轴切线斜率在 ±1 之间振荡（偏导不连续）', () => {
  for (const d of [0.1, 0.01, 0.001]) assert.ok(M.errorRatio('F4', d) <= d + 1e-12, `d=${d}`);
  assert.ok(M.errorRatio('F4', 0.001) < M.errorRatio('F4', 0.01));
  const n = 2000;
  near(M.lineSlope('F4', 0, 1 / (2 * Math.PI * n)), -1, 2e-3);
  near(M.lineSlope('F4', 0, 1 / (2 * Math.PI * n + Math.PI)), 1, 2e-3);
  assert.equal(M.partialAt('F4', 'x'), 0);
});

test('偏导与切平面：gradAtP 与坐标轴方向的两侧导数一致；F2 没有偏导', () => {
  for (const s of M.samples) {
    if (!s.gradAtP) continue;
    near(M.partialAt(s.id, 'x'), s.gradAtP.x, 1e-12, `${s.id} f_x`);
    near(M.partialAt(s.id, 'y'), s.gradAtP.y, 1e-12, `${s.id} f_y`);
  }
});

test('切线斜率：F0 沿 θ 方向为 0.59·cosθ；误差比随距离缩小而趋于 0', () => {
  near(M.tangentSlope('F0', 0), 0.59, 1e-12);
  near(M.tangentSlope('F0', 60), 0.59 * 0.5, 1e-12);
  near(M.tangentSlope('F0', 90), 0, 1e-12);
  assert.ok(M.errorRatio('F0', 1e-3) < 1e-2);
  assert.ok(M.errorRatio('F0', 1e-3) < M.errorRatio('F0', 1e-2));
});

test('数值安全：原点与极小距离处不出现 NaN', () => {
  for (const s of M.samples) {
    assert.equal(M.value(s.id, 0, 0), 0, `${s.id} f(P)`);
    for (const th of [0, 17, 45, 90, 135, 180]) {
      for (const t of [1e-4, -1e-4, 1e-2, -1e-2, 1, -1]) {
        assert.ok(Number.isFinite(M.lineValue(s.id, th, t)), `${s.id} value θ=${th} t=${t}`);
        const sl = M.lineSlope(s.id, th, t);
        assert.ok(sl === null || Number.isFinite(sl), `${s.id} slope`);
        assert.ok(Number.isFinite(M.secant(s.id, th, t)), `${s.id} secant`);
      }
    }
    const er = M.errorRatio(s.id, 1e-4);
    assert.ok(er === null || Number.isFinite(er), `${s.id} errorRatio`);
  }
});

test('缩放与磁吸：ρ 逐级减半；磁吸只在 0°、90°、180° 附近', () => {
  near(M.rho(0), 1.2, 1e-12);
  near(M.rho(1), 0.6, 1e-12);
  assert.ok(M.rho(M.K_MAX) > 0.002 && M.rho(M.K_MAX) < 0.0025);
  assert.equal(M.snapTheta(1.5), 0);
  assert.equal(M.snapTheta(88.5), 90);
  assert.equal(M.snapTheta(30), 30);
  assert.equal(M.snapTheta(-5), 0);
  assert.equal(M.snapTheta(200), 180);
  assert.ok(M.isAxis(0) && M.isAxis(90) && M.isAxis(180));
  assert.ok(!M.isAxis(45));
});

test('文案：提示与结果 ≤ 26 字；导览旁白 ≤ 40 字；导览样本与分组一致', () => {
  for (const s of M.samples) {
    for (const key of ['axis', 'zoom', 'result']) {
      assert.ok(hanWidth(s.text[key]) <= 26, `${s.id}.${key} 过长：${s.text[key]}`);
    }
  }
  assert.ok(hanWidth(M.BLIND_TEXT) <= 26);
  for (const tour of Object.values(M.TOURS)) {
    assert.ok(tour.start.theta >= 0 && tour.start.theta <= 180);
    for (const st of tour.steps) {
      assert.ok(M.byId[st.sample], st.sample);
      assert.ok(st.theta >= 0 && st.theta <= 180, `θ 越界 ${st.theta}`);
      assert.ok(st.k >= 0 && st.k <= M.K_MAX, `k 越界 ${st.k}`);
      assert.ok(hanWidth(st.text) <= 40, `旁白过长：${st.text}`);
    }
  }
  assert.deepEqual(plain(M.samples.filter((s) => s.group === 'entry').map((s) => s.id)), ['F1', 'F2']);
  assert.deepEqual([...new Set(M.TOURS.entry.steps.map((s) => s.sample))].sort(), ['F1', 'F2']);
  assert.deepEqual([...new Set(M.TOURS.advanced.steps.map((s) => s.sample))].sort(), ['F0', 'F3', 'F4']);
});

test('F3偏导在P存在但不连续：沿正y轴的fx恒为1，原点fx为0', () => {
  near(M.partialAt('F3', 'x'), 0, 1e-12);
  for (const y of [0.1, 0.01, 1e-5]) near(M.byId.F3.grad(0, y).x, 1, 1e-12);
  // |xy|≤(x²+y²)/2给出连续性，不能由“坐标轴平坦”推断连续。
  near(M.errorRatio('F3', 1e-5), 0.5, 1e-12);
});

test('F4附近偏导的两列反例与原点偏导严格区分', () => {
  near(M.partialAt('F4', 'x'), 0, 1e-12);
  for (const n of [1, 2, 20, 1024, 32768]) {
    near(M.lineSlope('F4', 0, 1 / (2 * Math.PI * n)), -1, 1e-8);
    near(M.lineSlope('F4', 0, 1 / (2 * Math.PI * n + Math.PI)), 1, 1e-8);
  }
});

test('反例误差采用解析值；连续样本的沿线极限精确为0', () => {
  for (const r of [1.2, 0.1, 0.00234375]) {
    near(M.errorAbs('F1', r), 0.5, 1e-12);
    near(M.errorAbs('F3', r), r / 2, 1e-12);
    near(M.errorAbs('F4', r), r * r * Math.abs(Math.sin(1 / r)), 1e-12);
  }
  for (const id of ['F0', 'F2', 'F3', 'F4']) {
    for (const angle of [0, 20, 45, 90]) assert.equal(M.limitAlong(id, angle), 0);
  }
});
