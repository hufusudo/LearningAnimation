'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('./model.js');

function finalRow(result) { return result.events.at(-1).after.row; }
function assertSortedStable(values) {
  const result = build(values);
  const ids = finalRow(result);
  assert.deepEqual(ids.map(id => result.cards[id].value), values.slice().sort((a, b) => a - b));
  const orderByValue = new Map();
  for (const id of ids) {
    const value = result.cards[id].value;
    if (!orderByValue.has(value)) orderByValue.set(value, []);
    orderByValue.get(value).push(id);
  }
  for (const order of orderByValue.values()) assert.deepEqual(order, order.slice().sort((a, b) => a - b));
  return result;
}
function assertConservation(result) {
  const n = result.cards.length;
  for (const event of result.events) {
    const state = event.after;
    const ids = state.row.filter(id => id !== null);
    if (state.tray) ids.push(...state.tray.cards.filter(id => id !== null));
    assert.equal(ids.length, n, `${event.kind} preserves card count`);
    assert.deepEqual(ids.slice().sort((a, b) => a - b), Array.from({ length: n }, (_, id) => id));
    assert.equal(state.row.length, n);
    assert.equal(state.gaps.length, n - 1);
  }
}

test('默认输入排序稳定且计数独立核对', () => {
  const input = [49, 38, 65, 97, 76, 13, 27, 49];
  const result = assertSortedStable(input);
  // 独立逐层归并计数：各层比较次数为 4、4、4、4。
  let runs = input.map(value => [value]);
  let independentlyCounted = 0;
  while (runs.length > 1) {
    const next = [];
    for (let i = 0; i < runs.length; i += 2) {
      if (!runs[i + 1]) { next.push(runs[i]); continue; }
      let l = 0, r = 0;
      while (l < runs[i].length && r < runs[i + 1].length) {
        independentlyCounted++;
        if (runs[i][l] <= runs[i + 1][r]) l++; else r++;
      }
      next.push(runs[i].concat(runs[i + 1]).sort((a, b) => a - b));
    }
    runs = next;
  }
  const comparisons = result.events.reduce((sum, e) => sum + e.after.stats.cmp - e.before.stats.cmp, 0);
  const moves = result.events.reduce((sum, e) => sum + e.after.stats.mv - e.before.stats.mv, 0);
  assert.equal(independentlyCounted, 16);
  assert.equal(comparisons, independentlyCounted);
  assert.equal(moves, 24);
  assert.ok(result.events.some(e => e.kind === 'compare' && e.tie && e.after.comparison === '49a = 49b · 等值取左'));
  assert.equal(result.duration, result.events.reduce((sum, e) => sum + e.duration, 0));
});

test('事件快照连续、独立且各 take 只搬一张', () => {
  const result = build();
  assert.deepEqual(result.initial, result.events[0].before);
  assert.equal(result.initial.gaps.length, result.cards.length - 1);
  for (let i = 0; i < result.events.length; i++) {
    const event = result.events[i];
    if (i) assert.deepEqual(event.before, result.events[i - 1].after);
    assert.notStrictEqual(event.before, event.after);
    assert.ok(event.duration >= 1 && event.duration <= 1.4);
    if (event.kind === 'release') {
      assert.equal(event.after.tray, null);
      assert.equal(event.after.focus, null);
      assert.deepEqual(event.after.heads, { L: null, R: null });
      assert.equal(event.after.comparison, '');
    }
    if (event.kind === 'take') {
      assert.equal(event.after.stats.mv, event.before.stats.mv + 1);
      assert.equal(event.before.row[event.from], event.card);
      assert.equal(event.before.tray.cards[event.slot], null);
      assert.equal(event.after.row[event.from], null);
      assert.equal(event.after.tray.cards[event.slot], event.card);
      const changedRows = event.before.row.filter((id, pos) => id !== event.after.row[pos]);
      const changedTray = event.before.tray.cards.filter((id, pos) => id !== event.after.tray.cards[pos]);
      assert.equal(changedRows.length, 1);
      assert.equal(changedTray.length, 1);
    }
  }
  assertConservation(result);
  const splitEvents = result.events.filter(event => event.kind === 'split');
  for (const event of splitEvents) {
    const width = event.hi - event.lo + 1;
    const expectedGap = width >= 8 ? 64 : width >= 4 ? 38 : 24;
    assert.equal(event.after.gaps[event.mid], expectedGap);
  }
  for (const event of result.events.filter(event => event.kind === 'close')) {
    for (let gap = event.lo; gap < event.hi; gap++) assert.equal(event.after.gaps[gap], 8);
  }
  assert.ok(result.events.every(event => event.before.gaps.length === result.cards.length - 1));
  const frozen = JSON.stringify(result.initial);
  result.events[0].after.row[0] = 999;
  assert.equal(JSON.stringify(result.initial), frozen);
});

test('各种边界数组排序稳定', () => {
  for (const values of [
    [4, 4, 4, 4, 4, 4, 4, 4], [8, 7, 6, 5, 4, 3, 2, 1], [5],
    [3, 1, 2], [9, 2, 9, 1, 2, 7, 1], [0, -2, 3.5, -2]
  ]) {
    const result = assertSortedStable(values);
    assertConservation(result);
  }
  assert.equal(build([5]).initial.groups[0].ordered, true);
  assert.equal(build([1, 2]).initial.groups[0].ordered, false);
});

test('拒绝非法输入', () => {
  for (const input of [null, {}, [], Array(9).fill(1), [1, NaN], [Infinity], ['2'], [undefined]]) {
    assert.throws(() => build(input), TypeError);
  }
});
