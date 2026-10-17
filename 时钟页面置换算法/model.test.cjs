const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const cell = (page, r, m) => ({ page, r, m });
const req = (page, op) => ({ page, op });

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

// 朴素参考实现：只用于比对结果，不复用 model.js 的任何代码
function refRun({ frames, pointer, requests, mode }) {
  const f = frames.map((c) => ({ ...c }));
  let ptr = pointer;
  const results = [];
  for (const { page, op } of requests) {
    const hit = f.findIndex((c) => c.page === page);
    if (hit >= 0) {
      f[hit].r = 1;
      if (mode === 'enhanced' && op === 'W') f[hit].m = 1;
      results.push({ hit: true, victimPage: null, dirty: false, round: 0 });
      continue;
    }
    let victim = -1;
    let round = 0;
    if (mode === 'basic') {
      for (let k = 0; k < 8 && victim < 0; k++) {
        const i = (ptr + k) % 4;
        if (f[i].r === 1) f[i].r = 0;
        else { victim = i; round = k < 4 ? 1 : 2; }
      }
    } else {
      const want = [null, [0, 0], [0, 1], [0, 0], [0, 1]];
      for (let r = 1; r <= 4 && victim < 0; r++) {
        for (let k = 0; k < 4 && victim < 0; k++) {
          const i = (ptr + k) % 4;
          if (r === 2 && f[i].r === 1) { f[i].r = 0; continue; }
          if (f[i].r === want[r][0] && f[i].m === want[r][1]) { victim = i; round = r; }
        }
      }
    }
    if (victim < 0) throw new Error('参考实现找不到淘汰页');
    const dirty = mode === 'enhanced' && f[victim].m === 1;
    results.push({ hit: false, victimPage: f[victim].page, dirty, round });
    f[victim] = { page, r: 1, m: mode === 'enhanced' && op === 'W' ? 1 : 0 };
    ptr = (victim + 1) % 4;
  }
  return { results, frames: f, pointer: ptr };
}

function randomCase(next) {
  const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const frames = pool.slice(0, 4).map((page) => cell(page, next() < 0.5 ? 0 : 1, next() < 0.5 ? 0 : 1));
  const len = 1 + Math.floor(next() * 14);
  const requests = Array.from({ length: len }, () => req(1 + Math.floor(next() * 9), next() < 0.5 ? 'R' : 'W'));
  return {
    mode: next() < 0.7 ? 'enhanced' : 'basic',
    frames,
    pointer: Math.floor(next() * 4),
    requests
  };
}

const summarize = (results) => results.map((r) => ({ hit: r.hit, victimPage: r.victimPage, dirty: r.dirty, round: r.round }));

test('场景 1（改进型）逐次结果与终态与手算一致', () => {
  const s = M.SCENARIOS[0];
  const run = M.buildRun({ mode: 'enhanced', frames: s.frames, pointer: s.pointer, requests: s.requests });
  assert.deepEqual(run.results.map((r) => [r.hit ? 'hit' : r.victimPage, r.dirty, r.round]), [
    ['hit', false, 0], [3, true, 2], ['hit', false, 0], [2, true, 2],
    [4, false, 1], [1, false, 1], ['hit', false, 0], [6, false, 3]
  ]);
  const last = run.steps.at(-1).after;
  assert.deepEqual(last.frames, [cell(7, 0, 0), cell(8, 1, 1), cell(5, 0, 1), cell(3, 0, 1)]);
  assert.equal(last.pointer, 2);
  assert.deepEqual(last.stats, { total: 8, hits: 3, faults: 5, writes: 2 });
});

test('场景 2–5（改进型）的淘汰页、轮次与终态', () => {
  const expect = {
    2: { victims: [[2, false, 1], [4, true, 2]], frames: [cell(1, 1, 1), cell(9, 1, 0), cell(3, 0, 0), cell(8, 1, 1)], pointer: 0 },
    3: { victims: [[3, true, 2]], frames: [cell(1, 0, 1), cell(2, 0, 0), cell(7, 1, 1), cell(4, 1, 1)], pointer: 3 },
    4: { victims: [[1, true, 4]], frames: [cell(9, 1, 0), cell(2, 0, 1), cell(3, 0, 1), cell(4, 0, 1)], pointer: 1 },
    5: { victims: [], frames: [cell(1, 1, 0), cell(2, 1, 1), cell(3, 1, 1), cell(4, 0, 1)], pointer: 2 }
  };
  for (const s of M.SCENARIOS.slice(1)) {
    const run = M.buildRun({ mode: 'enhanced', frames: s.frames, pointer: s.pointer, requests: s.requests });
    const e = expect[s.id];
    const faults = run.results.filter((r) => !r.hit).map((r) => [r.victimPage, r.dirty, r.round]);
    assert.deepEqual(faults, e.victims, `场景 ${s.id} 淘汰结果`);
    assert.deepEqual(run.steps.at(-1).after.frames, e.frames, `场景 ${s.id} 终态页框`);
    assert.equal(run.steps.at(-1).after.pointer, e.pointer, `场景 ${s.id} 终态指针`);
  }
  const hitsOnly = M.buildRun({ mode: 'enhanced', ...M.SCENARIOS[4], requests: M.SCENARIOS[4].requests });
  assert.equal(hitsOnly.N, 10, '场景 5：1R 与 2W、3W 共 10 步');
  assert.ok(hitsOnly.results.every((r) => r.hit));
});

test('简单 Clock 场景 1 的淘汰页与轮次（写操作在简单 Clock 中被忽略）', () => {
  const s = M.SCENARIOS[0];
  const run = M.buildRun({ mode: 'basic', frames: s.frames, pointer: s.pointer, requests: s.requests });
  assert.deepEqual(run.results.map((r) => (r.hit ? null : r.victimPage)), [null, 3, null, 2, 4, 1, null, 6]);
  assert.deepEqual(run.results.map((r) => r.round), [0, 1, 0, 1, 1, 1, 0, 2]);
  assert.ok(run.results.every((r) => !r.dirty));
});

test('与朴素参考实现逐次比对（固定种子随机序列）', () => {
  const next = rng(20260617);
  for (let n = 0; n < 400; n++) {
    const c = randomCase(next);
    const run = M.buildRun(c);
    const ref = refRun(c);
    assert.deepEqual(summarize(run.results), summarize(ref.results), `第 ${n} 例的结果不一致`);
    const last = run.steps.length ? run.steps.at(-1).after : run.init;
    assert.deepEqual(last.frames, ref.frames, `第 ${n} 例的终态页框不一致`);
    assert.equal(last.pointer, ref.pointer, `第 ${n} 例的终态指针不一致`);
  }
});

test('每步的结构不变量：连续、一步一个页框、指针只顺时针、浮标与焦点一致', () => {
  const next = rng(7);
  for (let n = 0; n < 200; n++) {
    const run = M.buildRun(randomCase(next));
    run.steps.forEach((step, k) => {
      const prev = k === 0 ? run.init : run.steps[k - 1].after;
      assert.deepEqual(step.before, prev, `第 ${n} 例第 ${k} 步的起点应等于上一步终点`);
      const changed = step.before.frames.filter((c, i) => {
        const d = step.after.frames[i];
        return c.page !== d.page || c.r !== d.r || c.m !== d.m;
      }).length;
      assert.ok(changed <= 1, `第 ${n} 例第 ${k} 步一次改动了 ${changed} 个页框`);
      const turn = step.handTo - step.handFrom;
      assert.ok(turn >= 0 && turn % 90 === 0 && turn <= 270, `第 ${n} 例第 ${k} 步的转角异常：${turn}`);
      assert.equal(step.moves, turn > 0, `第 ${n} 例第 ${k} 步的 moves 标记与转角不符`);
      assert.equal((((step.handTo / 90) % 4) + 4) % 4, step.after.pointer, `第 ${n} 例第 ${k} 步终点角度与指针不符`);
      assert.equal((((step.handFrom / 90) % 4) + 4) % 4, step.before.pointer, `第 ${n} 例第 ${k} 步起点角度与指针不符`);
      assert.ok(step.dur > 0);
      if (step.tag) assert.equal(step.tag.frame, step.focus, `第 ${n} 例第 ${k} 步浮标与焦点不在同一页框`);
    });
    run.requests.forEach((_, j) => {
      assert.ok(run.reqStart[j] < run.reqEnd[j], `第 ${n} 例第 ${j} 次访问没有步`);
      if (j + 1 < run.requests.length) assert.equal(run.reqEnd[j], run.reqStart[j + 1]);
      const steps = run.steps.slice(run.reqStart[j], run.reqEnd[j]);
      const page = run.requests[j].page;
      const resident = steps.at(-1).after.frames.some((c) => c.page === page);
      assert.ok(resident, `第 ${n} 例第 ${j} 次访问结束后 P${page} 应在驻留集中`);
      const selects = steps.filter((s) => s.kind === 'select').length;
      assert.equal(selects, run.results[j].hit ? 0 : 1, `第 ${n} 例第 ${j} 次访问的选中次数`);
    });
  }
});

test('sampleAt 的前后关系与钳制：起点等于上一步终点，越界被钳制，prev 指向上一步', () => {
  const s = M.SCENARIOS[0];
  const run = M.buildRun({ mode: 'enhanced', frames: s.frames, pointer: s.pointer, requests: s.requests });
  assert.deepEqual(M.sampleAt(run, 0, 0).step.before, run.init);
  for (let i = 1; i < run.N; i++) {
    const v = M.sampleAt(run, i, 0.5);
    assert.equal(v.step, run.steps[i]);
    assert.equal(v.prev, run.steps[i - 1]);
    assert.deepEqual(M.sampleAt(run, i, 0).step.before, M.sampleAt(run, i - 1, 1).step.after, `第 ${i} 步起点应等于上一步终点`);
  }
  assert.equal(M.sampleAt(run, -4, 0).index, 0);
  assert.equal(M.sampleAt(run, Number.NaN, 0).index, 0);
  assert.equal(M.sampleAt(run, Infinity, 0).done, true);
  assert.equal(M.sampleAt(run, run.N + 3, 0.5).index, run.N);
  assert.equal(M.sampleAt(run, run.N + 3, 0.5).step, run.steps[run.N - 1]);
  const empty = M.buildRun({ mode: 'enhanced', frames: s.frames, pointer: 0, requests: [] });
  assert.equal(M.sampleAt(empty, 0, 0).step, null);
});

test('淘汰时页框真正空出，装入后才填入新页；命中与缺页的查表步记录结果', () => {
  const s = M.SCENARIOS[1];   // 场景 2：第一次访问淘汰干净页 P2，第二次访问淘汰脏页 P4
  const run = M.buildRun({ mode: 'enhanced', frames: s.frames, pointer: s.pointer, requests: s.requests });
  const evicts = run.steps.filter((st) => st.kind === 'evict');
  assert.equal(evicts.length, 2);
  for (const st of evicts) {
    assert.equal(st.after.frames[st.focus].page, null, '淘汰后该页框应为空');
    const next = run.steps[run.steps.indexOf(st) + 1];
    assert.equal(next.kind, 'load', '淘汰之后紧跟装入');
    assert.notEqual(next.after.frames[st.focus].page, null, '装入后页框有页号');
  }
  assert.deepEqual(evicts.map((st) => st.dirty), [false, true]);
  assert.deepEqual(run.steps.filter((st) => st.kind === 'lookup').map((st) => st.outcome), ['fault', 'fault']);
  const hits = M.buildRun({ mode: 'enhanced', ...M.SCENARIOS[4], requests: M.SCENARIOS[4].requests });
  assert.ok(hits.steps.filter((st) => st.kind === 'lookup').every((st) => st.outcome === 'hit'));
  assert.ok(hits.evictStep.every((v) => v === Infinity), '全部命中时没有淘汰步');
});

test('推演是确定的：相同输入得到相同的步序列', () => {
  const s = M.SCENARIOS[2];
  const a = M.buildRun({ mode: 'enhanced', frames: s.frames, pointer: s.pointer, requests: s.requests });
  const b = M.buildRun({ mode: 'enhanced', frames: s.frames, pointer: s.pointer, requests: s.requests });
  assert.deepEqual(a, b);
});

test('输入校验拒绝非法状态', () => {
  const ok = M.SCENARIOS[0];
  const base = { mode: 'enhanced', frames: ok.frames, pointer: 0, requests: ok.requests };
  const bad = [
    { ...base, mode: 'lru' },
    { ...base, pointer: 4 },
    { ...base, pointer: 1.5 },
    { ...base, frames: ok.frames.slice(0, 3) },
    { ...base, frames: [cell(1, 0, 0), cell(1, 0, 0), cell(3, 0, 0), cell(4, 0, 0)] },
    { ...base, frames: [cell(0, 0, 0), cell(2, 0, 0), cell(3, 0, 0), cell(4, 0, 0)] },
    { ...base, frames: [cell(1, 2, 0), cell(2, 0, 0), cell(3, 0, 0), cell(4, 0, 0)] },
    { ...base, requests: [req(10, 'R')] },
    { ...base, requests: [req(2, 'X')] },
    { ...base, requests: 'nope' }
  ];
  for (const options of bad) assert.throws(() => M.buildRun(options), RangeError);
});
