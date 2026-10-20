(function () {
  'use strict';
  const M = window.RadixModel, C = window.RadixChoreo;
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const engine = window.gsap;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const link = new URLSearchParams(location.hash.slice(1));
  const state = { t: 0, speed: 1, playing: false, reduced: media.matches, seq: null };
  let timeline = null, delayed = null, stopAt = null, lastHash = 0;
  const clock = { t: 0 };
  const cards = [], buckets = [];

  function attr(node, name, value) {
    const text = String(value);
    if (node.getAttribute(name) !== text) node.setAttribute(name, text);
  }
  function text(node, value) { if (node.textContent !== String(value)) node.textContent = String(value); }
  function el(name, attrs, parent, content) {
    const node = document.createElementNS(svgNS, name);
    Object.entries(attrs || {}).forEach(([key, value]) => attr(node, key, value));
    if (content !== undefined) text(node, content);
    if (parent) parent.append(node);
    return node;
  }
  function textView(node, view) {
    text(node, view.text);
    if (node.namespaceURI === svgNS) attr(node, 'opacity', view.alpha.toFixed(4));
    else node.style.opacity = view.alpha.toFixed(4);
  }
  function blend(a, b, q) {
    const aa = a.match(/\w\w/g).map(v => parseInt(v, 16));
    const bb = b.match(/\w\w/g).map(v => parseInt(v, 16));
    return '#' + aa.map((v, i) => Math.round(v + (bb[i] - v) * q).toString(16).padStart(2, '0')).join('');
  }
  function writeHash(force = false) {
    if (!force && performance.now() - lastHash < 300) return;
    lastHash = performance.now();
    const params = new URLSearchParams({ t: state.t.toFixed(3), data: state.seq.items.map(i => i.value).join(','), speed: state.speed, motion: state.reduced ? 'reduce' : 'full' });
    try { history.replaceState(null, '', '#' + params); } catch { /* file:// 可限制地址改写，不影响操作。 */ }
  }
  function staticStage() {
    const g = $('stage-static');
    el('text', { x: 30, y: 43, class: 'label' }, g, '主序列 · 下方为 0–9 数字桶');
    el('text', { x: 1070, y: 43, 'text-anchor': 'end', class: 'minor' }, g, '上端入队 ↓ 下端队头先出 · 按 0 → 9 收集');
    el('rect', { x: 101, y: 76, width: 940, height: 88, rx: 10, fill: '#ffffff', stroke: '#e5e4dc' }, g);
    for (let i = 0; i < 8; i++) {
      const p = C.beltPoint(i);
      el('rect', { x: p.x - 41, y: p.y - 18, width: 82, height: 36, rx: 6, fill: '#faf9f5', stroke: '#dedfd6', 'stroke-dasharray': '3 3' }, g);
      el('text', { x: p.x, y: 154, 'text-anchor': 'middle', class: 'minor mono' }, g, `[${i}]`);
    }
    for (let i = 0; i < 10; i++) {
      const x = C.bucketX(i), group = el('g', {}, $('bucket-layer'));
      el('text', { x, y: 229, 'text-anchor': 'middle', class: 'bucket-number' }, group, i);
      const body = el('rect', { x: x - 43, y: 241, width: 86, height: 295, rx: 8, fill: '#ffffff', stroke: '#dedfd6' }, group);
      el('path', { d: `M${x - 10} 249 L${x} 255 L${x + 10} 249`, fill: 'none', stroke: '#b5beb0', 'stroke-width': 1.2 }, group);
      // 八张卡片共桶时仍有独立格，不压缩、不裁切。
      for (let j = 0; j < 8; j++) el('line', { x1: x - 32, x2: x + 32, y1: 520 - j * 33, y2: 520 - j * 33, stroke: '#f0f0e9' }, group);
      const head = el('text', { x, y: 551, 'text-anchor': 'middle', class: 'minor' }, group, '空');
      const count = el('text', { x, y: 610, 'text-anchor': 'middle', class: 'minor mono' }, group, '占用 0');
      buckets.push({ body, head, count });
    }
  }
  function createCards() {
    $('card-layer').replaceChildren(); cards.length = 0;
    state.seq.items.forEach(item => {
      const group = el('g', { 'data-item': item.id, 'aria-label': `${item.str}，原始身份 ${item.tag}` }, $('card-layer'));
      const ring = el('rect', { x: -43, y: -19, width: 86, height: 38, rx: 8, fill: 'none', stroke: '#3569a1', 'stroke-width': 1.5 }, group);
      const body = el('rect', { x: -39, y: -15, width: 78, height: 30, rx: 5, fill: '#fff', stroke: '#d9ddd3' }, group);
      const window = el('rect', { y: -11, width: 18, height: 22, rx: 3, fill: '#3569a1' }, group);
      const digits = [0, 1, 2].map(i => el('text', { x: -21 + i * 18, y: 6, 'text-anchor': 'middle', class: 'number' }, group, item.str[i]));
      el('text', { x: 30, y: 4, 'text-anchor': 'middle', class: 'identity' }, group, item.tag);
      cards.push({ group, ring, body, window, digits });
    });
  }
  function roundLinks() {
    $('rounds').replaceChildren();
    state.seq.rounds.forEach((round, i) => {
      const row = document.createElement('div'); row.className = 'round';
      [[`${i + 1} · ${C.names[i]}`, round.start], ['分配', round.start + 1], ['收集', round.distributed + 1]].forEach(([label, time], j) => {
        const button = document.createElement('button'); button.textContent = label;
        button.type = 'button'; button.dataset.time = time;
        button.dataset.until = j === 0 ? (state.seq.rounds[i + 1]?.start ?? state.seq.steps.length + 1) : j === 1 ? round.distributed + 1 : round.end;
        button.setAttribute('aria-label', `第 ${i + 1} 轮${C.names[i]}${j === 0 ? '起点' : j === 2 ? '收集' : '分配'}`);
        button.addEventListener('click', () => seek(time)); row.append(button);
      });
      $('rounds').append(row);
    });
  }
  function render(time) {
    state.t = Math.max(0, Math.min(state.seq.steps.length, time));
    const v = C.sample(state.seq, state.t);
    v.cards.forEach(item => {
      const node = cards[item.id];
      attr(node.group, 'transform', `translate(${item.x.toFixed(3)} ${item.y.toFixed(3)})`);
      attr(node.ring, 'opacity', item.focus.toFixed(4));
      attr(node.body, 'stroke', blend('d9ddd3', '2d7d62', item.done));
      attr(node.body, 'fill', blend('ffffff', 'edf6f0', item.done));
      attr(node.window, 'x', (-30 + (2 - item.digit) * 18).toFixed(3));
      attr(node.window, 'opacity', (1 - item.done).toFixed(4));
      node.digits.forEach((digit, i) => {
        const active = Math.max(0, 1 - Math.abs(i - (2 - item.digit))) * (1 - item.done);
        attr(digit, 'fill', blend('343c38', 'ffffff', active));
      });
    });
    // 层级也只由当前画面决定，不保留历史重排。
    const active = v.cards.find(item => item.focus > 0);
    const order = cards.filter((_, id) => id !== active?.id);
    if (active) order.push(cards[active.id]);
    order.forEach((node, i) => {
      const layer = $('card-layer');
      if (layer.children[i] !== node.group) layer.insertBefore(node.group, layer.children[i] || null);
    });
    v.buckets.forEach((bucket, i) => {
      attr(buckets[i].body, 'stroke', blend('dedfd6', '3569a1', bucket.focus));
      attr(buckets[i].body, 'fill', blend('ffffff', 'f0f5fa', bucket.focus * .55));
      textView(buckets[i].head, bucket.head);
      textView(buckets[i].count, { text: `占用 ${bucket.count.text}`, alpha: bucket.count.alpha });
    });
    attr($('route'), 'd', v.route.length ? v.route.map((point, i) => `${i ? 'L' : 'M'}${point.x} ${point.y}`).join(' ') : 'M0 0');
    attr($('route'), 'opacity', v.routeAlpha.toFixed(4));
    attr($('event-tag'), 'transform', `translate(${v.tag.x} ${v.tag.y})`);
    attr($('event-tag'), 'opacity', v.tag.alpha.toFixed(4));
    attr($('event-tag'), 'visibility', v.tag.alpha > 0 ? 'visible' : 'hidden');
    text($('event-tag').querySelector('text'), v.tag.text);
    textView($('narration'), v.text); textView($('phase'), v.phase); textView($('processed'), v.stats);
    text($('clock'), `t ${state.t.toFixed(2).padStart(5, '0')}`);
    $('progress').value = state.t;
    text($('step-value'), `${Math.floor(state.t + 1e-7)} / ${state.seq.steps.length}`);
    document.querySelectorAll('#rounds button').forEach(button => {
      const target = Number(button.dataset.time);
      const current = state.t >= target && state.t < Number(button.dataset.until);
      if (current) attr(button, 'aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    controls(); writeHash();
  }
  function controls() {
    document.body.dataset.playing = state.playing;
    document.body.dataset.reduced = state.reduced;
    text($('play-label'), state.playing ? '暂停' : state.t >= state.seq.steps.length ? '重播' : '播放');
    $('play').disabled = !engine;
    $('prev').disabled = state.t <= 0;
    $('next').disabled = state.t >= state.seq.steps.length;
    $('engine-notice').hidden = Boolean(engine);
    $('reduced').checked = state.reduced;
  }
  function pause() {
    timeline?.pause(); delayed?.kill(); delayed = null; stopAt = null;
    state.playing = false; controls(); writeHash(true);
  }
  function syncTimeline() { if (timeline) timeline.progress(state.t / state.seq.steps.length, true); clock.t = state.t; }
  function seek(time) { pause(); render(state.reduced ? Math.ceil(time) : time); syncTimeline(); writeHash(true); }
  function reducedTick() {
    delayed = engine.delayedCall(.9, () => {
      if (!state.playing) return;
      const target = Math.min(state.seq.steps.length, Math.floor(state.t + 1e-7) + 1);
      render(target); syncTimeline();
      if (target >= (stopAt ?? state.seq.steps.length)) pause(); else reducedTick();
    }).timeScale(state.speed);
  }
  function play(until = null) {
    if (!engine) return;
    if (state.t >= state.seq.steps.length) seek(0);
    stopAt = until;
    state.playing = true; controls();
    if (state.reduced) reducedTick(); else timeline.play();
  }
  function stepForward() {
    const target = Math.min(state.seq.steps.length, Math.floor(state.t + 1e-7) + 1);
    pause();
    if (!engine || state.reduced) seek(target); else play(target);
  }
  function load(numbers, keep = state.t) {
    pause(); timeline?.kill(); timeline = null;
    state.seq = M.build(numbers);
    createCards(); roundLinks();
    $('progress').max = state.seq.steps.length;
    if (engine) {
      clock.t = 0;
      timeline = engine.timeline({ paused: true, onUpdate: () => {
        if (stopAt !== null && clock.t >= stopAt) {
          const end = stopAt; pause(); render(end); syncTimeline();
        } else render(clock.t);
      }, onComplete: () => pause() });
      timeline.to(clock, { t: state.seq.steps.length, duration: state.seq.steps.length * 1.15, ease: 'none' });
      timeline.timeScale(state.speed);
    }
    document.querySelectorAll('[data-preset]').forEach(button => {
      attr(button, 'aria-pressed', JSON.stringify(numbers) === JSON.stringify(M.PRESETS[button.dataset.preset]));
    });
    $('custom-input').value = numbers.map(n => String(n).padStart(3, '0')).join(', ');
    seek(Math.min(keep, state.seq.steps.length));
  }
  // 首次建模前 pause 也需要读取 seq；先放入合法模型。
  state.seq = M.build(M.PRESETS.classic);
  staticStage();
  const speed = Number(link.get('speed'));
  if ([.5, .75, 1, 1.25, 1.5, 1.75, 2].includes(speed)) state.speed = speed;
  if (link.get('motion') === 'reduce' || link.get('motion') === 'full') state.reduced = link.get('motion') === 'reduce';
  let numbers = M.PRESETS.classic;
  if (link.has('data')) { try { numbers = M.parseInput(link.get('data')); } catch { /* 非法分享数据回退默认。 */ } }
  $('speed').value = state.speed; text($('speed-value'), `${state.speed.toFixed(2)}×`);
  load(numbers, Number(link.get('t')) || 0);

  $('play').addEventListener('click', () => state.playing ? pause() : play());
  $('prev').addEventListener('click', () => seek(Math.max(0, Math.ceil(state.t - 1e-7) - 1)));
  $('next').addEventListener('click', stepForward);
  $('reset').addEventListener('click', () => seek(0));
  $('progress').addEventListener('input', event => {
    const time = Number(event.target.value);
    seek(state.reduced ? Math.round(time) : time);
  });
  $('speed').addEventListener('input', event => {
    state.speed = Number(event.target.value);
    timeline?.timeScale(state.speed); delayed?.timeScale(state.speed);
    text($('speed-value'), `${state.speed.toFixed(2)}×`); writeHash(true);
  });
  function setMotion(value) {
    const playing = state.playing, target = stopAt;
    pause(); state.reduced = value;
    if (value && state.t % 1 > 0) render(Math.ceil(state.t));
    syncTimeline(); controls(); writeHash(true);
    if (playing && state.t < state.seq.steps.length && (target === null || state.t < target)) play(target);
  }
  $('reduced').addEventListener('change', event => setMotion(event.target.checked));
  media.addEventListener('change', event => setMotion(event.matches));
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
    text($('input-error'), ''); $('custom-input').removeAttribute('aria-invalid');
    load(M.PRESETS[button.dataset.preset]);
  }));
  $('custom-toggle').addEventListener('click', () => {
    const open = $('custom-form').hidden; $('custom-form').hidden = !open;
    attr($('custom-toggle'), 'aria-expanded', open);
    if (open) $('custom-input').focus();
  });
  $('custom-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const data = M.parseInput($('custom-input').value);
      text($('input-error'), ''); $('custom-input').removeAttribute('aria-invalid'); load(data);
    } catch (error) {
      text($('input-error'), error.message); attr($('custom-input'), 'aria-invalid', 'true');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.target instanceof Element && event.target.closest('input, select, textarea, button, a')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); state.playing ? pause() : play(); }
    if (event.code === 'ArrowRight') { event.preventDefault(); if (state.t < state.seq.steps.length) stepForward(); }
    if (event.code === 'ArrowLeft') { event.preventDefault(); seek(Math.max(0, Math.ceil(state.t - 1e-7) - 1)); }
    if (event.code === 'Home') { event.preventDefault(); seek(0); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => { pause(); timeline?.kill(); });
})();
