(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const D = window.DNSData;
  const M = window.DNSModel;
  const C = window.DNSChoreo;
  const $ = id => document.getElementById(id);
  const pad = value => String(value).padStart(2, '0');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const hash = new URLSearchParams(location.hash.slice(1));
  const media = matchMedia('(prefers-reduced-motion: reduce)');

  let COLORS = {
    blue: '#285FB4',
    pine: '#2F7D68',
    ochre: '#B07A2E',
    ink: '#343C38',
    white: '#FFFEFA'
  };

  let state = {
    zone: 'single',
    mode: 'iterative',
    target: 't',
    time: 0,
    speed: 1,
    reduced: media.matches,
    playing: false
  };
  let sequence = null;
  let timeline = null;
  let lastIndex = -1;
  let lastComplete = false;
  let lastMatch = '';
  let lastMessageKey = '';
  let lastWrite = 0;
  let motionOverride = false;
  let zoneTweens = [];
  let routeTweens = [];
  let targetTween = null;

  const refs = {
    nodes: {},
    baseEdges: {},
    litEdges: {},
    routeBase: {},
    routeDone: {},
    cards: {}
  };

  /* ── 基础工具 ─────────────────────────────────────── */
  function make(tag, attrs, parent, text) {
    const el = document.createElementNS(NS, tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value !== undefined && value !== null) el.setAttribute(key, String(value));
      }
    }
    if (text !== undefined) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }

  function setText(el, value) {
    const next = value == null ? '' : String(value);
    if (el && el.textContent !== next) el.textContent = next;
  }

  function setAttr(el, key, value) {
    const next = String(value);
    if (el && el.getAttribute(key) !== next) el.setAttribute(key, next);
  }

  function setClass(el, value) {
    if (el && el.getAttribute('class') !== value) el.setAttribute('class', value);
  }

  function toggleClass(el, name, on) {
    if (el) el.classList.toggle(name, Boolean(on));
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function readColors() {
    const next = {
      blue: cssVar('--blue'),
      pine: cssVar('--pine'),
      ochre: cssVar('--ochre'),
      ink: cssVar('--ink'),
      white: cssVar('--white')
    };
    Object.keys(next).forEach(key => {
      if (next[key]) COLORS[key] = next[key];
    });
  }

  function parseHex(value) {
    const hex = String(value).replace('#', '');
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }

  function mixColor(a, b, k) {
    const A = parseHex(a);
    const B = parseHex(b);
    const t = clamp(k, 0, 1);
    const rgb = A.map((value, index) => Math.round(value + (B[index] - value) * t));
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  function kindColor(kind) {
    if (kind === 'referral') return COLORS.ochre;
    if (kind === 'answer') return COLORS.pine;
    return COLORS.blue;
  }

  function duration() {
    return C.duration(sequence, state.reduced);
  }

  function currentSample() {
    return C.sample(sequence, state.time, state.reduced);
  }

  function stepEnd(completedSteps) {
    if (completedSteps >= sequence.steps.length) return duration();
    return Math.max(0, C.boundary(sequence, state.reduced, completedSteps) - 0.002);
  }

  /* ── 舞台构建 ─────────────────────────────────────── */
  function buildStage() {
    buildZoneLayer();
    buildRoutes();
    buildTree();
    buildTargetAndProbe();
    buildBridge();
    buildServers();
    buildDelegationAndBus();
    buildPacketAndHud();
  }

  function buildZoneLayer() {
    const layer = $('zone-layer');
    const main = make('g', { class: 'zone-main', id: 'zone-main' }, layer);
    const mainRect = make('rect', {
      id: 'zone-main-rect',
      x: 60, y: 205, width: 300, height: 335,
      rx: 24, class: 'zone-field'
    }, main);
    const mainTitle = make('text', { x: 76, y: 228, class: 'zone-name' }, main, '区 · abc.com');
    const mainSub = make('text', { x: 76, y: 245, class: 'zone-sub' }, main, 'y 未委派 · 同属一区');

    const yGroup = make('g', { class: 'zone-y', id: 'zone-y' }, layer);
    const yRect = make('rect', {
      id: 'zone-y-rect',
      x: D.ZONE_GEOMETRY.y.x,
      y: D.ZONE_GEOMETRY.y.y,
      width: D.ZONE_GEOMETRY.y.w,
      height: D.ZONE_GEOMETRY.y.h,
      rx: 20,
      class: 'zone-field'
    }, yGroup);
    const yTitle = make('text', { x: 266, y: 318, class: 'zone-name' }, yGroup, '区 2 · y.abc.com');
    const ySub = make('text', { x: 266, y: 334, class: 'zone-sub' }, yGroup, '委派给 dns.y.abc.com');

    const seam = make('path', {
      id: 'zone-seam',
      class: 'zone-seam',
      d: 'M 254 300 L 254 540'
    }, layer);

    const yTag = make('g', { class: 'y-tag', id: 'y-tag', transform: 'translate(338 383)' }, layer);
    make('rect', { x: -22, y: -9, width: 44, height: 18, rx: 9 }, yTag);
    const yTagText = make('text', { x: 0, y: 3.5 }, yTag, '同区');

    refs.zoneMain = main;
    refs.zoneMainRect = mainRect;
    refs.zoneMainTitle = mainTitle;
    refs.zoneMainSub = mainSub;
    refs.zoneYGroup = yGroup;
    refs.zoneYRect = yRect;
    refs.zoneYTitle = yTitle;
    refs.zoneYSub = ySub;
    refs.zoneSeam = seam;
    refs.yTag = yTag;
    refs.yTagText = yTagText;
  }

  function buildRoutes() {
    const baseLayer = $('route-base');
    const doneLayer = $('route-done');
    for (const key of Object.keys(D.ROUTES)) {
      const d = D.routeD(key);
      const base = make('path', {
        d,
        class: 'route-base',
        'data-route': key,
        'aria-hidden': 'true'
      }, baseLayer);
      const done = make('path', {
        d,
        class: 'route-done',
        'data-route': key,
        opacity: 0
      }, doneLayer);
      refs.routeBase[key] = base;
      refs.routeDone[key] = done;
    }
  }

  function buildTree() {
    const base = $('tree-base');
    const lit = $('tree-lit');
    for (const edge of D.TREE_EDGES) {
      const d = D.edgeD(edge);
      refs.baseEdges[edge.id] = make('path', {
        d,
        class: 'tree-base-edge',
        'data-edge': edge.id
      }, base);
      refs.litEdges[edge.id] = make('path', {
        d,
        class: 'tree-lit-edge',
        'data-edge': edge.id,
        pathLength: 1,
        'stroke-dasharray': 1,
        'stroke-dashoffset': 1,
        opacity: 0
      }, lit);
    }

    const layer = $('tree-nodes');
    for (const [id, node] of Object.entries(D.TREE_NODES)) {
      const g = make('g', {
        class: `tree-node${node.muted ? ' is-muted' : ''}`,
        'data-node': id,
        transform: `translate(${node.x} ${node.y})`
      }, layer);
      make('circle', { r: node.r, class: 'node-bg' }, g);
      const nameClass = `node-name${id === 'root' ? ' is-root' : ''}${node.size <= 9.5 ? ' is-small' : ''}`;
      make('text', {
        y: id === 'root' ? 6 : 4,
        class: nameClass
      }, g, node.name);
      const role = make('text', {
        y: node.r + (id === 't' || id === 'u' ? 17 : 15),
        class: 'node-role'
      }, g, node.role);
      refs.nodes[id] = { g, role };
    }
  }

  function buildTargetAndProbe() {
    const target = make('circle', {
      id: 'target-ring',
      class: 'target-ring',
      r: 30,
      cx: 0,
      cy: 0,
      opacity: 0
    }, $('target-ring-layer'));
    refs.targetRing = target;

    const probe = make('g', { id: 'probe' }, $('tree-probe'));
    const halo = make('circle', { class: 'probe-halo', r: 30, cx: 0, cy: 0 }, probe);
    const dot = make('circle', { class: 'probe-dot', r: 2.2, cx: 0, cy: -30 }, probe);
    refs.probe = probe;
    refs.probeHalo = halo;
    refs.probeDot = dot;
  }

  function buildBridge() {
    const g = make('g', { id: 'bridge', opacity: 0 }, $('bridge-layer'));
    const bg = make('rect', { x: -59, y: -24, width: 118, height: 17, rx: 4, class: 'bridge-bg' }, g);
    const text = make('text', { x: 0, y: -11.5, class: 'bridge-text' }, g, 'com ↔ TLD');
    make('line', { x1: -48, y1: 0, x2: 48, y2: 0, class: 'bridge-line' }, g);
    make('circle', { cx: -48, cy: 0, r: 1.6, class: 'bridge-dot' }, g);
    make('circle', { cx: 48, cy: 0, r: 1.6, class: 'bridge-dot' }, g);
    refs.bridge = { g, text, bg };
  }

  function makeIcon(parent, s, x, y) {
    const g = make('g', { class: 'card-icon', transform: `translate(${x} ${y})` }, parent);
    if (s.kind === 'host') {
      make('rect', { x: -8, y: -7, width: 16, height: 11, rx: 2 }, g);
      make('line', { x1: 0, y1: 4, x2: 0, y2: 8 }, g);
      make('line', { x1: -5, y1: 8, x2: 5, y2: 8 }, g);
    } else {
      make('rect', { x: -7, y: -8, width: 14, height: 16, rx: 2.5 }, g);
      make('line', { x1: -4, y1: -4, x2: 4, y2: -4 }, g);
      make('line', { x1: -4, y1: 0, x2: 4, y2: 0 }, g);
      make('line', { x1: -4, y1: 4, x2: 4, y2: 4 }, g);
      make('circle', { cx: -4, cy: 6, r: 0.8, class: 'card-icon-fill' }, g);
    }
    return g;
  }

  function buildCard(id, s) {
    const g = make('g', {
      class: `server-card accent-${s.accent} server-${id}`,
      'data-server': id,
      transform: `translate(${s.x} ${s.y})`
    }, $('server-layer'));

    make('rect', {
      x: -s.w / 2, y: -s.h / 2, width: s.w, height: s.h,
      rx: 10, class: 'card-bg', filter: 'url(#card-shadow)'
    }, g);
    make('rect', {
      x: -s.w / 2, y: -s.h / 2, width: 3, height: s.h,
      rx: 1.5, class: 'card-accent'
    }, g);

    const focus = make('rect', {
      x: -s.w / 2 - 4, y: -s.h / 2 - 4, width: s.w + 8, height: s.h + 8,
      rx: 13, class: 'card-focus', opacity: 0
    }, g);

    const iconX = -s.w / 2 + (s.kind === 'resolver' ? 22 : 20);
    const iconY = s.kind === 'resolver' ? -14 : (s.kind === 'host' ? 0 : -5);
    makeIcon(g, s, iconX, iconY);

    const textX = -s.w / 2 + 38;
    const dot = make('circle', {
      cx: s.w / 2 - 12,
      cy: -s.h / 2 + 12,
      r: 3.2,
      class: 'card-dot'
    }, g);

    const card = { g, bg: null, focus, dot, aa: null, old: null, new: null };

    if (s.kind === 'host') {
      make('text', { x: textX, y: -2, class: 'card-name' }, g, s.name);
      make('text', { x: textX, y: 14, class: 'card-domain mono' }, g, s.domain);
    } else if (s.kind === 'resolver') {
      make('text', { x: textX, y: -29, class: 'card-level' }, g, s.level);
      make('text', { x: textX, y: -10, class: 'card-name' }, g, s.name);
      make('text', { x: textX, y: 7, class: 'card-domain mono' }, g, s.domain);
      make('line', {
        x1: -s.w / 2 + 16, y1: 17, x2: s.w / 2 - 16, y2: 17,
        class: 'local-rule'
      }, g);
      make('text', { x: -s.w / 2 + 16, y: 36, class: 'counter-label' }, g, '对外查询');
      const counterViewport = make('svg', {
        x: 0, y: 20, width: 48, height: 24,
        viewBox: '0 0 48 24', overflow: 'hidden', 'aria-hidden': 'true'
      }, g);
      const oldText = make('text', {
        x: 24, y: 18, class: 'counter-value', 'aria-hidden': 'true'
      }, counterViewport, '0');
      const newText = make('text', {
        x: 24, y: 42, class: 'counter-value', 'aria-hidden': 'true'
      }, counterViewport, '0');
      make('text', { x: 50, y: 36, class: 'counter-unit' }, g, '次');
      card.old = oldText;
      card.new = newText;
    } else {
      make('text', { x: textX, y: -19, class: 'card-level' }, g, s.level);
      make('text', { x: textX, y: 1, class: 'card-name' }, g, s.name);
      make('text', { x: textX, y: 18, class: 'card-domain mono' }, g, s.domain);
      if (id === 'auth' || id === 'authy') {
        const aa = make('g', { class: 'card-aa', opacity: 0 }, g);
        make('rect', { x: s.w / 2 - 44, y: s.h / 2 - 17, width: 32, height: 14, rx: 7, class: 'aa-bg' }, aa);
        make('text', { x: s.w / 2 - 28, y: s.h / 2 - 7, class: 'aa-text' }, aa, 'AA');
        card.aa = aa;
      }
    }

    refs.cards[id] = card;
  }

  function buildServers() {
    for (const [id, server] of Object.entries(D.SERVERS)) buildCard(id, server);

    const placeholder = make('g', {
      class: 'y-placeholder',
      id: 'y-placeholder',
      transform: `translate(${D.SERVERS.authy.x} ${D.SERVERS.authy.y})`
    }, $('y-placeholder-layer'));
    make('rect', {
      x: -D.SERVERS.authy.w / 2,
      y: -D.SERVERS.authy.h / 2,
      width: D.SERVERS.authy.w,
      height: D.SERVERS.authy.h,
      rx: 10,
      class: 'ph-bg'
    }, placeholder);
    make('text', { x: -D.SERVERS.authy.w / 2 + 16, y: -4, class: 'ph-title' }, placeholder, 'y 子域');
    make('text', { x: -D.SERVERS.authy.w / 2 + 16, y: 14, class: 'ph-sub' }, placeholder, '未委派 · 同属 abc 区');
    refs.yPlaceholder = placeholder;
  }

  function buildDelegationAndBus() {
    const delegation = make('g', { id: 'delegation', opacity: 0 }, $('delegation-layer'));
    make('path', {
      d: 'M 1060 307 L 1040 338',
      class: 'delegation-line'
    }, delegation);
    make('text', { x: 1070, y: 325, class: 'delegation-label' }, delegation, 'NS 委派');
    refs.delegation = delegation;

    const bus = make('text', {
      transform: 'translate(1150 300) rotate(90)',
      class: 'bus-label',
      'text-anchor': 'middle'
    }, $('bus-label-layer'), '递归接力');
    refs.busLabel = bus;
  }

  function buildPacketAndHud() {
    const packet = make('g', {
      id: 'packet',
      class: 'packet kind-query',
      opacity: 0
    }, $('packet-layer'));
    make('rect', { x: -27, y: -11, width: 54, height: 22, rx: 11, class: 'packet-bg' }, packet);
    make('circle', { cx: -18, cy: 0, r: 2.4, class: 'packet-dot' }, packet);
    const packetText = make('text', { x: 4, y: 3.5, class: 'packet-text' }, packet, '询问');
    refs.packet = { g: packet, text: packetText };

    const tag = make('g', { id: 'tag', opacity: 0 }, $('tag-layer'));
    const tagBg = make('rect', { x: -54, y: -12, width: 108, height: 24, rx: 12, class: 'tag-bg' }, tag);
    const tagText = make('text', { x: 0, y: 4, class: 'tag-text' }, tag, '');
    refs.tag = { g: tag, text: tagText, bg: tagBg };

    const result = make('g', { id: 'result', opacity: 0 }, $('result-layer'));
    make('rect', { x: -52, y: -12, width: 104, height: 24, rx: 12, class: 'result-bg' }, result);
    const resultText = make('text', { x: 0, y: 4, class: 'result-text' }, result, 'A 192.0.2.88');
    refs.result = { g: result, text: resultText };

    const pulse = make('circle', {
      id: 'pulse',
      r: 6,
      cx: 0,
      cy: 0,
      class: 'pulse-ring',
      opacity: 0
    }, $('pulse-layer'));
    refs.pulse = pulse;

    const shortToken = make('g', { id: 'short-token', opacity: 0 }, $('packet-layer'));
    const shortCircle = make('circle', { r: 8, cx: 0, cy: 0, class: 'short-token-bg' }, shortToken);
    const shortText = make('text', { x: 0, y: 3.3, class: 'short-token-text' }, shortToken, '↑');
    refs.shortToken = shortToken;
    refs.shortTokenCircle = shortCircle;
    refs.shortTokenText = shortText;
  }

  /* ── 配置与场景视觉 ───────────────────────────────── */
  function routeVisible(key) {
    const area = D.ROUTES[key] ? D.ROUTES[key].area : 'both';
    if (area === 'both') return true;
    if (area === 'iterative') return state.mode === 'iterative';
    if (area === 'iterative-y') return state.mode === 'iterative' && state.zone === 'two';
    if (area === 'recursive') return state.mode === 'recursive';
    if (area === 'recursive-y') return state.mode === 'recursive' && state.zone === 'two';
    return true;
  }

  function killTweens(list) {
    for (const tween of list) {
      if (tween) tween.kill();
    }
    list.length = 0;
  }

  function updateRouteVisibility(animate) {
    killTweens(routeTweens);
    for (const [key, path] of Object.entries(refs.routeBase)) {
      const visible = routeVisible(key);
      if (animate && window.gsap) {
        routeTweens.push(gsap.to(path, {
          opacity: visible ? 1 : 0,
          duration: 0.3,
          ease: 'power1.out'
        }));
      } else {
        path.style.opacity = visible ? '1' : '0';
      }
    }
  }

  function setZoneVisual(zone, animate) {
    const stage = $('stage');
    stage.dataset.zone = zone;
    const geometry = zone === 'single' ? D.ZONE_GEOMETRY.mainSingle : D.ZONE_GEOMETRY.mainTwo;
    const labels = D.ZONE_GEOMETRY.labels;
    const yVisible = zone === 'two';

    setText(refs.zoneMainTitle, yVisible ? labels.twoTitle : labels.singleTitle);
    setText(refs.zoneMainSub, yVisible ? labels.twoSub : labels.singleSub);
    setText(refs.zoneYTitle, labels.yTitle);
    setText(refs.zoneYSub, labels.ySub);
    setText(refs.yTagText, yVisible ? '独立区' : '同区');
    toggleClass(refs.yTag, 'is-two', yVisible);

    killTweens(zoneTweens);
    if (animate && window.gsap) {
      const mainTween = {
        attr: { x: geometry.x, y: geometry.y, width: geometry.w, height: geometry.h },
        duration: 0.35,
        ease: 'power2.inOut'
      };
      if (yVisible) {
        zoneTweens.push(gsap.to(refs.zoneMainRect, mainTween));
        zoneTweens.push(gsap.to(refs.yPlaceholder, { opacity: 0, duration: 0.12, delay: 0.18, ease: 'power1.out' }));
        zoneTweens.push(gsap.to(refs.zoneYGroup, { opacity: 1, duration: 0.28, delay: 0.3, ease: 'power2.out' }));
        zoneTweens.push(gsap.to(refs.cards.authy.g, { opacity: 1, duration: 0.28, delay: 0.3, ease: 'power2.out' }));
        zoneTweens.push(gsap.to(refs.delegation, { opacity: 1, duration: 0.25, delay: 0.34, ease: 'power2.out' }));
        zoneTweens.push(gsap.to(refs.zoneSeam, { opacity: 1, duration: 0.25, delay: 0.34, ease: 'power2.out' }));
      } else {
        zoneTweens.push(gsap.to(refs.zoneYGroup, { opacity: 0, duration: 0.2, ease: 'power1.out' }));
        zoneTweens.push(gsap.to(refs.cards.authy.g, { opacity: 0, duration: 0.2, ease: 'power1.out' }));
        zoneTweens.push(gsap.to(refs.delegation, { opacity: 0, duration: 0.2, ease: 'power1.out' }));
        zoneTweens.push(gsap.to(refs.zoneSeam, { opacity: 0, duration: 0.2, ease: 'power1.out' }));
        zoneTweens.push(gsap.to(refs.yPlaceholder, { opacity: 1, duration: 0.25, delay: 0.12, ease: 'power2.out' }));
        zoneTweens.push(gsap.to(refs.zoneMainRect, { ...mainTween, delay: 0.18 }));
      }
    } else {
      setAttr(refs.zoneMainRect, 'x', geometry.x);
      setAttr(refs.zoneMainRect, 'y', geometry.y);
      setAttr(refs.zoneMainRect, 'width', geometry.w);
      setAttr(refs.zoneMainRect, 'height', geometry.h);
      refs.zoneYGroup.style.opacity = yVisible ? '1' : '0';
      refs.yPlaceholder.style.opacity = yVisible ? '0' : '1';
      refs.cards.authy.g.style.opacity = yVisible ? '1' : '0';
      refs.delegation.style.opacity = yVisible ? '1' : '0';
      refs.zoneSeam.style.opacity = yVisible ? '1' : '0';
    }
  }

  function setModeVisual(mode, animate) {
    const stage = $('stage');
    stage.dataset.mode = mode;
    if (animate && window.gsap) {
      gsap.to(refs.busLabel, { opacity: mode === 'recursive' ? 1 : 0, duration: 0.3, ease: 'power1.out', overwrite: 'auto' });
    } else {
      refs.busLabel.style.opacity = mode === 'recursive' ? '1' : '0';
    }
    updateRouteVisibility(animate);
  }

  function setTargetVisual(target, animate, fade = true) {
    const stage = $('stage');
    stage.dataset.target = target;
    const nodeId = D.TARGETS[target].node;
    const node = D.TREE_NODES[nodeId];
    const tColor = state.zone === 'two' ? COLORS.pine : COLORS.ochre;
    const color = target === 't' ? tColor : COLORS.ochre;

    setAttr(refs.targetRing, 'transform', `translate(${node.x} ${node.y})`);
    setAttr(refs.targetRing, 'r', node.r + 11);
    setAttr(refs.targetRing, 'stroke', color);
    if (targetTween) {
      targetTween.kill();
      targetTween = null;
    }
    if (fade && animate && window.gsap) {
      refs.targetRing.style.opacity = '0';
      targetTween = gsap.to(refs.targetRing, { opacity: 0.62, duration: 0.3, ease: 'power1.out' });
    } else {
      refs.targetRing.style.opacity = '0.62';
    }

    setText(refs.nodes.t.role, target === 't' ? '目标主机' : '主机');
    setText(refs.nodes.u.role, target === 'u' ? '目标主机' : '主机');
    toggleClass(refs.nodes.t.g, 'is-target', target === 't');
    toggleClass(refs.nodes.u.g, 'is-target', target === 'u');
    refs.nodes.t.g.style.setProperty('--target-color', tColor);
    refs.nodes.u.g.style.setProperty('--target-color', COLORS.ochre);
  }

  function syncUI() {
    document.querySelectorAll('[data-zone]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.zone === state.zone));
    });
    document.querySelectorAll('[data-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
    });
    document.querySelectorAll('[data-target]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.target === state.target));
    });

    $('query-name').textContent = sequence.targetInfo.host;
    $('zone-badge').textContent = state.zone === 'two' ? '两区' : '单区';
    $('step-total').textContent = String(sequence.steps.length);
    $('progress').max = String(duration());
    $('speed').value = String(state.speed);
    $('reduce-motion').checked = state.reduced;
    document.body.dataset.reduced = String(state.reduced);
    document.body.dataset.playing = String(state.playing);
    buildStepTrack();
  }

  function buildStepTrack() {
    const track = $('step-track');
    const buttons = sequence.steps.map((step, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.index = String(index);
      button.title = `${step.title}：${step.caption}`;
      button.setAttribute('aria-label', `第 ${index + 1} 步：${step.title}`);
      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = pad(index + 1);
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = step.short;
      button.append(idx, label);
      button.addEventListener('click', () => {
        pause();
        seek(stepEnd(index + 1));
      });
      return button;
    });
    track.replaceChildren(...buttons);
  }

  /* ── 视觉渲染 ─────────────────────────────────────── */
  function updatePacket(frame) {
    if (!refs.packet) return;
    const point = frame.packet.point;
    const shortHop = frame.packet.shortHop;
    setAttr(refs.packet.g, 'opacity', shortHop ? 0 : frame.packet.alpha.toFixed(3));
    if (!shortHop) {
      setAttr(refs.packet.g, 'transform', `translate(${point[0].toFixed(2)} ${point[1].toFixed(2)})`);
      const className = `packet kind-${frame.packet.kind}`;
      setClass(refs.packet.g, className);
      setText(refs.packet.text, frame.packet.label);
    }
    setAttr(refs.shortToken, 'transform', `translate(${point[0].toFixed(2)} ${point[1].toFixed(2)})`);
    setAttr(refs.shortToken, 'opacity', shortHop ? frame.packet.alpha.toFixed(3) : 0);
    if (shortHop) {
      setAttr(refs.shortTokenCircle, 'fill', kindColor(frame.packet.kind));
      setText(refs.shortTokenText, frame.packet.kind === 'answer' ? '✓' : '↑');
    }
  }

  function updateTrail(frame) {
    const trail = refs.activeTrail || $('active-trail');
    refs.activeTrail = trail;
    if (!trail) return;
    const points = frame.trailPoints;
    if (frame.packet.alpha <= 0.001 || points.length < 2) {
      setAttr(trail, 'opacity', 0);
      return;
    }
    let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i][0].toFixed(1)} ${points[i][1].toFixed(1)}`;
    }
    setAttr(trail, 'd', d);
    setClass(trail, `kind-${frame.trailKind}`);
    setAttr(trail, 'opacity', (0.55 * frame.packet.alpha).toFixed(3));
  }

  function updateDoneRoutes(frame) {
    for (const [key, path] of Object.entries(refs.routeDone)) {
      const kind = frame.completedRoutes[key];
      if (kind && routeVisible(key)) {
        setClass(path, `route-done kind-${kind}`);
        setAttr(path, 'opacity', 0.32);
      } else {
        setAttr(path, 'opacity', 0);
      }
    }
  }

  function updateTree(frame, step) {
    const color = mixColor(COLORS.blue, COLORS.pine, frame.resolvedMix);
    for (const [id, path] of Object.entries(refs.litEdges)) {
      const amount = frame.lit[id] || 0;
      setAttr(path, 'stroke-dashoffset', (1 - amount).toFixed(4));
      setAttr(path, 'stroke', color);
      setAttr(path, 'opacity', amount > 0.001 ? 1 : 0);
    }

    const probeNode = D.TREE_NODES[frame.probe.node];
    const probePoint = frame.probe.point;
    setAttr(refs.probe, 'transform', `translate(${probePoint[0].toFixed(2)} ${probePoint[1].toFixed(2)})`);
    setAttr(refs.probeHalo, 'r', probeNode.r + 7);
    setAttr(refs.probeHalo, 'stroke', color);
    setAttr(refs.probeDot, 'cy', -(probeNode.r + 7));
    setAttr(refs.probeDot, 'fill', color);

    for (const [id, ref] of Object.entries(refs.nodes)) {
      const resolved = step.after.resolved && id === step.after.match && frame.resolvedMix > 0.5;
      const active = id === frame.match && !resolved;
      toggleClass(ref.g, 'is-active', active);
      toggleClass(ref.g, 'is-resolved', resolved);
    }

    const match = frame.match;
    const mainActive = ['abc', 'x', 'u', 'v', 'w'].includes(match)
      || (state.zone === 'single' && ['y', 't'].includes(match));
    const yActive = state.zone === 'two' && ['y', 't'].includes(match);
    toggleClass(refs.zoneMain, 'is-active', mainActive);
    toggleClass(refs.zoneYGroup, 'is-active', yActive);
  }

  function updateCards(frame) {
    for (const [id, card] of Object.entries(refs.cards)) {
      const active = frame.focus === id;
      const done = frame.queried.includes(id);
      const answered = frame.answeredBy === id;
      toggleClass(card.g, 'is-active', active);
      toggleClass(card.g, 'is-done', done && !active);
      setAttr(card.focus, 'opacity', active ? 1 : 0);
      if (card.aa) setAttr(card.aa, 'opacity', answered ? 1 : 0);
    }

    const counter = frame.counter;
    const card = refs.cards.local;
    if (card && card.old && card.new) {
      const roll = counter.old === counter.new ? 0 : counter.roll;
      const oldY = counter.old === counter.new ? -6 : 18 - 24 * roll;
      const newY = counter.old === counter.new ? 18 : 42 - 24 * roll;
      setText(card.old, counter.old);
      setText(card.new, counter.new);
      setAttr(card.old, 'y', oldY.toFixed(2));
      setAttr(card.new, 'y', newY.toFixed(2));
    }
  }

  function updateBridge(frame) {
    const node = D.TREE_NODES[frame.bridge.match];
    setAttr(refs.bridge.g, 'transform', `translate(600 ${node.y})`);
    setAttr(refs.bridge.g, 'opacity', frame.bridge.alpha.toFixed(3));
    setText(refs.bridge.text, frame.bridge.text);
    const bridgeWidth = Math.max(64, Math.min(116, [...(frame.bridge.text || '')].length * 8.8 + 22));
    setAttr(refs.bridge.bg, 'x', -bridgeWidth / 2);
    setAttr(refs.bridge.bg, 'width', bridgeWidth);
  }

  function updateTag(frame) {
    const tag = frame.tag;
    if (!tag || !tag.text || tag.alpha <= 0.001) {
      setAttr(refs.tag.g, 'opacity', 0);
      return;
    }
    const card = D.SERVERS[tag.at];
    const x = card ? card.x : D.SERVERS.local.x;
    const below = tag.at === 'authy';
    const y = card
      ? card.y + (below ? 1 : -1) * (card.h / 2 + 12)
      : D.SERVERS.local.y - D.SERVERS.local.h / 2 - 12;
    setAttr(refs.tag.g, 'transform', `translate(${x} ${y})`);
    setAttr(refs.tag.g, 'opacity', tag.alpha.toFixed(3));
    setText(refs.tag.text, tag.text);
    const tagWidth = Math.max(52, Math.min(116, [...tag.text].length * 9.2 + 22));
    setAttr(refs.tag.bg, 'x', -tagWidth / 2);
    setAttr(refs.tag.bg, 'width', tagWidth);
  }

  function updateResult(frame) {
    if (frame.result.alpha <= 0.001) {
      setAttr(refs.result.g, 'opacity', 0);
      return;
    }
    setAttr(refs.result.g, 'opacity', frame.result.alpha.toFixed(3));
    setAttr(refs.result.g, 'transform', 'translate(865 548)');
    setText(refs.result.text, `A ${frame.result.text}`);
  }

  function updatePulse(frame) {
    const pulse = frame.pulse;
    if (pulse.alpha <= 0.001) {
      setAttr(refs.pulse, 'opacity', 0);
      return;
    }
    setAttr(refs.pulse, 'cx', pulse.point[0].toFixed(2));
    setAttr(refs.pulse, 'cy', pulse.point[1].toFixed(2));
    setAttr(refs.pulse, 'r', (6 + 14 * pulse.k).toFixed(2));
    setAttr(refs.pulse, 'stroke', kindColor(pulse.kind));
    setAttr(refs.pulse, 'opacity', pulse.alpha.toFixed(3));
  }

  function updateFlags(message) {
    if (!message) return;
    const key = `${message.label}|${message.qr}|${message.rd}|${message.aa}|${message.an}|${message.ns}|${message.ar}|${message.tone}`;
    if (key === lastMessageKey) return;
    lastMessageKey = key;
    const tone = $('flag-tone');
    tone.textContent = message.label;
    tone.className = `flag tone tone-${message.tone}`;
    setText($('flag-qr'), message.qr);
    setText($('flag-rd'), message.rd);
    setText($('flag-aa'), message.aa);
    setText($('flag-an'), message.an);
    setText($('flag-ns'), message.ns);
    setText($('flag-ar'), message.ar);
  }

  function updateStepUI(step, info) {
    setText($('step-no'), pad(info.index + 1));
    setText($('phase'), info.complete ? '完成' : step.phase);
    setText($('caption'), step.caption);
    setText($('narr-index'), pad(info.index + 1));
    const buttons = $('step-track').children;
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      if (i === info.index) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
      toggleClass(button, 'is-done', i < info.index || (info.complete && i < buttons.length - 1));
    }
    ensureStepVisible(info.index);
  }

  function ensureStepVisible(index) {
    const track = $('step-track');
    const button = track.children[index];
    if (!button) return;
    const trackRect = track.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    if (buttonRect.left < trackRect.left) {
      track.scrollLeft -= trackRect.left - buttonRect.left + 12;
    } else if (buttonRect.right > trackRect.right) {
      track.scrollLeft += buttonRect.right - trackRect.right + 12;
    }
  }

  function updateTransport(time, total, info) {
    const prev = $('prev');
    const next = $('next');
    const play = $('play');
    const label = $('play-label');
    const icon = $('play-icon');
    prev.disabled = time <= 0.001;
    next.disabled = time >= total - 0.001;
    let nextLabel = '播放';
    let nextIcon = '▶';
    if (state.playing) {
      nextLabel = '暂停';
      nextIcon = '❚❚';
    } else if (time >= total - 0.001) {
      nextLabel = '重播';
      nextIcon = '↺';
    }
    setText(label, nextLabel);
    setText(icon, nextIcon);
    play.setAttribute('aria-label', nextLabel);
  }

  function updateProgress(time, total) {
    const progress = $('progress');
    const ratio = total > 0 ? time / total : 0;
    if (progress.max !== String(total)) progress.max = String(total);
    progress.value = String(time);
    progress.style.setProperty('--p', ratio.toFixed(5));
    setText($('time-readout'), `${time.toFixed(1)} / ${total.toFixed(1)} s`);
  }

  function render(time) {
    const total = duration();
    const t = clamp(Number(time) || 0, 0, total);
    state.time = t;
    const info = C.sample(sequence, t, state.reduced);
    const step = sequence.steps[info.index];
    const frame = C.frame(step, info.progress);

    if (info.index !== lastIndex || info.complete !== lastComplete) {
      lastIndex = info.index;
      lastComplete = info.complete;
      updateStepUI(step, info);
    }
    if (frame.match !== lastMatch) {
      lastMatch = frame.match;
      setText($('match-line'), `匹配 · ${D.MATCH_LABELS[frame.match]}`);
    }

    updatePacket(frame);
    updateTrail(frame);
    updateDoneRoutes(frame);
    updateTree(frame, step);
    updateCards(frame);
    updateBridge(frame);
    updateTag(frame);
    updateResult(frame);
    updatePulse(frame);
    updateFlags(frame.message);
    updateProgress(t, total);
    updateTransport(t, total, info);
    writeHash(false);
  }

  /* ── 播放控制 ─────────────────────────────────────── */
  function setPlaying(value) {
    state.playing = Boolean(value);
    document.body.dataset.playing = String(state.playing);
    updateTransport(state.time, duration(), currentSample());
  }

  function buildTimeline() {
    if (timeline) {
      timeline.kill();
      timeline = null;
    }
    if (!window.gsap) return;
    const total = duration();
    const start = clamp(state.time, 0, total);
    timeline = gsap.timeline({
      paused: true,
      onUpdate() {
        render(timeline.time());
      },
      onComplete() {
        render(duration());
        setPlaying(false);
        writeHash(true);
      }
    });
    timeline.to({}, { duration: total, ease: 'none' });
    timeline.timeScale(state.speed);
    timeline.time(start, true);
  }

  function pause(write = true) {
    if (timeline) timeline.pause();
    setPlaying(false);
    if (write) writeHash(true);
  }

  function seek(time, options = {}) {
    const autoPause = options.pause !== false;
    if (autoPause && state.playing) pause(false);
    const total = duration();
    state.time = clamp(Number(time) || 0, 0, total);
    if (timeline) timeline.time(state.time, true);
    render(state.time);
    setPlaying(false);
    if (options.write !== false) writeHash(true);
  }

  function togglePlay() {
    if (!timeline) return;
    if (state.playing) {
      pause();
      return;
    }
    if (state.time >= duration() - 0.001) {
      state.time = 0;
      timeline.time(0, true);
      render(0);
    } else {
      timeline.time(state.time, true);
    }
    timeline.play();
    setPlaying(true);
  }

  function stepBy(direction) {
    pause(false);
    const info = currentSample();
    const total = duration();
    let target;
    if (direction > 0) {
      target = stepEnd(info.index + 1);
      if (state.time >= target - 1e-4) target = stepEnd(info.index + 2);
    } else {
      target = info.index > 0 ? stepEnd(info.index) : 0;
    }
    seek(clamp(target, 0, total));
  }

  function setReduced(value, fromUser) {
    const info = currentSample();
    const index = info.index;
    const wasPlaying = state.playing;
    pause(false);
    state.reduced = Boolean(value);
    if (fromUser) motionOverride = true;
    document.body.dataset.reduced = String(state.reduced);
    $('reduce-motion').checked = state.reduced;
    state.time = index >= sequence.steps.length - 1
      ? duration()
      : stepEnd(index + 1);
    state.time = clamp(state.time, 0, duration());
    buildTimeline();
    render(state.time);
    setPlaying(false);
    writeHash(true);
    if (wasPlaying && state.time < duration()) togglePlay();
  }

  function applyConfig(next) {
    const zone = next.zone || state.zone;
    const mode = next.mode || state.mode;
    const target = next.target || state.target;
    if (zone === state.zone && mode === state.mode && target === state.target) return;

    pause(false);
    const zoneChanged = zone !== state.zone;
    const modeChanged = mode !== state.mode;
    const targetChanged = target !== state.target;
    state.zone = zone;
    state.mode = mode;
    state.target = target;
    sequence = M.buildScenario(zone, mode, target);
    state.time = 0;
    lastIndex = -1;
    lastComplete = false;
    lastMatch = '';
    lastMessageKey = '';

    syncUI();
    const animate = !state.reduced;
    if (zoneChanged) setZoneVisual(zone, animate);
    if (modeChanged) setModeVisual(mode, animate);
    if (zoneChanged && !modeChanged) updateRouteVisibility(animate);
    if (targetChanged) setTargetVisual(target, animate, true);
    else if (zoneChanged) setTargetVisual(target, false, false);
    buildTimeline();
    render(0);
    setPlaying(false);
    writeHash(true);
  }

  function writeHash(force) {
    if (!force && performance.now() - lastWrite < 350) return;
    lastWrite = performance.now();
    const params = new URLSearchParams({
      zone: state.zone,
      mode: state.mode,
      target: state.target,
      t: state.time.toFixed(3),
      speed: String(state.speed),
      motion: state.reduced ? 'reduced' : 'full'
    });
    try {
      history.replaceState(null, '', `#${params}`);
    } catch (error) {
      /* file:// 可能限制 history；控件仍可用。 */
    }
  }

  function readHash() {
    const zone = hash.get('zone');
    const mode = hash.get('mode');
    const target = hash.get('target');
    const speed = Number(hash.get('speed'));
    const motion = hash.get('motion');
    if (M.ZONES.includes(zone)) state.zone = zone;
    if (M.MODES.includes(mode)) state.mode = mode;
    if (M.TARGETS.includes(target)) state.target = target;
    if ([0.5, 1, 1.5, 2].includes(speed)) state.speed = speed;
    if (motion === 'reduced' || motion === 'full') {
      state.reduced = motion === 'reduced';
      motionOverride = true;
    } else {
      state.reduced = media.matches;
    }
    return Number(hash.get('t'));
  }

  /* ── 事件绑定 ─────────────────────────────────────── */
  function bindEvents() {
    document.querySelectorAll('[data-zone]').forEach(button => {
      button.addEventListener('click', () => applyConfig({ zone: button.dataset.zone }));
    });
    document.querySelectorAll('[data-mode]').forEach(button => {
      button.addEventListener('click', () => applyConfig({ mode: button.dataset.mode }));
    });
    document.querySelectorAll('[data-target]').forEach(button => {
      button.addEventListener('click', () => applyConfig({ target: button.dataset.target }));
    });

    $('play').addEventListener('click', togglePlay);
    $('prev').addEventListener('click', () => stepBy(-1));
    $('next').addEventListener('click', () => stepBy(1));
    $('reset').addEventListener('click', () => seek(0));

    $('progress').addEventListener('input', event => {
      seek(Number(event.target.value), { write: false });
    });
    $('progress').addEventListener('change', () => writeHash(true));

    $('speed').addEventListener('change', event => {
      state.speed = Number(event.target.value);
      if (timeline) timeline.timeScale(state.speed);
      writeHash(true);
    });

    $('reduce-motion').addEventListener('change', event => {
      setReduced(event.target.checked, true);
    });

    media.addEventListener('change', event => {
      if (!motionOverride) setReduced(event.matches, false);
    });

    document.addEventListener('keydown', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest('input, select, textarea, button, a, [contenteditable], [tabindex]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        stepBy(-1);
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        stepBy(1);
      } else if (event.code === 'Home') {
        event.preventDefault();
        seek(0);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) pause();
    });
    window.addEventListener('pagehide', () => {
      pause(false);
      if (timeline) timeline.kill();
      killTweens(zoneTweens);
      killTweens(routeTweens);
      if (targetTween) targetTween.kill();
    });
  }

  function init() {
    readColors();
    const initialTime = readHash();
    sequence = M.buildScenario(state.zone, state.mode, state.target);
    state.time = clamp(Number.isFinite(initialTime) ? initialTime : 0, 0, duration());
    document.body.dataset.reduced = String(state.reduced);
    $('reduce-motion').checked = state.reduced;

    buildStage();
    syncUI();
    setZoneVisual(state.zone, false);
    setModeVisual(state.mode, false);
    setTargetVisual(state.target, false);
    buildTimeline();
    render(state.time);
    setPlaying(false);
    bindEvents();

    if (!window.gsap) {
      $('play').disabled = true;
      $('engine-notice').hidden = false;
    }
    writeHash(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
