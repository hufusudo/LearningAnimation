(function () {
  'use strict';
  const M = window.PrimModel, C = window.PrimChoreo;
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const phases = { ready: '首都／割集就绪', choose: '选出最小边', connect: '修通道路', annex: '吞并新领土', done: '构建完成', blocked: '图不连通' };
  const palette = { normal: '#c5cbbf', cut: '#967029', active: '#315fc3', tree: '#2d7d62', ink: '#343c38' };
  const url = new URLSearchParams(location.hash.slice(1));
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let preset = Object.hasOwn(M.PRESETS, url.get('map')) ? url.get('map') : 'classic';
  let capital = url.get('capital') || 'A';
  let reduced = url.has('motion') ? url.get('motion') === 'reduced' : media.matches;
  let speed = [0.5, 1, 1.5, 2].includes(Number(url.get('speed'))) ? Number(url.get('speed')) : 1;
  let run, timeline, delay, playing = false, segmentTarget = null, lastLink = 0;
  const clock = { t: 0 };
  let nodes = new Map(), edges = new Map(), rows = new Map(), geometries = new Map();
  const set = (el, attrs) => { for (const [key, value] of Object.entries(attrs)) { const v = String(value); if (el.getAttribute(key) !== v) el.setAttribute(key, v); } };
  const text = (el, value) => { const v = String(value); if (el.textContent !== v) el.textContent = v; };
  function svg(tag, attrs, content) {
    const el = document.createElementNS(NS, tag);
    if (attrs) set(el, attrs);
    if (content != null) text(el, content);
    return el;
  }
  const mix = (a, b, k) => {
    const rgb = hex => hex.match(/[a-f\d]{2}/gi).map(x => parseInt(x, 16));
    const x = rgb(a), y = rgb(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('');
  };
  function point(n) { return { x: 60 + n.x * 620, y: 50 + n.y * 380 }; }
  function geometry(edge, graph) {
    const a = point(graph.nodes.find(n => n.id === edge.u));
    const b = point(graph.nodes.find(n => n.id === edge.v));
    let bend = 0;
    if (preset === 'classic' && edge.id === 'A-D') bend = 85;
    if (preset === 'dense' && edge.id === 'A-E') bend = -95;
    if (preset === 'dense' && edge.id === 'A-F') bend = 95;
    if (preset === 'chain' && edge.index >= 6) bend = edge.index === 11 ? -160 : -50 - (edge.index - 6) * 12;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const control = { x: (a.x + b.x) / 2 - (b.y - a.y) / length * bend, y: (a.y + b.y) / 2 + (b.x - a.x) / length * bend };
    const path = (from, to) => `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`;
    const q = preset === 'classic' && edge.id === 'A-D' ? 0.28 : 0.5;
    const mid = { x: (1 - q) ** 2 * a.x + 2 * (1 - q) * q * control.x + q ** 2 * b.x,
      y: (1 - q) ** 2 * a.y + 2 * (1 - q) * q * control.y + q ** 2 * b.y };
    return { a, b, control, d: path(a, b), reverse: path(b, a), mid };
  }
  function buildStage() {
    for (const id of ['territory-shapes', 'land-guard-nodes', 'frontier-gates', 'edge-layer', 'weight-layer', 'node-layer', 'frontier-layer', 'focus-layer', 'road-layer']) $(id).replaceChildren();
    nodes = new Map(); edges = new Map(); rows = new Map(); geometries = new Map();
    $('road-layer').append(
      svg('path', { id: 'growing-road', fill: 'none', stroke: palette.tree, 'stroke-width': 4, 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': '1' }),
      svg('circle', { id: 'road-tip', r: 5, fill: palette.active, stroke: '#fff', 'stroke-width': 2 })
    );
    $('focus-layer').append(
      svg('circle', { id: 'node-focus', fill: 'none', stroke: palette.active, 'stroke-width': 1.5 }),
      svg('rect', { id: 'edge-focus', width: 40, height: 34, rx: 9, fill: 'none', stroke: palette.active, 'stroke-width': 1.5 })
    );
    run.graph.edges.forEach(edge => {
      const geo = geometry(edge, run.graph); geometries.set(edge.id, geo);
      const territory = svg('path', { 'data-land-edge': edge.id, d: geo.d, fill: 'none', 'stroke-width': 88, 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': '1' });
      $('territory-shapes').append(territory);
      const gate = svg('path', { 'data-frontier-edge': edge.id, d: geo.d, fill: 'none', 'stroke-width': 13, 'stroke-linecap': 'round' });
      $('frontier-gates').append(gate);
      const g = svg('g');
      const path = svg('path', { d: geo.d, fill: 'none', 'stroke-linecap': 'round' });
      const bg = svg('rect', { x: geo.mid.x - 13, y: geo.mid.y - 11, width: 26, height: 22, rx: 5, fill: '#fff', stroke: '#e5e4dc' });
      const weight = svg('text', { x: geo.mid.x, y: geo.mid.y + 0.5, class: 'weight' }, edge.w);
      g.append(path); $('edge-layer').append(g);
      $('weight-layer').append(bg, weight);
      geo.length = path.getTotalLength();
      edges.set(edge.id, { territory, gate, g, path, bg, weight, edge });
      const row = svg('g', { 'data-edge': edge.id });
      const rowBg = svg('rect', { x: 797, y: -14, width: 274, height: 29, rx: 5 });
      const arrow = svg('text', { x: 807, y: 1, fill: palette.active, 'font-size': 12 }, '›');
      const name = svg('text', { x: 828, y: 1, class: 'candidate-name' });
      const value = svg('text', { x: 1055, y: 1, class: 'candidate-weight' }, edge.w);
      row.append(rowBg, arrow, name, value); $('frontier-layer').append(row);
      rows.set(edge.id, { row, bg: rowBg, arrow, name, value, edge });
    });
    run.graph.nodes.forEach(n => {
      const pos = point(n);
      const territory = svg('circle', { 'data-land-node': n.id, cx: pos.x, cy: pos.y, r: 65, 'stroke-width': 0 });
      const guard = svg('circle', { 'data-guard-node': n.id, cx: pos.x, cy: pos.y, r: 48, fill: 'black' });
      $('territory-shapes').append(territory);
      $('land-guard-nodes').append(guard);
      const g = svg('g', { class: 'node', transform: `translate(${pos.x} ${pos.y})`, role: 'button', tabindex: 0, 'aria-label': `将 ${n.id} 设为首都`, 'data-node': n.id });
      const ring = svg('circle', { class: 'keyboard-ring', r: 33, fill: 'none', stroke: 'none' });
      const core = svg('circle', { r: 26, 'stroke-width': 1.5 });
      const name = svg('text', { class: 'node-name', y: 1 }, n.id);
      const state = svg('text', { class: 'node-state', y: 45 });
      g.append(ring, core, name, state); $('node-layer').append(g);
      g.addEventListener('click', () => changeParams(preset, n.id));
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); changeParams(preset, n.id); } });
      nodes.set(n.id, { territory, guard, g, core, name, state, pos });
    });
    $('capital').replaceChildren(...run.graph.nodes.map(n => {
      const option = document.createElement('option'); option.value = n.id; option.textContent = n.id; return option;
    }));
    $('capital').value = capital;
    document.querySelectorAll('[data-preset]').forEach(el => set(el, { 'aria-pressed': el.dataset.preset === preset }));
    const roundLabel = document.createElement('span'); roundLabel.textContent = '回合';
    $('round-links').replaceChildren(roundLabel, ...run.rounds.map(round => {
      const button = document.createElement('button'); button.textContent = round.round;
      button.title = `第 ${round.round} 回合：${round.from} → ${round.to}，成本 ${round.edge.w}`;
      button.setAttribute('aria-label', button.title); button.dataset.round = round.round;
      button.addEventListener('click', () => seek(round.start)); return button;
    }));
    $('progress').max = run.duration;
  }
  function writeLink(force = false) {
    if (!force && performance.now() - lastLink < 300) return;
    lastLink = performance.now();
    const hash = new URLSearchParams({ map: preset, capital, t: clock.t.toFixed(2), speed, motion: reduced ? 'reduced' : 'full' });
    try { history.replaceState(null, '', '#' + hash); } catch (_) { /* file:// may restrict history writes. */ }
  }
  function updateControls() {
    document.body.dataset.playing = playing;
    document.body.dataset.motion = reduced ? 'reduced' : 'full';
    text($('play-label'), playing ? 'Ⅱ 暂停' : clock.t >= run.duration ? '↻ 重播' : '▶ 播放');
    $('btn-step-prev').disabled = clock.t <= 0;
    $('btn-step-next').disabled = clock.t >= run.duration;
    $('btn-play').disabled = !window.gsap || run.duration === 0;
  }
  function render() {
    const v = C.sample(run, clock.t, reduced);
    const ownedMap = new Map(v.nodes.map(n => [n.id, n.owned]));
    v.nodes.forEach(n => {
      const el = nodes.get(n.id);
      set(el.core, { fill: mix('#ffffff', '#2d7d62', n.owned), stroke: mix('#aab3a3', '#2d7d62', n.owned) });
      set(el.name, { fill: mix(palette.ink, '#ffffff', n.owned) });
      set(el.territory, { r: 65 * n.owned, visibility: n.owned > 0 ? 'visible' : 'hidden' });
      set(el.guard, { opacity: 1 - n.owned });
      const annexing = n.owned > 0 && n.owned < 1;
      const pending = n.pending > 0 && n.pending < 1;
      const label = n.id === capital ? '首都 · 已入树' : n.owned >= 0.5 ? '已入树' : n.pending >= 0.5 ? '待并入' : '树外';
      text(el.state, label);
      set(el.state, { fill: n.owned >= 0.5 ? palette.tree : '#6b7066', opacity: annexing ? Math.abs(1 - 2 * n.owned) : pending ? Math.abs(1 - 2 * n.pending) : 1 });
      set(el.g, { 'aria-pressed': n.id === capital });
    });
    v.edges.forEach(e => {
      const el = edges.get(e.id);
      const internal = Math.min(ownedMap.get(el.edge.u), ownedMap.get(el.edge.v)) * (1 - e.tree);
      let color = mix(palette.normal, palette.cut, e.frontier);
      color = mix(color, palette.active, e.selected * (1 - e.tree));
      color = mix(color, palette.tree, e.tree);
      set(el.path, { stroke: color, 'stroke-width': 1.5 + e.frontier * 0.6 + e.tree * 2.5 + e.selected * (1 - e.tree), 'stroke-dasharray': e.tree >= 1 ? 'none' : e.frontier > 0.5 ? '5 6' : internal > 0.5 ? '3 6' : 'none', opacity: 1 - internal * 0.55 });
      set(el.bg, { fill: mix('#ffffff', '#edf4ee', e.tree), stroke: mix('#e5e4dc', color, Math.max(e.selected, e.tree) * 0.5) });
      set(el.weight, { fill: mix('#6b7066', color, Math.max(e.frontier, e.tree, e.selected)) });
      const geo = geometries.get(e.id);
      set(el.territory, { d: e.landFrom === el.edge.u ? geo.d : geo.reverse,
        'stroke-dashoffset': 1 - e.land, visibility: e.land > 0 ? 'visible' : 'hidden' });
      set(el.gate, { opacity: e.frontier, stroke: mix(palette.cut, palette.active, e.selected), 'stroke-width': 13 + 5 * e.selected });
    });
    v.rows.forEach(r => {
      const el = rows.get(r.id);
      text(el.name, `${r.from} → ${r.to}`);
      set(el.row, { transform: `translate(0 ${108 + r.y * 32})`, opacity: r.alpha, visibility: r.alpha > 0 ? 'visible' : 'hidden' });
      set(el.bg, { fill: mix('#f5f6f1', '#edf2fc', r.selected) });
      set(el.arrow, { opacity: r.selected });
      set(el.name, { fill: mix(palette.ink, palette.active, r.selected) });
      set(el.value, { fill: mix(palette.ink, palette.active, r.selected) });
    });
    set($('road-layer'), { visibility: v.road.alpha ? 'visible' : 'hidden' });
    if (!v.road.alpha) {
      set($('growing-road'), { d: 'M 0 0', 'stroke-dashoffset': 1 });
      set($('road-tip'), { cx: 0, cy: 0 });
    }
    if (v.road.alpha) {
      const geo = geometries.get(v.road.edge), edge = edges.get(v.road.edge).edge;
      const d = edge.u === v.road.from ? geo.d : geo.reverse;
      set($('growing-road'), { d, 'stroke-dashoffset': 1 - v.road.progress });
      // The leading dot travels along the actual road rather than a decorative arc.
      const q = edge.u === v.road.from ? v.road.progress : 1 - v.road.progress;
      const tip = edges.get(v.road.edge).path.getPointAtLength(q * geo.length);
      set($('road-tip'), { cx: tip.x, cy: tip.y });
    }
    set($('node-focus'), { opacity: v.focus.node ? v.focus.alpha : 0 });
    set($('edge-focus'), { opacity: v.focus.edge ? v.focus.alpha : 0 });
    if (!v.focus.node || !v.focus.alpha) set($('node-focus'), { cx: 0, cy: 0, r: 33 });
    if (!v.focus.edge || !v.focus.alpha) set($('edge-focus'), { x: 0, y: 0 });
    if (v.focus.alpha) {
      if (v.focus.node) {
        const pos = nodes.get(v.focus.node).pos;
        set($('node-focus'), { cx: pos.x, cy: pos.y, r: 33 + 4 * (1 - v.focus.alpha) });
      } else if (v.focus.edge) {
        const geo = geometries.get(v.focus.edge);
        set($('edge-focus'), { x: geo.mid.x - 20, y: geo.mid.y - 17 });
      }
    }
    const chosen = v.rows.find(r => r.selected > 0.1 && r.alpha > 0.1);
    if (chosen && v.focus.edge) {
      const mid = geometries.get(chosen.id).mid, y = 108 + chosen.y * 32;
      set($('decision-leader'), { d: `M 797 ${y} C 754 ${y}, 764 ${mid.y}, ${mid.x + 23} ${mid.y}`, opacity: 0.38 * v.focus.alpha });
    } else set($('decision-leader'), { d: 'M 0 0', opacity: 0 });
    if (v.tag.alpha) {
      const pos = v.tag.node ? nodes.get(v.tag.node).pos : geometries.get(v.tag.edge).mid;
      text($('event-text'), v.tag.text);
      set($('event-tag'), { transform: `translate(${pos.x} ${pos.y - (v.tag.node ? 54 : 35) + v.tag.dy})`, opacity: v.tag.alpha, visibility: 'visible' });
    } else {
      set($('event-tag'), { visibility: 'hidden', opacity: 0, transform: 'translate(0 0)' });
      text($('event-text'), '');
    }
    const count = Math.round(v.stats.edges), memberCount = Math.round(v.stats.owned);
    text($('time-label'), clock.t.toFixed(2));
    text($('phase-label'), phases[v.phase.text]); $('phase-label').style.opacity = v.phase.alpha;
    document.querySelectorAll('[data-phase]').forEach(el => set(el, { 'data-active': el.dataset.phase === (v.phase.text === 'ready' && count ? 'annex' : v.phase.text) }));
    text($('cost-total'), Math.round(v.stats.cost));
    text($('tree-count'), `${count} / ${run.graph.nodes.length - 1}`);
    text($('owned-count'), `${memberCount} / ${run.graph.nodes.length}`);
    text($('cut-count'), `${Math.round(v.stats.cut)} 条`);
    const visibleTree = v.edges.filter(e => e.tree === 1).map(e => e.id);
    const treeOrder = run.rounds.filter(r => visibleTree.includes(r.edge.id)).slice(0, count);
    text($('tree-route'), treeOrder.length ? treeOrder.map(r => `${r.from}—${r.to} (${r.edge.w})`).join('  +  ') : '尚未修路');
    const fractional = value => Math.abs(1 - 2 * (value - Math.floor(value)));
    $('tree-route').style.opacity = fractional(v.stats.edges);
    text($('set-label'), `S = { ${v.nodes.filter(n => n.owned >= 0.5).map(n => n.id).join(', ')} }`);
    const changingNode = v.nodes.find(n => n.owned > 0 && n.owned < 1);
    set($('set-label'), { opacity: changingNode ? fractional(changingNode.owned) : 1 });
    text($('round-label'), v.stats.round < 0.5 ? '起点' : `回合 ${Math.round(v.stats.round)}`);
    text($('hud-text'), v.message.text); $('hud-text').style.opacity = v.message.alpha;
    set($('frontier-empty'), { opacity: Math.max(v.done, v.blocked), visibility: Math.max(v.done, v.blocked) > 0 ? 'visible' : 'hidden' });
    text($('frontier-empty').firstElementChild, v.blocked > 0 ? '没有可达的新领土' : '全部领土已连接');
    set($('result-mark'), { opacity: v.done });
    text($('result-detail'), `${run.graph.nodes.length} 个顶点 · ${count} 条边 · 总成本 ${Math.round(v.stats.cost)}`);
    $('progress').value = clock.t;
    const completed = run.events.filter(e => e.end <= clock.t + 1e-7).length;
    text($('progress-label'), `${completed} / ${run.events.length} 步`);
    document.querySelectorAll('[data-round]').forEach(el => set(el, { 'aria-current': Number(el.dataset.round) === Math.round(v.stats.round) ? 'step' : 'false' }));
    updateControls(); writeLink();
  }
  function stop() {
    playing = false; segmentTarget = null;
    if (timeline) timeline.pause();
    if (delay) { delay.kill(); delay = null; }
    updateControls();
  }
  function nearestCompleted(t) {
    return run.boundaries.filter(b => b <= t + 1e-7).at(-1) || 0;
  }
  function seek(t) {
    stop();
    clock.t = Math.max(0, Math.min(run.duration, Number(t) || 0));
    if (reduced) clock.t = nearestCompleted(clock.t);
    if (timeline) timeline.time(clock.t, true);
    render(); writeLink(true);
  }
  function nextBoundary() { return run.boundaries.find(b => b > clock.t + 1e-6) ?? run.duration; }
  function previousBoundary() { return run.boundaries.filter(b => b < clock.t - 1e-6).at(-1) ?? 0; }
  function reducedTick() {
    if (!playing) return;
    const target = nextBoundary();
    clock.t = target;
    if (timeline) timeline.time(clock.t, true);
    render();
    if (target >= run.duration) { stop(); writeLink(true); return; }
    delay = gsap.delayedCall(0.9, reducedTick).timeScale(speed);
  }
  function play() {
    if (!window.gsap || !run.duration) return;
    if (clock.t >= run.duration) seek(0);
    playing = true; segmentTarget = null;
    if (reduced) { reducedTick(); return; }
    timeline.time(clock.t, true);
    timeline.timeScale(speed).play();
    updateControls();
  }
  function togglePlay() { if (playing) { stop(); writeLink(true); } else play(); }
  function step(direction) {
    const target = direction > 0 ? nextBoundary() : previousBoundary();
    if (direction < 0 || reduced || !window.gsap) { seek(target); return; }
    stop(); segmentTarget = target; playing = true;
    timeline.time(clock.t, true).timeScale(speed).play();
    updateControls();
  }
  function rebuild(t) {
    stop();
    if (timeline) { timeline.kill(); timeline = null; }
    const graph = M.makeGraph(preset);
    if (!graph.nodes.some(n => n.id === capital)) capital = graph.nodes[0].id;
    run = M.buildRun(graph, capital);
    buildStage();
    clock.t = Math.min(run.duration, Math.max(0, Number(t) || 0));
    if (reduced) clock.t = nearestCompleted(clock.t);
    if (window.gsap) {
      timeline = gsap.timeline({ paused: true, onUpdate: () => {
        if (segmentTarget !== null && clock.t >= segmentTarget) {
          const target = segmentTarget;
          stop(); timeline.time(target, true); clock.t = target;
          render(); writeLink(true); return;
        }
        render();
      }, onComplete: () => { stop(); render(); writeLink(true); } });
      timeline.fromTo(clock, { t: 0 }, { t: run.duration, duration: run.duration, ease: 'none', immediateRender: false });
      timeline.time(clock.t, true).timeScale(speed);
    }
    render(); writeLink(true);
  }
  function changeParams(map, start) { const keep = clock.t; preset = map; capital = start; rebuild(keep); }
  $('btn-reset').addEventListener('click', () => seek(0));
  $('btn-step-prev').addEventListener('click', () => step(-1));
  $('btn-step-next').addEventListener('click', () => step(1));
  $('btn-play').addEventListener('click', togglePlay);
  $('progress').addEventListener('input', e => seek(e.target.value));
  $('capital').addEventListener('change', e => changeParams(preset, e.target.value));
  document.querySelectorAll('[data-preset]').forEach(el => el.addEventListener('click', () => changeParams(el.dataset.preset, capital)));
  $('speed').value = speed;
  $('speed').addEventListener('change', e => {
    speed = Number(e.target.value);
    if (timeline) timeline.timeScale(speed);
    if (delay) delay.timeScale(speed);
    writeLink(true);
  });
  $('reduce-motion').checked = reduced;
  function changeMotion(value) {
    const resume = playing;
    stop(); reduced = value; $('reduce-motion').checked = reduced;
    if (reduced) clock.t = nearestCompleted(clock.t);
    if (timeline) timeline.time(clock.t, true);
    render(); writeLink(true);
    if (resume && clock.t < run.duration) play();
  }
  $('reduce-motion').addEventListener('change', e => changeMotion(e.target.checked));
  media.addEventListener('change', e => changeMotion(e.matches));
  document.addEventListener('keydown', e => {
    if (e.target instanceof Element && e.target.closest('input,select,textarea,button,a,[role="button"]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const actions = { Space: togglePlay, ArrowLeft: () => step(-1), ArrowRight: () => step(1), Home: () => seek(0) };
    if (actions[e.code]) { e.preventDefault(); actions[e.code](); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); writeLink(true); } });
  window.addEventListener('pagehide', event => {
    stop();
    // A BFCache document resumes the same controller; keep its paused timeline alive.
    if (!event.persisted && timeline) timeline.kill();
  });
  $('engine-notice').hidden = Boolean(window.gsap);
  // Initialize a minimal run before stop() first updates controls.
  run = M.buildRun(M.makeGraph(preset), M.PRESETS[preset].nodes.some(n => n.id === capital) ? capital : 'A');
  rebuild(Number(url.get('t')) || 0);
})();
