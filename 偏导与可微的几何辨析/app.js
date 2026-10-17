/* 偏导与可微的几何辨析 · 页面层
 * 数学与内容在 model.js（window.PDModel）；这里只负责画图、判定揭晓、导览与交互。
 * 唯一的数据来源是 state：画面每次都由 state 直接算出（时刻驱动）。导览与自动缩放只是
 * 改写 state 的不同方式，手动操作一动就中断它们，把控制权交还给学生。 */
(function () {
  'use strict';

  var M = window.PDModel;
  var HAS_GSAP = typeof window.gsap !== 'undefined';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MINUS = '−';

  var CENTER = 260;     // 绘图中心（viewBox 单位）
  var HALF = 226;       // 窗口半宽对应的像素（窗口为 ±ρ）
  var NCURVE = 180;     // 每侧截线采样点数
  var NBAND = 48;       // 误差带的节点数
  var SPARK_N = 16;     // 切线斜率序列的点数
  var SPARK_MAX = 1.2;  // 切线斜率纵轴范围 ±1.2
  var CHIP_ORDER = ['A', 'B', 'D', 'C'];
  var DOT_POS = { C: [180, 162], D: [180, 206], AB: [180, 45], A: [60, 130], B: [300, 130] };

  var reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  var state = {
    sample: 'F1',
    theta: 20,
    k: 0,
    blind: false,
    reduced: !!(reduceQuery && reduceQuery.matches),
    fs: 1,
    narration: ''
  };

  // 判定揭晓：每个样本单独记录；A 在把手到达坐标轴时揭晓，B、C、D 在 ρ 缩到阈值以内时揭晓
  var reveal = {};
  M.order.forEach(function (id) { reveal[id] = { A: false, B: false, C: false, D: false }; });

  var tour = { choice: 'entry', built: null, tl: null, index: -1, speed: 1 };
  var autoTL = null;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    stage: $('stage'),
    plot: $('plot'),
    band: $('band'),
    secR: $('secR'),
    secL: $('secL'),
    tangent: $('tangent'),
    curveR: $('curveR'),
    curveL: $('curveL'),
    limit: $('limit'),
    edge: $('edge'),
    dot: $('dot'),
    dotLabel: $('dot').querySelector('text'),
    spark: $('spark'),
    sparkTan: $('sparkTan'),
    sparkDots: $('sparkDots'),
    rhoRead: $('rhoRead'),
    secP: $('secP'),
    secN: $('secN'),
    tanRead: $('tanRead'),
    errRead: $('errRead'),
    formula: $('formula'),
    hint: $('hint'),
    progress: $('progressFill'),
    theta: $('theta'),
    thetaVal: $('thetaVal'),
    zoom: $('zoom'),
    zoomVal: $('zoomVal'),
    samples: $('samples'),
    auto: $('auto'),
    blind: $('blind'),
    motion: $('motion'),
    fontDown: $('fontDown'),
    fontUp: $('fontUp'),
    help: $('helpBtn'),
    keys: $('keys'),
    tourPlay: $('tourPlay'),
    tourPrev: $('tourPrev'),
    tourNext: $('tourNext'),
    tourReplay: $('tourReplay'),
    tourKind: $('tourKind'),
    tourSpeed: $('tourSpeed'),
    notice: $('notice'),
    chips: {}
  };
  CHIP_ORDER.forEach(function (c) {
    el.chips[c] = document.querySelector('#verdicts li[data-c="' + c + '"]');
  });

  // 切线斜率序列的圆点：先建正向（蓝实心），再建反向（描边圆），反向盖在上面便于比对
  var sparkR = [];
  var sparkL = [];
  (function buildSpark() {
    for (var j = 0; j < SPARK_N; j++) {
      var cr = document.createElementNS(SVG_NS, 'circle');
      cr.setAttribute('r', '3');
      cr.setAttribute('class', 'spark-r');
      el.sparkDots.appendChild(cr);
      sparkR.push(cr);
    }
    for (var i = 0; i < SPARK_N; i++) {
      var cl = document.createElementNS(SVG_NS, 'circle');
      cl.setAttribute('r', '3.4');
      cl.setAttribute('class', 'spark-l');
      el.sparkDots.appendChild(cl);
      sparkL.push(cl);
    }
  })();

  /* ---------- 小工具 ---------- */

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function setAttr(node, name, value) {
    var v = String(value);
    if (node.getAttribute(name) !== v) node.setAttribute(name, v);
  }

  function setClass(node, cls) {
    if (node.getAttribute('class') !== cls) node.setAttribute('class', cls);
  }

  // SVG 元素没有 hidden 的 DOM 接口，统一用属性开关
  function setHidden(node, hidden) {
    node.toggleAttribute('hidden', hidden);
  }

  function setValue(input, value) {
    if (input.value !== value) input.value = value;
  }

  // 带符号的小数；接近 0 时不显示负号
  function sgn(v, digits) {
    if (v === null || !isFinite(v)) return '—';
    var r = Number(v.toFixed(digits));
    if (r === 0) return (0).toFixed(digits);
    return (r < 0 ? MINUS : '+') + Math.abs(r).toFixed(digits);
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function f2(v) {
    return v.toFixed(2);
  }

  /* ---------- 绘制：截线、切线、误差带与读数 ---------- */

  // 误差带的节点只与样本和 ρ 有关，与方向无关；缓存起来，导览与缩放时不重复计算
  var envCache = { key: '', nodes: null };

  function envelope(id, rho) {
    var key = id + '|' + rho;
    if (envCache.key !== key) {
      var nodes = [];
      for (var j = 0; j < NBAND; j++) nodes.push(M.errorAbs(id, rho * (j + 1) / NBAND));
      envCache = { key: key, nodes: nodes };
    }
    return envCache.nodes;
  }

  // 节点 j 对应距离 ρ·(j+1)/NBAND；两端之外取最近的节点
  function envAt(nodes, d, rho) {
    var x = d / rho * NBAND - 1;
    if (x <= 0) return nodes[0];
    if (x >= NBAND - 1) return nodes[NBAND - 1];
    var i = Math.floor(x);
    var w = x - i;
    return nodes[i] * (1 - w) + nodes[i + 1] * w;
  }

  function drawPlot(s, rho) {
    var th = state.theta;
    var sx = function (t) { return CENTER + (t / rho) * HALF; };
    var sy = function (v) { return CENTER - (v / rho) * HALF; };

    var right = [];
    var left = [];
    for (var i = 0; i < NCURVE; i++) {
      var t = rho * (i + 0.5) / NCURVE;
      right.push(f2(sx(t)) + ' ' + f2(sy(M.lineValue(s.id, th, t))));
      left.push(f2(sx(-t)) + ' ' + f2(sy(M.lineValue(s.id, th, -t))));
    }
    setAttr(el.curveR, 'd', 'M' + right.join(' L'));
    setAttr(el.curveL, 'd', 'M' + left.join(' L'));

    // 割线：从 P 连到 ±ρ 处的截线，斜率即读数里的正向与反向割线
    var vR = M.lineValue(s.id, th, rho);
    var vL = M.lineValue(s.id, th, -rho);
    setAttr(el.secR, 'd', 'M' + CENTER + ' ' + CENTER + ' L' + f2(sx(rho)) + ' ' + f2(sy(vR)));
    setAttr(el.secL, 'd', 'M' + CENTER + ' ' + CENTER + ' L' + f2(sx(-rho)) + ' ' + f2(sy(vL)));

    // 切线与误差带：偏导存在时才有；误差带是所有方向上 |f − L| 的包络
    var T = M.tangentSlope(s.id, th);
    setHidden(el.band, T === null);
    setHidden(el.tangent, T === null);
    if (T !== null) {
      var env = envelope(s.id, rho);
      var up = [];
      var dn = [];
      for (var j = -NCURVE; j <= NCURVE; j++) {
        var tt = rho * j / NCURVE;
        var e = envAt(env, Math.abs(tt), rho);
        up.push(f2(sx(tt)) + ' ' + f2(sy(T * tt + e)));
        dn.push(f2(sx(tt)) + ' ' + f2(sy(T * tt - e)));
      }
      setAttr(el.band, 'points', up.concat(dn.reverse()).join(' '));
      setAttr(el.tangent, 'x1', f2(sx(-rho)));
      setAttr(el.tangent, 'y1', f2(sy(-T * rho)));
      setAttr(el.tangent, 'x2', f2(sx(rho)));
      setAttr(el.tangent, 'y2', f2(sy(T * rho)));
    }

    // P 处断开：沿这条直线的极限若与 f(P)=0 不同，画一个空心圆标出极限高度
    var lim = M.limitAlong(s.id, th);
    var limIn = Math.abs(lim) > 1e-6 && Math.abs(lim) <= rho;
    setHidden(el.limit, !limIn);
    if (limIn) setAttr(el.limit, 'cy', f2(sy(lim)));

    // 超出窗口的高度用红色箭头标在画面顶部或底部
    var outs = [vR, vL, lim].filter(function (v) { return Math.abs(v) > rho; });
    setHidden(el.edge, !outs.length);
    if (outs.length) {
      var big = outs.reduce(function (a, b) { return Math.abs(b) > Math.abs(a) ? b : a; });
      setText(el.edge, (big > 0 ? '↑ ' : '↓ ') + sgn(big, 3) + ' 超出画面');
    }
  }

  function drawSpark(s, rho) {
    var th = state.theta;
    var y = function (v) { return 60 - (v / SPARK_MAX) * 52; };
    var x = function (j) { return 16 + (j / (SPARK_N - 1)) * 248; };
    for (var j = 0; j < SPARK_N; j++) {
      // 距离按 2^(−j/2) 递减：每两格缩小一半，由远及近
      var t = rho * Math.pow(2, -j / 2);
      setAttr(sparkR[j], 'cx', f2(x(j)));
      setAttr(sparkR[j], 'cy', f2(y(M.lineSlope(s.id, th, t))));
      setAttr(sparkL[j], 'cx', f2(x(j)));
      setAttr(sparkL[j], 'cy', f2(y(M.lineSlope(s.id, th, -t))));
    }
    var T = M.tangentSlope(s.id, th);
    setHidden(el.sparkTan, T === null);
    if (T !== null) {
      setAttr(el.sparkTan, 'y1', f2(y(T)));
      setAttr(el.sparkTan, 'y2', f2(y(T)));
    }
  }

  function drawReadout(s, rho) {
    var th = state.theta;
    setText(el.rhoRead, rho.toFixed(4));
    setText(el.secP, sgn(M.secant(s.id, th, rho), 3));
    setText(el.secN, sgn(M.secant(s.id, th, -rho), 3));
    var T = M.tangentSlope(s.id, th);
    setText(el.tanRead, T === null ? '无' : sgn(T, 3));
    var er = M.errorRatio(s.id, rho);
    var erText;
    if (state.blind) erText = '盲测中';
    else if (er === null) erText = '无切平面';
    else erText = er.toFixed(er < 10 ? 3 : 1);
    setText(el.errRead, erText);
  }

  /* ---------- 判定、集合图、提示 ---------- */

  function drawVerdicts(s) {
    var r = reveal[s.id];
    CHIP_ORDER.forEach(function (c) {
      var li = el.chips[c];
      var known = !state.blind && r[c];
      var cls = !known ? 'is-unknown' : (s.truth[c] ? 'is-true' : 'is-false');
      var glyph = !known ? '?' : (s.truth[c] ? '✓' : '✗');
      var word = !known ? '未测' : (s.truth[c] ? '成立' : '不成立');
      setClass(li, 'verdict ' + cls);
      setText(li.querySelector('.glyph'), glyph);
      setText(li.querySelector('.state'), word);
    });
  }

  // 集合图上的点只在四个概念都揭晓后出现，位置由区域决定
  function drawSets(s) {
    var r = reveal[s.id];
    var all = r.A && r.B && r.C && r.D && !state.blind;
    var pos = DOT_POS[M.region(s.id)];
    setHidden(el.dot, !all || !pos);
    if (!all || !pos) return;
    setAttr(el.dot, 'transform', 'translate(' + pos[0] + ' ' + pos[1] + ')');
    setText(el.dotLabel, s.id);
  }

  function hintInfo(s) {
    if (state.blind) return { text: M.BLIND_TEXT, kind: 'blind' };
    if (state.narration) return { text: state.narration, kind: 'tour' };
    var r = reveal[s.id];
    if (!r.A) return { text: s.text.axis, kind: 'hint' };
    if (!r.B) return { text: s.text.zoom, kind: 'hint' };
    return { text: s.text.result, kind: 'result' };
  }

  function drawHint(s) {
    var info = hintInfo(s);
    setText(el.hint, info.text);
    setClass(el.hint, 'hint is-' + info.kind);
  }

  function drawControls(s, rho) {
    setValue(el.theta, String(Math.round(state.theta)));
    setText(el.thetaVal, Math.round(state.theta) + '°');
    setValue(el.zoom, state.k.toFixed(2));
    setText(el.zoomVal, 'ρ = ' + rho.toFixed(4));
    setText(el.formula, s.id + '　' + s.formula);
    el.samples.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === state.sample));
    });
    el.blind.setAttribute('aria-pressed', String(state.blind));
    el.motion.setAttribute('aria-pressed', String(state.reduced));
  }

  /* ---------- 渲染入口 ---------- */

  // 画面只由 state 决定；揭晓是对 state 的一次性记录，不回头影响画面
  function updateReveal(rho) {
    if (state.blind) return;
    var r = reveal[state.sample];
    if (M.isAxis(state.theta)) r.A = true;
    if (rho <= M.REVEAL_RHO) r.B = r.C = r.D = true;
  }

  // 标签页在后台时浏览器会暂停 requestAnimationFrame，改用定时器，保证 DOM 仍与 state 一致
  var renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    var run = function () {
      renderQueued = false;
      render();
    };
    if (document.hidden) setTimeout(run, 16);
    else requestAnimationFrame(run);
  }

  function render() {
    var s = M.byId[state.sample];
    var rho = M.rho(state.k);
    updateReveal(rho);
    drawPlot(s, rho);
    drawSpark(s, rho);
    drawReadout(s, rho);
    drawVerdicts(s);
    drawSets(s);
    drawHint(s);
    drawControls(s, rho);
    scheduleHash();
  }

  /* ---------- 地址栏：replaceState 写回，不增加历史记录 ---------- */

  var hashTimer = 0;
  function scheduleHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(writeHash, 300);
  }

  function writeHash() {
    try {
      var q = new URLSearchParams({
        s: state.sample,
        a: String(Math.round(state.theta)),
        z: state.k.toFixed(2)
      });
      history.replaceState(null, '', '#' + q.toString());
    } catch (e) {
      // 某些本地环境不允许改写地址，演示照常可用
    }
  }

  function readHash() {
    try {
      var p = new URLSearchParams(location.hash.slice(1));
      var s = p.get('s');
      if (s && M.byId[s]) state.sample = s;
      if (p.has('a')) {
        var a = Number(p.get('a'));
        if (isFinite(a)) state.theta = M.snapTheta(a);
      }
      if (p.has('z')) {
        var z = Number(p.get('z'));
        if (isFinite(z)) state.k = clamp(z, 0, M.K_MAX);
      }
    } catch (e) {
      // 非法地址回退默认值
    }
  }

  /* ---------- 手动操作：每个入口都先中断导览与自动缩放 ---------- */

  function setSample(id, user) {
    if (!M.byId[id]) return;
    if (user) stopTour();
    state.sample = id;
    requestRender();
  }

  function cycleSample(d) {
    var i = M.order.indexOf(state.sample);
    var n = M.order.length;
    setSample(M.order[(i + d + n) % n], true);
  }

  function setTheta(value, user) {
    if (user) stopTour();
    state.theta = M.snapTheta(value);
    requestRender();
  }

  function setZoom(value, user) {
    if (user) {
      stopAuto();
      stopTour();
    }
    state.k = clamp(value, 0, M.K_MAX);
    requestRender();
  }

  function adjustFont(delta) {
    state.fs = Math.round(clamp(state.fs + delta, 0.8, 1.6) * 10) / 10;
    document.documentElement.style.setProperty('--fs', String(state.fs));
  }

  function toggleHelp() {
    el.keys.hidden = !el.keys.hidden;
    el.help.setAttribute('aria-pressed', String(!el.keys.hidden));
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
      return;
    }
    if (el.stage.requestFullscreen) el.stage.requestFullscreen().catch(function () {});
  }

  function resetView() {
    stopTour();
    stopAuto();
    state.theta = 20;
    state.k = 0;
    reveal[state.sample] = { A: false, B: false, C: false, D: false };
    requestRender();
  }

  function toggleBlind() {
    state.blind = !state.blind;
    if (state.blind) {
      stopTour();
    } else {
      // 揭晓：关掉盲测时，当前样本的四个判定一起显示
      var r = reveal[state.sample];
      r.A = r.B = r.C = r.D = true;
    }
    setText(el.blind, state.blind ? '盲测中（R 揭晓）' : '盲测（R）');
    requestRender();
  }

  function toggleMotion() {
    state.reduced = !state.reduced;
    stopTour();
    if (state.reduced) stopAuto();
    applyCapabilities();
    requestRender();
  }

  /* ---------- 自动缩放（空格）：往返于 ρ 的整个范围 ---------- */

  function setAutoButton() {
    var on = !!autoTL;
    setText(el.auto, on ? '停止缩放（空格）' : '自动缩放（空格）');
    el.auto.setAttribute('aria-pressed', String(on));
  }

  function startAuto() {
    if (!HAS_GSAP || state.reduced) return;
    stopTour();
    stopAuto();
    autoTL = window.gsap.to(state, {
      k: M.K_MAX,
      duration: Math.max(1, (M.K_MAX - state.k) * 1.2),
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
      onUpdate: requestRender
    });
    setAutoButton();
  }

  function stopAuto() {
    if (!autoTL) return;
    autoTL.kill();
    autoTL = null;
    setAutoButton();
  }

  function toggleAuto() {
    if (autoTL) stopAuto();
    else startAuto();
  }

  /* ---------- 导览：GSAP 时间线只推进时刻，画面由时刻对应的 state 决定 ---------- */

  // 旁白停留：字数 × 0.2 s + 1.2 s，至少 2.4 s（设计方案 §7）
  function holdFor(text) {
    return Math.max(2.4, [...text].length * 0.2 + 1.2);
  }

  function buildTour(kind) {
    var spec = M.TOURS[kind];
    var tl = window.gsap.timeline({ paused: true, onUpdate: onTourTick, onComplete: setTourButtons });
    var prev = spec.start;
    spec.steps.forEach(function (st, i) {
      tl.addLabel('s' + i);
      // 每段的起点是上一段的终点，因此任意时刻跳转都得到确定的状态
      tl.fromTo(
        state,
        { theta: prev.theta, k: prev.k },
        {
          theta: st.theta,
          k: st.k,
          duration: state.reduced ? 0 : st.dur,
          ease: 'sine.inOut',
          immediateRender: false,
          onUpdate: requestRender
        }
      );
      tl.to({}, { duration: holdFor(st.text) });
      prev = st;
    });
    tl.addLabel('end');
    return tl;
  }

  function ensureTimeline(kind) {
    if (tour.tl && tour.built === kind) return tour.tl;
    if (tour.tl) tour.tl.kill();
    tour.tl = buildTour(kind);
    tour.built = kind;
    tour.tl.timeScale(tour.speed);
    return tour.tl;
  }

  function onTourTick() {
    var tl = tour.tl;
    if (!tl) return;
    var steps = M.TOURS[tour.built].steps;
    var t = tl.time();
    var idx = 0;
    for (var i = 0; i < steps.length; i++) {
      if (t >= tl.labels['s' + i] - 1e-6) idx = i;
    }
    var st = steps[idx];
    tour.index = idx;
    if (state.sample !== st.sample) state.sample = st.sample;
    if (state.narration !== st.text) state.narration = st.text;
    el.progress.style.transform = 'scaleX(' + tl.progress().toFixed(4) + ')';
    setTourButtons();
    requestRender();
  }

  function setTourButtons() {
    var tl = tour.tl;
    var running = !!tl && !tl.paused() && tl.progress() < 1;
    var finished = !!tl && tl.progress() >= 1;
    setText(el.tourPlay, running ? '暂停' : finished ? '重播' : '播放导览');
    el.tourPlay.setAttribute('aria-pressed', String(running));
    el.tourKind.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-kind') === tour.choice));
    });
    el.tourSpeed.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-speed')) === tour.speed));
    });
  }

  function stopTour() {
    if (tour.tl) tour.tl.kill();
    tour.tl = null;
    tour.built = null;
    tour.index = -1;
    el.progress.style.transform = 'scaleX(0)';
    state.narration = '';
    setTourButtons();
    requestRender();
  }

  function startTour(kind) {
    if (!HAS_GSAP) return;
    stopAuto();
    tour.choice = kind;
    var spec = M.TOURS[kind];
    state.theta = spec.start.theta;
    state.k = spec.start.k;
    state.sample = spec.steps[0].sample;
    var tl = ensureTimeline(kind);
    tl.pause(0, false);
    onTourTick();
    tl.play();
    setTourButtons();
  }

  function togglePlay() {
    if (!HAS_GSAP) return;
    if (!tour.tl || tour.built !== tour.choice) {
      startTour(tour.choice);
      return;
    }
    if (tour.tl.progress() >= 1) {
      startTour(tour.choice);
      return;
    }
    if (tour.tl.paused()) {
      stopAuto();
      tour.tl.play();
    } else {
      tour.tl.pause();
    }
    setTourButtons();
  }

  // 上一步、下一步：跳到对应关键帧的起点（无动画引擎时直接设定终态）
  function stepTour(delta) {
    var kind = tour.choice;
    var steps = M.TOURS[kind].steps;
    var cur = tour.index >= 0 ? tour.index : (delta > 0 ? -1 : steps.length);
    var idx = clamp(cur + delta, 0, steps.length - 1);
    stopAuto();
    if (!HAS_GSAP) {
      var st = steps[idx];
      state.sample = st.sample;
      state.theta = st.theta;
      state.k = st.k;
      state.narration = st.text;
      tour.index = idx;
      requestRender();
      return;
    }
    var tl = ensureTimeline(kind);
    tl.pause();
    // 该步的起点 = 上一步的终点；时间没有变化时 GSAP 不回调，所以跳转后直接按时刻应用一次
    var from = idx === 0 ? M.TOURS[kind].start : M.TOURS[kind].steps[idx - 1];
    state.theta = from.theta;
    state.k = from.k;
    tl.seek('s' + idx, false);
    onTourTick();
    setTourButtons();
  }

  /* ---------- 动效与能力降级 ---------- */

  function applyCapabilities() {
    if (!HAS_GSAP) {
      el.notice.hidden = false;
      setText(el.notice, '动画引擎未加载：导览与自动缩放不可用；滑块、单步与键盘仍可用。');
      el.tourPlay.disabled = true;
      el.auto.disabled = true;
      return;
    }
    el.tourPlay.disabled = false;
    if (state.reduced) {
      el.notice.hidden = false;
      setText(el.notice, '减少动效已开启：导览直接跳到每一步；自动缩放停用，请用 ↑ ↓ 逐级缩放。');
      el.auto.disabled = true;
    } else {
      el.notice.hidden = true;
      el.auto.disabled = false;
    }
  }

  /* ---------- 事件 ---------- */

  function onKey(e) {
    var target = e.target instanceof Element ? e.target : null;
    if (e.key === 'Escape') {
      stopTour();
      stopAuto();
      if (!el.keys.hidden) toggleHelp();
      return;
    }
    // 焦点在表单控件上时不抢键（滑块自己处理方向键）
    if (target && target.closest('input, select, textarea, button, a, [contenteditable="true"]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    var code = e.code;
    if (/^Digit[1-5]$/.test(code)) {
      e.preventDefault();
      setSample(M.order[Number(code.slice(-1)) - 1], true);
      return;
    }
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      e.preventDefault();
      var d = code === 'ArrowLeft' ? -1 : 1;
      if (e.shiftKey) setTheta(state.theta + 5 * d, true);
      else cycleSample(d);
      return;
    }
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      e.preventDefault();
      setZoom(state.k + (code === 'ArrowUp' ? -0.25 : 0.25), true);
      return;
    }
    if (code === 'Space') {
      e.preventDefault();
      toggleAuto();
      return;
    }
    if (code === 'KeyG' || code === 'KeyT') {
      var kind = code === 'KeyG' ? 'entry' : 'advanced';
      if (!HAS_GSAP) return;
      if (tour.tl && tour.built === kind) togglePlay();
      else startTour(kind);
      return;
    }
    if (code === 'KeyR') return toggleBlind();
    if (code === 'KeyZ') return resetView();
    if (code === 'KeyF') return toggleFullscreen();
    if (e.key === '+' || e.key === '=') return adjustFont(0.1);
    if (e.key === '-' || e.key === '−' || e.key === '_') return adjustFont(-0.1);
    if (e.key === '?') return toggleHelp();
  }

  function bindEvents() {
    el.samples.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (b) setSample(b.getAttribute('data-id'), true);
    });
    el.theta.addEventListener('input', function () {
      setTheta(Number(el.theta.value), true);
    });
    el.zoom.addEventListener('input', function () {
      setZoom(Number(el.zoom.value), true);
    });
    el.auto.addEventListener('click', toggleAuto);
    el.blind.addEventListener('click', toggleBlind);
    el.motion.addEventListener('click', toggleMotion);
    el.fontDown.addEventListener('click', function () { adjustFont(-0.1); });
    el.fontUp.addEventListener('click', function () { adjustFont(0.1); });
    el.help.addEventListener('click', toggleHelp);

    el.tourPlay.addEventListener('click', togglePlay);
    el.tourPrev.addEventListener('click', function () { stepTour(-1); });
    el.tourNext.addEventListener('click', function () { stepTour(1); });
    el.tourReplay.addEventListener('click', function () { startTour(tour.choice); });
    el.tourKind.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-kind]');
      if (!b) return;
      var kind = b.getAttribute('data-kind');
      if (kind !== tour.choice) {
        stopTour();
        tour.index = -1;
      }
      tour.choice = kind;
      setTourButtons();
    });
    el.tourSpeed.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-speed]');
      if (!b) return;
      tour.speed = Number(b.getAttribute('data-speed'));
      if (tour.tl) tour.tl.timeScale(tour.speed);
      setTourButtons();
    });

    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) return;
      if (tour.tl && !tour.tl.paused()) tour.tl.pause();
      if (autoTL) autoTL.pause();
      setTourButtons();
    });
  }

  /* ---------- 启动 ---------- */

  function init() {
    readHash();
    bindEvents();
    applyCapabilities();
    setTourButtons();
    setAutoButton();
    adjustFont(0);
    render();
  }

  init();
})();
