const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const EPS = 1e-9;

function steps(seq, n = 20) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(i / n);
  return out;
}

const rowSig = (rows) =>
  rows.map((r) =>
    r.empty || r.alpha < 0.02 ? null : [r.mac, r.port, r.ttl, Number(r.alpha.toFixed(3))]
  );

function tablesOf(f) {
  return { 1: rowSig(f.rows['1'] || []), 2: rowSig(f.rows['2'] || []) };
}

test('单交换机：17 步，总时长等于各步时长之和', () => {
  const seq = M.buildSingle();
  assert.equal(seq.beats.length, 17);
  const { starts, total } = M.beatStarts(seq);
  assert.equal(starts.length, 17);
  assert.equal(starts[0], 0);
  const sum = seq.beats.reduce((a, b) => a + b.dur, 0);
  assert.ok(Math.abs(sum - total) < EPS);
  seq.beats.forEach((b, i) => {
    assert.ok(b.dur > 0.5, `第 ${i + 1} 步时长过短`);
    assert.ok(b.phase.length >= 2 && b.phase.length <= 4, `阶段名应为 2–4 字：${b.phase}`);
    assert.ok(b.caption.length <= 40, `解说超过 40 字：${b.caption}`);
  });
});

test('双交换机：两条推演步数正确，STP 推演更短且没有风暴步', () => {
  const loop = M.buildLoop(false);
  const stp = M.buildLoop(true);
  assert.equal(loop.beats.length, 11);
  assert.equal(stp.beats.length, 6);
  assert.ok(loop.beats.some((b) => b.storm));
  assert.ok(!stp.beats.some((b) => b.storm));
  assert.equal(loop.beats[loop.beats.length - 1].id, 'storm');
});

test('相邻步之间状态连续：上一步终点的表项与计数等于下一步起点', () => {
  [M.buildSingle(), M.buildLoop(false), M.buildLoop(true)].forEach((seq) => {
    for (let i = 1; i < seq.beats.length; i++) {
      const prev = seq.beats[i - 1];
      const cur = seq.beats[i];
      assert.deepEqual(cur.before, prev.after, `${seq.id} 第 ${i + 1} 步 before 与上一步 after 不一致`);
    }
  });
});

test('画面连续：上一步 p=1 与下一步 p=0 画出的表项、计数、端口一致', () => {
  [M.buildSingle(), M.buildLoop(false), M.buildLoop(true)].forEach((seq) => {
    for (let i = 0; i < seq.beats.length - 1; i++) {
      const end = M.frameOf(seq, i, 1);
      const start = M.frameOf(seq, i + 1, 0);
      assert.deepEqual(tablesOf(start), tablesOf(end), `${seq.id} 第 ${i + 1}→${i + 2} 步表项跳变`);
      assert.deepEqual(start.stats, end.stats, `${seq.id} 第 ${i + 1}→${i + 2} 步计数跳变`);
      assert.deepEqual(start.ports, end.ports, `${seq.id} 第 ${i + 1}→${i + 2} 步端口状态跳变`);
      assert.equal(start.copies, end.copies);
      const visible = (f) => f.chips.filter((c) => c.alpha > 0.02).length;
      assert.equal(visible(end), 0, `${seq.id} 第 ${i + 1} 步末尾不应有飞行帧`);
      assert.equal(visible(start), 0, `${seq.id} 第 ${i + 2} 步起点不应有飞行帧`);
    }
  });
});

test('同一个（步，进度）重复取样结果一致', () => {
  const seq = M.buildLoop(false);
  seq.beats.forEach((b, i) => {
    steps(seq).forEach((p) => {
      assert.deepEqual(M.frameOf(seq, i, p), M.frameOf(seq, i, p));
    });
  });
});

test('学习规则：源 MAC 记在入口端口，目的命中单播、未命中泛洪', () => {
  const seq = M.buildSingle();
  const tableAfter = (id) => {
    const i = seq.beats.findIndex((b) => b.id === id);
    assert.ok(i >= 0);
    return seq.beats[i].after.tables[1].map((r) => `${r.mac}->${r.port}`);
  };
  assert.deepEqual(tableAfter('learn1'), ['A->1']);
  assert.deepEqual(tableAfter('learn2'), ['A->1', 'B->2']);
  assert.deepEqual(tableAfter('learn3'), ['A->1', 'B->2', 'C->3']);
  // 泛洪不改变表项；命中不新增表项
  assert.deepEqual(tableAfter('flood1'), ['A->1']);
  assert.deepEqual(tableAfter('lookup2'), ['A->1', 'B->2']);
  // 学习到的端口与主机接入端口一致
  Object.keys(M.SG.hosts).forEach((host) => {
    const h = M.SG.hosts[host];
    const portNo = Number(h.port.split(':')[1]);
    const rows = tableAfter('learn4');
    const row = rows.find((r) => r.startsWith(host + '->'));
    if (host !== 'A') assert.equal(row, `${host}->${portNo}`, `${host} 的端口登记错误`);
  });
});

test('老化：A 的表项先倒数到 0 再被删除，删除后目的 A 只能泛洪', () => {
  const seq = M.buildSingle();
  const i = seq.beats.findIndex((b) => b.id === 'aging');
  const at = (p) => M.frameOf(seq, i, p);

  const start = at(0).rows[1].find((r) => !r.empty);
  assert.equal(start.mac, 'A');
  assert.equal(start.ttl, 300);

  const mid = at(0.4).rows[1].find((r) => !r.empty);
  assert.ok(mid.ttl < 300 && mid.ttl > 0, `老化过程中 TTL 应在 (0,300)：${mid.ttl}`);

  const end = at(1).rows[1].filter((r) => !r.empty).map((r) => r.mac);
  assert.deepEqual(end, ['B', 'C']);

  const lookup = seq.beats.find((b) => b.id === 'lookup4');
  assert.match(lookup.caption, /查不到|未命中/);
  const lastFlood = seq.beats[seq.beats.length - 1];
  assert.equal(lastFlood.id, 'flood4');
  assert.equal(lastFlood.after.tally.flood, 2, '老化后应再泛洪一次');
});

test('计数只增不减，且与推演结果一致', () => {
  const seq = M.buildSingle();
  let lastFlood = -1;
  let lastUnicast = -1;
  seq.beats.forEach((b, i) => {
    const f = M.frameOf(seq, i, 1);
    const flood = f.stats[0].value;
    const unicast = f.stats[1].value;
    assert.ok(flood >= lastFlood, `泛洪计数回退于第 ${i + 1} 步`);
    assert.ok(unicast >= lastUnicast, `单播计数回退于第 ${i + 1} 步`);
    lastFlood = flood;
    lastUnicast = unicast;
  });
  assert.equal(lastFlood, 2);
  assert.equal(lastUnicast, 2);
});

test('兜圈：两条副本让 SW2 表项先记端口 1 再被覆写成端口 2', () => {
  const seq = M.buildLoop(false);
  const idx = (id) => seq.beats.findIndex((b) => b.id === id);
  const learn2 = seq.beats[idx('learn2')].after.tables[2];
  assert.deepEqual(learn2.map((r) => `A->${r.port}`), ['A->1']);

  const flap = M.frameOf(seq, idx('flap2'), 0.8);
  const row = flap.rows[2].find((r) => !r.empty);
  assert.equal(row.mac, 'A');
  assert.equal(row.port, 2);
  assert.equal(row.tone, 'warn', '被覆写的表行应标红');
  assert.equal(
    M.frameOf(seq, idx('flap2'), 1).rows[2].find((r) => !r.empty).tone,
    'warn',
    '被覆写的状态保留到下一步，避免边界跳变'
  );

  // 覆写过程中端口值翻牌：中途会收缩
  const mid = M.frameOf(seq, idx('flap2'), 0.37).rows[2].find((r) => !r.empty);
  assert.ok(mid.sy < 0.9, '端口值应有翻牌过渡');

  const back = M.frameOf(seq, idx('back1'), 0.5);
  assert.ok(back.chips.length >= 2, '倒灌应有两个副本在链路上');
  assert.ok(back.chips.every((c) => c.tone === 'red'));
});

test('兜圈：B 收到两份副本，倒灌后 SW1 表项被改成端口 4 再改成端口 3', () => {
  const seq = M.buildLoop(false);
  const idx = (id) => seq.beats.findIndex((b) => b.id === id);

  assert.equal(seq.beats[idx('flood2')].after.copies, 2);
  const bReceipts = M.frameOf(seq, idx('flood2'), 0.8).receipts;
  assert.ok(bReceipts.some((r) => /×2/.test(r.text)), 'B 的回执应显示收到两份');

  const flap1 = M.frameOf(seq, idx('flap1'), 1).rows[1].find((r) => !r.empty);
  assert.equal(flap1.port, 4);
  const flap1b = M.frameOf(seq, idx('flap1b'), 1).rows[1].find((r) => !r.empty);
  assert.equal(flap1b.port, 3);
});

test('风暴：副本数单调增长，表项在两个端口间抖动，三枚芯片在环路上', () => {
  const seq = M.buildLoop(false);
  const i = seq.beats.length - 1;
  let last = -1;
  let ports = new Set();
  for (let k = 1; k <= 20; k++) {
    const f = M.frameOf(seq, i, k / 20);
    assert.equal(f.stats.length, 1);
    assert.ok(f.stats[0].value >= last, '副本数不应回退');
    last = f.stats[0].value;
    assert.equal(f.chips.length, 3);
    f.chips.forEach((c) => {
      assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
      assert.ok(c.x >= 0 && c.x <= 1100 && c.y >= 0 && c.y <= 560, '芯片应在舞台内');
    });
    const row = f.rows[1].find((r) => !r.empty);
    ports.add(row.port);
    assert.ok(f.storm && f.storm.alpha > 0, '风暴环应可见');
    assert.ok(f.meter > 0 && f.meter <= 1);
  }
  assert.ok(last > 4, '风暴中副本数应持续增长');
  assert.deepEqual([...ports].sort(), [3, 4], 'SW1 表项应在端口 3、4 之间抖动');
});

test('STP：阻塞 SW2 端口 2，环路断开，B 只收到一份', () => {
  const seq = M.buildLoop(true);
  const idx = (id) => seq.beats.findIndex((b) => b.id === id);
  assert.ok(idx('block') >= 0);

  const blocked = M.frameOf(seq, idx('flood1'), 0.5).ports['2:2'];
  assert.equal(blocked.tone, 'blocked');

  const flood = M.frameOf(seq, idx('flood1'), 0.8);
  assert.ok(flood.receipts.some((r) => /阻塞丢弃/.test(r.text)), '阻塞端口应给出丢弃回执');

  const end = M.frameOf(seq, seq.beats.length - 1, 1);
  assert.equal(end.stats[0].value, 1);
  assert.equal(end.storm, null);
  assert.equal(seq.beats[idx('forward')].after.tables[2][0].port, 1);
});

test('命中时才画查表连线，且连线终点落在出口端口附近', () => {
  const seq = M.buildSingle();
  const hit = seq.beats.findIndex((b) => b.id === 'lookup2');
  const conn = M.frameOf(seq, hit, 1).connector;
  assert.ok(conn && conn.d.startsWith('M'), '命中应画出查表连线');
  assert.equal(conn.tone, 'green');

  // 端口 1 位于 (380,118)
  const port = M.SG.ports['1:1'];
  const pts = conn.d
    .trim()
    .split(/\s*L\s*/)
    .map((s) => s.replace(/^M/, '').split(' ').map(Number));
  const [x, y] = pts[pts.length - 1];
  assert.ok(Math.abs(x - port.x) < 1.5 && Math.abs(y - port.y) < 1.5, '连线终点应对准端口');

  const miss = seq.beats.findIndex((b) => b.id === 'lookup1');
  assert.equal(M.frameOf(seq, miss, 0.5).connector, null, '未命中不画连线');
});

test('所有步、所有进度上的坐标与样式数值都是有限值', () => {
  [M.buildSingle(), M.buildLoop(false), M.buildLoop(true)].forEach((seq) => {
    seq.beats.forEach((b, i) => {
      steps(seq, 12).forEach((p) => {
        const f = M.frameOf(seq, i, p);
        Object.values(f.rows).forEach((rows) =>
          rows.forEach((r) => {
            ['alpha', 'dy', 'sy', 'shake'].forEach((k) => {
              assert.ok(Number.isFinite(r[k]), `${seq.id} ${b.id} row.${k} 不是有限值`);
            });
            assert.ok(r.alpha >= 0 && r.alpha <= 1);
            assert.ok(r.sy > 0);
          })
        );
        f.chips.forEach((c) => {
          assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
          assert.ok(c.alpha >= 0 && c.alpha <= 1);
          assert.ok(c.trail.startsWith('M'));
        });
        f.tags.forEach((t) => {
          assert.ok(t.alpha >= 0 && t.alpha <= 1);
          assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
          assert.ok([...t.text].length <= 8, `浮标应 ≤ 8 字：${t.text}`);
        });
        f.receipts.forEach((r) => {
          assert.ok(r.alpha >= 0 && r.alpha <= 1);
          assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
        });
        f.stats.forEach((s) => {
          assert.ok(Number.isFinite(s.value));
          assert.ok(s.pop >= 1 && s.pop <= 1.2);
        });
      });
    });
  });
});

test('locate：时刻换算与步边界一致，越界时夹到两端', () => {
  const seq = M.buildLoop(false);
  const { starts, total } = M.beatStarts(seq);
  assert.equal(M.locate(seq, 0).index, 0);
  assert.equal(M.locate(seq, 0).p, 0);
  starts.forEach((t, i) => {
    if (t === 0) return;
    const loc = M.locate(seq, t);
    assert.equal(loc.index, i, `时刻 ${t} 应落在第 ${i + 1} 步`);
    assert.equal(loc.p, 0);
  });
  assert.equal(M.locate(seq, total).index, seq.beats.length - 1);
  assert.equal(M.locate(seq, total).p, 1);
  assert.equal(M.locate(seq, -5).index, 0);
  assert.equal(M.locate(seq, total + 10).p, 1);
});

test('步骤分组覆盖全部步且首尾衔接', () => {
  [M.buildSingle(), M.buildLoop(false), M.buildLoop(true)].forEach((seq) => {
    assert.ok(seq.groups.length >= 2);
    assert.equal(seq.groups[0].from, 0);
    seq.groups.forEach((g, i) => {
      const end = i + 1 < seq.groups.length ? seq.groups[i + 1].from : seq.beats.length;
      assert.ok(end > g.from, `${seq.id} 分组 ${g.label} 为空`);
    });
  });
});
