/* 画面由时刻直接采样。GSAP 只推进时钟，不在回调中修改盘块状态。 */
(() => {
  'use strict';
  const M = window.GroupedFreeModel;
  const NS = 'http://www.w3.org/2000/svg';
  const EPS = 1e-5;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const text = (node, value) => {
    const str = String(value);
    if (node.textContent !== str) node.textContent = str;
  };
  const attr = (node, key, value) => {
    const str = String(value);
    if (node.getAttribute(key) !== str) node.setAttribute(key, str);
  };
  const show = (node, visible) => attr(node, 'visibility', visible ? 'inherit' : 'hidden');
  function svg(tag, values = {}, parent = $('sand')) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(values)) node.setAttribute(key, value);
    parent.appendChild(node);
    return node;
  }
  function label(value, x, y, cls, parent) {
    const node = svg('text', { x, y, class: cls }, parent);
    text(node, value);
    return node;
  }

  const demo = M.buildDemo();
  const ops = demo.operations;
  const phases = [];
  let duration = 0;
  function add(op, key, length, name, caption, tag, warning = false) {
    phases.push({ op, key, start: duration, end: duration + length, name, caption, tag, warning });
    duration += length;
  }
  for (const op of ops) {
    op.start = duration;
    if (op.kind === 'allocate-pop') {
      add(op, 'select', .6, '查看栈顶', `栈顶是 ${op.id}，分配它不必访问外存。`, '只动内存');
      add(op, 'transfer', 1.1, '弹出盘块号', `弹出 ${op.id}，把对应盘块交给进程。`, '栈顶弹出');
      add(op, 'settled', .6, '分配完成', `${op.id} 已分配，count 从 ${op.before.memory.count} 减为 ${op.after.memory.count}。`, 'count − 1');
    } else if (op.kind === 'allocate-group') {
      add(op, 'select', .8, '只剩组入口', `count = 1，只剩指向盘块 ${op.id} 的组入口。`, '只剩入口', true);
      add(op, 'read', 1.6, '读入下一组', `先读出 ${op.id} 中的整组信息，补充内存地址栈。`, '先读组信息');
      add(op, 'deliver', 1.1, '分配组载体', `组信息已读入内存，现在才能分配盘块 ${op.id}。`, '再分配此块');
      add(op, 'settled', .7, '换组完成', `内存已接管下一组，盘块 ${op.id} 本身也已分配。`, '整组已读入');
    } else if (op.kind === 'reclaim-spill') {
      add(op, 'select', .8, '回收遇到满栈', `回收 ${op.id} 时，内存地址栈已满。`, '内存栈已满', true);
      add(op, 'receive', .8, '接收回收盘块', `先接收盘块 ${op.id}，用它存放满栈的组信息。`, '作为组载体');
      add(op, 'write', 1.5, '整栈写回外存', `把整栈写入 ${op.id}，原 next = ${op.before.memory.next} 也一并保留。`, '整栈写入');
      add(op, 'link', 1.1, '更新内存入口', `内存只留 next = ${op.id}，新组接在原链之前。`, '新块成为入口');
      add(op, 'settled', .7, '写回完成', `${op.id} 保存了一组地址，并继续指向原来的下一组。`, '原链保持不变');
    } else {
      add(op, 'select', .6, '查看剩余槽位', `回收 ${op.id}，内存还有空槽，不必写外存。`, '内存仍有空位');
      add(op, 'transfer', 1.1, '压入盘块号', `把盘块号 ${op.id} 压入栈顶，盘块本身仍在外存。`, '压入栈顶');
      add(op, 'settled', .6, '回收完成', `${op.id} 已回收，count 从 ${op.before.memory.count} 加为 ${op.after.memory.count}。`, 'count + 1');
    }
    op.end = duration;
  }
  const boundaries = [...phases.map((p) => p.start), duration];
  function sample(time) {
    const t = clamp(Number.isFinite(time) ? time : 0, 0, duration);
    const phase = phases.find((p) => t < p.end - EPS) || phases[phases.length - 1];
    return { t, phase, op: phase.op, p: clamp((t - phase.start) / (phase.end - phase.start), 0, 1) };
  }

  const els = {
    stage: $('stage'), clock: $('clock'), phase: $('phase'), caption: $('caption'), counts: $('counts'),
    play: $('play'), playSymbol: $('play-symbol'), playLabel: $('play-label'), previous: $('previous'), next: $('next'),
    progress: $('progress'), progressCaption: $('progress-caption'), speed: $('speed'), motion: $('reduce-motion')
  };
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = { t: 0, speed: 1, reduced: query.matches, running: false, mode: null, stepTarget: null, tl: null, glide: null, delay: null, lastLink: 0 };
  const refs = { slots: [], groups: new Map(), blocks: new Map(), opButtons: [], wires: [] };
  const groupX = new Map([[100, 400], [90, 640], [80, 880]]);
  const blockOrder = [103, 102, 101, 100];
  const poolCenter = (id) => ({ x: 458 + blockOrder.indexOf(id) * 68, y: 383 });
  const memoryCenter = (s, reclaim = false) => ({ x: 213, y: 129 + (3 - s.memory.free.length - (reclaim ? 1 : 0)) * 40 });
  const carrierCenter = (id) => ({ x: groupX.get(id) + 148, y: 124 });
  const readPoints = [{ x: 492, y: 203 }, { x: 492, y: 76 }, { x: 155, y: 76 }, { x: 155, y: 197 }];

  function path(points) { return points.map((pt, i) => `${i ? 'L' : 'M'} ${pt.x} ${pt.y}`).join(' '); }
  function along(points, p) {
    const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.y - points[i].y));
    let distance = lengths.reduce((sum, n) => sum + n, 0) * p;
    for (let i = 0; i < lengths.length; i++) {
      if (distance <= lengths[i] || i === lengths.length - 1) {
        const f = lengths[i] ? clamp(distance / lengths[i], 0, 1) : 1;
        return { x: points[i].x + (points[i + 1].x - points[i].x) * f, y: points[i].y + (points[i + 1].y - points[i].y) * f };
      }
      distance -= lengths[i];
    }
    return points[0];
  }

  function makeStage() {
    const defs = svg('defs');
    for (const [id, color] of [['chain-arrow', '#a48d58'], ['action-arrow', '#2563eb']]) {
      const marker = svg('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' }, defs);
      svg('path', { d: 'M 1 1 L 9 5 L 1 9', fill: 'none', stroke: color, 'stroke-width': 1.5 }, marker);
    }
    label('内存 · 空闲地址栈', 50, 29, 'zone-name');
    label('count', 50, 54, 'zone-sub mono');
    refs.count = label('4', 105, 56, 'stack-count');
    label('/ 4', 126, 54, 'count-suffix');
    refs.trend = label('', 176, 54, 'count-trend');
    label('外存 · 组信息链', 400, 29, 'zone-name');
    label('组载体本身也是空闲盘块', 400, 49, 'zone-sub');
    label('地址按栈顶顺序显示', 1064, 29, 'zone-sub').setAttribute('text-anchor', 'end');

    svg('rect', { x: 50, y: 100, width: 210, height: 200, rx: 12, class: 'stack-body' });
    for (let i = 0; i < 3; i++) {
      const g = svg('g');
      const rect = svg('rect', { x: 64, y: 114 + i * 40, width: 182, height: 30, rx: 5, class: 'slot' }, g);
      const caption = label('', 76, 133 + i * 40, 'slot-label', g);
      const number = label('', 231, 135 + i * 40, 'slot-number', g);
      refs.slots.push({ g, rect, caption, number });
    }
    refs.nextRect = svg('rect', { x: 64, y: 254, width: 182, height: 30, rx: 5, class: 'slot next-slot' });
    label('next', 76, 274, 'slot-label mono');
    refs.nextNumber = label('100', 231, 275, 'slot-number next-number');
    refs.stackNote = label('底槽 · 指向下一组', 50, 323, 'zone-sub');

    for (const [id, x] of groupX) {
      const g = svg('g', { 'data-carrier': id });
      const rect = svg('rect', { x, y: 100, width: 184, height: 200, rx: 10, class: 'carrier-body' }, g);
      label('盘块', x + 14, 129, 'carrier-title', g);
      const idLabel = label(id, x + 168, 131, 'carrier-id', g);
      const contents = svg('g', {}, g);
      svg('line', { x1: x + 14, y1: 143, x2: x + 170, y2: 143, class: 'carrier-rule' }, contents);
      const count = label('', x + 16, 164, 'carrier-count', contents);
      const entries = [];
      for (let i = 0; i < 3; i++) {
        const box = svg('rect', { x: x + 14, y: 177 + i * 23, width: 156, height: 19, rx: 3, class: 'group-slot' }, contents);
        const value = label('', x + 92, 191 + i * 23, 'group-number', contents);
        entries.push({ box, value });
      }
      svg('rect', { x: x + 14, y: 254, width: 156, height: 30, rx: 4, class: 'group-next' }, contents);
      label('next', x + 25, 274, 'group-next-label', contents);
      const next = label('', x + 158, 274, 'group-next-number', contents);
      const empty = label('', x + 92, 214, 'vacant-copy', g);
      refs.groups.set(id, { g, rect, idLabel, contents, count, entries, next, empty });
    }
    refs.wires.push(svg('path', { class: 'chain-wire' }));
    refs.wires.push(svg('path', { class: 'chain-wire' }));
    refs.wires.push(svg('path', { class: 'chain-wire' }));

    label('已分配给进程', 400, 344, 'zone-name');
    label('这里只显示本次分配的盘块', 1064, 344, 'zone-sub').setAttribute('text-anchor', 'end');
    svg('line', { x1: 400, y1: 355, x2: 1064, y2: 355, class: 'pool-rule' });
    refs.poolEmpty = label('暂未分配盘块', 431, 388, 'pool-empty');
    for (const id of blockOrder) {
      const { x, y } = poolCenter(id);
      const g = svg('g', { 'data-occupied': id });
      const rect = svg('rect', { x: x - 27, y: y - 18, width: 54, height: 36, rx: 6, class: 'block-body' }, g);
      label(id, x, y, 'block-number', g);
      refs.blocks.set(id, { g, rect });
    }
    refs.tag = svg('g', { class: 'tag' });
    svg('line', { x1: 0, y1: -10, x2: 0, y2: 4 }, refs.tag);
    refs.tagText = label('', 10, 0, '', refs.tag);

    refs.route = svg('path', { class: 'transfer-route' });
    refs.packet = svg('g');
    svg('rect', { x: -88, y: -27, width: 176, height: 54, rx: 7, class: 'packet-body' }, refs.packet);
    refs.packetHeading = label('', 0, -7, 'packet-heading', refs.packet);
    refs.packetValues = label('', 0, 15, 'packet-values', refs.packet);
    refs.flight = svg('g');
    svg('rect', { x: -27, y: -18, width: 54, height: 36, rx: 6, class: 'flight-body' }, refs.flight);
    refs.flightNumber = label('', 0, 0, 'flight-number', refs.flight);
  }

  function drawMemory(s, snap) {
    const { op, phase } = snap;
    const moving = phase.key === 'transfer';
    const selected = op.kind === 'allocate-pop' && phase.key !== 'settled';
    const pushTarget = op.kind === 'reclaim-push' && phase.key !== 'settled';
    const offset = 3 - s.memory.free.length;
    text(refs.count, s.memory.count);
    const trend = (selected || pushTarget) ? `→ ${op.after.memory.count}` : '';
    text(refs.trend, trend);
    refs.slots.forEach((slot, i) => {
      const hasValue = i >= offset;
      // free 按栈底→栈顶存储；槽位在图中按栈顶→栈底排列。
      const number = hasValue ? s.memory.free[2 - i] : null;
      const isTop = i === offset && hasValue;
      const active = (selected && isTop) || (pushTarget && i === offset - 1);
      attr(slot.rect, 'class', `slot${hasValue ? '' : ' is-empty'}${active ? ' is-active' : ''}`);
      text(slot.caption, active && pushTarget ? '压入此槽' : (isTop ? '栈顶' : (hasValue ? '空闲地址' : '空槽')));
      text(slot.number, hasValue ? number : '—');
      attr(slot.number, 'class', `slot-number${active ? ' is-active' : ''}`);
      attr(slot.number, 'opacity', moving && selected && isTop ? 0 : 1);
    });
    const nextActive = op.kind === 'allocate-group' && ['select', 'read'].includes(phase.key) || op.kind === 'reclaim-spill' && phase.key === 'link';
    attr(refs.nextRect, 'class', `slot next-slot${nextActive ? ' is-active' : ''}`);
    text(refs.nextNumber, s.memory.next === null ? 'null' : s.memory.next);
    text(refs.stackNote, s.memory.count === 1 ? '只剩底槽 · 先沿 next 读组' : '底槽 · 指向下一组');
  }

  function drawGroups(s, snap) {
    const { op, phase, p } = snap;
    for (const [id, ref] of refs.groups) {
      const data = s.groups[id];
      const incoming = op.kind === 'reclaim-spill' && id === op.id && ['receive', 'write'].includes(phase.key);
      const active = id === op.id && ['read', 'write', 'receive', 'link', 'deliver'].includes(phase.key);
      const vacant = !data;
      attr(ref.rect, 'class', `carrier-body${vacant && !incoming ? ' is-vacant' : ''}${active ? ' is-active' : ''}`);
      show(ref.contents, !!data);
      show(ref.empty, !data);
      let emptyLabel = '已分配';
      if (op.kind === 'allocate-group' && phase.key === 'deliver' && id === op.id) emptyLabel = '组信息已读走';
      if (incoming) emptyLabel = phase.key === 'write' ? '正在接收组信息' : '准备存放整组';
      text(ref.empty, emptyLabel);
      attr(ref.idLabel, 'opacity', phase.key === 'deliver' && id === op.id ? 0 : 1);
      if (incoming && phase.key === 'receive') attr(ref.rect, 'opacity', .3 + .7 * p);
      else attr(ref.rect, 'opacity', 1);
      if (data) {
        text(ref.count, `count  ${data.count} / 4`);
        text(ref.next, data.next === null ? 'null' : data.next);
        ref.entries.forEach((entry, i) => {
          const value = data.free.slice().reverse()[i];
          show(entry.box, value !== undefined);
          show(entry.value, value !== undefined);
          text(entry.value, value ?? '');
        });
        if (!data.free.length) {
          show(ref.empty, true);
          text(ref.empty, '末组 · 无其他地址');
        }
      }
    }
    const chain = M.chain(s);
    refs.wires.forEach((wire, i) => {
      const item = chain[i];
      show(wire, !!item);
      if (!item) return;
      const x = groupX.get(item.id);
      let points;
      if (i === 0) {
        points = item.id === 100
          ? [{ x: 246, y: 269 }, { x, y: 269 }]
          : [{ x: 246, y: 269 }, { x: 316, y: 269 }, { x: 316, y: 314 }, { x: x - 28, y: 314 }, { x: x - 28, y: 269 }, { x, y: 269 }];
      } else {
        const from = groupX.get(chain[i - 1].id);
        points = [{ x: from + 170, y: 269 }, { x, y: 269 }];
      }
      attr(wire, 'd', path(points));
      const live = i === 0 && ((op.kind === 'allocate-group' && ['select', 'read'].includes(phase.key)) || phase.key === 'link');
      attr(wire, 'class', `chain-wire${live ? ' is-active' : ''}`);
      // 更新入口时只绘制新连线；不移动原链上的其他节点。
      attr(wire, 'pathLength', 1);
      attr(wire, 'stroke-dasharray', phase.key === 'link' && i === 0 ? '1 1' : 'none');
      attr(wire, 'stroke-dashoffset', phase.key === 'link' && i === 0 && !state.reduced ? 1 - p : 0);
      attr(wire, 'style', phase.key === 'link' && i === 0 && p < .98 && !state.reduced ? 'marker-end: none' : '');
    });
  }

  function drawPool(s, snap) {
    const { op, phase } = snap;
    const hideSource = ['transfer', 'receive', 'write'].includes(phase.key) && op.action === 'reclaim';
    for (const [id, ref] of refs.blocks) {
      show(ref.g, s.occupied.includes(id) && !(hideSource && id === op.id));
      attr(ref.rect, 'class', `block-body${id === op.id && phase.key === 'select' && op.action === 'reclaim' ? ' is-active' : ''}`);
    }
    show(refs.poolEmpty, !s.occupied.length);
  }

  function drawMotion(snap) {
    const { op, phase, p } = snap;
    let route = null;
    let packet = false;
    if (phase.key === 'read' || phase.key === 'write') {
      packet = true;
      route = phase.key === 'read' ? readPoints : readPoints.slice().reverse();
      const source = phase.key === 'read' ? op.before.groups[op.id] : op.before.memory;
      text(refs.packetHeading, `count ${source.count}  ·  next ${source.next ?? 'null'}`);
      text(refs.packetValues, source.free.slice().reverse().join('   ') || '无其他地址');
    } else if (phase.key === 'transfer') {
      const isPop = op.kind === 'allocate-pop';
      const mem = memoryCenter(op.before, !isPop);
      const pool = poolCenter(op.id);
      const points = [mem, { x: 312, y: mem.y }, { x: 312, y: pool.y }, pool];
      route = isPop ? points : points.slice().reverse();
    } else if (phase.key === 'deliver' || phase.key === 'receive') {
      const disk = carrierCenter(op.id);
      const pool = poolCenter(op.id);
      const points = [disk, { x: disk.x, y: 323 }, { x: pool.x, y: 323 }, pool];
      route = phase.key === 'deliver' ? points : points.slice().reverse();
    }
    show(refs.route, !!route);
    show(refs.packet, !!route && packet);
    show(refs.flight, !!route && !packet);
    if (route) {
      attr(refs.route, 'd', path(route));
      // 减少动效只显示静态交接位置，不播放对象沿路径移动的补间。
      const position = state.reduced ? (packet ? { x: 323, y: 76 } : route[route.length - 1]) : along(route, p);
      const moving = packet ? refs.packet : refs.flight;
      attr(moving, 'transform', `translate(${position.x.toFixed(2)} ${position.y.toFixed(2)})`);
      text(refs.flightNumber, op.id);
    }
    // 浮标放在内存下方，避开读写通道和已分配盘块。
    let tagValue = phase.tag;
    if (snap.t >= duration - EPS) tagValue = '回到初始状态';
    text(refs.tagText, tagValue);
    attr(refs.tag, 'class', `tag${phase.warning ? ' is-warning' : ''}`);
    attr(refs.tag, 'transform', 'translate(52 363)');
    attr(refs.tag, 'opacity', phase.key === 'settled' ? 1 : .85 + .15 * Math.min(1, p * 4));
  }

  function makeRail() {
    ops.forEach((op) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'op-button';
      button.dataset.operation = op.index;
      button.title = `定位到${op.action === 'allocate' ? '分配' : '回收'} ${op.id} 并暂停`;
      const title = document.createElement('span');
      title.className = 'op-title';
      title.textContent = `${op.action === 'allocate' ? '分配' : '回收'} ${op.id}`;
      const note = document.createElement('span');
      note.className = 'op-note';
      note.textContent = ({ 'allocate-pop': '栈顶弹出', 'allocate-group': '读入下一组', 'reclaim-spill': '满栈写回', 'reclaim-push': '压入栈顶' })[op.kind];
      const fill = document.createElement('i');
      fill.className = 'op-fill';
      fill.setAttribute('aria-hidden', 'true');
      button.append(title, note, fill);
      button.addEventListener('click', () => seek(op.start));
      $('operations').appendChild(button);
      refs.opButtons.push({ button, fill });
    });
  }

  function render(time) {
    const snap = sample(time);
    state.t = snap.t;
    const { op, phase } = snap;
    const committed = phase.key === 'settled' || phase.key === 'link';
    let visual = committed ? op.after : op.before;
    // 读组先于载体交付：内存先接管元数据，原载体只剩待交付的外壳。
    if (phase.key === 'deliver') visual = { ...op.after, occupied: op.before.occupied };
    drawMemory(visual, snap);
    drawGroups(visual, snap);
    drawPool(visual, snap);
    drawMotion(snap);
    const countState = committed ? op.after : op.before;
    text(els.clock, state.t.toFixed(1));
    text(els.phase, state.t >= duration - EPS ? '回收完成' : phase.name);
    text(els.caption, state.t >= duration - EPS ? '四块盘块全部回收，内存栈和外存组链恢复初态。' : phase.caption);
    text(els.counts, `空闲 ${M.freeBlocks(countState).length} 块 · 已分配 ${countState.occupied.length} 块`);
    const addresses = visual.memory.free.slice().reverse().join('、') || '无';
    const chain = M.chain(visual).map(({ id, data }) => `盘块 ${id}：count ${data.count}，地址 ${data.free.slice().reverse().join('、') || '无'}，next ${data.next ?? 'null'}`).join('；') || '空';
    text($('accessible-state'), `内存：count ${visual.memory.count}，栈顶到栈底的普通地址为 ${addresses}，next ${visual.memory.next ?? 'null'}。外存链：${chain}。已分配：${visual.occupied.join('、') || '无'}。`);
    attr(els.stage, 'data-time', state.t.toFixed(3));
    attr(els.stage, 'data-phase', `${op.kind}:${phase.key}`);
    els.progress.value = state.t.toFixed(2);
    text(els.progressCaption, `t ${state.t.toFixed(1)} / ${duration.toFixed(1)}`);
    const reclaim = op.action === 'reclaim';
    attr($('chapter-allocate'), 'aria-pressed', !reclaim);
    attr($('chapter-reclaim'), 'aria-pressed', reclaim);
    refs.opButtons.forEach(({ button, fill }, index) => {
      attr(button, 'aria-current', index === op.index ? 'step' : 'false');
      button.classList.toggle('is-past', index < op.index);
      const progress = index === op.index ? clamp((state.t - op.start) / (op.end - op.start), 0, 1) : 0;
      fill.style.transform = `scaleX(${progress})`;
    });
    updateControls();
    syncLink();
  }

  function updateControls() {
    els.stage.classList.toggle('is-running', state.running);
    els.previous.disabled = state.t <= EPS;
    els.next.disabled = state.t >= duration - EPS;
    els.play.disabled = !state.tl;
    text(els.playSymbol, state.running ? 'Ⅱ' : '▶');
    text(els.playLabel, state.running ? '暂停' : (state.t >= duration - EPS ? '再播放' : '播放'));
    attr(els.play, 'aria-label', state.running ? '暂停动画' : '播放动画');
  }

  function syncLink(force = false) {
    const now = performance.now();
    if (!force && now - state.lastLink < 300) return;
    state.lastLink = now;
    const params = new URLSearchParams({ t: state.t.toFixed(2), speed: state.speed, motion: state.reduced ? 'reduce' : 'full' });
    try { history.replaceState(null, '', `#${params}`); } catch { /* file:// 的受限环境仍可查看动画。 */ }
  }
  function stopAuxiliary() {
    if (state.glide) state.glide.kill();
    if (state.delay) state.delay.kill();
    state.glide = null;
    state.delay = null;
  }
  function pause() {
    state.running = false;
    state.tl?.pause();
    state.glide?.pause();
    state.delay?.pause();
    updateControls();
    syncLink(true);
  }
  function seek(time) {
    pause();
    stopAuxiliary();
    state.mode = null;
    state.stepTarget = null;
    const target = clamp(time, 0, duration);
    state.tl?.time(target, true);
    render(target);
    syncLink(true);
  }
  function finish() {
    state.running = false;
    state.mode = null;
    state.stepTarget = null;
    stopAuxiliary();
    updateControls();
    syncLink(true);
  }
  function nextBoundary() { return boundaries.find((t) => t > state.t + EPS) ?? duration; }
  function previousBoundary() { return boundaries.findLast((t) => t < state.t - EPS) ?? 0; }
  function scheduleReduced() {
    state.delay = window.gsap.delayedCall(.9, () => {
      state.delay = null;
      const target = nextBoundary();
      state.tl.time(target, true);
      render(target);
      if (target >= duration - EPS) finish();
      else scheduleReduced();
    }).timeScale(state.speed);
  }
  function play() {
    if (!state.tl) return;
    if (state.t >= duration - EPS) seek(0);
    if (state.mode === 'step' && state.stepTarget !== null && !state.glide) {
      animateStep(state.stepTarget);
      return;
    }
    state.running = true;
    if (state.glide) state.glide.resume();
    else if (state.delay) state.delay.resume();
    else {
      state.mode = 'auto';
      if (state.reduced) scheduleReduced();
      else state.tl.time(state.t, true).play();
    }
    updateControls();
  }
  function step(direction) {
    const dest = direction > 0 ? nextBoundary() : previousBoundary();
    seek(state.t);
    animateStep(dest);
  }
  function animateStep(dest) {
    if (!window.gsap || state.reduced || Math.abs(dest - state.t) < EPS) { seek(dest); return; }
    const clock = { t: state.t };
    state.mode = 'step';
    state.stepTarget = dest;
    state.running = true;
    state.glide = window.gsap.to(clock, {
      t: dest, duration: clamp(Math.abs(dest - state.t), .3, 1.1), ease: 'none',
      onUpdate: () => render(clock.t),
      onComplete: () => {
        state.glide = null;
        state.tl.time(dest, true);
        render(dest);
        finish();
      }
    }).timeScale(state.speed);
    updateControls();
  }
  function applyMotion(reduced) {
    const wasRunning = state.running;
    const stepTarget = state.mode === 'step' ? state.stepTarget : null;
    seek(state.t);
    state.reduced = reduced;
    els.motion.checked = reduced;
    document.body.dataset.motion = reduced ? 'reduce' : 'full';
    // 暂停中的单步仍保留原目标；减少动效只改变呈现，不改变播放范围。
    if (stepTarget !== null) {
      state.mode = 'step';
      state.stepTarget = stepTarget;
    }
    render(state.t);
    if (wasRunning) play();
    syncLink(true);
  }

  function bind() {
    els.play.addEventListener('click', () => state.running ? pause() : play());
    els.next.addEventListener('click', () => step(1));
    els.previous.addEventListener('click', () => step(-1));
    $('reset').addEventListener('click', () => seek(0));
    $('chapter-allocate').addEventListener('click', () => seek(0));
    $('chapter-reclaim').addEventListener('click', () => seek(ops[4].start));
    els.progress.addEventListener('pointerdown', pause);
    els.progress.addEventListener('input', () => seek(Number(els.progress.value)));
    els.speed.addEventListener('change', () => {
      state.speed = Number(els.speed.value);
      for (const animation of [state.tl, state.glide, state.delay]) animation?.timeScale(state.speed);
      syncLink(true);
    });
    els.motion.addEventListener('change', () => applyMotion(els.motion.checked));
    query.addEventListener('change', (event) => applyMotion(event.matches));
    document.addEventListener('keydown', (event) => {
      if (event.target instanceof Element && event.target.closest('input, select, textarea, button, a')) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
      if (event.code === 'Space') { event.preventDefault(); state.running ? pause() : play(); }
      if (event.code === 'ArrowRight') { event.preventDefault(); step(1); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); step(-1); }
      if (event.code === 'Home') { event.preventDefault(); seek(0); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    window.addEventListener('pagehide', () => { pause(); stopAuxiliary(); });
  }

  function init() {
    const link = new URLSearchParams(location.hash.slice(1));
    const speed = Number(link.get('speed'));
    if ([.5, 1, 1.5, 2].includes(speed)) state.speed = speed;
    if (['full', 'reduce'].includes(link.get('motion'))) state.reduced = link.get('motion') === 'reduce';
    els.speed.value = String(state.speed);
    els.motion.checked = state.reduced;
    document.body.dataset.motion = state.reduced ? 'reduce' : 'full';
    makeStage();
    makeRail();
    els.progress.max = String(duration);
    if (window.gsap) {
      state.tl = window.gsap.timeline({
        paused: true,
        onUpdate: () => render(state.tl.time()),
        onComplete: finish
      });
      state.tl.to({}, { duration, ease: 'none' }).timeScale(state.speed);
    } else $('dependency-notice').hidden = false;
    bind();
    const time = Number(link.get('t'));
    seek(Number.isFinite(time) ? time : 0);
  }
  init();
})();
