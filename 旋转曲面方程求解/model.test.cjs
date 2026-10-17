const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const ONE = [1, 1, 1];

// 曲面网格的全部顶点（网格为 Float32，容差按坐标尺度放宽）
function meshPoints(f) {
  const out = [];
  for (let i = 0; i < f.surface.length; i += 3) out.push([f.surface[i], f.surface[i + 1], f.surface[i + 2]]);
  return out;
}

function assertOn(F, pts, label) {
  for (const p of pts) {
    const tol = 1e-5 * (1 + dot(p, p));
    assert.ok(Math.abs(F(p)) <= tol, `${label}: F=${F(p)} 于 ${p}`);
  }
}

const THETAS = [0, 1, 90, 220, 359.9, 360];

test('案例一预设一：曲面网格满足界面所写方程 (x²+y²)/3.24 − z²/4.6656 = 1', () => {
  for (const th of THETAS) {
    assertOn(M.residual(1, 0), meshPoints(M.frame(1, 0, 0.6, th)), `θ=${th}`);
  }
});

test('案例一预设二：空间抛物线旋转得到 (x²+y²) = (1+0.25z²)² + 0.64z²', () => {
  for (const t of [-1.5, 0.3, 1.7]) {
    assertOn(M.residual(1, 1), meshPoints(M.frame(1, 1, t, 220)), `t=${t}`);
  }
});

test('案例一：M₀ 的纬圆与 z 轴垂直，P 与 M₀ 等高、到轴距离相等', () => {
  const f = M.frame(1, 0, 0.6, 220);
  assert.ok(Math.abs(f.P[2] - f.M0[2]) < 1e-12);
  assert.ok(Math.abs(Math.hypot(f.P[0], f.P[1]) - Math.hypot(f.M0[0], f.M0[1])) < 1e-9);
});

test('案例二预设一（考研真题）：P·(1,1,1)=6t 且 |OP|=|OM₀|，曲面满足 18(x²+y²+z²)=7(x+y+z)²', () => {
  const t = 0.6;
  for (const th of THETAS) {
    const f = M.frame(2, 0, t, th);
    assert.ok(Math.abs(dot(f.P, ONE) - 6 * t) < 1e-9, `θ=${th} 垂直截面 x+y+z=6t`);
    assert.ok(Math.abs(norm(f.P) - norm(f.M0)) < 1e-9, `θ=${th} 等距`);
    assert.ok(Math.abs(norm(f.M0) ** 2 - 14 * t * t) < 1e-9, 'M₀ 在 L₁ 上');
    assertOn(M.residual(2, 0), meshPoints(f), `θ=${th}`);
  }
});

test('案例二预设二：z 轴绕对角线得到 xy+yz+zx=0', () => {
  const t = -1.2;
  for (const th of THETAS) {
    const f = M.frame(2, 1, t, th);
    assert.ok(Math.abs(dot(f.P, ONE) - t) < 1e-9, `θ=${th} 截面 x+y+z=t`);
    assertOn(M.residual(2, 1), meshPoints(f), `θ=${th}`);
  }
});

test('案例三：准线点满足界面所写准线方程（显示与绘制一致）', () => {
  const p0 = M.frame(3, 0, 0.6, 0);
  for (const p of p0.ring) {
    assert.ok(Math.abs(p[0] * p[0] + p[1] * p[1] - 4) < 1e-9 && p[2] === 2, `预设一准线 ${p}`);
  }
  const p1 = M.frame(3, 1, 0.6, 0);
  for (const p of p1.ring) {
    assert.ok(Math.abs((p[0] * p[0]) / 5.76 + (p[1] * p[1]) / 2.25 - 1) < 1e-9 && p[2] === 2, `预设二准线 ${p}`);
  }
  assert.ok(Math.abs((p1.M1[0] ** 2) / 5.76 + (p1.M1[1] ** 2) / 2.25 - 1) < 1e-9, 'M₁ 在准线上');
});

test('案例三：锥面网格满足 z²=x²+y² 与 x²/2.4²+y²/1.5²=z²/4', () => {
  for (const th of THETAS) {
    assertOn(M.residual(3, 0), meshPoints(M.frame(3, 0, 0.6, th)), `预设一 θ=${th}`);
    assertOn(M.residual(3, 1), meshPoints(M.frame(3, 1, -0.9, th)), `预设二 θ=${th}`);
  }
});

test('网格拓扑与 θ 无关：同一案例的顶点数恒为 rows×cols，可原地更新', () => {
  for (const c of [1, 2, 3]) {
    const sizes = new Set();
    for (const th of THETAS) {
      const f = M.frame(c, 0, 0.6, th);
      sizes.add(f.surface.length);
      assert.equal(f.surface.length, f.rows * f.cols * 3);
    }
    assert.equal(sizes.size, 1, `案例${c} 的网格尺寸随 θ 变化`);
  }
});

test('扫掠连续：θ 每变 0.5°，动点与曲面顶点只移动很小一段（无跳变）', () => {
  for (const c of [1, 2]) {
    let prev = M.frame(c, 0, 0.6, 0);
    for (let th = 0.5; th <= 360; th += 0.5) {
      const cur = M.frame(c, 0, 0.6, th);
      const d = (0.5 * Math.PI) / 180;
      assert.ok(norm(sub(cur.P, prev.P)) <= prev.r * d * 1.001 + 1e-9, `案例${c} θ=${th} P 跳变`);
      prev = cur;
    }
  }
});

test('标签键唯一，θ 为 0 时圆弧不生成', () => {
  for (const c of [1, 2, 3]) {
    for (const p of [0, 1]) {
      const f = M.frame(c, p, 0.6, 0);
      const keys = f.labels.map((l) => l.key);
      assert.equal(new Set(keys).size, keys.length, `案例${c} 预设${p} 标签键重复`);
    }
  }
  const arc0 = M.frame(1, 0, 0.6, 0).arc;
  assert.ok(arc0.every((q) => norm(sub(q, arc0[0])) < 1e-12), 'θ=0 时圆弧退化为一点');
});

test('阶段名随 θ 变化', () => {
  assert.equal(M.phaseOf(1, 0), '起始');
  assert.equal(M.phaseOf(1, 220), '扫掠中');
  assert.equal(M.phaseOf(1, 360), '一周闭合');
  assert.equal(M.phaseOf(3, 360), '织面完成');
});

test('分步推导：案例一、二五步，案例三六步；步名不超过 3 字，旁白不超过 40 字，每步都有公式或表格', () => {
  for (const c of [1, 2, 3]) {
    for (const p of [0, 1]) {
      const st = M.steps(c, p, 0.6, 220);
      assert.equal(st.length, M.stepCount(c), `案例${c} 预设${p}`);
      assert.equal(M.stepCount(c), c === 3 ? 6 : 5);
      for (const s of st) {
        assert.ok(s.name.length >= 1 && s.name.length <= 3, `步名 ${s.name}`);
        assert.ok(s.narration.length <= 40, `旁白过长：${s.narration}`);
        assert.ok(s.lines.some((l) => l.tex || l.table), `${s.name} 没有公式或表格`);
      }
    }
  }
});

test('推导文字的数值与当前参数一致', () => {
  const m0 = M.steps(1, 0, 0.6, 220)[0].lines[1].tex;
  assert.ok(m0.includes('0.60') && m0.includes('0.72'), m0);
  const m1 = M.steps(3, 1, 0.6, 220)[1].lines[0].tex;
  assert.ok(m1.includes((2.4 * Math.cos(((0.6 + 2) / 4) * 2 * Math.PI)).toFixed(2)), m1);
});

test('§9 的开方正负表与三大曲面对照表：列数与表头一致，高亮行在范围内，高亮随预设变化', () => {
  for (const p of [0, 1]) {
    const tables = M.steps(3, p, 0.6, 220).flatMap((s) => s.lines.filter((l) => l.table));
    assert.equal(tables.length, 2, `预设${p} 应有两张表`);
    for (const { table, hi } of tables) {
      for (const r of table.rows) assert.equal(r.length, table.head.length, '列数与表头不一致');
      assert.ok(hi >= 0 && hi < (table.hiCol ? table.head.length : table.rows.length), '高亮越界');
    }
  }
  assert.equal(M.steps(3, 0, 0.6, 220)[4].lines.find((l) => l.table).hi, 0);
  assert.equal(M.steps(3, 1, 0.6, 220)[4].lines.find((l) => l.table).hi, 3);
  assert.equal(M.steps(3, 0, 0.6, 220)[5].lines[0].table.head[2], '锥面');
});

test('案例三有六步：时间线长度与步数一致，扫掠步仍是第四步，末步之后停在第六步', () => {
  const tl = M.timeline(220, false, M.stepCount(3));
  assert.equal(tl.starts.length, 6);
  assert.equal(M.timeline(220, false).starts.length, 5);
  assert.equal(M.thetaAt(tl, M.SWEEP_STEP, tl.durations[M.SWEEP_STEP], 220, false), 220);
  assert.equal(M.locate(tl, tl.total + 1).index, 5);
});

test('时间线：步长之和为总时长，扫掠步 θ 线性从 0 到目标值', () => {
  const tl = M.timeline(220, false);
  assert.equal(tl.starts.length, 5);
  assert.ok(Math.abs(tl.total - tl.durations.reduce((a, b) => a + b, 0)) < 1e-12);
  const sw = M.SWEEP_STEP;
  assert.equal(M.thetaAt(tl, sw, 0, 220, false), 0);
  assert.ok(Math.abs(M.thetaAt(tl, sw, tl.durations[sw] / 2, 220, false) - 110) < 1e-9);
  assert.equal(M.thetaAt(tl, sw, tl.durations[sw], 220, false), 220);
  assert.equal(M.thetaAt(tl, sw - 1, 0.5, 220, false), 0);
  assert.equal(M.thetaAt(tl, sw + 1, 0.5, 220, false), 220);
});

test('边界无跳变：上一步终点的画面等于下一步起点（θ 与各元素的显隐）', () => {
  const tl = M.timeline(220, false);
  for (let i = 0; i < 4; i++) {
    const end = tl.durations[i];
    assert.ok(Math.abs(M.thetaAt(tl, i, end, 220, false) - M.thetaAt(tl, i + 1, 0, 220, false)) < 1e-9, `边界 ${i}`);
    assert.equal(M.revealAlpha(i + 1, 0, i + 1, false), 0, '新元素起步时透明');
    assert.equal(M.revealAlpha(i, end, i, false), 1, '本步元素结束时完全显示');
    assert.equal(M.revealAlpha(i + 1, 0, i, false), 1, '更早出现的元素保持显示');
  }
});

test('定位：时钟到步起点即落在该步；超过末尾停在最后一步', () => {
  const tl = M.timeline(220, false);
  for (let i = 0; i < 5; i++) {
    const loc = M.locate(tl, tl.starts[i]);
    assert.equal(loc.index, i);
    assert.ok(Math.abs(loc.local) < 1e-12);
  }
  const end = M.locate(tl, tl.total + 5);
  assert.equal(end.index, 4);
  assert.ok(Math.abs(end.local - tl.durations[4]) < 1e-12);
});

test('减少动效：扫掠步直接到目标值，新元素不淡入，步长变短', () => {
  const tl = M.timeline(220, true);
  assert.equal(M.thetaAt(tl, M.SWEEP_STEP, 0, 220, true), 220);
  assert.equal(M.revealAlpha(2, 0, 2, true), 1);
  assert.ok(tl.durations[0] < M.timeline(220, false).durations[0]);
});

test('每帧的标签键都在 REVEAL 表中登记了出现的步', () => {
  for (const c of [1, 2, 3]) {
    for (const p of [0, 1]) {
      for (const l of M.frame(c, p, 0.6, 220).labels) {
        assert.ok(Object.prototype.hasOwnProperty.call(M.REVEAL[c], l.key), `案例${c} 预设${p} 标签 ${l.key} 未登记`);
      }
    }
  }
});

// 局部工具：避免引入 vector 库
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
