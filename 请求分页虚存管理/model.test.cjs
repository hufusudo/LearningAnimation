'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PagingModel = require('./model.js');

const { buildScenario, sample, SCENARIOS } = PagingModel;
const arriveAt = (step) => step.start + step.travel;
const at = (plan, id) => plan.steps.find((step) => step.id === id);

function verifyEventCounts(key, expected) {
  const plan = buildScenario(key);
  for (const [id, counters] of Object.entries(expected)) {
    const step = at(plan, id);
    const before = sample(plan, arriveAt(step) - 1);
    const after = sample(plan, arriveAt(step));
    assert.deepEqual(before.counters, counters.before, `${key}/${id} before arrival`);
    assert.deepEqual(after.counters, counters.after, `${key}/${id} after arrival`);
    assert.equal(after.logs.length - before.logs.length, counters.logs || 0, `${key}/${id} log timing`);
  }
}

test('SCENARIOS publishes the fixed metadata and buildScenario rejects unknown keys', () => {
  assert.deepEqual(SCENARIOS.A, {
    key: 'A', p: 2, f: 5, d: '0x14A', la: '0x214A', pa: '0x514A', value: '0xCAFE',
    title: '快表命中，直接找到物理帧'
  });
  assert.deepEqual(SCENARIOS.B, {
    key: 'B', p: 1, f: 3, d: '0x0C8', la: '0x10C8', pa: '0x30C8', value: '0x5A5A',
    title: '快表没有映射，继续查主存页表'
  });
  assert.deepEqual(SCENARIOS.C, {
    key: 'C', p: 3, f: 6, d: '0x054', la: '0x3054', pa: '0x6054', value: '0xBEEF',
    title: '页面不在内存，先调页，再重执行'
  });
  for (const badKey of ['D', '', null, '__proto__']) {
    assert.throws(() => buildScenario(badKey), RangeError);
  }
});

test('buildScenario keeps the original hardware shape, IDs, wires, and timing', () => {
  const expectedIds = {
    A: ['issue', 'tlb', 'assemble', 'read', 'return'],
    B: ['issue', 'tlb', 'pte', 'frame', 'fill-tlb', 'assemble', 'read', 'return'],
    C: ['issue', 'tlb', 'pte', 'fault', 'disk', 'page-in', 'update-pte', 'fill-tlb', 'retry', 'retry-tlb', 'assemble', 'read', 'return']
  };
  for (const key of Object.keys(expectedIds)) {
    const plan = buildScenario(key);
    assert.deepEqual(plan.steps.map((step) => step.id), expectedIds[key]);
    assert.equal(plan.meta.key, key);
    assert.equal(plan.duration, plan.steps.at(-1).end);
    for (const step of plan.steps) {
      assert.deepEqual(Object.keys(step), ['id', 'title', 'detail', 'phase', 'from', 'to', 'wire', 'packet', 'kind', 'start', 'travel', 'hold', 'end']);
      assert.equal(step.hold, 850);
      assert.equal(step.end, step.start + step.travel + step.hold);
      assert.ok(step.detail.length <= 40, `${key}/${step.id}: ${step.detail}`);
    }
    assert.equal(plan.steps.find((step) => step.id === 'assemble').travel, key === 'B' ? 700 : 1100);
  }
  assert.equal(at(buildScenario('C'), 'disk').travel, 1500);
  assert.equal(at(buildScenario('C'), 'page-in').travel, 2000);

  const initial = sample(buildScenario('C'), 0);
  assert.equal(initial.tlb.length, 4);
  assert.equal(initial.pt.length, 7);
  assert.equal(initial.frames.length, 8);
  assert.equal(initial.disk.length, 4);
  assert.deepEqual(initial.frames[6], { id: 6, page: '空闲', occupied: false, data: '—' });
  assert.deepEqual(initial.pt.find((row) => row.p === 3), { p: 3, v: 0, f: '-', disk: 'Block 3' });
});

test('all three paths finish with the expected values and preserve the 12-bit offset', () => {
  for (const key of ['A', 'B', 'C']) {
    const plan = buildScenario(key);
    const result = sample(plan, plan.duration);
    const meta = plan.meta;
    assert.equal(result.complete, true);
    assert.equal(result.progress, 1);
    assert.equal(result.split, true);
    assert.equal(result.frame, meta.f);
    assert.equal(result.physicalAddress, meta.pa);
    assert.equal(result.r0, meta.value);
    assert.equal(parseInt(meta.la, 16) & 0xFFF, parseInt(meta.pa, 16) & 0xFFF);
    assert.equal(result.counters.memoryReads, key === 'A' ? 1 : 2);
    assert.equal(result.counters.pageTransfers, key === 'C' ? 1 : 0);
    assert.equal(result.counters.tableWrites, key === 'C' ? 1 : 0);
    assert.equal(result.cpuMode, 'user');
    assert.equal(result.fault, false);
  }
  assert.deepEqual(sample(buildScenario('A'), buildScenario('A').duration).logs.map((log) => log.stepId), ['tlb', 'read']);
  assert.deepEqual(sample(buildScenario('B'), buildScenario('B').duration).logs.map((log) => log.stepId), ['tlb', 'pte', 'fill-tlb', 'read']);
});

test('counter and log changes occur only when their corresponding event arrives', () => {
  const zero = { memoryReads: 0, pageTransfers: 0, tableWrites: 0 };
  for (const key of ['A', 'B', 'C']) {
    const plan = buildScenario(key);
    const expected = { ...zero };
    for (const step of plan.steps) {
      assert.deepEqual(sample(plan, arriveAt(step) - 1).counters, expected, `${key}/${step.id} before`);
      if (step.id === 'pte' || step.id === 'read') expected.memoryReads += 1;
      if (step.id === 'page-in') expected.pageTransfers += 1;
      if (step.id === 'update-pte') expected.tableWrites += 1;
      assert.deepEqual(sample(plan, arriveAt(step)).counters, expected, `${key}/${step.id} after`);
    }
  }
  verifyEventCounts('A', {
    tlb: { before: zero, after: zero, logs: 1 },
    read: { before: zero, after: { memoryReads: 1, pageTransfers: 0, tableWrites: 0 }, logs: 1 }
  });
  verifyEventCounts('B', {
    pte: { before: zero, after: { memoryReads: 1, pageTransfers: 0, tableWrites: 0 }, logs: 1 },
    'fill-tlb': { before: { memoryReads: 1, pageTransfers: 0, tableWrites: 0 }, after: { memoryReads: 1, pageTransfers: 0, tableWrites: 0 }, logs: 1 },
    read: { before: { memoryReads: 1, pageTransfers: 0, tableWrites: 0 }, after: { memoryReads: 2, pageTransfers: 0, tableWrites: 0 }, logs: 1 }
  });
  verifyEventCounts('C', {
    pte: { before: zero, after: { memoryReads: 1, pageTransfers: 0, tableWrites: 0 }, logs: 1 },
    'page-in': { before: { memoryReads: 1, pageTransfers: 0, tableWrites: 0 }, after: { memoryReads: 1, pageTransfers: 1, tableWrites: 0 }, logs: 1 },
    'update-pte': { before: { memoryReads: 1, pageTransfers: 1, tableWrites: 0 }, after: { memoryReads: 1, pageTransfers: 1, tableWrites: 1 }, logs: 1 },
    'fill-tlb': { before: { memoryReads: 1, pageTransfers: 1, tableWrites: 1 }, after: { memoryReads: 1, pageTransfers: 1, tableWrites: 1 }, logs: 1 },
    read: { before: { memoryReads: 1, pageTransfers: 1, tableWrites: 1 }, after: { memoryReads: 2, pageTransfers: 1, tableWrites: 1 }, logs: 1 }
  });
});

test('C loads the page before validating and caching it, then retries without early R0 data', () => {
  const plan = buildScenario('C');
  const pageIn = sample(plan, arriveAt(at(plan, 'page-in')));
  assert.deepEqual(pageIn.frames[6], { id: 6, page: 'Page 3', occupied: true, data: '0xBEEF' });
  assert.deepEqual(pageIn.pt.find((row) => row.p === 3), { p: 3, v: 0, f: '-', disk: 'Block 3' });
  assert.equal(pageIn.tlb[3].v, 0);
  assert.equal(pageIn.r0, null);

  const update = sample(plan, arriveAt(at(plan, 'update-pte')));
  assert.deepEqual(update.pt.find((row) => row.p === 3), { p: 3, v: 1, f: 6, disk: 'Block 3' });
  assert.equal(update.tlb[3].v, 0);
  assert.equal(update.r0, null);

  const fill = sample(plan, arriveAt(at(plan, 'fill-tlb')));
  assert.deepEqual(fill.tlb[3], { v: 1, p: 3, f: 6 });
  assert.equal(fill.r0, null);
  const retry = sample(plan, arriveAt(at(plan, 'retry')));
  assert.equal(retry.step.id, 'retry');
  assert.equal(retry.fault, false);
  assert.equal(retry.cpuMode, 'user');
  assert.equal(retry.r0, null);
  const beforeReturn = sample(plan, arriveAt(at(plan, 'return')) - 1);
  assert.equal(beforeReturn.r0, null);
  assert.equal(sample(plan, arriveAt(at(plan, 'return'))).r0, '0xBEEF');

  assert.deepEqual(plan.steps.filter((step) => ['page-in', 'update-pte', 'fill-tlb', 'retry'].includes(step.id)).map((step) => step.id),
    ['page-in', 'update-pte', 'fill-tlb', 'retry']);
});

test('sampling is deterministic in reverse order and snapshots do not alias the plan or each other', () => {
  const plan = buildScenario('C');
  const originalPlan = structuredClone(plan);
  const moments = [0, arriveAt(at(plan, 'fault')), arriveAt(at(plan, 'page-in')), arriveAt(at(plan, 'update-pte')), plan.duration];
  const forward = moments.map((time) => sample(plan, time));
  const reverse = [...moments].reverse().map((time) => sample(plan, time)).reverse();
  assert.deepEqual(reverse, forward);
  assert.deepEqual(plan, originalPlan);

  forward[2].frames[6].page = 'corrupted';
  forward[2].logs.push({ stepId: 'fake' });
  forward[2].step.title = 'corrupted';
  assert.equal(forward[3].frames[6].page, 'Page 3');
  assert.equal(forward[3].logs.some((log) => log.stepId === 'fake'), false);
  assert.notEqual(forward[3].step.title, 'corrupted');
  assert.deepEqual(plan, originalPlan);
});

test('time clamps, NaN/undefined default to zero, and boundaries advance to the next step', () => {
  const plan = buildScenario('B');
  assert.equal(sample(plan).time, 0);
  assert.equal(sample(plan, undefined).stepIndex, 0);
  assert.equal(sample(plan, NaN).time, 0);
  assert.equal(sample(plan, -10).time, 0);
  assert.equal(sample(plan, Infinity).time, plan.duration);
  assert.equal(sample(plan, plan.duration + 100).time, plan.duration);
  assert.equal(sample(plan, plan.duration).complete, true);

  const firstBoundary = at(plan, 'issue').end;
  const next = sample(plan, firstBoundary);
  assert.equal(next.step.id, 'tlb');
  assert.equal(next.local, 0);
  assert.equal(next.arrived, false);
  assert.equal(next.split, true);
  const justBefore = sample(plan, firstBoundary - 0.01);
  assert.equal(justBefore.step.id, 'issue');
  assert.equal(justBefore.arrived, true);
});

test('UMD exposes the same pure API on globalThis without a DOM', () => {
  const source = fs.readFileSync(path.join(__dirname, 'model.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  assert.equal(typeof context.PagingModel.buildScenario, 'function');
  assert.equal(context.PagingModel.sample(context.PagingModel.buildScenario('A'), 0).r0, null);
});
