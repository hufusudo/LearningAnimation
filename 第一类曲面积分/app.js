/* 第一类曲面积分：同一切片跨区转移，有限面积 → 切平面 → 面积微元。 */
(function () {
  'use strict';
  const M = window.SurfaceModel, C = window.SurfaceChoreo;
  const $ = id => document.getElementById(id);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (v, d = 4) => Number(v).toFixed(d);
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const hasThree = !!(window.THREE && THREE.OrbitControls);
  const srgb = hex => new THREE.Color(hex).convertSRGBToLinear();
  const N_STOPS = [4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
  const RAMP = hasThree ? ['#FAF3E6', '#E1A244', '#8C4A14'].map(srgb) : [];
  const UNIFORM_T = 0.45;
  const state = { n: 8, rhoMode: 'gradient', pick: { x: -0.6, y: 0.5 },
    pickCell: { i: 0, j: 0 }, pickId: 0, playing: false, speed: 1,
    reduced: media.matches, sums: {}, exact: {} };
  const clock = { t: 0 }, main = {}, micro = {};
  let P = C.frames[0], labelsMain = [], labelsMicro = [], graphic = false;
  let tween = null, reducedClock = 0, lastText = -1, lastMath = '';
  const CAM = { pos: [4.7, -6.5, 4.5], target: [0, 0, 0.7] };
  const tmpColor = () => new THREE.Color();
  function rampColor(t, out) {
    const [a, b, c] = RAMP;
    return t < .55 ? out.copy(a).lerp(b, clamp(t / .55)) : out.copy(b).lerp(c, clamp((t - .55) / .45));
  }
  function rhoT(x, y) {
    return state.rhoMode === 'uniform' ? UNIFORM_T : (M.rho(x, y, 'gradient') - M.RHO_MIN) / (M.RHO_MAX - M.RHO_MIN);
  }
  function text(el, value) { if (el.textContent !== value) el.textContent = value; }
  function alpha(el, v) { el.style.opacity = v; el.style.visibility = v > .001 ? 'visible' : 'hidden'; }
  function math(el, tex, fallback) {
    if (el.dataset.formula === tex) return;
    el.dataset.formula = tex;
    if (window.katex) katex.render(tex, el, { displayMode: true, throwOnError: false, strict: false });
    else text(el, fallback);
  }
  const SURFACE_VERT = [
    'attribute vec3 aCenter; attribute vec3 aNrm; attribute vec3 aCol;',
    'attribute float aRand; attribute float aId; attribute vec2 aLocal;',
    'uniform float uSep, uPick, uLift, uFall;',
    'varying vec3 vCol; varying vec2 vLocal; varying float vShade, vPick, vLift;',
    'void main() {',
    '  vec3 local = position - aCenter;',
    '  float picked = 1.0 - step(0.5, abs(aId - uPick));',
    '  vec3 surf = aCenter + local * (1.0 - 0.14 * uSep) + aNrm * (0.035 + 0.11 * aRand) * uSep;',
    '  surf.z += picked * uLift * (0.30 + 0.12 * aRand);',
    '  float t = clamp(uFall * 1.5 - aRand * 0.5, 0.0, 1.0);',
    '  float e = t * t * (3.0 - 2.0 * t);',
    '  vec3 target = vec3(aCenter.x + local.x, aCenter.y + local.y, 0.03);',
    '  vec3 p = mix(surf, target, e);',

    '  vec3 n = normalize(mix(aNrm, vec3(0.0, 0.0, 1.0), e));',
    '  vec3 L = normalize(vec3(-0.42, -0.5, 0.76));',
    '  vShade = 0.58 + 0.48 * max(dot(n, L), 0.0);',
    '  vCol = aCol; vLocal = aLocal; vPick = picked; vLift = picked * uLift;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');

  const SURFACE_FRAG = [
    'uniform float uSep, uColorMix, uExtract;',
    'varying vec3 vCol; varying vec2 vLocal; varying float vShade, vPick, vLift;',
    'void main() {',
    '  if (vPick > 0.5 && uExtract > 0.5) discard;',
    '  vec3 base = mix(vec3(1.0), vCol, uColorMix);',
    '  vec3 col = base * vShade;',
    '  float e = min(min(vLocal.x, 1.0 - vLocal.x), min(vLocal.y, 1.0 - vLocal.y));',
    '  float w = max(fwidth(e), 1e-5);',
    '  float edge = 1.0 - smoothstep(0.0, w * 1.5, e);',
    '  col = mix(col, col * 0.5, edge * (0.15 + 0.5 * uSep));',
    '  col = mix(col, vec3(0.95, 0.55, 0.06), edge * vPick * (0.35 + 0.65 * vLift));',
    '  col = mix(col, col + vec3(0.12, 0.08, 0.02), vPick * 0.20);',
    '  gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.4545)), 1.0);',
    '}'
  ].join('\n');

  function buildSurface(n) {
    const dx = 4 / n, dy = 4 / n;
    const verts = n * n * 6;
    const pos = new Float32Array(verts * 3), ctr = new Float32Array(verts * 3);
    const nrm = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
    const rnd = new Float32Array(verts), ids = new Float32Array(verts), loc = new Float32Array(verts * 2);
    const tmp = tmpColor();
    let v = 0;

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x0 = -2 + i * dx, x1 = x0 + dx, y0 = -2 + j * dy, y1 = y0 + dy;
        const c00 = [x0, y0, M.z(x0, y0)], c10 = [x1, y0, M.z(x1, y0)];
        const c11 = [x1, y1, M.z(x1, y1)], c01 = [x0, y1, M.z(x0, y1)];
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = M.z(cx, cy);
        // 单元法向量 = 两条对角线叉积（保持 z 分量朝上）
        const d1 = [c11[0] - c00[0], c11[1] - c00[1], c11[2] - c00[2]];
        const d2 = [c01[0] - c10[0], c01[1] - c10[1], c01[2] - c10[2]];
        let nx = d1[1] * d2[2] - d1[2] * d2[1];
        let ny = d1[2] * d2[0] - d1[0] * d2[2];
        let nz = d1[0] * d2[1] - d1[1] * d2[0];
        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;

        const r = (((i * 73856093) ^ (j * 19349663)) >>> 0) / 4294967295;
        const id = j * n + i;
        rampColor(rhoT(cx, cy), tmp);

        const corners = [c00, c10, c11, c00, c11, c01];
        const uvs = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
        for (let k = 0; k < 6; k++) {
          pos.set(corners[k], v * 3);
          ctr.set([cx, cy, cz], v * 3);
          nrm.set([nx, ny, nz], v * 3);
          col.set([tmp.r, tmp.g, tmp.b], v * 3);
          rnd[v] = r; ids[v] = id;
          loc[v * 2] = uvs[k][0]; loc[v * 2 + 1] = uvs[k][1];
          v++;
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCenter', new THREE.BufferAttribute(ctr, 3));
    g.setAttribute('aNrm', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
    g.setAttribute('aId', new THREE.BufferAttribute(ids, 1));
    g.setAttribute('aLocal', new THREE.BufferAttribute(loc, 2));

    const mesh = new THREE.Mesh(g, main.material);
    mesh.frustumCulled = false;
    main.scene.add(mesh);
    if (main.mesh) { main.scene.remove(main.mesh); main.mesh.geometry.dispose(); }
    main.mesh = mesh;
    main.n = n;
    updatePickId();
  }

  /* ================== 投影底板 ================== */
  function boardTexture(kind, mode) {
    const S = 1024, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const px = x => (x + 2) / 4 * S;
    const py = y => (2 - y) / 4 * S;

    if (kind === 'base') {
      ctx.fillStyle = '#FBFAF6'; ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = '#E7E5DE'; ctx.lineWidth = 1.5;
      for (let v = -2; v <= 2.0001; v += 0.5) {
        ctx.beginPath(); ctx.moveTo(px(v), 0); ctx.lineTo(px(v), S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, py(v)); ctx.lineTo(S, py(v)); ctx.stroke();
      }
      ctx.strokeStyle = '#A8A29E'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, py(0)); ctx.lineTo(S, py(0)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px(0), 0); ctx.lineTo(px(0), S); ctx.stroke();
      ctx.strokeStyle = '#57534E'; ctx.lineWidth = 5; ctx.strokeRect(4, 4, S - 8, S - 8);
      ctx.fillStyle = '#78716C'; ctx.font = '500 24px "JetBrains Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let v = -2; v <= 2; v += 1) {
        if (v !== 0) {
          ctx.fillText(String(v), px(v), py(0) + 27);
          ctx.fillText(String(v), px(0) - 27, py(v));
        }
      }
      ctx.font = 'italic 46px Georgia, serif'; ctx.fillStyle = '#1C1917';
      ctx.fillText('D', px(-1.66), py(-1.6));
      ctx.font = 'italic 24px Georgia, serif';
      ctx.fillText('xy', px(-1.47), py(-1.53));
    } else {
      const cells = 96, step = S / cells;
      const color = new THREE.Color();
      const stops = ['#FAF3E6', '#E1A244', '#8C4A14'].map(h => new THREE.Color(h));
      for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
          const x = -2 + (i + 0.5) / cells * 4, y = 2 - (j + 0.5) / cells * 4;
          const t = mode === 'uniform' ? UNIFORM_T
            : (M.rho(x, y, 'gradient') - M.RHO_MIN) / (M.RHO_MAX - M.RHO_MIN);
          if (t < 0.55) color.copy(stops[0]).lerp(stops[1], t / 0.55);
          else color.copy(stops[1]).lerp(stops[2], (t - 0.55) / 0.45);
          const c = color.clone().convertLinearToSRGB();
          ctx.fillStyle = `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},0.5)`;
          ctx.fillRect(i * step - 0.5, j * step - 0.5, step + 1, step + 1);
        }
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  }

  function buildBoard() {
    const geo = new THREE.PlaneGeometry(4, 4);
    const base = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: boardTexture('base'), transparent: true }));
    base.position.z = 0.002;
    const tint = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    tint.position.z = 0.007;
    main.scene.add(base, tint);
    main.boardBase = base; main.boardTint = tint;

    const axisMat = new THREE.LineBasicMaterial({ color: srgb('#8B9299') });
    const line = pts => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      return new THREE.Line(g, axisMat);
    };
    main.scene.add(
      line([[-2.65, 0, 0.016], [2.65, 0, 0.016]]),
      line([[0, -2.65, 0.016], [0, 2.65, 0.016]]),
      line([[0, 0, 0.016], [0, 0, 2.2]])
    );
  }

  function refreshTint() {
    const old = main.boardTint.material.map;
    main.boardTint.material.map = boardTexture('tint', state.rhoMode);
    main.boardTint.material.needsUpdate = true;
    if (old) old.dispose();
  }


  function updatePickId() {
    const n = state.n;
    state.pickCell.i = clamp(Math.floor((state.pick.x + 2) * n / 4), 0, n - 1);
    state.pickCell.j = clamp(Math.floor((state.pick.y + 2) * n / 4), 0, n - 1);
    state.pickId = state.pickCell.j * n + state.pickCell.i;
    const [x, y] = M.cellCenter(n, state.pickCell.i, state.pickCell.j);
    state.pick = { x, y };
    state.patch = M.localPatch(n, state.pickCell.i, state.pickCell.j);
  }

  function makeLabel(host, value, cls) {
    const el = document.createElement('span');
    el.className = 'axis-label ' + (cls || ''); text(el, value); host.append(el);
    return { el, pos: new THREE.Vector3(), visible: true };
  }
  function lineGeometry(points) {
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  }
  function makeLine(points, color, loop) {
    const material = new THREE.LineBasicMaterial({ color: srgb(color), transparent: true });
    return new (loop ? THREE.LineLoop : THREE.Line)(lineGeometry(points), material);
  }
  function setupMain() {
    main.scene = new THREE.Scene(); main.scene.background = new THREE.Color('#ECEEE9');
    main.camera = new THREE.PerspectiveCamera(38, 1, .05, 140); main.camera.up.set(0, 0, 1);
    main.renderer = new THREE.WebGLRenderer({ antialias: true });
    main.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); main.renderer.outputEncoding = THREE.sRGBEncoding;
    $('scene').prepend(main.renderer.domElement);
    main.controls = new THREE.OrbitControls(main.camera, main.renderer.domElement);
    Object.assign(main.controls, { enableDamping: true, dampingFactor: .08, enablePan: false, minDistance: 2.4, maxDistance: 16, minPolarAngle: .08, maxPolarAngle: Math.PI - .1 });
    main.material = new THREE.ShaderMaterial({
      uniforms: { uSep: { value: 0 }, uColorMix: { value: 0 }, uPick: { value: 0 }, uLift: { value: 0 }, uFall: { value: 0 }, uExtract: { value: 0 } },
      vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG, side: THREE.DoubleSide, extensions: { derivatives: true }
    });
    buildBoard(); buildSurface(state.n);
    main.marker = makeLine(M.cellCorners(state.n, state.pickCell.i, state.pickCell.j), '#8A4B12', true);
    main.scene.add(main.marker);
    const names = ['Σ 曲面', 'Dxy 投影区域', '取这一块', 'x', 'y', 'z'];
    labelsMain = names.map((v, i) => makeLabel($('labels'), v, i < 3 ? 'chip' + (i === 2 ? ' strong' : '') : ''));
    labelsMain[0].pos.set(1.35, .9, M.z(1.35, .9) + .34);
    labelsMain[1].pos.set(0, -2.5, .06);
    labelsMain[3].pos.set(2.78, 0, .06); labelsMain[4].pos.set(0, 2.78, .06); labelsMain[5].pos.set(0, 0, 2.34);
  }

  function setupMicro() {
    micro.scene = new THREE.Scene(); micro.scene.background = new THREE.Color('#F3F1EA');
    micro.camera = new THREE.PerspectiveCamera(38, 1, .05, 80); micro.camera.up.set(0, 0, 1);
    micro.renderer = new THREE.WebGLRenderer({ antialias: true });
    micro.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); micro.renderer.outputEncoding = THREE.sRGBEncoding;
    $('micro-scene').prepend(micro.renderer.domElement);
    micro.controls = new THREE.OrbitControls(micro.camera, micro.renderer.domElement);
    Object.assign(micro.controls, { enableDamping: true, dampingFactor: .08, enablePan: false, minDistance: 4, maxDistance: 14, minPolarAngle: .12, maxPolarAngle: Math.PI - .12, autoRotate: false });
    micro.scene.add(new THREE.AmbientLight('#ffffff', .85));
    const light = new THREE.DirectionalLight('#ffffff', .65); light.position.set(-2, -4, 6); micro.scene.add(light);
    micro.root = new THREE.Group(); micro.scene.add(micro.root);
    micro.board = new THREE.GridHelper(3.5, 10, '#b8c1b6', '#d8ddd3'); micro.board.rotation.x = Math.PI / 2;
    micro.root.add(micro.board);
    micro.rays = new THREE.LineSegments(lineGeometry(Array.from({ length: 8 }, () => [0, 0, 0])),
      new THREE.LineDashedMaterial({ color: srgb('#AC6620'), dashSize: .10, gapSize: .07, transparent: true }));
    micro.root.add(micro.rays);
    micro.nArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1.5), .9, srgb('#365D87'), .18, .10);
    micro.kArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1.5), .9, srgb('#2D7D62'), .18, .10);
    micro.root.add(micro.nArrow, micro.kArrow);
    micro.arc = makeLine([[0, 0, 0], [0, 0, 0]], '#343C38'); micro.root.add(micro.arc);
    labelsMicro = ['曲面片 ΔSᵢ', '底面 Δxᵢ Δyᵢ', 'n', 'k', 'γ'].map((v, i) => makeLabel($('micro-labels'), v, 'chip ' + (i === 0 ? 'strong' : i === 1 || i === 2 ? 'cool' : 'good')));
    rebuildMicro();
  }

  function disposeObject(obj) {
    if (!obj) return;
    micro.root.remove(obj); obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  }
  function rebuildMicro() {
    const p = state.patch, hh = p.dx / 2, zoom = 1.1 / hh, seg = 16;
    const curved = [], planar = [], indices = [], ring = [], corners = [];
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
      const x = (i / seg * 2 - 1) * hh, y = (j / seg * 2 - 1) * hh;
      curved.push(x * zoom, y * zoom, (M.z(p.x + x, p.y + y) - M.z(p.x, p.y)) * zoom + 1.5);
      planar.push(x * zoom, y * zoom, (p.zx * x + p.zy * y) * zoom + 1.5);
      if (i < seg && j < seg) { const a = j * (seg + 1) + i; indices.push(a, a + 1, a + seg + 2, a, a + seg + 2, a + seg + 1); }
    }
    for (let i = 0; i <= seg; i++) ring.push(i);
    for (let j = 1; j <= seg; j++) ring.push(j * (seg + 1) + seg);
    for (let i = seg - 1; i >= 0; i--) ring.push(seg * (seg + 1) + i);
    for (let j = seg - 1; j > 0; j--) ring.push(j * (seg + 1));
    [0, seg, seg * (seg + 1) + seg, seg * (seg + 1)].forEach(k => corners.push(curved.slice(k * 3, k * 3 + 3)));
    ['patchMesh', 'border', 'shadow', 'shadowEdge'].forEach(k => disposeObject(micro[k]));
    const g = lineGeometry([]); g.setAttribute('position', new THREE.Float32BufferAttribute(curved, 3)); g.setIndex(indices); g.computeVertexNormals();
    micro.patchColor = rampColor(rhoT(p.x, p.y), new THREE.Color());
    micro.patchMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: micro.patchColor, side: THREE.DoubleSide }));
    micro.border = makeLine(ring.map(k => curved.slice(k * 3, k * 3 + 3)), '#8A4B12', true);
    micro.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ color: srgb('#365D87'), transparent: true, opacity: .25, side: THREE.DoubleSide }));
    micro.shadow.position.z = .012;
    micro.shadowEdge = makeLine([[-1.1, -1.1, .018], [1.1, -1.1, .018], [1.1, 1.1, .018], [-1.1, 1.1, .018]], '#365D87', true);
    micro.root.add(micro.patchMesh, micro.border, micro.shadow, micro.shadowEdge);
    Object.assign(micro, { curved, planar, ring, corners, zoom, lastTangent: -1 });
    micro.normal = new THREE.Vector3(...M.unitNormal(p.x, p.y));
    micro.horizontal = new THREE.Vector3(micro.normal.x, micro.normal.y, 0);
    if (micro.horizontal.lengthSq() < .000001) micro.horizontal.set(1, 0, 0);
    micro.horizontal.normalize();
    const arc = Array.from({ length: 41 }, (_, i) => { const a = p.gamma * i / 40; return [micro.horizontal.x * .48 * Math.sin(a), micro.horizontal.y * .48 * Math.sin(a), 1.5 + .48 * Math.cos(a)]; });
    micro.arc.geometry.dispose(); micro.arc.geometry = lineGeometry(arc);
    if (main.marker) {
      main.marker.geometry.dispose(); main.marker.geometry = lineGeometry(M.cellCorners(state.n, state.pickCell.i, state.pickCell.j).map(v => [v[0], v[1], v[2] + .018]));
    }
    lastText = -1; lastMath = '';
  }
  function resetViews() {
    if (!graphic) return;
    main.camera.position.set(...CAM.pos); main.controls.target.set(...CAM.target);
    // 沿坡向的侧上方看斜片，保持法向夹角可见；不作自动旋转。
    const n = M.unitNormal(state.pick.x, state.pick.y), across = new THREE.Vector3(n[1], -n[0], 0);
    if (across.lengthSq() < .0001) across.set(1, 0, 0); across.normalize();
    const view = new THREE.Vector3(n[0], n[1], n[2]).multiplyScalar(.82).addScaledVector(across, .60).normalize();
    micro.camera.position.copy(new THREE.Vector3(0, 0, .9).addScaledVector(view, 7.2));
    micro.controls.target.set(0, 0, .9); main.controls.update(); micro.controls.update();
  }
  function resize() {
    if (!graphic) return;
    [[main, $('scene')], [micro, $('micro-scene')]].forEach(([v, host]) => {
      if (!host.clientWidth || !host.clientHeight) return;
      v.camera.aspect = host.clientWidth / host.clientHeight; v.camera.updateProjectionMatrix(); v.renderer.setSize(host.clientWidth, host.clientHeight);
    });
  }

  function recompute() {
    updatePickId(); state.sums = M.sums(state.n, state.rhoMode); state.exact = M.exact(state.rhoMode);
    text($('meter-area'), fmt(state.sums.area)); text($('meter-mass'), fmt(state.sums.mass));
    text($('area-exact'), fmt(state.exact.area)); text($('mass-exact'), fmt(state.exact.mass));
    text($('n-label'), `N = ${state.n} · ${(state.n ** 2).toLocaleString()} 块`);
    text($('legend-range'), state.rhoMode === 'uniform' ? 'ρ = 1 g/cm²' : '0.8 — 3.6 g/cm²');
    $('color-scale').style.background = state.rhoMode === 'uniform' ? '#E1A244' : '';
    document.querySelectorAll('[data-rho]').forEach(b => { const on = b.dataset.rho === state.rhoMode; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on); });
    if (graphic) { buildSurface(state.n); refreshTint(); rebuildMicro(); }
    lastText = -1; lastMath = ''; render();
  }

  const lesson = [
    ['等一块曲面片过来', 'M=\\iint_{\\Sigma}\\rho\\,\\mathrm{d}S', 'M = ∬Σ ρ dS', 'ρ 是面密度：每单位曲面面积的质量。'],
    ['密度随位置变化', '\\rho=\\rho(x,y,z)', 'ρ = ρ(x, y, z)', '颜色表示面密度，不把高度当作面积。'],
    ['现在是有限大小的小片', '\\Delta M_i\\approx\\rho_i\\,\\Delta S_i', 'ΔMᵢ ≈ ρᵢ ΔSᵢ', '小片还有弯曲，不能直接把它当成底面矩形。'],
    ['跟住高亮的这一块', '\\Delta S_i\\quad\\text{有限曲面片的面积}', 'ΔSᵢ：有限曲面片的面积', '边框标明它在原曲面上的位置。'],
    ['同一块，只把显示放大', '\\Delta S_i\\quad\\text{仍是刚才那一块}', 'ΔSᵢ 仍是刚才那一块', '边界和实际范围不变；显示尺寸不代表真实面积。'],
    ['曲面够小时，近似成斜平面', '\\Delta S_i\\approx\\Delta S_{\\mathrm{tan},i}', 'ΔSᵢ ≈ ΔS切平面,i', '图形渐变到中心点的切平面；调大 N，比较两种面积。'],
    ['底面面积容易算', '\\Delta A_i=\\Delta x_i\\,\\Delta y_i', 'ΔAᵢ = Δxᵢ Δyᵢ', '虚线沿 z 方向投下，斜片保持原来的倾斜。'],
    ['同样的宽，长度缩短了', '\\Delta A_i=\\Delta S_{\\mathrm{tan},i}\\cos\\gamma', 'ΔAᵢ = ΔS切平面,i × cos γ', 'γ 是斜平面与水平面的夹角；水平时等大，倾斜时投影更小。'],
    ['面积因子：把影子还原为斜片', '\\Delta S_i\\approx\\underbrace{\\sqrt{1+z_x^2+z_y^2}}_{1/\\cos\\gamma}\\,\\Delta A_i', 'ΔSᵢ ≈ √(1 + zₓ² + zᵧ²) ΔAᵢ', 'n 与竖直方向 k 的夹角也是 γ；根号是面积比，不是多出的面积。'],
    ['密度 × 面积，才是这块的质量', '\\Delta M_i\\approx\\rho_i\\sqrt{1+z_x^2+z_y^2}\\,\\Delta x_i\\Delta y_i', 'ΔMᵢ ≈ ρᵢ √(1 + zₓ² + zᵧ²) Δxᵢ Δyᵢ', '先用面积因子还原曲面面积，再乘这一块的面密度。'],
    ['每块都这样算，再相加', 'M\\approx\\sum_i\\rho_i\\sqrt{1+z_{x,i}^2+z_{y,i}^2}\\,\\Delta x_i\\Delta y_i', 'M ≈ Σᵢ ρᵢ √(1 + zₓ,ᵢ² + zᵧ,ᵢ²) Δxᵢ Δyᵢ', '左侧下落表示把质量贡献记到底面网格。'],
    ['取极限，才写成面积微元 dS', '\\begin{gathered}\\mathrm{d}S=\\sqrt{1+z_x^2+z_y^2}\\,\\mathrm{d}x\\mathrm{d}y\\\\[5pt] M=\\iint_{D_{xy}}\\rho(x,y,z(x,y))\\sqrt{1+z_x^2+z_y^2}\\,\\mathrm{d}x\\mathrm{d}y\\end{gathered}', 'dS = √(1 + zₓ² + zᵧ²) dx dy；M = ∬D ρ(x,y,z(x,y)) √(1+zₓ²+zᵧ²) dx dy', '每个位置的密度与面积因子一起积分；均匀 ρ=1 时就是表面积。']
  ];

  function renderText(s) {
    const step = C.steps[s.textStep], p = state.patch, row = lesson[s.textStep];
    if (lastText !== s.textStep) {
      text($('log-title'), step.title); text($('log-note'), step.note);
      text($('micro-title'), row[0]); math($('micro-equation'), row[1], row[2]); text($('micro-reason'), row[3]);
      text($('micro-kicker'), s.textStep < 5 ? '跟住同一块有限曲面片' : s.textStep < 11 ? '先在有限小片上做局部近似' : '分割趋细后的局部关系');
      $('normal-detail').hidden = s.textStep < 8;
      $('scroll-hint').hidden = s.textStep < 7;
      math($('normal-formula'), '\\vec n=(-z_x,-z_y,1),\\quad \\cos\\gamma=\\frac{\\vec n\\cdot\\vec k}{|\\vec n||\\vec k|}=\\frac{1}{\\sqrt{1+z_x^2+z_y^2}}', 'n = (−zₓ, −zᵧ, 1)，k = (0,0,1)，cos γ = 1 / √(1+zₓ²+zᵧ²)');
      lastText = s.textStep;
    }
    const key = `${s.textStep}|${state.n}|${state.pickId}|${state.rhoMode}`;
    if (lastMath !== key) {
      let nums = `选中第 ${state.pickId + 1} 块 · 实际 Δx = Δy = ${fmt(p.dx, 4)} cm`;
      if (s.textStep >= 4) nums += `<br>曲面面积 ≈ <b>${fmt(p.area, 6)}</b> cm²`;
      if (s.textStep >= 5) nums += ` · 切平面面积 <b>${fmt(p.planeArea, 6)}</b> cm²`;
      if (s.textStep >= 6) nums += `<br>底面面积 <b>${fmt(p.projectedArea, 6)}</b> cm² · 面积比 <b>${fmt(p.factor, 3)}</b>`;
      if (s.textStep >= 7) nums += ` · γ = ${fmt(p.gamma * 180 / Math.PI, 1)}°`;
      if (s.textStep >= 9) nums += `<br>ρᵢ = ${fmt(M.rho(p.x, p.y, state.rhoMode), 3)} g/cm² · 小片质量 ≈ <b>${fmt(p.planeArea * M.rho(p.x, p.y, state.rhoMode), 6)}</b> g`;
      if (s.textStep < 3) nums = '';
      $('patch-numbers').innerHTML = nums; lastMath = key;
    }
    $('micro-lesson').style.opacity = s.textAlpha;
    document.querySelector('.lesson-log').style.opacity = s.textAlpha;
  }

  function render() {
    const s = C.sample(clock.t); P = s.values;
    renderText(s);
    text($('log-step'), `${String(s.step + 1).padStart(2, '0')} / 12`);
    $('progress').value = clock.t;
    $('progress').setAttribute('aria-valuetext', `第 ${s.step + 1} 步，${C.steps[s.step].title}`);
    document.querySelectorAll('.step-dot').forEach((el, i) => { el.classList.toggle('is-active', i === s.step); el.classList.toggle('is-done', i < s.step); el.setAttribute('aria-current', i === s.step ? 'step' : 'false'); });
    document.querySelectorAll('[data-capsule]').forEach(b => { const on = +b.dataset.capsule === C.steps[s.step].capsule; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on); });
    $('prev').disabled = clock.t <= 0; $('next').disabled = clock.t >= C.duration;
    const moving = state.playing || (tween && tween.isActive());
    text($('play'), moving ? 'Ⅱ 暂停' : clock.t >= C.duration ? '↺ 重播' : '▶ 播放');
    $('play').setAttribute('aria-label', moving ? '暂停演示' : '播放演示');
    text($('stage-status'), P.transfer > .99 && P.fall < .1 ? '这一块已移到右侧' : C.steps[s.step].title);
    text($('micro-badge'), P.transfer > .999 ? `同一块 #${state.pickId + 1}` : s.step === 4 ? '正在移入' : '等待取片');
    text($('stage-caption'), P.fall > .9 ? '质量贡献记在 Dxy 上，面积因子已计入' : 'z = z(x, y) · D = [−2, 2]²');
    alpha($('sum-receipt'), P.fall);
    text($('counter-value'), `${fmt(state.sums.mass * P.fall)} g`);
    text($('counter-note'), `N = ${state.n} · ${state.n ** 2} 块；高精度数值参考 ${fmt(state.exact.mass)} g`);
    $('section-strip').style.height = `${145 * P.section}px`; $('section-strip').style.opacity = P.section;
    $('micro-empty').style.opacity = 1 - P.transfer; $('micro-empty').hidden = P.transfer >= .999;
    alpha($('zoom-note'), P.transfer);
    text($('zoom-note'), `实际边长 ${fmt(state.patch.dx, 4)} cm · ${P.tangent > .99 ? '切平面近似' : '同一曲面片，显示放大'}`);
    drawSection();
    if (graphic) syncGraphic();
  }

  function drawSection() {
    const p = state.patch, L = 125, a = p.gamma;
    const A = [112, 112], B = [A[0] + L * Math.cos(a), A[1] - L * Math.sin(a)], D = [B[0], A[1]];
    const path = (id, value) => $(id).setAttribute('d', value);
    path('section-triangle', `M${A} L${B} L${D} Z`);
    path('section-slope', `M${A} L${B}`); path('section-base', `M${A} L${D}`); path('section-drop', `M${B} L${D}`);
    const r = 32;
    path('section-arc', `M${A[0] + r},${A[1]} A${r},${r} 0 0 0 ${A[0] + r * Math.cos(a)},${A[1] - r * Math.sin(a)}`);
    $('section-angle').setAttribute('x', A[0] + 46 * Math.cos(a / 2)); $('section-angle').setAttribute('y', A[1] - 46 * Math.sin(a / 2) - 4);
    text($('section-angle'), `γ = ${fmt(a * 180 / Math.PI, 1)}°`);
    $('section-length').setAttribute('x', (A[0] + B[0]) / 2 - 15); $('section-length').setAttribute('y', (A[1] + B[1]) / 2 - 12);
    text($('section-length'), '斜长 L');
  }

  function projectLabels(list, camera, host) {
    list.forEach(l => {
      const p = l.pos.clone().project(camera);
      l.el.hidden = !l.visible || p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1;
      l.el.style.left = `${(p.x / 2 + .5) * host.clientWidth}px`;
      l.el.style.top = `${(.5 - p.y / 2) * host.clientHeight}px`;
    });
  }
  function sourceCorners() {
    const corners = M.cellCorners(state.n, state.pickCell.i, state.pickCell.j);
    const c = new THREE.Vector3(state.pick.x, state.pick.y, M.z(state.pick.x, state.pick.y));
    const d1 = new THREE.Vector3(...corners[2]).sub(new THREE.Vector3(...corners[0]));
    const d2 = new THREE.Vector3(...corners[3]).sub(new THREE.Vector3(...corners[1]));
    const normal = d1.cross(d2).normalize();
    const { i, j } = state.pickCell;
    const r = (((i * 73856093) ^ (j * 19349663)) >>> 0) / 4294967295;
    return corners.map(v => new THREE.Vector3(...v).sub(c).multiplyScalar(1 - .14 * P.separate).add(c).addScaledVector(normal, (.035 + .11 * r) * P.separate).add(new THREE.Vector3(0, 0, P.pickLift * (.30 + .12 * r))));
  }
  function syncGraphic() {
    const u = main.material.uniforms;
    u.uColorMix.value = P.colorMix; u.uSep.value = P.separate; u.uLift.value = P.pickLift;
    u.uFall.value = P.fall; u.uPick.value = state.pickId; u.uExtract.value = P.transfer > .00001 && P.fall < .001 ? 1 : 0;
    main.boardTint.material.opacity = P.board * .78;
    main.marker.visible = P.pickLift > .01 && P.fall < .1;
    main.marker.material.opacity = P.pickLift;
    labelsMain[0].visible = P.fall < .1;
    labelsMain[1].visible = P.fall < .8;
    labelsMain[2].visible = P.pickLift > .2 && P.fall < .1;
    labelsMain[2].pos.set(state.pick.x, state.pick.y, M.z(state.pick.x, state.pick.y) + .6);
    text(labelsMain[2].el, P.transfer > .99 ? `#${state.pickId + 1} 原来的位置` : `取这一块 #${state.pickId + 1}`);

    micro.root.visible = P.transfer >= .999;
    if (P.tangent !== micro.lastTangent) {
      const pos = micro.patchMesh.geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i++) pos[i] = lerp(micro.curved[i], micro.planar[i], P.tangent);
      micro.patchMesh.geometry.attributes.position.needsUpdate = true;
      micro.patchMesh.geometry.computeVertexNormals();
      const edge = micro.border.geometry.attributes.position.array;
      micro.ring.forEach((k, i) => { edge.set(pos.slice(k * 3, k * 3 + 3), i * 3); });
      micro.border.geometry.attributes.position.needsUpdate = true;
      micro.lastTangent = P.tangent;
    }
    micro.shadow.visible = micro.shadowEdge.visible = micro.board.visible = P.rays > .01;
    micro.shadow.material.opacity = P.rays * .28; micro.shadowEdge.material.opacity = P.rays;
    micro.rays.visible = P.rays > .01; micro.rays.material.opacity = P.rays * .7;
    const ray = micro.rays.geometry.attributes.position.array;
    const hh = state.patch.dx / 2;
    [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([a, b], k) => {
      const x = a * 1.1, y = b * 1.1;
      const h = lerp((M.z(state.pick.x + a * hh, state.pick.y + b * hh) - M.z(state.pick.x, state.pick.y)) * micro.zoom,
        state.patch.zx * x + state.patch.zy * y, P.tangent) + 1.5;
      ray.set([x, y, .02, x, y, .02 + (h - .02) * P.rays], k * 6);
    });
    micro.rays.geometry.attributes.position.needsUpdate = true; micro.rays.computeLineDistances();
    const n = micro.normal;
    micro.nArrow.setDirection(n); micro.nArrow.setLength(.95 * Math.max(.01, P.normals), .16, .09);
    micro.kArrow.setLength(.95 * Math.max(.01, P.normals), .16, .09);
    micro.nArrow.visible = micro.kArrow.visible = P.normals > .02;
    micro.nArrow.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = P.normals; } });
    micro.kArrow.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = P.normals; } });
    const horizontal = micro.horizontal;
    micro.arc.visible = P.normals > .02; micro.arc.material.opacity = P.normals;
    text(labelsMicro[0].el, P.tangent > .99 ? '切平面小片（近似）' : `同一曲面片 #${state.pickId + 1}`);
    labelsMicro[0].pos.set(-1.18, .25, 1.6 - state.patch.zx * 1.18 + state.patch.zy * .25);
    labelsMicro[1].pos.set(.65, -.9, .04);
    labelsMicro[2].pos.copy(n).multiplyScalar(1.15).add(new THREE.Vector3(0, 0, 1.5));
    labelsMicro[3].pos.set(.23, .1, 2.7);
    labelsMicro[4].pos.copy(horizontal).multiplyScalar(.67 * Math.sin(state.patch.gamma / 2)).add(new THREE.Vector3(0, 0, 1.5 + .67 * Math.cos(state.patch.gamma / 2)));
    labelsMicro.forEach((l, i) => { l.visible = micro.root.visible && (i === 0 || (i === 1 ? P.rays > .7 : P.normals > .7)); });
    // 标签也随它解释的对象淡入。
    labelsMicro.forEach((l, i) => { l.el.style.opacity = i === 0 ? 1 : i === 1 ? P.rays : P.normals; });
    main.controls.update(); micro.controls.update();
    main.camera.updateMatrixWorld(); micro.camera.updateMatrixWorld();
    projectLabels(labelsMain, main.camera, $('scene')); projectLabels(labelsMicro, micro.camera, $('micro-scene'));
    // 两个面积标签放在各自轮廓外，避免投影标签看起来贴在斜片上。
    const host = $('micro-scene'), w = host.clientWidth, h = host.clientHeight;
    const screen = v => { const q = new THREE.Vector3(...v).project(micro.camera); return [(q.x / 2 + .5) * w, (.5 - q.y / 2) * h]; };
    const top = micro.corners.map((v, i) => screen(v.map((a, k) => k === 2 ? lerp(a, micro.planar[[0,16,288,272][i] * 3 + 2], P.tangent) : a)));
    const bottom = [[-1.1,-1.1,.018],[1.1,-1.1,.018],[1.1,1.1,.018],[-1.1,1.1,.018]].map(screen);
    const anchor = (el, pts, y) => { el.style.left = `${clamp(pts.reduce((sum,p)=>sum+p[0]/4,0), 95, w-95)}px`; el.style.top = `${clamp(y, 15, h-20)}px`; };
    anchor(labelsMicro[0].el, top, Math.min(...top.map(p=>p[1])) - 14);
    anchor(labelsMicro[1].el, bottom, Math.max(...bottom.map(p=>p[1])) + 13);
    drawTransfer();
  }

  function drawTransfer() {
    const q = P.transfer, active = q > .00001 && q < .999;
    const overlay = $('transfer-overlay'); overlay.style.visibility = active ? 'visible' : 'hidden';
    if (!active) return;
    const outer = $('workspace').getBoundingClientRect();
    overlay.setAttribute('viewBox', `0 0 ${outer.width} ${outer.height}`);
    function point(v, camera, host) {
      const b = host.getBoundingClientRect(), p = v.clone().project(camera);
      return [(p.x / 2 + .5) * b.width + b.left - outer.left, (.5 - p.y / 2) * b.height + b.top - outer.top];
    }
    const corners = sourceCorners();
    // 飞行边界从原网格边线连续过渡到放大后的曲边，落地时轮廓完全接上。
    const from = micro.ring.map(k => {
      const u = (micro.curved[k * 3] / 1.1 + 1) / 2, v = (micro.curved[k * 3 + 1] / 1.1 + 1) / 2;
      const world = corners[0].clone();
      if (v <= u) world.addScaledVector(corners[1].clone().sub(corners[0]), u).addScaledVector(corners[2].clone().sub(corners[1]), v);
      else world.addScaledVector(corners[2].clone().sub(corners[3]), u).addScaledVector(corners[3].clone().sub(corners[0]), v);
      return point(world, main.camera, $('scene'));
    });
    const to = micro.ring.map(k => point(new THREE.Vector3(...micro.curved.slice(k * 3, k * 3 + 3)), micro.camera, $('micro-scene')));
    const points = from.map((v, i) => [lerp(v[0], to[i][0], q), lerp(v[1], to[i][1], q)]);
    $('flying-patch').setAttribute('points', points.map(v => v.map(n => n.toFixed(3)).join(',')).join(' '));
    const color = rampColor(rhoT(state.pick.x, state.pick.y), new THREE.Color()).convertLinearToSRGB();
    $('flying-patch').setAttribute('fill', '#' + color.getHexString());
    const center = pts => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
    const a = center(from), b = center(points);
    $('transfer-trail').setAttribute('d', `M${a} L${b}`);
    $('flying-label').setAttribute('x', b[0]); $('flying-label').setAttribute('y', Math.min(...points.map(p => p[1])) - 15);
  }

  function stop() {
    state.playing = false; if (tween) { tween.pause(); } reducedClock = 0;
  }
  function writeLink() {
    try { history.replaceState(null, '', '#'+new URLSearchParams({ t: clock.t.toFixed(3), n: state.n, rho: state.rhoMode, patch: state.pickId })); } catch { /* file 环境下仍可使用控件。 */ }
  }
  function seek(t) {
    stop(); if (tween) { tween.kill(); tween = null; }
    clock.t = clamp(t, 0, C.duration); render(); writeLink();
  }
  function goToStep(step, instant) {
    stop(); if (tween) { tween.kill(); tween = null; }
    const target = clamp(step, 0, C.duration);
    if (state.reduced || !window.gsap || instant || Math.abs(target - clock.t) > 1.001) { seek(target); return; }
    // 与播放/拖动复用同一条时刻轴，不独立补间任何对象。
    tween = gsap.to(clock, { t: target, duration: .95 * Math.abs(target - clock.t), ease: 'none', onUpdate: render,
      onComplete: () => { tween = null; render(); writeLink(); } });
    tween.timeScale(state.speed);
  }
  function togglePlay() {
    if (state.playing || (tween && tween.isActive())) { stop(); render(); writeLink(); return; }
    if (!window.gsap) return;
    if (clock.t >= C.duration) clock.t = 0;
    state.playing = true;
    if (!state.reduced) {
      if (tween) tween.kill();
      tween = gsap.to(clock, { t: C.duration, duration: (C.duration - clock.t) * 4.2, ease: 'none', onUpdate: render,
        onComplete: () => { state.playing = false; render(); writeLink(); } });
      tween.timeScale(state.speed);
    }
    render();
  }
  function nextStep() { goToStep(Math.min(C.duration, Math.floor(clock.t + .00001) + 1)); }
  function prevStep() { goToStep(Math.max(0, Math.ceil(clock.t - .00001) - 1)); }
  function setPick(x, y) {
    stop(); state.pick = { x, y }; updatePickId();
    if (graphic) { rebuildMicro(); resetViews(); }
    lastText = -1; lastMath = ''; render(); writeLink();
  }

  function pickSurface(clientX, clientY) {
    const rect = $('scene').getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2), main.camera);
    const point = new THREE.Vector3(), ray = raycaster.ray;
    let prev = null, prevT = 0;
    for (let t = .25; t < 45; t += .06) {
      ray.at(t, point);
      if (Math.abs(point.x) > 2.3 || Math.abs(point.y) > 2.3) { prev = null; continue; }
      const g = point.z - M.z(point.x, point.y);
      if (prev !== null && prev > 0 && g <= 0) {
        let lo = prevT, hi = t;
        for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; ray.at(mid, point); if (point.z > M.z(point.x, point.y)) lo = mid; else hi = mid; }
        ray.at((hi + lo) / 2, point);
        return Math.abs(point.x) <= 2 && Math.abs(point.y) <= 2 ? { x: point.x, y: point.y } : null;
      }
      prev = g; prevT = t;
    }
    return null;
  }
  function bind() {
    C.steps.forEach((s, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'step-dot'; b.setAttribute('aria-label', `第 ${i + 1} 步：${s.title}`); b.title = s.title; b.addEventListener('click', () => goToStep(i)); $('step-track').append(b); });
    $('next').addEventListener('click', nextStep); $('prev').addEventListener('click', prevStep);
    $('restart').addEventListener('click', () => seek(0)); $('play').addEventListener('click', togglePlay);
    $('progress').addEventListener('input', e => seek(+e.target.value));
    $('speed').addEventListener('change', e => { state.speed = +e.target.value; if (tween) tween.timeScale(state.speed); });
    $('reduce-motion').checked = state.reduced;
    const motion = value => { const was = state.playing; stop(); state.reduced = value; $('reduce-motion').checked = value; document.body.dataset.reduced = value;
      if (value) clock.t = Math.ceil(clock.t); render(); if (was) togglePlay(); };
    document.body.dataset.reduced = state.reduced;
    $('reduce-motion').addEventListener('change', e => motion(e.target.checked));
    media.addEventListener('change', e => motion(e.matches));
    document.querySelectorAll('[data-capsule]').forEach(b => b.addEventListener('click', () => goToStep(C.steps.findIndex(s => s.capsule === +b.dataset.capsule))));
    $('n-slider').addEventListener('input', e => { stop(); if (tween) { tween.kill(); tween = null; } state.n = N_STOPS[+e.target.value]; recompute(); writeLink(); });
    document.querySelectorAll('[data-rho]').forEach(b => b.addEventListener('click', () => { stop(); state.rhoMode = b.dataset.rho; recompute(); writeLink(); }));
    $('change-patch').addEventListener('click', () => { const id = (state.pickId + Math.max(1, Math.floor(state.n / 2))) % state.n ** 2; const [x, y] = M.cellCenter(state.n, id % state.n, Math.floor(id / state.n)); setPick(x, y); });
    $('reset-view').addEventListener('click', () => { stop(); resetViews(); render(); });
    document.addEventListener('keydown', e => {
      if (e.target.closest('button, input, select, a, textarea, summary') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowRight') { e.preventDefault(); nextStep(); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); prevStep(); }
      if (e.code === 'Home') { e.preventDefault(); seek(0); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); render(); writeLink(); } });
    if (graphic) {
      let down = null;
      const host = $('scene');
      host.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
      host.addEventListener('pointerup', e => { if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6 || P.fall > .01) return; down = null; const p = pickSurface(e.clientX, e.clientY); if (p) setPick(p.x, p.y); });
      host.addEventListener('pointermove', e => {
        const p = P.fall < .01 ? pickSurface(e.clientX, e.clientY) : null;
        $('probe').hidden = !p; if (!p) return;
        text($('probe'), `ρ = ${fmt(M.rho(p.x, p.y, state.rhoMode), 3)} g/cm²`);
        const r = host.getBoundingClientRect(); $('probe').style.left = `${clamp(e.clientX - r.left + 12, 5, r.width - 185)}px`; $('probe').style.top = `${clamp(e.clientY - r.top - 32, 5, r.height - 40)}px`;
      });
      host.addEventListener('pointerleave', () => { $('probe').hidden = true; down = null; });
      const observer = new ResizeObserver(resize); observer.observe($('scene')); observer.observe($('micro-scene'));
    }
    if (!window.gsap) {
      $('play').disabled = true; $('engine-notice').hidden = false; text($('engine-notice'), '动画资源未加载，仍可用单步与进度条查看完整演示。');
    }
  }

  function animate(now) {
    const dt = Math.min(.1, (now - (animate.last || now)) / 1000); animate.last = now;
    if (state.playing && state.reduced) {
      reducedClock += dt * state.speed;
      if (reducedClock >= .9) { reducedClock = 0; clock.t = Math.min(C.duration, Math.floor(clock.t) + 1); if (clock.t >= C.duration) state.playing = false; render(); writeLink(); }
    }
    if (graphic) {
      // 用户手动旋转时，投影标签和飞行端点仍与对象对齐。
      syncGraphic(); main.renderer.render(main.scene, main.camera); micro.renderer.render(micro.scene, micro.camera);
    }
    requestAnimationFrame(animate);
  }

  const link = new URLSearchParams(location.hash.slice(1));
  const requestedN = Number(link.get('n') || new URLSearchParams(location.search).get('n'));
  if (N_STOPS.includes(requestedN)) state.n = requestedN;
  $('n-slider').value = N_STOPS.indexOf(state.n);
  if (link.get('rho') === 'uniform') state.rhoMode = 'uniform';
  const id = Number(link.get('patch'));
  if (link.has('patch') && Number.isInteger(id) && id >= 0 && id < state.n ** 2) {
    const [x, y] = M.cellCenter(state.n, id % state.n, Math.floor(id / state.n)); state.pick = { x, y };
  }
  updatePickId();
  if (hasThree) {
    try { setupMain(); setupMicro(); graphic = true; resetViews(); resize(); }
    catch (error) { console.warn('三维画面不可用：', error.message); }
  }
  if (!graphic) {
    $('scene-error').hidden = false; text($('scene-error'), '三维资源未加载或 WebGL 不可用。仍可逐步查看面积关系与数值；联网并启用图形加速后刷新可恢复图形。');
    $('micro-empty').innerHTML = '<strong>图形暂不可用</strong><span>下方保留逐步讲解与计算结果。</span>';
    $('reset-view').disabled = true;
  }
  bind(); recompute();
  const oldStep = /^#s(\d+)$/.exec(location.hash);
  seek(link.has('t') ? Number(link.get('t')) || 0 : oldStep ? +oldStep[1] - 1 : 0);
  requestAnimationFrame(animate);
})();
