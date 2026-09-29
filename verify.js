/**
 * LearningAnimation 模块注册与完整性自动化校验脚本
 * 运行方式: node verify.js
 * 纯原生 Node.js 实现，零外部依赖
 */
const fs = require('fs');
const path = require('path');

console.log('🔍 开始校验 LearningAnimation 模块完整性...');

// 1. 读取并解析 modules.js
const modulesFile = path.join(__dirname, 'modules.js');
if (!fs.existsSync(modulesFile)) {
  console.error('❌ 未找到 modules.js 文件！');
  process.exit(1);
}

const content = fs.readFileSync(modulesFile, 'utf8');
const sandbox = {};
try {
  const code = content.replace(/window\.MODULES\s*=/, 'sandbox.MODULES =');
  eval(code);
} catch (e) {
  console.error('❌ modules.js 语法解析失败:', e.message);
  process.exit(1);
}

const modules = sandbox.MODULES;
if (!Array.isArray(modules)) {
  console.error('❌ window.MODULES 不是有效的数组！');
  process.exit(1);
}

console.log(`✅ 成功加载 modules.js，共登记 ${modules.length} 个演示模块。`);

// 2. 校验每个模块的数据完整性与路径可达性
const validDisciplines = new Set(['math', 'prob', 'ds', 'co', 'os', 'net']);
const counts = { math: 0, prob: 0, ds: 0, co: 0, os: 0, net: 0, cs: 0 };
const csDisciplines = new Set(['ds', 'co', 'os', 'net']);

let errors = 0;
let warnings = 0;
const seenPaths = new Set();
const seenTitles = new Set();

modules.forEach((m, idx) => {
  const prefix = `[模块 #${idx + 1} "${m.title || '未命名'}"]`;

  // 必填字段检查
  if (!m.title) {
    console.error(`❌ ${prefix} 缺少 title 属性！`);
    errors++;
  } else if (seenTitles.has(m.title)) {
    console.warn(`⚠️ ${prefix} 存在重复的标题: "${m.title}"`);
    warnings++;
  } else {
    seenTitles.add(m.title);
  }

  if (!m.discipline || !validDisciplines.has(m.discipline)) {
    console.error(`❌ ${prefix} 学科标识无效: "${m.discipline}" (合法值为: math, prob, ds, co, os, net)`);
    errors++;
  } else {
    counts[m.discipline]++;
    if (csDisciplines.has(m.discipline)) counts.cs++;
  }

  if (!m.path) {
    console.error(`❌ ${prefix} 缺少 path 属性！`);
    errors++;
  } else {
    const fullPath = path.join(__dirname, m.path);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ ${prefix} 路径指向的文件不存在: ${m.path}`);
      errors++;
    }
    if (seenPaths.has(m.path)) {
      console.warn(`⚠️ ${prefix} 存在重复的路径: "${m.path}"`);
      warnings++;
    } else {
      seenPaths.add(m.path);
    }
  }
});

// 3. 输出汇总统计
console.log('\n📊 学科收录统计:');
console.log(`  - 高等数学 (math):       ${counts.math} 个`);
console.log(`  - 概率统计 (prob):       ${counts.prob} 个`);
console.log(`  - 数据结构 (ds):         ${counts.ds} 个`);
console.log(`  - 计组原理 (co):         ${counts.co} 个`);
console.log(`  - 操作系统 (os):         ${counts.os} 个`);
console.log(`  - 计算机网络 (net):       ${counts.net} 个`);
console.log(`  --------------------------------`);
console.log(`  - 408 全科 (cs 综合):    ${counts.cs} 个`);
console.log(`  - 全站总计 (all):        ${modules.length} 个`);

if (errors > 0) {
  console.error(`\n❌ 校验失败：发现 ${errors} 处严重错误，${warnings} 处警告，请修正！\n`);
  process.exit(1);
} else {
  console.log(`\n🎉 全部校验通过！零错误，${warnings} 处警告。项目状态极佳！\n`);
}
