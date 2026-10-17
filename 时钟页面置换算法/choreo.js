/**
 * 时钟页面置换算法的视觉编排（纯函数，不碰 DOM，界面与单测共用）。
 * 输入：一步（model.js 给出的前后快照）与步内进度 p；输出：每个元素在这一刻该画成什么样。
 * 编排规则：
 *   1. 每个状态变化先有一个主动作（指针转动、翻牌、幽灵飞行、染色），主动作结束后才出现回执（浮标、计数、徽标）；
 *   2. 页框的页号、位、选中、空闲都有过渡，不做瞬间跳变；文字先淡出再淡入；
 *   3. 所有数值只由 (步, p) 算出，因此拖动、倒退、暂停都能精确重绘。
 */
(function (root) {
  'use strict';

  const HAND_END = 0.4;          // 指针转动占步长的前 40%
  const TEXT_OUT = [0, 0.2];     // 旧文字淡出
  const TEXT_IN = [0.2, 0.4];    // 新文字淡入

  // 每种步的窗口（相对步内进度）：
  //   main：主动作（翻牌、幽灵飞行、选中染色）；landing：落地后的回执窗口（装入后的翻牌与染色消退）；
  //   tag：浮标弹出；stats：计数滚动；token：上方访问标记的结果揭示
  const CHOREO = Object.freeze({
    access: Object.freeze({ main: [0, 0.5] }),
    'lookup-hit': Object.freeze({ main: [0.1, 0.5], tag: [0.55, 0.85], stats: [0.6, 0.9], token: [0.6, 0.9] }),
    'lookup-fault': Object.freeze({ main: [0.1, 0.4], stats: [0.35, 0.65], token: [0.1, 0.4] }),
    hit: Object.freeze({ main: [0.2, 0.6], tag: [0.6, 0.85] }),
    check: Object.freeze({ main: [0.4, 0.6], tag: [0.55, 0.8] }),
    clear: Object.freeze({ main: [0.4, 0.75], tag: [0.7, 0.95] }),
    select: Object.freeze({ main: [0.35, 0.7], tag: [0.6, 0.85] }),
    evict: Object.freeze({ main: [0.05, 0.8], tag: [0.8, 1], stats: [0.8, 1], token: [0.8, 1] }),
    load: Object.freeze({ main: [0.05, 0.75], landing: [0.75, 0.95], tag: [0.8, 1], token: [0.75, 0.95] }),
    write: Object.freeze({ main: [0.2, 0.6], tag: [0.6, 0.85] }),
    advance: Object.freeze({ main: [0, 0.45] })
  });

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const win = (p, a, b) => (b <= a ? (p >= b ? 1 : 0) : clamp((p - a) / (b - a), 0, 1));
  const ease = (t) => {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  };
  const kindKey = (step) => (step.kind === 'lookup' ? `lookup-${step.outcome}` : step.kind);
  const winsOf = (step) => CHOREO[kindKey(step)] || {};

  // 指针：匀速转动（数据式运动，不回弹）
  function handDeg(step, p) {
    return step.handFrom + (step.handTo - step.handFrom) * clamp(p / HAND_END, 0, 1);
  }

  // 翻牌：位先缩成一条线（|1-2q|），中途换值，再展开。w 为 null 时不翻牌
  function bitView(before, after, p, w) {
    if (before === after) return { value: before, sy: 1 };
    if (!w) return { value: p >= 1 ? after : before, sy: 1 };
    const q = win(p, w[0], w[1]);
    if (q <= 0) return { value: before, sy: 1 };
    if (q >= 1) return { value: after, sy: 1 };
    return { value: q < 0.5 ? before : after, sy: Math.abs(1 - 2 * q) };
  }

  // 页框在这一刻的画面。page.text 为空表示这一刻没有页号；empty.alpha 为“空闲”字样的透明度
  function cardView(step, p, f) {
    const b = step.before.frames[f];
    const a = step.after.frames[f];
    const w = winsOf(step);
    const focus = step.focus === f;

    const out = {
      page: { text: a.page === null ? '' : `P${a.page}`, alpha: 1, scale: 1, dy: 0 },
      empty: { alpha: 0 },
      chips: { alpha: a.page === null ? 0 : 1 },
      r: { value: a.r, sy: 1 },
      m: { value: a.m, sy: 1 },
      victim: 0,
      lift: 0,
      dashed: false,
      cls: ''
    };

    if (step.kind === 'evict' && focus) {
      // 淘汰：标签交给幽灵（脏页）或原地淡出（干净页），随后页框显示“空闲”
      const s = w.main[0];
      if (step.dirty) {
        out.page = { text: `P${b.page}`, alpha: 1 - ease(win(p, s, s + 0.06)), scale: 1, dy: 0 };
        out.empty.alpha = ease(win(p, w.main[1], w.main[1] + 0.15));
        out.chips.alpha = 1 - ease(win(p, s, s + 0.06));
      } else {
        const q = win(p, s, s + 0.3);
        out.page = { text: `P${b.page}`, alpha: 1 - ease(q), scale: 1, dy: -10 * ease(q) };
        out.empty.alpha = ease(win(p, s + 0.3, s + 0.5));
        out.chips.alpha = 1 - ease(win(p, s, s + 0.2));
      }
      out.r = { value: b.r, sy: 1 };
      out.m = { value: b.m, sy: 1 };
    } else if (step.kind === 'load' && focus) {
      // 装入：页号在幽灵落地后弹出，R 随后翻为 1
      const L = w.main[1];
      out.page = {
        text: `P${a.page}`,
        alpha: ease(win(p, L, L + 0.2)),
        scale: 0.84 + 0.16 * ease(win(p, L, L + 0.25)),
        dy: 0
      };
      out.empty.alpha = 1 - ease(win(p, L, L + 0.08));
      out.chips.alpha = ease(win(p, L, L + 0.12));
      out.r = bitView(b.r, a.r, p, w.landing);
      out.m = bitView(b.m, a.m, p, null);
    } else {
      const rWin = focus && (step.kind === 'clear' || step.kind === 'hit') ? w.main : null;
      const mWin = focus && (step.kind === 'write' || step.kind === 'hit') ? w.main : null;
      out.r = bitView(b.r, a.r, p, rWin);
      out.m = bitView(b.m, a.m, p, mWin);
    }

    // 选中淘汰：本体渐变为红色并微微抬起；装入后渐回原色（选中状态记在整步快照里，不在页框上）
    const from = step.before.victim === f ? 1 : 0;
    const to = step.after.victim === f ? 1 : 0;
    if (from === to) {
      out.victim = to;
    } else {
      const tw = to === 1 ? w.main : (w.landing || w.main);
      out.victim = from + (to - from) * ease(win(p, tw[0], tw[1]));
    }
    out.lift = -3 * out.victim;
    out.dashed = out.empty.alpha >= 0.5;
    out.cls = `(${out.r.value},${out.m.value})`;
    return out;
  }

  // 焦点外环：到达后淡入并收紧；同一页框连续被关注时保持不变
  function ringView(step, prev, p, f) {
    if (step && step.focus === f) {
      if (prev && prev.focus === f) return { alpha: 1, scale: 1 };
      const start = step.moves ? HAND_END : 0;
      const q = ease(win(p, start, start + 0.2));
      return { alpha: q, scale: 1.08 - 0.08 * q };
    }
    if (prev && prev.focus === f) return { alpha: 1 - win(p, 0, 0.2), scale: 1 };
    return { alpha: 0, scale: 1 };
  }

  // 指针扫过的弧：转动时显示，到位后淡出
  function trailView(step, p) {
    if (!step || !step.moves) return null;
    return { from: step.handFrom, to: handDeg(step, p), alpha: 0.5 * (1 - ease(win(p, 0.4, 0.75))) };
  }

  // 命中连线：查表命中后，从上方访问标记画到命中的页框；下一步开始时淡出
  function connectorView(step, prev, p) {
    if (step && step.kind === 'lookup' && step.outcome === 'hit') {
      return { frame: step.focus, req: step.req, draw: win(p, 0.15, 0.5), alpha: 1 };
    }
    if (prev && prev.kind === 'lookup' && prev.outcome === 'hit') {
      return { frame: prev.focus, req: prev.req, draw: 1, alpha: 1 - win(p, 0, 0.2) };
    }
    return null;
  }

  // 浮标：本步的浮标弹出（上浮进入）；上一步的浮标在本步开头淡出
  function tagsView(step, prev, p) {
    const out = [];
    if (step && step.tag) {
      const tw = winsOf(step).tag;
      if (tw) {
        const q = ease(win(p, tw[0], tw[1]));
        if (q > 0) out.push({ frame: step.tag.frame, text: step.tag.text, tone: step.tag.tone, alpha: q, dy: 8 * (1 - q) });
      }
    }
    if (prev && prev.tag) {
      const q = 1 - ease(win(p, 0, 0.2));
      if (q > 0) out.push({ frame: prev.tag.frame, text: prev.tag.text, tone: prev.tag.tone, alpha: q, dy: -6 * (1 - q) });
    }
    return out;
  }

  // 计数：变化的数字在窗口内滚动（旧数上滑淡出，新数自下滑入）
  function statsView(step, p) {
    const keys = ['total', 'hits', 'faults', 'writes'];
    const out = {};
    for (const k of keys) {
      if (!step) {
        out[k] = { from: 0, to: 0, q: 1 };
        continue;
      }
      const w = winsOf(step).stats || [0.6, 0.9];
      const from = step.before.stats[k];
      const to = step.after.stats[k];
      out[k] = { from, to, q: from === to ? 1 : ease(win(p, w[0], w[1])) };
    }
    return out;
  }

  // 文字：先淡出旧文字，再淡入新文字；done 时直接显示新文字
  function textView(prevText, curText, p, done) {
    if (done || prevText === curText) return { text: curText, alpha: 1 };
    if (p < TEXT_OUT[1]) return { text: prevText, alpha: 1 - win(p, TEXT_OUT[0], TEXT_OUT[1]) };
    return { text: curText, alpha: ease(win(p, TEXT_IN[0], TEXT_IN[1])) };
  }

  // 外存托盘：脏页到达时轻微发光
  function trayView(step, p) {
    const glow = step && step.kind === 'evict' && step.dirty ? Math.sin(Math.PI * win(p, 0.8, 1)) : 0;
    return { glow };
  }

  // 幽灵页号：脏页淘汰时从页框飞向外存托盘；装入时从上方访问标记飞入页框（落地即消失，由页框接替）
  function ghostView(step, p) {
    if (!step) return null;
    if (step.kind === 'evict' && step.dirty) {
      const [s, e] = CHOREO.evict.main;
      const q = win(p, s, e);
      const alpha = ease(win(p, s, s + 0.06)) * (1 - ease(win(q, 0.85, 1)));
      if (alpha <= 0.001) return null;
      return { kind: 'out', frame: step.focus, label: `P${step.before.frames[step.focus].page}`, q, alpha };
    }
    if (step.kind === 'load') {
      const [s, e] = CHOREO.load.main;
      const alpha = ease(win(p, 0, 0.06)) * (p < e ? 1 : 0);
      if (alpha <= 0.001) return null;
      return { kind: 'in', frame: step.focus, label: `P${step.after.frames[step.focus].page}`, q: win(p, s, e), alpha };
    }
    return null;
  }

  const api = {
    CHOREO,
    HAND_END,
    win,
    ease,
    handDeg,
    bitView,
    cardView,
    ringView,
    trailView,
    connectorView,
    tagsView,
    statsView,
    textView,
    trayView,
    ghostView
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClockChoreo = api;
})(typeof window !== 'undefined' ? window : globalThis);
