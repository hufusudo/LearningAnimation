/**
 * 空间直线间距离 · 位置推演（纯函数，数组向量，界面与单测共用）
 * L₁: P1 + t·d1，L₂: P2 + u·d2，d1、d2 为单位向量。
 * 平面 π 过原点，法向 n = (0, −sin α, cos α)。
 */
(function (root) {
  'use strict';

  const HALF = 5;          // 直线绘制半长
  const PAR_EPS = 0.03;    // |s1×s2| 小于此值视为平行（与界面阈值一致）
  const DIST_EPS = 0.012;  // 距离小于此值视为 0

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : null; };

  // 位置关系：平行看 s₁×s₂，异面与相交看混合积
  function classify(P1, d1, P2, d2) {
    const cr = cross(d1, d2);
    const w = sub(P2, P1);
    if (len(cr) > PAR_EPS) return Math.abs(dot(w, cr)) / len(cr) < DIST_EPS ? 'intersect' : 'skew';
    return len(cross(w, d1)) < DIST_EPS ? 'coincident' : 'parallel';
  }

  // 非平行时两直线最近点的参数：Q1 = P1 + t·d1，Q2 = P2 + u·d2
  function closestParams(P1, d1, P2, d2) {
    const w0 = sub(P1, P2);
    const a = dot(d1, d1), b = dot(d1, d2), c = dot(d2, d2);
    const d = dot(d1, w0), e = dot(d2, w0);
    const den = a * c - b * b;
    return { t: (b * e - c * d) / den, u: (a * e - b * d) / den };
  }

  // 公垂线两端（平行时为过 P2 作 L₁ 的垂线）
  function commonSegment(P1, d1, P2, d2) {
    const kind = classify(P1, d1, P2, d2);
    if (kind === 'parallel' || kind === 'coincident') {
      const Q1 = add(P1, mul(d1, dot(sub(P2, P1), d1)));
      return { Q1, Q2: P2, d: len(sub(P2, Q1)), t: null, u: null };
    }
    const { t, u } = closestParams(P1, d1, P2, d2);
    const Q1 = add(P1, mul(d1, t)), Q2 = add(P2, mul(d2, u));
    return { Q1, Q2, d: len(sub(Q2, Q1)), t, u };
  }

  // 讲解时的滑动：slide ∈ [0, 1]，A 从 P1 滑向 Q1，B 从 P2 滑向 Q2（始终留在各自直线上）
  function slideParams(P1, d1, P2, d2, slide) {
    const cs = commonSegment(P1, d1, P2, d2);
    if (cs.t === null) return { ta: 0, ub: 0 };
    return { ta: slide * cs.t, ub: slide * cs.u };
  }

  // 一帧所需的 A 几何：AB 沿公法向 n 的投影 signed 恒为 ±d（与 A、B 的位置无关）
  function frameA(P1, d1, P2, d2, ta = 0, ub = 0) {
    const kind = classify(P1, d1, P2, d2);
    const A = add(P1, mul(d1, ta)), B = add(P2, mul(d2, ub));
    const AB = sub(B, A);
    const cs = commonSegment(P1, d1, P2, d2);
    const w = sub(P2, P1);
    const frame = {
      kind, A, B, AB, Q1: cs.Q1, Q2: cs.Q2, dCP: cs.d,
      n: null, signed: 0, d: cs.d, F: A,
      box: { o: P1, u: d1, v: d2, w, V: Math.abs(dot(w, cross(d1, d2))), S: len(cross(d1, d2)) },
      plane: null
    };
    if (kind === 'skew' || kind === 'intersect') {
      const n = unit(cross(d1, d2));
      const signed = dot(AB, n);
      const footP2 = sub(P2, mul(n, dot(w, n)));   // P2 在过 L₁、∥ L₂ 的平面上的垂足
      Object.assign(frame, {
        n, signed, d: Math.abs(signed), F: add(A, mul(n, signed)),
        plane: { center: mul(add(P1, footP2), 0.5), e1: d1, e2: unit(cross(n, d1)), a: 5.0, b: 3.2, footP2 }
      });
    }
    return frame;
  }

  // 平面 π 的法向（倾角 α 为弧度）
  const planeNormal = (alpha) => [0, -Math.sin(alpha), Math.cos(alpha)];
  const projectOnPlane = (X, n) => sub(X, mul(n, dot(X, n)));

  // 一帧所需的 B 几何：沿 n 落下的投影线、落点、L′ 与辅助平面 π′
  function frameB(C, d, alpha, tb = 0) {
    const n = planeNormal(alpha);
    const dn = dot(d, n);
    const dPerp = sub(d, mul(n, dn));
    const isPend = len(dPerp) <= 1e-3;
    const isPar = Math.abs(dn) < 1e-3;
    const projC = projectOnPlane(C, n);
    const dir = unit(dPerp) || unit(cross(n, [1, 0, 0]));
    const hC = dot(C, n);
    const M = add(C, mul(d, tb));
    return {
      n, dn, dPerp, isPend, isPar, inPlane: Math.abs(hC) < 1e-3,
      projC, dir,
      aux: unit(cross(n, d)),
      samples: [-3, -1.5, 0, 1.5, 3].map(t => {
        const X = add(C, mul(d, t));
        return { t, X, foot: projectOnPlane(X, n) };
      }),
      Lp: [sub(projC, mul(dir, HALF)), add(projC, mul(dir, HALF))],
      pierce: Math.abs(dn) > 1e-4 ? add(C, mul(d, -hC / dn)) : null,
      M, Mp: projectOnPlane(M, n),
      pip: { center: sub(C, mul(n, hC / 2)), e1: dir, e2: n, a: 4.6, b: Math.abs(hC) / 2 + 1.3 }
    };
  }

  const api = {
    HALF, classify, closestParams, commonSegment, slideParams,
    frameA, frameB, planeNormal, projectOnPlane, dot, cross, len, unit, add, sub, mul
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LineModel = api;
})(typeof window === 'undefined' ? globalThis : window);
