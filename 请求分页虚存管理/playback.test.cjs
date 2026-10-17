'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Model = require('./model.js');
const { createController } = require('./app.js');

function load(options = {}) {
  const frames = new Map();
  let nextId = 0, renders = 0;
  const controller = createController(Model, {
    autoplay: true,
    requestFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
    onRender() { renders++; },
    ...options
  });
  controller.start();
  return {
    controller, frames,
    renders: () => renders,
    frame(now) {
      const current = [...frames];
      frames.clear();
      current.forEach(([, callback]) => callback(now));
    },
    completeOneStep() {
      controller.next();
      for (let i = 0; i < 100 && controller.state().singleStepping; i++) controller.advance(80);
      assert.equal(controller.state().singleStepping, false, '单步应在动作到达并停留后结束');
    }
  };
}

// 保留原控制器的六组回归语义；新版通过纯快照而非 VM 中的 DOM 回调验证。
test('暂停冻结步骤和数据包进度，倍速只作用一次', () => {
  const { controller: c } = load();
  c.setScenario('C'); c.advance(200);
  const before = c.state().time;
  const beforePacket = c.sample().travelProgress;
  c.pause(); c.advance(500);
  assert.equal(c.state().time, before);
  assert.equal(c.sample().travelProgress, beforePacket);
  c.setSpeed(2); assert.equal(c.state().time, before);
  c.play(); c.advance(100);
  assert.equal(c.state().time, before + 200);
});

test('三条路径都完成正确读取，主存读取次数区分 TLB', () => {
  for (const [key, value, reads] of [['A', '0xCAFE', 1], ['B', '0x5A5A', 2], ['C', '0xBEEF', 2]]) {
    const h = load({ autoplay: false }); const c = h.controller;
    c.setScenario(key, false);
    for (let guard = 0; guard < 30 && !c.sample().complete; guard++) h.completeOneStep();
    assert.equal(c.sample().complete, true);
    assert.equal(c.sample().r0, value);
    assert.equal(c.sample().counters.memoryReads, reads);
  }
});

test('缺页先调入页面再更新有效位，最后重执', () => {
  const h = load({ autoplay: false }); const c = h.controller;
  c.setScenario('C', false);
  while (!c.sample().frames[6].occupied) h.completeOneStep();
  assert.equal(c.sample().pt[3].v, 0);
  assert.equal(c.sample().r0, null);
  h.completeOneStep();
  assert.equal(c.sample().pt[3].v, 1);
  assert.equal(c.sample().pt[3].f, 6);
  while (!c.sample().complete) h.completeOneStep();
  assert.equal(c.sample().tlb[3].f, 6);
  assert.equal(c.sample().r0, '0xBEEF');
});

test('中途切换场景清除旧步骤及缺页状态', () => {
  const h = load(); const c = h.controller;
  c.setScenario('C');
  for (let i = 0; i < 4; i++) h.completeOneStep();
  assert.equal(c.sample().fault, true);
  c.setScenario('A');
  assert.equal(c.state().time, 0);
  assert.equal(c.sample().stepIndex, 0);
  assert.equal(c.state().plan.key, 'A');
  assert.equal(c.sample().cpuMode, 'user');
  assert.equal(c.sample().pt[3].v, 1);
  assert.equal(c.sample().counters.memoryReads, 0);
  assert.equal(c.sample().logs.length, 0);
  assert.equal(h.frames.size, 0, '切换仍保持用户的暂停状态');
});

test('所有倍速下自动播放均先完成当前场景，再进入下一个', () => {
  for (const speed of [0.5, 1, 1.5, 2]) {
    const { controller: c } = load();
    c.setScenario('C'); c.setSpeed(speed);
    for (let i = 0; i < 2000 && !c.sample().complete; i++) c.advance(80);
    assert.equal(c.sample().complete, true);
    assert.equal(c.sample().r0, '0xBEEF');
    assert.equal(c.sample().counters.memoryReads, 2);
    c.pause();
    for (let i = 0; i < 100; i++) c.advance(80);
    assert.equal(c.state().plan.key, 'C');
    c.play();
    for (let i = 0; i < 100 && c.state().plan.key === 'C'; i++) c.advance(80);
    assert.equal(c.state().plan.key, 'A');
  }
});

test('单步保留到达结果，暂停期间不提前读取或重复记账', () => {
  const h = load(); const c = h.controller;
  h.completeOneStep(); h.completeOneStep();
  assert.equal(c.sample().stepIndex, 1);
  assert.equal(c.sample().logs.length, 1);
  for (let i = 0; i < 50; i++) c.advance(80);
  assert.equal(c.sample().stepIndex, 1);
  assert.equal(c.sample().logs.length, 1);
  assert.equal(c.sample().counters.memoryReads, 0);
  h.completeOneStep(); c.next(); c.advance(100);
  assert.equal(c.sample().counters.memoryReads, 0);
  for (let i = 0; i < 40; i++) c.advance(80);
  assert.equal(c.sample().counters.memoryReads, 1);
  assert.equal(c.sample().r0, null);
});

test('回退与任意定位精确恢复硬件、日志和计数，不依赖访问顺序', () => {
  const { controller: c } = load();
  c.setScenario('C');
  const plan = c.state().plan;
  const update = plan.steps.find(s => s.id === 'update-pte');
  c.seek(update.start + update.travel);
  const after = c.sample();
  assert.equal(after.pt[3].v, 1);
  c.previous();
  assert.equal(c.sample().step.id, 'page-in');
  assert.equal(c.sample().pt[3].v, 0);
  assert.equal(c.sample().frames[6].occupied, true);
  c.seek(0); assert.equal(c.sample().frames[6].occupied, false);
  c.seek(plan.duration); c.seek(update.start + update.travel);
  assert.deepEqual(c.sample(), after);
  c.seek(NaN); assert.equal(c.state().time, 0);
  c.seek(-100); assert.equal(c.state().time, 0);
  c.seek(Infinity); assert.equal(c.state().time, plan.duration);
});

test('快速控制与换场景最多保留一个帧请求，暂停和销毁不继续绘制', () => {
  const h = load(); const c = h.controller;
  assert.equal(h.frames.size, 1);
  c.play(); c.play(); assert.equal(h.frames.size, 1);
  h.frame(0); h.frame(80); assert.equal(c.state().time, 80);
  c.setScenario('B'); c.setScenario('C'); assert.equal(h.frames.size, 1);
  c.pause(); assert.equal(h.frames.size, 0);
  const renders = h.renders(); h.frame(1000); assert.equal(h.renders(), renders);
  c.play(); h.frame(2000); h.frame(2080); assert.equal(c.state().time, 80);
  c.next(); c.next(); assert.equal(h.frames.size, 1);
  c.destroy(); assert.equal(h.frames.size, 0);
  const time = c.state().time; c.advance(1000); c.play(); assert.equal(c.state().time, time);
  assert.equal(h.frames.size, 0);
});

test('关闭自动切换后终点停住，重播和继续均能重新查看本场景', () => {
  const { controller: c } = load({ autoCycle: false });
  c.seek(c.state().plan.duration - 10); c.play(); c.advance(100);
  assert.equal(c.sample().complete, true);
  assert.equal(c.state().playing, false);
  c.advance(5000); assert.equal(c.state().plan.key, 'A');
  c.play(); assert.equal(c.state().time, 0);
  c.pause(); c.replay(); assert.equal(c.state().time, 0); assert.equal(c.state().playing, false);
});

test('减少动效按动作结果推进，单步停留，倍速改变不跳步骤', () => {
  const h = load({ reduced: true, autoplay: false }); const c = h.controller;
  c.next(); c.advance(100);
  assert.equal(c.sample().step.id, 'issue');
  assert.equal(c.sample().arrived, true);
  assert.equal(c.sample().split, true);
  c.setSpeed(2); const time = c.state().time;
  assert.equal(c.state().time, time);
  c.advance(200); assert.equal(c.sample().step.id, 'issue');
  c.advance(200); assert.equal(c.state().playing, false);
  assert.equal(c.sample().step.id, 'issue');
  c.next(); c.advance(100); assert.equal(c.sample().step.id, 'tlb');
  assert.equal(c.sample().logs.length, 1);
  c.pause(); const stopped = c.sample(); c.advance(500); assert.deepEqual(c.sample(), stopped);
});
