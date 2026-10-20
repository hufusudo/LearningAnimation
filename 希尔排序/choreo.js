(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShellChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const lerp = (a, b, p) => a + (b - a) * p;
  const xAt = (index, count) => 550 + (index - (count - 1) / 2) * 110;
  const MAIN_Y = 364, UPPER_Y = 180, TEMP_Y = 66;
  const indicesOf = (state, count) => state.group === null ? [] : Array.from({ length: count }, (_, i) => i).filter(i => i % state.gap === state.group);
  const upperX = (state, index, count) => {
    const indices = indicesOf(state, count);
    return xAt(indices.indexOf(index), indices.length);
  };
  function position(state, id, count) {
    if (state.temp === id) return { x: upperX(state, state.tempOrigin, count), y: TEMP_Y };
    const index = state.slots.indexOf(id);
    if (state.raised && index % state.gap === state.group) return { x: upperX(state, index, count), y: UPPER_Y };
    return { x: xAt(index, count), y: MAIN_Y };
  }
  function textView(a, b, p, start = 0.70, end = 0.94) {
    if (a === b) return { text: b, alpha: 1 };
    const q = win(p, start, end);
    return { text: q < 0.5 ? a : b, alpha: Math.abs(1 - 2 * q) };
  }
  const stageText = s => s.gap ? `d = ${s.gap}  ·  ${s.group === null ? '全部子表' : `余数 ${s.group} 组`}` : '等待第一趟';
  const pointerText = s => `i = ${s.i === null ? '—' : s.i}    j = ${s.j === null ? '—' : s.j}`;
  function stable(state, items) {
    const n = items.length, indices = indicesOf(state, n);
    return {
      tokens: items.map(item => ({ id: item.id, ...position(state, item.id, n) })),
      holes: state.slots.map((id, i) => state.raised && indices.includes(i) ? 1 : 0),
      upperSlots: state.slots.map((id, i) => ({
        index: i, x: indices.includes(i) ? upperX(state, i, n) : 550,
        alpha: state.raised && indices.includes(i) ? 1 : 0,
        hole: id === null ? 1 : 0,
        sorted: state.prefixEnd !== null && i <= state.prefixEnd ? 1 : 0
      })),
      work: { alpha: state.raised ? 1 : 0, indices, prefix: state.prefixEnd === null ? 0 : indices.filter(i => i <= state.prefixEnd).length },
      temp: { x: state.temp ? upperX(state, state.tempOrigin, n) : 550, alpha: state.temp ? 1 : 0 },
      groups: { gap: state.gap, active: state.group, alpha: 1 },
      phase: { text: state.phase, alpha: 1 }, stage: { text: stageText(state), alpha: 1 },
      pointers: { text: pointerText(state), alpha: 1 }, message: { text: state.message, alpha: 1 },
      order: { text: state.order, alpha: 1 },
      comparisons: state.comparisons, moves: state.moves, inversions: state.inversions,
      focus: null, groupFocus: null, tag: null, connector: null
    };
  }
  function sampleStep(step, p, items) {
    p = clamp(Number.isFinite(p) ? p : 0);
    if (p === 0) return stable(step.before, items);
    if (p === 1) return stable(step.after, items);
    const n = items.length, a = stable(step.before, items), b = stable(step.after, items);
    const q = win(p, 0.20, 0.68), receipt = win(p, 0.70, 0.92);
    const frame = stable(step.before, items);
    frame.tokens = a.tokens.map((token, i) => {
      const to = b.tokens[i];
      if (step.kind === 'insert' && token.id === step.focus) {
        return { id: token.id, x: lerp(token.x, to.x, clamp(q * 2)), y: lerp(token.y, to.y, clamp(q * 2 - 1)) };
      }
      // Lift vertically first, then close the gaps to expose a contiguous sublist.
      // Returning reverses that route: expand to the original indices, then lower.
      if (step.kind === 'group-lift') return { id: token.id, x: lerp(token.x, to.x, clamp(q * 2 - 1)), y: lerp(token.y, to.y, clamp(q * 2)) };
      if (step.kind === 'group-lower') return { id: token.id, x: lerp(token.x, to.x, clamp(q * 2)), y: lerp(token.y, to.y, clamp(q * 2 - 1)) };
      return { id: token.id, x: lerp(token.x, to.x, q), y: lerp(token.y, to.y, q) };
    });
    frame.holes = a.holes.map((h, i) => lerp(h, b.holes[i], q));
    frame.temp = { x: lerp(a.temp.x, b.temp.x, q), alpha: lerp(a.temp.alpha, b.temp.alpha, q) };
    frame.upperSlots = a.upperSlots.map((slot, i) => ({
      index: i, x: b.upperSlots[i].alpha ? b.upperSlots[i].x : slot.x,
      alpha: lerp(slot.alpha, b.upperSlots[i].alpha, step.kind === 'group-lower' ? win(p, 0.06, 0.20) : receipt),
      hole: lerp(slot.hole, b.upperSlots[i].hole, q),
      sorted: lerp(slot.sorted, b.upperSlots[i].sorted, receipt)
    }));
    const work = step.kind === 'group-lift' ? b.work : a.work;
    frame.work = { ...work, alpha: lerp(a.work.alpha, b.work.alpha, step.kind === 'group-lower' ? win(p, 0.06, 0.20) : receipt), prefix: lerp(a.work.prefix, b.work.prefix, receipt) };
    frame.phase = textView(a.phase.text, b.phase.text, p, 0.02, 0.18);
    for (const field of ['stage', 'pointers', 'message', 'order']) frame[field] = textView(a[field].text, b[field].text, p);
    for (const field of ['comparisons', 'moves', 'inversions']) frame[field] = Math.round(lerp(a[field], b[field], receipt));
    if (a.groups.gap !== b.groups.gap || a.groups.active !== b.groups.active) {
      const k = win(p, 0.08, 0.40);
      frame.groups = { ...(k < 0.5 ? a.groups : b.groups), alpha: Math.abs(1 - 2 * k) };
    }
    const pulse = win(p, 0.02, 0.12) * (1 - win(p, 0.68, 0.94));
    if (step.focus && pulse > 0) {
      const token = frame.tokens.find(t => t.id === step.focus);
      frame.focus = { x: token.x, y: token.y, alpha: pulse };
    }
    if (['group-select', 'group-lift', 'group-lower'].includes(step.kind) && pulse > 0) {
      const s = step.kind === 'group-lower' ? step.before : step.after;
      const indices = indicesOf(s, n);
      frame.groupFocus = { alpha: pulse, points: indices.map(index => {
        const id = s.slots[index];
        const token = frame.tokens.find(token => token.id === id);
        return { x: token.x, y: token.y };
      }) };
    }
    const tagAlpha = win(p, 0.70, 0.84) * (1 - win(p, 0.90, 1));
    if (tagAlpha > 0) {
      const token = step.focus ? frame.tokens.find(token => token.id === step.focus) : null;
      frame.tag = { text: step.label, x: token ? token.x : 550, y: 286 - receipt * 5, alpha: tagAlpha };
    }
    if (step.kind === 'compare' && step.before.j !== null && step.before.j >= 0) {
      const alpha = win(p, 0.16, 0.28) * (1 - win(p, 0.84, 1));
      if (alpha > 0) frame.connector = {
        x1: upperX(step.before, step.before.j, n), y1: UPPER_Y - 38,
        x2: upperX(step.before, step.before.tempOrigin, n), y2: TEMP_Y + 35,
        alpha, draw: win(p, 0.20, 0.60)
      };
    }
    return frame;
  }
  function sample(sequence, time) {
    const t = clamp(Number.isFinite(time) ? time : 0, 0, sequence.duration);
    if (t === 0) return stable(sequence.initial, sequence.items);
    const index = Math.min(Math.ceil(t) - 1, sequence.steps.length - 1);
    return sampleStep(sequence.steps[index], t - index, sequence.items);
  }
  return { sample, sampleStep, stable, xAt, upperX, indicesOf, MAIN_Y, UPPER_Y, TEMP_Y };
});
