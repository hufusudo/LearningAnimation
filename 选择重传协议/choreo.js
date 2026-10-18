/**
 * 选择重传 (SR) 的视觉编排：输入（步，进度），输出每个元素此刻的样子。
 * 纯函数，不碰 DOM、不读时钟；同一 (run, index, p) 永远得到同一画面，
 * 因此拖动、倒退、暂停都能精确重绘，上一步终点等于下一步起点。
 */
(function (root) {
  'use strict';

  // 舞台几何，与 index.html 中的 viewBox / 静态元素一一对应
  const GEO = {
    boxS: { x: 24, y: 44, w: 344, h: 272 },
    boxR: { x: 732, y: 44, w: 344, h: 272 },
    cellW: 32, cellH: 40, pitch: 36, cellY: 118,
    sX: 60, rX: 768,
    winY: 112, winH: 52,
    ptrY: 172, baseLabelY: 190, nextLabelY: 206, rcvLabelY: 190,
    timerY: 218, timerH: 9,
    laneY0: 168, laneY1: 232, laneX0: 380, laneX1: 720,
    lossRatio: 0.48,
    tagY: { sender: 26, receiver: 26, channel: 200 },
    anchor: { sender: 196, receiver: 904, channel: 550 }
  };

  // 语义色只承载状态，旁边永远配着文字（标签与图例）
  const COLORS = {
    acked:   { fill: '#dfeae4', stroke: '#a8c4b6', text: '#2b6f57' },
    done:    { fill: '#dfeae4', stroke: '#a8c4b6', text: '#2b6f57' },
    pending: { fill: '#e2eaf6', stroke: '#90a9c9', text: '#33557f' },
    retry:   { fill: '#f8e7e3', stroke: '#cb9a90', text: '#9c3f31' },
    ready:   { fill: '#f7efdd', stroke: '#cbb489', text: '#8a6018' },
    outside: { fill: '#f5f5f1', stroke: '#c6c8c0', text: '#8b9086' },
    buffer:  { fill: '#efeaf7', stroke: '#b3a4d0', text: '#5f4f8c' },
    expect:  { fill: '#f2faf6', stroke: '#4a9377', text: '#2b6f57' },
    wait:    { fill: '#faf9f5', stroke: '#dcdcd4', text: '#6b7066' }
  };
  const LABEL = {
    acked: '已确认', pending: '计时中', retry: '重传', ready: '可发', outside: '窗外',
    done: '已交付', expect: '期待', buffer: '缓存', wait: '待收'
  };

  // 每一步内部的时间分配（占步长的 0–1 比例）
  const W = {
    lead:  [0.00, 0.10],
    move:  [0.05, 0.45],
    text:  [0.12, 0.34],
    tag:   [0.28, 0.46],
    stats: [0.40, 0.75],
    fade:  [0.80, 0.97]
  };

  const EPS = 1e-9;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function win(p, a, b) {
    if (b <= a) return p >= b ? 1 : 0;
    return clamp((p - a) / (b - a), 0, 1);
  }
  function ease(q) { return q * q * (3 - 2 * q); }
  function q(p, w) { return ease(win(p, w[0], w[1])); }

  function hex(c) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const pa = hex(a), pb = hex(b);
    const out = pa.map((v, i) => Math.round(v * (1 - t) + pb[i] * t));
    return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  // 文字交叉淡入淡出：先淡出旧句，再淡入新句；一步结束时直接是新句
  function textView(prev, cur, p, done) {
    if (done || prev === cur || prev == null) return { text: cur, alpha: 1 };
    if (p < W.text[0]) return { text: prev, alpha: 1 };
    if (p < W.text[1]) return { text: prev, alpha: 1 - (p - W.text[0]) / (W.text[1] - W.text[0]) };
    return { text: cur, alpha: ease(win(p, W.text[1], W.text[1] + 0.12)) };
  }

  // 中文按 12px 计，其余按 6.6px 计，加 20 的内边距
  function textWidth(text) {
    let w = 20;
    for (const ch of String(text)) w += (ch.codePointAt(0) || 0) >= 0x2e80 ? 12 : 6.6;
    return Math.ceil(w);
  }

  // ---------- 状态判定 ----------

  // 每帧最后一次选择重传的时刻（由定时器区间推出，与步无关）
  function retransmitMap(run) {
    const at = new Array(run.params.frames).fill(Infinity);
    for (const iv of run.timers || []) if (iv.retx && iv.start > at[iv.seq]) at[iv.seq] = iv.start;
    return at;
  }

  function senderState(st, i, ctx, refTime) {
    const p = ctx.params;
    if (st.acked[i]) return 'acked';
    if (i < st.base || i >= st.base + p.wt) return 'outside';
    if (i >= st.next) return 'ready';
    if (st.timers[i] && ctx.retxAt[i] <= refTime + EPS) return 'retry';
    return 'pending';
  }

  function receiverState(st, i, ctx) {
    const p = ctx.params;
    if (st.delivered[i]) return 'done';
    if (st.buffered[i]) return 'buffer';
    if (i === st.rcvBase) return 'expect';
    if (i > st.rcvBase && i < st.rcvBase + p.wr) return 'wait';
    return 'outside';
  }

  // ---------- 事件的解说、阶段与浮标 ----------

  const PHASE = {
    'start': '就绪', 'tx-data': '发帧', 'drop': '丢包', 'rx-data': '接收',
    'rx-ack': '确认', 'rx-nak': '差错', 'timeout': '超时', 'end': '完成'
  };

  function narrOf(step, run) {
    const ev = step.ev || {};
    const s = run.params;
    switch (step.kind) {
      case 'start':
        return run.introNarr || '发送方在窗口里连发几帧，接收方逐帧回 ACK。';
      case 'tx-data':
        if (ev.retx) return `只重发帧 ${ev.seq}，别的已确认帧一动不动。`;
        return `帧 ${ev.seq} 发出，它自己的定时器开始倒计时。`;
      case 'drop':
        return ev.dir === 'DATA'
          ? `帧 ${ev.seq} 在信道里丢了，发送方此刻并不知情。`
          : `${ev.dir} ${ev.seq} 在回程丢了，发送方只能等超时。`;
      case 'rx-data': {
        const a = ev.delivered && ev.delivered.length;
        if (ev.outcome === 'corrupt') return `帧 ${ev.seq} 校验失败，丢掉并回 NAK ${ev.seq}。`;
        if (ev.outcome === 'buffer') return `帧 ${ev.seq} 走在了前面，先存下并回 ACK ${ev.seq}。`;
        if (ev.outcome === 'duplicate') return `帧 ${ev.seq} 早已交过，补一个 ACK 让发送方安心。`;
        if (ev.outcome === 'ignored') return `帧 ${ev.seq} 落在窗口外，接收方不理会。`;
        if (a > 1) return `缺口补上，缓存的 ${ev.delivered.join('、')} 一起交上去。`;
        return `帧 ${ev.seq} 按序到达，交给上层，接收窗口前移。`;
      }
      case 'rx-ack': {
        if (ev.dup) return `重复的 ACK ${ev.seq}，状态不变。`;
        if (ev.baseTo > ev.baseFrom + 1) return `ACK ${ev.seq} 到，base 由 ${ev.baseFrom} 跳到 ${ev.baseTo}。`;
        if (ev.baseTo > ev.baseFrom) return `ACK ${ev.seq} 到，base 推到 ${ev.baseTo}，窗口放出新序号。`;
        return `ACK ${ev.seq} 到，帧 ${ev.seq} 已确认，base 还得等前面的。`;
      }
      case 'rx-nak':
        return `收到 NAK ${ev.seq}，不等超时，立刻重发帧 ${ev.seq}。`;
      case 'timeout':
        return `帧 ${ev.seq} 的定时器到点，只重发 ${ev.seq} 这一帧。`;
      case 'end':
        return '八帧全部确认并交付，两个窗口都滑到了尽头。';
      default:
        return '';
    }
  }

  function tagsOf(step, run) {
    const ev = step.ev || {};
    const out = [];
    const push = (text, tone, at, seq) => { if (out.length < 2) out.push({ text, tone, at, seq: seq == null ? null : seq }); };
    switch (step.kind) {
      case 'tx-data':
        if (ev.retx) push(`仅重传 ${ev.seq}`, 'key', 'sender', ev.seq);
        break;
      case 'drop':
        push(ev.dir === 'DATA' ? `帧 ${ev.seq} 丢失` : `${ev.dir} ${ev.seq} 丢失`, 'warn', 'channel', ev.seq);
        break;
      case 'rx-data':
        if (ev.outcome === 'corrupt') push('校验错·丢弃', 'warn', 'receiver', ev.seq);
        else if (ev.outcome === 'buffer') push(`乱序缓存 ${ev.seq}`, 'key', 'receiver', ev.seq);
        else if (ev.outcome === 'duplicate') push('重复·补 ACK', 'note', 'receiver', ev.seq);
        else if (ev.outcome === 'ignored') push('窗口外忽略', 'quiet', 'receiver', ev.seq);
        else if (ev.delivered && ev.delivered.length > 1) push(`交付 ${ev.delivered[0]}–${ev.delivered[ev.delivered.length - 1]}`, 'key', 'receiver', ev.seq);
        else push('按序交付', 'note', 'receiver', ev.seq);
        break;
      case 'rx-ack':
        if (ev.dup) push('重复 ACK', 'quiet', 'sender', ev.seq);
        else if (ev.baseTo > ev.baseFrom) push(`base → ${ev.baseTo}`, 'key', 'sender', ev.seq);
        else push(`ACK ${ev.seq} 已收`, 'note', 'sender', ev.seq);
        break;
      case 'rx-nak':
        push(`NAK ${ev.seq}`, 'warn', 'sender', ev.seq);
        break;
      case 'timeout':
        push(`T${ev.seq} 超时`, 'warn', 'sender', ev.seq);
        if (ev.seq != null) push('选择重传', 'key', 'channel', ev.seq);
        break;
      default:
        break;
    }
    return out;
  }

  // ---------- 主函数：某一时刻的完整画面 ----------

  function view(run, index, p) {
    const step = run.steps[index] || run.steps[0];
    const prev = index > 0 ? run.steps[index - 1] : null;
    const n = run.params.frames;
    if (!run._retxAt) run._retxAt = retransmitMap(run);
    const ctx = { params: run.params, retxAt: run._retxAt };
    const B = step.before, A = step.after;
    const beforeRef = step.t - EPS;
    const afterRef = step.t;
    const t = step.t + p * step.dur;
    const done = p >= 1;
    const qMove = q(p, W.move);
    const qStats = q(p, W.stats);

    // --- 帧格 ---
    const cells = { s: [], r: [] };
    for (let i = 0; i < n; i++) {
      const sf = senderState(B, i, ctx, beforeRef);
      const st = senderState(A, i, ctx, afterRef);
      cells.s.push({
        from: sf, to: st, q: qMove,
        fill: mix(COLORS[sf].fill, COLORS[st].fill, qMove),
        stroke: mix(COLORS[sf].stroke, COLORS[st].stroke, qMove),
        text: mix(COLORS[sf].text, COLORS[st].text, qMove),
        label: textView(LABEL[sf], LABEL[st], p, sf === st)
      });
      const rf = receiverState(B, i, ctx);
      const rt = receiverState(A, i, ctx);
      cells.r.push({
        from: rf, to: rt, q: qMove,
        fill: mix(COLORS[rf].fill, COLORS[rt].fill, qMove),
        stroke: mix(COLORS[rf].stroke, COLORS[rt].stroke, qMove),
        text: mix(COLORS[rf].text, COLORS[rt].text, qMove),
        label: textView(LABEL[rf], LABEL[rt], p, rf === rt)
      });
    }

    // --- 窗口框与指针（平滑滑动） ---
    const slide = (a, b) => a + (b - a) * qMove;
    const count = (base, total) => Math.max(0, Math.min(run.params.wt, total - base));
    const baseX = GEO.sX + slide(B.base, A.base) * GEO.pitch;
    const nextX = GEO.sX + Math.min(slide(B.next, A.next), n) * GEO.pitch;
    const rcvX = GEO.rX + slide(B.rcvBase, A.rcvBase) * GEO.pitch;
    const sWinN = count(slide(B.base, A.base), n);
    const rWinN = Math.max(0, Math.min(run.params.wr, n - slide(B.rcvBase, A.rcvBase)));

    // --- 每帧独立定时器 ---
    const timers = [];
    for (const iv of run.timers || []) {
      if (iv.start > t + EPS) continue;
      const remain = iv.end - t;
      if (remain <= 0) continue;
      const onB = B.timers[iv.seq], onA = A.timers[iv.seq];
      const alpha = onB === onA ? (onA ? 1 : 0) : onB + (onA - onB) * q(p, W.move);
      if (alpha <= 0.001) continue;
      timers.push({
        seq: iv.seq,
        x: GEO.sX + iv.seq * GEO.pitch,
        frac: clamp(remain / run.params.timeout, 0, 1),
        alpha,
        urgent: remain / run.params.timeout < 0.3
      });
    }

    // --- 接收方逐帧 ACK 标记 ---
    const ackMarks = [];
    for (let i = 0; i < n; i++) {
      const onB = B.delivered[i] || B.buffered[i];
      const onA = A.delivered[i] || A.buffered[i];
      const v = onB === onA ? (onA ? 1 : 0) : onB + (onA - onB) * qMove;
      ackMarks.push({ seq: i, x: GEO.rX + i * GEO.pitch, on: v });
    }

    // --- 寄存器与计数 ---
    const num = (a, b) => textView(String(a), String(b), p, a === b);
    const regs = {
      base: num(B.base, A.base),
      next: num(B.next, A.next),
      rcv: num(B.rcvBase, A.rcvBase),
      acked: num(B.counts.acked, A.counts.acked),
      delivered: num(B.counts.delivered, A.counts.delivered),
      retx: num(B.counts.retx, A.counts.retx),
      buffer: textView(bufferText(B), bufferText(A), p, bufferText(B) === bufferText(A))
    };

    // --- 飞行报文（位置只由绝对时刻决定） ---
    const packets = [];
    for (const pk of run.packets || []) {
      if (t < pk.t0 - EPS || t >= pk.tEnd - EPS) continue;
      const prog = clamp((t - pk.t0) / Math.max(EPS, pk.tEnd - pk.t0), 0, 1);
      const fromX = pk.dir === 'DATA' ? GEO.laneX0 : GEO.laneX1;
      const toX = pk.dir === 'DATA' ? GEO.laneX1 : GEO.laneX0;
      packets.push({
        id: pk.id, dir: pk.dir, seq: pk.seq, retx: pk.retx, corrupt: pk.corrupt,
        x: fromX + (toX - fromX) * prog,
        y: pk.dir === 'DATA' ? GEO.laneY0 : GEO.laneY1,
        label: packetLabel(pk),
        alpha: 1
      });
    }

    // --- 信道损毁标记 ---
    let breakMark = null;
    if (step.kind === 'drop') {
      const pk = (run.packets || []).find((x) => x.id === step.ev.id);
      if (pk) {
        const fromX = pk.dir === 'DATA' ? GEO.laneX0 : GEO.laneX1;
        const toX = pk.dir === 'DATA' ? GEO.laneX1 : GEO.laneX0;
        const prog = pk.tLoss == null ? GEO.lossRatio : clamp((pk.tLoss - pk.t0) / Math.max(EPS, pk.tEnd - pk.t0), 0, 1);
        breakMark = {
          x: fromX + (toX - fromX) * prog,
          y: pk.dir === 'DATA' ? GEO.laneY0 : GEO.laneY1,
          label: '✕'
        };
      }
    }

    // --- 引导：本步的主体对象 ---
    const focus = focusOf(step);

    // --- 浮标 ---
    const tags = tagsOf(step, run).map((tg) => {
      const key = tg.tone === 'key';
      const alpha = key
        ? q(p, W.tag)
        : q(p, W.tag) * (1 - q(p, W.fade));
      return Object.assign(tg, {
        alpha,
        rise: 4 * p,
        x: tagX(tg),
        y: GEO.tagY[tg.at]
      });
    });

    // --- 文字回执 ---
    const kindOf = (s) => (s ? PHASE[s.kind] : PHASE[step.kind]);
    const narrStep = { kind: step.kind, ev: step.ev, narr: narrOf(step, run) };
    const narrPrev = prev ? { kind: prev.kind, ev: prev.ev, narr: narrOf(prev, run) } : null;
    const prevPhase = prev ? kindOf(prev) : PHASE[step.kind];

    return {
      index, p, t, done, step, prev,
      phase: textView(prevPhase, PHASE[step.kind] || '推进', p, !prev),
      narr: textView(narrPrev ? narrPrev.narr : narrStep.narr, narrStep.narr, p, !prev),
      cells,
      window: {
        s: { x: baseX - 6, w: Math.max(0, (Math.max(sWinN, 0) - 1) * GEO.pitch + GEO.cellW + 12), alpha: sWinN > 0 ? 1 : 0 },
        r: { x: rcvX - 6, w: Math.max(0, (Math.max(rWinN, 0) - 1) * GEO.pitch + GEO.cellW + 12), alpha: rWinN > 0 ? 1 : 0 }
      },
      pointers: {
        base: { x: baseX, labelY: GEO.baseLabelY },
        next: { x: nextX, labelY: GEO.nextLabelY },
        rcv: { x: rcvX, labelY: GEO.rcvLabelY }
      },
      timers, ackMarks, regs, packets, breakMark, focus, tags,
      totals: {
        acked: num(B.counts.acked, A.counts.acked),
        delivered: num(B.counts.delivered, A.counts.delivered),
        lost: num(B.counts.lost, A.counts.lost),
        q: qStats
      },
      focusAlpha: q(p, W.lead) * (1 - q(p, [0.72, 0.96]))
    };
  }

  function bufferText(st) {
    const list = [];
    for (let i = 0; i < st.buffered.length; i++) if (st.buffered[i]) list.push(i);
    return list.length ? `[${list.join(' ')}]` : '—';
  }

  function packetLabel(pk) {
    if (pk.dir === 'DATA') {
      if (pk.retx) return `⚡ 重传 ${pk.seq}`;
      if (pk.corrupt) return `⚠ 出错 ${pk.seq}`;
      return `Frame ${pk.seq}`;
    }
    return `${pk.dir} ${pk.seq}`;
  }

  function focusOf(step) {
    const ev = step.ev || {};
    switch (step.kind) {
      case 'tx-data': return { slot: 'cellS', index: ev.seq, alpha: 1 };
      case 'rx-ack': return { slot: 'cellS', index: ev.seq, alpha: 1 };
      case 'rx-nak': return { slot: 'cellS', index: ev.seq, alpha: 1 };
      case 'timeout': return { slot: 'timer', index: ev.seq, alpha: 1 };
      case 'rx-data': return { slot: 'cellR', index: ev.seq, alpha: 1 };
      case 'drop': return { slot: 'lane', index: 0, alpha: 1 };
      default: return null;
    }
  }

  function tagX(tg) {
    const w = textWidth(tg.text);
    let x = GEO.anchor[tg.at];
    if (tg.at === 'sender' && tg.seq != null) x = GEO.sX + tg.seq * GEO.pitch + GEO.cellW / 2;
    if (tg.at === 'receiver' && tg.seq != null) x = GEO.rX + tg.seq * GEO.pitch + GEO.cellW / 2;
    if (tg.at === 'channel' && tg.seq != null) x = GEO.laneX0 + (GEO.laneX1 - GEO.laneX0) * GEO.lossRatio;
    return clamp(x, w / 2 + 8, 1100 - w / 2 - 8);
  }

  const api = { GEO, COLORS, LABEL, W, win, ease, mix, textView, textWidth, view, narrOf, tagsOf, senderState, receiverState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SRChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
