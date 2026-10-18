const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const L = M.LAYOUT;
const G = M.GEO;

test('布局：每个端口都在自己的交换机体内，且不重叠', () => {
  Object.values(L.switches).forEach((sw) => {
    const access = sw.ports.map((key) => L.ports[key]);
    access.forEach((pt) => {
      assert.ok(pt.x1 >= sw.x && pt.x2 <= sw.x2, pt.key + ' 超出交换机左右边界');
      assert.ok(pt.y1 >= sw.y && pt.y2 <= sw.y2, pt.key + ' 超出交换机上下边界');
    });
    for (let i = 0; i + 1 < access.length; i++) {
      assert.ok(access[i].x2 < access[i + 1].x1, access[i].key + ' 与 ' + access[i + 1].key + ' 重叠');
    }
    // 端口行在交换机内居中
    const left = access[0].x1 - sw.x;
    const right = sw.x2 - access[access.length - 1].x2;
    assert.ok(Math.abs(left - right) < 12, sw.id + ' 端口行没有居中：' + left + ' / ' + right);
  });
});

test('布局：Trunk 端口贴在内侧边缘、落在总线上', () => {
  const t1 = L.ports['sw1:P8'];
  const t2 = L.ports['sw2:P1'];
  assert.equal(t1.x2, L.switches.sw1.x2);
  assert.equal(t2.x1, L.switches.sw2.x);
  assert.equal(t1.cy, G.busY);
  assert.equal(t2.cy, G.busY);
  assert.ok(t2.x1 > t1.x2, '两台交换机的 Trunk 端口之间要留出链路');
});

test('布局：主机正对端口，广播域带罩住自己的主机', () => {
  Object.values(L.hosts).forEach((h) => {
    const pt = L.ports[h.port];
    assert.equal(h.cx, pt.cx);
    assert.equal(h.vid, pt.vid);
    const band = L.bands[h.sw + ':' + h.vid];
    assert.ok(h.cx - h.w / 2 >= band.x1 && h.cx + h.w / 2 <= band.x2, h.id + ' 不在广播域带内');
    assert.ok(h.top > G.portTop + G.portH, h.id + ' 与端口行重叠');
  });
  Object.values(L.bands).forEach((b) => {
    assert.ok(b.x1 > L.switches[b.sw].x && b.x2 < L.switches[b.sw].x2, b.key + ' 广播域带超出交换机');
  });
});

test('布局：Trunk 链路两端都在总线高度上', () => {
  const a = L.ports['sw1:P8'];
  const b = L.ports['sw2:P1'];
  assert.ok(b.x1 > a.x2);
  assert.ok(Math.abs(a.y2 - b.y2) < 1e-9);
});

test('时刻表：六步，阶段名与解说符合规范', () => {
  assert.equal(M.STEPS.length, 6);
  M.STEPS.forEach((s) => {
    assert.ok(s.dur > 0);
    assert.ok(s.phase.length >= 2 && s.phase.length <= 4, '阶段名应为 2–4 字：' + s.phase);
    assert.ok(s.scope.length > 0);
    assert.ok(Array.from(s.narr).length <= 40, '解说超过 40 字：' + s.narr);
  });
});

test('时刻表：区间首尾相接，采样在边界上稳定', () => {
  const run = M.buildRun();
  assert.equal(run.N, 6);
  assert.ok(Math.abs(run.total - M.STEPS.reduce((a, s) => a + s.dur, 0)) < 1e-9);
  for (let i = 1; i < run.N; i++) {
    assert.ok(run.bounds[i] > run.bounds[i - 1]);
  }
  // 每个区间起点 → 该步 p = 0
  run.steps.forEach((step, i) => {
    const s = M.sampleAt(run, run.bounds[i]);
    assert.equal(s.index, i);
    assert.ok(Math.abs(s.p) < 1e-9);
  });
  // 末端 → 最后一步 p = 1
  const end = M.sampleAt(run, run.total);
  assert.equal(end.index, run.N - 1);
  assert.ok(Math.abs(end.p - 1) < 1e-9);
  // 越界与非法值被夹住
  assert.equal(M.sampleAt(run, -5).t, 0);
  assert.equal(M.sampleAt(run, run.total + 5).t, run.total);
  assert.equal(M.sampleAt(run, NaN).t, 0);
});

test('时刻表：时刻到步序单调不减，步内进度在 0–1', () => {
  const run = M.buildRun();
  let lastIndex = 0;
  for (let t = 0; t <= run.total; t += 0.05) {
    const s = M.sampleAt(run, t);
    assert.ok(s.index >= lastIndex, '步序回退：t=' + t);
    assert.ok(s.p >= 0 && s.p <= 1);
    lastIndex = s.index;
  }
});
