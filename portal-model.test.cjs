const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PortalModel = require('./portal-model.js');

const fixture = [
  {
    title: '高等数学的向量分析', discipline: 'math', path: 'math/area/index.html',
    badge: 'Interactive', desc: 'Vector ANALYSIS with slices', formula: 'Σ'
  },
  {
    title: '概率密度', discipline: 'prob', path: 'prob/density/index.html',
    badge: '切片', desc: '联合分布', formula: 'f_X(x)'
  },
  {
    title: '排序算法', discipline: 'ds', path: 'ds/sort/index.html',
    badge: '408 核心', desc: '稳定排序', formula: 'O(n log n)'
  },
  {
    title: '单总线 CPU', discipline: 'co', path: 'co/bus/index.html',
    badge: '数据通路', desc: '寄存器传送', formula: '408'
  },
  {
    title: '启动流程', discipline: 'os', path: 'os/boot/index.html',
    badge: '操作系统 OS', desc: '系统引导过程', formula: 'ROM → RAM'
  },
  {
    title: '路由协议', discipline: 'net', path: 'net/routing/index.html',
    badge: '计算机网络', desc: '网络寻址', formula: 'IP'
  }
];

test('exports fixed keys and normalizes views, hashes, hub, and invalid values', () => {
  assert.deepEqual(PortalModel.SUBJECT_KEYS, ['math', 'prob', 'ds', 'co', 'os', 'net']);
  assert.deepEqual(PortalModel.CS_KEYS, ['ds', 'co', 'os', 'net']);
  for (const key of ['hub', 'all', 'math', 'prob', 'ds', 'co', 'os', 'net', 'cs']) {
    assert.equal(PortalModel.normalizeView(key), key);
    assert.equal(PortalModel.normalizeView(`#${key}`), key);
  }
  for (const invalid of [undefined, null, '', '#', '##math', '#unknown', 'unknown', 42]) {
    assert.equal(PortalModel.normalizeView(invalid), 'hub');
  }
});

test('counts total, each discipline and the four-subject CS aggregate', () => {
  assert.deepEqual(PortalModel.countModules(fixture), {
    all: 6, math: 1, prob: 1, ds: 1, co: 1, os: 1, net: 1, cs: 4
  });
  assert.deepEqual(PortalModel.countModules([]), {
    all: 0, math: 0, prob: 0, ds: 0, co: 0, os: 0, net: 0, cs: 0
  });
  assert.deepEqual(PortalModel.countModules(undefined), {
    all: 0, math: 0, prob: 0, ds: 0, co: 0, os: 0, net: 0, cs: 0
  });
  const cs = PortalModel.filterModules(fixture, 'cs');
  assert.equal(cs.length, 4);
  assert.deepEqual(cs.map((item) => item.discipline), ['ds', 'co', 'os', 'net']);
});

test('filters independently without mutating input and preserves original order/references', () => {
  const before = JSON.stringify(fixture);
  const all = PortalModel.filterModules(fixture, '#all');
  const math = PortalModel.filterModules(fixture, 'math');
  const cs = PortalModel.filterModules(fixture, 'cs');
  assert.notStrictEqual(all, fixture);
  assert.deepEqual(all, fixture);
  assert.strictEqual(math[0], fixture[0]);
  assert.deepEqual(cs, [fixture[2], fixture[3], fixture[4], fixture[5]]);
  assert.deepEqual(PortalModel.filterModules(fixture, 'hub'), []);
  assert.deepEqual(PortalModel.filterModules(fixture, '#bogus'), []);
  assert.deepEqual(PortalModel.filterModules([], 'all'), []);
  assert.equal(JSON.stringify(fixture), before);
});

test('searches all record fields, subject names and aliases case-insensitively with AND terms', () => {
  assert.deepEqual(PortalModel.filterModules(fixture, 'all', '向量分析'), [fixture[0]]); // title
  assert.deepEqual(PortalModel.filterModules(fixture, 'all', 'math area'), [fixture[0]]); // path
  assert.deepEqual(PortalModel.filterModules(fixture, 'all', 'interactive'), [fixture[0]]); // badge
  assert.deepEqual(PortalModel.filterModules(fixture, 'all', 'Σ'), [fixture[0]]); // formula
  assert.deepEqual(PortalModel.filterModules(fixture, 'all', 'VECTOR analysis'), [fixture[0]]); // desc
  assert.deepEqual(PortalModel.filterModules(fixture, 'all', '高等数学 MATH'), [fixture[0]]);
  assert.deepEqual(PortalModel.filterModules(fixture, 'all', '操作系统 oS'), [fixture[4]]);
  assert.deepEqual(PortalModel.filterModules(fixture, 'all', '408'), [fixture[2], fixture[3], fixture[4], fixture[5]]);
  assert.deepEqual(PortalModel.filterModules(fixture, 'all', '操作系统 missing'), []);
  assert.deepEqual(PortalModel.filterModules(fixture, 'math', '   '), [fixture[0]]);
  assert.deepEqual(PortalModel.filterModules(fixture, 'cs', '408'), [fixture[2], fixture[3], fixture[4], fixture[5]]);
  assert.deepEqual(PortalModel.filterModules(fixture, 'prob', '408'), []);
});

test('counts against the real modules.js registry without assuming a fixed total', () => {
  const context = { window: {} };
  const source = fs.readFileSync(path.join(__dirname, 'modules.js'), 'utf8');
  vm.runInNewContext(source, context);
  const records = JSON.parse(JSON.stringify(context.window.MODULES));
  const expected = { all: records.length, math: 0, prob: 0, ds: 0, co: 0, os: 0, net: 0, cs: 0 };
  for (const record of records) {
    if (Object.hasOwn(expected, record.discipline) && record.discipline !== 'all' && record.discipline !== 'cs') {
      expected[record.discipline] += 1;
    }
  }
  expected.cs = ['ds', 'co', 'os', 'net'].reduce((sum, key) => sum + expected[key], 0);
  assert.deepEqual(PortalModel.countModules(records), expected);
  assert.equal(PortalModel.filterModules(records, 'cs').length, expected.cs);
});

test('UMD exposes CommonJS and globalThis APIs without a DOM', () => {
  assert.strictEqual(globalThis.PortalModel, PortalModel);
  const source = fs.readFileSync(path.join(__dirname, 'portal-model.js'), 'utf8');
  const globalContext = vm.createContext({});
  vm.runInContext(source, globalContext);
  assert.equal(typeof globalContext.window, 'undefined');
  assert.equal(typeof globalContext.document, 'undefined');
  assert.equal(typeof globalContext.PortalModel.filterModules, 'function');
  assert.equal(globalContext.PortalModel.normalizeView('#net'), 'net');

  const commonJsContext = vm.createContext({ module: { exports: {} } });
  vm.runInContext(source, commonJsContext);
  assert.equal(typeof commonJsContext.module.exports.countModules, 'function');
  assert.strictEqual(commonJsContext.PortalModel, commonJsContext.module.exports);
});
