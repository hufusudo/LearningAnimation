/**
 * 伙伴系统动态分区的界面控制器。
 * BuddyModel.buildRun 给出逐步快照，BuddyChoreo.scene 决定每个元素在这一刻的样子；
 * 这里只负责把结果写进 SVG 与 HTML、按钮与键盘，以及本模块自己的补间与计时器（切换或复位时清理）。
 */
(function () {
  'use strict';

  const M = window.BuddyModel;
  const C = window.BuddyChoreo;
  const hasGsap = typeof window.gsap !== 'undefined';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DWELL = 0.9;                       // 减少动效时，每一步跳到步末后停留的秒数（1× 速度）
  const { BAR, LIST, CARD } = C;
  const INK2 = '#5D655F';
  const BLUE = '#2563EB';
  const RED = '#B42318';

  const $ = (id) => document.getElementById(id);
  const els = {
    gStatic: $('g-static'),
    gCards: $('g-cards'),
    gBar: $('g-bar'),
    gLists: $('g-lists'),
    gTree: $('g-tree'),
    gFx: $('g-fx'),
    lamp: $('lamp'),
    stepCount: $('step-count'),
    phase: $('phase'),
    reqLine: $('req-line'),
    narr: $('narr'),
    phaseNav: $('phase-nav'),
    scrub: $('scrub'),
    scrubText: $('scrub-text'),
    replay: $('btn-replay'),
    prev: $('btn-prev'),
    next: $('btn-next'),
    play: $('btn-play'),
    playText: $('play-text'),
    reduce: $('reduce'),
    notice: $('notice')
  };
  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  const S = {
    run: null,
    i: 0,            // 已完成的步数；p > 0 时表示第 i 步正在进行
    p: 0,            // 当前步内进度 0–1
    playing: false,
    speed: 1,
    reduce: Boolean(reduceQuery && reduceQuery.matches)
  };

  let tween = null;        // GSAP 补间（一步一个），暂停时保留以便续播
  let dwellTimer = null;   // 减少动效下的停留计时器
  let cards = [];          // 进程卡的文字元素
  let rows = [];           // 链表行：高亮框与 NULL 字样
  let phaseBtns = [];

  // 按键保存元素：每帧只更新本帧用到的元素，其余隐藏
  const pools = {
    bar: new Map(), node: new Map(), arrow: new Map(), edge: new Map(), tree: new Map(),
    ring: new Map(), flight: new Map(), tag: new Map(), xor: new Map()
  };

  // ---------- 工具 ----------

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmt = (v) => String(Math.round(v * 1000) / 1000);
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const setAttr = (el, name, v) => {
    const s = typeof v === 'number' ? fmt(v) : String(v);
    if (el.getAttribute(name) !== s) el.setAttribute(name, s);
  };
  const applyText = (el, tv) => {
    setText(el, tv.text);
    el.style.opacity = fmt(tv.alpha);
  };

  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(el);
    return el;
  }

  // 取得（或创建）按键对应的元素，并标记为本帧使用
  function pooled(name, layer, key, make) {
    const pool = pools[name];
    let el = pool.get(key);
    if (!el) {
      el = make(layer);
      pool.set(key, el);
    }
    el.hit = true;
    el.g.style.display = '';
    return el;
  }

  // 本帧没用到的元素隐藏；hit 标记在每帧结束时清零
  function sweep() {
    Object.keys(pools).forEach((name) => {
      pools[name].forEach((el) => {
        if (el.hit) {
          el.hit = false;
        } else {
          el.g.style.display = 'none';
        }
      });
    });
  }

  function rectTo(el, r, opacity) {
    setAttr(el, 'x', r.x);
    setAttr(el, 'y', r.y);
    setAttr(el, 'width', r.w);
    setAttr(el, 'height', r.h);
    if (opacity !== undefined) setAttr(el, 'opacity', opacity);
  }

  function labelTo(el, label) {
    setText(el, label.text);
    setAttr(el, 'x', label.x);
    setAttr(el, 'y', label.y);
    setAttr(el, 'fill', label.fill);
    setAttr(el, 'opacity', label.alpha);
  }

  // ---------- 舞台：静态部分（刻度、链表行、标题、进程卡） ----------

  function buildStatic() {
    const total = S.run.total;
    const g = els.gStatic;

    svgEl('text', { class: 'axis-title', x: BAR.x, y: 232 }, g).textContent = `物理内存 · ${total} KB（按地址）`;
    [0, 128, 256, 512, 768, 1024].forEach((addr) => {
      const anchor = addr === 0 ? 'start' : addr === total ? 'end' : 'middle';
      svgEl('text', { class: 'ruler', x: C.xOf(addr, total), y: 214, 'text-anchor': anchor }, g).textContent = `${addr}K`;
    });
    svgEl('text', { class: 'list-head', x: LIST.x, y: LIST.headY }, g).textContent = '空闲伙伴链表（按阶）';
    svgEl('text', { class: 'list-head', x: 600, y: C.TREE_HEAD_Y }, g).textContent = '伙伴二叉树（分裂层次）';

    rows = [];
    for (let i = 0; i < 5; i++) {
      const size = total >> i;
      const y = LIST.top + i * LIST.pitch;
      svgEl('rect', { class: 'row-bg', x: LIST.x, y, width: LIST.w, height: LIST.h, rx: 8 }, g);
      const hi = svgEl('rect', { class: 'row-hi', x: LIST.x, y, width: LIST.w, height: LIST.h, rx: 8, opacity: 0, stroke: BLUE }, g);
      svgEl('text', { class: 'row-size', x: LIST.x + 12, y: y + LIST.h / 2 + 4 }, g).textContent = `${size}K`;
      svgEl('text', { class: 'row-pow', x: LIST.x + 74, y: y + LIST.h / 2 + 4 }, g).textContent = `2^${Math.round(Math.log2(size))}`;
      const nul = svgEl('text', { class: 'row-null', x: LIST.x0, y: y + LIST.h / 2 + 4 }, g);
      nul.textContent = 'NULL（空链）';
      rows.push({ hi, nul });
    }
  }

  function buildCards() {
    const seen = [];
    S.run.ops.forEach((o) => { if (o.op === 'alloc' && !seen.includes(o.pid)) seen.push(o.pid); });
    cards = seen.slice(0, CARD.xs.length).map((pid, idx) => {
      const x = CARD.xs[idx];
      const req = S.run.ops.find((o) => o.op === 'alloc' && o.pid === pid).size;
      const g = svgEl('g', { class: 'card' }, els.gCards);
      svgEl('rect', { class: 'card-body', x, y: CARD.y, width: CARD.w, height: CARD.h, rx: 12 }, g);
      svgEl('rect', { class: 'card-stripe', x: x + 1, y: CARD.y + 12, width: 5, height: CARD.h - 24, rx: 2.5, fill: C.pidColor(pid).deep }, g);
      svgEl('text', { class: 'card-title', x: x + 18, y: CARD.y + 24 }, g).textContent = `${pid} 申请 ${req}K`;
      const sub = svgEl('text', { class: 'card-sub', x: x + 18, y: CARD.y + 44 }, g);
      const extra = svgEl('text', { class: 'card-extra', x: x + 18, y: CARD.y + 62 }, g);
      return { pid, sub, extra };
    });
  }

  function buildPhaseNav() {
    const run = S.run;
    phaseBtns = run.ops.map((o, j) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn';
      b.textContent = `${o.op === 'alloc' ? '分配' : '释放'} ${o.pid}`;
      b.addEventListener('click', () => onPhase(j));
      return b;
    });
    els.phaseNav.replaceChildren(...phaseBtns);
  }

  // ---------- 舞台：动态元素 ----------

  function makeBlock(layer) {
    const g = svgEl('g', { class: 'blk' }, layer);
    const base = svgEl('rect', { class: 'blk-base', rx: 6 }, g);
    const used = svgEl('rect', { class: 'blk-used' }, g);
    const frag = svgEl('rect', { class: 'blk-frag', fill: 'url(#frag-hatch)' }, g);
    const label = svgEl('text', { class: 'blk-label', 'text-anchor': 'middle' }, g);
    const fragLabel = svgEl('text', { class: 'blk-frag-label', 'text-anchor': 'middle' }, g);
    return { g, base, used, frag, label, fragLabel };
  }

  function paintBlock(el, it) {
    setAttr(el.g, 'opacity', it.alpha);
    rectTo(el.base, it);
    setAttr(el.base, 'fill', it.fill);
    setAttr(el.base, 'stroke', it.stroke);
    setAttr(el.base, 'stroke-dasharray', it.dash ? '5 4' : 'none');
    if (it.used) {
      rectTo(el.used, { ...it.used, y: it.y, h: it.h }, it.used.alpha);
      setAttr(el.used, 'fill', it.used.fill);
    } else {
      setAttr(el.used, 'opacity', 0);
    }
    if (it.frag) {
      rectTo(el.frag, { x: it.frag.x, y: it.y, w: it.frag.w, h: it.h }, it.frag.alpha);
    } else {
      setAttr(el.frag, 'opacity', 0);
    }
    labelTo(el.label, it.label);
    if (it.fragLabel) {
      labelTo(el.fragLabel, { ...it.fragLabel, fill: INK2 });
    } else {
      setAttr(el.fragLabel, 'opacity', 0);
    }
  }

  function makeNode(layer) {
    const g = svgEl('g', { class: 'node' }, layer);
    const rect = svgEl('rect', { class: 'node-rect', rx: 6, fill: '#FFFFFF', stroke: '#8A9089' }, g);
    const text = svgEl('text', { class: 'node-text', 'text-anchor': 'middle' }, g);
    return { g, rect, text };
  }

  function paintNode(el, nd) {
    setAttr(el.g, 'opacity', nd.alpha);
    rectTo(el.rect, nd);
    setText(el.text, nd.label);
    setAttr(el.text, 'x', nd.x + nd.w / 2);
    setAttr(el.text, 'y', nd.y + nd.h / 2 + 4);
  }

  function makeLine(layer) {
    const g = svgEl('g', { class: 'arrow' }, layer);
    const line = svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 0 }, g);
    return { g, line };
  }

  function makeEdge(layer) {
    const g = svgEl('g', { class: 'tree-edge' }, layer);
    const line = svgEl('line', {}, g);
    return { g, line };
  }

  function paintEdge(el, e) {
    setAttr(el.g, 'opacity', e.alpha);
    setAttr(el.line, 'x1', e.x1);
    setAttr(el.line, 'y1', e.y1);
    setAttr(el.line, 'x2', e.x2);
    setAttr(el.line, 'y2', e.y2);
  }

  function makeTreeNode(layer) {
    const g = svgEl('g', { class: 'tree-node' }, layer);
    const layersEl = [0, 1].map(() => {
      const rect = svgEl('rect', { class: 'tree-rect', rx: 6 }, g);
      const text = svgEl('text', { class: 'tree-text', 'text-anchor': 'middle' }, g);
      return { rect, text };
    });
    return { g, layersEl };
  }

  function paintTreeNode(el, n) {
    el.layersEl.forEach((ly, k) => {
      const L = n.layers[k];
      if (!L) {
        setAttr(ly.rect, 'opacity', 0);
        setAttr(ly.text, 'opacity', 0);
        return;
      }
      rectTo(ly.rect, n, L.alpha);
      setAttr(ly.rect, 'fill', L.fill);
      setAttr(ly.rect, 'stroke', L.stroke);
      setAttr(ly.rect, 'stroke-dasharray', L.dash ? '4 3' : 'none');
      setText(ly.text, n.label);
      setAttr(ly.text, 'x', n.x + n.w / 2);
      setAttr(ly.text, 'y', n.y + n.h / 2 + 4);
      setAttr(ly.text, 'fill', L.text);
      setAttr(ly.text, 'opacity', L.alpha);
    });
  }

  function makeRing(layer) {
    const rect = svgEl('rect', { class: 'ring', rx: 10, fill: 'none', 'stroke-width': 2 }, layer);
    return { g: rect };
  }

  function paintRing(el, r) {
    rectTo(el.g, r, r.alpha);
    setAttr(el.g, 'stroke', r.tone === 'warn' ? RED : BLUE);
  }

  function makeFlight(layer) {
    const g = svgEl('g', { class: 'flight' }, layer);
    const rect = svgEl('rect', { rx: 8, 'stroke-width': 1.4 }, g);
    const text = svgEl('text', { class: 'flight-text', 'text-anchor': 'middle' }, g);
    return { g, rect, text };
  }

  function paintFlight(el, f) {
    setAttr(el.g, 'opacity', f.alpha);
    rectTo(el.rect, f);
    const isProc = f.tone === 'proc';
    const pid = f.text.split(' ')[0];
    const pc = isProc ? C.pidColor(pid) : null;
    setAttr(el.rect, 'fill', isProc ? pc.soft : '#FFFFFF');
    setAttr(el.rect, 'stroke', isProc ? pc.deep : BLUE);
    setText(el.text, f.text);
    setAttr(el.text, 'x', f.x + f.w / 2);
    setAttr(el.text, 'y', f.y + f.h / 2 + 4);
    setAttr(el.text, 'fill', isProc ? pc.deep : '#1D4ED8');
  }

  function makeTag(layer) {
    const g = svgEl('g', { class: 'tag' }, layer);
    const rect = svgEl('rect', { class: 'tag-bg', rx: 8 }, g);
    const text = svgEl('text', { class: 'tag-text', 'text-anchor': 'middle' }, g);
    return { g, rect, text };
  }

  function paintTag(el, t, cls) {
    setAttr(el.g, 'opacity', t.alpha);
    setAttr(el.g, 'class', `tag ${cls}`);
    rectTo(el.rect, t);
    setText(el.text, t.text);
    setAttr(el.text, 'x', t.tx);
    setAttr(el.text, 'y', t.ty);
  }

  // ---------- 每一帧：把 scene 写进舞台 ----------

  function paint(sc) {
    sc.cards.forEach((c, k) => {
      const el = cards[k];
      if (!el) return;
      applyText(el.sub, c.sub);
      applyText(el.extra, c.extra);
    });

    sc.bar.forEach((it) => paintBlock(pooled('bar', els.gBar, it.key, makeBlock), it));

    sc.lists.forEach((row, k) => {
      setAttr(rows[k].hi, 'opacity', row.highlight);
      setAttr(rows[k].nul, 'opacity', row.nullAlpha);
      row.nodes.forEach((nd) => paintNode(pooled('node', els.gLists, nd.key, makeNode), nd));
      row.arrows.forEach((a, j) => {
        const el = pooled('arrow', els.gLists, `a:${row.size}:${j}`, makeLine);
        setAttr(el.g, 'opacity', a.alpha);
        setAttr(el.line, 'x1', a.x1);
        setAttr(el.line, 'y1', row.mid);
        setAttr(el.line, 'x2', a.x2);
        setAttr(el.line, 'y2', row.mid);
      });
    });

    sc.tree.edges.forEach((e) => paintEdge(pooled('edge', els.gTree, e.key, makeEdge), e));
    sc.tree.nodes.forEach((n) => paintTreeNode(pooled('tree', els.gTree, n.key, makeTreeNode), n));

    sc.rings.forEach((r) => paintRing(pooled('ring', els.gFx, r.key, makeRing), r));
    sc.flights.forEach((f) => paintFlight(pooled('flight', els.gFx, f.key, makeFlight), f));
    sc.tags.forEach((t) => paintTag(pooled('tag', els.gFx, t.key, makeTag), t, `tone-${t.tone}`));
    sc.xor.forEach((x) => paintTag(pooled('xor', els.gFx, x.key, makeTag), x, 'tone-note tag-formula'));

    sweep();
  }

  // ---------- 文字与控件 ----------

  function paintTexts(sc) {
    applyText(els.stepCount, sc.count);
    applyText(els.phase, sc.phase);
    applyText(els.reqLine, sc.req);
    applyText(els.narr, sc.caption);
    setText(els.scrubText, sc.count.text);
  }

  // 当前所在的操作：最后一个起点不晚于当前步的操作
  function currentOp() {
    const starts = S.run.opStart;
    let j = 0;
    starts.forEach((s, k) => { if (s <= S.i) j = k; });
    return j;
  }

  function paintControls() {
    const N = S.run.N;
    const atStart = S.i === 0 && S.p === 0;
    els.prev.disabled = N === 0 || atStart;
    els.next.disabled = N === 0 || S.i >= N;
    els.play.disabled = N === 0 || (!hasGsap && !S.reduce);
    setText(els.playText, S.playing ? '❚❚ 暂停' : '▶ 播放');
    els.lamp.classList.toggle('is-running', S.playing);
    els.reduce.checked = S.reduce;
    document.body.classList.toggle('is-reduced', S.reduce);
    els.notice.hidden = hasGsap;
    if (!hasGsap) {
      setText(els.notice, S.reduce
        ? '未能加载动画引擎（GSAP）。减少动效下仍可自动播放，每步直接跳转。'
        : '未能加载动画引擎（GSAP），播放已停用。可开启「减少动效」后自动播放，或用单步浏览。');
    }
    const op = currentOp();
    phaseBtns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === op)));
    document.querySelectorAll('[data-speed]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === S.speed));
    });
    els.scrub.max = String(N);
    if (document.activeElement !== els.scrub) els.scrub.value = String(S.i);
  }

  function render() {
    if (!S.run) return;
    const view = M.sampleAt(S.run, S.i, S.p);
    const sc = C.scene(view, S.run);
    paint(sc);
    paintTexts(sc);
    paintControls();
  }

  // ---------- 推演与导航 ----------

  function killTween() {
    if (tween) {
      tween.kill();
      tween = null;
    }
  }

  function clearDwell() {
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
  }

  // 跳到第 i 步的第 p 进度并停止播放；画面由 render 按这两个数重算
  function goTo(i, p) {
    killTween();
    clearDwell();
    S.i = clamp(Math.floor(Number(i)) || 0, 0, S.run.N);
    S.p = p;
    render();
  }

  function pause() {
    S.playing = false;
    if (tween) {
      tween.pause();
    } else if (dwellTimer) {
      // 减少动效的停留中暂停：视为本步已做完，下次从下一步开始
      clearDwell();
      S.i += 1;
      S.p = 0;
    }
    render();
  }

  function play() {
    if (!S.run || S.run.N === 0 || (!hasGsap && !S.reduce)) return;
    if (S.i >= S.run.N) goTo(0, 0);
    S.playing = true;
    if (tween) tween.play();
    else runLoop();
    render();
  }

  function togglePlay() {
    if (S.playing) pause();
    else play();
  }

  function runLoop() {
    if (!S.playing) return;
    if (S.i >= S.run.N) {
      S.playing = false;
      render();
      return;
    }
    animateStep();
  }

  // 播放第 S.i 步：GSAP 补间推进步内进度；减少动效则直接跳到步末并停留
  function animateStep() {
    const i = S.i;
    const step = S.run.steps[i];
    if (S.reduce || !hasGsap) {
      S.p = 1;
      render();
      dwellTimer = setTimeout(() => {
        dwellTimer = null;
        S.i = i + 1;
        S.p = 0;
        render();
        runLoop();
      }, (DWELL * 1000) / S.speed);
      return;
    }
    const obj = { p: S.p };
    tween = gsap.to(obj, {
      p: 1,
      duration: step.dur * (1 - S.p),
      ease: 'none',
      onUpdate: () => {
        S.p = obj.p;
        render();
      },
      onComplete: () => {
        tween = null;
        S.i = i + 1;
        S.p = 0;
        render();
        runLoop();
      }
    });
    tween.timeScale(S.speed);
  }

  // 单步：播放下一步的动画后停住；若一步正在进行，则直接做完
  function stepNext() {
    if (!S.run || S.i >= S.run.N) return;
    const N = S.run.N;
    S.playing = false;
    if (tween) {
      // GSAP 正在播放这一步：直接做完
      killTween();
      S.i += 1;
      S.p = 0;
      render();
      return;
    }
    if (dwellTimer) {
      // 减少动效的停留中，这一步的终态已经显示：直接进入下一步的终态
      clearDwell();
      S.i = Math.min(N, S.i + 1);
    }
    if (S.reduce || !hasGsap) {
      S.i = Math.min(N, S.i + 1);
      S.p = 0;
      render();
      return;
    }
    animateStep();
  }

  // 上一步：正在进行的一步回到开头；否则回到上一步的开头
  function stepPrev() {
    if (!S.run) return;
    const mid = S.p > 0;
    S.playing = false;
    goTo(mid ? S.i : Math.max(0, S.i - 1), 0);
  }

  function replay() {
    S.playing = false;
    goTo(0, 0);
  }

  function onPhase(j) {
    S.playing = false;
    goTo(S.run.opStart[j], 0);
  }

  function setSpeed(v) {
    S.speed = v;
    if (tween) tween.timeScale(v);
    render();
  }

  function setReduce(v) {
    S.reduce = Boolean(v);
    killTween();
    clearDwell();
    if (S.playing) runLoop();
    render();
  }

  function onKey(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (el && el.closest('input, select, textarea, button, a')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowRight') { e.preventDefault(); stepNext(); }
    if (e.code === 'ArrowLeft') { e.preventDefault(); stepPrev(); }
    if (e.code === 'Home') { e.preventDefault(); replay(); }
  }

  function bindEvents() {
    els.play.addEventListener('click', togglePlay);
    els.next.addEventListener('click', stepNext);
    els.prev.addEventListener('click', stepPrev);
    els.replay.addEventListener('click', replay);
    els.scrub.addEventListener('input', () => {
      S.playing = false;
      goTo(Number(els.scrub.value), 0);
    });
    document.querySelectorAll('[data-speed]').forEach((b) => {
      b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
    });
    els.reduce.addEventListener('change', () => setReduce(els.reduce.checked));
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && S.playing) pause();
    });
    if (reduceQuery && reduceQuery.addEventListener) {
      reduceQuery.addEventListener('change', (e) => setReduce(e.matches));
    }
  }

  function init() {
    S.run = M.buildRun();
    buildStatic();
    buildCards();
    buildPhaseNav();
    bindEvents();
    goTo(0, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
