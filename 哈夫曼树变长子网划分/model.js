/**
 * 自顶向下的子网划分与选择检验。时间单位为秒。
 * 划分：每次二分，拿出一位作为子网位（0 为左半，1 为右半），节点编号即前缀位串。
 * 选择：选中一组子网（节点），规则是恰好三个子网、两两不互为祖先、兜住全部水、每个需求装得下。
 * 画面只由时刻 t 与选择关键帧决定：sample(tree, kfs, t) 是纯函数，选择的变化用 0.6 s 缓动过渡，
 * 因此水位、漏水、重复兜住的数量都连续变化。
 */
(function (root) {
  'use strict';

  const ROOT_SIZE = 256;             // 根块 10.10.10.0/24（水的总量，单位为地址）
  const ROOT_PREFIX = 24;
  const BASE = '10.10.10';
  const MAX_DEPTH = 2;               // 拿出两位：/24 → /26，共四个叶子
  const DEMANDS = Object.freeze([
    Object.freeze({ name: '生活区', need: 120 }),
    Object.freeze({ name: '管理区', need: 60 }),
    Object.freeze({ name: '作业区', need: 60 })
  ]);

  // 四种三子网的选法（编号为前缀位串：'' 根，'0' 左半 /25，'10' 右半的左 /26 …）
  const CASES = Object.freeze([
    Object.freeze({ id: 'c1', title: '情况 1 · 哈夫曼合并的结果', note: '生活区占右半 /25，左半再拿出一位给两个 /26', ids: Object.freeze(['00', '01', '1']), tag: '兜住全部水', tone: 'note', at: '01' }),
    Object.freeze({ id: 'c2', title: '情况 2 · 上一级选左半', note: '上一级 /25 兜住左半，下一级两个 /26 兜住右半的水', ids: Object.freeze(['0', '10', '11']), tag: '上一级兜住左半', tone: 'note', at: '0' }),
    Object.freeze({ id: 'c3', title: '情况 3 · 右半少兜一块', note: '10.10.10.192/26 没有子网兜住，漏 64', ids: Object.freeze(['00', '01', '10']), tag: '漏 64', tone: 'warn', at: 'leak' }),
    Object.freeze({ id: 'c4', title: '情况 4 · 子网之间有祖先关系', note: '10.10.10.0/26 包含在 10.10.10.0/25 之内，水被重复兜住 64', ids: Object.freeze(['00', '0', '1']), tag: '重复兜住 64', tone: 'warn', at: '00' })
  ]);

  const T = Object.freeze({
    split1: 0.8,                     // 第一次拿位
    split2: 2.0,                     // 第二次拿位（两半同时）
    splitDur: 0.8,
    pourStart: 4.0,
    pourFill: 1.6,                   // 单个节点注满的时长
    pourSpan: 2.4,                   // 注水阶段总长（各深度错开）
    caseStart: 6.4,
    caseSpan: 5.0,
    ramp: 0.6
  });

  const PHASES = Object.freeze([
    Object.freeze({ title: '拿出第 25 位', start: 0, caption: '根块 10.10.10.0/24：拿出第 25 位，0 为左半，1 为右半' }),
    Object.freeze({ title: '拿出第 26 位', start: 2.0, caption: '两半各再拿出一位，得到四个 /26 地址块，即四个叶子' }),
    Object.freeze({ title: '根部注水', start: 4.0, caption: '根部注水：还没有选子网，水全部从叶子漏出' }),
    ...CASES.map((c, i) => Object.freeze({ title: `情况 ${i + 1}`, start: T.caseStart + i * T.caseSpan, caption: c.note }))
  ]);
  const DURATION = T.caseStart + CASES.length * T.caseSpan;

  // 版面（viewBox 1100 × 620）
  const X0 = 60;
  const W = 980;
  const NODE_Y = Object.freeze([92, 172, 252]);
  const TRAY_Y = Object.freeze([296, 316, 340]);
  const TRAY_H = Object.freeze([12, 18, 44]);
  const LEAK_Y = 414;
  const LEAK_H = 30;
  const STRIP_Y = 466;
  const STRIP_H = 14;
  const SPOUT_TOP = 26;

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  function smooth(u) {
    const v = clamp(u, 0, 1);
    return v * v * (3 - 2 * v);
  }

  function xOf(start, size) {
    return X0 + ((start + size / 2) / ROOT_SIZE) * W;
  }

  function xAddr(a) {
    return X0 + (a / ROOT_SIZE) * W;
  }

  /** 完整二分树：每个节点拿出一位，直到 MAX_DEPTH */
  function buildTree() {
    const nodes = [];
    const byId = new Map();
    const visit = (id, depth, start) => {
      const size = ROOT_SIZE >> depth;
      const node = {
        idx: nodes.length,
        id,
        depth,
        start,
        size,
        prefix: ROOT_PREFIX + depth,
        leaf: depth === MAX_DEPTH,
        bit: id ? Number(id.slice(-1)) : null,
        cidr: `${BASE}.${start}/${ROOT_PREFIX + depth}`,
        parentIdx: -1,
        childIdx: []
      };
      nodes.push(node);
      byId.set(id, node);
      if (!node.leaf) {
        visit(`${id}0`, depth + 1, start);
        visit(`${id}1`, depth + 1, start + size / 2);
      }
    };
    visit('', 0, 0);
    nodes.forEach((v) => {
      if (!v.id) return;
      const p = byId.get(v.id.slice(0, -1));
      v.parentIdx = p.idx;
      p.childIdx.push(v.idx);
    });
    const leaves = nodes.filter((v) => v.leaf).map((v) => v.idx);
    const byIdIdx = new Map(nodes.map((v) => [v.id, v.idx]));
    return Object.freeze({ nodes: Object.freeze(nodes), byId: byIdIdx, leaves: Object.freeze(leaves), root: 0 });
  }

  function pathOf(tree, idx) {
    const path = [];
    let cur = idx;
    while (cur >= 0) {
      path.unshift(cur);
      cur = tree.nodes[cur].parentIdx;
    }
    return path;
  }

  function ancestorsOf(tree, idx) {
    return pathOf(tree, idx).slice(0, -1);
  }

  /** 选择检验：恰好三个子网、两两不互为祖先、兜住全部水、每个需求装得下 */
  function evaluateSelection(tree, ids) {
    if (!ids) {
      return Object.freeze({ verdict: 'none', message: '尚未选择子网', subnets: [], rules: null, conflicts: [], uncovered: ROOT_SIZE, overlap: 0, fits: [] });
    }
    const sel = [...new Set(ids)].map((id) => tree.nodes[tree.byId.get(id)]);
    const selSet = new Set(sel.map((v) => v.idx));
    const conflicts = [];
    sel.forEach((v) => {
      ancestorsOf(tree, v.idx).forEach((a) => {
        if (selSet.has(a)) conflicts.push([tree.nodes[a].cidr, v.cidr]);
      });
    });
    let uncovered = 0;
    let overlap = 0;
    tree.leaves.forEach((li) => {
      const leaf = tree.nodes[li];
      const S = pathOf(tree, li).filter((idx) => selSet.has(idx)).length;
      if (S === 0) uncovered += leaf.size;
      if (S > 1) overlap += leaf.size * (S - 1);
    });
    // 需求匹配：需求从大到小，子网从大到小（同大小按起点）逐一配对
    const need = [...DEMANDS].sort((a, b) => b.need - a.need);
    const pool = [...sel].sort((a, b) => (b.size - a.size) || (a.start - b.start));
    const fits = need.map((d, i) => {
      const s = pool[i];
      const ok = Boolean(s) && s.size - 2 >= d.need;
      return Object.freeze({ name: d.name, need: d.need, cidr: s ? s.cidr : null, usable: s ? s.size - 2 : 0, ok });
    });
    const rules = Object.freeze({
      count: sel.length === 3,
      antichain: conflicts.length === 0,
      cover: uncovered === 0,
      fit: fits.every((f) => f.ok)
    });
    let verdict = 'ok';
    let message = '合法：三个子网互不包含，兜住了全部水，每个需求都装得下';
    if (!rules.antichain) {
      verdict = 'ancestor';
      message = `祖先关系：${conflicts[0][1]} 在 ${conflicts[0][0]} 之内，水被重复兜住 ${overlap}`;
    } else if (!rules.cover) {
      verdict = 'leak';
      message = `漏水 ${uncovered}：没有子网兜住这些地址`;
    } else if (!rules.count) {
      verdict = 'count';
      message = `应选三个子网，现在选了 ${sel.length} 个`;
    } else if (!rules.fit) {
      verdict = 'fit';
      const bad = fits.find((f) => !f.ok);
      message = `${bad.name} 需要 ${bad.need} 个地址，所选子网装不下`;
    }
    const subnets = sel
      .sort((a, b) => a.start - b.start)
      .map((v) => Object.freeze({
        id: v.id,
        cidr: v.cidr,
        size: v.size,
        usable: v.size - 2,
        range: `${BASE}.${v.start + 1}–${v.start + v.size - 2}`,
        demand: (fits.find((f) => f.cidr === v.cidr) || {}).name || null
      }));
    return Object.freeze({ verdict, message, subnets, rules, conflicts, uncovered, overlap, fits });
  }

  /** 关键帧：每个情况在 caseStart + k·caseSpan 开始生效 */
  function scriptedKeyframes() {
    return CASES.map((c, k) => Object.freeze({ t: T.caseStart + k * T.caseSpan, ids: Object.freeze([...c.ids]) }));
  }

  function userKeyframe(t, ids) {
    return Object.freeze({ t, ids: Object.freeze([...ids]) });
  }

  /** 第 t 时刻的当前选择集合（最近一个关键帧），没有则为 null */
  function setAt(kfs, t) {
    let cur = null;
    for (const kf of kfs) {
      if (kf.t <= t) cur = kf;
      else break;
    }
    return cur ? cur.ids : null;
  }

  /** 第 t 时刻每个节点的选中程度（0–1），过渡为 0.6 s 的平滑插值 */
  function membership(tree, kfs, t) {
    const m = new Float64Array(tree.nodes.length);
    let k = -1;
    for (let i = 0; i < kfs.length; i++) {
      if (kfs[i].t <= t) k = i;
      else break;
    }
    if (k < 0) return m;
    const cur = new Set(kfs[k].ids);
    const prev = k > 0 ? new Set(kfs[k - 1].ids) : new Set();
    const u = smooth((t - kfs[k].t) / T.ramp);
    tree.nodes.forEach((v, i) => {
      m[i] = (cur.has(v.id) ? 1 : 0) * u + (prev.has(v.id) ? 1 : 0) * (1 - u);
    });
    return m;
  }

  function delta() {
    return (T.pourSpan - T.pourFill) / MAX_DEPTH;
  }

  // 节点位置：根常驻；拿出一位时，子节点从父节点的位置移到自己的位置
  function nodeGeom(tree, v, now) {
    const fx = xOf(v.start, v.size);
    const fy = NODE_Y[v.depth];
    if (v.depth === 0) return { x: fx, y: fy, alpha: clamp(now / 0.4, 0, 1) };
    const splitT = v.depth === 1 ? T.split1 : T.split2;
    const parent = tree.nodes[v.parentIdx];
    const px = xOf(parent.start, parent.size);
    const py = NODE_Y[parent.depth];
    const u = smooth((now - splitT) / T.splitDur);
    return { x: px + (fx - px) * u, y: py + (fy - py) * u, alpha: clamp((now - splitT) / 0.3, 0, 1) };
  }

  function phaseIndexAt(t) {
    const now = clamp(Number(t) || 0, 0, Number.POSITIVE_INFINITY);
    let idx = 0;
    PHASES.forEach((p, i) => { if (now >= p.start) idx = i; });
    return idx;
  }

  function tagState(tag, now) {
    const age = now - tag.at;
    const rise = 6 * clamp(age / tag.life, 0, 1);
    const opacity = age < 0 || age > tag.life ? 0 : Math.min(1, age / 0.25) * Math.min(1, (tag.life - age) / 0.7);
    return Object.freeze({ id: tag.id, text: tag.text, tone: tag.tone, anchor: tag.anchor, opacity, rise });
  }

  /** 第 t 时刻的完整画面（纯函数） */
  function sample(tree, kfs, t) {
    const now = Math.max(0, Number(t) || 0);
    const n = tree.nodes.length;
    const m = membership(tree, kfs, now);
    const ids = setAt(kfs, now);
    const verdict = evaluateSelection(tree, ids);
    const dl = delta();

    // 注水：每个节点的到水比例 f；通过比例 pass = 所有祖先都未选中时为 1
    const f = new Float64Array(n);
    const pass = new Float64Array(n);
    tree.nodes.forEach((v) => {
      f[v.idx] = clamp((now - (T.pourStart + v.depth * dl)) / T.pourFill, 0, 1);
      let p = 1;
      ancestorsOf(tree, v.idx).forEach((a) => { p *= 1 - m[a]; });
      pass[v.idx] = p;
    });

    const nodes = tree.nodes.map((v) => {
      const g = nodeGeom(tree, v, now);
      const primary = m[v.idx] * f[v.idx] * pass[v.idx] * v.size;     // 本节点兜住的水（地址数）
      const dup = m[v.idx] * f[v.idx] * (1 - pass[v.idx]) * v.size;  // 祖先已兜住，本节点又兜了一次
      const leak = v.leaf ? f[v.idx] * pass[v.idx] * (1 - m[v.idx]) * v.size : 0;
      return Object.freeze({
        idx: v.idx, id: v.id, depth: v.depth, cidr: v.cidr, size: v.size, start: v.start, leaf: v.leaf,
        x: g.x, y: g.y, alpha: g.alpha, m: m[v.idx], f: f[v.idx], pass: pass[v.idx],
        primary, dup, leak, primaryFrac: clamp(primary / v.size, 0, 1), dupFrac: clamp(dup / v.size, 0, 1),
        leakFrac: v.leaf ? clamp(leak / v.size, 0, 1) : 0
      });
    });

    const pipes = tree.nodes.filter((v) => v.parentIdx >= 0).map((v) => {
      const p = nodes[v.parentIdx];
      const c = nodes[v.idx];
      const splitT = v.depth === 1 ? T.split1 : T.split2;
      const drawn = clamp((now - splitT) / T.splitDur, 0, 1);
      const front = clamp((now - (T.pourStart + (v.depth - 1) * dl)) / dl, 0, 1) * pass[v.idx];
      return Object.freeze({ child: v.idx, parent: v.parentIdx, x1: p.x, y1: p.y, x2: c.x, y2: c.y, drawn, front, isLeft: v.bit === 0, bit: v.bit });
    });

    // 覆盖条：每个叶子对应 size 个地址（按选中程度计算的接住、漏、重复）
    const cover = tree.leaves.map((li) => {
      const leaf = tree.nodes[li];
      const S = pathOf(tree, li).reduce((s, idx) => s + m[idx], 0);
      const cv = Math.min(1, S);
      return Object.freeze({
        idx: li, start: leaf.start, size: leaf.size,
        c: f[li] * cv, l: f[li] * (1 - cv), o: f[li] * Math.max(0, S - 1)
      });
    });

    const totals = Object.freeze({
      caught: nodes.reduce((s, v) => s + v.primary, 0),
      leak: nodes.reduce((s, v) => s + v.leak, 0),
      over: nodes.reduce((s, v) => s + v.dup, 0),
      root: ROOT_SIZE
    });

    const tags = [];
    tags.push(tagState({ id: 'pour', text: `注水 ${ROOT_SIZE}`, tone: 'note', at: T.pourStart + 0.1, life: 1.6, anchor: 'spout' }, now));
    CASES.forEach((c, k) => {
      const anchor = c.at === 'leak' ? 'leak' : tree.byId.get(c.at);
      tags.push(tagState({ id: c.id, text: c.tag, tone: c.tone, at: T.caseStart + k * T.caseSpan + 1.0, life: 3.2, anchor: typeof anchor === 'number' ? { node: anchor } : { leak: true } }, now));
    });

    const phase = phaseIndexAt(now);
    const banner = {
      none: '未选子网', ok: '合法', ancestor: '祖先关系', leak: '漏水', count: '不是三个子网', fit: '装不下需求'
    }[verdict.verdict];

    return Object.freeze({
      t: now,
      phase,
      phaseCount: PHASES.length,
      phaseName: PHASES[phase].title,
      caption: PHASES[phase].caption,
      nodes,
      pipes,
      cover,
      totals,
      tags,
      split1: clamp((now - T.split1) / 0.3, 0, 1),
      split2: clamp((now - T.split2) / 0.3, 0, 1),
      bitLit: [clamp((now - T.split1) / 0.3, 0, 1), clamp((now - T.split2) / 0.3, 0, 1)],
      ids,
      verdict,
      banner,
      ready: now >= T.pourStart + 2 * dl + T.pourFill
    });
  }

  const api = {
    ROOT_SIZE, ROOT_PREFIX, BASE, MAX_DEPTH, DEMANDS, CASES, T, PHASES, DURATION,
    X0, W, NODE_Y, TRAY_Y, TRAY_H, LEAK_Y, LEAK_H, STRIP_Y, STRIP_H, SPOUT_TOP,
    xOf, xAddr, buildTree, pathOf, ancestorsOf, evaluateSelection,
    scriptedKeyframes, userKeyframe, setAt, membership, sample, phaseIndexAt, smooth, delta
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VlsmModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
