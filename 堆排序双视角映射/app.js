(function () {
  'use strict';
  const M = window.HeapModel, C = window.HeapChoreo;
  const $ = id => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SECONDS = 1.35;
  const phases = { ready: '给出输入序列', place: '① 层序建树 · 尚未调整',
    build: '② 自底向上调整成堆', sort: '③ 堆排序 · 交换与重整', done: '④ 输出完整结果' };
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const link = new URLSearchParams(location.hash.slice(1));
  const number = (s, fallback, min, max) => s !== null && Number.isFinite(Number(s))
    ? Math.max(min, Math.min(max, Number(s))) : fallback;
  function readValues() {
    const values = (link.get('a') || '').split(',').map(Number);
    return values.length === 7 && values.every(v => Number.isFinite(v) && Math.abs(v) <= 999)
      ? values : M.DEFAULT_VALUES.slice();
  }
  let values = readValues(), mode = link.get('mode') === 'min' ? 'min' : 'max';
  let reduced = link.has('motion') ? link.get('motion') === 'reduced' : media.matches;
  let speed = number(link.get('speed'), 1, 0.5, 2);
  let seq, time = 0, timeline = null, reducedCall = null, playing = false;
  let stopAt = null, direction = 1, hoverId = null, lastLinkWrite = 0;
  let frame, clock = { t: 0 }, nodes = [], cells = [], edges = [], mappings = [];
  const dom = {
    progress: $('progress-slider'), speed: $('speed-slider'), motion: $('reduce-motion'),
    play: $('btn-play'), prev: $('btn-prev'), next: $('btn-next'),
    title: $('action-title'), phase: $('phase-badge'), message: $('terminal-text'),
    count: $('step-counter'), readout: $('time-readout'), tag: $('event-tag'),
    guide: $('focus-guide'), mappings: $('mapping-lines'), result: $('sort-result'),
    stats: { heap: $('hud-heap'), locked: $('hud-locked'), comp: $('hud-comp'), swaps: $('hud-swap') }
  };
  function svg(tag, attrs = {}, text = null) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text !== null) el.textContent = text;
    return el;
  }
  function attr(el, name, value) {
    const next = String(value);
    if (el.getAttribute(name) !== next) el.setAttribute(name, next);
  }
  function text(el, value) {
    const next = String(value);
    if (el.textContent !== next) el.textContent = next;
  }
  function show(el, alpha) {
    attr(el, 'opacity', alpha);
    attr(el, 'visibility', alpha > 0.001 ? 'visible' : 'hidden');
  }
  function drawText(el, view, translate = false) {
    text(el, view.text);
    el.style.opacity = view.alpha;
    if (translate) el.style.transform = `translateY(${view.dy}px)`;
  }
  const colors = { white: [255, 255, 255], border: [199, 205, 193],
    blue: [37, 99, 235], blueFill: [235, 242, 255], gold: [168, 116, 37],
    goldFill: [252, 241, 219], green: [62, 125, 97], greenFill: [232, 243, 235] };
  function mix(a, b, q) { return a.map((v, i) => Math.round(v + (b[i] - v) * q)); }
  function rgb(v) { return `rgb(${v.join(',')})`; }
  function palette(item) {
    let fill = mix(colors.white, colors.blueFill, item.focus);
    let stroke = mix(colors.border, colors.blue, item.focus);
    fill = mix(fill, colors.goldFill, item.selected);
    stroke = mix(stroke, colors.gold, item.selected);
    fill = mix(fill, colors.greenFill, item.locked);
    stroke = mix(stroke, colors.green, item.locked);
    return { fill: rgb(fill), stroke: rgb(stroke) };
  }
  function entity(item, type) {
    const group = svg('g', { class: type === 'tree' ? 'node' : 'cell', tabindex: '0',
      role: 'img', 'data-id': item.id });
    const shape = type === 'tree'
      ? svg('circle', { r: 28, class: 'item-shape' })
      : svg('rect', { x: -35, y: -28, width: 70, height: 56, rx: 9, class: 'item-shape' });
    const value = svg('text', { class: 'value', y: type === 'tree' ? -1 : -4 }, item.value);
    const label = type === 'tree'
      ? svg('text', { class: 'tree-index', y: 45 })
      : svg('text', { class: 'lock-mark', y: 19 }, '归位');
    group.append(shape, value, label);
    group.addEventListener('mouseenter', () => { hoverId = item.id; renderMapping(); });
    group.addEventListener('mouseleave', () => { hoverId = null; renderMapping(); });
    group.addEventListener('focus', () => { hoverId = item.id; renderMapping(); });
    group.addEventListener('blur', () => { hoverId = null; renderMapping(); });
    return { group, shape, value, label };
  }
  function buildStage() {
    for (const id of ['tree-nodes', 'array-cells', 'tree-slots', 'array-slots', 'edges-group', 'mapping-lines']) $(id).replaceChildren();
    nodes = []; cells = []; edges = []; mappings = [];
    seq.items.forEach((item, i) => {
      const node = entity(item, 'tree'), cell = entity(item, 'array');
      nodes[item.id] = node; cells[item.id] = cell;
      const mapping = svg('path', { class: 'mapping-line', 'data-id': item.id, fill: 'none',
        stroke: '#2563eb', 'stroke-width': 1.6, 'stroke-dasharray': '4 5', 'pointer-events': 'none' });
      mappings[item.id] = mapping; dom.mappings.append(mapping);
      $('tree-nodes').append(node.group); $('array-cells').append(cell.group);
      const tree = C.treePoint(i), array = C.arrayPoint(i, values.length);
      $('tree-slots').append(svg('circle', { cx: tree.x, cy: tree.y, r: 28,
        fill: 'none', stroke: '#e5e7de', 'stroke-dasharray': '3 5' }));
      const slot = svg('g');
      slot.append(svg('rect', { x: array.x - 35, y: array.y - 28, width: 70, height: 56, rx: 9, class: 'slot-rect' }),
        svg('text', { x: array.x, y: 507, class: 'slot-index' }, `A[${i}]`));
      $('array-slots').append(slot);
      if (i > 0) {
        const parent = C.treePoint(Math.floor((i - 1) / 2));
        const dx = tree.x - parent.x, dy = tree.y - parent.y, d = Math.hypot(dx, dy);
        const line = svg('line', { x1: parent.x + dx / d * 30, y1: parent.y + dy / d * 30,
          x2: tree.x - dx / d * 30, y2: tree.y - dy / d * 30, 'stroke-width': 1.5 });
        edges[i] = line; $('edges-group').append(line);
      }
    });
    text($('data-badge'), values.join(' · '));
    $('mode-max').setAttribute('aria-pressed', String(mode === 'max'));
    $('mode-min').setAttribute('aria-pressed', String(mode === 'min'));
    dom.progress.max = seq.duration;
    text($('result-heading'), `完整排序结果 · ${mode === 'max' ? '升序' : '降序'}`);
    text($('result-values'), `[${seq.events.at(-1).after.order.map(id => seq.items[id].value).join(', ')}]`);
  }
  function renderZones(heap) {
    const n = values.length, first = C.arrayPoint(0, n), gap = C.arrayPoint(1, n).x - first.x;
    const left = first.x - 42, right = C.arrayPoint(n - 1, n).x + 42;
    const boundary = heap <= 0 ? left : heap >= n ? right : first.x + (heap - 0.5) * gap;
    const draw = (id, a, b, label) => {
      const group = $(id), alpha = Math.min(1, Math.max(0, (b - a) / 45));
      show(group, alpha);
      attr(group.querySelector('path'), 'd', `M${a},526 v6 H${b} v-6`);
      attr(group.querySelector('text'), 'x', (a + b) / 2);
      text(group.querySelector('text'), label);
    };
    const pending = frame.phase.text === 'ready' || frame.phase.text === 'place';
    draw('zone-active', left, boundary, pending ? '输入序列 · 尚未调整成堆' : '活动堆');
    draw('zone-locked', boundary, right, '已归位 · 不再参与');
  }
  function renderMapping() {
    if (!frame) return;
    const labels = [];
    for (const item of frame.items) {
      const a = item.tree, b = item.array, hovered = hoverId === item.id;
      const alpha = Math.max(item.mapping * 0.55, hovered ? 0.8 : 0) * a.alpha;
      const line = mappings[item.id];
      attr(line, 'd', `M${a.x},${a.y + 31} C${a.x},${a.y + 75} ${b.x},${b.y - 82} ${b.x},${b.y - 32}`);
      show(line, alpha);
      if (alpha > 0.2) labels.push(`${item.value} ↔ A[${item.slot.text}]`);
    }
    text($('mapping-label'), labels.length ? labels.join(' · ') : '树 ↔ 数组 · 同步映射');
  }
  function render(t = time) {
    time = Math.max(0, Math.min(seq.duration, t));
    frame = C.sample(seq, time, reduced);
    for (const item of frame.items) {
      const node = nodes[item.id], cell = cells[item.id], paint = palette(item);
      attr(node.group, 'transform', `translate(${item.tree.x} ${item.tree.y})`);
      attr(cell.group, 'transform', `translate(${item.array.x} ${item.array.y})`);
      show(node.group, item.tree.alpha);
      attr(node.group, 'tabindex', item.tree.alpha > 0.5 ? 0 : -1);
      attr(node.group, 'aria-hidden', item.tree.alpha <= 0.01);
      for (const el of [node, cell]) {
        attr(el.shape, 'fill', paint.fill); attr(el.shape, 'stroke', paint.stroke);
        attr(el.group, 'aria-label', `数值 ${item.value}，下标 ${item.slot.text}${item.locked > 0.5 ? '，已归位' : ''}`);
      }
      text(node.label, `A[${item.slot.text}]`);
      node.label.style.opacity = item.slot.alpha;
      show(cell.label, item.locked);
    }
    for (const edge of frame.edges) {
      show(edges[edge.slot], edge.alpha);
      attr(edges[edge.slot], 'stroke', rgb(mix([209, 215, 202], colors.blue, edge.active)));
      attr(edges[edge.slot], 'stroke-width', 1.5 + edge.active);
    }
    attr(dom.guide, 'cx', frame.guide.x); attr(dom.guide, 'cy', frame.guide.y);
    show(dom.guide, frame.guide.alpha * 0.65);
    attr(dom.tag, 'transform', `translate(${frame.tagPosition.x} ${frame.tagPosition.y + frame.tag.dy})`);
    show(dom.tag, frame.tag.text ? frame.tag.alpha : 0);
    text(dom.tag.querySelector('text'), frame.tag.text);
    drawText(dom.title, frame.title);
    drawText(dom.phase, { ...frame.phase, text: phases[frame.phase.text] || frame.phase.text });
    drawText($('heap-caption'), { ...frame.phase,
      text: ['ready', 'place'].includes(frame.phase.text) ? '待排序' : '活动堆' });
    drawText($('tree-count'), { ...frame.treeCount, text: `树中节点 ${frame.treeCount.text} / ${values.length}` });
    frame.stages.forEach((q, i) => {
      const button = $(`process-${i}`);
      button.style.setProperty('--phase', q);
      button.setAttribute('aria-current', q > 0.5 ? 'step' : 'false');
    });
    show(dom.result, frame.completed);
    attr(dom.result, 'aria-hidden', frame.completed <= 0.001);
    show($('tree-slots'), 1 - frame.completed);
    drawText(dom.message, frame.message);
    for (const [key, view] of Object.entries(frame.counters)) drawText(dom.stats[key], view, true);
    frame.trio.forEach((q, i) => {
      const el = $(`trio-${i + 1}`);
      el.style.setProperty('--active', q);
      el.style.setProperty('--active-bg', q * 0.065);
      el.style.color = rgb(mix([107, 112, 102], colors.blue, q));
      el.setAttribute('aria-current', q > 0.5 ? 'step' : 'false');
    });
    text(dom.count, String(Math.floor(time + 0.00001)).padStart(2, '0'));
    text(dom.readout, `${time.toFixed(1)} / ${seq.duration}`);
    dom.progress.value = time;
    dom.progress.setAttribute('aria-valuetext', `第 ${time.toFixed(1)} 步，共 ${seq.duration} 步，${frame.title.text}`);
    dom.prev.disabled = time <= 0;
    dom.next.disabled = time >= seq.duration;
    renderZones(frame.heap); renderMapping();
    saveLink(false);
  }
  function saveLink(immediate) {
    const now = performance.now();
    if (!immediate && now - lastLinkWrite < 300) return;
    lastLinkWrite = now;
    const hash = new URLSearchParams({ a: values.join(','), mode, t: time.toFixed(3),
      speed: speed.toFixed(1), motion: reduced ? 'reduced' : 'full' });
    try { history.replaceState(null, '', '#' + hash); } catch { /* 本地浏览器限制不影响演示 */ }
  }
  function playingUI() {
    document.body.dataset.playing = String(playing);
    text($('play-label'), playing ? '暂停' : '播放');
    text($('play-icon'), playing ? 'Ⅱ' : '▶');
    dom.play.setAttribute('aria-label', playing ? '暂停' : '播放');
  }
  function pause() {
    playing = false;
    if (timeline) timeline.pause();
    if (reducedCall) { reducedCall.kill(); reducedCall = null; }
    stopAt = null;
    playingUI(); saveLink(true);
  }
  function seek(t) {
    pause();
    const target = Math.max(0, Math.min(seq.duration, reduced ? Math.round(t) : t));
    if (timeline) timeline.time(target * SECONDS, true);
    clock.t = target;
    render(target); saveLink(true);
  }
  function updateClock() {
    let target = clock.t;
    const reached = stopAt !== null && (direction > 0 ? target >= stopAt : target <= stopAt);
    if (reached) {
      target = stopAt;
      timeline.pause().time(target * SECONDS, true);
      clock.t = target;
    }
    render(target);
    if (reached) pause();
  }
  function reducedTick() {
    if (!playing) return;
    reducedCall = window.gsap.delayedCall(0.9, () => {
      reducedCall = null;
      const target = Math.min(seq.duration, Math.floor(time + 0.00001) + 1);
      timeline.time(target * SECONDS, true); clock.t = target; render(target);
      if (target >= seq.duration) pause(); else reducedTick();
    }).timeScale(speed);
  }
  function play() {
    if (!timeline) return;
    if (time >= seq.duration) seek(0);
    stopAt = null; direction = 1; playing = true; playingUI();
    if (reduced) reducedTick(); else timeline.play();
  }
  function step(delta) {
    pause();
    const target = delta > 0 ? Math.min(seq.duration, Math.floor(time + 0.00001) + 1)
      : Math.max(0, Math.ceil(time - 0.00001) - 1);
    if (!timeline || reduced || Math.abs(target - time) < 0.00001) { seek(target); return; }
    stopAt = target; direction = delta; playing = true; playingUI();
    if (delta > 0) timeline.play(); else timeline.reverse();
  }
  function load(keep) {
    pause();
    if (timeline) timeline.kill();
    seq = M.buildSequence(values, mode);
    clock = { t: 0 }; hoverId = null;
    buildStage();
    timeline = window.gsap ? window.gsap.timeline({ paused: true, onUpdate: updateClock,
      onComplete: pause, onReverseComplete: pause }).to(clock, {
      t: seq.duration, duration: seq.duration * SECONDS, ease: 'none'
    }).timeScale(speed) : null;
    seek(Math.min(keep, seq.duration));
  }
  function setMotion(next) {
    const resume = playing;
    pause(); reduced = next;
    document.body.dataset.motion = reduced ? 'reduced' : 'full';
    dom.motion.checked = reduced;
    seek(reduced ? Math.ceil(time) : time);
    if (resume && time < seq.duration) play();
  }
  $('btn-reset').addEventListener('click', () => seek(0));
  dom.prev.addEventListener('click', () => step(-1));
  dom.next.addEventListener('click', () => step(1));
  dom.play.addEventListener('click', () => playing ? pause() : play());
  dom.progress.addEventListener('input', () => seek(Number(dom.progress.value)));
  dom.speed.addEventListener('input', () => {
    speed = Number(dom.speed.value);
    text($('speed-value'), `${speed.toFixed(1)}×`);
    if (timeline) timeline.timeScale(speed);
    if (reducedCall) reducedCall.timeScale(speed);
    saveLink(true);
  });
  dom.motion.addEventListener('change', () => setMotion(dom.motion.checked));
  media.addEventListener('change', event => setMotion(event.matches));
  for (const nextMode of ['max', 'min']) $(`mode-${nextMode}`).addEventListener('click', () => {
    if (mode === nextMode) return;
    const keep = time; mode = nextMode; load(keep);
  });
  $('btn-random').addEventListener('click', () => {
    const keep = time;
    const pool = Array.from({ length: 90 }, (_, i) => i + 10);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    values = pool.slice(0, 7); load(keep);
  });
  document.querySelectorAll('[data-seek], [data-stage]').forEach(button => button.addEventListener('click', () => {
    const endOf = kind => seq.events.findIndex(event => event.kind === kind) + 1;
    const targets = { start: 0, tree: endOf('treeDone'), adjust: endOf('focus'),
      built: endOf('buildDone'), sort: endOf('sortStart'), done: seq.duration };
    seek(targets[button.dataset.seek || button.dataset.stage]);
  }));
  window.addEventListener('keydown', event => {
    if (event.target instanceof Element && event.target.closest('input, select, textarea, button, a, [tabindex="0"]')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); playing ? pause() : play(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    else if (event.key === 'Home') { event.preventDefault(); seek(0); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', pause);
  window.addEventListener('beforeunload', () => { pause(); if (timeline) timeline.kill(); });
  dom.play.disabled = !window.gsap;
  $('engine-notice').hidden = !!window.gsap;
  dom.speed.value = speed;
  text($('speed-value'), `${speed.toFixed(1)}×`);
  dom.motion.checked = reduced;
  document.body.dataset.motion = reduced ? 'reduced' : 'full';
  load(number(link.get('t'), 0, 0, 10000));
})();
