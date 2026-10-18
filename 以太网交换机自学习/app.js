/**
 * 以太网交换机自学习与兜圈问题 —— 界面层
 * 只负责「把 model.frameOf 算出的画面写进 SVG」，以及控件、键盘、地址栏与降级。
 */
(function () {
  'use strict';

  const M = window.EtherModel;
  const NS = 'http://www.w3.org/2000/svg';
  const hasGsap = typeof window.gsap !== 'undefined';
  const DWELL = 0.9; // 减少动效时每步停留的秒数（1×）

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  const S = {
    view: 'loop',
    stp: false,
    seq: null,
    starts: [],
    total: 0,
    t: 0,
    playing: false,
    speed: 1,
    reduce: reduceQuery ? reduceQuery.matches : false
  };

  let stage = null;
  let tween = null;
  let dwellTimer = null;
  let linkTimer = null;

  const els = {
    stageSingle: $('stage-single'),
    stageLoop: $('stage-loop'),
    caption: $('caption'),
    phase: $('phase'),
    stepCount: $('step-count'),
    framePill: $('frame-pill'),
    lamp: $('lamp'),
    track: $('track'),
    play: $('play'),
    playIcon: $('play-icon'),
    playText: $('play-text'),
    prev: $('prev'),
    next: $('next'),
    replay: $('replay'),
    progress: $('progress'),
    scrubText: $('scrub-text'),
    reduce: $('reduce'),
    notice: $('notice'),
    stpBtn: $('stp'),
    hint: $('hint')
  };

  // ---------- 小工具 ----------

  function setText(el, t) {
    if (el && el.textContent !== t) el.textContent = t;
  }

  function setAttr(el, name, value) {
    const v = String(value);
    if (el && el.getAttribute(name) !== v) el.setAttribute(name, v);
  }

  function svgEl(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => node.setAttribute(k, attrs[k]));
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function textWidth(text, size) {
    let w = 0;
    for (const ch of String(text)) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.62;
    return w;
  }

  function macFull(mac) {
    return M.HOST_MAC[mac] || mac;
  }

  // ---------- 舞台构建 ----------

  function buildStage(seq) {
    const G = seq.geom;
    const svg = S.view === 'loop' ? els.stageLoop : els.stageSingle;
    [['single', els.stageSingle], ['loop', els.stageLoop]].forEach(([name, node]) => {
      if (S.view === name) node.removeAttribute('hidden');
      else node.setAttribute('hidden', '');
    });

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', G.viewBox.join(' '));

    // 面板用极浅的纵向渐变，避免大面积死白
    const defs = svgEl('defs', {}, svg);
    const grad = svgEl('linearGradient', { id: 'panelGrad-' + G.id, x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    svgEl('stop', { offset: '0%', 'stop-color': '#FFFFFF' }, grad);
    svgEl('stop', { offset: '100%', 'stop-color': '#FCFBF6' }, grad);

    const L = {};
    ['links', 'switches', 'ports', 'hosts', 'connector', 'ring', 'chips', 'tags', 'receipts', 'stats', 'meter'].forEach((name) => {
      L[name] = svgEl('g', { class: 'layer layer-' + name }, svg);
    });

    // 链路
    Object.keys(G.hosts).forEach((id) => {
      const h = G.hosts[id];
      const p = G.ports[h.port];
      const edge = M.hostEdge(G, id);
      svgEl('line', { class: 'link', x1: fmt(edge.x), y1: fmt(edge.y), x2: fmt(p.x), y2: fmt(p.y) }, L.links);
    });
    (G.extraLinks || []).forEach((l) => {
      svgEl('line', { class: 'link link-extra', x1: fmt(l.a.x), y1: fmt(l.a.y), x2: fmt(l.b.x), y2: fmt(l.b.y) }, L.links);
      const label = svgEl('text', { class: 'link-label', x: fmt(l.lx), y: fmt(l.ly), 'text-anchor': 'middle' }, L.links);
      label.textContent = l.label;
    });

    // 交换机（面板 + 转发表 + 状态徽标 + 决策行）
    const rows = {};
    const pills = {};
    const lines = {};
    Object.keys(G.switches).forEach((key) => {
      const sw = G.switches[key];
      const t = sw.table;
      const g = svgEl('g', { class: 'sw' }, L.switches);
      svgEl('rect', {
        class: 'sw-body',
        x: sw.x,
        y: sw.y,
        width: sw.w,
        height: sw.h,
        rx: 18,
        fill: `url(#panelGrad-${G.id})`
      }, g);

      const name = svgEl('text', { class: 'sw-name', x: fmt(sw.x + 24), y: fmt(sw.y + 30) }, g);
      name.textContent = sw.name;

      const pillG = svgEl('g', { class: 'pill tone-idle' }, g);
      const pillBg = svgEl('rect', { class: 'pill-bg', y: fmt(sw.y + 15), height: 22, rx: 11 }, pillG);
      const pillText = svgEl('text', { class: 'pill-text', y: fmt(sw.y + 30), 'text-anchor': 'end' }, pillG);
      pills[key] = { g: pillG, bg: pillBg, text: pillText, right: sw.x + sw.w - 20, y: sw.y + 15 };

      svgEl('rect', { class: 'tbl-head-bg', x: t.x, y: t.y, width: t.w, height: t.headH, rx: 8 }, g);
      t.cols.forEach((col) => {
        const head = svgEl('text', { class: 'tbl-head-text', x: col.x, y: fmt(t.y + t.headH - 9), 'text-anchor': col.align }, g);
        head.textContent = col.label;
      });

      const slotsBg = svgEl('g', { class: 'slots' }, g);
      for (let j = 0; j < t.slots; j++) {
        svgEl('rect', {
          class: 'row-slot',
          x: t.x,
          y: fmt(t.y + t.headH + j * t.rowH + 1.5),
          width: t.w,
          height: t.rowH - 4,
          rx: 9
        }, slotsBg);
      }
      const emptyHint = svgEl('text', {
        class: 'tbl-empty',
        x: fmt(t.x + t.w / 2),
        y: fmt(t.y + t.headH + t.rowH / 2 + 4),
        'text-anchor': 'middle'
      }, g);
      emptyHint.textContent = '（空）';

      const rowsG = svgEl('g', { class: 'rows' }, g);
      const slotList = [];
      for (let j = 0; j < t.slots; j++) {
        const rg = svgEl('g', { class: 'row' }, rowsG);
        svgEl('rect', { class: 'row-bg', x: t.x, y: 1.5, width: t.w, height: t.rowH - 4, rx: 9 }, rg);
        const mac = svgEl('text', { class: 'row-mac', x: t.cols[0].x, y: fmt(t.rowH / 2 + 4) }, rg);
        const portCol = t.cols.find((c) => c.key === 'port');
        const badgeW = t.w < 300 ? 58 : 70;
        const portBg = svgEl('rect', {
          class: 'row-port-bg',
          x: fmt(portCol.x - badgeW / 2),
          y: fmt(t.rowH / 2 - 13),
          width: badgeW,
          height: 26,
          rx: 13
        }, rg);
        const portText = svgEl('text', { class: 'row-port-text', x: portCol.x, y: fmt(t.rowH / 2 + 4), 'text-anchor': 'middle' }, rg);
        let ttlText = null;
        let ttlBar = null;
        const ttlCol = t.cols.find((c) => c.key === 'ttl');
        if (ttlCol) {
          ttlText = svgEl('text', { class: 'row-ttl', x: ttlCol.x, y: fmt(t.rowH / 2 + 4), 'text-anchor': 'end' }, rg);
          svgEl('rect', { class: 'ttl-track', x: fmt(ttlCol.x - 56), y: fmt(t.rowH / 2 + 9), width: 56, height: 4, rx: 2 }, rg);
          ttlBar = svgEl('rect', { class: 'ttl-bar', x: fmt(ttlCol.x - 56), y: fmt(t.rowH / 2 + 9), width: 56, height: 4, rx: 2 }, rg);
        }
        slotList.push({ g: rg, mac, portBg, portText, ttlText, ttlBar, y0: t.y + t.headH + j * t.rowH });
      }
      rows[key] = slotList;
      rows['hint' + key] = emptyHint;

      (sw.lines || []).forEach((line) => {
        const lg = svgEl('g', { class: 'decision' }, g);
        const labelEl = svgEl('text', { class: 'line-label', x: line.x, y: line.y }, lg);
        const valueEl = svgEl('text', { class: 'line-value', x: fmt(line.x), y: line.y }, lg);
        lines[line.key] = { g: lg, label: labelEl, value: valueEl, y: line.y, x: line.x };
      });

      if (sw.footer) {
        const foot = svgEl('text', {
          class: 'sw-foot',
          x: fmt(t.x),
          y: fmt(sw.y + sw.h - 20)
        }, g);
        foot.textContent = sw.footer;
      }
    });

    // 端口
    const ports = {};
    Object.keys(G.ports).forEach((key) => {
      const p = G.ports[key];
      const g = svgEl('g', { class: 'port tone-idle', 'data-key': key }, L.ports);
      const ring = svgEl('rect', { class: 'port-ring', x: fmt(p.x - 25), y: fmt(p.y - 20), width: 50, height: 40, rx: 13, opacity: 0 }, g);
      svgEl('rect', { class: 'port-bg', x: fmt(p.x - 18), y: fmt(p.y - 13), width: 36, height: 26, rx: 8 }, g);
      const num = svgEl('text', { class: 'port-text', x: p.x, y: fmt(p.y + 4), 'text-anchor': 'middle' }, g);
      num.textContent = key.split(':')[1];
      const cross = svgEl('text', { class: 'port-x', x: p.x, y: fmt(p.y + 4.5), 'text-anchor': 'middle' }, g);
      cross.textContent = '✕';
      ports[key] = { g, ring, x: p.x, y: p.y };
    });

    // 主机
    const hosts = {};
    Object.keys(G.hosts).forEach((id) => {
      const h = G.hosts[id];
      const left = h.x - h.w / 2;
      const top = h.y - h.h / 2;
      const g = svgEl('g', { class: 'host' }, L.hosts);
      svgEl('rect', { class: 'host-bg', x: fmt(left), y: fmt(top), width: h.w, height: h.h, rx: 14 }, g);
      svgEl('rect', { class: 'host-letter-bg', x: fmt(left + 12), y: fmt(top + 12), width: 30, height: 30, rx: 9 }, g);
      const letter = svgEl('text', { class: 'host-letter', x: fmt(left + 27), y: fmt(top + 32), 'text-anchor': 'middle' }, g);
      letter.textContent = id;
      const name = svgEl('text', { class: 'host-name', x: fmt(left + 52), y: fmt(top + 26) }, g);
      name.textContent = '主机 ' + id;
      const mac = svgEl('text', { class: 'host-mac', x: fmt(left + 12), y: fmt(top + h.h - 12) }, g);
      mac.textContent = M.HOST_MAC[id];
      hosts[id] = { g };
    });

    // 命中连线
    const connectorDot = svgEl('circle', { class: 'connector-dot', r: 3.4, cx: 0, cy: 0, opacity: 0 }, L.connector);
    const connectorCase = svgEl('path', { class: 'connector-case', d: '', fill: 'none' }, L.connector);
    const connector = svgEl('path', { class: 'connector', d: '', fill: 'none' }, L.connector);

    // 环路虚线与风暴
    const ring = svgEl('path', {
      class: 'storm-ring',
      d: G.loopPath ? M.pathD(G.loopPath.concat([G.loopPath[0]])) : '',
      fill: 'none',
      opacity: 0
    }, L.ring);

    // 芯片池
    const chipPool = [];
    for (let i = 0; i < 6; i++) {
      const g = svgEl('g', { class: 'chip tone-blue', visibility: 'hidden' }, L.chips);
      const trail = svgEl('path', { class: 'chip-trail', d: '', fill: 'none' }, g);
      const body = svgEl('g', { class: 'chip-body' }, g);
      const bg = svgEl('rect', { class: 'chip-bg', x: -30, y: -12, width: 60, height: 24, rx: 12 }, body);
      const text = svgEl('text', { class: 'chip-text', x: 0, y: 4, 'text-anchor': 'middle' }, body);
      chipPool.push({ g, body, trail, bg, text });
    }

    // 浮标池
    const tagPool = [];
    for (let i = 0; i < 4; i++) {
      const g = svgEl('g', { class: 'tag tone-blue', visibility: 'hidden' }, L.tags);
      const bg = svgEl('rect', { class: 'tag-bg', x: -40, y: -13, width: 80, height: 26, rx: 13 }, g);
      const text = svgEl('text', { class: 'tag-text', x: 0, y: 4, 'text-anchor': 'middle' }, g);
      tagPool.push({ g, bg, text });
    }

    // 回执池
    const receiptPool = [];
    for (let i = 0; i < 4; i++) {
      const g = svgEl('g', { class: 'receipt tone-green', visibility: 'hidden' }, L.receipts);
      const bg = svgEl('rect', { class: 'receipt-bg', x: -30, y: -12, width: 60, height: 24, rx: 12 }, g);
      const text = svgEl('text', { class: 'receipt-text', x: 0, y: 4, 'text-anchor': 'middle' }, g);
      receiptPool.push({ g, bg, text });
    }

    // 底部计数
    const stats = (G.stats || []).map((s) => {
      const g = svgEl('g', { class: 'stat' }, L.stats);
      const label = svgEl('text', { class: 'stat-label', x: s.x, y: G.statsY - 24, 'text-anchor': 'middle' }, g);
      label.textContent = s.label;
      const value = svgEl('text', { class: 'stat-value', x: s.x, y: G.statsY, 'text-anchor': 'middle' }, g);
      const num = svgEl('tspan', {}, value);
      const unit = svgEl('tspan', { class: 'stat-unit', dx: 6 }, value);
      return { g, num, unit, x: s.x, y: G.statsY };
    });

    // 风暴计量条
    let meter = null;
    if (G.meter) {
      const track = svgEl('rect', { class: 'meter-track', x: G.meter.x, y: G.meter.y, width: G.meter.w, height: G.meter.h, rx: G.meter.h / 2 }, L.meter);
      const fill = svgEl('rect', { class: 'meter-fill', x: G.meter.x, y: G.meter.y, width: 0, height: G.meter.h, rx: G.meter.h / 2 }, L.meter);
      meter = { track, fill, w: G.meter.w };
    }

    stage = { svg, rows, pills, ports, hosts, lines, connector, connectorCase, connectorDot, ring, chipPool, tagPool, receiptPool, stats, meter };
  }

  // ---------- 写画面 ----------

  function paintRows(swKey, slots) {
    const table = S.seq.geom.switches[swKey].table;
    const list = stage.rows[swKey] || [];
    const short = Boolean(table.shortMac);
    let visibleCount = 0;
    list.forEach((slot, j) => {
      const row = slots[j];
      const visible = row && !row.empty && row.alpha > 0.015;
      setAttr(slot.g, 'visibility', visible ? 'visible' : 'hidden');
      if (!visible) return;
      visibleCount++;
      setAttr(slot.g, 'opacity', row.alpha.toFixed(3));
      const ty = slot.y0 + (row.dy || 0);
      const sy = Math.max(0.05, row.sy);
      setAttr(slot.g, 'transform',
        `translate(${fmt(row.shake || 0)} ${fmt(ty)}) translate(0 ${fmt(table.rowH / 2)}) scale(1 ${fmt(sy)}) translate(0 ${fmt(-table.rowH / 2)})`);
      setAttr(slot.g, 'class', 'row tone-' + (row.tone || 'plain'));

      const full = macFull(row.mac);
      setText(slot.mac, short ? '…-' + full.slice(-2) : full);
      setText(slot.portText, '端口 ' + row.port);
      if (slot.ttlText) {
        setText(slot.ttlText, row.ttl == null ? '' : row.ttl + 's');
        const w = row.ttl == null ? 0 : 56 * clamp(row.ttl / 300, 0, 1);
        setAttr(slot.ttlBar, 'width', fmt(w));
        setAttr(slot.ttlBar, 'class', 'ttl-bar' + (row.ttl != null && row.ttl < 60 ? ' tone-warn' : ''));
      }
    });
    const hint = stage.rows['hint' + swKey];
    if (hint) setAttr(hint, 'visibility', visibleCount === 0 ? 'visible' : 'hidden');
  }

  function paintPills(swKey, pill) {
    const p = stage.pills[swKey];
    if (!p) return;
    setText(p.text, pill.text);
    setAttr(p.g, 'class', 'pill tone-' + pill.tone);
    const w = textWidth(pill.text, 10.5) + 20;
    setAttr(p.bg, 'width', fmt(w));
    setAttr(p.bg, 'x', fmt(p.right - w));
    setAttr(p.text, 'x', fmt(p.right - 10));
  }

  function paintLines(lines) {
    Object.keys(stage.lines).forEach((key) => {
      const view = lines[key];
      const el = stage.lines[key];
      if (!view) return;
      const empty = !view.label && (!view.value || view.value === '—');
      setAttr(el.g, 'visibility', empty ? 'hidden' : 'visible');
      if (empty) return;
      const hasLabel = Boolean(view.label);
      setText(el.label, view.label || '');
      setAttr(el.value, 'x', fmt(el.x + (hasLabel ? textWidth(view.label, 10.5) + 14 : 0)));
      setText(el.value, view.value);
      setAttr(el.g, 'class', 'decision tone-' + view.tone);
      setAttr(el.g, 'transform', `translate(0 ${fmt(el.y)}) scale(1 ${fmt(view.sy)}) translate(0 ${fmt(-el.y)})`);
    });
  }

  function paintPorts(ports) {
    Object.keys(stage.ports).forEach((key) => {
      const view = ports[key] || { tone: 'idle', ring: 0 };
      const p = stage.ports[key];
      setAttr(p.g, 'class', 'port tone-' + view.tone);
      const ring = view.ring > 0 ? view.ring : 0;
      setAttr(p.ring, 'opacity', ring > 0 ? (ring * 0.5).toFixed(3) : '0');
      const sc = 1 + 0.3 * (1 - ring);
      setAttr(p.ring, 'transform',
        `translate(${fmt(p.x)} ${fmt(p.y)}) scale(${fmt(sc)}) translate(${fmt(-p.x)} ${fmt(-p.y)})`);
    });
  }

  function paintChips(chips) {
    stage.chipPool.forEach((chip, i) => {
      const c = chips[i];
      if (!c) {
        setAttr(chip.g, 'visibility', 'hidden');
        return;
      }
      setAttr(chip.g, 'visibility', c.alpha > 0.02 ? 'visible' : 'hidden');
      if (c.alpha <= 0.02) return;
      setAttr(chip.g, 'opacity', c.alpha.toFixed(3));
      setAttr(chip.g, 'class', 'chip tone-' + c.tone);
      setAttr(chip.body, 'transform', `translate(${fmt(c.x)} ${fmt(c.y)}) scale(${fmt(c.scale || 1)})`);
      setText(chip.text, c.label);
      setAttr(chip.trail, 'd', c.trail || '');
      const w = Math.max(46, textWidth(c.label, 10.5) + 24);
      setAttr(chip.bg, 'width', fmt(w));
      setAttr(chip.bg, 'x', fmt(-w / 2));
    });
  }

  function paintTags(tags) {
    stage.tagPool.forEach((tag, i) => {
      const t = tags[i];
      if (!t || t.alpha <= 0.02) {
        setAttr(tag.g, 'visibility', 'hidden');
        return;
      }
      setAttr(tag.g, 'visibility', 'visible');
      setAttr(tag.g, 'opacity', t.alpha.toFixed(3));
      setAttr(tag.g, 'class', 'tag tone-' + t.tone);
      setAttr(tag.g, 'transform', `translate(${fmt(t.x)} ${fmt(t.y)})`);
      setText(tag.text, t.text);
      const w = textWidth(t.text, 11) + 24;
      setAttr(tag.bg, 'width', fmt(w));
      setAttr(tag.bg, 'x', fmt(-w / 2));
    });
  }

  function paintReceipts(receipts) {
    stage.receiptPool.forEach((receipt, i) => {
      const r = receipts[i];
      if (!r || r.alpha <= 0.02) {
        setAttr(receipt.g, 'visibility', 'hidden');
        return;
      }
      setAttr(receipt.g, 'visibility', 'visible');
      setAttr(receipt.g, 'opacity', r.alpha.toFixed(3));
      setAttr(receipt.g, 'class', 'receipt tone-' + r.tone);
      const s = 0.85 + 0.15 * Math.min(1, r.alpha * 1.6);
      setAttr(receipt.g, 'transform', `translate(${fmt(r.x)} ${fmt(r.y)}) scale(${fmt(s)})`);
      setText(receipt.text, r.text);
      const w = textWidth(r.text, 10.5) + 22;
      setAttr(receipt.bg, 'width', fmt(w));
      setAttr(receipt.bg, 'x', fmt(-w / 2));
    });
  }

  function paintStats(stats) {
    (stage.stats || []).forEach((slot, i) => {
      const s = stats[i];
      if (!s) return;
      setText(slot.num, String(s.value));
      setText(slot.unit, s.unit || '');
      setAttr(slot.g, 'class', 'stat tone-' + (s.tone || 'ink'));
      const sc = s.pop || 1;
      setAttr(slot.g, 'transform',
        `translate(${fmt(slot.x)} ${fmt(slot.y)}) scale(${fmt(sc)}) translate(${fmt(-slot.x)} ${fmt(-slot.y)})`);
    });
  }

  function paintConnector(conn) {
    if (!conn) {
      setAttr(stage.connector, 'opacity', '0');
      setAttr(stage.connectorCase, 'opacity', '0');
      setAttr(stage.connectorDot, 'opacity', '0');
      return;
    }
    if (conn.from) {
      setAttr(stage.connectorDot, 'cx', fmt(conn.from.x));
      setAttr(stage.connectorDot, 'cy', fmt(conn.from.y));
      setAttr(stage.connectorDot, 'opacity', (conn.dot * 0.9).toFixed(3));
    }
    setAttr(stage.connector, 'd', conn.d);
    setAttr(stage.connector, 'opacity', conn.alpha.toFixed(3));
    setAttr(stage.connector, 'class', 'connector tone-' + conn.tone);
    setAttr(stage.connectorCase, 'd', conn.d);
    setAttr(stage.connectorCase, 'opacity', conn.alpha.toFixed(3));
  }

  function paintStorm(storm) {
    const el = stage.ring;
    if (!storm) {
      setAttr(el, 'opacity', '0');
      return;
    }
    setAttr(el, 'opacity', storm.alpha.toFixed(3));
    setAttr(el, 'stroke-dashoffset', fmt(storm.dash));
  }

  function paintMeter(value) {
    if (!stage.meter) return;
    const v = clamp(value || 0, 0, 1);
    setAttr(stage.meter.track, 'opacity', v > 0.01 ? '1' : '0');
    setAttr(stage.meter.fill, 'width', fmt(stage.meter.w * v));
    setAttr(stage.meter.fill, 'opacity', v > 0.01 ? '0.75' : '0');
  }

  function paint(f) {
    setText(els.phase, f.phase);
    setText(els.stepCount, `第 ${f.index + 1} / ${f.count} 步`);
    setText(els.framePill, f.frame === '—' || !f.frame ? '无在途帧' : '当前帧 ' + f.frame);
    setText(els.caption, f.caption);
    setText(els.scrubText, `${S.t.toFixed(1)} s / ${S.total.toFixed(1)} s`);

    Object.keys(f.rows).forEach((sw) => paintRows(sw, f.rows[sw]));
    Object.keys(f.pills).forEach((sw) => paintPills(sw, f.pills[sw]));
    paintLines(f.lines);
    paintPorts(f.ports);
    paintChips(f.chips);
    paintTags(f.tags);
    paintReceipts(f.receipts);
    paintStats(f.stats);
    paintConnector(f.connector);
    paintStorm(f.storm);
    paintMeter(f.meter);

    document.body.classList.toggle('is-storm', Boolean(f.storm));

    // 步骤条
    if (stage && stage.pips) {
      stage.pips.forEach((pip, i) => {
        pip.classList.toggle('is-current', i === f.index);
        pip.classList.toggle('is-done', i < f.index);
      });
    }
    if (document.activeElement !== els.progress) els.progress.value = String(S.t);
  }

  function render() {
    if (!S.seq) return;
    const loc = M.locate(S.seq, S.t);
    S.i = loc.index;
    S.p = loc.p;
    paint(M.frameOf(S.seq, loc.index, loc.p));
    syncUI();
  }

  // ---------- 控件 ----------

  function syncUI() {
    const end = S.total > 0 && S.t >= S.total - 0.002;
    els.progress.max = String(S.total);
    setText(els.playText, S.playing ? '暂停' : '播放');
    setText(els.playIcon, S.playing ? '❚❚' : '▶');
    els.play.disabled = !hasGsap && !S.reduce;
    els.prev.disabled = S.t <= 0.001;
    els.next.disabled = end;
    els.replay.disabled = false;
    els.lamp.classList.toggle('is-running', S.playing);
    document.body.classList.toggle('is-playing', S.playing);
    document.body.classList.toggle('is-reduced', S.reduce);
    els.reduce.checked = S.reduce;
    els.stpBtn.setAttribute('aria-pressed', String(S.stp));
    els.stpBtn.textContent = S.stp ? '生成树：已开启' : '生成树破环';
    els.stpBtn.classList.toggle('is-on', S.stp);
    els.stpBtn.disabled = S.view !== 'loop';
    document.querySelectorAll('[data-view]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.view === S.view));
    });
    document.querySelectorAll('[data-speed]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === S.speed));
    });
    els.notice.hidden = hasGsap;
    if (!hasGsap) {
      setText(els.notice, S.reduce
        ? '未加载动画引擎（GSAP）。减少动效模式下仍可自动播放，每步直接跳转。'
        : '未加载动画引擎（GSAP），播放已停用。可开启「减少动效」自动播放，或用单步与进度条浏览。');
    }
    setText(els.hint, S.view === 'loop'
      ? '两条冗余链路会让同一帧出现两份副本'
      : '进门看源 MAC，出门看目的 MAC，表项会老化');
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

  function setTime(t, keepPlaying) {
    killTween();
    clearDwell();
    S.t = clamp(Number(t) || 0, 0, S.total);
    if (!keepPlaying) S.playing = false;
    render();
    writeLink();
  }

  function seekBeat(index) {
    const start = S.starts[clamp(index, 0, S.seq.beats.length - 1)];
    setTime(start + 0.001);
  }

  function play() {
    if (!S.seq || (!hasGsap && !S.reduce)) return;
    if (S.t >= S.total - 0.002) {
      S.t = 0;
      render();
    }
    S.playing = true;
    if (S.reduce) stepLoop();
    else startTween();
    syncUI();
  }

  function startTween() {
    const obj = { t: S.t };
    tween = window.gsap.to(obj, {
      t: S.total,
      duration: Math.max(0.02, S.total - S.t),
      ease: 'none',
      onUpdate: () => {
        S.t = obj.t;
        render();
      },
      onComplete: () => {
        tween = null;
        S.t = S.total;
        S.playing = false;
        render();
        writeLink();
      }
    });
    tween.timeScale(S.speed);
  }

  function stepLoop() {
    if (!S.playing) return;
    const loc = M.locate(S.seq, S.t);
    const nextStart = S.starts[loc.index + 1];
    const boundary = nextStart == null ? S.total : nextStart;
    S.t = boundary;
    render();
    if (boundary >= S.total - 0.002) {
      S.playing = false;
      syncUI();
      writeLink();
      return;
    }
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      writeLink();
      stepLoop();
    }, (DWELL * 1000) / S.speed);
  }

  function pause() {
    killTween();
    clearDwell();
    S.playing = false;
    render();
    writeLink();
  }

  function togglePlay() {
    if (S.playing) pause();
    else play();
  }

  function stepBy(dir) {
    killTween();
    clearDwell();
    S.playing = false;
    const loc = M.locate(S.seq, S.t);
    if (dir > 0) {
      const target = S.starts[loc.index + 1];
      setTime(target == null ? S.total : target);
    } else {
      const target = loc.p > 0.06 ? S.starts[loc.index] : S.starts[Math.max(0, loc.index - 1)];
      setTime(target);
    }
  }

  function setSpeed(spd) {
    S.speed = spd;
    if (tween) tween.timeScale(spd);
    syncUI();
    writeLink();
  }

  function loadView(view, opts) {
    const keepTime = opts && opts.keepTime;
    S.view = view;
    S.seq = view === 'loop' ? M.buildLoop(S.stp) : M.buildSingle();
    const b = M.beatStarts(S.seq);
    S.starts = b.starts;
    S.total = b.total;
    buildStage(S.seq);
    buildTrack();
    if (!keepTime) S.t = 0;
    S.t = clamp(S.t, 0, S.total);
    S.playing = false;
    killTween();
    clearDwell();
    render();
    writeLink();
  }

  function toggleStp() {
    S.stp = !S.stp;
    S.t = 0;
    loadView('loop');
  }

  // ---------- 步骤条 ----------

  function buildTrack() {
    els.track.innerHTML = '';
    const pips = [];
    const groups = S.seq.groups || [];
    groups.forEach((group, gi) => {
      const end = gi + 1 < groups.length ? groups[gi + 1].from : S.seq.beats.length;
      const wrap = document.createElement('div');
      wrap.className = 'track-group';
      const label = document.createElement('span');
      label.className = 'track-label';
      label.textContent = group.label;
      const row = document.createElement('div');
      row.className = 'track-pips';
      for (let k = group.from; k < end; k++) {
        const beat = S.seq.beats[k];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pip';
        btn.textContent = String(k + 1);
        btn.title = `${beat.phase} · ${beat.caption}`;
        btn.setAttribute('aria-label', `第 ${k + 1} 步：${beat.phase}，${beat.caption}`);
        btn.addEventListener('click', () => {
          pause();
          seekBeat(k);
        });
        row.appendChild(btn);
        pips.push(btn);
      }
      wrap.appendChild(label);
      wrap.appendChild(row);
      els.track.appendChild(wrap);
    });
    stage.pips = pips;
  }

  // ---------- 地址栏 ----------

  function writeLink() {
    if (linkTimer) {
      clearTimeout(linkTimer);
      linkTimer = null;
    }
    const wait = S.playing ? 300 : 0;
    if (wait > 0) {
      linkTimer = setTimeout(() => {
        linkTimer = null;
        writeLinkNow();
      }, wait);
      return;
    }
    writeLinkNow();
  }

  function writeLinkNow() {
    try {
      const params = new URLSearchParams();
      params.set('v', S.view);
      params.set('t', S.t.toFixed(2));
      if (S.view === 'loop' && S.stp) params.set('stp', '1');
      history.replaceState(null, '', `#${params.toString()}`);
    } catch (e) {
      // 本地环境可能不允许改写地址，演示照常可用
    }
  }

  function readLink() {
    const out = { view: 'loop', t: 0, stp: false };
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.get('v') === 'single') out.view = 'single';
      if (params.get('v') === 'loop') out.view = 'loop';
      if (params.get('stp') === '1') out.stp = true;
      const t = Number(params.get('t'));
      if (Number.isFinite(t) && t >= 0) out.t = t;
    } catch (e) {
      // 地址栏不可读时按默认状态开始
    }
    return out;
  }

  // ---------- 事件 ----------

  function bind() {
    els.play.addEventListener('click', togglePlay);
    els.prev.addEventListener('click', () => stepBy(-1));
    els.next.addEventListener('click', () => stepBy(1));
    els.replay.addEventListener('click', () => setTime(0));
    els.progress.addEventListener('input', () => {
      setTime(Number(els.progress.value));
    });
    els.reduce.addEventListener('change', () => {
      S.reduce = els.reduce.checked;
      if (S.playing) {
        killTween();
        clearDwell();
        if (S.reduce) stepLoop();
        else startTween();
      }
      syncUI();
    });
    els.stpBtn.addEventListener('click', toggleStp);
    document.querySelectorAll('[data-view]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.view === S.view) return;
        S.t = 0;
        loadView(b.dataset.view);
      });
    });
    document.querySelectorAll('[data-speed]').forEach((b) => {
      b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
    });

    document.addEventListener('keydown', (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.closest('input, select, textarea, button, a')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        stepBy(1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        stepBy(-1);
      } else if (e.code === 'Home') {
        e.preventDefault();
        setTime(0);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && S.playing) pause();
    });
  }

  // ---------- 启动 ----------

  function init() {
    const start = readLink();
    S.stp = start.stp;
    bind();
    loadView(start.view, { keepTime: true });
    S.t = clamp(start.t, 0, S.total);
    render();
    writeLinkNow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
