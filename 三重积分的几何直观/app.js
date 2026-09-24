/* Geometry follows the nested integral order. All progress is derived from one
   seekable clock, so rewinding never leaves geometry from a later step behind. */
(function () {
  'use strict';
  const M = window.IntegralModel;
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const METHODS = {
    projection: {
      title: '先穿一根线', durations: [7, 4, 17, 4], build: 2,
      steps: ['穿线', '线内密度', '铺满投影', '得到质量'],
      captions: ['从下到上，穿过单位球', '固定 (x₀, y₀)，沿 z 累加', '每个投影点，都对应一根竖线', '所有微柱的质量，合成整个体的质量'],
      descriptions: ['在投影面选一个点，沿 z 方向从下往上穿线。只有球内部分按体密度着色，球外统一为灰色。', '上下边界之间的颜色随密度变化。对 z 积分得到这根线上的密度累加；乘上小面积 dx dy，才是微柱质量。', '从投影中心向外铺开，每个位置都立起一根线。覆盖整个圆形投影 D 后，所有微柱恰好组成 Ω。', '让 dx dy 趋于零，有限根线的示意变成连续积分。完整球体轻亮一次，四种方法得到相同的质量。'],
      formula: String.raw`M=\iint_{D}\!\left[\int_{-\sqrt{1-x^2-y^2}}^{\sqrt{1-x^2-y^2}}\rho\,dz\right]dx\,dy`,
      element: 'dV = dz dx dy', note: 'D：x² + y² ≤ 1。下方投影面为便于观察，沿 z 轴向下平移显示。',
      inset: '俯视：xOy 投影面', massNote: '按已覆盖投影区域精确积分；根数只用于几何示意。'
    },
    section: {
      title: '先切出一个面', durations: [7, 4, 17, 4], build: 2,
      steps: ['切出平面', '面内密度', '沿轴叠满', '得到质量'],
      captions: ['在 z 轴选一点，作水平截面', '同一张面上，也有不同密度', '把 z ∈ [−1, 1] 的截面逐层叠满', '每张薄片的质量，共同组成 M'],
      descriptions: ['在 z = 0.30 处放入一个水平平面。平面与球相交的圆盘按密度着色，圆盘外仍为灰色。', '截面内先做二重积分，得到每单位厚度的质量。这里密度随离轴距离变化，不能直接用“面积 × 一个固定密度”。', '从球底 z = −1 向球顶 z = 1 连续推进。z 轴旁的进度段同步填满，每张截面都贡献一层薄片质量。', '对 z 再积分，所有薄片无缝组成球体。动画里的层间间隔，在积分极限中趋于零。'],
      formula: String.raw`M=\int_{-1}^{1}\!\left[\iint_{D_z}\rho\,dx\,dy\right]dz`,
      element: 'dV = dx dy dz', note: 'D_z：x² + y² ≤ 1 − z²。先面内累加，再乘厚度 dz。',
      inset: '投影到 z 轴：截面的位置', massNote: '按已扫过高度精确积分；截面积与密度共同决定增量。'
    },
    cylindrical: {
      title: '半径转出截面', durations: [5, 8, 3, 20, 4], build: 3,
      steps: ['画出 r', '旋转 θ', '截面完成', '沿 z 叠加', '得到质量'],
      captions: ['在 z = 0.30 的截面上，展开半径 r', '半径绕 z 轴旋转，扫出彩色圆盘', '一个完整截面形成', '不同高度的 r 依次旋转，组成所有截面', 'r、θ、z 三次累加，得到整个体'],
      descriptions: ['固定高度 z，从轴心沿半径 r 向球面展开。彩色部分位于球内，超出边界的延长线为灰色。', '令方位角 θ 从 0 增加到 2π。半径逐渐扫出一整张截面，颜色始终来自该位置的体密度。', '完整截面轻亮一次。小扇形的面积是 r dr dθ，所以 r 必须出现在积分中。', '沿 z 轴升高。每一层都演示“半径旋转成圆盘”，再继续下一层，最终覆盖 z ∈ [−1, 1]。', '这是“截面内用极坐标、截面外沿 z 累加”，也就是柱坐标法。把所有体积元的质量相加，得到 M。'],
      formula: String.raw`\begin{aligned}M&=\int_{-1}^{1}\!\int_0^{2\pi}\!\int_0^{\sqrt{1-z^2}}\rho_c\,r\,dr\,d\theta\,dz\\[5pt]\rho_c&=1+\frac z2+\frac{r^2}{2}\end{aligned}`,
      element: 'dV = r dr dθ dz', note: '极坐标用于每张水平截面；加入高度 z 后，构成柱坐标。ρ_c 是同一密度的柱坐标表达式。',
      inset: '截面俯视：r 扫过的角度 θ', massNote: '按当前薄层已扫角度加权累计；层间切换时质量连续。'
    },
    spherical: {
      title: '射线张成整个球', durations: [7, 9, 3, 19, 4], build: 3,
      steps: ['r 与 r′', '旋转 θ', '锥面完成', '张开 φ', '得到质量'],
      captions: ['画出 r，以及它在 xOy 面上的投影 r′', '固定 φ，r′ 转一圈，r 同时扫出锥面', '锥面由不同长度、不同密度的射线组成', '与 +z 轴的夹角 φ 从 0 张开到 π', '射线族覆盖整个球体，得到质量 M'],
      descriptions: ['r 是到原点的距离，φ 是 r 与 +z 轴的夹角。水平投影长度 r′ = r sinφ，虚线把空间端点与投影端点相连。', '让 r′ 在 xOy 面内绕 z 轴旋转。倾斜射线 r 同步旋转，扫出的彩色“面”是锥面；下面的投影是圆盘。', '固定 φ 的锥面轻亮一次。仅转 θ 还没有填满球体，必须继续改变倾角 φ。', '让 φ 从北极的 0 逐渐张开到南极的 π。不同倾角的锥面连续累加，填满上下两个半球。', '每个小体积有三条边：dr、r dφ、r sinφ dθ。相乘得到 r²sinφ dr dθ dφ，再乘密度就是微元质量。'],
      formula: String.raw`\begin{aligned}M&=\int_0^{\pi}\!\int_0^{2\pi}\!\int_0^1\rho_s\,r^2\sin\varphi\,dr\,d\theta\,d\varphi\\[5pt]\rho_s&=1+\frac{r\cos\varphi}{2}+\frac{r^2\sin^2\varphi}{2}\end{aligned}`,
      element: 'dV = r² sinφ dr dθ dφ', note: 'θ 为 xOy 面内方位角；φ 为与 +z 轴的夹角。固定 φ 扫出锥面，φ = π/2 时为圆盘。',
      inset: '侧视：r、r′ 与极角 φ', massNote: '按已张开的极角范围精确积分，包含 r² sinφ 权重。'
    }
  };
  const state = { method: 'projection', time: 0, playing: false, speed: 1 };
  let config = METHODS[state.method], total = 32, lastStep = -1;
  let scene, camera, renderer, controls, visual, base, filled, clouds, grayColumns, coloredColumns;
  let disk, plane, cone, projectedDisk, activeLine, projectedLine, connector, pointer, sweepRing, polarArc;
  let stack, guideAxis, axisProgress, projectionSurface, ghostBall, wireBall;
  const labels = {}, geometries = [], current = { step: 0, local: 0, fraction: 0, z: 0.3, theta: 0, phi: Math.PI / 3, radius: 0, mass: 0 };
  let palette;
  // Match CSS colors under the renderer's sRGB output; unconverted neutrals wash out.
  const sceneColor = hex => new THREE.Color(hex).convertSRGBToLinear();

  function colorAt(x, y, z) {
    const t = M.clamp((M.density(x, y, z) - 0.5) / 1.125) * 2;
    return palette[t < 1 ? 0 : 1].clone().lerp(palette[t < 1 ? 1 : 2], t < 1 ? t : t - 1);
  }
  function geometry(positions, colors) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometries.push(g);
    return g;
  }
  function material(opacity = 1, color = null) {
    return new THREE.MeshBasicMaterial({ vertexColors: !color, color: sceneColor(color || '#ffffff'), transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity >= 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  }
  function makeLine(points, color = '#9b9c9f', opacity = 1, dashed = false) {
    const g = geometry(points.flat());
    const mat = dashed ? new THREE.LineDashedMaterial({ color: sceneColor(color), transparent: true, opacity, dashSize: 0.035, gapSize: 0.025 }) : new THREE.LineBasicMaterial({ color: sceneColor(color), transparent: true, opacity });
    const line = new THREE.Line(g, mat);
    if (dashed) line.computeLineDistances();
    return line;
  }
  function circle(radius, z, color = '#a4a6a3', opacity = 0.4) {
    const points = Array.from({ length: 97 }, (_, i) => [radius * Math.cos(i / 96 * TAU), radius * Math.sin(i / 96 * TAU), z]);
    return makeLine(points, color, opacity);
  }
  function label(name, text, position, feature = false) {
    const el = document.createElement('span');
    el.className = feature ? 'axis-label feature' : 'axis-label';
    el.textContent = text;
    $('labels').appendChild(el);
    labels[name] = { el, position: new THREE.Vector3(...position), visible: true };
  }
  function moveLabel(name, position, text, visible = true) {
    const item = labels[name];
    item.position.set(...position);
    if (text !== undefined) item.el.textContent = text;
    item.visible = visible;
  }
  // Reusable parametric surface; positions/colors update in place when a sweep changes.
  function surface(nu, nv, opacity = 0.65) {
    const count = (nu + 1) * (nv + 1), positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), indices = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1;
      indices.push(a, b, c, b, c + 1, c);
    }
    const g = geometry(positions, colors);
    g.setIndex(indices);
    const mesh = new THREE.Mesh(g, material(opacity));
    mesh.frustumCulled = false;
    mesh.userData.update = (fn, colorFn = colorAt) => {
      const p = g.attributes.position.array, c = g.attributes.color.array;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const k = (j * (nu + 1) + i) * 3, q = fn(i / nu, j / nv), col = colorFn(...q);
        p.set(q, k); c.set([col.r, col.g, col.b], k);
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    };
    return mesh;
  }
  function updateDisk(mesh, z, radius, angle = TAU) {
    mesh.userData.update((u, v) => [radius * u * Math.cos(angle * v), radius * u * Math.sin(angle * v), z]);
  }
  function updateCone(phi, angle = TAU) {
    cone.userData.update((u, v) => {
      const p = M.sphericalPoint(u, angle * v, phi);
      return [p.x, p.y, p.z];
    });
  }
  // Thin tubes keep density gradients legible at every camera angle.
  function tube() {
    const mesh = surface(80, 6, 1);
    mesh.userData.set = (a, b, radius = 0.012, forceGray = false) => {
      const dir = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).normalize();
      const side = new THREE.Vector3(0, 0, 1);
      if (Math.abs(dir.z) > 0.95) side.set(1, 0, 0);
      side.cross(dir).normalize();
      const up = dir.clone().cross(side).normalize();
      mesh.userData.update((u, v) => {
        const c = Math.cos(v * TAU) * radius, s = Math.sin(v * TAU) * radius;
        return [a[0] + (b[0] - a[0]) * u + side.x * c + up.x * s, a[1] + (b[1] - a[1]) * u + side.y * c + up.y * s, a[2] + (b[2] - a[2]) * u + side.z * c + up.z * s];
      }, (x, y, z) => forceGray || !M.inside(x, y, z) ? sceneColor('#747d79') : colorAt(x, y, z));
    };
    return mesh;
  }
  function setSimpleLine(line, a, b) {
    const arr = line.geometry.attributes.position.array;
    arr.set(a, 0); arr.set(b, 3);
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    if (line.computeLineDistances) line.computeLineDistances();
  }
  function setRing(radius, z, color = '#059669', opacity = 0.7) {
    const arr = sweepRing.geometry.attributes.position.array;
    for (let i = 0; i <= 96; i++) arr.set([radius * Math.cos(i / 96 * TAU), radius * Math.sin(i / 96 * TAU), z], i * 3);
    sweepRing.geometry.attributes.position.needsUpdate = true;
    sweepRing.geometry.computeBoundingSphere();
    sweepRing.material.color.copy(sceneColor(color)); sweepRing.material.opacity = opacity;
  }
  function setup() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--scene').trim());
    camera = new THREE.PerspectiveCamera(37, 1, 0.01, 100);
    camera.up.set(0, 0, 1); camera.position.set(2.7, -4.1, 2.45);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.localClippingEnabled = true;
    $('scene').prepend(renderer.domElement);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, -0.05); controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 3; controls.maxDistance = 10; controls.enablePan = false;
    controls.minPolarAngle = 0.08; controls.maxPolarAngle = Math.PI - 0.08;
    base = new THREE.Group(); visual = new THREE.Group(); scene.add(base, visual);
    scene.add(new THREE.AmbientLight('#ffffff', 0.76));
    const light = new THREE.DirectionalLight('#ffffff', 0.60);
    light.position.set(-2, -4, 6); scene.add(light);
    for (const [a, b] of [[[-1.5, 0, 0], [1.55, 0, 0]], [[0, -1.5, 0], [0, 1.55, 0]], [[0, 0, -1.4], [0, 0, 1.55]]]) {
      base.add(makeLine([a, b], '#64716b', 0.9));
      const dir = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).normalize();
      base.add(new THREE.ArrowHelper(dir, new THREE.Vector3(...b).addScaledVector(dir, -0.05), 0.05, sceneColor('#64716b'), 0.07, 0.035));
    }
    label('x', 'x', [1.65, 0, 0]); label('y', 'y', [0, 1.65, 0]); label('z', 'z', [0, 0, 1.67]); label('origin', 'O', [-0.06, -0.04, -0.09]);
    label('main', '', [0, 0, 0], true); label('secondary', '', [0, 0, 0], true); label('third', '', [0, 0, 0], true); label('projection', 'Dxy（平移显示）', [-0.85, -0.7, -1.25], true);
    wireBall = new THREE.Group();
    for (let j = -3; j <= 3; j++) { const z = j / 4; wireBall.add(circle(Math.sqrt(1 - z * z), z, '#61776c', 0.42)); }
    for (let j = 0; j < 6; j++) {
      const angle = j / 6 * Math.PI;
      wireBall.add(makeLine(Array.from({ length: 97 }, (_, i) => [Math.sin(i / 96 * TAU) * Math.cos(angle), Math.sin(i / 96 * TAU) * Math.sin(angle), Math.cos(i / 96 * TAU)]), '#61776c', 0.42));
    }
    base.add(wireBall);
    ghostBall = surface(56, 32, 0.10);
    ghostBall.userData.update((u, v) => [Math.sin(v * Math.PI) * Math.cos(u * TAU), Math.sin(v * Math.PI) * Math.sin(u * TAU), Math.cos(v * Math.PI)]);
    base.add(ghostBall);
    const solidGeometry = new THREE.SphereGeometry(1, 64, 40), solidColors = [];
    const solidPositions = solidGeometry.attributes.position;
    for (let i = 0; i < solidPositions.count; i++) {
      const c = colorAt(solidPositions.getX(i), solidPositions.getY(i), solidPositions.getZ(i));
      solidColors.push(c.r, c.g, c.b);
    }
    solidGeometry.setAttribute('color', new THREE.Float32BufferAttribute(solidColors, 3));
    filled = new THREE.Mesh(solidGeometry, new THREE.MeshLambertMaterial({ vertexColors: true })); filled.visible = false; visual.add(filled);
    const floor = new THREE.Group();
    const gridPoints = [];
    for (let i = -6; i <= 6; i++) { const v = i / 5; gridPoints.push(-1.2, v, -1.225, 1.2, v, -1.225, v, -1.2, -1.225, v, 1.2, -1.225); }
    floor.add(new THREE.LineSegments(geometry(gridPoints), new THREE.LineBasicMaterial({ color: sceneColor('#9daaa1'), transparent: true, opacity: 0.45 })));
    floor.add(circle(1, -1.22, '#718b85', 0.65));
    projectionSurface = surface(18, 72, 0.22); updateDisk(projectionSurface, -1.223, 1);
    projectionSurface.material.dispose(); projectionSurface.material = material(0.10, '#059669');
    floor.add(projectionSurface); base.add(floor); base.userData.floor = floor;
    disk = surface(24, 96, 0.75); visual.add(disk);
    cone = surface(24, 96, 0.68); visual.add(cone);
    projectedDisk = surface(18, 72, 0.15); visual.add(projectedDisk);
    plane = new THREE.Mesh(new THREE.PlaneGeometry(2.55, 2.55), material(0.25, '#7c8881')); visual.add(plane);
    activeLine = tube(); projectedLine = tube(); visual.add(activeLine, projectedLine);
    connector = makeLine([[0, 0, 0], [0, 0, 1]], '#747a7a', 0.8, true); visual.add(connector);
    pointer = new THREE.Mesh(new THREE.SphereGeometry(0.029, 12, 10), new THREE.MeshBasicMaterial({ color: '#292524' })); visual.add(pointer);
    sweepRing = circle(1, 0); visual.add(sweepRing);
    polarArc = makeLine(Array.from({ length: 65 }, () => [0, 0, 0]), '#292524', 0.8); polarArc.frustumCulled = false; visual.add(polarArc);
    guideAxis = makeLine([[1.35, 0, -1], [1.35, 0, 1]], '#8c9890', 1); base.add(guideAxis);
    axisProgress = makeLine([[1.35, 0, -1], [1.35, 0, -1]], '#059669', 1); visual.add(axisProgress);
    stack = new THREE.Group(); visual.add(stack);
    for (let j = 0; j < 32; j++) {
      const z = -1 + (j + 0.5) / 16, radius = Math.sqrt(1 - z * z);
      const layer = surface(10, 48, 0.20); updateDisk(layer, z, radius); layer.visible = false; stack.add(layer);
    }
    buildColumns(); buildClouds();
    new ResizeObserver(() => {
      const w = $('scene').clientWidth, h = $('scene').clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      drawInset();
    }).observe($('scene'));
    $('scene').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) return;
      event.preventDefault(); event.stopPropagation();
      const offset = camera.position.clone().sub(controls.target), spherical = new THREE.Spherical().setFromVector3(offset.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      if (event.code === 'ArrowLeft') spherical.theta -= 0.1;
      if (event.code === 'ArrowRight') spherical.theta += 0.1;
      if (event.code === 'ArrowUp') spherical.phi -= 0.1;
      if (event.code === 'ArrowDown') spherical.phi += 0.1;
      spherical.phi = M.clamp(spherical.phi, 0.08, Math.PI - 0.08);
      camera.position.copy(new THREE.Vector3().setFromSpherical(spherical).applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2).add(controls.target));
      controls.update();
    });
  }
  function buildColumns() {
    const pos = [], colors = [], outside = [], points = [];
    const N = 650, segments = 32;
    for (let i = 0; i < N; i++) {
      const r = Math.sqrt((i + 0.5) / N), angle = i * 2.399963229728653;
      const x = r * Math.cos(angle), y = r * Math.sin(angle), h = M.halfHeight(x, y);
      points.push({ x, y, r });
      outside.push(x, y, -1.22, x, y, -h, x, y, h, x, y, 1.2);
      for (let k = 0; k < segments; k++) for (const dz of [k, k + 1]) {
        const z = -h + dz / segments * 2 * h, col = colorAt(x, y, z);
        pos.push(x, y, z); colors.push(col.r, col.g, col.b);
      }
    }
    coloredColumns = new THREE.LineSegments(geometry(pos, colors), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }));
    grayColumns = new THREE.LineSegments(geometry(outside), new THREE.LineBasicMaterial({ color: sceneColor('#747d79'), transparent: true, opacity: 0.22 }));
    coloredColumns.userData = { count: N, segments, points };
    visual.add(coloredColumns, grayColumns);
  }
  function buildClouds() {
    const voxels = [];
    for (let z = -0.975; z <= 0.975; z += 0.065) for (let y = -0.975; y <= 0.975; y += 0.065) for (let x = -0.975; x <= 0.975; x += 0.065) if (M.inside(x, y, z)) {
      const radius = Math.hypot(x, y, z);
      voxels.push({ x, y, z, r: Math.hypot(x, y), phi: Math.acos(M.clamp(z / (radius || 1), -1, 1)), col: colorAt(x, y, z) });
    }
    clouds = {};
    for (const method of ['projection', 'section', 'spherical']) {
      const key = method === 'projection' ? 'r' : method === 'spherical' ? 'phi' : 'z';
      const ordered = [...voxels].sort((a, b) => a[key] - b[key]);
      const positions = [], colors = [];
      ordered.forEach(p => { positions.push(p.x, p.y, p.z); colors.push(p.col.r, p.col.g, p.col.b); });
      const points = new THREE.Points(geometry(positions, colors), new THREE.PointsMaterial({ vertexColors: true, size: 0.038, transparent: true, opacity: 0.33, depthWrite: false, sizeAttenuation: true }));
      points.userData.thresholds = ordered.map(p => p[key]);
      points.visible = false; visual.add(points); clouds[method] = points;
    }
  }
  function revealCloud(method, fraction, thresholdOverride) {
    const key = method === 'cylindrical' ? 'section' : method;
    const cloud = clouds[key], values = cloud.userData.thresholds;
    const threshold = thresholdOverride === undefined ? (key === 'projection' ? fraction : key === 'spherical' ? fraction * Math.PI : fraction * 2 - 1) : thresholdOverride;
    let lo = 0, hi = values.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid] <= threshold) lo = mid + 1; else hi = mid; }
    cloud.geometry.setDrawRange(0, lo); cloud.visible = true;
  }
  function getStep() {
    let start = 0;
    for (let i = 0; i < config.durations.length; i++) {
      const duration = config.durations[i];
      if (state.time < start + duration || i === config.durations.length - 1) return { step: i, local: M.clamp((state.time - start) / duration) };
      start += duration;
    }
  }
  function pulse(local) { return reducedMotion.matches ? 0 : Math.sin(Math.PI * M.clamp(local / 0.65)) ** 2; }
  function updateGeometry() {
    const { step, local } = getStep();
    Object.assign(current, { step, local, fraction: step < config.build ? 0 : step === config.build ? local : 1, z: 0.3, theta: 0, phi: Math.PI / 3 });
    const final = step === config.durations.length - 1;
    for (const object of visual.children) object.visible = false;
    ['main', 'secondary', 'third'].forEach(name => { labels[name].visible = false; });
    labels.projection.visible = state.method === 'projection';
    base.userData.floor.visible = state.method === 'projection';
    guideAxis.visible = ['section', 'cylindrical'].includes(state.method);
    ghostBall.material.opacity = final ? 0 : 0.10;
    wireBall.visible = !final;
    if (state.method === 'projection') renderProjection(step, local);
    if (state.method === 'section') renderSection(step, local);
    if (state.method === 'cylindrical') renderCylindrical(step, local);
    if (state.method === 'spherical') renderSpherical(step, local);
    if (final) {
      Object.values(clouds).forEach(cloud => { cloud.visible = false; });
      stack.visible = coloredColumns.visible = grayColumns.visible = false;
      filled.visible = true;
      filled.material.color.setRGB(1 + pulse(local) * 0.35, 1 + pulse(local) * 0.35, 1 + pulse(local) * 0.35);
      labels.main.visible = labels.secondary.visible = labels.third.visible = false;
    }
    current.mass = state.method === 'cylindrical' ? cylindricalMass() : M.accumulatedMass(state.method, current.fraction);
    updateUI(); drawInset();
  }
  function renderProjection(step, t) {
    const x = 0.45, y = 0.18, h = M.halfHeight(x, y);
    if (step <= 1) {
      activeLine.visible = pointer.visible = connector.visible = true;
      const end = step === 0 ? -1.3 + 2.6 * t : 1.3;
      activeLine.userData.set([x, y, -1.3], [x, y, Math.max(-1.299, end)], 0.014);
      pointer.position.set(x, y, end);
      setSimpleLine(connector, [x, y, -1.3], [x, y, 1.3]);
      moveLabel('main', [x + 0.13, y, h + 0.10], '上界 z₂(x,y)');
      moveLabel('secondary', [x + 0.13, y, -h - 0.08], '下界 z₁(x,y)');
      moveLabel('third', [x, y, -1.38], '(x₀, y₀)');
    }
    if (step >= 2) {
      const fraction = current.fraction;
      const n = Math.floor(coloredColumns.userData.count * fraction * fraction);
      coloredColumns.visible = grayColumns.visible = true;
      coloredColumns.geometry.setDrawRange(0, n * coloredColumns.userData.segments * 2);
      grayColumns.geometry.setDrawRange(0, n * 4);
      revealCloud('projection', fraction);
      sweepRing.visible = true; setRing(fraction, -1.215);
      updateDisk(projectionSurface, -1.223, fraction);
    } else updateDisk(projectionSurface, -1.223, 1);
  }
  function renderSection(step, t) {
    const z = step < 2 ? 0.3 : -1 + 2 * current.fraction;
    current.z = z;
    if (step < 3) {
      plane.visible = disk.visible = sweepRing.visible = true;
      const shift = step === 0 ? 1.7 * (1 - t) ** 2 : 0;
      plane.position.set(shift, 0, z);
      // The entering plane is clipped by the same sphere rather than carrying a translated disk.
      disk.userData.update((u, v) => {
        const radius = Math.sqrt(Math.max(0, 1 - z * z));
        return [radius * u * Math.cos(v * TAU), radius * u * Math.sin(v * TAU), z];
      });
      disk.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 1.275 - shift), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1.275 + shift)];
      sweepRing.visible = shift < 0.1;
      setRing(Math.sqrt(Math.max(0, 1 - z * z)), z);
      moveLabel('main', [1.3 + shift, -0.15, z + 0.06], `z = ${z.toFixed(2)}`);
      pointer.visible = true; pointer.position.set(0, 0, z);
    }
    axisProgress.visible = true;
    setSimpleLine(axisProgress, [1.35, 0, -1], [1.35, 0, step < 2 ? -1 : z]);
    if (step >= 2) {
      stack.visible = true;
      stack.children.forEach(layer => { layer.visible = layer.geometry.attributes.position.array[2] <= z; });
      revealCloud('section', current.fraction);
    }
  }
  function renderCylindrical(step, t) {
    let z = 0.3, theta = step === 0 ? 0 : step === 1 ? t * TAU : TAU;
    if (step >= 3) {
      const layerProgress = current.fraction * 24;
      const layer = Math.min(23, Math.floor(layerProgress));
      z = -1 + (layer + 0.5) * 2 / 24;
      theta = current.fraction >= 1 ? TAU : (layerProgress - layer) * TAU;
      stack.visible = true;
      // Completed disks use the same 24-bin spacing as the running disk.
      stack.children.forEach((mesh, j) => {
        mesh.visible = j < layer && j < 24;
        if (mesh.visible) { const layerZ = -1 + (j + 0.5) * 2 / 24; updateDisk(mesh, layerZ, Math.sqrt(1 - layerZ * layerZ)); }
      });
      revealCloud('cylindrical', current.fraction, -1 + layer * 2 / 24);
      axisProgress.visible = true;
      setSimpleLine(axisProgress, [1.35, 0, -1], [1.35, 0, -1 + current.fraction * 2]);
    }
    current.z = z; current.theta = theta;
    const radius = Math.sqrt(1 - z * z), length = step === 0 ? Math.max(0.001, 1.25 * t) : 1.25;
    if (step < 4) {
      disk.visible = step > 0; updateDisk(disk, z, radius, theta);
      disk.material.opacity = step === 2 ? 0.72 + 0.25 * pulse(t) : 0.75;
      activeLine.visible = pointer.visible = sweepRing.visible = true;
      activeLine.userData.set([0, 0, z], [length * Math.cos(theta), length * Math.sin(theta), z]);
      pointer.position.set(radius * Math.cos(theta), radius * Math.sin(theta), z);
      setRing(radius, z, '#949c97', 0.45);
      moveLabel('main', [radius * 0.55 * Math.cos(theta), radius * 0.55 * Math.sin(theta), z + 0.1], 'r');
      moveLabel('secondary', [0, 0, z + 0.15], `z = ${z.toFixed(2)}`);
    }
  }
  function cylindricalMass() {
    if (current.step < 3) return 0;
    if (current.fraction >= 1) return M.totalMass;
    const layerProgress = current.fraction * 24, layer = Math.floor(layerProgress), angleFraction = layerProgress - layer;
    const lower = M.accumulatedMass('section', layer / 24), upper = M.accumulatedMass('section', (layer + 1) / 24);
    return lower + (upper - lower) * angleFraction;
  }
  function renderSpherical(step, t) {
    const phi = step < 3 ? Math.PI / 3 : Math.PI * current.fraction;
    const theta = step === 1 ? t * TAU : step < 1 ? 0 : TAU;
    const length = step === 0 ? M.clamp(t * 2) : 1;
    current.phi = phi; current.theta = theta;
    const p = M.sphericalPoint(Math.max(length, 0.001), theta, phi);
    const projectionProgress = step === 0 ? M.clamp((t - 0.4) / 0.6) : 1;
    if (step < 4) {
      activeLine.visible = projectedLine.visible = connector.visible = pointer.visible = true;
      activeLine.userData.set([0, 0, 0], [p.x, p.y, p.z], 0.013);
      projectedLine.userData.set([0, 0, 0], [p.x * projectionProgress, p.y * projectionProgress, 0], 0.01, true);
      setSimpleLine(connector, [p.x, p.y, p.z], [p.x, p.y, p.z * (1 - projectionProgress)]);
      pointer.position.set(p.x, p.y, p.z);
      moveLabel('main', [p.x * 0.6, p.y * 0.6, p.z * 0.6 + 0.07], 'r');
      moveLabel('secondary', [p.x * 0.65, p.y * 0.65, -0.10], 'r′ = r sinφ', projectionProgress > 0.1);
      moveLabel('third', [0.12, 0.10, 0.45], `φ = ${(phi * 180 / Math.PI).toFixed(0)}°`);
      polarArc.visible = true;
      const arr = polarArc.geometry.attributes.position.array;
      for (let i = 0; i <= 64; i++) {
        const q = M.sphericalPoint(0.35, theta, phi * i / 64); arr.set([q.x, q.y, q.z], i * 3);
      }
      polarArc.geometry.attributes.position.needsUpdate = true;
      if (step > 0) {
        cone.visible = projectedDisk.visible = true;
        updateCone(phi, theta);
        cone.material.opacity = step === 2 ? 0.68 + 0.3 * pulse(t) : 0.68;
        updateDisk(projectedDisk, 0, Math.sin(phi), theta);
        // Projection carries the source density, not the density at z=0.
        projectedDisk.userData.update((u, v) => [u * Math.sin(phi) * Math.cos(v * theta), u * Math.sin(phi) * Math.sin(v * theta), -0.002], (x, y) => {
          const r = Math.sin(phi) > 0.001 ? Math.hypot(x, y) / Math.sin(phi) : 0;
          return colorAt(x, y, r * Math.cos(phi));
        });
      }
    }
    if (step >= 3) revealCloud('spherical', current.fraction);
  }
  function formula(id, tex, displayMode = false) {
    const el = $(id);
    if (window.katex) window.katex.render(tex, el, { throwOnError: false, displayMode, strict: false });
    else el.textContent = tex.replace(/\\(?:left|right|!)/g, '');
  }
  function chooseMethod(method) {
    state.method = method; state.time = 0; state.playing = false;
    config = METHODS[method]; total = config.durations.reduce((a, b) => a + b, 0); lastStep = -1;
    document.querySelectorAll('[data-method]').forEach(button => { const active = button.dataset.method === method; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    $('method-title').textContent = config.title;
    $('inset-title').textContent = config.inset;
    $('volume-element').textContent = config.element;
    $('element-note').textContent = config.note;
    $('steps').replaceChildren(); $('timeline-labels').replaceChildren();
    config.steps.forEach((name, index) => {
      const button = document.createElement('button'); button.className = 'step-button'; button.textContent = name; button.title = `跳转到：${name}`;
      button.addEventListener('click', () => jumpStep(index)); $('steps').appendChild(button);
      const span = document.createElement('span'); span.textContent = name; $('timeline-labels').appendChild(span);
    });
    formula('integral-formula', config.formula, true);
    if (renderer) {
      disk.material.clippingPlanes = []; disk.material.opacity = 0.75;
      // Each method starts with its own complete layer geometry, including after a seek.
      if (method === 'section') stack.children.forEach((mesh, j) => {
        const z = -1 + (j + 0.5) / 16; updateDisk(mesh, z, Math.sqrt(1 - z * z));
      });
      updateGeometry();
    }
  }
  function jumpStep(index) {
    const target = M.clamp(index, 0, config.steps.length - 1);
    state.time = config.durations.slice(0, target).reduce((a, b) => a + b, 0) + 0.001;
    state.playing = false; updateGeometry();
  }
  function updateUI() {
    const { step, fraction } = current;
    if (lastStep !== step) {
      $('explanation').textContent = config.descriptions[step]; $('scene-caption').textContent = config.captions[step];
      $('step-counter').textContent = `${step + 1} / ${config.steps.length}`;
      Array.from($('steps').children).forEach((button, i) => { button.classList.toggle('active', i === step); button.classList.toggle('done', i < step); button.setAttribute('aria-current', i === step ? 'step' : 'false'); });
      lastStep = step;
    }
    $('play').textContent = state.playing ? 'Ⅱ 暂停' : state.time >= total ? '↺ 重播' : '▶ 播放';
    $('play').setAttribute('aria-label', state.playing ? '暂停演示' : state.time >= total ? '重播演示' : '播放演示');
    $('timeline').value = Math.round(state.time / total * 1000);
    $('timeline').setAttribute('aria-valuetext', `${config.steps[step]}，总进度 ${Math.round(state.time / total * 100)}%`);
    $('time').textContent = `00:${String(Math.floor(state.time)).padStart(2, '0')} / 00:${total}`;
    $('prev').disabled = step === 0 && state.time < 0.01; $('next').disabled = step === config.steps.length - 1;
    $('mass').textContent = current.mass.toFixed(4);
    $('mass-fill').style.width = `${current.mass / M.totalMass * 100}%`;
    $('mass-status').textContent = fraction >= 1 ? '累加完成' : step < config.build ? '观察单个微元' : `已累计 ${(current.mass / M.totalMass * 100).toFixed(1)}%`;
    $('mass-note').textContent = step < config.build ? '单根线或单张面不具有三维体积；连续铺开后才累计体质量。' : config.massNote;
    $('completion').hidden = step !== config.steps.length - 1;
    if (state.method === 'projection') $('parameter').textContent = step < 2 ? '(x₀, y₀) = (0.45, 0.18)' : `已扫半径 ${fraction.toFixed(2)} m`;
    if (state.method === 'section') $('parameter').textContent = `z = ${current.z.toFixed(2)} m`;
    if (state.method === 'cylindrical') $('parameter').textContent = `z = ${current.z.toFixed(2)} · θ = ${(current.theta * 180 / Math.PI).toFixed(0)}°`;
    if (state.method === 'spherical') $('parameter').textContent = `φ = ${(current.phi * 180 / Math.PI).toFixed(0)}°`;
  }
  function drawInset() {
    const canvas = $('inset'), ctx = canvas.getContext('2d');
    const w = canvas.clientWidth || 330, h = canvas.clientHeight || 126, scale = Math.min(window.devicePixelRatio, 2);
    if (canvas.width !== Math.round(w * scale) || canvas.height !== Math.round(h * scale)) { canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale); }
    ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, w, h);
    const cx = w * 0.45, cy = h * 0.52, R = h * 0.38;
    ctx.font = '11px -apple-system, sans-serif'; ctx.lineWidth = 1;
    const line = (a, b, color = '#89968d', width = 1) => { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); };
    const dot = (x, y, color = '#292524', r = 3) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = color; ctx.fill(); };
    const text = (str, x, y, color = '#78716c') => { ctx.fillStyle = color; ctx.fillText(str, x, y); };
    if (state.method === 'projection' || state.method === 'cylindrical') {
      line([cx - R - 12, cy], [cx + R + 16, cy]); line([cx, cy + R + 8], [cx, cy - R - 12]); text('x', cx + R + 20, cy + 3); text('y', cx - 3, cy - R - 16);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.strokeStyle = '#a8b1aa'; ctx.stroke();
      if (state.method === 'projection') {
        if (current.step < 2) { dot(cx + 0.45 * R, cy - 0.18 * R); text('(x₀,y₀)', cx + 0.45 * R + 8, cy - 0.18 * R - 6, '#292524'); }
        else {
          ctx.beginPath(); ctx.arc(cx, cy, R * current.fraction, 0, TAU); ctx.fillStyle = '#05966926'; ctx.fill();
          const n = Math.floor(650 * current.fraction ** 2);
          coloredColumns.userData.points.slice(0, n).forEach(p => dot(cx + p.x * R, cy - p.y * R, '#059669', 0.7));
        }
        text('D', cx - R - 20, cy + R - 2, '#292524');
      } else {
        const theta = current.theta;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, -theta, 0); ctx.closePath();
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); gradient.addColorStop(0, '#05966950'); gradient.addColorStop(1, '#d9770690'); ctx.fillStyle = gradient; ctx.fill();
        line([cx, cy], [cx + R * Math.cos(theta), cy - R * Math.sin(theta)], '#292524', 1.5);
        text('r', cx + R * 0.5 * Math.cos(theta) + 5, cy - R * 0.5 * Math.sin(theta) - 5, '#292524');
        text('θ', cx + 15, cy - 9, '#292524');
      }
      text(state.method === 'projection' ? '一个点 ↔ 一根竖线' : '转一圈 ↔ 一个截面', w * 0.67, h * 0.87);
    } else if (state.method === 'section') {
      const axisX = w * 0.25, top = 15, bottom = h - 12, y = bottom - (current.z + 1) / 2 * (bottom - top);
      line([axisX, bottom], [axisX, top], '#b6b9b4', 3);
      if (current.step >= 2) line([axisX, bottom], [axisX, y], '#059669', 4);
      dot(axisX, y); line([axisX, y], [w * 0.72, y], '#8fa295');
      text('1', axisX - 21, top + 4); text('−1', axisX - 25, bottom + 3); text('z', axisX - 4, 9);
      const rr = Math.sqrt(Math.max(0, 1 - current.z ** 2));
      ctx.beginPath(); ctx.ellipse(w * 0.70, y, 45 * rr, 12 * rr, 0, 0, TAU); ctx.fillStyle = '#05966950'; ctx.fill();
      text(`圆盘半径 √(1−z²) = ${rr.toFixed(2)}`, w * 0.4, h - 1);
    } else {
      const ox = w * 0.47, oy = h * 0.53, rr = h * 0.39, phi = current.phi;
      line([ox, 6], [ox, h - 5]); line([ox - 22, oy], [ox + rr + 40, oy]);
      ctx.beginPath(); ctx.arc(ox, oy, rr, -Math.PI / 2, Math.PI / 2); ctx.strokeStyle = '#b7bbb5'; ctx.stroke();
      if (current.step >= 3) { ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, rr, -Math.PI / 2, phi - Math.PI / 2); ctx.closePath(); ctx.fillStyle = '#05966925'; ctx.fill(); }
      const px = ox + rr * Math.sin(phi), py = oy - rr * Math.cos(phi);
      line([ox, oy], [px, py], '#059669', 2); line([ox, oy], [px, oy], '#9ca09e', 2);
      ctx.setLineDash([3, 3]); line([px, py], [px, oy]); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(ox, oy, 18, -Math.PI / 2, phi - Math.PI / 2); ctx.strokeStyle = '#78716c'; ctx.stroke();
      text('r', (ox + px) / 2 + 5, (oy + py) / 2 - 3, '#292524'); text('r′', (ox + px) / 2, oy + 15); text('φ', ox + 8, oy - 19); text('+z', ox - 26, 12); text('xOy', ox + rr + 10, oy + 4);
    }
  }
  function togglePlay() { if (state.time >= total) state.time = 0; state.playing = !state.playing; updateGeometry(); }
  function resetCamera() {
    if (window.gsap && !reducedMotion.matches) window.gsap.to(camera.position, { x: 2.7, y: -4.1, z: 2.45, duration: 0.8, ease: 'power2.out', onUpdate: () => controls.update() });
    else { camera.position.set(2.7, -4.1, 2.45); controls.update(); }
  }
  function bind() {
    document.querySelectorAll('[data-method]').forEach(button => button.addEventListener('click', () => chooseMethod(button.dataset.method)));
    $('play').addEventListener('click', togglePlay);
    $('restart').addEventListener('click', () => { state.time = 0; state.playing = false; updateGeometry(); });
    $('prev').addEventListener('click', () => jumpStep(current.step - 1));
    $('next').addEventListener('click', () => jumpStep(current.step + 1));
    $('speed').addEventListener('change', event => { state.speed = Number(event.target.value); });
    $('timeline').addEventListener('input', event => { state.time = Number(event.target.value) / 1000 * total; state.playing = false; updateGeometry(); });
    $('reset-camera').addEventListener('click', resetCamera);
    document.addEventListener('keydown', event => {
      if (event.target.closest('button, input, select, a, #scene')) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      if (event.code === 'ArrowRight') { event.preventDefault(); jumpStep(current.step + 1); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); jumpStep(current.step - 1); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { state.playing = false; updateUI(); } });
  }
  function animate(now) {
    const dt = Math.min(0.1, (now - (animate.last || now)) / 1000); animate.last = now;
    if (state.playing) {
      state.time = Math.min(total, state.time + dt * state.speed);
      if (state.time >= total) state.playing = false;
      updateGeometry();
    }
    controls.update();
    for (const item of Object.values(labels)) {
      const p = item.position.clone().project(camera);
      item.el.hidden = !item.visible || p.z > 1 || p.z < -1;
      item.el.style.left = `${(p.x * 0.5 + 0.5) * $('scene').clientWidth}px`;
      item.el.style.top = `${(-p.y * 0.5 + 0.5) * $('scene').clientHeight}px`;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  try {
    if (!window.THREE || !THREE.OrbitControls) throw new Error('三维资源未能加载，请检查网络连接后刷新页面。');
    palette = ['#2563eb', '#059669', '#d97706'].map(color => new THREE.Color(color).convertSRGBToLinear());
    setup(); bind();
    formula('body-formula', String.raw`\Omega:\ x^2+y^2+z^2\le 1`);
    formula('density-formula', String.raw`\rho(x,y,z)=1+\frac z2+\frac{x^2+y^2}{2}`);
    chooseMethod('projection');
    requestAnimationFrame(animate);
  } catch (error) {
    $('scene-error').hidden = false;
    $('scene-error').textContent = error.message.includes('三维资源') ? error.message : '无法创建三维画面，请使用支持 WebGL 的浏览器并开启图形加速后刷新。';
    console.error(error);
    document.querySelectorAll('button,input,select').forEach(el => { el.disabled = true; });
  }
})();
