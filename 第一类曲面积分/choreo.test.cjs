const test = require('node:test');
const assert = require('node:assert/strict');
require('./choreo.js');
const c = global.SurfaceChoreo;

test('每步终点与下一步起点相同，所有参数连续无残留', () => {
  c.frames.forEach((frame, i) => {
    assert.deepEqual(c.sampleStep(i, 1), frame);
    if (i < c.duration) assert.deepEqual(c.sampleStep(i, 1), c.sampleStep(i + 1, 0));
    if (i > 0) for (const key of Object.keys(frame)) {
      assert.ok(Math.abs(c.sample(i - .000001).values[key] - c.sample(i + .000001).values[key]) < .0001);
    }
  });
});

test('取片后再跨区移动，落地后才做切平面近似与投影', () => {
  assert.equal(c.sample(3).values.pickLift, 1);
  assert.equal(c.sample(3).values.transfer, 0);
  const fly = c.sample(3.435).values;
  assert.ok(Math.abs(fly.transfer - .5) < 1e-12);
  assert.equal(fly.tangent, 0); assert.equal(fly.rays, 0);
  assert.equal(c.sample(4).values.transfer, 1);
  assert.equal(c.sample(5).values.tangent, 1);
  assert.equal(c.sample(5).values.rays, 0);
  assert.equal(c.sample(6).values.rays, 1);
  assert.equal(c.sample(10).values.limit, 0);
  assert.equal(c.sample(11).values.limit, 1);
});

test('倒退、任意跳转与重复读取得到完全相同的画面', () => {
  const forward = Array.from({ length: 111 }, (_, i) => c.sample(i / 10));
  for (let i = 110; i >= 0; i--) assert.deepEqual(c.sample(i / 10), forward[i]);
  assert.deepEqual(c.sample(-1).values, c.frames[0]);
  assert.deepEqual(c.sample(99).values, c.frames.at(-1));
});

test('一步一个主动作，回执文字在主动作结束后揭示', () => {
  for (let step = 1; step <= c.duration; step++) {
    const a = c.frames[step - 1], b = c.frames[step];
    const changed = Object.keys(a).filter(k => a[k] !== b[k]);
    assert.ok(changed.length <= 2); // 法向量和面积因子共现；汇总时底板变色。
    assert.equal(c.sample(step - .3).textStep, step - 1);
    assert.equal(c.sample(step - .1).textStep, step);
    for (const k of changed) assert.equal(c.sample(step - .2).values[k], b[k]);
  }
});
