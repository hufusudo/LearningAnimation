/* 有向小格边界模型。几何边配对与线积分分别计算，不从格林公式反推结果。 */
(function (root) {
  'use strict';
  const FIELD = { P: (x, y) => -y / 2, Q: x => x / 2, curl: () => 1 };
  function integral(a, b, field = FIELD) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return [0.5 - 0.5 / Math.sqrt(3), 0.5 + 0.5 / Math.sqrt(3)].reduce((sum, t) => {
      const x = a.x + t * dx, y = a.y + t * dy;
      return sum + (field.P(x, y) * dx + field.Q(x, y) * dy) / 2;
    }, 0);
  }
  function makeTiling(n = 3) {
    if (![3, 6, 9].includes(n)) throw new RangeError('网格列数须为 3、6 或 9');
    const m = 2 * n / 3, h = 3 / n, cells = [], groups = new Map();
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const id = j * n + i;
      const points = [{ x: i, y: j }, { x: i + 1, y: j }, { x: i + 1, y: j + 1 }, { x: i, y: j + 1 }];
      const cell = { id, i, j, x: i * h, y: j * h, h, area: h * h, edges: [] };
      for (let k = 0; k < 4; k++) {
        const u = points[k], v = points[(k + 1) % 4];
        const key = [`${u.x},${u.y}`, `${v.x},${v.y}`].sort().join('|');
        const a = { x: u.x * h, y: u.y * h }, b = { x: v.x * h, y: v.y * h };
        const edge = { key, owner: id, a, b, value: integral(a, b) };
        cell.edges.push(edge);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(edge);
      }
      cell.circulation = cell.edges.reduce((s, e) => s + e.value, 0);
      cells.push(cell);
    }
    const internal = [], boundary = [];
    groups.forEach((edges, key) => {
      if (edges.length === 2) internal.push({ key, edges });
      else boundary.push(edges[0]);
    });
    // 第一条必须是 A 与右侧 B 的公共边，其余依邻格生成顺序逐条配对。
    const first = internal.findIndex(g => g.edges.some(e => e.owner === 0) && g.edges.some(e => e.owner === 1));
    internal.unshift(...internal.splice(first, 1));
    internal.forEach((g, index) => { g.index = index; });
    return { n, m, h, cells, internal, boundary, total: cells.reduce((s, c) => s + c.circulation, 0),
      outer: boundary.reduce((s, e) => s + e.value, 0), area: 6 };
  }
  root.GreenModel = { FIELD, integral, makeTiling };
})(typeof globalThis !== 'undefined' ? globalThis : window);
