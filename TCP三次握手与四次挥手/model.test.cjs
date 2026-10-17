'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('./model.js');

const handshake = Model.buildSequence('handshake');
const wave = Model.buildSequence('wave');

/* 独立的序号规则校验：按报文发出的顺序推进收发双方的下一序号与期望序号 */
function verifyNumbers(seq, expectedNext) {
  const snd = { c: seq.initial.c.seq, s: seq.initial.s.seq };
  const rcv = Object.assign({}, expectedNext);
  seq.messages.forEach(msg => {
    const from = msg.dir === 'c2s' ? 'c' : 's';
    const to = from === 'c' ? 's' : 'c';
    assert.equal(msg.seq, snd[from], `${msg.id} 的序号应等于发送方的下一序号`);
    if (msg.flags.ack) {
      assert.equal(msg.ack, rcv[from], `${msg.id} 的确认号应等于发送方期望收到的序号`);
    } else {
      assert.equal(msg.ack, null, `${msg.id} 未置 ACK 时不应携带确认号`);
    }
    const consumed = (msg.flags.syn ? 1 : 0) + (msg.flags.fin ? 1 : 0) + msg.len;
    snd[from] += consumed;
    if (consumed > 0) rcv[to] = msg.seq + consumed;
  });
  return snd;
}

test('三次握手：SYN 与 SYN+ACK 各占 1 个序号，第三个 ACK 不占序号', () => {
  const [h1, h2, h3] = handshake.messages;
  assert.deepEqual([h1.seq, h1.ack, h1.flags.syn], [100, null, 1]);
  assert.deepEqual([h2.seq, h2.ack, h2.flags.syn, h2.flags.ack], [300, 101, 1, 1]);
  assert.deepEqual([h3.seq, h3.ack, h3.flags.syn, h3.flags.ack], [101, 301, 0, 1]);
  verifyNumbers(handshake, { c: null, s: null });
});

test('四次挥手：逐报文核对序号与确认号（FIN 占 450，最终 ACK 确认 451）', () => {
  verifyNumbers(wave, { c: 400, s: 200 });
  const byId = {};
  wave.messages.forEach(msg => { byId[msg.id] = msg; });
  assert.equal(byId.w1.seq, 200);
  assert.equal(byId.w2.ack, 201);
  assert.equal(byId.w3.seq, 400);
  assert.equal(byId.w4.seq, 420);
  assert.equal(byId.w5.seq, 450, 'FIN 的序号是积压数据之后的第一个序号');
  assert.equal(byId.w5.ack, 201);
  assert.equal(byId.w6.seq, 201, '纯 ACK 不占序号');
  assert.equal(byId.w6.ack, 451, '最终 ACK 的确认号为 FIN 序号 + 1');
});

test('连接建立后所有报文 ACK 位为 1；只有首个 SYN 没有确认号', () => {
  handshake.messages.slice(1).forEach(msg => assert.equal(msg.flags.ack, 1, msg.id));
  wave.messages.forEach(msg => assert.equal(msg.flags.ack, 1, msg.id));
  assert.equal(handshake.messages[0].flags.ack, 0);
});

test('终态计数器：三次握手 c=101 s=301；四次挥手 c=201 s=451', () => {
  assert.deepEqual(Model.sample(handshake, handshake.duration).counters, { c: 101, s: 301 });
  assert.deepEqual(Model.sample(wave, wave.duration).counters, { c: 201, s: 451 });
});

test('服务端计数器随数据与 FIN 的发出推进：400 → 420 → 450 → 451', () => {
  assert.equal(Model.sample(wave, 1.2).counters.s, 400);
  assert.equal(Model.sample(wave, 1.5).counters.s, 420);
  assert.equal(Model.sample(wave, 2.2).counters.s, 450);
  assert.equal(Model.sample(wave, 2.5).counters.s, 451);
});

test('每条报文的飞行时间都是一个单程时延：斜线的纵向跨度一致', () => {
  [handshake, wave].forEach(seq => {
    seq.messages.forEach(msg => {
      assert.ok(Math.abs((msg.end - msg.start) - Model.FLIGHT) < 1e-9, `${seq.id} ${msg.id}`);
    });
  });
});

test('报文按发出时刻排列；总时长覆盖最后一拍', () => {
  [handshake, wave].forEach(seq => {
    seq.steps.forEach((step, i) => {
      if (i > 0) assert.ok(step.start >= seq.steps[i - 1].start, `${seq.id} ${step.id} 发出时刻倒序`);
    });
    const last = seq.steps[seq.steps.length - 1];
    assert.ok(seq.duration >= last.end, `${seq.id} 总时长小于最后一拍`);
  });
});

test('状态迁移符合 RFC 793 的流程，且按时间先后排列', () => {
  [['handshake', handshake], ['wave', wave]].forEach(([name, seq]) => {
    ['c', 's'].forEach(side => {
      const changes = seq.stateChanges[side];
      let prev = changes[0].state;
      for (let i = 1; i < changes.length; i += 1) {
        const next = changes[i].state;
        assert.ok(Model.STATE_FLOW[side][prev] && Model.STATE_FLOW[side][prev].includes(next),
          `${name} ${side}: ${prev} → ${next} 不是合法迁移`);
        assert.ok(changes[i].at >= changes[i - 1].at, `${name} ${side} 的状态变化时间倒序`);
        prev = next;
      }
    });
  });
  const wEnd = Model.sample(wave, wave.duration);
  assert.equal(wEnd.states.c.current, 'CLOSED');
  assert.equal(wEnd.states.s.current, 'CLOSED');
});

test('三次握手：客户端在发出 ACK 时进入 ESTABLISHED，服务端在 ACK 到达时进入 ESTABLISHED', () => {
  const at = t => Model.sample(handshake, t).states;
  assert.equal(at(0.5).c.current, 'SYN-SENT');
  assert.equal(at(0.5).s.current, 'LISTEN');
  assert.equal(at(1.0).s.current, 'SYN-RCVD');
  assert.equal(at(1.9).c.current, 'SYN-SENT');
  assert.equal(at(2.0).c.current, 'ESTABLISHED');
  assert.equal(at(2.9).s.current, 'SYN-RCVD');
  assert.equal(at(3.0).s.current, 'ESTABLISHED');
});

test('四次挥手：状态在报文到达的时刻改变，主动方在 TIME-WAIT 等待 2MSL', () => {
  const at = t => Model.sample(wave, t).states;
  assert.equal(at(0.9).s.current, 'ESTABLISHED');
  assert.equal(at(1.0).s.current, 'CLOSE-WAIT');
  assert.equal(at(1.9).c.current, 'FIN-WAIT-1');
  assert.equal(at(2.0).c.current, 'FIN-WAIT-2');
  assert.equal(at(2.5).s.current, 'LAST-ACK');
  assert.equal(at(3.4).c.current, 'FIN-WAIT-2');
  assert.equal(at(3.5).c.current, 'TIME-WAIT');
  assert.equal(at(4.4).s.current, 'LAST-ACK');
  assert.equal(at(4.5).s.current, 'CLOSED');
  assert.equal(at(5.9).c.current, 'TIME-WAIT');
  assert.equal(at(6.0).c.current, 'CLOSED');
});

test('积压管：50 字节随两个数据块在发出时离开，清空前不发 FIN', () => {
  assert.equal(Model.sample(wave, 0).buffer.remaining, 50);
  assert.equal(Model.sample(wave, 0).buffer.note, '残存 50 B');
  assert.equal(Model.sample(wave, 1.7).buffer.remaining, 30);
  const empty = Model.sample(wave, 2.2).buffer;
  assert.equal(empty.remaining, 0);
  assert.equal(empty.note, '积压已空，待发 FIN');
  assert.equal(Model.sample(wave, 2.6).buffer.note, '积压已空');
  assert.equal(Model.sample(handshake, 3.0).buffer, null);
});

test('2MSL 倒计时：客户端进入 TIME-WAIT（3.5 s）起，持续 MSL2_SECONDS，6.0 s 结束', () => {
  assert.equal(Model.sample(wave, 3.4).countdown.status, 'idle');
  const start = Model.sample(wave, 3.5).countdown;
  assert.equal(start.status, 'running');
  assert.ok(Math.abs(start.seconds - Model.MSL2_SECONDS) < 1e-9);
  assert.ok(Math.abs(Model.sample(wave, 5.0).countdown.seconds - 1.0) < 1e-9);
  assert.equal(Model.sample(wave, 6.0).countdown.status, 'done');
  assert.equal(wave.countdown.end - wave.countdown.start, Model.MSL2_SECONDS);
  assert.equal(Model.sample(handshake, 3.0).countdown, null);
});

test('报文飞行进度线性推进；瞬时模式下整拍直接完成', () => {
  const h1 = handshake.messages[0];
  const mid = h1.start + Model.FLIGHT / 2;
  assert.ok(Math.abs(Model.sample(handshake, mid).messages.h1.progress - 0.5) < 1e-9);
  assert.equal(Model.sample(handshake, h1.start).messages.h1.progress, 0);
  assert.equal(Model.sample(handshake, mid, { instant: true }).messages.h1.progress, 1);
  const h2 = handshake.messages[1];
  assert.equal(Model.sample(handshake, h2.start - 0.01, { instant: true }).messages.h2.progress, 0);
});

test('里程碑（三次握手）：3.0 s 连接建立时闪光、扩散与光晕依次出现，徽章常驻', () => {
  const at = t => Model.sample(handshake, t).milestone;
  assert.equal(handshake.milestone.at, handshake.steps[2].end, '连接建立发生在最后一个 ACK 到达时');
  assert.ok(handshake.duration >= handshake.milestone.at + 1.6, '里程碑效果应在序列结束前播完');
  assert.equal(at(2.9).visible, false);
  assert.equal(at(3.0).visible, true);
  assert.equal(at(3.0).pop, 0);
  assert.ok(Math.abs(at(3.0 + 0.45).pop - 1) < 1e-9);
  assert.equal(at(4.8).pop, 1, '徽章在握手结束后保持显示');
  assert.equal(at(3.0).flashMessage, 'h3');
  assert.ok(at(3.2).flash > 0 && at(3.2).flash < 1, '闪光随时间衰减');
  assert.ok(at(3.2).ring > 0 && at(3.2).ring < 1, '扩散环进行中');
  assert.ok(at(3.2).halo > 0, '生命线光晕随连接建立出现');
  assert.equal(at(4.7).flash, 0);
  assert.equal(at(4.7).ring, null);
  assert.equal(at(4.7).halo, 0);
});

test('里程碑（四次挥手）：6.0 s 释放时只弹出徽章，不做闪光与光晕；减少动效时不做补间', () => {
  assert.equal(wave.milestone.at, wave.countdown.end, '连接释放发生在 2MSL 结束时');
  const rel = Model.sample(wave, 6.0).milestone;
  assert.equal(rel.tone, 'released');
  assert.equal(rel.visible, true);
  assert.equal(rel.flash, 0);
  assert.equal(rel.halo, 0);
  assert.equal(rel.ring, null);
  assert.equal(Model.sample(wave, 5.9).milestone.visible, false);
  const instant = Model.sample(handshake, 3.2, { instant: true }).milestone;
  assert.equal(instant.pop, 1);
  assert.equal(instant.flash, 0);
  assert.equal(instant.ring, null);
  assert.equal(instant.halo, 0);
});

test('阶段与拍号随时刻变化；收尾拍位于 2MSL 结束时', () => {
  assert.equal(Model.sample(wave, 0).phase.name, '请求关闭');
  assert.equal(Model.sample(handshake, 1.5).phase.name, '同步应答');
  assert.equal(Model.sample(wave, 1.7).phase.name, '补发残存');
  assert.equal(Model.sample(wave, 2.6).phase.name, '服务端 FIN');
  assert.equal(Model.sample(wave, 3.6).phase.name, '最终确认');
  const end = Model.sample(wave, 6.0);
  assert.equal(end.stepIndex, wave.steps.length);
  assert.equal(end.current.tag, '收尾');
});

test('同一时刻的结果与采样顺序无关（无历史依赖）', () => {
  const direct = Model.sample(wave, 2.7);
  Model.sample(wave, 6.5);
  Model.sample(wave, 0.2);
  assert.deepEqual(Model.sample(wave, 2.7), direct);
});

test('停靠点：下一步与上一步落在报文的发出时刻上', () => {
  assert.deepEqual(wave.stops, [0, 1, 1.5, 2, 2.5, 3.5, 6, 7]);
  assert.equal(Model.neighbor(wave.stops, 0, 1), 1);
  assert.equal(Model.neighbor(wave.stops, 1, 1), 1.5);
  assert.equal(Model.neighbor(wave.stops, 2.2, -1), 2);
  assert.equal(Model.neighbor(wave.stops, 0, -1), 0);
  assert.equal(Model.neighbor(wave.stops, wave.duration, 1), wave.duration);
  assert.ok(wave.frames.length > wave.stops.length, '减少动效的停靠点应包含每拍的到达时刻');
});

test('非法模式直接报错', () => {
  assert.throws(() => Model.buildSequence('unknown'), /未知的演示模式/);
});
