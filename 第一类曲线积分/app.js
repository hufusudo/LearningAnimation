/**
 * 第一类曲线积分 · 物理与几何直观演示
 * 三条轨道：宏观金属丝主舞台 / 局部微元勾股显微台 / 底部质量天平汇流槽
 * 八个节拍：纯净曲线 → 渲染密度 → 破除误区 → 动态分段 → 提取微元 → 勾股展开 → 斜率补偿 → 汇流求和
 */
(function () {
  'use strict';

  const RM = window.CurveModel;
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const gs = () => window.gsap;
  const hasGS = () => !!window.gsap;

  const VB = { w: 760, h: 540 };   // 主舞台 viewBox
  const MB = { w: 560, h: 440 };   // 显微台 viewBox
  const PIECES = 200;              // 密度渐变着色片
  const MAXN = 128;
  const RAMP = ['#FCEFCB', '#E9A93C', '#8F4B12'];  // 浅 = 轻，深 = 重

  /* ───────────────── 节拍脚本 ───────────────── */
  const STEPS = [
    {
      stage: 1, dur: 3600,
      tag: '阶段一 · 线密度场直观感知',
      title: '① 纯净曲线入场',
      text: '一根光滑弯曲的金属细丝 L 静卧在 xOy 坐标系中——先别管密度，只看它的形状与总长度。'
    },
    {
      stage: 1, dur: 4800,
      tag: '阶段一 · 线密度场直观感知',
      title: '② 渲染线密度 ρ(x, y)',
      text: '把线密度映射为颜色深浅：颜色越深越重、越浅越轻。移动鼠标当探针，读取任意点的 ρ。'
    },
    {
      stage: 1, dur: 5400,
      tag: '阶段一 · 线密度场直观感知',
      title: '③ 破除直觉误区',
      text: '各处粗细轻重都不一样，「总长 × 某个密度」必然算错——只能切成极小段，分别称重再相加。'
    },
    {
      stage: 2, dur: 5800,
      tag: '阶段二 · 微元切分与局部直线化',
      title: '④ 动态分段 · 以直代曲',
      text: '拖动分割滑块 N，裁切刻度线浮现；段数越多，折线越紧贴原曲线——弯曲的丝被解构为一截截极短直线。'
    },
    {
      stage: 2, dur: 5800,
      tag: '阶段二 · 微元切分与局部直线化',
      title: '⑤ 微元提取称重',
      text: '选中的第 i 小段被光束投到显微台：足够细微时可看作直线短棍，段内密度变化可忽略，视作常数 ρᵢ。'
    },
    {
      stage: 3, dur: 6400,
      tag: '阶段三 · 勾股展开与定积分求和',
      title: '⑥ 构造局部勾股三角形',
      text: '微元放平后：水平底边 Δx、竖直对边 Δy、倾斜斜边 Δs，直角符号亮起，勾股定理立刻可用。'
    },
    {
      stage: 3, dur: 7200,
      tag: '阶段三 · 勾股展开与定积分求和',
      title: '⑦ 斜率补偿 · 微分代换',
      text: '竖直边按导数定义 Δy ≈ y′(x)Δx；把 (Δx)² 提出根号，水平投影 dx 被还原成弧长 ds。'
    },
    {
      stage: 3, dur: 8000,
      tag: '阶段四 · 汇流求和闭环',
      title: '⑧ 汇流求和 · 闭环为定积分',
      text: '每段质量沿抛物线跌入天平，读数连续累加到 M；让分点无限细密，求和的极限就是第一类曲线积分。'
    }
  ];

  /** 显微台旁的几何解说文本 */
  const TIPS = {
    3: '<p><b>以直代曲：</b>N 越大，相邻分点越密，每一小段折线与原曲线的偏差越小，段内「弯」被摊平成「直」。</p>',
    4:
      '<p><b>当切分得足够细微时</b>，曲线在该极小段内可近似看作直线短棍，其上的密度变化可忽略不计，视作常数 ρᵢ。</p>' +
      '<div data-tex="\\Delta m_i \\approx \\rho(x_i, y_i)\\cdot \\Delta s_i" data-display="1"></div>',
    5:
      '<p><b>微元看作直角三角形斜边：</b>极短小段近似为直线，由勾股定理可得：</p>' +
      '<div data-tex="\\Delta s \\approx \\sqrt{(\\Delta x)^2 + (\\Delta y)^2}" data-display="1"></div>',
    6:
      '<p><b>斜坡总是比平地长：</b>根号因子 <span data-tex="\\sqrt{1+[y\'(x)]^{2}}"></span> 本质是勾股定理算出的<b>局部斜率拉伸倍率</b>——把水平投影 dx 还原回倾斜弧长 ds。</p>',
    7:
      '<p><b>逐段称重再汇流：</b>每段质量用斜率形式写出，按段累加即得天平读数：</p>' +
      '<div data-tex="\\Delta m_i = \\rho(x_i, y_i)\\sqrt{1+[y\'(x_i)]^{2}}\\,\\Delta x_i" data-display="1"></div>'
  };

  /** 原位 KaTeX 推导 */
  const MATHS = {
    4: '<p class="math-line">当前微元密度 <span data-tex="\\rho_i = \\rho(x_i, y_i)"></span> = <b id="mv-rho">—</b> g/cm</p>',
    5:
      '<p class="math-line" id="mv-pyth">—</p>',
    6:
      '<div data-tex="\\mathrm{d}s = \\sqrt{(\\mathrm{d}x)^{2} + (\\mathrm{d}y)^{2}} = \\sqrt{1 + \\left(\\frac{\\mathrm{d}y}{\\mathrm{d}x}\\right)^{2}}\\,\\mathrm{d}x = \\sqrt{1+[y\'(x)]^{2}}\\,\\mathrm{d}x" data-display="1"></div>',
    7:
      '<div data-tex="M = \\lim_{\\lambda \\to 0}\\sum_{i=1}^{n}\\rho(\\xi_i, \\eta_i)\\,\\Delta s_i" data-display="1"></div>'
  };

  /* ───────────────── 状态 ───────────────── */
  const State = {
    step: 0, N: 4, curve: 'parabola', density: 'gradient',
    selFrac: 0.5, selected: 1, auto: false, speed: 1,
    filled: false, splitDemo: false, stage3Bumped: false
  };

  let curve, density, segs, st, rng, view, microGeo;
  let timer = null;
  let pending = [];

  const PROXIES = [];
  const uniq = (p) => { if (PROXIES.indexOf(p) < 0) PROXIES.push(p); return p; };
  let fallProxies = [];
  const mDisp = { m: 0, l: 0 };
  const accDisp = { v: 0 };
  const nProxy = { n: 4 };
  const beamProxy = { t: 0 };
  uniq(mDisp); uniq(accDisp); uniq(nProxy); uniq(beamProxy);

  /* ───────────────── DOM ───────────────── */
  const el = {};
  const IDS = [
    'left-svg', 'g-grid', 'g-wire-solid', 'g-wire-grad', 'g-ticks', 'g-chords', 'g-select', 'g-probe',
    'hit-area', 'micro-svg', 'm-empty', 'm-shape', 'm-base', 'm-alt', 'm-angle', 'm-rod', 'm-rod-halo',
    'beam-layer', 'beam-path', 'beam-glow', 'beam-dot', 'dual-stage', 'left-wrap', 'micro-wrap',
    'lab-s', 'lab-x', 'lab-y', 'lab-slope', 'micro-tip', 'micro-math', 'micro-chip',
    'probe-tip', 'fallacy-card', 'len-chip', 'hint-chip', 'legend-min', 'legend-max', 'legend-bar',
    'meter-m', 'meter-l', 'meter-m-sub', 'meter-l-sub', 'n-slider', 'n-out', 'btn-swap',
    'narration', 'narration-tag', 'narration-title', 'narration-text', 'narration-index',
    'bars', 'fallers', 'basin', 'basin-empty', 'scale-value', 'scale-fill', 'scale-target',
    'formula-reveal', 'formula-1', 'formula-2', 'btn-auto', 'btn-next', 'btn-reset', 'speed-set'
  ];
  function cacheDom() {
    IDS.forEach((id) => { el[id] = document.getElementById(id); });
    el.capsules = Array.from(document.querySelectorAll('.capsule'));
    el.curveBtns = Array.from(document.querySelectorAll('#curve-seg .seg-btn'));
    el.rhoBtns = Array.from(document.querySelectorAll('#rho-seg .seg-btn'));
  }

  /* ───────────────── 工具 ───────────────── */
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

  function renderTex(node, tex, display) {
    if (!node) return;
    if (window.katex) {
      try {
        window.katex.render(tex, node, { displayMode: !!display, throwOnError: false, output: 'html' });
        return;
      } catch (e) { /* 落回纯文本 */ }
    }
    node.textContent = tex;
  }

  function setHTML(node, html) {
    if (!node) return;
    node.innerHTML = html || '';
    node.querySelectorAll('[data-tex]').forEach((t) => {
      renderTex(t, t.getAttribute('data-tex'), t.hasAttribute('data-display'));
    });
  }

  const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function mixHex(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  /** 线密度 → 颜色深浅 */
  function rhoColor(v, r) {
    if (r.max - r.min < 1e-9) return RAMP[1];
    const t = clamp((v - r.min) / (r.max - r.min), 0, 1);
    return t < 0.5 ? mixHex(RAMP[0], RAMP[1], t * 2) : mixHex(RAMP[1], RAMP[2], (t - 0.5) * 2);
  }

  const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 3 : d) : '—');

  function killAll() {
    if (timer) { clearTimeout(timer); timer = null; }
    pending.forEach((id) => clearTimeout(id));
    pending = [];
    if (hasGS()) {
      try { gs().killTweensOf('*'); } catch (e) { /* noop */ }
      PROXIES.forEach((p) => { try { gs().killTweensOf(p); } catch (e) { /* noop */ } });
      fallProxies.forEach((p) => { try { gs().killTweensOf(p); } catch (e) { /* noop */ } });
      fallProxies = [];
      // 解说条永远保持完全可见
      if (el.narration) gs().set(el.narration, { opacity: 1, y: 0 });
    }
  }
  const later = (fn, ms) => { const id = setTimeout(fn, ms); pending.push(id); return id; };

  /* ───────────────── 视图变换（等比，斜率不失真） ───────────────── */
  function buildView() {
    const b = RM.bounds(curve, 0.11);
    const padL = 56, padR = 34, padT = 32, padB = 48;
    const aw = VB.w - padL - padR;
    const ah = VB.h - padT - padB;
    const s = Math.min(aw / (b.x1 - b.x0), ah / (b.y1 - b.y0));
    const ox = padL + (aw - s * (b.x1 - b.x0)) / 2;
    const oy = padT + (ah - s * (b.y1 - b.y0)) / 2;
    view = {
      s, b,
      X: (x) => ox + (x - b.x0) * s,
      Y: (y) => oy + (b.y1 - y) * s,
      iX: (px) => b.x0 + (px - ox) / s,
      iY: (py) => b.y1 - (py - oy) / s
    };
  }

  /* ───────────────── 坐标网格 ───────────────── */
  function renderGrid() {
    const g = el['g-grid'];
    clear(g);
    const { b } = view;
    const stepG = 0.5;
    for (let k = Math.ceil(b.x0 / stepG); k <= Math.floor(b.x1 / stepG); k++) {
      const v = k * stepG;
      g.appendChild(svgEl('line', { class: 'grid-line', x1: view.X(v), y1: view.Y(b.y0), x2: view.X(v), y2: view.Y(b.y1) }));
    }
    for (let k = Math.ceil(b.y0 / stepG); k <= Math.floor(b.y1 / stepG); k++) {
      const v = k * stepG;
      g.appendChild(svgEl('line', { class: 'grid-line', x1: view.X(b.x0), y1: view.Y(v), x2: view.X(b.x1), y2: view.Y(v) }));
    }
    const hasXAxis = b.y0 <= 0 && b.y1 >= 0;
    const hasYAxis = b.x0 <= 0 && b.x1 >= 0;
    let yZero = view.Y(clamp(0, b.y0, b.y1));
    let xZero = view.X(clamp(0, b.x0, b.x1));
    if (hasXAxis) {
      yZero = view.Y(0);
      g.appendChild(svgEl('line', { class: 'axis-line', x1: view.X(b.x0), y1: yZero, x2: view.X(b.x1), y2: yZero }));
      const t = svgEl('text', { class: 'ax-title', x: view.X(b.x1) - 4, y: yZero + 22, 'text-anchor': 'end' });
      t.textContent = 'x'; g.appendChild(t);
      for (let k = Math.ceil(b.x0); k <= Math.floor(b.x1); k++) {
        if (k === 0) continue;
        g.appendChild(svgEl('line', { class: 'axis-line', x1: view.X(k), y1: yZero - 5, x2: view.X(k), y2: yZero + 5 }));
        const lb = svgEl('text', { class: 'ax-label', x: view.X(k), y: yZero + 22, 'text-anchor': 'middle' });
        lb.textContent = String(k); g.appendChild(lb);
      }
    }
    if (hasYAxis) {
      xZero = view.X(0);
      g.appendChild(svgEl('line', { class: 'axis-line', x1: xZero, y1: view.Y(b.y0), x2: xZero, y2: view.Y(b.y1) }));
      const t = svgEl('text', { class: 'ax-title', x: xZero - 6, y: view.Y(b.y1) + 4, 'text-anchor': 'end' });
      t.textContent = 'y'; g.appendChild(t);
      for (let k = Math.ceil(b.y0); k <= Math.floor(b.y1); k++) {
        if (k === 0) continue;
        g.appendChild(svgEl('line', { class: 'axis-line', x1: xZero - 5, y1: view.Y(k), x2: xZero + 5, y2: view.Y(k) }));
        const lb = svgEl('text', { class: 'ax-label', x: xZero - 10, y: view.Y(k) + 4, 'text-anchor': 'end' });
        lb.textContent = String(k); g.appendChild(lb);
      }
    }
    if (hasXAxis && hasYAxis) {
      const o = svgEl('text', { class: 'ax-label', x: xZero - 10, y: yZero + 18, 'text-anchor': 'end' });
      o.textContent = 'O'; g.appendChild(o);
    }
  }

  /* ───────────────── 元素池 ───────────────── */
  const pool = { pieces: [], chords: [], ticks: [] };

  function buildPools() {
    const wg = el['g-wire-grad'];
    for (let i = 0; i < PIECES; i++) {
      const ln = svgEl('line', { class: 'wire-piece', stroke: RAMP[1] });
      wg.appendChild(ln); pool.pieces.push(ln);
    }
    pool.solid = svgEl('path', {
      fill: 'none', stroke: '#B7B1A8', 'stroke-width': 11,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    });
    el['g-wire-solid'].appendChild(pool.solid);

    const ch = el['g-chords'];
    for (let i = 0; i < MAXN; i++) {
      const ln = svgEl('line', { class: 'chord', stroke: RAMP[1], style: 'display:none' });
      ch.appendChild(ln); pool.chords.push(ln);
    }
    const tk = el['g-ticks'];
    for (let i = 0; i < MAXN + 1; i++) {
      const ln = svgEl('line', { class: 'tick-mark', style: 'display:none' });
      tk.appendChild(ln); pool.ticks.push(ln);
    }

    const sg = el['g-select'];
    pool.selHalo = svgEl('line', { stroke: '#FFFFFF', 'stroke-width': 22, 'stroke-linecap': 'round', opacity: 0.92 });
    pool.selMain = svgEl('line', { stroke: '#2563EB', 'stroke-width': 11, 'stroke-linecap': 'round' });
    pool.selCap0 = svgEl('circle', { r: 5, fill: '#FFFFFF', stroke: '#2563EB', 'stroke-width': 3 });
    pool.selCap1 = svgEl('circle', { r: 5, fill: '#FFFFFF', stroke: '#2563EB', 'stroke-width': 3 });
    pool.selLabel = svgEl('g');
    pool.selLabelRect = svgEl('rect', { rx: 7, height: 24, fill: '#FFFFFF', stroke: '#2563EB', 'stroke-width': 1.2 });
    pool.selLabelText = svgEl('text', { 'text-anchor': 'middle', class: 'ax-label', fill: '#1D4ED8' });
    pool.selLabel.appendChild(pool.selLabelRect);
    pool.selLabel.appendChild(pool.selLabelText);
    [pool.selHalo, pool.selMain, pool.selCap0, pool.selCap1, pool.selLabel].forEach((n) => sg.appendChild(n));

    const pr = el['g-probe'];
    pool.probeRing = svgEl('circle', { r: 15, fill: 'none', stroke: '#1C1917', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' });
    pool.probe = svgEl('circle', { r: 6, fill: '#1C1917', stroke: '#FFFFFF', 'stroke-width': 2.5 });
    pr.appendChild(pool.probeRing); pr.appendChild(pool.probe);
  }

  /* ───────────────── 主舞台渲染 ───────────────── */
  function renderWire() {
    let d = '';
    const N = 320;
    for (let i = 0; i <= N; i++) {
      const x = curve.a + ((curve.b - curve.a) * i) / N;
      d += (i === 0 ? 'M' : 'L') + view.X(x).toFixed(2) + ' ' + view.Y(curve.y(x)).toFixed(2) + ' ';
    }
    pool.solid.setAttribute('d', d);

    const h = (curve.b - curve.a) / PIECES;
    for (let i = 0; i < PIECES; i++) {
      const x0 = curve.a + i * h;
      const x1 = x0 + h;
      const xm = (x0 + x1) / 2;
      const ln = pool.pieces[i];
      ln.setAttribute('x1', view.X(x0).toFixed(2));
      ln.setAttribute('y1', view.Y(curve.y(x0)).toFixed(2));
      ln.setAttribute('x2', view.X(x1).toFixed(2));
      ln.setAttribute('y2', view.Y(curve.y(x1)).toFixed(2));
      ln.setAttribute('stroke', rhoColor(density.rho(xm, curve.y(xm)), rng));
    }
  }

  function renderChords() {
    const N = State.N;
    for (let i = 0; i < MAXN; i++) {
      const ln = pool.chords[i];
      if (i < N) {
        const s = segs[i];
        ln.setAttribute('x1', view.X(s.x0).toFixed(2));
        ln.setAttribute('y1', view.Y(s.y0).toFixed(2));
        ln.setAttribute('x2', view.X(s.x1).toFixed(2));
        ln.setAttribute('y2', view.Y(s.y1).toFixed(2));
        ln.setAttribute('stroke', rhoColor(s.rho, rng));
        ln.style.display = '';
      } else if (ln.style.display !== 'none') ln.style.display = 'none';
    }
    for (let i = 0; i < MAXN + 1; i++) {
      const ln = pool.ticks[i];
      if (i <= N) {
        const x = curve.a + ((curve.b - curve.a) * i) / N;
        const y = curve.y(x);
        const sl = curve.dy(x);
        let tx = 1, ty = -sl;
        const len = Math.hypot(tx, ty) || 1;
        tx /= len; ty /= len;
        const nx = -ty, ny = tx;
        const px = view.X(x), py = view.Y(y);
        const L = N > 48 ? 7 : 10;
        ln.setAttribute('x1', (px - nx * L).toFixed(2));
        ln.setAttribute('y1', (py - ny * L).toFixed(2));
        ln.setAttribute('x2', (px + nx * L).toFixed(2));
        ln.setAttribute('y2', (py + ny * L).toFixed(2));
        ln.setAttribute('opacity', N > 64 ? 0.55 : 0.9);
        ln.style.display = '';
      } else if (ln.style.display !== 'none') ln.style.display = 'none';
    }
  }

  const subDigits = '₀₁₂₃₄₅₆₇₈₉';
  const subIdx = (i) => String(i + 1).split('').map((c) => subDigits[+c]).join('');

  function renderSelect() {
    const s = segs[State.selected];
    if (!s) return;
    const x1 = view.X(s.x0), y1 = view.Y(s.y0);
    const x2 = view.X(s.x1), y2 = view.Y(s.y1);
    [pool.selHalo, pool.selMain].forEach((n) => {
      n.setAttribute('x1', x1.toFixed(2)); n.setAttribute('y1', y1.toFixed(2));
      n.setAttribute('x2', x2.toFixed(2)); n.setAttribute('y2', y2.toFixed(2));
    });
    pool.selCap0.setAttribute('cx', x1.toFixed(2)); pool.selCap0.setAttribute('cy', y1.toFixed(2));
    pool.selCap1.setAttribute('cx', x2.toFixed(2)); pool.selCap1.setAttribute('cy', y2.toFixed(2));

    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const txt = `Δs${subIdx(State.selected)}`;
    pool.selLabelText.textContent = txt;
    const w = Math.max(64, txt.length * 9 + 18);
    let nx = -(y2 - y1), ny = x2 - x1;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const lx = clamp(mx + nx * 36, w / 2 + 4, VB.w - w / 2 - 4);
    const ly = clamp(my + ny * 36, 24, VB.h - 16);
    pool.selLabel.setAttribute('transform', `translate(${lx.toFixed(1)} ${ly.toFixed(1)})`);
    pool.selLabelRect.setAttribute('x', (-w / 2).toFixed(1));
    pool.selLabelRect.setAttribute('y', -17);
    pool.selLabelRect.setAttribute('width', w.toFixed(1));
    pool.selLabelText.setAttribute('y', 1);
  }

  /* ───────────────── 计量牌 ───────────────── */
  function updateMeters() {
    el['meter-m-sub'].innerHTML = `精确 ∫<sub>L</sub> ρ ds = ${fmt(st.exactM, 4)} g`;
    el['meter-l-sub'].textContent = `精确 = ${fmt(st.exactL, 4)} cm`;
    const flat = density.id === 'uniform';
    const lo = flat ? 'ρ = 1' : `ρ ${fmt(rng.min, 2)}`;
    const hi = flat ? 'ρ = 1' : `ρ ${fmt(rng.max, 2)}`;
    el['legend-min'].textContent = lo;
    el['legend-max'].textContent = hi;
    el['len-chip'].textContent = State.step >= 3
      ? `N = ${State.N} · Σ Δs = ${fmt(st.L, 4)} cm`
      : `总长 L = ${fmt(st.exactL, 4)} cm`;
    el['scale-target'].textContent = `目标 M = ${fmt(st.M, 4)} g`;

    if (!hasGS()) {
      el['meter-m'].textContent = fmt(st.M);
      el['meter-l'].textContent = fmt(st.L);
      return;
    }
    gs().to(mDisp, {
      m: st.M, l: st.L, duration: 0.45 / State.speed, ease: 'power2.out', overwrite: 'auto',
      onUpdate() {
        el['meter-m'].textContent = fmt(mDisp.m);
        el['meter-l'].textContent = fmt(mDisp.l);
      }
    });
  }

  /* ───────────────── 显微台 ───────────────── */
  function computeMicroGeo() {
    const s = segs[State.selected];
    if (!s) { microGeo = null; return; }
    const dx = Math.max(Math.abs(s.dx), 1e-9);
    const dy = Math.max(Math.abs(s.dy), 1e-9);
    const k = Math.min(400 / dx, 300 / dy);
    const Lx = k * Math.abs(s.dx);
    const Ly = k * Math.abs(s.dy);
    const ascending = s.dy >= 0;
    // 水平居中放置，陡峭段窄而高、平缓段宽而扁，但斜率始终真实
    const A = { x: 60 + (440 - Lx) / 2, y: ascending ? 364 : 76 };
    const C = { x: A.x + Lx, y: A.y };
    const B = { x: C.x, y: ascending ? C.y - Ly : C.y + Ly };
    const u = { x: Math.sign(A.x - C.x) || -1, y: 0 };
    const v = { x: 0, y: Math.sign(B.y - C.y) || -1 };
    const q = 15;
    microGeo = { A, B, C, Lx, Ly, ascending, seg: s, u, v, q, angleOrigin: { x: C.x + u.x * q + v.x * q, y: C.y + u.y * q + v.y * q } };
  }

  /** 百分比定位（SVG viewBox 与容器等比） */
  function placeAt(node, x, y) {
    node.style.left = `${clamp((x / MB.w) * 100, 8, 92)}%`;
    node.style.top = `${clamp((y / MB.h) * 100, 6, 94)}%`;
  }

  function renderMicro() {
    computeMicroGeo();
    if (!microGeo) return;
    const { A, B, C, u, v, q, ascending } = microGeo;
    const s = microGeo.seg;
    const col = rhoColor(s.rho, rng);

    el['m-rod'].setAttribute('x1', A.x); el['m-rod'].setAttribute('y1', A.y);
    el['m-rod'].setAttribute('x2', B.x); el['m-rod'].setAttribute('y2', B.y);
    el['m-rod'].setAttribute('stroke', col);
    el['m-rod-halo'].setAttribute('x1', A.x); el['m-rod-halo'].setAttribute('y1', A.y);
    el['m-rod-halo'].setAttribute('x2', B.x); el['m-rod-halo'].setAttribute('y2', B.y);

    el['m-base'].setAttribute('x1', A.x); el['m-base'].setAttribute('y1', A.y);
    el['m-base'].setAttribute('x2', C.x); el['m-base'].setAttribute('y2', C.y);
    el['m-alt'].setAttribute('x1', C.x); el['m-alt'].setAttribute('y1', C.y);
    el['m-alt'].setAttribute('x2', B.x); el['m-alt'].setAttribute('y2', B.y);

    el['m-angle'].setAttribute('d',
      `M ${(C.x + u.x * q).toFixed(1)} ${(C.y + u.y * q).toFixed(1)} ` +
      `L ${(C.x + u.x * q + v.x * q).toFixed(1)} ${(C.y + u.y * q + v.y * q).toFixed(1)} ` +
      `L ${(C.x + v.x * q).toFixed(1)} ${(C.y + v.y * q).toFixed(1)}`);

    /* — 标签定位 — */
    // Δs：沿斜边法向、背离直角顶点一侧
    const midAB = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    let nx = -(B.y - A.y), ny = B.x - A.x;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    if ((C.x - midAB.x) * nx + (C.y - midAB.y) * ny > 0) { nx = -nx; ny = -ny; }
    placeAt(el['lab-s'], midAB.x + nx * 32, midAB.y + ny * 32);

    // Δx：底边中点，落在三角形外侧
    placeAt(el['lab-x'], (A.x + C.x) / 2, C.y + (ascending ? 26 : -26));

    // Δy：竖直边中点右侧
    placeAt(el['lab-y'], C.x + 36, (C.y + B.y) / 2);

    // 斜率代换标注：贴在 B 点外侧
    placeAt(el['lab-slope'], B.x + 6, B.y + (ascending ? -30 : 30));

    el['lab-s'].textContent = `Δs = ${fmt(s.ds, 4)}`;
    el['lab-x'].textContent = `Δx = ${fmt(s.dx, 4)}`;
    el['lab-y'].textContent = `Δy = ${fmt(s.dy, 4)}`;
    el['lab-slope'].textContent = `Δy ≈ y′·Δx = ${fmt(s.slope * s.dx, 4)}`;
    el['micro-chip'].textContent = State.step < 4
      ? '等待微元'
      : `第 ${State.selected + 1} 段 · Δs${subIdx(State.selected)}`;

    const mvRho = document.getElementById('mv-rho');
    if (mvRho) mvRho.textContent = fmt(s.rho, 3);
    const mvPyth = document.getElementById('mv-pyth');
    if (mvPyth) mvPyth.textContent = `Δs = √(${fmt(s.dx, 4)}² + ${fmt(s.dy, 4)}²) = ${fmt(s.ds, 4)} cm`;
  }

  /* ───────────────── 光束投影 ───────────────── */
  function updateBeam() {
    const show = State.step >= 4 && !!microGeo;
    if (!show) {
      el['beam-layer'].style.opacity = '0';
      el['beam-dot'].setAttribute('opacity', '0');
      return;
    }
    const wrap = el['dual-stage'].getBoundingClientRect();
    const ls = el['left-svg'].getBoundingClientRect();
    const ms = el['micro-svg'].getBoundingClientRect();
    if (!wrap.width || !ls.width || !ms.width) return;
    const s = segs[State.selected];
    const x1 = (ls.left - wrap.left) + (view.X(s.xm) / VB.w) * ls.width;
    const y1 = (ls.top - wrap.top) + (view.Y(s.ym) / VB.h) * ls.height;
    const mx = (microGeo.A.x + microGeo.B.x) / 2;
    const my = (microGeo.A.y + microGeo.B.y) / 2;
    const x2 = (ms.left - wrap.left) + (mx / MB.w) * ms.width;
    const y2 = (ms.top - wrap.top) + (my / MB.h) * ms.height;
    const cx = x1 + (x2 - x1) * 0.55;
    const cy = (y1 + y2) / 2 - 58;
    const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    el['beam-path'].setAttribute('d', d);
    el['beam-glow'].setAttribute('d', d);
    el['beam-layer'].style.opacity = '1';
    el['beam-dot'].setAttribute('opacity', '1');
  }

  function animateBeam() {
    if (!hasGS() || State.step < 4) return;
    updateBeam();
    if (el['beam-layer'].style.opacity !== '1') return;
    gs().fromTo(el['beam-layer'], { opacity: 0 }, { opacity: 1, duration: 0.4 / State.speed, ease: 'power2.out' });
    gs().fromTo(el['beam-path'], { strokeDashoffset: 0 }, { strokeDashoffset: -36, duration: 1.1, repeat: -1, ease: 'none' });
    const path = el['beam-path'];
    let len = 0;
    try { len = path.getTotalLength(); } catch (e) { return; }
    if (!len) return;
    beamProxy.t = 0;
    gs().to(beamProxy, {
      t: 1, duration: 1.5 / State.speed, repeat: -1, repeatDelay: 0.3, ease: 'power1.inOut',
      onUpdate() {
        try {
          const p = path.getPointAtLength(beamProxy.t * len);
          el['beam-dot'].setAttribute('cx', p.x.toFixed(1));
          el['beam-dot'].setAttribute('cy', p.y.toFixed(1));
        } catch (e) { /* noop */ }
      }
    });
  }

  /* ───────────────── 质量天平汇流槽 ───────────────── */
  function buildBars(mode) {
    const wrapW = el.basin.clientWidth;
    const wrapH = el.basin.clientHeight;
    clear(el.bars); clear(el.fallers);
    const N = State.N;
    const maxDm = Math.max(st.maxDm, 1e-9);
    const gap = N > 64 ? 0.6 : N > 32 ? 1.4 : 3;
    const bw = wrapW / N;
    const frag = document.createDocumentFragment();
    const bars = [];
    for (let i = 0; i < N; i++) {
      const h = Math.max(3, (segs[i].dm / maxDm) * (wrapH - 26));
      const b = document.createElement('div');
      b.className = 'mass-bar';
      b.style.left = (i * bw + gap / 2) + 'px';
      b.style.width = Math.max(1.5, bw - gap) + 'px';
      b.style.height = h + 'px';
      b.style.background = rhoColor(segs[i].rho, rng);
      frag.appendChild(b);
      bars.push(b);
    }
    el.bars.appendChild(frag);
    if (mode === 'instant') {
      bars.forEach((b) => { b.style.opacity = '1'; b.style.transform = 'scaleY(1)'; });
    } else {
      bars.forEach((b) => { b.style.opacity = '0'; b.style.transform = 'scaleY(0)'; });
    }
    el.bars.style.opacity = '1';
    return { bars, wrapW, wrapH, bw, maxDm };
  }

  function clearBars(animated) {
    State.filled = false;
    el['basin-empty'].style.display = '';
    accDisp.v = 0;
    el['scale-value'].textContent = '0.000';
    el['scale-fill'].style.width = '0%';
    if (!el.bars.childNodes.length) { clear(el.fallers); return; }
    if (animated && hasGS()) {
      gs().to([el.bars, el.fallers], {
        opacity: 0, duration: 0.24 / State.speed, overwrite: 'auto', onComplete() {
          clear(el.bars); clear(el.fallers);
          gs().set([el.bars, el.fallers], { opacity: 1 });
        }
      });
    } else {
      clear(el.bars); clear(el.fallers);
      el.bars.style.opacity = '1'; el.fallers.style.opacity = '1';
    }
  }

  function fillInstant() {
    el['basin-empty'].style.display = 'none';
    buildBars('instant');
    State.filled = true;
    accDisp.v = st.M;
    el['scale-value'].textContent = fmt(st.M);
    el['scale-fill'].style.width = '100%';
    showFormula(true);
  }

  function startMassFlow() {
    if (!hasGS()) { fillInstant(); return; }
    fallProxies.forEach((p) => { try { gs().killTweensOf(p); } catch (e) { /* noop */ } });
    fallProxies = [];
    el['basin-empty'].style.display = 'none';
    const built = buildBars('empty');
    const { bars, wrapW, wrapH, bw } = built;
    const N = State.N;
    const speed = State.speed;
    const fall = 0.62 / speed;
    const span = (2.4 + Math.min(N, 64) * 0.014) / speed;
    const stagger = N > 1 ? Math.max(0.012, (span - fall) / (N - 1)) : 0;
    const maxDm = Math.max(st.maxDm, 1e-9);

    for (let i = 0; i < N; i++) {
      const h = Math.max(3, (segs[i].dm / maxDm) * (wrapH - 26));
      const slotX = i * bw + bw / 2;
      const f = document.createElement('div');
      f.className = 'faller';
      f.style.background = rhoColor(segs[i].rho, rng);
      f.style.left = (slotX - 6.5) + 'px';
      f.style.top = '0px';
      el.fallers.appendChild(f);

      const xoff = -(44 + ((i * 37) % 64));
      const yStart = -18;
      const yEnd = wrapH - h - 16;
      const p = fallProxies.push({ t: 0 }) - 1;
      const proxy = fallProxies[p];
      gs().to(proxy, {
        t: 1, duration: fall, delay: i * stagger, ease: 'power1.out',
        onUpdate() {
          const t = proxy.t;
          f.style.transform = `translate(${(xoff * (1 - t)).toFixed(1)}px, ${(yStart + (yEnd - yStart) * t * t).toFixed(1)}px)`;
        },
        onComplete() {
          f.remove();
          const bar = bars[i];
          if (bar) {
            bar.style.opacity = '1';
            gs().fromTo(bar, { scaleY: 0 }, { scaleY: 1, duration: 0.34 / speed, ease: 'back.out(2.2)' });
          }
        }
      });
    }

    accDisp.v = 0;
    gs().to(accDisp, {
      v: st.M, duration: span + fall * 0.6, ease: 'power1.inOut',
      onUpdate() {
        el['scale-value'].textContent = fmt(accDisp.v);
        el['scale-fill'].style.width = `${clamp((accDisp.v / Math.max(st.M, 1e-9)) * 100, 0, 100)}%`;
      },
      onComplete() {
        el['scale-value'].textContent = fmt(st.M);
        el['scale-fill'].style.width = '100%';
        State.filled = true;
      }
    });

    later(() => { showFormula(false); }, (span + fall) * 1000);
  }

  function showFormula(instant) {
    const box = el['formula-reveal'];
    if (box.hidden) box.hidden = false;
    if (!hasGS()) { box.style.opacity = '1'; return; }
    if (instant) { gs().set(box, { opacity: 1, y: 0 }); return; }
    gs().killTweensOf(box);
    gs().fromTo(box, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 / State.speed, ease: 'power3.out' });
    gs().fromTo(box.querySelectorAll('.formula-line'),
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.5 / State.speed, stagger: 0.24 / State.speed, ease: 'power2.out', delay: 0.16 / State.speed });
  }

  /* ───────────────── 节拍状态机 ───────────────── */
  function syncCapsules() {
    const stage = STEPS[State.step].stage;
    el.capsules.forEach((c) => {
      const on = +c.dataset.stage === stage;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function renderNarration() {
    const s = STEPS[State.step];
    el['narration-tag'].textContent = s.tag;
    el['narration-title'].textContent = s.title;
    el['narration-text'].textContent = s.text;
    el['narration-index'].textContent = `${State.step + 1} / ${STEPS.length}`;
    if (hasGS()) {
      gs().killTweensOf(el.narration);
      gs().fromTo(el.narration, { opacity: 0.3, y: -4 }, { opacity: 1, y: 0, duration: 0.34, ease: 'power2.out' });
    }
  }

  function setMicroMode(mode) {
    const showShape = mode !== 'empty';
    const legs = mode === 'tri' || mode === 'slope';
    if (hasGS()) {
      gs().set(el['m-empty'], { opacity: mode === 'empty' ? 1 : 0 });
      gs().set(el['m-shape'], { opacity: showShape ? 1 : 0, scale: 1 });
      gs().set([el['m-base'], el['m-alt'], el['m-angle']], { opacity: legs ? 1 : 0 });
    } else {
      el['m-empty'].style.opacity = mode === 'empty' ? '1' : '0';
      el['m-shape'].style.opacity = showShape ? '1' : '0';
      [el['m-base'], el['m-alt'], el['m-angle']].forEach((n) => { n.style.opacity = legs ? '1' : '0'; });
    }
    el['lab-s'].hidden = mode === 'empty';
    el['lab-x'].hidden = !legs;
    el['lab-y'].hidden = !legs;
    el['lab-slope'].hidden = mode !== 'slope';
    [['lab-s', mode !== 'empty'], ['lab-x', legs], ['lab-y', legs], ['lab-slope', mode === 'slope']]
      .forEach(([k, on]) => { el[k].style.opacity = on ? '1' : '0'; });
    if (mode === 'empty') el['micro-chip'].textContent = '等待微元';
  }

  /** 跳转/参数变化后的落位状态 */
  function applyStepVisuals() {
    const step = State.step;
    const set = (node, on) => { if (node) node.style.opacity = on ? '1' : '0'; };

    set(el['g-wire-grad'], step >= 1);
    set(el['g-wire-solid'], step === 0);
    set(el['g-ticks'], step >= 3);
    set(el['g-chords'], step >= 3);
    set(el['g-select'], step >= 4);
    set(el['g-probe'], false);

    el['len-chip'].hidden = false;
    el['len-chip'].style.opacity = '1';
    const hintOn = step === 1 || step === 3 || step === 4;
    el['hint-chip'].hidden = !hintOn;
    el['hint-chip'].style.opacity = '1';
    if (step === 1) el['hint-chip'].textContent = '移动鼠标当探针，读取局部密度 ρ';
    if (step === 3) el['hint-chip'].textContent = '拖动 N 滑块：4 → 32 → 128 段';
    if (step === 4) el['hint-chip'].textContent = '点击细丝可换选任意微元';

    el['fallacy-card'].hidden = step !== 2;
    el['fallacy-card'].style.opacity = step === 2 ? '1' : '0';
    el['probe-tip'].hidden = true;
    el['btn-swap'].disabled = step < 4;

    const mode = step >= 6 ? 'slope' : step === 5 ? 'tri' : step === 4 ? 'rod' : 'empty';

    const tipHTML = TIPS[step];
    const mathHTML = MATHS[step];
    el['micro-tip'].hidden = !tipHTML;
    el['micro-math'].hidden = !mathHTML;
    el['micro-tip'].style.opacity = tipHTML ? '1' : '0';
    el['micro-math'].style.opacity = mathHTML ? '1' : '0';
    if (tipHTML) setHTML(el['micro-tip'], tipHTML);
    if (mathHTML) setHTML(el['micro-math'], mathHTML);

    renderMicro();
    setMicroMode(mode);

    if (step < 7) {
      if (State.filled || el.bars.childNodes.length) clearBars(true);
      el['formula-reveal'].hidden = true;
      if (hasGS()) gs().set(el['formula-reveal'], { opacity: 0 });
      else el['formula-reveal'].style.opacity = '0';
    } else if (State.filled) {
      fillInstant();
    } else {
      el['formula-reveal'].hidden = true;
      if (hasGS()) gs().set(el['formula-reveal'], { opacity: 0 });
      else el['formula-reveal'].style.opacity = '0';
    }

    if (step < 4) {
      el['beam-layer'].style.opacity = '0';
      el['beam-dot'].setAttribute('opacity', '0');
    }
  }

  function tweenN(target, dur) {
    if (hasGS()) gs().killTweensOf(nProxy);
    nProxy.n = State.N;
    gs().to(nProxy, {
      n: target, duration: dur / State.speed, ease: 'power1.inOut',
      onUpdate() { setN(Math.max(4, Math.round(nProxy.n)), false); }
    });
  }

  /** 首次进入阶段三时若切分仍然粗糙，自动加密到足以支撑微元论证的段数 */
  function ensureRefined() {
    if (State.stage3Bumped || State.N >= 16) { State.stage3Bumped = true; return; }
    State.stage3Bumped = true;
    if (hasGS()) tweenN(32, 1.6);
    else setN(32);
  }

  /** 进入节拍的入场动画 */
  function playStepIntro() {
    if (!hasGS()) return;
    const step = State.step;
    const sp = State.speed;
    if (step >= 5) ensureRefined();

    if (step === 0) {
      let len = 0;
      try { len = pool.solid.getTotalLength(); } catch (e) { len = 0; }
      if (len) {
        gs().set(pool.solid, { strokeDasharray: len, strokeDashoffset: len });
        gs().to(pool.solid, { strokeDashoffset: 0, duration: 1.3 / sp, ease: 'power2.inOut' });
      }
      gs().fromTo(el['g-grid'], { opacity: 0 }, { opacity: 1, duration: 0.7 / sp });
      gs().fromTo(el['len-chip'], { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.5 / sp, delay: 0.9 / sp });
    }

    if (step === 1) {
      gs().set(el['g-wire-grad'], { opacity: 1 });
      gs().fromTo(pool.pieces, { opacity: 0 }, { opacity: 1, duration: 0.3 / sp, stagger: (0.95 / sp) / PIECES, ease: 'power1.out' });
      gs().set(el['g-wire-solid'], { opacity: 1 });
      gs().to(el['g-wire-solid'], { opacity: 0, duration: 0.8 / sp, delay: 0.55 / sp });
      gs().fromTo(el['hint-chip'], { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45 / sp, delay: 0.6 / sp });
      gs().fromTo(el['legend-bar'], { boxShadow: '0 0 0 0 rgba(217,119,6,0)' },
        { boxShadow: '0 0 0 5px rgba(217,119,6,.18)', duration: 0.7 / sp, yoyo: true, repeat: 1 });
    }

    if (step === 2) {
      gs().fromTo(el['fallacy-card'], { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.55 / sp, ease: 'back.out(1.5)' });
      gs().fromTo(pool.pieces, { filter: 'saturate(1)' }, { filter: 'saturate(1.4)', duration: 1.1 / sp, yoyo: true, repeat: 1 });
    }

    if (step === 3) {
      gs().fromTo(el['g-chords'], { opacity: 0 }, { opacity: 1, duration: 0.45 / sp });
      gs().fromTo(el['g-ticks'], { opacity: 0 }, { opacity: 1, duration: 0.45 / sp, delay: 0.1 / sp });
      gs().fromTo(el['hint-chip'], { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.4 / sp });
      if (!State.splitDemo) {
        State.splitDemo = true;
        State.N = 4; syncSlider(); recompute(false);
        renderWire(); renderChords(); renderSelect(); renderMicro(); updateMeters();
        nProxy.n = 4;
        gs().to(nProxy, {
          n: 32, duration: 2.6 / sp, ease: 'power1.inOut',
          onUpdate() { setN(Math.max(4, Math.round(nProxy.n)), false); }
        });
      }
    }

    if (step === 4) {
      pickRandom();
      renderSelect(); renderMicro();
      gs().fromTo(el['g-select'], { opacity: 0 }, { opacity: 1, duration: 0.4 / sp });
      gs().fromTo(pool.selMain, { attr: { 'stroke-width': 4 } }, { attr: { 'stroke-width': 11 }, duration: 0.5 / sp, ease: 'back.out(2)' });
      gs().fromTo(el['m-shape'], { opacity: 0, scale: 0.72, svgOrigin: '280 230' },
        { opacity: 1, scale: 1, duration: 0.55 / sp, ease: 'back.out(1.7)' });
      reveal(el['lab-s'], 0.34, false);
      reveal(el['micro-tip'], 0.16, true);
      reveal(el['hint-chip'], 0.1, true);
      later(() => animateBeam(), 260);
    }

    if (step === 5) {
      gs().fromTo(el['m-base'], { attr: { x2: microGeo.A.x, y2: microGeo.A.y } },
        { attr: { x2: microGeo.C.x, y2: microGeo.C.y }, duration: 0.62 / sp, ease: 'power2.out' });
      gs().fromTo(el['m-alt'], { attr: { x2: microGeo.C.x, y2: microGeo.C.y } },
        { attr: { x2: microGeo.B.x, y2: microGeo.B.y }, duration: 0.62 / sp, delay: 0.34 / sp, ease: 'power2.out' });
      gs().fromTo(el['m-angle'], { opacity: 0, scale: 0.2, svgOrigin: `${microGeo.angleOrigin.x} ${microGeo.angleOrigin.y}` },
        { opacity: 1, scale: 1, duration: 0.5 / sp, delay: 0.82 / sp, ease: 'back.out(2.6)' });
      reveal(el['lab-x'], 0.62, false);
      reveal(el['lab-y'], 0.74, false);
      reveal(el['micro-tip'], 0.5, true);
      reveal(el['micro-math'], 0.66, true);
    }

    if (step === 6) {
      gs().fromTo(el['m-alt'], { stroke: '#93C5FD' }, { stroke: '#2563EB', duration: 0.9 / sp });
      reveal(el['lab-slope'], 0.5, false);
      reveal(el['micro-tip'], 0.12, true);
      reveal(el['micro-math'], 0.3, true);
      gs().fromTo(el['micro-math'], { boxShadow: '0 0 0 0 rgba(37,99,235,0)' },
        { boxShadow: '0 0 0 5px rgba(37,99,235,.14)', duration: 0.8 / sp, yoyo: true, repeat: 1, delay: 0.4 / sp });
    }

    if (step === 7) {
      reveal(el['micro-tip'], 0.1, true);
      reveal(el['micro-math'], 0.26, true);
      startMassFlow();
    }
  }

  function reveal(node, delay, useY) {
    if (!node || node.hidden || !hasGS()) return;
    const from = { opacity: 0 };
    const to = { opacity: 1, duration: 0.45 / State.speed, delay: (delay || 0) / State.speed, ease: 'power2.out' };
    if (useY !== false) { from.y = 10; to.y = 0; }
    gs().fromTo(node, from, to);
  }

  function schedule() {
    if (!State.auto) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!State.auto) return;
      if (State.step >= STEPS.length - 1) { setAuto(false); return; }
      goStep(State.step + 1);
    }, STEPS[State.step].dur / State.speed);
  }

  function goStep(i) {
    killAll();
    State.step = clamp(i, 0, STEPS.length - 1);
    if (State.step < 3) { State.splitDemo = false; State.stage3Bumped = false; }
    syncCapsules();
    applyStepVisuals();
    renderNarration();
    updateMeters();
    playStepIntro();
    later(() => updateBeam(), 60);
    schedule();
  }

  /* ───────────────── 数据重算 ───────────────── */
  function recompute(withView) {
    curve = RM.CURVES[State.curve];
    density = RM.DENSITIES[State.density];
    st = RM.stats(curve, density, State.N);
    segs = st.segs;
    rng = RM.densityRange(curve, density);
    if (density.id === 'uniform') rng = { min: 1, max: 1 };
    if (withView) buildView();
    State.selected = clamp(Math.round(State.selFrac * (State.N - 1)), 0, State.N - 1);
  }

  function renderGeometry() {
    renderGrid();
    renderWire();
    renderChords();
    renderSelect();
    renderMicro();
    updateMeters();
    updateBeam();
  }

  function setN(n) {
    State.N = clamp(Math.round(n), 4, MAXN);
    syncSlider();
    recompute(false);
    renderWire(); renderChords(); renderSelect(); renderMicro(); updateMeters();
    if (State.step >= 7 && State.filled) fillInstant();
    if (State.step >= 4) updateBeam();
  }

  function syncSlider() {
    el['n-slider'].value = String(State.N);
    el['n-out'].textContent = String(State.N);
    el['n-slider'].style.setProperty('--fill', ((State.N - 4) / (MAXN - 4)) * 100 + '%');
  }

  /* ───────────────── 交互 ───────────────── */
  function pickRandom() {
    State.selFrac = Math.random();
    State.selected = clamp(Math.round(State.selFrac * (State.N - 1)), 0, State.N - 1);
  }

  function selectSegment(i, pulse) {
    State.selected = clamp(i, 0, State.N - 1);
    State.selFrac = State.N > 1 ? State.selected / (State.N - 1) : 0;
    renderSelect();
    renderMicro();
    updateBeam();
    if (pulse && hasGS()) {
      gs().fromTo(el['g-select'], { opacity: 0.35 }, { opacity: 1, duration: 0.4, ease: 'power2.out' });
      animateBeam();
    }
  }

  function pointerLocal(evt, svg, vw, vh) {
    const r = svg.getBoundingClientRect();
    return { x: ((evt.clientX - r.left) / r.width) * vw, y: ((evt.clientY - r.top) / r.height) * vh };
  }

  function onProbeMove(e) {
    if (State.step < 1) return;
    const p = pointerLocal(e, el['left-svg'], VB.w, VB.h);
    const near = RM.nearest(curve, view.iX(p.x), view.iY(p.y), 500);
    const sx = view.X(near.point.x), sy = view.Y(near.point.y);
    if (Math.hypot(sx - p.x, sy - p.y) > 34) {
      el['probe-tip'].hidden = true;
      el['g-probe'].style.opacity = '0';
      return;
    }
    const rho = density.rho(near.point.x, near.point.y);
    el['g-probe'].style.opacity = '1';
    pool.probe.setAttribute('cx', sx); pool.probe.setAttribute('cy', sy);
    pool.probeRing.setAttribute('cx', sx); pool.probeRing.setAttribute('cy', sy);
    pool.probe.setAttribute('fill', rhoColor(rho, rng));

    el['probe-tip'].hidden = false;
    el['probe-tip'].innerHTML =
      `当前坐标 (<b>${fmt(near.point.x, 2)}</b>, <b>${fmt(near.point.y, 2)}</b>)<br>` +
      `线密度 ρ = <b>${fmt(rho, 2)}</b> g/cm`;
    const wr = el['left-wrap'].getBoundingClientRect();
    const tw = el['probe-tip'].offsetWidth || 150;
    const th = el['probe-tip'].offsetHeight || 48;
    let lx = e.clientX - wr.left + 16;
    let ly = e.clientY - wr.top + 16;
    if (lx + tw > wr.width - 8) lx = e.clientX - wr.left - tw - 16;
    if (ly + th > wr.height - 8) ly = e.clientY - wr.top - th - 16;
    el['probe-tip'].style.left = Math.max(6, lx) + 'px';
    el['probe-tip'].style.top = Math.max(6, ly) + 'px';
  }

  function setAuto(on) {
    State.auto = on;
    el['btn-auto'].classList.toggle('is-playing', on);
    el['btn-auto'].textContent = on ? '⏸ 暂停演示' : '▶ 自动演示';
    if (timer) { clearTimeout(timer); timer = null; }
    if (on) schedule();
  }

  function applyParams() {
    killAll();
    recompute(true);
    renderGeometry();
    applyStepVisuals();
    schedule();
  }

  function resetAll() {
    killAll();
    setAuto(false);
    State.step = 0;
    State.N = 4;
    State.curve = 'parabola';
    State.density = 'gradient';
    State.selFrac = 0.5;
    State.splitDemo = false;
    State.stage3Bumped = false;
    State.filled = false;
    el.curveBtns.forEach((x) => x.classList.toggle('is-active', x.dataset.curve === 'parabola'));
    el.rhoBtns.forEach((x) => x.classList.toggle('is-active', x.dataset.density === 'gradient'));
    syncSlider();
    recompute(true);
    clearBars(false);
    el['formula-reveal'].hidden = true;
    if (hasGS()) gs().set(el['formula-reveal'], { opacity: 0 });
    renderGeometry();
    goStep(0);
  }

  function bindEvents() {
    el['btn-auto'].addEventListener('click', () => setAuto(!State.auto));
    el['btn-next'].addEventListener('click', () => {
      setAuto(false);
      goStep(State.step >= STEPS.length - 1 ? 0 : State.step + 1);
    });
    el['btn-reset'].addEventListener('click', resetAll);

    el['speed-set'].addEventListener('click', (e) => {
      const b = e.target.closest('.speed-btn');
      if (!b) return;
      State.speed = parseFloat(b.dataset.speed);
      el['speed-set'].querySelectorAll('.speed-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      if (State.auto) schedule();   // 用新速度重排节拍
    });

    el.capsules.forEach((c) => c.addEventListener('click', () => {
      const stage = +c.dataset.stage;
      const first = STEPS.findIndex((s) => s.stage === stage);
      setAuto(false);
      goStep(first < 0 ? 0 : first);
    }));

    el['n-slider'].addEventListener('input', (e) => {
      if (hasGS()) gs().killTweensOf(nProxy);
      setN(+e.target.value);
    });

    el.curveBtns.forEach((b) => b.addEventListener('click', () => {
      if (State.curve === b.dataset.curve) return;
      State.curve = b.dataset.curve;
      el.curveBtns.forEach((x) => x.classList.toggle('is-active', x === b));
      applyParams();
      if (hasGS()) gs().fromTo(el['left-svg'], { opacity: 0.55 }, { opacity: 1, duration: 0.45 });
    }));

    el.rhoBtns.forEach((b) => b.addEventListener('click', () => {
      if (State.density === b.dataset.density) return;
      State.density = b.dataset.density;
      el.rhoBtns.forEach((x) => x.classList.toggle('is-active', x === b));
      applyParams();
      if (hasGS()) gs().fromTo(pool.pieces, { opacity: 0.3 }, { opacity: 1, duration: 0.4, stagger: 0.0016 });
    }));

    el['btn-swap'].addEventListener('click', () => {
      if (State.step < 4) return;
      pickRandom();
      selectSegment(State.selected, true);
    });

    const hit = el['hit-area'];
    hit.addEventListener('pointermove', onProbeMove);
    hit.addEventListener('pointerleave', () => {
      el['probe-tip'].hidden = true;
      el['g-probe'].style.opacity = '0';
    });
    hit.addEventListener('click', (e) => {
      if (State.step < 3) return;
      const p = pointerLocal(e, el['left-svg'], VB.w, VB.h);
      const wx = view.iX(p.x), wy = view.iY(p.y);
      let best = 0, bd = Infinity;
      for (let i = 0; i < segs.length; i++) {
        const d = (segs[i].xm - wx) * (segs[i].xm - wx) + (segs[i].ym - wy) * (segs[i].ym - wy);
        if (d < bd) { bd = d; best = i; }
      }
      selectSegment(best, State.step >= 4);
    });

    window.addEventListener('resize', updateBeam);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && State.auto) setAuto(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { setAuto(false); goStep(Math.min(State.step + 1, STEPS.length - 1)); }
      if (e.key === 'ArrowLeft') { setAuto(false); goStep(Math.max(State.step - 1, 0)); }
      if (e.key === ' ') { e.preventDefault(); setAuto(!State.auto); }
    });
  }

  /* ───────────────── 公式 ───────────────── */
  function renderFormulas() {
    renderTex(el['formula-1'],
      'M = \\lim_{\\lambda \\to 0} \\sum_{i=1}^{n} \\rho(\\xi_i, \\eta_i)\\,\\Delta s_i = \\int_L \\rho(x, y)\\,\\mathrm{d}s', true);
    renderTex(el['formula-2'],
      '= \\int_a^b \\rho\\big(x,\\, y(x)\\big)\\,\\sqrt{1 + [y\'(x)]^{2}}\\;\\mathrm{d}x', true);
  }

  /* ───────────────── 启动 ───────────────── */
  function init() {
    if (!RM) return;
    cacheDom();
    buildPools();
    recompute(true);
    syncSlider();
    renderFormulas();
    renderGeometry();
    bindEvents();
    goStep(0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
