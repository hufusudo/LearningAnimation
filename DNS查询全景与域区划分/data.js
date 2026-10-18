/* DNS 查询全景 · 静态几何与命名空间数据（纯数据，无 DOM） */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DNSData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TREE_NODES = {
    root: { x: 300, y: 90, r: 24, name: '.', role: '根域', size: 20, muted: false },
    org: { x: 100, y: 180, r: 17, name: 'org', role: '顶级域', size: 10, muted: true },
    com: { x: 300, y: 180, r: 20, name: 'com', role: '顶级域', size: 11, muted: false },
    edu: { x: 500, y: 180, r: 17, name: 'edu', role: '顶级域', size: 10, muted: true },
    abc: { x: 210, y: 275, r: 21, name: 'abc', role: '二级域', size: 11, muted: false },
    xyz: { x: 410, y: 275, r: 16, name: 'xyz', role: '二级域', size: 9, muted: true },
    x: { x: 140, y: 370, r: 17, name: 'x', role: '三级域', size: 11, muted: false },
    y: { x: 300, y: 370, r: 19, name: 'y', role: '三级域', size: 11, muted: false },
    u: { x: 90, y: 480, r: 15, name: 'u', role: '主机', size: 11, muted: false },
    v: { x: 140, y: 480, r: 13, name: 'v', role: '主机', size: 9, muted: true },
    w: { x: 190, y: 480, r: 13, name: 'w', role: '主机', size: 9, muted: true },
    t: { x: 300, y: 480, r: 19, name: 't', role: '主机', size: 11, muted: false }
  };

  const TREE_EDGES = [
    { id: 'root-org', from: 'root', to: 'org', c1: [300, 130], c2: [150, 148] },
    { id: 'root-com', from: 'root', to: 'com', c1: [300, 130], c2: [300, 150] },
    { id: 'root-edu', from: 'root', to: 'edu', c1: [300, 130], c2: [450, 148] },
    { id: 'com-abc', from: 'com', to: 'abc', c1: [300, 222], c2: [240, 242] },
    { id: 'com-xyz', from: 'com', to: 'xyz', c1: [300, 222], c2: [382, 242] },
    { id: 'abc-x', from: 'abc', to: 'x', c1: [210, 316], c2: [160, 336] },
    { id: 'abc-y', from: 'abc', to: 'y', c1: [210, 316], c2: [280, 336] },
    { id: 'x-u', from: 'x', to: 'u', c1: [140, 416], c2: [105, 446] },
    { id: 'x-v', from: 'x', to: 'v', c1: [140, 416], c2: [140, 446] },
    { id: 'x-w', from: 'x', to: 'w', c1: [140, 416], c2: [175, 446] },
    { id: 'y-t', from: 'y', to: 't', c1: [300, 416], c2: [300, 446] }
  ];

  const TREE_PARENT = {
    root: null,
    org: 'root', com: 'root', edu: 'root',
    abc: 'com', xyz: 'com',
    x: 'abc', y: 'abc',
    u: 'x', v: 'x', w: 'x', t: 'y'
  };

  const EDGE_BY_ID = Object.fromEntries(TREE_EDGES.map(edge => [edge.id, edge]));

  const SERVERS = {
    root: { x: 810, y: 90, w: 176, h: 64, level: 'ROOT', name: '根域名服务器', domain: '.', accent: 'ink', kind: 'server' },
    tld: { x: 960, y: 180, w: 176, h: 64, level: 'TLD', name: '顶级域服务器', domain: 'dns.com', accent: 'blue', kind: 'server' },
    auth: { x: 1035, y: 275, w: 176, h: 64, level: 'AUTH', name: '权限服务器', domain: 'dns.abc.com', accent: 'ochre', kind: 'server' },
    authy: { x: 1040, y: 370, w: 176, h: 64, level: 'SUB', name: '子区权限服务器', domain: 'dns.y.abc.com', accent: 'pine', kind: 'server' },
    local: { x: 750, y: 475, w: 210, h: 88, level: 'RESOLVER', name: '本地域名服务器', domain: 'dns.xyz.com', accent: 'blue', kind: 'resolver' },
    client: { x: 750, y: 565, w: 150, h: 44, level: 'HOST', name: '客户端', domain: 'm.xyz.com', accent: 'neutral', kind: 'host' }
  };

  const ROUTES = {
    'client-local': { p0: [750, 543], c1: [750, 535], c2: [750, 527], p1: [750, 519], area: 'both' },
    'local-root': { p0: [720, 431], c1: [660, 300], c2: [700, 180], p1: [850, 122], area: 'both' },
    'local-tld': { p0: [770, 431], c1: [800, 340], c2: [860, 250], p1: [1000, 212], area: 'iterative' },
    'local-auth': { p0: [820, 431], c1: [880, 390], c2: [960, 340], p1: [1000, 307], area: 'iterative' },
    'local-authy': { p0: [855, 468], c1: [890, 455], c2: [920, 420], p1: [952, 390], area: 'iterative-y' },
    'root-tld': { p0: [898, 90], c1: [960, 90], c2: [1000, 125], p1: [1048, 180], area: 'recursive' },
    'tld-auth': { p0: [1048, 180], c1: [1090, 200], c2: [1130, 240], p1: [1123, 275], area: 'recursive' },
    'auth-authy': { p0: [1123, 275], c1: [1140, 320], c2: [1140, 345], p1: [1128, 370], area: 'recursive-y' },
    'local-client': { p0: [750, 519], c1: [750, 527], c2: [750, 535], p1: [750, 543], area: 'both' }
  };

  const TARGETS = {
    t: { node: 't', host: 't.y.abc.com', ip: '192.0.2.88', zoneNode: 'y', zoneColor: 'pine' },
    u: { node: 'u', host: 'u.x.abc.com', ip: '192.0.2.66', zoneNode: 'x', zoneColor: 'ochre' }
  };

  const MATCH_LABELS = {
    root: '根域 .',
    com: 'com',
    abc: 'abc.com',
    y: 'y.abc.com',
    t: 't.y.abc.com',
    u: 'u.x.abc.com'
  };

  const BRIDGE_LABELS = {
    root: '根域 ↔ 根',
    com: 'com ↔ TLD',
    abc: 'abc.com ↔ 权限',
    y: 'y.abc.com ↔ 子区',
    t: 't ↔ 地址',
    u: 'u ↔ 地址'
  };

  const ZONE_GEOMETRY = {
    mainSingle: { x: 60, y: 205, w: 300, h: 335 },
    mainTwo: { x: 60, y: 205, w: 190, h: 335 },
    y: { x: 258, y: 300, w: 115, h: 240 },
    labels: {
      singleTitle: '区 · abc.com',
      singleSub: 'y 未委派 · 同属一区',
      twoTitle: '区 1 · abc.com',
      twoSub: 'x、u 仍在本区',
      yTitle: '区 2 · y.abc.com',
      ySub: '委派给 dns.y.abc.com'
    }
  };

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function lerp(a, b, k) {
    return a + (b - a) * k;
  }

  function cubicPoint(route, t) {
    const k = clamp01(t);
    const u = 1 - k;
    const x = u * u * u * route.p0[0] + 3 * u * u * k * route.c1[0] + 3 * u * k * k * route.c2[0] + k * k * k * route.p1[0];
    const y = u * u * u * route.p0[1] + 3 * u * u * k * route.c1[1] + 3 * u * k * k * route.c2[1] + k * k * k * route.p1[1];
    return [x, y];
  }

  function reverseRoute(route) {
    return { p0: route.p1.slice(), c1: route.c2.slice(), c2: route.c1.slice(), p1: route.p0.slice(), area: route.area };
  }

  function routeKey(from, to) {
    if (ROUTES[`${from}-${to}`]) return `${from}-${to}`;
    if (ROUTES[`${to}-${from}`]) return `${to}-${from}`;
    throw new RangeError(`未定义链路: ${from} → ${to}`);
  }

  function routeRef(from, to) {
    const forward = `${from}-${to}`;
    if (ROUTES[forward]) return { key: forward, route: ROUTES[forward], reversed: false };
    const backward = `${to}-${from}`;
    if (ROUTES[backward]) return { key: backward, route: reverseRoute(ROUTES[backward]), reversed: true };
    throw new RangeError(`未定义链路: ${from} → ${to}`);
  }

  function routeD(key) {
    const route = ROUTES[key];
    if (!route) return '';
    const [x0, y0] = route.p0;
    const [x1, y1] = route.c1;
    const [x2, y2] = route.c2;
    const [x3, y3] = route.p1;
    return `M ${x0} ${y0} C ${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3}`;
  }

  function routePoint(from, to, k) {
    const ref = routeRef(from, to);
    return cubicPoint(ref.route, k);
  }

  function routePoints(from, to, k, steps) {
    const ref = routeRef(from, to);
    const count = Math.max(2, steps || 24);
    const end = clamp01(k);
    const points = [];
    for (let i = 0; i <= count; i++) {
      points.push(cubicPoint(ref.route, end * (i / count)));
    }
    return points;
  }

  function edgeD(edge) {
    const start = TREE_NODES[edge.from];
    const end = TREE_NODES[edge.to];
    return `M ${start.x} ${start.y} C ${edge.c1[0]} ${edge.c1[1]}, ${edge.c2[0]} ${edge.c2[1]}, ${end.x} ${end.y}`;
  }

  function edgePoints(edge, steps) {
    const count = steps || 18;
    const start = TREE_NODES[edge.from];
    const end = TREE_NODES[edge.to];
    const route = { p0: [start.x, start.y], c1: edge.c1, c2: edge.c2, p1: [end.x, end.y] };
    const points = [];
    for (let i = 0; i <= count; i++) points.push(cubicPoint(route, i / count));
    return points;
  }

  function samplePolyline(points, k) {
    if (points.length === 1) return points[0].slice();
    const amount = Math.max(0, Math.min(1, k));
    const lengths = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      lengths.push(length);
      total += length;
    }
    let remaining = total * amount;
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] || i === lengths.length - 1) {
        const q = lengths[i] ? remaining / lengths[i] : 0;
        return [
          lerp(points[i][0], points[i + 1][0], q),
          lerp(points[i][1], points[i + 1][1], q)
        ];
      }
      remaining -= lengths[i];
    }
    return points[points.length - 1].slice();
  }

  function pathBetween(from, to) {
    if (from === to) return [from];
    const up = [];
    let cursor = to;
    while (cursor && cursor !== from) {
      up.push(cursor);
      cursor = TREE_PARENT[cursor];
    }
    if (cursor !== from) {
      const reverse = [];
      cursor = from;
      while (cursor && cursor !== to) {
        reverse.push(cursor);
        cursor = TREE_PARENT[cursor];
      }
      return reverse.reverse();
    }
    return [from, ...up.reverse()];
  }

  function trailFor(node) {
    const nodes = [];
    let cursor = node;
    while (cursor) {
      nodes.push(cursor);
      cursor = TREE_PARENT[cursor];
    }
    nodes.reverse();
    const trail = [];
    for (let i = 1; i < nodes.length; i++) {
      const id = `${nodes[i - 1]}-${nodes[i]}`;
      if (EDGE_BY_ID[id]) trail.push(id);
    }
    return trail;
  }

  const TRAIL_BY_MATCH = Object.fromEntries(Object.keys(TREE_NODES).map(node => [node, trailFor(node)]));

  function treePoint(nodes, k) {
    if (!nodes || nodes.length === 0) return [TREE_NODES.root.x, TREE_NODES.root.y];
    if (nodes.length === 1) return [TREE_NODES[nodes[0]].x, TREE_NODES[nodes[0]].y];
    const points = [];
    for (let i = 1; i < nodes.length; i++) {
      const edge = EDGE_BY_ID[`${nodes[i - 1]}-${nodes[i]}`];
      if (!edge) continue;
      const segment = edgePoints(edge, 16);
      if (points.length) segment.shift();
      points.push(...segment);
    }
    return points.length ? samplePolyline(points, k) : [TREE_NODES[nodes[nodes.length - 1]].x, TREE_NODES[nodes[nodes.length - 1]].y];
  }

  return {
    TREE_NODES,
    TREE_EDGES,
    EDGE_BY_ID,
    TREE_PARENT,
    SERVERS,
    ROUTES,
    TARGETS,
    MATCH_LABELS,
    BRIDGE_LABELS,
    ZONE_GEOMETRY,
    clamp01,
    lerp,
    cubicPoint,
    reverseRoute,
    routeKey,
    routeRef,
    routeD,
    routePoint,
    routePoints,
    edgeD,
    edgePoints,
    samplePolyline,
    pathBetween,
    trailFor,
    TRAIL_BY_MATCH,
    treePoint
  };
});
