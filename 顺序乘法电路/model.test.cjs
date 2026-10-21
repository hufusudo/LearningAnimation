const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const popcount = (v) => v.toString(2).split('').filter((c) => c === '1').length;

test('穷举 4 位无符号数：ACC 与 MQ 拼成的积等于 X·Y', () => {
  for (let X = 0; X < 16; X++) {
    for (let Y = 0; Y < 16; Y++) {
      const r = M.buildTrace(X, Y, 4);
      assert.equal(r.product, X * Y, `${X} × ${Y}`);
      const last = r.steps[r.steps.length - 1];
      assert.equal(M.valueOf([...last.after.acc, ...last.after.mq]), X * Y, `${X} × ${Y} 的终态`);
    }
  }
});

test('步数公式：2 + 3n + popcount(Y)（每个 1 位多一次相加）', () => {
  for (let Y = 0; Y < 16; Y++) {
    assert.equal(M.buildTrace(7, Y, 4).steps.length, 2 + 3 * 4 + popcount(Y), `Y = ${Y}`);
  }
});

test('相邻两步首尾相接：上一步的终态等于下一步的起态', () => {
  for (let X = 0; X < 16; X++) {
    for (let Y = 0; Y < 16; Y++) {
      const { steps } = M.buildTrace(X, Y, 4);
      for (let k = 0; k + 1 < steps.length; k++) {
        assert.deepEqual(steps[k].after, steps[k + 1].before, `${X}×${Y}：第 ${k} 步到第 ${k + 1} 步`);
      }
    }
  }
});

test('探测只读 MQ₀；只有 MQ₀ = 1 才有加法步', () => {
  const { steps } = M.buildTrace(13, 11, 4);
  for (const s of steps.filter((st) => st.kind === 'probe')) {
    const mq0 = s.before.mq[3];
    assert.equal(s.bit, mq0);
    assert.equal(s.add, mq0 === 1);
    const hasAdd = steps.some((st) => st.kind === 'add' && st.cycle === s.cycle);
    assert.equal(hasAdd, mq0 === 1, `第 ${s.cycle} 拍`);
  }
});

test('加法不变量：写回的和加上 Cout·16 等于 ACC 原值与 X 之和', () => {
  for (let X = 0; X < 16; X++) {
    for (let Y = 0; Y < 16; Y++) {
      const { steps } = M.buildTrace(X, Y, 4);
      for (const s of steps.filter((st) => st.kind === 'add')) {
        assert.equal(M.valueOf(s.after.acc) + 16 * s.after.cout, M.valueOf(s.before.acc) + X);
        assert.equal(s.after.cout, s.carry);
      }
    }
  }
});

test('联合右移不变量：Cout 进 ACC 最高位，ACC₀ 进 MQ₃，MQ₀ 移出，Cout 清零', () => {
  for (let X = 0; X < 16; X++) {
    for (let Y = 0; Y < 16; Y++) {
      const { steps } = M.buildTrace(X, Y, 4);
      for (const s of steps.filter((st) => st.kind === 'shift')) {
        const b = s.before;
        const a = s.after;
        assert.deepEqual(a.acc, [b.cout, ...b.acc.slice(0, 3)]);
        assert.deepEqual(a.mq, [b.acc[3], ...b.mq.slice(0, 3)]);
        assert.equal(a.cout, 0);
        assert.equal(a.counter, b.counter);
      }
    }
  }
});

test('计数器从 n 递减到 0，每拍减 1', () => {
  const { steps } = M.buildTrace(9, 13, 4);
  const counts = steps.filter((s) => s.kind === 'count');
  assert.equal(counts.length, 4);
  counts.forEach((s, idx) => {
    assert.equal(s.after.counter, 4 - (idx + 1));
    assert.equal(s.before.counter - s.after.counter, 1);
  });
  assert.equal(steps[steps.length - 1].after.counter, 0);
});

test('13 × 11 的推演与手算一致：ACC 与 MQ 的每一拍', () => {
  const { steps, product } = M.buildTrace(13, 11, 4);
  assert.equal(product, 143);
  const shifts = steps.filter((s) => s.kind === 'shift').map((s) => `${s.after.acc.join('')}|${s.after.mq.join('')}`);
  assert.deepEqual(shifts, ['0110|1101', '1001|1110', '0100|1111', '1000|1111']);
  assert.equal(steps[steps.length - 1].after.acc.join('') + steps[steps.length - 1].after.mq.join(''), '10001111');
});

test('解说不超过 40 字，每步的起始阶段名不为空', () => {
  for (const [X, Y] of [[13, 11], [15, 15], [0, 0], [5, 3]]) {
    for (const s of M.buildTrace(X, Y, 4).steps) {
      assert.ok(s.caption.length <= 40, `${s.kind}：${s.caption}`);
      assert.ok(s.phase && s.title);
    }
  }
});
