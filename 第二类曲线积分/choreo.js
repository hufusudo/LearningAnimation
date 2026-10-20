// 动效选用：A1、B1、C1、C2、C3、D1、E1
(function (root) {
  'use strict';
  const durations = [1.3, 1.05, 1.05, 0.95, 1.25];
  const phases = ['取一小段', '水平做功', '竖直做功', '两项相加', '汇入积分'];
  const offsets = [0];
  durations.forEach(d => offsets.push(Number((offsets.at(-1) + d).toFixed(9))));
  const cycle = offsets.at(-1);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const ease = p => p * p * (3 - 2 * p);
  const mix = (a, b, p) => a + (b - a) * p;
  const sum = (a, b, p) => ({ wx: mix(a.wx, b.wx, p), wy: mix(a.wy, b.wy, p), work: mix(a.work, b.work, p) });
  function boundary(step) { return Number((Math.floor(step / 5) * cycle + offsets[step % 5]).toFixed(9)); }
  function duration(exp) { return boundary(exp.count * 5); }
  function sample(exp, time) {
    const t = Math.round(clamp(time, 0, duration(exp)) * 1e9) / 1e9;
    const done = t >= duration(exp);
    const index = done ? exp.count - 1 : Math.min(exp.count - 1, Math.floor((t + 1e-9) / cycle));
    const local = done ? cycle : t - index * cycle;
    let phase = done ? 4 : durations.findIndex((d, i) => local < offsets[i + 1] - 1e-9);
    if (phase < 0) phase = 4;
    const p = done ? 1 : clamp((local - offsets[phase]) / durations[phase]);
    const segment = exp.segments[index];
    const move = phase === 0 ? win(p, 0.15, 0.78) : 1;
    const receipt = phase === 4 ? win(p, 0.72, 1) : 0;
    const select = phase === 0 ? ease(win(p, 0.12, 0.38)) : 1;
    const oldSelect = phase === 0 && index > 0 ? 1 - ease(win(p, 0, 0.12)) : 0;
    const details = [];
    if (phase === 0 && index > 0 && p < 0.22) {
      details.push({ index: index - 1, alpha: 1 - ease(win(p, 0, 0.22)), x: 1, y: 1, result: 1 });
    }
    details.push({ index, alpha: phase === 0 ? ease(win(p, 0.52, 0.9)) : 1,
      x: phase > 1 ? 1 : phase === 1 ? win(p, 0.16, 0.76) : 0,
      y: phase > 2 ? 1 : phase === 2 ? win(p, 0.16, 0.76) : 0,
      result: phase > 3 ? 1 : phase === 3 ? ease(win(p, 0.18, 0.75)) : 0 });
    const step = index * 5 + phase;
    const textQ = ease(win(p, 0.18, 0.4));
    const textStep = p < 0.18 && step > 0 ? step - 1 : step;
    const textAlpha = step === 0 ? 1 : p < 0.18 ? 1 - ease(p / 0.18) : textQ;
    return {
      t, index, phase, p, step, done,
      marker: { x: mix(segment.start.x, segment.end.x, move), y: mix(segment.start.y, segment.end.y, move) },
      move, select, oldSelect, details,
      focus: phase === 0 ? Math.sin(Math.PI * win(p, 0, 0.4)) : 0,
      receipt, cumulative: sum(segment.before, segment.after, receipt),
      chip: { visible: phase === 4 && p > 0.12 && p < 0.7, progress: phase === 4 ? win(p, 0.12, 0.7) : 0 },
      textStep, textAlpha,
      completed: done ? exp.count : index + (receipt >= 1 ? 1 : 0)
    };
  }
  function sampleStep(exp, step, progress) {
    const s = clamp(Math.floor(step), 0, exp.count * 5 - 1);
    return sample(exp, progress >= 1 ? boundary(s + 1) : boundary(s) + durations[s % 5] * clamp(progress));
  }
  const api = { durations, phases, offsets, cycle, boundary, duration, sample, sampleStep, clamp, win, ease };
  root.LineIntegralChoreo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
