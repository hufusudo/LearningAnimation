'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PrimModel = require('./model.js');
const { PRESETS, makeGraph, buildRun } = PrimModel;

function kruskal(graph) {
  const parent = new Map(graph.nodes.map((node) => [node.id, node.id]));
  function find(id) {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  }
  let weight = 0;
  let count = 0;
  for (const edge of graph.edges.slice().sort((a, b) => a.w - b.w || a.index - b.index)) {
    const a = find(edge.u), b = find(edge.v);
    if (a !== b) {
      parent.set(a, b);
      weight += edge.w;
      count++;
    }
  }
  return { weight, connected: graph.nodes.length <= 1 || count === graph.nodes.length - 1 };
}

function verifyRun(run) {
  const { graph, events, final } = run;
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  assert.equal(events.length, Math.max(0, (graph.nodes.length - 1)) * 3);
  for (let i = 0; i < events.length; i += 3) {
    const [choose, connect, annex] = events.slice(i, i + 3);
    assert.deepEqual([choose.kind, connect.kind, annex.kind], ['choose', 'connect', 'annex']);
    assert.deepEqual([choose.duration, connect.duration, annex.duration], [1.2, 1.6, 1.4]);
    assert.equal(choose.round, i / 3 + 1);
    assert.equal(connect.edge, choose.edge);
    assert.equal(annex.edge, choose.edge);
    assert.equal(choose.start, run.boundaries[i]);
    assert.equal(annex.end, run.boundaries[i + 3]);
    const beforeOwned = new Set(choose.before.owned);
    const crossing = graph.edges.filter((edge) => beforeOwned.has(edge.u) !== beforeOwned.has(edge.v));
    const expected = crossing.slice().sort((a, b) => a.w - b.w || a.index - b.index)[0];
    assert.equal(choose.edge.id, expected.id, '选择割上最小边');
    assert.ok(choose.before.frontier.includes(choose.edge.id));
    assert.ok(choose.edge.w === expected.w);
    assert.equal(choose.after.selected, choose.edge.id);
    assert.ok(!choose.after.owned.includes(choose.to));
    assert.ok(connect.after.tree.includes(connect.edge.id));
    assert.ok(!connect.after.owned.includes(connect.to), '修路后目标节点仍未并入');
    assert.equal(connect.after.cost, connect.before.cost + connect.edge.w);
    assert.ok(annex.after.owned.includes(annex.to));
    assert.equal(annex.after.selected, null);
    assert.ok(choose.after.message.length <= 40 && connect.after.message.length <= 40 && annex.after.message.length <= 40);
    assert.ok(Object.isFrozen(choose.before) && Object.isFrozen(choose.before.owned));
    assert.throws(() => choose.before.owned.push('X'), TypeError);
    // 每个事件快照须为历史状态，不受后续状态变化影响。
    assert.equal(choose.before.tree.length, i / 3);
    assert.equal(choose.before.round, i / 3);
    assert.equal(edges.get(choose.edge.id), choose.edge);
  }
  assert.equal(run.duration, events.length ? events.at(-1).end : 0);
  assert.deepEqual(run.boundaries, [0, ...events.map((event) => event.end)]);
  assert.equal(final.owned.length, graph.nodes.length);
  assert.equal(final.tree.length, graph.nodes.length - 1);
  assert.equal(final.phase, 'done');
  assert.equal(final.cost, kruskal(graph).weight);

  // 验证最终树连通且无环。
  const parent = new Map(graph.nodes.map((node) => [node.id, node.id]));
  function find(id) { while (parent.get(id) !== id) id = parent.get(id); return id; }
  for (const id of final.tree) {
    const edge = edges.get(id);
    const a = find(edge.u), b = find(edge.v);
    assert.notEqual(a, b, '树无环');
    parent.set(a, b);
  }
  assert.equal(new Set(graph.nodes.map((node) => find(node.id))).size, 1);
}

test('保留三组预设原始节点坐标和边顺序', () => {
  assert.deepEqual(Object.keys(PRESETS), ['classic', 'dense', 'chain']);
  for (const [key, preset] of Object.entries(PRESETS)) {
    const graph = makeGraph(key);
    assert.deepEqual(graph.nodes, preset.nodes);
    assert.deepEqual(graph.edges.map(({ u, v, w }) => [u, v, w]), preset.edges);
    assert.deepEqual(graph.edges.map((edge) => edge.index), preset.edges.map((_, i) => i));
    assert.ok(graph.edges.every((edge) => edge.id === `${edge.u}-${edge.v}`));
  }
});

test('所有预设以每个节点为首都时均生成最优生成树', () => {
  for (const key of Object.keys(PRESETS)) {
    const graph = makeGraph(key);
    for (const node of graph.nodes) verifyRun(buildRun(graph, node.id));
  }
});

test('下一次选边来自整片领土，而不局限于刚吞并的节点', () => {
  const run = buildRun(makeGraph('classic'), 'A');
  assert.equal(run.rounds[0].to, 'F');
  assert.equal(run.rounds[1].from, 'A');
  assert.equal(run.rounds[1].to, 'C');
  assert.equal(run.rounds[2].from, 'F');
  assert.notEqual(run.rounds[2].from, run.rounds[1].to);
});

test('同权边按原始索引稳定选择', () => {
  const graph = { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [
    { id: 'A-B', u: 'A', v: 'B', w: 2, index: 8 },
    { id: 'A-C', u: 'A', v: 'C', w: 2, index: 3 },
    { id: 'B-C', u: 'B', v: 'C', w: 2, index: 1 }
  ] };
  const run = buildRun(graph, 'A');
  assert.equal(run.events[0].edge.id, 'A-C');
  assert.equal(run.events[3].edge.id, 'B-C');
});

test('支持零权、负权与断连图', () => {
  const graph = { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [
    { id: 'A-B', u: 'A', v: 'B', w: 0, index: 0 },
    { id: 'B-C', u: 'B', v: 'C', w: -4, index: 1 }
  ] };
  const run = buildRun(graph, 'A');
  assert.equal(run.final.cost, -4);
  assert.deepEqual(run.final.tree, ['A-B', 'B-C']);

  const disconnected = { nodes: graph.nodes, edges: [graph.edges[0]] };
  const blocked = buildRun(disconnected, 'A');
  assert.equal(blocked.final.phase, 'blocked');
  assert.equal(blocked.final.owned.length, 2);
  assert.equal(blocked.final.tree.length, 1);
  assert.match(blocked.final.message, /无法/);
  assert.equal(blocked.events.at(-1).after.phase, 'blocked');
  assert.deepEqual(blocked.final, blocked.events.at(-1).after);
});

test('单点完成，首都无效时报错', () => {
  const run = buildRun({ nodes: [{ id: 'A' }], edges: [] }, 'A');
  assert.equal(run.initial.phase, 'done');
  assert.equal(run.final.phase, 'done');
  assert.deepEqual(run.events, []);
  assert.deepEqual(run.boundaries, [0]);
  assert.deepEqual(run.final, run.initial);
  assert.throws(() => buildRun(makeGraph('chain'), 'Z'), RangeError);
});

test('初始孤立首都直接阻塞，末次 annex 状态即 final', () => {
  const graph = { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [
    { id: 'A-B', u: 'A', v: 'B', w: 1, index: 0 }
  ] };
  const isolated = buildRun(graph, 'C');
  assert.equal(isolated.initial.phase, 'blocked');
  assert.deepEqual(isolated.events, []);
  assert.deepEqual(isolated.final, isolated.initial);

  const exhausted = buildRun(graph, 'A');
  assert.equal(exhausted.initial.phase, 'ready');
  assert.equal(exhausted.events.at(-1).kind, 'annex');
  assert.equal(exhausted.events.at(-1).after.phase, 'blocked');
  assert.deepEqual(exhausted.final, exhausted.events.at(-1).after);
});

test('有事件的成功运行 final 与末次事件 after 一致', () => {
  const run = buildRun(makeGraph('classic'), 'A');
  assert.deepEqual(run.final, run.events.at(-1).after);
});
