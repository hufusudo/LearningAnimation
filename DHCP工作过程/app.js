/**
 * DHCP DORA 四步报文的地址演示。
 * t 只推进时间；render(t) 每一帧由 t 直接算出信封位置、两端主机状态、浮标与对照表高亮，
 * 不依赖历史动画。报文字段、变化判定与主机状态全部来自 model.js，界面只负责把它们画出来。
 */
(function () {
  'use strict';

  const M = window.DhcpModel;
  const TICK = 0.25;                       // 1t 在 1× 速度下为 0.25 s
  const OP_LEN = 20;                       // 每个报文占 20t，约 5 秒
  const COUNT = 4;                         // DISCOVER、OFFER、REQUEST、ACK
  const T = OP_LEN * COUNT;                // 全程 80t
  const BOUNDS = [0, 20, 40, 60, 80];      // 上一步／下一步停靠的报文边界
  const EPS = 1e-6;
  const NS = 'http://www.w3.org/2000/svg';
  const STEP_SEC = 0.9;                    // 减少动效时，每个报文停留的秒数（1× 速度）
  const LINK_DELAY = 300;                  // 地址栏写回的防抖时间（毫秒）
  const LIFE = 8;                          // 普通浮标的显示时长（t）
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  const SEND_AT = 0.06;                    // 信封开始移动的报文内进度
  const RECV_AT = 0.82;                    // 信封到达接收端的报文内进度
  const LEFT_X = 270;                      // 信封左端靠近服务器时的 x
  const RIGHT_X = 510;                     // 信封左端靠近客户端时的 x
  const ENV_Y = 53;
  const WIRE_Y = 141;
  const CARD = {
    server: { x: 40, y: 56, w: 210, h: 170 },
    client: { x: 850, y: 56, w: 210, h: 170 }
  };
  const ENV_ROWS = [
    { key: 'ethSrc', label: '源 MAC' },
    { key: 'ethDst', label: '目的 MAC' },
    { key: 'ipSrc', label: '源 IP' },
    { key: 'ipDst', label: '目的 IP' },
    { key: 'yiaddr', label: 'yiaddr' }
  ];
  const TABLE_ROWS = [
    { key: 'direction', label: '方向' },
    { key: 'ethSrc', label: '源 MAC（以太网）' },
    { key: 'ethDst', label: '目的 MAC（以太网）' },
    { key: 'ipSrc', label: '源 IP' },
    { key: 'ipDst', label: '目的 IP' },
    { key: 'yiaddr', label: 'yiaddr（载荷）' },
    { key: 'optionAddresses', label: '选项中的地址' }
  ];
  const DELTA_CLASSES = ['is-change', 'is-same', 'is-bcast'];
  const PHASE = ['① DISCOVER · 发现', '② OFFER · 提供', '③ REQUEST · 请求', '④ ACK · 确认'];
  const CAPTION = {
    init: '客户端没有 IP，也不知道服务器在哪，只能用源地址 0.0.0.0 向全网广播。',
    discover: '源 IP 只能填 0.0.0.0；目的 IP 与目的 MAC 都是广播，服务器才能收到。',
    offer: '服务器回复：源 IP、源 MAC 换成服务器；yiaddr 带着待分配的 192.168.1.100。',
    offerUnicast: '单播回复：目的 IP 改为 192.168.1.100，目的 MAC 改为客户端网卡的 MAC。',
    request: '客户端再次广播：源 IP 回到 0.0.0.0，用选项 50、54 写明选中的报价。',
    ack: '服务器确认：源 IP、源 MAC 又换回服务器；客户端收到后地址才真正生效。',
    ackUnicast: '单播确认：目的 IP 与目的 MAC 指向客户端；源地址仍是服务器。',
    end: '租约生效：客户端 IP 变为 192.168.1.100；网卡 MAC 从头到尾没有变化。'
  };
  const FLAG_NOTE = {
    on: 'B=1：服务器用广播回复 OFFER 与 ACK，目的地址始终是广播。客户端还没有地址，只能这样收到。',
    off: 'B=0：服务器单播回复 OFFER 与 ACK，目的 IP 为 192.168.1.100，目的 MAC 为客户端网卡。只有客户端能接收未配置地址前的单播时才宜设为 0。'
  };

  // 两端主机的状态切换时刻：发送方在发出报文时更新，接收方在报文到达时更新
  const HOST_EVENTS = [
    { k: 0, p: SEND_AT, host: 'client', state: 'discover' },
    { k: 0, p: RECV_AT, host: 'server', state: 'discover' },
    { k: 1, p: SEND_AT, host: 'server', state: 'offer' },
    { k: 1, p: RECV_AT, host: 'client', state: 'offer' },
    { k: 2, p: SEND_AT, host: 'client', state: 'request' },
    { k: 2, p: RECV_AT, host: 'server', state: 'request' },
    { k: 3, p: SEND_AT, host: 'server', state: 'ack' },
    { k: 3, p: RECV_AT, host: 'client', state: 'ack' }
  ];

  // 报文内的浮标：at 为报文内进度，row 决定上（0）下（1）两行，anchor 决定跟随信封还是客户端卡片
  const TAGS = [
    [
      { at: 0.10, row: 0, text: '源 IP 未分配', tone: 'note' },
      { at: 0.34, row: 1, text: '目的：全网广播', tone: 'quiet' }
    ],
    [
      { at: 0.10, row: 0, text: '源地址换成服务器', tone: 'key' },
      { at: 0.34, row: 1, text: 'yiaddr 给出地址', tone: 'note', unicastText: '单播：目的改为客户端' }
    ],
    [
      { at: 0.10, row: 0, text: '源 IP 回到 0.0.0.0', tone: 'note' },
      { at: 0.34, row: 1, text: '选项 50 = .100', tone: 'note' },
      { at: 0.56, row: 0, text: '选项 54 = .1', tone: 'quiet' }
    ],
    [
      { at: 0.10, row: 0, text: '源地址换回服务器', tone: 'key' },
      { at: 0.34, row: 1, text: '租期 8 小时', tone: 'quiet', unicastText: '单播：目的指向客户端' },
      { at: 0.86, row: 0, anchor: 'client', text: '客户端 IP 生效', tone: 'key', persist: true }
    ]
  ];

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lin = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const ramp = (p, a, b) => {
    const s = lin(p, a, b);
    return s * s * (3 - 2 * s);
  };
  const eventT = (k, p) => (k + p) * OP_LEN;
  const setText = (node, value) => {
    const s = String(value);
    if (node.textContent !== s) node.textContent = s;
  };
  const setAttr = (node, name, value) => {
    const s = String(value);
    if (node.getAttribute(name) !== s) node.setAttribute(name, s);
  };
  const setClass = (node, cls, on) => {
    if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
  };
  const setDeltaClass = (node, cls) => {
    for (const c of DELTA_CLASSES) setClass(node, c, c === cls);
  };
  const svgEl = (tag, attrs, parent) => {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs || {})) node.setAttribute(name, String(value));
    if (parent) parent.appendChild(node);
    return node;
  };
  const textWidth = (text) => [...text].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 12 : 7), 0);
  const ipLine = (ip) => (ip === M.UNSPECIFIED_IP ? `IP ${ip}` : `IP ${ip} / 24`);

  const els = {
    svg: $('sand'),
    stage: document.querySelector('.stage'),
    clock: $('clock'),
    phase: $('phase'),
    caption: $('caption'),
    reset: $('reset'),
    previous: $('previous'),
    play: $('play'),
    playSymbol: $('play-symbol'),
    playLabel: $('play-label'),
    next: $('next'),
    progress: $('progress'),
    progressCaption: $('progress-caption'),
    speed: $('speed'),
    motion: $('reduce-motion'),
    table: $('addr-table'),
    head: $('addr-head'),
    body: $('addr-body'),
    flagNote: $('flag-note'),
    notice: $('dependency-notice')
  };

  const state = {
    t: 0,
    playing: false,
    speed: 1,
    reduce: false,
    flag: true,            // 广播标志 B：true 为 1（广播回复）
    ex: null,              // 当前的报文交换，随广播标志重算
    refs: null,            // SVG 节点引用
    envK: -2,              // 信封当前显示的报文序号（用于判断是否需要重写文字）
    envFlag: null,
    envX: null,            // 信封当前的 x，供跟随的浮标使用
    heads: [],
    cellRows: [],
    matrixK: null,
    matrixFlag: null,
    tl: null,
    stepper: null,
    glide: null,
    scrubbing: false,
    linkTimer: 0,
    linkReady: false
  };

  // ───── 节点与浮标 ─────

  function locate(t) {
    if (t <= EPS) return { k: -1, p: 0 };
    const k = Math.min(COUNT - 1, Math.ceil(t / OP_LEN) - 1);
    return { k, p: clamp((t - k * OP_LEN) / OP_LEN, 0, 1) };
  }

  // 两端主机在时刻 t 的状态键：取最近一次已经发生的状态切换
  function hostAt(t, who) {
    let key = 'init';
    let best = -Infinity;
    for (const ev of HOST_EVENTS) {
      const at = eventT(ev.k, ev.p);
      if (ev.host === who && at <= t + EPS && at >= best) {
        best = at;
        key = ev.state;
      }
    }
    return key;
  }

  function buildCard(who) {
    const c = CARD[who];
    const g = svgEl('g', { class: `host host-${who}` }, els.svg);
    svgEl('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 14, class: 'host-body' }, g);
    const x = c.x + 18;
    svgEl('text', { x, y: c.y + 30, class: 'host-title' }, g).textContent = who === 'client' ? '客户端' : 'DHCP 服务器';
    svgEl('text', { x, y: c.y + 50, class: 'host-sub' }, g).textContent = who === 'client' ? 'UDP 68 · DHCP 客户端' : 'UDP 67 · DHCP 服务端';
    const ip = svgEl('text', { x, y: c.y + 78, class: 'host-ip' }, g);
    svgEl('text', { x, y: c.y + 98, class: 'host-mac' }, g).textContent = `MAC ${who === 'client' ? M.DEFAULTS.clientMac : M.DEFAULTS.serverMac}`;
    const stTitle = svgEl('text', { x, y: c.y + 128, class: 'host-state' }, g);
    const stDetail = svgEl('text', { x, y: c.y + 147, class: 'host-detail' }, g);
    return { g, ip, stTitle, stDetail };
  }

  function buildEnvelope() {
    const g = svgEl('g', { class: 'envelope', opacity: 0 }, els.svg);
    svgEl('rect', { x: 0, y: 0, width: 330, height: 176, rx: 12, class: 'env-body' }, g);
    const head = svgEl('text', { x: 16, y: 26, class: 'env-head' }, g);
    const headTag = svgEl('text', { x: 314, y: 26, 'text-anchor': 'end', class: 'env-tag' }, g);
    const rows = ENV_ROWS.map((row, i) => {
      const y = 58 + i * 22;
      svgEl('text', { x: 16, y, class: 'env-label' }, g).textContent = row.label;
      const value = svgEl('text', { x: 92, y, class: 'env-value' }, g);
      const delta = svgEl('text', { x: 314, y, 'text-anchor': 'end', class: 'env-delta' }, g);
      return { key: row.key, value, delta };
    });
    const foot = svgEl('text', { x: 16, y: 162, class: 'env-foot' }, g);
    return { g, head, headTag, rows, foot };
  }

  function buildTags() {
    const layer = svgEl('g', { class: 'tags', 'aria-hidden': 'true' }, els.svg);
    const list = [];
    TAGS.forEach((perPacket, k) => perPacket.forEach((tag) => {
      const el = svgEl('g', { class: `tag tone-${tag.tone}` }, layer);
      const bg = svgEl('rect', { x: 0, y: 0, width: 80, height: 22, rx: 11, class: 'tag-bg' }, el);
      const label = svgEl('text', { x: 10, y: 11, class: 'tag-text' }, el);
      list.push({ k, tag, el, bg, label, text: null, te: eventT(k, tag.at) });
    }));
    return list;
  }

  function buildStage() {
    const svg = els.svg;
    svgEl('rect', { x: 236, y: 40, width: 628, height: 206, rx: 14, class: 'domain' }, svg);
    svgEl('text', { x: 550, y: 270, 'text-anchor': 'middle', class: 'domain-label' }, svg).textContent = '同一以太网段 · 广播域';
    const wire = svgEl('line', { x1: 250, y1: WIRE_Y, x2: 850, y2: WIRE_Y, class: 'wire' }, svg);
    const cards = { server: buildCard('server'), client: buildCard('client') };
    const env = buildEnvelope();
    const tags = buildTags();
    state.refs = { wire, cards, env, tags };
  }

  // ───── 对照表 ─────

  function buildMatrix() {
    const packets = state.ex.packets;
    els.head.textContent = '';
    els.body.textContent = '';
    const corner = document.createElement('th');
    corner.scope = 'col';
    corner.textContent = '字段';
    els.head.appendChild(corner);
    state.heads = packets.map((pkt, k) => {
      const th = document.createElement('th');
      th.scope = 'col';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'col-jump';
      btn.dataset.jump = String(eventT(k + 1, 0));
      const no = document.createElement('span');
      no.className = 'col-no';
      no.textContent = String(k + 1);
      btn.appendChild(no);
      btn.appendChild(document.createTextNode(` ${pkt.type.replace('DHCP ', '')}`));
      th.appendChild(btn);
      els.head.appendChild(th);
      return th;
    });
    state.cellRows = TABLE_ROWS.map((row) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = row.label;
      tr.appendChild(th);
      const cells = packets.map((pkt) => {
        const td = document.createElement('td');
        td.textContent = pkt.rows[row.key];
        tr.appendChild(td);
        return td;
      });
      els.body.appendChild(tr);
      return { cells, changed: packets.map((pkt) => Boolean(pkt.changes && pkt.changes[row.key])) };
    });
    state.matrixK = null;
    state.matrixFlag = null;
  }

  function updateMatrix(k) {
    if (state.matrixK === k && state.matrixFlag === state.flag) return;
    state.matrixK = k;
    state.matrixFlag = state.flag;
    state.heads.forEach((th, c) => {
      setClass(th, 'is-current', c === k);
      setClass(th, 'is-future', c > k);
    });
    state.cellRows.forEach((row) => row.cells.forEach((td, c) => {
      setClass(td, 'is-current', c === k);
      setClass(td, 'is-future', c > k);
      setClass(td, 'is-changed', c <= k && row.changed[c]);
    }));
  }

  // ───── 每帧渲染：只由 t 决定 ─────

  function populateEnvelope(k) {
    const env = state.refs.env;
    const pkt = state.ex.packets[k];
    setText(env.head, pkt.type);
    setText(env.headTag, `${pkt.rows.direction} · ${pkt.udp.src}→${pkt.udp.dst}`);
    ENV_ROWS.forEach((row, i) => {
      const cell = env.rows[i];
      setText(cell.value, pkt.rows[row.key]);
      const changed = k > 0 && Boolean(pkt.changes[row.key]);
      const broadcast = (row.key === 'ethDst' && pkt.rows.ethDst === M.BROADCAST_MAC)
        || (row.key === 'ipDst' && pkt.rows.ipDst === M.BROADCAST_IP);
      if (k === 0) {
        setText(cell.delta, '— 起点');
        setDeltaClass(cell.delta, 'is-same');
      } else if (changed) {
        setText(cell.delta, '▲ 变化');
        setDeltaClass(cell.delta, 'is-change');
      } else if (broadcast) {
        setText(cell.delta, '— 广播');
        setDeltaClass(cell.delta, 'is-bcast');
      } else {
        setText(cell.delta, '— 不变');
        setDeltaClass(cell.delta, 'is-same');
      }
    });
    setText(env.foot, pkt.footer);
    state.envK = k;
    state.envFlag = state.flag;
  }

  function renderEnvelope(k, p, staticHL) {
    const env = state.refs.env;
    if (k < 0) {
      setAttr(env.g, 'opacity', '0');
      state.envX = null;
      return;
    }
    if (state.envK !== k || state.envFlag !== state.flag) populateEnvelope(k);
    const pkt = state.ex.packets[k];
    const start = pkt.sender === 'client' ? RIGHT_X : LEFT_X;
    const end = pkt.sender === 'client' ? LEFT_X : RIGHT_X;
    // 减少动效时信封直接停在接收端；否则沿线路线性移动（不回弹）
    const x = staticHL ? end : start + (end - start) * lin(p, SEND_AT, RECV_AT);
    // 报文到达后停在接收端保持可见，直到下一个报文从发送端淡入
    const opacity = staticHL ? 1 : ramp(p, 0, 0.04);
    state.envX = x;
    setAttr(env.g, 'transform', `translate(${x.toFixed(2)} ${ENV_Y})`);
    setAttr(env.g, 'opacity', opacity.toFixed(3));
  }

  function renderCards(k, p, staticHL) {
    const cards = state.refs.cards;
    const pkt = k >= 0 ? state.ex.packets[k] : null;
    for (const who of ['client', 'server']) {
      const card = cards[who];
      setClass(card.g, 'is-send', Boolean(pkt) && !staticHL && pkt.sender === who && p < 0.2);
      setClass(card.g, 'is-hit', Boolean(pkt) && !staticHL && pkt.receiver === who && p >= RECV_AT);
    }
    const travelling = Boolean(pkt) && !staticHL && p >= SEND_AT && p <= RECV_AT;
    setClass(state.refs.wire, 'is-flow', travelling);
    if (travelling) {
      const u = lin(p, SEND_AT, RECV_AT);
      setAttr(state.refs.wire, 'stroke-dashoffset', (pkt.sender === 'client' ? u * 120 : -u * 120).toFixed(1));
    } else {
      setAttr(state.refs.wire, 'stroke-dashoffset', '0');
    }
  }

  function renderHosts(t) {
    for (const who of ['client', 'server']) {
      const st = state.ex.states[who][hostAt(t, who)];
      const card = state.refs.cards[who];
      setText(card.ip, who === 'client' ? ipLine(st.ip) : `IP ${state.ex.params.serverIp}`);
      setText(card.stTitle, st.title);
      setText(card.stDetail, st.detail);
    }
  }

  function renderTags(t, k) {
    for (const item of state.refs.tags) {
      const { tag } = item;
      const text = !state.flag && tag.unicastText ? tag.unicastText : tag.text;
      if (item.text !== text) {
        item.text = text;
        setText(item.label, text);
        setAttr(item.bg, 'width', textWidth(text) + 20);
      }
      const persist = Boolean(tag.persist);
      const age = t - item.te;
      const due = persist ? age >= 0 : (item.k === k && age >= 0 && age <= LIFE);
      let opacity = 0;
      let rise = 0;
      if (due) {
        if (persist) {
          opacity = Math.min(1, age / 0.25);
        } else {
          opacity = Math.min(1, age / 0.25) * Math.min(1, (LIFE - age) / 0.7);
          rise = 6 * (age / LIFE);
        }
      }
      const x = tag.anchor === 'client' ? CARD.client.x + 6 : (state.envX ?? 0) + 12;
      const y = (tag.row === 0 ? 6 : 28) - rise;
      setAttr(item.el, 'opacity', opacity.toFixed(3));
      setAttr(item.el, 'transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    }
  }

  function captionFor(t, k) {
    if (t >= T - EPS) return CAPTION.end;
    if (k < 0) return CAPTION.init;
    const unicast = !state.flag;
    if (unicast && k === 1) return CAPTION.offerUnicast;
    if (unicast && k === 3) return CAPTION.ackUnicast;
    return CAPTION[['discover', 'offer', 'request', 'ack'][k]];
  }

  function render(t) {
    const time = clamp(t, 0, T);
    state.t = time;
    const { k, p: raw } = locate(time);
    const staticHL = state.reduce && k >= 0;   // 减少动效：本报文的结果直接以静态方式呈现
    const p = staticHL ? 1 : raw;
    renderEnvelope(k, p, staticHL);
    renderCards(k, p, staticHL);
    renderHosts(time);
    renderTags(time, k);
    updateMatrix(k);
    setText(els.clock, Math.floor(time + EPS));
    setText(els.phase, time >= T - EPS ? '④ ACK · 租约生效' : (k < 0 ? '初始状态' : PHASE[k]));
    setText(els.caption, captionFor(time, k));
    updateControls();
  }

  // ───── 控件与时钟 ─────

  function updateControls() {
    const t = state.t;
    const playing = state.playing;
    els.stage.classList.toggle('is-running', playing);
    els.previous.disabled = t <= EPS;
    els.next.disabled = t >= T - EPS;
    setText(els.playLabel, playing ? '暂停' : (t >= T - EPS ? '再播放' : '播放'));
    setText(els.playSymbol, playing ? 'Ⅱ' : '▶');
    els.play.dataset.running = String(playing);
    els.play.disabled = !state.tl;
    if (!state.scrubbing) els.progress.value = t.toFixed(2);
    setText(els.progressCaption, `t ${Math.floor(t + EPS)} / ${T}`);
  }

  function cancelGlide() {
    if (state.glide) {
      state.glide.kill();
      state.glide = null;
    }
  }

  function stopStepper() {
    if (state.stepper) {
      state.stepper.kill();
      state.stepper = null;
    }
  }

  function syncClock() {
    if (state.tl) state.tl.time(state.t * TICK);
  }

  // 直接跳到某一时刻（拖动、复位、对照表点击后使用）
  function seek(t) {
    cancelGlide();
    const target = clamp(t, 0, T);
    if (state.tl) {
      state.tl.pause();
      state.tl.time(target * TICK);
    }
    render(target);
    syncLink(false);
  }

  // 单步：平滑滑到下一个报文边界，便于看清每个报文的地址变化
  function stepTo(target) {
    cancelGlide();
    pause();
    const dest = clamp(target, 0, T);
    const dist = Math.abs(dest - state.t);
    if (!window.gsap || state.reduce || dist < EPS) {
      seek(dest);
      return;
    }
    const glide = { v: state.t };
    state.glide = window.gsap.to(glide, {
      v: dest,
      duration: clamp(dist * 0.12, 0.25, 0.8),
      ease: 'power1.inOut',
      onUpdate: () => render(glide.v),
      onComplete: () => {
        state.glide = null;
        render(dest);
        syncClock();
        syncLink(true);
      }
    });
  }

  function play() {
    if (!state.tl) return;
    cancelGlide();
    if (state.t >= T - EPS) seek(0);
    state.playing = true;
    if (state.reduce) {
      scheduleStep();
    } else {
      syncClock();
      state.tl.play();
    }
    updateControls();
  }

  function pause() {
    if (!state.tl) return;
    state.playing = false;
    stopStepper();
    state.tl.pause();
    updateControls();
    syncLink(true);
  }

  function finishPlayback() {
    state.playing = false;
    stopStepper();
    updateControls();
    syncLink(true);
  }

  // 减少动效：不做补间，每个报文边界直接跳过去，停留一小段时间再跳下一个
  function scheduleStep() {
    state.stepper = window.gsap.delayedCall(STEP_SEC / state.speed, advanceStep);
  }

  function advanceStep() {
    state.stepper = null;
    if (!state.playing) return;
    const target = nextBoundary();
    seek(target);
    if (target >= T - EPS) finishPlayback();
    else scheduleStep();
  }

  // 直接定位到某一时刻并暂停（对照表列标题）
  function jumpTo(t) {
    pause();
    seek(t);
  }

  // 减少动效跟随系统设置，页面上的开关可以改；正在播放时换一种方式从当前时刻续播
  function applyMotion(reduce) {
    state.reduce = reduce;
    els.motion.checked = reduce;
    document.body.dataset.motion = reduce ? 'reduce' : 'full';
  }

  function setMotion(reduce) {
    const wasPlaying = state.playing;
    pause();
    applyMotion(reduce);
    render(state.t);
    if (wasPlaying) play();
  }

  // 广播标志 B：重算报文与对照表，保留当前时刻并暂停，便于对比改动前后的同一时刻
  function setFlag(on) {
    const wasPlaying = state.playing;
    pause();
    state.flag = on;
    state.ex = M.buildExchange({ broadcastFlag: on });
    buildMatrix();
    setText(els.flagNote, FLAG_NOTE[on ? 'on' : 'off']);
    render(state.t);
    syncLink(true);
    if (wasPlaying) play();
  }

  function togglePlay() {
    if (state.playing) pause();
    else play();
  }

  function nextBoundary() {
    return BOUNDS.find((x) => x > state.t + EPS) ?? T;
  }

  function prevBoundary() {
    const earlier = BOUNDS.filter((x) => x < state.t - EPS);
    return earlier.length ? earlier[earlier.length - 1] : 0;
  }

  function killClock() {
    cancelGlide();
    stopStepper();
    state.playing = false;
    if (state.tl) {
      state.tl.kill();
      state.tl = null;
    }
  }

  function buildClock() {
    killClock();
    if (!window.gsap) {
      els.notice.hidden = false;
      return;
    }
    els.notice.hidden = true;
    const tl = window.gsap.timeline({
      paused: true,
      onUpdate: () => render(tl.time() / TICK),
      onComplete: finishPlayback
    });
    tl.to({}, { duration: T * TICK, ease: 'none' });
    tl.timeScale(state.speed);
    state.tl = tl;
  }

  // ───── 地址栏状态：#t=…&b=…，只用 replaceState，不增加历史记录 ─────

  function readLink() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const t = Number(params.get('t'));
    return {
      t: params.has('t') && Number.isFinite(t) ? clamp(t, 0, T) : 0,
      flag: params.get('b') !== '0'
    };
  }

  function writeLink() {
    state.linkTimer = 0;
    try {
      history.replaceState(null, '', `#t=${Number(state.t.toFixed(2))}&b=${state.flag ? 1 : 0}`);
    } catch {
      // 某些本地文件环境不允许改写地址，演示照常可用
    }
  }

  // 暂停或停下时立即写回；拖动与逐步过程中合并为一次写入
  function syncLink(now) {
    if (!state.linkReady) return;
    clearTimeout(state.linkTimer);
    if (now) writeLink();
    else state.linkTimer = setTimeout(writeLink, LINK_DELAY);
  }

  // ───── 事件绑定 ─────

  function bindControls() {
    els.motion.addEventListener('change', () => setMotion(els.motion.checked));
    motionQuery.addEventListener('change', (event) => setMotion(event.matches));

    els.speed.addEventListener('change', () => {
      state.speed = Number(els.speed.value);
      if (state.tl) state.tl.timeScale(state.speed);
    });

    els.play.addEventListener('click', togglePlay);
    els.next.addEventListener('click', () => stepTo(nextBoundary()));
    els.previous.addEventListener('click', () => stepTo(prevBoundary()));
    els.reset.addEventListener('click', () => {
      pause();
      seek(0);
    });

    const scrub = els.progress;
    scrub.addEventListener('pointerdown', () => { state.scrubbing = true; pause(); });
    scrub.addEventListener('keydown', () => { state.scrubbing = true; pause(); });
    scrub.addEventListener('input', () => seek(Number(scrub.value)));
    scrub.addEventListener('change', () => { state.scrubbing = false; });
    scrub.addEventListener('pointerup', () => { state.scrubbing = false; });
    scrub.addEventListener('blur', () => { state.scrubbing = false; });

    els.table.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-jump]') : null;
      if (target) jumpTo(Number(target.dataset.jump));
    });

    document.querySelectorAll('input[name="flag"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) setFlag(input.value === '1');
      });
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, select, textarea, button, a')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      if (event.code === 'ArrowRight') { event.preventDefault(); stepTo(nextBoundary()); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); stepTo(prevBoundary()); }
      if (event.code === 'Home') { event.preventDefault(); pause(); seek(0); }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) pause();
    });
  }

  function init() {
    const link = readLink();
    state.speed = Number(els.speed.value);
    els.progress.max = String(T);
    state.flag = link.flag;
    document.querySelectorAll('input[name="flag"]').forEach((input) => {
      input.checked = (input.value === '1') === link.flag;
    });
    state.ex = M.buildExchange({ broadcastFlag: link.flag });
    setText(els.flagNote, FLAG_NOTE[link.flag ? 'on' : 'off']);
    applyMotion(motionQuery.matches);
    buildStage();
    buildMatrix();
    buildClock();
    bindControls();
    seek(link.t);
    state.linkReady = true;
  }

  init();
})();
