/* ══════════════════════════════════════════════════════════════
   浏览器访问网页全流程 · app.js
   Step 2：严格按《设计方案.md》第三章 5 张《动作时序规格表》落地

   硬约束（AGENT.md + 设计方案 §5.2）：
   · 禁 setTimeout / setInterval，一律 GSAP timeline
   · 每阶段一条子时间轴 getPhaseTimeline(i)，主控制器统一调度
   · Beat 间用相对偏移量衔接（<+= / <）
   · 每次状态切换前 killTweensOf 防竞态
   · duration 全部按 State.speed 缩放
   ══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  /* ── CDN 失败降级 ── */
  if (!window.gsap) {
    const b = document.getElementById("narrative-body");
    if (b) b.textContent = "动画引擎 GSAP 未能加载，页面已降级为静态图解（文字与布局完整可读）。";
    return;
  }

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ══════════ DOM 引用 ══════════ */
  const stage      = $(".stage");
  const svg        = $("#timeline-root");
  const floatLayer = $("#float-layer");
  const envSlot    = $("#envelope-slot");
  const netQueue   = $("#net-queue");
  const domPrev    = $("#dom-preview");
  const lanes      = $$(".lane");
  const parts      = {
    scheme:  $('.url-part[data-part="scheme"]'),
    host:    $('.url-part[data-part="host"]'),
    path:    $('.url-part[data-part="path"]'),
    query:   $('.url-part[data-part="query"]'),
    fragment:$('.url-part[data-part="fragment"]')
  };
  const ownerTags  = $$(".part-owner");
  const EL = {
    procUI: $("#proc-ui"), procNet: $("#proc-net"), procRender: $("#proc-render"),
    web: $("#node-webserver"), router: $("#node-router"), dns: $("#node-dns"),
    chipDNS: $("#chip-dns"), chipTCP: $("#chip-tcp"), chipHTTP: $("#chip-http"),
    arpCache: $("#node-arp"), arpCacheSub: $("#arp-cache-sub"),
    narrTitle: $("#narrative-title"), narrBody: $("#narrative-body"),
    narrStep: $("#narrative-step"), calloutBody: $("#callout-body"),
    summary: $("#proto-summary"), indicator: $("#phase-indicator"),
    btnPlay: $("#btn-play"), btnAuto: $("#btn-auto")
  };

  /* ══════════ 状态 ══════════ */
  const State = {
    phase: -1,
    speed: 1,
    playing: false,
    auto: false,
    tl: null,
    wires: [],
    floats: [],
    envelopes: []
  };
  /** 毫秒 → 秒（受速率缩放，AGENT.md §3.4） */
  const D = (ms) => ms / 1000 / State.speed;

  /**
   * 规格表锚点：把《动作时序规格表》中各 Beat 的绝对毫秒转为 timeline 绝对秒位置。
   * 全项目强制使用绝对锚点 + Beat 内微偏移（+0.05s 级），
   * 严禁依赖 ">" / "<" 相对定位——它们会向时间轴起点塌缩，
   * 导致实测时长腰斩、Beat 相对次序错乱。
   * 各阶段总时长（speed=1）应精确落在规格表估算值上。
   */
  const at = (ms, offset) => D(ms) + (offset || 0);

  /* ══════════ 几何工具 ══════════ */
  const SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  /** 元素中心（相对 stage 的像素坐标） */
  function stagePos(el, side) {
    const s = stage.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    let x = b.left + b.width / 2, y = b.top + b.height / 2;
    if (side === "right") x = b.right;
    else if (side === "left") x = b.left;
    return { x: x - s.left, y: y - s.top };
  }
  /** 元素中心（页面绝对坐标，供 float-layer 使用） */
  function pagePos(el, side) {
    const b = el.getBoundingClientRect();
    let x = b.left + b.width / 2, y = b.top + b.height / 2;
    if (side === "right") x = b.right;
    else if (side === "left") x = b.left;
    return { x: x + window.scrollX, y: y + window.scrollY };
  }

  /**
   * 斜线几何：单一函数产出，杜绝散落魔法数字（设计方案 §5.2）
   * 设计稿要求 45° 直斜线，但四条泳道内容均左对齐，
   * 真正的 45° 直���无法同时「不压节点」且「端点落在节点边缘」，
   * 故采用「S 形飞行弧线」：水平跨度随垂直距离增长（保 45° 观感），
   * 并按 slot 递增右移，使多条报文在时间轴上可区分先后。
   */
  function computeWire(fromEl, toEl, slot) {
    slot = slot || 0;
    const a = stagePos(fromEl, "right");
    const bLeft  = stagePos(toEl, "left");
    const bRight = stagePos(toEl, "right");
    const spanCap = svg.getBoundingClientRect().width * 0.42;

    let target, c2x;
    if (bLeft.x - a.x >= 18)       { target = bLeft;  c2x = bLeft.x - 30; }
    else if (a.x - bRight.x >= 18) { target = bRight; c2x = bRight.x + 30; }
    else                           { target = bLeft;  c2x = bLeft.x - 30; }

    const dy = Math.abs(target.y - a.y);
    const bulge = clamp(dy * 0.45 + 36 + slot * 22, 40, spanCap);
    const midY = (a.y + target.y) / 2;
    const c1 = { x: a.x + bulge, y: midY };
    const c2 = { x: c2x, y: midY };
    const d = "M " + a.x.toFixed(1) + " " + a.y.toFixed(1) +
              " C " + c1.x.toFixed(1) + " " + c1.y.toFixed(1) + ", " +
                       c2.x.toFixed(1) + " " + c2.y.toFixed(1) + ", " +
                       target.x.toFixed(1) + " " + target.y.toFixed(1);
    return { d: d, from: a, to: target, c1: c1, c2: c2 };
  }

  /* ══════════ 斜线（Wire） ══════════ */
  let wireSeq = 0;
  function makeWire(opts) {
    const geo = computeWire(opts.from, opts.to, opts.slot);
    const id = "w" + (++wireSeq);
    const path = svgEl("path", { class: "wire", d: geo.d, "data-kind": opts.kind, "data-wire-id": id });
    const head = svgEl("path", { class: "wire-head", d: "M 0,-4 L 9,0 L 0,4 Z", "data-kind": opts.kind, opacity: "0" });
    svg.appendChild(path);
    svg.appendChild(head);

    const w = {
      id: id, el: path, head: head,
      from: opts.from, to: opts.to, kind: opts.kind, slot: opts.slot || 0,
      len: 0, progress: 0
    };
    layoutWire(w);
    State.wires.push(w);
    return w;
  }
  function layoutWire(w) {
    const geo = computeWire(w.from, w.to, w.slot);
    w.el.setAttribute("d", geo.d);
    let len = 0;
    try { len = w.el.getTotalLength(); } catch (e) { len = 0; }
    w.len = len;
    w.el.setAttribute("stroke-dasharray", len);
    w.el.setAttribute("stroke-dashoffset", len * (1 - w.progress));
    // 光头定位
    const p = w.el.getPointAtLength(len * w.progress);
    w.head.setAttribute("transform", "translate(" + p.x.toFixed(1) + "," + p.y.toFixed(1) + ")");
  }
  /** 让报文沿斜线飞行：progress 0→1，onUpdate 实时重算 dashoffset 与光头 */
  function flyWire(tl, w, at, ms, ease) {
    const o = { p: 0 };
    tl.to(o, {
      p: 1, duration: D(ms), ease: ease || "power2.inOut",
      onUpdate: function () { w.progress = o.p; layoutWire(w); }
    }, at);
    return o;
  }
  /** 报文在斜线中点短暂驻留时的脉冲（spec 未要求，暂不启用） */
  function removeWire(w) {
    if (w.el.parentNode) w.el.parentNode.removeChild(w.el);
    if (w.head.parentNode) w.head.parentNode.removeChild(w.head);
  }

  /* ══════════ 报文信封 ══════════ */
  const ENV_MAX = 3;
  function pushEnvelope(text, dir) {
    const el = document.createElement("div");
    el.className = "envelope is-fresh";
    el.innerHTML = '<span class="envelope__dir' + (dir < 0 ? " is-down" : "") + '">' +
                   (dir < 0 ? "▼" : "▲") + '</span><span class="envelope__text"></span>';
    el.querySelector(".envelope__text").textContent = text;
    State.envelopes.push({ el: el });
    renderEnvelopes();
    return el;
  }
  function renderEnvelopes() {
    envSlot.innerHTML = "";
    const all = State.envelopes;
    const show = Math.max(0, ENV_MAX - (all.length > ENV_MAX ? 1 : 0));
    if (all.length > ENV_MAX) {
      const badge = document.createElement("div");
      badge.className = "envelope";
      badge.style.borderStyle = "dashed";
      badge.textContent = "+" + (all.length - ENV_MAX);
      envSlot.appendChild(badge);
    }
    all.slice(-show).forEach(function (e) { envSlot.appendChild(e.el); });
  }
  function envelopeText(el, t) {
    const n = el.querySelector(".envelope__text");
    if (n) n.textContent = t;
  }

  /* ══════════ 浮层（令牌 / 说明小卡） ══════════ */
  function placeFloat(el, pos) {
    el.style.left = pos.x + "px";
    el.style.top = pos.y + "px";
  }
  function makeToken(kind, text, nearEl, side) {
    const el = document.createElement("div");
    el.className = "token";
    el.dataset.kind = kind;
    el.textContent = text;
    floatLayer.appendChild(el);
    const p = pagePos(nearEl, side);
    gsap.set(el, { xPercent: -50, yPercent: -50, x: p.x, y: p.y, scale: 0.85, opacity: 0 });
    State.floats.push(el);
    return { el: el, from: p };
  }
  function makeNoteCard(html, nearEl, offset) {
    const el = document.createElement("div");
    el.className = "note-card";
    el.innerHTML = html;
    floatLayer.appendChild(el);
    const p = pagePos(nearEl, "right");
    placeFloat(el, { x: p.x + (offset ? offset.dx : 96), y: p.y + (offset ? offset.dy : 0) });
    gsap.set(el, { scale: 0.9, opacity: 0 });
    State.floats.push(el);
    return el;
  }
  function clearFloats() {
    State.floats.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    State.floats = [];
  }

  /* ══════════ 渲染进程 DOM 树预览 ══════════ */
  function buildDomPreview() {
    domPrev.innerHTML = "";
    const rows = [
      [["html", 92], ["head", 46]],
      [["title", 30], ["link", 26]],
      [["body", 68]],
      [["div#main", 56], ["span", 22], ["img", 18]]
    ];
    rows.forEach(function (cells) {
      const row = document.createElement("div");
      row.className = "dp-row";
      const br = document.createElement("span");
      br.className = "dp-branch";
      row.appendChild(br);
      cells.forEach(function (c) {
        const n = document.createElement("span");
        n.className = "dp-node";
        n.style.width = c[1] + "px";
        n.dataset.label = c[0];
        row.appendChild(n);
      });
      domPrev.appendChild(row);
    });
    const grid = document.createElement("div");
    grid.className = "pixel-grid";
    for (let i = 0; i < 24; i++) grid.appendChild(document.createElement("i"));
    domPrev.appendChild(grid);
  }
  function getPixelGrid() { return $(".pixel-grid", domPrev); }

  /* ══════════ 状态重置（竞态清理核心） ══════════ */
  function resetWorld() {
    if (window.gsap) gsap.killTweensOf("*");
    if (window.gsap && State.tl) { State.tl.kill(); State.tl = null; }

    State.wires.forEach(removeWire);
    State.wires = [];
    clearFloats();
    State.envelopes = [];
    envSlot.innerHTML = "";

    lanes.forEach(function (l) { l.classList.remove("is-active", "is-dim"); gsap.set(l, { opacity: 1 }); });
    $$(".chip").forEach(function (c) { c.classList.remove("is-on", "is-warm"); });
    // 协议清单全清，累积点亮由 goto() 按「已通过的阶段」重新施加（累积语义）
    $$(".proto-item").forEach(function (i) { i.classList.remove("is-lit", "is-current"); });
    EL.summary.textContent = "待全部点亮";
    setProtoCount(0);
    $$(".rail-seg").forEach(function (s) { s.classList.remove("is-active", "is-done"); });
    [EL.procUI, EL.procNet, EL.procRender].forEach(function (p) { p.classList.remove("is-focus"); });
    gsap.set([EL.web, EL.router, EL.dns], { clearProps: "all" });
    gsap.set(EL.arpCache, { opacity: 0.45 });
    EL.arpCacheSub.textContent = "（空）";
    netQueue.innerHTML = "";
    buildDomPreview();
    $$(".wire-head").forEach(function (h) { h.setAttribute("opacity", "0"); });
    ownerTags.forEach(function (t) { gsap.set(t, { opacity: 1, x: 0 }); });
    Object.keys(parts).forEach(function (k) { gsap.set(parts[k], { color: "#A8A29E", scale: 1, opacity: 1, y: 0 }); });
  }

  function setProtoCount(n) {
    const hdr = $(".proto-item").closest("div").querySelector("span:last-child");
    if (hdr) hdr.textContent = n + "/5";
  }
  function setLane(key) {
    lanes.forEach(function (l) {
      const on = l.dataset.lane === key;
      l.classList.toggle("is-active", on);
      l.classList.toggle("is-dim", key !== null && !on);
    });
  }

  /**
   * 协议清单是「累积」语义：一旦点亮不再熄灭，观众看到的永远是「走到这里已用了几种协议」。
   * 因此统计口径是 DOM 中已点亮条目数，而不是本阶段的增量。
   */
  function lightProto(key) {
    const item = $('.proto-item[data-proto="' + key + '"]');
    if (!item) return;
    item.classList.add("is-lit");
    const n = $$(".proto-item.is-lit").length;
    setProtoCount(n);
    if (n >= 5) {
      EL.summary.innerHTML = '<span class="text-amber-700">一次回车 = 5 种协议接力</span>';
    } else {
      EL.summary.textContent = "本次访问已用 " + n + " 种协议";
    }
  }

  /* ══════════ 阶段文案 ══════════ */
  const PHASES = [
    {
      key: "prologue", title: "序章 · URL 分段解剖", step: "STEP 0",
      body: "不同字符，归属不同协议。<b class='text-emerald-700'>host</b> 段交给 DNS 换出 IP，<b class='text-amber-700'>path / query</b> 段原样交给 HTTP 说明「要哪个资源」。",
      callout: "<b>ARP 与 DNS 实际并行</b>——DNS 查询包同样需要链路层地址。本片为叙事清晰分开展示。"
    },
    {
      key: "arp", title: "阶段 1 · ARP 问路", step: "STEP 1",
      body: "目标 IP 已就位，但网卡只认 MAC。于是<b class='text-rose-700'>广播问</b>「192.168.1.1 是谁」，<b class='text-amber-700'>网关单播答</b>，结果存入本机 ARP 缓存。",
      callout: "ARP 表现有结果会缓存在本机，命中时不再广播，直接静默发帧——所以第一次访问才慢。"
    },
    {
      key: "dns", title: "阶段 2 · DNS 解析", step: "STEP 2",
      body: "域名对人类友好，对路由器毫无意义。网络进程调用 OS 解析器逐级查缓存，<b class='text-emerald-700'>未命中</b>才向 DNS 服务器发 UDP 查询，换回一个 32 位地址。",
      callout: "DNS 走 UDP 53：单次查询短小，无连接也不必可靠；正式解析常配 TCP 53 或 DoH/DoT 以保隐私。"
    },
    {
      key: "tcp", title: "阶段 3 · TCP 三次握手", step: "STEP 3",
      body: "<b>IP 只是门牌，TCP 才是一条双向管道。</b>SYN → SYN+ACK → ACK 三次交互后，双方才确认「我发的你能收，你发的我能收」。",
      callout: "第三次握手不可省：它让服务器确认客户端的初始序号，否则旧连接串扰的历史报文仍会被误接收。"
    },
    {
      key: "http", title: "阶段 4 · HTTP 请求与渲染", step: "STEP 4",
      body: "管道就绪才谈得上要什么。发出 GET，服务器回 <b class='text-amber-700'>200 + HTML</b>；解析器<b class='text-emerald-700'>边解析边发现</b> <code>&lt;link&gt;</code>/<code>&lt;script&gt;</code>/<code>&lt;img&gt;</code>，立即并发拉取子资源，全部到手才构建渲染树、绘出像素。",
      callout: "子资源复用同一条 TCP 连接（HTTP/1.1 存在队头阻塞），这正是 HTTP/2 引入多路复用的原因。"
    }
  ];

  function applyPhaseText(i) {
    const p = PHASES[i];
    EL.narrTitle.textContent = p.title;
    EL.narrStep.textContent = p.step;
    EL.narrBody.innerHTML = p.body;
    EL.indicator.textContent = (i === 0 ? "序章" : "阶段 " + i + "/4") + " · " + p.title.split(" · ")[1];
  }
  function setCallout(html) { EL.calloutBody.innerHTML = html; }

  /* ══════════════════════════════════════════════════════
     以下为 5 张《动作时序规格表》的逐 Beat 实现
     ══════════════════════════════════════════════════════ */

  /** 序章《动作时序规格表》 · 总时长 ~1.65s */
  function phasePrologue(tl) {
    // ── Beat 01 上下文建立 · @0ms · 200ms power1.out ──
    tl.fromTo($$(".url-part"),
      { opacity: 0.3, y: 6 },
      { opacity: 1, y: 0, duration: D(200), stagger: D(30), ease: "power1.out" }, at(0));
    tl.to(lanes, { opacity: 0.35, duration: D(200), ease: "power1.out" }, at(0));

    // ── Beat 02 产生预期 · @200ms · 150ms sine.out ──
    tl.to(parts.scheme, { color: "#4338CA", scale: 1.06, duration: D(150), ease: "sine.out" }, at(200));
    tl.fromTo(ownerTags[2], { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: D(150), ease: "sine.out" }, at(230));

    // ── Beat 03 核心动作 · @350ms · 900ms power2.inOut ──
    const hostTok = makeToken("host", "www.example-university.edu.cn", parts.host, "right");
    const q = pagePos(netQueue, "left");
    tl.to(parts.host, { color: "#047857", duration: D(200), ease: "power2.inOut" }, at(350));
    tl.to(hostTok.el, { opacity: 1, scale: 1.05, duration: D(150), ease: "sine.out" }, at(430));
    tl.to(hostTok.el, {
      x: q.x, y: q.y, scale: 0.95, duration: D(500), ease: "power2.inOut",
      onComplete: function () {
        const t = document.createElement("div");
        t.className = "token"; t.dataset.kind = "host"; t.textContent = "example-university.edu.cn";
        netQueue.appendChild(t);
        hostTok.el.remove();
      }
    }, at(500));
    tl.to([parts.path, parts.query, parts.fragment],
      { color: "#B45309", duration: D(200), stagger: D(80), ease: "power2.inOut" }, at(620));
    tl.fromTo([ownerTags[0], ownerTags[1]],
      { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: D(180), stagger: D(80), ease: "power2.out" }, at(900));

    // ── Beat 04 落位沉淀 · @1250ms · 180ms back.out(1.3) ──
    tl.to(hostTok.el, { scale: 1, duration: D(180), ease: "back.out(1.3)" }, at(1250));

    // ── Beat 05 状态确认 · @1430ms · 220ms power1.inOut ──
    const env = pushEnvelope("GET /cs/net/408-index.html?chapter=4 HTTP/1.1", 1);
    tl.fromTo(env, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: D(220), ease: "power1.inOut" }, at(1430));
    tl.to(lanes, { opacity: 1, duration: D(220), ease: "power1.inOut" }, at(1450));
  }

  /** 阶段 1《ARP 问路》 · 总时长 ~1.83s */
  function phaseArp(tl) {
    // ── Beat 01 上下文建立 · @0ms · 200ms power1.out ──
    tl.call(setLane, ["proc"], at(0));
    tl.to(EL.procNet, { scale: 1.03, duration: D(200), ease: "power1.out" }, at(0));
    tl.to(EL.procNet, { scale: 1, duration: D(200), ease: "power1.inOut" }, at(200));

    // ── Beat 02 产生预期 · @200ms · 180ms sine.out ──
    const envReq = pushEnvelope("ARP Request · who has 192.168.1.1?", 1);
    tl.to(EL.procNet, { y: -4, scale: 1.05, duration: D(180), ease: "sine.out" }, at(200));
    tl.fromTo(envReq, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: D(180), ease: "power1.out" }, at(220));

    // ── Beat 03 核心动作（广播上行）· @380ms · 700ms power2.inOut ──
    const w1 = makeWire({ from: EL.procNet, to: EL.router, kind: "broadcast", slot: 0 });
    const ripple = svgEl("circle", { class: "broadcast-ripple", r: 18, cx: 0, cy: 0 });
    svg.appendChild(ripple);
    const rp = stagePos(EL.router, "right");
    ripple.setAttribute("cx", rp.x); ripple.setAttribute("cy", rp.y);

    flyWire(tl, w1, at(380), 700, "power2.inOut");
    tl.call(function () {
      envelopeText(envReq, "ARP Request · 目标 MAC: FF:FF:FF:FF:FF:FF（广播）");
    }, [], at(560));
    tl.fromTo(ripple,
      { scale: 0.6, opacity: 0.9, transformOrigin: rp.x + "px " + rp.y + "px" },
      { scale: 1.4, opacity: 0, duration: D(300), ease: "power2.out" }, at(860));
    tl.fromTo(w1.head, { opacity: 0 }, { opacity: 1, duration: D(150) }, at(900));
    tl.to(EL.procNet, { y: 0, scale: 1, duration: D(180), ease: "sine.out" }, at(1000));

    // ── Beat 04 落位沉淀（单播下行）· @1080ms · 500ms power2.inOut ──
    const w2 = makeWire({ from: EL.router, to: EL.procNet, kind: "unicast", slot: 0 });
    const envRsp = pushEnvelope("ARP Reply · 3C-7F-21-9A", -1);
    flyWire(tl, w2, at(1080), 500, "power2.inOut");
    tl.fromTo(envRsp, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: D(240), ease: "power1.out" }, at(1100));
    tl.fromTo(w2.head, { opacity: 0 }, { opacity: 1, duration: D(150) }, at(1450));

    const macTok = makeToken("mac", "3C-7F-21-9A", EL.router, "left");
    tl.to(macTok.el, { opacity: 1, scale: 1, duration: D(180), ease: "back.out(1.2)" }, at(1380));
    tl.to(EL.arpCache, { opacity: 1, duration: D(240), ease: "power1.out" }, at(1420));
    tl.call(function () { EL.arpCacheSub.textContent = "192.168.1.1 → 3C-7F-21-9A"; }, [], at(1460));
    tl.to(macTok.el, { opacity: 0, duration: D(150) }, at(1600));

    // ── Beat 05 状态确认 · @1730ms · 250ms power1.inOut ──
    tl.add(function () { lightProto("arp"); setCallout(PHASES[1].callout); }, at(1730));
    tl.call(setLane, [null], at(1740));
  }

  /** 阶段 2《DNS 解析》 · 总时长 ~2.0s */
  function phaseDns(tl) {
    // ── Beat 01 上下文建立 · @0ms · 200ms power1.out ──
    tl.call(setLane, ["proc"], at(0));
    tl.to(EL.procNet, { scale: 1.05, duration: D(200), ease: "power1.out" }, at(0));
    tl.to(EL.procNet, { scale: 1, duration: D(200), ease: "power1.inOut" }, at(200));

    const stack = makeNoteCard(
      '<b>解析器调用栈</b><br><span class="nc-tag">1</span>浏览器网络进程<br>' +
      '<span class="nc-tag">2</span>OS 解析器 getaddrinfo<br><span class="nc-tag">3</span>浏览器 DNS 缓存 → hosts → 本地 DNS',
      EL.procNet, { dx: 112, dy: -82 });
    const anchor = pagePos(EL.procNet, "right");
    const miss = document.createElement("div");
    miss.className = "note-card";
    miss.style.width = "auto";
    miss.style.padding = "2px 8px";
    miss.style.borderColor = "#FECACA";
    miss.style.background = "#FEF2F2";
    miss.style.color = "#B91C1C";
    miss.textContent = "三级缓存全部未命中";
    floatLayer.appendChild(miss);
    placeFloat(miss, { x: anchor.x + 112, y: anchor.y + 14 });
    State.floats.push(miss);

    tl.fromTo(stack, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: D(200), ease: "power1.out" }, at(80));

    // ── Beat 02 产生预期 · @200ms · 300ms power1.out ──
    tl.add(function () { EL.chipDNS.classList.add("is-on"); }, at(200));
    tl.fromTo(stack, { opacity: 1 }, { opacity: 0.5, duration: D(300), ease: "power1.inOut" }, at(300));
    tl.to(miss, { opacity: 1, duration: D(300), ease: "power1.out" }, at(360));

    // ── Beat 03 核心动作（去-回两段斜线）· @500ms · 900ms power2.inOut ──
    const envQ = pushEnvelope("DNS 查询 · id 0x3F2A · UDP:53 → src", 1);
    const w1 = makeWire({ from: EL.procNet, to: EL.dns, kind: "req", slot: 0 });
    flyWire(tl, w1, at(500), 430, "power2.inOut");
    tl.fromTo(envQ, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: D(200), ease: "power1.out" }, at(520));
    tl.fromTo(w1.head, { opacity: 0 }, { opacity: 1, duration: D(150) }, at(780));

    const envA = pushEnvelope("DNS 应答 · A 记录 · ttl 300 · 4 字节", -1);
    const w2 = makeWire({ from: EL.dns, to: EL.procNet, kind: "rsp", slot: 0 });
    flyWire(tl, w2, at(980), 430, "power2.inOut");
    tl.fromTo(envA, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: D(200), ease: "power1.out" }, at(1000));
    tl.fromTo(w2.head, { opacity: 0 }, { opacity: 1, duration: D(150) }, at(1260));
    tl.to(stack, { opacity: 0, duration: D(200) }, at(1250));
    tl.to(miss, { opacity: 0, duration: D(200) }, at(1250));

    // ── Beat 04 落位沉淀 · @1410ms · 300ms back.out(1.2) ──
    const mid = w2.el.getPointAtLength(w2.len * 0.5);
    const stageOrigin = pagePos(stage, "left");
    const ipTok = document.createElement("div");
    ipTok.className = "token";
    ipTok.dataset.kind = "ip";
    ipTok.textContent = "93.184.216.34";
    floatLayer.appendChild(ipTok);
    placeFloat(ipTok, { x: stageOrigin.x + mid.x, y: stageOrigin.y + mid.y });
    gsap.set(ipTok, { xPercent: -50, yPercent: -50, opacity: 0, scale: 0.8 });
    State.floats.push(ipTok);
    tl.to(ipTok, { opacity: 1, scale: 1, duration: D(300), ease: "back.out(1.2)" }, at(1410));
    tl.add(function () { EL.chipTCP.classList.add("is-warm"); }, at(1560));
    tl.to(ipTok, { opacity: 0, duration: D(200) }, at(1620));

    // ── Beat 05 状态确认 · @1750ms · 250ms power1.inOut ──
    tl.add(function () { lightProto("dns"); setCallout(PHASES[2].callout); }, at(1750));
    tl.call(setLane, [null], at(1760));
  }

  /** 阶段 3《TCP 三次握手》 · 总时长 ~1.98s */
  function phaseTcp(tl) {
    // ── Beat 01 上下文建立 · @0ms · 200ms power1.out ──
    tl.call(setLane, ["proc"], at(0));
    const slot = $(".proc__slot", EL.procNet);
    if (slot) {
      const t = document.createElement("div");
      t.className = "token"; t.dataset.kind = "ip"; t.textContent = "93.184.216.34";
      slot.appendChild(t);
    }
    tl.to(EL.procNet, { scale: 1.04, duration: D(200), ease: "power1.out" }, at(0));
    tl.to(EL.procNet, { scale: 1, duration: D(200), ease: "power1.inOut" }, at(200));

    // ── Beat 02 产生预期 · @200ms · 180ms sine.out ──
    const synTok = makeToken("syn", "SYN seq=x", EL.procNet, "right");
    tl.to(EL.procNet, { y: -4, scale: 1.05, duration: D(180), ease: "sine.out" }, at(200));
    tl.to(EL.web, { y: -4, scale: 1.04, duration: D(180), ease: "sine.out" }, at(200));
    tl.to(synTok.el, { opacity: 1, scale: 1, duration: D(180), ease: "sine.out" }, at(220));

    // ── Beat 03 核心动作（三条斜线）· @380ms · 1000ms power2.inOut ──
    const e1 = pushEnvelope("① SYN   seq=x", 1);
    const w1 = makeWire({ from: EL.procNet, to: EL.web, kind: "handshake", slot: 0 });
    flyWire(tl, w1, at(380), 300, "power2.inOut");
    tl.fromTo(e1, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: D(200), ease: "power1.out" }, at(390));
    tl.fromTo(w1.head, { opacity: 0 }, { opacity: 1, duration: D(120) }, at(560));

    const e2 = pushEnvelope("② SYN+ACK   seq=y ack=x+1", -1);
    const w2 = makeWire({ from: EL.web, to: EL.procNet, kind: "handshake", slot: 1 });
    flyWire(tl, w2, at(720), 300, "power2.inOut");
    tl.fromTo(e2, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: D(200), ease: "power1.out" }, at(730));
    tl.fromTo(w2.head, { opacity: 0 }, { opacity: 1, duration: D(120) }, at(900));

    const e3 = pushEnvelope("③ ACK   x+1", 1);
    const w3 = makeWire({ from: EL.procNet, to: EL.web, kind: "handshake", slot: 2 });
    flyWire(tl, w3, at(1060), 300, "power2.inOut");
    tl.fromTo(e3, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: D(200), ease: "power1.out" }, at(1070));
    tl.fromTo(w3.head, { opacity: 0 }, { opacity: 1, duration: D(120) }, at(1240));

    // ── Beat 04 落位沉淀 · @1380ms · 300ms power1.out ──
    const connC = makeNoteCard(
      '<b>连接已建立</b><br>客户端 ⟷ 服务器<br><span style="color:#059669">ESTABLISHED</span>',
      EL.procNet, { dx: 116, dy: 100 });
    tl.to(EL.procNet, { y: 0, scale: 1, duration: D(300), ease: "power1.out" }, at(1380));
    tl.to(EL.web, { y: 0, scale: 1, duration: D(300), ease: "power1.out" }, at(1380));
    tl.to(synTok.el, { opacity: 0, duration: D(150) }, at(1380));
    tl.fromTo(connC, { opacity: 0, scale: 0.8 },
      { opacity: 1, scale: 1, duration: D(300), ease: "back.out(1.4)" }, at(1450));
    tl.add(function () {
      EL.chipTCP.classList.remove("is-warm");
      EL.chipTCP.classList.add("is-on");
    }, at(1450));

    // ── Beat 05 状态确认 · @1730ms · 250ms power1.inOut ──
    tl.add(function () { lightProto("tcp"); setCallout(PHASES[3].callout); }, at(1730));
    tl.call(setLane, [null], at(1740));
  }

  /** 阶段 4《HTTP 与渲染》 · 总时长 ~2.9s */
  function phaseHttp(tl) {
    // ── Beat 01 上下文建立 · @0ms · 200ms power1.out ──
    tl.call(setLane, ["proc"], at(0));
    EL.procRender.classList.add("is-focus");
    tl.to(EL.procRender, { scale: 1.04, duration: D(200), ease: "power1.out" }, at(0));
    tl.to(EL.procRender, { scale: 1, duration: D(200), ease: "power1.inOut" }, at(200));
    tl.to($$(".dp-node"), { opacity: 0.3, duration: D(200) }, at(0));
    tl.to($$(".dp-branch"), { opacity: 0.3, duration: D(200) }, at(0));

    // ── Beat 02 产生预期 · @200ms · 200ms sine.out ──
    const e1 = pushEnvelope("GET /cs/net/408-index.html HTTP/1.1", 1);
    tl.to(EL.procNet, { y: -4, duration: D(200), ease: "sine.out" }, at(200));
    tl.fromTo(e1, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: D(200), ease: "power1.out" }, at(220));
    tl.to(EL.procNet, { y: 0, duration: D(200), ease: "sine.out" }, at(340));

    // ── Beat 03 核心动作（请求→应答→DOM 生长）· @400ms · 1100ms power2.inOut ──
    const w1 = makeWire({ from: EL.procNet, to: EL.web, kind: "req", slot: 0 });
    flyWire(tl, w1, at(400), 380, "power2.inOut");
    tl.fromTo(w1.head, { opacity: 0 }, { opacity: 1, duration: D(150) }, at(620));

    const e2 = pushEnvelope("200 OK · text/html · 2.4 KB", -1);
    const w2 = makeWire({ from: EL.web, to: EL.procNet, kind: "rsp", slot: 0 });
    flyWire(tl, w2, at(820), 380, "power2.inOut");
    tl.fromTo(e2, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: D(200), ease: "power1.out" }, at(840));
    tl.fromTo(w2.head, { opacity: 0 }, { opacity: 1, duration: D(150) }, at(1040));

    const htmlCard = makeNoteCard(
      '&lt;html&gt;<br>&nbsp;&nbsp;&lt;head&gt;<br>&nbsp;&nbsp;&nbsp;&nbsp;&lt;link href="a.css"&gt;<br>' +
      '&nbsp;&nbsp;&lt;/head&gt;<br>&nbsp;&nbsp;&lt;body&gt;…&lt;/body&gt;',
      EL.procRender, { dx: 134, dy: -70 });
    tl.fromTo(htmlCard, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: D(250), ease: "power2.out" }, at(1020));
    tl.to($$(".dp-node"), { opacity: 1, duration: D(250), stagger: D(50), ease: "power2.out" }, at(1120));
    tl.to($$(".dp-branch"), { opacity: 1, duration: D(250), stagger: D(50) }, at(1120));
    tl.to(htmlCard, { opacity: 0, duration: D(200) }, at(1420));

    // ── Beat 04 落位沉淀（3 条子资源并行 + 渲染树点亮）· @1500ms · 900ms power2.inOut ──
    const subLabels = ["a.css", "m.js", "h.png"];
    const reqWires = [], rspWires = [];
    subLabels.forEach(function (label, i) {
      const e = pushEnvelope("GET /" + label + " · 复用同一连接", 1);
      const wr = makeWire({ from: EL.procRender, to: EL.web, kind: "req", slot: i });
      const wp = makeWire({ from: EL.web, to: EL.procRender, kind: "rsp", slot: i });
      reqWires.push(wr); rspWires.push(wp);
      const base = at(1500, i * 0.02);
      flyWire(tl, wr, base, 400, "power2.inOut");
      tl.fromTo(e, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: D(200), ease: "power1.out" }, at(1500, i * 0.04));
      tl.fromTo(wr.head, { opacity: 0 }, { opacity: 1, duration: D(150) }, at(1780, i * 0.02));
      // 应答回到渲染进程
      flyWire(tl, wp, at(1940, i * 0.02), 400, "power2.inOut");
      tl.fromTo(wp.head, { opacity: 0 }, { opacity: 1, duration: D(150) }, at(2200, i * 0.02));
    });
    tl.add(function () { EL.chipHTTP.classList.add("is-on"); }, at(1560));
    tl.add(function () {
      $$(".dp-node").forEach(function (n) { n.classList.add("is-lit"); });
    }, at(2300));
    tl.to($$(".dp-node"), { opacity: 1, duration: D(400), stagger: D(40), ease: "power1.out" }, at(2300));
    tl.to(getPixelGrid(), { opacity: 1, duration: D(400), ease: "power1.out" }, at(2340));
    tl.fromTo($$(".pixel-grid i"), { scale: 0.6 },
      { scale: 1, duration: D(300), stagger: D(10), ease: "back.out(1.6)" }, at(2400));

    // ── Beat 05 状态确认 · @2500ms · 400ms power1.inOut ──
    tl.add(function () { lightProto("http"); }, at(2500));
    tl.add(function () { lightProto("render"); }, at(2610));
    tl.to(getPixelGrid(), { scale: 1.02, duration: D(300), ease: "back.out(1.2)" }, at(2620));
    tl.to(getPixelGrid(), { scale: 1, duration: D(300), ease: "power2.out" }, at(2920));
    tl.add(function () {
      $$(".rail-seg").forEach(function (s) { s.classList.add("is-done"); });
    }, at(2500));
    tl.call(setLane, [null], at(2520));
  }

  /* ══════════ 每阶段子时间轴 ══════════ */
  const BUILDERS = [phasePrologue, phaseArp, phaseDns, phaseTcp, phaseHttp];
  function getPhaseTimeline(phaseIndex) {
    const tl = gsap.timeline({ paused: true, onComplete: onPhaseComplete });
    BUILDERS[phaseIndex](tl);
    return tl;
  }

  /* ══════════ 主控制器 ══════════ */
  function goto(i, opts) {
    opts = opts || {};
    i = clamp(i, 0, PHASES.length - 1);
    resetWorld();

    State.phase = i;
    applyPhaseText(i);
    setCallout(PHASES[i].callout);

    // 进度轨
    $$(".rail-seg").forEach(function (s, idx) {
      s.classList.toggle("is-done", idx < i);
      s.classList.toggle("is-active", idx === i);
    });
    // 当前协议高亮（未点亮前先标 current）
    const protoKeys = [null, "arp", "dns", "tcp", "http"];
    $$(".proto-item").forEach(function (el) {
      el.classList.toggle("is-current", el.dataset.proto === protoKeys[i]);
    });

    // 累积语义：仅把「已完整播放过」的阶段点亮的协议重新施加。
    // 阶段 4 内的 http / render 仍由其 Beat 05 依次点亮，保持「先演后点」。
    const passed = [[], ["arp"], ["arp", "dns"], ["arp", "dns", "tcp"], ["arp", "dns", "tcp"]][i];
    passed.forEach(function (k) { lightProto(k); });

    State.tl = getPhaseTimeline(i);
    State.tl.progress(0, true).pause();
    State.playing = false;
    EL.btnPlay.textContent = "▶ 播放";

    if (opts.autoplay) play();
  }

  function play() {
    if (!State.tl) return;
    if (State.tl.progress() >= 1) { goto(State.phase, { autoplay: false }); }
    State.tl.play();
    State.playing = true;
    EL.btnPlay.textContent = "⏸ 暂停";
  }
  function pause() {
    if (!State.tl) return;
    State.tl.pause();
    State.playing = false;
    EL.btnPlay.textContent = "▶ 播放";
  }
  function togglePlay() {
    // 手动播放接管：退出自动连播，避免两套调度同时驱动同一时间轴
    if (State.auto) stopAuto();
    if (State.playing) pause(); else play();
  }
  function next() {
    if (State.auto) stopAuto();
    if (State.phase < PHASES.length - 1) goto(State.phase + 1); else pause();
  }
  function prev() {
    if (State.auto) stopAuto();
    if (State.phase > 0) goto(State.phase - 1);
  }
  function reset() {
    stopAuto();
    goto(0);
  }

  /* ── 全自动连播：从当前阶段一路播到最后一阶段 ──
     仍由 GSAP 时间轴驱动，不使用 setTimeout/setInterval；
     阶段衔接发生在子时间轴 onComplete 回调里，符合「统一时间轴管线」铁律。 */
  function startAuto() {
    State.auto = true;
    syncAutoBtn();
    const atLast = State.phase >= PHASES.length - 1;
    const phaseDone = !State.tl || State.tl.progress() >= 1;
    if (atLast) goto(0, { autoplay: true });            // 已在末阶段 → 从头重放
    else if (phaseDone) goto(State.phase + 1, { autoplay: true }); // 当前阶段已播完 → 直接接力下一阶段
    else play();                                        // 当前阶段未播完 → 从中断处续播
  }
  function stopAuto() {
    if (!State.auto) return;
    State.auto = false;
    syncAutoBtn();
  }
  function toggleAuto() {
    if (State.auto) { stopAuto(); pause(); } else { startAuto(); }
  }
  function syncAutoBtn() {
    EL.btnAuto.classList.toggle("is-on", State.auto);
    EL.btnAuto.textContent = State.auto ? "⏸ 停止连播" : "⏩ 全自动";
  }

  function onPhaseComplete() {
    State.playing = false;
    if (State.auto && State.phase < PHASES.length - 1) {
      goto(State.phase + 1, { autoplay: true });   // 接力下一阶段
      return;
    }
    if (State.auto) stopAuto();                     // 末阶段播完，退出连播
    EL.btnPlay.textContent = State.phase < PHASES.length - 1 ? "▶ 下一阶段" : "▶ 重播";
  }

  /* ══════════ 事件绑定 ══════════ */
  $("#btn-play").addEventListener("click", togglePlay);
  $("#btn-next").addEventListener("click", next);
  $("#btn-prev").addEventListener("click", prev);
  $("#btn-auto").addEventListener("click", toggleAuto);
  $("#btn-reset").addEventListener("click", reset);

  $$(".speed-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      $$(".speed-btn").forEach(function (b) { b.classList.remove("is-on"); });
      btn.classList.add("is-on");
      State.speed = parseFloat(btn.dataset.speed);
      // 速率切换：重建当前阶段以按新速率精确缩放，避免截断；
      // 自动连播中则同步保持连播，不因切速率而中断。
      goto(State.phase, { autoplay: State.playing || State.auto });
    });
  });

  window.addEventListener("resize", function () {
    State.wires.forEach(layoutWire);
  });

  /* ══════════ 启动 ══════════ */
  buildDomPreview();
  goto(0);

  /* 对外暴露（调试与规范自检用） */
  window.APP = {
    PHASE_COUNT: PHASES.length,
    State: State,
    computeWire: computeWire,
    getPhaseTimeline: getPhaseTimeline,
    setPhaseActive: setLane,
    controller: {
      goto: goto, play: play, pause: pause,
      next: next, prev: prev, reset: reset,
      auto: startAuto, stopAuto: stopAuto
    }
  };
})();
