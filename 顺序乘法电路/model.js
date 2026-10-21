/**
 * 顺序乘法（原码一位乘的数值部分）推演模型：纯计算，不碰 DOM，界面与单测共用。
 * 4 位无符号数 X、Y 相乘：ACC 清零，Y 装入 MQ，计数器 C = n。每拍依次：
 *   ① 探测 MQ₀（乘数最低位）；② MQ₀ = 1 时 ACC + X 写回 ACC，进位进入 Cout；
 *   ③ [Cout, ACC, MQ] 整体逻辑右移一位：Cout 进入 ACC 最高位，ACC₀ 跨界进入 MQ₃，MQ₀ 移出；④ C 减 1。
 * 走完 n 拍，ACC 为 2n 位积的高 n 位，MQ 为低 n 位。每一步只做一个主动作，并记录前后两份快照。
 */
(function (root) {
  'use strict';

  // v 按 n 位二进制展开，高位在前
  function bitsOf(v, n) {
    return Array.from({ length: n }, (_, k) => (v >> (n - 1 - k)) & 1);
  }

  function valueOf(bits) {
    return bits.reduce((acc, b) => acc * 2 + b, 0);
  }

  function copyOf(s) {
    return { cout: s.cout, acc: s.acc.slice(), mq: s.mq.slice(), counter: s.counter };
  }

  // 返回 { X, Y, n, product, steps }；每步含 kind、cycle、phase、title、caption、tag 与 before / after 快照
  function buildTrace(X, Y, n = 4) {
    const x = bitsOf(X, n);
    const steps = [];
    let state = { cout: 0, acc: new Array(n).fill(0), mq: bitsOf(Y, n), counter: n };

    const push = (meta, after) => {
      steps.push({ ...meta, x: x.slice(), before: copyOf(state), after: copyOf(after) });
      state = after;
    };

    push({
      kind: 'init', cycle: 0, phase: '初始', title: '初始状态', tag: null,
      caption: `初始：ACC 清零，Y 装入 MQ，计数器 C = ${n}。`
    }, state);

    for (let i = 1; i <= n; i++) {
      const bit = state.mq[n - 1];
      push({
        kind: 'probe', cycle: i, phase: '探测', title: `第 ${i} 拍 · 探测`, bit, add: bit === 1,
        tag: { text: bit ? 'MQ₀=1 → 加 X' : 'MQ₀=0 → 不加', at: 'probe' },
        caption: bit ? '探测 MQ₀ = 1，控制逻辑使能加法（+）。' : '探测 MQ₀ = 0，本拍不加，ALU 空闲。'
      }, state);

      if (bit === 1) {
        const sum = valueOf(state.acc) + X;
        const carry = sum >> n;
        const first = !steps.some((s) => s.kind === 'add');
        const carryText = carry ? '进位 Cout = 1' : '无进位';
        push({
          kind: 'add', cycle: i, phase: '相加', title: `第 ${i} 拍 · 相加`, carry,
          tag: { text: carry ? '进位 Cout=1' : '无进位', at: 'carry' },
          caption: first
            ? `ACC + X 写回 ACC（${carryText}）。X 不动、部分积右移，位权等效。`
            : `ACC + X 写回 ACC，${carryText}。`
        }, { cout: carry, acc: bitsOf(sum & ((1 << n) - 1), n), mq: state.mq, counter: state.counter });
      }

      const s = state;
      const firstShift = !steps.some((st) => st.kind === 'shift');
      push({
        kind: 'shift', cycle: i, phase: '移位', title: `第 ${i} 拍 · 移位`,
        tag: { text: '联合右移 1 位', at: 'shift' },
        caption: firstShift
          ? '联合右移：MQ 腾出的高位接住 ACC₀，拼成 2n 位积。'
          : '[ACC, MQ] 整体右移 1 位，ACC₀ 跨界进入 MQ₃。'
      }, {
        cout: 0,
        acc: [s.cout, ...s.acc.slice(0, n - 1)],
        mq: [s.acc[n - 1], ...s.mq.slice(0, n - 1)],
        counter: s.counter
      });

      const c0 = state.counter;
      push({
        kind: 'count', cycle: i, phase: '计数', title: `第 ${i} 拍 · 计数`,
        tag: { text: c0 - 1 === 0 ? '计数结束' : 'C ← C − 1', at: 'count' },
        caption: c0 - 1 === 0 ? 'C 减到 0，停止计数。' : `CLK 脉冲：计数器 C 由 ${c0} 减为 ${c0 - 1}。`
      }, { ...state, counter: c0 - 1 });
    }

    const product = valueOf([...state.acc, ...state.mq]);
    push({
      kind: 'done', cycle: n, phase: '完成', title: '运算完成', tag: null, product,
      caption: `[ACC, MQ] 即为乘积：高 ${n} 位在 ACC，低 ${n} 位在 MQ。`
    }, state);

    return { X, Y, n, product, steps };
  }

  const api = { bitsOf, valueOf, buildTrace };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SeqMulModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
