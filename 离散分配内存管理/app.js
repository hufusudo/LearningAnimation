/**
 * 离散分配存储管理 (基本分页 / 基本分段 / 段页式) 动画演示引擎
 * 遵循 Taste-Skill Light Editorial 浅色纸质美学与 60fps 缓动规范
 */

// ============================================================
// 1. 全局配置与状态定义
// ============================================================
const State = {
  mode: 'paging', // 'paging' | 'seg' | 'segpage'
  currentStep: 0,
  isPlaying: false,
  speed: 1.0, // 0.5, 1.0, 1.5
  timer: null,
  isAnimating: false,
};

// 模式元数据
const ModesConfig = {
  paging: {
    name: '基本分页存储管理 (Paging)',
    accent: '#2563EB',
    dotClass: 'bg-blue-600',
    intro: '进程逻辑地址空间划分成等长“页”(Page，此处为4KB)。主存内核区存放页表，用户区划分为等长“页框”(Page Frame)。硬件通过“基址 + 页号 × 页表项大小”直接寻址，因此页表中页号在物理上并不单独占用存储空间，标记为<b>【隐藏】</b>。',
    tableTitle: '进程页表 (Page Table in Kernel Space)',
    userTitle: '物理页框阵列 (Physical Page Frames · 4KB/Frame)',
    baseReg: 'PTR = 0xC0004000 (页表始址) | 页表长度 = 3',
    steps: [
      { title: '0. 初始就绪', desc: '进程包含3个逻辑页，内核区页表已建立，主存页框离散分布。' },
      { title: '1. Page 0 匹配与装入', desc: '提取 Page 0 页号「0」移动至页表项[0]匹配 → 页框号3与物理页框3同时高亮 → Page 0 平滑装入。' },
      { title: '2. Page 1 匹配与装入', desc: '提取 Page 1 页号「1」移动至页表项[1]匹配 → 页框号7与物理页框7同时高亮 → Page 1 平滑装入。' },
      { title: '3. Page 2 匹配与装入', desc: '提取 Page 2 页号「2」移动至页表项[2]匹配 → 页框号1与物理页框1同时高亮 → Page 2 平滑装入。' },
      { title: '4. 分页装载完成', desc: '所有逻辑页离散装入物理页框，逻辑地址连续而物理地址离散，消除了外部碎片。' }
    ]
  },
  seg: {
    name: '基本分段存储管理 (Segmentation)',
    accent: '#D97706',
    dotClass: 'bg-amber-600',
    intro: '根据程序员的逻辑功能划分为大小不等的“段”(代码段、数据段、栈段)。主存内核区维护段表，记录段号(隐含)、段长与基地址。内存中各段占用连续空间，不同段离散放置，无内部碎片，但会产生外部碎片。',
    tableTitle: '进程段表 (Segment Table in Kernel Space)',
    userTitle: '物理分段主存区间 (Segment Partitions · Variable Size)',
    baseReg: 'STR = 0xC0008000 (段表始址) | 段表长度 = 3',
    steps: [
      { title: '0. 初始就绪', desc: '进程按功能划分为主程序段(60KB)、数据段(40KB)与栈段(30KB)。' },
      { title: '1. 段 0 匹配与装入', desc: '提取段号「0」移动至段表项[0]匹配 → 越界校验通过 → 基地址0x20000与物理段0区同时高亮 → 装入主存。' },
      { title: '2. 段 1 匹配与装入', desc: '提取段号「1」移动至段表项[1]匹配 → 越界校验通过 → 基地址0x50000与物理段1区同时高亮 → 装入主存。' },
      { title: '3. 段 2 匹配与装入', desc: '提取段号「2」移动至段表项[2]匹配 → 越界校验通过 → 基地址0x80000与物理段2区同时高亮 → 装入主存。' },
      { title: '4. 分段装载完成', desc: '所有段分配完毕，直观呈现不同段间因无法利用而留存的外部碎片(20KB)。' }
    ]
  },
  segpage: {
    name: '段页式存储管理 (Segmented Paging)',
    accent: '#7C3AED',
    dotClass: 'bg-purple-600',
    intro: '先将作业按逻辑分段，段内再划分为固定大小的页。主存内核区设有 1 个段表，每个段各拥有 1 个页表。结合了分段的逻辑独立与分页的高效无外碎片优势，兼具共享与保护。',
    tableTitle: '段表与二级页表 (Segment & Page Tables in Kernel)',
    userTitle: '物理页框阵列 (Physical Page Frames · 4KB/Frame)',
    baseReg: 'STR = 0xC0009000 (段表始址) | 二级页表地址联动',
    steps: [
      { title: '0. 初始就绪', desc: '进程分为代码段与数据段，每段内各细分为2个4KB逻辑页。' },
      { title: '1. 段 0 检索段表', desc: '逻辑地址提取段号「0」移动至段表第 0 项匹配，定位段0专属页表基址 0xC0005000。' },
      { title: '2. 段0 · Page 0 装入', desc: '提取页号「0」移动至段0页表项 → 页框号2与物理页框2同时高亮 → Page 0-0 装入页框2。' },
      { title: '3. 段0 · Page 1 装入', desc: '提取页号「1」移动至段0页表项 → 页框号5与物理页框5同时高亮 → Page 0-1 装入页框5。' },
      { title: '4. 段 1 两级装入', desc: '段号1检索段表 → 激活段1页表 → 页框号0与4同时高亮 → 段1两页装入物理页框0和4。' },
      { title: '5. 段页式完成', desc: '段页式两级动态映射完成，兼顾逻辑分段易共享与离散分页防碎片。' }
    ]
  }
};

// ============================================================
// 2. 界面初始化与控制函数
// ============================================================

function init() {
  bindEvents();
  renderCurrentMode();
}

function bindEvents() {
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-prev').addEventListener('click', prevStep);
  document.getElementById('btn-next').addEventListener('click', () => nextStep(false));
  document.getElementById('btn-reset').addEventListener('click', resetDemo);

  document.getElementById('speed-05').addEventListener('click', () => setSpeed(0.5));
  document.getElementById('speed-10').addEventListener('click', () => setSpeed(1.0));
  document.getElementById('speed-15').addEventListener('click', () => setSpeed(1.5));
}

function setSpeed(speedVal) {
  State.speed = speedVal;
  [0.5, 1.0, 1.5].forEach(v => {
    const btn = document.getElementById(`speed-${v === 0.5 ? '05' : v === 1.0 ? '10' : '15'}`);
    if (v === speedVal) {
      btn.className = "px-2 py-0.5 rounded border border-stone-900 bg-stone-900 text-white font-bold text-xs";
    } else {
      btn.className = "px-2 py-0.5 rounded border border-stone-200 hover:border-stone-400 text-stone-600 text-xs";
    }
  });
}

function switchMode(modeKey) {
  if (State.isAnimating) return;
  stopPlay();
  clearFlyingOverlay();
  State.mode = modeKey;
  State.currentStep = 0;

  // 更新 Tab 按钮状态
  ['paging', 'seg', 'segpage'].forEach(k => {
    const btn = document.getElementById(`tab-${k}`);
    if (k === modeKey) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  renderCurrentMode();
}

function renderCurrentMode() {
  const cfg = ModesConfig[State.mode];

  // 更新标题与介绍
  document.getElementById('proc-dot-color').className = `w-3 h-3 rounded-full ${cfg.dotClass}`;
  document.getElementById('proc-mode-intro').innerHTML = cfg.intro;
  document.getElementById('kernel-table-title').textContent = cfg.tableTitle;
  document.getElementById('user-space-title').textContent = cfg.userTitle;
  document.getElementById('base-register-display').textContent = cfg.baseReg;

  // 渲染步骤条
  renderTimelineSteps();

  // 渲染进程左侧视图
  renderProcessView();

  // 渲染逻辑地址条
  renderLogicalAddressBar();

  // 渲染内核区表格
  renderKernelTable();

  // 渲染物理主存用户区
  renderUserMemory();

  // 更新 MMU 状态
  updateMMUState();
}

function renderTimelineSteps() {
  const cfg = ModesConfig[State.mode];
  const container = document.getElementById('step-timeline-container');
  container.innerHTML = '';

  cfg.steps.forEach((st, idx) => {
    const pill = document.createElement('button');
    pill.className = `step-pill ${idx === State.currentStep ? 'active' : (idx < State.currentStep ? 'completed' : '')}`;
    pill.textContent = st.title;
    pill.onclick = () => {
      if (State.isAnimating) return;
      stopPlay();
      clearFlyingOverlay();
      State.currentStep = idx;
      renderCurrentMode();
    };
    container.appendChild(pill);
  });

  // 更新前进后退按钮状态
  document.getElementById('btn-prev').disabled = (State.currentStep === 0);
  document.getElementById('btn-next').disabled = (State.currentStep >= cfg.steps.length - 1);
}

// ============================================================
// 3. 左侧进程空间渲染
// ============================================================

function renderProcessView() {
  const container = document.getElementById('process-elements-container');
  container.innerHTML = '';

  if (State.mode === 'paging') {
    const pages = [
      { id: 0, name: 'Page 0', role: '代码段指令 (Code/Text)', size: '4 KB', addr: '0x0000 - 0x0FFF', frameTarget: 3, loadedInStep: 1 },
      { id: 1, name: 'Page 1', role: '常量只读数据 (Rodata)', size: '4 KB', addr: '0x1000 - 0x1FFF', frameTarget: 7, loadedInStep: 2 },
      { id: 2, name: 'Page 2', role: '用户栈与变量 (Stack/Data)', size: '4 KB', addr: '0x2000 - 0x2FFF', frameTarget: 1, loadedInStep: 3 }
    ];

    pages.forEach(p => {
      const isLoaded = State.currentStep >= p.loadedInStep;
      const isCurrentActive = (p.loadedInStep === State.currentStep);

      const el = document.createElement('div');
      el.id = `proc-item-page-${p.id}`;
      el.className = `p-3 rounded-xl border transition-all duration-300 relative overflow-hidden ${
        isLoaded 
          ? 'bg-blue-50/40 border-blue-200' 
          : (isCurrentActive ? 'bg-blue-50/20 border-blue-300 ring-1 ring-blue-300' : 'bg-white border-stone-200 hover:border-stone-300')
      }`;

      el.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span id="badge-page-no-${p.id}" class="px-2 py-0.5 rounded text-xs font-mono font-bold ${
              isCurrentActive ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-200' : 'bg-blue-100 text-blue-800'
            }">
              页号: ${p.id}
            </span>
            <span class="text-xs font-bold text-stone-900 font-mono">${p.name}</span>
          </div>
          <span class="text-[11px] font-mono text-stone-500">${p.size}</span>
        </div>
        <div class="mt-1.5 flex items-center justify-between text-[11px] font-mono">
          <span class="text-stone-500">${p.role}</span>
          <span class="text-stone-400 text-[10px]">${p.addr}</span>
        </div>
        <div class="mt-2 pt-2 border-t border-stone-100 flex items-center justify-between text-[10px] font-mono">
          <span class="text-stone-400">映射目标: 物理页框 ${p.frameTarget}</span>
          ${
            isLoaded 
              ? '<span class="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-bold">● 已装入物理页框 ' + p.frameTarget + '</span>'
              : '<span class="text-stone-400">○ 待装入主存</span>'
          }
        </div>
      `;
      container.appendChild(el);
    });

  } else if (State.mode === 'seg') {
    // 进程逻辑分段空间：图形大小严格按内存空间大小 1:1 线性比例匹配 (1KB = 2.5px)
    const segs = [
      { 
        id: 0, 
        name: 'Segment 0', 
        role: '主函数代码段 (Code)', 
        len: '60 KB', 
        halfLen: '30K',
        heightPx: 150,
        patternClass: 'segment-pattern-code',
        base: '0x20000', 
        loadedInStep: 1,
        codeSnippet: `
          <div class="p-1.5 rounded bg-amber-50/70 border border-amber-200/50 text-[10px] font-mono text-stone-700 leading-tight">
            <div class="text-amber-800 font-bold flex items-center justify-between pb-0.5 border-b border-amber-200/40">
              <span>0x000 指令流入口</span>
              <span class="text-[9px] text-amber-600 font-bold">空间大 · 高 150px (60KB)</span>
            </div>
            <div class="text-stone-500 mt-0.5">0x000: push %rbp; mov %rsp, %rbp</div>
            <div class="text-stone-500">0x018: sub $0x40, %rsp; call func</div>
          </div>
        `
      },
      { 
        id: 1, 
        name: 'Segment 1', 
        role: '全局数据段 (Data)', 
        len: '40 KB', 
        halfLen: '20K',
        heightPx: 100,
        patternClass: 'segment-pattern-data',
        base: '0x50000', 
        loadedInStep: 2,
        codeSnippet: `
          <div class="p-1.5 rounded bg-emerald-50/70 border border-emerald-200/50 text-[10px] font-mono text-stone-700 leading-tight">
            <div class="text-emerald-800 font-bold flex items-center justify-between pb-0.5 border-b border-emerald-200/40">
              <span>全局变量数据表</span>
              <span class="text-[9px] text-emerald-600 font-bold">空间中 · 高 100px (40KB)</span>
            </div>
            <div class="text-stone-500 mt-0.5">g_table[4096] 静态数据结构</div>
          </div>
        `
      },
      { 
        id: 2, 
        name: 'Segment 2', 
        role: '用户调用堆栈段 (Stack)', 
        len: '30 KB', 
        halfLen: '15K',
        heightPx: 75,
        patternClass: 'segment-pattern-stack',
        base: '0x80000', 
        loadedInStep: 3,
        codeSnippet: `
          <div class="text-[10px] font-mono text-indigo-800 flex items-center justify-between">
            <span>%rsp 栈顶指针动态下潜</span>
            <span class="text-[9px] text-indigo-600 font-bold">空间小 · 高 75px (30KB)</span>
          </div>
        `
      }
    ];

    segs.forEach(s => {
      const isLoaded = State.currentStep >= s.loadedInStep;
      const isCurrentActive = (s.loadedInStep === State.currentStep);

      const el = document.createElement('div');
      el.id = `proc-item-seg-${s.id}`;
      el.className = `segment-block rounded-xl border transition-all duration-300 relative overflow-hidden ${s.patternClass} ${
        isLoaded 
          ? 'border-amber-300 ring-1 ring-amber-200' 
          : (isCurrentActive ? 'border-amber-400 ring-2 ring-amber-300 shadow-sm' : 'border-stone-200 hover:border-stone-300')
      }`;
      el.style.height = `${s.heightPx}px`;

      el.innerHTML = `
        <!-- 左侧段内地址标尺，直观体现 0 ~ Limit 的空间几何大小 -->
        <div class="segment-ruler">
          <span>0</span>
          <span class="text-[7px] text-stone-400">${s.halfLen}</span>
          <span>${s.len}</span>
        </div>

        <!-- 主体内容 -->
        <div class="pl-7 pr-3 py-2 flex flex-col justify-between h-full">
          <div>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <span id="badge-seg-no-${s.id}" class="px-1.5 py-0.5 rounded text-xs font-mono font-bold ${
                  isCurrentActive ? 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-200' : 'bg-amber-100 text-amber-800'
                }">
                  段号: ${s.id}
                </span>
                <span class="text-xs font-bold text-stone-900 font-mono">${s.name}</span>
              </div>
              <span class="text-[10px] font-mono text-amber-900 bg-amber-100/70 px-1.5 py-0.5 rounded font-bold border border-amber-200">
                段长: ${s.len}
              </span>
            </div>
            <div class="text-[10px] text-stone-500 font-mono mt-0.5 truncate">${s.role}</div>
            ${s.heightPx >= 100 ? s.codeSnippet : ''}
          </div>

          <div class="pt-1 border-t border-stone-100/80 flex items-center justify-between text-[10px] font-mono">
            <span class="text-stone-400">基址: ${s.base}</span>
            ${
              isLoaded 
                ? '<span class="text-emerald-700 font-bold">● 已装入物理主存</span>'
                : (s.heightPx < 100 ? s.codeSnippet : '<span class="text-stone-400">○ 待装入</span>')
            }
          </div>
        </div>
      `;
      container.appendChild(el);
    });

  } else if (State.mode === 'segpage') {
    const segPages = [
      {
        segId: 0,
        segName: '段 0: 代码段',
        pages: [
          { pageId: 0, name: 'Page 0', frameTarget: 2, loadedInStep: 2 },
          { pageId: 1, name: 'Page 1', frameTarget: 5, loadedInStep: 3 }
        ]
      },
      {
        segId: 1,
        segName: '段 1: 数据段',
        pages: [
          { pageId: 0, name: 'Page 0', frameTarget: 0, loadedInStep: 4 },
          { pageId: 1, name: 'Page 1', frameTarget: 4, loadedInStep: 4 }
        ]
      }
    ];

    segPages.forEach(sg => {
      const segBox = document.createElement('div');
      segBox.className = "p-3 rounded-xl border border-purple-200/80 bg-purple-50/30 flex flex-col gap-2";
      segBox.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span id="badge-segpage-seg-${sg.segId}" class="px-2 py-0.5 rounded text-xs font-mono font-bold ${
              (sg.segId === 0 && State.currentStep === 1) || (sg.segId === 1 && State.currentStep === 4)
                ? 'bg-purple-600 text-white ring-2 ring-purple-300'
                : 'bg-purple-100 text-purple-800'
            }">
              段号: ${sg.segId}
            </span>
            <span class="text-xs font-bold text-stone-900 font-mono">${sg.segName}</span>
          </div>
          <span class="text-[10px] font-mono text-purple-600 font-semibold">2 个页 (共 8KB)</span>
        </div>
        <div class="space-y-1.5 pt-1">
          ${sg.pages.map(pg => {
            const isLoaded = State.currentStep >= pg.loadedInStep;
            return `
              <div id="proc-item-segpage-${sg.segId}-${pg.pageId}" class="p-2 rounded-lg border text-xs font-mono flex items-center justify-between ${
                isLoaded ? 'bg-white border-emerald-300 text-emerald-900' : 'bg-white border-stone-200 text-stone-700'
              }">
                <div class="flex items-center gap-1.5">
                  <span id="badge-segpage-page-${sg.segId}-${pg.pageId}" class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-stone-100 text-stone-800">
                    页号: ${pg.pageId}
                  </span>
                  <span>${pg.name} (4KB)</span>
                </div>
                <span class="text-[10px] ${isLoaded ? 'text-emerald-600 font-bold' : 'text-stone-400'}">
                  ${isLoaded ? '✓ 装入页框 ' + pg.frameTarget : '→ 目标页框 ' + pg.frameTarget}
                </span>
              </div>
            `;
          }).join('')}
        </div>
      `;
      container.appendChild(segBox);
    });
  }
}

function renderLogicalAddressBar() {
  const container = document.getElementById('logical-address-bar');
  container.innerHTML = '';

  if (State.mode === 'paging') {
    container.innerHTML = `
      <div class="flex-1 bg-blue-100 border border-blue-300 text-blue-900 text-center py-1 rounded font-bold">
        页号 P (20 bits)
      </div>
      <div class="flex-1 bg-stone-100 border border-stone-300 text-stone-700 text-center py-1 rounded">
        页内偏移 W (12 bits · 4KB)
      </div>
    `;
  } else if (State.mode === 'seg') {
    container.innerHTML = `
      <div class="flex-1 bg-amber-100 border border-amber-300 text-amber-900 text-center py-1 rounded font-bold">
        段号 S (16 bits)
      </div>
      <div class="flex-1 bg-stone-100 border border-stone-300 text-stone-700 text-center py-1 rounded">
        段内偏移量 W (16 bits)
      </div>
    `;
  } else if (State.mode === 'segpage') {
    container.innerHTML = `
      <div class="flex-[1] bg-purple-100 border border-purple-300 text-purple-900 text-center py-1 rounded font-bold text-[11px]">
        段号 S (16 bits)
      </div>
      <div class="flex-[1] bg-blue-100 border border-blue-300 text-blue-900 text-center py-1 rounded font-bold text-[11px]">
        页号 P (4 bits)
      </div>
      <div class="flex-[1] bg-stone-100 border border-stone-300 text-stone-700 text-center py-1 rounded text-[11px]">
        页内偏移 W (12 bits)
      </div>
    `;
  }
}

// ============================================================
// 4. 右侧高地址内核区表格渲染 (严格包含“隐藏”批注)
// ============================================================

function renderKernelTable() {
  const wrapper = document.getElementById('kernel-table-wrapper');
  wrapper.innerHTML = '';

  if (State.mode === 'paging') {
    const table = document.createElement('div');
    table.className = "w-full overflow-x-auto";
    table.innerHTML = `
      <div class="text-[11px] font-mono text-stone-500 mb-2 flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span>页表项连续存储：基地址 0xC0004000</span>
          <span class="text-stone-400">| 每个页表项 4 字节</span>
        </div>
        <span class="badge-hidden">页号: 隐藏 / 隐含索引</span>
      </div>
      <table class="w-full text-xs font-mono border-collapse">
        <thead>
          <tr class="bg-stone-50 text-stone-600 border-b border-stone-200 text-left">
            <th class="py-1.5 px-3 font-semibold">
              <span class="inline-flex items-center gap-1">
                <span>页号</span>
                <span class="badge-hidden">隐藏</span>
              </span>
            </th>
            <th class="py-1.5 px-3 font-semibold">物理页框号 (Frame #)</th>
            <th class="py-1.5 px-3 font-semibold">访问权限</th>
            <th class="py-1.5 px-3 font-semibold">存在位</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-stone-100 text-stone-700">
          <tr id="page-row-0" class="transition-colors ${State.currentStep === 1 ? 'bg-blue-50/80 font-bold' : ''}">
            <td class="py-2 px-3 font-bold text-stone-400">
              [0] <span class="text-[10px] text-amber-700 font-normal ml-1">隐藏索引</span>
            </td>
            <td id="page-frame-cell-0" class="py-2 px-3 font-bold text-blue-700 text-sm">
              Frame 3
            </td>
            <td class="py-2 px-3 text-stone-500">读 / 执行 (RX)</td>
            <td class="py-2 px-3 text-emerald-600 font-semibold">1 (有效)</td>
          </tr>
          <tr id="page-row-1" class="transition-colors ${State.currentStep === 2 ? 'bg-blue-50/80 font-bold' : ''}">
            <td class="py-2 px-3 font-bold text-stone-400">
              [1] <span class="text-[10px] text-amber-700 font-normal ml-1">隐藏索引</span>
            </td>
            <td id="page-frame-cell-1" class="py-2 px-3 font-bold text-blue-700 text-sm">
              Frame 7
            </td>
            <td class="py-2 px-3 text-stone-500">只读 (R)</td>
            <td class="py-2 px-3 text-emerald-600 font-semibold">1 (有效)</td>
          </tr>
          <tr id="page-row-2" class="transition-colors ${State.currentStep === 3 ? 'bg-blue-50/80 font-bold' : ''}">
            <td class="py-2 px-3 font-bold text-stone-400">
              [2] <span class="text-[10px] text-amber-700 font-normal ml-1">隐藏索引</span>
            </td>
            <td id="page-frame-cell-2" class="py-2 px-3 font-bold text-blue-700 text-sm">
              Frame 1
            </td>
            <td class="py-2 px-3 text-stone-500">读 / 写 (RW)</td>
            <td class="py-2 px-3 text-emerald-600 font-semibold">1 (有效)</td>
          </tr>
        </tbody>
      </table>
      <div class="mt-2 text-[10px] text-stone-400 font-sans leading-tight border-t border-stone-100 pt-1.5 flex items-center gap-1">
        <span class="text-amber-600 font-bold">※ 批注：</span>
        <span>硬件通过公式 <code class="font-mono bg-stone-100 px-1 rounded text-stone-800">目标项物理地址 = PTR + 页号 × 4B</code> 直接计算地址，故主存页表无需额外开辟空间存储页号字段。</span>
      </div>
    `;
    wrapper.appendChild(table);

  } else if (State.mode === 'seg') {
    const table = document.createElement('div');
    table.className = "w-full overflow-x-auto";
    table.innerHTML = `
      <div class="text-[11px] font-mono text-stone-500 mb-2 flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span>段表项连续存储：基地址 0xC0008000</span>
          <span class="text-stone-400">| 每个段表项 8 字节 (段长+基址)</span>
        </div>
        <span class="badge-hidden">段号: 隐藏 / 隐含索引</span>
      </div>
      <table class="w-full text-xs font-mono border-collapse">
        <thead>
          <tr class="bg-stone-50 text-stone-600 border-b border-stone-200 text-left">
            <th class="py-1.5 px-3 font-semibold">
              <span class="inline-flex items-center gap-1">
                <span>段号</span>
                <span class="badge-hidden">隐藏</span>
              </span>
            </th>
            <th class="py-1.5 px-3 font-semibold">段长 (Limit)</th>
            <th class="py-1.5 px-3 font-semibold">基地址 (Base Address)</th>
            <th class="py-1.5 px-3 font-semibold">存取控制</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-stone-100 text-stone-700">
          <tr id="seg-row-0" class="transition-colors ${State.currentStep === 1 ? 'bg-amber-50/80 font-bold' : ''}">
            <td class="py-2 px-3 font-bold text-stone-400">
              [0] <span class="text-[10px] text-amber-700 font-normal ml-1">隐藏索引</span>
            </td>
            <td class="py-2 px-3 text-stone-800 font-bold">60 KB</td>
            <td id="seg-base-cell-0" class="py-2 px-3 font-bold text-amber-700 text-sm">
              0x20000
            </td>
            <td class="py-2 px-3 text-stone-500">执行/只读 (RX)</td>
          </tr>
          <tr id="seg-row-1" class="transition-colors ${State.currentStep === 2 ? 'bg-amber-50/80 font-bold' : ''}">
            <td class="py-2 px-3 font-bold text-stone-400">
              [1] <span class="text-[10px] text-amber-700 font-normal ml-1">隐藏索引</span>
            </td>
            <td class="py-2 px-3 text-stone-800 font-bold">40 KB</td>
            <td id="seg-base-cell-1" class="py-2 px-3 font-bold text-amber-700 text-sm">
              0x50000
            </td>
            <td class="py-2 px-3 text-stone-500">读 / 写 (RW)</td>
          </tr>
          <tr id="seg-row-2" class="transition-colors ${State.currentStep === 3 ? 'bg-amber-50/80 font-bold' : ''}">
            <td class="py-2 px-3 font-bold text-stone-400">
              [2] <span class="text-[10px] text-amber-700 font-normal ml-1">隐藏索引</span>
            </td>
            <td class="py-2 px-3 text-stone-800 font-bold">30 KB</td>
            <td id="seg-base-cell-2" class="py-2 px-3 font-bold text-amber-700 text-sm">
              0x80000
            </td>
            <td class="py-2 px-3 text-stone-500">读 / 写 (RW)</td>
          </tr>
        </tbody>
      </table>
      <div class="mt-2 text-[10px] text-stone-400 font-sans leading-tight border-t border-stone-100 pt-1.5 flex items-center gap-1">
        <span class="text-amber-600 font-bold">※ 批注：</span>
        <span>段号亦为硬件隐式下标；地址变换时先判别 <code class="font-mono bg-stone-100 px-1 rounded text-stone-800">段内位移 W &lt; 段长 Limit</code>，合法后再通过基址累加。</span>
      </div>
    `;
    wrapper.appendChild(table);

  } else if (State.mode === 'segpage') {
    const table = document.createElement('div');
    table.className = "w-full flex flex-col md:flex-row gap-3 overflow-x-auto";
    table.innerHTML = `
      <!-- 一级：段表 -->
      <div class="flex-1 border border-stone-200 rounded-lg p-2.5 bg-stone-50/40">
        <div class="flex items-center justify-between pb-1.5 mb-1.5 border-b border-stone-200 text-xs font-mono font-bold text-purple-900">
          <span>一级段表 (Segment Table)</span>
          <span class="badge-hidden">隐藏段号</span>
        </div>
        <table class="w-full text-[11px] font-mono">
          <thead>
            <tr class="text-stone-500 text-left">
              <th class="pb-1">段号[隐藏]</th>
              <th class="pb-1">页表长度</th>
              <th class="pb-1">页表基址</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr id="segpage-segrow-0" class="transition-colors ${State.currentStep === 1 ? 'bg-purple-100/80 font-bold' : ''}">
              <td class="py-1 text-stone-400">[0]</td>
              <td class="py-1">2 页</td>
              <td id="segpage-segtable-base-0" class="py-1 font-bold text-purple-700">0xC0005000</td>
            </tr>
            <tr id="segpage-segrow-1" class="transition-colors ${State.currentStep === 4 ? 'bg-purple-100/80 font-bold' : ''}">
              <td class="py-1 text-stone-400">[1]</td>
              <td class="py-1">2 页</td>
              <td id="segpage-segtable-base-1" class="py-1 font-bold text-purple-700">0xC0006000</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 二级：段0页表 -->
      <div id="seg0-pagetable-box" class="flex-1 border border-stone-200 rounded-lg p-2.5 transition-all ${
        State.currentStep >= 1 && State.currentStep <= 3 ? 'bg-purple-50/60 border-purple-300 ring-1 ring-purple-300' : 'bg-white'
      }">
        <div class="flex items-center justify-between pb-1.5 mb-1.5 border-b border-stone-200 text-xs font-mono font-bold text-stone-800">
          <span>段 0 页表 @ 0xC0005000</span>
          <span class="badge-hidden">隐藏页号</span>
        </div>
        <table class="w-full text-[11px] font-mono">
          <thead>
            <tr class="text-stone-500 text-left">
              <th class="pb-1">页号[隐藏]</th>
              <th class="pb-1">物理页框号</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr id="segpage-row-0-0" class="transition-colors ${State.currentStep === 2 ? 'bg-purple-100 font-bold' : ''}">
              <td class="py-1 text-stone-400">[0]</td>
              <td id="segpage-cell-0-0" class="py-1 font-bold text-purple-700">Frame 2</td>
            </tr>
            <tr id="segpage-row-0-1" class="transition-colors ${State.currentStep === 3 ? 'bg-purple-100 font-bold' : ''}">
              <td class="py-1 text-stone-400">[1]</td>
              <td id="segpage-cell-0-1" class="py-1 font-bold text-purple-700">Frame 5</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 二级：段1页表 -->
      <div id="seg1-pagetable-box" class="flex-1 border border-stone-200 rounded-lg p-2.5 transition-all ${
        State.currentStep >= 4 ? 'bg-purple-50/60 border-purple-300 ring-1 ring-purple-300' : 'bg-white'
      }">
        <div class="flex items-center justify-between pb-1.5 mb-1.5 border-b border-stone-200 text-xs font-mono font-bold text-stone-800">
          <span>段 1 页表 @ 0xC0006000</span>
          <span class="badge-hidden">隐藏页号</span>
        </div>
        <table class="w-full text-[11px] font-mono">
          <thead>
            <tr class="text-stone-500 text-left">
              <th class="pb-1">页号[隐藏]</th>
              <th class="pb-1">物理页框号</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr id="segpage-row-1-0" class="transition-colors">
              <td class="py-1 text-stone-400">[0]</td>
              <td id="segpage-cell-1-0" class="py-1 font-bold text-purple-700">Frame 0</td>
            </tr>
            <tr id="segpage-row-1-1" class="transition-colors">
              <td class="py-1 text-stone-400">[1]</td>
              <td id="segpage-cell-1-1" class="py-1 font-bold text-purple-700">Frame 4</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    wrapper.appendChild(table);
  }
}

// ============================================================
// 5. 右侧用户主存区渲染
// ============================================================

function renderUserMemory() {
  const container = document.getElementById('physical-memory-container');
  container.innerHTML = '';

  if (State.mode === 'paging' || State.mode === 'segpage') {
    // 渲染 8 个物理页框网格 (Frame 0 ~ 7)
    const grid = document.createElement('div');
    grid.className = "grid grid-cols-2 sm:grid-cols-4 gap-3";

    const framesData = [
      { id: 0, addr: '0x0000', defaultStatus: 'free' },
      { id: 1, addr: '0x1000', defaultStatus: 'free' },
      { id: 2, addr: '0x2000', defaultStatus: 'busy', busyLabel: '系统保留' },
      { id: 3, addr: '0x3000', defaultStatus: 'free' },
      { id: 4, addr: '0x4000', defaultStatus: 'busy', busyLabel: '进程 PID:88' },
      { id: 5, addr: '0x5000', defaultStatus: 'free' },
      { id: 6, addr: '0x6000', defaultStatus: 'busy', busyLabel: '进程 PID:92' },
      { id: 7, addr: '0x7000', defaultStatus: 'free' }
    ];

    framesData.forEach(fr => {
      let content = '';
      let statusClass = 'border-stone-200 bg-white text-stone-600';

      if (State.mode === 'paging') {
        if (fr.id === 3 && State.currentStep >= 1) {
          statusClass = 'border-blue-400 bg-blue-50/70 text-blue-950 font-bold';
          content = `
            <div class="text-[11px] text-blue-800 font-bold">Page 0 (已装入)</div>
            <div class="text-[10px] text-blue-600 font-mono">代码段指令 4KB</div>
          `;
        } else if (fr.id === 7 && State.currentStep >= 2) {
          statusClass = 'border-blue-400 bg-blue-50/70 text-blue-950 font-bold';
          content = `
            <div class="text-[11px] text-blue-800 font-bold">Page 1 (已装入)</div>
            <div class="text-[10px] text-blue-600 font-mono">常量数据 4KB</div>
          `;
        } else if (fr.id === 1 && State.currentStep >= 3) {
          statusClass = 'border-blue-400 bg-blue-50/70 text-blue-950 font-bold';
          content = `
            <div class="text-[11px] text-blue-800 font-bold">Page 2 (已装入)</div>
            <div class="text-[10px] text-blue-600 font-mono">栈空间 4KB</div>
          `;
        } else if (fr.defaultStatus === 'busy') {
          statusClass = 'border-stone-200 bg-stone-100/90 text-stone-500';
          content = `
            <div class="text-[10px] text-stone-500 font-bold">占用 · ${fr.busyLabel}</div>
          `;
        } else {
          content = `<div class="text-[10px] text-stone-400">空闲 (Free)</div>`;
        }
      } else if (State.mode === 'segpage') {
        if (fr.id === 2 && State.currentStep >= 2) {
          statusClass = 'border-purple-400 bg-purple-50/80 text-purple-950 font-bold';
          content = `<div class="text-[11px] text-purple-800 font-bold">段0 · Page 0</div><div class="text-[10px] text-purple-600">代码段 4KB</div>`;
        } else if (fr.id === 5 && State.currentStep >= 3) {
          statusClass = 'border-purple-400 bg-purple-50/80 text-purple-950 font-bold';
          content = `<div class="text-[11px] text-purple-800 font-bold">段0 · Page 1</div><div class="text-[10px] text-purple-600">代码段 4KB</div>`;
        } else if (fr.id === 0 && State.currentStep >= 4) {
          statusClass = 'border-purple-400 bg-purple-50/80 text-purple-950 font-bold';
          content = `<div class="text-[11px] text-purple-800 font-bold">段1 · Page 0</div><div class="text-[10px] text-purple-600">数据段 4KB</div>`;
        } else if (fr.id === 4 && State.currentStep >= 4) {
          statusClass = 'border-purple-400 bg-purple-50/80 text-purple-950 font-bold';
          content = `<div class="text-[11px] text-purple-800 font-bold">段1 · Page 1</div><div class="text-[10px] text-purple-600">数据段 4KB</div>`;
        } else if (fr.defaultStatus === 'busy') {
          statusClass = 'border-stone-200 bg-stone-100/90 text-stone-500';
          content = `<div class="text-[10px] text-stone-500 font-bold">占用 · 其他进程</div>`;
        } else {
          content = `<div class="text-[10px] text-stone-400">空闲 (Free)</div>`;
        }
      }

      const cell = document.createElement('div');
      cell.id = `memory-frame-${fr.id}`;
      cell.className = `memory-frame-cell p-3 rounded-xl border flex flex-col justify-between h-24 ${statusClass}`;
      cell.innerHTML = `
        <div class="flex items-center justify-between font-mono">
          <span class="text-xs font-bold">页框 ${fr.id}</span>
          <span class="text-[10px] text-stone-400">${fr.addr}</span>
        </div>
        <div class="my-auto py-1">
          ${content}
        </div>
        <div class="text-[9px] font-mono text-stone-400 text-right">
          4KB 容量
        </div>
      `;
      grid.appendChild(cell);
    });

    container.appendChild(grid);

  } else if (State.mode === 'seg') {
    // 渲染分段连续主存条块，图形大小严格根据空间大小比例匹配 (1KB = 2.5px)
    const segList = document.createElement('div');
    segList.className = "flex flex-col gap-2";

    const partitions = [
      { name: '低端已占用空间', range: '0x00000 - 0x1FFFF', size: '128 KB', type: 'system', desc: 'OS 核心驱动占用', heightPx: 44, patternClass: 'bg-stone-100' },
      { id: 0, name: '物理段 0 区 (Base: 0x20000)', range: '0x20000 - 0x2EFFF', size: '60 KB', type: 'target', loadedInStep: 1, label: '代码段 (60KB)', heightPx: 150, patternClass: 'segment-pattern-code' },
      { name: '外部碎片 (空闲 20KB 无法装入大段)', range: '0x30000 - 0x4FFFF', size: '20 KB', type: 'fragment', desc: '容量仅 20KB 过小，无法装入 40KB/30KB 的段，形成外部碎片', heightPx: 50, patternClass: 'bg-rose-50/60' },
      { id: 1, name: '物理段 1 区 (Base: 0x50000)', range: '0x50000 - 0x59FFF', size: '40 KB', type: 'target', loadedInStep: 2, label: '数据段 (40KB)', heightPx: 100, patternClass: 'segment-pattern-data' },
      { name: '中端已占用空间', range: '0x60000 - 0x7FFFF', size: '128 KB', type: 'system', desc: '进程 PID:2048 占用', heightPx: 44, patternClass: 'bg-stone-100' },
      { id: 2, name: '物理段 2 区 (Base: 0x80000)', range: '0x80000 - 0x877FF', size: '30 KB', type: 'target', loadedInStep: 3, label: '用户栈段 (30KB)', heightPx: 75, patternClass: 'segment-pattern-stack' }
    ];

    partitions.forEach(p => {
      const isTarget = p.type === 'target';
      const isLoaded = isTarget && State.currentStep >= p.loadedInStep;
      const isFragment = p.type === 'fragment';

      let borderClass = 'border-stone-200';
      if (isLoaded) {
        borderClass = 'border-amber-300 ring-1 ring-amber-200';
      } else if (isFragment) {
        borderClass = 'border-rose-300 border-dashed';
      }

      const item = document.createElement('div');
      if (isTarget) {
        item.id = `memory-seg-${p.id}`;
      }
      item.className = `segment-block rounded-xl border flex flex-col justify-between font-mono text-xs transition-all relative overflow-hidden ${borderClass} ${p.patternClass}`;
      item.style.height = `${p.heightPx}px`;

      // 内部标尺或详情
      let innerHtml = '';
      if (isTarget) {
        innerHtml = `
          <div class="segment-ruler">
            <span>0</span>
            <span>${p.size}</span>
          </div>
          <div class="pl-7 pr-3 py-2 flex flex-col justify-between h-full">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="font-bold text-stone-900">${p.name}</span>
                <span class="text-[10px] text-stone-400 font-sans">${isLoaded ? '✓ 已装入：' + p.label : '○ 待装入连续物理段'}</span>
              </div>
              <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-white border border-stone-200 text-stone-800">${p.size} (高 ${p.heightPx}px)</span>
            </div>
            ${
              isLoaded 
                ? '<div class="my-auto py-1 px-2 rounded bg-white/80 border border-amber-200 text-[11px] text-amber-900 font-sans flex items-center justify-between"><span>✓ 物理段匹配装入完成：' + p.label + '</span><span class="text-[10px] font-mono text-amber-700 bg-amber-50 px-1 rounded">' + p.range + '</span></div>'
                : '<div class="text-[10px] text-stone-400 font-sans my-auto">空闲物理连续段 · 等待逻辑段装配</div>'
            }
            <div class="flex items-center justify-between text-[10px] text-stone-400 pt-1 border-t border-stone-100/60 font-sans">
              <span>基地址连续界限: ${p.size}</span>
              <span class="font-mono text-[10px]">${p.range}</span>
            </div>
          </div>
        `;
      } else if (isFragment) {
        innerHtml = `
          <div class="segment-ruler">
            <span class="text-rose-500">!</span>
            <span class="text-rose-500">20K</span>
          </div>
          <div class="pl-7 pr-3 py-1 flex items-center justify-between h-full font-sans text-rose-800">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
              <div>
                <span class="font-bold text-xs">外部碎片 (容量仅 20 KB)</span>
                <p class="text-[10px] text-rose-600 leading-tight">由于空间过小（高 50px），无法容纳进程中 40KB 或 30KB 的段</p>
              </div>
            </div>
            <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 border border-rose-200 text-rose-700 font-mono">20 KB (高 50px)</span>
          </div>
        `;
      } else {
        innerHtml = `
          <div class="px-3 py-1.5 flex items-center justify-between h-full font-mono text-stone-500 text-[11px]">
            <span>${p.name} · ${p.desc}</span>
            <span class="text-stone-400 text-[10px]">${p.range} (${p.size})</span>
          </div>
        `;
      }

      item.innerHTML = innerHtml;
      segList.appendChild(item);
    });

    container.appendChild(segList);
  }
}

// ============================================================
// 6. MMU 状态栏更新
// ============================================================

function updateMMUState(overrideDesc = null) {
  const cfg = ModesConfig[State.mode];
  const stepInfo = cfg.steps[State.currentStep] || { title: '', desc: '' };

  document.getElementById('mmu-state-badge').textContent = `步骤 ${State.currentStep} / ${cfg.steps.length - 1}`;
  document.getElementById('mmu-action-desc').innerHTML = overrideDesc || stepInfo.desc;
}

// ============================================================
// 7. 核心动画：逻辑号飞渡、双重高亮与实体装入
// ============================================================

function clearFlyingOverlay() {
  const overlay = document.getElementById('flying-overlay-container');
  overlay.innerHTML = '';
  const svg = document.getElementById('connection-svg-layer');
  svg.innerHTML = '';
  document.querySelectorAll('.dual-highlight-active').forEach(el => el.classList.remove('dual-highlight-active'));
}

function drawConnectionLine(fromRect, toRect, color = '#F59E0B') {
  const svg = document.getElementById('connection-svg-layer');
  svg.innerHTML = '';

  const x1 = fromRect.left + fromRect.width / 2;
  const y1 = fromRect.top + fromRect.height / 2;
  const x2 = toRect.left + toRect.width / 2;
  const y2 = toRect.top + toRect.height / 2;

  // 贝塞尔曲线控制点
  const dx = (x2 - x1) * 0.4;
  const dy = (y2 - y1) * 0.2;
  const cx1 = x1 + dx;
  const cy1 = y1 - dy;
  const cx2 = x2 - dx;
  const cy2 = y2 + dy;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`);
  path.setAttribute('class', 'glow-line');
  path.setAttribute('stroke', color);
  svg.appendChild(path);
}

/**
 * 完整三段式匹配动画：
 * 1. 进程中的逻辑号移动到对应的表项，展示匹配
 * 2. 随后表项中匹配的目标（页框号/基址）以及内存中匹配的区域同时高亮一下
 * 3. 随后进程中的页/段移动到相应的物理区域
 */
function runMatchingAnimation({ badgeSelector, tableCellSelector, memoryTargetSelector, processItemSelector, label, onComplete }) {
  const badgeEl = document.querySelector(badgeSelector);
  const tableCellEl = document.querySelector(tableCellSelector);
  const memEl = document.querySelector(memoryTargetSelector);
  const procEl = processItemSelector ? document.querySelector(processItemSelector) : null;

  if (!badgeEl || !tableCellEl || !memEl) {
    if (onComplete) onComplete();
    return;
  }

  State.isAnimating = true;
  clearFlyingOverlay();

  const badgeRect = badgeEl.getBoundingClientRect();
  const tableRect = tableCellEl.getBoundingClientRect();
  const memRect = memEl.getBoundingClientRect();
  const overlay = document.getElementById('flying-overlay-container');

  // 【阶段 1】：进程中的页号/段号先移动到对应的表项，展示匹配
  updateMMUState(`【阶段 1/3：寻址匹配】进程提取 ${label} 移动至内核区表项进行下标索引定位...`);

  const flyingChip = document.createElement('div');
  flyingChip.className = "flying-chip px-2.5 py-1 bg-amber-500 text-white font-mono font-bold text-xs flex items-center gap-1 shadow-lg border border-amber-300";
  flyingChip.innerHTML = `<span>⚡</span> <span>${label}</span>`;
  flyingChip.style.left = `${badgeRect.left}px`;
  flyingChip.style.top = `${badgeRect.top}px`;
  overlay.appendChild(flyingChip);

  const duration1 = 0.85 / State.speed;

  gsap.to(flyingChip, {
    x: tableRect.left - badgeRect.left,
    y: tableRect.top - badgeRect.top,
    scale: 1.15,
    duration: duration1,
    ease: "power2.out",
    onComplete: () => {
      // 命中表项
      gsap.to(flyingChip, { opacity: 0, scale: 0.8, duration: 0.2 / State.speed, onComplete: () => flyingChip.remove() });

      // 【阶段 2】：随后表项中匹配的页框号/基址以及内存中匹配的页框/段同时高亮一下！
      updateMMUState(`【阶段 2/3：双重高亮】表项目标物理值与主存物理位置<b>同时脉冲高亮</b>！建立映射链路。`);

      tableCellEl.classList.add('dual-highlight-active');
      memEl.classList.add('dual-highlight-active');
      const lineColor = State.mode === 'paging' ? '#3B82F6' : (State.mode === 'seg' ? '#F59E0B' : '#8B5CF6');
      drawConnectionLine(tableRect, memRect, lineColor);

      // 【阶段 3】：随后进程中的页/段移动到相应的位置
      setTimeout(() => {
        if (procEl) {
          updateMMUState(`【阶段 3/3：物理装载】进程数据实体平滑移入主存目标物理空间，装配完成。`);
          const procRect = procEl.getBoundingClientRect();
          const movingBlock = document.createElement('div');
          movingBlock.className = "flying-chip p-3 bg-white border-2 border-amber-400 rounded-xl font-mono text-xs font-bold text-stone-800 shadow-2xl flex flex-col justify-between overflow-hidden";
          movingBlock.style.left = `${procRect.left}px`;
          movingBlock.style.top = `${procRect.top}px`;
          movingBlock.style.width = `${procRect.width}px`;
          movingBlock.style.height = `${procRect.height}px`;
          movingBlock.innerHTML = `
            <div class="flex items-center justify-between">
              <span class="text-amber-700">⚡ 装入实体: ${label}</span>
              <span class="text-[10px] text-stone-400">平移并适配物理空间</span>
            </div>
            <div class="text-[11px] text-stone-500 my-auto text-center font-sans">
              物理空间映射装载
            </div>
            <div class="text-right text-[10px] text-amber-600 font-bold">→ 目标物理基地址就位</div>
          `;
          overlay.appendChild(movingBlock);

          gsap.to(movingBlock, {
            x: memRect.left - procRect.left,
            y: memRect.top - procRect.top,
            width: memRect.width,
            height: memRect.height,
            duration: 0.95 / State.speed,
            ease: "power3.inOut",
            onComplete: () => {
              movingBlock.remove();
              clearFlyingOverlay();
              State.isAnimating = false;
              if (onComplete) onComplete();
            }
          });
        } else {
          setTimeout(() => {
            clearFlyingOverlay();
            State.isAnimating = false;
            if (onComplete) onComplete();
          }, 800 / State.speed);
        }
      }, 950 / State.speed);
    }
  });
}

// ============================================================
// 8. 模式步骤调度器
// ============================================================

function executeStep(stepIndex, isAuto = false) {
  if (State.isAnimating) return;

  if (State.mode === 'paging') {
    if (stepIndex === 1) {
      runMatchingAnimation({
        badgeSelector: '#badge-page-no-0',
        tableCellSelector: '#page-frame-cell-0',
        memoryTargetSelector: '#memory-frame-3',
        processItemSelector: '#proc-item-page-0',
        label: '逻辑页号: 0',
        onComplete: () => {
          State.currentStep = 1;
          renderCurrentMode();
          if (isAuto && State.isPlaying) checkAutoPlayNext();
        }
      });
      return;
    } else if (stepIndex === 2) {
      runMatchingAnimation({
        badgeSelector: '#badge-page-no-1',
        tableCellSelector: '#page-frame-cell-1',
        memoryTargetSelector: '#memory-frame-7',
        processItemSelector: '#proc-item-page-1',
        label: '逻辑页号: 1',
        onComplete: () => {
          State.currentStep = 2;
          renderCurrentMode();
          if (isAuto && State.isPlaying) checkAutoPlayNext();
        }
      });
      return;
    } else if (stepIndex === 3) {
      runMatchingAnimation({
        badgeSelector: '#badge-page-no-2',
        tableCellSelector: '#page-frame-cell-2',
        memoryTargetSelector: '#memory-frame-1',
        processItemSelector: '#proc-item-page-2',
        label: '逻辑页号: 2',
        onComplete: () => {
          State.currentStep = 3;
          renderCurrentMode();
          if (isAuto && State.isPlaying) checkAutoPlayNext();
        }
      });
      return;
    }
  } else if (State.mode === 'seg') {
    if (stepIndex === 1) {
      runMatchingAnimation({
        badgeSelector: '#badge-seg-no-0',
        tableCellSelector: '#seg-base-cell-0',
        memoryTargetSelector: '#memory-seg-0',
        processItemSelector: '#proc-item-seg-0',
        label: '逻辑段号: 0',
        onComplete: () => {
          State.currentStep = 1;
          renderCurrentMode();
          if (isAuto && State.isPlaying) checkAutoPlayNext();
        }
      });
      return;
    } else if (stepIndex === 2) {
      runMatchingAnimation({
        badgeSelector: '#badge-seg-no-1',
        tableCellSelector: '#seg-base-cell-1',
        memoryTargetSelector: '#memory-seg-1',
        processItemSelector: '#proc-item-seg-1',
        label: '逻辑段号: 1',
        onComplete: () => {
          State.currentStep = 2;
          renderCurrentMode();
          if (isAuto && State.isPlaying) checkAutoPlayNext();
        }
      });
      return;
    } else if (stepIndex === 3) {
      runMatchingAnimation({
        badgeSelector: '#badge-seg-no-2',
        tableCellSelector: '#seg-base-cell-2',
        memoryTargetSelector: '#memory-seg-2',
        processItemSelector: '#proc-item-seg-2',
        label: '逻辑段号: 2',
        onComplete: () => {
          State.currentStep = 3;
          renderCurrentMode();
          if (isAuto && State.isPlaying) checkAutoPlayNext();
        }
      });
      return;
    }
  } else if (State.mode === 'segpage') {
    if (stepIndex === 1) {
      runMatchingAnimation({
        badgeSelector: '#badge-segpage-seg-0',
        tableCellSelector: '#segpage-segtable-base-0',
        memoryTargetSelector: '#seg0-pagetable-box',
        processItemSelector: null,
        label: '段号: 0 检索',
        onComplete: () => {
          State.currentStep = 1;
          renderCurrentMode();
          if (isAuto && State.isPlaying) checkAutoPlayNext();
        }
      });
      return;
    } else if (stepIndex === 2) {
      runMatchingAnimation({
        badgeSelector: '#badge-segpage-page-0-0',
        tableCellSelector: '#segpage-cell-0-0',
        memoryTargetSelector: '#memory-frame-2',
        processItemSelector: '#proc-item-segpage-0-0',
        label: '段0-页号: 0',
        onComplete: () => {
          State.currentStep = 2;
          renderCurrentMode();
          if (isAuto && State.isPlaying) checkAutoPlayNext();
        }
      });
      return;
    } else if (stepIndex === 3) {
      runMatchingAnimation({
        badgeSelector: '#badge-segpage-page-0-1',
        tableCellSelector: '#segpage-cell-0-1',
        memoryTargetSelector: '#memory-frame-5',
        processItemSelector: '#proc-item-segpage-0-1',
        label: '段0-页号: 1',
        onComplete: () => {
          State.currentStep = 3;
          renderCurrentMode();
          if (isAuto && State.isPlaying) checkAutoPlayNext();
        }
      });
      return;
    } else if (stepIndex === 4) {
      runMatchingAnimation({
        badgeSelector: '#badge-segpage-seg-1',
        tableCellSelector: '#segpage-segtable-base-1',
        memoryTargetSelector: '#seg1-pagetable-box',
        processItemSelector: '#proc-item-segpage-1-0',
        label: '段1 两级装入',
        onComplete: () => {
          State.currentStep = 4;
          renderCurrentMode();
          if (isAuto && State.isPlaying) checkAutoPlayNext();
        }
      });
      return;
    }
  }

  // 终态或普通静态步进
  State.currentStep = stepIndex;
  renderCurrentMode();
  if (isAuto && State.isPlaying) checkAutoPlayNext();
}

// ============================================================
// 9. 播放与步进控制逻辑
// ============================================================

function togglePlay() {
  if (State.isPlaying) {
    stopPlay();
  } else {
    startPlay();
  }
}

function startPlay() {
  const cfg = ModesConfig[State.mode];
  if (State.currentStep >= cfg.steps.length - 1) {
    State.currentStep = 0;
    renderCurrentMode();
  }

  State.isPlaying = true;
  document.getElementById('play-icon').textContent = '⏸';
  document.getElementById('play-text').textContent = '暂停演示';
  document.getElementById('btn-play').className = "px-4 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors shadow-sm flex items-center gap-1.5";

  nextStep(true);
}

function stopPlay() {
  State.isPlaying = false;
  if (State.timer) clearTimeout(State.timer);
  document.getElementById('play-icon').textContent = '▶';
  document.getElementById('play-text').textContent = '自动连续演示';
  document.getElementById('btn-play').className = "px-4 py-1.5 rounded-lg text-xs font-semibold bg-stone-900 text-white hover:bg-stone-800 transition-colors shadow-sm flex items-center gap-1.5";
}

function checkAutoPlayNext() {
  const cfg = ModesConfig[State.mode];
  if (State.currentStep < cfg.steps.length - 1 && State.isPlaying) {
    const delay = 1500 / State.speed;
    State.timer = setTimeout(() => {
      nextStep(true);
    }, delay);
  } else {
    stopPlay();
  }
}

function nextStep(isAuto = false) {
  if (State.isAnimating) return;
  const cfg = ModesConfig[State.mode];
  if (State.currentStep < cfg.steps.length - 1) {
    const nextIdx = State.currentStep + 1;
    executeStep(nextIdx, isAuto);
  } else {
    stopPlay();
  }
}

function prevStep() {
  if (State.isAnimating) return;
  stopPlay();
  clearFlyingOverlay();
  if (State.currentStep > 0) {
    State.currentStep--;
    renderCurrentMode();
  }
}

function resetDemo() {
  stopPlay();
  clearFlyingOverlay();
  State.currentStep = 0;
  renderCurrentMode();
}

// 页面加载启动
document.addEventListener('DOMContentLoaded', init);
