/* 第一类曲面积分：宏观铁皮视口 + 微元显微台 + 投影底板联动。
   所有视觉状态都来自一个可补间的参数快照 P，因此任意前后跳步都不会留下后置状态。 */
(function () {
  'use strict';

  const M = window.SurfaceModel;
  const $ = id => document.getElementById(id);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const srgb = hex => new THREE.Color(hex).convertSRGBToLinear();
  const fmt = (v, d = 4) => Number(v).toFixed(d);

  const N_STOPS = [4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
  const RAMP = ['#FAF3E6', '#E1A244', '#8C4A14'].map(srgb);
  const UNIFORM_T = 0.45;
  const MICRO_HH = 0.34;                 // 显微台微元半宽（cm）
  const PICK0 = { x: -0.6, y: 0.5 };

  const state = {
    n: 16, rhoMode: 'gradient', capsule: 1, step: 0,
    playing: false, speed: 1, stepClock: 0,
    pick: { x: PICK0.x, y: PICK0.y }, pickId: 0, pickCell: { i: 0, j: 0 },
    sums: { area: 0, mass: 0 }, exact: { area: 0, mass: 0 }
  };

  // 可补间参数快照（每一步都写全量，回退不会残留）
  const OFF = {
    colorMix: 0, separate: 0, pickLift: 0, board: 0, fall: 0, counter: 0,
    rise: 0, rays: 0, normals: 0, arc: 0, grad: 0, dot: 0, press: 0, shadowHi: 0
  };
  const P = Object.assign({}, OFF);

  const main = {}, micro = {};
  let labelsMain = [], labelsMicro = [], pickMarker = {}, pickDrop = null, balanceTween = null;
  const STEPS = [];

  /* ================== 数学 → 视觉 ================== */
  function rampColor(t, out) {
    t = clamp(t, 0, 1);
    const [a, b, c] = RAMP;
    if (t < 0.55) return out.copy(a).lerp(b, t / 0.55);
    return out.copy(b).lerp(c, (t - 0.55) / 0.45);
  }
  function rhoT(x, y) {
    if (state.rhoMode === 'uniform') return UNIFORM_T;
    return (M.rho(x, y, 'gradient') - M.RHO_MIN) / (M.RHO_MAX - M.RHO_MIN);
  }
  const tmpColor = () => new THREE.Color();

  /* ================== 主舞台：曲面网格 ================== */
  const SURFACE_VERT = [
    'attribute vec3 aCenter; attribute vec3 aNrm; attribute vec3 aCol;',
    'attribute float aRand; attribute float aId; attribute vec2 aLocal;',
    'uniform float uSep, uPick, uLift, uFall, uTime;',
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
    '  p.z += 0.05 * sin(uTime * 2.2 + aRand * 31.0) * e * (1.0 - e) * 4.0;',
    '  vec3 n = normalize(mix(aNrm, vec3(0.0, 0.0, 1.0), e));',
    '  vec3 L = normalize(vec3(-0.42, -0.5, 0.76));',
    '  vShade = 0.58 + 0.48 * max(dot(n, L), 0.0);',
    '  vCol = aCol; vLocal = aLocal; vPick = picked; vLift = picked * uLift;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');

  const SURFACE_FRAG = [
    'uniform float uSep, uColorMix;',
    'varying vec3 vCol; varying vec2 vLocal; varying float vShade, vPick, vLift;',
    'void main() {',
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

  function refreshSurfaceColors() {
    const attr = main.mesh.geometry.getAttribute('aCol');
    const center = main.mesh.geometry.getAttribute('aCenter');
    const tmp = tmpColor();
    for (let id = 0; id < main.n * main.n; id++) {
      rampColor(rhoT(center.getX(id * 6), center.getY(id * 6)), tmp);
      for (let k = 0; k < 6; k++) attr.setXYZ(id * 6 + k, tmp.r, tmp.g, tmp.b);
    }
    attr.needsUpdate = true;
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

  /* ================== 选中微元的地面标记 ================== */
  function updatePickMarker() {
    const n = main.n, dx = 4 / n, dy = 4 / n;
    const i = state.pickCell.i, j = state.pickCell.j;
    const x0 = -2 + i * dx, y0 = -2 + j * dy;
    const cx = x0 + dx / 2, cy = y0 + dy / 2, cz = M.z(cx, cy);
    state.pick = { x: cx, y: cy };

    const ring = [[x0, y0], [x0 + dx, y0], [x0 + dx, y0 + dy], [x0, y0 + dy]]
      .map(([x, y]) => [x, y, M.z(x, y) + 0.014]);
    pickMarker.outline.geometry.dispose();
    pickMarker.outline.geometry = new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute(ring.flat(), 3));

    pickDrop.geometry.dispose();
    pickDrop.geometry = new THREE.BufferGeometry().setAttribute('position',
      new THREE.Float32BufferAttribute([cx, cy, cz + 0.014, cx, cy, 0.034], 3));
    pickDrop.computeLineDistances();
  }

  function updatePickId() {
    const n = main.n, dx = 4 / n, dy = 4 / n;
    state.pickCell.i = clamp(Math.floor((state.pick.x + 2) / dx), 0, n - 1);
    state.pickCell.j = clamp(Math.floor((state.pick.y + 2) / dy), 0, n - 1);
    state.pickId = state.pickCell.j * n + state.pickCell.i;
    updatePickMarker();
  }

  function buildPickMarker() {
    pickMarker.outline = new THREE.LineLoop(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: srgb('#8A4B12'), transparent: true, opacity: 0 }));
    pickMarker.outline.frustumCulled = false;
    main.scene.add(pickMarker.outline);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    pickDrop = new THREE.Line(g, new THREE.LineDashedMaterial({
      color: srgb('#8A4B12'), dashSize: 0.1, gapSize: 0.08, transparent: true, opacity: 0
    }));
    pickDrop.frustumCulled = false;
    main.scene.add(pickDrop);
  }

  /* ================== 显微台 ================== */
  function makeArrow(color, shaftR, headR, headLen) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: srgb(color), transparent: true });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, 1, 10), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(headR, headLen, 14), mat);
    g.add(shaft, head);
    g.userData = { shaft, head, headLen, mat };
    g.setLength = L => {
      const s = Math.max(0.05, L - headLen);
      shaft.scale.y = s; shaft.position.y = s / 2;
      head.position.y = s + headLen / 2;
    };
    g.setLength(1);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    return g;
  }

  function buildPatchGeometry() {
    const seg = 10, hh = MICRO_HH, px = state.pick.x, py = state.pick.y, z0 = M.z(px, py);
    const pos = [], idx = [], col = [], edge = [], ring = [], border = [], borderFlat = [];
    const tmp = tmpColor();

    for (let j = 0; j <= seg; j++) {
      for (let i = 0; i <= seg; i++) {
        const x = px + (i / seg * 2 - 1) * hh, y = py + (j / seg * 2 - 1) * hh;
        pos.push(x - px, y - py, M.z(x, y) - z0);
        rampColor(rhoT(x, y), tmp);
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i, b = a + 1, d = a + seg + 1, e = d + 1;
        idx.push(a, b, e, a, e, d);
      }
    }
    for (let i = 0; i <= seg; i++) for (let j = 0; j < seg; j++) {   // 竖向网格
      const a = j * (seg + 1) + i, b = a + seg + 1;
      edge.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    }
    for (let j = 0; j <= seg; j++) for (let i = 0; i < seg; i++) {   // 横向网格
      const a = j * (seg + 1) + i, b = a + 1;
      edge.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    }
    for (let i = 0; i <= seg; i++) ring.push([i, 0]);
    for (let i = 1; i <= seg; i++) ring.push([seg, i]);
    for (let i = seg - 1; i >= 0; i--) ring.push([i, seg]);
    for (let i = seg - 1; i >= 1; i--) ring.push([0, i]);
    ring.forEach(([i, j]) => {
      const k = (j * (seg + 1) + i) * 3;
      border.push(pos[k], pos[k + 1], pos[k + 2]);
      borderFlat.push(pos[k], pos[k + 1], 0);
    });

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();

    const flat = new THREE.BufferGeometry();
    flat.setAttribute('position', new THREE.Float32BufferAttribute(pos.map((v, k) => (k % 3 === 2 ? 0 : v)), 3));
    flat.setIndex(idx.slice());
    flat.computeVertexNormals();
    const borderGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(border, 3));
    const borderFlatGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(borderFlat, 3));
    const edgeGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));

    if (micro.patchMesh) {
      micro.patchGroup.remove(micro.patchMesh, micro.patchGrid, micro.patchBorder);
      micro.patchMesh.geometry.dispose();
      micro.patchGrid.geometry.dispose();
      micro.patchBorder.geometry.dispose();
      micro.shadow.geometry.dispose();
      micro.shadowEdge.geometry.dispose();
    }
    micro.patchBaseColors = col.slice();
    micro.patchMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    micro.patchGrid = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: srgb('#57534E'), transparent: true, opacity: 0.5 }));
    micro.patchBorder = new THREE.LineLoop(borderGeo.clone(), new THREE.LineBasicMaterial({ color: srgb('#1C1917') }));
    micro.patchGroup.add(micro.patchMesh, micro.patchGrid, micro.patchBorder);

    if (micro.shadow) {
      micro.shadow.geometry = flat;
      micro.shadowEdge.geometry = borderFlatGeo;
    } else {
      micro.shadowGeo = flat;
      micro.shadowEdgeGeo = borderFlatGeo;
    }
    updatePatchColors();
  }

  function updatePatchColors() {
    if (!micro.patchMesh) return;
    const attr = micro.patchMesh.geometry.getAttribute('color');
    const base = micro.patchBaseColors;
    for (let i = 0; i < attr.count; i++) {
      attr.setXYZ(i,
        lerp(1, base[i * 3], P.colorMix),
        lerp(1, base[i * 3 + 1], P.colorMix),
        lerp(1, base[i * 3 + 2], P.colorMix));
    }
    attr.needsUpdate = true;
  }

  function microCamGoal() {
    const Hc = micro.Hc || M.z(state.pick.x, state.pick.y);
    const n = M.unitNormal(state.pick.x, state.pick.y);
    const nn = new THREE.Vector3(n[0], n[1], n[2]);
    let u = new THREE.Vector3(n[1], -n[0], 0);        // n × k：夹角圆弧所在平面的法向
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize();
    // -0.82·n + 0.60·u：既看得清斜面，又让 γ 张开
    const view = nn.clone().multiplyScalar(-0.82).addScaledVector(u, 0.6).normalize();
    const pos = new THREE.Vector3(0, 0, Hc).addScaledVector(view, -4.6);
    return {
      pos: [pos.x, pos.y, pos.z],
      target: [0, 0, clamp(Hc * 0.42, 0.14, 0.7)]
    };
  }

  function buildMicro() {
    const scene = micro.scene;
    const Hc = M.z(state.pick.x, state.pick.y);
    micro.Hc = Hc;
    micro.patchGroup = new THREE.Group();
    micro.patchGroup.position.z = Hc;
    scene.add(micro.patchGroup);

    const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({ map: boardTexture('base'), transparent: true, opacity: 0.8 }));
    board.position.z = -0.006;
    scene.add(board);
    micro.board = board;

    buildPatchGeometry();

    micro.shadow = new THREE.Mesh(micro.shadowGeo,
      new THREE.MeshBasicMaterial({ color: srgb('#93A3B8'), transparent: true, opacity: 0.6 }));
    micro.shadow.position.z = 0.014;
    scene.add(micro.shadow);
    micro.shadowEdge = new THREE.LineLoop(micro.shadowEdgeGeo,
      new THREE.LineBasicMaterial({ color: srgb('#57534E') }));
    micro.shadowEdge.position.z = 0.017;
    scene.add(micro.shadowEdge);

    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(4 * 2 * 3), 3));
    micro.rays = new THREE.LineSegments(rg, new THREE.LineDashedMaterial({
      color: srgb('#D97706'), dashSize: 0.07, gapSize: 0.055, transparent: true, opacity: 0
    }));
    micro.rays.frustumCulled = false;
    scene.add(micro.rays);

    micro.nArrow = makeArrow('#2563EB', 0.024, 0.07, 0.22);
    micro.kArrow = makeArrow('#059669', 0.024, 0.07, 0.22);
    micro.kGhost = makeArrow('#8ED6BC', 0.016, 0.05, 0.17);
    micro.nArrow.position.set(0, 0, Hc);
    micro.kArrow.position.set(0, 0, 0.03);
    micro.kGhost.position.set(0, 0, Hc);
    scene.add(micro.nArrow, micro.kArrow, micro.kGhost);

    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(64 * 3), 3));
    micro.arc = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: srgb('#8A4B12'), transparent: true, opacity: 0 }));
    micro.arc.frustumCulled = false;
    scene.add(micro.arc);

    micro.gx = makeArrow('#334155', 0.02, 0.062, 0.18);
    micro.gy = makeArrow('#334155', 0.02, 0.062, 0.18);
    micro.gx.position.set(0, 0, Hc);
    micro.gy.position.set(0, 0, Hc);
    scene.add(micro.gx, micro.gy);
  }

  function rebuildMicro() {
    const Hc = M.z(state.pick.x, state.pick.y);
    micro.Hc = Hc;
    micro.patchGroup.position.z = Hc;
    micro.nArrow.position.z = Hc;
    micro.kGhost.position.z = Hc;
    micro.gx.position.z = Hc;
    micro.gy.position.z = Hc;
    buildPatchGeometry();
    syncMicroNumbers();
    const cam = microCamGoal();
    micro.camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    micro.controls.target.set(cam.target[0], cam.target[1], cam.target[2]);
    micro.controls.update();
  }

  /* ================== 标签 ================== */
  function makeLabel(host, text, cls) {
    const el = document.createElement('span');
    el.className = 'axis-label' + (cls ? ' ' + cls : '');
    el.textContent = text;
    host.appendChild(el);
    return { el, pos: new THREE.Vector3(), visible: true };
  }

  function buildLabels() {
    const host = $('labels');
    const sx = 1.35, sy = 0.9;
    labelsMain = [
      makeLabel(host, 'Σ 铁皮曲面', 'chip'),
      makeLabel(host, 'Dxy 投影区域', 'chip'),
      makeLabel(host, 'ΔSᵢ', 'chip strong'),
      makeLabel(host, 'x'), makeLabel(host, 'y'),
      makeLabel(host, 'z'), makeLabel(host, 'O')
    ];
    labelsMain[0].pos.set(sx, sy, M.z(sx, sy) + 0.34);
    labelsMain[1].pos.set(0, -2.55, 0.06);
    labelsMain[3].pos.set(2.78, 0, 0.06);
    labelsMain[4].pos.set(0, 2.78, 0.06);
    labelsMain[5].pos.set(0, 0, 2.34);
    labelsMain[6].pos.set(-0.17, -0.17, 0.07);

    const host2 = $('micro-labels');
    labelsMicro = [
      makeLabel(host2, 'n', 'chip cool'),
      makeLabel(host2, 'k', 'chip good'),
      makeLabel(host2, 'γ', 'chip strong'),
      makeLabel(host2, 'dS', 'chip'),
      makeLabel(host2, 'dx dy', 'chip cool'),
      makeLabel(host2, '∂z/∂x', 'chip'),
      makeLabel(host2, '∂z/∂y', 'chip'),
      makeLabel(host2, 'k′ = (0,0,1)', 'chip good')
    ];
    labelsMicro.forEach(l => { l.visible = false; });
  }

  function buildStepTrack() {
    const host = $('step-track');
    for (let i = 0; i < STEPS.length; i++) {
      const d = document.createElement('i');
      d.className = 'step-dot';
      host.appendChild(d);
    }
  }

  /* ================== 步骤定义 ================== */
  function def(capsule, title, note, hold, over, cam) {
    return { capsule, title, note, hold, cam, set: Object.assign({}, OFF, over) };
  }
  function fillSteps() {
    STEPS.push(
      def(1, '一张还没上色的铁皮',
        '这就是空间中的曲面 Σ：z = z(x, y)，水平铺在 xOy 投影底板上方。此刻它通体纯白，还看不出哪里厚、哪里薄。',
        6, {}, 'overview'),
      def(1, '注入密度：各处厚薄不均',
        '曲面逐渐渲染成密度热力色——颜色越深，铁皮越厚越重。把鼠标滑过曲面可读出任意位置的 ρ；既然各处厚薄不同，“面积 × 一个密度”就不成立了。',
        11, { colorMix: 1, board: 0.95 }, 'overview'),
      def(2, '沿网格切碎曲面',
        '拖动细分滑块 N，曲面沿网格被平滑裁成 N² 块小碎片 ΔSᵢ。切得足够小，每块都近似一张平的、密度均匀的小铁片——以直代曲、以常代变。',
        9, { colorMix: 1, separate: 1, board: 0.6 }, 'overview'),
      def(2, '挑一块碎片称一称',
        '把一块微元浮起高亮：在这样小的尺度下密度近似恒定，于是 ΔMᵢ ≈ ρᵢ · ΔSᵢ。点击曲面任意位置，可以换一块再称一次。',
        9, { colorMix: 1, separate: 1, pickLift: 1, board: 0.6 }, 'overview'),
      def(2, '镜头推入微元显微台',
        '右侧特写工作台接管画面：放大后的曲面微元 dS 悬在空中，正下方是它在底板上的影子 dx dy，竖直虚线把两者一一对应。',
        7, { colorMix: 1, separate: 1, board: 0.6, rise: 1, rays: 0.7 }, 'close'),
      def(2, '两法向量的夹角 γ',
        '从微元中心引出斜面法向量 n，从影子中心引出竖直法向量 k = (0,0,1)；两向量平移到同一起点，展开夹角圆弧 γ——面与面的夹角，就是法向量的夹角。',
        12, { colorMix: 1, separate: 1, board: 0.6, rise: 1, rays: 0.7, normals: 1, arc: 1 }, 'close'),
      def(2, '点积算出 cos γ',
        '隐函数曲面 z = z(x,y) 的梯度给出 n = (−z_x, −z_y, 1)。点积除以模长之积，就得到 cos γ 的解析式：它只由两个偏导数决定。',
        13, { colorMix: 1, separate: 1, board: 0.6, rise: 1, rays: 0.7, normals: 1, arc: 1, grad: 1, dot: 1 }, 'close'),
      def(3, '压向底面：投影压缩',
        '沿竖直光线把斜面微元压平到影子上：dx dy = dS · cos γ。影子永远比斜面小，倾斜得越厉害，压得越狠。',
        9, { colorMix: 1, separate: 1, board: 0.6, rise: 1, rays: 1, normals: 1, arc: 1, dot: 1, press: 1, shadowHi: 1 }, 'close'),
      def(3, '反向还原：根号从哪来',
        '反过来把影子除以 cos γ 推回斜面：dS = dx dy / cos γ = √(1 + z_x² + z_y²) dx dy。这个根号，就是曲面比影子“大出来”的部分。',
        12, { colorMix: 1, separate: 1, board: 0.6, rise: 1, rays: 1, normals: 1, arc: 0.5, dot: 1, press: 0, shadowHi: 0.6 }, 'close'),
      def(3, '把每块碎片写到底面上',
        '曲面上每块碎片的质量改写成底面网格上的量：ΔMᵢ = ρ · √(1 + z_x² + z_y²) · ΔxᵢΔyᵢ。求和对象从曲面碎片，变成了底面小方格。',
        10, { colorMix: 1, separate: 1, board: 0.95, rise: 1, rays: 0.7, normals: 1, arc: 1, dot: 1 }, 'overview'),
      def(3, '碎片汇入 D_xy',
        '所有碎片连续下落、拍平，逐块飞入底部投影区域 D_xy；总质量计数器同步从 0 实时滚跳累加到 M。',
        10, { colorMix: 1, separate: 1, board: 0.95, fall: 1, counter: 1 }, 'overview'),
      def(3, '闭环：二重积分就是曲面总质量',
        'N 越密，底面上的和越稳定地逼近二重积分。“曲面碎片逐块称重”与“底面二重积分求和”，是同一件事的两种说法。',
        13, { colorMix: 1, separate: 1, board: 0.95, fall: 1, counter: 1 }, 'overview')
    );
  }

  /* ================== 相机 ================== */
  const CAM_OVERVIEW = { pos: [4.7, -6.5, 4.5], target: [0, 0, 0.7] };
  function closeGoal() {
    const p = state.pick, z0 = M.z(p.x, p.y);
    const dir = new THREE.Vector3(0.55, -1.0, 0.72).normalize().multiplyScalar(3.2);
    return {
      pos: [p.x + dir.x, p.y + dir.y, z0 + dir.z],
      target: [p.x, p.y, z0 + 0.2]
    };
  }
  function applyCamera(mode, instant) {
    const goal = mode === 'close' ? closeGoal() : CAM_OVERVIEW;
    const d = (instant || reduced.matches) ? 0 : 1.15 / state.speed;
    gsap.killTweensOf(main.camera.position);
    gsap.killTweensOf(main.controls.target);
    const set = () => main.controls.update();
    gsap.to(main.camera.position, { x: goal.pos[0], y: goal.pos[1], z: goal.pos[2], duration: d, ease: 'power2.inOut', onUpdate: set });
    gsap.to(main.controls.target, { x: goal.target[0], y: goal.target[1], z: goal.target[2], duration: d, ease: 'power2.inOut', onUpdate: set });
  }

  /* ================== 步骤切换 ================== */
  function goToStep(i, opts) {
    state.step = clamp(i, 0, STEPS.length - 1);
    const s = STEPS[state.step];
    state.stepClock = 0;
    state.capsule = s.capsule;

    const d = (opts && opts.instant ? 0 : 0.85) / state.speed;
    gsap.killTweensOf(P);
    gsap.to(P, Object.assign({}, s.set, {
      duration: reduced.matches ? 0 : d,
      ease: 'power2.inOut',
      onUpdate: updatePatchColors
    }));

    if (s.cam !== state.camMode || (opts && opts.forceCam)) {
      state.camMode = s.cam;
      applyCamera(s.cam, opts && opts.instant);
    }
    refreshUI();
    if (state.step === 3) playBalance();
  }

  function refreshUI() {
    const s = STEPS[state.step];
    $('log-step').textContent = `步骤 ${state.step + 1} / ${STEPS.length}`;
    $('log-title').textContent = s.title;
    $('log-note').textContent = s.note;

    document.querySelectorAll('.stage-pill').forEach(b => {
      const on = Number(b.dataset.capsule) === state.capsule;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    Array.from($('step-track').children).forEach((d, i) => {
      d.classList.toggle('is-active', i === state.step);
      d.classList.toggle('is-done', i < state.step);
    });
    document.querySelectorAll('.chain-part').forEach(p => {
      p.classList.toggle('is-active', Number(p.dataset.part) === state.capsule);
    });
    const badge = $('micro-badge');
    badge.textContent = state.capsule === 1 ? '镜头待命' : '显微镜 · 约 8× 放大';
    badge.classList.toggle('is-live', state.capsule !== 1);

    // 原位解说框 / 浮层：按步骤显隐
    document.querySelectorAll('[data-show]').forEach(el => {
      const on = el.dataset.show.split(',').map(Number).includes(state.step);
      if (on && el.hidden) {
        el.hidden = false;
        gsap.fromTo(el, { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: reduced.matches ? 0 : 0.45 / state.speed, ease: 'power2.out' });
      } else if (!on && !el.hidden) {
        gsap.killTweensOf(el);
        el.hidden = true;
      }
    });
    document.querySelectorAll('.callout .line').forEach(l =>
      l.classList.toggle('is-focus', Number(l.dataset.focus) === state.step));
    // 压平阶段动作发生在底板附近，解说框让位到顶部
    document.querySelectorAll('.callout').forEach(c =>
      c.classList.toggle('is-top', c.dataset.show === '7,8' && state.step === 7));

    $('prev').disabled = state.step === 0;
    $('next').disabled = state.step === STEPS.length - 1;
    updatePlayButton();
  }

  function updatePlayButton() {
    const atEnd = state.step === STEPS.length - 1;
    $('play').textContent = state.playing ? 'Ⅱ 暂停' : (atEnd && state.stepClock === 0 ? '↺ 重播' : '▶ 播放');
    $('play').setAttribute('aria-label', state.playing ? '暂停演示' : '播放演示');
  }

  function playBalance() {
    if (balanceTween) balanceTween.kill();
    const beam = document.querySelector('.balance-svg .beam-g');
    const chip = document.querySelector('.balance-svg .chip');
    if (!beam) return;
    const o = { a: -17 };
    balanceTween = gsap.to(o, {
      a: 0, duration: reduced.matches ? 0 : 1.6 / state.speed, ease: 'elastic.out(1,0.55)',
      onUpdate: () => beam.setAttribute('transform', `rotate(${o.a} 75 32)`)
    });
    gsap.fromTo(chip, { opacity: 0, y: -6 },
      { opacity: 1, y: 0, duration: reduced.matches ? 0 : 0.5 / state.speed, ease: 'power2.out' });
  }

  /* ================== 数字联动 ================== */
  function tweenNumber(el, target, digits) {
    const o = { v: parseFloat(el.textContent) || 0 };
    gsap.killTweensOf(o);
    gsap.to(o, {
      v: target, duration: reduced.matches ? 0 : 0.7, ease: 'power2.out',
      onUpdate: () => { el.textContent = fmt(o.v, digits); }
    });
  }

  function recompute() {
    state.sums = M.sums(state.n, state.rhoMode);
    state.exact = M.exact(state.rhoMode);
    tweenNumber($('meter-mass'), state.sums.mass, 4);
    tweenNumber($('meter-area'), state.sums.area, 4);
    $('mass-exact').textContent = fmt(state.exact.mass, 4);
    $('area-exact').textContent = fmt(state.exact.area, 4);
    $('mass-track').style.width = `${clamp(state.sums.mass / state.exact.mass) * 100}%`;
    $('area-track').style.width = `${clamp(state.sums.area / state.exact.area) * 100}%`;
    $('counter-unit').innerHTML = `g / ${fmt(state.exact.mass, 4)} g`;
    $('n-label').textContent = `N = ${state.n} · ${(state.n * state.n).toLocaleString('en-US')} 块`;
    updateLegend();
    updatePickStats();
    syncMicroNumbers();
  }

  function updateLegend() {
    const scale = $('color-scale');
    if (state.rhoMode === 'uniform') {
      scale.style.background = '#E1A244';
      $('tick-min').textContent = '';
      $('tick-mid').textContent = 'ρ ≡ 1';
      $('tick-max').textContent = '';
    } else {
      scale.style.background = 'linear-gradient(90deg,#FAF3E6,#E1A244,#8C4A14)';
      $('tick-min').textContent = '0.8';
      $('tick-mid').textContent = '2.2';
      $('tick-max').textContent = '3.6';
    }
  }

  function updatePickStats() {
    const { i, j } = state.pickCell;
    const a = M.cellArea(state.n, i, j);
    const [cx, cy] = M.cellCenter(state.n, i, j);
    const r = M.rho(cx, cy, state.rhoMode);
    $('balance-nums').textContent =
      `ΔSᵢ = ${fmt(a, 4)} cm² · ρᵢ = ${fmt(r, 3)} g/cm² · ΔMᵢ = ${fmt(a * r, 4)} g`;
  }

  function syncMicroNumbers() {
    const p = state.pick;
    const nx = -M.zx(p.x, p.y), ny = -M.zy(p.x, p.y);
    const len = Math.hypot(nx, ny, 1);
    const cos = 1 / len;
    const gamma = Math.acos(clamp(cos, -1, 1)) * 180 / Math.PI;
    const dot = $('dot-nums');
    if (dot) dot.textContent = `n = (${nx.toFixed(3)}, ${ny.toFixed(3)}, 1)，n·k = 1，|n| = ${len.toFixed(4)}`;
    const foot = $('micro-nums');
    if (foot) foot.textContent =
      `γ = ${gamma.toFixed(1)}° · cos γ = ${cos.toFixed(3)} · 1/cos γ = ${(1 / cos).toFixed(3)}`;
    const press = $('press-nums');
    if (press) {
      const flat = (2 * MICRO_HH) ** 2;
      press.textContent = `dS = ${(flat / cos).toFixed(4)} cm² · dx dy = ${flat.toFixed(4)} cm² · ` +
        `dx dy / dS = ${cos.toFixed(3)} = cos γ`;
    }
    if (labelsMicro[0]) labelsMicro[0].el.textContent = `n = (${nx.toFixed(2)}, ${ny.toFixed(2)}, 1)`;
    updatePickStats();
  }

  /* ================== 每帧同步 ================== */
  const UP = new THREE.Vector3(0, 1, 0);
  function sync() {
    const u = main.material.uniforms;
    u.uColorMix.value = P.colorMix;
    u.uSep.value = P.separate;
    u.uFall.value = P.fall;
    u.uLift.value = P.pickLift;
    u.uPick.value = state.pickId;
    u.uTime.value = performance.now() / 1000;

    main.boardTint.material.opacity = P.board * 0.92;

    const showMark = (P.separate > 0.02 || P.pickLift > 0.02) && P.fall < 0.9;
    pickMarker.outline.visible = showMark;
    pickMarker.outline.material.opacity = clamp(P.separate * 0.9 + P.pickLift);
    pickDrop.visible = P.separate > 0.05 && P.fall < 0.6;
    pickDrop.material.opacity = clamp(P.separate * 0.85) * (1 - P.fall);

    labelsMain[2].visible = (P.separate > 0.2 || P.pickLift > 0.2) && P.fall < 0.5;
    labelsMain[2].pos.set(state.pick.x, state.pick.y,
      M.z(state.pick.x, state.pick.y) + 0.66 + P.pickLift * 0.3);

    $('counter-value').textContent = fmt(state.sums.mass * P.counter, 4);
    $('counter-fill').style.width = `${P.counter * 100}%`;

    syncMicro();
  }

  function syncMicro() {
    if (!micro.patchGroup) return;
    const press = P.press, Hc = micro.Hc;
    micro.patchGroup.position.z = lerp(Hc, 0.03, press);
    micro.patchGroup.scale.z = 1 - 0.97 * press;

    // 竖直光线：微元四角 → 影子四角
    const arr = micro.rays.geometry.attributes.position.array;
    const top = micro.patchGroup.position.z, scaleZ = micro.patchGroup.scale.z, hh = MICRO_HH;
    [[-hh, -hh], [hh, -hh], [hh, hh], [-hh, hh]].forEach(([cx, cy], k) => {
      const h = M.z(state.pick.x + cx, state.pick.y + cy) - M.z(state.pick.x, state.pick.y);
      arr.set([cx, cy, top + h * scaleZ, cx, cy, 0.018], k * 6);
    });
    micro.rays.geometry.attributes.position.needsUpdate = true;
    micro.rays.computeLineDistances();
    micro.rays.material.opacity = P.rays * (0.42 + 0.55 * press);
    micro.rays.visible = P.rays > 0.02;

    // 斜面法向量在压平时退化为竖直方向
    const nRaw = M.unitNormal(state.pick.x, state.pick.y);
    const nDir = new THREE.Vector3(
      lerp(nRaw[0], 0, press), lerp(nRaw[1], 0, press), lerp(nRaw[2], 1, press)).normalize();
    const centerZ = micro.patchGroup.position.z;

    micro.nArrow.visible = P.normals > 0.02;
    micro.nArrow.position.set(0, 0, centerZ);
    micro.nArrow.quaternion.setFromUnitVectors(UP, nDir);
    micro.nArrow.setLength(lerp(0.5, 1.05, P.normals));
    micro.nArrow.userData.mat.opacity = P.normals;

    micro.kArrow.visible = P.normals > 0.02;
    micro.kArrow.setLength(lerp(0.45, 0.95, P.normals));
    micro.kArrow.userData.mat.opacity = P.normals;

    micro.kGhost.visible = P.normals > 0.02 && P.arc > 0.02 && press < 0.4;
    micro.kGhost.position.set(0, 0, centerZ);
    micro.kGhost.setLength(lerp(0.45, 0.95, Math.min(P.arc, P.normals)));
    micro.kGhost.userData.mat.opacity = P.normals * (1 - press) * 0.85;

    // 夹角圆弧（在 k 与 n 张成的平面内展开）
    const gamma = Math.acos(clamp(nDir.z, -1, 1));
    const nIn = new THREE.Vector3(nDir.x, nDir.y, 0);
    if (nIn.lengthSq() < 1e-8) nIn.set(1, 0, 0);
    nIn.normalize();
    const arcArr = micro.arc.geometry.attributes.position.array;
    const NPT = 64, reveal = clamp(P.arc);
    for (let i = 0; i < NPT; i++) {
      const a = gamma * (i / (NPT - 1)) * reveal;
      arcArr[i * 3] = 0.55 * Math.sin(a) * nIn.x;
      arcArr[i * 3 + 1] = 0.55 * Math.sin(a) * nIn.y;
      arcArr[i * 3 + 2] = 0.55 * Math.cos(a);
    }
    micro.arc.geometry.attributes.position.needsUpdate = true;
    micro.arc.position.set(0, 0, centerZ);
    micro.arc.visible = P.arc > 0.02 && gamma > 0.02;
    micro.arc.material.opacity = 1;

    // 隐函数梯度的两个分量
    const zx = M.zx(state.pick.x, state.pick.y), zy = M.zy(state.pick.x, state.pick.y);
    micro.gx.visible = micro.gy.visible = P.grad > 0.02;
    micro.gx.position.set(0, 0, centerZ + 0.07);
    micro.gy.position.set(0, 0, centerZ + 0.07);
    micro.gx.quaternion.setFromUnitVectors(UP, new THREE.Vector3(Math.sign(zx) || 1, 0, 0));
    micro.gy.quaternion.setFromUnitVectors(UP, new THREE.Vector3(0, Math.sign(zy) || 1, 0));
    const glx = Math.max(0.26, Math.abs(zx) * 0.78) * P.grad;
    const gly = Math.max(0.26, Math.abs(zy) * 0.78) * P.grad;
    micro.gx.setLength(glx);
    micro.gy.setLength(gly);
    micro.gx.userData.mat.opacity = P.grad;
    micro.gy.userData.mat.opacity = P.grad;

    // 影子高亮
    micro.shadow.material.color.copy(srgb('#93A3B8')).lerp(srgb('#4C74A8'), P.shadowHi);
    micro.shadow.material.opacity = 0.55 + 0.32 * P.shadowHi;
    micro.shadowEdge.material.opacity = clamp(0.5 + P.shadowHi);
    micro.shadowEdge.material.transparent = true;

    // 显微台标签锚点
    const center = new THREE.Vector3(0, 0, centerZ);
    labelsMicro[0].pos.copy(center).addScaledVector(nDir, 1.44);
    labelsMicro[1].pos.set(0.36, -0.05, 0.56);
    const mid = gamma * 0.5 * clamp(P.arc);
    labelsMicro[2].pos.set(
      0.72 * Math.sin(mid) * nIn.x, 0.72 * Math.sin(mid) * nIn.y,
      centerZ + 0.72 * Math.cos(mid));
    labelsMicro[3].pos.set(-0.46, 0.1, centerZ - 0.06);
    labelsMicro[4].pos.set(0.5, -0.08, 0.14);
    labelsMicro[5].pos.set((Math.sign(zx) || 1) * (glx + 0.26), 0, centerZ + 0.2);
    labelsMicro[6].pos.set(0, (Math.sign(zy) || 1) * (gly + 0.26), centerZ + 0.2);
    labelsMicro[7].pos.set(-0.26, 0.12, centerZ + 1.14);

    labelsMicro[0].visible = P.normals > 0.35;
    labelsMicro[1].visible = P.normals > 0.35;
    labelsMicro[2].visible = P.arc > 0.45;
    labelsMicro[3].visible = P.rise > 0.3;
    labelsMicro[4].visible = P.rise > 0.3;
    labelsMicro[5].visible = labelsMicro[6].visible = P.grad > 0.5;
    labelsMicro[7].visible = P.arc > 0.5 && press < 0.35;
  }

  function projectLabels(list, camera, w, h) {
    for (const item of list) {
      if (!item.visible) { item.el.hidden = true; continue; }
      const p = item.pos.clone().project(camera);
      item.el.hidden = p.z > 1;
      item.el.style.left = `${(p.x * 0.5 + 0.5) * w}px`;
      item.el.style.top = `${(-p.y * 0.5 + 0.5) * h}px`;
    }
  }

  /* ================== 拾取（解析求交，避免对 6 万三角形做射线检测） ================== */
  const raycaster = new THREE.Raycaster();
  const hitPoint = new THREE.Vector3();
  function pickSurface(clientX, clientY, rect) {
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, main.camera);
    const ray = raycaster.ray;
    let prevT = 0, prevG = null;
    for (let t = 0.25; t <= 45; t += 0.05) {
      const p = ray.at(t, hitPoint);
      if (Math.abs(p.x) > 2.3 || Math.abs(p.y) > 2.3) { prevG = null; continue; }
      const g = p.z - M.z(p.x, p.y);
      if (prevG !== null && prevG > 0 && g <= 0) {
        let lo = prevT, hi = t;
        for (let k = 0; k < 26; k++) {
          const mid = (lo + hi) / 2;
          const q = ray.at(mid, hitPoint);
          if (q.z - M.z(q.x, q.y) > 0) lo = mid; else hi = mid;
        }
        const f = ray.at((lo + hi) / 2, hitPoint);
        if (Math.abs(f.x) <= 2 && Math.abs(f.y) <= 2) return { x: f.x, y: f.y };
        return null;
      }
      prevT = t; prevG = g;
    }
    return null;
  }

  /* ================== 场景搭建 ================== */
  function setupMain() {
    main.scene = new THREE.Scene();
    main.scene.background = new THREE.Color('#ECEEE9');
    main.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 140);
    main.camera.up.set(0, 0, 1);
    main.camera.position.set(CAM_OVERVIEW.pos[0], CAM_OVERVIEW.pos[1], CAM_OVERVIEW.pos[2]);
    main.renderer = new THREE.WebGLRenderer({ antialias: true });
    main.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    main.renderer.outputEncoding = THREE.sRGBEncoding;
    $('scene').prepend(main.renderer.domElement);

    main.controls = new THREE.OrbitControls(main.camera, main.renderer.domElement);
    main.controls.target.set(CAM_OVERVIEW.target[0], CAM_OVERVIEW.target[1], CAM_OVERVIEW.target[2]);
    main.controls.enableDamping = true;
    main.controls.dampingFactor = 0.08;
    main.controls.enablePan = false;
    main.controls.minDistance = 2.4;
    main.controls.maxDistance = 16;
    main.controls.minPolarAngle = 0.08;
    main.controls.maxPolarAngle = Math.PI - 0.1;

    main.material = new THREE.ShaderMaterial({
      uniforms: {
        uSep: { value: 0 }, uColorMix: { value: 0 }, uPick: { value: 0 },
        uLift: { value: 0 }, uFall: { value: 0 }, uTime: { value: 0 }
      },
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      side: THREE.DoubleSide,
      extensions: { derivatives: true }
    });

    buildBoard();
    buildPickMarker();
    buildSurface(state.n);
    buildLabels();
  }

  function setupMicro() {
    micro.scene = new THREE.Scene();
    micro.scene.background = new THREE.Color('#F3F1EA');
    micro.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
    micro.camera.up.set(0, 0, 1);
    micro.renderer = new THREE.WebGLRenderer({ antialias: true });
    micro.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    micro.renderer.outputEncoding = THREE.sRGBEncoding;
    $('micro-scene').prepend(micro.renderer.domElement);

    micro.controls = new THREE.OrbitControls(micro.camera, micro.renderer.domElement);
    micro.controls.enableDamping = true;
    micro.controls.dampingFactor = 0.09;
    micro.controls.enablePan = false;
    micro.controls.minDistance = 1.7;
    micro.controls.maxDistance = 8;
    micro.controls.minPolarAngle = 0.15;
    micro.controls.maxPolarAngle = Math.PI - 0.15;
    micro.controls.autoRotate = !reduced.matches;
    micro.controls.autoRotateSpeed = 0.15;

    const cam = microCamGoal();
    micro.camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    micro.controls.target.set(cam.target[0], cam.target[1], cam.target[2]);
    micro.controls.update();

    micro.scene.add(new THREE.AmbientLight('#ffffff', 0.8));
    const light = new THREE.DirectionalLight('#ffffff', 0.62);
    light.position.set(-2.2, -2.8, 4.5);
    micro.scene.add(light);
    buildMicro();
  }

  function resize() {
    const w = $('scene').clientWidth, h = $('scene').clientHeight;
    if (w && h) {
      main.camera.aspect = w / h;
      main.camera.updateProjectionMatrix();
      main.renderer.setSize(w, h);
    }
    const mw = $('micro-scene').clientWidth, mh = $('micro-scene').clientHeight;
    if (mw && mh) {
      micro.camera.aspect = mw / mh;
      micro.camera.updateProjectionMatrix();
      micro.renderer.setSize(mw, mh);
    }
  }

  /* ================== 交互绑定 ================== */
  function setN(index) {
    const n = N_STOPS[clamp(index, 0, N_STOPS.length - 1)];
    if (n === state.n) return;
    state.n = n;
    $('n-label').textContent = `N = ${n} · ${(n * n).toLocaleString('en-US')} 块`;
    clearTimeout(setN.timer);
    setN.timer = setTimeout(() => {
      buildSurface(state.n);
      rebuildMicro();
      recompute();
    }, n > 64 ? 130 : 0);
  }

  function setRhoMode(mode) {
    if (mode === state.rhoMode) return;
    state.rhoMode = mode;
    document.querySelectorAll('[data-rho]').forEach(b => {
      const on = b.dataset.rho === mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    refreshSurfaceColors();
    refreshTint();
    updatePatchColors();
    recompute();
  }

  function togglePlay() {
    if (state.playing) { state.playing = false; updatePlayButton(); return; }
    if (state.step === STEPS.length - 1) goToStep(0);
    state.playing = true;
    state.stepClock = 0;
    updatePlayButton();
  }

  function bind() {
    document.querySelectorAll('.stage-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = Number(btn.dataset.capsule);
        const idx = STEPS.findIndex(s => s.capsule === c);
        state.playing = false;
        goToStep(idx < 0 ? 0 : idx);
      });
    });
    $('n-slider').addEventListener('input', e => setN(Number(e.target.value)));
    document.querySelectorAll('[data-rho]').forEach(b =>
      b.addEventListener('click', () => setRhoMode(b.dataset.rho)));
    $('play').addEventListener('click', togglePlay);
    $('prev').addEventListener('click', () => { state.playing = false; goToStep(state.step - 1); });
    $('next').addEventListener('click', () => { state.playing = false; goToStep(state.step + 1); });
    $('restart').addEventListener('click', () => { state.playing = false; goToStep(0); });
    $('speed').addEventListener('change', e => { state.speed = Number(e.target.value); });

    document.addEventListener('keydown', e => {
      if (e.target.closest('button, input, select, a, textarea')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowRight') { e.preventDefault(); state.playing = false; goToStep(state.step + 1); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); state.playing = false; goToStep(state.step - 1); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.playing) { state.playing = false; updatePlayButton(); }
    });

    // 悬停探针 + 点击换微元
    const sceneEl = $('scene'), probe = $('probe');
    let downAt = null;
    sceneEl.addEventListener('pointermove', e => {
      const rect = sceneEl.getBoundingClientRect();
      const hit = P.fall < 0.5 ? pickSurface(e.clientX, e.clientY, rect) : null;
      if (!hit) { probe.hidden = true; return; }
      const z = M.z(hit.x, hit.y), r = M.rho(hit.x, hit.y, state.rhoMode);
      probe.hidden = false;
      probe.innerHTML = `<b>当前位置 (${hit.x.toFixed(2)}, ${hit.y.toFixed(2)}, ${z.toFixed(2)})</b>` +
        `<strong>面密度 ρ = ${r.toFixed(3)} g/cm²</strong>`;
      const lx = e.clientX - rect.left, ly = e.clientY - rect.top;
      probe.style.left = `${lx}px`;
      probe.style.top = `${ly}px`;
      probe.style.transform = lx > rect.width - 215 ? 'translate(calc(-100% - 16px), -50%)' : 'translate(14px, -50%)';
    });
    sceneEl.addEventListener('pointerleave', () => { probe.hidden = true; });
    sceneEl.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY }; });
    sceneEl.addEventListener('pointerup', e => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > 6 || P.fall >= 0.5) return;
      const hit = pickSurface(e.clientX, e.clientY, sceneEl.getBoundingClientRect());
      if (!hit) return;
      state.pick = hit;
      updatePickId();
      rebuildMicro();
      updatePickStats();
      if (STEPS[state.step].cam === 'close') applyCamera('close', true);
    });

    // 显微台：悬停时暂停自转
    const microEl = $('micro-scene');
    microEl.addEventListener('pointerenter', () => { micro.controls.autoRotate = false; });
    microEl.addEventListener('pointerleave', () => { micro.controls.autoRotate = !reduced.matches; });

    new ResizeObserver(resize).observe($('scene'));
    new ResizeObserver(resize).observe($('micro-scene'));
    window.addEventListener('resize', resize);
  }

  /* ================== 主循环 ================== */
  function animate(now) {
    const dt = Math.min(0.06, (now - (animate.last || now)) / 1000);
    animate.last = now;

    if (state.playing) {
      state.stepClock += dt * state.speed;
      if (state.stepClock >= STEPS[state.step].hold) {
        if (state.step < STEPS.length - 1) goToStep(state.step + 1);
        else { state.playing = false; updatePlayButton(); }
      }
    }

    sync();
    main.controls.update();
    micro.controls.update();

    const w = $('scene').clientWidth, h = $('scene').clientHeight;
    const mw = $('micro-scene').clientWidth, mh = $('micro-scene').clientHeight;
    projectLabels(labelsMain, main.camera, w, h);
    projectLabels(labelsMicro, micro.camera, mw, mh);

    main.renderer.render(main.scene, main.camera);
    micro.renderer.render(micro.scene, micro.camera);
    requestAnimationFrame(animate);
  }

  /* ================== 公式渲染 ================== */
  function renderMath() {
    if (!window.katex) return;
    document.querySelectorAll('[data-tex]').forEach(el => {
      try {
        window.katex.render(el.dataset.tex, el, {
          displayMode: el.dataset.display === '1',
          throwOnError: false, strict: false
        });
      } catch (err) { console.warn(err); }
    });
  }

  /* ================== 启动 ================== */
  try {
    if (!window.THREE || !THREE.OrbitControls) throw new Error('RES');
    fillSteps();
    const qn = /(?:^|[?&])n=(\d+)/.exec(location.search);
    if (qn) {
      const idx = N_STOPS.indexOf(Number(qn[1]));
      if (idx >= 0) { state.n = N_STOPS[idx]; $('n-slider').value = String(idx); }
    }
    setupMain();
    setupMicro();
    buildStepTrack();
    recompute();
    bind();
    resize();
    renderMath();
    const jump = /#s(\d+)/.exec(location.hash);
    goToStep(jump ? clamp(Number(jump[1]) - 1, 0, STEPS.length - 1) : 0, { instant: true });
    refreshTint();
    requestAnimationFrame(animate);
  } catch (error) {
    console.error(error);
    const box = $('scene-error');
    box.hidden = false;
    box.textContent = error.message === 'RES'
      ? '三维资源未能加载，请检查网络连接后刷新页面。'
      : '无法创建三维画面，请使用支持 WebGL 的浏览器并开启图形加速后刷新。';
    document.querySelectorAll('button, input, select').forEach(el => { el.disabled = true; });
  }
})();
