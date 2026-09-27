/**
 * 堆排序 · 双视角映射与下滤三步曲 — 核心引擎
 *
 * 架构：
 *   1) 时间线生成器 —— 按输入数据与堆型（大根 / 小根）预生成全部步骤快照
 *   2) 双视角渲染器 —— 上视图（完全二叉树语义层）+ 下视图（一维数组物理层）
 *   3) 通用动量动画 —— 弧线互换 / 抛物线飞入 / 水平滑移，任意步骤可正反向平滑过渡
 *
 * 严格遵循 Taste-Skill Light Editorial 规范与 60fps 缓动。
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. 常量与全局状态
  // =========================================================================
  const DEFAULT_VALUES = [49, 38, 65, 97, 76, 13, 27];
  const NODE_R = 27;          // 树节点半径
  const NODE_D = NODE_R * 2;

  const MODES = {
    max: { key: 'max', name: '大根堆', order: '升序', extrema: 'MAX', cmp: '>', better: (a, b) => a > b },
    min: { key: 'min', name: '小根堆', order: '降序', extrema: 'MIN', cmp: '<', better: (a, b) => a < b }
  };

  const STAGE = {
    P0: '准备 · 序列装载',
    P1: '阶段 1: 自底向上建堆',
    P2: '阶段 2: 堆顶出列与重整',
    P3: '完成 · 全序列有序'
  };

  const LOCK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="4.5" y="10.5" width="15" height="10" rx="2"></rect>' +
    '<path d="M8 10.5V7.2a4 4 0 018 0v3.3"></path></svg>';

  const State = {
    values: DEFAULT_VALUES.slice(),
    mode: 'max',
    items: [],
    steps: [],
    idx: 0,
    playing: false,
    timer: null,
    timers: [],
    speed: 1,
    lastState: null,
    m: null
  };

  const DOM = {};

  // =========================================================================
  // 2. 时间线生成器
  // =========================================================================
  function generate(values, mode) {
    const M = MODES[mode];
    const n = values.length;
    const items = values.map((v, id) => ({ id, v }));
    const V = id => items[id].v;
    const seqOf = arr => '[' + arr.map(V).join(', ') + ']';

    let order = items.map(it => it.id);   // 物理数组：下标 -> 元素 id
    let heapSize = n;                     // 树中的节点数（活动堆）
    let lockedFrom = n;                   // 数组锁定区起点
    let comp = 0, sw = 0;
    let extremaOn = false;                // 极值标记是否点亮

    const steps = [];

    function snap(extra) {
      extra = extra || {};
      const base = {
        order: order.slice(),
        treeMap: order.slice(0, heapSize),   // 树槽位 -> 元素 id（null 表示空缺）
        heapSize, lockedFrom, comp, swap: sw,
        focusIds: [], spotlight: false,
        activeEdges: [], champ: null, judge: null, guide: null,
        extrema: extremaOn,
        phase: 'P1',
        title: '', terminal: '', codeLine: 3, hold: 1500, fast: false, anim: null
      };
      const step = Object.assign(base, extra);
      step.stage = extra.stage || STAGE[step.phase] || STAGE.P1;
      return step;
    }
    const push = o => steps.push(snap(o));

    // ---------------- 下滤三步曲 ----------------
    function siftDown(startPos, phase, fast) {
      let pos = startPos;
      let guard = 0;
      while (guard++ < 64) {
        const L = 2 * pos + 1, R = 2 * pos + 2;
        if (L >= heapSize) break;                       // 无孩子：下滤到底
        const kids = [];
        if (L < heapSize) kids.push(L);
        if (R < heapSize) kids.push(R);

        // ---- 第一拍：挑擂主 ----
        let champ = kids[0];
        for (let k = 1; k < kids.length; k++) {
          if (M.better(V(order[kids[k]]), V(order[champ]))) champ = kids[k];
        }
        const pid = order[pos], cid = order[champ];
        comp++;
        const kidTxt = kids.map(k => `A[${k}]=${V(order[k])}`).join(' 与 ');
        push({
          phase, fast,
          focusIds: [pid, cid], spotlight: true,
          activeEdges: kids.map(k => [pos, k]),
          champ: { id: cid, slot: champ, parentSlot: pos },
          title: `第 1 拍 · 挑擂主  A[${pos}] vs 子节点`,
          terminal: `挑擂主：父 A[${pos}]=${V(pid)} 与 ${kidTxt} 的连线亮起，按${M.name}规则（取${M.cmp}者）两子跃动对比，胜出者 A[${champ}]=${V(cid)}（Comp +1，累计 ${comp}）。`,
          codeLine: 11, hold: fast ? 1400 : 1850,
          anim: { type: 'select', pos, kids, champ }
        });

        // ---- 第二拍：判胜负 ----
        const need = M.better(V(cid), V(pid));
        comp++;
        push({
          phase, fast,
          focusIds: [pid, cid], spotlight: true,
          activeEdges: kids.map(k => [pos, k]),
          champ: { id: cid, slot: champ, parentSlot: pos },
          judge: { pid, cid, pslot: pos, cslot: champ, pval: V(pid), cval: V(cid), need, cmp: M.cmp },
          guide: need ? { from: champ, to: pos } : null,
          title: need
            ? `第 2 拍 · 判胜负：${V(cid)} ${M.cmp} ${V(pid)} 成立 → 需交换`
            : `第 2 拍 · 判胜负：堆性质成立 → 下滤终止`,
          terminal: need
            ? `判胜负：优势子 A[${champ}]=${V(cid)} ${M.cmp} 父 A[${pos}]=${V(pid)} ? TRUE → 父子间拉起琥珀色互换引导线，进入第三拍（Comp +1，累计 ${comp}）。`
            : `判胜负：${V(cid)} ${M.cmp} ${V(pid)} ? FALSE → 父节点已是${M.name}局部极值，满足堆性质，下滤平滑终止（Comp +1，累计 ${comp}）。`,
          codeLine: 12, hold: fast ? 1400 : 1750,
          anim: { type: 'judge', need }
        });
        if (!need) break;

        // ---- 第三拍：双轨对调 ----
        [order[pos], order[champ]] = [order[champ], order[pos]];
        sw++;
        push({
          phase, fast,
          focusIds: [order[champ]], spotlight: false,
          activeEdges: [[pos, champ]],
          title: `第 3 拍 · 双轨对调  A[${pos}] ↔ A[${champ}]`,
          terminal: `双轨对调：树视图父子沿弧形轨迹互换，数组栏 A[${pos}] 与 A[${champ}] 同步水平滑移换位；焦点随下沉节点向下追踪（Swap +1，累计 ${sw}），序列 ${seqOf(order)}。`,
          codeLine: 13, hold: fast ? 1550 : 1950,
          anim: { type: 'swap', from: pos, to: champ }
        });
        pos = champ;
      }
    }

    // ---------------- 阶段 0：装载 ----------------
    const start = Math.floor(n / 2) - 1;
    push({
      phase: 'P0', extrema: false,
      title: 'Step 0 · 装载初始序列',
      terminal: `装载 A = ${seqOf(order)}（n = ${n}），按层序展开为完全二叉树：非叶子节点 0..${start}，叶子节点 ${start + 1}..${n - 1}。`,
      codeLine: 1, hold: 2500,
      anim: { type: 'init' }
    });

    // ---------------- 阶段 1：自底向上建堆 ----------------
    push({
      phase: 'P1', extrema: false,
      focusIds: [order[start]], spotlight: true,
      title: `Step 1 · 定位建堆起点 A[${start}]`,
      terminal: `分界线自左向右贯穿：线以下为叶子节点，不主动发起下滤；起始焦点直接落于最后一个非叶子节点 i = ⌊n/2⌋−1 = ${start}（值 ${V(order[start])}）。`,
      codeLine: 2, hold: 2600,
      anim: { type: 'locate', slot: start }
    });

    for (let i = start; i >= 0; i--) {
      siftDown(i, 'P1', false);
      if (i > 0) {
        push({
          phase: 'P1', fast: true,
          focusIds: [order[i - 1]], spotlight: true,
          title: `Step · 焦点上移至 A[${i - 1}]`,
          terminal: `自底向上推进：i 由 ${i} 递减至 ${i - 1}，对 A[${i - 1}] = ${V(order[i - 1])} 发起下滤三步曲。`,
          codeLine: 2, hold: 1350,
          anim: { type: 'build-focus', slot: i - 1 }
        });
      }
    }

    extremaOn = true;
    push({
      phase: 'P1', fast: false,
      focusIds: [order[0]],
      title: 'Step · 建堆完成，堆顶亮出极值标记',
      terminal: `阶段 1 完成：全树满足${M.name}性质，堆顶 A[0] = ${V(order[0])} 即当前${M.order === '升序' ? '最大' : '最小'}值，${M.extrema} 标记点亮，整棵树自顶向下微脉冲反馈。`,
      codeLine: 3, hold: 2700,
      anim: { type: 'build-done' }
    });

    // ---------------- 阶段 2：堆顶出列与重整 ----------------
    let cycle = 0;
    while (heapSize > 1) {
      const H = heapSize;
      const fast = cycle > 0;
      const topId = order[0];
      const leafId = order[H - 1];
      const before = order.slice();

      // (1) 堆顶出列
      const tm = before.slice(0, H);
      tm[0] = null;                                    // 树顶留出空缺
      [order[0], order[H - 1]] = [order[H - 1], order[0]];
      lockedFrom = H - 1;
      push({
        phase: 'P2', fast,
        treeMap: tm, focusIds: [topId],
        title: `Step · 堆顶出列 → 锁入 A[${H - 1}]`,
        terminal: `堆顶 ${V(topId)} 沿抛物线轨迹飞入数组未锁定区最右端 A[${H - 1}]，落位后转为锁定并移出有效堆范围；同拍末尾叶 ${V(leafId)} 水平滑向 A[0] 为替补让位，活动堆区右边界左移一格。`,
        codeLine: 5, hold: fast ? 1800 : 2600,
        anim: { type: 'extract', H, topId, leafId }
      });

      // (2) 末端替补
      heapSize = H - 1;
      push({
        phase: 'P2', fast,
        focusIds: [leafId],
        title: 'Step · 末端替补拉升至堆顶',
        terminal: `末端替补：当前堆最后一个叶子 ${V(leafId)} 被平滑牵引至堆顶，原叶子连线淡出，树结构动态减员 1 → 活动堆大小 h = ${heapSize}。`,
        codeLine: 6, hold: fast ? 1600 : 2200,
        anim: { type: 'promote', from: H - 1 }
      });

      // (3) 重整下滤
      if (heapSize >= 2) siftDown(0, 'P2', fast);
      cycle++;
    }

    // ---------------- 收官：末位锁定 + 波浪 ----------------
    const lastId = order[0];
    heapSize = 0;
    lockedFrom = 0;
    push({
      phase: 'P2', fast: false,
      focusIds: [lastId],
      title: 'Step · 最后一个节点滑入下标 0 锁定',
      terminal: `活动堆仅剩 1 个节点：${V(lastId)} 沿弧线下潜滑入下标 0 并转为锁定状态，完全二叉树视图清空归零。`,
      codeLine: 4, hold: 2400,
      anim: { type: 'final-lock' }
    });

    extremaOn = false;
    const finalSeq = seqOf(order);
    push({
      phase: 'P3', fast: false, extrema: false,
      title: 'Final · 全量流动波浪高亮',
      terminal: `排序完成：数组执行全量流动波浪高亮 —— A = ${finalSeq}（${M.name} ⇒ ${M.order}序列），共 ${comp} 次比较、${sw} 次交换。`,
      codeLine: 8, hold: 3800,
      anim: { type: 'wave' }
    });

    return { steps, items, summary: { comp, swap: sw, final: finalSeq } };
  }

  // =========================================================================
  // 3. DOM 构建
  // =========================================================================
  function collectDOM() {
    const $ = id => document.getElementById(id);
    DOM.modeMax = $('mode-max');
    DOM.modeMin = $('mode-min');
    DOM.btnReset = $('btn-reset');
    DOM.btnPrev = $('btn-prev');
    DOM.btnNext = $('btn-next');
    DOM.btnPlay = $('btn-play');
    DOM.btnRandom = $('btn-random');
    DOM.playIcon = $('play-icon');
    DOM.playLabel = $('play-label');
    DOM.speed = $('speed-slider');
    DOM.speedVal = $('speed-value');
    DOM.phaseBox = document.querySelector('.phase-box');
    DOM.phaseBadge = $('phase-badge');
    DOM.dataBadge = $('data-badge');
    DOM.stepCounter = $('step-counter');
    DOM.stepDesc = $('step-description');
    DOM.progressFill = $('progress-bar-fill');
    DOM.progressBox = $('progress-bar-container');

    DOM.treeStage = $('tree-stage');
    DOM.treeSvg = $('tree-svg');
    DOM.edgesGroup = $('edges-group');
    DOM.treeNodes = $('tree-nodes');
    DOM.boundaryPath = $('boundary-path');
    DOM.boundaryTag = $('boundary-tag');
    DOM.guidePath = $('guide-path');
    DOM.vacant = $('vacant-root');
    DOM.treeEmpty = $('tree-empty');
    DOM.ring = $('focus-ring');
    DOM.extrema = $('extrema-badge');
    DOM.champ = $('champ-badge');
    DOM.judge = $('judge-bubble');
    DOM.judgeText = $('judge-text');
    DOM.judgeVerdict = $('judge-verdict');

    DOM.arrayStage = $('array-stage');
    DOM.arraySlots = $('array-slots');
    DOM.arrayCells = $('array-cells');
    DOM.zoneActive = $('zone-active');
    DOM.zoneLocked = $('zone-locked');
    DOM.divider = $('zone-divider');
    DOM.divider.style.left = '0px';

    DOM.termText = $('terminal-text');
    DOM.termStrip = $('terminal-strip');

    DOM.hudMode = $('hud-mode');
    DOM.hudHeap = $('hud-heap');
    DOM.hudLocked = $('hud-locked');
    DOM.hudComp = $('hud-comp');
    DOM.hudSwap = $('hud-swap');
    DOM.hudFocus = $('hud-focus');

    DOM.codeLines = Array.from(document.querySelectorAll('.code-line'));
    DOM.nodes = [];
    DOM.cells = [];
    DOM.slots = [];
    DOM.edges = [];
  }

  function buildEntities() {
    const n = State.values.length;

    // --- 树节点 ---
    DOM.treeNodes.innerHTML = '';
    DOM.nodes = [];
    State.items.forEach(it => {
      const el = document.createElement('div');
      el.className = 't-node';
      el.dataset.id = it.id;
      el.title = `元素 ${it.v} · 悬停与数组格联动`;
      el.innerHTML = `<span class="t-val">${it.v}</span><span class="t-idx">0</span>`;
      DOM.treeNodes.appendChild(el);
      DOM.nodes[it.id] = el;
    });

    // --- 数组底座 + 实体格 ---
    DOM.arraySlots.innerHTML = '';
    DOM.arrayCells.innerHTML = '';
    DOM.slots = [];
    DOM.cells = [];
    for (let i = 0; i < n; i++) {
      const base = document.createElement('div');
      base.className = 'a-slot';
      const idx = document.createElement('span');
      idx.className = 'a-idx';
      idx.textContent = `A[${i}]`;
      base.appendChild(idx);
      DOM.arraySlots.appendChild(base);
      DOM.slots.push(base);

      const cell = document.createElement('div');
      cell.className = 'a-cell';
      cell.dataset.id = i;
      cell.innerHTML = `<span class="a-val">${State.items[i].v}</span><span class="a-lock">${LOCK_SVG}</span>`;
      DOM.arrayCells.appendChild(cell);
      DOM.cells[i] = cell;

      // 双向联动高亮
      cell.addEventListener('mouseenter', () => linkHover(i, true));
      cell.addEventListener('mouseleave', () => linkHover(i, false));
      DOM.nodes[i].addEventListener('mouseenter', () => linkHover(i, true));
      DOM.nodes[i].addEventListener('mouseleave', () => linkHover(i, false));
    }

    // --- 父子连线 ---
    DOM.edgesGroup.innerHTML = '';
    DOM.edges = [];
    for (let s = 1; s < n; s++) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', 'edge');
      p.dataset.slot = s;
      DOM.edgesGroup.appendChild(p);
      DOM.edges[s] = p;
    }
  }

  /** 悬停联动：只重绘高亮，不打断在途动画 */
  function linkHover(id, on) {
    const step = State.steps[State.idx];
    if (step) paintHighlight(step, id, on);
  }

  // =========================================================================
  // 4. 几何度量
  // =========================================================================
  function levelOf(slot) { return Math.floor(Math.log2(slot + 1)); }

  function measure() {
    const n = State.values.length;
    const W = DOM.treeStage.clientWidth;
    const H = DOM.treeStage.clientHeight;
    const levels = Math.max(1, Math.floor(Math.log2(Math.max(1, n - 1))) + 1);
    const padX = Math.max(44, Math.min(86, W * 0.075));
    const innerW = Math.max(120, W - padX * 2);
    const padTop = 46;
    const bottomReserve = 54;
    const rowGap = levels > 1 ? (H - padTop - bottomReserve) / (levels - 1) : 0;

    const slots = [];
    for (let s = 0; s < n; s++) {
      const lv = levelOf(s);
      const cnt = Math.pow(2, lv);
      const k = s - (cnt - 1);
      slots.push({ x: padX + (k + 0.5) / cnt * innerW, y: padTop + lv * rowGap, lv });
    }

    const arrLeft = DOM.arraySlots.offsetLeft;
    const cellW = DOM.arraySlots.clientWidth / n;

    const m = {
      n, W, H, levels, padX, innerW, padTop, rowGap, slots,
      arrLeft, cellW, cellY: 20
    };
    DOM.treeSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    layoutSlots(m);
    return m;
  }

  const slotX = (m, s) => m.slots[s].x;
  const slotY = (m, s) => m.slots[s].y;
  /** 实体格坐标（以 #array-cells 层左上角为原点，该层与底座层同为 0.9rem 内缩） */
  const cellX = (m, slot) => slot * m.cellW + 3;
  const cellWpx = m => Math.max(18, m.cellW - 6);

  function layoutSlots(m) {
    for (let i = 0; i < m.n; i++) {
      const s = DOM.slots[i];
      if (!s) continue;
      s.style.left = `${cellX(m, i)}px`;
      s.style.width = `${cellWpx(m)}px`;
    }
  }

  /** 非叶子 / 叶子分界线（贯穿左右，必要时在层间作一次台阶过渡） */
  function boundaryGeom(m, heapSize) {
    const internal = Math.floor(heapSize / 2);
    if (internal <= 0 || heapSize < 2) return null;
    const Dlvl = Math.floor(Math.log2(internal));
    const cap = Math.pow(2, Dlvl);
    const c = internal - (cap - 1);                 // 最深内部层上的内部节点数
    const yD = m.padTop + Dlvl * m.rowGap;
    const deepest = levelOf(heapSize - 1);
    const yBelow = Dlvl < deepest ? yD + m.rowGap / 2 : yD + NODE_R + 16;
    const yAbove = Dlvl > 0 ? yD - m.rowGap / 2 : null;

    const x0 = m.padX - 16;
    const x1 = m.padX + m.innerW + 16;
    let d;
    if (c >= cap || yAbove === null) {
      d = `M ${x0} ${yBelow} L ${x1} ${yBelow}`;
    } else {
      const xStep = m.padX + (c / cap) * m.innerW;
      d = `M ${x0} ${yBelow} L ${xStep} ${yBelow} L ${xStep} ${yAbove} L ${x1} ${yAbove}`;
    }
    return { d, tagX: x0 + 6, tagY: yBelow - 24 };
  }

  function edgeD(m, p, c) {
    const px = slotX(m, p), py = slotY(m, p) + NODE_R;
    const cx = slotX(m, c), cy = slotY(m, c) - NODE_R;
    const dy = cy - py;
    return `M ${px} ${py} C ${px} ${py + dy * 0.42}, ${cx} ${cy - dy * 0.42}, ${cx} ${cy}`;
  }

  // =========================================================================
  // 5. 动量动画原语（全部按速度缩放）
  // =========================================================================
  const dur = base => base / State.speed;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function setMotion(el, tween) {
    if (el.__t) el.__t.kill();
    el.__t = tween;
  }

  function clearMotion(el) {
    if (el.__t) { el.__t.kill(); el.__t = null; }
  }

  /** 沿抛物线（可带侧向偏移）移动元素：单一参数 t 驱动，任意速度下轨迹一致 */
  function arcMove(el, x0, y0, x1, y1, off, baseDur, opts) {
    opts = opts || {};
    const dx = x1 - x0, dy = y1 - y0;
    const p = { t: 0 };
    clearMotion(el);
    gsap.set(el, { x: x0, y: y0, opacity: opts.fade ? 1 : (opts.opacity0 != null ? opts.opacity0 : 1), scale: 1 });
    const tw = gsap.to(p, {
      t: 1,
      duration: dur(baseDur),
      ease: opts.ease || 'power1.inOut',
      onUpdate() {
        const t = p.t, s = 4 * t * (1 - t);
        const vars = {
          x: x0 + dx * t + (off ? off.x * s : 0),
          y: y0 + dy * t + (off ? off.y * s : 0),
          scale: 1 + (opts.amp || 0.1) * s
        };
        if (opts.fade) vars.opacity = 1 - Math.max(0, (t - 0.6) / 0.4);
        gsap.set(el, vars);
      },
      onComplete() {
        el.__t = null;
        gsap.set(el, opts.fade
          ? { x: x1, y: y1, opacity: 0, scale: 1 }
          : { x: x1, y: y1, opacity: opts.opacity1 != null ? opts.opacity1 : 1, scale: 1 });
        if (opts.onDone) opts.onDone();
      }
    });
    setMotion(el, tw);
    return tw;
  }

  /** 徽标弹入 / 脉冲：走 CSS 动画（作用在独立的 scale 属性上），
   *  既不与 GSAP 的 transform 定位冲突，也不会残留内联 opacity */
  function animateClass(el, cls, baseDur, delay) {
    if (!el) return;
    el.style.setProperty('--anim-dur', `${Math.round(dur(baseDur))}ms`);
    el.style.setProperty('--anim-delay', `${Math.round(delay ? dur(delay) : 0)}ms`);
    el.classList.remove(cls);
    void el.offsetWidth;                 // 强制回流以重启动画
    el.classList.add(cls);
  }
  const pop = (el, baseDur, delay) => animateClass(el, 'badge-pop', baseDur, delay);

  function defer(fn, ms) {
    State.timers.push(setTimeout(fn, dur(ms)));
  }

  function killAll() {
    State.timers.forEach(clearTimeout);
    State.timers = [];
    const all = DOM.nodes.concat(DOM.cells).filter(Boolean);
    all.forEach(el => { clearMotion(el); el.style.boxShadow = ''; });
    gsap.killTweensOf(all);
    // 浮动徽标被中断后必须交还给 CSS class 接管，否则内联 opacity / dasharray 会残留
    const badges = [DOM.champ, DOM.judge, DOM.extrema, DOM.guidePath,
      DOM.vacant, DOM.termText, DOM.boundaryTag, DOM.boundaryPath].filter(Boolean);
    gsap.killTweensOf(badges);
    badges.forEach(el => {
      gsap.set(el, { scale: 1, opacity: 1 });   // 同步 GSAP 缓存
      el.classList.remove('badge-pop', 'badge-pulse', 'tag-in');
      el.style.removeProperty('--anim-dur');
      el.style.removeProperty('--anim-delay');
      el.style.opacity = '';                    // 交回 CSS class 决定显隐
      el.style.strokeDasharray = '';
      el.style.strokeDashoffset = '';
    });
  }

  // =========================================================================
  // 6. 渲染：状态套用
  // =========================================================================
  function paintHighlight(step, hoverId, hoverOn) {
    const focusSet = new Set(step.focusIds);
    State.items.forEach(it => {
      const node = DOM.nodes[it.id];
      const cell = DOM.cells[it.id];
      if (!node || !cell) return;
      const isFocus = focusSet.has(it.id) || hoverId === it.id && hoverOn;
      const dim = step.spotlight && !focusSet.has(it.id) && hoverId !== it.id;
      const isChamp = !!(step.champ && step.champ.id === it.id);
      node.classList.toggle('is-focus', isFocus);
      node.classList.toggle('is-champ', isChamp && !isFocus);
      node.classList.toggle('dim', dim);
      cell.classList.toggle('is-focus', isFocus);
      cell.classList.toggle('is-champ', isChamp && !isFocus);
      cell.classList.toggle('dim', dim);
    });
  }

  function applyState(step, m, from) {
    const M = MODES[State.mode];
    const animating = !!from;

    const toTree = new Map();
    step.treeMap.forEach((id, s) => { if (id != null) toTree.set(id, s); });
    const toArr = new Map();
    step.order.forEach((id, s) => toArr.set(id, s));

    let fromTree = null, fromArr = null;
    if (from) {
      fromTree = new Map();
      from.treeMap.forEach((id, s) => { if (id != null) fromTree.set(id, s); });
      fromArr = new Map();
      from.order.forEach((id, s) => fromArr.set(id, s));
    }

    const isExtract = !!(step.anim && step.anim.type === 'extract');
    const lift = isExtract ? 54 : 24;      // 右飞：高抛；左移：低掠

    // ---------- 父子连线 ----------
    for (let s = 1; s < m.n; s++) {
      const p = DOM.edges[s];
      if (!p) continue;
      p.setAttribute('d', edgeD(m, Math.floor((s - 1) / 2), s));
      const gone = s >= step.heapSize;
      const lit = !gone && step.activeEdges.some(e => e[1] === s);
      p.classList.toggle('gone', gone);
      p.classList.toggle('lit', lit);
      if (gone) p.classList.remove('lit');
    }

    // ---------- 非叶子 / 叶子分界线 ----------
    const bg = boundaryGeom(m, step.heapSize);
    if (bg) {
      DOM.boundaryPath.classList.remove('hidden');
      DOM.boundaryPath.setAttribute('d', bg.d);
      DOM.boundaryTag.classList.remove('hidden');
      DOM.boundaryTag.style.left = `${bg.tagX}px`;
      DOM.boundaryTag.style.top = `${Math.max(2, bg.tagY)}px`;
      DOM.boundaryTag.innerHTML = step.phase === 'P1'
        ? `非叶子 / 叶子分界 · 建堆起点 <b>i = ${Math.floor(m.n / 2) - 1}</b>`
        : `非叶子 / 叶子分界 · 活动堆 <b>h = ${step.heapSize}</b>`;
    } else {
      DOM.boundaryPath.classList.add('hidden');
      DOM.boundaryTag.classList.add('hidden');
    }

    // ---------- 树节点动量 ----------
    State.items.forEach(it => {
      const el = DOM.nodes[it.id];
      if (!el) return;
      const ts = toTree.has(it.id) ? toTree.get(it.id) : -1;
      const as = toArr.get(it.id);
      const cellLeft = cellX(m, as);
      const diveX = cellLeft + (cellWpx(m) - NODE_D) / 2;
      const diveY = m.cellY + 1;

      if (ts >= 0) {
        const tx = slotX(m, ts) - NODE_R, ty = slotY(m, ts) - NODE_R;
        const fts = fromTree && fromTree.has(it.id) ? fromTree.get(it.id) : -1;
        el.style.visibility = 'visible';
        if (animating && fts >= 0 && fts !== ts) {
          const a = m.slots[fts], b = m.slots[ts];
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const amp = Math.min(40, len * 0.34);
          arcMove(el, a.x - NODE_R, a.y - NODE_R, tx, ty,
            { x: -dy / len * amp, y: dx / len * amp },
            step.anim && step.anim.type === 'promote' ? 0.74 : 0.8);
        } else if (animating && fts < 0) {
          // 反向回放：节点重新进入树视图
          clearMotion(el);
          gsap.set(el, { x: tx, y: ty, scale: 1 });
          gsap.fromTo(el, { opacity: 0, scale: 0.6 },
            { opacity: 1, scale: 1, duration: dur(0.45), ease: 'back.out(2)' });
        } else {
          clearMotion(el);
          gsap.set(el, { x: tx, y: ty, opacity: 1, scale: 1 });
        }
        const idxEl = el.querySelector('.t-idx');
        if (idxEl && idxEl.textContent !== String(ts)) idxEl.textContent = ts;
      } else {
        // 离开树视图：俯冲飞入数组槽位
        const hadFrom = !!(fromTree && fromTree.has(it.id));
        if (animating && hadFrom) {
          const a = m.slots[fromTree.get(it.id)];
          el.style.visibility = 'visible';
          arcMove(el, a.x - NODE_R, a.y - NODE_R, diveX, diveY,
            { x: 0, y: -68 }, isExtract ? 0.98 : 0.82,
            { fade: true, amp: 0.05, onDone: () => { el.style.visibility = 'hidden'; } });
        } else {
          clearMotion(el);
          gsap.set(el, { x: diveX, y: diveY, opacity: 0, scale: 1 });
          el.style.visibility = 'hidden';
        }
      }
    });

    // ---------- 数组格动量 ----------
    State.items.forEach(it => {
      const el = DOM.cells[it.id];
      if (!el) return;
      const as = toArr.get(it.id);
      const tx = cellX(m, as);
      const fas = fromArr && fromArr.has(it.id) ? fromArr.get(it.id) : as;
      el.style.width = `${cellWpx(m)}px`;
      if (animating && fas !== as) {
        const x0 = cellX(m, fas);
        const dx = tx - x0;
        const oy = dx > 0 ? -lift : (isExtract ? 14 : 16);   // 双格互错，避免中途重叠
        arcMove(el, x0, m.cellY, tx, m.cellY, { x: 0, y: oy },
          isExtract ? 0.94 : 0.76, { amp: 0.05 });
      } else {
        clearMotion(el);
        gsap.set(el, { x: tx, y: m.cellY, opacity: 1, scale: 1 });
      }
    });

    // ---------- 高亮语义（严格 CSS 过渡，无突变） ----------
    paintHighlight(step);

    // 锁定状态（提取步稍缓，待元素落位）
    const paintLock = () => {
      step.order.forEach((id, s) => {
        DOM.cells[id].classList.toggle('is-locked', s >= step.lockedFrom);
      });
    };
    if (animating && isExtract) defer(paintLock, 720); else paintLock();

    // ---------- 活动堆区 / 已归位锁定区 ----------
    const paintZones = () => {
      DOM.zoneActive.style.width = `${Math.max(0, step.lockedFrom * m.cellW)}px`;
      DOM.zoneLocked.style.width = `${Math.max(0, (m.n - step.lockedFrom) * m.cellW)}px`;
      DOM.divider.style.transform = `translateX(${m.arrLeft + step.lockedFrom * m.cellW}px)`;
      DOM.divider.style.opacity = step.lockedFrom <= 0 ? '0' : '1';
    };
    if (animating && isExtract) defer(paintZones, 640); else paintZones();

    // ---------- 空缺堆顶 ----------
    const vacant = step.treeMap.length > 0 && step.treeMap[0] == null;
    gsap.set(DOM.vacant, { x: slotX(m, 0) - NODE_R, y: slotY(m, 0) - NODE_R });
    if (animating && vacant) defer(() => DOM.vacant.classList.add('show'), 780);
    else DOM.vacant.classList.toggle('show', vacant);

    // ---------- 焦点追踪环 ----------
    const fid = step.focusIds[0];
    const fts = fid != null ? step.treeMap.indexOf(fid) : -1;
    if (fts >= 0) {
      gsap.set(DOM.ring, { x: slotX(m, fts) - 34, y: slotY(m, fts) - 34 });
      DOM.ring.classList.add('show');
    } else {
      DOM.ring.classList.remove('show');
    }

    // ---------- 极值标记 MAX / MIN ----------
    const showExt = step.extrema && step.heapSize > 0;
    DOM.extrema.classList.toggle('show', showExt);
    if (showExt) {
      DOM.extrema.textContent = M.extrema;
      gsap.set(DOM.extrema, { xPercent: -50, x: slotX(m, 0) - 76, y: slotY(m, 0) - 11 });
      DOM.extrema.style.background = M.key === 'max' ? '#D97706' : '#2563EB';
    }

    // ---------- 擂主角标 ----------
    if (step.champ && toTree.has(step.champ.id)) {
      const cs = toTree.get(step.champ.id);
      DOM.champ.textContent = M.key === 'max' ? '擂主 · 较大者' : '擂主 · 较小者';
      gsap.set(DOM.champ, { xPercent: -50, x: slotX(m, cs), y: slotY(m, cs) - NODE_R - 34 });
      DOM.champ.classList.add('show');
    } else {
      DOM.champ.classList.remove('show');
    }

    // ---------- 第 2 拍判定气泡（沿父子连线中点向侧向偏移并夹紧，避让节点） ----------
    if (step.judge && toTree.has(step.judge.pid) && toTree.has(step.judge.cid)) {
      const ps = toTree.get(step.judge.pid), cs = toTree.get(step.judge.cid);
      const ax = slotX(m, ps), ay = slotY(m, ps);
      const bx = slotX(m, cs), by = slotY(m, cs);
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      DOM.judgeText.textContent = `${step.judge.cval} ${step.judge.cmp} ${step.judge.pval} ?`;
      DOM.judgeVerdict.textContent = step.judge.need ? 'TRUE ↓ 需交换' : 'FALSE ✓ 终止';
      DOM.judgeVerdict.className = step.judge.need ? 'need' : 'ok';
      gsap.set(DOM.judge, { xPercent: -50, yPercent: -50 });
      const bw = DOM.judge.offsetWidth / 2 + 10;
      const bh = DOM.judge.offsetHeight / 2 + 10;
      const mx = clamp((ax + bx) / 2 - dy / len * 88, bw, m.W - bw);
      const my = clamp((ay + by) / 2 + dx / len * 88, bh, m.H - bh);
      gsap.set(DOM.judge, { x: mx, y: my });
      DOM.judge.classList.add('show');
    } else {
      DOM.judge.classList.remove('show');
    }

    // ---------- 树视图清空提示 ----------
    if (DOM.treeEmpty) DOM.treeEmpty.classList.toggle('show', step.treeMap.length === 0);

    // ---------- 互换引导线 ----------
    if (step.guide && step.guide.to < step.treeMap.length) {
      const a = m.slots[step.guide.from], b = m.slots[step.guide.to];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const bow = Math.min(46, len * 0.42);
      const cx = (a.x + b.x) / 2 - dy / len * bow;
      const cy = (a.y + b.y) / 2 + dx / len * bow;
      DOM.guidePath.setAttribute('d', `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`);
      if (animating) {
        const L = DOM.guidePath.getTotalLength();
        gsap.set(DOM.guidePath, { opacity: 1 });
        gsap.fromTo(DOM.guidePath,
          { strokeDasharray: L, strokeDashoffset: L },
          { strokeDashoffset: 0, duration: dur(0.5), ease: 'power2.out' });
      } else {
        gsap.set(DOM.guidePath, { opacity: 1, strokeDasharray: 'none', strokeDashoffset: 0 });
      }
    } else if (animating) {
      gsap.to(DOM.guidePath, { opacity: 0, duration: dur(0.25) });
    } else {
      gsap.set(DOM.guidePath, { opacity: 0 });
    }

    // ---------- 终端语义条 ----------
    if (DOM.termText.textContent !== step.terminal) {
      DOM.termText.textContent = step.terminal;
      if (animating) gsap.fromTo(DOM.termText, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: dur(0.32), ease: 'power2.out' });
    }
  }

  // =========================================================================
  // 7. 渲染：步骤级微动效（点睛）
  // =========================================================================
  function playFlourish(step, m) {
    const type = step.anim ? step.anim.type : null;
    if (!type) return;

    switch (type) {

      case 'init': {
        gsap.from(DOM.nodes, {
          y: '-=26', opacity: 0, scale: 0.6,
          duration: dur(0.5), stagger: dur(0.08), ease: 'back.out(2.2)'
        });
        gsap.from(DOM.cells, {
          y: '-=22', opacity: 0, scale: 0.7,
          duration: dur(0.5), stagger: dur(0.07), delay: dur(0.12), ease: 'back.out(2)'
        });
        gsap.fromTo(DOM.boundaryPath, { opacity: 0 }, { opacity: 0.8, duration: dur(0.7), delay: dur(0.45) });
        animateClass(DOM.boundaryTag, 'tag-in', 0.55, 0.65);
        break;
      }

      case 'locate': {
        const L = DOM.boundaryPath.getTotalLength();
        gsap.fromTo(DOM.boundaryPath,
          { strokeDasharray: L, strokeDashoffset: L, opacity: 1 },
          {
            strokeDashoffset: 0, duration: dur(1.0), ease: 'power2.inOut',
            onComplete: () => gsap.set(DOM.boundaryPath, { strokeDasharray: '8 6', strokeDashoffset: 0 })
          });
        animateClass(DOM.boundaryTag, 'tag-in', 0.55, 0.4);
        const node = DOM.nodes[step.focusIds[0]];
        if (node) gsap.fromTo(node, { scale: 1 }, { scale: 1.16, duration: dur(0.36), yoyo: true, repeat: 1, ease: 'power2.out' });
        break;
      }

      case 'select': {
        step.anim.kids.forEach((k, i) => {
          const id = step.order[k];
          const node = DOM.nodes[id];
          if (!node) return;
          const y0 = gsap.getProperty(node, 'y');
          gsap.to(node, {
            keyframes: [
              { y: y0 - 10, duration: dur(0.24), ease: 'power2.out' },
              { y: y0, duration: dur(0.34), ease: 'bounce.out' }
            ],
            delay: dur(0.1 + i * 0.15)
          });
        });
        const champNode = DOM.nodes[step.champ.id];
        if (champNode) {
          gsap.fromTo(champNode, { boxShadow: '0 0 0 rgba(217,119,6,0)' },
            { boxShadow: '0 0 22px rgba(217,119,6,0.75)', duration: dur(0.3), delay: dur(0.55), yoyo: true, repeat: 1 });
        }
        pop(DOM.champ, 0.4, 0.5);
        break;
      }

      case 'judge': {
        pop(DOM.judge, 0.4, 0.12);
        const need = step.anim.need;
        const champNode = DOM.nodes[step.judge.cid];
        const parentNode = DOM.nodes[step.judge.pid];
        if (need) {
          if (champNode) gsap.fromTo(champNode, { scale: 1 }, { scale: 1.12, duration: dur(0.3), yoyo: true, repeat: 1, delay: dur(0.36), ease: 'power2.out' });
          if (parentNode) gsap.fromTo(parentNode, { scale: 1 }, { scale: 0.93, duration: dur(0.3), yoyo: true, repeat: 1, delay: dur(0.55), ease: 'power2.inOut' });
        } else {
          if (parentNode) {
            gsap.fromTo(parentNode, { boxShadow: '0 0 0 rgba(5,150,105,0)' },
              { boxShadow: '0 0 24px rgba(5,150,105,0.7)', duration: dur(0.36), delay: dur(0.45), yoyo: true, repeat: 1 });
          }
          animateClass(DOM.judge, 'badge-pulse', 0.5, 0.55);
        }
        break;
      }

      case 'swap': {
        // 对调双方落位回弹（此刻 order 已是交换后状态）
        const ids = [step.order[step.anim.to], step.order[step.anim.from]];
        ids.forEach(id => {
          const cell = DOM.cells[id];
          if (cell) gsap.fromTo(cell, { scale: 1 }, { scale: 1.07, duration: dur(0.26), yoyo: true, repeat: 1, delay: dur(0.7), ease: 'power2.out' });
          const node = DOM.nodes[id];
          if (node) gsap.fromTo(node, { scale: 1 }, { scale: 1.08, duration: dur(0.26), yoyo: true, repeat: 1, delay: dur(0.74), ease: 'power2.out' });
        });
        break;
      }

      case 'build-focus': {
        const node = DOM.nodes[step.focusIds[0]];
        if (node) gsap.fromTo(node, { scale: 1 }, { scale: 1.1, duration: dur(0.3), yoyo: true, repeat: 1, ease: 'power2.out' });
        break;
      }

      case 'build-done': {
        pop(DOM.extrema, 0.55, 0.3);
        // 自顶向下微脉冲
        for (let lv = 0; lv < m.levels; lv++) {
          defer(() => {
            m.slots.forEach((s, idx) => {
              if (s.lv !== lv) return;
              const id = step.treeMap[idx];
              if (id == null) return;
              gsap.fromTo(DOM.nodes[id], { scale: 1 },
                { scale: 1.13, duration: dur(0.3), yoyo: true, repeat: 1, ease: 'power2.out' });
            });
          }, 420 + lv * 320);
        }
        break;
      }

      case 'extract': {
        const landed = step.order[step.lockedFrom];
        defer(() => {
          const cell = DOM.cells[landed];
          if (cell) gsap.fromTo(cell, { boxShadow: '0 0 0 rgba(5,150,105,0)' },
            { boxShadow: '0 0 20px rgba(5,150,105,0.85)', duration: dur(0.34), yoyo: true, repeat: 1, ease: 'power2.out' });
        }, 800);
        break;
      }

      case 'promote': {
        const id = step.focusIds[0];
        if (id != null && DOM.cells[id]) {
          gsap.fromTo(DOM.cells[id], { scale: 1 }, { scale: 1.1, duration: dur(0.32), yoyo: true, repeat: 1, delay: dur(0.55), ease: 'back.out(2.2)' });
        }
        if (DOM.extrema.classList.contains('show')) {
          pop(DOM.extrema, 0.5, 0.6);
        }
        break;
      }

      case 'final-lock': {
        const id = step.focusIds[0];
        defer(() => {
          const cell = DOM.cells[id];
          if (cell) gsap.fromTo(cell, { boxShadow: '0 0 0 rgba(5,150,105,0)' },
            { boxShadow: '0 0 26px rgba(5,150,105,0.9)', duration: dur(0.4), yoyo: true, repeat: 1, ease: 'power2.out' });
        }, 760);
        break;
      }

      case 'wave': {
        const n = State.values.length;
        for (let i = 0; i < n; i++) {
          const cell = DOM.cells[step.order[i]];
          if (!cell) continue;
          gsap.fromTo(cell,
            { scale: 1, boxShadow: '0 2px 6px -3px rgba(0,0,0,0.12)' },
            {
              keyframes: [
                { scale: 1.15, boxShadow: '0 0 24px rgba(5,150,105,0.9)', duration: dur(0.3), ease: 'power2.out' },
                { scale: 1, boxShadow: '0 2px 6px -3px rgba(0,0,0,0.12)', duration: dur(0.44), ease: 'power2.in' }
              ],
              delay: dur(0.15 + i * 0.17)
            });
        }
        gsap.fromTo(DOM.termStrip, { scale: 1 }, { scale: 1.012, duration: dur(0.42), yoyo: true, repeat: 1, delay: dur(0.5) });
        break;
      }
    }
  }

  // =========================================================================
  // 8. 渲染入口
  // =========================================================================
  function render(idx, animate, forceFlourish) {
    State.idx = Math.max(0, Math.min(State.steps.length - 1, idx));
    const step = State.steps[State.idx];
    const m = measure();
    State.m = m;

    killAll();

    const from = (animate && State.lastState) ? State.lastState : null;
    applyState(step, m, from);
    if ((from || forceFlourish) && step.anim) playFlourish(step, m);

    State.lastState = {
      order: step.order.slice(),
      treeMap: step.treeMap.slice(),
      heapSize: step.heapSize,
      lockedFrom: step.lockedFrom
    };

    updateChrome(step);
  }

  function updateChrome(step) {
    const total = State.steps.length - 1;
    DOM.stepCounter.textContent = `步骤 ${State.idx} / ${total}`;
    DOM.stepDesc.textContent = `${step.title} —— ${step.terminal}`;
    DOM.progressFill.style.width = `${total > 0 ? (State.idx / total) * 100 : 0}%`;

    DOM.phaseBadge.textContent = step.stage;
    DOM.phaseBox.classList.remove('phase-build', 'phase-loop', 'phase-done');
    if (step.phase === 'P1') DOM.phaseBox.classList.add('phase-build');
    else if (step.phase === 'P2') DOM.phaseBox.classList.add('phase-loop');
    else if (step.phase === 'P3') DOM.phaseBox.classList.add('phase-done');

    const M = MODES[State.mode];
    setHud(DOM.hudMode, `${M.extrema} · ${M.name}`);
    setHud(DOM.hudHeap, step.heapSize);
    setHud(DOM.hudLocked, State.values.length - step.lockedFrom);
    setHud(DOM.hudComp, step.comp);
    setHud(DOM.hudSwap, step.swap);
    const fid = step.focusIds[0];
    const slot = fid != null ? step.order.indexOf(fid) : -1;
    setHud(DOM.hudFocus, slot >= 0 ? `A[${slot}]` : '—');

    DOM.codeLines.forEach(l => l.classList.remove('active'));
    const line = document.getElementById(`code-${step.codeLine}`);
    if (line) line.classList.add('active');

    DOM.btnPrev.disabled = State.idx === 0;
    DOM.btnNext.disabled = State.idx === State.steps.length - 1;
  }

  function setHud(el, val) {
    const text = String(val);
    if (!el || el.textContent === text) return;
    el.textContent = text;
    gsap.fromTo(el, { scale: 1.25 }, { scale: 1, duration: 0.36, ease: 'back.out(3)' });
  }

  // =========================================================================
  // 9. 播放控制
  // =========================================================================
  function pause() {
    State.playing = false;
    clearTimeout(State.timer);
    DOM.playIcon.textContent = '▶';
    DOM.playLabel.textContent = '播放';
  }

  function scheduleNext() {
    clearTimeout(State.timer);
    if (!State.playing) return;
    const step = State.steps[State.idx];
    State.timer = setTimeout(() => {
      if (!State.playing) return;
      if (State.idx >= State.steps.length - 1) { pause(); return; }
      render(State.idx + 1, true);
      scheduleNext();
    }, (step.hold || 1500) / State.speed);
  }

  function play() {
    if (State.idx >= State.steps.length - 1) render(0, false, true);
    State.playing = true;
    DOM.playIcon.textContent = '❚❚';
    DOM.playLabel.textContent = '暂停';
    scheduleNext();
  }

  function next() {
    pause();
    if (State.idx < State.steps.length - 1) render(State.idx + 1, true);
  }

  function prev() {
    pause();
    if (State.idx > 0) render(State.idx - 1, true);
  }

  function reset() {
    pause();
    render(0, false, true);
  }

  // =========================================================================
  // 10. 用例装载（模式切换保留数据 / 随机生成新数据）
  // =========================================================================
  function loadCase(values) {
    pause();
    State.values = values.slice();
    const gen = generate(State.values, State.mode);
    State.items = gen.items;
    State.steps = gen.steps;
    State.summary = gen.summary;
    State.lastState = null;
    buildEntities();
    DOM.dataBadge.textContent = `${MODES[State.mode].extrema} · [${State.values.join(', ')}]`;
    render(0, false, true);
    updateModeCapsule();
  }

  function updateModeCapsule() {
    DOM.modeMax.classList.toggle('active', State.mode === 'max');
    DOM.modeMin.classList.toggle('active', State.mode === 'min');
  }

  /** 切换堆型：保留当前数据，原地按新堆型重新演示 */
  function setMode(mode) {
    if (State.mode === mode) return;
    State.mode = mode;
    loadCase(State.values);
  }

  function randomValues() {
    const pool = [];
    for (let i = 10; i <= 99; i++) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, 7);
  }

  // =========================================================================
  // 11. 事件绑定
  // =========================================================================
  function bindEvents() {
    DOM.btnNext.addEventListener('click', next);
    DOM.btnPrev.addEventListener('click', prev);
    DOM.btnReset.addEventListener('click', reset);
    DOM.btnPlay.addEventListener('click', () => (State.playing ? pause() : play()));
    DOM.btnRandom.addEventListener('click', () => loadCase(randomValues()));
    DOM.modeMax.addEventListener('click', () => setMode('max'));
    DOM.modeMin.addEventListener('click', () => setMode('min'));

    DOM.speed.addEventListener('input', () => {
      State.speed = parseFloat(DOM.speed.value);
      DOM.speedVal.textContent = `${State.speed.toFixed(1)}x`;
      if (State.playing) scheduleNext();
    });

    DOM.progressBox.addEventListener('click', (e) => {
      const rect = DOM.progressBox.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      pause();
      render(Math.round(ratio * (State.steps.length - 1)), false);
    });

    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].indexOf(e.target.tagName) !== -1) return;
      if (e.code === 'Space') { e.preventDefault(); State.playing ? pause() : play(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'r' || e.key === 'R') { reset(); }
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => render(State.idx, false), 120);
    });
  }

  // =========================================================================
  // 12. 初始化
  // =========================================================================
  function init() {
    collectDOM();
    bindEvents();
    loadCase(DEFAULT_VALUES);

    if (window.katex && window.renderMathInElement) {
      try {
        renderMathInElement(document.body, {
          delimiters: [{ left: '$', right: '$', display: false }],
          throwOnError: false
        });
      } catch (e) { /* noop */ }
    }

    if (location.search.indexOf('autoplay') !== -1) setTimeout(play, 700);

    gsap.from('.card-panel', { y: 12, opacity: 0, duration: 0.5, stagger: 0.07, ease: 'power2.out' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
