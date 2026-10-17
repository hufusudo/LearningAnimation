/* ==========================================================================
   哈夫曼树与变长子网划分 · 页面控制器
   几何在这里；划分与选择检验在 model.js（纯函数）。
   画面只由时刻 t 与选择关键帧决定：GSAP 只推进 t，render(t) 每次重算全部可见状态。
   ========================================================================== */

(function () {
  'use strict';

  const M = window.VlsmModel;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEW = { w: 1100, h: 620 };
  const BOX = { w: 120, h: 36 };
  const REDUCED_HOLD = 0.9;
  const EPS = 1e-6;
  const COLORS = {
    gray: [233, 230, 218],
    green: [57, 155, 123],
    rose: [190, 18, 60],
    amber: [217, 119, 6]
  };
  const STEP_SHORT = ['拿 25 位', '拿 26 位', '注水', '情况 1', '情况 2', '情况 3', '情况 4'];
  const STEP_GROUPS = [['划分', [0, 1]], ['接水', [2]], ['选择', [3, 4, 5, 6]]];

  const $ = (id) => document.getElementById(id);
  const svg = $('vlsm');
  const N = {};
  const cache = new WeakMap();

  const state = {
    tree: null,
    kfs: [],
    userKfs: [],
    t: 0,
    speed: 1,
    playing: false,
    reduce: false,
    tween: null,
    hold: null,
    linkTimer: null,
    scrubbing: false,
    panelKey: null
  };

  /* ---------------------------------------------------------------- */
  /* 小工具                                                            */
  /* ---------------------------------------------------------------- */

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  function hasGsap() {
    return typeof window.gsap !== 'undefined';
  }

  function changed(node, key, value) {
    let c = cache.get(node);
    if (!c) { c = {}; cache.set(node, c); }
    if (c[key] === value) return false;
    c[key] = value;
    return true;
  }

  function attr(node, name, value) {
    if (changed(node, 'a:' + name, value)) node.setAttribute(name, String(value));
  }

  function setText(node, value) {
    if (changed(node, 'text', value)) node.textContent = value;
  }

  function setClass(node, value) {
    if (changed(node, 'class', value)) node.setAttribute('class', value);
  }

  function el(tag, attrs, parent, content) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
    if (content !== undefined) node.textContent = content;
    if (parent) parent.appendChild(node);
    return node;
  }

  function blockW(size) {
    return (size / M.ROOT_SIZE) * M.W;
  }

  function tagWidth(text) {
    let w = 18;
    for (const ch of text) w += /[　-鿿＀-￯]/.test(ch) ? 12 : 6.6;
    return Math.round(w);
  }

  function pipePath(x1, y1, x2, y2) {
    const ya = y1 + BOX.h / 2;
    const yb = y2 - BOX.h / 2;
    const ym = (ya + yb) / 2;
    return `M ${x1.toFixed(2)} ${ya.toFixed(2)} C ${x1.toFixed(2)} ${ym.toFixed(2)}, ${x2.toFixed(2)} ${ym.toFixed(2)}, ${x2.toFixed(2)} ${yb.toFixed(2)}`;
  }

  function cellColor(c, l, o) {
    const g = COLORS.gray;
    const gr = COLORS.green;
    const r = COLORS.rose;
    const a = COLORS.amber;
    const sum = c + l;
    const k = sum > 1 ? 1 / sum : 1;
    const cc = c * k;
    const ll = l * k;
    const oo = clamp(o, 0, 1);
    const rgb = [0, 1, 2].map((i) => {
      const base = g[i] * (1 - cc - ll) + gr[i] * cc + r[i] * ll;
      return Math.round(base * (1 - oo) + a[i] * oo);
    });
    return `rgb(${rgb.join(',')})`;
  }

  function nodeTitle(v) {
    if (v.depth === 0) return '根 · 未拿位';
    return `第 ${v.depth === 1 ? 25 : 26} 位 = ${v.bit}`;
  }

  function sameSet(a, b) {
    return a.length === b.length && a.every((x) => b.includes(x));
  }

  /* ---------------------------------------------------------------- */
  /* 时刻与关键帧                                                       */
  /* ---------------------------------------------------------------- */

  function allKfs() {
    return state.kfs.concat(state.userKfs);
  }

  function totalDuration() {
    const last = state.userKfs.length ? state.userKfs[state.userKfs.length - 1].t : 0;
    return Math.max(M.DURATION, last + M.T.ramp + 0.3);
  }

  function starts() {
    return M.PHASES.map((p) => p.start);
  }

  function nextBoundary(t) {
    const hit = starts().concat([M.DURATION]).find((x) => x > t + EPS);
    return hit === undefined ? M.DURATION : hit;
  }

  function prevBoundary(t) {
    const list = starts();
    const idx = M.phaseIndexAt(t);
    if (t - list[idx] > 0.05) return list[idx];
    return idx > 0 ? list[idx - 1] : 0;
  }

  /* ---------------------------------------------------------------- */
  /* 构图                                                              */
  /* ---------------------------------------------------------------- */

  function anchorPoint(a) {
    if (a === 'spout') return { x: N.rootX + 92, y: 48 };
    if (a && a.leak) return { x: M.X0 + M.W / 2, y: M.LEAK_Y - 2 };
    if (a && a.node !== undefined) {
      const tr = N.trays[a.node];
      return { x: tr.x + tr.w / 2, y: tr.y - 8 };
    }
    return { x: M.X0, y: 40 };
  }

  function build() {
    Array.from(svg.children).forEach((c) => {
      const tag = c.tagName.toLowerCase();
      if (tag !== 'title' && tag !== 'desc') svg.removeChild(c);
    });
    Object.keys(N).forEach((k) => { delete N[k]; });
    svg.setAttribute('viewBox', `0 0 ${VIEW.w} ${VIEW.h}`);
    const tree = state.tree;

    const gSpout = el('g', {}, svg);
    const gBits = el('g', {}, svg);
    const gPipes = el('g', {}, svg);
    const gDrips = el('g', {}, svg);
    const gTrays = el('g', {}, svg);
    const gNodes = el('g', {}, svg);
    const gLeak = el('g', {}, svg);
    const gStrip = el('g', {}, svg);
    const gTags = el('g', {}, svg);

    // 注水口：根节点上方的水流
    N.rootX = M.xOf(0, M.ROOT_SIZE);
    el('path', { d: `M ${N.rootX - 22} 10 L ${N.rootX + 22} 10 L ${N.rootX + 8} 20 L ${N.rootX - 8} 20 Z`, class: 'spout-cup' }, gSpout);
    el('path', { d: `M ${N.rootX} 20 L ${N.rootX} 74`, class: 'pour-spout' }, gSpout);
    N.spoutFlow = el('path', { d: `M ${N.rootX} 20 L ${N.rootX} 74`, class: 'pour-flow' }, gSpout);
    el('text', { x: N.rootX + 30, y: 22, class: 't-mono' }, gSpout, `注水 ${M.ROOT_SIZE}`);

    // 末八位组：拿出的第 25、26 位在这里点亮
    el('text', { x: 60, y: 22, class: 'bit-label' }, gBits, '主机号的末八位组');
    N.bitCells = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const x = 60 + i * 26;
      el('text', { x: x + 11, y: 45, class: 't-mono-sub', 'text-anchor': 'middle' }, gBits, String(128 >> i));
      return el('rect', { x, y: 30, width: 22, height: 22, rx: 4, fill: '#EFEDE4' }, gBits);
    });
    el('text', { x: 60 + 11, y: 66, class: 't-sub', 'text-anchor': 'middle' }, gBits, '25位');
    el('text', { x: 60 + 26 + 11, y: 66, class: 't-sub', 'text-anchor': 'middle' }, gBits, '26位');
    el('text', { x: 60 + 26 * 2 + 4, y: 66, class: 't-sub' }, gBits, '← 拿出的子网位，其余为主机位');

    // 管道（父 → 子），左分支记 0，右分支记 1
    N.pipes = tree.nodes.filter((v) => v.parentIdx >= 0).map((v) => ({
      idx: v.idx,
      base: el('path', { class: 'pipe' }, gPipes),
      flow: el('path', { class: 'pipe-flow' }, gPipes),
      bit: el('text', { class: 't-bit', 'text-anchor': 'middle' }, gPipes, String(v.bit))
    }));

    // 滴水：节点 → 它的水盘
    N.drips = tree.nodes.map((v) => ({
      idx: v.idx,
      base: el('path', { class: 'drip' }, gDrips),
      flow: el('path', { class: 'drip-flow' }, gDrips)
    }));

    // 水盘：每个节点一个，宽度 ∝ 地址块大小
    N.trays = tree.nodes.map((v) => {
      const g = el('g', { class: 'tray-g', 'data-id': v.id }, gTrays);
      g.addEventListener('click', () => onNodeClick(v.id));
      const x = M.xAddr(v.start);
      const w = blockW(v.size) - 1.5;
      const y = M.TRAY_Y[v.depth];
      const h = M.TRAY_H[v.depth];
      const frame = el('rect', { x, y, width: w, height: h, rx: 3, class: 'tray' }, g);
      const fill = el('rect', { x, y, width: 0, height: h, rx: 3, class: 'tray-fill' }, g);
      const dup = el('rect', { x, y, width: 0, height: h, rx: 3, class: 'tray-dup' }, g);
      if (v.depth === 2) {
        el('text', { x: x + w / 2, y: y + h / 2 + 4, class: 'tray-label', 'text-anchor': 'middle' }, g, v.cidr);
      }
      return { idx: v.idx, x, y, w, h, g, frame, fill, dup };
    });

    // 节点（树）：盒子里的水位是流到这里的水
    N.nodes = tree.nodes.map((v) => {
      const g = el('g', { class: 'nodeg', 'data-id': v.id }, gNodes);
      g.addEventListener('click', () => onNodeClick(v.id));
      const water = el('rect', { x: -BOX.w / 2, y: -BOX.h / 2, width: 0, height: BOX.h, rx: 7, class: 'nwater' }, g);
      const box = el('rect', { x: -BOX.w / 2, y: -BOX.h / 2, width: BOX.w, height: BOX.h, rx: 7, class: 'nbox' }, g);
      el('text', { x: 0, y: -3, class: 'n-title', 'text-anchor': 'middle' }, g, nodeTitle(v));
      el('text', { x: 0, y: 11, class: 'n-cidr', 'text-anchor': 'middle' }, g, v.cidr);
      return { idx: v.idx, g, water, box };
    });

    // 漏：叶子水盘底部 → 接水盘
    N.leakDrops = tree.leaves.map((li) => {
      const v = tree.nodes[li];
      const x = M.xAddr(v.start) + blockW(v.size) / 2;
      const y0 = M.TRAY_Y[2] + M.TRAY_H[2];
      const d = `M ${x.toFixed(2)} ${y0} L ${x.toFixed(2)} ${M.LEAK_Y}`;
      return {
        idx: li,
        base: el('path', { d, class: 'leak-draw' }, gLeak),
        flow: el('path', { d, class: 'leak-flow' }, gLeak)
      };
    });
    N.leakTray = el('rect', { x: M.X0, y: M.LEAK_Y, width: M.W, height: M.LEAK_H, rx: 6, class: 'leak-tray' }, gLeak);
    el('text', { x: M.X0 + 12, y: M.LEAK_Y + 20, class: 't-sub' }, gLeak, '接水盘：没有子网兜住的地址从这里漏出');
    N.leakText = el('text', { x: M.X0 + M.W - 12, y: M.LEAK_Y + 20, class: 'leak-text', 'text-anchor': 'end' }, gLeak, '漏 0');

    // 覆盖条：256 格，每格一个地址
    N.cells = [];
    for (let a = 0; a < M.ROOT_SIZE; a++) {
      N.cells.push(el('rect', {
        x: M.xAddr(a).toFixed(2), y: M.STRIP_Y, width: (M.W / M.ROOT_SIZE + 0.4).toFixed(2), height: M.STRIP_H, fill: '#E9E6DA'
      }, gStrip));
    }
    el('rect', { x: M.X0 - 0.5, y: M.STRIP_Y - 0.5, width: M.W + 1, height: M.STRIP_H + 1, class: 'cover-frame' }, gStrip);
    el('text', { x: M.X0, y: M.STRIP_Y - 6, class: 't-sub' }, gStrip, '覆盖：每格一个地址（绿＝兜住，玫红＝漏，琥珀＝重复）');
    N.summary = el('text', { x: M.X0, y: M.STRIP_Y + M.STRIP_H + 20, class: 't-mono' }, gStrip, '');
    [0, 64, 128, 192, 256].forEach((a) => {
      const anchor = a === 0 ? 'start' : a === 256 ? 'end' : 'middle';
      const label = a === 256 ? `${M.BASE}.255` : `${M.BASE}.${a}`;
      el('text', { x: M.xAddr(a), y: M.TRAY_Y[2] + M.TRAY_H[2] + 14, class: 't-axis', 'text-anchor': anchor }, gStrip, label);
    });

    // 浮标
    N.tags = [];
    M.sample(tree, state.kfs, 0).tags.forEach((tg) => {
      const g = el('g', { class: `tag tone-${tg.tone}`, opacity: 0 }, gTags);
      const bg = el('rect', { x: 0, y: 0, width: 80, height: 22, rx: 11, class: 'tag-bg' }, g);
      const tx = el('text', { x: 40, y: 11, class: 'tag-text', 'text-anchor': 'middle' }, g, tg.text);
      N.tags.push({ g, bg, tx });
    });
  }

  /* ---------------------------------------------------------------- */
  /* 渲染：按时刻重算全部可见状态                                         */
  /* ---------------------------------------------------------------- */

  function renderTop(s) {
    setText($('clock'), `${s.t.toFixed(1)} s`);
    setText($('phase'), s.phaseName);
    setText($('step-index'), `第 ${s.phase + 1} / ${s.phaseCount} 步`);
    setText($('caption'), s.caption);
    const cv = s.totals;
    setText($('counts'), `兜住 ${Math.round(cv.caught)} / ${M.ROOT_SIZE} · 漏 ${Math.round(cv.leak)} · 重复 ${Math.round(cv.over)}`);
    setClass($('stage'), 'stage' + (state.playing ? ' is-running' : ''));

    const banner = $('banner');
    setText(banner, s.banner);
    const tone = {
      ok: 'is-ok', leak: 'is-leak', ancestor: 'is-over', count: 'is-bad', fit: 'is-bad'
    }[s.verdict.verdict] || '';
    setClass(banner, `banner ${tone}`.trim());
  }

  function renderNodes(s) {
    s.nodes.forEach((v) => {
      const n = N.nodes[v.idx];
      n.g.setAttribute('transform', `translate(${v.x.toFixed(2)} ${v.y.toFixed(2)})`);
      attr(n.g, 'opacity', v.alpha.toFixed(3));
      const dup = v.dup > 0.5;
      const on = v.m >= 0.5;
      setClass(n.box, 'nbox' + (dup ? ' is-dup' : on ? ' is-on' : ''));
      attr(n.water, 'width', (BOX.w * clamp(v.f * v.pass, 0, 1)).toFixed(2));
    });
  }

  function renderPipes(s) {
    s.pipes.forEach((p, i) => {
      const pipe = N.pipes[i];
      const parent = s.nodes[p.parent];
      const child = s.nodes[p.child];
      const d = pipePath(parent.x, parent.y, child.x, child.y);
      attr(pipe.base, 'd', d);
      attr(pipe.flow, 'd', d);
      const L = pipe.base.getTotalLength();
      attr(pipe.base, 'stroke-dasharray', `${(L * p.drawn).toFixed(2)} ${L.toFixed(2)}`);
      attr(pipe.flow, 'stroke-dasharray', `${(L * clamp(p.front, 0, 1)).toFixed(2)} ${L.toFixed(2)}`);
      attr(pipe.bit, 'x', ((parent.x + child.x) / 2).toFixed(2));
      attr(pipe.bit, 'y', ((parent.y + child.y) / 2).toFixed(2));
      attr(pipe.bit, 'opacity', (p.drawn > 0.5 ? 1 : 0).toFixed(2));
    });
  }

  function renderDrips(s) {
    s.nodes.forEach((v) => {
      const dr = N.drips[v.idx];
      const y0 = v.y + BOX.h / 2;
      const y1 = M.TRAY_Y[v.depth];
      const d = `M ${v.x.toFixed(2)} ${y0.toFixed(2)} L ${v.x.toFixed(2)} ${y1}`;
      attr(dr.base, 'd', d);
      attr(dr.flow, 'd', d);
      const L = dr.base.getTotalLength();
      attr(dr.base, 'opacity', (v.alpha > 0.5 ? 1 : 0).toFixed(2));
      attr(dr.flow, 'stroke-dasharray', `${(L * clamp(v.f * v.pass, 0, 1)).toFixed(2)} ${L.toFixed(2)}`);
    });
  }

  function renderTrays(s) {
    s.nodes.forEach((v) => {
      const tr = N.trays[v.idx];
      attr(tr.g, 'opacity', v.alpha.toFixed(3));
      setClass(tr.frame, 'tray' + (v.dup > 0.5 ? ' is-dup' : v.m >= 0.5 ? ' is-on' : ''));
      attr(tr.fill, 'width', (tr.w * clamp(v.primaryFrac, 0, 1)).toFixed(2));
      attr(tr.dup, 'width', (tr.w * clamp(v.dupFrac, 0, 1)).toFixed(2));
    });
  }

  function renderLeaks(s) {
    s.nodes.forEach((v) => {
      if (!v.leaf) return;
      const ld = N.leakDrops.find((x) => x.idx === v.idx);
      const L = ld.base.getTotalLength();
      attr(ld.flow, 'stroke-dasharray', `${(L * clamp(v.leakFrac, 0, 1)).toFixed(2)} ${L.toFixed(2)}`);
    });
    const leak = s.totals.leak;
    setText(N.leakText, `漏 ${Math.round(leak)}`);
    setClass(N.leakTray, 'leak-tray' + (leak >= 0.5 ? ' is-leak' : ''));
  }

  function renderStrip(s) {
    s.cover.forEach((c) => {
      for (let a = c.start; a < c.start + c.size; a++) {
        attr(N.cells[a], 'fill', cellColor(c.c, c.l, c.o));
      }
    });
    setText(N.summary, `兜住 ${Math.round(s.totals.caught)} / ${M.ROOT_SIZE} · 漏 ${Math.round(s.totals.leak)} · 重复 ${Math.round(s.totals.over)}`);
  }

  function renderBits(s) {
    s.bitLit.forEach((lit, i) => {
      attr(N.bitCells[i], 'fill', `rgba(37, 99, 235, ${(0.12 + 0.55 * lit).toFixed(3)})`);
    });
  }

  function renderTags(s) {
    s.tags.forEach((tg, i) => {
      const node = N.tags[i];
      const w = tagWidth(tg.text);
      setText(node.tx, tg.text);
      attr(node.bg, 'width', w);
      attr(node.tx, 'x', w / 2);
      const p = anchorPoint(tg.anchor);
      attr(node.g, 'opacity', tg.opacity.toFixed(3));
      attr(node.g, 'transform', `translate(${(p.x - w / 2).toFixed(2)} ${(p.y - tg.rise - 11).toFixed(2)})`);
    });
  }

  function renderSpout(s) {
    const L = N.spoutFlow.getTotalLength();
    attr(N.spoutFlow, 'stroke-dasharray', `${(L * clamp(s.nodes[0].f, 0, 1)).toFixed(2)} ${L.toFixed(2)}`);
  }

  function renderTrackAndCases(s) {
    N.trackBtns.forEach((btn, i) => {
      setClass(btn, 'track-step' + (i === s.phase ? ' is-current' : i < s.phase ? ' is-passed' : ''));
      if (i === s.phase) btn.setAttribute('aria-current', 'step');
      else btn.removeAttribute('aria-current');
    });
  }

  function h(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 选择检验卡片：只在选择变化时重建
  function renderPanel(s) {
    const ev = s.verdict;
    const key = JSON.stringify([s.ids, ev.verdict, ev.message]);
    if (state.panelKey === key) return;
    state.panelKey = key;

    const caseIdx = s.ids ? M.CASES.findIndex((c) => sameSet(c.ids, s.ids)) : -1;
    setText($('panel-title'), !s.ids
      ? '还没有选择子网：水全部从叶子漏出'
      : caseIdx >= 0 ? M.CASES[caseIdx].title : `自选 ${s.ids.length} 个子网`);
    document.querySelectorAll('.case-btn').forEach((b, i) => b.classList.toggle('is-current', i === caseIdx));

    const r = ev.rules;
    const rules = $('rules');
    rules.innerHTML = '';
    const items = [
      ['选了三个子网', r ? r.count : false, r ? `已选 ${ev.subnets.length} 个` : '尚未选择'],
      ['子网之间没有祖先关系', r ? r.antichain : false, r ? (r.antichain ? '互不包含' : ev.message) : '—'],
      ['完全兜住全部水', r ? r.cover : false, r ? (r.cover ? '漏 0，没有重复兜住' : `漏 ${ev.uncovered}`) : '—'],
      ['每个需求都装得下', r ? r.fit : false, r ? ev.fits.map((f) => `${f.name} 需 ${f.need}：${f.cidr ? `${f.cidr}（可用 ${f.usable}）` : '没有子网'}`).join('；') : '—']
    ];
    items.forEach(([label, ok, detail]) => {
      const li = h('li', `rule ${ok ? 'is-ok' : 'is-bad'}`);
      li.appendChild(h('span', 'rule-mark', ok ? '✓' : '✗'));
      const body = h('span', '');
      body.appendChild(document.createTextNode(label));
      body.appendChild(h('span', 'rule-detail', `　${detail}`));
      li.appendChild(body);
      rules.appendChild(li);
    });

    const list = $('subnets');
    list.innerHTML = '';
    if (!ev.subnets.length) {
      list.appendChild(h('li', 'is-empty', '没有选中的子网'));
    } else {
      ev.subnets.forEach((sn) => {
        const li = h('li', '');
        li.appendChild(h('span', '', sn.cidr));
        li.appendChild(h('span', '', `可用 ${sn.range}`));
        li.appendChild(h('span', `sn-demand${sn.demand ? '' : ' is-miss'}`, sn.demand ? `服务 ${sn.demand}` : '未服务需求'));
        list.appendChild(li);
      });
    }

    const verdict = $('verdict');
    setText(verdict, ev.message);
    setClass(verdict, `verdict ${ev.verdict === 'ok' ? 'is-ok' : ev.verdict === 'none' ? '' : 'is-bad'}`.trim());
  }

  function render(t) {
    const s = M.sample(state.tree, allKfs(), t);
    renderTop(s);
    renderNodes(s);
    renderPipes(s);
    renderDrips(s);
    renderTrays(s);
    renderLeaks(s);
    renderStrip(s);
    renderBits(s);
    renderTags(s);
    renderSpout(s);
    renderTrackAndCases(s);
    renderPanel(s);

    if (!state.scrubbing) $('progress').value = s.t.toFixed(2);
    $('progress').max = String(totalDuration());
    setText($('progress-caption'), `${s.t.toFixed(1)} / ${totalDuration().toFixed(1)} s`);
    if (state.playing) queueLink();
    return s;
  }

  /* ---------------------------------------------------------------- */
  /* 时间控制：GSAP 只推进 t，画面由 render(t) 决定                       */
  /* ---------------------------------------------------------------- */

  function killTween() {
    if (state.tween) {
      state.tween.kill();
      state.tween = null;
    }
    if (state.hold) {
      state.hold.kill();
      state.hold = null;
    }
  }

  function seek(t) {
    killTween();
    state.t = clamp(t, 0, totalDuration());
    render(state.t);
    writeLink();
  }

  function setPlayUI() {
    const atEnd = !state.playing && state.t >= totalDuration() - EPS;
    $('play-symbol').textContent = state.playing ? '❚❚' : atEnd ? '↺' : '▶';
    $('play-label').textContent = state.playing ? '暂停' : atEnd ? '重播' : '播放';
    $('play').disabled = !hasGsap();
  }

  function stopPlayback() {
    killTween();
    state.playing = false;
    setPlayUI();
    render(state.t);
    writeLink();
  }

  function stopIfPlaying() {
    if (state.playing) stopPlayback();
  }

  // 从当前时刻平滑推进到目标时刻（过渡与播放共用）
  function glideTo(target) {
    killTween();
    const to = clamp(target, 0, totalDuration());
    if (state.reduce || !hasGsap() || Math.abs(to - state.t) < EPS) {
      state.t = to;
      state.playing = false;
      render(to);
      setPlayUI();
      writeLink();
      return;
    }
    const proxy = { v: state.t };
    state.playing = true;
    setPlayUI();
    state.tween = window.gsap.to(proxy, {
      v: to,
      duration: Math.abs(to - state.t),
      ease: 'none',
      onUpdate: () => {
        state.t = proxy.v;
        render(state.t);
      },
      onComplete: () => {
        state.tween = null;
        state.playing = false;
        setPlayUI();
        render(state.t);
        writeLink();
      }
    });
    state.tween.timeScale(state.speed);
  }

  function play() {
    if (state.playing || !hasGsap()) return;
    if (state.t >= totalDuration() - EPS) state.t = 0;
    if (state.reduce) {
      state.playing = true;
      setPlayUI();
      render(state.t);
      holdThenStep();
      return;
    }
    glideTo(totalDuration());
  }

  // 减少动效：不补间，每个阶段起点直接跳转并停留
  function holdThenStep() {
    state.hold = window.gsap.delayedCall(REDUCED_HOLD / state.speed, reducedStep);
  }

  function reducedStep() {
    state.hold = null;
    const next = nextBoundary(state.t);
    state.t = next;
    render(next);
    if (next >= totalDuration() - EPS) {
      stopPlayback();
      return;
    }
    holdThenStep();
  }

  /* ---------------------------------------------------------------- */
  /* 步骤导航、情况按钮、自选                                             */
  /* ---------------------------------------------------------------- */

  function buildTrack() {
    const nav = $('track');
    nav.innerHTML = '';
    N.trackBtns = [];
    STEP_GROUPS.forEach(([label, indices]) => {
      const group = document.createElement('div');
      group.className = 'track-group';
      const head = document.createElement('span');
      head.className = 'track-group-label';
      head.textContent = label;
      const row = document.createElement('div');
      row.className = 'track-buttons';
      indices.forEach((i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'track-step';
        btn.textContent = `${i + 1} ${STEP_SHORT[i]}`;
        btn.title = `跳到第 ${i + 1} 步：${M.PHASES[i].title}`;
        btn.addEventListener('click', () => {
          stopIfPlaying();
          glideTo(M.PHASES[i].start);
        });
        row.appendChild(btn);
        N.trackBtns[i] = btn;
      });
      group.append(head, row);
      nav.appendChild(group);
    });
  }

  function bindCaseButtons() {
    M.CASES.forEach((c, k) => {
      $(`case-${k + 1}`).addEventListener('click', () => {
        stopIfPlaying();
        glideTo(M.T.caseStart + k * M.T.caseSpan + M.T.ramp + 0.2);
      });
    });
  }

  // 结束后的自选：在当前时刻追加一个选择关键帧，过渡后重新检验
  function onNodeClick(id) {
    if (state.playing || !state.tree) return;
    if (state.t < M.DURATION - 0.05) return;
    const at = state.t;
    const current = new Set(M.setAt(allKfs(), at) || []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    state.userKfs.push(M.userKeyframe(at, [...current]));
    if (state.reduce || !hasGsap()) {
      render(at);
      writeLink();
      return;
    }
    glideTo(at + M.T.ramp + 0.1);
  }

  /* ---------------------------------------------------------------- */
  /* 地址栏状态：#t=…，replaceState，不增加历史记录                       */
  /* ---------------------------------------------------------------- */

  function readLink() {
    const params = new URLSearchParams(location.hash.slice(1));
    const t = Number(params.get('t'));
    return { t: params.has('t') && Number.isFinite(t) ? clamp(t, 0, M.DURATION) : 0 };
  }

  function writeLink() {
    clearTimeout(state.linkTimer);
    state.linkTimer = null;
    try {
      history.replaceState(null, '', `#t=${state.t.toFixed(2)}`);
    } catch (err) {
      // 某些本地环境不允许改写地址，演示照常可用
    }
  }

  function queueLink() {
    if (!state.linkTimer) state.linkTimer = setTimeout(writeLink, 300);
  }

  /* ---------------------------------------------------------------- */
  /* 控件与事件                                                        */
  /* ---------------------------------------------------------------- */

  function bindControls() {
    $('play').addEventListener('click', () => (state.playing ? stopPlayback() : play()));
    $('reset').addEventListener('click', () => {
      state.userKfs = [];
      stopIfPlaying();
      seek(0);
    });
    $('previous').addEventListener('click', () => {
      stopIfPlaying();
      glideTo(prevBoundary(state.t));
    });
    $('next').addEventListener('click', () => {
      stopIfPlaying();
      glideTo(nextBoundary(state.t));
    });

    const progress = $('progress');
    progress.addEventListener('input', () => {
      state.scrubbing = true;
      stopIfPlaying();
      seek(Number(progress.value));
    });
    progress.addEventListener('change', () => {
      state.scrubbing = false;
      writeLink();
    });

    $('speed').addEventListener('change', (e) => {
      state.speed = Number(e.target.value);
      if (state.tween) state.tween.timeScale(state.speed);
    });

    $('reduce-motion').addEventListener('change', (e) => {
      const wasPlaying = state.playing;
      stopIfPlaying();
      state.reduce = e.target.checked;
      document.documentElement.dataset.motion = state.reduce ? 'reduce' : 'full';
      if (wasPlaying) play();
    });

    bindCaseButtons();

    document.addEventListener('keydown', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest('input, select, textarea, button, a')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (state.playing) stopPlayback(); else play();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stopIfPlaying();
        glideTo(nextBoundary(state.t));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stopIfPlaying();
        glideTo(prevBoundary(state.t));
      } else if (event.key === 'Home') {
        event.preventDefault();
        stopIfPlaying();
        seek(0);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopIfPlaying();
    });
  }

  /* ---------------------------------------------------------------- */
  /* 初始化                                                            */
  /* ---------------------------------------------------------------- */

  function init() {
    state.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.tree = M.buildTree();
    state.kfs = M.scriptedKeyframes();
    state.t = readLink().t;

    build();
    buildTrack();
    bindControls();

    $('reduce-motion').checked = state.reduce;
    document.documentElement.dataset.motion = state.reduce ? 'reduce' : 'full';
    $('progress').max = String(M.DURATION);
    $('dependency-notice').hidden = hasGsap();
    render(state.t);
    setPlayUI();
  }

  init();
})();
