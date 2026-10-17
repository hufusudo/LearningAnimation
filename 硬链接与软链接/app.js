/**
 * 硬链接与软链接：同一剧本，上下两行各为一套文件系统，并排对照。
 * 时钟 t 只推进时间；render(t) 每一帧由 t 直接算出两行的槽位、连线、探针、面包屑与浮标，
 * 不依赖历史动画，因此拖动、倒退、暂停都能精确重绘。文件系统语义全部来自 model.js。
 */
(function () {
  'use strict';

  const M = window.LinkModel;
  const TICK = 0.25;                        // 1t 在 1× 速度下为 0.25 s
  const OP_LEN = 20;                        // 每个操作占 20t，约 5 秒
  const T = OP_LEN * 5;                     // 全程 100t
  const BOUNDS = [0, 20, 40, 60, 80, 100];  // 上一步／下一步停靠的操作边界
  const COMMIT = 0.45;                      // 计数与数值在操作进行到此处切换
  const LIFE = 8;                           // 普通浮标的显示时长（t）
  const EPS = 1e-6;
  const NS = 'http://www.w3.org/2000/svg';
  const STEP_SEC = 0.9;                     // 减少动效时，每个操作边界停留的秒数（1× 速度）
  const LINK_DELAY = 300;                   // 地址栏写回的防抖时间（毫秒）
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  const WORLDS = ['hard', 'soft'];
  const ROW_Y = { hard: 0, soft: 200 };
  const ROW_TITLE = { hard: '硬链接', soft: '软链接' };
  const LINK_NAME = { hard: 'report-hard', soft: 'report-soft' };
  const KEYS = ['d1', 'd2', 'i10', 'i20', 'b5', 'b6'];
  const SLOT_H = 60;
  const SLOT = {
    d1: { x: 210, y: 46, w: 230 },
    d2: { x: 210, y: 118, w: 230 },
    i10: { x: 500, y: 46, w: 220 },
    i20: { x: 500, y: 118, w: 220 },
    b5: { x: 800, y: 46, w: 260 },
    b6: { x: 800, y: 118, w: 260 }
  };
  const FREE_TEXT = {
    d1: '（空）',
    d2: '（空）',
    i10: 'inode 10 · 空闲',
    i20: 'inode 20 · 空闲',
    b5: '盘块 5 · 空闲',
    b6: '盘块 6 · 空闲'
  };
  const CARD_TEXT = {
    i10: 'inode 10 · 普通文件',
    i20: 'inode 20 · 符号链接',
    b5: '盘块 5 · 数据',
    b6: '盘块 6 · 路径'
  };
  const CARD_BODY = { b5: M.CONTENT, b6: M.TARGET };
  const TONE = { b5: 'is-data', b6: 'is-path' };
  // 行内锚点（行坐标）：探针与路径解析的落点
  const ANCHOR = {
    d1r: [440, 76],
    d2r: [440, 148],
    i1l: [500, 76],
    i2l: [500, 148],
    b1l: [800, 76],
    b2l: [800, 148],
    hdr: [372, 30]
  };
  // 浮标的锚点：只决定横向位置，同一锚点的并发浮标用 dx 错开
  const TAG_X = { i1: 500, i2: 500, b1: 800, b2: 800, hdr: 210 };
  const DEFAULT_APPEAR = [0.1, 0.35];
  const DEFAULT_VANISH = [0.05, 0.3];

  const INITIAL = '原文件 report.txt 指向 inode 10，数据 Hello 存在盘块 5。';
  const OPS = [
    { phase: '① 建立链接', caption: '硬链接只加目录项、共用 inode 10；软链接新建 inode 20 存路径。' },
    { phase: '② 访问', caption: '硬链接直接找到数据；软链接先读出路径，再从根逐段解析。' },
    { phase: '③ 删除原文件', caption: '删 report.txt：硬链接 nlink 2→1，数据保留；软链接的目标已释放。' },
    { phase: '④ 再次访问', caption: '硬链接仍读到 Hello；软链接解析到 report.txt 时找不到目标。' },
    { phase: '⑤ 删除链接', caption: '删链接：硬链接 nlink 归零才释放数据；软链接只释放自身。' }
  ];

  // 每个操作、每一侧的动画编排（p 为操作内进度，0–1）。
  // appear／vanish：对象出现与消失的窗口；reads：盘块的读取高亮；walk：路径面包屑的逐段高亮；
  // miss：路径在某段找不到（之后该段变红）；probe：探针沿直线移动的路段；tags：浮标。
  const PLAN = [
    { // ① 建立链接
      hard: {
        appear: { d2: [0.1, 0.35] },
        tags: [
          { at: 0.45, tone: 'key', text: '共用 inode 10', anchor: 'i1', until: [2, 0.45] },
          { at: 0.5, tone: 'note', text: '不新建 inode', anchor: 'hdr' }
        ]
      },
      soft: {
        appear: { i20: [0.1, 0.3], b6: [0.3, 0.5], d2: [0.5, 0.7] },
        tags: [
          { at: 0.3, tone: 'note', text: '新建 inode 20', anchor: 'i2' },
          { at: 0.5, tone: 'note', text: '路径存入盘块 6', anchor: 'b2' }
        ]
      }
    },
    { // ② 访问
      hard: {
        probe: [
          { a: 0.05, b: 0.25, from: 'd2r', to: 'i1l' },
          { a: 0.25, b: 0.5, from: 'i1l', to: 'b1l' }
        ],
        reads: { b5: [0.5, 0.62] },
        tags: [{ at: 0.62, tone: 'note', text: '直达：读出 Hello', anchor: 'b1' }]
      },
      soft: {
        probe: [
          { a: 0.05, b: 0.14, from: 'd2r', to: 'i2l' },
          { a: 0.14, b: 0.3, from: 'i2l', to: 'b2l', color: 'gold' },
          { a: 0.74, b: 0.8, from: 'hdr', to: 'd1r' },
          { a: 0.8, b: 0.83, from: 'd1r', to: 'i1l' },
          { a: 0.83, b: 0.89, from: 'i1l', to: 'b1l' }
        ],
        reads: { b6: [0.3, 0.36], b5: [0.89, 0.96] },
        walk: { '/': [0.36, 0.46], home: [0.46, 0.56], user: [0.56, 0.66], 'report.txt': [0.66, 0.74] },
        tags: [
          { at: 0.14, tone: 'note', text: '先读出路径', anchor: 'i2' },
          { at: 0.36, tone: 'note', text: '再从根逐段解析', anchor: 'hdr' }
        ]
      }
    },
    { // ③ 删除原文件
      hard: {
        vanish: { d1: [0.05, 0.3] },
        tags: [{ at: 0.45, tone: 'note', text: 'nlink 2 → 1 · 数据保留', anchor: 'i1' }]
      },
      soft: {
        vanish: { d1: [0.05, 0.3], i10: [0.45, 0.75], b5: [0.5, 0.8] },
        tags: [
          { at: 0.45, tone: 'key', text: '悬空：目标已删', anchor: 'hdr', until: [4, 0.45] },
          { at: 0.45, tone: 'warn', text: 'inode 10 释放', anchor: 'i1' },
          { at: 0.5, tone: 'quiet', text: '盘块 5 释放', anchor: 'b1' }
        ]
      }
    },
    { // ④ 再次访问
      hard: {
        probe: [
          { a: 0.05, b: 0.25, from: 'd2r', to: 'i1l' },
          { a: 0.25, b: 0.5, from: 'i1l', to: 'b1l' }
        ],
        reads: { b5: [0.5, 0.62] },
        tags: [{ at: 0.62, tone: 'note', text: '仍读到 Hello', anchor: 'b1' }]
      },
      soft: {
        probe: [
          { a: 0.05, b: 0.14, from: 'd2r', to: 'i2l' },
          { a: 0.14, b: 0.3, from: 'i2l', to: 'b2l', color: 'gold' }
        ],
        reads: { b6: [0.3, 0.36] },
        walk: { '/': [0.36, 0.46], home: [0.46, 0.56], user: [0.56, 0.66], 'report.txt': [0.66, 0.74] },
        miss: 0.66,
        tags: [{ at: 0.74, tone: 'break', text: '找不到目标', anchor: 'hdr', dx: 150 }]
      }
    },
    { // ⑤ 删除链接
      hard: {
        vanish: { d2: [0.05, 0.3], i10: [0.45, 0.75], b5: [0.5, 0.8] },
        tags: [
          { at: 0.45, tone: 'quiet', text: 'nlink → 0', anchor: 'i1' },
          { at: 0.45, tone: 'key', text: '数据释放', anchor: 'b1' }
        ]
      },
      soft: {
        vanish: { d2: [0.05, 0.3], i20: [0.45, 0.75], b6: [0.5, 0.8] },
        tags: [{ at: 0.45, tone: 'quiet', text: '只释放自身', anchor: 'i2' }]
      }
    }
  ];

  // 时间线上每个操作的文字与颜色（两行同一套，便于同钟对照）
  const BAR_TEXT = {
    hard: ['nlink 1 → 2', '直达：读出 Hello', 'nlink 2 → 1', '仍读到 Hello', 'nlink → 0 · 释放'],
    soft: ['新建 inode 20', '读路径后逐段解析', '释放 inode 10', '找不到目标', '只释放自身']
  };
  const BAR_CLASS = ['k-create', 'k-access', 'k-remove', 'k-access', 'k-release'];
  // 时间线上的关键时刻按钮：点击跳到该事件发生的时刻
  const KEY_CHIPS = [
    { world: 'hard', text: '数据释放', k: 4, at: 0.45 },
    { world: 'soft', text: '悬空', k: 2, at: 0.45 }
  ];

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const eventT = (k, p) => (k + p) * OP_LEN;
  const ramp = (p, a, b) => {
    if (p <= a) return 0;
    if (p >= b) return 1;
    const s = (p - a) / (b - a);
    return s * s * (3 - 2 * s);
  };
  const inWindow = (win, p, staticHL) => Boolean(win) && (staticHL || (p >= win[0] && p <= win[1]));
  const setText = (node, value) => {
    const s = String(value);
    if (node.textContent !== s) node.textContent = s;
  };
  const setAttr = (node, name, value) => {
    const s = String(value);
    if (node.getAttribute(name) !== s) node.setAttribute(name, s);
  };
  const setClass = (node, cls, on) => {
    if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
  };
  const svgEl = (tag, attrs, parent) => {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs || {})) node.setAttribute(name, String(value));
    if (parent) parent.appendChild(node);
    return node;
  };
  const textWidth = (text) => [...text].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 12 : 7), 0);
  const pathD = ([x1, y1], [x2, y2]) => (y1 === y2
    ? `M${x1} ${y1} L${x2} ${y2}`
    : `M${x1} ${y1} C${x1 + 30} ${y1} ${x2 - 30} ${y2} ${x2} ${y2}`);

  const els = {
    svg: $('sand'),
    stage: document.querySelector('.stage'),
    clock: $('clock'),
    phase: $('phase'),
    caption: $('caption'),
    reset: $('reset'),
    previous: $('previous'),
    play: $('play'),
    playSymbol: $('play-symbol'),
    playLabel: $('play-label'),
    next: $('next'),
    progress: $('progress'),
    progressCaption: $('progress-caption'),
    speed: $('speed'),
    motion: $('reduce-motion'),
    timeline: $('timeline'),
    notice: $('dependency-notice'),
    playheadLabel: null
  };

  const state = {
    t: 0,
    playing: false,
    speed: 1,
    reduce: false,
    tl: null,
    stepper: null,
    glide: null,
    scrubbing: false,
    linkTimer: 0,
    linkReady: false,
    snap: {},   // snap[w][i]：第 i 个状态中各对象的快照
    sums: {},   // sums[w][i]：第 i 个状态的统计
    refs: {},   // refs[w]：该行的 SVG 节点引用
    bars: []    // 时间线上的操作条
  };

  // ───── 数据准备：模型推演一次，之后画面只读快照 ─────

  function snapshot(w, fs) {
    const entries = fs.inodes[M.USER].entries;
    const dentry = (name) => (entries[name] === undefined ? null : { id: entries[name] });
    const inode = (id) => (fs.inodes[id] ? { nlink: fs.inodes[id].nlink } : null);
    const block = (id) => (fs.blocks[id] ? { data: fs.blocks[id].data } : null);
    return {
      d1: dentry('report.txt'),
      d2: dentry(LINK_NAME[w]),
      i10: inode(10),
      i20: inode(20),
      b5: block(5),
      b6: block(6)
    };
  }

  function prepare() {
    for (const w of WORLDS) {
      const run = M.simulate(w);
      state.snap[w] = run.states.map((fs) => snapshot(w, fs));
      state.sums[w] = run.states.map((fs) => M.summarize(fs));
    }
  }

  // 时刻 → 操作序号 k（−1 为初始状态）与操作内进度 p
  function locate(t) {
    if (t <= EPS) return { k: -1, p: 0 };
    const k = Math.min(4, Math.ceil(t / OP_LEN) - 1);
    return { k, p: clamp((t - k * OP_LEN) / OP_LEN, 0, 1) };
  }

  // 对象在本步的可见度：只存在于之后的状态时淡入，只存在于之前的状态时淡出，两侧都有或都没有时保持
  function usedAlpha(key, sb, sa, plan, p) {
    const before = Boolean(sb[key]);
    const after = Boolean(sa[key]);
    if (before === after) return after ? 1 : 0;
    if (after) return ramp(p, ...((plan && plan.appear && plan.appear[key]) || DEFAULT_APPEAR));
    return 1 - ramp(p, ...((plan && plan.vanish && plan.vanish[key]) || DEFAULT_VANISH));
  }

  // 对象显示的内容：数值在 COMMIT 时切换；消失中的 inode 在切换后显示 nlink 0
  function displayOf(key, sb, sa, p) {
    const b = sb[key];
    const a = sa[key];
    if (b && a) return p >= COMMIT ? a : b;
    if (b) return p >= COMMIT && key[0] === 'i' ? { ...b, nlink: 0 } : b;
    return a;
  }

  // 探针位置：沿当前路段的起止锚点线性插值，不回弹
  function probePos(plan, p, staticHL) {
    if (!plan || !plan.probe || staticHL) return null;
    const seg = plan.probe.find((s) => p >= s.a && p <= s.b);
    if (!seg) return null;
    const u = (p - seg.a) / (seg.b - seg.a);
    const [x1, y1] = ANCHOR[seg.from];
    const [x2, y2] = ANCHOR[seg.to];
    return { x: x1 + (x2 - x1) * u, y: y1 + (y2 - y1) * u, color: seg.color || 'blue' };
  }

  // ───── 构建 SVG（只在启动时建一次，之后只改属性与文字） ─────

  function arrow(defs, id, color) {
    const marker = svgEl('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, defs);
    svgEl('path', { d: 'M0 0 L10 5 L0 10 z', fill: color }, marker);
  }

  function buildCrumbs(g) {
    const text = svgEl('text', { x: 210, y: 36, class: 'crumbs' }, g);
    const span = (cls, label) => {
      const node = svgEl('tspan', { class: cls }, text);
      node.textContent = label;
      return node;
    };
    const sep = (cls) => span(`sep ${cls || ''}`.trim(), ' › ');
    const crumbs = {};
    crumbs['/'] = span('crumb', '/');
    sep();
    crumbs.home = span('crumb', 'home');
    sep();
    crumbs.user = span('crumb', 'user');
    crumbs.sepRT = sep('sep-rt');
    crumbs['report.txt'] = span('crumb', 'report.txt');
    return crumbs;
  }

  function buildSlot(g, w, key) {
    const geo = SLOT[key];
    const tone = TONE[key] || '';
    const used = svgEl('g', { class: `slot ${tone}`.trim() }, g);
    const card = svgEl('rect', { x: geo.x, y: geo.y, width: geo.w, height: SLOT_H, rx: 10, class: `card ${tone}`.trim() }, used);
    const title = svgEl('text', { x: geo.x + 14, y: geo.y + 24, class: 'card-title' }, used);
    const body = svgEl('text', { x: geo.x + 14, y: geo.y + 45, class: 'card-body' }, used);
    const free = svgEl('g', { class: 'slot' }, g);
    svgEl('rect', { x: geo.x, y: geo.y, width: geo.w, height: SLOT_H, rx: 10, class: 'free' }, free);
    svgEl('text', { x: geo.x + 14, y: geo.y + 36, class: 'free-text' }, free).textContent = FREE_TEXT[key];
    if (key === 'd1') title.textContent = 'report.txt';
    else if (key === 'd2') title.textContent = LINK_NAME[w];
    else title.textContent = CARD_TEXT[key];
    if (CARD_BODY[key]) body.textContent = CARD_BODY[key];
    return { key, used, card, title, body, free };
  }

  function buildTags(g, w) {
    const layer = svgEl('g', { class: 'tags', 'aria-hidden': 'true' }, g);
    const tags = [];
    PLAN.forEach((step, k) => {
      for (const ev of step[w].tags || []) {
        const el = svgEl('g', { class: `tag tone-${ev.tone}` }, layer);
        svgEl('rect', { x: 0, y: 0, width: textWidth(ev.text) + 20, height: 22, rx: 11, class: 'tag-bg' }, el);
        svgEl('text', { x: 10, y: 11, class: 'tag-text' }, el).textContent = ev.text;
        tags.push({
          el,
          x: (TAG_X[ev.anchor] ?? 210) + (ev.dx || 0),
          te: eventT(k, ev.at),
          key: ev.tone === 'key',
          until: ev.until ? eventT(ev.until[0], ev.until[1]) : Infinity
        });
      }
    });
    return tags;
  }

  function buildRow(w) {
    const g = svgEl('g', { class: 'row', 'data-world': w, transform: `translate(0 ${ROW_Y[w]})` }, els.svg);
    const label = svgEl('g', { class: 'row-label' }, g);
    svgEl('text', { x: 24, y: 40, class: 'row-title' }, label).textContent = ROW_TITLE[w];
    svgEl('text', { x: 24, y: 62, class: 'row-sub' }, label).textContent = LINK_NAME[w];
    const count = svgEl('text', { x: 24, y: 84, class: 'row-count' }, label);
    const read = svgEl('text', { x: 24, y: 104, class: 'row-read' }, label);
    const crumbs = buildCrumbs(g);
    svgEl('text', { x: 500, y: 36, class: 'col-head' }, g).textContent = 'inode 表';
    svgEl('text', { x: 800, y: 36, class: 'col-head' }, g).textContent = '数据块';
    const links = svgEl('g', { class: 'links' }, g);
    const lineDefs = [
      { from: 'd1', to: 'i10', a: ANCHOR.d1r, b: ANCHOR.i1l, data: false },
      { from: 'd2', to: w === 'hard' ? 'i10' : 'i20', a: ANCHOR.d2r, b: w === 'hard' ? ANCHOR.i1l : ANCHOR.i2l, data: false },
      { from: 'i10', to: 'b5', a: [720, 76], b: ANCHOR.b1l, data: true },
      { from: 'i20', to: 'b6', a: [720, 148], b: ANCHOR.b2l, data: true }
    ];
    const lines = lineDefs.map((ln) => ({
      from: ln.from,
      to: ln.to,
      el: svgEl('path', {
        d: pathD(ln.a, ln.b),
        class: ln.data ? 'link-data' : 'link-line',
        'marker-end': `url(#${ln.data ? 'arr-data' : 'arr-ink'})`
      }, links)
    }));
    const slots = {};
    for (const key of KEYS) slots[key] = buildSlot(g, w, key);
    const probe = svgEl('circle', { r: 6, class: 'probe', opacity: 0 }, g);
    return { w, count, read, crumbs, lines, slots, probe, tags: buildTags(g, w) };
  }

  function buildStage() {
    const defs = svgEl('defs', {}, els.svg);
    arrow(defs, 'arr-ink', '#8E9889');
    arrow(defs, 'arr-data', '#3E9C78');
    svgEl('line', { x1: 24, y1: 195, x2: 1076, y2: 195, class: 'divider' }, els.svg);
    for (const w of WORLDS) state.refs[w] = buildRow(w);
  }

  function buildTimeline() {
    const ticks = BOUNDS.map((x) => `<span class="axis-tick" style="left:${(x / T) * 100}%">${x}</span>`).join('');
    const groups = WORLDS.map((w) => {
      const chip = KEY_CHIPS.find((c) => c.world === w);
      const chipT = eventT(chip.k, chip.at);
      const bars = BAR_TEXT[w].map((text, k) => (
        `<div class="bar ${BAR_CLASS[k]}" data-k="${k}" style="left:calc(${k * 20}% + 2px)">${text}</div>`
      )).join('');
      return `
        <div class="tl-group" data-world="${w}">
          <div class="tl-group-head">
            <span class="tl-name"><i class="dot"></i>${ROW_TITLE[w]}</span>
            <span class="tl-keys"><button type="button" class="key-chip" data-jump="${chipT}">${chip.text} · t ${Math.round(chipT)}</button></span>
          </div>
          <div class="tl-row">
            <span class="tl-label">${LINK_NAME[w]}</span>
            <div class="tl-track" data-world="${w}">${bars}</div>
          </div>
        </div>`;
    }).join('');
    els.timeline.innerHTML = `
      <div class="tl-row tl-axis"><span class="tl-label"></span><div class="tl-track">${ticks}</div></div>
      ${groups}
      <div class="playhead" aria-hidden="true"><span class="playhead-label" id="playhead-label">t 0</span></div>`;
    state.bars = [...els.timeline.querySelectorAll('.bar')];
    els.playheadLabel = $('playhead-label');
  }

  // ───── 每帧渲染：只由 t 决定 ─────

  function renderCrumbs(row, plan, p, staticHL) {
    const c = row.crumbs;
    for (const name of ['/', 'home', 'user']) {
      setClass(c[name], 'is-on', inWindow(plan && plan.walk && plan.walk[name], p, staticHL));
    }
    const walking = inWindow(plan && plan.walk && plan.walk['report.txt'], p, staticHL);
    const missing = Boolean(plan && plan.miss !== undefined && (staticHL || p >= plan.miss));
    const show = walking || missing;
    setClass(c['report.txt'], 'is-hidden', !show);
    setClass(c.sepRT, 'is-hidden', !show);
    setClass(c['report.txt'], 'is-miss', missing);
    setClass(c['report.txt'], 'is-on', walking && !missing);
    setText(c['report.txt'], missing ? 'report.txt ✗' : 'report.txt');
  }

  function renderWorld(w, k, p, staticHL) {
    const row = state.refs[w];
    const before = k < 0 ? 0 : k;
    const after = k < 0 ? 0 : k + 1;
    const sb = state.snap[w][before];
    const sa = state.snap[w][after];
    const plan = k < 0 ? null : PLAN[k][w];
    const sum = state.sums[w][p >= COMMIT ? after : before];
    const alpha = {};
    for (const key of KEYS) alpha[key] = usedAlpha(key, sb, sa, plan, p);

    for (const key of KEYS) {
      const slot = row.slots[key];
      setAttr(slot.used, 'opacity', alpha[key].toFixed(3));
      setAttr(slot.free, 'opacity', (1 - alpha[key]).toFixed(3));
      const disp = displayOf(key, sb, sa, p);
      if (!disp || alpha[key] <= 0) continue;
      if (key === 'd1' || key === 'd2') {
        const broken = key === 'd2' && sum.dangling.includes(LINK_NAME[w]);
        setText(slot.body, `→ inode ${disp.id}${broken ? ' · 目标缺失' : ''}`);
        setClass(slot.card, 'is-broken', broken);
      } else if (key === 'i10' || key === 'i20') {
        setText(slot.body, `nlink ${disp.nlink} · → 盘块 ${key === 'i10' ? 5 : 6}`);
        setClass(slot.card, 'is-shared', key === 'i10' && disp.nlink >= 2);
      }
      setClass(slot.card, 'is-read', inWindow(plan && plan.reads && plan.reads[key], p, staticHL));
    }

    for (const ln of row.lines) setAttr(ln.el, 'opacity', Math.min(alpha[ln.from], alpha[ln.to]).toFixed(3));

    const pos = probePos(plan, p, staticHL);
    setAttr(row.probe, 'opacity', pos ? 1 : 0);
    if (pos) {
      setAttr(row.probe, 'cx', pos.x.toFixed(2));
      setAttr(row.probe, 'cy', pos.y.toFixed(2));
      setClass(row.probe, 'is-gold', pos.color === 'gold');
    }

    renderCrumbs(row, plan, p, staticHL);
    setText(row.count, `inode ${sum.inodes} · 盘块 ${sum.blocks}`);
    const broken = sum.dangling.length ? ` · 悬空 ${sum.dangling.length}` : '';
    setText(row.read, `${sum.readable.length} 个名字读到 Hello${broken}`);
  }

  function renderTags(row, t) {
    for (const tg of row.tags) {
      const age = t - tg.te;
      let opacity = 0;
      let rise = 0;
      if (age >= 0 && tg.key) {
        if (t < tg.until) opacity = Math.min(1, age / 0.25);
      } else if (age >= 0 && age <= LIFE) {
        opacity = Math.min(1, age / 0.25) * Math.min(1, (LIFE - age) / 0.7);
        rise = 6 * (age / LIFE);
      }
      setAttr(tg.el, 'opacity', opacity.toFixed(3));
      setAttr(tg.el, 'transform', `translate(${tg.x} ${(-rise).toFixed(2)})`);
    }
  }

  function renderTimeline(t, k) {
    for (const bar of state.bars) {
      const idx = Number(bar.dataset.k);
      const st = t >= OP_LEN * (idx + 1) - EPS ? 'done' : (idx === k ? 'active' : 'future');
      if (bar.dataset.state !== st) bar.dataset.state = st;
    }
    els.timeline.style.setProperty('--p', (t / T).toFixed(4));
    setText(els.playheadLabel, `t ${Math.floor(t + EPS)}`);
  }

  function render(t) {
    const time = clamp(t, 0, T);
    state.t = time;
    const { k, p: raw } = locate(time);
    const staticHL = state.reduce && k >= 0;   // 减少动效：本步的读取与解析直接以静态高亮显示
    const p = staticHL ? 1 : raw;
    for (const w of WORLDS) {
      renderWorld(w, k, p, staticHL);
      renderTags(state.refs[w], time);
    }
    setText(els.clock, Math.floor(time + EPS));
    setText(els.phase, k < 0 ? '初始状态' : OPS[k].phase);
    setText(els.caption, k < 0 ? INITIAL : OPS[k].caption);
    renderTimeline(time, k);
    updateControls();
  }

  // ───── 控件与时钟 ─────

  function updateControls() {
    const t = state.t;
    const playing = state.playing;
    els.stage.classList.toggle('is-running', playing);
    els.previous.disabled = t <= EPS;
    els.next.disabled = t >= T - EPS;
    setText(els.playLabel, playing ? '暂停' : (t >= T - EPS ? '再播放' : '播放'));
    setText(els.playSymbol, playing ? 'Ⅱ' : '▶');
    els.play.dataset.running = String(playing);
    els.play.disabled = !state.tl;
    if (!state.scrubbing) els.progress.value = t.toFixed(2);
    setText(els.progressCaption, `t ${Math.floor(t + EPS)} / ${T}`);
  }

  function cancelGlide() {
    if (state.glide) {
      state.glide.kill();
      state.glide = null;
    }
  }

  function stopStepper() {
    if (state.stepper) {
      state.stepper.kill();
      state.stepper = null;
    }
  }

  function syncClock() {
    if (state.tl) state.tl.time(state.t * TICK);
  }

  // 直接跳到某一时刻（拖动、复位、时间线点击后使用）
  function seek(t) {
    cancelGlide();
    const target = clamp(t, 0, T);
    if (state.tl) {
      state.tl.pause();
      state.tl.time(target * TICK);
    }
    render(target);
    syncLink(false);
  }

  // 单步：平滑滑到下一个操作边界，便于看清每一步的因果
  function stepTo(target) {
    cancelGlide();
    pause();
    const dest = clamp(target, 0, T);
    const dist = Math.abs(dest - state.t);
    if (!window.gsap || state.reduce || dist < EPS) {
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
        syncLink(true);
      }
    });
  }

  function play() {
    if (!state.tl) return;
    cancelGlide();
    if (state.t >= T - EPS) seek(0);
    state.playing = true;
    if (state.reduce) {
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

  // 减少动效：不做补间，每个操作边界直接跳过去，停留一小段时间再跳下一个
  function scheduleStep() {
    state.stepper = window.gsap.delayedCall(STEP_SEC / state.speed, advanceStep);
  }

  function advanceStep() {
    state.stepper = null;
    if (!state.playing) return;
    const target = nextBoundary();
    seek(target);
    if (target >= T - EPS) finishPlayback();
    else scheduleStep();
  }

  // 直接定位到某一时刻并暂停（时间线点击、关键时刻按钮）
  function jumpTo(t) {
    pause();
    seek(t);
  }

  // 减少动效跟随系统设置，页面上的开关可以改；正在播放时换一种方式从当前时刻续播
  function applyMotion(reduce) {
    state.reduce = reduce;
    els.motion.checked = reduce;
    document.body.dataset.motion = reduce ? 'reduce' : 'full';
  }

  function setMotion(reduce) {
    const wasPlaying = state.playing;
    pause();
    applyMotion(reduce);
    render(state.t);
    if (wasPlaying) play();
  }

  function togglePlay() {
    if (state.playing) pause();
    else play();
  }

  function nextBoundary() {
    return BOUNDS.find((x) => x > state.t + EPS) ?? T;
  }

  function prevBoundary() {
    const earlier = BOUNDS.filter((x) => x < state.t - EPS);
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
    tl.to({}, { duration: T * TICK, ease: 'none' });
    tl.timeScale(state.speed);
    state.tl = tl;
  }

  // ───── 地址栏状态：#t=…，只用 replaceState，不增加历史记录 ─────

  function readLink() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const t = Number(params.get('t'));
    return params.has('t') && Number.isFinite(t) ? clamp(t, 0, T) : 0;
  }

  function writeLink() {
    state.linkTimer = 0;
    try {
      history.replaceState(null, '', `#t=${Number(state.t.toFixed(2))}`);
    } catch {
      // 某些本地文件环境不允许改写地址，演示照常可用
    }
  }

  // 暂停或停下时立即写回；拖动与逐步过程中合并为一次写入
  function syncLink(now) {
    if (!state.linkReady) return;
    clearTimeout(state.linkTimer);
    if (now) writeLink();
    else state.linkTimer = setTimeout(writeLink, LINK_DELAY);
  }

  // ───── 事件绑定 ─────

  function bindControls() {
    els.motion.addEventListener('change', () => setMotion(els.motion.checked));
    motionQuery.addEventListener('change', (event) => setMotion(event.matches));

    els.speed.addEventListener('change', () => {
      state.speed = Number(els.speed.value);
      if (state.tl) state.tl.timeScale(state.speed);
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

    els.timeline.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const jump = target.closest('[data-jump]');
      if (jump) {
        jumpTo(Number(jump.dataset.jump));
        return;
      }
      const track = target.closest('.tl-track');
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      jumpTo(clamp((event.clientX - rect.left) / rect.width, 0, 1) * T);
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, select, textarea, button, a')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      if (event.code === 'ArrowRight') { event.preventDefault(); stepTo(nextBoundary()); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); stepTo(prevBoundary()); }
      if (event.code === 'Home') { event.preventDefault(); pause(); seek(0); }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) pause();
    });
  }

  function init() {
    state.speed = Number(els.speed.value);
    els.progress.max = String(T);
    applyMotion(motionQuery.matches);
    prepare();
    buildStage();
    buildTimeline();
    buildClock();
    bindControls();
    seek(readLink());
    state.linkReady = true;
  }

  init();
})();
