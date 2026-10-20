(function () {
  'use strict';
  const M = window.SelectionModel, C = window.SelectionChoreo;
  const $ = id => document.getElementById(id);
  const engine = window.gsap;
  const systemMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = { sequence: null, values: [], preset: 'edge', t: 0, speed: 1, playing: false, reduced: systemMotion.matches, motionOverride: false };
  let timeline = null, stepTween = null, reducedTimer = null, hashTimer = null;
  let clock = { t: 0 };
  const svgNS = 'http://www.w3.org/2000/svg';
  const itemDOM = new Map();
  const codeLines = [...document.querySelectorAll('[data-code]')];
  const colors = { paper: [255, 255, 255], sorted: [232, 241, 234], border: [211, 215, 206], green: [106, 154, 130] };
  function el(name, attrs, text) {
    const node = document.createElementNS(svgNS, name);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function text(node, value) { if (node.textContent !== String(value)) node.textContent = String(value); }
  function attr(node, name, value) { if (node.getAttribute(name) !== String(value)) node.setAttribute(name, value); }
  function blend(a, b, p) { return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(',')})`; }
  function applyText(node, view) { text(node, view.text); node.style.opacity = view.alpha; }
  function slotX(pos) { return 550 + (pos - (state.values.length - 1) / 2) * Math.min(132, 930 / state.values.length); }
  function boundaryX(count) {
    const n = state.values.length;
    const edge = k => k <= 0 ? slotX(0) - 60 : k >= n ? slotX(n - 1) + 60 : (slotX(k - 1) + slotX(k)) / 2;
    const lo = Math.floor(count);
    return edge(lo) + (edge(Math.ceil(count)) - edge(lo)) * (count - lo);
  }
  function writeHash() {
    clearTimeout(hashTimer); hashTimer = null;
    const params = new URLSearchParams({ v: state.values.join(','), t: state.t.toFixed(3), speed: state.speed });
    if (state.motionOverride) params.set('motion', state.reduced ? '1' : '0');
    try { history.replaceState(null, '', '#' + params.toString()); } catch { /* file:// 的限制不影响操作 */ }
  }
  function scheduleHash() { if (hashTimer === null) hashTimer = setTimeout(() => { hashTimer = null; writeHash(); }, 300); }
  function playing(value) {
    state.playing = value;
    document.body.dataset.playing = String(value);
    text($('play-label'), value ? '暂停' : state.t >= state.sequence.duration ? '重播' : '播放');
    text($('play-icon'), value ? 'Ⅱ' : '▶');
  }
  function pause() {
    timeline?.pause();
    stepTween?.kill(); stepTween = null;
    clearTimeout(reducedTimer); reducedTimer = null;
    playing(false);
    writeHash();
  }
  function activeStep() {
    return state.sequence.steps.find(s => state.t > s.start + 1e-7 && state.t <= s.end + 1e-7) || null;
  }
  function render(time) {
    state.t = Math.max(0, Math.min(state.sequence.duration, time));
    const f = C.sample(state.sequence, state.t);
    f.items.forEach(item => {
      const node = itemDOM.get(item.id);
      attr(node.group, 'transform', `translate(${slotX(item.x)} ${item.y})`);
      attr(node.rect, 'fill', blend(colors.paper, colors.sorted, item.ready));
      attr(node.rect, 'stroke', blend(colors.border, colors.green, item.ready));
    });
    // 在换位时把移动中的身份置于静止卡片之上；顺序仍由此帧决定。
    const itemLayer = $('items');
    [...f.items].sort((a, b) => Number(a.y !== 0) - Number(b.y !== 0) || a.id - b.id).forEach((item, index) => {
      const group = itemDOM.get(item.id).group;
      if (itemLayer.children[index] !== group) itemLayer.insertBefore(group, itemLayer.children[index] || null);
    });
    const first = boundaryX(0);
    const gate = boundaryX(f.boundary);
    attr($('sorted-band'), 'x', first);
    attr($('sorted-band'), 'width', Math.max(0, gate - first));
    attr($('gate'), 'x1', gate); attr($('gate'), 'x2', gate);
    applyText($('region-label'), f.region);
    [['min', 'min-marker', 'min-label'], ['j', 'j-marker', 'j-label']].forEach(([key, groupID, labelID]) => {
      const marker = f[key];
      attr($(groupID), 'transform', `translate(${slotX(marker.pos)} 0)`);
      attr($(groupID), 'opacity', marker.alpha);
      applyText($(labelID), { text: `${key} = ${marker.label.text}`, alpha: marker.label.alpha });
    });
    const focus = f.guide.positions[0] ?? 0;
    attr($('focus-ring'), 'transform', `translate(${slotX(focus)} 0)`);
    attr($('focus-ring'), 'opacity', f.guide.alpha);
    attr($('swap-paths'), 'opacity', f.paths.alpha);
    if (f.paths.pair) {
      const [a, b] = f.paths.pair.map(slotX);
      attr($('swap-path-a'), 'd', `M${a} 208V283H${b}V208`);
      attr($('swap-path-b'), 'd', `M${b} 208V133H${a}V208`);
    }
    attr($('event-tag'), 'transform', 'translate(550 0)');
    attr($('event-tag'), 'opacity', f.tag.text ? f.tag.alpha : 0);
    text($('event-text'), f.tag.text);
    applyText($('comp-count'), { text: f.comp.text, alpha: f.comp.alpha });
    applyText($('swap-count'), { text: f.swap.text, alpha: f.swap.alpha });
    applyText($('phase-name'), f.title); applyText($('pass-number'), f.pass);
    applyText($('narration'), f.note);
    applyText($('order-status'), f.order); applyText($('order-detail'), f.orderDetail);
    $('order-status').style.color = blend([52, 60, 56], [161, 68, 50], f.warning);
    const watch = state.sequence.watch;
    if (watch) {
      watch.forEach((id, index) => {
        const it = f.items.find(item => item.id === id);
        const group = $(index === 0 ? 'watch-a' : 'watch-b');
        const other = f.items.find(item => item.id === watch[1 - index]);
        const relative = Math.max(-1, Math.min(1, it.x - other.x));
        attr(group, 'transform', `translate(${110 + 80 * relative} ${it.y * .2})`);
      });
    }
    text($('stage-time'), `t ${state.t.toFixed(2).padStart(5, '0')}`);
    $('progress').value = state.t;
    $('progress').setAttribute('aria-valuetext', `${state.t.toFixed(2)} / ${state.sequence.duration.toFixed(2)}`);
    text($('time-output'), `${state.t.toFixed(2)} / ${state.sequence.duration.toFixed(2)}`);
    const count = state.sequence.steps.filter(s => s.end <= state.t + 1e-7).length;
    text($('step-counter'), `步骤 ${count} / ${state.sequence.steps.length}`);
    $('btn-prev').disabled = state.t <= 0;
    $('btn-next').disabled = state.t >= state.sequence.duration;
    const step = activeStep();
    codeLines.forEach(line => line.classList.toggle('active', !!step && line.dataset.code.split(' ').includes(step.type)));
    document.querySelectorAll('#moments button').forEach(button => attr(button, 'aria-current', Math.abs(Number(button.dataset.time) - state.t) < .02));
    if (!state.playing) text($('play-label'), state.t >= state.sequence.duration ? '重播' : '播放');
  }
  function seek(t) {
    pause();
    t = Math.max(0, Math.min(state.sequence.duration, t));
    if (state.reduced) t = state.sequence.boundaries.reduce((best, b) => Math.abs(b - t) < Math.abs(best - t) ? b : best, 0);
    timeline?.time(t, true); clock.t = t;
    render(t); writeHash();
  }
  function boundary(direction) {
    const boundaries = state.sequence.boundaries;
    return direction > 0 ? boundaries.find(t => t > state.t + 1e-6) ?? state.sequence.duration
      : [...boundaries].reverse().find(t => t < state.t - 1e-6) ?? 0;
  }
  function step(direction) {
    const target = boundary(direction);
    if (!engine || state.reduced) { seek(target); return; }
    pause(); playing(true);
    stepTween = timeline.tweenTo(target, { duration: Math.abs(target - state.t), ease: 'none', onComplete: () => { render(target); pause(); } });
    stepTween.timeScale(state.speed);
  }
  function reducedNext() {
    reducedTimer = setTimeout(() => {
      if (!state.playing) return;
      const target = boundary(1);
      timeline.time(target, true); clock.t = target; render(target);
      if (target >= state.sequence.duration) pause();
      else { writeHash(); reducedNext(); }
    }, 900 / state.speed);
  }
  function play() {
    if (!engine) return;
    pause();
    if (state.t >= state.sequence.duration) seek(0);
    playing(true);
    if (state.reduced) {
      // 从步内切入减少动效时先到当前事件终点，再开始停留。
      const endpoint = state.sequence.boundaries.find(t => t >= state.t - 1e-7);
      timeline.time(endpoint, true); clock.t = endpoint; render(endpoint);
      reducedNext();
    } else timeline.time(state.t, true).timeScale(state.speed).play();
  }
  function setMotion(reduced, override) {
    const resume = state.playing;
    pause(); state.reduced = reduced; state.motionOverride = override;
    $('reduce-motion').checked = reduced;
    document.body.dataset.motion = reduced ? 'reduced' : 'full';
    if (reduced) seek(state.t);
    if (resume) play();
    else writeHash();
  }
  function buildStage() {
    $('slots').replaceChildren(); $('items').replaceChildren(); itemDOM.clear();
    state.sequence.items.forEach((item, i) => {
      const x = slotX(i);
      $('slots').append(el('rect', { x: x - 45, y: 165, width: 90, height: 86, rx: 12, fill: '#f5f6f1', stroke: '#e5e4dc', 'stroke-dasharray': '3 4' }), el('text', { x, y: 379, 'text-anchor': 'middle', class: 'slot-index' }, `[${i}]`));
      const group = el('g', { 'data-item-id': item.id });
      group.append(el('title', {}, `${M.label(item)}，输入位置 ${item.id}`));
      const rect = el('rect', { x: -45, y: 165, width: 90, height: 86, rx: 12, 'stroke-width': 1.5 });
      group.append(rect, el('text', { y: 214, 'text-anchor': 'middle', class: 'item-value' }, item.value));
      if (item.tag) group.append(el('rect', { x: -34, y: 174, width: 21, height: 19, rx: 4, fill: '#eee9dc' }), el('text', { x: -23.5, y: 188, 'text-anchor': 'middle', class: 'item-tag' }, item.tag));
      $('items').append(group); itemDOM.set(item.id, { group, rect });
    });
    text($('comp-total'), ` / ${state.values.length * (state.values.length - 1) / 2}`);
    const watch = state.sequence.watch;
    $('watch-svg').hidden = !watch;
    $('watch-svg').style.display = watch ? '' : 'none';
    text($('original-order'), watch ? `初始 ${watch.map(id => M.label(state.sequence.items.find(it => it.id === id))).join(' → ')}` : '输入中没有重复数值');
    if (watch) watch.forEach((id, i) => text($(i === 0 ? 'watch-a' : 'watch-b').querySelector('text'), M.label(state.sequence.items.find(it => it.id === id))));
  }
  function buildMoments() {
    const nav = $('moments'); nav.replaceChildren();
    const heading = document.createElement('span'); heading.textContent = '关键时刻'; nav.append(heading);
    const firstSwap = state.sequence.steps.find(s => s.type === 'swap');
    const crossed = state.sequence.steps.find(s => s.type === 'swap' && M.inversions(s.after.arr).length > 0);
    const moments = [['初始', 0]];
    if (firstSwap) moments.push(['首次交换前', firstSwap.start]);
    if (crossed) moments.push(['同值跨越后', crossed.end]);
    else if (firstSwap) moments.push(['首次交换后', firstSwap.end]);
    moments.push(['排序完成', state.sequence.duration]);
    moments.forEach(([name, time]) => {
      const button = document.createElement('button'); button.textContent = name; button.dataset.time = time;
      button.addEventListener('click', () => seek(time)); nav.append(button);
    });
  }
  function load(values, preset, keepTime) {
    if (state.sequence) pause();
    timeline?.kill(); timeline = null;
    state.values = values.slice(); state.preset = preset;
    state.sequence = M.buildSequence(values); clock = { t: 0 };
    if (engine) {
      timeline = engine.timeline({ paused: true, onUpdate: () => { render(clock.t); scheduleHash(); }, onComplete: () => { render(state.sequence.duration); pause(); } });
      timeline.to(clock, { t: state.sequence.duration, duration: state.sequence.duration, ease: 'none' });
    }
    buildStage(); buildMoments();
    $('progress').max = state.sequence.duration;
    $('preset-select').value = preset;
    $('input-array').value = values.join(', ');
    seek(Math.min(keepTime, state.sequence.duration));
  }
  function showCustom(show) {
    $('custom-form').hidden = !show;
    if (show) { text($('custom-hint'), '3–8 个整数，范围 −999 至 999。'); $('custom-hint').classList.remove('error'); $('input-array').focus(); }
  }
  $('btn-reset').addEventListener('click', () => seek(0));
  $('btn-prev').addEventListener('click', () => step(-1));
  $('btn-next').addEventListener('click', () => step(1));
  $('btn-play').addEventListener('click', () => state.playing ? pause() : play());
  $('progress').addEventListener('input', event => seek(Number(event.target.value)));
  $('speed-select').addEventListener('change', event => {
    state.speed = Number(event.target.value);
    timeline?.timeScale(state.speed); stepTween?.timeScale(state.speed);
    if (state.playing && state.reduced) { clearTimeout(reducedTimer); reducedNext(); }
    writeHash();
  });
  $('reduce-motion').addEventListener('change', event => setMotion(event.target.checked, true));
  systemMotion.addEventListener('change', event => { if (!state.motionOverride) setMotion(event.matches, false); });
  $('preset-select').addEventListener('change', event => {
    pause();
    const preset = M.PRESETS.find(p => p.id === event.target.value);
    if (!preset) { showCustom(true); return; }
    showCustom(false); load(preset.values, preset.id, state.t);
  });
  $('btn-cancel-custom').addEventListener('click', () => { showCustom(false); $('preset-select').value = state.preset; });
  $('custom-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const values = M.parseInput($('input-array').value);
      load(values, 'custom', state.t); showCustom(false);
    } catch (error) { text($('custom-hint'), error.message); $('custom-hint').classList.add('error'); }
  });
  window.addEventListener('keydown', event => {
    if (event.target instanceof Element && event.target.closest('input,select,textarea,button,a,summary')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); state.playing ? pause() : play(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    else if (event.key === 'Home' || event.key.toLowerCase() === 'r') { event.preventDefault(); seek(0); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => { pause(); timeline?.kill(); clearTimeout(hashTimer); hashTimer = null; });
  window.addEventListener('pageshow', event => { if (event.persisted) load(state.values, state.preset, state.t); });

  const params = new URLSearchParams(location.hash.slice(1));
  let values = M.PRESETS[0].values;
  try { if (params.has('v')) values = M.parseInput(params.get('v')); } catch { /* 非法分享链接使用默认数据 */ }
  const speed = Number(params.get('speed'));
  if ([.5, 1, 1.5, 2].includes(speed)) state.speed = speed;
  $('speed-select').value = state.speed;
  if (['0', '1'].includes(params.get('motion'))) { state.reduced = params.get('motion') === '1'; state.motionOverride = true; }
  $('reduce-motion').checked = state.reduced;
  document.body.dataset.motion = state.reduced ? 'reduced' : 'full';
  $('engine-notice').hidden = !!engine; $('btn-play').disabled = !engine;
  const preset = M.PRESETS.find(p => p.values.join(',') === values.join(','));
  const time = Number(params.get('t'));
  load(values, preset ? preset.id : 'custom', Number.isFinite(time) ? Math.max(0, time) : 0);
  if (new URLSearchParams(location.search).has('autoplay')) play();
})();
