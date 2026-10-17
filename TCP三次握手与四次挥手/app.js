/**
 * TCP 三次握手与四次挥手演示 · 舞台渲染与控件
 * 画面只由时刻 t 决定（Model.sample）；GSAP 仅推进时钟，暂停、拖动、单步都走同一条渲染路径。
 * 纵轴是连续的时间：报文从发出时刻的生命线斜向到达对方在到达时刻的生命线。
 */

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HOLD_SECONDS = 0.9;               // 减少动效：每个边界停留的时长（1× 速度）

  /* ==========================================================================
     1. 版面常量（viewBox 1100 × 600）
     ========================================================================== */

  const LIFE = { c: 400, s: 700 };        // 两条生命线的横坐标
  const TOP_Y = 112;                      // 生命线顶端（卡片之下）
  const BOTTOM_Y = 566;                   // 生命线底端
  const Y0 = 140;                         // 时刻 0 的纵坐标
  const PX_PER_S = 70;                    // 时间比例尺：每秒的纵向像素（斜线的纵向跨度即传输时间）
  const RULER_X = 54;                     // 时间标尺的竖线
  const PILL_OFFSET = 13;                 // 报文标签离开斜线的距离
  const BADGE_CX = 550;                   // 里程碑徽章（连接建立 / 释放）中心，位于舞台底部
  const BADGE_Y = 548;
  const TUBE = { x: 990, y: 150, w: 80, h: 310, pad: 4, total: 50, slide: -120 };
  const COUNT_TRACK = 88;

  /* 颜色：报文线条用语义色；白字色块与标签中的亮灯用深色变体（对比度 ≥ 4.5） */
  const KIND = {
    SYN: '#2563EB', SYNACK: '#1D4ED8', ACK: '#399B7B', FIN: '#BF8C32', FINACK: '#B7791F', DATA: '#5D655F'
  };
  const LIT = { SYN: '#1D4ED8', ACK: '#2D7D62', FIN: '#8F6619' };

  const AMBER = { line: '#D97706', bg: '#FFFBEB', bd: '#FCD34D', text: '#B45309' };
  const ROSE = { line: '#E11D48', bg: '#FFF1F2', bd: '#FDA4AF', text: '#BE123C' };
  const STATE_STYLE = {
    'CLOSED': { line: '#A8A29E', bg: '#F4F3EE', bd: '#D6D3CD', text: '#57534E' },
    'LISTEN': { line: '#2563EB', bg: '#EFF6FF', bd: '#93C5FD', text: '#1D4ED8' },
    'SYN-SENT': AMBER,
    'SYN-RCVD': AMBER,
    'ESTABLISHED': { line: '#059669', bg: '#ECFDF5', bd: '#6EE7B7', text: '#047857' },
    'FIN-WAIT-1': AMBER,
    'FIN-WAIT-2': AMBER,
    'CLOSE-WAIT': AMBER,
    'LAST-ACK': ROSE,
    'TIME-WAIT': ROSE
  };
  const DEFAULT_STATE = STATE_STYLE.CLOSED;

  const DESC = {
    handshake: '时序图纵轴为时间：SYN、SYN+ACK、ACK 三条斜线分别从发出时刻出发，经过一个单程时延到达对方；到达时对方进入新状态。',
    wave: '时序图纵轴为时间：FIN、ACK、两段数据、FIN+ACK 与最终 ACK 依次斜向传播。服务端积压数据发完后才发 FIN，客户端在 TIME-WAIT 等待 2MSL，随后连接释放。'
  };

  /* ==========================================================================
     2. 小工具：SVG 元素、只在变化时写入的属性与文字
     ========================================================================== */

  function svgEl(name, attrs, parent) {
    const node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(key => node.setAttribute(key, attrs[key]));
    if (parent) parent.appendChild(node);
    return node;
  }

  /* 默认 fill 只是属性；需要语义色时由 CSS 类或后续的 put 覆盖 */
  function svgText(parent, x, y, text, attrs) {
    const node = svgEl('text', Object.assign({ x, y, fill: '#343C38' }, attrs || {}), parent);
    node.textContent = text;
    return node;
  }

  function put(node, name, value) {
    const cache = node.__attrs || (node.__attrs = {});
    if (cache[name] === value) return;
    cache[name] = value;
    node.setAttribute(name, value);
  }

  function putText(node, value) {
    if (node.__text === value) return;
    node.__text = value;
    node.textContent = value;
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  /* 把斜线角度折到 (-90°, 90°)，使标签的文字始终从左向右读 */
  function readableAngle(deg) {
    if (deg > 90) return deg - 180;
    if (deg < -90) return deg + 180;
    return deg;
  }

  /* ==========================================================================
     3. 控制器：时钟、控件、地址栏
     ========================================================================== */

  class TCPDemo {
    constructor() {
      const $ = id => document.getElementById(id);
      this.dom = {
        svg: $('stage'),
        explain: $('explanation'),
        btnRestart: $('btn-restart'),
        btnPrev: $('btn-prev'),
        btnNext: $('btn-next'),
        btnPlay: $('btn-play'),
        playText: $('play-text'),
        playIcon: $('play-icon'),
        speed: $('speed'),
        speedOut: $('speed-out'),
        reduce: $('reduce-motion'),
        phaseBar: $('phase-bar'),
        scrub: $('scrub'),
        timeOut: $('time-out'),
        notice: $('notice'),
        modeBtns: Array.from(document.querySelectorAll('.mode-btn'))
      };
      this.speed = 1;
      this.reduce = false;
      this.userSetMotion = false;
      this.playing = false;
      this.t = 0;
      this.clock = { t: 0 };
      this.tween = null;
      this.reduceTimer = null;
      this.hashTimer = null;
      this.gsapOK = typeof window.gsap !== 'undefined';
      this.el = null;
      this.phaseBtns = [];
    }

    init() {
      this.bindControls();
      this.initMotion();
      const initial = this.readHash();
      this.setMode(initial.mode, { t: initial.t });
      if (!this.gsapOK) {
        this.dom.btnPlay.disabled = true;
        this.dom.notice.hidden = false;
      }
      this.updateControls();
    }

    /* ---------------------------------------------------- 模式与舞台 */

    setMode(modeId, options) {
      const opts = options || {};
      this.pause();
      this.modeId = modeId;
      this.seq = window.TCPHandshakeModel.buildSequence(modeId);
      this.buildStage();
      this.buildPhaseBar();
      this.dom.scrub.max = String(this.seq.duration);
      this.dom.modeBtns.forEach(btn => {
        btn.setAttribute('aria-pressed', String(btn.dataset.mode === modeId));
      });
      this.setTime(opts.t || 0);
      this.updateControls();
      this.writeHash(true);
    }

    /* 时刻到纵坐标：线性比例尺，斜线的纵向跨度即传输时间 */
    yOfTime(t) {
      return Y0 + PX_PER_S * t;
    }

    buildStage() {
      const svg = this.dom.svg;
      const seq = this.seq;
      Array.from(svg.children).forEach(node => {
        if (node.tagName !== 'title' && node.tagName !== 'desc') node.remove();
      });
      svg.querySelector('desc').textContent = DESC[seq.id];

      const layer = name => svgEl('g', { class: name }, svg);
      const L = {
        ruler: layer('layer-ruler'),
        life: layer('layer-life'),
        bands: layer('layer-bands'),
        msgs: layer('layer-msgs'),
        tube: layer('layer-tube'),
        count: layer('layer-count'),
        milestone: layer('layer-milestone'),
        cards: layer('layer-cards'),
        status: layer('layer-status')
      };
      this.el = {
        bands: { c: [], s: [] },
        halos: { c: [], s: [] },
        labels: { c: [], s: [] },
        msgs: {},
        card: {},
        chunks: [],
        milestone: null
      };

      this.buildStatus(L.status);
      this.buildCards(L.cards);
      this.buildRuler(L.ruler);
      this.buildLifelines(L.life);
      this.buildBands(L.bands);
      this.buildMessages(L.msgs);
      if (seq.buffer) this.buildTube(L.tube);
      if (seq.countdown) this.buildCountdown(L.count);
      this.buildMilestone(L.milestone);
    }

    buildStatus(group) {
      this.el.led = svgEl('circle', { cx: 30, cy: 26, r: 5, class: 'led' }, group);
      this.el.statusStep = svgText(group, 44, 31, '', { class: 'status-step' });
      this.el.statusPhase = svgText(group, 24, 56, '', { class: 'status-phase' });
      this.el.statusSub = svgText(group, 24, 76, '', { class: 'status-sub' });
    }

    buildCards(group) {
      const hosts = {
        c: { badge: 'C', name: '客户端 Client', addr: '10.0.0.2 : 51042' },
        s: { badge: 'S', name: '服务端 Server', addr: '10.0.0.1 : 80' }
      };
      ['c', 's'].forEach(side => {
        const host = hosts[side];
        const x = LIFE[side] - 125;
        svgEl('rect', { x, y: 18, width: 250, height: 86, rx: 14, class: 'card-bg' }, group);
        svgEl('circle', { cx: x + 24, cy: 44, r: 12, class: 'badge-bg' }, group);
        svgText(group, x + 24, 48.5, host.badge, { class: 'badge-text', 'text-anchor': 'middle' });
        svgText(group, x + 46, 40, host.name, { class: 'card-name' });
        svgText(group, x + 46, 58, host.addr, { class: 'card-addr' });
        const chipBg = svgEl('rect', { x: x + 14, y: 66, width: 124, height: 22, rx: 11, 'stroke-width': 1 }, group);
        const chipText = svgText(group, x + 76, 81, '', { class: 'state-chip-text', 'text-anchor': 'middle' });
        svgText(group, x + 166, 81, 'seq', { class: 'seq-label', 'text-anchor': 'end' });
        const seqValue = svgText(group, x + 236, 83, '', { class: 'seq-value', 'text-anchor': 'end' });
        this.el.card[side] = { chipBg, chipText, seqValue };
      });
    }

    /* 时间标尺：每 0.5 s 一个刻度，整秒有数字；整秒处的浅色虚线帮助对照斜线的端点 */
    buildRuler(group) {
      const last = this.seq.steps.reduce((max, step) => Math.max(max, step.end), 0);
      const maxT = Math.min(last + 0.2, (BOTTOM_Y - Y0) / PX_PER_S);
      svgText(group, RULER_X, Y0 - 16, 't / s', { class: 'ruler-title', 'text-anchor': 'middle' });
      svgEl('line', { x1: RULER_X, y1: Y0, x2: RULER_X, y2: this.yOfTime(maxT), class: 'ruler' }, group);
      for (let t = 0; t <= maxT + 1e-9; t += 0.5) {
        const y = this.yOfTime(t);
        const major = Math.abs(t - Math.round(t)) < 1e-9;
        svgEl('line', { x1: RULER_X - (major ? 9 : 5), y1: y, x2: RULER_X, y2: y, class: 'ruler' }, group);
        if (major) {
          svgText(group, RULER_X - 14, y + 4, `${Math.round(t)} s`, { class: 'ruler-label', 'text-anchor': 'end' });
          if (t > 0) {
            svgEl('line', { x1: RULER_X + 10, y1: y, x2: 976, y2: y, class: 'guide-sec' }, group);
          }
        }
      }
    }

    buildLifelines(group) {
      ['c', 's'].forEach(side => {
        svgEl('line', {
          x1: LIFE[side], y1: TOP_Y, x2: LIFE[side], y2: BOTTOM_Y, class: 'lifeline'
        }, group);
      });
    }

    /* 生命线色带：每段对应一种状态；段开始的时刻（发出或到达）写段名与时刻，段名固定在段的起点 */
    buildBands(group) {
      ['c', 's'].forEach(side => {
        const changes = this.seq.stateChanges[side];
        changes.forEach((change, i) => {
          const style = STATE_STYLE[change.state] || DEFAULT_STATE;
          const halo = svgEl('rect', {
            x: LIFE[side] - 11, y: TOP_Y, width: 22, height: 0, class: 'halo', visibility: 'hidden'
          }, group);
          const band = svgEl('rect', {
            x: LIFE[side] - 4, y: TOP_Y, width: 8, height: 0, fill: style.line,
            visibility: 'hidden', opacity: 0.92
          }, group);
          this.el.halos[side].push(halo);
          this.el.bands[side].push(band);

          const anchorEnd = side === 'c';
          const x = anchorEnd ? LIFE.c - 14 : LIFE.s + 14;
          const y = i === 0 ? 124 : this.yOfTime(change.at) + 4;
          const text = i === 0 ? change.state : `${change.state} · ${change.at.toFixed(1)} s`;
          const label = svgText(group, x, y, text, {
            class: 'state-label',
            fill: style.text,
            'text-anchor': anchorEnd ? 'end' : 'start',
            visibility: 'hidden'
          });
          this.el.labels[side].push(label);
        });
      });
    }

    /* 每条报文是一条斜线：从发出时刻的生命线到达时刻的对方生命线 */
    buildMessages(group) {
      this.seq.messages.forEach(msg => {
        const color = KIND[msg.kind] || KIND.DATA;
        const c2s = msg.dir === 'c2s';
        const x0 = c2s ? LIFE.c : LIFE.s;
        const x1 = c2s ? LIFE.s : LIFE.c;
        const y0 = this.yOfTime(msg.start);
        const y1 = this.yOfTime(msg.end);
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        const ux = dx / len;
        const uy = dy / len;
        /* 标签取斜线上方的那一侧 */
        let nx = dy / len;
        let ny = -dx / len;
        if (ny > 0) { nx = -nx; ny = -ny; }

        const flash = svgEl('line', {
          x1: x0, y1: y0, x2: x1, y2: y1, stroke: color, class: 'flash', visibility: 'hidden'
        }, group);
        svgEl('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'guide' }, group);
        const glow = svgEl('line', {
          x1: x0, y1: y0, x2: x0, y2: y0, stroke: color, class: 'glow', visibility: 'hidden'
        }, group);
        const trail = svgEl('line', {
          x1: x0, y1: y0, x2: x0, y2: y0, stroke: color, class: 'trail', visibility: 'hidden'
        }, group);
        const head = svgEl('polygon', { fill: color, visibility: 'hidden' }, group);
        const pill = this.buildPill(group, msg,
          (x0 + x1) / 2 + nx * PILL_OFFSET,
          (y0 + y1) / 2 + ny * PILL_OFFSET,
          readableAngle(Math.atan2(dy, dx) * 180 / Math.PI));

        this.el.msgs[msg.id] = {
          x0, y0, x1, y1, dx, dy, ux, uy, flash, glow, trail, head, pill
        };
      });
    }

    /* 报文标签：一行写清亮灯的标志位与 seq / ack / len，斜向放在线的上方 */
    buildPill(group, msg, cx, cy, angle) {
      const node = svgEl('g', {
        transform: `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${angle.toFixed(2)})`,
        visibility: 'hidden'
      }, group);
      const flags = [
        { key: 'SYN', on: msg.flags.syn },
        { key: 'ACK', on: msg.flags.ack },
        { key: 'FIN', on: msg.flags.fin }
      ];
      const ackText = msg.ack != null ? String(msg.ack) : '—';
      const tail = `  seq=${msg.seq}  ack=${ackText}  len=${msg.len}`;
      const flagText = flags.map(flag => flag.key).join(' ');
      const width = (flagText.length + tail.length) * 6.6 + 18;
      svgEl('rect', { x: -width / 2, y: -9, width, height: 18, rx: 9, class: 'pill-bg' }, node);
      const text = svgEl('text', { x: 0, y: 4, 'text-anchor': 'middle', class: 'pill-text' }, node);
      flags.forEach((flag, i) => {
        const span = svgEl('tspan', {
          fill: flag.on ? LIT[flag.key] : '#8A8E84',
          'font-weight': flag.on ? 700 : 500
        }, text);
        span.textContent = (i > 0 ? ' ' : '') + flag.key;
      });
      const rest = svgEl('tspan', { fill: '#343C38' }, text);
      rest.textContent = tail;
      return node;
    }

    /* 积压管：数据块按 FIFO 从下往上排，离开时整体向左滑出并淡出 */
    buildTube(group) {
      svgText(group, TUBE.x + TUBE.w / 2, TUBE.y - 12, '待发数据 Buffer', {
        class: 'tube-title', 'text-anchor': 'middle'
      });
      svgEl('rect', { x: TUBE.x, y: TUBE.y, width: TUBE.w, height: TUBE.h, rx: 10, class: 'tube-frame' }, group);
      this.el.chunks = this.seq.buffer.chunks.map(chunk => {
        const height = chunk.len / TUBE.total * TUBE.h;
        const node = svgEl('g', { visibility: 'hidden' }, group);
        svgEl('rect', { x: 0, y: 0, width: TUBE.w - TUBE.pad * 2, height, rx: 6, class: 'chunk-rect' }, node);
        svgText(node, (TUBE.w - TUBE.pad * 2) / 2, height / 2 + 4, `${chunk.len} B`, {
          class: 'chunk-text', 'text-anchor': 'middle'
        });
        return { node, height };
      });
      this.el.tubeNote = svgText(group, TUBE.x + TUBE.w / 2, TUBE.y + TUBE.h + 18, '', {
        class: 'tube-note', 'text-anchor': 'middle'
      });
    }

    /* 2MSL 倒计时：位于客户端 TIME-WAIT 段的右侧，TIME-WAIT 段内 */
    buildCountdown(group) {
      const node = svgEl('g', {
        transform: `translate(${LIFE.c + 12} ${(this.yOfTime(4.5) + 12).toFixed(2)})`,
        visibility: 'hidden'
      }, group);
      this.el.countLabel = svgText(node, 0, 10, '', { class: 'count-label' });
      this.el.countNum = svgText(node, 0, 32, '', { class: 'count-num' });
      svgEl('rect', { x: 0, y: 40, width: COUNT_TRACK, height: 4, rx: 2, class: 'count-track' }, node);
      this.el.countFill = svgEl('rect', { x: 0, y: 40, width: COUNT_TRACK, height: 4, rx: 2, class: 'count-fill' }, node);
      this.el.count = node;
    }

    /* 里程碑：两台主机在连接建立时刻的扩散环，以及舞台底部的徽章 */
    buildMilestone(group) {
      const ms = this.seq.milestone;
      if (!ms) return;
      const cy = this.yOfTime(ms.at);
      const rings = ['c', 's'].map(side => svgEl('circle', {
        cx: LIFE[side], cy, r: 6, class: 'ring', visibility: 'hidden'
      }, group));
      const badge = svgEl('g', { visibility: 'hidden', opacity: 0 }, group);
      const width = labelWidth(ms.text, 14) + 16;
      svgEl('rect', {
        x: -width / 2, y: -17, width, height: 34, rx: 17,
        class: ms.tone === 'established' ? 'ms-bg-est' : 'ms-bg-rel'
      }, badge);
      svgText(badge, 0, 0, ms.text, { class: 'ms-text', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      this.el.milestone = { group: badge, rings };
    }

    buildPhaseBar() {
      const bar = this.dom.phaseBar;
      bar.textContent = '';
      this.phaseBtns = this.seq.phases.map((phase, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'phase-btn';
        btn.setAttribute('aria-pressed', 'false');
        const idx = document.createElement('span');
        idx.className = 'pb-idx';
        idx.textContent = '0' + (i + 1);
        const name = document.createElement('span');
        name.textContent = phase.name;
        btn.appendChild(idx);
        btn.appendChild(name);
        btn.addEventListener('click', () => this.jumpPhase(i));
        bar.appendChild(btn);
        return btn;
      });
    }

    /* ---------------------------------------------------- 渲染（只依赖 t） */

    setTime(value) {
      this.t = clamp(Number.isFinite(value) ? value : 0, 0, this.seq.duration);
      this.clock.t = this.t;
      this.render();
    }

    render() {
      if (!this.seq) return;
      const snap = window.TCPHandshakeModel.sample(this.seq, this.t, { instant: this.reduce });
      this.paint(snap);
    }

    paint(snap) {
      const el = this.el;

      const wave = this.seq.id === 'wave';
      putText(el.statusStep, snap.current ? snap.current.tag : '准备');
      putText(el.statusPhase, snap.phase ? snap.phase.name : (wave ? '已连接' : '未连接'));
      putText(el.statusSub, `进度 ${snap.stepIndex}/${snap.stepCount}` + (snap.finished ? ' · 完成' : ''));
      el.led.classList.toggle('is-running', this.playing);

      ['c', 's'].forEach(side => this.paintHost(side, snap));
      this.paintBands(snap);
      this.paintMessages(snap);
      if (snap.buffer) this.paintTube(snap.buffer);
      if (snap.countdown) this.paintCountdown(snap.countdown);
      this.paintMilestone(snap.milestone);

      putText(this.dom.explain, snap.explain);
      this.paintPhase(snap);
      this.paintTime(snap);
    }

    paintHost(side, snap) {
      const card = this.el.card[side];
      const state = snap.states[side].current;
      const style = STATE_STYLE[state] || DEFAULT_STATE;
      put(card.chipBg, 'fill', style.bg);
      put(card.chipBg, 'stroke', style.bd);
      putText(card.chipText, state);
      put(card.chipText, 'fill', style.text);
      putText(card.seqValue, String(snap.counters[side]));
    }

    /* 色带：段的起点为状态开始的时刻，终点为下一次状态变化；连接建立后两端 ESTABLISHED 段泛光 */
    paintBands(snap) {
      const ms = snap.milestone;
      ['c', 's'].forEach(side => {
        const changes = snap.states[side].changes;
        changes.forEach((change, i) => {
          const band = this.el.bands[side][i];
          const halo = this.el.halos[side][i];
          put(this.el.labels[side][i], 'visibility', change.visible ? 'visible' : 'hidden');
          if (!change.visible) {
            put(band, 'visibility', 'hidden');
            put(halo, 'visibility', 'hidden');
            return;
          }
          const y0 = i === 0 ? TOP_Y : this.yOfTime(change.at);
          const next = changes[i + 1];
          const y1 = next && next.visible ? this.yOfTime(next.at) : BOTTOM_Y;
          const height = Math.max(0, y1 - y0);
          put(band, 'visibility', 'visible');
          put(band, 'y', y0.toFixed(2));
          put(band, 'height', height.toFixed(2));

          const haloOn = Boolean(ms && ms.halo > 0 && ms.tone === 'established' && change.state === 'ESTABLISHED');
          put(halo, 'visibility', haloOn ? 'visible' : 'hidden');
          if (haloOn) {
            put(halo, 'y', y0.toFixed(2));
            put(halo, 'height', height.toFixed(2));
            put(halo, 'opacity', (ms.halo * 0.4).toFixed(3));
          }
        });
      });
    }

    /* 斜线的头部随时间沿直线匀速移动；箭头沿飞行方向，尖端在头部 */
    paintMessages(snap) {
      this.seq.messages.forEach(msg => {
        const node = this.el.msgs[msg.id];
        const p = snap.messages[msg.id].progress;
        const shown = p > 0;
        const hx = node.x0 + node.dx * p;
        const hy = node.y0 + node.dy * p;
        put(node.trail, 'visibility', shown ? 'visible' : 'hidden');
        put(node.trail, 'x2', hx.toFixed(2));
        put(node.trail, 'y2', hy.toFixed(2));
        put(node.glow, 'visibility', p > 0 && p < 1 ? 'visible' : 'hidden');
        put(node.glow, 'x2', hx.toFixed(2));
        put(node.glow, 'y2', hy.toFixed(2));
        put(node.head, 'visibility', shown ? 'visible' : 'hidden');
        const bx = hx - 9 * node.ux;
        const by = hy - 9 * node.uy;
        const wx = -4.5 * node.uy;
        const wy = 4.5 * node.ux;
        put(node.head, 'points',
          `${hx.toFixed(2)},${hy.toFixed(2)} ${(bx + wx).toFixed(2)},${(by + wy).toFixed(2)} ${(bx - wx).toFixed(2)},${(by - wy).toFixed(2)}`);
        put(node.pill, 'visibility', shown ? 'visible' : 'hidden');
      });
    }

    paintTube(buffer) {
      let below = 0;
      buffer.chunks.forEach((chunk, i) => {
        const el = this.el.chunks[i];
        const k = chunk.leave;
        const y = TUBE.y + TUBE.h - below - el.height;
        const x = TUBE.x + TUBE.pad + TUBE.slide * k;
        below += el.height * (1 - k);
        if (k >= 1) {
          put(el.node, 'visibility', 'hidden');
          return;
        }
        put(el.node, 'visibility', 'visible');
        put(el.node, 'opacity', (1 - k * 0.9).toFixed(3));
        put(el.node, 'transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      });
      putText(this.el.tubeNote, buffer.note);
    }

    paintCountdown(cd) {
      const show = cd.status !== 'idle';
      put(this.el.count, 'visibility', show ? 'visible' : 'hidden');
      if (!show) return;
      putText(this.el.countLabel, cd.status === 'running' ? '2MSL 等待' : '2MSL 已结束');
      putText(this.el.countNum, cd.seconds.toFixed(1) + ' s');
      put(this.el.countFill, 'width', (COUNT_TRACK * cd.fraction).toFixed(2));
    }

    /* 里程碑：徽章弹出并常驻；扩散环与报文闪光只在连接建立时出现 */
    paintMilestone(ms) {
      const m = this.el.milestone;
      if (!m) return;
      if (!ms || !ms.visible) {
        put(m.group, 'visibility', 'hidden');
        m.rings.forEach(ring => put(ring, 'visibility', 'hidden'));
        this.seq.messages.forEach(msg => put(this.el.msgs[msg.id].flash, 'visibility', 'hidden'));
        return;
      }
      put(m.group, 'visibility', 'visible');
      put(m.group, 'opacity', ms.pop.toFixed(3));
      put(m.group, 'transform', `translate(${BADGE_CX} ${BADGE_Y}) scale(${(0.92 + 0.08 * ms.pop).toFixed(3)})`);

      m.rings.forEach(ring => {
        if (ms.ring == null) {
          put(ring, 'visibility', 'hidden');
          return;
        }
        put(ring, 'visibility', 'visible');
        put(ring, 'r', (6 + 30 * ms.ring).toFixed(2));
        put(ring, 'opacity', (1 - ms.ring).toFixed(3));
      });

      this.seq.messages.forEach(msg => {
        const flash = this.el.msgs[msg.id].flash;
        const on = msg.id === ms.flashMessage && ms.flash > 0;
        put(flash, 'visibility', on ? 'visible' : 'hidden');
        if (on) put(flash, 'opacity', (ms.flash * 0.5).toFixed(3));
      });
    }

    paintPhase(snap) {
      const active = snap.phase ? snap.phase.index : 0;
      if (this.activePhase === active) return;
      this.activePhase = active;
      this.phaseBtns.forEach((btn, i) => {
        btn.setAttribute('aria-pressed', String(i + 1 === active));
      });
    }

    paintTime(snap) {
      const scrub = this.dom.scrub;
      if (Number(scrub.value) !== snap.t) scrub.value = snap.t.toFixed(2);
      putText(this.dom.timeOut, `${snap.t.toFixed(1)} / ${snap.total.toFixed(1)} s`);
    }

    /* ---------------------------------------------------- 播放与步进 */

    play() {
      if (!this.gsapOK) return;
      if (this.t >= this.seq.duration - 1e-6) this.setTime(0);
      this.playing = true;
      if (this.reduce) this.reduceTick();
      else this.startTween(this.seq.duration);
      this.updateControls();
      this.writeHash(true);
    }

    pause() {
      const wasActive = this.playing || this.tween || this.reduceTimer;
      this.playing = false;
      this.killTween();
      clearTimeout(this.reduceTimer);
      this.reduceTimer = null;
      this.updateControls();
      if (wasActive) this.writeHash(true);
    }

    togglePlay() {
      if (this.playing) this.pause();
      else this.play();
    }

    restart() {
      this.pause();
      this.setTime(0);
      this.play();
    }

    step(direction) {
      this.pause();
      const target = window.TCPHandshakeModel.neighbor(this.seq.stops, this.t, direction);
      if (Math.abs(target - this.t) < 1e-6) return;
      if (direction > 0 && this.gsapOK && !this.reduce) {
        this.startTween(target);
      } else {
        this.setTime(target);
        this.writeHash(true);
      }
      this.updateControls();
    }

    jumpPhase(index) {
      this.pause();
      this.setTime(this.seq.phases[index].at);
      this.writeHash(true);
      this.updateControls();
    }

    startTween(target) {
      this.killTween();
      this.clock.t = this.t;
      this.tween = window.gsap.to(this.clock, {
        t: target,
        duration: Math.max(0.001, target - this.t),
        ease: 'none',
        onUpdate: () => this.setTime(this.clock.t),
        onComplete: () => this.onTweenDone(target)
      });
      this.tween.timeScale(this.speed);
    }

    killTween() {
      if (this.tween) {
        this.tween.kill();
        this.tween = null;
      }
    }

    onTweenDone(target) {
      this.tween = null;
      this.playing = false;
      this.setTime(target);
      this.updateControls();
      this.writeHash(true);
    }

    /* 减少动效：不做补间，逐个边界直接跳转并停留 */
    reduceTick() {
      if (!this.playing) return;
      const next = window.TCPHandshakeModel.neighbor(this.seq.frames, this.t, 1);
      this.setTime(next);
      if (this.t >= this.seq.duration - 1e-6) {
        this.playing = false;
        this.updateControls();
        this.writeHash(true);
        return;
      }
      this.reduceTimer = window.setTimeout(() => this.reduceTick(), HOLD_SECONDS * 1000 / this.speed);
    }

    setReduce(on) {
      const wasPlaying = this.playing;
      if (wasPlaying) this.pause();
      this.reduce = on;
      this.dom.reduce.checked = on;
      document.body.dataset.motion = on ? 'reduce' : 'full';
      this.render();
      if (wasPlaying) this.play();
    }

    initMotion() {
      const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this.setReduce(Boolean(mq && mq.matches));
      this.userSetMotion = false;
      if (mq && mq.addEventListener) {
        mq.addEventListener('change', event => {
          if (!this.userSetMotion) this.setReduce(event.matches);
        });
      }
    }

    updateControls() {
      if (!this.seq) return;
      const d = this.dom;
      const atEnd = this.t >= this.seq.duration - 1e-6;
      const stepping = Boolean(this.tween) && !this.playing;
      d.playText.textContent = this.playing ? '暂停' : (atEnd ? '重播' : '播放');
      d.playIcon.textContent = this.playing ? '❚❚' : '▶';
      d.btnPlay.classList.toggle('is-playing', this.playing);
      d.btnPrev.disabled = this.t <= 1e-6 || stepping;
      d.btnNext.disabled = atEnd || stepping;
      d.speedOut.textContent = this.speed.toFixed(1) + '×';
      d.speed.style.setProperty('--pct', ((this.speed - 0.5) / 1.5 * 100).toFixed(1) + '%');
    }

    /* ---------------------------------------------------- 地址栏 */

    readHash() {
      try {
        const params = new URLSearchParams(location.hash.slice(1));
        const mode = params.get('m');
        const t = Number(params.get('t'));
        return {
          mode: window.TCPHandshakeModel.MODES.includes(mode) ? mode : 'handshake',
          t: params.has('t') && Number.isFinite(t) ? t : 0
        };
      } catch (error) {
        return { mode: 'handshake', t: 0 };
      }
    }

    writeHash(now) {
      if (!now) {
        clearTimeout(this.hashTimer);
        this.hashTimer = setTimeout(() => this.writeHash(true), 300);
        return;
      }
      try {
        history.replaceState(null, '', `#m=${this.modeId}&t=${this.t.toFixed(2)}`);
      } catch (error) {
        /* 某些本地环境不允许改写地址，演示照常可用 */
      }
    }

    /* ---------------------------------------------------- 事件绑定 */

    bindControls() {
      const d = this.dom;
      d.btnPlay.addEventListener('click', () => this.togglePlay());
      d.btnRestart.addEventListener('click', () => this.restart());
      d.btnPrev.addEventListener('click', () => this.step(-1));
      d.btnNext.addEventListener('click', () => this.step(1));

      d.speed.addEventListener('input', event => {
        this.speed = parseFloat(event.target.value);
        if (this.tween) this.tween.timeScale(this.speed);
        this.updateControls();
      });

      d.reduce.addEventListener('change', () => {
        this.userSetMotion = true;
        this.setReduce(d.reduce.checked);
      });

      d.scrub.addEventListener('input', () => {
        this.pause();
        this.setTime(parseFloat(d.scrub.value));
        this.writeHash(false);
        this.updateControls();
      });

      d.modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.mode !== this.modeId) this.setMode(btn.dataset.mode, { t: 0 });
        });
      });

      window.addEventListener('keydown', event => {
        const target = event.target instanceof Element ? event.target : null;
        if (target && target.closest('input, select, textarea, button, a')) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.code === 'Space') { event.preventDefault(); this.togglePlay(); }
        else if (event.code === 'ArrowRight') { event.preventDefault(); this.step(1); }
        else if (event.code === 'ArrowLeft') { event.preventDefault(); this.step(-1); }
        else if (event.code === 'Home') { event.preventDefault(); this.restart(); }
      });

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.pause();
      });
    }
  }

  /* 按字号估算文字宽度：中文按字号计，其余按约 0.62 个字号计，再加内边距 */
  function labelWidth(text, size) {
    let width = 0;
    for (const ch of text) width += /[　-鿿＀-￯]/.test(ch) ? size : size * 0.62;
    return width + 20;
  }

  window.addEventListener('DOMContentLoaded', () => {
    if (!window.TCPHandshakeModel) return;
    window.tcpDemo = new TCPDemo();
    window.tcpDemo.init();
  });
})();
