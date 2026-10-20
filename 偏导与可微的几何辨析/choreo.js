// 动效选用：A3、G1、C3、D1
// 纯函数导览编排：画面只由时间采样决定，适用于经典脚本与 file://。
(function (root) {
  'use strict';

  const CONCEPTS = ['A', 'B', 'C', 'D'];
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const smooth = (value) => value * value * (3 - 2 * value);
  const lerp = (from, to, amount) => from + (to - from) * amount;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

  function snapshot(value) {
    return {
      sample: value.sample,
      theta: value.theta,
      k: value.k,
      text: value.text,
      title: value.title,
      focus: value.focus,
      tag: value.tag
    };
  }

  function build(spec) {
    if (!spec || !Array.isArray(spec.steps) || spec.steps.length === 0) {
      throw new TypeError('PDChoreo.build 需要至少一个步骤');
    }

    const initial = spec.start || {};
    let previous = {
      sample: own(initial, 'sample') ? initial.sample : null,
      theta: finiteOr(initial.theta, 0),
      k: finiteOr(initial.k, 0),
      text: typeof initial.text === 'string' ? initial.text : '',
      title: typeof initial.title === 'string' ? initial.title : '',
      focus: own(initial, 'focus') ? initial.focus : null,
      tag: null
    };
    let cursor = 0;

    const steps = spec.steps.map((input, index) => {
      if (!input || typeof input !== 'object') {
        throw new TypeError(`第 ${index + 1} 步必须是对象`);
      }
      const dur = finiteOr(input.dur, 0);
      const length = Math.max(2.4, dur + 2.0);
      const from = snapshot(previous);
      const target = {
        sample: own(input, 'sample') ? input.sample : previous.sample,
        theta: finiteOr(input.theta, previous.theta),
        k: finiteOr(input.k, previous.k),
        text: typeof input.text === 'string' ? input.text : previous.text,
        title: typeof input.title === 'string' ? input.title : previous.title,
        // 焦点在步开始时可以先指向即将变化的对象。
        focus: own(input, 'focus') ? input.focus : previous.focus,
        tag: typeof input.tag === 'string' && input.tag ? input.tag : null,
        reveal: Array.isArray(input.reveal)
          ? Array.from(new Set(input.reveal.filter((item) => CONCEPTS.includes(item))))
          : []
      };
      const step = {
        start: cursor,
        end: cursor + length,
        from,
        target,
        duration: length
      };
      cursor = step.end;
      previous = target;
      return step;
    });

    return { steps, duration: cursor };
  }

  function normalizedTime(seq, time) {
    if (time === Infinity) return seq.duration;
    if (!Number.isFinite(time) || time < 0) return 0;
    return Math.min(seq.duration, time);
  }

  function locate(seq, time) {
    let index = 0;
    // 精确步末留在本步，便于单步定位时展示本步标题与回执。
    while (index < seq.steps.length - 1 && time > seq.steps[index].end) index += 1;
    const step = seq.steps[index];
    const progress = clamp01((time - step.start) / step.duration);
    return { step, index, progress };
  }

  function knowledgeAt(seq, index, progress, shownSample, reduced) {
    const bySample = new Map();
    for (let i = 0; i < index; i += 1) {
      const done = seq.steps[i].target;
      if (!bySample.has(done.sample)) bySample.set(done.sample, new Set());
      done.reveal.forEach((concept) => bySample.get(done.sample).add(concept));
    }

    const current = seq.steps[index];
    if (reduced || progress >= 0.8) {
      if (!bySample.has(current.target.sample)) bySample.set(current.target.sample, new Set());
      current.target.reveal.forEach((concept) => bySample.get(current.target.sample).add(concept));
    }

    const knownSet = bySample.get(shownSample) || new Set();
    return Object.fromEntries(CONCEPTS.map((concept) => [concept, knownSet.has(concept)]));
  }

  function sample(seq, time, reduced) {
    if (!seq || !Array.isArray(seq.steps) || seq.steps.length === 0) {
      throw new TypeError('PDChoreo.sample 需要 build 返回的非空序列');
    }
    const t = normalizedTime(seq, time);
    const located = locate(seq, t);
    const { step, index, progress } = located;
    const target = step.target;

    if (reduced) {
      return {
        sample: target.sample,
        theta: target.theta,
        k: target.k,
        text: target.text,
        title: target.title,
        focus: target.focus,
        tag: target.tag,
        index,
        progress: 1,
        alpha: 1,
        textAlpha: 1,
        receiptAlpha: target.tag ? 1 : 0,
        known: knowledgeAt(seq, index, progress, target.sample, true)
      };
    }

    const switchesSample = step.from.sample !== target.sample;
    const alpha = !switchesSample
      ? 1
      : progress < 0.2
        ? 1 - smooth(progress / 0.2)
        : progress < 0.4
          ? smooth((progress - 0.2) / 0.2)
          : 1;
    const shownSample = switchesSample && progress < 0.2
      ? step.from.sample
      : target.sample;
    const textChanges = step.from.text !== target.text;
    const textAlpha = !textChanges
      ? 1
      : progress < 0.2
        ? 1 - smooth(progress / 0.2)
        : progress < 0.4
          ? smooth((progress - 0.2) / 0.2)
          : 1;
    const mainProgress = clamp01((progress - 0.25) / (0.72 - 0.25));
    const oldTagAlpha = smooth(clamp01(progress / 0.2));
    const newTagAlpha = smooth(clamp01((progress - 0.8) / 0.2));
    const tag = progress < 0.2
      ? step.from.tag
      : progress >= 0.8
        ? target.tag
        : null;
    const receiptAlpha = progress < 0.2
      ? (step.from.tag ? 1 - oldTagAlpha : 0)
      : progress >= 0.8
        ? (target.tag ? newTagAlpha : 0)
        : 0;

    return {
      sample: shownSample,
      theta: lerp(step.from.theta, target.theta, mainProgress),
      k: lerp(step.from.k, target.k, mainProgress),
      text: textChanges && progress < 0.2 ? step.from.text : target.text,
      title: target.title,
      focus: target.focus,
      tag,
      index,
      progress,
      alpha,
      textAlpha,
      receiptAlpha,
      known: knowledgeAt(seq, index, progress, shownSample, false)
    };
  }

  root.PDChoreo = { build, sample };
  if (typeof module === 'object' && module.exports) module.exports = root.PDChoreo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
