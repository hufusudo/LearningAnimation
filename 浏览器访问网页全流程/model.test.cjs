const test = require('node:test');
const assert = require('node:assert/strict');
const { STEPS, PHASES, snapshot, REQUEST, URL_PARTS } = require('./model.js');
test('六段都可逐个动作进入，且阶段顺序连续', () => {
  assert.equal(PHASES.length, 6);
  assert.deepEqual([...new Set(STEPS.map(s => s.phase))], [0,1,2,3,4,5]);
  PHASES.forEach((p, i) => assert.equal(STEPS[p.start].phase, i));
});
test('HTTP 请求保留查询参数，不发送 URL 片段', () => {
  assert.ok(REQUEST.includes('?chapter=4 HTTP/1.1'));
  assert.ok(!REQUEST.includes('#tcp'));
  assert.equal(URL_PARTS.fragment, '#tcp');
});
test('每个网络前提只在相应动作完成后出现', () => {
  for (const key of ['ip','tcp','tls','html']) {
    const index = STEPS.findIndex(s => s.unlock === key);
    assert.equal(snapshot(index - 1)[key], false);
    assert.equal(snapshot(index)[key], true);
  }
});
test('回退能清除未来连接、文档与资源状态', () => {
  const end = snapshot(STEPS.length - 1);
  assert.equal(end.render, 'complete');
  assert.equal(end.js, true);
  const initial = snapshot(0);
  for (const key of ['ip','tcp','tls','html','css','image','js']) assert.equal(initial[key], false);
  assert.equal(initial.render, 'blank');
});
test('TCP、TLS、HTTP 的先后依赖明确，资源请求在文档之后', () => {
  const at = key => STEPS.findIndex(s => s.unlock === key);
  assert.ok(at('ip') < at('tcp') && at('tcp') < at('tls') && at('tls') < at('html'));
  for (const key of ['css','image','js']) assert.ok(at(key) > at('html'));
});
