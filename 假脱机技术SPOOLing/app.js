/**
 * 假脱机技术 SPOOLing：固定流水线舞台 + 同一时钟的时间线对比。
 * 推演在 model.js（window.SpoolModel）完成。这里按时刻 t 重绘全部画面；
 * GSAP 时间线只负责推进 t，所以暂停、倒退、拖动都可以直接按 t 重绘。
 */
(() => {
  'use strict';

  const M = window.SpoolModel;
  const TICK = 0.25;                     // 1t 在 1× 速度下的秒数
  const EPS = 1e-6;
  const NS = 'http://www.w3.org/2000/svg';
  const LY = 200;                        // 宽屏流水线的水平线
  const CELL = { w: 34, h: 28, gap: 6, pad: 12 };
  const CHIP = { w: 34, h: 22 };
  const TALL_BELOW = 640;                // 舞台宽度低于此值时改为竖排

  const WIRE_OF = {
    'card>in': 'card-in',
    'in>cpu': 'in-cpu',
    'cpu>out': 'cpu-out',
    'out>printer': 'out-printer',
    'card>cpu': 'card-cpu',
    'cpu>printer': 'cpu-printer'
  };
  const WAIT_KINDS = new Set(['wait-in', 'wait-out', 'read-direct', 'print-direct']);
  const BAR_CLASS = {
    read: 'k-card',
    'wait-slot': 'k-wait',
    compute: 'k-compute',
    'read-well': 'k-in',
    'write-well': 'k-out',
    'wait-in': 'k-wait',
    'wait-out': 'k-wait',
    'read-direct': 'k-wait',
    'print-direct': 'k-wait',
    print: 'k-print'
  };
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const STEP_SEC = 0.9;                  // 减少动效时，每个事件时刻停留的秒数（1× 速度）
  const LINK_DELAY = 300;                // 地址栏状态写回的防抖时间（毫秒）

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const setText = (node, value) => {
    const text = String(value);
    if (node.textContent !== text) node.textContent = text;
  };
  const attrs = (node, values) => {
    for (const [key, value] of Object.entries(values)) node.setAttribute(key, value);
    return node;
  };
  const svg = (tag, values = {}, parent) => {
    const node = document.createElementNS(NS, tag);
    attrs(node, values);
    if (parent) parent.appendChild(node);
    return node;
  };
  const h = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // 展示用页号：连字符换成不断行的 U+2011，避免 “J1-” 与 “1” 被拆行
  const shown = (label) => label.replace('-', '‑');
  const approxWidth = (text, size) => [...text].reduce(
    (w, ch) => w + (/[　-鿿＀-￯]/.test(ch) ? size : size * 0.6), 0);

  const els = {
    stage: $('stage'),
    clock: $('clock'),
    phase: $('phase'),
    caption: $('caption'),
    counts: $('counts'),
    sandWrap: $('sand-wrap'),
    svg: $('sand'),
    reset: $('reset'),
    previous: $('previous'),
    play: $('play'),
    playSymbol: $('play-symbol'),
    playLabel: $('play-label'),
    next: $('next'),
    progress: $('progress'),
    progressCaption: $('progress-caption'),
    speed: $('speed'),
    timeline: $('timeline'),
    capMinus: $('cap-minus'),
    capPlus: $('cap-plus'),
    capValue: $('cap-value'),
    cmpDirect: $('cmp-direct'),
    cmpSpool: $('cmp-spool'),
    cmpSaved: $('cmp-saved'),
    cmpDirectIdle: $('cmp-direct-idle'),
    cmpSpoolIdle: $('cmp-spool-idle'),
    motion: $('reduce-motion'),
    jobsSummary: $('jobs-summary'),
    notice: $('dependency-notice')
  };

  const state = {
    view: 'spool',
    printer: 4,
    capacity: 3,
    speed: 1,
    tall: false,
    t: 0,
    T: 0,
    times: [],
    runs: null,
    summary: null,
    totals: { in: 0, out: 0 },
    geo: null,
    refs: null,
    events: [],
    bars: [],
    keys: [],
    markers: [],
    playheadLabel: null,
    lastCaption: '',
    tl: null,
    glide: null,
    scrubbing: false,
    playing: false,
    reduceMotion: motionQuery.matches,
    stepper: null,
    linkReady: false,
    linkTimer: 0
  };

  // ───── 数据 ─────

  function buildRuns() {
    const params = { printPerPage: state.printer, inCapacity: state.capacity, outCapacity: state.capacity };
    const spool = M.simulateSpool(params);
    const direct = M.simulateDirect(params);
    for (const run of [spool, direct]) {
      run.sides = {
        in: run.pages.filter((p) => p.side === 'in'),
        out: run.pages.filter((p) => p.side === 'out')
      };
      run.firstCompute = run.acts.find((a) => a.lane === 'cpu' && a.kind === 'compute').start;
    }
    state.runs = { spool, direct };
    state.summary = { spool: M.summarize(spool), direct: M.summarize(direct) };
    state.times = M.boundaries([spool, direct]);
    state.T = Math.max(spool.end, direct.end) + 2;
    state.totals = { in: spool.sides.in.length, out: spool.sides.out.length };
  }

  const sideOf = (act) => (act.kind === 'write-well' || act.kind === 'print' || act.kind === 'print-direct' ? 'out' : 'in');
  const labelOf = (run, act) => shown(run.sides[sideOf(act)][act.page].label);
  const jobOf = (run, act) => run.jobs[act.job].name;
  const remain = (act, t) => Math.max(0, Math.ceil(act.end - t - EPS));
  const fraction = (act, t) => clamp((t - act.start) / (act.end - act.start), 0, 1);

  function waitedSoFar(run, t) {
    let total = 0;
    for (const act of run.acts) {
      if (act.lane !== 'cpu' || !WAIT_KINDS.has(act.kind)) continue;
      total += Math.max(0, Math.min(act.end, t) - act.start);
    }
    return Math.floor(total + EPS);
  }

  // ───── 几何：宽屏为一条水平流水线，竖屏为自上而下的一列 ─────

  function wellWidth(cap) {
    return Math.max(120, cap * CELL.w + (cap - 1) * CELL.gap + CELL.pad * 2);
  }

  function cellCenters(well, cap) {
    const span = cap * CELL.w + (cap - 1) * CELL.gap;
    const left = well.cx - span / 2;
    return Array.from({ length: cap }, (_, i) => ({
      x: left + i * (CELL.w + CELL.gap) + CELL.w / 2,
      y: well.cy
    }));
  }

  function wideGeometry(spool, cap) {
    const W = 1100;
    const H = 352;
    const wIn = wellWidth(cap);
    const parts = spool
      ? [['card', 120], ['in', wIn], ['cpu', 120], ['out', wIn], ['printer', 116]]
      : [['card', 120], ['cpu', 120], ['printer', 116]];
    const total = parts.reduce((sum, [, w]) => sum + w, 0);
    const gap = spool ? Math.min(64, (W - 56 - total) / (parts.length - 1)) : 230;
    let x = (W - (total + gap * (parts.length - 1))) / 2;
    const at = {};
    for (const [key, w] of parts) {
      at[key] = { left: x, right: x + w, cx: x + w / 2 };
      x += w + gap;
    }
    const nodes = {
      card: { cx: at.card.cx, cy: LY, left: at.card.left, right: at.card.right, top: LY - 52, bottom: LY + 52, w: 120, h: 104 },
      cpu: { cx: at.cpu.cx, cy: LY, left: at.cpu.cx - 60, right: at.cpu.cx + 60, top: LY - 60, bottom: LY + 60, r: 60 },
      printer: { cx: at.printer.cx, cy: LY, left: at.printer.left, right: at.printer.right, top: LY - 52, bottom: LY + 52, w: 116, h: 104 }
    };
    const wells = {};
    if (spool) {
      for (const side of ['in', 'out']) {
        const a = at[side];
        wells[side] = { cx: a.cx, cy: LY, left: a.left, right: a.right, top: LY - 40, bottom: LY + 40, hh: 40 };
      }
    }
    const titles = [
      { name: '卡片输入机', sub: '慢速输入', x: nodes.card.cx, y: LY - 92, subY: LY - 76 },
      { name: '用户进程', sub: 'CPU', x: nodes.cpu.cx, y: LY - 92, subY: LY - 76 },
      { name: '打印机', sub: '慢速输出', x: nodes.printer.cx, y: LY - 92, subY: LY - 76 }
    ];
    if (spool) {
      titles.push(
        { name: '输入井', sub: '磁盘', x: wells.in.cx, y: LY - 92, subY: LY - 76 },
        { name: '输出井', sub: '磁盘', x: wells.out.cx, y: LY - 92, subY: LY - 76 }
      );
    }
    const labels = spool
      ? [
        { text: '输入进程', x: (nodes.card.right + wells.in.left) / 2, y: LY - 92, cls: 'proc', anchor: 'middle' },
        { text: '输出进程', x: (wells.out.right + nodes.printer.left) / 2, y: LY - 92, cls: 'proc', anchor: 'middle' }
      ]
      : [
        { text: '同步读入', x: (nodes.card.right + nodes.cpu.left) / 2, y: LY - 18, cls: 'wire-label is-direct', anchor: 'middle' },
        { text: '同步打印', x: (nodes.cpu.right + nodes.printer.left) / 2, y: LY - 18, cls: 'wire-label is-direct', anchor: 'middle' }
      ];
    const wires = spool
      ? {
        'card-in': [nodes.card.right, LY, wells.in.left, LY],
        'in-cpu': [wells.in.right, LY, nodes.cpu.left, LY],
        'cpu-out': [nodes.cpu.right, LY, wells.out.left, LY],
        'out-printer': [wells.out.right, LY, nodes.printer.left, LY]
      }
      : {
        'card-cpu': [nodes.card.right, LY, nodes.cpu.left, LY],
        'cpu-printer': [nodes.cpu.right, LY, nodes.printer.left, LY]
      };
    const anchors = {
      cardOut: { x: nodes.card.right, y: LY },
      cpuIn: { x: nodes.cpu.left, y: LY },
      cpuOut: { x: nodes.cpu.right, y: LY },
      printerIn: { x: nodes.printer.left, y: LY },
      cellsIn: spool ? cellCenters(wells.in, cap) : [],
      cellsOut: spool ? cellCenters(wells.out, cap) : []
    };
    const spot = (node, dir) => (dir === 'below'
      ? { x: nodes[node].cx, y: LY + 104, anchor: 'middle' }
      : { x: nodes[node].cx, y: LY - 126, anchor: 'middle' });
    const statusAt = spool
      ? { in: { x: wells.in.cx, y: LY + 64, anchor: 'middle' }, out: { x: wells.out.cx, y: LY + 64, anchor: 'middle' } }
      : {};
    return { W, H, tall: false, nodes, wells, wires, labels, titles, anchors, spot, statusAt };
  }

  function tallGeometry(spool, cap) {
    const W = 440;
    const H = 712;
    const CX = 220;
    const wIn = wellWidth(cap);
    const y = spool
      ? { card: 92, in: 234, cpu: 364, out: 502, printer: 640 }
      : { card: 102, cpu: 362, printer: 622 };
    const nodes = {
      card: { cx: CX, cy: y.card, left: CX - 75, right: CX + 75, top: y.card - 40, bottom: y.card + 40, w: 150, h: 80 },
      cpu: { cx: CX, cy: y.cpu, left: CX - 50, right: CX + 50, top: y.cpu - 50, bottom: y.cpu + 50, r: 50 },
      printer: { cx: CX, cy: y.printer, left: CX - 75, right: CX + 75, top: y.printer - 40, bottom: y.printer + 40, w: 150, h: 80 }
    };
    const wells = {};
    if (spool) {
      for (const [side, cy] of [['in', y.in], ['out', y.out]]) {
        wells[side] = { cx: CX, cy, left: CX - wIn / 2, right: CX + wIn / 2, top: cy - 36, bottom: cy + 36, hh: 36 };
      }
    }
    const titleAt = (name, sub, cy) => ({ name, sub, x: 16, y: cy - 6, subY: cy + 12 });
    const titles = [
      titleAt('卡片输入机', '慢速输入', nodes.card.cy),
      titleAt('用户进程', 'CPU', nodes.cpu.cy),
      titleAt('打印机', '慢速输出', nodes.printer.cy)
    ];
    if (spool) {
      titles.push(titleAt('输入井', '磁盘', wells.in.cy), titleAt('输出井', '磁盘', wells.out.cy));
    }
    const mid = (a, b) => (a + b) / 2;
    const labels = spool
      ? [
        { text: '输入进程', x: CX - 34, y: mid(nodes.card.bottom, wells.in.top) + 4, cls: 'proc', anchor: 'end' },
        { text: '输出进程', x: CX - 34, y: mid(wells.out.bottom, nodes.printer.top) + 4, cls: 'proc', anchor: 'end' }
      ]
      : [
        { text: '同步读入', x: CX - 34, y: mid(nodes.card.bottom, nodes.cpu.top) + 4, cls: 'wire-label is-direct', anchor: 'end' },
        { text: '同步打印', x: CX - 34, y: mid(nodes.cpu.bottom, nodes.printer.top) + 4, cls: 'wire-label is-direct', anchor: 'end' }
      ];
    const wires = spool
      ? {
        'card-in': [CX, nodes.card.bottom, CX, wells.in.top],
        'in-cpu': [CX, wells.in.bottom, CX, nodes.cpu.top],
        'cpu-out': [CX, nodes.cpu.bottom, CX, wells.out.top],
        'out-printer': [CX, wells.out.bottom, CX, nodes.printer.top]
      }
      : {
        'card-cpu': [CX, nodes.card.bottom, CX, nodes.cpu.top],
        'cpu-printer': [CX, nodes.cpu.bottom, CX, nodes.printer.top]
      };
    const anchors = {
      cardOut: { x: CX, y: nodes.card.bottom },
      cpuIn: { x: CX, y: nodes.cpu.top },
      cpuOut: { x: CX, y: nodes.cpu.bottom },
      printerIn: { x: CX, y: nodes.printer.top },
      cellsIn: spool ? cellCenters(wells.in, cap) : [],
      cellsOut: spool ? cellCenters(wells.out, cap) : []
    };
    const spot = (node, dir) => {
      const n = nodes[node];
      if (dir === 'below' && node === 'printer') return { x: n.cx, y: n.bottom + 18, anchor: 'middle' };
      return { x: n.right + 12, y: n.cy, anchor: 'start' };
    };
    const statusAt = spool
      ? { in: { x: 16, y: y.in + 28, anchor: 'start' }, out: { x: 16, y: y.out + 28, anchor: 'start' } }
      : {};
    return { W, H, tall: true, nodes, wells, wires, labels, titles, anchors, spot, statusAt };
  }

  function geometryFor() {
    const spool = state.view === 'spool';
    return state.tall ? tallGeometry(spool, state.capacity) : wideGeometry(spool, state.capacity);
  }

  // ───── 舞台：一次性构建 SVG，之后每帧只更新属性 ─────

  function buildRectNode(parent, box, tone) {
    const group = svg('g', { class: 'node', 'data-tone': tone }, parent);
    svg('rect', { x: box.left, y: box.top, width: box.w, height: box.h, rx: 16, class: 'node-body' }, group);
    const main = svg('text', { x: box.cx, y: box.cy - 6, class: 'node-main' }, group);
    const sub = svg('text', { x: box.cx, y: box.cy + 14, class: 'node-sub' }, group);
    const barY = box.bottom - 15;
    svg('rect', { x: box.left + 16, y: barY, width: box.w - 32, height: 4, rx: 2, class: 'bar-track' }, group);
    const bar = svg('rect', { x: box.left + 16, y: barY, width: 0, height: 4, rx: 2, class: 'bar-fill' }, group);
    return { group, main, sub, bar, barW: box.w - 32 };
  }

  function buildCircleNode(parent, c, tone) {
    const group = svg('g', { class: 'node', 'data-tone': tone }, parent);
    svg('circle', { cx: c.cx, cy: c.cy, r: c.r, class: 'node-body' }, group);
    const ringR = c.r + 7;
    const circumference = 2 * Math.PI * ringR;
    svg('circle', { cx: c.cx, cy: c.cy, r: ringR, class: 'ring-track' }, group);
    const ring = svg('circle', {
      cx: c.cx,
      cy: c.cy,
      r: ringR,
      class: 'ring-fill',
      'stroke-dasharray': circumference.toFixed(2),
      'stroke-dashoffset': circumference.toFixed(2),
      transform: `rotate(-90 ${c.cx} ${c.cy})`
    }, group);
    const main = svg('text', { x: c.cx, y: c.cy - 4, class: 'node-main is-big' }, group);
    const sub = svg('text', { x: c.cx, y: c.cy + 15, class: 'node-sub' }, group);
    return { group, main, sub, ring, circumference };
  }

  function buildWellBody(parent, well, pos) {
    const { left, right, cx, top, bottom } = well;
    const rx = (right - left) / 2;
    svg('path', {
      d: `M${left},${top} L${left},${bottom} A${rx},9 0 0 0 ${right},${bottom} L${right},${top} Z`,
      class: 'well-body'
    }, parent);
    svg('ellipse', { cx, cy: top, rx, ry: 9, class: 'well-top' }, parent);
    return svg('text', { x: pos.x, y: pos.y, 'text-anchor': pos.anchor, class: 'well-status' }, parent);
  }

  function buildEvents(run) {
    const out = [];
    if (state.view === 'spool') {
      const first = run.acts.find((a) => a.kind === 'write-well' && a.page === 0);
      if (first) out.push({ t: first.end, node: 'cpu', dir: 'below', text: '写完即走，不等打印', tone: 'note', life: 2.6 });
      for (const a of run.acts) {
        if (a.kind === 'wait-slot') out.push({ t: a.start, node: 'card', dir: 'below', text: '井满，卡片机暂停', tone: 'warn', life: 2.6 });
        if (a.kind === 'wait-out') out.push({ t: a.start, node: 'cpu', dir: 'below', text: '输出井满，等待', tone: 'warn', life: 2.6 });
        if (a.lane === 'printer') out.push({ t: a.end, node: 'printer', dir: 'below', text: `${labelOf(run, a)} 印完`, tone: 'quiet', life: 1.4 });
      }
      out.push({ t: run.cpuDone, node: 'cpu', dir: 'above', text: `CPU 释放 · t ${run.cpuDone}`, tone: 'key', persist: true });
      out.push({ t: run.end, node: 'printer', dir: 'above', text: `全部印完 · t ${run.end}`, tone: 'key', persist: true });
    } else {
      const firstRead = run.acts.find((a) => a.kind === 'read-direct');
      const firstPrint = run.acts.find((a) => a.kind === 'print-direct');
      if (firstRead) out.push({ t: firstRead.start, node: 'cpu', dir: 'below', text: '同步读卡，CPU 空等', tone: 'warn', life: 2.6 });
      if (firstPrint) out.push({ t: firstPrint.start, node: 'cpu', dir: 'below', text: '同步打印，CPU 被占', tone: 'warn', life: 2.6 });
      out.push({ t: run.end, node: 'printer', dir: 'above', text: `全部完成 · t ${run.end}`, tone: 'key', persist: true });
    }
    return out;
  }

  function buildStage() {
    const geo = geometryFor();
    const run = state.runs[state.view];
    const spool = state.view === 'spool';
    state.geo = geo;
    const root = els.svg;
    root.replaceChildren();
    attrs(root, { viewBox: `0 0 ${geo.W} ${geo.H}` });
    els.sandWrap.classList.toggle('is-tall', geo.tall);

    const defs = svg('defs', {}, root);
    const marker = svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
    svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#B3B8AE' }, marker);
    const filter = svg('filter', { id: 'soft-shadow', x: '-20%', y: '-20%', width: '140%', height: '150%' }, defs);
    svg('feDropShadow', { dx: 0, dy: 2, stdDeviation: 3, 'flood-color': '#343C38', 'flood-opacity': 0.09 }, filter);

    const gWires = svg('g', {}, root);
    const gLabels = svg('g', {}, root);
    const gNodes = svg('g', {}, root);
    const gCells = svg('g', {}, root);
    const gChips = svg('g', {}, root);
    const gTags = svg('g', {}, root);

    const refs = { wires: {}, nodes: {}, cells: { in: [], out: [] }, wellStatus: {}, chips: new Map(), tags: [] };

    for (const [key, [x1, y1, x2, y2]] of Object.entries(geo.wires)) {
      refs.wires[key] = svg('line', { x1, y1, x2, y2, class: 'wire', 'marker-end': 'url(#arrow)' }, gWires);
    }
    for (const l of geo.labels) {
      svg('text', { x: l.x, y: l.y, class: l.cls, 'text-anchor': l.anchor }, gLabels).textContent = l.text;
    }
    for (const title of geo.titles) {
      const cls = geo.tall ? ' is-start' : '';
      svg('text', { x: title.x, y: title.y, class: `name${cls}` }, gLabels).textContent = title.name;
      svg('text', { x: title.x, y: title.subY, class: `sub${cls}` }, gLabels).textContent = title.sub;
    }

    refs.nodes.card = buildRectNode(gNodes, geo.nodes.card, 'green');
    refs.nodes.cpu = buildCircleNode(gNodes, geo.nodes.cpu, 'blue');
    refs.nodes.printer = buildRectNode(gNodes, geo.nodes.printer, 'gold');

    if (spool) {
      for (const side of ['in', 'out']) {
        refs.wellStatus[side] = buildWellBody(gNodes, geo.wells[side], geo.statusAt[side]);
        const cells = geo.anchors[side === 'in' ? 'cellsIn' : 'cellsOut'];
        refs.cells[side] = cells.map((p) => svg('rect', {
          x: p.x - CELL.w / 2,
          y: p.y - CELL.h / 2,
          width: CELL.w,
          height: CELL.h,
          rx: 6,
          class: `cell ${side}`
        }, gCells));
      }
    }

    for (const page of run.pages) {
      const group = svg('g', { class: `chip ${page.side}`, visibility: 'hidden' }, gChips);
      svg('rect', { width: CHIP.w, height: CHIP.h, rx: 6 }, group);
      svg('text', { x: CHIP.w / 2, y: CHIP.h / 2, class: 'chip-text' }, group).textContent = shown(page.label);
      refs.chips.set(page.id, group);
    }

    state.events = buildEvents(run);
    for (const ev of state.events) {
      const anchor = ev.node && geo.spot(ev.node, ev.dir);
      const w = approxWidth(ev.text, 12) + 20;
      const group = svg('g', { class: `tag tone-${ev.tone}`, visibility: 'hidden' }, gTags);
      const middle = anchor.anchor === 'middle';
      svg('rect', { x: middle ? -w / 2 : 0, y: -11, width: w, height: 22, rx: 11, class: 'tag-bg' }, group);
      svg('text', {
        x: middle ? 0 : 10,
        y: 0,
        class: 'tag-text',
        'text-anchor': middle ? 'middle' : 'start'
      }, group).textContent = ev.text;
      refs.tags.push({ ev, group, anchor });
    }
    state.refs = refs;
  }

  // ───── 每帧：按时刻 t 计算全部画面 ─────

  function pointOf(ref, role) {
    const a = state.geo.anchors;
    switch (ref.node) {
      case 'card': return a.cardOut;
      case 'cpu': return role === 'from' ? a.cpuOut : a.cpuIn;
      case 'printer': return a.printerIn;
      case 'in': return a.cellsIn[ref.slot];
      case 'out': return a.cellsOut[ref.slot];
      default: return a.cpuIn;
    }
  }

  function drawChips(snap) {
    const live = new Set();
    for (const c of snap.chips) {
      const node = state.refs.chips.get(c.id);
      if (!node) continue;
      if (c.phase === 'pending' || c.phase === 'gone') {
        node.setAttribute('visibility', 'hidden');
        continue;
      }
      let p;
      if (c.phase === 'move') {
        const { seg } = c;
        const a = pointOf(seg.from, 'from');
        const b = pointOf(seg.to, 'to');
        const f = clamp((snap.t - seg.t0) / (seg.t1 - seg.t0), 0, 1);
        p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        const key = WIRE_OF[`${seg.from.node}>${seg.to.node}`];
        if (key) live.add(key);
      } else {
        p = pointOf(c.seg.at, 'to');
      }
      node.setAttribute('visibility', 'visible');
      node.setAttribute('transform', `translate(${(p.x - CHIP.w / 2).toFixed(2)} ${(p.y - CHIP.h / 2).toFixed(2)})`);
    }
    for (const [key, line] of Object.entries(state.refs.wires)) {
      line.classList.toggle('is-live', live.has(key));
    }
  }

  function drawWells(snap) {
    if (state.view !== 'spool') return;
    for (const side of ['in', 'out']) {
      const used = snap.slots[side];
      let count = 0;
      state.refs.cells[side].forEach((cell, i) => {
        const on = Boolean(used[i]);
        if (on) count++;
        cell.classList.toggle('is-used', on);
      });
      const status = state.refs.wellStatus[side];
      const full = count === state.capacity;
      setText(status, full ? `已满 ${count}/${state.capacity}` : `占用 ${count}/${state.capacity}`);
      status.classList.toggle('is-full', full);
    }
  }

  function setBar(node, f) {
    node.bar.setAttribute('width', (node.barW * f).toFixed(2));
  }

  function drawNodes(snap, run) {
    const { card, cpu, printer } = state.refs.nodes;
    const t = snap.t;
    const totalIn = state.totals.in;
    const totalOut = state.totals.out;
    const spool = state.view === 'spool';

    const c = snap.card;
    const reading = Boolean(c && c.kind === 'read');
    const waitingSlot = Boolean(c && c.kind === 'wait-slot');
    if (reading) {
      setText(card.main, `读入 ${labelOf(run, c)}`);
      setText(card.sub, `剩 ${remain(c, t)}t`);
    } else if (waitingSlot) {
      setText(card.main, '井满，暂停');
      setText(card.sub, '等待井位');
    } else if (snap.read >= totalIn) {
      setText(card.main, '已全部读入');
      setText(card.sub, `${totalIn} 页`);
    } else {
      setText(card.main, '待命');
      setText(card.sub, `已读 ${snap.read}/${totalIn}`);
    }
    setBar(card, reading ? fraction(c, t) : 0);
    card.group.classList.toggle('is-busy', reading);
    card.group.classList.toggle('is-wait', waitingSlot);

    const p = snap.cpu;
    let main = '待命';
    let sub = '';
    let busy = false;
    let waiting = false;
    let frac = 0;
    if (p) {
      switch (p.kind) {
        case 'compute':
          main = '计算';
          sub = `${jobOf(run, p)} · 剩 ${remain(p, t)}t`;
          busy = true;
          frac = fraction(p, t);
          break;
        case 'read-well':
          main = '读入';
          sub = `${labelOf(run, p)} · 剩 ${remain(p, t)}t`;
          busy = true;
          frac = fraction(p, t);
          break;
        case 'write-well':
          main = '写出';
          sub = `${labelOf(run, p)} · 剩 ${remain(p, t)}t`;
          busy = true;
          frac = fraction(p, t);
          break;
        case 'wait-in':
          main = '等待';
          sub = '输入井无页';
          waiting = true;
          break;
        case 'wait-out':
          main = '等待';
          sub = '输出井已满';
          waiting = true;
          break;
        case 'read-direct':
          main = '阻塞';
          sub = `等卡片机 · ${labelOf(run, p)}`;
          waiting = true;
          break;
        case 'print-direct':
          main = '阻塞';
          sub = `等打印机 · ${labelOf(run, p)}`;
          waiting = true;
          break;
        default:
          break;
      }
    } else if (snap.cpuDone) {
      main = spool ? '空闲' : '完成';
      sub = spool ? '输出已交给井' : '全部作业结束';
    }
    setText(cpu.main, main);
    setText(cpu.sub, sub);
    cpu.group.classList.toggle('is-busy', busy);
    cpu.group.classList.toggle('is-wait', waiting);
    cpu.ring.setAttribute('stroke-dashoffset', (cpu.circumference * (1 - frac)).toFixed(2));

    const q = snap.printer;
    if (q) {
      setText(printer.main, `打印 ${labelOf(run, q)}`);
      setText(printer.sub, `剩 ${remain(q, t)}t`);
    } else if (snap.printed >= totalOut) {
      setText(printer.main, '全部印完');
      setText(printer.sub, `${totalOut} 页`);
    } else {
      const next = run.sides.out[snap.printed];
      setText(printer.main, '待命');
      setText(printer.sub, spool ? `等 ${shown(next.label)} 入井` : '等 CPU 送来');
    }
    setBar(printer, q ? fraction(q, t) : 0);
    printer.group.classList.toggle('is-busy', Boolean(q));
  }

  function drawTags(t) {
    for (const { ev, group, anchor } of state.refs.tags) {
      const age = t - ev.t;
      let opacity = 0;
      let rise = 0;
      if (age >= -EPS) {
        if (ev.persist) {
          opacity = clamp(age / 0.4, 0, 1);
        } else if (age <= ev.life) {
          opacity = Math.min(1, age / 0.25) * Math.min(1, (ev.life - age) / 0.7);
          rise = 6 * (age / ev.life);
        }
      }
      if (opacity <= 0) {
        group.setAttribute('visibility', 'hidden');
        continue;
      }
      group.setAttribute('visibility', 'visible');
      group.setAttribute('opacity', opacity.toFixed(3));
      group.setAttribute('transform', `translate(${anchor.x} ${(anchor.y - rise).toFixed(2)})`);
    }
  }

  function phaseOf(run, snap) {
    if (snap.t >= run.end - EPS) return '全部完成';
    if (state.view === 'direct') {
      if (snap.cpu && snap.cpu.kind === 'read-direct') return '同步读入';
      if (snap.cpu && snap.cpu.kind === 'print-direct') return '同步打印';
      return 'CPU 计算';
    }
    if (snap.cpuDone) return '收尾打印';
    if (snap.t < run.firstCompute - EPS) return '预读入井';
    if ((snap.card && snap.card.kind === 'wait-slot') || (snap.cpu && snap.cpu.kind === 'wait-out')) return '井满，等待';
    return '并行推进';
  }

  function captionFor(snap, run) {
    const lab = (act) => labelOf(run, act);
    const cpu = snap.cpu;
    const card = snap.card;
    const printer = snap.printer;
    if (snap.t >= run.end - EPS) {
      const idle = state.summary[state.view].cpuIdle;
      return state.view === 'spool'
        ? `全部打印完成。CPU 在设备上空等 ${idle}t，主要发生在最开始等第一页入井。`
        : `全部完成。CPU 在设备上空等了 ${idle}t，计算只占其中很小一部分。`;
    }
    if (state.view === 'direct') {
      if (!cpu) return '';
      if (cpu.kind === 'read-direct') return `CPU 同步等卡片机读入 ${lab(cpu)}，这段时间不能计算。`;
      if (cpu.kind === 'compute') return `CPU 计算 ${jobOf(run, cpu)}，此时两台设备都空着。`;
      if (cpu.kind === 'print-direct') return `CPU 同步等打印机输出 ${lab(cpu)}，打印结束前被占住。`;
      return '';
    }
    const parts = [];
    if (cpu) {
      switch (cpu.kind) {
        case 'wait-in': parts.push('CPU 在等下一页进入输入井。'); break;
        case 'read-well': parts.push(`CPU 从输入井取走 ${lab(cpu)}，井里腾出一格。`); break;
        case 'compute': parts.push(`CPU 计算 ${jobOf(run, cpu)}。`); break;
        case 'write-well': parts.push(`CPU 把 ${lab(cpu)} 写进输出井，写完立即继续。`); break;
        case 'wait-out': parts.push('输出井已满，CPU 只能等打印机取走一页。'); break;
        default: break;
      }
    } else if (snap.cpuDone) {
      parts.push('输出已全部交进输出井，CPU 空闲，打印机在收尾。');
    }
    if (card && card.kind === 'wait-slot') parts.push('输入井已满，卡片机暂停读入。');
    else if (card && card.kind === 'read') parts.push(`卡片机把 ${lab(card)} 送进输入井。`);
    else if (printer) parts.push(`打印机输出 ${lab(printer)}。`);
    return parts.slice(0, 2).join('');
  }

  function drawTimeline(t) {
    for (const bar of state.bars) {
      const { act } = bar;
      const status = t >= act.end - EPS ? 'done' : (t >= act.start - EPS ? 'active' : 'future');
      if (bar.status !== status) {
        bar.status = status;
        bar.el.dataset.state = status;
      }
    }
    for (const m of state.markers) m.el.classList.toggle('is-on', t >= m.at - EPS);
    for (const k of state.keys) k.classList.toggle('is-on', t >= Number(k.dataset.at) - EPS);
    els.timeline.style.setProperty('--p', (t / state.T).toFixed(5));
    setText(state.playheadLabel, `t ${Math.floor(t + EPS)}`);
  }

  function render(t) {
    state.t = t;
    const run = state.runs[state.view];
    const snap = M.stateAt(run, t);
    drawChips(snap);
    drawWells(snap);
    drawNodes(snap, run);
    drawTags(t);
    setText(els.clock, Math.floor(t + EPS));
    setText(els.phase, phaseOf(run, snap));
    const caption = captionFor(snap, run);
    if (caption !== state.lastCaption) {
      state.lastCaption = caption;
      setText(els.caption, caption);
    }
    setText(els.counts, `已读 ${snap.read}/${state.totals.in} · 已印 ${snap.printed}/${state.totals.out} · CPU 空等 ${waitedSoFar(run, t)}t`);
    drawTimeline(t);
    updateControls();
    if (!state.playing) syncLink();
  }

  // ───── 时间线（HTML，便于排版与横向滑动） ─────

  function barText(run, act) {
    switch (act.kind) {
      case 'read': return labelOf(run, act);
      case 'wait-slot': return '井满';
      case 'compute': return `计算 ${jobOf(run, act)}`;
      case 'read-well': return `取 ${labelOf(run, act)}`;
      case 'write-well': return `写 ${labelOf(run, act)}`;
      case 'wait-in': return '等输入';
      case 'wait-out': return '等井位';
      case 'read-direct': return '等卡片机';
      case 'print-direct': return '等打印机';
      case 'print': return labelOf(run, act);
      default: return '';
    }
  }

  function buildTimeline() {
    const root = els.timeline;
    root.replaceChildren();
    state.bars = [];
    state.keys = [];
    state.markers = [];
    const T = state.T;
    const pct = (v) => `${(v / T * 100).toFixed(4)}%`;
    const rows = [['card', '卡片输入机'], ['cpu', '用户进程（CPU）'], ['printer', '打印机']];
    const modes = [['spool', '有假脱机'], ['direct', '无假脱机']];

    for (const [mode, name] of modes) {
      const run = state.runs[mode];
      const group = h('div', 'tl-group');
      group.dataset.mode = mode;
      const head = h('div', 'tl-group-head');
      const title = h('span', 'tl-name');
      title.append(h('i', `dot dot-${mode}`), document.createTextNode(name));
      const keys = h('span', 'tl-keys');
      const keyDefs = mode === 'spool'
        ? [['CPU 释放', run.cpuDone], ['全部完成', run.end]]
        : [['全部完成', run.end]];
      for (const [label, at] of keyDefs) {
        const chip = h('button', 'key-chip', `${label} t ${at}`);
        chip.type = 'button';
        chip.title = `跳到 t ${at}`;
        chip.dataset.at = String(at);
        chip.addEventListener('click', () => jumpTo(at));
        keys.append(chip);
        state.keys.push(chip);
      }
      head.append(title, keys);
      group.append(head);

      const tracks = {};
      for (const [lane, label] of rows) {
        const row = h('div', 'tl-row');
        const track = h('div', 'tl-track');
        row.append(h('div', 'tl-label', label), track);
        group.append(row);
        tracks[lane] = track;
        for (const act of run.acts) {
          if (act.lane !== lane) continue;
          const text = act.end - act.start >= 2 ? barText(run, act) : '';
          const bar = h('div', `bar ${BAR_CLASS[act.kind] ?? ''}`, text);
          bar.style.left = pct(act.start);
          bar.style.width = pct(act.end - act.start);
          bar.title = `${barText(run, act)}（t ${act.start}–${act.end}）`;
          bar.dataset.state = 'future';
          track.append(bar);
          state.bars.push({ el: bar, act, status: 'future' });
        }
      }

      const addMarker = (track, at, solid) => {
        const line = h('div', solid ? 'marker is-solid' : 'marker');
        line.style.left = pct(at);
        track.append(line);
        state.markers.push({ el: line, at });
      };
      if (mode === 'spool') addMarker(tracks.cpu, run.cpuDone, false);
      addMarker(tracks.printer, run.end, true);
      root.append(group);
    }

    const axis = h('div', 'tl-row tl-axis');
    const axisTrack = h('div', 'tl-track');
    axis.append(h('div', 'tl-label', '时刻 t'), axisTrack);
    for (let k = 0; k <= T; k += 10) {
      const tick = h('span', 'axis-tick', String(k));
      tick.style.left = pct(k);
      axisTrack.append(tick);
    }
    root.append(axis);

    const playhead = h('div', 'playhead');
    state.playheadLabel = h('span', 'playhead-label', 't 0');
    playhead.append(state.playheadLabel);
    root.append(playhead);
  }

  function updateCompare() {
    const { spool, direct } = state.summary;
    setText(els.cmpDirect, direct.end);
    setText(els.cmpSpool, spool.end);
    setText(els.cmpSaved, `省 ${direct.end - spool.end}t`);
    setText(els.cmpDirectIdle, direct.cpuIdle);
    setText(els.cmpSpoolIdle, spool.cpuIdle);
    setText(els.jobsSummary, `${M.JOBS.map((job) => job.name).join(' · ')} · 卡片 ${state.totals.in} 页 · 打印 ${state.totals.out} 页`);
  }

  // ───── 地址栏状态：#t=&p=&cap=&v=，只用 replaceState，不增加历史记录 ─────

  function readLink() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const link = {};
    const t = Number(params.get('t'));
    if (params.has('t') && Number.isFinite(t)) link.t = t;
    const printer = Number(params.get('p'));
    if ([1, 2, 4].includes(printer)) link.printer = printer;
    const capacity = Number(params.get('cap'));
    if (Number.isInteger(capacity) && capacity >= 1 && capacity <= 6) link.capacity = capacity;
    const view = params.get('v');
    if (view === 'spool' || view === 'direct') link.view = view;
    return link;
  }

  function writeLink() {
    state.linkTimer = 0;
    const params = new URLSearchParams({
      t: String(Number(state.t.toFixed(2))),
      p: String(state.printer),
      cap: String(state.capacity),
      v: state.view
    });
    try {
      history.replaceState(null, '', `#${params.toString()}`);
    } catch {
      // 某些本地文件环境不允许改写地址，演示照常可用
    }
  }

  // 暂停或停下时立即写回；拖动与逐步过程中合并为一次写入
  function syncLink(now = false) {
    if (!state.linkReady) return;
    clearTimeout(state.linkTimer);
    if (now) writeLink();
    else state.linkTimer = setTimeout(writeLink, LINK_DELAY);
  }

  function setChecked(name, value) {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  }

  // ───── 时钟与控件 ─────

  const isPlaying = () => state.playing;

  function updateControls() {
    const t = state.t;
    const playing = isPlaying();
    els.stage.classList.toggle('is-running', playing);
    els.previous.disabled = t <= EPS;
    els.next.disabled = t >= state.T - EPS;
    setText(els.playLabel, playing ? '暂停' : (t >= state.T - EPS ? '再播放' : '播放'));
    setText(els.playSymbol, playing ? 'Ⅱ' : '▶');
    els.play.dataset.running = String(playing);
    els.play.disabled = !state.tl;
    if (!state.scrubbing) els.progress.value = t.toFixed(2);
    setText(els.progressCaption, `t ${Math.floor(t + EPS)} / ${state.T}`);
    els.capMinus.disabled = state.capacity <= 1;
    els.capPlus.disabled = state.capacity >= 6;
  }

  function cancelGlide() {
    if (state.glide) {
      state.glide.kill();
      state.glide = null;
    }
  }

  function syncClock() {
    if (state.tl) state.tl.time(state.t * TICK);
  }

  // 直接跳到某一时刻（拖动、复位、参数变化后使用）
  function seek(t) {
    cancelGlide();
    const target = clamp(t, 0, state.T);
    if (state.tl) {
      state.tl.pause();
      state.tl.time(target * TICK);
    }
    render(target);
  }

  // 单步：平滑滑到下一个事件时刻，便于看清每一拍的因果
  function stepTo(target) {
    cancelGlide();
    pause();
    const dest = clamp(target, 0, state.T);
    const dist = Math.abs(dest - state.t);
    if (!window.gsap || state.reduceMotion || dist < EPS) {
      seek(dest);
      return;
    }
    const glide = { v: state.t };
    state.glide = window.gsap.to(glide, {
      v: dest,
      duration: clamp(dist * 0.12, 0.25, 0.8),
      ease: 'power1.inOut',
      onUpdate: () => render(glide.v),
      onComplete: () => {
        state.glide = null;
        render(dest);
        syncClock();
      }
    });
  }

  function play() {
    if (!state.tl) return;
    cancelGlide();
    if (state.t >= state.T - EPS) seek(0);
    state.playing = true;
    if (state.reduceMotion) {
      scheduleStep();
    } else {
      syncClock();
      state.tl.play();
    }
    updateControls();
  }

  function pause() {
    if (!state.tl) return;
    state.playing = false;
    stopStepper();
    state.tl.pause();
    updateControls();
    syncLink(true);
  }

  function finishPlayback() {
    state.playing = false;
    stopStepper();
    updateControls();
    syncLink(true);
  }

  // 减少动效：不做补间，每个事件时刻直接跳过去，停留一小段时间再跳下一个
  function scheduleStep() {
    state.stepper = window.gsap.delayedCall(STEP_SEC / state.speed, advanceStep);
  }

  function advanceStep() {
    state.stepper = null;
    if (!state.playing) return;
    const target = nextBoundary();
    seek(target);
    if (target >= state.T - EPS) finishPlayback();
    else scheduleStep();
  }

  function stopStepper() {
    if (state.stepper) {
      state.stepper.kill();
      state.stepper = null;
    }
  }

  // 直接定位到某一时刻并暂停（时间线点击、时刻键）
  function jumpTo(t) {
    pause();
    seek(t);
  }

  // 减少动效跟随系统设置，页面上的开关可以改；正在播放时换一种方式从当前时刻续播
  function applyMotion(reduce) {
    state.reduceMotion = reduce;
    els.motion.checked = reduce;
    document.body.dataset.motion = reduce ? 'reduce' : 'full';
  }

  function setMotion(reduce) {
    const wasPlaying = isPlaying();
    pause();
    applyMotion(reduce);
    if (wasPlaying) play();
  }

  function togglePlay() {
    if (isPlaying()) pause();
    else play();
  }

  function nextBoundary() {
    return state.times.find((x) => x > state.t + EPS) ?? state.T;
  }

  function prevBoundary() {
    const earlier = state.times.filter((x) => x < state.t - EPS);
    return earlier.length ? earlier[earlier.length - 1] : 0;
  }

  function killClock() {
    cancelGlide();
    stopStepper();
    state.playing = false;
    if (state.tl) {
      state.tl.kill();
      state.tl = null;
    }
  }

  function buildClock() {
    killClock();
    if (!window.gsap) {
      els.notice.hidden = false;
      return;
    }
    els.notice.hidden = true;
    const tl = window.gsap.timeline({
      paused: true,
      onUpdate: () => render(tl.time() / TICK),
      onComplete: finishPlayback
    });
    tl.to({}, { duration: state.T * TICK, ease: 'none' });
    tl.timeScale(state.speed);
    state.tl = tl;
  }

  // 参数变化：重算推演、重建舞台与时间线，保留当前时刻（超出新长度时取末尾），并暂停
  function rebuild() {
    const keep = state.t;
    killClock();
    buildRuns();
    updateCompare();
    buildStage();
    buildTimeline();
    els.progress.max = String(state.T);
    buildClock();
    seek(keep);
  }

  function bindControls() {
    document.querySelectorAll('input[name="view"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        state.view = input.value;
        buildStage();
        render(state.t);
      });
    });

    document.querySelectorAll('input[name="printer"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        state.printer = Number(input.value);
        rebuild();
      });
    });

    const setCapacity = (value) => {
      state.capacity = clamp(value, 1, 6);
      setText(els.capValue, `${state.capacity} 页`);
      rebuild();
    };
    els.capMinus.addEventListener('click', () => setCapacity(state.capacity - 1));
    els.capPlus.addEventListener('click', () => setCapacity(state.capacity + 1));

    els.speed.addEventListener('change', () => {
      state.speed = Number(els.speed.value);
      if (state.tl) state.tl.timeScale(state.speed);
    });

    els.motion.addEventListener('change', () => setMotion(els.motion.checked));
    motionQuery.addEventListener('change', (event) => setMotion(event.matches));

    els.timeline.addEventListener('click', (event) => {
      const track = event.target instanceof Element ? event.target.closest('.tl-track') : null;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      jumpTo(clamp((event.clientX - rect.left) / rect.width, 0, 1) * state.T);
    });

    els.play.addEventListener('click', togglePlay);
    els.next.addEventListener('click', () => stepTo(nextBoundary()));
    els.previous.addEventListener('click', () => stepTo(prevBoundary()));
    els.reset.addEventListener('click', () => {
      pause();
      seek(0);
    });

    const scrub = els.progress;
    scrub.addEventListener('pointerdown', () => { state.scrubbing = true; pause(); });
    scrub.addEventListener('keydown', () => { state.scrubbing = true; pause(); });
    scrub.addEventListener('input', () => seek(Number(scrub.value)));
    scrub.addEventListener('change', () => { state.scrubbing = false; });
    scrub.addEventListener('pointerup', () => { state.scrubbing = false; });
    scrub.addEventListener('blur', () => { state.scrubbing = false; });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, select, textarea, button, a')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      if (event.code === 'ArrowRight') { event.preventDefault(); stepTo(nextBoundary()); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); stepTo(prevBoundary()); }
      if (event.code === 'Home') { event.preventDefault(); pause(); seek(0); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  }

  function init() {
    state.speed = Number(els.speed.value);
    const link = readLink();
    if (link.printer) setChecked('printer', link.printer);
    if (link.view) setChecked('view', link.view);
    const printer = document.querySelector('input[name="printer"]:checked');
    const view = document.querySelector('input[name="view"]:checked');
    state.printer = printer ? Number(printer.value) : 4;
    state.view = view ? view.value : 'spool';
    state.capacity = link.capacity ?? state.capacity;
    state.tall = els.sandWrap.clientWidth < TALL_BELOW;
    setText(els.capValue, `${state.capacity} 页`);
    applyMotion(state.reduceMotion);

    buildRuns();
    updateCompare();
    buildStage();
    buildTimeline();
    els.progress.max = String(state.T);
    buildClock();
    bindControls();
    seek(link.t ?? 0);
    state.linkReady = true;

    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        const tall = els.sandWrap.clientWidth < TALL_BELOW;
        if (tall !== state.tall) {
          state.tall = tall;
          buildStage();
          render(state.t);
        }
      }).observe(els.sandWrap);
    }
  }

  init();
})();
