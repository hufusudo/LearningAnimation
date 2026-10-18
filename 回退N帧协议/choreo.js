(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.GBNChoreo = factory(root.GBNModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Model) {
  'use strict';
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const smooth = q => q * q * (3 - 2 * q);
  const cache = new WeakMap();
  const TRANSITION = 0.42;
  const keys = ['base', 'next', 'expected', 'retransmissions'];
  function at(track, t) {
    let segment = track[0];
    for (const item of track) { if (item.t > t) break; segment = item; }
    const q = smooth(clamp((t - segment.t) / TRANSITION));
    return { value: segment.from + (segment.to - segment.from) * q, from: segment.from, to: segment.to, q };
  }
  function prepare(trace) {
    if (cache.has(trace)) return cache.get(trace);
    const tracks = {};
    for (const key of keys) {
      const track = [{ t: -1, from: trace.initial[key], to: trace.initial[key] }];
      for (const event of trace.events) {
        if (event.before[key] !== event.after[key]) {
          track.push({ t: event.t, from: at(track, event.t).value, to: event.after[key] });
        }
      }
      tracks[key] = track;
    }
    cache.set(trace, tracks);
    return tracks;
  }
  const names = {
    send: '连续发送', receive: '按序交付', discard: '接收丢弃', 'ack-send': '回复确认',
    ack: '累积确认', 'ack-ignore': '忽略旧确认', drop: '信道丢失', timeout: '超时回退',
    complete: '传输完成', blocked: '窗口已满'
  };
  function meaningful(trace, t) {
    let result = null;
    const priority = { complete: 10, timeout: 9, drop: 8, discard: 7, ack: 6, 'ack-ignore': 5, receive: 4, send: 3, blocked: 2, 'ack-send': 1 };
    for (const event of trace.events) {
      if (event.t > t) break;
      if (!result || event.t > result.t || priority[event.type] >= priority[result.type]) result = event;
    }
    return result;
  }
  function ackLabel(seq) { return seq < 0 ? 'ACK∅' : 'ACK ' + seq; }
  function eventMessage(e) {
    if (!e) return '窗口内可连续发送，不必逐帧等待确认。';
    const n = e.seq;
    switch (e.type) {
      case 'send': return e.retransmit ? `重传帧 ${n}；它仍在未确认区间，next 不回退。` : e.duplicate ? `帧 ${n} 的迟到副本在途中，两端窗口保持原位。` : `发出帧 ${n}；next 前移，base 等待确认。`;
      case 'receive': return `帧 ${n} 正好等于 expected，交付后回复 ${ackLabel(n)}。`;
      case 'discard': return `帧 ${n} 并非当前期望；丢弃并重发 ${ackLabel(e.after.expected - 1)}。`;
      case 'ack': return `${ackLabel(n)} 确认至帧 ${n}，base 从 ${e.before.base} 滑至 ${e.after.base}。`;
      case 'ack-ignore': return `${ackLabel(n)} 是旧确认，不移动窗口，也不重启定时器。`;
      case 'drop': return `${e.packetType === 'ACK' ? ackLabel(n) : '帧 ' + n} 在途中丢失；发送方不能直接感知。`;
      case 'timeout': return `base 的定时器超时，重传帧 ${e.range ? e.range[0] + '–' + (e.range[1] - 1) : e.after.base + ' 起'}，next 不回退。`;
      case 'complete': return '8 帧全部按序交付并确认，单一定时器停止。';
      case 'blocked': return e.message || '发送窗口已满，必须等待确认释放空位。';
      default: return `接收方回复 ${ackLabel(n)}。`;
    }
  }
  function sample(trace, time, reduced = false) {
    const t = clamp(Number(time) || 0, 0, trace.duration);
    const state = Model.snapshotAt(trace, t);
    const tracks = prepare(trace);
    const counters = {};
    for (const key of keys) {
      counters[key] = reduced ? { value: state[key], from: state[key], to: state[key], q: 1 } : at(tracks[key], t);
    }
    const latest = meaningful(trace, t);
    const event = latest ? { ...latest } : null;
    if (event && event.type === 'drop') event.packetType = trace.packets.find(p => p.id === event.packetId)?.type || 'DATA';
    const age = event ? t - event.t : Infinity;
    const tagAlpha = reduced ? (age < 0.9 ? 1 : 0) : clamp(age / 0.14) * clamp((1.05 - age) / 0.25);
    const packets = trace.packets.filter(p => t >= p.start && t < (p.dropTime ?? p.end) + 0.4).map(p => {
      const stop = p.dropTime ?? p.end;
      const progress = clamp((Math.min(t, stop) - p.start) / (p.end - p.start));
      const ack = p.type === 'ACK';
      return { ...p, x: ack ? 948 - 798 * progress : 150 + 798 * progress, y: ack ? 352 : 282,
        alpha: reduced ? (t < stop ? 1 : 0) : clamp((t - p.start) / 0.12) * clamp((stop + 0.4 - t) / 0.4),
        lost: p.dropTime !== null && p.dropTime !== undefined && t >= p.dropTime,
        active: t < stop, label: ack ? ackLabel(p.seq) : '帧 ' + p.seq };
    });
    const elapsed = state.timerStart === null ? 0 : clamp(t - state.timerStart, 0, 7);
    const focusAge = event ? t - event.t : Infinity;
    const focus = reduced ? 0 : clamp(focusAge / 0.1) * clamp((0.62 - focusAge) / 0.22) * 0.65;
    return { t, state, counters, packets, event, phase: event ? event.type === 'send' && event.retransmit ? '回退重传' : event.type === 'send' && event.duplicate ? '迟到副本' : names[event.type] : '就绪',
      message: eventMessage(event), tagAlpha, focus,
      timer: { running: state.timerStart !== null, remaining: 7 - elapsed, fraction: 1 - elapsed / 7 } };
  }
  return { sample, prepare, ackLabel, TRANSITION };
});
