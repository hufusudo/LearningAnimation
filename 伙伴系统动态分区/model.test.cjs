const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const KINDS = ['round', 'search', 'split', 'split', 'split', 'place', 'round', 'search', 'pull',
  'round', 'search', 'split', 'place', 'release', 'blocked', 'insert',
  'release', 'merge', 'merge', 'blocked', 'insert'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (b) => `${b.start}-${b.size}`;
const sorted = (list) => list.slice().sort((a, b) => a.start - b.start || a.size - b.size);

// 每一步的快照：只允许这一种主动作改变的块与进程（其余都必须原样不动）
function changedBlocks(step) {
  const b = sorted(step.before.blocks).map((x) => `${key(x)}:${x.kind}:${x.pid}`);
  const a = sorted(step.after.blocks).map((x) => `${key(x)}:${x.kind}:${x.pid}`);
  return {
    removed: b.filter((x) => !a.includes(x)),
    added: a.filter((x) => !b.includes(x))
  };
}

// 不变量：分区完整、块按大小对齐、空闲块之间没有可合并的伙伴对、占用块装得下申请
function assertInvariants(snap) {
  let pos = 0;
  for (const b of snap.blocks) {
    assert.equal(b.start, pos, '分区必须首尾相接、不重不漏');
    assert.ok(b.size >= M.MIN && (b.size & (b.size - 1)) === 0, `块大小必须是 2 的幂且不小于 ${M.MIN}`);
    assert.equal(b.start % b.size, 0, '块起址必须按块大小对齐');
    pos += b.size;
  }
  assert.equal(pos, M.TOTAL);
  for (const b of snap.blocks) {
    if (b.kind !== 'free') continue;
    const buddy = b.start ^ b.size;
    assert.equal(
      snap.blocks.some((x) => x.kind === 'free' && x.start === buddy && x.size === b.size), false,
      `空闲块 [${b.start},${b.start + b.size}) 与其伙伴同为空闲却未合并`
    );
  }
  for (const b of snap.blocks) {
    if (b.kind !== 'busy') continue;
    assert.ok(snap.procs[b.pid].state === 'run', '占用块的进程必须处于运行状态');
    assert.ok(snap.procs[b.pid].req <= b.size, '占用块必须装得下申请');
  }
}

test('向上取整到 2 的幂，不小于 64 KB', () => {
  assert.equal(M.roundUp(1), 64);
  assert.equal(M.roundUp(70), 128);
  assert.equal(M.roundUp(128), 128);
  assert.equal(M.roundUp(190), 256);
  assert.equal(M.roundUp(256), 256);
  assert.equal(M.roundUp(1024), 1024);
});

test('预设场景：步序、阶段起点与步数', () => {
  const run = M.buildRun();
  assert.equal(run.N, 21);
  assert.deepEqual(run.steps.map((s) => s.kind), KINDS);
  assert.deepEqual(run.opStart, [0, 6, 9, 13, 16]);
});

test('预设场景：碎片与终态（手算）', () => {
  const run = M.buildRun();
  const frag = (step) => step.after.blocks.filter((b) => b.kind === 'busy')
    .map((b) => b.size - step.after.procs[b.pid].req);
  assert.deepEqual(frag(run.steps[5]), [58], 'P1 装入 128K 块，碎片 58K');
  const p3 = run.steps[12].after.blocks.find((b) => b.pid === 'P3');
  assert.equal(p3.size - run.steps[12].after.procs.P3.req, 66, 'P3 装入 256K 块，碎片 66K');
  assert.deepEqual(frag(run.steps[12]), [58, 0, 66], 'P2 整块满额，碎片为 0');

  const last = run.steps[run.N - 1].after;
  assert.deepEqual(sorted(last.blocks).map(key), ['0-512', '512-256', '768-256']);
  assert.equal(last.blocks.find((b) => b.start === 512).pid, 'P3');
  assert.deepEqual(last.procs.P1.state, 'done');
  assert.deepEqual(last.procs.P2.state, 'done');
  assert.deepEqual(last.procs.P3.state, 'run');
});

test('预设场景：每一步只改动与其主动作相符的块', () => {
  const run = M.buildRun();
  run.steps.forEach((s) => {
    const ch = changedBlocks(s);
    if (s.kind === 'round' || s.kind === 'search' || s.kind === 'blocked') {
      assert.deepEqual(ch.added.concat(ch.removed), [], `${s.kind} 不应改动内存条`);
    }
    if (s.kind === 'split') {
      assert.equal(ch.removed.length, 1, '切分只移走父块');
      assert.equal(ch.added.length, 2, '切分只产生两块');
    }
    if (s.kind === 'merge') {
      assert.equal(ch.removed.length, 2, '合并移走两个伙伴');
      assert.equal(ch.added.length, 1, '合并只产生一块');
    }
    if (s.kind === 'release') assert.equal(ch.removed.length + ch.added.length, 2, '释放只改动占用块');
    if (s.kind === 'insert') assert.equal(ch.removed.length + ch.added.length, 2, '插链只改动本块的状态');
  });
});

test('相邻两步：上一步的终点快照就是下一步的起点快照', () => {
  const run = M.buildRun();
  for (let i = 0; i + 1 < run.N; i++) {
    assert.deepEqual(run.steps[i].after, run.steps[i + 1].before, `第 ${i} 步与第 ${i + 1} 步之间不连续`);
  }
});

test('每一步的文字都不超过 40 字', () => {
  const run = M.buildRun();
  run.steps.forEach((s) => {
    assert.ok([...s.caption].length <= 40, `第 ${s.i} 步解说过长：${s.caption}`);
  });
});

test('随机操作序列：每一步后都满足分区不变量', () => {
  const next = rng(20260517);
  let accepted = 0;
  for (let trial = 0; trial < 12; trial++) {
    let ops = [];
    const active = [];
    let serial = 0;
    for (let n = 0; n < 30; n++) {
      let op;
      if (active.length && next() < 0.45) {
        op = { op: 'free', pid: active[Math.floor(next() * active.length)] };
      } else {
        serial += 1;
        op = { op: 'alloc', pid: `Q${trial}_${serial}`, size: 1 + Math.floor(next() * 300) };
      }
      let run;
      try {
        run = M.buildRun({ ops: ops.concat(op) });
      } catch (e) {
        if (e instanceof RangeError) continue;   // 内存不足或重复释放：跳过这一步
        throw e;
      }
      ops = ops.concat(op);
      if (op.op === 'alloc') active.push(op.pid);
      else active.splice(active.indexOf(op.pid), 1);
      accepted += 1;
      run.steps.forEach((s) => assertInvariants(s.after));
      assert.deepEqual(run.steps[run.N - 1].after.blocks.filter((b) => b.kind === 'loose' || b.kind === 'work'), []);
    }
  }
  assert.ok(accepted > 50, '随机序列应当有足够多的有效操作');
});
