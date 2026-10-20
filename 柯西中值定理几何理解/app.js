(() => {
  'use strict';
  const M = window.CauchyModel, C = window.CauchyChoreo;
  const $ = id => document.getElementById(id);
  const ns = 'http://www.w3.org/2000/svg';
  const fmt = (v, digits = 3) => v === null ? '竖直' : (Math.abs(v) < .5 * 10 ** -digits ? 0 : v).toFixed(digits).replace('-', '−');
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  const attr = (el, values) => { for (const [k, v] of Object.entries(values)) el.setAttribute(k, v); };
  const line = (id, x1, y1, x2, y2) => attr($(id), { x1, y1, x2, y2 });
  const node = (tag, attrs, parent) => { const el = document.createElementNS(ns, tag); attr(el, attrs); parent.append(el); return el; };
  const state = { key: 'cubic', time: 0, free: null, playing: false };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  $('reduced').checked = motion.matches;
  let analysis, sequence, timeline, delayed, mapping, auxScale, rootNodes = [], auxNodes = [], drag = null;
  const clock = { t: 0 };
  const slopeText = v => v === null ? '竖直' : Math.abs(v) > 9999 ? v.toExponential(1) : fmt(v);
  function makeMapping() {
    const p = analysis.preset;
    const margin = (analysis.b - analysis.a) * .13;
    const lo = Math.max(p.min, analysis.a - margin), hi = Math.min(p.max, analysis.b + margin);
    const pts = Array.from({ length: 201 }, (_, i) => { const t = lo + (hi - lo) * i / 200; return [p.g(t), p.f(t)]; });
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const scale = Math.min(540 / Math.max(.4, xmax - xmin), 285 / Math.max(.4, ymax - ymin));
    const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
    return { x: x => 350 + (x - cx) * scale, y: y => 211 - (y - cy) * scale, scale, lo, hi };
  }
  const curvePath = (lo, hi, fn, mapX, mapY, count = 200) => Array.from({ length: count + 1 }, (_, i) => { const t = lo + (hi - lo) * i / count; return `${i ? 'L' : 'M'}${mapX(t).toFixed(3)},${mapY(fn(t)).toFixed(3)}`; }).join(' ');
  function drawStatic(keepMapping = false) {
    if (!keepMapping) mapping = makeMapping();
    const { x, y, scale } = mapping, p = analysis.preset;
    $('grid').replaceChildren(); $('axes').replaceChildren();
    const unit = 10 ** Math.floor(Math.log10(65 / scale));
    const tick = unit * (65 / scale / unit > 5 ? 5 : 65 / scale / unit > 2 ? 2 : 1);
    // Invert the affine transform so grid ticks stay correct for nonmonotone curves.
    const originX = x(0), originY = y(0);
    for (let i = Math.ceil((45 - originX) / (scale * tick)); i * tick * scale + originX <= 655; i++) {
      const xx = x(i * tick); node('line', { x1: xx, y1: 28, x2: xx, y2: 393, class: 'grid-line' }, $('grid'));
      node('text', { x: xx, y: 408, 'text-anchor': 'middle', class: 'svg-note' }, $('grid')).textContent = fmt(i * tick, tick < 1 ? 1 : 0);
    }
    for (let i = Math.ceil((originY - 393) / (scale * tick)); originY - i * tick * scale >= 28; i++) {
      const yy = y(i * tick); node('line', { x1: 45, y1: yy, x2: 655, y2: yy, class: 'grid-line' }, $('grid'));
      node('text', { x: 35, y: yy + 4, 'text-anchor': 'end', class: 'svg-note' }, $('grid')).textContent = fmt(i * tick, tick < 1 ? 1 : 0);
    }
    if (originY >= 28 && originY <= 393) node('line', { x1: 45, y1: originY, x2: 655, y2: originY, class: 'axis' }, $('axes'));
    if (originX >= 45 && originX <= 655) node('line', { x1: originX, y1: 28, x2: originX, y2: 393, class: 'axis' }, $('axes'));
    attr($('context-curve'), { d: curvePath(mapping.lo, mapping.hi, p.f, t => x(p.g(t)), y) });
    attr($('curve'), { d: curvePath(analysis.a, analysis.b, p.f, t => x(p.g(t)), y) });
    for (const key of ['a', 'b']) { const P = key === 'a' ? analysis.A : analysis.B; attr($('handle-' + key), { transform: `translate(${x(P.x)},${y(P.y)})` }); }
    $('root-marks').replaceChildren(); $('aux-roots').replaceChildren();
    rootNodes = analysis.roots.map(t => {
      const g = node('g', {}, $('root-marks'));
      node('circle', { cx: x(p.g(t)), cy: y(p.f(t)), r: 5, fill: '#fff', stroke: '#23745c', 'stroke-width': 2 }, g); return g;
    });
    const vals = Array.from({ length: 201 }, (_, i) => analysis.auxiliary(analysis.a + (analysis.b - analysis.a) * i / 200));
    auxScale = 48 / Math.max(.001, ...vals.map(Math.abs));
    attr($('aux-path'), { d: curvePath(analysis.a, analysis.b, analysis.auxiliary, auxX, v => 78 - v * auxScale) });
    auxNodes = analysis.roots.map(t => {
      const g = node('g', {}, $('aux-roots')), xx = auxX(t), yy = auxY(t);
      node('line', { x1: xx - 13, x2: xx + 13, y1: yy, y2: yy, stroke: '#23745c', 'stroke-width': 1.5 }, g);
      node('circle', { cx: xx, cy: yy, r: 3.5, fill: '#23745c' }, g); return g;
    });
    setText($('aux-a'), 'a = ' + fmt(analysis.a, 2)); setText($('aux-b'), 'b = ' + fmt(analysis.b, 2));
    setText($('function-g'), p.gText); setText($('function-f'), p.fText);
    setText($('condition'), analysis.condition + (state.key === 'rolle' && Math.abs(analysis.dy) > 1e-8 ? ' 端点已不等高，当前为一般中值情形。' : '')); $('condition').classList.toggle('warning', !analysis.ratioValid);
    for (const k of ['a', 'b']) { attr($(k), { min: p.min, max: p.max }); $(k).value = analysis[k]; setText($(k + '-value'), fmt(analysis[k], 2)); }
    attr($('t'), { min: analysis.a, max: analysis.b });
  }
  function auxX(t) { return 22 + 266 * (t - analysis.a) / (analysis.b - analysis.a); }
  function auxY(t) { return 78 - analysis.auxiliary(t) * auxScale; }
  function draw() {
    const frame = C.sample(sequence, state.time);
    const free = state.free !== null;
    if (free) { frame.t = state.free; frame.secant = 1; frame.tangent = 1; frame.marks = frame.marks.map(() => 1); frame.confirm = 0; frame.focus = 0; }
    const s = M.snapshot(analysis, frame.t), { x, y } = mapping;
    const px = x(s.P.x), py = y(s.P.y), ax = x(analysis.A.x), ay = y(analysis.A.y), bx = x(analysis.B.x), by = y(analysis.B.y);
    line('secant', ax, ay, bx, by); attr($('secant'), { 'stroke-dasharray': '1', 'stroke-dashoffset': 1 - frame.secant });
    const cn = Math.hypot(analysis.dx, analysis.dy) || 1, ux = analysis.dx / cn, uy = -analysis.dy / cn;
    line('secant-extension', ax - 700 * ux, ay - 700 * uy, bx + 700 * ux, by + 700 * uy); attr($('secant-extension'), { opacity: frame.secant * .34 });
    const vn = Math.hypot(s.vx, s.vy) || 1, vx = s.vx / vn, vy = -s.vy / vn;
    line('tangent', px - 100 * vx, py - 100 * vy, px + 100 * vx, py + 100 * vy); attr($('tangent'), { opacity: frame.tangent });
    line('parallel-guide', px - 110 * ux, py - 110 * uy, px + 110 * ux, py + 110 * uy); attr($('parallel-guide'), { opacity: $('guide').checked ? frame.tangent * .7 : 0 });
    attr($('handle-p'), { transform: `translate(${px},${py})`, opacity: frame.tangent });
    attr($('focus-ring'), { opacity: free ? .4 : frame.focus, r: 15 + frame.focus * 6 });
    setText($('point-label'), s.isMeanPoint ? 'P(ξ)' : 'P(t)');
    const receipt = free ? (s.matched ? 1 : 0) : frame.confirm;
    attr($('match-tag'), { transform: `translate(${Math.max(48, Math.min(565, px - 44))},${Math.max(30, Math.min(357, py - 51 + 4 * (1 - receipt)))})`, opacity: receipt });
    rootNodes.forEach((n, i) => attr(n, { opacity: frame.marks[i] })); auxNodes.forEach((n, i) => attr(n, { opacity: frame.marks[i] }));
    line('direction-secant', 53 - 31 * ux, 39 - 31 * uy, 53 + 31 * ux, 39 + 31 * uy); attr($('direction-secant'), { opacity: frame.secant });
    line('direction-tangent', 53 - 31 * vx, 39 - 31 * vy, 53 + 31 * vx, 39 + 31 * vy); attr($('direction-tangent'), { opacity: frame.tangent });
    line('aux-cursor', auxX(frame.t), 18, auxX(frame.t), 126); attr($('aux-cursor'), { opacity: frame.tangent * .6 });
    attr($('aux-point'), { cx: auxX(frame.t), cy: auxY(frame.t), opacity: frame.tangent });
    // Derivative in this independently scaled plot; horizontal iff residual is zero.
    const du = 266 / (analysis.b - analysis.a), dv = -analysis.residual(frame.t) * auxScale, an = Math.hypot(du, dv);
    line('aux-tangent', auxX(frame.t) - 20 * du / an, auxY(frame.t) - 20 * dv / an, auxX(frame.t) + 20 * du / an, auxY(frame.t) + 20 * dv / an);
    attr($('aux-tangent'), { opacity: frame.tangent });
    setText($('secant-value'), frame.secant ? slopeText(analysis.secantSlope) : '—');
    setText($('tangent-value'), frame.tangent ? slopeText(s.tangentSlope) : '—');
    $('secant-value').style.opacity = Math.max(.35, frame.secant); $('tangent-value').style.opacity = Math.max(.35, frame.tangent);
    setText($('angle-value'), frame.tangent ? s.angle === null ? '未定义' : fmt(s.angle, 2) + '°' : '—');
    $('angle-value').style.opacity = Math.max(.35, frame.tangent);
    setText($('match-value'), !frame.tangent ? '移动切点，比较方向' : s.matched ? s.isMeanPoint ? '方向平行 · 数值近似' : '端点平行，ξ 须在区间内部' : '方向尚未平行');
    setText($('param-value'), 't = ' + fmt(frame.t));
    setText($('aux-receipt'), receipt > .5 ? s.isMeanPoint ? 'F(a) = F(b) = 0，F′(ξ) ≈ 0' : 'F(a) = F(b) = 0，F′(t) ≈ 0' : 'F(a) = F(b) = 0');
    $('aux-receipt').style.opacity = 1;
    setText($('clock'), state.time.toFixed(2) + ' s');
    setText($('phase'), free ? '自由观察' : frame.title); $('phase').style.opacity = free ? 1 : frame.alpha;
    setText($('narration'), free ? (s.matched ? s.isMeanPoint ? '此处切线与割线平行，注意两图对应同一个参数。' : '端点切线也可能平行，但 ξ 必须位于开区间内。' : '拖动切点，比较整段变化方向与此刻的切线方向。') : frame.caption);
    $('narration').style.opacity = free ? 1 : frame.alpha;
    setText($('mode-label'), free ? '自由观察' : '分步演示');
    $('t').value = frame.t; setText($('t-value'), fmt(frame.t));
    $('progress').value = state.time / sequence.duration * 100; setText($('progress-value'), Math.round(state.time / sequence.duration * 100) + '%');
    [...$('steps').children].forEach((b, i) => { if (!free && i === frame.index) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    $('prev').disabled = state.time <= 0 && !free; $('next').disabled = state.time >= sequence.duration && !free;
    $('resume-demo').hidden = !free;
  }
  function updatePlaying() { setText($('play'), state.playing ? '暂停' : '播放'); $('status-dot').classList.toggle('running', state.playing); }
  function stop() { timeline?.pause(); delayed?.kill(); delayed = null; state.playing = false; updatePlaying(); }
  function seek(time) { stop(); state.free = null; state.time = Math.max(0, Math.min(sequence.duration, time)); clock.t = state.time; timeline?.time(state.time, true); draw(); }
  function nextBoundary() { return sequence.boundaries.find(t => t > state.time + 1e-7) ?? sequence.duration; }
  function prevBoundary() { return [...sequence.boundaries].reverse().find(t => t < state.time - 1e-7) ?? 0; }
  function reducedTick() {
    delayed = window.gsap.delayedCall(.9 / Number($('speed').value), () => {
      if (!state.playing) return;
      state.time = nextBoundary(); clock.t = state.time; timeline.time(state.time, true); draw();
      if (state.time >= sequence.duration) { stop(); return; }
      reducedTick();
    });
  }
  function play() {
    if (!timeline) return;
    if (state.playing) { stop(); return; }
    if (state.time >= sequence.duration) seek(0);
    state.free = null; state.playing = true; updatePlaying();
    if ($('reduced').checked) reducedTick(); else timeline.time(state.time, true).timeScale(Number($('speed').value)).play();
    draw();
  }
  function createTimeline() {
    timeline?.kill();
    if (!window.gsap) { $('engine-notice').hidden = false; $('play').disabled = true; return; }
    clock.t = 0;
    timeline = window.gsap.timeline({ paused: true, onUpdate: () => { state.time = clock.t; draw(); }, onComplete: () => { state.time = sequence.duration; stop(); draw(); } });
    timeline.to(clock, { t: sequence.duration, duration: sequence.duration, ease: 'none' });
    timeline.time(state.time, true);
  }
  function rebuild(key, a, b, keepMapping = false) {
    stop();
    const keepTime = state.time;
    analysis = M.analyze(key, a, b); state.key = analysis.key;
    sequence = C.build(analysis); state.time = Math.min(keepTime, sequence.duration); state.free = null;
    drawStatic(keepMapping);
    $('steps').replaceChildren();
    sequence.steps.forEach((s, i) => { const b = document.createElement('button'); b.textContent = `${String(i + 1).padStart(2, '0')}  ${s.title}`; b.onclick = () => seek(s.start + s.duration); $('steps').append(b); });
    $('root-buttons').replaceChildren();
    analysis.roots.forEach((t, i) => { const b = document.createElement('button'); b.textContent = `ξ${analysis.roots.length > 1 ? i + 1 : ''} ≈ ${fmt(t)}`; b.onclick = () => { stop(); state.free = t; draw(); }; $('root-buttons').append(b); });
    if (!analysis.roots.length) setText($('root-buttons'), '当前区间未找到非零切向量的平行点');
    document.querySelectorAll('[data-preset]').forEach(b => b.setAttribute('aria-pressed', b.dataset.preset === key));
    createTimeline(); draw();
  }
  $('play').onclick = play; $('replay').onclick = () => seek(0); $('prev').onclick = () => seek(prevBoundary()); $('next').onclick = () => seek(nextBoundary());
  $('progress').oninput = () => seek(Number($('progress').value) / 100 * sequence.duration);
  $('speed').onchange = () => { if (timeline) timeline.timeScale(Number($('speed').value)); if (state.playing && $('reduced').checked) { stop(); play(); } };
  function motionChange() { const resume = state.playing; stop(); document.body.dataset.motion = $('reduced').checked ? 'reduced' : 'full'; if ($('reduced').checked) { const end = nextBoundary(); if (state.time > 0 && !sequence.boundaries.includes(state.time)) seek(end); } if (resume) play(); }
  $('reduced').onchange = motionChange;
  motion.addEventListener('change', e => { $('reduced').checked = e.matches; motionChange(); });
  document.body.dataset.motion = motion.matches ? 'reduced' : 'full';
  $('a').oninput = () => rebuild(state.key, Math.min(Number($('a').value), analysis.b - .15), analysis.b);
  $('b').oninput = () => rebuild(state.key, analysis.a, Math.max(Number($('b').value), analysis.a + .15));
  $('t').oninput = () => { stop(); state.free = Number($('t').value); draw(); };
  $('guide').onchange = draw; $('resume-demo').onclick = () => seek(state.time);
  document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { const p = M.PRESETS[b.dataset.preset]; rebuild(b.dataset.preset, p.a, p.b); });
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea,button,a') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); play(); }
    if (e.code === 'ArrowLeft') { e.preventDefault(); seek(prevBoundary()); }
    if (e.code === 'ArrowRight') { e.preventDefault(); seek(nextBoundary()); }
    if (e.code === 'Home') { e.preventDefault(); seek(0); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  const plane = $('plane');
  for (const key of ['a', 'b', 'p']) $('handle-' + key).addEventListener('pointerdown', e => {
    stop(); drag = key; plane.setPointerCapture(e.pointerId); e.preventDefault();
  });
  plane.addEventListener('pointermove', e => {
    if (!drag) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(plane.getScreenCTM().inverse());
    const p = analysis.preset;
    const lo = drag === 'p' ? analysis.a : drag === 'b' ? analysis.a + .15 : p.min;
    const hi = drag === 'p' ? analysis.b : drag === 'a' ? analysis.b - .15 : p.max;
    let best = lo, distance = Infinity;
    for (let i = 0; i <= 1000; i++) { const t = lo + (hi - lo) * i / 1000, d = Math.hypot(mapping.x(p.g(t)) - pt.x, mapping.y(p.f(t)) - pt.y); if (d < distance) { distance = d; best = t; } }
    if (drag === 'p') { state.free = best; draw(); }
    else rebuild(state.key, drag === 'a' ? best : analysis.a, drag === 'b' ? best : analysis.b, true);
  });
  function release() { if (!drag) return; const endpoint = drag !== 'p'; drag = null; if (endpoint) { drawStatic(); draw(); } }
  plane.addEventListener('pointerup', release); plane.addEventListener('pointercancel', release); plane.addEventListener('lostpointercapture', release);
  window.addEventListener('pagehide', () => { stop(); timeline?.kill(); });
  rebuild('cubic', M.PRESETS.cubic.a, M.PRESETS.cubic.b);
})();
