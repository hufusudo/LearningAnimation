/* Pure, reversible visual sampling. No DOM or animation callbacks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MergeChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const W = 1100, H = 420, CW = 70, CH = 76, ROW_Y = 112, TRAY_Y = 286;
  const clamp = x => Math.max(0, Math.min(1, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const lerp = (a, b, p) => a + (b - a) * p;
  const palette = { white: [255,255,255], ink: [52,60,56], line: [180,185,176], blue: [37,99,235], gold: [157,108,35], green: [45,125,98], soft: [237,246,240] };

  function rowXs(s) {
    const width = s.row.length * CW + s.gaps.reduce((a,b) => a+b, 0);
    let x = (W - width) / 2;
    return s.row.map((_, i) => { const at = x; x += CW + (s.gaps[i] || 0); return at; });
  }
  function trayGeometry(s, xs) {
    if (!s.tray) return { x: W / 2, y: TRAY_Y - 16, width: 0, slots: [] };
    const n = s.tray.cards.length, width = n * CW + (n - 1) * 8;
    const center = (xs[s.tray.lo] + xs[s.tray.hi] + CW) / 2;
    const x = center - width / 2;
    return { x: x - 16, y: TRAY_Y - 16, width: width + 32, slots: Array.from({ length: n }, (_, i) => x + i * (CW + 8)) };
  }
  function scene(s, cards) {
    const xs = rowXs(s), tg = trayGeometry(s, xs), n = cards.length;
    // After the vertical lift, hold the compact tray spacing at row height.
    // The following close event alone restores the array's horizontal spacing.
    if (s.phase === '回填' && s.tray) {
      for (let i = s.tray.lo; i <= s.tray.hi; i++) xs[i] = tg.slots[i - s.tray.lo];
    }
    const groups = [];
    for (let lo = 0; lo < n; lo++) for (let hi = lo; hi < n; hi++) {
      const group = s.groups.find(g => g.lo === lo && g.hi === hi);
      groups.push({ lo, hi, x: xs[lo] - 5, width: xs[hi] + CW - xs[lo] + 10, alpha: group ? 1 : 0, ordered: group && group.ordered ? 1 : 0,
        label: `${lo === hi ? lo : `${lo}–${hi}`}${group && group.ordered ? ' · 有序' : ''}`, labelAlpha: 1 });
    }
    const focus = ['L', 'R'].map(side => {
      const f = s.focus;
      const lo = f ? (side === 'L' ? f.lo : f.mid + 1) : 0;
      const hi = f ? (side === 'L' ? f.mid : f.hi) : 0;
      return { x: xs[lo] - 7, width: xs[hi] + CW - xs[lo] + 14, alpha: f ? 1 : 0, label: f ? `${side} · A[${lo}..${hi}]` : '' };
    });
    const trayText = s.tray ? `辅助托盘 A[${s.tray.lo}..${s.tray.hi}] · ${s.tray.cards.filter(id => id !== null).length}/${s.tray.cards.length}` : '';
    const keyTag = ({ '单项有序': '单元素有序', '合并完成': '区间有序', '完成': '稳定有序' })[s.phase] || (s.comparison.includes('等值取左') ? '等值取左' : '');
    return {
      cards: cards.map(c => {
        const pos = s.row.indexOf(c.id), slot = s.tray ? s.tray.cards.indexOf(c.id) : -1;
        const inFocus = !s.focus || (pos >= s.focus.lo && pos <= s.focus.hi) || slot >= 0;
        const ordered = pos >= 0 && s.groups.some(g => g.ordered && pos >= g.lo && pos <= g.hi);
        const side = pos >= 0 && pos === s.heads.L ? 'blue' : pos >= 0 && pos === s.heads.R ? 'gold' : null;
        return { id: c.id, x: pos >= 0 ? xs[pos] : tg.slots[slot], y: pos >= 0 ? ROW_Y : TRAY_Y,
          alpha: inFocus ? 1 : 0.38, fill: ordered && !side ? palette.soft : palette.white,
          stroke: side ? palette[side] : ordered ? palette.green : palette.line, ring: side ? 1 : 0 };
      }),
      holes: xs.map((x, i) => ({ x, y: ROW_Y, alpha: s.row[i] === null ? 1 : 0 })),
      indices: xs.map((x, i) => ({ x: x + CW / 2, label: String(i) })),
      groups, focus,
      pointers: ['L', 'R'].map(side => ({ x: s.heads[side] === null ? W / 2 : xs[s.heads[side]] + CW / 2, alpha: s.heads[side] === null ? 0 : 1 })),
      tray: { x: tg.x, y: tg.y, width: tg.width, alpha: s.tray ? 1 : 0, text: trayText, textAlpha: 1,
        slots: Array.from({ length: n }, (_, i) => ({ x: tg.slots[i] === undefined ? W / 2 : tg.slots[i], alpha: tg.slots[i] === undefined ? 0 : 1 })) },
      comparison: { text: s.comparison, alpha: 1 },
      phase: { text: s.phase, alpha: 1 }, caption: { text: s.caption, alpha: 1 },
      stats: { ...s.stats },
      counters: Object.fromEntries(['cmp','mv'].map(k => [k, { text: String(s.stats[k]), alpha: 1, dy: 0 }])),
      effect: { alpha: 0, cutX: 0, cutHeight: 0, tag: keyTag, tagAlpha: keyTag ? 1 : 0, tagX: W / 2, tagY: 32, guideAlpha: 0, guideX: 0, guideY: 0, pathAlpha: 0, x1: 0, y1: 0, x2: 0, y2: 0 }
    };
  }
  function textView(a, b, p) {
    if (a === b) return { text: a, alpha: 1 };
    if (p <= 0) return { text: a, alpha: 1 };
    if (p >= 1) return { text: b, alpha: 1 };
    return p < .5 ? { text: a, alpha: 1 - 2*p } : { text: b, alpha: 2*p - 1 };
  }
  function mix(a, b, p) {
    if (typeof a === 'number') return lerp(a, b, p);
    if (Array.isArray(a)) return a.map((v,i) => mix(v,b[i],p));
    if (typeof a === 'object' && a !== null) return Object.fromEntries(Object.keys(a).map(k => [k, mix(a[k],b[k],p)]));
    return p < .5 ? a : b;
  }
  function sampleEvent(event, cards, progress) {
    const p = clamp(progress), a = scene(event.before, cards), b = scene(event.after, cards);
    // Exact canonical endpoints, including hidden geometry and labels.
    if (p === 0) return a;
    if (p === 1) return b;
    const q = win(p, .22, .72), v = mix(a, b, q);
    v.phase = textView(a.phase.text, b.phase.text, win(p, 0, .2));
    v.caption = textView(a.caption.text, b.caption.text, win(p, .76, 1));
    v.comparison = textView(a.comparison.text, b.comparison.text, win(p, .22, .72));
    const tx = textView(a.tray.text, b.tray.text, win(p, .76, 1));
    v.tray.text = tx.text; v.tray.textAlpha = tx.alpha;
    const countProgress = win(p, .78, 1);
    v.stats = mix(a.stats, b.stats, countProgress);
    for (const k of ['cmp','mv']) {
      const changed = a.stats[k] !== b.stats[k];
      v.counters[k] = { ...textView(String(a.stats[k]), String(b.stats[k]), countProgress),
        dy: changed ? (countProgress < .5 ? -8 * countProgress : 8 * (1 - countProgress)) : 0 };
    }
    v.groups.forEach((g,i) => {
      const label = textView(a.groups[i].label, b.groups[i].label, win(p, .76, 1));
      g.label = label.text; g.labelAlpha = label.alpha;
    });
    if (event.kind === 'take') v.pointers = mix(a.pointers, b.pointers, win(p, .76, .98));
    const envelope = Math.min(win(p, 0, .16), 1 - win(p, .82, 1));
    if (event.kind === 'split') {
      const xs0 = rowXs(event.before), xs1 = rowXs(event.after), mid = event.mid;
      v.effect.alpha = envelope;
      v.effect.cutX = lerp(xs0[mid] + CW + event.before.gaps[mid]/2, xs1[mid] + CW + event.after.gaps[mid]/2, q);
      v.effect.cutHeight = 120 * win(p, 0, .2);
    }
    if (event.kind === 'take') {
      const src = a.cards.find(c => c.id === event.card), dst = b.cards.find(c => c.id === event.card);
      Object.assign(v.effect, { guideAlpha: envelope, guideX: src.x - 5, guideY: src.y - 5,
        pathAlpha: envelope * .65, x1: src.x + CW/2, y1: src.y + CH/2, x2: dst.x + CW/2, y2: dst.y + CH/2 });
    }
    const tag = textView(a.effect.tag, b.effect.tag, win(p, .76, 1));
    v.effect.tag = tag.text; v.effect.tagAlpha = tag.text ? tag.alpha : 0;
    if (event.tag && ['split','lift','take'].includes(event.kind)) {
      v.effect.tag = event.tag;
      v.effect.tagAlpha = envelope;
      v.effect.tagY = 32 - 5 * win(p, .72, 1);
      // Guidance stays away from the comparison formula and flight.
    }
    return v;
  }
  function sample(seq, time) {
    const t = Math.max(0, Math.min(seq.duration, Number.isFinite(time) ? time : 0));
    let start = 0;
    for (let i = 0; i < seq.events.length; i++) {
      const e = seq.events[i];
      if (t < start + e.duration || i === seq.events.length - 1) {
        const p = clamp((t - start) / e.duration);
        return { view: sampleEvent(e, seq.cards, p), event: e, index: i, p, t };
      }
      start += e.duration;
    }
    return { view: scene(seq.initial, seq.cards), event: null, index: 0, p: 0, t };
  }
  return { W, H, CW, CH, ROW_Y, TRAY_Y, rowXs, scene, sampleEvent, sample, textView };
});
