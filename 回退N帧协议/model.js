(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GBNModel = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const TOTAL = 8;
  const WINDOW = 4;
  const TRANSIT = 2;
  const TIMEOUT = 7;
  const INTERVAL = 0.7;
  const EPSILON = 1e-9;
  const MAX_STEPS = 100000;
  const SCENARIOS = new Set(['normal', 'data_loss', 'ack_loss', 'duplicate', 'sandbox']);

  const roundTime = (t) => Math.round((t + Number.EPSILON) * 1e6) / 1e6;
  const cloneState = (s) => ({
    base: s.base,
    next: s.next,
    expected: s.expected,
    timerStart: s.timerStart,
    timerBase: s.timerBase,
    retransmissions: s.retransmissions,
    delivered: s.delivered.slice()
  });
  const freshState = () => ({
    base: 0,
    next: 0,
    expected: 0,
    timerStart: null,
    timerBase: null,
    retransmissions: 0,
    delivered: []
  });

  function buildTrace({ scenario = 'normal', actions = [], horizon = 45 } = {}) {
    if (!SCENARIOS.has(scenario)) throw new RangeError(`未知场景：${scenario}`);
    const isSandbox = scenario === 'sandbox';
    const limit = Number.isFinite(Number(horizon)) ? Math.max(0, roundTime(Number(horizon))) : 45;
    const initial = freshState();
    const state = freshState();
    const events = [];
    const packets = [];
    const armChanges = [];
    const tasks = [];
    let taskOrder = 0;
    let eventOrder = 0;
    let packetId = 0;
    let completed = false;
    let now = 0;
    let timerGeneration = 0;
    let autoGeneration = 0;
    let autoPendingTime = null;
    let autoEnabled = !isSandbox;
    let autoLimit = TOTAL;
    let lastNewSend = null;
    let dropNextData = false;
    let dropNextAck = false;
    const presetAckDrops = { 0: false, 1: false };
    let duplicateAckId = null;
    let duplicateInjected = false;

    function enqueue(t, kind, data, priority) {
      const at = roundTime(t);
      if (!Number.isFinite(at)) return;
      tasks.push({ t: at, kind, data: data || {}, priority, order: taskOrder++ });
    }

    function recordArmChange() {
      armChanges.push({ t: roundTime(now), data: dropNextData, ack: dropNextAck });
    }

    function emit(type, seq, id, message, mutate, extra) {
      const before = cloneState(state);
      if (mutate) mutate();
      const event = Object.assign({
        id: eventOrder + 1,
        t: roundTime(now),
        type,
        seq: seq === undefined ? null : seq,
        packetId: id === undefined ? null : id,
        before,
        after: cloneState(state),
        message: String(message || '')
      }, extra || {});
      events.push({ order: eventOrder++, event });
      return event;
    }

    function scheduleTimer() {
      if (state.timerStart === null || state.base >= state.next) return;
      timerGeneration += 1;
      enqueue(state.timerStart + TIMEOUT, 'timeout', {
        generation: timerGeneration,
        start: state.timerStart,
        base: state.timerBase
      }, 1);
    }

    function scheduleAutoSend(when) {
      if (!autoEnabled || state.next >= autoLimit || state.next - state.base >= WINDOW) return;
      const target = roundTime(Math.max(when, lastNewSend === null ? when : lastNewSend + INTERVAL));
      if (autoPendingTime !== null && autoPendingTime <= target + EPSILON) return;
      autoPendingTime = target;
      autoGeneration += 1;
      enqueue(target, 'auto-send', { generation: autoGeneration }, 2);
    }

    function createPacket(type, seq, start, opts) {
      const options = opts || {};
      const id = ++packetId;
      const at = roundTime(start);
      const end = roundTime(at + TRANSIT);
      const plannedDrop = options.drop ? roundTime(at + TRANSIT / 2) : null;
      const packet = {
        id,
        type,
        seq,
        start: at,
        end,
        dropTime: plannedDrop,
        retransmit: Boolean(options.retransmit),
        duplicate: Boolean(options.duplicate)
      };
      packets.push(packet);
      if (plannedDrop !== null) enqueue(plannedDrop, 'packet-drop', { packet }, 0);
      enqueue(end, 'packet-arrive', { packet }, 0);
      return packet;
    }

    function sendData(seq, { retransmit = false, forcedDrop = false, duplicate = false, injected = false } = {}) {
      const consumeArmedDrop = !duplicate && dropNextData;
      if (consumeArmedDrop) {
        dropNextData = false;
        recordArmChange();
      }
      const packet = createPacket('DATA', seq, now, {
        retransmit,
        duplicate,
        drop: forcedDrop || consumeArmedDrop
      });
      if (retransmit) {
        emit('send', seq, packet.id, `超时重传 DATA${seq}`, () => { state.retransmissions += 1; }, {
          retransmit: packet.retransmit, duplicate: packet.duplicate
        });
      } else if (duplicate) {
        emit('send', seq, packet.id, `注入迟到的 DATA${seq} 副本`, null, {
          retransmit: packet.retransmit, duplicate: packet.duplicate
        });
      } else {
        emit('send', seq, packet.id, `发送 DATA${seq}`, () => {
          state.next += 1;
          if (state.timerStart === null) {
            state.timerStart = now;
            state.timerBase = state.base;
          }
        }, { retransmit: packet.retransmit, duplicate: packet.duplicate });
        lastNewSend = now;
        if (state.timerStart === now && state.timerBase === state.base) scheduleTimer();
      }
      if (injected && duplicate) duplicateInjected = true;
      return packet;
    }

    function sendAck(seq, fromDuplicate) {
      let presetDrop = false;
      if (scenario === 'ack_loss' && (seq === 0 || seq === 1) && !presetAckDrops[seq]) {
        presetAckDrops[seq] = true;
        presetDrop = true;
      }
      const consumeArmedDrop = dropNextAck;
      if (consumeArmedDrop) {
        dropNextAck = false;
        recordArmChange();
      }
      const packet = createPacket('ACK', seq, now, { drop: presetDrop || consumeArmedDrop });
      if (fromDuplicate) duplicateAckId = packet.id;
      const label = seq < 0 ? 'ACK∅' : `ACK${seq}`;
      emit('ack-send', seq, packet.id,
        `${label} 已发送${presetDrop || consumeArmedDrop ? '（信道中丢失）' : ''}`,
        null);
      return packet;
    }

    function handleData(packet) {
      const seq = packet.seq;
      const inOrder = seq === state.expected && seq >= 0 && seq < TOTAL;
      if (inOrder) {
        emit('receive', seq, packet.id, `按序接收 DATA${seq} 并交付`, () => {
          state.expected += 1;
          state.delivered.push(seq);
        });
      } else {
        const reason = seq < state.expected ? '重复' : '失序';
        emit('discard', seq, packet.id, `接收端丢弃${reason} DATA${seq}，不缓存`, null);
      }
      sendAck(state.expected - 1, packet.duplicate);
    }

    function finishIfComplete() {
      if (completed || state.base !== TOTAL) return;
      completed = true;
      emit('complete', null, null, '全部 8 帧均已累计确认', null);
    }

    function handleAck(packet) {
      const seq = packet.seq;
      if (state.base <= seq && seq < state.next) {
        emit('ack', seq, packet.id, `ACK${seq} 累积确认，base 前进到 ${seq + 1}`, () => {
          state.base = seq + 1;
          if (state.base < state.next) {
            state.timerStart = now;
            state.timerBase = state.base;
          } else {
            state.timerStart = null;
            state.timerBase = null;
          }
        });
        if (state.timerStart !== null) scheduleTimer();
        finishIfComplete();
        if (!completed) scheduleAutoSend(now);
      } else {
        const label = seq < 0 ? 'ACK∅' : `ACK${seq}`;
        emit('ack-ignore', seq, packet.id, `旧的/无效 ${label} 不改变发送窗口或定时器`, null);
        if (scenario === 'duplicate' && packet.id === duplicateAckId && duplicateInjected) {
          autoLimit = TOTAL;
          scheduleAutoSend(now);
        }
      }
    }

    function handleTimeout(task) {
      if (task.generation !== timerGeneration || state.timerStart === null ||
          Math.abs(state.timerStart - task.start) > EPSILON || state.timerBase !== task.base ||
          state.base !== task.base || state.base >= state.next) return;
      const start = state.base;
      const end = state.next;
      emit('timeout', null, null, `base=${start} 定时器超时，重传 [${start},${end})`, () => {
        state.timerStart = now;
        state.timerBase = state.base;
      }, { range: [start, end] });
      scheduleTimer();
      for (let seq = start; seq < end; seq += 1) {
        enqueue(now + (seq - start) * INTERVAL, 'retransmit', { seq }, 2);
      }
    }

    function processAction(action) {
      const type = action.type;
      if (type === 'send') {
        if (state.next >= TOTAL || state.next - state.base >= WINDOW) {
          emit('blocked', null, null, state.next >= TOTAL ? '8 帧均已发送，无法再发送' : '发送窗口已满，本次发送被阻止', null);
          return;
        }
        const seq = state.next;
        const packet = sendData(seq, { forcedDrop: Boolean(action.drop) });
        if (action.drop) packet.dropTime = roundTime(packet.start + TRANSIT / 2);
        return;
      }
      if (type === 'arm-data' || type === 'arm-ack') {
        const isData = type === 'arm-data';
        const armed = isData ? !dropNextData : !dropNextAck;
        if (isData) dropNextData = armed;
        else dropNextAck = armed;
        recordArmChange();
        return;
      }
      if (type === 'drop') {
        const id = Number(action.packetId);
        const packet = packets.find((p) => p.id === id);
        if (!packet || (packet.dropTime !== null && packet.dropTime <= now) || !(packet.start <= now && now < packet.end)) {
          emit('blocked', null, Number.isFinite(id) ? id : null, '该报文不在可丢弃的在途区间内', null);
          return;
        }
        packet.dropTime = roundTime(now);
        emit('drop', packet.seq, packet.id, `用户在信道中丢弃 ${packet.type}${packet.seq < 0 ? '∅' : packet.seq}`, null,
          { packetType: packet.type });
      }
    }

    function processTask(task) {
      now = task.t;
      switch (task.kind) {
        case 'packet-drop': {
          const packet = task.data.packet;
          if (packet.dropTime === task.t) {
            emit('drop', packet.seq, packet.id,
              `${packet.type}${packet.seq < 0 ? '∅' : packet.seq} 在信道中丢失`, null,
              { packetType: packet.type });
          }
          break;
        }
        case 'packet-arrive': {
          const packet = task.data.packet;
          if (packet.dropTime !== null) break;
          if (packet.type === 'DATA') handleData(packet);
          else handleAck(packet);
          break;
        }
        case 'timeout':
          handleTimeout(task.data);
          break;
        case 'auto-send':
          if (task.data.generation !== autoGeneration) break;
          autoPendingTime = null;
          if (!autoEnabled || state.next >= autoLimit || state.next - state.base >= WINDOW) break;
          sendData(state.next, { forcedDrop: scenario === 'data_loss' && state.next === 1 });
          scheduleAutoSend(now + INTERVAL);
          break;
        case 'retransmit':
          if (!completed && task.data.seq >= state.base && task.data.seq < state.next) {
            sendData(task.data.seq, { retransmit: true });
          }
          break;
        case 'inject-duplicate': {
          if (state.next === 2 && state.expected >= 2) sendData(1, { duplicate: true, injected: true });
          break;
        }
        case 'action':
          processAction(task.data.action);
          break;
      }
    }

    if (!isSandbox) {
      if (scenario === 'duplicate') autoLimit = 2;
      scheduleAutoSend(0.7);
      if (scenario === 'duplicate') enqueue(5.7, 'inject-duplicate', {}, 2);
    } else if (Array.isArray(actions)) {
      actions.forEach((action, index) => {
        if (!action || !Number.isFinite(Number(action.t)) || Number(action.t) < 0) return;
        const t = roundTime(Number(action.t));
        if (t <= limit) enqueue(t, 'action', { action, index }, 3);
      });
    }

    let steps = 0;
    while (tasks.length && steps < MAX_STEPS && (isSandbox || !completed)) {
      let best = 0;
      for (let i = 1; i < tasks.length; i += 1) {
        const a = tasks[i];
        const b = tasks[best];
        if (a.t < b.t || (a.t === b.t && (a.priority < b.priority ||
            (a.priority === b.priority && a.order < b.order)))) best = i;
      }
      const [task] = tasks.splice(best, 1);
      if (isSandbox && task.t > limit) break;
      processTask(task);
      steps += 1;
    }

    const orderedEvents = events
      .sort((a, b) => a.event.t - b.event.t || a.order - b.order)
      .map((item) => item.event);
    const orderedPackets = packets.slice().sort((a, b) => a.start - b.start || a.id - b.id);
    const duration = isSandbox
      ? limit
      : roundTime(((orderedEvents.find((event) => event.type === 'complete') || { t: now }).t) + 0.8);
    return {
      scenario,
      duration,
      events: orderedEvents,
      packets: orderedPackets,
      initial: cloneState(initial),
      final: cloneState(state),
      armChanges: armChanges.map((change) => ({ ...change }))
    };
  }

  function snapshotAt(trace, t) {
    if (!trace || !trace.initial || !Array.isArray(trace.events)) throw new TypeError('snapshotAt 需要有效的 trace');
    const at = Number.isFinite(Number(t)) ? Number(t) : 0;
    let result = trace.initial;
    for (const event of trace.events) {
      if (event.t <= at) result = event.after;
      else break;
    }
    return cloneState(result);
  }

  return Object.freeze({ buildTrace, snapshotAt });
});
