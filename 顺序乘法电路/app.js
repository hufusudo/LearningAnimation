/**
 * 顺序乘法电路：界面与控件。画面只由 (步, 进度) 经 choreo.js 算出，这里只负责写 DOM 与控件。
 * 时间以步为单位：当前步 i 与步内进度 p。播放时 GSAP 补间推进 p；减少动效时画面直接跳到步末终态。
 */
(function () {
  'use strict';

  const M = window.SeqMulModel;
  const C = window.SeqMulChoreo;
  const G = C.GEOM;
  const NS = 'http://www.w3.org/2000/svg';
  const STEP_SEC = 1.0;        // 1× 速下一步约 1 秒
  const LINK_DELAY = 300;      // 播放中节流写回地址栏（毫秒）
  const PRESETS = [[13, 11], [5, 3], [7, 6], [9, 13], [15, 15]];
  const hasGsap = typeof window.gsap !== 'undefined';
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  const INK = '#343C38';
  const INK2 = '#5D655F';
  const MUTED = '#6B7066';
  const BLUE = '#2563EB';
  const GREEN = '#399B7B';
  const GOLD_DEEP = '#8F6619';
  const WAIT = '#9AA096';
  const WHITE = '#FFFFFF';
  const PAPER2 = '#F5F4EE';

  // 焦点环与浮标的目标位置（舞台坐标）
  const RING_BOX = {
    mq0: { x: 772, y: 159, width: 74, height: 74 },
    alu: { x: 281, y: 281, width: 242, height: 80 },
    counter: { x: 632, y: 292, width: 276, height: 126 }
  };
  const TAG_POS = {
    probe: { x: 729, y: 260 },
    carry: { x: 566, y: 258 },
    shift: { x: 560, y: 100 },
    count: { x: 710, y: 432 }
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    layer: $('layer'),
    caption: $('caption'),
    notice: $('notice'),
    play: $('play'),
    prev: $('prev'),
    next: $('next'),
    replay: $('replay'),
    speed: $('speed'),
    speedOut: $('speed-out'),
    reduce: $('reduce'),
    scrub: $('scrub'),
    timeOut: $('time-out'),
    bar: $('stage-bar'),
    form: $('custom'),
    inX: $('in-x'),
    inY: $('in-y')
  };

  const S = {
    X: 13,
    Y: 11,
    run: null,
    i: 0,
    p: 0,
    speed: 1,
    reduce: false,
    playing: false,
    tween: null,
    linkTimer: null
  };

  // 画面元素的引用，构建后不再查找
  const V = {};

  // ───── 工具 ─────

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function clampInt(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? clamp(n, 0, 15) : 0;
  }

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(node);
    return node;
  }

  function txt(content, attrs, parent) {
    const node = el('text', attrs, parent);
    node.textContent = content;
    return node;
  }

  // 只在数值变化时写属性（避免每帧重复写入）
  const memo = new WeakMap();
  function put(node, attr, value) {
    let m = memo.get(node);
    if (!m) {
      m = new Map();
      memo.set(node, m);
    }
    const v = String(value);
    if (m.get(attr) === v) return;
    m.set(attr, v);
    node.setAttribute(attr, v);
  }

  function setText(node, s) {
    if (node.textContent !== s) node.textContent = s;
  }

  // 两个十六进制颜色按 t 线性混合
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (s) => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
    const A = ch(pa);
    const B = ch(pb);
    const out = A.map((v, k) => Math.round(v + (B[k] - v) * t));
    return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  // 标签宽度按字符估算：中文约 13px，其余约 7px
  function textWidth(s) {
    let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 255 ? 13 : 7.2;
    return w;
  }

  // ───── 静态舞台（只构建一次）─────

  function build() {
    const L = els.layer;
    const defs = el('defs', {}, L);
    const marker = el('marker', { id: 'arrow', markerWidth: 8, markerHeight: 8, refX: 8, refY: 4, orient: 'auto', markerUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M0,0 L8,4 L0,8 Z', fill: INK }, marker);

    // 1. 轮廓（A3）与分界线：联合右移时圈出整链，分界线是 ACC₀ 跨界的位置
    V.contour = el('rect', { x: 178, y: 160, width: 670, height: 72, rx: 12, fill: 'none', stroke: BLUE, 'stroke-width': 1.5, 'stroke-dasharray': '6 5', opacity: 0 }, L);
    el('path', { d: 'M550,158 L550,234', fill: 'none', stroke: WAIT, 'stroke-width': 1.5, 'stroke-dasharray': '3 4' }, L);
    V.seam = el('path', { d: 'M550,158 L550,234', fill: 'none', stroke: BLUE, 'stroke-width': 3, opacity: 0 }, L);

    // 2. 连线：基线常驻，蓝色覆盖线按进度描边生长（E1）
    const wire = (d, extra) => el('path', Object.assign({ d, fill: 'none', stroke: INK, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, extra || {}), L);
    const overlay = (d) => el('path', { d, fill: 'none', stroke: BLUE, 'stroke-width': 3, 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1, opacity: 0 }, L);

    const EN = 'M900,330 L930,330 L930,122 L187,122';
    wire(EN);
    wire('M402,122 L402,163', { 'marker-end': 'url(#arrow)' });
    wire('M698,122 L698,163', { 'marker-end': 'url(#arrow)' });
    V.enOver = overlay(EN);
    wire('M300,226 L300,289', { 'marker-end': 'url(#arrow)' });           // ACC 反馈到 ALU
    wire('M500,290 L500,227', { 'marker-end': 'url(#arrow)' });           // ALU 和写回 ACC
    wire('M402,420 L402,353', { 'marker-end': 'url(#arrow)' });           // X 总线
    wire('M640,330 L489,330', { 'marker-end': 'url(#arrow)' });           // 加法使能 “+”
    V.plusOver = overlay('M640,330 L489,330');
    V.sumOver = overlay('M500,290 L500,227');
    wire('M809,226 L809,299', { 'marker-end': 'url(#arrow)' });           // MQ₀ 探测线
    wire('M1040,370 L901,370', { 'marker-end': 'url(#arrow)' });          // CLK

    // 3. 链：Cout、ACC、MQ 与移出位，同一节距排成一行
    txt('Cout', { x: G.slotX[0], y: G.chainY - 10, class: 'label', fill: INK2 }, L);
    txt('ACC', { x: G.slotX[1], y: G.chainY - 10, class: 'label', fill: INK2 }, L);
    txt('MQ', { x: G.slotX[5], y: G.chainY - 10, class: 'label', fill: INK2 }, L);
    txt('移出', { x: G.slotX[9], y: G.chainY - 10, class: 'label', fill: MUTED }, L);
    txt('EN, >>', { x: 196, y: 110, class: 'label', fill: INK2 }, L);

    V.cells = [];
    V.bits = [];
    for (let k = 0; k < 9; k++) {
      V.cells.push(el('rect', { x: G.slotX[k], y: G.chainY, width: G.cell, height: G.cell, rx: 8, fill: WHITE, stroke: INK2, 'stroke-width': 1.5 }, L));
      V.bits.push(txt('', { x: G.slotX[k] + G.cell / 2, y: G.chainY + G.cell / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'bit', fill: INK }, L));
    }
    el('rect', { x: G.slotX[9], y: G.chainY, width: G.cell, height: G.cell, rx: 8, fill: 'none', stroke: WAIT, 'stroke-width': 1.5, 'stroke-dasharray': '6 5' }, L);

    // 4. X 寄存器（输入色）与 ALU
    txt('被乘数 X', { x: 246, y: 452, 'text-anchor': 'end', class: 'label', fill: INK2 }, L);
    V.xBits = [];
    for (let j = 0; j < 4; j++) {
      const x = G.slotX[1 + j];
      el('rect', { x, y: 420, width: G.cell, height: G.cell, rx: 8, fill: WHITE, stroke: GREEN, 'stroke-width': 2 }, L);
      V.xBits.push(txt('', { x: x + G.cell / 2, y: 450, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'bit', fill: INK }, L));
    }
    V.alu = el('polygon', { points: '290,290 514,290 474,352 330,352', fill: WHITE, stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }, L);
    txt('ALU', { x: G.aluCx, y: 326, 'text-anchor': 'middle', class: 'alu-text', fill: INK }, L);

    // 5. 控制逻辑与计数器
    el('rect', { x: 640, y: 300, width: 260, height: 110, rx: 12, fill: PAPER2, stroke: INK, 'stroke-width': 1.5 }, L);
    txt('控制逻辑 · 计数器', { x: 770, y: 330, 'text-anchor': 'middle', class: 'label', fill: INK2 }, L);
    V.counter = txt('', { x: 770, y: 384, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'counter-text', fill: INK }, L);
    txt('+', { x: 566, y: 324, 'text-anchor': 'middle', class: 'plus-text', fill: INK }, L);
    txt('MQ₀', { x: 818, y: 262, class: 'label', fill: INK2 }, L);
    txt('CLK', { x: 1000, y: 362, 'text-anchor': 'middle', class: 'label', fill: INK2 }, L);

    // 6. 位块（B1）：0–8 为联合右移的位块，9 为加法时飞入 ALU 的 X 字
    V.chips = [];
    for (let j = 0; j < 10; j++) {
      const g = el('g', { visibility: 'hidden', opacity: 0 }, L);
      const rect = el('rect', { x: 0, y: 0, width: G.chipW, height: G.chipH, rx: 8, fill: BLUE }, g);
      const label = txt('', { x: G.chipW / 2, y: G.chipH / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'chip-text', fill: WHITE }, g);
      V.chips.push({ g, rect, label });
    }

    // 7. 焦点环（A1）、浮标（D1）、结果行（E3）
    V.ring = el('rect', { x: 0, y: 0, width: 0, height: 0, rx: 12, fill: 'none', stroke: BLUE, 'stroke-width': 2.5, opacity: 0 }, L);
    V.tag = el('g', { visibility: 'hidden', opacity: 0 }, L);
    V.tagRect = el('rect', { x: 0, y: -12, width: 0, height: 24, rx: 12, fill: WHITE, stroke: BLUE, 'stroke-width': 1.2 }, V.tag);
    V.tagText = txt('', { x: 0, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'tag-text', fill: BLUE }, V.tag);
    const clip = el('clipPath', { id: 'result-clip' }, defs);
    V.resultClip = el('rect', { x: 150, y: 470, width: 0, height: 34 }, clip);
    V.result = txt('', { x: 550, y: 494, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'result-text', fill: GOLD_DEEP, 'clip-path': 'url(#result-clip)' }, L);

    // 8. 舞台左上：状态灯、拍数；右上：输入算式
    V.dot = el('circle', { cx: 34, cy: 34, r: 6, fill: WAIT }, L);
    V.title = txt('', { x: 50, y: 39, class: 'status-title', fill: INK }, L);
    V.cycle = txt('', { x: 34, y: 88, class: 'status-cycle', fill: INK2 }, L);
    V.formula = txt('', { x: 1066, y: 40, 'text-anchor': 'end', class: 'formula', fill: INK2 }, L);
    V.formulaY = txt('', { x: 1066, y: 62, 'text-anchor': 'end', class: 'formula', fill: INK2 }, L);
  }

  // ───── 每次参数变化后写入的静态信息 ─────

  function fillStatic() {
    const { X, Y, product } = S.run;
    const bitsOf = (v) => M.bitsOf(v, 4).join('');
    V.xBits.forEach((node, j) => setText(node, String(S.run.steps[0].x[j])));
    setText(V.formula, `被乘数 X = ${bitsOf(X)} (${X})`);
    setText(V.formulaY, `乘数 Y = ${bitsOf(Y)} (${Y})`);
    V.resultText = `积 = ${M.bitsOf(product >> 4, 4).join('')} ${M.bitsOf(product & 15, 4).join('')} = ${product}`;
    setText(V.result, V.resultText);
  }

  // ───── 画面 ─────

  function paintWire(node, w) {
    put(node, 'stroke-dashoffset', (1 - w.draw).toFixed(4));
    put(node, 'opacity', w.alpha.toFixed(4));
  }

  function paintTag(tg) {
    if (!tg.text || tg.alpha <= 0.001) {
      put(V.tag, 'visibility', 'hidden');
      return;
    }
    put(V.tag, 'visibility', 'visible');
    put(V.tag, 'opacity', tg.alpha.toFixed(4));
    if (V.tagText.textContent !== tg.text) {
      const w = textWidth(tg.text) + 22;
      setText(V.tagText, tg.text);
      put(V.tagRect, 'x', (-w / 2).toFixed(2));
      put(V.tagRect, 'width', w.toFixed(2));
    }
    const at = TAG_POS[tg.at];
    put(V.tag, 'transform', `translate(${at.x} ${(at.y + tg.dy).toFixed(2)})`);
  }

  function paint(f, step) {
    put(V.contour, 'opacity', f.contour.alpha.toFixed(4));
    put(V.seam, 'opacity', f.seam.lit.toFixed(4));
    paintWire(V.enOver, f.wires.en);
    paintWire(V.plusOver, f.wires.plus);
    paintWire(V.sumOver, f.wires.sum);

    put(V.alu, 'fill', mix(WHITE, '#E3ECFD', f.alu.lit));
    put(V.alu, 'stroke', mix(INK, BLUE, f.alu.lit));

    for (let k = 0; k < 9; k++) {
      const s = f.slots[k];
      setText(V.bits[k], s.text);
      put(V.bits[k], 'opacity', s.alpha.toFixed(4));
      put(V.cells[k], 'fill', mix(WHITE, '#F3E4C2', s.tint));
    }

    f.chips.forEach((c, j) => {
      const node = V.chips[j];
      if (c.alpha <= 0.001) {
        put(node.g, 'visibility', 'hidden');
        return;
      }
      put(node.g, 'visibility', 'visible');
      put(node.g, 'opacity', c.alpha.toFixed(4));
      put(node.g, 'transform', `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)})`);
      put(node.rect, 'width', c.w);
      put(node.label, 'x', c.w / 2);
      setText(node.label, c.text);
    });

    const box = RING_BOX[f.ring.target];
    if (box) {
      put(V.ring, 'x', box.x);
      put(V.ring, 'y', box.y);
      put(V.ring, 'width', box.width);
      put(V.ring, 'height', box.height);
    }
    put(V.ring, 'opacity', f.ring.alpha.toFixed(4));

    setText(V.counter, `C = ${f.counter.text}`);
    put(V.counter, 'opacity', f.counter.alpha.toFixed(4));
    put(V.counter, 'transform', `translate(0 ${f.counter.dy.toFixed(2)})`);

    paintTag(f.tag);
    put(V.resultClip, 'width', (800 * f.result.clip).toFixed(2));

    setText(V.title, step.title);
    setText(V.cycle, `${step.cycle} / ${S.run.n}`);
    put(V.dot, 'fill', S.playing ? BLUE : WAIT);
    V.dot.classList.toggle('is-running', S.playing);
    setText(els.caption, step.caption);
  }

  // 第几步与步内进度 → 画面（减少动效时只给出起态与终态，不给中间帧）
  function render() {
    const steps = S.run.steps;
    const shown = S.reduce ? (S.p > 0 ? 1 : 0) : S.p;
    const step = steps[S.i];
    const prev = S.i > 0 ? steps[S.i - 1] : null;
    paint(C.frame(step, shown, prev), step);
    paintControls();
  }

  function paintControls() {
    const len = S.run.steps.length;
    setText(els.timeOut, `第 ${Math.min(S.i + 1, len)} / ${len} 步`);
    const v = (S.i + S.p).toFixed(2);
    if (els.scrub.value !== v) els.scrub.value = v;
    setText(els.play, S.playing ? '‖ 暂停' : '▶ 播放');
    els.speedOut.textContent = `${S.speed.toFixed(1)}×`;
    els.reduce.checked = S.reduce;
    els.bar.querySelectorAll('.step').forEach((b) => {
      const idx = Number(b.dataset.i);
      const state = idx < S.i ? 'passed' : (idx === S.i ? 'current' : 'future');
      if (b.dataset.state !== state) {
        b.dataset.state = state;
        if (state === 'current') b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
      }
    });
  }

  // ───── 推演与导航 ─────

  function buildBar() {
    els.bar.textContent = '';
    let group = null;
    let key = null;
    S.run.steps.forEach((st, idx) => {
      const k = st.kind === 'init' ? 'init' : (st.kind === 'done' ? 'done' : `c${st.cycle}`);
      if (k !== key) {
        key = k;
        group = document.createElement('div');
        group.className = 'cycle';
        const label = document.createElement('span');
        label.className = 'cycle-label';
        label.textContent = st.kind === 'init' ? '初始' : (st.kind === 'done' ? '结束' : `第 ${st.cycle} 拍`);
        group.appendChild(label);
        els.bar.appendChild(group);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'step';
      b.dataset.i = String(idx);
      b.textContent = st.phase;
      b.setAttribute('aria-label', st.title);
      b.addEventListener('click', () => {
        S.playing = false;
        goTo(idx, 0);
      });
      group.appendChild(b);
    });
  }

  function writeLinkNow() {
    clearTimeout(S.linkTimer);
    S.linkTimer = null;
    try {
      const q = new URLSearchParams({ x: String(S.X), y: String(S.Y), t: (S.i + S.p).toFixed(2) });
      history.replaceState(null, '', `#${q.toString()}`);
    } catch (e) {
      // 某些本地环境不允许改写地址，演示照常可用
    }
  }

  function scheduleLink() {
    if (!S.linkTimer) S.linkTimer = setTimeout(writeLinkNow, LINK_DELAY);
  }

  function readLink() {
    const out = { X: 13, Y: 11, t: 0 };
    try {
      const q = new URLSearchParams(location.hash.slice(1));
      const x = q.has('x') ? Number(q.get('x')) : NaN;
      const y = q.has('y') ? Number(q.get('y')) : NaN;
      const t = q.has('t') ? Number(q.get('t')) : NaN;
      if (Number.isInteger(x) && x >= 0 && x <= 15) out.X = x;
      if (Number.isInteger(y) && y >= 0 && y <= 15) out.Y = y;
      if (Number.isFinite(t) && t > 0) out.t = t;
    } catch (e) {
      // 地址栏不可读时按默认状态开始
    }
    return out;
  }

  function killTween() {
    if (S.tween) {
      S.tween.kill();
      S.tween = null;
    }
  }

  // 跳到第 i 步的第 p 进度，并停止播放；所有画面由 render 按这两个数重算。地址栏节流写回（拖动时不逐次改写）
  function goTo(i, p) {
    killTween();
    S.i = clamp(Math.floor(Number(i)) || 0, 0, S.run.steps.length - 1);
    S.p = clamp(Number(p) || 0, 0, 1);
    render();
    scheduleLink();
  }

  function pause() {
    S.playing = false;
    if (S.tween) S.tween.pause();
    render();
    writeLinkNow();
  }

  function play() {
    if (!hasGsap || !S.run) return;
    const last = S.run.steps.length - 1;
    if (S.i === last && S.p >= 1) goTo(0, 0);
    S.playing = true;
    if (S.tween) S.tween.play();
    else animateStep();
    render();
  }

  function togglePlay() {
    if (S.playing) pause();
    else play();
  }

  // 补间推进当前步的进度；减少动效时不做补间，直接跳到步末终态并停留一个步长
  function animateStep() {
    killTween();
    if (S.reduce) {
      S.p = 1;
      render();
      scheduleLink();
      S.tween = window.gsap.delayedCall(STEP_SEC, finishStep);
      S.tween.timeScale(S.speed);
      return;
    }
    const obj = { p: S.p };
    S.tween = window.gsap.to(obj, {
      p: 1,
      duration: STEP_SEC * (1 - S.p),
      ease: 'none',
      onUpdate: () => {
        S.p = obj.p;
        render();
        scheduleLink();
      },
      onComplete: finishStep
    });
    S.tween.timeScale(S.speed);
  }

  // 一步结束：进入下一步起点（仍在播放时接着播），末步结束则停在终态
  function finishStep() {
    S.tween = null;
    S.i += 1;
    S.p = 0;
    const last = S.run.steps.length - 1;
    if (S.i > last) {
      S.i = last;
      S.p = 1;
      S.playing = false;
    }
    render();
    if (S.playing) animateStep();
    else writeLinkNow();
  }

  // 下一步：一步正在进行时直接到下一步起点；否则把本步播完、停在下一步起点
  function stepNext() {
    if (!S.run) return;
    const last = S.run.steps.length - 1;
    if (S.i === last && S.p >= 1) return;
    S.playing = false;
    if (S.p > 0 || !hasGsap) {
      if (S.i + 1 > last) goTo(last, 1);
      else goTo(S.i + 1, 0);
      return;
    }
    animateStep();
  }

  function stepPrev() {
    if (!S.run) return;
    S.playing = false;
    goTo(S.p > 0 ? S.i : Math.max(0, S.i - 1), 0);
  }

  function replay() {
    S.playing = false;
    goTo(0, 0);
  }

  function setSpeed(v) {
    S.speed = v;
    if (S.tween) S.tween.timeScale(v);
    render();
  }

  function setReduce(v) {
    S.reduce = Boolean(v);
    document.body.dataset.motion = S.reduce ? 'reduce' : 'full';
    if (S.run) render();
  }

  // 改参数：保留当前时刻（超出新长度则取末尾），并暂停，便于对比改动前后的同一时刻
  function applyParams(X, Y, tau) {
    S.playing = false;
    killTween();
    S.X = X;
    S.Y = Y;
    S.run = M.buildTrace(X, Y, 4);
    buildBar();
    fillStatic();
    els.scrub.max = String(S.run.steps.length);
    els.inX.value = String(X);
    els.inY.value = String(Y);
    document.querySelectorAll('[data-x]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.x) === X && Number(b.dataset.y) === Y));
    });
    const at = C.locate(S.run.steps.length, tau);
    goTo(at.i, at.p);
  }

  function onKey(e) {
    const t = e.target;
    if (t instanceof Element && t.closest('input, select, textarea, button, a, [contenteditable]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      stepNext();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      stepPrev();
    } else if (e.code === 'Home') {
      e.preventDefault();
      replay();
    }
  }

  function bind() {
    els.play.addEventListener('click', togglePlay);
    els.prev.addEventListener('click', stepPrev);
    els.next.addEventListener('click', stepNext);
    els.replay.addEventListener('click', replay);
    els.speed.addEventListener('input', (e) => setSpeed(Number(e.target.value)));
    els.reduce.addEventListener('change', (e) => setReduce(e.target.checked));
    els.scrub.addEventListener('input', (e) => {
      S.playing = false;
      const at = C.locate(S.run.steps.length, Number(e.target.value));
      goTo(at.i, at.p);
    });
    document.querySelectorAll('[data-x]').forEach((b) => {
      b.addEventListener('click', () => applyParams(Number(b.dataset.x), Number(b.dataset.y), S.i + S.p));
    });
    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      applyParams(clampInt(els.inX.value), clampInt(els.inY.value), S.i + S.p);
    });
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && S.playing) pause();
    });
    if (motionQuery && motionQuery.addEventListener) {
      motionQuery.addEventListener('change', (e) => setReduce(e.matches));
    }
  }

  function init() {
    build();
    if (!hasGsap) {
      els.play.disabled = true;
      els.notice.hidden = false;
      els.notice.textContent = '未能加载动画引擎（GSAP），播放已停用；单步、时刻滑块与参数仍可用。';
    }
    setReduce(motionQuery ? motionQuery.matches : false);
    bind();
    const link = readLink();
    applyParams(link.X, link.Y, link.t);
  }

  init();
})();
