/**
 * 时钟页面置换算法的界面控制器。
 * 画面只由 ClockModel.sampleAt(run, 步号, 步内进度) 决定，与播放历史无关；
 * 这里负责按钮、键盘、地址栏，以及本模块自己的补间与计时器（切换或复位时清理）。
 */
(function () {
  'use strict';

  const M = window.ClockModel;
  const hasGsap = typeof window.gsap !== 'undefined';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DWELL = 0.9;                       // 减少动效时，每一步跳到步末后停留的秒数（1× 速度）
  const HUB = { x: 360, y: 230 };          // 圆盘中心，与 index.html 中的指针位置一致
  const CARD = { w: 156, h: 94 };
  const CARD_POS = [
    { x: 282, y: 33 },    // F0：顶部（12 点）
    { x: 432, y: 183 },   // F1：右侧（3 点）
    { x: 282, y: 333 },   // F2：底部（6 点）
    { x: 132, y: 183 }    // F3：左侧（9 点）
  ];
  const TAG_AT = [
    { x: 270, y: 80, anchor: 'end' },      // F0 的浮标在左侧
    { x: 510, y: 166, anchor: 'middle' },  // F1 在上方
    { x: 450, y: 380, anchor: 'start' },   // F2 在右侧
    { x: 210, y: 166, anchor: 'middle' }   // F3 在上方
  ];
  const ROUND_LABEL = {
    enhanced: ['找 (0,0)', '找 (0,1) 并清 R', '找 (0,0)', '找 (0,1)'],
    basic: ['找 R=0', '第二圈必中']
  };
  const LEGEND = {
    enhanced: [['(0,0)', '未访问·未修改'], ['(0,1)', '未访问·已修改'], ['(1,0)', '已访问·未修改'], ['(1,1)', '已访问·已修改']],
    basic: [['R=0', '可被淘汰'], ['R=1', '置 0 后前移']]
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    scenario: $('scenario'),
    track: $('track'),
    seqCount: $('seq-count'),
    appendForm: $('append'),
    appendPage: $('append-page'),
    appendOp: $('append-op'),
    lamp: $('lamp'),
    stepCount: $('step-count'),
    phase: $('phase'),
    reqLine: $('req-line'),
    legend: $('legend'),
    narr: $('narr'),
    rounds: $('rounds'),
    rule: $('rule'),
    stTotal: $('st-total'),
    stHits: $('st-hits'),
    stFaults: $('st-faults'),
    stWrites: $('st-writes'),
    scrub: $('scrub'),
    scrubText: $('scrub-text'),
    replay: $('btn-replay'),
    prev: $('btn-prev'),
    next: $('btn-next'),
    play: $('btn-play'),
    playText: $('play-text'),
    reduce: $('reduce'),
    notice: $('notice'),
    hand: $('hand')
  };
  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  const S = {
    scenario: 1,
    mode: 'enhanced',
    requests: [],     // 当前访问序列（可追加）
    custom: false,    // 是否已偏离预设序列（用于地址栏 q 参数）
    run: null,
    i: 0,             // 已完成的步数；p > 0 时表示第 i 步正在进行
    p: 0,             // 当前步内进度 0–1
    playing: false,
    speed: 1,
    reduce: Boolean(reduceQuery && reduceQuery.matches)
  };

  let tween = null;       // GSAP 补间（一步一个），暂停时保留以便续播
  let dwellTimer = null;  // 减少动效下的停留计时器
  let cards = [];
  let tags = [];
  let tokens = [];
  let roundEls = [];
  let lastReq = -1;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const setAttr = (el, name, v) => { if (el.getAttribute(name) !== v) el.setAttribute(name, v); };
  const presetOf = (id) => M.SCENARIOS.find((s) => s.id === id) || M.SCENARIOS[0];
  const reqLabel = (r) => (S.mode === 'enhanced' ? `P${r.page}（${r.op === 'W' ? '写' : '读'}）` : `P${r.page}`);

  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }

  // 按中文字符约 13px、其余约 7.4px 估算浮标宽度
  function textWidth(text) {
    let w = 20;
    for (const ch of text) w += /[一-鿿]/.test(ch) ? 13 : 7.4;
    return Math.ceil(w);
  }

  // 以 (cx, cy) 为中心缩放；s = 1 时清除变换
  function setScale(el, cx, cy, s) {
    if (s === 1) {
      if (el.hasAttribute('transform')) el.removeAttribute('transform');
      return;
    }
    setAttr(el, 'transform', `translate(${cx} ${cy}) scale(${s.toFixed(3)}) translate(${-cx} ${-cy})`);
  }

  // ---------- 舞台：构建与绘制 ----------

  function makeChip(parent, kind) {
    const g = svgEl('g', { class: `chip chip-${kind}` }, parent);
    svgEl('rect', { class: 'chip-rect', width: 56, height: 20, rx: 7 }, g);
    svgEl('text', { class: 'chip-text', 'text-anchor': 'middle' }, g);
    return g;
  }

  function buildDial() {
    const host = $('cards');
    cards = CARD_POS.map((pos, f) => {
      const g = svgEl('g', { class: 'card' }, host);
      const ring = svgEl('rect', { class: 'card-ring', x: pos.x - 6, y: pos.y - 6, width: CARD.w + 12, height: CARD.h + 12, rx: 19, opacity: 0 }, g);
      const body = svgEl('rect', { class: 'card-body', x: pos.x, y: pos.y, width: CARD.w, height: CARD.h, rx: 14 }, g);
      svgEl('text', { class: 'card-f', x: pos.x + 14, y: pos.y + 22 }, g).textContent = `F${f}`;
      const cls = svgEl('text', { class: 'card-cls', x: pos.x + CARD.w - 14, y: pos.y + 22, 'text-anchor': 'end' }, g);
      const page = svgEl('text', { class: 'card-page', x: pos.x + CARD.w / 2, y: pos.y + 58, 'text-anchor': 'middle' }, g);
      const chipR = makeChip(g, 'r');
      const chipM = makeChip(g, 'm');
      return { f, pos, g, ring, body, cls, page, chipR, chipM };
    });
    const tagHost = $('tags');
    tags = [0, 1].map(() => {
      const g = svgEl('g', { class: 'tag', opacity: 0 }, tagHost);
      const rect = svgEl('rect', { class: 'tag-bg', height: 26, rx: 8 }, g);
      const text = svgEl('text', { class: 'tag-text' }, g);
      return { g, rect, text };
    });
  }

  function placeChip(g, kind, x, y, label, on, s) {
    const rect = g.firstChild;
    const text = g.lastChild;
    setAttr(g, 'class', `chip chip-${kind} ${on ? 'is-on' : 'is-off'}`);
    setAttr(rect, 'x', x);
    setAttr(rect, 'y', y);
    setAttr(text, 'x', x + 28);
    setAttr(text, 'y', y + 10);
    setText(text, label);
    setScale(g, x + 28, y + 10, s);
  }

  function drawCard(card, view) {
    const f = card.f;
    const c = view.snap.frames[f];
    const enhanced = S.mode === 'enhanced';
    const ringAlpha = view.rings.reduce((a, r) => (r.frame === f ? Math.max(a, r.alpha) : a), 0);
    setAttr(card.ring, 'opacity', ringAlpha.toFixed(3));
    setAttr(card.body, 'class', view.snap.victim === f ? 'card-body is-victim' : 'card-body');
    setText(card.page, `P${c.page}`);
    setText(card.cls, enhanced ? `(${c.r},${c.m})` : '');

    const pulse = view.pulse && view.pulse.frame === f ? view.pulse : null;
    setScale(card.g, card.pos.x + CARD.w / 2, card.pos.y + CARD.h / 2,
      pulse && pulse.what === 'page' ? 1 + 0.06 * pulse.s : 1);

    const y = card.pos.y + CARD.h - 30;
    const rS = pulse && pulse.what === 'R' ? 1 + 0.16 * pulse.s : 1;
    const mS = pulse && pulse.what === 'M' ? 1 + 0.16 * pulse.s : 1;
    const rX = enhanced ? card.pos.x + 14 : card.pos.x + (CARD.w - 56) / 2;
    placeChip(card.chipR, 'r', rX, y, `R ${c.r}`, c.r === 1, rS);
    card.chipM.style.display = enhanced ? '' : 'none';
    if (enhanced) placeChip(card.chipM, 'm', card.pos.x + CARD.w - 70, y, `M ${c.m}`, c.m === 1, mS);
  }

  function drawTags(view) {
    tags.forEach((t, k) => {
      const d = view.tags[k];
      if (!d || d.alpha <= 0.001) {
        if (t.g.style.display !== 'none') t.g.style.display = 'none';
        return;
      }
      t.g.style.display = '';
      setAttr(t.g, 'class', `tag tone-${d.tone}`);
      setAttr(t.g, 'opacity', d.alpha.toFixed(3));
      setText(t.text, d.text);
      const at = TAG_AT[d.frame];
      const w = textWidth(d.text);
      const x = at.anchor === 'end' ? at.x - w : at.anchor === 'middle' ? at.x - w / 2 : at.x;
      setAttr(t.rect, 'x', x);
      setAttr(t.rect, 'y', at.y - 13);
      setAttr(t.rect, 'width', w);
      setAttr(t.text, 'x', x + 10);
      setAttr(t.text, 'y', at.y);
    });
  }

  function drawHand(deg) {
    setAttr(els.hand, 'transform', `rotate(${deg.toFixed(2)} ${HUB.x} ${HUB.y})`);
  }

  // ---------- 侧栏与访问序列 ----------

  function buildLegend() {
    els.legend.replaceChildren(...LEGEND[S.mode].map(([k, v]) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = k;
      li.append(b, ` ${v}`);
      return li;
    }));
  }

  function buildRounds() {
    els.rounds.replaceChildren(...ROUND_LABEL[S.mode].map((label, idx) => {
      const li = document.createElement('li');
      li.className = 'round';
      const no = document.createElement('span');
      no.className = 'round-no';
      no.textContent = S.mode === 'enhanced' ? `第 ${idx + 1} 轮` : `第 ${idx + 1} 圈`;
      const doing = document.createElement('span');
      doing.className = 'round-do';
      doing.textContent = label;
      li.append(no, doing);
      return li;
    }));
    roundEls = Array.from(els.rounds.children);
  }

  function buildTrack() {
    tokens = S.run.requests.map((r) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tok';
      const top = document.createElement('span');
      top.className = 'tok-top';
      const pg = document.createElement('b');
      pg.textContent = `P${r.page}`;
      const op = document.createElement('span');
      op.className = 'tok-op';
      op.textContent = S.mode === 'enhanced' ? (r.op === 'W' ? '写' : '读') : '访问';
      top.append(pg, op);
      const res = document.createElement('span');
      res.className = 'tok-res';
      const sub = document.createElement('span');
      sub.className = 'tok-sub';
      btn.append(top, res, sub);
      const li = document.createElement('li');
      li.append(btn);
      return { btn, li, res, sub, cls: '' };
    });
    tokens.forEach((t, j) => t.btn.addEventListener('click', () => onToken(j)));
    els.track.replaceChildren(...tokens.map((t) => t.li));
  }

  // cur：当前所在的步号（-1 表示尚未开始）
  function updateTrack(cur) {
    const run = S.run;
    let done = 0;
    tokens.forEach((t, j) => {
      const started = cur >= run.reqStart[j];
      const finished = cur >= run.reqEnd[j] - 1;
      const looked = cur >= run.lookupStep[j];
      if (finished) done++;
      let state = finished ? 'is-done' : started ? 'is-current' : 'is-pending';
      if (cur < 0 && j === 0) state = 'is-next';
      let kind = '';
      let res = '';
      let sub = '';
      if (looked) {
        const r = run.results[j];
        kind = r.hit ? 'is-hit' : 'is-fault';
        res = r.hit ? '命中' : `缺页 · 淘汰 P${r.victimPage}`;
        sub = r.hit ? '' : (r.dirty ? '脏页 · 写回' : '覆盖');
      } else if (started) {
        res = '查表中…';
      }
      const cls = `tok ${state} ${kind}`.trim();
      if (t.cls !== cls) {
        t.btn.className = cls;
        t.cls = cls;
      }
      setText(t.res, res);
      setText(t.sub, sub);
      setAttr(t.btn, 'aria-current', state === 'is-current' ? 'step' : 'false');
    });
    setText(els.seqCount, `已完成 ${done} / ${tokens.length} 次访问`);
  }

  function scrollTrackTo(req) {
    const t = tokens[req];
    if (!t) return;
    const track = els.track;
    track.scrollTo({ left: t.btn.offsetLeft - (track.clientWidth - t.btn.offsetWidth) / 2 });
  }

  function updateRounds(view) {
    const round = view.current && view.current.round ? view.current.round : 0;
    roundEls.forEach((li, idx) => {
      const r = idx + 1;
      const cls = round === 0 ? 'round' : r < round ? 'round is-done' : r === round ? 'round is-current' : 'round';
      if (li.className !== cls) li.className = cls;
    });
    let rule = '';
    if (round) rule = M.ROUND_RULES[S.mode][round];
    else if (view.current && view.current.kind === 'lookup' && view.current.phase === '命中') rule = '命中：指针不动，不需要置换。';
    setText(els.rule, rule);
  }

  // ---------- 总渲染 ----------

  function render() {
    const run = S.run;
    const N = run.N;
    const view = M.sampleAt(run, S.i, S.p);
    const cur = view.done ? null : view.current;
    const curStep = view.done ? N - 1 : (S.p > 0 ? S.i : S.i - 1);

    cards.forEach((card) => drawCard(card, view));
    drawHand(view.deg);
    drawTags(view);

    const count = view.done ? N : (S.p > 0 ? S.i + 1 : S.i);
    const stepText = N ? `第 ${count} / ${N} 步` : '没有访问';
    setText(els.stepCount, stepText);
    setText(els.scrubText, stepText);
    setText(els.phase, view.done ? '全部完成' : cur ? cur.phase : '准备就绪');
    setText(els.reqLine, !N ? '' : view.done ? `共 ${run.requests.length} 次访问` : `访问 ${reqLabel(run.requests[view.req])}`);
    setText(els.narr, view.done ? '全部访问已完成。可以重播，或在上方追加访问。'
      : cur ? cur.narr : '点击「播放」或「单步」，观察指针如何一格一格地检查页框。');

    if (view.req !== lastReq) {
      lastReq = view.req;
      scrollTrackTo(view.req);
    }
    updateTrack(curStep);
    updateRounds(view);
    setText(els.stTotal, String(view.snap.stats.total));
    setText(els.stHits, String(view.snap.stats.hits));
    setText(els.stFaults, String(view.snap.stats.faults));
    setText(els.stWrites, String(view.snap.stats.writes));

    els.scrub.max = String(N);
    if (document.activeElement !== els.scrub) els.scrub.value = String(view.index);
    updateControls(view);
  }

  function updateControls(view) {
    const N = S.run.N;
    const atStart = S.i === 0 && S.p === 0;
    els.prev.disabled = N === 0 || atStart;
    els.next.disabled = N === 0 || view.done;
    els.play.disabled = N === 0 || (!hasGsap && !S.reduce);
    setText(els.playText, S.playing ? '❚❚ 暂停' : '▶ 播放');
    els.lamp.classList.toggle('is-running', S.playing);
    els.reduce.checked = S.reduce;
    document.body.classList.toggle('is-reduced', S.reduce);
    els.appendOp.hidden = S.mode !== 'enhanced';
    els.notice.hidden = hasGsap;
    if (!hasGsap) {
      setText(els.notice, S.reduce
        ? '未能加载动画引擎（GSAP）。减少动效下仍可自动播放，每步直接跳转。'
        : '未能加载动画引擎（GSAP），播放已停用。可开启「减少动效」后自动播放，或用单步浏览。');
    }
    document.querySelectorAll('[data-speed]').forEach((b) => setAttr(b, 'aria-pressed', String(Number(b.dataset.speed) === S.speed)));
    document.querySelectorAll('[data-mode]').forEach((b) => setAttr(b, 'aria-pressed', String(b.dataset.mode === S.mode)));
  }

  // ---------- 推演与导航 ----------

  function rebuild() {
    const sc = presetOf(S.scenario);
    S.run = M.buildRun({ mode: S.mode, frames: sc.frames, pointer: sc.pointer, requests: S.requests });
  }

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

  function writeLink() {
    try {
      const params = new URLSearchParams();
      params.set('s', String(S.scenario));
      params.set('m', S.mode === 'basic' ? 'b' : 'e');
      params.set('k', String(S.i));
      if (S.custom) params.set('q', S.requests.map((r) => `${r.page}${r.op.toLowerCase()}`).join('.'));
      history.replaceState(null, '', `#${params.toString()}`);
    } catch (e) {
      // 某些本地环境不允许改写地址，演示照常可用
    }
  }

  function readLink() {
    const out = { scenario: 1, mode: 'enhanced', requests: null, index: 0 };
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      const sid = Number(params.get('s'));
      if (M.SCENARIOS.some((s) => s.id === sid)) out.scenario = sid;
      if (params.get('m') === 'b') out.mode = 'basic';
      const q = params.get('q');
      if (q) {
        const list = q.split('.')
          .map((t) => /^([1-9])([rw])$/i.exec(t))
          .filter(Boolean)
          .map((m) => ({ page: Number(m[1]), op: m[2].toUpperCase() }));
        if (list.length) out.requests = list;
      }
      const k = Number(params.get('k'));
      if (Number.isFinite(k) && k > 0) out.index = Math.floor(k);
    } catch (e) {
      // 地址栏不可读时按默认状态开始
    }
    return out;
  }

  // 跳到第 i 步的第 p 进度，并停止播放；所有画面由 render 按这两个数重算
  function goTo(i, p) {
    killTween();
    clearDwell();
    S.i = clamp(Math.floor(Number(i)) || 0, 0, S.run.N);
    S.p = p;
    render();
    writeLink();
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
    writeLink();
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
      writeLink();
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
        writeLink();
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
        writeLink();
        runLoop();
      }
    });
    tween.timeScale(S.speed);
  }

  // 单步：播放下一步的动画后停住；若一步正在进行，则直接做完
  function stepNext() {
    if (!S.run || S.i >= S.run.N) return;
    const mid = Boolean(tween || dwellTimer || S.p > 0);
    S.playing = false;
    if (mid) {
      killTween();
      clearDwell();
      S.i += 1;
      S.p = 0;
      render();
      writeLink();
      return;
    }
    if (S.reduce || !hasGsap) {
      S.i += 1;
      S.p = 0;
      render();
      writeLink();
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

  function onToken(j) {
    S.playing = false;
    goTo(S.run.reqStart[j], 0);
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

  function setMode(mode) {
    if (mode === S.mode) return;
    const keep = S.i;
    S.playing = false;
    killTween();
    clearDwell();
    S.mode = mode;
    rebuild();
    buildTrack();
    buildLegend();
    buildRounds();
    goTo(Math.min(keep, S.run.N), 0);
  }

  function loadScenario(id, opts) {
    const o = opts || {};
    const sc = presetOf(id);
    S.scenario = sc.id;
    S.requests = o.requests ? o.requests : sc.requests.map((r) => ({ ...r }));
    S.custom = Boolean(o.requests);
    S.playing = false;
    killTween();
    clearDwell();
    rebuild();
    buildTrack();
    buildLegend();
    buildRounds();
    els.scenario.value = String(sc.id);
    goTo(o.index || 0, 0);
  }

  function onAppend(e) {
    e.preventDefault();
    const page = Number(els.appendPage.value);
    if (!Number.isInteger(page) || page < 1 || page > M.MAX_PAGE) {
      els.appendPage.focus();
      return;
    }
    const op = S.mode === 'enhanced' && els.appendOp.value === 'W' ? 'W' : 'R';
    S.requests = S.requests.concat({ page, op });
    S.custom = true;
    S.playing = false;
    rebuild();
    buildTrack();
    goTo(S.run.reqStart[S.run.requests.length - 1], 0);
  }

  function onKey(e) {
    const t = e.target;
    if (t instanceof Element && t.closest('input, select, textarea, button, a, [contenteditable]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      stepNext();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      stepPrev();
    } else if (e.code === 'Home') {
      e.preventDefault();
      replay();
    }
  }

  function bind() {
    document.querySelectorAll('[data-mode]').forEach((b) => {
      b.addEventListener('click', () => setMode(b.dataset.mode));
    });
    document.querySelectorAll('[data-speed]').forEach((b) => {
      b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
    });
    els.scenario.addEventListener('change', (e) => loadScenario(Number(e.target.value)));
    els.appendForm.addEventListener('submit', onAppend);
    els.replay.addEventListener('click', replay);
    els.prev.addEventListener('click', stepPrev);
    els.next.addEventListener('click', stepNext);
    els.play.addEventListener('click', togglePlay);
    els.scrub.addEventListener('input', (e) => {
      S.playing = false;
      goTo(Number(e.target.value), 0);
    });
    els.reduce.addEventListener('change', (e) => setReduce(e.target.checked));
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && S.playing) pause();
    });
    if (reduceQuery && reduceQuery.addEventListener) {
      reduceQuery.addEventListener('change', (e) => setReduce(e.matches));
    }
  }

  function init() {
    buildDial();
    const link = readLink();
    S.mode = link.mode;
    bind();
    loadScenario(link.scenario, { requests: link.requests, index: link.index });
  }

  init();
})();
