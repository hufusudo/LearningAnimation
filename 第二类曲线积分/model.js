(function (root) {
  'use strict';
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const vertices = [
    { x: -2, y: -1 }, { x: -0.9, y: 1 },
    { x: 0.5, y: -0.75 }, { x: 1.8, y: 0.85 }
  ];
  const radius = 1.65;

  function pointAt(path, t) {
    t = clamp(t, 0, 1);
    if (path === 'polyline') {
      const index = Math.min(2, Math.floor(t * 3));
      const u = t * 3 - index;
      return {
        x: vertices[index].x + (vertices[index + 1].x - vertices[index].x) * u,
        y: vertices[index].y + (vertices[index + 1].y - vertices[index].y) * u
      };
    }
    if (path === 'parabola') {
      const x = -2 + 4 * t;
      return { x, y: 0.35 * x * x - 0.8 };
    }
    if (path === 'semicircle') {
      return { x: -radius * Math.cos(Math.PI * t), y: radius * Math.sin(Math.PI * t) };
    }
    throw new Error('Unknown path: ' + path);
  }

  function tangentAt(path, t) {
    if (path === 'polyline') {
      const index = Math.min(2, Math.floor(clamp(t, 0, 0.999999) * 3));
      return {
        x: 3 * (vertices[index + 1].x - vertices[index].x),
        y: 3 * (vertices[index + 1].y - vertices[index].y)
      };
    }
    if (path === 'parabola') {
      const x = -2 + 4 * clamp(t, 0, 1);
      return { x: 4, y: 2.8 * x };
    }
    if (path === 'semicircle') {
      return { x: radius * Math.PI * Math.sin(Math.PI * t), y: radius * Math.PI * Math.cos(Math.PI * t) };
    }
    throw new Error('Unknown path: ' + path);
  }

  function forceAt(field, x, y) {
    if (field === 'vortex') return { P: -y, Q: x };
    if (field === 'radial') return { P: x, Q: y };
    if (field === 'constant') return { P: 1.3, Q: 0.7 };
    throw new Error('Unknown field: ' + field);
  }

  function buildTrajectory(path, field, count = 1800) {
    const samples = [{ t: 0, ...pointAt(path, 0), arc: 0, wx: 0, wy: 0 }];
    for (let i = 1; i <= count; i++) {
      const previous = samples[i - 1], t = i / count;
      const point = pointAt(path, t);
      const midpoint = pointAt(path, (i - 0.5) / count);
      const force = forceAt(field, midpoint.x, midpoint.y);
      const dx = point.x - previous.x, dy = point.y - previous.y;
      samples.push({
        t, ...point, arc: previous.arc + Math.hypot(dx, dy),
        wx: previous.wx + force.P * dx,
        wy: previous.wy + force.Q * dy
      });
    }
    const last = samples[count];
    return { path, field, samples, length: last.arc, total: { wx: last.wx, wy: last.wy, work: last.wx + last.wy } };
  }

  function buildPartition(path, field, count = 12, reverse = false) {
    if (!Number.isInteger(count) || count <= 0 || count % 3 !== 0) {
      throw new Error('Partition count must be a positive multiple of 3');
    }
    const segments = [];
    let wx = 0, wy = 0, work = 0;
    for (let step = 0; step < count; step++) {
      const index = reverse ? count - 1 - step : step;
      const t0 = index / count, t1 = (index + 1) / count;
      const forwardStart = pointAt(path, t0), forwardEnd = pointAt(path, t1);
      const start = reverse ? forwardEnd : forwardStart;
      const end = reverse ? forwardStart : forwardEnd;
      const midpoint = { x: (forwardStart.x + forwardEnd.x) / 2, y: (forwardStart.y + forwardEnd.y) / 2 };
      const dx = end.x - start.x, dy = end.y - start.y;
      const { P, Q } = forceAt(field, midpoint.x, midpoint.y);
      const segmentWx = Math.abs(P * dx) < 1e-12 ? 0 : P * dx;
      const segmentWy = Math.abs(Q * dy) < 1e-12 ? 0 : Q * dy;
      const segmentWork = Math.abs(segmentWx + segmentWy) < 1e-12 ? 0 : segmentWx + segmentWy;
      const before = { wx, wy, work };
      wx += segmentWx;
      wy += segmentWy;
      work += segmentWork;
      if (Math.abs(wx) < 1e-12) wx = 0;
      if (Math.abs(wy) < 1e-12) wy = 0;
      if (Math.abs(work) < 1e-12) work = 0;
      segments.push({
        index: step, start: { ...start }, end: { ...end }, midpoint,
        P, Q, dx, dy, wx: segmentWx, wy: segmentWy, work: segmentWork,
        before, after: { wx, wy, work }
      });
    }
    const reference = buildTrajectory(path, field).total;
    const sign = reverse ? -1 : 1;
    return {
      path, field, count, reverse, segments,
      total: { wx, wy, work },
      reference: { wx: sign * reference.wx, wy: sign * reference.wy, work: sign * reference.work }
    };
  }

  function atArcFraction(route, fraction) {
    const samples = route.samples, target = clamp(fraction, 0, 1) * route.length;
    let lo = 0, hi = samples.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (samples[mid].arc < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return { ...samples[0] };
    const before = samples[lo - 1], after = samples[lo];
    const alpha = (target - before.arc) / (after.arc - before.arc || 1);
    const mix = key => before[key] + (after[key] - before[key]) * alpha;
    return { t: mix('t'), x: mix('x'), y: mix('y'), arc: target, wx: mix('wx'), wy: mix('wy') };
  }

  function stateAt(route, progress, reverse = false) {
    const sample = atArcFraction(route, reverse ? 1 - progress : progress);
    const wx = reverse ? sample.wx - route.total.wx : sample.wx;
    const wy = reverse ? sample.wy - route.total.wy : sample.wy;
    const force = forceAt(route.field, sample.x, sample.y);
    return { ...sample, progress: clamp(progress, 0, 1), P: force.P, Q: force.Q, wx, wy, work: wx + wy };
  }

  function microAt(route, progress, reverse = false, stepLength = 0.2) {
    const state = stateAt(route, progress, reverse);
    const atCorner = route.path === 'polyline' && state.t > 0 &&
      Math.abs(state.t * 3 - Math.round(state.t * 3)) < 1e-6;
    const tangent = tangentAt(route.path, reverse && atCorner ? state.t - 1e-7 : state.t);
    const magnitude = Math.hypot(tangent.x, tangent.y) || 1;
    const sign = reverse ? -1 : 1;
    const dx = sign * stepLength * tangent.x / magnitude;
    const dy = sign * stepLength * tangent.y / magnitude;
    const wx = state.P * dx, wy = state.Q * dy;
    return {
      origin: { x: state.x, y: state.y },
      end: { x: state.x + dx, y: state.y + dy },
      P: state.P, Q: state.Q, dx, dy, wx, wy, work: wx + wy,
      angle: Math.acos(clamp((wx + wy) / ((Math.hypot(state.P, state.Q) || 1) * stepLength), -1, 1))
    };
  }

  function workBins(route, reverse = false, count = 72) {
    const bins = [];
    for (let i = 0; i < count; i++) {
      const before = stateAt(route, i / count, reverse).work;
      const after = stateAt(route, (i + 1) / count, reverse).work;
      const work = after - before;
      bins.push(Math.abs(work) < 1e-9 ? 0 : work);
    }
    return bins;
  }

  const api = { pointAt, tangentAt, forceAt, buildTrajectory, buildPartition, atArcFraction, stateAt, microAt, workBins };
  root.LineIntegralModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
