(function () {
  "use strict";
  const M = window.ARPModel;
  const C = window.ARPChoreo;
  const $ = (id) => document.getElementById(id);
  const svg = $("topology");
  const NS = "http://www.w3.org/2000/svg";
  const hash = new URLSearchParams(location.hash.slice(1));
  const allFlows = [...M.flows.same, ...M.flows.cross];
  const first =
    allFlows.find((f) => f.id === hash.get("flow")) || M.flows.same[0];
  let flow = M.buildFlow(first.id);
  let marks = C.boundaries(flow);
  let mode = flow.mode;
  const linkedTime = Number(hash.get("t"));
  let time = Number.isFinite(linkedTime) ? Math.max(0, linkedTime) : 0;
  let speed = [0.5, 1, 1.5, 2].includes(Number(hash.get("speed")))
    ? Number(hash.get("speed"))
    : 1;
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = hash.has("motion")
    ? hash.get("motion") === "reduced"
    : media.matches;
  let motionOverride = hash.has("motion");
  let playing = false;
  let timeline = null;
  let lastWrite = 0;
  let nodes = {};
  let routeRows = [];
  let tokenEls = [];
  let tag;
  let tagText;
  let tagDetail;
  let activeWires = [];
  let routeGuide;
  let pendingPacket;
  let lastIndex = -1;
  const clock = { t: 0 };
  function text(el, value) {
    value = value == null ? "—" : String(value);
    if (el.textContent !== value) el.textContent = value;
  }
  function attr(el, key, value) {
    const str = String(value);
    if (el.getAttribute(key) !== str) el.setAttribute(key, str);
  }
  function make(name, attrs = {}, parent = svg, value) {
    const el = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([key, val]) => el.setAttribute(key, val));
    if (value != null) el.textContent = value;
    parent.appendChild(el);
    return el;
  }
  function label(x, y, value, cls, parent = svg) {
    return make("text", { x, y, class: cls || "" }, parent, value);
  }
  function rule(x1, y1, x2, y2, parent) {
    return make("line", { x1, y1, x2, y2, class: "rule" }, parent);
  }
  function subnet(x, width, name, ip) {
    make("rect", { x, y: 20, width, height: 525, rx: 12, class: "subnet" });
    label(x + 20, 47, name, "subnet-label");
    label(x + width - 20, 47, ip, "subnet-ip mono").setAttribute(
      "text-anchor",
      "end",
    );
  }
  function wire(points) {
    make("polyline", {
      points: points.map((p) => p.join(",")).join(" "),
      class: "wire",
    });
  }
  function drawSwitch(x, y, name) {
    make("rect", {
      x: x - 31,
      y: y - 22,
      width: 62,
      height: 44,
      rx: 7,
      class: "switch-body",
    });
    for (let i = 0; i < 5; i++)
      make("rect", {
        x: x - 21 + i * 9,
        y: y - 4,
        width: 5,
        height: 5,
        rx: 1,
        fill: "#83988a",
      });
    label(x, y + 43, name, "switch-label");
  }
  function host(id, x, y) {
    const device = M.devices[id];
    const g = make("g", {
      transform: `translate(${x - 110} ${y - 89})`,
      "data-device": id,
    });
    const focus = make(
      "rect",
      {
        x: -4,
        y: -4,
        width: 228,
        height: 186,
        rx: 13,
        fill: "none",
        stroke: "#276a7c",
        "stroke-width": 2,
        opacity: 0,
      },
      g,
    );
    make("rect", { width: 220, height: 178, rx: 10, class: "device-body" }, g);
    label(15, 27, device.name, "node-name", g);
    label(15, 49, `${device.ip} /24`, "node-ip mono", g);
    label(15, 67, device.mac, "node-mac mono", g);
    const status = label(15, 88, "就绪", "node-status", g);
    rule(15, 101, 205, 101, g);
    const cacheFrame = make(
      "rect",
      {
        x: 9,
        y: 107,
        width: 202,
        height: 62,
        rx: 5,
        class: "cache-cue",
        opacity: 0,
      },
      g,
    );
    label(15, 120, "ARP 缓存 · IP → MAC", "cache-heading", g);
    const cache = label(15, 141, "空", "cache-value mono", g);
    const mac = label(15, 160, "", "cache-mac mono", g);
    nodes[id] = { g, focus, status, cache, mac, cacheFrame };
  }
  function router() {
    const g = make("g");
    make(
      "rect",
      { x: 432, y: 162, width: 256, height: 225, rx: 13, class: "device-body" },
      g,
    );
    label(449, 188, "路由器 R", "node-name", g);
    label(672, 187, "逐跳转发", "cache-heading", g).setAttribute(
      "text-anchor",
      "end",
    );
    ["r0", "r1"].forEach((id, i) => {
      const y = 203 + i * 86;
      const focus = make(
        "rect",
        {
          x: 441,
          y: y - 3,
          width: 238,
          height: 83,
          rx: 7,
          fill: "none",
          stroke: "#276a7c",
          "stroke-width": 2,
          opacity: 0,
        },
        g,
      );
      label(
        449,
        y + 10,
        `${i === 0 ? "eth0" : "eth1"} · ${M.devices[id].ip}`,
        "node-ip mono",
        g,
      );
      label(449, y + 27, M.devices[id].mac, "node-mac mono", g);
      const status = label(449, y + 46, "就绪", "node-status", g);
      const cacheFrame = make(
        "rect",
        {
          x: 444,
          y: y + 49,
          width: 232,
          height: 33,
          rx: 4,
          class: "cache-cue",
          opacity: 0,
        },
        g,
      );
      const cache = label(449, y + 63, "ARP · 空", "cache-value mono", g);
      const mac = label(449, y + 77, "", "cache-mac mono", g);
      nodes[id] = { g, focus, status, cache, mac, cacheFrame };
    });
    make("rect", {
      x: 423,
      y: 270,
      width: 10,
      height: 10,
      rx: 2,
      fill: "#83988a",
    });
    make("rect", {
      x: 687,
      y: 270,
      width: 10,
      height: 10,
      rx: 2,
      fill: "#83988a",
    });
    label(419, 260, "eth0", "port-label mono").setAttribute(
      "text-anchor",
      "end",
    );
    label(701, 260, "eth1", "port-label mono");
    make("line", {
      x1: 560,
      y1: 388,
      x2: 560,
      y2: 417,
      stroke: "#ced8ce",
      "stroke-dasharray": "3 3",
    });
    make("rect", {
      x: 421,
      y: 417,
      width: 278,
      height: 129,
      rx: 8,
      class: "route-body",
    });
    label(435, 438, "R 的路由表", "route-heading");
    label(435, 458, "目的网络", "cache-heading");
    label(630, 458, "出接口", "cache-heading");
    routeRows = ["192.168.1.0/24", "192.168.2.0/24"].map((network, i) => {
      const y = 474 + i * 21;
      const bg = make("rect", {
        x: 429,
        y: y - 12,
        width: 262,
        height: 20,
        rx: 3,
        fill: "#e5f0f1",
        opacity: 0,
      });
      label(435, y + 2, network, "route-row mono");
      label(633, y + 2, `eth${i}`, "route-row mono");
      return { network, bg };
    });
    const nextHop = label(435, 532, "下一跳 · 待查表", "route-next mono");
    routeRows.nextHop = nextHop;
  }
  function buildStage() {
    while (svg.lastChild && !["title", "desc"].includes(svg.lastChild.tagName))
      svg.lastChild.remove();
    nodes = {};
    routeRows = [];
    const defs = make("defs");
    const marker = make(
      "marker",
      {
        id: "cue-arrow",
        viewBox: "0 0 8 8",
        refX: 7,
        refY: 4,
        markerWidth: 5,
        markerHeight: 5,
        orient: "auto-start-reverse",
      },
      defs,
    );
    make("path", { d: "M0 0 L8 4 L0 8 Z", fill: "#276a7c" }, marker);
    if (mode === "same") {
      subnet(20, 1080, "同一广播域 · 以太网交换机连接", "192.168.1.0/24");
      Object.entries(C.positions.same).forEach(([id, p]) =>
        wire([
          [p[0], 294],
          [560, 420],
        ]),
      );
      drawSwitch(560, 420, "交换机 S");
      Object.entries(C.positions.same).forEach(([id, p]) => host(id, ...p));
      label(
        560,
        510,
        "广播到达所有其他主机；只有目标需要应答",
        "subnet-ip",
      ).setAttribute("text-anchor", "middle");
    } else {
      subnet(20, 380, "子网 1", "192.168.1.0/24");
      subnet(720, 380, "子网 2", "192.168.2.0/24");
      [
        ["a", "r0"],
        ["b", "r0"],
        ["c", "r1"],
        ["d", "r1"],
      ].forEach(([from, to]) => wire(C.path(mode, from, to)));
      drawSwitch(340, 275, "交换机 S1");
      drawSwitch(780, 275, "交换机 S2");
      ["a", "b", "c", "d"].forEach((id) => host(id, ...C.positions.cross[id]));
      router();
      label(560, 78, "ARP 广播不穿过路由器", "subnet-ip").setAttribute(
        "text-anchor",
        "middle",
      );
      pendingPacket = label(560, 98, "", "route-next mono");
      pendingPacket.setAttribute("text-anchor", "middle");
    }
    activeWires = Array.from({ length: 3 }, () =>
      make("polyline", {
        fill: "none",
        stroke: "#276a7c",
        "stroke-width": 2.5,
        "stroke-linejoin": "round",
        "marker-end": "url(#cue-arrow)",
        opacity: 0,
        "data-guide": "link",
      }),
    );
    routeGuide = make("polyline", {
      fill: "none",
      stroke: "#276a7c",
      "stroke-width": 2,
      "stroke-linejoin": "round",
      "marker-end": "url(#cue-arrow)",
      opacity: 0,
      "data-guide": "route",
    });
    tokenEls = Array.from({ length: 3 }, () => {
      const g = make("g", { visibility: "hidden" });
      const box = make(
        "rect",
        { x: -20, y: -10, width: 40, height: 20, rx: 4 },
        g,
      );
      const word = label(0, 3, "ARP", "packet-label", g);
      return { g, box, word };
    });
    tag = make("g", { visibility: "hidden" });
    make(
      "rect",
      { x: -94, y: -20, width: 188, height: 46, rx: 6, class: "tag-body" },
      tag,
    );
    tagText = label(0, -1, "", "tag-text", tag);
    tagDetail = label(0, 17, "", "tag-detail", tag);
  }
  function options() {
    document
      .querySelectorAll("[data-mode]")
      .forEach((el) =>
        el.setAttribute("aria-pressed", String(el.dataset.mode === mode)),
      );
    $("flow-options").replaceChildren(
      ...M.flows[mode].map((item) => {
        const button = document.createElement("button");
        button.textContent = item.label;
        button.dataset.flow = item.id;
        button.setAttribute("aria-pressed", String(item.id === flow.id));
        button.addEventListener("click", () => selectFlow(item.id));
        return button;
      }),
    );
    text(
      $("flow-note"),
      M.flows[mode].find((item) => item.id === flow.id).note,
    );
    $("step-track").replaceChildren(
      ...flow.steps.map((step, i) => {
        const button = document.createElement("button");
        const index = document.createElement("span");
        index.className = "step-index";
        index.textContent = String(i + 1).padStart(2, "0");
        button.append(index, document.createTextNode(step.title));
        button.title = step.caption;
        button.addEventListener("click", () => seek(marks[i + 1]));
        return button;
      }),
    );
    $("progress").max = String(total());
    text($("time-total"), `${total().toFixed(1)} s`);
    lastIndex = -1;
  }
  function total() {
    return marks.at(-1);
  }
  function writeHash(force = false) {
    if (!force && performance.now() - lastWrite < 350) return;
    lastWrite = performance.now();
    const p = new URLSearchParams({
      flow: flow.id,
      t: time.toFixed(3),
      speed: String(speed),
      motion: reduced ? "reduced" : "full",
    });
    try {
      history.replaceState(null, "", `#${p}`);
    } catch {
      /* file:// may restrict history; controls remain usable. */
    }
  }
  function render(t) {
    time = Math.max(0, Math.min(total(), t));
    const v = C.sample(flow, time, reduced);
    const step = flow.steps[v.index];
    const snapshot = v.snapshot;
    const hint = v.hint.value;
    Object.entries(nodes).forEach(([id, node]) => {
      const before = step.before,
        after = step.after;
      const statusChanged = before.statuses[id] !== after.statuses[id];
      const cacheChanged =
        JSON.stringify(before.caches[id]) !== JSON.stringify(after.caches[id]);
      text(node.status, snapshot.statuses[id] || "就绪");
      attr(node.status, "opacity", statusChanged ? v.stateAlpha : 1);
      const entries = snapshot.caches[id] || [];
      text(
        node.cache,
        entries.length
          ? `${id.startsWith("r") ? "ARP · " : ""}${entries[0].ip}`
          : id.startsWith("r")
            ? "ARP · 空"
            : "空 · 尚未学习",
      );
      text(node.mac, entries.length ? `→ ${entries[0].mac}` : "");
      attr(node.cache, "opacity", cacheChanged ? v.stateAlpha : 1);
      attr(node.mac, "opacity", cacheChanged ? v.stateAlpha : 1);
      attr(
        node.focus,
        "opacity",
        Math.max(
          v.focus === id ? v.focusAlpha : 0,
          hint?.node === id ? v.hint.alpha * 0.75 : 0,
        ),
      );
      attr(
        node.cacheFrame,
        "opacity",
        hint?.node === id && hint.surface === "cache" ? v.hint.alpha : 0,
      );
      attr(node.cacheFrame, "data-tone", hint?.tone || "active");
    });
    if (mode === "cross") {
      const routeChanged =
        JSON.stringify(step.before.route) !== JSON.stringify(step.after.route);
      routeRows.forEach((row) =>
        attr(
          row.bg,
          "opacity",
          snapshot.route?.network === row.network
            ? routeChanged
              ? v.stateAlpha
              : 1
            : 0,
        ),
      );
      text(
        routeRows.nextHop,
        snapshot.route
          ? `下一跳 · ${snapshot.route.nextHop}`
          : "下一跳 · 待查表",
      );
      attr(routeRows.nextHop, "opacity", routeChanged ? v.stateAlpha : 1);
      text(
        pendingPacket,
        snapshot.route
          ? `IPv4 · ${M.devices[flow.source].name} → ${M.devices[flow.target].name} · TTL 63`
          : "",
      );
      attr(pendingPacket, "opacity", routeChanged ? v.stateAlpha : 1);
    }
    tokenEls.forEach((token, i) => {
      const data = v.tokens[i];
      attr(token.g, "visibility", data ? "visible" : "hidden");
      if (!data) return;
      attr(
        token.g,
        "transform",
        `translate(${data.point[0]} ${data.point[1]})`,
      );
      attr(token.g, "opacity", data.alpha);
      attr(token.box, "class", data.type === "arp" ? "token-arp" : "token-ip");
      text(token.word, data.type === "arp" ? "ARP" : "IP");
    });
    renderHint(v);
    const p = v.packet;
    const arp = p && p.type !== "IPv4";
    text(
      $("packet-type"),
      p ? `${p.type}${p.smac ? " · 以太网帧" : " · 已拆除帧头"}` : "等待封装",
    );
    text(
      $("packet-location"),
      p
        ? p.smac
          ? `本跳：${owner(p.smac)} → ${owner(p.dmac)}`
          : "路由与交付只处理内部 IP 数据报"
        : "尚未生成链路层报文",
    );
    text($("packet-dmac"), p?.dmac);
    text($("packet-smac"), p?.smac);
    text($("packet-ether"), p?.smac ? p.etherType : null);
    text($("packet-sip"), p?.sip);
    text($("packet-dip"), p?.dip);
    text($("sip-label"), arp ? "发送方 IP · SPA" : "源 IP · 端到端");
    text($("dip-label"), arp ? "目标 IP · TPA" : "目的 IP · 端到端");
    text($("ttl-label"), arp ? "操作码" : "TTL");
    text($("packet-ttl"), arp ? p.opcode : p?.ttl);
    // Keep field labels readable even when no frame is present; only values move.
    $("ethernet-fields")
      .querySelectorAll("strong")
      .forEach((el) => {
        el.style.opacity = String(v.packetAlpha);
        el.style.transform = `translateX(${v.headerOffset}px)`;
      });
    $("payload-fields")
      .querySelectorAll("strong")
      .forEach((el) => {
        el.style.opacity = String(v.packetAlpha);
      });
    renderAddressGuide(v);
    text($("caption"), v.caption);
    $("caption").style.opacity = String(v.captionAlpha);
    text(
      $("phase"),
      time === 0
        ? "准备"
        : time >= total()
          ? "已交付"
          : v.transportPhase || step.phase,
    );
    text(
      $("step-number"),
      time === 0 ? "00" : String(v.index + 1).padStart(2, "0"),
    );
    text(
      $("event-label"),
      time === 0 ? "起点" : snapshot.delivered ? "交付完成" : step.title,
    );
    $("progress").value = String(time);
    text($("time-readout"), time.toFixed(1));
    $("prev").disabled = time <= 0;
    $("next").disabled = time >= total();
    if (lastIndex !== (time === 0 ? -1 : v.index)) {
      lastIndex = time === 0 ? -1 : v.index;
      Array.from($("step-track").children).forEach((button, i) => {
        if (i === lastIndex) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
    }
    writeHash();
  }
  function renderHint(v) {
    const hint = v.hint.value;
    const alpha = hint ? v.hint.alpha : 0;
    attr(tag, "visibility", alpha > 0 ? "visible" : "hidden");
    attr(tag, "opacity", alpha);
    if (hint) {
      const pos = C.positions[mode][hint.node];
      const xy =
        hint.node === "r0" || hint.node === "r1"
          ? [560, 130]
          : mode === "same"
            ? [pos[0], 84]
            : [pos[0], pos[1] + 113];
      attr(tag, "transform", `translate(${xy[0]} ${xy[1]})`);
      attr(tag, "data-tone", hint.tone);
      text(tagText, hint.label);
      text(tagDetail, hint.detail);
    }
    activeWires.forEach((wire, i) => {
      const points = hint?.paths[i];
      attr(wire, "opacity", points?.length ? alpha * 0.55 : 0);
      if (points?.length)
        attr(wire, "points", points.map((point) => point.join(",")).join(" "));
    });
    const routing = hint?.surface === "route";
    attr(routeGuide, "opacity", routing ? alpha : 0);
    if (routing) {
      const y = hint.network === "192.168.1.0/24" ? 476 : 497;
      const left = hint.out === "r0";
      const x = left ? 410 : 710;
      attr(
        routeGuide,
        "points",
        `${left ? 429 : 691},${y} ${x},${y} ${x},275 ${left ? 422 : 698},275`,
      );
    }
    routeRows.forEach((row) => {
      const selected = routing && row.network === hint.network;
      attr(row.bg, "stroke", selected ? "#276a7c" : "none");
      attr(row.bg, "stroke-width", 1.5);
      if (selected) attr(row.bg, "opacity", alpha);
    });
    Object.entries(nodes).forEach(([id, node]) => {
      if (routing && hint.out === id) attr(node.focus, "opacity", alpha * 0.75);
    });
    ["dmac", "smac", "ether", "sip", "dip", "ttl"].forEach((key) => {
      const field = $(`packet-${key}`).parentElement;
      if (hint?.fields.includes(key)) field.setAttribute("data-cue", hint.tone);
      else field.removeAttribute("data-cue");
      field.style.setProperty("--cue-alpha", String(alpha));
    });
  }
  function renderAddressGuide(v) {
    const guide = C.addressGuide(flow, v.index, v.p, M.devices);
    const value = guide.value;
    const scan = value?.scan.value;
    const scanAlpha = guide.alpha * (value?.scan.alpha ?? 1);
    const keys = ["sip", "smac", "dip", "dmac"];
    keys.forEach((key, i) => {
      const field = $(`packet-${key}`).parentElement;
      field.removeAttribute("data-address");
      field.removeAttribute("data-seen");
      if (value?.transmitting) field.removeAttribute("data-cue");
      if (scan) {
        if (scan.number > i) field.setAttribute("data-seen", "true");
        if (scan.key === key)
          field.setAttribute("data-address", String(scan.number));
      }
      field.style.setProperty("--address-alpha", String(scanAlpha));
      const order = document.querySelector(`[data-address-key="${key}"]`);
      attr(order, "data-active", String(scan?.key === key));
      attr(order, "data-seen", String(!!scan && scan.number > i));
      order.style.setProperty("--address-alpha", String(scanAlpha));
    });
    const mapping = value?.mapping;
    text(
      $("address-explanation"),
      scan
        ? `${scan.label}：${scan.note}`
        : mapping?.note || "传输时依次核对四个地址；ARP 解析本链路的 IP。",
    );
    $("address-explanation").style.opacity = String(
      scan ? scanAlpha : guide.alpha,
    );
    text(
      $("mapping-owner"),
      mapping ? `${mapping.owner} 的 ARP 映射` : "ARP 地址映射",
    );
    text(
      $("mapping-ip-label"),
      mapping?.gateway ? "下一跳 · 网关 IP" : "本链路 IP",
    );
    text($("mapping-ip"), mapping?.ip);
    text($("mapping-mac"), mapping?.mac || "待解析");
    text($("mapping-status"), mapping?.status || "等待查询");
    $("mapping-status").style.opacity = String(mapping?.statusAlpha ?? 1);
    text(
      $("mapping-note"),
      mapping?.note || "ARP 缓存记录 IP → MAC，而不是 IP → IP。",
    );
    attr($("mapping-row"), "data-resolved", String(!!mapping?.mac));
    $("mapping-row").style.opacity = value ? String(guide.alpha) : "1";
  }
  function owner(mac) {
    if (!mac) return "—";
    if (/^ff[:-]/i.test(mac)) return "广播";
    const active = Object.keys(C.positions[mode]);
    const key = active.find((id) => M.devices[id].mac === mac);
    return key ? M.devices[key].name : mac;
  }
  function setRunning(value) {
    playing = value;
    text(
      $("play"),
      playing ? "暂停演示" : time >= total() ? "重新播放" : "播放演示",
    );
    $("state-dot").classList.toggle("running", playing);
  }
  function nearestMark(t) {
    return marks.reduce(
      (best, mark) => (Math.abs(mark - t) < Math.abs(best - t) ? mark : best),
      0,
    );
  }
  function clockTime(t) {
    if (!reduced) return t;
    const frame = C.sample(flow, t);
    return (frame.index + frame.p) * C.timing.reducedHold;
  }
  function buildClock() {
    if (timeline) timeline.kill();
    timeline = null;
    if (!window.gsap) return;
    clock.t = 0;
    timeline = gsap.timeline({
      paused: true,
      onUpdate() {
        const value = reduced
          ? marks.findLast((mark) => mark <= clock.t + 1e-8) || 0
          : clock.t;
        render(value);
      },
      onComplete() {
        render(total());
        setRunning(false);
        writeHash(true);
      },
    });
    marks.slice(1).forEach((end, i) => {
      timeline.to(clock, {
        t: end,
        duration: reduced ? C.timing.reducedHold : end - marks[i],
        ease: "none",
      });
    });
    timeline.timeScale(speed);
    timeline.time(clockTime(time), true);
  }
  function pause() {
    if (timeline) timeline.pause();
    setRunning(false);
    writeHash(true);
  }
  function seek(t) {
    pause();
    time = Math.max(0, Math.min(total(), t));
    if (reduced) time = nearestMark(time);
    if (timeline) timeline.time(clockTime(time), true);
    render(time);
    setRunning(false);
    writeHash(true);
  }
  function togglePlay() {
    if (!timeline) return;
    if (playing) {
      pause();
      return;
    }
    if (time >= total()) seek(0);
    setRunning(true);
    timeline.play();
  }
  function selectFlow(id) {
    const keep = time;
    pause();
    flow = M.buildFlow(id);
    marks = C.boundaries(flow);
    mode = flow.mode;
    time = Math.min(keep, total());
    options();
    buildStage();
    buildClock();
    render(time);
    setRunning(false);
    writeHash(true);
  }
  function stepBy(direction) {
    seek(
      direction > 0
        ? (marks.find((mark) => mark > time + 1e-7) ?? total())
        : (marks.findLast((mark) => mark < time - 1e-7) ?? 0),
    );
  }
  $("play").addEventListener("click", togglePlay);
  $("prev").addEventListener("click", () => stepBy(-1));
  $("next").addEventListener("click", () => stepBy(1));
  $("reset").addEventListener("click", () => seek(0));
  $("progress").addEventListener("input", (e) => seek(Number(e.target.value)));
  $("speed").value = String(speed);
  $("speed").addEventListener("change", (e) => {
    speed = Number(e.target.value);
    timeline?.timeScale(speed);
    writeHash(true);
  });
  function setMotion(value) {
    const resume = playing;
    pause();
    reduced = value;
    $("reduce-motion").checked = reduced;
    document.body.dataset.reduced = String(reduced);
    if (reduced) time = marks.find((mark) => mark >= time - 1e-8) ?? total();
    buildClock();
    render(time);
    writeHash(true);
    if (resume && time < total()) togglePlay();
  }
  $("reduce-motion").checked = reduced;
  document.body.dataset.reduced = String(reduced);
  $("reduce-motion").addEventListener("change", (e) => {
    motionOverride = true;
    setMotion(e.target.checked);
  });
  media.addEventListener("change", (e) => {
    if (!motionOverride) setMotion(e.matches);
  });
  document.querySelectorAll("[data-mode]").forEach((button) =>
    button.addEventListener("click", () => {
      if (mode !== button.dataset.mode)
        selectFlow(M.flows[button.dataset.mode][0].id);
    }),
  );
  document.addEventListener("keydown", (e) => {
    if (
      e.target instanceof Element &&
      e.target.closest("input,select,textarea,button,a,[contenteditable]")
    )
      return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    }
    if (e.code === "ArrowLeft") {
      e.preventDefault();
      stepBy(-1);
    }
    if (e.code === "ArrowRight") {
      e.preventDefault();
      stepBy(1);
    }
    if (e.code === "Home") {
      e.preventDefault();
      seek(0);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  window.addEventListener("pagehide", () => {
    pause();
    timeline?.kill();
  });
  time = Math.min(time, total());
  if (reduced) time = nearestMark(time);
  options();
  buildStage();
  buildClock();
  render(time);
  setRunning(false);
  if (!window.gsap) {
    $("play").disabled = true;
    $("engine-notice").hidden = false;
  }
})();
