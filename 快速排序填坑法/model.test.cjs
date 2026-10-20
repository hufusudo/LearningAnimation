'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTrace, parseInput, PRESETS } = require('./model.js');

function assertTrace(values, expected) {
  const trace = buildTrace(values);
  assert.deepEqual(trace.result, expected);
  assert.equal(trace.duration, trace.events.length);
  let previous = trace.initial;
  const fixed = new Set();
  const identities = values.map((_, i) => `v${i}`).sort();

  for (const event of trace.events) {
    assert.deepEqual(event.before, previous);
    assert.ok(event.after.caption.length <= 40);
    assert.ok(event.tag === undefined || event.tag.length <= 8);
    const { cells, pivot, hole, locked } = event.after;
    const present = cells.filter(Boolean).map(token => token.id);
    if (pivot) present.push(pivot.id);
    assert.deepEqual(present.sort(), identities);
    assert.equal(hole !== null, pivot !== null);
    if (hole !== null) assert.equal(cells[hole], null);
    cells.forEach((cell, index) => {
      if (fixed.has(index)) assert.deepEqual(cell, event.before.cells[index]);
      if (locked[index]) fixed.add(index);
    });
    assert.equal(fixed.size, event.after.locked.filter(Boolean).length);
    previous = event.after;
  }
  assert.deepEqual(trace.result, trace.events.at(-1).after.cells.map(cell => cell.value));
  assert.equal(trace.events.at(-1).kind, 'complete');
  assert.deepEqual(trace.events.at(-1).after.stack, []);
  assert.ok(trace.events.at(-1).after.locked.every(Boolean));
  assert.equal(trace.events.at(-1).after.pivot, null);
  assert.equal(trace.events.at(-1).after.hole, null);
  for (const node of trace.nodes) {
    assert.ok(Number.isInteger(node.entry) && Number.isInteger(node.exit));
    assert.equal(trace.events[node.entry - 1].kind, 'enter');
    assert.equal(trace.events[node.exit - 1].kind, 'return');
    assert.equal(trace.events[node.exit - 1].nodeId, node.id);
    assert.equal(trace.events[node.entry - 1].nodeId, node.id);
    assert.equal(trace.events.at(-1).after.nodeStates[node.id], 'done');
  }
  return trace;
}

test('sorts presets, ascending, descending, duplicates, all equal, singleton, and negatives', () => {
  assert.deepEqual(PRESETS, {
    classic: [49, 38, 65, 97, 76, 13, 27],
    sorted: [10, 20, 30, 40, 50, 60, 70],
    descending: [70, 60, 50, 40, 30, 20, 10],
    duplicates: [49, 27, 49, 13, 27, 65, 38]
  });
  for (const values of [PRESETS.classic, PRESETS.sorted, PRESETS.descending,
    PRESETS.duplicates, [5, 5, 5, 5], [8], [-9, 0, -3, 4]]) {
    assertTrace(values, [...values].sort((a, b) => a - b));
  }
});

test('initial snapshot and default mode', () => {
  const trace = buildTrace([3, 1]);
  assert.deepEqual(trace.initial.cells, [{ id: 'v0', value: 3 }, { id: 'v1', value: 1 }]);
  assert.deepEqual(trace.initial.stack, []);
  assert.equal(trace.initial.range, null);
  assert.equal(trace.initial.pivot, null);
  assert.equal(trace.initial.comparisons, 0);
  assert.equal(trace.initial.moves, 0);
  assert.equal(trace.initial.phase, '准备就绪');
  assert.ok(trace.nodes.length > 1);
});

test('single mode performs exactly one partition and preserves partition invariant', () => {
  const values = [49, 38, 65, 97, 76, 13, 27];
  const trace = buildTrace(values, 'single');
  assert.equal(trace.events.filter(event => event.kind === 'place').length, 1);
  assert.equal(trace.nodes.length, 1);
  const place = trace.events.find(event => event.kind === 'place');
  const p = place.to;
  assert.ok(trace.result.slice(0, p).every(value => value <= trace.result[p]));
  assert.ok(trace.result.slice(p + 1).every(value => value >= trace.result[p]));
  assert.equal(trace.events.at(-1).kind, 'complete');
  assert.equal(trace.events.at(-1).after.locked.filter(Boolean).length, 1);
  assert.deepEqual(trace.events.at(-1).after.stack, []);
  assert.match(trace.events.at(-1).after.caption, /未保证全局有序/);
  assert.equal(trace.events.at(-1).after.nodeStates.n0, 'done');
});

test('single mode completes singleton and small boundary inputs', () => {
  for (const values of [[7], [0, 1], [1, 0], [1, 1], [2, 0, 1]]) {
    const trace = buildTrace(values, 'single');
    assert.equal(trace.events.at(-1).kind, 'complete');
    assert.equal(trace.duration, trace.events.length);
    assert.deepEqual(trace.events.at(-1).after.stack, []);
    assert.equal(trace.nodes.length, 1);
    assert.equal(trace.events.filter(event => event.kind === 'place').length, values.length === 1 ? 0 : 1);
    if (values.length === 1) assert.match(trace.events.at(-1).after.caption, /本身有序/);
    else assert.match(trace.events.at(-1).after.caption, /未保证全局有序/);
    const place = trace.events.find(event => event.kind === 'place');
    if (place) {
      const p = place.to;
      assert.ok(trace.result.slice(0, p).every(value => value <= trace.result[p]));
      assert.ok(trace.result.slice(p + 1).every(value => value >= trace.result[p]));
    }
  }
});

test('ascending comparison count and maxDepth include empty recursive calls', () => {
  const trace = buildTrace([10, 20, 30, 40, 50, 60, 70]);
  const maxStack = Math.max(0, ...trace.events.map(event => event.after.stack.length));
  assert.equal(trace.events.at(-1).after.comparisons, 21);
  assert.equal(trace.events.at(-1).after.maxDepth, maxStack);
  assert.ok(trace.nodes.some(node => node.low > node.high));
});

test('deterministic small arrays preserve tokens and partition/sort invariants in both modes', () => {
  function checkTokens(trace, values) {
    const expectedIds = values.map((_, index) => `v${index}`).sort();
    let previous = trace.initial;
    for (const event of trace.events) {
      assert.deepEqual(event.before, previous);
      const tokens = event.after.cells.filter(Boolean).map(cell => cell.id);
      if (event.after.pivot) tokens.push(event.after.pivot.id);
      assert.deepEqual(tokens.sort(), expectedIds);
      assert.equal(event.after.hole !== null, event.after.pivot !== null);
      if (event.after.hole !== null) assert.equal(event.after.cells[event.after.hole], null);
      previous = event.after;
    }
  }

  for (let length = 1; length <= 5; length++) {
    const total = 3 ** length;
    for (let code = 0; code < total; code++) {
      let n = code;
      const values = Array.from({ length }, () => {
        const value = n % 3;
        n = Math.floor(n / 3);
        return value;
      });
      const sorted = [...values].sort((a, b) => a - b);
      const recursive = buildTrace(values);
      checkTokens(recursive, values);
      assert.deepEqual(recursive.result, sorted);
      assert.equal(recursive.events.at(-1).kind, 'complete');

      const single = buildTrace(values, 'single');
      checkTokens(single, values);
      assert.equal(single.events.at(-1).kind, 'complete');
      assert.equal(single.events.filter(event => event.kind === 'place').length, length === 1 ? 0 : 1);
      if (length > 1) {
        const pivotIndex = single.events.find(event => event.kind === 'place').to;
        assert.ok(single.result.slice(0, pivotIndex).every(value => value <= single.result[pivotIndex]));
        assert.ok(single.result.slice(pivotIndex + 1).every(value => value >= single.result[pivotIndex]));
      } else {
        assert.deepEqual(single.result, sorted);
      }
    }
  }
});

test('mutating a snapshot does not affect any other snapshot', () => {
  const trace = buildTrace([4, 1, 3]);
  const eventIndex = trace.events.findIndex(event => event.kind === 'fill');
  assert.ok(eventIndex > 0);
  const event = trace.events[eventIndex];
  const before = JSON.stringify(event.before);
  const initial = JSON.stringify(trace.initial);
  const otherAfter = JSON.stringify(trace.events[eventIndex - 1].after);
  const nextBefore = JSON.stringify(trace.events[eventIndex + 1].before);
  event.after.cells[0] = { id: 'changed', value: 999 };
  event.after.stack.push('changed');
  assert.equal(JSON.stringify(event.before), before);
  assert.equal(JSON.stringify(trace.initial), initial);
  assert.equal(JSON.stringify(trace.events[eventIndex - 1].after), otherAfter);
  assert.equal(JSON.stringify(trace.events[eventIndex + 1].before), nextBefore);
});

test('parseInput accepts valid delimiters and rejects malformed input', () => {
  assert.deepEqual(parseInput('1, 2，-3 4'), { values: [1, 2, -3, 4], error: '' });
  for (const input of ['', '1,,2', '1, ,2', ',1', '1,', '1.2', '1x', '1000', '-1000', '1 2 3 4 5 6 7 8 9 10 11']) {
    const parsed = parseInput(input);
    assert.equal(parsed.values, null, input);
    assert.ok(parsed.error.length > 0, input);
  }
  assert.throws(() => buildTrace([1.5]), TypeError);
  assert.throws(() => buildTrace([1], 'other'), TypeError);
});
