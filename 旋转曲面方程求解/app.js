/**
 * 旋转曲面与锥面 · 三维舞台与分步推导
 * 几何、推导文字与时间线由 model.js 给出；本文件负责 THREE 对象、推导卡片与控件。
 * 结构（轴、纬圆、平面、标签）只在案例、预设、t 或图层变化时重建；
 * 每个对象的显隐与淡入只由（步号，步内秒数）决定，扫掠角也由时间线算出，逐帧原地更新。
 */

// --- 全局状态 ---
const state = {
  currentCase: 1,    // 1：§8.1 母线非坐标面；2：§8.2 斜轴（考研真题）；3：§9 锥面
  presetIndex: 0,    // 0：典型范例；1：进阶变体
  t: 0.60,           // 母线动点参数（案例三为准线参角对应的参数）
  thetaTarget: 220,  // 扫掠角参数（度）：第四步「旋转」中扫到的角度
  clock: 0,          // 推导时钟（秒）
  playing: true,     // 进入案例时从第一步自动播放
  reduce: window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  layers: { plane: true, circle: true, radius: true, surface: true }
};

const STILL = 0.05;   // θ 不超过此值视为尚未扫掠

// --- Three.js 对象 ---
let scene, camera, renderer, controls, container;
const dynamicGroup = new THREE.Group();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);

let structKey = '';           // 结构键：变化时整体重建
let items = [];               // 每个对象与标签的登记：{ obj, step, layer, theta, base, needArc }
let labelItems = new Map();   // 标签键 → 登记项，用于换字与定位
let dyn = {};                 // 扫掠相关对象的引用：P、radiusP、sphereP、arc、surfaceGeom
let ownMaterials = [];        // 每个对象自己的材质（用于独立淡入），重建时释放
let gridIndices = new Map();
let lastNow = 0;

// 推导卡片与状态行的写入缓存：只在内容变化时写 DOM
let cardKey = '';
let cardToken = 0;
let shownProg = '';
let shownStatus = '';
let shownTheta = null;

// 材质整个演示共用，重建时不释放
// 颜色只在这里定义（设计方案.md §3）：墨色为结构，蓝为当前动作（动点、扫掠、生成的曲面），金为路径，灰绿为辅助
const INK = 0x343C38;
const INK_2 = 0x5D655F;
const WAIT = 0x9AA096;
const BLUE = 0x2D5BBF;
const GOLD = 0xBF8C32;
const materials = {
  axis: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.6 }),
  generatrix: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.5 }),
  m1Point: new THREE.MeshStandardMaterial({ color: BLUE, roughness: 0.4, emissive: BLUE, emissiveIntensity: 0.2 }),
  mPoint: new THREE.MeshStandardMaterial({ color: BLUE, roughness: 0.4, emissive: BLUE, emissiveIntensity: 0.25 }),
  centerPoint: new THREE.MeshStandardMaterial({ color: WAIT, roughness: 0.6 }),
  p0Point: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.5 }),
  directrix: new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.5, emissive: GOLD, emissiveIntensity: 0.12 }),
  plane: new THREE.MeshStandardMaterial({ color: WAIT, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  planeWire: new THREE.LineBasicMaterial({ color: WAIT, transparent: true, opacity: 0.6 }),
  circle: new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.5, emissive: GOLD, emissiveIntensity: 0.12 }),
  radiusLine: new THREE.LineDashedMaterial({ color: GOLD, dashSize: 0.12, gapSize: 0.08 }),
  radiusLine2: new THREE.LineDashedMaterial({ color: INK_2, dashSize: 0.12, gapSize: 0.08 }),
  sphereRadiusLine: new THREE.LineDashedMaterial({ color: WAIT, dashSize: 0.1, gapSize: 0.08 }),
  arc: new THREE.LineBasicMaterial({ color: BLUE, linewidth: 2 }),
  genLine: new THREE.LineBasicMaterial({ color: INK, linewidth: 2 }),
  surface: new THREE.MeshStandardMaterial({ color: BLUE, transparent: true, opacity: 0.18, side: THREE.DoubleSide, roughness: 0.7, metalness: 0, depthWrite: false }),
  surfaceWire: new THREE.MeshBasicMaterial({ color: BLUE, wireframe: true, transparent: true, opacity: 0.07 })
};

// --- 启动 ---
window.addEventListener('DOMContentLoaded', () => {
  initThree();
  initUI();
  updateChrome();
  setPlayUI();
  loop();
});

function initThree() {
  container = document.getElementById('canvas-container');

  // Set Z as UP
  THREE.Object3D.DefaultUp.set(0, 0, 1);

  scene = new THREE.Scene();
  scene.background = null;

  const aspect = container.clientWidth / container.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
  camera.position.set(7.5, -8.5, 6.0);
  camera.lookAt(0, 0, 0.5);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(0, 0, 0.5);
  controls.maxDistance = 28;
  controls.minDistance = 2;

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));

  const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.55);
  dirLight1.position.set(10, 10, 12);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.25);
  dirLight2.position.set(-10, -10, -5);
  scene.add(dirLight2);

  // Ground Grid (XY Plane)
  const gridHelper = new THREE.GridHelper(12, 24, 0xDAD8D0, 0xE9E7E0);
  gridHelper.rotation.x = Math.PI / 2;
  gridHelper.position.set(0, 0, -0.01);
  scene.add(gridHelper);

  buildReferenceAxes();
  scene.add(dynamicGroup);

  window.addEventListener('resize', onWindowResize);
}

function buildReferenceAxes() {
  const axesGroup = new THREE.Group();
  const axisLen = 5.2;
  const radius = 0.018;

  function createAxisLine(p1, p2, color) {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const geom = new THREE.CylinderGeometry(radius, radius, len, 16);
    geom.translate(0, len / 2, 0);
    geom.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(p1);
    mesh.lookAt(p2);
    axesGroup.add(mesh);

    const coneGeom = new THREE.ConeGeometry(radius * 3.0, radius * 6.5, 16);
    coneGeom.translate(0, radius * 3.2, 0);
    coneGeom.rotateX(Math.PI / 2);
    const coneMesh = new THREE.Mesh(coneGeom, mat);
    coneMesh.position.copy(p2);
    coneMesh.lookAt(p2.clone().add(dir.clone().normalize()));
    axesGroup.add(coneMesh);
  }

  createAxisLine(new THREE.Vector3(-axisLen * 0.7, 0, 0), new THREE.Vector3(axisLen, 0, 0), WAIT);
  createAxisLine(new THREE.Vector3(0, -axisLen * 0.7, 0), new THREE.Vector3(0, axisLen, 0), WAIT);
  createAxisLine(new THREE.Vector3(0, 0, -axisLen * 0.7), new THREE.Vector3(0, 0, axisLen), WAIT);

  axesGroup.add(createAxisLabel('+X', new THREE.Vector3(axisLen + 0.35, 0, 0), 'mute', true));
  axesGroup.add(createAxisLabel('+Y', new THREE.Vector3(0, axisLen + 0.35, 0), 'mute', true));
  axesGroup.add(createAxisLabel('+Z', new THREE.Vector3(0, 0, axisLen + 0.35), 'mute', true));

  scene.add(axesGroup);
}

// ==========================================
// --- 文字标签：同一精灵可原地换字，换字才重绘贴图 ---
// ==========================================

function makeSprite() {
  return new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
}

// 标签：墨色字、同色小点、纸色描边（压在图形上也清楚）；画布按 2 倍采样保证清晰
const LABEL_HEX = { ink: '#343C38', mute: '#5D655F', wait: '#9AA096', blue: '#2D5BBF', gold: '#BF8C32' };

function labelCanvas(text, tone, small) {
  const dpr = 2;
  const fs = small ? 14 : 16;
  const font = `500 ${fs}px "PingFang SC", "Microsoft YaHei", "JetBrains Mono", sans-serif`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const pad = 6;
  const textX = pad + 8;   // 小点之后
  const w = Math.ceil(textX + probe.measureText(text).width + pad);
  const h = Math.ceil(fs + 8);
  const canvas = document.createElement('canvas');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const cy = h / 2;
  ctx.strokeStyle = 'rgba(250, 249, 245, 0.95)';
  ctx.lineWidth = 4;
  ctx.strokeText(text, textX, cy);
  ctx.beginPath();
  ctx.arc(pad + 2, cy, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = LABEL_HEX[tone] || LABEL_HEX.ink;
  ctx.fill();
  ctx.fillStyle = LABEL_HEX.ink;
  ctx.fillText(text, textX, cy);
  return { canvas, w, h };
}

function paintLabel(sprite, text, tone, small) {
  const sig = `${text}|${tone}|${small}`;
  if (sprite.userData.sig === sig) return;
  sprite.userData.sig = sig;

  const { canvas, w, h } = labelCanvas(text, tone, small);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  if (sprite.material.map) sprite.material.map.dispose();
  sprite.material.map = texture;
  sprite.material.needsUpdate = true;

  const worldHeight = small ? 0.18 : 0.22;
  sprite.scale.set(worldHeight * (w / h), worldHeight, 1);
}

function createAxisLabel(text, position, tone, isSmall = false) {
  const sprite = makeSprite();
  sprite.position.copy(position);
  paintLabel(sprite, text, tone, isSmall);
  return sprite;
}

// ==========================================
// --- 结构重建（案例、预设、t、图层变化时）---
// ==========================================

function gridIndex(rows, cols) {
  const key = `${rows}x${cols}`;
  if (!gridIndices.has(key)) {
    const idx = [];
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j;
        const b = (i + 1) * cols + j;
        const c = (i + 1) * cols + j + 1;
        const d = i * cols + j + 1;
        idx.push(a, b, d, b, c, d);
      }
    }
    gridIndices.set(key, idx);
  }
  return gridIndices.get(key);
}

function clearScene() {
  while (dynamicGroup.children.length) {
    const obj = dynamicGroup.children[0];
    dynamicGroup.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.isSprite) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
  }
  for (const m of ownMaterials) m.dispose();
  ownMaterials = [];
  items = [];
  labelItems = new Map();
  dyn = {};
}

function rebuild(f) {
  clearScene();
  const R = RotModel.REVEAL[f.caseNo];
  const L = state.layers;

  // 每个对象登记它出现的步与所属图层；材质按对象复制，才能各自淡入
  const register = (obj, key, layer = null, theta = false) => {
    obj.frustumCulled = false; // 几何随 θ 原地更新，包围球不再准确
    const m = obj.material.clone();
    m.transparent = true;
    obj.material = m;
    ownMaterials.push(m);
    items.push({ obj, step: R[key] ?? 0, layer, theta, base: m.opacity, needArc: false });
    dynamicGroup.add(obj);
    return obj;
  };
  const sphere = (p, r, mat, key, layer = null) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 24), mat);
    m.position.copy(V(p));
    return register(m, key, layer);
  };
  const line = (pts, mat, key, layer = null, dashed = false, theta = false) => {
    const obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(V)), mat);
    if (dashed) obj.computeLineDistances();
    return register(obj, key, layer, theta);
  };
  const tube = (pts, r, mat, key, layer = null, closed = false) => {
    const path = new THREE.CatmullRomCurve3(pts.map(V), closed);
    return register(new THREE.Mesh(new THREE.TubeGeometry(path, 64, r, 12, closed), mat), key, layer);
  };
  const cylinderBetween = (a, b, r, mat, key) => {
    const A = V(a);
    const d = V(b).sub(A);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 20), mat);
    m.position.copy(A).add(V(b)).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(Y_AXIS, d.clone().normalize());
    return register(m, key);
  };
  const arrowAt = (p, dir, mat, key) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 16), mat);
    m.position.copy(V(p));
    m.quaternion.setFromUnitVectors(Y_AXIS, dir.clone().normalize());
    return register(m, key);
  };
  const planeParts = (p, key, layer) => {
    const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, V(p.normal).normalize());
    const rimPts = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      rimPts.push([Math.cos(a) * p.radius, Math.sin(a) * p.radius, 0]);
    }
    const disc = register(new THREE.Mesh(new THREE.CircleGeometry(p.radius, 40), materials.plane), key, layer);
    const rim = register(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts.map(V)), materials.planeWire), key, layer);
    for (const obj of [disc, rim]) {
      obj.position.copy(V(p.center));
      obj.quaternion.copy(q);
    }
  };
  const surfaceParts = (g) => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.surface.length), 3));
    geom.setIndex(gridIndex(g.rows, g.cols));
    dyn.surfaceGeom = geom;
    register(new THREE.Mesh(geom, materials.surface), 'surface', 'surface', true);
    register(new THREE.Mesh(geom, materials.surfaceWire), 'surface', 'surface', true);
  };

  if (f.caseNo === 3) {
    // §9 锥面：顶点、准线、准线平面、动点 M₁，以及随 θ 生长的曲面
    sphere(f.M0, 0.09, materials.p0Point, 'vertex');
    if (L.circle) tube(f.ring, 0.024, materials.directrix, 'dir', 'circle', true);
    if (L.plane) planeParts(f.plane, 'plane', 'plane');
    sphere(f.M1, 0.085, materials.m1Point, 'M1');
    if (L.radius) {
      line(f.gen, materials.genLine, 'line', 'radius');
      line(f.tri, materials.sphereRadiusLine, 'tri', 'radius', true);
    }
    if (L.surface) surfaceParts(f);
  } else {
    // §8 旋转：轴、母线、纬圆、半径线与扫掠曲面
    cylinderBetween(f.axis.from, f.axis.to, 0.022, materials.axis, 'axis');
    arrowAt(f.axis.to, V(f.axis.to).sub(V(f.axis.from)), materials.axis, 'axis');
    tube(f.gen, 0.03, materials.generatrix, 'gen');
    sphere(f.M0, 0.085, materials.m1Point, 'M0');
    sphere(f.C0, 0.05, materials.centerPoint, 'C0');
    if (L.plane) planeParts(f.plane, 'plane', 'plane');
    if (L.circle && f.r > 0.02) tube(f.ring, 0.018, materials.circle, 'ring', 'circle', true);
    if (L.radius && f.r > 0.02) {
      line(f.radiusM0, materials.radiusLine2, 'radiusM0', 'radius', true);
      if (f.sphereM0) line(f.sphereM0, materials.sphereRadiusLine, 'sphereM0', 'radius', true);
      dyn.radiusP = line(f.radiusP, materials.radiusLine, 'radiusP', 'radius', true);
      if (f.sphereP) dyn.sphereP = line(f.sphereP, materials.sphereRadiusLine, 'sphereP', 'radius', true);
      dyn.arc = line(f.arc, materials.arc, 'arc', 'radius', false, true);
    }
    dyn.P = sphere(f.P, 0.11, materials.mPoint, 'P');
    if (L.surface) surfaceParts(f);
  }

  // 标签：每个都创建，显隐与文字在 update 中按帧处理
  for (const l of f.labels) {
    const sprite = makeSprite();
    sprite.frustumCulled = false;
    paintLabel(sprite, l.text, l.tone, l.small);
    const it = {
      obj: sprite,
      step: R[l.key] ?? 0,
      layer: l.layer ?? null,
      theta: l.key === 'theta',
      base: 1,
      needArc: l.key === 'theta'
    };
    items.push(it);
    labelItems.set(l.key, it);
    dynamicGroup.add(sprite);
  }
}

// ==========================================
// --- 逐帧更新：只写位置、顶点与透明度，不新建对象 ---
// ==========================================

function setPoints(obj, pts, dashed) {
  const attr = obj.geometry.attributes.position;
  for (let i = 0; i < pts.length; i++) attr.setXYZ(i, pts[i][0], pts[i][1], pts[i][2]);
  attr.needsUpdate = true;
  if (dashed) obj.computeLineDistances();
}

function update(f, loc) {
  const still = f.theta <= STILL;
  const hasArc = !!dyn.arc;

  // 显隐与淡入：由（步号，步内秒数）与图层决定
  for (const it of items) {
    const alpha = RotModel.revealAlpha(loc.index, loc.local, it.step, state.reduce);
    const layerOn = it.layer === null || state.layers[it.layer];
    it.obj.visible = layerOn && alpha > 0 && !(it.theta && still) && !(it.needArc && !hasArc);
    it.obj.material.opacity = it.base * alpha;
  }

  // 标签：换字才重绘，位置每帧写入
  for (const l of f.labels) {
    const it = labelItems.get(l.key);
    if (!it) continue;
    paintLabel(it.obj, l.text, l.tone, l.small);
    it.obj.position.copy(V(l.pos));
  }

  if (dyn.P) dyn.P.position.copy(V(f.P));
  if (dyn.radiusP) setPoints(dyn.radiusP, f.radiusP, true);
  if (dyn.sphereP) setPoints(dyn.sphereP, f.sphereP, true);
  if (dyn.arc) setPoints(dyn.arc, f.arc, false);
  if (dyn.surfaceGeom && !still) {
    const attr = dyn.surfaceGeom.attributes.position;
    attr.array.set(f.surface);
    attr.needsUpdate = true;
    dyn.surfaceGeom.computeVertexNormals();
  }
}

// ==========================================
// --- 推导卡片、进度与状态（只在变化时写 DOM）---
// ==========================================

// 当前案例的时间线（§9 为六步）
function timelineNow() {
  return RotModel.timeline(state.thetaTarget, state.reduce, RotModel.stepCount(state.currentCase));
}

function typeset(el) {
  if (!window.renderMathInElement) return;
  window.renderMathInElement(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false }
    ],
    throwOnError: false
  });
}

function buildStepButtons(names) {
  const box = document.getElementById('steps');
  box.style.gridTemplateColumns = `repeat(${names.length}, minmax(0, 1fr))`;
  box.innerHTML = names
    .map((n, i) => `<button type="button" data-step="${i}" title="第 ${i + 1} 步：${n}"><span>${i + 1}</span>${n}</button>`)
    .join('');
}

// 推导卡里的速查表：表头、单元格与高亮行由 model.js 给出
function tableHtml(tb, hi) {
  const col = (j) => (tb.hiCol && j === hi ? ' class="hi-col"' : '');
  const head = tb.head.map((h, j) => `<th${col(j)}>${h}</th>`).join('');
  const body = tb.rows
    .map((r, i) => `<tr${!tb.hiCol && i === hi ? ' class="hi-row"' : ''}>${r.map((c, j) => `<td${col(j)}>${c}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderStepCard(index, steps) {
  const st = steps[index];
  document.querySelectorAll('#steps [data-step]').forEach((b, i) => {
    const on = i === index;
    if (on) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  });
  document.getElementById('step-no').innerText = `第 ${index + 1} / ${steps.length} 步`;
  document.getElementById('step-title').innerText = st.title;
  document.getElementById('narration').innerText = st.narration;
  // 表格步加宽推导卡；宽度写在行内，不依赖样式表
  document.getElementById('deriv-wrap').style.width = st.wide ? 'var(--deriv-wide)' : '';

  const html = st.lines
    .map((l) => {
      const note = l.note ? `<p class="note">${l.note}</p>` : '';
      if (l.table) return `${note}${tableHtml(l.table, l.hi)}`;
      return `${note}${l.tex ? `<div class="formula-box">$$${l.tex}$$</div>` : ''}`;
    })
    .join('');
  const box = document.getElementById('step-formulas');
  const token = ++cardToken;
  box.style.opacity = '0';
  setTimeout(() => {
    if (token !== cardToken) return;
    box.innerHTML = html;
    typeset(box);
    box.style.opacity = '1';
  }, 120);
}

function syncCard(loc, tl, f) {
  const { currentCase: c, presetIndex: p, t, thetaTarget } = state;
  const key = [c, p, t.toFixed(3), thetaTarget, loc.index].join('|');
  if (key !== cardKey) {
    cardKey = key;
    renderStepCard(loc.index, RotModel.steps(c, p, t, thetaTarget));
  }

  const prog = `${((state.clock / tl.total) * 100).toFixed(1)}%`;
  if (prog !== shownProg) {
    shownProg = prog;
    document.getElementById('prog').style.width = prog;
  }

  const status = `${Math.round(f.theta)}|${loc.index}`;
  if (status !== shownStatus) {
    shownStatus = status;
    document.getElementById('hud-theta').innerText = `θ ${Math.round(f.theta)}°`;
    document.getElementById('hud-phase').innerText = `第 ${loc.index + 1} 步`;
  }
}

function syncThetaSlider() {
  const shown = Math.round(state.thetaTarget);
  if (shown === shownTheta) return;
  shownTheta = shown;
  document.getElementById('val-theta').innerText = `${shown}°`;
  document.getElementById('slider-theta').value = shown;
}

function draw(tl) {
  const { currentCase, presetIndex, t, thetaTarget, layers } = state;
  const loc = RotModel.locate(tl, state.clock);
  const theta = RotModel.thetaAt(tl, loc.index, loc.local, thetaTarget, state.reduce);
  const f = RotModel.frame(currentCase, presetIndex, t, theta);

  const sk = [currentCase, presetIndex, t.toFixed(3), layers.plane, layers.circle, layers.radius, layers.surface].join('|');
  if (sk !== structKey) {
    structKey = sk;
    rebuild(f);
  }
  update(f, loc);
  syncCard(loc, tl, f);
  syncThetaSlider();
}

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.1) : 0; // 切后台再回来时不跳变
  lastNow = now;

  const tl = timelineNow();
  if (state.playing) {
    state.clock += dt;
    if (state.clock >= tl.total) {
      state.clock = tl.total;
      state.playing = false;
      setPlayUI();
    }
  }

  draw(tl);
  controls.update();
  renderer.render(scene, camera);
}

// ==========================================
// --- 界面文字、切换与控件 ---
// ==========================================

function setSliderLabel(el, tone, text) {
  el.innerHTML = `<span class="tone-dot" data-tone="${tone}"></span>${text}`;
  typeset(el);
}

function updateChrome() {
  const { currentCase: c, presetIndex: p } = state;
  const T = RotModel.texts(c, p);
  const $ = (id) => document.getElementById(id);

  $('case-badge').innerText = T.badge;
  $('hud-subbadge').innerText = T.sub;
  $('hud-axis-label').innerText = T.axisLabel;
  $('hud-axis').innerText = T.axis;
  $('hud-curve-label').innerText = T.curveLabel;
  $('hud-curve').innerText = T.curve;
  $('hud-surface-label').innerText = T.surfaceLabel;
  $('hud-surface').innerText = T.surface;

  setSliderLabel($('label-slider-t'), T.tDot, T.tLabel);
  setSliderLabel($('label-slider-theta'), T.thetaDot, T.thetaLabel);

  $('layer-text-plane').innerText = T.layers.plane;
  $('layer-text-circle').innerText = T.layers.circle;
  $('layer-text-radius').innerText = T.layers.radius;
  $('layer-text-surface').innerText = T.layers.surface;
  $('btn-preset-1').innerText = T.presets[0];
  $('btn-preset-2').innerText = T.presets[1];
  $('foot-note').innerText = T.footer;

  buildStepButtons(RotModel.steps(c, p, state.t, state.thetaTarget).map((s) => s.name));
  cardKey = '';

  [1, 2, 3].forEach((n) => {
    const tab = $(`tab-case${n}`);
    const on = n === c;
    tab.classList.toggle('active', on);
  });
  $('btn-preset-1').setAttribute('aria-pressed', String(p === 0));
  $('btn-preset-2').setAttribute('aria-pressed', String(p === 1));
}

// 切换案例或预设：从第一步自动播放
function switchTo(caseNo, preset) {
  state.currentCase = caseNo;
  state.presetIndex = preset;
  state.clock = 0;
  state.playing = true;
  updateChrome();
  setPlayUI();
}

function setPlayUI() {
  const on = state.playing;
  document.getElementById('play-text').innerText = on ? '暂停' : '播放推导';
  document.getElementById('btn-play').dataset.playing = String(on);
  document.getElementById('lamp').dataset.on = String(on && !state.reduce);
}

// 跳到第 i 步的起点并暂停（一步一个主动作）
function stepTo(i) {
  const tl = timelineNow();
  const k = Math.min(Math.max(i, 0), tl.starts.length - 1);
  state.clock = tl.starts[k] + Math.min(RotModel.FADE_SEC, tl.durations[k]);   // 停在淡入结束处，本步的对象已经可见
  state.playing = false;
  setPlayUI();
}

function stepBy(delta) {
  const tl = timelineNow();
  stepTo(RotModel.locate(tl, state.clock).index + delta);
}

function togglePlay() {
  const tl = timelineNow();
  if (!state.playing && state.clock >= tl.total) state.clock = 0;
  state.playing = !state.playing;
  setPlayUI();
}

function replay() {
  state.clock = 0;
  state.playing = true;
  setPlayUI();
}

// 改动时间线参数（θ、减少动效）时保持当前所在的步与步内位置，不让步号跳动
function setTimelineParams(mutate) {
  const before = timelineNow();
  const loc = RotModel.locate(before, state.clock);
  mutate();
  const after = timelineNow();
  state.clock = after.starts[loc.index] + Math.min(loc.local, after.durations[loc.index]);
}

function initUI() {
  document.getElementById('deriv-wrap').style.transition = 'width 200ms ease';
  [1, 2, 3].forEach((n) => {
    document.getElementById(`tab-case${n}`).addEventListener('click', () => {
      if (state.currentCase !== n) switchTo(n, 0);
    });
  });
  document.getElementById('btn-preset-1').addEventListener('click', () => {
    if (state.presetIndex !== 0) switchTo(state.currentCase, 0);
  });
  document.getElementById('btn-preset-2').addEventListener('click', () => {
    if (state.presetIndex !== 1) switchTo(state.currentCase, 1);
  });

  document.getElementById('slider-t').addEventListener('input', (e) => {
    state.t = parseFloat(e.target.value);
    document.getElementById('val-t').innerText = state.t.toFixed(2);
  });
  document.getElementById('slider-theta').addEventListener('input', (e) => {
    setTimelineParams(() => { state.thetaTarget = parseFloat(e.target.value); });
    document.getElementById('val-theta').innerText = `${Math.round(state.thetaTarget)}°`;
  });

  document.getElementById('btn-prev').addEventListener('click', () => stepBy(-1));
  document.getElementById('btn-next').addEventListener('click', () => stepBy(1));
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-replay').addEventListener('click', replay);
  document.getElementById('steps').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b) stepTo(Number(b.dataset.step));
  });

  ['plane', 'circle', 'radius', 'surface'].forEach((key) => {
    document.getElementById(`layer-${key}`).addEventListener('change', (e) => {
      state.layers[key] = e.target.checked;
    });
  });

  const reduce = document.getElementById('reduce');
  reduce.checked = state.reduce;
  reduce.addEventListener('change', (e) => {
    setTimelineParams(() => { state.reduce = e.target.checked; });
    setPlayUI();
  });

  document.getElementById('btn-reset-cam').addEventListener('click', () => {
    const target = { x: 7.5, y: -8.5, z: 6.0 };
    const focus = { x: 0, y: 0, z: 0.5 };
    if (!window.gsap || state.reduce) {
      camera.position.set(target.x, target.y, target.z);
      controls.target.set(focus.x, focus.y, focus.z);
      return;
    }
    gsap.to(camera.position, { ...target, duration: 1.0, ease: 'power2.out', onUpdate: () => controls.update() });
    gsap.to(controls.target, { ...focus, duration: 1.0, ease: 'power2.out' });
  });

  // 键盘：焦点在表单控件与按钮上时不抢键
  document.addEventListener('keydown', (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (el && el.closest('input, select, textarea, button, a')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      stepBy(1);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      stepBy(-1);
    } else if (e.code === 'Home') {
      e.preventDefault();
      replay();
    }
  });

  // 切到后台时暂停
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.playing) {
      state.playing = false;
      setPlayUI();
    }
  });
}

function onWindowResize() {
  if (!container || !renderer || !camera) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}
