/**
 * SPOOLing 演示的离散节拍模型。时间单位 t 为抽象节拍，全部取整数并逐拍推演。
 * 页在被取走（消费方开始处理）时腾出井位；输入侧与输出侧规则对称。
 * 界面只读取这里算好的区间与状态，渲染时不做任何调度判断。
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    cardPerPage: 2,   // 卡片输入机读入一页（慢速输入设备，固定）
    diskRead: 1,      // 输入井 → 用户进程，一页
    diskWrite: 1,     // 用户进程 → 输出井，一页
    printPerPage: 4,  // 打印机打印一页（慢速输出设备）
    inCapacity: 3,    // 输入井容量（页）
    outCapacity: 3    // 输出井容量（页）
  });

  const JOBS = Object.freeze([
    Object.freeze({ name: 'J1', inPages: 2, compute: 3, outPages: 3 }),
    Object.freeze({ name: 'J2', inPages: 3, compute: 5, outPages: 3 }),
    Object.freeze({ name: 'J3', inPages: 2, compute: 4, outPages: 3 })
  ]);

  // CPU 真正做事的动作；直接 I/O 时的阻塞不计入
  const CPU_WORK = new Set(['compute', 'read-well', 'write-well']);

  function normalize(params) {
    const p = { ...DEFAULTS, ...params };
    for (const key of Object.keys(DEFAULTS)) {
      if (!Number.isInteger(p[key]) || p[key] < 1) {
        throw new RangeError(`${key} 必须是不小于 1 的整数`);
      }
    }
    return p;
  }

  function checkJobs(jobs) {
    if (!Array.isArray(jobs) || jobs.length === 0) throw new RangeError('至少需要一个作业');
    jobs.forEach((job) => {
      for (const key of ['inPages', 'compute', 'outPages']) {
        if (!Number.isInteger(job[key]) || job[key] < 1) {
          throw new RangeError(`${job.name} 的 ${key} 必须是不小于 1 的整数`);
        }
      }
    });
  }

  function makePages(jobs) {
    const inPages = [];
    const outPages = [];
    jobs.forEach((job, j) => {
      for (let k = 1; k <= job.inPages; k++) {
        inPages.push({ id: `in-${job.name}-${k}`, side: 'in', job: j, label: `${job.name}-${k}`, path: [], slot: null, readyAt: null, slotUse: null });
      }
      for (let k = 1; k <= job.outPages; k++) {
        outPages.push({ id: `out-${job.name}-${k}`, side: 'out', job: j, label: `${job.name}-${k}`, path: [], slot: null, readyAt: null, slotUse: null });
      }
    });
    return { inPages, outPages };
  }

  // 路径段：move 为页在两个节点之间移动；dwell 为页停在井格中。t1 为 null 表示尚未闭合
  function lastOpenDwell(page) {
    for (let i = page.path.length - 1; i >= 0; i--) {
      if (page.path[i].t1 === null) return page.path[i];
    }
    return null;
  }

  function sealPaths(pages) {
    for (const pg of pages) {
      pg.path = pg.path.filter((seg) => seg.t1 !== null && seg.t1 > seg.t0);
    }
  }

  function simulateSpool(params, jobs = JOBS) {
    checkJobs(jobs);
    const p = normalize(params);
    const { inPages, outPages } = makePages(jobs);
    const inEnd = [];
    const outEnd = [];
    let acc = 0;
    jobs.forEach((job) => { acc += job.inPages; inEnd.push(acc); });
    acc = 0;
    jobs.forEach((job) => { acc += job.outPages; outEnd.push(acc); });

    const inSlots = new Array(p.inCapacity).fill(null);
    const outSlots = new Array(p.outCapacity).fill(null);
    const acts = [];
    let t = 0;

    // 卡片输入机（输入进程）
    let rNext = 0;
    let reader = null;
    let rWait = null;
    // 打印机（输出进程）
    let pNext = 0;
    let printer = null;
    // 用户进程（CPU）
    let cJob = 0;
    let cPhase = 'read';
    let cIn = 0;
    let cOut = 0;
    let cur = null;
    let cWait = null;
    let cpuDone = null;

    function openWait(kind) {
      if (!cWait) cWait = { kind, from: t };
    }
    function closeWait() {
      if (cWait) {
        acts.push({ lane: 'cpu', kind: cWait.kind, start: cWait.from, end: t });
        cWait = null;
      }
    }
    function decideCpu() {
      while (!cur && cJob < jobs.length) {
        if (cPhase === 'read') {
          if (cIn < inEnd[cJob]) {
            const pg = inPages[cIn];
            if (pg.readyAt === null || pg.readyAt > t) { openWait('wait-in'); return; }
            closeWait();
            inSlots[pg.slot] = null;
            pg.slotUse.to = t;
            const dwell = lastOpenDwell(pg);
            if (dwell) dwell.t1 = t;
            pg.path.push({ t0: t, t1: t + p.diskRead, type: 'move', from: { node: 'in', slot: pg.slot }, to: { node: 'cpu' } });
            cur = { kind: 'read-well', end: t + p.diskRead };
            acts.push({ lane: 'cpu', kind: 'read-well', start: t, end: t + p.diskRead, page: cIn, job: cJob });
            cIn++;
            return;
          }
          cPhase = 'compute';
        }
        if (cPhase === 'compute') {
          closeWait();
          const len = jobs[cJob].compute;
          cur = { kind: 'compute', end: t + len };
          acts.push({ lane: 'cpu', kind: 'compute', start: t, end: t + len, job: cJob });
          cPhase = 'write';
          return;
        }
        if (cOut < outEnd[cJob]) {
          const slot = outSlots.indexOf(null);
          if (slot < 0) { openWait('wait-out'); return; }
          closeWait();
          outSlots[slot] = cOut;
          const pg = outPages[cOut];
          pg.slot = slot;
          pg.slotUse = { node: 'out', slot, from: t, to: null };
          pg.path.push({ t0: t, t1: t + p.diskWrite, type: 'move', from: { node: 'cpu' }, to: { node: 'out', slot } });
          cur = { kind: 'write-well', end: t + p.diskWrite, page: cOut };
          acts.push({ lane: 'cpu', kind: 'write-well', start: t, end: t + p.diskWrite, page: cOut, job: cJob });
          cOut++;
          return;
        }
        cJob++;
        cPhase = 'read';
      }
      if (!cur && cJob >= jobs.length && cpuDone === null) cpuDone = t;
    }

    for (;;) {
      // 1) 本拍结束的动作
      if (reader && reader.end === t) {
        const pg = inPages[reader.i];
        pg.readyAt = t;
        pg.path.push({ t0: t, t1: null, type: 'dwell', at: { node: 'in', slot: pg.slot } });
        reader = null;
      }
      if (printer && printer.end === t) printer = null;
      if (cur && cur.end === t) {
        if (cur.kind === 'write-well') {
          const pg = outPages[cur.page];
          pg.readyAt = t;
          pg.path.push({ t0: t, t1: null, type: 'dwell', at: { node: 'out', slot: pg.slot } });
        }
        cur = null;
      }
      // 2) 本拍开始的动作：打印机 → 用户进程 → 卡片输入机（同拍腾出的井格可立即复用）
      if (!printer && pNext < outPages.length) {
        const pg = outPages[pNext];
        if (pg.readyAt !== null && pg.readyAt <= t) {
          outSlots[pg.slot] = null;
          pg.slotUse.to = t;
          const dwell = lastOpenDwell(pg);
          if (dwell) dwell.t1 = t;
          pg.path.push({ t0: t, t1: t + p.printPerPage, type: 'move', from: { node: 'out', slot: pg.slot }, to: { node: 'printer' } });
          printer = { i: pNext, end: t + p.printPerPage };
          acts.push({ lane: 'printer', kind: 'print', start: t, end: t + p.printPerPage, page: pNext, job: pg.job });
          pNext++;
        }
      }
      decideCpu();
      if (!reader && rNext < inPages.length) {
        const slot = inSlots.indexOf(null);
        if (slot < 0) {
          if (rWait === null) rWait = t;
        } else {
          if (rWait !== null) {
            acts.push({ lane: 'card', kind: 'wait-slot', start: rWait, end: t });
            rWait = null;
          }
          inSlots[slot] = rNext;
          const pg = inPages[rNext];
          pg.slot = slot;
          pg.slotUse = { node: 'in', slot, from: t, to: null };
          pg.path.push({ t0: t, t1: t + p.cardPerPage, type: 'move', from: { node: 'card' }, to: { node: 'in', slot } });
          reader = { i: rNext, end: t + p.cardPerPage };
          acts.push({ lane: 'card', kind: 'read', start: t, end: t + p.cardPerPage, page: rNext, job: pg.job });
          rNext++;
        }
      }
      if (pNext === outPages.length && !printer) break;
      t++;
      if (t > 10000) throw new Error('模拟未收敛，请检查参数');
    }

    const pages = inPages.concat(outPages);
    sealPaths(pages);
    const end = Math.max(...acts.filter((a) => a.lane === 'printer').map((a) => a.end));
    return { mode: 'spool', params: p, jobs, pages, acts, cpuDone, end };
  }

  function simulateDirect(params, jobs = JOBS) {
    checkJobs(jobs);
    const p = normalize(params);
    const { inPages, outPages } = makePages(jobs);
    const acts = [];
    let t = 0;
    let inIdx = 0;
    let outIdx = 0;
    jobs.forEach((job, j) => {
      for (let k = 0; k < job.inPages; k++) {
        const pg = inPages[inIdx++];
        acts.push({ lane: 'card', kind: 'read', start: t, end: t + p.cardPerPage, page: inIdx - 1, job: j });
        acts.push({ lane: 'cpu', kind: 'read-direct', start: t, end: t + p.cardPerPage, page: inIdx - 1, job: j });
        pg.path.push({ t0: t, t1: t + p.cardPerPage, type: 'move', from: { node: 'card' }, to: { node: 'cpu' } });
        t += p.cardPerPage;
      }
      acts.push({ lane: 'cpu', kind: 'compute', start: t, end: t + job.compute, job: j });
      t += job.compute;
      for (let k = 0; k < job.outPages; k++) {
        const pg = outPages[outIdx++];
        acts.push({ lane: 'cpu', kind: 'print-direct', start: t, end: t + p.printPerPage, page: outIdx - 1, job: j });
        acts.push({ lane: 'printer', kind: 'print', start: t, end: t + p.printPerPage, page: outIdx - 1, job: j });
        pg.path.push({ t0: t, t1: t + p.printPerPage, type: 'move', from: { node: 'cpu' }, to: { node: 'printer' } });
        t += p.printPerPage;
      }
    });
    const pages = inPages.concat(outPages);
    sealPaths(pages);
    return { mode: 'direct', params: p, jobs, pages, acts, cpuDone: t, end: t };
  }

  function activeAct(acts, lane, t) {
    for (const a of acts) {
      if (a.lane === lane && a.start <= t && t < a.end) return a;
    }
    return null;
  }

  function segmentAt(path, t) {
    if (path.length === 0 || t < path[0].t0) return { phase: 'pending' };
    for (const seg of path) {
      if (t >= seg.t0 && t < seg.t1) return { phase: seg.type, seg };
    }
    return { phase: 'gone' };
  }

  // 第 t 拍的完整画面：设备动作、井格占用、每页所在位置
  function stateAt(run, t) {
    const slots = {
      in: new Array(run.params.inCapacity).fill(null),
      out: new Array(run.params.outCapacity).fill(null)
    };
    const chips = [];
    for (const pg of run.pages) {
      const su = pg.slotUse;
      if (su && su.from <= t && t < su.to) slots[su.node][su.slot] = pg.id;
      chips.push({ id: pg.id, side: pg.side, label: pg.label, job: pg.job, ...segmentAt(pg.path, t) });
    }
    let read = 0;
    let printed = 0;
    for (const a of run.acts) {
      if (a.lane === 'card' && a.kind === 'read' && a.end <= t) read++;
      if (a.lane === 'printer' && a.end <= t) printed++;
    }
    return {
      t,
      cpu: activeAct(run.acts, 'cpu', t),
      card: activeAct(run.acts, 'card', t),
      printer: activeAct(run.acts, 'printer', t),
      slots,
      chips,
      read,
      printed,
      cpuDone: run.cpuDone !== null && t >= run.cpuDone
    };
  }

  // 两组共同的事件时刻，供“上一步／下一步”使用
  function boundaries(runs) {
    const set = new Set([0]);
    for (const run of runs) {
      for (const a of run.acts) { set.add(a.start); set.add(a.end); }
      for (const pg of run.pages) {
        for (const seg of pg.path) { set.add(seg.t0); set.add(seg.t1); }
      }
    }
    return [...set].sort((a, b) => a - b);
  }

  function summarize(run) {
    const work = run.acts
      .filter((a) => a.lane === 'cpu' && CPU_WORK.has(a.kind))
      .reduce((sum, a) => sum + (a.end - a.start), 0);
    return {
      cpuDone: run.cpuDone,
      end: run.end,
      cpuIdle: run.cpuDone - work,
      printed: run.acts.filter((a) => a.lane === 'printer').length
    };
  }

  const api = { DEFAULTS, JOBS, simulateSpool, simulateDirect, stateAt, boundaries, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpoolModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
