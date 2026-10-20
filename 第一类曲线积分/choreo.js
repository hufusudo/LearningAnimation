// 动效选用：A1、B1、C1、C2、C3、D1、E1
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CurveChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const ease = p => p * p * (3 - 2 * p);
  const titles = ['密度着色', '分割曲线', '提取微元', '勾股求长', '弧长微元', '逐段称重', '质量累加', '取极限'];
  const captions = ['颜色表示线密度，同样长度也可能有不同质量。', '以弦代弧，分割越细，局部近似越贴近原曲线。', '把选中的同一小段放大，保留它的方向与比例。', '弦的水平、竖直投影组成直角三角形。', '让小段趋于零，弦长关系成为弧长微元关系。', '中点密度乘弦长，得到这一小段的近似质量。', '沿曲线逐段取样，把近似质量加入总和。', '有限分割仍有误差；最大段长趋零时得到积分。'];
  function build(N) {
    const detailedCount = Math.min(N, 10);
    const sweepDuration = N > detailedCount ? 1.2 : 0;
    const starts = [0, 2.4, 4.8, 7.4, 10, 12.6, 15.2, 15.2 + detailedCount * .65 + sweepDuration];
    const duration = starts[7] + 3.2;
    const boundaries = [...starts, duration];
    for (let i = 1; i <= detailedCount; i++) {
      const t = starts[6] + i * .65;
      if (t < starts[7]) boundaries.push(t);
    }
    boundaries.sort((a, b) => a - b);
    return { N, detailedCount, sweepDuration, starts, duration, boundaries };
  }
  function sample(seq, time) {
    const t = clamp(time, 0, seq.duration);
    let step = 0;
    while (step < 7 && t > seq.starts[step + 1]) step++;
    const end = seq.starts[step + 1] ?? seq.duration;
    const p = clamp((t - seq.starts[step]) / (end - seq.starts[step]));
    const reveal = i => step > i ? 1 : step < i ? 0 : ease(win(p, .16, .66));
    const elapsed = t - seq.starts[6];
    const localSum = clamp(elapsed / .65, 0, seq.detailedCount);
    const index = Math.min(seq.detailedCount - 1, Math.floor(localSum));
    const sub = localSum - Math.floor(localSum);
    const sweep = t >= seq.starts[7] ? 1 : seq.sweepDuration ? clamp((elapsed - seq.detailedCount * .65) / seq.sweepDuration) : 0;
    const remaining = seq.N - seq.detailedCount;
    const fillWindow = Math.max(.25, 1 / Math.max(1, remaining));
    const fills = Array.from({ length: seq.N }, (_, i) => {
      if (i < seq.detailedCount) return localSum >= i + 1 ? 1 : i === index ? win(sub, .72, .96) : 0;
      // 余段用一波连续填充完成，避免密集重复的逐段飞行动画。
      const start = (1 - fillWindow) * (i - seq.detailedCount) / Math.max(1, remaining - 1);
      return win(sweep, start, start + fillWindow);
    });
    const moving = step === 6 && localSum < seq.detailedCount;
    const words = p < .14 && step > 0 ? step - 1 : step;
    const alpha = step === 0 ? 1 : p < .14 ? 1 - p / .14 : ease(win(p, .14, .3));
    return {
      t, step, p,
      view: {
        density: reveal(0), split: reveal(1), extract: step>2?1:step<2?0:win(p,.16,.66), triangle: reveal(3),
        differential: reveal(4), mass: reveal(5), result: reveal(7),
        fills, sumIndex: index, moving, fastSum: seq.sweepDuration > 0 && elapsed >= seq.detailedCount * .65,
        flight: moving ? win(sub, .2, .68) : 0,
        guide: moving ? ease(win(sub, 0, .18)) * (1 - ease(win(sub, .72, 1))) : 0,
        title: titles[words], caption: captions[words], textAlpha: alpha,
        tagAlpha: step>0&&p<.14?1-p/.14:ease(win(p, .72, .94)), tagStep: step>0&&p<.14?step-1:step,
        focus: step === 2 ? Math.sin(Math.PI * win(p, 0, .2)) : 0
      }
    };
  }
  return { clamp, win, ease, build, sample, titles };
});
