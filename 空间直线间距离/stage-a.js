/**
 * 模块 A 的三维构件与按帧渲染：两条直线、锚点与手柄、s₁ s₂、公法向 n、A B 与投影段、公垂线，
 * 以及静态理解方式（公垂线、六面体、平面法）。几何来自 model.js 的 frameA，节奏来自 choreo.js 的 viewA。
 */
const StageA = (() => {
  const HALF = 5, TIP = 1.65, NTIP = 1.7;
  const COL = {
    L1: 0x2563EB, L2: 0xB5546B, P1: 0x1D4ED8, P2: 0x8E2F4C,
    n: 0xBF8C32, d: 0xB42318, proj: 0x399B7B, ink: 0x343C38, drop: 0x6B7066,
    plane: 0x5B7C78, box: 0x5B7C78
  };
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const G = {};

  function build(scene) {
    G.root = new THREE.Group();
    scene.add(G.root);
    const add = (o) => { G.root.add(o); return o; };

    G.rod1 = add(Core.rod(COL.L1, 0.024));
    G.rod2 = add(Core.rod(COL.L2, 0.024));
    G.P1 = add(Core.dot(COL.P1, 0.12));
    G.P2 = add(Core.dot(COL.P2, 0.12));
    G.D1 = add(Core.dot(COL.ink, 0.06));
    G.D2 = add(Core.dot(COL.ink, 0.06));
    G.s1 = add(Core.arrow(0x1E40AF));   // 方向向量比直线更深，便于区分
    G.s2 = add(Core.arrow(0x7A2A44));
    G.n = add(Core.arrow(COL.n));
    G.rn1 = add(Core.right(COL.n));
    G.rn2 = add(Core.right(COL.n));
    G.A = add(Core.dot(COL.P1, 0.11));
    G.B = add(Core.dot(COL.P2, 0.11));
    G.AB = add(Core.rod(COL.d, 0.03));
    G.AF = add(Core.arrow(COL.proj));
    G.BF = add(Core.dash(COL.drop));
    G.CPd = add(Core.dash(COL.d));
    G.CPs = add(Core.rod(COL.d, 0.03));
    G.Q1 = add(Core.dot(COL.ink, 0.065));
    G.Q2 = add(Core.dot(COL.ink, 0.065));
    G.rf1 = add(Core.right(COL.ink));
    G.rf2 = add(Core.right(COL.ink));
    G.planeA = add(Core.quad(COL.plane, 0));
    G.planeAO = add(Core.outline(COL.plane, 0));
    G.planeDash = add(Core.dash(COL.drop));
    G.planeRight = add(Core.right(COL.ink));
    G.boxEdges = add(new THREE.LineSegments(new THREE.BufferGeometry(), Core.mat.line(COL.ink, 0.7)));
    G.boxFaces = add(new THREE.Mesh(new THREE.BufferGeometry(), Core.mat.basic(COL.box, 0.12)));
    G.boxBase = add(Core.quad(COL.box, 0.22));
    G.boxEdges.frustumCulled = false;
    G.boxFaces.frustumCulled = false;
    G.boxEdges.visible = G.boxFaces.visible = false;

    const halo = () => add(Core.halo());
    G.hP1 = halo(); G.hP2 = halo(); G.hD1 = halo(); G.hD2 = halo();
    G.hA = halo(); G.hB = halo(); G.hN = halo(); G.hQ1 = halo(); G.hQ2 = halo();

    const lab = (kind, color) => add(Core.label(kind, color));
    G.lP1 = lab('sym', '#1D4ED8'); G.lP2 = lab('sym', '#8E2F4C');
    G.lS1 = lab('sym', '#1D4ED8'); G.lS2 = lab('sym', '#8E2F4C');
    G.lN = lab('sym', '#8F6619');
    G.lA = lab('sym', '#1D4ED8'); G.lB = lab('sym', '#8E2F4C');
    G.lD = lab('eq', '#B42318');
    G.lAB = lab('eq', '#B42318');
    G.lBox = lab('eq', '#343C38');
    G.lPlane = lab('eq', '#343C38');
  }

  // 静态构件的端点
  const at = (p, dx = 0, dy = 0, dz = 0) => p.clone().add(new THREE.Vector3(dx, dy, dz));

  function setBox(o, u, v, w, op) {
    const c = [];
    for (let i = 0; i < 8; i++) {
      c.push(o.clone().addScaledVector(u, i & 1).addScaledVector(v, (i >> 1) & 1).addScaledVector(w, (i >> 2) & 1));
    }
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const F = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
    const ep = [];
    E.forEach(([i, j]) => ep.push(c[i].x, c[i].y, c[i].z, c[j].x, c[j].y, c[j].z));
    G.boxEdges.geometry.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    const fp = [];
    F.forEach(([a, b, cc, d]) => [[a, b, cc], [a, cc, d]].forEach(t => t.forEach(k => fp.push(c[k].x, c[k].y, c[k].z))));
    G.boxFaces.geometry.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    G.boxEdges.visible = G.boxFaces.visible = op > 1e-3;
    G.boxEdges.material.opacity = 0.7 * op;
    G.boxFaces.material.opacity = 0.12 * op;
    Core.setQuad(G.boxBase, o.clone().addScaledVector(u, 0.5).addScaledVector(v, 0.5), u, v, 0.5, 0.5, 0.22 * op);
    G.boxBase.visible = op > 1e-3;
  }

  // 按帧渲染：lines 为 {P1,d1,P2,d2}，f 为 frameA，v 为 viewA，opts 含 mode 与 layers
  function apply(lines, f, v, opts) {
    const mode = opts.mode, L = opts.layers;
    const vec = mode === 'vector';
    const sk = f.kind === 'skew' || f.kind === 'intersect';
    const par = f.kind === 'parallel';
    const P1 = V(lines.P1), d1 = V(lines.d1), P2 = V(lines.P2), d2 = V(lines.d2);
    const A = V(f.A), B = V(f.B), F = V(f.F), Q1 = V(f.Q1), Q2 = V(f.Q2);
    const n = f.n ? V(f.n) : new THREE.Vector3(0, 0, 1);
    const hasN = !!f.n;
    const AB = B.clone().sub(A);
    const cpVec = Q2.clone().sub(Q1);
    const cpLen = cpVec.length();
    const cpDir = cpLen > 1e-6 ? cpVec.clone().normalize() : null;
    const showStory = vec;

    // 直线与锚点、手柄
    Core.setRod(G.rod1, P1.clone().addScaledVector(d1, -HALF), P1.clone().addScaledVector(d1, HALF));
    Core.setRod(G.rod2, P2.clone().addScaledVector(d2, -HALF), P2.clone().addScaledVector(d2, HALF));
    Core.setDot(G.P1, P1, 1, 1);
    Core.setDot(G.P2, P2, 1, 1);
    const tip1 = P1.clone().addScaledVector(d1, TIP), tip2 = P2.clone().addScaledVector(d2, TIP);
    Core.setDot(G.D1, tip1, 1, 1);
    Core.setDot(G.D2, tip2, 1, 1);

    // 方向 s₁、s₂
    Core.setArrow(G.s1, P1, d1, TIP, showStory ? v.s1.g : 0, showStory ? v.s1.a : 0);
    Core.setArrow(G.s2, P2, d2, TIP, showStory ? v.s2.g : 0, showStory ? v.s2.a : 0);

    // 公法向 n：从公垂线的脚 Q₁ 出发；与两直线在 Q₁、Q₂ 处垂直（直角标记）
    const nOn = showStory && sk && hasN;
    Core.setArrow(G.n, Q1, n, NTIP, nOn ? v.n.g : 0, 1);
    const rnOp = nOn ? v.right.g * v.right.a : 0;
    Core.setRight(G.rn1, Q1, hasN ? n : null, d1, 0.22, rnOp);
    Core.setRight(G.rn2, Q2, hasN ? n : null, d2, 0.22, rnOp);

    // A、B 与投影链：AB 生长 → AF（沿 n 的投影段）→ BF（B 落到 F）
    const ptsOn = showStory && sk ? v.A.g : 0;
    Core.setDot(G.A, A, ptsOn, 1);
    Core.setDot(G.B, B, ptsOn, 1);
    const abOn = showStory && sk && L.aPoints;
    const abEnd = A.clone().addScaledVector(AB, showStory && sk ? v.AB.g : 0);
    Core.setRod(G.AB, A, abEnd, 1, abOn ? 1 : 0);
    const afVec = F.clone().sub(A), afLen = afVec.length();
    const afDir = afLen > 1e-6 ? afVec.clone().normalize() : n;
    Core.setArrow(G.AF, A, afDir, afLen, showStory && sk ? v.AF.g : 0, showStory && sk ? v.AF.a : 0);
    const bfOn = showStory && sk ? 1 : 0;
    Core.setDash(G.BF, B, B.clone().lerp(F, showStory && sk ? v.BF.g : 0), bfOn);

    // 公垂线：讲解时为虚线（逐步收拢到 AB 上），静态时为实线
    const cpProg = mode === 'common' ? 1 : (showStory && (sk || par) ? v.CP.g : 0);
    const cpEnd = Q1.clone().lerp(Q2, cpProg);
    Core.setDash(G.CPd, Q1, cpEnd, showStory && sk && L.aCommon ? 1 : 0);
    Core.setRod(G.CPs, Q1, cpEnd, 1, (mode === 'common' || (showStory && par)) && L.aCommon ? 1 : 0);

    // 脚点与公垂线的直角标记
    const feetScale = mode === 'common' ? 1 : (showStory && sk ? v.feet.g : (showStory && par ? v.rightFeet.g : 0));
    Core.setDot(G.Q1, Q1, feetScale, 1);
    Core.setDot(G.Q2, Q2, feetScale, 1);
    const rfOp = mode === 'common' ? 1 : (showStory ? (sk ? v.rightFeet.g : (par ? v.rightFeet.g : 0)) : 0);
    if (cpDir && cpLen > 1e-4) {
      Core.setRight(G.rf1, Q1, cpDir, d1, 0.2, rfOp * (L.aCommon ? 1 : 0));
      Core.setRight(G.rf2, Q2, cpDir.clone().negate(), d2, 0.2, rfOp * (L.aCommon ? 1 : 0));
    } else {
      Core.setRight(G.rf1, Q1, null, null, 0, 0);
      Core.setRight(G.rf2, Q2, null, null, 0, 0);
    }

    // 静态理解：六面体、平面法
    const boxOn = mode === 'box' && L.aBox;
    setBox(P1, d1, d2, P2.clone().sub(P1), boxOn ? 1 : 0);
    const planeOn = mode === 'plane' && L.aPlane && f.plane;
    if (planeOn) {
      const pl = f.plane, c = V(pl.center), e2 = V(pl.e2), foot = V(pl.footP2);
      Core.setQuad(G.planeA, c, d1, e2, pl.a, pl.b, 0.14);
      Core.setOutline(G.planeAO, c, d1, e2, pl.a, pl.b, 0.5);
      Core.setDash(G.planeDash, P2, foot, 1);
      const dd = foot.clone().sub(P2);
      Core.setRight(G.planeRight, foot, dd.lengthSq() > 1e-8 ? dd.normalize() : null, d1, 0.24, 1);
    } else {
      Core.setQuad(G.planeA, new THREE.Vector3(), d1, d1, 0, 0, 0);
      Core.setOutline(G.planeAO, new THREE.Vector3(), d1, d1, 0, 0, 0);
      G.planeDash.visible = false;
      G.planeRight.visible = false;
    }

    // 外环：每章先指出即将参与的对象
    const hv = (sp, p, q) => Core.setHalo(sp, p, vec ? q : 0);
    hv(G.hP1, P1, v.halo.lines); hv(G.hP2, P2, v.halo.lines);
    hv(G.hD1, tip1, v.halo.dirs); hv(G.hD2, tip2, v.halo.dirs);
    hv(G.hA, A, v.halo.pts); hv(G.hB, B, v.halo.pts);
    hv(G.hN, Q1.clone().addScaledVector(n, NTIP), v.halo.n);
    hv(G.hQ1, Q1, v.halo.feet); hv(G.hQ2, Q2, v.halo.feet);

    // 标签：回执在主动作之后淡入
    const lv = (sp, a, p) => Core.fadeLabel(sp, a, p);
    lv(G.lP1, vec ? v.lab.P1 : 1, at(P1, -0.12, -0.12, 0.42));
    lv(G.lP2, vec ? v.lab.P2 : 1, at(P2, -0.12, -0.12, 0.42));
    lv(G.lS1, vec ? v.lab.s1 : 0, at(tip1, 0, 0, 0.32));
    lv(G.lS2, vec ? v.lab.s2 : 0, at(tip2, 0, 0, 0.32));
    lv(G.lN, vec && hasN ? v.lab.n : 0, Q1.clone().addScaledVector(n, NTIP).add(new THREE.Vector3(0.18, 0, 0.1)));
    lv(G.lA, vec && sk ? v.lab.A : 0, at(A, 0.1, 0.1, 0.36));
    lv(G.lB, vec && sk ? v.lab.B : 0, at(B, 0.1, 0.1, 0.36));
    const mid = (p, q) => p.clone().add(q).multiplyScalar(0.5).add(new THREE.Vector3(0.18, 0.12, 0.34));
    let dText = `d = ${f.d.toFixed(2)}`;
    if (f.kind === 'intersect') dText = 'd = 0（相交）';
    if (f.kind === 'coincident') dText = 'd = 0（重合）';
    Core.setLabel(G.lD, dText, '#B42318');
    if (mode === 'common') {
      lv(G.lD, cpLen > 1e-4 ? 1 : 0, mid(Q1, Q2));
    } else if (vec && sk) {
      lv(G.lD, v.lab.d, mid(A, F));
    } else if (vec && par) {
      lv(G.lD, v.lab.d, mid(Q1, Q2));
    } else {
      lv(G.lD, 0, mid(Q1, Q2));
    }
    const abLen = AB.length();
    const near = Math.abs(abLen - f.d) < 0.01;
    Core.setLabel(G.lAB, sk ? `|AB| = ${abLen.toFixed(2)}${near ? ' = d' : ''}` : `d = ${f.d.toFixed(2)}`, '#B42318');
    lv(G.lAB, vec && sk ? v.lab.ab : 0, mid(A, B));
    Core.setLabel(G.lBox, `V = ${f.box.V.toFixed(2)}, S = ${f.box.S.toFixed(2)} ⇒ d = V/S = ${f.d.toFixed(2)}`, '#343C38');
    lv(G.lBox, boxOn ? 1 : 0, at(P1, 0.5, 0.5, 0).add(V(f.box.w).multiplyScalar(1.15)));
    lv(G.lPlane, planeOn ? 1 : 0, planeOn ? V(f.plane.center).add(new THREE.Vector3(2.4, 0, 0)) : new THREE.Vector3());
    Core.setLabel(G.lPlane, 'π: 过 L₁ ∥ L₂', '#343C38');
  }

  function setVisible(on) { G.root.visible = on; }

  return { build, apply, setVisible, G };
})();
