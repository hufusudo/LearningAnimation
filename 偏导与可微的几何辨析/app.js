/* 页面控制器：数学在model.js，导览完整状态在choreo.js。
 * GSAP只推进clock.t；所有导览画面由同一时刻重建。 */
(function () {
  'use strict';
  const M = window.PDModel, C = window.PDChoreo;
  const hasGSAP = !!window.gsap;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const text = (node, value) => { if (node.textContent !== String(value)) node.textContent = value; };
  const attr = (id, name, value) => $(id).setAttribute(name, String(value));
  const hide = (id, value) => $(id).toggleAttribute('hidden', value);
  const fmt = (v, n = 3) => v === null || !Number.isFinite(v) ? '—' : (Math.abs(v) < 0.5 * Math.pow(10, -n) ? 0 : v).toFixed(n).replace('-', '−');
  const readRatio = value => value === null ? '—' : value !== 0 && Math.abs(value) < 0.001 ? value.toPrecision(2) : fmt(value, value > 10 ? 1 : 3);
  const signed = (v, n = 3) => v !== null && v > 0.5 * Math.pow(10, -n) ? '+' + fmt(v, n) : fmt(v, n);
  const emptyKnown = () => ({ A: false, B: false, C: false, D: false });
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = { sample: 'F1', theta: 20, k: 0, known: emptyKnown(), blind: false, reduced: media.matches, fs: 1 };
  const clock = { t: 0 };
  let kind = 'entry', speed = 1, seq, guided = false, playing = false;
  let tween = null, delayed = null, auto = null, frame = 0, hashTimer = 0;
  let reducedOverride = false;
  const PROOFS = {
    F1: '沿 45°，f = 1/2 ≠ f(P)，故不连续；两坐标轴上 f 恒为 0。',
    F2: '|f| = r → 0；坐标轴上 g(t) = |t|，两侧差商极限不同。',
    F3: '|f| ≤ r/2 保证连续；全方向误差比恒为 1/2。偏导存在但不连续。',
    F4: '误差比 ≤ r → 0；x 轴上两列非零点的偏导分别为 −1、+1，均不趋于原点的 0。',
    F0: '三角函数的两个偏导在邻域内连续，故在 P 可微；图上数值仅为取样。'
  };
  const RESULTS = {
    F1: '偏导存在，不能推出连续。', F2: '连续，不能推出偏导存在。',
    F3: '连续且偏导存在，仍然不够可微。', F4: '可微，不能推出偏导连续。', F0: '偏导连续 ⇒ 可微 ⇒ 连续且偏导存在。'
  };
  const DOT = { A: [60, 130], B: [300, 130], AB: [180, 45], D: [180, 206], C: [180, 162] };
  const scene = window.PDScene.create($('sceneHost'));
  const flags = { surface: true, cut: true, plane: true };

  function build() {
    seq = C.build(M.TOURS[kind]);
    $('steps').replaceChildren(...seq.steps.map((step, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.step = i;
      b.textContent = (i + 1) + ' ' + step.target.title;
      b.setAttribute('aria-label', '第' + (i + 1) + '步：' + step.target.title);
      b.addEventListener('click', () => seek(step.end));
      return b;
    }));
    $('progress').max = seq.duration;
  }

  function view() {
    if (guided) return C.sample(seq, clock.t, state.reduced);
    return { ...state, alpha: 1, textAlpha: 1, receiptAlpha: 0, tag: null, focus: null,
      title: '自由探索', text: '', index: -1, progress: 1 };
  }

  function drawReadings(v, rho) {
    text($('secN'), signed(M.secant(v.sample, v.theta, -rho)));
    text($('secP'), signed(M.secant(v.sample, v.theta, rho)));
    const rQ = rho * 0.72;
    const ratio = M.errorRatio(v.sample, rQ);
    const L = M.tangentSlope(v.sample, v.theta);
    const local = L === null ? null : Math.abs(M.lineValue(v.sample, v.theta, rQ) - L * rQ) / rQ;
    text($('localErr'), readRatio(local));
    text($('globalLabel'), v.sample === 'F0' ? '同距离 · 方向取样最大值' : '同距离 · 全方向最坏比值');
    text($('errRead'), ratio === null ? '—' : (v.sample === 'F0' ? '≈ ' : '') + readRatio(ratio));
    const note = {
      F1: '同距离 r = 0.72ρ；最坏比值为 1/(2r)。', F2: '两偏导不全，无法由偏导构造候选平面 L。',
      F3: '所有方向中，45° 最坏；比值恒为 1/2。', F4: '任意方向的误差比 ≤ r = 0.72ρ；P 处偏导为 0。',
      F0: '全方向读数为 360 方向取样；L = 0.59x。'
    };
    text($('errorNote'), note[v.sample]);
    $('theta').value = v.theta; $('zoom').value = v.k;
    text($('thetaVal'), Math.round(v.theta) + '°'); text($('zoomVal'), 'ρ = ' + fmt(rho, 4));
    text($('rhoRead'), '邻域半径 ρ = ' + fmt(rho, 4));
    text($('scaleRead'), '三轴同比放大 ×' + Math.pow(2, v.k).toFixed(v.k < 2 ? 1 : 0));
    hide('slopeRead', v.sample !== 'F2' && v.focus !== 'slopes');
    document.querySelectorAll('[data-angle]').forEach(b => b.setAttribute('aria-pressed', Math.abs(Number(b.dataset.angle) - v.theta) < 0.1));
  }

  function drawVerdicts(v) {
    const s = M.byId[v.sample];
    const known = v.known;
    for (const c of ['A', 'B', 'D', 'C']) {
      const li = document.querySelector(`[data-c="${c}"]`), yes = known[c] && !state.blind;
      li.className = yes ? s.truth[c] ? 'is-true' : 'is-false' : '';
      text(li.querySelector('.glyph'), yes ? s.truth[c] ? '✓' : '×' : '?');
      text(li.querySelector('.state'), yes ? s.truth[c] ? '成立' : '不成立' : '待揭晓');
    }
    const current = guided ? seq.steps[v.index] : null;
    const revealing = current && current.target.sample === v.sample;
    for (const c of ['A', 'B', 'D', 'C']) {
      const li = document.querySelector(`[data-c="${c}"]`);
      let alpha = 1;
      if (revealing && current.target.reveal.includes(c) && v.progress >= 0.72 && v.progress < 1) {
        alpha = v.progress < 0.8 ? 1 - (v.progress - 0.72) / 0.08 : (v.progress - 0.8) / 0.2;
      }
      li.querySelector('.glyph').style.opacity = alpha;
      li.querySelector('.state').style.opacity = alpha;
    }
    const all = Object.values(known).every(Boolean) && !state.blind;
    text($('proof'), all ? PROOFS[v.sample] : state.blind ? '盲测：先看几何，再自行判断。' : '判定按函数的解析性质揭晓；有限次观察不能充当证明。');
    hide('dot', !all);
    if (all) {
      const pos = DOT[M.region(v.sample)];
      attr('dot', 'transform', `translate(${pos[0]} ${pos[1]})`);
      text($('dot').querySelector('text'), v.sample);
    }
    text($('relationText'), all ? v.sample + '：' + RESULTS[v.sample] : '揭晓当前样本后，查看它所在的区域。');
    text($('reveal'), all ? '收起判定' : '揭晓判定');
  }

  function render() {
    const v = view(), rho = M.rho(v.k), sample = M.byId[v.sample];
    if (!sample) return;
    text($('formula'), v.sample + '  ' + sample.formula);
    text($('originNote'), ['F1', 'F3', 'F4'].includes(v.sample) ? '非原点用上式；原点补定义 f(0,0) = 0' : '原点 f(0,0) = 0');
    drawReadings(v, rho); drawVerdicts(v);
    let narration = v.text, narrationAlpha = v.textAlpha;
    if (guided && !state.reduced) {
      const step = seq.steps[v.index], p = v.progress;
      const leads = { plot: '蓝色平面切开曲面，蓝线就是交线。', direction: '转动蓝色平面，看它与曲面的交线。', error: '同比放大邻域，看曲面能否贴住金色平面。', slopes: '放大锥尖，观察两个方向的斜率。', spark: '比较曲面上附近两条切线与原点的平面。' };
      if (p >= 0.2 && p < 0.8) {
        narration = leads[step.target.focus];
        narrationAlpha = p < 0.4 ? (p - 0.2) / 0.2 : p > 0.72 ? (0.8 - p) / 0.08 : 1;
      } else if (p >= 0.8) { narration = step.target.text; narrationAlpha = (p - 0.8) / 0.2; }
    }
    $('hint').style.opacity = state.blind ? 1 : narrationAlpha;
    const all = Object.values(v.known).every(Boolean);
    text($('hint'), state.blind ? '先选方向，再缩小邻域；想好后按「揭晓判定」。' : guided ? narration || '蓝面切开绿色曲面，交线直接留在曲面上。' : all ? RESULTS[v.sample] : '拖动看曲面；转动蓝面，观察交线怎样靠近 P。');
    const focus = v.focus || (v.sample === 'F4' && Object.values(v.known).every(Boolean) ? 'spark' : 'plot');
    text($('guideKicker'), state.blind ? '先观察，后判断' : ({ plot: '蓝色交线就在曲面上', direction: '剖切平面穿过 P', error: '红线连接曲面与候选平面', slopes: '尖点两边的斜率', spark: v.sample === 'F4' ? '原点偏导 0，附近却是 −1 / +1' : '曲面与候选平面是否贴合' })[focus]);
    text($('eventTag'), state.blind ? '' : v.tag || '');
    $('eventTag').style.opacity = v.receiptAlpha;
    scene.update({ ...v, focus }, flags);
    text($('stageTitle'), guided ? v.title || '观察截线' : '自由探索');
    text($('timeRead'), fmt(clock.t, 1) + 's');
    text($('stepRead'), guided ? '步骤 ' + (v.index + 1) + ' / ' + seq.steps.length : '旋转曲面 · 选方向 · 放大邻域');
    text($('durationRead'), Math.round(clock.t) + ' / ' + Math.round(seq.duration) + ' s');
    $('progress').value = clock.t;
    document.querySelectorAll('[data-step]').forEach(b => {
      if (guided && Number(b.dataset.step) === v.index) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('#samples button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === v.sample));
    attr('stage', 'data-running', playing || !!auto && !auto.paused());
    document.body.dataset.reduced = state.reduced;
    attr('motion', 'aria-pressed', state.reduced); attr('blind', 'aria-pressed', state.blind);
    text($('blind'), state.blind ? '盲测中 · 揭晓' : '盲测');
    text($('tourPlay'), playing ? '暂停' : clock.t >= seq.duration && guided ? '重新播放' : '播放导览');
    attr('tourPlay', 'aria-pressed', playing);
    $('tourPlay').disabled = !hasGSAP;
    $('auto').disabled = !hasGSAP || state.reduced;
    attr('auto', 'aria-pressed', !!auto && !auto.paused());
    text($('auto'), auto ? auto.paused() ? '继续缩放' : '暂停缩放' : '自动缩放');
    hide('notice', hasGSAP && !state.reduced);
    text($('notice'), !hasGSAP ? '动画引擎未加载：播放已停用，单步、进度和参数仍可使用。' : '减少动效：导览按事件逐步显示；方向与缩放仍可手动调整。');
  }

  function scheduleRender() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; render(); });
  }
  function writeHash() {
    clearTimeout(hashTimer);
    const v = view();
    const q = new URLSearchParams({ s: v.sample, a: v.theta.toFixed(2), z: v.k.toFixed(2), mode: guided ? kind : 'free', t: clock.t.toFixed(3) });
    try { history.replaceState(null, '', '#' + q); } catch (_) { /* file宿主禁止改地址时不影响演示 */ }
  }
  function saveLater() { clearTimeout(hashTimer); hashTimer = setTimeout(writeHash, 250); }
  function stopDriver() {
    if (tween) tween.kill(); if (delayed) delayed.kill();
    tween = delayed = null; playing = false;
  }
  function stopAuto() { if (auto) auto.kill(); auto = null; }
  function pause() {
    if (tween) tween.pause(); if (delayed) delayed.pause();
    playing = false; if (auto) auto.pause(); render(); writeHash();
  }
  function leaveTour() {
    const v = view();
    state.sample = v.sample; state.theta = v.theta; state.k = v.k; state.known = { ...v.known };
    guided = false; stopDriver(); stopAuto();
  }
  function seek(t) {
    stopDriver(); stopAuto(); guided = true;
    clock.t = clamp(t, 0, seq.duration); render(); writeHash();
  }
  function step(delta) {
    const v = view();
    const index = guided ? clamp(v.index + delta, 0, seq.steps.length - 1) : delta > 0 ? 0 : seq.steps.length - 1;
    seek(seq.steps[index].end);
  }
  function reducedTick() {
    if (!playing) return;
    const i = view().index;
    if (i >= seq.steps.length - 1) { clock.t = seq.duration; pause(); return; }
    delayed = window.gsap.delayedCall(0.9, () => {
      delayed = null; clock.t = seq.steps[i + 1].end; render(); saveLater(); reducedTick();
    });
    delayed.timeScale(speed);
  }
  function play() {
    if (!hasGSAP) return;
    if (playing) { pause(); return; }
    stopAuto();
    // 暂停保留时间驱动器，恢复时继续当前动作或事件停留。
    if (guided && clock.t < seq.duration && (state.reduced ? delayed : tween)) {
      playing = true; (state.reduced ? delayed : tween).resume(); render(); return;
    }
    if (!guided || clock.t >= seq.duration) { guided = true; clock.t = 0; }
    state.blind = false; playing = true;
    if (state.reduced) { clock.t = seq.steps[view().index].end; render(); reducedTick(); }
    else {
      tween = window.gsap.to(clock, { t: seq.duration, duration: seq.duration - clock.t, ease: 'none',
        onUpdate: () => { render(); saveLater(); }, onComplete: () => { playing = false; tween = null; render(); writeHash(); } });
      tween.timeScale(speed); render();
    }
  }
  function setSample(id) {
    leaveTour(); state.sample = id; state.known = emptyKnown(); clock.t = 0;
    render(); writeHash();
  }
  function reset() {
    leaveTour(); state.theta = 20; state.k = 0; state.known = emptyKnown(); clock.t = 0;
    render(); writeHash();
  }
  function blind() {
    leaveTour(); state.blind = !state.blind;
    if (!state.blind) state.known = { A: true, B: true, C: true, D: true };
    render(); writeHash();
  }
  function motion() {
    const wasPlaying = playing;
    stopDriver(); stopAuto(); state.reduced = !state.reduced; reducedOverride = true;
    if (guided && state.reduced) clock.t = seq.steps[view().index].end;
    render(); writeHash(); if (wasPlaying && !(guided && clock.t >= seq.duration)) play();
  }
  function autoZoom() {
    if (!hasGSAP || state.reduced) return;
    if (auto) { if (auto.paused()) auto.resume(); else auto.pause(); render(); writeHash(); return; }
    leaveTour();
    if (state.k >= M.K_MAX - 0.01) state.k = 0;
    auto = window.gsap.to(state, { k: M.K_MAX, duration: (M.K_MAX - state.k) * 1.2, ease: 'none', repeat: -1, yoyo: true,
      onUpdate: () => { render(); saveLater(); } }); render();
  }
  function font(delta) { state.fs = clamp(Math.round((state.fs + delta) * 10) / 10, 0.8, 1.6); document.documentElement.style.setProperty('--fs', state.fs); }
  function fullScreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if ($('stage').requestFullscreen) $('stage').requestFullscreen().catch(() => {});
  }
  function bind() {
    $('samples').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) setSample(b.dataset.id); });
    $('theta').addEventListener('input', () => { const a = Number($('theta').value); leaveTour(); state.theta = M.snapTheta(a); scheduleRender(); saveLater(); });
    $('zoom').addEventListener('input', () => { const k = Number($('zoom').value); leaveTour(); state.k = k; scheduleRender(); saveLater(); });
    for (const id of ['theta', 'zoom']) $(id).addEventListener('change', writeHash);
    document.querySelectorAll('[data-angle]').forEach(b => b.addEventListener('click', () => { leaveTour(); state.theta = Number(b.dataset.angle); render(); writeHash(); }));
    $('progress').addEventListener('input', () => seek(Number($('progress').value)));
    $('tourPlay').addEventListener('click', play); $('tourPrev').addEventListener('click', () => step(-1)); $('tourNext').addEventListener('click', () => step(1));
    $('tourReplay').addEventListener('click', () => seek(0));
    $('tourKind').addEventListener('change', () => { stopDriver(); kind = $('tourKind').value; build(); seek(0); });
    $('tourSpeed').addEventListener('change', () => {
      speed = Number($('tourSpeed').value); if (tween) tween.timeScale(speed);
      if (delayed) delayed.timeScale(speed); render();
    });
    $('reveal').addEventListener('click', () => {
      leaveTour(); state.blind = false;
      const all = Object.values(state.known).every(Boolean);
      state.known = { A: !all, B: !all, C: !all, D: !all }; render(); writeHash();
    });
    $('auto').addEventListener('click', autoZoom); $('reset').addEventListener('click', reset); $('blind').addEventListener('click', blind); $('motion').addEventListener('click', motion);
    $('fontDown').addEventListener('click', () => font(-0.1)); $('fontUp').addEventListener('click', () => font(0.1));
    $('helpBtn').addEventListener('click', () => { $('keys').hidden = !$('keys').hidden; attr('helpBtn', 'aria-expanded', !$('keys').hidden); });
    $('fullscreen').addEventListener('click', fullScreen);
    document.querySelectorAll('[data-camera]').forEach(b => b.addEventListener('click', () => {
      scene.setCamera(b.dataset.camera);
      document.querySelectorAll('[data-camera]').forEach(other => other.setAttribute('aria-pressed', other === b));
    }));
    [['showSurface', 'surface'], ['showCut', 'cut'], ['showPlane', 'plane']].forEach(([id, key]) => $(id).addEventListener('change', () => { flags[key] = $(id).checked; render(); }));
    window.addEventListener('pagehide', event => { stopDriver(); stopAuto(); clearTimeout(hashTimer); cancelAnimationFrame(frame); if (!event.persisted) scene.dispose(); });
    window.addEventListener('pageshow', event => { if (event.persisted) { scene.resize(); render(); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    media.addEventListener('change', () => { if (!reducedOverride && state.reduced !== media.matches) { reducedOverride = false; motion(); reducedOverride = false; } });
    document.addEventListener('keydown', e => {
      if (e.code === 'Escape') { pause(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input,button,select,textarea,a,summary,[contenteditable=true]')) return;
      if (e.code === 'Space') { e.preventDefault(); play(); }
      else if (e.code === 'Home') { e.preventDefault(); seek(0); }
      else if (/^Digit[1-5]$/.test(e.code)) setSample(M.order[Number(e.code.slice(-1)) - 1]);
      else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        e.preventDefault(); const d = e.code === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey) { leaveTour(); state.theta = M.snapTheta(state.theta + 5 * d); render(); writeHash(); } else step(d);
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault(); leaveTour(); state.k = clamp(state.k + (e.code === 'ArrowUp' ? -0.25 : 0.25), 0, M.K_MAX); render(); writeHash();
      } else if (e.code === 'KeyR') blind(); else if (e.code === 'KeyZ') reset(); else if (e.code === 'KeyF') fullScreen();
      else if (e.key === '+' || e.key === '=') font(0.1); else if (e.key === '-') font(-0.1);
    });
  }
  function init() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (q.get('mode') === 'advanced') kind = 'advanced';
    build();
    if (M.byId[q.get('s')]) state.sample = q.get('s');
    const a = Number(q.get('a')), k = Number(q.get('z')), t = Number(q.get('t'));
    if (q.has('a') && q.get('a').trim() !== '' && Number.isFinite(a)) state.theta = M.snapTheta(a);
    if (q.has('z') && q.get('z').trim() !== '' && Number.isFinite(k)) state.k = clamp(k, 0, M.K_MAX);
    guided = ['entry', 'advanced'].includes(q.get('mode'));
    if (guided && Number.isFinite(t)) clock.t = clamp(t, 0, seq.duration);
    $('tourKind').value = kind; bind(); render(); writeHash();
  }
  init();
})();
