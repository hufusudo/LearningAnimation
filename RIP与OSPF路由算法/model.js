(function (root) {
  'use strict';
  function receiveRip(current, from, advertised) {
    const metric = Math.min(16, advertised + 1);
    if (current.via === from || metric < current.metric) {
      return { metric, via: metric < 16 ? from : null };
    }
    return { ...current };
  }
  function advertise(route, to, poison) {
    return poison && route.via === to ? 16 : route.metric;
  }
  function dijkstra(nodes, links, source) {
    const dist = Object.fromEntries(nodes.map(n => [n, Infinity]));
    const prev = {}, settled = [], steps = [];
    dist[source] = 0;
    while (settled.length < nodes.length) {
      const node = nodes.filter(n => !settled.includes(n)).sort((a,b) => dist[a] - dist[b])[0];
      if (!Number.isFinite(dist[node])) break;
      settled.push(node);
      const relaxed = [];
      for (const [a,b,cost] of links) {
        const other = a === node ? b : b === node ? a : null;
        if (!other || settled.includes(other)) continue;
        const candidate = dist[node] + cost;
        const old = dist[other];
        if (candidate < old) { dist[other] = candidate; prev[other] = node; }
        relaxed.push({ from: node, to: other, cost, candidate, old, improved: candidate < old });
      }
      steps.push({ node, dist: { ...dist }, prev: { ...prev }, settled: [...settled], relaxed });
    }
    return { dist, prev, steps };
  }
  function pathTo(prev, source, destination) {
    const path = [destination];
    while (path[0] !== source) {
      const next = prev[path[0]];
      if (!next || path.includes(next)) return [];
      path.unshift(next);
    }
    return path;
  }
  const api = { receiveRip, advertise, dijkstra, pathTo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoutingModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
