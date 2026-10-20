(function () {
  'use strict';
  const M = window.QuickSortModel, C = window.QuickSortChoreo;
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const STEP_SECONDS = 1.05;
  const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const linked = new URLSearchParams(location.hash.slice(1));
  const linkedInput = M.parseInput(linked.get('a') || M.PRESETS.classic.join(','));
  const state = {
    values: linkedInput.error ? M.PRESETS.classic.slice() : linkedInput.values,
    mode: linked.get('mode') === 'single' ? 'single' : 'recursive',
    speed: [.5, 1, 1.5, 2].includes(Number(linked.get('speed'))) ? Number(linked.get('speed')) : 1,
    reduced: linked.has('reduced') ? linked.get('reduced') === '1' : systemMotion.matches,
    trace: null, t: 0, playing: false, stopAt: null
  };
  let timeline = null, lastLinkWrite = 0, motionOverride = linked.has('reduced');
  const clock = { t: 0 };
  let visual = {};

  function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (parent) parent.appendChild(node);
    return node;
  }
  function attrs(node, values) {
    Object.entries(values).forEach(([key, value]) => {
      if (node.getAttribute(key) !== String(value)) node.setAttribute(key, value);
    });
  }
  function setText(node, value) { if (node.textContent !== String(value)) node.textContent = value; }
  function textView(node, view) { setText(node, view.text); node.style.opacity = view.alpha; }
  function saveLink(force = false) {
    const now = performance.now();
    if (!force && now - lastLinkWrite < 300) return;
    lastLinkWrite = now;
    const params = new URLSearchParams({ a: state.values.join(','), mode: state.mode, t: state.t.toFixed(3), speed: state.speed, reduced: state.reduced ? '1' : '0' });
    try { history.replaceState(null, '', '#' + params.toString()); } catch { /* file:// may restrict history. */ }
  }
  function updateButtons() {
    $('btn-play').textContent = state.playing ? 'Ⅱ 暂停' : state.t >= state.trace.duration ? '↺ 重播' : '▶ 播放';
    $('btn-play').dataset.playing = state.playing;
    $('status-dot').classList.toggle('running', state.playing);
    $('btn-play').disabled = !window.gsap;
    $('engine-notice').hidden = !!window.gsap;
    $('btn-prev').disabled = state.t <= 0;
    $('btn-next').disabled = state.t >= state.trace.duration;
    const partition = findPartition();
    $('btn-partition').disabled = !partition;
  }
  function pause() {
    if (timeline) timeline.pause();
    state.playing = false;
    state.stopAt = null;
    updateButtons();
    saveLink(true);
  }
  function seek(t) {
    pause();
    const target = Math.max(0, Math.min(Number(t) || 0, state.trace.duration));
    clock.t = state.reduced ? Math.round(target) : target;
    if (timeline) timeline.time(clock.t * (state.reduced ? .9 : STEP_SECONDS), true);
    state.t = clock.t;
    render();
    saveLink(true);
  }
  function makeTimeline() {
    if (timeline) timeline.kill();
    timeline = null;
    if (!window.gsap) return;
    const seconds = state.reduced ? .9 : STEP_SECONDS;
    timeline = gsap.timeline({ paused: true, onUpdate() {
      let t = state.reduced ? Math.floor(clock.t + 1e-7) : clock.t;
      if (state.stopAt !== null && t >= state.stopAt) {
        t = state.stopAt;
        timeline.pause().time(t * seconds, true);
        clock.t = t;
        state.playing = false;
        state.stopAt = null;
      }
      state.t = Math.min(t, state.trace.duration);
      render();
      saveLink();
      if (!state.playing) saveLink(true);
    }, onComplete() {
      state.t = state.trace.duration;
      clock.t = state.t;
      pause();
      render();
    } });
    clock.t = 0;
    timeline.fromTo(clock, { t: 0 }, { t: state.trace.duration, duration: state.trace.duration * seconds, ease: 'none', immediateRender: true, lazy: false });
    timeline.timeScale(state.speed);
    timeline.time(state.t * seconds, true);
    clock.t = state.t;
  }
  function play(stopAt = null) {
    if (!timeline) return;
    if (state.t >= state.trace.duration) seek(0);
    state.stopAt = stopAt;
    state.playing = true;
    timeline.play();
    updateButtons();
  }
  function togglePlay() { if (state.playing) pause(); else play(); }
  function step(direction) {
    const target = direction > 0 ? Math.floor(state.t + 1e-6) + 1 : Math.ceil(state.t - 1e-6) - 1;
    if (direction > 0 && !state.reduced && timeline && target <= state.trace.duration) {
      pause();
      play(target);
    } else seek(target);
  }
  function findPartition() {
    const snapshot = state.t === 0 ? state.trace.initial : state.trace.events[Math.ceil(state.t) - 1].after;
    const activeId = snapshot.stack[snapshot.stack.length - 1];
    return state.trace.events.find((event, index) => index + 1 > state.t + 1e-6 && event.kind === 'place' && (!activeId || event.nodeId === activeId));
  }

  function buildStage() {
    ['range-layer', 'slot-layer', 'token-layer', 'focus-layer', 'pointer-layer', 'tag-layer', 'tree-links', 'tree-nodes', 'stack-frames'].forEach(id => $(id).replaceChildren());
    visual = { slots: [], tokens: new Map(), focus: [], pointers: [], nodes: new Map(), links: new Map(), stack: new Map() };
    visual.range = el('rect', { y: 131, height: 94, rx: 13, fill: '#e9f1ed', 'fill-opacity': '.5', stroke: '#8eae9a', 'stroke-width': 1 }, $('range-layer'));
    const n = state.values.length;
    state.values.forEach((value, index) => {
      const x = C.cellX(index, n);
      const group = el('g', {}, $('slot-layer'));
      const rect = el('rect', { x: x - 30, y: 148, width: 60, height: 60, rx: 9, class: 'slot' }, group);
      const hole = el('text', { x, y: 182, class: 'hole-label' }, group); hole.textContent = '坑';
      el('text', { x, y: 241, class: 'index-label' }, group).textContent = `[${index}]`;
      const mark = el('text', { x: x + 20, y: 141, class: 'lock-mark', opacity: 0 }, group); mark.textContent = '✓';
      visual.slots.push({ rect, hole, mark });
      visual.focus.push(el('rect', { x: x - 34, y: 144, width: 68, height: 68, rx: 12, fill: 'none', stroke: '#34675b', 'stroke-width': 2, opacity: 0 }, $('focus-layer')));
    });
    state.trace.initial.cells.forEach((token, index) => {
      const group = el('g', { class: 'token', 'data-token': token.id }, $('token-layer'));
      const rect = el('rect', { x: -30, y: -30, width: 60, height: 60, rx: 9 }, group);
      el('text', { x: 0, y: -1 }, group).textContent = token.value;
      // A small identity label makes equal keys independently traceable.
      const identity = el('text', { x: 0, y: 20, class: 'identity' }, group);
      identity.textContent = state.values.filter(value => value === token.value).length > 1 ? `原位 ${index}` : '';
      visual.tokens.set(token.id, { group, rect });
    });
    ['i', 'j'].forEach((name, index) => {
      const group = el('g', {}, $('pointer-layer'));
      const y = index === 0 ? 263 : 291;
      el('path', { d: 'M-4,4 L0,0 L4,4', fill: 'none', stroke: index === 0 ? '#34675b' : '#976c25', 'stroke-width': 1.5 }, group);
      const label = el('text', { y: 17, class: 'pointer-label' }, group);
      const nameSpan = el('tspan', { class: 'pointer-name' }, label); nameSpan.textContent = name;
      const hint = el('tspan', { dx: 6 }, label); hint.textContent = index === 0 ? '→ 找 > 基准' : '← 找 < 基准';
      visual.pointers.push({ group, y });
    });
    visual.tag = el('g', {}, $('tag-layer'));
    el('rect', { x: -68, y: -17, width: 136, height: 28, rx: 5, fill: '#f7f0df', stroke: '#ded0b1' }, visual.tag);
    visual.tagText = el('text', { y: 1, class: 'tag-text' }, visual.tag);
    buildTree();
  }
  function buildTree() {
    const nodes = state.trace.nodes;
    const positions = new Map();
    const children = id => nodes.filter(node => node.parentId === id);
    let leaves = 0;
    function layout(node) {
      const kids = children(node.id);
      const xs = kids.map(layout);
      const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : 68 + leaves++ * 122;
      positions.set(node.id, { x, y: 38 + (node.depth - 1) * 76 });
      return x;
    }
    layout(nodes[0]);
    const width = Math.max(620, leaves * 122 + 14);
    const usedWidth = leaves * 122 + 14;
    const offset = (width - usedWidth) / 2;
    positions.forEach(pos => { pos.x += offset; });
    const height = Math.max(180, 86 + (Math.max(...nodes.map(node => node.depth)) - 1) * 76);
    attrs($('tree-svg'), { viewBox: `0 0 ${width} ${height}` });
    $('tree-svg').style.minWidth = `${width}px`;
    $('tree-svg').style.height = `${height}px`;
    const depth = state.trace.events[state.trace.events.length - 1].after.maxDepth;
    attrs($('stack-svg'), { viewBox: `0 0 330 ${Math.max(180, depth * 48 + 30)}` });
    $('stack-svg').style.height = `${Math.max(180, depth * 48 + 30)}px`;
    nodes.forEach(node => {
      const pos = positions.get(node.id);
      if (node.parentId !== null) {
        const parent = positions.get(node.parentId);
        const line = el('path', { d: `M${parent.x},${parent.y + 24} V${parent.y + 38} H${pos.x} V${pos.y - 24}`, fill: 'none', stroke: '#9aaf9e', 'stroke-width': 1.2 }, $('tree-links'));
        visual.links.set(node.id, line);
      }
      const group = el('g', { transform: `translate(${pos.x} ${pos.y})`, class: 'tree-node', role: 'button', tabindex: 0, 'data-node': node.id }, $('tree-nodes'));
      const rect = el('rect', { x: -53, y: -24, width: 106, height: 48, rx: 8 }, group);
      const label = el('text', { y: -3, class: 'node-label' }, group);
      const status = el('text', { y: 14, class: 'node-state' }, group);
      visual.nodes.set(node.id, { group, rect, label, status, node });
      const frame = el('g', { class: 'stack-frame' }, $('stack-frames'));
      const box = el('rect', { x: 3, y: 0, width: 324, height: 40, rx: 6 }, frame);
      el('text', { x: 15, y: 25 }, frame).textContent = `QS(${node.low}, ${node.high})`;
      const frameStatus = el('text', { x: 309, y: 25, 'text-anchor': 'end', class: 'frame-state' }, frame);
      visual.stack.set(node.id, { group: frame, box, status: frameStatus });
    });
  }
  function render() {
    const frame = C.sample(state.trace, state.t);
    attrs($('array-svg'), { 'data-time': state.t.toFixed(5) });
    attrs(visual.range, { x: frame.range.x, width: frame.range.width, opacity: frame.range.alpha });
    frame.slots.forEach((slot, i) => {
      const view = visual.slots[i];
      attrs(view.rect, { 'stroke-dasharray': slot.hole > .5 ? '4 3' : 'none' });
      attrs(view.hole, { opacity: slot.hole });
      attrs(view.mark, { opacity: slot.locked });
      attrs(visual.focus[i], { opacity: frame.focus.indices.includes(i) ? frame.focus.alpha : 0 });
    });
    frame.tokens.forEach(token => {
      const view = visual.tokens.get(token.id);
      attrs(view.group, { transform: `translate(${token.x} ${token.y})`, opacity: token.dim });
      const fill = C.mix(C.mix('#ffffff', '#e4eee2', token.locked), '#f4e8cf', token.pivot);
      const stroke = C.mix(C.mix('#c9d1c5', '#92b095', token.locked), '#b48b48', token.pivot);
      attrs(view.rect, { fill, stroke });
    });
    // The moving object is drawn over stationary chips, never duplicated.
    const moving = frame.tokens.find(token => token.y !== 178 && token.y !== 73);
    if (moving) $('token-layer').appendChild(visual.tokens.get(moving.id).group);
    frame.pointers.forEach((pointer, i) => attrs(visual.pointers[i].group, { transform: `translate(${pointer.x} ${visual.pointers[i].y})`, opacity: pointer.alpha }));
    attrs($('flight-path'), { d: frame.path.d, opacity: frame.path.alpha });
    attrs(visual.tag, { transform: `translate(${frame.tag.x} ${frame.tag.y})`, opacity: frame.tag.alpha });
    setText(visual.tagText, frame.tag.text);
    textView($('range-label'), frame.rangeLabel);
    textView($('narration'), frame.caption);
    textView($('phase-name'), frame.phase);
    ['comparisons', 'moves'].forEach(key => textView($(`stat-${key}`), frame.stats[key]));
    textView($('stat-locked'), frame.locked);
    textView($('max-depth'), frame.stats.maxDepth);
    textView($('stack-depth'), frame.depth);
    setText($('step-counter'), String(Math.floor(state.t + 1e-6)).padStart(3, '0'));
    setText($('time-label'), `${state.t.toFixed(state.reduced ? 0 : 1)} / ${state.trace.duration}`);
    $('progress').value = state.t;
    frame.nodes.forEach(entry => {
      const view = visual.nodes.get(entry.id), node = view.node;
      attrs(view.rect, { fill: entry.fill, stroke: entry.stroke, 'stroke-width': entry.status === 'active' ? 1.8 : 1 });
      attrs(view.label, { opacity: entry.textAlpha }); attrs(view.status, { opacity: entry.textAlpha });
      setText(view.label, entry.status === 'future' ? '· · ·' : node.low > node.high ? `空 [${node.low}..${node.high}]` : `A[${node.low}..${node.high}]`);
      setText(view.status, entry.label);
      const visited = state.t + 1e-6 >= node.entry;
      attrs(view.group, { 'aria-label': visited ? `回看调用 A[${node.low}..${node.high}]` : '尚未执行的调用', 'aria-disabled': !visited, tabindex: visited ? 0 : -1 });
      if (visual.links.has(entry.id)) attrs(visual.links.get(entry.id), { opacity: entry.link });
    });
    frame.stack.forEach(entry => {
      const view = visual.stack.get(entry.id);
      attrs(view.group, { transform: `translate(0 ${entry.y})`, opacity: entry.alpha });
      attrs(view.box, { fill: C.mix('#f2f2ec', '#e3eee7', entry.active), stroke: C.mix('#dedfd5', '#86a994', entry.active) });
      setText(view.status, entry.active > .5 ? '← 栈顶' : '等待返回');
    });
    const stackAmount = frame.stack.reduce((sum, entry) => sum + entry.alpha, 0);
    attrs($('stack-empty'), { opacity: 1 - Math.min(1, stackAmount) });
    setText($('stack-empty'), state.t >= state.trace.duration ? '全部调用已返回' : '尚无调用');
    setText($('stack-note'), state.mode === 'single' ? '单趟只完成一个基准的划分' : state.t >= state.trace.duration ? '左右子区间均已完成，根调用返回' : '当前调用结束后，回到它的父调用');
    updateButtons();
  }
  function load(values, mode = state.mode, keep = state.t) {
    if (timeline) timeline.kill();
    timeline = null;
    state.playing = false;
    state.stopAt = null;
    state.values = values.slice(); state.mode = mode;
    state.trace = M.buildTrace(state.values, mode);
    state.t = Math.max(0, Math.min(keep, state.trace.duration));
    if (state.reduced) state.t = Math.round(state.t);
    $('input-array').value = state.values.join(', ');
    const preset = Object.keys(M.PRESETS).find(key => M.PRESETS[key].join(',') === values.join(','));
    $('preset-select').value = preset || 'custom';
    $('input-array').removeAttribute('aria-invalid'); setText($('input-error'), '');
    $('mode-recursive').setAttribute('aria-pressed', mode === 'recursive');
    $('mode-single').setAttribute('aria-pressed', mode === 'single');
    $('progress').max = state.trace.duration;
    $('reduce-motion').checked = state.reduced;
    $('speed-select').value = state.speed;
    document.body.dataset.reduced = state.reduced;
    $('tree-hint').textContent = mode === 'single' ? '本模式只执行根区间的一次划分' : '点击已调用节点，回看入口';
    buildStage(); makeTimeline(); render(); saveLink(true);
  }

  $('btn-play').addEventListener('click', togglePlay);
  $('btn-reset').addEventListener('click', () => seek(0));
  $('btn-prev').addEventListener('click', () => step(-1));
  $('btn-next').addEventListener('click', () => step(1));
  $('progress').addEventListener('input', event => seek(event.target.value));
  $('btn-partition').addEventListener('click', () => {
    const event = findPartition();
    if (event) seek(state.trace.events.indexOf(event) + 1);
  });
  $('speed-select').addEventListener('change', event => {
    state.speed = Number(event.target.value);
    if (timeline) timeline.timeScale(state.speed);
    saveLink(true);
  });
  function changeMotion(reduced) {
    const playing = state.playing, stopAt = state.stopAt;
    if (timeline) timeline.pause();
    state.reduced = reduced;
    if (reduced) state.t = Math.floor(state.t);
    document.body.dataset.reduced = reduced;
    $('reduce-motion').checked = reduced;
    makeTimeline(); render();
    if (playing) play(stopAt);
    saveLink(true);
  }
  $('reduce-motion').addEventListener('change', event => { motionOverride = true; changeMotion(event.target.checked); });
  systemMotion.addEventListener('change', event => { if (!motionOverride) changeMotion(event.matches); });
  $('mode-recursive').addEventListener('click', () => { if (state.mode !== 'recursive') load(state.values, 'recursive'); });
  $('mode-single').addEventListener('click', () => { if (state.mode !== 'single') load(state.values, 'single'); });
  $('preset-select').addEventListener('change', event => {
    if (event.target.value === 'custom') { $('input-array').focus(); $('input-array').select(); }
    else load(M.PRESETS[event.target.value]);
  });
  $('data-form').addEventListener('submit', event => {
    event.preventDefault();
    const parsed = M.parseInput($('input-array').value);
    if (parsed.error) {
      setText($('input-error'), parsed.error); $('input-array').setAttribute('aria-invalid', 'true'); $('input-array').focus(); return;
    }
    load(parsed.values);
  });
  $('btn-random').addEventListener('click', () => load(Array.from({ length: 7 }, () => 10 + Math.floor(Math.random() * 89))));
  function jumpNode(target) {
    const group = target.closest('[data-node]');
    if (!group || group.getAttribute('aria-disabled') === 'true') return;
    const node = state.trace.nodes.find(node => node.id === group.dataset.node);
    seek(node.entry);
  }
  $('tree-nodes').addEventListener('click', event => jumpNode(event.target));
  $('tree-nodes').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); jumpNode(event.target); }
  });
  document.addEventListener('keydown', event => {
    if (event.target.closest('input, select, textarea, button, a, [role="button"]') || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
    if (event.code === 'ArrowRight') { event.preventDefault(); step(1); }
    if (event.code === 'ArrowLeft') { event.preventDefault(); step(-1); }
    if (event.code === 'Home') { event.preventDefault(); seek(0); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => { pause(); if (timeline) timeline.kill(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { makeTimeline(); render(); } });
  const initialTime = Number(linked.get('t'));
  load(state.values, state.mode, Number.isFinite(initialTime) ? initialTime : 0);
})();
