'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const RadixModel = require('./model.js');

const { PRESETS, build, parseInput } = RadixModel;

function assertConserved(state) {
  const ids = state.belt.filter(id => id !== null).concat(...state.buckets);
  assert.equal(ids.length, 8);
  assert.deepEqual([...ids].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
}

test('exports UMD API, presets, and supports input separators', () => {
  assert.deepEqual(PRESETS.classic, [278, 109, 63, 930, 589, 184, 505, 269]);
  assert.deepEqual(PRESETS.reverse, [982, 874, 763, 651, 540, 439, 328, 217]);
  assert.deepEqual(PRESETS.conflict, [524, 124, 524, 324, 124, 24, 624, 424]);
  assert.equal(globalThis.RadixModel, RadixModel);
  assert.deepEqual(parseInput('0, 1，2\n3\t4,5 6,999'), [0, 1, 2, 3, 4, 5, 6, 999]);
});

test('parseInput and build reject invalid values and preserve caller input', () => {
  for (const text of ['', '1 2 3 4 5 6 7', '1 2 3 4 5 6 7 8 9', '1 2 3 4 5 6 7 x', '-1 2 3 4 5 6 7 8', '1.5 2 3 4 5 6 7 8', '1000 2 3 4 5 6 7 8']) {
    assert.throws(() => parseInput(text), Error, text);
  }
  for (const values of [[1, 2], [1, 2, 3, 4, 5, 6, 7, 1000], [1, 2, 3, 4, 5, 6, 7, -1], [1, 2, 3, 4, 5, 6, 7, 1.2]]) {
    assert.throws(() => build(values), Error);
  }
  const values = [0, 999, 50, 50, 2, 80, 7, 7];
  const original = values.slice();
  build(values);
  assert.deepEqual(values, original);
  const text = '0,999,50,50,2,80,7,7';
  const parsed = parseInput(text);
  assert.deepEqual(parsed, [0, 999, 50, 50, 2, 80, 7, 7]);
});

test('build emits consistent LSD steps, snapshots, rounds, and sorted stable result', () => {
  for (const input of [PRESETS.classic, PRESETS.reverse, PRESETS.conflict, [999, 0, 0, 999, 0, 999, 0, 999], [42, 42, 42, 42, 42, 42, 42, 42], [999, 888, 777, 666, 555, 444, 333, 0]]) {
    const model = build(input);
    assert.deepEqual(Object.keys(model), ['items', 'initial', 'steps', 'rounds', 'result']);
    assert.equal(model.items.length, 8);
    model.items.forEach((item, id) => {
      const str = String(input[id]).padStart(3, '0');
      assert.deepEqual(item, {
        id, value: input[id], str, tag: String.fromCharCode(65 + id),
        digits: [Number(str[2]), Number(str[1]), Number(str[0])]
      });
    });
    assert.equal(model.steps.length, 55);
    assert.equal(model.rounds.length, 3);
    assert.deepEqual(model.initial, model.steps[0].before);
    model.steps.forEach((step, index) => {
      assert.deepEqual(Object.keys(step), ['kind', 'pass', 'item', 'bucket', 'index', 'before', 'after', 'text']);
      assertConserved(step.before);
      assertConserved(step.after);
      if (index) assert.deepEqual(model.steps[index - 1].after, step.before);
    });

    for (const round of model.rounds) {
      assert.deepEqual(Object.keys(round), ['pass', 'start', 'distributed', 'end', 'order']);
      assert.equal(model.steps[round.start].kind, 'digit');
      assert.equal(model.steps[round.start].after.phase, 'distribute');
      assert.equal(round.distributed, round.start + 9);
      assert.equal(model.steps[round.distributed - 1].after.processed, 8);
      assert.equal(model.steps[round.distributed].kind, 'digit');
      assert.equal(model.steps[round.distributed].after.phase, 'collect');
      assert.equal(round.end, round.distributed + 9);
      assert.deepEqual(round.order, model.steps[round.end - 1].after.belt);
      const distribution = model.steps.slice(round.start + 1, round.distributed);
      const collect = model.steps.slice(round.distributed + 1, round.end);
      assert.equal(distribution.length, 8);
      assert.equal(collect.length, 8);
      assert.deepEqual(distribution.map(step => step.index), [0, 1, 2, 3, 4, 5, 6, 7]);
      let targetIndex = 0;
      for (let bucket = 0; bucket < 10; bucket++) {
        const fifo = distribution.filter(step => step.bucket === bucket).map(step => step.item);
        const collected = collect.filter(step => step.bucket === bucket);
        assert.deepEqual(collected.map(step => step.item), fifo);
        for (const step of collected) assert.equal(step.index, targetIndex++);
      }
      assert.equal(targetIndex, 8);
    }

    assert.equal(model.steps.at(-1).kind, 'finish');
    assert.equal(model.steps.at(-1).after.phase, 'done');
    assert.equal(model.steps.at(-1).after.complete, true);
    assert.deepEqual(model.result.map(item => item.value), input.slice().sort((a, b) => a - b));
    for (let i = 1; i < model.result.length; i++) {
      if (model.result[i - 1].value === model.result[i].value) {
        assert.ok(model.result[i - 1].id < model.result[i].id);
      }
    }
  }
});

test('distribution is FIFO and snapshots are independent deep copies', () => {
  const model = build(PRESETS.conflict);
  const first = model.steps[0];
  first.after.belt[0] = 99;
  assert.equal(model.steps[1].before.belt[0], 0);
  assert.equal(model.initial.belt[0], 0);
  assert.equal(model.steps[1].after.buckets[4][0], 0);
});
