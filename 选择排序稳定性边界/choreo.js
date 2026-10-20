/* 画面只由快照与局部进度决定，不读取 DOM 或上一帧。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SelectionChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = x => Math.max(0, Math.min(1, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const lerp = (a, b, p) => a + (b - a) * p;
  const mix = (a, b, p) => p === 1 ? b : p === 0 ? a : lerp(a, b, p);

  function textView(a, b, p, start = .67, end = .94) {
    if (a === b) return { text: String(b), alpha: 1 };
    const q = win(p, start, end);
    return q < .5 ? { text: String(a), alpha: 1 - q * 2 } : { text: String(b), alpha: (q - .5) * 2 };
  }
  function receiptView(a, b, p) {
    if (a === b) return { text: String(b), alpha: 1 };
    return p < .5 ? { text: String(a), alpha: 1 - win(p, 0, .16) } : { text: String(b), alpha: win(p, .78, .98) };
  }
  function marker(a, b, p) {
    const q = win(p, .18, .65);
    const alpha = mix(a === null ? 0 : 1, b === null ? 0 : 1, q);
    return {
      pos: alpha === 0 ? 0 : mix(a === null ? b : a, b === null ? a : b, q),
      alpha,
      label: textView(a === null ? '' : a, b === null ? '' : b, p, .18, .65)
    };
  }
  // 先离轨，再沿水平方向匀速换位，最后回轨；两个对象分层。
  function exchange(p, direction) {
    const q = win(p, .18, .76);
    return { travel: win(q, .18, .82), y: direction * 75 * (win(q, 0, .18) - win(q, .82, 1)) || 0 };
  }
  function orderText(state, watch) {
    if (!watch) return { status: '本例无同值元素', detail: '不能据此判断算法稳定', inverted: false };
    const a = state.arr.findIndex(it => it.id === watch[0]);
    const b = state.arr.findIndex(it => it.id === watch[1]);
    return a > b
      ? { status: '同值身份已逆序', detail: '远距离交换改变了相对次序', inverted: true }
      : { status: '相对次序保留', detail: state.sorted === state.arr.length ? '本例未逆序，算法仍不稳定' : '关注字母，而不是数值', inverted: false };
  }
  function passText(state) {
    return state.sorted === state.arr.length ? '全部就绪' : state.i === null ? '尚未开始' : `第 ${state.i + 1} / ${state.arr.length - 1} 趟`;
  }
  function frame(before, after, step, p, watch) {
    p = p >= 1 - 1e-10 ? 1 : p <= 1e-10 ? 0 : clamp(p);
    const move = win(p, .18, .76);
    const items = before.arr.map((item, from) => {
      const to = after.arr.findIndex(it => it.id === item.id);
      let x = from, y = 0;
      if (from !== to) {
        const path = exchange(p, from < to ? 1 : -1);
        x = mix(from, to, path.travel);
        y = path.y;
      }
      return { id: item.id, x, y, ready: mix(from < before.sorted ? 1 : 0, to < after.sorted ? 1 : 0, move) };
    }).sort((a, b) => a.id - b.id);
    const oldOrder = orderText(before, watch), newOrder = orderText(after, watch);
    // 短暂引导与路径在两个端点都消失；不把下一步的身份带入上一步终点。
    const guideAlpha = p <= 0 || p >= .3 ? 0 : Math.sin(Math.PI * p / .3);
    const pathAlpha = step && step.type === 'swap' && p > .08 && p < .92
      ? Math.min(win(p, .08, .18), 1 - win(p, .76, .92)) : 0;
    return {
      items,
      min: marker(before.min, after.min, step?.type === 'swap' ? Math.min(1, p * 4) : p),
      j: marker(before.j, after.j, step?.type === 'swap' ? Math.min(1, p * 4) : p),
      boundary: mix(before.sorted, after.sorted, move),
      comp: textView(before.comp, after.comp, p, .76, .98),
      swap: textView(before.swap, after.swap, p, .76, .98),
      title: textView(before.title, after.title, p, .02, .18),
      note: textView(before.note, after.note, p, .02, .18),
      tag: receiptView(before.tag, after.tag, p),
      pass: textView(passText(before), passText(after), p, .02, .18),
      region: textView(`已就绪 ${before.sorted} / ${before.arr.length}`, `已就绪 ${after.sorted} / ${after.arr.length}`, p),
      order: receiptView(oldOrder.status, newOrder.status, p),
      orderDetail: receiptView(oldOrder.detail, newOrder.detail, p),
      warning: mix(oldOrder.inverted ? 1 : 0, newOrder.inverted ? 1 : 0, win(p, .8, .99)),
      guide: { alpha: guideAlpha, positions: guideAlpha > 0 && step ? step.focus : [] },
      paths: { alpha: pathAlpha, pair: pathAlpha > 0 ? step.pair : null }
    };
  }
  function sample(sequence, time) {
    const t = Math.max(0, Math.min(sequence.duration, Number.isFinite(time) ? time : 0));
    if (t === 0 || !sequence.steps.length) return frame(sequence.initial, sequence.initial, null, 1, sequence.watch);
    const step = sequence.steps.find(s => t <= s.end) || sequence.steps[sequence.steps.length - 1];
    return frame(step.before, step.after, step, (t - step.start) / step.duration, sequence.watch);
  }
  return { win, exchange, textView, frame, sample, orderText };
});
