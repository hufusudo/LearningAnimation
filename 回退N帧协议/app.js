(() => {
  'use strict';
  const Model = window.GBNModel;
  const Choreo = window.GBNChoreo;
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const descriptions = {
    normal: '连续发送，按序交付；确认返回后，发送窗口向前滑动。',
    data_loss: '帧 1 途中丢失；接收方丢弃后续失序帧，发送方等到超时才回退。',
    ack_loss: 'ACK 0、1 丢失；ACK 2 的累积确认仍能释放前三帧，无须重传。',
    duplicate: '正常确认帧 0、1 后，一份迟到的帧 1 副本到达；观察两端如何处理。',
    sandbox: '手动发送与注入丢包；所有操作记录成可回放的同一条时间线。'
  };
  const allowedActions = ['send', 'arm-data', 'arm-ack', 'drop'];
  const params = new URLSearchParams(location.hash.slice(1));
  const state = {
    scenario: Object.hasOwn(descriptions, params.get('s')) ? params.get('s') : 'normal',
    t: 0, speed: [0.5, 1, 1.5, 2].includes(Number(params.get('speed'))) ? Number(params.get('speed')) : 1,
    reduced: params.has('motion') ? params.get('motion') === 'reduced' : matchMedia('(prefers-reduced-motion: reduce)').matches,
    actions: [], horizon: 45, playing: false
  };
  try {
    const actions = JSON.parse(params.get('a') || '[]');
    if (Array.isArray(actions)) state.actions = actions.filter(a => a && allowedActions.includes(a.type) && Number.isFinite(a.t) && a.t >= 0 && a.t <= 210).slice(0, 150);
    state.horizon = Math.min(240, Math.max(45, ...state.actions.map(a => a.t + 25)));
  } catch { /* Invalid links use an empty exercise. */ }
  let trace;
  let timeline = null;
  let stepTween = null;
  let reducedCall = null;
  let lastHashWrite = 0;
  let lastDiagramKey = '';
  const clock = { t: 0 };
  const packetNodes = new Map();
  const colors = { confirmed: ['#dcebe3', '#adc7b8'], pending: ['#e4ecf7', '#8ba4c6'], available: ['#f7efdd', '#ceb585'], outside: ['#f4f4f0', '#d6d9ce'] };
  function svg(name, attrs = {}, parent) {
    const el = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (parent) parent.append(el);
    return el;
  }
  function text(el, value) { if (el.textContent !== String(value)) el.textContent = value; }
  function attr(el, name, value) { if (el.getAttribute(name) !== String(value)) el.setAttribute(name, value); }
  const cells = { sender: [], receiver: [] };
  for (const kind of ['sender', 'receiver']) {
    for (let i = 0; i < 8; i++) {
      const g = svg('g', { transform: `translate(${(kind === 'sender' ? 50 : 667) + i * 48} 105)` }, $(kind + '-cells'));
      const rect = svg('rect', { width: 39, height: 47, rx: 6 }, g);
      const number = svg('text', { x: 19.5, y: 20, class: 'cell-number' }, g); number.textContent = i;
      const label = svg('text', { x: 19.5, y: 38, class: 'cell-state' }, g);
      cells[kind].push({ g, rect, number, label });
    }
  }
  function writeHash(force = false) {
    if (!force && performance.now() - lastHashWrite < 350) return;
    lastHashWrite = performance.now();
    const p = new URLSearchParams({ s: state.scenario, t: state.t.toFixed(2), speed: state.speed, motion: state.reduced ? 'reduced' : 'full' });
    if (state.scenario === 'sandbox' && state.actions.length) p.set('a', JSON.stringify(state.actions));
    try { history.replaceState(null, '', '#' + p); } catch { /* Local-file restrictions must not disable the controls. */ }
  }
  function uniqueEvents() { return [...new Set(trace.events.map(e => e.t))]; }
  function boundaries() {
    const points = uniqueEvents();
    return [0, ...points.map((t, i) => Math.min(trace.duration, t + Math.min(0.45, ((points[i + 1] ?? trace.duration + 1) - t) * 0.85))), trace.duration]
      .filter((t, i, a) => i === 0 || t > a[i - 1] + 0.00001);
  }
  function nextBoundary() { return boundaries().find(t => t > state.t + 0.0001) ?? trace.duration; }
  function playingUI() {
    const end = trace?.duration ?? Infinity;
    text($('play'), state.playing ? '暂停 Ⅱ' : state.t >= end - 0.001 ? '重播 ▷' : '播放 ▷');
    attr($('play'), 'aria-label', state.playing ? '暂停' : state.t >= end - 0.001 ? '重播' : '播放');
    $('status-light').classList.toggle('running', state.playing);
    $('previous').disabled = state.t <= 0.0001;
    $('next').disabled = state.t >= end - 0.0001;
  }
  function stopStep() { if (stepTween) { stepTween.kill(); stepTween = null; } }
  function pause() {
    state.playing = false;
    timeline?.pause();
    reducedCall?.pause();
    stepTween?.pause();
    playingUI(); writeHash(true);
  }
  function seek(t) {
    pause(); stopStep(); reducedCall?.kill(); reducedCall = null;
    state.t = Math.max(0, Math.min(trace.duration, Number(t) || 0));
    timeline?.time(state.t, true);
    clock.t = state.t;
    render(); writeHash(true);
  }
  function reducedTick() {
    const target = nextBoundary();
    state.t = target; clock.t = target; timeline?.time(target, true);
    render();
    if (target >= trace.duration - 0.0001) { reducedCall = null; pause(); return; }
    reducedCall = gsap.delayedCall(0.9, reducedTick).timeScale(state.speed);
  }
  function play() {
    if (!timeline) return;
    stopStep();
    if (state.t >= trace.duration - 0.0001) seek(0);
    state.playing = true;
    if (state.reduced) {
      if (reducedCall) reducedCall.resume();
      else reducedCall = gsap.delayedCall(0.9, reducedTick).timeScale(state.speed);
    } else timeline.play();
    playingUI();
  }
  function step(direction) {
    const points = boundaries();
    const target = direction > 0 ? nextBoundary() : points.filter(t => t < state.t - 0.001).pop() ?? 0;
    pause(); stopStep(); reducedCall?.kill(); reducedCall = null;
    if (direction < 0 || state.reduced || !timeline) { seek(target); return; }
    state.playing = true; playingUI();
    stepTween = timeline.tweenTo(target, {
      duration: Math.min(1.7, Math.max(0.5, target - state.t)), ease: 'none',
      onComplete: () => { stepTween = null; pause(); }
    }).timeScale(state.speed);
  }
  function rebuild(keep = state.t) {
    pause(); stopStep(); reducedCall?.kill(); reducedCall = null; timeline?.kill();
    trace = Model.buildTrace({ scenario: state.scenario, actions: state.actions, horizon: state.horizon });
    Choreo.prepare(trace);
    for (const el of packetNodes.values()) el.remove(); packetNodes.clear();
    clock.t = 0;
    timeline = window.gsap ? gsap.timeline({ paused: true, onUpdate: () => { state.t = clock.t; render(); }, onComplete: () => pause() }) : null;
    timeline?.to(clock, { t: trace.duration, duration: trace.duration, ease: 'none' }).timeScale(state.speed);
    $('play').disabled = !timeline;
    $('engine-notice').hidden = !!timeline;
    $('progress').max = trace.duration;
    text($('duration'), trace.duration.toFixed(2) + ' t');
    for (const button of document.querySelectorAll('[data-scenario]')) attr(button, 'aria-pressed', button.dataset.scenario === state.scenario);
    text($('scenario-note'), descriptions[state.scenario]);
    $('sandbox-controls').hidden = state.scenario !== 'sandbox';
    buildEventNav();
    lastDiagramKey = '';
    seek(keep);
  }
  function counter(el, c, map = v => v) {
    // The current value is always legible; its short lift is tied to simulation time.
    text(el, map(c.to));
    const p = c.q;
    const alpha = c.from === c.to ? 1 : 0.55 + 0.45 * p;
    const dy = c.from === c.to ? 0 : (1 - p) * 4;
    if (el instanceof SVGElement) {
      attr(el, 'opacity', alpha); attr(el, 'transform', `translate(0 ${dy})`);
    } else {
      el.style.opacity = alpha; el.style.transform = `translateY(${dy}px)`; el.style.display = 'inline-block';
    }
  }
  function mix(a, b, q) {
    const x = a.match(/\w\w/g).map(v => parseInt(v, 16)), y = b.match(/\w\w/g).map(v => parseInt(v, 16));
    return '#' + x.map((n, i) => Math.round(n + (y[i] - n) * q).toString(16).padStart(2, '0')).join('');
  }
  function drawCells(kind, v) {
    const base = v.counters.base.value, next = v.counters.next.value, exp = v.counters.expected.value;
    const clamp = n => Math.max(0, Math.min(1, n));
    cells[kind].forEach((cell, i) => {
      let fill, stroke, label;
      if (kind === 'sender') {
        const done = clamp(base - i), sent = clamp(next - i);
        const available = clamp(base + 4 - i) * clamp(i + 1 - base);
        fill = mix(colors.outside[0].slice(1), colors.available[0].slice(1), available);
        stroke = mix(colors.outside[1].slice(1), colors.available[1].slice(1), available);
        fill = mix(fill.slice(1), colors.pending[0].slice(1), sent);
        stroke = mix(stroke.slice(1), colors.pending[1].slice(1), sent);
        fill = mix(fill.slice(1), colors.confirmed[0].slice(1), done);
        stroke = mix(stroke.slice(1), colors.confirmed[1].slice(1), done);
        label = i < v.state.base ? '已确认' : i < v.state.next ? '待确认' : i < v.state.base + 4 ? '可发送' : '窗口外';
      } else {
        const done = clamp(exp - i), current = Math.max(0, 1 - Math.abs(i - exp));
        fill = mix(colors.outside[0].slice(1), colors.available[0].slice(1), current);
        stroke = mix(colors.outside[1].slice(1), colors.available[1].slice(1), current);
        fill = mix(fill.slice(1), colors.confirmed[0].slice(1), done);
        stroke = mix(stroke.slice(1), colors.confirmed[1].slice(1), done);
        label = i < v.state.expected ? '已交付' : i === v.state.expected ? '期望' : '等待';
      }
      attr(cell.rect, 'fill', fill); attr(cell.rect, 'stroke', stroke); text(cell.label, label);
    });
  }
  function renderPacket(p) {
    let g = packetNodes.get(p.id);
    if (!g) {
      g = svg('g', { class: 'packet' + (p.type === 'ACK' ? ' ack' : ''), 'data-packet-id': p.id }, $('packet-layer'));
      svg('rect', { class: 'packet-body', x: -36, y: -14, width: 72, height: 28, rx: 5 }, g);
      svg('text', { y: 4 }, g);
      svg('text', { y: -21, class: 'retry-mark' }, g);
      svg('path', { d: 'M-5 -5L5 5M5 -5L-5 5', stroke: '#a74438', 'stroke-width': 2, fill: 'none', class: 'loss-cross' }, g);
      g.addEventListener('click', () => injectDrop(p.id));
      g.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); injectDrop(p.id); } });
      packetNodes.set(p.id, g);
    }
    const interactive = state.scenario === 'sandbox' && p.active && state.actions.length < 150 && state.t <= 210;
    attr(g, 'class', 'packet' + (p.type === 'ACK' ? ' ack' : '') + (interactive ? ' interactive' : ''));
    attr(g, 'transform', `translate(${p.x} ${p.y})`); attr(g, 'opacity', p.alpha);
    attr(g, 'tabindex', interactive ? '0' : '-1'); attr(g, 'role', interactive ? 'button' : 'presentation');
    attr(g, 'aria-label', p.label + (interactive ? '，点击丢弃' : ''));
    attr(g, 'visibility', p.alpha > 0 ? 'visible' : 'hidden');
    const [rect, label, retry, cross] = g.children;
    attr(rect, 'fill', p.lost ? '#faeae5' : p.type === 'ACK' ? '#f0f7f2' : '#eff4fa');
    attr(rect, 'stroke', p.lost ? '#a74438' : p.type === 'ACK' ? '#82ad97' : p.retransmit ? '#b58c45' : '#89a2bf');
    text(label, p.lost ? '' : p.label); text(retry, p.retransmit ? '重传' : p.duplicate ? '迟到副本' : '');
    attr(cross, 'visibility', p.lost ? 'visible' : 'hidden');
  }
  function render() {
    const v = Choreo.sample(trace, state.t, state.reduced);
    text($('clock'), state.t.toFixed(2).padStart(5, '0'));
    text($('phase'), v.phase); text($('progress-time'), state.t.toFixed(2));
    $('progress').value = state.t;
    text($('explanation'), v.message);
    counter($('base-value'), v.counters.base, n => n >= 8 ? '终点' : n);
    counter($('next-value'), v.counters.next, n => n >= 8 ? '终点' : n);
    counter($('expected-value'), v.counters.expected, n => n >= 8 ? '完成' : n);
    counter($('delivered-value'), v.counters.expected);
    counter($('confirmed-count'), v.counters.base);
    counter($('retry-count'), v.counters.retransmissions);
    drawCells('sender', v); drawCells('receiver', v);
    const baseX = 50 + v.counters.base.value * 48;
    attr($('sender-window'), 'transform', `translate(${baseX} 105)`);
    attr($('sender-window').firstElementChild, 'width', Math.min(4, 8 - v.counters.base.value) * 48 + 1);
    attr($('sender-window'), 'opacity', Math.min(1, 8 - v.counters.base.value));
    attr($('receiver-window'), 'transform', `translate(${667 + v.counters.expected.value * 48} 105)`);
    attr($('receiver-window'), 'opacity', Math.min(1, 8 - v.counters.expected.value));
    attr($('base-pointer'), 'transform', `translate(${baseX + 19.5} 163)`);
    attr($('next-pointer'), 'transform', `translate(${69.5 + v.counters.next.value * 48} 190)`);
    attr($('expected-pointer'), 'transform', `translate(${686.5 + v.counters.expected.value * 48} 163)`);
    text($('timer-value'), v.timer.running ? v.timer.remaining.toFixed(1) : '—');
    text($('timer-label'), v.timer.running ? '追踪帧 ' + v.state.timerBase : '无待确认帧');
    attr($('timer-progress'), 'stroke-dashoffset', 144.514 * (v.timer.running ? 1 - v.timer.fraction : 1));
    const visible = new Set(v.packets.map(p => p.id));
    for (const [id, el] of packetNodes) if (!visible.has(id)) { el.remove(); packetNodes.delete(id); }
    v.packets.forEach(renderPacket);
    const receiverEvent = ['receive', 'discard', 'ack-send'].includes(v.event?.type);
    const channelOnly = v.event?.type === 'drop';
    attr($('sender-focus'), 'opacity', receiverEvent || channelOnly ? 0 : v.focus);
    attr($('receiver-focus'), 'opacity', receiverEvent && !channelOnly ? v.focus : 0);
    const tag = $('event-tag');
    const warning = ['drop', 'discard', 'timeout', 'blocked'].includes(v.event?.type);
    attr(tag, 'opacity', v.tagAlpha);
    attr(tag, 'transform', `translate(${v.event?.type === 'drop' ? 550 : receiverEvent ? 844 : 290} ${318 - v.tagAlpha * 3})`);
    attr(tag.firstElementChild, 'fill', warning ? '#f9ece6' : '#f0f5ef');
    text(tag.lastElementChild, v.event?.type === 'drop' ? (v.event.packetType === 'ACK' ? 'ACK 丢失' : '数据帧丢失') : v.phase);
    playingUI();
    if (state.scenario === 'sandbox') renderSandbox(v);
    if (document.querySelector('.spacetime').open) drawDiagram();
    writeHash();
  }
  function armed(type) {
    let value = false;
    for (const change of trace.armChanges || []) {
      if (change.t > state.t) break;
      value = type === 'arm-data' ? change.data : change.ack;
    }
    return value;
  }
  function renderSandbox(v) {
    attr($('arm-data'), 'aria-pressed', armed('arm-data'));
    attr($('arm-ack'), 'aria-pressed', armed('arm-ack'));
    const limited = state.actions.length >= 150 || state.t > 210;
    $('arm-data').disabled = limited; $('arm-ack').disabled = limited;
    $('send-one').disabled = v.state.next >= 8 || v.state.next - v.state.base >= 4 || limited;
    text($('sandbox-status'), limited ? '已到本轮演练边界，请复位开始新一轮。' : v.state.next >= 8 ? '本轮 8 帧已全部发出；可继续播放等待确认，或复位重新演练。' : v.state.next - v.state.base >= 4 ? '窗口已满，继续播放或单步，等待 ACK 返回释放空位。' : '手动发送，播放让报文继续前进。也可点击在途报文丢弃。');
  }
  function addAction(action) {
    if (state.scenario !== 'sandbox' || state.actions.length >= 150 || state.t > 210) return;
    pause();
    // A new action after rewinding starts a new branch; it never edits the old future silently.
    state.actions = state.actions.filter(a => a.t <= state.t + 0.000001);
    state.actions.push({ t: Number(state.t.toFixed(6)), ...action });
    state.horizon = Math.min(240, Math.max(45, state.t + 25));
    rebuild(state.t);
    if (action.type === 'send') step(1);
  }
  function injectDrop(id) {
    if (state.scenario !== 'sandbox') return;
    const packet = Choreo.sample(trace, state.t).packets.find(p => p.id === id && p.active);
    if (packet) addAction({ type: 'drop', packetId: id });
  }
  function buildEventNav() {
    const nav = $('event-nav'); nav.replaceChildren();
    const events = trace.events.filter(e => ['drop', 'timeout', 'complete'].includes(e.type) || e.type === 'discard' && state.scenario === 'duplicate' || e.type === 'ack' && e.after.base - e.before.base > 1);
    const picks = events.filter((e, i) => i === 0 || e.type !== events[i - 1].type).slice(0, 7);
    for (const e of picks) {
      const b = document.createElement('button');
      const t = document.createElement('span'); t.textContent = e.t.toFixed(1) + 't'; b.append(t);
      b.append(e.type === 'drop' ? (trace.packets.find(p => p.id === e.packetId)?.type === 'ACK' ? 'ACK 丢失' : '数据帧丢失') : e.type === 'timeout' ? '回退重传' : e.type === 'complete' ? '全部确认' : e.type === 'discard' ? '重复丢弃' : '累积确认');
      b.addEventListener('click', () => {
        const nextTime = uniqueEvents().find(t => t > e.t) ?? trace.duration + 1;
        seek(Math.min(trace.duration, e.t + Math.min(0.45, (nextTime - e.t) * 0.85)));
      }); nav.append(b);
    }
    if (!picks.length) text(nav, '逐事件单步，或拖动时间观察在途报文。');
  }
  function drawDiagram() {
    const s = $('spacetime');
    const key = state.t.toFixed(2);
    if (lastDiagramKey === key) return;
    lastDiagramKey = key;
    s.replaceChildren();
    const height = Math.max(480, trace.duration * 24 + 95);
    attr(s, 'viewBox', `0 0 1000 ${height}`); s.style.height = height + 'px';
    const y = t => 55 + t * 24;
    for (const [x, name] of [[220, '发送方 S'], [780, '接收方 R']]) {
      svg('line', { x1: x, x2: x, y1: 40, y2: height - 20, stroke: '#c9cec4' }, s);
      const label = svg('text', { x, y: 25, 'text-anchor': 'middle', class: 'diagram-text' }, s); label.textContent = name;
    }
    for (let t = 0; t <= trace.duration; t += 2) {
      const label = svg('text', { x: 65, y: y(t) + 4, class: 'diagram-text' }, s); label.textContent = t + 't';
      svg('path', { d: `M100 ${y(t)}H895`, stroke: '#f0f1eb', fill: 'none' }, s);
    }
    for (const packet of trace.packets) {
      if (packet.start > state.t) continue;
      const stop = Math.min(state.t, packet.dropTime ?? packet.end);
      const q = (stop - packet.start) / 2;
      const ack = packet.type === 'ACK', x1 = ack ? 780 : 220, x2 = ack ? 220 : 780;
      const color = packet.dropTime !== null && packet.dropTime !== undefined && packet.dropTime <= state.t ? '#a74438' : ack ? '#2e7c64' : packet.retransmit ? '#936a2b' : '#3d659b';
      svg('line', { x1, x2: x1 + (x2 - x1) * q, y1: y(packet.start), y2: y(stop), stroke: color, 'stroke-width': 1.4, 'stroke-dasharray': packet.retransmit ? '5 3' : '', 'marker-end': `url(#${ack ? 'ack' : 'data'}-arrow)` }, s);
      if (packet.dropTime !== null && packet.dropTime !== undefined && packet.dropTime <= state.t) {
        const x = x1 + (x2 - x1) * q, yy = y(stop);
        svg('path', { d: `M${x - 4} ${yy - 4}l8 8m0 -8l-8 8`, stroke: color, 'stroke-width': 2 }, s);
      }
      const label = svg('text', { x: ack ? x1 - 10 : x1 + 10, y: y(packet.start) - 5, 'text-anchor': ack ? 'end' : 'start', class: 'diagram-text' }, s);
      label.textContent = ack ? Choreo.ackLabel(packet.seq) : (packet.retransmit ? '重传 ' : '帧 ') + packet.seq;
    }
    svg('path', { d: `M110 ${y(state.t)}H890`, stroke: '#343c38', 'stroke-dasharray': '3 5', 'stroke-opacity': 0.45 }, s);
  }

  $('play').addEventListener('click', () => state.playing ? pause() : play());
  $('reset').addEventListener('click', () => {
    if (state.scenario === 'sandbox') { state.actions = []; state.horizon = 45; rebuild(0); }
    else seek(0);
  });
  $('previous').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('progress').addEventListener('input', e => seek(e.target.value));
  $('speed').value = state.speed;
  $('speed').addEventListener('change', e => { state.speed = Number(e.target.value); timeline?.timeScale(state.speed); stepTween?.timeScale(state.speed); reducedCall?.timeScale(state.speed); writeHash(true); });
  $('reduced-motion').checked = state.reduced;
  function applyMotion() { document.body.dataset.motion = state.reduced ? 'reduced' : 'full'; }
  applyMotion();
  $('reduced-motion').addEventListener('change', e => {
    const wasPlaying = state.playing; pause(); stopStep(); reducedCall?.kill(); reducedCall = null;
    state.reduced = e.target.checked; applyMotion(); render(); writeHash(true); if (wasPlaying) play();
  });
  for (const button of document.querySelectorAll('[data-scenario]')) button.addEventListener('click', () => { state.scenario = button.dataset.scenario; rebuild(state.t); });
  $('send-one').addEventListener('click', () => addAction({ type: 'send' }));
  $('arm-data').addEventListener('click', () => addAction({ type: 'arm-data' }));
  $('arm-ack').addEventListener('click', () => addAction({ type: 'arm-ack' }));
  document.querySelector('.spacetime').addEventListener('toggle', () => { if (document.querySelector('.spacetime').open) drawDiagram(); });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input,select,textarea,button,a,summary,[role="button"]')) return;
    if (['Space', 'ArrowLeft', 'ArrowRight', 'Home'].includes(e.code)) e.preventDefault();
    if (e.code === 'Space') state.playing ? pause() : play();
    if (e.code === 'ArrowLeft') step(-1);
    if (e.code === 'ArrowRight') step(1);
    if (e.code === 'Home') $('reset').click();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => { pause(); stopStep(); reducedCall?.kill(); timeline?.kill(); });
  rebuild(Number(params.get('t')) || 0);
})();
