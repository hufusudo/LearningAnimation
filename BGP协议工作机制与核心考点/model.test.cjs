'use strict';
const assert = require('node:assert/strict');
const {
  DEFAULT_LOCAL_PREF,
  makeRoute,
  advertiseEbgp,
  advertiseIbgp,
  hasOwnAsInPath,
  receiveUpdate,
  compareRoutes,
  decideRule,
  selectBest,
  ranking,
  formatAsPath
} = require('./model.js');

const run = [];
const test = (name, fn) => { fn(); run.push(name); };

test('缺省 LOCAL_PREF 为 100', () => {
  assert.equal(DEFAULT_LOCAL_PREF, 100);
  assert.equal(makeRoute('192.168.1.0/24', [], '10.0.12.1').localPref, 100);
});

test('eBGP 通告：前置发送方 AS 号，并把 NEXT_HOP 改写为发送方接口 IP', () => {
  const local = makeRoute('192.168.1.0/24', [], '10.0.12.1');
  const sent = advertiseEbgp(local, 100, '10.0.12.1');
  assert.deepEqual(sent.asPath, [100]);
  assert.equal(sent.nextHop, '10.0.12.1');
});

test('eBGP 逐跳追加 AS 号：AS100 → AS200 → AS300 得到 [300,200,100]', () => {
  const local = makeRoute('192.168.1.0/24', [], '10.0.12.1');
  const at200 = advertiseEbgp(local, 100, '10.0.12.1');
  const at300 = advertiseEbgp(at200, 200, '10.0.23.2');
  assert.deepEqual(at300.asPath, [200, 100]);
  const further = advertiseEbgp(at300, 300, '10.0.31.3');
  assert.deepEqual(further.asPath, [300, 200, 100]);
});

test('AS 欺骗：prependCount=2 会重复附加自身 AS 号', () => {
  const local = makeRoute('192.168.1.0/24', [], '10.0.12.1');
  const sent = advertiseEbgp(local, 100, '10.0.12.1', 2);
  assert.deepEqual(sent.asPath, [100, 100]);
  const at200 = advertiseEbgp(sent, 200, '10.0.23.2');
  assert.deepEqual(at200.asPath, [200, 100, 100]);
  assert.equal(at200.asPath.length, 3);
});

test('iBGP 通告：AS_PATH 与 NEXT_HOP 默认都不变', () => {
  const learned = makeRoute('192.168.1.0/24', [100], '10.0.12.1');
  const sent = advertiseIbgp(learned, '10.0.22.2');
  assert.deepEqual(sent.asPath, [100]);
  assert.equal(sent.nextHop, '10.0.12.1');
});

test('iBGP + next-hop-self：NEXT_HOP 被改写为发送方接口 IP', () => {
  const learned = makeRoute('192.168.1.0/24', [100], '10.0.12.1');
  const sent = advertiseIbgp(learned, '10.0.22.2', true);
  assert.equal(sent.nextHop, '10.0.22.2');
  assert.deepEqual(sent.asPath, [100]);
});

test('AS_PATH 防环：本 AS 号已在路径中则丢弃', () => {
  const looped = makeRoute('192.168.1.0/24', [200, 100], '10.0.22.2');
  assert.equal(hasOwnAsInPath(looped, 100), true);
  const result = receiveUpdate(looped, 100);
  assert.equal(result.accepted, false);
  assert.equal(result.route, null);
  assert.match(result.reason, /丢弃以防环/);
});

test('AS_PATH 防环：不含本 AS 号则接受', () => {
  const fresh = makeRoute('192.168.1.0/24', [200, 100], '10.0.12.1');
  const result = receiveUpdate(fresh, 300);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.route.asPath, [200, 100]);
});

test('选路：LOCAL_PREF 大者优先，即使 AS_PATH 更长', () => {
  const shortPath = makeRoute('192.168.1.0/24', [200, 100], '10.0.24.1', 100);
  const longPath = makeRoute('192.168.1.0/24', [200, 100, 100], '10.0.23.2', 300);
  assert.equal(selectBest([shortPath, longPath]), longPath);
  const rule = decideRule(longPath, shortPath);
  assert.equal(rule.rule, 'LOCAL_PREF');
  assert.equal(rule.winner, 'a');
});

test('选路：LOCAL_PREF 相同时 AS_PATH 短者优先', () => {
  const shortPath = makeRoute('192.168.1.0/24', [200, 100], '10.0.24.1', 100);
  const longPath = makeRoute('192.168.1.0/24', [200, 100, 100], '10.0.23.2', 100);
  assert.equal(selectBest([longPath, shortPath]), shortPath);
  const rule = decideRule(shortPath, longPath);
  assert.equal(rule.rule, 'AS_PATH 长度');
  assert.equal(rule.winner, 'a');
});

test('选路：两级规则都打平时按 NEXT_HOP 地址兜底', () => {
  const a = makeRoute('192.168.1.0/24', [200, 100], '10.0.24.1', 100);
  const b = makeRoute('192.168.1.0/24', [300, 100], '10.0.23.2', 100);
  assert.equal(selectBest([a, b]), b);
  assert.equal(decideRule(a, b).rule, 'NEXT_HOP（兜底）');
});

test('名次表按选路规则排序', () => {
  const shortPath = makeRoute('192.168.1.0/24', [200, 100], '10.0.24.1', 100);
  const longPath = makeRoute('192.168.1.0/24', [200, 100, 100], '10.0.23.2', 300);
  const order = ranking([shortPath, longPath]);
  assert.equal(order[0].route, longPath);
  assert.equal(order[0].rank, 1);
  assert.equal(order[1].route, shortPath);
});

test('compareRoutes 对空候选安全', () => {
  assert.equal(selectBest([]), null);
  assert.deepEqual(ranking([]), []);
});

test('formatAsPath：空路径显示本地始发', () => {
  assert.equal(formatAsPath([]), '本地始发');
  assert.equal(formatAsPath([200, 100]), '200 100');
});

console.log('BGP model.test.cjs：' + run.length + ' 项断言全部通过');
run.forEach(name => console.log('  ✓ ' + name));
