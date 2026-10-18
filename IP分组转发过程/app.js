/**
 * IP 分组转发过程 —— 界面层
 * 只负责把 model.frameOf 算出的画面写进 SVG 与判断台/查表台，
 * 以及控件、键盘、地址栏、减少动效与降级。
 */
(function () {
  'use strict';

  const M = window.IPModel;
  const NS = 'http://www.w3.org/2000/svg';
  let hasGsap = typeof window.gsap !== 'undefined';
  const DWELL = 0.9;

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmt = (v) => (Math.round(v * 1000) / 1000).toString();
  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  const S = {
    scenario: 1,
    seq: null,
    starts: [],
    total: 0,
    t: 0,
    playing: false,
    speed: 1,
    reduce: reduceQuery ? reduceQuery.matches : false
  };

  const els = {
    stage: $('stage'),
    track: $('track'),
    stepCount: $('step-count'),
    phase: $('phase'),
    routePill: $('route-pill'),
    lamp: $('lamp'),
    caption: $('caption'),
    inspectBadge: $('inspect-badge'),
    inspectSub: $('inspect-sub'),
    inspectLegend: $('inspect-legend'),
    inspectBody: $('inspect-body'),
    frameIp: $('frame-ip'),
    frameSrcMac: $('frame-src-mac'),
    frameDstMac: $('frame-dst-mac'),
    frameTtl: $('frame-ttl'),
    frameSeg: $('frame-seg'),
    frameSegPips: $('frame-seg-pips'),
    stageProgressFill: $('stage-progress-fill'),
    play: $('play'),
    playIcon: $('play-icon'),
    playText: $('play-text'),
    prev: $('prev'),
    next: $('next'),
    replay: $('replay'),
    progress: $('progress'),
    scrubText: $('scrub-text'),
    reduce: $('reduce'),
    notice: $('notice')
  };

  let stage = null;
  let tween = null;
  let dwellTimer = null;
  let linkTimer = null;
  let lastInspectorKey = '';
  let lastTtl = null;

  // ---------- 小工具 ----------

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function setAttr(el, name, value) {
    if (!el) return;
    const v = String(value);
    if (el.getAttribute(name) !== v) el.setAttribute(name, v);
  }

  function setClass(el, value) {
    if (el && el.getAttribute('class') !== value) el.setAttribute('class', value);
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
    for (const ch of String(text)) {
      w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.62;
    }
    return w;
  }

  function setFrameValue(el, text, flash) {
    if (!el) return;
    const prev = el.dataset.v;
    if (prev === text) return;
    el.dataset.v = text;
    el.textContent = text;
    if (flash && prev !== undefined) {
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      clearTimeout(el._flashTimer);
      el._flashTimer = setTimeout(() => el.classList.remove('flash'), 540);
    }
  }

  function beatStart(index) {
    return S.starts[clamp(index, 0, S.starts.length - 1)];
  }

  // ---------- 舞台构建 ----------

  function buildStage() {
    const svg = els.stage;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', M.GEO.viewBox.join(' '));

    const defs = svgEl('defs', {}, svg);
    const shadow = svgEl('filter', { id: 'soft-shadow', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
    svgEl('feDropShadow', { dx: '0', dy: '2', stdDeviation: '3', 'flood-opacity': '0.07' }, shadow);
    const pshadow = svgEl('filter', { id: 'packet-shadow', x: '-40%', y: '-40%', width: '180%', height: '180%' }, defs);
    svgEl('feDropShadow', { dx: '0', dy: '2', stdDeviation: '2.5', 'flood-opacity': '0.22' }, pshadow);

    const L = {};
    ['subnets', 'links', 'active', 'nodes', 'pulses', 'trail', 'chevrons', 'packet', 'tags'].forEach((name) => {
      L[name] = svgEl('g', { class: 'layer layer-' + name }, svg);
    });

    // 子网
    const subnets = {};
    Object.keys(M.GEO.subnets).forEach((id) => {
      const g0 = M.GEO.subnets[id];
      const g = svgEl('g', { class: 'subnet', id: 'subnet-' + id }, L.subnets);
      svgEl('rect', { class: 'subnet-box', x: g0.x, y: g0.y, width: g0.w, height: g0.h, rx: 16 }, g);
      const name = svgEl('text', { class: 'subnet-name', x: g0.x + 18, y: g0.y + g0.h - 32 }, g);
      name.textContent = id;
      const label = svgEl('text', { class: 'subnet-label', x: g0.x + 18, y: g0.y + g0.h - 16 }, g);
      label.textContent = M.SUBNETS[id].label;
      subnets[id] = g;
    });

    // 链路
    const links = {};
    Object.keys(M.GEO.paths).forEach((key) => {
      const p = M.GEO.paths[key];
      const line = svgEl('line', {
        class: 'link' + (p.subnet === 'N2' ? ' is-n2' : ''),
        id: 'link-' + p.id,
        x1: fmt(p.from.x),
        y1: fmt(p.from.y),
        x2: fmt(p.to.x),
        y2: fmt(p.to.y)
      }, L.links);
      links[p.id] = line;
    });

    const activeHalo = svgEl('line', {
      class: 'active-halo',
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0
    }, L.active);

    const activeLink = svgEl('line', {
      class: 'active-link',
      id: 'active-link',
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0
    }, L.active);

    // 节点
    const nodes = {};
    const hostRoles = {};

    Object.keys(M.GEO.hosts).forEach((id) => {
      const h = M.HOSTS[id];
      const g0 = M.GEO.hosts[id];
      const x0 = g0.x - g0.w / 2;
      const y0 = g0.y - g0.h / 2;
      const g = svgEl('g', { class: 'node host', id: 'node-' + id, 'data-type': 'host' }, L.nodes);
      svgEl('rect', { class: 'node-ring', x: fmt(x0 - 4), y: fmt(y0 - 4), width: fmt(g0.w + 8), height: fmt(g0.h + 8), rx: 14 }, g);
      svgEl('rect', { class: 'host-card', x: fmt(x0), y: fmt(y0), width: g0.w, height: g0.h, rx: 11 }, g);
      svgEl('rect', { class: 'host-name-bg', x: fmt(x0 + 10), y: fmt(y0 + 11), width: 34, height: 22, rx: 6 }, g);
      const name = svgEl('text', { class: 'host-name', x: fmt(x0 + 27), y: fmt(y0 + 26), 'text-anchor': 'middle' }, g);
      name.textContent = id;
      const ip = svgEl('text', { class: 'host-ip', x: fmt(x0 + 50), y: fmt(y0 + 26) }, g);
      ip.textContent = h.ip;
      if (h.gateway) {
        const gw = svgEl('text', { class: 'host-gw', x: fmt(x0 + 11), y: fmt(y0 + 58) }, g);
        gw.textContent = '默认网关 ' + h.gateway;
      }
      const role = svgEl('text', {
        class: 'host-role',
        x: fmt(x0 + g0.w + 6),
        y: fmt(y0 - 8),
        'text-anchor': 'start',
        visibility: 'hidden'
      }, g);
      hostRoles[id] = role;
      nodes[id] = g;
    });

    Object.keys(M.GEO.switches).forEach((id) => {
      const g0 = M.GEO.switches[id];
      const g = svgEl('g', { class: 'node switch', id: 'node-' + id, 'data-type': 'switch' }, L.nodes);
      svgEl('rect', { class: 'node-ring', x: fmt(g0.x - 26), y: fmt(g0.y - 26), width: 52, height: 52, rx: 12 }, g);
      svgEl('rect', { class: 'switch-body', x: fmt(g0.x - 22), y: fmt(g0.y - 22), width: 44, height: 44, rx: 10 }, g);
      svgEl('path', {
        class: 'switch-icon',
        d: `M${fmt(g0.x - 12)} ${fmt(g0.y - 7)} L${fmt(g0.x + 12)} ${fmt(g0.y - 7)} M${fmt(g0.x + 8)} ${fmt(g0.y - 11)} L${fmt(g0.x + 12)} ${fmt(g0.y - 7)} L${fmt(g0.x + 8)} ${fmt(g0.y - 3)} M${fmt(g0.x + 12)} ${fmt(g0.y + 7)} L${fmt(g0.x - 12)} ${fmt(g0.y + 7)} M${fmt(g0.x - 8)} ${fmt(g0.y + 3)} L${fmt(g0.x - 12)} ${fmt(g0.y + 7)} L${fmt(g0.x - 8)} ${fmt(g0.y + 11)}`
      }, g);
      const label = svgEl('text', { class: 'node-label', x: fmt(g0.x), y: fmt(g0.y + 39) }, g);
      label.textContent = id;
      nodes[id] = g;
    });

    Object.keys(M.GEO.routers).forEach((id) => {
      const g0 = M.GEO.routers[id];
      const r = g0.r;
      const g = svgEl('g', { class: 'node router', id: 'node-' + id, 'data-type': 'router' }, L.nodes);
      svgEl('circle', { class: 'node-ring', cx: fmt(g0.x), cy: fmt(g0.y), r: r + 8 }, g);
      svgEl('circle', { class: 'router-body', cx: fmt(g0.x), cy: fmt(g0.y), r: r }, g);
      svgEl('path', {
        class: 'router-icon',
        d: `M${fmt(g0.x - 16)} ${fmt(g0.y)} L${fmt(g0.x + 16)} ${fmt(g0.y)} M${fmt(g0.x + 11)} ${fmt(g0.y - 4)} L${fmt(g0.x + 16)} ${fmt(g0.y)} L${fmt(g0.x + 11)} ${fmt(g0.y + 4)} M${fmt(g0.x + 5)} ${fmt(g0.y - 4)} L${fmt(g0.x)} ${fmt(g0.y)} L${fmt(g0.x + 5)} ${fmt(g0.y + 4)} M${fmt(g0.x)} ${fmt(g0.y - 16)} L${fmt(g0.x)} ${fmt(g0.y + 16)} M${fmt(g0.x - 4)} ${fmt(g0.y - 11)} L${fmt(g0.x)} ${fmt(g0.y - 16)} L${fmt(g0.x + 4)} ${fmt(g0.y - 11)} M${fmt(g0.x - 4)} ${fmt(g0.y + 11)} L${fmt(g0.x)} ${fmt(g0.y + 16)} L${fmt(g0.x + 4)} ${fmt(g0.y + 11)}`
      }, g);
      const name = svgEl('text', { class: 'router-name', x: fmt(g0.x), y: fmt(g0.y - r - 12) }, g);
      name.textContent = id;
      M.ROUTERS[id].ifaces.forEach((f) => {
        const x = f.idx === 0 ? g0.x - r : g0.x + r;
        svgEl('circle', { class: 'iface-dot', cx: fmt(x), cy: fmt(g0.y), r: 5.5 }, g);
        const num = svgEl('text', { class: 'iface-num', x: fmt(x), y: fmt(g0.y + 2.7) }, g);
        num.textContent = String(f.idx);
        const ip = svgEl('text', { class: 'iface-ip', x: fmt(x), y: fmt(g0.y + r + 21), 'text-anchor': 'middle' }, g);
        ip.textContent = f.ip;
      });
      nodes[id] = g;
    });

    // 到站/交付脉冲
    const pulses = [];
    for (let i = 0; i < 3; i++) {
      pulses.push(svgEl('circle', { class: 'pulse-ring', cx: 0, cy: 0, r: 0, opacity: 0 }, L.pulses));
    }

    // 链路方向箭头
    const chevrons = [];
    for (let i = 0; i < 3; i++) {
      chevrons.push(svgEl('path', { class: 'chevron', d: 'M-5 -5 L3 0 L-5 5', opacity: 0 }, L.chevrons));
    }

    // 拖尾
    const trail = [];
    for (let i = 0; i < 3; i++) {
      trail.push(svgEl('circle', { class: 'trail-dot', cx: 0, cy: 0, r: 3.4, opacity: 0 }, L.trail));
    }

    // 分组
    const packet = svgEl('g', { class: 'packet', id: 'packet', visibility: 'hidden' }, L.packet);
    const halo = svgEl('circle', { class: 'packet-halo', cx: 0, cy: 0, r: 29, opacity: 0 }, packet);
    svgEl('rect', { class: 'packet-bg', x: -32, y: -17, width: 64, height: 34, rx: 9 }, packet);
    const pTitle = svgEl('text', { class: 'packet-title', x: 0, y: -2 }, packet);
    pTitle.textContent = 'IP 分组';
    const pTtl = svgEl('text', { class: 'packet-ttl', x: 0, y: 11 }, packet);
    pTtl.textContent = 'TTL 64';

    // 浮标
    const tags = [];
    for (let i = 0; i < 4; i++) {
      const g = svgEl('g', { class: 'tag', visibility: 'hidden' }, L.tags);
      const bg = svgEl('rect', { class: 'tag-bg', x: -40, y: -12, width: 80, height: 24, rx: 12 }, g);
      const text = svgEl('text', { class: 'tag-text', x: 0, y: 4 }, g);
      tags.push({ g, bg, text });
    }

    stage = {
      svg,
      subnets,
      links,
      activeLink,
      activeHalo,
      nodes,
      hostRoles,
      pulses,
      chevrons,
      trail,
      packet,
      halo,
      pTtl,
      tags,
      pips: []
    };
  }

  // ---------- 写画面 ----------

  function paint(f) {
    setText(els.phase, f.phase);
    setText(els.stepCount, `第 ${f.index + 1} / ${f.count} 步`);
    setText(els.routePill, f.route);
    setText(els.caption, f.caption);
    setText(els.scrubText, `${S.t.toFixed(1)} s / ${S.total.toFixed(1)} s`);
    els.lamp.classList.toggle('is-running', S.playing);
    if (els.stageProgressFill) {
      els.stageProgressFill.style.transform = `scaleX(${((f.index + f.progress) / f.count).toFixed(4)})`;
    }

    Object.keys(stage.subnets).forEach((id) => {
      stage.subnets[id].classList.toggle('is-active', f.subnet === id);
    });

    Object.keys(stage.nodes).forEach((id) => {
      const type = stage.nodes[id].getAttribute('data-type');
      const tone = f.focus[id];
      setClass(stage.nodes[id], 'node ' + type + (tone ? ' is-' + tone : ''));
    });

    Object.keys(stage.hostRoles).forEach((id) => {
      const el = stage.hostRoles[id];
      let role = '';
      let tone = '';
      if (id === S.seq.src) {
        role = '源';
        tone = 'blue';
      }
      if (id === S.seq.dst) {
        role = f.stats.delivered ? '已收' : '目的';
        tone = 'green';
      }
      setAttr(el, 'visibility', role ? 'visible' : 'hidden');
      setText(el, role);
      setClass(el, 'host-role' + (tone ? ' tone-' + tone : ''));
    });

    if (f.link) {
      [stage.activeHalo, stage.activeLink].forEach((line) => {
        setAttr(line, 'x1', fmt(f.link.from.x));
        setAttr(line, 'y1', fmt(f.link.from.y));
        setAttr(line, 'x2', fmt(f.link.pos.x));
        setAttr(line, 'y2', fmt(f.link.pos.y));
      });
      setAttr(stage.activeLink, 'opacity', f.link.q > 0 ? '0.9' : '0');
      setAttr(stage.activeHalo, 'opacity', f.link.q > 0 ? '0.13' : '0');
    } else {
      setAttr(stage.activeLink, 'opacity', '0');
      setAttr(stage.activeHalo, 'opacity', '0');
    }
    Object.keys(stage.links).forEach((id) => {
      stage.links[id].classList.toggle('is-current', Boolean(f.link && f.link.id === id));
    });

    stage.pulses.forEach((ring, i) => {
      const pulse = f.pulses[i];
      if (!pulse || pulse.alpha <= 0.02) {
        setAttr(ring, 'opacity', '0');
        return;
      }
      setAttr(ring, 'opacity', pulse.alpha.toFixed(3));
      setAttr(ring, 'cx', fmt(pulse.x));
      setAttr(ring, 'cy', fmt(pulse.y));
      setAttr(ring, 'r', fmt(pulse.r));
      setAttr(ring, 'stroke', pulse.tone === 'green' ? '#2d7d62' : pulse.tone === 'gold' ? '#8f6619' : '#2563eb');
    });

    stage.chevrons.forEach((chevron, i) => {
      const c = f.chevrons[i];
      if (!c || c.alpha <= 0.02) {
        setAttr(chevron, 'opacity', '0');
        return;
      }
      setAttr(chevron, 'opacity', c.alpha.toFixed(3));
      setAttr(chevron, 'transform', `translate(${fmt(c.x)} ${fmt(c.y)}) rotate(${fmt(c.angle)})`);
    });

    stage.trail.forEach((dot, i) => {
      const t = f.trail[i];
      if (!t) {
        setAttr(dot, 'opacity', '0');
        return;
      }
      setAttr(dot, 'cx', fmt(t.x));
      setAttr(dot, 'cy', fmt(t.y));
      setAttr(dot, 'opacity', t.alpha.toFixed(3));
    });

    const p = f.packet;
    const visible = p.alpha > 0.02;
    setAttr(stage.packet, 'visibility', visible ? 'visible' : 'hidden');
    if (visible) {
      setAttr(stage.packet, 'opacity', p.alpha.toFixed(3));
      setAttr(stage.packet, 'transform', `translate(${fmt(p.x)} ${fmt(p.y)}) scale(${fmt(p.scale)})`);
      setAttr(stage.halo, 'opacity', (p.halo * 0.6).toFixed(3));
      setAttr(stage.halo, 'stroke', f.kind === 'lookup' ? '#8f6619' : '#2563eb');
      setText(stage.pTtl, 'TTL ' + f.frame.ttl);
      if (lastTtl !== null && f.frame.ttl !== lastTtl) {
        stage.pTtl.classList.remove('ttl-flash');
        void stage.pTtl.getBoundingClientRect();
        stage.pTtl.classList.add('ttl-flash');
        clearTimeout(stage._ttlTimer);
        stage._ttlTimer = setTimeout(() => stage.pTtl.classList.remove('ttl-flash'), 620);
      }
    }
    lastTtl = f.frame.ttl;

    stage.tags.forEach((tagEl, i) => {
      const t = f.tags[i];
      if (!t || t.alpha <= 0.02) {
        setAttr(tagEl.g, 'visibility', 'hidden');
        return;
      }
      setAttr(tagEl.g, 'visibility', 'visible');
      setAttr(tagEl.g, 'opacity', t.alpha.toFixed(3));
      setClass(tagEl.g, 'tag tone-' + t.tone);
      setAttr(tagEl.g, 'transform', `translate(${fmt(t.x)} ${fmt(t.y)})`);
      setText(tagEl.text, t.text);
      const w = textWidth(t.text, 10.5) + 24;
      setAttr(tagEl.bg, 'width', fmt(w));
      setAttr(tagEl.bg, 'x', fmt(-w / 2));
    });

    paintFrame(f);
    paintInspector(f);

    stage.pips.forEach((pip, i) => {
      pip.classList.toggle('is-current', i === f.index);
      pip.classList.toggle('is-done', i < f.index);
      pip.setAttribute('aria-current', i === f.index ? 'step' : 'false');
    });

    if (document.activeElement !== els.progress) els.progress.value = String(S.t);
  }

  function paintFrame(f) {
    setText(els.frameIp, `${f.frame.ipSrc} → ${f.frame.ipDst}`);
    setFrameValue(
      els.frameSrcMac,
      f.frame.decided ? f.frame.srcMac : '—',
      true
    );
    setFrameValue(
      els.frameDstMac,
      f.frame.decided ? f.frame.dstMac : '待判断后封装',
      true
    );
    els.frameDstMac.title = f.frame.decided ? f.frame.macReason : '源主机判断目的网络后再封装帧头';
    setFrameValue(els.frameTtl, String(f.frame.ttl), true);
    els.frameTtl.classList.toggle('is-low', f.frame.ttl < 64);
    setText(els.frameSeg, f.frame.seg === 0 ? '待封装' : `${f.frame.seg}/${f.frame.segTotal}`);
    els.frameSeg.classList.toggle('is-new', f.frame.seg > 0 && f.frame.seg === f.frame.segTotal);
    Array.from(els.frameSegPips.children).forEach((pip, i) => {
      pip.className = 'seg-pip' + (i < f.frame.seg - 1 ? ' is-done' : i === f.frame.seg - 1 ? ' is-current' : '');
    });
  }

  function buildSegPips(total) {
    els.frameSegPips.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const pip = document.createElement('span');
      pip.className = 'seg-pip';
      pip.textContent = String(i + 1);
      els.frameSegPips.appendChild(pip);
    }
  }

  // ---------- 判断台 / 查表台 ----------

  function setInspectHead(badge, sub, tone, showLegend) {
    setText(els.inspectBadge, badge);
    setClass(els.inspectBadge, 'inspect-badge' + (tone ? ' tone-' + tone : ''));
    setText(els.inspectSub, sub);
    els.inspectLegend.style.display = showLegend ? 'flex' : 'none';
  }

  function buildBits(container, bits, baseClass, prefix) {
    container.innerHTML = '';
    const cells = [];
    for (let i = 0; i < 32; i++) {
      const cell = document.createElement('span');
      let cls = 'bit ' + baseClass;
      if (baseClass === 'and') cls = 'bit and';
      else cls += i < prefix ? ' net' : ' host';
      if (i === prefix - 1) cls += ' is-boundary';
      cell.className = cls;
      cell.textContent = bits[i];
      container.appendChild(cell);
      cells.push(cell);
      if (i % 8 === 7 && i < 31) {
        const gap = document.createElement('i');
        gap.className = 'byte-gap';
        container.appendChild(gap);
      }
    }
    return cells;
  }

  function buildInspector(f) {
    const key =
      f.kind === 'lookup'
        ? 'lookup-' + f.lookup.router
        : f.kind === 'move'
          ? 'move-' + S.seq.beats[f.index].fromId + '-' + S.seq.beats[f.index].toId
          : f.kind === 'finish'
            ? 'finish-' + S.seq.dst
            : 'check';

    if (key === lastInspectorKey) return;
    lastInspectorKey = key;
    const body = els.inspectBody;

    if (f.kind === 'check') {
      const c = f.check;
      body.innerHTML = `
        <div class="bit-row">
          <div class="bit-label">目的 IP</div>
          <div class="bits-scroll"><div class="bits" id="chk-bits-dest"></div></div>
          <div class="bit-decimal">${c.dstIp}</div>
        </div>
        <div class="bit-row">
          <div class="bit-label">子网掩码 /${c.prefix}</div>
          <div class="bits-scroll"><div class="bits" id="chk-bits-mask"></div></div>
          <div class="bit-decimal">${c.mask}</div>
        </div>
        <div class="bit-row">
          <div class="bit-label">按位与 AND</div>
          <div class="bits-scroll"><div class="bits" id="chk-bits-and"></div></div>
          <div class="bit-decimal" id="chk-and-dec">…</div>
        </div>
        <div class="and-meter">
          <span class="meter-label" id="chk-scan-label">逐位相与 0 / 32</span>
          <span class="meter-track"><i id="chk-meter-fill"></i></span>
        </div>
        <div class="compare" id="chk-compare">
          <span>目的网络 <b id="chk-net">…</b></span>
          <span class="compare-op" id="chk-op">?</span>
          <span>H1 网络 <b>${c.srcNet}/${c.prefix}</b></span>
          <span class="compare-badge" id="chk-badge">正在相与</span>
        </div>
        <p class="scroll-hint">左右滑动查看完整 32 位</p>
      `;
      stage.bits = {
        dest: buildBits($('chk-bits-dest'), c.destBits, 'dest', c.prefix),
        mask: buildBits($('chk-bits-mask'), c.maskBits, 'mask', c.prefix),
        and: buildBits($('chk-bits-and'), c.andBits, 'and', c.prefix)
      };
      stage.bitsAndDec = $('chk-and-dec');
      stage.bitsNet = $('chk-net');
      stage.bitsOp = $('chk-op');
      stage.bitsBadge = $('chk-badge');
      stage.bitsCompare = $('chk-compare');
      stage.bitsScanLabel = $('chk-scan-label');
      stage.bitsMeterFill = $('chk-meter-fill');
      return;
    }

    if (f.kind === 'lookup') {
      const lk = f.lookup;
      body.innerHTML = `
        <div class="lookup-title">目的 IP <b>${lk.dstIp}</b> · 逐行与掩码相与
          <span class="scan-count" id="lk-scan">0 / ${lk.rows.length}</span>
        </div>
        <div class="table-shell">
          <span class="route-pointer" id="lk-pointer" aria-hidden="true" title="正在匹配的路由表项"></span>
          <div class="table-scroll">
            <table class="route-table">
            <thead>
              <tr>
                <th>目的网络</th>
                <th>掩码</th>
                <th>AND 结果</th>
                <th>下一跳</th>
                <th>出接口</th>
                <th style="text-align:center">判定</th>
              </tr>
            </thead>
            <tbody>${lk.rows
              .map(
                (row, i) => `
              <tr class="route-row" data-row="${i}">
                <td>${row.prefix}</td>
                <td>${row.mask}</td>
                <td class="cell-and">···</td>
                <td>${row.nextHop}</td>
                <td>${row.iface}</td>
                <td class="cell-result">—</td>
              </tr>`
              )
                .join('')}</tbody>
            </table>
          </div>
        </div>
        <p class="scroll-hint">左右滑动查看完整路由表</p>
        <div class="lookup-result" id="lk-result">逐行扫描…</div>
      `;
      stage.lookup = {
        rows: Array.from(body.querySelectorAll('.route-row')).map((tr) => ({
          tr,
          and: tr.querySelector('.cell-and'),
          result: tr.querySelector('.cell-result')
        })),
        result: $('lk-result'),
        scan: $('lk-scan'),
        pointer: $('lk-pointer'),
        shell: body.querySelector('.table-shell')
      };
      return;
    }

    if (f.kind === 'move') {
      const b = S.seq.beats[f.index];
      const path = S.seq.meta.nodePath;
      const fromIndex = path.indexOf(b.fromId);
      const toIndex = path.indexOf(b.toId);
      body.innerHTML = `
        <div class="link-view">
          <div class="link-head">
            <span>${b.fromId}</span><span class="arrow">→</span><span>${b.toId}</span>
            <span class="link-tag" id="mv-seg">帧头 —</span>
          </div>
          <div class="link-explain" id="mv-explain"></div>
          <div class="mini-route">${path
            .map(
              (id, i) =>
                `<span class="node-chip${i === toIndex ? ' is-now' : i <= fromIndex ? ' is-past' : ''}">${id}</span>`
            )
            .join('<span>·</span>')}</div>
        </div>
      `;
      stage.move = {
        seg: $('mv-seg'),
        explain: $('mv-explain')
      };
      return;
    }

    body.innerHTML = `
      <div class="finish-title"><span class="tick">✓</span><span id="fn-title">收到分组</span></div>
      <div class="finish-grid">
        <div class="finish-cell"><span class="fk">IP 地址</span><b id="fn-ip"></b><em>端到端不变</em></div>
        <div class="finish-cell"><span class="fk">TTL</span><b id="fn-ttl"></b><em id="fn-hops"></em></div>
        <div class="finish-cell"><span class="fk">帧头</span><b id="fn-seg"></b><em>每跳重写</em></div>
      </div>
    `;
    stage.finish = {
      title: $('fn-title'),
      ip: $('fn-ip'),
      ttl: $('fn-ttl'),
      hops: $('fn-hops'),
      seg: $('fn-seg')
    };
  }

  function paintBits(cells, bits, alphas, opts) {
    const srcBits = opts && opts.srcBits;
    cells.forEach((cell, i) => {
      const a = clamp(alphas[i] || 0, 0, 1);
      const isScan = Boolean(opts && opts.and && i === opts.scanIdx);
      cell.style.opacity = (isScan ? Math.max(a, 0.8) : a).toFixed(3);
      cell.style.transform = `scale(${(isScan ? 1.16 : 0.78 + 0.22 * a).toFixed(3)})`;
      if (opts && opts.and) {
        cell.textContent = a > 0.08 ? bits[i] : '·';
        if (a > 0.5 && i < 26) {
          cell.classList.toggle('is-match', Boolean(opts.match));
          cell.classList.toggle('is-diff', opts.match === false && srcBits && bits[i] !== srcBits[i]);
        } else {
          cell.classList.remove('is-match', 'is-diff');
        }
      }
      cell.classList.toggle('is-scan', isScan);
    });
  }

  function paintInspector(f) {
    buildInspector(f);

    if (f.kind === 'check') {
      const c = f.check;
      setInspectHead('源端判断', `H1 目的 ${c.dstIp} · /${c.prefix}`, 'blue', true);
      const revealed = c.andAlpha.filter((a) => a > 0.55).length;
      const srcBits = M.ipBits(c.srcNet);
      let diffCount = 0;
      for (let i = 0; i < c.prefix; i++) {
        if (c.andBits[i] !== srcBits[i]) diffCount++;
      }
      let scanIdx = -1;
      for (let i = 0; i < c.andAlpha.length; i++) {
        if (c.andAlpha[i] > 0.08 && c.andAlpha[i] < 0.95) {
          scanIdx = i;
          break;
        }
      }
      paintBits(stage.bits.dest, c.destBits, c.destAlpha, {});
      paintBits(stage.bits.mask, c.maskBits, c.maskAlpha, {});
      paintBits(stage.bits.and, c.andBits, c.andAlpha, {
        and: true,
        match: c.match,
        srcBits,
        scanIdx
      });
      const andDone = revealed >= 32;
      setText(stage.bitsAndDec, andDone ? c.andNet : '…');
      setText(stage.bitsNet, c.match === null ? '…' : c.andNet);
      if (andDone && c.match === false) {
        setText(stage.bitsScanLabel, `相与完成 · ${diffCount} 位不同`);
      } else if (andDone && c.match === true) {
        setText(stage.bitsScanLabel, '相与完成 · 全部一致');
      } else if (andDone) {
        setText(stage.bitsScanLabel, '相与完成');
      } else {
        setText(stage.bitsScanLabel, `逐位相与 ${revealed} / 32`);
      }
      setClass(stage.bitsScanLabel, 'meter-label' + (c.match === false ? ' is-diff' : ''));
      stage.bitsMeterFill.style.width = `${(revealed / 32) * 100}%`;
      stage.bitsMeterFill.style.background =
        andDone && c.match !== null ? (c.match ? 'var(--green)' : 'var(--red)') : 'var(--blue)';
      setClass(stage.bitsCompare, 'compare' + (c.match === false ? ' is-diff-result' : ''));
      if (c.match === null) {
        setText(stage.bitsOp, '?');
        setText(stage.bitsBadge, '正在相与');
        setClass(stage.bitsBadge, 'compare-badge');
        stage.bitsBadge.style.opacity = '0.55';
      } else {
        setText(stage.bitsOp, c.match ? '=' : '≠');
        setText(stage.bitsBadge, c.match ? '同网 · 直接交付' : `不同网 · ${diffCount} 位不同`);
        setClass(stage.bitsBadge, 'compare-badge tone-' + (c.match ? 'green' : 'red') + ' is-resolved');
        stage.bitsBadge.style.opacity = String(c.compareAlpha);
      }
      return;
    }

    if (f.kind === 'lookup') {
      const lk = f.lookup;
      setInspectHead('路由查表', `${lk.router} 路由表 · 目的 ${lk.dstIp}`, 'gold', false);
      const scanned = lk.rows.filter((r) => r.state === 'scan' || r.state === 'match' || r.state === 'miss').length;
      const hasMatch = lk.rows.some((r) => r.state === 'match');
      setText(stage.lookup.scan, lk.resolved || hasMatch ? '已命中' : `已扫描 ${scanned} / ${lk.rows.length}`);
      setClass(stage.lookup.scan, 'scan-count' + (lk.resolved || hasMatch ? ' is-hit' : ''));

      // 指针：优先指向正在扫描的行，其次命中行，最后指向下一条待扫描行
      let scanningIdx = lk.rows.findIndex((r) => r.state === 'scan');
      let matchIdx = lk.rows.findIndex((r) => r.state === 'match');
      let lastMiss = -1;
      lk.rows.forEach((r, i) => {
        if (r.state === 'miss') lastMiss = i;
      });
      let pointerIdx = scanningIdx >= 0 ? scanningIdx : matchIdx >= 0 ? matchIdx : Math.min(lastMiss + 1, lk.rows.length - 1);
      if (pointerIdx < 0) pointerIdx = 0;
      const pointerRow = lk.rows[pointerIdx];
      const pointerSlot = stage.lookup.rows[pointerIdx];
      if (pointerRow && pointerSlot && stage.lookup.pointer && stage.lookup.shell) {
        const shellRect = stage.lookup.shell.getBoundingClientRect();
        const rowRect = pointerSlot.tr.getBoundingClientRect();
        const center = rowRect.top - shellRect.top + rowRect.height / 2;
        stage.lookup.pointer.style.transform = `translateY(${center.toFixed(1)}px)`;
        stage.lookup.pointer.style.opacity = pointerRow.state === 'idle' ? '0.78' : '1';
        const tone =
          pointerRow.state === 'match' ? ' is-match' : pointerRow.state === 'miss' ? ' is-miss' : '';
        setClass(stage.lookup.pointer, 'route-pointer' + tone);
      }
      lk.rows.forEach((row, i) => {
        const slot = stage.lookup.rows[i];
        if (!slot) return;
        let cls = 'route-row';
        if (row.state === 'scan') cls += ' is-scan';
        else if (row.state === 'match') cls += ' is-match';
        else if (row.state === 'miss') cls += ' is-miss';
        setClass(slot.tr, cls);
        slot.tr.style.opacity = row.alpha > 0.02 ? row.alpha.toFixed(3) : '0.35';
        setText(slot.and, row.andAlpha > 0.05 ? row.andResult : '···');
        if (row.badgeAlpha > 0.05) {
          setText(slot.result, row.state === 'match' ? '命中' : row.state === 'miss' ? '≠' : '扫描');
          setClass(
            slot.result,
            'cell-result' + (row.state === 'match' ? ' cell-confirm' : row.state === 'miss' ? ' cell-miss' : '')
          );
        } else {
          setText(slot.result, '—');
          setClass(slot.result, 'cell-result');
        }
      });

      if (lk.resolved) {
        const row = lk.rows[lk.matchedIdx];
        setClass(stage.lookup.result, 'lookup-result tone-green');
        const html =
          `命中 <b>${row.prefix}</b> → 下一跳 <b>${row.nextHop}</b> · ${row.iface}<br>` +
          `TTL <b>${lk.ttlFrom}→${lk.ttlTo}</b>，重封装为第 ${lk.segTo}/${f.frame.segTotal} 段帧头`;
        if (stage.lookup.result.dataset.html !== html) {
          stage.lookup.result.innerHTML = html;
          stage.lookup.result.dataset.html = html;
        }
        stage.lookup.result.style.opacity = String(lk.receiptAlpha);
      } else if (lk.rows.some((r) => r.state === 'match')) {
        setClass(stage.lookup.result, 'lookup-result tone-gold');
        setText(stage.lookup.result, '已找到匹配表项，正在锁定出接口…');
        stage.lookup.result.style.opacity = '1';
      } else {
        setClass(stage.lookup.result, 'lookup-result');
        setText(stage.lookup.result, '逐行用目的 IP 与表项掩码相与…');
        stage.lookup.result.style.opacity = '1';
      }
      return;
    }

    if (f.kind === 'move') {
      const b = S.seq.beats[f.index];
      setInspectHead('链路转发', `本跳 ${b.fromId} → ${b.toId}`, 'blue', false);
      setText(stage.move.seg, f.frame.decided ? `帧头 ${f.frame.seg}/${f.frame.segTotal}` : '帧头 —');
      let text = '交换机只按帧的目的 MAC 转发，不修改 IP 头。';
      if (f.frame.macReason === '目的 MAC = 默认网关') {
        text = '目的 MAC 填默认网关；交换机只按帧的目的 MAC 转发，不修改 IP 头。';
      } else if (f.frame.macReason === '目的 MAC = 下一跳路由器') {
        text = '源 MAC 换成出接口地址，目的 MAC 填下一跳路由器；源、目的 IP 地址不变。';
      } else if (f.frame.macReason === '目的 MAC = 目的主机') {
        text = '源 MAC 换成最后一段出接口地址，目的 MAC 填目的主机；源、目的 IP 地址不变。';
      }
      setText(stage.move.explain, text);
      return;
    }

    const dstName = S.seq.dst;
    setInspectHead('交付完成', `目的 ${S.seq.dstIp} · 已收下`, 'green', false);
    setText(stage.finish.title, `${dstName} 收到分组`);
    setText(stage.finish.ip, `${f.frame.ipSrc} → ${f.frame.ipDst}`);
    setText(stage.finish.ttl, `${S.seq.ttl0} → ${f.frame.ttl}`);
    setText(stage.finish.hops, f.stats.routerIndex === 0 ? '未经路由器' : `经 ${f.stats.routerIndex} 台路由器`);
    setText(stage.finish.seg, `${f.frame.seg} 段`);
  }

  // ---------- 步骤轨道 ----------

  function buildTrack() {
    els.track.innerHTML = '';
    const pips = [];
    let currentGroup = null;
    let row = null;
    S.seq.beats.forEach((beat, i) => {
      if (beat.group !== currentGroup) {
        currentGroup = beat.group;
        const wrap = document.createElement('div');
        wrap.className = 'track-group';
        const label = document.createElement('span');
        label.className = 'track-label';
        label.textContent = beat.group;
        row = document.createElement('div');
        row.className = 'track-pips';
        wrap.appendChild(label);
        wrap.appendChild(row);
        els.track.appendChild(wrap);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pip';
      btn.textContent = String(i + 1);
      btn.title = `${beat.phase} · ${beat.caption}`;
      btn.setAttribute('aria-label', `第 ${i + 1} 步：${beat.phase}，${beat.caption}`);
      btn.addEventListener('click', () => {
        pause();
        setTime(beatStart(i) + 0.001);
      });
      row.appendChild(btn);
      pips.push(btn);
    });
    stage.pips = pips;
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
    els.lamp.classList.toggle('is-running', S.playing);
    document.body.classList.toggle('is-playing', S.playing);
    document.body.classList.toggle('is-reduced', S.reduce);
    els.reduce.checked = S.reduce;
    document.querySelectorAll('[data-scenario]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.scenario) === S.scenario));
    });
    document.querySelectorAll('[data-speed]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === S.speed));
    });
    els.notice.hidden = hasGsap;
    if (!hasGsap) {
      setText(
        els.notice,
        S.reduce
          ? '未加载动画引擎（GSAP）。减少动效模式下仍可自动播放，每步直接跳转。'
          : '未加载动画引擎（GSAP），播放已停用。可开启「减少动效」自动播放，或用单步与进度条浏览。'
      );
    }
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

  function render() {
    if (!S.seq || !stage) return;
    const loc = M.locate(S.seq, S.t);
    S.i = loc.index;
    S.p = loc.p;
    paint(M.frameOf(S.seq, loc.index, loc.p));
    syncUI();
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
    if (!hasGsap) return;
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
    if (loc.index >= S.seq.beats.length - 1 && S.t >= S.total - 0.002) {
      S.playing = false;
      render();
      writeLink();
      return;
    }
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      const next = S.starts[loc.index + 1];
      if (next == null) {
        S.t = S.total;
        S.playing = false;
        render();
        writeLink();
        return;
      }
      S.t = next;
      render();
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

  function setSpeed(speed) {
    S.speed = speed;
    if (tween) tween.timeScale(speed);
    syncUI();
    writeLink();
  }

  function loadScenario(id, opts) {
    const keepTime = opts && opts.keepTime;
    S.scenario = id;
    S.seq = M.buildSequence(id);
    buildSegPips(S.seq.segTotal);
    lastTtl = null;
    const b = M.beatStarts(S.seq);
    S.starts = b.starts;
    S.total = b.total;
    S.playing = false;
    killTween();
    clearDwell();
    lastInspectorKey = '';
    buildTrack();
    if (!keepTime) S.t = 0;
    S.t = clamp(S.t, 0, S.total);
    render();
    writeLink();
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
      params.set('s', String(S.scenario));
      params.set('t', S.t.toFixed(2));
      history.replaceState(null, '', '#' + params.toString());
    } catch (e) {
      // 本地环境可能不允许改写地址，演示照常可用
    }
  }

  function readLink() {
    const out = { scenario: 1, t: 0 };
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      const s = Number(params.get('s'));
      if (s === 1 || s === 2 || s === 3) out.scenario = s;
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
    els.progress.addEventListener('input', () => setTime(Number(els.progress.value)));
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

    document.querySelectorAll('[data-scenario]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = Number(b.dataset.scenario);
        if (id === S.scenario) return;
        S.t = 0;
        loadScenario(id);
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

  function watchGsap() {
    if (hasGsap) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (window.gsap) {
        hasGsap = true;
        clearInterval(timer);
        syncUI();
      } else if (tries > 50) {
        clearInterval(timer);
      }
    }, 200);
  }

  function init() {
    const start = readLink();
    buildStage();
    bind();
    if (window.__gsapReady && !hasGsap) hasGsap = true;
    window.addEventListener('gsap-ready', () => {
      hasGsap = true;
      syncUI();
    });
    loadScenario(start.scenario, { keepTime: true });
    S.t = clamp(start.t, 0, S.total);
    render();
    writeLinkNow();
    watchGsap();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
