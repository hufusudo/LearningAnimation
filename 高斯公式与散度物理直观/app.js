/**
 * 高斯公式与散度物理直观 · 核心交互、动画状态机与计算
 * ---------------------------------------------------------------------------
 * 模式 1  源汇对消（散度物理直觉）：分离观察 → 靠拢贴合 → 宏观结算
 * 模式 2  8 微元拼合与连续剖分：爆炸拆解 → 贴合湮灭 → N=1→8→64→连续体
 * 模式 3  挖洞法与奇点处理：危机报警 → 挖辅助球壳 → 夹心层法向 → 形变等价
 *
 * 防呆铁律：任何 Tab 切换 / 复位 / 单步 / 拖动滑块之前，先 killTweensOf('*') 清场。
 */
(function () {
  'use strict';

  /* ==================================================================
   * 0. 工具与全局状态
   * ================================================================== */
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const easeOutBack = (t) => { const c1 = 1.4, c3 = c1 + 1; const u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  const C = {
    amber: 0xD97706, emerald: 0x059669, blue: 0x2563EB,
    stone: 0x57534E, ink: 0x1C1917, white: 0xFFFFFF, rose: 0xF43F5E
  };

  const State = {
    mode: 0,
    beat: 0,
    progress: 0,     // 连续进度 0..1（各模式语义不同）
    sub: 0.3,        // 模式 2 剖分滑块
    preset: 'sink',  // 模式 1 对比预设
    speed: 1,
    playing: false,
    timer: null,
    tw: null,
    orbiting: false
  };

  let camera = null, controls = null, renderer = null, scene = null, clock = null;
  const Modes = [];

  /** 防呆铁律 1：彻底清空未完成补间与计时器 */
  function hardStop() {
    if (window.gsap) {
      gsap.killTweensOf('*');                                  // 全局补间清场
      gsap.killTweensOf(State);
      if (State.tw) gsap.killTweensOf(State.tw);
      if (camera) gsap.killTweensOf(camera.position);
      if (controls) gsap.killTweensOf(controls.target);
      gsap.set('#hud', { opacity: 1, y: 0 });                  // 防止 HUD 卡在半透明
    }
    if (State.timer) { State.timer.kill(); State.timer = null; }
    if (State.tw) { State.tw = null; }
    State.playing = false;
    syncPlayBtn();
  }

  /** 防呆铁律 3：公式一律 katex.render 局部刷新 */
  const fxCache = {};
  function renderLatex(el, tex) {
    if (!el) return;
    if (fxCache[el.id] === tex) return;
    fxCache[el.id] = tex;
    if (!tex) { el.textContent = ''; return; }
    if (window.katex) {
      try { katex.render(tex, el, { throwOnError: false, displayMode: true }); return; }
      catch (e) { /* 落回纯文本 */ }
    }
    el.textContent = tex;
  }
  function resetFxCache() {
    Object.keys(fxCache).forEach((k) => delete fxCache[k]);
    balSig = '';
    chipSig = '';
  }
  const dur = (sec) => sec / State.speed;
  const activeMode = () => Modes[State.mode];

  /* ==================================================================
   * 1. Three.js 核心：场景 / 相机 / 防呆自适应
   * ================================================================== */
  function initThree() {
    const host = $('canvas-host');
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
    camera.position.set(0.9, 2.3, 5.6);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.2;
    controls.maxDistance = 18;
    controls.addEventListener('start', () => { State.orbiting = true; if (window.gsap) { gsap.killTweensOf(camera.position); gsap.killTweensOf(controls.target); } });
    controls.addEventListener('end', () => { State.orbiting = false; });

    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 0.62); key.position.set(4, 6, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.3); rim.position.set(-5, -2, -4); scene.add(rim);

    // 坐标参考网格（淡纸质网格，不喧宾夺主）
    const grid = new THREE.GridHelper(16, 16, 0xE5E4DC, 0xF0EFE8);
    grid.position.y = -1.7;
    grid.material.transparent = true; grid.material.opacity = 0.75;
    scene.add(grid);

    clock = new THREE.Clock();
    resize();
    // 铁律 3.5：监听 resize 动态重算相机宽高比与画布尺寸
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
    if (!window.ResizeObserver) setInterval(resize, 1500);
  }

  function resize() {
    if (!renderer) return;
    const host = $('canvas-host');
    const w = Math.max(host.clientWidth, 1);
    const h = Math.max(host.clientHeight, 1);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (controls) controls.update();
    for (let i = 0; i < Modes.length; i++) {
      if (Modes[i].group.visible) Modes[i].update(t, dt);
    }
    renderer.render(scene, camera);
  }

  function flyCamera(pos, target) {
    if (State.orbiting || !camera) return;
    const tg = target || [0, 0, 0];
    if (window.gsap) {
      gsap.to(camera.position, { x: pos[0], y: pos[1], z: pos[2], duration: dur(1.0), ease: 'power2.inOut', overwrite: 'auto' });
      gsap.to(controls.target, { x: tg[0], y: tg[1], z: tg[2], duration: dur(1.0), ease: 'power2.inOut', overwrite: 'auto' });
    } else {
      camera.position.set(pos[0], pos[1], pos[2]);
      controls.target.set(tg[0], tg[1], tg[2]);
    }
  }

  /* ==================================================================
   * 2. 几何工具：合并 / 箭头 / 粒子云
   * ================================================================== */
  function mergeGeos(items) {           // items: [{geo, id}] → 合并三角几何 + 每顶点微元编号
    const prepped = items.map((it) => {
      const g = it.geo.index ? it.geo.toNonIndexed() : it.geo;
      return { g, id: it.id, src: it.geo };
    });
    let count = 0;
    prepped.forEach((p) => { count += p.g.attributes.position.count; });
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const ids = new Uint16Array(count);
    let off = 0, vi = 0;
    prepped.forEach((p) => {
      const pa = p.g.attributes.position.array;
      const na = p.g.attributes.normal ? p.g.attributes.normal.array : null;
      pos.set(pa, off);
      if (na) nor.set(na, off);
      for (let i = 0; i < p.g.attributes.position.count; i++) ids[vi + i] = p.id;
      off += pa.length; vi += p.g.attributes.position.count;
      if (p.g !== p.src) p.src.dispose();
      p.g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return { geo, ids, base: pos.slice(0) };
  }

  function mergeLines(items) {          // 合并线段几何（EdgesGeometry 等，无法线）
    const prepped = items.map((it) => ({ g: it.geo.index ? it.geo.toNonIndexed() : it.geo, id: it.id, src: it.geo }));
    let count = 0;
    prepped.forEach((p) => { count += p.g.attributes.position.count; });
    const pos = new Float32Array(count * 3);
    const ids = new Uint16Array(count);
    let off = 0, vi = 0;
    prepped.forEach((p) => {
      const pa = p.g.attributes.position.array;
      pos.set(pa, off);
      for (let i = 0; i < p.g.attributes.position.count; i++) ids[vi + i] = p.id;
      off += pa.length; vi += p.g.attributes.position.count;
      if (p.g !== p.src) p.src.dispose();
      p.g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { geo, ids, base: pos.slice(0) };
  }

  /** 从 origin 沿 dir 射出长度 len 的矢量箭头（杆 + 锥头） */
  function arrowGeo(origin, dir, len) {
    const headLen = len * 0.42;
    const shaftLen = Math.max(len - headLen, 0.001);
    const r = Math.max(len * 0.05, 0.006);
    const shaft = new THREE.CylinderGeometry(r, r, shaftLen, 6, 1, false);
    shaft.translate(0, shaftLen / 2, 0);
    const head = new THREE.ConeGeometry(r * 3.4, headLen, 8);
    head.translate(0, shaftLen + headLen / 2, 0);
    const g = mergeGeosPlain([shaft, head]);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir.clone().normalize());
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));   // r128 BufferGeometry 无 applyQuaternion
    g.translate(origin.x, origin.y, origin.z);
    return g;
  }
  function mergeGeosPlain(geos) {       // 纯几何合并（无微元编号）
    const items = geos.map((geo) => ({ geo, id: 0 }));
    return mergeGeos(items).geo;
  }

  function makeCloud(n, color, size) {
    const pos = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return { pts, pos, geo, mat, n, r: new Float32Array(n), dirs: new Float32Array(n * 3), sign: 1, rMin: 0.06, rMax: 1 };
  }

  function seedCloud(cloud, sign, rMin, rMax, jitter) {
    cloud.sign = sign; cloud.rMin = rMin; cloud.rMax = rMax;
    for (let i = 0; i < cloud.n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      cloud.dirs[i * 3] = s * Math.cos(th);
      cloud.dirs[i * 3 + 1] = s * Math.sin(th);
      cloud.dirs[i * 3 + 2] = u;
      cloud.r[i] = rMin + Math.random() * (rMax - rMin);
      if (jitter) cloud.r[i] = rMin;
    }
  }

  function updateCloud(cloud, cx, cy, cz, dt, speed) {
    const { dirs, r, pos, n } = cloud;
    for (let i = 0; i < n; i++) {
      r[i] += dt * speed * cloud.sign * (0.6 + (i % 7) * 0.09);
      if (cloud.sign > 0 && r[i] > cloud.rMax) r[i] = cloud.rMin;
      if (cloud.sign < 0 && r[i] < cloud.rMin) r[i] = cloud.rMax;
      const j = i * 3;
      pos[j] = cx + dirs[j] * r[i];
      pos[j + 1] = cy + dirs[j + 1] * r[i];
      pos[j + 2] = cz + dirs[j + 2] * r[i];
    }
    cloud.geo.attributes.position.needsUpdate = true;
  }

  /* ==================================================================
   * 3. 模式 1：源汇对消机制
   * ================================================================== */
  function cellMeshes(kind, ifaceIdx) {
    const grp = new THREE.Group();
    const color = kind === 'source' ? C.amber : kind === 'sink' ? C.emerald : C.blue;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const box = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0.15, roughness: 0.92, metalness: 0, depthWrite: false
    }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    grp.add(box, edges);

    const faces = [V3(1, 0, 0), V3(-1, 0, 0), V3(0, 1, 0), V3(0, -1, 0), V3(0, 0, 1), V3(0, 0, -1)];
    const normalGeos = [], ifaceGeos = [];

    if (kind !== 'none') {
      faces.forEach((n, idx) => {
        let origin, dir;
        if (idx === ifaceIdx) {
          // 界面箭头：一律沿该面外法向（A→朝右 / B→朝左），二者头对头
          origin = n.clone().multiplyScalar(0.5);
          dir = n.clone();
        } else if (kind === 'source') {
          origin = n.clone().multiplyScalar(0.5); dir = n.clone();          // 向外喷发
        } else {
          origin = n.clone().multiplyScalar(1.05); dir = n.clone().negate(); // 向心吸附
        }
        const geo = arrowGeo(origin, dir, 0.5);
        (idx === ifaceIdx ? ifaceGeos : normalGeos).push(geo);
      });
    }

    const matArrow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
    const matIface = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
    let arrows = null, iface = null;
    if (normalGeos.length) {
      arrows = new THREE.Mesh(mergeGeosPlain(normalGeos), matArrow);
      arrows.frustumCulled = false; grp.add(arrows);
    }
    if (ifaceGeos.length) {
      iface = new THREE.Mesh(mergeGeosPlain(ifaceGeos), matIface);
      iface.frustumCulled = false; grp.add(iface);
    }
    // 无源微元：只当管道导流（贯穿通道）
    let channel = null;
    if (kind === 'none') {
      const cg = new THREE.CylinderGeometry(0.035, 0.035, 1.15, 10);
      cg.rotateZ(Math.PI / 2);
      channel = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: C.blue, transparent: true, opacity: 0.85, depthWrite: false }));
      grp.add(channel);
    }
    return { group: grp, matArrow, matIface, iface, arrows, channel };
  }

  function disposeChildren(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material.dispose(); }
    });
    while (obj.children.length) obj.remove(obj.children[0]);
  }

  function createMode1() {
    const group = new THREE.Group();
    const BKind = { sink: 'sink', source: 'source', none: 'none' };
    const kindOf = (p) => BKind[p];

    const cellA = cellMeshes('source', 0);   // A：源点，界面为 +X 面
    let cellB = cellMeshes(kindOf(State.preset), 1); // B：汇/源/无源，界面为 -X 面
    group.add(cellA.group, cellB.group);

    // 宏观虚线边界
    const bGeo = new THREE.BoxGeometry(2.7, 1.7, 1.7);
    const boundary = new THREE.LineSegments(new THREE.EdgesGeometry(bGeo),
      new THREE.LineDashedMaterial({ color: C.stone, dashSize: 0.14, gapSize: 0.1, transparent: true, opacity: 0.55 }));
    boundary.computeLineDistances();
    group.add(boundary);

    // 内部直通流线
    const lg = new THREE.CylinderGeometry(0.032, 0.032, 2.6, 10);
    lg.rotateZ(Math.PI / 2);
    const throughLine = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: C.blue, transparent: true, opacity: 0, depthWrite: false }));
    throughLine.frustumCulled = false;
    group.add(throughLine);

    // 源+源 对撞阻断墙
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.06, 1.06),
      new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0, depthWrite: false }));
    barrier.frustumCulled = false;
    group.add(barrier);

    // 外表面通量箭头组（贴合后出现，逐预设重建）
    const outerGroup = new THREE.Group();
    group.add(outerGroup);

    // 粒子：A 喷发 / B 吸附
    const cloudA = makeCloud(110, C.amber, 0.055);
    seedCloud(cloudA, +1, 0.05, 1.35);
    const cloudB = makeCloud(95, C.emerald, 0.055);
    seedCloud(cloudB, -1, 0.12, 1.45);
    group.add(cloudA.pts, cloudB.pts);

    function divB() { return State.preset === 'sink' ? -1 : State.preset === 'source' ? 1 : 0; }
    function sum() { return 1 + divB(); }

    function buildOuter() {
      disposeChildren(outerGroup);
      const s = sum();
      const ext = [[V3(1.35, 0, 0), V3(1, 0, 0)], [V3(-1.35, 0, 0), V3(-1, 0, 0)],
      [V3(0, 0.85, 0), V3(0, 1, 0)], [V3(0, -0.85, 0), V3(0, -1, 0)],
      [V3(0, 0, 0.85), V3(0, 0, 1)], [V3(0, 0, -0.85), V3(0, 0, -1)]];
      const outG = [], inG = [];
      ext.forEach((e, i) => {
        const base = e[0], n = e[1];
        const outward = s > 0 ? true : s < 0 ? false : (i % 2 === 0); // sum=0 → 一出一进
        if (outward) outG.push(arrowGeo(base.clone(), n.clone(), 0.55));
        else inG.push(arrowGeo(base.clone().addScaledVector(n, 0.62), n.clone().negate(), 0.55));
      });
      if (outG.length) {
        const m = new THREE.Mesh(mergeGeosPlain(outG), new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0, depthWrite: false }));
        m.frustumCulled = false; outerGroup.add(m);
      }
      if (inG.length) {
        const m = new THREE.Mesh(mergeGeosPlain(inG), new THREE.MeshBasicMaterial({ color: C.emerald, transparent: true, opacity: 0, depthWrite: false }));
        m.frustumCulled = false; outerGroup.add(m);
      }
      outerGroup.children.forEach((m) => { m.material.opacity = outerGroup.userData.op || 0; });
    }

    function setPreset(p) {
      State.preset = p;
      const old = cellB;
      cellB = cellMeshes(kindOf(p), p === 'none' ? -1 : 1);
      cellB.group.position.copy(old.group.position);
      group.remove(old.group);
      disposeChildren(old.group);
      group.add(cellB.group);
      cloudB.mat.color.setHex(p === 'sink' ? C.emerald : p === 'source' ? C.amber : C.blue);
      seedCloud(cloudB, p === 'sink' ? -1 : +1, 0.12, 1.45);
      cloudB.pts.visible = (p !== 'none');
      buildOuter();
      apply(State.progress);
    }

    function apply(p) {
      const contact = sstep(0, 0.55, p);
      const settle = sstep(0.62, 1, p);
      const gap = 1.5 * (1 - contact);
      cellA.group.position.x = -(0.5 + gap / 2);
      cellB.group.position.x = 0.5 + gap / 2;

      // 接触瞬间：界面箭头向内收缩并湮灭
      const fade = 1 - sstep(0.68, 0.96, contact);
      cellA.matIface.opacity = fade * 0.95;
      cellB.matIface.opacity = fade * 0.95;
      const sc = lerp(1, 0.5, contact);
      if (cellA.iface) cellA.iface.scale.setScalar(sc);
      if (cellB.iface) cellB.iface.scale.setScalar(sc);

      // 直通流线 / 阻断墙
      const formed = sstep(0.66, 0.95, contact);
      const isSrc = State.preset === 'source';
      throughLine.material.opacity = formed * (isSrc ? 0 : 0.95);
      barrier.material.opacity = formed * (isSrc ? 0.55 : 0);

      // 宏观边界与外表面箭头
      boundary.scale.x = (2.7 + gap) / 2.7;
      boundary.material.opacity = 0.5 + settle * 0.35;
      outerGroup.userData.op = settle * 0.95;
      outerGroup.visible = settle > 0.01;
      outerGroup.children.forEach((m) => { m.material.opacity = outerGroup.userData.op; });
    }

    buildOuter();
    apply(0);

    return {
      group, beats: [
        {
          title: '① 分离观察', p: 0,
          caption: (ps) => ps === 'sink'
            ? '微元 A 是源（div＞0），内部向外喷发、六面箭头朝外；微元 B 是汇（div＜0），向心吸附、箭头朝里。各自单独结算：Φ_A = +1，Φ_B = −1。'
            : ps === 'source'
              ? 'A、B 都是源（div＞0），各自向外喷发、六面箭头朝外，单独结算都是 +1：Φ_A = +1，Φ_B = +1。'
              : 'A 是源（div＞0）向外喷发；B 无源（div＝0），只是一根导流管道、不产不吸：Φ_A = +1，Φ_B = 0。'
        },
        {
          title: '② 靠拢贴合', p: 0.55,
          caption: (ps) => ps === 'source'
            ? '两股喷流在接触面上头对头相撞、互相顶住，形成一道阻断墙——中间界面不再有净通过，两份散度都只能改道向外挤。'
            : ps === 'none'
              ? 'A 喷出的流顺着无源微元的管道直穿而过：B 只导流、不增不减，接触面箭头淡出，只剩一条贯穿的直通流线。'
              : 'A 朝右喷出的矢量与 B 朝左吸入的矢量头对头对撞，平滑转化为一条内部直通流线，随后接触面箭头淡出湮灭——内部界面不再记账。'
        },
        {
          title: '③ 宏观结算', p: 1,
          caption: (ps) => {
            const b = ps === 'sink' ? -1 : ps === 'source' ? 1 : 0;
            const s = 1 + b;
            const term = b === -1 ? '(+1) + (−1) = 0' : b === 1 ? '(+1) + (+1) = +2' : '(+1) + 0 = +1';
            const face = s === 0 ? '外表面一出一进正好抵消，Φ_外 = 0' : s === 2 ? '两份源同时向外喷，外表面喷出翻倍，Φ_外 = +2' : '无源微元只导流，外表面净通量保持 +1，Φ_外 = +1';
            return `镜头拉远，只看包裹 A+B 的最外层曲面：${face}。天平严格平衡：${term} ≡ 外表面净穿透量${s === 0 ? ' 0' : ' +' + s}。`;
          }
        }
      ],
      defaultSub: State.sub,
      camForBeat: (i) => (i === 2 ? [1.5, 3.5, 8.4] : [1.0, 2.5, 6.1]),
      beatFromProgress: (p) => (p < 0.275 ? 0 : p < 0.775 ? 1 : 2),
      setProgress: apply,
      setSub: function () { },
      setPreset: setPreset,
      reset: function () { setPreset('sink'); },
      update: function (t, dt) {
        const s = State.preset;
        updateCloud(cloudA, cellA.group.position.x, 0, 0, dt, 0.75);
        cloudB.pts.visible = (s !== 'none');
        if (s !== 'none') updateCloud(cloudB, cellB.group.position.x, 0, 0, dt, s === 'sink' ? 0.8 : 0.75);
        cellA.group.scale.setScalar(1 + Math.sin(t * 2.4) * 0.012);
      },
      legend: [
        { c: '#D97706', t: '源 div＞0' }, { c: '#059669', t: '汇 div＜0' },
        { c: '#2563EB', t: '导流 div＝0' }, { c: '#57534E', t: '虚线＝宏观边界' }
      ],
      callout: {
        cls: 'callout-tip', title: '[!tip] 内部界面永远自相抵消',
        body: '每个微元只在自己的面上结算散度。相邻两面一正一负、等模反向，一贴合就湮灭，因此体内 Σdiv 一定等于最外层曲面的净穿透。'
      },
      ledger: function () {
        const b = divB();
        const s = sum();
        const bterm = b === -1 ? ' + (-1)' : b === 1 ? ' + (+1)' : ' + 0';
        const str = (s > 0 ? '+' + s : String(s));
        return {
          top: `\\iiint_{\\Omega}\\,\\mathrm{div}\\,\\mathbf{F}\\,dV = (+1)${bterm} = ${str}`,
          bottom: `\\oint_{\\partial\\Omega}\\mathbf{F}\\cdot\\mathbf{n}\\,dS = ${str}`,
          note: `\\underbrace{(+1)${bterm}}_{\\text{internal cancel}} = ${str}`,
          left: str, right: str, led: 'ok', ledText: '平衡',
          chips: [
            { t: 'Φ_A = +1', c: 'good' },
            { t: 'Φ_B = ' + (b === -1 ? '−1' : b === 1 ? '+1' : '0'), c: b === 0 ? '' : b > 0 ? 'hot' : 'good' },
            { t: 'Φ_外 = ' + str, c: Math.abs(s) === 0 ? 'good' : 'hot' },
            { t: '预设 ' + ({ sink: '源+汇', source: '源+源', none: '源+无源' })[State.preset], c: '' }
          ]
        };
      }
    };
  }

  /* ==================================================================
   * 4. 模式 2：8 微元拼合与连续剖分
   * ================================================================== */
  const M2_S = 2.4;
  function createMode2() {
    const group = new THREE.Group();
    const mats = {
      cell: new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, roughness: 0.95, metalness: 0, depthWrite: false }),
      edge: new THREE.LineBasicMaterial({ color: C.stone, transparent: true, opacity: 0.55 }),
      ext: new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 1, depthWrite: false }),
      int: new THREE.MeshBasicMaterial({ color: C.emerald, transparent: true, opacity: 0, depthWrite: false })
    };
    const smoothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0, roughness: 0.9, depthWrite: false });
    const smooth = new THREE.Mesh(new THREE.BoxGeometry(M2_S, M2_S, M2_S), smoothMat);
    const smoothEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(M2_S, M2_S, M2_S)),
      new THREE.LineBasicMaterial({ color: C.stone, transparent: true, opacity: 0 }));
    group.add(smooth, smoothEdge);

    let k = -1, isCont = false, parts = [], cellsArr = [], lastGf = -1, stat = { n: 8, ext: 24, pairs: 12 };

    const FACES = [
      { n: V3(1, 0, 0), ax: 0, sg: 1 }, { n: V3(-1, 0, 0), ax: 0, sg: -1 },
      { n: V3(0, 1, 0), ax: 1, sg: 1 }, { n: V3(0, -1, 0), ax: 1, sg: -1 },
      { n: V3(0, 0, 1), ax: 2, sg: 1 }, { n: V3(0, 0, -1), ax: 2, sg: -1 }
    ];

    function buildCells(kk) {
      parts.forEach((p) => { group.remove(p.mesh); p.geo.dispose(); });
      parts = [];
      cellsArr = [];
      const cs = M2_S / kk;
      const boxItems = [], edgeItems = [], extItems = [], intItems = [];
      let id = 0;
      for (let i = 0; i < kk; i++) for (let j = 0; j < kk; j++) for (let l = 0; l < kk; l++) {
        const c = V3(((i + 0.5) / kk - 0.5) * M2_S, ((j + 0.5) / kk - 0.5) * M2_S, ((l + 0.5) / kk - 0.5) * M2_S);
        cellsArr.push(c);
        const b = new THREE.BoxGeometry(cs, cs, cs); b.translate(c.x, c.y, c.z);
        boxItems.push({ geo: b, id });
        const e = new THREE.EdgesGeometry(new THREE.BoxGeometry(cs, cs, cs)); e.translate(c.x, c.y, c.z);
        edgeItems.push({ geo: e, id });

        const ijk = [i, j, l];
        FACES.forEach((f) => {
          const external = f.sg > 0 ? ijk[f.ax] === kk - 1 : ijk[f.ax] === 0;
          if (!external && kk > 4) return;                 // 高剖分只保留外表面箭头（性能）
          const origin = c.clone().addScaledVector(f.n, cs / 2 + 0.012);
          const len = Math.min(Math.max(cs * 0.5, 0.22), 0.55);
          const geo = arrowGeo(origin, f.n, len);
          (external ? extItems : intItems).push({ geo, id });
        });
        id++;
      }
      const mk = (part, mesh) => {
        mesh.frustumCulled = false;
        group.add(mesh);
        parts.push({ geo: part.geo, mesh, base: part.base, ids: part.ids });
      };
      const boxPart = mergeGeos(boxItems);
      const edgePart = mergeLines(edgeItems);
      const boxMesh = new THREE.Mesh(boxPart.geo, mats.cell); boxMesh.userData.kind = 'box';
      const edgeMesh = new THREE.LineSegments(edgePart.geo, mats.edge); edgeMesh.userData.kind = 'edge';
      mk(boxPart, boxMesh); mk(edgePart, edgeMesh);

      if (extItems.length) {
        const ep = mergeGeos(extItems);
        const em = new THREE.Mesh(ep.geo, mats.ext); em.userData.kind = 'ext';
        mk(ep, em);
      }
      if (intItems.length) {
        const ip = mergeGeos(intItems);
        const im = new THREE.Mesh(ip.geo, mats.int); im.userData.kind = 'int';
        mk(ip, im);
      }
      stat = { n: kk * kk * kk, ext: 6 * kk * kk, pairs: 3 * (kk - 1) * kk * kk };
      lastGf = -1;
    }

    function applyGap(gf) {
      if (Math.abs(gf - lastGf) < 1e-4) return;
      lastGf = gf;
      parts.forEach((p) => {
        const arr = p.geo.attributes.position.array;
        const base = p.base, ids = p.ids;
        for (let i = 0, j = 0; i < ids.length; i++, j += 3) {
          const c = cellsArr[ids[i]];
          arr[j] = base[j] + c.x * gf;
          arr[j + 1] = base[j + 1] + c.y * gf;
          arr[j + 2] = base[j + 2] + c.z * gf;
        }
        p.geo.attributes.position.needsUpdate = true;
      });
    }

    function zoneOf(t) { return t < 0.2 ? 1 : t < 0.45 ? 2 : t < 0.7 ? 4 : t < 0.9 ? 8 : 0; }

    function setSub(t) {
      const z = zoneOf(t);
      const kk = z === 0 ? 8 : z;
      const cont = z === 0;
      if (kk !== k) { k = kk; buildCells(k); }
      if (cont !== isCont) { isCont = cont; }
      const cf = sstep(0.9, 0.97, t);
      smoothMat.opacity = cf * 0.17;
      smoothEdge.material.opacity = cf * 0.9;
      mats.edge.opacity = 0.55 * (1 - cf * 0.75);
      applyGap(State.progress * 0.85);
      const rd = $('sub-read');
      if (rd) rd.textContent = isCont
        ? '连续体 N → ∞ · 外表面连续'
        : `${stat.n} 微元 · 外表面 ${stat.ext} · 内表面对 ${stat.pairs}`;
    }

    function apply(p) {
      applyGap(p * 0.85);
      mats.ext.opacity = 1;
      mats.int.opacity = sstep(0.05, 0.4, p);
    }

    buildCells(2);
    apply(0);

    return {
      group, beats: [
        { title: '① 贴合态', caption: '8 个微元贴合成一整块：内部相邻面的箭头两两对撞湮灭，画面只留下最外层 24 个外表面箭头在记账。', p: 0, sub: 0.3 },
        { title: '② 爆炸拆解', caption: '爆炸滑块拉开：所有原本藏在内部的表面全部暴露，每一面都在向外射出通量箭头——这时每块微元的收支都清清楚楚。', p: 1 },
        { title: '③ 聚拢湮灭', caption: '微元聚拢回位：相邻内表面的反向箭头一正一负、等模对撞，逐对湮灭，最终只剩最外层的外表面箭头。', p: 0 },
        { title: '④ 连续剖分', caption: '剖分 N＝1 → 8 → 64 → 连续体：体内 Σdiv·ΔV 与表面 ΣF·nΔS 双侧数值同步联动、始终相等——这就是高斯公式的全部内容。', p: 0, sub: 1 }
      ],
      defaultSub: 0.3,
      camForBeat: (i) => (i === 1 || i === 3 ? [6.3, 5.0, 9.1] : [5.5, 4.3, 8.1]),
      beatFromProgress: (p) => (p >= 0.5 ? 1 : (State.sub >= 0.9 ? 3 : 0)),
      setProgress: apply,
      setSub: setSub,
      reset: function () { },
      update: function (t) {
        mats.ext.opacity = 0.9 + Math.sin(t * 2.2) * 0.1;
      },
      legend: [
        { c: '#D97706', t: '外表面箭头（记账）' }, { c: '#059669', t: '内表面箭头（将湮灭）' },
        { c: '#57534E', t: '微元网格' }
      ],
      callout: {
        cls: 'callout-note', title: '[!note] 剖分越细，账越平',
        body: '把体内切成任意多小立方体，每个小立方体的散度都从自己的六个面流出去；内部界面全部两两抵消，最后只剩最外层曲面在记账。'
      },
      ledger: function () {
        const info = {
          top: isCont
            ? '\\lim_{N\\to\\infty}\\sum_{i}\\mathrm{div}\\,\\mathbf{F}\\,\\Delta V_{i} = \\iiint_{V}\\mathrm{div}\\,\\mathbf{F}\\,dV'
            : `\\sum_{i=1}^{${stat.n}}\\mathrm{div}\\,\\mathbf{F}\\,\\Delta V_{i} = ${stat.n}`,
          bottom: isCont
            ? '\\oiint_{S}\\mathbf{F}\\cdot\\mathbf{n}\\,dS = \\iiint_{V}\\mathrm{div}\\,\\mathbf{F}\\,dV'
            : `\\sum_{i=1}^{${stat.n}}\\mathbf{F}\\cdot\\mathbf{n}\\,\\Delta S_{i} = ${stat.n}`,
          note: isCont ? 'N\\to\\infty :\\; \\text{sums} \\to \\text{integrals, equality kept}'
            : `\\underbrace{${stat.pairs}\\ \\text{pairs}}_{\\text{annihilate}} \\;\\Rightarrow\\; \\text{only } ${stat.ext} \\ \\text{outer arrows}`,
          left: isCont ? '∭' : String(stat.n),
          right: isCont ? '∮' : String(stat.n),
          led: 'ok', ledText: '恒等',
          chips: isCont ? [
            { t: '剖分 N → ∞', c: 'hot' },
            { t: '内部界面全部抵消', c: 'good' },
            { t: '只剩最外层曲面', c: 'good' }
          ] : [
            { t: `微元数 ${stat.n}`, c: '' },
            { t: `内表面对 ${stat.pairs} 湮灭`, c: 'good' },
            { t: `外表面箭头 ${stat.ext}`, c: 'hot' }
          ]
        };
        return info;
      }
    };
  }

  /* ==================================================================
   * 5. 模式 3：挖洞法与奇点处理
   * ================================================================== */
  const M3_R0 = 1.9, M3_RIN = 0.55;
  function m3Radius(d) {
    return M3_R0 * (1 + 0.15 * Math.sin(4 * d.x + 1.3) * Math.cos(3 * d.y)
      + 0.11 * Math.sin(3.6 * d.z + 0.7) + 0.07 * Math.cos(5 * d.x * d.y));
  }
  function dirSet(n) {
    const out = []; const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1 || 1)) * 2;
      const r = Math.sqrt(Math.max(1 - y * y, 0));
      const th = ga * i;
      out.push(V3(Math.cos(th) * r, y, Math.sin(th) * r).normalize());
    }
    return out;
  }

  function createMode3() {
    const group = new THREE.Group();

    // ── 外表面 Σ外（不规则曲面，可形变） ──
    const outerGeo = new THREE.SphereGeometry(M3_R0, 44, 28);
    const pa = outerGeo.attributes.position;
    const dirs = new Float32Array(pa.count * 3);
    const base = new Float32Array(pa.count * 3);
    const tgt = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      const d = V3(x / len, y / len, z / len);
      const r = m3Radius(d);
      dirs[i * 3] = d.x; dirs[i * 3 + 1] = d.y; dirs[i * 3 + 2] = d.z;
      base[i * 3] = d.x * r; base[i * 3 + 1] = d.y * r; base[i * 3 + 2] = d.z * r;
      tgt[i * 3] = d.x * M3_RIN; tgt[i * 3 + 1] = d.y * M3_RIN; tgt[i * 3 + 2] = d.z * M3_RIN;
      pa.setXYZ(i, base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);
    }
    outerGeo.computeVertexNormals();
    const outerFill = new THREE.Mesh(outerGeo, new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0.12, roughness: 0.9, side: THREE.DoubleSide, depthWrite: false
    }));
    const outerWire = new THREE.Mesh(outerGeo, new THREE.MeshBasicMaterial({
      color: C.blue, wireframe: true, transparent: true, opacity: 0.28
    }));
    outerFill.frustumCulled = false; outerWire.frustumCulled = false;
    group.add(outerFill, outerWire);

    let lastMorph = -1;
    function morph(t) {
      if (Math.abs(t - lastMorph) < 1e-4) return;
      lastMorph = t;
      const it = 1 - t;
      for (let i = 0; i < pa.count; i++) {
        pa.setXYZ(i,
          base[i * 3] * it + tgt[i * 3] * t,
          base[i * 3 + 1] * it + tgt[i * 3 + 1] * t,
          base[i * 3 + 2] * it + tgt[i * 3 + 2] * t);
      }
      pa.needsUpdate = true;
      outerGeo.computeVertexNormals();
      placeOuterArrows(t);
    }

    // ── 内球壳 Σ内（辅助挖洞球） ──
    const innerGroup = new THREE.Group();
    innerGroup.scale.setScalar(0.0001);
    const innerGeo = new THREE.SphereGeometry(M3_RIN, 30, 20);
    const innerFill = new THREE.Mesh(innerGeo, new THREE.MeshStandardMaterial({
      color: C.emerald, transparent: true, opacity: 0.16, roughness: 0.9, depthWrite: false
    }));
    const innerWire = new THREE.Mesh(innerGeo, new THREE.MeshBasicMaterial({
      color: C.emerald, wireframe: true, transparent: true, opacity: 0.5
    }));
    innerGroup.add(innerFill, innerWire);
    group.add(innerGroup);

    // ── 法向量箭头 ──
    function flatArrow(color) {
      const g = arrowGeo(V3(0, 0, 0), V3(0, 1, 0), 0.44);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
      m.frustumCulled = false;
      return m;
    }
    const outerDirs = dirSet(16);
    const outerArrows = outerDirs.map(() => { const a = flatArrow(C.stone); group.add(a); return a; });
    function placeOuterArrows(t) {
      outerDirs.forEach((d, i) => {
        const r = m3Radius(d) * (1 - t) + M3_RIN * t + 0.03;
        outerArrows[i].position.set(d.x * r, d.y * r, d.z * r);
        outerArrows[i].quaternion.setFromUnitVectors(V3(0, 1, 0), d);
      });
    }

    const innerDirs = dirSet(12);
    const innerArrows = innerDirs.map(() => { const a = flatArrow(C.emerald); innerGroup.add(a); return a; });
    function setInnerFlip(f) {
      // f=0：法向朝内（指向奇点）；f=1：翻转为常规外向
      innerDirs.forEach((d, i) => {
        const a = innerArrows[i];
        const qIn = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().negate());
        const qOut = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone());
        a.quaternion.copy(qIn).slerp(qOut, f);
        const pIn = d.clone().multiplyScalar(M3_RIN + 0.44);
        const pOut = d.clone().multiplyScalar(M3_RIN);
        a.position.copy(pIn).lerp(pOut, f);
      });
    }
    placeOuterArrows(0);
    setInnerFlip(0);

    // ── 奇点：脉冲发光 + 倒平方场粒子 ──
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14),
      new THREE.MeshBasicMaterial({ color: C.amber }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14),
      new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.3, depthWrite: false }));
    core.frustumCulled = false; glow.frustumCulled = false;
    const coreLight = new THREE.PointLight(C.amber, 1.4, 8);
    group.add(core, glow, coreLight);

    const cloud = makeCloud(170, C.amber, 0.05);
    seedCloud(cloud, +1, 0.16, 3.0);
    cloud.pts.position.set(0, 0, 0);
    group.add(cloud.pts);

    function apply(p) {
      const hole = sstep(0.12, 0.45, p);
      const flip = sstep(0.6, 0.66, p);
      const deform = sstep(0.72, 1, p);

      innerGroup.visible = hole > 0.002;
      innerGroup.scale.setScalar(hole <= 0 ? 0.0001 : Math.max(0.0001, easeOutBack(hole)));
      setInnerFlip(flip);

      const arrowOp = sstep(0.42, 0.52, p);
      outerArrows.forEach((a) => { a.material.opacity = arrowOp * 0.95; });
      innerArrows.forEach((a) => { a.material.opacity = arrowOp * 0.95; });
      outerFill.material.opacity = 0.12 + 0.06 * sstep(0.4, 0.5, p);

      morph(deform);
    }

    apply(0);

    return {
      group, beats: [
        { title: '① 危机：原点奇点', caption: '原点处是一个倒平方场的奇点：脉冲发光、散度在此发散为无穷大，而外层不规则曲面 Σ外 把它整个包在体内。', p: 0 },
        { title: '② 直接套用？红灯', caption: '直接套用高斯公式触发红灯报警：积分体内含有未定义的奇异点，体积分 ∭div F dV 发散，根本无法直接计算。', p: 0.04 },
        { title: '③ 挖洞 Σ内', caption: '在原点周围平滑膨胀出一个微小辅助球壳 Σ内，把奇点挖掉；新的物理分析体是"夹心层"，它内部处处没有奇点。', p: 0.45 },
        { title: '④ 夹心层法向', caption: '夹心层内 div＝0。它的"外向法向量"：在大曲面 Σ外 上指向外，在小球壳 Σ内 上指向内（朝向奇点）。', p: 0.56 },
        { title: '⑤ 通量守恒·翻转', caption: '夹心层总通量为 0 ⇒ ∬Σ外 + ∬Σ内(向内) = 0；把内球法向翻转成常规外向，即得 ∬Σ外 = ∬Σ内(向外)。', p: 0.66 },
        { title: '⑥ 形变等价', caption: '复杂外曲面平滑收缩、投影贴合到内层规则小球面上：算这个复杂外表面的通量，与算里面小球面的通量完全等价。', p: 1 }
      ],
      defaultSub: State.sub,
      camForBeat: (i) => (i === 5 ? [2.0, 1.8, 5.4] : i <= 1 ? [0.5, 2.3, 6.7] : [1.1, 2.0, 6.1]),
      beatFromProgress: (p) => (p <= 0.02 ? 0 : p <= 0.245 ? 1 : p <= 0.505 ? 2 : p <= 0.61 ? 3 : p <= 0.83 ? 4 : 5),
      setProgress: apply,
      setSub: function () { },
      reset: function () { },
      update: function (t, dt) {
        const pulse = 1 + Math.sin(t * 5.2) * 0.22;
        core.scale.setScalar(pulse);
        glow.scale.setScalar(1 + Math.sin(t * 5.2 + 0.6) * 0.35);
        glow.material.opacity = 0.22 + (Math.sin(t * 5.2) * 0.5 + 0.5) * 0.3;
        coreLight.intensity = 1.1 + Math.sin(t * 5.2) * 0.7;
        updateCloud(cloud, 0, 0, 0, dt, 1.15);
        outerWire.material.opacity = 0.22 + Math.sin(t * 1.6) * 0.07;
      },
      legend: [
        { c: '#D97706', t: '奇点（div 发散）' }, { c: '#2563EB', t: 'Σ外 不规则外表面' },
        { c: '#059669', t: 'Σ内 辅助球壳' }, { c: '#57534E', t: '曲面法向箭头' }
      ],
      callout: {
        cls: 'callout-important', title: '[!important] 挖洞法：把奇点剔出体内',
        body: '挖去小球壳后，分析体变成夹心层——处处 div＝0。夹心层的外向法向在小球壳上朝里，翻转之后，复杂外表面的通量就等于内部小球面的通量。'
      },
      ledger: function () {
        const p = State.progress, alarm = State.beat === 1;
        if (alarm) {
          return {
            top: '\\iiint_{\\Omega}\\,\\mathrm{div}\\,\\mathbf{F}\\,dV \\Rightarrow \\infty\\;(\\text{undefined})',
            bottom: '\\oint_{\\partial\\Omega}\\mathbf{F}\\cdot\\mathbf{n}\\,dS \\;\\text{?}',
            note: '\\iiint_{\\Omega} \\neq \\oint_{\\partial\\Omega} \\;\\text{(hypothesis broken)}',
            left: '∞', right: '?', led: 'bad', ledText: '不可计算',
            chips: [
              { t: '奇异点 div → ∞', c: 'bad' },
              { t: '体积分 未定义', c: 'bad' },
              { t: '需挖洞处理', c: 'hot' }
            ]
          };
        }
        const holed = p >= 0.45;
        if (!holed) {
          return {
            top: '\\iiint_{\\Omega}\\,\\mathrm{div}\\,\\mathbf{F}\\,dV \\;\\text{(needs hole)}',
            bottom: '\\oint_{\\partial\\Omega}\\mathbf{F}\\cdot\\mathbf{n}\\,dS = 4\\pi',
            note: '\\Sigma_{\\text{outer}} \\ni \\text{singularity}',
            left: '?', right: '4π', led: 'warn', ledText: '含奇点',
            chips: [
              { t: '奇点在体内', c: 'bad' },
              { t: 'Σ外 包住奇点', c: '' },
              { t: 'Φ_外 = 4π', c: 'hot' }
            ]
          };
        }
        const flipped = p >= 0.6;
        return {
          top: '\\iiint_{V\'}\\,\\mathrm{div}\\,\\mathbf{F}\\,dV = 0',
          bottom: flipped
            ? '\\iint_{\\Sigma_{\\text{外}}}\\mathbf{F}\\cdot\\mathbf{n}\\,dS = \\iint_{\\Sigma_{\\text{内}}}\\mathbf{F}\\cdot\\mathbf{n}\\,dS'
            : '\\iint_{\\Sigma_{\\text{外}}}\\!\\mathbf{F}\\!\\cdot\\!\\mathbf{n}\\,dS \\;+\\; \\iint_{\\Sigma_{\\text{内}}}\\!\\mathbf{F}\\!\\cdot\\!\\mathbf{n}_{\\text{in}}\\,dS \\;=\\; 0',
          note: flipped
            ? '\\Sigma_{\\text{外}} \\xrightarrow{\\;t\\;} \\Sigma_{\\text{内}} \\quad (\\text{same flux } 4\\pi)'
            : '\\text{sandwich} :\\; \\mathrm{div}\\,\\mathbf{F} \\equiv 0',
          left: '0', right: '0', led: 'ok', ledText: '平衡',
          chips: flipped ? [
            { t: '夹心层 div = 0', c: 'good' },
            { t: '法向已翻转', c: 'good' },
            { t: 'Φ_外 = Φ_内 = 4π', c: 'hot' }
          ] : [
            { t: '夹心层 div = 0', c: 'good' },
            { t: 'Φ_外 = 4π', c: 'good' },
            { t: 'Φ_内(向内) = −4π', c: 'good' }
          ]
        };
      }
    };
  }

  /* ==================================================================
   * 6. UI 渲染：HUD / 节拍 / 账本 / 天平 / 图例 / Callout
   * ================================================================== */
  function syncPlayBtn() {
    const b = $('btn-play');
    if (b) b.innerText = State.playing ? '⏸ 暂停演进' : '▶ 自动播放';
  }
  function syncSliders() {
    const pr = $('progress'); if (pr) pr.value = Math.round(State.progress * 1000);
    const sr = $('sub'); if (sr && State.mode === 1) sr.value = Math.round(State.sub * 1000);
    const pv = $('progress-val'); if (pv) pv.textContent = Math.round(State.progress * 100) + '%';
  }

  function renderHud() {
    const m = activeMode(), b = m.beats[State.beat];
    $('hud-tag').textContent = `节拍 ${State.beat + 1}/${m.beats.length}`;
    $('hud-text').textContent = (typeof b.caption === 'function') ? b.caption(State.preset) : b.caption;
    if (window.gsap) gsap.fromTo('#hud', { opacity: 0.4, y: 5 }, { opacity: 1, y: 0, duration: dur(0.35), ease: 'power2.out', overwrite: true });
    const pl = $('progress-label'); if (pl) pl.textContent = b.title;
  }

  function renderBeats() {
    const m = activeMode();
    const ol = $('beat-list');
    while (ol.firstChild) ol.removeChild(ol.firstChild);
    m.beats.forEach((b, i) => {
      const li = document.createElement('li');
      const idx = document.createElement('span');
      idx.className = 'bl-idx';
      idx.textContent = String(i + 1);
      const tx = document.createElement('span');
      tx.textContent = b.title.replace(/^[①-⑩]\s*/, '');
      li.appendChild(idx); li.appendChild(tx);
      li.addEventListener('click', () => { hardStop(); gotoBeat(i, true); });
      ol.appendChild(li);
    });
    syncBeatList();
  }
  function syncBeatList() {
    const li = $('beat-list').children;
    for (let i = 0; i < li.length; i++) {
      li[i].classList.toggle('active', i === State.beat);
      li[i].classList.toggle('done', i < State.beat);
    }
  }

  let balSig = '';
  function setBalance(left, right, led, text) {
    $('bal-left').textContent = left;
    $('bal-right').textContent = right;
    $('bal-text').textContent = text;
    const el = $('bal-led');
    el.className = 'led ' + (led === 'ok' ? 'led-emerald' : led === 'bad' ? 'led-rose' : 'led-amber');
    const sig = led + '|' + left + '|' + right;
    if (sig === balSig) return;
    balSig = sig;
    const tilt = led === 'bad' ? 9 : led === 'warn' ? 5 : 0;
    // 天平用 CSS 弹性过渡：即使补间被 killTweensOf('*') 清场，也会自然收敛到目标倾角
    const beam = $('beam');
    if (beam) {
      beam.style.transform = 'rotate(' + (tilt + (tilt >= 0 ? 6 : -6)) + 'deg)';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const b = $('beam');
        if (b) b.style.transform = 'rotate(' + tilt + 'deg)';
      }));
    }
  }

  let chipSig = '';
  function renderChips(list) {
    const el = $('chips');
    const sig = list.map((x) => x.t + '#' + x.c).join('|');
    if (sig === chipSig) return;
    const sameShape = el.children.length === list.length;
    chipSig = sig;
    if (!sameShape) {
      while (el.firstChild) el.removeChild(el.firstChild);
      list.forEach(() => { const s = document.createElement('span'); s.className = 'chip'; el.appendChild(s); });
    }
    list.forEach((x, i) => {
      const node = el.children[i];
      if (node.textContent !== x.t) {
        node.textContent = x.t;
        // 微动效：用 CSS 动画（不受 killTweensOf('*') 清场影响）
        node.classList.remove('pop');
        void node.offsetWidth;
        node.classList.add('pop');
      }
      node.className = 'chip' + (x.c ? ' ' + x.c : '') + (node.classList.contains('pop') ? ' pop' : '');
    });
  }

  function renderLedger() {
    const info = activeMode().ledger();
    renderLatex($('fx-top'), info.top);
    renderLatex($('fx-bottom'), info.bottom);
    renderLatex($('fx-note'), info.note || '');
    setBalance(info.left, info.right, info.led, info.ledText);
    renderChips(info.chips);
    const st = $('m3-status');
    if (st && State.mode === 2) {
      st.textContent = [
        '状态：原点奇点未处理（Σ外 包含发散点）',
        '状态：直接套用失败，体内含奇异点',
        '状态：已挖出 Σ内，夹心层内 div = 0',
        '状态：Σ外 法向朝外 / Σ内 法向朝里',
        '状态：内法向已翻转，∬Σ外 = ∬Σ内',
        '状态：外曲面形变 ≡ 内球面'
      ][State.beat] || '';
    }
    setAlarm(State.mode === 2 && State.beat === 1);
  }

  function setAlarm(on) {
    const vp = $('viewport'), al = $('alarm');
    vp.classList.toggle('alarm-on', !!on);
    if (window.gsap) gsap.to(al, { opacity: on ? 1 : 0, duration: dur(0.3), overwrite: true });
    else al.style.opacity = on ? 1 : 0;
  }

  function renderLegend() {
    const el = $('legend');
    while (el.firstChild) el.removeChild(el.firstChild);
    activeMode().legend.forEach((l) => {
      const wrap = document.createElement('span');
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '4px';
      const dot = document.createElement('span');
      dot.style.width = '8px'; dot.style.height = '8px'; dot.style.borderRadius = '2px';
      dot.style.background = l.c; dot.style.display = 'inline-block';
      const tx = document.createElement('span');
      tx.textContent = l.t;
      wrap.appendChild(dot); wrap.appendChild(tx);
      el.appendChild(wrap);
    });
  }

  function renderCallout() {
    const c = activeMode().callout;
    const box = $('callout');
    box.className = 'rounded-lg px-3 py-2.5 text-[11.5px] leading-relaxed ' + c.cls;
    $('callout-title').textContent = c.title;
    $('callout-body').textContent = c.body;
  }

  function renderTabs() {
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', +b.dataset.tab === State.mode);
    });
  }
  function renderExtra() {
    $('extra-1').classList.toggle('hidden', State.mode !== 0);
    $('extra-2').classList.toggle('hidden', State.mode !== 1);
    $('extra-3').classList.toggle('hidden', State.mode !== 2);
    const labels = [['分离', '贴合'], ['贴合', '爆炸'], ['原始曲面', '形变等价']][State.mode];
    $('p-start').textContent = labels[0];
    $('p-end').textContent = labels[1];
  }
  function renderPresetChips() {
    document.querySelectorAll('.preset-chip').forEach((b) => {
      b.classList.toggle('active', b.dataset.preset === State.preset);
    });
  }

  /* ==================================================================
   * 7. 时间线：节拍 / 播放 / 单步 / 滑块
   * ================================================================== */
  function applyVisual() {
    const m = activeMode();
    m.setProgress(State.progress);
    if (m.setSub) m.setSub(State.sub);
  }

  function gotoBeat(i, animate, onDone) {
    const m = activeMode();
    i = clamp(i, 0, m.beats.length - 1);
    const b = m.beats[i];
    State.beat = i;
    syncBeatList();
    renderHud();
    syncSliders();
    renderLedger();
    flyCamera(m.camForBeat(i));

    const tp = b.p;
    const ts = (b.sub !== undefined ? b.sub : State.sub);
    const finish = () => { State.tw = null; syncSliders(); applyVisual(); renderLedger(); if (onDone) onDone(); };

    if (!animate || !window.gsap) {
      State.progress = tp; State.sub = ts;
      finish();
      return;
    }
    const tw = { p: State.progress, s: State.sub };
    State.tw = tw;
    gsap.to(tw, {
      p: tp, s: ts, duration: dur(1.15), ease: 'power2.inOut',
      onUpdate: function () { State.progress = tw.p; State.sub = tw.s; syncSliders(); applyVisual(); },
      onComplete: finish
    });
  }

  function playForward() {
    if (!State.playing) return;
    const m = activeMode();
    if (State.beat >= m.beats.length - 1) {           // 播到底：回到起点再来一遍
      State.playing = false; syncPlayBtn(); return;
    }
    gotoBeat(State.beat + 1, true, function () {
      if (!State.playing) return;
      State.timer = gsap.delayedCall(dur(0.7), function () {
        State.timer = null;
        playForward();
      });
    });
  }

  function togglePlay() {
    if (State.playing) { hardStop(); return; }
    hardStop();
    State.playing = true;
    syncPlayBtn();
    if (State.beat >= activeMode().beats.length - 1) {
      gotoBeat(0, false, function () {
        State.timer = gsap.delayedCall(dur(0.4), function () { State.timer = null; playForward(); });
      });
    } else {
      playForward();
    }
  }

  /* ==================================================================
   * 8. 模式切换与复位
   * ================================================================== */
  function switchMode(i) {
    if (i === State.mode) return;
    hardStop();                                        // Tab 切换必须先清场
    Modes[State.mode].group.visible = false;
    State.mode = i;
    const m = activeMode();
    m.group.visible = true;
    State.beat = 0;
    State.progress = m.beats[0].p;
    State.sub = (m.beats[0].sub !== undefined ? m.beats[0].sub : m.defaultSub);
    if (i === 0) { m.reset(); renderPresetChips(); }
    syncSliders(); applyVisual();
    resetFxCache();
    renderTabs(); renderExtra(); renderBeats(); renderHud();
    renderLegend(); renderCallout(); renderLedger();
    flyCamera(m.camForBeat(0));
    if (window.gsap) gsap.fromTo(m.group.scale, { x: 0.94, y: 0.94, z: 0.94 }, { x: 1, y: 1, z: 1, duration: dur(0.6), ease: 'back.out(1.6)' });
  }

  function doReset() {
    hardStop();                                        // 复位必须先清场
    const m = activeMode();
    State.beat = 0;
    State.progress = m.beats[0].p;
    State.sub = (m.beats[0].sub !== undefined ? m.beats[0].sub : m.defaultSub);
    if (State.mode === 0) { m.reset(); renderPresetChips(); }
    syncSliders(); applyVisual();
    resetFxCache();
    renderBeats(); renderHud(); renderLedger();
    flyCamera(m.camForBeat(0));
  }

  /* ==================================================================
   * 9. 事件绑定
   * ================================================================== */
  function wireUI() {
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => switchMode(+b.dataset.tab));
    });

    $('btn-play').addEventListener('click', togglePlay);

    $('btn-next').addEventListener('click', () => {
      hardStop();                                       // 单步必须先清场
      gotoBeat(State.beat + 1, true);
    });
    $('btn-prev').addEventListener('click', () => {
      hardStop();
      gotoBeat(State.beat - 1, true);
    });
    $('btn-reset').addEventListener('click', doReset);

    document.querySelectorAll('.speed-chip').forEach((b) => {
      b.addEventListener('click', () => {
        State.speed = +b.dataset.speed;
        document.querySelectorAll('.speed-chip').forEach((x) => x.classList.toggle('active', x === b));
      });
    });

    // 连续进度滑块（拖动瞬间 killTweensOf('*') 清场，60fps 跟手重算）
    $('progress').addEventListener('input', (e) => {
      hardStop();
      State.progress = clamp(+e.target.value / 1000, 0, 1);
      applyVisual();
      const m = activeMode();
      const bi = m.beatFromProgress(State.progress);
      if (bi !== State.beat) {
        State.beat = bi;
        syncBeatList(); renderHud(); syncSliders();
      } else {
        const pv = $('progress-val'); if (pv) pv.textContent = Math.round(State.progress * 100) + '%';
      }
      renderLedger();
    });

    // 剖分滑块（模式 2）
    $('sub').addEventListener('input', (e) => {
      hardStop();
      State.sub = clamp(+e.target.value / 1000, 0, 1);
      activeMode().setSub(State.sub);
      const m = activeMode();
      const bi = m.beatFromProgress(State.progress);
      if (State.mode === 1 && bi !== State.beat && State.progress < 0.5) {
        State.beat = bi; syncBeatList(); renderHud();
      }
      renderLedger();
    });

    document.querySelectorAll('.preset-chip').forEach((b) => {
      b.addEventListener('click', () => {
        hardStop();
        activeMode().setPreset(b.dataset.preset);   // 先切预设，再刷新高亮与文案
        renderPresetChips();
        resetFxCache();
        renderHud(); renderLedger();
      });
    });

    $('btn-singular').addEventListener('click', () => {   // 红灯报警入口
      hardStop();
      gotoBeat(1, true);
    });

    // 键盘：← → 步进，空格播放
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'ArrowRight') { hardStop(); gotoBeat(State.beat + 1, true); }
      else if (e.code === 'ArrowLeft') { hardStop(); gotoBeat(State.beat - 1, true); }
    });
  }

  /* ==================================================================
   * 10. 启动
   * ================================================================== */
  function boot() {
    initThree();
    Modes.push(createMode1());
    Modes.push(createMode2());
    Modes.push(createMode3());
    Modes.forEach((m, i) => { m.group.visible = (i === 0); scene.add(m.group); });

    wireUI();
    renderTabs(); renderExtra(); renderBeats(); renderLegend(); renderCallout();
    syncSliders(); applyVisual(); renderHud(); renderLedger(); syncPlayBtn();
    flyCamera(Modes[0].camForBeat(0));

    loop();
    console.log('🚀 [高斯公式与散度物理直观] 模块初始化就绪');

    // KaTeX 异步到达后强制重绘账本
    const waitForKatex = (tries) => {
      if (window.katex) { resetFxCache(); renderLedger(); return; }
      if (tries > 0) setTimeout(() => waitForKatex(tries - 1), 400);
    };
    window.addEventListener('load', () => waitForKatex(30));
    waitForKatex(30);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
