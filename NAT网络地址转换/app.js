(function () {
  'use strict';
  const M = window.NATModel;
  const C = window.NATChoreo;
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const params = new URLSearchParams(location.hash.slice(1));
  const state = {
    mode: params.get('m') === 'napt' ? 'napt' : 'basic',
    scenario: ['a', 'b', 'special'].includes(params.get('s')) ? params.get('s') : 'a',
    speed: [0.6, 1, 1.8].includes(Number(params.get('v'))) ? Number(params.get('v')) : 1,
    reduced: params.has('r') ? params.get('r') === '1' : media.matches,
    running: false
  };
  const clock = { t: 0 };
  let sequence, timeline = null, reducedDelay = null, lastLink = 0;
  let motionOverride = params.has('r');
  const hostViews = {}, rowViews = {};
  const fields = ['sip', 'sport', 'dip', 'dport'];
  const fieldViews = Object.fromEntries(fields.map(key => {
    const box = $('field-' + key);
    const cue = document.createElement('b');
    cue.className = 'field-cue';
    box.querySelector('span').appendChild(cue);
    return [key, { box, value: $('value-' + key), note: $('note-' + key), cue }];
  }));
  function text(node, value) { if (node.textContent !== String(value)) node.textContent = value; }
  function attr(node, key, value) { if (node.getAttribute(key) !== String(value)) node.setAttribute(key, value); }
  function svg(name, attributes, parent, content) {
    const node = document.createElementNS(NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (content !== undefined) node.textContent = content;
    parent.appendChild(node);
    return node;
  }
  for (const [i, host] of M.HOSTS.entries()) {
    const y = 105 + i * 110;
    const group = svg('g', {}, $('host-nodes'));
    const focus = svg('rect', { x: 37, y: y - 8, width: 236, height: 102, rx: 16, class: 'focus-ring', opacity: 0 }, group);
    svg('rect', { x: 45, y, width: 220, height: 86, rx: 10, class: 'device' }, group);
    svg('rect', { x: 61, y: y + 14, width: 23, height: 16, rx: 2, class: 'device-icon' }, group);
    svg('path', { d: `M72 ${y + 30}v5m-6 0h12`, class: 'device-icon' }, group);
    svg('text', { x: 95, y: y + 29, class: 'device-name' }, group, '主机 ' + host.id);
    const status = svg('text', { x: 247, y: y + 28, 'text-anchor': 'end', class: 'node-status' }, group, '就绪');
    svg('text', { x: 61, y: y + 54, class: 'endpoint mono' }, group, host.ip);
    svg('text', { x: 61, y: y + 74, class: 'node-detail mono' }, group, 'TCP :50001');
    hostViews[host.id] = { group, status, focus };
  }
  for (const [index, host] of ['A', 'B'].entries()) {
    const group = svg('g', { visibility: 'hidden' }, $('table-rows'));
    const background = svg('rect', { x: 416, y: 381 + index * 40, width: 664, height: 36, rx: 5, class: 'table-highlight', opacity: 0 }, group);
    const accent = svg('rect', { x: 416, y: 387 + index * 40, width: 3, height: 24, rx: 1, class: 'table-accent', opacity: 0 }, group);
    const y = 404 + index * 40;
    const privateValue = svg('text', { x: 432, y, class: 'table-value mono' }, group);
    svg('text', { x: 683, y, class: 'table-key', 'text-anchor': 'middle' }, group, '⇄');
    const publicValue = svg('text', { x: 712, y, class: 'table-value mono' }, group);
    const publicIP = svg('tspan', {}, publicValue);
    const publicPort = svg('tspan', {}, publicValue);
    const key = svg('text', { x: 1035, y, class: 'table-key mono', 'text-anchor': 'middle' }, group);
    rowViews[host] = { group, background, accent, privateValue, publicIP, publicPort, key };
  }
  function writeLink(force = false) {
    if (!force && performance.now() - lastLink < 350) return;
    lastLink = performance.now();
    const hash = new URLSearchParams({ m: state.mode, s: state.scenario, t: clock.t.toFixed(2), v: state.speed, r: state.reduced ? '1' : '0' });
    try { history.replaceState(null, '', '#' + hash); } catch { /* file:// may restrict history; the demo remains usable. */ }
  }
  function displayText(node, view) {
    text(node, view.value);
    attr(node, 'opacity', view.alpha);
  }
  function sampleForDisplay() {
    const sampled = M.sample(sequence, clock.t);
    const n = clock.t / M.STEP_SECONDS;
    if (clock.t > 0 && Math.abs(n - Math.round(n)) < 1e-7) {
      sampled.index = Math.min(sequence.steps.length - 1, Math.round(n) - 1);
      sampled.progress = 1;
      sampled.step = sequence.steps[sampled.index];
    }
    return sampled;
  }
  function render() {
    const sampled = sampleForDisplay();
    const { step, index, progress } = sampled;
    const view = C.frame(step, progress);
    const hints = C.hints(sequence, clock.t);
    text($('clock'), clock.t.toFixed(2));
    text($('phase'), step.label);
    text($('step-count'), `${clock.t === 0 ? 0 : index + 1} / ${sequence.steps.length}`);
    text($('play-state'), state.running ? '演示中' : clock.t >= sequence.duration ? '已完成' : '已暂停');
    text($('play'), state.running ? 'Ⅱ 暂停' : clock.t >= sequence.duration ? '↺ 重播' : '▶ 播放');
    document.body.dataset.playing = String(state.running);
    document.body.dataset.motion = state.reduced ? 'reduced' : 'full';
    $('prev').disabled = clock.t <= 0;
    $('next').disabled = clock.t >= sequence.duration;
    $('progress').value = clock.t;
    $('progress').setAttribute('aria-valuetext', `${clock.t.toFixed(1)} 秒，${step.label}`);
    text($('progress-time'), `${clock.t.toFixed(1)} / ${sequence.duration.toFixed(1)} s`);
    text($('caption-number'), String(index + 1).padStart(2, '0'));
    text($('caption'), step.caption);
    for (const [host, nodes] of Object.entries(hostViews)) {
      displayText(nodes.status, view.hosts[host]);
      nodes.status.style.fill = view.hosts[host].value.includes('丢弃') ? 'var(--red)' : 'var(--blue)';
      const location = step.before.packet.location;
      attr(nodes.focus, 'opacity', Math.max(location === host && step.type === 'travel' ? view.focus : 0,
        hints.route.target === host ? hints.route.arrival : 0));
    }
    displayText($('router-status'), view.router);
    $('router-status').style.fill = /已满|无法/.test(view.router.value) ? 'var(--red)' : 'var(--blue)';
    displayText($('server-status'), view.server);
    attr($('router-focus'), 'opacity', Math.max(!['travel', 'reply', 'newReply'].includes(step.type) ? view.focus : 0,
      hints.route.target === 'router' ? hints.route.arrival : 0));
    attr($('server-focus'), 'opacity', Math.max(['reply', 'newReply'].includes(step.type) || (step.type === 'travel' && step.before.packet.location === 'server') ? view.focus : 0,
      hints.route.target === 'server' ? hints.route.arrival : 0));
    attr($('active-route'), 'd', hints.route.points.map((point, i) => (i === 0 ? 'M' : 'L') + point.join(' ')).join(' '));
    attr($('active-route'), 'opacity', hints.route.alpha * .85);
    attr($('table-link'), 'opacity', step.type === 'pool' ? view.tableLink : 0);
    attr($('table-link'), 'stroke-dashoffset', 12 * (1 - C.win(progress, 0.08, 0.4)));
    for (const nodes of Object.values(rowViews)) attr(nodes.group, 'visibility', 'hidden');
    for (const row of view.rows) {
      const nodes = rowViews[row.host];
      attr(nodes.group, 'visibility', 'visible');
      attr(nodes.group, 'opacity', row.alpha);
      attr(nodes.group, 'transform', `translate(0 ${row.offset})`);
      attr(nodes.background, 'opacity', row.focus);
      attr(nodes.accent, 'opacity', row.focus);
      text(nodes.privateValue, row.privateIP + (state.mode === 'napt' ? ':' + row.privatePort : ''));
      text(nodes.publicIP, row.publicIP);
      text(nodes.publicPort, state.mode === 'napt' ? ':' + row.publicPort : '');
      const keyNode = state.mode === 'napt' ? nodes.publicPort : nodes.publicIP;
      for (const node of [nodes.publicIP, nodes.publicPort]) {
        node.style.fill = 'var(--ink)';
        node.style.fontWeight = '400';
        node.style.textDecoration = 'none';
      }
      keyNode.style.fill = `color-mix(in srgb, var(--ink), var(--blue) ${row.focus * 100}%)`;
      keyNode.style.fontWeight = row.focus > .5 ? '600' : '400';
      keyNode.style.textDecoration = row.focus > .5 ? 'underline' : 'none';
      text(nodes.key, state.mode === 'napt' ? 'TCP' : 'IP');
    }
    const initialRows = step.before.table.length;
    const finalRows = step.after.table.length;
    const count = view.count.value;
    const ips = state.mode === 'basic' ? count : Number(count) > 0 ? 1 : 0;
    text($('table-count'), `表项 ${count} · 公网 IP ${ips}/${state.mode === 'basic' ? 2 : 1}`);
    attr($('table-count'), 'opacity', view.count.alpha);
    $('table-count').style.fill = hints.panel && hints.panel.warning ? 'var(--red)' : 'var(--muted)';
    attr($('empty-table'), 'visibility', initialRows === 0 ? 'visible' : 'hidden');
    attr($('empty-table'), 'opacity', initialRows === 0 && finalRows > 0 ? 1 - C.win(progress, .18, .28) : 1);
    if (progress === 1 && finalRows > 0) attr($('empty-table'), 'visibility', 'hidden');
    attr($('packet'), 'transform', `translate(${view.packet.position[0]} ${view.packet.position[1]})`);
    attr($('packet'), 'opacity', view.packet.alpha);
    attr($('packet'), 'visibility', view.packet.alpha > 0 ? 'visible' : 'hidden');
    text($('packet-label'), `${view.packet.host} · ${view.packet.direction.value === 'out' ? '请求' : '响应'}`);
    attr($('packet-arrow'), 'transform', view.packet.direction.value === 'out' ? '' : 'translate(-63 0) scale(-1 1)');
    text($('packet-direction'), `TCP · ${view.packet.direction.value === 'out' ? '请求' : '响应'}`);
    $('packet-direction').style.opacity = view.packet.direction.alpha;
    const rewrite = step.type === 'snat' ? 'SNAT · 改写源' : step.type === 'dnat' ? '反向转换 · 还原目的' : step.type === 'lookup' ? (state.mode === 'napt' ? '目的 IP + TCP 端口查表' : '目的 IP 查表') : step.type === 'drop' ? '无可用映射 · 丢弃' : '源 → 目的';
    text($('rewrite-label'), rewrite);
    for (const key of fields) {
      const nodes = fieldViews[key];
      text(nodes.value, view.fields[key].value);
      nodes.value.style.opacity = view.fields[key].alpha;
      const focus = Math.max(view.fieldFocus[key], hints.fields[key]);
      nodes.box.style.borderLeftColor = `rgba(40,95,180,${.13 + focus * .87})`;
      nodes.box.style.backgroundColor = `rgba(40,95,180,${focus * .09})`;
      nodes.value.style.color = `color-mix(in srgb, var(--ink), var(--blue) ${focus * 100}%)`;
      const lookup = hints.panel && hints.panel.type === 'lookup';
      const completed = !hints.panel || hints.panel.type !== step.type || progress >= .68;
      text(nodes.cue, lookup ? '用于查表' : completed ? '已改写' : progress < .22 ? '即将改写' : '改写中');
      nodes.cue.style.opacity = hints.fields[key];
      nodes.cue.style.visibility = hints.fields[key] > 0 ? 'visible' : 'hidden';
      text(nodes.note, step.before.packet[key] !== step.after.packet[key] ? '改写前 ' + step.before.packet[key] : '保持不变');
    }
    const panel = hints.panel;
    attr($('visual-hint'), 'visibility', panel && panel.alpha > 0 ? 'visible' : 'hidden');
    attr($('visual-hint'), 'opacity', panel ? panel.alpha : 0);
    $('visual-hint').classList.toggle('warning', Boolean(panel && panel.warning));
    if (panel) {
      text($('hint-title'), panel.title);
      text($('hint-from'), panel.from);
      text($('hint-to'), panel.to);
      text($('hint-note'), panel.note);
    }
    const match = hints.match;
    const rowY = match && match.host === 'B' ? 439 : 399;
    attr($('match-link'), 'd', `M550 284V307H403V${rowY}H424`);
    attr($('match-link'), 'opacity', match ? match.alpha : 0);
    attr($('match-link'), 'stroke-dashoffset', match ? 1 - match.progress : 1);
    const warning = ['pool', 'drop'].includes(step.type);
    $('event-tag').classList.toggle('warning', warning);
    const tagAlpha = panel && panel.alpha > 0 ? 0 : view.tagAlpha;
    attr($('event-tag'), 'opacity', tagAlpha);
    attr($('event-tag'), 'visibility', tagAlpha > 0 ? 'visible' : 'hidden');
    attr($('event-tag'), 'transform', `translate(0 ${view.tagOffset})`);
    text($('event-label'), step.tag);
    for (const button of $('step-buttons').children) {
      const active = Number(button.dataset.index) === index;
      if (active) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    writeLink();
  }
  function clearPlayback() {
    if (timeline) timeline.kill();
    if (reducedDelay) reducedDelay.kill();
    timeline = reducedDelay = null;
    state.running = false;
  }
  function pause() {
    if (timeline) timeline.pause();
    if (reducedDelay) reducedDelay.pause();
    state.running = false;
    render();
    writeLink(true);
  }
  function boundary(direction) {
    const ratio = clock.t / M.STEP_SECONDS;
    const tick = direction > 0 ? Math.floor(ratio + 1e-7) + 1 : Math.ceil(ratio - 1e-7) - 1;
    return Math.max(0, Math.min(sequence.duration, tick * M.STEP_SECONDS));
  }
  function seek(t) {
    clearPlayback();
    clock.t = Math.max(0, Math.min(sequence.duration, Number(t) || 0));
    if (state.reduced) clock.t = Math.min(sequence.duration, Math.round(clock.t / M.STEP_SECONDS) * M.STEP_SECONDS);
    render();
    writeLink(true);
  }
  function start(target = sequence.duration) {
    clearPlayback();
    if (!window.gsap || target <= clock.t) return;
    state.running = true;
    if (state.reduced) {
      const advance = () => {
        clock.t = Math.min(target, boundary(1));
        if (clock.t >= target - 1e-7) {
          clock.t = target;
          state.running = false;
          reducedDelay = null;
          render();
          writeLink(true);
        } else {
          render();
          reducedDelay = window.gsap.delayedCall(.9, advance).timeScale(state.speed);
        }
      };
      reducedDelay = window.gsap.delayedCall(.9, advance).timeScale(state.speed);
    } else {
      timeline = window.gsap.timeline({ onUpdate: render, onComplete: () => {
        state.running = false;
        render();
        writeLink(true);
      } });
      timeline.to(clock, { t: target, duration: target - clock.t, ease: 'none' }).timeScale(state.speed);
    }
    render();
  }
  function togglePlay() {
    if (!window.gsap) return;
    if (state.running) { pause(); return; }
    if (clock.t >= sequence.duration) seek(0);
    if (timeline && timeline.progress() < 1) {
      state.running = true;
      timeline.play();
      render();
    } else if (reducedDelay) {
      state.running = true;
      reducedDelay.play();
      render();
    } else start();
  }
  function rebuild(keep = clock.t) {
    clearPlayback();
    sequence = M.buildScenario(state.mode, state.scenario);
    const showC = state.mode === 'basic' && state.scenario === 'special';
    attr(hostViews.C.group, 'visibility', showC ? 'visible' : 'hidden');
    attr($('lan-area'), 'height', showC ? 365 : 255);
    attr($('wire-c'), 'visibility', showC ? 'visible' : 'hidden');
    text($('router-mode'), state.mode === 'basic' ? 'NAT' : 'NAPT');
    text($('public-heading'), state.mode === 'basic' ? '公网地址' : '公网端点');
    text($('key-heading'), state.mode === 'basic' ? '依据' : '协议');
    const privateHeading = $('table-area').querySelector('.table-heading');
    text(privateHeading, state.mode === 'basic' ? '内网地址' : '内网端点');
    text($('scenario-b-label'), state.mode === 'basic' ? 'B 的独立地址' : 'B 的同端口复用');
    text($('scenario-special-label'), state.mode === 'basic' ? '公网地址池耗尽' : '双回包端口分流');
    document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)));
    document.querySelectorAll('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scenario === state.scenario)));
    $('progress').max = sequence.duration;
    $('step-buttons').replaceChildren();
    sequence.steps.forEach((step, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.index = index;
      button.textContent = String(index + 1).padStart(2, '0') + ' ' + step.label;
      button.setAttribute('aria-label', `定位到第 ${index + 1} 步末：${step.label}`);
      button.addEventListener('click', () => seek((index + 1) * M.STEP_SECONDS));
      $('step-buttons').appendChild(button);
    });
    seek(keep);
  }
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { state.mode = button.dataset.mode; rebuild(); }));
  document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => { state.scenario = button.dataset.scenario; rebuild(); }));
  $('play').addEventListener('click', togglePlay);
  $('prev').addEventListener('click', () => seek(boundary(-1)));
  $('next').addEventListener('click', () => {
    const target = boundary(1);
    if (state.reduced || !window.gsap) seek(target);
    else start(target);
  });
  $('reset').addEventListener('click', () => seek(0));
  $('progress').addEventListener('input', event => seek(event.target.value));
  $('speed').value = state.speed;
  $('speed').addEventListener('change', event => {
    state.speed = Number(event.target.value);
    if (timeline) timeline.timeScale(state.speed);
    if (reducedDelay) reducedDelay.timeScale(state.speed);
    writeLink(true);
  });
  function changeMotion(reduced) {
    const resume = state.running;
    clearPlayback();
    state.reduced = reduced;
    $('reduced').checked = reduced;
    if (reduced) clock.t = Math.min(sequence.duration, Math.ceil(clock.t / M.STEP_SECONDS) * M.STEP_SECONDS);
    render();
    if (resume) start();
    writeLink(true);
  }
  $('reduced').checked = state.reduced;
  $('reduced').addEventListener('change', event => { motionOverride = true; changeMotion(event.target.checked); });
  media.addEventListener('change', event => { if (!motionOverride) changeMotion(event.matches); });
  document.addEventListener('keydown', event => {
    if (event.target instanceof Element && event.target.closest('input, select, textarea, button, a, [contenteditable]')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const actions = { Space: togglePlay, ArrowLeft: () => $('prev').click(), ArrowRight: () => $('next').click(), Home: () => seek(0) };
    if (actions[event.code]) { event.preventDefault(); actions[event.code](); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => { writeLink(true); clearPlayback(); });
  if (!window.gsap) { $('play').disabled = true; $('engine-notice').hidden = false; }
  rebuild(Number(params.get('t')) || 0);
})();
