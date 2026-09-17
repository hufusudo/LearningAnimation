/**
 * 空间曲面方程求解与几何直观 (旋转曲面 & 锥面)
 * 严格按照考点笔记编写：
 * - §8.1 母线不在坐标面上，绕坐标轴旋转 (模型一)
 * - §8.2 旋转轴为空间一般直线 (模型二，考研数学一真题模型)
 * - §9 锥面及其方程 (顶点·母线·准线，齐次方程与开方正负辨析)
 */

// --- Global State ---
const state = {
  currentCase: 1, // 1: §8.1 母线非坐标面, 2: §8.2 斜轴旋转(考研真题), 3: §9 锥面及其方程
  presetIndex: 0, // 0: 核心经典题型, 1: 几何变体
  t: 0.60,        // 母线动点参数 / 准线参角
  theta: 220,     // 扫掠角度 (度)
  isPlaying: false,
  layers: {
    plane: true,
    circle: true,
    radius: true,
    surface: true
  }
};

// --- Three.js Variables ---
let scene, camera, renderer, controls;
let container;

const dynamicGroup = new THREE.Group();

// Materials Palette
const materials = {
  axis: new THREE.MeshStandardMaterial({ color: 0xE11D48, roughness: 0.3, metalness: 0.2 }),
  generatrix: new THREE.MeshStandardMaterial({ color: 0x2563EB, roughness: 0.3, metalness: 0.2 }),
  m1Point: new THREE.MeshStandardMaterial({ color: 0x1D4ED8, roughness: 0.2, emissive: 0x1E40AF, emissiveIntensity: 0.35 }),
  mPoint: new THREE.MeshStandardMaterial({ color: 0xD97706, roughness: 0.2, emissive: 0xB45309, emissiveIntensity: 0.35 }),
  centerPoint: new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5 }),
  p0Point: new THREE.MeshStandardMaterial({ color: 0xDC2626, roughness: 0.2, emissive: 0x991B1B, emissiveIntensity: 0.4 }),
  directrix: new THREE.MeshStandardMaterial({ color: 0x059669, roughness: 0.3, emissive: 0x047857, emissiveIntensity: 0.25 }),
  plane: new THREE.MeshStandardMaterial({
    color: 0x0D9488,
    transparent: true,
    opacity: 0.20,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  planeWire: new THREE.LineBasicMaterial({ color: 0x0D9488, transparent: true, opacity: 0.4 }),
  circle: new THREE.MeshStandardMaterial({ color: 0xF59E0B, roughness: 0.3, emissive: 0xD97706, emissiveIntensity: 0.25 }),
  radiusLine: new THREE.LineDashedMaterial({ color: 0xD97706, dashSize: 0.15, gapSize: 0.08, linewidth: 2 }),
  radiusLine2: new THREE.LineDashedMaterial({ color: 0x2563EB, dashSize: 0.15, gapSize: 0.08, linewidth: 2 }),
  sphereRadiusLine: new THREE.LineDashedMaterial({ color: 0x9333EA, dashSize: 0.15, gapSize: 0.08, linewidth: 2 }),
  surface: new THREE.MeshStandardMaterial({
    color: 0x6366F1,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    roughness: 0.4,
    metalness: 0.1,
    depthWrite: false
  }),
  surfaceWire: new THREE.MeshBasicMaterial({
    color: 0x4338CA,
    wireframe: true,
    transparent: true,
    opacity: 0.12
  })
};

// --- Initialization ---
window.addEventListener('DOMContentLoaded', () => {
  initThree();
  initUI();
  updateModel();
  animate();
  initKaTeX();
});

function initKaTeX() {
  const tryRender = () => {
    if (window.renderMathInElement) {
      window.renderMathInElement(document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    } else {
      setTimeout(tryRender, 100);
    }
  };
  tryRender();
}

/**
 * Initialize Three.js Scene, Camera, Lights, Grid
 */
function initThree() {
  container = document.getElementById('canvas-container');

  // Set Z as UP
  THREE.Object3D.DefaultUp.set(0, 0, 1);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xFAF9F5);

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

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambientLight);

  const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight1.position.set(10, 10, 12);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0xE2E8F0, 0.45);
  dirLight2.position.set(-10, -10, -5);
  scene.add(dirLight2);

  // Ground Grid (XY Plane)
  const gridHelper = new THREE.GridHelper(12, 24, 0xD6D3CD, 0xE7E5DF);
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

  createAxisLine(new THREE.Vector3(-axisLen * 0.7, 0, 0), new THREE.Vector3(axisLen, 0, 0), 0xDC2626);
  createAxisLine(new THREE.Vector3(0, -axisLen * 0.7, 0), new THREE.Vector3(0, axisLen, 0), 0x16A34A);
  createAxisLine(new THREE.Vector3(0, 0, -axisLen * 0.7), new THREE.Vector3(0, 0, axisLen), 0x2563EB);

  axesGroup.add(createAxisLabel('+X', new THREE.Vector3(axisLen + 0.35, 0, 0), '#DC2626', true));
  axesGroup.add(createAxisLabel('+Y', new THREE.Vector3(0, axisLen + 0.35, 0), '#16A34A', true));
  axesGroup.add(createAxisLabel('+Z', new THREE.Vector3(0, 0, axisLen + 0.35), '#2563EB', true));

  scene.add(axesGroup);
}

function createAxisLabel(text, position, colorStr, isSmall = false) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = isSmall ? 28 : 34;
  ctx.font = `600 ${fontSize}px "JetBrains Mono", -apple-system, sans-serif`;
  const textMetrics = ctx.measureText(text);
  const textWidth = Math.ceil(textMetrics.width);
  const paddingX = 16;
  const paddingY = 8;
  const canvasWidth = Math.max(70, textWidth + paddingX * 2);
  const canvasHeight = fontSize + paddingY * 2;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  ctx.font = `600 ${fontSize}px "JetBrains Mono", -apple-system, sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.strokeStyle = '#E5E4DC';
  ctx.lineWidth = 2;

  const r = 8;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(2, 2, canvasWidth - 4, canvasHeight - 4, r);
  } else {
    ctx.rect(2, 2, canvasWidth - 4, canvasHeight - 4);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colorStr;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.copy(position);

  const worldHeight = isSmall ? 0.22 : 0.30;
  const worldWidth = worldHeight * (canvasWidth / canvasHeight);
  sprite.scale.set(worldWidth, worldHeight, 1);
  return sprite;
}

function onWindowResize() {
  if (!container || !renderer || !camera) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);

  if (state.isPlaying) {
    state.theta = (state.theta + 1.2) % 360;
    const thetaSlider = document.getElementById('slider-theta');
    const thetaVal = document.getElementById('val-theta');
    if (thetaSlider) thetaSlider.value = Math.round(state.theta);
    if (thetaVal) thetaVal.innerText = `${Math.round(state.theta)}°`;
    updateModelGeometryOnly();
  }

  controls.update();
  renderer.render(scene, camera);
}

// ==========================================
// --- Geometry Builders for 3 Scenarios ---
// ==========================================

function updateModel() {
  while (dynamicGroup.children.length > 0) {
    const obj = dynamicGroup.children[0];
    dynamicGroup.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
  }

  if (state.currentCase === 1) {
    buildCase1Geometry();
  } else if (state.currentCase === 2) {
    buildCase2Geometry();
  } else {
    buildCase3Geometry();
  }

  updateHUD();
  updateExplanationText();
}

function updateModelGeometryOnly() {
  while (dynamicGroup.children.length > 0) {
    const obj = dynamicGroup.children[0];
    dynamicGroup.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
  }

  if (state.currentCase === 1) {
    buildCase1Geometry();
  } else if (state.currentCase === 2) {
    buildCase2Geometry();
  } else {
    buildCase3Geometry();
  }

  updateHUDValues();
}

/**
 * CASE 1: §8.1 母线不在坐标面上，绕坐标轴旋转 (模型一)
 */
function buildCase1Geometry() {
  const t = state.t;
  const thetaRad = (state.theta * Math.PI) / 180;

  // 1. Rotation Axis: z-axis
  const axisGeom = new THREE.CylinderGeometry(0.032, 0.032, 7.0, 20);
  axisGeom.rotateX(Math.PI / 2);
  const axisMesh = new THREE.Mesh(axisGeom, materials.axis);
  dynamicGroup.add(axisMesh);

  const axisCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.35, 16).rotateX(Math.PI / 2),
    materials.axis
  );
  axisCone.position.set(0, 0, 3.5);
  dynamicGroup.add(axisCone);
  dynamicGroup.add(createAxisLabel('旋转轴 L (z轴)', new THREE.Vector3(0, 0.45, 3.6), '#E11D48'));

  const isPreset0 = state.presetIndex === 0;
  const a = 1.8;
  const c = 1.2;

  function getGeneratrixPoint(u) {
    if (isPreset0) {
      return new THREE.Vector3(a, u, c * u);
    } else {
      return new THREE.Vector3(1.0 + 0.25 * u * u, 0.8 * u, u);
    }
  }

  // 2. Generatrix Curve C
  const curvePoints = [];
  const uMin = isPreset0 ? -2.2 : -2.0;
  const uMax = isPreset0 ? 2.2 : 2.0;
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const u = uMin + (uMax - uMin) * (i / steps);
    curvePoints.push(getGeneratrixPoint(u));
  }
  const curvePath = new THREE.CatmullRomCurve3(curvePoints);
  const curveGeom = new THREE.TubeGeometry(curvePath, 64, 0.045, 12, false);
  const curveMesh = new THREE.Mesh(curveGeom, materials.generatrix);
  dynamicGroup.add(curveMesh);
  dynamicGroup.add(createAxisLabel('母线 C', getGeneratrixPoint(uMax).add(new THREE.Vector3(0.2, 0.2, 0.2)), '#2563EB'));

  // 3. Mother point M0
  const M0 = getGeneratrixPoint(t);
  const m1Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 24), materials.m1Point);
  m1Mesh.position.copy(M0);
  dynamicGroup.add(m1Mesh);
  dynamicGroup.add(createAxisLabel('M₀(x₀, y₀, z₀)', M0.clone().add(new THREE.Vector3(0.3, 0.2, 0.2)), '#1D4ED8'));

  // 4. Center C0 on axis
  const C0 = new THREE.Vector3(0, 0, M0.z);
  const c0Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), materials.centerPoint);
  c0Mesh.position.copy(C0);
  dynamicGroup.add(c0Mesh);

  const radius = Math.sqrt(M0.x * M0.x + M0.y * M0.y);
  const baseAngle = Math.atan2(M0.y, M0.x);

  // 5. Perpendicular Plane π (z = z0)
  if (state.layers.plane) {
    const planeSize = Math.max(radius * 2.2, 3.2);
    const planeGeom = new THREE.CircleGeometry(planeSize, 40);
    const planeMesh = new THREE.Mesh(planeGeom, materials.plane);
    planeMesh.position.set(0, 0, M0.z);
    dynamicGroup.add(planeMesh);

    const ringEdgeGeom = new THREE.BufferGeometry().setFromPoints(
      new THREE.Path().absarc(0, 0, planeSize, 0, Math.PI * 2, true).getPoints(40)
    );
    const ringLine = new THREE.Line(ringEdgeGeom, materials.planeWire);
    ringLine.position.set(0, 0, M0.z);
    dynamicGroup.add(ringLine);
    dynamicGroup.add(createAxisLabel('同高法平面 π : z = z₀', new THREE.Vector3(-planeSize * 0.7, planeSize * 0.7, M0.z + 0.08), '#0D9488'));
  }

  // 6. Latitude Circle
  if (state.layers.circle) {
    const circleCurve = new THREE.EllipseCurve(0, 0, radius, radius, 0, 2 * Math.PI, false, 0);
    const circlePoints = circleCurve.getPoints(64).map(p => new THREE.Vector3(p.x, p.y, M0.z));
    const circlePath = new THREE.CatmullRomCurve3(circlePoints, true);
    const circleGeom = new THREE.TubeGeometry(circlePath, 64, 0.026, 12, true);
    const circleMesh = new THREE.Mesh(circleGeom, materials.circle);
    dynamicGroup.add(circleMesh);
  }

  // 7. Swept Point P(x, y, z)
  const currentAngle = baseAngle + thetaRad;
  const P = new THREE.Vector3(
    radius * Math.cos(currentAngle),
    radius * Math.sin(currentAngle),
    M0.z
  );
  const mMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 24), materials.mPoint);
  mMesh.position.copy(P);
  dynamicGroup.add(mMesh);
  dynamicGroup.add(createAxisLabel('P(x, y, z)', P.clone().add(new THREE.Vector3(0.25, 0.25, 0.2)), '#D97706'));

  // 8. Distance Lines
  if (state.layers.radius) {
    const lineGeom1 = new THREE.BufferGeometry().setFromPoints([C0, M0]);
    const rLine1 = new THREE.Line(lineGeom1, materials.radiusLine2);
    rLine1.computeLineDistances();
    dynamicGroup.add(rLine1);

    const lineGeom2 = new THREE.BufferGeometry().setFromPoints([C0, P]);
    const rLine2 = new THREE.Line(lineGeom2, materials.radiusLine);
    rLine2.computeLineDistances();
    dynamicGroup.add(rLine2);

    if (thetaRad > 0.05) {
      const arcPoints = [];
      const arcRadius = radius * 0.45;
      for (let i = 0; i <= 30; i++) {
        const aVal = baseAngle + thetaRad * (i / 30);
        arcPoints.push(new THREE.Vector3(arcRadius * Math.cos(aVal), arcRadius * Math.sin(aVal), M0.z));
      }
      const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPoints);
      const arcLine = new THREE.Line(arcGeom, new THREE.LineBasicMaterial({ color: 0xD97706, linewidth: 2 }));
      dynamicGroup.add(arcLine);

      const midAngle = baseAngle + thetaRad * 0.5;
      const arcTextPos = new THREE.Vector3(arcRadius * 1.35 * Math.cos(midAngle), arcRadius * 1.35 * Math.sin(midAngle), M0.z);
      dynamicGroup.add(createAxisLabel(`θ = ${Math.round(state.theta)}°`, arcTextPos, '#D97706', true));
    }
  }

  // 9. Swept Surface Mesh
  if (state.layers.surface && thetaRad > 0.05) {
    const uSegments = 40;
    const vSegments = Math.max(8, Math.round(thetaRad * 16));
    const vertices = [];
    const indices = [];

    for (let i = 0; i <= uSegments; i++) {
      const u = uMin + (uMax - uMin) * (i / uSegments);
      const pGen = getGeneratrixPoint(u);
      const r_u = Math.sqrt(pGen.x * pGen.x + pGen.y * pGen.y);
      const baseA_u = Math.atan2(pGen.y, pGen.x);

      for (let j = 0; j <= vSegments; j++) {
        const v = (j / vSegments) * thetaRad;
        const ang = baseA_u + v;
        vertices.push(r_u * Math.cos(ang), r_u * Math.sin(ang), pGen.z);
      }
    }

    for (let i = 0; i < uSegments; i++) {
      for (let j = 0; j < vSegments; j++) {
        const aIdx = i * (vSegments + 1) + j;
        const bIdx = (i + 1) * (vSegments + 1) + j;
        const cIdx = (i + 1) * (vSegments + 1) + (j + 1);
        const dIdx = i * (vSegments + 1) + (j + 1);
        indices.push(aIdx, bIdx, dIdx, bIdx, cIdx, dIdx);
      }
    }

    const surfGeom = new THREE.BufferGeometry();
    surfGeom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    surfGeom.setIndex(indices);
    surfGeom.computeVertexNormals();

    dynamicGroup.add(new THREE.Mesh(surfGeom, materials.surface));
    dynamicGroup.add(new THREE.Mesh(surfGeom, materials.surfaceWire));
  }
}

/**
 * CASE 2: §8.2 旋转轴为空间一般直线 (考研数学一真题模型)
 * L1: x/1 = y/2 = z/3 rotating around L2: x = y = z
 */
function buildCase2Geometry() {
  const t = state.t;
  const thetaRad = (state.theta * Math.PI) / 180;

  // 1. Rotation Axis L2: line x = y = z, direction s = (1, 1, 1), unit vector u
  const axisDir = new THREE.Vector3(1, 1, 1).normalize();
  const axisLen = 6.8;
  const pStart = axisDir.clone().multiplyScalar(-axisLen * 0.45);
  const pEnd = axisDir.clone().multiplyScalar(axisLen * 0.55);

  const axisGeom = new THREE.CylinderGeometry(0.035, 0.035, axisLen, 20);
  axisGeom.translate(0, axisLen / 2, 0);
  axisGeom.rotateX(Math.PI / 2);
  const axisMesh = new THREE.Mesh(axisGeom, materials.axis);
  axisMesh.position.copy(pStart);
  axisMesh.lookAt(pEnd);
  dynamicGroup.add(axisMesh);

  const axisCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.13, 0.35, 16).rotateX(Math.PI / 2),
    materials.axis
  );
  axisCone.position.copy(pEnd);
  axisCone.lookAt(pEnd.clone().add(axisDir));
  dynamicGroup.add(axisCone);
  dynamicGroup.add(createAxisLabel('旋转轴 L₂: x = y = z (s=(1,1,1))', pEnd.clone().add(new THREE.Vector3(0.2, 0.2, 0.3)), '#E11D48'));

  // Base Point A / O(0,0,0)
  const p0Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), materials.p0Point);
  p0Mesh.position.set(0, 0, 0);
  dynamicGroup.add(p0Mesh);
  dynamicGroup.add(createAxisLabel('基准定点 O(0,0,0)', new THREE.Vector3(-0.35, -0.35, -0.2), '#991B1B'));

  // Generatrix L1:
  // Preset 0: 考研真题模型 L1: x/1 = y/2 = z/3  => M0(u, 2u, 3u)
  // Preset 1: 直线 z 轴 => M0(0, 0, u)
  const isPreset0 = state.presetIndex === 0;

  function getGeneratrixPoint(u) {
    if (isPreset0) {
      return new THREE.Vector3(u, 2 * u, 3 * u);
    } else {
      return new THREE.Vector3(0, 0, u);
    }
  }

  // 2. Generatrix Line
  const uMin = isPreset0 ? -1.0 : -2.5;
  const uMax = isPreset0 ? 1.0 : 2.5;
  const ptStart = getGeneratrixPoint(uMin);
  const ptEnd = getGeneratrixPoint(uMax);

  const curvePoints = [ptStart, ptEnd];
  const curvePath = new THREE.CatmullRomCurve3(curvePoints);
  const curveGeom = new THREE.TubeGeometry(curvePath, 20, 0.045, 12, false);
  const curveMesh = new THREE.Mesh(curveGeom, materials.generatrix);
  dynamicGroup.add(curveMesh);

  dynamicGroup.add(createAxisLabel(isPreset0 ? '母线 L₁: x/1 = y/2 = z/3' : '母线 L₁: z轴', ptEnd.clone().add(new THREE.Vector3(0.2, 0.2, 0.2)), '#2563EB'));

  // 3. Mother point M0
  const M0 = getGeneratrixPoint(t);
  const m1Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 24), materials.m1Point);
  m1Mesh.position.copy(M0);
  dynamicGroup.add(m1Mesh);
  dynamicGroup.add(createAxisLabel(isPreset0 ? `M₀(t, 2t, 3t)` : `M₀(0, 0, t)`, M0.clone().add(new THREE.Vector3(0.2, 0.2, 0.2)), '#1D4ED8'));

  // 4. Center C0 (Foot of perpendicular on L2)
  const h = M0.dot(axisDir);
  const C0 = axisDir.clone().multiplyScalar(h);
  const c0Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), materials.centerPoint);
  c0Mesh.position.copy(C0);
  dynamicGroup.add(c0Mesh);

  // Basis in normal plane perpendicular to axisDir
  const e1 = new THREE.Vector3().subVectors(M0, C0);
  let radius = e1.length();

  let v1 = new THREE.Vector3();
  let v2 = new THREE.Vector3();

  if (radius > 0.001) {
    v1.copy(e1).normalize();
    v2.crossVectors(axisDir, v1).normalize();
  } else {
    radius = 0.0001;
    v1.set(1, 0, 0);
    v2.crossVectors(axisDir, v1).normalize();
  }

  // 5. Perpendicular Plane π : normal = axisDir
  if (state.layers.plane) {
    const planeSize = Math.max(radius * 2.2, 2.5);
    const planeGeom = new THREE.CircleGeometry(planeSize, 40);
    const planeMesh = new THREE.Mesh(planeGeom, materials.plane);
    planeMesh.position.copy(C0);
    planeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisDir);
    dynamicGroup.add(planeMesh);

    const ringPoints = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      ringPoints.push(new THREE.Vector3(Math.cos(a) * planeSize, Math.sin(a) * planeSize, 0));
    }
    const ringGeom = new THREE.BufferGeometry().setFromPoints(ringPoints);
    const ringLine = new THREE.Line(ringGeom, materials.planeWire);
    ringLine.position.copy(C0);
    ringLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisDir);
    dynamicGroup.add(ringLine);

    const planeLabelText = isPreset0 ? '垂直法截面 π : x+y+z = 6t' : '垂直法截面 π : x+y+z = t';
    const planeLabelPos = C0.clone().add(v2.clone().multiplyScalar(planeSize * 0.75)).add(new THREE.Vector3(0, 0, 0.1));
    dynamicGroup.add(createAxisLabel(planeLabelText, planeLabelPos, '#0D9488'));
  }

  // 6. Latitude Circle
  if (state.layers.circle && radius > 0.02) {
    const circlePoints = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const pt = C0.clone()
        .add(v1.clone().multiplyScalar(radius * Math.cos(a)))
        .add(v2.clone().multiplyScalar(radius * Math.sin(a)));
      circlePoints.push(pt);
    }
    const circlePath = new THREE.CatmullRomCurve3(circlePoints, true);
    const circleGeom = new THREE.TubeGeometry(circlePath, 64, 0.026, 12, true);
    const circleMesh = new THREE.Mesh(circleGeom, materials.circle);
    dynamicGroup.add(circleMesh);
  }

  // 7. Swept Point P(x, y, z)
  const P = C0.clone()
    .add(v1.clone().multiplyScalar(radius * Math.cos(thetaRad)))
    .add(v2.clone().multiplyScalar(radius * Math.sin(thetaRad)));

  const mMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 24), materials.mPoint);
  mMesh.position.copy(P);
  dynamicGroup.add(mMesh);
  dynamicGroup.add(createAxisLabel('P(x, y, z)', P.clone().add(new THREE.Vector3(0.25, 0.25, 0.2)), '#D97706'));

  // 8. Distance Lines & Sphere Invariant
  if (state.layers.radius && radius > 0.02) {
    const rGeom1 = new THREE.BufferGeometry().setFromPoints([C0, M0]);
    const rLine1 = new THREE.Line(rGeom1, materials.radiusLine2);
    rLine1.computeLineDistances();
    dynamicGroup.add(rLine1);

    const rGeom2 = new THREE.BufferGeometry().setFromPoints([C0, P]);
    const rLine2 = new THREE.Line(rGeom2, materials.radiusLine);
    rLine2.computeLineDistances();
    dynamicGroup.add(rLine2);

    // Sphere radius from origin O: |OP| = |OM0|
    const p0M1Geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), M0]);
    const p0M1Line = new THREE.Line(p0M1Geom, materials.sphereRadiusLine);
    p0M1Line.computeLineDistances();
    dynamicGroup.add(p0M1Line);

    const p0MGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), P]);
    const p0MLine = new THREE.Line(p0MGeom, materials.sphereRadiusLine);
    p0MLine.computeLineDistances();
    dynamicGroup.add(p0MLine);

    if (thetaRad > 0.05) {
      const arcPoints = [];
      const arcR = radius * 0.45;
      for (let i = 0; i <= 30; i++) {
        const a = thetaRad * (i / 30);
        arcPoints.push(C0.clone()
          .add(v1.clone().multiplyScalar(arcR * Math.cos(a)))
          .add(v2.clone().multiplyScalar(arcR * Math.sin(a)))
        );
      }
      const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPoints);
      const arcLine = new THREE.Line(arcGeom, new THREE.LineBasicMaterial({ color: 0xD97706, linewidth: 2 }));
      dynamicGroup.add(arcLine);

      const midA = thetaRad * 0.5;
      const arcLabelPos = C0.clone()
        .add(v1.clone().multiplyScalar(arcR * 1.35 * Math.cos(midA)))
        .add(v2.clone().multiplyScalar(arcR * 1.35 * Math.sin(midA)));
      dynamicGroup.add(createAxisLabel(`θ = ${Math.round(state.theta)}°`, arcLabelPos, '#D97706', true));
    }
  }

  // 9. Swept Surface Mesh
  if (state.layers.surface && thetaRad > 0.05) {
    const uSegments = 36;
    const vSegments = Math.max(8, Math.round(thetaRad * 16));
    const vertices = [];
    const indices = [];

    for (let i = 0; i <= uSegments; i++) {
      const u = uMin + (uMax - uMin) * (i / uSegments);
      const ptU = getGeneratrixPoint(u);
      const h_u = ptU.dot(axisDir);
      const c_u = axisDir.clone().multiplyScalar(h_u);
      const e1_u = new THREE.Vector3().subVectors(ptU, c_u);
      const r_u = e1_u.length();

      let v1_u = new THREE.Vector3();
      let v2_u = new THREE.Vector3();
      if (r_u > 0.001) {
        v1_u.copy(e1_u).normalize();
        v2_u.crossVectors(axisDir, v1_u).normalize();
      } else {
        v1_u.set(1, 0, 0);
        v2_u.crossVectors(axisDir, v1_u).normalize();
      }

      for (let j = 0; j <= vSegments; j++) {
        const v = (j / vSegments) * thetaRad;
        const ptSurf = c_u.clone()
          .add(v1_u.clone().multiplyScalar(r_u * Math.cos(v)))
          .add(v2_u.clone().multiplyScalar(r_u * Math.sin(v)));
        vertices.push(ptSurf.x, ptSurf.y, ptSurf.z);
      }
    }

    for (let i = 0; i < uSegments; i++) {
      for (let j = 0; j < vSegments; j++) {
        const aIdx = i * (vSegments + 1) + j;
        const bIdx = (i + 1) * (vSegments + 1) + j;
        const cIdx = (i + 1) * (vSegments + 1) + (j + 1);
        const dIdx = i * (vSegments + 1) + (j + 1);
        indices.push(aIdx, bIdx, dIdx, bIdx, cIdx, dIdx);
      }
    }

    const surfGeom = new THREE.BufferGeometry();
    surfGeom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    surfGeom.setIndex(indices);
    surfGeom.computeVertexNormals();

    dynamicGroup.add(new THREE.Mesh(surfGeom, materials.surface));
    dynamicGroup.add(new THREE.Mesh(surfGeom, materials.surfaceWire));
  }
}

/**
 * CASE 3: §9 锥面及其方程 (顶点·母线·准线)
 */
function buildCase3Geometry() {
  // In Case 3, state.t acts as directrix parameter phi in [0, 2*PI]
  const phiNorm = ((state.t + 2.0) / 4.0) * Math.PI * 2;
  const sweepRad = (state.theta * Math.PI) / 180;

  const isPreset0 = state.presetIndex === 0;

  // 1. Vertex M0
  const vertexPos = new THREE.Vector3(0, 0, 0);
  const vertexMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 24), materials.p0Point);
  vertexMesh.position.copy(vertexPos);
  dynamicGroup.add(vertexMesh);
  dynamicGroup.add(createAxisLabel('顶点 M₀(0, 0, 0)', vertexPos.clone().add(new THREE.Vector3(-0.35, -0.35, -0.25)), '#DC2626'));

  // 2. Directrix C (at height z = h0 = 2.0)
  const h0 = 2.0;
  const aRadius = 2.0;
  const bRadius = isPreset0 ? 2.0 : 1.4; // Circular directrix or Elliptic directrix

  function getDirectrixPoint(ang) {
    return new THREE.Vector3(aRadius * Math.cos(ang), bRadius * Math.sin(ang), h0);
  }

  // Directrix Ring
  if (state.layers.circle) {
    const dirPoints = [];
    for (let i = 0; i <= 64; i++) {
      const ang = (i / 64) * Math.PI * 2;
      dirPoints.push(getDirectrixPoint(ang));
    }
    const dirPath = new THREE.CatmullRomCurve3(dirPoints, true);
    const dirGeom = new THREE.TubeGeometry(dirPath, 64, 0.035, 12, true);
    const dirMesh = new THREE.Mesh(dirGeom, materials.directrix);
    dynamicGroup.add(dirMesh);

    dynamicGroup.add(createAxisLabel(isPreset0 ? '准线 C: x²+y²=4, z=2' : '准线 C: x²/2.4²+y²/1.5²=1, z=2', new THREE.Vector3(0, bRadius + 0.35, h0), '#059669'));
  }

  // Plane of directrix (z = h0)
  if (state.layers.plane) {
    const planeGeom = new THREE.CircleGeometry(3.5, 36);
    const planeMesh = new THREE.Mesh(planeGeom, materials.plane);
    planeMesh.position.set(0, 0, h0);
    dynamicGroup.add(planeMesh);
    dynamicGroup.add(createAxisLabel('准线所在平面: z = 2', new THREE.Vector3(-2.4, 2.4, h0 + 0.08), '#0D9488'));
  }

  // 3. Current Point M1 on Directrix
  const M1 = getDirectrixPoint(phiNorm);
  const m1Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 24), materials.m1Point);
  m1Mesh.position.copy(M1);
  dynamicGroup.add(m1Mesh);
  dynamicGroup.add(createAxisLabel('准线上动点 M₁(X, Y, Z)', M1.clone().add(new THREE.Vector3(0.25, 0.25, 0.2)), '#1D4ED8'));

  // 4. Generatrix Line L (Ray passing through M0 and M1)
  if (state.layers.radius) {
    // Extend through vertex both sides: u in [-1.2, 1.4]
    const dirVec = M1.clone().sub(vertexPos); // from M0 to M1
    const pGenStart = vertexPos.clone().add(dirVec.clone().multiplyScalar(-1.1));
    const pGenEnd = vertexPos.clone().add(dirVec.clone().multiplyScalar(1.3));

    const genGeom = new THREE.BufferGeometry().setFromPoints([pGenStart, pGenEnd]);
    const genLine = new THREE.Line(genGeom, new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 3 }));
    dynamicGroup.add(genLine);
    dynamicGroup.add(createAxisLabel('动母线 L', pGenEnd.clone().add(new THREE.Vector3(0.2, 0.2, 0.2)), '#2563EB'));

    // Semi-vertical angle triangle (M0 -> Foot on z-axis -> M1)
    const zFoot = new THREE.Vector3(0, 0, h0);
    const triangleGeom = new THREE.BufferGeometry().setFromPoints([vertexPos, zFoot, M1]);
    const triangleLine = new THREE.Line(triangleGeom, materials.radiusLine);
    triangleLine.computeLineDistances();
    dynamicGroup.add(triangleLine);

    // Right angle mark / Radius & Height text
    dynamicGroup.add(createAxisLabel(`竖直高程 h = ${h0.toFixed(1)}`, new THREE.Vector3(0.1, 0.2, h0 * 0.5), '#78716C', true));
    dynamicGroup.add(createAxisLabel(`截面半径 r = ${M1.clone().setZ(0).length().toFixed(2)}`, new THREE.Vector3(M1.x * 0.5, M1.y * 0.5, h0 + 0.1), '#D97706', true));
  }

  // 5. Swept Cone Surface Mesh (both sheets or single sheet)
  if (state.layers.surface && sweepRad > 0.05) {
    const vSteps = 48; // along angle
    const uSteps = 24; // along generatrix
    const vertices = [];
    const indices = [];

    const uMin = -1.1;
    const uMax = 1.35;

    for (let i = 0; i <= uSteps; i++) {
      const u = uMin + (uMax - uMin) * (i / uSteps);
      for (let j = 0; j <= vSteps; j++) {
        const ang = (j / vSteps) * sweepRad;
        const ptDir = getDirectrixPoint(ang);
        // Point on ray: vertex + u * (ptDir - vertex)
        const pt = vertexPos.clone().add(ptDir.clone().sub(vertexPos).multiplyScalar(u));
        vertices.push(pt.x, pt.y, pt.z);
      }
    }

    for (let i = 0; i < uSteps; i++) {
      for (let j = 0; j < vSteps; j++) {
        const aIdx = i * (vSteps + 1) + j;
        const bIdx = (i + 1) * (vSteps + 1) + j;
        const cIdx = (i + 1) * (vSteps + 1) + (j + 1);
        const dIdx = i * (vSteps + 1) + (j + 1);
        indices.push(aIdx, bIdx, dIdx, bIdx, cIdx, dIdx);
      }
    }

    const surfGeom = new THREE.BufferGeometry();
    surfGeom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    surfGeom.setIndex(indices);
    surfGeom.computeVertexNormals();

    dynamicGroup.add(new THREE.Mesh(surfGeom, materials.surface));
    dynamicGroup.add(new THREE.Mesh(surfGeom, materials.surfaceWire));
  }
}

// ==========================================
// --- HUD & Dynamic Math Text Generators ---
// ==========================================

function updateHUD() {
  const badge = document.getElementById('case-badge');
  const subbadge = document.getElementById('hud-subbadge');
  const hudAxisLabel = document.getElementById('hud-axis-label');
  const hudAxis = document.getElementById('hud-axis');
  const hudCurveLabel = document.getElementById('hud-curve-label');
  const hudCurve = document.getElementById('hud-curve');
  const hudSurfaceLabel = document.getElementById('hud-surface-label');
  const hudSurface = document.getElementById('hud-surface');

  const labelSliderT = document.getElementById('label-slider-t');
  const labelSliderTheta = document.getElementById('label-slider-theta');
  const layerTextPlane = document.getElementById('layer-text-plane');
  const layerTextCircle = document.getElementById('layer-text-circle');
  const layerTextRadius = document.getElementById('layer-text-radius');
  const layerTextSurface = document.getElementById('layer-text-surface');

  if (state.currentCase === 1) {
    badge.innerText = state.presetIndex === 0 ? '§8.1 单叶双曲面生成' : '§8.1 空间抛物线旋转';
    badge.className = 'subtle-badge bg-blue-50 text-blue-700 border-blue-200';
    subbadge.innerText = '模型一：绕坐标轴';
    hudAxisLabel.innerText = '旋转轴 L:';
    hudAxis.innerText = 'z 轴 : x=0, y=0 (s=(0,0,1))';
    hudCurveLabel.innerText = '母线 C:';
    hudCurve.innerText = state.presetIndex === 0 ? 'x₁=1.8, z₁=1.2y₁ (空间异面线)' : 'x₁=1+0.25z₁², y₁=0.8z₁';
    hudSurfaceLabel.innerText = '曲面方程:';
    hudSurface.innerText = state.presetIndex === 0 ? '(x²+y²)/3.24 - z²/4.67 = 1' : 'x²+y²=(1+0.25z²)²+0.64z²';

    labelSliderT.innerHTML = '<span class="w-2 h-2 rounded-full bg-blue-600"></span>母线动点参数 $t$ (位置 $M_0$)';
    labelSliderTheta.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span>旋转扫掠角 $\\theta$ (动点 $P$)';
    layerTextPlane.innerText = '法截面 π';
    layerTextCircle.innerText = '纬圆轨迹';
    layerTextRadius.innerText = '到轴矢径';
    layerTextSurface.innerText = '生成曲面';
  } else if (state.currentCase === 2) {
    badge.innerText = state.presetIndex === 0 ? '§8.2 考研数学一真题模型' : '§8.2 直角圆锥面';
    badge.className = 'subtle-badge bg-rose-50 text-rose-700 border-rose-200';
    subbadge.innerText = '模型二：绕斜轴全能';
    hudAxisLabel.innerText = '旋转轴 L₂:';
    hudAxis.innerText = 'x = y = z (向径 s=(1,1,1))';
    hudCurveLabel.innerText = '母线 L₁:';
    hudCurve.innerText = state.presetIndex === 0 ? 'x/1 = y/2 = z/3 (过原点)' : 'z 轴 : x=0, y=0, z=t';
    hudSurfaceLabel.innerText = '曲面方程:';
    hudSurface.innerText = state.presetIndex === 0 ? '18(x²+y²+z²) - 7(x+y+z)² = 0' : 'xy + yz + zx = 0 (二次圆锥面)';

    labelSliderT.innerHTML = '<span class="w-2 h-2 rounded-full bg-blue-600"></span>母线动点参数 $t$ (位置 $M_0$)';
    labelSliderTheta.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span>旋转扫掠角 $\\theta$ (动点 $P$)';
    layerTextPlane.innerText = '法截面 π';
    layerTextCircle.innerText = '纬圆轨迹';
    layerTextRadius.innerText = '同心球半径';
    layerTextSurface.innerText = '生成曲面';
  } else {
    // Case 3: Cone
    badge.innerText = state.presetIndex === 0 ? '§9 标准圆锥面与正负辨析' : '§9 一般椭圆锥面消参';
    badge.className = 'subtle-badge bg-emerald-50 text-emerald-800 border-emerald-200';
    subbadge.innerText = '考点§9：顶点·母线·准线';
    hudAxisLabel.innerText = '顶点 M₀:';
    hudAxis.innerText = '原点 O(0, 0, 0)';
    hudCurveLabel.innerText = '定准线 C:';
    hudCurve.innerText = state.presetIndex === 0 ? 'x² + y² = 4, z = 2' : 'x²/2.4² + y²/1.5² = 1, z = 2';
    hudSurfaceLabel.innerText = '锥面方程:';
    hudSurface.innerText = state.presetIndex === 0 ? 'z² = x² + y² (齐次二次锥面)' : 'x²/2.4² + y²/1.5² = z²/4';

    labelSliderT.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-600"></span>准线动点参角 $\\phi$ (位置 $M_1$)';
    labelSliderTheta.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span>母线织面扫掠角 $\\theta$';
    layerTextPlane.innerText = '准线平面';
    layerTextCircle.innerText = '准线导引环';
    layerTextRadius.innerText = '动母线与直角三角形';
    layerTextSurface.innerText = '生成锥面';
  }

  // Update Preset Button labels
  const btnPreset1 = document.getElementById('btn-preset-1');
  const btnPreset2 = document.getElementById('btn-preset-2');
  if (state.currentCase === 1) {
    btnPreset1.innerText = '单叶双曲面 (异面线)';
    btnPreset2.innerText = '空间抛物线';
  } else if (state.currentCase === 2) {
    btnPreset1.innerText = '考研数一真题 (L₁绕L₂)';
    btnPreset2.innerText = 'z轴绕对角线 (xy+yz+zx=0)';
  } else {
    btnPreset1.innerText = '标准圆锥面 (正负开方)';
    btnPreset2.innerText = '椭圆锥面 (消参模型)';
  }

  updateHUDValues();
}

function updateHUDValues() {
  const valT = document.getElementById('val-t');
  const valTheta = document.getElementById('val-theta');
  if (valT) valT.innerText = Number(state.t).toFixed(2);
  if (valTheta) valTheta.innerText = `${Math.round(state.theta)}°`;
}

/**
 * Render explanation panel text strictly following the user's notes
 */
function updateExplanationText() {
  const container = document.getElementById('dynamic-derivation-content');
  if (!container) return;

  const t = Number(state.t);
  let html = '';

  if (state.currentCase === 1) {
    // ----------------------------------------------------
    // CASE 1: §8.1 模型一：母线不在坐标面上，绕坐标轴旋转
    // ----------------------------------------------------
    html = `
      <div class="space-y-3">
        <!-- Obsidian Callout Tip -->
        <div class="callout-box callout-tip">
          <strong>[!tip] 核心速记口诀</strong><br>
          <strong>同纬截面垂直轴，定点等距球面守；联立母线消基点，四式合成曲面出</strong>
        </div>

        <div class="space-y-1.5">
          <h3 class="font-bold text-stone-900 text-xs flex items-center gap-1.5">
            <span class="w-1.5 h-3 bg-blue-600 rounded-full"></span>
            §8.1 模型一：母线不在坐标面上，绕坐标轴旋转（空间直线/曲线绕坐标轴）
          </h3>
          <p class="text-stone-600 text-[11px]">
            当母线 $C$ 是一般空间直线或曲线（不在任一坐标平面内），但<strong>旋转轴仍为坐标轴</strong>（如 $z$ 轴）时：
          </p>
        </div>

        <!-- Invariants -->
        <div class="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
          <span class="font-semibold text-stone-800 text-[11px] block">🔹 核心几何不变量：</span>
          <p class="text-stone-600 text-[11px]">
            在母线 $C$ 上任取动点 $M_0(x_0, y_0, z_0)$，曲面上任意动点 $P(x, y, z)$ 由 $M_0$ 绕 $z$ 轴旋转而来：
          </p>
          <ol class="list-decimal list-inside text-[11px] space-y-1 text-stone-700 pl-1">
            <li><strong>$z$ 坐标不变（同纬度高程不变）</strong>：$z_0 = z$</li>
            <li><strong>到 $z$ 轴垂直距离不变（纬圆半径相同）</strong>：$x_0^2 + y_0^2 = x^2 + y^2$</li>
          </ol>
        </div>

        <!-- Example from note -->
        <div class="p-3 rounded-xl bg-white border border-[#E5E4DC] space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-stone-900 text-[11px]">典例精析（空间直线绕坐标轴生成单叶双曲面）</span>
            <span class="text-[10px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">当前 3D 联动模型</span>
          </div>

          <p class="text-stone-600 text-[11px]">
            求空间异面直线 $L: \\begin{cases} x_0 = 1.8 \\\\ z_0 = 1.2 y_0 \\end{cases}$ 绕 $z$ 轴旋转所得曲面方程。
          </p>

          <div class="space-y-1.5 pt-1">
            <div class="text-[11px] text-stone-700 font-semibold">拆解反推：</div>
            <ol class="list-decimal list-inside space-y-1 text-[11px] text-stone-600 pl-1">
              <li>
                由直线方程将 $x_0, y_0$ 用 $z_0$ 表示：
                $$x_0 = 1.8, \\quad y_0 = \\frac{z_0}{1.2}$$
                当前滑块动点坐标：$M_0 = (1.80, \\, ${t.toFixed(2)}, \\, ${(1.2 * t).toFixed(2)})$。
              </li>
              <li>
                代入等距方程 $x_0^2 + y_0^2 = x^2 + y^2$：
                $$1.8^2 + \\left(\\frac{z_0}{1.2}\\right)^2 = x^2 + y^2$$
              </li>
              <li>
                代入 $z_0 = z$，直接写出曲面方程：
                $$\\frac{x^2 + y^2}{1.8^2} - \\frac{z^2}{(1.2 \\times 1.8)^2} = 1 \\implies \\frac{x^2 + y^2}{3.24} - \\frac{z^2}{4.67} = 1$$
              </li>
            </ol>
          </div>

          <div class="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200 text-blue-950 text-[11px]">
            <strong>🎯 结论：</strong> 所得曲面为标准<strong>单叶双曲面 (Hyperboloid of One Sheet)</strong>。平直的母线通过空间转动，在三维中扫出双重直纹马鞍曲面！
          </div>
        </div>

        <!-- Universal Model from Note -->
        <div class="callout-box callout-note">
          <strong>通式推广（笔记 §8.1 通解式）</strong>：<br>
          若直线为 $L: \\frac{x-a}{m} = \\frac{y-b}{n} = \\frac{z-c}{p}$，直接将 $x_0 = a + m\\left(\\frac{z-c}{p}\\right)$ 与 $y_0 = b + n\\left(\\frac{z-c}{p}\\right)$ 代入 $x^2 + y^2 = x_0^2 + y_0^2$，无需死记任何多余步骤！
        </div>
      </div>
    `;
  } else if (state.currentCase === 2) {
    // ----------------------------------------------------
    // CASE 2: §8.2 模型二：旋转轴为空间一般直线 (考研数一真题模型)
    // ----------------------------------------------------
    html = `
      <div class="space-y-3">
        <!-- Obsidian Callout Tip -->
        <div class="callout-box callout-tip">
          <strong>[!tip] 核心速记口诀</strong><br>
          <strong>同纬截面垂直轴，定点等距球面守；联立母线消基点，四式合成曲面出</strong>
        </div>

        <div class="space-y-1.5">
          <h3 class="font-bold text-stone-900 text-xs flex items-center gap-1.5">
            <span class="w-1.5 h-3 bg-rose-600 rounded-full"></span>
            §8.2 模型二：旋转轴为空间一般直线（非坐标轴旋转全能模型）
          </h3>
          <p class="text-stone-600 text-[11px]">
            当<strong>旋转轴不是坐标轴</strong>，而是空间中一条任意直线 $L$ 时：
          </p>
        </div>

        <!-- Note Mechanism -->
        <div class="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
          <div class="font-semibold text-stone-800 text-[11px]">图解与全能推导机制（笔记原文）：</div>
          <p class="text-stone-600 text-[11px]">
            设旋转轴为一般直线 $L: \\frac{x - x_A}{l} = \\frac{y - y_A}{m} = \\frac{z - z_A}{n}$（过定点 $A(x_A, y_A, z_A)$，方向向量 $\\boldsymbol{s} = (l, m, n)$），母线为空间曲线 $C$。
            曲面上任取动点 $P(x, y, z)$，由母线上的基准点 $M_0(x_0, y_0, z_0)$ 绕 $L$ 旋转而来，必满足两大不变量：
          </p>
          <div class="space-y-1 pt-1">
            <div class="p-2 rounded-lg bg-white border border-teal-200">
              <strong class="text-teal-900 text-[11px]">1. 垂直平面约束（同一截面圆内）：</strong>
              <div class="formula-box text-[11px] py-1 my-1">
                $$\\vec{M_0 P} \\perp \\boldsymbol{s} \\iff \\vec{M_0 P} \\cdot \\boldsymbol{s} = 0 \\iff l(x - x_0) + m(y - y_0) + n(z - z_0) = 0$$
              </div>
            </div>
            <div class="p-2 rounded-lg bg-white border border-purple-200">
              <strong class="text-purple-900 text-[11px]">2. 球面等距约束（到轴上定点 $A$ 的距离平方相等）：</strong>
              <div class="formula-box text-[11px] py-1 my-1">
                $$|\\vec{AP}|^2 = |\\vec{AM_0}|^2 \\iff (x - x_A)^2 + (y - y_A)^2 + (z - z_A)^2 = (x_0 - x_A)^2 + (y_0 - y_A)^2 + (z_0 - z_A)^2$$
              </div>
            </div>
          </div>
        </div>

        <!-- Math 1 Exam Model -->
        <div class="p-3 rounded-xl bg-white border border-[#E5E4DC] space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-stone-900 text-[11px]">题型精炼（考研数学一真题模型）</span>
            <span class="text-[10px] font-mono text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">真题原题 3D 映射</span>
          </div>

          <div class="p-2 rounded-lg bg-stone-50 border border-stone-200 text-stone-700 text-[11px]">
            <strong>题目：</strong>求直线 $L_1: \\frac{x}{1} = \\frac{y}{2} = \\frac{z}{3}$ 绕直线 $L_2: x = y = z$ 旋转所得旋转曲面的方程。
          </div>

          <div class="space-y-1.5 pt-1 text-[11px]">
            <div class="font-semibold text-stone-800">拆解反推全流程：</div>
            <ol class="list-decimal list-inside space-y-1.5 text-stone-600 pl-1">
              <li>
                <strong>提取旋转轴与母线要素</strong>：<br>
                - 旋转轴 $L_2$：过定点 $O(0, 0, 0)$，方向向量 $\\boldsymbol{s} = (1, 1, 1)$；<br>
                - 母线 $L_1$：设母线上动点为 $M_0(t, 2t, 3t)$（当前滑块 $t = ${t.toFixed(2)}）。
              </li>
              <li>
                <strong>建立垂直平面方程（求参数 $t$）</strong>：<br>
                曲面动点 $P(x, y, z)$ 与 $M_0(t, 2t, 3t)$ 在垂直于 $\\boldsymbol{s}$ 的平面内：
                $$1 \\cdot (x - t) + 1 \\cdot (y - 2t) + 1 \\cdot (z - 3t) = 0 \\implies 6t = x + y + z \\implies t = \\frac{x + y + z}{6}$$
              </li>
              <li>
                <strong>建立到原点 $O$ 距离相等关系（消去参数 $t$）</strong>：<br>
                $$|\\vec{OP}|^2 = |\\vec{OM_0}|^2 \\implies x^2 + y^2 + z^2 = t^2 + (2t)^2 + (3t)^2 = 14t^2$$
                将 $t = \\frac{x + y + z}{6}$ 代入：
                $$x^2 + y^2 + z^2 = 14 \\cdot \\left(\\frac{x + y + z}{6}\\right)^2 = \\frac{14}{36}(x + y + z)^2 = \\frac{7}{18}(x + y + z)^2$$
              </li>
            </ol>
          </div>

          <div class="p-2.5 rounded-lg bg-rose-50/70 border border-rose-200 text-rose-950 text-[11px]">
            <strong>🎯 结论：</strong> 整理两边去分母即得曲面方程：
            <div class="formula-box text-center py-1 my-1 bg-white border-rose-200 font-bold">
              $$18(x^2 + y^2 + z^2) - 7(x + y + z)^2 = 0$$
            </div>
            由于母线过原点，此方程为关于 $x, y, z$ 的<strong>二次齐次方程</strong>，几何本质为以原点为顶点的<strong>二次圆锥面</strong>！
          </div>
        </div>

        <div class="callout-box callout-important">
          <strong>[!important] 避坑核心警示</strong><br>
          许多同学在此类题目中尝试计算点 $P(x,y,z)$ 到直线 $L_2$ 的垂直距离 $d = \\frac{|\\vec{OP} \\times \\boldsymbol{s}|}{\\|\\boldsymbol{s}\\|}$，导致产生极为复杂的叉积、行列式与根号！<br>
          <strong>秒杀心法：</strong>只要在轴上任取一已知定点 $A$（如原点 $O$），利用直角三角形斜边相等关系直接写出球心在 $A$ 的**点点距离平方等式**，消元化简一步到位！
        </div>
      </div>
    `;
  } else {
    // ----------------------------------------------------
    // CASE 3: §9 锥面及其方程 (顶点·母线·准线)
    // ----------------------------------------------------
    html = `
      <div class="space-y-3">
        <!-- Obsidian Callout Tip -->
        <div class="callout-box callout-tip">
          <strong>[!tip] 核心速记口诀</strong><br>
          <strong>动线过定点，相交沿准行；顶点居原点，齐次方程现</strong>
        </div>

        <div class="space-y-1.5">
          <h3 class="font-bold text-stone-900 text-xs flex items-center gap-1.5">
            <span class="w-1.5 h-3 bg-emerald-600 rounded-full"></span>
            §9 锥面及其方程（顶点 · 母线 · 准线）
          </h3>
          <p class="text-stone-600 text-[11px]">
            锥面是空间解析几何中与柱面、旋转曲面并列的三大几何生成曲面之一：
          </p>
        </div>

        <!-- 9.1 Definition -->
        <div class="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
          <div class="font-semibold text-stone-800 text-[11px]">1. 锥面形成的几何原理（定义三要素）：</div>
          <p class="text-stone-600 text-[11px]">
            过曲线 $C$ 外一定点 $M_0$，且与曲线 $C$ 相交的动直线 $L$ 沿曲线 $C$ 移动所形成的曲面称为<strong>锥面</strong>。
          </p>
          <ul class="list-disc list-inside space-y-1 text-[11px] text-stone-700 pl-1">
            <li><strong>定点 $M_0$</strong>：称为锥面的<strong>顶点</strong>（3D 红色定点）。</li>
            <li><strong>定曲线 $C$</strong>：称为锥面的<strong>准线</strong>（3D 绿色导引环）。</li>
            <li><strong>动直线 $L$</strong>：称为锥面的<strong>母线</strong>（3D 穿过顶点与准线的蓝色光束）。</li>
          </ul>
        </div>

        <!-- 9.2 Cone Derivation -->
        <div class="p-3 rounded-xl bg-white border border-[#E5E4DC] space-y-2">
          <div class="font-semibold text-stone-900 text-[11px] flex items-center justify-between">
            <span>2. 圆锥面方程推导（直角三角形几何三角比）</span>
            <span class="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">标准对称型</span>
          </div>

          <p class="text-stone-600 text-[11px]">
            设顶点在坐标原点 $M_0(0, 0, 0)$，对称中心轴为 $z$ 轴，母线与 $z$ 轴夹角（半顶角）为 $\\alpha$：<br>
            在锥面上任取一点 $M(x, y, z)$，其在水平截面圆上满足：
          </p>
          <ul class="list-disc list-inside space-y-0.5 text-[11px] text-stone-600 pl-1">
            <li>截面圆半径：$r = \\sqrt{x^2 + y^2}$</li>
            <li>竖直高程：$h = |z|$</li>
          </ul>
          <p class="text-stone-600 text-[11px]">
            由直角三角形三角函数关系：
          </p>
          <div class="formula-box text-[11px] py-1 my-1">
            $$\\tan \\alpha = \\frac{r}{h} = \\frac{\\sqrt{x^2 + y^2}}{|z|} \\implies z^2 = \\cot^2\\alpha \\cdot (x^2 + y^2) = k^2(x^2 + y^2)$$
          </div>
        </div>

        <!-- 9.3 Form & Sign Distinctions -->
        <div class="p-3 rounded-xl bg-white border border-[#E5E4DC] space-y-2">
          <div class="font-semibold text-stone-900 text-[11px]">
            3. 考研高频圆锥面形态与开方正负号辨析速查表
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-[10px] text-left border-collapse">
              <thead>
                <tr class="border-b border-stone-200 bg-stone-50 text-stone-700 font-semibold">
                  <th class="p-1.5">锥面形态</th>
                  <th class="p-1.5">代数方程</th>
                  <th class="p-1.5">变量范围约束</th>
                  <th class="p-1.5">几何特征</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-stone-100 text-stone-600">
                <tr>
                  <td class="p-1.5 font-semibold text-stone-800">全双圆锥面</td>
                  <td class="p-1.5 font-mono">$z^2 = x^2 + y^2$</td>
                  <td class="p-1.5">$z \\in (-\\infty, +\\infty)$</td>
                  <td class="p-1.5">包含顶点上下两侧的双叶圆锥面</td>
                </tr>
                <tr class="bg-amber-50/50">
                  <td class="p-1.5 font-semibold text-amber-900">上半圆锥面</td>
                  <td class="p-1.5 font-mono text-amber-800">$z = \\sqrt{x^2 + y^2}$</td>
                  <td class="p-1.5 font-bold text-amber-800">$z \\ge 0$</td>
                  <td class="p-1.5 text-amber-900">重积分/曲面积分极高频（开方取正根）</td>
                </tr>
                <tr>
                  <td class="p-1.5 font-semibold text-stone-800">下半圆锥面</td>
                  <td class="p-1.5 font-mono">$z = -\\sqrt{x^2 + y^2}$</td>
                  <td class="p-1.5 font-bold text-stone-800">$z \\le 0$</td>
                  <td class="p-1.5">仅包含 $xOy$ 面下方单侧锥面（开方取负根）</td>
                </tr>
                <tr>
                  <td class="p-1.5 font-semibold text-stone-800">一般椭圆锥面</td>
                  <td class="p-1.5 font-mono">$\\frac{x^2}{a^2} + \\frac{y^2}{b^2} = \\frac{z^2}{c^2}$</td>
                  <td class="p-1.5">$z \\in (-\\infty, +\\infty)$</td>
                  <td class="p-1.5">水平截面为椭圆的双叶锥面</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 9.4 Universal Elimination & Homogeneous Theorem -->
        <div class="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
          <div class="font-semibold text-stone-800 text-[11px]">4. 一般锥面方程的建立与消参模型：</div>
          <p class="text-stone-600 text-[11px]">
            已知锥面顶点为 $M_0(x_0, y_0, z_0)$，准线方程为空间曲线 $C: \\begin{cases} F_1(X, Y, Z) = 0 \\\\ F_2(X, Y, Z) = 0 \\end{cases}$：
          </p>
          <ol class="list-decimal list-inside space-y-1 text-[11px] text-stone-700 pl-1">
            <li><strong>设曲面动点</strong>：设锥面上任一动点为 $M(x, y, z)$；</li>
            <li><strong>写出母线方程</strong>：连接顶点 $M_0$ 与动点 $M$ 的母线方程为：
              <div class="formula-box text-[11px] py-1 my-1">
                $$\\frac{X - x_0}{x - x_0} = \\frac{Y - y_0}{y - y_0} = \\frac{Z - z_0}{z - z_0} = t \\implies \\begin{cases} X = x_0 + t(x - x_0) \\\\ Y = y_0 + t(y - y_0) \\\\ Z = z_0 + t(z - z_0) \\end{cases}$$
              </div>
            </li>
            <li><strong>代入准线消参</strong>：将 $(X, Y, Z)$ 代入准线方程组，消去参数 $t$，即得一般锥面方程。</li>
          </ol>

          <div class="callout-box callout-important mt-2">
            <strong>[!important] 锥面齐次性核心定理（考研考点速查）</strong><br>
            若锥面的顶点位于坐标原点 $(0, 0, 0)$，则锥面的方程 $F(x, y, z) = 0$ 必为关于 $x, y, z$ 的<strong>齐次多项式方程</strong>（即恒满足 $F(\\lambda x, \\lambda y, \\lambda z) = \\lambda^k F(x, y, z) = 0$）。
          </div>
        </div>

        <!-- 9.5 Comparison Table -->
        <div class="p-3 rounded-xl bg-white border border-[#E5E4DC] space-y-1.5">
          <div class="font-semibold text-stone-900 text-[11px]">5. 空间三大几何生成曲面对照总结速查表</div>
          <div class="overflow-x-auto">
            <table class="w-full text-[10px] text-left border-collapse">
              <thead>
                <tr class="border-b border-stone-200 bg-stone-50 text-stone-700 font-semibold">
                  <th class="p-1.5">曲面类型</th>
                  <th class="p-1.5">生成母线特征</th>
                  <th class="p-1.5">引导几何约束</th>
                  <th class="p-1.5">核心代数特征</th>
                  <th class="p-1.5">典型方程代表</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-stone-100 text-stone-600">
                <tr>
                  <td class="p-1.5 font-bold text-stone-800">柱面</td>
                  <td class="p-1.5">动直线 $L$</td>
                  <td class="p-1.5"><strong>平行于固定方向 $\\boldsymbol{v}$</strong>，沿定曲线移动</td>
                  <td class="p-1.5">方程通常<strong>缺失某一坐标变量</strong></td>
                  <td class="p-1.5 font-mono">$x^2 + y^2 = R^2$</td>
                </tr>
                <tr class="bg-emerald-50/40">
                  <td class="p-1.5 font-bold text-emerald-900">锥面</td>
                  <td class="p-1.5 text-emerald-900">动直线 $L$</td>
                  <td class="p-1.5 text-emerald-900"><strong>恒过固定点 $M_0$（顶点）</strong>，沿定曲线移动</td>
                  <td class="p-1.5 text-emerald-900">顶点在原点时方程必为<strong>齐次式</strong></td>
                  <td class="p-1.5 font-mono text-emerald-800">$z^2 = x^2 + y^2$</td>
                </tr>
                <tr>
                  <td class="p-1.5 font-bold text-stone-800">旋转曲面</td>
                  <td class="p-1.5">平面/空间曲线 $C$</td>
                  <td class="p-1.5"><strong>绕固定直线 $L$（旋转轴）旋转一周</strong></td>
                  <td class="p-1.5"><strong>绕谁转谁不变</strong>，另两变量平方和代换</td>
                  <td class="p-1.5 font-mono">$z = \\sqrt{x^2 + y^2}$</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Render KaTeX formulas
  if (window.renderMathInElement) {
    window.renderMathInElement(container, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
  }
}

// ==========================================
// --- User Interface & Interaction Setup ---
// ==========================================

function initUI() {
  const tabCase1 = document.getElementById('tab-case1');
  const tabCase2 = document.getElementById('tab-case2');
  const tabCase3 = document.getElementById('tab-case3');

  function setActiveTab(activeTab, caseNum) {
    [tabCase1, tabCase2, tabCase3].forEach(tab => {
      if (tab === activeTab) {
        tab.classList.add('active');
        tab.classList.remove('text-stone-600');
      } else {
        tab.classList.remove('active');
        tab.classList.add('text-stone-600');
      }
    });
    state.currentCase = caseNum;
    state.presetIndex = 0;
    updateModel();
  }

  tabCase1.addEventListener('click', () => {
    if (state.currentCase === 1) return;
    setActiveTab(tabCase1, 1);
  });

  tabCase2.addEventListener('click', () => {
    if (state.currentCase === 2) return;
    setActiveTab(tabCase2, 2);
  });

  tabCase3.addEventListener('click', () => {
    if (state.currentCase === 3) return;
    setActiveTab(tabCase3, 3);
  });

  // Sliders
  const sliderT = document.getElementById('slider-t');
  const sliderTheta = document.getElementById('slider-theta');

  sliderT.addEventListener('input', (e) => {
    state.t = parseFloat(e.target.value);
    updateModelGeometryOnly();
    updateExplanationText();
  });

  sliderTheta.addEventListener('input', (e) => {
    state.theta = parseFloat(e.target.value);
    updateModelGeometryOnly();
  });

  // Play / Pause Sweep Button
  const btnPlay = document.getElementById('btn-play-sweep');
  const playText = document.getElementById('play-text');
  btnPlay.addEventListener('click', () => {
    state.isPlaying = !state.isPlaying;
    if (state.isPlaying) {
      playText.innerText = '暂停扫掠';
      btnPlay.classList.add('bg-amber-600');
      btnPlay.classList.remove('bg-stone-900');
    } else {
      playText.innerText = '自动扫掠旋转';
      btnPlay.classList.remove('bg-amber-600');
      btnPlay.classList.add('bg-stone-900');
    }
  });

  // Presets
  const btnPreset1 = document.getElementById('btn-preset-1');
  const btnPreset2 = document.getElementById('btn-preset-2');

  btnPreset1.addEventListener('click', () => {
    state.presetIndex = 0;
    btnPreset1.className = 'px-2 py-1 rounded bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 transition-colors font-semibold';
    btnPreset2.className = 'px-2 py-1 rounded bg-white hover:bg-stone-100 text-stone-600 border border-stone-200 transition-colors';
    updateModel();
  });

  btnPreset2.addEventListener('click', () => {
    state.presetIndex = 1;
    btnPreset2.className = 'px-2 py-1 rounded bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 transition-colors font-semibold';
    btnPreset1.className = 'px-2 py-1 rounded bg-white hover:bg-stone-100 text-stone-600 border border-stone-200 transition-colors';
    updateModel();
  });

  // Layer Visibility Toggles
  setupLayerToggle('layer-plane', 'plane');
  setupLayerToggle('layer-circle', 'circle');
  setupLayerToggle('layer-radius', 'radius');
  setupLayerToggle('layer-surface', 'surface');

  // Reset Camera View Button
  const btnResetCam = document.getElementById('btn-reset-cam');
  btnResetCam.addEventListener('click', () => {
    gsap.to(camera.position, {
      x: 7.5,
      y: -8.5,
      z: 6.0,
      duration: 1.0,
      ease: 'power2.out',
      onUpdate: () => controls.update()
    });
    gsap.to(controls.target, {
      x: 0,
      y: 0,
      z: 0.5,
      duration: 1.0,
      ease: 'power2.out'
    });
  });

  // Mobile Drawer Toggle
  const btnToggleExplain = document.getElementById('btn-toggle-explain');
  const explainPanel = document.getElementById('explain-panel');
  if (btnToggleExplain && explainPanel) {
    btnToggleExplain.addEventListener('click', () => {
      explainPanel.classList.toggle('hidden');
    });
  }
}

function setupLayerToggle(elementId, layerKey) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.addEventListener('change', (e) => {
    state.layers[layerKey] = e.target.checked;
    updateModelGeometryOnly();
  });
}
