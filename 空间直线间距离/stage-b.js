/**
 * 模块 B 的三维构件与按帧渲染：平面 π（可倾斜）、直线 L、法向 n 与五条沿 n 落下的投影线、
 * 辅助法向 n′ = n × v、辅助平面 π′、投影直线 L′，以及动点 M 与其投影 M′。
 * 几何来自 model.js 的 frameB，节奏来自 choreo.js 的 viewB。
 */
const StageB = (() => {
  const HALF = 5, TIP = 1.65, NTIP = 1.7;
  const COL = {
    L: 0x2563EB, P: 0x1D4ED8, n: 0xBF8C32, np: 0xD9A441, pip: 0xBF8C32,
    proj: 0x399B7B, projDark: 0x2D7D62, plane: 0x5B7C78, drop: 0x6B7066, ink: 0x343C38,
    M: 0x6D28D9
  };
  const SAMPLES = 5;
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const G = { drops: [], feet: [] };

  function build(scene) {
    G.root = new THREE.Group();
    scene.add(G.root);
    const add = (o) => { G.root.add(o); return o; };

    G.planeMesh = add(new THREE.Mesh(new THREE.PlaneGeometry(9, 9), Core.mat.basic(COL.plane, 0.13)));
    G.grid = add(new THREE.LineSegments(gridGeometry(), Core.mat.line(COL.plane, 0.2)));
    G.outline = add(Core.outline(COL.plane, 0.5));
    G.rod = add(Core.rod(COL.L, 0.024));
    G.P = add(Core.dot(COL.P, 0.12));
    G.D = add(Core.dot(COL.ink, 0.06));
    G.v = add(Core.arrow(0x1E40AF));
    G.n = add(Core.arrow(COL.n));
    G.np = add(Core.arrow(COL.np));
    for (let i = 0; i < SAMPLES; i++) {
      G.drops.push(add(Core.dash(COL.drop)));
      G.feet.push(add(Core.dot(COL.ink, 0.06)));
    }
    G.pipFace = add(Core.quad(COL.pip, 0));
    G.pipOutline = add(Core.outline(COL.pip, 0));
    G.Lp = add(Core.rod(COL.proj, 0.034));
    G.pierce = add(Core.dot(COL.ink, 0.1));
    G.M = add(Core.dot(COL.M, 0.105));
    G.Mp = add(Core.dot(COL.projDark, 0.1));
    G.dashMMp = add(Core.dash(COL.drop));

    const halo = () => add(Core.halo());
    G.hP = halo(); G.hN = halo(); G.hV = halo(); G.hF1 = halo(); G.hF2 = halo();

    const lab = (kind, color) => add(Core.label(kind, color));
    G.lL = lab('sym', '#2563EB'); G.lPi = lab('sym', '#0F5E55');
    G.lP = lab('sym', '#1D4ED8'); G.lN = lab('sym', '#8F6619');
    G.lV = lab('sym', '#2563EB'); G.lNp = lab('eq', '#8F6619');
    G.lPip = lab('sym', '#8F6619'); G.lLp = lab('eq', '#2D7D62');
    G.lPierce = lab('eq', '#343C38'); G.lM = lab('sym', '#6D28D9'); G.lMp = lab('sym', '#2D7D62');
    Core.setLabel(G.lL, 'L', '#2563EB');
    Core.setLabel(G.lPi, 'π', '#0F5E55');
    Core.setLabel(G.lP, 'P', '#1D4ED8');
    Core.setLabel(G.lN, 'n', '#8F6619');
    Core.setLabel(G.lV, 'v', '#2563EB');
    Core.setLabel(G.lM, 'M', '#6D28D9');
    Core.setLabel(G.lMp, 'M′', '#2D7D62');
    Core.setLabel(G.lPip, 'π′', '#8F6619');
  }

  function gridGeometry() {
    const segs = [], half = 4.5, nDiv = 9;
    for (let i = 0; i <= nDiv; i++) {
      const t = -half + (2 * half * i) / nDiv;
      segs.push(-half, t, 0, half, t, 0, t, -half, 0, t, half, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    return g;
  }

  // f 为 frameB，v 为 viewB，opts.layers 为图层开关
  function apply(f, v, opts) {
    const L = opts.layers;
    const C = V(f.C), d = V(f.d), n = V(f.n), a = f.alpha;
    const nOrigin = new THREE.Vector3(0, 0, 0);

    // 平面 π 的姿态
    G.planeMesh.rotation.set(a, 0, 0);
    G.grid.rotation.set(a, 0, 0);
    G.grid.position.set(0, 0, 0.002);
    const e2 = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    Core.setOutline(G.outline, new THREE.Vector3(), new THREE.Vector3(1, 0, 0), e2, 4.5, 4.5, 0.5);
    G.planeMesh.visible = G.grid.visible = G.outline.visible = L.bPlane;

    // 直线、点与方向手柄
    Core.setRod(G.rod, C.clone().addScaledVector(d, -HALF), C.clone().addScaledVector(d, HALF));
    Core.setDot(G.P, C, 1, 1);
    Core.setDot(G.D, C.clone().addScaledVector(d, TIP), 1, 1);
    Core.setArrow(G.v, C, d, TIP, v.v.g, v.v.a);

    // 法向 n 从平面中心出发；五条投影线沿 n 落到 π 上，落点连成 L′
    Core.setArrow(G.n, nOrigin, n, NTIP, v.n.g, 1);
    const feetProg = v.feet.g;
    f.samples.forEach((s, i) => {
      const X = V(s.X), foot = V(s.foot);
      Core.setDash(G.drops[i], X, X.clone().lerp(foot, v.drops.g), L.bDrops ? 1 : 0);
      Core.setDot(G.feet[i], foot, feetProg * (L.bProjLine ? 1 : 0), 1);
    });

    // 辅助法向 n′ = n × v，辅助平面 π′（L ⊥ π 时不存在）
    const aux = f.aux ? V(f.aux) : null;
    Core.setArrow(G.np, C, aux || d, NTIP - 0.1, aux ? v.np.g : 0, aux ? v.np.a : 0);
    const pip = f.pip;
    const pq = L.bProjPlane && !f.isPend ? v.plane.g : 0;
    Core.setQuad(G.pipFace, V(pip.center), V(pip.e1), V(pip.e2), pip.a, pip.b, 0.14 * pq);
    Core.setOutline(G.pipOutline, V(pip.center), V(pip.e1), V(pip.e2), pip.a, pip.b, 0.55 * pq);

    // 投影直线 L′：从落点中心向两侧生长
    const projC = V(f.projC), dir = V(f.dir);
    const lpOn = !f.isPend && L.bProjLine;
    Core.setRod(G.Lp,
      projC.clone().addScaledVector(dir, -HALF * v.Lp.g),
      projC.clone().addScaledVector(dir, HALF * v.Lp.g),
      1, lpOn ? 1 : 0);

    // 交点（L 与 π）与动点 M、M′
    Core.setDot(G.pierce, f.pierce ? V(f.pierce) : C, f.pierce ? v.pierce.g : 0, 1);
    const M = V(f.M), Mp = V(f.Mp);
    Core.setDot(G.M, M, 1, 1);
    Core.setDot(G.Mp, Mp, 1, 1);
    Core.setDash(G.dashMMp, M, Mp, L.bDrops ? 1 : 0);

    // 外环
    const tipN = nOrigin.clone().addScaledVector(n, NTIP), tipV = C.clone().addScaledVector(d, TIP);
    Core.setHalo(G.hP, C, v.halo.P);
    Core.setHalo(G.hN, tipN, v.halo.tips);
    Core.setHalo(G.hV, tipV, v.halo.tips);
    const e1s = projC.clone().addScaledVector(dir, -HALF), e2s = projC.clone().addScaledVector(dir, HALF);
    Core.setHalo(G.hF1, e1s, f.isPend ? 0 : v.halo.feet);
    Core.setHalo(G.hF2, e2s, f.isPend ? 0 : v.halo.feet);

    // 标签（回执在主动作之后淡入）
    const at = (p, dx, dy, dz) => p.clone().add(new THREE.Vector3(dx, dy, dz));
    Core.fadeLabel(G.lL, v.lab.L, at(C, 0, 0, 0).addScaledVector(d, 3.15).add(new THREE.Vector3(0, 0, 0.32)));
    Core.fadeLabel(G.lPi, v.lab.pi, new THREE.Vector3(-4.3, 0, 0).addScaledVector(e2, -3.3));
    Core.fadeLabel(G.lP, v.lab.P, at(C, -0.12, -0.12, 0.42));
    Core.fadeLabel(G.lN, v.lab.n, tipN.clone().add(new THREE.Vector3(0.2, 0, 0.1)));
    Core.fadeLabel(G.lV, v.lab.v, at(tipV, 0, 0, 0.3));
    Core.setLabel(G.lNp, f.isPend ? 'n′ = 0（L ⊥ π）' : 'n′ = n × v', '#8F6619');
    Core.fadeLabel(G.lNp, aux ? v.lab.np : 0, aux ? at(C.clone().addScaledVector(aux, NTIP - 0.1), 0.2, 0, 0.1) : C);
    Core.fadeLabel(G.lPip, pq > 1e-3 ? v.lab.pip : 0, V(pip.center).addScaledVector(V(pip.e1), pip.a + 0.1).addScaledVector(e2, pip.b + 0.35));
    Core.setLabel(G.lLp, f.isPend ? 'L′ 为一点' : 'L′ = π ∩ π′', '#2D7D62');
    Core.fadeLabel(G.lLp, f.isPend ? v.lab.Lp : (lpOn ? v.lab.Lp : 0), projC.clone().add(new THREE.Vector3(0, 0, 0.34)));
    Core.setLabel(G.lPierce, 'L∩π', '#343C38');
    Core.fadeLabel(G.lPierce, f.pierce && L.bProjLine ? v.lab.pierce : 0, f.pierce ? at(V(f.pierce), 0.1, 0.1, 0.3) : C);
    Core.fadeLabel(G.lM, v.lab.M, at(M, 0.42, 0.16, 0.45));
    Core.fadeLabel(G.lMp, v.lab.Mp, at(Mp, 0.06, 0.06, 0.3));
  }

  function setVisible(on) { G.root.visible = on; }

  return { build, apply, setVisible, G };
})();
