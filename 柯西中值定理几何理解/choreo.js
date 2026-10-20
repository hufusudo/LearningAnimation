// 动效选用：A1、E1、G1、C3、D1
(function (root) {
  'use strict';
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const ease = x => x * x * (3 - 2 * x);
  function build(analysis) {
    const base = { t: analysis.a, secant: 0, tangent: 0, marks: analysis.roots.map(() => 0), confirm: 0 };
    const steps = [];
    let time = 0, before = base;
    const add = (kind, duration, title, caption, after) => {
      steps.push({ kind, start: time, duration, title, caption, before, after });
      time += duration;
      before = after;
    };
    add('connect', 2, '连接端点', '连接 A、B，割线给出整个区间的变化方向。', { ...before, secant: 1 });
    const targets = analysis.roots.length ? analysis.roots : [analysis.b];
    targets.forEach((t, i) => {
      add('scan', 4, '移动切线', i ? '继续移动切点，同一区间可能有多个中值点。' : '沿曲线移动切点，观察切线方向如何变化。', { ...before, t, tangent: 1, confirm: 0 });
      if (analysis.roots.length) {
        const marks = before.marks.map((v, j) => j === i ? 1 : v);
        add('confirm', 2, '验证平行', '此处切线平行于割线，辅助函数也有水平切线。', { ...before, marks, confirm: 1 });
      }
    });
    return { steps, duration: time, boundaries: [0, ...steps.map(s => s.start + s.duration)], initial: base };
  }
  function frameAt(sequence, index, p) {
    const step = sequence.steps[index];
    p = clamp(p);
    const a = step.before, b = step.after;
    const q = step.kind === 'scan' ? win(p, .12, .84) : ease(win(p, .15, .7));
    const previous = sequence.steps[index - 1] || { title: '准备观察', caption: '参数曲线的横坐标是 g(t)，纵坐标是 f(t)。' };
    const text = p < .12 ? { title: previous.title, caption: previous.caption, alpha: 1 - ease(p / .12) } : { title: step.title, caption: step.caption, alpha: ease(win(p, .12, .26)) };
    return {
      t: a.t + (b.t - a.t) * q,
      secant: a.secant + (b.secant - a.secant) * q,
      tangent: a.tangent + (b.tangent - a.tangent) * ease(win(p, 0, .12)),
      marks: a.marks.map((v, i) => v + (b.marks[i] - v) * ease(win(p, .7, .95))),
      confirm: a.confirm + (b.confirm - a.confirm) * ease(win(p, step.kind === 'confirm' ? .7 : 0, step.kind === 'confirm' ? .95 : .12)),
      focus: Math.sin(Math.PI * win(p, 0, .15)) * (p < .15 ? 1 : 0),
      ...text
    };
  }
  function sample(sequence, time) {
    time = clamp(time, 0, sequence.duration);
    const index = sequence.steps.findIndex(s => time < s.start + s.duration);
    const i = index < 0 ? sequence.steps.length - 1 : index;
    const step = sequence.steps[i];
    return { ...frameAt(sequence, i, (time - step.start) / step.duration), index: i, time };
  }
  const api = { build, frameAt, sample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CauchyChoreo = api;
})(typeof window !== 'undefined' ? window : globalThis);
