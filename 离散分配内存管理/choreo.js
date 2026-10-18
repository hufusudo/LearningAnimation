/**
 * 离散分配存储管理 · 视觉编排（纯函数，只依赖（步，进度））
 * viewAt(scn, t) 给出这一刻应当画出的全部元素；界面只负责把它写成 SVG。
 * 过渡约定：先用蓝色外环指出对象（引导），再翻牌、交叉淡入或飞行（过渡），回执排在最后。
 */
const DiscreteChoreo = (() => {
  const M = typeof DiscreteModel !== 'undefined' ? DiscreteModel : require('./model.js');

  const LX = 36;
  const LW = 260;
  const MX = 360;
  const RX = 760;
  const RW = 300;
  const Y0 = 56;
  const PITCH = 46;
  const RH = 42;
  const KB_H = 368 / 128; // 分段：主存每 1KB 的像素高度

  const hex = M.hex;
  const lerp = (a, b, q) => a + (b - a) * q;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const win = (p, a, b) => clamp01((p - a) / (b - a));
  const ease = (q) => q * q * (3 - 2 * q);
  const guideA = (p) => ease(win(p, 0, 0.25)) * (1 - ease(win(p, 0.85, 1)));   // 外环：先亮后收
  const chipA = (p, end) => ease(win(p, 0, 0.08)) * (1 - ease(win(p, end, end + 0.12))); // 飞行芯片两端淡入淡出
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pad = (r, n) => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });

  // 二次贝塞尔：穿过左右两列之间的缝隙，或在下方绕过中列
  const quad = (a, c, b, q) => ({
    x: (1 - q) * (1 - q) * a.x + 2 * (1 - q) * q * c.x + q * q * b.x,
    y: (1 - q) * (1 - q) * a.y + 2 * (1 - q) * q * c.y + q * q * b.y,
  });
  const gapCurve = (a, b, q) => quad(a, { x: 330, y: (a.y + b.y) / 2 }, b, q);
  const archPt = (a, b, q) => {
    const my = (a.y + b.y) / 2;
    const cy = Math.min(462, Math.max(my + 40, 600 - my));
    return quad(a, { x: (a.x + b.x) / 2, y: cy }, b, q);
  };
  const lerpPt = (a, b, q) => ({ x: lerp(a.x, b.x, q), y: lerp(a.y, b.y, q) });

  // 主存某个单元的归属 → 颜色类与文字
  function ownerInfo(owner) {
    if (owner === M.FREE) return { cls: 'free', label: '空闲' };
    if (owner === M.OTHER) return { cls: 'other', label: '他进程' };
    if (owner.startsWith('PT')) return { cls: 'kernel', label: `页表 ${owner.slice(2)}` };
    let m = /^S(\d)P(\d)$/.exec(owner);
    if (m) return { cls: `u${m[1]}`, label: `S${m[1]}·P${m[2]}` };
    m = /^P(\d)$/.exec(owner);
    if (m) return { cls: `u${m[1]}`, label: owner };
    m = /^seg(\d)$/.exec(owner);
    if (m) return { cls: `u${m[1]}`, label: `段 ${m[1]}` };
    return { cls: 'other', label: owner };
  }

  // 第几步、这一步走到哪一步的进度
  // EPS 吸收浮点误差：时刻在步界上差之毫厘时，归入后一步（否则“下一步”会原地踏步）
  const EPS = 1e-6;
  function locate(scn, t, reduce = false) {
    const tt = Math.min(Math.max(t, 0), scn.total);
    if (tt >= scn.total - EPS) return { i: scn.steps.length - 1, p: 1 };
    let i = scn.steps.length - 1;
    for (let k = 0; k < scn.steps.length; k++) {
      const s = scn.steps[k];
      if (tt < s.start + s.dur - EPS) { i = k; break; }
    }
    const s = scn.steps[i];
    return { i, p: reduce ? 1 : clamp01((tt - s.start) / s.dur) };
  }

  // 连续相同归属的区间 [a, b)
  function runsBy(arr, ok) {
    const out = [];
    let r = null;
    arr.forEach((o, u) => {
      if (!ok(u)) { r = null; return; }
      if (r && r.owner === o) r.b = u + 1;
      else { r = { owner: o, a: u, b: u + 1 }; out.push(r); }
    });
    return out;
  }

  const ptTable = (id, x, title) => ({
    id, x, rowY: [182, 220], h: 34, cols: [{ dx: 0, w: 60 }, { dx: 60, w: 100 }],
    box: { x, y: 160, w: 160, h: 98, title },
  });

  // 公式框：块号 × 4KB + 偏移 = 结果（分段为 基址 + 偏移）
  function formulaAt(F, seg) {
    const block = { x: LX + 12, y: F + 30, w: seg ? 110 : 96, h: 26 };
    const off = { x: LX + (seg ? 140 : 164), y: F + 30, w: seg ? 108 : 84, h: 26 };
    return { x: LX, y: F, w: LW, h: 100, block, off, res: { x: LX + 12, y: F + 66, w: 236, h: 26 }, joinAt: { x: (block.x + block.w + off.x) / 2, y: F + 47 } };
  }

  // 各模式的版面：左列逻辑空间，中列表（内核区），右列主存（用户区）
  function geometry(scn) {
    const frames = Array.from({ length: 8 }, (_, j) => ({ x: RX, y: Y0 + PITCH * j, w: RW, h: RH }));
    switch (scn.key) {
      case 'paging':
        return {
          frames,
          logical: [0, 1, 2].map((u) => ({ id: `P${u}`, label: `P${u}`, x: LX, y: Y0 + PITCH * u, w: LW, h: RH, cls: `u${u}` })),
          tables: { pt: { id: 'pt', x: MX, rowY: [Y0, Y0 + PITCH, Y0 + 2 * PITCH], h: RH, cols: [{ dx: 0, w: 80 }, { dx: 80, w: 260 }], box: null } },
          bar: { x: LX, y: 236, w: LW, h: 36 },
          fields: [{ x: LX, y: 236, w: 96, h: 36 }, { x: LX + 104, y: 236, w: 156, h: 36 }],
          formula: formulaAt(300, false),
        };
      case 'segpage':
        return {
          frames,
          logical: [
            { id: 'S0P0', label: '段0·P0', x: LX, y: Y0, w: LW, h: RH, cls: 'u0' },
            { id: 'S0P1', label: '段0·P1', x: LX, y: Y0 + PITCH, w: LW, h: RH, cls: 'u0' },
            { id: 'S1P0', label: '段1·P0', x: LX, y: Y0 + 104, w: LW, h: RH, cls: 'u1' },
            { id: 'S1P1', label: '段1·P1', x: LX, y: Y0 + 150, w: LW, h: RH, cls: 'u1' },
          ],
          tables: {
            seg: { id: 'seg', x: MX, rowY: [Y0, Y0 + PITCH], h: RH, cols: [{ dx: 0, w: 80 }, { dx: 80, w: 260 }], box: null },
            ptA: ptTable('ptA', MX, '页表 A · 段 0'),
            ptB: ptTable('ptB', MX + 180, '页表 B · 段 1'),
          },
          bar: { x: LX, y: 262, w: LW, h: 36 },
          fields: [{ x: LX, y: 262, w: 76, h: 36 }, { x: LX + 82, y: 262, w: 76, h: 36 }, { x: LX + 164, y: 262, w: 96, h: 36 }],
          formula: formulaAt(312, false),
        };
      case 'twolevel':
        return {
          frames,
          logical: [0, 1, 2].map((u) => ({ id: `P${u}`, label: `P${u}`, x: LX, y: Y0 + PITCH * u, w: LW, h: RH, cls: `u${u}` })),
          tables: {
            dir: { id: 'dir', x: MX, rowY: [Y0, Y0 + PITCH], h: RH, cols: [{ dx: 0, w: 80 }, { dx: 80, w: 260 }], box: null },
            t0: ptTable('t0', MX, '二级页表 0'),
            t1: ptTable('t1', MX + 180, '二级页表 1'),
          },
          bar: { x: LX, y: 214, w: LW, h: 36 },
          fields: [{ x: LX, y: 214, w: 76, h: 36 }, { x: LX + 82, y: 214, w: 76, h: 36 }, { x: LX + 164, y: 214, w: 96, h: 36 }],
          formula: formulaAt(268, false),
        };
      default: { // seg：左列按段长等比，右列主存按 1KB 单元
        const sizes = [36, 24, 16];
        let y = Y0;
        const logical = sizes.map((s, k) => {
          const h = s * KB_H - 4;
          const L = { id: `seg${k}`, label: `段 ${k} · ${['代码段', '数据段', '栈段'][k]}`, x: LX, y, w: LW, h, cls: `u${k}` };
          y += h + 4;
          return L;
        });
        return {
          frames: null,
          logical,
          mem: { x: RX, y: Y0, w: RW, k: KB_H },
          tables: { seg: { id: 'seg', x: MX, rowY: [Y0, Y0 + PITCH, Y0 + 2 * PITCH], h: RH, cols: [{ dx: 0, w: 70 }, { dx: 70, w: 130 }, { dx: 200, w: 140 }], box: null } },
          bar: { x: LX, y: 296, w: LW, h: 36 },
          fields: [{ x: LX, y: 296, w: 96, h: 36 }, { x: LX + 104, y: 296, w: 156, h: 36 }],
          formula: formulaAt(352, true),
          compare: { x: MX, y: 200, w: 200, h: 26 },
        };
      }
    }
  }

  // 表项的取值（分段的段表项是对象，段页式的段表项是页表名，页式是块号）
  function valuesOf(id, S, scn) {
    if (id === 'seg') return scn.key === 'seg' ? S.segRow : S.seg;
    return S[id];
  }
  const existsIn = (id, S) => {
    if (id === 'ptA') return S.seg[0] !== null;
    if (id === 'ptB') return S.seg[1] !== null;
    if (id === 't0') return S.dir[0] !== null;
    if (id === 't1') return S.dir[1] !== null;
    return true;
  };
  function cellText(ci, val) {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'string') return `页表 ${val}`;
    if (typeof val === 'object') return ci === 1 ? hex(val.len) : hex(val.base);
    return `块 ${val}`;
  }

  // 已装入时的位置：分页系为页框号，分段为基址
  function loadedAt(scn, S, id) {
    if (scn.key === 'seg') {
      if (S.mem.indexOf(id) < 0) return null;
      return S.segRow[Number(id.slice(3))].base;
    }
    const f = S.frames.indexOf(id);
    return f < 0 ? null : f;
  }

  function viewAt(scn, t, opts = {}) {
    const geo = geometry(scn);
    const { i, p } = locate(scn, t, !!opts.reduce);
    const st = scn.steps[i];
    const B = i > 0 ? scn.steps[i - 1].after : scn.init;
    const A = st.after;
    const ref = st.ref || {};
    const g = guideA(p);

    const rowBox = (tb, r) => ({ x: tb.x, y: tb.rowY[r] - 3, w: tb.cols.reduce((s, c) => s + c.w, 0), h: tb.h + 6 });
    const cellC = (tb, r, c) => ({ x: tb.x + tb.cols[c].dx + tb.cols[c].w / 2, y: tb.rowY[r] + tb.h / 2 });
    const cellR = (tb, r, c) => ({ x: tb.x + tb.cols[c].dx + tb.cols[c].w, y: tb.rowY[r] + tb.h / 2 });
    const fieldC = (k) => ({ x: geo.fields[k].x + geo.fields[k].w / 2, y: geo.fields[k].y + geo.fields[k].h / 2 });
    const slotC = (s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

    const v = {
      i, p, kind: st.kind, phase: st.phaseName, action: st.action, narr: st.narr,
      n: scn.steps.length, time: Math.min(Math.max(t, 0), scn.total), total: scn.total,
      logical: [], frames: [], mem: null, tables: [], chips: [], rings: [], lines: [],
      bar: null, formula: null, compare: null, frags: [],
    };

    // 逻辑空间：装入后显示去向，过渡时淡入
    v.logical = geo.logical.map((L) => {
      const before = loadedAt(scn, B, L.id);
      const after = loadedAt(scn, A, L.id);
      return {
        ...L,
        tag: after === null ? '' : (scn.key === 'seg' ? `→ ${hex(after)}` : `→ 块 ${after}`),
        tagAlpha: before !== null ? 1 : (after !== null ? ease(win(p, 0.85, 1)) : 0),
      };
    });

    // 页框：归属变化时新旧交叉淡入
    if (geo.frames) {
      v.frames = geo.frames.map((F, j) => {
        const ob = B.frames[j];
        const oa = A.frames[j];
        const ch = ob !== oa;
        return { ...F, base: ownerInfo(ob), top: ch ? ownerInfo(oa) : null, topAlpha: ch ? ease(win(p, 0.75, 1)) : 0 };
      });
    }

    // 分段主存：按单元记录归属，连续同归属合并为区间
    if (geo.mem) {
      const { x, y, w, k } = geo.mem;
      const changedU = (u) => B.mem[u] !== A.mem[u];
      const topA = ease(win(p, 0.75, 1));
      v.mem = {
        x, y, w, k,
        base: runsBy(B.mem, () => true),
        top: runsBy(A.mem, changedU).map((r) => ({ ...r, alpha: topA })),
        labels: runsBy(A.mem, () => true)
          .filter((r) => (r.b - r.a) * k >= 20)
          .map((r) => {
            const ch = B.mem.slice(r.a, r.b).some((o, idx) => o !== A.mem[r.a + idx]);
            return { ...r, text: ownerInfo(r.owner).label, alpha: ch ? topA : 1 };
          }),
      };
    }

    // 表：存在性淡入；表项写入时翻牌（先缩成一条线，中途换值，再展开）
    v.tables = Object.values(geo.tables).filter((tb) => existsIn(tb.id, A)).map((tb) => {
      const boxA = existsIn(tb.id, B) ? 1 : ease(win(p, 0, 0.5));
      const vb = valuesOf(tb.id, B, scn);
      const va = valuesOf(tb.id, A, scn);
      return {
        ...tb,
        alpha: boxA,
        rows: tb.rowY.map((y, r) => {
          const bRow = vb[r];
          const aRow = va[r];
          const ch = !same(bRow, aRow);
          const q = ch ? win(p, 0.3, 0.7) : 1;
          const shown = ch && q < 0.5 ? bRow : aRow;
          return {
            y,
            cells: tb.cols.map((c, ci) => ({
              x: tb.x + c.dx,
              w: c.w,
              text: ci === 0 ? String(r) : cellText(ci, shown),
              sy: ci === 0 || !ch ? 1 : Math.abs(1 - 2 * q),
            })),
          };
        }),
      };
    });

    // 本步的引导与过渡
    switch (st.kind) {
      case 'table':
        if (ref.table === 'dir') {
          const f = geo.frames[ref.frame];
          v.rings.push({ ...pad(f, 4), alpha: g });
          v.lines.push({ a: { x: RX, y: f.y + f.h / 2 }, b: cellR(geo.tables.dir, ref.row, 1), draw: ease(win(p, 0.3, 0.7)), alpha: 1 - ease(win(p, 0.8, 1)) });
        } else {
          v.rings.push({ ...rowBox(geo.tables.seg, ref.row), alpha: g });
        }
        break;
      case 'write':
        if (scn.key === 'seg') {
          const [a, b] = ref.run;
          v.rings.push({ x: RX - 4, y: Y0 + a * KB_H - 2, w: RW + 8, h: (b - a) * KB_H + 4, alpha: g });
          v.lines.push({ a: { x: RX, y: Y0 + ((a + b) / 2) * KB_H }, b: cellR(geo.tables.seg, ref.row, 2), draw: ease(win(p, 0.3, 0.7)), alpha: 1 - ease(win(p, 0.8, 1)) });
        } else {
          const f = geo.frames[ref.frame];
          v.rings.push({ ...pad(f, 4), alpha: g });
          v.lines.push({ a: { x: RX, y: f.y + f.h / 2 }, b: cellR(geo.tables[ref.table], ref.row, 1), draw: ease(win(p, 0.3, 0.7)), alpha: 1 - ease(win(p, 0.8, 1)) });
        }
        break;
      case 'load': {
        const L = geo.logical.find((u) => u.id === ref.unit);
        const info = ownerInfo(ref.unit);
        if (scn.key === 'seg') {
          const [a, b] = ref.range;
          const part = { x: RX, y: Y0 + a * KB_H, w: RW, h: (b - a) * KB_H };
          v.rings.push({ ...pad(part, 4), alpha: g });
          const q = ease(win(p, 0, 0.8));
          const c = archPt({ x: L.x + L.w / 2, y: L.y + L.h / 2 }, { x: part.x + part.w / 2, y: part.y + part.h / 2 }, q);
          const w = lerp(L.w, part.w, q);
          const h = lerp(L.h, part.h, q);
          v.chips.push({ x: c.x - w / 2, y: c.y - h / 2, w, h, text: info.label, cls: info.cls, alpha: chipA(p, 0.8) });
        } else {
          const f = geo.frames[ref.frame];
          v.rings.push({ ...pad(f, 4), alpha: g });
          const c = archPt({ x: L.x + L.w, y: L.y + L.h / 2 }, { x: f.x + f.w / 2, y: f.y + f.h / 2 }, ease(win(p, 0, 0.8)));
          v.chips.push({ x: c.x - 26, y: c.y - 11, w: 52, h: 22, text: info.label, cls: info.cls, alpha: chipA(p, 0.8) });
        }
        break;
      }
      case 'lookup': {
        const fld = scn.fields[ref.field];
        const c = gapCurve(fieldC(ref.field), cellC(geo.tables[ref.table], ref.row, 0), ease(win(p, 0, 0.8)));
        v.chips.push({ x: c.x - 36, y: c.y - 11, w: 72, h: 22, text: `${fld.name} ${fld.text}`, cls: 'in', alpha: chipA(p, 0.8) });
        break;
      }
      case 'descend': {
        const src = ref.from;
        const from = cellC(geo.tables[src.table], src.row, 1);
        const tb = geo.tables[ref.table];
        const to = { x: tb.box.x + tb.box.w / 2, y: tb.box.y };
        const c = lerpPt(from, to, ease(win(p, 0, 0.8)));
        const text = ref.table.startsWith('pt') ? `页表 ${ref.table.slice(-1)}` : `块 ${A.dir[src.row]}`;
        v.chips.push({ x: c.x - 36, y: c.y - 11, w: 72, h: 22, text, cls: 'out', alpha: chipA(p, 0.8) });
        break;
      }
      case 'fetch': {
        const c = gapCurve(cellC(geo.tables[ref.table], ref.row, ref.col), slotC(geo.formula.block), ease(win(p, 0, 0.7)));
        const text = scn.key === 'seg' ? hex(scn.result.base) : scn.blockLabel(scn.result.frame);
        v.chips.push({ x: c.x - 36, y: c.y - 11, w: 72, h: 22, text, cls: 'out', alpha: chipA(p, 0.7) });
        break;
      }
      case 'concat': {
        const c = lerpPt(fieldC(scn.fields.length - 1), slotC(geo.formula.off), ease(win(p, 0, 0.5)));
        v.chips.push({ x: c.x - 36, y: c.y - 11, w: 72, h: 22, text: hex(scn.result.off), cls: 'in', alpha: chipA(p, 0.6) });
        break;
      }
      case 'access': {
        let target;
        if (scn.key === 'seg') {
          const row = A.segRow[1];
          const part = { x: RX, y: Y0 + (row.base / M.KB) * KB_H, w: RW, h: (row.len / M.KB) * KB_H };
          v.rings.push({ ...pad(part, 4), alpha: g });
          target = { x: RX + 150, y: Y0 + (scn.result.pa / M.KB) * KB_H };
        } else {
          const f = geo.frames[ref.frame];
          v.rings.push({ ...pad(f, 4), alpha: g });
          target = { x: RX + 150, y: f.y + f.h / 2 };
        }
        const c = lerpPt(slotC(geo.formula.res), target, ease(win(p, 0, 0.7)));
        v.chips.push({ x: c.x - 40, y: c.y - 11, w: 80, h: 22, text: hex(scn.result.pa), cls: 'out', alpha: chipA(p, 0.85) });
        break;
      }
      case 'mark':
        ref.frags.forEach(([a, b]) => v.rings.push({ x: RX - 4, y: Y0 + a * KB_H - 2, w: RW + 8, h: (b - a) * KB_H + 4, alpha: g, dashed: true }));
        break;
      default:
        break;
    }

    // 访问阶段的持续信息：拆分字段、公式槽位、访存计数、当前查到的表
    const at = (kind) => scn.steps.findIndex((s) => s.kind === kind && s.phase === 'access');
    const iSplit = at('split');
    if (iSplit >= 0) {
      const bar = geo.bar;
      const bc = { x: bar.x + bar.w / 2, y: bar.y + bar.h / 2 };
      v.bar = {
        whole: { text: scn.whole, x: bc.x, y: bc.y, alpha: i === iSplit ? ease(win(p, 0, 0.2)) * (1 - ease(win(p, 0.45, 0.7))) : 0 },
        fields: scn.fields.map((f, k) => {
          const fr = geo.fields[k];
          const q = i > iSplit ? 1 : (i === iSplit ? ease(win(p, 0.4, 0.85)) : 0);
          const alpha = i > iSplit ? 1 : (i === iSplit ? ease(win(p, 0.4, 0.6)) : 0);
          return { x: lerp(bc.x - fr.w / 2, fr.x, q), y: lerp(bc.y - fr.h / 2, fr.y, q), w: fr.w, h: fr.h, text: `${f.name} ${f.text}`, alpha };
        }),
      };

      const rv = (k, a, b) => (i > k ? 1 : (i === k ? ease(win(p, a, b)) : 0));
      const iFetch = at('fetch');
      const iConcat = at('concat');
      let cnt = 0;
      for (let j = iSplit; j <= i; j++) {
        const s = scn.steps[j];
        if (s.mem && (j < i || p >= 0.8)) cnt = Math.max(cnt, s.mem);
      }
      const fm = geo.formula;
      const bval = scn.result.frame !== undefined ? scn.result.frame : scn.result.base;
      v.formula = {
        x: fm.x, y: fm.y, w: fm.w, h: fm.h, joinAt: fm.joinAt, join: scn.join,
        head: '地址拼接', count: `访存 ${cnt}/${scn.memTotal}`,
        block: { ...fm.block, text: scn.blockLabel(bval), alpha: rv(iFetch, 0.6, 1) },
        off: { ...fm.off, text: hex(scn.result.off), alpha: rv(iConcat, 0.4, 0.7) },
        res: { ...fm.res, text: `= ${hex(scn.result.pa)}`, alpha: rv(iConcat, 0.5, 1) },
      };

      // 当前查到的表（外环）：最近一次访问阶段里带 table 的步骤；过渡中由目标步骤自身亮起
      let fi = -1;
      for (let j = i; j >= iSplit; j--) {
        if (scn.steps[j].ref && scn.steps[j].ref.table) { fi = j; break; }
      }
      if (fi >= 0) {
        const fr = scn.steps[fi].ref;
        const tb = geo.tables[fr.table];
        const rect = fr.row !== undefined ? rowBox(tb, fr.row) : pad(tb.box, 4);
        v.rings.push({ ...rect, alpha: fi === i ? ease(win(p, 0, 0.3)) : 1 });
      }
    }

    // 分段越界检查：比较式与结论持续显示
    const iCheck = at('check');
    if (iCheck >= 0) {
      const cs = scn.steps[iCheck].ref;
      const cmp = geo.compare;
      v.compare = {
        ...cmp,
        text: `${hex(cs.off)} < ${hex(cs.len)}`,
        alpha: i > iCheck ? 1 : (i === iCheck ? ease(win(p, 0, 0.4)) : 0),
        okAlpha: i > iCheck ? 1 : (i === iCheck ? ease(win(p, 0.5, 1)) : 0),
      };
    }

    // 分段碎片：标注一经出现就保持
    const iMark = scn.steps.findIndex((s) => s.kind === 'mark');
    if (iMark >= 0 && i >= iMark) {
      v.frags = scn.steps[iMark].ref.frags.map(([a, b]) => ({
        x: RX - 6, y: Y0 + ((a + b) / 2) * KB_H + 4, text: `碎片 ${b - a}K`,
        alpha: i > iMark ? 1 : ease(win(p, 0.4, 1)),
      }));
    }

    return v;
  }

  // 测试用：每个元素此刻看得出的归属与文字（过渡中取透明度过半的一层）
  function dominantUnits(m) {
    const out = new Array(128).fill(null);
    m.base.forEach((r) => { for (let u = r.a; u < r.b; u++) out[u] = r.owner; });
    m.top.forEach((r) => { if (r.alpha >= 0.5) for (let u = r.a; u < r.b; u++) out[u] = r.owner; });
    return out;
  }
  function snapshot(v) {
    return {
      frames: v.frames.map((f) => (f.top && f.topAlpha >= 0.5 ? f.top.label : f.base.label)),
      mem: v.mem ? dominantUnits(v.mem) : null,
      cells: v.tables.filter((tb) => tb.alpha >= 0.999).map((tb) => tb.rows.map((r) => r.cells.map((c) => (c.sy === 1 ? c.text : '?')))),
      tags: v.logical.map((L) => (L.tagAlpha >= 0.999 ? L.tag : '')),
    };
  }

  return { geometry, locate, viewAt, snapshot, ownerInfo, hex };
})();

if (typeof module === 'object' && module.exports) module.exports = DiscreteChoreo;
