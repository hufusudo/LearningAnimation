const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('./model.js');

const hard = model.simulate('hard');
const soft = model.simulate('soft');
const summary = (run, k) => model.summarize(run.states[k]);

// 每一步之后都要成立的文件系统不变量
function assertConsistent(fs) {
  const refs = {};
  for (const dir of Object.values(fs.inodes).filter((n) => n.type === 'dir')) {
    for (const id of Object.values(dir.entries)) {
      assert.ok(fs.inodes[id], `目录项指向不存在的 inode ${id}`);
      refs[id] = (refs[id] || 0) + 1;
    }
  }
  for (const node of Object.values(fs.inodes).filter((n) => n.type !== 'dir')) {
    assert.equal(node.nlink, refs[node.id] || 0, `inode ${node.id} 的 nlink 与目录项数不一致`);
    for (const b of node.blocks) {
      assert.ok(fs.blocks[b], `inode ${node.id} 引用了不存在的盘块 ${b}`);
      assert.equal(fs.blocks[b].owner, node.id);
    }
  }
  for (const block of Object.values(fs.blocks)) {
    assert.ok(fs.inodes[block.owner], `盘块 ${block.id} 的属主不存在`);
    assert.ok(fs.inodes[block.owner].blocks.includes(block.id), `盘块 ${block.id} 未被属主引用`);
  }
}

test('初始状态：report.txt → inode 10 → 盘块 5，两侧都只有一个能读到数据的名字', () => {
  const fs = model.createFs();
  assert.equal(fs.inodes[4].entries['report.txt'], 10);
  assert.equal(fs.inodes[10].nlink, 1);
  assert.deepEqual(fs.inodes[10].blocks, [5]);
  assert.equal(fs.blocks[5].data, 'Hello');
  assert.deepEqual(summary(hard, 0), { names: ['report.txt'], readable: ['report.txt'], dangling: [], inodes: 1, blocks: 1 });
  assert.deepEqual(summary(soft, 0), summary(hard, 0));
});

test('硬链接只新增一条目录项：不新建 inode，不占盘块，nlink 由 1 变为 2', () => {
  assert.deepEqual(hard.facts[0], { inode: 10, nlinkBefore: 1, nlinkAfter: 2 });
  assert.deepEqual(summary(hard, 1), {
    names: ['report.txt', 'report-hard'],
    readable: ['report.txt', 'report-hard'],
    dangling: [],
    inodes: 1,
    blocks: 1
  });
});

test('软链接新建 inode 与盘块，盘块里存的是目标路径，原文件 nlink 不变', () => {
  assert.deepEqual(soft.facts[0], { inode: 20, block: 6, target: model.TARGET });
  assert.equal(soft.states[1].blocks[6].data, '/home/user/report.txt');
  assert.equal(soft.states[1].inodes[10].nlink, 1);
  assert.deepEqual(summary(soft, 1), {
    names: ['report.txt', 'report-soft'],
    readable: ['report.txt', 'report-soft'],
    dangling: [],
    inodes: 2,
    blocks: 2
  });
});

test('访问软链接：先读出路径，再从根逐段解析到 report.txt，最后读出 Hello', () => {
  const r = model.open(soft.states[1], 'report-soft');
  assert.equal(r.ok, true);
  assert.equal(r.content, 'Hello');
  assert.deepEqual(r.steps.map((s) => s.kind), ['entry', 'readlink', 'walk', 'walk', 'walk', 'walk', 'read']);
  assert.deepEqual(r.steps.filter((s) => s.kind === 'walk').map((s) => s.name), ['/', 'home', 'user', 'report.txt']);
  assert.deepEqual(r.steps.filter((s) => s.kind === 'walk').map((s) => s.inode), [2, 3, 4, 10]);
});

test('访问硬链接：目录项直接指向 inode，无需读路径', () => {
  const r = model.open(hard.states[1], 'report-hard');
  assert.deepEqual(r.steps.map((s) => s.kind), ['entry', 'read']);
  assert.equal(r.content, 'Hello');
});

test('删除原文件：硬链接的 inode 与盘块保留、仍可读；软链接的目标被释放、变为悬空', () => {
  assert.deepEqual(hard.facts[2], {
    name: 'report.txt', inode: 10, nlinkBefore: 2, nlinkAfter: 1, freedInode: null, freedBlocks: []
  });
  assert.deepEqual(summary(hard, 3), { names: ['report-hard'], readable: ['report-hard'], dangling: [], inodes: 1, blocks: 1 });
  assert.deepEqual(soft.facts[2], {
    name: 'report.txt', inode: 10, nlinkBefore: 1, nlinkAfter: 0, freedInode: 10, freedBlocks: [5]
  });
  assert.deepEqual(summary(soft, 3), { names: ['report-soft'], readable: [], dangling: ['report-soft'], inodes: 1, blocks: 1 });
});

test('悬空的软链接再次访问时，停在缺失的 report.txt 上', () => {
  const r = soft.facts[3];
  assert.equal(r.ok, false);
  assert.deepEqual(r.steps.at(-1), { kind: 'miss', name: 'report.txt' });
});

test('删除最后一个名字：硬链接 nlink 归零才释放 inode 与盘块；软链接只释放自身', () => {
  assert.deepEqual(hard.facts[4], {
    name: 'report-hard', inode: 10, nlinkBefore: 1, nlinkAfter: 0, freedInode: 10, freedBlocks: [5]
  });
  assert.deepEqual(summary(hard, 5), { names: [], readable: [], dangling: [], inodes: 0, blocks: 0 });
  assert.deepEqual(soft.facts[4], {
    name: 'report-soft', inode: 20, nlinkBefore: 1, nlinkAfter: 0, freedInode: 20, freedBlocks: [6]
  });
  assert.deepEqual(summary(soft, 5), { names: [], readable: [], dangling: [], inodes: 0, blocks: 0 });
});

test('删除软链接不影响目标：原文件、inode 与盘块都还在', () => {
  const fs = model.unlink(model.symlink(model.createFs(), 'report-soft', model.TARGET).fs, 'report-soft').fs;
  assert.deepEqual(model.summarize(fs), { names: ['report.txt'], readable: ['report.txt'], dangling: [], inodes: 1, blocks: 1 });
  assert.equal(fs.inodes[10].nlink, 1);
});

test('每一步之后文件系统的不变量都成立', () => {
  for (const run of [hard, soft]) run.states.forEach(assertConsistent);
});

test('非法操作直接报错，不会悄悄改坏状态', () => {
  const fs = model.createFs();
  assert.throws(() => model.link(fs, 'report.txt', 'report.txt'), /已存在/);
  assert.throws(() => model.unlink(fs, 'nope'), /不存在/);
  assert.deepEqual(model.summarize(fs).names, ['report.txt']);
});

test('剧本长度：6 个状态与 5 条操作事实', () => {
  assert.equal(hard.states.length, 6);
  assert.equal(soft.facts.length, 5);
});
