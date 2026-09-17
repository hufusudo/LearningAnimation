/**
 * 空间直线间距离 & 直线在平面上的投影
 * ---------------------------------------------------------------
 * 模块 A：两直线的位置关系（平行 / 相交 / 重合 / 异面）与距离 d
 *         三层理解：① 公垂线段（最小值定义）
 *                   ② 平行六面体 d = V / S（混合积 / 叉积模）
 *                   ③ 平面法（过 L₁ 作 π ∥ L₂，化为点到平面距离）
 * 模块 B：直线在平面上的投影
 *         L′ = π ∩ π′，π′ 为「过 L 且垂直于 π」的投影平面
 * ---------------------------------------------------------------
 */
'use strict';

/* ============================ 0. 常量与状态 ============================ */

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clampBox = (v, r = 5.4) => {
  v.x = Math.max(-r, Math.min(r, v.x));
  v.y = Math.max(-r, Math.min(r, v.y));
  v.z = Math.max(-r, Math.min(r, v.z));
  return v;
};
const fmt = (x, n = 2) => (Math.abs(x) < 5e-3 ? 0 : x).toFixed(n);
const vecStr = (v, n = 2) => `(${fmt(v.x, n)}, ${fmt(v.y, n)}, ${fmt(v.z, n)})`;

const HANDLE_R = 1.55;   // 方向手柄球到锚点的距离
const LINE_HALF = 5.0;   // 直线绘制半长
const PAR_EPS = 0.03;    // |s1×s2| 判为平行的阈值
const DIST_EPS = 0.012;  // 距离判为 0 的阈值

const state = {
  module: 'A',
  caseA: 'skew',
  modeA: 'common',
  caseB: 'oblique',
  ta: 0, ub: 0, tb: 0,
  alpha: 0,           // 平面倾角（度）
  layers: {
    aCommon: true, aBox: true, aPlane: true, aPoints: true,
    bProjPlane: true, bDrops: true, bProjLine: true, bPlane: true
  }
};

const L1 = { P: v3(), d: v3(1, 0, 0) };
const L2 = { P: v3(), d: v3(0, 1, 0) };
const LB = { P: v3(), d: v3(1, 0, 0) };

/* ============================ 1. Three.js 初始化 ============================ */

let scene, camera, renderer, controls, container;
let gridHelper;

const materials = {
  l1:   new THREE.MeshStandardMaterial({ color: 0x2563EB, roughness: 0.32, metalness: 0.15 }),
  l2:   new THREE.MeshStandardMaterial({ color: 0xE11D48, roughness: 0.32, metalness: 0.15 }),
  lb:   new THREE.MeshStandardMaterial({ color: 0x2563EB, roughness: 0.32, metalness: 0.15 }),
  dist: new THREE.MeshStandardMaterial({ color: 0xDC2626, roughness: 0.25, emissive: 0x991B1B, emissiveIntensity: 0.28 }),
  proj: new THREE.MeshStandardMaterial({ color: 0x059669, roughness: 0.28, emissive: 0x047857, emissiveIntensity: 0.25 }),
  anchor: new THREE.MeshStandardMaterial({ color: 0x1D4ED8, roughness: 0.25, emissive: 0x1E40AF, emissiveIntensity: 0.3 }),
  anchor2:new THREE.MeshStandardMaterial({ color: 0xBE123C, roughness: 0.25, emissive: 0x9F1239, emissiveIntensity: 0.3 }),
  handle: new THREE.MeshStandardMaterial({ color: 0xD97706, roughness: 0.2, emissive: 0xB45309, emissiveIntensity: 0.4 }),
  moving: new THREE.MeshStandardMaterial({ color: 0x7C3AED, roughness: 0.22, emissive: 0x5B21B6, emissiveIntensity: 0.35 }),
  projPt: new THREE.MeshStandardMaterial({ color: 0xD97706, roughness: 0.25, emissive: 0xB45309, emissiveIntensity: 0.3 }),
  pierce: new THREE.MeshStandardMaterial({ color: 0x0F766E, roughness: 0.2, emissive: 0x0F766E, emissiveIntensity: 0.4 }),
  plat:  new THREE.MeshBasicMaterial({ color: 0x0D9488, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  ppLat: new THREE.MeshBasicMaterial({ color: 0xD97706, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  boxFace: new THREE.MeshBasicMaterial({ color: 0x6366F1, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }),
  boxBase: new THREE.MeshBasicMaterial({ color: 0x6366F1, transparent: true, opacity: 0.20, side: THREE.DoubleSide, depthWrite: false }),
  boxEdge: new THREE.LineBasicMaterial({ color: 0x4338CA, transparent: true, opacity: 0.75 }),
  dash:  new THREE.LineDashedMaterial({ color: 0x94A3B8, dashSize: 0.16, gapSize: 0.11 }),
  dashA: new THREE.LineDashedMaterial({ color: 0x2563EB, dashSize: 0.14, gapSize: 0.10 }),
  dashB: new THREE.LineDashedMaterial({ color: 0xE11D48, dashSize: 0.14, gapSize: 0.10 }),
  outline: new THREE.LineBasicMaterial({ color: 0x0D9488, transparent: true, opacity: 0.45 }),
  outlineA:new THREE.LineBasicMaterial({ color: 0xD97706, transparent: true, opacity: 0.55 })
};

const groupA = new THREE.Group();
const groupB = new THREE.Group();

window.addEventListener('DOMContentLoaded', () => {
  initThree();
  buildModuleA();
  buildModuleB();
  bindUI();
  initDrag();
  applyPresetA('skew', false);
  applyPresetB('oblique', false);
  refresh();
  animate();
  renderPanel();
  initKaTeX();
});

function initKaTeX() {
  const tryRender = () => {
    if (window.renderMathInElement) {
      window.renderMathInElement(document.body, {
        delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
        throwOnError: false
      });
    } else setTimeout(tryRender, 100);
  };
  tryRender();
}

function initThree() {
  container = document.getElementById('canvas-container');
  THREE.Object3D.DefaultUp.set(0, 0, 1);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xFAF9F5);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 200);
  camera.position.set(7.6, -9.2, 6.6);
  camera.lookAt(0, 0, 0.4);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.target.set(0, 0, 0.4);
  controls.maxDistance = 34;
  controls.minDistance = 2.5;

  scene.add(new THREE.AmbientLight(0xffffff, 0.78));
  const dl1 = new THREE.DirectionalLight(0xffffff, 0.82); dl1.position.set(9, 10, 13); scene.add(dl1);
  const dl2 = new THREE.DirectionalLight(0xE2E8F0, 0.42); dl2.position.set(-10, -9, -6); scene.add(dl2);

  gridHelper = new THREE.GridHelper(12, 24, 0xD6D3CD, 0xE7E5DF);
  gridHelper.rotation.x = Math.PI / 2;
  gridHelper.position.set(0, 0, -0.005);
  scene.add(gridHelper);

  buildReferenceAxes();
  scene.add(groupA);
  scene.add(groupB);

  window.addEventListener('resize', onWindowResize);
}

function buildReferenceAxes() {
  const g = new THREE.Group();
  const L = 5.4, r = 0.016;
  const mk = (from, to, color) => {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const geom = new THREE.CylinderGeometry(r, r, len, 14);
    geom.translate(0, len / 2, 0); geom.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color });
    const m = new THREE.Mesh(geom, mat);
    m.position.copy(from); m.lookAt(to);
    g.add(m);
  };
  mk(v3(-L * 0.72, 0, 0), v3(L, 0, 0), 0xDC2626);
  mk(v3(0, -L * 0.72, 0), v3(0, L, 0), 0x16A34A);
  mk(v3(0, 0, -L * 0.72), v3(0, 0, L), 0x2563EB);
  g.add(makeLabel('+X', '#DC2626', true)); g.children[g.children.length - 1].position.set(L + 0.32, 0, 0);
  g.add(makeLabel('+Y', '#16A34A', true)); g.children[g.children.length - 1].position.set(0, L + 0.32, 0);
  g.add(makeLabel('+Z', '#2563EB', true)); g.children[g.children.length - 1].position.set(0, 0, L + 0.32);
  scene.add(g);
}

/* ============================ 2. 文字标签 (Canvas Sprite) ============================ */

function makeLabel(text, color, small = false) {
  const canvas = document.createElement('canvas');
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.userData = { canvas, texture, text: null, color: null, small };
  sp.renderOrder = 999;
  setLabel(sp, text, color || '#1C1917');
  return sp;
}

function setLabel(sp, text, color) {
  const ud = sp.userData;
  color = color || ud.color || '#1C1917';
  if (ud.text === text && ud.color === color) return;
  ud.text = text; ud.color = color;

  const canvas = ud.canvas, ctx = canvas.getContext('2d');
  const fs = ud.small ? 26 : 30;
  const font = `600 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.font = font;
  const padX = 12, padY = 7;
  const tw = Math.ceil(ctx.measureText(text).width);
  const W = Math.max(46, tw + padX * 2);
  const H = fs + padY * 2;
  canvas.width = W; canvas.height = H;

  ctx.font = font;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = '#E5E4DC';
  ctx.lineWidth = 2;
  const r = 9, x = 2, y = 2, w = W - 4, h = H - 4;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill(); ctx.stroke();

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 1);

  ud.texture.needsUpdate = true;
  const wh = ud.small ? 0.24 : 0.29;
  sp.scale.set(wh * (W / H), wh, 1);
}

/* ============================ 3. 几何构件工具 ============================ */

// 圆柱棒：从 a 到 b
function makeRod(material, radius) {
  const geom = new THREE.CylinderGeometry(1, 1, 1, 16);
  const m = new THREE.Mesh(geom, material);
  m.userData.radius = radius;
  return m;
}
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
function setRod(mesh, a, b, radius) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  if (len < 1e-6) { mesh.visible = false; return; }
  mesh.visible = true;
  mesh.position.copy(a).addScaledVector(_dir, 0.5);
  mesh.quaternion.setFromUnitVectors(_up, _dir.clone().normalize());
  const r = radius !== undefined ? radius : mesh.userData.radius;
  mesh.scale.set(r, len, r);
}

// 虚线
function makeDash(material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1], 3));
  const l = new THREE.Line(g, material);
  l.frustumCulled = false;
  return l;
}
function setDash(line, a, b) {
  const p = line.geometry.attributes.position;
  p.setXYZ(0, a.x, a.y, a.z);
  p.setXYZ(1, b.x, b.y, b.z);
  p.needsUpdate = true;
  line.geometry.computeBoundingSphere();
  line.computeLineDistances();
}

// 直角标记：顶点 vertex，两条单位方向 d1 d2
function makeRightAngle(material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
  const l = new THREE.Line(g, material);
  l.frustumCulled = false;
  return l;
}
function setRightAngle(line, vertex, d1, d2, size) {
  const p = line.geometry.attributes.position;
  const A = vertex.clone().addScaledVector(d1, size);
  const B = vertex.clone().addScaledVector(d1, size).addScaledVector(d2, size);
  const C = vertex.clone().addScaledVector(d2, size);
  p.setXYZ(0, A.x, A.y, A.z);
  p.setXYZ(1, B.x, B.y, B.z);
  p.setXYZ(2, C.x, C.y, C.z);
  p.needsUpdate = true;
  line.geometry.computeBoundingSphere();
}

// 平行四边形：中心 c，基 e1 e2，半边 a b
function makeQuad(mesh) { return mesh; }
function setQuad(mesh, c, e1, e2, a, b) {
  const p0 = c.clone().addScaledVector(e1, -a).addScaledVector(e2, -b);
  const p1 = c.clone().addScaledVector(e1, a).addScaledVector(e2, -b);
  const p2 = c.clone().addScaledVector(e1, a).addScaledVector(e2, b);
  const p3 = c.clone().addScaledVector(e1, -a).addScaledVector(e2, b);
  let attr = mesh.geometry.attributes.position;
  if (!attr || attr.count !== 6) {
    mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(18).fill(0), 3));
    attr = mesh.geometry.attributes.position;
  }
  const arr = attr.array;
  const put = (i, p) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; };
  put(0, p0); put(1, p1); put(2, p2); put(3, p0); put(4, p2); put(5, p3);
  attr.needsUpdate = true;
  mesh.geometry.computeBoundingSphere();
}

// 平行四边形边框（闭合线）
function makeQuadOutline(material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(15).fill(0), 3));
  const l = new THREE.Line(g, material);
  l.frustumCulled = false;
  return l;
}
function setQuadOutline(line, c, e1, e2, a, b) {
  const pts = [
    c.clone().addScaledVector(e1, -a).addScaledVector(e2, -b),
    c.clone().addScaledVector(e1, a).addScaledVector(e2, -b),
    c.clone().addScaledVector(e1, a).addScaledVector(e2, b),
    c.clone().addScaledVector(e1, -a).addScaledVector(e2, b),
    c.clone().addScaledVector(e1, -a).addScaledVector(e2, -b)
  ];
  const p = line.geometry.attributes.position;
  pts.forEach((q, i) => p.setXYZ(i, q.x, q.y, q.z));
  p.needsUpdate = true;
  line.geometry.computeBoundingSphere();
}

// 平行六面体顶点序（bit0→u, bit1→v, bit2→w）
const BOX_CORNERS = [];
for (let i = 0; i < 8; i++) BOX_CORNERS.push([(i & 1) ? 1 : 0, (i & 2) ? 1 : 0, (i & 4) ? 1 : 0]);
const BOX_EDGES = [];
for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) { const j = i ^ bit; if (i < j) BOX_EDGES.push([i, j]); }
const BOX_FACES = [
  [0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]
];

function makeBoxEdges() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(BOX_EDGES.length * 6).fill(0), 3));
  const l = new THREE.LineSegments(g, materials.boxEdge);
  l.frustumCulled = false;
  return l;
}
function makeBoxFaces(material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(BOX_FACES.length * 18).fill(0), 3));
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}
function makeBaseQuad(material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(18).fill(0), 3));
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}

/* ============================ 4. 模块 A 场景构件 ============================ */

const A = {};

function buildModuleA() {
  A.rod1 = makeRod(materials.l1, 0.035); groupA.add(A.rod1);
  A.rod2 = makeRod(materials.l2, 0.035); groupA.add(A.rod2);

  A.P1 = new THREE.Mesh(new THREE.SphereGeometry(0.13, 22, 22), materials.anchor);
  A.P2 = new THREE.Mesh(new THREE.SphereGeometry(0.13, 22, 22), materials.anchor2);
  A.D1 = new THREE.Mesh(new THREE.SphereGeometry(0.115, 22, 22), materials.handle);
  A.D2 = new THREE.Mesh(new THREE.SphereGeometry(0.115, 22, 22), materials.handle);
  [A.P1, A.P2, A.D1, A.D2].forEach(o => groupA.add(o));

  A.dashP1 = makeDash(materials.dashA); groupA.add(A.dashP1);
  A.dashP2 = makeDash(materials.dashB); groupA.add(A.dashP2);

  A.mA = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 20), materials.moving);
  A.mB = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 20), materials.moving);
  groupA.add(A.mA, A.mB);
  A.rodAB = makeRod(new THREE.MeshStandardMaterial({ color: 0x7C3AED, roughness: 0.3 }), 0.022);
  groupA.add(A.rodAB);

  A.rodCommon = makeRod(materials.dist, 0.028); groupA.add(A.rodCommon);
  A.frCommon1 = makeRightAngle(new THREE.LineBasicMaterial({ color: 0xDC2626 }));
  A.frCommon2 = makeRightAngle(new THREE.LineBasicMaterial({ color: 0xDC2626 }));
  groupA.add(A.frCommon1, A.frCommon2);

  A.boxEdges = makeBoxEdges();
  A.boxFaces = makeBoxFaces(materials.boxFace);
  A.boxBase = makeBaseQuad(materials.boxBase);
  groupA.add(A.boxEdges, A.boxFaces, A.boxBase);

  A.planeA = new THREE.Mesh(new THREE.BufferGeometry(), materials.plat);
  A.planeAOutline = makeQuadOutline(materials.outline);
  groupA.add(A.planeA, A.planeAOutline);
  A.dashPlane = makeDash(materials.dash); groupA.add(A.dashPlane);
  A.frPlane = makeRightAngle(new THREE.LineBasicMaterial({ color: 0x0D9488 }));
  groupA.add(A.frPlane);

  A.lbP1 = makeLabel('P₁', '#1D4ED8'); A.lbP2 = makeLabel('P₂', '#BE123C');
  A.lbD1 = makeLabel('s₁', '#B45309'); A.lbD2 = makeLabel('s₂', '#B45309');
  A.lbA = makeLabel('A', '#6D28D9', true); A.lbB = makeLabel('B', '#6D28D9', true);
  A.lbD = makeLabel('d', '#DC2626');
  A.lbPlane = makeLabel('π : 过 L₁ 且 ∥ L₂', '#0D9488', true);
  A.lbBox = makeLabel('V = |混合积|', '#4338CA', true);
  A.lbAB = makeLabel('|AB|', '#6D28D9', true);
  groupA.add(A.lbP1, A.lbP2, A.lbD1, A.lbD2, A.lbA, A.lbB, A.lbD, A.lbPlane, A.lbBox, A.lbAB);
}

/* ============================ 5. 模块 B 场景构件 ============================ */

const B = {};

function buildModuleB() {
  B.planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), materials.plat);
  groupB.add(B.planeMesh);
  B.planeOutline = makeQuadOutline(materials.outline);

  // 平面内网格
  const segs = [];
  const half = 4.5, n = 9;
  for (let i = 0; i <= n; i++) {
    const t = -half + (2 * half * i) / n;
    segs.push(-half, t, 0, half, t, 0);
    segs.push(t, -half, 0, t, half, 0);
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  B.planeGrid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x0D9488, transparent: true, opacity: 0.18 }));
  B.planePlane = new THREE.Group();  // 承载 π 的平面对齐（网格 + 边框 + 面）
  groupB.add(B.planeMesh, B.planeOutline, B.planeGrid);

  B.rod = makeRod(materials.lb, 0.035); groupB.add(B.rod);
  B.C = new THREE.Mesh(new THREE.SphereGeometry(0.13, 22, 22), materials.anchor); groupB.add(B.C);
  B.D = new THREE.Mesh(new THREE.SphereGeometry(0.115, 22, 22), materials.handle); groupB.add(B.D);
  B.dashCD = makeDash(materials.dashA); groupB.add(B.dashCD);

  B.M = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 20), materials.moving); groupB.add(B.M);
  B.Mp = new THREE.Mesh(new THREE.SphereGeometry(0.10, 20, 20), materials.projPt); groupB.add(B.Mp);
  B.dashMMp = makeDash(materials.dash); groupB.add(B.dashMMp);

  B.rodProj = makeRod(materials.proj, 0.033); groupB.add(B.rodProj);
  B.dashE1 = makeDash(materials.dash); groupB.add(B.dashE1);
  B.dashE2 = makeDash(materials.dash); groupB.add(B.dashE2);
  B.fr1 = makeRightAngle(new THREE.LineBasicMaterial({ color: 0x059669 })); groupB.add(B.fr1);
  B.fr2 = makeRightAngle(new THREE.LineBasicMaterial({ color: 0x059669 })); groupB.add(B.fr2);

  B.ppFace = new THREE.Mesh(new THREE.BufferGeometry(), materials.ppLat); groupB.add(B.ppFace);
  B.ppOutline = makeQuadOutline(materials.outlineA); groupB.add(B.ppOutline);

  B.pierce = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 20), materials.pierce); groupB.add(B.pierce);

  B.lbC = makeLabel('P', '#1D4ED8'); B.lbD = makeLabel('v', '#B45309');
  B.lbM = makeLabel('M', '#6D28D9', true); B.lbMp = makeLabel("M′", '#B45309', true);
  B.lbL = makeLabel('L', '#2563EB');
  B.lbLp = makeLabel('L′ = π ∩ π′', '#059669', true);
  B.lbPi = makeLabel('π', '#0D9488');
  B.lbPip = makeLabel('π′ (⊥ π)', '#B45309', true);
  groupB.add(B.lbC, B.lbD, B.lbM, B.lbMp, B.lbL, B.lbLp, B.lbPi, B.lbPip);
}

/* ============================ 6. 数学核心 ============================ */

// 两直线位置关系
function relationOf(P1, d1, P2, d2) {
  const cr = new THREE.Vector3().crossVectors(d1, d2);
  const crLen = cr.length();
  const w = new THREE.Vector3().subVectors(P2, P1);
  const mixed = w.dot(cr);
  if (crLen > PAR_EPS) {
    const d = Math.abs(mixed) / crLen;
    return { type: d < DIST_EPS ? 'intersect' : 'skew', d, cr, crLen, mixed, w };
  }
  const perp = new THREE.Vector3().crossVectors(w, d1);
  const dist = perp.length();
  return { type: dist < DIST_EPS ? 'coincident' : 'parallel', d: dist, cr, crLen, mixed, w };
}

// 公垂线（最近点对）
function commonPerp(P1, d1, P2, d2, rel) {
  if (rel.type === 'parallel' || rel.type === 'coincident') {
    const Q2 = P2.clone().addScaledVector(d2, new THREE.Vector3().subVectors(P1, P2).dot(d2));
    const Q1 = P1.clone().addScaledVector(d1, new THREE.Vector3().subVectors(Q2, P1).dot(d1));
    const u = new THREE.Vector3().subVectors(Q2, P2).dot(d2);
    return { Q1, Q2, t: 0, u };
  }
  const w0 = new THREE.Vector3().subVectors(P1, P2);
  const a = d1.dot(d1), b = d1.dot(d2), c = d2.dot(d2);
  const d = d1.dot(w0), e = d2.dot(w0);
  const den = a * c - b * b;
  const t = (b * e - c * d) / den;
  const u = (a * e - b * d) / den;
  return { Q1: P1.clone().addScaledVector(d1, t), Q2: P2.clone().addScaledVector(d2, u), t, u };
}

// 过原点平面（倾角 α）的法向量
function planeNormal() {
  const a = state.alpha * Math.PI / 180;
  return v3(0, -Math.sin(a), Math.cos(a));
}
// 正交投影：X' = X - (X·n) n （平面过原点）
function projectOnPlane(X, n) {
  return X.clone().addScaledVector(n, -X.dot(n));
}

// 平面方程文本：π: a x + b y + c z = 0
function planeEq(n) {
  const terms = [['x', n.x], ['y', n.y], ['z', n.z]];
  let s = '';
  terms.forEach(([sym, c]) => {
    if (Math.abs(c) < 5e-3) return;
    if (!s) s = (c < 0 ? '−' : '') + fmt(Math.abs(c)) + sym;
    else s += (c < 0 ? ' − ' : ' + ') + fmt(Math.abs(c)) + sym;
  });
  return 'π: ' + (s || '0') + ' = 0';
}

/* ============================ 7. 模块 A 更新 ============================ */

let relA = null, cpA = null;

function updateA() {
  const P1 = L1.P, d1 = L1.d, P2 = L2.P, d2 = L2.d;

  relA = relationOf(P1, d1, P2, d2);
  cpA = commonPerp(P1, d1, P2, d2, relA);

  // 直线
  setRod(A.rod1, P1.clone().addScaledVector(d1, -LINE_HALF), P1.clone().addScaledVector(d1, LINE_HALF));
  setRod(A.rod2, P2.clone().addScaledVector(d2, -LINE_HALF), P2.clone().addScaledVector(d2, LINE_HALF));

  // 锚点与方向手柄
  A.P1.position.copy(P1);
  A.P2.position.copy(P2);
  A.D1.position.copy(P1).addScaledVector(d1, HANDLE_R);
  A.D2.position.copy(P2).addScaledVector(d2, HANDLE_R);
  setDash(A.dashP1, P1, A.D1.position);
  setDash(A.dashP2, P2, A.D2.position);

  setLabel(A.lbP1, 'P₁', '#1D4ED8'); A.lbP1.position.copy(P1).add(v3(-0.05, -0.05, 0.4));
  setLabel(A.lbP2, 'P₂', '#BE123C'); A.lbP2.position.copy(P2).add(v3(-0.05, -0.05, 0.4));
  setLabel(A.lbD1, 's₁', '#B45309'); A.lbD1.position.copy(A.D1.position).add(v3(0, 0, 0.32));
  setLabel(A.lbD2, 's₂', '#B45309'); A.lbD2.position.copy(A.D2.position).add(v3(0, 0, 0.32));

  // 动点 A、B
  const pA = P1.clone().addScaledVector(d1, state.ta);
  const pB = P2.clone().addScaledVector(d2, state.ub);
  A.mA.position.copy(pA); A.mB.position.copy(pB);
  setRod(A.rodAB, pA, pB, 0.02);
  setLabel(A.lbA, 'A', '#6D28D9'); A.lbA.position.copy(pA).add(v3(0.06, 0.06, 0.32));
  setLabel(A.lbB, 'B', '#6D28D9'); A.lbB.position.copy(pB).add(v3(0.06, 0.06, 0.32));
  setLabel(A.lbAB, `|AB|=${fmt(pA.distanceTo(pB))}`, '#6D28D9');
  A.lbAB.position.copy(pA).add(pB).multiplyScalar(0.5).add(v3(0, 0, 0.34));

  // 公垂线段
  const { Q1, Q2 } = cpA;
  setRod(A.rodCommon, Q1, Q2, 0.03);
  const lenC = Q1.distanceTo(Q2);
  setLabel(A.lbD, `d = ${fmt(relA.d)}`, '#DC2626');
  A.lbD.position.copy(Q1).add(Q2).multiplyScalar(0.5).add(v3(0.15, 0.15, 0.32));
  if (lenC > 1e-3) {
    const u12 = new THREE.Vector3().subVectors(Q2, Q1).normalize();
    // 直角标记应画在「公垂线方向 × 直线方向」张成的平面内
    setRightAngle(A.frCommon1, Q1, u12, d1, 0.22);
    setRightAngle(A.frCommon2, Q2, u12.clone().negate(), d2, 0.22);
    A.frCommon1.visible = A.frCommon2.visible = true;
  } else {
    A.frCommon1.visible = A.frCommon2.visible = false;
  }

  // 平行六面体：以 P1 为顶点，棱 u=d1, v=d2, w=P2-P1
  const w = new THREE.Vector3().subVectors(P2, P1);
  updateBox(A.boxEdges, A.boxFaces, A.boxBase, P1, d1, d2, w);
  const vol = Math.abs(new THREE.Vector3().crossVectors(d1, d2).dot(w));
  const volTxt = relA.crLen > PAR_EPS
    ? `V=${fmt(vol)} , S=${fmt(relA.crLen)} ⇒ d=V/S=${fmt(relA.d)}`
    : `共面 ⇒ V=0（V/S 失效）`;
  setLabel(A.lbBox, volTxt, '#4338CA');
  A.lbBox.position.copy(P1).addScaledVector(d1, 0.5).addScaledVector(d2, 0.5).addScaledVector(w, 1.15);

  // 过 L1 平行 L2 的平面 π
  const n = new THREE.Vector3().crossVectors(d1, d2);
  const hasN = n.length() > 1e-4;
  if (hasN) {
    const nh = n.clone().normalize();
    const footP2 = P2.clone().addScaledVector(nh, -w.dot(nh));  // P2 在 π 上的垂足
    const center = P1.clone().add(footP2).multiplyScalar(0.5);
    const e2 = new THREE.Vector3().crossVectors(nh, d1).normalize();
    setQuad(A.planeA, center, d1, e2, 5.0, 3.2);
    setQuadOutline(A.planeAOutline, center, d1, e2, 5.0, 3.2);
    setDash(A.dashPlane, P2, footP2);
    const dd = new THREE.Vector3().subVectors(footP2, P2);
    if (dd.lengthSq() > 1e-8) {
      setRightAngle(A.frPlane, footP2, dd.clone().normalize(), d1, 0.24);
      A.frPlane.visible = true;
    } else A.frPlane.visible = false;
    setLabel(A.lbPlane, `π: 过 L₁ ∥ L₂`, '#0D9488');
    A.lbPlane.position.copy(center).addScaledVector(e2, 2.4).addScaledVector(d1, -3.6);
  } else {
    A.planeA.visible = A.planeAOutline.visible = A.dashPlane.visible = A.frPlane.visible = false;
  }

  // 图层 / 模式可见性
  const L = state.layers;
  A.rodAB.visible = A.mA.visible = A.mB.visible = A.lbA.visible = A.lbB.visible = A.lbAB.visible = L.aPoints && state.modeA === 'common';
  const showBox = L.aBox && state.modeA === 'box';
  A.boxEdges.visible = A.boxFaces.visible = A.boxBase.visible = A.lbBox.visible = showBox;
  const showPlane = L.aPlane && state.modeA === 'plane' && hasN;
  A.planeA.visible = A.planeAOutline.visible = A.dashPlane.visible = A.frPlane.visible = A.lbPlane.visible = showPlane;
  const showCommon = L.aCommon;
  A.rodCommon.visible = showCommon && lenC > 1e-3;
  A.frCommon1.visible = A.frCommon2.visible = showCommon && lenC > 1e-3;
  A.lbD.visible = showCommon;
}

function updateBox(edges, faces, base, o, u, v, w) {
  const c = BOX_CORNERS.map(([a, b, d]) => o.clone().addScaledVector(u, a).addScaledVector(v, b).addScaledVector(w, d));
  const pe = edges.geometry.attributes.position;
  BOX_EDGES.forEach(([i, j], k) => {
    pe.setXYZ(k * 2, c[i].x, c[i].y, c[i].z);
    pe.setXYZ(k * 2 + 1, c[j].x, c[j].y, c[j].z);
  });
  pe.needsUpdate = true;
  edges.geometry.computeBoundingSphere();

  const pf = faces.geometry.attributes.position;
  let k = 0;
  BOX_FACES.forEach(([a, b, c2, d2]) => {
    [[a, b, c2], [a, c2, d2]].forEach(t => t.forEach(idx => {
      pf.setXYZ(k++, c[idx].x, c[idx].y, c[idx].z);
    }));
  });
  pf.needsUpdate = true;
  faces.geometry.computeBoundingSphere();

  // 底面平行四边形（强调 S = |s₁×s₂|）
  const pb = base.geometry.attributes.position;
  [0, 1, 3, 0, 3, 2].forEach((idx, m) => pb.setXYZ(m, c[idx].x, c[idx].y, c[idx].z));
  pb.needsUpdate = true;
  base.geometry.computeBoundingSphere();
}

/* ============================ 8. 模块 B 更新 ============================ */

let infoB = null;

function updateB() {
  const n = planeNormal();
  const a = state.alpha * Math.PI / 180;
  const C = LB.P, d = LB.d;

  // 平面姿态
  B.planeMesh.rotation.set(a, 0, 0);
  B.planeGrid.rotation.set(a, 0, 0);
  B.planeGrid.position.set(0, 0, 0.002);
  setQuadOutline(B.planeOutline, v3(0, 0, 0), v3(1, 0, 0), v3(0, Math.cos(a), Math.sin(a)), 4.5, 4.5);

  // 直线与手柄
  setRod(B.rod, C.clone().addScaledVector(d, -LINE_HALF), C.clone().addScaledVector(d, LINE_HALF));
  B.C.position.copy(C);
  B.D.position.copy(C).addScaledVector(d, HANDLE_R);
  setDash(B.dashCD, C, B.D.position);
  setLabel(B.lbC, 'P', '#1D4ED8'); B.lbC.position.copy(C).add(v3(-0.05, -0.05, 0.4));
  setLabel(B.lbD, 'v', '#B45309'); B.lbD.position.copy(B.D.position).add(v3(0, 0, 0.32));
  setLabel(B.lbL, 'L', '#2563EB'); B.lbL.position.copy(C).addScaledVector(d, 3.15).add(v3(0, 0, 0.32));

  // 投影方向（把 d 投影到平面上）
  const dPerp = d.clone().addScaledVector(n, -d.dot(n));
  const dLen = dPerp.length();
  const isPend = dLen < 1e-3;      // L ⊥ π
  const isPar = Math.abs(d.dot(n)) < 1e-3; // L ∥ π（或含于 π）

  // 端点与其投影
  const E1 = C.clone().addScaledVector(d, -LINE_HALF);
  const E2 = C.clone().addScaledVector(d, LINE_HALF);
  const E1p = projectOnPlane(E1, n), E2p = projectOnPlane(E2, n);

  B.dashE1.visible = B.dashE2.visible = !isPend;
  setDash(B.dashE1, E1, E1p);
  setDash(B.dashE2, E2, E2p);
  setRod(B.rodProj, E1p, E2p, 0.032);
  B.rodProj.visible = !isPend;
  B.lbLp.visible = !isPend;
  if (!isPend) {
    setLabel(B.lbLp, 'L′ = π ∩ π′', '#059669');
    B.lbLp.position.copy(E1p).add(E2p).multiplyScalar(0.5).add(v3(0, 0, 0.34));
  }
  // 直角标记
  B.fr1.visible = B.fr2.visible = !isPend;
  if (!isPend) {
    const uN = n.clone().normalize();
    const uP = dPerp.clone().normalize();
    setRightAngle(B.fr1, E1p, uN, uP, 0.22);
    setRightAngle(B.fr2, E2p, uN, uP, 0.22);
  }

  // 动点 M 与其投影 M′
  const M = C.clone().addScaledVector(d, state.tb);
  const Mp = projectOnPlane(M, n);
  B.M.position.copy(M); B.Mp.position.copy(Mp);
  setDash(B.dashMMp, M, Mp);
  setLabel(B.lbM, 'M', '#6D28D9'); B.lbM.position.copy(M).add(v3(0.06, 0.06, 0.32));
  setLabel(B.lbMp, 'M′', '#B45309'); B.lbMp.position.copy(Mp).add(v3(0.06, 0.06, 0.26));

  // 投影平面 π′ = span(d, n) 过 C；沿 n 方向跨越到目标平面以保证交线可见
  const e1 = (dPerp.length() > 1e-3 ? dPerp.clone().normalize()
             : new THREE.Vector3().crossVectors(n, v3(1, 0, 0)).normalize());
  const e2 = n.clone().normalize();
  const hC = C.dot(e2);
  const ppCenter = C.clone().addScaledVector(e2, -hC / 2);
  const ppHalf = Math.abs(hC) / 2 + 1.3;
  setQuad(B.ppFace, ppCenter, e1, e2, 4.6, ppHalf);
  setQuadOutline(B.ppOutline, ppCenter, e1, e2, 4.6, ppHalf);
  setLabel(B.lbPip, 'π′: 过 L 且 ⊥ π', '#B45309');
  B.lbPip.position.copy(ppCenter).addScaledVector(e1, 3.0).addScaledVector(e2, ppHalf + 0.35);

  // 平面标签
  setLabel(B.lbPi, planeEq(n), '#0D9488');
  B.lbPi.position.copy(v3(1, 0, 0).multiplyScalar(-4.0))
    .addScaledVector(v3(0, Math.cos(a), Math.sin(a)), -3.6).addScaledVector(n, 0.06);

  // 交点
  const denom = d.dot(n);
  B.pierce.visible = Math.abs(denom) > 1e-4;
  let piercePt = null;
  if (B.pierce.visible) {
    const t = -C.dot(n) / denom;
    piercePt = C.clone().addScaledVector(d, t);
    B.pierce.position.copy(piercePt);
  }

  infoB = { n, d, C, M, Mp, piercePt, isPend, isPar, dPerp, dLen, E1, E2, E1p, E2p };

  // 图层
  const L = state.layers;
  B.ppFace.visible = B.ppOutline.visible = B.lbPip.visible = L.bProjPlane;
  B.dashE1.visible = B.dashE1.visible && L.bDrops;
  B.dashE2.visible = B.dashE2.visible && L.bDrops;
  B.dashMMp.visible = L.bDrops;
  B.fr1.visible = B.fr1.visible && L.bDrops;
  B.fr2.visible = B.fr2.visible && L.bDrops;
  B.rodProj.visible = B.rodProj.visible && L.bProjLine;
  B.lbLp.visible = B.lbLp.visible && L.bProjLine;
  B.planeMesh.visible = B.planeGrid.visible = B.planeOutline.visible = L.bPlane;
}

/* ============================ 9. 统一刷新 ============================ */

function refresh() {
  groupA.visible = state.module === 'A';
  groupB.visible = state.module === 'B';
  gridHelper.visible = state.module === 'A';
  if (state.module === 'A') updateA(); else updateB();
  updateHUD();
  fillDynValues();
}

/* ============================ 10. HUD ============================ */

const HUD = {
  badge: () => document.getElementById('hud-badge'),
  sub: () => document.getElementById('hud-subbadge'),
  body: () => document.getElementById('hud-body')
};

function kv(k, v) { return `<div class="kv-row"><span class="k">${k}</span><span class="v">${v}</span></div>`; }

const REL_META = {
  skew:       { text: '异面直线', cls: 'bg-rose-50 text-rose-700 border-rose-200',    sub: '不共面 · 有唯一公垂线' },
  parallel:   { text: '平行直线', cls: 'bg-amber-50 text-amber-800 border-amber-200', sub: '共面 · 方向平行' },
  intersect:  { text: '相交直线', cls: 'bg-blue-50 text-blue-700 border-blue-200',    sub: '共面 · 距离为 0' },
  coincident: { text: '重合直线', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', sub: '同一条直线' }
};

function updateHUD() {
  const b = HUD.badge(), s = HUD.sub(), body = HUD.body();
  if (state.module === 'A') {
    const m = REL_META[relA.type];
    b.className = 'subtle-badge ' + m.cls;
    b.textContent = m.text;
    s.textContent = m.sub;

    const crLen = relA.crLen;
    const mixed = relA.mixed;
    const pA = L1.P.clone().addScaledVector(L1.d, state.ta);
    const pB = L2.P.clone().addScaledVector(L2.d, state.ub);
    const ab = pA.distanceTo(pB);

    body.innerHTML =
      kv('|s₁ × s₂|', `${fmt(crLen, 3)} ${crLen < PAR_EPS ? '(≈0 ⇒ 平行)' : ''}`) +
      kv('混合积 (P₁P₂,s₁,s₂)', fmt(mixed, 3)) +
      kv('d(L₁, L₂)', `<span style="color:#DC2626">${fmt(relA.d, 3)}</span>`) +
      kv('|AB| ≥ d', `${fmt(ab, 3)}`);

    const btn = document.getElementById('btn-min-text');
    if (btn) btn.textContent = '捕捉距离最小值（|AB| → d）';
  } else {
    const { n, d, C, isPend, isPar, Mp } = infoB;
    const vn = Math.abs(d.dot(n));            // |cos φ|
    const phi = Math.asin(Math.min(1, vn)) * 180 / Math.PI;
    const inPlane = Math.abs(C.dot(n)) < 1e-3;
    let text = 'L 与 π 斜交', cls = 'bg-blue-50 text-blue-700 border-blue-200', sub = 'L′ 是一般直线';
    if (isPend) { text = 'L ⊥ π'; cls = 'bg-rose-50 text-rose-700 border-rose-200'; sub = '投影退化为一点'; }
    else if (isPar && inPlane) { text = 'L ⊂ π'; cls = 'bg-emerald-50 text-emerald-700 border-emerald-200'; sub = '投影即自身'; }
    else if (isPar) { text = 'L ∥ π'; cls = 'bg-amber-50 text-amber-800 border-amber-200'; sub = 'L′ ∥ L'; }

    b.className = 'subtle-badge ' + cls;
    b.textContent = text;
    s.textContent = sub;

    const dPerpN = infoB.dPerp.clone().normalize();
    body.innerHTML =
      kv('L 方向 v', vecStr(d)) +
      kv('平面法向量 n', vecStr(n)) +
      kv('L 与 π 夹角 φ', `${fmt(phi, 1)}°`) +
      kv('投影方向 v′', isPend ? '退化' : vecStr(dPerpN)) +
      kv('M′ = M − (M·n)n', vecStr(Mp));

    const btn = document.getElementById('btn-min-text');
    if (btn) btn.textContent = '让 M 扫过 L（M′ 描出 L′）';
  }
}

/* ============================ 11. 位置预设 ============================ */

function presetA(name) {
  if (name === 'skew') return { p1: v3(-3, 0, 1), d1: v3(1, 0, 0), p2: v3(1, -3, -1), d2: v3(0, 1, 0) };
  if (name === 'parallel') return { p1: v3(-3, -1, 1.6), d1: v3(1, 1, 0), p2: v3(-1.4, -2.6, -0.9), d2: v3(1, 1, 0) };
  if (name === 'intersect') {
    const d1 = v3(1, 0, 0.5).normalize(), d2 = v3(0, 1, 0.5).normalize(), I = v3(0, 0, 0.7);
    return { p1: I.clone().addScaledVector(d1, -3.0), d1, p2: I.clone().addScaledVector(d2, -3.0), d2 };
  }
  const P = v3(-2.6, -1.2, 0.4), d = v3(1, 0.85, 0.35).normalize();
  return { p1: P.clone(), d1: d.clone(), p2: P.clone().addScaledVector(d, 2.4), d2: d.clone() };
}

function presetB(name) {
  if (name === 'oblique') return { p: v3(0.2, 0, 3.4), d: v3(1, 0.65, -1.4), alpha: 0 };
  if (name === 'parallel') return { p: v3(-0.6, 0.4, 2.6), d: v3(1, 0.8, 0), alpha: 0 };
  if (name === 'inside') return { p: v3(-0.9, 0.4, 0), d: v3(1, 0.8, 0), alpha: 0 };
  return { p: v3(0.9, 0.7, 3.2), d: v3(0, 0, -1), alpha: 0 };
}

function applyPresetA(name, animate = true) {
  state.caseA = name;
  const P = presetA(name);
  P.d1.normalize(); P.d2.normalize();
  state.ta = 0; state.ub = 0;
  setSlider('slider-ta', 'val-ta', 0, 3);
  setSlider('slider-ub', 'val-ub', 0, 3);
  if (!animate) {
    L1.P.copy(P.p1); L1.d.copy(P.d1); L2.P.copy(P.p2); L2.d.copy(P.d2);
    refresh();
    return;
  }
  const tl = gsap.timeline({ onUpdate: refresh, onComplete: refresh, defaults: { duration: 0.75, ease: 'power2.out' } });
  tl.add(tweenTo(L1.P, P.p1), 0);
  tl.add(tweenTo(L1.d, P.d1, true), 0);
  tl.add(tweenTo(L2.P, P.p2), 0);
  tl.add(tweenTo(L2.d, P.d2, true), 0);
}

// 用代理对象做补间，避免 normalize 破坏 GSAP 的插值基准
function tweenTo(vec, to, normalize) {
  const proxy = { x: vec.x, y: vec.y, z: vec.z };
  return gsap.to(proxy, {
    x: to.x, y: to.y, z: to.z,
    onUpdate: () => { vec.set(proxy.x, proxy.y, proxy.z); if (normalize) vec.normalize(); }
  });
}

function applyPresetB(name, animate = true) {
  state.caseB = name;
  const P = presetB(name);
  P.d.normalize();
  state.alpha = P.alpha;
  setSlider('slider-alpha', 'val-alpha', P.alpha, 0);
  state.tb = 0;
  setSlider('slider-tb', 'val-tb', 0, 3);
  if (!animate) {
    LB.P.copy(P.p); LB.d.copy(P.d);
    refresh();
    return;
  }
  const tl = gsap.timeline({ onUpdate: refresh, onComplete: refresh, defaults: { duration: 0.7, ease: 'power2.out' } });
  tl.add(tweenTo(LB.P, P.p), 0);
  tl.add(tweenTo(LB.d, P.d, true), 0);
}

function setSlider(id, vid, value, dec) {
  const el = document.getElementById(id), v = document.getElementById(vid);
  if (el) el.value = value;
  if (v) v.textContent = Number(value).toFixed(dec);
}

/* ============================ 12. UI 事件 ============================ */

function bindUI() {
  document.getElementById('tab-module-A').addEventListener('click', () => switchModule('A'));
  document.getElementById('tab-module-B').addEventListener('click', () => switchModule('B'));

  document.querySelectorAll('[data-case-a]').forEach(btn =>
    btn.addEventListener('click', () => { setActiveChip('[data-case-a]', btn); applyPresetA(btn.dataset.caseA); renderPanel(); }));
  document.querySelectorAll('[data-mode-a]').forEach(btn =>
    btn.addEventListener('click', () => { setActiveChip('[data-mode-a]', btn); state.modeA = btn.dataset.modeA; refresh(); renderPanel(); }));
  document.querySelectorAll('[data-case-b]').forEach(btn =>
    btn.addEventListener('click', () => { setActiveChip('[data-case-b]', btn); applyPresetB(btn.dataset.caseB); renderPanel(); }));

  document.getElementById('slider-ta').addEventListener('input', e => { state.ta = +e.target.value; document.getElementById('val-ta').textContent = state.ta.toFixed(2); updateA(); updateHUD(); });
  document.getElementById('slider-ub').addEventListener('input', e => { state.ub = +e.target.value; document.getElementById('val-ub').textContent = state.ub.toFixed(2); updateA(); updateHUD(); });
  document.getElementById('slider-tb').addEventListener('input', e => { state.tb = +e.target.value; document.getElementById('val-tb').textContent = state.tb.toFixed(2); updateB(); updateHUD(); });
  document.getElementById('slider-alpha').addEventListener('input', e => { state.alpha = +e.target.value; document.getElementById('val-alpha').textContent = state.alpha + '°'; updateB(); updateHUD(); });

  const LAYER_KEY = {
    'a-common': 'aCommon', 'a-box': 'aBox', 'a-plane': 'aPlane', 'a-points': 'aPoints',
    'b-projplane': 'bProjPlane', 'b-drops': 'bDrops', 'b-projline': 'bProjLine', 'b-plane': 'bPlane'
  };
  document.querySelectorAll('input[data-layer]').forEach(cb =>
    cb.addEventListener('change', () => { state.layers[LAYER_KEY[cb.dataset.layer]] = cb.checked; refresh(); }));

  document.getElementById('btn-reset-cam').addEventListener('click', resetCamera);
  document.getElementById('btn-min').addEventListener('click', onMinButton);

  const tp = document.getElementById('btn-toggle-explain');
  tp.addEventListener('click', () => {
    const p = document.getElementById('explain-panel');
    const hidden = p.style.display === 'none';
    p.style.display = hidden ? 'flex' : 'none';
    tp.textContent = hidden ? '隐藏笔记' : '笔记看板';
  });
}

function setActiveChip(sel, active) {
  document.querySelectorAll(sel).forEach(b => b.classList.remove('active'));
  active.classList.add('active');
}

function switchModule(m) {
  state.module = m;
  document.getElementById('tab-module-A').classList.toggle('active', m === 'A');
  document.getElementById('tab-module-B').classList.toggle('active', m === 'B');
  document.getElementById('controls-A').style.display = m === 'A' ? 'flex' : 'none';
  document.getElementById('controls-B').style.display = m === 'B' ? 'flex' : 'none';
  document.getElementById('layers-A').style.display = m === 'A' ? 'flex' : 'none';
  document.getElementById('layers-B').style.display = m === 'B' ? 'flex' : 'none';
  if (m === 'B') { updateB(); } else { updateA(); }
  resetCamera();
  refresh();
  renderPanel();
}

function resetCamera() {
  const to = state.module === 'A' ? { p: [7.6, -9.2, 6.6], t: [0, 0, 0.4] }
                                  : { p: [7.2, -8.6, 5.4], t: [0, 0, 1.0] };
  gsap.to(camera.position, { x: to.p[0], y: to.p[1], z: to.p[2], duration: 0.7, ease: 'power2.out' });
  gsap.to(controls.target, { x: to.t[0], y: to.t[1], z: to.t[2], duration: 0.7, ease: 'power2.out' });
}

function onMinButton() {
  if (state.module === 'A') {
    if (!cpA) return;
    gsap.to(state, {
      ta: cpA.t, ub: cpA.u, duration: 0.7, ease: 'power2.inOut',
      onUpdate: () => {
        document.getElementById('slider-ta').value = state.ta;
        document.getElementById('slider-ub').value = state.ub;
        document.getElementById('val-ta').textContent = state.ta.toFixed(2);
        document.getElementById('val-ub').textContent = state.ub.toFixed(2);
        updateA(); updateHUD();
      }
    });
  } else {
    gsap.fromTo(state, { tb: -LINE_HALF }, {
      tb: LINE_HALF, duration: 2.4, ease: 'sine.inOut', overwrite: true,
      onUpdate: () => {
        document.getElementById('slider-tb').value = state.tb;
        document.getElementById('val-tb').textContent = state.tb.toFixed(2);
        updateB(); updateHUD();
      }
    });
  }
}

/* ============================ 13. 拖拽交互 ============================ */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragOffset = new THREE.Vector3();
let dragging = null;

function dragTargets() {
  if (state.module === 'A') return [A.P1, A.P2, A.D1, A.D2];
  return [B.C, B.D];
}

function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function pickDraggable() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(dragTargets(), false);
  return hits.length ? hits[0].object : null;
}

function initDrag() {
  container.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    setPointer(e);
    const obj = pickDraggable();
    if (!obj) return;
    dragging = obj;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    dragPlane.setFromNormalAndCoplanarPoint(camDir, obj.position);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, hit);
    dragOffset.copy(obj.position).sub(hit);
    controls.enabled = false;
    renderer.domElement.style.cursor = 'grabbing';
  }, true);

  window.addEventListener('pointermove', e => {
    setPointer(e);
    if (dragging) {
      raycaster.setFromCamera(pointer, camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, hit)) {
        const target = hit.add(dragOffset);
        applyDrag(dragging, target);
        refresh();
      }
    } else {
      renderer.domElement.style.cursor = pickDraggable() ? 'grab' : '';
    }
  });

  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = null;
    controls.enabled = true;
    renderer.domElement.style.cursor = '';
  });
}

function applyDrag(obj, target) {
  if (obj === A.P1) { L1.P.copy(clampBox(target)); }
  else if (obj === A.P2) { L2.P.copy(clampBox(target)); }
  else if (obj === A.D1) {
    const nd = target.clone().sub(L1.P);
    if (nd.length() > 0.35) L1.d.copy(nd.normalize());
  } else if (obj === A.D2) {
    const nd = target.clone().sub(L2.P);
    if (nd.length() > 0.35) L2.d.copy(nd.normalize());
  } else if (obj === B.C) { LB.P.copy(clampBox(target)); }
  else if (obj === B.D) {
    const nd = target.clone().sub(LB.P);
    if (nd.length() > 0.35) LB.d.copy(nd.normalize());
  }
}

/* ============================ 14. 笔记面板 ============================ */

function renderPanel() {
  const el = document.getElementById('derivation-content');
  const title = document.getElementById('panel-title');
  const sub = document.getElementById('panel-subtitle');

  if (state.module === 'A') {
    title.textContent = '两直线间距离的几何理解';
    sub.textContent = '平行 · 相交 · 重合 · 异面 的统一判别与计算';
    el.innerHTML = panelA();
  } else {
    title.textContent = '直线在平面上的投影';
    sub.textContent = '沿法向的正交投影 L′ = π ∩ π′';
    el.innerHTML = panelB();
  }
  if (window.renderMathInElement) {
    window.renderMathInElement(el, {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
      throwOnError: false
    });
  }
  fillDynValues();
}

function panelA() {
  const highlight = { common: '理解一', box: '理解二', plane: '理解三' }[state.modeA];
  const hlCls = k => k === highlight ? 'background:#FEF9C3;border-radius:6px;padding:1px 4px;' : '';
  return String.raw`
    <div class="callout-box callout-note">
      <b>判别总纲：</b>先用方向向量的叉积看是否平行，再看两直线是否共面。四类关系对应的距离公式各不相同，但都统一于「<b>公垂线段长度</b>」这一个几何量。
    </div>

    <div class="formula-box">
      $$L_1:\ P_1+t\,\vec s_1,\qquad L_2:\ P_2+u\,\vec s_2,\qquad \vec s_1,\vec s_2\ \text{为单位方向向量}$$
    </div>

    <div class="flex items-start gap-2"><span class="step-num">1</span>
      <div><b>方向关系</b>：计算 $\vec s_1\times\vec s_2$。
      <ul class="list-disc pl-4 mt-1 space-y-0.5">
        <li>$\vec s_1\times\vec s_2=\vec 0$：两直线<b>平行或重合</b>（共面）；</li>
        <li>$\vec s_1\times\vec s_2\ne\vec 0$：方向不同，再用混合积判别是否共面。</li>
      </ul></div>
    </div>

    <div class="flex items-start gap-2"><span class="step-num">2</span>
      <div><b>共面判别（混合积）</b>：
        <div class="formula-box">$$\big(P_2-P_1\big)\cdot(\vec s_1\times\vec s_2)\;\begin{cases}=0&\text{共面 → 相交}\\\ne 0&\text{异面}\end{cases}$$</div>
      </div>
    </div>

    <div class="flex items-start gap-2"><span class="step-num">3</span>
      <div><b>距离公式（统一形式）</b>
        <div class="formula-box">$$d(L_1,L_2)=\frac{\big|(P_2-P_1)\cdot(\vec s_1\times\vec s_2)\big|}{\big|\vec s_1\times\vec s_2\big|}$$</div>
        三种情形的退化：
        <ul class="list-disc pl-4 mt-1 space-y-0.5">
          <li><b>异面</b>：分子为平行六面体体积 $V$，分母为底面积 $S$，$d=V/S$；</li>
          <li><b>平行</b>：$\vec s_1\times\vec s_2=\vec 0$，公式失效，改用 $d=\dfrac{|\overrightarrow{P_1P_2}\times\vec s_1|}{|\vec s_1|}$；</li>
          <li><b>相交 / 重合</b>：分子为 $0$，故 $d=0$。</li>
        </ul>
      </div>
    </div>

    <div class="pt-1 mt-1 border-t border-[#EFEFE9]">
      <div class="text-[11px] font-mono uppercase tracking-wider text-stone-400 mb-2">同一距离的三层理解（当前高亮：${highlight}）</div>

      <div style="${hlCls('理解一')}" class="mb-2">
        <b>理解一 · 公垂线段（最小值定义）</b>
        <p class="mt-1">在 $L_1,L_2$ 上各取动点 $A(t),B(u)$，则 $|AB|$ 的下确界就是 $d$，且取到最小值的 $A,B$ 连线<b>同时垂直于两会直线</b>，即公垂线段。</p>
        <div class="formula-box">$$\min_{t,u}|A(t)B(u)|=d,\qquad \overrightarrow{AB}\perp\vec s_1,\ \overrightarrow{AB}\perp\vec s_2$$</div>
        <p class="text-stone-500">拖动 $t,u$ 滑块可实时看到 $|AB|\ge d$。</p>
      </div>

      <div style="${hlCls('理解二')}" class="mb-2">
        <b>理解二 · 平行六面体 $d=V/S$</b>
        <p class="mt-1">以 $P_1$ 为顶点，$\vec s_1,\vec s_2,\overrightarrow{P_1P_2}$ 为三条棱作平行六面体：其<b>体积</b> $V=|(P_2-P_1)\cdot(\vec s_1\times\vec s_2)|$，<b>底面积</b> $S=|\vec s_1\times\vec s_2|$。同一体积除以底面积恰是底面上的<b>高</b>，也就是异面直线的距离。</p>
        <p class="text-stone-500 mt-1">⚠️ 平行/重合时 $\vec s_1\parallel\vec s_2$，三向量共面，$V=S=0$，$V/S$ 成为待定型——这正是混合积公式失效的原因。</p>
      </div>

      <div style="${hlCls('理解三')}" class="mb-2">
        <b>理解三 · 平面法（化归为点到平面距离）</b>
        <p class="mt-1">过 $L_1$ 作平面 $\pi\parallel L_2$（法向量 $\vec n=\vec s_1\times\vec s_2$）。因为 $L_2$ 上每一点到 $\pi$ 的距离都相同，所以</p>
        <div class="formula-box">$$d(L_1,L_2)=d(P_2,\pi)=\frac{|(P_2-P_1)\cdot \vec n|}{|\vec n|}$$</div>
        <p class="text-stone-500">这正是「线线距离 → 线面距离 → 点面距离」的降维链条。</p>
      </div>
    </div>

    <div id="dyn-values" class="editorial-card p-3 mt-1"></div>

    <div class="callout-box callout-warning">
      <b>易错点：</b>平行直线不能直接套用混合积公式（分母为 0）；重合直线虽然 $\vec s_1\times\vec s_2=\vec0$，但距离为 $0$，要与平行区分——判据是 $\overrightarrow{P_1P_2}\times\vec s_1$ 是否为零。
    </div>
  `;
}

function panelB() {
  return String.raw`
    <div class="callout-box callout-note">
      <b>投影的几何定义：</b>把 $L$ 上每一点沿<b>平面的法线方向</b>平移到 $\pi$ 上，所有像点组成的集合就是 $L$ 在 $\pi$ 上的投影 $L'$。这条「平移光线」的方向就是 $\pi$ 的法向量 $\vec n$。
    </div>

    <div class="flex items-start gap-2"><span class="step-num">1</span>
      <div><b>点的投影（核心公式）</b>：设平面 $\pi:\ \vec n\cdot \vec x=p$，则
        <div class="formula-box">$$X'=X-\frac{\vec n\cdot X-p}{|\vec n|^2}\,\vec n$$</div>
        当平面过原点时即 $X'=X-(\vec n\cdot X)\,\vec n$。
      </div>
    </div>

    <div class="flex items-start gap-2"><span class="step-num">2</span>
      <div><b>直线的投影 = 两平面交线</b>：
        <p class="mt-1">过 $L$ 且<b>垂直于 $\pi$</b> 的平面称为<b>投影平面</b> $\pi'$，其法向量为 $\vec v\times\vec n$。于是</p>
        <div class="formula-box">$$L'=\pi\cap\pi'$$</div>
        即：直线的投影是「投影平面」与「目标平面」的交线。这也解释了为什么投影后仍是一条直线。
      </div>
    </div>

    <div class="flex items-start gap-2"><span class="step-num">3</span>
      <div><b>方向向量怎么变</b>：$\vec v$ 去掉法向分量即得投影直线的方向
        <div class="formula-box">$$\vec v'=\vec v-\frac{\vec v\cdot\vec n}{|\vec n|^2}\,\vec n,\qquad \vec v'\perp \vec n$$</div>
      </div>
    </div>

    <div class="pt-1 mt-1 border-t border-[#EFEFE9]">
      <div class="text-[11px] font-mono uppercase tracking-wider text-stone-400 mb-2">按 $L$ 与 $\pi$ 的位置关系分类</div>
      <ul class="space-y-1.5">
        <li><b>斜交</b>（$\vec v\cdot\vec n\ne0$）：$L'$ 是一条过交点的一般直线，$L$ 与其投影线的夹角 $\varphi$ 满足 $\sin\varphi=\dfrac{|\vec v\cdot\vec n|}{|\vec v|\,|\vec n|}$。</li>
        <li><b>平行于 $\pi$</b>（$\vec v\cdot\vec n=0$ 且 $P\notin\pi$）：投影线 $L'\parallel L$，距离保持不变。</li>
        <li><b>含于 $\pi$</b>（$\vec v\cdot\vec n=0$ 且 $P\in\pi$）：$L'=L$，投影即自身。</li>
        <li><b>垂直于 $\pi$</b>（$\vec v\times\vec n=\vec 0$）：整条直线压成<b>一个点</b>，$L'$ 退化为点。</li>
      </ul>
    </div>

    <div class="callout-box callout-tip">
      <b>统一视角：</b>投影是一种<b>正交压缩</b>——沿 $\vec n$ 方向的长度被压为 $0$，垂直于 $\vec n$ 的分量原样保留。所以「投影直线的方向 = 原方向的正交补分量」。
    </div>

    <div id="dyn-values" class="editorial-card p-3 mt-1"></div>

    <div class="callout-box callout-warning">
      <b>易错点：</b>投影方向永远是 $\pi$ 的<b>法向量</b> $\vec n$，而不是某个「看起来竖直」的方向；平面倾斜时投影线也随之改变。不要把投影平面 $\pi'$ 与目标平面 $\pi$ 混淆——$L'$ 是二者的交线。
    </div>
  `;
}

/* 动态数值（顶部 / 底部卡片） */
function fillDynValues() {
  const box = document.getElementById('dyn-values');
  if (!box) return;
  if (state.module === 'A') {
    const pA = L1.P.clone().addScaledVector(L1.d, state.ta);
    const pB = L2.P.clone().addScaledVector(L2.d, state.ub);
    box.innerHTML = `<div class="text-[11px] font-mono uppercase tracking-wider text-stone-400 mb-1">当前数值代入</div>` +
      `<div class="font-mono text-[11px] text-stone-500 mb-1">P₁ = ${vecStr(L1.P)} , s₁ = ${vecStr(L1.d)}<br>P₂ = ${vecStr(L2.P)} , s₂ = ${vecStr(L2.d)}</div>` +
      kv('|s₁×s₂|', fmt(relA.crLen, 4)) +
      kv('混合积', fmt(relA.mixed, 4)) +
      kv('d(L₁,L₂)', fmt(relA.d, 4)) +
      kv('|AB|', fmt(pA.distanceTo(pB), 4));
  } else {
    const { n, d, C, M, Mp, piercePt, isPend } = infoB;
    box.innerHTML = `<div class="text-[11px] font-mono uppercase tracking-wider text-stone-400 mb-1">当前数值代入</div>` +
      `<div class="font-mono text-[11px] text-stone-500 mb-1">P = ${vecStr(C)} , v = ${vecStr(d)}<br>n = ${vecStr(n)}</div>` +
      kv('M', vecStr(M)) +
      kv("M' = M − (M·n)n", vecStr(Mp)) +
      kv('交点 L∩π', piercePt ? vecStr(piercePt) : (isPend ? '（重合于 L 上一点）' : '（平行，无交点）'));
  }
}

/* ============================ 15. 渲染循环 ============================ */

function onWindowResize() {
  if (!container || !renderer || !camera) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
