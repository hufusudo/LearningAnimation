const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const model = fs.existsSync(`${__dirname}/model.js`) ? require('./model.js') : {};

test('RIP adds one hop and keeps a better route learned from another neighbor', () => {
  assert.equal(typeof model.receiveRip, 'function');
  assert.deepEqual(model.receiveRip({ metric: 16, via: null }, 'A', 1), { metric: 2, via: 'A' });
  assert.deepEqual(model.receiveRip({ metric: 2, via: 'A' }, 'C', 4), { metric: 2, via: 'A' });
});

test('RIP accepts worsening information from its current next hop and caps at 16', () => {
  assert.equal(typeof model.receiveRip, 'function');
  assert.deepEqual(model.receiveRip({ metric: 2, via: 'A' }, 'A', 3), { metric: 4, via: 'A' });
  assert.deepEqual(model.receiveRip({ metric: 15, via: 'A' }, 'A', 16), { metric: 16, via: null });
});

test('stale neighbor report creates a two-router loop that counts to unreachable', () => {
  assert.equal(typeof model.receiveRip, 'function');
  let a = { metric: 16, via: null }, b = { metric: 2, via: 'A' };
  a = model.receiveRip(a, 'B', model.advertise(b, 'A', false));
  assert.deepEqual(a, { metric: 3, via: 'B' });
  const values = [a.metric];
  for (let i = 0; i < 14; i++) {
    if (i % 2 === 0) { b = model.receiveRip(b, 'A', a.metric); values.push(b.metric); }
    else { a = model.receiveRip(a, 'B', b.metric); values.push(a.metric); }
  }
  assert.deepEqual(values, [3,4,5,6,7,8,9,10,11,12,13,14,15,16,16]);
  assert.equal(a.metric, 16); assert.equal(b.metric, 16);
});

test('poison reverse stops the same stale reverse route being accepted', () => {
  assert.equal(typeof model.advertise, 'function');
  assert.equal(model.advertise({ metric: 2, via: 'A' }, 'A', true), 16);
  assert.equal(model.advertise({ metric: 2, via: 'A' }, 'C', true), 2);
  assert.equal(model.receiveRip({ metric: 16, via: null }, 'B', 16).metric, 16);
});

// C–E costs 8 so the failure lesson has one unambiguous shortest path.
const links = [['A','B',2], ['A','C',5], ['B','C',1], ['B','D',6], ['C','D',1], ['C','E',8], ['D','E',2]];
test('Dijkstra chooses total cost, relaxes earlier estimates, and reconstructs a path', () => {
  assert.equal(typeof model.dijkstra, 'function');
  const result = model.dijkstra(['A','B','C','D','E'], links, 'A');
  assert.deepEqual(result.dist, { A:0, B:2, C:3, D:4, E:6 });
  assert.deepEqual(model.pathTo(result.prev, 'A', 'E'), ['A','B','C','D','E']);
  assert.deepEqual(result.steps.map(x => x.node), ['A','B','C','D','E']);
});

test('after C–D breaks, a longer but valid alternate path is selected', () => {
  assert.equal(typeof model.dijkstra, 'function');
  const result = model.dijkstra(['A','B','C','D','E'], links.filter(([a,b]) => !(a === 'C' && b === 'D')), 'A');
  assert.equal(result.dist.E, 10);
  assert.deepEqual(model.pathTo(result.prev, 'A', 'E'), ['A','B','D','E']);
});

test('disconnected destinations remain unreachable', () => {
  assert.equal(typeof model.dijkstra, 'function');
  const result = model.dijkstra(['A','B','C'], [['A','B',2]], 'A');
  assert.equal(result.dist.C, Infinity);
  assert.deepEqual(model.pathTo(result.prev, 'A', 'C'), []);
});
