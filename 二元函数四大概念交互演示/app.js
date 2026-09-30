/**
 * 二元函数四大概念交互演示 —— 连续 / 偏导存在 / 可微 / 偏导连续
 *
 * 架构：参数驱动场景 (parameter-driven scene)
 *   叙事节拍只对 par(几何参数) 与 V(可见度权重) 做 GSAP 补间；
 *   每帧渲染循环读取这些参数重算全部动态图元，保证 60fps 连续演化。
 */
(function () {
  'use strict';

  /* ==================================================================
   * 0 · 常量与工具
   * ================================================================== */
  const SEG = 140;                       // 曲面网格分辨率
  const RING_N = 96;                     // 邻域边界环采样数
  const RHO_N = 48;                      // ρ 曲面投影线采样数
  const UP = new THREE.Vector3(0, 1, 0);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  function fmt(v, d) {
    if (!isFinite(v)) return '—';
    let s = v.toFixed(d);
    if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
    return s;
  }
  const R45 = Math.SQRT1_2;
  // 数学 (x,y,h) -> 世界 (x, h, -y)
  const w = (x, y, h) => new THREE.Vector3(x, h, -y);

  /* ==================================================================
   * 1 · 函数库
   * ================================================================== */
  const FUNCS = {
    base: {
      key: 'base', label: '基准曲面',
      tex: 'f = 0.13x² + 0.10y² + 0.08xy + 0.34x − 0.26y + 0.65',
      L: 1.22,
      f: (x, y) => 0.13 * x * x + 0.10 * y * y + 0.08 * x * y + 0.34 * x - 0.26 * y + 0.65,
      fx: (x, y) => 0.26 * x + 0.08 * y + 0.34,
      fy: (x, y) => 0.20 * y + 0.08 * x - 0.26,
      p: { x: 0.35, y: -0.28 }
    },
    ce1: {
      key: 'ce1', label: '反例一 · xy/(x²+y²)',
      tex: 'f = xy/(x²+y²) , f(0,0)=0',
      L: 1.0,
      f: (x, y) => { const s = x * x + y * y; return s < 1e-10 ? 0 : x * y / s; },
      fx: (x, y) => { const s = x * x + y * y; return s < 1e-10 ? 0 : y * (y * y - x * x) / (s * s); },
      fy: (x, y) => { const s = x * x + y * y; return s < 1e-10 ? 0 : x * (x * x - y * y) / (s * s); },
      p: { x: 0, y: 0 }
    },
    ce2: {
      key: 'ce2', label: '反例二 · xy/√(x²+y²)',
      tex: 'f = xy/√(x²+y²) , f(0,0)=0',
      L: 1.0,
      f: (x, y) => { const r = Math.hypot(x, y); return r < 1e-10 ? 0 : x * y / r; },
      fx: (x, y) => { const r = Math.hypot(x, y); return r < 1e-10 ? 0 : y * y * y / (r * r * r); },
      fy: (x, y) => { const r = Math.hypot(x, y); return r < 1e-10 ? 0 : x * x * x / (r * r * r); },
      p: { x: 0, y: 0 }
    },
    ce3: {
      key: 'ce3', label: '反例三 · ρ²sin(1/ρ)',
      tex: 'f = (x²+y²)·sin(1/√(x²+y²))',
      L: 0.82,
      f: (x, y) => { const r = Math.hypot(x, y); return r < 1e-9 ? 0 : r * r * Math.sin(1 / r); },
      fx: (x, y) => { const r = Math.hypot(x, y); return r < 1e-9 ? 0 : 2 * x * Math.sin(1 / r) - (x / r) * Math.cos(1 / r); },
      fy: (x, y) => { const r = Math.hypot(x, y); return r < 1e-9 ? 0 : 2 * y * Math.sin(1 / r) - (y / r) * Math.cos(1 / r); },
      p: { x: 0, y: 0 }
    }
  };
  let FN = FUNCS.base;

  /* ==================================================================
   * 2 · 参数系统
   *   par —— 连续几何量（每帧由渲染循环求值，不直接补间三维对象）
   *   V   —— 图层权重 0~1（每帧换算为材质透明度 / 可见性）
   * ================================================================== */
  const par = {
    approach: 0,   // 第一幕：多路径汇聚进度
    ring: 0.86,    // 邻域 / 观察半径（第一幕收缩、第三幕缩放实验共用）
    errAng: Math.PI / 4, // 采样点 Q 的方位角
    pulse: 0,      // P 点落位脉冲
    sx: 1, sy: 1,  // 两张垂直截面的切入进度
    secT: 1, secAx: 0, // 截面逼近点的位移与方向(0=x 刀, 1=y 刀)
    planeGrow: 1,  // 候选切平面展开倍率
    tanLen: 0.42,  // 切线半长
    walkT: 0, walkMode: null, // 邻域漫步进度与模式('loop' | 'radial')
    ceS: 0.9, ceDrop: 0,     // 反例一：y=x 路径点半径与"断崖"坠落量
    surfAlpha: 0.97,         // 曲面不透明度
    surfDim: 0.15,           // 曲面外围降权强度（着色器 uniform）
    boundGrow: 1             // 反例夹逼锥面 / 抛物面的展开倍率
  };

  // 图层：曲面与稀疏网格 / 参照网格与坐标轴 / P 点 / 多路径 / 邻域 / 截面 / 切线 / 切平面 / 误差 / 斜率场 / 夹逼面 / 反例
  const V = {
    surface: 1, mesh: 0.4, grid: 0.62, pMark: 1, axis: 1,
    paths: 0, pathPts: 0, pathLbl: 0,
    patchG: 0, patchS: 0, ringLbl: 0,
    secY: 0, secX: 0, curveY: 0, curveX: 0, secQ: 0, secant: 0,
    tanX: 0, tanY: 0, ghost: 0,
    planeT: 0, planeEdge: 0,
    errR: 0, errPt: 0, rhoL: 0,
    gap: 0, trail: 0, field: 0, cone: 0,
    cePath: 0, ceRef: 0, angle: 0
  };

  const CAM = { r: 4.9, th: 0.86, ph: 0.75, bx: 0, by: 0.55, bz: 0, follow: 0 };
  const camTarget = new THREE.Vector3();

  const ST = {
    px: 0, py: 0, h: 0, fx: 0, fy: 0,
    sx: 0, sy: 0, sh: 0, sLen: 0,
    qx: 0, qy: 0, qh: 0, ph: 0, rho: 0, R: 0, ratio: 0,
    ax: 0, ay: 0, ah: 0,
    gx: 0, gy: 0, gxh: 0, gyh: 0, gapX: 0, gapY: 0
  };
  const RO = { fp: 0, fx: 0, fy: 0, rho: 0, R: 0, ratio: 0, fq: 0, hp: 0, sec: 0, pr: 0 };
  const DIGITS = { fp: 3, fx: 3, fy: 3, rho: 3, R: 4, ratio: 4, fq: 3, hp: 3, sec: 3, pr: 3 };

  /* ==================================================================
   * 3 · DOM
   * ================================================================== */
  const $ = (id) => document.getElementById(id);
  const elStage = $('stage-container');
  const elPanel = $('panel-content');
  const elLabels = $('labels');
  const elDeck = $('deck');
  const elGraph = $('graph');
  const elGraphBox = $('graph-box');
  const elSparkWrap = $('spark-wrap');
  const elRatioFill = $('ratio-fill');
  const elRatioBlock = $('ratio-block');
  const elSparkX = $('spark-x');
  const elSparkY = $('spark-y');

  /* ==================================================================
   * 4 · Three.js 场景
   * ================================================================== */
  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1.6, 0.02, 90);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d5cc, 0.95));
  const key1 = new THREE.DirectionalLight(0xffffff, 0.42); key1.position.set(2.4, 4.2, 2.6); scene.add(key1);
  const key2 = new THREE.DirectionalLight(0xffffff, 0.18); key2.position.set(-3.0, 1.6, -2.2); scene.add(key2);

  const G = {};
  const LAYERS = [];
  function reg(obj, key, base, custom) { LAYERS.push({ obj, key, base: base === undefined ? 1 : base, custom }); }

  function stdMat(color, o) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color, roughness: 0.62, metalness: 0.02,
      transparent: true, opacity: 1, side: THREE.DoubleSide
    }, o || {}));
  }
  function beamMesh(r, color, o) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10, 1, false), stdMat(color, o));
    m.userData.len = 0;
    return m;
  }
  // 标注图层：关闭深度测试，保证切线 / 参照线不被曲面遮挡
  function overlay(obj, order) {
    if (obj.material) { obj.material.depthTest = false; obj.material.depthWrite = false; }
    obj.renderOrder = order;
    return obj;
  }
  const _d = new THREE.Vector3();
  function setBeam(mesh, a, b) {
    _d.subVectors(b, a);
    const len = _d.length();
    mesh.position.copy(a).addScaledVector(_d, 0.5);
    if (len < 1e-6) { mesh.scale.set(1, 1e-6, 1); return; }
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(UP, _d.normalize());
    mesh.userData.len = len;
  }
  function tubeMesh(r, color, o) {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), stdMat(color, o));
    m.userData.r = r;
    return m;
  }
  function setTube(mesh, pts) {
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.02);
    const geo = new THREE.TubeGeometry(curve, Math.min(pts.length * 2, 260), mesh.userData.r, 7, false);
    if (mesh.geometry) mesh.geometry.dispose();
    mesh.geometry = geo;
  }
  function ribbonMesh(color, o) {
    return new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(Object.assign({
      color, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false
    }, o || {})));
  }
  function setRibbon(mesh, pts, half, lift) {
    const n = pts.length;
    const pos = new Float32Array(n * 6);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
      let tx = b.x - a.x, ty = b.y - a.y;
      const L0 = Math.hypot(tx, ty) || 1; tx /= L0; ty /= L0;
      const nx = -ty * half, ny = tx * half;
      const ax = p.x + nx, ay = p.y + ny, bx = p.x - nx, by = p.y - ny;
      pos[i * 6 + 0] = ax; pos[i * 6 + 1] = lift ? lift(ax, ay) : 0.0016; pos[i * 6 + 2] = -ay;
      pos[i * 6 + 3] = bx; pos[i * 6 + 4] = lift ? lift(bx, by) : 0.0016; pos[i * 6 + 5] = -by;
      if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    if (mesh.geometry) mesh.geometry.dispose();
    mesh.geometry = geo;
  }
  /** 上下对称的参数化包络面（锥面 / 抛物面），用于反例的夹逼证明 */
  function paramSurface(fn, rhoMax, nU, nV) {
    const pos = [], idx = [];
    for (let i = 0; i <= nU; i++) {
      const rho = rhoMax * (i / nU);
      for (let j = 0; j <= nV; j++) {
        const th = (j / nV) * TAU, c = Math.cos(th), s = Math.sin(th);
        const x = rho * c, y = rho * s, h = fn(rho);
        pos.push(x, h, -y, x, -h, -y);
      }
    }
    const W2 = nV + 1;
    for (let i = 0; i < nU; i++) for (let j = 0; j < nV; j++) {
      const a = (i * W2 + j) * 2, b = a + 1, c2 = a + 2, d = a + 3;
      idx.push(a, c2, b, b, c2, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    return geo;
  }

  /* ---------- 场景构建 ---------- */
  let L = 1.22, ZT = 1.8;
  const TRAIL_MAX = 200;

  function buildStage() {
    G.grid = overlay(new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xCFCBC2, transparent: true, opacity: 0.5 })), 1);
    G.axes = overlay(new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9C968C, transparent: true, opacity: 0.85 })), 1);
    scene.add(G.grid, G.axes);

    G.surface = new THREE.Mesh(new THREE.BufferGeometry(), stdMat(0x9FB4CC, { depthWrite: true, roughness: 1.0, metalness: 0 }));
    G.surface.material.onBeforeCompile = (sh) => {
      sh.uniforms.uFocus = { value: new THREE.Vector3(0, 0, 0) };
      sh.uniforms.uDim = { value: 0 };
      sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vWP = (modelMatrix * vec4(transformed,1.0)).xyz;'
      );
      sh.fragmentShader = 'uniform vec3 uFocus; uniform float uDim; varying vec3 vWP;\n' + sh.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n' +
        '  float dF = length(vWP - uFocus) / 1.7;\n' +
        '  diffuseColor.rgb *= mix(1.0, mix(1.14, 0.58, smoothstep(0.04, 0.92, dF)), uDim);'
      );
      G.surface.userData.sh = sh;
    };
    G.mesh = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7C8A9A, transparent: true, opacity: 0.16 }));
    scene.add(G.surface, G.mesh);

    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RING_N * 3), 3));
    G.ringLine = new THREE.LineLoop(rg, new THREE.LineBasicMaterial({ color: 0x2563EB, transparent: true, opacity: 0.85 }));
    G.patchS = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x38BDF8, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    scene.add(G.ringLine, G.patchS);

    G.pDot = new THREE.Mesh(new THREE.SphereGeometry(0.032, 20, 14), stdMat(0x1C1917, { roughness: 0.4 }));
    G.pRing = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.0045, 8, 40), new THREE.MeshBasicMaterial({ color: 0x1C1917, transparent: true, opacity: 0.32 }));
    G.pFoot = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.064, 4), new THREE.MeshBasicMaterial({ color: 0x1C1917, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
    G.pFoot.rotation.x = -Math.PI / 2; G.pFoot.rotation.z = Math.PI / 4; overlay(G.pFoot, 12);
    G.pDrop = overlay(beamMesh(0.0038, 0x1C1917, { opacity: 0.13, depthWrite: false }), 11);
    scene.add(G.pDot, G.pRing, G.pFoot, G.pDrop);

    G.secY = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x60A5FA, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
    G.secX = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x34D399, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
    scene.add(G.secY, G.secX);

    G.curveY = tubeMesh(0.0115, 0x2563EB);
    G.curveX = tubeMesh(0.0115, 0x059669);
    G.secant = overlay(beamMesh(0.008, 0x7C3AED, { opacity: 0.75 }), 20);
    G.tanX = overlay(beamMesh(0.0105, 0x2563EB, { roughness: 0.45 }), 22);
    G.tanY = overlay(beamMesh(0.0105, 0x059669, { roughness: 0.45 }), 22);
    G.gapX = overlay(beamMesh(0.0062, 0xB45309, { opacity: 0.7, depthWrite: false }), 11);
    G.gapY = overlay(beamMesh(0.0062, 0xB45309, { opacity: 0.7, depthWrite: false }), 11);
    G.secBase = overlay(beamMesh(0.006, 0x7C3AED, { opacity: 0.5, depthWrite: false }), 11);
    G.secDrop = overlay(beamMesh(0.006, 0x7C3AED, { opacity: 0.4, depthWrite: false }), 11);
    G.secQDot = new THREE.Mesh(new THREE.SphereGeometry(0.027, 18, 12), stdMat(0x7C3AED));
    scene.add(G.curveY, G.curveX, G.secant, G.tanX, G.tanY, G.gapX, G.gapY, G.secBase, G.secDrop, G.secQDot);

    G.ghost = overlay(new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8A94A6, transparent: true, opacity: 0.3 })), 2);
    scene.add(G.ghost);

    G.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xF59E0B, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    G.pEdge = overlay(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0xB45309, transparent: true, opacity: 0.75 })), 18);
    scene.add(G.plane, G.pEdge);

    G.qDotS = new THREE.Mesh(new THREE.SphereGeometry(0.023, 18, 12), stdMat(0xDC2626, { roughness: 0.4 }));
    G.qDotP = new THREE.Mesh(new THREE.SphereGeometry(0.023, 18, 12), stdMat(0xF59E0B, { roughness: 0.4 }));
    G.qFoot = new THREE.Mesh(new THREE.RingGeometry(0.038, 0.052, 24), new THREE.MeshBasicMaterial({ color: 0x1C1917, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
    G.qFoot.rotation.x = -Math.PI / 2; overlay(G.qFoot, 12);
    G.errR = beamMesh(0.0125, 0xDC2626, { roughness: 0.4 });
    G.rhoL = overlay(beamMesh(0.0075, 0xB45309, { opacity: 0.9 }), 12);
    const rg2 = new THREE.BufferGeometry();
    rg2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RHO_N * 3), 3));
    G.rhoS = new THREE.Line(rg2, new THREE.LineBasicMaterial({ color: 0xB45309, transparent: true, opacity: 0.8 }));
    scene.add(G.rhoS);
    G.trueDrop = overlay(beamMesh(0.0045, 0x8D8A85, { opacity: 0.24, depthWrite: false }), 11);
    G.predDrop = overlay(beamMesh(0.0045, 0x8D8A85, { opacity: 0.18, depthWrite: false }), 10);
    scene.add(G.qDotS, G.qDotP, G.qFoot, G.errR, G.rhoL, G.trueDrop, G.predDrop);

    G.paths = []; G.marks = [];
    const PCOL = [0x2563EB, 0xD97706, 0x7C3AED];
    for (let k = 0; k < 3; k++) {
      const rb = ribbonMesh(PCOL[k], { opacity: 0.6 });
      scene.add(rb); G.paths.push(rb);
      for (let m = 0; m < 3; m++) {
        const gDot = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), stdMat(PCOL[k], { roughness: 0.4 }));
        const sDot = new THREE.Mesh(new THREE.SphereGeometry(0.021, 14, 10), stdMat(0x1C1917, { roughness: 0.4 }));
        const con = overlay(beamMesh(0.005, 0x78716C, { opacity: 0.4, depthWrite: false }), 11);
        scene.add(gDot, sDot, con);
        G.marks.push({ gDot, sDot, con, k, m, o: 1 });
      }
    }

    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    tg.setDrawRange(0, 0);
    G.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0x2563EB, transparent: true, opacity: 0.6 }));
    G.trailDots = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), stdMat(0x2563EB, { opacity: 0.5 }));
    scene.add(G.trail, G.trailDots);
    TRAIL_PTS.length = 0;

    G.field = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      const bx = beamMesh(0.0042, 0x2563EB, { opacity: 0.7 });
      const by = beamMesh(0.0042, 0x059669, { opacity: 0.7 });
      g.add(bx, by); g.userData = { bx, by };
      G.field.add(g);
    }
    scene.add(G.field);

    G.cePath = tubeMesh(0.019, 0xDC2626, { roughness: 0.4 });
    G.ceRef = beamMesh(0.008, 0xDC2626, { opacity: 0.7 });
    G.ceDot = new THREE.Mesh(new THREE.SphereGeometry(0.031, 18, 12), stdMat(0xDC2626, { roughness: 0.4 }));
    G.ceDrop = beamMesh(0.005, 0xDC2626, { opacity: 0.4, depthWrite: false });
    G.ceJump = beamMesh(0.015, 0xDC2626, { opacity: 0.85 });
    scene.add(G.cePath, G.ceRef, G.ceDot, G.ceDrop, G.ceJump);
    G.bound = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x0891B2, wireframe: true, transparent: true, opacity: 0.2 }));
    scene.add(G.bound);
  }

  function regLayers() {
    reg(G.surface, 'surface', 1, v => { G.surface.material.opacity = v * par.surfAlpha; G.surface.visible = v > 0.004; });
    reg(G.mesh, 'mesh', 1, v => { G.mesh.material.opacity = v * 0.24; G.mesh.visible = v > 0.004; });
    reg(G.grid, 'grid', 1, v => { G.grid.material.opacity = v * 0.34; });
    reg(G.axes, 'axis', 1, v => { G.axes.material.opacity = v * 0.85; });
    reg(G.pDot, 'pMark', 1, v => { G.pDot.material.opacity = v; });
    reg(G.pRing, 'pMark', 1, v => { G.pRing.material.opacity = v * 0.32; G.pRing.scale.setScalar(1 + 0.55 * par.pulse); });
    reg(G.pFoot, 'pMark', 1, v => { G.pFoot.material.opacity = v * 0.4; });
    reg(G.pDrop, 'pMark', 1, v => { G.pDrop.material.opacity = v * 0.13; });
    reg(G.ringLine, 'patchG', 1, v => { G.ringLine.material.opacity = v * 0.9; G.ringLine.visible = v > 0.004; });
    reg(G.patchS, 'patchS', 1, v => { G.patchS.material.opacity = v * 0.3; G.patchS.visible = v > 0.004; });
    reg(G.secY, 'secY', 1, v => { G.secY.material.opacity = v * 0.17; });
    reg(G.secX, 'secX', 1, v => { G.secX.material.opacity = v * 0.17; });
    reg(G.curveY, 'curveY', 1, v => { G.curveY.material.opacity = v; });
    reg(G.curveX, 'curveX', 1, v => { G.curveX.material.opacity = v; });
    reg(G.secant, 'secant', 1, v => { G.secant.material.opacity = v * 0.8; });
    reg(G.secBase, 'secQ', 1, v => { G.secBase.material.opacity = v * 0.6; });
    reg(G.secDrop, 'secQ', 1, v => { G.secDrop.material.opacity = v * 0.42; });
    reg(G.secQDot, 'secQ', 1, v => { G.secQDot.material.opacity = v; });
    reg(G.tanX, 'tanX', 1, v => { G.tanX.material.opacity = v; });
    reg(G.tanY, 'tanY', 1, v => { G.tanY.material.opacity = v; });
    reg(G.gapX, 'gap', 1, v => { G.gapX.material.opacity = v * 0.6; });
    reg(G.gapY, 'gap', 1, v => { G.gapY.material.opacity = v * 0.6; });
    reg(G.ghost, 'ghost', 1, v => { G.ghost.material.opacity = v * 0.34; });
    reg(G.plane, 'planeT', 1, v => { G.plane.material.opacity = v * 0.2; });
    reg(G.pEdge, 'planeEdge', 1, v => { G.pEdge.material.opacity = v * 0.7; });
    reg(G.errR, 'errR', 1, v => { G.errR.material.opacity = v; });
    reg(G.rhoL, 'rhoL', 1, v => { G.rhoL.material.opacity = v * 0.9; });
    reg(G.qDotS, 'errPt', 1, v => { G.qDotS.material.opacity = v; });
    reg(G.qDotP, 'errPt', 1, v => { G.qDotP.material.opacity = v; });
    reg(G.qFoot, 'errPt', 1, v => { G.qFoot.material.opacity = v * 0.4; });
    reg(G.trueDrop, 'errPt', 1, v => { G.trueDrop.material.opacity = v * 0.24; });
    reg(G.predDrop, 'errPt', 1, v => { G.predDrop.material.opacity = v * 0.18; });
    reg(G.trail, 'trail', 1, v => { G.trail.material.opacity = v * 0.6; });
    reg(G.trailDots, 'trail', 1, v => { G.trailDots.material.opacity = v * 0.5; });
    reg(G.cePath, 'cePath', 1, v => { G.cePath.material.opacity = v; });
    reg(G.ceRef, 'ceRef', 1, v => { G.ceRef.material.opacity = v * 0.7; });
    reg(G.ceDot, 'cePath', 1, v => { G.ceDot.material.opacity = v; });
    reg(G.ceDrop, 'cePath', 1, v => { G.ceDrop.material.opacity = v * 0.4; });
    reg(G.ceJump, 'ceRef', 1, v => { G.ceJump.material.opacity = v * 0.85; });
    reg(G.bound, 'cone', 1, v => { G.bound.material.opacity = v * 0.2; G.bound.visible = v > 0.004; });
    LAYERS.push({
      key: 'field', base: 1, obj: null,
      custom: v => {
        G.field.visible = v > 0.004;
        G.field.children.forEach(g => { g.children[0].material.opacity = v * 0.72; g.children[1].material.opacity = v * 0.72; });
      }
    });
    G.paths.forEach(rb => LAYERS.push({ key: 'paths', base: 1, obj: rb, custom: v => { rb.material.opacity = v * 0.95; } }));
    G.marks.forEach(m => LAYERS.push({
      key: 'pathPts', base: 1, obj: null,
      custom: v => {
        const o = v * m.o;
        m.gDot.material.opacity = o; m.sDot.material.opacity = o; m.con.material.opacity = o * 0.42;
        m.gDot.visible = m.sDot.visible = m.con.visible = v > 0.004 && o > 0.02;
      }
    }));
  }

  /* ---------- 函数切换 ---------- */
  function setFunction(key) {
    FN = FUNCS[key];
    L = FN.L;
    const geo = new THREE.PlaneGeometry(2 * L, 2 * L, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let j = 0; j <= SEG; j++) for (let i = 0; i <= SEG; i++) {
      const k = j * (SEG + 1) + i;
      pos.setY(k, FN.f(pos.getX(k), -pos.getZ(k)));
    }
    geo.computeVertexNormals();
    G.surface.geometry.dispose();
    G.surface.geometry = geo;

    const step = 7, lp = [];
    for (let i = 0; i <= SEG; i += step) for (let j = 0; j < SEG; j++) for (const jj of [j, j + 1]) {
      const k = jj * (SEG + 1) + i;
      lp.push(pos.getX(k), pos.getY(k), pos.getZ(k));
    }
    for (let j = 0; j <= SEG; j += step) for (let i = 0; i < SEG; i++) for (const ii of [i, i + 1]) {
      const k = j * (SEG + 1) + ii;
      lp.push(pos.getX(k), pos.getY(k), pos.getZ(k));
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    G.mesh.geometry.dispose(); G.mesh.geometry = wg;

    const N = 10, gp = [];
    for (let i = 0; i <= N; i++) {
      const t = -L + (2 * L) * (i / N);
      gp.push(-L, 0, -t, L, 0, -t, t, 0, -L, t, 0, L);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    G.grid.geometry.dispose(); G.grid.geometry = gg;
    const E = L + 0.14;
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.Float32BufferAttribute([-E, 0, 0, E, 0, 0, 0, 0, -E, 0, 0, E], 3));
    G.axes.geometry.dispose(); G.axes.geometry = ag;

    let mx = 0;
    for (let i = 0; i <= 48; i++) for (let j = 0; j <= 48; j++) {
      const x = -L + (2 * L) * (i / 48), y = -L + (2 * L) * (j / 48);
      mx = Math.max(mx, Math.abs(FN.f(x, y)));
    }
    ZT = Math.max(0.5, mx + 0.14);
    const pg = new THREE.PlaneGeometry(2 * L, ZT); pg.translate(0, ZT / 2, 0);
    G.secY.geometry.dispose(); G.secY.geometry = pg;
    const pg2 = new THREE.PlaneGeometry(2 * L, ZT);
    pg2.rotateY(Math.PI / 2); pg2.translate(0, ZT / 2, 0);
    G.secX.geometry.dispose(); G.secX.geometry = pg2;

    const cy = [], cx = [];
    for (let i = 0; i <= 80; i++) {
      const t = -L + 2 * L * (i / 80);
      cy.push(w(t, FN.p.y, FN.f(t, FN.p.y)));
      cx.push(w(FN.p.x, t, FN.f(FN.p.x, t)));
    }
    setTube(G.curveY, cy); setTube(G.curveX, cx);

    const pl = new THREE.PlaneGeometry(1.9, 1.9);
    G.plane.geometry.dispose(); G.plane.geometry = pl;
    G.pEdge.geometry.dispose(); G.pEdge.geometry = new THREE.EdgesGeometry(pl);

    const cp = [];
    for (let i = 0; i <= 60; i++) {
      const t = -L * 0.92 + 2 * L * 0.92 * (i / 60);
      cp.push(w(t, t, FN.f(t, t)));
    }
    setTube(G.cePath, cp);

    G.bound.geometry.dispose();
    G.bound.geometry = (key === 'ce2')
      ? paramSurface(r => 0.5 * r, 0.82, 12, 44)
      : paramSurface(r => r * r, 0.62, 12, 44);

    layoutField(); buildPaths(); buildGhost(); rebuildPatch(par.ring);
  }

  /* ---------- 曲面斑（极坐标网格，每帧按当前半径重建） ---------- */
  const PU = 4, PV = 44;
  function rebuildPatch(r) {
    let g = G.patchS.geometry;
    if (!g.attributes.position || g.attributes.position.count !== (PU + 1) * (PV + 1)) {
      const arr = new Float32Array((PU + 1) * (PV + 1) * 3);
      const idx = [];
      for (let i = 0; i < PU; i++) for (let j = 0; j < PV; j++) {
        const a = i * (PV + 1) + j, b = a + 1, c = a + PV + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      g.setIndex(idx);
      G.patchS.geometry.dispose(); G.patchS.geometry = g;
    }
    const P = FN.p, at = g.attributes.position;
    for (let i = 0; i <= PU; i++) for (let j = 0; j <= PV; j++) {
      const rho = r * (i / PU), th = (j / PV) * TAU;
      const x = P.x + rho * Math.cos(th), y = P.y + rho * Math.sin(th);
      at.setXYZ(i * (PV + 1) + j, x, FN.f(x, y) + 0.0025, -y);
    }
    at.needsUpdate = true;
  }

  /* ---------- 多路径（第一幕） ---------- */
  const PATH_DEFS = [
    { nm: '直线', pts: (P) => { const a = []; for (let i = 0; i <= 40; i++) { const t = i / 40; a.push({ x: lerp(P.x - 0.98, P.x, t), y: P.y }); } return a; } },
    { nm: '斜线', pts: (P) => { const a = []; for (let i = 0; i <= 40; i++) { const t = i / 40; a.push({ x: lerp(P.x - 0.66, P.x, t), y: lerp(P.y - 0.66, P.y, t) }); } return a; } },
    { nm: '曲线', pts: (P) => { const a = []; for (let i = 0; i <= 40; i++) { const t = i / 40; a.push({ x: P.x - 0.12 - 0.42 * Math.sin(Math.PI * t), y: lerp(P.y - 0.95, P.y, t) }); } return a; } }
  ];
  function buildPaths() {
    const P = FN.p;
    G.paths.forEach((rb, i) => setRibbon(rb, PATH_DEFS[i].pts(P), 0.014, (x, y) => FN.f(x, y) + 0.007));
  }

  function layoutField() {
    const P = FN.p;
    G.field.children.forEach((g, i) => {
      g.userData.x = P.x + ((i % 3) - 1) * 0.44;
      g.userData.y = P.y + (((i / 3) | 0) - 1) * 0.44;
    });
  }

  function buildGhost() {
    const P = FN.p, pts = [];
    for (let k = 0; k < 9; k++) {
      const th = (k / 9) * Math.PI;
      const c = Math.cos(th) * 0.92, s = Math.sin(th) * 0.92;
      pts.push(P.x - c, 0.0022, -(P.y - s), P.x + c, 0.0022, -(P.y + s));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    G.ghost.geometry.dispose(); G.ghost.geometry = g;
  }

  /* ---------- 邻域漫步轨迹 ---------- */
  const TRAIL_PTS = [];
  let trailLast = -1;
  function walkPos(t) {
    const P = FN.p;
    if (par.walkMode === 'radial') {
      const rho = 0.05 + 0.45 * t, th = 0.62;
      return { x: rho * Math.cos(th), y: rho * Math.sin(th) };
    }
    return {
      x: P.x + 0.44 * Math.sin(TAU * t) - 0.06 * Math.sin(2 * TAU * t),
      y: P.y + 0.38 * Math.sin(TAU * t + Math.PI / 3)
    };
  }
  function pushTrail() {
    if (!par.walkMode) return;
    if (trailLast >= 0 && Math.abs(par.walkT - trailLast) < 0.005) return;
    trailLast = par.walkT;
    const p = walkPos(par.walkT);
    const last = TRAIL_PTS[TRAIL_PTS.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.014) return;
    if (TRAIL_PTS.length < TRAIL_MAX) TRAIL_PTS.push(p);
    const at = G.trail.geometry.attributes.position;
    for (let i = 0; i < TRAIL_PTS.length; i++) {
      const q = TRAIL_PTS[i];
      at.setXYZ(i, q.x, FN.f(q.x, q.y) + 0.014, -q.y);
    }
    at.needsUpdate = true;
    G.trail.geometry.setDrawRange(0, TRAIL_PTS.length);
    G.trailDots.position.copy(w(TRAIL_PTS[0].x, TRAIL_PTS[0].y, FN.f(TRAIL_PTS[0].x, TRAIL_PTS[0].y) + 0.014));
  }
  function resetTrail() { TRAIL_PTS.length = 0; trailLast = -1; G.trail.geometry.setDrawRange(0, 0); }

  /* ==================================================================
   * 5 · 标签层
   * ================================================================== */
  const LABELS = [];
  function addLabel(cls, get, key, o) {
    const el = document.createElement('div');
    el.className = 'lbl ' + (cls || '');
    el.style.display = 'none';
    el.innerHTML = (o && o.html) || '';
    elLabels.appendChild(el);
    LABELS.push({ el, get, key, dx: (o && o.dx) || 0, dy: (o && o.dy) || 0, last: null, fn: (o && o.fn) || null });
  }
  let LW = 1, LH = 1;
  const _pv = new THREE.Vector3();
  function updateLabels() {
    for (const L of LABELS) {
      if (V[L.key] < 0.35) { if (L.el.style.display !== 'none') L.el.style.display = 'none'; continue; }
      const p = L.get();
      _pv.copy(p).project(camera);
      if (_pv.z > 1) { L.el.style.display = 'none'; continue; }
      if (L.el.style.display !== 'block') L.el.style.display = 'block';
      const lx = (_pv.x * 0.5 + 0.5) * LW + L.dx, ly = (-_pv.y * 0.5 + 0.5) * LH + L.dy;
      if (lx < 4 || lx > LW - 4 || ly < 4 || ly > LH - 4) { L.el.style.display = 'none'; continue; }
      L.el.style.left = lx + 'px';
      L.el.style.top = ly + 'px';
      if (L.fn) { const s = L.fn(); if (s !== L.last) { L.el.innerHTML = s; L.last = s; } }
    }
  }

  function buildLabels() {
    addLabel('', () => w(L + 0.17, 0, 0), 'axis', { html: 'x', dx: 8, dy: 10 });
    addLabel('', () => w(0, -L - 0.15, 0), 'axis', { html: 'y', dx: -7, dy: 12 });
    addLabel('', () => w(0, 0, 0), 'axis', { html: 'O', dx: -8, dy: 10 });
    addLabel('lbl-key', () => w(ST.px, ST.py, ST.h), 'pMark', { dx: -46, dy: -26, fn: () => (FN.p.x === 0 && FN.p.y === 0) ? 'P = (0,0)' : 'P' });
    addLabel('lbl-dot', () => w(ST.px, ST.py, ST.h), 'pMark', {});
    addLabel('lbl-amb', () => {
      const a = 0.45, x = ST.px + par.ring * Math.cos(a), y = ST.py + par.ring * Math.sin(a);
      return w(x, y, FN.f(x, y) + 0.035);
    }, 'ringLbl', { dx: 6, dy: 18, fn: () => 'r = ' + fmt(par.ring, 2) });
    ['直线', '斜线', '曲线'].forEach((nm, i) => {
      const p0 = PATH_DEFS[i].pts(FUNCS.base.p)[0];
      addLabel('', () => w(p0.x, p0.y, FUNCS.base.f(p0.x, p0.y) + 0.05), 'pathLbl', { dy: 15, html: nm + '路径' });
    });
    addLabel('lbl-key', () => {
      const x = (ST.sx + ST.px) / 2, y = (ST.sy + ST.py) / 2;
      return w(x, y, FN.f(x, y) + 0.07);
    }, 'secQ', { dy: 14, fn: () => (par.secAx === 0 ? 'Δx = ' : 'Δy = ') + fmt(ST.sLen, 2) });
    addLabel('lbl-key mono-serif', () => {
      const n = Math.sqrt(1 + ST.fx * ST.fx), L = par.tanLen * 1.22;
      return w(ST.px + L / n, ST.py, ST.h + L * ST.fx / n);
    }, 'tanX', { dy: -15, fn: () => 'f<sub>x</sub> = ' + fmt(ST.fx, 3) });
    addLabel('lbl-key mono-serif', () => {
      const n = Math.sqrt(1 + ST.fy * ST.fy), L = par.tanLen * 1.22;
      return w(ST.px, ST.py + L / n, ST.h + L * ST.fy / n);
    }, 'tanY', { dy: -15, fn: () => 'f<sub>y</sub> = ' + fmt(ST.fy, 3) });
    addLabel('lbl-amb', () => w(ST.gx, ST.gy, ST.gxh), 'gap', { dx: 34, dy: 21, fn: () => '仅 P 处相切　此处已分离 ' + fmt(ST.gapX, 3) });
    addLabel('lbl-key', () => w(ST.qx, ST.qy, 0.02), 'errPt', { dy: 16, html: 'Q' });
    addLabel('lbl-amb', () => {
      const x = (ST.qx + ST.px) / 2, y = (ST.qy + ST.py) / 2;
      return w(x, y, FN.f(x, y) + 0.07);
    }, 'rhoL', { dy: -19, fn: () => 'ρ = ' + fmt(ST.rho, 2) });
    addLabel('lbl-warn', () => w(ST.qx, ST.qy, (ST.qh + ST.ph) / 2), 'errR', { dx: 46, fn: () => 'R = ' + fmt(Math.abs(ST.R), 4) });
    addLabel('lbl-warn', () => w(ST.qx, ST.qy, ST.qh), 'angle', { dy: -17, fn: () => '夹角 ≈ ' + fmt(Math.atan(ST.ratio) * 180 / Math.PI, 1) + '°' });
    addLabel('lbl-warn', () => w(ST.ax * 0.55, ST.ay * 0.55, 0.02), 'cePath', { dy: 16, html: 'y = x' });
    addLabel('lbl-warn', () => w(ST.ax, ST.ay, 0.5), 'ceRef', { dx: 34, fn: () => '恒为 1/2' });
  }

  /* ==================================================================
   * 6 · 每帧更新
   * ================================================================== */
  function applyVis() {
    for (const l of LAYERS) {
      const v = V[l.key] * l.base;
      if (l.custom) l.custom(v);
      else if (l.obj) { l.obj.material.opacity = v; l.obj.visible = v > 0.004; }
    }
  }

  const _dx = new THREE.Vector3(1, 0, 0), _dy = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3();

  function updateGeometry() {
    const P = FN.p;
    const base = par.walkMode ? walkPos(par.walkT) : P;
    ST.px = base.x; ST.py = base.y;
    ST.h = FN.f(base.x, base.y);
    ST.fx = FN.fx(base.x, base.y);
    ST.fy = FN.fy(base.x, base.y);
    G.pDot.position.set(ST.px, ST.h, -ST.py);
    G.pRing.position.set(ST.px, ST.h, -ST.py);
    G.pRing.lookAt(camera.position);
    G.pFoot.position.set(ST.px, 0.002, -ST.py);
    setBeam(G.pDrop, new THREE.Vector3(ST.px, 0, -ST.py), w(ST.px, ST.py, ST.h));

    G.secY.position.set(0, 0, -(P.y + (1 - par.sy) * 1.7));
    G.secX.position.set(P.x + (1 - par.sx) * 1.7, 0, 0);

    const P0v = w(ST.px, ST.py, ST.h);
    const len = par.tanLen;
    _dx.set(1, ST.fx, 0).normalize();
    _dy.set(0, 1, -ST.fy).normalize();
    setBeam(G.tanX, P0v.clone().addScaledVector(_dx, -len), P0v.clone().addScaledVector(_dx, len));
    setBeam(G.tanY, P0v.clone().addScaledVector(_dy, -len), P0v.clone().addScaledVector(_dy, len));

    // 切线端点与曲面的落差：只在 P 处相切，其余处处分离
    const gx = par.tanLen * 0.82, gy = par.tanLen * 0.82;
    const xex = ST.px + gx, xey = ST.py, xeh = ST.h + gx * ST.fx;
    const yex = ST.px, yey = ST.py + gy, yeh = ST.h + gy * ST.fy;
    const gxS = FN.f(xex, xey) + 0.004, gyS = FN.f(yex, yey) + 0.004;
    setBeam(G.gapX, w(xex, xey, xeh), w(xex, xey, gxS));
    setBeam(G.gapY, w(yex, yey, yeh), w(yex, yey, gyS));
    ST.gapX = Math.abs(xeh - gxS); ST.gapY = Math.abs(yeh - gyS);
    ST.gx = xex; ST.gy = xey; ST.gxh = (xeh + gxS) / 2; ST.gyh = (yeh + gyS) / 2;

    _n.set(ST.fx, -1, -ST.fy).normalize();
    G.plane.scale.set(par.planeGrow, par.planeGrow, 1);
    G.plane.position.copy(P0v);
    G.plane.lookAt(P0v.clone().add(_n));
    G.plane.visible = par.planeGrow > 0.02 && V.planeT > 0.004;
    G.pEdge.scale.copy(G.plane.scale);
    G.pEdge.position.copy(G.plane.position);
    G.pEdge.quaternion.copy(G.plane.quaternion);
    G.pEdge.visible = par.planeGrow > 0.02 && V.planeEdge > 0.004;

    ST.sx = ST.px + (par.secAx === 0 ? par.secT : 0);
    ST.sy = ST.py + (par.secAx === 1 ? par.secT : 0);
    ST.sh = FN.f(ST.sx, ST.sy);
    ST.sLen = Math.abs(par.secT);
    G.secQDot.position.set(ST.sx, ST.sh, -ST.sy);
    setBeam(G.secant, P0v.clone(), w(ST.sx, ST.sy, ST.sh));
    setBeam(G.secBase, new THREE.Vector3(ST.px, 0.004, -ST.py), new THREE.Vector3(ST.sx, 0.004, -ST.sy));
    setBeam(G.secDrop, new THREE.Vector3(ST.sx, 0.004, -ST.sy), w(ST.sx, ST.sy, ST.sh));

    const rr = par.ring;
    ST.qx = ST.px + rr * Math.cos(par.errAng);
    ST.qy = ST.py + rr * Math.sin(par.errAng);
    ST.qh = FN.f(ST.qx, ST.qy);
    ST.ph = ST.h + ST.fx * (ST.qx - ST.px) + ST.fy * (ST.qy - ST.py);
    ST.R = ST.qh - ST.ph;
    ST.rho = rr;
    ST.ratio = rr > 1e-9 ? Math.abs(ST.R) / rr : 0;
    const dk = clamp(0.38 + 0.62 * (rr / 0.72), 0.32, 1.12);
    G.qDotS.scale.setScalar(dk);
    G.qDotP.scale.setScalar(dk);
    G.pDot.scale.setScalar(dk * (1 + 0.3 * par.pulse));
    G.secQDot.scale.setScalar(dk);
    G.qFoot.scale.setScalar(dk);
    G.pFoot.scale.setScalar(dk);
    G.qDotS.position.set(ST.qx, ST.qh, -ST.qy);
    G.qDotP.position.set(ST.qx, ST.ph, -ST.qy);
    G.qFoot.position.set(ST.qx, 0.0025, -ST.qy);
    setBeam(G.errR, w(ST.qx, ST.qy, ST.ph), w(ST.qx, ST.qy, ST.qh));
    setBeam(G.rhoL, new THREE.Vector3(ST.px, 0.005, -ST.py), new THREE.Vector3(ST.qx, 0.005, -ST.qy));
    const rsa = G.rhoS.geometry.attributes.position;
    for (let i = 0; i < RHO_N; i++) {
      const t = i / (RHO_N - 1);
      const x = lerp(ST.px, ST.qx, t), y = lerp(ST.py, ST.qy, t);
      rsa.setXYZ(i, x, FN.f(x, y) + 0.006, -y);
    }
    rsa.needsUpdate = true;
    G.rhoS.visible = V.rhoL > 0.004;
    G.rhoS.material.opacity = V.rhoL * 0.8;
    setBeam(G.trueDrop, new THREE.Vector3(ST.qx, 0.005, -ST.qy), w(ST.qx, ST.qy, ST.qh));
    setBeam(G.predDrop, new THREE.Vector3(ST.qx, 0.005, -ST.qy), w(ST.qx, ST.qy, ST.ph));
    const rc = ST.ratio < 0.03 ? 0x059669 : ST.ratio < 0.2 ? 0xD97706 : 0xDC2626;
    G.errR.material.color.setHex(rc);
    G.qDotS.material.color.setHex(rc);

    const rat = G.ringLine.geometry.attributes.position;
    for (let i = 0; i < RING_N; i++) {
      const th = (i / RING_N) * TAU;
      const x = ST.px + rr * Math.cos(th), y = ST.py + rr * Math.sin(th);
      rat.setXYZ(i, x, FN.f(x, y) + 0.004, -y);
    }
    rat.needsUpdate = true;
    rebuildPatch(rr);

    const PA = par.approach;
    for (const m of G.marks) {
      const pts = PATH_DEFS[m.k].pts(P);
      const delay = m.k * 0.07 + m.m * 0.11;
      const s = easeIO(clamp((PA - delay) / (1 - delay), 0, 1));
      const idx = s * (pts.length - 1);
      const i0 = Math.min(pts.length - 2, Math.floor(idx)), f0 = idx - i0;
      const x = lerp(pts[i0].x, pts[i0 + 1].x, f0), y = lerp(pts[i0].y, pts[i0 + 1].y, f0);
      const h = FN.f(x, y);
      m.gDot.position.set(x, 0.012, -y);
      m.sDot.position.set(x, h, -y);
      setBeam(m.con, new THREE.Vector3(x, 0.012, -y), w(x, y, h));
      m.o = 0.45 + 0.55 * (1 - s);
    }

    const s45 = par.ceS * R45;
    ST.ax = s45; ST.ay = s45;
    ST.ah = FN.f(ST.ax, ST.ay) * (1 - par.ceDrop);
    G.ceDot.position.set(ST.ax, ST.ah, -ST.ay);
    setBeam(G.ceDrop, new THREE.Vector3(ST.ax, 0.004, -ST.ay), w(ST.ax, ST.ay, ST.ah));
    setBeam(G.ceRef, w(0.08 * R45, 0.08 * R45, 0.5), w(0.78 * R45, 0.78 * R45, 0.5));
    setBeam(G.ceJump, w(0, 0, 0), w(0, 0, 0.5));

    G.bound.scale.setScalar(clamp(par.boundGrow, 0.001, 1.4));

    for (const g of G.field.children) {
      const x = g.userData.x, y = g.userData.y;
      const c = w(x, y, FN.f(x, y));
      const a = _n.clone().set(1, FN.fx(x, y), 0).normalize().multiplyScalar(0.125);
      const b = _n.clone().set(0, 1, -FN.fy(x, y)).normalize().multiplyScalar(0.125);
      g.position.copy(c);
      setBeam(g.userData.bx, c.clone().sub(a), c.clone().add(a));
      setBeam(g.userData.by, c.clone().sub(b), c.clone().add(b));
    }

    camTarget.set(
      CAM.bx + CAM.follow * ST.px,
      CAM.by + CAM.follow * ST.h * 0.8,
      CAM.bz + CAM.follow * (-ST.py)
    );
    const sp = Math.sin(CAM.ph);
    camera.position.set(
      camTarget.x + CAM.r * sp * Math.sin(CAM.th),
      camTarget.y + CAM.r * Math.cos(CAM.ph),
      camTarget.z + CAM.r * sp * Math.cos(CAM.th)
    );
    camera.lookAt(camTarget);

    const sh = G.surface.userData.sh;
    if (sh) {
      sh.uniforms.uDim.value = par.surfDim;
      sh.uniforms.uFocus.value.set(ST.px, ST.h, -ST.py);
    }

    RO.fp = ST.h; RO.fx = ST.fx; RO.fy = ST.fy;
    RO.rho = ST.rho; RO.R = ST.R; RO.ratio = ST.ratio;
    RO.fq = ST.qh; RO.hp = ST.ph; RO.sec = ST.sLen; RO.pr = Math.hypot(ST.px, ST.py);
  }

  /* ==================================================================
   * 7 · 解释区
   * ================================================================== */
  const CALL = { tip: ['tip', '几何直觉'], note: ['note', '要点'], imp: ['imp', '核心判据'], warn: ['warn', '反例警示'] };

  function inlineHTML(s) {
    const parts = String(s).split('$');
    let out = '', n = 0;
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) out += '<span class="kx" data-kx="' + (n++) + '">' + parts[i] + '</span>';
      else out += parts[i];
    }
    return out;
  }
  function hydrateKatex(root) {
    if (!window.katex) return;
    root.querySelectorAll('[data-kx]').forEach(sp => {
      katex.render(sp.textContent, sp, { throwOnError: false, strict: false });
    });
  }
  function katexBlock(l) {
    return '<div class="kx" data-kx="0">' + l + '</div>';
  }

  function buildPane(s) {
    let h = '';
    h += '<div class="flex items-center gap-2 stagger-layer">';
    h += '<span class="text-[10px] font-mono px-2 py-0.5 rounded-md border border-stone-200 bg-stone-50 text-stone-500">' + s.act + '</span>';
    if (s.cMode) h += '<span class="callout-c"><i></i>C 联动 · 解释层延展</span>';
    h += '</div>';
    h += '<h2 class="pane-q stagger-layer">' + inlineHTML(s.q) + '</h2>';
    if (s.body) h += '<p class="pane-body stagger-layer">' + inlineHTML(s.body) + '</p>';
    if (s.f && s.f.length) {
      h += '<div class="pane-f stagger-layer">';
      s.f.forEach(l => { h += katexBlock(l); });
      h += '</div>';
    }
    if (s.note) {
      const c = CALL[s.note[0]] || CALL.note;
      h += '<div class="pane-note ' + c[0] + ' stagger-layer"><span class="font-mono text-[9px] font-bold shrink-0 pt-[1px]">[' + c[1] + ']</span><span>' + inlineHTML(s.note[1]) + '</span></div>';
    }
    return h;
  }

  let activePaneTl = null;
  function renderPane(s) {
    const old = elPanel.querySelector('.pane:last-child');
    const pane = document.createElement('div');
    pane.className = 'pane';
    pane.innerHTML = buildPane(s);
    elPanel.appendChild(pane);
    hydrateKatex(pane);
    elPanel.scrollTop = 0;
    const layers = pane.querySelectorAll('.stagger-layer');
    const tl = gsap.timeline();
    tl.timeScale(State.speed);
    if (old) tl.to(old, { opacity: 0, y: -8, scale: 0.98, duration: 0.15, ease: 'power2.in', onComplete: () => old.remove() }, 0);
    const fbox = pane.querySelector('.pane-f');
    if (fbox) { gsap.set(fbox, { rotationY: 88 }); tl.to(fbox, { rotationY: 0, duration: 0.44, ease: 'expo.out' }, 0.06); }
    tl.to(pane, { opacity: 1, duration: 0.28, ease: 'power2.out' }, 0.1);
    tl.fromTo(layers, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.26, stagger: 0.05, ease: 'power3.out' }, 0.18);
    activePaneTl = tl;
  }

  function renderReadout(step) {
    const ro = step.ro || [['fp', 'f(P)'], ['fx', 'f<sub>x</sub>'], ['fy', 'f<sub>y</sub>'], ['rho', 'ρ'], ['R', 'R'], ['ratio', 'R/ρ']];
    elRatioBlock.style.display = ro.some(r => r[0] === 'ratio') ? '' : 'none';
    elSparkWrap.style.display = step.spark === true || step.spark === false ? '' : 'none';
    const grid = $('readout-grid');
    grid.innerHTML = ro.map(r => '<div class="ro hot" data-k="' + r[0] + '"><span class="ro-k">' + r[1] + '</span><span class="ro-v">—</span></div>').join('');
    grid.style.opacity = 0;
    gsap.to(grid, { opacity: 1, duration: 0.4, ease: 'power2.out' });
  }
  function updateReadout() {
    const cells = $('readout-grid').children;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i].querySelector('.ro-v');
      const k = cells[i].dataset.k;
      const s = fmt(RO[k], DIGITS[k] || 3);
      if (v.textContent !== s) v.textContent = s;
    }
    const r = RO.ratio;
    elRatioFill.style.width = (clamp(r / 0.6, 0, 1) * 100) + '%';
    elRatioFill.style.background = r < 0.03 ? 'rgba(5,150,105,.85)' : r < 0.2 ? 'rgba(217,119,6,.85)' : 'rgba(220,38,38,.85)';
  }

  let sparkX = [], sparkY = [], sparkLast = -1;
  function updateSpark() {
    if (sparkX.length < 2) return;
    const all = sparkX.concat(sparkY);
    let mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    if (mx - mn < 1e-6) { mx += 0.5; mn -= 0.5; }
    const pv = (mx - mn) * 0.18; mn -= pv; mx += pv;
    const y = (v) => (44 - (v - mn) / (mx - mn) * 40).toFixed(1);
    const px = (i, n) => (i / (n - 1) * 240).toFixed(1);
    elSparkX.setAttribute('points', sparkX.map((v, i) => px(i, sparkX.length) + ',' + y(v)).join(' '));
    elSparkY.setAttribute('points', sparkY.map((v, i) => px(i, sparkY.length) + ',' + y(v)).join(' '));
    const ln = $('spark').querySelector('line');
    ln.setAttribute('y1', y(0)); ln.setAttribute('y2', y(0));
  }
  function pushSpark() {
    if (!par.walkMode) return;
    if (sparkLast >= 0 && Math.abs(par.walkT - sparkLast) < 0.006) return;
    sparkLast = par.walkT;
    sparkX.push(ST.fx); sparkY.push(ST.fy);
    if (sparkX.length > 110) { sparkX.shift(); sparkY.shift(); }
    updateSpark();
  }
  function resetSpark() { sparkX = []; sparkY = []; sparkLast = -1; elSparkX.setAttribute('points', ''); elSparkY.setAttribute('points', ''); }

  /* ==================================================================
   * 8 · 顶部导航
   * ================================================================== */
  const navNodes = Array.prototype.slice.call(document.querySelectorAll('.cnode'));
  function setNav(idx, sec) {
    navNodes.forEach((n, i) => {
      n.classList.toggle('on', i === idx);
      n.classList.toggle('done', (idx >= 0 && i < idx) || idx > 3);
    });
    $('nav-sec').textContent = sec;
    $('nav-fill').style.width = (idx < 0) ? '0%' : (idx > 3 ? '100%' : (idx / 3 * 100) + '%');
  }

  /* ==================================================================
   * 9 · 叙事节拍
   * ================================================================== */
  const tw = (tl, o, v, d, e) => tl.to(o, Object.assign({ duration: d === undefined ? 0.6 : d, ease: e || 'power3.inOut' }, v));

  function applyVisStep(tl, s) {
    const t = {};
    Object.keys(V).forEach(k => { if (k !== 'axis' && !(k in s.vis) && s.keep.indexOf(k) < 0) t[k] = 0; });
    Object.assign(t, s.vis);
    tl.to(V, t, { duration: 0.55, ease: 'power2.inOut' }, 0);
  }
  function applyCam(tl, s) {
    if (!s.cam) return;
    const t = {};
    ['r', 'th', 'ph', 'follow', 'bx', 'by', 'bz'].forEach(k => { if (s.cam[k] !== undefined) t[k] = s.cam[k]; });
    tl.to(CAM, t, { duration: 1.25, ease: 'power2.inOut' }, 0);
  }
  const PF = [['fp', 'f(P)'], ['fx', 'f<sub>x</sub>'], ['fy', 'f<sub>y</sub>']];   // 常规三项读数
  const ERRRO = [['rho', 'ρ'], ['R', 'R'], ['ratio', 'R/ρ'], ['fq', 'f(Q)']];            // 误差实验读数

  const STEPS = [
    /* ==================== 第一幕 · 连续 ==================== */
    {
      id: 'a1-push', nav: 0, act: '第一幕 · 连续', hold: 2.6,
      q: '先贴近 $P$，看清「邻域」这件事',
      body: '连续性问的不是某一条路走得通不通，而是<b>整个邻域里所有可能的走法</b>，高度是不是都收敛到同一个值。',
      f: ['P\\big(x_0,\\ y_0,\\ f(x_0,y_0)\\big)'],
      note: ['tip', '<b>空间连续演化</b>：从这一幕到终幕，曲面、截面、切线、平面始终是同一张图，绝不切屏重置。'],
      keep: ['surface', 'mesh', 'grid', 'pMark'],
      vis: {},
      cam: { r: 3.5, th: 0.86, ph: 0.74, follow: 1, by: 0.32 },
      ro: PF,
      run(tl) { tw(tl, par, { surfDim: 0.85 }, 1.5); }
    },
    {
      id: 'a1-paths', nav: 0, act: '第一幕 · 连续', hold: 2.2,
      q: '三条完全不同的路，同一个终点',
      body: '直线、斜线、弯曲路径同时向 $P$ 汇聚，底面靠拢，<b>曲面上的高度必须同步收拢</b>。',
      f: ['(x,y)\\ \\longrightarrow\\ (x_0,y_0)'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'paths', 'pathPts', 'pathLbl'],
      vis: { paths: 0.9, pathPts: 1, pathLbl: 1 },
      cam: { r: 4.3, th: 0.86, ph: 0.78, follow: 0.55, by: 0.3 },
      ro: PF,
      run(tl) { tw(tl, par, { surfDim: 0.9, approach: 1 }, 3.2, 'power1.inOut'); }
    },
    {
      id: 'a1-shrink', nav: 0, act: '第一幕 · 连续', hold: 2.2,
      q: '邻域连续收缩：$r \\to r/2 \\to r/4$',
      body: '把圆域一层层压向中心，曲面斑块随之收成一个点——<b>连续是一场整体收缩，不挑方向</b>。',
      f: ['r \\ \\longrightarrow\\ \\tfrac r2\\ \\longrightarrow\\ \\tfrac r4\\ \\longrightarrow\\ 0'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'patchG', 'patchS'],
      vis: { patchG: 1, patchS: 0.9, ringLbl: 1 },
      ro: [['fp', 'f(P)'], ['rho', 'r'], ['ratio', 'R/ρ']],
      run(tl) {
        tw(tl, par, { approach: 0 }, 0.6);
        tl.to(par, { ring: 0.43, duration: 1.0, ease: 'power2.inOut' }, 0.6)
          .to(par, { duration: 0.6 })
          .to(par, { ring: 0.215, duration: 1.0, ease: 'power2.inOut' })
          .to(par, { duration: 0.55 });
      }
    },
    {
      id: 'a1-land', nav: 0, act: '第一幕 · 连续', hold: 3.0,
      q: '落位：这就是连续',
      body: '底面靠拢就必须高度靠拢。<b>任何一条路径都不允许出现第二种高度极限</b>——哪怕只破一条，连续就被击穿。',
      f: ['\\forall\\,(x,y)\\to(x_0,y_0):\\qquad f(x,y)\\to f(x_0,y_0)'],
      note: ['note', '连续性是<b>整体邻域</b>的性质。下面把视线收窄到两个方向——这正是偏导数的几何出身。'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'patchG', 'patchS'],
      vis: { patchG: 0.7, patchS: 0.45, ringLbl: 0.8 },
      cam: { r: 3.8, th: 0.86, ph: 0.76, follow: 1, by: 0.35 },
      ro: [['fp', 'f(P)'], ['rho', 'r'], ['ratio', 'R/ρ']],
      run(tl) {
        tw(tl, par, { surfDim: 0.5 }, 0.9);
        tl.to(par, { pulse: 1, duration: 0.5, ease: 'power2.out' }, 0.2)
          .to(par, { pulse: 0, duration: 0.6, ease: 'power2.in' });
      }
    },
    /* ---------- 转场 ---------- */
    {
      id: 't1', nav: 1, act: '连续 → 偏导存在', hold: 2.2,
      q: '把焦点从「整个邻域」收窄到「两个方向」',
      body: '两张垂直截面从外部平移切入，恰好正交——<b>这就是偏导数定义里的两个坐标轴方向</b>。',
      keep: ['surface', 'mesh', 'grid', 'pMark', 'secY', 'secX'],
      vis: { patchG: 0.2, patchS: 0.15, secY: 1, secX: 1 },
      cam: { r: 3.9, th: 0.9, ph: 0.76, follow: 1, by: 0.4 },
      ro: PF,
      run(tl) {
        tw(tl, par, { sx: 0, sy: 0 }, 0.1);
        tw(tl, par, { sx: 1, sy: 1 }, 1.4, 'power3.out');
        tw(tl, par, { surfDim: 0.75 }, 0.8);
      }
    },
    /* ==================== 第二幕 · 偏导存在 ==================== */
    {
      id: 'a2-x', nav: 1, act: '第二幕 · 偏导存在', hold: 2.8,
      q: '第一刀：沿 $y=y_0$ 切下去',
      body: '曲面被切成一条截线，截线上一点沿曲线逼近 $P$；<b>割线立起来，就是这个方向上的切线</b>。',
      f: ['f_x(x_0,y_0)=\\lim_{\\Delta x\\to 0}\\frac{f(x_0+\\Delta x,y_0)-f(x_0,y_0)}{\\Delta x}'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'secY', 'curveY', 'secQ', 'secant', 'tanX'],
      vis: { secY: 1, curveY: 1, secQ: 1, secant: 1, tanX: 0 },
      cam: { r: 3.2, th: 0.98, ph: 0.72, follow: 1, by: 0.4 },
      ro: [['fp', 'f(P)'], ['fx', 'f<sub>x</sub>'], ['sec', 'Δx']],
      run(tl) {
        tw(tl, par, { secAx: 0, secT: 1.05, tanLen: 0.34, surfAlpha: 0.68 }, 0.6);
        tl.to(par, { secT: 0, duration: 1.8, ease: 'power2.inOut' }, 0.5)
          .to(par, { duration: 0.5 })
          .to(V, { secant: 0 }, { duration: 0.5, ease: 'power2.in' }, 2.3)
          .to(V, { tanX: 1 }, { duration: 0.7, ease: 'power3.out' }, 2.4)
          .to(par, { tanLen: 0.56 }, { duration: 0.9, ease: 'power2.out' }, 2.4);
      }
    },
    {
      id: 'a2-y', nav: 1, act: '第二幕 · 偏导存在', hold: 2.6,
      q: '第二刀：沿 $x=x_0$ 切下去',
      body: '第一组降权，第二组接手。两次切割互相独立——<b>它们互不要求对方那条曲线也听话</b>。',
      f: ['f_y(x_0,y_0)=\\lim_{\\Delta y\\to 0}\\frac{f(x_0,y_0+\\Delta y)-f(x_0,y_0)}{\\Delta y}'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'secY', 'curveY', 'tanX', 'secX', 'curveX', 'secQ', 'secant', 'tanY'],
      vis: { secY: 0.4, secX: 1, curveX: 1, secQ: 1, secant: 1, tanY: 0 },
      cam: { r: 3.3, th: 0.6, ph: 0.75, follow: 1, by: 0.4 },
      ro: [['fp', 'f(P)'], ['fy', 'f<sub>y</sub>'], ['sec', 'Δy']],
      run(tl) {
        tw(tl, par, { secAx: 1, secT: 1.05, surfAlpha: 0.68 }, 0.6);
        tl.to(par, { secT: 0, duration: 1.6, ease: 'power2.inOut' }, 0.6)
          .to(par, { duration: 0.45 })
          .to(V, { secant: 0 }, { duration: 0.5, ease: 'power2.in' }, 2.2)
          .to(V, { tanY: 1 }, { duration: 0.7, ease: 'power3.out' }, 2.3)
          .to(par, { tanLen: 0.56 }, { duration: 0.9, ease: 'power2.out' }, 2.3);
      }
    },
    {
      id: 'a2-cross', nav: 1, act: '第二幕 · 偏导存在', hold: 2.4,
      q: '沉淀：一个正交的「十字架」',
      body: '截面退场，只留下 $P$ 点、两条互相垂直的切线，<b>以及它们共同所属的那张切平面</b>。注意两条切线<b>只在 $P$ 处贴合曲面</b>，往外立刻分离。',
      f: ['f_x(x_0,y_0),\\ f_y(x_0,y_0)\\ \\ \\text{双双存在}'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'planeT', 'planeEdge', 'gap'],
      vis: { secY: 0, secX: 0, curveY: 0, curveX: 0, secQ: 0, secant: 0, tanX: 1, tanY: 1, planeT: 0.55, planeEdge: 0.45, gap: 1 },
      cam: { r: 3.78, th: 0.86, ph: 0.77, follow: 0.5, by: 0 },
      ro: PF,
      init(tl) { tw(tl, par, { planeGrow: 0.02 }, 0.1); },
      run(tl) {
        tw(tl, par, { surfDim: 0.2, tanLen: 0.45, surfAlpha: 0.58 }, 1.2);
        tl.to(par, { planeGrow: 0.55, duration: 1.1, ease: 'expo.out' }, 0.35);
      }
    },
    {
      id: 'a2-limit', nav: 1, act: '第二幕 · 偏导存在', hold: 3.2,
      q: '但我们只切了两刀',
      body: '底面上这些淡线，代表<b>其余无穷多个尚未检查的方向</b>。两条切线存在，只说明这两个方向行为正常，其余一律未知。',
      note: ['warn', '偏导存在是<b>逐方向</b>的检验，天生无法一网打尽。'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'ghost', 'planeT', 'planeEdge', 'gap'],
      vis: { ghost: 1, tanX: 1, tanY: 1, planeT: 0.32, planeEdge: 0.3, gap: 0.7 },
      cam: { r: 4.14, th: 0.86, ph: 0.79, follow: 0.35, by: 0 },
      ro: PF,
      run(tl) { tw(tl, par, { surfDim: 0.3, surfAlpha: 0.58, planeGrow: 0.55 }, 1.0); }
    },
    /* ---------- 转场 ---------- */
    {
      id: 't2', nav: 2, act: '偏导存在 → 可微', hold: 2.6,
      q: '两条切线已经能定出一个平面',
      body: '以两条切线为基准，从 $P$ 展开一个半透明的<b>候选近似平面</b>。核心设问：它能否一阶代表整个局部曲面？',
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'planeT', 'planeEdge'],
      vis: { ghost: 0.12, tanX: 1, tanY: 1, planeT: 1, planeEdge: 1 },
      cam: { r: 3.3, th: 0.86, ph: 0.77, follow: 1, by: 0.4 },
      ro: PF,
      run(tl) {
        tw(tl, par, { planeGrow: 0.58, surfAlpha: 0.85 }, 0.5);
        tw(tl, par, { planeGrow: 1 }, 1.6, 'expo.out');
        tw(tl, par, { surfDim: 0.6 }, 0.8);
      }
    },
    /* ==================== 第三幕 · 可微 ==================== */
    {
      id: 'a3-plane', nav: 2, act: '第三幕 · 可微', hold: 2.4,
      q: '曲面与平面，先摆在一起看',
      body: '蓝色是真实曲面，琥珀色是候选平面。<b>两者之间的一切差异，都集中在每一点竖直方向的误差上</b>。',
      f: ['\\Delta z=f_x\\Delta x+f_y\\Delta y+o(\\rho)'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'planeT', 'planeEdge'],
      vis: { tanX: 0.5, tanY: 0.5, planeT: 1, planeEdge: 1 },
      cam: { r: 3.4, th: 0.8, ph: 0.77, follow: 1, by: 0.4 },
      ro: PF,
      run(tl) { tw(tl, par, { surfDim: 0.4 }, 0.9); }
    },
    {
      id: 'a3-error', nav: 2, act: '第三幕 · 可微', hold: 3.0,
      q: '把误差拎出来：那一段竖直线',
      body: '取邻域采样点 $Q$：同一底面位置上，曲面点与平面点之间差一段竖直距离 $R$；底面上则是 $P$ 到 $Q$ 的距离 $\\rho$。',
      f: ['R=f(x_0+\\Delta x,\\ y_0+\\Delta y)-f(x_0,y_0)-f_x\\Delta x-f_y\\Delta y'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'planeT', 'planeEdge', 'errR', 'errPt', 'rhoL', 'patchG'],
      vis: { errR: 1, errPt: 1, rhoL: 1, patchG: 0.8, planeT: 1, planeEdge: 0.8 },
      cam: { r: 3.0, th: 0.86, ph: 0.75, follow: 1, by: 0.42 },
      ro: ERRRO,
      run(tl) { tw(tl, par, { ring: 0.72, errAng: Math.PI / 4 }, 1.0, 'power2.out'); }
    },
    {
      id: 'a3-zoom', nav: 2, act: '第三幕 · 可微', hold: 2.6,
      q: '不断放大：$R$ 确实在变短',
      body: '以 $P$ 为不动点，尺度 $r\\to r/2\\to r/4$。<b>但这还说明不了任何事</b>——$Q$ 自己也在靠近 $P$。',
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'planeT', 'planeEdge', 'errR', 'errPt', 'rhoL', 'patchG'],
      vis: { errR: 1, errPt: 1, rhoL: 1, patchG: 0.8, planeT: 1, planeEdge: 0.7 },
      cam: { r: 1.9, th: 0.86, ph: 0.75, follow: 1, by: 0.3 },
      ro: ERRRO,
      run(tl) {
        tl.to(par, { ring: 0.38, tanLen: 0.34, duration: 1.2, ease: 'power2.inOut' }, 0.3)
          .to(par, { duration: 0.5 })
          .to(par, { ring: 0.2, tanLen: 0.18, duration: 1.2, ease: 'power2.inOut' })
          .to(par, { duration: 0.4 });
        tw(tl, CAM, { r: 1.35 }, 2.6, 'power2.inOut');
      }
    },
    {
      id: 'a3-ratio', nav: 2, act: '第三幕 · 可微', hold: 3.6, cMode: true,
      q: '真正要看的不是 $R$，而是 $R/\\rho$',
      body: '$R$ 变小太容易了：$Q$ 往 $P$ 靠，$R$ 当然跟着缩短。关键在于——<b>误差衰减的速度，是否严格快于到 $P$ 的距离</b>。',
      f: ['\\rho=\\sqrt{\\Delta x^{2}+\\Delta y^{2}}', '\\dfrac{R}{\\rho}\\ \\longrightarrow\\ 0\\qquad (\\rho\\to 0)'],
      note: ['imp', '可微 $\\Leftrightarrow$ 邻域内存在<b>统一的一阶近似</b>，且误差是二阶小量 $o(\\rho)$。'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'planeT', 'planeEdge', 'errR', 'errPt', 'rhoL', 'patchG'],
      vis: { errR: 1, errPt: 1, rhoL: 1, patchG: 0.8, planeT: 1, planeEdge: 0.7 },
      cam: { r: 1.05, th: 0.88, ph: 0.74, follow: 1, by: 0.2 },
      ro: ERRRO,
      run(tl) { tw(tl, par, { ring: 0.15, tanLen: 0.15 }, 2.4, 'power2.inOut'); }
    },
    {
      id: 'a3-land', nav: 2, act: '第三幕 · 可微', hold: 3.0,
      q: '落位：可微',
      body: '整个局部曲面共享同一张一阶近似平面，且误差远小于距离本身。$Q$ 再怎么在邻域里跑，$R$ 都追不上 $\\rho$。',
      f: ['f(x,y)=f(x_0,y_0)+f_x\\Delta x+f_y\\Delta y+o(\\rho)'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'planeT', 'planeEdge', 'errR', 'errPt', 'rhoL'],
      vis: { errR: 0.8, errPt: 0.9, rhoL: 0.8, planeT: 1, planeEdge: 0.9 },
      cam: { r: 3.4, th: 0.8, ph: 0.77, follow: 1, by: 0.4 },
      ro: ERRRO,
      run(tl) { tw(tl, par, { surfDim: 0.35, tanLen: 0.6 }, 1.0); }
    },
    /* ---------- 转场 ---------- */
    {
      id: 't3', nav: 3, act: '可微 → 偏导连续', hold: 2.0,
      q: '把 $P$ 挪一挪',
      body: '切线与切平面随之平滑倾斜——<b>它们不是一次巧合，而是随位置连续演变的一阶结构</b>。',
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'planeT', 'planeEdge', 'trail'],
      vis: { errR: 0, errPt: 0, rhoL: 0, planeT: 1, planeEdge: 1, trail: 1, gap: 0 },
      cam: { r: 3.3, th: 0.86, ph: 0.76, follow: 1, by: 0.4 },
      ro: PF,
      init(tl) { par.walkMode = 'loop'; par.walkT = 0; resetTrail(); },
      run(tl) { tw(tl, par, { walkT: 0.3 }, 3.2, 'sine.inOut'); }
    },
    /* ==================== 第四幕 · 偏导连续 ==================== */
    {
      id: 'a4-walk', spark: true, nav: 3, act: '第四幕 · 偏导连续', hold: 2.8,
      q: '在邻域里平滑地走一圈',
      body: '$P$ 沿平滑曲线移动，切线与切平面的倾角实时跟随。右侧 $f_x$、$f_y$ 的轨迹<b>平滑流动，没有一处跳变</b>。',
      f: ['f_x(x,y),\\ f_y(x,y)\\quad\\text{在邻域内连续过渡}'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'planeT', 'planeEdge', 'trail'],
      vis: { trail: 1, planeT: 1, planeEdge: 1 },
      cam: { r: 3.3, th: 0.86, ph: 0.76, follow: 1, by: 0.4 },
      ro: PF,
      init() { resetSpark(); },
      run(tl) { tw(tl, par, { walkT: 1.3 }, 4.4, 'sine.inOut'); }
    },
    {
      id: 'a4-field', spark: true, nav: 3, act: '第四幕 · 偏导连续', hold: 3.0,
      q: '斜率场：从一个点铺满一片',
      body: '邻域里每个采样点都长出自己的微型切线，<b>斜率在空间中平滑过渡，没有方向性的突变</b>。',
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'planeT', 'planeEdge', 'trail', 'field'],
      vis: { trail: 0.5, field: 1, planeT: 0.8, planeEdge: 0.7 },
      cam: { r: 3.5, th: 0.86, ph: 0.77, follow: 0.8, by: 0.4 },
      ro: PF,
      run(tl) { tw(tl, par, { walkT: 1.75 }, 3.8, 'sine.inOut'); }
    },
    {
      id: 'a4-land', spark: false, nav: 3, act: '第四幕 · 偏导连续', hold: 3.6,
      q: '落位：偏导连续 $\\Rightarrow$ 可微',
      body: '$P$ 回到中心，斜率场平稳收束，切平面重新稳定：<b>邻域内一阶性质平稳演变，局部一阶近似因此处处站得住</b>。',
      f: ['\\text{偏导连续}\\ \\Longrightarrow\\ \\text{可微}\\ \\Longrightarrow\\ \\text{连续}'],
      note: ['tip', '此处为<b>几何直觉</b>：偏导在场中平稳，正是切平面不会「只在一点贴合」的直观理由，不作严密代数证明。'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'tanX', 'tanY', 'planeT', 'planeEdge', 'field'],
      vis: { trail: 0, field: 0.75, planeT: 1, planeEdge: 1 },
      cam: { r: 3.3, th: 0.86, ph: 0.77, follow: 1, by: 0.4 },
      ro: PF,
      run(tl) { tw(tl, par, { walkT: 2.3 }, 3.4, 'sine.inOut'); }
    },
    /* ==================== 关系辨析 ==================== */
    {
      id: 'rel-intro', spark: false, nav: 4, act: '关系辨析 · 三个反例', hold: 3.6,
      q: '哪些箭头不能反着走',
      body: '充分关系如左。把它们<b>反过来</b>会逐一崩塌——下面用三个节奏截然不同的反例，亲手把逆命题拆掉。',
      f: ['\\text{偏导连续}\\Rightarrow\\text{可微}\\Rightarrow\\text{连续},\\qquad\\text{可微}\\Rightarrow\\text{偏导存在}'],
      note: ['note', '节奏安排：<b>快</b>（视觉反转）→ <b>慢</b>（深入核心）→ <b>快</b>（短促对照）。'],
      keep: ['surface', 'mesh', 'grid', 'pMark'],
      vis: { tanX: 0, tanY: 0, planeT: 0, planeEdge: 0, field: 0, trail: 0 },
      cam: { r: 4.77, th: 0.82, ph: 0.76, follow: 0, by: 0.58 },
      ro: PF,
      init() { par.walkMode = null; resetSpark(); },
      run(tl) { tw(tl, par, { surfDim: 0.3 }, 1.0); }
    },
    /* ---------- 反例一 ---------- */
    {
      id: 'ce1-partials', fn: 'ce1', nav: 4, act: '反例一 · 快节奏', hold: 3.0,
      q: '反例一：两刀都完全正常',
      body: '换成 $f=\\dfrac{xy}{x^2+y^2}$。沿坐标轴函数值恒为 $0$，两条切线平直——<b>偏导存在，教科书般地成立</b>。',
      f: ['f_x(0,0)=f_y(0,0)=0'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'secY', 'secX', 'curveY', 'curveX', 'tanX', 'tanY'],
      vis: { secY: 0.8, secX: 0.8, curveY: 1, curveX: 1, tanX: 1, tanY: 1 },
      cam: { r: 2.9, th: 0.9, ph: 0.75, follow: 1, by: 0.24 },
      ro: PF,
      init(tl) { tw(tl, par, { tanLen: 0.5, planeGrow: 0.02, ring: 0.7, boundGrow: 0.001 }, 0.6); },
      run(tl) { tw(tl, par, { surfDim: 0.7 }, 0.8); }
    },
    {
      id: 'ce1-path', fn: 'ce1', nav: 4, act: '反例一 · 快节奏', hold: 3.8, cMode: true,
      q: '换个方向：$y=x$',
      body: '沿这条斜线，曲面高度<b>恒为 $\\frac12$</b>，趋近原点却掉不下去。第一幕的判据直接调用——<b>断崖</b>。',
      f: ['\\lim_{x\\to 0}f(x,x)=\\tfrac12\\ \\ne\\ f(0,0)=0'],
      note: ['warn', '<b>偏导存在 ⇏ 连续</b>：两条切线再正常，也管不到斜线上的断崖。'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'secY', 'secX', 'curveY', 'curveX', 'tanX', 'tanY', 'cePath', 'ceRef'],
      vis: { secY: 0.28, secX: 0.28, curveY: 0.45, curveX: 0.45, tanX: 1, tanY: 1, cePath: 1, ceRef: 1 },
      cam: { r: 2.6, th: 0.98, ph: 0.71, follow: 1, by: 0.3 },
      ro: [['fp', 'f(P)'], ['fq', 'f(路径点)'], ['rho', '距离']],
      run(tl) {
        tw(tl, par, { ceDrop: 0 }, 0.2);
        tw(tl, par, { ceS: 0.09 }, 2.8, 'power2.inOut');
        tl.to(par, { duration: 0.8 })
          .to(par, { ceDrop: 1, duration: 0.32, ease: 'power3.in' })
          .to(par, { duration: 0.4 });
      }
    },
    /* ---------- 反例二 ---------- */
    {
      id: 'ce2-cont', fn: 'ce2', nav: 4, act: '反例二 · 慢节奏', hold: 3.6,
      q: '反例二：这次连续是真的',
      body: '换 $f=\\dfrac{xy}{\\sqrt{x^2+y^2}}$。整张曲面被夹在上下两片锥面之间，高度不超过到原点距离的一半。',
      f: ['|f(x,y)|=\\dfrac{|xy|}{\\rho}\\le\\ \\tfrac12\\,\\rho\\ \\longrightarrow\\ 0'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'cone', 'errPt', 'patchG'],
      vis: { cone: 1, errPt: 1, patchG: 0.7 },
      cam: { r: 3.0, th: 0.86, ph: 0.77, follow: 1, by: 0.22 },
      ro: [['fp', 'f(P)'], ['fq', 'f(Q)'], ['rho', 'ρ']],
      init(tl) { tw(tl, par, { ring: 0.7, boundGrow: 0.03, tanLen: 0.5, planeGrow: 0.02 }, 0.4); },
      run(tl) { tw(tl, par, { boundGrow: 1 }, 1.5, 'expo.out'); }
    },
    {
      id: 'ce2-partials', fn: 'ce2', nav: 4, act: '反例二 · 慢节奏', hold: 3.0,
      q: '两刀依然正常，候选平面是 $z=0$',
      body: '沿坐标轴 $f$ 恒为 $0$，两个偏导都是 $0$。<b>第一幕的连续判据、第二幕的两刀手术，在这里全部通过</b>。',
      f: ['f_x(0,0)=f_y(0,0)=0,\\qquad T:\\ z=0'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'cone', 'secY', 'secX', 'curveY', 'curveX', 'tanX', 'tanY', 'planeT', 'planeEdge'],
      vis: { cone: 0.26, secY: 0.6, secX: 0.6, curveY: 0.8, curveX: 0.8, tanX: 1, tanY: 1, planeT: 1, planeEdge: 1 },
      cam: { r: 3.1, th: 0.86, ph: 0.77, follow: 1, by: 0.26 },
      ro: PF,
      run(tl) { tw(tl, par, { planeGrow: 1 }, 1.5, 'expo.out'); }
    },
    {
      id: 'ce2-zoom', fn: 'ce2', nav: 4, act: '反例二 · 慢节奏', hold: 3.4,
      q: '放大：误差确实在变短',
      body: '绝对误差 $R$ 随尺度缩小而变短，平面看上去越贴越紧。<b>先别急着下结论</b>——$Q$ 自己也在靠近原点。',
      f: ['R=\\big|f(Q)-0\\big|\\ \\le\\ \\tfrac12\\,\\rho\\ \\longrightarrow\\ 0'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'cone', 'planeT', 'planeEdge', 'errR', 'errPt', 'rhoL', 'patchG'],
      vis: { cone: 0.12, planeT: 1, planeEdge: 0.8, errR: 1, errPt: 1, rhoL: 1, patchG: 0.7 },
      cam: { r: 1.5, th: 0.9, ph: 0.9, follow: 1, by: 0.16 },
      ro: [['rho', 'ρ'], ['R', 'R'], ['fq', 'f(Q)']],
      run(tl) {
        tl.to(par, { ring: 0.35, tanLen: 0.3, duration: 1.4, ease: 'power2.inOut' }, 0.3)
          .to(par, { duration: 0.5 })
          .to(par, { ring: 0.18, tanLen: 0.15, duration: 1.4, ease: 'power2.inOut' })
          .to(par, { duration: 0.4 });
        tw(tl, CAM, { r: 1.32, ph: 0.9 }, 3.0, 'power2.inOut');
      }
    },
    {
      id: 'ce2-ratio', fn: 'ce2', nav: 4, act: '反例二 · 慢节奏', hold: 4.2, cMode: true,
      q: '比值不会消失',
      body: '沿 $y=x$ 逼近，误差与距离的比例<b>锁死在 $\\frac12$</b>。视口推到极限，曲面与平面之间仍夹着固定角度——可微性被击破。',
      f: ['\\rho=\\sqrt2\\,|x|,\\qquad R=\\dfrac{|x|}{\\sqrt2}', '\\dfrac{R}{\\rho}=\\dfrac12\\ \\ne\\ 0'],
      note: ['warn', '<b>连续 + 偏导存在 ⇏ 可微</b>：这是四格里最容易被误判的一格。'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'cone', 'planeT', 'planeEdge', 'errR', 'errPt', 'rhoL', 'patchG', 'angle'],
      vis: { cone: 0.08, planeT: 1, planeEdge: 0.8, errR: 1, errPt: 1, rhoL: 1, patchG: 0.7, angle: 1 },
      cam: { r: 1.12, th: 0.92, ph: 0.98, follow: 1, by: 0.1 },
      ro: ERRRO,
      run(tl) { tw(tl, par, { ring: 0.1, tanLen: 0.09 }, 2.8, 'power2.inOut'); }
    },
    /* ---------- 反例三 ---------- */
    {
      id: 'ce3-diff', fn: 'ce3', nav: 4, act: '反例三 · 短促对照', hold: 3.4,
      q: '反例三：这次可微也是真的',
      body: '换 $f=(x^2+y^2)\\sin\\dfrac{1}{\\rho}$。高度被夹在 $\\pm(x^2+y^2)$ 之间，原点切平面 $z=0$ 满足一阶近似。',
      f: ['|f(x,y)|\\le x^{2}+y^{2}=o(\\rho)'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'cone', 'planeT', 'planeEdge', 'errR', 'errPt', 'rhoL'],
      vis: { cone: 1, planeT: 1, planeEdge: 0.9, errR: 1, errPt: 1, rhoL: 1 },
      cam: { r: 2.6, th: 0.86, ph: 0.82, follow: 1, by: 0.18 },
      ro: [['rho', 'ρ'], ['R', 'R'], ['fq', 'f(Q)'], ['fp', 'f(P)']],
      init(tl) { tw(tl, par, { ring: 0.5, boundGrow: 0.03, tanLen: 0.44 }, 0.4); },
      run(tl) { tw(tl, par, { boundGrow: 1 }, 1.4, 'expo.out'); }
    },
    {
      id: 'ce3-osc', fn: 'ce3', spark: true, nav: 4, act: '反例三 · 短促对照', hold: 3.8,
      q: '但偏导不连续',
      body: '$P$ 稍稍离开原点，切线立刻剧烈摆动，$f_x$ 的数值<b>没有极限</b>。可微是真的，偏导连续是假的。',
      f: ['f_x=2x\\sin\\tfrac1\\rho-\\tfrac{x}{\\rho}\\cos\\tfrac1\\rho\\ \\ \\to\\ \\ \\text{无极限}'],
      note: ['warn', '<b>可微 ⇏ 偏导连续</b>：一阶近似成立，不代表一阶信息本身平稳。'],
      keep: ['surface', 'mesh', 'grid', 'pMark', 'cone', 'planeT', 'planeEdge', 'tanX', 'tanY', 'trail'],
      vis: { cone: 0.14, planeT: 0.9, planeEdge: 0.7, tanX: 1, tanY: 1, trail: 0.6 },
      cam: { r: 1.35, th: 0.9, ph: 0.9, follow: 1, by: 0.08 },
      ro: [['fp', 'f(P)'], ['fx', 'f<sub>x</sub>'], ['fy', 'f<sub>y</sub>'], ['pr', 'ρ (离原点)']],
      init() { par.walkMode = 'radial'; par.walkT = 0; resetTrail(); resetSpark(); },
      run(tl) { tw(tl, par, { walkT: 1 }, 4.6, 'none'); tw(tl, par, { tanLen: 0.3 }, 0.8); }
    },
    {
      id: 'rel-close', fn: 'base', spark: false, nav: 4, act: '关系辨析 · 收束', hold: 3.8,
      q: '三条逆命题，全部封死',
      body: '箭头只朝一个方向。反例的节奏虽不同，破法却是同一个：<b>让「其余方向」说话</b>。',
      f: ['\\text{偏导存在}\\nRightarrow\\text{连续},\\quad\\text{连续}+\\text{偏导存在}\\nRightarrow\\text{可微},\\quad\\text{可微}\\nRightarrow\\text{偏导连续}'],
      note: ['note', '四格关系是<b>单向阶梯</b>：偏导连续 → 可微 → 连续；可微 → 偏导存在。'],
      keep: ['surface', 'mesh', 'grid', 'pMark'],
      vis: { tanX: 0, tanY: 0, planeT: 0, planeEdge: 0, trail: 0, cone: 0 },
      cam: { r: 4.77, th: 0.82, ph: 0.76, follow: 0, by: 0.58 },
      ro: PF,
      init(tl) {
        par.walkMode = null;
        tw(tl, par, { ring: 0.86, boundGrow: 1, tanLen: 0.42, planeGrow: 1 }, 0.6);
      },
      run(tl) { tw(tl, par, { surfDim: 0.25 }, 1.0); }
    },
    /* ==================== 终幕 ==================== */
    {
      id: 'finale-quiet', nav: -1, act: '终幕 · 知识图谱', hold: 2.8,
      q: '回到最初那张曲面',
      body: '辅助线、截面、误差、斜率场全部退场，只留曲面与原点。<b>现在把四个概念重新拼起来</b>。',
      keep: ['surface', 'mesh', 'grid'],
      vis: { mesh: 0.55, grid: 0.5, axis: 0 },
      cam: { r: 4.95, th: 0.82, ph: 0.76, follow: 0, by: 0.58 },
      ro: PF,
      run(tl) { tw(tl, par, { surfAlpha: 0.17, surfDim: 0.08 }, 1.3); }
    },
    {
      id: 'finale-graph', nav: -1, act: '终幕 · 知识图谱', hold: 0,
      q: '记住这张图',
      body: '顶部那四个概念，就是刚才一路走过来的四个关卡。<b>箭头只朝一个方向</b>。',
      f: ['\\text{偏导连续}\\Rightarrow\\text{可微}\\Rightarrow\\big(\\text{连续},\\ \\text{偏导存在}\\big)'],
      keep: ['surface', 'mesh', 'grid'],
      vis: { surfAlpha: 0.14, mesh: 0.42, grid: 0.4, axis: 0 },
      cam: { r: 5.04, th: 0.82, ph: 0.76, follow: 0, by: 0.58 },
      ro: PF,
      init(tl) { morphGraph(tl); },
      run(tl) { tl.to({}, { duration: 0.4 }); }
    }
  ];

  /* ---------- 函数切换（交叉淡入淡出） ---------- */
  function switchFn(key, tl) {
    tl.to(V, { surface: 0.06, mesh: 0.06 }, { duration: 0.3, ease: 'power2.in' });
    tl.call(() => { setFunction(key); });
    tl.to(V, { surface: 1, mesh: 0.4 }, { duration: 0.65, ease: 'power2.out' }, '>-0.06');
  }

  /* ---------- 终幕：导航节点飞入构成关系图 ---------- */
  function morphGraph(tl) {
    const cards = Array.prototype.slice.call(elGraphBox.querySelectorAll('.gcard'));
    const src = cards.map(c => {
      const nav = document.querySelector('.cnode[data-i="' + c.dataset.i + '"]');
      const a = nav.getBoundingClientRect(), b = c.getBoundingClientRect();
      return { x: (a.left + a.width / 2) - (b.left + b.width / 2), y: (a.top + a.height / 2) - (b.top + b.height / 2) };
    });
    tl.to(elGraph, { opacity: 1, duration: 0.4, ease: 'power2.out' }, 0);
    cards.forEach((c, i) => {
      tl.fromTo(c,
        { x: src[i].x, y: src[i].y, scale: 0.82, opacity: 0 },
        { x: 0, y: 0, scale: 1, opacity: 1, duration: 0.95, ease: 'power4.out' }, 0.12 + i * 0.08);
    });
    ['ar1', 'ar2', 'ar3'].forEach((id, i) => {
      const p = document.getElementById(id);
      const len = 200;
      gsap.set(p, { strokeDasharray: len, strokeDashoffset: len, opacity: 1 });
      tl.to(p, { strokeDashoffset: 0, duration: 0.6, ease: 'power2.inOut' }, 0.95 + i * 0.1);
    });
    ['ar1h', 'ar2h', 'ar3h'].forEach((id, i) => {
      tl.to(document.getElementById(id), { opacity: 1, duration: 0.3 }, 1.45 + i * 0.1);
    });
    // 箭头语义标签随箭头落位
    const glabs = elGraphBox.querySelectorAll('.glab');
    glabs.forEach((g, i) => {
      tl.fromTo(g, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 1.5 + i * 0.12);
    });
    tl.to($('no-reverse'), { opacity: 1, duration: 0.7, ease: 'power2.out' }, 2.0);
    tl.to(navNodes, { opacity: 0.2, duration: 0.6 }, 0.1);
  }

  /* ==================================================================
   * 10 · 调度器
   * ================================================================== */
  const State = { playing: false, speed: 1.0, step: -1 };
  let activeTl = null;

  function killAll() {
    if (!window.gsap) return;
    gsap.killTweensOf(V);
    gsap.killTweensOf(par);
    gsap.killTweensOf(CAM);
    if (activeTl) activeTl.kill();
    if (activePaneTl) activePaneTl.kill();
    gsap.killTweensOf(elGraph);
    gsap.killTweensOf(elSparkWrap);
    gsap.killTweensOf($('no-reverse'));
  }

  function initState() {
    Object.assign(par, {
      approach: 0, ring: 0.86, errAng: Math.PI / 4, pulse: 0,
      sx: 1, sy: 1, secT: 1, secAx: 0, planeGrow: 1, tanLen: 0.42,
      walkT: 0, walkMode: null, ceS: 0.9, ceDrop: 0,
      surfAlpha: 0.97, surfDim: 0.15, boundGrow: 1
    });
    Object.keys(V).forEach(k => { V[k] = 0; });
    V.surface = 1; V.mesh = 0.4; V.grid = 0.62; V.pMark = 1; V.axis = 1;
    Object.assign(CAM, { r: 4.9, th: 0.86, ph: 0.75, bx: 0, by: 0.55, bz: 0, follow: 0 });
    resetTrail(); resetSpark();
    gsap.set(elGraph, { opacity: 0 });
    gsap.set($('no-reverse'), { opacity: 0 });
    gsap.set(elGraphBox.querySelectorAll('.glab'), { opacity: 0 });
    gsap.set(elSparkWrap, { opacity: 0 });
    navNodes.forEach(n => gsap.set(n, { opacity: 1 }));
    setFunction('base');
  }

  function gotoStep(i, opt) {
    opt = opt || {};
    killAll();
    const idx = clamp(i, 0, STEPS.length - 1);
    const s = STEPS[idx];
    State.step = idx;

    $('act-chip').textContent = s.act;
    $('step-title').textContent = plainify(s.q);
    $('step-count').textContent = pad(idx + 1) + '/' + pad(STEPS.length);
    $('story-fill').style.width = ((idx + 1) / STEPS.length * 100) + '%';
    elDeck.classList.toggle('c-mode', !!s.cMode);
    setNav(s.nav, s.nav < 0 ? '终' : s.nav > 3 ? '辨' : '序');
    // 终幕：信息栏收起，图例与镜头提示淡出，舞台归于宁静
    const quiet = s.nav < 0;
    gsap.to($('legend'), { opacity: quiet ? 0 : 1, duration: 0.7, ease: 'power2.inOut' });
    gsap.to($('readout-card'), { opacity: quiet ? 0 : 1, duration: 0.7, ease: 'power2.inOut' });
    gsap.to($('cam-hint'), { opacity: quiet ? 0 : 0.7, duration: 0.7 });

    renderReadout(s);
    renderPane(s);

    const tl = gsap.timeline({ paused: !!opt.instant });
    tl.timeScale(State.speed);
    if (s.fn && FN.key !== s.fn) switchFn(s.fn, tl);
    if (s.init) s.init(tl);
    applyVisStep(tl, s);
    applyCam(tl, s);
    s.run(tl);
    if (s.hold) tl.to({}, { duration: s.hold });
    tl.eventCallback('onComplete', () => {
      if (State.playing && State.step + 1 < STEPS.length) gotoStep(State.step + 1);
      else if (State.step + 1 >= STEPS.length) setPlaying(false);
    });
    activeTl = tl;
    if (opt.instant) tl.progress(1, false);
    else if (opt.snap) tl.timeScale(3.2);
    // 曲面标识跟随函数交叉淡入同步刷新
    if (opt.instant) syncFnChip();
    else tl.call(syncFnChip, null, 0.5);
    if (s.spark === true || s.spark === false) {
      if (opt.instant) gsap.set(elSparkWrap, { opacity: s.spark ? 1 : 0 });
      else gsap.to(elSparkWrap, { opacity: s.spark ? 1 : 0, duration: 0.6, ease: 'power2.inOut' });
    }
  }

  function syncFnChip() {
    $('stage-fn').textContent = FN.label;
    $('stage-eq').textContent = FN.tex;
    $('fn-chip').textContent = FN.label;
  }

  function plainify(s) {
    return s.replace(/\$([^$]*)\$/g, (_, m) => m
      .replace(/\\Rightarrow/g, '⇒').replace(/\\Leftrightarrow/g, '⇔')
      .replace(/\\ne/g, '≠').replace(/\\to/g, '→').replace(/\\infty/g, '∞')
      .replace(/\\Delta/g, 'Δ').replace(/\\rho/g, 'ρ').replace(/\\frac\{?\}?/g, '')
      .replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
    );
  }

  function setPlaying(on) {
    State.playing = on;
    $('btn-play-icon').innerHTML = on ? '&#10074;&#10074;' : '&#9654;';
    $('btn-play-text').textContent = on ? '暂停演进' : (State.step > 0 ? '继续演进' : '开始演进');
    if (!on) return;
    if (activeTl && activeTl.progress() >= 0.999) gotoStep(Math.min(State.step + 1, STEPS.length - 1));
    else if (activeTl) activeTl.play();
  }

  function stepOnce() {
    setPlaying(false);
    if (activeTl && activeTl.progress() < 0.999) { activeTl.progress(1, false); return; }
    if (State.step < STEPS.length - 1) gotoStep(State.step + 1, { snap: true });
  }

  /* ==================================================================
   * 11 · 渲染循环 / 尺寸 / 交互
   * ================================================================== */
  function resize() {
    const r = elStage.getBoundingClientRect();
    LW = r.width; LH = r.height;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(r.height, 1);
    camera.updateProjectionMatrix();
  }

  function loop() {
    requestAnimationFrame(loop);
    applyVis();
    updateGeometry();
    pushTrail();
    pushSpark();
    renderer.render(scene, camera);
    updateLabels();
    updateReadout();
  }

  function bind() {
    $('btn-play').addEventListener('click', () => setPlaying(!State.playing));
    $('btn-step').addEventListener('click', stepOnce);
    $('btn-reset').addEventListener('click', () => {
      setPlaying(false);
      killAll();
      initState();
      gotoStep(0, { instant: true });
    });
    const sl = $('slider-speed');
    sl.addEventListener('input', (e) => {
      State.speed = parseFloat(e.target.value);
      $('label-speed').textContent = State.speed.toFixed(1) + 'x';
      if (activeTl) activeTl.timeScale(State.speed);
      if (activePaneTl) activePaneTl.timeScale(State.speed);
    });
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!State.playing); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); stepOnce(); }
      else if (e.key === 'r' || e.key === 'R') $('btn-reset').click();
    });

    // 镜头：仅 Focus Push / Reveal Pull / Perspective Shift —— 拖拽为手动微调，下一节拍自动归位
    let drag = false, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => {
      drag = true; lx = e.clientX; ly = e.clientY;
      canvas.classList.add('dragging');
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      CAM.th -= (e.clientX - lx) * 0.006;
      CAM.ph = clamp(CAM.ph - (e.clientY - ly) * 0.005, 0.22, 1.30);
      lx = e.clientX; ly = e.clientY;
    });
    const up = () => { drag = false; canvas.classList.remove('dragging'); };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      CAM.r = clamp(CAM.r * (1 + e.deltaY * 0.0011), 0.5, 9.5);
    }, { passive: false });

    $('legend').innerHTML = [
      ['#2563EB', '真实曲面 / 截线 / 切线'],
      ['#F59E0B', '候选近似平面 / 预测高度'],
      ['#DC2626', '一阶误差 R'],
      ['#94A3B8', '参照网格与辅助线']
    ].map(r => '<span class="lg"><i style="background:' + r[0] + '"></i>' + r[1] + '</span>').join('');
  }

  // 支持 ?step=N 深链：静默回放前序节拍的终态，保证任一节拍都可独立定位
  function deepLinkStep() {
    const m = /[?&]step=(\d+)/.exec(location.search + location.hash);
    return m ? clamp(parseInt(m[1], 10) - 1, 0, STEPS.length - 1) : -1;
  }

  function preRoll(idx) {
    for (let i = 0; i < idx; i++) {
      const s = STEPS[i];
      const tl = gsap.timeline({ paused: true });
      tl.timeScale(State.speed);
      if (s.fn && FN.key !== s.fn) switchFn(s.fn, tl);
      if (s.init) s.init(tl);
      applyVisStep(tl, s);
      applyCam(tl, s);
      s.run(tl);
      tl.progress(1, false);
      tl.kill();
    }
  }

  function boot() {
    buildStage();
    regLayers();
    buildLabels();
    setFunction('base');
    bind();
    resize();
    const s0 = deepLinkStep();
    if (s0 > 0) preRoll(s0);
    gotoStep(s0 < 0 ? 0 : s0, { instant: true });
    loop();
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
