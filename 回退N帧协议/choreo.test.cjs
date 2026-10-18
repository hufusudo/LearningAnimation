const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('./model.js');
const Choreo = require('./choreo.js');

for (const scenario of ['normal', 'data_loss', 'ack_loss', 'duplicate']) {
  test(`${scenario}: 视觉数值在每个事件与过渡终点连续`, () => {
    const trace = Model.buildTrace({ scenario });
    for (const e of trace.events) {
      for (const t of [e.t, e.t + Choreo.TRANSITION]) {
        const left = Choreo.sample(trace, Math.max(0, t - 1e-7));
        const right = Choreo.sample(trace, t + 1e-7);
        for (const key of ['base', 'next', 'expected', 'retransmissions']) {
          assert.ok(Math.abs(left.counters[key].value - right.counters[key].value) < 1e-4, `${key} @ ${t}`);
        }
      }
    }
    const end = Choreo.sample(trace, trace.duration);
    for (const key of ['base', 'next', 'expected']) assert.equal(end.counters[key].value, 8);
    assert.equal(end.timer.running, false);
    assert.equal(end.phase, '传输完成');
  });
}

test('纯时刻采样：倒退再定位与直接定位一致', () => {
  const trace = Model.buildTrace({ scenario: 'data_loss' });
  const expected = Choreo.sample(trace, 5.25);
  Choreo.sample(trace, trace.duration);
  Choreo.sample(trace, 0);
  assert.deepEqual(Choreo.sample(trace, 5.25), expected);
});

test('减少动效直接呈现当前快照，不遗漏状态', () => {
  const trace = Model.buildTrace({ scenario: 'ack_loss' });
  for (const e of trace.events) {
    const v = Choreo.sample(trace, e.t, true);
    assert.deepEqual(v.state, Model.snapshotAt(trace, e.t));
    for (const key of ['base', 'next', 'expected']) assert.equal(v.counters[key].value, v.state[key]);
    assert.equal(v.focus, 0);
  }
});

test('数据向右、ACK向左；丢包冻结位置后淡出，不继续到达', () => {
  const trace = Model.buildTrace({ scenario: 'data_loss' });
  for (const packet of trace.packets) {
    const stop = packet.dropTime ?? packet.end;
    const a = Choreo.sample(trace, packet.start + 0.1).packets.find(p => p.id === packet.id);
    const b = Choreo.sample(trace, stop - 0.1).packets.find(p => p.id === packet.id);
    assert.ok(packet.type === 'DATA' ? b.x > a.x : b.x < a.x);
    if (packet.dropTime !== null) {
      const dropped = Choreo.sample(trace, stop + 0.1).packets.find(p => p.id === packet.id);
      const fading = Choreo.sample(trace, stop + 0.3).packets.find(p => p.id === packet.id);
      assert.equal(dropped.x, fading.x);
      assert.equal(dropped.lost, true);
      assert.ok(dropped.alpha > fading.alpha);
      assert.equal(Choreo.sample(trace, stop + 0.5).packets.some(p => p.id === packet.id), false);
    }
  }
});

test('重传和重复副本的解说不声称 next 前移', () => {
  for (const scenario of ['data_loss', 'duplicate']) {
    const trace = Model.buildTrace({ scenario });
    const e = trace.events.find(e => e.type === 'send' && (e.retransmit || e.duplicate));
    assert.ok(e);
    assert.doesNotMatch(Choreo.sample(trace, e.t + 0.05).message, /next 前移/);
  }
});

test('ACK∅ 与终点均作为教学占位，不冒充本轮的序号8', () => {
  assert.equal(Choreo.ackLabel(-1), 'ACK∅');
  assert.equal(Choreo.ackLabel(7), 'ACK 7');
  const trace = Model.buildTrace({ scenario: 'sandbox', actions: [{ t: 0, type: 'send', drop: true }, { t: 0.7, type: 'send' }] });
  assert.ok(trace.packets.some(p => p.type === 'ACK' && p.seq === -1));
});
