/**
 * 边缘概率密度的几何本质 · 交互式三维可视化引擎
 * 核心几何看点：
 * 1. 截面面积 = 边缘概率密度 (Cavalieri 原理)
 * 2. 侧向投影 = 边缘分布曲线的形成
 * 3. 截面形状归一化 = 条件概率密度
 */

// --- Global State ---
const state = {
  model: 'normal',   // 'normal' | 'triangle' | 'ramp'
  cutDir: 'x',       // 'x' (cut by x = x0) | 'y' (cut by y = y0)
  slicePos: 0.50,    // current cut coordinate
  param2: 0.40,      // correlation rho for normal
  isPlaying: false,
  layers: {
    jointSurf: true,
    slicePlane: true,
    sliceArea: true,
    marginalWall: true,
    conditional: false
  }
};

// --- Three.js Variables ---
let scene, camera, renderer, controls;
let container;

const dynamicGroup = new THREE.Group();

// Display height scaling factor so probabilities (e.g. 0.16 ~ 0.5) look prominent in 3D
const Z_SCALE = 5.0;

// Materials Palette
const materials = {
  jointSurf: new THREE.MeshStandardMaterial({
    color: 0x4F46E5,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.3,
    metalness: 0.15,
    depthWrite: false
  }),
  jointWire: new THREE.MeshBasicMaterial({
    color: 0x3730A3,
    wireframe: true,
    transparent: true,
    opacity: 0.14
  }),
  slicePlane: new THREE.MeshStandardMaterial({
    color: 0x0D9488,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  slicePlaneEdge: new THREE.LineBasicMaterial({ color: 0x0D9488, linewidth: 2 }),
  sliceArea: new THREE.MeshStandardMaterial({
    color: 0xF59E0B,
    emissive: 0xD97706,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide
  }),
  sliceRidge: new THREE.LineBasicMaterial({ color: 0xB45309, linewidth: 3 }),
  marginalCurve: new THREE.LineBasicMaterial({ color: 0xE11D48, linewidth: 3 }),
  wallPlane: new THREE.MeshBasicMaterial({
    color: 0xF4F3EE,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide
  }),
  wallFrame: new THREE.LineBasicMaterial({ color: 0xD6D3CD }),
  postLine: new THREE.LineDashedMaterial({ color: 0xE11D48, dashSize: 0.15, gapSize: 0.08, linewidth: 2 }),
  postPoint: new THREE.MeshStandardMaterial({ color: 0xE11D48, emissive: 0xBE123C, emissiveIntensity: 0.5 }),
  condCurve: new THREE.LineBasicMaterial({ color: 0x2563EB, linewidth: 3 }),
  connectorLine: new THREE.LineDashedMaterial({ color: 0x6366F1, dashSize: 0.12, gapSize: 0.08, linewidth: 1 })
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

function initThree() {
  container = document.getElementById('canvas-container');
  THREE.Object3D.DefaultUp.set(0, 0, 1);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xFAF9F5);

  const aspect = container.clientWidth / container.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
  camera.position.set(7.8, -8.6, 6.2);
  camera.lookAt(0, 0, 0.6);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(0, 0, 0.6);
  controls.maxDistance = 28;
  controls.minDistance = 2;

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.80);
  scene.add(ambientLight);

  const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight1.position.set(10, 10, 14);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0xE2E8F0, 0.5);
  dirLight2.position.set(-10, -10, -4);
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
  const axisLen = 4.8;
  const radius = 0.016;

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

    const coneGeom = new THREE.ConeGeometry(radius * 3.0, radius * 6.0, 16);
    coneGeom.translate(0, radius * 3.0, 0);
    coneGeom.rotateX(Math.PI / 2);
    const coneMesh = new THREE.Mesh(coneGeom, mat);
    coneMesh.position.copy(p2);
    coneMesh.lookAt(p2.clone().add(dir.clone().normalize()));
    axesGroup.add(coneMesh);
  }

  createAxisLine(new THREE.Vector3(-axisLen * 0.7, 0, 0), new THREE.Vector3(axisLen, 0, 0), 0xDC2626);
  createAxisLine(new THREE.Vector3(0, -axisLen * 0.7, 0), new THREE.Vector3(0, axisLen, 0), 0x16A34A);
  createAxisLine(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, axisLen * 0.8), 0x4F46E5);

  axesGroup.add(createAxisLabel('+X', new THREE.Vector3(axisLen + 0.35, 0, 0), '#DC2626', true));
  axesGroup.add(createAxisLabel('+Y', new THREE.Vector3(0, axisLen + 0.35, 0), '#16A34A', true));
  axesGroup.add(createAxisLabel('z=f(x,y)', new THREE.Vector3(0, 0, axisLen * 0.8 + 0.35), '#4F46E5', true));

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
    let minVal, maxVal;
    if (state.model === 'normal') {
      minVal = -2.4; maxVal = 2.4;
    } else if (state.model === 'triangle') {
      minVal = 0.05; maxVal = 1.95;
    } else {
      minVal = 0.05; maxVal = 1.95;
    }

    state.slicePos += 0.016;
    if (state.slicePos > maxVal) state.slicePos = minVal;

    const slider = document.getElementById('slider-slice');
    if (slider) slider.value = state.slicePos.toFixed(2);
    const valSlice = document.getElementById('val-slice');
    if (valSlice) valSlice.innerText = state.slicePos.toFixed(2);

    updateGeometryOnly();
  }

  controls.update();
  renderer.render(scene, camera);
}

// ==========================================
// --- Mathematical Evaluation Functions ---
// ==========================================

const MathModels = {
  normal: {
    name: '二维正态分布',
    xRange: [-3.0, 3.0],
    yRange: [-3.0, 3.0],
    zMax: 0.35,
    joint(x, y, rho) {
      const denom = 2 * Math.PI * Math.sqrt(1 - rho * rho);
      const expo = -(x * x - 2 * rho * x * y + y * y) / (2 * (1 - rho * rho));
      return (1 / denom) * Math.exp(expo);
    },
    marginalX(x) {
      return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
    },
    marginalY(y) {
      return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * y * y);
    },
    condYgivenX(y, x, rho) {
      const mu = rho * x;
      const sigma = Math.sqrt(1 - rho * rho);
      return (1 / (Math.sqrt(2 * Math.PI) * sigma)) * Math.exp(-0.5 * Math.pow((y - mu) / sigma, 2));
    }
  },

  triangle: {
    name: '三角形域二维均匀分布',
    xRange: [0, 2.0],
    yRange: [0, 2.0],
    zMax: 0.55,
    joint(x, y) {
      // Domain: 0 <= x <= 2, 0 <= y <= 2 - x. Area = 2. Height = 0.5.
      if (x >= 0 && x <= 2.0 && y >= 0 && y <= (2.0 - x)) {
        return 0.5;
      }
      return 0.0;
    },
    marginalX(x) {
      if (x >= 0 && x <= 2.0) {
        return 0.5 * (2.0 - x); // = 1.0 - 0.5 * x
      }
      return 0.0;
    },
    marginalY(y) {
      if (y >= 0 && y <= 2.0) {
        return 0.5 * (2.0 - y); // = 1.0 - 0.5 * y
      }
      return 0.0;
    },
    condYgivenX(y, x) {
      if (x >= 0 && x < 2.0 && y >= 0 && y <= (2.0 - x)) {
        return 1 / (2.0 - x); // Uniform on [0, 2 - x]
      }
      return 0;
    }
  },

  ramp: {
    name: '斜坡分布 f(x,y)=(x+y)/8',
    xRange: [0, 2.0],
    yRange: [0, 2.0],
    zMax: 0.55,
    joint(x, y) {
      if (x >= 0 && x <= 2.0 && y >= 0 && y <= 2.0) {
        return (x + y) / 8.0;
      }
      return 0.0;
    },
    marginalX(x) {
      if (x >= 0 && x <= 2.0) {
        return (x + 1.0) / 4.0;
      }
      return 0.0;
    },
    marginalY(y) {
      if (y >= 0 && y <= 2.0) {
        return (y + 1.0) / 4.0;
      }
      return 0.0;
    },
    condYgivenX(y, x) {
      if (x >= 0 && x <= 2.0 && y >= 0 && y <= 2.0) {
        return ((x + y) / 8.0) / ((x + 1.0) / 4.0);
      }
      return 0.0;
    }
  }
};

// ==========================================
// --- 3D Scene Geometry Generation ---
// ==========================================

function updateModel() {
  while (dynamicGroup.children.length > 0) {
    const obj = dynamicGroup.children[0];
    dynamicGroup.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
  }

  buildJointSurface();
  buildSliceAndProjection();
  updateHUD();
  updateExplanationText();
}

function updateGeometryOnly() {
  // Remove temporary dynamic meshes (slice plane, area, post) while keeping base static if needed
  while (dynamicGroup.children.length > 0) {
    const obj = dynamicGroup.children[0];
    dynamicGroup.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
  }

  buildJointSurface();
  buildSliceAndProjection();
  updateHUDValues();
  updateExplanationText();
}

/**
 * Build Joint Probability Density Surface z = f(x, y)
 */
function buildJointSurface() {
  if (!state.layers.jointSurf) return;

  const m = MathModels[state.model];
  const rho = state.param2;

  const [xMin, xMax] = m.xRange;
  const [yMin, yMax] = m.yRange;

  const gridX = 50;
  const gridY = 50;
  const vertices = [];
  const indices = [];

  for (let i = 0; i <= gridX; i++) {
    const x = xMin + (xMax - xMin) * (i / gridX);
    for (let j = 0; j <= gridY; j++) {
      const y = yMin + (yMax - yMin) * (j / gridY);
      const density = m.joint(x, y, rho);
      const z = density * Z_SCALE;
      vertices.push(x, y, z);
    }
  }

  for (let i = 0; i < gridX; i++) {
    for (let j = 0; j < gridY; j++) {
      const a = i * (gridY + 1) + j;
      const b = (i + 1) * (gridY + 1) + j;
      const c = (i + 1) * (gridY + 1) + (j + 1);
      const d = i * (gridY + 1) + (j + 1);

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const surfMesh = new THREE.Mesh(geom, materials.jointSurf);
  const wireMesh = new THREE.Mesh(geom, materials.jointWire);
  dynamicGroup.add(surfMesh);
  dynamicGroup.add(wireMesh);

  // Label for Joint Density Surface
  const topZ = (state.model === 'normal' ? 0.28 : 0.5) * Z_SCALE;
  const peakPos = new THREE.Vector3(0, 0, topZ + 0.35);
  dynamicGroup.add(createAxisLabel('联合密度曲面 z = f(x, y)', peakPos, '#4F46E5'));
}

/**
 * Build Slicing Plane, Cross-sectional Area Ribbon, and Marginal Projection Wall
 */
function buildSliceAndProjection() {
  const m = MathModels[state.model];
  const rho = state.param2;
  const isCutX = state.cutDir === 'x';
  const cPos = state.slicePos;

  const [xMin, xMax] = m.xRange;
  const [yMin, yMax] = m.yRange;
  const zMaxDisplay = 0.65 * Z_SCALE;

  // ----------------------------------------------------
  // 1. Slicing Plane π
  // ----------------------------------------------------
  if (state.layers.slicePlane) {
    const planeGeom = new THREE.PlaneGeometry(
      isCutX ? (yMax - yMin + 0.4) : (xMax - xMin + 0.4),
      zMaxDisplay + 0.2
    );
    const planeMesh = new THREE.Mesh(planeGeom, materials.slicePlane);

    if (isCutX) {
      planeMesh.rotation.y = Math.PI / 2;
      planeMesh.position.set(cPos, (yMin + yMax) / 2, (zMaxDisplay + 0.2) / 2);
    } else {
      planeMesh.rotation.x = Math.PI / 2;
      planeMesh.position.set((xMin + xMax) / 2, cPos, (zMaxDisplay + 0.2) / 2);
    }
    dynamicGroup.add(planeMesh);

    // Outline Frame for Slicing Plane
    const edgeGeom = new THREE.EdgesGeometry(planeGeom);
    const edgeLine = new THREE.LineSegments(edgeGeom, materials.slicePlaneEdge);
    edgeLine.position.copy(planeMesh.position);
    edgeLine.rotation.copy(planeMesh.rotation);
    dynamicGroup.add(edgeLine);

    // Label on Slice Plane
    const labelPos = isCutX
      ? new THREE.Vector3(cPos, yMax + 0.3, zMaxDisplay * 0.7)
      : new THREE.Vector3(xMax + 0.3, cPos, zMaxDisplay * 0.7);
    dynamicGroup.add(createAxisLabel(isCutX ? `切片平面 x = ${cPos.toFixed(2)}` : `切片平面 y = ${cPos.toFixed(2)}`, labelPos, '#0D9488'));
  }

  // ----------------------------------------------------
  // 2. Cross-Sectional Area (Ribbon & Ridge)
  // ----------------------------------------------------
  const slicePoints = [];
  const numSteps = 70;
  const varMin = isCutX ? yMin : xMin;
  const varMax = isCutX ? yMax : xMax;

  let computedArea = 0;
  let prevV = varMin;
  let prevD = isCutX ? m.joint(cPos, varMin, rho) : m.joint(varMin, cPos, rho);

  for (let i = 0; i <= numSteps; i++) {
    const v = varMin + (varMax - varMin) * (i / numSteps);
    const density = isCutX ? m.joint(cPos, v, rho) : m.joint(v, cPos, rho);
    const z = density * Z_SCALE;

    if (isCutX) {
      slicePoints.push(new THREE.Vector3(cPos, v, z));
    } else {
      slicePoints.push(new THREE.Vector3(v, cPos, z));
    }

    // Trapezoidal numerical integration for live display
    if (i > 0) {
      computedArea += 0.5 * (prevD + density) * (v - prevV);
    }
    prevV = v;
    prevD = density;
  }

  // Cross-section Ribbon Mesh (filled area under the curve)
  if (state.layers.sliceArea) {
    const ribbonVerts = [];
    const ribbonIndices = [];

    for (let i = 0; i <= numSteps; i++) {
      const pt = slicePoints[i];
      // Bottom vertex on ground
      ribbonVerts.push(pt.x, pt.y, 0);
      // Top vertex on curve
      ribbonVerts.push(pt.x, pt.y, pt.z);
    }

    for (let i = 0; i < numSteps; i++) {
      const b1 = i * 2;
      const t1 = i * 2 + 1;
      const b2 = (i + 1) * 2;
      const t2 = (i + 1) * 2 + 1;

      ribbonIndices.push(b1, b2, t2);
      ribbonIndices.push(b1, t2, t1);
    }

    const ribbonGeom = new THREE.BufferGeometry();
    ribbonVerts.forEach((v, idx) => { ribbonVerts[idx] = v; });
    ribbonGeom.setAttribute('position', new THREE.Float32BufferAttribute(ribbonVerts, 3));
    ribbonGeom.setIndex(ribbonIndices);
    ribbonGeom.computeVertexNormals();

    const ribbonMesh = new THREE.Mesh(ribbonGeom, materials.sliceArea);
    dynamicGroup.add(ribbonMesh);

    // Top Ridge Outline
    const ridgeGeom = new THREE.BufferGeometry().setFromPoints(slicePoints);
    const ridgeLine = new THREE.Line(ridgeGeom, materials.sliceRidge);
    dynamicGroup.add(ridgeLine);

    // Area Label in center of slice
    const midIdx = Math.floor(numSteps / 2);
    const midPt = slicePoints[midIdx];
    const areaLabelPos = new THREE.Vector3(midPt.x, midPt.y, Math.max(0.2, midPt.z * 0.45));
    dynamicGroup.add(createAxisLabel(`截面面积 A = ${computedArea.toFixed(4)}`, areaLabelPos, '#D97706', true));
  }

  // ----------------------------------------------------
  // 3. Conditional Density Curve Overlay (Optional)
  // ----------------------------------------------------
  if (state.layers.conditional && computedArea > 0.005) {
    const condPoints = [];
    for (let i = 0; i <= numSteps; i++) {
      const v = varMin + (varMax - varMin) * (i / numSteps);
      const condVal = isCutX ? m.condYgivenX(v, cPos, rho) : m.condYgivenX(cPos, v, rho);
      const z = condVal * (Z_SCALE * 0.6); // scaled for clear view
      if (isCutX) {
        condPoints.push(new THREE.Vector3(cPos + 0.02, v, z));
      } else {
        condPoints.push(new THREE.Vector3(v, cPos + 0.02, z));
      }
    }
    const condGeom = new THREE.BufferGeometry().setFromPoints(condPoints);
    const condLine = new THREE.Line(condGeom, materials.condCurve);
    dynamicGroup.add(condLine);

    const midCondPt = condPoints[Math.floor(numSteps / 2)];
    dynamicGroup.add(createAxisLabel(isCutX ? `条件分布 f_{Y|X}(y|x₀)` : `条件分布 f_{X|Y}(x|y₀)`, midCondPt.clone().add(new THREE.Vector3(0, 0, 0.25)), '#2563EB', true));
  }

  // ----------------------------------------------------
  // 4. Marginal Projection Wall & Theoretical Curve
  // ----------------------------------------------------
  if (state.layers.marginalWall) {
    const wallDist = isCutX ? (yMin - 0.7) : (xMax + 0.7);

    // Projection Wall Board
    const wallWidth = isCutX ? (xMax - xMin + 0.6) : (yMax - yMin + 0.6);
    const wallHeight = zMaxDisplay + 0.4;
    const wallGeom = new THREE.PlaneGeometry(wallWidth, wallHeight);
    const wallMesh = new THREE.Mesh(wallGeom, materials.wallPlane);

    if (isCutX) {
      // Wall parallel to xOz
      wallMesh.position.set((xMin + xMax) / 2, wallDist, wallHeight / 2);
    } else {
      // Wall parallel to yOz
      wallMesh.rotation.y = Math.PI / 2;
      wallMesh.position.set(wallDist, (yMin + yMax) / 2, wallHeight / 2);
    }
    dynamicGroup.add(wallMesh);

    // Wall frame
    const wallEdgeGeom = new THREE.EdgesGeometry(wallGeom);
    const wallEdge = new THREE.LineSegments(wallEdgeGeom, materials.wallFrame);
    wallEdge.position.copy(wallMesh.position);
    wallEdge.rotation.copy(wallMesh.rotation);
    dynamicGroup.add(wallEdge);

    // Wall Title
    const wallTitlePos = isCutX
      ? new THREE.Vector3((xMin + xMax) / 2, wallDist - 0.05, wallHeight - 0.15)
      : new THREE.Vector3(wallDist + 0.05, (yMin + yMax) / 2, wallHeight - 0.15);
    dynamicGroup.add(createAxisLabel(isCutX ? '侧壁投影面: 边缘概率密度 f_X(x)' : '侧壁投影面: 边缘概率密度 f_Y(y)', wallTitlePos, '#E11D48'));

    // 1D Marginal Curve on Wall
    const margPoints = [];
    const margSteps = 80;
    for (let i = 0; i <= margSteps; i++) {
      const u = (isCutX ? xMin : yMin) + ((isCutX ? xMax - xMin : yMax - yMin)) * (i / margSteps);
      const mVal = isCutX ? m.marginalX(u) : m.marginalY(u);
      const z = mVal * Z_SCALE;
      if (isCutX) {
        margPoints.push(new THREE.Vector3(u, wallDist + 0.02, z));
      } else {
        margPoints.push(new THREE.Vector3(wallDist - 0.02, u, z));
      }
    }
    const margGeom = new THREE.BufferGeometry().setFromPoints(margPoints);
    const margLine = new THREE.Line(margGeom, materials.marginalCurve);
    dynamicGroup.add(margLine);

    // Indicator Post at current slice coordinate
    const theoreticalMarg = isCutX ? m.marginalX(cPos) : m.marginalY(cPos);
    const postHeight = theoreticalMarg * Z_SCALE;

    const postBase = isCutX ? new THREE.Vector3(cPos, wallDist + 0.02, 0) : new THREE.Vector3(wallDist - 0.02, cPos, 0);
    const postTop = isCutX ? new THREE.Vector3(cPos, wallDist + 0.02, postHeight) : new THREE.Vector3(wallDist - 0.02, cPos, postHeight);

    const postGeom = new THREE.BufferGeometry().setFromPoints([postBase, postTop]);
    const postLine = new THREE.Line(postGeom, materials.postLine);
    postLine.computeLineDistances();
    dynamicGroup.add(postLine);

    const pointTop = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), materials.postPoint);
    pointTop.position.copy(postTop);
    dynamicGroup.add(pointTop);

    // Connecting Ray between Slice Area centroid and Wall Post Point
    const sliceMidPt = isCutX
      ? new THREE.Vector3(cPos, (yMin + yMax) / 2, postHeight * 0.5)
      : new THREE.Vector3((xMin + xMax) / 2, cPos, postHeight * 0.5);
    const connGeom = new THREE.BufferGeometry().setFromPoints([sliceMidPt, postTop]);
    const connLine = new THREE.Line(connGeom, materials.connectorLine);
    connLine.computeLineDistances();
    dynamicGroup.add(connLine);

    dynamicGroup.add(createAxisLabel(
      isCutX ? `f_X(${cPos.toFixed(2)}) = ${theoreticalMarg.toFixed(4)}` : `f_Y(${cPos.toFixed(2)}) = ${theoreticalMarg.toFixed(4)}`,
      postTop.clone().add(new THREE.Vector3(0, 0, 0.28)),
      '#E11D48',
      true
    ));
  }
}

// ==========================================
// --- HUD & Dynamic Math Text Generators ---
// ==========================================

function updateHUD() {
  const m = MathModels[state.model];
  const isCutX = state.cutDir === 'x';
  const cPos = state.slicePos;
  const rho = state.param2;

  const modelBadge = document.getElementById('hud-model-badge');
  const jointFormula = document.getElementById('hud-joint-formula');
  const sliceFormula = document.getElementById('hud-slice-formula');

  if (state.model === 'normal') {
    modelBadge.innerText = `二维正态分布 N(0, 0, 1, 1, ρ=${rho.toFixed(2)})`;
    modelBadge.className = 'subtle-badge bg-blue-50 text-blue-700 border-blue-200';
    jointFormula.innerText = 'f(x, y) = 1/(2π√(1-ρ²)) exp(-q/2)';
    sliceFormula.innerText = isCutX ? `平面 x = ${cPos.toFixed(2)}` : `平面 y = ${cPos.toFixed(2)}`;
  } else if (state.model === 'triangle') {
    modelBadge.innerText = '三角形域均匀分布 U(D)';
    modelBadge.className = 'subtle-badge bg-amber-50 text-amber-800 border-amber-200';
    jointFormula.innerText = 'f(x, y) = 0.5 在直角三角形 D 内';
    sliceFormula.innerText = isCutX ? `平面 x = ${cPos.toFixed(2)} (y∈[0, 2-x])` : `平面 y = ${cPos.toFixed(2)} (x∈[0, 2-y])`;
  } else {
    modelBadge.innerText = '斜坡多项式分布 f(x,y)=(x+y)/8';
    modelBadge.className = 'subtle-badge bg-indigo-50 text-indigo-700 border-indigo-200';
    jointFormula.innerText = 'f(x, y) = (x + y)/8 在 [0, 2]² 内';
    sliceFormula.innerText = isCutX ? `平面 x = ${cPos.toFixed(2)}` : `平面 y = ${cPos.toFixed(2)}`;
  }

  updateHUDValues();
}

function updateHUDValues() {
  const m = MathModels[state.model];
  const isCutX = state.cutDir === 'x';
  const cPos = state.slicePos;

  const areaVal = isCutX ? m.marginalX(cPos) : m.marginalY(cPos);
  const hudArea = document.getElementById('hud-area-val');
  const hudMarginal = document.getElementById('hud-marginal-val');
  const valSlice = document.getElementById('val-slice');
  const valParam2 = document.getElementById('val-param2');

  if (hudArea) hudArea.innerText = `A(${isCutX ? 'x₀' : 'y₀'}) = ${areaVal.toFixed(4)}`;
  if (hudMarginal) hudMarginal.innerText = `${isCutX ? 'f_X' : 'f_Y'}(${isCutX ? 'x₀' : 'y₀'}) = ${areaVal.toFixed(4)}`;
  if (valSlice) valSlice.innerText = cPos.toFixed(2);
  if (valParam2) valParam2.innerText = Number(state.param2).toFixed(2);
}

function updateExplanationText() {
  const container = document.getElementById('dynamic-derivation-content');
  if (!container) return;

  const isCutX = state.cutDir === 'x';
  const cPos = Number(state.slicePos);
  const rho = Number(state.param2);
  const m = MathModels[state.model];
  const margVal = isCutX ? m.marginalX(cPos) : m.marginalY(cPos);

  let html = '';

  // ----------------------------------------------------
  // Section 1: Universal Geometric Essence (Cavalieri)
  // ----------------------------------------------------
  html += `
    <div class="space-y-3">
      <div class="callout-box callout-tip">
        <strong>[!tip] 核心几何本质速记</strong><br>
        <strong>“联合密度是山峰，截面面积即边缘；侧向投影成曲线，切片归一出条件”</strong>
      </div>

      <div class="space-y-1.5">
        <h3 class="font-bold text-stone-900 text-xs flex items-center gap-1.5">
          <span class="w-1.5 h-3 bg-emerald-600 rounded-full"></span>
          §1 几何本质：从三维概率山峰到横截面面积
        </h3>
        <p class="text-stone-600 text-[11px]">
          在空间直角坐标系中，连续型随机变量 $(X, Y)$ 的联合概率密度函数 $z = f(x, y)$ 构成了一张<strong>三维曲面（概率山峰）</strong>。
          由全概率归一化性质，曲面下方与 $xOy$ 基底平面所围成的<strong>总体积恒等于 1</strong>：
        </p>
        <div class="formula-box text-center py-1">
          $$\\iint_{\\mathbb{R}^2} f(x, y) \\, dx \\, dy = \\text{空间立体总体积} = 1$$
        </div>
      </div>

      <!-- Cavalieri's Principle Box -->
      <div class="p-3 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1.5">
        <div class="font-semibold text-amber-950 text-[11px] flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-amber-600"></span>
          <span>祖暅原理 (Cavalieri 原理) 与切片面积对应：</span>
        </div>
        <p class="text-stone-700 text-[11px]">
          若我们用垂直于 $x$ 轴的活动平面 $x = x_0$ 去截该概率立体，截出的纵向薄片在几何上具有截面面积 $A(x_0)$：
        </p>
        <div class="formula-box text-center py-1 bg-white border-amber-200 font-semibold text-amber-900">
          $$A(x_0) = \\int_{-\\infty}^{+\\infty} f(x_0, y) \\, dy = f_X(x_0)$$
        </div>
        <p class="text-[10px] text-amber-800">
          <strong>核心结论：</strong>边缘概率密度 $f_X(x_0)$ 在几何数值上，<strong>恰好精确等于截面平面 $x = x_0$ 处的截面面积 (Cross-sectional Area)！</strong>
        </p>
      </div>
  `;

  // ----------------------------------------------------
  // Section 2: Model-specific Live Derivation
  // ----------------------------------------------------
  html += `
      <div class="p-3.5 rounded-xl bg-white border border-[#E5E4DC] space-y-2">
        <div class="flex items-center justify-between">
          <span class="font-bold text-stone-900 text-[11px]">§2 当前模型实时解析推导 (${m.name})</span>
          <span class="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">动态联动中</span>
        </div>
  `;

  if (state.model === 'normal') {
    html += `
        <p class="text-stone-600 text-[11px]">
          设 $(X, Y) \\sim N(0, 0, 1, 1, \\rho=${rho.toFixed(2)})$。当前截面位置为 $x_0 = ${cPos.toFixed(2)}$。
        </p>
        <div class="space-y-1.5 pt-1 text-[11px]">
          <div class="font-semibold text-stone-800">步骤拆解：</div>
          <ol class="list-decimal list-inside space-y-1 text-stone-600 pl-1">
            <li>
              <strong>写出截面截线方程：</strong>固定 $x = ${cPos.toFixed(2)}$，关于 $y$ 的单变量截线曲线为：
              <div class="formula-box py-1 text-[10px]">
                $$z(y) = f(${cPos.toFixed(2)}, y) = \\frac{1}{2\\pi\\sqrt{1-\\rho^2}} \\exp\\left( -\\frac{${cPos.toFixed(2)}^2 - 2\\rho(${cPos.toFixed(2)})y + y^2}{2(1-\\rho^2)} \\right)$$
              </div>
            </li>
            <li>
              <strong>因式分解与条件概率剥离：</strong>
              配方整理指数项，截线可严格分解为<strong>“常数项 $\\times$ 条件正态密度”</strong>：
              <div class="formula-box py-1 text-[10px]">
                $$f(x_0, y) = \\underbrace{\\frac{1}{\\sqrt{2\\pi}} e^{-\\frac{x_0^2}{2}}}_{\\text{截面总面积 } f_X(x_0)} \\times \\underbrace{\\frac{1}{\\sqrt{2\\pi(1-\\rho^2)}} \\exp\\left(-\\frac{(y - \\rho x_0)^2}{2(1-\\rho^2)}\\right)}_{\\text{条件密度 } f_{Y|X}(y|x_0) \\text{，积分恒为 1}}$$
              </div>
            </li>
            <li>
              <strong>积分求面积：</strong>因为条件正态密度对 $y$ 从 $-\\infty$ 到 $+\\infty$ 积分为 1，所以截面面积直接等于前置项：
              <div class="formula-box py-1 text-[11px] font-bold text-rose-800 bg-rose-50/50 border-rose-200">
                $$A(${cPos.toFixed(2)}) = f_X(${cPos.toFixed(2)}) = \\frac{1}{\\sqrt{2\\pi}} e^{-\\frac{(${cPos.toFixed(2)})^2}{2}} \\approx ${margVal.toFixed(4)}$$
              </div>
            </li>
          </ol>
        </div>
    `;
  } else if (state.model === 'triangle') {
    const boundY = Math.max(0, 2.0 - cPos).toFixed(2);
    html += `
        <p class="text-stone-600 text-[11px]">
          区域 $D$ 为直角三角形 $0 \\le x \\le 2, 0 \\le y \\le 2 - x$，高为 $0.5$（总体积为 $2 \\times 0.5 = 1$）。
        </p>
        <div class="space-y-1.5 pt-1 text-[11px]">
          <div class="font-semibold text-stone-800">考研典型步骤拆解：</div>
          <ol class="list-decimal list-inside space-y-1 text-stone-600 pl-1">
            <li>
              <strong>确定截面区间：</strong>在 $x_0 = ${cPos.toFixed(2)}$ 处，平行于 $y$ 轴画穿线，底端入点 $y=0$，顶端出点 $y = 2 - ${cPos.toFixed(2)} = ${boundY}$。
            </li>
            <li>
              <strong>截面几何形状：</strong>由于联合密度在三角形内恒为常数 $0.5$，截面是一个<strong>矩形</strong>！
              <ul class="list-disc list-inside pl-3 pt-0.5 text-stone-500">
                <li>矩形高度：$h = 0.5$</li>
                <li>矩形底宽：$w = 2 - x_0 = ${boundY}$</li>
              </ul>
            </li>
            <li>
              <strong>矩形底乘以高求面积：</strong>
              <div class="formula-box py-1 text-[11px] font-bold text-amber-900 bg-amber-50/60 border-amber-200">
                $$A(x_0) = w \\times h = (2 - x_0) \\times 0.5 = 1 - \\frac{x_0}{2} = ${margVal.toFixed(4)}$$
              </div>
              积分计算 $\\int_0^{2-x_0} 0.5 \\, dy = 0.5(2 - x_0)$ 与初等矩形面积毫无二致！
            </li>
          </ol>
        </div>
    `;
  } else {
    // Ramp
    const leftZ = (cPos / 8.0).toFixed(4);
    const rightZ = ((cPos + 2.0) / 8.0).toFixed(4);
    html += `
        <p class="text-stone-600 text-[11px]">
          区域为正方形 $[0, 2]^2$，联合密度 $f(x, y) = \\frac{x + y}{8}$。当前截面 $x_0 = ${cPos.toFixed(2)}$。
        </p>
        <div class="space-y-1.5 pt-1 text-[11px]">
          <div class="font-semibold text-stone-800">梯形截面面积解析：</div>
          <ol class="list-decimal list-inside space-y-1 text-stone-600 pl-1">
            <li>
              截线在 $y \\in [0, 2]$ 上是一条倾斜直线，围成一个标准<strong>直角梯形</strong>：
              <ul class="list-disc list-inside pl-3 text-stone-500">
                <li>左底高：$z(0) = \\frac{${cPos.toFixed(2)}}{8} = ${leftZ}$</li>
                <li>右底高：$z(2) = \\frac{${cPos.toFixed(2)} + 2}{8} = ${rightZ}$</li>
                <li>梯形高（底宽）：$2.0$</li>
              </ul>
            </li>
            <li>
              根据初中梯形面积公式：
              <div class="formula-box py-1 text-[11px] font-bold text-indigo-900 bg-indigo-50/60 border-indigo-200">
                $$A(x_0) = \\frac{\\text{左高} + \\text{右高}}{2} \\times \\text{底宽} = \\frac{\\frac{x_0}{8} + \\frac{x_0+2}{8}}{2} \\times 2 = \\frac{x_0 + 1}{4} = ${margVal.toFixed(4)}$$
              </div>
              定积分 $\\int_0^2 \\frac{x_0+y}{8} \\, dy = \\frac{x_0+1}{4}$ 与几何梯形面积严格同一！
            </li>
          </ol>
        </div>
    `;
  }

  html += `
      </div>

      <!-- Section 3: Marginal origin -->
      <div class="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
        <h4 class="font-bold text-stone-900 text-xs flex items-center gap-1.5">
          <span class="w-1.5 h-3 bg-rose-600 rounded-full"></span>
          §3 为什么叫“边缘 (Marginal)”？——从表格边框到三维侧面投影
        </h4>
        <p class="text-stone-600 text-[11px]">
          <strong>离散起源：</strong>在二维列联表（Contingency Table）中，若将每一行的联合概率求和，结果写在表格的最右侧边缘空白处（Margin）；每一列求和写在最下方边缘。因此得名“边缘分布”。<br>
          <strong>连续跃迁：</strong>在三维连续空间中，对 $y$ 方向积分，就相当于从侧面正视整个概率山峰，将山峰沿 $y$ 方向“压缩 / 压扁 / 投影”到侧壁 $xOz$ 坐标面上。每个截面面积的高度在侧壁连成一条连续曲线，即为一维边缘密度 $f_X(x)$！
        </p>
      </div>

      <!-- Section 4: Conditional vs Marginal -->
      <div class="callout-box callout-note">
        <strong>§4 条件分布与边缘分布的“一体两面”</strong><br>
        由概率乘法公式：$f(x, y) = f_X(x) \\cdot f_{Y|X}(y \\mid x)$<br>
        - **截面自身的几何形态**（归一化为面积 1） $\\implies$ <strong>条件概率密度 $f_{Y|X}(y \\mid x)$</strong>；<br>
        - **截面的总体积/缩放系数** $\\implies$ <strong>边缘概率密度 $f_X(x)$</strong>。<br>
        勾选右上角【条件分布归一化】，即可直观看到切片被“拉伸”归一化为 1 的形状！
      </div>

      <!-- Section 5: Exam tips -->
      <div class="p-3 rounded-xl bg-white border border-[#E5E4DC] space-y-1.5">
        <div class="font-semibold text-stone-900 text-xs flex items-center gap-1.5">
          <span class="px-1.5 py-0.5 rounded bg-stone-100 font-mono text-[10px]">考研通法</span>
          求边缘密度的两步“穿线法”几何本质
        </div>
        <ol class="list-decimal list-inside space-y-1 text-[11px] text-stone-600 pl-1">
          <li><strong>确定外层 $x$ 的范围：</strong>观察曲面在底面 $xOy$ 的全域投影区间（截面能够切到曲面的 $x$ 区间）。</li>
          <li><strong>在截面内画穿线求上下限：</strong>作平行于 $y$ 轴的射线，穿入底面边界为下限 $y_1(x)$，穿出边界为上限 $y_2(x)$。此积分区间即为该切片在 $y$ 轴上的实际跨度！</li>
        </ol>
      </div>
    </div>
  `;

  container.innerHTML = html;

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
  const tabNormal = document.getElementById('tab-preset-normal');
  const tabTriangle = document.getElementById('tab-preset-triangle');
  const tabRamp = document.getElementById('tab-preset-ramp');

  const containerParam2 = document.getElementById('container-param2');
  const sliderSlice = document.getElementById('slider-slice');

  function setModel(modelKey) {
    state.model = modelKey;
    [tabNormal, tabTriangle, tabRamp].forEach(t => {
      t.classList.remove('active');
      t.classList.add('text-stone-600');
    });

    if (modelKey === 'normal') {
      tabNormal.classList.add('active');
      tabNormal.classList.remove('text-stone-600');
      containerParam2.style.display = 'flex';
      sliderSlice.min = "-2.5";
      sliderSlice.max = "2.5";
      state.slicePos = 0.50;
      sliderSlice.value = "0.50";
    } else if (modelKey === 'triangle') {
      tabTriangle.classList.add('active');
      tabTriangle.classList.remove('text-stone-600');
      containerParam2.style.display = 'none';
      sliderSlice.min = "0.05";
      sliderSlice.max = "1.95";
      state.slicePos = 0.60;
      sliderSlice.value = "0.60";
    } else {
      tabRamp.classList.add('active');
      tabRamp.classList.remove('text-stone-600');
      containerParam2.style.display = 'none';
      sliderSlice.min = "0.05";
      sliderSlice.max = "1.95";
      state.slicePos = 0.80;
      sliderSlice.value = "0.80";
    }

    updateModel();
  }

  tabNormal.addEventListener('click', () => setModel('normal'));
  tabTriangle.addEventListener('click', () => setModel('triangle'));
  tabRamp.addEventListener('click', () => setModel('ramp'));

  // Direction Cut Toggle
  const btnCutX = document.getElementById('btn-cut-x');
  const btnCutY = document.getElementById('btn-cut-y');
  const labelSliderSlice = document.getElementById('label-slider-slice');

  btnCutX.addEventListener('click', () => {
    if (state.cutDir === 'x') return;
    state.cutDir = 'x';
    btnCutX.classList.add('active');
    btnCutX.classList.remove('text-stone-600');
    btnCutY.classList.remove('active');
    btnCutY.classList.add('text-stone-600');
    labelSliderSlice.innerHTML = '<span class="w-2 h-2 rounded-full bg-teal-600"></span>切片位置 $x_0$ (截面截线)';
    updateModel();
  });

  btnCutY.addEventListener('click', () => {
    if (state.cutDir === 'y') return;
    state.cutDir = 'y';
    btnCutY.classList.add('active');
    btnCutY.classList.remove('text-stone-600');
    btnCutX.classList.remove('active');
    btnCutX.classList.add('text-stone-600');
    labelSliderSlice.innerHTML = '<span class="w-2 h-2 rounded-full bg-teal-600"></span>切片位置 $y_0$ (截面截线)';
    updateModel();
  });

  // Sliders
  sliderSlice.addEventListener('input', (e) => {
    state.slicePos = parseFloat(e.target.value);
    updateGeometryOnly();
  });

  const sliderParam2 = document.getElementById('slider-param2');
  sliderParam2.addEventListener('input', (e) => {
    state.param2 = parseFloat(e.target.value);
    updateModel();
  });

  // Play / Pause Scan
  const btnPlay = document.getElementById('btn-play-scan');
  const playText = document.getElementById('play-text');
  btnPlay.addEventListener('click', () => {
    state.isPlaying = !state.isPlaying;
    if (state.isPlaying) {
      playText.innerText = '暂停扫描';
      btnPlay.classList.add('bg-amber-600');
      btnPlay.classList.remove('bg-stone-900');
    } else {
      playText.innerText = '自动扫描切片';
      btnPlay.classList.remove('bg-amber-600');
      btnPlay.classList.add('bg-stone-900');
    }
  });

  // Layer Toggles
  setupLayerToggle('layer-joint-surf', 'jointSurf');
  setupLayerToggle('layer-slice-plane', 'slicePlane');
  setupLayerToggle('layer-slice-area', 'sliceArea');
  setupLayerToggle('layer-marginal-wall', 'marginalWall');
  setupLayerToggle('layer-conditional', 'conditional');

  // Reset Camera View
  const btnResetCam = document.getElementById('btn-reset-cam');
  btnResetCam.addEventListener('click', () => {
    gsap.to(camera.position, {
      x: 7.8,
      y: -8.6,
      z: 6.2,
      duration: 1.0,
      ease: 'power2.out',
      onUpdate: () => controls.update()
    });
    gsap.to(controls.target, {
      x: 0,
      y: 0,
      z: 0.6,
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
    updateModel();
  });
}
