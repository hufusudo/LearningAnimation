/**
 * 动效选用：A1、C1、C2、C3、D1、E1
 * A1 引导边界最小口；E1 修路；C2 领土吞并；C3 状态淡变；C1 / D1 后置回执。
 * Deterministic choreography: GSAP advances time; this file owns every visual state.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimChoreo = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clamp = x => Math.max(0, Math.min(1, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const lerp = (a, b, p) => a + (b - a) * p;
  function textView(a, b, p) {
    if (a === b) return { text: b, alpha: 1 };
    if (p < 0.18) return { text: a, alpha: 1 - p / 0.18 };
    return { text: b, alpha: win(p, 0.18, 0.38) };
  }
  function snapshot(run, state) {
    return {
      nodes: run.graph.nodes.map(n => ({ id: n.id, owned: Number(state.owned.includes(n.id)),
        pending: Number(!state.owned.includes(n.id) && run.graph.edges.some(e => state.tree.includes(e.id) && (e.u === n.id || e.v === n.id))) })),
      edges: run.graph.edges.map(e => ({ id: e.id, tree: Number(state.tree.includes(e.id)), frontier: Number(state.frontier.includes(e.id)), selected: Number(state.selected === e.id),
        land: Number(state.tree.includes(e.id) && state.owned.includes(e.u) && state.owned.includes(e.v)), landFrom: e.u })),
      rows: run.graph.edges.map(e => ({ id: e.id, y: Math.max(0, state.frontier.indexOf(e.id)), alpha: Number(state.frontier.includes(e.id)), selected: Number(state.selected === e.id),
        from: state.owned.includes(e.u) ? e.u : e.v, to: state.owned.includes(e.u) ? e.v : e.u })),
      stats: { cost: state.cost, owned: state.owned.length, edges: state.tree.length, round: state.round, cut: state.frontier.length },
      phase: { text: state.phase, alpha: 1 }, message: { text: state.message, alpha: 1 },
      focus: { node: null, edge: null, alpha: 0 },
      road: { edge: null, from: null, to: null, progress: 0, alpha: 0 },
      tag: { text: '', node: null, edge: null, alpha: 0, dy: 0 },
      done: Number(state.phase === 'done'), blocked: Number(state.phase === 'blocked')
    };
  }
  function sampleStep(run, event, progress) {
    const p = clamp(progress);
    const a = snapshot(run, event.before), b = snapshot(run, event.after);
    if (p <= 1e-9) return a;
    if (p >= 1 - 1e-9) return b;
    const isAnnex = event.kind === 'annex';
    const main = win(p, 0.22, 0.64);
    const membership = isAnnex ? win(p, 0.48, 0.76) : main;
    const receipt = isAnnex ? win(p, 0.78, 0.98) : win(p, 0.68, 0.94);
    const cut = isAnnex ? win(p, 0.76, 0.98) : main;
    const view = {
      nodes: a.nodes.map((n, i) => ({ id: n.id, owned: lerp(n.owned, b.nodes[i].owned, membership),
        pending: lerp(n.pending, b.nodes[i].pending, event.kind === 'connect' ? receipt : membership) })),
      edges: a.edges.map((e, i) => ({ id: e.id,
        tree: event.kind === 'connect' && e.id === event.edge.id ? (main >= 1 ? 1 : 0) : lerp(e.tree, b.edges[i].tree, main),
        frontier: lerp(e.frontier, b.edges[i].frontier, cut),
        selected: lerp(e.selected, b.edges[i].selected, isAnnex ? cut : main),
        land: lerp(e.land, b.edges[i].land, main),
        landFrom: isAnnex && e.id === event.edge.id && main > 0 && main < 1 ? event.from : e.landFrom
      })),
      rows: a.rows.map((row, i) => {
        const next = b.rows[i];
        // Absent rows materialize at their destination rather than flying through other rows.
        const y0 = row.alpha ? row.y : next.y;
        const y1 = next.alpha ? next.y : row.y;
        return { id: row.id, y: lerp(y0, y1, cut), alpha: lerp(row.alpha, next.alpha, cut), selected: lerp(row.selected, next.selected, isAnnex ? cut : main),
          from: row.alpha ? row.from : next.from, to: row.alpha ? row.to : next.to };
      }),
      stats: Object.fromEntries(Object.keys(a.stats).map(key => [key, lerp(a.stats[key], b.stats[key], receipt)])),
      phase: textView(a.phase.text, b.phase.text, p),
      message: isAnnex ? (p < 0.76
        ? textView(a.message.text, `边界沿道路推进，正在吞并 ${event.to}。`, p)
        : textView(`边界沿道路推进，正在吞并 ${event.to}。`, b.message.text, win(p, 0.76, 1)))
        : textView(a.message.text, b.message.text, p),
      focus: { node: isAnnex ? event.to : null, edge: isAnnex ? null : event.edge.id, alpha: Math.min(win(p, 0, 0.18), 1 - win(p, 0.65, 1)) },
      road: { edge: null, from: null, to: null, progress: 0, alpha: 0 },
      tag: { text: '', node: null, edge: null, alpha: 0, dy: 0 },
      done: lerp(a.done, b.done, receipt), blocked: lerp(a.blocked, b.blocked, receipt)
    };
    if (event.kind === 'connect' && main < 1 && main > 0) {
      view.road = { edge: event.edge.id, from: event.from, to: event.to, progress: main, alpha: 1 };
    }
    const alpha = Math.min(win(p, isAnnex ? 0.79 : 0.68, isAnnex ? 0.90 : 0.81), 1 - win(p, 0.94, 1));
    if (alpha > 0) view.tag = {
      text: { choose: '割上最小', connect: '纳入树边', annex: `吞并 ${event.to}` }[event.kind],
      node: isAnnex ? event.to : null, edge: isAnnex ? null : event.edge.id,
      alpha, dy: 5 * (1 - win(p, 0.68, 0.88))
    };
    return view;
  }
  function sample(run, time, reduced = false) {
    const t = Math.max(0, Math.min(run.duration, Number(time) || 0));
    if (!run.events.length || t === 0) return snapshot(run, run.initial);
    if (t >= run.duration) return snapshot(run, run.final);
    const event = run.events.find(e => t <= e.end + 1e-9);
    const p = Math.abs(t - event.end) < 1e-9 ? 1 : (t - event.start) / event.duration;
    // Reduced-motion browsing uses the preceding completed event, never an in-flight state.
    return sampleStep(run, event, reduced && p < 1 ? 0 : p);
  }
  return { sample, sampleStep, snapshot, win };
});
