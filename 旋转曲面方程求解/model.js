/**
 * 旋转曲面与锥面 · 几何模型（纯计算，不碰 DOM，不依赖 THREE）
 * 输入：案例、预设、母线参数 t、扫掠角 θ（度）；输出：本帧全部几何与文字。
 * 画面只由这组参数决定，拖动、倒退与重绘都不依赖历史。曲面网格的行列数固定，
 * θ 变化只改顶点位置，界面可以原地更新而不必重建。
 */
const RotModel = (() => {
  const DEG = Math.PI / 180;
  const ROWS = 40;          // 母线方向采样段数（固定）
  const COLS = 96;          // 扫掠方向采样段数（固定）
  const RING = 64;          // 纬圆与准线的采样段数
  const ARC = 30;           // θ 圆弧的采样段数
  const ARC_K = 0.45;       // θ 圆弧半径 / 纬圆半径
  const H0 = 2;             // §9 准线所在高度
  const FOOTER = '示意：母线取有限段，曲面为网格近似；图形与方程由同一组参数算出。';

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => mul(a, 1 / len(a));
  // layer：标签随哪个图层显隐（null 为常驻）
  const lab = (key, text, pos, tone, small = false, layer = null) => ({ key, text, pos, tone, small, layer });

  // 与单位轴 s 正交的一个单位向量
  function perpendicular(s) {
    return unit(cross(s, Math.abs(s[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  }

  // 过 M 的纬圆：圆心 c 在轴上，半径 r；v1、v2 为圆面内的正交单位基
  function circleOf(s, M) {
    const c = mul(s, dot(M, s));
    const e = sub(M, c);
    const r = len(e);
    const v1 = r > 1e-9 ? mul(e, 1 / r) : perpendicular(s);
    return { c, r, v1, v2: cross(s, v1) };
  }

  // 纬圆上角度为 a 的点；k 为半径缩放
  function onCircle(B, a, k = 1) {
    return add(B.c, mul(add(mul(B.v1, Math.cos(a)), mul(B.v2, Math.sin(a))), B.r * k));
  }

  // ---------- 案例一、二：母线绕过原点的轴旋转 ----------

  const AXIS1 = { from: [0, 0, -3.5], to: [0, 0, 3.5] };
  const S2 = unit([1, 1, 1]);
  const AXIS2 = { from: mul(S2, -6.8 * 0.45), to: mul(S2, 6.8 * 0.55) };
  const TEXT1 = {
    axis: '旋转轴 L (z轴)', gen: '母线 C', M0: 'M₀(x₀, y₀, z₀)', plane: '同高法平面 π : z = z₀'
  };

  function spec1(preset) {
    // §8.1 模型一：母线 x=1.8, z=1.2y（单叶双曲面）或 x=1+0.25z², y=0.8z（空间抛物线）
    return preset === 0
      ? { s: [0, 0, 1], axis: AXIS1, range: [-2.2, 2.2], gen: (u) => [1.8, u, 1.2 * u], minPlane: 3.2, origin: false, text: TEXT1 }
      : { s: [0, 0, 1], axis: AXIS1, range: [-2, 2], gen: (u) => [1 + 0.25 * u * u, 0.8 * u, u], minPlane: 3.2, origin: false, text: TEXT1 };
  }

  function spec2(preset) {
    // §8.2 模型二：绕斜轴 L₂: x=y=z 旋转。预设一为考研真题 L₁: x/1=y/2=z/3；预设二为 z 轴
    const common = { s: S2, axis: AXIS2, minPlane: 2.5, origin: true };
    return preset === 0
      ? { ...common, range: [-1, 1], gen: (u) => [u, 2 * u, 3 * u],
          text: { axis: '旋转轴 L₂: x = y = z (s=(1,1,1))', gen: '母线 L₁: x/1 = y/2 = z/3', M0: 'M₀(t, 2t, 3t)', plane: '垂直法截面 π : x+y+z = 6t' } }
      : { ...common, range: [-2.5, 2.5], gen: (u) => [0, 0, u],
          text: { axis: '旋转轴 L₂: x = y = z (s=(1,1,1))', gen: '母线 L₁: z轴', M0: 'M₀(0, 0, t)', plane: '垂直法截面 π : x+y+z = t' } };
  }

  function rotation(spec, t, theta) {
    const th = theta * DEG;
    const s = spec.s;
    const [u0, u1] = spec.range;
    const genAt = (i) => spec.gen(u0 + ((u1 - u0) * i) / ROWS);

    const gen = [];
    for (let i = 0; i <= ROWS; i++) gen.push(genAt(i));
    const M0 = spec.gen(t);
    const B = circleOf(s, M0);
    const P = onCircle(B, th);

    // 曲面：每一行是母线上的一点绕轴转过 0..θ 的圆弧（列数固定，只改顶点）
    const surface = new Float32Array((ROWS + 1) * (COLS + 1) * 3);
    let k = 0;
    for (let i = 0; i <= ROWS; i++) {
      const Bi = circleOf(s, gen[i]);
      for (let j = 0; j <= COLS; j++) {
        const a = (th * j) / COLS;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        for (let d = 0; d < 3; d++) {
          surface[k++] = Bi.c[d] + Bi.r * (Bi.v1[d] * ca + Bi.v2[d] * sa);
        }
      }
    }

    const ring = [];
    for (let i = 0; i <= RING; i++) ring.push(onCircle(B, (2 * Math.PI * i) / RING));
    const arc = [];
    for (let i = 0; i <= ARC; i++) arc.push(onCircle(B, (th * i) / ARC, ARC_K));
    const arcLabel = onCircle(B, th / 2, ARC_K * 1.35);
    const planeR = Math.max(B.r * 2.2, spec.minPlane);
    const end = gen[ROWS];
    const O = [0, 0, 0];

    const labels = spec.origin
      ? [
          lab('axis', spec.text.axis, add(spec.axis.to, [0.2, 0.2, 0.3]), 'ink'),
          lab('origin', '基准定点 O(0,0,0)', [-0.35, -0.35, -0.2], 'ink'),
          lab('gen', spec.text.gen, add(end, [0.2, 0.2, 0.2]), 'ink'),
          lab('M0', spec.text.M0, add(M0, [0.2, 0.2, 0.2]), 'ink'),
          lab('plane', spec.text.plane, add(B.c, add(mul(B.v2, planeR * 0.75), [0, 0, 0.1])), 'mute', false, 'plane'),
          lab('P', 'P(x, y, z)', add(P, [0.25, 0.25, 0.2]), 'blue'),
          lab('theta', `θ = ${Math.round(theta)}°`, arcLabel, 'blue', true, 'radius')
        ]
      : [
          lab('axis', spec.text.axis, [0, 0.45, 3.6], 'ink'),
          lab('gen', spec.text.gen, add(end, [0.2, 0.2, 0.2]), 'ink'),
          lab('M0', spec.text.M0, add(M0, [0.3, 0.2, 0.2]), 'ink'),
          lab('plane', spec.text.plane, [-planeR * 0.7, planeR * 0.7, M0[2] + 0.08], 'mute', false, 'plane'),
          lab('P', 'P(x, y, z)', add(P, [0.25, 0.25, 0.2]), 'blue'),
          lab('theta', `θ = ${Math.round(theta)}°`, arcLabel, 'blue', true, 'radius')
        ];

    return {
      axis: spec.axis,
      gen,
      M0,
      C0: B.c,
      r: B.r,
      P,
      plane: { center: B.c, normal: s, radius: planeR },
      ring,
      radiusM0: [B.c, M0],
      radiusP: [B.c, P],
      sphereM0: spec.origin ? [O, M0] : null,
      sphereP: spec.origin ? [O, P] : null,
      arc,
      surface,
      rows: ROWS + 1,
      cols: COLS + 1,
      labels
    };
  }

  // ---------- 案例三：§9 锥面（顶点 O，准线 z=2 上的动点 M₁，母线 OM₁）----------

  function cone(preset, t, theta) {
    const a = preset === 0 ? 2 : 2.4;
    const b = preset === 0 ? 2 : 1.5;
    const D = (ang) => [a * Math.cos(ang), b * Math.sin(ang), H0];
    const M1 = D(((t + 2) / 4) * 2 * Math.PI);
    const th = theta * DEG;

    const ring = [];
    for (let i = 0; i <= RING; i++) ring.push(D((2 * Math.PI * i) / RING));

    // 母线两侧各延伸：u ∈ [-1.1, 1.35]，沿准线从 0 扫到 θ；一条母线是 u·D(ψ)
    const U0 = -1.1;
    const U1 = 1.35;
    const UROWS = 24;
    const surface = new Float32Array((UROWS + 1) * (COLS + 1) * 3);
    let k = 0;
    for (let i = 0; i <= UROWS; i++) {
      const u = U0 + ((U1 - U0) * i) / UROWS;
      for (let j = 0; j <= COLS; j++) {
        const ang = (th * j) / COLS;
        surface[k++] = u * a * Math.cos(ang);
        surface[k++] = u * b * Math.sin(ang);
        surface[k++] = u * H0;
      }
    }

    const rxy = Math.hypot(M1[0], M1[1]);
    const labels = [
      lab('vertex', '顶点 M₀(0, 0, 0)', [-0.35, -0.35, -0.25], 'ink'),
      lab('dir', preset === 0 ? '准线 C: x²+y²=4, z=2' : '准线 C: x²/2.4²+y²/1.5²=1, z=2', [0, b + 0.35, H0], 'gold', false, 'circle'),
      lab('plane', '准线所在平面: z = 2', [-2.4, 2.4, H0 + 0.08], 'mute', false, 'plane'),
      lab('M1', '准线上动点 M₁(X, Y, Z)', add(M1, [0.25, 0.25, 0.2]), 'blue'),
      lab('gen', '动母线 L', add(mul(M1, 1.3), [0.2, 0.2, 0.2]), 'ink', false, 'radius'),
      lab('h', `竖直高程 h = ${H0.toFixed(1)}`, [0.1, 0.2, H0 * 0.5], 'mute', true, 'radius'),
      lab('r', `截面半径 r = ${rxy.toFixed(2)}`, [M1[0] * 0.5, M1[1] * 0.5, H0 + 0.1], 'mute', true, 'radius')
    ];

    return {
      axis: null,
      gen: [mul(M1, -1.1), mul(M1, 1.3)],
      M0: [0, 0, 0],
      C0: null,
      r: rxy,
      P: null,
      M1,
      tri: [[0, 0, 0], [0, 0, H0], M1],
      plane: { center: [0, 0, H0], normal: [0, 0, 1], radius: 3.5 },
      ring,
      radiusM0: null,
      radiusP: null,
      sphereM0: null,
      sphereP: null,
      arc: null,
      surface,
      rows: UROWS + 1,
      cols: COLS + 1,
      labels
    };
  }

  // ---------- 对外接口 ----------

  // 本帧画面：几何（结构与扫掠两类）、文字标签、阶段
  function frame(caseNo, preset, t, theta) {
    const base = { caseNo, preset, theta, phase: phaseOf(caseNo, theta) };
    if (caseNo === 3) return { ...base, ...cone(preset, t, theta) };
    return { ...base, ...rotation(caseNo === 1 ? spec1(preset) : spec2(preset), t, theta) };
  }

  // 界面文字（HUD、滑块、图层与预设按钮）；KaTeX 片段保留 $…$ 由界面排版
  function texts(caseNo, preset) {
    const p0 = preset === 0;
    if (caseNo === 1) {
      return {
        badge: p0 ? '§8.1 单叶双曲面生成' : '§8.1 空间抛物线旋转', sub: '模型一：绕坐标轴',
        axisLabel: '旋转轴 L:', axis: 'z 轴 : x=0, y=0 (s=(0,0,1))',
        curveLabel: '母线 C:', curve: p0 ? 'x₁=1.8, z₁=1.2y₁ (空间异面线)' : 'x₁=1+0.25z₁², y₁=0.8z₁',
        surfaceLabel: '曲面方程:', surface: p0 ? '(x²+y²)/3.24 - z²/4.67 = 1' : 'x²+y²=(1+0.25z²)²+0.64z²',
        tLabel: '母线动点参数 $t$ (位置 $M_0$)', tDot: 'ink',
        thetaLabel: '旋转扫掠角 $\\theta$ (动点 $P$)', thetaDot: 'blue',
        layers: { plane: '法截面 π', circle: '纬圆轨迹', radius: '到轴矢径', surface: '生成曲面' },
        presets: ['单叶双曲面 (异面线)', '空间抛物线'],
        footer: FOOTER
      };
    }
    if (caseNo === 2) {
      return {
        badge: p0 ? '§8.2 考研数学一真题模型' : '§8.2 z 轴绕对角线（二次圆锥面）', sub: '模型二：绕斜轴全能',
        axisLabel: '旋转轴 L₂:', axis: 'x = y = z (向径 s=(1,1,1))',
        curveLabel: '母线 L₁:', curve: p0 ? 'x/1 = y/2 = z/3 (过原点)' : 'z 轴 : x=0, y=0, z=t',
        surfaceLabel: '曲面方程:', surface: p0 ? '18(x²+y²+z²) - 7(x+y+z)² = 0' : 'xy + yz + zx = 0 (二次圆锥面)',
        tLabel: '母线动点参数 $t$ (位置 $M_0$)', tDot: 'ink',
        thetaLabel: '旋转扫掠角 $\\theta$ (动点 $P$)', thetaDot: 'blue',
        layers: { plane: '法截面 π', circle: '纬圆轨迹', radius: '同心球半径', surface: '生成曲面' },
        presets: ['考研数一真题 (L₁绕L₂)', 'z轴绕对角线 (xy+yz+zx=0)'],
        footer: FOOTER
      };
    }
    return {
      badge: p0 ? '§9 标准圆锥面与正负辨析' : '§9 一般椭圆锥面消参', sub: '顶点·母线·准线',
      axisLabel: '顶点 M₀:', axis: '原点 O(0, 0, 0)',
      curveLabel: '定准线 C:', curve: p0 ? 'x² + y² = 4, z = 2' : 'x²/2.4² + y²/1.5² = 1, z = 2',
      surfaceLabel: '锥面方程:', surface: p0 ? 'z² = x² + y² (齐次二次锥面)' : 'x²/2.4² + y²/1.5² = z²/4',
      tLabel: '准线动点参角 $\\phi$ (位置 $M_1$)', tDot: 'blue',
      thetaLabel: '母线织面扫掠角 $\\theta$', thetaDot: 'blue',
      layers: { plane: '准线平面', circle: '准线导引环', radius: '动母线与直角三角形', surface: '生成锥面' },
      presets: ['标准圆锥面 (正负开方)', '椭圆锥面 (消参模型)'],
      footer: FOOTER
    };
  }

  // 阶段名：只看 θ（起始、扫掠中、闭合）
  function phaseOf(caseNo, theta) {
    if (theta <= 0.05) return '起始';
    if (theta < 359.95) return caseNo === 3 ? '织面中' : '扫掠中';
    return caseNo === 3 ? '织面完成' : '一周闭合';
  }

  // 方程的隐式形式 F(x,y,z)=0，供单测核对曲面网格与界面上写的方程是否一致
  function residual(caseNo, preset) {
    if (caseNo === 1) {
      return preset === 0
        ? ([x, y, z]) => (x * x + y * y) / 3.24 - (z * z) / 4.6656 - 1
        : ([x, y, z]) => x * x + y * y - ((1 + 0.25 * z * z) ** 2 + 0.64 * z * z);
    }
    if (caseNo === 2) {
      return preset === 0
        ? ([x, y, z]) => 18 * (x * x + y * y + z * z) - 7 * (x + y + z) ** 2
        : ([x, y, z]) => x * y + y * z + z * x;
    }
    return preset === 0
      ? ([x, y, z]) => x * x + y * y - z * z
      : ([x, y, z]) => (x * x) / 5.76 + (y * y) / 2.25 - (z * z) / 4;
  }

  // ---------- 分步推导：每个案例五步，文字与时间线都是纯计算 ----------

  const SWEEP_STEP = 3;          // 第四步「旋转」：θ 在这一步内从 0 扫到目标值
  const STEP_SEC = 1.8;          // 普通一步的时长（秒）
  const STEP_SEC_REDUCE = 0.9;   // 减少动效时的步长
  const FADE_SEC = 0.5;          // 新元素的淡入时长（秒）
  const DEG_PER_SEC = 72;        // 扫掠速度（度/秒），与旧版 60 Hz 下的节奏一致

  const f2 = (v) => v.toFixed(2);
  const texDeg = (v) => `${Math.round(v)}^\\circ`;
  const row = (note, tex = null) => ({ note, tex });

  function steps1a(t, th) {
    // §8.1 单叶双曲面：母线 x=1.8，z=1.2y
    const z = 1.2 * t;
    return [
      { name: '母线', title: '母线与动点', narration: '母线上取动点 M₀，它将绕 z 轴旋转。',
        lines: [
          row('母线 C：x₀ = 1.8，z₀ = 1.2y₀', String.raw`x_0=1.8,\quad z_0=1.2\,y_0`),
          row('当前动点 M₀', String.raw`M_0=(1.80,\;${f2(t)},\;${f2(z)})`)
        ] },
      { name: '同高', title: '同高纬圆', narration: '过 M₀ 作与 z 轴垂直的截面，高度 z 不变。',
        lines: [
          row('截面 π 垂直于 z 轴，高度 z = z₀', String.raw`z=z_0=${f2(z)}`)
        ] },
      { name: '等距', title: '到轴距离相等', narration: '到 z 轴的距离保持不变，纬圆半径为 r。',
        lines: [
          row('到 z 轴的距离平方相等', String.raw`x^2+y^2=x_0^2+y_0^2=1.8^2+\left(\dfrac{z}{1.2}\right)^2`),
          row('纬圆半径', String.raw`r=\sqrt{x_0^2+y_0^2}=${f2(Math.hypot(1.8, t))}`)
        ] },
      { name: '旋转', title: '绕轴转过 θ', narration: '动点 P 绕轴转动，扫出一个曲面。',
        lines: [
          row('动点 P 在同一纬圆上', String.raw`x^2+y^2=r^2,\quad z=z_0,\quad \theta=${texDeg(th)}`)
        ] },
      { name: '消参', title: '消去参数 t', narration: '代入母线关系消去参数，得到单叶双曲面。',
        lines: [
          row('代入 x₀ = 1.8，y₀ = z/1.2', String.raw`\dfrac{x^2+y^2}{1.8^2}-\dfrac{z^2}{(1.2\times1.8)^2}=1`),
          row('整理为标准形式：单叶双曲面', String.raw`\dfrac{x^2+y^2}{3.24}-\dfrac{z^2}{4.67}=1`),
          row('通式：直线 (x−a)/m = (y−b)/n = (z−c)/p 时，同法代入', String.raw`x_0=a+\dfrac{m(z-c)}{p},\quad y_0=b+\dfrac{n(z-c)}{p}`)
        ] }
    ];
  }

  function steps1b(t, th) {
    // §8.1 空间抛物线：母线 x=1+0.25z²，y=0.8z
    const x = 1 + 0.25 * t * t;
    const y = 0.8 * t;
    return [
      { name: '母线', title: '母线与动点', narration: '母线是空间抛物线，M₀ 随 z 变化。',
        lines: [
          row('母线 C：x₀ = 1 + 0.25z₀²，y₀ = 0.8z₀', String.raw`x_0=1+0.25\,z_0^2,\quad y_0=0.8\,z_0`),
          row('当前动点 M₀', String.raw`M_0=(${f2(x)},\;${f2(y)},\;${f2(t)})`)
        ] },
      { name: '同高', title: '同高纬圆', narration: '同高截面仍与 z 轴垂直。',
        lines: [
          row('截面 π 垂直于 z 轴，高度 z = z₀', String.raw`z=z_0=${f2(t)}`)
        ] },
      { name: '等距', title: '到轴距离相等', narration: '到 z 轴距离的平方由高度 z 唯一确定。',
        lines: [
          row('到 z 轴的距离平方相等', String.raw`x^2+y^2=x_0^2+y_0^2=\left(1+0.25\,z^2\right)^2+0.64\,z^2`),
          row('纬圆半径', String.raw`r=\sqrt{x_0^2+y_0^2}=${f2(Math.hypot(x, y))}`)
        ] },
      { name: '旋转', title: '绕轴转过 θ', narration: '动点 P 绕轴转动，扫出曲面。',
        lines: [
          row('动点 P 在同一纬圆上', String.raw`x^2+y^2=r^2,\quad z=z_0,\quad \theta=${texDeg(th)}`)
        ] },
      { name: '消参', title: '消去参数 t', narration: '代入后是四次方程，不是二次曲面。',
        lines: [
          row('代入母线关系，消去 t', String.raw`x^2+y^2=1+1.14\,z^2+\dfrac{z^4}{16}`),
          row('出现 z⁴/16 项，因此不是二次曲面')
        ] }
    ];
  }

  function steps2a(t, th) {
    // §8.2 考研真题：L₁: x/1=y/2=z/3 绕 L₂: x=y=z
    return [
      { name: '母线', title: '轴与母线', narration: '母线 L₁ 上取 M₀，它绕斜轴 L₂ 旋转。',
        lines: [
          row('旋转轴 L₂ 过原点 O，方向 s = (1, 1, 1)', String.raw`L_2:\;x=y=z`),
          row('母线 L₁ 上的动点 M₀', String.raw`L_1:\;\dfrac{x}{1}=\dfrac{y}{2}=\dfrac{z}{3},\quad M_0=(${f2(t)},\;${f2(2 * t)},\;${f2(3 * t)})`)
        ] },
      { name: '截面', title: '垂直于轴的截面', narration: 'P 与 M₀ 同在垂直于 L₂ 的截面内。',
        lines: [
          row('过 M₀ 且垂直于 s 的截面', String.raw`\overrightarrow{M_0P}\cdot\boldsymbol{s}=0\iff (x-t)+(y-2t)+(z-3t)=0`),
          row('由此解出 t', String.raw`6t=x+y+z,\quad t=\dfrac{x+y+z}{6}`)
        ] },
      { name: '等距', title: '到定点 O 等距', narration: '取轴上定点 O 比较距离，免去叉积运算。',
        lines: [
          row('O 在轴上，|OP| = |OM₀|', String.raw`|\overrightarrow{OP}|^2=|\overrightarrow{OM_0}|^2`),
          row('代入坐标', String.raw`x^2+y^2+z^2=t^2+(2t)^2+(3t)^2=14\,t^2`)
        ] },
      { name: '旋转', title: '绕轴转过 θ', narration: '动点 P 绕斜轴转动，扫出曲面。',
        lines: [
          row('动点 P 绕 L₂ 转过 θ', String.raw`\theta=${texDeg(th)}`)
        ] },
      { name: '消参', title: '消去参数 t', narration: '代入 t 消参，得到二次齐次方程。',
        lines: [
          row('代入 t = (x+y+z)/6', String.raw`x^2+y^2+z^2=\dfrac{14}{36}\,(x+y+z)^2`),
          row('去分母并整理', String.raw`18\,(x^2+y^2+z^2)-7\,(x+y+z)^2=0`),
          row('二次齐次，顶点在 O：以 L₂ 为轴的二次圆锥面')
        ] }
    ];
  }

  function steps2b(t, th) {
    // §8.2 进阶变体：z 轴绕 L₂: x=y=z
    return [
      { name: '母线', title: '轴与母线', narration: 'z 轴 L₁ 上取 M₀，绕斜轴 L₂ 旋转。',
        lines: [
          row('旋转轴 L₂ 过原点 O，方向 s = (1, 1, 1)', String.raw`L_2:\;x=y=z`),
          row('母线 L₁ 为 z 轴，动点 M₀', String.raw`L_1:\;x=0,\;y=0,\quad M_0=(0,\;0,\;${f2(t)})`)
        ] },
      { name: '截面', title: '垂直于轴的截面', narration: 'P 与 M₀ 同在垂直于 L₂ 的截面内。',
        lines: [
          row('过 M₀ 且垂直于 s 的截面', String.raw`(x-0)+(y-0)+(z-t)=0\iff x+y+z=t`)
        ] },
      { name: '等距', title: '到定点 O 等距', narration: '到原点 O 的距离相等。',
        lines: [
          row('|OP| = |OM₀|', String.raw`x^2+y^2+z^2=t^2=(x+y+z)^2`)
        ] },
      { name: '旋转', title: '绕轴转过 θ', narration: '动点 P 绕斜轴转动，扫出曲面。',
        lines: [
          row('动点 P 绕 L₂ 转过 θ', String.raw`\theta=${texDeg(th)}`)
        ] },
      { name: '消参', title: '消去参数 t', narration: '整理得 xy+yz+zx=0，即二次圆锥面。',
        lines: [
          row('展开并整理', String.raw`2\,(xy+yz+zx)=0\iff xy+yz+zx=0`),
          row('过原点的二次圆锥面')
        ] }
    ];
  }

  // §9 速查表：开方正负号辨析（结论步）与三大几何生成曲面对照（对照步）
  const SIGN_TABLE = {
    head: ['锥面形态', '代数方程', '变量范围约束', '几何特征'],
    rows: [
      ['全双圆锥面', String.raw`$z^2=x^2+y^2$`, String.raw`$z\in(-\infty,+\infty)$`, '包含顶点上下两侧的双叶圆锥面'],
      ['上半圆锥面', String.raw`$z=\sqrt{x^2+y^2}$`, String.raw`$z\ge 0$`, '重积分/曲面积分极高频（开方取正根）'],
      ['下半圆锥面', String.raw`$z=-\sqrt{x^2+y^2}$`, String.raw`$z\le 0$`, '仅包含 xOy 面下方单侧锥面（开方取负根）'],
      ['一般椭圆锥面', String.raw`$\dfrac{x^2}{a^2}+\dfrac{y^2}{b^2}=\dfrac{z^2}{c^2}$`, String.raw`$z\in(-\infty,+\infty)$`, '水平截面为椭圆的双叶锥面']
    ],
  };
  const SURFACE_TABLE = {
    head: ['', '柱面', '锥面', '旋转曲面'],
    rows: [
      ['生成母线特征', String.raw`动直线 $L$`, String.raw`动直线 $L$`, String.raw`平面/空间曲线 $C$`],
      ['引导几何约束', String.raw`<strong>平行于固定方向 $\boldsymbol{v}$</strong>，沿定曲线移动`, String.raw`<strong>恒过固定点 $M_0$（顶点）</strong>，沿定曲线移动`, String.raw`<strong>绕固定直线 $L$（旋转轴）旋转一周</strong>`],
      ['核心代数特征', '方程通常<strong>缺失某一坐标变量</strong>', '顶点在原点时方程必为<strong>齐次式</strong>', '<strong>绕谁转谁不变</strong>，另两变量平方和代换'],
      ['典型方程代表', String.raw`$x^2+y^2=R^2$`, String.raw`$z^2=x^2+y^2$`, String.raw`$z=\sqrt{x^2+y^2}$`]
    ],
    hiCol: true
  };

  function steps3(preset, t, th) {
    // §9 锥面：顶点 O，准线 z=2 上的动点 M₁，过顶点的母线 OM₁
    const a = preset === 0 ? 2 : 2.4;
    const b = preset === 0 ? 2 : 1.5;
    const phi = ((t + 2) / 4) * 360;   // 准线参角（度）
    const X = f2(a * Math.cos(phi * DEG));
    const Y = f2(b * Math.sin(phi * DEG));
    const curve = preset === 0
      ? String.raw`x^2+y^2=4,\quad z=2`
      : String.raw`\dfrac{x^2}{2.4^2}+\dfrac{y^2}{1.5^2}=1,\quad z=2`;
    const elim = preset === 0
      ? String.raw`x^2+y^2=z^2`
      : String.raw`\dfrac{x^2}{2.4^2}+\dfrac{y^2}{1.5^2}=\lambda^2=\dfrac{z^2}{4}`;
    const concl = preset === 0
      ? String.raw`z^2=x^2+y^2`
      : String.raw`\dfrac{x^2}{2.4^2}+\dfrac{y^2}{1.5^2}=\dfrac{z^2}{4}`;
    return [
      { name: '准线', title: '顶点与准线', narration: '顶点 O 与准线 C 确定锥面的骨架。',
        lines: [
          row('顶点 M₀ = O', String.raw`M_0=O(0,\,0,\,0)`),
          row('准线 C 位于平面 z = 2 内', curve)
        ] },
      { name: '母线', title: '过顶点的母线', narration: '过顶点的母线与准线交于动点 M₁。',
        lines: [
          row(`动点 M₁，准线参角 φ = ${Math.round(phi)}°`, String.raw`M_1=(${X},\;${Y},\;2)`),
          row('母线 OM₁ 上任一点 M', String.raw`(x,\,y,\,z)=\lambda\,(${X},\;${Y},\;2)`)
        ] },
      { name: '消参', title: '消去参数 λ', narration: '由准线高度 z = 2λ，代入消去 λ。',
        lines: [
          row('由 z = 2λ 得 λ = z/2', String.raw`\lambda=\dfrac{z}{2}`),
          row('代入准线的形式，消去 λ', elim)
        ] },
      { name: '织面', title: '母线沿准线移动', narration: '母线沿准线移动，扫出锥面。',
        lines: [
          row('母线沿准线扫过的参角', String.raw`\psi\in[0,\,${texDeg(th)}]`)
        ] },
      { name: '结论', title: '锥面方程', narration: '顶点在原点，方程为齐次二次式。',
        lines: [
          row(preset === 0 ? '齐次二次锥面' : '椭圆锥面：水平截面为椭圆', concl),
          row('顶点在原点，方程关于 x、y、z 齐次'),
          { note: '开方正负号辨析：速查表', tex: null, table: SIGN_TABLE, hi: preset === 0 ? 0 : 3 }
        ],
        wide: true },
      { name: '对照', title: '三大几何生成曲面', narration: '柱面、锥面、旋转曲面的生成方式各不相同。',
        lines: [
          { note: '空间三大几何生成曲面对照总结', tex: null, table: SURFACE_TABLE, hi: 2 }
        ],
        wide: true }
    ];
  }

  // 分步推导：每个案例五步；步名、旁白与公式随 t、θ 变化
  function steps(caseNo, preset, t, thetaTarget) {
    const th = Math.round(thetaTarget);
    if (caseNo === 1) return preset === 0 ? steps1a(t, th) : steps1b(t, th);
    if (caseNo === 2) return preset === 0 ? steps2a(t, th) : steps2b(t, th);
    return steps3(preset, t, th);
  }

  // 时间线：五步的时长与起点（秒）；第四步按约 72°/s 扫到目标角
  // 每个案例的步数：§9 多一步「对照」
  const stepCount = (caseNo) => (caseNo === 3 ? 6 : 5);

  function timeline(thetaTarget, reduce, count = 5) {
    const step = reduce ? STEP_SEC_REDUCE : STEP_SEC;
    const sweep = reduce ? step : Math.max(STEP_SEC, thetaTarget / DEG_PER_SEC);
    const durations = Array.from({ length: count }, (_, i) => (i === SWEEP_STEP ? sweep : step));
    const starts = [];
    let acc = 0;
    for (const d of durations) {
      starts.push(acc);
      acc += d;
    }
    return { durations, starts, total: acc };
  }

  // 时钟 → (步号, 步内秒数)；超过末尾停在最后一步的末尾
  function locate(tl, clock) {
    for (let i = tl.starts.length - 1; i >= 0; i--) {
      if (clock >= tl.starts[i]) {
        return { index: i, local: Math.min(clock - tl.starts[i], tl.durations[i]) };
      }
    }
    return { index: 0, local: 0 };
  }

  // 本步的扫掠角：只有第四步内连续变化，之前为 0，之后为目标值
  function thetaAt(tl, index, local, thetaTarget, reduce) {
    if (index < SWEEP_STEP) return 0;
    if (index > SWEEP_STEP || reduce) return thetaTarget;
    return thetaTarget * Math.min(1, local / tl.durations[SWEEP_STEP]);
  }

  // 元素在某步出现：该步之前为 0，之后为 1，本步内 0.5 秒淡入（减少动效时直接出现）
  function revealAlpha(index, local, step, reduce) {
    if (index < step) return 0;
    if (index > step || reduce) return 1;
    const p = Math.min(Math.max(local / FADE_SEC, 0), 1);
    return p * p * (3 - 2 * p);
  }

  // 每个对象或标签在第几步出现（键名与 frame 的标签键、界面里的对象键一致）
  const REVEAL = {
    1: { axis: 0, gen: 0, M0: 0, C0: 1, plane: 1, ring: 1, radiusM0: 2, radiusP: 3, P: 3, arc: 3, theta: 3, surface: 3 },
    2: { axis: 0, gen: 0, M0: 0, origin: 0, C0: 1, plane: 1, ring: 1, sphereM0: 2, radiusM0: 2, radiusP: 3, sphereP: 3, P: 3, arc: 3, theta: 3, surface: 3 },
    3: { vertex: 0, dir: 0, plane: 0, M1: 1, gen: 1, line: 1, tri: 2, h: 2, r: 2, surface: 3 }
  };

  return { frame, texts, residual, phaseOf, steps, stepCount, timeline, locate, thetaAt, revealAlpha, REVEAL, SWEEP_STEP, FADE_SEC };
})();

if (typeof module === 'object' && module.exports) module.exports = RotModel;
