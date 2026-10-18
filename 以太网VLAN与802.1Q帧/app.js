/**
 * VLAN 与 802.1Q 帧流动 · 界面控制器。
 *
 * 分工：model.js 给几何与时刻表，choreo.js 由（步，进度）算出画面，这里只负责
 * 建一次舞台 SVG、把 world 写进 DOM、以及播放/单步/拖动/速度/键盘/减少动效/地址栏。
 * 画面完全由时刻算出，没有历史动画累积，所以倒退与拖动都能精确重绘。
 */
(function () {
  'use strict';

  const M = window.VlanModel;
  const C = window.VlanChoreo;
  const G = M.GEO;
  const L = M.LAYOUT;
  const RUN = M.buildRun();
  const NS = 'http://www.w3.org/2000/svg';
  const DWELL = 0.9;          // 减少动效时每一步停留的秒数（1× 速度）

  const $ = (id) => document.getElementById(id);

  const state = {
    t: 0,
    playing: false,
    speed: 1,
    reduce: false,
    raf: 0,
    timer: 0,
    target: null,
    last: 0,
    lastHash: 0
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const r3 = (v) => Math.round(v * 1000) / 1000;

  // ============================================================
  // SVG 小工具
  // ============================================================
  function svgEl(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    if (attrs) {
      for (const key in attrs) node.setAttribute(key, attrs[key]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  // 只在变化时写入属性，避免每帧重排
  function setA(node, name, value) {
    const cache = node.__a || (node.__a = {});
    if (cache[name] === value) return;
    cache[name] = value;
    node.setAttribute(name, value);
  }

  function setText(node, text) {
    if (node.__t === text) return;
    node.__t = text;
    node.textContent = text;
  }

  function setClass(node, cls, on) {
    const cache = node.__c || (node.__c = {});
    if (cache[cls] === on) return;
    cache[cls] = on;
    node.classList.toggle(cls, on);
  }

  // ============================================================
  // 舞台：静态结构只建一次
  // ============================================================
  const stage = $('stage');
  const portEls = {};
  const hostEls = {};
  const bandEls = {};
  const swEls = {};

  function layer(name) {
    const g = svgEl('g', { id: 'layer-' + name });
    stage.appendChild(g);
    return g;
  }

  function buildDefs() {
    const defs = svgEl('defs', null, stage);
    const pat = svgEl('pattern', { id: 'grid18', width: 18, height: 18, patternUnits: 'userSpaceOnUse' }, defs);
    svgEl('path', { d: 'M18 0H0V18', fill: 'none', stroke: 'rgba(52,60,56,0.05)', 'stroke-width': 1 }, pat);
    svgEl('rect', { x: 0, y: 0, width: G.stageW, height: G.stageH, fill: 'url(#grid18)' }, stage);
  }

  function buildBands() {
    const g0 = layer('bands');
    Object.values(L.bands).forEach((b) => {
      const g = svgEl('g', { class: 'band', 'data-vid': b.vid }, g0);
      svgEl('rect', { class: 'band-box', x: b.x1, y: b.top, width: b.x2 - b.x1, height: b.h, rx: 12 }, g);
      const t = svgEl('text', { class: 'band-txt', x: b.cx, y: G.bandLabelY, 'text-anchor': 'middle' }, g);
      t.textContent = b.label;
      bandEls[b.key] = g;
    });
  }

  function buildCables() {
    const g0 = layer('cables');
    Object.values(L.hosts).forEach((h) => {
      svgEl(
        'line',
        {
          class: 'cable',
          'data-vid': h.vid,
          x1: h.cx,
          y1: G.portTop + G.portH,
          x2: h.cx,
          y2: h.top
        },
        g0
      );
    });
    const a = L.ports['sw1:P8'];
    const b = L.ports['sw2:P1'];
    svgEl('line', { class: 'trunk-cable', x1: a.x2, y1: a.cy, x2: b.x1, y2: b.cy }, g0);
    const note = svgEl(
      'text',
      { class: 'trunk-note', x: (a.x2 + b.x1) / 2, y: 146, 'text-anchor': 'middle' },
      g0
    );
    note.textContent = 'Trunk 允许 10 · 20';
  }

  function buildPort(pt) {
    const g = svgEl('g', { class: 'port', 'data-vid': pt.vid, 'data-port': pt.id });
    svgEl('rect', { class: 'port-ring', x: pt.x1 - 3.5, y: pt.y1 - 3.5, width: G.portW + 7, height: G.portH + 7, rx: 11, opacity: 0 }, g);
    svgEl('rect', { class: 'port-box', x: pt.x1, y: pt.y1, width: G.portW, height: G.portH, rx: 8 }, g);
    const id = svgEl('text', { class: 'port-id', x: pt.cx, y: pt.y1 + 18, 'text-anchor': 'middle' }, g);
    id.textContent = pt.id;
    const vid = svgEl('text', { class: 'port-vid', x: pt.cx, y: pt.y1 + 33, 'text-anchor': 'middle' }, g);
    vid.textContent = 'PVID ' + pt.vid;

    // 未转发：端口下方一枚 ✕（形状 + 颜色，不只靠颜色）
    const mark = svgEl('g', { class: 'port-mark', opacity: 0 }, g);
    svgEl('circle', { cx: pt.cx, cy: 206, r: 7 }, mark);
    svgEl(
      'path',
      { d: 'M' + (pt.cx - 2.4) + ' 203.6 L' + (pt.cx + 2.4) + ' 208.4 M' + (pt.cx + 2.4) + ' 203.6 L' + (pt.cx - 2.4) + ' 208.4' },
      mark
    );

    portEls[pt.key] = { ring: g.querySelector('.port-ring'), mark };
    return g;
  }

  function buildTrunkPort(tp) {
    const g = svgEl('g', { class: 'trunk-port', 'data-port': tp.id });
    svgEl('rect', { class: 'trunk-ring', x: tp.x1 - 3.5, y: tp.y1 - 3.5, width: G.trunkW + 7, height: G.trunkH + 7, rx: 11, opacity: 0 }, g);
    svgEl('rect', { class: 'trunk-box', x: tp.x1, y: tp.y1, width: G.trunkW, height: G.trunkH, rx: 8 }, g);
    const id = svgEl('text', { class: 'trunk-id', x: tp.cx, y: tp.y1 + 15, 'text-anchor': 'middle' }, g);
    id.textContent = tp.id;
    const sub = svgEl('text', { class: 'trunk-sub', x: tp.cx, y: tp.y1 + 27, 'text-anchor': 'middle' }, g);
    sub.textContent = 'Trunk';
    portEls[tp.key] = { ring: g.querySelector('.trunk-ring'), mark: null };
    return g;
  }

  function buildSwitch(sw) {
    const g = svgEl('g', { class: 'sw', 'data-sw': sw.id });
    svgEl('rect', { class: 'sw-body', x: sw.x, y: sw.y, width: sw.w, height: sw.h, rx: 16 }, g);

    const title = svgEl('text', { class: 'sw-title', x: sw.x + 20, y: 38 }, g);
    title.textContent = sw.title;
    const code = svgEl('text', { class: 'sw-code', x: sw.x + 20, y: 56 }, g);
    code.textContent = sw.code;

    // 右侧：VID → 端口映射（查表时对应的行会染底）
    const mapEls = {};
    const right = sw.x + sw.w - 20;
    sw.map.forEach((row, i) => {
      const y = 38 + i * 18;
      const rect = svgEl(
        'rect',
        { class: 'map-hl', 'data-vid': row.vid, x: right - 106, y: y - 11.5, width: 110, height: 17, rx: 5, opacity: 0 },
        g
      );
      const txt = svgEl('text', { class: 'map-txt', 'data-vid': row.vid, x: right, y, 'text-anchor': 'end' }, g);
      txt.textContent = row.text;
      mapEls[row.vid] = { rect, txt };
    });

    // VLAN 转发表芯片
    const fab = sw.fabric;
    const fabricRing = svgEl(
      'rect',
      {
        class: 'fabric-ring',
        x: fab.cx - G.fabricW / 2 - 5,
        y: fab.cy - G.fabricH / 2 - 5,
        width: G.fabricW + 10,
        height: G.fabricH + 10,
        rx: 11,
        opacity: 0
      },
      g
    );
    svgEl('rect', { class: 'fabric-box', x: fab.cx - G.fabricW / 2, y: fab.cy - G.fabricH / 2, width: G.fabricW, height: G.fabricH, rx: 8 }, g);
    const ft = svgEl('text', { class: 'fabric-txt', x: fab.cx, y: fab.cy + 3.5, 'text-anchor': 'middle' }, g);
    ft.textContent = 'VLAN 转发表';
    svgEl('line', { class: 'fabric-link', x1: fab.cx, y1: fab.cy + G.fabricH / 2, x2: fab.cx, y2: G.busY - 12 }, g);

    // 内部总线（背板）与端口支线
    svgEl(
      'rect',
      { class: 'bus-band', x: sw.bus.x1, y: G.busY - 12, width: sw.bus.x2 - sw.bus.x1, height: 24, rx: 12 },
      g
    );
    svgEl('line', { class: 'bus', x1: sw.bus.x1 + 8, y1: sw.bus.y, x2: sw.bus.x2 - 8, y2: sw.bus.y }, g);
    sw.ports.forEach((key) => {
      const pt = L.ports[key];
      svgEl('line', { class: 'stub', x1: pt.cx, y1: G.busY + 12, x2: pt.cx, y2: pt.y1 }, g);
    });

    // 端口槽与 Trunk 端口
    sw.ports.forEach((key) => {
      g.appendChild(buildPort(L.ports[key]));
    });
    g.appendChild(buildTrunkPort(L.ports[sw.trunk]));

    stage.querySelector('#layer-switches').appendChild(g);
    swEls[sw.id] = { fabricRing, map: mapEls };
  }

  function buildHosts() {
    const g0 = layer('hosts');
    Object.values(L.hosts).forEach((h) => {
      const g = svgEl('g', { class: 'host', 'data-host': h.id }, g0);
      const ring = svgEl(
        'rect',
        { class: 'host-ring', x: h.cx - h.w / 2 - 4, y: h.top - 4, width: h.w + 8, height: h.h + 8, rx: 13, opacity: 0 },
        g
      );
      svgEl('rect', { class: 'host-box', x: h.cx - h.w / 2, y: h.top, width: h.w, height: h.h, rx: 10 }, g);
      const badge = svgEl('text', { class: 'host-badge', x: h.cx, y: h.top + 22, 'text-anchor': 'middle' }, g);
      badge.textContent = h.badge;
      const role = svgEl('text', { class: 'host-role', x: h.cx, y: h.top + 35, 'text-anchor': 'middle' }, g);
      role.textContent = h.role;

      // 收到回执：✓
      const check = svgEl('g', { class: 'host-check', opacity: 0 }, g);
      svgEl('circle', { cx: h.cx + 18, cy: h.top + 7, r: 6 }, check);
      svgEl(
        'path',
        { d: 'M' + (h.cx + 15) + ' ' + (h.top + 7) + ' l2.1 2.3 l3.9 -4.5' },
        check
      );

      // 发送方：主机上方一枚「发送」
      const send = svgEl('g', { class: 'host-send', opacity: 0 }, g);
      svgEl('rect', { x: h.cx - 19, y: h.top - 22, width: 38, height: 16, rx: 8 }, send);
      const st = svgEl('text', { x: h.cx, y: h.top - 10.5, 'text-anchor': 'middle' }, send);
      st.textContent = '发送';

      hostEls[h.id] = { ring, check, send };
    });
  }

  // ---------- 动态层：帧、浮标、飞行标签、结论 ----------
  const framePool = [];
  const tagPool = [];
  let frameLayer = null;
  let trailEl = null;
  let pvidEl = null;
  let resultEl = null;
  const PVID_W = 58;
  const PVID_H = 18;

  function makeFrameEl() {
    const g = svgEl('g', { class: 'frame' }, frameLayer);
    const body = svgEl('rect', { class: 'frame-body', rx: 6 }, g);
    const tagRect = svgEl('rect', { class: 'frame-tag', rx: 3 }, g);
    const seps = [];
    const lbls = [];
    C.CELLS.forEach((cell, k) => {
      if (k > 0) seps[k] = svgEl('line', { class: 'frame-sep' }, g);
      const lbl = svgEl(
        'text',
        { class: 'frame-lbl' + (cell.key === 'tag' ? ' frame-lbl-tag' : ''), y: 3.4, 'text-anchor': 'middle' },
        g
      );
      lbl.textContent = cell.label;
      lbls[k] = lbl;
    });
    const len = svgEl('text', { class: 'frame-len', 'text-anchor': 'start' }, g);
    const el = { g, body, tagRect, seps, lbls, len, ghost: null };
    framePool.push(el);
    return el;
  }

  function buildFx() {
    const g0 = layer('fx');
    trailEl = svgEl('polyline', { class: 'trail', points: '', opacity: 0 }, g0);

    pvidEl = svgEl('g', { class: 'pvid-chip', opacity: 0 }, g0);
    svgEl('rect', { x: -PVID_W / 2, y: -PVID_H / 2, width: PVID_W, height: PVID_H, rx: 9 }, pvidEl);
    const pt = svgEl('text', { x: 0, y: 3, 'text-anchor': 'middle' }, pvidEl);
    pt.textContent = 'PVID 10';
  }

  function buildDynamic() {
    frameLayer = layer('frames');
    for (let i = 0; i < 4; i++) makeFrameEl();

    const g0 = layer('tags');
    for (let i = 0; i < 6; i++) {
      const g = svgEl('g', { class: 'tag', opacity: 0 }, g0);
      const bg = svgEl('rect', { class: 'tag-bg', rx: 5, y: -12.5, height: 17 }, g);
      const txt = svgEl('text', { class: 'tag-text', y: 0 }, g);
      tagPool.push({ g, bg, txt, kind: null });
    }

    const g1 = layer('result');
    resultEl = svgEl(
      'text',
      { class: 'result', x: G.stageW / 2, y: G.resultY, 'text-anchor': 'middle', opacity: 0 },
      g1
    );
    resultEl.textContent = '✓ E 收到的帧 = A 发出的帧：1518 B，标签已在出向剥除';
  }

  // ============================================================
  // 上色：把 world 写进 DOM
  // ============================================================
  function paintFrame(el, data) {
    if (!data) {
      setA(el.g, 'opacity', 0);
      setA(el.g, 'display', 'none');
      return;
    }
    setA(el.g, 'display', 'inline');
    setA(el.g, 'opacity', r3(data.alpha));
    setA(el.g, 'transform', 'translate(' + r3(data.x) + ' ' + r3(data.y) + ') scale(' + data.scale + ')');
    setClass(el.g, 'is-ghost', !!data.ghost);

    const total = C.frameWidth(data.tag);
    const left = -total / 2;
    setA(el.body, 'x', r3(left));
    setA(el.body, 'y', -C.FRAME_H / 2);
    setA(el.body, 'width', r3(total));
    setA(el.body, 'height', C.FRAME_H);

    let cursor = left;
    C.CELLS.forEach((cell, k) => {
      const w = cell.key === 'tag' ? C.FRAME_TAG * data.tag : cell.w;
      if (k > 0) {
        setA(el.seps[k], 'x1', r3(cursor));
        setA(el.seps[k], 'x2', r3(cursor));
        setA(el.seps[k], 'y1', -C.FRAME_H / 2);
        setA(el.seps[k], 'y2', C.FRAME_H / 2);
      }
      setA(el.lbls[k], 'x', r3(cursor + w / 2));
      // 标签格是长出来的：宽度够放字才显字，避免文字溢出到相邻字段
      setA(el.lbls[k], 'opacity', cell.key === 'tag' ? r3(clamp((w - 30) / 8, 0, 1)) : w >= 12 ? 1 : 0);
      if (cell.key === 'tag') {
        setA(el.tagRect, 'x', r3(cursor));
        setA(el.tagRect, 'width', r3(Math.max(0, w)));
        setA(el.tagRect, 'y', -C.FRAME_H / 2);
        setA(el.tagRect, 'height', C.FRAME_H);
      }
      cursor += w;
    });

    setText(el.len, data.label || '');
    setA(el.len, 'x', r3(total / 2 + 7));
    setA(el.len, 'y', 3.4);
    setA(el.len, 'text-anchor', 'start');
  }

  function paint(w, stepIndex) {
    // 帧：副本先画（在主帧下面，像从主帧里长出来），主帧压在最上面
    const ordered = w.frames.slice().sort((a, b) => (a.ghost ? 0 : 1) - (b.ghost ? 0 : 1));
    for (let i = 0; i < framePool.length; i++) paintFrame(framePool[i], ordered[i]);

    // 端口：发光与 ✕
    Object.keys(w.ports).forEach((key) => {
      const el = portEls[key];
      const st = w.ports[key];
      if (!el) return;
      setA(el.ring, 'opacity', r3(st.glow));
      if (el.mark) setA(el.mark, 'opacity', r3(st.mark));
    });

    // 主机：✓、光环、发送
    Object.keys(w.hosts).forEach((id) => {
      const el = hostEls[id];
      const st = w.hosts[id];
      if (!el) return;
      setA(el.check, 'opacity', r3(st.recv));
      setA(el.ring, 'opacity', r3(st.ring));
      setA(el.send, 'opacity', r3(st.send));
    });

    // 广播域压暗
    Object.keys(w.bands).forEach((key) => {
      const g = bandEls[key];
      if (g) setA(g, 'opacity', r3(1 - 0.7 * w.bands[key].dim));
    });

    // 查表高亮与转发表脉冲
    Object.keys(swEls).forEach((id) => {
      const el = swEls[id];
      const alpha = w.lookup && w.lookup.sw === id ? w.lookup.alpha : 0;
      const vid = w.lookup && w.lookup.sw === id ? w.lookup.vid : null;
      Object.keys(el.map).forEach((key) => {
        const on = String(vid) === String(key);
        setA(el.map[key].rect, 'opacity', on ? r3(alpha) : 0);
      });
      setA(el.fabricRing, 'opacity', w.fabric && w.fabric.sw === id ? r3(w.fabric.alpha) : 0);
    });

    // 走过的线路
    if (w.trail) {
      const pts = [];
      for (let i = 0; i < w.trail.points.length; i++) {
        pts.push(r3(w.trail.points[i][0]) + ',' + r3(w.trail.points[i][1]));
      }
      setA(trailEl, 'points', pts.join(' '));
      setA(trailEl, 'opacity', r3(w.trail.alpha));
      setClass(trailEl, 'is-trunk', stepIndex === 4);
    } else {
      setA(trailEl, 'opacity', 0);
    }

    // 从端口飞进帧里的 PVID 标签
    if (w.pvid) {
      setA(pvidEl, 'opacity', r3(w.pvid.alpha));
      setA(pvidEl, 'transform', 'translate(' + r3(w.pvid.x) + ' ' + r3(w.pvid.y) + ')');
    } else {
      setA(pvidEl, 'opacity', 0);
    }

    // 浮标
    for (let i = 0; i < tagPool.length; i++) {
      const el = tagPool[i];
      const t = w.tags[i];
      if (!t) {
        setA(el.g, 'opacity', 0);
        continue;
      }
      let tw = 12;
      for (const ch of t.text) tw += ch.charCodeAt(0) > 0x2e80 ? 9.8 : 5.7;
      setA(el.g, 'opacity', r3(t.alpha));
      setA(el.g, 'transform', 'translate(' + r3(t.x) + ' ' + r3(t.y) + ')');
      setText(el.txt, t.text);
      setA(el.txt, 'x', 0);
      setA(el.txt, 'text-anchor', t.anchor);
      let bgX;
      if (t.anchor === 'middle') bgX = -tw / 2;
      else if (t.anchor === 'end') bgX = -(tw - 6);
      else bgX = -6;
      setA(el.bg, 'x', r3(bgX));
      setA(el.bg, 'width', r3(tw));
      setClass(el.g, 'k-key', t.kind === 'key');
      setClass(el.g, 'k-warn', t.kind === 'warn');
      setClass(el.g, 'k-note', t.kind === 'note');
      setClass(el.g, 'k-quiet', t.kind === 'quiet');
    }

    // 帧结构条：跟着舞台上的帧，标出当前是哪种帧
    const tagged = w.mainTag > 0.5;
    setClass(specPlain, 'is-live', !tagged);
    setClass(specTag, 'is-live', tagged);

    // 结论
    setA(resultEl, 'opacity', r3(w.result));
  }

  // ============================================================
  // 舞台状态与阶段条
  // ============================================================
  const specPlain = $('spec-plain');
  const specTag = $('spec-tag');

  const els = {
    stepCount: $('step-count'),
    phase: $('phase'),
    scope: $('scope'),
    narr: $('narr'),
    lamp: $('lamp'),
    scrub: $('scrub'),
    scrubText: $('scrub-text'),
    playText: $('play-text'),
    play: $('btn-play'),
    prev: $('btn-prev'),
    next: $('btn-next'),
    replay: $('btn-replay'),
    reduce: $('reduce'),
    steps: $('steps'),
    notice: $('notice')
  };

  let chipEls = [];

  function buildSteps() {
    RUN.steps.forEach((step, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'step-chip';
      btn.title = step.narr;
      const no = document.createElement('span');
      no.className = 'no';
      no.textContent = String(i + 1);
      const name = document.createElement('span');
      name.textContent = step.phase;
      btn.appendChild(no);
      btn.appendChild(name);
      btn.addEventListener('click', () => {
        stopLoop();
        setT(RUN.bounds[i]);
        render();
        writeHash();
      });
      li.appendChild(btn);
      els.steps.appendChild(li);
      chipEls.push(btn);
    });
  }

  function updateChrome(s) {
    const step = RUN.steps[s.index];
    setText(els.stepCount, '第 ' + (s.index + 1) + ' / ' + RUN.N + ' 步');
    setText(els.phase, step.phase);
    setText(els.scope, step.scope);
    setText(els.narr, step.narr);
    setClass(els.lamp, 'is-running', state.playing);
    const scrubbed = s.t.toFixed(2);
    if (els.scrub.__v !== scrubbed) {
      els.scrub.__v = scrubbed;
      els.scrub.value = scrubbed;
    }
    setText(els.scrubText, 't = ' + s.t.toFixed(1) + ' s');
    chipEls.forEach((btn, i) => {
      setClass(btn, 'is-current', i === s.index);
      setClass(btn, 'is-done', i < s.index);
      setA(btn, 'aria-current', i === s.index ? 'step' : 'false');
    });
  }

  function render() {
    const s = M.sampleAt(RUN, state.t);
    const w = C.world(s.index, s.p);
    paint(w, s.index);
    updateChrome(s);
  }

  function setT(t) {
    state.t = clamp(t, 0, RUN.total);
  }

  // ============================================================
  // 播放控制
  // ============================================================
  function setPlayLabel(playing) {
    els.playText.textContent = playing ? '⏸ 暂停' : '▶ 播放';
    setClass(els.lamp, 'is-running', playing);
  }

  function stopLoop() {
    if (state.raf) cancelAnimationFrame(state.raf);
    if (state.timer) clearTimeout(state.timer);
    state.raf = 0;
    state.timer = 0;
    state.playing = false;
    state.target = null;
    setPlayLabel(false);
  }

  function pause() {
    stopLoop();
    render();
    writeHash();
  }

  function tick(now) {
    if (!state.playing) return;
    const dt = Math.min(0.1, Math.max(0, (now - state.last) / 1000));
    state.last = now;
    const limit = state.target == null ? RUN.total : state.target;
    const t = state.t + dt * state.speed;
    if (t >= limit - 1e-6) {
      setT(limit);
      render();
      if (now - state.lastHash > 300) {
        writeHash();
        state.lastHash = now;
      }
      stopLoop();
      writeHash();
      return;
    }
    setT(t);
    render();
    if (now - state.lastHash > 300) {
      writeHash();
      state.lastHash = now;
    }
    state.raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (state.playing) return;
    state.playing = true;
    state.last = performance.now();
    setPlayLabel(true);
    state.raf = requestAnimationFrame(tick);
  }

  function reduceTick() {
    if (!state.playing) return;
    const s = M.sampleAt(RUN, state.t);
    let idx = s.p >= 0.999 ? s.index + 1 : s.index;
    if (idx >= RUN.N) {
      pause();
      return;
    }
    setT(M.stepEnd(RUN, idx) - 0.0005);
    render();
    writeHash();
    // setTimeout 的延时按整数毫秒取整，浮点秒会退化成 0
    const dwell = Math.max(120, Math.round((DWELL / state.speed) * 1000));
    if (idx >= RUN.N - 1) {
      state.timer = setTimeout(() => {
        if (state.playing) pause();
      }, dwell);
      return;
    }
    state.timer = setTimeout(reduceTick, dwell);
  }

  function play() {
    if (state.reduce) {
      stopLoop();
      state.playing = true;
      setPlayLabel(true);
      reduceTick();
      return;
    }
    if (state.t >= RUN.total - 1e-6) state.t = 0;
    state.target = null;
    startLoop();
  }

  function togglePlay() {
    if (state.playing) pause();
    else play();
  }

  function playTo(target) {
    state.target = target;
    if (state.reduce) {
      setT(target);
      render();
      writeHash();
      return;
    }
    if (state.t >= target - 1e-6) {
      render();
      return;
    }
    startLoop();
  }

  function nextStep() {
    const s = M.sampleAt(RUN, state.t);
    const idx = s.p >= 0.999 ? s.index + 1 : s.index;
    if (idx >= RUN.N) return;
    playTo(M.stepEnd(RUN, idx) - 0.0005);
  }

  function prevStep() {
    const s = M.sampleAt(RUN, state.t);
    const idx = s.p > 0.04 ? s.index : Math.max(0, s.index - 1);
    stopLoop();
    setT(RUN.bounds[idx]);
    render();
    writeHash();
  }

  function replay() {
    stopLoop();
    setT(0);
    render();
    writeHash();
  }

  // ============================================================
  // 地址栏
  // ============================================================
  function writeHash() {
    try {
      const params = new URLSearchParams();
      params.set('t', state.t.toFixed(2));
      params.set('x', String(state.speed));
      if (state.reduce) params.set('r', '1');
      history.replaceState(null, '', '#' + params.toString());
    } catch (err) {
      /* 某些本地环境不允许改写地址，演示照常可用 */
    }
  }

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const t = Number(params.get('t'));
    if (params.has('t') && Number.isFinite(t)) state.t = clamp(t, 0, RUN.total);
    const x = Number(params.get('x'));
    if (x === 0.5 || x === 1 || x === 1.5 || x === 2) setSpeed(x, false);
    if (params.get('r') === '1') setReduce(true, false);
  }

  // ============================================================
  // 事件
  // ============================================================
  function setSpeed(value, write) {
    state.speed = value;
    document.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.speed) === value));
    });
    if (write) writeHash();
  }

  function setReduce(on, write) {
    state.reduce = on;
    els.reduce.checked = on;
    document.body.classList.toggle('is-reduced', on);
    if (write) writeHash();
  }

  function bindEvents() {
    els.play.addEventListener('click', togglePlay);
    els.replay.addEventListener('click', replay);
    els.prev.addEventListener('click', prevStep);
    els.next.addEventListener('click', () => {
      stopLoop();
      nextStep();
    });

    els.scrub.addEventListener('input', () => {
      stopLoop();
      setT(Number(els.scrub.value));
      render();
      writeHash();
    });

    document.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setSpeed(Number(btn.dataset.speed), true);
        if (state.playing && state.reduce) {
          stopLoop();
          play();
        }
      });
    });

    els.reduce.addEventListener('change', () => {
      const was = state.playing;
      setReduce(els.reduce.checked, true);
      if (was) {
        stopLoop();
        play();
      }
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest('input, select, textarea, button, a')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        stopLoop();
        nextStep();
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        prevStep();
      } else if (event.code === 'Home') {
        event.preventDefault();
        replay();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.playing) pause();
    });
  }

  // ============================================================
  // 启动
  // ============================================================
  function init() {
    buildDefs();
    buildBands();
    buildCables();
    layer('switches');
    Object.keys(L.switches).forEach((id) => buildSwitch(L.switches[id]));
    buildHosts();
    buildFx();
    buildDynamic();
    buildSteps();

    els.scrub.min = '0';
    els.scrub.max = RUN.total.toFixed(2);
    els.scrub.step = '0.01';

    // 减少动效默认跟随系统设置，页面上可以改
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReduce(true, false);
    }

    readHash();
    render();
    bindEvents();

    if (typeof window.requestAnimationFrame !== 'function') {
      els.play.disabled = true;
      els.notice.hidden = false;
      els.notice.textContent = '当前环境不支持动画帧，播放按钮已停用；单步、上一步与进度滑块仍可使用。';
    }
  }

  init();
})();
