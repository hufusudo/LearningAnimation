/* 格林公式的几何直观 —— 双栏联动演示
   左：空间几何域（向量场 / 曲线 / 网格）
   右上：单个微元特写   右下：代数等式展开器
   底：∮ 与 ∬ 累计指示器、拓扑与抵消率监视器 */
(function () {
  'use strict';

  const M = window.GreenModel;
  if (!M) return;

  /* ================= 常量 ================= */
  const C = {
    cyan: '#00F5FF', orange: '#FFB800', magenta: '#FF2A85',
    red: '#FF1744', gold: '#FFD700', muted: '#7f93ad'
  };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const BLOB = M.blob();
  const ARC = M.parabolaArc();
  const AXIS = M.AXIS_SEGMENT;
  const CLOSED2 = ARC.concat(AXIS.slice(1));
  const MICRO_EDGES = M.microEdges();
  const CELL = M.MICRO;
  const CONTOUR = M.buildCutContour(BLOB, 0.34, 0.62);

  const LINE1 = M.polylineIntegral(BLOB, M.SMOOTH, true);      /* ≈ 4.9817 */
  const AREA1 = M.polygonDoubleIntegral(BLOB, (x, y) => M.SMOOTH.curl(x, y));
  const LOOP2 = M.polylineIntegral(CLOSED2, M.SMOOTH, true);   /* ≈ 6.9333 */
  const AXISS = M.polylineIntegral(AXIS, M.SMOOTH, false);     /* = 5.3333 */
  const ARCV = M.polylineIntegral(ARC, M.SMOOTH, false);       /* ≈ 1.6000 */
  const CIRC = 2 * Math.PI;

  const DOMAINS = {
    1: { x0: -2.4, x1: 2.4, y0: -1.8, y1: 1.8 },
    2: { x0: -2.9, x1: 2.9, y0: -1.2, y1: 1.85 },
    3: { x0: -2.4, x1: 2.4, y0: -1.8, y1: 1.8 }
  };

  /* ================= 步骤表 ================= */
  const STEPS = [
    {
      phase: 1, label: '1.1', short: '路径', dur: 9, micro: 'idle',
      tag: '阶段 1 · 微元大抵消',
      note: '光标沿逆时针闭合曲线 L 前进：线积分就是把每小段做功 P dx + Q dy 累加起来。',
      caption: '整条 L 上的做功累加', hint: '先看宏观的一圈',
      rows: [
        [0.10, '<span class="tag">线积分</span>∮<sub>L</sub> P dx + Q dy ：沿 L 逐小段累加 <span class="pos">P dx + Q dy</span>'],
        [0.45, '<span class="tag">取向</span>L 取 <span class="pos">逆时针</span>正向 —— 行进时区域始终在左侧'],
        [0.75, '<span class="tag">问题</span>曲线越复杂越难算，能不能改问「区域内部」的事？']
      ]
    },
    {
      phase: 1, label: '1.2', short: '裂变', dur: 3.4, micro: 'grid',
      tag: '阶段 1 · 微元大抵消',
      note: '区域内部瞬间裂变为 N×N 个矩形微元，每个微元都绕自己的小圈。',
      caption: 'N×N 网格中取出一格', hint: '化整为零',
      rows: [
        [0.05, '<span class="tag">分割</span>D → N×N 个矩形微元，每个微元各自绕行一圈'],
        [0.5, '<span class="tag">待解</span>Σ (微元环流) = ? —— 若内部边互相抵消，只剩最外一圈']
      ]
    },
    {
      phase: 1, label: '1.3', short: '微元', dur: 10, micro: 'cell',
      tag: '阶段 1 · 微元大抵消',
      note: '镜头拉入单个方格：四条边各自做功，两次差分相减就得到旋度。',
      caption: '四边环流与差分推导', hint: '正负项正在配对',
      rows: [
        [0.10, '<span class="tag">下底</span><span class="pos">+ ∫ P(x, y) dx</span> ＝ <span class="num">+0.0667</span>　沿 +x 走'],
        [0.27, '<span class="tag">上顶</span><span class="neg">− ∫ P(x, y+dy) dx</span> ＝ <span class="num">−0.0267</span>　同长反向'],
        [0.43, '<span class="tag">右壁</span><span class="pos">+ ∫ Q(x+dx, y) dy</span> ＝ <span class="num">+0.3200</span>　沿 +y 走'],
        [0.58, '<span class="tag">左壁</span><span class="neg">− ∫ Q(x, y) dy</span> ＝ <span class="num">−0.2400</span>　同长反向'],
        [0.74, '<span class="tag">差分</span><span class="neg">−[P(x,y+dy) − P(x,y)]dx</span> + <span class="pos">[Q(x+dx,y) − Q(x,y)]dy</span>'],
        [0.88, '<span class="tag">取极限</span>= <span class="hot">(∂Q/∂x − ∂P/∂y) dx dy</span> = ( <span class="pos">2.000</span> − <span class="neg">(−1.000)</span> ) × 0.04 = <span class="num">0.1200</span>']
      ]
    },
    {
      phase: 1, label: '1.4', short: '抵消', dur: 9, micro: 'cancel',
      tag: '阶段 1 · 微元大抵消',
      note: '相邻方格的公共边反向流动、成对抵消；唯一没被抵消的外层边界就是 L。',
      caption: '公共边相消，外层留存', hint: '内部边成对消失',
      rows: [
        [0.05, '<span class="tag">公共边</span>同一条边被两格各走一次，方向<span class="neg">相反</span>、做功<span class="neg">等值反号</span>'],
        [0.34, '<span class="tag">抵消</span>Σ 微元环流 = Σ <span class="hot">未被抵消的外层边</span> = ∮<sub>L</sub>'],
        [0.62, '<span class="tag">结论</span>∮<sub>L</sub> P dx + Q dy = <span class="hot">∬<sub>D</sub> (∂Q/∂x − ∂P/∂y) dx dy</span>'],
        [0.85, '<span class="tag">校验</span>线积分 <span class="num">' + LINE1.toFixed(4) + '</span> = 面积分 <span class="num">' + AREA1.toFixed(4) + '</span><span class="eq-note">网格求和随 N 增大收敛到同一数值</span>']
      ]
    },
    {
      phase: 2, label: '2.1', short: '开口', dur: 6, micro: 'patchOpen',
      tag: '阶段 2 · 补线法',
      note: '非闭合抛物线弧 L₁：起点 A、终点 B，区域封不住，颜色从缺口漏走。',
      caption: 'L₁ 从 A 到 B，未闭合', hint: '缺口 → 没有内部',
      rows: [
        [0.08, '<span class="tag">困局</span>L₁ 只有起点 A 与终点 B，边界不封闭'],
        [0.4, '<span class="tag">后果</span>区域 D 无法定义 ⇒ <span class="bad">∬<sub>D</sub> 不存在</span>'],
        [0.7, '<span class="eq-note">着色像流体一样从缺口漏出：没有闭合边界，就没有「内部」可积分。</span>']
      ]
    },
    {
      phase: 2, label: '2.2', short: '补线', dur: 6, micro: 'patch',
      tag: '阶段 2 · 补线法',
      note: '人为补一条从 B 直达 A 的直线段 L₂（品红虚线），完成逆时针正向围合。',
      caption: '补线 L₂：B → A', hint: '人为闭合边界',
      rows: [
        [0.08, '<span class="tag">补线</span>加入 <span class="cut">L₂ : B → A</span>（坐标轴上的直线段）'],
        [0.42, '<span class="tag">定向</span>L = L₁ + L₂ 取逆时针，区域在行进方向左侧 ⇒ 正向'],
        [0.72, '<span class="tag">恢复</span>L 闭合 ⇒ D 存在 ⇒ <span class="hot">∮<sub>L</sub> = ∬<sub>D</sub></span>，漏色停止']
      ]
    },
    {
      phase: 2, label: '2.3', short: '回写', dur: 9.5, micro: 'patch',
      tag: '阶段 2 · 补线法',
      note: '把闭合结果拆回去：所求的开曲线积分 = 闭合环路积分 − 补线积分。',
      caption: '补线段 dy = 0，项被清零', hint: '拆回原曲线',
      rows: [
        [0.06, '<span class="tag">回写</span>∫<sub>L₁</sub> = ∮<sub>L₁+L₂</sub> − ∫<sub>L₂</sub>'],
        [0.3, '<span class="tag">代入</span>= <span class="hot">∬<sub>D</sub> (∂Q/∂x − ∂P/∂y) dx dy</span> − ∫<sub>L₂</sub>'],
        [0.56, '<span class="tag">简化</span>L₂ 落在 x 轴上：<span class="pos">dy = 0</span> ⇒ <span class="neg">Q dy 项清零</span>，只剩 ∫ P dx'],
        [0.78, '<span class="tag">数值</span>∮ = <span class="num">' + LOOP2.toFixed(4) + '</span>，∫<sub>L₂</sub> = ∫<sub>−2</sub><sup>2</sup> x² dx = <span class="num">' + AXISS.toFixed(4) + '</span> ⇒ ∫<sub>L₁</sub> = <span class="num">' + ARCV.toFixed(4) + '</span>']
      ]
    },
    {
      phase: 3, label: '3.1', short: '奇点', dur: 6, micro: 'sing',
      tag: '阶段 3 · 挖洞法',
      note: '原点出现奇点：偏导不连续，全域网格在它附近旋度发散、震颤崩溃。',
      caption: '奇点 (0, 0)：旋度发散', hint: '公式在这里报错',
      rows: [
        [0.08, '<span class="tag">奇点</span>F 在原点无界，<span class="bad">∂Q/∂x、∂P/∂y 于 (0,0) 不连续</span>'],
        [0.42, '<span class="tag">报错</span>不满足格林公式条件 ⇒ <span class="bad">不能直接对全域套用</span>'],
        [0.72, '<span class="eq-note">奇点附近的方格旋度发散：网格越密，爆炸越剧烈。</span>']
      ]
    },
    {
      phase: 3, label: '3.2', short: '割线', dur: 8, micro: 'topo',
      tag: '阶段 3 · 挖洞法',
      note: '从外边界引割线进入，绕奇点画顺时针小圆，再沿原路退出 —— 把洞切开。',
      caption: '割线进出 + 顺时针内环', hint: '把复连通切开',
      rows: [
        [0.06, '<span class="tag">割线</span>沿 <span class="cut">C<sub>进</sub></span> 从 L<sub>外</sub> 走到奇点边缘'],
        [0.34, '<span class="tag">内环</span>绕奇点画顺时针小圆 <span class="hole">L⁻<sub>内</sub></span>（与外边界方向相反）'],
        [0.64, '<span class="tag">返回</span>沿完全重合的割线 <span class="cut">C<sub>出</sub></span> 退回 L<sub>外</sub>'],
        [0.86, '<span class="tag">复合边界</span>L = L<sub>外</sub> + <span class="cut">C<sub>进</sub></span> + <span class="hole">L⁻<sub>内</sub></span> + <span class="cut">C<sub>出</sub></span>']
      ]
    },
    {
      phase: 3, label: '3.3', short: '相消', dur: 6, micro: 'topo',
      tag: '阶段 3 · 挖洞法',
      note: '割线一进一出完全重合、方向相反，两股光流正负抵消。',
      caption: '割线进出相互抵消', hint: '割线贡献归零',
      rows: [
        [0.08, '<span class="tag">抵消</span><span class="cut">∫<sub>C进</sub></span> + <span class="cut">∫<sub>C出</sub></span> = <span class="hot">0</span>（同一线段，方向相反）'],
        [0.44, '<span class="tag">剩余</span>L = L<sub>外</sub> + <span class="hole">L⁻<sub>内</sub></span>：割线消失，只剩两个环'],
        [0.76, '<span class="tag">区域</span>剩下的环形域 D′ 内部<b>没有奇点</b>，格林公式重新合法']
      ]
    },
    {
      phase: 3, label: '3.4', short: '收缩', dur: 9.5, micro: 'topo',
      tag: '阶段 3 · 挖洞法',
      note: 'D′ 内旋度恒为 0，复杂外边界被等价收缩成绕原点的小圆周积分。',
      caption: '外边界 ⇄ 小圆周（等价）', hint: '考点归宿',
      rows: [
        [0.06, '<span class="tag">合法</span>D′ 无奇点，且处处 <span class="pos">旋度 ≡ 0</span>'],
        [0.3, '<span class="tag">格林</span>∮<sub>L外</sub> + ∮<sub>L⁻内</sub> = ∬<sub>D′</sub> 0 dσ = <span class="hot">0</span>'],
        [0.6, '<span class="tag">等价</span>⇒ ∮<sub>L外</sub> = ∮<sub>L⁺内 (逆时针)</sub> = <span class="hot">2π ≈ 6.2832</span>'],
        [0.84, '<span class="eq-note">任意复杂的外边界都收缩成「以原点为中心的小圆」，计算彻底简化。</span>']
      ]
    }
  ];

  const TOTAL = STEPS.reduce((s, st) => s + st.dur, 0);
  const CUM = [];
  STEPS.reduce((s, st, i) => { CUM[i] = s; return s + st.dur; }, 0);

  /* ================= 状态 ================= */
  const state = {
    step: 0, p: 0, playing: !reduceMotion, speed: 1,
    n: M.GRID.n, time: 0, rowsShown: [], scrub: false
  };

  /* ================= DOM ================= */
  const $ = id => document.getElementById(id);
  const ui = {
    phaseTag: $('phase-tag'), sceneNote: $('scene-note'),
    microCaption: $('micro-caption'), algebraHint: $('algebra-hint'), rows: $('rows'),
    gLineLabel: $('g-line-label'), gLineValue: $('g-line-value'), gLineFill: $('g-line-fill'),
    gAreaLabel: $('g-area-label'), gAreaValue: $('g-area-value'), gAreaFill: $('g-area-fill'),
    badge: $('equation-badge'), slotTopo: $('slot-topo'), slotN: $('n-slider'),
    slotNVal: $('slot-n-val'), slotErr: $('slot-err'),
    cancelVal: $('cancel-val'), cancelFill: $('cancel-fill'),
    restart: $('btn-restart'), prev: $('btn-prev'), play: $('btn-play'), next: $('btn-next'),
    speed: $('speed'), time: $('time'), timeline: $('timeline'), chips: $('chips')
  };
  const canvasLeft = $('left-canvas');
  const canvasMicro = $('micro-canvas');
  const ctxL = canvasLeft.getContext('2d');
  const ctxM = canvasMicro.getContext('2d');
  const sizes = { left: { w: 0, h: 0 }, micro: { w: 0, h: 0 } };

  /* ================= 工具 ================= */
  const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
  const easeInOut = t => { t = clamp(t); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  const hash = i => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function resizeCanvas(canvas, box, store) {
    const r = box.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    store.w = w; store.h = h;
  }

  function makeView(domain, w, h) {
    const s = Math.min(w / (domain.x1 - domain.x0), h / (domain.y1 - domain.y0));
    const cx = (domain.x0 + domain.x1) / 2, cy = (domain.y0 + domain.y1) / 2;
    return {
      s, w, h, domain,
      x: v => w / 2 + (v - cx) * s,
      y: v => h / 2 - (v - cy) * s,
      L: v => v * s
    };
  }

  function tracePoly(ctx, V, pts, closed) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const px = V.x(pts[i].x), py = V.y(pts[i].y);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    if (closed !== false) ctx.closePath();
  }

  function arrowHead(ctx, x, y, ang, size, color) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(size, 0); ctx.lineTo(-size * 0.72, size * 0.6); ctx.lineTo(-size * 0.72, -size * 0.6);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }

  function glowStroke(ctx, color, blur, width) {
    ctx.shadowBlur = blur; ctx.shadowColor = color;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function label(ctx, text, x, y, color, size, align) {
    ctx.font = `${size || 11}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = color || C.muted;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  /* ================= 路径参数化 ================= */
  function makeParam(pts, closed) {
    const n = pts.length, segs = closed ? n : n - 1;
    const cum = [0];
    let total = 0;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      total += Math.hypot(b.x - a.x, b.y - a.y);
      cum.push(total);
    }
    return { cum, total, closed, n };
  }

  function pointAt(par, pts, t) {
    const target = clamp(t) * par.total;
    let i = 0;
    while (i < par.cum.length - 2 && par.cum[i + 1] < target) i++;
    const a = pts[i % par.n], b = pts[(i + 1) % par.n];
    const segLen = par.cum[i + 1] - par.cum[i] || 1;
    const u = (target - par.cum[i]) / segLen;
    return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  function polyUntil(par, pts, t) {
    const target = clamp(t) * par.total;
    const out = [pts[0]];
    for (let i = 1; i <= par.n; i++) {
      if (par.cum[i] > target) {
        const a = pts[i - 1], b = pts[i % par.n];
        const segLen = par.cum[i] - par.cum[i - 1] || 1;
        const u = (target - par.cum[i - 1]) / segLen;
        out.push({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) });
        break;
      }
      out.push(pts[i % par.n]);
    }
    return out;
  }

  const PAR_BLOB = makeParam(BLOB, true);
  const PAR_ARC = makeParam(ARC, false);

  /* ================= 向量场流线 ================= */
  const streamCache = {};
  function buildStreamlines(field, key) {
    if (streamCache[key]) return streamCache[key];
    const STEP = 0.052, N = 30;
    const dirOf = pt => {
      const fx = field.P(pt.x, pt.y), fy = field.Q(pt.x, pt.y);
      const m = Math.hypot(fx, fy);
      if (!isFinite(m) || m < 1e-9) return null;
      return { x: fx / m, y: fy / m };
    };
    const lines = [], heads = [];
    for (let gy = -1.9; gy <= 1.901; gy += 0.475) {
      for (let gx = -2.85; gx <= 2.851; gx += 0.475) {
        if (Math.hypot(gx, gy) < 0.17) continue;
        const seed = { x: gx, y: gy };
        const back = [];
        let cur = { x: gx, y: gy };
        for (let i = 0; i < N; i++) {
          const d = dirOf(cur); if (!d) break;
          cur = { x: cur.x - d.x * STEP, y: cur.y - d.y * STEP };
          back.push(cur);
        }
        const fwd = [];
        cur = { x: gx, y: gy };
        for (let i = 0; i < N; i++) {
          const d = dirOf(cur); if (!d) break;
          cur = { x: cur.x + d.x * STEP, y: cur.y + d.y * STEP };
          fwd.push(cur);
        }
        const line = back.reverse().concat([seed], fwd);
        if (line.length > 6) lines.push(line);
        const d0 = dirOf(seed);
        if (d0) heads.push({ x: gx, y: gy, ang: Math.atan2(d0.y, d0.x) });
      }
    }
    streamCache[key] = { lines, heads };
    return streamCache[key];
  }

  let fieldPaths = { key: '', path: null, heads: [] };
  function streamPath(key, V) {
    const ck = `${key}|${V.w}x${V.h}|${V.domain.x0},${V.domain.y0},${V.domain.x1},${V.domain.y1}`;
    if (fieldPaths.key === ck) return fieldPaths;
    const data = buildStreamlines(key === 'singular' ? M.SINGULAR : M.SMOOTH, key);
    const path = new Path2D();
    data.lines.forEach(line => {
      line.forEach((pt, i) => {
        const px = V.x(pt.x), py = V.y(pt.y);
        if (i === 0) path.moveTo(px, py); else path.lineTo(px, py);
      });
    });
    fieldPaths = {
      key: ck, path,
      heads: data.heads.map(hd => ({ x: V.x(hd.x), y: V.y(hd.y), ang: hd.ang }))
    };
    return fieldPaths;
  }

  /* ================= 网格缓存 ================= */
  let gridCache = null;
  function gridData() {
    if (gridCache && gridCache.n === state.n) return gridCache;
    const g = M.makeGrid(state.n, -M.GRID.extent, M.GRID.extent);
    const mask = M.insideMask(g, BLOB);
    gridCache = {
      g, mask, n: state.n,
      sum: M.gridSum(g, mask, (x, y) => M.SMOOTH.curl(x, y)),
      contacts: M.contactEdges(g, mask),
      bounds: M.boundaryEdges(g, mask)
    };
    return gridCache;
  }

  /* ================= 左视图底图 ================= */
  function drawBackdrop(ctx, w, h) {
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(96,140,196,.055)';
    ctx.lineWidth = 1;
    for (let x = 0.5; x < w; x += 36) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0.5; y < h; y += 36) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }

  function drawAxes(ctx, V) {
    ctx.save();
    ctx.strokeStyle = 'rgba(140,170,210,.26)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(V.x(V.domain.x0), V.y(0)); ctx.lineTo(V.x(V.domain.x1), V.y(0));
    ctx.moveTo(V.x(0), V.y(V.domain.y0)); ctx.lineTo(V.x(0), V.y(V.domain.y1));
    ctx.stroke();
    for (let t = -3; t <= 3; t++) {
      if (t === 0 || t < V.domain.x0 || t > V.domain.x1) continue;
      ctx.beginPath();
      ctx.moveTo(V.x(t), V.y(0) - 4); ctx.lineTo(V.x(t), V.y(0) + 4);
      ctx.moveTo(V.x(0) - 4, V.y(t)); ctx.lineTo(V.x(0) + 4, V.y(t));
      ctx.stroke();
    }
    label(ctx, 'x', V.x(V.domain.x1) - 8, V.y(0) - 12, 'rgba(160,185,215,.6)', 12);
    label(ctx, 'y', V.x(0) + 9, V.y(V.domain.y1) + 10, 'rgba(160,185,215,.6)', 12);
    label(ctx, 'O', V.x(0) - 14, V.y(0) + 12, 'rgba(160,185,215,.55)', 11);
    ctx.restore();
  }

  function drawFieldLines(ctx, V, key, now) {
    const sp = streamPath(key, V);
    if (!sp.path) return;
    ctx.save();
    ctx.setLineDash([3, 10]);
    ctx.lineDashOffset = reduceMotion ? 0 : -(now * 26);
    ctx.strokeStyle = 'rgba(126,152,196,.36)';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.stroke(sp.path);
    ctx.setLineDash([]);
    sp.heads.forEach(hd => arrowHead(ctx, hd.x, hd.y, hd.ang, 4.4, 'rgba(140,166,208,.34)'));
    ctx.restore();
  }

  function drawClosedCurve(ctx, V, pts, opt) {
    opt = opt || {};
    ctx.save();
    tracePoly(ctx, V, pts, opt.closed !== false);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (opt.glow === false) {
      ctx.strokeStyle = opt.color || C.cyan;
      ctx.lineWidth = opt.width || 2.4;
      ctx.stroke();
    } else {
      glowStroke(ctx, opt.color || C.cyan, opt.blur === undefined ? 12 : opt.blur, opt.width || 2.4);
    }
    ctx.restore();
  }

  function drawDirectionArrows(ctx, V, pts, par, color, count) {
    for (let i = 0; i < count; i++) {
      const pt = pointAt(par, pts, (i + 0.5) / count);
      arrowHead(ctx, V.x(pt.x), V.y(pt.y), pt.ang, 6.5, color);
    }
  }

  /* ================= 阶段 1：微元大抵消 ================= */
  function drawPhase1(ctx, V, now, step, p) {
    const gd = gridData();

    if (step >= 1) {
      const a = step === 1 ? 0.1 * clamp(p / 0.5) : 0.1;
      tracePoly(ctx, V, BLOB);
      ctx.fillStyle = `rgba(0,245,255,${(a * 0.45).toFixed(3)})`;
      ctx.fill();
    }

    if (step >= 1) drawGrid(ctx, V, gd, step === 1 ? p : 1);
    if (step === 2) drawMicroCallout(ctx, V, now);
    if (step === 3) drawCancellation(ctx, V, gd, now, p);

    const flare = step === 3 && p > 0.85 ? 1 : 0;
    drawClosedCurve(ctx, V, BLOB, { color: C.cyan, blur: 12 + flare * 14, width: 2.4 + flare * 1.6 });
    drawDirectionArrows(ctx, V, BLOB, PAR_BLOB, 'rgba(0,245,255,.9)', 7);

    if (step === 0) drawTravellingCursor(ctx, V, p);

    const lp = pointAt(PAR_BLOB, BLOB, 0.14);
    label(ctx, 'L（逆时针）', V.x(lp.x) + 12, V.y(lp.y) - 12, C.cyan, 11.5);
    label(ctx, 'D', V.x(0), V.y(0.2), 'rgba(0,245,255,.75)', 16, 'center');
    if (step === 3) label(ctx, 'Σ 微元环流 = ∮L', V.x(0), V.y(-0.62), C.cyan, 13, 'center');
  }

  function drawGrid(ctx, V, gd, reveal) {
    const { g, mask } = gd;
    const ext = M.GRID.extent;
    ctx.save();
    tracePoly(ctx, V, BLOB);
    ctx.clip();

    /* 格子着色：旋度为正偏青、为负偏橙 */
    for (let j = 0; j < g.n; j++) {
      for (let i = 0; i < g.n; i++) {
        if (!mask[j][i]) continue;
        const c = M.cellCenter(g, i, j);
        const d = clamp(Math.hypot(c.x, c.y) / 1.55);
        const t = clamp((reveal - d * 0.42) / 0.32);
        if (t <= 0.01) continue;
        ctx.fillStyle = M.SMOOTH.curl(c.x, c.y) >= 0
          ? `rgba(0,245,255,${(0.055 * t).toFixed(3)})`
          : `rgba(255,184,0,${(0.08 * t).toFixed(3)})`;
        ctx.fillRect(V.x(g.lo + i * g.h), V.y(g.lo + (j + 1) * g.h), V.L(g.h), V.L(g.h));
      }
    }

    ctx.lineWidth = 1;
    for (let i = 1; i < g.n; i++) {
      const x = g.lo + i * g.h;
      const t = clamp((reveal - Math.abs(x) / ext * 0.4) / 0.35);
      if (t <= 0.01) continue;
      ctx.strokeStyle = `rgba(126,175,225,${(0.2 * t).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(V.x(x), V.y(g.lo)); ctx.lineTo(V.x(x), V.y(g.lo + g.h * g.n));
      ctx.stroke();
    }
    for (let j = 1; j < g.n; j++) {
      const y = g.lo + j * g.h;
      const t = clamp((reveal - Math.abs(y) / ext * 0.4) / 0.35);
      if (t <= 0.01) continue;
      ctx.strokeStyle = `rgba(126,175,225,${(0.2 * t).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(V.x(g.lo), V.y(y)); ctx.lineTo(V.x(g.lo + g.h * g.n), V.y(y));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMicroCallout(ctx, V, now) {
    const x0 = V.x(CELL.x0), y0 = V.y(CELL.y1);
    const w = V.L(CELL.h), h = V.L(CELL.h);
    const pulse = reduceMotion ? 0.4 : 0.5 + 0.5 * Math.sin(now * 4);

    ctx.save();
    const ex = x0 - w * 0.45, ey = y0 - h * 0.45, ew = w * 1.9, eh = h * 1.9;
    ctx.strokeStyle = rgba(C.cyan, 0.3 + pulse * 0.35);
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(ex, ey, ew, eh);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(ex, ey);
    ctx.moveTo(x0 + w, y0); ctx.lineTo(ex + ew, ey);
    ctx.moveTo(x0, y0 + h); ctx.lineTo(ex, ey + eh);
    ctx.moveTo(x0 + w, y0 + h); ctx.lineTo(ex + ew, ey + eh);
    ctx.strokeStyle = rgba(C.cyan, 0.22);
    ctx.stroke();

    ctx.fillStyle = 'rgba(0,245,255,.10)';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 2.4;
    ctx.shadowBlur = 14 + pulse * 10;
    ctx.shadowColor = C.cyan;
    ctx.strokeRect(x0, y0, w, h);
    ctx.shadowBlur = 0;
    ctx.restore();

    label(ctx, '微元 dx·dy → 右栏放大', x0 + w / 2, y0 - 20, C.cyan, 11.5, 'center');
    label(ctx, `(x, y) = (${CELL.x0.toFixed(2)}, ${CELL.y0.toFixed(2)})`,
      x0 - 8, y0 + h + 14, 'rgba(190,215,240,.78)', 10.5, 'right');
  }

  function drawCancellation(ctx, V, gd, now, p) {
    const { contacts, bounds } = gd;
    const appear = clamp(p / 0.22);
    const flow = reduceMotion ? 0.5 : (now * 0.75) % 1;

    ctx.save();
    ctx.lineCap = 'round';
    contacts.forEach((e, idx) => {
      const f = clamp((p - 0.34 - hash(idx) * 0.17) / 0.16);
      const a = appear * (1 - f);
      if (a <= 0.02) return;
      const x1 = V.x(e.x1), y1 = V.y(e.y1), x2 = V.x(e.x2), y2 = V.y(e.y2);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.hypot(x2 - x1, y2 - y1);

      ctx.strokeStyle = rgba(C.orange, 0.72 * a);
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

      if (p < 0.56 && len > 6) {
        const u = 0.06 + flow * 0.4;
        arrowHead(ctx, lerp(x1, x2, u), lerp(y1, y2, u), ang, 3.4, rgba(C.orange, 0.95 * a));
        arrowHead(ctx, lerp(x2, x1, u), lerp(y2, y1, u), ang + Math.PI, 3.4, rgba(C.orange, 0.95 * a));
      }

      if (f > 0 && f < 0.85) {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const r = 4 + 16 * f;
        const al = (1 - f) * 0.85;
        const grd = ctx.createRadialGradient(mx, my, 0, mx, my, r);
        grd.addColorStop(0, `rgba(255,255,255,${al.toFixed(3)})`);
        grd.addColorStop(0.35, rgba(C.orange, al * 0.75));
        grd.addColorStop(1, 'rgba(255,184,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
      }
    });
    ctx.restore();

    /* 未被抵消的外层边 */
    const remain = clamp((p - 0.5) / 0.28) * (1 - clamp((p - 0.88) / 0.12) * 0.7);
    if (remain > 0.01) {
      ctx.save();
      ctx.strokeStyle = rgba(C.cyan, 0.85 * remain);
      ctx.lineWidth = 2.6;
      ctx.shadowBlur = 10;
      ctx.shadowColor = C.cyan;
      ctx.beginPath();
      bounds.forEach(e => {
        ctx.moveTo(V.x(e.x1), V.y(e.y1));
        ctx.lineTo(V.x(e.x2), V.y(e.y2));
      });
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawTravellingCursor(ctx, V, p) {
    const done = polyUntil(PAR_BLOB, BLOB, p);
    if (done.length > 1) {
      ctx.save();
      tracePoly(ctx, V, done, false);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      glowStroke(ctx, C.cyan, 18, 3.4);
      ctx.restore();
    }
    const pt = pointAt(PAR_BLOB, BLOB, p);
    const px = V.x(pt.x), py = V.y(pt.y);
    const grd = ctx.createRadialGradient(px, py, 0, px, py, 16);
    grd.addColorStop(0, 'rgba(255,255,255,.95)');
    grd.addColorStop(0.3, rgba(C.cyan, 0.75));
    grd.addColorStop(1, 'rgba(0,245,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(px, py, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px, py, 3.6, 0, Math.PI * 2); ctx.fill();

    const text = `∮ F·dr ≈ ${(LINE1 * easeOut(p)).toFixed(4)}`;
    ctx.save();
    ctx.font = '12px ui-monospace, Menlo, monospace';
    const tw = ctx.measureText(text).width + 16;
    const tx = Math.min(px + 18, sizes.left.w - tw - 8), ty = Math.max(8, py - 30);
    ctx.fillStyle = 'rgba(6,12,20,.88)';
    ctx.strokeStyle = rgba(C.cyan, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tx, ty, tw, 22, 5); else ctx.rect(tx, ty, tw, 22);
    ctx.fill(); ctx.stroke();
    label(ctx, text, tx + 8, ty + 11, C.cyan, 12);
    ctx.restore();
  }

  /* ================= 阶段 2：补线法 ================= */
  function drawPhase2(ctx, V, now, step, p) {
    const fillT = step === 0 ? 0 : (step === 1 ? clamp((p - 0.55) / 0.35) : 1);

    if (fillT > 0.01) {
      tracePoly(ctx, V, CLOSED2);
      ctx.fillStyle = `rgba(0,245,255,${(0.13 * fillT).toFixed(3)})`;
      ctx.fill();
    } else {
      const wob = reduceMotion ? 0.07 : 0.06 + 0.03 * Math.sin(now * 4.5);
      tracePoly(ctx, V, CLOSED2);
      ctx.fillStyle = `rgba(0,245,255,${wob.toFixed(3)})`;
      ctx.fill();
      drawLeak(ctx, V, now);
    }

    ctx.save();
    tracePoly(ctx, V, ARC, false);
    ctx.lineCap = 'round';
    glowStroke(ctx, C.cyan, 12, 2.6);
    ctx.restore();
    drawDirectionArrows(ctx, V, ARC, PAR_ARC, 'rgba(0,245,255,.9)', 4);

    const ends = [{ x: 2, y: 0, name: 'A(2, 0)', dir: 1 }, { x: -2, y: 0, name: 'B(−2, 0)', dir: -1 }];
    ends.forEach(e => {
      const px = V.x(e.x), py = V.y(e.y);
      const blink = reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(now * 5);
      ctx.save();
      ctx.fillStyle = '#060a12';
      ctx.strokeStyle = step === 0 ? rgba(C.red, blink) : C.cyan;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      label(ctx, e.name, px + e.dir * 13, py + 17,
        step === 0 ? rgba(C.red, blink * 0.9 + 0.1) : C.cyan, 11.5, e.dir > 0 ? 'left' : 'right');
    });

    if (step >= 1) {
      const t = step === 1 ? clamp(p / 0.55) : 1;
      ctx.save();
      tracePoly(ctx, V, [{ x: -2, y: 0 }, { x: lerp(-2, 2, t), y: 0 }], false);
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = reduceMotion ? 0 : -(now * 22);
      glowStroke(ctx, C.magenta, 14, 3);
      ctx.setLineDash([]);
      ctx.restore();
      if (t > 0.02) arrowHead(ctx, V.x(lerp(-2, 2, t)), V.y(0), 0, 7.5, C.magenta);
      if (t > 0.95) {
        label(ctx, 'L₂ 补线（dy = 0）', V.x(0), V.y(0) + 32, C.magenta, 12, 'center');
        label(ctx, 'D', V.x(0), V.y(0.55), 'rgba(0,245,255,.9)', 16, 'center');
      }
      if (step === 2) {
        label(ctx, `∫L₁ = ∮ − ∫L₂ = ${LOOP2.toFixed(4)} − ${AXISS.toFixed(4)} = ${ARCV.toFixed(4)}`,
          V.x(0), V.y(-0.68), C.gold, 12.5, 'center');
      }
    } else {
      label(ctx, 'L₁ 不闭合：∬D 不存在', V.x(0), V.y(-0.8), rgba(C.red, 0.95), 12.5, 'center');
      label(ctx, 'L₁', V.x(0.75), V.y(1.05), C.cyan, 12.5, 'center');
    }
  }

  function drawLeak(ctx, V, now) {
    ctx.save();
    for (let k = 0; k < 16; k++) {
      const u = (now * 0.32 + hash(k) * 0.9 + k / 16) % 1;
      const x = lerp(-1.95, 1.95, (k + hash(k + 7) * 0.6) / 16);
      const a = (1 - u) * 0.75;
      if (a <= 0.02) continue;
      const px = V.x(x), py = V.y(-u * 1.15);
      ctx.fillStyle = `rgba(255,184,0,${(a * 0.85).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255,184,0,${(a * 0.4).toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + 14); ctx.stroke();
    }
    ctx.restore();
  }

  /* ================= 阶段 3：挖洞法 ================= */
  function drawPhase3(ctx, V, now, step, p) {
    if (step === 0) drawBlastGrid(ctx, V, now, p);

    if (step === 3) {
      const a = easeInOut(clamp((p - 0.12) / 0.62));
      const morphed = BLOB.map(pt => {
        const r = Math.hypot(pt.x, pt.y) || 1;
        const k = lerp(1, 0.34 / r, a);
        return { x: pt.x * k, y: pt.y * k };
      });
      const col = a > 0.5 ? C.gold : C.cyan;
      drawClosedCurve(ctx, V, morphed, { color: col, blur: 14 + 10 * a, width: 2.6 + a });
      if (a < 0.98) drawDirectionArrows(ctx, V, morphed, PAR_BLOB, col, 6);
      if (a > 0.35) {
        const mid = morphed[Math.floor(morphed.length * 0.14)];
        label(ctx, `∮L外 = ${CIRC.toFixed(4)}`, V.x(mid.x) - 6, V.y(mid.y) - 22, C.cyan, 12);
      }
      if (a > 0.92) {
        label(ctx, `外边界 ≡ 小圆周　∮ = ${CIRC.toFixed(4)}`, V.x(0), V.y(1.4), C.gold, 13.5, 'center');
      }
      drawInnerCircleArrows(ctx, V, now);
    } else {
      drawClosedCurve(ctx, V, BLOB, { color: C.cyan, blur: 12, width: 2.4 });
      drawDirectionArrows(ctx, V, BLOB, PAR_BLOB, 'rgba(0,245,255,.9)', 6);
      const lp = pointAt(PAR_BLOB, BLOB, 0.14);
      label(ctx, 'L外', V.x(lp.x) + 12, V.y(lp.y) - 12, C.cyan, 11.5);
      if (step >= 1) drawCutAndHole(ctx, V, now, step, p);
    }

    drawSingularity(ctx, V, now, step === 0 ? 1 : 0.72);
    if (step === 0) {
      label(ctx, '奇点 (0,0)', V.x(0) + 20, V.y(0) + 28, C.red, 11.5);
      label(ctx, '旋度发散 → 网格崩溃', V.x(0), V.y(1.4), rgba(C.red, 0.95), 12.5, 'center');
    }
  }

  function drawBlastGrid(ctx, V, now, p) {
    const g = M.makeGrid(state.n, -M.GRID.extent, M.GRID.extent);
    const reveal = clamp(p / 0.4);
    ctx.save();
    tracePoly(ctx, V, BLOB);
    ctx.clip();
    for (let j = 0; j < g.n; j++) {
      for (let i = 0; i < g.n; i++) {
        const c = M.cellCenter(g, i, j);
        if (!M.pointInPolygon(c, BLOB)) continue;
        const d = Math.hypot(c.x, c.y);
        const near = clamp(1 - d / 0.62);
        const t = clamp((reveal - d / 1.6 * 0.4) / 0.3);
        if (t <= 0.02) continue;
        const jx = near > 0 && !reduceMotion ? Math.sin(now * 26 + i * 2.1 + j * 3.7) * 5 * near : 0;
        const jy = near > 0 && !reduceMotion ? Math.cos(now * 23 + i * 1.3 + j * 2.9) * 5 * near : 0;
        const x = V.x(g.lo + i * g.h) + jx, y = V.y(g.lo + (j + 1) * g.h) + jy;
        const w = V.L(g.h), h = V.L(g.h);
        ctx.strokeStyle = near > 0.05
          ? rgba(C.red, (0.35 + 0.5 * near) * t)
          : `rgba(126,175,225,${(0.2 * t).toFixed(3)})`;
        ctx.lineWidth = near > 0.05 ? 1.4 : 1;
        ctx.strokeRect(x, y, w, h);
        if (near > 0.3) {
          ctx.fillStyle = rgba(C.red, 0.1 * near * t);
          ctx.fillRect(x, y, w, h);
        }
      }
    }
    ctx.restore();
  }

  function drawSingularity(ctx, V, now, strength) {
    const px = V.x(0), py = V.y(0);
    const beat = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now * 5.2);
    ctx.save();
    for (let r = 0; r < 2; r++) {
      const t = reduceMotion ? 0.4 : ((now * 0.55 + r * 0.5) % 1);
      ctx.strokeStyle = rgba(C.red, (1 - t) * 0.5 * strength);
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(px, py, 6 + t * 54, 0, Math.PI * 2); ctx.stroke();
    }
    const grd = ctx.createRadialGradient(px, py, 0, px, py, 24 + beat * 8);
    grd.addColorStop(0, `rgba(255,255,255,${0.85 * strength})`);
    grd.addColorStop(0.22, rgba(C.red, 0.95 * strength));
    grd.addColorStop(1, 'rgba(255,23,68,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(px, py, 26 + beat * 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba(C.red, 0.85 * strength);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px - 13, py); ctx.lineTo(px + 13, py);
    ctx.moveTo(px, py - 13); ctx.lineTo(px, py + 13);
    ctx.stroke();
    ctx.restore();
  }

  function drawCutAndHole(ctx, V, now, step, p) {
    const fromX = V.x(CONTOUR.cutIn[0].x), fromY = V.y(CONTOUR.cutIn[0].y);
    const toX = V.x(CONTOUR.cutIn[1].x), toY = V.y(CONTOUR.cutIn[1].y);
    const dx = toX - fromX, dy = toY - fromY;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const sep = 5 * (step === 1 ? 1 : 1 - clamp(p / 0.55));
    const radius = V.L(0.34);

    /* 内环：顺时针微型圆 */
    const startAng = Math.atan2(CONTOUR.inner[0].y, CONTOUR.inner[0].x);
    const innerT = step === 1 ? clamp(p / 0.62) : 1;
    ctx.save();
    ctx.strokeStyle = rgba(C.gold, 0.95);
    ctx.lineWidth = 2.4;
    ctx.shadowBlur = 12;
    ctx.shadowColor = C.gold;
    ctx.beginPath();
    ctx.arc(V.x(0), V.y(0), radius, startAng, startAng - Math.PI * 2 * innerT, true);
    ctx.stroke();
    ctx.restore();
    if (innerT > 0.08) {
      const ea = startAng - Math.PI * 2 * innerT;
      arrowHead(ctx, V.x(0) + Math.cos(ea) * radius, V.y(0) + Math.sin(ea) * radius,
        ea - Math.PI / 2, 7, C.gold);
    }

    /* 割线一进一出 */
    const cutAlpha = step === 1 ? 1 : 1 - clamp(p / 0.7);
    if (cutAlpha > 0.02) {
      const drawCut = (off, dir, name) => {
        ctx.save();
        ctx.strokeStyle = rgba(C.magenta, 0.95 * cutAlpha);
        ctx.lineWidth = 2.2;
        ctx.shadowBlur = 10;
        ctx.shadowColor = C.magenta;
        ctx.beginPath();
        ctx.moveTo(fromX + nx * off, fromY + ny * off);
        ctx.lineTo(toX + nx * off, toY + ny * off);
        ctx.stroke();
        ctx.restore();
        const t = reduceMotion ? 0.6 : (now * 0.55) % 1;
        const u = dir > 0 ? t : 1 - t;
        const ang = Math.atan2(toY - fromY, toX - fromX) + (dir > 0 ? 0 : Math.PI);
        arrowHead(ctx, lerp(fromX, toX, u) + nx * off, lerp(fromY, toY, u) + ny * off, ang, 6.5,
          rgba(C.magenta, cutAlpha));
        label(ctx, name, lerp(fromX, toX, 0.5) + nx * off * 3 + 8,
          lerp(fromY, toY, 0.5) + ny * off * 3 - 6, rgba(C.magenta, cutAlpha), 11);
      };
      drawCut(-sep, 1, 'C 进');
      drawCut(sep, -1, 'C 出');

      if (step === 2 && p > 0.45) {
        const mx = (fromX + toX) / 2, my = (fromY + toY) / 2;
        const f = clamp((p - 0.45) / 0.3);
        const r = 6 + 32 * f;
        const grd = ctx.createRadialGradient(mx, my, 0, mx, my, r);
        grd.addColorStop(0, `rgba(255,255,255,${((1 - f) * 0.9).toFixed(3)})`);
        grd.addColorStop(0.4, rgba(C.magenta, (1 - f) * 0.7));
        grd.addColorStop(1, 'rgba(255,42,133,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
        if (f > 0.3) label(ctx, '∫C进 + ∫C出 = 0', mx + 18, my - 16, C.magenta, 12);
      }
      label(ctx, 'C', lerp(fromX, toX, 0.72) + 12, lerp(fromY, toY, 0.72) - 10, C.magenta, 11);
    }
    label(ctx, 'L⁻内（顺时针）', V.x(0), V.y(-0.34) - 20, C.gold, 11, 'center');
  }

  function drawInnerCircleArrows(ctx, V, now) {
    const radius = V.L(0.34);
    ctx.save();
    ctx.strokeStyle = rgba(C.gold, 0.95);
    ctx.lineWidth = 2.6;
    ctx.shadowBlur = 14;
    ctx.shadowColor = C.gold;
    ctx.beginPath(); ctx.arc(V.x(0), V.y(0), radius, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    const t = reduceMotion ? 0.35 : (now * 0.35) % 1;
    for (let k = 0; k < 2; k++) {
      const ang = (t + k * 0.5) * Math.PI * 2;
      arrowHead(ctx, V.x(0) + Math.cos(ang) * radius, V.y(0) + Math.sin(ang) * radius,
        ang - Math.PI / 2, 7, C.gold);
    }
    label(ctx, 'L⁺内（逆时针）= 2π', V.x(0), V.y(0) + radius + 22, C.gold, 11.5, 'center');
  }

  /* ================= 右上：微元特写 ================= */
  function microBackdrop(ctx, w, h) {
    ctx.fillStyle = '#070c15';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(96,140,196,.05)';
    ctx.lineWidth = 1;
    for (let x = 0.5; x < w; x += 26) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0.5; y < h; y += 26) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }

  function microFrame(ctx, w, h) {
    /* 预留：顶部上顶标签 40px、底部两行标签 + 汇总框约 110px */
    const S = Math.max(54, Math.min(w * 0.26, h - 150));
    return { S, cx: w * 0.45, cy: 40 + S / 2 };
  }

  function drawMicro(ctx, w, h, now, step, p) {
    microBackdrop(ctx, w, h);
    const kind = STEPS[step].micro;
    if (kind === 'idle') microIdle(ctx, w, h, now);
    else if (kind === 'grid') microGrid(ctx, w, h, now);
    else if (kind === 'cell') microCell(ctx, w, h, now, p);
    else if (kind === 'cancel') microCancel(ctx, w, h, now, p);
    else if (kind === 'patchOpen') microPatch(ctx, w, h, now, true, 0);
    else if (kind === 'patch') microPatch(ctx, w, h, now, false, step === 5 ? p : 1);
    else if (kind === 'sing') microSing(ctx, w, h, now, p);
    else microTopo(ctx, w, h, now, step - 7, p);
  }

  function microIdle(ctx, w, h, now) {
    const { S, cx, cy } = microFrame(ctx, w, h);
    const x = cx - S / 2, y = cy - S / 2;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(126,152,196,.5)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x, y, S, S);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(126,152,196,.05)';
    ctx.fillRect(x, y, S, S);
    const sweep = ((now * 0.4) % 1) * S;
    ctx.fillStyle = 'rgba(0,245,255,.16)';
    ctx.fillRect(x, y + sweep - 2, S, 4);
    ctx.restore();
    label(ctx, 'dx', cx, y + S + 14, C.muted, 11, 'center');
    label(ctx, 'dy', x - 10, cy, C.muted, 11, 'right');
    label(ctx, '镜头将拉入这一个微元 →', cx, Math.max(14, y - 22), 'rgba(0,245,255,.8)', 12, 'center');
  }

  function microGrid(ctx, w, h, now) {
    const { S, cx, cy } = microFrame(ctx, w, h);
    const x = cx - S / 2, y = cy - S / 2;
    const n = 4;
    ctx.save();
    ctx.strokeStyle = 'rgba(126,175,225,.45)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(x + S * i / n, y); ctx.lineTo(x + S * i / n, y + S);
      ctx.moveTo(x, y + S * i / n); ctx.lineTo(x + S, y + S * i / n);
      ctx.stroke();
    }
    const hi = reduceMotion ? 1 : 0.5 + 0.5 * Math.sin(now * 3);
    ctx.fillStyle = `rgba(0,245,255,${(0.1 + hi * 0.1).toFixed(3)})`;
    ctx.fillRect(x + S / n, y + S / n, S / n, S / n);
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 2.2;
    ctx.shadowBlur = 12 + hi * 8;
    ctx.shadowColor = C.cyan;
    ctx.strokeRect(x + S / n, y + S / n, S / n, S / n);
    ctx.restore();
    label(ctx, 'dx', cx + S / n / 2, y + S + 14, C.muted, 11, 'center');
    label(ctx, 'dy', x + S / n - 10, cy, C.muted, 11, 'right');
    label(ctx, `N×N = ${state.n}×${state.n} 中的一格`, cx, Math.max(14, y - 22), 'rgba(0,245,255,.85)', 12, 'center');
  }

  /* 单个微元四边环流（数值全部来自模型） */
  function microCell(ctx, w, h, now, p) {
    const { S, cx, cy } = microFrame(ctx, w, h);
    const x = cx - S / 2, y = cy - S / 2;
    const seq = [
      { key: 'bottom', at: 0.14, color: C.cyan, text: '下底  +∫P dx', val: MICRO_EDGES.bottom },
      { key: 'top', at: 0.30, color: C.orange, text: '上顶  −∫P dx', val: MICRO_EDGES.top },
      { key: 'right', at: 0.46, color: C.cyan, text: '右壁  +∫Q dy', val: MICRO_EDGES.right },
      { key: 'left', at: 0.60, color: C.orange, text: '左壁  −∫Q dy', val: MICRO_EDGES.left }
    ];
    const geom = {
      bottom: { x1: x, y1: y + S, x2: x + S, y2: y + S, tx: cx, ty: y + S + 26, align: 'center' },
      top: { x1: x + S, y1: y, x2: x, y2: y, tx: cx, ty: y - 24, align: 'center' },
      right: { x1: x + S, y1: y + S, x2: x + S, y2: y, tx: x + S + 12, ty: cy - 16, align: 'left' },
      left: { x1: x, y1: y, x2: x, y2: y + S, tx: x - 12, ty: cy - 16, align: 'right' }
    };

    /* 微元本体 */
    ctx.save();
    ctx.fillStyle = 'rgba(0,245,255,.045)';
    ctx.fillRect(x, y, S, S);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(150,190,230,.55)';
    ctx.lineWidth = 1.3;
    ctx.strokeRect(x, y, S, S);
    ctx.setLineDash([]);
    ctx.restore();

    /* dx / dy 与角点 */
    label(ctx, 'dx', cx, y + S - 15, 'rgba(190,215,240,.75)', 10.5, 'center');
    label(ctx, 'dy', x + 17, cy, 'rgba(190,215,240,.75)', 10.5, 'center');
    label(ctx, '(x, y)', x - 12, y + S + 12, 'rgba(190,215,240,.85)', 11, 'right');
    label(ctx, 'CCW', x + 8, y + 14, 'rgba(0,245,255,.75)', 10.5);

    /* 依次点亮四条边 */
    seq.forEach(item => {
      const ap = clamp((p - item.at) / 0.12);
      if (ap <= 0.01) return;
      const g = geom[item.key];
      const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
      const ang = Math.atan2(g.y2 - g.y1, g.x2 - g.x1);
      const ex = lerp(g.x1, g.x2, ap), ey = lerp(g.y1, g.y2, ap);

      ctx.save();
      ctx.strokeStyle = rgba(item.color, 0.95);
      ctx.lineWidth = 3;
      ctx.shadowBlur = 10;
      ctx.shadowColor = item.color;
      ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.restore();
      if (ap > 0.9) {
        arrowHead(ctx, g.x2, g.y2, ang, 8, item.color);
        const flow = reduceMotion ? 0.5 : (now * 0.8) % 1;
        const fp = 0.15 + flow * 0.7;
        arrowHead(ctx, lerp(g.x1, g.x2, fp), lerp(g.y1, g.y2, fp), ang, 5.5, 'rgba(255,255,255,.85)');
      }
      void len;

      ctx.save();
      ctx.globalAlpha = ap;
      label(ctx, item.text, g.tx, g.ty, item.color, 11, g.align);
      label(ctx, `${item.val >= 0 ? '+' : ''}${item.val.toFixed(4)}`,
        g.tx, g.ty + 15, 'rgba(232,244,255,.9)', 11.5, g.align);
      ctx.restore();
    });

    /* 合并：差分 → 旋度 */
    if (p > 0.74) {
      const ap = clamp((p - 0.74) / 0.14);
      const total = MICRO_EDGES.bottom + MICRO_EDGES.right + MICRO_EDGES.top + MICRO_EDGES.left;
      const boxW = Math.min(w - 24, 430), boxX = (w - boxW) / 2, boxY = h - 62;
      ctx.save();
      ctx.globalAlpha = ap;
      ctx.fillStyle = 'rgba(6,14,24,.94)';
      ctx.strokeStyle = rgba(C.cyan, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, 54, 7); else ctx.rect(boxX, boxY, boxW, 54);
      ctx.fill(); ctx.stroke();
      label(ctx, `净环流 Σ = ${total.toFixed(4)}`, boxX + 12, boxY + 17, C.cyan, 12.5);
      label(ctx, '= (∂Q/∂x − ∂P/∂y)·dx·dy = ( 2.000 − (−1.000) ) × 0.04',
        boxX + 12, boxY + 38, 'rgba(226,240,255,.9)', 11.5);
      ctx.restore();
    }
  }

  function microCancel(ctx, w, h, now, p) {
    const { S, cx, cy } = microFrame(ctx, w, h);
    const half = S / 2;
    const y = cy - half;
    const xl = cx - half - 6, xr = cx + 6;
    const fade = clamp((p - 0.55) / 0.3);
    const flash = p > 0.4 && p < 0.85 ? (reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now * 12)) : 0;

    ctx.save();
    ctx.fillStyle = 'rgba(0,245,255,.05)';
    ctx.fillRect(xl, y, half, S);
    ctx.fillRect(xr, y, half, S);

    /* 两个格子的外轮廓保留 */
    ctx.strokeStyle = rgba(C.cyan, 0.9 * (1 - fade * 0.15));
    ctx.lineWidth = 2.4;
    ctx.shadowBlur = 9;
    ctx.shadowColor = C.cyan;
    ctx.beginPath();
    ctx.moveTo(xl, y);
    ctx.lineTo(xr + half, y);
    ctx.lineTo(xr + half, y + S);
    ctx.lineTo(xl, y + S);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    /* 共享边：反向对冲 → 抵消辉光 */
    const a = (1 - fade) * (0.55 + flash * 0.45);
    if (a > 0.02) {
      ctx.save();
      ctx.strokeStyle = rgba(C.orange, a);
      ctx.lineWidth = 3;
      ctx.shadowBlur = 12 * a;
      ctx.shadowColor = C.orange;
      ctx.beginPath(); ctx.moveTo(xr, y); ctx.lineTo(xr, y + S); ctx.stroke();
      ctx.restore();
      const flow = reduceMotion ? 0.5 : (now * 0.8) % 1;
      const u = 0.12 + flow * 0.36;
      arrowHead(ctx, xr, y + S * u, -Math.PI / 2, 7, rgba(C.orange, a));
      arrowHead(ctx, xr, y + S * (1 - u), Math.PI / 2, 7, rgba(C.orange, a));
      if (fade > 0 && fade < 1) {
        const r = 8 + 34 * flash;
        const grd = ctx.createRadialGradient(xr, cy, 0, xr, cy, r);
        grd.addColorStop(0, `rgba(255,255,255,${((1 - fade) * 0.8).toFixed(3)})`);
        grd.addColorStop(0.4, rgba(C.orange, (1 - fade) * 0.6));
        grd.addColorStop(1, 'rgba(255,184,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(xr, cy, r, 0, Math.PI * 2); ctx.fill();
      }
    }

    label(ctx, '格 A', xl + half / 2, y - 16, 'rgba(0,245,255,.85)', 11, 'center');
    label(ctx, '格 B', xr + half / 2, y - 16, 'rgba(0,245,255,.85)', 11, 'center');
    label(ctx, '共享边：同一条边走两次，方向相反',
      cx, y + S + 26, C.orange, 11.5, 'center');
    if (p > 0.6) {
      label(ctx, '→ 抵消 ✓ 只剩外轮廓 = L',
        cx, y + S + 46, C.cyan, 12, 'center');
    }
  }

  function microPatch(ctx, w, h, now, open, p) {
    const sx = w / 5.8, ox = w * 0.5, oy = h * 0.72;
    const X = v => ox + v * sx;
    const Y = v => oy - v * sx;

    /* 坐标轴 */
    ctx.save();
    ctx.strokeStyle = 'rgba(140,170,210,.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(-2.7), Y(0)); ctx.lineTo(X(2.7), Y(0));
    ctx.moveTo(X(0), Y(-0.45)); ctx.lineTo(X(0), Y(1.45));
    ctx.stroke();
    ctx.restore();

    const PV = { x: X, y: Y };

    /* 区域着色 */
    if (!open) {
      tracePoly(ctx, PV, ARC.concat(AXIS.slice(1)));
      ctx.fillStyle = 'rgba(0,245,255,.14)';
      ctx.fill();
    } else {
      const wob = reduceMotion ? 0.07 : 0.06 + 0.03 * Math.sin(now * 4.5);
      tracePoly(ctx, PV, ARC.concat(AXIS.slice(1)));
      ctx.fillStyle = `rgba(0,245,255,${wob.toFixed(3)})`;
      ctx.fill();
      for (let k = 0; k < 12; k++) {
        const u = (now * 0.35 + hash(k) + k / 12) % 1;
        const a = (1 - u) * 0.8;
        const px = X(lerp(-1.9, 1.9, (k + hash(k + 3)) / 12)), py = Y(-u * 0.42);
        ctx.fillStyle = `rgba(255,184,0,${(a * 0.85).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(px, py, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }

    /* 弧 L₁ */
    ctx.save();
    tracePoly(ctx, PV, ARC, false);
    ctx.lineCap = 'round';
    glowStroke(ctx, C.cyan, 10, 2.4);
    ctx.restore();
    label(ctx, 'L₁', X(0), Y(1.12), C.cyan, 12, 'center');
    label(ctx, 'A', X(2) + 9, Y(0) + 13, C.cyan, 11);
    label(ctx, 'B', X(-2) - 9, Y(0) + 13, C.cyan, 11, 'right');

    if (open) {
      label(ctx, '缺口 → 颜色漏出，∬D 不存在', w / 2, 22, rgba(C.red, 0.95), 12.5, 'center');
      return;
    }

    /* 补线 L₂ */
    ctx.save();
    tracePoly(ctx, PV, [{ x: -2, y: 0 }, { x: lerp(-2, 2, p), y: 0 }], false);
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = reduceMotion ? 0 : -(now * 20);
    glowStroke(ctx, C.magenta, 12, 2.8);
    ctx.setLineDash([]);
    ctx.restore();
    if (p > 0.95) {
      label(ctx, 'L₂: B → A', X(0), Y(0) + 26, C.magenta, 12, 'center');
      label(ctx, 'dy = 0 ⇒ Q dy 项清零', X(0), Y(0) + 46, C.orange, 11.5, 'center');
      label(ctx, `∫L₂ = ${AXISS.toFixed(4)}`, X(0), Y(0) + 66, 'rgba(232,244,255,.9)', 11.5, 'center');
    }
  }

  function microSing(ctx, w, h, now, p) {
    const cx = w * 0.5, cy = h * 0.5;
    const R = Math.min(w, h) * 0.3;
    const reveal = clamp(p / 0.4);
    ctx.save();
    for (let i = -4; i <= 4; i++) {
      const off = i * (R / 4);
      const t = clamp(reveal - Math.abs(i) * 0.06);
      ctx.strokeStyle = `rgba(126,175,225,${(0.28 * t).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + off, cy - R); ctx.lineTo(cx + off, cy + R);
      ctx.moveTo(cx - R, cy + off); ctx.lineTo(cx + R, cy + off);
      ctx.stroke();
    }
    ctx.restore();

    const beat = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now * 7);
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const d = Math.hypot(i, j);
        if (d > 3 || d === 0) continue;
        const near = 1 - d / 3.4;
        const jx = reduceMotion ? 0 : Math.sin(now * 30 + i * 2 + j) * 6 * near;
        const jy = reduceMotion ? 0 : Math.cos(now * 27 + i + j * 2) * 6 * near;
        ctx.strokeStyle = rgba(C.red, (0.3 + 0.6 * near) * reveal);
        ctx.lineWidth = 1.3;
        ctx.strokeRect(cx + i * R / 4 - R / 8 + jx, cy + j * R / 4 - R / 8 + jy, R / 4, R / 4);
      }
    }

    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 26 + beat * 10);
    grd.addColorStop(0, 'rgba(255,255,255,.95)');
    grd.addColorStop(0.25, rgba(C.red, 0.95));
    grd.addColorStop(1, 'rgba(255,23,68,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, 28 + beat * 10, 0, Math.PI * 2); ctx.fill();
    label(ctx, '(0, 0)', cx + 34, cy + 4, C.red, 11.5);
    label(ctx, '旋度 → ∞', w / 2, 22, rgba(C.red, 0.95), 13, 'center');
    label(ctx, '偏导数不连续，公式失效', w / 2, h - 16, 'rgba(226,240,255,.85)', 11.5, 'center');
  }

  function microTopo(ctx, w, h, now, sub, p) {
    const cx = w * 0.5, cy = h * 0.52;
    const R = Math.min(w, h) * 0.3;
    const r = R * 0.34;
    const ang = -0.55;
    const shrink = sub === 2 ? easeInOut(clamp((p - 0.15) / 0.6)) : 0;
    const outerR = lerp(R, r, shrink);

    /* 外环 */
    ctx.save();
    ctx.strokeStyle = shrink > 0.5 ? C.gold : C.cyan;
    ctx.lineWidth = 2.6;
    ctx.shadowBlur = 12;
    ctx.shadowColor = shrink > 0.5 ? C.gold : C.cyan;
    ctx.beginPath();
    ctx.ellipse(cx, cy, outerR, outerR * 0.78, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const t0 = reduceMotion ? 0.3 : (now * 0.3) % 1;
    arrowHead(ctx, cx + Math.cos(t0 * Math.PI * 2) * outerR,
      cy + Math.sin(t0 * Math.PI * 2) * outerR * 0.78,
      Math.atan2(Math.cos(t0 * Math.PI * 2) * 0.78, -Math.sin(t0 * Math.PI * 2)), 7,
      shrink > 0.5 ? C.gold : C.cyan);

    /* 割线 */
    const cutA = sub === 1 ? 1 : 1 - clamp(p / 0.6);
    if (cutA > 0.02 && shrink < 0.4) {
      const ex = cx + Math.cos(ang) * R, ey = cy + Math.sin(ang) * R * 0.78;
      const ix = cx + Math.cos(ang) * r, iy = cy + Math.sin(ang) * r;
      const dx = ix - ex, dy = iy - ey, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const sep = 4 * (sub === 1 ? 1 : 1 - clamp(p / 0.5));
      [-sep, sep].forEach((off, i) => {
        ctx.save();
        ctx.strokeStyle = rgba(C.magenta, cutA);
        ctx.lineWidth = 2;
        ctx.shadowBlur = 8;
        ctx.shadowColor = C.magenta;
        ctx.beginPath();
        ctx.moveTo(ex + nx * off, ey + ny * off);
        ctx.lineTo(ix + nx * off, iy + ny * off);
        ctx.stroke();
        ctx.restore();
        const u = reduceMotion ? 0.6 : (now * 0.6) % 1;
        const dir = i === 0 ? u : 1 - u;
        arrowHead(ctx, lerp(ex, ix, dir) + nx * off, lerp(ey, iy, dir) + ny * off,
          Math.atan2(dy, dx) + (i === 0 ? 0 : Math.PI), 6, rgba(C.magenta, cutA));
      });
      if (sub === 1) {
        label(ctx, 'C 进 / C 出', lerp(ex, ix, 0.5) + 20, lerp(ey, iy, 0.5) - 14, C.magenta, 11);
      }
      if (sub === 2 && p > 0.4) {
        const f = clamp((p - 0.4) / 0.3);
        const mx = (ex + ix) / 2, my = (ey + iy) / 2;
        const grd = ctx.createRadialGradient(mx, my, 0, mx, my, 8 + 30 * f);
        grd.addColorStop(0, `rgba(255,255,255,${((1 - f) * 0.9).toFixed(3)})`);
        grd.addColorStop(0.4, rgba(C.magenta, (1 - f) * 0.65));
        grd.addColorStop(1, 'rgba(255,42,133,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(mx, my, 8 + 30 * f, 0, Math.PI * 2); ctx.fill();
      }
    }

    /* 内环 */
    ctx.save();
    ctx.strokeStyle = rgba(C.gold, 0.95);
    ctx.lineWidth = 2.4;
    ctx.shadowBlur = 10;
    ctx.shadowColor = C.gold;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    const t1 = reduceMotion ? 0.4 : (now * 0.45) % 1;
    const a1 = t1 * Math.PI * 2;
    arrowHead(ctx, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, a1 - Math.PI / 2, 6.5, C.gold);

    /* 奇点 */
    const grd2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16);
    grd2.addColorStop(0, 'rgba(255,255,255,.9)');
    grd2.addColorStop(0.3, rgba(C.red, 0.9));
    grd2.addColorStop(1, 'rgba(255,23,68,0)');
    ctx.fillStyle = grd2;
    ctx.beginPath(); ctx.arc(cx, cy, 17, 0, Math.PI * 2); ctx.fill();

    label(ctx, 'L外', cx - 18, cy - R * 0.78 - 18, shrink > 0.5 ? C.gold : C.cyan, 11.5, 'center');
    label(ctx, 'L⁻内', cx, cy + r + 16, C.gold, 11, 'center');
    if (sub === 2) {
      label(ctx, shrink > 0.5 ? `∮L外 = ∮L⁺内 = ${CIRC.toFixed(4)}` : '外边界正在收缩…',
        w / 2, 22, shrink > 0.5 ? C.gold : 'rgba(226,240,255,.8)', 12.5, 'center');
    }
  }

  /* ================= 右下：代数等式展开器 ================= */
  function buildRows() {
    const step = STEPS[state.step];
    ui.rows.innerHTML = '';
    state.rowsShown = step.rows.map(() => false);
    step.rows.forEach((row, i) => {
      const div = document.createElement('div');
      div.className = 'eq';
      div.dataset.at = row[0];
      div.innerHTML = row[1];
      div.dataset.index = i;
      ui.rows.appendChild(div);
    });
    ui.phaseTag.textContent = step.tag;
    ui.sceneNote.textContent = step.note;
    ui.microCaption.textContent = step.caption;
    ui.algebraHint.textContent = step.hint;
    updateChips();
  }

  function updateRows() {
    const nodes = ui.rows.children;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const at = parseFloat(node.dataset.at);
      const want = state.p >= at;
      if (want && !state.rowsShown[i]) {
        node.classList.add('is-shown', 'is-flash');
        state.rowsShown[i] = true;
        setTimeout(() => node.classList.remove('is-flash'), 700);
      } else if (!want && state.rowsShown[i]) {
        node.classList.remove('is-shown');
        state.rowsShown[i] = false;
      }
    }
  }

  /* ================= 底部监视器 ================= */
  function dashState() {
    const s = state.step, p = state.p;
    const gd = gridData();
    const err = Math.abs(gd.sum - AREA1) / Math.abs(AREA1) * 100;
    const out = {
      lineLabel: '∮<sub>L</sub> <b>F</b>·d<b>r</b>',
      areaLabel: '∬<sub>D</sub> (∂Q/∂x − ∂P/∂y) dA',
      line: 0, area: 0, ref: LINE1, badge: '', badgeCls: '',
      topo: '单连通闭合', cancel: 0, err: err.toFixed(2) + '%'
    };

    if (s <= 3) {                                     /* 阶段 1 */
      out.ref = LINE1;
      if (s === 0) {
        out.line = LINE1 * easeOut(p);
        out.badge = '沿 L 累加做功…';
        out.badgeCls = 'is-warn';
      } else if (s === 1) {
        out.line = LINE1;
        out.badge = '网格已生成，等待面积累加';
        out.badgeCls = 'is-warn';
      } else if (s === 2) {
        out.line = LINE1;
        out.badge = '四边差分 ⇒ (∂Q/∂x − ∂P/∂y) dA';
        out.badgeCls = 'is-warn';
      } else {
        out.line = LINE1;
        out.area = AREA1 * clamp(p / 0.9);
        out.cancel = Math.round(clamp((p - 0.34) / 0.4) * 100);
        out.badge = p > 0.9
          ? `| ∮ − ∬ | < 1e−9 ✓ 完全相等`
          : '公共边抵消中…';
        out.badgeCls = p > 0.9 ? 'is-ok' : 'is-warn';
      }
      return out;
    }

    if (s <= 6) {                                     /* 阶段 2 */
      out.ref = LOOP2;
      out.lineLabel = '∮<sub>L₁+L₂</sub> <b>F</b>·d<b>r</b>';
      out.topo = s === 4 ? '非闭合 · 缺边界' : '非闭合 → 补线闭合';
      if (s === 4) {
        out.line = null; out.area = null;
        out.badge = '∬D 不存在：边界未闭合';
        out.badgeCls = 'is-bad';
        out.err = '—';
      } else if (s === 5) {
        out.line = LOOP2 * clamp(p / 0.55);
        out.area = LOOP2 * clamp((p - 0.55) / 0.35);
        out.badge = p > 0.9 ? 'L₁ + L₂ 闭合 ⇒ ∬D 就绪' : '补线进行中…';
        out.badgeCls = p > 0.9 ? 'is-ok' : 'is-warn';
        out.err = '—';
      } else {
        out.line = LOOP2; out.area = LOOP2;
        out.badge = `∮ = ∬ = ${LOOP2.toFixed(4)} ✓`;
        out.badgeCls = 'is-ok';
        out.err = '—';
      }
      return out;
    }

    /* 阶段 3 */
    out.ref = CIRC;
    out.lineLabel = '∮<sub>L外</sub> <b>F</b>·d<b>r</b>';
    out.areaLabel = '∬<sub>D′</sub> 0 dσ';
    out.topo = '复连通 · 含奇点';
    out.err = '—';
    if (s === 7) {
      out.line = null; out.area = null;
      out.badge = '偏导数不连续：公式失效';
      out.badgeCls = 'is-bad';
    } else if (s === 8) {
      out.line = CIRC * clamp(p / 0.4); out.area = 0;
      out.badge = '原点外旋度 ≡ 0';
      out.badgeCls = 'is-warn';
    } else if (s === 9) {
      out.line = CIRC; out.area = 0;
      out.cancel = Math.round(clamp((p - 0.1) / 0.6) * 100);
      out.badge = p > 0.7 ? '∫C进 + ∫C出 = 0 ✓' : '割线一进一出相消中…';
      out.badgeCls = p > 0.7 ? 'is-ok' : 'is-warn';
    } else {
      out.line = CIRC; out.area = 0; out.cancel = 100;
      out.badge = `∮L外 = ∮L⁺内 = ${CIRC.toFixed(4)} ✓`;
      out.badgeCls = 'is-ok';
    }
    return out;
  }

  let lastDash = '';
  function updateDash() {
    const d = dashState();
    const pct = v => v === null ? 0 : clamp(Math.abs(v) / d.ref) * 100;
    const key = [d.line, d.area, d.badge, d.topo, d.cancel, d.err, d.lineLabel].join('|');
    if (key !== lastDash) {
      lastDash = key;
      ui.gLineLabel.innerHTML = d.lineLabel;
      ui.gAreaLabel.innerHTML = d.areaLabel;
      ui.gLineValue.textContent = d.line === null ? '—' : d.line.toFixed(4);
      ui.gAreaValue.textContent = d.area === null ? '—' : d.area.toFixed(4);
      ui.gLineFill.style.width = pct(d.line).toFixed(1) + '%';
      ui.gAreaFill.style.width = pct(d.area).toFixed(1) + '%';
      ui.badge.textContent = d.badge;
      ui.badge.className = 'equation-badge ' + d.badgeCls;
      ui.slotTopo.textContent = d.topo;
      ui.slotErr.textContent = d.err;
      ui.cancelVal.textContent = d.cancel + '%';
      ui.cancelFill.style.width = d.cancel + '%';
      ui.slotNVal.textContent = state.n + '×' + state.n;
    }
  }

  /* ================= 步骤 / 进度 ================= */
  function globalProgress() {
    return clamp((CUM[state.step] + state.p * STEPS[state.step].dur) / TOTAL);
  }

  function seekGlobal(g) {
    const t = clamp(g) * TOTAL;
    let i = STEPS.length - 1;
    for (let k = 0; k < STEPS.length; k++) {
      if (t < CUM[k] + STEPS[k].dur) { i = k; break; }
    }
    state.step = i;
    state.p = clamp((t - CUM[i]) / STEPS[i].dur);
    buildRows();
    updateRows();
  }

  function gotoStep(i, keepPlaying) {
    state.step = clamp(i, 0, STEPS.length - 1);
    state.p = 0;
    if (keepPlaying !== undefined) state.playing = keepPlaying;
    buildRows();
    updateRows();
    lastDash = '';
  }

  function buildChips() {
    ui.chips.innerHTML = '';
    STEPS.forEach((st, i) => {
      if (i > 0 && st.phase !== STEPS[i - 1].phase) {
        const gap = document.createElement('span');
        gap.className = 'chip chip-gap';
        gap.textContent = '│';
        ui.chips.appendChild(gap);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.index = i;
      b.dataset.phase = st.phase;
      b.textContent = `${st.label} ${st.short}`;
      b.title = st.note;
      b.addEventListener('click', () => { gotoStep(i); });
      ui.chips.appendChild(b);
    });
  }

  function updateChips() {
    Array.prototype.forEach.call(ui.chips.children, el => {
      if (el.dataset && el.dataset.index !== undefined) {
        el.classList.toggle('is-active', Number(el.dataset.index) === state.step);
      }
    });
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function updateTransport() {
    const g = globalProgress();
    if (!state.scrub) ui.timeline.value = String(Math.round(g * 1000));
    ui.time.textContent = `${fmtTime(g * TOTAL)} / ${fmtTime(TOTAL)}`;
    ui.play.textContent = state.playing ? '❚❚ 暂停' : '▶ 播放';
  }

  /* ================= 控件绑定 ================= */
  function bindControls() {
    ui.play.addEventListener('click', () => {
      if (!state.playing && state.step === STEPS.length - 1 && state.p >= 1) gotoStep(0);
      state.playing = !state.playing;
      updateTransport();
    });
    ui.prev.addEventListener('click', () => gotoStep(state.step - 1));
    ui.next.addEventListener('click', () => {
      if (state.step < STEPS.length - 1) gotoStep(state.step + 1);
      else { state.p = 1; state.playing = false; }
    });
    ui.restart.addEventListener('click', () => gotoStep(0));
    ui.speed.addEventListener('change', () => { state.speed = Number(ui.speed.value) || 1; });
    ui.timeline.addEventListener('pointerdown', () => { state.scrub = true; });
    window.addEventListener('pointerup', () => { state.scrub = false; });
    ui.timeline.addEventListener('input', () => {
      seekGlobal(Number(ui.timeline.value) / 1000);
      lastDash = '';
    });
    ui.slotN.addEventListener('input', () => {
      state.n = Number(ui.slotN.value) || M.GRID.n;
      gridCache = null;
      lastDash = '';
    });
    document.addEventListener('keydown', e => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); ui.play.click(); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); ui.next.click(); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); ui.prev.click(); }
      else if (e.code === 'Home') { e.preventDefault(); gotoStep(0); }
    });
  }

  /* ================= 主循环 ================= */
  function render(now) {
    const phase = STEPS[state.step].phase;
    resizeCanvas(canvasLeft, canvasLeft.parentElement, sizes.left);
    resizeCanvas(canvasMicro, canvasMicro.parentElement, sizes.micro);

    const V = makeView(DOMAINS[phase], sizes.left.w, sizes.left.h);
    drawBackdrop(ctxL, sizes.left.w, sizes.left.h);
    drawAxes(ctxL, V);
    drawFieldLines(ctxL, V, phase === 3 ? 'singular' : 'smooth', now);
    if (phase === 1) drawPhase1(ctxL, V, now, state.step, state.p);
    else if (phase === 2) drawPhase2(ctxL, V, now, state.step - 4, state.p);
    else drawPhase3(ctxL, V, now, state.step - 7, state.p);

    drawMicro(ctxM, sizes.micro.w, sizes.micro.h, now, state.step, state.p);

    updateRows();
    updateDash();
    updateTransport();
  }

  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    state.time = now / 1000;

    if (state.playing) {
      state.p += dt * state.speed / STEPS[state.step].dur;
      let guard = 0;
      while (state.p >= 1 && guard++ < 40) {
        if (state.step < STEPS.length - 1) {
          state.p -= 1;
          state.step += 1;
          buildRows();
          lastDash = '';
        } else {
          state.p = 1;
          state.playing = false;
          break;
        }
      }
    }
    render(state.time);
    requestAnimationFrame(frame);
  }

  /* 通过 ?step=1.4&p=0.6 直接跳到某一步（便于分享与课堂定位） */
  function applyQuery() {
    const q = new URLSearchParams(location.search);
    const s = q.get('step');
    if (s === null) return;
    const i = STEPS.findIndex(st => st.label === s);
    if (i < 0) return;
    state.step = i;
    state.p = clamp(Number(q.get('p')) || 0);
    state.playing = false;
    buildRows();
    updateRows();
    lastDash = '';
  }

  function init() {
    buildChips();
    buildRows();
    bindControls();
    applyQuery();
    updateTransport();
    updateDash();
    if (reduceMotion) ui.play.textContent = '▶ 播放';
    requestAnimationFrame(frame);
  }

  init();
})();
