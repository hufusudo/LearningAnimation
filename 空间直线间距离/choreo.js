/**
 * 空间直线间距离 · 视觉编排（纯函数，只依赖进度 p ∈ [0, 4]）
 * 每一章（第 s 步，占 [s−1, s]）：引导（外环亮起）→ 主动作（一个对象生长）→ 回执（标签淡入）。
 * 章节结束后，辅助对象灰化到 35%，基础对象常显。界面只把这里给出的数值写到三维对象上。
 */
(function (root) {
  'use strict';

  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const win = (p, a, b) => clamp01((p - a) / (b - a));
  const ease = (q) => q * q * (3 - 2 * q);
  const local = (p, s) => clamp01(p - (s - 1));
  const seg = (p, s, a, b) => ease(win(local(p, s), a, b));                 // 章内 [a, b] 生长
  const rise = (p, s) => ease(win(local(p, s), 0, 0.25));                   // 引导：先亮起
  const guide = (p, s) => rise(p, s) * (1 - ease(win(local(p, s), 0.85, 1))); // 外环：亮起后收起
  const tag = (p, s) => seg(p, s, 0.72, 1);                                 // 回执：主动作之后
  const fade = (p, last, level) => (last === null ? 1 : 1 - (1 - level) * ease(win(p, last, last + 0.25)));
  const GHOST = 0.35;

  // A：kind 为 skew / intersect 时走完整讲解；parallel 只画公垂线；coincident 只给结论
  function viewA(p, kind = 'skew') {
    const sk = kind === 'skew' || kind === 'intersect';
    const par = kind === 'parallel';
    const pts = sk ? rise(p, 3) : 0;
    return {
      slide: sk ? seg(p, 4, 0.25, 0.7) : 0,
      s1: { g: seg(p, 1, 0.25, 0.46), a: fade(p, 2, GHOST) },
      s2: { g: seg(p, 1, 0.46, 0.7), a: fade(p, 2, GHOST) },
      n: { g: sk ? seg(p, 2, 0.25, 0.7) : 0, a: 1 },
      right: { g: sk ? tag(p, 2) : 0, a: fade(p, 3, GHOST) },
      A: { g: pts, a: 1 },
      B: { g: pts, a: 1 },
      AB: { g: sk ? seg(p, 3, 0.25, 0.46) : 0, a: 1 },
      AF: { g: sk ? seg(p, 3, 0.46, 0.6) : 0, a: fade(p, 3, 0) },
      BF: { g: sk ? seg(p, 3, 0.6, 0.7) : 0, a: 1 },
      CP: { g: par ? seg(p, 3, 0.25, 0.7) : (sk ? rise(p, 4) : 0), a: 1 },
      feet: { g: sk ? rise(p, 4) : 0, a: 1 },
      rightFeet: { g: sk ? tag(p, 4) : (par ? tag(p, 3) : 0), a: 1 },
      halo: {
        lines: guide(p, 1),
        dirs: guide(p, 2),
        pts: guide(p, 3),
        n: guide(p, 3),
        feet: guide(p, 4)
      },
      lab: {
        P1: 1 - ease(win(p, 2, 2.3)),
        P2: 1 - ease(win(p, 2, 2.3)),
        s1: tag(p, 1),
        s2: tag(p, 1),
        n: sk ? tag(p, 2) : 0,
        A: sk ? tag(p, 3) : 0,
        B: sk ? tag(p, 3) : 0,
        d: par ? tag(p, 3) : (sk ? tag(p, 3) * fade(p, 3, 0) : 0),
        ab: sk || par ? tag(p, 4) : 0
      }
    };
  }

  // B：沿 n 落下投影线 → 作 n′ = n × v → 作辅助平面 π′ → 取交线 L′
  function viewB(p) {
    return {
      n: { g: seg(p, 1, 0.25, 0.4), a: 1 },
      drops: { g: seg(p, 1, 0.4, 0.7), a: 1 },
      feet: { g: seg(p, 1, 0.6, 0.7), a: 1 },
      v: { g: seg(p, 2, 0.25, 0.45), a: fade(p, 3, GHOST) },
      np: { g: seg(p, 2, 0.45, 0.7), a: fade(p, 3, GHOST) },
      plane: { g: seg(p, 3, 0.25, 0.7), a: 1 },
      Lp: { g: seg(p, 4, 0.25, 0.7), a: 1 },
      pierce: { g: tag(p, 4), a: 1 },
      M: { g: 1, a: 1 },
      Mp: { g: 1, a: 1 },
      halo: {
        P: guide(p, 1),
        tips: guide(p, 2),
        plane: guide(p, 3),
        feet: guide(p, 4)
      },
      lab: {
        L: 1,
        pi: 1,
        P: 1 - ease(win(p, 1, 1.3)),
        n: tag(p, 1),
        v: tag(p, 2),
        np: tag(p, 2),
        pip: tag(p, 3),
        Lp: tag(p, 4),
        pierce: tag(p, 4),
        M: tag(p, 4),
        Mp: tag(p, 4)
      }
    };
  }

  // 每一章的主动作键（章内应当一个接一个生长，不同时生长）
  const MAIN_A = { 1: ['s1', 's2'], 2: ['n'], 3: ['AB', 'AF', 'BF'], 4: ['slide'] };
  const MAIN_B = { 1: ['n', 'drops'], 2: ['v', 'np'], 3: ['plane'], 4: ['Lp'] };

  const api = { viewA, viewB, MAIN_A, MAIN_B, GHOST };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StoryChoreo = api;
})(typeof window === 'undefined' ? globalThis : window);
