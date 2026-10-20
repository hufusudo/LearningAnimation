'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { build, sample } = require('./choreo.js');

function fixture() {
  return build({
    start: { sample: 'F1', theta: 10, k: 0.2 },
    steps: [
      { sample: 'F1', theta: 30, k: 0.4, dur: 0.5, text: '先观察截线', focus: 'curve', reveal: ['A'], tag: '偏导存在' },
      { sample: 'F2', theta: 70, k: 0.8, dur: 0.2, text: '再看方向变化', focus: 'tangent', reveal: ['B'], tag: '连续性不同' },
      { sample: 'F1', theta: 90, k: 1, dur: 0.4, text: '回到首个样本', reveal: ['C'] }
    ]
  });
}

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message || 'value'}: ${actual} ≈ ${expected}`);
}

test('步长、参数窗口和相邻步边界连续', () => {
  const seq = fixture();
  assert.equal(seq.steps[0].duration, 2.5);
  assert.equal(seq.steps[1].duration, 2.4);
  for (let i = 0; i < seq.steps.length - 1; i += 1) {
    const end = seq.steps[i].end;
    const epsilon = 1e-7;
    const left = sample(seq, end - epsilon);
    const exact = sample(seq, end);
    const right = sample(seq, end + epsilon);
    assert.equal(exact.index, i, '精确步末仍属于当前步');
    assert.equal(exact.title, seq.steps[i].target.title);
    assert.equal(exact.tag, seq.steps[i].target.tag);
    assert.equal(exact.receiptAlpha, seq.steps[i].target.tag ? 1 : 0);
    assert.equal(exact.theta, seq.steps[i].target.theta);
    assert.equal(exact.k, seq.steps[i].target.k);
    assert.equal(right.index, i + 1);

    for (const key of ['sample', 'text', 'tag', 'known']) {
      assert.deepEqual(right[key], left[key], `${key} limits at boundary ${i}`);
    }
    for (const key of ['theta', 'k', 'alpha', 'textAlpha', 'receiptAlpha']) {
      closeTo(right[key], left[key], `${key} limits at boundary ${i}`);
    }
  }
  const first = seq.steps[0];
  assert.equal(sample(seq, first.start).theta, first.from.theta);
  assert.equal(sample(seq, first.start + first.duration * 0.25).theta, first.from.theta);
  assert.equal(sample(seq, first.start + first.duration * 0.72).theta, first.target.theta);
  assert.equal(sample(seq, first.end, true).index, 0);
  assert.equal(sample(seq, first.end + 1e-7, true).index, 1);
});

test('任意顺序采样与时间边界处理均确定', () => {
  const seq = fixture();
  const times = [seq.duration, 0.1, seq.steps[1].start + 0.7, 0, 1.2, 0.1];
  const values = times.map((time) => sample(seq, time));
  assert.deepEqual(values[1], values[5]);
  assert.equal(sample(seq, -1).progress, 0);
  assert.equal(sample(seq, NaN).progress, 0);
  assert.deepEqual(sample(seq, Infinity), sample(seq, seq.duration));
  assert.deepEqual(sample(seq, seq.duration + 100), sample(seq, seq.duration));
  assert.deepEqual(sample(seq, -Infinity), sample(seq, 0));
});

test('样本切换先淡出旧样本，再交换并淡入新样本', () => {
  const seq = fixture();
  const step = seq.steps[1];
  const at = (p) => sample(seq, step.start + step.duration * p);
  assert.equal(at(0).tag, '偏导存在');
  assert.equal(at(0).receiptAlpha, 1);
  assert.equal(at(0.1).sample, 'F1');
  closeTo(at(0.1).alpha, 0.5, '旧样本淡出');
  assert.equal(at(0.2).sample, 'F2');
  assert.equal(at(0.2).alpha, 0);
  closeTo(at(0.3).alpha, 0.5, '新样本淡入');
  assert.equal(at(0.4).alpha, 1);
  assert.equal(at(0.4).tag, null);
  assert.equal(at(0.4).receiptAlpha, 0);
  assert.equal(at(0.8).tag, '连续性不同');
  assert.equal(at(0.79).tag, null);
});

test('reveal 只在回执开始后生效，切换样本隔离并在换回时恢复', () => {
  const seq = fixture();
  const a = seq.steps[0];
  assert.deepEqual(sample(seq, a.start).known, { A: false, B: false, C: false, D: false });
  assert.equal(sample(seq, a.start + a.duration * 0.79).known.A, false);
  assert.equal(sample(seq, a.start + a.duration * 0.8).known.A, true);

  const b = seq.steps[1];
  const beforeReceipt = sample(seq, b.start + b.duration * 0.79);
  assert.equal(beforeReceipt.sample, 'F2');
  assert.deepEqual(beforeReceipt.known, { A: false, B: false, C: false, D: false });
  assert.equal(sample(seq, b.start + b.duration * 0.8).known.B, true);

  const c = seq.steps[2];
  const backToF1 = sample(seq, c.start + c.duration * 0.79);
  assert.equal(backToF1.sample, 'F1');
  assert.deepEqual(backToF1.known, { A: true, B: false, C: false, D: false });
  assert.deepEqual(sample(seq, c.start + c.duration * 0.8).known, {
    A: true, B: false, C: true, D: false
  });
});

test('没有 reveal 的步骤不会改变判定，减少动效返回当前步终态', () => {
  const seq = build({
    start: { sample: 'S', theta: 1, k: 0 },
    steps: [
      { sample: 'S', theta: 5, k: 1, text: '动作一', reveal: ['D'] },
      { sample: 'T', theta: 20, k: 2, text: '动作二' }
    ]
  });
  const step = seq.steps[1];
  const expected = {
    sample: step.target.sample,
    theta: step.target.theta,
    k: step.target.k,
    text: step.target.text,
    title: step.target.title,
    focus: step.target.focus,
    tag: step.target.tag,
    index: 1,
    progress: 1,
    alpha: 1,
    textAlpha: 1,
    receiptAlpha: 0,
    known: { A: false, B: false, C: false, D: false }
  };
  assert.deepEqual(sample(seq, step.start + 0.5, true), expected);
  assert.deepEqual(sample(seq, step.end, true), expected);
  assert.throws(() => build({ steps: [] }), /至少一个步骤/);
});
