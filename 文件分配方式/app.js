/**
 * 文件分配方式 (连续分配 / 隐式链接 / 显式链接 FAT / 索引分配 / 对比模式)
 * 核心交互动画引擎 - 60fps 缓动无跳变过渡架构
 * 包含：平滑有向箭头绘制、飞行探针(Flying Probe)、FAT表内有向箭头、多级索引层级连线
 */

// ============================================================
// 1. 全局数据结构与初始状态
// ============================================================

const TOTAL_BLOCKS = 40; // 0 ~ 39

const State = {
  mode: 'contiguous', // 'contiguous' | 'implicit' | 'fat' | 'indexed' | 'comparison'
  indexLevel: 'single', // 'single' | 'double' | 'triple'
  speed: 1.0, // 0.5, 1.0, 2.0
  isPlaying: false,
  isAnimating: false,
  timer: null,

  // 磁盘块状态数组 (0~39)
  blocks: [],

  // 文件记录字典
  files: {},

  // FAT 表 (40项)
  fatTable: [],

  // 当前正在执行的动作节拍序列
  currentAction: null,
  currentStepIndex: 0,

  // 统计与计数
  ioCount: 0,
};

// 预设默认文件数据 (符合题目标准用例：起始块 8，离散块 8, 13, 2, 19, 7，索引块 30)
const PRESET_FILES = {
  A: {
    name: '文件 A',
    contiguous: { start: 8, length: 5, blocks: [8, 9, 10, 11, 12] },
    implicit: { start: 8, end: 7, length: 5, blocks: [8, 13, 2, 19, 7] },
    fat: { start: 8, length: 5, blocks: [8, 13, 2, 19, 7] },
    indexed: {
      single: { indexBlock: 30, blocks: [8, 13, 2, 19, 7] },
      double: { l1Index: 30, l2Index: 31, blocks: [8, 13, 2, 19, 7] },
      triple: { l1Index: 30, l2Index: 31, l3Index: 32, blocks: [8, 13, 2, 19, 7] }
    }
  },
  B: {
    name: '文件 B',
    contiguous: { start: 20, length: 4, blocks: [20, 21, 22, 23] },
    implicit: { start: 22, end: 35, length: 4, blocks: [22, 28, 33, 35] },
    fat: { start: 22, length: 4, blocks: [22, 28, 33, 35] },
    indexed: {
      single: { indexBlock: 1, blocks: [22, 28, 33, 35] },
      double: { l1Index: 1, l2Index: 3, blocks: [22, 28, 33, 35] },
      triple: { l1Index: 1, l2Index: 3, l3Index: 5, blocks: [22, 28, 33, 35] }
    }
  },
  C: {
    name: '文件 C',
    contiguous: { start: 34, length: 3, blocks: [34, 35, 36] },
    implicit: { start: 15, end: 26, length: 3, blocks: [15, 21, 26] },
    fat: { start: 15, length: 3, blocks: [15, 21, 26] },
    indexed: {
      single: { indexBlock: 38, blocks: [15, 21, 26] },
      double: { l1Index: 38, l2Index: 39, blocks: [15, 21, 26] },
      triple: { l1Index: 38, l2Index: 39, l3Index: 27, blocks: [15, 21, 26] }
    }
  }
};

// ============================================================
// 2. 初始化与主入口
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initSystem();
});

function initSystem() {
  resetDiskState();
  initDiskDOM();
  bindUIEvents();
  renderCurrentMode();
  addLog('系统就绪', '文件分配方式教学系统初始化完毕，磁盘共有 40 个空闲块 (0~39)。');
  
  // 监听窗口尺寸变化和滚动，自适应重绘连线
  window.addEventListener('resize', debounce(redrawActiveConnections, 100));
  window.addEventListener('scroll', debounce(redrawActiveConnections, 100));
}

/**
 * 重置磁盘与内存数据
 */
function resetDiskState() {
  State.blocks = [];
  for (let i = 0; i < TOTAL_BLOCKS; i++) {
    State.blocks.push({
      id: i,
      status: 'free', // 'free' | 'allocated' | 'index' | 'index-l2' | 'index-l3'
      file: null,
      blockIdx: null,
      next: null,
      isIndex: false,
    });
  }

  State.files = {};
  State.fatTable = new Array(TOTAL_BLOCKS).fill('FREE');
  State.currentAction = null;
  State.currentStepIndex = 0;
  State.ioCount = 0;
  stopPlay();
}

/**
 * 初始化磁盘网格 DOM
 */
function initDiskDOM() {
  const container = document.getElementById('disk-grid-element');
  container.innerHTML = '';

  for (let i = 0; i < TOTAL_BLOCKS; i++) {
    const el = document.createElement('div');
    el.id = `disk-block-${i}`;
    el.className = 'disk-block free';
    el.onclick = () => onDiskBlockClicked(i);

    el.innerHTML = `
      <span class="block-header-num">${i}</span>
      <span class="block-body-text" id="block-body-${i}">空闲</span>
      <span class="block-footer-tag" id="block-footer-${i}"></span>
    `;
    container.appendChild(el);
  }
}

/**
 * 绑定界面按键事件
 */
function bindUIEvents() {
  // 播放控制
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-prev').addEventListener('click', stepPrev);
  document.getElementById('btn-next').addEventListener('click', stepNext);
  document.getElementById('btn-reset').addEventListener('click', () => {
    resetDiskState();
    clearSvgArrows();
    clearFlyingProbes();
    renderCurrentMode();
    addLog('重置', '系统已重置为全空闲状态。');
  });

  // 速度调节
  document.getElementById('speed-05').addEventListener('click', () => setSpeed(0.5));
  document.getElementById('speed-10').addEventListener('click', () => setSpeed(1.0));
  document.getElementById('speed-20').addEventListener('click', () => setSpeed(2.0));

  // 文件操作按钮
  document.getElementById('btn-create-file').addEventListener('click', handleCreateFile);
  document.getElementById('btn-delete-file').addEventListener('click', handleDeleteFile);
  document.getElementById('btn-access-k').addEventListener('click', handleAccessK);
  document.getElementById('btn-feature-demo').addEventListener('click', handleFeatureDemo);
  document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('log-container').innerHTML = '';
  });

  // 对比模式专用按钮
  document.getElementById('btn-comp-create').addEventListener('click', runComparisonCreate);
  document.getElementById('btn-comp-access').addEventListener('click', runComparisonAccess);
  document.getElementById('btn-comp-reset').addEventListener('click', resetComparisonMode);
}

// ============================================================
// 3. 模式切换与渲染器
// ============================================================

function switchMode(modeKey) {
  if (State.isAnimating && State.isPlaying) {
    stopPlay();
  }

  State.mode = modeKey;
  clearSvgArrows();
  clearFlyingProbes();

  // 更新顶部选项卡激活状态
  ['contiguous', 'implicit', 'fat', 'indexed', 'comparison'].forEach(m => {
    const btn = document.getElementById(`tab-${m}`);
    if (m === modeKey) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 切换视图面板
  const singleView = document.getElementById('single-mode-view');
  const compView = document.getElementById('comparison-mode-view');
  const indexLevelBox = document.getElementById('index-level-container');
  const featureDemoBtn = document.getElementById('btn-feature-demo');
  const featureIcon = document.getElementById('feature-demo-icon');
  const featureText = document.getElementById('feature-demo-text');

  if (modeKey === 'comparison') {
    singleView.classList.add('hidden');
    compView.classList.remove('hidden');
    indexLevelBox.classList.add('hidden');
    featureDemoBtn.classList.add('hidden');
    initComparisonView();
  } else {
    singleView.classList.remove('hidden');
    compView.classList.add('hidden');
    featureDemoBtn.classList.remove('hidden');

    if (modeKey === 'indexed') {
      indexLevelBox.classList.remove('hidden');
      featureIcon.textContent = '📑';
      featureText.textContent = '多级索引解析';
    } else if (modeKey === 'contiguous') {
      indexLevelBox.classList.add('hidden');
      featureIcon.textContent = '⚠️';
      featureText.textContent = '外部碎片演示';
    } else if (modeKey === 'implicit') {
      indexLevelBox.classList.add('hidden');
      featureIcon.textContent = '⚡';
      featureText.textContent = '指针断链演示';
    } else if (modeKey === 'fat') {
      indexLevelBox.classList.add('hidden');
      featureIcon.textContent = '💾';
      featureText.textContent = 'FAT表跳转演示';
    }

    resetDiskState();
    renderCurrentMode();
  }

  addLog('切换模式', `已切换至：${getModeDisplayName(modeKey)}`);
}

function switchIndexLevel(level) {
  if (State.isAnimating && State.isPlaying) stopPlay();
  State.indexLevel = level;
  ['single', 'double', 'triple'].forEach(lvl => {
    const btn = document.getElementById(`idx-${lvl}`);
    if (lvl === level) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  resetDiskState();
  clearSvgArrows();
  clearFlyingProbes();
  renderCurrentMode();
  addLog('索引级数切换', `当前为：${level === 'single' ? '单级索引' : level === 'double' ? '二级索引' : '三级索引'}`);
}

function getModeDisplayName(modeKey) {
  switch (modeKey) {
    case 'contiguous': return '1. 连续分配 (Contiguous Allocation)';
    case 'implicit': return '2. 隐式链接 (Implicit Linked Allocation)';
    case 'fat': return '3. 显式链接 (File Allocation Table / FAT)';
    case 'indexed': return '4. 索引分配 (Indexed Allocation)';
    case 'comparison': return '⚖️ 四种分配方式综合对比模式';
    default: return modeKey;
  }
}

/**
 * 渲染当前单模式的磁盘网格与元数据区域
 */
function renderCurrentMode() {
  renderDiskGrid();
  renderDirectoryTable();
  renderMetadataPanel();
  renderTimelineBar();
  updateDiskStats();
}

/**
 * 刷新磁盘网格各块的状态与内容
 */
function renderDiskGrid() {
  for (let i = 0; i < TOTAL_BLOCKS; i++) {
    const blk = State.blocks[i];
    const el = document.getElementById(`disk-block-${i}`);
    const bodyEl = document.getElementById(`block-body-${i}`);
    const footerEl = document.getElementById(`block-footer-${i}`);

    if (!el) continue;

    // 清理高亮与样式
    el.className = 'disk-block';

    if (blk.status === 'free') {
      el.classList.add('free');
      bodyEl.textContent = '空闲';
      footerEl.textContent = '';
    } else if (blk.status === 'allocated') {
      el.classList.add('allocated');
      bodyEl.textContent = `${blk.file}[${blk.blockIdx}]`;
      if (State.mode === 'implicit') {
        footerEl.textContent = blk.next === 'EOF' ? 'EOF' : `→${blk.next}`;
      } else {
        footerEl.textContent = '';
      }
    } else if (blk.status === 'index') {
      el.classList.add('index-block');
      bodyEl.textContent = `Idx ${blk.file}`;
      footerEl.textContent = '1级索引';
    } else if (blk.status === 'index-l2') {
      el.classList.add('index-l2');
      bodyEl.textContent = `L2 ${blk.file}`;
      footerEl.textContent = '2级索引';
    } else if (blk.status === 'index-l3') {
      el.classList.add('index-l3');
      bodyEl.textContent = `L3 ${blk.file}`;
      footerEl.textContent = '3级索引';
    }
  }

  // 渲染连续条
  renderContiguousSpans();
}

/**
 * 渲染连续分配的横向连续条/大括号 (带平滑展开动画)
 */
function renderContiguousSpans(animate = false) {
  const container = document.getElementById('contiguous-span-container');
  container.innerHTML = '';
  if (State.mode !== 'contiguous') return;

  Object.values(State.files).forEach(f => {
    if (f.start === undefined) return;
    const startEl = document.getElementById(`disk-block-${f.start}`);
    const endEl = document.getElementById(`disk-block-${f.start + f.length - 1}`);
    if (!startEl || !endEl) return;

    const gridEl = document.getElementById('disk-grid-element');
    const gridRect = gridEl.getBoundingClientRect();
    const startRect = startEl.getBoundingClientRect();
    const endRect = endEl.getBoundingClientRect();

    if (Math.abs(startRect.top - endRect.top) < 18) {
      const span = document.createElement('div');
      span.id = `span-bar-${f.name}`;
      span.className = 'absolute flex items-center justify-between text-[11px] font-mono font-bold text-rose-700 bg-rose-100/95 border border-rose-300 rounded px-2 py-0.5 shadow-sm transition-all pointer-events-none z-20';
      span.style.left = `${startRect.left - gridRect.left}px`;
      span.style.top = `${startRect.top - gridRect.top - 22}px`;
      span.style.width = `${endRect.right - startRect.left}px`;
      span.innerHTML = `<span>❲ ${f.name}</span><span>起始块 ${f.start}，长度 ${f.length} ❳</span>`;
      container.appendChild(span);

      if (animate) {
        gsap.fromTo(span, 
          { scaleX: 0, opacity: 0, transformOrigin: 'left center' }, 
          { scaleX: 1, opacity: 1, duration: 0.5 / State.speed, ease: 'power2.out' }
        );
      }
    }
  });
}

/**
 * 渲染右侧目录表
 */
function renderDirectoryTable() {
  const thead = document.getElementById('dir-table-head');
  const tbody = document.getElementById('dir-table-body');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  let headHtml = '';
  if (State.mode === 'contiguous') {
    headHtml = `
      <tr>
        <th class="p-2">文件名</th>
        <th class="p-2">起始盘块号</th>
        <th class="p-2">连续长度</th>
        <th class="p-2">物理范围</th>
        <th class="p-2 text-right">操作</th>
      </tr>
    `;
  } else if (State.mode === 'implicit') {
    headHtml = `
      <tr>
        <th class="p-2">文件名</th>
        <th class="p-2">起始盘块号</th>
        <th class="p-2">结束盘块号</th>
        <th class="p-2">总块数</th>
        <th class="p-2 text-right">操作</th>
      </tr>
    `;
  } else if (State.mode === 'fat') {
    headHtml = `
      <tr>
        <th class="p-2">文件名</th>
        <th class="p-2">起始盘块号</th>
        <th class="p-2">总块数</th>
        <th class="p-2">指针位置</th>
        <th class="p-2 text-right">操作</th>
      </tr>
    `;
  } else if (State.mode === 'indexed') {
    headHtml = `
      <tr>
        <th class="p-2">文件名</th>
        <th class="p-2">顶级索引块</th>
        <th class="p-2">索引级数</th>
        <th class="p-2">数据块数</th>
        <th class="p-2 text-right">操作</th>
      </tr>
    `;
  }
  thead.innerHTML = headHtml;

  const fileList = Object.values(State.files);
  if (fileList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="p-3 text-center text-stone-400 italic font-sans text-xs">
          当前文件系统为空，请点击上方「➕ 创建文件」
        </td>
      </tr>
    `;
    return;
  }

  fileList.forEach(f => {
    const tr = document.createElement('tr');
    tr.id = `dir-row-${f.name}`;
    tr.className = 'hover:bg-stone-50 transition-colors';

    let bodyHtml = '';
    if (State.mode === 'contiguous') {
      bodyHtml = `
        <td class="p-2 font-bold text-stone-900">${f.name}</td>
        <td class="p-2 font-semibold text-rose-600">${f.start}</td>
        <td class="p-2 text-stone-600">${f.length} 块</td>
        <td class="p-2 text-stone-400">${f.start} ~ ${f.start + f.length - 1}</td>
        <td class="p-2 text-right">
          <button onclick="quickAccessFile('${f.name}', 3)" class="text-amber-600 hover:text-amber-800 font-bold mr-2 text-[11px]">访第3块</button>
          <button onclick="quickDeleteFile('${f.name}')" class="text-rose-600 hover:text-rose-800 font-bold text-[11px]">删除</button>
        </td>
      `;
    } else if (State.mode === 'implicit') {
      bodyHtml = `
        <td class="p-2 font-bold text-stone-900">${f.name}</td>
        <td class="p-2 font-semibold text-orange-600">${f.start}</td>
        <td class="p-2 font-semibold text-stone-700">${f.end}</td>
        <td class="p-2 text-stone-600">${f.blocks.length} 块</td>
        <td class="p-2 text-right">
          <button onclick="quickAccessFile('${f.name}', 3)" class="text-amber-600 hover:text-amber-800 font-bold mr-2 text-[11px]">访第3块</button>
          <button onclick="quickDeleteFile('${f.name}')" class="text-rose-600 hover:text-rose-800 font-bold text-[11px]">删除</button>
        </td>
      `;
    } else if (State.mode === 'fat') {
      bodyHtml = `
        <td class="p-2 font-bold text-stone-900">${f.name}</td>
        <td class="p-2 font-semibold text-purple-600">${f.start}</td>
        <td class="p-2 text-stone-600">${f.blocks.length} 块</td>
        <td class="p-2 text-stone-400">常驻内存 FAT</td>
        <td class="p-2 text-right">
          <button onclick="quickAccessFile('${f.name}', 3)" class="text-amber-600 hover:text-amber-800 font-bold mr-2 text-[11px]">访第3块</button>
          <button onclick="quickDeleteFile('${f.name}')" class="text-rose-600 hover:text-rose-800 font-bold text-[11px]">删除</button>
        </td>
      `;
    } else if (State.mode === 'indexed') {
      bodyHtml = `
        <td class="p-2 font-bold text-stone-900">${f.name}</td>
        <td class="p-2 font-semibold text-blue-600">块 ${f.indexBlock || f.l1Index}</td>
        <td class="p-2 text-stone-600">${f.level === 'single' ? '单级' : f.level === 'double' ? '二级' : '三级'}</td>
        <td class="p-2 text-stone-600">${f.blocks.length} 块</td>
        <td class="p-2 text-right">
          <button onclick="quickAccessFile('${f.name}', 3)" class="text-amber-600 hover:text-amber-800 font-bold mr-2 text-[11px]">访第3块</button>
          <button onclick="quickDeleteFile('${f.name}')" class="text-rose-600 hover:text-rose-800 font-bold text-[11px]">删除</button>
        </td>
      `;
    }
    tr.innerHTML = bodyHtml;
    tbody.appendChild(tr);
  });
}

/**
 * 渲染右侧专属元数据面板 (包含 FAT 表内有向箭头及流程图、索引块展开详细解析)
 */
function renderMetadataPanel() {
  const panel = document.getElementById('metadata-special-panel');
  panel.innerHTML = '';

  if (State.mode === 'contiguous') {
    panel.innerHTML = `
      <div class="flex items-center justify-between border-b border-stone-200 pb-2">
        <h4 class="text-xs font-bold text-stone-800 font-mono flex items-center gap-1.5">
          <span>📐</span> <span>连续分配物理地址直接映射计算器</span>
        </h4>
        <span class="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
          随机访问耗时: O(1)
        </span>
      </div>
      <div class="space-y-3 pt-1">
        <div class="bg-stone-50 p-3 rounded-xl border border-stone-200 font-mono text-xs space-y-1.5">
          <div class="text-stone-500">寻址计算公式 (Direct Mapping Formula):</div>
          <div id="contiguous-formula-display" class="text-sm font-bold text-stone-900 bg-white p-2 rounded border border-stone-200 transition-all">
            物理盘块号 = 起始盘块号 + 逻辑块号 k
          </div>
          <div class="text-[11px] text-stone-500 pt-1">
            只需 1 次加法与 <b class="text-emerald-700 font-bold">1 次磁盘 I/O</b> 即可直接读出目标块。
          </div>
        </div>

        <div class="border border-amber-200 bg-amber-50/50 p-3 rounded-xl text-xs space-y-1">
          <div class="font-bold text-amber-900 flex items-center gap-1">
            <span>⚡</span> <span>408 核心考点：</span>
          </div>
          <p class="text-stone-600 leading-relaxed text-[11px]">
            <b>优点：</b>顺序读写与直接随机访问速度极快，磁头寻道距离最短。<br>
            <b>缺点：</b>要求连续外存空间，文件长度难动态扩展；频繁创建与删除会导致大量<b>外部碎片</b>，需耗费高成本进行“磁盘碎片整理（紧凑）”。
          </p>
        </div>
      </div>
    `;

  } else if (State.mode === 'implicit') {
    panel.innerHTML = `
      <div class="flex items-center justify-between border-b border-stone-200 pb-2">
        <h4 class="text-xs font-bold text-stone-800 font-mono flex items-center gap-1.5">
          <span>🔗</span> <span>隐式链接磁盘块内部指针结构</span>
        </h4>
        <span class="text-[10px] font-mono text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
          随机访问耗时: O(k)
        </span>
      </div>
      <div class="space-y-3 pt-1">
        <div class="bg-stone-50 p-3 rounded-xl border border-stone-200 font-mono text-xs space-y-2">
          <div class="text-stone-500">盘块物理结构 (Physical Sector Layout):</div>
          <div class="flex items-center gap-1">
            <div class="flex-1 bg-white border border-stone-300 p-2 rounded text-center">
              <span class="text-stone-400 text-[10px] block">用户实际数据区</span>
              <span class="font-bold text-stone-800">Data (e.g. 508B)</span>
            </div>
            <div class="w-28 bg-orange-50 border border-orange-300 p-2 rounded text-center">
              <span class="text-orange-500 text-[10px] block">下一块物理号</span>
              <span class="font-bold text-orange-700">next 指针 ➔ (4B)</span>
            </div>
          </div>
          <div class="text-[11px] text-stone-500">
            访问逻辑第 k 块必须从起始盘块顺藤摸瓜，逐块读取外存，需 <b class="text-rose-700 font-bold">k + 1 次磁盘 I/O</b>！
          </div>
        </div>

        <div class="border border-stone-200 bg-stone-50 p-3 rounded-xl text-xs space-y-1">
          <div class="font-bold text-stone-800 flex items-center gap-1">
            <span>⚡</span> <span>408 核心考点：</span>
          </div>
          <p class="text-stone-600 leading-relaxed text-[11px]">
            <b>优点：</b>彻底消除了外部碎片，离散空闲块均可利用，文件可任意追加扩展。<br>
            <b>缺点：</b>严禁直接随机访问；指针分散在外存扇区内部占用了存储容量；<b>可靠性极低</b>，任一盘块扇区损坏（断链）将导致后续链条全部丢失。
          </p>
        </div>
      </div>
    `;

  } else if (State.mode === 'fat') {
    // 构造 FAT 表项
    let fatRowsHtml = '';
    for (let i = 0; i < TOTAL_BLOCKS; i++) {
      const nextVal = State.fatTable[i];
      const isAllocated = nextVal !== 'FREE';
      fatRowsHtml += `
        <tr id="fat-row-${i}" class="fat-row ${isAllocated ? 'allocated font-semibold' : 'text-stone-400'}">
          <td class="font-mono text-stone-700 font-bold text-center">${i}</td>
          <td class="font-mono text-center relative ${nextVal === 'EOF' ? 'text-rose-600 font-bold' : nextVal !== 'FREE' ? 'text-purple-600 font-bold' : 'text-stone-300'}">
            <span id="fat-cell-val-${i}">${nextVal}</span>
            ${nextVal !== 'FREE' && nextVal !== 'EOF' ? `<span class="text-[10px] text-purple-500 ml-1">➔ #${nextVal}</span>` : ''}
          </td>
          <td class="text-[11px] font-sans text-center">
            ${nextVal === 'FREE' ? '<span class="text-emerald-600">空闲</span>' : nextVal === 'EOF' ? '<span class="text-rose-600 font-semibold">文件末尾 [EOF]</span>' : `<span class="text-purple-700 font-bold">指向下一表项 #${nextVal}</span>`}
          </td>
        </tr>
      `;
    }

    // 构造当前活跃文件的 FAT 跳转链节点与有向箭头流程图
    const activeFile = Object.values(State.files)[0];
    let fatFlowHtml = '';
    if (activeFile && activeFile.blocks && activeFile.blocks.length > 0) {
      const chainNodes = activeFile.blocks.map((bid, idx) => {
        const nextTarget = idx === activeFile.blocks.length - 1 ? 'EOF' : activeFile.blocks[idx + 1];
        const isLast = idx === activeFile.blocks.length - 1;
        return `
          <div id="fat-flow-node-${bid}" class="fat-flow-node">
            <span class="text-[10px] text-purple-600 font-mono font-bold">FAT[${bid}]</span>
            <span class="text-xs font-mono font-extrabold ${isLast ? 'text-rose-600' : 'text-purple-800'}">${nextTarget}</span>
          </div>
          ${!isLast ? `
            <div id="fat-flow-arrow-${bid}" class="fat-flow-arrow flex items-center text-purple-500 font-bold transition-all px-0.5">
              <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
                <path d="M 1 8 L 18 8 M 14 3 L 19 8 L 14 13" stroke="#8B5CF6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          ` : ''}
        `;
      }).join('');

      fatFlowHtml = `
        <div class="bg-purple-50/70 p-2.5 rounded-xl border border-purple-200 space-y-1.5">
          <div class="flex items-center justify-between text-[11px] font-mono text-purple-900 font-bold">
            <span>🔀 FAT 表中有向跳转链 (指向下一表项)：</span>
            <span class="text-purple-600 bg-purple-100 px-1.5 py-0.2 rounded">${activeFile.name}</span>
          </div>
          <div class="flex items-center justify-start overflow-x-auto py-1 gap-1">
            ${chainNodes}
          </div>
        </div>
      `;
    }

    panel.innerHTML = `
      <div class="flex items-center justify-between border-b border-stone-200 pb-2">
        <h4 class="text-xs font-bold text-stone-800 font-mono flex items-center gap-1.5">
          <span>📑</span> <span>常驻内存 FAT 表 (有向指示下一表项)</span>
        </h4>
        <span class="text-[10px] font-mono text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200 font-bold">
          指针集中在内存
        </span>
      </div>
      
      <!-- FAT 跳转链有向箭头流程图 -->
      ${fatFlowHtml}

      <div class="text-[11px] font-mono text-stone-500">
        表项物理号与盘块号严格 1:1 对应。检索过程完全在内存进行，定位第 k 块仅需 <b class="text-emerald-700 font-bold">1 次磁盘 I/O</b>！
      </div>

      <!-- FAT 表滚动容器 -->
      <div class="fat-table-container rounded-lg border border-stone-200 bg-white relative">
        <table class="fat-table">
          <thead>
            <tr>
              <th class="w-1/4 text-center">盘块号</th>
              <th class="w-1/3 text-center">FAT 表项 (Next)</th>
              <th class="w-5/12 text-center">有向跳转指示</th>
            </tr>
          </thead>
          <tbody id="fat-table-body">
            ${fatRowsHtml}
          </tbody>
        </table>
      </div>
    `;

  } else if (State.mode === 'indexed') {
    const currentFile = Object.values(State.files)[0];
    let indexContentHtml = '';

    if (!currentFile) {
      indexContentHtml = `
        <div class="p-4 text-center text-stone-400 italic text-xs">
          请点击上方「➕ 创建文件」生成索引块与数据块
        </div>
      `;
    } else {
      if (State.indexLevel === 'single') {
        const idxBlock = currentFile.indexBlock;
        let itemsHtml = '';
        currentFile.blocks.forEach((blkId, idx) => {
          itemsHtml += `
            <div id="idx-item-${idx}" class="flex items-center justify-between p-2 rounded-lg bg-white border border-stone-200 text-xs font-mono transition-all hover:border-blue-300">
              <span class="text-stone-500 font-semibold">第 ${idx} 项</span>
              <div class="flex items-center gap-1 text-blue-600 font-bold">
                <span>➔</span>
                <span>数据盘块 #${blkId}</span>
              </div>
            </div>
          `;
        });
        indexContentHtml = `
          <div class="bg-blue-50/50 p-3 rounded-xl border border-blue-200 space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-bold text-xs text-blue-900 font-mono">
                📌 索引块 #${idxBlock} 内部表格 (有向箭头指向各数据块)
              </span>
              <span class="text-[10px] text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded font-bold">单级索引</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
              ${itemsHtml}
            </div>
          </div>
        `;
      } else if (State.indexLevel === 'double') {
        indexContentHtml = `
          <div class="bg-blue-50/40 p-3 rounded-xl border border-blue-200 space-y-2.5">
            <div class="flex items-center justify-between border-b border-blue-200 pb-1.5">
              <span class="font-bold text-xs text-blue-900 font-mono">
                一级索引块 #${currentFile.l1Index} ➔ 二级索引块 #${currentFile.l2Index} ➔ 数据块
              </span>
              <span class="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-bold border border-emerald-200">二级索引</span>
            </div>
            <div class="text-[11px] font-mono text-stone-600 space-y-1.5">
              <div class="p-2 bg-white rounded-lg border border-blue-200 flex items-center justify-between">
                <span>一级索引项 [0] (深蓝)</span>
                <span class="font-bold text-blue-600 flex items-center gap-1">
                  <span>➔ 指向二级索引块</span> <span>#${currentFile.l2Index}</span>
                </span>
              </div>
              <div class="p-2 bg-white rounded-lg border border-blue-200">
                <span class="block text-stone-500 mb-1">二级索引项 (浅蓝有向指向)：</span>
                <span class="font-bold text-stone-800">[0]➔#${currentFile.blocks[0]}, [1]➔#${currentFile.blocks[1]}, [2]➔#${currentFile.blocks[2]}, [3]➔#${currentFile.blocks[3]}, [4]➔#${currentFile.blocks[4]}</span>
              </div>
            </div>
            <div class="text-[11px] font-mono text-stone-500">
              访问逻辑块 k 需：读1级索引 + 读2级索引 + 读数据块 = <b class="text-blue-700 font-bold">3 次磁盘 I/O</b>。
            </div>
          </div>
        `;
      } else {
        indexContentHtml = `
          <div class="bg-purple-50/40 p-3 rounded-xl border border-purple-200 space-y-2">
            <div class="font-bold text-xs text-purple-900 font-mono">
              三级索引：1级(#${currentFile.l1Index}) ➔ 2级(#${currentFile.l2Index}) ➔ 3级(#${currentFile.l3Index}) ➔ 数据盘块
            </div>
            <div class="text-[11px] font-mono text-stone-600 bg-white p-2 rounded-lg border border-purple-200">
              访问任意数据块需要：3 次读各级索引块 + 1 次读目标数据块 = <b class="text-purple-700 font-bold">4 次磁盘 I/O</b>！
            </div>
          </div>
        `;
      }
    }

    panel.innerHTML = `
      <div class="flex items-center justify-between border-b border-stone-200 pb-2">
        <h4 class="text-xs font-bold text-stone-800 font-mono flex items-center gap-1.5">
          <span>🗂️</span> <span>索引块内部项与有向寻址结构</span>
        </h4>
        <span class="text-[10px] font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-bold">
          支持直接随机访问
        </span>
      </div>
      ${indexContentHtml}
      <div class="border border-stone-200 bg-stone-50 p-2.5 rounded-xl text-xs space-y-1">
        <div class="font-bold text-stone-800 flex items-center gap-1">
          <span>⚡</span> <span>408 核心考点：</span>
        </div>
        <p class="text-stone-600 leading-relaxed text-[11px]">
          <b>优点：</b>支持直接存取，第 i 块查索引表第 i 项；无外部碎片，充分利用离散空间。<br>
          <b>代价：</b>索引块自身带来额外存储开销；对于多级索引，虽支持极大文件，但访问深层数据时磁盘 I/O 次数随级数线性递增。
        </p>
      </div>
    `;
  }
}

/**
 * 更新磁盘使用统计
 */
function updateDiskStats() {
  let free = 0;
  let used = 0;
  State.blocks.forEach(b => {
    if (b.status === 'free') free++;
    else used++;
  });
  document.getElementById('disk-stat-free').textContent = `空闲: ${free}`;
  document.getElementById('disk-stat-used').textContent = `占用: ${used}`;
  document.getElementById('disk-io-counter').textContent = `磁盘 I/O: ${State.ioCount} 次`;
}

// ============================================================
// 4. 六步节拍动画控制器 (The 6-Beat Engine)
// ============================================================

function renderTimelineBar() {
  const container = document.getElementById('step-timeline-container');
  container.innerHTML = '';

  const beats = [
    { title: '1. 申请/选择' },
    { title: '2. 决策/查找' },
    { title: '3. 状态变更' },
    { title: '4. 元数据更新' },
    { title: '5. 指针绘制' },
    { title: '6. 考点总结' },
  ];

  beats.forEach((b, idx) => {
    const pill = document.createElement('button');
    pill.className = `step-pill ${idx === State.currentStepIndex ? 'active' : (idx < State.currentStepIndex ? 'completed' : '')}`;
    pill.textContent = b.title;
    pill.onclick = () => {
      if (State.currentAction && !State.isAnimating) {
        jumpToStep(idx);
      }
    };
    container.appendChild(pill);
  });

  const badge = document.getElementById('step-status-badge');
  if (!State.currentAction) {
    badge.textContent = '就绪等待操作';
    badge.className = 'text-xs font-mono text-stone-500 whitespace-nowrap bg-stone-100 px-2.5 py-0.5 rounded-full border border-stone-200';
  } else {
    badge.textContent = `节拍 ${State.currentStepIndex + 1} / 6 · ${State.currentAction.title}`;
    badge.className = 'text-xs font-mono text-amber-800 whitespace-nowrap bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300 font-bold';
  }

  document.getElementById('btn-prev').disabled = !State.currentAction || State.currentStepIndex === 0;
  document.getElementById('btn-next').disabled = !State.currentAction || State.currentStepIndex >= 5;
}

function startAction(actionObj) {
  stopPlay();
  clearSvgArrows();
  clearFlyingProbes();
  State.currentAction = actionObj;
  State.currentStepIndex = 0;
  renderTimelineBar();
  executeCurrentStep();
}

function executeCurrentStep() {
  if (!State.currentAction) return;
  const stepFn = State.currentAction.steps[State.currentStepIndex];
  if (stepFn) {
    stepFn();
  }
  renderTimelineBar();
}

function stepNext() {
  if (!State.currentAction || State.currentStepIndex >= 5) return;
  State.currentStepIndex++;
  executeCurrentStep();
}

function stepPrev() {
  if (!State.currentAction || State.currentStepIndex <= 0) return;
  State.currentStepIndex--;
  executeCurrentStep();
}

function jumpToStep(targetIndex) {
  State.currentStepIndex = targetIndex;
  executeCurrentStep();
}

function togglePlay() {
  if (State.isPlaying) {
    stopPlay();
  } else {
    if (!State.currentAction) {
      handleCreateFile();
    }
    startAutoPlay();
  }
}

function startAutoPlay() {
  State.isPlaying = true;
  document.getElementById('play-icon').textContent = '⏸';
  document.getElementById('play-text').textContent = '暂停';
  document.getElementById('btn-play').className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors shadow-sm flex items-center gap-1.5';
  scheduleNextStep();
}

function stopPlay() {
  State.isPlaying = false;
  if (State.timer) clearTimeout(State.timer);
  State.timer = null;
  const playBtn = document.getElementById('btn-play');
  if (playBtn) {
    document.getElementById('play-icon').textContent = '▶';
    document.getElementById('play-text').textContent = '自动播放';
    playBtn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-stone-900 text-white hover:bg-stone-800 transition-colors shadow-sm flex items-center gap-1.5';
  }
}

function scheduleNextStep() {
  if (!State.isPlaying) return;
  const delay = 1800 / State.speed;
  State.timer = setTimeout(() => {
    if (State.currentAction && State.currentStepIndex < 5) {
      State.currentStepIndex++;
      executeCurrentStep();
      scheduleNextStep();
    } else {
      stopPlay();
    }
  }, delay);
}

function setSpeed(val) {
  State.speed = val;
  [0.5, 1.0, 2.0].forEach(v => {
    const btn = document.getElementById(`speed-${v === 0.5 ? '05' : v === 1.0 ? '10' : '20'}`);
    if (v === val) {
      btn.className = "px-2 py-0.5 rounded border border-stone-900 bg-stone-900 text-white font-bold text-xs";
    } else {
      btn.className = "px-2 py-0.5 rounded border border-stone-200 hover:border-stone-400 text-stone-600 text-xs";
    }
  });
  addLog('速度调节', `演示播放速率设置为 ${val}x`);
}

// ============================================================
// 5. 四大核心文件操作动画实现 (无跳变平滑过渡规范)
// ============================================================

/**
 * ------------------------------------------------------------
 * A. 创建文件 (Create File)
 * ------------------------------------------------------------
 */
function handleCreateFile() {
  const fileName = document.getElementById('select-file-name').value;
  const fileLen = parseInt(document.getElementById('input-file-len').value, 10) || 5;

  if (State.files[fileName]) {
    addLog('创建提示', `文件 ${fileName} 已经存在！请先删除或选择其他文件名。`, 'warn');
    return;
  }

  if (State.mode === 'contiguous') {
    createFileContiguous(fileName, fileLen);
  } else if (State.mode === 'implicit') {
    createFileImplicit(fileName, fileLen);
  } else if (State.mode === 'fat') {
    createFileFAT(fileName, fileLen);
  } else if (State.mode === 'indexed') {
    createFileIndexed(fileName, fileLen);
  }
}

/**
 * 1. 连续分配创建文件 (从0开始扫描波浪动画)
 */
function createFileContiguous(fileName, length) {
  let foundStart = -1;

  if (fileName === 'A' && length === 5) {
    let canUse8 = true;
    for (let i = 8; i < 13; i++) {
      if (State.blocks[i].status !== 'free') canUse8 = false;
    }
    if (canUse8) foundStart = 8;
  }

  if (foundStart === -1) {
    let currentRun = 0;
    for (let i = 0; i < TOTAL_BLOCKS; i++) {
      if (State.blocks[i].status === 'free') {
        currentRun++;
        if (currentRun === length) {
          foundStart = i - length + 1;
          break;
        }
      } else {
        currentRun = 0;
      }
    }
  }

  if (foundStart === -1) {
    addLog('创建失败', `外存中未找到连续 ${length} 个空闲盘块！产生【外部碎片】，连续分配失败。`, 'error');
    return;
  }

  const targetBlocks = [];
  for (let k = 0; k < length; k++) {
    targetBlocks.push(foundStart + k);
  }

  const action = {
    title: `连续分配：创建 ${fileName} (长度 ${length})`,
    steps: [
      // 节拍 1：申请阶段
      () => {
        clearHighlights();
        clearSvgArrows();
        clearFlyingProbes();
        document.getElementById('disk-hint-text').textContent = `【节拍 1/6 · 申请阶段】用户请求创建 ${fileName}，指定文件长度为 ${length} 块。`;
        addLog('申请阶段', `用户申请创建文件 ${fileName}，连续长度 = ${length} 块。`);
      },
      // 节拍 2：扫描与决策阶段 (分配器从盘块 0 开始依次向右扫描，波浪过渡)
      () => {
        clearHighlights();
        const scanEls = [];
        for (let s = 0; s <= foundStart + length - 1; s++) {
          const el = document.getElementById(`disk-block-${s}`);
          if (el) scanEls.push(el);
        }

        // 60fps 缓动波浪高亮
        gsap.to(scanEls, {
          backgroundColor: '#FEF3C7',
          borderColor: '#F59E0B',
          scale: 1.07,
          stagger: 0.06 / State.speed,
          duration: 0.15 / State.speed,
          yoyo: true,
          repeat: 1,
          ease: 'power1.inOut',
          onComplete: () => {
            targetBlocks.forEach(bid => {
              const el = document.getElementById(`disk-block-${bid}`);
              if (el) el.classList.add('highlight-active');
            });
          }
        });

        document.getElementById('disk-hint-text').textContent = `【节拍 2/6 · 扫描决策】分配器从磁盘块 0 开始依次向右扫描，在盘块 #${foundStart} 处找到第一个长度足够的连续空闲区 [${targetBlocks.join(', ')}]！`;
        addLog('扫描决策', `从盘块 0 开始向右扫描，空闲块依次黄色高亮，在起始块 #${foundStart} 锁定连续 ${length} 块。`);
      },
      // 节拍 3：状态变更 (依次由绿变红，弹性过渡)
      () => {
        clearHighlights();
        targetBlocks.forEach((bid, idx) => {
          State.blocks[bid].status = 'allocated';
          State.blocks[bid].file = fileName;
          State.blocks[bid].blockIdx = idx;

          const el = document.getElementById(`disk-block-${bid}`);
          const bodyEl = document.getElementById(`block-body-${bid}`);
          const footerEl = document.getElementById(`block-footer-${bid}`);

          if (el) {
            gsap.to(el, {
              scale: 1.08,
              duration: 0.2 / State.speed,
              delay: (idx * 0.08) / State.speed,
              onStart: () => {
                el.className = 'disk-block allocated';
                if (bodyEl) bodyEl.textContent = `${fileName}[${idx}]`;
                if (footerEl) footerEl.textContent = '';
              },
              onComplete: () => {
                gsap.to(el, { scale: 1, duration: 0.2 / State.speed, ease: 'power2.out' });
              }
            });
          }
        });

        renderContiguousSpans(true);
        document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 状态变更】连续空闲区盘块 [${targetBlocks.join(', ')}] 依次由绿变红，写入数据。`;
        addLog('状态变更', `连续盘块 [${targetBlocks.join(', ')}] 依次由绿变红。`);
      },
      // 节拍 4：元数据更新 (写入目录，平滑滑入)
      () => {
        clearHighlights();
        State.files[fileName] = {
          name: fileName,
          start: foundStart,
          length: length,
          blocks: targetBlocks
        };
        renderDirectoryTable();

        const row = document.getElementById(`dir-row-${fileName}`);
        if (row) {
          gsap.fromTo(row, 
            { opacity: 0, y: -10, backgroundColor: '#FEF3C7' }, 
            { opacity: 1, y: 0, backgroundColor: '#FFFBEB', duration: 0.4 / State.speed, ease: 'power2.out' }
          );
        }

        document.getElementById('disk-hint-text').textContent = `【节拍 4/6 · 元数据更新】右侧目录新增一行：${fileName} | 起始块 ${foundStart} | 长度 ${length}。`;
        addLog('目录更新', `右侧目录新增一行：${fileName} | 起始块 ${foundStart} | 长度 ${length}。`);
      },
      // 节拍 5：横向连续条平滑展开绘制
      () => {
        clearHighlights();
        renderContiguousSpans(true);
        document.getElementById('disk-hint-text').textContent = `【节拍 5/6 · 连续条绘制】在红色块上方平滑展开横向“连续条”，标注“${fileName}：起始块 ${foundStart}，长度 ${length}”。`;
        addLog('连续条标注', `在盘块上方绘制横向连续条，标定文件 ${fileName} 物理跨度。`);
      },
      // 节拍 6：考点总结
      () => {
        clearHighlights();
        State.ioCount = length;
        updateDiskStats();
        document.getElementById('disk-hint-text').textContent = `【节拍 6/6 · 考点总结】连续分配只需“起始块 + 长度”即可定位任意第 i 块：起始块 + i。`;
        addLog('考点总结', `【连续分配】只需“起始块 + 长度”即可定位任意第 i 块：物理地址 = 起始块 + i，支持高速随机访问！`, 'success');
      }
    ]
  };

  startAction(action);
}

/**
 * 2. 隐式链接创建文件 (带平滑有向箭头及 EOF 指针)
 */
function createFileImplicit(fileName, length) {
  let chosenBlocks = [];
  const preset = PRESET_FILES[fileName] ? PRESET_FILES[fileName].implicit.blocks : null;

  if (preset && preset.length === length && preset.every(b => State.blocks[b].status === 'free')) {
    chosenBlocks = [...preset];
  } else {
    for (let i = 0; i < TOTAL_BLOCKS && chosenBlocks.length < length; i++) {
      if (State.blocks[i].status === 'free') {
        chosenBlocks.push(i);
      }
    }
  }

  if (chosenBlocks.length < length) {
    addLog('创建失败', `空闲块不足，无法分配 ${length} 个盘块！`, 'error');
    return;
  }

  const startBlock = chosenBlocks[0];
  const endBlock = chosenBlocks[chosenBlocks.length - 1];

  const action = {
    title: `隐式链接：创建 ${fileName} (长度 ${length})`,
    steps: [
      // 节拍 1：申请阶段
      () => {
        clearHighlights();
        clearSvgArrows();
        clearFlyingProbes();
        document.getElementById('disk-hint-text').textContent = `【节拍 1/6 · 申请阶段】用户请求创建 ${fileName}，分配器准备取离散空闲块建立隐式链接。`;
        addLog('申请阶段', `隐式链接分配器申请 ${length} 个离散盘块用于 ${fileName}。`);
      },
      // 节拍 2：取离散块 (黄色高亮脉冲过渡)
      () => {
        clearHighlights();
        const chosenEls = chosenBlocks.map(b => document.getElementById(`disk-block-${b}`));
        gsap.fromTo(chosenEls, 
          { scale: 0.95 }, 
          { scale: 1.08, backgroundColor: '#FFFBEB', borderColor: '#F59E0B', duration: 0.35 / State.speed, stagger: 0.1 / State.speed, ease: 'back.out(1.7)' }
        );
        document.getElementById('disk-hint-text').textContent = `【节拍 2/6 · 离散拾取】分配器从空闲块中依次取离散块：[${chosenBlocks.join(', ')}]，高亮黄色。`;
        addLog('离散拾取', `分配器依次取离散块：${chosenBlocks.join(', ')}。`);
      },
      // 节拍 3：状态变更与 next 字段写入
      () => {
        clearHighlights();
        chosenBlocks.forEach((bid, idx) => {
          const nextBid = idx === chosenBlocks.length - 1 ? 'EOF' : chosenBlocks[idx + 1];
          State.blocks[bid].status = 'allocated';
          State.blocks[bid].file = fileName;
          State.blocks[bid].blockIdx = idx;
          State.blocks[bid].next = nextBid;

          const el = document.getElementById(`disk-block-${bid}`);
          const bodyEl = document.getElementById(`block-body-${bid}`);
          const footerEl = document.getElementById(`block-footer-${bid}`);

          if (el) {
            gsap.to(el, {
              scale: 1.08,
              duration: 0.2 / State.speed,
              delay: (idx * 0.08) / State.speed,
              onStart: () => {
                el.className = 'disk-block allocated';
                if (bodyEl) bodyEl.textContent = `${fileName}[${idx}]`;
                if (footerEl) footerEl.textContent = nextBid === 'EOF' ? 'EOF' : `→${nextBid}`;
              },
              onComplete: () => {
                gsap.to(el, { scale: 1, duration: 0.2 / State.speed, ease: 'power2.out' });
              }
            });
          }
        });

        document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 写入 next】这些块依次变红，每个块内部写入 next 字段：${chosenBlocks.map((b, i) => `块${b}的next=${i === chosenBlocks.length - 1 ? 'EOF' : chosenBlocks[i+1]}`).join('，')}。`;
        addLog('写入 next', `盘块变红并写入内部指针：${chosenBlocks.map((b, i) => `块${b}的next=${i === chosenBlocks.length - 1 ? 'EOF' : chosenBlocks[i+1]}`).join(' ➔ ')}。`);
      },
      // 节拍 4：元数据更新 (写入目录)
      () => {
        clearHighlights();
        State.files[fileName] = {
          name: fileName,
          start: startBlock,
          end: endBlock,
          blocks: chosenBlocks
        };
        renderDirectoryTable();

        const row = document.getElementById(`dir-row-${fileName}`);
        if (row) {
          gsap.fromTo(row, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.35 / State.speed });
        }

        document.getElementById('disk-hint-text').textContent = `【节拍 4/6 · 目录更新】右侧目录新增：${fileName} | 起始块 ${startBlock} | 结束块 ${endBlock}。`;
        addLog('目录更新', `右侧目录新增：${fileName} | 起始块 ${startBlock} | 结束块 ${endBlock}。`);
      },
      // 节拍 5：磁盘块之间绘制平滑展开的有向箭头
      () => {
        clearHighlights();
        clearSvgArrows();

        // 依次平滑绘制有向箭头
        for (let i = 0; i < chosenBlocks.length - 1; i++) {
          const b1 = chosenBlocks[i];
          const b2 = chosenBlocks[i + 1];
          drawAnimatedSvgArrow(b1, b2, '#F97316', 'arrow-orange', false, i * 0.18 / State.speed);
        }

        // 在末块绘制浮动 EOF 徽章
        addEofBadgeToBlock(endBlock);

        document.getElementById('disk-hint-text').textContent = `【节拍 5/6 · 绘制有向箭头】在磁盘块之间动态画出有向箭头：${chosenBlocks.join(' ➔ ')} ➔ EOF。`;
        addLog('箭头绘制', `在磁盘块之间绘制单向指针有向箭头：${chosenBlocks.join(' ➔ ')} ➔ EOF。`);
      },
      // 节拍 6：考点总结
      () => {
        clearHighlights();
        State.ioCount = length;
        updateDiskStats();
        document.getElementById('disk-hint-text').textContent = `【节拍 6/6 · 考点总结】目录只记录起始块和结束块，磁盘块内部保存下一块号。`;
        addLog('考点总结', `【隐式链接】目录只记录起始块和结束块，磁盘块内部保存下一块号；无外部碎片但无法直接跳到第 k 块。`, 'success');
      }
    ]
  };

  startAction(action);
}

/**
 * 3. 显式链接 (FAT) 创建文件 (带 FAT 表内有向箭头指示)
 */
function createFileFAT(fileName, length) {
  let chosenBlocks = [];
  const preset = PRESET_FILES[fileName] ? PRESET_FILES[fileName].fat.blocks : null;

  if (preset && preset.length === length && preset.every(b => State.blocks[b].status === 'free')) {
    chosenBlocks = [...preset];
  } else {
    for (let i = 0; i < TOTAL_BLOCKS && chosenBlocks.length < length; i++) {
      if (State.blocks[i].status === 'free') {
        chosenBlocks.push(i);
      }
    }
  }

  if (chosenBlocks.length < length) {
    addLog('创建失败', `空闲块不足！`, 'error');
    return;
  }

  const startBlock = chosenBlocks[0];

  const action = {
    title: `显式链接 (FAT)：创建 ${fileName} (长度 ${length})`,
    steps: [
      // 节拍 1：申请阶段
      () => {
        clearHighlights();
        clearSvgArrows();
        clearFlyingProbes();
        document.getElementById('disk-hint-text').textContent = `【节拍 1/6 · 申请阶段】在显式链接 FAT 模式下创建 ${fileName}，指针将脱离外存全部集中在内存 FAT 中。`;
        addLog('申请阶段', `显式链接 (FAT) 申请 ${length} 个离散空闲块。`);
      },
      // 节拍 2：分配离散块
      () => {
        clearHighlights();
        const chosenEls = chosenBlocks.map(b => document.getElementById(`disk-block-${b}`));
        gsap.fromTo(chosenEls, 
          { scale: 0.95 }, 
          { scale: 1.08, backgroundColor: '#FFFBEB', borderColor: '#F59E0B', duration: 0.35 / State.speed, stagger: 0.08 / State.speed, ease: 'back.out(1.6)' }
        );
        document.getElementById('disk-hint-text').textContent = `【节拍 2/6 · 分配离散块】分配若干离散空闲块：[${chosenBlocks.join(', ')}]。`;
        addLog('分配离散块', `分配离散空闲块：${chosenBlocks.join(', ')}。`);
      },
      // 节拍 3：磁盘块变红，但不画 next (纯数据块)
      () => {
        clearHighlights();
        chosenBlocks.forEach((bid, idx) => {
          State.blocks[bid].status = 'allocated';
          State.blocks[bid].file = fileName;
          State.blocks[bid].blockIdx = idx;
          State.blocks[bid].next = null; // 磁盘块内部绝不存 next！

          const el = document.getElementById(`disk-block-${bid}`);
          const bodyEl = document.getElementById(`block-body-${bid}`);
          const footerEl = document.getElementById(`block-footer-${bid}`);

          if (el) {
            gsap.to(el, {
              scale: 1.08,
              duration: 0.2 / State.speed,
              delay: (idx * 0.08) / State.speed,
              onStart: () => {
                el.className = 'disk-block allocated';
                if (bodyEl) bodyEl.textContent = `${fileName}[${idx}]`;
                if (footerEl) footerEl.textContent = '';
              },
              onComplete: () => {
                gsap.to(el, { scale: 1, duration: 0.2 / State.speed, ease: 'power2.out' });
              }
            });
          }
        });

        document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 状态变更】磁盘块变红，但磁盘块内部不画 next (纯数据块，利用率 100%)。`;
        addLog('磁盘块变红', `磁盘块变红，但磁盘块内部不画 next。`);
      },
      // 节拍 4：FAT 表写入与目录新增
      () => {
        clearHighlights();
        for (let i = 0; i < chosenBlocks.length; i++) {
          const cur = chosenBlocks[i];
          const next = i === chosenBlocks.length - 1 ? 'EOF' : chosenBlocks[i + 1];
          State.fatTable[cur] = next;
        }

        State.files[fileName] = {
          name: fileName,
          start: startBlock,
          blocks: chosenBlocks
        };

        renderDirectoryTable();
        renderMetadataPanel();

        chosenBlocks.forEach(bid => {
          const row = document.getElementById(`fat-row-${bid}`);
          if (row) row.classList.add('active');
        });
        scrollToFatRow(startBlock);

        document.getElementById('disk-hint-text').textContent = `【节拍 4/6 · 写入 FAT 表】右侧 FAT 表对应行依次写入：${chosenBlocks.map((b, i) => `FAT[${b}]=${i === chosenBlocks.length - 1 ? 'EOF' : chosenBlocks[i+1]}`).join('，')}；目录新增：${fileName} | 起始块 ${startBlock}。`;
        addLog('写入 FAT 表', `右侧 FAT 表依次写入指针；目录新增：${fileName} | 起始块 ${startBlock}。`);
      },
      // 节拍 5：常驻内存 FAT 表建立链表结构展示 (动画依次点亮链表节点与有向箭头)
      () => {
        clearHighlights();
        chosenBlocks.forEach((bid, idx) => {
          const row = document.getElementById(`fat-row-${bid}`);
          const node = document.getElementById(`fat-flow-node-${bid}`);
          const arrow = document.getElementById(`fat-flow-arrow-${bid}`);

          if (row) {
            setTimeout(() => {
              row.classList.add('active');
            }, (idx * 160) / State.speed);
          }
          if (node) {
            gsap.to(node, {
              scale: 1.1,
              borderColor: '#8B5CF6',
              backgroundColor: '#EDE9FE',
              duration: 0.25 / State.speed,
              delay: (idx * 0.16) / State.speed,
              onStart: () => node.classList.add('active'),
              yoyo: true,
              repeat: 1
            });
          }
          if (arrow) {
            gsap.to(arrow, {
              scale: 1.25,
              duration: 0.25 / State.speed,
              delay: (idx * 0.16 + 0.08) / State.speed,
              onStart: () => arrow.classList.add('active'),
              yoyo: true,
              repeat: 1
            });
          }
        });

        document.getElementById('disk-hint-text').textContent = `【节拍 5/6 · FAT 链表演示】常驻内存建立链表拓扑：${chosenBlocks.map((b, i) => `FAT[${b}]=${i === chosenBlocks.length - 1 ? 'EOF' : chosenBlocks[i+1]}`).join(' ➔ ')}。`;
        addLog('FAT 链表演示', `内存 FAT 表建立有向链表：${chosenBlocks.map((b, i) => `FAT[${b}]=${i === chosenBlocks.length - 1 ? 'EOF' : chosenBlocks[i+1]}`).join(' ➔ ')}。`);
      },
      // 节拍 6：考点总结
      () => {
        clearHighlights();
        State.ioCount = length;
        updateDiskStats();
        document.getElementById('disk-hint-text').textContent = `【节拍 6/6 · 考点总结】指针集中放在内存 FAT 中，磁盘块本身不存指针。`;
        addLog('考点总结', `【显式链接 FAT】指针集中放在内存 FAT 中，磁盘块本身不存指针；查表在内存完成，寻链极快！`, 'success');
      }
    ]
  };

  startAction(action);
}

/**
 * 4. 索引分配创建文件 (带从索引项指向数据块的平滑有向箭头)
 */
function createFileIndexed(fileName, length) {
  const level = State.indexLevel;
  let indexBlock = -1;
  let l2IndexBlock = -1;
  let l3IndexBlock = -1;
  let dataBlocks = [];

  const preset = PRESET_FILES[fileName] ? PRESET_FILES[fileName].indexed[level] : null;

  if (level === 'single') {
    indexBlock = (preset && State.blocks[preset.indexBlock].status === 'free') ? preset.indexBlock : findFreeBlock();
    if (indexBlock === -1) { addLog('创建失败', '没有可用的索引盘块！', 'error'); return; }
    State.blocks[indexBlock].status = 'index';

    if (preset && preset.blocks.every(b => State.blocks[b].status === 'free')) {
      dataBlocks = [...preset.blocks];
    } else {
      dataBlocks = findFreeBlocks(length);
    }
  } else if (level === 'double') {
    indexBlock = (preset && State.blocks[preset.l1Index].status === 'free') ? preset.l1Index : findFreeBlock();
    State.blocks[indexBlock].status = 'index';
    l2IndexBlock = (preset && State.blocks[preset.l2Index].status === 'free') ? preset.l2Index : findFreeBlock();
    State.blocks[l2IndexBlock].status = 'index-l2';

    if (preset && preset.blocks.every(b => State.blocks[b].status === 'free')) {
      dataBlocks = [...preset.blocks];
    } else {
      dataBlocks = findFreeBlocks(length);
    }
  } else {
    indexBlock = (preset && State.blocks[preset.l1Index].status === 'free') ? preset.l1Index : findFreeBlock();
    State.blocks[indexBlock].status = 'index';
    l2IndexBlock = (preset && State.blocks[preset.l2Index].status === 'free') ? preset.l2Index : findFreeBlock();
    State.blocks[l2IndexBlock].status = 'index-l2';
    l3IndexBlock = (preset && State.blocks[preset.l3Index].status === 'free') ? preset.l3Index : findFreeBlock();
    State.blocks[l3IndexBlock].status = 'index-l3';

    if (preset && preset.blocks.every(b => State.blocks[b].status === 'free')) {
      dataBlocks = [...preset.blocks];
    } else {
      dataBlocks = findFreeBlocks(length);
    }
  }

  State.blocks[indexBlock].status = 'free';
  if (l2IndexBlock !== -1) State.blocks[l2IndexBlock].status = 'free';
  if (l3IndexBlock !== -1) State.blocks[l3IndexBlock].status = 'free';

  if (dataBlocks.length < length) {
    addLog('创建失败', `空闲数据块不足！`, 'error');
    return;
  }

  const action = {
    title: `索引分配 (${level === 'single' ? '单级' : level === 'double' ? '二级' : '三级'})：创建 ${fileName}`,
    steps: [
      // 节拍 1：申请阶段
      () => {
        clearHighlights();
        clearSvgArrows();
        clearFlyingProbes();
        document.getElementById('disk-hint-text').textContent = `【节拍 1/6 · 申请阶段】用户指定文件长度为 ${length}，索引分配器准备分配索引块与数据块。`;
        addLog('申请阶段', `索引分配器申请创建文件 ${fileName}，长度 ${length}。`);
      },
      // 节拍 2：分配索引块 (变深蓝/浅蓝，弹性过渡)
      () => {
        clearHighlights();
        State.blocks[indexBlock].status = 'index';
        State.blocks[indexBlock].file = fileName;
        State.blocks[indexBlock].isIndex = true;

        if (l2IndexBlock !== -1) {
          State.blocks[l2IndexBlock].status = 'index-l2';
          State.blocks[l2IndexBlock].file = fileName;
          State.blocks[l2IndexBlock].isIndex = true;
        }
        if (l3IndexBlock !== -1) {
          State.blocks[l3IndexBlock].status = 'index-l3';
          State.blocks[l3IndexBlock].file = fileName;
          State.blocks[l3IndexBlock].isIndex = true;
        }

        renderDiskGrid();
        const el1 = document.getElementById(`disk-block-${indexBlock}`);
        if (el1) {
          gsap.fromTo(el1, { scale: 0.8 }, { scale: 1, backgroundColor: '#EFF6FF', borderColor: '#2563EB', duration: 0.45 / State.speed, ease: 'back.out(1.7)' });
        }
        if (l2IndexBlock !== -1) {
          const el2 = document.getElementById(`disk-block-${l2IndexBlock}`);
          if (el2) gsap.fromTo(el2, { scale: 0.8 }, { scale: 1, duration: 0.45 / State.speed, ease: 'back.out(1.7)' });
        }

        document.getElementById('disk-hint-text').textContent = `【节拍 2/6 · 分配索引块】先分配一个索引块，例如盘块 #${indexBlock}，变深蓝${l2IndexBlock !== -1 ? `；二级索引块 #${l2IndexBlock} 变浅蓝` : ''}。`;
        addLog('分配索引块', `先分配一个索引块，例如盘块 #${indexBlock}，变蓝。`);
      },
      // 节拍 3：分配数据块 (变红，平滑过渡)
      () => {
        clearHighlights();
        dataBlocks.forEach((bid, idx) => {
          State.blocks[bid].status = 'allocated';
          State.blocks[bid].file = fileName;
          State.blocks[bid].blockIdx = idx;

          const el = document.getElementById(`disk-block-${bid}`);
          const bodyEl = document.getElementById(`block-body-${bid}`);
          const footerEl = document.getElementById(`block-footer-${bid}`);

          if (el) {
            gsap.to(el, {
              scale: 1.08,
              duration: 0.2 / State.speed,
              delay: (idx * 0.08) / State.speed,
              onStart: () => {
                el.className = 'disk-block allocated';
                if (bodyEl) bodyEl.textContent = `${fileName}[${idx}]`;
                if (footerEl) footerEl.textContent = '';
              },
              onComplete: () => {
                gsap.to(el, { scale: 1, duration: 0.2 / State.speed, ease: 'power2.out' });
              }
            });
          }
        });

        document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 分配数据块】再分配 ${length} 个数据块，例如 [${dataBlocks.join(', ')}]，变红。`;
        addLog('分配数据块', `再分配 ${length} 个数据块，例如 ${dataBlocks.join(', ')}，变红。`);
      },
      // 节拍 4：索引块填写与目录更新
      () => {
        clearHighlights();
        State.files[fileName] = {
          name: fileName,
          level: level,
          indexBlock: indexBlock,
          l1Index: indexBlock,
          l2Index: l2IndexBlock,
          l3Index: l3IndexBlock,
          blocks: dataBlocks
        };
        renderDirectoryTable();
        renderMetadataPanel();

        document.getElementById('disk-hint-text').textContent = `【节拍 4/6 · 索引表逐项填写】索引块 #${indexBlock} 内部逐项填写：${dataBlocks.map((b, i) => `第 ${i} 项 ➔ ${b}`).join('，')}；目录新增：${fileName} | 索引块 ${indexBlock}。`;
        addLog('索引逐项填写', `索引块内部逐项填写数据块号；目录新增：${fileName} | 索引块 ${indexBlock}。`);
      },
      // 节拍 5：从索引项画有向箭头指向数据块
      () => {
        clearHighlights();
        clearSvgArrows();

        if (level === 'single') {
          dataBlocks.forEach((db, i) => {
            drawAnimatedSvgArrow(indexBlock, db, '#2563EB', 'arrow-blue', false, i * 0.12 / State.speed);
          });
        } else if (level === 'double') {
          drawAnimatedSvgArrow(indexBlock, l2IndexBlock, '#2563EB', 'arrow-blue', false, 0);
          dataBlocks.forEach((db, i) => {
            drawAnimatedSvgArrow(l2IndexBlock, db, '#059669', 'arrow-emerald', false, 0.2 / State.speed + i * 0.1 / State.speed);
          });
        } else {
          drawAnimatedSvgArrow(indexBlock, l2IndexBlock, '#2563EB', 'arrow-blue', false, 0);
          drawAnimatedSvgArrow(l2IndexBlock, l3IndexBlock, '#8B5CF6', 'arrow-purple', false, 0.2 / State.speed);
          dataBlocks.forEach((db, i) => {
            drawAnimatedSvgArrow(l3IndexBlock, db, '#F97316', 'arrow-orange', false, 0.35 / State.speed + i * 0.08 / State.speed);
          });
        }

        document.getElementById('disk-hint-text').textContent = `【节拍 5/6 · 画出有向箭头】从索引项画出清晰有向箭头指向对应数据块。`;
        addLog('画出箭头', `从索引项画出有向箭头指向对应数据块。`);
      },
      // 节拍 6：考点总结
      () => {
        clearHighlights();
        State.ioCount = length + (level === 'single' ? 1 : level === 'double' ? 2 : 3);
        updateDiskStats();
        document.getElementById('disk-hint-text').textContent = `【节拍 6/6 · 考点总结】目录只记索引块号，索引块里记录所有数据块号。`;
        addLog('考点总结', `【索引分配】目录只记索引块号，索引块里记录所有数据块号，支持直接随机访问。`, 'success');
      }
    ]
  };

  startAction(action);
}

/**
 * ------------------------------------------------------------
 * B. 删除文件 (Delete File)
 * ------------------------------------------------------------
 */
function handleDeleteFile() {
  const fileKeys = Object.keys(State.files);
  if (fileKeys.length === 0) {
    addLog('删除提示', '当前没有已创建的文件可删除！', 'warn');
    return;
  }
  const fileName = document.getElementById('select-file-name').value;
  const targetFile = State.files[fileName] || State.files[fileKeys[0]];

  if (!targetFile) {
    addLog('删除提示', `文件 ${fileName} 不存在！`, 'warn');
    return;
  }

  deleteFileWorkflow(targetFile.name);
}

function deleteFileWorkflow(fileName) {
  const file = State.files[fileName];
  if (!file) return;

  const action = {
    title: `删除文件：${fileName}`,
    steps: [
      // 节拍 1：点击目录中的文件
      () => {
        clearHighlights();
        const row = document.getElementById(`dir-row-${fileName}`);
        if (row) {
          gsap.to(row, { backgroundColor: '#FEE2E2', duration: 0.3 / State.speed });
        }
        document.getElementById('disk-hint-text').textContent = `【节拍 1/6 · 选定目录】点击目录中的文件 ${fileName}。`;
        addLog('选定文件', `点击目录中的文件 ${fileName}。`);
      },
      // 节拍 2：寻址定位与闪烁预热
      () => {
        clearHighlights();
        const allBlocks = [...file.blocks];
        if (file.indexBlock) allBlocks.push(file.indexBlock);
        if (file.l2Index) allBlocks.push(file.l2Index);
        if (file.l3Index) allBlocks.push(file.l3Index);

        const targetEls = allBlocks.map(b => document.getElementById(`disk-block-${b}`)).filter(Boolean);
        gsap.to(targetEls, {
          scale: 1.08,
          borderColor: '#EAB308',
          boxShadow: '0 0 0 3px rgba(234, 179, 8, 0.4)',
          duration: 0.25 / State.speed,
          yoyo: true,
          repeat: 1
        });

        document.getElementById('disk-hint-text').textContent = `【节拍 2/6 · 定位盘块】选定归属盘块：[${allBlocks.join(', ')}]，准备平滑回收。`;
      },
      // 节拍 3：擦除字段与回收动画 (先闪烁，再变绿)
      () => {
        clearHighlights();
        const allBlocks = [...file.blocks];
        if (file.indexBlock) allBlocks.push(file.indexBlock);
        if (file.l2Index) allBlocks.push(file.l2Index);
        if (file.l3Index) allBlocks.push(file.l3Index);

        allBlocks.forEach(bid => {
          const el = document.getElementById(`disk-block-${bid}`);
          if (el) el.classList.add('recycling');
          State.blocks[bid].status = 'free';
          State.blocks[bid].file = null;
          State.blocks[bid].blockIdx = null;
          State.blocks[bid].next = null;
          State.blocks[bid].isIndex = false;
        });

        setTimeout(() => {
          renderDiskGrid();
          removeEofBadges();
        }, 350 / State.speed);

        document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 平滑变绿】盘块先金黄闪烁，随后平滑变回绿色空闲态！`;
        addLog('状态变更', `擦除字段，磁盘块从红色变回绿色。`);
      },
      // 节拍 4：元数据清除 (目录行淡出删除)
      () => {
        clearHighlights();
        const row = document.getElementById(`dir-row-${fileName}`);
        if (row) {
          gsap.to(row, {
            opacity: 0,
            y: -10,
            duration: 0.3 / State.speed,
            onComplete: () => {
              delete State.files[fileName];
              renderDirectoryTable();
              renderMetadataPanel();
            }
          });
        } else {
          delete State.files[fileName];
          renderDirectoryTable();
          renderMetadataPanel();
        }

        if (State.mode === 'fat') {
          file.blocks.forEach(b => {
            State.fatTable[b] = 'FREE';
          });
          renderMetadataPanel();
        }

        document.getElementById('disk-hint-text').textContent = `【节拍 4/6 · 目录行删除】目录行平滑删除。`;
        addLog('目录删除', `目录行删除。`);
      },
      // 节拍 5：擦除箭头 (平滑收缩消失)
      () => {
        clearHighlights();
        const arrows = document.querySelectorAll('#connection-svg-layer .dynamic-arrow-element, #connection-svg-layer path, #connection-svg-layer polygon');
        gsap.to(arrows, {
          opacity: 0,
          scale: 0.8,
          duration: 0.3 / State.speed,
          onComplete: () => clearSvgArrows()
        });
        renderContiguousSpans();
        document.getElementById('disk-hint-text').textContent = `【节拍 5/6 · 擦除箭头】有向箭头逐段平滑淡出消失。`;
        addLog('擦除连线', `有向箭头平滑淡出消失。`);
      },
      // 节拍 6：考点总结
      () => {
        clearHighlights();
        updateDiskStats();
        document.getElementById('disk-hint-text').textContent = `【节拍 6/6 · 考点总结】磁盘块成功归还空闲管理程序。`;
        addLog('考点总结', `空间顺利释放回收。`, 'success');
      }
    ]
  };

  startAction(action);
}

/**
 * ------------------------------------------------------------
 * C. 访问第 k 块 (Access Block k - 游标平滑流动，杜绝跳变)
 * ------------------------------------------------------------
 */
function handleAccessK() {
  const fileKeys = Object.keys(State.files);
  if (fileKeys.length === 0) {
    addLog('访问提示', '当前没有文件！请先创建文件 A。', 'warn');
    return;
  }
  const fileName = document.getElementById('select-file-name').value;
  const file = State.files[fileName] || State.files[fileKeys[0]];
  const k = parseInt(document.getElementById('input-access-k').value, 10) || 3;

  if (k < 0 || k >= file.blocks.length) {
    addLog('越界访问', `逻辑块号 k = ${k} 超出文件有效范围 (0 ~ ${file.blocks.length - 1})！`, 'error');
    return;
  }

  if (State.mode === 'contiguous') {
    accessBlockContiguous(file, k);
  } else if (State.mode === 'implicit') {
    accessBlockImplicit(file, k);
  } else if (State.mode === 'fat') {
    accessBlockFAT(file, k);
  } else if (State.mode === 'indexed') {
    accessBlockIndexed(file, k);
  }
}

/**
 * 1. 连续分配访问第 k 块 (直接计算光标飞跃动画)
 */
function accessBlockContiguous(file, k) {
  const targetPhysBlock = file.start + k;

  const action = {
    title: `连续分配：访问第 ${k} 块`,
    steps: [
      // 节拍 1：点击“访问第 k 块”
      () => {
        clearHighlights();
        clearSvgArrows();
        clearFlyingProbes();
        document.getElementById('disk-hint-text').textContent = `【节拍 1/6 · 访问请求】点击“访问第 ${k} 块”。`;
        addLog('访问请求', `用户点击“访问第 ${k} 块”。`);
      },
      // 节拍 2：直接高亮目录中的“起始块 8”
      () => {
        clearHighlights();
        const dirRow = document.getElementById(`dir-row-${file.name}`);
        if (dirRow) {
          gsap.fromTo(dirRow, { backgroundColor: '#FFFFFF' }, { backgroundColor: '#FEF3C7', duration: 0.35 / State.speed });
        }
        const startEl = document.getElementById(`disk-block-${file.start}`);
        if (startEl) startEl.classList.add('highlight-active');

        document.getElementById('disk-hint-text').textContent = `【节拍 2/6 · 高亮起始块】直接高亮目录中的“起始块 ${file.start}”。`;
        addLog('查阅目录', `直接高亮目录中的“起始块 ${file.start}”。`);
      },
      // 节拍 3：计算并立即跳到磁盘块 8+3=11 (平滑飞行游标)
      () => {
        clearHighlights();
        const startEl = document.getElementById(`disk-block-${file.start}`);
        const targetEl = document.getElementById(`disk-block-${targetPhysBlock}`);

        // 从起始块向目标块发射计算探针
        flyProbeBetweenElements(startEl, targetEl, `起始 ${file.start} + ${k} = #${targetPhysBlock}`, '#F59E0B', () => {
          if (targetEl) {
            targetEl.classList.add('target-hit');
            gsap.fromTo(targetEl, { scale: 0.95 }, { scale: 1.08, duration: 0.35 / State.speed, ease: 'back.out(1.8)' });
          }
        });

        document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 立即跳转】立即跳到磁盘块 ${file.start} + ${k} = #${targetPhysBlock}，高亮块 #${targetPhysBlock}。`;
        addLog('立即跳转', `立即跳到磁盘块 ${file.start} + ${k} = #${targetPhysBlock}，高亮块 #${targetPhysBlock}。`);
      },
      // 节拍 4：高亮确认读入
      () => {
        clearHighlights();
        const targetEl = document.getElementById(`disk-block-${targetPhysBlock}`);
        if (targetEl) targetEl.classList.add('target-hit');
        document.getElementById('disk-hint-text').textContent = `【节拍 4/6 · 读出数据】直接读出物理块 #${targetPhysBlock} 数据。`;
      },
      // 节拍 5：有向指示线确认
      () => {
        clearHighlights();
        const targetEl = document.getElementById(`disk-block-${targetPhysBlock}`);
        if (targetEl) targetEl.classList.add('target-hit');
        drawAnimatedSvgArrow(file.start, targetPhysBlock, '#EF4444', 'arrow-red', true, 0);
        document.getElementById('disk-hint-text').textContent = `【节拍 5/6 · 地址映射验证】目录起始块 #${file.start} ➔ 算得物理块 #${targetPhysBlock}。`;
      },
      // 节拍 6：考点总结
      () => {
        clearHighlights();
        const targetEl = document.getElementById(`disk-block-${targetPhysBlock}`);
        if (targetEl) targetEl.classList.add('target-hit');
        State.ioCount = 1;
        updateDiskStats();
        document.getElementById('disk-hint-text').textContent = `【节拍 6/6 · 考点总结】连续分配支持随机访问，计算地址即可。`;
        addLog('考点总结', `【连续分配】支持直接/随机访问，计算地址即可 (仅 1 次磁盘 I/O)。`, 'success');
      }
    ]
  };

  startAction(action);
}

/**
 * 2. 隐式链接访问第 k 块 (逐跳流动探针，完整展示第0~3块)
 */
function accessBlockImplicit(file, k) {
  const pathBlocks = file.blocks.slice(0, k + 1);

  const action = {
    title: `隐式链接：访问第 ${k} 块`,
    steps: [
      // 节拍 1：点击“访问第 k 块”
      () => {
        clearHighlights();
        clearSvgArrows();
        clearFlyingProbes();
        document.getElementById('disk-hint-text').textContent = `【节拍 1/6 · 访问请求】点击“访问第 ${k} 块”。从起始块 #${file.start} 开始。`;
        addLog('访问请求', `点击“访问第 ${k} 块”。`);
      },
      // 节拍 2：从起始块开始逐跳 (第 0 块)
      () => {
        clearHighlights();
        const b0 = pathBlocks[0];
        const el0 = document.getElementById(`disk-block-${b0}`);
        if (el0) {
          el0.classList.add('highlight-active');
          gsap.fromTo(el0, { scale: 0.95 }, { scale: 1.08, duration: 0.3 / State.speed });
        }
        document.getElementById('disk-hint-text').textContent = `【节拍 2/6 · 访问第 0 块】访问第 0 块：物理块 #${b0}。读取 next 指向 #${pathBlocks[1]}。`;
        addLog('逐跳访问', `第 0 块：物理块 #${b0}。`);
      },
      // 节拍 3：沿链逐跳访问中间盘块 (探针平滑流动，杜绝跳变)
      () => {
        clearHighlights();
        if (k <= 0) {
          const el0 = document.getElementById(`disk-block-${pathBlocks[0]}`);
          if (el0) el0.classList.add('highlight-active');
          document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 首块命中】首块即为目标逻辑块第 0 块 (#${pathBlocks[0]})。`;
          return;
        }

        // 顺序逐跳从 0 到 k-1
        const runHop = (idx) => {
          if (idx >= k) return;
          const fromB = pathBlocks[idx - 1];
          const toB = pathBlocks[idx];
          const fromEl = document.getElementById(`disk-block-${fromB}`);
          const toEl = document.getElementById(`disk-block-${toB}`);

          flyProbeBetweenElements(fromEl, toEl, `第 ${idx} 块 (#${toB})`, '#F97316', () => {
            if (toEl) toEl.classList.add('highlight-active');
            drawAnimatedSvgArrow(fromB, toB, '#F97316', 'arrow-orange', false);
            if (idx + 1 < k) {
              runHop(idx + 1);
            }
          });
        };

        const el0 = document.getElementById(`disk-block-${pathBlocks[0]}`);
        if (el0) el0.classList.add('highlight-active');
        if (k > 1) {
          runHop(1);
          document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 沿链跳转】沿指针逐跳经过：${pathBlocks.slice(0, k).map((b, i) => `第 ${i} 块(#${b})`).join(' ➔ ')}。`;
          addLog('逐跳访问', `经过：${pathBlocks.slice(0, k).map((b, i) => `第 ${i} 块(#${b})`).join(' ➔ ')}。`);
        } else {
          document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 准备抵达】第 0 块 (#${pathBlocks[0]}) next 指向第 1 块 (#${pathBlocks[1]})。`;
        }
      },
      // 节拍 4：抵达第 k 块 (目标高亮)
      () => {
        clearHighlights();
        const prevB = k > 0 ? pathBlocks[k - 1] : pathBlocks[0];
        const targetB = pathBlocks[k];
        const elPrev = document.getElementById(`disk-block-${prevB}`);
        const targetEl = document.getElementById(`disk-block-${targetB}`);

        pathBlocks.slice(0, k).forEach(b => {
          const el = document.getElementById(`disk-block-${b}`);
          if (el) el.classList.add('highlight-active');
        });

        if (k > 0) {
          flyProbeBetweenElements(elPrev, targetEl, `第 ${k} 块 (#${targetB}) 命中!`, '#EF4444', () => {
            if (targetEl) {
              targetEl.classList.remove('highlight-active');
              targetEl.classList.add('target-hit');
              gsap.fromTo(targetEl, { scale: 1 }, { scale: 1.12, duration: 0.35 / State.speed, yoyo: true, repeat: 1 });
            }
          });
        } else {
          if (targetEl) {
            targetEl.classList.remove('highlight-active');
            targetEl.classList.add('target-hit');
            gsap.fromTo(targetEl, { scale: 1 }, { scale: 1.12, duration: 0.35 / State.speed, yoyo: true, repeat: 1 });
          }
        }

        document.getElementById('disk-hint-text').textContent = `【节拍 4/6 · 抵达目标】高亮全路径：${pathBlocks.map((b, i) => `第 ${i} 块(#${b})`).join(' ➔ ')}。最终抵达第 ${k} 块 #${targetB}。`;
        addLog('抵达目标', `沿指针逐跳抵达第 ${k} 块 #${targetB}。全路径：${pathBlocks.join(' ➔ ')}。`);
      },
      // 节拍 5：全路径有向箭头高亮动画
      () => {
        clearHighlights();
        clearSvgArrows();
        for (let i = 0; i < pathBlocks.length - 1; i++) {
          drawAnimatedSvgArrow(pathBlocks[i], pathBlocks[i + 1], '#EF4444', 'arrow-red', true, i * 0.1 / State.speed);
        }
        const targetEl = document.getElementById(`disk-block-${pathBlocks[k]}`);
        if (targetEl) targetEl.classList.add('target-hit');
        document.getElementById('disk-hint-text').textContent = `【节拍 5/6 · 路径拓扑】高亮访问路径：${pathBlocks.join(' ➔ ')}。`;
      },
      // 节拍 6：考点总结
      () => {
        clearHighlights();
        const targetEl = document.getElementById(`disk-block-${pathBlocks[k]}`);
        if (targetEl) targetEl.classList.add('target-hit');
        State.ioCount = k + 1;
        updateDiskStats();
        document.getElementById('disk-hint-text').textContent = `【节拍 6/6 · 考点总结】隐式链接只能顺序访问，不能直接跳到第 k 块 (累计 ${k + 1} 次磁盘 I/O)。`;
        addLog('考点总结', `【隐式链接】只能顺序访问，不能直接跳到第 k 块，需耗费 k+1 次磁盘 I/O。`, 'warn');
      }
    ]
  };

  startAction(action);
}

/**
 * 3. 显式链接 (FAT) 访问第 k 块 (FAT 表内有向箭头跳转与跨区命中)
 */
function accessBlockFAT(file, k) {
  const pathBlocks = file.blocks.slice(0, k + 1);
  const targetPhysBlock = pathBlocks[k];

  const action = {
    title: `显式链接 (FAT)：访问第 ${k} 块`,
    steps: [
      // 节拍 1：点击“访问第 k 块”
      () => {
        clearHighlights();
        clearSvgArrows();
        clearFlyingProbes();
        document.getElementById('disk-hint-text').textContent = `【节拍 1/6 · 访问请求】点击“访问第 ${k} 块”。从 FAT[${file.start}] 开始。`;
        addLog('访问请求', `点击“访问第 ${k} 块”。`);
      },
      // 节拍 2：高亮首表项
      () => {
        clearHighlights();
        const b0 = pathBlocks[0];
        const row0 = document.getElementById(`fat-row-${b0}`);
        const node0 = document.getElementById(`fat-flow-node-${b0}`);
        if (row0) {
          row0.classList.add('active');
          gsap.fromTo(row0, { backgroundColor: '#FFFFFF' }, { backgroundColor: '#FEF3C7', duration: 0.3 / State.speed });
        }
        if (node0) {
          node0.classList.add('active');
          gsap.fromTo(node0, { scale: 0.95 }, { scale: 1.1, duration: 0.3 / State.speed });
        }
        scrollToFatRow(b0);
        document.getElementById('disk-hint-text').textContent = `【节拍 2/6 · FAT 查表跳转】首项命中：FAT[${b0}]=${pathBlocks[1]} (第 0 块 ➔ 第 1 块)。`;
        addLog('FAT查表', `高亮首项 FAT[${b0}]=${pathBlocks[1]}。`);
      },
      // 节拍 3：沿常驻内存链表演示有向跳转
      () => {
        clearHighlights();
        pathBlocks.slice(0, k).forEach((bid, idx) => {
          const row = document.getElementById(`fat-row-${bid}`);
          const node = document.getElementById(`fat-flow-node-${bid}`);
          const arrow = document.getElementById(`fat-flow-arrow-${bid}`);

          if (row) {
            setTimeout(() => {
              row.classList.add('active');
            }, (idx * 160) / State.speed);
          }
          if (node) {
            gsap.to(node, {
              scale: 1.12,
              duration: 0.25 / State.speed,
              delay: (idx * 0.16) / State.speed,
              onStart: () => node.classList.add('active')
            });
          }
          if (arrow) {
            gsap.to(arrow, {
              scale: 1.3,
              duration: 0.25 / State.speed,
              delay: (idx * 0.16 + 0.08) / State.speed,
              onStart: () => arrow.classList.add('active')
            });
          }
        });

        document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 内存链表跳转】沿有向箭头在内存中高速查表：${pathBlocks.slice(0, k).map(b => `FAT[${b}]`).join(' ➔ ')}。零磁盘 I/O！`;
        addLog('FAT内存跳转', `内存查表跳转：${pathBlocks.slice(0, k).map((b, i) => `FAT[${b}]=${pathBlocks[i+1]}`).join(' ➔ ')}。`);
      },
      // 节拍 4：最终高亮磁盘块 targetPhysBlock (从 FAT 链表演示向左侧磁盘块发射光标)
      () => {
        clearHighlights();
        pathBlocks.slice(0, k).forEach(bid => {
          const row = document.getElementById(`fat-row-${bid}`);
          const node = document.getElementById(`fat-flow-node-${bid}`);
          if (row) row.classList.add('active');
          if (node) node.classList.add('active');
        });

        const lastBid = pathBlocks[k - 1];
        const fatOriginEl = document.getElementById(`fat-flow-node-${lastBid}`) || document.getElementById(`fat-row-${lastBid}`);
        const diskTargetEl = document.getElementById(`disk-block-${targetPhysBlock}`);

        // 从 FAT 链表发射跨区域飞行探针，抛物线平滑无跳变
        flyProbeBetweenElements(fatOriginEl, diskTargetEl, `命中磁盘块 #${targetPhysBlock}`, '#8B5CF6', () => {
          if (diskTargetEl) {
            diskTargetEl.classList.add('target-hit');
            gsap.fromTo(diskTargetEl, { scale: 0.95 }, { scale: 1.12, duration: 0.35 / State.speed, ease: 'back.out(1.8)' });
          }
        });

        document.getElementById('disk-hint-text').textContent = `【节拍 4/6 · 定位磁盘块】内存查表完毕，获得物理块号 #${targetPhysBlock}，光标精准飞向磁盘块 #${targetPhysBlock}。`;
        addLog('定位物理块', `查表完毕锁定物理块 #${targetPhysBlock}。`);
      },
      // 节拍 5：确认读入
      () => {
        clearHighlights();
        const targetEl = document.getElementById(`disk-block-${targetPhysBlock}`);
        if (targetEl) targetEl.classList.add('target-hit');
        document.getElementById('disk-hint-text').textContent = `【节拍 5/6 · 物理读取】向磁盘发起唯一次读盘，读出块 #${targetPhysBlock}。`;
      },
      // 节拍 6：考点总结
      () => {
        clearHighlights();
        const targetEl = document.getElementById(`disk-block-${targetPhysBlock}`);
        if (targetEl) targetEl.classList.add('target-hit');
        State.ioCount = 1;
        updateDiskStats();
        document.getElementById('disk-hint-text').textContent = `【节拍 6/6 · 考点总结】FAT 在内存，查表跳转比隐式链接快，但仍需沿链跳转。`;
        addLog('考点总结', `【显式链接 FAT】FAT 在内存，查表跳转比隐式链接快，但仍需沿链跳转；仅需 1 次磁盘 I/O。`, 'success');
      }
    ]
  };

  startAction(action);
}

/**
 * 4. 索引分配访问第 k 块 (从索引项发射有向箭头到数据块)
 */
function accessBlockIndexed(file, k) {
  const level = file.level;
  const targetPhysBlock = file.blocks[k];

  const action = {
    title: `索引分配：访问第 ${k} 块`,
    steps: [
      // 节拍 1：点击“访问第 k 块”
      () => {
        clearHighlights();
        clearSvgArrows();
        clearFlyingProbes();
        document.getElementById('disk-hint-text').textContent = `【节拍 1/6 · 访问请求】点击“访问第 ${k} 块”。`;
        addLog('访问请求', `点击“访问第 ${k} 块”。`);
      },
      // 节拍 2：路径高亮：目录 -> 索引块 30
      () => {
        clearHighlights();
        const dirRow = document.getElementById(`dir-row-${file.name}`);
        if (dirRow) dirRow.classList.add('bg-amber-100');
        const idxBlock = file.indexBlock || file.l1Index;
        const el = document.getElementById(`disk-block-${idxBlock}`);
        if (el) {
          el.classList.add('highlight-active');
          gsap.fromTo(el, { scale: 0.95 }, { scale: 1.08, duration: 0.3 / State.speed });
        }
        document.getElementById('disk-hint-text').textContent = `【节拍 2/6 · 路径高亮】路径高亮：目录 ➔ 索引块 #${idxBlock}。`;
        addLog('路径高亮', `目录 ➔ 索引块 #${idxBlock}。`);
      },
      // 节拍 3：检索索引项（第 3 项）或逐级展开
      () => {
        clearHighlights();
        const idxBlock = file.indexBlock || file.l1Index;
        const el = document.getElementById(`disk-block-${idxBlock}`);
        if (el) el.classList.add('highlight-active');

        if (level === 'single') {
          const itemEl = document.getElementById(`idx-item-${k}`);
          if (itemEl) {
            itemEl.classList.add('border-blue-500', 'bg-blue-100', 'ring-2', 'ring-blue-300');
            gsap.fromTo(itemEl, { scale: 0.95 }, { scale: 1.05, duration: 0.3 / State.speed, ease: 'back.out(1.5)' });
          }
          document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 第 3 项定位】索引块 #${idxBlock} ➔ 第 ${k} 项 ➔ 指向数据块 #${targetPhysBlock}。`;
          addLog('检索索引项', `索引块 #${idxBlock} ➔ 第 ${k} 项 ➔ 数据块 #${targetPhysBlock}。`);
        } else {
          const l2El = document.getElementById(`disk-block-${file.l2Index}`);
          if (l2El) {
            l2El.classList.add('highlight-active');
            gsap.fromTo(l2El, { scale: 0.95 }, { scale: 1.08, duration: 0.3 / State.speed });
          }
          drawAnimatedSvgArrow(idxBlock, file.l2Index, '#2563EB', 'arrow-blue', false);
          document.getElementById('disk-hint-text').textContent = `【节拍 3/6 · 逐级展开】目录 ➔ 一级索引块 #${file.l1Index} ➔ 二级索引块 #${file.l2Index}。`;
          addLog('逐级展开', `多级索引逐级展开并高亮路径。`);
        }
      },
      // 节拍 4：高亮数据块 19 (从索引项射出有向箭头并飞跃探针)
      () => {
        clearHighlights();
        const idxBlock = file.indexBlock || file.l1Index;
        const idxEl = document.getElementById(`disk-block-${idxBlock}`);
        const itemEl = document.getElementById(`idx-item-${k}`);
        const targetEl = document.getElementById(`disk-block-${targetPhysBlock}`);

        const originEl = itemEl || idxEl;
        flyProbeBetweenElements(originEl, targetEl, `索引项 [${k}] ➔ #${targetPhysBlock}`, '#2563EB', () => {
          if (targetEl) {
            targetEl.classList.add('target-hit');
            gsap.fromTo(targetEl, { scale: 0.95 }, { scale: 1.1, duration: 0.35 / State.speed, ease: 'back.out(1.8)' });
          }
        });

        document.getElementById('disk-hint-text').textContent = `【节拍 4/6 · 抵达数据块】路径高亮：目录 ➔ 索引块 #${idxBlock} ➔ 第 ${k} 项 ➔ 数据块 #${targetPhysBlock}。`;
        addLog('高亮数据块', `高亮数据块 #${targetPhysBlock}。`);
      },
      // 节拍 5：有向箭头连线动画
      () => {
        clearHighlights();
        clearSvgArrows();
        const idxBlock = file.indexBlock || file.l1Index;
        if (level === 'single') {
          drawAnimatedSvgArrow(idxBlock, targetPhysBlock, '#2563EB', 'arrow-blue', false, 0);
        } else {
          drawAnimatedSvgArrow(idxBlock, file.l2Index, '#2563EB', 'arrow-blue', false, 0);
          drawAnimatedSvgArrow(file.l2Index, targetPhysBlock, '#F97316', 'arrow-orange', false, 0.2 / State.speed);
        }
        const targetEl = document.getElementById(`disk-block-${targetPhysBlock}`);
        if (targetEl) targetEl.classList.add('target-hit');
        document.getElementById('disk-hint-text').textContent = `【节拍 5/6 · 路径连线】从索引块项精准画出有向箭头指向数据块 #${targetPhysBlock}。`;
      },
      // 节拍 6：考点总结
      () => {
        clearHighlights();
        const targetEl = document.getElementById(`disk-block-${targetPhysBlock}`);
        if (targetEl) targetEl.classList.add('target-hit');
        const totalIo = level === 'single' ? 2 : level === 'double' ? 3 : 4;
        State.ioCount = totalIo;
        updateDiskStats();
        if (level === 'single') {
          document.getElementById('disk-hint-text').textContent = `【节拍 6/6 · 考点总结】索引分配支持随机访问，第 i 块直接查索引表第 i 项 (共需 2 次磁盘 I/O)。`;
          addLog('考点总结', `【索引分配】支持随机访问，第 i 块直接查索引表第 i 项。`, 'success');
        } else {
          document.getElementById('disk-hint-text').textContent = `【节拍 6/6 · 考点总结】多级索引适合大文件，但访问路径变长 (需 ${totalIo} 次磁盘 I/O)。`;
          addLog('考点总结', `【多级索引】适合超大文件，但逐级访问使得路径变长，需要 ${totalIo} 次磁盘 I/O。`, 'warn');
        }
      }
    ]
  };

  startAction(action);
}

// ============================================================
// 6. 特色边界与故障演示 (外部碎片 / 隐式断链 / 多级索引解析)
// ============================================================

function handleFeatureDemo() {
  if (State.mode === 'contiguous') {
    demoExternalFragmentation();
  } else if (State.mode === 'implicit') {
    demoBrokenLink();
  } else if (State.mode === 'fat') {
    demoFATFastLookup();
  } else if (State.mode === 'indexed') {
    demoMultiLevelIndexing();
  }
}

/**
 * 连续分配边界：外部碎片导致分配失败
 */
function demoExternalFragmentation() {
  resetDiskState();
  clearSvgArrows();
  clearFlyingProbes();

  // 构造交错碎片盘块：使磁盘块网格中红色和绿色交错
  const preUsed = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38];
  preUsed.forEach(b => {
    State.blocks[b].status = 'allocated';
    State.blocks[b].file = 'X';
    State.blocks[b].blockIdx = 0;
  });

  renderDiskGrid();
  addLog('外部碎片模拟', '磁盘块网格中红色和绿色交错，显示“外部碎片”。空闲块虽多但不连续！', 'warn');

  setTimeout(() => {
    addLog('创建尝试', '用户尝试创建长度为 5 的文件，分配器开始连续扫描...');
    let failScanned = [0, 1, 3, 4, 6, 7];
    failScanned.forEach(bid => {
      const el = document.getElementById(`disk-block-${bid}`);
      if (el) el.classList.add('highlight-active');
    });

    setTimeout(() => {
      clearHighlights();
      document.getElementById('disk-hint-text').innerHTML = `
        <span class="text-rose-700 font-bold">⚠️ 当空闲块足够多但不连续时，创建失败。磁盘块网格中红色和绿色交错，显示“外部碎片”。提示：没有足够大的连续空闲区！</span>
      `;
      addLog('边界提示', '没有足够大的连续空闲区。当空闲块足够多但不连续时，创建失败。', 'error');
    }, 1200 / State.speed);
  }, 600 / State.speed);
}

/**
 * 隐式链接故障：某块 next 损坏，访问中断
 */
function demoBrokenLink() {
  resetDiskState();
  createFileImplicit('A', 5);

  setTimeout(() => {
    State.blocks[13].next = 'DAMAGED';
    const b13 = document.getElementById(`disk-block-13`);
    if (b13) {
      b13.style.borderColor = '#DC2626';
      b13.style.backgroundColor = '#FEE2E2';
      document.getElementById('block-footer-13').innerHTML = '<span class="text-rose-600 font-bold">💥损坏</span>';
    }

    addLog('断链模拟', '隐式链接断链演示：盘块 13 扇区损坏，next 指针丢失！', 'error');

    setTimeout(() => {
      const b8 = document.getElementById(`disk-block-8`);
      if (b8) b8.classList.add('highlight-active');
      if (b13) b13.classList.add('highlight-active');

      document.getElementById('disk-hint-text').innerHTML = `
        <span class="text-rose-700 font-bold">💥 隐式链接演示断链：盘块 13 的 next 损坏，访问第 3 块在盘块 13 处中断！后续数据块全部失联。</span>
      `;
      addLog('访问中断', '隐式链接断链：某块 next 损坏，访问中断！证明可靠性差。', 'error');
    }, 1400 / State.speed);
  }, 1200 / State.speed);
}

function demoFATFastLookup() {
  resetDiskState();
  createFileFAT('A', 5);
  setTimeout(() => {
    accessBlockFAT(State.files['A'], 3);
  }, 1000 / State.speed);
}

function demoMultiLevelIndexing() {
  switchIndexLevel('double');
  setTimeout(() => {
    createFileIndexed('A', 5);
  }, 500 / State.speed);
}

// ============================================================
// 7. 对比模式 (Comparison Mode) 核心逻辑
// ============================================================

function initComparisonView() {
  initMiniGrid('comp-grid-cont');
  initMiniGrid('comp-grid-impl');
  initMiniGrid('comp-grid-fat');
  initMiniGrid('comp-grid-idx');

  resetComparisonMode();
}

function initMiniGrid(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  for (let i = 0; i < TOTAL_BLOCKS; i++) {
    const el = document.createElement('div');
    el.id = `${containerId}-block-${i}`;
    el.className = 'mini-disk-block bg-emerald-50 border-emerald-200 text-emerald-800';
    el.textContent = i;
    container.appendChild(el);
  }
}

function resetComparisonMode() {
  ['comp-grid-cont', 'comp-grid-impl', 'comp-grid-fat', 'comp-grid-idx'].forEach(gridId => {
    for (let i = 0; i < TOTAL_BLOCKS; i++) {
      const el = document.getElementById(`${gridId}-block-${i}`);
      if (el) {
        el.className = 'mini-disk-block bg-emerald-50 border-emerald-200 text-emerald-800';
      }
    }
  });

  document.getElementById('comp-io-cont').textContent = 'I/O: - 次';
  document.getElementById('comp-io-impl').textContent = 'I/O: - 次';
  document.getElementById('comp-io-fat').textContent = 'I/O: - 次';
  document.getElementById('comp-io-idx').textContent = 'I/O: - 次';

  document.getElementById('comp-path-cont').textContent = '等待创建文件...';
  document.getElementById('comp-path-impl').textContent = '等待创建文件...';
  document.getElementById('comp-path-fat').textContent = '等待创建文件...';
  document.getElementById('comp-path-idx').textContent = '等待创建文件...';

  addLog('对比模式', '四宫格对比系统已重置就绪。');
}

/**
 * 四种分配方式同时创建文件 A (5块)
 */
function runComparisonCreate() {
  resetComparisonMode();
  addLog('四路同时创建', '使用同一个文件长度 5 块，同时在四种方法下执行创建文件...');

  // 1. 连续分配：8, 9, 10, 11, 12
  const contBlocks = [8, 9, 10, 11, 12];
  contBlocks.forEach(bid => {
    const el = document.getElementById(`comp-grid-cont-block-${bid}`);
    if (el) el.className = 'mini-disk-block bg-rose-100 border-rose-300 text-rose-800 font-bold';
  });
  document.getElementById('comp-dir-cont').textContent = '文件 A | 起始: 8, 长度: 5';
  document.getElementById('comp-path-cont').textContent = '连续分布：[8, 9, 10, 11, 12]。必须整段连续空闲。';

  // 2. 隐式链接：8, 13, 2, 19, 7
  const discBlocks = [8, 13, 2, 19, 7];
  discBlocks.forEach(bid => {
    const el = document.getElementById(`comp-grid-impl-block-${bid}`);
    if (el) el.className = 'mini-disk-block bg-orange-100 border-orange-300 text-orange-800 font-bold';
  });
  document.getElementById('comp-dir-impl').textContent = '文件 A | 起始: 8, 结束: 7';
  document.getElementById('comp-path-impl').textContent = '离散分布：[8, 13, 2, 19, 7]。盘块内部保存 next 指针。';

  // 3. 显式链接 FAT：8, 13, 2, 19, 7
  discBlocks.forEach(bid => {
    const el = document.getElementById(`comp-grid-fat-block-${bid}`);
    if (el) el.className = 'mini-disk-block bg-purple-100 border-purple-300 text-purple-800 font-bold';
  });
  document.getElementById('comp-dir-fat').textContent = '文件 A | 起始: 8 (FAT在内存)';
  document.getElementById('comp-path-fat').textContent = '离散分布：[8, 13, 2, 19, 7]。指针集中在内存 FAT 中。';

  // 4. 索引分配：索引块 30，数据块 8, 13, 2, 19, 7
  const idxBlock = 30;
  const idxEl = document.getElementById(`comp-grid-idx-block-${idxBlock}`);
  if (idxEl) idxEl.className = 'mini-disk-block bg-blue-600 text-white font-bold border-blue-700';
  discBlocks.forEach(bid => {
    const el = document.getElementById(`comp-grid-idx-block-${bid}`);
    if (el) el.className = 'mini-disk-block bg-blue-100 border-blue-300 text-blue-800 font-bold';
  });
  document.getElementById('comp-dir-idx').textContent = '文件 A | 索引块: 30';
  document.getElementById('comp-path-idx').textContent = '外存分配索引块 #30 (蓝色) 记录数据块映射。';

  addLog('创建完成', '四种方法下磁盘块分布和元数据差异直观呈现！', 'success');
}

/**
 * 四种分配方式同时访问第 3 块
 */
function runComparisonAccess() {
  addLog('四路同时访问', '同时执行“访问第 3 块”，并排显示四种分配方式的访问路径...');

  // 1. 连续分配：计算起始块 + 3
  const contTarget = 11;
  const contEl = document.getElementById(`comp-grid-cont-block-${contTarget}`);
  if (contEl) contEl.className = 'mini-disk-block bg-amber-400 text-white font-bold animate-pulse ring-2 ring-amber-500';
  document.getElementById('comp-io-cont').textContent = 'I/O: 1 次';
  document.getElementById('comp-path-cont').textContent = '连续分配：计算起始块 + 3 = 11。直接定位！';

  // 2. 隐式链接：沿磁盘块 next 逐跳
  const implPath = [8, 13, 2, 19];
  implPath.forEach((bid, idx) => {
    setTimeout(() => {
      const el = document.getElementById(`comp-grid-impl-block-${bid}`);
      if (el) el.className = `mini-disk-block ${bid === 19 ? 'bg-amber-400 text-white font-bold ring-2 ring-amber-500' : 'bg-orange-300 text-white font-bold'}`;
    }, idx * 250);
  });
  document.getElementById('comp-io-impl').textContent = 'I/O: 4 次';
  document.getElementById('comp-path-impl').textContent = '隐式链接：沿磁盘块 next 逐跳：8 ➔ 13 ➔ 2 ➔ 19。';

  // 3. 显式链接 FAT：沿 FAT 表逐跳
  setTimeout(() => {
    const fatEl = document.getElementById(`comp-grid-fat-block-19`);
    if (fatEl) fatEl.className = 'mini-disk-block bg-amber-400 text-white font-bold animate-pulse ring-2 ring-amber-500';
    document.getElementById('comp-io-fat').textContent = 'I/O: 1 次';
    document.getElementById('comp-path-fat').textContent = '显式链接：沿 FAT 表逐跳 (内存)，最终读磁盘块 19。';
  }, 400);

  // 4. 索引分配：目录 -> 索引块 -> 第 3 项 -> 数据块
  setTimeout(() => {
    const idxTarget = document.getElementById(`comp-grid-idx-block-19`);
    if (idxTarget) idxTarget.className = 'mini-disk-block bg-amber-400 text-white font-bold animate-pulse ring-2 ring-amber-500';
    document.getElementById('comp-io-idx').textContent = 'I/O: 2 次';
    document.getElementById('comp-path-idx').textContent = '索引分配：目录 ➔ 索引块 ➔ 第 3 项 ➔ 数据块 19。';
  }, 600);

  setTimeout(() => {
    addLog('差异总结', '连续分配：随机访问最快，但要求连续空间，有外部碎片。', 'info');
    addLog('差异总结', '隐式链接：无外部碎片，不能随机访问，指针分散在磁盘块。', 'info');
    addLog('差异总结', '显式链接：FAT 在内存，查表快，但 FAT 占内存。', 'info');
    addLog('差异总结', '索引分配：支持随机访问，索引块有额外开销，多级索引适合大文件。', 'success');
  }, 1000);
}

// ============================================================
// 8. 辅助工具与连线绘制 (SVG Arrow Drawer & Flying Probes)
// ============================================================

/**
 * 平滑展开绘制 SVG 有向箭头 (带 strokeDashoffset 动画与高精度矢量方向箭头)
 */
function drawAnimatedSvgArrow(fromBlockId, toBlockId, color = '#F97316', markerId = 'arrow-orange', dashed = false, delay = 0, immediate = false) {
  const el1 = document.getElementById(`disk-block-${fromBlockId}`);
  const el2 = document.getElementById(`disk-block-${toBlockId}`);
  if (!el1 || !el2) return;

  const r1 = el1.getBoundingClientRect();
  const r2 = el2.getBoundingClientRect();
  const svg = document.getElementById('connection-svg-layer');
  if (!svg) return;

  const x1 = r1.left + r1.width / 2;
  const y1 = r1.top + r1.height / 2;
  const x2 = r2.left + r2.width / 2;
  const y2 = r2.top + r2.height / 2;

  const dx = x2 - x1;
  const dy = y2 - y1;

  // 优雅的弧度控制点 (轻微弧线避免直线重叠)
  const cx = (x1 + x2) / 2 - dy * 0.22;
  const cy = (y1 + y2) / 2 + dx * 0.22;

  // 计算目标边缘外缩尺寸 (落在方块外边框边缘)
  const targetOffset = Math.min(r2.width, r2.height) / 2 + 3;
  const vx = x2 - cx;
  const vy = y2 - cy;
  const len = Math.hypot(vx, vy) || 1;
  const ex = x2 - (vx / len) * targetOffset;
  const ey = y2 - (vy / len) * targetOffset;

  // 计算起点外扩尺寸
  const sourceOffset = Math.min(r1.width, r1.height) / 2 + 2;
  const vx0 = cx - x1;
  const vy0 = cy - y1;
  const len0 = Math.hypot(vx0, vy0) || 1;
  const sx = x1 + (vx0 / len0) * sourceOffset;
  const sy = y1 + (vy0 / len0) * sourceOffset;

  // 箭头切线角度 (度)
  const angleRad = Math.atan2(ey - cy, ex - cx);
  const angleDeg = angleRad * (180 / Math.PI);

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'dynamic-arrow-element');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`);
  path.setAttribute('class', `flow-arrow-path ${dashed ? 'flow-arrow-dash' : ''}`);
  path.setAttribute('stroke', color);
  group.appendChild(path);

  // 绘制高精度矢量有向箭头尖端 (以 (ex, ey) 为尖端，沿切线旋转)
  const arrowHead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  arrowHead.setAttribute('points', '-13,-7 2,0 -13,7 -9,0');
  arrowHead.setAttribute('fill', color);
  arrowHead.setAttribute('class', 'flow-arrow-head');
  arrowHead.setAttribute('transform', `translate(${ex}, ${ey}) rotate(${angleDeg})`);
  group.appendChild(arrowHead);

  svg.appendChild(group);

  if (immediate) {
    path.style.strokeDasharray = 'none';
    path.style.strokeDashoffset = '0';
    arrowHead.style.opacity = '1';
    return;
  }

  // 平滑绘制过渡动画
  const pathLength = path.getTotalLength() || 100;
  path.style.strokeDasharray = `${pathLength} ${pathLength}`;
  path.style.strokeDashoffset = pathLength;
  arrowHead.style.opacity = '0';

  const drawDuration = 0.42 / State.speed;
  gsap.to(path, {
    strokeDashoffset: 0,
    duration: drawDuration,
    delay: delay,
    ease: 'power2.out',
    onComplete: () => {
      gsap.fromTo(arrowHead, 
        { opacity: 0, scale: 0.3, transformOrigin: '0px 0px' },
        { opacity: 1, scale: 1, duration: 0.2 / State.speed, ease: 'back.out(2)' }
      );
    }
  });
}

/**
 * 飞行探针动画：在任意两个 DOM 元素间以抛物线平滑飞行，杜绝跳变
 */
function flyProbeBetweenElements(fromEl, toEl, label, color = '#F59E0B', onComplete) {
  if (!fromEl || !toEl) {
    if (onComplete) onComplete();
    return;
  }

  const container = document.getElementById('flying-probe-container');
  const r1 = fromEl.getBoundingClientRect();
  const r2 = toEl.getBoundingClientRect();

  const startX = r1.left + r1.width / 2;
  const startY = r1.top + r1.height / 2;
  const targetX = r2.left + r2.width / 2;
  const targetY = r2.top + r2.height / 2;

  const probe = document.createElement('div');
  probe.className = 'flying-probe';
  probe.style.backgroundColor = color;
  probe.style.color = '#FFFFFF';
  probe.style.left = `${startX}px`;
  probe.style.top = `${startY}px`;
  probe.innerHTML = `<span>⚡</span><span>${label}</span>`;
  container.appendChild(probe);

  // 抛物线高点
  const peakY = Math.min(startY, targetY) - 35;
  const midX = (startX + targetX) / 2;

  gsap.fromTo(probe, 
    { scale: 0.7, opacity: 0 }, 
    { scale: 1, opacity: 1, duration: 0.15 / State.speed }
  );

  // 优雅的二段抛物线运动
  gsap.to(probe, {
    keyframes: [
      { left: midX, top: peakY, ease: 'power1.out', duration: 0.32 / State.speed },
      { left: targetX, top: targetY, ease: 'power1.in', duration: 0.33 / State.speed }
    ],
    onComplete: () => {
      gsap.to(probe, {
        scale: 1.35,
        opacity: 0,
        duration: 0.18 / State.speed,
        onComplete: () => {
          probe.remove();
          if (onComplete) onComplete();
        }
      });
    }
  });
}

function addEofBadgeToBlock(blockId) {
  const el = document.getElementById(`disk-block-${blockId}`);
  if (!el) return;
  const badge = document.createElement('div');
  badge.id = `eof-badge-${blockId}`;
  badge.className = 'eof-floating-badge';
  badge.textContent = 'EOF';
  el.appendChild(badge);
  gsap.fromTo(badge, { scale: 0 }, { scale: 1, duration: 0.3 / State.speed, ease: 'back.out(2)' });
}

function removeEofBadges() {
  document.querySelectorAll('.eof-floating-badge').forEach(el => el.remove());
}

function clearSvgArrows() {
  const svg = document.getElementById('connection-svg-layer');
  if (!svg) return;
  svg.querySelectorAll('.dynamic-arrow-element').forEach(el => el.remove());
  svg.querySelectorAll('path, polygon, g').forEach(el => {
    if (!el.closest('defs')) el.remove();
  });
}

function clearFlyingProbes() {
  const container = document.getElementById('flying-probe-container');
  if (container) container.innerHTML = '';
}

function redrawActiveConnections() {
  clearSvgArrows();
  renderContiguousSpans();
  if (State.mode === 'implicit') {
    Object.values(State.files).forEach(f => {
      for (let i = 0; i < f.blocks.length - 1; i++) {
        drawAnimatedSvgArrow(f.blocks[i], f.blocks[i + 1], '#F97316', 'arrow-orange', false, 0, true);
      }
    });
  } else if (State.mode === 'indexed') {
    Object.values(State.files).forEach(f => {
      if (f.level === 'single') {
        f.blocks.forEach(b => drawAnimatedSvgArrow(f.indexBlock, b, '#2563EB', 'arrow-blue', false, 0, true));
      } else if (f.level === 'double') {
        drawAnimatedSvgArrow(f.indexBlock, f.l2Index, '#2563EB', 'arrow-blue', false, 0, true);
        f.blocks.forEach(b => drawAnimatedSvgArrow(f.l2Index, b, '#059669', 'arrow-emerald', false, 0, true));
      } else {
        drawAnimatedSvgArrow(f.indexBlock, f.l2Index, '#2563EB', 'arrow-blue', false, 0, true);
        drawAnimatedSvgArrow(f.l2Index, f.l3Index, '#8B5CF6', 'arrow-purple', false, 0, true);
        f.blocks.forEach(b => drawAnimatedSvgArrow(f.l3Index, b, '#F97316', 'arrow-orange', false, 0, true));
      }
    });
  }
  // FAT 模式：由常驻内存的链表演示组件直接展示，不需要在 FAT 表中绘制连线
}

function clearHighlights() {
  document.querySelectorAll('.highlight-active').forEach(el => el.classList.remove('highlight-active'));
  document.querySelectorAll('.target-hit').forEach(el => el.classList.remove('target-hit'));
  document.querySelectorAll('.fat-row.active').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.fat-flow-node.active').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.fat-flow-arrow.active').forEach(el => el.classList.remove('active'));
}

function scrollToFatRow(index) {
  const row = document.getElementById(`fat-row-${index}`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function onDiskBlockClicked(blockId) {
  const blk = State.blocks[blockId];
  if (blk.status === 'free') {
    addLog('盘块状态', `物理盘块 #${blockId} 当前处于【空闲】状态。`);
  } else if (blk.status === 'allocated') {
    addLog('盘块状态', `物理盘块 #${blockId} 属于文件【${blk.file}】，为逻辑第 ${blk.blockIdx} 块${blk.next ? `，next 指针 = #${blk.next}` : ''}。`);
  } else if (blk.status.startsWith('index')) {
    addLog('盘块状态', `物理盘块 #${blockId} 为文件【${blk.file}】的【${blk.status === 'index' ? '一级索引块' : '二级索引块'}】。`);
  }
}

function findFreeBlock() {
  for (let i = 0; i < TOTAL_BLOCKS; i++) {
    if (State.blocks[i].status === 'free') return i;
  }
  return -1;
}

function findFreeBlocks(count) {
  const res = [];
  for (let i = 0; i < TOTAL_BLOCKS && res.length < count; i++) {
    if (State.blocks[i].status === 'free') res.push(i);
  }
  return res;
}

function quickAccessFile(fileName, k) {
  document.getElementById('select-file-name').value = fileName;
  document.getElementById('input-access-k').value = k;
  handleAccessK();
}

function quickDeleteFile(fileName) {
  deleteFileWorkflow(fileName);
}

function addLog(action, detail, type = 'info') {
  const container = document.getElementById('log-container');
  if (!container) return;

  const item = document.createElement('div');
  item.className = 'flex items-start gap-2 leading-relaxed';

  const timeStr = new Date().toTimeString().split(' ')[0];
  let badgeClass = 'bg-stone-800 text-stone-300 border-stone-700';

  if (type === 'success') badgeClass = 'bg-emerald-950 text-emerald-300 border-emerald-800';
  else if (type === 'error') badgeClass = 'bg-rose-950 text-rose-300 border-rose-800';
  else if (type === 'warn') badgeClass = 'bg-amber-950 text-amber-300 border-amber-800';

  item.innerHTML = `
    <span class="text-stone-500 font-mono text-[10px] whitespace-nowrap pt-0.5">[${timeStr}]</span>
    <span class="px-1.5 py-0.2 rounded border text-[10px] whitespace-nowrap font-bold ${badgeClass}">${action}</span>
    <span class="text-stone-300 flex-1">${detail}</span>
  `;

  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
