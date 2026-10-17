/**
 * TCP 拥塞控制推演模型（教材口径，纯计算，不碰 DOM）。
 * 时间单位是“轮次”（约等于一个 RTT）。每轮内部用局部时刻描述报文与 ACK 的先后。
 * frameAt(sc, pos) 只依赖 pos：拖动、倒退与重绘都能精确复现，不依赖历史动画。
 */
(function (root) {
  'use strict';

  const FWD = 0.3;             // 报文单程：发送端到接收端
  const BACK = 0.26;           // ACK 单程：接收端到发送端
  const ACK_DELAY = 0.02;      // 接收端生成 ACK 的停顿
  const SEND_START = 0.04;     // 第一个报文离开发送端的局部时刻
  const SEND_SPAN = 0.16;      // 整个窗口离开发送端所占的时长
  const LOSS_POINT = 0.55;     // 丢失报文停在信道中的位置（0 到 1）
  const LOSS_MARK = LOSS_POINT * FWD;
  const EXPIRY = 1.4;          // 超时轮中计时器归零的局部时刻
  const COLLAPSE = 0.12;       // 窗口收缩或折半的动画时长
  const LENGTH = { normal: 1, fast: 1.45, timeout: 1.6 };
  const FAST_MIN_WINDOW = 5;   // 第 2 包丢失后，后面至少 3 个报文才能凑出 3 个重复 ACK
  const DEFAULT_SSTHRESH = 8;  // 谢希仁习题 5-38 的初始门限
  const DEFAULT_HORIZON = 24;
  const DEFAULT_EVENTS = [
    { round: 8, kind: 'timeout' },  // 窗口到 12 时超时（习题 5-38）
    { round: 16, kind: 'fast' }     // 窗口为 10 时个别丢包，快重传
  ];
  const SEC_PER_UNIT = 2.4;    // 1 倍速下一个轮次单位约 2.4 秒
  const PHASE_SS = 'slowStart';
  const PHASE_CA = 'congestionAvoidance';
  const PHASE_LABEL = { slowStart: '慢开始', congestionAvoidance: '拥塞避免' };
  const TIMEOUT_STEPS = ['尾包丢失', '等待计时器', '门限减半', 'cwnd = 1 重传', '重新慢开始'];
  const FAST_STEPS = ['第 2 包丢失', '3 次重复 ACK', '立即快重传', '快恢复', '拥塞避免'];

  const clamp01 = (value) => Math.min(1, Math.max(0, value));

  function normalizeEvents(events) {
    const byRound = new Map();
    (events || []).forEach((event) => {
      const round = Math.trunc(Number(event && event.round));
      if (!Number.isFinite(round) || round < 1 || round > 60) return;
      if (event.kind !== 'timeout' && event.kind !== 'fast') return;
      byRound.set(round, event.kind);
    });
    return [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([round, kind]) => ({ round, kind }));
  }

  function buildRound(spec) {
    const { index, start, window: W, phase, ssthresh, requested, retransmission, afterLoss } = spec;
    const downgraded = requested === 'fast' && W < FAST_MIN_WINDOW;
    const kind = requested === 'timeout' || downgraded ? 'timeout' : requested === 'fast' ? 'fast' : 'normal';
    const lostIndex = kind === 'timeout' ? W : kind === 'fast' ? 2 : 0;

    const packets = [];
    for (let i = 1; i <= W; i += 1) {
      const depart = SEND_START + (SEND_SPAN * (i - 1)) / W;
      const lost = i === lostIndex;
      packets.push({ index: i, depart, lost, arrive: lost ? null : depart + FWD });
    }

    const acks = [];
    packets.forEach((packet) => {
      if (packet.lost) return;
      const dup = kind === 'fast' && packet.index > lostIndex;
      acks.push({
        ackNo: dup ? lostIndex : packet.index + 1,
        dup,
        recovery: false,
        packet: packet.index,
        depart: packet.arrive + ACK_DELAY,
        arrive: packet.arrive + ACK_DELAY + BACK
      });
    });

    let fast = null;
    if (kind === 'fast') {
      const dups = acks.filter((ack) => ack.dup);
      const triggerAt = dups[2].arrive;                 // 第 3 个重复 ACK 到达
      const retransArrive = triggerAt + FWD;            // 立即补发第 2 包
      const recoveryAt = retransArrive + ACK_DELAY + BACK;  // 累计 ACK 跳到 W + 1
      fast = {
        dupAt: dups.map((ack) => ack.arrive),
        triggerAt,
        retransDepart: triggerAt,
        retransArrive,
        recoveryAt
      };
      acks.push({ ackNo: W + 1, dup: false, recovery: true, packet: 0, depart: retransArrive + ACK_DELAY, arrive: recoveryAt });
    }

    let ssthreshAfter = ssthresh;
    let nextWindow;
    let nextPhase;
    let growth;
    if (kind === 'timeout') {
      ssthreshAfter = Math.max(2, Math.floor(W / 2));
      nextWindow = 1;
      nextPhase = PHASE_SS;
      growth = { mode: 'collapse', ghosts: 0, reachesThreshold: false };
    } else if (kind === 'fast') {
      ssthreshAfter = Math.max(2, Math.floor(W / 2));
      nextWindow = ssthreshAfter;
      nextPhase = PHASE_CA;
      growth = { mode: 'halve', ghosts: 0, reachesThreshold: false };
    } else if (phase === PHASE_SS) {
      nextWindow = Math.min(2 * W, ssthresh);
      nextPhase = nextWindow >= ssthresh ? PHASE_CA : PHASE_SS;
      growth = { mode: 'exp', ghosts: nextWindow - W, reachesThreshold: nextWindow >= ssthresh };
    } else {
      nextWindow = W + 1;
      nextPhase = PHASE_CA;
      growth = { mode: 'linear', ghosts: 0, reachesThreshold: false };
    }

    const lossPacket = lostIndex ? packets[lostIndex - 1] : null;
    const lossMark = lossPacket ? lossPacket.depart + LOSS_MARK : null;
    const eventAt = kind === 'timeout' ? EXPIRY : kind === 'fast' ? fast.triggerAt : null;
    const length = LENGTH[kind];
    const timer = kind === 'timeout' ? { start: packets[W - 1].depart, end: EXPIRY } : null;

    const tags = [];
    if (kind === 'normal' && acks.length) {
      const first = acks[0].arrive;
      tags.push({ text: phase === PHASE_SS ? '每ACK +1' : '每ACK +1/W', tone: 'note', at: 'window', from: first, to: length });
      if (growth.reachesThreshold) {
        tags.push({ text: '达到门限', tone: 'note', at: 'window', from: acks[growth.ghosts - 1].arrive, to: length });
      }
    }
    if (kind === 'timeout') {
      tags.push({ text: '尾包丢失', tone: 'alert', at: 'channel', from: lossMark, to: EXPIRY });
      tags.push({ text: '超时！', tone: 'alert', at: 'sender', from: EXPIRY, to: length });
      tags.push({ text: `门限 ${ssthreshAfter}`, tone: 'note', at: 'window', from: EXPIRY, to: length });
    }
    if (kind === 'fast') {
      tags.push({ text: '第 2 包丢失', tone: 'alert', at: 'channel', from: lossMark, to: fast.recoveryAt });
      tags.push({ text: '3 个重复 ACK', tone: 'alert', at: 'channel', from: fast.triggerAt, to: fast.triggerAt + 0.5 });
      tags.push({ text: '立即快重传', tone: 'alert', at: 'sender', from: fast.triggerAt, to: fast.recoveryAt });
      tags.push({ text: '窗口减半', tone: 'note', at: 'window', from: fast.triggerAt, to: length });
    }

    return {
      index,
      start,
      length,
      kind,
      downgraded,
      retransmission,
      afterLoss,
      window: W,
      phase,
      ssthreshBefore: ssthresh,
      ssthreshAfter,
      nextWindow,
      nextPhase,
      growth,
      packets,
      acks,
      fast,
      timer,
      lossMark,
      eventAt,
      tags
    };
  }

  /** 按预约的事件推演 horizon 轮；事件之前的推演与事件无关。 */
  function buildScenario(options) {
    const opts = options || {};
    const initialSsthresh = Number.isFinite(opts.initialSsthresh)
      ? Math.max(2, Math.floor(opts.initialSsthresh))
      : DEFAULT_SSTHRESH;
    const events = normalizeEvents(opts.events || DEFAULT_EVENTS);
    const maxRound = events.reduce((max, event) => Math.max(max, event.round), 0);
    const horizon = Math.max(Math.trunc(opts.horizon) || DEFAULT_HORIZON, maxRound + 6);
    const byRound = new Map(events.map((event) => [event.round, event.kind]));

    const rounds = [];
    let window = 1;
    let ssthresh = initialSsthresh;
    let phase = PHASE_SS;
    let start = 0;
    let retransmission = false;
    let afterLoss = false;
    for (let index = 1; index <= horizon; index += 1) {
      const round = buildRound({
        index,
        start,
        window,
        phase,
        ssthresh,
        requested: byRound.get(index) || null,
        retransmission,
        afterLoss
      });
      rounds.push(round);
      start += round.length;
      window = round.nextWindow;
      ssthresh = round.ssthreshAfter;
      phase = round.nextPhase;
      retransmission = round.kind === 'timeout';
      afterLoss = round.kind !== 'normal';
    }
    return { horizon, duration: start, initialSsthresh, events, rounds };
  }

  /** 二分查找：pos 落在第几轮（下标从 0 开始）。 */
  function locateIndex(rounds, pos) {
    let lo = 0;
    let hi = rounds.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rounds[mid].start <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function lossSummary(R) {
    return {
      kind: R.kind,
      before: R.window,
      ssthreshBefore: R.ssthreshBefore,
      ssthreshAfter: R.ssthreshAfter,
      cwndAfter: R.nextWindow,
      formula: `ssthresh = max(2, ⌊${R.window} / 2⌋) = ${R.ssthreshAfter}`
    };
  }

  function narrationFor(R, t) {
    if (R.downgraded) return `窗口只有 ${R.window} 个报文，凑不齐 3 个重复 ACK，只能超时。`;
    if (R.kind === 'timeout') {
      if (t < R.lossMark) return R.retransmission
        ? '重传丢失的报文，窗口为 1，慢开始重新增长。'
        : `发出 ${R.window} 个报文，尾包在信道中丢失。`;
      if (t < EXPIRY) return '尾包之后没有报文，凑不出重复 ACK，只能等计时器。';
      return `超时：门限 = ⌊${R.window} / 2⌋ = ${R.ssthreshAfter}，窗口回到 1 MSS。`;
    }
    if (R.kind === 'fast') {
      if (t < R.fast.triggerAt) return '第 2 包丢失，后面的报文陆续返回重复 ACK。';
      if (t < R.fast.recoveryAt) return '第 3 个重复 ACK：立即快重传第 2 包，不等计时器。';
      return `缺口补齐，门限 = 窗口 = ⌊${R.window} / 2⌋，转入拥塞避免。`;
    }
    if (R.retransmission) return '重传丢失的报文，窗口为 1，慢开始从头增长。';
    const firstAck = R.acks.length ? R.acks[0].depart : R.length;
    if (t < firstAck) {
      return R.phase === PHASE_SS
        ? `慢开始：发出 ${R.window} 个报文，等待 ACK。`
        : `拥塞避免：发出 ${R.window} 个报文，等待 ACK。`;
    }
    if (R.phase === PHASE_SS) {
      return R.growth.reachesThreshold
        ? '每个 ACK 使窗口 +1，窗口达到门限，下一轮改为拥塞避免。'
        : '每个 ACK 使窗口 +1，一轮之后窗口翻倍。';
    }
    return `${R.window} 个 ACK 各贡献 1/${R.window}，合计 +1 MSS。`;
  }

  /** 第 pos 个时刻的完整画面：只由 pos 与推演结果决定。 */
  function frameAt(sc, pos) {
    const p = Math.min(sc.duration, Math.max(0, Number(pos) || 0));
    const R = sc.rounds[locateIndex(sc.rounds, p)];
    const prev = R.index > 1 ? sc.rounds[R.index - 2] : null;
    const t = Math.min(R.length, Math.max(0, p - R.start));
    const W = R.window;

    const packets = [];
    R.packets.forEach((packet) => {
      if (t < packet.depart) return;
      if (packet.lost) {
        const lostNow = t >= packet.depart + LOSS_MARK;
        packets.push({
          index: packet.index,
          state: lostNow ? 'lost' : 'flight',
          x: lostNow ? LOSS_POINT : (t - packet.depart) / FWD,
          retrans: R.retransmission
        });
        return;
      }
      if (t < packet.arrive) {
        packets.push({ index: packet.index, state: 'flight', x: (t - packet.depart) / FWD, retrans: R.retransmission });
      }
    });
    if (R.fast && t >= R.fast.retransDepart && t < R.fast.retransArrive) {
      packets.push({ index: 2, state: 'flight', x: (t - R.fast.retransDepart) / FWD, retrans: true });
    }

    const acks = [];
    const ackedBy = new Set();
    let arrivedNew = 0;
    let dupCount = 0;
    let recovered = false;
    R.acks.forEach((ack) => {
      if (t >= ack.arrive) {
        if (ack.recovery) recovered = true;
        else {
          if (ack.dup) dupCount += 1;
          else arrivedNew += 1;
          ackedBy.add(ack.packet);
        }
        return;
      }
      if (t >= ack.depart) {
        acks.push({ ackNo: ack.ackNo, dup: ack.dup, recovery: ack.recovery, x: 1 - (t - ack.depart) / BACK });
      }
    });

    const acked = R.kind === 'fast' && recovered ? W : Math.min(arrivedNew, W);
    const cellStates = R.packets.map((packet) => {
      if (recovered) return 'acked';
      if (t < packet.depart) return 'idle';
      if (R.fast && packet.index === 2 && t >= R.fast.retransDepart) return 'retrans';
      if (packet.lost) return t >= packet.depart + LOSS_MARK ? 'lost' : 'flight';
      return ackedBy.has(packet.index) ? 'acked' : 'flight';
    });

    let received = 0;
    R.packets.forEach((packet) => {
      if (!packet.lost && t >= packet.arrive) received += 1;
    });
    if (R.fast && t >= R.fast.retransArrive) received += 1;
    const expect = R.fast ? (t >= R.fast.retransArrive ? W + 1 : 2) : received + 1;

    let ssthresh = R.ssthreshBefore;
    if (R.kind === 'timeout' && t >= EXPIRY) ssthresh = R.ssthreshAfter;
    if (R.kind === 'fast' && t >= R.fast.triggerAt) ssthresh = R.ssthreshAfter;

    let cells = W;
    if (R.kind === 'timeout' && t >= EXPIRY) {
      cells = Math.round(W + (R.nextWindow - W) * clamp01((t - EXPIRY) / COLLAPSE));
    }
    if (R.kind === 'fast' && t >= R.fast.triggerAt) {
      cells = Math.round(W + (R.nextWindow - W) * clamp01((t - R.fast.triggerAt) / COLLAPSE));
    }
    let cwnd = W;
    if (R.kind === 'timeout' && t >= EXPIRY + COLLAPSE) cwnd = R.nextWindow;
    if (R.kind === 'fast' && t >= R.fast.triggerAt + COLLAPSE) cwnd = R.nextWindow;

    let ghosts = 0;
    let partial = 0;
    if (R.growth.mode === 'exp') ghosts = Math.min(arrivedNew, R.growth.ghosts);
    if (R.growth.mode === 'linear') partial = clamp01(arrivedNew / W);

    let label;
    if (R.kind === 'normal') label = PHASE_LABEL[R.phase];
    else if (R.kind === 'timeout') label = t >= EXPIRY ? '超时重传' : '超时等待';
    else label = t < R.fast.triggerAt ? PHASE_LABEL[R.phase] : t < R.fast.recoveryAt ? '快重传' : '快恢复';

    let banner = null;
    if (R.kind === 'timeout' && t >= EXPIRY) {
      banner = { tone: 'alert', text: '计时器归零：超时重传，门限取丢包前窗口的一半，cwnd 回到 1' };
    }
    if (R.kind === 'fast' && t >= R.fast.triggerAt) {
      banner = t < R.fast.recoveryAt
        ? { tone: 'alert', text: '3 个重复 ACK：立即快重传第 2 包，不等计时器' }
        : { tone: 'note', text: `缺口补齐：cwnd = ssthresh = ${R.nextWindow}，进入拥塞避免` };
    }

    let loss = null;
    if (R.kind !== 'normal' && t >= R.eventAt) loss = lossSummary(R);
    else if (R.afterLoss && prev) loss = lossSummary(prev);

    let steps = null;
    if (R.kind === 'timeout') {
      steps = {
        labels: TIMEOUT_STEPS,
        index: t < R.lossMark ? 0 : t < EXPIRY ? 1 : t < EXPIRY + COLLAPSE ? 2 : 3
      };
    } else if (R.kind === 'fast') {
      steps = {
        labels: FAST_STEPS,
        index: t < R.fast.dupAt[0] ? 0 : t < R.fast.triggerAt ? 1 : t < R.fast.recoveryAt ? 2 : 3
      };
    } else if (R.afterLoss && prev) {
      steps = { labels: prev.kind === 'timeout' ? TIMEOUT_STEPS : FAST_STEPS, index: 4 };
    }

    let timer = null;
    if (R.timer && t >= R.timer.start) {
      const elapsed = Math.min(t, R.timer.end) - R.timer.start;
      timer = {
        progress: clamp01(elapsed / (R.timer.end - R.timer.start)),
        seconds: Math.max(0, (R.timer.end - t) * SEC_PER_UNIT),
        expired: t >= R.timer.end
      };
    }

    return {
      pos: p,
      round: R.index,
      horizon: sc.horizon,
      duration: sc.duration,
      length: R.length,
      local: t,
      kind: R.kind,
      label,
      window: W,
      cwnd,
      cells,
      cellStates,
      ssthresh,
      nextWindow: R.nextWindow,
      nextPhase: R.nextPhase,
      retransmission: R.retransmission,
      downgraded: R.downgraded,
      packets,
      acks,
      acked,
      received,
      expect,
      dupCount: Math.min(3, dupCount),
      ghosts,
      partial,
      timer,
      tags: R.tags.filter((tag) => t >= tag.from && t < tag.to).map(({ text, tone, at }) => ({ text, tone, at })),
      banner,
      loss,
      steps,
      narration: narrationFor(R, t)
    };
  }

  /** 所有离散时刻（轮次起点、丢包标记、事件、恢复），减少动效时逐个跳转。 */
  function keyTimes(sc) {
    const times = new Set([0, sc.duration]);
    sc.rounds.forEach((R) => {
      times.add(R.start);
      if (R.lossMark !== null) times.add(R.start + R.lossMark);
      if (R.eventAt !== null) times.add(R.start + R.eventAt);
      if (R.fast) times.add(R.start + R.fast.recoveryAt);
      if (R.acks.length) times.add(R.start + Math.max(...R.acks.map((ack) => ack.arrive)));
    });
    return [...times].sort((a, b) => a - b);
  }

  /** 轨迹图的数据：每轮的窗口、门限与种类。 */
  function trace(sc) {
    return sc.rounds.map((R) => ({
      index: R.index,
      start: R.start,
      length: R.length,
      window: R.window,
      kind: R.kind,
      phase: R.phase,
      ssthresh: R.ssthreshBefore,
      ssthreshAfter: R.ssthreshAfter,
      nextWindow: R.nextWindow,
      retransmission: R.retransmission
    }));
  }

  /** 从 pos 所在位置预约下一次事件：未开始的轮次取当前轮，否则取下一轮；超出演示末尾返回 null。 */
  function nextEventRound(sc, pos) {
    const p = Math.min(sc.duration, Math.max(0, Number(pos) || 0));
    const R = sc.rounds[locateIndex(sc.rounds, p)];
    const target = Math.abs(p - R.start) < 1e-9 ? R.index : R.index + 1;
    return target <= sc.horizon ? target : null;
  }

  const api = {
    FWD,
    BACK,
    ACK_DELAY,
    EXPIRY,
    COLLAPSE,
    LENGTH,
    FAST_MIN_WINDOW,
    DEFAULT_SSTHRESH,
    DEFAULT_HORIZON,
    DEFAULT_EVENTS,
    SEC_PER_UNIT,
    PHASE_LABEL,
    TIMEOUT_STEPS,
    FAST_STEPS,
    normalizeEvents,
    buildScenario,
    locateIndex,
    frameAt,
    keyTimes,
    trace,
    nextEventRound
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TcpCongestionModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
