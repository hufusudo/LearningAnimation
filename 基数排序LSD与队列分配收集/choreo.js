// 动效选用：A1、B1、C3、D1
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RadixChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = x => Math.max(0, Math.min(1, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const ease = x => x * x * (3 - 2 * x);
  const lerp = (a, b, p) => a + (b - a) * p;
  const names = ['个位', '十位', '百位'];
  const beltPoint = i => ({ x: 158 + i * 116, y: 119 });
  const bucketX = b => 72 + b * 103;
  const initialText = '从个位开始：依次读取主序列，放入对应数字桶。';

  // 固定入队格：出队后保留空位，后继队头不必同时重排。
  function positions(seq, state) {
    const points = [];
    state.belt.forEach((id, i) => { if (id !== null) points[id] = beltPoint(i); });
    const input = state.pass === 0 ? seq.initial.belt : seq.rounds[state.pass - 1].order;
    state.buckets.forEach((queue, b) => {
      const order = input.filter(id => seq.items[id].digits[state.pass] === b);
      queue.forEach(id => { points[id] = { x: bucketX(b), y: 504 - order.indexOf(id) * 33 }; });
    });
    return points;
  }
  function along(points, p) {
    const lengths = points.slice(1).map((v, i) => Math.hypot(v.x - points[i].x, v.y - points[i].y));
    let distance = lengths.reduce((a, b) => a + b, 0) * clamp(p);
    for (let i = 0; i < lengths.length; i++) {
      if (distance <= lengths[i] || i === lengths.length - 1) {
        const q = lengths[i] ? distance / lengths[i] : 0;
        return { x: lerp(points[i].x, points[i + 1].x, q), y: lerp(points[i].y, points[i + 1].y, q) };
      }
      distance -= lengths[i];
    }
    return points[0];
  }
  function fadeText(before, after, p, a = 0.05, b = 0.4) {
    if (before === after) return { text: String(after), alpha: 1 };
    const q = win(p, a, b);
    return q < 0.5
      ? { text: String(before), alpha: 1 - ease(q * 2) }
      : { text: String(after), alpha: ease(q * 2 - 1) };
  }
  function phaseLabel(state) {
    return state.complete ? '排序完成' : `第 ${state.pass + 1} 轮 · ${names[state.pass]} · ${state.phase === 'collect' ? 'FIFO 收集' : state.phase === 'ready' ? '准备' : '依次分配'}`;
  }
  function view(seq, index, p) {
    const step = seq.steps[index];
    const a = step.before, b = step.after;
    if (p === 0 || p === 1) {
      const state = p === 0 ? a : b;
      const points = positions(seq, state);
      return {
        cards: seq.items.map(item => ({ id: item.id, ...points[item.id], digit: state.pass, focus: 0, done: state.complete ? 1 : 0 })),
        buckets: state.buckets.map(queue => ({ count: { text: String(queue.length), alpha: 1 }, head: { text: queue.length ? `队头 ${seq.items[queue[0]].tag}` : '空', alpha: 1 }, focus: 0 })),
        text: { text: p === 0 ? (index ? seq.steps[index - 1].text : initialText) : step.text, alpha: 1 },
        phase: { text: phaseLabel(state), alpha: 1 }, stats: { text: String(state.processed), alpha: 1 },
        tag: { text: '', alpha: 0, x: 550, y: 190 }, route: [], routeAlpha: 0, digit: state.pass, complete: state.complete ? 1 : 0
      };
    }
    const from = positions(seq, a), to = positions(seq, b);
    const movement = step.kind === 'distribute' || step.kind === 'collect';
    const q = win(p, 0.2, 0.72);
    const focus = ease(win(p, 0, 0.15)) * (1 - ease(win(p, 0.78, 1)));
    const mix = step.kind === 'finish' ? ease(win(p, 0.2, 0.8)) : 0;
    const digit = lerp(a.pass, b.pass, win(p, 0.2, 0.72));
    let route = [];
    if (movement) {
      const start = from[step.item], end = to[step.item];
      route = step.kind === 'distribute'
        ? [start, { x: start.x, y: 184 }, { x: end.x, y: 184 }, end]
        : [start, { x: start.x, y: 570 }, { x: 1060, y: 570 }, { x: 1060, y: 184 }, { x: end.x, y: 184 }, end];
    }
    const cards = seq.items.map(item => {
      const point = movement && item.id === step.item ? along(route, q) : from[item.id];
      return { id: item.id, ...point, digit, focus: movement && item.id === step.item ? focus : 0,
        done: a.complete ? 1 : mix };
    });
    const previousText = index ? seq.steps[index - 1].text : initialText;
    const text = fadeText(previousText, step.text, p);
    const phase = fadeText(phaseLabel(a), phaseLabel(b), p);
    const stats = fadeText(a.processed, b.processed, p, movement ? 0.73 : 0.5, 0.95);
    const buckets = a.buckets.map((queue, i) => ({
      count: fadeText(queue.length, b.buckets[i].length, p, 0.73, 0.95),
      head: (() => {
        const old = queue.length ? `队头 ${seq.items[queue[0]].tag}` : '空';
        const next = b.buckets[i].length ? `队头 ${seq.items[b.buckets[i][0]].tag}` : '空';
        return fadeText(old, next, p, 0.73, 0.95);
      })(),
      focus: movement && step.bucket === i ? focus : 0
    }));
    const tagAlpha = ease(win(p, 0.74, 0.87)) * (1 - ease(win(p, 0.9, 1)));
    const tag = { text: movement ? (step.kind === 'distribute' ? '队尾入队' : '队头先出') : step.kind === 'finish' ? '稳定升序' : step.after.phase === 'collect' ? '从 0 桶收集' : `读取${names[b.pass]}`,
      alpha: tagAlpha, x: movement ? to[step.item].x : 550,
      y: (movement ? to[step.item].y : 217) - 27 - 5 * ease(win(p, 0.74, 0.87)) };
    return { cards, buckets, text, phase, stats, tag, route,
      routeAlpha: movement ? focus * 0.65 : 0, digit, complete: a.complete ? 1 : mix };
  }
  function sample(seq, time) {
    const t = Math.max(0, Math.min(seq.steps.length, Number(time) || 0));
    if (t === seq.steps.length) return view(seq, seq.steps.length - 1, 1);
    return view(seq, Math.floor(t), t % 1);
  }
  return { sample, view, positions, along, beltPoint, bucketX, names };
});
