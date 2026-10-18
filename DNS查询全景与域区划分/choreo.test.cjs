const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./data.js');
const model = require('./model.js');
const choreo = require('./choreo.js');

const CONFIGS = [];
for (const zone of ['single', 'two']) {
  for (const mode of ['iterative', 'recursive']) {
    for (const target of ['t', 'u']) CONFIGS.push([zone, mode, target]);
  }
}

const build = config => model.buildScenario(...config);

function rounded(value) {
  if (typeof value === 'number') return Math.round(value * 1e9) / 1e9;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item)]));
  }
  return value;
}

function boundaryState(sequence, stepIndex, progress) {
  const step = sequence.steps[stepIndex];
  const frame = choreo.frame(step, progress);
  return {
    packetAlpha: frame.packet.alpha,
    probe: rounded(frame.probe.point),
    probeNode: frame.probe.node,
    lit: rounded(Object.fromEntries(Object.entries(frame.lit).filter(([, amount]) => amount > 0))),
    counter: frame.counter.value,
    resolvedMix: frame.resolvedMix,
    completedRoutes: rounded(frame.completedRoutes),
    match: frame.match,
    queried: frame.queried.slice().sort(),
    answeredBy: frame.answeredBy,
    resultAlpha: frame.result.alpha
  };
}

test('八种配置：相邻步骤末帧与下一帧首帧一致', () => {
  for (const config of CONFIGS) {
    const sequence = build(config);
    for (let i = 0; i < sequence.steps.length - 1; i++) {
      const left = boundaryState(sequence, i, 1);
      const right = boundaryState(sequence, i + 1, 0);
      assert.deepEqual(left, right, `${sequence.key} 边界 ${i}→${i + 1}`);
    }
  }
});

test('报文位置在每一步首尾与飞行端点一致', () => {
  for (const config of CONFIGS) {
    const sequence = build(config);
    for (const step of sequence.steps) {
      const first = step.flights[0];
      const last = step.flights[step.flights.length - 1];
      const start = choreo.frame(step, 0).packet.point;
      const end = choreo.frame(step, 1).packet.point;
      assert.deepEqual(rounded(start), rounded(D.routePoint(first.from, first.to, 0)));
      assert.deepEqual(rounded(end), rounded(D.routePoint(last.from, last.to, 1)));
    }
  }
});

test('探针在步末停在 after.match，点亮边包含完整 trail', () => {
  for (const config of CONFIGS) {
    const sequence = build(config);
    for (const step of sequence.steps) {
      const end = choreo.frame(step, 1);
      assert.equal(end.probe.node, step.after.match);
      for (const edge of step.after.trail) assert.equal(end.lit[edge], 1);
      assert.deepEqual(rounded(end.probe.point), rounded([D.TREE_NODES[step.after.match].x, D.TREE_NODES[step.after.match].y]));
    }
  }
});

test('计数只在发包步递增，回退时由 before 直接恢复', () => {
  for (const config of CONFIGS) {
    const sequence = build(config);
    for (const step of sequence.steps) {
      assert.equal(choreo.frame(step, 0).counter.value, step.before.outbound);
      assert.equal(choreo.frame(step, 1).counter.value, step.after.outbound);
      const mid = choreo.frame(step, 0.5).counter.value;
      assert.ok(mid >= step.before.outbound && mid <= step.after.outbound);
    }
  }
});

test('任意进度可重入，且不修改步骤对象', () => {
  for (const config of CONFIGS) {
    const sequence = build(config);
    const snapshot = JSON.stringify(sequence);
    for (const step of sequence.steps) {
      const a = choreo.frame(step, 0.371);
      choreo.frame(step, 0.91);
      const b = choreo.frame(step, 0.371);
      assert.deepEqual(rounded(a), rounded(b));
      assert.deepEqual(rounded(choreo.frame(step, -1)), rounded(choreo.frame(step, 0)));
      assert.deepEqual(rounded(choreo.frame(step, 2)), rounded(choreo.frame(step, 1)));
    }
    assert.equal(JSON.stringify(sequence), snapshot);
  }
});

test('所有坐标落在舞台范围内', () => {
  for (const config of CONFIGS) {
    const sequence = build(config);
    for (const step of sequence.steps) {
      for (const p of [0, 0.13, 0.37, 0.55, 0.73, 0.91, 1]) {
        const frame = choreo.frame(step, p);
        for (const point of [frame.packet.point, frame.probe.point, frame.pulse.point, ...frame.trailPoints]) {
          assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[1]));
          assert.ok(point[0] >= 0 && point[0] <= 1180, `${sequence.key} x=${point[0]}`);
          assert.ok(point[1] >= 0 && point[1] <= 600, `${sequence.key} y=${point[1]}`);
        }
      }
    }
  }
});

test('sample 与 boundary：普通模式按各自时长累计', () => {
  for (const config of CONFIGS) {
    const sequence = build(config);
    assert.equal(choreo.sample(sequence, 0, false).index, 0);
    assert.equal(choreo.sample(sequence, 0, false).progress, 0);
    assert.equal(choreo.sample(sequence, sequence.total, false).complete, true);
    assert.equal(choreo.sample(sequence, sequence.total + 5, false).index, sequence.steps.length - 1);
    for (let i = 0; i < sequence.steps.length; i++) {
      const end = choreo.boundary(sequence, false, i + 1);
      const point = choreo.sample(sequence, end - 1e-6, false);
      assert.equal(point.index, i, `${sequence.key} step ${i}`);
      assert.ok(Math.abs(choreo.boundary(sequence, false, i) - (end - sequence.steps[i].duration)) < 1e-9);
    }
  }
});

test('减少动效：每步停留 0.9 秒并直接到步末状态', () => {
  const sequence = build(['two', 'iterative', 't']);
  assert.equal(choreo.duration(sequence, true), sequence.steps.length * 0.9);
  const first = choreo.sample(sequence, 0.2, true);
  assert.equal(first.index, 0);
  assert.equal(first.progress, 1);
  const second = choreo.sample(sequence, 1.0, true);
  assert.equal(second.index, 1);
  assert.equal(second.progress, 1);
  const end = choreo.sample(sequence, 999, true);
  assert.equal(end.complete, true);
  assert.equal(end.index, sequence.steps.length - 1);
});

test('总时长与步骤边界不带浮点尾差，滑块能精确到达末尾', () => {
  for (const config of CONFIGS) {
    const sequence = build(config);
    for (const reduced of [false, true]) {
      const total = choreo.duration(sequence, reduced);
      assert.equal(total, Number(total.toFixed(3)));
      assert.equal(choreo.sample(sequence, total, reduced).complete, true);
      for (let i = 0; i <= sequence.steps.length; i++) {
        const t = choreo.boundary(sequence, reduced, i);
        assert.equal(t, Number(t.toFixed(3)));
      }
    }
  }
});

test('路径与树路径的几何端点稳定', () => {
  assert.deepEqual(rounded(D.routePoint('local', 'root', 0)), [720, 431]);
  assert.deepEqual(rounded(D.routePoint('local', 'root', 1)), [850, 122]);
  assert.deepEqual(rounded(D.routePoint('root', 'local', 0)), [850, 122]);
  assert.deepEqual(rounded(D.routePoint('root', 'local', 1)), [720, 431]);
  assert.deepEqual(rounded(D.treePoint(['abc', 'y', 't'], 0)), [210, 275]);
  assert.deepEqual(rounded(D.treePoint(['abc', 'y', 't'], 1)), [300, 480]);
  assert.deepEqual(D.pathBetween('abc', 't'), ['abc', 'y', 't']);
  assert.deepEqual(D.pathBetween('abc', 'u'), ['abc', 'x', 'u']);
  assert.deepEqual(D.TRAIL_BY_MATCH.t, ['root-com', 'com-abc', 'abc-y', 'y-t']);
  assert.deepEqual(D.TRAIL_BY_MATCH.u, ['root-com', 'com-abc', 'abc-x', 'x-u']);
});
