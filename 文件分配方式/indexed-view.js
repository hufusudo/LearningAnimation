/* Complete index-block contents and connections. Playback never rebuilds SVG nodes. */
(function (root) {
  'use strict';
  const clamp = x => Math.max(0, Math.min(1, x));
  const key = (block, slot) => `${block}:${slot}`;
  function layout(seq) {
    const columns = seq.level === 1 ? [330] : seq.level === 2 ? [235, 550] : [200, 425, 650];
    const widths = seq.level === 1 ? [250] : seq.level === 2 ? [200, 200] : [160, 165, 175];
    const dataX = seq.level === 1 ? 860 : 930;
    const blocks = {};
    seq.blocks.forEach((block, logical) => {
      const y = 100 + logical * (seq.level === 1 ? 44 : 56) + (seq.level === 1 ? 0 : Math.floor(logical / 3) * 24);
      blocks[block] = { block, logical, x: dataX, y, w: 145, h: 40, cy: y + 20, kind: 'data' };
    });
    seq.indexNodes.forEach(node => {
      const h = 56 + node.entries.length * 36;
      const cy = (blocks[seq.blocks[node.start]].cy + blocks[seq.blocks[node.end]].cy) / 2;
      blocks[node.block] = { ...node, x: columns[node.depth - 1], y: cy - h / 2, cy, w: widths[node.depth - 1], h, kind: 'index' };
    });
    const bottom = Math.max(...Object.values(blocks).map(b => b.y + b.h)) + 28;
    return { blocks, columns, widths, dataX, bottom, height: bottom + 186 };
  }
  function mount(svg, scene, motion, seq) {
    const $ = id => svg.querySelector(`#${id}`);
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const text = (id, x, y, value, cls = 'label', extra = '') => `<text ${id ? `id="${id}"` : ''} x="${x}" y="${y}" class="${cls}" ${extra}>${esc(value)}</text>`;
    const rect = (id, x, y, w, h, cls, r = 7) => `<rect ${id ? `id="${id}"` : ''} x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" class="${cls}"/>`;
    const geo = layout(seq), access = ['access', 'feature'].includes(seq.operation);
    const entryPoint = (block, slot) => {
      const n = geo.blocks[block]; return { x: n.x + n.w, y: n.y + 48 + slot * 36 + 18 };
    };
    function point(ref) {
      if (ref.type === 'entry') return entryPoint(ref.block, ref.slot);
      if (ref.type === 'directory') return { x: 170, y: 155 };
      const b = geo.blocks[ref.block]; return { x: b.x, y: b.cy };
    }
    function route(from, to) {
      const a = point(from), b = point(to);
      if (a.x === b.x && a.y === b.y) return { d: `M${a.x} ${a.y}L${a.x} ${a.y}`, moving: false, end: b };
      let d;
      if (from.block === to.block && to.type === 'entry') {
        // Read the block first, then move the cursor onto the selected table cell.
        d = `M${a.x} ${a.y}L${a.x + 5} ${a.y}L${a.x + 5} ${b.y + 15}L${b.x - 6} ${b.y + 15}L${b.x - 6} ${b.y}L${b.x} ${b.y}`;
      } else if (from.type === 'entry' || from.type === 'directory') {
        const mid = (a.x + b.x) / 2;
        d = `M${a.x} ${a.y}C${mid} ${a.y},${mid} ${b.y},${b.x} ${b.y}`;
      } else {
        // Allocation/reclamation moves through a service lane, not through file contents.
        const source = geo.blocks[from.block], target = geo.blocks[to.block];
        if (!target) {
          d = `M${a.x} ${a.y}L${a.x - 12} ${a.y}L${a.x - 12} 73L182 73L182 ${b.y}L${b.x} ${b.y}`;
        } else {
          const y = Math.min(source.y, target.y) - 12;
          d = `M${a.x} ${a.y}L${a.x - 12} ${a.y}L${a.x - 12} ${y}L${b.x - 12} ${y}L${b.x - 12} ${b.y}L${b.x} ${b.y}`;
        }
      }
      return { d, moving: true, end: b };
    }
    const names = ['一级索引块', '二级索引块', '三级索引块'];
    let html = '<defs><marker id="tree-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="#8d968b" stroke-width="1.5"/></marker></defs>';
    html += text('', 30, 31, '目录 · 内存', 'heading') + text('', 30, 52, '只保存索引入口', 'small');
    geo.columns.forEach((x, i) => {
      html += text('', x, 31, names[i], 'heading') + text('', x, 52, i === seq.level - 1 ? '表项保存数据块号' : '表项保存下一级索引块号', 'small');
    });
    html += text('', geo.dataX, 31, '文件数据块', 'heading') + text('', geo.dataX, 52, '保存文件内容', 'small');
    const rootBlock = seq.indexBlocks[0];
    html += `<path id="tree-directory-edge" class="tree-edge" d="${route({ type: 'directory' }, { type: 'disk', block: rootBlock }).d}"/>`;
    for (const node of seq.indexNodes) for (const entry of node.entries) {
      html += `<path id="tree-edge-${node.block}-${entry.slot}" data-from="${node.block}:${entry.slot}" data-target="${entry.target}" class="tree-edge" d="${route({ type: 'entry', block: node.block, slot: entry.slot }, { type: 'disk', block: entry.target }).d}"/>`;
    }
    html += rect('', 30, 83, 140, 145, 'meta-box');
    html += text('', 43, 111, `文件 ${seq.file}`, 'heading') + text('', 43, 136, `长度 ${seq.length} 块`, 'small number');
    html += text('', 43, 168, '索引入口', 'small') + text('tree-entry', 43, 205, rootBlock, 'number', 'font-size="27"');
    html += text('tree-entry-empty', 43, 205, '—', 'number', 'font-size="27"');
    html += text('', 30, 264, access ? `逻辑块 k = ${seq.k}` : seq.operation === 'create' ? '逐块分配 → 写表项' : '逐块释放 → 清目录', 'heading number');
    html += text('', 30, 285, access ? `数据目标：物理块 ${seq.blocks[seq.k]}` : '目录最后更新', 'small');
    html += text('tree-directory-status', 30, 315, '', 'small');
    for (const node of seq.indexNodes) {
      const g = geo.blocks[node.block], b = node.block;
      html += `<g id="tree-block-${b}" data-block="${b}" data-depth="${node.depth}" data-kind="index">`;
      html += rect('', g.x, g.y, g.w, g.h, 'meta-box') + rect(`tree-fill-${b}`, g.x, g.y, g.w, g.h, 'index-block');
      html += rect(`tree-read-${b}`, g.x, g.y, g.w, g.h, 'visited') + rect(`tree-halo-${b}`, g.x, g.y, g.w, g.h, 'disk-halo');
      html += text('', g.x + 12, g.y + 21, `物理块 ${b}`, 'heading number');
      html += text(`tree-state-${b}`, g.x + g.w - 10, g.y + 21, '', 'small', 'text-anchor="end"');
      html += text('', g.x + 12, g.y + 39, node.depth === seq.level ? '存放文件数据块号' : '存放下级索引块号', 'small');
      node.entries.forEach(entry => {
        const y = g.y + 48 + entry.slot * 36;
        html += `<g id="tree-cell-${b}-${entry.slot}" data-slot="${entry.slot}" data-target="${entry.target}">`;
        html += rect(`tree-cell-glow-${b}-${entry.slot}`, g.x + 1, y, g.w - 2, 36, 'tree-cell-active', 0);
        html += `<path d="M${g.x + 1} ${y}H${g.x + g.w - 1}" class="tree-rule"/>`;
        html += text('', g.x + 12, y + 14, `表项 ${entry.slot}`, 'small number');
        html += text('', g.x + 12, y + 29, entry.start === entry.end ? `逻辑块 ${entry.start}` : `逻辑块 ${entry.start}–${entry.end}`, 'small');
        html += text(`tree-value-${b}-${entry.slot}`, g.x + g.w - 18, y + 26, entry.target, 'number tree-address', 'text-anchor="end"');
        html += text(`tree-empty-${b}-${entry.slot}`, g.x + g.w - 18, y + 26, '—', 'number tree-address', 'text-anchor="end"');
        html += '</g>';
      });
      html += rect('', g.x + 12, g.y + g.h - 6, g.w - 24, 3, 'work-track', 1);
      html += `<g transform="translate(${g.x + 12},${g.y + g.h - 6})">${rect(`tree-progress-${b}`, 0, 0, g.w - 24, 3, 'work-fill', 1)}</g></g>`;
    }
    seq.blocks.forEach((b, logical) => {
      const g = geo.blocks[b];
      html += `<g id="tree-block-${b}" data-block="${b}" data-kind="data" data-logical="${logical}">`;
      html += rect('', g.x, g.y, g.w, g.h, 'meta-box') + rect(`tree-fill-${b}`, g.x, g.y, g.w, g.h, 'allocated');
      html += rect(`tree-read-${b}`, g.x, g.y, g.w, g.h, 'visited') + rect(`tree-halo-${b}`, g.x, g.y, g.w, g.h, 'disk-halo');
      html += text('', g.x + 10, g.y + 15, `逻辑块 ${logical}`, 'small number');
      html += text('', g.x + 10, g.y + 32, `物理块 ${b}`, 'heading number');
      html += text(`tree-state-${b}`, g.x + g.w - 8, g.y + 16, '', 'small', 'text-anchor="end"');
      html += `<g transform="translate(${g.x + 8},${g.y + 35})">${rect(`tree-progress-${b}`, 0, 0, g.w - 16, 3, 'work-fill', 1)}</g></g>`;
    });
    const y = geo.bottom;
    html += `<path d="M30 ${y + 48}H1075" class="tree-rule"/>`;
    html += text('tree-path-caption', 235, y + 6, '', 'heading');
    html += text('tree-action', 235, y + 28, '', 'small') + text('tree-percent', 1075, y + 28, '', 'small number', 'text-anchor="end"');
    html += `<g transform="translate(730,${y + 25})">${rect('', 0, 0, 270, 3, 'work-track', 1)}${rect('tree-action-fill', 0, 0, 270, 3, 'work-fill', 1)}</g>`;
    html += text('', 30, y + 76, '物理磁盘位置 · 40 块', 'heading') + text('', 235, y + 76, '上方所有索引块和数据块，都在同一块磁盘上', 'small');
    for (let b = 0; b < 40; b++) {
      const x = 30 + b % 20 * 53, yy = y + 87 + Math.floor(b / 20) * 36;
      html += rect('', x, yy, 46, 29, 'disk', 4);
      html += rect(`tree-map-fill-${b}`, x, yy, 46, 29, seq.indexBlocks.includes(b) ? 'index-block' : 'allocated', 4);
      html += rect(`tree-map-read-${b}`, x, yy, 46, 29, 'visited', 4);
      html += rect(`tree-map-halo-${b}`, x, yy, 46, 29, 'disk-halo', 4);
      html += text('', x + 8, yy + 19, b, 'small number');
      html += text(`tree-map-type-${b}`, x + 39, yy + 19, seq.indexBlocks.includes(b) ? '索' : seq.blocks.includes(b) ? '数' : '', 'small', 'text-anchor="end"');
    }
    html += text('', 30, y + 171, '金色：索引块　绿色：数据块　蓝框：当前操作　浅蓝：已读', 'small');
    html += text('', 665, y + 171, '完整结构常显 ≠ 已读入内存', 'small');
    scene.innerHTML = html;
    const routes = seq.events.slice(1).map(e => route(e.from, e.to));
    motion.innerHTML = routes.map((r, i) => `<path id="tree-trail-${i}" class="address-trail" fill="none" d="${r.d}"/>`).join('') + '<path id="active-route" class="address-route" fill="none"/><g id="request-token"><circle r="4" fill="#2563eb"/><circle r="7" fill="none" stroke="#2563eb" stroke-opacity=".25"/></g>';
    svg.setAttribute('viewBox', `0 0 1100 ${geo.height}`);
    svg.dataset.layout = 'index-tree';
    const blocks = Object.values(geo.blocks).map(g => ({ g, fill: $(`tree-fill-${g.block}`), read: $(`tree-read-${g.block}`), halo: $(`tree-halo-${g.block}`), status: $(`tree-state-${g.block}`), progress: $(`tree-progress-${g.block}`) }));
    const entries = seq.indexNodes.flatMap(n => n.entries.map(e => ({ ...e, parent: n.block, value: $(`tree-value-${n.block}-${e.slot}`), empty: $(`tree-empty-${n.block}-${e.slot}`), glow: $(`tree-cell-glow-${n.block}-${e.slot}`), edge: $(`tree-edge-${n.block}-${e.slot}`) })));
    const map = Array.from({ length: 40 }, (_, b) => ({ b, fill: $(`tree-map-fill-${b}`), read: $(`tree-map-read-${b}`), halo: $(`tree-map-halo-${b}`), type: $(`tree-map-type-${b}`) }));
    const trails = routes.map((r, i) => ({ r, at: seq.events[i + 1].at, el: $(`tree-trail-${i}`) }));
    const ui = Object.fromEntries(['tree-entry', 'tree-entry-empty', 'tree-directory-edge', 'tree-directory-status', 'tree-path-caption', 'tree-action', 'tree-percent', 'tree-action-fill', 'active-route', 'request-token'].map(id => [id, $(id)]));
    function attr(el, k, v) { if (el.getAttribute(k) !== String(v)) el.setAttribute(k, v); }
    function alpha(el, v) { attr(el, 'opacity', clamp(v).toFixed(4)); }
    function content(el, s) { if (el.textContent !== String(s)) el.textContent = s; }
    function amount(s, b) {
      let value = s.event.allocated.includes(b) ? 1 : 0;
      if (s.action?.block === b && s.action.kind === 'allocate') value = clamp((s.progress - .45) / .55);
      if (s.action?.block === b && s.action.kind === 'free') value = 1 - clamp((s.progress - .45) / .55);
      return value;
    }
    function render(s) {
      const e = s.event, a = s.action, p = s.progress;
      const moving = a && ['transfer', 'reveal', 'allocate', 'free', 'wire', 'locate', 'done'].includes(a.kind);
      const travel = a && ['allocate', 'free', 'wire'].includes(a.kind) ? clamp(p / .45) : p;
      let directory = e.directory ? 1 : 0;
      if (a?.effect === 'register') directory = clamp((p - .45) / .55);
      if (a?.effect === 'unregister') directory = 1 - clamp((p - .45) / .55);
      alpha(ui['tree-entry'], directory); alpha(ui['tree-entry-empty'], 1 - directory); alpha(ui['tree-directory-edge'], directory * .65);
      content(ui['tree-directory-status'], directory === 1 ? '目录常驻内存' : seq.operation === 'create' ? '空间就绪后才登记' : '目录项已移除');
      const weight = b => {
        const source = e.cursor.block === b ? 1 - (moving ? travel : 0) : 0;
        const target = a?.to.block === b ? moving ? travel : 1 : 0;
        return clamp(source + target);
      };
      blocks.forEach(({ g, fill, read, halo, status, progress }) => {
        const owned = amount(s, g.block), reading = a?.kind === 'read' && a.block === g.block;
        const readProgress = e.visited.includes(g.block) ? 1 : reading ? p : 0;
        alpha(fill, owned); alpha(read, readProgress); alpha(halo, weight(g.block));
        attr(fill, 'stroke-dasharray', owned < .99 ? '3 3' : 'none');
        attr(progress, 'transform', `scale(${readProgress},1)`);
        content(status, reading ? `读 ${Math.round(p * 100)}%` : e.visited.includes(g.block) ? '已读' : access ? '未读' : owned >= 1 ? seq.operation === 'create' ? '已分配' : '待回收' : owned > 0 ? '处理中' : seq.operation === 'create' ? '候选' : '已释放');
        attr($(`tree-block-${g.block}`), 'data-read', e.visited.includes(g.block));
      });
      entries.forEach(entry => {
        let written = e.written.includes(key(entry.parent, entry.slot)) ? 1 : 0;
        const writing = a?.kind === 'wire' && a.block === entry.parent && a.slot === entry.slot;
        if (writing) written = clamp((p - .45) / .55);
        if (a?.kind === 'free' && [entry.parent, entry.target].includes(a.block)) written *= 1 - clamp((p - .45) / .55);
        alpha(entry.value, written); alpha(entry.empty, 1 - written); alpha(entry.edge, written * .7);
        const selected = seq.indexPath.some(path => path.block === entry.parent && path.slot === entry.slot);
        let glow = access && selected && e.revealed.includes(entry.parent) ? 1 : 0;
        if (access && a?.kind === 'reveal' && a.block === entry.parent && a.slot === entry.slot) glow = p;
        if (writing) glow = Math.sin(p * Math.PI);
        alpha(entry.glow, glow * .7);
      });
      map.forEach(cell => {
        const owned = amount(s, cell.b);
        alpha(cell.fill, owned); alpha(cell.type, owned); alpha(cell.halo, weight(cell.b));
        alpha(cell.read, e.visited.includes(cell.b) ? 1 : a?.kind === 'read' && a.block === cell.b ? p : 0);
      });
      const visited = e.visited.map(b => seq.indexBlocks.includes(b) ? `索引${b}` : `数据${b}`);
      content(ui['tree-path-caption'], access ? visited.length ? `已读盘：${visited.join(' → ')}` : `从入口块 ${rootBlock} 开始，按表项找到逻辑块 ${seq.k}` : seq.operation === 'create' ? '先分配块，再逐个写入表项，最后登记目录' : '沿所属分支回收数据块，再回收索引块');
      content(ui['tree-action'], !a ? '操作完成' : a.kind === 'read' ? `读盘中 · 块 ${a.block}，完成后才累计 I/O` : a.kind === 'reveal' ? `取块 ${a.block} 的表项 ${a.slot} → 块号 ${a.target}` : a.title);
      content(ui['tree-percent'], a ? `${Math.round(p * 100)}%` : '完成');
      attr(ui['tree-action-fill'], 'transform', `scale(${a ? p : 1},1)`);
      trails.forEach(t => alpha(t.el, t.r.moving && s.time >= t.at ? .34 : 0));
      const index = s.index, r = a ? routes[index] : route(e.cursor, e.cursor);
      attr(ui['active-route'], 'd', r.d);
      const length = ui['active-route'].getTotalLength();
      attr(ui['active-route'], 'stroke-dasharray', `${length} ${length}`);
      attr(ui['active-route'], 'stroke-dashoffset', length * (1 - (moving ? travel : 1)));
      alpha(ui['active-route'], r.moving ? 1 - clamp((travel - .8) / .2) * .66 : 0);
      const pos = r.moving ? ui['active-route'].getPointAtLength(length * (moving ? travel : 1)) : r.end;
      attr(ui['request-token'], 'transform', `translate(${pos.x},${pos.y})`);
      attr(ui['request-token'], 'data-position', `${pos.x.toFixed(3)},${pos.y.toFixed(3)}`);
    }
    return { render };
  }
  const api = { layout, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AllocationIndexView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
