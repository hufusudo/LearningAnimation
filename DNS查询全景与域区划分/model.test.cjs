const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./data.js');
const model = require('./model.js');

const CONFIGS = [];
for (const zone of ['single', 'two']) {
  for (const mode of ['iterative', 'recursive']) {
    for (const target of ['t', 'u']) CONFIGS.push([zone, mode, target]);
  }
}

const build = ([zone, mode, target]) => model.buildScenario(zone, mode, target);

test('八种配置：步骤数量与目标语义正确', () => {
  const expected = {
    'single/iterative/t': 4,
    'two/iterative/t': 5,
    'single/iterative/u': 4,
    'two/iterative/u': 4,
    'single/recursive/t': 5,
    'two/recursive/t': 6,
    'single/recursive/u': 5,
    'two/recursive/u': 5
  };
  for (const config of CONFIGS) {
    const sequence = build(config);
    assert.equal(sequence.steps.length, expected[sequence.key], sequence.key);
    assert.equal(sequence.key, config.join('/'));
  }
});

test('相邻步骤 before/after 完全衔接，飞行端点连续', () => {
  for (const config of CONFIGS) {
    const sequence = build(config);
    for (let i = 0; i < sequence.steps.length - 1; i++) {
      const current = sequence.steps[i];
      const next = sequence.steps[i + 1];
      assert.deepEqual(next.before, current.after, `${sequence.key} 边界 ${i}→${i + 1}`);
      const last = current.flights[current.flights.length - 1];
      const first = next.flights[0];
      assert.equal(first.from, last.to, `${sequence.key} 飞行端点 ${i}→${i + 1}`);
    }
  }
});

test('本地对外计数：迭代 3/4 次，递归恒为 1 次', () => {
  for (const target of ['t', 'u']) {
    for (const zone of ['single', 'two']) {
      const iterative = model.buildScenario(zone, 'iterative', target);
      const expected = target === 't' && zone === 'two' ? 4 : 3;
      assert.equal(iterative.steps.at(-1).after.outbound, expected, `iterative ${zone} ${target}`);
      for (let i = 1; i < iterative.steps.length; i++) {
        assert.ok(iterative.steps[i].after.outbound >= iterative.steps[i].before.outbound);
      }
    }
    for (const zone of ['single', 'two']) {
      const recursive = model.buildScenario(zone, 'recursive', target);
      assert.equal(recursive.steps.at(-1).after.outbound, 1, `recursive ${zone} ${target}`);
      let expectedCount = 0;
      for (const step of recursive.steps) {
        if (step.key === 'recur-root') expectedCount = 1;
        assert.equal(step.after.outbound, expectedCount, `recursive ${zone} ${target} ${step.key}`);
      }
    }
  }
});

test('u.x 在两区模式仍不查询 y；t.y 两区必须追加一次', () => {
  const uTwo = model.buildScenario('two', 'iterative', 'u');
  assert.ok(!uTwo.steps.some(step => step.queried.includes('authy')));
  assert.equal(uTwo.steps.at(-1).after.outbound, 3);
  const tTwo = model.buildScenario('two', 'iterative', 't');
  assert.ok(tTwo.steps.some(step => step.queried.includes('authy')));
  assert.equal(tTwo.steps.at(-1).after.outbound, 4);
  assert.equal(tTwo.steps.at(-1).after.match, 't');
  assert.equal(tTwo.steps.at(-1).after.answeredBy, 'authy');
});

test('单区 t.y 由 abc 权限服务器直接应答，两区由 y 子区应答', () => {
  const single = model.buildScenario('single', 'iterative', 't');
  assert.equal(single.steps.at(-1).after.answeredBy, 'auth');
  assert.equal(single.steps.at(-1).after.resolved, true);
  assert.equal(single.steps.at(-1).after.answer, '192.0.2.88');
  const two = model.buildScenario('two', 'iterative', 't');
  assert.equal(two.steps.at(-1).after.answeredBy, 'authy');
  assert.equal(two.steps[3].after.match, 'abc');
  assert.equal(two.steps[3].after.resolved, false);
});

test('递归链的 match 与查询顺序符合层级', () => {
  const sequence = model.buildScenario('two', 'recursive', 't');
  const matches = sequence.steps.map(step => step.after.match);
  assert.deepEqual(matches, ['root', 'root', 'com', 'abc', 'y', 't']);
  const queried = sequence.steps.map(step => step.queried.join(','));
  assert.deepEqual(queried, ['', 'root', 'tld', 'auth', 'authy', '']);
  assert.equal(sequence.steps.at(-1).flights.length, 5);
});

test('usedRoutes 记录每条链路的最后一种语义', () => {
  const sequence = model.buildScenario('two', 'iterative', 't');
  const last = sequence.steps.at(-1).after.usedRoutes;
  assert.equal(last['local-authy'], 'answer');
  assert.equal(last['local-client'], 'answer');
  assert.equal(last['client-local'], 'query');
  assert.equal(last['local-auth'], 'referral');
  assert.equal(D.routeKey('authy', 'local'), 'local-authy');
  assert.equal(D.routeKey('local', 'client'), 'local-client');
});

test('目标 IP 与 host 正确，且目标节点/区节点一致', () => {
  assert.equal(model.buildScenario('single', 'iterative', 't').targetInfo.ip, '192.0.2.88');
  assert.equal(model.buildScenario('single', 'iterative', 'u').targetInfo.ip, '192.0.2.66');
  assert.equal(model.buildScenario('single', 'iterative', 't').targetInfo.node, 't');
  assert.equal(model.buildScenario('single', 'iterative', 'u').targetInfo.node, 'u');
  assert.equal(D.TARGETS.t.zoneNode, 'y');
  assert.equal(D.TARGETS.u.zoneNode, 'x');
});

test('非法配置抛错', () => {
  assert.throws(() => model.buildScenario('three', 'iterative', 't'), RangeError);
  assert.throws(() => model.buildScenario('single', 'mixed', 't'), RangeError);
  assert.throws(() => model.buildScenario('single', 'iterative', 'v'), RangeError);
});
