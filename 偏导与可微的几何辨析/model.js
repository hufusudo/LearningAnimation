/**
 * 偏导与可微的几何辨析 —— 数学与内容数据层（2D 版）。
 * 不依赖 DOM：页面与 Node 测试共用（node --test 运行 model.test.cjs）。
 *
 * 约定：
 *   · P = (0, 0)，五个样本都满足 f(P) = 0；
 *   · 穿过 P 的一条直线记作 θ：t 为带符号距离，t>0 沿 θ，t<0 沿 θ+180°；
 *     截线 g(t) = f(t·cosθ, t·sinθ)，割线斜率 g(t)/t；
 *   · 割线斜率在 t→0 时两侧一致，就是这条直线上的偏导（或方向导数）；
 *   · 候选切平面 L(v) = ∇f(P)·v，只在偏导存在时给出；
 *     误差比 = max_u |f(d·u) − L(d·u)| / d，u 取遍单位圆。
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;
  var RHO0 = 1.2;        // k=0 时的窗口半径
  var K_MAX = 9;         // 缩放级数：ρ = RHO0·2^(−k)
  var REVEAL_RHO = 0.01; // 缩到这个距离以内，连续、可微、偏导连续才揭晓
  var DIR_COUNT = 360;   // 误差比取样方向数，1° 一格，包含 45°

  var DIRS = [];
  for (var i = 0; i < DIR_COUNT; i++) {
    DIRS.push({ x: Math.cos(i * TAU / DIR_COUNT), y: Math.sin(i * TAU / DIR_COUNT) });
  }

  /* ---------- 样本：真值表写死在数据里（设计方案 §3.1） ---------- */

  var SAMPLES = [
    {
      id: 'F1',
      group: 'entry',
      formula: 'f = xy / (x² + y²)',
      truth: { A: true, B: false, C: false, D: false },
      gradAtP: { x: 0, y: 0 },
      f: function (x, y) {
        var s = x * x + y * y;
        return s === 0 ? 0 : x * y / s;
      },
      grad: function (x, y) {
        var s = x * x + y * y;
        if (s === 0) return null;
        return { x: y * (y * y - x * x) / (s * s), y: x * (x * x - y * y) / (s * s) };
      },
      // 离开 P 时 g(t) 恒为 cosθ·sinθ：θ=0 或 90° 时 g≡0，否则在 P 处跳开，两侧都没有导数
      sliceSlopes: function (theta) {
        var k = Math.cos(theta) * Math.sin(theta);
        if (Math.abs(k) < 1e-9) return { left: 0, right: 0, twoSided: true };
        return { left: null, right: null, twoSided: false };
      },
      text: {
        axis: '把手转到 0° 或 90°，看坐标轴上的截线。',
        zoom: '把手转到 45°，缩小 ρ，看 P 处的高度。',
        result: '离 P 再近，高度不趋于 0：不连续，也不可微。'
      }
    },
    {
      id: 'F2',
      group: 'entry',
      formula: 'f = √(x² + y²)',
      truth: { A: false, B: true, C: false, D: false },
      gradAtP: null,
      f: function (x, y) {
        return Math.hypot(x, y);
      },
      grad: function (x, y) {
        var r = Math.hypot(x, y);
        if (r === 0) return null;
        return { x: x / r, y: y / r };
      },
      // g(t) = |t|：任何方向都是折角，左斜率 −1，右斜率 +1
      sliceSlopes: function () {
        return { left: -1, right: 1, twoSided: false };
      },
      text: {
        axis: '把手转到 0°，看 P 处的截线有没有切线。',
        zoom: '缩小 ρ，看折角是否随放大而消失。',
        result: '各方向都连续，但 P 处是折角：偏导不存在。'
      }
    },
    {
      id: 'F3',
      group: 'advanced',
      formula: 'f = xy / √(x² + y²)',
      truth: { A: true, B: true, C: false, D: false },
      gradAtP: { x: 0, y: 0 },
      f: function (x, y) {
        var r = Math.hypot(x, y);
        return r === 0 ? 0 : x * y / r;
      },
      grad: function (x, y) {
        var r = Math.hypot(x, y);
        if (r === 0) return null;
        var r3 = r * r * r;
        return { x: y * y * y / r3, y: x * x * x / r3 };
      },
      // g(t) = |t|·cosθ·sinθ：V 形，两侧斜率为 ∓cosθ·sinθ（45° 时为 ∓0.5）
      sliceSlopes: function (theta) {
        var k = Math.cos(theta) * Math.sin(theta);
        return { left: -k, right: k, twoSided: Math.abs(k) < 1e-9 };
      },
      text: {
        axis: '把手转到 0° 或 90°，看坐标轴方向。',
        zoom: '把手转到 45°，缩小 ρ，看误差比。',
        result: '沿 45° 有折角，误差比恒为 0.5：不可微。'
      }
    },
    {
      id: 'F4',
      group: 'advanced',
      formula: 'f = (x² + y²)·sin(1/√(x² + y²))',
      truth: { A: true, B: true, C: false, D: true },
      gradAtP: { x: 0, y: 0 },
      f: function (x, y) {
        var s = x * x + y * y;
        return s === 0 ? 0 : s * Math.sin(1 / Math.sqrt(s));
      },
      grad: function (x, y) {
        var r = Math.hypot(x, y);
        if (r === 0) return null;
        var a = 2 * Math.sin(1 / r) - Math.cos(1 / r) / r;
        return { x: a * x, y: a * y };
      },
      // g(t) = t²·sin(1/|t|)：两侧斜率都是 0，但 g'(t) 在 P 附近无限次振荡
      sliceSlopes: function () {
        return { left: 0, right: 0, twoSided: true };
      },
      text: {
        axis: '把手转到 0°，看坐标轴上的切线。',
        zoom: '缩小 ρ，看误差比，再看切线斜率。',
        result: '误差比趋于 0：可微；切线斜率却不收束。'
      }
    },
    {
      id: 'F0',
      group: 'advanced',
      formula: 'f = 0.35·sin(1.4x)·cos(1.4y) + 0.1x',
      truth: { A: true, B: true, C: true, D: true },
      gradAtP: { x: 0.59, y: 0 },
      f: function (x, y) {
        return 0.35 * Math.sin(1.4 * x) * Math.cos(1.4 * y) + 0.1 * x;
      },
      grad: function (x, y) {
        return {
          x: 0.49 * Math.cos(1.4 * x) * Math.cos(1.4 * y) + 0.1,
          y: -0.49 * Math.sin(1.4 * x) * Math.sin(1.4 * y)
        };
      },
      sliceSlopes: function (theta) {
        var s = 0.59 * Math.cos(theta);
        return { left: s, right: s, twoSided: true };
      },
      text: {
        axis: '把手转到 0°，看切线的斜率。',
        zoom: '缩小 ρ，看曲面是否变平。',
        result: '斜率稳定，误差比趋于 0：偏导连续，可微。'
      }
    }
  ];

  var BY_ID = {};
  SAMPLES.forEach(function (s) { BY_ID[s.id] = s; });

  // 键盘 1–5 与按钮的顺序：入门在前，进阶在后
  var ORDER = ['F1', 'F2', 'F3', 'F4', 'F0'];

  var CONCEPTS = [
    { id: 'A', name: '偏导存在' },
    { id: 'B', name: '连续' },
    { id: 'D', name: '可微' },
    { id: 'C', name: '偏导连续' }
  ];

  // 蕴含关系：成立的推导；不成立的推导附带反例（前提真、结论假）
  var IMPLICATIONS = [
    { from: ['C'], to: 'D', valid: true },
    { from: ['D'], to: 'A', valid: true },
    { from: ['D'], to: 'B', valid: true },
    { from: ['A'], to: 'B', valid: false, counter: 'F1' },
    { from: ['B'], to: 'A', valid: false, counter: 'F2' },
    { from: ['A', 'B'], to: 'D', valid: false, counter: 'F3' },
    { from: ['D'], to: 'C', valid: false, counter: 'F4' }
  ];

  /* ---------- 导览脚本：时间线上的关键帧（页面用 GSAP 推进，时刻决定画面） ---------- */

  var TOURS = {
    entry: {
      start: { theta: 20, k: 0 },
      steps: [
        { sample: 'F1', theta: 20, k: 0, dur: 0, text: '这是 f = xy/(x²+y²)。在 P 处沿一条直线切开，得到截线。' },
        { sample: 'F1', theta: 0, k: 0, dur: 1.6, text: '沿 x 轴切开：截线水平，切线斜率为 0，偏导存在。' },
        { sample: 'F1', theta: 45, k: 0, dur: 1.6, text: '换成 45° 的直线：截线在 P 处断开。' },
        { sample: 'F1', theta: 45, k: 7, dur: 3.2, text: '离 P 再近，高度仍是 0.5，不趋于 f(P)=0。' },
        { sample: 'F1', theta: 45, k: 7, dur: 0, text: '所以：偏导存在，推不出连续。' },
        { sample: 'F2', theta: 0, k: 0, dur: 1.6, text: 'F2 = √(x²+y²)：处处连续，但 P 处是折角。' },
        { sample: 'F2', theta: 0, k: 7, dur: 3.2, text: '放大后折角还在：左斜率 −1，右斜率 +1。' },
        { sample: 'F2', theta: 0, k: 7, dur: 0, text: '所以：连续，推不出偏导存在。' }
      ]
    },
    advanced: {
      start: { theta: 20, k: 0 },
      steps: [
        { sample: 'F3', theta: 0, k: 0, dur: 1.2, text: 'F3 = xy/√(x²+y²)：先看坐标轴方向。' },
        { sample: 'F3', theta: 45, k: 0, dur: 1.6, text: '沿 45°：截线在 P 有折角，两侧斜率为 −0.5 与 +0.5。' },
        { sample: 'F3', theta: 45, k: 7, dur: 3.2, text: '放大后折角不变：误差比恒为 0.5，不可微。' },
        { sample: 'F4', theta: 0, k: 0, dur: 1.6, text: 'F4 = (x²+y²)·sin(1/√(x²+y²))：函数值很小。' },
        { sample: 'F4', theta: 0, k: 7, dur: 3.2, text: '放大后误差比趋于 0：在 P 处可微。' },
        { sample: 'F4', theta: 0, k: 8.5, dur: 3.0, text: '但切线斜率在 P 附近来回摆动：偏导不连续。' },
        { sample: 'F0', theta: 0, k: 0, dur: 2.0, text: 'F0 光滑：偏导连续 ⇒ 可微 ⇒ 偏导存在且连续。' }
      ]
    }
  };

  var BLIND_TEXT = '盲测：先看图判断，按 R 揭晓。';

  /* ---------- 基本函数：所有数值都由这里算出 ---------- */

  function byId(id) {
    return BY_ID[id];
  }

  function rho(k) {
    return RHO0 * Math.pow(2, -k);
  }

  function dirOf(thetaDeg) {
    var a = thetaDeg * DEG;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  // 曲面高度，P 处为 0
  function value(id, x, y) {
    return BY_ID[id].f(x, y);
  }

  // 截线上距离 t 处的高度（t 带符号）
  function lineValue(id, thetaDeg, t) {
    var u = dirOf(thetaDeg);
    return value(id, t * u.x, t * u.y);
  }

  // 割线斜率 g(t)/t：t 取负值时就是另一侧的割线；t=0 没有定义
  function secant(id, thetaDeg, t) {
    if (t === 0) return null;
    return lineValue(id, thetaDeg, t) / t;
  }

  // 截线在 t 处的斜率 g'(t) = ∇f(t·u)·u，用来观察偏导在 P 附近的取值
  function lineSlope(id, thetaDeg, t) {
    if (t === 0) return null;
    var u = dirOf(thetaDeg);
    var g = BY_ID[id].grad(t * u.x, t * u.y);
    return g ? g.x * u.x + g.y * u.y : null;
  }

  // 候选切平面在这条直线上的斜率 ∇f(P)·u；偏导不存在时为 null
  function tangentSlope(id, thetaDeg) {
    var g = BY_ID[id].gradAtP;
    if (!g) return null;
    var u = dirOf(thetaDeg);
    return g.x * u.x + g.y * u.y;
  }

  // P 处的两侧导数（沿这条直线）：t→0⁻ 与 t→0⁺ 的值
  function sliceSlopes(id, thetaDeg) {
    return BY_ID[id].sliceSlopes(thetaDeg * DEG);
  }

  // 坐标轴方向的偏导 f_x 或 f_y；两侧不一致或不存在时为 null
  function partialAt(id, axis) {
    var s = sliceSlopes(id, axis === 'x' ? 0 : 90);
    return s.twoSided ? s.left : null;
  }

  // 沿这条直线靠近 P 时的高度极限（P 处断开时，它与 f(P) 不同）
  function limitAlong(id, thetaDeg) {
    return lineValue(id, thetaDeg, 1e-9);
  }

  // 所有方向上 |f − L| 的最大值，距离 d>0；偏导不存在时为 null
  function errorAbs(id, d) {
    var s = BY_ID[id];
    if (!s.gradAtP || !(d > 0)) return null;
    var g = s.gradAtP;
    var best = 0;
    for (var k = 0; k < DIRS.length; k++) {
      var x = d * DIRS[k].x;
      var y = d * DIRS[k].y;
      var e = Math.abs(s.f(x, y) - (g.x * x + g.y * y));
      if (e > best) best = e;
    }
    return best;
  }

  // 误差比：误差 / 距离。可微的充要条件是它随 d→0 趋于 0
  function errorRatio(id, d) {
    var e = errorAbs(id, d);
    return e === null ? null : e / d;
  }

  // 集合区域（嵌套：偏导连续 ⊂ 可微 ⊂ 偏导存在∩连续）
  function region(id) {
    var t = BY_ID[id].truth;
    if (t.A && t.B) {
      if (t.D) return t.C ? 'C' : 'D';
      return 'AB';
    }
    if (t.A) return 'A';
    if (t.B) return 'B';
    return 'none';
  }

  // 方向是否落在坐标轴上（0°、90°、180°、270°）
  function isAxis(thetaDeg) {
    var r = ((thetaDeg % 90) + 90) % 90;
    return r < 0.5 || r > 89.5;
  }

  // 把手靠近坐标轴时吸附过去（磁吸），并限制在 [0°, 180°]
  function snapTheta(thetaDeg) {
    var t = Math.min(180, Math.max(0, thetaDeg));
    var stops = [0, 90, 180];
    for (var i = 0; i < stops.length; i++) {
      if (Math.abs(t - stops[i]) < 2) return stops[i];
    }
    return t;
  }

  root.PDModel = Object.freeze({
    TAU: TAU,
    RHO0: RHO0,
    K_MAX: K_MAX,
    REVEAL_RHO: REVEAL_RHO,
    DIR_COUNT: DIR_COUNT,
    samples: SAMPLES,
    order: ORDER,
    byId: BY_ID,
    CONCEPTS: CONCEPTS,
    IMPLICATIONS: IMPLICATIONS,
    TOURS: TOURS,
    BLIND_TEXT: BLIND_TEXT,
    rho: rho,
    value: value,
    lineValue: lineValue,
    secant: secant,
    lineSlope: lineSlope,
    tangentSlope: tangentSlope,
    sliceSlopes: sliceSlopes,
    partialAt: partialAt,
    limitAlong: limitAlong,
    errorAbs: errorAbs,
    errorRatio: errorRatio,
    region: region,
    isAxis: isAxis,
    snapTheta: snapTheta
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
