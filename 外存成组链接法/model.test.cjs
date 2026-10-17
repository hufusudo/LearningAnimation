const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('./model.js');

const clone = (value) => JSON.parse(JSON.stringify(value));

function assertConsistent(state, expectedTotal = 12) {
  assert.equal(state.memory.count, state.memory.free.length + 1);
  assert.ok(state.memory.count >= 1 && state.memory.count <= model.CAPACITY);
  for (const group of Object.values(state.groups)) {
    assert.equal(group.count, group.free.length + 1);
    assert.ok(group.count >= 1 && group.count <= model.CAPACITY);
  }

  const linked = model.chain(state);
  const linkedIds = linked.map((item) => item.id);
  assert.equal(new Set(linkedIds).size, linkedIds.length, '组链不能有环');
  assert.deepEqual(new Set(linkedIds), new Set(Object.keys(state.groups).map(Number)), '所有外存组均可达');

  const free = model.freeBlocks(state);
  assert.equal(new Set(free).size, free.length, '空闲盘块不能重复');
  const occupied = state.occupied;
  assert.equal(new Set(occupied).size, occupied.length, '已分配盘块不能重复');
  assert.equal(free.filter((id) => occupied.includes(id)).length, 0, '空闲与已分配互斥');
  assert.equal(free.length + occupied.length, expectedTotal, '盘块总数守恒');
}

test('默认状态含 12 个真实空闲盘块，count 包含 next 槽而不把 null 计为盘块', () => {
  const state = model.createInitial();
  assert.deepEqual(state, {
    memory: { count: 4, next: 100, free: [101, 102, 103] },
    groups: {
      100: { count: 4, next: 90, free: [91, 92, 93] },
      90: { count: 4, next: 80, free: [81, 82, 83] },
      80: { count: 1, next: null, free: [] }
    },
    occupied: []
  });
  assert.deepEqual(model.chain(state).map(({ id }) => id), [100, 90, 80]);
  assert.deepEqual(model.freeBlocks(state), [81, 82, 83, 91, 92, 93, 100, 101, 102, 103, 80, 90].sort((a, b) => a - b));
  assertConsistent(state);
});

test('默认八步操作顺序正确，回收逆过程还原初始结构', () => {
  const demo = model.buildDemo();
  assert.deepEqual(demo.operations.map(({ index }) => index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(demo.operations.map(({ action }) => action), [
    'allocate', 'allocate', 'allocate', 'allocate', 'reclaim', 'reclaim', 'reclaim', 'reclaim'
  ]);
  assert.deepEqual(demo.operations.map(({ kind, id }) => [kind, id]), [
    ['allocate-pop', 103], ['allocate-pop', 102], ['allocate-pop', 101], ['allocate-group', 100],
    ['reclaim-spill', 100], ['reclaim-push', 101], ['reclaim-push', 102], ['reclaim-push', 103]
  ]);
  assert.deepEqual(demo.final, demo.initial);
  assert.notEqual(demo.final.memory.free, demo.initial.memory.free);
  assertConsistent(demo.final);
});

test('满栈回收将原 memory 整组写入新链首，保留原 next 和其余组内容', () => {
  let state = model.createInitial();
  for (const id of [103, 102, 101, 100]) state = model.transition(state, 'allocate', id).after;
  const previousMemory = clone(state.memory);
  const previousGroups = clone(state.groups);
  const result = model.transition(state, 'reclaim', 100);

  assert.equal(result.kind, 'reclaim-spill');
  assert.deepEqual(result.after.groups[100], previousMemory);
  assert.equal(result.after.groups[100].next, previousMemory.next);
  assert.deepEqual(result.after.memory, { count: 1, next: 100, free: [] });
  assert.deepEqual(result.after.groups[90], previousGroups[90]);
  assert.deepEqual(result.after.groups[80], previousGroups[80]);
  assert.deepEqual(model.chain(result.after).map(({ id }) => id), [100, 90, 80]);
  assert.deepEqual(result.after.groups[90], model.createInitial().groups[90], '不能为了接到旧链尾而修改原组');
  assertConsistent(result.after);
});

test('分配全部 12 块直至耗尽，再回收并重新分配仍是同一集合', () => {
  const initial = model.createInitial();
  const expected = model.freeBlocks(initial);
  let state = initial;
  const allocated = [];
  while (true) {
    const operation = model.transition(state, 'allocate');
    if (!operation) break;
    allocated.push(operation.id);
    state = operation.after;
    assertConsistent(state);
  }
  assert.equal(allocated.length, 12);
  assert.deepEqual(new Set(allocated), new Set(expected));
  assert.deepEqual(model.freeBlocks(state), []);
  assert.deepEqual(state.occupied, allocated);
  assert.equal(model.transition(state, 'allocate'), null);

  for (const id of allocated) {
    const operation = model.transition(state, 'reclaim', id);
    assert.ok(operation, `应能回收 ${id}`);
    state = operation.after;
    assertConsistent(state);
  }
  assert.deepEqual(new Set(model.freeBlocks(state)), new Set(expected));
  assert.deepEqual(state.occupied, []);

  const reallocated = [];
  while (true) {
    const operation = model.transition(state, 'allocate');
    if (!operation) break;
    reallocated.push(operation.id);
    state = operation.after;
  }
  assert.equal(reallocated.length, 12);
  assert.deepEqual(new Set(reallocated), new Set(expected));
  assertConsistent(state);
});

test('支持指定任意已分配块回收；无可回收块、重复或非法目标失败', () => {
  const initial = model.createInitial();
  assert.equal(model.transition(initial, 'reclaim'), null);
  assert.equal(model.transition(initial, 'reclaim', 103), null);
  assert.equal(model.transition(initial, 'reclaim', 0), null);
  assert.equal(model.transition(initial, 'reclaim', '103'), null);
  assert.equal(model.transition(initial, 'reclaim', null), null);
  assert.equal(model.transition(initial, 'allocate', 999), null);
  assert.equal(model.transition(initial, 'allocate', '103'), null);
  assert.equal(model.transition(initial, 'unknown'), null);

  const allocated = model.transition(initial, 'allocate', 103);
  const reclaimed = model.transition(allocated.after, 'reclaim', 103);
  assert.equal(reclaimed.kind, 'reclaim-push');
  assert.deepEqual(reclaimed.after.occupied, []);
  assert.equal(model.transition(reclaimed.after, 'reclaim', 103), null);
  assert.equal(model.transition(allocated.after, 'reclaim', 101), null);

  const arbitrary = model.transition(allocated.after, 'reclaim');
  assert.equal(arbitrary.id, 103, '未指定目标时默认回收 occupied 末项');
});

test('多轮交替操作始终满足守恒、互斥、唯一性与组链可达', () => {
  let state = model.createInitial();
  for (let turn = 0; turn < 100; turn += 1) {
    let operation;
    if (turn % 3 !== 2 && model.freeBlocks(state).length > 0) {
      operation = model.transition(state, 'allocate');
    } else if (state.occupied.length > 0) {
      const target = state.occupied[turn % state.occupied.length];
      operation = model.transition(state, 'reclaim', target);
    }
    if (operation) state = operation.after;
    assertConsistent(state);
  }
});

test('transition 不修改输入；before/after 与输入及先前快照数组隔离', () => {
  const input = model.createInitial();
  const inputSnapshot = clone(input);
  const first = model.transition(input, 'allocate', 103);
  assert.deepEqual(input, inputSnapshot);
  assert.notEqual(first.before.memory.free, input.memory.free);
  assert.notEqual(first.after.memory.free, input.memory.free);
  assert.notEqual(first.before.memory.free, first.after.memory.free);

  const beforeFirst = clone(first);
  const second = model.transition(first.after, 'allocate', 102);
  assert.deepEqual(first, beforeFirst, '后续 transition 不应改写之前操作的快照');
  assert.notEqual(second.before.memory.free, first.after.memory.free);
  assert.notEqual(second.after.memory.free, first.after.memory.free);

  first.after.memory.free.push(999);
  assert.deepEqual(input, inputSnapshot, '修改结果快照不得影响调用者输入');
  assert.deepEqual(second.before.memory.free, [101, 102]);
});

test('CommonJS 与浏览器全局均导出 GroupedFreeModel API', () => {
  assert.equal(globalThis.GroupedFreeModel, model);
  const browserWindow = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('./model.js'), 'utf8'), { window: browserWindow });
  assert.deepEqual(Object.keys(browserWindow.GroupedFreeModel).sort(), Object.keys(model).sort());
  assert.deepEqual(JSON.parse(JSON.stringify(browserWindow.GroupedFreeModel.createInitial())), model.createInitial());
});
