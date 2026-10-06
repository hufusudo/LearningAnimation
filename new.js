/**
 * 创建独立演示模块：node new.js "模块名称" <math|prob|ds|co|os|net> [特性标签]
 * 基础模板位于 tools/scaffold/；仅生成三个入口文件，不规定演示布局或播放器。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DISCIPLINES = {
  math: '高等数学', prob: '概率论与数理统计', ds: '数据结构',
  co: '计算机组成原理', os: '计算机操作系统', net: '计算机网络'
};
const FILES = ['index.html', 'style.css', 'app.js'];

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function createModule(name, discipline, badge) {
  if (!name || name.startsWith('.') || /[\\/<>"|:?*#%&\x00-\x1f\x7f]/.test(name)) {
    throw new Error('模块名称须是一个普通目录名，不能含路径分隔符或 URL/HTML 特殊字符。');
  }
  if (!Object.hasOwn(DISCIPLINES, discipline)) {
    throw new Error('学科标识只允许 math、prob、ds、co、os、net。');
  }

  const target = path.join(__dirname, name);
  const existed = fs.existsSync(target);
  if (existed) {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('目标不是普通目录，已停止创建。');
    }
    if (FILES.some((file) => fs.existsSync(path.join(target, file)))) {
      throw new Error('目标目录已有页面代码，已停止创建，避免覆盖。');
    }
    if (fs.readdirSync(target).length && !fs.existsSync(path.join(target, '设计方案.md'))) {
      throw new Error('非空目录缺少设计方案.md，已停止创建。');
    }
  }

  // 在创建页面前确认登记表可读取且没有重复条目。
  const registryFile = path.join(__dirname, 'modules.js');
  const source = fs.readFileSync(registryFile, 'utf8');
  const assignment = source.match(/^([\s\S]*?\bwindow\.MODULES\s*=\s*)(\[[\s\S]*\])(\s*;?\s*)$/);
  if (!assignment) throw new Error('modules.js 的登记数组格式无法识别，未创建页面。');
  const records = vm.runInNewContext('(' + assignment[2] + ')', {}, { timeout: 1000 });
  if (!Array.isArray(records)) throw new Error('modules.js 必须包含登记数组。');
  const entryPath = name + '/index.html';
  if (records.some((item) => item?.path === entryPath || item?.title === name)) {
    throw new Error('模块名称或入口已经登记，已停止创建。');
  }

  const fields = {
    title: escapeHtml(name),
    discipline,
    disciplineName: escapeHtml(DISCIPLINES[discipline])
  };
  const contents = FILES.map((file) => {
    const template = fs.readFileSync(path.join(__dirname, 'tools', 'scaffold', file), 'utf8');
    return template.replace(/\{\{(\w+)\}\}/g, (token, key) => {
      if (!Object.hasOwn(fields, key)) throw new Error('模板存在未知字段：' + token);
      return fields[key];
    });
  });
  records.push({
    title: name, discipline, path: entryPath, badge: badge || '交互演示',
    desc: name + '的交互式教学演示。',
    formula: DISCIPLINES[discipline] + ' · 核心直观'
  });
  const nextRegistry = assignment[1] + JSON.stringify(records, null, 2) + assignment[3];

  // 页面写完后再原子替换登记表；失败只清理由本次创建的文件，保留原方案。
  const created = [];
  const temporaryRegistry = registryFile + '.' + process.pid + '.tmp';
  let temporaryCreated = false;
  let directoryCreated = false;
  try {
    if (!existed) {
      fs.mkdirSync(target);
      directoryCreated = true;
    }
    FILES.forEach((file, index) => {
      const dest = path.join(target, file);
      const descriptor = fs.openSync(dest, 'wx');
      created.push(dest);
      try {
        fs.writeFileSync(descriptor, contents[index], 'utf8');
      } finally {
        fs.closeSync(descriptor);
      }
    });
    const descriptor = fs.openSync(temporaryRegistry, 'wx', fs.statSync(registryFile).mode);
    temporaryCreated = true;
    try {
      fs.writeFileSync(descriptor, nextRegistry, 'utf8');
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporaryRegistry, registryFile);
  } catch (error) {
    if (temporaryCreated) fs.unlinkSync(temporaryRegistry);
    created.reverse().forEach((file) => fs.unlinkSync(file));
    if (directoryCreated && fs.existsSync(target)) fs.rmdirSync(target);
    throw error;
  }
  console.log('已创建 ' + name + '/：index.html、style.css、app.js；原有设计方案保留。');
  console.log('已登记到 modules.js。请按设计方案实现内容，控件和组件按需添加。');
}

const [rawName, rawDiscipline, rawBadge] = process.argv.slice(2);
try {
  if (rawName === undefined || rawDiscipline === undefined) {
    throw new Error('用法：node new.js "模块名称" <math|prob|ds|co|os|net> [特性标签]');
  }
  createModule(rawName.trim(), rawDiscipline.trim().toLowerCase(), rawBadge?.trim());
} catch (error) {
  console.error('创建失败：' + error.message);
  process.exitCode = 1;
}
