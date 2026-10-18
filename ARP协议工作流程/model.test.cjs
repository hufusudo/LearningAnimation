const test = require("node:test");
const assert = require("node:assert/strict");
const { devices, flows, buildFlow } = require("./model.js");

const ids = [...flows.same, ...flows.cross].map((flow) => flow.id);
test("六条流程均可独立构建，字段和每步快照连续", () => {
  assert.deepEqual(ids, [
    "same-1",
    "same-2",
    "same-3",
    "cross-1",
    "cross-2",
    "cross-3",
  ]);
  for (const id of ids) {
    const flow = buildFlow(id);
    assert.equal(flow.id, id);
    assert.equal(flow.mode, id.startsWith("same") ? "same" : "cross");
    assert.deepEqual(Object.keys(flow.initial).sort(), [
      "caches",
      "delivered",
      "packet",
      "route",
      "statuses",
    ]);
    assert.equal(flow.initial.packet, null);
    assert.equal(flow.initial.route, null);
    assert.equal(flow.initial.delivered, false);
    let previous = flow.initial;
    for (const item of flow.steps) {
      assert.deepEqual(item.before, previous);
      assert.deepEqual(
        item.before,
        item === flow.steps[0]
          ? flow.initial
          : flow.steps[flow.steps.indexOf(item) - 1].after,
      );
      assert.notEqual(item.before, previous);
      assert.notEqual(item.before.caches, item.after.caches);
      assert.ok(item.title && item.focus in devices);
      assert.ok(item.phase.length >= 2 && item.phase.length <= 4);
      assert.ok(item.caption.length <= 40);
      assert.ok(item.tag.length <= 8);
      assert.ok(
        [
          "decide",
          "lookup",
          "request",
          "reply",
          "learn",
          "encap",
          "send",
          "strip",
          "route",
          "deliver",
        ].includes(item.kind),
      );
      assert.ok(item.from === null || item.from in devices);
      assert.ok(item.to === null || item.to in devices);
      assert.ok(Array.isArray(item.recipients));
      previous = item.after;
    }
    assert.equal(previous.delivered, true);
    // 快照不共享可变对象；重复构建不受其他流程的运行历史影响。
    const second = buildFlow(id);
    assert.deepEqual(second.initial, flow.initial);
    assert.deepEqual(second.steps, flow.steps);
    if (flow.steps.length > 1)
      assert.notEqual(flow.steps[0].after, flow.steps[1].before);
  }
});

test("预置缓存精确，冷流程无缓存且不继承历史", () => {
  for (const id of ["same-1", "same-2", "cross-1"]) {
    const flow = buildFlow(id);
    assert.ok(
      Object.values(flow.initial.caches).every(
        (entries) => entries.length === 0,
      ),
    );
  }
  assert.deepEqual(buildFlow("same-3").initial.caches.h2, [
    { ip: devices.h1.ip, mac: devices.h1.mac },
  ]);
  assert.deepEqual(buildFlow("same-3").initial.caches.h1, [
    { ip: devices.h2.ip, mac: devices.h2.mac },
  ]);
  assert.deepEqual(buildFlow("cross-2").initial.caches.b, [
    { ip: devices.r0.ip, mac: devices.r0.mac },
  ]);
  const cross3 = buildFlow("cross-3").initial.caches;
  assert.deepEqual(cross3.c, [{ ip: devices.r1.ip, mac: devices.r1.mac }]);
  assert.deepEqual(cross3.r1, [{ ip: devices.c.ip, mac: devices.c.mac }]);
  assert.deepEqual(cross3.r0, [{ ip: devices.a.ip, mac: devices.a.mac }]);
  assert.deepEqual(cross3.a, [{ ip: devices.r0.ip, mac: devices.r0.mac }]);
});

test("ARP 广播范围、请求广播 MAC、应答单播 MAC 与缓存命中路径", () => {
  for (const id of ["same-1", "same-2"]) {
    const f = buildFlow(id);
    const request = f.steps.find((step) => step.kind === "request");
    assert.deepEqual(
      request.recipients,
      ["h1", "h2", "h3", "h4"].filter((key) => key !== f.source),
    );
    assert.equal(request.packet.dmac, "ff:ff:ff:ff:ff:ff");
    assert.equal(request.after.statuses[request.to], "ARP目标匹配");
    for (const key of request.recipients.filter((key) => key !== request.to))
      assert.equal(request.after.statuses[key], "收到广播·不应答");
    assert.equal(request.after.statuses[f.source], "请求已广播");
    const reply = f.steps.find((step) => step.kind === "reply");
    assert.equal(reply.packet.dmac, devices[f.source].mac);
  }
  const first = buildFlow("cross-1").steps.filter(
    (step) => step.kind === "request",
  );
  assert.deepEqual(
    first.map((step) => step.recipients),
    [
      ["b", "r0"],
      ["c", "d"],
    ],
  );
  assert.ok(first.every((step) => step.packet.dmac === "ff:ff:ff:ff:ff:ff"));
  for (const request of first) {
    assert.equal(request.after.statuses[request.to], "ARP目标匹配");
    for (const key of request.recipients.filter((key) => key !== request.to))
      assert.equal(request.after.statuses[key], "收到广播·不应答");
  }
  assert.equal(
    buildFlow("same-3").steps.filter((step) => step.kind === "request").length,
    0,
  );
  const gatewayPreset = buildFlow("cross-2");
  assert.deepEqual(
    gatewayPreset.steps
      .filter((step) => step.kind === "request")
      .map((step) => step.from),
    ["r1"],
  );
  assert.equal(
    buildFlow("cross-3").steps.filter((step) => step.kind === "request").length,
    0,
  );
});

test("IPv4 地址端到端不变，逐跳 MAC、TTL 和路由出口正确", () => {
  for (const id of ids) {
    const f = buildFlow(id);
    const expectedTtl = f.mode === "same" ? [64] : [64, 63];
    const frames = f.steps.filter((step) => step.kind === "encap");
    assert.deepEqual(
      frames.map((step) => step.packet.ttl),
      expectedTtl,
    );
    for (const frame of frames) {
      assert.equal(frame.packet.sip, devices[f.source].ip);
      assert.equal(frame.packet.dip, devices[f.target].ip);
      assert.equal(frame.packet.smac, devices[frame.from].mac);
      assert.equal(frame.packet.dmac, devices[frame.to].mac);
      assert.equal(frame.packet.etherType, "0x0800");
      assert.equal(frame.packet.opcode, null);
    }
    for (const step of f.steps.filter((item) => item.kind === "send"))
      assert.equal(step.packet.dmac, devices[step.to].mac);
    for (const step of f.steps.filter((item) => item.kind === "strip")) {
      assert.equal(step.packet.smac, null);
      assert.equal(step.packet.dmac, null);
      assert.equal(step.packet.sip, devices[f.source].ip);
      assert.equal(step.packet.dip, devices[f.target].ip);
    }
    const arp = f.steps.filter(
      (step) => step.kind === "request" || step.kind === "reply",
    );
    for (const item of arp) {
      assert.equal(item.packet.ttl, null);
      assert.equal(item.packet.etherType, "0x0806");
      assert.equal(item.packet.opcode, item.kind === "request" ? 1 : 2);
      assert.equal(item.packet.sip, devices[item.from].ip);
      assert.equal(item.packet.dip, devices[item.to].ip);
    }
    if (f.mode === "cross") {
      const route = f.steps.find((step) => step.kind === "route");
      assert.equal(
        route.after.route.network,
        f.target === "c" || f.target === "d"
          ? "192.168.2.0/24"
          : "192.168.1.0/24",
      );
      assert.equal(
        route.after.route.out,
        f.target === "c" || f.target === "d" ? "eth1" : "eth0",
      );
      assert.equal(route.after.route.nextHop, devices[f.target].ip);
      assert.equal(route.after.packet.ttl, 63);
      const precedingStrip = f.steps[f.steps.indexOf(route) - 1];
      assert.equal(precedingStrip.kind, "strip");
      assert.equal(precedingStrip.packet.ttl, 64);
      assert.equal(precedingStrip.after.packet.ttl, 64);
      assert.equal(route.before.packet.ttl, 64);
      assert.equal(route.after.packet.ttl, 63);
      assert.equal(route.after.packet.sip, devices[f.source].ip);
      assert.equal(route.after.packet.dip, devices[f.target].ip);
    }
  }
});

test("设备地址合法唯一，非法 id 明确抛出 RangeError", () => {
  const macs = Object.values(devices).map((device) => device.mac);
  assert.equal(new Set(macs).size, macs.length);
  for (const device of Object.values(devices)) {
    assert.match(device.mac, /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i);
    assert.match(device.ip, /^(?:\d{1,3}\.){3}\d{1,3}$/);
  }
  assert.throws(() => buildFlow("invalid"), RangeError);
});

test("浏览器普通 script 暴露同一 API", () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const context = {};
  vm.runInNewContext(
    fs.readFileSync(require.resolve("./model.js"), "utf8"),
    context,
  );
  assert.deepEqual(Object.keys(context.ARPModel).sort(), [
    "buildFlow",
    "devices",
    "flows",
  ]);
  assert.equal(
    context.ARPModel.buildFlow("cross-1").steps.at(-1).kind,
    "deliver",
  );
});
