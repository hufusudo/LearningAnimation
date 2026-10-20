'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const model = require('./model.js');

const ids = sequence => sequence.map(item => item.id);

test('case fixtures and inversion counts', () => {
  assert.deepEqual(ids(model.CASES.classic.items), ['49a', '38', '65', '97', '76', '13', '27', '49b']);
  assert.deepEqual(model.CASES.classic.gaps, [4, 2, 1]);
  assert.deepEqual(ids(model.CASES.counter.items), ['3', '2a', '2b', '1']);
  assert.deepEqual(model.CASES.counter.gaps, [2, 1]);
  assert.equal(model.countInversions([3, 2, 2, 1]), 5);
});

test('classic executes the real gapped passes and preserves equal-item identity', () => {
  const sequence = model.buildSequence();
  assert.equal(sequence.initial.inversions, 15);
  assert.deepEqual(sequence.checkpoints.map(point => [point.gap, point.inversions]), [[4, 6], [2, 3], [1, 0]]);
  const passResults = [
    ['49a', '13', '27', '49b', '76', '38', '65', '97'],
    ['27', '13', '49a', '38', '65', '49b', '76', '97'],
    ['13', '27', '38', '49a', '49b', '65', '76', '97']
  ];
  sequence.checkpoints.forEach((checkpoint, i) => {
    assert.equal(sequence.steps[checkpoint.time - 1].kind, 'pass');
    assert.deepEqual(sequence.steps[checkpoint.time - 1].after.slots, passResults[i]);
  });
  assert.deepEqual(sequence.steps.at(-1).after.slots, passResults.at(-1));
  assert.equal(sequence.reversalTime, null);
});

test('counterexample reverses equal identities and reports first reversal', () => {
  const sequence = model.buildSequence('counter');
  assert.equal(sequence.initial.inversions, 5);
  assert.deepEqual(sequence.checkpoints.map(point => [point.gap, point.inversions]), [[2, 2], [1, 0]]);
  assert.deepEqual(sequence.steps.at(-2).after.slots, ['1', '2b', '2a', '3']);
  assert.notEqual(sequence.reversalTime, null);
  const firstReverse = sequence.steps[sequence.reversalTime - 1];
  assert.equal(firstReverse.kind, 'insert');
  assert.equal(firstReverse.after.order, 'reversed');
  const firstInsert = sequence.steps.findIndex(step => step.kind === 'insert');
  assert.equal(sequence.reversalTime, firstInsert + 1, '2b crosses 2a on the first insertion');
  for (const step of sequence.steps.filter(step => step.kind === 'insert')) {
    assert.equal(step.after.order, step.after.slots.indexOf('2a') < step.after.slots.indexOf('2b') ? 'original' : 'reversed');
  }
});

test('each event has independent snapshots and preserves identity and movement contracts', () => {
  for (const key of ['classic', 'counter']) {
    const sequence = model.buildSequence(key);
    const allIds = sequence.items.map(item => item.id).sort();
    assert.equal(sequence.duration, sequence.steps.length);
    assert.equal(sequence.initial.phase, '就绪');
    assert.equal(sequence.initial.temp, null);
    assert.deepEqual(sequence.initial.slots, allIdsFor(key));
    assert.equal(sequence.steps.at(-1).kind, 'finish');
    assert.equal(sequence.steps.at(-1).after.completed, true);
    assert.equal(sequence.steps.at(-1).before.completed, false);

    sequence.steps.forEach((step, index) => {
      if (index) assert.deepEqual(step.before, sequence.steps[index - 1].after);
      assert.equal(step.before.completed, false);
      assert.equal(step.after.slots.filter(id => id !== null).length + (step.after.temp === null ? 0 : 1), allIds.length);
      assert.deepEqual([...step.after.slots.filter(id => id !== null), ...(step.after.temp === null ? [] : [step.after.temp])].sort(), allIds);
      if (['gap', 'select', 'compare', 'pass', 'finish'].includes(step.kind)) {
        assert.deepEqual(step.before.slots, step.after.slots);
      }
      if (step.kind === 'shift') {
        assert.equal(step.to - step.from, step.before.gap);
        assert.equal(step.from % step.before.gap, step.to % step.before.gap);
        assert.equal(step.after.slots[step.from], null);
        assert.equal(step.after.slots[step.to], step.focus);
        const shifted = sequence.items.find(item => item.id === step.focus);
        const held = sequence.items.find(item => item.id === step.before.temp);
        assert.ok(shifted.value > held.value, 'equal keys never shift past each other within one sublist');
      }
      if (step.kind === 'compare') assert.match(step.label, /[>≤]/);
      for (const snapshot of [step.before, step.after]) {
        assert.equal(Object.hasOwn(snapshot, 'focus'), false);
        assert.ok(snapshot.message.length <= 40);
        assert.equal(snapshot.slots.filter(id => id === null).length, snapshot.temp === null ? 0 : 1);
        if (snapshot.temp === null) {
          const records = snapshot.slots.map(id => sequence.items.find(item => item.id === id));
          assert.equal(snapshot.inversions, model.countInversions(records));
          assert.equal(snapshot.order, records.findIndex(item => item.tag === 'a') < records.findIndex(item => item.tag === 'b') ? 'original' : 'reversed');
        }
      }
      assert.ok(step.label.length <= 8 || step.kind === 'compare');
    });

    const selections = sequence.steps.filter(step => step.kind === 'select').map(step => step.after.i);
    assert.deepEqual(selections, sequence.gaps.flatMap(gap => Array.from({ length: gap }, (_, group) =>
      Array.from({ length: Math.floor((sequence.items.length - 1 - group) / gap) }, (_, k) => group + (k + 1) * gap)).flat()));
    assert.equal(sequence.steps.filter(step => step.kind === 'lift').length,
      sequence.steps.filter(step => step.kind === 'insert').length);
  }
});

function allIdsFor(key) {
  return model.CASES[key].items.map(item => item.id);
}

test('one complete sublist rises, stays upstairs through insertion sort, then returns', () => {
  for (const key of ['classic', 'counter']) {
    const sequence = model.buildSequence(key);
    let active = null;
    for (const step of sequence.steps) {
      if (step.kind === 'group-lift') {
        assert.equal(active, null, 'only one sublist can be upstairs');
        active = { gap: step.after.gap, group: step.after.group };
        assert.equal(step.before.raised, false);
        assert.equal(step.after.raised, true);
        assert.deepEqual(step.before.slots, step.after.slots, 'raising changes no logical values');
      } else if (step.kind === 'group-lower') {
        assert.ok(active);
        assert.equal(step.after.raised, false);
        const ids = step.before.slots.filter((_, i) => i % active.gap === active.group);
        const values = ids.map(id => sequence.items.find(item => item.id === id).value);
        assert.deepEqual(values, values.slice().sort((a, b) => a - b), 'entire sublist is sorted before return');
        active = null;
      } else if (['select', 'lift', 'compare', 'shift', 'insert'].includes(step.kind)) {
        assert.ok(active, 'all insertion actions happen in the raised sublist');
        assert.equal(step.after.group, active.group);
        assert.equal(step.after.raised, true);
      }
      if (step.kind === 'insert') assert.equal(step.after.prefixEnd, step.after.i);
    }
    assert.equal(active, null);
    assert.equal(sequence.steps.filter(step => step.kind === 'group-lift').length, sequence.gaps.reduce((a, b) => a + b, 0));
  }
});

test('strict comparison leaves equal keys in place', () => {
  const sequence = model.buildSequence('counter');
  const equalCompare = sequence.steps.find(step => step.kind === 'compare' && /2[ab] ≤ 2[ab]/.test(step.label));
  assert.ok(equalCompare);
  assert.equal(sequence.steps[sequence.steps.indexOf(equalCompare) + 1].kind, 'insert');
});

test('supports classic-script global and CommonJS export', () => {
  const source = fs.readFileSync(path.join(__dirname, 'model.js'), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(typeof context.ShellModel.buildSequence, 'function');
  assert.equal(context.ShellModel.buildSequence().duration, model.buildSequence().duration);
});

test('unknown cases fail clearly', () => {
  assert.throws(() => model.buildSequence('missing'), RangeError);
});
