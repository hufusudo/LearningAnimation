/**
 * 简单选择排序 · 稳定性边界特写 — 核心引擎
 * 演示重点：只记索引、趟末单次交换的轻量化移动机制，
 *           以及 5_A 被远距离交换跨越 5_B 导致“不稳定”的经典边界场景。
 * 严格遵循 Taste-Skill Light Editorial 规范与 60fps 缓动。
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. 全局状态
  // =========================================================================
  const State = {
    steps: [],
    idx: 0,
    playing: false,
    timer: null,
    speed: 1.0,
    currentFast: false,
    activePreset: 'edge'
  };

  // --------------------------------------------------------------------------
  // 预设用例（第一项为规范钉死的“不稳定边界”默认用例）
  // --------------------------------------------------------------------------
  const PRESETS = [
    { id: 'edge',    name: '🎯 不稳定边界 [5, 8, 5, 2]',            values: [5, 8, 5, 2] },
    { id: 'dup',     name: '🔁 同值前置 [5, 5, 3, 8]',              values: [5, 5, 3, 8] },
    { id: 'classic', name: '📘 408教材经典 [49,38,65,97,76,13,27]', values: [49, 38, 65, 97, 76, 13, 27] },
    { id: 'sorted',  name: '✅ 完全有序·零交换 [10..70]',           values: [10, 20, 30, 40, 50, 60, 70] },
    { id: 'desc',    name: '🔻 完全逆序·最坏交换 [70..10]',         values: [70, 60, 50, 40, 30, 20, 10] },
    { id: 'custom',  name: '✏️ 自定义输入…',                        values: null }
  ];

  const PHASE_LABEL = {
    P0: 'Phase 0 · 演示初始化',
    P1: 'Phase 1 · 首趟扫描与关键交换',
    P2: 'Phase 2 · 后续收敛与自交换规避',
    P3: 'Phase 3 · 全局状态固化'
  };

  // 同值元素自动打身份标签（按初始次序 A / B / C…）
  function buildItems(values) {
    const bucket = {};
    values.forEach((v, i) => { (bucket[v] = bucket[v] || []).push(i); });
    const tags = new Array(values.length).fill(null);
    Object.keys(bucket).forEach(k => {
      const idxs = bucket[k];
      if (idxs.length > 1) idxs.forEach((i, p) => { tags[i] = String.fromCharCode(65 + p); });
    });
    return values.map((v, i) => ({ v, tag: tags[i] }));
  }

  const fmt = it => (it.tag ? `${it.v}_${it.tag}` : `${it.v}`);
  const seqStr = arr => '[' + arr.map(fmt).join(', ') + ']';

  /** 交换 (i, m) 是否会打破同值元素的相对次序；返回被跨越的一对 */
  function findFlip(arr, i, m) {
    const lo = Math.min(i, m), hi = Math.max(i, m);
    for (let k = lo + 1; k < hi; k++) {
      if (arr[k].v === arr[i].v) return { mover: arr[i], crossed: arr[k], from: i, to: m };
      if (arr[k].v === arr[m].v) return { mover: arr[m], crossed: arr[k], from: m, to: i };
    }
    return null;
  }

  // =========================================================================
  // 2. 时间线生成器（按任意输入数组动态生成全部步骤）
  // =========================================================================
  function generateSteps(initialItems) {
    const steps = [];
    const n = initialItems.length;
    const hasDup = initialItems.some((it, k) => initialItems.some((o, q) => q < k && o.v === it.v));
    let flips = 0;

    const st = {
      arr: initialItems.map(o => ({ ...o })),
      comp: 0,
      swap: 0,
      sorted: 0,
      gate: 0
    };

    function push(o) {
      steps.push(Object.assign({
        phase: 'P0',
        title: '',
        terminal: '',
        i: null,
        j: null,
        minIdx: null,
        minPos: null,
        jPos: null,
        comp: st.comp,
        swap: st.swap,
        arr: st.arr.map(x => ({ ...x })),
        arrBefore: null,
        sorted: st.sorted,
        gate: st.gate,
        warn: false,
        showStats: false,
        codeLine: 1,
        hold: 1500,
        fast: false,
        anim: null,
        swapPair: null,
        chip: null
      }, o));
    }

    // ---------- Phase 0: 演示序列初始化 ----------
    push({
      phase: 'P0',
      title: 'Step 0 · 装载测试用例',
      terminal: hasDup
        ? `装载测试用例 A = ${seqStr(st.arr)}：同值元素以淡蓝 A / 深蓝 B 标签区分身份；下标 0 左侧立起虚线门（当前有序区为空，全部为无序区）。`
        : `装载数组 A = ${seqStr(st.arr)}：本例不含同值元素；下标 0 左侧立起虚线门（当前有序区为空，全部为无序区）。`,
      codeLine: 1,
      hold: 2200,
      anim: { type: 'init' }
    });

    // ---------- 各趟扫描（i = 0 .. n-2） ----------
    for (let i = 0; i < n - 1; i++) {
      const P = i === 0 ? 'P1' : 'P2';
      const fast = i > 0;

      push({
        phase: P, fast,
        title: `Step ${i + 1}.1 · 基准设定：minIndex ← i`,
        i, minIdx: i, minPos: i,
        terminal: `外层循环 i=${i}：${i === 0 ? '绯红边框锁定' : '重新锁定'} A[${i}]=${fmt(st.arr[i])}，minIndex 变量卡指向索引 ${i}（只记索引，元素纹丝不动），无序区 ${seqStr(st.arr.slice(i))}。`,
        codeLine: 3,
        hold: fast ? 1300 : 1900,
        anim: { type: 'lock' }
      });

      let minIdx = i;
      for (let j = i + 1; j < n; j++) {
        const cur = st.arr[minIdx];
        const cand = st.arr[j];
        const less = cand.v < cur.v;
        const equal = cand.v === cur.v;
        st.comp += 1;
        push({
          phase: P, fast,
          title: `Step ${i + 1}.2 · 扫描 j=${j}（${fmt(cand)} vs ${fmt(cur)}）`,
          i, j,
          minIdx: less ? j : minIdx,
          minPos: less ? j : minIdx,
          jPos: j,
          terminal: less
            ? `扫描：A[j]=A[${j}]=${fmt(cand)} < A[minIndex]=A[${minIdx}]=${fmt(cur)} ? TRUE → 绯红框平滑平移，minIndex 由 ${minIdx} 刷新为 ${j}，比较计数 Comp +1（累计 ${st.comp}）。`
            : `扫描：A[j]=A[${j}]=${fmt(cand)} < A[minIndex]=A[${minIdx}]=${fmt(cur)} ? FALSE${equal ? `（${cand.v} 不小于 ${cur.v}，严格小于才更新）` : ''} → minIndex 不动，比较计数 Comp +1（累计 ${st.comp}）。`,
          codeLine: less ? 6 : 5,
          hold: fast ? (less ? 1300 : 1500) : (less ? 1900 : (equal ? 1700 : 1500)),
          anim: { type: 'compare', moveMin: less },
          chip: { l: `A[${j}]=${fmt(cand)}`, r: `A[minIndex]=${fmt(cur)}`, res: less }
        });
        if (less) minIdx = j;
      }

      // 扫描触底判定
      push({
        phase: P, fast,
        title: `Step ${i + 1}.3 · 扫描触底判定`,
        i, minIdx, minPos: minIdx,
        terminal: `收敛：j 已右移至 n−1=${n - 1}，单向寻址扫描结束；判定 minIndex(${minIdx}) ${minIdx !== i ? '≠' : '=='} i(${i}) → ${minIdx !== i ? '本轮至多触发 1 次交换' : 'minIndex == i，跳过交换（自交换规避）'}。`,
        codeLine: 7,
        hold: fast ? 1400 : 1800,
        anim: { type: 'judge' }
      });

      // 趟末动作：单次交换 / 自交换规避
      if (minIdx !== i) {
        const before = st.arr.map(x => ({ ...x }));
        const flip = findFlip(st.arr, i, minIdx);
        [st.arr[i], st.arr[minIdx]] = [st.arr[minIdx], st.arr[i]];
        st.swap += 1;
        push({
          phase: P, fast,
          title: `Step ${i + 1}.4 · 趟末单次交换`,
          i, minIdx, minPos: null,
          arrBefore: before,
          swapPair: [i, minIdx],
          terminal: `交换：A[${i}](${fmt(before[i])}) 与 A[${minIdx}](${fmt(before[minIdx])}) 分别下沉 / 上浮 30px 后沿三维弧形轨迹互换并回轨 —— 本趟唯一一次物理移动，Swap Count +1（累计 ${st.swap}），序列变为 ${seqStr(st.arr)}。`,
          codeLine: 8,
          hold: fast ? 1700 : 2400,
          anim: { type: 'swap', p: i, q: minIdx }
        });

        if (flip) {
          flips += 1;
          const right = flip.from < flip.to;
          push({
            phase: P,
            title: `Step ${i + 1}.4 · 不稳定性成立（考点爆闪）`,
            i, minIdx, warn: true,
            terminal: `【考点警告】${fmt(flip.mover)} 被远距离交换至 ${fmt(flip.crossed)} ${right ? '右侧' : '左侧'}（下标 ${flip.from} → ${flip.to}），原相对次序 ${fmt(flip.mover)}…${fmt(flip.crossed)} 突变为 ${fmt(flip.crossed)}…${fmt(flip.mover)}，选择排序不稳定性成立！`,
            codeLine: 8,
            hold: 3000,
            anim: { type: 'warn', pair: [i, minIdx] }
          });
        }
      } else {
        push({
          phase: P, fast,
          title: `Step ${i + 1}.4 · 自交换规避（minIndex == i）`,
          i, minIdx, minPos: null,
          terminal: `自交换规避：minIndex(${i}) == i(${i}) → 本趟 0 次交换，序列保持 ${seqStr(st.arr)}；本趟 ${n - 1 - i} 次比较照常计入，当前累计 Comp = ${st.comp}。`,
          codeLine: 7,
          hold: fast ? 1400 : 1700,
          anim: { type: 'noswap' }
        });
      }

      // 有序边界推移
      st.sorted = i + 1;
      st.gate = i + 1;
      push({
        phase: P, fast,
        title: `Step ${i + 1}.5 · 有序边界推移`,
        i, minIdx: null,
        terminal: `边界推移：A[${i}]=${fmt(st.arr[i])} 变为翡翠绿固化，虚线隔离门平滑右移停在索引 ${i} 与 ${i + 1} 之间 —— 有序区 ${seqStr(st.arr.slice(0, st.sorted))}，无序区 ${seqStr(st.arr.slice(st.sorted))}。`,
        codeLine: 9,
        hold: fast ? 1400 : 1900,
        anim: { type: 'gate' }
      });
    }

    // ---------- 尾趟：末位单元素（i = n-1） ----------
    push({
      phase: 'P2', fast: true,
      title: `Step ${n}.1 · 轮次 i=${n - 1}，末位单元素`,
      i: n - 1, minIdx: n - 1, minPos: n - 1,
      terminal: `外层循环 i=${n - 1}：无序区只剩单个元素 ${fmt(st.arr[n - 1])}，minIndex ← ${n - 1}；内层 for 从 j=${n} 起不满足 j < n，直接跳过扫描。`,
      codeLine: 4,
      hold: 1500,
      anim: { type: 'lock' }
    });

    st.sorted = n;
    st.gate = n;
    push({
      phase: 'P2', fast: true,
      title: `Step ${n}.2 · 自交换规避 + 有序边界推移`,
      i: n - 1, minIdx: n - 1, minPos: null,
      terminal: `自交换规避：判定 minIndex(${n - 1}) == i(${n - 1}) → 跳过 swap，末位 ${fmt(st.arr[n - 1])} 直接转为翡翠绿；虚线门推至最右，无序区清空。`,
      codeLine: 7,
      hold: 1700,
      anim: { type: 'gate', selfSkip: true }
    });

    // ---------- Phase 3: 全局状态固化与复杂度收敛 ----------
    const unstable = flips > 0;
    push({
      phase: 'P3',
      title: 'Final · 全局状态固化（Gleam）',
      terminal: `全部 ${n} 张卡片统一亮起翡翠绿并播放光泽动效 —— 最终序列 A = ${seqStr(st.arr)}${hasDup
        ? (unstable ? '；同值元素相对次序已被打乱，本例触发不稳定。' : '；本例同值元素次序未被打破（算法本身仍属不稳定）。')
        : '（本例无同值元素）。'}`,
      codeLine: 10,
      showStats: true,
      hold: 2600,
      anim: { type: 'gleam' }
    });

    push({
      phase: 'P3',
      title: 'Final · 复杂度收敛定格',
      terminal: `统计定格：比较次数恒为 n(n−1)/2 = ${st.comp} 次，交换次数 ${st.swap} 次${st.swap <= n - 1 ? `（≤ n−1=${n - 1}）` : ''}；时间 O(n²)、空间 O(1)、稳定性 ${unstable ? '✗ 不稳定（本例触发同值跨越）' : (hasDup ? '✗ 不稳定（本例未触发跨越）' : '✓ 稳定（本例无同值元素）')}。`,
      codeLine: 10,
      showStats: true,
      hold: 3400,
      anim: { type: 'stats' }
    });

    return {
      steps,
      summary: { n, comp: st.comp, swap: st.swap, unstable, hasDup, final: seqStr(st.arr) }
    };
  }

  // =========================================================================
  // 3. DOM 引用与槽位构建
  // =========================================================================
  const DOM = {};

  function collectDOM() {
    DOM.canvas = document.getElementById('stage-canvas');
    DOM.arrayRow = document.getElementById('array-row');
    DOM.gate = document.getElementById('gate');
    DOM.minFrame = document.getElementById('min-frame');
    DOM.jCursor = document.getElementById('j-cursor');
    DOM.jIdx = document.getElementById('j-badge-idx');
    DOM.chip = document.getElementById('compare-chip');
    DOM.lblOrdered = document.getElementById('region-ordered');
    DOM.lblUnsorted = document.getElementById('region-unsorted');
    DOM.termStrip = document.getElementById('terminal-strip');
    DOM.termText = document.getElementById('terminal-text');
    DOM.warnDot = document.getElementById('warn-dot');
    DOM.phaseBadge = document.getElementById('phase-badge');
    DOM.hudI = document.getElementById('hud-i');
    DOM.hudJ = document.getElementById('hud-j');
    DOM.hudMin = document.getElementById('hud-min');
    DOM.hudMinVal = document.getElementById('hud-minval');
    DOM.hudComp = document.getElementById('hud-comp');
    DOM.hudSwap = document.getElementById('hud-swap');
    DOM.finalStats = document.getElementById('final-stats');
    DOM.stageRange = document.getElementById('stage-range');
    DOM.stepCounter = document.getElementById('step-counter');
    DOM.stepDesc = document.getElementById('step-description');
    DOM.progressFill = document.getElementById('progress-bar-fill');
    DOM.progressBox = document.getElementById('progress-bar-container');
    DOM.btnReset = document.getElementById('btn-reset');
    DOM.btnPrev = document.getElementById('btn-prev');
    DOM.btnNext = document.getElementById('btn-next');
    DOM.btnPlay = document.getElementById('btn-play');
    DOM.playIcon = document.getElementById('play-icon');
    DOM.playLabel = document.getElementById('play-label');
    DOM.speedBtns = Array.from(document.querySelectorAll('.speed-btn'));
    DOM.caseBadge = document.getElementById('case-badge');
    DOM.presetSelect = document.getElementById('preset-select');
    DOM.customBar = document.getElementById('custom-input-bar');
    DOM.inputArray = document.getElementById('input-array');
    DOM.btnApplyCustom = document.getElementById('btn-apply-custom');
    DOM.btnCancelCustom = document.getElementById('btn-cancel-custom');
    DOM.customHint = document.getElementById('custom-hint');
    DOM.statComp = document.getElementById('stat-comp');
    DOM.statSwap = document.getElementById('stat-swap');
    DOM.statStab = document.getElementById('stat-stab');
    DOM.statFinal = document.getElementById('stat-final');
    DOM.slots = [];
    DOM.cells = [];
    DOM.codeLines = Array.from(document.querySelectorAll('.code-line'));
  }

  function buildSlots(items) {
    DOM.arrayRow.innerHTML = '';
    DOM.slots = [];
    DOM.cells = [];
    items.forEach((item, k) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.id = `slot-${k}`;

      const idx = document.createElement('div');
      idx.className = 'cell-index';
      idx.textContent = `[${k}]`;

      const cell = document.createElement('div');
      cell.className = 'cell st-unsorted';

      const val = document.createElement('span');
      val.className = 'cell-val';
      val.textContent = item.v;

      const pos = document.createElement('span');
      pos.className = 'cell-pos-badge';
      pos.textContent = `@${k}`;

      cell.appendChild(val);
      cell.appendChild(pos);
      slot.appendChild(idx);
      slot.appendChild(cell);
      DOM.arrayRow.appendChild(slot);

      DOM.slots.push(slot);
      DOM.cells.push(cell);
    });
  }

  // =========================================================================
  // 4. 几何布局（一律使用 offset*，不受 transform 影响）
  // =========================================================================
  function measure() {
    return {
      baseW: DOM.canvas.clientWidth,
      slots: DOM.slots.map(s => ({ x: s.offsetLeft, w: s.offsetWidth })),
      cellTop: DOM.cells[0].offsetTop,
      cellH: DOM.cells[0].offsetHeight,
      rowBottom: DOM.arrayRow.offsetTop + DOM.arrayRow.offsetHeight
    };
  }

  /** 有序 / 无序分界（虚线门）的 x 坐标：k = 有序区长度 */
  function gateX(m, k) {
    const n = m.slots.length;
    if (k <= 0) return Math.max(4, m.slots[0].x - 15);
    if (k >= n) {
      const last = m.slots[n - 1];
      return last.x + last.w + 15;
    }
    const prev = m.slots[k - 1];
    const cur = m.slots[k];
    const gap = cur.x - (prev.x + prev.w);
    return cur.x - Math.max(6, gap / 2);
  }

  function centerOf(m, k) {
    const s = m.slots[k];
    return s.x + s.w / 2;
  }

  function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

  /** 采集覆盖层“动画前”的真实位置，供位移动画作为起点 */
  function capturePrev() {
    return {
      gateX: num(gsap.getProperty(DOM.gate, 'x')),
      frameX: num(gsap.getProperty(DOM.minFrame, 'x')),
      frameVisible: num(gsap.getProperty(DOM.minFrame, 'opacity')) > 0.01,
      cursorX: num(gsap.getProperty(DOM.jCursor, 'x')),
      cursorVisible: num(gsap.getProperty(DOM.jCursor, 'opacity')) > 0.01
    };
  }

  // =========================================================================
  // 5. 状态渲染
  // =========================================================================
  function setHud(el, val) {
    const text = String(val);
    if (el.textContent === text) return;
    el.textContent = text;
    gsap.fromTo(el, { scale: 1.28 }, { scale: 1, duration: 0.38, ease: 'back.out(3)' });
  }

  function paintCells(arr, step) {
    arr.forEach((item, k) => {
      const cell = DOM.cells[k];
      cell.className = 'cell ' + (k < step.sorted ? 'st-sorted' : 'st-unsorted');
      if (step.jPos === k) cell.classList.add('is-scan');
      if (step.swapPair && step.swapPair.indexOf(k) !== -1) cell.classList.add('is-swap');

      cell.querySelector('.cell-val').textContent = item.v;

      let tag = cell.querySelector('.cell-tag');
      if (item.tag) {
        if (!tag) {
          tag = document.createElement('span');
          cell.appendChild(tag);
        }
        tag.className = 'cell-tag ' + (item.tag === 'A' ? 'tag-a' : 'tag-b');
        tag.textContent = item.tag;
      } else if (tag) {
        tag.remove();
      }
    });
  }

  function applyState(step, opts) {
    opts = opts || {};
    const arr = opts.preArr || step.arr;
    const m = measure();
    const anim = step.anim;
    const animate = !!opts.animate;
    const prev = opts.prev || capturePrev();

    // --- 卡片 ---
    paintCells(arr, step);

    // --- HUD 指标 ---
    setHud(DOM.hudI, step.i === null ? '—' : step.i);
    setHud(DOM.hudJ, step.j === null ? '—' : step.j);
    setHud(DOM.hudMin, step.minIdx === null ? '—' : step.minIdx);
    if (step.minIdx === null || step.minIdx >= arr.length) {
      setHud(DOM.hudMinVal, '—');
    } else {
      const it = arr[step.minIdx];
      setHud(DOM.hudMinVal, it.tag ? `${it.v}_${it.tag}` : it.v);
    }
    setHud(DOM.hudComp, step.comp);
    setHud(DOM.hudSwap, step.swap);

    DOM.phaseBadge.textContent = PHASE_LABEL[step.phase];
    const nLast = step.arr.length - 1;
    DOM.stageRange.textContent = step.sorted === 0
      ? `有序区 ∅ · 无序区 A[0..${nLast}]`
      : `有序区 A[0..${step.sorted - 1}] · 无序区 A[${step.sorted}..${nLast}]`;

    // --- 底部终端语义条 ---
    if (DOM.termText.textContent !== step.terminal) {
      DOM.termText.textContent = step.terminal;
      gsap.fromTo(DOM.termText, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out' });
    }
    DOM.termStrip.classList.toggle('is-warn', !!step.warn);
    DOM.warnDot.style.display = step.warn ? 'block' : 'none';
    if (step.warn) {
      gsap.fromTo(DOM.termText, { scale: 1.1, color: '#FF6B81' }, { scale: 1, duration: 0.55, ease: 'power2.out' });
    }

    // --- 复杂度定格面板 ---
    const wantStats = !!step.showStats;
    if (wantStats) {
      if (!DOM.finalStats.classList.contains('show')) {
        DOM.finalStats.classList.add('show');
        gsap.from(DOM.finalStats.querySelectorAll('.stat-chip'), { y: 8, opacity: 0, duration: 0.4, stagger: 0.07, ease: 'power2.out' });
      }
    } else {
      DOM.finalStats.classList.remove('show');
    }

    // --- 伪代码逐行高亮 ---
    DOM.codeLines.forEach(l => l.classList.remove('active'));
    const activeLine = document.getElementById(`code-${step.codeLine}`);
    if (activeLine) activeLine.classList.add('active');

    // --- 进度条 / 步骤说明 ---
    DOM.stepCounter.textContent = `步骤 ${State.idx} / ${State.steps.length - 1}`;
    DOM.stepDesc.textContent = `${step.title} —— ${step.terminal}`;
    DOM.progressFill.style.width = `${State.steps.length > 1 ? (State.idx / (State.steps.length - 1)) * 100 : 0}%`;

    // --- 区域标签（CSS transition 负责平滑） ---
    const gx = gateX(m, step.gate);
    DOM.lblOrdered.textContent = step.sorted === 0 ? '⟵ 有序区（当前为空）' : '⟵ 有序区';
    DOM.lblOrdered.style.width = `${gx}px`;
    DOM.lblOrdered.style.opacity = gx < 64 ? '0' : '1';
    DOM.lblUnsorted.style.left = `${gx}px`;
    DOM.lblUnsorted.style.width = `${Math.max(0, m.baseW - gx)}px`;

    // --- 虚线门 ---
    if (animate && anim && anim.type === 'gate') {
      gsap.set(DOM.gate, { x: prev.gateX });   // 留给动画补间
    } else {
      gsap.set(DOM.gate, { x: gx });
    }

    // --- minIndex 绯红追踪框 ---
    if (step.minPos === null) {
      gsap.set(DOM.minFrame, { opacity: 0 });
    } else {
      const s = m.slots[step.minPos];
      const target = { x: s.x - 5, y: m.cellTop - 5, width: s.w + 10, height: m.cellH + 10 };
      if (animate && anim && anim.moveMin && prev.frameVisible) {
        gsap.set(DOM.minFrame, { opacity: 1, x: prev.frameX, y: target.y, width: target.width, height: target.height });
      } else {
        gsap.set(DOM.minFrame, Object.assign({ opacity: 1 }, target));
      }
    }

    // --- 扫描光标 j ---
    if (step.jPos === null) {
      gsap.set(DOM.jCursor, { opacity: 0 });
    } else {
      const s = m.slots[step.jPos];
      const target = { x: s.x, y: m.rowBottom + 6, width: s.w };
      if (animate && anim && anim.type === 'compare' && prev.cursorVisible) {
        gsap.set(DOM.jCursor, { opacity: 1, x: prev.cursorX, y: target.y, width: target.width });
      } else {
        gsap.set(DOM.jCursor, Object.assign({ opacity: 1 }, target));
      }
      DOM.jIdx.textContent = step.jPos;
    }

    // --- 比较判定气泡 ---
    if (step.chip && step.jPos !== null && step.minIdx !== null) {
      const c = (centerOf(m, step.jPos) + centerOf(m, step.minIdx)) / 2;
      DOM.chip.innerHTML =
        `${step.chip.l} &lt; ${step.chip.r} ? ` +
        (step.chip.res ? '<span class="cc-true">TRUE</span>' : '<span class="cc-false">FALSE</span>');
      DOM.chip.style.left = `${Math.round(c - DOM.chip.offsetWidth / 2)}px`;
      gsap.set(DOM.chip, { opacity: animate && anim && anim.type === 'compare' ? 0 : 1 });
    } else {
      gsap.set(DOM.chip, { opacity: 0 });
    }

    return m;
  }

  // =========================================================================
  // 6. 步骤动画
  // =========================================================================
  function D(base) {
    return base / State.speed * (State.currentFast ? 0.7 : 1);
  }

  function playStepAnimation(step, m, prev) {
    const anim = step.anim;
    if (!anim) return;

    switch (anim.type) {

      case 'init': {
        gsap.from(DOM.cells, { y: -34, opacity: 0, duration: D(0.5), stagger: D(0.1), ease: 'power3.out' });
        gsap.from(DOM.gate, { scaleY: 0, transformOrigin: 'top', duration: D(0.55), ease: 'power2.out' });
        gsap.from('.cell-index', { opacity: 0, y: -6, duration: D(0.4), stagger: D(0.08), delay: D(0.15) });
        break;
      }

      case 'lock': {
        const s = m.slots[step.minPos];
        gsap.fromTo(DOM.minFrame,
          { opacity: 0, scale: 0.86, transformOrigin: '50% 50%' },
          { opacity: 1, scale: 1, duration: D(0.42), ease: 'back.out(2.4)' });
        gsap.fromTo(DOM.cells[step.minPos],
          { scale: 1 },
          { scale: 1.07, duration: D(0.2), yoyo: true, repeat: 1, ease: 'power2.out' });
        break;
      }

      case 'compare': {
        gsap.to(DOM.jCursor, {
          x: m.slots[step.jPos].x,
          y: m.rowBottom + 6,
          width: m.slots[step.jPos].w,
          opacity: 1,
          duration: D(0.34),
          ease: 'power3.out'
        });
        gsap.fromTo(DOM.chip,
          { opacity: 0, y: -8, scale: 0.9 },
          { opacity: 1, y: 0, scale: 1, duration: D(0.3), delay: D(0.18), ease: 'back.out(2)' });
        gsap.fromTo(DOM.cells[step.jPos],
          { boxShadow: '0 0 0 rgba(255,159,28,0)' },
          { boxShadow: '0 0 24px rgba(255,159,28,0.9)', duration: D(0.24), yoyo: true, repeat: 1, ease: 'power1.inOut' });

        if (anim.moveMin && step.minPos !== null) {
          const target = m.slots[step.minPos];
          gsap.to(DOM.minFrame, {
            x: target.x - 5,
            width: target.w + 10,
            duration: D(0.52),
            delay: D(0.36),
            ease: 'power2.inOut'
          });
          gsap.fromTo(DOM.minFrame,
            { boxShadow: '0 0 16px rgba(231,29,54,0.5), inset 0 0 10px rgba(231,29,54,0.12)' },
            { boxShadow: '0 0 32px rgba(231,29,54,0.95), inset 0 0 14px rgba(231,29,54,0.3)', duration: D(0.3), delay: D(0.75), yoyo: true, repeat: 1 });
        }
        break;
      }

      case 'judge': {
        gsap.to(DOM.minFrame, { scale: 1.07, transformOrigin: '50% 50%', duration: D(0.34), yoyo: true, repeat: 3, ease: 'sine.inOut' });
        if (step.i !== null) {
          gsap.fromTo(DOM.cells[step.i], { scale: 1 }, { scale: 1.06, duration: D(0.3), yoyo: true, repeat: 3, ease: 'sine.inOut' });
        }
        break;
      }

      case 'swap': {
        const p = anim.p, q = anim.q;
        const cellP = DOM.cells[p], cellQ = DOM.cells[q];
        const dxP = m.slots[q].x - m.slots[p].x;
        const dxQ = m.slots[p].x - m.slots[q].x;

        gsap.set([cellP, cellQ], { zIndex: 46 });
        gsap.set(DOM.minFrame, { opacity: 0 });
        gsap.set(DOM.chip, { opacity: 0 });

        const myIdx = State.idx;
        const tl = gsap.timeline({
          onComplete: () => {
            if (myIdx !== State.idx) return;   // 已被下一步打断，交由新的渲染接管
            gsap.set([cellP, cellQ], { clearProps: 'transform,zIndex' });
            applyState(step);   // 回轨落位：呈现交换后的真实序列
            gsap.fromTo([cellP, cellQ], { scale: 1.07 }, { scale: 1, duration: D(0.32), ease: 'back.out(2)' });
          }
        });

        // 下沉 / 上浮 30px → 三维弧形轨迹互换 → 回轨
        tl.to(cellP, {
          keyframes: [
            { y: 30, duration: D(0.2), ease: 'power2.out' },
            { x: dxP * 0.5, y: 46, scale: 1.06, duration: D(0.34), ease: 'power1.inOut' },
            { x: dxP, y: 30, scale: 1.02, duration: D(0.34), ease: 'power1.inOut' },
            { y: 0, scale: 1, duration: D(0.2), ease: 'power2.in' }
          ]
        }, 0);
        tl.to(cellQ, {
          keyframes: [
            { y: -30, duration: D(0.2), ease: 'power2.out' },
            { x: dxQ * 0.5, y: -46, scale: 1.06, duration: D(0.34), ease: 'power1.inOut' },
            { x: dxQ, y: -30, scale: 1.02, duration: D(0.34), ease: 'power1.inOut' },
            { y: 0, scale: 1, duration: D(0.2), ease: 'power2.in' }
          ]
        }, 0);
        break;
      }

      case 'warn': {
        const pair = (anim.pair && anim.pair.length === 2) ? anim.pair : [0, DOM.cells.length - 1];
        const shake = (el, dir) => gsap.fromTo(el, { x: 0 },
          { x: 4 * dir, duration: D(0.07), yoyo: true, repeat: 5, ease: 'sine.inOut', onComplete: () => gsap.set(el, { x: 0 }) });
        shake(DOM.cells[pair[0]], -1);
        shake(DOM.cells[pair[1]], 1);
        gsap.fromTo(DOM.termStrip, { scale: 1 }, { scale: 1.012, duration: D(0.18), yoyo: true, repeat: 3, ease: 'sine.inOut' });
        break;
      }

      case 'noswap': {
        if (step.i !== null) {
          gsap.fromTo(DOM.cells[step.i], { scale: 1 }, { scale: 1.08, duration: D(0.3), yoyo: true, repeat: 1, ease: 'back.out(2.2)' });
        }
        break;
      }

      case 'gate': {
        gsap.to(DOM.gate, { x: gateX(m, step.gate), duration: D(0.55), ease: 'power3.inOut' });
        const target = DOM.cells[Math.max(0, step.sorted - 1)];
        if (target) {
          gsap.fromTo(target, { scale: 1 }, { scale: 1.1, duration: D(0.3), delay: D(0.42), yoyo: true, repeat: 1, ease: 'back.out(2.2)' });
        }
        break;
      }

      case 'gleam': {
        DOM.cells.forEach((cell, k) => {
          setTimeout(() => {
            cell.classList.add('gleam');
            gsap.fromTo(cell, { scale: 1 }, { scale: 1.09, duration: D(0.24), yoyo: true, repeat: 1, ease: 'back.out(2)' });
            setTimeout(() => cell.classList.remove('gleam'), 1000);
          }, (k * 140) / State.speed);
        });
        break;
      }

      case 'stats': {
        gsap.fromTo(DOM.finalStats.querySelectorAll('.stat-chip'),
          { scale: 1 }, { scale: 1.05, duration: D(0.24), yoyo: true, repeat: 1, stagger: D(0.08), ease: 'power2.out' });
        break;
      }
    }
  }

  // =========================================================================
  // 7. 渲染入口
  // =========================================================================
  function render(idx, animate) {
    State.idx = Math.max(0, Math.min(State.steps.length - 1, idx));
    const step = State.steps[State.idx];
    const anim = step.anim;
    State.currentFast = !!(anim && step.fast);

    // 无论是否带动画：先终止上一步残留的补间并归位，
    // 保证快速连点 / 跳转时卡片绝不会滞留在半途
    gsap.killTweensOf([...DOM.cells, DOM.gate, DOM.minFrame, DOM.jCursor, DOM.chip, DOM.termStrip]);
    DOM.cells.forEach(c => gsap.set(c, { clearProps: 'transform,zIndex,boxShadow' }));
    gsap.set(DOM.minFrame, { clearProps: 'scale,boxShadow' });
    gsap.set(DOM.termStrip, { clearProps: 'scale' });

    const prev = capturePrev();
    // 交换步骤：先渲染“交换前”状态，再由弧形动画推演到“交换后”
    const preArr = (animate && step.arrBefore) ? step.arrBefore : null;

    const m = applyState(step, { animate, prev, preArr });
    if (animate && anim) playStepAnimation(step, m, prev);

    DOM.btnPrev.disabled = State.idx === 0;
    DOM.btnNext.disabled = State.idx === State.steps.length - 1;
  }

  // =========================================================================
  // 8. 播放控制
  // =========================================================================
  function pause() {
    State.playing = false;
    clearTimeout(State.timer);
    DOM.playIcon.textContent = '▶';
    DOM.playLabel.textContent = '自动播放';
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
    }, (step.hold || 1400) / State.speed);
  }

  function play() {
    if (State.idx >= State.steps.length - 1) render(0, false);
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
    if (State.idx > 0) render(State.idx - 1, false);
  }

  function reset() {
    pause();
    render(0, false);
  }

  // =========================================================================
  // 9. 事件绑定
  // =========================================================================
  function bindEvents() {
    DOM.btnNext.addEventListener('click', next);
    DOM.btnPrev.addEventListener('click', prev);
    DOM.btnReset.addEventListener('click', reset);
    DOM.btnPlay.addEventListener('click', () => (State.playing ? pause() : play()));

    DOM.speedBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        DOM.speedBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        State.speed = parseFloat(btn.dataset.speed);
        if (State.playing) scheduleNext();
      });
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

    // 预设用例切换
    if (DOM.presetSelect) {
      DOM.presetSelect.addEventListener('change', (e) => {
        const preset = PRESETS.find(p => p.id === e.target.value) || PRESETS[0];
        State.activePreset = preset.id;
        if (preset.values) {
          showCustomBar(false);
          loadCase(preset.values, stripEmoji(preset.name));
        } else {
          showCustomBar(true);
        }
      });
    }
    if (DOM.btnApplyCustom) DOM.btnApplyCustom.addEventListener('click', applyCustom);
    if (DOM.btnCancelCustom) DOM.btnCancelCustom.addEventListener('click', () => {
      showCustomBar(false);
      DOM.presetSelect.value = State.activePreset;
    });
    if (DOM.inputArray) {
      DOM.inputArray.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyCustom(); }
      });
      DOM.inputArray.addEventListener('input', () => customHint(''));
    }
  }

  // =========================================================================
  // 10. 用例装载（预设多用例 + 自定义输入）
  // =========================================================================
  const stripEmoji = s => s.replace(/^[^0-9A-Za-z\[]+\s*/, '');

  function customHint(text) {
    if (!DOM.customHint) return;
    DOM.customHint.textContent = text || '支持 3 ~ 8 个整数，允许重复值（同值元素自动打 A/B/C 身份标签）';
    DOM.customHint.classList.toggle('text-rose-600', !!text);
  }

  function showCustomBar(show) {
    if (!DOM.customBar) return;
    DOM.customBar.style.display = show ? 'flex' : 'none';
    if (show) {
      customHint('');
      setTimeout(() => DOM.inputArray && DOM.inputArray.focus(), 50);
    }
  }

  function applyCustom() {
    const nums = String(DOM.inputArray.value)
      .split(/[,，;；\s]+/)
      .filter(Boolean)
      .map(x => parseInt(x, 10))
      .filter(v => !isNaN(v));
    if (nums.length < 3 || nums.length > 8) {
      customHint('✕ 请输入 3 ~ 8 个整数，例如 5, 8, 5, 2');
      return;
    }
    if (nums.some(v => Math.abs(v) > 999)) {
      customHint('✕ 数值请控制在 -999 ~ 999 之间');
      return;
    }
    State.activePreset = 'custom';
    showCustomBar(false);
    loadCase(nums, `自定义 · [${nums.join(', ')}]`);
  }

  function updateStatsPanel(s) {
    if (!DOM.statComp) return;
    DOM.statComp.textContent = `n(n−1)/2 = ${s.comp}`;
    DOM.statSwap.textContent = `${s.swap} ${s.swap <= s.n - 1 ? '≤' : '>'} n−1`;
    DOM.statStab.textContent = s.unstable ? '✗ 不稳定' : (s.hasDup ? '✓ 本例未破序' : '✓ 无同值元素');
    DOM.statStab.parentElement.classList.toggle('warn-chip', s.unstable);
    DOM.statFinal.textContent = s.final;
  }

  function loadCase(values, badge) {
    pause();
    State.values = values.slice();
    State.items = buildItems(State.values);
    const gen = generateSteps(State.items);
    State.steps = gen.steps;
    State.summary = gen.summary;

    buildSlots(State.items);
    DOM.canvas.classList.toggle('dense', State.items.length >= 6);
    DOM.canvas.classList.toggle('dense-xl', State.items.length >= 8);
    if (DOM.caseBadge) DOM.caseBadge.textContent = badge;
    if (DOM.presetSelect) DOM.presetSelect.value = State.activePreset;
    updateStatsPanel(gen.summary);
    render(0, false);

    gsap.from('#array-row .cell', { y: -26, opacity: 0, duration: 0.45, stagger: 0.07, ease: 'power3.out' });
    gsap.from('#array-row .cell-index', { opacity: 0, duration: 0.4, stagger: 0.05, delay: 0.12 });
  }

  // =========================================================================
  // 11. 初始化
  // =========================================================================
  function init() {
    collectDOM();
    bindEvents();

    const first = PRESETS[0];
    State.activePreset = first.id;
    if (DOM.presetSelect) DOM.presetSelect.value = first.id;
    loadCase(first.values, stripEmoji(first.name));

    // 支持 ?autoplay 直接进入自动播放（便于分享与回归截图）
    if (location.search.indexOf('autoplay') !== -1) setTimeout(play, 400);

    gsap.from('#dashboard', { y: 14, opacity: 0, duration: 0.5, ease: 'power2.out' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
