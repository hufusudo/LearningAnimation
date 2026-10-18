const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

const G = M.GEO;
const L = M.LAYOUT;

const num = (v) => Math.round(v * 1000) / 1000;

// 画面上看得见的全部状态（浮点取三位，抹掉步末的最后一位抖动）
function snap(w) {
  return {
    frames: w.frames.map((f) => ({
      id: f.id,
      x: num(f.x),
      y: num(f.y),
      tag: num(f.tag),
      alpha: num(f.alpha),
      scale: f.scale,
      label: f.label,
      ghost: f.ghost
    })),
    ports: Object.keys(w.ports)
      .sort()
      .map((k) => [k, num(w.ports[k].glow), num(w.ports[k].mark)]),
    hosts: Object.keys(w.hosts)
      .sort()
      .map((k) => [k, num(w.hosts[k].recv), num(w.hosts[k].ring), num(w.hosts[k].send)]),
    bands: Object.keys(w.bands)
      .sort()
      .map((k) => [k, num(w.bands[k].dim)]),
    lookup: w.lookup ? [w.lookup.sw, w.lookup.vid, num(w.lookup.alpha)] : null,
    fabric: w.fabric ? [w.fabric.sw, num(w.fabric.alpha)] : null,
    pvid: w.pvid ? [num(w.pvid.x), num(w.pvid.y), num(w.pvid.alpha)] : null,
    trail: w.trail ? num(w.trail.alpha) : null,
    tags: w.tags.map((t) => t.text),
    result: num(w.result)
  };
}

const steps = M.STEPS.length;

test('边界无跳变：上一步终点 = 下一步起点', () => {
  for (let i = 0; i + 1 < steps; i++) {
    assert.deepEqual(snap(C.world(i + 1, 0)), snap(C.world(i, 1)), '第 ' + (i + 1) + ' 步到第 ' + (i + 2) + ' 步在边界上跳变');
  }
});

test('每时每刻：没有 NaN、数量受限、数值都在合理区间', () => {
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k <= 40; k++) {
      const p = k / 40;
      const w = C.world(i, p);
      assert.ok(w.frames.length <= 4, '同时出现的帧不超过 4 个');
      w.frames.forEach((f) => {
        assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y), '帧坐标出现 NaN');
        assert.ok(f.tag >= 0 && f.tag <= 1, '标签比例越界');
        assert.ok(f.alpha > 0 && f.alpha <= 1, '可见帧的透明度应在 (0,1]');
        assert.ok(f.x > 0 && f.x < G.stageW && f.y > 0 && f.y < G.stageH, '帧飞出舞台');
      });
      Object.values(w.ports).forEach((s) => {
        assert.ok(s.glow >= 0 && s.glow <= 1 && s.mark >= 0 && s.mark <= 1);
      });
      Object.values(w.hosts).forEach((s) => {
        assert.ok(s.recv >= 0 && s.recv <= 1 && s.ring >= 0 && s.ring <= 1 && s.send >= 0 && s.send <= 1);
      });
      w.tags.forEach((t) => {
        assert.ok(t.text.length <= 8, '浮标超过 8 字：' + t.text);
        assert.ok(t.alpha > 0 && t.alpha <= 1);
      });
    }
  }
});

test('帧只在步内出现：每步起点只有主帧，副本不跨步', () => {
  for (let i = 0; i < steps; i++) {
    const start = C.world(i, 0);
    // 第 1 步开始时帧还在主机 A 里，尚未出现
    assert.equal(start.frames.length, i === 0 ? 0 : 1, '第 ' + (i + 1) + ' 步起点的帧数不对');
    if (start.frames.length) assert.equal(start.frames[0].id, 'main');
    const end = C.world(i, 1);
    // 最后一步把帧交给主机 E，其余步末都还停着一颗主帧
    assert.equal(end.frames.length, i === steps - 1 ? 0 : 1, '第 ' + (i + 1) + ' 步终点的帧数不对');
  }
});

test('打标只发生一次且单调增长（第 2 步）', () => {
  let last = -1;
  for (let k = 0; k <= 50; k++) {
    const w = C.world(1, k / 50);
    const tag = w.frames[0].tag;
    assert.ok(tag >= last - 1e-9, '标签宽度回退');
    last = tag;
  }
  assert.ok(Math.abs(C.world(1, 0).frames[0].tag) < 1e-9);
  assert.ok(Math.abs(C.world(1, 1).frames[0].tag - 1) < 1e-9);
  // 帧长标签在插入完成后变成 1522 B
  assert.equal(C.world(1, 1).frames[0].label, '1522 B');
});

test('出向剥标：交付时帧又回到 1518 B（第 6 步）', () => {
  const mid = C.world(5, 0.6).frames[0];
  assert.equal(mid.tag, 0);
  assert.equal(mid.label, '1518 B');
  // 与主机 A 出发时一致：同一形态、同一帧长
  const start = C.world(0, 0.5).frames[0];
  assert.equal(start.tag, 0);
  assert.equal(start.label, '1518 B');
});

test('副本不跨步残留：副本只在广播/隔离那一步出现', () => {
  const withGhosts = [];
  for (let i = 0; i < steps; i++) {
    for (let k = 1; k < 40; k++) {
      if (C.world(i, k / 40).frames.some((f) => f.ghost)) withGhosts.push(i);
    }
  }
  assert.deepEqual([...new Set(withGhosts)].sort(), [2, 3, 5]);
});

test('累积状态不回退：已收到的 ✓ 与隔离的 ✕ 一旦出现就保持', () => {
  let prevRecv = {};
  let prevMark = {};
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k <= 40; k++) {
      const w = C.world(i, k / 40);
      Object.keys(w.hosts).forEach((id) => {
        assert.ok(w.hosts[id].recv >= (prevRecv[id] || 0) - 1e-9, id + ' 的收到状态回退');
        prevRecv[id] = w.hosts[id].recv;
      });
      Object.keys(w.ports).forEach((key) => {
        assert.ok(w.ports[key].mark >= (prevMark[key] || 0) - 1e-9, key + ' 的未转发标记回退');
        prevMark[key] = w.ports[key].mark;
      });
    }
  }
});

test('广播域：同 VLAN 的三台主机都收到，异 VLAN 一台都没有', () => {
  const end = C.world(5, 1);
  ['B', 'T3', 'T4', 'E', 'T9'].forEach((id) => assert.equal(end.hosts[id].recv, 1, id + ' 应该收到'));
  ['A', 'C', 'D', 'T7', 'F', 'T10', 'T11'].forEach((id) => assert.equal(end.hosts[id].recv, 0, id + ' 不该收到'));
  ['sw1:P5', 'sw1:P6', 'sw1:P7', 'sw2:P4', 'sw2:P5', 'sw2:P6'].forEach((key) => assert.equal(end.ports[key].mark, 1, key + ' 应被标记为未转发'));
  ['sw1:P2', 'sw1:P3', 'sw1:P4', 'sw2:P2', 'sw2:P3'].forEach((key) => assert.equal(end.ports[key].mark, 0, key + ' 不该被标记'));
});

test('帧宽：未打标 122、打标后 168', () => {
  assert.equal(C.frameWidth(0), C.FRAME_BASE);
  assert.equal(C.frameWidth(1), C.FRAME_BASE + C.FRAME_TAG);
  assert.equal(C.frameWidth(0.5), C.FRAME_BASE + C.FRAME_TAG / 2);
  // 帧宽必须容得下每个字段的文字（数据字段最窄）
  const minCell = Math.min(...C.CELLS.map((c) => c.w));
  assert.ok(minCell >= 20, '最窄的字段格放不下标签');
});

test('浮标位置在舞台内', () => {
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k <= 40; k++) {
      C.world(i, k / 40).tags.forEach((t) => {
        assert.ok(t.x > 0 && t.x < G.stageW && t.y > 0 && t.y < G.stageH, '浮标跑出舞台：' + t.text);
      });
    }
  }
});

test('结论只在最后一步末尾淡入', () => {
  assert.equal(C.world(4, 1).result, 0);
  assert.equal(C.world(5, 0.5).result, 0);
  assert.equal(C.world(5, 1).result, 1);
});

test('PVID 标签从端口飞向帧（第 2 步）', () => {
  const port = L.ports['sw1:P1'];
  const born = C.world(1, 0.12).pvid;
  const late = C.world(1, 0.3).pvid;
  assert.ok(born && late);
  assert.ok(born.y > late.y, 'PVID 标签应向上飞进帧里');
  assert.ok(Math.abs(late.y - G.anchorY) < 2, 'PVID 标签最终落在帧的位置');
  assert.equal(C.world(2, 0.5).pvid, null);
});
