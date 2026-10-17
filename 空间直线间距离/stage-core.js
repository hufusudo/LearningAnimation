/**
 * 三维舞台的通用构件（three.js r128）：材质、棒、箭头、虚线、点、标签、外环、四边形、直角标记。
 * 每个对象各自持有材质，才能单独改透明度（灰化），不会牵连其他对象。
 */
const Core = (() => {
  const Y = new THREE.Vector3(0, 1, 0);
  const _d = new THREE.Vector3();

  const mat = {
    std: (color, op = 1) => new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.04, transparent: true, opacity: op }),
    basic: (color, op = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide }),
    line: (color, op = 1) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: op }),
    dash: (color, op = 1) => new THREE.LineDashedMaterial({ color, dashSize: 0.13, gapSize: 0.09, transparent: true, opacity: op })
  };

  // 圆柱棒：端点 a → b，可按比例生长
  function rod(color, radius, op = 1) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), mat.std(color, op));
    m.userData.r = radius;
    m.visible = false;
    return m;
  }
  function setRod(m, a, b, g = 1, op = 1) {
    _d.set(b.x - a.x, b.y - a.y, b.z - a.z).multiplyScalar(g);
    const L = _d.length();
    m.visible = g > 1e-3 && L > 1e-4 && op > 1e-3;
    if (!m.visible) return;
    m.position.set(a.x, a.y, a.z).addScaledVector(_d, 0.5);
    m.quaternion.setFromUnitVectors(Y, _d.clone().normalize());
    m.scale.set(m.userData.r, L, m.userData.r);
    m.material.opacity = op;
  }

  // 箭头：轴 + 锥头，origin 为尾，dir 为单位方向，length 为完整长度
  function arrow(color) {
    const g = new THREE.Group();
    const shaft = rod(color, 0.04);
    const head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 16).translate(0, 0.5, 0), mat.std(color));
    head.visible = false;
    g.add(shaft, head);
    g.userData = { shaft, head };
    g.visible = false;
    return g;
  }
  function setArrow(g, origin, dir, length, progress, op = 1) {
    const L = length * progress;
    g.visible = progress > 1e-3 && L > 1e-3 && op > 1e-3;
    if (!g.visible) return;
    const headL = Math.min(0.3, L * 0.3), headR = headL * 0.4;
    const shaftEnd = origin.clone().addScaledVector(dir, Math.max(L - headL, 1e-4));
    setRod(g.userData.shaft, origin, shaftEnd, 1, op);
    const head = g.userData.head;
    head.visible = true;
    head.position.copy(shaftEnd);
    head.quaternion.setFromUnitVectors(Y, dir);
    head.scale.set(headR, headL, headR);
    head.material.opacity = op;
  }

  // 虚线段
  function dash(color, op = 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1], 3));
    const l = new THREE.Line(geo, mat.dash(color, op));
    l.frustumCulled = false;
    l.visible = false;
    return l;
  }
  function setDash(l, a, b, op = 1) {
    const p = l.geometry.attributes.position;
    p.setXYZ(0, a.x, a.y, a.z);
    p.setXYZ(1, b.x, b.y, b.z);
    p.needsUpdate = true;
    l.geometry.computeBoundingSphere();
    l.computeLineDistances();
    l.material.opacity = op;
    l.visible = op > 1e-3 && a.distanceTo(b) > 1e-4;
  }

  // 点（球）
  function dot(color, r) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 22), mat.std(color));
    m.visible = false;
    return m;
  }
  function setDot(m, p, s = 1, op = 1) {
    m.visible = s > 1e-3 && op > 1e-3;
    if (!m.visible) return;
    m.position.copy(p);
    m.scale.setScalar(s);
    m.material.opacity = op;
  }

  // 标签：sym 为衬线斜体（字母），eq 为等宽（公式与数值）。纸色描边代替底框
  function label(kind, color) {
    const canvas = document.createElement('canvas');
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.renderOrder = 999;
    sp.visible = false;
    sp.userData = { canvas, tex, kind, color, text: null };
    return sp;
  }
  function setLabel(sp, text, color) {
    const u = sp.userData;
    color = color || u.color;
    if (u.text === text && u.color === color) return;
    u.text = text;
    u.color = color;
    const fs = u.kind === 'eq' ? 26 : 34;
    const font = u.kind === 'eq'
      ? `500 ${fs}px "JetBrains Mono", ui-monospace, monospace`
      : `italic 600 ${fs}px Georgia, "Times New Roman", serif`;
    const ctx = u.canvas.getContext('2d');
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 18, h = fs + 16;
    u.canvas.width = w;
    u.canvas.height = h;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(250, 249, 245, 0.96)';
    ctx.strokeText(text, w / 2, h / 2 + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2 + 1);
    u.tex.needsUpdate = true;
    const worldH = u.kind === 'eq' ? 0.25 : 0.33;
    sp.scale.set(worldH * w / h, worldH, 1);
  }
  function fadeLabel(sp, a, p) {
    sp.visible = a > 1e-3;
    sp.material.opacity = a;
    if (p) sp.position.copy(p);
  }

  // 焦点外环（墨色细环），只改位置、缩放与透明度
  function halo() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    x.lineWidth = 7;
    x.strokeStyle = '#343C38';
    x.beginPath();
    x.arc(64, 64, 52, 0, Math.PI * 2);
    x.stroke();
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false }));
    sp.renderOrder = 998;
    sp.visible = false;
    return sp;
  }
  function setHalo(sp, p, q) {
    sp.visible = q > 1e-3;
    if (!sp.visible) return;
    sp.position.copy(p);
    sp.material.opacity = 0.8 * q;
    sp.scale.setScalar(0.36 + 0.1 * q);
  }

  // 平行四边形（两个三角形）：中心 c，基 e1、e2，半边 a、b
  function quad(color, op = 1) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(18).fill(0), 3));
    const m = new THREE.Mesh(g, mat.basic(color, op));
    m.frustumCulled = false;
    m.visible = false;
    return m;
  }
  function setQuad(m, c, e1, e2, a, b, op = 1) {
    const p = [
      c.clone().addScaledVector(e1, -a).addScaledVector(e2, -b),
      c.clone().addScaledVector(e1, a).addScaledVector(e2, -b),
      c.clone().addScaledVector(e1, a).addScaledVector(e2, b),
      c.clone().addScaledVector(e1, -a).addScaledVector(e2, b)
    ];
    const arr = m.geometry.attributes.position.array;
    [0, 1, 2, 0, 2, 3].forEach((idx, k) => {
      arr[k * 3] = p[idx].x;
      arr[k * 3 + 1] = p[idx].y;
      arr[k * 3 + 2] = p[idx].z;
    });
    m.geometry.attributes.position.needsUpdate = true;
    m.geometry.computeBoundingSphere();
    m.material.opacity = op;
    m.visible = op > 1e-3;
  }
  // 平行四边形边框
  function outline(color, op = 1) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(15).fill(0), 3));
    const l = new THREE.Line(g, mat.line(color, op));
    l.frustumCulled = false;
    l.visible = false;
    return l;
  }
  function setOutline(l, c, e1, e2, a, b, op = 1) {
    const pts = [
      c.clone().addScaledVector(e1, -a).addScaledVector(e2, -b),
      c.clone().addScaledVector(e1, a).addScaledVector(e2, -b),
      c.clone().addScaledVector(e1, a).addScaledVector(e2, b),
      c.clone().addScaledVector(e1, -a).addScaledVector(e2, b),
      c.clone().addScaledVector(e1, -a).addScaledVector(e2, -b)
    ];
    const p = l.geometry.attributes.position;
    pts.forEach((q, i) => p.setXYZ(i, q.x, q.y, q.z));
    p.needsUpdate = true;
    l.geometry.computeBoundingSphere();
    l.material.opacity = op;
    l.visible = op > 1e-3;
  }

  // 直角标记：顶点 v，两条单位方向 d1、d2，边长 s
  function right(color, op = 1) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
    const l = new THREE.Line(g, mat.line(color, op));
    l.frustumCulled = false;
    l.visible = false;
    return l;
  }
  function setRight(l, v, d1, d2, s, op = 1) {
    l.visible = op > 1e-3 && !!d1 && !!d2;
    if (!l.visible) return;
    const A = v.clone().addScaledVector(d1, s);
    const B = A.clone().addScaledVector(d2, s);
    const C = v.clone().addScaledVector(d2, s);
    const p = l.geometry.attributes.position;
    p.setXYZ(0, A.x, A.y, A.z);
    p.setXYZ(1, B.x, B.y, B.z);
    p.setXYZ(2, C.x, C.y, C.z);
    p.needsUpdate = true;
    l.geometry.computeBoundingSphere();
    l.material.opacity = op;
  }

  return { mat, rod, setRod, arrow, setArrow, dash, setDash, dot, setDot, label, setLabel, fadeLabel, halo, setHalo, quad, setQuad, outline, setOutline, right, setRight };
})();
