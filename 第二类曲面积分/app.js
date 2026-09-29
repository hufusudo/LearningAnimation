(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const OPEN_HALF = 1.55;
  const SPHERE_RADIUS = 1.45;
  const state = {
    shape: 'open',
    field: 'vertical',
    orientation: 1,
    speed: 1,
    particlesOn: true,
    probeMode: 'field',
    lessonIndex: -1,
    projectionFocus: -1,
    totalFlux: 0
  };

  const lessonSteps = [
    { title: '迎面穿透：法向速度全部计入', copy: '让局部速度箭头沿着所选法向穿过网面。单位面积的通量达到 |v⃗|，曲面网眼亮起。' },
    { title: '切向掠过：没有流体穿过网面', copy: '把局部速度转到网面切线方向。流体贴着网眼滑走，法向分量为零，微元通量随之归零。' },
    { title: 'P 分量穿过 dy dz 投影面', copy: '斜面在 yz 平面的有向投影，承接 x 方向分速度 P；看这一束如何形成 P dy dz。' },
    { title: 'Q 分量穿过 dz dx 投影面', copy: '转到 zx 投影面，只保留 y 方向分速度 Q，对应 Q dz dx。' },
    { title: 'R 分量穿过 dx dy 投影面', copy: '最后看 z 方向分速度 R 穿过 xy 投影面，对应 R dx dy；三项相加就是微元通量。' },
    { title: '翻转开曲面：有向通量变号', copy: '同一股流体、同一张网，只把选定法向翻过来；出流记作入流，整个积分由正变负。' },
    { title: '球壳穿堂风：入流与出流抵消', copy: '左半球迎风，右半球背风。均匀无源流场穿过闭曲面的净通量为零。' },
    { title: '球壳包住源泉：全壳净流出', copy: '源泉流场 v⃗=(x,y,z) 从球心向外发散，球壳上每个微元都向外流出，净通量为正。' }
  ];

  const ui = {};
  let scene, camera, renderer, controls, clock;
  let surfaceGroup, normalGroup, probeGroup, particleGroup, sourceGroup;
  let surfaceGeometry = null;
  let particlePositions = null;
  let particleTrails = null;
  let particleVelocities = null;
  let particlePoints = null;
  let trailLines = null;
  let fluxMotion = { value: 0 };
  let lastShape = null;
  let resizeObserver = null;
  let projectionParticles = [];
  let projectionTime = 0;
  let lastProjectionFrame = 0;
  let localParticles = null;
  let localParticleFrame = 0;
  const PARTICLE_COUNT = 118;

  function byId(id) { return document.getElementById(id); }
  function wantsReducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  function bindDom() {
    [
      'sceneCanvas', 'sceneViewport', 'sceneFallback', 'sceneTitle', 'sceneStatus', 'sceneLed', 'fieldCaption',
      'surfaceCaption', 'triangleCount', 'fluxTop', 'fluxBottom', 'fluxBadge', 'meterReadout', 'meterFill',
      'meterSign', 'meterExplanation', 'meterBalance', 'speedSlider', 'speedValue', 'flipButton', 'flipLabel',
      'flowButton', 'flowLabel', 'stepButton', 'lessonCount', 'lessonTitle', 'lessonCopy', 'componentP',
      'componentQ', 'componentR', 'areaP', 'areaQ', 'areaR', 'dotFormula', 'projectionFormula', 'numericFormula', 'localFluxLabel', 'insightNote',
      'gaussBanner', 'gaussTitle', 'gaussFormula', 'gaussValue', 'normalArrow', 'normalLabel', 'vectorArrow',
      'arrowP', 'arrowQ', 'arrowR', 'labelP', 'labelQ', 'labelR', 'planeXY', 'planeYZ', 'planeZX',
      'shadowYZ', 'shadowZX', 'shadowXY', 'projectionStreams', 'inflowValue', 'outflowValue',
      'inflowWater', 'outflowWater', 'balanceEquation'
    ].forEach(id => { ui[id] = byId(id); });
  }

  function init() {
    bindDom();
    bindEvents();
    createProjectionStreams();
    try {
      initScene();
      renderStaticMath();
      updateAll({ rebuild: true, animate: false });
    } catch (error) {
      console.error('[第二类曲面积分] 3D 初始化失败', error);
      showSceneFallback('三维场景未能启动；右侧微元分解与底部通量计量仍可使用。');
      if (renderer) renderer.dispose();
      renderer = null;
      scene = camera = surfaceGroup = normalGroup = probeGroup = particleGroup = sourceGroup = null;
      surfaceGeometry = null;
    }
    if (renderer) requestAnimationFrame(animate);
    requestAnimationFrame(animateProjectionStreams);
  }

  function bindEvents() {
    document.querySelectorAll('[data-shape]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.shape === state.shape) return;
        state.shape = button.dataset.shape;
        state.orientation = 1;
        state.probeMode = 'field';
        leaveGuidedLesson();
        clearFluxTween();
        updateAll({ rebuild: true, animate: true });
      });
    });

    document.querySelectorAll('[data-field]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.field === state.field) return;
        state.field = button.dataset.field;
        state.probeMode = 'field';
        leaveGuidedLesson();
        resetParticles();
        clearFluxTween();
        updateAll({ rebuild: false, animate: true });
      });
    });

    ui.flipButton.addEventListener('click', () => {
      state.orientation *= -1;
      state.probeMode = 'field';
      leaveGuidedLesson();
      clearFluxTween();
      updateAll({ rebuild: false, animate: true });
    });

    ui.flowButton.addEventListener('click', () => {
      state.particlesOn = !state.particlesOn;
      ui.flowButton.setAttribute('aria-pressed', String(state.particlesOn));
      ui.flowLabel.textContent = state.particlesOn ? '粒子流动中' : '粒子已暂停';
      if (particleGroup) particleGroup.visible = state.particlesOn;
      if (localParticles) localParticles.points.visible = state.particlesOn;
    });

    ui.stepButton.addEventListener('click', advanceLesson);
    ui.speedSlider.addEventListener('input', () => {
      state.speed = Number(ui.speedSlider.value);
      ui.speedValue.textContent = state.speed.toFixed(1);
      ui.fieldCaption.textContent = fieldCaptionText();
      updateProbe();
      updateProjectionDiagram();
      clearFluxTween();
      updateFlux(true);
    });

    document.querySelectorAll('[data-probe]').forEach(button => {
      button.addEventListener('click', () => {
        state.probeMode = button.dataset.probe;
        leaveGuidedLesson();
        updateAll({ rebuild: false, animate: true });
      });
    });

    window.addEventListener('resize', resizeScene, { passive: true });
  }

  function clearFluxTween() {
    if (!window.gsap) return;
    window.gsap.killTweensOf(fluxMotion);
    if (surfaceGroup) {
      window.gsap.killTweensOf(surfaceGroup.scale);
      if (surfaceGroup.children[0] && surfaceGroup.children[0].material) window.gsap.killTweensOf(surfaceGroup.children[0].material);
    }
    if (normalGroup) window.gsap.killTweensOf(normalGroup.scale);
    window.gsap.killTweensOf([ui.lessonTitle, ui.lessonCopy]);
  }

  function leaveGuidedLesson() {
    state.lessonIndex = -1;
    state.projectionFocus = -1;
    clearFluxTween();
  }

  function advanceLesson() {
    clearFluxTween();
    state.lessonIndex = (state.lessonIndex + 1) % lessonSteps.length;
    const index = state.lessonIndex;
    state.projectionFocus = index >= 2 && index <= 4 ? index - 2 : -1;

    if (index === 0 || index === 1) {
      state.shape = 'open'; state.field = 'vertical'; state.orientation = 1;
      state.probeMode = index === 0 ? 'normal' : 'tangent';
    } else if (index >= 2 && index <= 4) {
      state.shape = 'open'; state.field = 'source'; state.orientation = 1; state.probeMode = 'field';
    } else if (index === 5) {
      state.shape = 'open'; state.field = 'vertical'; state.orientation = -1; state.probeMode = 'field';
    } else if (index === 6) {
      state.shape = 'closed'; state.field = 'horizontal'; state.orientation = 1; state.probeMode = 'field';
    } else {
      state.shape = 'closed'; state.field = 'source'; state.orientation = 1; state.probeMode = 'field';
    }

    if (ui.lessonTitle && window.gsap && !wantsReducedMotion()) {
      window.gsap.killTweensOf([ui.lessonTitle, ui.lessonCopy]);
      window.gsap.fromTo([ui.lessonTitle, ui.lessonCopy], { opacity: 0.5, y: 3 }, { opacity: 1, y: 0, duration: 0.28, stagger: 0.035, ease: 'power2.out' });
    }
    resetParticles();
    updateAll({ rebuild: lastShape !== state.shape, animate: true });
  }

  function syncButtons() {
    const guidedLocalFlow = state.lessonIndex === 0 || state.lessonIndex === 1;
    document.querySelectorAll('[data-shape]').forEach(button => {
      const active = button.dataset.shape === state.shape;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-field]').forEach(button => {
      const active = !guidedLocalFlow && button.dataset.field === state.field;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    ui.flipButton.setAttribute('aria-pressed', String(state.orientation < 0));
    ui.flipLabel.textContent = state.orientation > 0 ? (state.shape === 'closed' ? '法向朝外' : '法向朝上') : (state.shape === 'closed' ? '法向朝内' : '法向朝下');
    ui.sceneTitle.textContent = state.shape === 'closed' ? '一只透明球壳' : '一张弯曲渔网';
    ui.sceneStatus.textContent = ui.flipLabel.textContent;
    ui.fieldCaption.textContent = fieldCaptionText();
    ui.surfaceCaption.textContent = state.shape === 'closed' ? '球壳网格 · 外法向 n⃗ · 三维流场 v⃗' : '曲面网格 · 选定法向 n⃗ · 流速场 v⃗';
    if (sourceGroup) sourceGroup.visible = state.field === 'source';
    if (particleGroup) particleGroup.visible = state.particlesOn;
    ui.triangleCount.textContent = surfaceGeometry ? `${surfaceGeometry.index ? surfaceGeometry.index.count / 3 : 0} 个有向三角微元` : '连续曲面 · 局部积分';
    ui.lessonCount.textContent = state.lessonIndex >= 0 ? `剖析 ${String(state.lessonIndex + 1).padStart(2, '0')} / 08` : '自由观察';
    ui.lessonTitle.textContent = state.lessonIndex >= 0 ? lessonSteps[state.lessonIndex].title : defaultLessonTitle();
    ui.lessonCopy.textContent = state.lessonIndex >= 0 ? lessonSteps[state.lessonIndex].copy : defaultLessonDescription();
    ui.meterBalance.textContent = state.shape === 'closed' ? '闭曲面 Σ · 全壳代数和' : '有向曲面 Σ';
    ui.meterExplanation.textContent = state.shape === 'closed' ? '把球壳上每个微元的流入与流出代数相加。' : '每块网眼的法向通量累加，得到穿过整张曲面的净体积流量。';
    document.querySelectorAll('[data-probe]').forEach(button => {
      const active = button.dataset.probe === state.probeMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function fieldCaptionText() {
    if (state.lessonIndex === 0) return `局部法向流 · |v⃗|=${state.speed.toFixed(1)}`;
    if (state.lessonIndex === 1) return `局部切向流 · |v⃗|=${state.speed.toFixed(1)}`;
    if (state.field === 'vertical') return `v⃗ = (0, 0, ${state.speed.toFixed(1)})`;
    if (state.field === 'horizontal') return `v⃗ = (${state.speed.toFixed(1)}, 0, 0)`;
    return `v⃗ = ${state.speed.toFixed(1)}(x, y, z)`;
  }

  function defaultLessonTitle() {
    if (state.shape === 'closed' && state.field === 'source' && state.orientation > 0) return '封闭球壳包围泉眼，流体持续净流出';
    if (state.shape === 'closed' && state.field !== 'source') return '穿堂风进入球壳后，从另一侧等量流出';
    if (state.orientation < 0) return '法向朝内：原本流出的部分改记为流入';
    return state.probeMode === 'tangent' ? '沿网面掠过的流体不形成微元通量' : '流体穿过网面，才计入通量';
  }

  function defaultLessonDescription() {
    if (state.shape === 'closed' && state.field === 'source' && state.orientation > 0) return 'v⃗=(x,y,z) 从球心向外发散；闭曲面上每一片微元都为正贡献。';
    if (state.shape === 'closed' && state.field !== 'source') return '迎水面记负、背水面记正；没有源或汇时，两侧通量相互抵消。';
    if (state.orientation < 0) return '曲面本身没有移动，只反转了选定侧向；有向积分因此整体变号。';
    return state.probeMode === 'tangent' ? '局部探针沿切线移动，v⃗·n⃗=0；试着切回迎面穿透。' : '拖动视角观察曲面；切换局部探针，对比法向迎面穿透与切向掠过。';
  }

  function updateAll(options) {
    const rebuild = options && options.rebuild;
    if (rebuild && scene) {
      rebuildSurface();
      lastShape = state.shape;
    }
    syncButtons();
    if (surfaceGeometry) {
      updateSurfaceColors();
      updateNormals();
    }
    if (options && options.animate && window.gsap && renderer && !wantsReducedMotion()) {
      if (rebuild && surfaceGroup) {
        surfaceGroup.scale.setScalar(0.94);
        window.gsap.to(surfaceGroup.scale, { x: 1, y: 1, z: 1, duration: 0.48, ease: 'power2.out' });
      }
      const membrane = surfaceGroup && surfaceGroup.children[0];
      if (membrane && membrane.material) {
        const targetOpacity = state.shape === 'closed' ? 0.37 : 0.42;
        membrane.material.opacity = 0.06;
        window.gsap.to(membrane.material, { opacity: targetOpacity, duration: 0.48, ease: 'power2.out' });
      }
      if (normalGroup) {
        normalGroup.scale.setScalar(0.72);
        window.gsap.to(normalGroup.scale, { x: 1, y: 1, z: 1, duration: 0.32, ease: 'back.out(1.3)' });
      }
    }
    updateProbe();
    updateProjectionDiagram();
    updateFlux(options ? options.animate : true);
  }

  function initScene() {
    if (!window.THREE || !ui.sceneCanvas) {
      showSceneFallback('三维库未能载入；右侧微元分解与底部通量计量仍可使用。');
      return;
    }
    try {
      const T = window.THREE;
      scene = new T.Scene();
      scene.background = new T.Color(0xf7f6f1);
      camera = new T.PerspectiveCamera(38, 1, 0.1, 100);
      camera.up.set(0, 0, 1);
      camera.position.set(5.2, -6.2, 5.1);
      renderer = new T.WebGLRenderer({ canvas: ui.sceneCanvas, antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0xf7f6f1, 1);
      renderer.outputEncoding = T.sRGBEncoding;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      ui.sceneCanvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        renderer = null;
        showSceneFallback('显卡上下文已中断；右侧微元分解与底部通量计量仍可使用。');
      });
      controls = T.OrbitControls ? new T.OrbitControls(camera, renderer.domElement) : null;
      if (controls) {
        controls.target.set(0, 0, 0.1);
        controls.enableDamping = true;
        controls.dampingFactor = 0.075;
        controls.minDistance = 4;
        controls.maxDistance = 11;
        controls.maxPolarAngle = Math.PI * 0.92;
        controls.update();
      }
      clock = new T.Clock();
      scene.add(new T.HemisphereLight(0xffffff, 0xe1ddd2, 1.5));
      const keyLight = new T.DirectionalLight(0xffffff, 1.2);
      keyLight.position.set(-3, -4, 7);
      scene.add(keyLight);
      const fillLight = new T.DirectionalLight(0xdce8ee, 0.55);
      fillLight.position.set(4, 3, 3);
      scene.add(fillLight);

      surfaceGroup = new T.Group();
      normalGroup = new T.Group();
      probeGroup = new T.Group();
      particleGroup = new T.Group();
      sourceGroup = new T.Group();
      scene.add(surfaceGroup, normalGroup, probeGroup, particleGroup, sourceGroup);
      addAxes();
      createParticles();
      createSourceMarker();
      resizeScene();
      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(resizeScene);
        resizeObserver.observe(ui.sceneViewport);
      }
    } catch (error) {
      showSceneFallback('三维视口暂时不可用；右侧投影图与曲面积分计量仍可交互。');
      renderer = null;
      scene = camera = surfaceGroup = normalGroup = probeGroup = particleGroup = sourceGroup = null;
      surfaceGeometry = null;
    }
  }

  function showSceneFallback(message) {
    if (ui.sceneCanvas) ui.sceneCanvas.style.display = 'none';
    if (ui.sceneFallback) {
      ui.sceneFallback.textContent = message;
      ui.sceneFallback.hidden = false;
    }
  }

  function makeAxisLabel(text, color) {
    const T = window.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = color;
    ctx.font = '500 38px Georgia';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);
    const texture = new T.CanvasTexture(canvas);
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(0.22, 0.22, 1);
    return sprite;
  }

  function addAxes() {
    const T = window.THREE;
    const axisGroup = new T.Group();
    const defs = [
      { name: 'x', dir: new T.Vector3(1, 0, 0), origin: new T.Vector3(-1.78, 0, 0), color: 0x65635e, label: new T.Vector3(1.72, 0, 0) },
      { name: 'y', dir: new T.Vector3(0, 1, 0), origin: new T.Vector3(0, -1.78, 0), color: 0x77756e, label: new T.Vector3(0, 1.72, 0) },
      { name: 'z', dir: new T.Vector3(0, 0, 1), origin: new T.Vector3(0, 0, -1.32), color: 0x57534e, label: new T.Vector3(0, 0, 1.78) }
    ];
    defs.forEach(axis => {
      axisGroup.add(new T.ArrowHelper(axis.dir, axis.origin, 3.45, axis.color, 0.11, 0.055));
      const label = makeAxisLabel(axis.name, '#57534e');
      label.position.copy(axis.label);
      axisGroup.add(label);
    });
    scene.add(axisGroup);
    const floor = new T.GridHelper(4.2, 14, 0xd3d0c7, 0xe6e3da);
    floor.rotation.x = Math.PI / 2;
    floor.position.z = -1.32;
    floor.material.transparent = true;
    floor.material.opacity = 0.58;
    scene.add(floor);
  }

  function openHeight(x, y) {
    return 0.42 - 0.42 * x - 0.33 * y + 0.14 * (x * x - 0.72 * y * y) + 0.07 * Math.sin(x * 1.35) * Math.cos(y * 1.1);
  }

  function makeSurfaceGeometry() {
    const T = window.THREE;
    if (!T) return null;
    const segments = state.shape === 'open' ? 24 : 32;
    const rows = state.shape === 'open' ? 24 : 22;
    let geometry;
    if (state.shape === 'open') {
      const positions = [];
      const indices = [];
      for (let j = 0; j <= rows; j++) {
        const y = -OPEN_HALF + (2 * OPEN_HALF * j) / rows;
        for (let i = 0; i <= segments; i++) {
          const x = -OPEN_HALF + (2 * OPEN_HALF * i) / segments;
          positions.push(x, y, openHeight(x, y));
        }
      }
      const stride = segments + 1;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < segments; i++) {
          const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
          indices.push(a, b, d, a, d, c);
        }
      }
      geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
    } else {
      geometry = new T.SphereGeometry(SPHERE_RADIUS, segments, rows);
      const index = geometry.index;
      const position = geometry.attributes.position;
      for (let i = 0; i < index.count; i += 3) {
        const ia = index.getX(i), ib = index.getX(i + 1), ic = index.getX(i + 2);
        const a = new T.Vector3().fromBufferAttribute(position, ia);
        const b = new T.Vector3().fromBufferAttribute(position, ib);
        const c = new T.Vector3().fromBufferAttribute(position, ic);
        const normal = new T.Vector3().subVectors(b, a).cross(new T.Vector3().subVectors(c, a));
        const centroid = a.clone().add(b).add(c);
        if (normal.dot(centroid) < 0) {
          index.setX(i + 1, ic);
          index.setX(i + 2, ib);
        }
      }
      index.needsUpdate = true;
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function addOpenNetLines(geometry, group) {
    const T = window.THREE;
    const positions = geometry.attributes.position;
    const segments = 24, rows = 24, stride = segments + 1;
    const vertices = [];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i < segments; i++) {
        const a = j * stride + i, b = a + 1;
        vertices.push(positions.getX(a), positions.getY(a), positions.getZ(a), positions.getX(b), positions.getY(b), positions.getZ(b));
      }
    }
    for (let i = 0; i <= segments; i++) {
      for (let j = 0; j < rows; j++) {
        const a = j * stride + i, b = a + stride;
        vertices.push(positions.getX(a), positions.getY(a), positions.getZ(a), positions.getX(b), positions.getY(b), positions.getZ(b));
      }
    }
    const lines = new T.BufferGeometry();
    lines.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    const net = new T.LineSegments(lines, new T.LineBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.86 }));
    net.renderOrder = 2;
    group.add(net);
  }

  function addSphereNetLines(group) {
    const T = window.THREE;
    const points = [];
    const latitudes = 11, longitudes = 24, substeps = 36;
    const at = (theta, phi) => new T.Vector3(
      SPHERE_RADIUS * Math.sin(theta) * Math.cos(phi),
      SPHERE_RADIUS * Math.sin(theta) * Math.sin(phi),
      SPHERE_RADIUS * Math.cos(theta)
    );
    for (let k = 1; k <= latitudes; k++) {
      const theta = Math.PI * k / (latitudes + 1);
      for (let i = 0; i < substeps; i++) {
        const a = at(theta, TAU * i / substeps), b = at(theta, TAU * (i + 1) / substeps);
        points.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    for (let k = 0; k < longitudes; k++) {
      const phi = TAU * k / longitudes;
      for (let i = 0; i < substeps; i++) {
        const a = at(Math.PI * i / substeps, phi), b = at(Math.PI * (i + 1) / substeps, phi);
        points.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
    const net = new T.LineSegments(geometry, new T.LineBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.82 }));
    net.renderOrder = 2;
    group.add(net);
  }

  function disposeGroup(group) {
    if (!group) return;
    group.traverse(node => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        if (Array.isArray(node.material)) node.material.forEach(material => material.dispose());
        else node.material.dispose();
      }
    });
    group.clear();
  }

  function rebuildSurface() {
    if (!scene || !window.THREE) return;
    const T = window.THREE;
    disposeGroup(surfaceGroup);
    surfaceGeometry = makeSurfaceGeometry();
    const membrane = new T.Mesh(surfaceGeometry, new T.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, opacity: state.shape === 'closed' ? 0.37 : 0.42,
      side: T.DoubleSide, depthWrite: false
    }));
    membrane.renderOrder = 1;
    surfaceGroup.add(membrane);
    if (state.shape === 'open') addOpenNetLines(surfaceGeometry, surfaceGroup);
    else addSphereNetLines(surfaceGroup);
    surfaceGroup.visible = true;
  }

  function updateSurfaceColors() {
    if (!surfaceGeometry || !window.THREE) return;
    const T = window.THREE;
    const positions = surfaceGeometry.attributes.position;
    const normals = surfaceGeometry.attributes.normal;
    const colors = new Float32Array(positions.count * 3);
    const point = new T.Vector3(), normal = new T.Vector3(), color = new T.Color();
    const positive = new T.Color(0x45b880);
    const negative = new T.Color(0xe7a64e);
    const tangent = new T.Color(0xaaa79e);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      normal.fromBufferAttribute(normals, i).multiplyScalar(state.orientation);
      const signed = fieldVectorAt(point).dot(normal);
      const target = Math.abs(signed) < 0.025 ? tangent : signed > 0 ? positive : negative;
      color.copy(target);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    surfaceGeometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    const net = surfaceGroup && surfaceGroup.children[1];
    if (net && net.geometry && net.geometry.attributes.position) {
      const netPositions = net.geometry.attributes.position;
      const netColors = new Float32Array(netPositions.count * 3);
      for (let i = 0; i < netPositions.count; i++) {
        point.fromBufferAttribute(netPositions, i);
        normal.copy(baseNormalAt(point.x, point.y, point.z)).multiplyScalar(state.orientation);
        const signed = fieldVectorAt(point).dot(normal);
        const target = Math.abs(signed) < 0.025 ? tangent : signed > 0 ? positive : negative;
        netColors[i * 3] = target.r;
        netColors[i * 3 + 1] = target.g;
        netColors[i * 3 + 2] = target.b;
      }
      net.geometry.setAttribute('color', new T.Float32BufferAttribute(netColors, 3));
    }
  }

  function fieldVectorAt(point) {
    const T = window.THREE;
    if (!T) return { x: 0, y: 0, z: 0 };
    if (state.shape === 'open' && state.lessonIndex === 0) return baseNormalAt(point.x, point.y, point.z).multiplyScalar(state.speed);
    if (state.shape === 'open' && state.lessonIndex === 1) {
      const normal = baseNormalAt(point.x, point.y, point.z);
      return new T.Vector3(1, 0, 0).addScaledVector(normal, -normal.x).normalize().multiplyScalar(state.speed);
    }
    if (state.field === 'vertical') return new T.Vector3(0, 0, state.speed);
    if (state.field === 'horizontal') return new T.Vector3(state.speed, 0, 0);
    return new T.Vector3(point.x * state.speed, point.y * state.speed, point.z * state.speed);
  }

  function baseNormalAt(x, y, z) {
    const T = window.THREE;
    if (state.shape === 'closed') return new T.Vector3(x, y, z).normalize();
    const delta = 0.01;
    const dx = (openHeight(x + delta, y) - openHeight(x - delta, y)) / (2 * delta);
    const dy = (openHeight(x, y + delta) - openHeight(x, y - delta)) / (2 * delta);
    return new T.Vector3(-dx, -dy, 1).normalize();
  }

  function probePoint() {
    const T = window.THREE;
    if (state.shape === 'closed') return new T.Vector3(0.56, -0.34, 0.76).normalize().multiplyScalar(SPHERE_RADIUS);
    const x = 0.34, y = 0.22;
    return new T.Vector3(x, y, openHeight(x, y));
  }

  function selectedNormal(point) {
    return baseNormalAt(point.x, point.y, point.z).multiplyScalar(state.orientation);
  }

  function probeVectorAt(point) {
    const T = window.THREE;
    const normal = selectedNormal(point);
    if (state.probeMode === 'normal') return normal.clone().multiplyScalar(state.speed);
    if (state.probeMode === 'tangent') {
      const tangent = new T.Vector3(1, 0, 0).addScaledVector(normal, -normal.x);
      if (tangent.lengthSq() < 0.001) tangent.set(0, 1, 0).addScaledVector(normal, -normal.y);
      return tangent.normalize().multiplyScalar(state.speed);
    }
    return fieldVectorAt(point);
  }

  function updateNormals() {
    if (!scene || !surfaceGeometry || !window.THREE) return;
    const T = window.THREE;
    disposeGroup(normalGroup);
    const addArrow = (point, normal) => {
      const selected = normal.clone().multiplyScalar(state.orientation);
      const dot = fieldVectorAt(point).dot(selected);
      const color = Math.abs(dot) < 0.025 ? 0x8d8a82 : dot > 0 ? 0x059669 : 0xd97706;
      const arrow = new T.ArrowHelper(selected, point.clone().addScaledVector(selected, 0.018), 0.2, color, 0.055, 0.032);
      normalGroup.add(arrow);
    };

    if (state.shape === 'open') {
      for (let j = 0; j < 7; j++) {
        const y = -1.25 + j * (2.5 / 6);
        for (let i = 0; i < 7; i++) {
          const x = -1.25 + i * (2.5 / 6);
          const point = new T.Vector3(x, y, openHeight(x, y));
          addArrow(point, baseNormalAt(x, y, point.z));
        }
      }
    } else {
      const latitudes = 5, longitudes = 12;
      for (let j = 0; j < latitudes; j++) {
        const theta = 0.32 + (Math.PI - 0.64) * (j + 0.5) / latitudes;
        for (let i = 0; i < longitudes; i++) {
          const phi = TAU * i / longitudes;
          const point = new T.Vector3(
            SPHERE_RADIUS * Math.sin(theta) * Math.cos(phi),
            SPHERE_RADIUS * Math.sin(theta) * Math.sin(phi),
            SPHERE_RADIUS * Math.cos(theta)
          );
          addArrow(point, point.clone().normalize());
        }
      }
    }
  }

  function updateProbe() {
    if (!scene || !probeGroup || !window.THREE) return;
    const T = window.THREE;
    disposeGroup(probeGroup);
    const point = probePoint();
    const normal = selectedNormal(point);
    const vector = probeVectorAt(point);
    const marker = new T.Mesh(
      new T.CircleGeometry(0.22, 36),
      new T.MeshBasicMaterial({ color: state.probeMode === 'tangent' ? 0x57534e : 0x059669, transparent: true, opacity: 0.21, side: T.DoubleSide, depthWrite: false })
    );
    marker.position.copy(point).addScaledVector(normal, 0.018);
    marker.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
    probeGroup.add(marker);
    probeGroup.add(new T.ArrowHelper(vector.clone().normalize(), point.clone().addScaledVector(normal, 0.035), Math.max(0.28, Math.min(0.58, 0.26 + vector.length() * 0.2)), state.probeMode === 'tangent' ? 0x57534e : 0x2563eb, 0.12, 0.07));
    createLocalParticleBeam(point, normal, vector);

    const density = vector.dot(normal);
    ui.localFluxLabel.textContent = Math.abs(density) < 0.015 ? 'dΦ = 0' : `dΦ/dS ${density > 0 ? '+' : '−'}${Math.abs(density).toFixed(2)}`;
    ui.localFluxLabel.dataset.sign = Math.abs(density) < 0.015 ? 'zero' : density > 0 ? 'positive' : 'negative';
    if (state.probeMode === 'normal') ui.insightNote.textContent = '迎面穿透时，法向速度全部贡献给通量；当前局部值为 |v⃗| dS。探针只演示这一片微元，总通量仍按上方场型积分。';
    else if (state.probeMode === 'tangent') ui.insightNote.textContent = '沿网面滑过时，速度没有法向分量；粒子不穿过曲面两侧，微元通量为零。探针只演示局部，总通量仍按上方场型积分。';
    else ui.insightNote.textContent = '把局部速度拆成 P、Q、R 三个轴向分量；每项乘上垂直于它的有向投影面积，再对全曲面累加。';
  }

  function createLocalParticleBeam(point, normal, vector) {
    const T = window.THREE;
    const direction = vector.clone().normalize();
    const cross = new T.Vector3().crossVectors(direction, normal);
    if (cross.lengthSq() < 0.01) cross.crossVectors(direction, new T.Vector3(1, 0, 0));
    if (cross.lengthSq() < 0.01) cross.crossVectors(direction, new T.Vector3(0, 1, 0));
    cross.normalize();
    const second = new T.Vector3().crossVectors(direction, cross).normalize();
    const geometry = new T.BufferGeometry();
    const count = 22;
    geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(T.DynamicDrawUsage));
    const points = new T.Points(geometry, new T.PointsMaterial({ color: 0x2563eb, size: 0.065, transparent: true, opacity: 0.92, depthWrite: false }));
    points.frustumCulled = false;
    points.visible = state.particlesOn;
    probeGroup.add(points);
    localParticles = { points, point: point.clone(), normal: normal.clone(), direction, cross, second, count };
    updateLocalParticleBeam();
  }

  function updateLocalParticleBeam() {
    if (!localParticles) return;
    const beam = localParticles;
    const positions = beam.points.geometry.attributes.position;
    for (let i = 0; i < beam.count; i++) {
      const phase = (i / beam.count + localParticleFrame * 0.38) % 1;
      const angle = i * 2.39996;
      const radius = 0.08 * Math.sqrt((i % 7 + 1) / 7);
      const point = beam.point.clone()
        .addScaledVector(beam.normal, state.probeMode === 'tangent' ? 0.07 : 0.015)
        .addScaledVector(beam.direction, (phase - 0.5) * 1.45)
        .addScaledVector(beam.cross, Math.cos(angle) * radius)
        .addScaledVector(beam.second, Math.sin(angle) * radius);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
  }

  function updateProjectionDiagram() {
    if (!window.THREE || !ui.vectorArrow) return;
    const point = probePoint();
    const vector = probeVectorAt(point);
    const scale = Math.min(36, 25 / Math.max(1, vector.length()));
    const normal = selectedNormal(point);
    const x2 = 184 + (vector.x * 1.0 + vector.y * 0.48) * scale;
    const y2 = 153 + (-vector.z * 1.08 - vector.y * 0.31) * scale;
    ui.vectorArrow.setAttribute('x2', String(x2));
    ui.vectorArrow.setAttribute('y2', String(y2));
    const normalX = 184 + (normal.x + normal.y * 0.48) * 40;
    const normalY = 153 + (-normal.z * 1.08 - normal.y * 0.31) * 40;
    ui.normalArrow.setAttribute('x2', String(normalX));
    ui.normalArrow.setAttribute('y2', String(normalY));
    ui.normalLabel.setAttribute('x', String(normalX + 5));
    ui.normalLabel.setAttribute('y', String(normalY - 2));

    const vectorLabel = document.querySelector('.vector-label');
    if (vectorLabel) { vectorLabel.setAttribute('x', String(x2 + 5)); vectorLabel.setAttribute('y', String(y2 - 2)); }
    const components = [vector.x, vector.y, vector.z];
    [ui.componentP, ui.componentQ, ui.componentR].forEach((node, i) => { node.textContent = components[i].toFixed(2); });
    const areas = [normal.x, normal.y, normal.z];
    [ui.areaP, ui.areaQ, ui.areaR].forEach((node, i) => {
      node.textContent = `${['dy dz', 'dz dx', 'dx dy'][i]} = ${areas[i].toFixed(2)}`;
    });
    const terms = components.map((component, i) => component * areas[i]);
    const total = terms.reduce((sum, term) => sum + term, 0);
    const num = value => Math.abs(value).toFixed(2);
    const signedTerm = (value, first) => `${first && value < 0 ? '-' : first ? '' : value < 0 ? '-' : '+'}${num(value)}`;
    renderMath(ui.numericFormula, `\\mathrm{d}S=1\\,\\mathrm{m^2}:\\quad ${terms.map((term, i) => signedTerm(term, i === 0)).join(' ')}=${total < 0 ? '-' : '+'}${num(total)}\\,\\mathrm{m^3/s}`);
    updateComponentArrow(ui.arrowP, ui.labelP, [99, 153], [36, 0], components[0]);
    updateComponentArrow(ui.arrowQ, ui.labelQ, [171, 195], [24, -16], components[1]);
    updateComponentArrow(ui.arrowR, ui.labelR, [199, 188], [0, -38], components[2]);

    [ui.planeYZ, ui.planeZX, ui.planeXY].forEach((plane, index) => plane.classList.toggle('is-focused', state.projectionFocus === index));
    [ui.shadowYZ, ui.shadowZX, ui.shadowXY].forEach((patch, index) => patch.classList.toggle('is-focused', state.projectionFocus === index));
  }

  function updateComponentArrow(line, label, origin, unit, value) {
    const amount = Math.min(1.25, Math.abs(value));
    const direction = value < 0 ? -1 : 1;
    const dx = unit[0] * amount * direction;
    const dy = unit[1] * amount * direction;
    line.setAttribute('x1', String(origin[0] - dx * 0.45));
    line.setAttribute('y1', String(origin[1] - dy * 0.45));
    line.setAttribute('x2', String(origin[0] + dx * 0.55));
    line.setAttribute('y2', String(origin[1] + dy * 0.55));
    line.style.opacity = String(Math.abs(value) < 0.04 ? 0.17 : 0.35 + Math.min(0.65, Math.abs(value) * 0.32));
    label.setAttribute('x', String(origin[0] + dx * 0.2 + 3));
    label.setAttribute('y', String(origin[1] + dy * 0.2 - 5));
  }

  function createProjectionStreams() {
    if (!ui.projectionStreams) return;
    const ns = 'http://www.w3.org/2000/svg';
    const paths = [
      { start: [58, 153], end: [139, 153], color: '#2563eb' },
      { start: [144, 214], end: [196, 179], color: '#059669' },
      { start: [199, 234], end: [199, 141], color: '#d97706' }
    ];
    paths.forEach((path, axis) => {
      for (let i = 0; i < 6; i++) {
        const node = document.createElementNS(ns, 'circle');
        node.setAttribute('r', i % 3 === 0 ? '3.1' : '2.2');
        node.setAttribute('fill', path.color);
        node.setAttribute('stroke', '#ffffff');
        node.setAttribute('stroke-width', '0.7');
        ui.projectionStreams.appendChild(node);
        projectionParticles.push({ node, axis, index: i, path });
      }
    });
  }

  function animateProjectionStreams(timestamp) {
    requestAnimationFrame(animateProjectionStreams);
    const delta = lastProjectionFrame ? Math.min((timestamp - lastProjectionFrame) / 1000, 0.05) : 0;
    lastProjectionFrame = timestamp;
    if (state.particlesOn && !wantsReducedMotion()) projectionTime += delta;
    const vector = window.THREE ? probeVectorAt(probePoint()) : { x: 0, y: 0, z: 0 };
    const components = [vector.x, vector.y, vector.z];
    projectionParticles.forEach(({ node, axis, index, path }) => {
      const value = components[axis];
      const magnitude = Math.abs(value);
      const active = state.projectionFocus < 0 || state.projectionFocus === axis;
      const phase = (index / 6 + projectionTime * (0.2 + magnitude * 0.32)) % 1;
      const travel = value < 0 ? 1 - phase : phase;
      node.setAttribute('cx', String(path.start[0] + (path.end[0] - path.start[0]) * travel));
      node.setAttribute('cy', String(path.start[1] + (path.end[1] - path.start[1]) * travel));
      node.style.opacity = magnitude < 0.035 ? '0' : active ? '0.88' : '0.11';
    });
  }

  function integrateFlux() {
    if (state.shape === 'open' && state.lessonIndex === 1) return { net: 0, inflow: 0, outflow: 0 };
    if (!surfaceGeometry || !window.THREE) return fallbackFlux();
    const T = window.THREE;
    const positions = surfaceGeometry.attributes.position;
    const index = surfaceGeometry.index;
    const parts = { net: 0, inflow: 0, outflow: 0 };
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
    const ab = new T.Vector3(), ac = new T.Vector3(), areaVector = new T.Vector3(), center = new T.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(positions, index.getX(i));
      b.fromBufferAttribute(positions, index.getX(i + 1));
      c.fromBufferAttribute(positions, index.getX(i + 2));
      ab.subVectors(b, a); ac.subVectors(c, a);
      areaVector.crossVectors(ab, ac).multiplyScalar(0.5 * state.orientation);
      center.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      const contribution = fieldVectorAt(center).dot(areaVector);
      parts.net += contribution;
      if (contribution >= 0) parts.outflow += contribution;
      else parts.inflow -= contribution;
    }
    return parts;
  }

  function fallbackFlux() {
    if (state.shape === 'open' && state.lessonIndex === 1) return { net: 0, inflow: 0, outflow: 0 };
    if (state.shape === 'closed') {
      if (state.field === 'source') {
        const volumeFlow = 4 * Math.PI * Math.pow(SPHERE_RADIUS, 3) * state.speed;
        return { net: state.orientation * volumeFlow, inflow: state.orientation < 0 ? volumeFlow : 0, outflow: state.orientation > 0 ? volumeFlow : 0 };
      }
      const crossing = Math.PI * SPHERE_RADIUS * SPHERE_RADIUS * state.speed;
      return { net: 0, inflow: crossing, outflow: crossing };
    }
    const samples = 48;
    const delta = (2 * OPEN_HALF) / samples;
    const parts = { net: 0, inflow: 0, outflow: 0 };
    for (let j = 0; j < samples; j++) {
      const y = -OPEN_HALF + (j + 0.5) * delta;
      for (let i = 0; i < samples; i++) {
        const x = -OPEN_HALF + (i + 0.5) * delta;
        const dx = (openHeight(x + 0.005, y) - openHeight(x - 0.005, y)) / 0.01;
        const dy = (openHeight(x, y + 0.005) - openHeight(x, y - 0.005)) / 0.01;
        const z = openHeight(x, y);
        const p = state.field === 'vertical' ? 0 : state.field === 'horizontal' ? state.speed : x * state.speed;
        const q = state.field === 'source' ? y * state.speed : 0;
        const r = state.field === 'vertical' ? state.speed : state.field === 'source' ? z * state.speed : 0;
        const contribution = state.lessonIndex === 0
          ? state.speed * Math.hypot(dx, dy, 1) * delta * delta
          : state.orientation * (-p * dx - q * dy + r) * delta * delta;
        parts.net += contribution;
        if (contribution >= 0) parts.outflow += contribution;
        else parts.inflow -= contribution;
      }
    }
    return parts;
  }

  function updateFlux(animateValue) {
    const parts = integrateFlux();
    state.totalFlux = parts.net;
    state.fluxParts = parts;
    const target = Math.abs(state.totalFlux) < 0.005 ? 0 : state.totalFlux;
    if (window.gsap && animateValue && !wantsReducedMotion()) {
      fluxMotion.value = Number.isFinite(fluxMotion.value) ? fluxMotion.value : 0;
      window.gsap.to(fluxMotion, { value: target, duration: 0.48, ease: 'power2.out', onUpdate: () => renderFluxValue(fluxMotion.value) });
    } else {
      fluxMotion.value = target;
      renderFluxValue(target);
    }
    renderFlowBasins(parts);
    renderGaussBanner();
  }

  function renderFlowBasins(parts) {
    if (!ui.inflowValue) return;
    const incoming = parts.inflow;
    const outgoing = parts.outflow;
    const max = Math.max(incoming, outgoing, 0.01);
    ui.inflowValue.textContent = incoming.toFixed(2);
    ui.outflowValue.textContent = outgoing.toFixed(2);
    ui.inflowWater.style.height = `${incoming / max * 31}px`;
    ui.outflowWater.style.height = `${outgoing / max * 31}px`;
    ui.balanceEquation.textContent = `出流 ${outgoing.toFixed(2)} − 入流 ${incoming.toFixed(2)} = ${signedNumber(parts.net)} m³/s`;
  }

  function signedNumber(value) {
    if (Math.abs(value) < 0.005) return '0.00';
    return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;
  }

  function fluxSign(value) {
    return Math.abs(value) < 0.015 ? 'zero' : value > 0 ? 'positive' : 'negative';
  }

  function renderFluxValue(value) {
    const sign = fluxSign(value);
    const formatted = signedNumber(value);
    ui.fluxTop.textContent = formatted;
    ui.fluxBottom.textContent = formatted;
    ui.fluxBadge.dataset.sign = sign;
    ui.meterReadout.dataset.sign = sign;
    ui.sceneLed.className = `led ${sign === 'negative' ? 'led-amber' : sign === 'zero' ? '' : 'led-positive'}`;
    ui.sceneStatus.textContent = sign === 'zero' && state.shape === 'closed' ? '进出相抵' : sign === 'negative' ? '逆法向灌入' : ui.flipLabel.textContent;
    ui.meterSign.textContent = sign === 'negative' ? '净流入' : sign === 'zero' ? '进出抵消' : '净流出';
    const percent = Math.min(48, Math.abs(value) / 44 * 48);
    ui.meterFill.style.width = `${percent}%`;
    ui.meterFill.style.left = sign === 'negative' ? `calc(50% - ${percent}%)` : '50%';
    ui.meterFill.dataset.sign = sign;
    ui.gaussValue.textContent = sign === 'zero' ? '净流量 0' : `${sign === 'negative' ? '净流入 ' : '净流出 '}${Math.abs(value).toFixed(2)}`;
  }

  function renderGaussBanner() {
    const show = state.shape === 'closed';
    ui.gaussBanner.hidden = !show;
    if (!show) return;
    if (state.field === 'source') {
      ui.gaussTitle.textContent = state.orientation > 0 ? '闭曲面包围源泉：每个网眼都向外流出' : '法向朝内：流体仍向外运动，但记作负通量';
      renderMath(ui.gaussFormula, `\\begin{aligned}\\oiint_{\\Sigma} (&P\\,\\mathrm{d}y\\,\\mathrm{d}z+Q\\,\\mathrm{d}z\\,\\mathrm{d}x\\\\&+R\\,\\mathrm{d}x\\,\\mathrm{d}y)=\\text{${state.orientation > 0 ? '净流出量' : '按所选法向的净流量'}} ${state.orientation > 0 ? '>0' : '<0'}\\end{aligned}`);
    } else {
      ui.gaussTitle.textContent = '无源均匀流穿过球壳：迎风入流与背风出流抵消';
      renderMath(ui.gaussFormula, `\\oiint_{\\Sigma} \\vec v\\cdot\\vec n\\,\\mathrm{d}S = \\text{流出量}-\\text{流入量}=0`);
    }
  }

  function renderStaticMath() {
    renderMath(ui.dotFormula, `\\mathrm{d}\\Phi = (\\vec v\\cdot\\vec n)\\,\\mathrm{d}S`);
    renderMath(ui.projectionFormula, `\\mathrm{d}\\Phi = P\\,\\mathrm{d}y\\,\\mathrm{d}z + Q\\,\\mathrm{d}z\\,\\mathrm{d}x + R\\,\\mathrm{d}x\\,\\mathrm{d}y`);
  }

  function renderMath(node, latex) {
    if (!node) return;
    if (window.katex && typeof window.katex.render === 'function') {
      window.katex.render(latex, node, { throwOnError: false, strict: 'ignore' });
    } else {
      node.textContent = latex.replace(/\\mathrm\{([^}]+)\}/g, '$1').replace(/\\vec/g, '').replace(/[{}\\]/g, '');
    }
  }

  function createParticles() {
    if (!scene || !window.THREE) return;
    const T = window.THREE;
    particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    particleTrails = new Float32Array(PARTICLE_COUNT * 6);
    particleVelocities = new Float32Array(PARTICLE_COUNT * 3);
    const pointGeometry = new T.BufferGeometry();
    pointGeometry.setAttribute('position', new T.BufferAttribute(particlePositions, 3).setUsage(T.DynamicDrawUsage));
    particlePoints = new T.Points(pointGeometry, new T.PointsMaterial({ color: 0x2563eb, size: 0.055, transparent: true, opacity: 0.78, depthWrite: false, sizeAttenuation: true }));
    particlePoints.frustumCulled = false;
    const trailGeometry = new T.BufferGeometry();
    trailGeometry.setAttribute('position', new T.BufferAttribute(particleTrails, 3).setUsage(T.DynamicDrawUsage));
    trailLines = new T.LineSegments(trailGeometry, new T.LineBasicMaterial({ color: 0x6a93d8, transparent: true, opacity: 0.32, depthWrite: false }));
    trailLines.frustumCulled = false;
    particleGroup.add(trailLines, particlePoints);
    resetParticles();
  }

  function resetParticle(i) {
    if (!particlePositions) return;
    const offset = i * 3;
    if (state.shape === 'open' && (state.lessonIndex === 0 || state.lessonIndex === 1)) {
      const x = (Math.random() - 0.5) * 3.8;
      const y = (Math.random() - 0.5) * 2.8;
      particlePositions[offset] = x;
      particlePositions[offset + 1] = y;
      particlePositions[offset + 2] = openHeight(x, y) + (Math.random() - 0.5) * (state.lessonIndex === 0 ? 1.8 : 0.13);
    } else if (state.field === 'vertical') {
      particlePositions[offset] = (Math.random() - 0.5) * 3.8;
      particlePositions[offset + 1] = (Math.random() - 0.5) * 3.8;
      particlePositions[offset + 2] = -1.8 + Math.random() * 3.8;
    } else if (state.field === 'horizontal') {
      particlePositions[offset] = -2.1 + Math.random() * 4.2;
      particlePositions[offset + 1] = (Math.random() - 0.5) * 3.5;
      particlePositions[offset + 2] = (Math.random() - 0.5) * 3.2;
    } else {
      const direction = new window.THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const radius = 0.16 + Math.random() * 0.42;
      particlePositions[offset] = direction.x * radius;
      particlePositions[offset + 1] = direction.y * radius;
      particlePositions[offset + 2] = direction.z * radius;
    }
    if (particleTrails) {
      const trailOffset = i * 6;
      particleTrails[trailOffset] = particlePositions[offset] - 0.06;
      particleTrails[trailOffset + 1] = particlePositions[offset + 1];
      particleTrails[trailOffset + 2] = particlePositions[offset + 2];
      particleTrails[trailOffset + 3] = particlePositions[offset];
      particleTrails[trailOffset + 4] = particlePositions[offset + 1];
      particleTrails[trailOffset + 5] = particlePositions[offset + 2];
    }
  }

  function resetParticles() {
    if (!particlePositions) return;
    for (let i = 0; i < PARTICLE_COUNT; i++) resetParticle(i);
    if (particlePoints) particlePoints.geometry.attributes.position.needsUpdate = true;
    if (trailLines) trailLines.geometry.attributes.position.needsUpdate = true;
  }

  function updateParticles(delta) {
    if (!particlePositions || !state.particlesOn || !window.THREE) return;
    const T = window.THREE;
    const pos = new T.Vector3();
    const velocity = new T.Vector3();
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const offset = i * 3, trailOffset = i * 6;
      pos.set(particlePositions[offset], particlePositions[offset + 1], particlePositions[offset + 2]);
      velocity.copy(fieldVectorAt(pos));
      if (state.field === 'source' && velocity.lengthSq() < 0.0001) velocity.set(0, 0, 1);
      velocity.multiplyScalar(state.field === 'source' ? 0.62 * delta : 0.58 * delta);
      pos.add(velocity);
      const outside = Math.max(Math.abs(pos.x), Math.abs(pos.y), Math.abs(pos.z)) > 2.15;
      if (outside || (state.field === 'source' && pos.length() > 2.35)) {
        resetParticle(i);
        continue;
      }
      particlePositions[offset] = pos.x;
      particlePositions[offset + 1] = pos.y;
      particlePositions[offset + 2] = pos.z;
      const direction = velocity.lengthSq() > 0 ? velocity.clone().normalize() : new T.Vector3(0, 0, 1);
      particleTrails[trailOffset] = pos.x - direction.x * 0.16;
      particleTrails[trailOffset + 1] = pos.y - direction.y * 0.16;
      particleTrails[trailOffset + 2] = pos.z - direction.z * 0.16;
      particleTrails[trailOffset + 3] = pos.x;
      particleTrails[trailOffset + 4] = pos.y;
      particleTrails[trailOffset + 5] = pos.z;
    }
    particlePoints.geometry.attributes.position.needsUpdate = true;
    trailLines.geometry.attributes.position.needsUpdate = true;
  }

  function createSourceMarker() {
    if (!scene || !window.THREE) return;
    const T = window.THREE;
    const core = new T.Mesh(new T.SphereGeometry(0.09, 18, 14), new T.MeshBasicMaterial({ color: 0xd97706 }));
    const ring = new T.Mesh(new T.TorusGeometry(0.17, 0.012, 8, 48), new T.MeshBasicMaterial({ color: 0x059669, transparent: true, opacity: 0.75 }));
    const ring2 = new T.Mesh(new T.TorusGeometry(0.26, 0.008, 8, 48), new T.MeshBasicMaterial({ color: 0x059669, transparent: true, opacity: 0.35 }));
    sourceGroup.add(core, ring, ring2);
    sourceGroup.userData.rings = [ring, ring2];
    sourceGroup.visible = false;
  }

  function animate() {
    if (!renderer || !scene || !camera) return;
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.04);
    if (controls) controls.update();
    updateParticles(delta);
    if (state.particlesOn && !wantsReducedMotion()) {
      localParticleFrame += delta * state.speed;
      updateLocalParticleBeam();
    }
    if (sourceGroup && sourceGroup.visible) {
      const t = clock.elapsedTime;
      sourceGroup.userData.rings.forEach((ring, i) => {
        const wave = (t * 0.32 + i * 0.48) % 1;
        ring.scale.setScalar(0.82 + wave * 1.18);
        ring.material.opacity = 0.68 * (1 - wave);
      });
    }
    renderer.render(scene, camera);
  }

  function resizeScene() {
    if (!renderer || !camera || !ui.sceneViewport) return;
    const rect = ui.sceneViewport.getBoundingClientRect();
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  document.addEventListener('DOMContentLoaded', init, { once: true });
})();
