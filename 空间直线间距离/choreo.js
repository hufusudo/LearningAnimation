/**
 * 空间直线间距离 · 视觉编排（纯函数，只依赖（步，进度））
 * storyView(p) 给出 p ∈ [0, 4] 时每一步的引导、主动作与回执程度；界面只负责写 three.js 对象。
 * 每步先引导（外环/高亮先亮）→ 主动作（一个元素生长）→ 回执（标签淡入）；回执晚于主动作结束。
 */
(function (root) {
  'use strict';

  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const win = (p, a, b) => clamp01((p - a) / (b - a));
  const ease = (q) => q * q * (3 - 2 * q);

  const STEPS = 4;
  // 步内局部进度 u ∈ [0, 1]：越界时钳制，因此步首全为 0、步末全为 1，边界天然连续
  const local = (p, s) => clamp01(p - (s - 1));
  const guideOf = (u) => ease(win(u, 0, 0.25)) * (1 - ease(win(u, 0.85, 1)));
  const mainOf = (u) => ease(win(u, 0.25, 0.7));
  const tagOf = (u) => ease(win(u, 0.72, 1));

  function storyView(p) {
    const view = { guide: [], main: [], tag: [] };
    for (let s = 1; s <= STEPS; s++) {
      const u = local(p, s);
      view.guide.push(guideOf(u));
      view.main.push(mainOf(u));
      view.tag.push(tagOf(u));
    }
    return view;
  }

  // 同一步内的子动作（如先画 s₁ 再画 s₂）：在步内 [a, b] 区间上生长
  const split = (p, s, a, b) => ease(win(local(p, s), a, b));

  const api = { STEPS, storyView, split };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StoryChoreo = api;
})(typeof window === 'undefined' ? globalThis : window);
