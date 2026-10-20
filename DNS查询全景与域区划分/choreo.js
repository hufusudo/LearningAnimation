// 动效选用：A1、A3、B1、C1、C3、D1、E1（见 docs/motion-library.md）
/* DNS 查询全景 · 视觉编排：所有画面都是（步骤，步内进度）的纯函数 */
(function (root, factory) {
  const data = typeof module === 'object' && module.exports ? require('./data.js') : root.DNSData;
  const api = factory(data);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DNSChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';

  const REDUCED_STEP = 0.9;
  const clamp01 = value => Math.max(0, Math.min(1, value));
  const win = (p, a, b) => clamp01((p - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;

  function duration(sequence, reduced) {
    return reduced ? Math.round(sequence.steps.length * REDUCED_STEP * 1000) / 1000 : sequence.total;
  }

  function boundary(sequence, reduced, stepIndex) {
    if (stepIndex <= 0) return 0;
    if (reduced) return Math.round(Math.min(sequence.steps.length, stepIndex) * REDUCED_STEP * 1000) / 1000;
    let total = 0;
    for (let i = 0; i < stepIndex && i < sequence.steps.length; i++) total += sequence.steps[i].duration;
    return Math.round(total * 1000) / 1000;
  }

  function sample(sequence, time, reduced) {
    const total = duration(sequence, reduced);
    const t = Math.max(0, Math.min(total, Number(time) || 0));
    if (reduced) {
      if (t <= 0) return { index: 0, progress: 0, time: 0, complete: false, reduced: true };
      const index = Math.min(sequence.steps.length - 1, Math.floor(t / REDUCED_STEP));
      return {
        index,
        progress: 1,
        time: t,
        complete: t >= total,
        reduced: true
      };
    }
    if (t >= sequence.total - 1e-9) {
      return { index: sequence.steps.length - 1, progress: 1, time: sequence.total, complete: true, reduced: false };
    }
    let start = 0;
    for (let i = 0; i < sequence.steps.length; i++) {
      const end = start + sequence.steps[i].duration;
      if (t < end || i === sequence.steps.length - 1) {
        return {
          index: i,
          progress: clamp01((t - start) / sequence.steps[i].duration),
          time: t,
          complete: false,
          reduced: false
        };
      }
      start = end;
    }
    return { index: sequence.steps.length - 1, progress: 1, time: sequence.total, complete: true, reduced: false };
  }

  function frame(step, progress) {
    const p = clamp01(progress);
    const flights = step.flights;
    const count = flights.length;
    const start = 0.12;
    const end = 0.88;
    const span = (end - start) / count;
    let raw = (p - start) / span;
    let flightIndex = Math.min(count - 1, Math.max(0, Math.floor(raw)));
    let flightProgress = clamp01(raw - flightIndex);
    if (p <= start) {
      flightIndex = 0;
      flightProgress = 0;
    }
    if (p >= end) {
      flightIndex = count - 1;
      flightProgress = 1;
    }

    const flight = flights[flightIndex];
    const route = D.routeRef(flight.from, flight.to);
    const trailPoints = D.routePoints(flight.from, flight.to, flightProgress, 28);
    const packetPoint = trailPoints[trailPoints.length - 1];
    const packetAlpha = win(p, 0.015, 0.05) * (1 - win(p, 0.955, 0.99));
    const shortHop = (flight.from === 'client' && flight.to === 'local')
      || (flight.from === 'local' && flight.to === 'client');

    const completedRoutes = Object.assign({}, step.before.usedRoutes);
    for (let i = 0; i < flightIndex; i++) {
      const done = flights[i];
      completedRoutes[D.routeKey(done.from, done.to)] = done.kind;
    }
    if (p >= end) {
      for (const done of flights) completedRoutes[D.routeKey(done.from, done.to)] = done.kind;
    }

    const message = (flight.kind === 'referral' || flight.kind === 'answer')
      ? step.messageReply
      : step.messageQuery;

    const probeNodes = D.pathBetween(step.before.match, step.after.match);
    const probeK = probeNodes.length === 1 ? 0 : win(p, 0.36, 0.8);
    const probePoint = D.treePoint(probeNodes, probeK);
    const probeNode = probeK < 0.5 ? step.before.match : step.after.match;

    const newEdges = step.after.trail.filter(id => !step.before.trail.includes(id));
    const litK = win(p, 0.42, 0.82);
    const lit = {};
    for (const id of step.after.trail) {
      if (step.before.trail.includes(id)) {
        lit[id] = 1;
      } else {
        const index = newEdges.indexOf(id);
        lit[id] = clamp01(litK * newEdges.length - index);
      }
    }

    const counterK = win(p, 0.4, 0.58);
    const counterValue = Math.round(lerp(step.before.outbound, step.after.outbound, counterK));
    const counterRoll = step.before.outbound === step.after.outbound ? 0 : counterK;

    const pulseK = win(p, 0.08, 0.3);
    const pulseAlpha = p >= 0.08 && p <= 0.3 ? 0.5 * (1 - pulseK) : 0;
    const firstFlight = flights[0];
    const pulsePoint = D.routePoint(firstFlight.from, firstFlight.to, 0);

    const focus = flight.to;
    const tagAlpha = win(p, 0.56, 0.7) * (1 - win(p, 0.9, 1));
    const bridgeMatch = p < 0.55 ? step.before.match : step.after.match;
    const bridgeVisible = step.key !== 'client' && !['t', 'u'].includes(bridgeMatch);
    const bridgeAlpha = bridgeVisible ? win(p, 0.55, 0.68) * (1 - win(p, 0.86, 0.96)) : 0;
    const resultAlpha = step.after.resolved ? win(p, 0.8, 0.94) : 0;
    const resolvedMix = step.after.resolved ? win(p, 0.74, 0.9) : 0;
    const match = p < 0.55 ? step.before.match : step.after.match;
    const queried = (p < 0.55 ? step.before.queried : step.after.queried).slice();
    const answeredBy = p < 0.55 ? step.before.answeredBy : step.after.answeredBy;

    return {
      p,
      flightIndex,
      flight,
      flightProgress,
      routeKey: route.key,
      packet: {
        point: packetPoint,
        label: flight.label,
        kind: flight.kind,
        alpha: packetAlpha,
        at: flight.to,
        shortHop
      },
      trailPoints,
      trailAlpha: packetAlpha,
      trailKind: flight.kind,
      completedRoutes,
      message,
      probe: {
        point: probePoint,
        node: probeNode,
        k: probeK,
        alpha: 1
      },
      lit,
      resolvedMix,
      counter: {
        value: counterValue,
        old: step.before.outbound,
        new: step.after.outbound,
        roll: counterRoll
      },
      pulse: {
        point: pulsePoint,
        alpha: pulseAlpha,
        from: firstFlight.from,
        k: pulseK,
        kind: firstFlight.kind
      },
      focus,
      tag: {
        text: step.tag,
        alpha: step.tag ? tagAlpha : 0,
        at: step.tagAt || null
      },
      bridge: {
        match: bridgeMatch,
        alpha: bridgeAlpha,
        text: D.BRIDGE_LABELS[bridgeMatch] || ''
      },
      result: {
        alpha: resultAlpha,
        text: step.target.ip,
        node: step.target.node
      },
      match,
      queried,
      answeredBy,
      targetNode: step.target.node
    };
  }

  return {
    REDUCED_STEP,
    clamp01,
    win,
    lerp,
    duration,
    boundary,
    sample,
    frame
  };
});
