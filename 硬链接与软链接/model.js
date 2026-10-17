/**
 * 硬链接与软链接的极简文件系统模型。界面只读取这里算好的状态，渲染时不做任何文件系统判断。
 * 一套文件系统只含 / → home → user 三层目录，足以演示路径解析；两侧各持一套，执行同一剧本。
 * 编号沿用 ext 家族的惯例：根目录为 inode 2；新分配的 inode 与盘块顺序取号，示意不演示回收后的复用。
 */
(function (root) {
  'use strict';

  const ROOT = 2;
  const HOME = 3;
  const USER = 4;
  const ORIGINAL = 10;
  const TARGET = '/home/user/report.txt';
  const CONTENT = 'Hello';
  const DIR = 'dir';
  const FILE = 'file';
  const LINK = 'link';

  // 初始状态：/ → home → user → report.txt（inode 10，盘块 5）
  function createFs() {
    return {
      inodes: {
        [ROOT]: { id: ROOT, type: DIR, entries: { home: HOME } },
        [HOME]: { id: HOME, type: DIR, entries: { user: USER } },
        [USER]: { id: USER, type: DIR, entries: { 'report.txt': ORIGINAL } },
        [ORIGINAL]: { id: ORIGINAL, type: FILE, nlink: 1, blocks: [5] }
      },
      blocks: { 5: { id: 5, owner: ORIGINAL, data: CONTENT } },
      nextInode: 20,
      nextBlock: 6
    };
  }

  const clone = (fs) => JSON.parse(JSON.stringify(fs));

  // 硬链接：只新增一条指向已有 inode 的目录项，nlink 加 1，不分配 inode，也不占盘块
  function link(fs, existing, name) {
    const next = clone(fs);
    const dir = next.inodes[USER];
    const id = dir.entries[existing];
    if (id === undefined) throw new Error(`${existing} 不存在`);
    if (dir.entries[name] !== undefined) throw new Error(`${name} 已存在`);
    const node = next.inodes[id];
    if (node.type !== FILE) throw new Error('只能对普通文件建立硬链接');
    const nlinkBefore = node.nlink;
    node.nlink += 1;
    dir.entries[name] = id;
    return { fs: next, facts: { inode: id, nlinkBefore, nlinkAfter: node.nlink } };
  }

  // 软链接：分配新 inode 与盘块，盘块里写入目标路径，再新增一条目录项指向它
  function symlink(fs, name, target) {
    const next = clone(fs);
    const dir = next.inodes[USER];
    if (dir.entries[name] !== undefined) throw new Error(`${name} 已存在`);
    const inode = next.nextInode++;
    const block = next.nextBlock++;
    next.blocks[block] = { id: block, owner: inode, data: target };
    next.inodes[inode] = { id: inode, type: LINK, nlink: 1, blocks: [block] };
    dir.entries[name] = inode;
    return { fs: next, facts: { inode, block, target } };
  }

  // 删除一条目录项：nlink 减 1；只有减到 0（再没有名字指向它）才释放 inode 与盘块
  function unlink(fs, name) {
    const next = clone(fs);
    const dir = next.inodes[USER];
    const id = dir.entries[name];
    if (id === undefined) throw new Error(`${name} 不存在`);
    delete dir.entries[name];
    const node = next.inodes[id];
    const nlinkBefore = node.nlink;
    node.nlink -= 1;
    const facts = { name, inode: id, nlinkBefore, nlinkAfter: node.nlink, freedInode: null, freedBlocks: [] };
    if (node.nlink === 0) {
      facts.freedInode = id;
      facts.freedBlocks = [...node.blocks];
      for (const b of node.blocks) delete next.blocks[b];
      delete next.inodes[id];
    }
    return { fs: next, facts };
  }

  // 沿绝对路径逐段查目录项，记录每一段访问到的 inode；缺失时停在那一段
  function walk(fs, path) {
    const steps = [{ kind: 'walk', name: '/', inode: ROOT }];
    let inode = ROOT;
    for (const name of path.split('/').filter(Boolean)) {
      const dir = fs.inodes[inode];
      const child = dir && dir.type === DIR ? dir.entries[name] : undefined;
      if (child === undefined) {
        steps.push({ kind: 'miss', name });
        return { ok: false, inode: null, steps };
      }
      inode = child;
      steps.push({ kind: 'walk', name, inode });
    }
    return { ok: true, inode, steps };
  }

  // 读取普通文件的数据块
  function readFile(fs, id, steps) {
    const node = fs.inodes[id];
    if (node.type !== FILE) throw new Error('示意只支持跟随一层符号链接');
    const block = node.blocks[0];
    const content = fs.blocks[block].data;
    steps.push({ kind: 'read', inode: id, block, content });
    return { ok: true, content, steps };
  }

  // 打开 /home/user 下的一个名字：普通文件直接读盘块；符号链接先读出盘块中的路径，再从根重新解析
  function open(fs, name) {
    const id = fs.inodes[USER].entries[name];
    if (id === undefined) return { ok: false, content: null, steps: [{ kind: 'miss', name }] };
    const steps = [{ kind: 'entry', name, inode: id }];
    const node = fs.inodes[id];
    if (node.type === FILE) return readFile(fs, id, steps);
    if (node.type !== LINK) throw new Error(`${name} 不是文件或符号链接`);
    const block = node.blocks[0];
    const target = fs.blocks[block].data;
    steps.push({ kind: 'readlink', inode: id, block, target });
    const found = walk(fs, target);
    steps.push(...found.steps);
    if (!found.ok) return { ok: false, content: null, steps };
    return readFile(fs, found.inode, steps);
  }

  // 统计：/home/user 下有哪些名字，其中几个能读到数据、几个悬空，以及占用了多少 inode 与盘块
  function summarize(fs) {
    const names = Object.keys(fs.inodes[USER].entries);
    const readable = names.filter((name) => open(fs, name).ok);
    const dangling = names.filter((name) => !open(fs, name).ok);
    const inodes = Object.values(fs.inodes).filter((n) => n.type !== DIR).length;
    return { names, readable, dangling, inodes, blocks: Object.keys(fs.blocks).length };
  }

  // 同一剧本在两侧执行：① 建立链接 ② 访问 ③ 删除原文件 ④ 再次访问 ⑤ 删除链接
  const SCRIPT = {
    hard: [
      (fs) => link(fs, 'report.txt', 'report-hard'),
      (fs) => ({ fs, facts: open(fs, 'report-hard') }),
      (fs) => unlink(fs, 'report.txt'),
      (fs) => ({ fs, facts: open(fs, 'report-hard') }),
      (fs) => unlink(fs, 'report-hard')
    ],
    soft: [
      (fs) => symlink(fs, 'report-soft', TARGET),
      (fs) => ({ fs, facts: open(fs, 'report-soft') }),
      (fs) => unlink(fs, 'report.txt'),
      (fs) => ({ fs, facts: open(fs, 'report-soft') }),
      (fs) => unlink(fs, 'report-soft')
    ]
  };

  // 逐步执行剧本：states[0] 为初始状态，states[k] 为第 k 步之后的状态；facts[k - 1] 为第 k 步的事实
  function simulate(kind) {
    const states = [createFs()];
    const facts = [];
    for (const step of SCRIPT[kind]) {
      const out = step(states[states.length - 1]);
      states.push(out.fs);
      facts.push(out.facts);
    }
    return { kind, states, facts };
  }

  const api = { TARGET, CONTENT, USER, createFs, link, symlink, unlink, walk, open, summarize, simulate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LinkModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
