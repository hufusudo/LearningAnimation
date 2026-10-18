/**
 * 伙伴系统动态分区的视觉编排（纯函数，不碰 DOM，界面与单测共用）。
 * 输入：一步（model.js 给出的前后快照）、上一步与步内进度 p；输出：每个元素在这一刻的位置、透明度与文字。
 * 编排规则：
 *   1. 每一步只有一个主动作（切分、飞入、染色、合并、插链）；引导（焦点外环）先于变化出现，并在步末淡出；
 *   2. 回执（浮标、算式）排在主动作之后出现，并保留到下一步开始时才淡出；
 *   3. 切分与合并用几何过渡：父块对半分开，两块并拢成整块；数据式位移线性，不回弹；
 *   4. 所有数值只由 (步, 进度) 算出，因此拖动、倒退、暂停都能精确重绘。
 *   边界：上一步 p=1 的画面与下一步 p=0 的画面相同（单测覆盖）。
 */
(function (root) {
  'use strict';

  // 舞台坐标（SVG 视口 1100 × 484，见 index.html），构图固定，随容器等比缩放
  const BAR = Object.freeze({ x: 40, y: 118, w: 1020, h: 80 });   // 物理内存条
  const TAG_Y = 106;                                                 // 浮标与算式所在的一行
  const LIST = Object.freeze({
    x: 40, w: 520, headY: 254, top: 266, pitch: 34, h: 28,           // 链表行
    x0: 150, nodeW: 128, nodeH: 22, gap: 12                          // 节点
  });
  const CARD = Object.freeze({ y: 10, w: 146, h: 74, xs: Object.freeze([600, 754, 908]) });
  const TREE_HEAD_Y = 254;

  // 伙伴二叉树的固定骨架（最多 9 个节点，覆盖预设场景中出现过的所有切分层次）
  const TREE_NODES = Object.freeze([
    { key: '0-1024', start: 0, size: 1024, x: 825, y: 296, w: 116 },
    { key: '0-512', start: 0, size: 512, x: 705, y: 342, w: 110 },
    { key: '512-512', start: 512, size: 512, x: 945, y: 342, w: 110 },
    { key: '0-256', start: 0, size: 256, x: 645, y: 388, w: 100 },
    { key: '256-256', start: 256, size: 256, x: 765, y: 388, w: 100 },
    { key: '512-256', start: 512, size: 256, x: 885, y: 388, w: 100 },
    { key: '768-256', start: 768, size: 256, x: 1005, y: 388, w: 100 },
    { key: '0-128', start: 0, size: 128, x: 605, y: 430, w: 64 },
    { key: '128-128', start: 128, size: 128, x: 685, y: 430, w: 64 }
  ]);
  const TREE_EDGES = Object.freeze([
    ['0-1024', '0-512'], ['0-1024', '512-512'],
    ['0-512', '0-256'], ['0-512', '256-256'],
    ['512-512', '512-256'], ['512-512', '768-256'],
    ['0-256', '0-128'], ['0-256', '128-128']
  ]);

  // 每种步的时间窗口（相对步内进度 0–1）。未列出的窗口视为在步末才发生。
  //   in / out：块的出现与消失；geo：切分或合并的几何过渡；color：块的状态染色；
  //   fly：飞行芯片；land：伙伴落入链表；listOut：链表节点离开；relink：节点重排；
  //   sweep：查找时逐行扫过；card：进程卡文字；tree：二叉树状态；xor：伙伴地址算式
  const TIMING = Object.freeze({
    round: Object.freeze({ card: [0.3, 0.6] }),
    search: Object.freeze({ sweep: [0.1, 0.9] }),
    split: Object.freeze({
      listOut: [0, 0.2], in: [0.05, 0.2], geo: [0.15, 0.6], fly: [0.5, 0.9], land: [0.85, 1], tree: [0.2, 0.6]
    }),
    place: Object.freeze({ fly: [0.1, 0.7], color: [0.65, 0.9], card: [0.6, 0.85], tree: [0.65, 0.95] }),
    pull: Object.freeze({
      listOut: [0.2, 0.45], relink: [0.2, 0.45], fly: [0.25, 0.8], color: [0.7, 0.95], card: [0.7, 0.95], tree: [0.7, 0.95]
    }),
    release: Object.freeze({ color: [0.05, 0.5], card: [0.05, 0.3], xor: [0.5, 0.85], tree: [0.1, 0.5] }),
    blocked: Object.freeze({}),
    merge: Object.freeze({
      listOut: [0.1, 0.35], geo: [0.15, 0.55], out: [0.55, 0.85], in: [0.55, 0.85], tree: [0.55, 0.9]
    }),
    insert: Object.freeze({
      fly: [0.05, 0.7], land: [0.7, 0.95], relink: [0.7, 0.95], color: [0.7, 0.95], tree: [0.7, 0.95]
    })
  });

  const RING_IN = [0, 0.18];          // 焦点外环：先出现
  const RING_OUT = [0.8, 0.95];       // 步末淡出，因此步末画面没有引导
  const RECEIPT_IN = [0.55, 0.85];    // 回执：主动作之后出现
  const RECEIPT_OUT = [0, 0.18];      // 回执：下一步开始时淡出
  const TEXT_W = [0, 0.25];           // 文字交叉淡入淡出
  const COUNT_W = [0, 0.12];
  const INTRO_PHASE = '准备就绪';
  const INTRO_CAPTION = '点击「播放」或「单步」，逐步观察内存的切分、占用与合并。';

  const C = Object.freeze({
    ink: '#343C38', ink2: '#5D655F', muted: '#6B7066', border: '#E5E4DC', borderStrong: '#D6D3CD',
    paper: '#FAF9F5', white: '#FFFFFF', blue: '#2563EB', blueSoft: '#EFF6FF', blueText: '#1D4ED8',
    red: '#B42318', redSoft: '#FDF1EF', freeStroke: '#8A9089', wait: '#9AA096'
  });
  // 进程身份色：只用于区分进程，旁边都有文字
  const PID = Object.freeze({
    P1: Object.freeze({ deep: '#2D7D62', soft: '#EEF7F3' }),
    P2: Object.freeze({ deep: '#8F6619', soft: '#FBF4E6' }),
    P3: Object.freeze({ deep: '#6B4FBB', soft: '#F3F0FB' })
  });

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const win = (p, a, b) => (b <= a ? (p >= b ? 1 : 0) : clamp((p - a) / (b - a), 0, 1));
  const ease = (t) => {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  };
  // 窗口缺省为步末才发生
  const ww = (p, tm, name) => {
    const w = tm[name] || [1, 1];
    return win(p, w[0], w[1]);
  };
  const keyOf = (b) => `${b.start}-${b.size}`;
  const pidColor = (pid) => PID[pid] || { deep: C.ink2, soft: '#F1F0EA' };

  // 颜色统一输出大写，端点处与常量逐字相同（边界画面才能逐项比对）
  function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }

  // 按中文字符约 13px、其余约 7.4px 估算文字宽度（浮标与算式用 12px 字体）
  function textWidth(text) {
    let w = 20;
    for (const ch of text) w += /[一-鿿]/.test(ch) ? 13 : 7.4;
    return Math.ceil(w);
  }

  // 文字交叉淡入淡出：旧文字先淡出，中点之后换成新文字并淡入
  function swapText(a, b, p, w) {
    if (a === b) return { text: a, alpha: 1 };
    const q = win(p, w[0], w[1]);
    if (q <= 0) return { text: a, alpha: 1 };
    if (q >= 1) return { text: b, alpha: 1 };
    return q < 0.5 ? { text: a, alpha: 1 - 2 * q } : { text: b, alpha: 2 * q - 1 };
  }

  const xOf = (addr, total) => BAR.x + addr * (BAR.w / total);
  const wOf = (size, total) => size * (BAR.w / total);
  const rectOf = (b, total) => ({ x: xOf(b.start, total), y: BAR.y, w: wOf(b.size, total), h: BAR.h });
  const lerpRect = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: BAR.y, w: lerp(a.w, b.w, t), h: BAR.h });

  // 链表行：阶数从大到小，第 i 行的阶为 total / 2^i
  const rowIndex = (size, total) => Math.round(Math.log2(total / size));
  const rowMid = (i) => LIST.top + i * LIST.pitch + LIST.h / 2;
  const slotX = (idx) => LIST.x0 + idx * (LIST.nodeW + LIST.gap);

  // 某阶链表中的空闲块（按起址排序）：链表由快照里的 free 块得到
  function listOf(snap, size) {
    return snap.blocks.filter((b) => b.kind === 'free' && b.size === size).sort((a, b) => a.start - b.start);
  }

  // 节点状态：恰好是一块则为该块的状态；内部还有更小的块则为 split；被更大的块包住（已合并）则为 absent
  function treeStatus(snap, node) {
    const exact = snap.blocks.find((b) => b.start === node.start && b.size === node.size);
    if (exact) return exact.kind === 'busy' ? `busy:${exact.pid}` : exact.kind;
    const inside = snap.blocks.some((b) => b.size < node.size
      && b.start >= node.start && b.start + b.size <= node.start + node.size);
    return inside ? 'split' : 'absent';
  }

  const TREE_STYLE = Object.freeze({
    split: Object.freeze({ fill: C.paper, stroke: C.borderStrong, dash: 0, text: C.muted }),
    free: Object.freeze({ fill: C.white, stroke: C.freeStroke, dash: 0, text: C.ink }),
    loose: Object.freeze({ fill: C.white, stroke: C.blue, dash: 1, text: C.blueText }),
    work: Object.freeze({ fill: C.blueSoft, stroke: C.blue, dash: 1, text: C.blueText })
  });

  function treeStyle(status) {
    if (status.startsWith('busy:')) {
      const pc = pidColor(status.slice(5));
      return { fill: pc.deep, stroke: pc.deep, dash: 0, text: C.white };
    }
    return TREE_STYLE[status];
  }

  // 块的样式：只由块的状态与所属进程决定；busy 块的已用部分与碎片分开画
  function styleOf(b, snap, total) {
    const w = wOf(b.size, total);
    if (b.kind === 'busy') {
      const pr = snap.procs[b.pid] || { req: b.size };
      const pc = pidColor(b.pid);
      const frag = b.size - pr.req;
      return {
        fill: pc.soft, stroke: pc.deep, dash: 0, busy: true,
        frac: pr.req / b.size, usedFill: pc.deep, usedAlpha: 1,
        label: wOf(pr.req, total) >= 90 ? `${b.pid} · ${pr.req}K` : b.pid, labelFill: C.white, labelAlpha: 1,
        fragLabel: frag > 0 ? (wOf(frag, total) >= 56 ? `碎片 ${frag}K` : `${frag}K`) : '',
        fragAlpha: 1
      };
    }
    const names = { free: ['空闲', C.ink2, C.white, C.freeStroke, 0], loose: ['待挂入', C.blueText, C.white, C.blue, 1], work: ['切分中', C.blueText, C.blueSoft, C.blue, 1] };
    const [word, labelFill, fill, stroke, dash] = names[b.kind];
    return {
      fill, stroke, dash, busy: false, frac: 0, usedFill: C.ink2, usedAlpha: 0,
      label: w >= 100 ? `${word} ${b.size}K` : `${b.size}K`, labelFill, labelAlpha: 1,
      fragLabel: '', fragAlpha: 0
    };
  }

  // 同一块在两个快照之间的样式插值：颜色线性插值，文字先淡出再淡入，已用部分按状态淡入淡出
  function mixStyle(a, b, t) {
    const sw = (x, y) => (t < 0.5 ? x : y);
    const dip = (x, y) => (x === y ? 1 : Math.abs(1 - 2 * t));
    const used = a.busy && b.busy ? 1 : (b.busy ? t : 1 - t);
    // 两端点上 busy 必须与对应快照一致（边界画面要与相邻步相同），中间取并集以免已用区闪烁
    const busy = t <= 0 ? a.busy : (t >= 1 ? b.busy : (a.busy || b.busy));
    return {
      fill: mixHex(a.fill, b.fill, t),
      stroke: mixHex(a.stroke, b.stroke, t),
      dash: sw(a.dash, b.dash),
      busy,
      frac: lerp(a.frac, b.frac, t),
      usedFill: sw(a.usedFill, b.usedFill),
      usedAlpha: used,
      label: sw(a.label, b.label),
      labelFill: sw(a.labelFill, b.labelFill),
      labelAlpha: dip(a.label, b.label),
      fragLabel: sw(a.fragLabel, b.fragLabel),
      fragAlpha: used
    };
  }

  function blockItem(k, r, st, alpha) {
    const usedW = r.w * st.frac;
    const fragW = r.w - usedW;
    const labelX = r.x + (st.frac > 0 ? usedW / 2 : r.w / 2);
    const cy = r.y + r.h / 2 + 4;
    return {
      key: `b:${k}`,
      x: r3(r.x), y: r3(r.y), w: r3(r.w), h: r3(r.h),
      fill: st.fill, stroke: st.stroke, dash: st.dash, alpha: r3(alpha),
      used: st.frac > 0 ? { x: r3(r.x), w: r3(usedW), fill: st.usedFill, alpha: r3(st.usedAlpha * alpha) } : null,
      frag: st.busy && st.frac < 1 && st.fragLabel !== '' ? { x: r3(r.x + usedW), w: r3(fragW), alpha: r3(st.fragAlpha * alpha) } : null,
      label: { text: st.label, fill: st.labelFill, alpha: r3(st.labelAlpha * alpha), x: r3(labelX), y: r3(cy) },
      fragLabel: st.busy && st.frac < 1 && st.fragLabel !== ''
        ? { text: st.fragLabel, alpha: r3(st.fragAlpha * alpha), x: r3(r.x + usedW + fragW / 2), y: r3(cy) }
        : null
    };
  }

  function cardRect(idx) {
    return { x: CARD.xs[idx], y: CARD.y, w: CARD.w, h: CARD.h };
  }

  // 进程卡的文字：待申请、取整、占用（块地址）、已释放；碎片随占用显示
  function cardTexts(snap, pid, total) {
    const pr = snap.procs[pid];
    if (!pr) return { sub: '', extra: '' };
    if (pr.state === 'wait') return { sub: '待申请', extra: '' };
    if (pr.state === 'round') return { sub: `取整为 ${pr.need}K`, extra: '' };
    if (pr.state === 'done') return { sub: '已释放', extra: '' };
    const blk = snap.blocks.find((b) => b.kind === 'busy' && b.pid === pid);
    if (!blk) return { sub: '占用中', extra: '' };
    const frag = blk.size - pr.req;
    return {
      sub: `占用 [${blk.start}K,${blk.start + blk.size}K)`,
      extra: frag > 0 ? `内部碎片 ${frag}K（${Math.round((frag / blk.size) * 1000) / 10}%）` : '零碎片'
    };
  }

  /**
   * 页面在这一刻的全部画面。
   * view 来自 model.js 的 sampleAt：{ index, p, done, step, prev }；run 为 buildRun 的结果。
   */
  function scene(view, run) {
    const total = run.total;
    const N = run.N;
    const { index, p, done } = view;
    const step = view.step || null;
    const prev = view.prev || null;
    const tm = step ? (TIMING[step.kind] || {}) : {};
    const before = step ? step.before : run.init;
    const after = step ? step.after : run.init;
    const textFor = (k) => `第 ${k} / ${N} 步`;

    const out = {
      count: swapText(textFor(done ? N : index), textFor(done ? N : index + 1), p, COUNT_W),
      phase: swapText(prev ? prev.phase : INTRO_PHASE, step ? step.phase : '', p, TEXT_W),
      req: swapText(prev ? prev.reqLine : '', step ? step.reqLine : '', p, TEXT_W),
      caption: swapText(prev ? prev.caption : INTRO_CAPTION, step ? step.caption : '', p, TEXT_W),
      cards: [],
      bar: [],
      lists: [],
      tree: { nodes: [], edges: [] },
      rings: [],
      flights: [],
      tags: [],
      xor: []
    };

    // 进程卡：申请顺序决定卡片位置
    const pids = [];
    run.ops.forEach((o) => { if (o.op === 'alloc' && !pids.includes(o.pid)) pids.push(o.pid); });
    pids.slice(0, CARD.xs.length).forEach((pid, idx) => {
      const req = run.ops.find((o) => o.op === 'alloc' && o.pid === pid).size;
      const a = cardTexts(before, pid, total);
      const b = cardTexts(after, pid, total);
      out.cards.push({
        pid, idx, x: CARD.xs[idx], y: CARD.y, w: CARD.w, h: CARD.h,
        title: `${pid} 申请 ${req}K`,
        sub: swapText(a.sub, b.sub, p, tm.card || [1, 1]),
        extra: swapText(a.extra, b.extra, p, tm.card || [1, 1])
      });
    });
    const pidIdx = (pid) => pids.indexOf(pid);

    // 内存条：同一块在前后两个快照中都存在则染色过渡；只在前一快照的块按几何过渡或淡出；只在后一快照的块淡入
    const bmap = new Map(before.blocks.map((b) => [keyOf(b), b]));
    const amap = new Map(after.blocks.map((b) => [keyOf(b), b]));
    const geo = step && step.geom;
    const splitParent = geo && geo.type === 'split' ? keyOf(geo.parent) : null;
    const splitKids = geo && geo.type === 'split' ? geo.children.map(keyOf) : [];
    const mergeKids = geo && geo.type === 'merge' ? geo.children.map(keyOf) : [];
    const mergeUnion = geo && geo.type === 'merge' ? keyOf(geo.parent) : null;
    const unionRect = geo && geo.type === 'merge' ? rectOf(geo.parent, total) : null;
    const parentRect = geo && geo.type === 'split' ? rectOf(geo.parent, total) : null;
    const allKeys = new Set([...bmap.keys(), ...amap.keys()]);
    allKeys.forEach((k) => {
      const b = bmap.get(k);
      const a = amap.get(k);
      if (b && a) {
        const t = ease(ww(p, tm, 'color'));
        const st = mixStyle(styleOf(b, before, total), styleOf(a, after, total), t);
        out.bar.push(blockItem(k, rectOf(a, total), st, 1));
        return;
      }
      if (b) {
        let r = rectOf(b, total);
        if (mergeKids.includes(k)) r = lerpRect(r, unionRect, ease(ww(p, tm, 'geo')));
        const alpha = 1 - ease(ww(p, tm, k === splitParent ? 'listOut' : 'out'));
        out.bar.push(blockItem(k, r, styleOf(b, before, total), alpha));
        return;
      }
      let r = rectOf(a, total);
      let alpha = ease(ww(p, tm, 'in'));
      if (splitKids.includes(k)) {
        r = lerpRect(parentRect, r, ease(ww(p, tm, 'geo')));
      }
      if (k === mergeUnion) alpha = ease(ww(p, tm, 'in'));
      out.bar.push(blockItem(k, r, styleOf(a, after, total), alpha));
    });
    out.bar = out.bar.filter((it) => it.alpha > 0.001);

    // 链表：每行一阶。节点在前后两个快照中都在则重排；只在前者则移出；只在后者则落入
    const sizes = [];
    for (let s = total; s >= 64; s /= 2) sizes.push(s);
    const sweep = step && step.sweep;
    sizes.forEach((S) => {
      const i = rowIndex(S, total);
      const bl = listOf(before, S);
      const al = listOf(after, S);
      const nodes = [];
      const seen = new Set();
      bl.forEach((b, ib) => {
        const k = keyOf(b);
        seen.add(k);
        const ia = al.findIndex((x) => keyOf(x) === k);
        if (ia >= 0) {
          nodes.push({ key: `n:${k}`, start: b.start, size: S, x: lerp(slotX(ib), slotX(ia), ease(ww(p, tm, 'relink'))), alpha: 1 });
        } else {
          nodes.push({ key: `n:${k}`, start: b.start, size: S, x: slotX(ib), alpha: 1 - ease(ww(p, tm, 'listOut')) });
        }
      });
      al.forEach((a, ia) => {
        const k = keyOf(a);
        if (seen.has(k)) return;
        nodes.push({ key: `n:${k}`, start: a.start, size: S, x: slotX(ia), alpha: ease(ww(p, tm, 'land')) });
      });
      nodes.sort((x, y) => x.start - y.start);   // 输出顺序只看起址，两侧画面的数组才一致
      const visible = nodes.filter((nd) => nd.alpha > 0.001);
      const sumAlpha = visible.reduce((acc, nd) => acc + nd.alpha, 0);
      const arrows = [];
      for (let k = 0; k < Math.max(1, visible.length); k++) {
        const alpha = clamp(sumAlpha - (k + 1), 0, 1);
        if (alpha > 0.001) arrows.push({ x1: slotX(k) + LIST.nodeW + 2, x2: slotX(k) + LIST.nodeW + LIST.gap - 2, alpha: r3(alpha) });
      }
      let highlight = 0;
      if (sweep && sweep.sizes.includes(S)) {
        // 查找逐行扫过：第 k 行占扫描窗口的第 k/n 段
        const k = sweep.sizes.indexOf(S);
        const n = sweep.sizes.length;
        const [s0, s1] = tm.sweep;
        const w0 = s0 + ((s1 - s0) * k) / n;
        const w1 = s0 + ((s1 - s0) * (k + 1)) / n;
        highlight = ease(win(p, w0, w0 + 0.06)) * (1 - ease(win(p, w1 - 0.06, w1)));
      }
      out.lists.push({
        size: S, row: i, y: r3(LIST.top + i * LIST.pitch), mid: r3(rowMid(i)),
        highlight: r3(highlight),
        nodes: nodes.filter((nd) => nd.alpha > 0.001).map((nd) => ({
          key: nd.key, start: nd.start, size: nd.size,
          x: r3(nd.x), y: r3(rowMid(i) - LIST.nodeH / 2), w: LIST.nodeW, h: LIST.nodeH,
          alpha: r3(nd.alpha), label: `[${nd.start}K,${nd.start + nd.size}K)`
        })),
        arrows,
        nullAlpha: r3(clamp(1 - sumAlpha, 0, 1))
      });
    });

    // 伙伴二叉树：每个节点一个元素（键只由节点决定）；状态变化时新旧两层交叉淡入淡出，
    // 只保留透明度大于零的层，因此边界两侧的画面一致
    const tt = ease(ww(p, tm, 'tree'));
    TREE_NODES.forEach((node) => {
      const sb = treeStatus(before, node);
      const sa = treeStatus(after, node);
      const layers = [];
      if (sb === sa) {
        if (sb !== 'absent') layers.push({ status: sb, alpha: 1 });
      } else {
        if (sb !== 'absent' && tt < 1) layers.push({ status: sb, alpha: 1 - tt });
        if (sa !== 'absent' && tt > 0) layers.push({ status: sa, alpha: tt });
      }
      if (layers.length === 0) return;
      out.tree.nodes.push({
        key: `t:${node.key}`, x: node.x, y: node.y, w: node.w, h: 22,
        label: `[${node.start}K,${node.start + node.size}K)`,
        layers: layers.map((ly) => {
          const st = treeStyle(ly.status);
          return { fill: st.fill, stroke: st.stroke, dash: st.dash, text: st.text, alpha: r3(ly.alpha) };
        })
      });
    });
    TREE_EDGES.forEach(([pk, ck]) => {
      const parent = TREE_NODES.find((n) => n.key === pk);
      const child = TREE_NODES.find((n) => n.key === ck);
      const pb = treeStatus(before, child) === 'absent' ? 0 : 1;
      const pa = treeStatus(after, child) === 'absent' ? 0 : 1;
      const alpha = pb * (1 - tt) + pa * tt;
      if (alpha <= 0.001) return;
      out.tree.edges.push({ key: `e:${ck}`, x1: parent.x, y1: parent.y + 11, x2: child.x, y2: child.y - 11, alpha: r3(alpha) });
    });

    // 外环（引导）：只属于本步，步末淡出
    const ringRect = (t, snap) => {
      if (t.type === 'proc') {
        const idx = pidIdx(t.pid);
        if (idx < 0) return null;
        const c = cardRect(idx);
        return { x: c.x - 6, y: c.y - 6, w: c.w + 12, h: c.h + 12 };
      }
      if (t.type === 'block' || t.type === 'span') {
        return { x: xOf(t.start, total) - 5, y: BAR.y - 5, w: wOf(t.size, total) + 10, h: BAR.h + 10 };
      }
      if (t.type === 'node') {
        const idx = listOf(snap, t.size).findIndex((b) => b.start === t.start);
        if (idx < 0) return null;
        const mid = rowMid(rowIndex(t.size, total));
        return { x: slotX(idx) - 5, y: mid - LIST.nodeH / 2 - 5, w: LIST.nodeW + 10, h: LIST.nodeH + 10 };
      }
      return null;
    };
    if (step) {
      const alpha = ease(win(p, RING_IN[0], RING_IN[1])) * (1 - ease(win(p, RING_OUT[0], RING_OUT[1])));
      step.ring.forEach((t, j) => {
        const r = ringRect(t, before);
        if (!r || alpha <= 0.001) return;
        out.rings.push({ key: `r:${step.i}:${j}`, x: r3(r.x), y: r3(r.y), w: r3(r.w), h: r3(r.h), tone: t.tone, alpha: r3(alpha) });
      });
    }

    // 浮标与算式：本步回执在主动作之后出现，并保持到下一步开始
    const anchorX = (at) => {
      if (at.pid) {
        const idx = pidIdx(at.pid);
        return idx < 0 ? null : CARD.xs[idx] + CARD.w / 2;
      }
      return xOf(at.start, total) + wOf(at.size, total) / 2;
    };
    const tagBox = (text, ax) => {
      const w = textWidth(text);
      const x = clamp(ax - w / 2, BAR.x, BAR.x + BAR.w - w);
      return { x: r3(x), y: TAG_Y - 11, w: r3(w), h: 22, tx: r3(x + w / 2), ty: TAG_Y };
    };
    // 回执：浮标随本步出现；算式（伙伴地址）随其自己的窗口出现；两者都保留到下一步开始
    const receipts = (st, a) => {
      st.tags.forEach((t, j) => {
        const ax = anchorX(t.at);
        if (ax === null || a <= 0.001) return;
        out.tags.push({ key: `g:${st.i}:${j}`, ...tagBox(t.text, ax), text: t.text, tone: t.tone, alpha: r3(a) });
      });
    };
    if (step) receipts(step, ease(win(p, RECEIPT_IN[0], RECEIPT_IN[1])));
    if (prev) receipts(prev, 1 - ease(win(p, RECEIPT_OUT[0], RECEIPT_OUT[1])));
    const xorBox = (st) => ({
      key: `x:${st.i}`,
      ...tagBox(st.xor.text, xOf(st.xor.at.start, total) + wOf(st.xor.at.size, total) / 2),
      text: st.xor.text
    });
    if (step && step.xor) {
      const xa = ease(ww(p, tm, 'xor'));
      if (xa > 0.001) out.xor.push({ ...xorBox(step), alpha: r3(xa) });
    }
    if (prev && prev.xor) {
      const fade = 1 - ease(win(p, RECEIPT_OUT[0], RECEIPT_OUT[1]));
      if (fade > 0.001) out.xor.push({ ...xorBox(prev), alpha: r3(fade) });
    }

    // 飞行芯片：进程从卡片飞入占用块；伙伴从内存条飞入链表，落地后由链表节点接替
    if (step && step.flight) {
      const f = step.flight;
      const fl = (tm.fly || [1, 1]);
      const alpha = ease(win(p, fl[0], fl[0] + 0.06)) * (1 - ease(win(p, fl[1] - 0.06, fl[1])));
      const pidAt = f.kind === 'proc' ? pidIdx(f.pid) : 0;
      if (alpha > 0.001 && pidAt >= 0) {
        let from;
        let to;
        let w;
        let h;
        let text;
        let tone;
        if (f.kind === 'proc') {
          const c = cardRect(pidAt);
          from = { x: c.x + 2, y: c.y + c.h / 2 - 12 };
          to = { x: xOf(f.to.start, total) + wOf(f.to.size, total) / 2, y: BAR.y + BAR.h / 2 };
          w = 96; h = 24;
          text = `${f.pid} ${after.procs[f.pid].req}K`;
          tone = 'proc';
        } else {
          from = { x: xOf(f.from.start, total) + wOf(f.from.size, total) / 2, y: BAR.y + BAR.h / 2 };
          const idx = listOf(after, f.size).findIndex((b) => b.start === f.from.start);
          to = { x: slotX(Math.max(idx, 0)) + LIST.nodeW / 2, y: rowMid(rowIndex(f.size, total)) };
          w = LIST.nodeW - 4; h = LIST.nodeH;
          text = `[${f.from.start}K,${f.from.start + f.size}K)`;
          tone = 'key';
        }
        const q = win(p, fl[0], fl[1]);
        const x = lerp(from.x, to.x, q) - w / 2;
        const y = lerp(from.y, to.y, q) - h / 2;
        out.flights.push({ key: `f:${step.i}`, x: r3(x), y: r3(y), w, h, text, tone, alpha: r3(alpha) });
      }
    }

    out.tags = out.tags.filter((t) => t.alpha > 0.001);
    out.xor = out.xor.filter((t) => t.alpha > 0.001);
    return out;
  }

  const api = {
    BAR,
    LIST,
    CARD,
    TREE_HEAD_Y,
    pidColor,
    xOf,
    wOf,
    treeStatus,
    scene
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuddyChoreo = api;
})(typeof window !== 'undefined' ? window : globalThis);
