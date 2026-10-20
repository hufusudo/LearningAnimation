// 动效选用：E1、E2、D2、C3。所有位置、透明度与配对状态只由 t 决定。
(function (root) {
  'use strict';
  const clamp = v => Math.max(0, Math.min(1, v));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const ease = p => p * p * (3 - 2 * p);
  function sequence(tiling) {
    const remaining = tiling.internal.length - 1;
    const detailedCount = Math.min(10, remaining);
    const fastCount = remaining - detailedCount;
    const detailedDuration = detailedCount * 2.4;
    const fastDuration = fastCount ? 2.4 : 0;
    const cancellations = Array.from({ length: remaining }, (_, i) => ({
      index: i + 1,
      start: i < detailedCount ? i * 2.4 : detailedDuration + (i - detailedCount) * fastDuration / fastCount,
      duration: i < detailedCount ? 2.4 : fastDuration / fastCount,
      fast: i >= detailedCount
    }));
    const specs = [
      ['一个小格', 6, '先沿一个小格逆时针走一圈，四边贡献之和是环流。'],
      ['相邻两格', 5, '两个小格都逆时针，共用的那条边却走向相反。'],
      ['消去一对', 6, '同一条公共边，积分等值反号，相加为零。'],
      ['铺满区域', 5, '把区域分成小格，每格都沿自己的边界逆时针走。'],
      ['逐对抵消', detailedDuration + fastDuration, '每次只看一条公共边，两次反向积分成对消去。'],
      ['留下外圈', 6, '内部公共边全部抵消；外边只走一次，原位留下。'],
      ['连回旋度', 7, '旋度是局部环流密度；乘面积再相加，得到外圈环流。']
    ];
    let total = 0;
    const steps = specs.map(([name, duration, note], index) => {
      const start = total; total += duration;
      return { name, duration, note, start, end: total, index };
    });
    const events = [...steps.map(s => s.start)];
    // 逐步控件也能逐条检查公共边，而不是整批跳过。
    cancellations.forEach(event => events.push(steps[4].start + event.start + .94 * event.duration));
    events.push(total);
    return { steps, total, cancellations, detailedCount, detailedDuration, fastDuration, events: [...new Set(events)].sort((a, b) => a - b) };
  }
  function sample(tiling, seq, time, reduced = false) {
    const t = Math.max(0, Math.min(seq.total, Number(time) || 0));
    const step = seq.steps.find(s => t < s.end) || seq.steps.at(-1);
    const index = step.index;
    const actualP = clamp((t - step.start) / step.duration);
    let p = actualP;
    if (reduced) p = 1;
    const visible = tiling.cells.map(c => {
      if (c.id === 0) return 1;
      if (c.id === 1) return index === 0 ? 0 : index === 1 ? ease(win(p, .12, .72)) : 1;
      if (index < 3) return 0;
      if (index > 3) return 1;
      const rank = (c.id - 2) / Math.max(1, tiling.cells.length - 2);
      return ease(win(p, .08 + .55 * rank, .3 + .55 * rank));
    });
    const cancel = tiling.internal.map(() => 0);
    let active = index >= 1 && index <= 2 ? 0 : -1, focus = 0, motion = 0, receipt = 0;
    if (index === 1) focus = ease(win(p, .72, .95));
    if (index === 2) {
      focus = 1;
      motion = win(p, .12, .56);
      cancel[0] = ease(win(p, .56, .8));
      receipt = ease(win(p, .8, .95));
    }
    if (index >= 3) cancel[0] = 1;
    if (index === 3 && p < .12) { active = 0; focus = 1 - ease(win(p, 0, .12)); }
    if (index === 4) {
      const elapsed = Math.max(0, t - step.start);
      const event = seq.cancellations.find(e => elapsed < e.start + e.duration) || seq.cancellations.at(-1);
      const current = event.index;
      const fraction = clamp((elapsed - event.start) / event.duration);
      const q = reduced ? (fraction >= .76 ? 1 : 0) : fraction;
      for (let i = 1; i < tiling.internal.length; i++) {
        cancel[i] = i < current ? 1 : i === current ? ease(win(q, .5, .76)) : 0;
      }
      active = current;
      focus = reduced ? 1 : event.fast ? 0 : ease(win(q, 0, .15)) * (1 - ease(win(q, .86, 1)));
      motion = win(q, .15, .5);
      receipt = ease(win(q, .76, .86)) * (1 - ease(win(q, .9, 1)));
      if (actualP === 1) { cancel.fill(1); active = -1; focus = 0; receipt = 0; }
    }
    if (index >= 5) cancel.fill(1);
    const boundary = index < 5 ? 0 : index === 5 ? ease(win(p, .08, .65)) : 1;
    const formula = index < 6 ? 0 : ease(win(p, .14, .75));
    // 跨步文字先淡旧再淡新，初始无闪现。几何状态在边界完全相等。
    const textAlpha = index === 0 ? 1 : p < .12 ? 1 - p / .12 : ease(win(p, .12, .28));
    const textIndex = index > 0 && p < .12 ? index - 1 : index;
    const panels = {
      local: index === 0 ? 1 : index === 1 ? 1 - ease(win(p, .55, .7)) : index === 3 ? ease(win(p, .12, .36)) * (1 - ease(win(p, .88, 1))) : 0,
      pair: index === 1 ? ease(win(p, .72, .95)) : index === 2 ? 1 : index === 3 ? 1 - ease(win(p, 0, .12)) : index === 4 ? focus : 0,
      result: index === 5 ? boundary : index === 6 ? 1 - ease(win(p, 0, .12)) : 0,
      formula
    };
    if (reduced && index === 3) panels.local = 1;
    return { t, index, p, visible, cancel, active, focus, motion, receipt, boundary, formula, panels,
      cancelled: cancel.filter(v => v >= 1).length, token: index < 2 && !reduced ? (t / 4) % 1 : null,
      tokenAlpha: index === 1 ? 1 - ease(win(p, .8, 1)) : index === 0 ? 1 : 0,
      fast: index === 4 && t - step.start >= seq.detailedDuration && seq.fastDuration > 0,
      textAlpha, textIndex };
  }
  root.GreenChoreo = { clamp, win, ease, sequence, sample };
})(typeof globalThis !== 'undefined' ? globalThis : window);
