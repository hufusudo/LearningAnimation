const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('./model.js');

const CONFIGS = [];
for (const cap of [1, 2, 3, 4, 6]) {
  for (const printPerPage of [1, 2, 4]) CONFIGS.push({ inCapacity: cap, outCapacity: cap, printPerPage });
}

test('默认参数复现页面给出的参考结果', () => {
  const spool = model.summarize(model.simulateSpool({}));
  const direct = model.summarize(model.simulateDirect({}));
  assert.deepEqual(spool, { cpuDone: 31, end: 45, cpuIdle: 3, printed: 9 });
  assert.deepEqual(direct, { cpuDone: 62, end: 62, cpuIdle: 50, printed: 9 });
});

test('直接 I/O 的 CPU 空等恰好等于全部读卡与打印时间', () => {
  const direct = model.simulateDirect({});
  const io = direct.acts
    .filter((a) => a.lane === 'cpu' && (a.kind === 'read-direct' || a.kind === 'print-direct'))
    .reduce((sum, a) => sum + a.end - a.start, 0);
  assert.equal(io, 2 * 7 + 4 * 9);
  assert.equal(model.summarize(direct).cpuIdle, io);
  assert.ok(direct.acts.every((a) => a.lane !== 'cpu' || !a.kind.startsWith('wait')));
});

test('每一页恰好打印一次，且按写入顺序（FIFO）打印', () => {
  for (const config of CONFIGS) {
    const run = model.simulateSpool(config);
    const order = run.acts.filter((a) => a.lane === 'printer').map((a) => a.page);
    assert.deepEqual(order, [...Array(9).keys()], JSON.stringify(config));
  }
});

test('打印机同一时刻只打印一页', () => {
  for (const config of CONFIGS) {
    const prints = model.simulateSpool(config).acts
      .filter((a) => a.lane === 'printer')
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < prints.length; i++) {
      assert.ok(prints[i].start >= prints[i - 1].end, JSON.stringify(config));
    }
  }
});

test('CPU 时间线从 0 到 CPU 释放时刻无缝衔接，动作与等待互不重叠', () => {
  for (const config of CONFIGS) {
    const run = model.simulateSpool(config);
    const cpu = run.acts.filter((a) => a.lane === 'cpu').sort((a, b) => a.start - b.start);
    let at = 0;
    for (const a of cpu) {
      assert.equal(a.start, at, `${JSON.stringify(config)} 在 t=${at} 出现空档或重叠`);
      assert.ok(a.end > a.start);
      at = a.end;
    }
    assert.equal(at, run.cpuDone, JSON.stringify(config));
  }
});

test('井容量始终不超过上限，且每个井格同一时刻最多一页', () => {
  for (const config of CONFIGS) {
    const run = model.simulateSpool(config);
    const cap = { in: config.inCapacity, out: config.outCapacity };
    for (let t = 0; t <= run.end; t++) {
      const state = model.stateAt(run, t);
      for (const side of ['in', 'out']) {
        const used = state.slots[side].filter(Boolean);
        assert.ok(used.length <= cap[side], `${side} 井在 t=${t} 超过容量 ${JSON.stringify(config)}`);
        assert.equal(new Set(used).size, used.length, `${side} 井在 t=${t} 同一页占了两格`);
      }
    }
  }
});

test('页的路径首尾相接，输出页在打印结束时离开', () => {
  for (const config of CONFIGS) {
    const run = model.simulateSpool(config);
    for (const pg of run.pages) {
      assert.ok(pg.path.length >= 2, pg.id);
      for (let i = 1; i < pg.path.length; i++) {
        assert.equal(pg.path[i].t0, pg.path[i - 1].t1, `${pg.id} 路径在第 ${i} 段断开`);
      }
      if (pg.side === 'out') assert.equal(pg.path.at(-1).t1, run.acts.find((a) => a.lane === 'printer' && a.page === run.pages.filter((p) => p.side === 'out').indexOf(pg)).end);
    }
  }
});

test('假脱机让 CPU 更早释放，总耗时也更短（打印机慢时尤其明显）', () => {
  const slow = model.summarize(model.simulateSpool({ printPerPage: 4 }));
  const slowDirect = model.summarize(model.simulateDirect({ printPerPage: 4 }));
  assert.ok(slow.cpuDone < slowDirect.end);
  assert.ok(slow.end < slowDirect.end);
  assert.ok(slow.cpuIdle < slowDirect.cpuIdle / 10);
});

test('井容量为 1 时程序会被井卡住，CPU 释放更晚', () => {
  const base = model.summarize(model.simulateSpool({}));
  const tiny = model.simulateSpool({ inCapacity: 1, outCapacity: 1 });
  const waits = tiny.acts.filter((a) => a.kind === 'wait-out' || a.kind === 'wait-in');
  assert.ok(tiny.acts.some((a) => a.kind === 'wait-out'), '应出现输出井满导致的等待');
  assert.ok(waits.length > 0);
  assert.ok(model.summarize(tiny).cpuDone > base.cpuDone);
});

test('打印机快时打印紧跟 CPU 之后完成，瓶颈转移到 CPU 自身的工作与输入等待', () => {
  const fast = model.summarize(model.simulateSpool({ printPerPage: 1 }));
  assert.ok(fast.end - fast.cpuDone <= 1, `打印应在 CPU 释放后一拍内结束：${fast.cpuDone} → ${fast.end}`);
});

test('stateAt 在开头、中间与结尾给出正确画面', () => {
  const run = model.simulateSpool({});
  const start = model.stateAt(run, 0);
  assert.equal(start.printed, 0);
  assert.equal(start.read, 0);
  assert.equal(start.cpu.kind, 'wait-in');
  assert.equal(start.card.kind, 'read');
  const end = model.stateAt(run, run.end);
  assert.equal(end.printed, 9);
  assert.equal(end.chips.filter((c) => c.phase !== 'gone').length, 0);
  assert.equal(model.stateAt(run, run.cpuDone).cpuDone, true);
});

test('stateAt 对直接 I/O 同样给出阻塞状态', () => {
  const run = model.simulateDirect({});
  const first = model.stateAt(run, 0);
  assert.equal(first.cpu.kind, 'read-direct');
  assert.equal(first.card.kind, 'read');
  assert.ok(first.slots.in.every((slot) => slot === null));
  assert.ok(first.slots.out.every((slot) => slot === null));
});

test('时刻集合包含两组全部事件，且升序去重', () => {
  const runs = [model.simulateSpool({}), model.simulateDirect({})];
  const times = model.boundaries(runs);
  assert.deepEqual(times, [...new Set(times)].sort((a, b) => a - b));
  assert.ok(times.includes(31) && times.includes(45) && times.includes(62));
});

test('非法参数直接抛错', () => {
  assert.throws(() => model.simulateSpool({ inCapacity: 0 }), RangeError);
  assert.throws(() => model.simulateSpool({ printPerPage: 2.5 }), RangeError);
  assert.throws(() => model.simulateDirect({ cardPerPage: -1 }), RangeError);
  assert.throws(() => model.simulateSpool({}, []), RangeError);
  assert.throws(() => model.simulateSpool({}, [{ name: 'X', inPages: 0, compute: 1, outPages: 1 }]), RangeError);
});
