(function () {
  'use strict';

  const M = window.BgpModel;
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  /* ============================================================
     1. 几何常量：拓扑、链路、路由表卡片
     ============================================================ */
  const VB = { w: 1200, h: 690 };

  const NODES = {
    R1: { x: 190, y: 250, asn: 100, name: 'R1' },
    R1B: { x: 190, y: 480, asn: 100, name: 'R1B' },
    R2A: { x: 600, y: 250, asn: 200, name: 'R2A' },
    R2B: { x: 600, y: 480, asn: 200, name: 'R2B' },
    R3A: { x: 1010, y: 250, asn: 300, name: 'R3A' },
    R3B: { x: 1010, y: 480, asn: 300, name: 'R3B' }
  };
  const NODE_ORDER = ['R1', 'R1B', 'R2A', 'R2B', 'R3A', 'R3B'];

  const AS_BUBBLES = [
    { asn: 100, x: 20, y: 30, w: 340, h: 630, fill: '#f2f7ff', stroke: '#cbd9ee', ink: '#4d74b0' },
    { asn: 200, x: 430, y: 30, w: 340, h: 630, fill: '#f1f8f3', stroke: '#c7dfd0', ink: '#2f7d5c' },
    { asn: 300, x: 840, y: 30, w: 340, h: 630, fill: '#fdf7ee', stroke: '#ecd9b6', ink: '#a97a2f' }
  ];

  const LINKS = [
    { a: 'R1', b: 'R2A', kind: 'ebgp', label: { x: 395, y: 276 }, badge: { x: 395, y: 220 } },
    { a: 'R2A', b: 'R3A', kind: 'ebgp', label: { x: 805, y: 276 }, badge: { x: 805, y: 220 } },
    { a: 'R1B', b: 'R2B', kind: 'ebgp', label: { x: 395, y: 506 }, badge: { x: 395, y: 450 } },
    { a: 'R2B', b: 'R3B', kind: 'ebgp', label: { x: 805, y: 506 }, badge: { x: 805, y: 450 } },
    { a: 'R1', b: 'R1B', kind: 'ibgp', label: { x: 130, y: 350 }, badge: { x: 130, y: 382 } },
    { a: 'R2A', b: 'R2B', kind: 'ibgp', label: { x: 540, y: 350 }, badge: { x: 540, y: 382 } },
    { a: 'R3A', b: 'R3B', kind: 'ibgp', label: { x: 950, y: 350 }, badge: { x: 950, y: 382 } }
  ];

  const CARD = { w: 300, rowH: 20, baseH: 62, topY: 186, bottomY: 530 };
  const COLS = [
    { key: 'prefix', head: 'PREFIX', x: 12, hx: 7, hw: 101 },
    { key: 'asPath', head: 'AS_PATH', x: 112, hx: 107, hw: 89 },
    { key: 'nextHop', head: 'NEXT_HOP', x: 200, hx: 195, hw: 67 },
    { key: 'lp', head: 'LP', x: 268, hx: 263, hw: 31 }
  ];
  const ROW_Y = [54, 74, 94];

  const LINK_KEY = (a, b) => [a, b].sort().join('-');

  /* ============================================================
     2. 动画适配层：GSAP 可用则用之，否则本地微补间（离线双击可用）
     ============================================================ */
  const EASES = {
    'power1.inOut': t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    'power2.out': t => 1 - Math.pow(1 - t, 2),
    'power3.out': t => 1 - Math.pow(1 - t, 3),
    'sine.inOut': t => -(Math.cos(Math.PI * t) - 1) / 2,
    'back.out(1.4)': t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2)
  };

  const Anim = {
    tween(opts) {
      const ease = EASES[opts.ease] || EASES['power2.out'];
      const dur = Math.max(0, opts.duration || 0);
      const delay = opts.delay || 0;
      if (window.gsap && typeof window.gsap.to === 'function') {
        const holder = { v: opts.from };
        window.gsap.to(holder, {
          v: opts.to,
          duration: dur,
          delay,
          ease: opts.ease || 'power2.out',
          onUpdate: () => opts.onUpdate && opts.onUpdate(holder.v),
          onComplete: opts.onComplete
        });
        return;
      }
      let start = null;
      const step = now => {
        if (start === null) start = now + delay * 1000;
        const elapsed = (now - start) / 1000;
        if (elapsed < 0) { requestAnimationFrame(step); return; }
        const t = dur === 0 ? 1 : Math.min(1, elapsed / dur);
        if (opts.onUpdate) opts.onUpdate(opts.from + (opts.to - opts.from) * ease(t));
        if (t < 1) requestAnimationFrame(step);
        else if (opts.onComplete) opts.onComplete();
      };
      requestAnimationFrame(step);
    }
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const noMotion = () => reduced.matches;

  /* ============================================================
     3. SVG 工具
     ============================================================ */
  function svgEl(name, attrs, text) {
    const el = document.createElementNS(NS, name);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => { if (v !== undefined && v !== null) el.setAttribute(k, v); });
    if (text !== undefined) el.textContent = text;
    return el;
  }
  const layers = {
    as: $('layer-as'), links: $('layer-links'), flow: $('layer-flow'),
    cards: $('layer-cards'), nodes: $('layer-nodes'), packets: $('layer-packets'), fx: $('layer-fx')
  };

  function edgePoint(fromName, toName, pad) {
    const a = NODES[fromName], b = NODES[toName];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: a.x + (dx / len) * pad, y: a.y + (dy / len) * pad };
  }

  /* ============================================================
     4. 静态拓扑层
     ============================================================ */
  function buildStatic() {
    AS_BUBBLES.forEach(b => {
      layers.as.appendChild(svgEl('rect', {
        x: b.x, y: b.y, width: b.w, height: b.h, rx: 22,
        fill: b.fill, stroke: b.stroke, class: 'as-bubble'
      }));
      layers.as.appendChild(svgEl('text', { x: b.x + 20, y: b.y + 32, class: 'as-label', fill: b.ink }, 'AS ' + b.asn));
      layers.as.appendChild(svgEl('text', { x: b.x + 20, y: b.y + 52, class: 'as-sub', fill: b.ink }, '自治系统 ' + b.asn));
    });

    LINKS.forEach(l => {
      const a = edgePoint(l.a, l.b, 36), b = edgePoint(l.b, l.a, 36);
      const line = svgEl('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        class: 'link ' + l.kind, 'data-key': LINK_KEY(l.a, l.b)
      });
      layers.links.appendChild(line);
      layers.links.appendChild(svgEl('text', {
        x: l.label.x, y: l.label.y, class: 'link-tag', 'text-anchor': 'middle'
      }, l.kind === 'ebgp' ? 'eBGP' : 'iBGP'));
      const badge = svgEl('g', { class: 'port-badge' });
      badge.appendChild(svgEl('rect', { x: l.badge.x - 32, y: l.badge.y - 11, width: 64, height: 22, rx: 11 }));
      badge.appendChild(svgEl('text', { x: l.badge.x, y: l.badge.y + 4, 'text-anchor': 'middle' }, 'TCP 179'));
      layers.links.appendChild(badge);
    });

    NODE_ORDER.forEach(key => {
      const n = NODES[key];
      const g = svgEl('g', { class: 'node', 'data-node': key });
      g.appendChild(svgEl('circle', { cx: n.x, cy: n.y, r: 34, class: 'node-ring' }));
      g.appendChild(svgEl('circle', { cx: n.x, cy: n.y, r: 34, class: 'node-shell' }));
      g.appendChild(svgEl('text', { x: n.x, y: n.y - 2, class: 'node-name' }, key));
      g.appendChild(svgEl('text', { x: n.x, y: n.y + 17, class: 'node-as' }, 'AS' + n.asn));
      layers.nodes.appendChild(g);
    });
  }

  /* ============================================================
     5. 路由表卡片（每台路由器旁的 BGP 表）
     ============================================================ */
  const cardRefs = {};
  function buildCards() {
    NODE_ORDER.forEach(key => {
      const g = svgEl('g', { class: 'card-group', 'data-card': key });
      layers.cards.appendChild(g);
      cardRefs[key] = { g, signature: '', node: NODES[key] };
    });
  }

  const rowSignature = rows => JSON.stringify(rows || []);

  function renderCards(tables, token) {
    NODE_ORDER.forEach((key, ci) => {
      const ref = cardRefs[key];
      const rows = tables && tables[key] ? tables[key] : [];
      const sig = rowSignature(rows);
      const hasCard = rows.length > 0;
      ref.g.style.opacity = hasCard ? '1' : '0';
      ref.g.style.pointerEvents = 'none';
      if (sig === ref.signature) return;
      ref.signature = sig;
      while (ref.g.firstChild) ref.g.removeChild(ref.g.firstChild);
      if (!hasCard) return;

      // 高度随行数自适应；上排卡片贴路由器上缘，下排卡片贴下缘
      const cardH = CARD.baseH + Math.max(1, rows.length - 1) * CARD.rowH;
      const n = ref.node;
      const y = n.y < VB.h / 2 ? CARD.topY - cardH : CARD.bottomY;
      ref.g.setAttribute('transform', 'translate(' + (n.x - CARD.w / 2) + ',' + y + ')');

      ref.g.appendChild(svgEl('rect', { x: 0, y: 0, width: CARD.w, height: cardH, rx: 8, class: 'card-body' }));
      ref.g.appendChild(svgEl('rect', { x: 0, y: 0, width: 3, height: cardH, rx: 1.5, class: 'card-bar' }));
      ref.g.appendChild(svgEl('text', { x: 12, y: 19, class: 'card-title' }, key + ' · BGP 路由表'));

      const bestRow = rows.find(r => r.tag === 'best');
      if (bestRow) {
        ref.g.appendChild(svgEl('rect', { x: CARD.w - 60, y: 8, width: 52, height: 16, rx: 8, fill: '#24593f' }));
        ref.g.appendChild(svgEl('text', { x: CARD.w - 34, y: 19, class: 'card-flag', 'text-anchor': 'middle' }, 'BEST'));
      } else {
        ref.g.appendChild(svgEl('rect', { x: CARD.w - 60, y: 8, width: 52, height: 16, rx: 8, fill: '#e7e4da' }));
        ref.g.appendChild(svgEl('text', { x: CARD.w - 34, y: 19, class: 'card-flag', 'text-anchor': 'middle', fill: '#8a8272' }, '候选'));
      }

      COLS.forEach(c => {
        ref.g.appendChild(svgEl('text', { x: c.x, y: 35, class: 'card-head' }, c.head));
      });

      rows.slice(0, 3).forEach((r, i) => {
        const y = ROW_Y[i];
        const rowG = svgEl('g', { class: 'card-row' });
        const bgClass = r.tag === 'best' ? 'card-row-bg best'
          : r.tag === 'changed' ? 'card-row-bg changed'
            : r.tag === 'candidate' ? 'card-row-bg candidate' : 'card-row-bg';
        rowG.appendChild(svgEl('rect', { x: 6, y: y - 13, width: 288, height: 19, rx: 3, class: bgClass }));
        COLS.forEach(c => {
          const tone = r.tone && r.tone[c.key] ? ' ' + r.tone[c.key] : '';
          rowG.appendChild(svgEl('text', {
            x: c.x, y: y, class: 'card-cell' + (r.tag === 'best' ? ' strong' : '') + tone
          }, String(r[c.key])));
          if (r.hl === c.key) {
            rowG.appendChild(svgEl('rect', { x: c.hx, y: y - 13, width: c.hw, height: 19, rx: 3, class: 'card-hl' }));
          }
        });
        if (i < rows.length - 1) {
          rowG.appendChild(svgEl('line', { x1: 12, y1: y + 8, x2: 288, y2: y + 8, class: 'card-divider' }));
        }
        ref.g.appendChild(rowG);

        if (!noMotion()) {
          const t = token;
          Anim.tween({
            from: 0.25, to: 1, duration: 0.32, delay: (ci * 0.05) + (i * 0.1), ease: 'power2.out',
            onUpdate: v => { if (t === token) rowG.setAttribute('opacity', v); }
          });
        }
      });
    });
  }

  /* ============================================================
     6. 报文信封与路径光流
     ============================================================ */
  function createPacketEl(p) {
    const g = svgEl('g', { class: 'packet ' + (p.type || 'update') });
    const w = 54, h = 30;
    g.appendChild(svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 6, class: 'env-body' }));
    g.appendChild(svgEl('path', { d: 'M' + (-w / 2) + ' ' + (-h / 2) + ' L0 3 L' + (w / 2) + ' ' + (-h / 2), class: 'env-flap' }));
    g.appendChild(svgEl('text', { x: 0, y: 3, class: 'env-label' }, p.label || ''));
    if (p.tag) {
      const tw = p.tag.length * 5.1 + 16;
      const tag = svgEl('g', { class: 'env-tag' });
      tag.appendChild(svgEl('rect', { x: -tw / 2, y: -36, width: tw, height: 16, rx: 8 }));
      tag.appendChild(svgEl('text', { x: 0, y: -27, 'text-anchor': 'middle' }, p.tag));
      g.appendChild(tag);
    }
    return g;
  }

  function animatePackets(packets, token) {
    while (layers.packets.firstChild) layers.packets.removeChild(layers.packets.firstChild);
    if (!packets || !packets.length) return;
    packets.forEach((p, i) => {
      const el = createPacketEl(p);
      layers.packets.appendChild(el);
      const from = edgePoint(p.from, p.to, 42);
      const to = edgePoint(p.to, p.from, 42);
      const stagger = (p.delay != null ? p.delay : i * 0.55) / State.speed;
      const dur = (p.duration || 1.15) / State.speed;

      if (noMotion()) {
        el.setAttribute('transform', 'translate(' + to.x + ',' + to.y + ')');
        el.setAttribute('class', 'packet shown ' + (p.type || 'update'));
        return;
      }

      Anim.tween({
        from: 0, to: 1, duration: dur, delay: stagger, ease: 'power1.inOut',
        onUpdate: v => {
          if (token !== State.token) return;
          const x = from.x + (to.x - from.x) * v;
          const y = from.y + (to.y - from.y) * v;
          el.setAttribute('transform', 'translate(' + x + ',' + y + ')');
          el.setAttribute('class', 'packet shown ' + (p.type || 'update'));
        },
        onComplete: () => {
          if (token !== State.token) return;
          if (p.vanish !== false) Anim.tween({
            from: 1, to: 0.28, duration: 0.5,
            onUpdate: v => { if (token === State.token) el.setAttribute('opacity', v); }
          });
        }
      });
    });
  }

  function drawFlow(path, cls) {
    if (!path || path.length < 2) return;
    const d = path.map((k, i) => (i ? 'L' : 'M') + NODES[k].x + ' ' + NODES[k].y).join(' ');
    layers.flow.appendChild(svgEl('path', { d, class: 'flow-path ' + (cls || 'on') }));
    layers.flow.appendChild(svgEl('path', { d, class: 'flow-dash ' + (cls || 'on') }));
    const tip = NODES[path[path.length - 1]];
    layers.flow.appendChild(svgEl('circle', {
      cx: tip.x, cy: tip.y, r: 44, class: 'flow-path ' + (cls || 'on')
    }));
  }

  function addFxLabel(x, y, text, tone) {
    layers.fx.appendChild(svgEl('text', { x, y, class: 'fx-label ' + (tone || 'green') }, text));
  }

  function addDropMark(x, y, text) {
    const outer = svgEl('g', { transform: 'translate(' + x + ',' + y + ')' });
    const inner = svgEl('g', { class: 'drop-group' });
    inner.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 48, class: 'drop-ring' }));
    inner.appendChild(svgEl('path', { d: 'M-26 -26 L26 26', class: 'drop-mark' }));
    inner.appendChild(svgEl('path', { d: 'M26 -26 L-26 26', class: 'drop-mark' }));
    outer.appendChild(inner);
    outer.appendChild(svgEl('text', { x: 0, y: -82, class: 'drop-text' }, text));
    layers.fx.appendChild(outer);
    if (!noMotion()) {
      Anim.tween({ from: 0, to: 1, duration: 0.26, onUpdate: v => outer.setAttribute('opacity', v) });
      Anim.tween({ from: 0.35, to: 1, duration: 0.38, ease: 'back.out(1.4)', onUpdate: v => inner.setAttribute('transform', 'scale(' + v + ')') });
    }
  }

  /* ============================================================
     7. 场景数据：四个考研核心场景
     ============================================================ */
  const P = '192.168.1.0/24';
  const row = (prefix, asPath, nextHop, lp, extra) => Object.assign({ prefix, asPath, nextHop, lp }, extra || {});

  function s1Frames() {
    const out = [];
    const localTable = () => ({ R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })] });
    out.push({
      phase: '初始状态',
      title: '三个 AS、六台路由器，先看清谁和谁是邻居',
      description: 'AS 之间建立 eBGP 会话（实线），同一个 AS 内的两台路由器之间建立 iBGP 会话（虚线）。BGP 是应用层协议，所有报文都跑在 TCP 179 端口之上，可靠性由 TCP 保证。',
      formula: 'eBGP 跨 AS · iBGP 在 AS 内部 · 传输层统一走 TCP 179',
      hint: '拓扑：AS100 / AS200 / AS300，实线 eBGP、虚线 iBGP，链路旁标注传输层端口。',
      stateStep: -1, tables: {}
    });
    out.push({
      phase: 'TCP 建立',
      title: '第一步永远是 TCP 三次握手',
      description: 'R1 主动向 R2A 的 179 端口发起连接：SYN → SYN+ACK → ACK。注意这是 TCP 连接建立，BGP 会话此时还没有建立，更没有路由可以传递。',
      formula: 'R1 :1234 ── SYN ──▶ R2A :179   ·   ◀── SYN+ACK ──   ·   ── ACK ──▶',
      hint: '传输层先就位：三次握手完成，才有可靠的 BGP 报文通道。',
      packets: [
        { from: 'R1', to: 'R2A', label: 'SYN', type: 'tcp', delay: 0 },
        { from: 'R2A', to: 'R1', label: 'SYN+ACK', type: 'tcp', delay: 1.0 },
        { from: 'R1', to: 'R2A', label: 'ACK', type: 'tcp', delay: 2.0 }
      ],
      activeLinks: ['R1-R2A'], focus: ['R1', 'R2A'], stateStep: 1, tables: {}
    });
    out.push({
      phase: 'OPEN 协商',
      title: '互发 OPEN 报文，协商版本、AS 号与 Hold Time',
      description: 'OPEN 携带 BGP 版本、本端 AS 号、Hold 定时器、BGP 标识（Router ID）以及可选参数。双方都认可对方的参数，才继续向下走；参数不匹配则发 NOTIFICATION 并断开。',
      formula: 'OPEN = { Version 4 · My AS · Hold Time · BGP ID · Optional Param }',
      hint: 'OPEN 协商失败会发 NOTIFICATION，随后 TCP 连接被拆除。',
      packets: [
        { from: 'R1', to: 'R2A', label: 'OPEN', type: 'open', tag: 'My AS 100', delay: 0 },
        { from: 'R2A', to: 'R1', label: 'OPEN', type: 'open', tag: 'My AS 200', delay: 1.1 }
      ],
      activeLinks: ['R1-R2A'], focus: ['R1', 'R2A'], stateStep: 3, tables: {}
    });
    out.push({
      phase: 'Established',
      title: 'KEEPALIVE 确认，会话进入 Established',
      description: '进入 Established 后周期性互发 KEEPALIVE 保活（默认 60 秒）。Hold Time（默认 180 秒）内收不到任何报文就判定邻居失效并拆除会话。图中用微小心跳表示保活。',
      formula: 'Keepalive Interval = Hold Time / 3 = 60s   ·   Hold Time = 180s',
      hint: '会话已建立，周期心跳表示 KEEPALIVE 保活。',
      packets: [
        { from: 'R1', to: 'R2A', label: 'KEEPALIVE', type: 'keepalive', delay: 0, duration: 1.0 },
        { from: 'R2A', to: 'R1', label: 'KEEPALIVE', type: 'keepalive', delay: 0.9, duration: 1.0 }
      ],
      activeLinks: ['R1-R2A'], focus: ['R1', 'R2A'], keepalive: true, stateStep: 4, tables: {}
    });
    out.push({
      phase: '路由通告',
      title: 'AS100 产生前缀，封装成 UPDATE 发往 AS200',
      description: 'UPDATE 是 BGP 的核心报文，只携带增量：要撤销的前缀，或可达的新前缀加一组路径属性。R2A 收到后写入 BGP 表，再决定是否使用、是否继续向外通告。',
      formula: 'UPDATE = { NLRI: 192.168.1.0/24 · AS_PATH: 100 · NEXT_HOP: 10.0.12.1 · LOCAL_PREF: 100 }',
      hint: '注意 UPDATE 里的四项属性，后面三幕全部围绕它们展开。',
      packets: [{ from: 'R1', to: 'R2A', label: 'UPDATE', type: 'update', tag: 'AS_PATH 100', delay: 0 }],
      activeLinks: ['R1-R2A'], focus: ['R1', 'R2A'], keepalive: true, stateStep: 4,
      tables: Object.assign(localTable(), {
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best', hl: 'asPath' })]
      })
    });
    out.push({
      phase: '逐跳传递',
      title: 'R2A 再把它传给 AS 内的 R2B，以及 AS300 的 R3A',
      description: '传给 R2B 走 iBGP：同一个 AS，AS_PATH 不追加本端 AS 号；传给 R3A 走 eBGP：跨 AS，把 200 写到 AS_PATH 最前面，同时 NEXT_HOP 改写为自己的接口 IP。',
      formula: 'iBGP 通告 → AS_PATH 100   ·   eBGP 通告 → AS_PATH 200 100',
      hint: '同一份路由，从 eBGP 出去和从 iBGP 出去，属性变化并不一样。',
      packets: [
        { from: 'R2A', to: 'R2B', label: 'UPDATE', type: 'update', tag: 'AS_PATH 100', delay: 0 },
        { from: 'R2A', to: 'R3A', label: 'UPDATE', type: 'update', tag: 'AS_PATH 200 100', delay: 1.0 }
      ],
      activeLinks: ['R2A-R2B', 'R2A-R3A'], focus: ['R2B', 'R3A'], keepalive: true, stateStep: 4,
      tables: Object.assign(localTable(), {
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100', '10.0.12.1', '100', { tag: 'best', hl: 'nextHop' })],
        R3A: [row(P, '200 100', '10.0.24.1', '100', { tag: 'best', hl: 'asPath' })]
      })
    });
    return { frames: out, milestones: [['初始状态', 0], ['TCP 握手', 1], ['OPEN 协商', 2], ['保活心跳', 3], ['UPDATE 通告', 4], ['逐跳传递', 5]] };
  }

  function s2Frames() {
    const out = [];
    const r1Local = { R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })] };
    out.push({
      phase: '路径向量',
      title: 'BGP 是路径向量协议：每条路由都自带“走过哪些 AS”',
      description: '路由器在通告路由时，把自己的 AS 号写到 AS_PATH 最前面。AS_PATH 有两个用途：一是选路时比长短，二是检测环路——这是 BGP 唯一的防环手段。',
      formula: 'AS_PATH = [最近的 AS 号, …, 最远的 AS 号]；空表示本 AS 始发',
      hint: '追踪一条 UPDATE，看 AS_PATH 如何一站一站变长。',
      stateStep: 4, tables: r1Local
    });
    out.push({
      phase: '离开 AS100',
      title: 'R1 通告给 R2A：AS_PATH 写入 100',
      description: '这是路由第一次跨出 AS100，于是把 100 放在 AS_PATH 的最前面。此时 R2A 看到的路径就是「经过 AS100 可达」。',
      formula: 'R2A 收到 → AS_PATH = [100]',
      hint: '经过一个 AS，AS_PATH 就多一段。',
      packets: [{ from: 'R1', to: 'R2A', label: 'UPDATE', type: 'update', tag: 'AS_PATH 100', delay: 0 }],
      activeLinks: ['R1-R2A'], focus: ['R2A'],
      tables: Object.assign({ R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })] }, {
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best', hl: 'asPath' })]
      })
    });
    out.push({
      phase: 'AS 内部传递',
      title: 'R2A 传给 R2B 走 iBGP：AS_PATH 保持 [100] 不变',
      description: 'iBGP 会话两端在同一个 AS 里，因此不追加 AS 号。如果这里也加 200，就会出现 [200, 200, 100] 这种假象，而且会让 AS 内部的防环判断彻底失效。',
      formula: 'iBGP 通告：AS_PATH 不变 → 仍是 [100]',
      hint: 'AS 号只在跨出 AS 的那一跳才追加。',
      packets: [{ from: 'R2A', to: 'R2B', label: 'UPDATE', type: 'update', tag: 'AS_PATH 100', delay: 0 }],
      activeLinks: ['R2A-R2B'], focus: ['R2B'],
      tables: Object.assign({ R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })] }, {
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100', '10.0.12.1', '100', { tag: 'best', hl: 'asPath' })]
      })
    });
    out.push({
      phase: '绕回原路',
      title: 'R2B 又把它通告回 AS100：AS_PATH 变成 [200, 100]',
      description: 'R2B 按规则把 200 写到最前面再发给 R1B。这条 UPDATE 现在带着 [200, 100]，正试图绕回它的出发地 AS100——环路就这样形成了。',
      formula: 'R2B → R1B：AS_PATH = [200, 100]',
      hint: '报文正在绕回它出发的 AS。',
      packets: [{ from: 'R2B', to: 'R1B', label: 'UPDATE', type: 'update', tag: 'AS_PATH 200 100', delay: 0 }],
      activeLinks: ['R1B-R2B'], focus: ['R1B'], tone: 'warning',
      tables: Object.assign({ R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })] }, {
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })]
      })
    });
    const dropTables = Object.assign({ R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })] }, {
      R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
      R2B: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })]
    });
    out.push({
      phase: '环路检测',
      title: 'AS100 检测到本 AS 号已在 AS_PATH 中，直接丢弃',
      description: 'R1B 入站时先做环路检测：AS_PATH = [200, 100] 里已经含有自己的 100，说明这条路本来就是从自己这里出去的，于是立刻丢弃，不写入路由表。',
      formula: '100 ∈ [200, 100] → 检测到本 AS 号，丢弃以防环',
      note: '检测到本 AS 号，丢弃以防环 —— 该路由不会进入 R1B 的路由表。',
      hint: '红叉表示这条 UPDATE 被入站策略丢弃。',
      packets: [{ from: 'R2B', to: 'R1B', label: 'UPDATE', type: 'drop', tag: 'AS_PATH 200 100', delay: 0, vanish: false }],
      activeLinks: ['R1B-R2B'], focus: ['R1B'], alert: ['R1B'],
      drop: { x: 330, y: 480, text: '检测到本 AS 号 100，丢弃以防环' },
      fxLabels: [{ x: 330, y: 552, text: '不写入 R1B 的路由表', tone: 'rose' }],
      tone: 'warning', tables: dropTables
    });
    out.push({
      phase: '结论',
      title: 'AS_PATH 防环，是 BGP 唯一的环路检测机制',
      description: 'AS_PATH 记录的是去往该前缀所经过的 AS 序列，因此任何绕回本 AS 的路由都会被一眼看穿。需要注意：这种检测只在 AS 层面生效，AS 内部还要靠 iBGP 的通告规则（不把 iBGP 学到的路由传给其他 iBGP 邻居）来避免环路。',
      formula: 'AS_PATH 短 = 路径短；AS_PATH 含本 AS 号 = 有环 → 丢弃',
      hint: '两条作用合在同一个属性里：选路比长短，防环查自己。',
      tone: 'notice', tables: dropTables
    });
    return { frames: out, milestones: [['路径向量', 0], ['写入 AS 号', 1], ['iBGP 不追加', 2], ['绕回原路', 3], ['丢弃防环', 4]] };
  }

  function s3Frames() {
    const out = [];
    out.push({
      phase: 'NEXT_HOP 是什么',
      title: 'NEXT_HOP 告诉数据包：下一跳交给谁',
      description: 'NEXT_HOP 是去往该前缀时数据包要交给的下一跳 IP。它在 eBGP 通告时被改写，在 iBGP 通告时默认保持不变——这一差别是 BGP 最容易考、也最容易错的地方。',
      formula: 'eBGP 通告 → NEXT_HOP = 发送方接口 IP   ·   iBGP 通告 → NEXT_HOP 不变',
      hint: '盯着路由表的 NEXT_HOP 一列看。',
      stateStep: 4,
      tables: { R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })] }
    });
    out.push({
      phase: '跨 EBGP',
      title: 'R1 发给 R2A（eBGP）：NEXT_HOP 变成 R1 的接口 IP',
      description: '跨 AS 通告时，发送方必然把 NEXT_HOP 改写成自己的接口地址，否则对方根本不知道该把数据包送往哪里。R2A 看到的下一跳是 10.0.12.1，也就是 R1 面向自己的接口。',
      formula: 'R2A：NEXT_HOP = 10.0.12.1（R1 的接口）← 已被改写',
      hint: 'eBGP 一定改写 NEXT_HOP。',
      packets: [{ from: 'R1', to: 'R2A', label: 'UPDATE', type: 'update', tag: 'NEXT_HOP 10.0.12.1', delay: 0 }],
      activeLinks: ['R1-R2A'], focus: ['R2A'],
      tables: { R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })], R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best', hl: 'nextHop' })] }
    });
    out.push({
      phase: '进 IBGP',
      title: 'R2A 发给 R2B（iBGP）：NEXT_HOP 保持 10.0.12.1 不变',
      description: 'iBGP 通告不做 NEXT_HOP 改写。R2B 学到的路由，下一跳仍然指向 AS100 里的 R1，而不是把包交给同机房的 R2A。这是 BGP 的刻意设计：让 AS 内部知道真正的出口在哪里。',
      formula: 'R2B：NEXT_HOP = 10.0.12.1（仍是 R1）← 未被改写',
      note: 'iBGP 不改 NEXT_HOP：R2B 必须自己能路由到 10.0.12.1，否则这条路由不可用。',
      hint: '红字标出未被改写的 NEXT_HOP。',
      packets: [{ from: 'R2A', to: 'R2B', label: 'UPDATE', type: 'update', tag: 'NEXT_HOP 10.0.12.1', delay: 0 }],
      activeLinks: ['R2A-R2B'], focus: ['R2B'], tone: 'warning',
      tables: {
        R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })],
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100', '10.0.12.1', '100', { tag: 'best', hl: 'nextHop', tone: { nextHop: 'rose' } })]
      }
    });
    out.push({
      phase: '可达性问题',
      title: '麻烦来了：R2B 并没有去往 10.0.12.1 的路由',
      description: 'NEXT_HOP 指向的是 AS100 的接口地址。如果 AS 内部的 IGP 没有打通这个地址，R2B 就算有路由表条目，也根本无法把数据包送出去——路由存在，却不可达。',
      formula: 'R2B 无法解析 10.0.12.1 → 路由条目无效（not best/external）',
      note: 'iBGP 不改 NEXT_HOP，需配合 IGP 打通或 Next-hop-self 实现可达。',
      hint: '路由表有条目，不代表数据包真的能转发。',
      alert: ['R2B'], tone: 'warning',
      tables: {
        R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })],
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100', '10.0.12.1', '— 不可达', '100', { tag: 'candidate', hl: 'nextHop', tone: { nextHop: 'rose' } })]
      }
    });
    out.push({
      phase: '解决办法 A',
      title: '办法一：用 IGP 把 10.0.12.1 打通',
      description: '在 AS 内部运行 OSPF / IS-IS，让 R2B 学会如何去往 10.0.12.1。下一跳指向外部，转发路径却在 AS 内部可达，这条路由就立刻变得可用。',
      formula: 'IGP 提供到 10.0.12.1 的内部可达性 → 路由生效',
      hint: '最常见也最标准的做法。',
      tone: 'notice',
      packets: [{ from: 'R2A', to: 'R2B', label: 'IGP', type: 'keepalive', tag: '可达 10.0.12.1', delay: 0 }],
      activeLinks: ['R2A-R2B'], focus: ['R2B'],
      tables: {
        R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })],
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100', '10.0.12.1', '100', { tag: 'best', hl: 'nextHop' })]
      }
    });
    out.push({
      phase: '解决办法 B',
      title: '办法二：在 R2A 上配置 next-hop-self',
      description: 'R2A 向 iBGP 邻居通告时改写 NEXT_HOP 为自己的接口 IP（10.0.22.1），R2B 就只需要能到达同 AS 的 R2A。代价是 AS 内部可能绕路，而且要逐邻居配置。',
      formula: 'next-hop-self → R2B：NEXT_HOP = 10.0.22.1（R2A 自己）',
      hint: '对比上一步，NEXT_HOP 一列变了。',
      packets: [{ from: 'R2A', to: 'R2B', label: 'UPDATE', type: 'update', tag: 'NEXT_HOP 10.0.22.1', delay: 0 }],
      activeLinks: ['R2A-R2B'], focus: ['R2B'], tone: 'notice',
      tables: {
        R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })],
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100', '10.0.22.1', '100', { tag: 'best', hl: 'nextHop' })]
      }
    });
    out.push({
      phase: '再跨 EBGP',
      title: 'R2B 发给 R3B（eBGP）：NEXT_HOP 又改写为 R2B 的接口 IP',
      description: '只要跨 AS，NEXT_HOP 就一定被改写为发送方自己的接口地址。所以 AS300 看到的下一跳是 10.0.23.1，完全不需要了解 AS200 内部的拓扑。',
      formula: 'R3B：NEXT_HOP = 10.0.23.1（R2B 的接口）← 又被改写',
      hint: '一条规律：eBGP 改写，iBGP 不改。',
      packets: [{ from: 'R2B', to: 'R3B', label: 'UPDATE', type: 'update', tag: 'NEXT_HOP 10.0.23.1', delay: 0 }],
      activeLinks: ['R2B-R3B'], focus: ['R3B'],
      tables: {
        R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })],
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100', '10.0.22.1', '100', { tag: 'best' })],
        R3B: [row(P, '200 100', '10.0.23.1', '100', { tag: 'best', hl: 'nextHop' })]
      }
    });
    return { frames: out, milestones: [['认识 NEXT_HOP', 0], ['eBGP 改写', 1], ['iBGP 不改', 2], ['可达性问题', 3], ['IGP 打通', 4], ['next-hop-self', 5], ['再次改写', 6]] };
  }

  function s4Frames() {
    const out = [];
    const base = () => ({
      R1: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })],
      R1B: [row(P, '本地', '0.0.0.0', '100', { tag: 'best' })]
    });

    out.push({
      phase: '两条路都可达',
      title: '同一个前缀，上下两条路都能到达',
      description: '192.168.1.0/24 从上下两条链路传进 AS300：上方经 R2A，AS_PATH 两段；下方 AS100 在 R1B 出口做了 AS 欺骗，把自身 AS 号重复写入，AS_PATH 变成三段。',
      formula: '上方：AS_PATH 200 100（2 段）   ·   下方：AS_PATH 200 100 100（3 段）',
      hint: '两条候选路由同时出现在 R3A 的 BGP 表里。',
      stateStep: 4,
      flows: [{ path: ['R1', 'R2A', 'R3A'], cls: 'candidate' }, { path: ['R1B', 'R2B', 'R3B', 'R3A'], cls: 'candidate' }],
      tables: Object.assign(base(), {})
    });
    out.push({
      phase: 'AS 欺骗',
      title: 'AS 欺骗：重复写入自身 AS 号，人为拉长 AS_PATH',
      description: 'AS100 希望入站流量主要走上方，于是在下方出口重复附加 100 两次。下游看到的 AS_PATH 就更长，默认规则会避开它。运营商常用这种手段影响邻居的选路结果。',
      formula: 'prepend 2 次 → [100, 100] → AS200 追加 200 → [200, 100, 100]',
      hint: 'AS_PATH 长度按 AS 号个数算，重复的号也算一段。',
      tone: 'notice',
      packets: [{ from: 'R1B', to: 'R2B', label: 'UPDATE', type: 'update', tag: 'AS_PATH 100 100', delay: 0 }],
      activeLinks: ['R1B-R2B'], focus: ['R1B', 'R2B'],
      flows: [{ path: ['R1', 'R2A', 'R3A'], cls: 'candidate' }, { path: ['R1B', 'R2B', 'R3B', 'R3A'], cls: 'candidate' }],
      tables: Object.assign(base(), {
        R2B: [row(P, '100 100', '10.0.13.1', '100', { tag: 'best', hl: 'asPath' })]
      })
    });
    out.push({
      phase: '两条候选',
      title: 'R3A 收到两条候选：先比 LOCAL_PREF，再比 AS_PATH 长度',
      description: '两条路由的 LOCAL_PREF 都是缺省 100，第一步打平；于是按第二条规则比较 AS_PATH 长度，上方 2 段比下方 3 段更短，胜出成为 BEST。',
      formula: 'LOCAL_PREF 100 = 100 → 比 AS_PATH：2 < 3 → 选上方',
      hint: '默认规则下，“更短的 AS_PATH”胜出。',
      flows: [{ path: ['R1B', 'R2B', 'R3B', 'R3A'], cls: 'candidate' }],
      tables: Object.assign(base(), {
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100 100', '10.0.13.1', '100', { tag: 'best' })],
        R3B: [row(P, '200 100 100', '10.0.23.1', '100', { tag: 'best' })],
        R3A: [
          row(P, '200 100', '10.0.24.1', '100', { tag: 'best', hl: 'lp' }),
          row(P, '200 100 100', '10.0.23.1', '100', { tag: 'candidate', hl: 'lp' })
        ]
      })
    });
    out.push({
      phase: '默认转发',
      title: '默认规则下，数据走上方短路径',
      description: '绿色光流显示实际转发路径：R3A 把数据包交给 10.0.24.1（R2A），再经 R1 进入 AS100 到达目的网段。下方那条路只是静静躺在 BGP 表里做备份。',
      formula: '转发路径：R3A ▶ R2A ▶ R1 ▶ 192.168.1.0/24',
      hint: 'BEST 表项决定数据实际往哪走。',
      flows: [{ path: ['R3A', 'R2A', 'R1'], cls: 'chosen' }, { path: ['R1B', 'R2B', 'R3B', 'R3A'], cls: 'candidate' }],
      tables: Object.assign(base(), {
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100 100', '10.0.13.1', '100', { tag: 'best' })],
        R3B: [row(P, '200 100 100', '10.0.23.1', '100', { tag: 'best' })],
        R3A: [
          row(P, '200 100', '10.0.24.1', '100', { tag: 'best' }),
          row(P, '200 100 100', '10.0.23.1', '100', { tag: 'candidate' })
        ]
      })
    });
    out.push({
      phase: '策略介入',
      title: 'AS300 在 R3B 上把下方路由的 LOCAL_PREF 提到 300',
      description: 'LOCAL_PREF 是 AS 内部的选路策略属性，只在 iBGP 之间传递，eBGP 报文里根本不携带。R3B 通过 iBGP 把 LOCAL_PREF = 300 的下方路由通告给 R3A。',
      formula: 'R3B：LOCAL_PREF 100 → 300，经 iBGP 通告给 R3A',
      hint: '策略属性只在 AS 内部生效。',
      tone: 'notice',
      packets: [{ from: 'R3B', to: 'R3A', label: 'UPDATE', type: 'update', tag: 'LOCAL_PREF 300', delay: 0 }],
      activeLinks: ['R3A-R3B'], focus: ['R3B', 'R3A'],
      tables: Object.assign(base(), {
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100 100', '10.0.13.1', '100', { tag: 'best' })],
        R3B: [row(P, '200 100 100', '10.0.23.1', '300', { tag: 'best', hl: 'lp' })],
        R3A: [
          row(P, '200 100', '10.0.24.1', '100', { tag: 'candidate', hl: 'lp' }),
          row(P, '200 100 100', '10.0.23.1', '300', { tag: 'changed', hl: 'lp' })
        ]
      })
    });
    out.push({
      phase: '策略胜出',
      title: '第一条规则压过第四条：策略优于“路径更短”',
      description: '比较 LOCAL_PREF：300 > 100，选路在第一步就分出胜负，根本走不到比较 AS_PATH 那一步。BEST 标记移到下方那条更长的路由上。',
      formula: 'LOCAL_PREF 300 > 100 → 选下方（哪怕 AS_PATH 有 3 段）',
      hint: 'BGP 的选路是策略优先，不是最短路优先。',
      tone: 'notice',
      flows: [{ path: ['R3A', 'R2A', 'R1'], cls: 'candidate' }, { path: ['R3A', 'R3B', 'R2B', 'R1B'], cls: 'chosen' }],
      tables: Object.assign(base(), {
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100 100', '10.0.13.1', '100', { tag: 'best' })],
        R3B: [row(P, '200 100 100', '10.0.23.1', '300', { tag: 'best' })],
        R3A: [
          row(P, '200 100', '10.0.24.1', '100', { tag: 'candidate' }),
          row(P, '200 100 100', '10.0.23.1', '300', { tag: 'best', hl: 'lp' })
        ]
      })
    });
    out.push({
      phase: '切换完成',
      title: '光流强行切换到长路径',
      description: '转发路径变成 R3A → R3B → R2B → R1B → 目的网段，比原来多绕一跳。BGP 的设计哲学就是“策略优先于最短路径”：路由好不好，由管理员的意图说了算。',
      formula: '转发路径：R3A ▶ R3B ▶ R2B ▶ R1B ▶ 192.168.1.0/24',
      hint: '同一条前缀，出站方向被一个属性彻底改写。',
      tone: 'notice',
      flows: [{ path: ['R3A', 'R2A', 'R1'], cls: 'candidate' }, { path: ['R3A', 'R3B', 'R2B', 'R1B'], cls: 'chosen' }],
      tables: Object.assign(base(), {
        R2A: [row(P, '100', '10.0.12.1', '100', { tag: 'best' })],
        R2B: [row(P, '100 100', '10.0.13.1', '100', { tag: 'best' })],
        R3B: [row(P, '200 100 100', '10.0.23.1', '300', { tag: 'best' })],
        R3A: [
          row(P, '200 100', '10.0.24.1', '100', { tag: 'candidate' }),
          row(P, '200 100 100', '10.0.23.1', '300', { tag: 'best' })
        ]
      })
    });
    return { frames: out, milestones: [['两条候选', 0], ['AS 欺骗', 1], ['默认选短', 2], ['短路径转发', 3], ['LOCAL_PREF 300', 4], ['策略胜出', 5], ['光流切换', 6]] };
  }

  /* ============================================================
     8. 右侧速查面板
     ============================================================ */
  const PANELS = {
    s1: {
      title: 'BGP 四种报文', hint: '考研速查',
      html: `
        <table class="ref-table">
          <thead><tr><th>报文</th><th>作用</th></tr></thead>
          <tbody>
            <tr class="hot"><td>OPEN</td><td>建立邻居时协商参数：版本、AS 号、Hold Time、Router ID。</td></tr>
            <tr><td>UPDATE</td><td>通告可达前缀与路径属性，或撤销不可达前缀。只发增量。</td></tr>
            <tr><td>KEEPALIVE</td><td>周期保活，防止 Hold 定时器超时；也是对 OPEN 的确认。</td></tr>
            <tr><td>NOTIFICATION</td><td>报告错误并拆除会话，发出后 TCP 连接立即关闭。</td></tr>
          </tbody>
        </table>
        <p class="ref-foot">会话状态机：Idle → Connect → OpenSent → OpenConfirm → Established。只有 Established 才能交换 UPDATE。</p>`,
      ruleTitle: '记住这句话',
      ruleText: 'BGP 不会周期性交换整张路由表，它靠 TCP 长连接 + KEEPALIVE 保活，再用 UPDATE 增量维护路由。'
    },
    s2: {
      title: 'AS_PATH 防环规则', hint: '路径向量',
      html: `
        <ol class="ref-list">
          <li>每经过一个 AS，就把 <strong>AS 号前置</strong>到 AS_PATH 最前面。</li>
          <li><strong>eBGP</strong> 通告追加 AS 号；<strong>iBGP</strong> 通告不追加。</li>
          <li>收到 UPDATE 时检查：若 <strong>本 AS 号已在 AS_PATH 中</strong>，直接丢弃。</li>
          <li>AS_PATH 同时是选路依据：<strong>段数越少越优</strong>（先比 LOCAL_PREF）。</li>
          <li>空 AS_PATH 表示本 AS <strong>始发</strong>该前缀。</li>
        </ol>
        <p class="ref-foot">边界情况：AS 内部防环不能只靠 AS_PATH，还要遵守“iBGP 学到的路由不再传给其他 iBGP 邻居”，否则需引入路由反射器或做全互联。</p>`,
      ruleTitle: '记住这句话',
      ruleText: 'AS_PATH 是 BGP 唯一的环路检测手段：只要发现自己出现在路径里，这条路一定是绕回来的，立刻丢弃。'
    },
    s3: {
      title: 'eBGP 与 iBGP 对照', hint: 'NEXT_HOP',
      html: `
        <table class="ref-table">
          <thead><tr><th>对比项</th><th>eBGP</th><th>iBGP</th></tr></thead>
          <tbody>
            <tr class="hot"><td>邻居位置</td><td>不同 AS</td><td>同一 AS</td></tr>
            <tr class="hot"><td>AS_PATH</td><td>追加本端 AS 号</td><td>保持不变</td></tr>
            <tr class="win"><td>NEXT_HOP</td><td>改写为发送方接口</td><td>默认不变</td></tr>
            <tr><td>TTL</td><td>通常为 1</td><td>255</td></tr>
            <tr><td>路由再通告</td><td>可传给任意邻居</td><td>不再传给其他 iBGP 邻居</td></tr>
          </tbody>
        </table>
        <p class="ref-foot">补齐 NEXT_HOP 可达性的两个办法：① 用 IGP（OSPF / IS-IS）打通外部邻居接口地址；② 在边界路由器上配置 <strong>next-hop-self</strong>。</p>`,
      ruleTitle: '记住这句话',
      ruleText: 'iBGP 保留 NEXT_HOP 是为了让 AS 内部知道真正的出口；但也因此必须自己解决到该地址的可达性。'
    },
    s4: {
      title: 'BGP 选路判定顺序', hint: '前 5 条',
      html: `
        <table class="ref-table">
          <thead><tr><th>顺序</th><th>规则</th></tr></thead>
          <tbody>
            <tr class="win"><td>1</td><td>LOCAL_PREF 最大者优先（AS 内策略）</td></tr>
            <tr><td>2</td><td>本地始发（network / aggregate）优先</td></tr>
            <tr><td>3</td><td>AS_PATH 最短者优先</td></tr>
            <tr class="lose"><td>4</td><td>起源类型 IGP &lt; EGP &lt; Incomplete</td></tr>
            <tr><td>5</td><td>MED 最小者优先（仅同邻居 AS 比较）</td></tr>
          </tbody>
        </table>
        <p class="ref-foot">LOCAL_PREF 缺省 100，数值越大越优先；只在 iBGP 中传递，不随 eBGP 离开本 AS。它是<b>出站</b>选路策略；影响<b>入站</b>选路常用 AS 欺骗、MED 或 Community。</p>`,
      ruleTitle: '记住这句话',
      ruleText: 'BGP 是策略路由协议：LOCAL_PREF 在第 1 步就分胜负，AS_PATH 长度排在后面，“更短”不一定赢。'
    }
  };

  /* ============================================================
     9. 状态与渲染
     ============================================================ */
  const State = { scene: 's1', index: 0, playing: false, speed: 1, token: 0, timer: null, data: null };

  const SCENE_META = {
    s1: { title: '先建立可靠的邻居关系', scenes: s1Frames },
    s2: { title: 'AS_PATH：既比长短，也防环路', scenes: s2Frames },
    s3: { title: 'NEXT_HOP 什么时候改、什么时候不改', scenes: s3Frames },
    s4: { title: '策略如何压过“路径更短”', scenes: s4Frames }
  };

  function setInsight(frame) {
    const box = $('insight');
    box.classList.remove('warning', 'notice');
    if (frame.tone === 'warning') box.classList.add('warning');
    else if (frame.tone === 'notice') box.classList.add('notice');

    // 文案同步写入（避免快速切步时写入过期内容），过渡动画只负责透明度
    $('step-kicker').textContent = frame.phase || '';
    $('step-title').textContent = frame.title || '';
    $('step-description').textContent = frame.description || '';
    $('formula').textContent = frame.formula || '';
    const note = $('insight-note');
    note.textContent = frame.note || '';
    note.hidden = !frame.note;

    if (noMotion()) return;
    const t = State.token;
    Anim.tween({
      from: 0.32, to: 1, duration: 0.34, ease: 'power2.out',
      onUpdate: v => { if (t === State.token) box.style.opacity = v; }
    });
  }

  function renderStates(step) {
    const wrap = $('bgp-states');
    wrap.hidden = step == null || step < 0;
    if (wrap.hidden) return;
    wrap.querySelectorAll('li').forEach((li, i) => {
      li.classList.toggle('done', i < step);
      li.classList.toggle('current', i === step);
    });
  }

  function renderNodes(frame) {
    NODE_ORDER.forEach(key => {
      const g = layers.nodes.querySelector('[data-node="' + key + '"]');
      g.classList.remove('focus', 'alert', 'confirmed');
      if ((frame.focus || []).includes(key)) g.classList.add('focus');
      if ((frame.alert || []).includes(key)) g.classList.add('alert');
    });
  }

  function renderLinks(frame) {
    const active = (frame.activeLinks || []).map(k => k.split('-').sort().join('-'));
    layers.links.querySelectorAll('.link').forEach(l => {
      const key = l.getAttribute('data-key');
      const on = active.includes(key);
      l.classList.toggle('active', on);
      l.classList.toggle('dim', active.length > 0 && !on);
    });
  }

  function renderKeepalive(on) {
    layers.fx.querySelectorAll('.heartbeat').forEach(el => el.remove());
    if (!on) return;
    const pts = [edgePoint('R1', 'R2A', 96), edgePoint('R1', 'R2A', 168)];
    pts.forEach((p, i) => {
      const c = svgEl('circle', { cx: p.x, cy: p.y, r: 5, class: 'heartbeat on' });
      layers.fx.appendChild(c);
      if (!noMotion()) {
        Anim.tween({
          from: 0.15, to: 1, duration: 0.75, delay: i * 0.35, ease: 'sine.inOut',
          onUpdate: v => c.setAttribute('opacity', v),
          onComplete: () => {
            Anim.tween({
              from: 1, to: 0.15, duration: 0.75, ease: 'sine.inOut',
              onUpdate: v => { if (c.isConnected) c.setAttribute('opacity', v); }
            });
          }
        });
      }
    });
  }

  function renderFlows(flows) {
    while (layers.flow.firstChild) layers.flow.removeChild(layers.flow.firstChild);
    (flows || []).forEach(f => drawFlow(f.path, f.cls));
  }

  function renderFx(frame) {
    while (layers.fx.firstChild) layers.fx.removeChild(layers.fx.firstChild);
    renderKeepalive(!!frame.keepalive);
    (frame.fxLabels || []).forEach(l => addFxLabel(l.x, l.y, l.text, l.tone));
    if (frame.drop) addDropMark(frame.drop.x, frame.drop.y, frame.drop.text);
  }

  function renderFrame() {
    const frames = State.data.frames;
    const frame = frames[State.index];
    State.token += 1;
    const token = State.token;

    $('scene-title').textContent = SCENE_META[State.scene].title;
    $('phase').textContent = frame.phase || '';
    $('stage-hint').textContent = frame.hint || '';
    renderStates(frame.stateStep == null ? -1 : frame.stateStep);
    setInsight(frame);
    renderNodes(frame);
    renderLinks(frame);
    renderFlows(frame.flows);
    renderFx(frame);
    renderCards(frame.tables, token);
    animatePackets(frame.packets, token);

    $('seek').max = String(frames.length - 1);
    $('seek').value = String(State.index);
    $('progress').textContent = (State.index + 1) + ' / ' + frames.length;

    State.data.milestones.forEach(([label, at], i) => {
      const btn = $('milestones').querySelectorAll('button')[i];
      if (btn) btn.classList.toggle('current', at === State.index);
    });

    $('btn-prev').disabled = State.index === 0;
    $('btn-next').disabled = State.index === frames.length - 1;
  }

  function renderPanel() {
    const panel = PANELS[State.scene];
    $('panel-title').textContent = panel.title;
    $('panel-hint').textContent = panel.hint;
    $('panel-body').innerHTML = panel.html;
    $('rule-title').textContent = panel.ruleTitle;
    $('rule-text').textContent = panel.ruleText;
    if (!noMotion() && window.gsap) {
      window.gsap.fromTo('#panel-body', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
    }
  }

  /* ============================================================
     10. 播放控制
     ============================================================ */
  function loadScene(scene, keepIndex) {
    State.scene = scene;
    State.data = SCENE_META[scene].scenes();
    State.index = keepIndex ? Math.min(State.index, State.data.frames.length - 1) : 0;
    document.querySelectorAll('.lessons button').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.scene === scene));
    });
    const box = $('milestones');
    box.innerHTML = '';
    State.data.milestones.forEach(([label, at]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', () => { pause(); State.index = at; renderFrame(); });
      box.appendChild(btn);
    });
    renderPanel();
    renderFrame();
  }

  function schedule() {
    clearTimeout(State.timer);
    if (!State.playing) return;
    const frames = State.data.frames;
    if (State.index >= frames.length - 1) { pause(); return; }
    State.timer = setTimeout(() => {
      if (!State.playing) return;
      State.index += 1;
      renderFrame();
      schedule();
    }, 3200 / State.speed);
  }

  function play() {
    if (State.index >= State.data.frames.length - 1) State.index = 0;
    State.playing = true;
    $('btn-play').disabled = true;
    $('btn-pause').disabled = false;
    renderFrame();
    schedule();
  }
  function pause() {
    State.playing = false;
    clearTimeout(State.timer);
    $('btn-play').disabled = false;
    $('btn-pause').disabled = true;
  }
  function step(delta) {
    pause();
    const next = Math.max(0, Math.min(State.data.frames.length - 1, State.index + delta));
    if (next === State.index) return;
    State.index = next;
    renderFrame();
  }

  /* ============================================================
     11. 事件绑定
     ============================================================ */
  function bind() {
    document.querySelectorAll('.lessons button').forEach(b => {
      b.addEventListener('click', () => {
        pause();
        loadScene(b.dataset.scene);
      });
    });

    $('btn-play').addEventListener('click', play);
    $('btn-pause').addEventListener('click', pause);
    $('btn-prev').addEventListener('click', () => step(-1));
    $('btn-next').addEventListener('click', () => step(1));
    $('btn-reset').addEventListener('click', () => {
      pause();
      State.index = 0;
      renderFrame();
    });
    $('seek').addEventListener('input', e => {
      pause();
      State.index = Number(e.target.value);
      renderFrame();
    });
    $('speed').addEventListener('change', e => {
      State.speed = Number(e.target.value);
      if (State.playing) schedule();
    });

    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.code === 'Space') { e.preventDefault(); State.playing ? pause() : play(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    });
  }

  /* ============================================================
     12. 启动
     ============================================================ */
  buildStatic();
  buildCards();
  bind();
  loadScene('s1');
})();
