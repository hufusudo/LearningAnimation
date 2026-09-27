/**
 * 归并排序单行裂变与悬浮托盘归并 — 核心引擎
 *
 * 视觉模型：
 *   · 单行动态裂变 —— 主序列始终保持在同一水平线上，切分时以物理缝隙表达分治，
 *     缝隙逐级细分拉大；合并后缝隙顺滑闭合，元素贴合为整块。
 *   · 伴随式悬浮托盘 —— 拆分阶段完全隐形；合并阶段仅在当前两段正下方按需浮现，
 *     槽位数精确等于两段元素之和；回填后平滑淡出。
 *
 * 工程模型：
 *   · 全部步骤预生成为声明式帧（gaps / cardAt / tray / heads / bubble / fx），
 *     渲染即"从当前视觉状态 GSAP 补间到目标帧"，前进播放一次性特效，
 *     后退复用同一几何系统平滑回溯 —— 双向皆无生硬跳变。
 *   · 所有过渡时长经 currentTL.timeScale(speed) 与速率滑块实时联动。
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. 常量与全局状态
  // =========================================================================
  const N = 8;                          // 元素个数
  const CARD_W = 64, CARD_H = 84;       // 卡片尺寸
  const GAP_BASE = 12;                  // 初始紧挨排列间隙
  const GAP_FUSED = 6;                  // 合并缝合后的贴合间隙
  const GAP_SPLIT = { 1: 76, 2: 46, 3: 26 }; // 各层切分缝隙（逐级细分）
  const STAGE_PAD = 26;                 // 舞台左右留白
  const STAGE_W = 836, STAGE_H = 360;   // 舞台自然尺寸（缩放前）
  const ROW_Y = 84;                     // 主序列纵坐标
  const TRAY_Y = ROW_Y + CARD_H + 58;   // 托盘槽位纵坐标（正下方悬浮）
  const SLOT_GAP = 12;                  // 托盘槽位间距
  const TRAY_RECT_PAD_X = 14;           // 托盘矩形水平内边距
  const ARC_H = 46;                     // 抛物线滑落弧高
  const SUBS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']; // 重复元素下标

  const State = {
    values: [49, 38, 65, 97, 76, 13, 27, 49],
    cards: [],            // [{id, val, sub}]
    steps: [],            // 声明式帧时间线
    cur: 0,
    playing: false,
    speed: 1.0,
    currentTL: null,
    stepDoneCb: null,
    waitTimer: null,
    timers: [],           // 瞬态 class 清理定时器
    builtSlotCount: -1
  };

  const $ = (id) => document.getElementById(id);
  let elCards = [], elSlots = [];

  // =========================================================================
  // 2. 工具函数
  // =========================================================================
  function makeCards(values) {
    const groups = {};
    values.forEach((v, i) => { (groups[v] = groups[v] || []).push(i); });
    const cards = values.map((v, i) => ({ id: 'c' + i, val: v, sub: null }));
    Object.values(groups).forEach(idxs => {
      if (idxs.length > 1) idxs.forEach((ci, k) => { cards[ci].sub = SUBS[k] || String(k + 1); });
    });
    return cards;
  }

  // 带稳定性下标的 HTML 表示
  const fmt = (c) => `${c.val}${c.sub ? `<sub>${c.sub}</sub>` : ''}`;
  const fmtPlain = (c) => `${c.val}${c.sub || ''}`;

  function clearTimers() {
    State.timers.forEach(t => clearTimeout(t));
    State.timers = [];
  }

  // =========================================================================
  // 3. 时间线生成器（预生成全部声明式帧）
  // =========================================================================
  function generateSteps(cards) {
    const steps = [];
    const gaps = Array(N - 1).fill(GAP_BASE);   // 相邻位置间隙宽度
    const rowOf = Array.from({ length: N }, (_, i) => i); // rowOf[位置] = 卡片索引 / -1 空槽
    let cmp = 0, mv = 0;

    const snap = () => ({ gaps: [...gaps], cardAt: [...rowOf] });

    function push(f) {
      steps.push(Object.assign({
        tray: null, trayCards: null, heads: null, focus: null,
        pointers: false, bubble: null, dim: false, fx: [],
        stats: { cmp, mv }
      }, f, snap()));
    }

    // ---- 帧 0：初始单行序列 ------------------------------------------------
    push({
      kind: 'ready', led: 'stone', badge: '就绪',
      title: '初始单行序列',
      sub: `${N} 个元素紧挨排列 · 悬浮托盘隐形`,
      desc: `初始序列 [${cards.map(c => c.val).join(', ')}] 共 ${N} 个元素，紧挨排列在同一水平线上。悬浮托盘在切分阶段完全不渲染、不占位，注意力聚焦于单行裂变。`
    });

    // ---- 阶段一：自顶向下逐层切分与拉缝 --------------------------------------
    let segs = [[0, N - 1]], depth = 0;
    while (segs.some(([lo, hi]) => hi > lo)) {
      depth++;
      const next = [];
      for (const [lo, hi] of segs) {
        if (hi > lo) {
          const mid = (lo + hi) >> 1;
          const gapVal = GAP_SPLIT[Math.min(depth, 3)];
          gaps[mid] = gapVal;
          push({
            kind: 'split', led: 'amber', badge: '阶段 1 · 递归对半切分',
            title: `切分 A[${lo}..${hi}]`,
            sub: `第 ${depth} 层切分 · mid=${mid} · A[${lo}..${mid}] ∪ A[${mid + 1}..${hi}]`,
            desc: `一道切分虚线光标在区间正中 mid=${mid} 上方垂直落刀，左右两侧卡片以微阻尼弹性向两侧水平推开，物理缝隙拉大至 ${gapVal}px —— 缝隙逐级细分拉大，序列始终保持单行、不做树状展开。`,
            fx: [{ t: 'cut', mid, depth, lo, hi }]
          });
          next.push([lo, mid], [mid + 1, hi]);
        } else {
          next.push([lo, hi]);
        }
      }
      segs = next;
    }

    // ---- 分裂完成判定：单元素天然有序绿光 ------------------------------------
    push({
      kind: 'glow', led: 'blue', badge: '阶段 1 完成 · 单元素有序',
      title: '切分完毕 · 绿光判定',
      sub: `${N} 个独立单元素 · 天然有序`,
      desc: `整排卡片已全部切分为 ${N} 个独立单元素，所有边框亮起一次淡绿微光 —— 单元素序列天然有序，切分阶段圆满结束，随即平滑切入合并阶段。`,
      fx: [{ t: 'glow' }]
    });

    // ---- 阶段二：自底向上拉链归并（1+1→2、2+2→4、4+4→8） ----------------------
    function mergeSegment(lo, mid, hi) {
      const L = rowOf.slice(lo, mid + 1);
      const R = rowOf.slice(mid + 1, hi + 1);
      const lLen = mid - lo + 1, rLen = hi - mid;
      const total = hi - lo + 1;
      const levelTag = `${lLen}+${rLen}→${total}`;
      const trayInfo = { lo, mid, hi, slots: total, lLen, rLen, tag: levelTag };

      // (1) 就位与托盘浮现
      push({
        kind: 'trayIn', led: 'amber', badge: '阶段 2 · 归并排序',
        title: `归并 A[${lo}..${mid}] 与 A[${mid + 1}..${hi}]`,
        sub: `${levelTag} · 悬浮托盘浮现（${total} 槽）`,
        desc: `待合并的相邻两段亮起外边框高亮聚焦，正下方平滑浮现 ${total} 格虚线悬浮托盘（${lLen}+${rLen}=${total}，槽位数精确等于两段元素之和），排头兵指针即将登场，其余元素转入半透明待命。`,
        tray: trayInfo, trayCards: Array(total).fill(-1),
        focus: { lo, mid, hi }, heads: { L: lo, R: mid + 1 },
        pointers: true, dim: true,
        fx: [{ t: 'trayIn' }]
      });

      // (2) 双指针排头兵对决：谁小谁落位
      let i = 0, j = 0, s = 0;
      const trayCards = Array(total).fill(-1);
      while (i < lLen && j < rLen) {
        cmp++;
        const lc = cards[L[i]], rc = cards[R[j]];
        const leftWins = lc.val <= rc.val;   // 等值取左 → 稳定
        const tie = lc.val === rc.val;
        const win = leftWins ? L[i] : R[j];
        const fromPos = leftWins ? lo + i : mid + 1 + j;
        const axL = lo + i, axR = mid + 1 + j;
        if (leftWins) i++; else j++;
        s++; trayCards[s - 1] = win; mv++;
        rowOf[fromPos] = -1;                 // 主行该位变空槽
        push({
          kind: 'cmp', led: 'amber', badge: '阶段 2 · 排头兵对决',
          title: `谁小谁落位 · 托盘第 ${s}/${total} 槽`,
          sub: `比较 ${lc.val} 与 ${rc.val} · ${leftWins ? '左' : '右'}胜`,
          desc: `左右两段排头兵上方浮现指针光标，判定符号浮现：${fmt(lc)} ${leftWins ? '≤' : '&gt;'} ${fmt(rc)}，${leftWins ? '左' : '右'}侧排头胜出，沿抛物线平滑滑入托盘第 ${s} 槽；胜出方后续元素自动顶上，指针后移继续下一轮比对。${tie ? '（等值取左，稳定次序保持）' : ''}`,
          tray: trayInfo, trayCards: [...trayCards],
          focus: { lo, mid, hi },
          heads: { L: i < lLen ? lo + i : null, R: j < rLen ? mid + 1 + j : null },
          pointers: true, dim: true,
          bubble: {
            type: 'cmp', axL, axR, tone: leftWins ? 'l' : 'r',
            html: `${fmt(lc)} ${leftWins ? '≤' : '&gt;'} ${fmt(rc)} → ${leftWins ? '左' : '右'}胜`
          },
          fx: [{ t: 'cmp', win, fromPos, slot: s - 1 }]
        });
      }

      // (3) 某一段率先为空：余量直通
      if (i < lLen || j < rLen) {
        const side = i < lLen ? '左' : '右';
        const items = [];
        while (i < lLen) { trayCards[s] = L[i]; items.push({ card: L[i], pos: lo + i }); s++; i++; mv++; }
        while (j < rLen) { trayCards[s] = R[j]; items.push({ card: R[j], pos: mid + 1 + j }); s++; j++; mv++; }
        items.forEach(it => { rowOf[it.pos] = -1; });
        push({
          kind: 'sweep', led: 'amber', badge: '阶段 2 · 余量直通',
          title: `${side}段已空 · 余量直通落位`,
          sub: `${levelTag} · 剩余 ${items.length} 个元素免比较入盘`,
          desc: `${side}侧段已率先取空，另一段剩余 ${items.length} 个元素保持相对次序，平滑直通落入托盘末尾槽位，无需再比较。`,
          tray: trayInfo, trayCards: [...trayCards],
          focus: { lo, mid, hi }, heads: { L: null, R: null },
          pointers: false, dim: true,
          bubble: { type: 'note', tone: 'gray', html: `${side}段已空 → 余量直通` },
          fx: [{ t: 'sweep', items: items.map(it => it.card) }]
        });
      }

      // (4) 电梯回填与缝隙缝合
      for (let k = 0; k < total; k++) rowOf[lo + k] = trayCards[k];
      for (let g = lo; g < hi; g++) gaps[g] = GAP_FUSED;
      push({
        kind: 'seal', led: 'amber', badge: '阶段 2 · 电梯回填',
        title: `A[${lo}..${hi}] 回填缝合 · 已有序`,
        sub: `${levelTag} · 缝隙闭合 · 托盘淡出`,
        desc: `托盘内 ${total} 个有序元素作为整体像电梯一样垂直上移回推主序列，覆盖原区间位置；原本隔开两段的物理缝隙顺滑闭合，合并后的元素紧密贴合为一个整块，悬浮托盘随之平滑淡出。`,
        fx: [{ t: 'seal', lo, hi }]
      });
    }

    for (let w = 1; w < N; w *= 2) {
      for (let lo = 0; lo + w < N; lo += 2 * w) {
        mergeSegment(lo, lo + w - 1, Math.min(lo + 2 * w - 1, N - 1));
      }
    }

    // ---- 终章：全量波浪高亮 ---------------------------------------------------
    const sortedView = [...cards].sort((a, b) => a.val - b.val);
    push({
      kind: 'wave', led: 'emerald', badge: '排序完成',
      title: '🎉 全序列升序有序',
      sub: '4+4→8 · 最终回填 · 全量波浪高亮',
      desc: `最后一轮 4+4 回填完成，全序列间隙彻底消除，整条数组无缝贴合。自左向右执行一次全量波浪高亮，得到严格升序序列 [${sortedView.map(fmt).join(', ')}]。`,
      fx: [{ t: 'wave' }]
    });

    return steps;
  }

  // =========================================================================
  // 4. DOM 构建
  // =========================================================================
  function buildDOM() {
    const host = $('cards-host');
    host.innerHTML = '';
    elCards = State.cards.map(c => {
      const d = document.createElement('div');
      d.className = 'ms-card';
      d.innerHTML = `<span class="ms-val">${c.val}</span>` + (c.sub ? `<span class="ms-sub">${c.sub}</span>` : '');
      host.appendChild(d);
      return d;
    });

    const holes = $('holes-host');
    holes.innerHTML = '';
    for (let p = 0; p < N; p++) {
      const h = document.createElement('div');
      h.className = 'ms-hole';
      holes.appendChild(h);
    }

    $('tray-slots').innerHTML = '';
    elSlots = [];
    State.builtSlotCount = -1;
    $('fx-host').innerHTML = '';
    gsap.set('#bracket-l', { opacity: 0, y: ROW_Y - 6, width: 0, x: 0 });
    gsap.set('#bracket-r', { opacity: 0, y: ROW_Y - 6, width: 0, x: 0 });
    gsap.set('#cmp-bubble', { opacity: 0, xPercent: -50, scale: 1 });
    gsap.set('#ptr-l', { opacity: 0, x: 0 });
    gsap.set('#ptr-r', { opacity: 0, x: 0 });
    gsap.set('#tray-group', { opacity: 0, y: 0 });
  }

  function buildSlots(count) {
    if (State.builtSlotCount === count) return;
    const host = $('tray-slots');
    host.innerHTML = '';
    elSlots = [];
    for (let k = 0; k < count; k++) {
      const s = document.createElement('div');
      s.className = 'ms-slot';
      host.appendChild(s);
      elSlots.push(s);
    }
    State.builtSlotCount = count;
  }

  // =========================================================================
  // 5. 几何系统
  // =========================================================================
  function rowXs(gaps) {
    const xs = [];
    let x = STAGE_PAD;
    for (let p = 0; p < N; p++) {
      xs.push(x);
      x += CARD_W + (p < N - 1 ? gaps[p] : 0);
    }
    return xs;
  }

  // 托盘几何：在当前两段跨区正下方居中
  function trayGeom(f, xs) {
    const { lo, hi, slots } = f.tray;
    const spanL = xs[lo], spanR = xs[hi] + CARD_W;
    const center = (spanL + spanR) / 2;
    const trayW = slots * CARD_W + (slots - 1) * SLOT_GAP;
    const trayX = center - trayW / 2;
    const slotXs = Array.from({ length: slots }, (_, k) => trayX + k * (CARD_W + SLOT_GAP));
    return { center, trayW, trayX, slotXs };
  }

  // 卡片目标位置：主行位置 或 托盘槽位
  function cardTarget(f, ci, xs) {
    const pos = f.cardAt.indexOf(ci);
    if (pos >= 0) return { x: xs[pos], y: ROW_Y };
    const slot = f.trayCards ? f.trayCards.indexOf(ci) : -1;
    const g = trayGeom(f, xs);
    return { x: g.slotXs[slot], y: TRAY_Y };
  }

  // =========================================================================
  // 6. 声明式 chrome（孔位 / 聚焦框 / 指针 / 判定气泡 / 托盘 / 卡片状态类）
  // =========================================================================
  function setCardClass(el, cls) {
    el.className = 'ms-card' + (cls ? ' ' + cls : '');
  }

  function cardClasses(f) {
    const out = Array(N).fill('');
    if (f.focus) {
      const { lo, mid, hi } = f.focus;
      for (let p = 0; p < N; p++) {
        const ci = f.cardAt[p];
        if (ci < 0) continue;
        if (p < lo || p > hi) { out[ci] = 'is-dim-out'; continue; }
        if (f.pointers && f.heads) {
          if (p === f.heads.L) out[ci] = 'is-head-l';
          else if (p === f.heads.R) out[ci] = 'is-head-r';
          else out[ci] = 'is-dim-soft';
        } else {
          out[ci] = 'is-dim-soft';
        }
      }
    }
    return out;
  }

  function setBracket(tl, el, x, w, tag, opacity, at) {
    if (el.querySelector('.ms-bracket-tag')) el.querySelector('.ms-bracket-tag').textContent = tag;
    const vars = { x, width: w, opacity };
    if (tl) tl.to(el, { ...vars, duration: 0.3, ease: 'power2.inOut' }, at || 0);
    else gsap.set(el, vars);
  }

  function slotFill(k) {
    const s = elSlots[k];
    if (!s) return;
    s.classList.add('is-filled');
    gsap.fromTo(s, { backgroundColor: 'rgba(254, 243, 199, 0.95)' },
      { backgroundColor: 'rgba(255, 251, 235, 0.65)', duration: 0.55, ease: 'power1.out' });
  }

  function applyChrome(tl, f, xs, opts) {
    opts = opts || {};
    const fwd = opts.fwd !== false;

    // —— 已出列空槽 ——
    for (let p = 0; p < N; p++) {
      const vacant = f.cardAt[p] === -1;
      const hole = $('holes-host').children[p];
      if (tl) tl.to(hole, { x: xs[p], y: ROW_Y, opacity: vacant ? 1 : 0, duration: 0.35, ease: 'power1.inOut' }, 0);
      else gsap.set(hole, { x: xs[p], y: ROW_Y, opacity: vacant ? 1 : 0 });
    }

    // —— 段聚焦外边框 ——
    const bl = $('bracket-l'), br = $('bracket-r');
    if (f.focus) {
      const { lo, mid, hi } = f.focus;
      setBracket(tl, bl, xs[lo] - 8, xs[mid] + CARD_W - xs[lo] + 16, `A[${lo}..${mid}] · ${mid - lo + 1} 元素`, 1);
      setBracket(tl, br, xs[mid + 1] - 8, xs[hi] + CARD_W - xs[mid + 1] + 16, `A[${mid + 1}..${hi}] · ${hi - mid} 元素`, 1);
    } else {
      setBracket(tl, bl, 0, 0, '', 0);
      setBracket(tl, br, 0, 0, '', 0);
    }

    // —— 悬浮托盘几何 ——
    const group = $('tray-group');
    if (f.tray) {
      const g = trayGeom(f, xs);
      buildSlots(f.tray.slots);
      const rect = $('tray-rect'), label = $('tray-label');
      const rectSet = { x: g.trayX - TRAY_RECT_PAD_X, y: TRAY_Y - 14, width: g.trayW + 2 * TRAY_RECT_PAD_X, height: CARD_H + 28 };
      const labelSet = { xPercent: -50, x: g.center, y: TRAY_Y - 50 };
      label.textContent = `悬浮托盘 · ${f.tray.slots} 槽 · ${f.tray.tag}`;
      if (tl) { tl.set(rect, rectSet, 0); tl.set(label, labelSet, 0); }
      else { gsap.set(rect, rectSet); gsap.set(label, labelSet); }

      // 槽位定位与已填充态
      elSlots.forEach((s, k) => {
        if (tl) tl.set(s, { x: g.slotXs[k], y: TRAY_Y }, 0);
        else gsap.set(s, { x: g.slotXs[k], y: TRAY_Y });
        const filled = f.trayCards && f.trayCards[k] >= 0;
        const defer = tl && fwd && (f.kind === 'cmp' || f.kind === 'sweep') && filled;
        if (!defer) s.classList.toggle('is-filled', !!filled);
      });

      // 托盘可见性（trayIn 的弹现交给 fx；其余情况平滑恢复可见）
      if (tl) {
        if (!(f.kind === 'trayIn' && fwd)) tl.to(group, { opacity: 1, y: 0, duration: 0.25 }, 0);
      } else {
        gsap.set(group, { opacity: 1, y: 0 });
      }
    } else {
      const at = f.kind === 'seal' ? 0.45 : 0;
      if (tl) tl.to(group, { opacity: 0, duration: 0.32, ease: 'power1.in' }, at);
      else gsap.set(group, { opacity: 0 });
    }

    // —— 双指针排头光标 ——
    const pl = $('ptr-l'), pr = $('ptr-r');
    const show = f.pointers && f.heads;
    // 前进的对决步：指针后移安排在胜者落位之后（判 → 落 → 顶上）
    const ptrAt = (tl && fwd && f.kind === 'cmp') ? 1.15 : 0;
    const lVars = show && f.heads.L != null ? { x: xs[f.heads.L], opacity: 1 } : { opacity: 0 };
    const rVars = show && f.heads.R != null ? { x: xs[f.heads.R], opacity: 1 } : { opacity: 0 };
    if (tl) {
      tl.to(pl, { ...lVars, duration: 0.3, ease: 'power2.inOut' }, ptrAt);
      tl.to(pr, { ...rVars, duration: 0.3, ease: 'power2.inOut' }, ptrAt);
    } else {
      gsap.set(pl, lVars); gsap.set(pr, rVars);
    }

    // —— 排头对决判定气泡 ——
    const b = $('cmp-bubble');
    if (f.bubble) {
      let x;
      if (f.bubble.type === 'cmp') {
        x = (xs[f.bubble.axL] + CARD_W / 2 + xs[f.bubble.axR] + CARD_W / 2) / 2;
      } else if (f.focus) {
        x = (xs[f.focus.lo] + xs[f.focus.hi] + CARD_W) / 2;
      } else {
        x = STAGE_W / 2;
      }
      b.innerHTML = f.bubble.html;
      b.className = 'ms-bubble tone-' + f.bubble.tone;
      if (tl) {
        tl.set(b, { x, xPercent: -50, opacity: 1 }, 0);
        tl.fromTo(b, { scale: 0.7 }, { scale: 1, duration: 0.3, ease: 'back.out(2.2)' }, 0.05);
      } else {
        gsap.set(b, { x, xPercent: -50, opacity: 1, scale: 1 });
      }
    } else {
      if (tl) tl.to(b, { opacity: 0, duration: 0.2 }, 0);
      else gsap.set(b, { opacity: 0 });
    }
  }

  // =========================================================================
  // 7. 时间线构建（GSAP 编舞）
  // =========================================================================
  function buildTimeline(f, xs, dir) {
    const fwd = dir === 'fwd';
    const tl = gsap.timeline();

    const flyMap = {}, sweepList = [];
    (f.fx || []).forEach(fx => {
      if (fx.t === 'cmp') flyMap[fx.win] = fx;
      if (fx.t === 'sweep') fx.items.forEach(c => sweepList.push(c));
    });

    // —— chrome ——
    applyChrome(tl, f, xs, { fwd });

    // —— 卡片状态类 ——
    const classes = cardClasses(f);
    elCards.forEach((el, ci) => setCardClass(el, classes[ci]));

    // —— 卡片位置补间 ——
    elCards.forEach((el, ci) => {
      const tgt = cardTarget(f, ci, xs);

      if (fwd && flyMap[ci] != null) {
        // 抛物线滑落：判 → 落 → 顶上
        const x0 = parseFloat(gsap.getProperty(el, 'x')) || tgt.x;
        const y0 = parseFloat(gsap.getProperty(el, 'y')) || ROW_Y;
        const proxy = { t: 0 };
        tl.set(el, { zIndex: 9 }, 0.48);
        tl.to(proxy, {
          t: 1, duration: 0.62, ease: 'power1.inOut',
          onUpdate: () => {
            const t = proxy.t;
            gsap.set(el, {
              x: x0 + (tgt.x - x0) * t,
              y: (y0 + (TRAY_Y - y0) * t) - ARC_H * Math.sin(Math.PI * t),
              scale: 1 + 0.12 * Math.sin(Math.PI * t)
            });
          }
        }, 0.5);
        tl.set(el, { zIndex: 4, scale: 1 }, 1.14);
        tl.call(() => slotFill(flyMap[ci].slot), null, 1.1);

      } else if (fwd && sweepList.includes(ci)) {
        // 余量直通：保持次序平滑直落入盘
        const k = sweepList.indexOf(ci);
        const t0 = 0.45 + k * 0.12;
        tl.set(el, { zIndex: 9 }, t0);
        tl.to(el, { x: tgt.x, y: TRAY_Y, duration: 0.5, ease: 'power1.inOut' }, t0);
        tl.set(el, { zIndex: 4 }, t0 + 0.52);
        tl.call(() => slotFill(f.trayCards.indexOf(ci)), null, t0 + 0.48);

      } else if (f.kind === 'seal') {
        // 电梯回填：先垂直上移，再水平缝合归位
        tl.to(el, { y: tgt.y, duration: 0.55, ease: 'power2.inOut' }, 0);
        tl.to(el, { x: tgt.x, duration: 0.5, ease: 'power3.inOut' }, 0.5);

      } else if (f.kind === 'split' && fwd) {
        // 切分：虚线落刀后，微阻尼弹性向两侧推开
        tl.to(el, { x: tgt.x, duration: 0.55, ease: 'back.out(1.7)' }, 0.5);

      } else {
        tl.to(el, { x: tgt.x, y: tgt.y, duration: fwd ? 0.55 : 0.5, ease: 'power2.inOut' }, 0);
      }
    });

    // —— 一次性特效（仅前进播放） ——
    if (fwd) (f.fx || []).forEach(fx => {
      if (fx.t === 'cut') {
        const host = $('fx-host');
        const line = document.createElement('div');
        line.className = 'ms-cutline';
        line.innerHTML = `<span class="ms-cutline-tag">mid=${fx.mid} · 第${fx.depth}层落刀</span>`;
        host.appendChild(line);
        const gx = xs[fx.mid] + CARD_W + f.gaps[fx.mid] / 2;
        tl.fromTo(line,
          { xPercent: -50, x: gx, scaleY: 0, opacity: 1, transformOrigin: 'top center' },
          { scaleY: 1, duration: 0.38, ease: 'power3.out' }, 0);
        tl.to(line, { opacity: 0, duration: 0.3, ease: 'power1.in' }, 0.62);
        tl.call(() => line.remove(), null, 0.95);

      } else if (fx.t === 'glow') {
        tl.call(() => {
          elCards.forEach((el, i) => {
            el.style.animationDelay = (i * 0.045) + 's';
            el.classList.add('unit-glow');
            State.timers.push(setTimeout(() => {
              el.classList.remove('unit-glow');
              el.style.animationDelay = '';
            }, 1350 + i * 45));
          });
        }, null, 0.1);

      } else if (fx.t === 'trayIn') {
        const group = $('tray-group');
        tl.fromTo(group, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, 0.05);
        if (elSlots.length) {
          // 入场只动 opacity + scale，避免覆写槽位的布局坐标 x/y
          tl.fromTo(elSlots, { opacity: 0, scale: 0.82 }, { opacity: 1, scale: 1, duration: 0.32, stagger: 0.05, ease: 'back.out(1.8)', transformOrigin: '50% 50%' }, 0.2);
        }

      } else if (fx.t === 'seal') {
        for (let p = fx.lo; p <= fx.hi; p++) {
          const el = elCards[f.cardAt[p]];
          tl.call(() => {
            el.classList.add('seal-flash');
            State.timers.push(setTimeout(() => el.classList.remove('seal-flash'), 820));
          }, null, 1.0 + (p - fx.lo) * 0.03);
        }

      } else if (fx.t === 'wave') {
        elCards.forEach((el, i) => {
          tl.call(() => el.classList.add('is-sorted'), null, 0.1 + i * 0.09);
          tl.to(el, {
            keyframes: [
              { y: ROW_Y - 12, duration: 0.26, ease: 'power2.out' },
              { y: ROW_Y, duration: 0.42, ease: 'bounce.out' }
            ]
          }, 0.1 + i * 0.09);
        });
        tl.call(() => showBanner(), null, 0.1 + N * 0.09 + 0.75);
      }
    });

    return tl;
  }

  // =========================================================================
  // 8. 步骤执行与即时渲染
  // =========================================================================
  function finishCurrent() {
    if (State.currentTL) {
      State.stepDoneCb = null;
      State.currentTL.progress(1);   // 瞬时完成至帧末态，保证声明式一致
      State.currentTL = null;
    }
  }

  function runStep(idx, dir, onDone) {
    finishCurrent();
    clearTimers();
    State.cur = idx;
    const f = State.steps[idx];
    const xs = rowXs(f.gaps);
    updateTexts(f, idx);
    const tl = buildTimeline(f, xs, dir);
    State.currentTL = tl;
    tl.timeScale(State.speed);
    State.stepDoneCb = onDone || null;
    tl.eventCallback('onComplete', () => {
      State.currentTL = null;
      const cb = State.stepDoneCb;
      State.stepDoneCb = null;
      updateButtons();
      if (State.playing) {
        if (cb) cb();                                   // 正常：安排下一拍
        else State.waitTimer = setTimeout(tick, 60);    // 从暂停的单步恢复后继续
      } else if (cb) cb();
    });
    updateButtons();
  }

  function renderInstant(idx) {
    clearTimeout(State.waitTimer);
    finishCurrent();
    clearTimers();
    State.cur = idx;
    const f = State.steps[idx];
    const xs = rowXs(f.gaps);
    applyChrome(null, f, xs, { fwd: true });
    const classes = cardClasses(f);
    elCards.forEach((el, ci) => setCardClass(el, classes[ci]));
    elCards.forEach((el, ci) => {
      const t = cardTarget(f, ci, xs);
      gsap.set(el, { x: t.x, y: t.y, scale: 1, zIndex: 4 });
    });
    if (f.kind === 'wave') elCards.forEach(el => el.classList.add('is-sorted'));
    updateTexts(f, idx);
    if (idx === State.steps.length - 1) showBanner(); else hideBanner();
    updateButtons();
  }

  // =========================================================================
  // 9. 文本 / 徽章 / 进度 / 胜利横幅
  // =========================================================================
  function updateTexts(f, idx) {
    $('step-counter').textContent = `步骤 ${idx} / ${State.steps.length - 1}`;
    $('step-title').textContent = f.title;
    $('step-description').innerHTML = f.desc;
    $('phase-badge').textContent = f.badge;
    $('phase-led').className = 'pulse-led pulse-led-' + f.led;
    $('stat-cmp').textContent = f.stats.cmp;
    $('stat-mv').textContent = f.stats.mv;
    $('status-live-hint').textContent = f.sub;
    $('progress-bar-fill').style.width =
      (State.steps.length > 1 ? (idx / (State.steps.length - 1)) * 100 : 0) + '%';
  }

  function updateButtons() {
    $('btn-prev').disabled = State.cur <= 0;
    $('btn-next').disabled = State.cur >= State.steps.length - 1;
  }

  function updatePlayBtn() {
    $('play-icon').textContent = State.playing ? '⏸' : '▶';
    $('play-label').textContent = State.playing ? '暂停' : '播放';
  }

  function showBanner() {
    const last = State.steps[State.steps.length - 1];
    const hasDup = State.cards.some(c => c.sub);
    $('victory-summary').textContent =
      `共比较 ${last.stats.cmp} 次 · 入盘移动 ${last.stats.mv} 次 · 稳定排序${hasDup ? '：等值元素（带下标者）相对次序保持不变' : '：等值元素相对次序保持不变'}。`;
    const b = $('victory-banner');
    b.classList.remove('hidden');
    b.classList.add('flex');
  }

  function hideBanner() {
    const b = $('victory-banner');
    b.classList.add('hidden');
    b.classList.remove('flex');
  }

  // =========================================================================
  // 10. 播放引擎（播放 / 暂停 / 单步 / 速率联动）
  // =========================================================================
  function tick() {
    if (!State.playing) return;
    if (State.cur >= State.steps.length - 1) {
      State.playing = false;
      updatePlayBtn();
      return;
    }
    runStep(State.cur + 1, 'fwd', () => {
      if (!State.playing) return;
      State.waitTimer = setTimeout(tick, 420 / State.speed);
    });
  }

  function startPlay() {
    State.playing = true;
    updatePlayBtn();
    if (State.cur >= State.steps.length - 1) renderInstant(0);  // 重头再演
    if (State.currentTL && State.currentTL.paused()) {
      State.currentTL.resume();       // 恢复被暂停的步内动画
    } else if (!State.currentTL) {
      tick();
    }
  }

  function pausePlay() {
    State.playing = false;
    updatePlayBtn();
    clearTimeout(State.waitTimer);
    if (State.currentTL && State.currentTL.isActive()) State.currentTL.pause();
  }

  function stopPlay() {
    State.playing = false;
    updatePlayBtn();
    clearTimeout(State.waitTimer);
    finishCurrent();
  }

  // =========================================================================
  // 11. 舞台自适应缩放
  // =========================================================================
  function fitStage() {
    const outer = $('stage-outer');
    const s = Math.min(1, outer.clientWidth / STAGE_W);
    gsap.set($('stage-scaler'), { scale: s, transformOrigin: '50% 0%' });
    outer.style.height = Math.round(STAGE_H * s) + 'px';
  }

  // =========================================================================
  // 12. 演示重建与事件绑定
  // =========================================================================
  function newDemo(values) {
    State.values = values;
    State.cards = makeCards(values);
    State.steps = generateSteps(State.cards);
    buildDOM();
    renderInstant(0);
  }

  function bindEvents() {
    $('btn-play').addEventListener('click', () => State.playing ? pausePlay() : startPlay());
    $('btn-next').addEventListener('click', () => {
      stopPlay();
      if (State.cur < State.steps.length - 1) runStep(State.cur + 1, 'fwd', null);
    });
    $('btn-prev').addEventListener('click', () => {
      stopPlay();
      if (State.cur > 0) runStep(State.cur - 1, 'back', null);
    });
    $('btn-reset').addEventListener('click', () => { stopPlay(); renderInstant(0); });
    $('btn-replay').addEventListener('click', () => { stopPlay(); renderInstant(0); startPlay(); });
    $('btn-random').addEventListener('click', () => {
      stopPlay();
      const values = Array.from({ length: N }, () => 10 + Math.floor(Math.random() * 90));
      newDemo(values);
    });

    // 速度滑块：实时联动当前补间
    $('speed-slider').addEventListener('input', (e) => {
      State.speed = parseInt(e.target.value, 10) / 100;
      $('speed-readout').textContent = State.speed.toFixed(2).replace(/0$/, '') + 'x';
      if (State.currentTL) State.currentTL.timeScale(State.speed);
    });

    // 进度条点击跳转
    $('progress-bar-container').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const idx = Math.round(ratio * (State.steps.length - 1));
      stopPlay();
      renderInstant(idx);
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        State.playing ? pausePlay() : startPlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stopPlay();
        if (State.cur < State.steps.length - 1) runStep(State.cur + 1, 'fwd', null);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stopPlay();
        if (State.cur > 0) runStep(State.cur - 1, 'back', null);
      } else if (e.key === 'r' || e.key === 'R') {
        stopPlay();
        renderInstant(0);
      }
    });

    window.addEventListener('resize', fitStage);
  }

  // =========================================================================
  // 13. 启动
  // =========================================================================
  fitStage();
  bindEvents();
  newDemo(State.values);

})();
