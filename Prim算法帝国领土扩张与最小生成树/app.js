/**
 * ══════════════════════════════════════════════════════════════════════
 *  Prim 算法：帝国领土扩张与最小生成树机制
 *  核心交互逻辑 · 动效状态机 · 割性质贪心计算
 *
 *  设计契约 (遵循 AGENTS.md / DESIGN_SYSTEM.md 铁律)：
 *   §3.5 防呆铁律 1 —— 任何重置 / 换起点 / 切预设 / 单步 / 倍速前，
 *                    必定先 gsap.killTweensOf('*') + 清空延时器 + 令牌作废。
 *   §3.6 防呆铁律 2 —— 无写死像素宽度；监听 resize/ResizeObserver 重算
 *                    节点坐标、SVG 连线与领土气泡路径；严禁横向滚动条。
 *   §3.7 防呆铁律 3 —— 成本公式一律 katex.render() 局部重绘，
 *                    严禁拼接原始 innerHTML / LaTeX 裸奔。
 *   §3.2 3-Stage 管线 —— 单步后退等状态切换严格 Outro → Pivot → Intro。
 * ══════════════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════
  // §1 地图预设 (归一化坐标 0~1，y 轴向下，随视口弹性重算像素)
  // ════════════════════════════════════════════════════════════
  const PRESETS = {
    classic: {
      label: '经典 6 国图',
      nodes: [
        { id: 'A', x: 0.50, y: 0.13 },
        { id: 'B', x: 0.16, y: 0.40 },
        { id: 'C', x: 0.84, y: 0.37 },
        { id: 'D', x: 0.30, y: 0.86 },
        { id: 'E', x: 0.71, y: 0.84 },
        { id: 'F', x: 0.50, y: 0.55 }
      ],
      edges: [
        ['A', 'B', 4], ['A', 'C', 2], ['A', 'F', 1],
        ['B', 'F', 2], ['C', 'F', 3], ['B', 'D', 3],
        ['D', 'F', 5], ['D', 'E', 6], ['C', 'E', 2],
        ['E', 'F', 4], ['A', 'D', 7]
      ]
    },
    dense: {
      label: '稠密图 (7 国)',
      nodes: [
        { id: 'A', x: 0.50, y: 0.10 },
        { id: 'B', x: 0.14, y: 0.30 },
        { id: 'C', x: 0.86, y: 0.28 },
        { id: 'D', x: 0.50, y: 0.47 },
        { id: 'E', x: 0.13, y: 0.74 },
        { id: 'F', x: 0.87, y: 0.72 },
        { id: 'G', x: 0.50, y: 0.90 }
      ],
      edges: [
        ['A', 'B', 3], ['A', 'C', 4], ['A', 'D', 2],
        ['B', 'D', 3], ['C', 'D', 1], ['B', 'E', 4],
        ['D', 'E', 5], ['D', 'F', 2], ['C', 'F', 5],
        ['D', 'G', 6], ['E', 'G', 3], ['F', 'G', 4],
        ['A', 'E', 8], ['A', 'F', 7]
      ]
    },
    chain: {
      label: '稀疏长链图',
      nodes: [
        { id: 'A', x: 0.09, y: 0.30 },
        { id: 'B', x: 0.28, y: 0.44 },
        { id: 'C', x: 0.47, y: 0.26 },
        { id: 'D', x: 0.66, y: 0.40 },
        { id: 'E', x: 0.87, y: 0.26 },
        { id: 'F', x: 0.85, y: 0.62 },
        { id: 'G', x: 0.60, y: 0.82 }
      ],
      edges: [
        ['A', 'B', 2], ['B', 'C', 3], ['C', 'D', 2],
        ['D', 'E', 3], ['E', 'F', 2], ['F', 'G', 4],
        ['A', 'C', 9], ['B', 'D', 7], ['C', 'E', 6],
        ['D', 'F', 5], ['E', 'G', 8], ['A', 'D', 10]
      ]
    }
  };

  // ════════════════════════════════════════════════════════════
  // §2 工具函数
  // ════════════════════════════════════════════════════════════
  const NS = 'http://www.w3.org/2000/svg';
  const SAMPLE_N = 72;   // 气泡闭合轮廓重采样点数
  const MOTION = { exit: 'power2.in', pivot: 'expo.out', snap: 'power4.out', stagger: 0.05 };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  /** Andrew 单调链凸包 (供领土气泡贴合所有已占领土) */
  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  /** 闭合 Catmull-Rom → 三次贝塞尔，得到平滑闭合轮廓 */
  function loopToPath(loop) {
    const n = loop.length;
    if (n < 3) return '';
    const f = (v) => v.toFixed(2);
    let d = 'M ' + f(loop[0].x) + ' ' + f(loop[0].y);
    for (let i = 0; i < n; i++) {
      const p0 = loop[(i - 1 + n) % n], p1 = loop[i], p2 = loop[(i + 1) % n], p3 = loop[(i + 2) % n];
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ' C ' + f(c1x) + ' ' + f(c1y) + ', ' + f(c2x) + ' ' + f(c2y) + ', ' + f(p2.x) + ' ' + f(p2.y);
    }
    return d + ' Z';
  }

  /** 旋转轮廓使索引 0 落在最靠上-最靠左处，保证逐点插值不错位、不打结 */
  function alignLoop(loop) {
    if (loop.length < 2) return loop;
    let best = 0;
    for (let i = 1; i < loop.length; i++) {
      const a = loop[i], b = loop[best];
      if (a.y < b.y - 0.01 || (Math.abs(a.y - b.y) <= 0.01 && a.x < b.x)) best = i;
    }
    return loop.slice(best).concat(loop.slice(0, best));
  }

  function circleLoop(c, r) {
    const out = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
    return out;
  }

  function randomId() { return graph.nodes[Math.floor(Math.random() * graph.nodes.length)].id; }

  // ════════════════════════════════════════════════════════════
  // §3 全局状态机
  // ════════════════════════════════════════════════════════════
  const State = {
    presetKey: 'classic',
    capital: null,
    snaps: [],        // 预演快照链：snaps[k] 为第 k 回合结束后的完整世界状态
    index: -1,
    isPlaying: false,
    speed: 1.0
  };

  let graph = { nodes: [], edges: [], byKey: new Map() };
  let nodeEls = {}, edgeEls = {}, edgeRefs = {};
  let pos = {};                 // id -> {x, y} 像素坐标
  let W = 0, H = 0;
  let blobLoop = [];            // 当前气泡轮廓采样点
  let blobRadius = 40;
  let animToken = 0;            // 补间竞态令牌
  let activeTl = null;          // 在途 3-Stage 转场时间轴（显式持有以便确定性终止）
  let hintTimer = null;
  let rafId = null;

  // ── 延时器封装 (可被 killAll 一次性清空) ──
  const Timer = {
    handles: new Set(),
    after(sec, fn) {
      if (!window.gsap) return null;
      const h = gsap.delayedCall(sec, function () {
        Timer.handles.delete(h);
        fn();
      });
      Timer.handles.add(h);
      return h;
    },
    clear() {
      Timer.handles.forEach((h) => h.kill());
      Timer.handles.clear();
    }
  };

  // ════════════════════════════════════════════════════════════
  // §4 DOM 引用
  // ════════════════════════════════════════════════════════════
  let D = {};
  function bindDom() {
    const ids = [
      'stage-container', 'map-svg', 'blob-group', 'blob-breathe', 'blob-halo', 'blob-fill', 'blob-stroke',
      'edge-layer', 'node-layer', 'pulse-layer', 'probe-layer',
      'stage-status', 'stage-led', 'stage-hint',
      'terr-owned', 'terr-pending', 'terr-count', 'terr-total', 'pend-count',
      'frontier-list', 'cut-count', 'cut-min-hint',
      'cost-total', 'cost-edges', 'cost-formula', 'cost-stamp', 'stamp-inner',
      'hud-bar', 'hud-text', 'hud-badge',
      'capital-chip', 'round-dots', 'step-counter', 'meta-n', 'meta-e',
      'btn-play', 'btn-play-icon', 'btn-play-text', 'btn-step-prev', 'btn-step-next',
      'btn-reset', 'btn-random-capital', 'slider-speed', 'label-speed'
    ];
    ids.forEach((id) => { D[id] = document.getElementById(id); });
  }

  // ════════════════════════════════════════════════════════════
  // §5 节点 / 道路 DOM 构建
  // ════════════════════════════════════════════════════════════
  function buildGraph(preset) {
    const nodes = preset.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
    const edges = preset.edges
      .map((e, i) => ({ u: e[0], v: e[1], w: e[2], idx: i }))
      .sort((a, b) => a.w - b.w || a.idx - b.idx);       // 权值升序 + 稳定同权序
    edges.forEach((e) => { e.key = e.u < e.v ? e.u + '|' + e.v : e.v + '|' + e.u; });
    graph = { nodes, edges, byKey: new Map(edges.map((e) => [e.key, e])) };
    buildNodeDom();
    buildEdgeDom();
    D['meta-n'].textContent = nodes.length;
    D['meta-e'].textContent = edges.length;
    D['terr-total'].textContent = nodes.length;
  }

  function buildNodeDom() {
    D['node-layer'].replaceChildren();
    nodeEls = {};
    graph.nodes.forEach((n) => {
      const g = svgEl('g', { class: 'node', 'data-id': n.id, 'data-owned': '0', 'data-capital': '0' });
      g.appendChild(svgEl('circle', { class: 'node-hit', r: 31, fill: 'transparent' }));
      g.appendChild(svgEl('circle', { class: 'node-halo', r: 27 }));
      g.appendChild(svgEl('circle', { class: 'node-ring', r: 21.5 }));
      g.appendChild(svgEl('circle', { class: 'node-core', r: 15 }));
      const lb = svgEl('text', { class: 'node-label', x: 0, y: 0 });
      lb.textContent = n.id;
      g.appendChild(lb);
      const cap = svgEl('text', { class: 'node-cap', x: 0, y: 26 });
      cap.textContent = '都';
      g.appendChild(cap);
      D['node-layer'].appendChild(g);
      nodeEls[n.id] = g;
    });
  }

  function buildEdgeDom() {
    D['edge-layer'].replaceChildren();
    edgeEls = {}; edgeRefs = {};
    graph.edges.forEach((e) => {
      const g = svgEl('g', { class: 'edge', 'data-state': 'idle', 'data-key': e.key });
      const glow = svgEl('line', { class: 'edge-glow' });
      const base = svgEl('line', { class: 'edge-base' });
      const flow = svgEl('line', { class: 'edge-flow' });
      g.append(glow, base, flow);

      const anchor = svgEl('g', { class: 'edge-label-anchor' });
      const inner = svgEl('g', { class: 'edge-label' });
      const bw = 21 + (String(e.w).length - 1) * 8;
      const rect = svgEl('rect', { class: 'edge-label-bg', x: -bw / 2, y: -9.5, width: bw, height: 19 });
      const txt = svgEl('text', { class: 'edge-label-text', x: 0, y: 0 });
      txt.textContent = String(e.w);
      inner.append(rect, txt);
      anchor.appendChild(inner);
      g.appendChild(anchor);

      const mark = svgEl('g', { class: 'edge-dead-mark' });
      mark.append(
        svgEl('line', { x1: -4.5, y1: -4.5, x2: 4.5, y2: 4.5 }),
        svgEl('line', { x1: -4.5, y1: 4.5, x2: 4.5, y2: -4.5 })
      );
      g.appendChild(mark);

      D['edge-layer'].appendChild(g);
      edgeEls[e.key] = g;
      edgeRefs[e.key] = { g, glow, base, flow, anchor, mark };
    });
  }

  // ════════════════════════════════════════════════════════════
  // §6 弹性响应式布局 (防呆铁律 2)
  // ════════════════════════════════════════════════════════════
  function layout() {
    if (!graph.nodes.length) return;
    const rect = D['map-svg'].getBoundingClientRect();
    if (rect.width < 60 || rect.height < 60) return;
    W = rect.width; H = rect.height;
    D['map-svg'].setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    const padX = Math.max(50, W * 0.095);
    const padY = Math.max(44, H * 0.105);
    blobRadius = Math.max(24, Math.min(W, H) * 0.082);

    pos = {};
    graph.nodes.forEach((n) => {
      const p = { x: padX + n.x * (W - padX * 2), y: padY + n.y * (H - padY * 2) };
      pos[n.id] = p;
      nodeEls[n.id].setAttribute('transform', 'translate(' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + ')');
    });

    graph.edges.forEach(setEdgeGeom);
    if (blobLoop.length) drawBlob(blobLoop);
    updateBlobOrigin();
  }

  function setEdgeGeom(e) {
    const a = pos[e.u], b = pos[e.v];
    if (!a || !b) return;
    const r = edgeRefs[e.key];
    [r.glow, r.base, r.flow].forEach((ln) => {
      ln.setAttribute('x1', a.x.toFixed(2)); ln.setAttribute('y1', a.y.toFixed(2));
      ln.setAttribute('x2', b.x.toFixed(2)); ln.setAttribute('y2', b.y.toFixed(2));
    });
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;                  // 单位法线
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    r.anchor.setAttribute('transform',
      'translate(' + (mx + nx * 13).toFixed(2) + ',' + (my + ny * 13).toFixed(2) + ')');
    r.mark.setAttribute('transform',
      'translate(' + (mx - nx * 13).toFixed(2) + ',' + (my - ny * 13).toFixed(2) + ')');
  }

  function onResize() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(function () { rafId = null; layout(); });
  }

  // ════════════════════════════════════════════════════════════
  // §7 领土气泡 (Territory Blob)：凸包 → 平滑闭合轮廓 → GSAP 弹性融合
  // ════════════════════════════════════════════════════════════
  function samplePath(d, n) {
    const p = svgEl('path', { d: d });
    D['probe-layer'].appendChild(p);
    const total = p.getTotalLength();
    const out = [];
    for (let i = 0; i < n; i++) {
      const pt = p.getPointAtLength((total * i) / n);
      out.push({ x: pt.x, y: pt.y });
    }
    D['probe-layer'].removeChild(p);
    return out;
  }

  function sampleLoop(loop) {
    const d = loopToPath(loop);
    if (!d) return [];
    return alignLoop(samplePath(d, SAMPLE_N));
  }

  /** 缺省绘制当前 blobLoop（切勿裸调 drawBlob() 而不传参，否则会清空轮廓） */
  function drawBlob(loop) {
    const L = loop || blobLoop;
    const d = L && L.length ? loopToPath(L) : '';
    D['blob-fill'].setAttribute('d', d);
    D['blob-halo'].setAttribute('d', d);
    D['blob-stroke'].setAttribute('d', d);
  }

  /** 由已占领土集合生成贴合轮廓：各点外扩 blobRadius 后取凸包 */
  function blobLoopFor(terr) {
    const seeds = [];
    terr.forEach((id) => {
      const p = pos[id];
      if (p) seeds.push.apply(seeds, circleLoop(p, blobRadius));
    });
    if (!seeds.length) return [];
    return convexHull(seeds);
  }

  function morphLoop(from, to, dur, ease) {
    if (!to.length) { blobLoop = []; drawBlob(blobLoop); return; }
    if (!from.length || !dur) {
      blobLoop = to.map((p) => ({ x: p.x, y: p.y }));
      drawBlob(blobLoop);
      ensureAmbient();
      return;
    }
    const out = from.map((p) => ({ x: p.x, y: p.y }));
    blobLoop = out;
    const st = { t: 0 };
    gsap.to(st, {
      t: 1, duration: dur, ease: ease || 'power3.inOut',
      onUpdate: function () {
        for (let i = 0; i < out.length; i++) {
          out[i].x = from[i].x + (to[i].x - from[i].x) * st.t;
          out[i].y = from[i].y + (to[i].y - from[i].y) * st.t;
        }
        drawBlob(out);
      },
      onComplete: function () {
        blobLoop = out;
        drawBlob(blobLoop);
        ensureAmbient();              // 形变落定后恢复环境呼吸脉冲
      }
    });
  }

  function morphBlobTo(terr, dur, ease) {
    const loop = blobLoopFor(terr);
    if (!loop.length) { blobLoop = []; drawBlob(); updateBlobOrigin(); return; }
    const to = sampleLoop(loop);
    const from = blobLoop.length ? blobLoop : sampleLoop(circleLoop(pos[terr[0]] || { x: W / 2, y: H / 2 }, 4));
    morphLoop(from, to, dur, ease);
  }

  function centroidOf(terr) {
    let sx = 0, sy = 0, n = 0;
    terr.forEach((id) => { const p = pos[id]; if (p) { sx += p.x; sy += p.y; n++; } });
    return n ? { x: sx / n, y: sy / n } : { x: W / 2, y: H / 2 };
  }

  function updateBlobOrigin() {
    if (!window.gsap) return;
    const terr = State.index >= 0 && State.snaps[State.index] ? State.snaps[State.index].territory : [];
    if (!terr.length) { gsap.set(D['blob-breathe'], { clearProps: 'transform' }); return; }
    const c = centroidOf(terr);
    gsap.set(D['blob-breathe'], { svgOrigin: c.x.toFixed(2) + ' ' + c.y.toFixed(2) });
  }

  /**
   * 环境呼吸脉冲。刻意作用在与 3-Stage 转场层 (#blob-group) 分离的
   * #blob-breathe 上：转场补间被 killTweensOf 腰斩时不会污染呼吸动画，反之亦然。
   */
  function ensureAmbient() {
    if (!window.gsap) return;
    const g = D['blob-breathe'];
    gsap.killTweensOf(g);
    if (!blobLoop.length) { gsap.set(g, { clearProps: 'transform' }); return; }
    gsap.set(g, { scale: 1 });
    updateBlobOrigin();
    gsap.to(g, { scale: 1.013, duration: 2.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  }

  // ════════════════════════════════════════════════════════════
  // §8 Prim 贪心：预演整条扩张链 (割 = 边界前线)
  // ════════════════════════════════════════════════════════════
  function buildRun(capitalId) {
    const snaps = [];
    const terr = [capitalId];
    const tset = new Set(terr);
    const mst = [], mstKeys = new Set();
    const deadKeys = new Set();
    let cost = 0;

    function makeSnap(i, chosen, newlyDead) {
      const t = new Set(terr);
      return {
        index: i,
        capital: capitalId,
        territory: terr.slice(),
        mst: mst.slice(),
        mstKeys: new Set(mstKeys),
        deadKeys: new Set(deadKeys),
        newlyDead: newlyDead ? newlyDead.slice() : [],
        cost: cost,
        chosen: chosen,
        // graph.edges 已按权值升序 → 前线清单天然有序
        frontier: graph.edges
          .filter((e) => t.has(e.u) !== t.has(e.v))
          .map((e) => ({ key: e.key, u: e.u, v: e.v, w: e.w }))
      };
    }

    snaps.push(makeSnap(0, null, null));

    while (tset.size < graph.nodes.length) {
      const cands = graph.edges.filter((e) => tset.has(e.u) !== tset.has(e.v));
      if (!cands.length) break;                       // 防御：图不连通
      const best = cands[0];
      const from = tset.has(best.u) ? best.u : best.v;
      const to = tset.has(best.u) ? best.v : best.u;

      // 冗余剔除：新国与老领土之间除所选边外的所有连线均已成环
      const newlyDead = graph.edges.filter((e) =>
        e.key !== best.key && (e.u === to || e.v === to) && tset.has(e.u === to ? e.v : e.u));
      newlyDead.forEach((e) => deadKeys.add(e.key));

      tset.add(to); terr.push(to);
      mst.push({ u: from, v: to, w: best.w, key: best.key });
      mstKeys.add(best.key);
      cost += best.w;

      snaps.push(makeSnap(snaps.length, { from: from, to: to, w: best.w, key: best.key }, newlyDead));
    }
    return snaps;
  }

  function edgeStateOf(snap, e) {
    if (snap.mstKeys.has(e.key)) return 'royal';
    if (snap.deadKeys.has(e.key)) return 'dead';
    for (let i = 0; i < snap.frontier.length; i++) if (snap.frontier[i].key === e.key) return 'frontier';
    return 'idle';
  }

  // ════════════════════════════════════════════════════════════
  // §9 快照渲染
  // ════════════════════════════════════════════════════════════
  function paintSnapshot(snap, opts) {
    const o = opts || {};
    graph.nodes.forEach((n) => {
      const g = nodeEls[n.id];
      g.setAttribute('data-owned', snap.territory.indexOf(n.id) >= 0 ? '1' : '0');
      g.setAttribute('data-capital', snap.capital === n.id ? '1' : '0');
      g.classList.remove('is-incoming');
    });
    graph.edges.forEach((e) => {
      edgeEls[e.key].classList.remove('is-target');
      edgeEls[e.key].setAttribute('data-state', edgeStateOf(snap, e));
    });
    renderTerritoryPills(snap);
    renderFrontierList(snap, o.lockKey || null, o.animate);
    renderCost(snap, o.bounce);
    renderRoundDots(snap);
  }

  /** 即时跳转 (无微节拍等待)，用于单步后退 / 速率切换 / 重置 */
  function applyInstant(idx) {
    const snap = State.snaps[idx];
    if (!snap) return;
    document.body.classList.remove('is-arbitration');
    paintSnapshot(snap, { animate: false });
    morphBlobTo(snap.territory, 0);
    D['cost-stamp'].classList.add('hidden');
    setStageStatus(idx === 0
      ? '首都 ' + snap.capital + ' 已确立 · 首批前线 ' + snap.frontier.length + ' 条'
      : '扩张中 · 已并入 ' + snap.territory.length + '/' + graph.nodes.length + ' 国', 'bg-blue-500');
  }

  function renderTerritoryPills(snap) {
    const owned = D['terr-owned'], pend = D['terr-pending'];
    owned.replaceChildren(); pend.replaceChildren();
    snap.territory.forEach((id) => {
      const c = el('span', 'chip ' + (id === snap.capital ? 'chip-capital' : 'chip-owned'));
      c.appendChild(el('span', null, id));
      c.appendChild(el('span', 'opacity-70 text-[9px]', '国'));
      owned.appendChild(c);
    });
    graph.nodes.forEach((n) => {
      if (snap.territory.indexOf(n.id) < 0) {
        const c = el('span', 'chip chip-pending');
        c.appendChild(el('span', null, n.id));
        c.appendChild(el('span', 'opacity-70 text-[9px]', '国'));
        pend.appendChild(c);
      }
    });
    D['terr-count'].textContent = snap.territory.length;
    D['pend-count'].textContent = graph.nodes.length - snap.territory.length;
  }

  function renderFrontierList(snap, lockKey, animate) {
    const box = D['frontier-list'];
    box.replaceChildren();

    if (!snap.frontier.length) {
      box.appendChild(el('div', 'frontier-empty',
        snap.territory.length >= graph.nodes.length ? '全境已并入 · 无剩余前线' : '前线为空'));
      D['cut-count'].textContent = '0';
      D['cut-min-hint'].textContent = '暂无候选边';
      return;
    }

    snap.frontier.forEach((e, i) => {
      const row = el('div', 'frontier-row');
      if (i === 0) row.classList.add('is-candidate');
      const locked = lockKey && e.key === lockKey;
      if (locked) row.classList.add('is-locked');

      row.appendChild(el('span', 'fr-rank', String(i + 1).padStart(2, '0')));

      const route = el('span', 'fr-route');
      route.appendChild(el('b', null, e.u));
      route.appendChild(document.createTextNode(' → '));
      route.appendChild(el('b', null, e.v));
      row.appendChild(route);

      row.appendChild(el('span', 'fr-weight', String(e.w)));
      row.appendChild(el('span', 'fr-state', locked ? '已锁定' : '等待比价'));
      box.appendChild(row);
    });

    D['cut-count'].textContent = snap.frontier.length;
    const best = snap.frontier[0];
    D['cut-min-hint'].textContent = '最低 ' + best.w + ' → ' + best.u + '–' + best.v;

    if (animate !== false && window.gsap) {
      gsap.fromTo(box.querySelectorAll('.frontier-row'),
        { opacity: 0, x: 12 },
        { opacity: 1, x: 0, duration: 0.3 / State.speed, stagger: 0.045, ease: 'power3.out' });
    }
  }

  function renderCost(snap, bounce) {
    // 防呆铁律 3：公式必须 katex.render() 局部重绘，严禁拼接原始 LaTeX
    const terms = snap.mst.map((m) => m.w);
    const latex = terms.length
      ? '\\text{Cost} = ' + terms.join(' + ') + ' = ' + snap.cost
      : '\\text{Cost} = 0';
    renderMath(D['cost-formula'], latex);

    D['cost-total'].textContent = snap.cost;
    D['cost-edges'].textContent = '已修 ' + snap.mst.length + ' / ' + (graph.nodes.length - 1) + ' 条骨干路';

    if (bounce && window.gsap) {
      gsap.fromTo(D['cost-total'],
        { scale: 1, color: '#D97706' },
        {
          scale: 1.3, color: '#059669', duration: 0.42 / State.speed,
          ease: 'back.out(2.2)', yoyo: true, repeat: 1, transformOrigin: '50% 50%'
        });
    }
  }

  function renderMath(node, latex) {
    if (window.katex) {
      try {
        window.katex.render(latex, node, { throwOnError: false, displayMode: false, output: 'html' });
        return;
      } catch (err) { /* 降级到纯文本 */ }
    }
    node.textContent = latex.replace(/\\text\{([^}]*)\}/g, '$1').replace(/[{}]/g, '');
  }

  function renderRoundDots(snap) {
    const total = graph.nodes.length - 1;
    const box = D['round-dots'];
    box.replaceChildren();
    for (let i = 1; i <= total; i++) {
      const d = el('div', 'round-dot', String(i));
      if (snap.index >= i) d.classList.add('is-done');
      if (snap.index === i - 1) d.classList.add('is-current');
      box.appendChild(d);
    }
    D['step-counter'].textContent = '回合: ' + snap.index + ' / ' + total;
  }

  // ════════════════════════════════════════════════════════════
  // §10 HUD 解说条 (3-Stage: Outro → Pivot → Intro)
  // ════════════════════════════════════════════════════════════
  const BADGE_STYLE = {
    IDLE: 'bg-stone-100 text-stone-700 border-stone-200',
    CAPITAL: 'bg-amber-50 text-amber-800 border-amber-200',
    JUDGE: 'bg-amber-50 text-amber-800 border-amber-200',
    BUILD: 'bg-blue-50 text-blue-800 border-blue-200',
    ANNEX: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    SCAN: 'bg-sky-50 text-sky-800 border-sky-200',
    DONE: 'bg-emerald-100 text-emerald-900 border-emerald-300'
  };

  function setHud(text, badge) {
    const t = D['hud-text'], b = D['hud-badge'];
    if (t.textContent === text && b.textContent === badge) return;
    b.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border shrink-0 ' +
      (BADGE_STYLE[badge] || BADGE_STYLE.IDLE);

    if (!window.gsap) { t.textContent = text; b.textContent = badge; return; }
    gsap.killTweensOf([t, b]);
    const d = 1 / State.speed;
    gsap.timeline()
      .to([t, b], { opacity: 0, y: -8, scale: 0.98, duration: 0.15 * d, ease: MOTION.exit })
      .add(function () { t.textContent = text; b.textContent = badge; })
      .to([t, b], { opacity: 1, y: 0, scale: 1, duration: 0.35 * d, ease: MOTION.snap });
  }

  function setStageStatus(text, ledClass) {
    D['stage-status'].textContent = text;
    D['stage-led'].className = 'w-1.5 h-1.5 rounded-full ' + (ledClass || 'bg-stone-400');
  }

  // ════════════════════════════════════════════════════════════
  // §11 HUD 文案 (零基础通俗解说)
  // ════════════════════════════════════════════════════════════
  const IDLE_HUD = '沙盘待命。请在左侧画布上点击任意国家作为帝国首都（或按下方【🎲 随机指定】）；随后领土气泡将围绕它生成，它的所有对外道路会瞬间激活为首批【前线候选】。';

  function hudCapital(s) {
    const list = s.frontier.map((e) => e.u + '–' + e.v + '(' + e.w + ')').join('、');
    return '首都 ' + s.capital + ' 国确立！领土气泡已在它周围成形，' + s.frontier.length +
      ' 条对外道路瞬间激活为前线候选：' + list + '。现在只需比一比这 ' + s.frontier.length + ' 条路的修路造价。';
  }
  function hudJudge(s, c) {
    return '侦察回报：当前 ' + s.frontier.length + ' 条前线候选道路中，连接国家 ' + c.to +
      ' 的那条最便宜（成本 ' + c.w + '）。贪心裁决——就修它！其余 ' + (s.frontier.length - 1) +
      ' 条进入等待比价状态。';
  }
  function hudPave(c) {
    return '正式修通 ' + c.from + ' → ' + c.to + ' 皇家骨干路（成本 ' + c.w +
      '）！虚线正凝固为加粗发光实线，一道能量脉冲沿着它滑向国家 ' + c.to + '。';
  }
  function hudAnnex(c, to) {
    return '国家 ' + c.to + ' 变色并入帝国版图，领土气泡弹性融合将它整个裹入！国库总成本 +' +
      c.w + '，累计 ' + to.cost + '。';
  }
  function hudScan(c, to) {
    return '前线更新完毕：国家 ' + c.to + ' 的对外道路已全部扫描——新增 ' + to.frontier.length +
      ' 条候选边' + (to.newlyDead.length
        ? '，其中 ' + to.newlyDead.length + ' 条与老领土相连形成环路，已灰化打上 ✕ 作废'
        : '，无成环冗余') + '。当前版图 ' + to.territory.length + '/' + graph.nodes.length + ' 国。';
  }
  function hudDone(s) {
    return '一统收官！全部 ' + graph.nodes.length + ' 国已纳入帝国版图，' + s.mst.length +
      ' 条皇家骨干路构成最小生成树，总修建成本 ' + s.cost +
      '。每一条被标 ✕ 的道路都因成环而多余——MST 只需 n−1 条边，这就是它的极简。';
  }
  function hudBack(s) {
    return '时光回溯：撤回到第 ' + s.index + ' 回合结束的沙盘。当前版图 ' + s.territory.length +
      '/' + graph.nodes.length + ' 国，总成本 ' + s.cost + '，前线候选 ' + s.frontier.length + ' 条。';
  }

  // ════════════════════════════════════════════════════════════
  // §12 动画特效 (能量脉冲 / 吞并闪环 / 收官大印)
  // ════════════════════════════════════════════════════════════
  function clearPulseLayer() {
    const layer = D['pulse-layer'];
    while (layer.firstChild) layer.removeChild(layer.firstChild);
  }

  function launchPulse(edge, dur) {
    const a = pos[edge.u], b = pos[edge.v];
    if (!a || !b) return;
    const dot = svgEl('circle', { class: 'pulse-dot', r: 4.6, cx: a.x, cy: a.y });
    D['pulse-layer'].appendChild(dot);
    const st = { t: 0 };
    gsap.to(st, {
      t: 1, duration: dur, ease: 'power2.inOut',
      onUpdate: function () {
        dot.setAttribute('cx', a.x + (b.x - a.x) * st.t);
        dot.setAttribute('cy', a.y + (b.y - a.y) * st.t);
        dot.setAttribute('r', 4.4 + Math.sin(st.t * Math.PI) * 1.8);
      },
      onComplete: function () { if (dot.parentNode) dot.parentNode.removeChild(dot); }
    });
  }

  function launchAbsorb(id) {
    const p = pos[id];
    if (!p) return;
    const ring = svgEl('circle', { class: 'absorb-ring', cx: p.x, cy: p.y, r: 22, opacity: 0.9 });
    D['pulse-layer'].appendChild(ring);
    const st = { r: 20, o: 0.9 };
    gsap.to(st, {
      r: 62, o: 0, duration: 0.72 / State.speed, ease: 'power2.out',
      onUpdate: function () {
        ring.setAttribute('r', st.r.toFixed(2));
        ring.setAttribute('opacity', st.o.toFixed(3));
      },
      onComplete: function () { if (ring.parentNode) ring.parentNode.removeChild(ring); }
    });
  }

  function runFinale() {
    const s = State.snaps[State.snaps.length - 1];
    const d = 1 / State.speed;
    D['cost-stamp'].classList.remove('hidden');
    setHud(hudDone(s), 'DONE');
    setStageStatus('一统收官 · 最小生成树构建完成', 'bg-emerald-500');
    if (!window.gsap) return;
    gsap.fromTo(D['cost-stamp'], { opacity: 0 }, { opacity: 1, duration: 0.32 * d, ease: MOTION.exit });
    gsap.fromTo(D['stamp-inner'],
      { scale: 1.7, opacity: 0, y: 6 },
      { scale: 1, opacity: 1, y: 0, duration: 0.62 * d, ease: 'back.out(1.5)' });
    const backbone = D['map-svg'].querySelectorAll('.edge[data-state="royal"] .edge-base, .edge[data-state="royal"] .edge-glow');
    gsap.fromTo(backbone,
      { opacity: 0.2 },
      { opacity: 1, duration: 0.3 * d, repeat: 3, yoyo: true, stagger: 0.05, ease: 'sine.inOut' });
  }

  // ════════════════════════════════════════════════════════════
  // §13 回合制扩张时序 (4 微节拍：裁决 → 铺路 → 吞并 → 前线更新)
  // ════════════════════════════════════════════════════════════
  function animateRound(nextIdx, done) {
    const from = State.snaps[State.index];
    const to = State.snaps[nextIdx];
    const c = to.chosen;
    const d = 1 / State.speed;
    const token = animToken;
    const at = (sec, fn) => Timer.after(sec * d, function () {
      if (token === animToken) fn();
    });

    // ── 节拍 2：贪心裁决 ──
    nodeEls[c.to].classList.add('is-incoming');
    edgeEls[c.key].classList.add('is-target');
    at(0.50, function () {
      document.body.classList.add('is-arbitration');
      renderFrontierList(from, c.key, true);
      setHud(hudJudge(from, c), 'JUDGE');
    });

    // ── 节拍 3a：铺路 (虚线 → 加粗发光实线 + 能量脉冲) ──
    at(0.95, function () {
      document.body.classList.remove('is-arbitration');
      edgeEls[c.key].classList.remove('is-target');
      edgeEls[c.key].setAttribute('data-state', 'royal');
      launchPulse({ u: c.from, v: c.to }, 0.62 * d);
      setHud(hudPave(c), 'BUILD');
    });

    // ── 节拍 3b：吞并 (变色 + 气泡弹性融合 + 账本弹跳) ──
    at(1.40, function () {
      launchAbsorb(c.to);
      nodeEls[c.to].setAttribute('data-owned', '1');
      nodeEls[c.to].classList.remove('is-incoming');
      morphBlobTo(to.territory, 0.88 * d, 'back.out(1.15)');
      renderTerritoryPills(to);
      renderCost(to, true);
      setStageStatus('吞并 ' + c.to + ' 国 · 累计成本 ' + to.cost, 'bg-emerald-500');
      setHud(hudAnnex(c, to), 'ANNEX');
    });

    // ── 节拍 4：前线更新与成环冗余剔除 ──
    at(1.90, function () {
      const inc = graph.edges.filter((e) => e.u === c.to || e.v === c.to);
      inc.forEach((e, i) => {
        Timer.after(i * 0.085 * d, function () {
          if (token !== animToken) return;
          edgeEls[e.key].setAttribute('data-state', edgeStateOf(to, e));
        });
      });
      renderFrontierList(to, null, true);
      renderRoundDots(to);
      State.index = nextIdx;
      setHud(hudScan(c, to), 'SCAN');
      setStageStatus('扩张中 · 已并入 ' + to.territory.length + '/' + graph.nodes.length + ' 国', 'bg-blue-500');
      Timer.after(0.55 * d, function () {
        if (token === animToken && typeof done === 'function') done();
      });
    });
  }

  function playLoop() {
    if (!State.isPlaying) return;
    if (State.index >= State.snaps.length - 1) {
      State.isPlaying = false;
      syncPlayBtn();
      runFinale();
      return;
    }
    animateRound(State.index + 1, function () { playLoop(); });
  }

  // ════════════════════════════════════════════════════════════
  // §14 3-Stage 转场引擎 (Outro → Pivot → Intro)
  // ════════════════════════════════════════════════════════════
  /**
   * 显式持有并终止「在途转场时间轴」。
   * 仅靠 gsap.killTweensOf('*') 去终止以 SVG <g> 为目标的 Timeline 并不可靠：
   * 一旦两条时间轴交叠，它们会互相覆写同一批图层的 opacity/scale，
   * 结果是画布永久停在 opacity:0（画面凭空消失）。故必须显式 kill 并归位。
   */
  function killTransition() {
    if (activeTl) { activeTl.kill(); activeTl = null; }
  }

  function runThreeStage(applyFn) {
    if (!window.gsap) { applyFn(); return; }
    killTransition();
    const d = 1 / State.speed;
    const layers = [D['blob-group'], D['edge-layer'], D['node-layer']];
    activeTl = gsap.timeline({
      onComplete: function () { activeTl = null; ensureAmbient(); }
    })
      // 阶段 1 · Outro
      .to(layers, {
        opacity: 0, y: -8, scale: 0.98, transformOrigin: '50% 50%',
        duration: 0.15 * d, ease: MOTION.exit
      })
      // 阶段 2 · Pivot (正中点提交状态数据)
      .add(function () { applyFn(); })
      // 阶段 3 · Intro (对称滑入，零回弹硬朗入定)
      .fromTo(layers, {
        opacity: 0, y: 12, scale: 0.985, transformOrigin: '50% 50%'
      }, {
        opacity: 1, y: 0, scale: 1, duration: 0.35 * d, ease: MOTION.snap
      })
      .fromTo(D['node-layer'].querySelectorAll('.node'),
        { opacity: 0 }, { opacity: 1, duration: 0.25 * d, stagger: 0.04, ease: 'power3.out' }, '-=0.18');
    return activeTl;
  }

  // ════════════════════════════════════════════════════════════
  // §15 补间竞态清理 (防呆铁律 1)
  // ════════════════════════════════════════════════════════════

  /**
   * 把「转场中」的可视状态一次性复位到静止态。
   * 必须紧跟 killTweensOf('*')：否则被腰斩的 Outro/Intro 补间会让
   * 画布图层永久停在 opacity:0 / scale:0.98 上（画面凭空消失）。
   */
  function restoreVisuals() {
    if (!window.gsap) return;
    gsap.set([D['blob-group'], D['edge-layer'], D['node-layer']],
      { clearProps: 'opacity,transform' });
    gsap.set(D['blob-breathe'], { clearProps: 'scale' });
    const nodes = D['node-layer'].querySelectorAll('.node');
    if (nodes.length) gsap.set(nodes, { clearProps: 'opacity,transform' });
    gsap.set([D['hud-text'], D['hud-badge'], D['cost-total'], D['cut-min-hint']],
      { clearProps: 'opacity,transform,color' });
    gsap.set(D['cost-stamp'], { opacity: D['cost-stamp'].classList.contains('hidden') ? 0 : 1 });
    gsap.set(D['stamp-inner'], { clearProps: 'opacity,transform' });
  }

  function killAll() {
    animToken++;                                  // 令牌作废：所有在途回调立即失效
    Timer.clear();
    killTransition();                             // 确定性终止在途转场时间轴
    if (window.gsap) gsap.killTweensOf('*');
    restoreVisuals();
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    document.body.classList.remove('is-arbitration');
    Object.keys(edgeEls).forEach((k) => edgeEls[k].classList.remove('is-target'));
    Object.keys(nodeEls).forEach((k) => nodeEls[k].classList.remove('is-incoming'));
    clearPulseLayer();
    ensureAmbient();
  }

  // ════════════════════════════════════════════════════════════
  // §16 控制动作
  // ════════════════════════════════════════════════════════════
  function syncPlayBtn() {
    D['btn-play-icon'].textContent = State.isPlaying ? '⏸' : '▶';
    D['btn-play-text'].textContent = State.isPlaying ? '暂停扩张' : '启动连续扩张';
  }

  function setCapitalChip(id) {
    const c = D['capital-chip'];
    if (id) {
      c.textContent = id + '国';
      c.className = 'px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 font-mono font-semibold';
    } else {
      c.textContent = '未定';
      c.className = 'px-2.5 py-1 rounded-lg border border-dashed border-stone-300 bg-stone-50 text-stone-400 font-mono font-semibold';
    }
  }

  function pickCapital(id) {
    if (!nodeEls[id]) return;
    killAll();
    State.capital = id;
    State.snaps = buildRun(id);
    State.index = 0;
    State.isPlaying = false;
    syncPlayBtn();
    setCapitalChip(id);
    D['stage-container'].classList.remove('selecting');
    D['stage-hint'].classList.add('hidden');
    D['cost-stamp'].classList.add('hidden');

    const snap = State.snaps[0];
    paintSnapshot(snap, { animate: true });
    morphBlobTo(snap.territory, 0.85 / State.speed, 'back.out(1.2)');
    setHud(hudCapital(snap), 'CAPITAL');
    setStageStatus('首都 ' + id + ' 已确立 · 首批前线 ' + snap.frontier.length + ' 条', 'bg-amber-500');
  }

  function togglePlay() {
    if (State.isPlaying) {
      killAll();
      State.isPlaying = false;
      syncPlayBtn();
      return;
    }
    if (!State.capital) pickCapital(randomId());
    killAll();
    if (State.index >= State.snaps.length - 1) {
      // 已在一统收官位：从首都重新出发
      State.index = 0;
      D['cost-stamp'].classList.add('hidden');
      applyInstant(0);
    }
    State.isPlaying = true;
    syncPlayBtn();
    Timer.after(0.2 / State.speed, function () { playLoop(); });
  }

  function stepForward() {
    killAll();
    State.isPlaying = false;
    syncPlayBtn();
    if (!State.capital) { pickCapital(randomId()); return; }
    if (State.index >= State.snaps.length - 1) { runFinale(); return; }

    const next = State.index + 1;
    const to = State.snaps[next];
    const c = to.chosen;
    runThreeStage(function () {
      State.index = next;
      applyInstant(next);
      setHud(hudScan(c, to), 'SCAN');
      if (next >= State.snaps.length - 1) runFinale();
    });
  }

  function stepBackward() {
    killAll();
    State.isPlaying = false;
    syncPlayBtn();
    if (!State.capital || State.index <= 0) return;
    const target = State.index - 1;
    runThreeStage(function () {
      State.index = target;
      applyInstant(target);
      setHud(hudBack(State.snaps[target]), 'SCAN');
    });
  }

  function resetPlayhead(keepCapital) {
    killAll();
    State.isPlaying = false;
    syncPlayBtn();
    D['cost-stamp'].classList.add('hidden');
    if (!keepCapital || !State.capital) {
      State.capital = null;
      State.snaps = [];
      State.index = -1;
      setCapitalChip(null);
      D['stage-container'].classList.add('selecting');
      D['stage-hint'].classList.remove('hidden');
      clearWorld();
      setHud(IDLE_HUD, 'IDLE');
      setStageStatus('待命 · 请点选首都', 'bg-stone-400');
      D['step-counter'].textContent = '回合: 0 / ' + (graph.nodes.length - 1);
      return;
    }
    State.index = 0;
    applyInstant(0);
    setHud(hudCapital(State.snaps[0]), 'CAPITAL');
  }

  function clearWorld() {
    graph.nodes.forEach((n) => {
      nodeEls[n.id].setAttribute('data-owned', '0');
      nodeEls[n.id].setAttribute('data-capital', '0');
      nodeEls[n.id].classList.remove('is-incoming');
    });
    graph.edges.forEach((e) => {
      edgeEls[e.key].setAttribute('data-state', 'idle');
      edgeEls[e.key].classList.remove('is-target');
    });
    blobLoop = [];
    drawBlob();
    D['terr-owned'].replaceChildren();
    D['terr-pending'].replaceChildren();
    graph.nodes.forEach((n) => {
      const c = el('span', 'chip chip-pending');
      c.appendChild(el('span', null, n.id));
      c.appendChild(el('span', 'opacity-70 text-[9px]', '国'));
      D['terr-pending'].appendChild(c);
    });
    D['terr-count'].textContent = '0';
    D['pend-count'].textContent = graph.nodes.length;
    D['frontier-list'].replaceChildren();
    D['frontier-list'].appendChild(el('div', 'frontier-empty', '尚未确立首都 · 无前线'));
    D['cut-count'].textContent = '0';
    D['cut-min-hint'].textContent = '暂无候选边';
    renderMath(D['cost-formula'], '\\text{Cost} = 0');
    D['cost-total'].textContent = '0';
    D['cost-edges'].textContent = '已修 0 / ' + (graph.nodes.length - 1) + ' 条骨干路';
    D['round-dots'].replaceChildren();
    ensureAmbient();
  }

  function loadPreset(key) {
    if (!PRESETS[key]) return;
    killAll();
    State.presetKey = key;
    State.capital = null;
    State.snaps = [];
    State.index = -1;
    State.isPlaying = false;
    syncPlayBtn();

    document.querySelectorAll('.preset-btn').forEach((b) => {
      b.classList.toggle('active-preset', b.getAttribute('data-preset') === key);
      b.classList.toggle('bg-blue-50', b.getAttribute('data-preset') === key);
      b.classList.toggle('border-blue-200', b.getAttribute('data-preset') === key);
      b.classList.toggle('text-blue-800', b.getAttribute('data-preset') === key);
      b.classList.toggle('bg-white', b.getAttribute('data-preset') !== key);
      b.classList.toggle('border-[#E5E4DC]', b.getAttribute('data-preset') !== key);
      b.classList.toggle('text-stone-600', b.getAttribute('data-preset') !== key);
    });

    buildGraph(PRESETS[key]);
    setCapitalChip(null);
    D['stage-container'].classList.add('selecting');
    D['stage-hint'].classList.remove('hidden');
    clearWorld();
    setHud(IDLE_HUD, 'IDLE');
    setStageStatus('待命 · 请点选首都', 'bg-stone-400');
    D['step-counter'].textContent = '回合: 0 / ' + (graph.nodes.length - 1);
    layout();
  }

  function flashHint(text, ms) {
    const h = D['stage-hint'];
    h.textContent = text;
    h.classList.remove('hidden');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      hintTimer = null;
      if (State.capital) h.classList.add('hidden');
      else { h.textContent = '✎ 点击画布上任意国家，将其设为首都'; h.classList.remove('hidden'); }
    }, ms || 1900);
  }

  // ════════════════════════════════════════════════════════════
  // §17 事件绑定
  // ════════════════════════════════════════════════════════════
  function bindEvents() {
    // 画布点选首都 (仅限未占领国)
    D['map-svg'].addEventListener('click', function (ev) {
      const g = ev.target.closest ? ev.target.closest('.node') : null;
      if (!g) return;
      const id = g.getAttribute('data-id');
      if (g.getAttribute('data-owned') === '1') {
        flashHint('国家 ' + id + ' 已在帝国版图内 · 请点选灰色的未占领国家作为首都');
        return;
      }
      pickCapital(id);
    });

    D['btn-play'].addEventListener('click', togglePlay);
    D['btn-step-next'].addEventListener('click', stepForward);
    D['btn-step-prev'].addEventListener('click', stepBackward);
    D['btn-reset'].addEventListener('click', function () { resetPlayhead(false); });
    D['btn-random-capital'].addEventListener('click', function () { pickCapital(randomId()); });

    // 速率切换：先清空全部补间，再以当前状态无突变续播
    D['slider-speed'].addEventListener('input', function (e) {
      State.speed = parseFloat(e.target.value);
      D['label-speed'].textContent = State.speed.toFixed(1) + 'x';
      const wasPlaying = State.isPlaying;
      killAll();
      if (State.capital) applyInstant(State.index);
      if (wasPlaying) {
        Timer.after(0.15 / State.speed, function () { playLoop(); });
      }
    });

    document.querySelectorAll('.preset-btn').forEach((b) => {
      b.addEventListener('click', function () { loadPreset(b.getAttribute('data-preset')); });
    });

    // 防呆铁律 2：视口弹性自适应 (window resize + 容器尺寸变化双保险)
    window.addEventListener('resize', onResize);
    if (window.ResizeObserver) {
      new ResizeObserver(onResize).observe(D['stage-container']);
    }
  }

  // ════════════════════════════════════════════════════════════
  // §18 启动
  // ════════════════════════════════════════════════════════════
  function init() {
    bindDom();
    bindEvents();
    loadPreset('classic');
    ensureAmbient();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
