'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const tree = M.buildTree();
const kfs = M.scriptedKeyframes();
const node = (id) => tree.nodes[tree.byId.get(id)];
const steady = (k) => M.sample(tree, kfs, M.T.caseStart + k * M.T.caseSpan + 3.0);

test('自顶向下划分：每次拿出一位，根块两次二分得到四个 /26 叶子', () => {
  assert.equal(tree.nodes.length, 7);
  assert.equal(node('').size, 256);
  assert.equal(node('0').cidr, '10.10.10.0/25');
  assert.equal(node('1').cidr, '10.10.10.128/25');
  assert.deepEqual(['00', '01', '10', '11'].map((id) => node(id).cidr),
    ['10.10.10.0/26', '10.10.10.64/26', '10.10.10.128/26', '10.10.10.192/26']);
  assert.equal(tree.leaves.length, 4);
  tree.leaves.forEach((i) => assert.equal(tree.nodes[i].prefix, 26));
});

test('子节点的两半刚好铺满父块；左分支记 0，右分支记 1', () => {
  tree.nodes.forEach((v) => {
    if (v.leaf) return;
    const [l, r] = v.childIdx.map((i) => tree.nodes[i]);
    assert.equal(l.start, v.start);
    assert.equal(r.start, v.start + v.size / 2);
    assert.equal(l.size + r.size, v.size);
    assert.equal(l.bit, 0);
    assert.equal(r.bit, 1);
  });
});

test('每种情况都选三个子网（数量规则）', () => {
  M.CASES.forEach((c) => {
    assert.equal(c.ids.length, 3, c.title);
    assert.equal(new Set(c.ids).size, 3, `${c.title} 不能重复选同一个`);
  });
});

test('情况 1 与 2 合法：互不包含、兜住全部水、每个需求装得下', () => {
  for (const k of [0, 1]) {
    const ev = M.evaluateSelection(tree, M.CASES[k].ids);
    assert.equal(ev.verdict, 'ok', M.CASES[k].title);
    assert.deepEqual(Object.values(ev.rules), [true, true, true, true]);
    assert.equal(ev.uncovered, 0);
    assert.equal(ev.overlap, 0);
  }
});

test('情况 1 即哈夫曼合并的结果，与 2025 年真题的答案一致', () => {
  const ev = M.evaluateSelection(tree, M.CASES[0].ids);
  const got = ev.subnets.map((s) => `${s.cidr}=${s.demand}`).sort();
  assert.deepEqual(got, [
    '10.10.10.0/26=管理区',
    '10.10.10.128/25=生活区',
    '10.10.10.64/26=作业区'
  ].sort());
});

test('情况 2：上一级选左半的 /25，下一级的两个 /26 兜住右半的水', () => {
  const ev = M.evaluateSelection(tree, M.CASES[1].ids);
  assert.ok(ev.subnets.some((s) => s.cidr === '10.10.10.0/25' && s.demand === '生活区'));
  const right = ev.subnets.filter((s) => s.cidr.startsWith('10.10.10.128') || s.cidr.startsWith('10.10.10.192'));
  assert.equal(right.length, 2);
});

test('情况 3 漏水：右半的 10.10.10.192/26 没人兜住，漏 64，需求 生活区 也装不下', () => {
  const ev = M.evaluateSelection(tree, M.CASES[2].ids);
  assert.equal(ev.verdict, 'leak');
  assert.equal(ev.uncovered, 64);
  assert.equal(ev.rules.cover, false);
  assert.equal(ev.rules.fit, false);
});

test('情况 4 祖先关系：10.10.10.0/26 在 /25 之内，水被重复兜住 64', () => {
  const ev = M.evaluateSelection(tree, M.CASES[3].ids);
  assert.equal(ev.verdict, 'ancestor');
  assert.equal(ev.rules.antichain, false);
  assert.equal(ev.overlap, 64);
  assert.deepEqual(ev.conflicts[0], ['10.10.10.0/25', '10.10.10.0/26']);
});

test('数量规则：选了两个或四个子网都判为“不是三个子网”', () => {
  assert.equal(M.evaluateSelection(tree, ['00', '1']).rules.count, false);
  assert.equal(M.evaluateSelection(tree, ['00', '01', '10', '11']).rules.count, false);
  assert.equal(M.evaluateSelection(tree, ['00', '01', '10', '11']).verdict, 'count');
});

test('稳态数值：兜住、漏水与重复随情况变化，且与检验结果一致', () => {
  const s1 = steady(0);
  assert.equal(Math.round(s1.totals.caught), 256);
  assert.equal(Math.round(s1.totals.leak), 0);
  assert.equal(Math.round(s1.totals.over), 0);
  assert.equal(s1.banner, '合法');

  const s3 = steady(2);
  assert.equal(Math.round(s3.totals.caught), 192);
  assert.equal(Math.round(s3.totals.leak), 64);
  assert.equal(s3.banner, '漏水');

  const s4 = steady(3);
  assert.equal(Math.round(s4.totals.caught), 256);
  assert.equal(Math.round(s4.totals.over), 64);
  assert.equal(s4.banner, '祖先关系');
});

test('稳态下，兜水与漏水的按节点求和等于按地址求和（两种算法互相印证）', () => {
  for (let k = 0; k < 4; k++) {
    const s = steady(k);
    const byCover = s.cover.reduce((acc, c) => {
      acc.caught += c.c * c.size;
      acc.leak += c.l * c.size;
      acc.over += c.o * c.size;
      return acc;
    }, { caught: 0, leak: 0, over: 0 });
    assert.ok(Math.abs(byCover.caught - s.totals.caught) < 1e-6, `情况 ${k + 1} 兜住`);
    assert.ok(Math.abs(byCover.leak - s.totals.leak) < 1e-6, `情况 ${k + 1} 漏水`);
    assert.ok(Math.abs(byCover.over - s.totals.over) < 1e-6, `情况 ${k + 1} 重复`);
  }
});

test('有选中的祖先时，子孙的通过比例为 0（水不再下流，不会漏）', () => {
  const s = steady(0);
  assert.equal(s.nodes[tree.byId.get('10')].pass, 0, '右半下的 10 在情况 1 中被 1 兜住');
  assert.equal(s.nodes[tree.byId.get('11')].pass, 0);
  assert.equal(s.nodes[tree.byId.get('00')].pass, 1, '左半未被兜住时仍向下流');
});

test('注水之前没有子网：水全部从叶子漏出（注水结束前一瞬）', () => {
  const s = M.sample(tree, kfs, M.T.caseStart - 0.01);
  assert.ok(s.totals.caught < 1e-9, '没有子网，就没有兜住的水');
  assert.ok(s.totals.leak > 254, `几乎全部漏出，实际 ${s.totals.leak}`);
  assert.equal(s.banner, '未选子网');
});

test('拿位动画：根先出现，第一刀之前子节点不可见，第二刀之后叶子全部可见', () => {
  const before = M.sample(tree, kfs, M.T.split1 - 0.1);
  assert.equal(before.nodes[node('0').idx].alpha, 0);
  const mid = M.sample(tree, kfs, M.T.split2 + 0.05);
  assert.ok(mid.nodes[node('00').idx].alpha < 1, '第二刀刚开始，叶子仍在淡入');
  const after = M.sample(tree, kfs, M.T.split2 + M.T.splitDur + 0.1);
  tree.leaves.forEach((i) => assert.equal(after.nodes[i].alpha, 1));
  assert.equal(after.bitLit[0], 1);
  assert.equal(after.bitLit[1], 1);
});

test('选择的过渡为 0.6 s：membership 连续单调，过渡后稳定在新集合', () => {
  const start = M.T.caseStart + M.T.caseSpan;     // 情况 2 开始：从情况 1 过渡到情况 2
  const idx = node('0').idx;                       // 左半 /25：情况 1 中未选，情况 2 中选
  let prev = 0;
  for (let i = 0; i <= 60; i++) {
    const m = M.membership(tree, kfs, start + (i / 60) * M.T.ramp)[idx];
    assert.ok(m >= prev - 1e-12, '单调上升');
    prev = m;
  }
  assert.equal(M.membership(tree, kfs, start + M.T.ramp + 0.1)[idx], 1);
});

test('自由选择：用户关键帧之后，最近的一次选择生效；没有关键帧时为空', () => {
  const extra = [...kfs, M.userKeyframe(M.DURATION + 1, ['0', '10', '11'])];
  assert.deepEqual([...M.setAt(extra, M.DURATION + 1.5)].sort(), ['0', '10', '11']);
  assert.deepEqual([...M.setAt(extra, M.DURATION + 0.5)].sort(), ['0', '00', '1'].sort(), '用户关键帧未到时仍是情况 4');
  assert.equal(M.setAt(kfs, 0), null, '没有关键帧时为空');
});

test('阶段划分：拿位、注水、三个情况各占一段，阶段索引与起点一致', () => {
  M.PHASES.forEach((p, i) => assert.equal(M.phaseIndexAt(p.start), i));
  assert.equal(M.PHASES.length, 7);
  assert.equal(M.phaseIndexAt(-5), 0);
  assert.equal(M.phaseIndexAt(1e6), M.PHASES.length - 1);
});

test('连续性：所有数值相邻 1/240 s 的变化都有界，不存在瞬时跳变', () => {
  const dt = 1 / 240;
  const bound = { pos: 1000, units: 800, frac: 6 };
  let prev = null;
  const worst = { pos: 0, units: 0, frac: 0 };
  for (let t = 0; t <= M.DURATION + 1e-9; t += dt) {
    const s = M.sample(tree, kfs, t);
    const cur = [];
    s.nodes.forEach((v) => cur.push(['pos', v.x], ['pos', v.y], ['frac', v.alpha], ['frac', v.m], ['frac', v.f], ['frac', v.pass], ['units', v.primary], ['units', v.dup], ['units', v.leak]));
    s.pipes.forEach((p) => cur.push(['frac', p.drawn], ['frac', p.front], ['pos', p.x1], ['pos', p.x2], ['pos', p.y1], ['pos', p.y2]));
    s.cover.forEach((c) => cur.push(['units', c.c * c.size], ['units', c.l * c.size], ['units', c.o * c.size]));
    cur.push(['units', s.totals.caught], ['units', s.totals.leak], ['units', s.totals.over]);
    s.tags.forEach((g) => cur.push(['frac', g.opacity], ['pos', g.rise]));
    if (prev) {
      assert.equal(cur.length, prev.length, '数值个数稳定');
      for (let i = 0; i < cur.length; i++) {
        const kind = cur[i][0];
        const rate = Math.abs(cur[i][1] - prev[i][1]) / dt;
        worst[kind] = Math.max(worst[kind], rate);
        assert.ok(rate <= bound[kind], `t=${t.toFixed(3)} ${kind} 变化率 ${rate.toFixed(1)} 超过 ${bound[kind]}`);
      }
    }
    prev = cur;
  }
  assert.ok(worst.units < 800 && worst.pos < 1000);
});
