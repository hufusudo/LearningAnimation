/**
 * 时钟页面置换算法的界面控制器。
 * ClockModel.sampleAt 给出位置，ClockChoreo 决定每个元素在这一刻的样子；这里只负责把结果写进 DOM、
 * 按钮与键盘、地址栏，以及本模块自己的补间与计时器（切换或复位时清理）。
 */
(function () {
  'use strict';

  const M = window.ClockModel;
  const C = window.ClockChoreo;
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
  const TRAY = { x: 578, y: 350, w: 116, h: 62 };   // 外存托盘（脏页写回的去处）
  const COLOR = { stroke: '#D6D3CD', border: '#D6D3CD', red: '#B42318', white: '#FFFFFF', redSoft: '#FDF1EF' };
  const ROUND_LABEL = {
    enhanced: ['找 (0,0)', '找 (0,1) 并清 R', '找 (0,0)', '找 (0,1)'],
    basic: ['找 R=0', '第二圈必中']
  };
  const LEGEND = {
    enhanced: [['(0,0)', '未访问·未修改'], ['(0,1)', '未访问·已修改'], ['(1,0)', '已访问·未修改'], ['(1,1)', '已访问·已修改']],
    basic: [['R=0', '可被淘汰'], ['R=1', '置 0 后前移']]
  };
  const INTRO_PHASE = '准备就绪';
  const INTRO_NARR = '点击「播放」或「单步」，观察指针如何一格一格地检查页框。';
  const DONE_NARR = '全部访问已完成。可以重播，或在上方追加访问。';

  const $ = (id) => document.getElementById(id);
  const statEls = (key) => ({
    main: document.querySelector(`[data-stat="${key}"] .n-main`),
    ghost: document.querySelector(`[data-stat="${key}"] .n-ghost`)
  });
  const els = {
    scenario: $('scenario'),
    trackScroll: $('track-scroll'),
    track: $('track'),
    cursor: $('track-cursor'),
    seqCount: $('seq-count'),
    appendForm: $('append'),
    appendPage: $('append-page'),
    appendOp: $('append-op'),
    lamp: $('lamp'),
    stepCount: $('step-count'),
    phase: $('phase'),
    reqLine: $('req-line'),
    dial: $('dial'),
    hand: $('hand'),
    trail: $('trail'),
    connector: $('connector'),
    tray: $('tray'),
    trayBox: $('tray-box'),
    trayCount: $('tray-count'),
    trayGhost: $('tray-ghost'),
    ghost: $('ghost'),
    ghostText: $('ghost-text'),
    legend: $('legend'),
    narr: $('narr'),
    rounds: $('rounds'),
    rule: $('rule'),
    stats: { total: statEls('total'), hits: statEls('hits'), faults: statEls('faults'), writes: statEls('writes') },
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

  // ---------- 工具 ----------

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmt = (v) => String(Math.round(v * 1000) / 1000);
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const setAttr = (el, name, v) => {
    const s = typeof v === 'number' ? fmt(v) : String(v);
    if (el.getAttribute(name) !== s) el.setAttribute(name, s);
  };
  const setTransform = (el, value) => {
    if (value) setAttr(el, 'transform', value);
    else if (el.hasAttribute('transform')) el.removeAttribute('transform');
  };
  const presetOf = (id) => M.SCENARIOS.find((s) => s.id === id) || M.SCENARIOS[0];
  const reqLabel = (r) => (S.mode === 'enhanced' ? `P${r.page}（${r.op === 'W' ? '写' : '读'}）` : `P${r.page}`);
  const ruleOf = (st) => {
    if (!st) return '';
    if (st.round) return M.ROUND_RULES[S.mode][st.round];
    if (st.kind === 'lookup' && st.outcome === 'hit') return '命中：指针不动，不需要置换。';
    return '';
  };

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

  function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`;
  }

  // 屏幕坐标 → 圆盘的视口坐标（页框与托盘、访问标记之间的连线与幽灵用它换算）
  function clientToSvg(x, y) {
    const ctm = els.dial.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = els.dial.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const q = pt.matrixTransform(ctm.inverse());
    return { x: q.x, y: q.y };
  }

  const frameCenter = (f) => ({ x: CARD_POS[f].x + CARD.w / 2, y: CARD_POS[f].y + CARD.h / 2 });
  const polar = (deg, r) => {
    const t = (deg * Math.PI) / 180;
    return { x: HUB.x + r * Math.sin(t), y: HUB.y - r * Math.cos(t) };
  };

  // 文字淡入淡出（透明度由 choreo 给出）
  function applyText(el, tv) {
    setText(el, tv.text);
    el.style.opacity = fmt(tv.alpha);
  }

  // 数字滚动：旧数上滑淡出，新数自下滑入（HTML 与 SVG 文本都适用）
  function setPos(el, dy, alpha) {
    if (el instanceof SVGElement) {
      setTransform(el, dy ? `translate(0 ${fmt(dy)})` : '');
      setAttr(el, 'opacity', alpha);
    } else {
      el.style.transform = dy ? `translateY(${fmt(dy)}px)` : '';
      el.style.opacity = fmt(alpha);
    }
  }

  function paintTick(main, ghost, from, to, q, prefix) {
    if (from === to || q <= 0 || q >= 1) {
      const v = from !== to && q <= 0 ? from : to;
      setText(main, `${prefix}${v}`);
      setPos(main, 0, 1);
      setPos(ghost, 0, 0);
      return;
    }
    setText(main, `${prefix}${to}`);
    setPos(main, 10 * (1 - q), q);
    setText(ghost, `${prefix}${from}`);
    setPos(ghost, -10 * q, 1 - q);
  }

  // ---------- 舞台：构建 ----------

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
      const ring = svgEl('rect', { class: 'card-ring', x: pos.x - 6, y: pos.y - 6, width: CARD.w + 12, height: CARD.h + 12, rx: 19, fill: 'none', stroke: '#2563EB', 'stroke-width': 2, opacity: 0 }, g);
      const body = svgEl('rect', { class: 'card-body', x: pos.x, y: pos.y, width: CARD.w, height: CARD.h, rx: 14, fill: '#FFFFFF', stroke: COLOR.stroke, 'stroke-width': 1.4 }, g);
      svgEl('text', { class: 'card-f', x: pos.x + 14, y: pos.y + 22 }, g).textContent = `F${f}`;
      const cls = svgEl('text', { class: 'card-cls', x: pos.x + CARD.w - 14, y: pos.y + 22, 'text-anchor': 'end' }, g);
      const page = svgEl('text', { class: 'card-page', x: pos.x + CARD.w / 2, y: pos.y + 58, 'text-anchor': 'middle' }, g);
      const empty = svgEl('text', { class: 'card-empty', x: pos.x + CARD.w / 2, y: pos.y + 53, 'text-anchor': 'middle', opacity: 0 }, g);
      empty.textContent = '空闲';
      const chipR = makeChip(g, 'r');
      const chipM = makeChip(g, 'm');
      return { f, pos, g, ring, body, cls, page, empty, chipR, chipM };
    });
    const tagHost = $('tags');
    tags = [0, 1].map(() => {
      const g = svgEl('g', { class: 'tag', opacity: 0 }, tagHost);
      const rect = svgEl('rect', { class: 'tag-bg', height: 26, rx: 8 }, g);
      const text = svgEl('text', { class: 'tag-text' }, g);
      return { g, rect, text };
    });
  }

  function paintChip(g, kind, x, y, on, label, sy, alpha) {
    setAttr(g, 'class', `chip chip-${kind} ${on ? 'is-on' : 'is-off'}`);
    setAttr(g, 'opacity', alpha);
    const rect = g.firstChild;
    const text = g.lastChild;
    setAttr(rect, 'x', x);
    setAttr(rect, 'y', y);
    setAttr(text, 'x', x + 28);
    setAttr(text, 'y', y + 10);
    setText(text, label);
    const cx = x + 28;
    const cy = y + 10;
    setTransform(g, Math.abs(sy - 1) < 0.001 ? '' : `translate(${fmt(cx)} ${fmt(cy)}) scale(1 ${fmt(sy)}) translate(${fmt(-cx)} ${fmt(-cy)})`);
  }

  function paintCard(card, cv, rv) {
    const cx = card.pos.x + CARD.w / 2;
    const cy = card.pos.y + CARD.h / 2;
    const enhanced = S.mode === 'enhanced';

    // 页号：幽灵离开或落地时切换，过渡由透明度与缩放完成
    setText(card.page, cv.page.text);
    setAttr(card.page, 'opacity', cv.page.alpha);
    const pageT = `translate(${fmt(cx)} ${fmt(cy)}) scale(${fmt(cv.page.scale)}) translate(${fmt(-cx)} ${fmt(-cy)})`
      + (cv.page.dy ? ` translate(0 ${fmt(cv.page.dy)})` : '');
    setTransform(card.page, cv.page.scale === 1 && !cv.page.dy ? '' : pageT);
    setAttr(card.empty, 'opacity', cv.empty.alpha);

    // 访问位与修改位：翻牌是缩成一条线再展开，中途换值
    const y = card.pos.y + CARD.h - 30;
    const rX = enhanced ? card.pos.x + 14 : card.pos.x + (CARD.w - 56) / 2;
    paintChip(card.chipR, 'r', rX, y, cv.r.value === 1, `R ${cv.r.value}`, cv.r.sy, cv.chips.alpha);
    card.chipM.style.display = enhanced ? '' : 'none';
    if (enhanced) paintChip(card.chipM, 'm', card.pos.x + CARD.w - 70, y, cv.m.value === 1, `M ${cv.m.value}`, cv.m.sy, cv.chips.alpha);

    // 类别标签随位一起淡入淡出
    setText(card.cls, enhanced ? cv.cls : '');
    setAttr(card.cls, 'opacity', enhanced ? cv.chips.alpha : 0);

    // 本体：选中渐变为红色并抬起；空闲时虚线
    setAttr(card.body, 'stroke', mixHex(COLOR.stroke, COLOR.red, cv.victim));
    setAttr(card.body, 'fill', mixHex(COLOR.white, COLOR.redSoft, cv.victim));
    setAttr(card.body, 'stroke-width', 1.4 + 0.6 * cv.victim);
    setAttr(card.body, 'stroke-dasharray', cv.dashed ? '6 5' : 'none');
    setTransform(card.g, cv.lift ? `translate(0 ${fmt(cv.lift)})` : '');

    // 焦点外环：到位后淡入并收紧
    setAttr(card.ring, 'opacity', rv.alpha);
    setAttr(card.ring, 'stroke', mixHex('#2563EB', COLOR.red, cv.victim));   // 选中的页框，外环也转红
    setTransform(card.ring, rv.scale === 1 ? '' : `translate(${fmt(cx)} ${fmt(cy)}) scale(${fmt(rv.scale)}) translate(${fmt(-cx)} ${fmt(-cy)})`);
  }

  function paintTrail(tv) {
    const el = els.trail;
    if (!tv || tv.alpha < 0.01 || Math.abs(tv.to - tv.from) < 0.5) {
      setAttr(el, 'd', '');
      return;
    }
    const r = 124;
    const a = polar(tv.from, r);
    const b = polar(tv.to, r);
    const large = tv.to - tv.from > 180 ? 1 : 0;
    setAttr(el, 'd', `M ${fmt(a.x)} ${fmt(a.y)} A ${r} ${r} 0 ${large} 1 ${fmt(b.x)} ${fmt(b.y)}`);
    setAttr(el, 'opacity', tv.alpha);
  }

  function paintConnector(cv) {
    const el = els.connector;
    const token = cv && tokens[cv.req] ? tokens[cv.req].btn : null;
    if (!cv || !token || cv.alpha < 0.01 || cv.draw < 0.001) {
      setAttr(el, 'opacity', 0);
      return;
    }
    const r = token.getBoundingClientRect();
    const from = clientToSvg(r.left + r.width / 2, r.bottom + 4);
    const card = cards[cv.frame];
    const to = { x: card.pos.x + CARD.w / 2, y: card.pos.y - 6 };
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    setAttr(el, 'x1', from.x);
    setAttr(el, 'y1', from.y);
    setAttr(el, 'x2', to.x);
    setAttr(el, 'y2', to.y);
    setAttr(el, 'stroke-dasharray', `${fmt(len)} ${fmt(len)}`);
    setAttr(el, 'stroke-dashoffset', len * (1 - cv.draw));
    setAttr(el, 'opacity', cv.alpha);
  }

  function paintGhost(gv, step) {
    const g = els.ghost;
    if (!gv) {
      g.style.display = 'none';
      return;
    }
    g.style.display = '';
    let x;
    let y;
    if (gv.kind === 'out') {
      const c = frameCenter(gv.frame);
      const t = { x: TRAY.x + TRAY.w / 2, y: TRAY.y + TRAY.h / 2 };
      x = c.x + (t.x - c.x) * gv.q;
      y = c.y + (t.y - c.y) * gv.q;
      setAttr(g, 'class', 'ghost ghost-out');
    } else {
      const r = tokens[step.req].btn.getBoundingClientRect();
      const s = clientToSvg(r.left + r.width / 2, r.top + r.height / 2);
      const c = frameCenter(gv.frame);
      x = s.x + (c.x - s.x) * gv.q;
      y = s.y + (c.y - s.y) * gv.q;
      setAttr(g, 'class', 'ghost ghost-in');
    }
    setAttr(g, 'transform', `translate(${fmt(x)} ${fmt(y)})`);
    setAttr(g, 'opacity', gv.alpha);
    setText(els.ghostText, gv.label);
  }

  function paintTags(list) {
    tags.forEach((t, k) => {
      const d = list[k];
      if (!d) {
        if (t.g.style.display !== 'none') t.g.style.display = 'none';
        return;
      }
      t.g.style.display = '';
      setAttr(t.g, 'class', `tag tone-${d.tone}`);
      setAttr(t.g, 'opacity', d.alpha);
      setText(t.text, d.text);
      const at = TAG_AT[d.frame];
      const w = textWidth(d.text);
      const x = at.anchor === 'end' ? at.x - w : at.anchor === 'middle' ? at.x - w / 2 : at.x;
      const y = at.y + d.dy;
      setAttr(t.rect, 'x', x);
      setAttr(t.rect, 'y', y - 13);
      setAttr(t.rect, 'width', w);
      setAttr(t.text, 'x', x + 10);
      setAttr(t.text, 'y', y);
    });
  }

  function paintTray(step, p) {
    const show = S.mode === 'enhanced';
    els.tray.style.display = show ? '' : 'none';
    if (!show) return;
    const sv = C.statsView(step, p).writes;
    paintTick(els.trayCount, els.trayGhost, sv.from, sv.to, sv.q, '写回 ');
    const glow = step ? C.trayView(step, p).glow : 0;
    setAttr(els.trayBox, 'stroke', mixHex(COLOR.border, COLOR.red, glow));
    setAttr(els.trayBox, 'stroke-width', 1.2 + 1.2 * glow);
  }

  function paintDial(step, prev, p) {
    setAttr(els.hand, 'transform', `rotate(${fmt(C.handDeg(step, p))} ${HUB.x} ${HUB.y})`);
    paintTrail(C.trailView(step, p));
    paintConnector(C.connectorView(step, prev, p));
    cards.forEach((card) => paintCard(card, C.cardView(step, p, card.f), C.ringView(step, prev, p, card.f)));
    paintGhost(C.ghostView(step, p), step);
    paintTags(C.tagsView(step, prev, p));
    paintTray(step, p);
  }

  // ---------- 上方访问序列 ----------

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

  // 访问标记：状态按步切换；结果、去向与淘汰页随步揭示（透明度过渡）
  function paintTokens(view) {
    const run = S.run;
    const { step, p, done } = view;
    const cur = done ? run.N - 1 : (p > 0 ? view.index : view.index - 1);
    let finishedCount = 0;
    tokens.forEach((t, j) => {
      const started = cur >= run.reqStart[j];
      const finished = cur >= run.reqEnd[j] - 1;
      if (finished) finishedCount++;
      let state = finished ? 'is-done' : started ? 'is-current' : 'is-pending';
      if (cur < 0 && j === 0) state = 'is-next';
      const r = run.results[j];
      const looked = cur >= run.lookupStep[j];
      const cls = `tok ${state} ${looked ? (r.hit ? 'is-hit' : 'is-fault') : ''}`.trim();
      if (t.cls !== cls) {
        t.btn.className = cls;
        t.cls = cls;
      }
      let res = '';
      if (looked) res = r.hit ? `命中 F${r.frame}` : (cur >= run.loadStep[j] ? `缺页 → F${r.frame}` : '缺页');
      let sub = '';
      if (!r.hit && cur >= run.evictStep[j]) sub = r.dirty ? `淘汰 P${r.victimPage} · 写回` : `淘汰 P${r.victimPage} · 覆盖`;
      let resA = 1;
      let subA = 1;
      if (step && !done && p > 0 && step.req === j) {
        if (step.kind === 'lookup') {
          const [a, b] = C.CHOREO[`lookup-${step.outcome}`].token;
          if (p < a) res = '';
          resA = C.ease(C.win(p, a, b));
        } else if (step.kind === 'load') {
          const [a] = C.CHOREO.load.landing;
          if (p < a) res = '缺页';
          else resA = 0.4 + 0.6 * C.ease(C.win(p, a, a + 0.2));
        } else if (step.kind === 'evict') {
          const [a, b] = C.CHOREO.evict.token;
          if (p < a) sub = '';
          subA = C.ease(C.win(p, a, b));
        }
      }
      setText(t.res, res);
      t.res.style.opacity = fmt(resA);
      setText(t.sub, sub);
      t.sub.style.opacity = fmt(subA);
      setAttr(t.btn, 'aria-current', state === 'is-current' ? 'step' : 'false');
    });
    setText(els.seqCount, `已完成 ${finishedCount} / ${tokens.length} 次访问`);
  }

  // 游标：一条蓝线滑到当前访问下方（位置变化由 CSS 过渡完成）
  function paintCursor(req) {
    const t = tokens[req];
    if (!t) {
      els.cursor.style.opacity = '0';
      return;
    }
    const ol = els.track;
    els.cursor.style.opacity = '1';
    els.cursor.style.left = `${ol.offsetLeft + t.btn.offsetLeft}px`;
    els.cursor.style.width = `${t.btn.offsetWidth}px`;
    els.cursor.style.top = `${ol.offsetTop + t.btn.offsetTop + t.btn.offsetHeight + 4}px`;
  }

  function scrollTrackTo(req) {
    const t = tokens[req];
    if (!t) return;
    const box = els.trackScroll;
    const center = els.track.offsetLeft + t.btn.offsetLeft + t.btn.offsetWidth / 2;
    box.scrollTo({ left: center - box.clientWidth / 2 });
  }

  // ---------- 侧栏与文字 ----------

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

  function paintRounds(round) {
    roundEls.forEach((li, idx) => {
      const r = idx + 1;
      const cls = round === 0 ? 'round' : r < round ? 'round is-done' : r === round ? 'round is-current' : 'round';
      if (li.className !== cls) li.className = cls;
    });
  }

  function paintStats(step, p) {
    const sv = C.statsView(step, p);
    for (const k of Object.keys(els.stats)) {
      paintTick(els.stats[k].main, els.stats[k].ghost, sv[k].from, sv[k].to, sv[k].q, '');
    }
  }

  function paintTexts(view) {
    const run = S.run;
    const N = run.N;
    const { step, prev, p, done, index } = view;
    if (N === 0) {
      setText(els.stepCount, '没有访问');
      return;
    }
    const countText = (n) => `第 ${n} / ${N} 步`;
    const cur = done ? N : (p > 0 ? index + 1 : index);
    applyText(els.stepCount, C.textView(countText(index), countText(cur), p, done));
    applyText(els.phase, C.textView(prev ? prev.phase : INTRO_PHASE, done ? '全部完成' : step.phase, p, done));
    const reqText = (r) => `访问 ${reqLabel(run.requests[r])}`;
    applyText(els.reqLine, C.textView(prev ? reqText(prev.req) : reqText(step.req),
      done ? `共 ${run.requests.length} 次访问` : reqText(step.req), p, done));
    applyText(els.narr, C.textView(prev ? prev.narr : INTRO_NARR, done ? DONE_NARR : step.narr, p, done));
    applyText(els.rule, C.textView(prev ? ruleOf(prev) : '', ruleOf(step), p, done));
  }

  // ---------- 总渲染 ----------

  function render() {
    if (!S.run) return;
    const view = M.sampleAt(S.run, S.i, S.p);
    const { step, prev, p, done } = view;
    if (view.req !== lastReq) {
      lastReq = view.req;
      scrollTrackTo(view.req);   // 先滚动，再量取位置
    }
    if (step) paintDial(step, prev, p);
    paintTexts(view);
    paintTokens(view);
    paintCursor(view.req);
    const round = done || p > 0 ? (step ? step.round : 0) : (prev ? prev.round : 0);
    paintRounds(round);
    paintStats(step, done ? 1 : p);
    paintScrub(view);
    paintControls(view);
  }

  function paintScrub(view) {
    const N = S.run.N;
    els.scrub.max = String(N);
    if (document.activeElement !== els.scrub) els.scrub.value = String(view.index);
    setText(els.scrubText, N ? `第 ${view.done ? N : (S.p > 0 ? view.index + 1 : view.index)} / ${N} 步` : '没有访问');
  }

  function paintControls(view) {
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
    window.addEventListener('resize', () => render());
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
