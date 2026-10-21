/**
 * 顺序乘法电路的视觉编排（纯函数，不碰 DOM，界面与单测共用）。
 * 输入：一步（model.js 给出的前后快照）与步内进度 p；输出：舞台上每个元素此刻该画成什么样。
 * 编排规则：
 *   1. 每一步只有一个主动作：探测（焦点环指向 MQ₀，加法使能线描边）、相加（X 字飞入 ALU，结果写回 ACC）、
 *      联合右移（整链位块线性右移，ACC₀ 跨界进入 MQ₃，MQ₀ 移出）、计数（焦点环指向计数器，数字滚动）；
 *   2. 引导先于变化，浮标与结果等回执排在主动作之后；焦点与轮廓在步首淡入、步尾淡出，相邻步的边界画面一致；
 *   3. 所有数值只由 (步, 进度) 算出，因此拖动、倒退、暂停都能精确重绘。
 */
// 动效选用：A1、A3、B1、C1、C3、D1、D2、E1、E3（引导 A1/A3，主动作 B1/C3/D2/E1，回执 C1/D1/E3）
(function (root) {
  'use strict';

  // 舞台几何（viewBox 1100×560）。链上 10 个位置：0 为 Cout，1–4 为 ACC（高位在前），5–8 为 MQ，9 为移出位
  const GEOM = Object.freeze({
    W: 1100,
    H: 560,
    cell: 60,
    slotX: Object.freeze([187, 261, 335, 409, 483, 557, 631, 705, 779, 853]),
    chainY: 166,
    aluCx: 402,
    xFlyFrom: 430,      // X 字飞入 ALU 的起点（顶边）
    xFlyTo: 330,        // 终点（顶边），落在 ALU 内部
    chipH: 40,
    chipW: 52,
    chipWordW: 84
  });

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const win = (p, a, b) => (b <= a ? (p >= b ? 1 : 0) : clamp((p - a) / (b - a), 0, 1));
  const ease = (k) => {
    const x = clamp(k, 0, 1);
    return x * x * (3 - 2 * x);
  };
  const lerp = (a, b, k) => a + (b - a) * k;

  // 链上的值与 slotX 一一对应：0 为 Cout，1–4 为 ACC，5–8 为 MQ
  const chainOf = (s) => [s.cout, ...s.acc, ...s.mq];

  // 焦点环与轮廓：步首淡入、步尾淡出，因此相邻步的边界上它们不可见，换目标不跳变
  const guide = (p) => ease(win(p, 0, 0.15)) * (1 - ease(win(p, 0.85, 1)));

  const RING = { probe: 'mq0', add: 'alu', count: 'counter' };
  const TAG_WIN = { probe: [0.6, 0.85], add: [0.85, 1], shift: [0.78, 1], count: [0.75, 1] };

  // 文字交换：旧字先淡出，再淡入新字；q 为窗口内进度
  function swapText(prev, cur, q) {
    if (prev === cur) return { text: cur, alpha: 1 };
    if (q < 0.5) return { text: prev, alpha: 1 - ease(q * 2) };
    return { text: cur, alpha: ease((q - 0.5) * 2) };
  }

  // 链上的位：整链右移时，静态位先淡出，位块飞行，落位后淡入新值
  function slotViews(step, p) {
    const pre = chainOf(step.before);
    const cur = chainOf(step.after);
    const out = [];
    for (let k = 0; k < 9; k++) {
      let v;
      if (step.kind === 'shift') {
        if (p < 0.22) v = { text: String(pre[k]), alpha: 1 - ease(win(p, 0.12, 0.22)) };
        else if (p < 0.68) v = { text: String(cur[k]), alpha: 0 };
        else v = { text: String(cur[k]), alpha: ease(win(p, 0.68, 0.78)) };
      } else if (step.kind === 'add' && k >= 1 && k <= 4) {
        v = swapText(String(pre[k]), String(cur[k]), win(p, 0.5, 0.8));
      } else if (step.kind === 'add' && k === 0) {
        v = swapText(String(pre[k]), String(cur[k]), win(p, 0.8, 0.95));
      } else {
        v = { text: String(cur[k]), alpha: 1 };
      }
      const tint = step.kind === 'done' && k >= 1 ? ease(win(p, 0, 0.5)) : 0;
      out.push({ ...v, tint });
    }
    out.push({ text: '', alpha: 0, tint: 0 });   // 移出位：只在位块飞出时显示
    return out;
  }

  // 位块（B1）：10 个通道。0–8 为联合右移的位块，9 为加法时飞入 ALU 的 X 字
  function chipViews(step, p) {
    const chips = [];
    for (let j = 0; j < 10; j++) chips.push({ text: '', x: 0, y: 0, w: GEOM.chipW, alpha: 0 });

    if (step.kind === 'shift') {
      const vals = chainOf(step.before);
      const k = win(p, 0.2, 0.7);                       // 位块整体线性右移，不回弹
      for (let j = 0; j < 9; j++) {
        const fade = j === 8 ? [0.7, 0.9] : [0.68, 0.78];  // MQ₀ 落到移出位后淡去（D2）
        chips[j] = {
          text: String(vals[j]),
          x: lerp(GEOM.slotX[j], GEOM.slotX[j + 1], k) + (GEOM.cell - GEOM.chipW) / 2,
          y: GEOM.chainY + (GEOM.cell - GEOM.chipH) / 2,
          w: GEOM.chipW,
          alpha: ease(win(p, 0.12, 0.22)) * (1 - ease(win(p, fade[0], fade[1])))
        };
      }
    }

    if (step.kind === 'add') {
      chips[9] = {
        text: step.x.join(''),
        x: GEOM.aluCx - GEOM.chipWordW / 2,
        y: lerp(GEOM.xFlyFrom, GEOM.xFlyTo, win(p, 0.15, 0.6)),   // X 字向上飞入 ALU
        w: GEOM.chipWordW,
        alpha: ease(win(p, 0.15, 0.2)) * (1 - ease(win(p, 0.5, 0.6)))
      };
    }
    return chips;
  }

  // 连线（E1）：每条连线由一根常驻的基线与一根描边生长的覆盖线组成，覆盖线的 draw 为生长进度，alpha 为可见度
  function wireViews(step, p) {
    const k = step.kind;
    return {
      en: k === 'shift' ? { draw: win(p, 0, 0.2), alpha: 1 - win(p, 0.8, 1) } : { draw: 0, alpha: 0 },
      plus: k === 'probe' && step.add ? { draw: win(p, 0.3, 0.6), alpha: 1 }
        : k === 'add' ? { draw: 1, alpha: 1 - win(p, 0.6, 0.85) }
          : { draw: 0, alpha: 0 },
      sum: k === 'add' ? { draw: win(p, 0.45, 0.7), alpha: 1 - win(p, 0.85, 1) } : { draw: 0, alpha: 0 }
    };
  }

  // 计数器（C1）：旧数上滑淡出，新数自下滑入
  function counterView(step, p) {
    const pre = step.before.counter;
    const cur = step.after.counter;
    if (step.kind !== 'count' || pre === cur) return { text: String(cur), alpha: 1, dy: 0 };
    const q = win(p, 0.3, 0.75);
    if (q < 0.5) return { text: String(pre), alpha: 1 - ease(q * 2), dy: -8 * ease(q * 2) };
    const r = ease((q - 0.5) * 2);
    return { text: String(cur), alpha: r, dy: 8 * (1 - r) };
  }

  // 浮标（D1）：上一步的浮标在本步开头淡出（原位），本步的浮标在窗口内淡入上浮
  function tagView(step, prev, p) {
    if (prev && prev.tag && p < 0.2) {
      return { text: prev.tag.text, at: prev.tag.at, alpha: 1 - ease(win(p, 0, 0.2)), dy: -6 * ease(win(p, 0, 0.2)) };
    }
    const w = TAG_WIN[step.kind];
    if (step.tag && w) {
      const q = ease(win(p, w[0], w[1]));
      return { text: step.tag.text, at: step.tag.at, alpha: q, dy: 6 * (1 - q) };
    }
    return { text: '', at: 'probe', alpha: 0, dy: 0 };
  }

  // 一步在进度 p 时的画面。prev 为上一步（用于浮标的淡出），首步为 null
  function frame(step, p, prev = null) {
    const q = clamp(p, 0, 1);
    const k = step.kind;
    return {
      ring: { target: RING[k] || 'none', alpha: RING[k] ? guide(q) : 0 },
      contour: { alpha: k === 'shift' ? guide(q) : 0 },
      seam: { lit: k === 'shift' ? win(q, 0.2, 0.3) * (1 - win(q, 0.6, 0.7)) : 0 },
      wires: wireViews(step, q),
      alu: { lit: k === 'add' ? ease(win(q, 0.1, 0.25)) * (1 - ease(win(q, 0.8, 0.95))) : 0 },
      slots: slotViews(step, q),
      chips: chipViews(step, q),
      counter: counterView(step, q),
      tag: tagView(step, prev, q),
      result: { clip: k === 'done' ? win(q, 0.5, 1) : 0 }
    };
  }

  // 时间 τ（以步为单位）→ 第几步与步内进度；超出末尾时停在末步的终态
  function locate(len, tau) {
    const t = clamp(Number(tau) || 0, 0, len);
    if (t >= len) return { i: len - 1, p: 1 };
    const i = Math.floor(t);
    return { i, p: t - i };
  }

  const api = { GEOM, win, ease, guide, chainOf, frame, locate };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SeqMulChoreo = api;
})(typeof window !== 'undefined' ? window : globalThis);
