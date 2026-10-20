// 动效选用：A1、B1、C3、D1
// 引导 0–.18；匀速传送 .18–.65；落地锁存 .65–.80；回执/停留 .80–1。
(function (root) {
  'use strict';
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const ease = p => p * p * (3 - 2 * p);
  const ROUTES = {
    'pc-mar': [[275,136],[420,136],[490,136]],
    'mar-memory': [[700,136],[830,136],[830,100],[985,100]],
    'instruction-mdr': [[900,180],[850,180],[850,256],[700,256]],
    'data-mdr': [[900,370],[850,370],[850,256],[700,256]],
    'pc-increment': [[120,100],[120,70],[40,70],[40,136],[60,136]],
    'mdr-ir': [[490,256],[420,256],[275,256]],
    'ir-cu': [[275,230],[300,230]],
    'ir-mar': [[275,256],[420,256],[420,136],[490,136]],
    'r0-mar': [[200,496],[215,496],[215,550],[420,550],[420,136],[490,136]],
    'mdr-y': [[490,256],[420,256],[420,376],[490,376]],
    'r1-y': [[375,496],[420,496],[420,376],[490,376]],
    'ir-y': [[275,256],[420,256],[420,376],[490,376]],
    'acc-alu': [[275,376],[420,376],[420,315],[732,315],[732,340]],
    'y-alu': [[625,376],[665,376]],
    'alu-z': [[732,412],[732,460]],
    'z-acc': [[665,496],[420,496],[420,376],[275,376]]
  };
  function pointOnPath(points, p) {
    const lengths = points.slice(1).map((v, i) => Math.hypot(v[0] - points[i][0], v[1] - points[i][1]));
    let d = lengths.reduce((a, b) => a + b, 0) * clamp(p);
    for (let i = 0; i < lengths.length; i++) {
      if (d <= lengths[i] || i === lengths.length - 1) {
        const q = lengths[i] ? d / lengths[i] : 0;
        return { x: points[i][0] + (points[i+1][0] - points[i][0]) * q, y: points[i][1] + (points[i+1][1] - points[i][1]) * q };
      }
      d -= lengths[i];
    }
    return { x: points[0][0], y: points[0][1] };
  }
  function textView(old, next, p) {
    if (old === next) return { text: next, alpha: 1 };
    if (p < .06) return { text: old, alpha: 1 - ease(win(p, 0, .06)) };
    return { text: next, alpha: ease(win(p, .06, .14)) };
  }
  function sample(seq, time, reduced = false) {
    let t = clamp(Number.isFinite(time) ? time : 0, 0, seq.duration);
    if (reduced) t = Math.min(seq.duration, Math.ceil(t / 4) * 4);
    const index = reduced && t > 0 ? Math.min(seq.steps.length - 1, Math.ceil(t / 4) - 1) : Math.min(seq.steps.length - 1, Math.floor(t / 4));
    const p = t === seq.duration || (reduced && t > 0) ? 1 : (t - index * 4) / 4;
    const step = seq.steps[index], prev = seq.steps[index - 1];
    const arrival = p >= .72;
    const state = arrival ? step.after : step.before;
    const valueAlpha = p < .72 ? 1 - ease(win(p, .65, .72)) : ease(win(p, .72, .80));
    const values = {};
    for (const key of Object.keys(state)) {
      values[key] = { value: state[key], alpha: JSON.stringify(step.before[key]) === JSON.stringify(step.after[key]) ? 1 : valueAlpha };
    }
    const envelope = reduced ? 1 : ease(win(p, 0, .16)) * (1 - ease(win(p, .88, 1)));
    const packetAlpha = reduced ? 0 : ease(win(p, .13, .18)) * (1 - ease(win(p, .65, .72)));
    const tagAlpha = reduced && t > 0 ? 1 : ease(win(p, .78, .85)) * (1 - ease(win(p, .93, 1)));
    const title = textView(prev ? prev.title : '准备：从 PC 中的指令地址开始', step.title, p);
    const why = textView(prev ? prev.why : '点击播放，或拖动进度查看数据怎样到达目标。', step.why, p);
    const phase = textView(prev ? prev.phase : '准备', step.phase, p);
    return { t, index, p, step, state, values, title, why, phase,
      activity: envelope, packet: { ...pointOnPath(ROUTES[step.route], win(p, .18, .65)), alpha: packetAlpha },
      tag: { alpha: tagAlpha, dy: 5 * (1 - ease(win(p, .78, .85))) },
      status: p < .18 ? '① 看来源' : p < .65 ? '② 沿线传送' : p < .80 ? '③ 到达锁存' : '④ 停留观察',
      complete: t === seq.duration };
  }
  const api = { ROUTES, pointOnPath, sample, clamp };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CpuChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
