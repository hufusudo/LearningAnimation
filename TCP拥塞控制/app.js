(() => {
  'use strict';

  const model = window.TcpCongestionModel;
  const svg = document.getElementById('tcp-stage');
  if (!model || !svg) return;

  // 1. 画面只由时刻 pos 决定：model.frameAt(scenario, pos) 给出完整状态，这里只写 DOM。
  // 2. GSAP 只负责推进一个数值（clock.pos）；没有 GSAP 时播放禁用，单步、进度与预约仍可用。
  // 3. 减少动态效果时不做补间，逐个关键时刻跳转并停留约 0.9 秒（按速度缩放）。
  // 4. 本模块持有的时间线与计时器由自己清理；暂停只冻结当前时刻，不销毁推演。

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const hasGsap = typeof window.gsap !== 'undefined';
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const SEMANTIC = { ss: 'ss', ca: 'ca', loss: 'loss' };
  const LOSS_PHASES = ['超时等待', '超时重传', '快重传', '快恢复'];

  const LANE = { x0: 226, x1: 874, data: 150, ack: 192, chipW: 34, chipH: 24, ackW: 54, ackH: 22 };
  const ROW = { x0: 150, x1: 1060, y: 262, h: 34, maxStep: 34 };
  const TAG = { x0: 300, y: 104, rowX: 1076, rowY: 250 };
  const CHART = { left: 70, right: 930, top: 22, bottom: 262 };
  const RING = 56.55;

  const state = {
    events: model.DEFAULT_EVENTS.map((event) => ({ ...event })),
    scenario: null,
    keys: [],
    chart: null,
    frame: null,
    pos: 0,
    startPos: 0,
    speed: 1,
    playing: false,
    reduced: false,
    tween: null,
    clock: null,
    timer: null,
    linkedAt: 0
  };

  const pools = { packets: [], acks: [], cells: [], tags: [] };
  let cellKey = '';

  const layers = {
    packets: $('packets'),
    acks: $('acks'),
    cells: $('window-cells'),
    tags: $('stage-tags')
  };

  function setText(el, value) {
    const next = String(value);
    if (el.textContent !== next) el.textContent = next;
  }

  function setAttr(el, name, value) {
    const next = String(value);
    if (el.getAttribute(name) !== next) el.setAttribute(name, next);
  }

  function setClass(el, value) {
    if (el.getAttribute('class') !== value) el.setAttribute('class', value);
  }

  function setVisible(el, visible) {
    setAttr(el, 'visibility', visible ? 'visible' : 'hidden');
  }

  function toggleClass(el, name, on) {
    if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
  }

  function create(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => el.setAttribute(key, String(value)));
    if (parent) parent.appendChild(el);
    return el;
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function tagWidth(text) {
    let width = 22;
    for (const char of text) width += /[一-鿿]/.test(char) ? 13 : 7.2;
    return Math.round(width + 6);
  }

  // ---------- 舞台元素池：报文、ACK、窗口格子、浮标只在数量变化时新建 ----------

  function makePacket() {
    const g = create('g', { class: 'pkt', visibility: 'hidden' }, layers.packets);
    create('rect', { x: 0, y: 0, width: LANE.chipW, height: LANE.chipH, rx: 6 }, g);
    create('text', { x: LANE.chipW / 2, y: LANE.chipH / 2 }, g);
    return g;
  }

  function makeAck() {
    const g = create('g', { class: 'ack-chip', visibility: 'hidden' }, layers.acks);
    create('rect', { x: 0, y: 0, width: LANE.ackW, height: LANE.ackH, rx: 7 }, g);
    create('text', { x: LANE.ackW / 2, y: LANE.ackH / 2 }, g);
    return g;
  }

  function buildCells(count, step) {
    layers.cells.innerHTML = '';
    pools.cells = [];
    for (let i = 0; i < count; i += 1) {
      const g = create('g', {
        class: 'cell',
        transform: `translate(${(ROW.x0 + i * step).toFixed(1)} ${ROW.y})`,
        visibility: 'hidden'
      }, layers.cells);
      create('rect', { x: 0, y: 0, width: (step - 6).toFixed(1), height: ROW.h, rx: 7 }, g);
      create('rect', { class: 'cell-fill', x: 1, y: ROW.h - 1, width: (step - 8).toFixed(1), height: 0 }, g);
      create('text', { x: ((step - 6) / 2).toFixed(1), y: ROW.h / 2 }, g);
      pools.cells.push(g);
    }
  }

  function makeTag() {
    const g = create('g', { class: 'tag tone-note', visibility: 'hidden' }, layers.tags);
    create('rect', { class: 'tag-bg', x: 0, y: 0, height: 22, rx: 11 }, g);
    create('text', { class: 'tag-text', x: 11, y: 11 }, g);
    return g;
  }

  function renderPackets(frame) {
    const list = frame.packets;
    while (pools.packets.length < list.length) pools.packets.push(makePacket());
    pools.packets.forEach((g, i) => {
      const packet = list[i];
      if (!packet) {
        setVisible(g, false);
        return;
      }
      const x = LANE.x0 + (LANE.x1 - LANE.x0) * packet.x - LANE.chipW / 2;
      const y = LANE.data - LANE.chipH / 2;
      setAttr(g, 'transform', `translate(${x.toFixed(2)} ${y})`);
      const extra = packet.state === 'lost' ? ' is-lost' : packet.retrans ? ' is-retrans' : '';
      setClass(g, `pkt${extra}`);
      setText(g.lastChild, packet.index);
      setVisible(g, true);
    });
  }

  function renderAcks(frame) {
    const list = frame.acks;
    while (pools.acks.length < list.length) pools.acks.push(makeAck());
    pools.acks.forEach((g, i) => {
      const ack = list[i];
      if (!ack) {
        setVisible(g, false);
        return;
      }
      const x = LANE.x0 + (LANE.x1 - LANE.x0) * ack.x - LANE.ackW / 2;
      const y = LANE.ack - LANE.ackH / 2;
      setAttr(g, 'transform', `translate(${x.toFixed(2)} ${y})`);
      const extra = ack.dup ? ' is-dup' : ack.recovery ? ' is-recovery' : '';
      setClass(g, `ack-chip${extra}`);
      setText(g.lastChild, `ack=${ack.ackNo}`);
      setVisible(g, true);
    });
  }

  function renderCells(frame) {
    const W = frame.window;
    const slots = Math.max(W, frame.nextWindow) + 2;
    const step = Math.min(ROW.maxStep, (ROW.x1 - ROW.x0) / slots);
    const key = `${slots}|${step.toFixed(2)}`;
    if (key !== cellKey) {
      cellKey = key;
      buildCells(slots, step);
    }
    pools.cells.forEach((g, i) => {
      let cls = 'cell';
      let label = '';
      let visible = false;
      let fill = 0;
      if (i < W) {
        const cellState = frame.cellStates[i] || 'idle';
        cls = `cell is-${cellState}`;
        if (frame.retransmission && cellState === 'flight') cls += ' is-retrans';
        if (i >= frame.cells) cls += ' is-gone';
        label = String(i + 1);
        visible = true;
      } else if (i < W + frame.ghosts) {
        cls = 'cell is-ghost';
        label = '+';
        visible = true;
      } else if (i === W && frame.partial > 0) {
        cls = 'cell is-ghost';
        fill = frame.partial;
        visible = true;
      }
      setClass(g, cls);
      setVisible(g, visible);
      if (!visible) return;
      const fillRect = g.children[1];
      const height = fill * (ROW.h - 2);
      setAttr(fillRect, 'height', height.toFixed(2));
      setAttr(fillRect, 'y', (ROW.h - 1 - height).toFixed(2));
      setText(g.lastChild, label);
    });
  }

  function renderTags(tags) {
    while (pools.tags.length < 4) pools.tags.push(makeTag());
    let channelX = TAG.x0;
    let windowX = TAG.rowX;
    pools.tags.forEach((g, i) => {
      const tag = tags[i];
      if (!tag) {
        setVisible(g, false);
        return;
      }
      const width = tagWidth(tag.text);
      let x;
      let y;
      if (tag.at === 'window') {
        windowX -= width + 8;
        x = windowX;
        y = TAG.rowY - 11;
      } else {
        x = channelX;
        y = TAG.y - 11;
        channelX += width + 8;
      }
      setAttr(g, 'transform', `translate(${x} ${y})`);
      setClass(g, `tag tone-${tag.tone === 'alert' ? 'alert' : tag.tone === 'quiet' ? 'quiet' : 'note'}`);
      setAttr(g.firstChild, 'width', width);
      setText(g.lastChild, tag.text);
      setVisible(g, true);
    });
  }

  // ---------- 轨迹图：一次构建，逐帧只改裁剪宽度、光标与标签 ----------

  function buildChart(sc) {
    const H = sc.horizon;
    const maxValue = Math.max(sc.initialSsthresh, 8, ...sc.rounds.map((R) => Math.max(R.window, R.nextWindow, R.ssthreshBefore)));
    const yMax = Math.max(12, Math.ceil((maxValue + 2) / 4) * 4);
    const unit = (CHART.right - CHART.left) / H;
    const xFor = (c) => CHART.left + c * unit;
    const yFor = (v) => CHART.bottom - (Math.max(0, v) / yMax) * (CHART.bottom - CHART.top);
    state.chart = { unit, xFor, yFor };

    let grid = '';
    for (let i = 0; i <= 4; i += 1) {
      const value = Math.round((yMax / 4) * i);
      const y = yFor(value);
      grid += `<line class="grid-line" x1="${CHART.left}" x2="${CHART.right}" y1="${y}" y2="${y}"></line>`;
      grid += `<text class="grid-label" x="${CHART.left - 10}" y="${y + 3}" text-anchor="end">${value}</text>`;
    }
    $('chart-grid').innerHTML = grid;

    const step = Math.max(1, Math.ceil(H / 12));
    let labels = '';
    for (let k = 1; k <= H; k += step) {
      labels += `<text class="x-label" x="${xFor(k - 0.5).toFixed(2)}" y="282">${k}</text>`;
    }
    $('chart-x').innerHTML = labels;

    let d = '';
    sc.rounds.forEach((R) => {
      const y = yFor(R.ssthreshBefore).toFixed(2);
      const x0 = xFor(R.index - 1).toFixed(2);
      const x1 = xFor(R.index).toFixed(2);
      d += d ? ` L ${x0} ${y} L ${x1} ${y}` : `M ${x0} ${y} L ${x1} ${y}`;
    });
    setAttr($('ssthresh-path'), 'd', d);

    let segments = '';
    let points = '';
    let losses = '';
    sc.rounds.forEach((R, i) => {
      const x = xFor(R.index - 0.5);
      const y = yFor(R.window);
      const kind = R.kind !== 'normal' ? SEMANTIC.loss : R.phase === 'slowStart' ? SEMANTIC.ss : SEMANTIC.ca;
      if (i < sc.rounds.length - 1) {
        const next = sc.rounds[i + 1];
        segments += `<line class="seg-${kind}" x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${xFor(next.index - 0.5).toFixed(2)}" y2="${yFor(next.window).toFixed(2)}"></line>`;
      }
      const radius = R.kind !== 'normal' ? 5 : 3.8;
      points += `<circle class="pt pt-${kind}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius}"></circle>`;
      if (R.kind !== 'normal') {
        const text = R.kind === 'timeout' ? '超时' : '快重传';
        losses += `<text class="loss-label" data-round="${R.index}" x="${(x + 9).toFixed(2)}" y="${(y - 9).toFixed(2)}" visibility="hidden">${text}</text>`;
      }
    });
    $('chart-segments').innerHTML = segments;
    $('chart-points').innerHTML = points;
    $('chart-losses').innerHTML = losses;
    setAttr($('chart-clip-rect'), 'x', CHART.left - 8);
  }

  function updateChart(frame) {
    const { xFor, yFor } = state.chart;
    const x = xFor((frame.round - 1) + frame.local / frame.length);
    setAttr($('chart-clip-rect'), 'width', Math.max(0, x - (CHART.left - 8)).toFixed(2));
    const cursor = $('chart-cursor');
    setAttr(cursor, 'x1', x.toFixed(2));
    setAttr(cursor, 'x2', x.toFixed(2));
    const c = (frame.round - 1) + frame.local / frame.length;
    Array.from($('chart-losses').children).forEach((el) => {
      setVisible(el, c >= Number(el.dataset.round) - 0.5);
    });
    const current = $('chart-current');
    setAttr(current, 'cx', xFor(frame.round - 0.5).toFixed(2));
    setAttr(current, 'cy', yFor(frame.window).toFixed(2));
    setVisible(current, true);
    const label = $('ssthresh-label');
    setAttr(label, 'x', (x + 8).toFixed(2));
    setAttr(label, 'y', (yFor(frame.ssthresh) - 8).toFixed(2));
    setText(label, `门限 ${frame.ssthresh}`);
    setVisible(label, true);
  }

  // ---------- 文字与状态：只在内容变化时写入 ----------

  function phaseSub(frame) {
    if (frame.label === '超时等待') return '尾包未确认，计时器运行中';
    if (frame.label === '超时重传') return '门限已减半，窗口回到 1';
    if (frame.label === '快重传') return '立即补发第 2 包';
    if (frame.label === '快恢复') return '累计 ACK 已补齐缺口';
    if (frame.retransmission) return '重传丢失的报文';
    if (frame.acked >= frame.window) return `本轮 ${frame.window} 个报文全部确认`;
    return `发出 ${frame.window} 个报文，已确认 ${frame.acked}`;
  }

  function policyOf(frame) {
    if (frame.kind === 'timeout') return { text: '超时：门限减半，窗口回到 1', cls: ' is-loss' };
    if (frame.kind === 'fast' && (frame.label === '快重传' || frame.label === '快恢复')) {
      return { text: '快重传：门限 = 窗口 = 一半，直接拥塞避免', cls: ' is-loss' };
    }
    if (frame.label === '拥塞避免') return { text: '拥塞避免：每轮 +1 MSS', cls: ' is-ca' };
    if (frame.retransmission) return { text: '慢开始：从 1 重新增长，每个 ACK +1', cls: '' };
    return { text: '慢开始：每个 ACK +1，一轮翻倍', cls: '' };
  }

  function senderStateOf(frame) {
    if (frame.label === '超时等待') return '等待计时器';
    if (frame.label === '超时重传') return '超时，窗口收回';
    if (frame.label === '快重传') return '快重传第 2 包';
    if (frame.label === '快恢复') return '快恢复中';
    if (frame.retransmission) return '重传 1 包';
    if (frame.acked >= frame.window) return '本轮全部确认';
    return frame.acked > 0 ? `等待 ACK ${frame.acked}/${frame.window}` : `连续发送 ${frame.window} 包`;
  }

  function receiverStateOf(frame) {
    if (frame.received === 0) return '就绪，等待数据';
    if (frame.kind === 'fast' && frame.expect === 2) return '缺第 2 包，回重复 ACK';
    if (frame.kind === 'timeout' && frame.received < frame.window) return '尾包未到';
    return `收到 ${frame.received} 包`;
  }

  function nextEventText(frame) {
    const next = state.events.find((event) => event.round >= frame.round);
    if (!next) return '后续没有预约的丢包';
    return `下一事件：第 ${next.round} 轮${next.kind === 'timeout' ? '超时丢包' : '个别丢包（快重传）'}`;
  }

  function paintStatus(frame) {
    const phasePill = $('phase-pill');
    const phaseCls = LOSS_PHASES.includes(frame.label) ? 'phase-fast' : frame.label === '拥塞避免' ? 'phase-ca' : '';
    setClass(phasePill, `status-pill phase-pill${phaseCls ? ` ${phaseCls}` : ''}`);
    setText($('phase-value'), frame.label);
    setText($('cwnd-value'), `${frame.cwnd} MSS`);
    setText($('ssthresh-value'), `${frame.ssthresh} MSS`);
    setText($('round-value'), frame.round);
    setText($('status-note'), hasGsap
      ? `下一轮窗口 ${frame.nextWindow} MSS · ${model.PHASE_LABEL[frame.nextPhase]}`
      : '没有动画引擎（GSAP 未加载）：播放不可用，单步、进度与预约仍可用');
  }

  function paintStage(frame) {
    svg.classList.toggle('is-running', state.playing);
    setText($('round-number'), String(frame.round).padStart(2, '0'));
    setText($('phase-label'), frame.label);
    setText($('phase-sub'), phaseSub(frame));
    const policy = policyOf(frame);
    setText($('policy-text'), policy.text);
    setClass($('policy-pill'), `policy-pill${policy.cls}`);
    setText($('window-value'), `${frame.window} MSS`);
    setText($('next-label'), `下一轮窗口 ${frame.nextWindow} · ${model.PHASE_LABEL[frame.nextPhase]}`);
    setText($('narration'), frame.narration);
    setText($('flight-note'), nextEventText(frame));

    const outstanding = frame.cellStates.filter((s) => s === 'flight' || s === 'lost' || s === 'retrans').length;
    const sender = $('sender-node');
    toggleClass(sender, 'is-alert', frame.kind !== 'normal');
    toggleClass(sender, 'is-active', frame.kind === 'normal' && frame.acked < frame.window);
    setText($('sender-state'), senderStateOf(frame));
    setText($('sender-sub'), `未确认 ${outstanding} 包 · 窗口 ${frame.window}`);
    const arc = $('timer-arc');
    if (frame.timer) {
      setVisible(arc, true);
      arc.style.strokeDashoffset = (RING * frame.timer.progress).toFixed(2);
      setText($('timer-text'), frame.timer.expired ? '计时器已归零' : `计时器 ${frame.timer.seconds.toFixed(1)} s`);
    } else {
      setVisible(arc, false);
      setText($('timer-text'), '计时器 —');
    }
    const receiver = $('receiver-node');
    toggleClass(receiver, 'is-receive', frame.received > 0 && frame.acked < frame.window);
    setText($('receiver-state'), receiverStateOf(frame));
    setText($('receiver-sub'), `期望 ack = ${frame.expect} · 已收 ${frame.received}`);
    const dup = $('dup-counter');
    if (frame.kind === 'fast' && frame.dupCount > 0) {
      setVisible(dup, true);
      setText(dup, `重复 ACK ${frame.dupCount} / 3`);
    } else {
      setVisible(dup, false);
    }
  }

  function paintSteps(frame) {
    const list = $('event-steps');
    const steps = frame.steps;
    if (!steps) {
      list.hidden = true;
      return;
    }
    list.hidden = false;
    const key = steps.labels.join('|');
    if (list.dataset.key !== key) {
      list.dataset.key = key;
      steps.labels.forEach((label, i) => setText($(`event-step-${i}`), label));
    }
    steps.labels.forEach((_, i) => {
      const item = $(`event-step-${i}`);
      toggleClass(item, 'is-current', i === steps.index);
      toggleClass(item, 'is-complete', i < steps.index);
    });
  }

  function paintBanner(frame) {
    const banner = $('event-banner');
    if (!frame.banner) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    setClass(banner, `event-banner${frame.banner.tone === 'note' ? ' note-banner' : ''}`);
    setText(banner, frame.banner.text);
  }

  function paintLoss(frame) {
    const box = $('loss-summary');
    const loss = frame.loss;
    if (!loss) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    setText($('loss-title'), loss.kind === 'timeout'
      ? 'Timeout · 门限取丢包前窗口的一半，cwnd 回到 1 MSS'
      : '快重传 / 快恢复 · 门限与窗口同为一半');
    setText($('loss-progress'), '门限依据丢包前的窗口计算');
    setText($('loss-before'), `${loss.before} MSS`);
    setText($('loss-threshold'), `${loss.ssthreshBefore} → ${loss.ssthreshAfter} MSS`);
    setText($('loss-formula'), loss.formula);
    setText($('loss-window'), `${loss.before} → ${loss.cwndAfter} MSS`);
  }

  function paintProgress() {
    const slider = $('progress-slider');
    const duration = state.scenario.duration;
    if (Math.abs(Number(slider.value) - state.pos) > 0.006) slider.value = state.pos.toFixed(2);
    slider.style.setProperty('--pct', `${((state.pos / duration) * 100).toFixed(1)}%`);
    setText($('progress-value'), `第 ${state.frame.round} 轮 / ${state.scenario.horizon}`);
  }

  function updateControls() {
    setText($('play-icon'), state.playing ? 'Ⅱ' : '▶');
    setText($('play-label'), state.playing ? '暂停' : '播放');
    $('btn-play').disabled = !hasGsap;
    const target = model.nextEventRound(state.scenario, state.pos);
    $('btn-timeout').disabled = !target;
    $('btn-fast-loss').disabled = !target;
  }

  function paint(frame) {
    state.frame = frame;
    paintStatus(frame);
    paintStage(frame);
    renderPackets(frame);
    renderAcks(frame);
    renderCells(frame);
    renderTags(frame.tags);
    paintSteps(frame);
    paintBanner(frame);
    paintLoss(frame);
    updateChart(frame);
    paintProgress();
  }

  // ---------- 时间：GSAP 推进 clock.pos；减少动态效果时逐个关键时刻跳转 ----------

  function killTween() {
    if (state.tween) state.tween.kill();
    state.tween = null;
    state.clock = null;
  }

  function createTween(pos) {
    const duration = state.scenario.duration;
    const clock = { pos: 0 };
    state.clock = clock;
    state.tween = window.gsap.fromTo(clock, { pos: 0 }, {
      pos: duration,
      duration: duration * model.SEC_PER_UNIT,
      ease: 'none',
      paused: true,
      onUpdate: () => onTick(clock.pos),
      onComplete: () => onEnded()
    });
    state.tween.timeScale(state.speed);
    state.tween.progress(clamp(pos / duration, 0, 1), true);
  }

  function onTick(pos) {
    state.pos = pos;
    paint(model.frameAt(state.scenario, pos));
    if (Date.now() - state.linkedAt > 300) writeLink();
  }

  function jumpTo(pos) {
    const duration = state.scenario.duration;
    state.pos = clamp(pos, 0, duration);
    if (state.tween) state.tween.progress(state.pos / duration, true);
    paint(model.frameAt(state.scenario, state.pos));
  }

  function stepReduced() {
    state.timer = null;
    if (!state.playing) return;
    const next = state.keys.find((key) => key > state.pos + 1e-6);
    if (next === undefined) {
      onEnded();
      return;
    }
    jumpTo(next);
    writeLink();
    state.timer = window.setTimeout(stepReduced, 900 / state.speed);
  }

  function stopClock() {
    state.playing = false;
    if (state.tween) state.tween.pause();
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = null;
    svg.classList.remove('is-running');
  }

  function play() {
    if (!hasGsap || state.playing) return;
    if (state.pos >= state.scenario.duration - 1e-6) jumpTo(0);
    state.playing = true;
    svg.classList.add('is-running');
    if (state.reduced) stepReduced();
    else if (state.tween) state.tween.play();
    updateControls();
  }

  function pause() {
    stopClock();
    updateControls();
    writeLink();
  }

  function onEnded() {
    stopClock();
    updateControls();
    writeLink();
  }

  function seek(pos) {
    stopClock();
    jumpTo(pos);
    updateControls();
    writeLink();
  }

  function nextKey() {
    return state.keys.find((key) => key > state.pos + 1e-6);
  }

  function prevKey() {
    let found = 0;
    state.keys.forEach((key) => {
      if (key < state.pos - 1e-6) found = key;
    });
    return found;
  }

  function rebuild(pos, options) {
    const keepPlaying = Boolean(options && options.keepPlaying && state.playing);
    stopClock();
    killTween();
    state.scenario = model.buildScenario({ events: state.events });
    state.keys = model.keyTimes(state.scenario);
    buildChart(state.scenario);
    const slider = $('progress-slider');
    slider.max = String(state.scenario.duration);
    if (hasGsap) createTween(clamp(pos, 0, state.scenario.duration));
    jumpTo(clamp(pos, 0, state.scenario.duration));
    updateControls();
    writeLink();
    if (keepPlaying) play();
  }

  // ---------- 预约、重新开始与地址栏 ----------

  function addEvent(kind) {
    const target = model.nextEventRound(state.scenario, state.pos);
    if (!target) return;
    state.events = model.normalizeEvents([...state.events.filter((event) => event.round !== target), { round: target, kind }]);
    rebuild(state.pos, { keepPlaying: true });
  }

  function reset() {
    state.events = model.DEFAULT_EVENTS.map((event) => ({ ...event }));
    stopClock();
    rebuild(0);
  }

  function readLink() {
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.has('e')) {
        const parsed = params.get('e').split(',').map((item) => {
          const match = /^(\d{1,2})([tf])$/.exec(item.trim());
          return match ? { round: Number(match[1]), kind: match[2] === 't' ? 'timeout' : 'fast' } : null;
        }).filter(Boolean);
        state.events = model.normalizeEvents(parsed);
      }
      const t = Number(params.get('t'));
      state.startPos = params.has('t') && Number.isFinite(t) && t >= 0 ? t : 0;
    } catch (error) {
      state.startPos = 0;
    }
  }

  function writeLink() {
    state.linkedAt = Date.now();
    try {
      const events = state.events.map((event) => `${event.round}${event.kind === 'timeout' ? 't' : 'f'}`).join(',');
      history.replaceState(null, '', `#t=${state.pos.toFixed(2)}&e=${events}`);
    } catch (error) {
      // 某些本地环境不允许改写地址，演示照常可用
    }
  }

  // ---------- 控件与键盘 ----------

  function setSpeed(value) {
    state.speed = Number(value);
    setText($('speed-value'), `${state.speed.toFixed(1)}×`);
    $('speed-slider').style.setProperty('--pct', `${((state.speed - 0.5) / 2) * 100}%`);
    if (state.tween) state.tween.timeScale(state.speed);
  }

  function setMotion(reduced) {
    const wasPlaying = state.playing;
    stopClock();
    state.reduced = reduced;
    document.body.dataset.motion = reduced ? 'reduced' : 'full';
    $('motion-toggle').checked = reduced;
    if (wasPlaying) play();
  }

  function bind() {
    $('btn-play').addEventListener('click', () => (state.playing ? pause() : play()));
    $('btn-step').addEventListener('click', () => {
      const next = nextKey();
      seek(next === undefined ? state.scenario.duration : next);
    });
    $('btn-reset').addEventListener('click', reset);
    $('btn-timeout').addEventListener('click', () => addEvent('timeout'));
    $('btn-fast-loss').addEventListener('click', () => addEvent('fast'));
    $('speed-slider').addEventListener('input', (event) => setSpeed(event.target.value));
    $('progress-slider').addEventListener('input', (event) => seek(Number(event.target.value)));
    $('motion-toggle').addEventListener('change', (event) => setMotion(event.target.checked));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.playing) pause();
    });
    document.addEventListener('keydown', (event) => {
      const el = event.target instanceof Element ? event.target : null;
      if (el && el.closest('input, select, textarea, button, a')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (state.playing) pause();
        else play();
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        const next = nextKey();
        if (next !== undefined) seek(next);
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        seek(prevKey());
      } else if (event.code === 'Home') {
        event.preventDefault();
        seek(0);
      }
    });
  }

  function init() {
    readLink();
    state.reduced = motionQuery ? motionQuery.matches : false;
    document.body.dataset.motion = state.reduced ? 'reduced' : 'full';
    $('motion-toggle').checked = state.reduced;
    setSpeed($('speed-slider').value);
    bind();
    if (!hasGsap) $('btn-play').title = '没有动画引擎（GSAP 未加载）';
    rebuild(state.startPos);
  }

  init();
})();
