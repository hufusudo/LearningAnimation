/**
 * 伙伴系统动态分区的离散推演模型（纯计算，不碰 DOM）。
 * 输入为有序的申请（alloc）与释放（free）操作；输出为逐步记录的快照。
 * 每一步只做一个主动作：取整、查找、切分、装入、出链装入、释放、判伙伴、合并、插链。
 * 每一步记录变化前后的完整快照；界面用 sampleAt 取得位置，再由 choreo.js 决定每个元素的画面。
 *
 * 块的状态（快照里 kind）：
 *   free   已挂入空闲链表（链表由 free 块按大小分组得到，因此与内存条永远一致）
 *   loose  已释放或刚合并，尚未挂入链表（判伙伴期间）
 *   work   正在切分，既不在链表中，也未分配
 *   busy   已分配给进程
 */
(function (root) {
  'use strict';

  const TOTAL = 1024;   // 物理内存 1024 KB
  const MIN = 64;       // 最低阶链表 64 KB

  // 每种步的基准时长（秒，1× 速度）：主动作与回执都在这段时间内完成
  const DUR = Object.freeze({
    round: 1.0, search: 1.4, split: 1.6, place: 1.5, pull: 1.5,
    release: 1.2, blocked: 1.2, merge: 1.6, insert: 1.2
  });

  // 阶段名（2–4 字）
  const PHASE = Object.freeze({
    round: '取整', search: '查找', split: '切分', place: '装入', pull: '出链装入',
    release: '释放', blocked: '判伙伴', merge: '合并', insert: '插链'
  });

  // 预设场景：分配三个进程，先释放 P2（伙伴已拆分，阻断），再释放 P1（逐级合并，最后阻断）
  const SCENARIO_OPS = Object.freeze([
    Object.freeze({ op: 'alloc', pid: 'P1', size: 70 }),
    Object.freeze({ op: 'alloc', pid: 'P2', size: 256 }),
    Object.freeze({ op: 'alloc', pid: 'P3', size: 190 }),
    Object.freeze({ op: 'free', pid: 'P2' }),
    Object.freeze({ op: 'free', pid: 'P1' })
  ]);

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // 向上取整到 2 的幂（不小于 MIN）
  function roundUp(n) {
    let s = MIN;
    while (s < n) s *= 2;
    return s;
  }

  function snap(state) {
    return {
      blocks: state.blocks.map((b) => ({ start: b.start, size: b.size, kind: b.kind, pid: b.pid })),
      procs: Object.fromEntries(Object.entries(state.procs).map(([k, v]) => [k, { ...v }]))
    };
  }

  function freeOf(state, size) {
    return state.blocks.filter((b) => b.kind === 'free' && b.size === size).sort((a, b) => a.start - b.start);
  }

  function findBlock(state, start, size) {
    return state.blocks.find((b) => b.start === start && b.size === size);
  }

  function setKind(state, start, size, kind, pid) {
    const b = findBlock(state, start, size);
    if (!b) throw new Error(`块 [${start},${start + size}) 不存在`);
    b.kind = kind;
    b.pid = pid || null;
  }

  function dropBlock(state, start, size) {
    const i = state.blocks.findIndex((b) => b.start === start && b.size === size);
    if (i < 0) throw new Error(`块 [${start},${start + size}) 不存在`);
    state.blocks.splice(i, 1);
  }

  function addBlock(state, start, size, kind, pid) {
    state.blocks.push({ start, size, kind, pid: pid || null });
    state.blocks.sort((a, b) => a.start - b.start);
  }

  // 每一步：先记下变化前快照，执行 mutate，再记下变化后快照
  function emit(run, state, spec, mutate) {
    const before = snap(state);
    if (mutate) mutate(state);
    const after = snap(state);
    run.steps.push(Object.assign({
      i: run.steps.length,
      op: 0,
      kind: 'round',
      phase: '',
      pid: null,
      req: 0,
      caption: '',
      reqLine: '',
      ring: [],        // 引导：先于变化出现的焦点外环（block / span / node / proc）
      tags: [],        // 回执浮标（最多两个）
      geom: null,      // 几何过渡：切分或合并
      flight: null,    // 飞行芯片：进程飞入内存、伙伴飞入链表
      sweep: null,     // 查找的行扫描：依次经过的阶数与命中阶数
      xor: null,       // 伙伴地址算式
      dur: 0,
      before,
      after
    }, spec, { phase: PHASE[spec.kind], dur: DUR[spec.kind] }));
  }

  function placeCaption(pid, start, size, req) {
    const frag = size - req;
    const range = `[${start}K,${start + size}K)`;
    return frag > 0
      ? `${pid} 占用 ${range}，需 ${req}K，内部碎片 ${frag}K。`
      : `${pid} 占用 ${range}，恰好满足，无内部碎片。`;
  }

  function doAlloc(run, state, o, j) {
    const { pid } = o;
    const req = o.size;
    const need = roundUp(req);
    const base = { op: j, pid, req, reqLine: `${pid} 申请 ${req}KB` };

    // 1. 取整：申请大小向上取整为 2 的幂
    const aligned = need !== req;
    emit(run, state, Object.assign({}, base, {
      kind: 'round',
      ring: [{ type: 'proc', pid, tone: 'key' }],
      tags: [aligned
        ? { at: { pid }, text: `对齐 ${need}K`, tone: 'note' }
        : { at: { pid }, text: '零碎片', tone: 'quiet' }],
      caption: aligned
        ? `${pid} 申请 ${req}KB，按 2 的幂向上取整为 ${need}KB。`
        : `${pid} 申请 ${req}KB，恰为 ${need}KB，无需取整。`
    }), (s) => { s.procs[pid].state = 'round'; });

    // 2. 查找：从 need 阶起逐阶向上，直到某阶链表非空
    const sweep = [];
    let hit = null;
    for (let sz = need; sz <= TOTAL && !hit; sz *= 2) {
      sweep.push(sz);
      const cands = freeOf(state, sz);
      if (cands.length) hit = { start: cands[0].start, size: sz };
    }
    if (!hit) throw new RangeError(`内存不足：无法为 ${pid} 分配 ${need}KB`);
    const { start: hs, size: hz } = hit;
    emit(run, state, Object.assign({}, base, {
      kind: 'search',
      ring: [{ type: 'node', start: hs, size: hz, tone: 'key' }],
      sweep: { sizes: sweep, hit: hz },
      tags: [{ at: { start: hs, size: hz }, text: `${hz}K 有块`, tone: hz === need ? 'key' : 'note' }],
      caption: hz === need
        ? `${need}K 链表中有 [${hs}K,${hs + hz}K)，恰好满足。`
        : `${need}K 链表为空，向上查到 ${hz}K 链表的 [${hs}K,${hs + hz}K)。`
    }));

    // 3a. 恰好等额：块直接出链并分配
    if (hz === need) {
      emit(run, state, Object.assign({}, base, {
        kind: 'pull',
        ring: [{ type: 'node', start: hs, size: hz, tone: 'key' }],
        flight: { kind: 'proc', pid, to: { start: hs, size: hz } },
        tags: [{ at: { start: hs, size: hz }, text: '出链装入', tone: 'note' }],
        caption: placeCaption(pid, hs, hz, req)
      }), (s) => {
        setKind(s, hs, hz, 'busy', pid);
        s.procs[pid].state = 'run';
      });
      return;
    }

    // 3b. 否则对半切分：右半成为伙伴挂入低一阶链表，左半继续切分，直到恰好够用
    let cur = { start: hs, size: hz };
    while (cur.size > need) {
      const half = cur.size / 2;
      const L = { start: cur.start, size: half };
      const R = { start: cur.start + half, size: half };
      emit(run, state, Object.assign({}, base, {
        kind: 'split',
        ring: [{ type: 'block', start: cur.start, size: cur.size, tone: 'key' }],
        geom: { type: 'split', parent: { ...cur }, children: [L, R] },
        flight: { kind: 'node', from: R, size: half },
        tags: [{ at: R, text: `伙伴 → ${half}K`, tone: 'note' }],
        caption: `把 ${cur.size}K 对半切分：右半 [${R.start}K,${R.start + half}K) 挂入 ${half}K 链表。`
      }), (s) => {
        dropBlock(s, cur.start, cur.size);
        addBlock(s, L.start, L.size, 'work', null);
        addBlock(s, R.start, R.size, 'free', null);
      });
      cur = L;
    }

    // 4. 装入：切分得到的块恰好等于需求，分配给进程
    emit(run, state, Object.assign({}, base, {
      kind: 'place',
      ring: [{ type: 'block', start: cur.start, size: cur.size, tone: 'key' }],
      flight: { kind: 'proc', pid, to: { ...cur } },
      tags: [{ at: { ...cur }, text: `${pid} 装入`, tone: 'key' }],
      caption: placeCaption(pid, cur.start, cur.size, req)
    }), (s) => {
      setKind(s, cur.start, cur.size, 'busy', pid);
      s.procs[pid].state = 'run';
    });
  }

  function doFree(run, state, o, j) {
    const { pid } = o;
    const blk = state.blocks.find((b) => b.kind === 'busy' && b.pid === pid);
    if (!blk) throw new RangeError(`${pid} 当前没有占用的内存`);
    const req = state.procs[pid].req;
    const base = { op: j, pid, req, reqLine: `${pid} 释放 ${req}KB` };
    const { start: s0, size: z0 } = blk;
    const buddy0 = s0 ^ z0;

    // 1. 释放：占用块变为待挂入，并算出伙伴地址（起址 ⊕ 块大小）
    emit(run, state, Object.assign({}, base, {
      kind: 'release',
      ring: [{ type: 'proc', pid, tone: 'key' }],
      xor: { at: { start: s0, size: z0 }, text: `${s0} ⊕ ${z0} = ${buddy0}` },
      caption: `${pid} 释放 [${s0}K,${s0 + z0}K)。伙伴址 = ${s0} ⊕ ${z0} = ${buddy0}。`
    }), (s) => {
      setKind(s, s0, z0, 'loose', null);
      s.procs[pid].state = 'done';
    });

    // 2. 判伙伴：伙伴必须同大小且空闲才能合并，合并后再向上判断
    let cur = { start: s0, size: z0 };
    while (cur.size < TOTAL) {
      const bs = cur.start ^ cur.size;
      const be = bs + cur.size;
      const buddy = findBlock(state, bs, cur.size);
      if (buddy && buddy.kind === 'free') {
        const us = Math.min(cur.start, bs);
        const uz = cur.size * 2;
        emit(run, state, Object.assign({}, base, {
          kind: 'merge',
          ring: [{ type: 'block', start: bs, size: cur.size, tone: 'key' }],
          geom: {
            type: 'merge',
            parent: { start: us, size: uz },
            children: [{ start: cur.start, size: cur.size }, { start: bs, size: cur.size }]
          },
          tags: [{ at: { start: us, size: uz }, text: `合并为 ${uz}K`, tone: 'key' }],
          caption: `伙伴 [${bs}K,${be}K) 空闲且同为 ${cur.size}K，合并为 [${us}K,${us + uz}K)。`
        }), (s) => {
          dropBlock(s, cur.start, cur.size);
          dropBlock(s, bs, cur.size);
          addBlock(s, us, uz, 'loose', null);
        });
        cur = { start: us, size: uz };
        continue;
      }
      const why = !buddy ? '已被拆分' : buddy.kind === 'busy' ? '仍被占用' : '尚未挂入链表';
      emit(run, state, Object.assign({}, base, {
        kind: 'blocked',
        ring: [{ type: 'span', start: bs, size: cur.size, tone: 'warn' }],
        tags: [{ at: { start: bs, size: cur.size }, text: `伙伴${why}`, tone: 'warn' }],
        caption: !buddy
          ? `伙伴 [${bs}K,${be}K) 已被拆分，不是同大小的空闲块，不能合并。`
          : `伙伴 [${bs}K,${be}K) ${why}，不能合并。`
      }));
      break;
    }

    // 3. 插链：不能再合并，块挂入对应阶的空闲链表
    emit(run, state, Object.assign({}, base, {
      kind: 'insert',
      ring: [{ type: 'block', start: cur.start, size: cur.size, tone: 'key' }],
      flight: { kind: 'node', from: { ...cur }, size: cur.size },
      tags: [{ at: { ...cur }, text: `挂入 ${cur.size}K 链表`, tone: 'note' }],
      caption: `[${cur.start}K,${cur.start + cur.size}K) 挂入 ${cur.size}K 链表。`
    }), (s) => {
      setKind(s, cur.start, cur.size, 'free', null);
    });
  }

  /**
   * 推演整段操作序列。
   * options: { ops: [{op:'alloc', pid, size} | {op:'free', pid}] }，缺省为预设场景。
   * 返回 run：steps 为逐步记录；N 为步数；opStart[j] 为第 j 个操作的第一步（阶段键用）；
   * init 为推演开始前的快照（第 0 步之前的画面）。
   */
  function buildRun(options) {
    const opt = options || {};
    const ops = opt.ops === undefined ? SCENARIO_OPS : opt.ops;
    if (!Array.isArray(ops)) throw new RangeError('操作序列必须是数组');

    const state = { blocks: [{ start: 0, size: TOTAL, kind: 'free', pid: null }], procs: {} };
    ops.forEach((o) => {
      if (o.op === 'alloc') {
        if (!Number.isInteger(o.size) || o.size < 1 || o.size > TOTAL) throw new RangeError('申请大小须为 1–1024 KB 的整数');
        if (state.procs[o.pid] && state.procs[o.pid].state !== 'done') throw new RangeError(`${o.pid} 已在内存中`);
        state.procs[o.pid] = { req: o.size, need: roundUp(o.size), state: 'wait' };
      } else if (o.op !== 'free') {
        throw new RangeError('操作只能是 alloc 或 free');
      }
    });

    const run = {
      total: TOTAL,
      ops: ops.map((o) => ({ ...o })),
      steps: [],
      opStart: [],
      N: 0,
      init: snap(state)
    };
    ops.forEach((o, j) => {
      run.opStart[j] = run.steps.length;
      if (o.op === 'alloc') doAlloc(run, state, o, j);
      else doFree(run, state, o, j);
    });
    run.N = run.steps.length;
    if (run.N) run.steps[run.N - 1].caption += '全部操作结束。';
    return run;
  }

  /**
   * 取得演示在第 index 步、步内进度 progress（0–1）时的位置，只依赖这两个数。
   * step 为正在进行（或刚停住）的那一步，prev 为它之前的一步；p = 0 表示这一步尚未开始。
   * index === N 表示全部结束：画面与最后一步停住时相同。
   */
  function sampleAt(run, index, progress) {
    const N = run.N;
    const p = clamp(Number(progress) || 0, 0, 1);
    if (N === 0) return { index: 0, p: 0, done: true, step: null, prev: null };
    const i = clamp(Math.floor(Number(index)) || 0, 0, N);
    if (i >= N) {
      return { index: N, p: 1, done: true, step: run.steps[N - 1], prev: N >= 2 ? run.steps[N - 2] : null };
    }
    return {
      index: i,
      p,
      done: false,
      step: run.steps[i],
      prev: i > 0 ? run.steps[i - 1] : null
    };
  }

  const api = {
    TOTAL,
    MIN,
    DUR,
    PHASE,
    SCENARIO_OPS,
    roundUp,
    buildRun,
    sampleAt
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuddyModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
