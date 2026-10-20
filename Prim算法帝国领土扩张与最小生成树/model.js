(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PRESETS = {
    classic: {
      label: '经典 6 国图',
      nodes: [
        { id: 'A', x: 0.50, y: 0.13 }, { id: 'B', x: 0.16, y: 0.40 },
        { id: 'C', x: 0.84, y: 0.37 }, { id: 'D', x: 0.30, y: 0.86 },
        { id: 'E', x: 0.71, y: 0.84 }, { id: 'F', x: 0.50, y: 0.55 }
      ],
      edges: [
        ['A', 'B', 4], ['A', 'C', 2], ['A', 'F', 1], ['B', 'F', 2],
        ['C', 'F', 3], ['B', 'D', 3], ['D', 'F', 5], ['D', 'E', 6],
        ['C', 'E', 2], ['E', 'F', 4], ['A', 'D', 7]
      ]
    },
    dense: {
      label: '稠密图 (7 国)',
      nodes: [
        { id: 'A', x: 0.50, y: 0.10 }, { id: 'B', x: 0.14, y: 0.30 },
        { id: 'C', x: 0.86, y: 0.28 }, { id: 'D', x: 0.50, y: 0.47 },
        { id: 'E', x: 0.13, y: 0.74 }, { id: 'F', x: 0.87, y: 0.72 },
        { id: 'G', x: 0.50, y: 0.90 }
      ],
      edges: [
        ['A', 'B', 3], ['A', 'C', 4], ['A', 'D', 2], ['B', 'D', 3],
        ['C', 'D', 1], ['B', 'E', 4], ['D', 'E', 5], ['D', 'F', 2],
        ['C', 'F', 5], ['D', 'G', 6], ['E', 'G', 3], ['F', 'G', 4],
        ['A', 'E', 8], ['A', 'F', 7]
      ]
    },
    chain: {
      label: '稀疏长链图',
      nodes: [
        { id: 'A', x: 0.09, y: 0.30 }, { id: 'B', x: 0.28, y: 0.44 },
        { id: 'C', x: 0.47, y: 0.26 }, { id: 'D', x: 0.66, y: 0.40 },
        { id: 'E', x: 0.87, y: 0.26 }, { id: 'F', x: 0.85, y: 0.62 },
        { id: 'G', x: 0.60, y: 0.82 }
      ],
      edges: [
        ['A', 'B', 2], ['B', 'C', 3], ['C', 'D', 2], ['D', 'E', 3],
        ['E', 'F', 2], ['F', 'G', 4], ['A', 'C', 9], ['B', 'D', 7],
        ['C', 'E', 6], ['D', 'F', 5], ['E', 'G', 8], ['A', 'D', 10]
      ]
    }
  };

  const DURATIONS = { choose: 1.2, connect: 1.6, annex: 1.4 };
  const compareEdges = (a, b) => a.w - b.w || a.index - b.index;
  const clone = (state) => ({
    owned: state.owned.slice(), tree: state.tree.slice(), frontier: state.frontier.slice(),
    selected: state.selected, cost: state.cost, phase: state.phase,
    round: state.round, message: state.message
  });
  function immutable(state) {
    Object.freeze(state.owned);
    Object.freeze(state.tree);
    Object.freeze(state.frontier);
    return Object.freeze(state);
  }

  function makeGraph(preset) {
    const source = typeof preset === 'string' ? PRESETS[preset] : preset;
    if (!source || !Array.isArray(source.nodes) || !Array.isArray(source.edges)) {
      throw new RangeError('未知预设或无效图数据');
    }
    return {
      nodes: source.nodes.map(({ id, x, y }) => ({ id, x, y })),
      edges: source.edges.map((edge, index) => ({
        id: edge[0] + '-' + edge[1], u: edge[0], v: edge[1], w: edge[2], index
      }))
    };
  }

  function buildRun(graph, capital) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      throw new TypeError('graph 必须包含 nodes 和 edges 数组');
    }
    const nodeIds = graph.nodes.map((node) => node && node.id);
    if (nodeIds.some((id) => typeof id !== 'string') || new Set(nodeIds).size !== nodeIds.length) {
      throw new TypeError('节点 id 必须是唯一字符串');
    }
    if (!nodeIds.includes(capital)) throw new RangeError('首都必须是图中的节点');
    const known = new Set(nodeIds);
    const edges = graph.edges.map((edge) => {
      if (!edge || typeof edge.id !== 'string' || !known.has(edge.u) || !known.has(edge.v) ||
          !Number.isFinite(edge.w) || !Number.isInteger(edge.index)) {
        throw new TypeError('边数据无效');
      }
      return edge;
    });
    const graphCopy = { nodes: graph.nodes.map((n) => ({ ...n })), edges: edges.slice() };
    const sorted = edges.slice().sort(compareEdges);
    const initialFrontier = sorted.filter((edge) => (edge.u === capital) !== (edge.v === capital)).map((edge) => edge.id);
    const initiallyDone = nodeIds.length === 1;
    const initiallyBlocked = !initiallyDone && initialFrontier.length === 0;
    const initial = {
      owned: [capital], tree: [], frontier: initialFrontier,
      selected: null, cost: 0,
      phase: initiallyDone ? 'done' : initiallyBlocked ? 'blocked' : 'ready', round: 0,
      message: initiallyDone ? '唯一节点已入树，生成树完成。' :
        initiallyBlocked ? '无跨界道路，无法覆盖全图。' : '首都确立，从领土周围寻找最便宜的跨界道路。'
    };
    const events = [];
    const rounds = [];
    let state = clone(initial);
    let time = 0;
    const nodeCount = nodeIds.length;

    function addEvent(kind, round, edge, from, to, next, start) {
      const duration = DURATIONS[kind];
      const before = immutable(clone(state));
      state = clone(next);
      const after = immutable(clone(state));
      const end = Math.round((start + duration) * 1e9) / 1e9;
      events.push({ kind, start, end, duration, round, edge, from, to, before, after });
      time = end;
    }

    if (nodeCount > 1 && state.phase !== 'blocked') {
      while (state.owned.length < nodeCount) {
        const owned = new Set(state.owned);
        const frontier = sorted.filter((edge) => (owned.has(edge.u) !== owned.has(edge.v)) && !state.tree.includes(edge.id));
        state.frontier = frontier.map((edge) => edge.id);
        if (!frontier.length) {
          state.phase = 'blocked';
          state.selected = null;
          state.message = '无跨界道路，无法覆盖全图。';
          break;
        }
        const edge = frontier[0];
        const from = owned.has(edge.u) ? edge.u : edge.v;
        const to = owned.has(edge.u) ? edge.v : edge.u;
        const round = state.round + 1;
        const start = time;

        addEvent('choose', round, edge, from, to, {
          ...clone(state), phase: 'choose', selected: edge.id, round,
          message: `从整个领土边界选取 ${from}→${to}，成本 ${edge.w} 最小。`
        }, time);
        addEvent('connect', round, edge, from, to, {
          ...clone(state), phase: 'connect', tree: state.tree.concat(edge.id),
          cost: state.cost + edge.w, selected: edge.id,
          message: '修通最小跨界道路，累计成本更新。'
        }, time);
        const nextOwned = state.owned.concat(to);
        const nextFrontier = sorted.filter((candidate) => {
          const inTree = new Set(nextOwned);
          return inTree.has(candidate.u) !== inTree.has(candidate.v);
        }).map((candidate) => candidate.id);
        const done = nextOwned.length === nodeCount;
        const blocked = !done && nextFrontier.length === 0;
        addEvent('annex', round, edge, from, to, {
          ...clone(state), owned: nextOwned, frontier: nextFrontier,
          selected: null, phase: done ? 'done' : blocked ? 'blocked' : 'annex', round,
          message: done ? '全部领土已吞并，最小生成树构建完成。' :
            blocked ? '无跨界道路，无法覆盖全图。' : `吞并 ${to}，接下来从整片领土的边界重新比价。`
        }, time);
        rounds.push({ round, edge, from, to, start, end: time });
        if (blocked) break;
      }
    }

    const final = immutable(clone(state));
    const boundaries = [0, ...events.map((event) => event.end)];
    return { graph: graphCopy, capital, initial: immutable(clone(initial)), events, duration: time, boundaries, rounds, final };
  }

  return { PRESETS, makeGraph, buildRun };
});
