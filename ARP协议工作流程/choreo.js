/* Pure time sampling: no DOM, timers or accumulated animation state. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ARPChoreo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const duration = 3.6;
  const timing = {
    transfer: 9,
    reducedHold: 2.4,
    scanStart: 0.08,
    scanStride: 0.14,
    scanFade: 0.04,
    flyStart: 0.64,
    flyEnd: 0.82,
    receiveEnd: 0.9,
  };
  const isTransfer = (step) => ["request", "reply", "send"].includes(step.kind);
  function boundaries(flow) {
    return flow.steps.reduce(
      (marks, step) => {
        marks.push(
          Math.round((marks.at(-1) + (isTransfer(step) ? timing.transfer : duration)) * 1000) / 1000,
        );
        return marks;
      },
      [0],
    );
  }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const positions = {
    same: { h1: [145, 205], h2: [420, 205], h3: [700, 205], h4: [975, 205] },
    cross: {
      a: [136, 155],
      b: [136, 405],
      r0: [485, 258],
      r1: [635, 258],
      c: [984, 155],
      d: [984, 405],
    },
  };
  function path(mode, from, to) {
    const pos = positions[mode];
    if (!pos[from] || !pos[to]) return [];
    if (mode === "same")
      return [
        [pos[from][0], 294],
        [560, 420],
        [pos[to][0], 294],
      ];
    const left = (key) => ["a", "b", "r0"].includes(key);
    if (left(from) !== left(to)) return []; // An ARP frame never crosses the router.
    const point = (key) =>
      key === "r0"
        ? [432, 275]
        : key === "r1"
          ? [688, 275]
          : [pos[key][0] + (left(key) ? 110 : -110), pos[key][1]];
    return [point(from), [left(from) ? 340 : 780, 275], point(to)];
  }
  function atPath(points, q) {
    const lengths = points
      .slice(1)
      .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
    let distance = lengths.reduce((a, b) => a + b, 0) * clamp(q);
    for (let i = 0; i < lengths.length; i++) {
      if (distance <= lengths[i] || i === lengths.length - 1) {
        const k = lengths[i] ? distance / lengths[i] : 0;
        return [
          points[i][0] + (points[i + 1][0] - points[i][0]) * k,
          points[i][1] + (points[i + 1][1] - points[i][1]) * k,
        ];
      }
      distance -= lengths[i];
    }
    return points[0] || [0, 0];
  }
  function textBlend(before, after, q) {
    if (JSON.stringify(before) === JSON.stringify(after))
      return { value: after, alpha: 1 };
    return q < 0.5
      ? { value: before, alpha: 1 - 2 * q }
      : { value: after, alpha: 2 * q - 1 };
  }
  function stepHint(flow, index, done) {
    if (index < 0) return null;
    const s = flow.steps[index];
    const packet = s.packet || s.after.packet;
    const ip = packet?.dip || "";
    const hit = s.after.statuses[s.focus] === "缓存命中";
    const hint = {
      node: s.focus,
      kind: s.kind,
      surface: "device",
      label: s.title,
      detail: "",
      tone: "active",
      fields: [],
      network: null,
      out: null,
      paths: [],
    };
    if (s.kind === "decide") {
      hint.label = flow.mode === "cross" ? "跨网先找网关" : "同网直接交付";
      hint.detail = s.after.statuses[s.focus];
    } else if (s.kind === "lookup") {
      hint.surface = "cache";
      hint.label = done
        ? hit
          ? "缓存命中 · 免 ARP"
          : "缓存未命中"
        : "查 ARP 缓存";
      hint.detail = done
        ? hit
          ? "直接使用下一跳 MAC"
          : "需要先解析 MAC"
        : "查找下一跳 IP → MAC";
      hint.tone = done ? (hit ? "success" : "warning") : "active";
    } else if (s.kind === "learn") {
      hint.surface = "cache";
      hint.label = done ? "已写入 ARP 缓存" : "写入 ARP 缓存";
      hint.detail = `${packet.sip} → MAC`;
      hint.fields = ["sip", "smac"];
      hint.tone = done ? "success" : "active";
    } else if (s.kind === "request") {
      hint.label = "仅在本网段广播";
      hint.detail = `谁是 ${ip}`;
      hint.fields = ["dmac", "dip"];
      hint.paths = s.recipients.map((to) => path(flow.mode, s.from, to));
    } else if (s.kind === "reply" || s.kind === "send") {
      hint.label = s.kind === "reply" ? "ARP 单播应答" : "单播到下一跳";
      hint.detail = "只交给本跳接收者";
      hint.fields = ["dmac"];
      hint.paths = [path(flow.mode, s.from, s.to)];
    } else if (s.kind === "route") {
      hint.surface = "route";
      hint.label = done ? "命中直连路由" : "匹配目的网络";
      hint.detail = done ? `${s.after.route.out} → ${ip}` : `目的 ${ip}`;
      hint.fields = ["dip", "ttl"];
      hint.network = s.after.route.network;
      hint.out = s.to;
    } else if (s.kind === "encap" || s.kind === "strip") {
      hint.label =
        s.kind === "strip"
          ? "移除本跳帧头"
          : s.from === "r0" || s.from === "r1"
            ? "重建以太网头"
            : "封装以太网头";
      hint.detail =
        s.kind === "strip"
          ? "保留内部 IP 数据报"
          : s.from === "r0" || s.from === "r1"
            ? "MAC 重写 · IP 不变"
            : "目的 MAC = 下一跳";
      hint.fields = ["dmac", "smac"];
    } else if (s.kind === "deliver") {
      hint.label = done ? "数据已交付" : "交付目标主机";
      hint.detail = ip;
      hint.fields = ["dip"];
      hint.tone = done ? "success" : "active";
    }
    return hint;
  }
  function sampleStep(flow, index, p) {
    p = clamp(p);
    const step = flow.steps[index];
    const beforeCaption = index
      ? flow.steps[index - 1].caption
      : "选择流程，观察下一跳地址如何确定。";
    const traveling = isTransfer(step);
    const caption = textBlend(
      beforeCaption,
      step.caption,
      win(p, 0.02, traveling ? 0.12 : 0.22),
    );
    // A receive status is a receipt: never reveal it before the flight lands.
    const state = textBlend(
      step.before,
      step.after,
      traveling ? win(p, timing.flyEnd, timing.receiveEnd) : win(p, 0.44, 0.82),
    );
    const packet = textBlend(
      step.before.packet,
      step.after.packet,
      traveling
        ? win(p, 0.02, 0.06)
        : step.kind === "route"
          ? win(p, 0.44, 0.82)
          : win(p, 0.18, 0.42),
    );
    const tokens = [];
    if (traveling && p > timing.flyStart - 0.02 && p < timing.flyEnd + 0.02) {
      const recipients = step.kind === "request" ? step.recipients : [step.to];
      // Broadcast shares the source→switch trunk, then fans out on local links.
      const q = win(p, timing.flyStart, timing.flyEnd);
      const routes = recipients
        .map((to) => ({ to, points: path(flow.mode, step.from, to) }))
        .filter((r) => r.points.length);
      if (routes.length) {
        const trunk = [routes[0].points[0], routes[0].points[1]];
        if (step.kind === "request") {
          const trunkLength = Math.hypot(
            trunk[1][0] - trunk[0][0],
            trunk[1][1] - trunk[0][1],
          );
          const branchLength = Math.max(
            ...routes.map((r) =>
              Math.hypot(
                r.points[2][0] - r.points[1][0],
                r.points[2][1] - r.points[1][1],
              ),
            ),
          );
          const distance = q * (trunkLength + branchLength);
          if (distance < trunkLength)
            tokens.push({
              point: atPath(trunk, distance / trunkLength),
              type: "arp",
            });
          else
            routes.forEach((r) => {
              const len = Math.hypot(
                r.points[2][0] - r.points[1][0],
                r.points[2][1] - r.points[1][1],
              );
              if (distance - trunkLength <= len)
                tokens.push({
                  point: atPath(
                    r.points.slice(1),
                    (distance - trunkLength) / len,
                  ),
                  type: "arp",
                });
            });
        } else
          tokens.push({
            point: atPath(routes[0].points, q),
            type: step.kind === "reply" ? "arp" : "ip",
          });
      }
      tokens.forEach((token) => {
        token.alpha = Math.min(
          win(p, timing.flyStart - 0.02, timing.flyStart),
          1 - win(p, timing.flyEnd, timing.flyEnd + 0.02),
        );
      });
    }
    const liveHint = textBlend(
      stepHint(flow, index, false),
      stepHint(flow, index, true),
      win(p, 0.8, 0.98),
    );
    const hint = textBlend(
      stepHint(flow, index - 1, true),
      liveHint.value,
      win(p, 0, traveling ? 0.06 : 0.18),
    );
    hint.alpha *= p >= 0.18 ? liveHint.alpha : 1;
    const hasBefore = !!step.before.packet?.smac;
    const hasAfter = !!step.after.packet?.smac;
    const header =
      (hasBefore ? 1 : 0) +
      ((hasAfter ? 1 : 0) - (hasBefore ? 1 : 0)) *
        (traveling ? win(p, 0.02, 0.06) : win(p, 0.22, 0.7));
    return {
      hint,
      transportPhase: traveling
        ? p < timing.flyStart
          ? "核对地址"
          : p < timing.flyEnd
            ? "传输报文"
            : "到达留读"
        : null,
      snapshot: state.value,
      stateAlpha: state.alpha,
      packet: packet.value,
      packetAlpha: packet.alpha,
      headerAlpha: header,
      headerOffset: -12 * (1 - header),
      caption: caption.value,
      captionAlpha: caption.alpha,
      focus: step.focus,
      focusAlpha: p === 0 || p === 1 ? 0 : Math.sin(Math.PI * p) * 0.8,
      tokens,
      tag: step.tag || "",
      tagAlpha: win(p, 0.78, 0.9) * (1 - win(p, 0.94, 1)),
      index,
      p,
    };
  }
  function sample(flow, time, reduced = false) {
    const marks = boundaries(flow);
    const t = clamp(Number.isFinite(time) ? time : 0, 0, marks.at(-1));
    const index = Math.max(
      0,
      marks.slice(1).findIndex((end) => t <= end + 1e-8),
    );
    const p =
      t === 0 ? 0 : (t - marks[index]) / (marks[index + 1] - marks[index]);
    return sampleStep(flow, index, reduced && p > 0 ? 1 : p);
  }
  const addressKeys = ["sip", "smac", "dip", "dmac"];
  function rawAddressGuide(flow, index, p, devices) {
    if (index < 0) return null;
    const s = flow.steps[index];
    const frame = sampleStep(flow, index, p);
    let from = s.from,
      to = s.to;
    if (s.kind === "learn" || s.kind === "reply") {
      from = s.kind === "learn" ? s.focus : s.to;
      to = s.from;
    }
    if (s.kind === "route") {
      from = s.to;
      to = flow.target;
    }
    if (s.kind === "deliver") {
      const sent = flow.steps
        .slice(0, index)
        .reverse()
        .find((step) => step.kind === "send");
      from = sent.from;
      to = sent.to;
    }
    const ip = devices[to].ip;
    const entry = frame.snapshot.caches[from].find((item) => item.ip === ip);
    const offered = ["learn", "reply"].includes(s.kind);
    const mac = entry?.mac || (offered ? s.packet.smac : null);
    const mapping = {
      owner: devices[from].name,
      ip,
      mac,
      status: entry
        ? "已缓存"
        : offered
          ? "报文已给出 · 待写缓存"
          : "待 ARP 解析",
      statusAlpha: s.kind === "learn" ? frame.stateAlpha : 1,
      gateway: to === "r0" || to === "r1",
      note:
        to === "r0" || to === "r1"
          ? "网关 IP → 网关 MAC，不是远端 IP → 网关 MAC"
          : "ARP 将本链路 IP 解析为对应的 MAC",
    };
    let scan = { value: null, alpha: 1 };
    const transmitting = isTransfer(s);
    if (transmitting) {
      const arp = s.packet.type !== "IPv4";
      const notes = [
        arp ? "ARP 发送方的 IP 地址" : "端到端源 IP；转发时不变",
        "本跳发送接口的 MAC；本机地址无需 ARP 查询",
        s.kind === "request"
          ? "待解析的目标 IP；用它寻找对应 MAC"
          : arp
            ? "ARP 应答接收方的 IP，即原请求方"
            : "最终目的主机的 IP；不替换为网关 IP",
        s.kind === "request"
          ? "广播地址；目标 MAC 此时尚未解析"
          : s.kind === "reply"
            ? "单播回请求方，不再广播"
            : mapping.gateway
              ? "取网关的 MAC；目的 IP 仍是远端主机"
              : "由本链路下一跳 IP 的 ARP 映射取得",
      ];
      const scanAt = (i) =>
        i < 0
          ? null
          : {
              key: addressKeys[i],
              number: i + 1,
              label: ["源 IP", "源 MAC", "目的 IP", "目的 MAC"][i],
              note: notes[i],
            };
      if (p >= timing.scanStart) {
        const i = Math.min(
          3,
          Math.floor((p - timing.scanStart) / timing.scanStride),
        );
        const start = timing.scanStart + i * timing.scanStride;
        scan = textBlend(
          scanAt(i - 1),
          scanAt(i),
          win(p, start, start + timing.scanFade),
        );
      }
    }
    return { mapping, scan, transmitting };
  }
  function addressGuide(flow, index, p, devices) {
    p = clamp(p);
    const current = rawAddressGuide(flow, index, p, devices);
    const previous = rawAddressGuide(flow, index - 1, 1, devices);
    return textBlend(
      previous,
      current,
      win(p, 0, isTransfer(flow.steps[index]) ? 0.06 : 0.18),
    );
  }
  return {
    duration,
    timing,
    boundaries,
    positions,
    path,
    atPath,
    sampleStep,
    sample,
    textBlend,
    addressGuide,
  };
});
