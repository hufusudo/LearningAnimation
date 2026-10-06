const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

function fixture(t, registry = '/* 登记表备注保留 */\nwindow.MODULES = [];\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-animation-scaffold-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.copyFileSync(path.join(__dirname, 'new.js'), path.join(root, 'new.js'));
  fs.cpSync(path.join(__dirname, 'tools', 'scaffold'), path.join(root, 'tools', 'scaffold'), {
    recursive: true
  });
  fs.writeFileSync(path.join(root, 'modules.js'), registry);
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>大厅</title>');
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [path.join(root, 'new.js'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 5000
  });
}

function records(root) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules.js'), 'utf8'), context);
  return JSON.parse(JSON.stringify(context.window.MODULES));
}

test('新建模块使用本地基础资源，登记表仅增加一条记录', (t) => {
  const previous = {
    title: '已有演示', discipline: 'net', path: '已有演示/index.html',
    badge: '已有特性', desc: '原说明', formula: '原公式'
  };
  const root = fixture(t, '/* 登记表备注保留 */\nwindow.MODULES = ' + JSON.stringify([previous]) + ';\n');
  const result = run(root, '切片演示', 'math', '截面观察');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(records(root)[0], previous);
  assert.equal(records(root).length, 2);
  assert.deepEqual(records(root)[1], {
    title: '切片演示', discipline: 'math', path: '切片演示/index.html',
    badge: '截面观察', desc: '切片演示的交互式教学演示。', formula: '高等数学 · 核心直观'
  });
  assert.ok(fs.readFileSync(path.join(root, 'modules.js'), 'utf8').startsWith('/* 登记表备注保留 */'));
  assert.deepEqual(fs.readdirSync(path.join(root, '切片演示')).sort(), ['app.js', 'index.html', 'style.css']);
  const html = fs.readFileSync(path.join(root, '切片演示', 'index.html'), 'utf8');
  assert.ok(html.includes('../index.html#math'));
  assert.ok(!html.includes('{{'));
  const activeHtml = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/src="https?:/.test(activeHtml), '基础页面不需要加载外部脚本');
  assert.ok(!activeHtml.includes('<button'), '基础模板不提供尚未实现的播放控件');
  const syntax = spawnSync(process.execPath, ['--check', path.join(root, '切片演示', 'app.js')]);
  assert.equal(syntax.status, 0);
});

test('支持讨论阶段已保存方案的目录，并保留方案和静态资源', (t) => {
  const root = fixture(t);
  const target = path.join(root, '已有方案');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, '设计方案.md'), '# 已定稿方案\n保持原文。\n');
  fs.writeFileSync(path.join(target, '参考.svg'), '<svg></svg>');
  const result = run(root, '已有方案', 'os');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(target, '设计方案.md'), 'utf8'), '# 已定稿方案\n保持原文。\n');
  assert.equal(fs.readFileSync(path.join(target, '参考.svg'), 'utf8'), '<svg></svg>');
  assert.equal(records(root)[0].badge, '交互演示');
});

test('已有页面代码时不覆盖文件、不改变登记表', (t) => {
  const root = fixture(t);
  const target = path.join(root, '不可覆盖');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'app.js'), '原有代码');
  fs.writeFileSync(path.join(target, '设计方案.md'), '原有方案');
  const before = fs.readFileSync(path.join(root, 'modules.js'));
  const result = run(root, '不可覆盖', 'ds');
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(target, 'app.js'), 'utf8'), '原有代码');
  assert.deepEqual(fs.readFileSync(path.join(root, 'modules.js')), before);
  assert.ok(!fs.existsSync(path.join(target, 'index.html')));
});

test('目录名和学科无效时不写入任何页面或登记', (t) => {
  const root = fixture(t);
  const before = fs.readFileSync(path.join(root, 'modules.js'));
  for (const name of ['', '.', '..', '../外部', '一级/二级', '一级\\二级', '.agents', '断行\n名称', '错误#锚点']) {
    assert.notEqual(run(root, name, 'math').status, 0, name);
  }
  assert.notEqual(run(root, '错误学科', 'cs').status, 0);
  assert.deepEqual(fs.readFileSync(path.join(root, 'modules.js')), before);
  assert.deepEqual(fs.readdirSync(root).sort(), ['index.html', 'modules.js', 'new.js', 'tools']);
});

test('重复的名称或入口拒绝登记，先检查登记表再创建目录', (t) => {
  const root = fixture(t, 'window.MODULES = [{ title: "重复名称", path: "重复入口/index.html" }];\n');
  const before = fs.readFileSync(path.join(root, 'modules.js'));
  assert.notEqual(run(root, '重复名称', 'net').status, 0);
  assert.notEqual(run(root, '重复入口', 'net').status, 0);
  assert.ok(!fs.existsSync(path.join(root, '重复名称')));
  assert.ok(!fs.existsSync(path.join(root, '重复入口')));
  assert.deepEqual(fs.readFileSync(path.join(root, 'modules.js')), before);
});

test('登记表无法解析或模板缺失时，不留下半成品目录', (t) => {
  const root = fixture(t, 'window.MODULES = [不存在的标识符];\n');
  const before = fs.readFileSync(path.join(root, 'modules.js'));
  assert.notEqual(run(root, '拒绝创建', 'net').status, 0);
  assert.ok(!fs.existsSync(path.join(root, '拒绝创建')));
  assert.deepEqual(fs.readFileSync(path.join(root, 'modules.js')), before);
  fs.writeFileSync(path.join(root, 'modules.js'), 'window.MODULES = [];\n');
  fs.unlinkSync(path.join(root, 'tools', 'scaffold', 'app.js'));
  assert.notEqual(run(root, '缺模板', 'net').status, 0);
  assert.ok(!fs.existsSync(path.join(root, '缺模板')));
  assert.deepEqual(records(root), []);
});

test('写入登记表失败时，仅回滚本次新建文件，保留已有方案', (t) => {
  if (!process.getuid || process.getuid() === 0) {
    t.skip('此权限故障场景需要普通 Unix 用户');
    return;
  }
  const root = fixture(t);
  const target = path.join(root, '回滚演示');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, '设计方案.md'), '不能删除的方案');
  const before = fs.readFileSync(path.join(root, 'modules.js'));
  // 已有模块目录仍可写，但根目录无法创建临时登记文件。
  fs.chmodSync(root, 0o555);
  try {
    assert.notEqual(run(root, '回滚演示', 'net').status, 0);
  } finally {
    fs.chmodSync(root, 0o755);
  }
  assert.deepEqual(fs.readdirSync(target), ['设计方案.md']);
  assert.equal(fs.readFileSync(path.join(target, '设计方案.md'), 'utf8'), '不能删除的方案');
  assert.deepEqual(fs.readFileSync(path.join(root, 'modules.js')), before);
});
