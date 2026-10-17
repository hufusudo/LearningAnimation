/* ==========================================================================
   操作系统引导流程 · 页面控制器
   几何与样式在这里；阶段推演在 model.js（纯函数）。
   画面只由时刻 t 与活动分区决定：GSAP 只推进 t，render(t) 每次重算全部可见状态。
   ========================================================================== */

(function () {
  'use strict';

  const M = window.BootModel;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEW = { w: 1100, h: 600 };
  const REDUCED_HOLD = 0.9;          // 减少动效：每一步停留（秒，1× 速度）
  const EPS = 1e-6;

  const $ = (id) => document.getElementById(id);
  const svg = $('boot');

  // 构图坐标集中定义（viewBox 1100 × 600）
  const ROUTE = {
    mbr: ['M 616 150 C 590 300 520 402 280 402'],
    pbr: ['M 628 332 C 560 340 470 420 280 404', 'M 860 332 C 760 350 470 420 280 404'],
    bm: ['M 636 397 C 560 380 430 300 268 266', 'M 868 397 C 740 360 420 300 268 266'],
    k: ['M 636 497 C 540 470 420 320 280 164', 'M 868 497 C 700 470 420 330 280 164']
  };
  const ANCHOR = { cpu: [433, 60], rom: [433, 282], pick: [433, 372], lane: [420, 438], ivt: [200, 498] };
  const PART_X = [616, 848];         // 分区框左边

  // 中断向量表的登记来源：BIOS 先登记，内核初始化补全
  const IVT_RANK = (() => {
    const bios = new Map(M.BIOS_VECTORS.map((v, j) => [v, j]));
    const rank = [];
    let k = 0;
    for (let i = 0; i < M.IVT_SIZE; i++) {
      rank.push(bios.has(i) ? { bios: bios.get(i) } : { kern: k++ });
    }
    return rank;
  })();

  const N = {};                      // 节点引用
  const lengths = new Map();         // 路径长度（构建时测量一次）
  const cache = new WeakMap();       // 只在取值变化时写 DOM

  const state = {
    active: 1,
    seq: null,
    t: 0,
    speed: 1,
    playing: false,
    reduce: false,
    tween: null,
    hold: null,
    scrubbing: false,
    linkTimer: null
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

  function tagWidth(text) {
    let w = 18;
    for (const ch of text) w += /[　-鿿＀-￯]/.test(ch) ? 12 : 6.6;
    return Math.round(w);
  }

  /* ---------------------------------------------------------------- */
  /* 构图                                                              */
  /* ---------------------------------------------------------------- */

  function buildRoutes(g) {
    N.routes = {};
    Object.entries(ROUTE).forEach(([key, list]) => {
      N.routes[key] = list.map((d) => {
        const path = el('path', { d, class: 'route' }, g);
        lengths.set(path, path.getTotalLength());
        return path;
      });
    });
  }

  function buildRam(g) {
    el('text', { x: 166, y: 34, class: 'zone-title', 'text-anchor': 'middle' }, g, '主存 RAM');
    el('rect', { x: 96, y: 44, width: 200, height: 546, rx: 12, class: 'ram-frame' }, g);

    N.romBlk = el('rect', { x: 112, y: 58, width: 168, height: 50, rx: 6, class: 'blk' }, g);
    el('text', { x: 120, y: 76, class: 't-title' }, g, 'BIOS · ROM');
    el('text', { x: 120, y: 95, class: 't-addr' }, g, 'F0000–FFFFF · 只读');

    N.kernBlk = el('rect', { x: 112, y: 122, width: 168, height: 84, rx: 6, class: 'blk is-free' }, g);
    el('text', { x: 120, y: 142, class: 't-title' }, g, '内核区');
    N.kernStatus = el('text', { x: 120, y: 160, class: 't-sub' }, g, '待装入…');
    el('text', { x: 120, y: 178, class: 't-addr' }, g, '1 MiB 起（Linux 示例）');
    el('rect', { x: 120, y: 188, width: 152, height: 6, rx: 3, class: 'bar-track' }, g);
    N.kernBar = el('rect', { x: 120, y: 188, width: 0, height: 6, rx: 3, class: 'bar' }, g);

    el('rect', { x: 112, y: 220, width: 168, height: 82, rx: 6, class: 'blk is-free' }, g);
    el('text', { x: 120, y: 236, class: 't-sub' }, g, '空闲 RAM');
    N.bmBlk = el('rect', { x: 124, y: 246, width: 144, height: 40, rx: 5, class: 'blk is-free' }, g);
    el('text', { x: 132, y: 263, class: 't-title' }, g, '启动管理器');
    N.bmSub = el('text', { x: 132, y: 278, class: 't-sub' }, g, '未装入');

    N.bootBlk = el('rect', { x: 112, y: 380, width: 168, height: 44, rx: 6, class: 'blk is-free' }, g);
    el('text', { x: 120, y: 398, class: 't-title' }, g, '引导扇区 · 0x7C00');
    N.bootSub = el('text', { x: 120, y: 414, class: 't-sub' }, g, '空');

    N.mbrCopyBlk = el('rect', { x: 112, y: 440, width: 168, height: 34, rx: 6, class: 'blk is-free' }, g);
    el('text', { x: 120, y: 461, class: 't-title' }, g, 'MBR 副本 · 0x0600');

    el('rect', { x: 112, y: 506, width: 168, height: 84, rx: 6, class: 'blk' }, g);
    el('text', { x: 120, y: 524, class: 't-title' }, g, '中断向量表 · 0x00000');
    N.cells = [];
    for (let i = 0; i < M.IVT_SIZE; i++) {
      const c = i % 32;
      const r = Math.floor(i / 32);
      N.cells.push(el('rect', {
        x: (117 + c * 5.1).toFixed(2), y: (534 + r * 5.1).toFixed(2),
        width: 4.4, height: 4.4, rx: 0.8, class: 'cell'
      }, g));
    }
  }

  function buildCpu(g) {
    el('rect', { x: 348, y: 74, width: 170, height: 92, rx: 12, class: 'cpu-box' }, g);
    el('text', { x: 433, y: 98, class: 't-title', 'text-anchor': 'middle' }, g, 'CPU');
    N.pc = el('text', { x: 433, y: 122, class: 'cpu-pc', 'text-anchor': 'middle' }, g, 'PC  F000:FFF0');
    N.exec = el('text', { x: 433, y: 145, class: 't-sub', 'text-anchor': 'middle' }, g, 'ROM · BIOS');

    N.romChip = el('rect', { x: 348, y: 196, width: 170, height: 62, rx: 10, class: 'chip' }, g);
    el('text', { x: 433, y: 218, class: 't-title', 'text-anchor': 'middle' }, g, 'ROM 芯片 · BIOS');
    el('text', { x: 433, y: 240, class: 't-sub', 'text-anchor': 'middle' }, g, 'POST · INT 13H · INT 19H');

    el('path', { d: 'M 348 120 L 296 120', class: 'wire' }, g);
    el('text', { x: 322, y: 112, class: 't-sub', 'text-anchor': 'middle' }, g, '总线');
    el('path', { d: 'M 518 120 L 596 120', class: 'wire' }, g);
    el('text', { x: 557, y: 112, class: 't-sub', 'text-anchor': 'middle' }, g, 'INT 13H');

    el('text', { x: 433, y: 458, class: 't-sub', 'text-anchor': 'middle' }, g, '系统服务');
    N.svc = [['驱动', 360, 466], ['文件系统', 432, 466], ['网络', 360, 498], ['登录', 432, 498]].map(([label, x, y]) => {
      const rect = el('rect', { x, y, width: 66, height: 26, rx: 6, class: 'svc' }, g);
      el('text', { x: x + 33, y: y + 17, class: 't-sub', 'text-anchor': 'middle' }, g, label);
      return rect;
    });
    N.login = el('text', { x: 433, y: 552, class: 't-key', 'text-anchor': 'middle', opacity: 0 }, g, '✔ 可以登录');
  }

  function buildDisk(g) {
    el('rect', { x: 596, y: 44, width: 480, height: 546, rx: 14, class: 'disk' }, g);
    el('text', { x: 620, y: 66, class: 't-title' }, g, '引导磁盘');

    N.sector0 = el('rect', { x: 616, y: 84, width: 440, height: 178, rx: 6, class: 'blk' }, g);
    el('text', { x: 628, y: 102, class: 't-title' }, g, '扇区 0 · MBR（512 B）');
    el('text', { x: 1044, y: 102, class: 't-addr', 'text-anchor': 'end' }, g, 'C0 · H0 · S1');
    el('rect', { x: 628, y: 114, width: 416, height: 50, rx: 4, class: 'band' }, g);
    el('text', { x: 638, y: 134, class: 't-title' }, g, 'MBR 代码 · 446 B');
    el('text', { x: 638, y: 152, class: 't-sub' }, g, '选盘后搬到 0x0600，再加载引导扇区');
    el('rect', { x: 628, y: 168, width: 416, height: 74, rx: 4, class: 'band-white' }, g);
    el('text', { x: 638, y: 184, class: 't-title' }, g, '分区表 · 4 × 16 B');
    N.rows = [0, 1, 2, 3].map((i) => {
      const y = 190 + i * 13;
      const grp = el('g', { class: 'row' }, g);
      el('rect', { x: 638, y, width: 396, height: 11, rx: 2 }, grp);
      const label = el('text', { x: 644, y: y + 8.5, class: 'row-text' }, grp, '');
      return { grp, label };
    });
    el('rect', { x: 628, y: 246, width: 416, height: 14, rx: 3, class: 'band-white' }, g);
    el('text', { x: 638, y: 256, class: 't-sub' }, g, '结束标志 55 AA · 第 510–511 字节');

    N.parts = M.PARTITIONS.map((pt, k) => {
      const x0 = PART_X[k];
      const frame = el('rect', { x: x0, y: 282, width: 208, height: 304, rx: 8, class: 'part' }, g);
      el('text', { x: x0 + 12, y: 302, class: 't-title' }, g, `分区 ${pt.id} · ${pt.system}`);
      const flag = el('text', { x: x0 + 196, y: 302, class: 't-mono', 'text-anchor': 'end' }, g, '0x00');
      const pbr = el('rect', { x: x0 + 12, y: 312, width: 184, height: 40, rx: 4, class: 'file' }, g);
      el('text', { x: x0 + 20, y: 330, class: 't-title' }, g, '第 1 扇区 · 引导代码');
      el('text', { x: x0 + 20, y: 344, class: 't-sub' }, g, '末尾 55 AA · PBR');
      el('rect', { x: x0 + 12, y: 362, width: 184, height: 92, rx: 4, class: 'band-white' }, g);
      el('text', { x: x0 + 20, y: 378, class: 't-title' }, g, '根目录');
      const bmFile = el('rect', { x: x0 + 20, y: 386, width: 168, height: 22, rx: 4, class: 'file' }, g);
      el('text', { x: x0 + 28, y: 401, class: 't-mono' }, g, `${pt.loader} · 启动管理器`);
      el('rect', { x: x0 + 12, y: 462, width: 184, height: 60, rx: 4, class: 'band-white' }, g);
      el('text', { x: x0 + 20, y: 478, class: 't-title' }, g, '文件系统区');
      const kFile = el('rect', { x: x0 + 20, y: 486, width: 168, height: 22, rx: 4, class: 'file' }, g);
      el('text', { x: x0 + 28, y: 501, class: 't-mono' }, g, 'OS 内核镜像');
      el('text', { x: x0 + 20, y: 558, class: 't-sub' }, g, '数据区 · 不参与引导');
      return { frame, flag, pbr, bmFile, kFile };
    });
  }

  function buildPackets(g) {
    const make = (label) => {
      const grp = el('g', { class: 'pkt', opacity: 0 }, g);
      el('rect', { x: -46, y: -11, width: 92, height: 22, rx: 11 }, grp);
      const text = el('text', { x: 0, y: 4, class: 'pkt-text', 'text-anchor': 'middle' }, grp, label);
      return { grp, text };
    };
    N.pkt = {
      mbr: make('MBR 512 B'),
      pbr: make('PBR 512 B'),
      bm: make('bootmgr'),
      k: make('内核镜像')
    };
  }

  function buildTags(g) {
    N.tags = [];
    state.seq.steps.forEach((s) => s.tags.forEach((tg) => {
      const grp = el('g', { class: `tag tone-${tg.tone}`, opacity: 0 }, g);
      const bg = el('rect', { x: 0, y: 0, width: 80, height: 22, rx: 11, class: 'tag-bg' }, grp);
      const tx = el('text', { x: 40, y: 11, class: 'tag-text', 'text-anchor': 'middle' }, grp, tg.text);
      N.tags.push({ grp, bg, tx, anchor: tg.anchor });
    }));
  }

  function build() {
    svg.setAttribute('viewBox', `0 0 ${VIEW.w} ${VIEW.h}`);
    const gRoutes = el('g', {}, svg);
    const gRam = el('g', {}, svg);
    const gCpu = el('g', {}, svg);
    const gDisk = el('g', {}, svg);
    const gPkt = el('g', {}, svg);
    const gTag = el('g', {}, svg);
    buildRoutes(gRoutes);
    buildRam(gRam);
    buildCpu(gCpu);
    buildDisk(gDisk);
    buildPackets(gPkt);
    buildTags(gTag);
  }

  function buildTrack() {
    const nav = $('track');
    N.trackBtns = [];
    ['init', 'kernel', 'services'].forEach((phase) => {
      const group = document.createElement('div');
      group.className = 'track-group';
      const label = document.createElement('span');
      label.className = 'track-group-label';
      label.textContent = M.PHASE_NAME[phase];
      const row = document.createElement('div');
      row.className = 'track-buttons';
      M.STEP_SPEC.forEach((spec, i) => {
        if (spec.phase !== phase) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'track-step';
        btn.textContent = `${i + 1} ${spec.track}`;
        btn.title = `跳到第 ${i + 1} 步：${spec.title}`;
        btn.addEventListener('click', () => {
          stopIfPlaying();
          seek(state.seq.steps[i].t0);
        });
        row.appendChild(btn);
        N.trackBtns[i] = btn;
      });
      group.append(label, row);
      nav.appendChild(group);
    });
  }

  /* ---------------------------------------------------------------- */
  /* 渲染：按 t 重算全部可见状态                                         */
  /* ---------------------------------------------------------------- */

  function placePacket(pkt, st, pathEl) {
    if (!st.visible) {
      attr(pkt.grp, 'opacity', 0);
      setClass(pathEl, 'route');
      return;
    }
    const pt = pathEl.getPointAtLength(st.p * lengths.get(pathEl));
    attr(pkt.grp, 'opacity', 1);
    attr(pkt.grp, 'transform', `translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)})`);
    setClass(pathEl, 'route is-on');
  }

  function renderCpuAndRom(s) {
    setText(N.pc, `PC  ${s.pc}`);
    setText(N.exec, s.exec);
    setClass(N.romChip, 'chip' + (s.romActive ? ' is-exec' : ''));
    setClass(N.romBlk, 'blk' + (s.romActive ? ' is-exec' : ''));
    N.svc.forEach((rect, i) => setClass(rect, 'svc' + (i < s.svcUp ? ' is-up' : '')));
    attr(N.login, 'opacity', s.login ? 1 : 0);
  }

  function renderMemory(s) {
    const b = s.boot;
    setClass(N.bootBlk, b.slot === 'empty' ? 'blk is-free' : 'blk is-loaded');
    setText(N.bootSub, b.slot === 'empty' ? '空' : b.slot === 'mbr' ? 'MBR（选盘后读入）' : 'PBR（覆盖 MBR）');
    setClass(N.mbrCopyBlk, 'blk' + (b.mbrCopy ? ' is-loaded' : ' is-free'));
    setClass(N.bmBlk, 'blk' + (b.bootmgr ? ' is-loaded' : ' is-free'));
    setText(N.bmSub, b.bootmgr ? `${b.loader} 已装入` : '未装入');

    const k = b.kernel;
    setClass(N.kernBlk, 'blk' + (k.state === 'resident' ? ' is-key' : k.state === 'loading' ? ' is-loaded' : ' is-free'));
    setText(N.kernStatus, k.state === 'empty' ? '待装入…' : k.state === 'loading' ? `装入中 ${Math.round(k.frac * 100)}%` : '已驻留 RAM');
    setClass(N.kernStatus, k.state === 'resident' ? 't-key' : 't-sub');
    attr(N.kernBar, 'width', (152 * k.frac).toFixed(2));
    setClass(N.kernBar, k.state === 'resident' ? 'bar is-key' : 'bar');

    for (let i = 0; i < M.IVT_SIZE; i++) {
      const r = IVT_RANK[i];
      let cls = 'cell';
      if (r.bios !== undefined) { if (r.bios < s.ivt.bios) cls += ' is-bios'; }
      else if (r.kern < s.ivt.kernel) cls += ' is-kernel';
      setClass(N.cells[i], cls);
    }
  }

  function renderDisk(s) {
    setClass(N.sector0, 'blk' + (s.disk.mbrReading ? ' is-exec' : ''));
    s.dpt.forEach((r, i) => {
      const row = N.rows[i];
      setClass(row.grp, 'row' + (r.state === 'idle' ? '' : ` is-${r.state}`));
      const word = { idle: '未检查', scan: '检查中', skip: '跳过', found: '活动' }[r.state];
      setText(row.label, `P${r.id}  首字节 ${r.flag}  ${word}`);
    });
    s.partitions.forEach((p, k) => {
      const n = N.parts[k];
      // 活动标志要等分区表检查命中后才被认出；检查前只是磁盘上的一个字节
      const known = s.dpt[p.id - 1].state === 'found';
      const hot = p.active && known;
      setClass(n.frame, 'part' + (hot ? ' is-active' : ''));
      setText(n.flag, p.active ? (known ? '0x80 活动' : '0x80') : '0x00');
      setClass(n.flag, 't-mono' + (hot ? ' t-key' : ''));
      setClass(n.pbr, 'file' + (p.bootReading ? ' is-read' : ''));
      setClass(n.bmFile, 'file' + (p.bmReading ? ' is-read' : ''));
      setClass(n.kFile, 'file' + (p.kReading ? ' is-read' : ''));
    });
  }

  function renderPackets(s) {
    const a = state.active - 1;
    setText(N.pkt.bm.text, s.boot.loader);
    placePacket(N.pkt.mbr, s.packets.mbr, N.routes.mbr[0]);
    placePacket(N.pkt.pbr, s.packets.pbr, N.routes.pbr[a]);
    placePacket(N.pkt.bm, s.packets.bm, N.routes.bm[a]);
    placePacket(N.pkt.k, s.packets.k, N.routes.k[a]);
  }

  function renderTags(s) {
    s.tags.forEach((tg, i) => {
      const node = N.tags[i];
      const w = tagWidth(tg.text);
      setText(node.tx, tg.text);
      attr(node.bg, 'width', w);
      attr(node.tx, 'x', w / 2);
      const [ax, ay] = ANCHOR[tg.anchor];
      attr(node.grp, 'opacity', tg.opacity.toFixed(3));
      attr(node.grp, 'transform', `translate(${(ax - w / 2).toFixed(2)} ${(ay - tg.rise - 11).toFixed(2)})`);
    });
  }

  function render(t) {
    const s = M.sample(state.seq, t);

    setText(N.clock, `${s.t.toFixed(1)} s`);
    setText(N.phase, s.phaseName);
    setText(N.stepTitle, s.title);
    setText(N.stepIndex, `第 ${s.index + 1} / ${s.count} 步`);
    setText(N.caption, s.say);
    setText(N.counts, `分区表 已检查 ${s.scanned}/${M.DPT_ENTRIES} · 中断向量 ${s.ivt.total}/${M.IVT_SIZE}`);
    setClass(N.stage, 'stage' + (state.playing ? ' is-running' : ''));

    N.trackBtns.forEach((btn, i) => {
      setClass(btn, 'track-step' + (i === s.index ? ' is-current' : i < s.index ? ' is-passed' : ''));
      if (i === s.index) btn.setAttribute('aria-current', 'step');
      else btn.removeAttribute('aria-current');
    });

    renderCpuAndRom(s);
    renderMemory(s);
    renderDisk(s);
    renderPackets(s);
    renderTags(s);

    if (!state.scrubbing) N.progress.value = s.t.toFixed(2);
    setText(N.progressCaption, `${s.t.toFixed(1)} / ${s.duration.toFixed(1)} s`);
    if (state.playing) queueLink();
  }

  /* ---------------------------------------------------------------- */
  /* 时间控制：GSAP 只推进 t，画面由 render(t) 决定                       */
  /* ---------------------------------------------------------------- */

  function starts() {
    return M.stepStarts(state.seq).concat([state.seq.duration]);
  }

  function nextBoundary(t) {
    const hit = starts().find((x) => x > t + EPS);
    return hit === undefined ? state.seq.duration : hit;
  }

  function prevBoundary(t) {
    const list = M.stepStarts(state.seq);
    const idx = M.stepIndexAt(state.seq, t);
    if (t - list[idx] > 0.05) return list[idx];
    return idx > 0 ? list[idx - 1] : 0;
  }

  function ensureTween() {
    if (!hasGsap()) return null;
    if (state.tween) return state.tween;
    const proxy = { v: state.t };
    state.tween = window.gsap.to(proxy, {
      v: state.seq.duration,
      duration: state.seq.duration,
      ease: 'none',
      paused: true,
      onUpdate: () => { state.t = proxy.v; render(state.t); },
      onComplete: () => stopPlayback()
    });
    return state.tween;
  }

  function seek(t) {
    const dur = state.seq.duration;
    const x = clamp(t, 0, dur);
    state.t = x;
    if (state.tween) state.tween.progress(x / dur, true);
    render(x);
    writeLink();
  }

  function setPlayUI() {
    const atEnd = !state.playing && state.t >= state.seq.duration - EPS;
    $('play-symbol').textContent = state.playing ? '❚❚' : atEnd ? '↺' : '▶';
    $('play-label').textContent = state.playing ? '暂停' : atEnd ? '重播' : '播放';
    N.play.disabled = !hasGsap();
  }

  // 减少动效：不做补间，每一步起点直接跳转并停留
  function holdThenStep() {
    state.hold = window.gsap.delayedCall(REDUCED_HOLD / state.speed, reducedStep);
  }

  function reducedStep() {
    state.hold = null;
    const next = nextBoundary(state.t);
    seek(next);
    if (state.t >= state.seq.duration - EPS) { stopPlayback(); return; }
    holdThenStep();
  }

  function play() {
    if (state.playing || !hasGsap()) return;
    if (state.t >= state.seq.duration - EPS) seek(0);
    state.playing = true;
    setPlayUI();
    if (state.reduce) {
      holdThenStep();
    } else {
      ensureTween().timeScale(state.speed).play();
    }
    render(state.t);
  }

  function stopPlayback() {
    state.playing = false;
    if (state.tween) state.tween.pause();
    if (state.hold) { state.hold.kill(); state.hold = null; }
    setPlayUI();
    render(state.t);
    writeLink();
  }

  function stopIfPlaying() {
    if (state.playing) stopPlayback();
  }

  /* ---------------------------------------------------------------- */
  /* 活动分区：切换后保留时刻并暂停                                      */
  /* ---------------------------------------------------------------- */

  function applyActiveRoutes() {
    const a = state.active - 1;
    ['pbr', 'bm', 'k'].forEach((key) => {
      N.routes[key].forEach((path, i) => path.setAttribute('display', i === a ? 'inline' : 'none'));
    });
  }

  function setActive(value) {
    stopIfPlaying();
    state.active = value;
    state.seq = M.buildSequence({ active: value });
    applyActiveRoutes();
    render(state.t);
    writeLink();
  }

  /* ---------------------------------------------------------------- */
  /* 地址栏状态：#t=…&a=…，replaceState，不增加历史记录                 */
  /* ---------------------------------------------------------------- */

  function readLink() {
    const params = new URLSearchParams(location.hash.slice(1));
    const t = Number(params.get('t'));
    const a = Number(params.get('a'));
    return {
      t: params.has('t') && Number.isFinite(t) ? clamp(t, 0, state.seq.duration) : 0,
      active: M.PARTITIONS.some((p) => p.id === a) ? a : 1
    };
  }

  function writeLink() {
    clearTimeout(state.linkTimer);
    state.linkTimer = null;
    try {
      const params = new URLSearchParams({ t: state.t.toFixed(2), a: String(state.active) });
      history.replaceState(null, '', `#${params.toString()}`);
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
    N.play = $('play');
    N.reset = $('reset');
    N.previous = $('previous');
    N.next = $('next');
    N.progress = $('progress');
    N.progressCaption = $('progress-caption');
    N.speed = $('speed');
    N.reduce = $('reduce-motion');
    N.notice = $('dependency-notice');
    N.clock = $('clock');
    N.phase = $('phase');
    N.stepTitle = $('step-title');
    N.stepIndex = $('step-index');
    N.caption = $('caption');
    N.counts = $('counts');
    N.stage = $('stage');

    N.play.addEventListener('click', () => (state.playing ? stopPlayback() : play()));
    N.reset.addEventListener('click', () => { stopIfPlaying(); seek(0); });
    N.previous.addEventListener('click', () => { stopIfPlaying(); seek(prevBoundary(state.t)); });
    N.next.addEventListener('click', () => { stopIfPlaying(); seek(nextBoundary(state.t)); });

    N.progress.addEventListener('input', () => {
      state.scrubbing = true;
      stopIfPlaying();
      seek(Number(N.progress.value));
    });
    N.progress.addEventListener('change', () => { state.scrubbing = false; writeLink(); });

    N.speed.addEventListener('change', () => {
      state.speed = Number(N.speed.value);
      if (state.tween) state.tween.timeScale(state.speed);
    });

    N.reduce.addEventListener('change', () => {
      const wasPlaying = state.playing;
      stopIfPlaying();
      state.reduce = N.reduce.checked;
      document.documentElement.dataset.motion = state.reduce ? 'reduce' : 'full';
      if (wasPlaying) play();
    });

    document.querySelectorAll('input[name="active"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) setActive(Number(input.value));
      });
    });

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
        seek(nextBoundary(state.t));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stopIfPlaying();
        seek(prevBoundary(state.t));
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
    state.seq = M.buildSequence({ active: 1 });
    const link = readLink();
    state.active = link.active;
    state.seq = M.buildSequence({ active: state.active });
    state.t = link.t;

    build();
    buildTrack();
    bindControls();

    document.querySelectorAll('input[name="active"]').forEach((input) => {
      input.checked = Number(input.value) === state.active;
    });
    N.reduce.checked = state.reduce;
    document.documentElement.dataset.motion = state.reduce ? 'reduce' : 'full';
    N.progress.max = String(state.seq.duration);
    applyActiveRoutes();
    N.notice.hidden = hasGsap();

    render(state.t);
    setPlayUI();
  }

  init();
})();
