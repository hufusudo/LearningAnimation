(() => {
  'use strict';
  const M = window.AllocationModel;
  const $ = id => document.getElementById(id);
  const names = { contiguous: '连续分配', implicit: '隐式链接', fat: '显式链接 FAT', indexed: '索引分配' };
  const features = { contiguous: '外部碎片', implicit: '指针损坏', fat: '内存查链', indexed: '索引寻址' };
  const params = new URLSearchParams(location.hash.slice(1));
  const integer = (value, min, max, fallback) => value !== null && Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
  const state = {
    mode: [...Object.keys(names), 'comparison'].includes(params.get('mode')) ? params.get('mode') : 'contiguous',
    operation: ['access', 'create', 'delete', 'feature'].includes(params.get('op')) ? params.get('op') : 'access',
    length: integer(params.get('n'), 1, 15, 5), level: integer(params.get('level'), 1, 3, 2),
    file: ['A', 'B', 'C'].includes(params.get('file')) ? params.get('file') : 'A',
    t: Math.max(0, Number(params.get('t')) || 0), speed: 1,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, playing: false
  };
  state.k = integer(params.get('k'), 0, state.length - 1, Math.min(3, state.length - 1));
  const clock = { t: state.t };
  let sequence, sequences, duration, boundaries, timeline, delayed, goal = null, lastHash = 0;
  let nodes = {}, disks = [], metas = [], trails = [], laneNodes = [], indexView = null;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = (id, x, y, value, cls = '', extra = '') => `<text ${id ? `id="${id}"` : ''} x="${x}" y="${y}" class="${cls}" ${extra}>${esc(value)}</text>`;
  const box = (id, x, y, w, h, cls = 'meta-box', rx = 9) => `<rect ${id ? `id="${id}"` : ''} x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${cls}"/>`;
  function attr(el, key, value) { if (el && el.getAttribute(key) !== String(value)) el.setAttribute(key, value); }
  function content(el, value) { if (el && el.textContent !== String(value)) el.textContent = value; }
  const opacity = (el, value) => attr(el, 'opacity', clamp(value).toFixed(4));
  const diskPoint = b => ({ x: 687 + b % 8 * 51, y: 83 + Math.floor(b / 8) * 55 });
  const scrollFor = focus => clamp(focus - 2, 0, Math.max(0, state.length - 5)) * 47;
  function point(ref, focus) {
    if (ref.type === 'disk') return { ...diskPoint(ref.block), type: 'disk' };
    if (ref.type === 'formula') return { x: 586, y: 160, type: 'meta' };
    if (ref.type === 'fat') return { x: 586, y: 113 + sequence.blocks.indexOf(ref.block) * 47 - scrollFor(focus), type: 'meta' };
    return { x: 230, y: 205, type: 'directory' };
  }
  function route(from, to, focus) {
    const a = point(from, focus), b = point(to, focus);
    if (a.x === b.x && a.y === b.y) return { d: `M${a.x} ${a.y}L${a.x} ${a.y}`, a, b, moving: false };
    const pts = [[a.x, a.y]];
    if (a.type === 'disk') pts.push([a.x, a.y - 7], [640, a.y - 7]);
    else if (a.type === 'directory') pts.push([245, a.y], [245, 75], [604, 75]);
    else pts.push([604, a.y]);
    if (b.type === 'disk') pts.push([640, a.type === 'disk' ? a.y - 7 : a.type === 'directory' ? 75 : a.y], [640, b.y - 7], [b.x, b.y - 7]);
    else if (b.type === 'directory') pts.push([604, 75], [245, 75], [245, b.y]);
    else pts.push([604, b.y]);
    pts.push([b.x, b.y]);
    return { d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(''), a, b, moving: true };
  }
  function writeHash(force = false) {
    if (!force && performance.now() - lastHash < 350) return;
    lastHash = performance.now();
    try { history.replaceState(null, '', '#' + new URLSearchParams({ mode: state.mode, op: state.operation, n: state.length, k: state.k, level: state.level, file: state.file, t: state.t.toFixed(3) })); } catch { /* Some file:// contexts restrict history. */ }
  }
  function stop() {
    timeline?.pause(); delayed?.kill(); delayed = null;
    state.playing = false; document.body.dataset.playing = 'false';
    $('play').innerHTML = '播放 <span>▶</span>'; writeHash(true);
  }
  function seek(t) {
    stop(); goal = null; clock.t = state.t = clamp(t, 0, duration);
    timeline?.time(state.t, true); render(); writeHash(true);
  }
  const nextBoundary = () => boundaries.find(t => t > state.t + 1e-6) ?? duration;
  const previousBoundary = () => boundaries.filter(t => t < state.t - 1e-6).at(-1) ?? 0;
  function reducedTick() {
    if (!state.playing) return;
    clock.t = state.t = nextBoundary(); timeline?.time(state.t, true); render(); writeHash();
    if (state.t >= (goal ?? duration)) { goal = null; stop(); return; }
    delayed = gsap.delayedCall(.9, reducedTick).timeScale(state.speed);
  }
  function start(target) {
    if (!window.gsap) return;
    if (state.t >= duration) seek(0);
    goal = target ?? goal ?? duration;
    state.playing = true; document.body.dataset.playing = 'true';
    $('play').innerHTML = '暂停 <span>Ⅱ</span>';
    if (state.reduced) delayed = gsap.delayedCall(.9, reducedTick).timeScale(state.speed);
    else timeline.play();
  }
  function togglePlay() { if (state.playing) stop(); else start(); }
  function stepNext() {
    const target = nextBoundary();
    if (!window.gsap || state.reduced) seek(target);
    else { stop(); start(target); }
  }
  function rebuild(keep = state.t) {
    stop(); timeline?.kill(); goal = null;
    const options = { operation: state.operation, length: state.length, k: state.k, level: state.level, file: state.file };
    sequences = Object.fromEntries(Object.keys(names).map(mode => [mode, M.build({ ...options, mode })]));
    sequence = sequences[state.mode] || sequences.contiguous;
    const active = state.mode === 'comparison' ? Object.values(sequences) : [sequence];
    duration = Math.max(...active.map(s => s.duration));
    boundaries = [...new Set(active.flatMap(s => s.events.map(e => e.at)))].sort((a, b) => a - b);
    clock.t = state.t = clamp(keep, 0, duration);
    if (window.gsap) {
      timeline = gsap.timeline({ paused: true, onUpdate: () => {
        if (goal !== null && clock.t >= goal) {
          clock.t = state.t = goal; timeline.pause().time(goal, true); goal = null; render(); stop(); return;
        }
        state.t = clock.t; render(); writeHash();
      }, onComplete: () => { goal = null; stop(); } });
      timeline.fromTo(clock, { t: 0 }, { t: duration, duration, ease: 'none', immediateRender: false });
      timeline.time(state.t, true).timeScale(state.speed);
    }
    $('single-view').hidden = state.mode === 'comparison'; $('comparison-view').hidden = state.mode !== 'comparison';
    $('counters').hidden = state.mode === 'comparison';
    for (const id of ['length', 'k', 'file', 'level']) $(id).value = state[id];
    $('k').max = state.length - 1;
    $('level-label').hidden = !['indexed', 'comparison'].includes(state.mode);
    $('k-label').hidden = !['access', 'feature'].includes(state.operation);
    content($('feature'), features[state.mode] || '特性场景');
    document.querySelectorAll('[data-mode]').forEach(b => attr(b, 'aria-pressed', b.dataset.mode === state.mode));
    document.querySelectorAll('[data-operation]').forEach(b => attr(b, 'aria-pressed', b.dataset.operation === state.operation));
    $('progress').max = duration; content($('duration'), `${duration.toFixed(2)} t`);
    $('events').innerHTML = boundaries.map((t, i) => {
      const title = state.mode === 'comparison' ? `${t.toFixed(2)} t` : sequence.events[i].title;
      return `<button data-time="${t}"><span>${String(i).padStart(2, '0')}</span>${esc(title)}</button>`;
    }).join('');
    if (state.mode === 'comparison') buildLanes(); else buildScene();
    render(); writeHash(true);
  }
  // Build once per parameter/view change. Playback only changes attributes on these objects.
  function buildScene() {
    const seq = sequence, fragmented = seq.mode === 'contiguous' && seq.operation === 'feature';
    if (seq.mode === 'indexed') {
      indexView = window.AllocationIndexView.mount($('diagram'), $('scene'), $('motion'), seq);
      content($('diagram-desc'), '完整索引树：目录指向一级索引块，各表项连接下一层索引块或数据块。图中列出实际存储的物理块号；下方是同一磁盘的位置地图。');
      return;
    }
    indexView = null;
    attr($('diagram'), 'viewBox', '0 0 1100 466');
    $('diagram').dataset.layout = 'disk-grid';
    content($('diagram-desc'), '左侧内存目录，中间地址结构，右侧四十个磁盘块。当前读取与指针路径随事件更新。');
    let html = '<defs><clipPath id="metadata-window"><rect x="280" y="87" width="325" height="246"/></clipPath></defs>';
    html += text('', 30, 42, '目录项', 'heading') + text('', 30, 61, '内存 · 不计磁盘读取', 'small');
    html += box('', 30, 83, 200, 167) + text('', 48, 112, `文件 ${state.file}`, 'heading') + text('', 48, 139, `长度 ${state.length} 块`, 'label number');
    html += text('', 48, 175, '起始物理块', 'small');
    html += text('entry-value', 48, 212, seq.blocks[0], 'number', 'font-size="29"');
    html += text('entry-empty', 48, 212, '—', 'number', 'font-size="29"');
    html += text('', 30, 282, ['create', 'delete'].includes(state.operation) ? '文件空间操作' : `请求逻辑块 k = ${state.k}`, 'heading number');
    html += text('', 30, 304, ['create', 'delete'].includes(state.operation) ? '先处理块，最后更新目录' : `有效范围 0 … ${state.length - 1}`, 'small number');
    html += box('buoy-bg', 30, 322, 190, 26, 'active-box', 4) + text('buoy', 42, 340, '', 'label');
    html += text('entry-status', 30, 374, '', 'small') + text('', 30, 391, '每次操作均为独立场景', 'small');
    if (seq.mode === 'contiguous') {
      html += text('', 286, 42, fragmented ? '连续空间检查' : '直接计算地址', 'heading') + text('', 286, 61, fragmented ? '空闲总量不等于连续空间' : '不需要读取前序数据块', 'small');
      html += box('', 286, 100, 300, 119);
      html += text('', 306, 131, fragmented ? '申请长度 / 最长连续空闲区' : '物理块 = 起始块 + k', 'label');
      html += text('formula-result', 306, 178, fragmented ? `${state.length} 块 / 2 块` : `8 + ${state.k} = ${8 + state.k}`, 'number', 'font-size="25"');
      html += text('', 306, 202, fragmented ? '空闲 27 块 · 最长连续 2 块' : '地址计算完成后，再发起读盘', 'small');
      html += text('', 286, 280, '文件要求连续占用物理块', 'label') + text('', 286, 304, `${seq.blocks[0]} … ${seq.blocks.at(-1)}`, 'number', 'font-size="20"');
      html += `<g id="operand-start">${box('', -17, -17, 37, 29, 'active-box', 4)}${text('', 0, 3, fragmented ? state.length : 8, 'number', 'text-anchor="middle" font-size="16"')}</g>`;
      html += `<g id="operand-k">${box('', -17, -17, 37, 29, 'active-box', 4)}${text('', 0, 3, fragmented ? 2 : state.k, 'number', 'text-anchor="middle" font-size="16"')}</g>`;
    } else {
      html += text('', 286, 42, seq.mode === 'fat' ? 'FAT：内存中的地址接力' : 'next：随数据块读出', 'heading');
      html += text('', 286, 61, seq.mode === 'fat' ? '内存查表不增加磁盘读取次数' : '磁盘块内指针的展开视图', 'small');
      html += '<g clip-path="url(#metadata-window)"><g id="metadata-rows">';
      seq.blocks.forEach((b, i) => {
        const y = 94 + i * 47;
        html += box('', 286, y, 300, 37, 'meta-box', 5) + box(`meta-halo-${i}`, 286, y, 300, 37, 'active-box', 5);
        html += text('', 302, y + 24, seq.mode === 'fat' ? `FAT[${b}]` : `盘块 ${b} · ${state.file}${i}`, 'label number');
        html += text(`meta-value-${i}`, 447, y + 24, `→ ${seq.blocks[i + 1] ?? 'EOF'}`, 'number', 'font-size="14"');
        html += text(`meta-wait-${i}`, 447, y + 24, 'next 未取出', 'small');
      });
      html += '</g></g>';
    }
    html += text('action-label', 286, 356, '', 'label') + text('action-percent', 586, 356, '', 'small number', 'text-anchor="end"');
    html += box('', 286, 370, 300, 4, 'work-track', 2) + box('action-fill', 286, 370, 300, 4, 'work-fill', 2);
    html += text('action-hint', 286, 392, '', 'small');
    html += '<path d="M253 29V397M623 29V397" stroke="#e5e4dc" fill="none"/>';
    html += text('', 665, 42, '磁盘 · 40 个物理块', 'heading') + text('', 665, 61, '位置固定；读取、分配与释放均在块内呈现', 'small');
    for (let b = 0; b < 40; b++) {
      const p = diskPoint(b), logical = seq.blocks.indexOf(b), idx = seq.indexBlocks.includes(b);
      const other = fragmented && b % 3 === 2;
      html += `<g id="disk-${b}" transform="translate(${p.x - 22},${p.y})">`;
      html += box('', 0, 0, 44, 46, other ? 'other' : 'disk', 6);
      html += box(`occupancy-${b}`, 0, 0, 44, 46, idx ? 'index-block' : 'allocated', 6);
      html += box(`read-shade-${b}`, 0, 0, 44, 46, 'visited', 6);
      html += box(`disk-halo-${b}`, 0, 0, 44, 46, 'disk-halo', 6);
      html += text('', 6, 12, b, 'small number');
      html += text(`disk-free-${b}`, 22, 28, other ? '占用' : '空闲', 'label', 'text-anchor="middle"');
      html += text(`disk-data-${b}`, 22, 27, idx ? '索引' : `${state.file}${logical}`, 'label', 'text-anchor="middle"');
      html += text(`disk-next-${b}`, 22, 41, '', 'small number', 'text-anchor="middle"');
      html += `<g transform="translate(5,40)">${box(`disk-progress-${b}`, 0, 0, 34, 3, 'work-fill', 1)}</g></g>`;
    }
    html += box('', 665, 378, 9, 9, 'disk', 2) + text('', 680, 387, '空闲', 'small');
    html += box('', 741, 378, 9, 9, 'allocated', 2) + text('', 756, 387, '文件数据', 'small');
    html += box('', 851, 378, 9, 9, 'index-block', 2) + text('', 866, 387, '索引', 'small');
    html += box('', 947, 378, 9, 9, 'disk-halo', 2) + text('', 962, 387, '蓝框当前 · 浅蓝已读', 'small');
    html += text('', 30, 433, '逻辑顺序', 'small');
    seq.blocks.forEach((b, i) => {
      const x = 115 + i * 61;
      html += box('', x, 409, 55, 35, i === state.k && !['create', 'delete'].includes(state.operation) ? 'active-box' : 'meta-box', 4);
      html += text('', x + 27.5, 431, `${i} → ${b}`, 'number', 'text-anchor="middle" font-size="11"');
    });
    $('scene').innerHTML = html;
    $('motion').innerHTML = seq.events.slice(1).map((_, i) => `<path id="trail-${i}" class="address-trail" fill="none"/>`).join('') + '<path id="active-route" class="address-route" fill="none"/><g id="request-token"><circle r="4" fill="#2563eb"/><circle r="7" fill="none" stroke="#2563eb" stroke-opacity=".25"/></g>';
    nodes = Object.fromEntries(['entry-value', 'entry-empty', 'entry-status', 'buoy', 'buoy-bg', 'metadata-rows', 'formula-result', 'operand-start', 'operand-k', 'action-label', 'action-percent', 'action-fill', 'action-hint', 'active-route', 'request-token'].map(id => [id, $(id)]));
    disks = Array.from({ length: 40 }, (_, b) => Object.fromEntries(['occupancy', 'read-shade', 'disk-halo', 'disk-free', 'disk-data', 'disk-next', 'disk-progress'].map(key => [key, $(`${key}-${b}`)])));
    metas = seq.blocks.map((b, i) => ({ b, halo: $(`meta-halo-${i}`), value: $(`meta-value-${i}`), wait: $(`meta-wait-${i}`) }));
    trails = seq.events.slice(1).map((e, i) => ({ event: e, el: $(`trail-${i}`) }));
  }
  function revealAmount(s, b) {
    if (s.event.revealed.includes(b)) return 1;
    return s.action?.block === b && ['reveal', 'error'].includes(s.action.kind) ? s.progress : 0;
  }
  function updateScene(s) {
    if (indexView) { indexView.render(s); return; }
    const e = s.event, a = s.action, p = s.progress, seq = sequence;
    const action = a || e, kind = a?.kind, moving = a && ['transfer', 'memory', 'calculate', 'allocate', 'free', 'wire', 'locate', 'done'].includes(kind);
    const travel = !a ? 1 : ['allocate', 'free', 'wire'].includes(kind) ? clamp(p / .45) : kind === 'calculate' ? clamp(p / .55) : p;
    let directoryAmount = e.directory ? 1 : 0;
    if (a?.effect === 'register') directoryAmount = clamp((p - .45) / .55);
    if (a?.effect === 'unregister') directoryAmount = 1 - clamp((p - .45) / .55);
    opacity(nodes['entry-value'], directoryAmount); opacity(nodes['entry-empty'], 1 - directoryAmount);
    content(nodes['entry-status'], directoryAmount >= 1 ? '目录已加载' : a?.effect === 'register' ? '正在登记目录' : a?.effect === 'unregister' ? '正在移除目录' : '尚无目录项');
    content(nodes.buoy, !a ? e.title : kind === 'transfer' ? '地址传递 · 未读盘' : kind === 'read' ? '正在读取 · 尚未计数' : kind === 'reveal' ? '读完后取出指针' : kind === 'error' ? '请求停在断点' : action.title);
    attr(nodes['buoy-bg'], 'class', action.kind === 'error' ? 'error' : 'active-box');
    const label = !a ? '本次操作完成' : kind === 'read' ? `读盘进度 · 物理块 ${a.block}` : kind === 'memory' ? '内存查表 · 不读磁盘' : kind === 'transfer' ? `传递地址 ${a.block}` : a.title;
    content(nodes['action-label'], label); content(nodes['action-percent'], a ? `${Math.round(p * 100)}%` : '完成');
    attr(nodes['action-fill'], 'transform', `translate(286,0) scale(${a ? p : 1},1) translate(-286,0)`);
    content(nodes['action-hint'], kind === 'read' ? '进度到达末端后，I/O 才增加' : kind === 'memory' ? 'FAT驻内存；只在最终目标处读盘' : kind === 'transfer' ? '请求抵达后，才开始读取' : kind === 'allocate' ? '虚线预选 → 分配落定' : kind === 'free' ? '先定位 → 清空归属' : 't 为演示节拍，不是真实设备耗时');
    if (seq.mode === 'contiguous') {
      const calculated = seq.events.some(ev => ev.kind === 'calculate' && ev.at <= s.time);
      const progress = kind === 'calculate' ? p : calculated ? 1 : 0;
      opacity(nodes['formula-result'], clamp((progress - .55) / .45));
      for (const [id, sx, sy, tx] of [['operand-start', 198, 201, 326], ['operand-k', 168, 281, 397]]) {
        const q = clamp(progress / .55);
        attr(nodes[id], 'transform', `translate(${sx + (tx - sx) * q},${sy + (166 - sy) * q})`);
        opacity(nodes[id], clamp(progress / .12) * (1 - clamp((progress - .5) / .35)));
      }
      // Space-operation scenarios do not need an access-address calculation.
      if (['create', 'delete'].includes(seq.operation)) opacity(nodes['formula-result'], 1);
    }
    attr(nodes['metadata-rows'], 'transform', `translate(0,${-scrollFor(s.focus)})`);
    metas.forEach((meta, i) => {
      if (!meta.halo) return;
      const deleting = seq.operation === 'delete', creating = seq.operation === 'create';
      let known = deleting ? e.allocated.includes(meta.b) ? 1 : 0 : seq.mode === 'fat' || creating ? e.wired.includes(meta.b) ? 1 : 0 : revealAmount(s, meta.b);
      if (kind === 'wire' && a.block === meta.b) known = clamp((p - .45) / .55);
      if (deleting && kind === 'free' && a.block === meta.b) known = 1 - clamp((p - .45) / .55);
      content(meta.wait, deleting ? e.allocated.includes(meta.b) ? '正在释放空间' : '空间已释放' : creating ? '尚未写入指针' : 'next 未取出');
      const broken = seq.operation === 'feature' && seq.mode === 'implicit' && meta.b === 13 && revealAmount(s, 13) > 0;
      content(meta.value, broken ? '→ 损坏' : `→ ${seq.blocks[i + 1] ?? 'EOF'}`);
      attr(meta.value, 'class', broken ? 'number pointer-error' : 'number');
      opacity(meta.value, known); opacity(meta.wait, 1 - known);
      const weight = clamp(1 - Math.abs(s.focus - i));
      opacity(meta.halo, weight * .6);
    });
    disks.forEach((d, b) => {
      const fragmentedOther = seq.mode === 'contiguous' && seq.operation === 'feature' && b % 3 === 2;
      let amount = e.allocated.includes(b) && !fragmentedOther ? 1 : 0;
      if (a?.block === b && kind === 'allocate') amount = clamp((p - .45) / .55);
      if (a?.block === b && kind === 'free') amount = 1 - clamp((p - .45) / .55);
      opacity(d.occupancy, amount);
      // Text phases do not overlap: old status leaves before the new status appears.
      opacity(d['disk-data'], clamp((amount - .55) / .45));
      opacity(d['disk-free'], fragmentedOther ? 1 : clamp((.45 - amount) / .45));
      const readProgress = e.visited.includes(b) ? 1 : kind === 'read' && a.block === b ? p : 0;
      opacity(d['read-shade'], readProgress);
      attr(d['disk-progress'], 'transform', `scale(${readProgress},1)`);
      const sourceWeight = e.cursor.type === 'disk' && e.cursor.block === b ? 1 - (moving ? travel : 0) : 0;
      const targetWeight = a?.to.type === 'disk' && a.to.block === b ? moving ? travel : 1 : 0;
      const candidate = kind === 'allocate' && a.block === b;
      const halo = clamp(sourceWeight + targetWeight);
      opacity(d['disk-halo'], candidate ? clamp(p / .15) : halo);
      attr(d['disk-halo'], 'stroke-dasharray', candidate && p < .98 ? '3 3' : 'none');
      attr(d['disk-halo'], 'class', action.kind === 'error' && action.block === b ? 'disk-halo fault-halo' : 'disk-halo');
      let next = '', nextOpacity = 0;
      if (seq.mode === 'implicit' && seq.blocks.includes(b)) {
        const logical = seq.blocks.indexOf(b);
        next = seq.operation === 'feature' && b === 13 ? '损坏' : `→${seq.blocks[logical + 1] ?? 'EOF'}`;
        nextOpacity = seq.operation === 'create' ? e.wired.includes(b) ? 1 : kind === 'wire' && a.block === b ? clamp((p - .45) / .55) : 0 : seq.operation === 'delete' ? 1 : revealAmount(s, b);
      }
      content(d['disk-next'], next); opacity(d['disk-next'], nextOpacity * amount);
      // Pointer text replaces the completed progress bar in linked data blocks.
      opacity(d['disk-progress'], nextOpacity > 0 ? 1 - nextOpacity : 1);
    });
    // All route elements retain identity. Completed routes fade, never disappear at an event boundary.
    trails.forEach(({ event, el }) => {
      const r = route(event.from, event.to, s.focus);
      attr(el, 'd', r.d);
      const edgeFade = (ref, pos) => ref.type === 'fat' ? clamp((pos.y - 87) / 12) * clamp((333 - pos.y) / 12) : 1;
      const visible = r.moving && event.at <= s.time;
      opacity(el, visible ? .24 * edgeFade(event.from, r.a) * edgeFade(event.to, r.b) : 0);
    });
    const from = a?.from || e.cursor, to = a?.to || e.cursor, r = route(from, to, s.focus);
    attr(nodes['active-route'], 'd', r.d);
    const length = nodes['active-route'].getTotalLength();
    attr(nodes['active-route'], 'stroke-dasharray', `${length} ${length}`);
    attr(nodes['active-route'], 'stroke-dashoffset', length * (1 - (moving ? travel : 1)));
    // The bright path fades into its persistent trail as the request reaches the destination.
    opacity(nodes['active-route'], r.moving ? 1 - clamp((travel - .8) / .2) * .76 : 0);
    const pos = r.moving ? nodes['active-route'].getPointAtLength(length * (moving ? travel : 1)) : r.b;
    attr(nodes['request-token'], 'transform', `translate(${pos.x},${pos.y})`);
    attr(nodes['request-token'], 'data-position', `${pos.x.toFixed(3)},${pos.y.toFixed(3)}`);
  }
  function buildLanes() {
    const operations = { access: '访问', create: '创建', delete: '删除', feature: '特性场景' };
    content($('comparison-title'), state.operation === 'access' ? `访问逻辑块 ${state.k} · 文件 ${state.file}` : `${operations[state.operation]} · ${state.length} 块`);
    const short = { transfer: '地址', memory: '内存', calculate: '计算', read: '读盘', reveal: '取址', allocate: '分配', free: '释放', wire: '写址', done: '完成', error: '故障', locate: '定位' };
    $('lanes').style.minWidth = `${Math.max(810, duration * 32 + 240)}px`;
    $('lanes').innerHTML = Object.entries(sequences).map(([mode, seq]) => `<div class="lane" data-lane="${mode}"><div class="lane-label">${esc(names[mode])}<small>${mode === 'fat' ? '内存接力后才读盘' : mode === 'implicit' ? '读盘后才取得next' : mode === 'indexed' ? `${state.level} 级 · 索引在磁盘` : '计算后直接读目标'}</small></div><div class="lane-track">${seq.events.slice(1).map(e => `<button data-time="${e.at}" class="${e.kind}" style="left:${e.start / duration * 100}%;width:${(e.at - e.start) / duration * 100}%" title="${esc(e.title + '：' + e.note)}" aria-label="${esc(e.title)}，完成于${e.at}节拍"><span class="lane-fill"></span><span>${short[e.kind]}</span><small>${e.block ?? ''}</small></button>`).join('')}<span class="lane-head"></span></div><div class="lane-total"><span>0</span><small>次读取</small><em></em></div></div>`).join('');
    laneNodes = Object.entries(sequences).map(([mode, seq]) => {
      const lane = document.querySelector(`[data-lane="${mode}"]`);
      return { seq, track: lane.querySelector('.lane-track'), head: lane.querySelector('.lane-head'), total: lane.querySelector('.lane-total span'), status: lane.querySelector('.lane-total em'), buttons: [...lane.querySelectorAll('button')] };
    });
  }
  function render() {
    const s = M.sample(sequence, state.t), a = s.action;
    const boundaryIndex = Math.max(0, boundaries.findLastIndex(t => t <= state.t + 1e-7));
    content($('time'), `t = ${state.t.toFixed(2)}`);
    content($('phase'), state.mode === 'comparison' ? state.t >= duration ? '全部完成' : '同步推演' : a && s.progress > .001 ? a.title : s.event.title);
    $('progress').value = state.t;
    content($('step-count'), `${String(boundaryIndex).padStart(2, '0')} / ${String(boundaries.length - 1).padStart(2, '0')}`);
    $('prev').disabled = state.t <= 0; $('next').disabled = state.t >= duration;
    const activeBoundary = a && s.progress > .001 && state.mode !== 'comparison' ? boundaryIndex + 1 : boundaryIndex;
    [...$('events').children].forEach((b, i) => attr(b, 'aria-current', i === activeBoundary ? 'step' : 'false'));
    if (state.mode === 'comparison') {
      const counts = [];
      laneNodes.forEach(lane => {
        const sample = M.sample(lane.seq, state.t);
        counts.push(sample.event.io); content(lane.total, sample.event.io);
        content(lane.status, sample.action?.kind === 'read' ? `读盘 ${Math.round(sample.progress * 100)}%` : sample.action?.kind === 'memory' ? '内存操作' : sample.action ? sample.action.title : '完成');
        lane.buttons.forEach((b, i) => {
          const ev = lane.seq.events[i + 1], progress = clamp((state.t - ev.start) / (ev.at - ev.start));
          attr(b, 'data-active', state.t >= ev.start && state.t < ev.at);
          b.querySelector('.lane-fill').style.transform = `scaleX(${progress})`;
        });
        lane.head.style.left = `${state.t / duration * 100}%`;
      });
      content($('comparison-result'), `磁盘读取 ${counts.join(' / ')} 次`);
      content($('narration'), state.t >= duration ? '同一请求完成；读盘与内存查表分开计数。' : '同一演示时钟：地址传递 → 读盘完成 → 取出后继。');
      content($('allocation'), '抽象节拍，不代表真实耗时');
    } else {
      updateScene(s); content($('io'), s.event.io); content($('memory'), s.event.memory);
      content($('narration'), a && s.progress > .001 ? a.during : s.event.note);
      content($('allocation'), `占用 ${s.event.allocated.length} / 40 块`);
    }
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { state.mode = b.dataset.mode; rebuild(); }));
  document.querySelectorAll('[data-operation]').forEach(b => b.addEventListener('click', () => { state.operation = b.dataset.operation; rebuild(0); }));
  ['file', 'length', 'k', 'level'].forEach(id => $(id).addEventListener('change', () => {
    if (id === 'file') state.file = $('file').value;
    if (id === 'length') { state.length = integer($('length').value, 1, 15, state.length); state.k = Math.min(state.k, state.length - 1); }
    if (id === 'k') state.k = integer($('k').value, 0, state.length - 1, state.k);
    if (id === 'level') state.level = Number($('level').value);
    rebuild();
  }));
  $('play').addEventListener('click', togglePlay);
  $('reset').addEventListener('click', () => seek(0));
  $('prev').addEventListener('click', () => seek(previousBoundary()));
  $('next').addEventListener('click', stepNext);
  $('progress').addEventListener('input', () => seek(Number($('progress').value)));
  [$('events'), $('lanes')].forEach(el => el.addEventListener('click', event => { const b = event.target.closest('button[data-time]'); if (b) seek(Number(b.dataset.time)); }));
  $('speed').addEventListener('change', () => { state.speed = Number($('speed').value); timeline?.timeScale(state.speed); delayed?.timeScale(state.speed); });
  $('reduced').checked = state.reduced; document.body.dataset.reduced = state.reduced;
  $('reduced').addEventListener('change', () => {
    const wasPlaying = state.playing; stop(); state.reduced = $('reduced').checked; document.body.dataset.reduced = state.reduced;
    render(); if (wasPlaying) start();
  });
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea,button,a') || e.ctrlKey || e.metaKey || e.altKey) return;
    const action = { Space: togglePlay, ArrowLeft: () => $('prev').click(), ArrowRight: () => $('next').click(), Home: () => seek(0) }[e.code];
    if (action) { e.preventDefault(); action(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', () => { stop(); timeline?.kill(); });
  $('engine-notice').hidden = !!window.gsap; $('play').disabled = !window.gsap;
  rebuild();
})();
