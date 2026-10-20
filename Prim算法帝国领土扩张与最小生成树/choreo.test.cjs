const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

for (const preset of Object.keys(M.PRESETS)) {
  test(`${preset}: all event boundaries share exactly the same visual state`, () => {
    for (const capital of M.PRESETS[preset].nodes.map(n => n.id)) {
      const run = M.buildRun(M.makeGraph(preset), capital);
      assert.deepEqual(C.sample(run, 0), C.snapshot(run, run.initial));
      run.events.forEach((e, i) => {
        assert.deepEqual(C.sampleStep(run, e, 0), C.snapshot(run, e.before));
        assert.deepEqual(C.sampleStep(run, e, 1), C.snapshot(run, e.after));
        if (i) assert.deepEqual(C.sampleStep(run, run.events[i - 1], 1), C.sampleStep(run, e, 0));
        assert.deepEqual(C.sample(run, e.end), C.snapshot(run, e.after));
      });
      assert.deepEqual(C.sample(run, run.duration), C.snapshot(run, run.final));
    }
  });
}

test('focus precedes road growth; cost receipt follows construction', () => {
  const run = M.buildRun(M.makeGraph('classic'), 'A');
  const event = run.events.find(e => e.kind === 'connect');
  const lead = C.sampleStep(run, event, 0.12);
  assert.ok(lead.focus.alpha > 0);
  assert.equal(lead.road.progress, 0);
  assert.equal(lead.stats.cost, event.before.cost);
  const moving = C.sampleStep(run, event, 0.4);
  assert.ok(moving.road.progress > 0 && moving.road.progress < 1);
  assert.equal(moving.road.from, event.from);
  assert.equal(moving.road.to, event.to);
  assert.equal(moving.stats.cost, event.before.cost);
  const receipt = C.sampleStep(run, event, 0.82);
  assert.ok(receipt.stats.cost > event.before.cost);
  assert.equal(receipt.edges.find(e => e.id === event.edge.id).tree, 1);
  assert.ok(receipt.tag.alpha > 0);
});

test('annexation flows out from the existing territory before swallowing the new node', () => {
  for (const capital of ['A', 'F']) {
    const run = M.buildRun(M.makeGraph('classic'), capital);
    const event = run.events.find(e => e.kind === 'annex');
    const growing = C.sampleStep(run, event, 0.4);
    const edge = growing.edges.find(e => e.id === event.edge.id);
    assert.ok(edge.land > 0 && edge.land < 1);
    assert.equal(edge.landFrom, event.from, 'land must advance from the existing territory, including reverse edges');
    assert.equal(growing.nodes.find(n => n.id === event.to).owned, 0);
    assert.equal(growing.stats.owned, event.before.owned.length);
    const swallowed = C.sampleStep(run, event, 0.77);
    assert.equal(swallowed.nodes.find(n => n.id === event.to).owned, 1);
    assert.equal(swallowed.edges.find(e => e.id === event.edge.id).land, 1);
    assert.equal(swallowed.stats.owned, event.before.owned.length, 'receipts follow swallowing');
    const receipt = C.sampleStep(run, event, 0.9);
    assert.equal(receipt.tag.text, `吞并 ${event.to}`);
    assert.ok(receipt.tag.alpha > 0);
  }
});

test('sampling is history independent, clamped and leaves model immutable', () => {
  const run = M.buildRun(M.makeGraph('dense'), 'F');
  const serialized = JSON.stringify(run);
  const sample = C.sample(run, 6.23);
  for (const t of [run.duration, 1.2, 0, 15.7, 3.1, 6.23]) C.sample(run, t);
  assert.deepEqual(C.sample(run, 6.23), sample);
  assert.equal(JSON.stringify(run), serialized);
  assert.deepEqual(C.sample(run, -4), C.sample(run, 0));
  assert.deepEqual(C.sample(run, Infinity), C.sample(run, run.duration));
});

test('reduced motion keeps only completed states; empty runs have a valid terminal state', () => {
  const run = M.buildRun(M.makeGraph('classic'), 'A');
  for (const e of run.events) {
    assert.deepEqual(C.sample(run, e.start + e.duration / 2, true), C.snapshot(run, e.before));
    assert.deepEqual(C.sample(run, e.end, true), C.snapshot(run, e.after));
  }
  for (const graph of [
    { nodes: [{ id: 'A' }], edges: [] },
    { nodes: [{ id: 'A' }, { id: 'B' }], edges: [] }
  ]) {
    const r = M.buildRun(graph, 'A');
    assert.deepEqual(C.sample(r, 0), C.snapshot(r, r.final));
  }
});
