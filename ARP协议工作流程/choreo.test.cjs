const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("./model.js");
const C = require("./choreo.js");
const ids = [...M.flows.same, ...M.flows.cross].map((f) => f.id);
const visible = (v) => ({
  snapshot: v.snapshot,
  stateAlpha: v.stateAlpha,
  packet: v.packet,
  packetAlpha: v.packetAlpha,
  headerAlpha: v.headerAlpha,
  headerOffset: v.headerOffset,
  caption: v.caption,
  captionAlpha: v.captionAlpha,
  tokens: v.tokens,
  hint: v.hint,
});

test("每步终点与下步起点的持久画面完全一致", () => {
  ids.forEach((id) => {
    const f = M.buildFlow(id);
    assert.deepEqual(C.sample(f, 0).snapshot, f.initial);
    f.steps.slice(0, -1).forEach((_, i) => {
      const end = C.sampleStep(f, i, 1),
        start = C.sampleStep(f, i + 1, 0);
      assert.deepEqual(visible(end), visible(start), `${id} step ${i}`);
      assert.ok(Math.abs(end.focusAlpha) < 1e-12);
      assert.equal(end.tagAlpha, 0);
    });
    assert.equal(C.sample(f, C.boundaries(f).at(-1)).snapshot.delivered, true);
  });
});

test("随机跳转与倒退无历史依赖，采样不更改协议模型", () => {
  ids.forEach((id) => {
    const f = M.buildFlow(id),
      original = JSON.stringify(f);
    const sample = C.sample(f, C.duration * 2.63);
    C.sample(f, C.boundaries(f).at(-1));
    C.sample(f, 0);
    C.sample(f, C.duration * 4.8);
    assert.deepEqual(C.sample(f, C.duration * 2.63), sample);
    assert.equal(JSON.stringify(f), original);
    assert.deepEqual(C.sample(f, -20).snapshot, f.initial);
    assert.deepEqual(C.sample(f, Infinity).snapshot, f.initial);
  });
});

test("广播芯片局限于本子网，沿交换机链路传播，边界无遗留芯片", () => {
  ids.forEach((id) => {
    const f = M.buildFlow(id);
    f.steps.forEach((step, i) => {
      if (!["request", "reply", "send"].includes(step.kind)) return;
      assert.equal(C.sampleStep(f, i, 0).tokens.length, 0);
      assert.equal(C.sampleStep(f, i, 1).tokens.length, 0);
      for (const p of [0.67, 0.72, 0.78]) {
        const v = C.sampleStep(f, i, p);
        assert.ok(v.tokens.length > 0);
        v.tokens.forEach((token) => {
          assert.ok(token.point.every(Number.isFinite));
          if (f.mode === "cross")
            assert.ok(
              M.devices[step.from].subnet === "left"
                ? token.point[0] <= 432
                : token.point[0] >= 688,
            );
        });
      }
    });
  });
  assert.deepEqual(C.path("cross", "a", "c"), []);
});

test("广播接收状态在飞行落地之后才出现", () => {
  const f = M.buildFlow("cross-1");
  const i = f.steps.findIndex((s) => s.kind === "request");
  assert.deepEqual(C.sampleStep(f, i, 0.81).snapshot, f.steps[i].before);
  assert.deepEqual(C.sampleStep(f, i, 0.99).snapshot, f.steps[i].after);
});

test("减少动效采样只显示完整事件快照，保留初态与终态", () => {
  const f = M.buildFlow("cross-1");
  assert.deepEqual(C.sample(f, 0, true).snapshot, f.initial);
  assert.deepEqual(
    C.sample(f, C.duration * 0.4, true).snapshot,
    f.steps[0].after,
  );
  assert.equal(C.sample(f, C.duration * 0.4, true).tokens.length, 0);
});

test("视觉提示在单步终点保留，减少动效也可见，结果不提前揭示", () => {
  const f = M.buildFlow("cross-1");
  const lookup = f.steps.findIndex((s) => s.kind === "lookup");
  assert.equal(C.sampleStep(f, lookup, 0.4).hint.value.label, "查 ARP 缓存");
  const end = C.sampleStep(f, lookup, 1).hint;
  assert.equal(end.value.label, "缓存未命中");
  assert.equal(end.value.surface, "cache");
  assert.equal(end.alpha, 1);
  assert.deepEqual(C.sample(f, C.boundaries(f)[lookup + 1], true).hint, end);
  const route = f.steps.findIndex((s) => s.kind === "route");
  const hint = C.sampleStep(f, route, 1).hint.value;
  assert.deepEqual(hint.fields, ["dip", "ttl"]);
  assert.equal(hint.out, "r1");
  assert.equal(hint.network, "192.168.2.0/24");
});

test("传输逐一提醒源IP、源MAC、目的IP、目的MAC，提示可逆且边界连续", () => {
  ids.forEach((id) => {
    const f = M.buildFlow(id);
    f.steps.forEach((s, i) => {
      if (["request", "reply", "send"].includes(s.kind)) {
        const keys = [0.16, 0.3, 0.44, 0.58].map(
          (p) => C.addressGuide(f, i, p, M.devices).value.scan.value.key,
        );
        assert.deepEqual(keys, ["sip", "smac", "dip", "dmac"]);
        assert.deepEqual(C.sampleStep(f, i, 0.24).packet, s.packet);
      }
      if (i > 0)
        assert.deepEqual(
          C.addressGuide(f, i - 1, 1, M.devices),
          C.addressGuide(f, i, 0, M.devices),
        );
    });
  });
});

test("先读地址再传输，留出接收阅读时间；变长步骤仍精确定位", () => {
  const f = M.buildFlow("cross-1");
  const marks = C.boundaries(f);
  assert.equal(marks.length, f.steps.length + 1);
  f.steps.forEach((step, i) => {
    const travel = ["request", "reply", "send"].includes(step.kind);
    const seconds = marks[i + 1] - marks[i];
    assert.ok(Math.abs(seconds - (travel ? 9 : 3.6)) < 1e-8);
    assert.equal(C.sample(f, marks[i] + seconds * 0.5).index, i);
    assert.deepEqual(C.sample(f, marks[i + 1]).snapshot, step.after);
    if (!travel) return;
    assert.equal(C.sampleStep(f, i, 0.6).tokens.length, 0);
    assert.equal(C.sampleStep(f, i, 0.6).transportPhase, "核对地址");
    assert.equal(C.sampleStep(f, i, 0.72).transportPhase, "传输报文");
    assert.equal(C.sampleStep(f, i, 0.95).transportPhase, "到达留读");
    assert.ok(C.timing.scanStride * seconds >= 1.2);
    assert.ok((1 - C.timing.receiveEnd) * seconds > 0.85);
  });
  assert.equal(C.timing.reducedHold, 2.4);
  ids.forEach(id => {
    const ends = C.boundaries(M.buildFlow(id));
    ends.forEach(t => assert.equal(t, Number(t.toFixed(3)), "步骤边界须与毫秒精度滑块一致"));
  });
});

test("映射明确展示实际IP→MAC，跨网首跳解析网关而不是远端IP", () => {
  const f = M.buildFlow("cross-1");
  const lookup = f.steps.findIndex((s) => s.kind === "lookup");
  assert.equal(C.addressGuide(f, lookup, 1, M.devices).value.mapping.mac, null);
  const learn = f.steps.findIndex((s) => s.kind === "learn" && s.focus === "a");
  const learned = C.addressGuide(f, learn, 1, M.devices).value.mapping;
  assert.equal(learned.ip, M.devices.r0.ip);
  assert.equal(learned.mac, M.devices.r0.mac);
  const sends = f.steps
    .map((s, i) => (s.kind === "send" ? i : -1))
    .filter((i) => i >= 0);
  const first = C.addressGuide(f, sends[0], 1, M.devices).value.mapping;
  assert.equal(first.ip, M.devices.r0.ip);
  assert.equal(first.mac, M.devices.r0.mac);
  assert.notEqual(first.ip, f.steps[sends[0]].packet.dip);
  const second = C.addressGuide(f, sends[1], 1, M.devices).value.mapping;
  assert.equal(second.ip, M.devices.c.ip);
  assert.equal(second.mac, M.devices.c.mac);
});

test("折线路径按弧长匀速插值，封装与拆帧有可逆中间状态", () => {
  assert.deepEqual(
    C.atPath(
      [
        [0, 0],
        [10, 0],
        [10, 30],
      ],
      0.5,
    ),
    [10, 10],
  );
  const f = M.buildFlow("same-1");
  const i = f.steps.findIndex((s) => s.kind === "strip");
  const mid = C.sampleStep(f, i, 0.46);
  assert.ok(mid.headerAlpha > 0 && mid.headerAlpha < 1);
  assert.equal(C.sampleStep(f, i, 1).headerAlpha, 0);
  assert.deepEqual(C.sampleStep(f, i, 0).snapshot, f.steps[i].before);
});
