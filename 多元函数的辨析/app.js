/**
 * 多元函数的辨析 · 核心几何、GSAP 时间轴与控制器状态机
 * 载体曲面:  z = xy / sqrt(x^2 + y^2)  (rho > 0),  z = 0  (rho = 0)
 *
 * 数值真值见《设计方案.md》§五「数学事实核对表」。
 *
 * 架构要点
 *  - 所有可动量收敛到纯对象 `Pose`，GSAP 只补间 `Pose` 的数值字段；
 *    几何重建集中在 `applyPose()` 一个函数里，由时间轴 onUpdate 驱动，
 *    从而做到「零内存开辟 + 单点重算 + 60fps 连续」（设计方案 §四.3）。
 *  - `BEATS` 表登记 15 拍的**终态目标值**；相邻两拍的终态即构成补间的起止值。
 *  - 一条主时间轴 `master` 串起 3 个 Phase × 5 Beat，每拍以 label 命名，
 *    供 下一步 tweenTo(label) / 上一步 tweenTo(prevLabel) / 播放 master.play() 复用。
 *  - 防呆铁律 §3.5：任何切换前 gsap.killTweensOf('*')。
 *  - 防呆铁律 §3.4：速率以 master.timeScale() 联动，不做手工 duration 除法。
 */
(function () {
  'use strict';

  /* ======================================================================
   * §0  常量与数学核心
   * ==================================================================== */

  const R = 1.2;        // 曲面显示半径（z 极值为 R/2 = 0.6）
  const HZ = 0.62;      // 剖切面半高
  const PROBE_R = 0.2;  // 法向巡检环半径
  const EPS = 1e-4;     // 原点奇异性防除零阈值
  const TAU = Math.PI * 2;
  const D2R = Math.PI / 180;

  /**
   * 机位取景适配系数
   * 《设计方案.md》的运镜导轨坐标是按默认场景尺度书写的，本实现取 R = 1.2，
   * 故按 CAM_FIT 等比外扩机位距离：只改变取景距离，不改变机位方向与各拍相对运镜关系。
   */
  const CAM_FIT = 1.14;

  /** 曲面高度：z = xy / rho，rho < EPS 时锁 0（防 NaN 网格撕裂） */
  function surfaceZ(x, y) {
    const r = Math.sqrt(x * x + y * y);
    if (r < EPS) return 0;
    return (x * y) / r;
  }

  /** 一阶偏导：f_x = y^3 / rho^3,  f_y = x^3 / rho^3 */
  function surfaceGrad(x, y) {
    const r = Math.sqrt(x * x + y * y);
    if (r < EPS) return { fx: 0, fy: 0 };
    const r3 = r * r * r;
    return { fx: (y * y * y) / r3, fy: (x * x * x) / r3 };
  }

  /** 沿方位角 phi 的射线方向 u = (cos phi, sin phi, 0) */
  function dirU(phi) {
    return { x: Math.cos(phi), y: Math.sin(phi) };
  }

  /**
   * 剖切角 phi 下截交线在剖面内的高度剖面（水平轴 s = 沿射线到原点的距离）：
   *   z(s) = |s| · sin(phi) · cos(phi) = |s| · ½ sin 2phi
   * 故  折痕斜率 k_± = ±½ sin 2phi ，残差比 Δz/ρ = ½ sin 2phi（与 rho 无关，故 rho→0 时不趋于 0）
   */
  function sliceProfile(s, phi) {
    return Math.abs(s) * Math.sin(phi) * Math.cos(phi);
  }
  function creaseSlope(phi) {
    return 0.5 * Math.sin(2 * phi);
  }

  /* ======================================================================
   * §1  场景骨架
   * ==================================================================== */

  const stageEl = document.getElementById('stage-container');
  const viewportEl = document.getElementById('viewport');
  const labelLayerEl = document.getElementById('label-layer');
  const camReadoutEl = document.getElementById('cam-readout');
  const exploreHintEl = document.getElementById('explore-hint');

  const scene = new THREE.Scene();

  // alpha 通道透明，让容器的 #FAF9F5 底 + 18px 工程微网格 + 天青/琥珀双柔光透出
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  viewportEl.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.02, 100);
  camera.position.set(0, -3.5 * CAM_FIT, 1.2 * CAM_FIT);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.28;
  controls.maxDistance = 14;
  controls.update();

  // 浅色纸面底光：强度刻意压低，避免半透明曲面被冲淡到失去四叶结构
  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const keyLight = new THREE.DirectionalLight(0xfffdf6, 0.52);
  keyLight.position.set(-2.2, -3.0, 4.2);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xe8f1fb, 0.22);
  fillLight.position.set(3.0, 2.4, 1.6);
  scene.add(fillLight);

  const ORDER = { ground: 0, surface: 1, tangent: 2, slice: 3, umbrella: 4, ribbon: 5, pillar: 6, probe: 7, axis: 8 };

  /* ---------- 1.1 浅色工程网格地面 + 坐标轴 ---------- */

  (function buildGroundGrid() {
    const EXT = 1.7, STEP = 0.2;
    const pts = [];
    for (let v = -EXT; v <= EXT + 1e-9; v += STEP) {
      pts.push(-EXT, 0, v, EXT, 0, v);
      pts.push(v, 0, -EXT, v, 0, EXT);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xD6D3CD, transparent: true, opacity: 0.55 }));
    m.renderOrder = ORDER.ground;
    scene.add(m);
  })();

  (function buildAxes() {
    const grp = new THREE.Group();
    grp.renderOrder = ORDER.axis;
    const AX = 2.15;
    const mkLine = (a, b, c) => new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color: c })
    );
    grp.add(mkLine(new THREE.Vector3(-AX, 0, 0), new THREE.Vector3(AX, 0, 0), 0x78716C));
    grp.add(mkLine(new THREE.Vector3(0, -AX, 0), new THREE.Vector3(0, AX, 0), 0x78716C));
    grp.add(mkLine(new THREE.Vector3(0, 0, -0.35), new THREE.Vector3(0, 0, 1.25), 0x57534E));

    const coneGeo = new THREE.ConeGeometry(0.045, 0.13, 14);
    const UP = new THREE.Vector3(0, 1, 0);
    const mkTip = (pos, dir, c) => {
      const m = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: c }));
      m.position.copy(pos);
      m.quaternion.setFromUnitVectors(UP, dir);
      return m;
    };
    grp.add(mkTip(new THREE.Vector3(AX + 0.07, 0, 0), new THREE.Vector3(1, 0, 0), 0x78716C));
    grp.add(mkTip(new THREE.Vector3(0, AX + 0.07, 0), new THREE.Vector3(0, 1, 0), 0x78716C));
    grp.add(mkTip(new THREE.Vector3(0, 0, 1.32), new THREE.Vector3(0, 0, 1), 0x57534E));
    scene.add(grp);
  })();

  /* ---------- 1.2 四叶折叠帐篷曲面（解析法向 + 顶点色，含防除零保护） ---------- */

  const NR = 56, NT = 192;
  const surfaceMat = new THREE.MeshLambertMaterial({
    vertexColors: true, transparent: true, opacity: 0.5,
    side: THREE.DoubleSide, depthWrite: false
  });
  (function buildSurface() {
    const vCount = (NR + 1) * (NT + 1);
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const idx = [];
    const cPos = new THREE.Color(0xEDF3F9);
    const cPosHot = new THREE.Color(0x5F9FD4);
    const cNegHot = new THREE.Color(0xE0A256);
    const tmp = new THREE.Color();

    for (let i = 0; i <= NR; i++) {
      const r = (i / NR) * R;
      for (let j = 0; j <= NT; j++) {
        const th = (j / NT) * TAU;
        const x = r * Math.cos(th);
        const y = r * Math.sin(th);
        const z = surfaceZ(x, y);
        const id = i * (NT + 1) + j;
        pos[id * 3] = x; pos[id * 3 + 1] = y; pos[id * 3 + 2] = z;

        // 解析法向 (-f_x, -f_y, 1) 归一化；原点处锁定 (0,0,1)
        const gr = surfaceGrad(x, y);
        let nx = -gr.fx, ny = -gr.fy, nz = 1;
        if (r < EPS) { nx = 0; ny = 0; nz = 1; }
        const len = Math.hypot(nx, ny, nz) || 1;
        nor[id * 3] = nx / len; nor[id * 3 + 1] = ny / len; nor[id * 3 + 2] = nz / len;

        const t = Math.min(1, Math.abs(z) / (R / 2));
        tmp.copy(cPos).lerp(z >= 0 ? cPosHot : cNegHot, 0.18 + 0.82 * t);
        col[id * 3] = tmp.r; col[id * 3 + 1] = tmp.g; col[id * 3 + 2] = tmp.b;
      }
    }
    for (let i = 0; i < NR; i++) {
      for (let j = 0; j < NT; j++) {
        const a = i * (NT + 1) + j, b = a + 1, c = a + (NT + 1), d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, surfaceMat);
    m.renderOrder = ORDER.surface;
    scene.add(m);

    // 外缘轮廓环，界定四叶 footprint
    const rim = [];
    for (let j = 0; j <= NT; j++) {
      const th = (j / NT) * TAU;
      const x = R * Math.cos(th), y = R * Math.sin(th);
      rim.push(new THREE.Vector3(x, y, surfaceZ(x, y)));
    }
    const rl = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(rim),
      new THREE.LineBasicMaterial({ color: 0x94A3B8, transparent: true, opacity: 0.9 })
    );
    rl.renderOrder = ORDER.axis;
    scene.add(rl);
  })();

  /* ---------- 1.3 候选切平面 z = 0（阶段 2 张开） ---------- */

  const tangentMat = new THREE.MeshBasicMaterial({
    color: 0x94A3B8, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
  });
  const tangentPlane = (function () {
    const g = new THREE.PlaneGeometry(2 * R, 2 * R);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, tangentMat);
    mesh.renderOrder = ORDER.tangent;
    mesh.visible = false;
    scene.add(mesh);

    const e = R;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-e, -e, 0), new THREE.Vector3(e, -e, 0),
        new THREE.Vector3(e, e, 0), new THREE.Vector3(-e, e, 0),
        new THREE.Vector3(-e, -e, 0)
      ]),
      new THREE.LineBasicMaterial({ color: 0x64748B, transparent: true, opacity: 0.85 })
    );
    line.renderOrder = ORDER.axis;
    line.visible = false;
    scene.add(line);
    return { mesh: mesh, border: line };
  })();

  /* ---------- 1.4 单刀半透明剖切面（绕 Z 轴旋转） ---------- */

  const sliceMat = new THREE.MeshBasicMaterial({
    color: 0xD97706, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
  });
  const sliceEdgeMat = new THREE.LineBasicMaterial({ color: 0xD97706, transparent: true, opacity: 0 });
  const sliceGroup = (function () {
    const grp = new THREE.Group();
    const g = new THREE.PlaneGeometry(2 * R, 2 * HZ);
    g.rotateX(-Math.PI / 2);   // 局部 X∈[-R,R]、Z∈[-HZ,HZ]，法向 +Y
    const face = new THREE.Mesh(g, sliceMat);
    face.renderOrder = ORDER.slice;
    grp.add(face);
    const w = R, h = HZ;
    const edge = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-w, 0, -h), new THREE.Vector3(w, 0, -h),
        new THREE.Vector3(w, 0, h), new THREE.Vector3(-w, 0, h),
        new THREE.Vector3(-w, 0, -h)
      ]),
      sliceEdgeMat
    );
    edge.renderOrder = ORDER.axis;
    grp.add(edge);
    scene.add(grp);
    return { grp: grp, face: face, edge: edge };
  })();

  /* ---------- 1.5 剖面截交线（预分配带状几何，Zero GC） ---------- */

  const RIB_N = 257;   // 奇数：保证存在 s = 0 的采样点（折痕尖顶）
  const ribbon = (function () {
    const pos = new Float32Array(RIB_N * 2 * 3);
    const col = new Float32Array(RIB_N * 2 * 3);
    const idx = [];
    for (let i = 0; i < RIB_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.6);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 1
    }));
    m.renderOrder = ORDER.ribbon;
    m.frustumCulled = false;
    scene.add(m);
    return { mesh: m, geo: g, pos: pos, col: col };
  })();

  /* ---------- 1.6 残差立柱（当前剖面上的悬空残差 Δz） ---------- */

  const pillar = (function () {
    const grp = new THREE.Group();
    // 以「单位尺寸」建模，运行时统一乘 annotScale() 缩放
    const shaftGeo = new THREE.CylinderGeometry(0.22, 0.22, 1, 16, 1, true);
    shaftGeo.translate(0, 0.5, 0);
    const shaft = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({
      color: 0xE11D48, side: THREE.DoubleSide, transparent: true, opacity: 0.95
    }));
    shaft.renderOrder = ORDER.pillar;
    grp.add(shaft);

    const ringGeo = new THREE.TorusGeometry(1, 0.17, 8, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const mkRing = (c) => {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: c }));
      m.renderOrder = ORDER.pillar;
      grp.add(m);
      return m;
    };
    const ringTop = mkRing(0xE11D48);
    const ringBot = mkRing(0x9F1239);

    const haloGeo = new THREE.RingGeometry(1.5, 2.4, 32);
    haloGeo.rotateX(-Math.PI / 2);
    const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
      color: 0xE11D48, side: THREE.DoubleSide, transparent: true, opacity: 0.5
    }));
    halo.renderOrder = ORDER.pillar;
    grp.add(halo);

    grp.visible = false;
    scene.add(grp);
    return { grp: grp, shaft: shaft, ringTop: ringTop, ringBot: ringBot, halo: halo, height: 0, base: new THREE.Vector3() };
  })();

  /* ---------- 1.7 r = 0.2 巡检环轨 + 法向探针（阶段 3） ---------- */

  const probeTrack = (function () {
    const pts = [];
    for (let j = 0; j <= 160; j++) {
      const th = (j / 160) * TAU;
      pts.push(new THREE.Vector3(PROBE_R * Math.cos(th), PROBE_R * Math.sin(th), 0));
    }
    const l = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: 0x059669, dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.9 })
    );
    l.computeLineDistances();
    l.renderOrder = ORDER.probe;
    l.visible = false;
    scene.add(l);
    return l;
  })();

  const probe = (function () {
    const grp = new THREE.Group();
    const stemGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.07, 12);
    stemGeo.translate(0, 0.035, 0);
    grp.add(new THREE.Mesh(stemGeo, new THREE.MeshBasicMaterial({ color: 0x047857 })));

    const ARROW_L = 0.55;   // = 2.75 倍巡检环半径，保证鸟瞰远景下依然醒目
    const shaftGeo = new THREE.CylinderGeometry(0.016, 0.016, ARROW_L * 0.72, 14);
    shaftGeo.translate(0, ARROW_L * 0.36, 0);
    const arrowShaft = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({ color: 0x059669 }));
    const headGeo = new THREE.ConeGeometry(0.05, ARROW_L * 0.28, 16);
    headGeo.translate(0, ARROW_L * 0.86, 0);
    const arrowHead = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ color: 0x065F46 }));

    const arrow = new THREE.Group();
    arrow.add(arrowShaft);
    arrow.add(arrowHead);
    grp.add(arrow);

    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x10B981, transparent: true, opacity: 0.9 })
    );
    tip.position.set(0, ARROW_L, 0);
    arrow.add(tip);

    grp.renderOrder = ORDER.probe;
    grp.visible = false;
    scene.add(grp);
    return { grp: grp, arrow: arrow, tip: tip, ARROW_L: ARROW_L };
  })();

  /* ---------- 1.8 法向轨迹带（波浪伞面，阶段 3） ---------- */

  const UMB_NT = 192, UMB_NL = 12, UMB_L = 0.5;
  const umbrella = (function () {
    const vCount = (UMB_NT + 1) * (UMB_NL + 1);
    const pos = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const idx = [];
    for (let i = 0; i < UMB_NT; i++) {
      for (let j = 0; j < UMB_NL; j++) {
        const a = i * (UMB_NL + 1) + j;
        idx.push(a, a + UMB_NL + 1, a + 1, a + 1, a + UMB_NL + 1, a + UMB_NL + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false
    }));
    m.renderOrder = ORDER.umbrella;
    m.frustumCulled = false;
    m.visible = false;
    scene.add(m);

    // 预计算每方位角的单位法向与倾角，避免每帧重复三角函数
    const dirs = new Float32Array(UMB_NT * 3);
    const tilt = new Float32Array(UMB_NT);
    for (let i = 0; i < UMB_NT; i++) {
      const th = (i / UMB_NT) * TAU;
      const gr = surfaceGrad(PROBE_R * Math.cos(th), PROBE_R * Math.sin(th));
      let nx = -gr.fx, ny = -gr.fy, nz = 1;
      const L = Math.hypot(nx, ny, nz) || 1;
      dirs[i * 3] = nx / L; dirs[i * 3 + 1] = ny / L; dirs[i * 3 + 2] = nz / L;
      tilt[i] = Math.acos(Math.min(1, nz / L));   // 0°(直立) ~ 45°(坐标轴方向)
    }
    return { mesh: m, geo: g, pos: pos, col: col, dirs: dirs, tilt: tilt };
  })();

  const _cLow = new THREE.Color(0x059669);
  const _cMid = new THREE.Color(0xD97706);
  const _cHigh = new THREE.Color(0xE11D48);
  const _cTmp = new THREE.Color();
  const TILT_MIN = Math.acos(1 / 1.1180339887);  // 26.57°：对角线方向
  const TILT_MAX = Math.acos(1 / Math.SQRT2);    // 45°：坐标轴方向

  function updateUmbrella() {
    const pos = umbrella.pos, col = umbrella.col, dirs = umbrella.dirs;
    for (let i = 0; i <= UMB_NT; i++) {
      const ii = i % UMB_NT;
      const th = (ii / UMB_NT) * TAU;
      const bx = PROBE_R * Math.cos(th);
      const by = PROBE_R * Math.sin(th);
      const bz = surfaceZ(bx, by);
      const dx = dirs[ii * 3], dy = dirs[ii * 3 + 1], dz = dirs[ii * 3 + 2];
      const t = Math.max(0, Math.min(1, (umbrella.tilt[ii] - TILT_MIN) / (TILT_MAX - TILT_MIN)));
      if (t < 0.5) _cTmp.copy(_cLow).lerp(_cMid, t * 2);
      else _cTmp.copy(_cMid).lerp(_cHigh, (t - 0.5) * 2);
      for (let j = 0; j <= UMB_NL; j++) {
        const l = (j / UMB_NL) * UMB_L;
        const id = i * (UMB_NL + 1) + j;
        const o = id * 3;
        pos[o] = bx + dx * l;
        pos[o + 1] = by + dy * l;
        pos[o + 2] = bz + dz * l;
        const fade = 1 - 0.45 * (j / UMB_NL);
        col[o] = _cTmp.r * fade; col[o + 1] = _cTmp.g * fade; col[o + 2] = _cTmp.b * fade;
      }
    }
    umbrella.geo.attributes.position.needsUpdate = true;
    umbrella.geo.attributes.color.needsUpdate = true;
  }
  updateUmbrella();

  /* ======================================================================
   * §2  Pose —— GSAP 唯一补间目标
   * ==================================================================== */

  const Pose = {
    theta: 0,          // 剖切角（度）
    rho: 0.5,          // 残差采样半径
    probeDeg: 45,      // 探针方位角（度）
    camX: 0, camY: -3.5, camZ: 1.2,   // 导轨机位（未乘 CAM_FIT）
    surface: 0.50,     // 曲面不透明度
    slice: 0,          // 剖切面强度
    rib: 0,            // 截交线亮起程度
    creaseHi: 0,       // 折痕尖顶品红高亮
    tangent: 0,        // 候选切平面强度
    pillarT: 0,        // 残差立柱拉出比例 0→1
    probeT: 0,         // 探针生成比例 0→1
    umb: 0             // 法向轨迹带不透明度
  };

  const _perp = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _nVec = new THREE.Vector3();
  const _upVec = new THREE.Vector3(0, 1, 0);
  const ribBlue = new THREE.Color(0x2563EB);
  const ribCyan = new THREE.Color(0x0EA5E9);
  const ribRose = new THREE.Color(0xE11D48);
  const ribTmp = new THREE.Color();
  const ribHot = new THREE.Color();   // 预分配，避免逐顶点 new Color()

  /** 注记缩放：使测量类注记在屏幕上保持恒定像素尺寸（设计方案 §四.7） */
  let annotScale = 0.02;
  function computeAnnotScale() {
    const d = camera.position.distanceTo(controls.target);
    annotScale = Math.max(0.0016, d * 0.0065);
  }

  /** 依据 Pose 刷新剖面截交线（仅更新预分配数组） */
  function updateRibbon() {
    const phi = Pose.theta * D2R;
    const u = dirU(phi);
    const sc = Math.sin(phi) * Math.cos(phi);
    const pos = ribbon.pos, col = ribbon.col;
    const half = annotScale * (0.45 + 0.95 * Pose.rib);
    // 基准色随 rib 由钴蓝提亮为青色，折痕尖顶（|s| 小）叠加品红
    ribTmp.copy(ribBlue).lerp(ribCyan, Math.min(1, Pose.rib));
    for (let i = 0; i < RIB_N; i++) {
      const s = -R + (2 * R * i) / (RIB_N - 1);
      const z = sliceProfile(s, phi);
      const gp = s > 0 ? sc : -sc;   // z'(s)
      _perp.set(gp * u.x, gp * u.y, -1).normalize();
      const taper = 0.34 + 0.66 * Math.min(1, Math.abs(s) / 0.22);  // 尖顶收窄使 V 更锐
      const hw = half * taper;
      _p.set(s * u.x, s * u.y, z);
      const o = i * 6;
      pos[o] = _p.x + _perp.x * hw; pos[o + 1] = _p.y + _perp.y * hw; pos[o + 2] = _p.z + _perp.z * hw;
      pos[o + 3] = _p.x - _perp.x * hw; pos[o + 4] = _p.y - _perp.y * hw; pos[o + 5] = _p.z - _perp.z * hw;
      const hot = Pose.creaseHi > 0.01 && Math.abs(s) < 0.28;
      if (hot) ribHot.copy(ribTmp).lerp(ribRose, Pose.creaseHi);
      const c = hot ? ribHot : ribTmp;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      col[o + 3] = c.r; col[o + 4] = c.g; col[o + 5] = c.b;
    }
    ribbon.geo.attributes.position.needsUpdate = true;
    ribbon.geo.attributes.color.needsUpdate = true;
  }

  /** 依据 Pose 刷新残差立柱：底端在 z=0 平面，顶端贴合曲面，注记随视距缩放 */
  function updatePillar() {
    const phi = Pose.theta * D2R;
    const u = dirU(phi);
    const zFull = sliceProfile(Pose.rho, phi);
    const z = zFull * Pose.pillarT;
    const ann = annotScale;
    pillar.base.set(Pose.rho * u.x, Pose.rho * u.y, 0);
    pillar.height = z;
    pillar.shaft.position.copy(pillar.base);
    pillar.shaft.scale.set(ann, Math.max(z, ann * 0.01), ann);
    pillar.ringTop.position.set(pillar.base.x, pillar.base.y, z);
    pillar.ringTop.scale.set(ann, ann, ann);
    pillar.ringBot.position.set(pillar.base.x, pillar.base.y, 0);
    pillar.ringBot.scale.set(ann, ann, ann);
    pillar.halo.position.set(pillar.base.x, pillar.base.y, 0.001);
    pillar.halo.scale.set(ann, ann, ann);
    const solid = z > ann * 0.05;
    pillar.ringTop.visible = solid;
    pillar.shaft.visible = solid;
  }

  /** 依据 Pose 刷新探针位置与法向量方向 */
  function updateProbe() {
    const th = Pose.probeDeg * D2R;
    const x = PROBE_R * Math.cos(th);
    const y = PROBE_R * Math.sin(th);
    probe.grp.position.set(x, y, surfaceZ(x, y));
    const gr = surfaceGrad(x, y);
    _nVec.set(-gr.fx, -gr.fy, 1).normalize();
    probe.grp.quaternion.setFromUnitVectors(_upVec, _nVec);
    probe.grp.scale.setScalar(Math.max(0.001, Pose.probeT));
    probe.grp.updateMatrixWorld();
  }

  /**
   * Pose → 场景。GSAP 只补间 Pose 数值，此处是唯一的几何重建入口。
   * 剖面角、相机、探针姿态均直接来自 Pose，无需 lerp。
   */
  function applyPose() {
    const phi = Pose.theta * D2R;
    computeAnnotScale();

    sliceGroup.grp.rotation.z = phi;
    surfaceMat.opacity = Pose.surface;

    sliceMat.opacity = Pose.slice * 0.22;
    sliceEdgeMat.opacity = Pose.slice;
    sliceGroup.face.visible = Pose.slice > 0.001;
    sliceGroup.edge.visible = Pose.slice > 0.001;

    tangentMat.opacity = Pose.tangent * 0.9;
    tangentPlane.mesh.visible = Pose.tangent > 0.001;
    tangentPlane.border.visible = Pose.tangent > 0.001;

    ribbon.mesh.visible = Pose.rib > 0.001;
    updateRibbon();

    pillar.grp.visible = Pose.pillarT > 0.001;
    updatePillar();

    probeTrack.visible = Pose.probeT > 0.001;
    probe.grp.visible = Pose.probeT > 0.001;
    if (Pose.probeT > 0.001) updateProbe();

    umbrella.mesh.visible = Pose.umb > 0.001;
    umbrella.mesh.material.opacity = Pose.umb;

    const cf = CAM_FIT * State.camFitFactor;
    camera.position.set(Pose.camX * cf, Pose.camY * cf, Pose.camZ * cf);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  /* ======================================================================
   * §3  3D 漂浮文字 Label（手动投影定位，零额外 CDN 依赖）
   * ==================================================================== */

  function makeLabel(text, cls) {
    const el = document.createElement('div');
    el.className = 'world-label ' + (cls || 'lbl-stone');
    el.textContent = text;
    labelLayerEl.appendChild(el);
    return el;
  }
  const labels = {
    origin: makeLabel('O (0, 0, 0)', 'lbl-stone'),
    slice: makeLabel('剖切角 θ = 0.0°', 'lbl-amber'),
    crease: makeLabel('V 折痕  k± = ±0.000', 'lbl-blue'),
    dz: makeLabel('Δz = 0.000', 'lbl-rose'),
    normal: makeLabel('法向 n ∝ (−sin³θ, −cos³θ, 1)', 'lbl-green'),
    track: makeLabel('巡检环 r = 0.2', 'lbl-green')
  };
  const _proj = new THREE.Vector3();
  const _vOrigin = new THREE.Vector3();
  const _vSlice = new THREE.Vector3();
  const _vCrease = new THREE.Vector3();
  const _vDz = new THREE.Vector3();
  const _vTrack = new THREE.Vector3();

  function placeLabel(el, world, show) {
    if (!show) { el.classList.remove('is-visible'); return; }
    _proj.copy(world).project(camera);
    const w = viewportEl.clientWidth, h = viewportEl.clientHeight;
    if (_proj.z > 1) { el.classList.remove('is-visible'); return; }
    const x = (_proj.x * 0.5 + 0.5) * w;
    const y = (-_proj.y * 0.5 + 0.5) * h;
    el.style.transform = 'translate(-50%, -50%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    el.classList.add('is-visible');
  }

  function updateLabels(showSet) {
    const phi = Pose.theta * D2R;
    const u = dirU(phi);
    const has = (k) => showSet.indexOf(k) >= 0;

    _vOrigin.set(0, 0, -0.14);
    placeLabel(labels.origin, _vOrigin, has('origin'));

    _vSlice.set(R * u.x, R * u.y, HZ * 0.82);
    placeLabel(labels.slice, _vSlice, has('slice') && sliceGroup.face.visible);

    _vCrease.set(0.62 * u.x, 0.62 * u.y, sliceProfile(0.62, phi) + 0.10);
    placeLabel(labels.crease, _vCrease, has('crease'));

    if (pillar.height > annotScale * 0.05) {
      _vDz.set(
        pillar.base.x - u.y * annotScale * 5,
        pillar.base.y + u.x * annotScale * 5,
        pillar.height * 0.55 + annotScale * 1.2
      );
      placeLabel(labels.dz, _vDz, has('dz'));
    } else {
      labels.dz.classList.remove('is-visible');
    }

    if (probe.grp.visible) {
      _vTrack.copy(probe.grp.position);
      _vTrack.x += _nVec.x * probe.ARROW_L * 1.15;
      _vTrack.y += _nVec.y * probe.ARROW_L * 1.15;
      _vTrack.z += _nVec.z * probe.ARROW_L * 1.15;
    }
    placeLabel(labels.normal, _vTrack, has('normal') && probe.grp.visible);

    const trackAng = Pose.probeDeg * D2R + 110 * D2R;
    _vTrack.set(PROBE_R * 1.5 * Math.cos(trackAng), PROBE_R * 1.5 * Math.sin(trackAng), -0.30);
    placeLabel(labels.track, _vTrack, has('track') && probeTrack.visible);
  }

  /* ======================================================================
   * §4  HUD：KaTeX 动态重绘 / 解算数据卡 / 15 Beat 轨
   * ==================================================================== */

  const hasKatex = typeof window.katex !== 'undefined';
  const hasAutoRender = typeof window.renderMathInElement === 'function';
  const DELIMS = [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false }
  ];

  /** AGENTS.md §3.7：动态 LaTeX 必须走 katex.render，CDN 失效时降级为纯文本 */
  function setMath(el, latex, fallback) {
    if (!el) return;
    if (hasKatex) {
      try { window.katex.render(latex, el, { throwOnError: false, displayMode: false }); return; }
      catch (e) { /* 落到纯文本 */ }
    }
    el.textContent = fallback;
  }

  /** 状态看板为「HTML 强调 + 内嵌公式」混排，须用 auto-render（katex.render 会吞掉 HTML 标签） */
  function setVerdict(html) {
    if (!verdictTextEl) return;
    verdictTextEl.innerHTML = html;
    if (hasAutoRender) {
      try { window.renderMathInElement(verdictTextEl, { delimiters: DELIMS, throwOnError: false }); }
      catch (e) { /* 保留纯文本 */ }
    }
  }

  const cardTheta = document.querySelector('[data-math-value="theta"]');
  const cardSlope = document.querySelector('[data-math-value="slope"]');
  const cardDz = document.querySelector('[data-math-value="dz"]');
  const cardRatio = document.querySelector('[data-math-value="ratio"]');
  const cardThetaBox = document.getElementById('card-theta');
  const cardSlopeBox = document.getElementById('card-slope');
  const cardDzBox = document.getElementById('card-dz');
  const cardRatioBox = document.getElementById('card-ratio');
  const labelThetaEl = document.getElementById('label-theta');
  const labelRhoEl = document.getElementById('label-rho');
  const verdictTextEl = document.getElementById('verdict-text');
  const hudBeatTagEl = document.getElementById('hud-beat-tag');
  const beatReadoutEl = document.getElementById('beat-readout');
  const phaseChips = Array.prototype.slice.call(document.querySelectorAll('.phase-chip'));
  const beatTrackEl = document.getElementById('beat-track');

  /** 数值卡与 3D Label 文案：补间每帧调用（纯 textContent / katex.render，节流良好） */
  function syncNumericHUD() {
    const phi = Pose.theta * D2R;
    const k = creaseSlope(phi);
    const dz = sliceProfile(Pose.rho, phi) * Pose.pillarT;
    const ratio = Pose.rho > 1e-6 ? dz / Pose.rho : 0;

    setMath(cardTheta, Pose.theta.toFixed(1) + '^{\\circ}', Pose.theta.toFixed(1) + '°');
    setMath(cardSlope, '\\pm\\,' + Math.abs(k).toFixed(3), '± ' + Math.abs(k).toFixed(3));
    setMath(cardDz, dz.toFixed(3), dz.toFixed(3));
    setMath(cardRatio, ratio.toFixed(3), ratio.toFixed(3));

    // 状态语义：k = 0 → 该方向无折痕（绿）；k ≠ 0 → 存在折痕与悬空残差（品红）
    const flat = Math.abs(k) < 1e-3;
    [cardThetaBox, cardSlopeBox, cardDzBox, cardRatioBox].forEach(function (box) {
      box.classList.toggle('is-ok', flat);
      box.classList.toggle('is-alarm', !flat);
    });

    if (labelThetaEl) labelThetaEl.textContent = Pose.theta.toFixed(1) + '°';
    if (labelRhoEl) labelRhoEl.textContent = Pose.rho.toFixed(2);

    labels.slice.textContent = '剖切角 θ = ' + Pose.theta.toFixed(1) + '°';
    labels.crease.textContent = 'V 折痕  k± = ±' + Math.abs(k).toFixed(3);
    labels.dz.textContent = 'Δz = ' + dz.toFixed(3) + '   (ρ = ' + Pose.rho.toFixed(2) + ')';
  }

  /* ---------- 15 Beat 进度轨 ---------- */

  /**
   * 15 拍终态目标表
   * 每项 = 该拍动画结束后的 Pose 快照（未列字段沿用前值）。
   * 缓动与时长严格取自《设计方案.md》§三《动作时序规格表》。
   */
  const BEATS = [
    // ── Phase 1【正交盲区】运镜 (0,-3.5,1.2) → (2.8,-2.8,2.2)
    { phase: 0, beat: 0, dur: 0.250, ease: 'power1.out', label: 'origin',
      to: { surface: 0.40, slice: 0.70 }, verdict: '<strong>上下文建立</strong> —— 单刀剖切面在 $X$ 轴位置淡入，曲面主体降权。此时剖线完全水平，$k_\\pm=0$。' },
    { phase: 0, beat: 1, dur: 0.200, ease: 'sine.out', label: 'origin,slice,crease',
      to: { rib: 1.0 }, topo: 'exists', verdict: '<strong>产生预期</strong> —— 截交线亮起为一条青色直线，斜率标签 $k=0$；$f_x(0,0)=f_y(0,0)=0$，偏导存在。' },
    { phase: 0, beat: 2, dur: 1.200, ease: 'power2.inOut', label: 'origin,slice,crease',
      to: { theta: 45, surface: 0.50, slice: 0.16, camX: 2.8, camY: -2.8, camZ: 2.2 },
      verdict: '<strong>核心动作</strong> —— 单刀剖面绕 $Z$ 轴由 $0^\\circ$ 匀速旋转至 $45^\\circ$，相机同步推至斜俯视角；截交线实时扭曲，$k_\\pm$ 同步增长。' },
    { phase: 0, beat: 3, dur: 0.250, ease: 'power4.out', label: 'origin,slice,crease',
      to: { creaseHi: 1, camX: 2.2, camY: -2.2, camZ: 1.9 },
      verdict: '<strong>落位沉淀</strong> —— $45^\\circ$ 瞬间蜕变为锐利 $V$ 字折痕，$k_\\pm=\\pm\\frac12\\sin90^\\circ=\\pm 0.500$。' },
    { phase: 0, beat: 4, dur: 0.300, ease: 'power1.inOut', label: 'origin,slice,crease',
      to: { surface: 0.55, tangent: 0.26, camX: 1.9, camY: -1.9, camZ: 1.7 },
      topo: 'break', verdict: '<strong>状态确认</strong> —— 正交方向光滑，全向却有折痕！<span class="text-rose-700 font-semibold">连续 $\\wedge$ 偏导存在 $\\nRightarrow$ 可微</span>。' },

    // ── Phase 2【可微破产】运镜 (2.8,-2.8,2.2) → (0.4,-0.4,0.35)
    { phase: 1, beat: 0, dur: 0.300, ease: 'power2.out', label: 'origin,crease',
      to: { slice: 0, surface: 0.42, tangent: 0.30, camX: 2.4, camY: -2.4, camZ: 2.0 },
      verdict: '<strong>上下文建立</strong> —— 阶段 1 剖切面淡出；由 $f_x(0,0)=f_y(0,0)=0$ 张开唯一候选切平面 $z=0$。' },
    { phase: 1, beat: 1, dur: 0.400, ease: 'power2.inOut', label: 'origin,crease',
      to: { tangent: 0.22, camX: 0.95, camY: -0.95, camZ: 0.80 },
      verdict: '<strong>产生预期</strong> —— 相机全自动推进原点做 $5\\times$ 微观特写，模拟极限过程 $\\rho\\to 0$。' },
    { phase: 1, beat: 2, dur: 0.700, ease: 'power2.inOut', label: 'origin,crease,dz',
      to: { pillarT: 1.0, rho: 0.5, tangent: 0.20, camX: 0.40, camY: -0.40, camZ: 0.35 },
      verdict: '<strong>核心动作</strong> —— 在对角线上垂直拉出品红测量立柱，连接切平面与曲面的悬空缝隙，标尺由 $0$ 拉伸至 $\\Delta z$。' },
    { phase: 1, beat: 3, dur: 0.250, ease: 'power4.out', label: 'origin,crease,dz',
      to: { rho: 0.06, camX: 0.34, camY: -0.34, camZ: 0.30 },
      verdict: '<strong>落位沉淀</strong> —— $\\rho$ 压到 $0.06$，$\\Delta z$ 同步缩小，但比值<strong>纹丝不动</strong>。' },
    { phase: 1, beat: 4, dur: 0.300, ease: 'power1.inOut', label: 'origin,crease,dz',
      to: { surface: 0.45, tangent: 0.18, camX: 0.32, camY: -0.32, camZ: 0.28 },
      topo: 'diff-dead', verdict: '<strong>状态确认</strong> —— $\\lim_{\\rho\\to0}\\frac{\\Delta z-0}{\\rho}=\\frac12\\neq0$，残差并非高阶无穷小，<span class="text-rose-700 font-semibold">函数不可微</span>！' },

    // ── Phase 3【法向撕裂】运镜 (0.4,-0.4,0.35) → (2.2,2.2,2.8)
    { phase: 2, beat: 0, dur: 0.400, ease: 'power2.out', label: 'origin,track',
      to: { pillarT: 0, probeT: 1, probeDeg: 45, tangent: 0.12, camX: 2.2, camY: 2.2, camZ: 2.8 },
      verdict: '<strong>上下文建立</strong> —— 残差立柱淡出；由微观特写抬升至鸟瞰俯视位，$r=0.2$ 巡检环与法向探针生成。' },
    { phase: 2, beat: 1, dur: 0.200, ease: 'sine.out', label: 'origin,track,normal',
      to: { tangent: 0.10, camX: 2.4, camY: 2.4, camZ: 3.1 },
      verdict: '<strong>产生预期</strong> —— 环形导轨跑马灯高亮，探针尖端呼吸聚光。' },
    { phase: 2, beat: 2, dur: 1.200, ease: 'linear', label: 'origin,track,normal',
      to: { probeDeg: 405, umb: 0.16, tangent: 0.09, camX: 2.0, camY: 2.0, camZ: 2.5 },
      verdict: '<strong>核心动作</strong> —— 探针沿圆周轨道匀速巡检一周：法向量在直立与倾斜之间剧烈摆动，扫出起伏的半透明法向轨迹带。' },
    { phase: 2, beat: 3, dur: 0.250, ease: 'power1.out', label: 'origin,track,normal',
      to: { umb: 0.30, tangent: 0.08, camX: 1.7, camY: 1.7, camZ: 2.3 },
      verdict: '<strong>落位沉淀</strong> —— 轨迹带闭合成波浪伞面，着色为警戒热力色阶：绿色近对角线（倾角 $26.6^\\circ$）、品红近坐标轴（倾角 $45^\\circ$）。' },
    { phase: 2, beat: 4, dur: 0.250, ease: 'power1.inOut', label: 'origin,track,normal',
      to: { umb: 0.34, tangent: 0.07, camX: 2.2, camY: 2.2, camZ: 2.8 },
      topo: 'c1-dead', verdict: '<strong>状态确认</strong> —— 沿 $y=x$ 有 $f_x\\to\\pm\\frac{1}{2\\sqrt2}\\neq0=f_x(0,0)$，偏导极限不存在，<span class="text-rose-700 font-semibold">$C^1$ 充分条件不满足</span>！' }
  ];

  const TOTAL_BEATS = BEATS.length;

  BEATS.forEach(function (_, i) {
    if (i > 0 && i % 5 === 0) {
      const sep = document.createElement('span');
      sep.className = 'beat-sep';
      beatTrackEl.appendChild(sep);
    }
    const d = document.createElement('div');
    d.className = 'beat-dot';
    beatTrackEl.appendChild(d);
  });
  const beatDots = Array.prototype.slice.call(beatTrackEl.querySelectorAll('.beat-dot'));

  /* ---------- 概念拓扑看板渐进点亮 ---------- */

  const topo = {
    nodeExists: document.getElementById('node-exists'),
    nodeCont: document.getElementById('node-cont'),
    nodeDiff: document.getElementById('node-diff'),
    nodeC1: document.getElementById('node-c1'),
    edgeBreak: document.getElementById('edge-break'),
    edgeA: document.getElementById('edge-1'),   // 偏导连续 ⟹ 偏导存在
    edgeB: document.getElementById('edge-2'),   // 偏导连续 ⟹ 可微
    edgeC: document.getElementById('edge-3')    // 偏导存在 ⟹ 连续
  };
  const TOPO_MARKS = { exists: 'on', break: 'cont', 'diff-dead': 'diff', 'c1-dead': 'c1' };

  function setClass(el, cls) { if (el) el.setAttribute('class', cls); }

  function applyTopo(mark) {
    const g = TOPO_MARKS[mark];
    if (!g) return;
    if (g === 'on') setClass(topo.nodeExists, 'topo-node topo-on');
    if (g === 'cont') {
      // 连续点亮时，同步点亮「偏导存在 ⟹ 连续」，并击破「连续 ⇏ 可微」
      setClass(topo.nodeCont, 'topo-node topo-on');
      setClass(topo.edgeC, 'topo-edge is-lit');
      setClass(topo.edgeBreak, 'topo-edge is-broken');
    }
    if (g === 'diff') setClass(topo.nodeDiff, 'topo-node topo-dead');
    if (g === 'c1') {
      // 偏导连续拿到判决时，两条以其为前提的定理连线一并点亮
      setClass(topo.nodeC1, 'topo-node topo-dead');
      setClass(topo.edgeA, 'topo-edge is-lit');
      setClass(topo.edgeB, 'topo-edge is-lit');
    }
    // 状态看板同步打印
    const tips = {
      on: '<strong>偏导存在 ✓</strong> —— $f(x,0)\\equiv0$ 且 $f(0,y)\\equiv0$，故 $f_x(0,0)=f_y(0,0)=0$ 均存在。',
      cont: '<strong>连续 ✓</strong> —— 由 $|xy|\\le\\frac{x^2+y^2}{2}$ 得 $|f|\\le\\frac{\\rho}{2}\\to0$。同时「连续 $\\nRightarrow$ 可微」被本例击破。',
      diff: '<strong>可微 ✕</strong> —— 候选切平面 $z=0$ 无法张成：沿 $y=x$ 方向残差比 $\\frac{\\Delta z}{\\rho}\\equiv\\frac12\\neq0$。',
      c1: '<strong>偏导连续 ✕</strong> —— 沿 $y=x$ 方向 $f_x\\to\\pm\\frac{1}{2\\sqrt2}\\neq0=f_x(0,0)$，偏导在原点极限不存在。'
    };
    setVerdict(tips[g]);
  }

  function resetTopo() {
    setClass(topo.nodeExists, 'topo-node topo-off');
    setClass(topo.nodeCont, 'topo-node topo-off');
    setClass(topo.nodeDiff, 'topo-node topo-off');
    setClass(topo.nodeC1, 'topo-node topo-off');
    setClass(topo.edgeA, 'topo-edge');
    setClass(topo.edgeB, 'topo-edge');
    setClass(topo.edgeC, 'topo-edge');
    setClass(topo.edgeBreak, 'topo-edge');
  }

  /* ======================================================================
   * §5  GSAP 主时间轴（3 Phase × 5 Beat，单条 15 段）
   * ==================================================================== */

  const State = {
    speed: 1.0,
    isPlaying: false,
    beat: 0,        // 当前拍索引 0~14
    labelSet: BEATS[0].label,
    camFitFactor: 1
  };

  let master = null;
  let seekTween = null;     // 当前在飞的 tweenTo 补间
  const beatLabels = [];    // 与 BEATS 同序的时间轴 label 名
  const beatStart = [];     // 每拍的起始时间（秒）

  /**
   * 防呆铁律 §3.5：任何切换前彻底杀死前序补间与计时器。
   * 注意此处**不能**直接用 gsap.killTweensOf('*')：主时间轴的内部子补间正是以 Pose
   * 为目标创建的，'*' 会把它们一并杀死并从时间轴上摘除，导致后续播放彻底失效。
   * 故只杀死「在飞的 seek 补间」并暂停主时间轴，即完整达成清场意图又不损伤时间轴。
   */
  function clearTweens() {
    if (seekTween) { seekTween.kill(); seekTween = null; }
    if (master) master.pause();
  }

  function setAnimating(on) {
    controls.enabled = !on;                    // 运镜期间锁定相机，避免与导轨打架
    if (exploreHintEl) exploreHintEl.classList.toggle('is-on', !on);
  }

  /** 某一拍开始时刷新：状态看板、3D Label 集合、Beat 轨、Phase 芯片、拓扑点亮 */
  function onBeatStart(i) {
    const rec = BEATS[i];
    State.beat = i;
    State.labelSet = rec.label;

    setVerdict(rec.verdict);
    if (rec.topo) applyTopo(rec.topo);

    beatDots.forEach(function (dot, k) {
      dot.classList.toggle('is-done', k < i);
      dot.classList.toggle('is-current', k === i);
    });
    if (beatReadoutEl) beatReadoutEl.textContent = (i + 1) + ' / ' + TOTAL_BEATS;
    if (hudBeatTagEl) hudBeatTagEl.textContent = 'BEAT 0' + (rec.beat + 1) + '/05';
    phaseChips.forEach(function (chip) {
      chip.classList.toggle('is-active', Number(chip.dataset.phase) === rec.phase + 1);
    });
    const btnPrev = document.getElementById('btn-prev');
    if (btnPrev) btnPrev.disabled = (i === 0);

    // 纸面滑块同步（用户可继续拖拽覆盖）
    const st = document.getElementById('slider-theta');
    const sr = document.getElementById('slider-rho');
    if (st) st.value = String(Pose.theta);
    if (sr) sr.value = String(Pose.rho);
  }

  /**
   * 由播放头时间反推当前拍索引
   * 不使用 master.call() 派发拍级 UI：seek 恰好落在某个 label 上时，call 回调与
   * tweenTo 的 onComplete 触发次序不确定，会导致「刚结束一拍就被下一拍的 UI 抢跑」。
   * 以时间反查则前进、后退、seek 三种情形下都完全确定。
   */
  function syncBeatFromTime() {
    const t = master.time();
    let idx = 0;
    for (let i = 0; i < TOTAL_BEATS; i++) {
      if (t >= beatStart[i] - 1e-6) idx = i; else break;
    }
    if (idx !== State.beat) onBeatStart(idx);
  }

  function buildTimeline() {
    if (!window.gsap) return;
    clearTweens();

    // 起始快照：BEATS[0] 的目标值即 tween 起点，动画从「未建立」演到 Beat 01 终态
    const snapshot = {};
    Object.keys(Pose).forEach(function (k) { snapshot[k] = Pose[k]; });

    master = window.gsap.timeline({
      paused: true,
      onUpdate: function () {
        applyPose();
        syncNumericHUD();
        syncBeatFromTime();
      },
      onComplete: function () {
        State.isPlaying = false;
        setAnimating(false);
        refreshPlayBtn();
      }
    });

    let t = 0;
    for (let i = 0; i < TOTAL_BEATS; i++) {
      const rec = BEATS[i];
      beatLabels.push('b' + i);
      beatStart.push(t);
      master.addLabel('b' + i, t);

      // 只对 BEATS[i].to 里列出的字段做补间；时长与缓动严格取自《动作时序规格表》
      const target = {};
      Object.keys(rec.to).forEach(function (k) { target[k] = rec.to[k]; });
      if (Object.keys(target).length) {
        master.to(Pose, Object.assign({}, target, {
          duration: rec.dur,
          ease: rec.ease
        }), t);
      }
      t += rec.dur;
    }

    // 复位到初始姿态
    master.pause(0);
    Object.keys(snapshot).forEach(function (k) { Pose[k] = snapshot[k]; });
    applyPose();
    syncNumericHUD();
  }

  /* ======================================================================
   * §6  控制器微状态机（前进 / 后退 / 播放暂停 / 复位 / 速率）
   * ==================================================================== */

  const btnPlay = document.getElementById('btn-play');
  const btnPlayText = document.getElementById('btn-play-text');
  const btnPlayIcon = document.getElementById('btn-play-icon');

  function refreshPlayBtn() {
    if (btnPlayText) btnPlayText.textContent = State.isPlaying ? '暂停' : '播放/暂停';
    if (btnPlayIcon) btnPlayIcon.textContent = State.isPlaying ? '⏸' : '▶';
  }

  /**
   * 播放头寻址
   * @param {number} idx    目标拍索引
   * @param {number} mode   +1 = 正向演完第 idx 拍（目标时刻 = 该拍结束点）
   *                       -1 = 反向回退第 idx 拍（目标时刻 = 该拍起始点）
   * @param {boolean} wrap  是否为「末拍回绕」，回绕时先瞬时归位再重演，避免整段倒放
   *
   * 约定：`State.beat` 与拍轨上高亮的永远是「下一拍将要演出的那一拍」。
   * 因此「下一步」播放的是**当前显示的这一拍**，播完由 syncBeatFromTime 自动前进一格；
   * 「上一步」则把播放头倒回前一拍的起点，从而把该拍的补间倒放一遍。
   */
  function seekBeatTo(idx, mode, wrap) {
    if (!master) return;
    clearTweens();
    State.isPlaying = false;
    setAnimating(true);
    refreshPlayBtn();

    const target = mode > 0 ? beatStart[idx] + BEATS[idx].dur : beatStart[idx];
    let from = master.time();

    if (wrap) {
      master.seek(beatStart[idx], false);   // 末拍回绕：瞬时归位，不放 6 秒整段回卷
      onBeatStart(idx);
      from = beatStart[idx];
    }

    if (Math.abs(target - from) < 1e-4) {
      master.seek(target);
      onBeatStart(idx);
      applyPose();
      syncNumericHUD();
      setAnimating(false);
      return;
    }
    seekTween = master.tweenTo(target, {
      duration: Math.max(0.18, Math.abs(target - from)) / State.speed,
      ease: mode < 0 ? 'power2.inOut' : 'power2.out',
      onComplete: function () { seekTween = null; setAnimating(false); }
    });
  }

  if (btnPlay) {
    btnPlay.addEventListener('click', function () {
      if (!master) return;
      clearTweens();
      if (State.isPlaying) {
        master.pause();
        State.isPlaying = false;
        setAnimating(false);
        refreshPlayBtn();
        return;
      }
      // 已到末拍则从头连播
      if (master.time() >= master.totalDuration() - 1e-3) {
        master.seek(0, false);
        onBeatStart(0);
      }
      State.isPlaying = true;
      setAnimating(true);
      refreshPlayBtn();
      master.timeScale(State.speed);
      master.play();
    });
  }

  document.getElementById('btn-next').addEventListener('click', function () {
    // 播放当前显示的这一拍；已是末拍则回绕到第 1 拍
    if (State.beat === TOTAL_BEATS - 1) seekBeatTo(0, 1, true);
    else seekBeatTo(State.beat, 1, false);
  });
  document.getElementById('btn-prev').addEventListener('click', function () {
    if (State.beat === 0) return;
    seekBeatTo(State.beat - 1, -1, false);
  });
  document.getElementById('btn-reset').addEventListener('click', function () {
    if (!master) return;
    clearTweens();
    master.pause(0);
    State.isPlaying = false;
    setAnimating(false);
    refreshPlayBtn();
    // 拓扑看板复位
    resetTopo();
    onBeatStart(0);
    applyPose();
    syncNumericHUD();
  });

  // 纸面滑块：与时间轴共存，拖拽即脱离自动运镜（防呆铁律：先杀补间）
  ['slider-theta:theta', 'slider-rho:rho'].forEach(function (pair) {
    const parts = pair.split(':');
    const el = document.getElementById(parts[0]);
    if (!el) return;
    el.addEventListener('input', function (e) {
      clearTweens();
      if (master) master.pause();
      State.isPlaying = false;
      setAnimating(false);
      refreshPlayBtn();
      Pose[parts[1]] = parseFloat(e.target.value);
      applyPose();
      syncNumericHUD();
      updateLabels(State.labelSet);
    });
  });

  const labelSpeed = document.getElementById('label-speed');
  const sliderSpeed = document.getElementById('slider-speed');
  if (sliderSpeed) {
    sliderSpeed.addEventListener('input', function (e) {
      State.speed = parseFloat(e.target.value);
      if (labelSpeed) labelSpeed.textContent = State.speed.toFixed(1) + 'x';
      // 防呆铁律 §3.4：速率以 timeScale 联动，不做 duration 手工除法
      if (master) master.timeScale(State.speed);
    });
  }

  /* ======================================================================
   * §7  视口弹性自适应（防呆铁律 §3.6）
   * ==================================================================== */

  function resize() {
    const w = viewportEl.clientWidth || stageEl.clientWidth || 1;
    const h = viewportEl.clientHeight || stageEl.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 窄高视口按需后拉机位，保证曲面完整入画
    State.camFitFactor = Math.max(1, 0.95 / Math.max(camera.aspect, 0.35));
    camera.updateProjectionMatrix();
    if (master) { applyPose(); }
  }
  window.addEventListener('resize', resize);

  /* ======================================================================
   * §8  渲染循环
   * ==================================================================== */

  let readoutAcc = 0;
  function tick() {
    requestAnimationFrame(tick);
    if (controls.enabled) controls.update();
    // 注记随视距缩放，补间/拖拽期间每帧重算（仅更新预分配数组，Zero GC）
    if (Pose.rib > 0.001) updateRibbon();
    if (Pose.pillarT > 0.001) updatePillar();
    updateLabels(State.labelSet);

    if (probe.grp.visible) {
      probe.tip.material.opacity = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 320));
    }

    readoutAcc += 1;
    if (readoutAcc % 8 === 0 && camReadoutEl) {
      camReadoutEl.textContent = 'CAM (' +
        camera.position.x.toFixed(2) + ', ' +
        camera.position.y.toFixed(2) + ', ' +
        camera.position.z.toFixed(2) + ')';
    }

    renderer.render(scene, camera);
  }

  /* ======================================================================
   * §9  启动
   * ==================================================================== */

  function init() {
    // 页面静态文本中的 $...$ 公式交给 KaTeX auto-render
    if (hasAutoRender) {
      try { window.renderMathInElement(document.body, { delimiters: DELIMS, throwOnError: false }); }
      catch (e) { /* 保留纯文本 */ }
    }
    document.querySelectorAll('[data-math]').forEach(function (el) {
      if (!hasKatex) return;
      try { window.katex.render(el.getAttribute('data-math'), el, { throwOnError: false, displayMode: true }); }
      catch (e) { /* 保持纯文本 */ }
    });

    resize();
    buildTimeline();
    onBeatStart(0);
    applyPose();
    syncNumericHUD();
    updateLabels(State.labelSet);
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
