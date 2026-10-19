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

// 3. 全站 JavaScript 语法体检（node --check，零依赖）
console.log('\n🔎 JS 语法体检...');
const { spawnSync } = require('child_process');

function walk(dir, exts, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.includes(path.extname(name))) out.push(full);
  }
  return out;
}

const jsFiles = walk(__dirname, ['.js', '.cjs']);
let jsBroken = 0;
jsFiles.forEach((file) => {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`❌ 语法错误: ${path.relative(__dirname, file)}\n${(r.stderr || '').trim()}\n`);
    errors++;
    jsBroken++;
  }
});
console.log(jsBroken === 0 ? `✅ ${jsFiles.length} 个 JS 文件语法全部通过` : `❌ ${jsBroken} 个文件语法失败`);

// 4. 模块目录 ↔ modules.js 双向核对（原校验只做了“登记 → 磁盘”方向）
console.log('\n🔎 模块目录与登记表双向核对...');
const registeredDirs = new Set(modules.map((m) => String(m.path).split('/')[0]));
const dirCount = { total: 0, orphan: 0 };
fs.readdirSync(__dirname, { withFileTypes: true }).forEach((d) => {
  if (!d.isDirectory() || d.name.startsWith('.')) return;
  dirCount.total++;
  if (!fs.existsSync(path.join(__dirname, d.name, 'index.html'))) return; // 非模块目录
  if (!registeredDirs.has(d.name)) {
    console.warn(`⚠️  目录 "${d.name}" 有 index.html，但未登记到 modules.js（门厅看不到它）`);
    warnings++;
    dirCount.orphan++;
  }
});
console.log(dirCount.orphan === 0 ? `✅ ${dirCount.total} 个目录无游离模块` : `⚠️  ${dirCount.orphan} 个游离模块目录`);

// 5. 模块内部相对链接死链体检（原先只查 modules.js 里的 path）
console.log('\n🔎 模块内相对链接死链体检...');
let refCount = 0;
// 不只扫已登记模块：只要目录里有 index.html 就扫（未登记的已在第 4 节报警）
const htmlEntryList = fs.readdirSync(__dirname, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => path.join(d.name, 'index.html'))
  .filter((rel) => fs.existsSync(path.join(__dirname, rel)));
htmlEntryList.forEach((rel) => {
  const htmlPath = path.join(__dirname, rel);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dir = path.dirname(htmlPath);
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((x) => x[1]);
  refs.forEach((ref) => {
    if (/^(https?:)?\/\//i.test(ref)) return;          // 外链交给 CDN 体检
    if (/^(#|data:|mailto:|javascript:|tel:)/i.test(ref)) return;
    if (ref.includes('${')) return;                    // 模板字符串，运行时才展开
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) return;
    refCount++;
    if (!fs.existsSync(path.resolve(dir, clean))) {
      console.error(`❌ ${rel} 死链: ${ref}`);
      errors++;
    }
  });
});
console.log(`✅ ${htmlEntryList.length} 个模块页共检查 ${refCount} 条相对引用`);

// 6. CDN 黄金配方版本一致性（AGENTS.md §5.2）
console.log('\n🔎 CDN 版本一致性体检...');
const htmlFiles = walk(__dirname, ['.html']);
const CDN_RULES = [
  { name: 'KaTeX', test: /katex/i, expect: /0\.16\.11/ },
  { name: 'GSAP', test: /gsap/i, expect: /3\.12\.5/ },
  { name: 'Three.js', test: /three/i, expect: /r128|0\.128\.0/ }
];
let cdnOff = 0;
htmlFiles.forEach((file) => {
  const html = fs.readFileSync(file, 'utf8');
  [...html.matchAll(/https:\/\/[^"'\s)]+/g)].forEach((x) => {
    const url = x[0];
    CDN_RULES.forEach((rule) => {
      if (rule.test.test(url) && !rule.expect.test(url)) {
        console.warn(`⚠️  ${rule.name} 版本偏离黄金配方: ${path.relative(__dirname, file)} -> ${url}`);
        warnings++;
        cdnOff++;
      }
    });
  });
});
console.log(cdnOff === 0 ? '✅ CDN 版本与黄金配方一致' : `⚠️  ${cdnOff} 处 CDN 版本偏离`);

// 7. README 模块数与登记表核对（首段“项目涵盖 N 个”是对外说明，须与登记表一致）
console.log('\n🔎 README 模块数核对...');
const readmeFile = path.join(__dirname, 'README.md');
const readmeCount = fs.existsSync(readmeFile)
  ? fs.readFileSync(readmeFile, 'utf8').match(/项目涵盖\s*\*\*(\d+)\s*个\*\*/)
  : null;
if (!readmeCount) {
  console.error('❌ README.md 中找不到“项目涵盖 **N 个**”模块数声明，请同步修改 verify.js 的核对规则。');
  errors++;
} else if (Number(readmeCount[1]) !== modules.length) {
  console.error(`❌ README.md 写的模块数为 ${readmeCount[1]}，登记表共 ${modules.length} 个，请同步修改 README.md。`);
  errors++;
} else {
  console.log(`✅ README 模块数与登记表一致（${modules.length} 个）`);
}

// 8. 文档引用体检：规范文档里的相对链接必须可达，动效选择表的编号必须都在动效库里
console.log('\n🔎 文档引用与动效编号体检...');
const docFiles = [
  path.join(__dirname, 'AGENTS.md'),
  path.join(__dirname, 'DESIGN_SYSTEM.md'),
  path.join(__dirname, 'README.md'),
  ...fs.readdirSync(path.join(__dirname, 'docs'))
    .filter((name) => name.endsWith('.md') && name !== '设计方案.md') // 本地设计方案不纳入 Git，不参与检查
    .map((name) => path.join(__dirname, 'docs', name)),
];
let refBroken = 0;
function checkRefs(file, base) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [, ref] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/i.test(ref)) continue;
    const clean = ref.split('#')[0];
    const target = path.resolve(base, clean);
    if (!target.startsWith(__dirname + path.sep)) continue; // 仓库之外的上级资料不在此检查
    if (!fs.existsSync(target)) {
      console.error(`❌ ${path.relative(__dirname, file)} 死链: ${ref}`);
      errors++;
      refBroken++;
    }
  }
}
docFiles.forEach((file) => checkRefs(file, path.dirname(file)));
// 模板会被复制到模块目录，链接按模块目录解析（这里用一个虚拟的模块目录模拟）
checkRefs(path.join(__dirname, 'tools', 'scaffold', '设计方案.md'), path.join(__dirname, '__module__'));
const designText = fs.readFileSync(path.join(__dirname, 'DESIGN_SYSTEM.md'), 'utf8');
const pickerSection = (designText.split('### 小动效选择')[1] || '').split('## §9')[0];
const libraryIds = new Set([...fs.readFileSync(path.join(__dirname, 'docs', 'motion-library.md'), 'utf8')
  .matchAll(/^#### ([A-G]\d) /gm)].map((m) => m[1]));
// 只取选择表第二列每段开头的编号，避免把“P5”这类其他引用误判
const pickerIds = new Set();
for (const line of pickerSection.split('\n').filter((row) => row.startsWith('|'))) {
  (line.split('|')[2] || '').split('、').forEach((segment) => {
    const token = segment.trim().split(/\s/)[0];
    if (/^[A-Z]\d$/.test(token)) pickerIds.add(token);
  });
}
for (const id of pickerIds) {
  if (!libraryIds.has(id)) {
    console.error(`❌ DESIGN_SYSTEM §8 引用的动效编号 ${id} 在 docs/motion-library.md 中不存在`);
    errors++;
    refBroken++;
  }
}
console.log(refBroken === 0 ? '✅ 文档链接与动效编号全部可达' : `❌ 文档引用问题 ${refBroken} 处`);

// 9. 模块 choreo.js 文件头的动效选用：写了就必须是动效库里的编号；没写的只给一条汇总警告（现有模块暂不强制，见 DESIGN_SYSTEM §11）
console.log('\n🔎 choreo.js 动效选用体检...');
const motionMissing = [];
let motionCount = 0;
for (const dir of fs.readdirSync(__dirname, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
  const choreoFile = path.join(__dirname, dir.name, 'choreo.js');
  if (!fs.existsSync(choreoFile)) continue;
  motionCount++;
  const head = fs.readFileSync(choreoFile, 'utf8').split('\n').slice(0, 30);
  const line = head.find((row) => /动效选用[:：]/.test(row));
  if (!line) {
    motionMissing.push(dir.name);
    continue;
  }
  const idText = line.split(/[:：]/).slice(1).join('：').split(/[（(]/)[0];
  const ids = [...idText.matchAll(/\b([A-Z]\d)\b/g)].map((m) => m[1]);
  if (ids.length === 0) {
    console.error(`❌ ${dir.name}/choreo.js 的「动效选用」后面没有编号`);
    errors++;
  }
  for (const id of ids) {
    if (!libraryIds.has(id)) {
      console.error(`❌ ${dir.name}/choreo.js 的动效编号 ${id} 不在 docs/motion-library.md 中`);
      errors++;
    }
  }
}
if (motionMissing.length > 0) {
  console.warn(`⚠️  ${motionMissing.length} 个 choreo.js 还没有「动效选用」文件头（现有模块暂不强制）：${motionMissing.join('、')}`);
  warnings++;
}
console.log(`📋 共 ${motionCount} 个 choreo.js，其中 ${motionCount - motionMissing.length} 个已写文件头`);

// 10. 输出汇总统计
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
