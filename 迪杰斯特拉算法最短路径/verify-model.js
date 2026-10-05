'use strict';
// Run with: node 迪杰斯特拉算法最短路径/verify-model.js
const assert = require('node:assert/strict');
const model = require('./app.js');
const sequence = model.buildSequence();

// A separate exhaustive oracle checks the greedy algorithm's settled values.
function shortestDistance(target, edges = model.edges) {
  let best = Infinity;
  function visit(current, distance, visited) {
    if (current === target) { best = Math.min(best, distance); return; }
    for (const e of edges) {
      if (e.a !== current && e.b !== current) continue;
      const next = e.a === current ? e.b : e.a;
      if (!visited.includes(next)) visit(next, distance + e.weight, [...visited, next]);
    }
  }
  visit('A', 0, ['A']);
  return best;
}
assert.deepEqual(sequence.route, ['A', 'B', 'C', 'D', 'F']);
assert.deepEqual(sequence.final.settled, ['A', 'B', 'C', 'D', 'F']);
assert.deepEqual(sequence.final.dist, { A: 0, B: 2, C: 5, D: 7, E: 11, F: 9 });
assert(!sequence.phases.some(p => p.type === 'relax' && p.node === 'F'));
for (const phase of sequence.phases) {
  for (const id of phase.after.settled) assert.equal(phase.after.dist[id], shortestDistance(id));
  for (const id of phase.before.settled) {
    assert.equal(phase.after.dist[id], phase.before.dist[id]);
    assert.equal(phase.after.prev[id], phase.before.prev[id]);
  }
}
const updates = sequence.phases.flatMap(p => p.probes || []);
assert(updates.some(p => p.to === 'C' && p.old === 7 && p.value === 5 && p.oldPrev === 'A' && p.from === 'B'));
assert(updates.some(p => p.to === 'D' && p.old === 8 && p.value === 7 && p.oldPrev === 'B' && p.from === 'C'));
assert(updates.some(p => p.to === 'E' && p.old === 11 && p.value === 12 && !p.improved));
const disconnected = model.buildSequence(model.nodes, []);
assert.deepEqual(disconnected.route, []);
assert.equal(disconnected.final.dist.F, Infinity);
const tieEdges = [{ a: 'A', b: 'B', weight: 2 }, { a: 'A', b: 'C', weight: 2 },
  { a: 'B', b: 'C', weight: 0 }, { a: 'C', b: 'F', weight: 1 }];
const tie = model.buildSequence(model.nodes, tieEdges);
assert.deepEqual(tie.final.settled, ['A', 'B', 'C', 'F']);
assert.equal(tie.final.prev.C, 'A');
assert.equal(tie.final.dist.F, shortestDistance('F', tieEdges));
assert.throws(() => model.buildSequence(model.nodes, [{ a: 'A', b: 'F', weight: -1 }]));
console.log('通过：独立最短路径枚举核验、已锁定值不变、两次前驱改道、较长距离舍弃、终点早停、等长路径和不可达终点。');
