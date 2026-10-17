/**
 * 时钟页面置换算法的离散推演模型（纯计算，不碰 DOM）。
 * 每一步只推进一个状态变化：指针转一格、检查一个页框、翻一位、选中淘汰、淘汰、装入、写操作或前移。
 * 每一步都记录变化前后的完整快照；界面用 sampleAt 取得位置，再由 choreo.js 决定每个元素的画面。
 */
(function (root) {
  'use strict';

  const FRAMES = 4;
  const MAX_PAGE = 9;
  const HAND_END = 0.4;   // 指针转动占步长的前 40%（与 choreo.js 一致）

  // 每种步的基准时长（秒，1× 速度）：主动作与回执都在这段时间内完成
  const DUR = Object.freeze({
    access: 0.9, lookup: 1.1, hit: 1.1, check: 0.9, clear: 1.2,
    select: 1.1, evict: 1.6, load: 1.6, write: 1.1, advance: 1.0
  });

  // 改进型四轮的目标类别（第 2、4 轮的 (0,1) 与第 1、3 轮的 (0,0)）
  const WANT = Object.freeze([null, [0, 0], [0, 1], [0, 0], [0, 1]]);

  const ROUND_SHORT = Object.freeze({
    enhanced: Object.freeze([null, '找 (0,0)', '找 (0,1) 并清 R', '找 (0,0)', '找 (0,1)']),
    basic: Object.freeze([null, '找 R=0', '找 R=0'])
  });

  const ROUND_RULES = Object.freeze({
    enhanced: Object.freeze([null, '找 (0,0)，扫描不改位', '找 (0,1)，扫过的 R 置 0', '找 (0,0)，扫描不改位', '找 (0,1)，兜底淘汰']),
    basic: Object.freeze([null, '找 R=0；R=1 的置 0 并前移', '第二圈必中'])
  });

  const cell = (page, r, m) => ({ page, r, m });
  const req = (page, op) => ({ page, op });

  const SCENARIOS = Object.freeze([
    {
      id: 1,
      name: '考研经典混合读写',
      desc: '驻留集已满，混合读写：会经历多轮扫描、R 清零与脏页写回',
      frames: [cell(1, 1, 0), cell(2, 1, 1), cell(3, 0, 1), cell(4, 0, 0)],
      pointer: 0,
      requests: [req(4, 'R'), req(5, 'W'), req(1, 'R'), req(6, 'R'), req(3, 'W'), req(7, 'R'), req(5, 'R'), req(8, 'W')]
    },
    {
      id: 2,
      name: '一轮速中 (0,0)',
      desc: '指针从 F0 出发，第一轮就遇到 (0,0)，不改位直接替换',
      frames: [cell(1, 1, 1), cell(2, 0, 0), cell(3, 1, 0), cell(4, 0, 1)],
      pointer: 0,
      requests: [req(9, 'R'), req(8, 'W')]
    },
    {
      id: 3,
      name: '二轮 R 清零淘汰 (0,1)',
      desc: '第一轮没有 (0,0)；第二轮扫过的 R 由 1 置 0，淘汰 (0,1) 脏页并写回',
      frames: [cell(1, 1, 1), cell(2, 1, 0), cell(3, 0, 1), cell(4, 1, 1)],
      pointer: 0,
      requests: [req(7, 'W')]
    },
    {
      id: 4,
      name: '四轮极限淘汰',
      desc: '四个页框都是 (1,1)：经过四轮才淘汰，末轮淘汰的是原 (1,1) 变成的 (0,1)',
      frames: [cell(1, 1, 1), cell(2, 1, 1), cell(3, 1, 1), cell(4, 1, 1)],
      pointer: 0,
      requests: [req(9, 'R')]
    },
    {
      id: 5,
      name: '读写命中测试',
      desc: '只有命中：指针不动，观察 R、M 如何被置位',
      frames: [cell(1, 0, 0), cell(2, 0, 0), cell(3, 1, 0), cell(4, 0, 1)],
      pointer: 2,
      requests: [req(1, 'R'), req(2, 'W'), req(3, 'W')]
    }
  ]);

  function checkFrames(list) {
    if (!Array.isArray(list) || list.length !== FRAMES) throw new RangeError('驻留集必须是 4 个页框');
    const seen = new Set();
    return list.map((c, idx) => {
      if (!c || !Number.isInteger(c.page) || c.page < 1 || c.page > MAX_PAGE) {
        throw new RangeError(`F${idx} 的页号必须是 1–9 的整数`);
      }
      if ((c.r !== 0 && c.r !== 1) || (c.m !== 0 && c.m !== 1)) {
        throw new RangeError(`F${idx} 的 R、M 只能是 0 或 1`);
      }
      if (seen.has(c.page)) throw new RangeError(`P${c.page} 在驻留集中重复出现`);
      seen.add(c.page);
      return { page: c.page, r: c.r, m: c.m };
    });
  }

  function checkRequest(item) {
    const op = item.op === undefined ? 'R' : item.op;
    if (!Number.isInteger(item.page) || item.page < 1 || item.page > MAX_PAGE) {
      throw new RangeError('访问页号必须是 1–9 的整数');
    }
    if (op !== 'R' && op !== 'W') throw new RangeError('访问类型只能是 R 或 W');
    return { page: item.page, op };
  }

  function snapshot(state) {
    return {
      frames: state.frames.map((c) => ({ page: c.page, r: c.r, m: c.m })),
      victim: state.victim,
      pointer: state.hand,
      stats: { ...state.stats }
    };
  }

  // 指针只顺时针转动；返回本步的起止累计角度（度），便于界面连续转动
  function moveHand(state, target) {
    const from = state.deg;
    const dist = (target - state.hand + FRAMES) % FRAMES;
    state.deg += dist * 90;
    state.hand = target;
    return { from, to: state.deg, moves: dist > 0 };
  }

  function emit(run, state, spec) {
    const before = snapshot(state);
    const move = spec.to === undefined
      ? { from: state.deg, to: state.deg, moves: false }
      : moveHand(state, spec.to);
    if (spec.apply) spec.apply(state);
    run.steps.push({
      req: spec.req,
      kind: spec.kind,
      outcome: spec.outcome || null,   // 查表步：'hit' 或 'fault'
      dirty: Boolean(spec.dirty),      // 淘汰步：被淘汰的页是否为脏页
      round: spec.round || 0,
      phase: spec.phase,
      narr: spec.narr,
      handFrom: move.from,
      handTo: move.to,
      moves: move.moves,
      focus: spec.focus === undefined ? -1 : spec.focus,
      tag: spec.tag || null,
      change: spec.change || null,
      dur: DUR[spec.kind],
      before,
      after: snapshot(state)
    });
  }

  function roundPhase(mode, round) {
    return mode === 'enhanced'
      ? `第 ${round} 轮 · ${ROUND_SHORT.enhanced[round]}`
      : `第 ${round} 圈 · ${ROUND_SHORT.basic[round]}`;
  }

  // 改进型 Clock：四轮。第 2 轮扫过的 R=1 页框置 0，且不作为本轮淘汰候选
  function scanEnhanced(run, state, j) {
    const start = state.hand;
    for (let round = 1; round <= 4; round++) {
      const [wantR, wantM] = WANT[round];
      for (let k = 0; k < FRAMES; k++) {
        const f = (start + k) % FRAMES;
        const c = state.frames[f];
        const at = `(${c.r},${c.m})`;
        const phase = roundPhase('enhanced', round);
        if (round === 2 && c.r === 1) {
          emit(run, state, {
            req: j, kind: 'clear', round, phase, focus: f, to: f,
            narr: `第 2 轮：F${f} 的 R 由 1 置 0，扫过即清零，继续看下一格。`,
            tag: { frame: f, text: 'R 1→0', tone: 'clear' },
            change: { frame: f, what: 'R' },
            apply: (s) => { s.frames[f].r = 0; }
          });
          continue;
        }
        if (c.r === wantR && c.m === wantM) {
          emit(run, state, {
            req: j, kind: 'select', round, phase, focus: f, to: f,
            narr: `第 ${round} 轮：F${f} 为 ${at}，符合条件，选为淘汰页。`,
            tag: { frame: f, text: '选中', tone: 'fault' },
            apply: (s) => { s.victim = f; }
          });
          return { frame: f, round };
        }
        emit(run, state, {
          req: j, kind: 'check', round, phase, focus: f, to: f,
          narr: `第 ${round} 轮：F${f} 为 ${at}，不是 (${wantR},${wantM})，跳过。`,
          tag: { frame: f, text: '跳过', tone: 'quiet' }
        });
      }
    }
    throw new Error('改进型 Clock 四轮内必有淘汰页');
  }

  // 简单 Clock：R=1 置 0 前移，R=0 即淘汰；最多两圈
  function scanBasic(run, state, j) {
    const start = state.hand;
    for (let k = 0; k < FRAMES * 2; k++) {
      const f = (start + k) % FRAMES;
      const c = state.frames[f];
      const round = k < FRAMES ? 1 : 2;
      const phase = roundPhase('basic', round);
      if (c.r === 1) {
        emit(run, state, {
          req: j, kind: 'clear', round, phase, focus: f, to: f,
          narr: `F${f} 的 R=1：置 0，给它一次机会，指针继续前进。`,
          tag: { frame: f, text: 'R 1→0', tone: 'clear' },
          change: { frame: f, what: 'R' },
          apply: (s) => { s.frames[f].r = 0; }
        });
        continue;
      }
      emit(run, state, {
        req: j, kind: 'select', round, phase, focus: f, to: f,
        narr: `F${f} 的 R=0：选为淘汰页。`,
        tag: { frame: f, text: '选中', tone: 'fault' },
        apply: (s) => { s.victim = f; }
      });
      return { frame: f, round };
    }
    throw new Error('简单 Clock 两圈内必有淘汰页');
  }

  function serveRequest(run, state, request, j) {
    const enhanced = run.mode === 'enhanced';
    const isWrite = enhanced && request.op === 'W';
    const pg = `P${request.page}`;
    const label = enhanced ? `${pg}（${request.op === 'W' ? '写' : '读'}）` : pg;

    emit(run, state, { req: j, kind: 'access', phase: '请求到达', focus: -1, narr: `访问 ${label}，先查驻留集。` });

    run.lookupStep[j] = run.steps.length;
    const hit = state.frames.findIndex((c) => c.page === request.page);
    if (hit !== -1) {
      emit(run, state, {
        req: j, kind: 'lookup', outcome: 'hit', phase: '命中', focus: hit,
        narr: `${pg} 在 F${hit} 中，命中；指针不动。`,
        tag: { frame: hit, text: '命中', tone: 'hit' },
        apply: (s) => { s.stats.total++; s.stats.hits++; }
      });
      if (state.frames[hit].r === 0) {
        emit(run, state, {
          req: j, kind: 'hit', phase: '命中 · 置访问位', focus: hit,
          narr: '访问位 R 由 0 置 1，记下这次访问。',
          tag: { frame: hit, text: 'R 0→1', tone: 'hit' },
          change: { frame: hit, what: 'R' },
          apply: (s) => { s.frames[hit].r = 1; }
        });
      }
      if (isWrite && state.frames[hit].m === 0) {
        emit(run, state, {
          req: j, kind: 'hit', phase: '命中 · 写操作', focus: hit,
          narr: '写操作：修改位 M 由 0 置 1，该页成为脏页。',
          tag: { frame: hit, text: 'M 0→1', tone: 'mark' },
          change: { frame: hit, what: 'M' },
          apply: (s) => { s.frames[hit].m = 1; }
        });
      }
      run.evictStep[j] = Infinity;
      run.loadStep[j] = Infinity;
      run.results[j] = { hit: true, frame: hit, victimPage: null, dirty: false, round: 0 };
      return;
    }

    emit(run, state, {
      req: j, kind: 'lookup', outcome: 'fault', phase: '缺页', focus: -1,
      narr: `${pg} 不在驻留集中：缺页，从指针所在的 F${state.hand} 开始扫描。`,
      apply: (s) => { s.stats.total++; s.stats.faults++; }
    });

    const found = enhanced ? scanEnhanced(run, state, j) : scanBasic(run, state, j);
    const f = found.frame;
    const victimPage = state.frames[f].page;
    const dirty = enhanced && state.frames[f].m === 1;
    run.evictStep[j] = run.steps.length;
    emit(run, state, {
      req: j, kind: 'evict', round: found.round, phase: '淘汰', focus: f, dirty,
      narr: !enhanced ? `P${victimPage} 直接覆盖（简单 Clock 不记修改位）。`
        : dirty ? `P${victimPage} 是脏页（M=1），必须先写回外存。`
          : `P${victimPage} 是干净页（M=0），无需写回，直接覆盖。`,
      tag: dirty ? { frame: f, text: '写回磁盘', tone: 'fault' } : { frame: f, text: '直接覆盖', tone: 'quiet' },
      apply: (s) => {
        if (dirty) s.stats.writes++;
        s.frames[f] = { page: null, r: 0, m: 0 };   // 页框空出，等待装入
      }
    });
    run.loadStep[j] = run.steps.length;
    emit(run, state, {
      req: j, kind: 'load', round: found.round, phase: '装入', focus: f,
      narr: enhanced ? `P${request.page} 调入 F${f}：R=1，M=0（刚调入，尚未写）。` : `P${request.page} 调入 F${f}：R=1。`,
      tag: { frame: f, text: `装入 P${request.page}`, tone: 'load' },
      change: { frame: f, what: 'page' },
      apply: (s) => { s.frames[f] = { page: request.page, r: 1, m: 0 }; s.victim = -1; }
    });
    if (isWrite) {
      emit(run, state, {
        req: j, kind: 'write', round: found.round, phase: '写操作', focus: f,
        narr: `对 P${request.page} 执行写操作：修改位 M 由 0 置 1，成为脏页。`,
        tag: { frame: f, text: 'M 0→1', tone: 'mark' },
        change: { frame: f, what: 'M' },
        apply: (s) => { s.frames[f].m = 1; }
      });
    }
    const next = (f + 1) % FRAMES;
    emit(run, state, {
      req: j, kind: 'advance', phase: '指针前移', focus: -1, to: next,
      narr: `指针顺时针前移到 F${next}，下一次扫描从这里开始。`
    });
    run.results[j] = { hit: false, frame: f, victimPage, dirty, round: found.round };
  }

  /**
   * 推演整段访问序列。
   * options: { mode: 'enhanced' | 'basic', frames: [{page,r,m}×4], pointer: 0–3, requests: [{page,op}] }
   * 返回 run：steps 为逐步记录；reqStart / reqEnd 为每次访问在 steps 中的区间；
   * lookupStep / evictStep / loadStep 为每次访问查表、淘汰、装入所在的步号（未发生时为 Infinity）；
   * results 为每次访问的结果。
   */
  function buildRun(options) {
    const opt = options || {};
    const mode = opt.mode === undefined ? 'enhanced' : opt.mode;
    if (mode !== 'enhanced' && mode !== 'basic') throw new RangeError('mode 只能是 enhanced 或 basic');
    const pointer = opt.pointer === undefined ? 0 : opt.pointer;
    if (!Number.isInteger(pointer) || pointer < 0 || pointer >= FRAMES) throw new RangeError('指针必须是 0–3 的整数');
    if (!Array.isArray(opt.requests)) throw new RangeError('访问序列必须是数组');

    const state = {
      frames: checkFrames(opt.frames),
      victim: -1,
      hand: pointer,
      deg: pointer * 90,
      stats: { total: 0, hits: 0, faults: 0, writes: 0 }
    };
    const run = {
      mode,
      requests: opt.requests.map(checkRequest),
      steps: [],
      reqStart: [],
      reqEnd: [],
      lookupStep: [],
      evictStep: [],
      loadStep: [],
      results: [],
      init: snapshot(state),
      initDeg: state.deg
    };
    run.requests.forEach((request, j) => {
      run.reqStart[j] = run.steps.length;
      serveRequest(run, state, request, j);
      run.reqEnd[j] = run.steps.length;
    });
    run.N = run.steps.length;
    return run;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  /**
   * 取得演示在第 index 步、步内进度 progress（0–1）时的位置，只依赖这两个数。
   * step 为正在进行（或刚停住）的那一步，prev 为它之前的一步；p = 0 表示这一步尚未开始。
   * 每个元素画成什么样，由 choreo.js 按 (step, prev, p) 算出。
   */
  function sampleAt(run, index, progress) {
    const N = run.N;
    const p = clamp(Number(progress) || 0, 0, 1);
    if (N === 0) return { index: 0, p: 0, done: true, step: null, prev: null, req: 0 };
    const i = clamp(Math.floor(Number(index)) || 0, 0, N);
    if (i >= N) {
      const last = run.steps[N - 1];
      return { index: N, p: 1, done: true, step: last, prev: N >= 2 ? run.steps[N - 2] : null, req: last.req };
    }
    const step = run.steps[i];
    const prev = i > 0 ? run.steps[i - 1] : null;
    return { index: i, p, done: false, step, prev, req: p > 0 || !prev ? step.req : prev.req };
  }

  const api = {
    FRAMES,
    MAX_PAGE,
    HAND_END,
    DUR,
    ROUND_RULES,
    SCENARIOS,
    buildRun,
    sampleAt
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClockModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
