const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const leaves = (obj, path = [], out = new Map()) => {
  if (obj !== null && typeof obj === 'object') {
    Object.keys(obj).forEach((k) => leaves(obj[k], path.concat(k), out));
  } else {
    out.set(path.join('.'), obj);
  }
  return out;
};

const changed = (a, b) => {
  const la = leaves(a);
  const lb = leaves(b);
  return [...new Set([...la.keys(), ...lb.keys()])].filter((k) => la.get(k) !== lb.get(k));
};

const scenarios = M.MODE_KEYS.map((key) => M.build(key));

test('四种模式都能推演，且每步带起止时刻', () => {
  for (const scn of scenarios) {
    assert.ok(scn.steps.length >= 10, `${scn.key} 步数过少`);
    let t = 0;
    for (const s of scn.steps) {
      assert.equal(s.start, t, `${scn.key} 第 ${s.index} 步起点不连续`);
      assert.ok(s.dur > 0);
      t += s.dur;
    }
    assert.equal(scn.total, t);
  }
});

test('访问结果：物理地址与示意数据一致', () => {
  const byKey = Object.fromEntries(scenarios.map((s) => [s.key, s]));
  assert.equal(byKey.paging.result.pa, 0x72f0);
  assert.equal(byKey.seg.result.pa, 0xea00);
  assert.equal(byKey.segpage.result.pa, 0x42f0);
  assert.equal(byKey.twolevel.result.pa, 0x14c0);
});

test('装入后映射正确：分页与二级页表的页号到块号', () => {
  const paging = scenarios.find((s) => s.key === 'paging');
  const last = paging.steps.filter((s) => s.phase === 'load').at(-1).after;
  assert.deepEqual(last.pt, [3, 7, 1]);
  assert.equal(last.frames[3], 'P0');
  assert.equal(last.frames[7], 'P1');
  assert.equal(last.frames[1], 'P2');

  const two = scenarios.find((s) => s.key === 'twolevel');
  const twoLast = two.steps.filter((s) => s.phase === 'load').at(-1).after;
  assert.deepEqual(twoLast.dir, [6, 4]);
  assert.deepEqual(twoLast.t0, [3, 7]);
  assert.deepEqual(twoLast.t1, [1, null]);
  assert.equal(twoLast.frames[6], 'PT0');
  assert.equal(twoLast.frames[4], 'PT1');
});

test('一步一个主动作：每步改动的叶子不超过两处（分段装入按段内单元计）', () => {
  for (const scn of scenarios) {
    scn.steps.forEach((s, i) => {
      if (i === 0) return;
      const before = scn.steps[i - 1].after;
      const diff = changed(before, s.after);
      if (scn.key === 'seg' && s.kind === 'load') {
        // 装入是整段的单元变化，允许多个单元，但只能属于同一段
        const owners = new Set(diff.map((k) => s.after.mem[Number(k.split('.')[1])]));
        assert.equal(owners.size, 1, `${scn.key} 第 ${i} 步一次装入了多个段`);
        return;
      }
      // 同一表项内的字段（如 segRow.0.base、segRow.0.len）算作一处改动
      const entries = new Set(diff.map((k) => k.split('.').slice(0, 2).join('.')));
      assert.ok(entries.size <= 2, `${scn.key} 第 ${i} 步（${s.action}）一次改动 ${entries.size} 处：${[...entries].join(', ')}`);
    });
  }
});

test('访问步骤只读不写：访问阶段的状态不再变化', () => {
  for (const scn of scenarios) {
    const firstAccess = scn.steps.findIndex((s) => s.phase === 'access');
    for (let i = firstAccess + 1; i < scn.steps.length; i++) {
      assert.deepEqual(scn.steps[i].after, scn.steps[i - 1].after, `${scn.key} 第 ${i} 步改动了状态`);
    }
  }
});

test('访存次数与步骤标注一致', () => {
  for (const scn of scenarios) {
    const counts = scn.steps.filter((s) => s.mem).map((s) => s.mem);
    assert.deepEqual(counts, Array.from({ length: scn.memTotal }, (_, i) => i + 1), scn.key);
  }
});

test('分段：碎片总量与不相邻', () => {
  const seg = scenarios.find((s) => s.key === 'seg');
  const mark = seg.steps.find((s) => s.kind === 'mark');
  const sum = mark.ref.frags.reduce((acc, [a, b]) => acc + (b - a), 0);
  assert.equal(sum, 20);
  assert.equal(mark.ref.frags.length, 2);
  const [[, e1], [s2]] = mark.ref.frags;
  assert.ok(s2 > e1, '两块碎片应当彼此不相邻');
});

test('解说不超过 40 字（页面不写考点，只留一句因果）', () => {
  for (const scn of scenarios) {
    for (const s of scn.steps) {
      assert.ok(s.narr.length <= 40, `${scn.key} 第 ${s.index} 步解说 ${s.narr.length} 字：${s.narr}`);
    }
  }
});
