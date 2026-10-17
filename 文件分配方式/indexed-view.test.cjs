const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const { layout } = require('./indexed-view.js');
test('完整索引树：1..15块、1..3级的节点不重叠且不越界', () => {
  for (let length = 1; length <= 15; length++) for (let level = 1; level <= 3; level++) {
    const seq = M.build({ mode: 'indexed', length, level });
    const geo = layout(seq), nodes = Object.values(geo.blocks);
    assert.equal(nodes.length, seq.blocks.length + seq.indexBlocks.length);
    for (const n of nodes) {
      assert.ok(n.x >= 0 && n.x + n.w <= 1100);
      assert.ok(n.y >= 65 && n.y + n.h < geo.bottom);
      assert.ok(geo.bottom + 171 < geo.height);
      if (n.kind === 'index') assert.ok(n.y + 48 + n.entries.length * 36 < n.y + n.h);
    }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${length}/${level}: ${a.block} overlaps ${b.block}`);
    }
  }
});
test('从根到叶层级向右排列，数据块逻辑次序从上到下', () => {
  for (let level = 1; level <= 3; level++) {
    const seq = M.build({ mode: 'indexed', length: 15, level });
    const geo = layout(seq);
    for (const node of seq.indexNodes) for (const entry of node.entries) {
      assert.ok(geo.blocks[node.block].x + geo.blocks[node.block].w < geo.blocks[entry.target].x);
    }
    for (let i = 1; i < seq.blocks.length; i++) assert.ok(geo.blocks[seq.blocks[i]].y > geo.blocks[seq.blocks[i - 1]].y);
  }
});
