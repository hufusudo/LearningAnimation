'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSequence, DEFAULT_VALUES } = require('./model.js');

function valueById(result, id) {
  return result.items.find(item => item.id === id).value;
}

function isHeap(state, items, mode) {
  for (let child = 1; child < state.heapSize; child += 1) {
    const parent = Math.floor((child - 1) / 2);
    const p = valueById({ items }, state.order[parent]);
    const c = valueById({ items }, state.order[child]);
    if (mode === 'max' ? p < c : p > c) return false;
  }
  return true;
}

for (const mode of ['max', 'min']) {
  test(`${mode}堆排序输出正确并守恒元素身份`, () => {
    for (const values of [DEFAULT_VALUES, [4, 4, -2, 0, -2, 9], [], [7]]) {
      const result = buildSequence(values, mode);
      const expected = values.slice().sort((a, b) => mode === 'max' ? a - b : b - a);
      const actual = result.events.at(-1).after.order.map(id => valueById(result, id));
      assert.deepEqual(actual, expected);
      assert.deepEqual(result.items.map(item => item.id).sort((a, b) => a - b), values.map((_, i) => i));
      assert.equal(result.duration, result.events.length);
      assert.equal(result.events.at(-1).after.heapSize, 0);
    }
  });
}

test('从空树按输入层序放入，全部到位后才调整成堆，最后再排序', () => {
  const result = buildSequence(DEFAULT_VALUES);
  assert.equal(result.initial.treeSize, 0);
  assert.equal(result.initial.heapSize, DEFAULT_VALUES.length);
  const placements = result.events.filter(e => e.kind === 'place');
  assert.equal(placements.length, DEFAULT_VALUES.length);
  placements.forEach((event, i) => {
    assert.deepEqual(event.slots, [i]);
    assert.equal(event.before.treeSize, i);
    assert.equal(event.after.treeSize, i + 1);
    assert.deepEqual(event.after.order, result.initial.order);
    assert.equal(event.after.comp, 0);
    assert.equal(event.after.swaps, 0);
    assert.equal(event.after.phase, 'place');
    assert.deepEqual(event.after.links, [i]);
  });
  const treeDone = result.events.findIndex(e => e.kind === 'treeDone');
  const firstFocus = result.events.findIndex(e => e.kind === 'focus');
  const built = result.events.findIndex(e => e.kind === 'buildDone');
  const sortStart = result.events.findIndex(e => e.kind === 'sortStart');
  const firstExchange = result.events.findIndex(e => e.kind === 'exchange');
  assert.ok(treeDone < firstFocus && firstFocus < built && built < sortStart && sortStart < firstExchange);
  assert.equal(result.events[treeDone].after.treeSize, DEFAULT_VALUES.length);
  assert.equal(result.events[sortStart].after.swaps, result.events[built].after.swaps);
});

test('下滤与堆顶交换均保留双方映射身份，缩堆不影响剩余树身份', () => {
  const result = buildSequence(DEFAULT_VALUES);
  for (const event of result.events) {
    assert.equal(event.after.treeSize <= event.after.heapSize, true);
    if (event.kind === 'swap' || event.kind === 'exchange') {
      const ids = event.slots.map(slot => event.before.order[slot]).sort((a, b) => a - b);
      assert.deepEqual(event.after.links.slice().sort((a, b) => a - b), ids);
    }
    if (event.kind === 'shrink') assert.equal(event.after.treeSize, event.before.treeSize - 1);
  }
  assert.equal(result.events.at(-1).after.treeSize, 0);
});

test('单孩子选择不增加孩子间比较次数', () => {
  const result = buildSequence([1, 2, 3], 'max');
  const single = result.events.find(event => event.kind === 'select' && event.kids.length === 1);
  assert.ok(single);
  assert.equal(single.after.comp, single.before.comp);
  const judge = result.events.find(event => event.kind === 'judge' && event.parent === single.parent);
  assert.equal(judge.after.comp, judge.before.comp + 1);
});

test('交换计数包含每次出堆交换', () => {
  const result = buildSequence([3, 1, 2], 'max');
  const exchanges = result.events.filter(event => event.kind === 'exchange');
  const swaps = result.events.filter(event => event.kind === 'swap');
  assert.equal(result.events.at(-1).after.swaps, exchanges.length + swaps.length);
  assert.equal(exchanges.length, 2);
  assert.ok(exchanges.every(event => event.after.swaps === event.before.swaps + 1));
});

test('快照连续、深拷贝且不会被后续步骤污染', () => {
  const result = buildSequence([5, 1, 8, 2, 8, -3], 'max');
  assert.deepEqual(result.events[0].before, result.initial);
  for (let i = 0; i < result.events.length; i += 1) {
    const event = result.events[i];
    assert.deepEqual(event.before.order.length, result.items.length);
    assert.notEqual(event.before, event.after);
    if (i > 0) assert.deepEqual(result.events[i - 1].after, event.before);
  }
  const snapshot = JSON.stringify(result.events[0].after);
  result.events.at(-1).after.order.reverse();
  assert.equal(JSON.stringify(result.events[0].after), snapshot);
});

test('heapReady与buildDone时活动区满足堆性质', () => {
  for (const mode of ['max', 'min']) {
    const result = buildSequence([4, 9, 1, 7, 2, 6, 3], mode);
    for (const event of result.events.filter(e => e.kind === 'heapReady' || e.kind === 'buildDone')) {
      assert.ok(isHeap(event.after, result.items, mode), `${mode} ${event.kind}`);
    }
  }
});

test('缩堆后锁定尾部不再改变，建堆focus从最后非叶子向根', () => {
  const result = buildSequence([6, 2, 9, 1, 8, 3, 7], 'max');
  const focuses = result.events.filter(event => event.kind === 'focus').map(event => event.parent);
  assert.deepEqual(focuses, [2, 1, 0]);
  let locked = [];
  let lockedSize = result.items.length;
  for (const event of result.events) {
    if (event.kind === 'shrink') {
      assert.deepEqual(event.after.order.slice(lockedSize), locked);
      lockedSize = event.after.heapSize;
      locked = event.after.order.slice(lockedSize);
    } else if (locked.length) {
      assert.deepEqual(event.after.order.slice(lockedSize), locked);
    }
  }
});

test('拒绝非法值与非法模式', () => {
  for (const values of [null, '123', Array(16).fill(1), [1, NaN], [Infinity], [undefined]]) {
    assert.throws(() => buildSequence(values));
  }
  assert.throws(() => buildSequence([], 'other'));
});
