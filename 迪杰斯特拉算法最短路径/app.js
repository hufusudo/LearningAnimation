'use strict';

/* Computation is independent of the renderer. Each phase owns immutable
   before/after snapshots, so seeking never relies on a callback's history. */
const DijkstraModel = (() => {
  const nodes = [
    { id: 'A', x: 130, y: 280 }, { id: 'B', x: 370, y: 145 },
    { id: 'C', x: 370, y: 415 }, { id: 'D', x: 640, y: 145 },
    { id: 'E', x: 640, y: 415 }, { id: 'F', x: 890, y: 280 }
  ];
  const edges = [
    ['A', 'B', 2], ['A', 'C', 7], ['B', 'C', 3],
    ['B', 'D', 6], ['C', 'D', 2], ['C', 'E', 6],
    ['D', 'E', 5], ['D', 'F', 2], ['E', 'F', 4]
  ].map(([a, b, weight]) => ({ id: a + b, a, b, weight }));
  const copy = s => ({ dist: { ...s.dist }, prev: { ...s.prev }, settled: [...s.settled] });

  function buildSequence(graphNodes = nodes, graphEdges = edges, source = 'A', target = 'F') {
    const ids = graphNodes.map(n => n.id);
    if (new Set(ids).size !== ids.length || !ids.includes(source) || !ids.includes(target)) {
      throw new Error('节点及起终点必须有效且唯一。');
    }
    for (const edge of graphEdges) {
      if (!ids.includes(edge.a) || !ids.includes(edge.b) || !Number.isFinite(edge.weight) || edge.weight < 0) {
        throw new Error('Dijkstra 需要非负的有限边权和有效端点。');
      }
    }
    let state = { dist: Object.fromEntries(ids.map(id => [id, Infinity])),
      prev: Object.fromEntries(ids.map(id => [id, null])), settled: [] };
    let time = 0;
    const phases = [];
    function add(type, duration, before, after, details = {}) {
      phases.push({ type, duration, start: time, end: time + duration,
        before: copy(before), after: copy(after), ...details });
      time += duration;
      state = copy(after);
    }
    const initial = copy(state);
    state.dist[source] = 0;
    state.settled.push(source);
    add('start', 1.2, initial, state, { node: source });
    let current = source;
    while (current !== target) {
      const before = copy(state);
      const after = copy(state);
      const probes = graphEdges.filter(e => e.a === current || e.b === current)
        .map(e => ({ edge: e, from: current, to: e.a === current ? e.b : e.a }))
        .filter(p => !state.settled.includes(p.to))
        .sort((a, b) => a.to.localeCompare(b.to));
      probes.forEach(p => {
        p.base = before.dist[current];
        p.value = p.base + p.edge.weight;
        p.old = after.dist[p.to];
        p.oldPrev = after.prev[p.to];
        p.improved = p.value < p.old;
        if (p.improved) { after.dist[p.to] = p.value; after.prev[p.to] = current; }
      });
      add('relax', 3.8, before, after, { node: current, probes });
      const frontier = ids.filter(id => !state.settled.includes(id) && Number.isFinite(state.dist[id]))
        .sort((a, b) => state.dist[a] - state.dist[b] || a.localeCompare(b));
      if (!frontier.length) break;
      current = frontier[0];
      const selected = copy(state);
      selected.settled.push(current);
      add('select', 1.8, state, selected, { node: current, frontier });
    }
    const route = [];
    if (state.settled.includes(target)) {
      let cursor = target;
      while (cursor !== null) {
        if (route.includes(cursor)) throw new Error('前驱链不能成环。');
        route.unshift(cursor);
        cursor = state.prev[cursor];
      }
    }
    add('finish', 3.8, state, state, { route, reachable: route.length > 0 });
    return { phases, duration: time, route, final: copy(state), source, target };
  }

  function sample(sequence, time) {
    const t = Math.max(0, Math.min(sequence.duration, time));
    const index = sequence.phases.findIndex(p => t < p.end - 1e-7);
    const phase = sequence.phases[index < 0 ? sequence.phases.length - 1 : index];
    const local = t - phase.start;
    const state = copy(phase.before);
    if (phase.type === 'start' && local >= .38) return { phase, local, state: copy(phase.after) };
    if (phase.type === 'select' && local >= .95) return { phase, local, state: copy(phase.after) };
    if (phase.type === 'relax') phase.probes.forEach((p, i) => {
      if (p.improved && local >= 2 + i * .18) {
        state.dist[p.to] = p.value;
        state.prev[p.to] = p.from;
      }
    });
    return { phase, local, state };
  }
  return { nodes, edges, buildSequence, sample };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DijkstraModel;
if (typeof document !== 'undefined') initializeDijkstraDemo();

function initializeDijkstraDemo() {
  const NS = 'http://www.w3.org/2000/svg';
  const { nodes, edges, buildSequence, sample } = DijkstraModel;
  const sequence = buildSequence();
  const positions = Object.fromEntries(nodes.map(n => [n.id, n]));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = id => document.getElementById(id);
  const clamp = value => Math.max(0, Math.min(1, value));
  const range = (v, start, end) => clamp((v - start) / (end - start));
  const ease = x => 1 - Math.pow(1 - clamp(x), 4);
  const sine = x => (1 - Math.cos(Math.PI * clamp(x))) / 2;
  const bell = (v, start, peak, end) => v < peak ? range(v, start, peak) : 1 - range(v, peak, end);
  const lerp = (a, b, p) => a + (b - a) * p;
  const fmt = value => Number.isFinite(value) ? String(value) : '∞';
  const attrs = (el, values) => Object.entries(values).forEach(([key, value]) => el.setAttribute(key, value));
  const setText = (el, value) => { const text = String(value); if (el.textContent !== text) el.textContent = text; };
  function svg(tag, values = {}, parent) {
    const el = document.createElementNS(NS, tag);
    attrs(el, values);
    if (parent) parent.appendChild(el);
    return el;
  }
  function lineGeometry(from, to, trim = 36) {
    const a = positions[from], b = positions[to];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
    return { a: { x: a.x + ux * trim, y: a.y + uy * trim },
      b: { x: b.x - ux * trim, y: b.y - uy * trim }, ux, uy, length: length - trim * 2 };
  }
  const at = (g, p) => ({ x: lerp(g.a.x, g.b.x, p), y: lerp(g.a.y, g.b.y, p) });
  const path = (a, b) => `M${a.x},${a.y}L${b.x},${b.y}`;
  const edgeFor = (a, b) => edges.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));

  const edgeViews = {}, nodeViews = {}, probeViews = {}, bubbleViews = {};
  const defs = $('graph').querySelector('defs');
  edges.forEach(edge => {
    const g = lineGeometry(edge.a, edge.b);
    const group = svg('g', { 'data-edge': edge.id }, $('edge-layer'));
    const base = svg('path', { d: path(g.a, g.b), class: 'base-edge' }, group);
    const fiber = svg('path', { d: path(g.a, g.b), class: 'fiber', opacity: 0 }, group);
    const arrows = Array.from({ length: 3 }, () => svg('path', { class: 'flow-arrow', opacity: 0 }, group));
    const mx = (positions[edge.a].x + positions[edge.b].x) / 2;
    const my = (positions[edge.a].y + positions[edge.b].y) / 2;
    const weightGroup = svg('g', { transform: `translate(${mx},${my})` }, $('weight-layer'));
    const weightBg = svg('rect', { x: -14, y: -14, width: 28, height: 28, rx: 6, class: 'weight-bg' }, weightGroup);
    const weight = svg('text', { class: 'weight-value', y: 1 }, weightGroup);
    weight.textContent = edge.weight;
    const plus = svg('text', { class: 'plus-text', y: -22, opacity: 0 }, weightGroup);
    plus.textContent = '+' + edge.weight;
    edgeViews[edge.id] = { group, base, fiber, arrows, weightGroup, weightBg, weight, plus };
    const gradient = svg('linearGradient', { id: `probe-gradient-${edge.id}`, gradientUnits: 'userSpaceOnUse' }, defs);
    svg('stop', { offset: 0, 'stop-color': '#68B1E6', 'stop-opacity': 0 }, gradient);
    svg('stop', { offset: 1, 'stop-color': '#57A6DD', 'stop-opacity': 1 }, gradient);
    const probe = svg('g', { class: 'probe', opacity: 0 }, $('pulse-layer'));
    const trail = svg('path', { stroke: `url(#probe-gradient-${edge.id})`, 'stroke-width': 4, 'stroke-linecap': 'round', filter: 'url(#soft-glow)', fill: 'none' }, probe);
    const head = svg('circle', { r: 4, fill: '#75BDEE', filter: 'url(#soft-glow)' }, probe);
    probeViews[edge.id] = { group: probe, gradient, trail, head };
  });

  nodes.forEach(node => {
    const group = svg('g', { id: 'node-' + node.id, class: 'node', transform: `translate(${node.x},${node.y})` }, $('node-layer'));
    const focus = svg('circle', { r: 103, fill: 'url(#focus-wash)', opacity: 0 }, group);
    const focusRays = svg('g', { opacity: 0, fill: 'none', stroke: '#73A1D2', 'stroke-width': 1.2 }, group);
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sy]) =>
      svg('path', { d: `M${sx * 88},${sy * 68}L${sx * 34},${sy * 26}` }, focusRays));
    const arrival = svg('circle', { r: 44, fill: '#E2B45B', opacity: 0 }, group);
    const halo = svg('circle', { r: 44, class: 'node-halo', opacity: 0 }, group);
    const ring = svg('circle', { r: 40, class: 'node-ring', opacity: 0 }, group);
    const ripple = svg('circle', { r: 34, class: 'ripple', opacity: 0 }, group);
    const base = svg('circle', { r: 34, class: 'node-base' }, group);
    const fill = svg('circle', { r: 0, class: 'node-fill' }, group);
    const name = svg('text', { y: -53, class: 'node-name' }, group);
    name.textContent = node.id;
    const value = svg('text', { class: 'distance', y: 1, fill: '#9A9F96' }, group);
    value.textContent = '∞';
    const shards = Array.from({ length: 4 }, (_, i) => {
      const clip = svg('clipPath', { id: `shard-clip-${node.id}-${i}`, clipPathUnits: 'userSpaceOnUse' }, defs);
      svg('rect', { x: i % 2 ? 0 : -30, y: i < 2 ? -27 : 0, width: 30, height: 27 }, clip);
      const piece = svg('g', { opacity: 0 }, group);
      const glyph = svg('text', { class: 'distance', y: 1, fill: '#9AA597', 'clip-path': `url(#shard-clip-${node.id}-${i})` }, piece);
      return { piece, glyph };
    });
    const check = svg('text', { x: 22, y: -16, class: 'check', opacity: 0 }, group);
    check.textContent = '✓';
    const tray = svg('g', { class: 'traceback', transform: 'translate(0,56)', opacity: 0 }, group);
    svg('rect', { x: -29, y: -13, width: 58, height: 26, rx: 8, class: 'trace-bg' }, tray);
    const trace = svg('text', { class: 'trace-text', y: 1 }, tray);
    const role = svg('text', { y: 88, class: 'role-label' }, group);
    role.textContent = node.id === 'A' ? '起点' : node.id === 'F' ? '终点' : '';
    nodeViews[node.id] = { group, focus, focusRays, arrival, halo, ring, ripple, base, fill, value, shards, check, tray, trace };

    const bubble = svg('g', { opacity: 0 }, $('floating-layer'));
    svg('rect', { x: -66, y: -17, width: 132, height: 34, rx: 13, class: 'bubble-bg' }, bubble);
    const equation = svg('text', { y: 1, class: 'equation' }, bubble);
    const action = svg('g', { class: 'action-tag', transform: `translate(${node.x},${node.y - 126})`, opacity: 0 }, $('floating-layer'));
    const actionBg = svg('rect', { x: -39, y: -13, width: 78, height: 26, rx: 11, fill: '#FFFFFF', 'fill-opacity': .85 }, action);
    const actionText = svg('text', { y: 1 }, action);
    const smoke = svg('g', { opacity: 0 }, $('floating-layer'));
    const smokeDots = Array.from({ length: 5 }, () => svg('circle', { r: 4, fill: '#B4BBAF' }, smoke));
    bubbleViews[node.id] = { bubble, equation, action, actionBg, actionText, smoke, smokeDots };
  });
  const finalGradient = svg('linearGradient', { id: 'final-gradient', gradientUnits: 'userSpaceOnUse' }, defs);
  svg('stop', { offset: 0, 'stop-color': '#E7BD6A', 'stop-opacity': 0 }, finalGradient);
  svg('stop', { offset: 1, 'stop-color': '#E7B84D', 'stop-opacity': 1 }, finalGradient);
  const finalPulse = svg('g', { class: 'final-pulse', opacity: 0 }, $('pulse-layer'));
  const finalTrail = svg('path', { fill: 'none', stroke: 'url(#final-gradient)', 'stroke-width': 5, 'stroke-linecap': 'round', filter: 'url(#soft-glow)' }, finalPulse);
  const finalHead = svg('circle', { r: 5, fill: '#EDC36D', filter: 'url(#soft-glow)' }, finalPulse);
  const routeGeometry = [];
  let routeLength = 0;
  sequence.route.slice(1).forEach((id, i) => {
    const geometry = lineGeometry(sequence.route[i], id, 0);
    routeGeometry.push({ ...geometry, start: routeLength, end: routeLength + geometry.length });
    routeLength += geometry.length;
  });
  function routePoint(distance) {
    const d = Math.max(0, Math.min(routeLength, distance));
    const segment = routeGeometry.find(g => d <= g.end) || routeGeometry[routeGeometry.length - 1];
    return segment ? at(segment, (d - segment.start) / segment.length) : positions.A;
  }
  function routeTrail(start, end) {
    const points = [routePoint(start)];
    routeGeometry.forEach(g => { if (g.end > start && g.end < end) points.push(g.b); });
    points.push(routePoint(end));
    return points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');
  }
  const pathEdges = new Set(sequence.route.slice(1).map((id, i) => edgeFor(sequence.route[i], id).id));
  let time = 0, timeline = null, seekTween = null, running = false, speed = 1, accessibilityKey = '';

  function renderAt(requestedTime) {
    time = Math.max(0, Math.min(sequence.duration, requestedTime));
    const { phase, local, state } = sample(sequence, time);
    const finishing = phase.type === 'finish';
    const finalFade = finishing ? ease(range(local, 0, .4)) : 0;
    const compareProgress = (probe, i) => range(local, 1.78 + i * .18, 2.45 + i * .18);
    const activeEdges = new Map();
    nodes.forEach(n => {
      const parent = phase.before.prev[n.id];
      if (parent) activeEdges.set(edgeFor(parent, n.id).id, { from: parent, to: n.id, opacity: 1 });
    });
    if (phase.type === 'relax') phase.probes.forEach((p, i) => {
      if (!p.improved) return;
      const q = ease(compareProgress(p, i));
      if (p.oldPrev) activeEdges.set(edgeFor(p.oldPrev, p.to).id, { from: p.oldPrev, to: p.to, opacity: 1 - q });
      activeEdges.set(p.edge.id, { from: p.from, to: p.to, opacity: q });
    });

    edges.forEach(edge => {
      const v = edgeViews[edge.id], active = activeEdges.get(edge.id);
      const fade = pathEdges.has(edge.id) ? 1 : lerp(1, .15, finalFade);
      attrs(v.group, { opacity: fade });
      attrs(v.weightGroup, { opacity: fade });
      const opacity = active ? active.opacity : 0;
      attrs(v.fiber, { opacity: opacity * .86, 'stroke-width': finishing && pathEdges.has(edge.id) ? 2.6 : 1.9 });
      if (active) {
        const g = lineGeometry(active.from, active.to);
        attrs(v.fiber, { d: path(g.a, g.b) });
        v.arrows.forEach((arrow, i) => {
          const fraction = ((reducedMotion ? .2 : time * .13) + i / 3) % 1;
          const p = at(g, fraction), s = 4.5;
          const a = { x: p.x - g.ux * s - g.uy * s * .6, y: p.y - g.uy * s + g.ux * s * .6 };
          const b = { x: p.x - g.ux * s + g.uy * s * .6, y: p.y - g.uy * s - g.ux * s * .6 };
          attrs(arrow, { d: `M${a.x},${a.y}L${p.x},${p.y}L${b.x},${b.y}`, opacity: opacity * .38 });
        });
      } else v.arrows.forEach(arrow => attrs(arrow, { opacity: 0 }));
      const probe = phase.type === 'relax' && phase.probes.find(p => p.edge.id === edge.id);
      const highlight = probe ? bell(local, .80, 1.03, 1.40) : 0;
      attrs(v.weight, { fill: highlight > .25 ? '#2563EB' : finishing && pathEdges.has(edge.id) ? '#927029' : '#71776F' });
      attrs(v.weightBg, { fill: highlight > .25 ? '#EDF5FF' : '#FAF9F5' });
      attrs(v.plus, { opacity: highlight, y: -21 - highlight * 8 });
      attrs(probeViews[edge.id].group, { opacity: 0 });
    });

    nodes.forEach(node => {
      const v = nodeViews[node.id], b = bubbleViews[node.id];
      const settled = state.settled.includes(node.id);
      const finite = Number.isFinite(state.dist[node.id]);
      const selected = phase.type === 'select' && phase.node === node.id;
      const initial = phase.type === 'start' && phase.node === node.id;
      const frontier = finite && !settled;
      let fillProgress = settled ? 1 : 0;
      if (initial) fillProgress = ease(range(local, .22, .65));
      if (selected) fillProgress = ease(range(local, .68, 1.13));
      let lift = 0, scale = 1, arrivalLight = 0;
      if (phase.type === 'select' && phase.frontier.includes(node.id)) {
        lift = -4 * bell(local, 0, .25, selected ? .9 : .8);
        if (selected) scale += .11 * sine(bell(local, .43, .72, 1.05));
      }
      if (finishing && sequence.route.includes(node.id)) {
        const index = sequence.route.indexOf(node.id);
        const arrived = .6 + (index ? routeGeometry[index - 1].end / routeLength : 0) * 2.2;
        arrivalLight = bell(local, arrived, arrived + .16, arrived + .42);
        scale += .08 * arrivalLight;
      }
      attrs(v.group, { transform: `translate(${node.x},${node.y}) scale(${scale})`, opacity: sequence.route.includes(node.id) ? 1 : lerp(1, .15, finalFade), 'data-status': settled ? 'settled' : frontier ? 'frontier' : 'unvisited', 'data-distance': fmt(state.dist[node.id]), 'data-predecessor': state.prev[node.id] || '' });
      attrs(v.base, { stroke: fillProgress > .5 ? '#399B7B' : frontier ? '#91B3E4' : '#BDC4BB' });
      attrs(v.fill, { r: 34 * fillProgress });
      const breathing = reducedMotion ? .6 : (1 + Math.sin(time * 2.3 + node.x)) / 2;
      const deEmphasis = phase.type === 'select' && !selected ? 1 - .65 * bell(local, .1, .45, 1.15) : 1;
      attrs(v.halo, { r: 42 + breathing * 2, opacity: frontier ? (.07 + breathing * .045) * deEmphasis : 0 });
      attrs(v.ring, { opacity: frontier ? (.3 + breathing * .2) * deEmphasis : 0 });
      attrs(v.focus, { opacity: selected ? bell(local, .3, .65, 1.35) : 0 });
      attrs(v.focusRays, { opacity: selected ? .7 * bell(local, .35, .6, 1.1) : 0 });
      attrs(v.arrival, { opacity: arrivalLight * .22, r: 44 + arrivalLight * 4 });
      const rippleTime = initial ? local : phase.type === 'relax' && phase.node === node.id ? local : -1;
      attrs(v.ripple, { r: lerp(34, 65, ease(range(rippleTime, 0, .7))), opacity: rippleTime >= 0 ? .4 * (1 - range(rippleTime, .05, .7)) : 0 });
      setText(v.value, fmt(state.dist[node.id]));
      let valueOpacity = 1;
      if (initial) { lift = -8 * (1 - ease(range(local, .38, .82))); valueOpacity = local < .38 ? 1 - range(local, .2, .38) : range(local, .38, .6); }
      const probeIndex = phase.type === 'relax' ? phase.probes.findIndex(p => p.to === node.id) : -1;
      const probe = probeIndex >= 0 ? phase.probes[probeIndex] : null;
      if (probe && probe.improved) {
        const q = compareProgress(probe, probeIndex);
        if (q > 0 && q < .33) valueOpacity = 1 - range(q, 0, .33);
        if (q >= .33) { setText(v.value, probe.value); lift = -27 * (1 - ease(range(q, .33, .85))); valueOpacity = range(q, .33, .7); }
        v.shards.forEach(({ piece, glyph }, i) => {
          const p = range(q, 0, .75);
          setText(glyph, fmt(probe.old));
          attrs(piece, { opacity: q > 0 && q < .75 ? .9 * (1 - p) : 0,
            transform: `translate(${(i % 2 ? 1 : -1) * p * 19},${(i < 2 ? -1 : 1) * p * 16}) rotate(${(i % 2 ? 1 : -1) * p * 12})` });
        });
      } else v.shards.forEach(({ piece }) => attrs(piece, { opacity: 0 }));
      attrs(v.value, { y: 1 + lift, fill: fillProgress > .55 ? '#FFFFFF' : finite ? '#466A97' : '#9A9F96', opacity: valueOpacity });
      attrs(v.check, { opacity: initial ? range(local, .6, .9) : selected ? range(local, .98, 1.2) : settled ? 1 : 0 });
      const flip = probe && probe.improved ? compareProgress(probe, probeIndex) : 0;
      attrs(v.tray, { opacity: state.prev[node.id] ? 1 : 0, transform: `translate(0,56) scale(1,${flip > 0 && flip < 1 ? Math.max(.04, Math.abs(Math.cos(Math.PI * flip))) : 1})` });
      setText(v.trace, state.prev[node.id] ? '←' + state.prev[node.id] : '');
      attrs(b.bubble, { opacity: 0 }); attrs(b.action, { opacity: 0 }); attrs(b.smoke, { opacity: 0 });
      if (selected) {
        attrs(b.action, { opacity: bell(local, .4, .8, 1.65), transform: `translate(${node.x},${node.y - 100})` });
        setText(b.actionText, '最短锁定');
        attrs(b.actionText, { fill: '#39856B' });
      }
    });

    if (phase.type === 'relax') phase.probes.forEach((p, i) => {
      const g = lineGeometry(p.from, p.to), probe = probeViews[p.edge.id], bubble = bubbleViews[p.to];
      const travel = sine(range(local, .25, 1.65));
      const head = at(g, travel), tail = at(g, Math.max(0, travel - .22));
      attrs(probe.group, { opacity: bell(local, .2, .4, 1.8) });
      attrs(probe.gradient, { x1: tail.x, y1: tail.y, x2: head.x, y2: head.y });
      attrs(probe.trail, { d: path(tail, head) }); attrs(probe.head, { cx: head.x, cy: head.y });
      const from = positions[p.from], to = positions[p.to], q = compareProgress(p, i);
      const flight = ease(range(local, .94, 1.72));
      const center = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 29 };
      const shake = !reducedMotion && !p.improved && q > 0 ? Math.sin(q * 45) * 2 * (1 - q) : 0;
      attrs(bubble.bubble, { transform: `translate(${lerp(center.x, to.x, flight) + shake},${lerp(center.y, to.y - 90, flight)})`, opacity: range(local, .92, 1.13) * (1 - range(q, 0, p.improved ? .3 : .9)) });
      setText(bubble.equation, `${p.base} + ${p.edge.weight} = ${p.value}`);
      const actionOpacity = bell(local, 1.9 + i * .18, 2.35 + i * .18, 3.35 + i * .18);
      attrs(bubble.action, { opacity: actionOpacity, transform: `translate(${Math.min(916, to.x + 72)},${to.y - 126 - 5 * q})` });
      setText(bubble.actionText, p.improved ? '更近！' : '舍弃');
      attrs(bubble.actionText, { fill: p.improved ? '#39856B' : '#8C9386' });
      if (!p.improved) {
        const smoke = range(q, .12, .9);
        attrs(bubble.smoke, { opacity: bell(smoke, 0, .25, 1), transform: `translate(${to.x},${to.y - 90})` });
        bubble.smokeDots.forEach((dot, j) => attrs(dot, { cx: (j - 2) * 7 * smoke, cy: -smoke * (8 + j * 4), r: 2 + smoke * 6 }));
      }
    });
    attrs($('selection-dim'), { opacity: phase.type === 'select' ? .085 * bell(local, 0, .2, .75) : 0 });
    attrs(finalPulse, { opacity: 0 });
    if (finishing && local >= .6 && local <= 3.05 && routeLength) {
      const end = routeLength * range(local, .6, 2.8), start = Math.max(0, end - 100);
      const a = routePoint(start), b = routePoint(end);
      attrs(finalPulse, { opacity: 1 - range(local, 2.8, 3.05) });
      attrs(finalGradient, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      attrs(finalTrail, { d: routeTrail(start, end) }); attrs(finalHead, { cx: b.x, cy: b.y });
    }
    updateInterface(phase, local, state);
  }

  function updateInterface(phase, local, state) {
    const labels = { start: '初始化', relax: local < 1.78 ? '探路计算' : '比对更新', select: '最短锁定', finish: '路径回溯' };
    const name = labels[phase.type];
    setText($('stage-status'), phase.type === 'finish' ? '终点已锁定 · 探索停止' : `${name}${phase.node ? ' · ' + phase.node : ''}`);
    let explanation = '起点 A 的距离为 0。';
    if (phase.type === 'relax') explanation = local < 1.78
      ? `从 ${phase.node} 同时探向 ${phase.probes.map(p => p.to).join('、')}。`
      : phase.probes.map(p => p.improved ? `${p.to}：${fmt(p.old)} → ${p.value}` : `${p.to}：${p.value} ≥ ${p.old}，舍弃`).join('；') + '。';
    if (phase.type === 'select') explanation = `候选节点中，${phase.node} 的距离 ${phase.before.dist[phase.node]} 最小。`;
    if (phase.type === 'finish') explanation = 'F 的最短距离已经锁定，沿前驱链还原 A 到 F 的路径。';
    setText($('current-explanation'), explanation);
    setText($('scene-counter'), `${sequence.phases.indexOf(phase) + 1} / ${sequence.phases.length}`);
    document.querySelectorAll('[data-phase]').forEach(el => el.classList.toggle('active',
      el.dataset.phase === (phase.type === 'relax' && local >= 1.78 ? 'compare' : phase.type)));
    const resultVisible = phase.type === 'finish' ? ease(range(local, 2.6, 3.35)) : 0;
    $('result').style.opacity = resultVisible;
    $('result').setAttribute('aria-hidden', resultVisible ? 'false' : 'true');
    setText($('result-route'), resultVisible ? sequence.route.join(' → ') : '');
    setText($('result-distance'), resultVisible ? sequence.final.dist.F : '');
    $('progress').value = time;
    $('progress').setAttribute('aria-valuetext', `${name}，${Math.floor(time)} 秒，共 ${Math.round(sequence.duration)} 秒`);
    $('progress').style.background = `linear-gradient(to right, #A4B9A3 ${time / sequence.duration * 100}%, #E7E9E1 ${time / sequence.duration * 100}%)`;
    const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    setText($('elapsed'), clock(time)); setText($('duration'), clock(sequence.duration));
    setText($('progress-caption'), name + (phase.node ? ' ' + phase.node : ''));
    $('previous').disabled = time < .001;
    $('next').disabled = time >= sequence.duration - .001;
    const key = JSON.stringify([sequence.phases.indexOf(phase), state.dist, state.prev, state.settled]);
    if (key !== accessibilityKey) {
      accessibilityKey = key;
      setText($('accessible-state'), explanation + nodes.map(n => `${n.id} 距离 ${fmt(state.dist[n.id])}，${state.settled.includes(n.id) ? '已锁定' : '暂定'}${state.prev[n.id] ? '，前驱 ' + state.prev[n.id] : ''}`).join('；'));
      $('graph').setAttribute('aria-label', `${name}。${nodes.map(n => n.id + ':' + fmt(state.dist[n.id])).join('，')}`);
    }
  }

  function syncPlayback() {
    setText($('play-label'), running ? '暂停' : time >= sequence.duration - .001 ? '再播放' : '播放');
    setText($('play-symbol'), running ? 'Ⅱ' : '▶');
    $('play').dataset.running = String(running);
    $('play').setAttribute('aria-label', running ? '暂停演示' : '播放演示');
    $('activity-led').style.background = running ? '#399B7B' : '#8E9987';
  }
  function stop() {
    if (seekTween) { seekTween.kill(); seekTween = null; }
    if (timeline) { window.gsap.killTweensOf(timeline); timeline.pause(); }
    running = false;
    syncPlayback();
  }
  function seek(target) {
    stop();
    if (timeline) timeline.seek(target, true);
    renderAt(target); syncPlayback();
  }
  function animateTo(target) {
    stop();
    if (!timeline || Math.abs(target - time) < .001) { seek(target); return; }
    running = true; syncPlayback();
    seekTween = timeline.tweenTo(target, {
      duration: Math.abs(target - time), ease: 'none',
      onUpdate: () => renderAt(timeline.time()),
      onComplete: () => { seekTween = null; running = false; renderAt(target); syncPlayback(); }
    }).timeScale(speed);
  }
  function togglePlay() {
    if (!timeline) return;
    if (running) { stop(); return; }
    stop();
    if (time >= sequence.duration - .001) { timeline.seek(0, true); renderAt(0); }
    running = true; timeline.timeScale(speed).play(); syncPlayback();
  }
  const boundaries = [0, ...sequence.phases.map(p => p.end)];
  function next() { animateTo(boundaries.find(b => b > time + .01) ?? sequence.duration); }
  function previous() { animateTo([...boundaries].reverse().find(b => b < time - .01) ?? 0); }
  function getPhaseTimeline(phaseIndex) {
    const phase = sequence.phases[phaseIndex];
    return window.gsap.timeline().to({ elapsed: 0 }, { elapsed: phase.duration, duration: phase.duration, ease: 'none' });
  }

  if (window.gsap) {
    timeline = window.gsap.timeline({ paused: true, onUpdate: () => renderAt(timeline.time()),
      onComplete: () => { running = false; syncPlayback(); } });
    sequence.phases.forEach((phase, index) => timeline.addLabel(`phase-${index}`, phase.start).add(getPhaseTimeline(index), phase.start));
  } else {
    $('dependency-notice').hidden = false; $('play').disabled = true; $('speed').disabled = true;
  }
  $('progress').max = sequence.duration;
  $('play').addEventListener('click', togglePlay);
  $('next').addEventListener('click', next);
  $('previous').addEventListener('click', previous);
  $('reset').addEventListener('click', () => { seek(0); if (timeline) togglePlay(); });
  $('progress').addEventListener('input', event => seek(Number(event.target.value)));
  $('speed').addEventListener('change', event => {
    speed = Number(event.target.value);
    if (timeline) timeline.timeScale(speed);
    if (seekTween) seekTween.timeScale(speed);
  });
  document.addEventListener('keydown', event => {
    if (event.target.closest('input, select, textarea, button, a') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
    if (event.code === 'ArrowRight') { event.preventDefault(); next(); }
    if (event.code === 'ArrowLeft') { event.preventDefault(); previous(); }
    if (event.code === 'Home') { event.preventDefault(); seek(0); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  renderAt(0); syncPlayback();
  if (timeline) animateTo(sequence.phases[0].end);
  else seek(sequence.phases[0].end);
}
