/**
 * 选择重传 (SR) 的界面控制器。
 * model.js 给出事件与状态快照，choreo.js 算出某一时刻的画面，这里只负责把结果写进 DOM，
 * 以及按钮、键盘、地址栏、自由演练与本模块自己的时间线和计时器（切换或复位时只清理自己的资源）。
 */
(function () {
  'use strict';

  const M = window.SRModel;
  const C = window.SRChoreo;
  const GEO = C.GEO;
  const hasGsap = typeof window.gsap !== 'undefined';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DWELL = 0.9;                 // 减少动效时，每个事件停留的秒数（1× 速度）
  const EPS = 1e-9;

  const NOTES = {
    normal: '连续发送，逐帧独立确认；窗口一有空位就继续发。',
    loss1: '帧 1 半路丢失：帧 2、3 先存下，只等它超时补发。',
    loss2: '帧 0 与帧 2 两个缺口，两个定时器各管各的。',
    error: '帧 1 传错：接收方丢掉它，立刻回一个 NAK。',
    ackloss: '帧 1 收到了，ACK 却丢了：超时重发后接收方补一个 ACK。',
    sandbox: '自己决定发几帧、丢哪一帧，协议照常运转。'
  };

  const $ = (id) => document.getElementById(id);
  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  const els = {
    stage: $('protocol-stage'),
    senderCells: $('sender-cells'),
    receiverCells: $('receiver-cells'),
    senderWindow: $('sender-window'),
    receiverWindow: $('receiver-window'),
    basePointer: $('base-pointer'),
    nextPointer: $('next-pointer'),
    rcvPointer: $('rcv-pointer'),
    senderTimers: $('sender-timers'),
    receiverAcks: $('receiver-acks'),
    packetLayer: $('packet-layer'),
    focusLayer: $('focus-layer'),
    tagLayer: $('tag-layer'),
    regBase: $('reg-base'), regNext: $('reg-next'), regRcv: $('reg-rcv'),
    regAcked: $('reg-acked'), regDelivered: $('reg-delivered'),
    regRetx: $('reg-retx'), regBuffer: $('reg-buffer'),
    timerReadout: $('timer-readout'), ackReadout: $('ack-readout'),
    clock: $('clock'), phase: $('phase'), lamp: $('status-light'),
    narr: $('explanation'), note: $('scenario-note'),
    totalAcked: $('total-acked'), totalDelivered: $('total-delivered'), totalLost: $('total-lost'),
    replay: $('btn-replay'), prev: $('btn-prev'), play: $('btn-play'), playText: $('play-text'),
    next: $('btn-next'), progress: $('progress'), progressTime: $('progress-time'),
    progressDuration: $('progress-duration'), eventNav: $('event-nav'), notice: $('engine-notice'),
    reduce: $('reduce'), sandbox: $('sandbox'), sendOne: $('send-one'),
    armData: $('arm-data'), armAck: $('arm-ack'), sandboxStatus: $('sandbox-status'),
    spacetime: $('spacetime'),
    scenarioButtons: Array.from(document.querySelectorAll('.scenarios button')),
    speedButtons: Array.from(document.querySelectorAll('[data-speed]'))
  };

  const S = {
    scenario: 'normal',
    run: null,
    t: 0,
    index: 0,
    p: 0,
    playing: false,
    speed: 1,
    reduce: Boolean(reduceQuery && reduceQuery.matches),
    instructions: [],
    stopAt: null
  };

  let tl = null;             // GSAP 时间线：只推进一个时钟
  let dwellTimer = null;     // 减少动效下的停留计时器
  let writeTimer = null;     // 地址栏写入防抖
  let cellsS = [], cellsR = [], timerEls = [], ackEls = [], tagSlots = [];
  let focusRing = null;
  let packetEls = new Map();
  let lastBoundaryIndex = -1;
  let spacetimePlayhead = null;

  // ---------- 通用写入：只在值变化时写 ----------

  const fmt = (v) => (Math.round(v * 1000) / 1000).toString();
  function put(el, key, value) {
    if (!el) return;
    const s = typeof value === 'number' ? fmt(value) : String(value);
    let c = el._c;
    if (!c) { c = el._c = {}; }
    if (c[key] === s) return;
    c[key] = s;
    if (key === 'text') el.textContent = s;
    else if (key === 'fill') el.style.fill = s;
    else if (key === 'stroke') el.style.stroke = s;
    else if (key === 'opacity') el.style.opacity = s;
    else el.setAttribute(key, s);
  }
  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---------- 建舞台（一次性） ----------

  function buildCells() {
    const n = M.FRAMES;
    cellsS = [];
    cellsR = [];
    els.senderCells.textContent = '';
    els.receiverCells.textContent = '';
    for (let i = 0; i < n; i++) {
      cellsS.push(makeCell(els.senderCells, GEO.sX + i * GEO.pitch, i));
      cellsR.push(makeCell(els.receiverCells, GEO.rX + i * GEO.pitch, i));
    }
  }

  function makeCell(parent, x, index) {
    const g = svgEl('g', { class: 'cell', transform: `translate(${x} ${GEO.cellY})` }, parent);
    const rect = svgEl('rect', {
      class: 'cell-rect', x: 0, y: 0, width: GEO.cellW, height: GEO.cellH, rx: 6
    }, g);
    const num = svgEl('text', { class: 'cell-num', x: GEO.cellW / 2, y: 15 }, g);
    num.textContent = String(index);
    const state = svgEl('text', { class: 'cell-state', x: GEO.cellW / 2, y: 31 }, g);
    return { g, rect, num, state };
  }

  function buildTimers() {
    const n = M.FRAMES;
    timerEls = [];
    ackEls = [];
    els.senderTimers.textContent = '';
    els.receiverAcks.textContent = '';
    for (let i = 0; i < n; i++) {
      const g = svgEl('g', { transform: `translate(${GEO.sX + i * GEO.pitch} ${GEO.timerY})`, opacity: 0 }, els.senderTimers);
      svgEl('rect', { class: 'timer-track', x: 0, y: 0, width: GEO.cellW, height: GEO.timerH, rx: 4 }, g);
      const fill = svgEl('rect', { class: 'timer-fill', x: 0, y: 0, width: 0, height: GEO.timerH, rx: 4 }, g);
      timerEls.push({ g, fill });

      const a = svgEl('g', { transform: `translate(${GEO.rX + i * GEO.pitch} ${GEO.timerY})` }, els.receiverAcks);
      const box = svgEl('rect', { class: 'ack-mark', x: 0, y: 0, width: GEO.cellW, height: GEO.timerH, rx: 4 }, a);
      const mark = svgEl('text', { class: 'ack-mark-text', x: GEO.cellW / 2, y: GEO.timerH / 2 }, a);
      mark.textContent = '✓';
      ackEls.push({ g: a, box, mark });
    }
  }

  function buildFocusAndTags() {
    focusRing = svgEl('rect', { class: 'focus-ring', x: 0, y: 0, width: 10, height: 10, rx: 8, opacity: 0 }, els.focusLayer);
    tagSlots = [0, 1, 2].map(() => {
      const g = svgEl('g', { class: 'tag tone-key', opacity: 0 }, els.tagLayer);
      const rect = svgEl('rect', { class: 'tag-bg', x: 0, y: -13, width: 10, height: 26, rx: 6 }, g);
      const text = svgEl('text', { class: 'tag-text', x: 0, y: 0, 'text-anchor': 'middle' }, g);
      return { g, rect, text };
    });
  }

  function makePacket(p) {
    const g = svgEl('g', { class: 'packet', transform: 'translate(-999 -999)' }, els.packetLayer);
    const rect = svgEl('rect', { class: 'packet-body', x: 0, y: 0, width: 10, height: 24, rx: 7 }, g);
    const text = svgEl('text', { class: 'packet-text', x: 0, y: 0 }, g);
    g.addEventListener('click', () => onPacketClick(p.id));
    return { g, rect, text };
  }

  // ---------- 染色 ----------

  const PKT_COLOR = {
    DATA:    { fill: '#eef3fa', stroke: '#3d659b', text: '#33557f' },
    RETX:    { fill: '#fbeee9', stroke: '#a74438', text: '#9c3f31' },
    CORRUPT: { fill: '#fdf6e8', stroke: '#936a2b', text: '#8a6018' },
    ACK:     { fill: '#edf5f1', stroke: '#2e7c64', text: '#2b6f57' },
    NAK:     { fill: '#f8e7e3', stroke: '#a74438', text: '#9c3f31' }
  };
  function packetTone(p) {
    if (p.dir === 'DATA') {
      if (p.retx) return 'RETX';
      if (p.corrupt) return 'CORRUPT';
      return 'DATA';
    }
    return p.dir === 'NAK' ? 'NAK' : 'ACK';
  }

  // ---------- 逐帧渲染 ----------

  function render() {
    if (!S.run) return;
    const s = M.sample(S.run, S.t);
    S.index = s.index;
    S.p = s.p;
    const v = C.view(S.run, s.index, s.p);
    paintCells(v);
    paintWindow(v);
    paintTimers(v);
    paintRegs(v);
    paintPackets(v);
    paintFocus(v);
    paintTags(v);
    paintTexts(v);
    paintSpacetime();
    paintControls(s);
  }

  function paintCells(v) {
    for (let i = 0; i < cellsS.length; i++) {
      const c = cellsS[i];
      const d = v.cells.s[i];
      put(c.rect, 'fill', d.fill);
      put(c.rect, 'stroke', d.stroke);
      put(c.num, 'fill', d.text);
      put(c.state, 'fill', d.text);
      put(c.state, 'text', d.label.text);
      put(c.state, 'opacity', d.label.alpha);
      const r = cellsR[i];
      const dr = v.cells.r[i];
      put(r.rect, 'fill', dr.fill);
      put(r.rect, 'stroke', dr.stroke);
      put(r.num, 'fill', dr.text);
      put(r.state, 'fill', dr.text);
      put(r.state, 'text', dr.label.text);
      put(r.state, 'opacity', dr.label.alpha);
    }
  }

  function paintWindow(v) {
    const sw = els.senderWindow.firstElementChild;
    const rw = els.receiverWindow.firstElementChild;
    put(els.senderWindow, 'transform', `translate(${fmt(v.window.s.x + 6)} ${GEO.cellY})`);
    put(sw, 'width', Math.max(1, v.window.s.w));
    put(els.senderWindow, 'opacity', v.window.s.alpha);
    put(els.receiverWindow, 'transform', `translate(${fmt(v.window.r.x + 6)} ${GEO.cellY})`);
    put(rw, 'width', Math.max(1, v.window.r.w));
    put(els.receiverWindow, 'opacity', v.window.r.alpha);

    put(els.basePointer, 'transform', `translate(${fmt(v.pointers.base.x)} ${GEO.ptrY})`);
    put(els.basePointer.lastElementChild, 'text', `base ${v.regs.base.text}`);
    put(els.basePointer, 'opacity', v.regs.base.alpha);
    put(els.nextPointer, 'transform', `translate(${fmt(v.pointers.next.x)} ${GEO.ptrY})`);
    put(els.nextPointer.lastElementChild, 'text', `next ${v.regs.next.text}`);
    put(els.nextPointer, 'opacity', v.regs.next.alpha);
    put(els.rcvPointer, 'transform', `translate(${fmt(v.pointers.rcv.x)} ${GEO.ptrY})`);
    put(els.rcvPointer.lastElementChild, 'text', `rcv_base ${v.regs.rcv.text}`);
    put(els.rcvPointer, 'opacity', v.regs.rcv.alpha);
  }

  function paintTimers(v) {
    let soonest = null;
    for (const t of v.timers) {
      if (!soonest || t.frac < soonest.frac) soonest = t;
    }
    for (let i = 0; i < timerEls.length; i++) {
      const slot = v.timers.find((x) => x.seq === i);
      const el = timerEls[i];
      if (!slot) {
        put(el.g, 'opacity', 0);
        put(el.fill, 'width', 0);
        continue;
      }
      put(el.g, 'opacity', slot.alpha);
      put(el.fill, 'width', Math.max(0, slot.frac * GEO.cellW));
      put(el.fill, 'fill', slot.urgent ? '#a74438' : '#936a2b');
    }
    if (soonest) {
      const remain = (soonest.frac * S.run.params.timeout).toFixed(1);
      put(els.timerReadout, 'text', `最近 T${soonest.seq} · 剩 ${remain}t`);
    } else {
      put(els.timerReadout, 'text', '无活动定时器');
    }

    let onCount = 0;
    for (let i = 0; i < ackEls.length; i++) {
      const slot = v.ackMarks[i];
      if (slot.on > 0.001) onCount++;
      put(ackEls[i].box, 'fill', C.mix('#f1f1ec', '#dcebe3', slot.on));
      put(ackEls[i].box, 'stroke', C.mix('#deded6', '#9dbfae', slot.on));
      put(ackEls[i].mark, 'fill', C.mix('#b6b8b0', '#2e7c64', slot.on));
      put(ackEls[i].mark, 'opacity', slot.on);
    }
    put(els.ackReadout, 'text', `${onCount} / ${M.FRAMES}`);
  }

  function paintRegs(v) {
    put(els.regBase, 'text', v.regs.base.text);
    put(els.regBase, 'opacity', v.regs.base.alpha);
    put(els.regNext, 'text', v.regs.next.text);
    put(els.regNext, 'opacity', v.regs.next.alpha);
    put(els.regRcv, 'text', v.regs.rcv.text);
    put(els.regRcv, 'opacity', v.regs.rcv.alpha);
    put(els.regAcked, 'text', v.regs.acked.text);
    put(els.regAcked, 'opacity', v.regs.acked.alpha);
    put(els.regDelivered, 'text', v.regs.delivered.text);
    put(els.regDelivered, 'opacity', v.regs.delivered.alpha);
    put(els.regRetx, 'text', v.regs.retx.text);
    put(els.regRetx, 'opacity', v.regs.retx.alpha);
    put(els.regBuffer, 'text', v.regs.buffer.text);
    put(els.regBuffer, 'opacity', v.regs.buffer.alpha);
  }

  function paintPackets(v) {
    const want = new Map();
    for (const p of v.packets) want.set(p.id, p);
    for (const [id, el] of Array.from(packetEls)) {
      if (!want.has(id)) { el.g.remove(); packetEls.delete(id); }
    }
    for (const [id, p] of want) {
      if (!packetEls.has(id)) packetEls.set(id, makePacket(p));
      const el = packetEls.get(id);
      put(el.g, 'transform', `translate(${fmt(p.x)} ${fmt(p.y)})`);
      const tone = PKT_COLOR[packetTone(p)];
      const w = C.textWidth(p.label) + 6;
      put(el.rect, 'x', -w / 2);
      put(el.rect, 'y', -12);
      put(el.rect, 'width', w);
      put(el.rect, 'fill', tone.fill);
      put(el.rect, 'stroke', tone.stroke);
      put(el.text, 'x', 0);
      put(el.text, 'y', 1);
      put(el.text, 'text', p.label);
      put(el.text, 'fill', tone.text);
      put(el.g, 'opacity', p.alpha);
      if (S.scenario === 'sandbox') el.g.setAttribute('class', 'packet interactive');
      else el.g.setAttribute('class', 'packet');
    }
    // 信道损毁标记
    let brk = els.packetLayer.querySelector('.break-mark');
    if (v.breakMark) {
      if (!brk) {
        brk = svgEl('g', { class: 'break-mark' }, els.packetLayer);
        svgEl('rect', { class: 'packet-body', x: -17, y: -12, width: 34, height: 24, rx: 7, fill: '#f8e7e3' }, brk);
        svgEl('text', { class: 'packet-text', x: 0, y: 1, fill: '#a74438' }, brk).textContent = '✕';
      }
      put(brk, 'transform', `translate(${fmt(v.breakMark.x)} ${fmt(v.breakMark.y)})`);
      put(brk, 'opacity', 1);
    } else if (brk) {
      put(brk, 'opacity', 0);
    }
  }

  function paintFocus(v) {
    if (!v.focus || v.focusAlpha <= 0.01) {
      put(focusRing, 'opacity', 0);
      return;
    }
    let box = null;
    let stroke = '#3d659b';
    const f = v.focus;
    if (f.slot === 'cellS' && f.index != null) {
      box = { x: GEO.sX + f.index * GEO.pitch - 5, y: GEO.cellY - 5, w: GEO.cellW + 10, h: GEO.cellH + 10 };
      stroke = '#3d659b';
    } else if (f.slot === 'cellR' && f.index != null) {
      box = { x: GEO.rX + f.index * GEO.pitch - 5, y: GEO.cellY - 5, w: GEO.cellW + 10, h: GEO.cellH + 10 };
      stroke = '#2e7c64';
    } else if (f.slot === 'timer' && f.index != null) {
      box = { x: GEO.sX + f.index * GEO.pitch - 5, y: GEO.timerY - 5, w: GEO.cellW + 10, h: GEO.timerH + 10 };
      stroke = '#936a2b';
    } else if (f.slot === 'lane') {
      const x = v.breakMark ? v.breakMark.x : (GEO.laneX0 + GEO.laneX1) / 2;
      box = { x: x - 26, y: GEO.laneY0 - 17, w: 52, h: 34 };
      stroke = '#a74438';
    }
    if (!box) { put(focusRing, 'opacity', 0); return; }
    put(focusRing, 'x', box.x);
    put(focusRing, 'y', box.y);
    put(focusRing, 'width', box.w);
    put(focusRing, 'height', box.h);
    put(focusRing, 'stroke', stroke);
    put(focusRing, 'opacity', v.focusAlpha * 0.95);
  }

  function paintTags(v) {
    for (let i = 0; i < tagSlots.length; i++) {
      const slot = tagSlots[i];
      const d = v.tags[i];
      if (!d || d.alpha <= 0.01) { put(slot.g, 'opacity', 0); continue; }
      const w = C.textWidth(d.text);
      const y = d.y - d.rise;
      put(slot.g, 'class', `tag tone-${d.tone}`);
      put(slot.g, 'opacity', d.alpha);
      put(slot.rect, 'x', d.x - w / 2);
      put(slot.rect, 'y', y - 13);
      put(slot.rect, 'width', w);
      put(slot.text, 'x', d.x);
      put(slot.text, 'y', y);
      put(slot.text, 'text', d.text);
    }
  }

  function applyText(el, tv) {
    if (!el) return;
    put(el, 'text', tv.text);
    put(el, 'opacity', tv.alpha);
  }

  function paintTexts(v) {
    put(els.clock, 'text', v.t.toFixed(2).padStart(5, '0'));
    applyText(els.phase, v.phase);
    applyText(els.narr, v.narr);
    applyText(els.totalAcked, v.totals.acked);
    applyText(els.totalDelivered, v.totals.delivered);
    applyText(els.totalLost, v.totals.lost);
  }

  // ---------- 控件 ----------

  function boundaries() {
    return S.run ? M.boundaries(S.run) : [];
  }

  function nextBoundary(after) {
    const b = boundaries();
    for (const t of b) if (t > after + EPS) return t;
    return null;
  }

  function endOfCurrentStep() {
    const step = S.run.steps[S.index];
    if (!step) return null;
    return step.t + step.dur;
  }

  function paintControls(s) {
    const dur = S.run.duration;
    if (document.activeElement !== els.progress) {
      els.progress.max = String(dur.toFixed(2));
      els.progress.value = String(S.t.toFixed(2));
    }
    put(els.progressTime, 'text', S.t.toFixed(2));
    put(els.progressDuration, 'text', `${dur.toFixed(2)} t`);

    const atStart = S.t <= EPS;
    const atEnd = S.t >= dur - EPS;
    els.prev.disabled = atStart;
    els.next.disabled = atEnd;
    els.play.disabled = !hasGsap && !S.reduce;
    put(els.playText, 'text', S.playing ? '❚❚ 暂停' : '播放 ▶');
    els.lamp.classList.toggle('running', S.playing);
    els.reduce.checked = S.reduce;
    document.body.setAttribute('data-motion', S.reduce ? 'reduced' : 'full');
    els.sandbox.hidden = S.scenario !== 'sandbox';
    els.notice.hidden = hasGsap;
    if (!hasGsap) {
      put(els.notice, 'text', S.reduce
        ? '未能加载动画引擎（GSAP）。减少动效下仍会自动推进，每个事件直接跳转并停留。'
        : '未能加载动画引擎（GSAP），播放已停用。可开启「减少动效」后自动推进，或用「下一步」浏览。');
    }
    for (const b of els.speedButtons) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === S.speed));
    }
    for (const b of els.scenarioButtons) {
      b.setAttribute('aria-pressed', String(b.dataset.scenario === S.scenario));
    }
    paintEventNav(s);
  }

  function keySteps(run) {
    const out = [];
    run.steps.forEach((step, i) => {
      const ev = step.ev || {};
      let label = null;
      if (step.kind === 'start') label = '开始';
      else if (step.kind === 'drop') label = `${ev.dir === 'DATA' ? '帧' : ev.dir} ${ev.seq} 丢失`;
      else if (step.kind === 'timeout') label = `T${ev.seq} 超时`;
      else if (step.kind === 'rx-nak') label = `NAK ${ev.seq}`;
      else if (step.kind === 'rx-data') {
        if (ev.outcome === 'corrupt') label = `${ev.seq} 出错`;
        else if (ev.outcome === 'buffer') label = `缓存 ${ev.seq}`;
        else if (ev.outcome === 'duplicate') label = `重复 ${ev.seq}`;
        else if (ev.delivered && ev.delivered.length > 1) label = `交付 ${ev.delivered[0]}–${ev.delivered[ev.delivered.length - 1]}`;
      } else if (step.kind === 'rx-ack' && !ev.dup && ev.baseTo > ev.baseFrom) label = `base ${ev.baseTo}`;
      else if (step.kind === 'end') label = '完成';
      if (label) out.push({ i, t: step.t, label });
    });
    return out;
  }

  function buildEventNav() {
    const keys = keySteps(S.run);
    els.eventNav.textContent = '';
    if (!keys.length) {
      const p = document.createElement('span');
      p.className = 'empty';
      p.textContent = '当前场景没有可定位的关键事件';
      els.eventNav.appendChild(p);
      return;
    }
    keys.forEach((k) => {
      const b = document.createElement('button');
      b.type = 'button';
      const s = document.createElement('span');
      s.textContent = k.t.toFixed(1);
      b.append(s, k.label);
      b.addEventListener('click', () => { pause(); seek(k.t); });
      els.eventNav.appendChild(b);
    });
    lastBoundaryIndex = -1;
  }

  function paintEventNav(s) {
    const kids = els.eventNav.children;
    let active = -1;
    for (let i = 0; i < kids.length; i++) {
      const t = Number(kids[i].firstChild.textContent);
      if (t <= S.t + EPS) active = i; else break;
    }
    if (active === lastBoundaryIndex) return;
    lastBoundaryIndex = active;
    for (let i = 0; i < kids.length; i++) {
      kids[i].setAttribute('aria-current', i === active ? 'true' : 'false');
    }
  }

  // ---------- 时间线：只推进一个时钟 ----------

  function killTimeline() {
    if (tl) { tl.kill(); tl = null; }
  }

  function ensureTimeline() {
    if (tl || !hasGsap) return tl;
    const proxy = { v: 0 };
    tl = gsap.timeline({
      paused: true,
      onUpdate: onTimelineUpdate,
      onComplete: () => {
        S.stopAt = null;
        S.playing = false;
        S.t = S.run.duration;
        render();
        writeLink();
      }
    });
    tl.to(proxy, { v: 1, duration: Math.max(S.run.duration, 0.01), ease: 'none' });
    tl.timeScale(S.speed);
    tl.time(S.t);
    return tl;
  }

  function onTimelineUpdate() {
    if (!tl) return;
    const raw = tl.time();
    if (S.stopAt != null && raw >= S.stopAt - 1e-6) {
      const target = S.stopAt;
      S.stopAt = null;
      S.playing = false;
      tl.pause();
      S.t = target;
      if (Math.abs(tl.time() - target) > 1e-6) tl.time(target);   // 会再进一次 onUpdate，stopAt 已清空
      render();
      writeLink();
      return;
    }
    S.t = clamp(raw, 0, S.run.duration);
    render();
    scheduleWrite();
  }

  function seek(t) {
    clearDwell();
    S.stopAt = null;
    S.t = clamp(Number(t) || 0, 0, S.run.duration);
    if (tl) {
      const wasPlaying = tl.isActive();
      tl.pause();
      tl.time(S.t);
      if (wasPlaying) tl.play();
    }
    render();
    writeLink();
  }

  function pause() {
    S.playing = false;
    S.stopAt = null;
    clearDwell();
    if (tl) tl.pause();
    render();
    writeLink();
  }

  function clearDwell() {
    if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; }
  }

  function play() {
    if (!S.run || (!hasGsap && !S.reduce)) return;
    if (S.t >= S.run.duration - EPS) seek(0);
    S.playing = true;
    if (S.reduce || !hasGsap) { render(); reduceLoop(); return; }
    ensureTimeline();
    S.stopAt = null;
    tl.timeScale(S.speed);
    tl.play();
    render();
  }

  function togglePlay() { if (S.playing) pause(); else play(); }

  // 减少动效：直接跳到下一个事件时刻，停留约 0.9 秒（随速度缩放）
  function reduceLoop() {
    if (!S.playing) return;
    const nb = nextBoundary(S.t);
    if (nb == null) { pause(); return; }
    clearDwell();
    S.t = nb;
    if (tl) { tl.pause(); tl.time(S.t); }
    render();
    writeLink();
    dwellTimer = setTimeout(() => { dwellTimer = null; reduceLoop(); }, (DWELL * 1000) / S.speed);
  }

  function stepNext() {
    if (!S.run) return;
    pause();
    const end = endOfCurrentStep();
    if (end == null || S.t >= S.run.duration - EPS) return;
    if (S.reduce || !hasGsap) { seek(end); return; }
    ensureTimeline();
    S.stopAt = end;
    S.playing = true;
    tl.timeScale(S.speed);
    tl.play();
    render();
  }

  function stepPrev() {
    if (!S.run) return;
    pause();
    const step = S.run.steps[S.index];
    if (!step) return;
    if (S.p > EPS) { seek(step.t); return; }
    const i = Math.max(0, S.index - 1);
    seek(S.run.steps[i].t);
  }

  function replay() { pause(); seek(0); }

  function setSpeed(v) {
    S.speed = v;
    if (tl) tl.timeScale(v);
    render();
  }

  function setReduce(v) {
    const was = S.reduce;
    S.reduce = Boolean(v);
    if (was && !S.reduce) clearDwell();
    if (S.playing && S.reduce) { if (tl) tl.pause(); reduceLoop(); }
    else if (S.playing && !S.reduce) { clearDwell(); ensureTimeline(); tl.timeScale(S.speed); tl.play(); }
    render();
  }

  // ---------- 场景与自由演练 ----------

  function buildRun() {
    const sc = (M.SCENARIOS || []).find((x) => x.id === S.scenario) || { id: S.scenario, note: NOTES[S.scenario] };
    S.run = M.buildRun({
      scenario: S.scenario,
      instructions: S.scenario === 'sandbox' ? S.instructions.slice() : undefined
    });
    S.run.introNarr = sc.note || NOTES[S.scenario] || '';
    S.run._retxAt = null;
    els.note.textContent = sc.note || NOTES[S.scenario] || '';
  }

  function loadScenario(id, opts) {
    const o = opts || {};
    const keep = o.keepTime ? S.t : 0;
    pause();
    killTimeline();
    S.scenario = id;
    if (id !== 'sandbox') S.instructions = [];
    packetEls.forEach((el) => el.g.remove());
    packetEls.clear();
    if (els.packetLayer.querySelector('.break-mark')) els.packetLayer.querySelector('.break-mark').remove();
    buildRun();
    buildEventNav();
    buildSpacetime();
    ensureTimeline();
    seek(Math.min(keep, S.run.duration));
    syncArmLabels();
  }

  function rebuildSandbox() {
    const keep = S.t;
    pause();
    killTimeline();
    packetEls.forEach((el) => el.g.remove());
    packetEls.clear();
    if (els.packetLayer.querySelector('.break-mark')) els.packetLayer.querySelector('.break-mark').remove();
    buildRun();
    buildEventNav();
    buildSpacetime();
    ensureTimeline();
    seek(Math.min(keep, S.run.duration));
    syncArmLabels();
  }

  function applyOp(op) {
    S.instructions = M.applyInstructions(S.instructions, S.t, op);
    rebuildSandbox();
  }

  function armPending(type) {
    const now = S.t;
    const list = S.instructions.filter((i) => i.type === type);
    const last = list[list.length - 1];
    if (!last) return false;
    const dir = type === 'armData' ? 'DATA' : null;
    return !S.run.packets.some((pk) => {
      if (dir && pk.dir !== 'DATA') return false;
      if (!dir && pk.dir === 'DATA') return false;
      return pk.t0 > last.at + EPS && pk.t0 <= now + EPS;
    });
  }

  function syncArmLabels() {
    const pd = S.scenario === 'sandbox' && armPending('armData');
    const pa = S.scenario === 'sandbox' && armPending('armAck');
    els.armData.setAttribute('aria-pressed', String(Boolean(pd)));
    els.armData.textContent = pd ? '● 下一数据帧会丢' : '丢下一数据帧';
    els.armAck.setAttribute('aria-pressed', String(Boolean(pa)));
    els.armAck.textContent = pa ? '● 下一 ACK 会丢' : '丢下一 ACK';
    put(els.sandboxStatus, 'text', pd || pa
      ? '已备好丢包：播放后下一份报文会被丢在信道里。'
      : '先发一帧，再播放看看；也可以点击在途报文直接丢掉它。');
  }

  function onPacketClick(id) {
    if (S.scenario !== 'sandbox') return;
    applyOp({ type: 'drop', id, at: S.t });
  }

  // ---------- 地址栏 ----------

  function writeLink() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    try {
      const params = new URLSearchParams();
      params.set('s', S.scenario);
      params.set('t', S.t.toFixed(2));
      history.replaceState(null, '', `#${params.toString()}`);
    } catch (e) { /* 某些本地环境不允许改写地址，演示照常可用 */ }
  }

  function scheduleWrite() {
    if (writeTimer) return;
    writeTimer = setTimeout(() => { writeTimer = null; writeLink(); }, 300);
  }

  function readLink() {
    const out = { scenario: 'normal', t: 0 };
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      const s = params.get('s');
      if ((M.SCENARIOS || []).some((x) => x.id === s)) out.scenario = s;
      const t = Number(params.get('t'));
      if (Number.isFinite(t) && t > 0) out.t = t;
    } catch (e) { /* 地址栏不可读时按默认状态开始 */ }
    return out;
  }

  // ---------- 时空轨迹（纵向真实时间） ----------

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function buildSpacetime() {
    const svg = els.spacetime;
    clearSvg(svg);
    spacetimePlayhead = null;
    const run = S.run;
    const dur = Math.max(run.duration, 0.01);
    const y0 = 74, y1 = 470;
    const Y = (t) => y0 + (t / dur) * (y1 - y0);
    const xS = 240, xR = 760;

    const defs = svgEl('defs', {}, svg);
    [['ar-data', '#3d659b'], ['ar-ack', '#2e7c64'], ['ar-fail', '#a74438']].forEach(([id, color]) => {
      const m = svgEl('marker', {
        id, viewBox: '0 0 10 10', refX: '9', refY: '5',
        markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse'
      }, defs);
      svgEl('path', { d: 'M0 0L10 5L0 10', fill: 'none', stroke: color, 'stroke-width': '1.6' }, m);
    });

    // 时间刻度
    const stepSize = dur > 60 ? 10 : dur > 30 ? 5 : 2;
    for (let t = 0; t <= dur + 0.001; t += stepSize) {
      const y = Y(t);
      svgEl('line', { class: 'st-grid', x1: xS, y1: y, x2: xR, y2: y }, svg);
      const lbl = svgEl('text', { class: 'st-grid-text', x: xS - 60, y: y + 3 }, svg);
      lbl.textContent = `${t.toFixed(0)}t`;
      svgEl('line', { class: 'st-grid', x1: xS - 54, y1: y, x2: xS - 48, y2: y }, svg);
    }

    // 两条时间轴
    svgEl('line', { class: 'st-axis', x1: xS, y1: y0 - 34, x2: xS, y2: y1 + 14 }, svg);
    svgEl('line', { class: 'st-axis', x1: xR, y1: y0 - 34, x2: xR, y2: y1 + 14 }, svg);
    const t1 = svgEl('text', { class: 'st-title', x: xS, y: y0 - 44, 'text-anchor': 'middle' }, svg);
    t1.textContent = '发送方 Sender';
    const t2 = svgEl('text', { class: 'st-title', x: xR, y: y0 - 44, 'text-anchor': 'middle' }, svg);
    t2.textContent = '接收方 Receiver';
    const s1 = svgEl('text', { class: 'st-sub', x: xS, y: y0 - 28, 'text-anchor': 'middle' }, svg);
    s1.textContent = '时间向下 ↓';
    const s2 = svgEl('text', { class: 'st-sub', x: xR, y: y0 - 28, 'text-anchor': 'middle' }, svg);
    s2.textContent = '每帧独立定时器 · 乱序缓存';

    // 独立定时器区间（沿发送方时间轴的竖条，分车道错开）
    (run.timers || []).forEach((iv) => {
      const lane = iv.seq % 5;
      const x = xS - 14 - lane * 7;
      svgEl('rect', {
        x, y: Y(iv.start), width: 5, height: Math.max(2, Y(iv.end) - Y(iv.start)),
        fill: iv.retx ? '#c98a3e' : '#dcb96a', rx: 2.5, opacity: .95
      }, svg);
    });

    // 报文轨迹
    (run.packets || []).forEach((pk) => {
      const isData = pk.dir === 'DATA';
      const x1 = isData ? xS : xR;
      const x2 = isData ? xR : xS;
      const color = pk.lost ? '#a74438'
        : pk.dir === 'NAK' ? '#a74438'
          : pk.corrupt ? '#936a2b'
            : pk.retx ? '#a74438' : (isData ? '#3d659b' : '#2e7c64');
      const y1 = Y(pk.t0), y2 = Y(pk.tEnd);
      svgEl('line', {
        x1, y1, x2, y2, stroke: color, 'stroke-width': pk.retx || pk.lost || pk.dir === 'NAK' ? 2 : 1.4,
        'marker-end': `url(#${pk.lost ? 'ar-fail' : isData ? 'ar-data' : 'ar-ack'})`,
        'stroke-dasharray': pk.lost || pk.dir === 'NAK' ? '6 4' : 'none'
      }, svg);
      const lbl = svgEl('text', {
        class: 'st-label', x: isData ? x1 + 8 : x1 - 8, y: y1 - 4,
        'text-anchor': isData ? 'start' : 'end', fill: color
      }, svg);
      lbl.textContent = isData ? (pk.retx ? `重传 ${pk.seq}` : pk.corrupt ? `出错 ${pk.seq}` : `帧 ${pk.seq}`) : `${pk.dir} ${pk.seq}`;
      if (pk.lost) {
        const mx = x1 + (x2 - x1) * 0.48, my = y1 + (y2 - y1) * 0.48;
        const x = svgEl('text', { class: 'st-label', x: mx + 6, y: my, fill: '#a74438' }, svg);
        x.textContent = '✕ 丢失';
      }
    });

    // 超时与交付标记
    run.steps.forEach((step) => {
      const ev = step.ev || {};
      if (step.kind === 'timeout') {
        svgEl('circle', { cx: xS, cy: Y(step.t), r: 5, fill: '#a74438' }, svg);
        const lbl = svgEl('text', { class: 'st-label', x: xS - 26, y: Y(step.t) + 3, 'text-anchor': 'end', fill: '#a74438' }, svg);
        lbl.textContent = `T${ev.seq} 超时`;
      } else if (step.kind === 'rx-data' && ev.outcome === 'deliver' && ev.delivered && ev.delivered.length) {
        svgEl('circle', { cx: xR, cy: Y(step.t), r: 5, fill: '#2e7c64' }, svg);
        const lbl = svgEl('text', { class: 'st-label', x: xR + 12, y: Y(step.t) + 3, fill: '#2e7c64' }, svg);
        lbl.textContent = `交付 ${ev.delivered.join('、')}`;
      } else if (step.kind === 'rx-data' && ev.outcome === 'buffer') {
        svgEl('circle', { cx: xR, cy: Y(step.t), r: 4.5, fill: '#6b5b95' }, svg);
        const lbl = svgEl('text', { class: 'st-label', x: xR + 12, y: Y(step.t) + 3, fill: '#6b5b95' }, svg);
        lbl.textContent = `缓存 ${ev.seq}`;
      }
    });

    // 图例
    const legend = svgEl('text', { class: 'st-sub', x: 40, y: 505 }, svg);
    legend.textContent = '→ 数据帧    ← ACK / NAK    金色竖条 = 各帧独立定时器区间    ● 超时    ✕ 丢失';

    // 当前时刻游标
    spacetimePlayhead = svgEl('g', { opacity: 0 }, svg);
    svgEl('line', { class: 'st-head', x1: xS - 60, y1: 0, x2: xR + 120, y2: 0 }, spacetimePlayhead);
    svgEl('circle', { cx: xS, cy: 0, r: 5, fill: '#343c38' }, spacetimePlayhead);
    svgEl('circle', { cx: xR, cy: 0, r: 5, fill: '#343c38' }, spacetimePlayhead);
    const phText = svgEl('text', { class: 'st-label', x: xR + 128, y: 4, fill: '#343c38' }, spacetimePlayhead);
    phText.textContent = '';
    spacetimePlayhead._text = phText;
    spacetimePlayhead._Y = Y;
    paintSpacetime();
  }

  function paintSpacetime() {
    if (!spacetimePlayhead) return;
    const y = spacetimePlayhead._Y(S.t);
    put(spacetimePlayhead, 'transform', `translate(0 ${fmt(y)})`);
    put(spacetimePlayhead, 'opacity', 1);
    put(spacetimePlayhead._text, 'text', `t ${S.t.toFixed(1)}`);
  }

  // ---------- 键盘与事件 ----------

  function onKey(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (el && el.closest('input, select, textarea, button, a, [contenteditable]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); stepNext(); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); stepPrev(); }
    else if (e.code === 'Home') { e.preventDefault(); replay(); }
  }

  function bind() {
    els.replay.addEventListener('click', replay);
    els.prev.addEventListener('click', stepPrev);
    els.next.addEventListener('click', stepNext);
    els.play.addEventListener('click', togglePlay);
    els.progress.addEventListener('input', (e) => { pause(); seek(Number(e.target.value)); });
    els.reduce.addEventListener('change', (e) => setReduce(e.target.checked));
    for (const b of els.speedButtons) {
      b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
    }
    for (const b of els.scenarioButtons) {
      b.addEventListener('click', () => loadScenario(b.dataset.scenario, { keepTime: true }));
    }
    els.sendOne.addEventListener('click', () => {
      if (S.scenario !== 'sandbox') return;
      applyOp({ type: 'send', at: S.t });
      stepNext();
    });
    const toggleArm = (type) => () => {
      if (S.scenario !== 'sandbox') return;
      if (armPending(type)) {
        const at = lastIndexOf(S.instructions, type);
        S.instructions = S.instructions.filter((i, k) => k !== at);
        rebuildSandbox();
      } else {
        applyOp({ type, at: S.t });
      }
    };
    els.armData.addEventListener('click', toggleArm('armData'));
    els.armAck.addEventListener('click', toggleArm('armAck'));
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && S.playing) pause();
    });
    if (reduceQuery && reduceQuery.addEventListener) {
      reduceQuery.addEventListener('change', (e) => setReduce(e.matches));
    }
  }

  function lastIndexOf(list, type) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].type === type) return i;
    return -1;
  }

  function init() {
    if (!M || !C) {
      document.body.insertAdjacentHTML('afterbegin',
        '<p style="padding:12px 16px;background:#f8e9e5;color:#a74438;font-size:13px">协议模型未能加载，演示无法运行；请检查 model.js 是否存在。</p>');
      return;
    }
    buildCells();
    buildTimers();
    buildFocusAndTags();
    bind();
    const link = readLink();
    S.scenario = link.scenario;
    loadScenario(link.scenario, { keepTime: true });
    if (link.t > 0) seek(Math.min(link.t, S.run.duration));
    els.reduce.checked = S.reduce;
    render();
  }

  init();
})();
