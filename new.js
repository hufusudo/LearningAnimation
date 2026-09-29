/**
 * LearningAnimation 演示模块一键初始化脚手架
 * 用法: node new.js <模块目录名> <学科标识: math|prob|ds|co|os|net> [特性标签]
 * 示例: node new.js "TCP流量控制与滑动窗口" net "滑动窗口 · 拥塞控制"
 * 
 * 纯原生 Node.js 实现，零外部依赖
 */
const fs = require('fs');
const path = require('path');

const DISCIPLINE_MAP = {
  math: '高等数学',
  prob: '概率论与数理统计',
  ds: '数据结构',
  co: '计算机组成原理',
  os: '计算机操作系统',
  net: '计算机网络'
};

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('\n❌ 参数不足！');
  console.log('📖 用法: node new.js <模块目录名> <学科标识: math|prob|ds|co|os|net> [技术特性标签]');
  console.log('👉 示例: node new.js "TCP流量控制" net "双向滑动窗口"\n');
  process.exit(1);
}

const modName = args[0].trim();
const discipline = args[1].trim().toLowerCase();
const badge = (args[2] || '60fps 缓动 · 交互式').trim();

if (!DISCIPLINE_MAP[discipline]) {
  console.error(`\n❌ 无效的学科标识: "${discipline}"`);
  console.error(`合法标识为: ${Object.keys(DISCIPLINE_MAP).join(', ')}\n`);
  process.exit(1);
}

const discName = DISCIPLINE_MAP[discipline];
const targetDir = path.join(__dirname, modName);

if (fs.existsSync(targetDir)) {
  console.error(`\n❌ 目录已存在: ${targetDir}，为避免误覆盖已终止。\n`);
  process.exit(1);
}

// 1. 创建模块目录
fs.mkdirSync(targetDir, { recursive: true });

// 2. 生成 index.html
const indexHtmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${modName} · 可视化实验室</title>

  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>

  <!-- GSAP CDN -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>

  <!-- KaTeX CDN (如需数学公式渲染请解开) -->
  <!--
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
  -->

  <!-- Three.js CDN (如需3D三维场景请解开) -->
  <!--
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
  -->

  <link rel="stylesheet" href="style.css">
</head>
<body class="min-h-screen bg-[#FAF9F5] text-stone-900 flex flex-col justify-between antialiased selection:bg-stone-200">

  <!-- 顶部导航条 -->
  <header class="border-b border-[#E5E4DC] bg-[#FAF9F5]/90 backdrop-blur sticky top-0 z-30 px-4 lg:px-8 py-3">
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <a href="../index.html#${discipline}" class="text-xs font-mono text-stone-600 hover:text-stone-900 border border-[#E5E4DC] bg-white px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors shadow-sm" title="返回${discName}">
          <span>&larr; 返回${discName}</span>
        </a>
        <div class="h-4 w-[1px] bg-stone-300 hidden sm:block"></div>
        <h1 class="text-base font-semibold tracking-tight text-stone-900 truncate">
          ${modName}
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-mono px-2 py-0.5 rounded border border-[#E5E4DC] bg-white text-stone-600">
          ${discName}
        </span>
      </div>
    </div>
  </header>

  <!-- 主交互视窗与控制面板 -->
  <main class="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col gap-6">
    
    <!-- 顶部非对称几何圆角与点阵微光卡片 -->
    <div class="relative overflow-hidden rounded-2xl rounded-tl-3xl rounded-br-3xl border border-[#E5E4DC] bg-white p-4 lg:p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.03]">
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(#CBD5E1_1.2px,transparent_1.2px)] bg-[size:14px_14px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_50%,#000_60%,transparent_100%)]"></div>
      <div class="relative z-10 flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-stone-100">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <h2 class="text-xs font-semibold tracking-wider text-stone-700 uppercase">交互演示导引</h2>
        </div>
        <span class="text-[11px] font-mono text-stone-400">DESIGN SYSTEM READY</span>
      </div>
      <p class="relative z-10 pt-3 text-xs text-stone-600 leading-relaxed font-sans">
        这里是【${modName}】核心交互演示区。已就绪浅色纸质微网格画布、光束边框 CTA 与 3-Stage 动效管线。
      </p>
    </div>

    <!-- 演示主画布/工作区容器 (带工程制图 18px 细线微网格与天青/琥珀双层极淡径向柔光) -->
    <div id="stage-container" class="relative w-full min-h-[480px] rounded-2xl border border-[#E5E4DC] bg-[#FAF9F5] overflow-hidden shadow-sm flex items-center justify-center p-6">
      <!-- 顶部天青柔光晕 -->
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_650px_at_50%_0px,rgba(56,189,248,0.09),transparent)]"></div>
      <!-- 右下琥珀微光晕 -->
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_450px_at_85%_70%,rgba(245,158,11,0.06),transparent)]"></div>
      <!-- 工程制图 18px 微网格 -->
      <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.035)_1px,transparent_1px)] bg-[size:18px_18px]"></div>

      <div class="relative z-10 text-center space-y-2 text-stone-500 font-mono text-xs">
        <p class="font-semibold text-stone-700">🎨 浅色微网格舞台已就绪 (#stage-container)</p>
        <p class="text-stone-400">可自主使用 Canvas 2D / Three.js 3D / SVG / DOM 树驱动交互动画</p>
      </div>
    </div>

    <!-- 控制栏 HUD -->
    <div class="bg-white border border-[#E5E4DC] rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
      <div class="flex items-center gap-2 text-xs">
        <!-- 浅色磨砂旋转光束 CTA 按钮 -->
        <button id="btn-play" class="group relative inline-flex items-center gap-2 px-4 py-2 rounded-full overflow-hidden text-xs font-medium text-stone-800 bg-white/80 backdrop-blur-md shadow-[0_2px_12px_rgba(37,99,235,0.12)] hover:shadow-[0_4px_20px_rgba(37,99,235,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all">
          <div class="absolute inset-[-150%] w-[400%] h-[400%] pointer-events-none [animation:beam-spin_4s_linear_infinite]">
            <div class="w-full h-full [background:conic-gradient(from_0deg,transparent_0_300deg,rgba(37,99,235,0.45)_340deg,transparent_360deg)]"></div>
          </div>
          <div class="absolute inset-[1px] rounded-full bg-white/90 backdrop-blur-sm pointer-events-none"></div>
          <span id="btn-play-icon" class="relative z-10 text-blue-600">▶</span>
          <span id="btn-play-text" class="relative z-10 font-sans tracking-wide">自动演进</span>
        </button>

        <!-- 双层陶瓷质感物理微按键 -->
        <button id="btn-step" class="tactile-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E4DC] bg-gradient-to-b from-white to-[#F7F6F0] text-xs font-mono font-medium text-stone-700 shadow-[0_1.5px_0_#D6D3CD] hover:bg-stone-50 hover:text-stone-900 active:shadow-none active:translate-y-[1.5px] transition-all select-none">
          <span>⏭ 单步前进</span>
        </button>
        <button id="btn-reset" class="tactile-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E4DC] bg-gradient-to-b from-white to-[#F7F6F0] text-xs font-mono font-medium text-stone-600 shadow-[0_1.5px_0_#D6D3CD] hover:bg-stone-50 hover:text-stone-900 active:shadow-none active:translate-y-[1.5px] transition-all select-none">
          <span>↺ 复位</span>
        </button>
      </div>

      <!-- 速率控制器与纸质滑块示例 -->
      <div class="flex items-center gap-3 text-xs font-mono text-stone-500">
        <span>速度:</span>
        <input id="slider-speed" type="range" min="0.5" max="2" step="0.5" value="1" class="taste-slider w-20">
        <span id="label-speed">1.0x</span>
      </div>
    </div>
  </main>

  <footer class="border-t border-[#E5E4DC] py-4 text-center text-xs font-mono text-stone-400">
    LearningAnimation · 浅色纸质美学与 60fps 动量连续性
  </footer>

  <script src="app.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(targetDir, 'index.html'), indexHtmlContent, 'utf8');

// 3. 生成 style.css
const styleCssContent = `/* ${modName} 专属样式 (Taste-Skill Light Editorial & Cyber-Paper) */
:root {
  --bg-page: #FAF9F5;
  --border-main: #E5E4DC;
  --border-strong: #D6D3CD;
  --accent-blue: #2563EB;
  --accent-emerald: #059669;
  --accent-amber: #D97706;
}

/* 旋转光束动效 */
@keyframes beam-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 纸质质感滑块 */
.taste-slider {
  -webkit-appearance: none;
  appearance: none;
  height: 3px;
  background: #E5E4DC;
  border-radius: 9999px;
  outline: none;
}
.taste-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #FFFFFF;
  border: 2px solid #1C1917;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  transition: transform 0.15s ease;
}
.taste-slider::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}
`;

fs.writeFileSync(path.join(targetDir, 'style.css'), styleCssContent, 'utf8');

// 4. 生成 app.js
const appJsContent = `/**
 * ${modName} 核心交互逻辑与动效状态机
 * 遵循 3-Stage 转场动效管线 (Outro -> Pivot -> Intro)
 */
(function() {
  'use strict';

  // 状态机定义
  const State = {
    isPlaying: false,
    speed: 1.0,
    currentStep: 0,
    totalSteps: 5
  };

  /**
   * 3阶段平滑状态切换控制器 (refs 标准)
   */
  function runThreeStageTransition({ oldEl, newEl, pivotEl, onMidpoint }) {
    if (!window.gsap) return;
    gsap.killTweensOf('*');

    const tl = gsap.timeline();
    // 1. Outro (退场，150ms)
    if (oldEl) {
      tl.to(oldEl, { opacity: 0, y: -8, scale: 0.98, duration: 0.15 / State.speed, ease: "power2.in" });
    }
    // 2. Pivot (核心枢纽旋转，300ms)
    if (pivotEl) {
      tl.to(pivotEl, { rotationY: 90, duration: 0.15 / State.speed, ease: "power2.in", onComplete: onMidpoint })
        .to(pivotEl, { rotationY: 0, duration: 0.2 / State.speed, ease: "expo.out" });
    } else if (onMidpoint) {
      onMidpoint();
    }
    // 3. Intro (新视图入定，350ms，零回弹)
    if (newEl) {
      gsap.set(newEl, { opacity: 0, y: 12, scale: 0.98 });
      tl.to(newEl, { opacity: 1, y: 0, scale: 1, duration: 0.35 / State.speed, ease: "power4.out" });
    }
    return tl;
  }

  function init() {
    console.log('🚀 [${modName}] 模块初始化就绪');
    bindEvents();
  }

  function bindEvents() {
    const btnPlay = document.getElementById('btn-play');
    const btnPlayText = document.getElementById('btn-play-text');
    const btnPlayIcon = document.getElementById('btn-play-icon');
    const btnStep = document.getElementById('btn-step');
    const btnReset = document.getElementById('btn-reset');
    const sliderSpeed = document.getElementById('slider-speed');
    const labelSpeed = document.getElementById('label-speed');

    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        State.isPlaying = !State.isPlaying;
        if (btnPlayText) btnPlayText.innerText = State.isPlaying ? '暂停演进' : '自动演进';
        if (btnPlayIcon) btnPlayIcon.innerText = State.isPlaying ? '⏸' : '▶';
      });
    }

    if (btnStep) {
      btnStep.addEventListener('click', () => {
        if (window.gsap) gsap.killTweensOf('*');
        // 单步逻辑...
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (window.gsap) gsap.killTweensOf('*');
        State.isPlaying = false;
        State.currentStep = 0;
        if (btnPlayText) btnPlayText.innerText = '自动演进';
        if (btnPlayIcon) btnPlayIcon.innerText = '▶';
      });
    }

    if (sliderSpeed) {
      sliderSpeed.addEventListener('input', (e) => {
        State.speed = parseFloat(e.target.value);
        if (labelSpeed) labelSpeed.innerText = State.speed.toFixed(1) + 'x';
      });
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
`;

fs.writeFileSync(path.join(targetDir, 'app.js'), appJsContent, 'utf8');

// 5. 自动追加登记到 modules.js
const modulesFile = path.join(__dirname, 'modules.js');
const modulesText = fs.readFileSync(modulesFile, 'utf8');
const rawJson = modulesText.replace(/[\s\S]*?window\.MODULES\s*=\s*/, '').replace(/;\s*$/, '');
let modulesList = [];
try {
  modulesList = JSON.parse(rawJson);
} catch (e) {
  eval('modulesList = ' + rawJson);
}

const newItem = {
  title: modName,
  discipline: discipline,
  path: `${modName}/index.html`,
  badge: badge,
  desc: `【${modName}】交互式教学可视化系统。直击知识点物理本质与状态机演进。`,
  formula: `${discName} · 核心直观`
};

modulesList.push(newItem);

fs.writeFileSync(modulesFile, '/**\n * 演示项目全局数据注册表 (modules.js)\n * 新增模块只需在此数组末尾追加一个对象即可，无需修改 index.html\n */\nwindow.MODULES = ' + JSON.stringify(modulesList, null, 2) + ';\n', 'utf8');

console.log(`\n🎉 成功创建模块目录: ${modName}/`);
console.log(`  ├── index.html (已包含返回大厅导航与标准视口)`);
console.log(`  ├── style.css  (已注入纸质滑块与色彩底线)`);
console.log(`  └── app.js     (已注入基础状态机骨架与清理逻辑)`);
console.log(`✅ 已在 modules.js 中自动完成挂载登记 (第 ${modulesList.length} 个模块)。\n`);
