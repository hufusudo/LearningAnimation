(function () {
  'use strict';
  const M = window.ShellModel, C = window.ShellChoreo;
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const link = new URLSearchParams(location.hash.slice(1));
  const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let key = link.get('case') === 'counter' ? 'counter' : 'classic';
  let speed = [0.5, 1, 1.5, 2].includes(Number(link.get('speed'))) ? Number(link.get('speed')) : 1;
  let reduced = link.has('motion') ? link.get('motion') === 'reduce' : systemMotion.matches;
  let motionOverride = link.has('motion');
  let sequence, timeline = null, delay = null, t = 0, playing = false, lastHashWrite = 0;
  let tokenNodes = [], slotNodes = [], upperNodes = [], mapNodes = [], groupFocusNodes = [], groupNodes = [], groupGap = -1;
  const clock = { t: 0 };
  const engine = window.gsap;
  function attr(el, name, value) {
    const string = String(value);
    if (el.getAttribute(name) !== string) el.setAttribute(name, string);
  }
  function text(el, value) { if (el.textContent !== String(value)) el.textContent = value; }
  function element(tag, attrs = {}, content) {
    const node = document.createElementNS(svgNS, tag);
    for (const [name, value] of Object.entries(attrs)) attr(node, name, value);
    if (content !== undefined) text(node, content);
    return node;
  }
  function show(node, visible) { attr(node, 'visibility', visible ? 'visible' : 'hidden'); }
  function fadeText(id, view) {
    const el = $(id);
    text(el, view.text);
    if (el.style.opacity !== String(view.alpha)) el.style.opacity = view.alpha;
  }
  function save(force = false) {
    const now = Date.now();
    if (!force && now - lastHashWrite < 300) return;
    lastHashWrite = now;
    try {
      history.replaceState(null, '', '#' + new URLSearchParams({ case: key, t: t.toFixed(2), speed, motion: reduced ? 'reduce' : 'full' }));
    } catch (_) { /* Some file:// environments disallow history changes. */ }
  }
  function buildStage() {
    const n = sequence.items.length;
    for (const layer of ['slots-layer', 'tokens-layer', 'temp-layer', 'upper-slots-layer', 'mapping-layer', 'group-focus-layer']) $(layer).replaceChildren();
    groupGap = -1;
    slotNodes = sequence.items.map((_, i) => {
      const x = C.xAt(i, n), g = element('g');
      g.append(element('rect', { x: x - 39, y: C.MAIN_Y - 35, width: 78, height: 70, rx: 11, fill: '#f5f6f1', stroke: '#dfe3da' }));
      const hole = element('g', { opacity: 0 });
      hole.append(element('rect', { x: x - 39, y: C.MAIN_Y - 35, width: 78, height: 70, rx: 11, fill: '#edf3fb', stroke: '#3067b3', 'stroke-dasharray': '4 4' }), element('text', { x, y: C.MAIN_Y + 4, class: 'slot-hole-label' }, '已抽起'));
      g.append(hole, element('text', { x, y: 421, class: 'slot-index' }, i));
      $('slots-layer').append(g);
      return hole;
    });
    upperNodes = sequence.items.map((_, i) => {
      const g = element('g', { visibility: 'hidden', 'data-upper-index': i });
      g.append(element('rect', { x: -39, y: -35, width: 78, height: 70, rx: 11, fill: '#f5f6f1', stroke: '#dfe3da' }));
      const hole = element('g');
      hole.append(element('rect', { x: -39, y: -35, width: 78, height: 70, rx: 11, fill: '#edf3fb', stroke: '#3067b3', 'stroke-dasharray': '4 4' }), element('text', { x: 0, y: 4, class: 'slot-hole-label' }, '空穴'));
      g.append(hole, element('text', { x: 0, y: 55, class: 'slot-index' }, `A[${i}]`));
      $('upper-slots-layer').append(g);
      return { g, hole };
    });
    mapNodes = sequence.items.map(() => {
      const path = element('path', { fill: 'none', stroke: '#7896ba', 'stroke-width': 1, 'stroke-dasharray': '3 5' });
      $('mapping-layer').append(path); return path;
    });
    groupFocusNodes = sequence.items.map(() => {
      const rect = element('rect', { width: 88, height: 82, rx: 15, fill: 'none', stroke: '#3067b3', 'stroke-width': 2, visibility: 'hidden' });
      $('group-focus-layer').append(rect); return rect;
    });
    const temp = element('g', { id: 'temp-slot' });
    temp.append(element('rect', { x: -40, y: -36, width: 80, height: 72, rx: 11, fill: 'none', stroke: '#8da8cb', 'stroke-dasharray': '4 4' }));
    $('temp-layer').append(temp);
    tokenNodes = sequence.items.map(item => {
      const g = element('g', { 'data-token': item.id, 'aria-label': `${item.value}${item.tag || ''}` });
      const box = element('rect', { x: -36, y: -32, width: 72, height: 64, rx: 10, fill: '#fff', stroke: '#cdd4c9', 'stroke-width': 1.2 });
      g.append(box, element('text', { x: 0, y: item.tag ? -3 : 0, class: 'token-value' }, item.value));
      if (item.tag) {
        const a = item.tag === 'a';
        g.append(element('rect', { x: 16, y: -40, width: 22, height: 21, rx: a ? 3 : 10, fill: a ? '#fbefd9' : '#e8f1eb', stroke: a ? '#bd9655' : '#80a28e' }), element('text', { x: 27, y: -29, class: 'token-tag', fill: a ? '#805b21' : '#3f6b51' }, item.tag));
        g.append(element('text', { x: 0, y: 20, class: 'token-caption' }, '同值记录'));
      }
      $('tokens-layer').append(g);
      return { id: item.id, g, box };
    });
    text($('original-order'), '原始 a → b');
    text($('case-summary'), key === 'classic' ? '49ₐ 与 49ᵦ：距离缩小，不代表次序颠倒。' : '2ₐ 与 2ᵦ：跨组跳跃，观察谁先越过谁。');
    document.querySelectorAll('[data-case]').forEach(button => attr(button, 'aria-pressed', button.dataset.case === key));
  }
  function drawGroups(view) {
    if (groupGap !== view.gap) {
      groupGap = view.gap; $('groups-layer').replaceChildren(); groupNodes = [];
      if (view.gap) for (let r = 0; r < view.gap; r++) {
        const width = 900 / view.gap, x = 142 + r * width, g = element('g');
        const indices = sequence.items.map((_, i) => i).filter(i => i % view.gap === r);
        const box = element('rect', { x, y: 442, width: width - 10, height: 28, rx: 5 });
        const label = element('text', { x: x + 12, y: 460, class: 'group-title' }, `${r} 组 · ${indices.join(' → ')}`);
        g.append(box, label);
        $('groups-layer').append(g); groupNodes.push({ box, label });
      }
    }
    attr($('groups-layer'), 'opacity', view.alpha);
    groupNodes.forEach((row, r) => {
      const active = r === view.active;
      attr(row.box, 'fill', active ? '#edf3fb' : '#f5f6f1');
      attr(row.label, 'fill', active ? '#244f8a' : '#6b7066');
    });
  }
  function drawWork(frame) {
    const { work } = frame;
    show($('work-layer'), work.alpha > 0);
    attr($('work-layer'), 'opacity', work.alpha);
    upperNodes.forEach((node, i) => {
      const slot = frame.upperSlots[i];
      show(node.g, slot.alpha > 0);
      attr(node.g, 'transform', `translate(${slot.x} ${C.UPPER_Y})`);
      attr(node.g, 'opacity', slot.alpha); attr(node.hole, 'opacity', slot.hole);
      attr(mapNodes[i], 'd', `M${slot.x},285 L${C.xAt(i, sequence.items.length)},${C.MAIN_Y - 43}`);
      attr(mapNodes[i], 'opacity', slot.alpha * .28);
    });
    const count = work.indices.length;
    if (count) {
      const first = C.xAt(0, count), last = C.xAt(count - 1, count);
      const end = first + (Math.max(1, work.prefix) - 1) * 110;
      attr($('prefix-range'), 'd', `M${first - 41},245 v6 H${end + 41} v-6`);
      attr($('prefix-label'), 'x', (first + end) / 2);
      text($('prefix-label'), `已排序区 · ${Math.round(work.prefix)} 项`);
      const pending = Math.max(0, count - work.prefix), next = end + 110;
      attr($('pending-range'), 'd', `M${next - 41},245 v6 H${last + 41} v-6`);
      attr($('pending-label'), 'x', (next + last) / 2);
      const pendingAlpha = Math.min(1, pending);
      attr($('pending-range'), 'opacity', pendingAlpha); attr($('pending-label'), 'opacity', pendingAlpha);
    }
    const empty = frame.groups.active === null && work.alpha === 0;
    show($('groups-empty'), empty);
    text($('groups-empty'), t >= sequence.duration ? '全部子表已完成，原数组整体有序。' : '把一整组抽到这里，组内逐项做直接插入。');
  }
  function render(time) {
    t = Math.max(0, Math.min(sequence.duration, time));
    const frame = C.sample(sequence, t);
    text($('time-label'), `t ${t.toFixed(2).padStart(5, '0')}`);
    fadeText('phase-label', frame.phase); fadeText('group-label', frame.stage); fadeText('pointer-label', frame.pointers); fadeText('narration', frame.message);
    text($('compare-count'), frame.comparisons); text($('move-count'), frame.moves); text($('inversion-count'), frame.inversions);
    frame.tokens.forEach((token, index) => {
      const node = tokenNodes[index];
      attr(node.g, 'transform', `translate(${token.x} ${token.y})`);
      const strength = frame.focus && frame.focus.x === token.x && frame.focus.y === token.y ? frame.focus.alpha : 0;
      const slot = frame.upperSlots.find(slot => slot.alpha > 0 && Math.abs(slot.x - token.x) < 1 && token.y === C.UPPER_Y);
      const sorted = slot ? slot.sorted * slot.alpha : 0;
      const base = [255, 255, 255].map((value, i) => value + ([242, 248, 241][i] - value) * sorted);
      const color = base.map((value, i) => Math.round(value + ([237, 243, 251][i] - value) * strength));
      attr(node.box, 'fill', `rgb(${color.join(',')})`);
      attr(node.box, 'stroke', strength > 0.3 ? '#7d9ecb' : '#cdd4c9');
    });
    slotNodes.forEach((node, i) => attr(node, 'opacity', frame.holes[i]));
    attr($('temp-slot'), 'transform', `translate(${frame.temp.x} ${C.TEMP_Y})`); attr($('temp-slot'), 'opacity', frame.temp.alpha);
    drawGroups(frame.groups);
    drawWork(frame);
    groupFocusNodes.forEach((node, i) => {
      const point = frame.groupFocus && frame.groupFocus.points[i];
      show(node, !!point);
      if (point) {
        attr(node, 'x', point.x - 44); attr(node, 'y', point.y - 41); attr(node, 'opacity', frame.groupFocus.alpha);
      }
    });
    show($('focus-ring'), !!frame.focus);
    if (frame.focus) {
      attr($('focus-ring'), 'x', frame.focus.x - 44); attr($('focus-ring'), 'y', frame.focus.y - 41); attr($('focus-ring'), 'opacity', frame.focus.alpha);
    }
    show($('comparison-line'), !!frame.connector);
    if (frame.connector) {
      const v = frame.connector;
      attr($('comparison-line'), 'd', `M${v.x1},${v.y1} L${v.x1},${v.y2 + 32} L${v.x2},${v.y2}`);
      attr($('comparison-line'), 'opacity', v.alpha); attr($('comparison-line'), 'stroke-dashoffset', 1 - v.draw);
    }
    show($('event-tag'), !!frame.tag);
    if (frame.tag) {
      attr($('event-tag'), 'transform', `translate(${frame.tag.x} ${frame.tag.y})`); attr($('event-tag'), 'opacity', frame.tag.alpha); text($('event-text'), frame.tag.text);
    }
    const reversed = frame.order.text === 'reversed';
    text($('order-sequence'), reversed ? '当前 b → a' : '当前 a → b');
    text($('order-caption'), reversed ? '已确认同值次序逆转' : t >= sequence.duration ? '本例未逆转，不代表算法稳定' : '完整落位后核对次序');
    attr($('order-indicator'), 'data-reversed', reversed); $('order-indicator').style.opacity = frame.order.alpha;
    $('progress').value = String(t); attr($('progress'), 'aria-valuetext', `第 ${Math.floor(t)} 步，共 ${sequence.duration} 步`);
    text($('step-label'), `${Math.floor(t)} / ${sequence.duration}`); text($('progress-value'), `${Math.round(t / sequence.duration * 100)}%`);
    $('btn-prev').disabled = t <= 0; $('btn-next').disabled = t >= sequence.duration;
    document.querySelectorAll('[data-time]').forEach(button => attr(button, 'data-passed', t >= Number(button.dataset.time)));
    save();
  }
  function updatePlaying() {
    document.body.dataset.playing = String(playing);
    text($('btn-play'), playing ? '暂停' : sequence && t >= sequence.duration ? '重播' : '播放');
    attr($('btn-play'), 'aria-pressed', playing);
  }
  function pause() {
    playing = false;
    if (timeline) timeline.pause();
    if (delay) { delay.kill(); delay = null; }
    updatePlaying(); save(true);
  }
  function seek(time) {
    pause();
    const clamped = Math.max(0, Math.min(sequence.duration, time));
    const target = reduced ? Math.round(clamped) : clamped;
    clock.t = target;
    if (timeline) timeline.time(target * 1.1, true);
    render(target); updatePlaying(); save(true);
  }
  function scheduleReduced() {
    if (!playing) return;
    delay = engine.delayedCall(0.9, () => {
      delay = null;
      if (!playing) return;
      const next = Math.min(sequence.duration, Math.floor(t + 0.00001) + 1);
      clock.t = next; render(next);
      if (next >= sequence.duration) pause(); else scheduleReduced();
    }).timeScale(speed);
  }
  function play() {
    if (!engine) return;
    if (t >= sequence.duration) seek(0);
    playing = true; updatePlaying();
    if (reduced) scheduleReduced();
    else timeline.time(t * 1.1, true).timeScale(speed).play();
  }
  function togglePlay() { if (playing) pause(); else play(); }
  function loadCase(nextKey, keepTime) {
    pause();
    if (timeline) { timeline.kill(); timeline = null; }
    key = nextKey; sequence = M.buildSequence(key);
    clock.t = 0;
    buildStage(); $('progress').max = sequence.duration;
    $('checkpoints').replaceChildren();
    const points = [{ time: 0, label: '起点' }];
    for (const checkpoint of sequence.checkpoints) {
      const start = sequence.steps.findIndex(step => step.kind === 'group-lift' && step.after.gap === checkpoint.gap);
      points.push({ time: start + 1, label: `d=${checkpoint.gap} · 抽起整组` });
      points.push({ time: checkpoint.time, label: `d=${checkpoint.gap} 完成 · ${checkpoint.inversions} 对` });
    }
    if (sequence.reversalTime !== null) points.push({ time: sequence.reversalTime, label: '首次次序逆转', reversal: true });
    points.sort((a, b) => a.time - b.time).forEach(point => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.time = point.time;
      if (point.reversal) button.dataset.reversal = 'true';
      text(button, point.label); button.addEventListener('click', () => seek(point.time)); $('checkpoints').append(button);
    });
    if (engine) {
      timeline = engine.timeline({ paused: true, onUpdate: () => render(clock.t), onComplete: pause });
      timeline.fromTo(clock, { t: 0 }, { t: sequence.duration, duration: sequence.duration * 1.1, ease: 'none', immediateRender: false });
    }
    seek(Math.min(Number.isFinite(keepTime) ? keepTime : 0, sequence.duration));
  }
  function setMotion(value) {
    const resume = playing, keep = t;
    pause(); reduced = value; $('reduce-motion').checked = reduced; document.body.dataset.motion = reduced ? 'reduce' : 'full';
    seek(reduced ? Math.ceil(keep) : keep);
    if (resume && t < sequence.duration) play();
  }
  // Wire controls before loading the initial deterministic state.
  $('btn-play').addEventListener('click', togglePlay);
  $('btn-reset').addEventListener('click', () => seek(0));
  $('btn-prev').addEventListener('click', () => seek(Math.max(0, Math.ceil(t - 0.00001) - 1)));
  $('btn-next').addEventListener('click', () => seek(Math.floor(t + 0.00001) + 1));
  $('progress').addEventListener('input', event => seek(Number(event.target.value)));
  $('speed').value = String(speed);
  $('speed').addEventListener('change', event => {
    speed = Number(event.target.value);
    if (timeline) timeline.timeScale(speed);
    if (delay) delay.timeScale(speed);
    save(true);
  });
  $('reduce-motion').checked = reduced; document.body.dataset.motion = reduced ? 'reduce' : 'full';
  $('reduce-motion').addEventListener('change', event => { motionOverride = true; setMotion(event.target.checked); });
  systemMotion.addEventListener('change', event => { if (!motionOverride) setMotion(event.matches); });
  document.querySelectorAll('[data-case]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.case !== key) loadCase(button.dataset.case, t);
  }));
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.target.closest('input,select,textarea,button,a,[contenteditable]')) return;
    if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
    else if (event.code === 'ArrowRight') { event.preventDefault(); $('btn-next').click(); }
    else if (event.code === 'ArrowLeft') { event.preventDefault(); $('btn-prev').click(); }
    else if (event.code === 'Home') { event.preventDefault(); seek(0); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => { pause(); if (timeline) timeline.kill(); });
  $('btn-play').disabled = !engine; $('engine-notice').hidden = !!engine;
  if (!engine) $('btn-play').title = '动画引擎未加载，请使用单步或进度条';
  const initialTime = Number(link.get('t'));
  loadCase(key, Number.isFinite(initialTime) ? initialTime : 0);
})();
