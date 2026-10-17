const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const end = s => s.events.at(-1);
test('访问每个逻辑块，四种方式的读取成本及FAT查表次数', () => {
  for (let length = 1; length <= 15; length++) for (let k = 0; k < length; k++) {
    for (const mode of M.MODES) for (let level = 1; level <= 3; level++) {
      const s = M.build({ mode, length, k, level });
      assert.equal(end(s).io, mode === 'implicit' ? k + 1 : mode === 'indexed' ? level + 1 : 1);
      assert.equal(end(s).memory, mode === 'fat' ? k : 0);
      assert.equal(end(s).block, s.blocks[k]);
      assert.equal(new Set([...s.blocks, ...s.indexBlocks]).size, s.blocks.length + s.indexBlocks.length);
    }
  }
});
test('创建和删除可由事件重建，所有占用及计数有效', () => {
  for (const mode of M.MODES) for (const operation of ['create', 'delete']) {
    const s = M.build({ mode, operation, level: 3 });
    assert.equal(end(s).allocated.length, operation === 'delete' ? 0 : s.blocks.length + s.indexBlocks.length);
    assert.ok(s.events.every(e => e.io === 0 && e.allocated.every(b => b >= 0 && b < 40)));
    assert.equal(s.duration, s.events.at(-1).at);
  }
});
test('碎片边界：空闲27但最长2；小请求仍可分配', () => {
  const fail = M.build({ operation: 'feature' });
  assert.equal(end(fail).kind, 'error');
  assert.equal(end(fail).allocated.length, 13);
  for (const length of [1, 2]) {
    const s = M.build({ operation: 'feature', length, k: 0 });
    assert.equal(end(s).kind, 'done');
    assert.equal(end(s).allocated.length, 13 + length);
  }
});
test('损坏指针不影响读取损坏块本身，只阻止后续寻址', () => {
  for (const k of [0, 1, 2, 3, 4]) {
    const s = M.build({ mode: 'implicit', operation: 'feature', k });
    assert.equal(end(s).kind, k <= 1 ? 'done' : 'error');
    assert.equal(end(s).io, Math.min(k + 1, 2));
  }
});
test('输入校验拒绝非法状态', () => {
  for (const options of [{ mode: 'bad' }, { length: 0 }, { length: 16 }, { length: 2, k: 3 }, { k: -1 }, { level: 4 }, { file: 'X' }, { operation: 'bad' }, { k: NaN }, { length: 2.5 }]) assert.throws(() => M.build(options), RangeError);
});
test('sample钳制、倒退、分数时刻和确定性', () => {
  const s = M.build({ mode: 'implicit' });
  assert.equal(M.sample(s, -1).index, 0);
  assert.equal(M.sample(s, NaN).index, 0);
  assert.equal(M.sample(s, Infinity).index, s.events.length - 1);
  assert.equal(M.sample(s, 1000).index, s.events.length - 1);
  const first = s.events[1];
  assert.ok(Math.abs(M.sample(s, first.at / 2).progress - .5) < 1e-8);
  const snapshot = JSON.stringify(M.sample(s, 2));
  M.sample(s, s.duration);
  assert.equal(JSON.stringify(M.sample(s, 2)), snapshot);
  assert.deepEqual(s, M.build({ mode: 'implicit' }));
  assert.notEqual(s.events[0].allocated, s.events[1].allocated);
});
test('每个读取动作完成前不增加IO，不提前揭示指针', () => {
  for (const mode of M.MODES) {
    const s = M.build({ mode, level: 3 });
    for (let i = 1; i < s.events.length; i++) {
      const action = s.events[i], before = s.events[i - 1];
      const middle = M.sample(s, (before.at + action.at) / 2);
      assert.equal(middle.event.io, before.io);
      assert.deepEqual(middle.event.revealed, before.revealed);
      assert.equal(middle.action, action);
      assert.ok(middle.progress > 0 && middle.progress < 1);
      assert.equal(M.sample(s, action.at).event, action);
      if (action.kind === 'read') {
        assert.match(action.note, /已读完/);
        assert.match(action.during, /正在读取/);
        assert.equal(action.io, before.io + 1);
        assert.equal(before.kind, 'transfer');
        assert.deepEqual(action.revealed, before.revealed);
      }
      if (action.kind === 'reveal') assert.equal(before.kind, 'read');
    }
  }
});
test('创建先预选再占用、写指针后登记目录，删除最后清目录', () => {
  for (const mode of M.MODES) {
    const s = M.build({ mode, operation: 'create', level: 3 });
    assert.equal(s.events[0].directory, false);
    assert.equal(end(s).directory, true);
    for (let i = 1; i < s.events.length; i++) {
      const action = s.events[i], before = s.events[i - 1];
      assert.deepEqual(M.sample(s, action.at - .001).event.allocated, before.allocated);
      if (action.kind === 'allocate') {
        assert.equal(before.allocated.includes(action.block), false);
        assert.equal(action.allocated.includes(action.block), true);
      }
      if (action.kind === 'wire') assert.equal(action.allocated.length, s.blocks.length + s.indexBlocks.length);
    }
    const d = M.build({ mode, operation: 'delete', level: 3 });
    assert.ok(d.events.slice(0, -1).every(e => e.directory));
    assert.equal(end(d).directory, false);
    assert.deepEqual(end(d).wired, []);
  }
});
test('动作之间沿真实地址接力，不跳回目录', () => {
  for (const mode of ['implicit', 'fat', 'indexed']) {
    const s = M.build({ mode, level: 3 });
    const transfers = s.events.filter(e => e.kind === 'transfer');
    if (mode === 'implicit') {
      assert.deepEqual(transfers[1].from, { type: 'disk', block: 8 });
      assert.deepEqual(transfers[1].to, { type: 'disk', block: 13 });
    }
    if (mode === 'indexed') {
      assert.deepEqual(transfers[1].from, { type: 'entry', block: 30, slot: s.indexPath[0].slot });
      assert.equal(transfers.length, s.level + 1);
    }
    if (mode === 'fat') {
      assert.ok(s.events.filter(e => e.kind === 'memory').every(e => e.to.type === 'fat'));
      assert.equal(transfers.length, 1);
      assert.equal(transfers[0].from.type, 'fat');
    }
  }
});
test('二级索引展开完整兄弟表项，按逻辑范围走正确分支', () => {
  const s = M.build({ mode: 'indexed', level: 2, k: 3 });
  assert.deepEqual(s.indexNodes.map(n => [n.block, n.entries.map(e => e.target)]), [[30, [31, 32]], [31, [8, 13, 2]], [32, [19, 7]]]);
  assert.deepEqual(s.indexPath.map(p => [p.block, p.slot, p.target]), [[30, 1, 32], [32, 0, 19]]);
  assert.deepEqual(s.events.filter(e => e.kind === 'read').map(e => e.block), [30, 32, 19]);
  assert.ok(!end(s).visited.includes(31));
});
test('1..15块的各级索引：所有表项可达、分支不重叠、路径正确', () => {
  for (let length = 1; length <= 15; length++) for (let level = 1; level <= 3; level++) {
    const s = M.build({ mode: 'indexed', length, level });
    assert.equal(s.indexNodes.length, s.indexBlocks.length);
    for (const node of s.indexNodes) for (const entry of node.entries) {
      assert.ok(entry.start <= entry.end);
      assert.ok(entry.start >= 0 && entry.end < length);
      if (entry.kind === 'index') assert.ok(s.indexNodes.some(n => n.block === entry.target && n.depth === node.depth + 1));
      else assert.equal(s.blocks[entry.start], entry.target);
    }
    const leafEntries = s.indexNodes.flatMap(n => n.entries).filter(e => e.kind === 'data');
    assert.deepEqual(leafEntries.map(e => e.target), s.blocks);
    for (let k = 0; k < length; k++) {
      const v = M.build({ mode: 'indexed', length, level, k });
      assert.equal(v.indexPath.length, level);
      assert.equal(v.indexPath.at(-1).target, v.blocks[k]);
      for (let i = 0; i < level - 1; i++) assert.equal(v.indexPath[i].target, v.indexPath[i + 1].block);
      assert.deepEqual(v.events.filter(e => e.kind === 'read').map(e => e.block), [...v.indexPath.map(p => p.block), v.blocks[k]]);
    }
  }
});
test('索引创建逐个写表项，删除清除所有索引指针', () => {
  const s = M.build({ mode: 'indexed', level: 3, length: 15, operation: 'create' });
  const entries = s.indexNodes.flatMap(n => n.entries);
  const writes = s.events.filter(e => e.kind === 'wire');
  assert.equal(writes.length, entries.length);
  assert.equal(s.events[0].written.length, 0);
  writes.forEach((e, i) => assert.equal(e.written.length, i + 1));
  assert.equal(end(s).written.length, entries.length);
  const d = M.build({ mode: 'indexed', level: 3, length: 15, operation: 'delete' });
  assert.deepEqual(end(d).written, []);
  assert.deepEqual(end(d).allocated, []);
});
test('任意动作边界的取样连续、结束计数单调，无快照污染', () => {
  for (const operation of ['access', 'create', 'delete', 'feature']) for (const mode of M.MODES) {
    const s = M.build({ mode, operation });
    for (let i = 1; i < s.events.length; i++) {
      const e = s.events[i];
      assert.ok(e.at > s.events[i - 1].at);
      assert.equal(M.sample(s, e.at).event.io, e.io);
      assert.equal(M.sample(s, e.at - 1e-5).event.io, s.events[i - 1].io);
    }
  }
});
