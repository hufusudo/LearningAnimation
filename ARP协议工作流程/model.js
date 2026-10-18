(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ARPModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const devices = {
    h1: {
      name: "H1",
      ip: "192.168.1.10",
      mac: "02:00:00:00:01:10",
      subnet: "left",
    },
    h2: {
      name: "H2",
      ip: "192.168.1.20",
      mac: "02:00:00:00:01:20",
      subnet: "left",
    },
    h3: {
      name: "H3",
      ip: "192.168.1.30",
      mac: "02:00:00:00:01:30",
      subnet: "left",
    },
    h4: {
      name: "H4",
      ip: "192.168.1.40",
      mac: "02:00:00:00:01:40",
      subnet: "left",
    },
    a: {
      name: "A",
      ip: "192.168.1.10",
      mac: "02:00:00:00:02:10",
      subnet: "left",
    },
    b: {
      name: "B",
      ip: "192.168.1.20",
      mac: "02:00:00:00:02:20",
      subnet: "left",
    },
    r0: {
      name: "R · eth0",
      ip: "192.168.1.1",
      mac: "02:00:00:00:02:01",
      subnet: "left",
    },
    r1: {
      name: "R · eth1",
      ip: "192.168.2.1",
      mac: "02:00:00:00:03:01",
      subnet: "right",
    },
    c: {
      name: "C",
      ip: "192.168.2.10",
      mac: "02:00:00:00:03:10",
      subnet: "right",
    },
    d: {
      name: "D",
      ip: "192.168.2.20",
      mac: "02:00:00:00:03:20",
      subnet: "right",
    },
  };

  const flows = {
    same: [
      { id: "same-1", label: "冷缓存 · H1 → H2", note: "初始缓存为空" },
      { id: "same-2", label: "冷缓存 · H3 → H4", note: "独立冷启动，缓存为空" },
      { id: "same-3", label: "热缓存 · H2 → H1", note: "预置双向缓存" },
    ],
    cross: [
      { id: "cross-1", label: "冷缓存 · A → C", note: "初始缓存为空" },
      {
        id: "cross-2",
        label: "网关预置 · B → D",
        note: "独立预置：B 已知 R · eth0",
      },
      {
        id: "cross-3",
        label: "双向缓存 · C → A",
        note: "预置 C↔R · eth1、R · eth0↔A",
      },
    ],
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const hostsFor = (id) =>
    id.startsWith("same")
      ? ["h1", "h2", "h3", "h4"]
      : ["a", "b", "r0", "r1", "c", "d"];
  const ipPacket = (source, target, ttl) => ({
    type: "IPv4",
    smac: null,
    dmac: null,
    sip: devices[source].ip,
    dip: devices[target].ip,
    ttl,
    opcode: null,
    etherType: "0x0800",
  });

  function buildFlow(id) {
    const definition = [...flows.same, ...flows.cross].find(
      (flow) => flow.id === id,
    );
    if (!definition) throw new RangeError(`未知流程 id: ${id}`);
    const cross = id.startsWith("cross");
    const mode = cross ? "cross" : "same";
    const [source, target] =
      id === "same-1"
        ? ["h1", "h2"]
        : id === "same-2"
          ? ["h3", "h4"]
          : id === "same-3"
            ? ["h2", "h1"]
            : id === "cross-1"
              ? ["a", "c"]
              : id === "cross-2"
                ? ["b", "d"]
                : ["c", "a"];
    const participants = hostsFor(id);
    const caches = Object.fromEntries(participants.map((key) => [key, []]));
    const statuses = Object.fromEntries(
      participants.map((key) => [key, "待机"]),
    );
    const state = {
      caches,
      statuses,
      packet: null,
      route: null,
      delivered: false,
    };
    const steps = [];
    const destinationMac = (key) => devices[key].mac;
    const findCache = (owner, ip) =>
      state.caches[owner].find((entry) => entry.ip === ip);
    const learn = (owner, key) => {
      const entry = { ip: devices[key].ip, mac: devices[key].mac };
      const existing = state.caches[owner].findIndex(
        (item) => item.ip === entry.ip,
      );
      if (existing < 0) state.caches[owner].push(entry);
      else state.caches[owner][existing] = entry;
    };
    const step = (
      title,
      phase,
      caption,
      focus,
      tag,
      kind,
      from,
      to,
      recipients,
      packet,
      mutate,
    ) => {
      const before = clone(state);
      mutate();
      const after = clone(state);
      steps.push({
        title,
        phase,
        caption,
        focus,
        tag,
        kind,
        from: from || null,
        to: to || null,
        recipients: recipients || [],
        packet: packet ? clone(packet) : null,
        before,
        after,
      });
    };
    const getNextHop = (owner, dest) =>
      cross
        ? devices[owner].subnet === devices[dest].subnet
          ? dest
          : devices[owner].subnet === "left"
            ? "r0"
            : "r1"
        : dest;
    const requestRecipients = (owner, nextHop, firstLeg) => {
      if (mode === "same") return participants.filter((key) => key !== owner);
      const leftSide = devices[owner].subnet === "left";
      if (firstLeg)
        return leftSide
          ? [owner === "a" ? "b" : "a", "r0"]
          : [owner === "c" ? "d" : "c", "r1"];
      return leftSide ? ["a", "b"] : ["c", "d"];
    };
    const sendArpResolution = (owner, nextHop, firstLeg) => {
      const request = {
        type: "ARP 请求",
        smac: destinationMac(owner),
        dmac: "ff:ff:ff:ff:ff:ff",
        sip: devices[owner].ip,
        dip: devices[nextHop].ip,
        ttl: null,
        opcode: 1,
        etherType: "0x0806",
      };
      const recipients = requestRecipients(owner, nextHop, firstLeg);
      step(
        "ARP 请求",
        "解析",
        `${devices[owner].name} 广播查询 ${devices[nextHop].ip}`,
        owner,
        "广播",
        "request",
        owner,
        nextHop,
        recipients,
        request,
        () => {
          state.packet = clone(request);
          state.statuses[owner] = "请求已广播";
          for (const recipient of recipients)
            state.statuses[recipient] =
              recipient === nextHop ? "ARP目标匹配" : "收到广播·不应答";
        },
      );
      // 只展示目标节点学习请求发送方；广播接收者无需硬件丢弃步骤。
      step(
        "目标学习",
        "学习",
        `${devices[nextHop].name} 记录请求方地址`,
        nextHop,
        "写入缓存",
        "learn",
        owner,
        nextHop,
        [],
        request,
        () => {
          learn(nextHop, owner);
          state.statuses[nextHop] = "已学习";
        },
      );
      const reply = {
        type: "ARP 应答",
        smac: destinationMac(nextHop),
        dmac: destinationMac(owner),
        sip: devices[nextHop].ip,
        dip: devices[owner].ip,
        ttl: null,
        opcode: 2,
        etherType: "0x0806",
      };
      step(
        "ARP 应答",
        "返回",
        `${devices[nextHop].name} 单播自己的 MAC`,
        nextHop,
        "单播",
        "reply",
        nextHop,
        owner,
        [],
        reply,
        () => {
          state.packet = clone(reply);
        },
      );
      step(
        "发起者学习",
        "学习",
        `${devices[owner].name} 缓存下一跳 MAC`,
        owner,
        "写入缓存",
        "learn",
        nextHop,
        owner,
        [],
        reply,
        () => {
          learn(owner, nextHop);
          state.statuses[owner] = "缓存已更新";
        },
      );
    };

    const initialEntries = [];
    if (id === "same-3") {
      initialEntries.push(["h2", "h1"], ["h1", "h2"]);
    }
    if (id === "cross-2") initialEntries.push(["b", "r0"]);
    if (id === "cross-3")
      initialEntries.push(["c", "r1"], ["r1", "c"], ["r0", "a"], ["a", "r0"]);
    for (const [owner, known] of initialEntries) learn(owner, known);
    const initial = clone(state);

    const initialHop = getNextHop(source, target);
    const decisionCaption = cross
      ? `目标${devices[target].ip}异网，网关${devices[initialHop].ip}`
      : `目标${devices[target].ip}同网，直达目标`;
    step(
      "选择下一跳",
      "判断",
      decisionCaption,
      source,
      cross ? "经网关" : "同一网段",
      "decide",
      source,
      initialHop,
      [],
      null,
      () => {
        state.statuses[source] = `下一跳 ${devices[initialHop].ip}`;
      },
    );

    let current = source;
    let nextHop = getNextHop(current, target);
    const resolve = (owner, hop, firstLeg) => {
      step(
        "查询缓存",
        "查询",
        findCache(owner, devices[hop].ip)
          ? "缓存命中，取得下一跳 MAC"
          : "缓存未命中，需要 ARP 解析",
        owner,
        findCache(owner, devices[hop].ip) ? "命中" : "未命中",
        "lookup",
        owner,
        hop,
        [],
        null,
        () => {
          state.statuses[owner] = findCache(owner, devices[hop].ip)
            ? "缓存命中"
            : "等待解析";
        },
      );
      if (!findCache(owner, devices[hop].ip))
        sendArpResolution(owner, hop, firstLeg);
    };
    resolve(current, nextHop, true);

    const encapsulateAndSend = (owner, hop, ttl, titlePrefix) => {
      const mac = findCache(owner, devices[hop].ip).mac;
      const frame = {
        type: "IPv4",
        smac: destinationMac(owner),
        dmac: mac,
        sip: devices[source].ip,
        dip: devices[target].ip,
        ttl,
        opcode: null,
        etherType: "0x0800",
      };
      step(
        `${titlePrefix}封装`,
        "封装",
        `端到端 IP 不变，帧交给 ${devices[hop].name}`,
        owner,
        "IPv4 帧",
        "encap",
        owner,
        hop,
        [],
        frame,
        () => {
          state.packet = clone(frame);
          state.statuses[owner] = "已封装";
        },
      );
      step(
        `${titlePrefix}发送`,
        "传送",
        `以太网单播至 ${devices[hop].name}`,
        owner,
        "单播",
        "send",
        owner,
        hop,
        [],
        frame,
        () => {
          state.statuses[owner] = "已发送";
        },
      );
    };
    encapsulateAndSend(current, nextHop, 64, "");

    if (!cross) {
      step(
        "去掉帧头",
        "接收",
        "目标网卡取出端到端 IPv4 数据报",
        target,
        "拆帧",
        "strip",
        source,
        target,
        [],
        ipPacket(source, target, 64),
        () => {
          state.packet = ipPacket(source, target, 64);
          state.statuses[target] = "收到数据";
        },
      );
      step(
        "交付目标",
        "交付",
        `${devices[target].name} 收到发往自己的数据`,
        target,
        "完成",
        "deliver",
        target,
        target,
        [],
        state.packet,
        () => {
          state.delivered = true;
          state.statuses[target] = "已交付";
        },
      );
    } else {
      const gateway = nextHop;
      step(
        "去掉帧头",
        "接收",
        "路由器移除旧帧头，IP 数据报 TTL 仍为 64",
        gateway,
        "拆帧",
        "strip",
        source,
        gateway,
        [],
        ipPacket(source, target, 64),
        () => {
          state.packet = ipPacket(source, target, 64);
          state.statuses[gateway] = "收到IPv4";
        },
      );
      step(
        "路由转发",
        "路由",
        `路由器选择 ${devices[target].subnet === "right" ? "192.168.2.0/24" : "192.168.1.0/24"}，TTL 减 1`,
        gateway,
        "TTL −1",
        "route",
        gateway,
        devices[target].subnet === "right" ? "r1" : "r0",
        [],
        ipPacket(source, target, 63),
        () => {
          current = devices[target].subnet === "right" ? "r1" : "r0";
          state.packet = ipPacket(source, target, 63);
          state.route = {
            network:
              devices[target].subnet === "right"
                ? "192.168.2.0/24"
                : "192.168.1.0/24",
            out: current === "r1" ? "eth1" : "eth0",
            nextHop: devices[target].ip,
          };
          state.statuses[gateway] = "已查路由";
        },
      );
      nextHop = target;
      resolve(current, nextHop, false);
      encapsulateAndSend(current, nextHop, 63, "重新");
      step(
        "去掉帧头",
        "接收",
        "目标网卡取出 IPv4 数据报，IP 未改变",
        target,
        "拆帧",
        "strip",
        current,
        target,
        [],
        ipPacket(source, target, 63),
        () => {
          state.packet = ipPacket(source, target, 63);
          state.statuses[target] = "收到数据";
        },
      );
      step(
        "交付目标",
        "交付",
        `${devices[target].name} 收到发往自己的数据`,
        target,
        "完成",
        "deliver",
        target,
        target,
        [],
        state.packet,
        () => {
          state.delivered = true;
          state.statuses[target] = "已交付";
        },
      );
    }
    return { id, mode, source, target, initial, steps };
  }

  return { devices, flows, buildFlow };
});
