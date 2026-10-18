'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('./model.js');

const STATE_KEYS = ['base', 'next', 'expected', 'timerStart', 'timerBase', 'retransmissions', 'delivered'];
const EVENT_TYPES = new Set([
  'send', 'receive', 'discard', 'ack-send', 'ack', 'ack-ignore', 'drop', 'timeout', 'complete', 'blocked'
]);

function assertState(state, label) {
  assert.deepEqual(Object.keys(state).sort(), STATE_KEYS.slice().sort(), `${label}: state keys`);
  assert.ok(0 <= state.base && state.base <= state.next && state.next <= 8, `${label}: base/next`);
  assert.ok(state.next - state.base <= 4, `${label}: sender window`);
  assert.equal(new Set(state.delivered).size, state.delivered.length, `${label}: delivered unique`);
  assert.deepEqual(state.delivered, state.delivered.slice().sort((a, b) => a - b), `${label}: delivered ordered`);
  assert.deepEqual(state.delivered, Array.from({ length: state.expected }, (_, i) => i), `${label}: expected/delivered`);
  assert.ok(Number.isInteger(state.retransmissions) && state.retransmissions >= 0, `${label}: retransmissions`);
}

function assertTraceInvariants(trace) {
  assertState(trace.initial, `${trace.scenario} initial`);
  assertState(trace.final, `${trace.scenario} final`);
  let previousT = -Infinity;
  for (const event of trace.events) {
    assert.ok(EVENT_TYPES.has(event.type), `unexpected event type ${event.type}`);
    assert.ok(event.t >= previousT, 'events sorted by time');
    assert.ok(Math.abs(Math.round(event.t * 1e6) - event.t * 1e6) < 1e-7, 'event time rounded to 1e-6');
    previousT = event.t;
    assertState(event.before, `${trace.scenario} event ${event.id} before`);
    assertState(event.after, `${trace.scenario} event ${event.id} after`);
  }
  for (const packet of trace.packets) {
    assert.equal(packet.end, packet.start + 2, 'packet arrival remains start + 2');
    assert.ok(packet.dropTime === null || packet.dropTime >= packet.start && packet.dropTime < packet.end);
    assert.ok(packet.type === 'DATA' || packet.type === 'ACK');
  }
}

test('四个预设均正常完成，快照不变量成立且 duration 为 complete 后 0.8', () => {
  for (const scenario of ['normal', 'data_loss', 'ack_loss', 'duplicate']) {
    const trace = M.buildTrace({ scenario });
    assertTraceInvariants(trace);
    assert.equal(trace.final.base, 8, `${scenario} base`);
    assert.equal(trace.final.next, 8, `${scenario} next`);
    assert.equal(trace.final.expected, 8, `${scenario} expected`);
    assert.deepEqual(trace.final.delivered, [0, 1, 2, 3, 4, 5, 6, 7]);
    const complete = trace.events.find((event) => event.type === 'complete');
    assert.ok(complete);
    assert.ok(Math.abs(trace.duration - (complete.t + 0.8)) < 1e-9);
    assert.deepEqual(M.snapshotAt(trace, trace.duration), trace.final);
  }
});

test('正常预设首发在 t=0.7，t=0 仍是纯 initial；snapshot 深拷贝且同刻取最后事件', () => {
  const trace = M.buildTrace({ scenario: 'normal' });
  assert.deepEqual(trace.events[0].type, 'send');
  assert.equal(trace.events[0].t, 0.7);
  assert.deepEqual(M.snapshotAt(trace, 0), trace.initial);
  const atSameTime = trace.events.filter((event) => event.t === 2.7);
  assert.ok(atSameTime.length >= 2);
  assert.deepEqual(M.snapshotAt(trace, 2.7), atSameTime.at(-1).after);
  const snapshot = M.snapshotAt(trace, 2.7);
  snapshot.delivered.push(99);
  assert.ok(!M.snapshotAt(trace, 2.7).delivered.includes(99));
});

test('真实超时按 timerStart+7 触发，并重传超时刻的完整 [base,next) 范围', () => {
  const trace = M.buildTrace({ scenario: 'data_loss' });
  const timeout = trace.events.find((event) => event.type === 'timeout');
  assert.ok(timeout);
  assert.deepEqual(timeout.range, [timeout.before.base, timeout.before.next]);
  assert.equal(timeout.t, timeout.before.timerStart + 7);
  assert.equal(timeout.after.timerStart, timeout.t);
  const retransmissions = trace.events.filter((event) => event.type === 'send' && event.retransmit);
  assert.deepEqual(retransmissions.map((event) => event.seq),
    Array.from({ length: timeout.range[1] - timeout.range[0] }, (_, i) => timeout.range[0] + i));
  assert.ok(retransmissions.every((event) => event.packetId !== null));
  assert.ok(retransmissions.every((event) => trace.packets.find((p) => p.id === event.packetId).retransmit));
  assert.ok(trace.final.retransmissions > 0);
});

test('ACK-loss 丢弃首次 ACK0/ACK1；ACK2 从 base=0 累积推进到 3，且零重传', () => {
  const trace = M.buildTrace({ scenario: 'ack_loss' });
  const droppedAcks = trace.events.filter((event) => event.type === 'drop' && event.packetType === 'ACK');
  assert.deepEqual(droppedAcks.map((event) => event.seq), [0, 1]);
  for (const seq of [0, 1]) {
    const packet = trace.packets.find((p) => p.type === 'ACK' && p.seq === seq);
    assert.ok(packet);
    assert.equal(packet.dropTime, packet.start + 1);
  }
  const ack2 = trace.events.find((event) => event.type === 'ack' && event.seq === 2);
  assert.ok(ack2);
  assert.equal(ack2.before.base, 0);
  assert.equal(ack2.after.base, 3);
  assert.equal(trace.final.retransmissions, 0);
  assert.ok(!trace.events.some((event) => event.type === 'timeout'));
});

test('duplicate 预设正常交付 0、1 后注入 DATA1 副本，丢弃且旧 ACK 忽略，不改 next/交付', () => {
  const trace = M.buildTrace({ scenario: 'duplicate' });
  const injected = trace.events.find((event) => event.type === 'send' && event.duplicate);
  assert.ok(injected);
  assert.equal(injected.seq, 1);
  assert.equal(injected.before.next, 2);
  assert.equal(injected.after.next, 2);
  assert.deepEqual(injected.before.delivered, [0, 1]);
  assert.deepEqual(injected.after.delivered, [0, 1]);
  const packet = trace.packets.find((p) => p.id === injected.packetId);
  assert.equal(packet.duplicate, true);
  const discarded = trace.events.find((event) => event.type === 'discard' && event.packetId === packet.id);
  assert.ok(discarded);
  assert.deepEqual(discarded.before.delivered, discarded.after.delivered);
  const oldAck = trace.events.find((event) => event.type === 'ack-ignore' && event.seq === 1 && event.t > discarded.t);
  assert.ok(oldAck);
  assert.equal(oldAck.before.base, 2);
  assert.equal(oldAck.after.base, 2);
  assert.equal(trace.final.retransmissions, 0);
});

test('sandbox 窗口满时阻止第 5 帧；手动丢 DATA0 后 ACK∅ 不推进 base', () => {
  const actions = [
    { t: 0, type: 'send' },
    { t: 0.7, type: 'send' },
    { t: 1.4, type: 'send' },
    { t: 1.5, type: 'drop', packetId: 1 },
    { t: 2.1, type: 'send' },
    { t: 2.2, type: 'send' }
  ];
  const trace = M.buildTrace({ scenario: 'sandbox', actions, horizon: 5.5 });
  assertTraceInvariants(trace);
  assert.equal(trace.final.base, 0);
  assert.equal(trace.final.next, 4);
  assert.ok(trace.events.some((event) => event.type === 'blocked' && event.message.includes('发送窗口已满')));
  const userDrop = trace.events.find((event) => event.type === 'drop');
  assert.equal(userDrop.packetType, 'DATA');
  assert.equal(userDrop.t, 1.5);
  const ackPlaceholder = trace.events.find((event) => event.type === 'ack-send' && event.seq === -1);
  assert.ok(ackPlaceholder);
  const ignored = trace.events.find((event) => event.type === 'ack-ignore' && event.seq === -1);
  assert.ok(ignored);
  assert.equal(ignored.before.base, 0);
  assert.equal(ignored.after.base, 0);
  assert.ok(!trace.events.some((event) => event.type === 'ack' && event.seq < 0));
  assert.deepEqual(trace, M.buildTrace({ scenario: 'sandbox', actions, horizon: 5.5 }), 'action log replays deterministically');
});

test('arm toggle、重传 DATA 消费、ACK 消费均按时记录；预置未来 drop 可提前点击', () => {
  const dataTrace = M.buildTrace({
    scenario: 'sandbox', horizon: 9,
    actions: [
      { t: 0, type: 'send', drop: true },
      { t: 1, type: 'arm-data' }
    ]
  });
  assert.deepEqual(dataTrace.armChanges, [
    { t: 1, data: true, ack: false },
    { t: 7, data: false, ack: false }
  ]);
  const retransmittedData = dataTrace.packets.find((p) => p.type === 'DATA' && p.retransmit);
  assert.equal(retransmittedData.dropTime, 8);
  assert.ok(dataTrace.events.some((event) => event.type === 'drop' && event.packetType === 'DATA' && event.t === 8));

  const ackTrace = M.buildTrace({
    scenario: 'sandbox', horizon: 4,
    actions: [{ t: 0, type: 'send' }, { t: 1, type: 'arm-ack' }]
  });
  assert.deepEqual(ackTrace.armChanges, [
    { t: 1, data: false, ack: true },
    { t: 2, data: false, ack: false }
  ]);
  const ackPacket = ackTrace.packets.find((p) => p.type === 'ACK' && p.seq === 0);
  assert.equal(ackPacket.dropTime, 3);
  assert.ok(ackTrace.events.some((event) => event.type === 'drop' && event.packetId === ackPacket.id && event.packetType === 'ACK'));

  const earlyDrop = M.buildTrace({
    scenario: 'sandbox', horizon: 2,
    actions: [{ t: 0, type: 'send', drop: true }, { t: 0.5, type: 'drop', packetId: 1 }]
  });
  assert.equal(earlyDrop.packets[0].dropTime, 0.5);
  assert.deepEqual(earlyDrop.events.filter((event) => event.type === 'drop').map((event) => event.t), [0.5]);
});

test('同一时刻先处理报文到达再处理 sandbox action，事件顺序稳定', () => {
  const trace = M.buildTrace({
    scenario: 'sandbox', horizon: 2,
    actions: [{ t: 0, type: 'send' }, { t: 2, type: 'send' }]
  });
  const sameTime = trace.events.filter((event) => event.t === 2);
  assert.deepEqual(sameTime.map((event) => event.type), ['receive', 'ack-send', 'send']);
  assert.equal(M.snapshotAt(trace, 2).next, 2);
  assert.deepEqual(M.snapshotAt(trace, 2).delivered, [0]);
});

test('信道丢包不改变节点寄存器，重复 ACK 不重启仍在运行的单一定时器', () => {
  const trace = M.buildTrace({ scenario: 'data_loss' });
  for (const event of trace.events.filter(e => e.type === 'drop' || e.type === 'ack-ignore')) {
    assert.deepEqual(event.before, event.after);
  }
  assert.ok(trace.events.some(e => e.type === 'ack-ignore' && e.before.timerStart !== null));
});

test('连续两次超时仍能重传并恢复，不因上一轮重传而永久抑制后续超时', () => {
  const trace = M.buildTrace({
    scenario: 'sandbox', horizon: 20,
    actions: [{ t: 0, type: 'send', drop: true }, { t: 1, type: 'arm-data' }]
  });
  assertTraceInvariants(trace);
  assert.deepEqual(trace.events.filter(e => e.type === 'timeout').map(e => e.t), [7, 14]);
  assert.equal(trace.final.retransmissions, 2);
  assert.equal(trace.final.base, 1);
  assert.equal(trace.final.next, 1);
  assert.deepEqual(trace.final.delivered, [0]);
  assert.equal(trace.final.timerStart, null);
});

test('UMD 在浏览器 window 与 CommonJS 下均导出固定接口', () => {
  assert.deepEqual(Object.keys(M).sort(), ['buildTrace', 'snapshotAt']);
  const source = fs.readFileSync(path.join(__dirname, 'model.js'), 'utf8');
  const browserWindow = {};
  vm.runInNewContext(source, { window: browserWindow });
  assert.equal(typeof browserWindow.GBNModel.buildTrace, 'function');
  assert.equal(typeof browserWindow.GBNModel.snapshotAt, 'function');
  assert.equal(browserWindow.GBNModel.buildTrace({ scenario: 'normal' }).final.base, 8);
});
