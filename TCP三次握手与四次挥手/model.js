(function (root) {
  'use strict';

  /* 示意参数：单程传播时延统一为 1 秒，斜线的纵向跨度即传输时间；2MSL 示意为 2.5 秒 */
  const FLIGHT = 1.0;
  const MSL2_SECONDS = 2.5;
  const BUFFER_TOTAL = 50;
  const CHUNK_LEAVE = 0.6;

  /* 里程碑（连接建立 / 释放）的效果时长（秒，1× 速度）：徽章弹出、报文闪光、扩散环、生命线光晕 */
  const MILESTONE_POP = 0.45;
  const MILESTONE_FLASH = 1.2;
  const MILESTONE_RING = 1.2;
  const MILESTONE_HALO = 1.6;

  /* RFC 793 状态流（本演示用到的部分）：c 为客户端，s 为服务端 */
  const STATE_FLOW = {
    c: {
      'CLOSED': ['SYN-SENT'],
      'SYN-SENT': ['ESTABLISHED'],
      'ESTABLISHED': ['FIN-WAIT-1'],
      'FIN-WAIT-1': ['FIN-WAIT-2'],
      'FIN-WAIT-2': ['TIME-WAIT'],
      'TIME-WAIT': ['CLOSED']
    },
    s: {
      'LISTEN': ['SYN-RCVD'],
      'SYN-RCVD': ['ESTABLISHED'],
      'ESTABLISHED': ['CLOSE-WAIT'],
      'CLOSE-WAIT': ['LAST-ACK'],
      'LAST-ACK': ['CLOSED']
    }
  };

  /*
   * 每条报文（dir 为 c2s / s2c）在 start 时刻离开发送方，经过 FLIGHT 秒到达接收方（end = start + FLIGHT）。
   * onStart 为发送方离开时的变化，onEnd 为接收方到达时的变化；收尾拍没有报文，只在 start 时刻改变状态。
   * leaveChunk 表示该报文从积压管取走第几块数据。
   */
  const MODES = {
    handshake: {
      id: 'handshake',
      label: '三次握手',
      duration: 4.8,
      intro: '客户端 CLOSED，服务端 LISTEN，在 80 端口等待连接请求。',
      initial: {
        c: { state: 'CLOSED', seq: 100 },
        s: { state: 'LISTEN', seq: 300 }
      },
      buffer: null,
      countdown: null,
      milestone: { step: 'h3', edge: 'end', text: '连接建立 · ESTABLISHED', tone: 'established' },
      phases: [
        { name: '发起 SYN', fromStep: 1 },
        { name: '同步应答', fromStep: 2 },
        { name: '确认 ACK', fromStep: 3 }
      ],
      steps: [
        {
          id: 'h1', tag: '第 1 拍', dir: 'c2s', kind: 'SYN',
          flags: { syn: 1, ack: 0, fin: 0 }, seq: 100, ack: null, len: 0,
          start: 0,
          onStart: { c: { state: 'SYN-SENT', seq: 101 } },
          onEnd: { s: { state: 'SYN-RCVD' } },
          explain: '0.0 s 发 SYN（seq=100，占 1 个序号），客户端进入 SYN-SENT；1.0 s 到达，服务端进入 SYN-RCVD。'
        },
        {
          id: 'h2', tag: '第 2 拍', dir: 's2c', kind: 'SYNACK',
          flags: { syn: 1, ack: 1, fin: 0 }, seq: 300, ack: 101, len: 0,
          start: 1,
          onStart: { s: { seq: 301 } },
          onEnd: {},
          explain: '1.0 s 回 SYN+ACK（seq=300，ack=101 即 100+1）；2.0 s 到达客户端。'
        },
        {
          id: 'h3', tag: '第 3 拍', dir: 'c2s', kind: 'ACK',
          flags: { syn: 0, ack: 1, fin: 0 }, seq: 101, ack: 301, len: 0,
          start: 2,
          onStart: { c: { state: 'ESTABLISHED' } },
          onEnd: { s: { state: 'ESTABLISHED' } },
          explain: '2.0 s 客户端回 ACK（ack=301，纯 ACK 不占序号）并进入 ESTABLISHED；3.0 s 到达服务端，它也进入 ESTABLISHED。'
        }
      ]
    },

    wave: {
      id: 'wave',
      label: '四次挥手',
      duration: 7.0,
      intro: '连接已建立（ESTABLISHED），双方可互发数据；服务端还有 50 字节残存数据待发送。',
      initial: {
        c: { state: 'ESTABLISHED', seq: 200 },
        s: { state: 'ESTABLISHED', seq: 400 }
      },
      buffer: {
        total: BUFFER_TOTAL,
        chunks: [{ len: 20 }, { len: 30 }]
      },
      countdown: { from: 'w6', to: 'z', seconds: MSL2_SECONDS },
      milestone: { step: 'z', edge: 'start', text: '连接释放 · CLOSED', tone: 'released' },
      phases: [
        { name: '请求关闭', fromStep: 1 },
        { name: '半关闭', fromStep: 2 },
        { name: '补发残存', fromStep: 3 },
        { name: '服务端 FIN', fromStep: 5 },
        { name: '最终确认', fromStep: 6 }
      ],
      steps: [
        {
          id: 'w1', tag: '第 1 拍', dir: 'c2s', kind: 'FIN',
          flags: { syn: 0, ack: 1, fin: 1 }, seq: 200, ack: 400, len: 0,
          start: 0,
          onStart: { c: { state: 'FIN-WAIT-1', seq: 201 } },
          onEnd: {},
          explain: '0.0 s 客户端发 FIN（seq=200，占 1 个序号），进入 FIN-WAIT-1；1.0 s 到达服务端。'
        },
        {
          id: 'w2', tag: '第 2 拍', dir: 's2c', kind: 'ACK',
          flags: { syn: 0, ack: 1, fin: 0 }, seq: 400, ack: 201, len: 0,
          start: 1,
          onStart: { s: { state: 'CLOSE-WAIT' } },
          onEnd: { c: { state: 'FIN-WAIT-2' } },
          explain: '1.0 s 服务端回 ACK（ack=201）进入 CLOSE-WAIT，还有数据要发，连接半关闭；2.0 s 到达客户端，它进入 FIN-WAIT-2。'
        },
        {
          id: 'w3', tag: '第 3 拍', dir: 's2c', kind: 'DATA',
          flags: { syn: 0, ack: 1, fin: 0 }, seq: 400, ack: 201, len: 20,
          start: 1.5,
          onStart: { s: { seq: 420 } },
          onEnd: {},
          leaveChunk: 0,
          explain: '1.5 s 从积压管发出 20 字节（seq=400），计数器推进到 420；2.5 s 到达客户端。'
        },
        {
          id: 'w4', tag: '第 4 拍', dir: 's2c', kind: 'DATA',
          flags: { syn: 0, ack: 1, fin: 0 }, seq: 420, ack: 201, len: 30,
          start: 2,
          onStart: { s: { seq: 450 } },
          onEnd: {},
          leaveChunk: 1,
          explain: '2.0 s 发出 30 字节（seq=420），积压管清空，计数器到 450；3.0 s 到达客户端。'
        },
        {
          id: 'w5', tag: '第 5 拍', dir: 's2c', kind: 'FINACK',
          flags: { syn: 0, ack: 1, fin: 1 }, seq: 450, ack: 201, len: 0,
          start: 2.5,
          onStart: { s: { state: 'LAST-ACK', seq: 451 } },
          onEnd: {},
          explain: '2.5 s 积压清空后服务端发 FIN（seq=450，占 1 个序号），进入 LAST-ACK；3.5 s 到达客户端。'
        },
        {
          id: 'w6', tag: '第 6 拍', dir: 'c2s', kind: 'ACK',
          flags: { syn: 0, ack: 1, fin: 0 }, seq: 201, ack: 451, len: 0,
          start: 3.5,
          onStart: { c: { state: 'TIME-WAIT' } },
          onEnd: { s: { state: 'CLOSED' } },
          explain: '3.5 s 客户端回 ACK（ack=451）进入 TIME-WAIT，等待 2MSL；4.5 s 到达，服务端 CLOSED。'
        },
        {
          id: 'z', tag: '收尾', dir: null, kind: null,
          flags: null, seq: null, ack: null, len: 0,
          start: 6.0,
          onStart: { c: { state: 'CLOSED' } },
          onEnd: {},
          explain: '6.0 s 2MSL 结束，客户端 CLOSED；四次挥手完成，连接释放。'
        }
      ]
    }
  };

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  function uniqueSorted(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted.filter((v, i) => i === 0 || Math.abs(v - sorted[i - 1]) > 1e-9);
  }

  function flightProgress(msg, t, instant) {
    if (t < msg.start) return 0;
    if (instant) return 1;
    return clamp((t - msg.start) / (msg.end - msg.start), 0, 1);
  }

  function leaveProgress(at, t, instant) {
    if (t < at) return 0;
    if (instant) return 1;
    return clamp((t - at) / CHUNK_LEAVE, 0, 1);
  }

  /* 把模式定义展开为可采样的序列：补全到达时刻、状态与序号变化表、积压管、倒计时与里程碑 */
  function buildSequence(modeId) {
    const def = MODES[modeId];
    if (!def) throw new Error('未知的演示模式：' + modeId);

    const steps = def.steps.map((raw, index) => ({
      ...raw,
      index,
      end: raw.dir ? raw.start + FLIGHT : raw.start
    }));
    const byId = {};
    steps.forEach(step => { byId[step.id] = step; });

    const stateChanges = { c: [], s: [] };
    const seqChanges = { c: [], s: [] };
    ['c', 's'].forEach(side => {
      const init = def.initial[side];
      stateChanges[side].push({ at: 0, state: init.state });
      seqChanges[side].push({ at: 0, value: init.seq });
    });
    steps.forEach(step => {
      [['onStart', step.start], ['onEnd', step.end]].forEach(([key, at]) => {
        const effects = step[key] || {};
        ['c', 's'].forEach(side => {
          const e = effects[side];
          if (!e) return;
          if (e.state) stateChanges[side].push({ at, state: e.state });
          if (e.seq != null) seqChanges[side].push({ at, value: e.seq });
        });
      });
    });

    let buffer = null;
    if (def.buffer) {
      buffer = {
        total: def.buffer.total,
        chunks: def.buffer.chunks.map(chunk => ({ len: chunk.len, leaveAt: null }))
      };
      steps.forEach(step => {
        if (step.leaveChunk != null) buffer.chunks[step.leaveChunk].leaveAt = step.start;
      });
    }

    let countdown = null;
    if (def.countdown) {
      countdown = {
        start: byId[def.countdown.from].start,
        end: byId[def.countdown.to].start,
        seconds: def.countdown.seconds
      };
    }

    /* 里程碑：连接建立在最后一个 ACK 到达时，释放在 2MSL 结束时；只有连接建立带报文闪光 */
    let milestone = null;
    if (def.milestone) {
      const ref = byId[def.milestone.step];
      milestone = {
        text: def.milestone.text,
        tone: def.milestone.tone,
        at: def.milestone.edge === 'end' ? ref.end : ref.start,
        flashMessage: def.milestone.tone === 'established' ? ref.id : null
      };
    }

    const starts = steps.map(step => step.start);
    const ends = steps.map(step => step.end);

    return {
      id: def.id,
      label: def.label,
      intro: def.intro,
      duration: def.duration,
      flight: FLIGHT,
      initial: def.initial,
      phases: def.phases.map(phase => ({
        name: phase.name,
        fromStep: phase.fromStep,
        at: steps[phase.fromStep - 1].start
      })),
      steps,
      messages: steps.filter(step => step.dir),
      stateChanges,
      seqChanges,
      buffer,
      countdown,
      milestone,
      stops: uniqueSorted([0, ...starts, def.duration]),
      frames: uniqueSorted([0, ...starts, ...ends, def.duration])
    };
  }

  /* 纯函数：结果只依赖 t（与 options.instant），不读取上一帧 */
  function sample(seq, rawT, options) {
    const instant = Boolean(options && options.instant);
    const t = clamp(Number.isFinite(rawT) ? rawT : 0, 0, seq.duration);

    const messages = {};
    seq.messages.forEach(msg => {
      messages[msg.id] = { progress: flightProgress(msg, t, instant) };
    });

    const started = seq.steps.filter(step => step.start <= t);
    const stepIndex = started.length;
    const current = stepIndex > 0 ? seq.steps[stepIndex - 1] : null;

    let phase = null;
    if (stepIndex > 0) {
      seq.phases.forEach((item, i) => {
        if (item.at <= t) phase = { index: i + 1, count: seq.phases.length, name: item.name };
      });
    }

    const states = {};
    ['c', 's'].forEach(side => {
      const changes = seq.stateChanges[side].map(change => ({
        at: change.at,
        state: change.state,
        visible: change.at <= t
      }));
      const visible = changes.filter(change => change.visible);
      states[side] = { current: visible[visible.length - 1].state, changes };
    });

    const counters = {};
    ['c', 's'].forEach(side => {
      let value = null;
      seq.seqChanges[side].forEach(change => {
        if (change.at <= t) value = change.value;
      });
      counters[side] = value;
    });

    let buffer = null;
    if (seq.buffer) {
      const chunks = seq.buffer.chunks.map(chunk => ({
        len: chunk.len,
        leave: leaveProgress(chunk.leaveAt, t, instant)
      }));
      const remaining = seq.buffer.chunks.reduce(
        (sum, chunk) => sum + (t < chunk.leaveAt ? chunk.len : 0), 0);
      const finStep = seq.steps.find(step => step.dir === 's2c' && step.flags && step.flags.fin);
      let note;
      if (remaining > 0) note = `残存 ${remaining} B`;
      else note = finStep && t < finStep.start ? '积压已空，待发 FIN' : '积压已空';
      buffer = { total: seq.buffer.total, remaining, note, chunks };
    }

    let countdown = null;
    if (seq.countdown) {
      const cd = seq.countdown;
      if (t < cd.start) {
        countdown = { status: 'idle', seconds: cd.seconds, fraction: 1 };
      } else if (t >= cd.end) {
        countdown = { status: 'done', seconds: 0, fraction: 0 };
      } else {
        const seconds = cd.end - t;
        countdown = { status: 'running', seconds, fraction: seconds / cd.seconds };
      }
    }

    /* 里程碑效果：只在连接建立时闪光、扩散与光晕；释放时只弹出徽章 */
    let milestone = null;
    if (seq.milestone) {
      const ms = seq.milestone;
      const age = t - ms.at;
      const visible = age >= 0;
      const live = visible && !instant;
      const established = ms.tone === 'established';
      milestone = {
        text: ms.text,
        tone: ms.tone,
        flashMessage: ms.flashMessage,
        visible,
        pop: !visible ? 0 : (instant ? 1 : clamp(age / MILESTONE_POP, 0, 1)),
        ring: live && established && age < MILESTONE_RING ? age / MILESTONE_RING : null,
        flash: live && established ? clamp(1 - age / MILESTONE_FLASH, 0, 1) : 0,
        halo: live && established ? clamp(1 - age / MILESTONE_HALO, 0, 1) : 0
      };
    }

    return {
      t,
      total: seq.duration,
      finished: t >= seq.duration,
      stepIndex,
      stepCount: seq.steps.length,
      current: current ? { id: current.id, tag: current.tag } : null,
      phase,
      explain: current ? current.explain : seq.intro,
      messages,
      counters,
      states,
      buffer,
      countdown,
      milestone
    };
  }

  /* 上一个 / 下一个停靠点（list 为升序时刻表）；direction 为 1 或 -1 */
  function neighbor(list, t, direction) {
    const eps = 1e-6;
    if (direction > 0) {
      for (let i = 0; i < list.length; i += 1) if (list[i] > t + eps) return list[i];
      return list[list.length - 1];
    }
    for (let i = list.length - 1; i >= 0; i -= 1) if (list[i] < t - eps) return list[i];
    return list[0];
  }

  const api = {
    MODES: Object.keys(MODES),
    FLIGHT,
    MSL2_SECONDS,
    BUFFER_TOTAL,
    STATE_FLOW,
    buildSequence,
    sample,
    neighbor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TCPHandshakeModel = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
