/**
 * 选择重传 (SR) 的离散事件模型。纯计算：不碰 DOM、不设真实计时器、不依赖随机与当前时间。
 * 给定参数与动作计划，推演发送方、接收方与信道的全部事件，并为每个事件时刻保存前后状态快照；
 * 界面与编排层只读取这里的 steps / packets / timers，渲染时不做任何协议判断。
 *
 * 规则要点（408 教学口径）：
 *  - 发送方贪心发送：窗口一有空位就发一帧，每帧有自己的独立定时器；
 *  - 定时器到期只重发那一帧；收到 NAK 立即重发（不等超时）；
 *  - 接收方把窗口内的乱序帧缓存并回 ACK，基序号到达后连同缓存帧批量交付；
 *  - 已交付过的重复帧不重复交付，但要补发 ACK；校验失败的帧丢弃并回 NAK。
 */
(function (root) {
  'use strict';

  const FRAMES = 8;
  const EPS = 1e-9;
  const MAX_TIME = 400;              // 硬上限，避免异常输入导致死循环

  const DEFAULTS = Object.freeze({
    frames: 8,     // 序号 0–7，不演示回绕
    wt: 4,         // 发送窗口
    wr: 4,         // 接收窗口（Wt + Wr = 8 = 2^n 恰好取等）
    nbits: 3,      // 序号位数
    prop: 1.5,     // 单向传播时延（t）
    timeout: 6,    // 每帧独立定时器时长（t）
    gap: 0.6       // 发送方相邻两帧的最小间隔（t）
  });

  const SCENARIOS = Object.freeze([
    Object.freeze({
      id: 'normal', label: '正常流水',
      note: '连续发送，逐帧独立确认；窗口一有空位就继续发。',
      plan: { dropData: [], dropAck: [], corrupt: [] }
    }),
    Object.freeze({
      id: 'loss1', label: '单帧丢失',
      note: '帧 1 半路丢失：帧 2、3 先存下，只等它超时补发。',
      plan: { dropData: [1], dropAck: [], corrupt: [] }
    }),
    Object.freeze({
      id: 'loss2', label: '双帧不连续丢失',
      note: '帧 0 与帧 2 两个缺口，两个定时器各管各的。',
      plan: { dropData: [0, 2], dropAck: [], corrupt: [] }
    }),
    Object.freeze({
      id: 'error', label: '帧出错 · NAK',
      note: '帧 1 传错：接收方丢掉它，立刻回一个 NAK。',
      plan: { dropData: [], dropAck: [], corrupt: [1] }
    }),
    Object.freeze({
      id: 'ackloss', label: 'ACK 丢失 · 重复帧',
      note: '帧 1 收到了，ACK 却丢了：超时重发后接收方补一个 ACK。',
      plan: { dropData: [], dropAck: [1], corrupt: [] }
    }),
    Object.freeze({
      id: 'sandbox', label: '自由演练',
      note: '自己决定发几帧、丢哪一帧，协议照常运转。',
      plan: { dropData: [], dropAck: [], corrupt: [] }
    })
  ]);

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const countTrue = (arr) => arr.reduce((s, v) => s + (v ? 1 : 0), 0);

  function normalize(raw) {
    const p = Object.assign({}, DEFAULTS, raw || {});
    p.frames = Number.isInteger(p.frames) && p.frames > 1 ? p.frames : DEFAULTS.frames;
    p.wt = Number.isInteger(p.wt) && p.wt > 0 ? p.wt : DEFAULTS.wt;
    p.wr = Number.isInteger(p.wr) && p.wr > 0 ? p.wr : DEFAULTS.wr;
    p.nbits = Number.isInteger(p.nbits) && p.nbits > 0 ? p.nbits : DEFAULTS.nbits;
    for (const k of ['prop', 'timeout', 'gap']) {
      p[k] = Number.isFinite(p[k]) && p[k] > 0 ? p[k] : DEFAULTS[k];
    }
    const space = Math.pow(2, p.nbits);
    if (p.wt + p.wr > space) {
      // 黄金定理：Wt + Wr 不得超过序号空间，超出时收敛到可用上限，避免序号混淆
      p.wr = Math.min(p.wr, space - 1);
      p.wt = Math.min(p.wt, space - p.wr);
      if (p.wt < 1) { p.wt = 1; p.wr = Math.min(p.wr, space - 1); }
    }
    return p;
  }

  // =========================================================================
  // 离散事件推演
  // =========================================================================

  function simulate(params, plan, instructions, opts) {
    const n = params.frames;
    const wt = params.wt;
    const wr = params.wr;
    const sandbox = Boolean(opts && opts.sandbox);

    // 发送方与接收方状态
    const acked = new Array(n).fill(false);
    const buffered = new Array(n).fill(false);
    const delivered = new Array(n).fill(false);
    const timerOn = new Array(n).fill(false);
    let base = 0;
    let next = 0;
    let rcvBase = 0;
    let retxCount = 0;
    let lostCount = 0;

    const packets = [];
    const timers = [];
    const steps = [];
    let packetId = 1;
    let sendReadyQueued = false;
    let lastSendT = null;
    let demandLeft = sandbox ? 0 : n;
    let ord = 0;
    const queue = [];

    // 动作计划（预设场景只影响第一次传输，避免死循环）
    const plannedData = new Set((plan && plan.dropData) || []);
    const plannedAck = new Set((plan && plan.dropAck) || []);
    const plannedCorrupt = new Set((plan && plan.corrupt) || []);
    const plannedUsed = new Set();

    // 沙盒动作
    const arms = [];
    const dropsById = new Map();
    for (const ins of instructions || []) {
      if (!ins) continue;
      if (ins.type === 'armData' || ins.type === 'armAck') {
        arms.push({ type: ins.type, at: Number(ins.at) || 0, used: false });
      } else if (ins.type === 'drop') {
        dropsById.set(ins.id, Number(ins.at));
      } else if (ins.type === 'send') {
        pushEvent(Number(ins.at) || 0, 'demand', 0, null);
      }
    }

    function pushEvent(t, type, prio, data) {
      queue.push({ t, type, prio, data, ord: ord++ });
    }

    function activeTimer(seq) {
      for (let i = timers.length - 1; i >= 0; i--) {
        const iv = timers[i];
        if (iv.seq === seq && !iv.cancelled && iv.end > iv.start) return iv;
      }
      return null;
    }

    function startTimer(seq, t, retx) {
      const iv = { seq, start: t, end: t + params.timeout, retx: Boolean(retx), cancelled: false };
      timers.push(iv);
      timerOn[seq] = true;
      pushEvent(t + params.timeout, 'timeout', 3, { seq, iv });
      return iv;
    }

    function closeTimer(seq, t) {
      const iv = activeTimer(seq);
      if (iv) { iv.cancelled = true; iv.end = Math.max(iv.start, t); }
      timerOn[seq] = false;
    }

    // 一次传输：按“用户点名 > 沙盒预设 > 场景计划”决定是否丢弃
    function transmit(dir, seq, flags, t) {
      const id = packetId++;
      const isData = dir === 'DATA';
      const retx = Boolean(flags && flags.retx);
      let dropped = false;
      let lossAt = null;
      const tEnd = t + params.prop;

      if (dropsById.has(id)) {
        const at = dropsById.get(id);
        dropped = true;
        lossAt = Number.isFinite(at) ? clamp(at, t + 0.05, tEnd) : t + params.prop * 0.48;
      } else {
        const armType = isData ? 'armData' : 'armAck';
        const arm = arms.find((a) => !a.used && a.type === armType && a.at <= t + EPS);
        if (arm) {
          arm.used = true;
          dropped = true;
          lossAt = t + params.prop * 0.48;
        } else if (!retx && !sandbox) {
          const key = `${isData ? 'D' : 'A'}:${seq}`;
          const hit = (isData && plannedData.has(seq)) || (!isData && plannedAck.has(seq));
          if (hit && !plannedUsed.has(key)) {
            plannedUsed.add(key);
            dropped = true;
            lossAt = t + params.prop * 0.48;
          }
        }
      }

      const useCorrupt = Boolean(!dropped && !retx && isData && !sandbox
        && plannedCorrupt.has(seq) && !plannedUsed.has(`C:${seq}`));
      if (useCorrupt) plannedUsed.add(`C:${seq}`);

      const pk = {
        id,
        dir,
        seq,
        retx,
        corrupt: useCorrupt,
        lost: dropped,
        from: isData ? 'S' : 'R',
        to: isData ? 'R' : 'S',
        t0: t,
        tEnd: dropped ? lossAt : tEnd,
        tLoss: dropped ? lossAt : null
      };
      packets.push(pk);
      if (dropped) pushEvent(lossAt, 'loss', 2, { id });
      else pushEvent(pk.tEnd, 'arrival', 1, { id });
      return pk;
    }

    function findPacket(id) {
      for (const pk of packets) if (pk.id === id) return pk;
      return null;
    }

    // 贪心发送：窗口一有空位、且距上次发送不小于 gap，就发一帧
    function trySend(t) {
      let sent = null;
      while (true) {
        if (demandLeft <= 0 || next >= n || next >= base + wt) break;
        if (lastSendT != null && t - lastSendT < params.gap - EPS) {
          if (!sendReadyQueued) {
            sendReadyQueued = true;
            pushEvent(lastSendT + params.gap, 'sendReady', 0, null);
          }
          break;
        }
        const seq = next;
        sent = transmit('DATA', seq, { retx: false }, t);
        startTimer(seq, t, false);          // 每帧自己的独立定时器
        next += 1;
        demandLeft -= 1;
        lastSendT = t;
        // 继续循环：下一帧若受 gap 限制，会在原地预约下一次发送
      }
      return sent;
    }

    function retransmit(seq, t) {
      const pk = transmit('DATA', seq, { retx: true }, t);
      retxCount += 1;
      startTimer(seq, t, true);
      return pk;
    }

    function snapshot() {
      return {
        base,
        next,
        acked: acked.slice(),
        rcvBase,
        buffered: buffered.slice(),
        delivered: delivered.slice(),
        timers: timerOn.slice(),
        counts: {
          acked: countTrue(acked),
          delivered: countTrue(delivered),
          retx: retxCount,
          lost: lostCount
        }
      };
    }

    // ---------- 事件处理（均返回本次产生的真实事件列表） ----------

    function txEvent(pk) {
      return {
        kind: 'tx-data', proto: false,
        ev: { seq: pk.seq, retx: pk.retx, corrupt: pk.corrupt, lost: pk.lost }
      };
    }

    function trySendEvent(t) {
      const pk = trySend(t);
      return pk ? [txEvent(pk)] : [];
    }

    function onArrival(pk, t) {
      if (pk.dir === 'DATA') return onDataFrame(pk, t);
      return pk.dir === 'ACK' ? onAckFrame(pk, t) : onNakFrame(pk, t);
    }

    function onDataFrame(pk, t) {
      const seq = pk.seq;
      // 1) 检验失败：丢弃，窗口内则回 NAK
      if (pk.corrupt) {
        const inWin = seq >= rcvBase && seq < rcvBase + wr;
        if (inWin) {
          transmit('NAK', seq, {}, t);
          return [{ kind: 'rx-data', proto: true, ev: { seq, outcome: 'corrupt', delivered: [] } }];
        }
        return [{ kind: 'rx-data', proto: true, ev: { seq, outcome: 'ignored', delivered: [] } }];
      }
      // 2) 落在接收窗口内：先回 ACK，基序号则连同缓存帧批量交付
      if (seq >= rcvBase && seq < rcvBase + wr) {
        transmit('ACK', seq, {}, t);
        if (seq === rcvBase) {
          const batch = [];
          while (rcvBase < n && (buffered[rcvBase] || rcvBase === seq)) {
            if (!delivered[rcvBase]) {
              delivered[rcvBase] = true;
              buffered[rcvBase] = false;
              batch.push(rcvBase);
            }
            rcvBase += 1;
          }
          return [{ kind: 'rx-data', proto: true, ev: { seq, outcome: 'deliver', delivered: batch } }];
        }
        buffered[seq] = true;
        return [{ kind: 'rx-data', proto: true, ev: { seq, outcome: 'buffer', delivered: [] } }];
      }
      // 3) 已交付过的重复帧：补发 ACK，不重复交付
      if (seq >= Math.max(0, rcvBase - wr) && seq < rcvBase) {
        transmit('ACK', seq, {}, t);
        return [{ kind: 'rx-data', proto: true, ev: { seq, outcome: 'duplicate', delivered: [] } }];
      }
      // 4) 窗口外：忽略
      return [{ kind: 'rx-data', proto: true, ev: { seq, outcome: 'ignored', delivered: [] } }];
    }

    function onAckFrame(pk, t) {
      const seq = pk.seq;
      const baseFrom = base;
      let dup = false;
      if (seq < 0 || seq >= n || acked[seq]) {
        dup = true;
      } else {
        acked[seq] = true;
        closeTimer(seq, t);
        if (seq === base) {
          while (base < n && acked[base]) base += 1;
        }
      }
      const out = [{ kind: 'rx-ack', proto: true, ev: { seq, dup, baseFrom, baseTo: base } }];
      // 窗口放出新名额后立即续发
      return out.concat(trySendEvent(t));
    }

    function onNakFrame(pk, t) {
      const seq = pk.seq;
      const out = [{ kind: 'rx-nak', proto: true, ev: { seq } }];
      if (!acked[seq] && seq < next && seq < n) {
        out.push(txEvent(retransmit(seq, t)));
        out.concat(trySendEvent(t)).forEach((x) => out.push(x));
      }
      return out;
    }

    function onLoss(pk, t) {
      lostCount += 1;
      return [{ kind: 'drop', proto: true, ev: { id: pk.id, dir: pk.dir, seq: pk.seq } }];
    }

    function onTimeout(ev, t) {
      const seq = ev.seq;
      const iv = ev.iv;
      if (!iv || iv.cancelled || acked[seq] || timerOn[seq] === false) return [];
      if (activeTimer(seq) !== iv) return [];
      iv.end = t;
      iv.cancelled = true;
      const out = [{ kind: 'timeout', proto: true, ev: { seq } }, txEvent(retransmit(seq, t))];
      return out.concat(trySendEvent(t));
    }

    // ---------- 主循环 ----------

    pushEvent(0, 'init', 0, null);

    while (queue.length) {
      queue.sort((a, b) => a.t - b.t || a.prio - b.prio || a.ord - b.ord);
      const first = queue.shift();
      if (first.t > MAX_TIME) break;
      const batch = [first];
      while (queue.length && Math.abs(queue[0].t - first.t) < EPS) batch.push(queue.shift());

      const before = snapshot();
      const events = [];

      for (const e of batch) {
        if (e.type === 'init') {
          events.push(...trySendEvent(e.t));
        } else if (e.type === 'sendReady') {
          sendReadyQueued = false;
          events.push(...trySendEvent(e.t));
        } else if (e.type === 'demand') {
          demandLeft += 1;
          events.push(...trySendEvent(e.t));
        } else if (e.type === 'arrival') {
          const pk = findPacket(e.data.id);
          if (pk) events.push(...onArrival(pk, e.t));
        } else if (e.type === 'loss') {
          const pk = findPacket(e.data.id);
          if (pk) events.push(...onLoss(pk, e.t));
        } else if (e.type === 'timeout') {
          events.push(...onTimeout(e.data, e.t));
        }
      }

      // 同一时刻的多个事件合并为一步：优先呈现协议事件，其次是发送动作
      const proto = events.filter((x) => x.proto);
      const chosen = proto.length ? proto[0] : events[0];
      if (chosen) {
        steps.push({ t: first.t, kind: chosen.kind, ev: chosen.ev, before, after: snapshot() });
      }
    }

    // 收尾：空场景在 t=0 补一个起始步；末尾留出回执时间
    if (!steps.length || steps[0].t > EPS) {
      const s = snapshot();
      steps.unshift({ t: 0, kind: 'start', ev: {}, before: s, after: snapshot() });
    }
    const lastT = steps[steps.length - 1].t;
    const endT = Math.max(lastT + 1.5, sandbox ? 8 : 0);
    steps.push({ t: endT, kind: 'end', ev: {}, before: snapshot(), after: snapshot() });
    const duration = endT + 0.5;

    for (let i = 0; i < steps.length; i++) {
      const stop = i + 1 < steps.length ? steps[i + 1].t : duration;
      steps[i].dur = Math.max(stop - steps[i].t, 1e-6);
    }

    return { duration, steps, packets, timers };
  }

  // =========================================================================
  // 对外 API
  // =========================================================================

  const PARAM_KEYS = ['frames', 'wt', 'wr', 'nbits', 'prop', 'timeout', 'gap'];

  function buildRun(opts) {
    const o = opts || {};
    const scenario = o.scenario || 'normal';
    const sc = SCENARIOS.find((s) => s.id === scenario) || SCENARIOS[0];
    const raw = {};
    for (const k of PARAM_KEYS) if (o[k] !== undefined) raw[k] = o[k];
    const params = normalize(raw);
    const instructions = Array.isArray(o.instructions)
      ? o.instructions.map((i) => Object.assign({}, i))
      : [];
    const res = simulate(params, sc.plan, instructions, { sandbox: sc.id === 'sandbox' });
    return {
      scenario: sc.id,
      params,
      duration: res.duration,
      steps: res.steps,
      packets: res.packets,
      timers: res.timers,
      instructions
    };
  }

  // 二分查找最后一个 steps[i].t <= t
  function sample(run, t) {
    const steps = run.steps;
    const time = clamp(Number(t) || 0, 0, run.duration);
    let lo = 0;
    let hi = steps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (steps[mid].t <= time + EPS) lo = mid;
      else hi = mid - 1;
    }
    const step = steps[lo];
    const p = step.dur > 0 ? clamp((time - step.t) / step.dur, 0, 1) : 0;
    return {
      index: lo,
      p,
      step,
      prev: lo > 0 ? steps[lo - 1] : null,
      done: lo === steps.length - 1 && p >= 1 - EPS
    };
  }

  // t 时刻（含该时刻已发生的全部事件）的状态快照
  function stateAt(run, t) {
    return sample(run, t).step.after;
  }

  function boundaries(run) {
    return run.steps.map((s) => s.t);
  }

  // 追加一个动作：先截断 now 之后的历史分支，再放入新动作（不修改入参）
  function applyInstructions(instructions, now, op) {
    const t = Number(now) || 0;
    const list = Array.isArray(instructions) ? instructions : [];
    const kept = list.filter((i) => i && !(Number(i.at) > t + EPS));
    const next = kept.map((i) => Object.assign({}, i));
    const cmd = Object.assign({}, op);
    if (!Number.isFinite(Number(cmd.at))) cmd.at = t;
    next.push(cmd);
    next.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
    return next;
  }

  const api = { FRAMES, DEFAULTS, SCENARIOS, buildRun, sample, stateAt, boundaries, applyInstructions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SRModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
