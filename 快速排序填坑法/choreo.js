/* Pure time sampling: no DOM, callbacks, or accumulated animation state. */
(function (root) {
  'use strict';
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const lerp = (a, b, p) => a + (b - a) * p;
  const TRAY = { x: 962, y: 73 };
  const cellX = (index, n) => 550 - (n - 1) * 41 + index * 82;
  const nodeColors = {
    future: ['#f6f6f0', '#dcded4'], active: ['#e5efe9', '#34675b'],
    waiting: ['#ffffff', '#bfc9bb'], partitioned: ['#f5f0e4', '#b49c6b'], done: ['#eaf1e8', '#9ab49b']
  };
  function mix(a, b, p) {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return '#' + rgb(a).map((v, i) => Math.round(lerp(v, rgb(b)[i], p)).toString(16).padStart(2, '0')).join('');
  }
  function text(before, after, p, a = .68, b = .9) {
    if (before === after) return { text: after, alpha: 1 };
    const k = win(p, a, b);
    return { text: k < .5 ? before : after, alpha: Math.abs(1 - 2 * k) };
  }
  function rangeView(range, n) {
    if (!range || range[0] > range[1]) return { x: 48, width: 0, alpha: 0 };
    return { x: cellX(range[0], n) - 36, width: (range[1] - range[0]) * 82 + 72, alpha: 1 };
  }
  function rangeLabel(range) {
    if (!range) return '当前没有活动调用';
    return range[0] > range[1] ? `当前调用 A[${range[0]}..${range[1]}] · 空区间` : `当前调用 A[${range[0]}..${range[1]}]`;
  }
  function frame(trace, state) {
    const n = state.cells.length;
    const locations = new Map();
    state.cells.forEach((token, index) => {
      if (token) locations.set(token.id, { x: cellX(index, n), y: 178, locked: state.locked[index] ? 1 : 0, pivot: 0,
        dim: state.range && (index < state.range[0] || index > state.range[1]) && !state.locked[index] ? .38 : 1 });
    });
    if (state.pivot) locations.set(state.pivot.id, { ...TRAY, locked: 0, pivot: 1, dim: 1 });
    return {
      tokens: trace.initial.cells.map(token => ({ id: token.id, value: token.value, ...locations.get(token.id) })),
      slots: state.cells.map((_, i) => ({ hole: state.hole === i ? 1 : 0, locked: state.locked[i] ? 1 : 0 })),
      range: rangeView(state.range, n),
      pointers: ['i', 'j'].map(name => ({ name, x: state[name] === null ? 550 : cellX(state[name], n), alpha: state[name] === null ? 0 : 1 })),
      nodes: trace.nodes.map(node => {
        const status = state.nodeStates[node.id] || 'future';
        const label = { future: '尚未调用', active: node.low >= node.high ? '检查边界' : state.locked[node.pivotIndex] ? '继续子调用' : '正在划分',
          waiting: '等待子调用', partitioned: node.low > node.high ? '空区间' : node.low === node.high ? '单元素有序' : `基准 [${node.pivotIndex}] 已归位`, done: '✓ 已返回' }[status];
        return { id: node.id, status, label, fill: nodeColors[status][0], stroke: nodeColors[status][1], textAlpha: 1,
          link: status === 'future' ? .14 : 1 };
      }),
      stack: trace.nodes.map(node => {
        const index = state.stack.indexOf(node.id);
        return { id: node.id, alpha: index < 0 ? 0 : 1, y: index < 0 ? -30 : 16 + (state.stack.length - 1 - index) * 48,
          active: index >= 0 && index === state.stack.length - 1 ? 1 : 0 };
      }),
      stats: Object.fromEntries(['comparisons', 'moves', 'maxDepth'].map(key => [key, { text: String(state[key]), alpha: 1 }])),
      locked: { text: `${state.locked.filter(Boolean).length} / ${n}`, alpha: 1 },
      depth: { text: `${state.stack.length} 层`, alpha: 1 },
      caption: { text: state.caption, alpha: 1 }, phase: { text: state.phase, alpha: 1 },
      rangeLabel: { text: rangeLabel(state.range), alpha: 1 },
      focus: { indices: [], alpha: 0 }, tag: { text: '', x: 550, y: 109, alpha: 0 },
      path: { d: '', alpha: 0 }
    };
  }
  // Constant-speed polyline, keeping a moving chip above the other elements.
  function along(points, p) {
    const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.y - points[i].y));
    let distance = lengths.reduce((a, b) => a + b, 0) * p;
    for (let i = 0; i < lengths.length; i++) {
      if (distance <= lengths[i] && lengths[i] > 0) {
        const k = distance / lengths[i];
        return { x: lerp(points[i].x, points[i + 1].x, k), y: lerp(points[i].y, points[i + 1].y, k) };
      }
      distance -= lengths[i];
    }
    return points[points.length - 1];
  }
  function transition(trace, event, p) {
    if (p <= 0) return frame(trace, event.before);
    if (p >= 1) return frame(trace, event.after);
    const a = frame(trace, event.before), b = frame(trace, event.after);
    const q = win(p, .18, .72), receipt = win(p, .72, .98);
    const tokens = a.tokens.map((token, i) => {
      const target = b.tokens[i];
      const moving = token.x !== target.x || token.y !== target.y;
      const points = event.kind === 'fill'
        ? [{ x: token.x, y: token.y }, { x: token.x, y: 115 }, { x: target.x, y: 115 }, { x: target.x, y: target.y }]
        : [token, target];
      const position = moving ? along(points, q) : token;
      return { ...token, x: position.x, y: position.y, locked: lerp(token.locked, target.locked, receipt),
        pivot: lerp(token.pivot, target.pivot, q), dim: lerp(token.dim, target.dim, q) };
    });
    const movingIndex = a.tokens.findIndex((token, i) => token.x !== b.tokens[i].x || token.y !== b.tokens[i].y);
    let path = { d: '', alpha: 0 };
    if (movingIndex >= 0 && ['lift', 'fill', 'place'].includes(event.kind)) {
      const start = a.tokens[movingIndex], end = b.tokens[movingIndex];
      path = { d: event.kind === 'fill'
        ? `M${start.x},${start.y} L${start.x},115 L${end.x},115 L${end.x},${end.y}`
        : `M${start.x},${start.y} L${end.x},${end.y}`,
      alpha: win(p, 0, .15) * (1 - win(p, .72, .92)) };
    }
    const focusIndices = event.focus || [];
    const tagX = focusIndices.length ? cellX(focusIndices[0], trace.initial.cells.length) : 550;
    const tagAlpha = win(p, .72, .88) * (1 - win(p, .94, 1));
    return {
      tokens,
      slots: a.slots.map((slot, i) => ({
        // Transfer the hole label only at landing; never show two logical holes.
        hole: slot.hole === b.slots[i].hole ? slot.hole : slot.hole ? 1 - win(p, .68, .72) : win(p, .72, .9),
        locked: lerp(slot.locked, b.slots[i].locked, receipt)
      })),
      range: Object.fromEntries(['x', 'width', 'alpha'].map(key => [key, lerp(a.range[key], b.range[key], q)])),
      pointers: a.pointers.map((pointer, i) => {
        const target = b.pointers[i];
        return { name: pointer.name, x: lerp(pointer.alpha ? pointer.x : target.x, target.alpha ? target.x : pointer.x, q), alpha: lerp(pointer.alpha, target.alpha, q) };
      }),
      nodes: a.nodes.map((node, i) => ({ ...node, status: q < .5 ? node.status : b.nodes[i].status,
        label: q < .5 ? node.label : b.nodes[i].label,
        fill: mix(node.fill, b.nodes[i].fill, q), stroke: mix(node.stroke, b.nodes[i].stroke, q),
        textAlpha: node.label === b.nodes[i].label ? 1 : Math.abs(1 - 2 * q), link: lerp(node.link, b.nodes[i].link, q) })),
      stack: a.stack.map((entry, i) => ({ id: entry.id, alpha: lerp(entry.alpha, b.stack[i].alpha, q), y: lerp(entry.y, b.stack[i].y, q), active: lerp(entry.active, b.stack[i].active, q) })),
      stats: Object.fromEntries(['comparisons', 'moves', 'maxDepth'].map(key => [key, text(a.stats[key].text, b.stats[key].text, p)])),
      locked: text(a.locked.text, b.locked.text, p), depth: text(a.depth.text, b.depth.text, p),
      caption: text(a.caption.text, b.caption.text, p), phase: text(a.phase.text, b.phase.text, p, 0, .3),
      rangeLabel: text(a.rangeLabel.text, b.rangeLabel.text, p, .5, .8),
      focus: { indices: focusIndices, alpha: win(p, 0, .12) * (1 - win(p, .3, .72)) },
      tag: { text: tagAlpha > 0 ? (event.tag || '') : '', x: tagAlpha > 0 ? tagX : 550, y: tagAlpha > 0 ? 109 + 5 * (1 - win(p, .72, .9)) : 109, alpha: tagAlpha },
      path
    };
  }
  function sample(trace, time, reduced = false) {
    const t = clamp(Number.isFinite(time) ? time : 0, 0, trace.duration);
    if (Number.isInteger(t)) return frame(trace, t === 0 ? trace.initial : trace.events[t - 1].after);
    const index = Math.floor(t);
    return transition(trace, trace.events[index], reduced ? 1 : t - index);
  }
  const api = { cellX, frame, transition, sample, mix };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QuickSortChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
