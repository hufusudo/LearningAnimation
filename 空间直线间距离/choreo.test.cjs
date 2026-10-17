const test = require('node:test');
const assert = require('node:assert/strict');
const { viewA, viewB, MAIN_A, MAIN_B, GHOST } = require('./choreo.js');

const flat = (x, out = []) => {
  if (typeof x === 'number') out.push(x);
  else if (x && typeof x === 'object') Object.keys(x).sort().forEach(k => flat(x[k], out));
  return out;
};
const gOf = (view, key) => (key === 'slide' ? view.slide : view[key].g);
const samples = Array.from({ length: 801 }, (_, i) => i * 0.005);
const KINDS = ['skew', 'intersect', 'parallel'];

test('边界无跳变：每一章终点的画面等于下一章起点的画面（A 各情形、B）', () => {
  for (const kind of KINDS) {
    for (let k = 1; k < 4; k++) {
      const before = flat(viewA(k - 1e-9, kind)), after = flat(viewA(k + 1e-9, kind));
      before.forEach((v, i) => assert.ok(Math.abs(v - after[i]) < 1e-6, `A(${kind}) 在步界 ${k} 处跳变`));
    }
  }
  for (let k = 1; k < 4; k++) {
    const before = flat(viewB(k - 1e-9)), after = flat(viewB(k + 1e-9));
    before.forEach((v, i) => assert.ok(Math.abs(v - after[i]) < 1e-6, `B 在步界 ${k} 处跳变`));
  }
});

test('起点：所有生长对象尚未出现，基础标签已就位', () => {
  const a = viewA(0, 'skew');
  ['s1', 's2', 'n', 'right', 'A', 'B', 'AB', 'AF', 'BF', 'CP', 'feet', 'rightFeet'].forEach(k => assert.equal(a[k].g, 0, k));
  assert.equal(a.slide, 0);
  assert.equal(a.lab.P1, 1);
  const b = viewB(0);
  ['n', 'drops', 'feet', 'v', 'np', 'plane', 'Lp', 'pierce'].forEach(k => assert.equal(b[k].g, 0, k));
  assert.equal(b.lab.L, 1);
  assert.equal(b.lab.pi, 1);
});

test('终点：异面情形完整呈现，公垂线就是 AB；投影段 AF 已收起，d 标签让位给 |AB|', () => {
  const a = viewA(4, 'skew');
  ['s1', 's2', 'n', 'A', 'B', 'AB', 'BF', 'CP', 'feet', 'rightFeet'].forEach(k => assert.equal(a[k].g, 1, k));
  assert.equal(a.slide, 1);
  assert.equal(a.AF.g, 1);
  assert.equal(a.AF.a, 0);
  assert.equal(a.lab.ab, 1);
  assert.ok(a.lab.d < 1e-6);
  Object.values(a.halo).forEach(h => assert.ok(h < 1e-6, '章节结束后外环收起'));
  const b = viewB(4);
  ['n', 'drops', 'feet', 'plane', 'Lp', 'pierce'].forEach(k => assert.equal(b[k].g, 1, k));
  assert.equal(b.lab.Lp, 1);
  assert.equal(b.lab.pierce, 1);
});

test('同一章的主动作依次进行：任一时刻同章最多只有一个主动作在生长', () => {
  for (const kind of ['skew']) {
    for (const p of samples) {
      const view = viewA(p, kind);
      for (const [step, keys] of Object.entries(MAIN_A)) {
        const growing = keys.filter(k => gOf(view, k) > 1e-9 && gOf(view, k) < 1 - 1e-9);
        assert.ok(growing.length <= 1, `A 第 ${step} 章 p=${p} 同时生长 ${growing}`);
      }
    }
  }
  for (const p of samples) {
    const view = viewB(p);
    for (const [step, keys] of Object.entries(MAIN_B)) {
      const growing = keys.filter(k => gOf(view, k) > 1e-9 && gOf(view, k) < 1 - 1e-9);
      assert.ok(growing.length <= 1, `B 第 ${step} 章 p=${p} 同时生长 ${growing}`);
    }
  }
});

test('回执排在主动作之后：标签出现时，对应主动作已经完成', () => {
  const TAG_A = { s1: 1, s2: 1, n: 2, A: 3, B: 3, ab: 4 };
  const TAG_B = { n: 1, v: 2, np: 2, pip: 3, Lp: 4, pierce: 4 };
  for (const p of samples) {
    const a = viewA(p, 'skew');
    for (const [key, step] of Object.entries(TAG_A)) {
      if (a.lab[key] > 1e-9) {
        MAIN_A[step].forEach(k => assert.ok(gOf(a, k) > 1 - 1e-9, `A 标签 ${key} 早于主动作 ${k}（p=${p}）`));
      }
    }
    const b = viewB(p);
    for (const [key, step] of Object.entries(TAG_B)) {
      if (b.lab[key] > 1e-9) {
        MAIN_B[step].forEach(k => assert.ok(gOf(b, k) > 1 - 1e-9, `B 标签 ${key} 早于主动作 ${k}（p=${p}）`));
      }
    }
  }
});

test('生长只增不减；灰化后保留在 35%，不消失', () => {
  let prevA = viewA(0, 'skew'), prevB = viewB(0);
  for (const p of samples) {
    const a = viewA(p, 'skew'), b = viewB(p);
    ['s1', 's2', 'n', 'AB', 'BF', 'CP'].forEach(k => assert.ok(a[k].g >= prevA[k].g - 1e-12, `A ${k} 倒退 p=${p}`));
    ['n', 'drops', 'plane', 'Lp'].forEach(k => assert.ok(b[k].g >= prevB[k].g - 1e-12, `B ${k} 倒退 p=${p}`));
    prevA = a; prevB = b;
  }
  assert.ok(Math.abs(viewA(3.9, 'skew').s1.a - GHOST) < 1e-9, 's₁ 灰化到 35%');
  assert.equal(viewA(2, 'skew').s1.a, 1);
  assert.ok(Math.abs(viewB(3.9).v.a - GHOST) < 1e-9, 'v 灰化到 35%');
});

test('平行情形：不出现 n、A、B，公垂线在第 3 章生长', () => {
  const a = viewA(4, 'parallel');
  assert.equal(a.n.g, 0);
  assert.equal(a.A.g, 0);
  assert.equal(a.AB.g, 0);
  assert.equal(a.CP.g, 1);
  assert.equal(viewA(2.2, 'parallel').CP.g, 0);
  const mid = viewA(2.5, 'parallel').CP.g;
  assert.ok(mid > 0 && mid < 1, '第 3 章的主动作窗口内公垂线生长');
});
