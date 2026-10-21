// 动效选用：A3、C2、E1、D1、G1
// 几何、积分扫描和回执均由时刻计算；GSAP 只推进时钟。
(function (root) {
  'use strict';
  const boundaries = [0, 2, 4, 7, 10, 16];
  const names = ['固定切片', '展开截面', '沿线积分', '面积变高度', '连成曲线'];
  const captions = [
    '固定一个变量，竖直切面截出一条密度曲线。',
    '沿另一个变量展开，曲线下方就是当前截面。',
    '把截面中的细条沿横轴累加，得到面积 A。',
    '面积 A 成为边缘密度的高度，不是轮廓投影。',
    '移动切面，每个截面面积对应曲线上的一个高度。'
  ];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const win = (t, a, b) => clamp((t - a) / (b - a));
  function sample(t, anchor, range, explore = false) {
    t = clamp(t, 0, 16);
    const phase = Math.min(4, boundaries.findIndex((v, i) => i > 0 && t < v) - 1);
    const index = phase < 0 ? 4 : phase;
    const q = win(t, 10, 16);
    let u = anchor, traceMin = anchor, traceMax = anchor;
    if (!explore && t >= 10) {
      if (q <= 0.25) {
        u = anchor + (range[1] - anchor) * q * 4;
        traceMax = u;
      } else if (q <= 0.75) {
        u = range[1] + (range[0] - range[1]) * (q - 0.25) * 2;
        traceMax = range[1]; traceMin = Math.min(anchor, u);
      } else {
        u = range[0] + (anchor - range[0]) * (q - 0.75) * 4;
        traceMin = range[0]; traceMax = range[1];
      }
    }
    return {
      t, phase: index, name: names[index], caption: captions[index], u,
      focus: win(t, 0, 1.2), unfold: win(t, 2.2, 3.6),
      fill: win(t, 4.2, 6.4), integration: win(t, 4.2, 6.4),
      transfer: win(t, 7.25, 9.3), receipt: win(t, 9.3, 9.8),
      scanning: t >= 10 && !explore,
      traceMin, traceMax, traceVisible: t >= 10 && !explore,
      // 标签之间交叉淡变；在阶段边界先保留上一阶段。
      captionIndex: index > 0 && t - boundaries[index] < 0.18 ? index - 1 : index,
      captionAlpha: index === 0 ? 1 : clamp(Math.abs((t - boundaries[index]) / 0.18 - 1))
    };
  }
  const api = { boundaries, names, captions, sample, clamp, win, duration: 16 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DensityChoreo = api;
})(globalThis);
