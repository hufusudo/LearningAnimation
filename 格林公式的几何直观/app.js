(function () {
  'use strict';
  const M = window.GreenModel, C = window.GreenChoreo;
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const color = { a: '#3264ac', b: '#a86b22', outer: '#2d7d62', faint: '#dadfd6' };
  const view = { x: 76, y: 66, s: 198 };
  const sx = x => view.x + x * view.s, sy = y => view.y + (2 - y) * view.s;
  const fmt = x => Math.abs(x) < 1e-9 ? '0' : Number(x.toFixed(4)).toString();
  const signed = x => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(4)}`;
  const name = id => id === 0 ? 'A' : id === 1 ? 'B' : `格 ${id + 1}`;
  function el(tag, attrs = {}, parent, content) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (content !== undefined) node.textContent = content;
    if (parent) parent.append(node);
    return node;
  }
  function text(parent, x, y, value, cls = '', attrs = {}) { return el('text', { x, y, class: cls, ...attrs }, parent, value); }
  function blend(a, b, p) {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const aa = rgb(a), bb = rgb(b);
    return `rgb(${aa.map((v, i) => Math.round(v + (bb[i] - v) * p)).join(',')})`;
  }
  function mathLine(parent, x, y, parts) {
    const node = text(parent, x, y, '', 'math');
    parts.forEach(part => {
      if (typeof part === 'string') node.append(document.createTextNode(part));
      else el('tspan', { 'baseline-shift': 'sub', 'font-size': 13 }, node, part.sub);
    });
    return node;
  }
  function put(node, value) { if (node.textContent !== value) node.textContent = value; }
  let tiling, seq, cells, edgeNodes, groups, panel, timeline, t = 0, playing = false;
  const clock = { t: 0 }, density = $('density'), reduced = $('reduce-motion');
  reduced.checked = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hash = new URLSearchParams(location.hash.slice(1));
  const initialN = [3, 6, 9].includes(Number(hash.get('n'))) ? Number(hash.get('n')) : 3;
  density.value = String(initialN);
  const initialTime = Math.max(0, Number(hash.get('t')) || 0);
  let lastHash = '';
  function save() {
    const value = `#n=${tiling.n}&t=${t.toFixed(2)}`;
    if (value === lastHash) return;
    try { history.replaceState(null, '', value); lastHash = value; } catch (_) { /* file 浏览器可限制 history；浏览不受影响。 */ }
  }
  function build() {
    if (timeline) timeline.kill();
    tiling = M.makeTiling(Number(density.value)); seq = C.sequence(tiling);
    const geometry = $('geometry'); geometry.replaceChildren();
    text(geometry, 76, 34, '区域 D · 宽 3，高 2', 'muted');
    text(geometry, 670, 34, '箭头 = 沿边积分方向', 'muted', { 'text-anchor': 'end' });
    el('rect', { x: sx(0), y: sy(2), width: 3 * view.s, height: 2 * view.s, fill: '#f6f8f3', stroke: '#bdc8bb', 'stroke-dasharray': '4 5' }, geometry);
    const fillLayer = el('g', {}, geometry), edgeLayer = el('g', {}, geometry), labelLayer = el('g', {}, geometry);
    cells = tiling.cells.map(cell => {
      const g = el('g', {}, fillLayer);
      el('rect', { x: sx(cell.x), y: sy(cell.y + cell.h), width: cell.h * view.s, height: cell.h * view.s,
        fill: cell.id === 1 ? '#fbf4e8' : '#edf3f9', stroke: 'none' }, g);
      const label = el('g', {}, labelLayer);
      const cx = sx(cell.x + cell.h / 2), cy = sy(cell.y + cell.h / 2);
      text(label, cx, cy - (tiling.n === 3 ? 7 : 2), name(cell.id), tiling.n === 3 ? 'big' : 'small', { 'text-anchor': 'middle' });
      if (tiling.n < 9) text(label, cx, cy + (tiling.n === 3 ? 23 : 16), fmt(cell.circulation), 'small mono', { 'text-anchor': 'middle', fill: '#5d655f' });
      return { g, label };
    });
    edgeNodes = new Map();
    function edgeNode(e, pairIndex) {
      const g = el('g', {}, edgeLayer), path = el('path', { fill: 'none', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, g);
      const arrow = el('path', { d: 'M-5 -4 L5 0 L-5 4 Z' }, g);
      const dot = el('circle', { r: 3.4, fill: '#fff', 'stroke-width': 1.7 }, g);
      const rec = { e, pairIndex, g, path, arrow, dot };
      edgeNodes.set(`${e.owner}/${e.key}`, rec); return rec;
    }
    tiling.boundary.forEach(e => edgeNode(e, -1));
    groups = tiling.internal.map(pair => {
      const a = pair.edges[0].a, b = pair.edges[0].b;
      const focus = el('line', { x1: sx(a.x), y1: sy(a.y), x2: sx(b.x), y2: sy(b.y), stroke: '#a86b22', 'stroke-width': 22, 'stroke-linecap': 'round', opacity: 0 }, edgeLayer);
      const nodes = pair.edges.map(e => edgeNode(e, pair.index));
      return { focus, nodes };
    });
    // tokens 存在于同一小格路径上；不表示向量场速度。
    cells.forEach(c => { c.token = el('circle', { r: 5, fill: '#343c38', stroke: '#fff', 'stroke-width': 2 }, labelLayer); });
    const hint = text(geometry, 76, 500, '黑点只是沿积分路径行走的标记，不表示场在流动。', 'muted');
    const callout = el('g', {}, labelLayer);
    const tagRect = el('rect', { width: 122, height: 29, rx: 5, fill: '#fff', stroke: '#c8d2c3' }, callout);
    text(callout, 61, 19, '同边反向', 'small', { 'text-anchor': 'middle' });
    const explanation = $('explanation'); explanation.replaceChildren();
    el('line', { x1: 724, y1: 58, x2: 724, y2: 470, stroke: '#e5e4dc' }, explanation);
    const local = el('g', {}, explanation), pair = el('g', {}, explanation), result = el('g', {}, explanation), formula = el('g', {}, explanation);
    text(local, 770, 95, '先看局部', 'overline');
    text(local, 770, 139, '一格的环流', 'big');
    text(local, 770, 186, '沿四条边的贡献相加', '');
    mathLine(local, 770, 233, ['∮', {sub:'∂小格'}, ` F·dr = ${fmt(tiling.h ** 2)}`]);
    text(local, 770, 284, `小格面积 ΔA = ${fmt(tiling.h ** 2)}`, 'small mono');
    text(local, 770, 318, '本例旋度恒为 1', '');
    text(local, 770, 346, '所以：小格环流 = 小格面积', 'small');
    text(local, 770, 409, '旋度是单位面积的局部环流密度。', 'muted');
    text(pair, 770, 95, '只看这一条公共边', 'overline');
    const pairTitle = text(pair, 770, 139, 'A 与 B', 'big');
    const valA = text(pair, 770, 198, '', 'math mono');
    const valB = text(pair, 770, 248, '', 'math mono');
    const sum = text(pair, 770, 306, '', 'math');
    el('line', { x1: 770, x2: 1060, y1: 269, y2: 269, stroke: '#d6dccf' }, pair);
    text(pair, 770, 365, '同一条边 · 同一个向量场', '');
    text(pair, 770, 396, '方向相反 → 积分等值反号', 'small');
    text(pair, 770, 437, '双线只是错开画，几何上是同一条边。', 'muted');
    text(result, 770, 95, '内部边归零以后', 'overline');
    text(result, 770, 139, '只剩外边界', 'big');
    text(result, 770, 198, '每条外边只属于一个小格，', '');
    text(result, 770, 226, '没有反向的一项与它配对。', '');
    text(result, 770, 288, 'Σ 小格环流', 'math');
    text(result, 770, 328, '= 外边界环流', 'math');
    text(result, 770, 373, `= ${fmt(tiling.total)}`, 'big mono', { fill: color.outer });
    text(result, 770, 432, '外圈原位留下，没有从内部搬过来。', 'muted');
    text(formula, 770, 95, '从局部到整体', 'overline');
    text(formula, 770, 139, '格林公式', 'big');
    mathLine(formula, 770, 194, ['∮', {sub:'∂D'}, ' (P dx + Q dy)']);
    mathLine(formula, 770, 237, ['= ∬', {sub:'D'}, ' (∂Q/∂x − ∂P/∂y) dA']);
    text(formula, 770, 285, '一般光滑场：', 'small');
    text(formula, 770, 316, '小格环流 ≈ 旋度 × ΔA', 'math');
    text(formula, 770, 347, '分块变细并取极限，得到上式。', 'small');
    text(formula, 770, 399, '本例旋度 = 1，区域面积 = 6', 'small');
    mathLine(formula, 770, 432, ['∮', {sub:'∂D'}, ' F·dr = ∬', {sub:'D'}, ' 1 dA = 6']);
    const condition = text(explanation, 770, 487, '条件：P、Q 在区域及邻域内连续可微。', 'muted');
    panel = { local, pair, result, formula, pairTitle, valA, valB, sum, hint, callout, tagRect, condition };
    $('steps').replaceChildren();
    seq.steps.forEach(step => {
      const b = document.createElement('button'); b.innerHTML = `<span>0${step.index + 1}</span>${step.name}`;
      b.addEventListener('click', () => seek(step.start)); $('steps').append(b);
    });
    if (window.gsap) {
      timeline = gsap.timeline({ paused: true, onUpdate: () => { t = clock.t; render(); }, onComplete: () => { playing = false; updateControls(); save(); } });
      clock.t = 0; timeline.to(clock, { t: seq.total, duration: seq.total, ease: 'none' });
      timeline.timeScale(Number($('speed').value));
    } else timeline = null;
    t = Math.min(t, seq.total);
  }
  function pointOnCell(cell, progress) {
    const pos = progress * 4, e = cell.edges[Math.floor(pos) % 4], k = pos % 1;
    return { x: sx(e.a.x + (e.b.x - e.a.x) * k), y: sy(e.a.y + (e.b.y - e.a.y) * k) };
  }
  function render() {
    const s = C.sample(tiling, seq, t, reduced.checked);
    document.body.classList.toggle('reduced', reduced.checked);
    cells.forEach((node, i) => {
      node.g.setAttribute('opacity', s.visible[i] * (1 - s.boundary));
      node.label.setAttribute('opacity', s.visible[i] * (1 - s.boundary));
      const tokenVisible = i < 2 && s.token !== null ? s.visible[i] * s.tokenAlpha : 0;
      node.token.setAttribute('opacity', tokenVisible);
      const pos = pointOnCell(tiling.cells[i], s.token === null ? 0 : s.token);
      node.token.setAttribute('cx', pos.x); node.token.setAttribute('cy', pos.y);
    });
    edgeNodes.forEach(({ e, pairIndex, g, path, arrow, dot }) => {
      const internal = pairIndex >= 0, k = internal ? s.cancel[pairIndex] : 0;
      const v = s.visible[e.owner] * (1 - k);
      g.setAttribute('opacity', v);
      const ax = sx(e.a.x), ay = sy(e.a.y), bx = sx(e.b.x), by = sy(e.b.y);
      const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
      // 屏幕坐标向下；路径右法线指向逆时针小格内部。
      const offset = internal ? 4.5 * (1 - k) : 0;
      const ox = dy / length * offset, oy = -dx / length * offset;
      const base = e.owner === 1 ? color.b : color.a;
      const ink = !internal ? blend(base, color.outer, s.boundary) : base;
      const line = `M${ax + ox} ${ay + oy}L${bx + ox} ${by + oy}`;
      path.setAttribute('d', line); path.setAttribute('stroke', ink);
      path.setAttribute('stroke-width', !internal ? 2.3 + 1.4 * s.boundary : 2.2);
      const ar = .58;
      arrow.setAttribute('transform', `translate(${ax + dx * ar + ox} ${ay + dy * ar + oy}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI})`);
      arrow.setAttribute('fill', ink);
      const active = s.active === pairIndex && internal;
      dot.setAttribute('opacity', active && !reduced.checked ? s.focus : 0);
      dot.setAttribute('cx', ax + dx * (.14 + .72 * s.motion) + ox);
      dot.setAttribute('cy', ay + dy * (.14 + .72 * s.motion) + oy);
      dot.setAttribute('stroke', ink);
    });
    groups.forEach((g, i) => g.focus.setAttribute('opacity', i === s.active ? .13 * s.focus : 0));
    const activePair = s.active >= 0 ? tiling.internal[s.active] : s.index === 3 && s.p < .12 ? tiling.internal[0] : null;
    panel.local.setAttribute('opacity', s.panels.local);
    panel.pair.setAttribute('opacity', s.panels.pair);
    panel.result.setAttribute('opacity', s.panels.result);
    panel.formula.setAttribute('opacity', s.panels.formula);
    panel.condition.setAttribute('opacity', s.formula);
    [panel.local, panel.pair, panel.result, panel.formula].forEach(node => node.setAttribute('aria-hidden', Number(node.getAttribute('opacity')) < .5));
    if (activePair) {
      const [a, b] = activePair.edges;
      put(panel.pairTitle, `${name(a.owner)} 与 ${name(b.owner)}`);
      put(panel.valA, `${name(a.owner)} : ${signed(a.value)}`);
      put(panel.valB, `${name(b.owner)} : ${signed(b.value)}`);
      panel.valA.setAttribute('fill', a.owner === 1 ? color.b : color.a);
      panel.valB.setAttribute('fill', b.owner === 1 ? color.b : color.a);
      put(panel.sum, s.cancel[activePair.index] >= 1 ? '相加 = 0' : 'Iₑ + (−Iₑ) = 0');
      const midX = sx((a.a.x + a.b.x) / 2);
      panel.callout.setAttribute('transform', `translate(${Math.min(548, Math.max(82, midX - 61))} ${Math.max(72, Math.min(sy(a.a.y), sy(a.b.y)) - 37)})`);
      panel.callout.setAttribute('opacity', s.focus);
      put(panel.callout.querySelector('text'), s.cancel[activePair.index] >= 1 ? '这一对归零' : '同边反向');
    } else {
      panel.callout.setAttribute('opacity', 0);
      panel.callout.setAttribute('transform', 'translate(0 0)');
      put(panel.callout.querySelector('text'), '同边反向');
    }
    const hint = s.index < 1 ? '黑点只是沿积分路径行走的标记，不表示场在流动。' : s.index < 5 ? '两条错开的有向线，表示同一条公共边的两次遍历。' : '所有内部边都成对归零，外边界仍在原来的位置。';
    put(panel.hint, hint);
    const ts = seq.steps[s.textIndex];
    put($('phase'), ts.name); $('phase').style.opacity = s.textAlpha;
    put($('note'), s.fast ? '剩余公共边按同样规则快速抵消，外边界原位保留。' : ts.note); $('note').style.opacity = s.textAlpha;
    put($('note-index'), `0${s.textIndex + 1}`);
    put($('time'), `${t.toFixed(1)} s`); put($('count'), `${s.cancelled} / ${tiling.internal.length} 对`);
    put($('local-value'), `单格环流 ${fmt(tiling.h ** 2)} × ${tiling.cells.length} 格`);
    put($('relation-text'), s.index < 5 ? `局部环流总和 = ${fmt(tiling.total)} · 外边界的位置保持不变` : `Σ 小格环流 = 外边界环流 = ${fmt(tiling.outer)}`);
    put($('sum-value'), s.index < 6 ? '旋度 = 1' : '∬D 旋度 dA = 6');
    $('timeline').value = Math.round(t / seq.total * 10000);
    $('timeline').setAttribute('aria-valuetext', `${t.toFixed(1)} 秒，${seq.steps[s.index].name}`);
    put($('duration'), `${t.toFixed(1)} / ${seq.total.toFixed(1)} s`);
    [...$('steps').children].forEach((b, i) => { if (i === s.index) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    $('prev').disabled = t <= 0; $('next').disabled = t >= seq.total;
    // 值不变不写 DOM；无隐藏回调影响任意时刻重绘。
  }
  function updateControls() {
    put($('play'), playing ? '暂停' : t >= seq.total ? '重播' : '播放');
    $('play').dataset.playing = String(playing);
    $('play').disabled = !timeline || reduced.checked;
    $('status-light').classList.toggle('running', playing);
    const notice = !timeline ? '动画引擎未加载：可用上一步、下一步、阶段与进度条查看全部状态。' : reduced.checked ? '减少动态效果：显示当前步骤的完整结果，用下一步逐条检查公共边。' : '';
    $('notice').hidden = !notice; put($('notice'), notice);
  }
  function pause() { playing = false; if (timeline) timeline.pause(); updateControls(); }
  function seek(value) {
    pause(); t = Math.max(0, Math.min(seq.total, value)); clock.t = t;
    if (timeline) timeline.time(t, true);
    render(); updateControls(); save();
  }
  function toggle() {
    if (!timeline || reduced.checked) return;
    if (playing) { pause(); save(); return; }
    if (t >= seq.total) seek(0);
    playing = true; updateControls(); timeline.play();
  }
  function next() {
    const event = seq.events.find(e => e > t + .001);
    seek(event === undefined ? seq.total : event);
  }
  function prev() {
    const event = seq.events.filter(e => e < t - .001).at(-1);
    seek(event === undefined ? 0 : event);
  }
  $('play').addEventListener('click', toggle); $('restart').addEventListener('click', () => seek(0));
  $('prev').addEventListener('click', prev); $('next').addEventListener('click', next);
  $('timeline').addEventListener('input', e => seek(Number(e.target.value) / 10000 * seq.total));
  $('speed').addEventListener('change', e => { if (timeline) timeline.timeScale(Number(e.target.value)); });
  density.addEventListener('change', () => { pause(); build(); seek(t); });
  reduced.addEventListener('change', () => { pause(); render(); updateControls(); });
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea,button,a') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    if (e.code === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.code === 'ArrowLeft') { e.preventDefault(); prev(); }
    if (e.code === 'Home') { e.preventDefault(); seek(0); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); save(); } });
  window.addEventListener('hashchange', () => {
    const p = new URLSearchParams(location.hash.slice(1)); const n = Number(p.get('n'));
    if ([3, 6, 9].includes(n) && n !== tiling.n) { pause(); density.value = String(n); build(); }
    seek(Number(p.get('t')) || 0);
  });
  window.addEventListener('pagehide', () => { pause(); if (timeline) timeline.kill(); });
  build(); seek(initialTime);
})();
