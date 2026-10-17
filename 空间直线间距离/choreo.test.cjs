const test = require('node:test');
const assert = require('node:assert/strict');
const { STEPS, storyView, split } = require('./choreo.js');

const samples = Array.from({ length: 801 }, (_, i) => i * (STEPS / 800));
const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('边界无跳变：每一步终点画面等于下一步起点画面', () => {
  for (let k = 1; k < STEPS; k++) {
    const before = storyView(k - 1e-9), after = storyView(k + 1e-9);
    for (const key of ['guide', 'main', 'tag']) assert.ok(near(before[key], after[key]), `${key} 在步界 ${k} 处跳变`);
  }
});

test('起止画面：起点全部未出现，终点引导已收起、主动作与回执全部完成', () => {
  const start = storyView(0);
  assert.deepEqual(start.guide, [0, 0, 0, 0]);
  assert.deepEqual(start.main, [0, 0, 0, 0]);
  assert.deepEqual(start.tag, [0, 0, 0, 0]);

  const end = storyView(STEPS);
  assert.deepEqual(end.guide, [0, 0, 0, 0]);
  assert.deepEqual(end.main, [1, 1, 1, 1]);
  assert.deepEqual(end.tag, [1, 1, 1, 1]);
});

test('一步一个主动作：任一时刻最多只有一步的主动作处于生长中', () => {
  for (const p of samples) {
    const growing = storyView(p).main.filter(m => m > 1e-9 && m < 1 - 1e-9);
    assert.ok(growing.length <= 1, `p=${p} 同时有 ${growing.length} 步在生长`);
  }
});

test('引导先于变化：主动作开始生长时，该步的外环已经亮起', () => {
  for (const p of samples) {
    const view = storyView(p);
    view.main.forEach((m, i) => {
      if (m > 1e-9 && m < 1 - 1e-9) assert.ok(view.guide[i] > 0.999, `p=${p} 第 ${i + 1} 步主动作先于引导`);
    });
  }
});

test('回执排在主动作之后：标签出现时，同一步的主动作已经完成', () => {
  for (const p of samples) {
    const view = storyView(p);
    view.tag.forEach((t, i) => {
      if (t > 1e-9) assert.equal(view.main[i], 1, `p=${p} 第 ${i + 1} 步回执早于主动作`);
    });
  }
});

test('同一步内的子动作按顺序进行：前一个完成后后一个才开始', () => {
  assert.equal(split(0.46, 1, 0.25, 0.46), 1);
  assert.equal(split(0.46, 1, 0.46, 0.7), 0);
  assert.equal(split(0.7, 1, 0.46, 0.7), 1);
});

test('主动作与回执随进度单调不减，可任意拖动与倒退后精确重绘', () => {
  let prev = storyView(0);
  for (const p of samples) {
    const view = storyView(p);
    view.main.forEach((m, i) => assert.ok(m >= prev.main[i] - 1e-12, `p=${p} 第 ${i + 1} 步主动作倒退`));
    view.tag.forEach((t, i) => assert.ok(t >= prev.tag[i] - 1e-12, `p=${p} 第 ${i + 1} 步回执倒退`));
    prev = view;
  }
  const first = storyView(2.3);
  storyView(0.4);
  assert.deepEqual(storyView(2.3), first);
});
