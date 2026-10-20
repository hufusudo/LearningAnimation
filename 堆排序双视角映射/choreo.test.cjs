const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

for (const mode of ['max', 'min']) {
  const seq = M.buildSequence(M.DEFAULT_VALUES, mode);
  test(`${mode}：每步起终画面与模型快照一致，相邻边界完全连续`, () => {
    for (let i = 0; i < seq.events.length; i++) {
      assert.deepEqual(C.sampleEvent(seq, i, 0), C.snapshot(seq, seq.events[i].before));
      assert.deepEqual(C.sampleEvent(seq, i, 1), C.snapshot(seq, seq.events[i].after));
      if (i + 1 < seq.events.length) {
        assert.deepEqual(C.sampleEvent(seq, i, 1), C.sampleEvent(seq, i + 1, 0));
      }
    }
  });
  test(`${mode}：任意跳转、逆序采样结果确定且不污染模型`, () => {
    const original = JSON.stringify(seq);
    const times = [0, 1.13, 4.53, 9.71, seq.duration - 0.5, seq.duration];
    const views = times.map(t => C.sample(seq, t));
    for (let i = times.length - 1; i >= 0; i--) assert.deepEqual(C.sample(seq, times[i]), views[i]);
    assert.equal(JSON.stringify(seq), original);
  });
  test(`${mode}：换位前引导、动作中分轨、动作后计数回执`, () => {
    const i = seq.events.findIndex(e => e.kind === 'swap');
    const event = seq.events[i];
    const start = C.sampleEvent(seq, i, 0.1), mid = C.sampleEvent(seq, i, 0.45);
    const end = C.sampleEvent(seq, i, 1);
    assert.ok(start.guide.alpha > 0);
    assert.equal(start.counters.swaps.text, String(event.before.swaps));
    assert.equal(mid.counters.swaps.text, String(event.before.swaps));
    assert.equal(end.counters.swaps.text, String(event.after.swaps));
    const moving = mid.items.filter(item => event.slots.includes(Number(item.slot.text)));
    assert.equal(moving.length, 2);
    assert.notEqual(moving[0].array.y, moving[1].array.y);
    assert.equal(mid.tag.alpha, 0, '旧浮标在移动前退场，避免遮挡交换路径');
    for (const movingItem of moving) for (const fixed of mid.items.filter(item => !moving.includes(item))) {
      assert.ok(Math.abs(movingItem.array.x - fixed.array.x) >= 70 || Math.abs(movingItem.array.y - fixed.array.y) >= 56,
        '移动数组芯片不遮住静止芯片');
    }
    assert.equal(end.guide.alpha, 0);
    for (const id of event.slots.map(slot => event.after.order[slot])) {
      const item = end.items.find(it => it.id === id);
      assert.deepEqual(item.array, C.arrayPoint(event.after.order.indexOf(id), seq.items.length));
    }
  });
  test(`${mode}：层序放入从数组映射到树，未放入项不显示也不锁定`, () => {
    const initial = C.sample(seq, 0);
    assert.ok(initial.items.every(item => item.tree.alpha === 0 && item.locked === 0));
    const i = seq.events.findIndex(event => event.kind === 'place' && event.slots[0] === 2);
    const start = C.sampleEvent(seq, i, 0), mid = C.sampleEvent(seq, i, 0.45), end = C.sampleEvent(seq, i, 1);
    assert.equal(start.items[2].tree.alpha, 0);
    assert.ok(mid.items[2].tree.alpha > 0 && mid.items[2].tree.alpha < 1);
    assert.deepEqual(end.items[2].tree, { ...C.treePoint(2), alpha: 1 });
    assert.deepEqual(mid.items[2].array, C.arrayPoint(2, seq.items.length));
    assert.equal(end.items.filter(item => item.tree.alpha === 1).length, 3);
    assert.ok(end.items.every(item => item.locked === 0));
    assert.equal(end.edges.filter(edge => edge.alpha === 1).length, 2);
  });
  test(`${mode}：所有交换步内双方都有独立映射，完成结果最后揭示`, () => {
    seq.events.forEach((event, i) => {
      if (event.kind !== 'swap' && event.kind !== 'exchange') return;
      for (const p of [0.2, 0.45, 0.69, 1]) {
        const frame = C.sampleEvent(seq, i, p);
        for (const slot of event.slots) {
          const id = event.before.order[slot];
          assert.equal(frame.items.find(item => item.id === id).mapping, 1);
        }
      }
    });
    const last = seq.events.length - 1;
    assert.equal(C.sampleEvent(seq, last, 0.5).completed, 0);
    assert.equal(C.sampleEvent(seq, last, 1).completed, 1);
  });
  test(`${mode}：收缩活动堆时树节点渐隐、数组身份不变`, () => {
    const i = seq.events.findIndex(e => e.kind === 'shrink');
    const event = seq.events[i], n = seq.items.length;
    const old = C.sampleEvent(seq, i, 0), mid = C.sampleEvent(seq, i, 0.45), end = C.sampleEvent(seq, i, 1);
    assert.ok(mid.heap < old.heap && mid.heap > end.heap);
    const id = event.before.order[event.before.heapSize - 1];
    const item = mid.items.find(it => it.id === id);
    assert.ok(item.tree.alpha > 0 && item.tree.alpha < 1);
    assert.deepEqual(item.array, C.arrayPoint(event.before.heapSize - 1, n));
    assert.equal(end.items.find(it => it.id === id).tree.alpha, 0);
    assert.equal(end.items.find(it => it.id === id).locked, 1);
  });
  test(`${mode}：减少动效直接展示该步终态，越界时刻钳位`, () => {
    assert.deepEqual(C.sample(seq, 1.45, true), C.sampleEvent(seq, 1, 1));
    assert.deepEqual(C.sample(seq, -3), C.snapshot(seq, seq.initial));
    assert.deepEqual(C.sample(seq, Infinity), C.sample(seq, seq.duration));
    assert.deepEqual(C.sample(seq, NaN), C.sample(seq, 0));
  });
}
test('单元素与重值仍有唯一、有限的坐标', () => {
  for (const values of [[9], [5, 5, 5, 5, 5, 5, 5]]) {
    const seq = M.buildSequence(values);
    for (let t = 0; t <= seq.duration; t += 0.19) {
      const frame = C.sample(seq, t);
      assert.equal(new Set(frame.items.map(item => item.id)).size, values.length);
      for (const item of frame.items) for (const p of [item.tree, item.array]) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      }
    }
  }
});
