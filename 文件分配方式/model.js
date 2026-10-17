/* Time-indexed completed snapshots and continuous actions; no DOM or timers. */
(function (root) {
  'use strict';
  const MODES = ['contiguous', 'implicit', 'fat', 'indexed'];
  const scattered = [8, 13, 2, 19, 7, 22, 28, 33, 35, 15, 21, 26, 4, 17, 24];
  const disk = block => ({ type: 'disk', block });
  const entryKey = (block, slot) => `${block}:${slot}`;
  function makeIndex(blocks, level, k) {
    const dataEntries = blocks.map((target, i) => ({ target, kind: 'data', start: i, end: i }));
    const group = entries => Array.from({ length: Math.ceil(entries.length / 3) }, (_, i) => ({
      children: entries.slice(i * 3, i * 3 + 3), kind: 'index',
      start: entries[i * 3].start, end: entries[Math.min(i * 3 + 2, entries.length - 1)].end
    }));
    // Three is a demonstration grouping, not the physical capacity of an index block.
    let children = dataEntries;
    for (let depth = 1; depth < level; depth++) children = group(children);
    const root = { children, depth: 1, start: 0, end: blocks.length - 1 };
    const available = [...Array.from({ length: 10 }, (_, i) => 30 + i), ...Array.from({ length: 30 }, (_, i) => i)].filter(b => !blocks.includes(b));
    const queue = [root], nodes = [];
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      node.block = available[i]; nodes.push(node);
      for (const child of node.children) if (child.kind === 'index') {
        child.depth = node.depth + 1; queue.push(child);
      }
    }
    const indexNodes = nodes.map(node => ({ block: node.block, depth: node.depth, start: node.start, end: node.end,
      entries: node.children.map((child, slot) => ({ slot, target: child.kind === 'index' ? child.block : child.target, kind: child.kind, start: child.start, end: child.end })) }));
    const indexPath = [];
    let node = indexNodes[0];
    while (node) {
      const entry = node.entries.find(e => e.start <= k && k <= e.end);
      indexPath.push({ block: node.block, depth: node.depth, ...entry });
      node = entry.kind === 'index' ? indexNodes.find(n => n.block === entry.target) : null;
    }
    return { indexNodes, indexPath };
  }
  function build({ mode = 'contiguous', operation = 'access', length = 5, k = Math.min(3, length - 1), level = 1, file = 'A' } = {}) {
    if (!MODES.includes(mode) || !['access', 'create', 'delete', 'feature'].includes(operation) ||
        !Number.isInteger(length) || length < 1 || length > 15 || !Number.isInteger(k) || k < 0 || k >= length ||
        !Number.isInteger(level) || level < 1 || level > 3 || !['A', 'B', 'C'].includes(file)) throw new RangeError('无效的文件分配参数');
    const fragmented = operation === 'feature' && mode === 'contiguous';
    const blocks = mode === 'contiguous' ? Array.from({ length }, (_, i) => (fragmented ? 0 : 8) + i) : scattered.slice(0, length);
    const { indexNodes, indexPath } = mode === 'indexed' ? makeIndex(blocks, level, k) : { indexNodes: [], indexPath: [] };
    const indexBlocks = indexNodes.map(n => n.block);
    const all = [...indexBlocks, ...blocks];
    let allocated = operation === 'create' ? [] : fragmented ? Array.from({ length: 13 }, (_, i) => i * 3 + 2) : [...all];
    let io = 0, memory = 0, visited = [], revealed = [], wired = operation === 'create' ? [] : [...all];
    let written = operation === 'create' ? [] : indexNodes.flatMap(n => n.entries.map(e => entryKey(n.block, e.slot)));
    let directory = operation !== 'create' && !fragmented;
    let cursor = { type: 'directory' }, focus = 0, at = 0;
    const events = [];
    function add(title, note, kind, seconds, options = {}, commit = () => {}) {
      const from = { ...cursor }, to = options.to || from;
      const start = at;
      at = Number((at + seconds).toFixed(4));
      commit();
      cursor = { ...to }; focus = options.focus ?? focus;
      const completedNote = kind === 'read' ? `物理块${options.block}已读完，累计读盘${io}次。`
        : kind === 'transfer' ? `地址${options.block}已抵达；下一动作才开始读盘。`
        : kind === 'memory' ? `内存查表完成，累计${memory}次；未增加磁盘读取。`
        : kind === 'calculate' ? fragmented ? '连续空间检查完成，接下来决定是否分配。' : `地址计算完成：8 + ${k} = ${blocks[k]}。`
        : kind === 'allocate' ? `物理块${options.block}已分配，占用已落定。`
        : kind === 'free' ? `物理块${options.block}已释放，可重新分配。`
        : kind === 'wire' ? '寻址表项已写入，目录尚未登记。' : note;
      events.push({ title, note: completedNote, during: note, kind, start, at, from, to: { ...to }, cursor: { ...cursor }, focus,
        block: options.block ?? null, logical: options.logical ?? null, slot: options.slot ?? null, target: options.target ?? null, effect: options.effect || '',
        io, memory, directory, allocated: [...allocated], visited: [...visited], revealed: [...revealed], wired: [...wired], written: [...written] });
    }
    add(fragmented ? '碎片布局' : operation === 'create' ? '空闲磁盘' : '目录就绪',
      fragmented ? '空闲27块，但最长连续空闲区只有2块。' : operation === 'create' ? '先选择空闲块，分配完成后再登记目录。' : '目录已在内存；从入口地址发起寻址。', 'ready', 0);
    function transfer(block, logical = null) {
      add('传递地址', `把物理地址${block}送到磁盘，尚未发生读取。`, 'transfer', .85, { to: disk(block), block, logical, focus: logical ?? focus });
    }
    function read(block, logical = null, isIndex = false) {
      transfer(block, logical);
      add(isIndex ? '读取索引块' : `读取逻辑块 ${logical}`, `正在读取物理块${block}；读完才累计一次磁盘I/O。`, 'read', 1.15,
        { block, logical }, () => { io++; visited.push(block); });
    }
    function reveal(block, next, logical = null, broken = false, slot = null) {
      add(broken ? '后继不可达' : slot !== null ? '选中索引表项' : '显露后继地址', broken ? '块13已读出，但next损坏；后继数据仍保留。' : slot !== null ? `块${block}的表项${slot}存着块号${next}，沿此项继续。` : `读完物理块${block}，现在才能取出后继地址${next}。`, broken ? 'error' : 'reveal', .7,
        { block, logical, slot, target: next, effect: broken ? 'broken' : 'pointer', ...(slot !== null ? { to: { type: 'entry', block, slot } } : {}) }, () => revealed.push(block));
    }
    if (fragmented) {
      add('检查连续空间', `申请${length}块，先检查最长连续空闲区。`, 'calculate', 1.2, { to: { type: 'formula' } });
      if (length > 2) add('分配失败', '空闲总量足够，但连续空间不足；没有占用新块。', 'error', .8, { effect: 'fragment' });
      else {
        for (const b of blocks) add('候选块落定', `选中空闲块${b}，分配结束后才改变归属。`, 'allocate', 1.2,
          { block: b, logical: b, to: disk(b), focus: b }, () => allocated.push(b));
        add('分配成功', `${length}个连续空闲块已分配，最后登记目录。`, 'done', .8,
          { to: { type: 'directory' }, effect: 'register' }, () => { directory = true; });
      }
    } else if (operation === 'create') {
      for (const b of all) {
        const logical = blocks.indexOf(b);
        add(indexBlocks.includes(b) ? '分配索引块' : `分配逻辑块 ${logical}`, `候选物理块${b}：地址到达后，填充逐渐落定。`, 'allocate', 1.2,
          { block: b, logical: logical < 0 ? null : logical, to: disk(b), focus: Math.max(0, logical) }, () => allocated.push(b));
      }
      if (mode === 'indexed') for (const node of indexNodes.slice().reverse()) for (const entry of node.entries) {
        add('写入索引表项', `块${node.block}的表项${entry.slot}写入块号${entry.target}，接通分支。`, 'wire', .75,
          { block: node.block, slot: entry.slot, target: entry.target, to: { type: 'entry', block: node.block, slot: entry.slot } }, () => {
            written.push(entryKey(node.block, entry.slot));
            if (node.entries.every(e => written.includes(entryKey(node.block, e.slot)))) wired.push(node.block);
          });
      }
      const metadata = mode === 'indexed' || mode === 'contiguous' ? [] : blocks;
      for (const b of metadata) {
        const logical = blocks.indexOf(b);
        const to = mode === 'fat' ? { type: 'fat', block: b } : disk(b);
        add(mode === 'fat' ? '写入 FAT 表项' : mode === 'indexed' ? '写入索引表项' : '写入块内 next',
          `块归属已落定；现在写入${mode === 'fat' ? '内存FAT' : mode === 'indexed' ? '索引' : '块内指针'}。`, 'wire', .75,
          { block: b, logical: logical < 0 ? null : logical, to, focus: Math.max(0, logical) }, () => wired.push(b));
      }
      add('登记目录', '空间和寻址结构已就绪，最后登记文件目录。', 'done', .9,
        { to: { type: 'directory' }, effect: 'register' }, () => { directory = true; });
    } else if (operation === 'delete') {
      add('定位文件空间', '目录与寻址结构给出所属块，接下来逐块回收。', 'locate', .9, { to: mode === 'contiguous' ? { type: 'formula' } : mode === 'fat' ? { type: 'fat', block: blocks[0] } : disk(indexBlocks[0] ?? blocks[0]) });
      for (const b of [...blocks, ...indexBlocks.slice().reverse()]) {
        const logical = blocks.indexOf(b);
        add('释放物理块', `定位物理块${b}，清空占用后才归还空闲区。`, 'free', 1.05,
          { block: b, logical: logical < 0 ? null : logical, to: disk(b), focus: Math.max(0, logical) }, () => {
            allocated = allocated.filter(v => v !== b);
            wired = wired.filter(v => v !== b);
            const removed = indexNodes.flatMap(n => n.entries.filter(e => n.block === b || e.target === b).map(e => entryKey(n.block, e.slot)));
            written = written.filter(key => !removed.includes(key));
          });
      }
      add('清除目录', '所有块已释放，最后移除目录项。', 'done', .9,
        { to: { type: 'directory' }, effect: 'unregister' }, () => { directory = false; });
    } else {
      if (mode === 'contiguous') {
        add('计算地址', `起始地址8与逻辑块${k}进入算式，得到${blocks[k]}。`, 'calculate', 1.25,
          { to: { type: 'formula' }, logical: k, focus: k });
        read(blocks[k], k);
      } else if (mode === 'implicit') {
        for (let i = 0; i <= k; i++) {
          read(blocks[i], i);
          if (i < k) {
            const broken = operation === 'feature' && i === 1;
            reveal(blocks[i], blocks[i + 1], i, broken);
            if (broken) return finish();
          }
        }
      } else if (mode === 'fat') {
        // Directory supplies the first block; each lookup finds one successor in RAM.
        for (let i = 0; i < k; i++) {
          add('内存查表', `FAT[${blocks[i]}] = ${blocks[i + 1]}，地址只在内存中接力。`, 'memory', .65,
            { to: { type: 'fat', block: blocks[i + 1] }, block: blocks[i], logical: i, focus: i + 1 }, () => { memory++; });
        }
        if (k === 0) add('取得首块地址', '目标就是首块，无需遍历FAT后继表项。', 'locate', .55,
          { to: { type: 'fat', block: blocks[0] }, block: blocks[0], focus: 0 });
        read(blocks[k], k);
      } else {
        indexPath.forEach(entry => {
          read(entry.block, null, true);
          reveal(entry.block, entry.target, null, false, entry.slot);
        });
        read(blocks[k], k);
      }
      add('访问完成', `逻辑块${k} → 物理块${blocks[k]}；累计读盘${io}次。`, 'done', .45, { block: blocks[k], logical: k });
    }
    return finish();
    function finish() {
      return { mode, operation, length, k, level, file, blocks, indexBlocks, indexNodes, indexPath, groupSize: 3, events, duration: at };
    }
  }
  function sample(sequence, t) {
    const time = Number.isNaN(Number(t)) ? 0 : Math.max(0, Math.min(sequence.duration, Number(t)));
    let index = 0;
    while (index + 1 < sequence.events.length && sequence.events[index + 1].at <= time) index++;
    const event = sequence.events[index], action = sequence.events[index + 1] || null;
    const progress = action ? Math.max(0, Math.min(1, (time - action.start) / (action.at - action.start))) : 1;
    return { event, action, index, progress, time, focus: action ? event.focus + (action.focus - event.focus) * progress : event.focus };
  }
  const api = { MODES, build, sample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AllocationModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
