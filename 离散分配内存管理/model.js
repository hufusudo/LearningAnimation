/**
 * 离散分配存储管理 · 推演模型（纯计算，不碰 DOM）
 * 每一步只做一件事：after 是 before 加上这一步的一次状态变化；画面由 choreo.js 按（步，进度）算出。
 * 示意约定见 设计方案.md §4。
 */
const DiscreteModel = (() => {
  const KB = 1024;
  const PAGE = 4 * KB;
  const ENTRY = 4;
  const FREE = 'free';
  const OTHER = 'other';
  const REG = { paging: 0xc0004000, seg: 0xc0008000, segpage: 0xc0009000, twolevel: 0xc0001000 };
  const PT_BASE = { A: 0xc0005000, B: 0xc0006000 };
  const DUR = { init: 0.8, table: 1.1, write: 1.1, load: 1.5, split: 1.2, lookup: 1.1, descend: 1.0, fetch: 1.0, check: 1.0, concat: 1.0, access: 1.3, mark: 1.1 };
  const PHASE = { init: '就绪', load: '装入 · 建立映射', access: '访问 · 地址变换' };

  const hex = (n) => `0x${n.toString(16).toUpperCase()}`;
  const clone = (s) => JSON.parse(JSON.stringify(s));

  // 逐步推演：push 记录一步，mutate 只在副本上施加这一步的变化
  function seqOf(init) {
    let cur = clone(init);
    const steps = [];
    return {
      init,
      steps,
      cur: () => cur,
      push(step, mutate) {
        const next = clone(cur);
        if (mutate) mutate(next);
        steps.push({ ...step, after: next });
        cur = next;
      },
    };
  }

  // 补上每步的起止时刻（秒，1× 速度）
  function finish(q, meta) {
    let t = 0;
    const steps = q.steps.map((s, index) => {
      const dur = DUR[s.kind];
      const step = { ...s, index, phaseName: PHASE[s.phase], start: t, dur };
      t += dur;
      return step;
    });
    return { ...meta, init: q.init, steps, total: t };
  }

  // 主存中连续的空闲区间 [a, b)，单位为内存单元
  function freeRuns(mem) {
    const runs = [];
    let a = -1;
    for (let u = 0; u <= mem.length; u++) {
      const free = u < mem.length && mem[u] === FREE;
      if (free && a < 0) a = u;
      if (!free && a >= 0) { runs.push([a, u]); a = -1; }
    }
    return runs;
  }

  // 分页与二级页表：主存 8 个页框，p 表示页号，frame 表示页框号
  function paging() {
    const init = { frames: [OTHER, FREE, OTHER, FREE, OTHER, OTHER, OTHER, FREE], pt: [null, null, null] };
    const q = seqOf(init);
    q.push({ kind: 'init', phase: 'init', action: '就绪', narr: '进程 3 页待装入；主存 8 个页框，其中 5 个被其他进程占用。' });
    [['P0', 0, 3], ['P1', 1, 7], ['P2', 2, 1]].forEach(([unit, page, frame]) => {
      q.push({ kind: 'write', phase: 'load', action: '写页表项', ref: { table: 'pt', row: page, frame },
        narr: `页表项 ${page} 登记块号 ${frame}：${unit} 将装入页框 ${frame}。` },
      (s) => { s.pt[page] = frame; });
      q.push({ kind: 'load', phase: 'load', action: '装入数据', ref: { unit, frame },
        narr: `${unit} 的数据搬入页框 ${frame}，映射生效。` },
      (s) => { s.frames[frame] = unit; });
    });

    const va = { page: 1, off: 0x2f0 };
    const frame = q.cur().pt[va.page];
    const pa = frame * PAGE + va.off;
    const entry = REG.paging + va.page * ENTRY;
    q.push({ kind: 'split', phase: 'access', action: '拆分地址', narr: `CPU 访问逻辑地址 ${hex(va.page * PAGE + va.off)}：拆成页号 ${va.page} 与页内偏移 ${hex(va.off)}。` });
    q.push({ kind: 'lookup', phase: 'access', action: '查页表项', ref: { table: 'pt', row: va.page, field: 0 }, mem: 1,
      narr: `以页号 ${va.page} 为下标读页表项，地址 ${hex(entry)}（第 1 次访存）。` });
    q.push({ kind: 'fetch', phase: 'access', action: '取块号', ref: { table: 'pt', row: va.page, col: 1 },
      narr: `页表项 ${va.page} 给出块号 ${frame}，送往地址拼接。` });
    q.push({ kind: 'concat', phase: 'access', action: '拼接地址', ref: {},
      narr: `块号 ${frame} × 4KB 加页内偏移 ${hex(va.off)}，得物理地址 ${hex(pa)}。` });
    q.push({ kind: 'access', phase: 'access', action: '访问主存', ref: { frame }, mem: 2,
      narr: `第 2 次访存：读取页框 ${frame} 偏移 ${hex(va.off)} 处的数据。` });

    return finish(q, {
      key: 'paging', name: '基本分页', reg: `PTR = ${hex(REG.paging)}`, memTotal: 2,
      fields: [{ name: '页号', text: String(va.page) }, { name: '偏移', text: hex(va.off) }],
      whole: hex(va.page * PAGE + va.off), join: '× 4KB +', blockLabel: (b) => `块 ${b}`,
      result: { pa, frame, off: va.off },
    });
  }

  // 分段：主存 128KB，按 1KB 单元；首次适应分配
  function segmentation() {
    const SEGS = [{ size: 36 }, { size: 24 }, { size: 16 }];
    const mem = new Array(128).fill(FREE);
    const fill = (a, n, who) => { for (let u = a; u < a + n; u++) mem[u] = who; };
    fill(0, 8, OTHER); fill(48, 8, OTHER); fill(112, 16, OTHER);
    const init = { mem, segRow: [null, null, null] };
    const q = seqOf(init);
    q.push({ kind: 'init', phase: 'init', action: '就绪', narr: '进程分 3 段；主存空闲区不连续，每段只能放进一块足够大的空闲区。' });
    SEGS.forEach((g, k) => {
      const run = freeRuns(q.cur().mem).find(([a, b]) => b - a >= g.size);
      const base = run[0];
      const len = g.size;
      q.push({ kind: 'write', phase: 'load', action: '写段表项', ref: { table: 'seg', row: k, run },
        narr: `${k ? '首次适应：' : ''}段表项 ${k} 记基址 ${hex(base * KB)}、段长 ${hex(len * KB)}。` },
      (s) => { s.segRow[k] = { base: base * KB, len: len * KB }; });
      q.push({ kind: 'load', phase: 'load', action: '装入段', ref: { unit: `seg${k}`, range: [base, base + len] },
        narr: `段 ${k} 装入 ${hex(base * KB)} 起的 ${len}K 区域。` },
      (s) => { for (let u = base; u < base + len; u++) s.mem[u] = `seg${k}`; });
    });

    const frags = freeRuns(q.cur().mem);
    const fragSum = frags.reduce((sum, [a, b]) => sum + (b - a), 0);
    q.push({ kind: 'mark', phase: 'load', action: '标出碎片', ref: { frags },
      narr: `段间留下 ${frags.length} 块碎片，共 ${fragSum}K，互不相邻，无法合并使用。` });

    const row = q.cur().segRow[1];
    const off = 0x0a00;
    const pa = row.base + off;
    q.push({ kind: 'split', phase: 'access', action: '拆分地址', narr: `CPU 访问段 1 内偏移 ${hex(off)}：段号与段内偏移分开取用。` });
    q.push({ kind: 'lookup', phase: 'access', action: '查段表项', ref: { table: 'seg', row: 1, field: 0 }, mem: 1,
      narr: `以段号 1 为下标读段表项 1（第 1 次访存）：基址与段长一并取出。` });
    q.push({ kind: 'check', phase: 'access', action: '越界检查', ref: { table: 'seg', row: 1, off, len: row.len },
      narr: `比较偏移与段长：${hex(off)} < ${hex(row.len)}，未越界。` });
    q.push({ kind: 'fetch', phase: 'access', action: '取基址', ref: { table: 'seg', row: 1, col: 2 },
      narr: `段表项 1 的基址 ${hex(row.base)} 送往地址拼接。` });
    q.push({ kind: 'concat', phase: 'access', action: '拼接地址', ref: {},
      narr: `基址 ${hex(row.base)} + 段内偏移 ${hex(off)} = ${hex(pa)}。` });
    q.push({ kind: 'access', phase: 'access', action: '访问主存', ref: { unit: 'seg1', pa }, mem: 2,
      narr: `第 2 次访存：读取物理地址 ${hex(pa)} 处的数据。` });

    return finish(q, {
      key: 'seg', name: '基本分段', reg: `STR = ${hex(REG.seg)}`, memTotal: 2,
      fields: [{ name: '段号', text: '1' }, { name: '段内偏移', text: hex(off) }],
      whole: `段 1 · ${hex(off)}`, join: '+', blockLabel: (b) => hex(b),
      result: { pa, base: row.base, off },
    });
  }

  // 段页式：段表项指向页表；页表项给出块号。三次访存。
  function segpage() {
    const init = { frames: ['free', 'other', 'free', 'other', 'free', 'free', 'other', 'other'], seg: [null, null], ptA: [null, null], ptB: [null, null] };
    const q = seqOf(init);
    q.push({ kind: 'init', phase: 'init', action: '就绪', narr: '进程 2 段，每段 2 页；段表与页表都放在内核区，页在主存中离散存放。' });
    const plan = [
      { seg: 0, tab: 'A', pages: [{ page: 0, frame: 2 }, { page: 1, frame: 5 }] },
      { seg: 1, tab: 'B', pages: [{ page: 0, frame: 0 }, { page: 1, frame: 4 }] },
    ];
    plan.forEach((g) => {
      const pt = `pt${g.tab}`;
      q.push({ kind: 'table', phase: 'load', action: '建页表', ref: { table: 'seg', row: g.seg, tab: g.tab },
        narr: `段表项 ${g.seg} 指向新建的页表 ${g.tab}（段 ${g.seg} 的页表）。` },
      (s) => { s.seg[g.seg] = g.tab; });
      g.pages.forEach(({ page, frame }) => {
        const unit = `S${g.seg}P${page}`;
        q.push({ kind: 'write', phase: 'load', action: '写页表项', ref: { table: pt, row: page, frame },
          narr: `页表 ${g.tab} 项 ${page} 登记块号 ${frame}：段 ${g.seg} 的 P${page} 将装入页框 ${frame}。` },
        (s) => { s[pt][page] = frame; });
        q.push({ kind: 'load', phase: 'load', action: '装入数据', ref: { unit, frame },
          narr: `段 ${g.seg} · P${page} 搬入页框 ${frame}。` },
        (s) => { s.frames[frame] = unit; });
      });
    });

    const va = { seg: 1, page: 1, off: 0x2f0 };
    const frame = q.cur().ptB[va.page];
    const pa = frame * PAGE + va.off;
    const segEntry = REG.segpage + va.seg * ENTRY;
    const ptEntry = PT_BASE.B + va.page * ENTRY;
    q.push({ kind: 'split', phase: 'access', action: '拆分地址', narr: `CPU 访问段 ${va.seg} · 页 ${va.page} · 偏移 ${hex(va.off)}：拆成三个字段。` });
    q.push({ kind: 'lookup', phase: 'access', action: '查段表项', ref: { table: 'seg', row: va.seg, field: 0 }, mem: 1,
      narr: `以段号 ${va.seg} 为下标读段表项，地址 ${hex(segEntry)}（第 1 次访存）。` });
    q.push({ kind: 'descend', phase: 'access', action: '进入页表', ref: { table: 'ptB', from: { table: 'seg', row: va.seg } },
      narr: `段表项给出页表 B 的位置，转入页表 B。` });
    q.push({ kind: 'lookup', phase: 'access', action: '查页表项', ref: { table: 'ptB', row: va.page, field: 1 }, mem: 2,
      narr: `以页号 ${va.page} 为下标读页表 B，地址 ${hex(ptEntry)}（第 2 次访存）。` });
    q.push({ kind: 'fetch', phase: 'access', action: '取块号', ref: { table: 'ptB', row: va.page, col: 1 },
      narr: `页表项 ${va.page} 给出块号 ${frame}，送往地址拼接。` });
    q.push({ kind: 'concat', phase: 'access', action: '拼接地址', ref: {},
      narr: `块号 ${frame} × 4KB 加页内偏移 ${hex(va.off)}，得物理地址 ${hex(pa)}。` });
    q.push({ kind: 'access', phase: 'access', action: '访问主存', ref: { frame }, mem: 3,
      narr: `第 3 次访存：读取页框 ${frame} 偏移 ${hex(va.off)} 处的数据。` });

    return finish(q, {
      key: 'segpage', name: '段页式', reg: `STR = ${hex(REG.segpage)}`, memTotal: 3,
      fields: [{ name: '段号', text: String(va.seg) }, { name: '页号', text: String(va.page) }, { name: '偏移', text: hex(va.off) }],
      whole: hex(va.seg * 2 * PAGE + va.page * PAGE + va.off), join: '× 4KB +', blockLabel: (b) => `块 ${b}`,
      result: { pa, frame, off: va.off },
    });
  }

  // 二级页表：页目录常驻内核区，二级页表占用主存页框；页目录项里记的是页框号
  function twolevel() {
    const init = { frames: ['other', 'free', 'other', 'free', 'free', 'other', 'free', 'free'], dir: [null, null], t0: [null, null], t1: [null, null] };
    const q = seqOf(init);
    q.push({ kind: 'init', phase: 'init', action: '就绪', narr: '进程 3 页待装入；页目录常驻内核区，二级页表按需放进主存页框。' });
    const plan = [
      { k: 0, frame: 6, pages: [{ page: 0, frame: 3, unit: 'P0' }, { page: 1, frame: 7, unit: 'P1' }] },
      { k: 1, frame: 4, pages: [{ page: 0, frame: 1, unit: 'P2' }] },
    ];
    plan.forEach((g) => {
      const tb = `t${g.k}`;
      q.push({ kind: 'table', phase: 'load', action: '建二级页表', ref: { table: 'dir', row: g.k, frame: g.frame, tab: tb },
        narr: `在页框 ${g.frame} 建立二级页表 ${g.k}，页目录项 ${g.k} 记为块 ${g.frame}。` },
      (s) => { s.dir[g.k] = g.frame; s.frames[g.frame] = `PT${g.k}`; });
      g.pages.forEach(({ page, frame, unit }) => {
        q.push({ kind: 'write', phase: 'load', action: '写页表项', ref: { table: tb, row: page, frame },
          narr: `二级页表 ${g.k} 项 ${page} 登记块号 ${frame}：${unit} 将装入页框 ${frame}。` },
        (s) => { s[tb][page] = frame; });
        q.push({ kind: 'load', phase: 'load', action: '装入数据', ref: { unit, frame },
          narr: `${unit} 的数据搬入页框 ${frame}。` },
        (s) => { s.frames[frame] = unit; });
      });
    });

    const va = { dir: 1, page: 0, off: 0x4c0 };
    const frame = q.cur().t1[va.page];
    const pa = frame * PAGE + va.off;
    const dirEntry = REG.twolevel + va.dir * ENTRY;
    q.push({ kind: 'split', phase: 'access', action: '拆分地址', narr: `CPU 访问逻辑地址 ${hex((va.dir * 2 + va.page) * PAGE + va.off)}：拆成目录号、页号、偏移。` });
    q.push({ kind: 'lookup', phase: 'access', action: '查页目录项', ref: { table: 'dir', row: va.dir, field: 0 }, mem: 1,
      narr: `以目录号 ${va.dir} 为下标读页目录项，地址 ${hex(dirEntry)}（第 1 次访存）。` });
    q.push({ kind: 'descend', phase: 'access', action: '进入页表', ref: { table: 't1', from: { table: 'dir', row: va.dir } },
      narr: `页目录项 ${va.dir} 给出二级页表 ${va.dir} 所在的块 ${q.cur().dir[va.dir]}。` });
    q.push({ kind: 'lookup', phase: 'access', action: '查页表项', ref: { table: 't1', row: va.page, field: 1 }, mem: 2,
      narr: `以页号 ${va.page} 为下标读二级页表 ${va.dir} 的项 ${va.page}（第 2 次访存）。` });
    q.push({ kind: 'fetch', phase: 'access', action: '取块号', ref: { table: 't1', row: va.page, col: 1 },
      narr: `二级页表项 ${va.page} 给出块号 ${frame}，送往地址拼接。` });
    q.push({ kind: 'concat', phase: 'access', action: '拼接地址', ref: {},
      narr: `块号 ${frame} × 4KB 加页内偏移 ${hex(va.off)}，得物理地址 ${hex(pa)}。` });
    q.push({ kind: 'access', phase: 'access', action: '访问主存', ref: { frame }, mem: 3,
      narr: `第 3 次访存：读取页框 ${frame} 偏移 ${hex(va.off)} 处的数据。` });

    return finish(q, {
      key: 'twolevel', name: '二级页表', reg: `PDBR = ${hex(REG.twolevel)}`, memTotal: 3,
      fields: [{ name: '目录号', text: String(va.dir) }, { name: '页号', text: String(va.page) }, { name: '偏移', text: hex(va.off) }],
      whole: hex((va.dir * 2 + va.page) * PAGE + va.off), join: '× 4KB +', blockLabel: (b) => `块 ${b}`,
      result: { pa, frame, off: va.off },
    });
  }

  const BUILDERS = { paging, seg: segmentation, segpage, twolevel };
  const MODE_KEYS = Object.keys(BUILDERS);

  return { KB, PAGE, ENTRY, FREE, OTHER, MODE_KEYS, build: (key) => BUILDERS[key](), freeRuns, hex };
})();

if (typeof module === 'object' && module.exports) module.exports = DiscreteModel;
