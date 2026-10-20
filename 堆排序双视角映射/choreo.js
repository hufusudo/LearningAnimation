/* 画面只由序列与时刻决定；不读取 DOM，也不累积动画状态。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HeapChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = x => Math.max(0, Math.min(1, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const lerp = (a, b, q) => q <= 0 ? a : q >= 1 ? b : a + (b - a) * q;
  const W = 1100, ARRAY_Y = 452;
  function treePoint(slot) {
    const level = Math.floor(Math.log2(slot + 1));
    const count = 2 ** level;
    return { x: 140 + (slot - count + 1 + 0.5) / count * 820, y: 102 + level * 108 };
  }
  function arrayPoint(slot, n) {
    const gap = Math.min(106, 800 / n);
    return { x: W / 2 + (slot - (n - 1) / 2) * gap, y: ARRAY_Y };
  }
  function textView(before, after, q) {
    if (before === after || q >= 1) return { text: String(after), alpha: 1, dy: 0 };
    if (q <= 0) return { text: String(before), alpha: 1, dy: 0 };
    return q < 0.5
      ? { text: String(before), alpha: 1 - q * 2, dy: -8 * q * 2 }
      : { text: String(after), alpha: q * 2 - 1, dy: 8 * (2 - q * 2) };
  }
  function tagView(before, after, p) {
    if (before === after) return { text: String(after), alpha: 1, dy: 0 };
    if (p < 0.2) return { text: String(before), alpha: 1 - win(p, 0, 0.18), dy: 0 };
    const q = win(p, 0.72, 0.95);
    return { text: String(after), alpha: q, dy: 5 * (1 - q) };
  }
  function sampleEvent(seq, index, progress) {
    const event = seq.events[index];
    if (!event) return snapshot(seq, seq.initial);
    const p = clamp(progress), before = event.before, after = event.after;
    const move = win(p, 0.2, 0.7);
    const state = win(p, 0.2, 0.65);
    const receipt = win(p, 0.72, 0.95);
    const stats = win(p, 0.72, 0.9);
    const phaseIndex = s => ({ ready: 0, place: 0, build: 1, sort: 2, done: 3 })[s.phase];
    const visual = { items: [], edges: [], heap: lerp(before.heapSize, after.heapSize, move),
      treeCount: textView(before.treeSize, after.treeSize, stats),
      completed: lerp(+(before.phase === 'done'), +(after.phase === 'done'), receipt),
      stages: [0, 1, 2, 3].map(i => lerp(+(phaseIndex(before) === i), +(phaseIndex(after) === i), receipt)),
      guide: { alpha: 0, x: 0, y: 0 },
      phase: textView(before.phase, after.phase, receipt),
      title: textView(before.title, after.title, win(p, 0.06, 0.32)),
      message: textView(before.message, after.message, receipt),
      tag: tagView(before.tag, after.tag, p),
      trio: [1, 2, 3].map(i => lerp(+(before.trio === i), +(after.trio === i), state)),
      counters: { heap: textView(before.heapSize, after.heapSize, stats),
        locked: textView(seq.items.length - before.heapSize, seq.items.length - after.heapSize, stats),
        comp: textView(before.comp, after.comp, stats), swaps: textView(before.swaps, after.swaps, stats) }
    };
    const n = seq.items.length;
    const tagPoint = s => {
      const slot = s.selected == null ? s.focus[0] : s.selected;
      if (slot == null) return { x: 550, y: 51 };
      const point = slot < s.treeSize ? treePoint(slot) : arrayPoint(slot, n);
      return { x: point.x, y: point.y - 58 };
    };
    const tagA = tagPoint(before), tagB = tagPoint(after);
    visual.tagPosition = { x: lerp(tagA.x, tagB.x, state), y: lerp(tagA.y, tagB.y, state) };
    for (const item of seq.items) {
      const a = before.order.indexOf(item.id), b = after.order.indexOf(item.id);
      const ta = a < before.treeSize ? treePoint(a) : arrayPoint(a, n);
      const tb = b < after.treeSize ? treePoint(b) : arrayPoint(b, n);
      const aa = arrayPoint(a, n), ab = arrayPoint(b, n);
      let tx = lerp(ta.x, tb.x, move), ty = lerp(ta.y, tb.y, move);
      let ax = lerp(aa.x, ab.x, move), ay = ARRAY_Y;
      if ((event.kind === 'swap' || event.kind === 'exchange') && a !== b) {
        // 垂直于移动方向分轨，双方不穿过彼此；起止完全归位。
        const dx = tb.x - ta.x, dy = tb.y - ta.y, length = Math.hypot(dx, dy) || 1;
        const bow = Math.sin(Math.PI * move) * (move > 0 && move < 1 ? 36 : 0);
        tx -= dy / length * bow;
        ty += dx / length * bow;
        const lane = Math.max(0, Math.min(1, move / 0.12, (1 - move) / 0.12));
        ay += (b > a ? -1 : 1) * lane * 72;
      }
      visual.items.push({ id: item.id, value: item.value,
        tree: { x: tx, y: ty, alpha: lerp(+(a < before.treeSize), +(b < after.treeSize), move) },
        array: { x: ax, y: ay },
        slot: textView(a, b, win(p, 0.48, 0.72)),
        focus: lerp(+before.focus.includes(a), +after.focus.includes(b), state),
        selected: lerp(+(before.selected === a), +(after.selected === b), state),
        mapping: lerp(+before.links.includes(item.id), +after.links.includes(item.id), win(p, 0, 0.18)),
        locked: lerp(+(a >= before.heapSize), +(b >= after.heapSize), state) });
    }
    for (let slot = 1; slot < n; slot++) {
      const parent = Math.floor((slot - 1) / 2);
      const lit = s => +(slot < s.treeSize && s.focus.includes(parent) && s.focus.includes(slot));
      visual.edges.push({ slot, alpha: lerp(+(slot < before.treeSize), +(slot < after.treeSize), move),
        active: lerp(lit(before), lit(after), state) });
    }
    if (p > 0 && p < 1 && event.slots.length) {
      const slot = event.parent == null ? event.slots[0] : event.parent;
      const point = treePoint(slot);
      visual.guide = { x: point.x, y: point.y,
        alpha: win(p, 0, 0.15) * (1 - win(p, 0.7, 1)) };
    }
    return visual;
  }
  function snapshot(seq, state) {
    // 利用相同采样路径，确保边界画面有且只有一套定义。
    const event = { kind: 'static', before: state, after: state, slots: [] };
    return sampleEvent({ ...seq, events: [event] }, 0, 1);
  }
  function sample(seq, time, reduced = false) {
    const t = Math.max(0, Math.min(seq.duration, Number(time) || 0));
    if (t === 0) return snapshot(seq, seq.initial);
    const index = Math.min(seq.events.length - 1, Math.ceil(t) - 1);
    return sampleEvent(seq, index, reduced ? 1 : t - index);
  }
  return { sample, sampleEvent, snapshot, treePoint, arrayPoint, textView, W, ARRAY_Y };
});
