/**
 * 三维舞台外壳：渲染器、相机与轨道控制、灯光、地面网格与参考轴、拖拽、自适应尺寸与渲染循环。
 * 两个模块的构件由 StageA、StageB 各自构建与按帧渲染；这里只负责共用部分与模块切换。
 */
const Stage = (() => {
  let container, renderer, scene, camera, controls, grid, axes;
  let cameraTween = null;
  let dragHandler = null;
  let dragging = null;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragOffset = new THREE.Vector3();

  const VIEW = {
    A: { p: [7.6, -9.2, 6.6], t: [0, 0, 0.4] },
    B: { p: [7.2, -8.6, 5.4], t: [0, 0, 1.0] }
  };

  function init(el, onDrag) {
    container = el;
    dragHandler = onDrag;
    THREE.Object3D.DefaultUp.set(0, 0, 1);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xFAF9F5);
    camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 200);
    camera.position.set(...VIEW.A.p);
    camera.lookAt(...VIEW.A.t);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.target.set(...VIEW.A.t);
    controls.minDistance = 2.5;
    controls.maxDistance = 34;

    scene.add(new THREE.AmbientLight(0xffffff, 0.86));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(9, 10, 13);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xE7E5DF, 0.3);
    fill.position.set(-10, -9, -6);
    scene.add(fill);

    grid = new THREE.GridHelper(12, 24, 0xDCD8CE, 0xEAE7DF);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 0, -0.005);
    scene.add(grid);

    axes = new THREE.Group();
    const axis = (from, to, color) => {
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      const geo = new THREE.CylinderGeometry(0.012, 0.012, len, 10).translate(0, len / 2, 0).rotateX(Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }));
      m.position.copy(from);
      m.lookAt(to);
      axes.add(m);
    };
    const L = 5.4;
    axis(new THREE.Vector3(-L * 0.72, 0, 0), new THREE.Vector3(L, 0, 0), 0x9C8F7F);
    axis(new THREE.Vector3(0, -L * 0.72, 0), new THREE.Vector3(0, L, 0), 0x9C8F7F);
    axis(new THREE.Vector3(0, 0, -L * 0.72), new THREE.Vector3(0, 0, L), 0x9C8F7F);
    [['x', [L + 0.32, 0, 0]], ['y', [0, L + 0.32, 0]], ['z', [0, 0, L + 0.32]]].forEach(([s, p]) => {
      const sp = Core.label('eq', '#6B7066');
      Core.setLabel(sp, s, '#6B7066');
      sp.position.set(...p);
      sp.visible = true;
      axes.add(sp);
    });
    scene.add(axes);

    StageA.build(scene);
    StageB.build(scene);
    setModule('A');

    renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    new ResizeObserver(resize).observe(container);
    animate();
  }

  // 底部讲解卡会遮住下方约 40% 的舞台，所以把画面整体上移，几何主体留在可见区域
  function resize() {
    if (!container || !renderer) return;
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.setViewOffset(w, h, 0, h * 0.16, w, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  function setModule(m) {
    StageA.setVisible(m === 'A');
    StageB.setVisible(m === 'B');
    grid.visible = m === 'A';
  }

  function resetCamera(m) {
    const to = VIEW[m];
    if (typeof gsap === 'undefined') {
      camera.position.set(...to.p);
      controls.target.set(...to.t);
      return;
    }
    if (cameraTween) cameraTween.kill();
    cameraTween = gsap.timeline();
    cameraTween.to(camera.position, { x: to.p[0], y: to.p[1], z: to.p[2], duration: 0.7, ease: 'power2.out' }, 0);
    cameraTween.to(controls.target, { x: to.t[0], y: to.t[1], z: to.t[2], duration: 0.7, ease: 'power2.out' }, 0);
  }

  // 可拖动的手柄：A 为锚点与方向手柄，B 为点与方向手柄
  function dragTargets(m) {
    return m === 'A'
      ? [[StageA.G.P1, 'P1'], [StageA.G.P2, 'P2'], [StageA.G.D1, 'D1'], [StageA.G.D2, 'D2']]
      : [[StageB.G.P, 'C'], [StageB.G.D, 'D']];
  }

  function setPointer(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function pick(m) {
    raycaster.setFromCamera(pointer, camera);
    const targets = dragTargets(m);
    const hits = raycaster.intersectObjects(targets.map(t => t[0]), false);
    if (!hits.length) return null;
    return targets.find(t => t[0] === hits[0].object) || null;
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    setPointer(e);
    const hit = pick(currentModule);
    if (!hit) return;
    dragging = hit;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    dragPlane.setFromNormalAndCoplanarPoint(camDir, hit[0].position);
    const at = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, at);
    dragOffset.copy(hit[0].position).sub(at);
    controls.enabled = false;
    renderer.domElement.style.cursor = 'grabbing';
  }

  function onPointerMove(e) {
    setPointer(e);
    if (!dragging) {
      renderer.domElement.style.cursor = pick(currentModule) ? 'grab' : '';
      return;
    }
    raycaster.setFromCamera(pointer, camera);
    const at = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, at)) {
      dragHandler(dragging[1], at.add(dragOffset));
    }
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = null;
    controls.enabled = true;
    renderer.domElement.style.cursor = '';
  }

  let currentModule = 'A';
  function setCurrentModule(m) { currentModule = m; }

  return { init, setModule, resetCamera, setCurrentModule, resize };
})();
