const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('./model.js');

const windowsOf = (sc) => sc.rounds.map((R) => R.window);

test('谢希仁习题 5-38：门限 8、窗口到 12 超时，逐轮窗口与教材答案一致', () => {
  const sc = model.buildScenario({ initialSsthresh: 8, events: [{ round: 8, kind: 'timeout' }], horizon: 15 });
  assert.deepEqual(windowsOf(sc).slice(0, 15), [1, 2, 4, 8, 9, 10, 11, 12, 1, 2, 4, 6, 7, 8, 9]);
});

test('谢希仁习题 5-39：门限 32，第 16 轮快重传，第 22 轮超时，前 26 轮窗口与门限一致', () => {
  const sc = model.buildScenario({
    initialSsthresh: 32,
    events: [{ round: 16, kind: 'fast' }, { round: 22, kind: 'timeout' }],
    horizon: 26
  });
  assert.deepEqual(windowsOf(sc).slice(0, 26), [
    1, 2, 4, 8, 16, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42,
    21, 22, 23, 24, 25, 26,
    1, 2, 4, 8
  ]);
  assert.equal(sc.rounds[16].ssthreshBefore, 21, '快重传后第 17 轮门限为 21');
  assert.equal(sc.rounds[22].ssthreshBefore, 13, '超时后第 23 轮门限为 13');
});

test('默认剧本：超时后的慢开始与快重传后的拥塞避免串联正确', () => {
  const sc = model.buildScenario({});
  assert.equal(sc.horizon, model.DEFAULT_HORIZON);
  assert.deepEqual(windowsOf(sc), [
    1, 2, 4, 8, 9, 10, 11, 12, 1, 2, 4, 6, 7, 8, 9, 10,
    5, 6, 7, 8, 9, 10, 11, 12
  ]);
  assert.equal(sc.rounds[7].kind, 'timeout');
  assert.equal(sc.rounds[15].kind, 'fast');
});

test('超时只丢尾包：没有对应的 ACK，也不产生重复 ACK', () => {
  const sc = model.buildScenario({ initialSsthresh: 8, events: [{ round: 8, kind: 'timeout' }], horizon: 9 });
  const R = sc.rounds[7];
  assert.equal(R.kind, 'timeout');
  const lost = R.packets.filter((p) => p.lost).map((p) => p.index);
  assert.deepEqual(lost, [R.window]);
  assert.equal(R.acks.length, R.window - 1);
  assert.equal(R.acks.filter((ack) => ack.dup).length, 0);
  assert.equal(R.fast, null);
});

test('个别丢包：第 2 包丢失，第 3 个重复 ACK 触发快重传，恢复在本轮内完成', () => {
  const sc = model.buildScenario({});
  const R = sc.rounds[15];
  assert.equal(R.kind, 'fast');
  assert.deepEqual(R.packets.filter((p) => p.lost).map((p) => p.index), [2]);
  const dups = R.acks.filter((ack) => ack.dup);
  assert.equal(dups.length, R.window - 2);
  assert.equal(R.fast.triggerAt, dups[2].arrive, '第 3 个重复 ACK 触发');
  assert.ok(R.fast.recoveryAt < R.length, '恢复 ACK 必须在本轮结束前到达');
  assert.equal(R.nextWindow, Math.floor(R.window / 2));
  assert.equal(R.nextPhase, 'congestionAvoidance', '快恢复之后直接拥塞避免');
});

test('窗口少于 5 时无法凑齐 3 个重复 ACK：快重传自动降级为超时并说明原因', () => {
  const sc = model.buildScenario({ initialSsthresh: 8, events: [{ round: 3, kind: 'fast' }], horizon: 6 });
  const R = sc.rounds[2];
  assert.equal(R.window, 4);
  assert.equal(R.kind, 'timeout');
  assert.equal(R.downgraded, true);
  assert.match(model.frameAt(sc, R.start + 0.1).narration, /凑不齐 3 个重复 ACK/);
});

test('慢开始到门限后转拥塞避免：窗口不会越过门限', () => {
  const sc = model.buildScenario({ initialSsthresh: 8, events: [], horizon: 12 });
  const first = sc.rounds[2];
  assert.equal(first.window, 4);
  assert.equal(first.nextWindow, 8, '4 → 8 恰好到门限');
  assert.equal(first.nextPhase, 'congestionAvoidance');
  assert.equal(sc.rounds[3].window, 8);
  assert.equal(sc.rounds[4].window, 9, '之后每轮只加 1');
});

test('不变量：任意预约组合下，轮次连续、门限有下限、超时窗口回到 1', () => {
  for (let initial = 2; initial <= 20; initial += 3) {
    for (let a = 1; a <= 14; a += 3) {
      for (let b = 2; b <= 20; b += 5) {
        const events = [{ round: a, kind: 'timeout' }, { round: b, kind: 'fast' }];
        const sc = model.buildScenario({ initialSsthresh: initial, events });
        let expectedStart = 0;
        sc.rounds.forEach((R) => {
          assert.equal(R.start, expectedStart, `第 ${R.index} 轮起点连续`);
          expectedStart += R.length;
          assert.ok(R.window >= 1 && R.ssthreshBefore >= 2);
          assert.ok(R.ssthreshAfter >= 2 || R.kind === 'normal');
          if (R.kind === 'timeout') assert.equal(R.nextWindow, 1);
          if (R.kind === 'fast') {
            assert.ok(R.window >= model.FAST_MIN_WINDOW);
            assert.equal(R.nextWindow, R.ssthreshAfter);
          }
        });
        assert.equal(sc.duration, expectedStart, '总时长等于各轮之和');
      }
    }
  }
});

test('帧的几何与计数始终合法：报文与 ACK 位置在信道之内，已确认不超过窗口', () => {
  const sc = model.buildScenario({});
  for (let pos = 0; pos <= sc.duration; pos += 0.02) {
    const f = model.frameAt(sc, pos);
    f.packets.forEach((packet) => assert.ok(packet.x >= -1e-9 && packet.x <= 1 + 1e-9, `报文位置 ${pos}`));
    f.acks.forEach((ack) => assert.ok(ack.x >= -1e-9 && ack.x <= 1 + 1e-9, `ACK 位置 ${pos}`));
    assert.ok(f.acked >= 0 && f.acked <= f.window, `已确认数 ${pos}`);
    assert.ok(f.dupCount >= 0 && f.dupCount <= 3);
    assert.ok(f.steps === null || (f.steps.index >= 0 && f.steps.index < f.steps.labels.length));
    assert.ok([...f.narration].length <= 40, `解说不超过 40 字：${f.narration}`);
  }
});

test('超时的时刻：门限取半、窗口回到 1，下一轮以重传开始', () => {
  const sc = model.buildScenario({ initialSsthresh: 8, events: [{ round: 8, kind: 'timeout' }], horizon: 10 });
  const R = sc.rounds[7];
  const late = model.frameAt(sc, R.start + model.EXPIRY + model.COLLAPSE + 0.01);
  assert.equal(late.ssthresh, 6);
  assert.equal(late.cwnd, 1);
  assert.equal(late.banner.tone, 'alert');
  const next = model.frameAt(sc, sc.rounds[8].start + 0.01);
  assert.equal(next.retransmission, true);
  assert.equal(next.cwnd, 1);
  assert.equal(next.label, '慢开始');
});

test('预约事件不改变此前的推演：同一时刻的画面保持一致', () => {
  const base = model.buildScenario({});
  const edited = model.buildScenario({ events: [...model.DEFAULT_EVENTS, { round: 20, kind: 'fast' }] });
  for (let pos = 0; pos < base.rounds[18].start; pos += 0.07) {
    const a = model.frameAt(base, pos);
    const b = model.frameAt(edited, pos);
    assert.equal(a.round, b.round);
    assert.equal(a.cwnd, b.cwnd);
    assert.equal(a.ssthresh, b.ssthresh);
    assert.equal(a.narration, b.narration);
  }
});

test('下一次事件的落点：未开始的轮次取当前轮，轮内取下一轮，末尾返回 null', () => {
  const sc = model.buildScenario({});
  assert.equal(model.nextEventRound(sc, 0), 1);
  assert.equal(model.nextEventRound(sc, sc.rounds[4].start), 5);
  assert.equal(model.nextEventRound(sc, sc.rounds[4].start + 0.5), 6);
  assert.equal(model.nextEventRound(sc, sc.duration), null);
});

test('关键时刻按时间递增，包含每一轮的起点', () => {
  const sc = model.buildScenario({});
  const times = model.keyTimes(sc);
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] > times[i - 1]);
  sc.rounds.forEach((R) => assert.ok(times.includes(R.start)));
});

test('超时计时器：在归零时刻进度为 1，剩余秒数为 0', () => {
  const sc = model.buildScenario({ initialSsthresh: 8, events: [{ round: 8, kind: 'timeout' }], horizon: 10 });
  const R = sc.rounds[7];
  const f = model.frameAt(sc, R.start + model.EXPIRY);
  assert.equal(f.timer.progress, 1);
  assert.equal(f.timer.seconds, 0);
  assert.equal(f.timer.expired, true);
});

test('格子状态：快重传时第 2 格先丢失、后重传，恢复 ACK 到达后全部确认；超时时尾格丢失', () => {
  const sc = model.buildScenario({});
  const fast = sc.rounds[15];
  const beforeRetrans = model.frameAt(sc, fast.start + fast.fast.triggerAt - 0.01);
  assert.equal(beforeRetrans.cellStates[1], 'lost');
  const retrans = model.frameAt(sc, fast.start + fast.fast.triggerAt + 0.01);
  assert.equal(retrans.cellStates[1], 'retrans');
  const recovered = model.frameAt(sc, fast.start + fast.fast.recoveryAt + 0.01);
  assert.ok(recovered.cellStates.every((state) => state === 'acked'));

  const timeout = sc.rounds[7];
  const tail = model.frameAt(sc, timeout.start + 1.0);
  assert.equal(tail.cellStates[tail.window - 1], 'lost');
  assert.equal(tail.cellStates[0], 'acked');
});
