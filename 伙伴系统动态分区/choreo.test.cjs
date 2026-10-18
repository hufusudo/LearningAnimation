const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

const run = M.buildRun();
const frame = (index, p) => C.scene(M.sampleAt(run, index, p), run);

// 比较两帧时只看“可见”的内容，并按键排序，避免数组顺序影响结果
function visible(sc) {
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return JSON.stringify({
    count: sc.count, phase: sc.phase, req: sc.req, caption: sc.caption,
    cards: sc.cards,
    bar: sc.bar.slice().sort(byKey),
    lists: sc.lists,
    tree: { nodes: sc.tree.nodes.slice().sort(byKey), edges: sc.tree.edges.slice().sort(byKey) },
    rings: sc.rings.slice().sort(byKey),
    flights: sc.flights.slice().sort(byKey),
    tags: sc.tags.slice().sort(byKey),
    xor: sc.xor.slice().sort(byKey)
  });
}

function walkNumbers(value, path, out) {
  if (typeof value === 'number') {
    out.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walkNumbers(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach((k) => walkNumbers(value[k], `${path}.${k}`, out));
  }
  return out;
}

test('数字都是有限值，透明度在 0–1 之间', () => {
  for (let i = 0; i < run.N; i++) {
    for (const p of [0, 0.2, 0.5, 0.8, 1]) {
      const sc = frame(i, p);
      for (const [path, v] of walkNumbers(sc, 'scene', [])) {
        assert.ok(Number.isFinite(v), `第 ${i} 步 p=${p} 的 ${path} 不是有限数：${v}`);
        if (/alpha$/.test(path)) assert.ok(v >= 0 && v <= 1, `${path} 超出 0–1：${v}`);
      }
    }
  }
});

test('边界无跳变：上一步 p=1 的画面与下一步 p=0 的画面相同', () => {
  for (let i = 0; i + 1 < run.N; i++) {
    assert.equal(visible(frame(i, 1)), visible(frame(i + 1, 0)), `第 ${i} 步与第 ${i + 1} 步之间有跳变`);
  }
  assert.equal(visible(frame(run.N, 1)), visible(frame(run.N - 1, 1)), '全部结束的画面与最后一步停住时相同');
});

test('起点画面：第 0 步 p=0 只有初始内存，没有引导与回执', () => {
  const sc = frame(0, 0);
  assert.equal(sc.count.text, `第 0 / ${run.N} 步`);
  assert.equal(sc.phase.text, '准备就绪');
  assert.deepEqual(sc.rings, []);
  assert.deepEqual(sc.tags, []);
  assert.deepEqual(sc.flights, []);
  assert.deepEqual(sc.bar.map((b) => [b.key, b.alpha]), [['b:0-1024', 1]]);
});

test('切分：p=0 为整块，p=1 为两半且父块已移走', () => {
  const idx = run.opStart[0] + 2;   // 第一次切分（1024 → 512 + 512）
  assert.equal(run.steps[idx].kind, 'split');
  const before = frame(idx, 0).bar.find((b) => b.key === 'b:0-1024');
  assert.equal(before.alpha, 1);
  assert.equal(before.w, 1020);
  const after = frame(idx, 1).bar;
  assert.equal(after.find((b) => b.key === 'b:0-1024'), undefined);
  const left = after.find((b) => b.key === 'b:0-512');
  const right = after.find((b) => b.key === 'b:512-512');
  assert.equal(left.alpha, 1);
  assert.equal(right.alpha, 1);
  assert.equal(right.x, C.xOf(512, 1024));
  assert.equal(right.w, C.wOf(512, 1024));
});

test('切分的中途：两半从父块位置向各自位置分开（几何过渡）', () => {
  const idx = run.opStart[0] + 2;
  const mid = frame(idx, 0.4).bar.find((b) => b.key === 'b:512-512');
  assert.ok(mid, '中途右半应当可见');
  assert.ok(mid.w > C.wOf(512, 1024) && mid.w < C.wOf(1024, 1024), '中途右半的宽度介于父块与子块之间');
});

test('合并：p=1 时两块并成一块，两个子块消失', () => {
  const idx = run.N - 4;            // 第一次合并（128 + 128）
  assert.equal(run.steps[idx].kind, 'merge');
  const sc = frame(idx, 1);
  const union = sc.bar.find((b) => b.key === 'b:0-256');
  assert.ok(union, '合并后应有 0–256 的块');
  assert.equal(union.w, C.wOf(256, 1024));
  assert.equal(sc.bar.find((b) => b.key === 'b:0-128'), undefined);
  assert.equal(sc.bar.find((b) => b.key === 'b:128-128'), undefined);
});

test('引导：外环先于变化出现，步末淡出；回执在主动作之后出现', () => {
  const idx = run.opStart[0] + 5;   // 装入 P1
  assert.equal(run.steps[idx].kind, 'place');
  assert.equal(frame(idx, 0).rings.length, 0, '步首的外环还没有出现');
  assert.ok(frame(idx, 0.1).rings.length > 0, '外环在前 18% 出现');
  assert.equal(frame(idx, 1).rings.length, 0, '步末外环已淡出');
  assert.equal(frame(idx, 0.3).tags.length, 0, '回执还没有出现');
  assert.ok(frame(idx, 1).tags.some((t) => t.text === 'P1 装入'), '步末有回执浮标');
});

test('飞行：进程卡飞入占用块，落地后芯片消失', () => {
  const idx = run.opStart[0] + 5;
  const mid = frame(idx, 0.4).flights;
  assert.equal(mid.length, 1);
  assert.equal(mid[0].text, 'P1 70K');
  assert.equal(frame(idx, 1).flights.length, 0);
});

test('链表：查找时逐行扫过；伙伴落地后在对应阶出现', () => {
  const search = run.opStart[0] + 1;
  assert.equal(run.steps[search].kind, 'search');
  const rows = frame(search, 0.2).lists;
  assert.ok(rows.find((r) => r.size === 128).highlight > 0.5, '查找从 128K 行开始扫过');
  const row128 = frame(4, 1).lists.find((r) => r.size === 128).nodes.map((n) => n.label);
  assert.deepEqual(row128, ['[128K,256K)'], '第 4 步切分后 128K 链表挂入了伙伴');
});

test('链表：节点按起址排序，空链显示 NULL', () => {
  const sc = frame(run.N - 1, 1);
  const row512 = sc.lists.find((r) => r.size === 512);
  assert.deepEqual(row512.nodes.map((n) => n.label), ['[0K,512K)']);
  assert.equal(row512.nullAlpha, 0);
  const row64 = sc.lists.find((r) => r.size === 64);
  assert.equal(row64.nodes.length, 0);
  assert.equal(row64.nullAlpha, 1);
});

test('伙伴二叉树：最终状态与内存条一致', () => {
  const last = run.steps[run.N - 1].after;
  assert.equal(C.treeStatus(last, { start: 0, size: 1024 }), 'split');
  assert.equal(C.treeStatus(last, { start: 0, size: 512 }), 'free');
  assert.equal(C.treeStatus(last, { start: 512, size: 512 }), 'split');
  assert.equal(C.treeStatus(last, { start: 512, size: 256 }), 'busy:P3');
  assert.equal(C.treeStatus(last, { start: 768, size: 256 }), 'free');
  assert.equal(C.treeStatus(last, { start: 0, size: 128 }), 'absent');
});

test('文字：解说与阶段在旧文字淡出后换成新文字', () => {
  const idx = run.opStart[0] + 2;
  const from = frame(idx, 0).caption.text;
  const to = frame(idx, 1).caption.text;
  assert.notEqual(from, to);
  assert.equal(frame(idx, 0.1).caption.text, from);
  assert.equal(frame(idx, 0.4).caption.text, to);
  assert.ok(frame(idx, 0.125).caption.alpha < 1, '换字时旧字透明度下降');
});

test('伙伴地址算式：释放时出现，并标出 起址 ⊕ 大小 = 伙伴址', () => {
  const idx = run.opStart[3];   // 释放 P2
  assert.equal(run.steps[idx].kind, 'release');
  assert.equal(frame(idx, 0.2).xor.length, 0);
  const xs = frame(idx, 1).xor;
  assert.equal(xs.length, 1);
  assert.equal(xs[0].text, '256 ⊕ 256 = 0');
  assert.equal(frame(idx + 1, 0).xor[0].text, '256 ⊕ 256 = 0', '算式保留到下一步开始');
});
