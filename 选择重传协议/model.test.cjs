const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('./model.js');

const SCEN = model.SCENARIOS.map((s) => s.id);
const runOf = (id) => model.buildRun({ scenario: id });
const finalState = (run) => run.steps[run.steps.length - 1].after;
const deliveredList = (st) => st.delivered.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

test('六个场景都能推演到终态，步骤与时刻结构合法', () => {
  assert.deepEqual(SCEN, ['normal', 'loss1', 'loss2', 'error', 'ackloss', 'sandbox']);
  for (const id of SCEN) {
    const run = runOf(id);
    assert.ok(run.steps.length >= 2, `${id} 至少有起始与收尾两步`);
    assert.equal(run.steps[0].t, 0, `${id} 第一步从 0 开始`);
    assert.ok(run.duration > 0, `${id} 时长为正`);
    assert.ok(run.duration <= 400, `${id} 时长不超过硬上限`);
    for (let i = 0; i < run.steps.length; i++) {
      const s = run.steps[i];
      assert.ok(s.dur > 0, `${id} 第 ${i} 步时长为正`);
      if (i > 0) assert.ok(s.t > run.steps[i - 1].t, `${id} 时刻严格递增`);
      assert.notEqual(s.before, s.after, `${id} 第 ${i} 步前后状态是不同对象`);
    }
    assert.equal(finalState(run).counts.acked, id === 'sandbox' ? 0 : model.FRAMES);
    assert.equal(finalState(run).counts.delivered, id === 'sandbox' ? 0 : model.FRAMES);
  }
});

test('黄金定理：Wt + Wr 不超过序号空间，且默认恰好取等', () => {
  assert.equal(model.DEFAULTS.wt + model.DEFAULTS.wr, Math.pow(2, model.DEFAULTS.nbits));
  const tight = model.buildRun({ scenario: 'normal', wt: 8, wr: 8 });
  assert.ok(tight.params.wt + tight.params.wr <= Math.pow(2, tight.params.nbits));
});

test('正常场景：无需任何重传，两端窗口都滑到末尾', () => {
  const run = runOf('normal');
  const st = finalState(run);
  assert.equal(st.counts.retx, 0);
  assert.equal(st.counts.lost, 0);
  assert.equal(st.base, model.FRAMES);
  assert.equal(st.next, model.FRAMES);
  assert.equal(st.rcvBase, model.FRAMES);
  assert.equal(deliveredList(st).length, model.FRAMES);
});

test('不变量：base 与 rcv_base 单调不减且不越界，确认与交付不可撤销', () => {
  for (const id of SCEN) {
    const run = runOf(id);
    let base = -1, rcv = -1;
    const acked = new Array(model.FRAMES).fill(false);
    const delivered = new Array(model.FRAMES).fill(false);
    for (const s of run.steps) {
      assert.ok(s.after.base >= s.before.base, `${id} base 单调`);
      assert.ok(s.after.rcvBase >= s.before.rcvBase, `${id} rcv_base 单调`);
      assert.ok(s.after.base <= model.FRAMES && s.after.next <= model.FRAMES, `${id} 发送方不越界`);
      assert.ok(s.after.rcvBase <= model.FRAMES, `${id} 接收方不越界`);
      assert.ok(s.after.next >= s.after.base, `${id} next 不早于 base`);
      base = s.after.base; rcv = s.after.rcvBase;
      void base; void rcv;
      for (let i = 0; i < model.FRAMES; i++) {
        assert.ok(!acked[i] || s.after.acked[i], `${id} 已确认的帧不再变回未确认`);
        assert.ok(!delivered[i] || s.after.delivered[i], `${id} 已交付的帧不再变回未交付`);
        acked[i] = s.after.acked[i];
        delivered[i] = s.after.delivered[i];
      }
    }
  }
});

test('单帧丢失：只重发缺口那一帧，其余帧先缓存后批量交付', () => {
  const run = runOf('loss1');
  const drops = run.packets.filter((p) => p.lost);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].seq, 1);
  assert.equal(drops[0].dir, 'DATA');

  const timeouts = run.steps.filter((s) => s.kind === 'timeout');
  assert.equal(timeouts.length, 1, '只发生一次超时');
  assert.equal(timeouts[0].ev.seq, 1, '超时的是帧 1');
  const retx = run.packets.filter((p) => p.retx);
  assert.equal(retx.length, 1, '只重传一帧');
  assert.equal(retx[0].seq, 1);

  // 超时之前，帧 2、3 已经被接收方缓存，rcv_base 停在 1
  const beforeTimeout = run.steps.filter((s) => s.t < timeouts[0].t).pop();
  assert.equal(beforeTimeout.after.rcvBase, 1);
  assert.ok(beforeTimeout.after.buffered[2] && beforeTimeout.after.buffered[3], '帧 2、3 已进入乱序缓存');
  assert.equal(beforeTimeout.after.delivered[2], false);

  // 重传帧 1 到达后一次性交付 1、2、3（以及已缓存的 4）
  const fill = run.steps.find((s) => s.kind === 'rx-data' && s.ev.seq === 1 && s.ev.outcome === 'deliver');
  assert.ok(fill);
  assert.equal(fill.ev.delivered[0], 1);
  assert.ok(fill.ev.delivered.length > 1, '填洞后批量交付');
  assert.ok(fill.after.rcvBase > fill.before.rcvBase + 1, '接收窗口跨步滑动');
});

test('双帧不连续丢失：两个定时器各管各的，rcv_base 分两级推进', () => {
  const run = runOf('loss2');
  const lostSeqs = run.packets.filter((p) => p.lost).map((p) => p.seq).sort((a, b) => a - b);
  assert.deepEqual(lostSeqs, [0, 2]);
  const timeouts = run.steps.filter((s) => s.kind === 'timeout');
  assert.deepEqual(timeouts.map((s) => s.ev.seq), [0, 2], '按序号顺序各自超时');
  assert.equal(run.steps.filter((s) => s.kind === 'rx-nak').length, 0);

  const advances = [];
  let prev = 0;
  for (const s of run.steps) {
    if (s.after.rcvBase > prev) { advances.push([prev, s.after.rcvBase]); prev = s.after.rcvBase; }
  }
  assert.deepEqual(advances[0], [0, 2], '帧 0 补上后连同缓存的帧 1 一起交付');
  assert.deepEqual(advances[1], [2, 4], '第二个缺口补上后才继续推进');
  assert.deepEqual(advances[advances.length - 1], [7, 8]);
  assert.ok(advances.length >= 6, '其余帧按序交付');
});

test('帧出错：接收方丢弃并回 NAK，发送方不等超时立即补发', () => {
  const run = runOf('error');
  const naks = run.steps.filter((s) => s.kind === 'rx-nak');
  assert.equal(naks.length, 1);
  assert.equal(naks[0].ev.seq, 1);
  assert.equal(run.steps.filter((s) => s.kind === 'timeout').length, 0, '没有等到超时');

  const corrupt = run.packets.find((p) => p.corrupt);
  assert.ok(corrupt && corrupt.seq === 1 && corrupt.dir === 'DATA');
  const retx = run.packets.find((p) => p.retx);
  assert.ok(retx && retx.seq === 1 && !retx.corrupt, '补发的是干净帧');
  const originalTimeout = run.timers.find((iv) => iv.seq === 1 && !iv.retx);
  assert.ok(retx.t0 < originalTimeout.start + model.DEFAULTS.timeout, '重发早于该帧的超时时刻');
  assert.equal(finalState(run).counts.retx, 1);
});

test('ACK 丢失：重复帧不重复交付，接收方补发 ACK 让发送方继续', () => {
  const run = runOf('ackloss');
  const lostAck = run.packets.filter((p) => p.lost);
  assert.equal(lostAck.length, 1);
  assert.equal(lostAck[0].dir, 'ACK');
  assert.equal(lostAck[0].seq, 1);
  assert.equal(run.steps.filter((s) => s.kind === 'timeout').length, 1, '发送方只能靠超时发现');

  const dup = run.steps.find((s) => s.kind === 'rx-data' && s.ev.outcome === 'duplicate');
  assert.ok(dup, '接收方认出重复帧');
  const dupAck = run.packets.filter((p) => p.dir === 'ACK' && p.seq === 1);
  assert.ok(dupAck.length >= 2, '补发了 ACK 1');
  assert.equal(dupAck.filter((p) => p.lost).length, 1, '只有第一个 ACK 丢失');

  // 每个序号最多交付一次
  const seen = new Set();
  for (const s of run.steps) {
    if (s.kind !== 'rx-data') continue;
    for (const seq of s.ev.delivered) {
      assert.ok(!seen.has(seq), `帧 ${seq} 被重复交付`);
      seen.add(seq);
    }
  }
  assert.equal(seen.size, model.FRAMES);
});

test('每帧独立定时器：只有未确认的帧才有区间，ACK 到达即关闭', () => {
  for (const id of ['normal', 'loss1', 'loss2', 'error', 'ackloss']) {
    const run = runOf(id);
    for (const iv of run.timers) {
      assert.ok(iv.end >= iv.start, `${id} 定时器区间有效`);
      const ackStep = run.steps.find((s) => s.kind === 'rx-ack' && s.ev.seq === iv.seq && !s.ev.dup);
      if (ackStep && iv.end < iv.start + model.DEFAULTS.timeout - 1e-6) {
        assert.ok(Math.abs(ackStep.t - iv.end) < 1e-6, `${id} 帧 ${iv.seq} 的定时器在 ACK 到达时关闭`);
      }
    }
  }
});

test('状态链：上一步的后态等于下一步的前态', () => {
  for (const id of SCEN) {
    const run = runOf(id);
    for (let i = 1; i < run.steps.length; i++) {
      assert.deepEqual(run.steps[i - 1].after, run.steps[i].before, `${id} 第 ${i} 步状态衔接`);
    }
  }
});

test('sample / stateAt / boundaries 只依赖时刻，边界与越界都正确', () => {
  for (const id of SCEN) {
    const run = runOf(id);
    const b = model.boundaries(run);
    assert.equal(b.length, run.steps.length);
    for (let i = 1; i < b.length; i++) assert.ok(b[i] > b[i - 1], `${id} 边界递增`);

    for (const t of [0, run.duration, run.duration + 99, ...b]) {
      const s = model.sample(run, t);
      assert.ok(s.index >= 0 && s.index < run.steps.length);
      assert.ok(s.p >= 0 && s.p <= 1);
      assert.deepEqual(model.stateAt(run, t), s.step.after, `${id} stateAt 与 sample 一致`);
    }
    const mid = model.sample(run, run.duration / 2);
    const step = run.steps[mid.index];
    assert.ok(Math.abs(mid.p - (run.duration / 2 - step.t) / step.dur) < 1e-9);
    assert.equal(model.sample(run, -5).index, 0);
    assert.equal(model.sample(run, run.duration + 5).p, 1);
  }
});

test('同一输入两次推演结果完全一致', () => {
  for (const id of SCEN) {
    assert.deepEqual(runOf(id), runOf(id), `${id} 推演确定`);
  }
});

test('沙盒：空演练不发帧且可浏览时钟，动作可重放并截断未来分支', () => {
  const empty = model.buildRun({ scenario: 'sandbox', instructions: [] });
  assert.ok(empty.duration >= 8, '空窗口也允许拖动进度');
  assert.equal(empty.packets.length, 0);
  assert.equal(empty.steps[0].kind, 'start');

  const one = model.buildRun({ scenario: 'sandbox', instructions: [{ type: 'send', at: 0 }] });
  assert.equal(one.packets.filter((p) => p.dir === 'DATA').length, 1);
  assert.ok(one.steps.some((s) => s.kind === 'rx-ack' && s.ev.seq === 0), '单发一帧也会被确认');
  assert.deepEqual(runOf('sandbox').instructions, []);
  assert.deepEqual(
    model.buildRun({ scenario: 'sandbox', instructions: [{ type: 'send', at: 0 }] }),
    model.buildRun({ scenario: 'sandbox', instructions: [{ type: 'send', at: 0 }] }),
    '同一动作列表重放结果一致'
  );

  const armed = model.buildRun({
    scenario: 'sandbox',
    instructions: [{ type: 'armData', at: 0 }, { type: 'send', at: 0 }]
  });
  assert.ok(armed.packets.some((p) => p.lost), '预设丢包生效');
  assert.ok(armed.steps.some((s) => s.kind === 'timeout'), '丢掉的帧靠超时补回');
  assert.equal(armed.steps.filter((s) => s.kind === 'drop').length, 1, 'armData 只作用一次');

  const list = model.applyInstructions([], 5, { type: 'send', at: 5 });
  const trimmed = model.applyInstructions(list, 2, { type: 'armData', at: 2 });
  assert.deepEqual(list, [{ type: 'send', at: 5 }], '不修改入参');
  assert.deepEqual(trimmed, [{ type: 'armData', at: 2 }], '截断 now 之后的历史分支');
});
