(function (root) {
  'use strict';
  const clamp = x => Math.max(0, Math.min(1, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const lerp = (a, b, p) => a + (b - a) * p;
  function pointer(a, b, p) {
    if (a == null && b == null) return { index: 0, alpha: 0 };
    const alpha = lerp(a == null ? 0 : 1, b == null ? 0 : 1, p);
    return { index: alpha === 0 ? 0 : lerp(a == null ? b : a, b == null ? a : b, p), alpha };
  }
  function textView(a, b, p, start = 0.7, end = 0.95) {
    if (a === b) return { text: b, alpha: 1 };
    const q = win(p, start, end);
    return { text: q < 0.5 ? a : b, alpha: Math.abs(1 - 2 * q) };
  }
  function positions(state) {
    const map = new Map();
    state.array.forEach((item, index) => { if (item) map.set(item.id, { x: index, temp: 0 }); });
    if (state.temp) map.set(state.temp.id, { x: 0, temp: 1 });
    return map;
  }
  function range(state) {
    const active = ['bounds', 'mid', 'locate', 'narrow'].includes(state.phase);
    return { left: state.low, right: state.high == null ? null : state.high + 1, active };
  }
  function frame(before, after, progress) {
    const p = clamp(progress);
    const main = win(p, 0.2, 0.68);
    const receipt = win(p, 0.72, 0.96);
    const from = positions(before);
    const to = positions(after);
    const tiles = [...to].sort((a, b) => a[0] - b[0]).map(([id, b]) => {
      const a = from.get(id);
      return { id, x: lerp(a.x, b.x, main), temp: lerp(a.temp, b.temp, main) };
    });
    const pointers = {};
    ['i', 'j', 'low', 'high', 'mid'].forEach(name => {
      const a = name === 'i' && before.phase === 'done' ? null : before[name];
      const b = name === 'i' && after.phase === 'done' ? null : after[name];
      pointers[name] = pointer(a, b, main);
    });
    const ra = range(before);
    const rb = range(after);
    const left = pointer(ra.left, rb.left, main).index;
    const right = pointer(ra.right, rb.right, main).index;
    const rangeAlpha = lerp(ra.active ? 1 : 0, rb.active ? 1 : 0, main);
    const slotViews = after.array.map((_, index) => {
      const flag = (state, key) => state[key] === index ? 1 : 0;
      const excluded = state => ['mid', 'locate', 'narrow'].includes(state.phase) &&
        index < state.i && (index < state.low || index > state.high) ? 1 : 0;
      return {
        hole: lerp(before.array[index] ? 0 : 1, after.array[index] ? 0 : 1, main),
        sorted: lerp(index < before.sortedCount ? 1 : 0, index < after.sortedCount ? 1 : 0, receipt),
        focus: lerp(flag(before, 'focus'), flag(after, 'focus'), win(p, 0, 0.18)),
        compared: lerp(flag(before, 'compareIndex'), flag(after, 'compareIndex'), main),
        excluded: lerp(excluded(before), excluded(after), receipt),
        inserted: lerp(before.phase === 'insert' ? flag(before, 'insertIndex') : 0,
          after.phase === 'insert' ? flag(after, 'insertIndex') : 0, receipt)
      };
    });
    return {
      tiles, pointers, slots: slotViews,
      range: { left: rangeAlpha === 0 ? 0 : left, right: rangeAlpha === 0 ? 0 : right, alpha: rangeAlpha },
      sortedCount: lerp(before.sortedCount, after.sortedCount, receipt),
      comparisons: Math.round(lerp(before.comparisons, after.comparisons, receipt)),
      shifts: Math.round(lerp(before.shifts, after.shifts, receipt)),
      passes: Math.round(lerp(before.completedPasses, after.completedPasses, receipt)),
      comparisonText: textView(String(before.comparisons), String(after.comparisons), p, 0.72, 0.96),
      shiftText: textView(String(before.shifts), String(after.shifts), p, 0.72, 0.96),
      passText: textView(String(before.completedPasses), String(after.completedPasses), p, 0.72, 0.96),
      title: textView(before.title, after.title, p, 0, 0.18),
      copy: textView(before.copy, after.copy, p),
      cue: textView(before.cue, after.cue, p),
      line: p < 0.1 ? before.line : after.line,
      phase: p < 0.1 ? before.phase : after.phase,
      state: p < 0.72 ? before : after
    };
  }
  function sample(steps, time) {
    const t = Math.max(0, Math.min(steps.length - 1, time));
    const index = Math.min(Math.floor(t), steps.length - 2);
    return Object.assign(frame(steps[index], steps[index + 1], t - index), { time: t });
  }
  const api = { frame, sample, textView };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InsertionChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
