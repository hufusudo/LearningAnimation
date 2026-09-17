/**
 * 条件概率与条件概率密度的几何直观 · 交互式三维可视化引擎
 * 核心几何看点：
 * 1. 联合曲面切片 (Slicing) 与截面相对似然轮廓
 * 2. 截面面积 = 边缘密度 A(y0) = f_Y(y0)
 * 3. 归一化拉伸：高度整体除以截面面积，使总积分等于 1
 * 4. 微元薄板 Δy：体积之比消去厚度，几何跨越零测度陷阱
 * 5. 条件期望（回归直线）与条件方差收缩（信息消除不确定性）
 */

// --- Global State ---
const state = {
  model: 'normal',       // 'normal' | 'triangle' | 'ramp'
  cutDir: 'y',           // 'y' (已知 Y=y0 -> 求 X|Y) | 'x' (已知 X=x0 -> 求 Y|X)
  slicePos: 0.50,        // 当前切片位置 y0 或 x0
  param2: 0.50,          // 相关系数 rho (二维正态)
  intA: -0.50,           // 观测区间起点 a
  intB: 1.00,            // 观测区间终点 b
  slabThickness: 0.00,   // 微元厚度 Δy 或 Δx
  isPlaying: false,      // 自动巡航开关
  morphT: 1.0,           // 2D 变形插值：0 (原始切片) -> 1 (归一化条件密度)
  xrayMode: false,       // 截面透视模式：仅显示截面上的几何关系
  layers: {
    jointSurf: true,
    slicePlane: true,
    sliceArea: true,
    intervalProb: true,
    slab: false,
    regression: true
  }
};

// --- Three.js Variables ---
let scene, camera, renderer, controls;
let container;
const dynamicGroup = new THREE.Group();

// 高度比例缩放因子（让概率密度在 3D 中视觉饱满）
const Z_SCALE = 4.5;

// Three.js Materials
const materials = {
  jointSurf: new THREE.MeshStandardMaterial({
    color: 0x4F46E5,
    transparent: true,
    opacity: 0.40,
    side: THREE.DoubleSide,
    roughness: 0.35,
    metalness: 0.1,
    depthWrite: false
  }),
  jointWire: new THREE.MeshBasicMaterial({
    color: 0x3730A3,
    wireframe: true,
    transparent: true,
    opacity: 0.12
  }),
  slicePlane: new THREE.MeshStandardMaterial({
    color: 0x0D9488,
    transparent: true,
    opacity: 0.20,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  slicePlaneEdge: new THREE.LineBasicMaterial({ color: 0x0D9488, linewidth: 2 }),
  sliceArea: new THREE.MeshStandardMaterial({
    color: 0xF59E0B,
    emissive: 0xD97706,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide
  }),
  sliceRidge: new THREE.LineBasicMaterial({ color: 0xB45309, linewidth: 3 }),
  intervalArea: new THREE.MeshStandardMaterial({
    color: 0x10B981,
    emissive: 0x059669,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide
  }),
  slabMesh: new THREE.MeshStandardMaterial({
    color: 0xFBBF24,
    transparent: true,
    opacity: 0.45,
    roughness: 0.5,
    metalness: 0.1
  }),
  groundContour: new THREE.LineBasicMaterial({ color: 0xCBD5E1, linewidth: 1 }),
  regressionLine: new THREE.LineBasicMaterial({ color: 0xE11D48, linewidth: 3 }),
  meanPoint: new THREE.MeshStandardMaterial({ color: 0xE11D48, emissive: 0xBE123C, emissiveIntensity: 0.6 }),

  // 透视模式专享材质
  xrayNormCurve: new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 3 }),
  xrayNormFill: new THREE.MeshBasicMaterial({ color: 0x3B82F6, transparent: true, opacity: 0.20, side: THREE.DoubleSide }),
  xrayBaseline: new THREE.LineBasicMaterial({ color: 0x1C1917, linewidth: 2 }),
  xrayDashConnector: new THREE.LineDashedMaterial({ color: 0x6366F1, dashSize: 0.12, gapSize: 0.08, linewidth: 2 }),
  xrayIntervalEdge: new THREE.LineBasicMaterial({ color: 0x059669, linewidth: 2 })
};

// --- Model Computation Engines ---
const models = {
  normal: {
    badge: '二维正态分布 N(0, 0, 1, 1, ρ)',
    xMin: -3.0, xMax: 3.0,
    yMin: -3.0, yMax: 3.0,
    param2Label: '相关系数 ρ',
    param2Min: -0.85, param2Max: 0.85, param2Step: 0.05,
    defaultParam2: 0.50,
    sliceMin: -2.4, sliceMax: 2.4, sliceStep: 0.02,
    defaultSlice: 0.50,
    defaultIntA: -0.5, defaultIntB: 1.0,

    // 联合密度 f(x, y)
    f(x, y, rho) {
      const r = rho !== undefined ? rho : state.param2;
      const r2 = r * r;
      const coef = 1.0 / (2.0 * Math.PI * Math.sqrt(Math.max(1e-4, 1.0 - r2)));
      const zVal = (x * x - 2.0 * r * x * y + y * y) / (2.0 * (1.0 - r2));
      return coef * Math.exp(-Math.min(25.0, zVal));
    },

    // 边缘密度
    marginal(coord, isY) {
      // 对标准正态，边缘分布都是一维标准正态 N(0, 1)
      return (1.0 / Math.sqrt(2.0 * Math.PI)) * Math.exp(-0.5 * coord * coord);
    },

    // 条件分布参数: 给定已知量 c，求另一个变量的条件分布 N(mu, sigma2)
    conditionalParams(c, rho) {
      const r = rho !== undefined ? rho : state.param2;
      const mu = r * c;
      const sigma2 = Math.max(1e-4, 1.0 - r * r);
      const sigma = Math.sqrt(sigma2);
      return { mu, sigma2, sigma };
    },

    // 条件概率密度 f_{X|Y}(x|y0)
    condPDF(targetCoord, givenCoord, rho) {
      const { mu, sigma } = this.conditionalParams(givenCoord, rho);
      const diff = targetCoord - mu;
      return (1.0 / (Math.sqrt(2.0 * Math.PI) * sigma)) * Math.exp(-0.5 * (diff * diff) / (sigma * sigma));
    }
  },

  triangle: {
    badge: '三角形区域均匀分布 (考研经典模型)',
    // 区域: 0 <= x <= 2, 0 <= y <= x, 面积 = 2, f(x,y) = 0.5
    xMin: -0.2, xMax: 2.3,
    yMin: -0.2, yMax: 2.3,
    param2Label: '曲面高度 C',
    param2Min: 0.3, param2Max: 1.0, param2Step: 0.05,
    defaultParam2: 0.50,
    sliceMin: 0.05, sliceMax: 1.95, sliceStep: 0.02,
    defaultSlice: 0.60,
    defaultIntA: 0.8, defaultIntB: 1.8,

    f(x, y) {
      if (x >= 0 && x <= 2.0 && y >= 0 && y <= x) {
        return 0.50;
      }
      return 0.0;
    },

    marginal(c, isY) {
      if (isY) {
        // Y = y0: x 范围在 [y0, 2], 截面长 2 - y0, 面积 A = 0.5 * (2 - y0)
        if (c < 0 || c > 2.0) return 0.0;
        return 0.5 * (2.0 - c);
      } else {
        // X = x0: y 范围在 [0, x0], 截面长 x0, 面积 A = 0.5 * x0
        if (c < 0 || c > 2.0) return 0.0;
        return 0.5 * c;
      }
    },

    conditionalParams(c, isY) {
      if (isY) {
        // X|Y=y0 ~ U[y0, 2]
        const a = c, b = 2.0;
        const mu = (a + b) / 2.0;
        const sigma2 = Math.pow(b - a, 2) / 12.0;
        return { mu, sigma2, sigma: Math.sqrt(sigma2), range: [a, b] };
      } else {
        // Y|X=x0 ~ U[0, x0]
        const a = 0.0, b = c;
        const mu = (a + b) / 2.0;
        const sigma2 = Math.pow(b - a, 2) / 12.0;
        return { mu, sigma2, sigma: Math.sqrt(sigma2), range: [a, b] };
      }
    },

    condPDF(targetCoord, givenCoord, isY) {
      if (isY) {
        const y0 = givenCoord;
        if (y0 < 0 || y0 >= 2.0) return 0;
        if (targetCoord >= y0 && targetCoord <= 2.0) {
          return 1.0 / (2.0 - y0);
        }
        return 0;
      } else {
        const x0 = givenCoord;
        if (x0 <= 0 || x0 > 2.0) return 0;
        if (targetCoord >= 0 && targetCoord <= x0) {
          return 1.0 / x0;
        }
        return 0;
      }
    }
  },

  ramp: {
    badge: '非对称线性斜坡分布 f(x,y) = (x+y)/8',
    // 区域: [0, 2] x [0, 2], 积分 = 8, f(x,y) = (x+y)/8
    xMin: -0.2, xMax: 2.3,
    yMin: -0.2, yMax: 2.3,
    param2Label: '底面缩放度',
    param2Min: 0.5, param2Max: 1.5, param2Step: 0.1,
    defaultParam2: 1.0,
    sliceMin: 0.1, sliceMax: 1.9, sliceStep: 0.02,
    defaultSlice: 0.80,
    defaultIntA: 0.4, defaultIntB: 1.6,

    f(x, y) {
      if (x >= 0 && x <= 2.0 && y >= 0 && y <= 2.0) {
        return (x + y) / 8.0;
      }
      return 0.0;
    },

    marginal(c, isY) {
      if (c < 0 || c > 2.0) return 0.0;
      // \int_0^2 (u + c)/8 du = [u^2/16 + c*u/8]_0^2 = 4/16 + 2c/8 = (1 + c)/4
      return (1.0 + c) / 4.0;
    },

    conditionalParams(c, isY) {
      // f(u|c) = (u + c) / (2(1 + c))
      // E[U|c] = \int_0^2 u (u+c) / (2(1+c)) du = \frac{1}{2(1+c)} [u^3/3 + c*u^2/2]_0^2 = \frac{8/3 + 2c}{2(1+c)} = \frac{4/3 + c}{1 + c}
      const mu = (4.0 / 3.0 + c) / (1.0 + c);
      // E[U^2|c] = \frac{1}{2(1+c)} [u^4/4 + c*u^3/3]_0^2 = \frac{4 + 8c/3}{2(1+c)} = \frac{2 + 4c/3}{1+c}
      const e2 = (2.0 + (4.0 * c) / 3.0) / (1.0 + c);
      const sigma2 = Math.max(1e-4, e2 - mu * mu);
      return { mu, sigma2, sigma: Math.sqrt(sigma2), range: [0, 2] };
    },

    condPDF(targetCoord, givenCoord, isY) {
      const u = targetCoord, c = givenCoord;
      if (u < 0 || u > 2.0 || c < 0 || c > 2.0) return 0;
      return (u + c) / (2.0 * (1.0 + c));
    }
  }
};

// --- Helper: Standard Normal CDF for numerical verification ---
function normalCDF(x) {
  const t = 1.0 / (1.0 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2.0);
  let p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + 1.330274429 * t))));
  return x > 0 ? 1.0 - p : p;
}

// 数值积分 Simpson 规则
function integrate1D(func, a, b, n = 100) {
  if (a >= b) return 0;
  const h = (b - a) / n;
  let sum = func(a) + func(b);
  for (let i = 1; i < n; i++) {
    const x = a + i * h;
    sum += (i % 2 === 1 ? 4 : 2) * func(x);
  }
  return (sum * h) / 3.0;
}

// --- Initialization ---
window.addEventListener('DOMContentLoaded', () => {
  initThree();
  initUI();
  updateModel();
  animate();
  renderDerivations();
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

// --- Three.js Setup ---
function initThree() {
  container = document.getElementById('canvas-container');
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xFAF9F5);

  // Camera
  camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  camera.position.set(6.5, -7.0, 5.5);
  camera.up.set(0, 0, 1); // Z is vertical up

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // OrbitControls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0, 0.8);
  controls.maxPolarAngle = Math.PI / 2 + 0.1; // Don't go deep below ground

  // Lights
  const ambLight = new THREE.AmbientLight(0xFFFFFF, 0.75);
  scene.add(ambLight);

  const dirLight = new THREE.DirectionalLight(0xFFFFFF, 0.85);
  dirLight.position.set(8, -6, 12);
  dirLight.castShadow = true;
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0xE2E8F0, 0.4);
  fillLight.position.set(-6, 8, 6);
  scene.add(fillLight);

  // Add Axes & Ground Grid
  createSceneDecorations();

  // Add Dynamic Objects Group
  scene.add(dynamicGroup);

  // Resize Listener
  window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  draw2DSlice();
}

// 场景辅助坐标系与地面网格
function createSceneDecorations() {
  // Ground grid
  const grid = new THREE.GridHelper(8, 16, 0xD6D3CD, 0xE5E4DC);
  grid.rotation.x = Math.PI / 2; // Lie in XY plane
  grid.position.z = -0.005;
  scene.add(grid);

  // Elegant Axes
  const axisGroup = new THREE.Group();

  // X Axis (Red)
  const xGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-3.5, 0, 0),
    new THREE.Vector3(3.8, 0, 0)
  ]);
  const xLine = new THREE.Line(xGeo, new THREE.LineBasicMaterial({ color: 0xDC2626, linewidth: 2 }));
  axisGroup.add(xLine);

  // Y Axis (Teal)
  const yGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -3.5, 0),
    new THREE.Vector3(0, 3.8, 0)
  ]);
  const yLine = new THREE.Line(yGeo, new THREE.LineBasicMaterial({ color: 0x0D9488, linewidth: 2 }));
  axisGroup.add(yLine);

  // Z Axis (Blue - Vertical)
  const zGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 3.2)
  ]);
  const zLine = new THREE.Line(zGeo, new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 2 }));
  axisGroup.add(zLine);

  scene.add(axisGroup);
}

// --- Dynamic 3D Scene Reconstruction ---
function updateSceneGeometry() {
  // Clear old dynamic objects
  while (dynamicGroup.children.length > 0) {
    const obj = dynamicGroup.children[0];
    if (obj.geometry) obj.geometry.dispose();
    dynamicGroup.remove(obj);
  }

  const curModel = models[state.model];
  const isCutY = state.cutDir === 'y';
  const c = state.slicePos;

  // 1. Build Joint Surface Mesh (透视模式下隐去外部曲面，仅聚焦截面)
  if (!state.xrayMode && state.layers.jointSurf) {
    buildJointSurfaceMesh(curModel);
  }

  // 2. Build Slicing Plane
  if (state.layers.slicePlane) {
    buildSlicingPlane(curModel, isCutY, c);
  }

  // 3. Build Raw Slice Area & Interval Probability Area
  if (state.layers.sliceArea) {
    buildSliceAreaMesh(curModel, isCutY, c);
  }

  // 4. Build Slab (Delta y thin prism - 仅在全景非透视模式下展示)
  if (!state.xrayMode && state.layers.slab && state.slabThickness > 0.005) {
    buildSlabMesh(curModel, isCutY, c, state.slabThickness);
  }

  // 5. Build Ground Contours & Regression Line
  if (state.layers.regression) {
    buildGroundRegression(curModel, isCutY, c);
  }

  // 6. 截面透视模式核心：渲染截面上的全部核心几何关系
  if (state.xrayMode) {
    buildSliceXrayRelations(curModel, isCutY, c);
  }
}

// 构建三维联合概率密度曲面
function buildJointSurfaceMesh(model) {
  const segX = 70;
  const segY = 70;
  const geom = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];

  const xMin = model.xMin, xMax = model.xMax;
  const yMin = model.yMin, yMax = model.yMax;
  const dx = (xMax - xMin) / segX;
  const dy = (yMax - yMin) / segY;

  for (let j = 0; j <= segY; j++) {
    const y = yMin + j * dy;
    for (let i = 0; i <= segX; i++) {
      const x = xMin + i * dx;
      const z = model.f(x, y) * Z_SCALE;
      positions.push(x, y, z);
    }
  }

  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const p1 = j * (segX + 1) + i;
      const p2 = p1 + 1;
      const p3 = (j + 1) * (segX + 1) + i;
      const p4 = p3 + 1;

      indices.push(p1, p2, p3);
      indices.push(p2, p4, p3);
    }
  }

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const mesh = new THREE.Mesh(geom, materials.jointSurf);
  const wire = new THREE.Mesh(geom, materials.jointWire);
  mesh.add(wire);
  dynamicGroup.add(mesh);
}

// 构建切片平面
function buildSlicingPlane(model, isCutY, c) {
  const geom = new THREE.BufferGeometry();
  const zMax = 2.8;
  const margin = 0.2;

  let corners = [];
  if (isCutY) {
    const x1 = model.xMin - margin, x2 = model.xMax + margin;
    corners = [
      new THREE.Vector3(x1, c, 0),
      new THREE.Vector3(x2, c, 0),
      new THREE.Vector3(x2, c, zMax),
      new THREE.Vector3(x1, c, zMax)
    ];
  } else {
    const y1 = model.yMin - margin, y2 = model.yMax + margin;
    corners = [
      new THREE.Vector3(c, y1, 0),
      new THREE.Vector3(c, y2, 0),
      new THREE.Vector3(c, y2, zMax),
      new THREE.Vector3(c, y1, zMax)
    ];
  }

  const positions = [
    corners[0].x, corners[0].y, corners[0].z,
    corners[1].x, corners[1].y, corners[1].z,
    corners[2].x, corners[2].y, corners[2].z,

    corners[0].x, corners[0].y, corners[0].z,
    corners[2].x, corners[2].y, corners[2].z,
    corners[3].x, corners[3].y, corners[3].z
  ];

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();

  const planeMesh = new THREE.Mesh(geom, materials.slicePlane);

  // Outline
  const outlineGeo = new THREE.BufferGeometry().setFromPoints([
    corners[0], corners[1], corners[2], corners[3], corners[0]
  ]);
  const outlineLine = new THREE.Line(outlineGeo, materials.slicePlaneEdge);
  planeMesh.add(outlineLine);

  dynamicGroup.add(planeMesh);
}

// 构建截面面积填充和目标区间概率高亮
function buildSliceAreaMesh(model, isCutY, c) {
  const nPoints = 120;
  const uMin = isCutY ? model.xMin : model.yMin;
  const uMax = isCutY ? model.xMax : model.yMax;
  const du = (uMax - uMin) / nPoints;

  const slicePts = [];
  const ridgePts = [];

  for (let i = 0; i <= nPoints; i++) {
    const u = uMin + i * du;
    const x = isCutY ? u : c;
    const y = isCutY ? c : u;
    const z = model.f(x, y) * Z_SCALE;
    slicePts.push({ u, x, y, z });
    ridgePts.push(new THREE.Vector3(x, y, z));
  }

  // 1. 完整截面几何体 (Amber)
  const fullGeom = new THREE.BufferGeometry();
  const fullPos = [];
  for (let i = 0; i < nPoints; i++) {
    const p1 = slicePts[i];
    const p2 = slicePts[i + 1];

    // Triangle 1
    fullPos.push(p1.x, p1.y, 0);
    fullPos.push(p2.x, p2.y, 0);
    fullPos.push(p2.x, p2.y, p2.z);

    // Triangle 2
    fullPos.push(p1.x, p1.y, 0);
    fullPos.push(p2.x, p2.y, p2.z);
    fullPos.push(p1.x, p1.y, p1.z);
  }
  fullGeom.setAttribute('position', new THREE.Float32BufferAttribute(fullPos, 3));
  fullGeom.computeVertexNormals();
  const fullMesh = new THREE.Mesh(fullGeom, materials.sliceArea);
  dynamicGroup.add(fullMesh);

  // Ridge line
  const ridgeGeom = new THREE.BufferGeometry().setFromPoints(ridgePts);
  const ridgeLine = new THREE.Line(ridgeGeom, materials.sliceRidge);
  dynamicGroup.add(ridgeLine);

  // 2. 目标概率积分区间 [intA, intB] (Emerald Green)
  if (state.layers.intervalProb && state.intA < state.intB) {
    const a = Math.max(uMin, state.intA);
    const b = Math.min(uMax, state.intB);
    const subN = 50;
    const subDu = (b - a) / subN;
    const intPos = [];

    for (let i = 0; i < subN; i++) {
      const u1 = a + i * subDu;
      const u2 = a + (i + 1) * subDu;
      const x1 = isCutY ? u1 : c;
      const y1 = isCutY ? c : u1;
      const z1 = model.f(x1, y1) * Z_SCALE;

      const x2 = isCutY ? u2 : c;
      const y2 = isCutY ? c : u2;
      const z2 = model.f(x2, y2) * Z_SCALE;

      intPos.push(x1, y1, 0.001);
      intPos.push(x2, y2, 0.001);
      intPos.push(x2, y2, z2);

      intPos.push(x1, y1, 0.001);
      intPos.push(x2, y2, z2);
      intPos.push(x1, y1, z1);
    }

    const intGeom = new THREE.BufferGeometry();
    intGeom.setAttribute('position', new THREE.Float32BufferAttribute(intPos, 3));
    intGeom.computeVertexNormals();
    const intMesh = new THREE.Mesh(intGeom, materials.intervalArea);
    dynamicGroup.add(intMesh);
  }
}

// 构建微元厚度薄板 Δy
function buildSlabMesh(model, isCutY, c, delta) {
  const n = 60;
  const uMin = isCutY ? model.xMin : model.yMin;
  const uMax = isCutY ? model.xMax : model.yMax;
  const du = (uMax - uMin) / n;

  const positions = [];
  const c2 = c + delta;

  for (let i = 0; i < n; i++) {
    const u1 = uMin + i * du;
    const u2 = uMin + (i + 1) * du;

    const x1_a = isCutY ? u1 : c,  y1_a = isCutY ? c : u1;
    const x2_a = isCutY ? u2 : c,  y2_a = isCutY ? c : u2;
    const z1_a = model.f(x1_a, y1_a) * Z_SCALE;
    const z2_a = model.f(x2_a, y2_a) * Z_SCALE;

    const x1_b = isCutY ? u1 : c2, y1_b = isCutY ? c2 : u1;
    const x2_b = isCutY ? u2 : c2, y2_b = isCutY ? c2 : u2;
    const z1_b = model.f(x1_b, y1_b) * Z_SCALE;
    const z2_b = model.f(x2_b, y2_b) * Z_SCALE;

    // Top face
    positions.push(x1_a, y1_a, z1_a,  x2_a, y2_a, z2_a,  x2_b, y2_b, z2_b);
    positions.push(x1_a, y1_a, z1_a,  x2_b, y2_b, z2_b,  x1_b, y1_b, z1_b);

    // Front/Back walls
    positions.push(x1_a, y1_a, 0,  x2_a, y2_a, 0,  x2_a, y2_a, z2_a);
    positions.push(x1_a, y1_a, 0,  x2_a, y2_a, z2_a,  x1_a, y1_a, z1_a);

    positions.push(x1_b, y1_b, 0,  x2_b, y2_b, z2_b,  x2_b, y2_b, 0);
    positions.push(x1_b, y1_b, 0,  x1_b, y1_b, z1_b,  x2_b, y2_b, z2_b);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();

  const slab = new THREE.Mesh(geom, materials.slabMesh);
  dynamicGroup.add(slab);
}

// 构建地面等高线、回归直线与条件期望特征点
function buildGroundRegression(model, isCutY, c) {
  // 1. 等高线 (仅正态分布时绘制标准椭圆)
  if (state.model === 'normal') {
    const rho = state.param2;
    const r2 = rho * rho;
    const kLevels = [1.0, 2.0, 3.0]; // Mahalanobis distance contours

    kLevels.forEach(k => {
      const pts = [];
      const steps = 80;
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        // x^2 - 2*rho*x*y + y^2 = k^2 * (1 - rho^2)
        // Parametrization using Cholesky or rotation
        const u = k * Math.cos(theta);
        const v = k * Math.sin(theta);
        const x = u;
        const y = rho * u + Math.sqrt(Math.max(0.01, 1 - r2)) * v;
        pts.push(new THREE.Vector3(x, y, 0.002));
      }
      const contourGeom = new THREE.BufferGeometry().setFromPoints(pts);
      const contourLine = new THREE.Line(contourGeom, materials.groundContour);
      dynamicGroup.add(contourLine);
    });
  }

  // 2. 回归直线: E[X|Y=y] 或 E[Y|X=x]
  const regPts = [];
  const minC = -2.5, maxC = 2.5;
  const n = 50;
  for (let i = 0; i <= n; i++) {
    const val = minC + (i / n) * (maxC - minC);
    if (state.model === 'normal') {
      const rho = state.param2;
      if (isCutY) {
        // E[X|Y=y] = rho * y
        regPts.push(new THREE.Vector3(rho * val, val, 0.005));
      } else {
        // E[Y|X=x] = rho * x
        regPts.push(new THREE.Vector3(val, rho * val, 0.005));
      }
    } else if (state.model === 'triangle') {
      if (val >= 0 && val <= 2.0) {
        if (isCutY) {
          // E[X|Y=y] = (y + 2) / 2
          regPts.push(new THREE.Vector3((val + 2.0) / 2.0, val, 0.005));
        } else {
          // E[Y|X=x] = x / 2
          regPts.push(new THREE.Vector3(val, val / 2.0, 0.005));
        }
      }
    } else if (state.model === 'ramp') {
      if (val >= 0 && val <= 2.0) {
        const mu = (4.0 / 3.0 + val) / (1.0 + val);
        if (isCutY) {
          regPts.push(new THREE.Vector3(mu, val, 0.005));
        } else {
          regPts.push(new THREE.Vector3(val, mu, 0.005));
        }
      }
    }
  }

  if (regPts.length > 1) {
    const regGeom = new THREE.BufferGeometry().setFromPoints(regPts);
    const regLine = new THREE.Line(regGeom, materials.regressionLine);
    dynamicGroup.add(regLine);
  }

  // 3. 当前切片对应的条件期望点 E[X|Y=c] 在地面与切片上的标定
  let currentMu = 0;
  if (state.model === 'normal') {
    currentMu = state.param2 * c;
  } else if (state.model === 'triangle') {
    currentMu = isCutY ? (c + 2.0) / 2.0 : c / 2.0;
  } else if (state.model === 'ramp') {
    currentMu = (4.0 / 3.0 + c) / (1.0 + c);
  }

  const posX = isCutY ? currentMu : c;
  const posY = isCutY ? c : currentMu;

  const sphereGeo = new THREE.SphereGeometry(0.08, 16, 16);
  const sphereMesh = new THREE.Mesh(sphereGeo, materials.meanPoint);
  sphereMesh.position.set(posX, posY, 0.05);
  dynamicGroup.add(sphereMesh);

  // 垂线连杆至切片截面峰顶
  const peakZ = model.f(posX, posY) * Z_SCALE;
  const postGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(posX, posY, 0),
    new THREE.Vector3(posX, posY, peakZ)
  ]);
  const postLine = new THREE.Line(postGeo, new THREE.LineDashedMaterial({
    color: 0xE11D48,
    dashSize: 0.1,
    gapSize: 0.06,
    linewidth: 2
  }));
  postLine.computeLineDistances();
  dynamicGroup.add(postLine);
}

// 辅助：生成 3D 浮动关系注释标签 (Canvas Sprite)
function createTextSprite(text, color = '#1C1917', bgColor = 'rgba(255, 255, 255, 0.92)') {
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bgColor;
  if (ctx.roundRect) {
    ctx.roundRect(4, 4, 352, 72, 14);
  } else {
    ctx.rect(4, 4, 352, 72);
  }
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = 'bold 22px JetBrains Mono, monospace, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 180, 40);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.7, 0.38, 1);
  return sprite;
}

// 透视模式核心逻辑：精细化渲染截面上的全部核心几何关系
function buildSliceXrayRelations(model, isCutY, c) {
  const uMin = isCutY ? model.xMin : model.yMin;
  const uMax = isCutY ? model.xMax : model.yMax;
  const nPoints = 120;
  const du = (uMax - uMin) / nPoints;

  const areaA = model.marginal(c, isCutY);
  const scale = areaA > 1e-4 ? 1.0 / areaA : 1.0;

  let condParams;
  if (state.model === 'normal') {
    condParams = model.conditionalParams(c, state.param2);
  } else {
    condParams = model.conditionalParams(c, isCutY);
  }

  // 1. 截面基准数轴 (Slice Baseline Z = 0)
  const basePts = [
    new THREE.Vector3(isCutY ? uMin - 0.2 : c, isCutY ? c : uMin - 0.2, 0.003),
    new THREE.Vector3(isCutY ? uMax + 0.2 : c, isCutY ? c : uMax + 0.2, 0.003)
  ];
  const baseGeom = new THREE.BufferGeometry().setFromPoints(basePts);
  const baseLine = new THREE.Line(baseGeom, materials.xrayBaseline);
  dynamicGroup.add(baseLine);

  // 截面基准刻度小齿
  const step = state.model === 'normal' ? 1.0 : 0.5;
  for (let u = Math.ceil(uMin); u <= Math.floor(uMax); u += step) {
    const tickPts = [
      new THREE.Vector3(isCutY ? u : c, isCutY ? c : u, -0.06),
      new THREE.Vector3(isCutY ? u : c, isCutY ? c : u, 0.06)
    ];
    const tickGeom = new THREE.BufferGeometry().setFromPoints(tickPts);
    dynamicGroup.add(new THREE.Line(tickGeom, materials.xrayBaseline));
  }

  // 2. 归一化条件概率密度曲线 (Blue Curve & Fill)
  const normRidgePts = [];
  const normFillPos = [];
  let peakNormZ = 0;
  let peakRawZ = 0;

  for (let i = 0; i <= nPoints; i++) {
    const u = uMin + i * du;
    const x = isCutY ? u : c;
    const y = isCutY ? c : u;
    const rawVal = model.f(x, y);
    const normVal = rawVal * scale;
    const zNorm = normVal * Z_SCALE;

    normRidgePts.push(new THREE.Vector3(x, y, zNorm));
    if (zNorm > peakNormZ) peakNormZ = zNorm;
    if (rawVal * Z_SCALE > peakRawZ) peakRawZ = rawVal * Z_SCALE;
  }

  for (let i = 0; i < nPoints; i++) {
    const p1 = normRidgePts[i];
    const p2 = normRidgePts[i + 1];

    normFillPos.push(p1.x, p1.y, 0.002);
    normFillPos.push(p2.x, p2.y, 0.002);
    normFillPos.push(p2.x, p2.y, p2.z);

    normFillPos.push(p1.x, p1.y, 0.002);
    normFillPos.push(p2.x, p2.y, p2.z);
    normFillPos.push(p1.x, p1.y, p1.z);
  }

  // 归一化曲面填充
  const normFillGeom = new THREE.BufferGeometry();
  normFillGeom.setAttribute('position', new THREE.Float32BufferAttribute(normFillPos, 3));
  normFillGeom.computeVertexNormals();
  const normFillMesh = new THREE.Mesh(normFillGeom, materials.xrayNormFill);
  dynamicGroup.add(normFillMesh);

  // 归一化曲线轮廓
  const normRidgeGeom = new THREE.BufferGeometry().setFromPoints(normRidgePts);
  const normRidgeLine = new THREE.Line(normRidgeGeom, materials.xrayNormCurve);
  dynamicGroup.add(normRidgeLine);

  // 3. 峰值处归一化拉伸指示箭头与连线 (Scaling Connector)
  const mu = condParams.mu;
  const muX = isCutY ? mu : c;
  const muY = isCutY ? c : mu;
  const peakRawVal = model.f(muX, muY) * Z_SCALE;
  const peakNormVal = peakRawVal * scale;

  const arrowPts = [
    new THREE.Vector3(muX, muY, peakRawVal),
    new THREE.Vector3(muX, muY, peakNormVal)
  ];
  const arrowGeom = new THREE.BufferGeometry().setFromPoints(arrowPts);
  const arrowLine = new THREE.Line(arrowGeom, materials.xrayDashConnector);
  arrowLine.computeLineDistances();
  dynamicGroup.add(arrowLine);

  // 4. 目标积分区间 [a, b] 边界立柱 (Emerald Green)
  if (state.layers.intervalProb && state.intA < state.intB) {
    const a = Math.max(uMin, state.intA);
    const b = Math.min(uMax, state.intB);
    const xA = isCutY ? a : c, yA = isCutY ? c : a;
    const xB = isCutY ? b : c, yB = isCutY ? c : b;
    const zA = model.f(xA, yA) * scale * Z_SCALE;
    const zB = model.f(xB, yB) * scale * Z_SCALE;

    const edgeA = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(xA, yA, 0), new THREE.Vector3(xA, yA, zA)
    ]), materials.xrayIntervalEdge);
    const edgeB = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(xB, yB, 0), new THREE.Vector3(xB, yB, zB)
    ]), materials.xrayIntervalEdge);
    dynamicGroup.add(edgeA);
    dynamicGroup.add(edgeB);
  }

  // 5. 截面上的 3D 浮动关系注释徽章 (Sprites)
  let probVal = 0;
  if (state.intA < state.intB) {
    if (state.model === 'normal') {
      const zA = (state.intA - condParams.mu) / condParams.sigma;
      const zB = (state.intB - condParams.mu) / condParams.sigma;
      probVal = normalCDF(zB) - normalCDF(zA);
    } else {
      const pdfFunc = (u) => model.condPDF(u, c, isCutY);
      probVal = integrate1D(pdfFunc, state.intA, state.intB, 80);
    }
  }

  // Sprite 1: 归一化条件密度标注 (Blue)
  const normSprite = createTextSprite(`f_{${isCutY ? 'X|Y' : 'Y|X'}} (面积恒=1.0)`, '#1D4ED8', 'rgba(239, 246, 255, 0.95)');
  normSprite.position.set(isCutY ? mu + 0.9 : c, isCutY ? c : mu + 0.9, Math.max(peakNormVal, peakRawZ) + 0.35);
  dynamicGroup.add(normSprite);

  // Sprite 2: 截面原面积与边缘密度标注 (Amber)
  const rawSprite = createTextSprite(`原面积 A = f_${isCutY ? 'Y' : 'X'} = ${areaA.toFixed(3)}`, '#B45309', 'rgba(254, 243, 199, 0.95)');
  rawSprite.position.set(isCutY ? mu - 1.0 : c, isCutY ? c : mu - 1.0, peakRawVal + 0.35);
  dynamicGroup.add(rawSprite);

  // Sprite 3: 拉伸倍率标注
  const scaleSprite = createTextSprite(`拉伸 ×${scale.toFixed(2)}倍`, '#4338CA', 'rgba(238, 242, 255, 0.95)');
  scaleSprite.scale.set(1.2, 0.32, 1);
  scaleSprite.position.set(isCutY ? mu : c, isCutY ? c : mu, (peakRawVal + peakNormVal) / 2.0);
  dynamicGroup.add(scaleSprite);

  // Sprite 4: 目标区间条件概率标注 (Emerald)
  if (state.layers.intervalProb && state.intA < state.intB) {
    const midInt = (Math.max(uMin, state.intA) + Math.min(uMax, state.intB)) / 2.0;
    const probSprite = createTextSprite(`P(${state.intA.toFixed(1)}≤${isCutY ? 'X' : 'Y'}≤${state.intB.toFixed(1)}|条件) = ${probVal.toFixed(3)}`, '#047857', 'rgba(209, 250, 229, 0.95)');
    probSprite.position.set(isCutY ? midInt : c, isCutY ? c : midInt, 0.25);
    dynamicGroup.add(probSprite);
  }
}

// --- 2D Cross-Section & Normalization Canvas Drawing ---
function draw2DSlice() {
  const canvas = document.getElementById('slice-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const curModel = models[state.model];
  const isCutY = state.cutDir === 'y';
  const c = state.slicePos;

  const uMin = isCutY ? curModel.xMin : curModel.yMin;
  const uMax = isCutY ? curModel.xMax : curModel.yMax;
  const marginX = 40;
  const marginY = 25;
  const plotW = w - marginX * 2;
  const plotH = h - marginY * 2;

  // 计算当前切片边缘密度（截面原面积）
  const areaA = curModel.marginal(c, isCutY);
  const scaleNorm = areaA > 1e-4 ? 1.0 / areaA : 1.0;

  // 插值拉伸因子: morphT 从 0.0 (原切片) 到 1.0 (完全归一化)
  const currentScale = 1.0 + state.morphT * (scaleNorm - 1.0);

  // 坐标映射
  const toCanvasX = (u) => marginX + ((u - uMin) / (uMax - uMin)) * plotW;
  // 最大可能高度预留
  const maxPDF = state.model === 'normal'
    ? (1.0 / (Math.sqrt(2 * Math.PI) * Math.sqrt(Math.max(0.05, 1 - state.param2 * state.param2)))) * 1.35
    : 1.6;
  const toCanvasY = (val) => (h - marginY) - (val / maxPDF) * plotH;

  // 1. 绘制网格与坐标轴
  ctx.strokeStyle = '#E5E4DC';
  ctx.lineWidth = 1;
  ctx.beginPath();
  // 水平基线 (Z=0)
  ctx.moveTo(marginX - 10, h - marginY);
  ctx.lineTo(w - marginX + 10, h - marginY);
  // Y 轴
  const zeroX = toCanvasX(0);
  if (zeroX >= marginX && zeroX <= w - marginX) {
    ctx.moveTo(zeroX, marginY);
    ctx.lineTo(zeroX, h - marginY);
  }
  ctx.stroke();

  // 刻度文字
  ctx.fillStyle = '#78716C';
  ctx.font = '10px JetBrains Mono';
  ctx.textAlign = 'center';
  const step = state.model === 'normal' ? 1.0 : 0.5;
  for (let u = Math.ceil(uMin); u <= Math.floor(uMax); u += step) {
    const cx = toCanvasX(u);
    ctx.fillText(u.toFixed(1), cx, h - marginY + 14);
  }

  // 2. 原始截面曲线（琥珀色虚线填充）
  const steps = 150;
  const du = (uMax - uMin) / steps;

  // 原始切片高度
  ctx.beginPath();
  ctx.moveTo(toCanvasX(uMin), h - marginY);
  for (let i = 0; i <= steps; i++) {
    const u = uMin + i * du;
    const x = isCutY ? u : c;
    const y = isCutY ? c : u;
    const rawZ = curModel.f(x, y);
    ctx.lineTo(toCanvasX(u), toCanvasY(rawZ));
  }
  ctx.lineTo(toCanvasX(uMax), h - marginY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
  ctx.fill();
  ctx.strokeStyle = '#F59E0B';
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);

  // 3. 目标积分区间 [intA, intB] 在动态拉伸曲线下的面积填充 (Emerald Green)
  if (state.intA < state.intB) {
    const a = Math.max(uMin, state.intA);
    const b = Math.min(uMax, state.intB);
    const subSteps = 60;
    const subDu = (b - a) / subSteps;

    ctx.beginPath();
    ctx.moveTo(toCanvasX(a), h - marginY);
    for (let i = 0; i <= subSteps; i++) {
      const u = a + i * subDu;
      const x = isCutY ? u : c;
      const y = isCutY ? c : u;
      const rawZ = curModel.f(x, y);
      const morphZ = rawZ * currentScale;
      ctx.lineTo(toCanvasX(u), toCanvasY(morphZ));
    }
    ctx.lineTo(toCanvasX(b), h - marginY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
    ctx.fill();
  }

  // 4. 当前变形/归一化曲线 (蓝色实线)
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const u = uMin + i * du;
    const x = isCutY ? u : c;
    const y = isCutY ? c : u;
    const rawZ = curModel.f(x, y);
    const morphZ = rawZ * currentScale;
    const cx = toCanvasX(u);
    const cy = toCanvasY(morphZ);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.strokeStyle = '#2563EB';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // 5. 条件均值标注 (红色垂直虚线)
  let currentMu = 0;
  if (state.model === 'normal') {
    currentMu = state.param2 * c;
  } else if (state.model === 'triangle') {
    currentMu = isCutY ? (c + 2.0) / 2.0 : c / 2.0;
  } else if (state.model === 'ramp') {
    currentMu = (4.0 / 3.0 + c) / (1.0 + c);
  }

  const muCanvasX = toCanvasX(currentMu);
  if (muCanvasX >= marginX && muCanvasX <= w - marginX) {
    ctx.strokeStyle = '#E11D48';
    ctx.setLineDash([3, 2]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(muCanvasX, marginY);
    ctx.lineTo(muCanvasX, h - marginY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#E11D48';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(`E=${currentMu.toFixed(2)}`, muCanvasX, marginY - 4);
  }
}

// --- HUD & Math Derivation Panel Updates ---
function updateHUD() {
  const curModel = models[state.model];
  const isCutY = state.cutDir === 'y';
  const c = state.slicePos;

  // 截面原面积 = 边缘密度
  const areaA = curModel.marginal(c, isCutY);
  const scale = areaA > 1e-4 ? 1.0 / areaA : 0.0;

  // 条件期望与方差
  let condParams;
  if (state.model === 'normal') {
    condParams = curModel.conditionalParams(c, state.param2);
  } else {
    condParams = curModel.conditionalParams(c, isCutY);
  }

  // 计算目标区间条件概率 P(a <= X <= b | Y = c)
  let probVal = 0;
  if (state.intA < state.intB) {
    if (state.model === 'normal') {
      const zA = (state.intA - condParams.mu) / condParams.sigma;
      const zB = (state.intB - condParams.mu) / condParams.sigma;
      probVal = normalCDF(zB) - normalCDF(zA);
    } else {
      const pdfFunc = (u) => curModel.condPDF(u, c, isCutY);
      probVal = integrate1D(pdfFunc, state.intA, state.intB, 80);
    }
  }

  // Update HUD text
  document.getElementById('hud-model-badge').innerText = curModel.badge;
  document.getElementById('hud-slice-formula').innerText = `${isCutY ? 'Y' : 'X'} = ${c.toFixed(2)}`;
  document.getElementById('hud-area-val').innerText = `A = f_${isCutY ? 'Y' : 'X'} = ${areaA.toFixed(3)}`;
  document.getElementById('hud-scale-val').innerText = `1 / f = ${scale.toFixed(2)}×`;
  document.getElementById('hud-prob-val').innerText = `P(${state.intA.toFixed(2)}≤${isCutY ? 'X' : 'Y'}≤${state.intB.toFixed(2)}|${isCutY ? 'Y' : 'X'}) = ${Math.max(0, Math.min(1, probVal)).toFixed(3)}`;
  document.getElementById('hud-mean-val').innerText = `E[${isCutY ? 'X' : 'Y'}|${isCutY ? 'Y' : 'X'}=${c.toFixed(2)}] = ${condParams.mu.toFixed(3)}`;

  // Update slider label values
  document.getElementById('val-slice').innerText = c.toFixed(2);
  document.getElementById('val-interval').innerText = `[${state.intA.toFixed(2)}, ${state.intB.toFixed(2)}]`;
  document.getElementById('val-slab').innerText = state.slabThickness.toFixed(2);
  if (document.getElementById('val-param2')) {
    document.getElementById('val-param2').innerText = state.param2.toFixed(2);
  }
}

// 动态渲染右侧数学推导看板
function renderDerivations() {
  const curModel = models[state.model];
  const isCutY = state.cutDir === 'y';
  const c = state.slicePos;
  const areaA = curModel.marginal(c, isCutY);
  const scale = areaA > 1e-4 ? 1.0 / areaA : 0.0;

  let condParams;
  if (state.model === 'normal') {
    condParams = curModel.conditionalParams(c, state.param2);
  } else {
    condParams = curModel.conditionalParams(c, isCutY);
  }

  const containerEl = document.getElementById('dynamic-derivation-content');
  if (!containerEl) return;

  let modelSpecificHTML = '';

  if (state.model === 'normal') {
    const rho = state.param2;
    modelSpecificHTML = `
      <div class="editorial-card p-3 bg-stone-50 border border-[#E5E4DC] space-y-2">
        <div class="flex items-center justify-between text-xs font-semibold text-stone-900">
          <span>二维正态切片：截面仍是正态分布</span>
          <span class="text-[10px] font-mono text-blue-600">ρ = ${rho.toFixed(2)}</span>
        </div>
        <p class="text-[11px] text-stone-600">
          当固定条件 $Y = y_0 = ${c.toFixed(2)}$ 时，条件变量 $X \\mid Y=y_0$ 依然严格服从一维正态分布：
        </p>
        <div class="formula-box text-xs font-mono">
          $$X \\mid Y=y_0 \\sim N\\Big(\\mu_{X|Y},\\; \\sigma_{X|Y}^2\\Big)$$
          $$\\mu_{X|Y} = \\rho y_0 = ${rho.toFixed(2)} \\times ${c.toFixed(2)} = ${condParams.mu.toFixed(3)}$$
          $$\\sigma_{X|Y}^2 = 1 - \\rho^2 = 1 - (${rho.toFixed(2)})^2 = ${condParams.sigma2.toFixed(3)}$$
        </div>
        <div class="callout-box callout-important text-xs">
          <strong>几何核心洞察（回归与方差收缩）：</strong><br>
          1. <strong>中心随条件滑动</strong>：切片最高峰（均值）的轨迹在底面形成直线 $x = \\rho y$（最小二乘回归线）；<br>
          2. <strong>方差必然收缩</strong>：$\\sigma_{X|Y}^2 = 1-\\rho^2 \\le 1$。已知条件 $Y$ 消除了部分随机不确定性，切片钟形曲线比边缘分布更陡峭！
        </div>
      </div>
    `;
  } else if (state.model === 'triangle') {
    modelSpecificHTML = `
      <div class="editorial-card p-3 bg-stone-50 border border-[#E5E4DC] space-y-2">
        <div class="flex items-center justify-between text-xs font-semibold text-stone-900">
          <span>考研真题模型：三角形区域均匀分布</span>
          <span class="text-[10px] font-mono text-amber-700">D: 0≤x≤2, 0≤y≤x</span>
        </div>
        <p class="text-[11px] text-stone-600">
          联合密度 $f(x, y) = 0.5$（面积为 2）。当切片 $Y = y_0 = ${c.toFixed(2)}$ 时：
        </p>
        <div class="formula-box text-xs font-mono">
          $$x \\in [y_0, 2] = [${c.toFixed(2)}, 2.0],\\quad \\text{截面宽 } L = 2 - y_0 = ${(2.0 - c).toFixed(2)}$$
          $$\\text{截面原面积 } A(y_0) = 0.5 \\times (2 - y_0) = ${areaA.toFixed(3)} = f_Y(y_0)$$
          $$f_{X|Y}(x \\mid y_0) = \\frac{f(x, y_0)}{f_Y(y_0)} = \\frac{0.5}{0.5(2 - y_0)} = \\frac{1}{2 - y_0} = ${scale.toFixed(3)}$$
        </div>
        <div class="callout-box callout-note text-xs">
          <strong>均匀性继承与高程突变：</strong><br>
          条件分布退化为区间 $[y_0, 2]$ 上的<strong>一维均匀分布</strong>！随着切片 $y_0$ 往上移，截面变窄，为保证面积等于 1，归一化高度 $\\frac{1}{2-y_0}$ 剧烈上升！
        </div>
      </div>
    `;
  } else if (state.model === 'ramp') {
    modelSpecificHTML = `
      <div class="editorial-card p-3 bg-stone-50 border border-[#E5E4DC] space-y-2">
        <div class="flex items-center justify-between text-xs font-semibold text-stone-900">
          <span>非对称斜坡分布：f(x,y) = (x+y)/8</span>
        </div>
        <p class="text-[11px] text-stone-600">
          当切片 $Y = y_0 = ${c.toFixed(2)}$ 时，截面是一条倾斜的一维直线段：
        </p>
        <div class="formula-box text-xs font-mono">
          $$f_Y(y_0) = \\int_0^2 \\frac{x + y_0}{8} dx = \\frac{1 + y_0}{4} = ${areaA.toFixed(3)}$$
          $$f_{X|Y}(x \\mid y_0) = \\frac{x + y_0}{8 \\cdot \\frac{1+y_0}{4}} = \\frac{x + y_0}{2(1 + y_0)}$$
          $$E[X \\mid Y = y_0] = \\frac{\\frac{4}{3} + y_0}{1 + y_0} = ${condParams.mu.toFixed(3)}$$
        </div>
      </div>
    `;
  }

  containerEl.innerHTML = `
    <!-- General Geometric Paradigm -->
    <div class="callout-box callout-tip">
      <div class="font-bold mb-1 flex items-center gap-1.5">
        <span>§1 核心几何法则：切片与归一化拉伸 (Slice & Renormalize)</span>
      </div>
      对于连续型随机变量，求条件概率密度遵循极致简练的两步几何动作：
      <ol class="list-decimal list-inside space-y-1 mt-1 font-mono text-[11px]">
        <li><strong>取切片</strong>：用平面 $Y = y_0$ 切联合曲面，截交曲线形状完全继承联合密度 $z = f(x, y_0)$；</li>
        <li><strong>除以截面面积</strong>：截面下方实际面积为 $A(y_0) = \\int f(x, y_0)dx = f_Y(y_0)$（即边缘密度）。将其高度整体除以 $A(y_0)$，使得整根曲线积分为 1：</li>
      </ol>
      <div class="formula-box text-center my-1.5 font-bold text-blue-700">
        $$f_{X|Y}(x \\mid y_0) = \\frac{f(x, y_0)}{f_Y(y_0)} = \\frac{\\text{截面各点高}}{\\text{该截面总面积}}$$
      </div>
    </div>

    <!-- Active Model Specific Card -->
    ${modelSpecificHTML}

    <!-- Slab Limit & Borel Paradox -->
    <div class="callout-box callout-warning">
      <div class="font-bold mb-1">§2 微元法极限：消去薄片厚度 Δy (Slab Limit)</div>
      <strong>为什么 $P(Y = y_0) = 0$，条件概率却依然存在？</strong><br>
      若直接代入古典离散公式 $P(A|B) = \\frac{P(AB)}{P(B)}$，将出现 $\\frac{0}{0}$ 的未定式。<br>
      <strong>微元几何解释</strong>：考虑厚度为 $\\Delta y$ 的立体切片柱体：
      <div class="formula-box text-xs my-1 font-mono">
        $$P(a \\le X \\le b \\mid y_0 \\le Y \\le y_0 + \\Delta y) = \\frac{\\text{目标柱体体积}}{\\text{切片总柱体体积}} \\approx \\frac{\\left[\\int_a^b f(x, y_0)dx\\right] \\cdot \\Delta y}{f_Y(y_0) \\cdot \\Delta y}$$
      </div>
      当 $\\Delta y \\to 0$ 时，<strong>厚度 $\\Delta y$ 在分子分母中发生精确对消</strong>！留下切片上截面局部面积与总面积之比。这在几何上完美消解了零测度悖论。
    </div>
  `;

  initKaTeX();
}

// --- UI Interaction & Event Handlers ---
function initUI() {
  // Preset Tab Switchers
  const tabs = ['normal', 'triangle', 'ramp'];
  tabs.forEach(m => {
    const btn = document.getElementById(`tab-preset-${m}`);
    if (btn) {
      btn.addEventListener('click', () => {
        tabs.forEach(t => document.getElementById(`tab-preset-${t}`).classList.remove('active'));
        btn.classList.add('active');
        state.model = m;
        resetModelParameters();
      });
    }
  });

  // Cut Direction Toggles
  const btnCutY = document.getElementById('btn-cut-y');
  const btnCutX = document.getElementById('btn-cut-x');
  btnCutY.addEventListener('click', () => {
    btnCutY.classList.add('active');
    btnCutX.classList.remove('active');
    state.cutDir = 'y';
    document.getElementById('label-slider-slice').innerHTML = '<span class="w-2 h-2 rounded-full bg-teal-600"></span> 切片位置 y₀';
    updateModel();
  });
  btnCutX.addEventListener('click', () => {
    btnCutX.classList.add('active');
    btnCutY.classList.remove('active');
    state.cutDir = 'x';
    document.getElementById('label-slider-slice').innerHTML = '<span class="w-2 h-2 rounded-full bg-teal-600"></span> 切片位置 x₀';
    updateModel();
  });

  // Layer Checkboxes
  const layerBindings = [
    { id: 'layer-joint-surf', key: 'jointSurf' },
    { id: 'layer-slice-plane', key: 'slicePlane' },
    { id: 'layer-slice-area', key: 'sliceArea' },
    { id: 'layer-interval-prob', key: 'intervalProb' },
    { id: 'layer-slab', key: 'slab' },
    { id: 'layer-regression', key: 'regression' }
  ];
  layerBindings.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', (e) => {
        state.layers[key] = e.target.checked;
        updateSceneGeometry();
      });
    }
  });

  // Sliders
  const sliderSlice = document.getElementById('slider-slice');
  sliderSlice.addEventListener('input', (e) => {
    state.slicePos = parseFloat(e.target.value);
    updateModel();
  });

  const sliderParam2 = document.getElementById('slider-param2');
  sliderParam2.addEventListener('input', (e) => {
    state.param2 = parseFloat(e.target.value);
    updateModel();
  });

  const sliderIntA = document.getElementById('slider-int-a');
  const sliderIntB = document.getElementById('slider-int-b');
  sliderIntA.addEventListener('input', (e) => {
    state.intA = parseFloat(e.target.value);
    if (state.intA > state.intB) state.intB = state.intA;
    sliderIntB.value = state.intB;
    updateModel();
  });
  sliderIntB.addEventListener('input', (e) => {
    state.intB = parseFloat(e.target.value);
    if (state.intB < state.intA) state.intA = state.intB;
    sliderIntA.value = state.intA;
    updateModel();
  });

  const sliderSlab = document.getElementById('slider-slab');
  sliderSlab.addEventListener('input', (e) => {
    state.slabThickness = parseFloat(e.target.value);
    document.getElementById('layer-slab').checked = state.slabThickness > 0.005;
    state.layers.slab = state.slabThickness > 0.005;
    updateSceneGeometry();
    updateHUD();
  });

  // 透视模式切换核心控制
  function setXrayMode(active) {
    state.xrayMode = active;
    const banner = document.getElementById('xray-banner');
    const btnXray = document.getElementById('btn-toggle-xray');
    const labelXray = document.getElementById('label-btn-xray');

    const isCutY = state.cutDir === 'y';
    const c = state.slicePos;

    if (state.xrayMode) {
      if (banner) banner.classList.remove('hidden');
      if (btnXray) {
        btnXray.classList.add('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-sm');
        btnXray.classList.remove('text-stone-800', 'hover:bg-white');
        if (labelXray) labelXray.innerText = '✓ 截面透视中 (点击恢复全景)';
      }

      // 视线平滑推进至截面正前透视角
      const camX = isCutY ? 0.4 : c - 6.5;
      const camY = isCutY ? c - 6.5 : 0.4;
      const targetX = isCutY ? 0.4 : c;
      const targetY = isCutY ? c : 0.4;

      gsap.to(camera.position, { x: camX, y: camY, z: 1.8, duration: 0.8, ease: 'power2.out' });
      gsap.to(controls.target, { x: targetX, y: targetY, z: 1.1, duration: 0.8, ease: 'power2.out' });
    } else {
      if (banner) banner.classList.add('hidden');
      if (btnXray) {
        btnXray.classList.remove('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-sm');
        btnXray.classList.add('text-stone-800', 'hover:bg-white');
        if (labelXray) labelXray.innerText = '透视 (仅显截面)';
      }

      // 恢复全景视角
      gsap.to(camera.position, { x: 6.5, y: -7.0, z: 5.5, duration: 0.8, ease: 'power2.out' });
      gsap.to(controls.target, { x: 0, y: 0, z: 0.8, duration: 0.8, ease: 'power2.out' });
    }

    updateSceneGeometry();
  }

  // 1. 透视按钮 (仅显截面关系)
  const btnToggleXray = document.getElementById('btn-toggle-xray');
  if (btnToggleXray) {
    btnToggleXray.addEventListener('click', () => {
      setXrayMode(!state.xrayMode);
    });
  }

  // 退出透视模式按键 (Banner 上)
  const btnExitXray = document.getElementById('btn-exit-xray');
  if (btnExitXray) {
    btnExitXray.addEventListener('click', () => {
      setXrayMode(false);
    });
  }

  // 2. 3D 全景模式按键
  const btnViewFull = document.getElementById('btn-view-full');
  if (btnViewFull) {
    btnViewFull.addEventListener('click', () => {
      setXrayMode(false);
    });
  }

  // 3. 兼容透视按键 (btn-view-persp)
  const btnViewPersp = document.getElementById('btn-view-persp');
  if (btnViewPersp) {
    btnViewPersp.addEventListener('click', () => {
      setXrayMode(!state.xrayMode);
    });
  }

  // 4. 正视截面按键
  const btnViewSlice = document.getElementById('btn-view-slice');
  if (btnViewSlice) {
    btnViewSlice.addEventListener('click', () => {
      setXrayMode(true);
      if (state.cutDir === 'y') {
        gsap.to(camera.position, { x: 0, y: state.slicePos - 6.8, z: 1.1, duration: 0.8, ease: 'power2.out' });
        gsap.to(controls.target, { x: 0, y: state.slicePos, z: 1.1, duration: 0.8, ease: 'power2.out' });
      } else {
        gsap.to(camera.position, { x: state.slicePos - 6.8, y: 0, z: 1.1, duration: 0.8, ease: 'power2.out' });
        gsap.to(controls.target, { x: state.slicePos, y: 0, z: 1.1, duration: 0.8, ease: 'power2.out' });
      }
    });
  }

  // 5. 俯视底面按键
  const btnViewTop = document.getElementById('btn-view-top');
  if (btnViewTop) {
    btnViewTop.addEventListener('click', () => {
      gsap.to(camera.position, { x: 0.01, y: -0.01, z: 9.5, duration: 0.8, ease: 'power2.out' });
      gsap.to(controls.target, { x: 0, y: 0, z: 0, duration: 0.8, ease: 'power2.out' });
    });
  }

  // Reset Camera View
  document.getElementById('btn-reset-cam').addEventListener('click', () => {
    setXrayMode(false);
    gsap.to(camera.position, { x: 6.5, y: -7.0, z: 5.5, duration: 0.8, ease: 'power2.out' });
    gsap.to(controls.target, { x: 0, y: 0, z: 0.8, duration: 0.8, ease: 'power2.out' });
  });

  // Auto Cruise Animation
  const btnPlay = document.getElementById('btn-play-scan');
  btnPlay.addEventListener('click', () => {
    state.isPlaying = !state.isPlaying;
    if (state.isPlaying) {
      document.getElementById('play-text').innerText = '暂停巡航';
      document.getElementById('play-icon').innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>';
    } else {
      document.getElementById('play-text').innerText = '自动巡航切片';
      document.getElementById('play-icon').innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>';
    }
  });

  // 2D Morphing Animation
  const btnMorph = document.getElementById('btn-morph-anim');
  btnMorph.addEventListener('click', () => {
    state.morphT = 0.0;
    gsap.fromTo(state, { morphT: 0.0 }, {
      morphT: 1.0,
      duration: 1.6,
      ease: 'power2.inOut',
      onUpdate: () => draw2DSlice()
    });
  });

  // Mobile drawer toggle
  const btnToggleExplain = document.getElementById('btn-toggle-explain');
  if (btnToggleExplain) {
    btnToggleExplain.addEventListener('click', () => {
      const p = document.getElementById('explain-panel');
      p.classList.toggle('hidden');
    });
  }
}

// 切换模型时重置参数配置
function resetModelParameters() {
  const cur = models[state.model];
  const sSlice = document.getElementById('slider-slice');
  sSlice.min = cur.sliceMin;
  sSlice.max = cur.sliceMax;
  sSlice.step = cur.sliceStep;
  sSlice.value = cur.defaultSlice;
  state.slicePos = cur.defaultSlice;

  const param2Box = document.getElementById('container-param2');
  if (state.model === 'normal') {
    param2Box.classList.remove('hidden');
    document.getElementById('label-param2').innerHTML = `<span class="w-2 h-2 rounded-full bg-indigo-600"></span> ${cur.param2Label}`;
    const sP2 = document.getElementById('slider-param2');
    sP2.min = cur.param2Min;
    sP2.max = cur.param2Max;
    sP2.step = cur.param2Step;
    sP2.value = cur.defaultParam2;
    state.param2 = cur.defaultParam2;
  } else {
    param2Box.classList.add('hidden');
  }

  // Set interval [a, b]
  state.intA = cur.defaultIntA;
  state.intB = cur.defaultIntB;
  document.getElementById('slider-int-a').value = state.intA;
  document.getElementById('slider-int-b').value = state.intB;

  updateModel();
}

function followSliceIfXray() {
  if (state.xrayMode) {
    const isCutY = state.cutDir === 'y';
    const c = state.slicePos;
    if (isCutY) {
      camera.position.y = c - 6.5;
      controls.target.y = c;
    } else {
      camera.position.x = c - 6.5;
      controls.target.x = c;
    }
  }
}

function updateModel() {
  followSliceIfXray();
  updateSceneGeometry();
  updateHUD();
  draw2DSlice();
  renderDerivations();
}

// --- Animation Loop ---
let cruiseDir = 1;
function animate() {
  requestAnimationFrame(animate);

  if (state.isPlaying) {
    const cur = models[state.model];
    const span = cur.sliceMax - cur.sliceMin;
    const speed = span * 0.004 * cruiseDir;
    state.slicePos += speed;

    if (state.slicePos >= cur.sliceMax) {
      state.slicePos = cur.sliceMax;
      cruiseDir = -1;
    } else if (state.slicePos <= cur.sliceMin) {
      state.slicePos = cur.sliceMin;
      cruiseDir = 1;
    }
    document.getElementById('slider-slice').value = state.slicePos;
    updateModel();
  }

  controls.update();
  renderer.render(scene, camera);
}
