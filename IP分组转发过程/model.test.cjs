const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const EPS = 1e-9;
const SCENARIO_IDS = [1, 2, 3];

function samples(n = 20) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(i / n);
  return out;
}

test('三个场景的步数、时长与文案符合约束', () => {
  const expected = { 1: 4, 2: 7, 3: 10 };
  SCENARIO_IDS.forEach((id) => {
    const seq = M.buildSequence(id);
    assert.equal(seq.beats.length, expected[id], `场景 ${id} 步数`);
    const { starts, total } = M.beatStarts(seq);
    assert.equal(starts.length, seq.beats.length);
    assert.equal(starts[0], 0);
    const sum = seq.beats.reduce((a, b) => a + b.dur, 0);
    assert.ok(Math.abs(sum - total) < EPS, `场景 ${id} 总时长`);
    seq.beats.forEach((beat, i) => {
      assert.ok(beat.dur >= 0.8, `场景 ${id} 第 ${i + 1} 步过短`);
      assert.ok(beat.phase.length >= 2 && beat.phase.length <= 4, `阶段名 ${beat.phase}`);
      assert.ok(beat.caption.length <= 40, `场景 ${id} 第 ${i + 1} 步解说超过 40 字：${beat.caption}`);
      assert.ok(beat.group.length > 0);
    });
  });
});

test('源端判断：同网直接交付、异网交给默认网关', () => {
  const one = M.buildSequence(1);
  assert.equal(one.check.match, true);
  assert.equal(one.check.nextHopIp, '128.1.2.195');
  const oneEnd = M.frameOf(one, 0, 1).frame;
  assert.equal(oneEnd.dstMac, M.HOSTS.H1b.mac);
  assert.equal(oneEnd.ttl, 64);

  [2, 3].forEach((id) => {
    const seq = M.buildSequence(id);
    assert.equal(seq.check.match, false, `场景 ${id} 应跨网`);
    assert.equal(seq.check.nextHopIp, '128.1.2.193');
    const end = M.frameOf(seq, 0, 1).frame;
    assert.equal(end.dstMac, M.IFACES['R1-0'].mac, `场景 ${id} 首跳目的 MAC 应为网关`);
    assert.equal(end.seg, 1);
  });
});

test('判断台的 32 位相与结果与十进制网络号一致', () => {
  SCENARIO_IDS.forEach((id) => {
    const seq = M.buildSequence(id);
    const f = M.frameOf(seq, 0, 1);
    assert.equal(Number.parseInt(f.check.andBits.slice(0, 8), 2), Number(f.check.andNet.split('.')[0]));
    assert.equal(f.check.andBits.length, 32);
    assert.equal(f.check.destBits.length, 32);
    assert.equal(f.check.maskBits.length, 32);
    const expect = M.andIp(seq.dstIp, M.MASK);
    assert.equal(f.check.andNet, expect);
  });
});

test('路由表逐行相与只有一个匹配，且命中正确表项', () => {
  const r1a = M.lookupTable('R1', '128.1.2.132');
  assert.equal(r1a.matchedIdx, 1);
  assert.equal(r1a.row.prefix, '128.1.2.128/26');
  assert.equal(r1a.rows.filter((r) => r.match).length, 1);

  const r1b = M.lookupTable('R1', '128.1.3.66');
  assert.equal(r1b.matchedIdx, 2);
  assert.equal(r1b.row.prefix, '128.1.3.64/26');

  const r2 = M.lookupTable('R2', '128.1.3.66');
  assert.equal(r2.matchedIdx, 1);
  assert.equal(r2.row.prefix, '128.1.3.64/26');

  [r1a, r1b, r2].forEach((res) => {
    res.rows.forEach((row) => {
      assert.equal(row.andResult, M.andIp(res.dstIp, row.mask));
      assert.equal(row.match, row.andResult === row.net);
    });
  });
});

test('每次路由器查表后 TTL 减 1、帧头段数加 1，IP 地址全程不变', () => {
  const seq3 = M.buildSequence(3);
  const lookups = seq3.beats.filter((b) => b.kind === 'lookup');
  assert.equal(lookups.length, 2);
  assert.equal(lookups[0].ttlFrom, 64);
  assert.equal(lookups[0].ttlTo, 63);
  assert.equal(lookups[1].ttlFrom, 63);
  assert.equal(lookups[1].ttlTo, 62);
  assert.equal(lookups[0].segFrom, 1);
  assert.equal(lookups[0].segTo, 2);
  assert.equal(lookups[1].segFrom, 2);
  assert.equal(lookups[1].segTo, 3);

  const final = M.frameOf(seq3, seq3.beats.length - 1, 1).frame;
  assert.equal(final.ttl, 62);
  assert.equal(final.seg, 3);
  assert.equal(final.segTotal, 3);
  assert.equal(final.dstMac, M.HOSTS.H3.mac);
  assert.equal(final.srcMac, M.IFACES['R2-1'].mac);

  SCENARIO_IDS.forEach((id) => {
    const seq = M.buildSequence(id);
    seq.beats.forEach((beat, i) => {
      samples(6).forEach((p) => {
        const f = M.frameOf(seq, i, p);
        assert.equal(f.frame.ipSrc, seq.srcIp, `场景 ${id} 源 IP 被改写`);
        assert.equal(f.frame.ipDst, seq.dstIp, `场景 ${id} 目的 IP 被改写`);
        assert.equal(f.stats.ipFixed, true);
      });
    });
  });
});

test('相邻步边界连续：帧头字段与分组位置都不跳变', () => {
  const keys = ['ttl', 'srcMac', 'dstMac', 'ipSrc', 'ipDst', 'seg', 'segTotal', 'nextHopIp'];
  SCENARIO_IDS.forEach((id) => {
    const seq = M.buildSequence(id);
    for (let i = 0; i < seq.beats.length - 1; i++) {
      const end = M.frameOf(seq, i, 1);
      const start = M.frameOf(seq, i + 1, 0);
      keys.forEach((k) => {
        assert.equal(start.frame[k], end.frame[k], `场景 ${id} 第 ${i + 1}→${i + 2} 步 ${k} 跳变`);
      });
      assert.ok(
        Math.abs(start.packet.x - end.packet.x) < 1e-6 &&
          Math.abs(start.packet.y - end.packet.y) < 1e-6,
        `场景 ${id} 第 ${i + 1}→${i + 2} 步分组位置跳变`
      );
    }
  });
});

test('同一（步，进度）重复取样一致，且所有位置都是有限数', () => {
  SCENARIO_IDS.forEach((id) => {
    const seq = M.buildSequence(id);
    seq.beats.forEach((_, i) => {
      samples(12).forEach((p) => {
        const a = M.frameOf(seq, i, p);
        const b = M.frameOf(seq, i, p);
        assert.deepEqual(a, b);
        assert.ok(Number.isFinite(a.packet.x) && Number.isFinite(a.packet.y), `场景 ${id} 第 ${i + 1} 步位置 NaN`);
        a.tags.forEach((t) => {
          assert.ok(t.alpha >= 0 && t.alpha <= 1);
          assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
          assert.ok(t.text.length <= 12, `浮标过长：${t.text}`);
        });
        a.pulses.forEach((pulse) => {
          assert.ok(pulse.alpha >= 0 && pulse.alpha <= 1);
          assert.ok(Number.isFinite(pulse.x) && Number.isFinite(pulse.y) && Number.isFinite(pulse.r));
        });
        a.chevrons.forEach((ch) => {
          assert.ok(ch.alpha >= 0 && ch.alpha <= 1);
          assert.ok(Number.isFinite(ch.x) && Number.isFinite(ch.y) && Number.isFinite(ch.angle));
        });
        assert.ok(a.chevrons.length <= 3);
      });
    });
  });
});

test('locate 在步边界与总时长处返回正确的步', () => {
  SCENARIO_IDS.forEach((id) => {
    const seq = M.buildSequence(id);
    const { starts, total } = M.beatStarts(seq);
    starts.forEach((start, i) => {
      const loc = M.locate(seq, start + 0.001);
      assert.equal(loc.index, i, `场景 ${id} 第 ${i + 1} 步起点`);
      assert.ok(loc.p >= 0 && loc.p <= 1);
    });
    const end = M.locate(seq, total + 5);
    assert.equal(end.index, seq.beats.length - 1);
    assert.equal(end.p, 1);
    const zero = M.locate(seq, -5);
    assert.equal(zero.index, 0);
    assert.equal(zero.p, 0);
  });
});

test('查表台的行状态按扫描顺序推进，命中行最后锁定', () => {
  const seq = M.buildSequence(3);
  const i = seq.beats.findIndex((b) => b.kind === 'lookup' && b.router === 'R1');
  const early = M.frameOf(seq, i, 0.2);
  const late = M.frameOf(seq, i, 0.7);
  const done = M.frameOf(seq, i, 0.9);
  assert.ok(early.lookup.rows.some((r) => r.state === 'scan' || r.state === 'idle'));
  assert.ok(late.lookup.rows.some((r) => r.state === 'match'));
  assert.equal(done.lookup.resolved, true);
  assert.equal(done.lookup.rows[done.lookup.matchedIdx].state, 'match');
  assert.equal(done.frame.ttl, done.lookup.ttlTo);
  assert.equal(done.frame.seg, done.lookup.segTo);
});

test('srcNet 与掩码前缀按 /26 计算', () => {
  assert.equal(M.netOf('128.1.2.194', M.MASK), '128.1.2.192');
  assert.equal(M.netOf('128.1.2.132', M.MASK), '128.1.2.128');
  assert.equal(M.netOf('128.1.3.66', M.MASK), '128.1.3.64');
  assert.equal(M.ipBits('255.255.255.192').slice(0, 26), '1'.repeat(26));
  assert.equal(M.ipBits('255.255.255.192').slice(26), '0'.repeat(6));
});

test('视觉提示：移动步有方向箭头，查表与交付有脉冲', () => {
  const seq = M.buildSequence(2);
  const moveIndex = seq.beats.findIndex((b) => b.kind === 'move');
  const moving = M.frameOf(seq, moveIndex, 0.3);
  assert.ok(moving.chevrons.length >= 2, '移动方向应有箭头提示');
  assert.ok(moving.chevrons.every((c) => c.alpha > 0 && c.alpha <= 1));
  assert.ok(moving.chevrons.every((c) => c.x > 0 && c.y > 0));

  const lookupIndex = seq.beats.findIndex((b) => b.kind === 'lookup');
  const scanning = M.frameOf(seq, lookupIndex, 0.1);
  assert.ok(scanning.pulses.some((p) => p.tone === 'gold'), '查表应有金色脉冲');

  const finishIndex = seq.beats.length - 1;
  const finish = M.frameOf(seq, finishIndex, 0.5);
  assert.ok(finish.pulses.some((p) => p.tone === 'green'), '交付应有绿色脉冲');
});
