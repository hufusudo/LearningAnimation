/**
 * 请求分页虚存管理演示系统 (以 MMU 为中心 · 硬件时序与动态地址包引擎)
 * 严格语义配色：逻辑地址蓝 / 物理地址紫 / 页号橙 / 帧号绿 / 命中绿 / 未命中黄 / 缺页红 / 磁盘灰 / 更新紫
 */

// ============================================================
// 1. 全局配置与数据定义
// ============================================================

const CONFIG = {
  SCENARIOS: ['A', 'B', 'C'],
  LOOP_DELAY: 3500 // 场景切换间歇 (ms)
};

// 运行时数据存储
let currentScenario = 'A';
let currentAccessCount = 0;
let isAutoLooping = true;
let currentSpeed = 1.0;
const SPEED_STEPS = [0.5, 1.0, 1.5, 2.0];

// 硬件初始与动态数据
let tlbData = [];
let ptData = [];
let ramFrames = [];
let diskBlocks = [];

// 初始化数据生成器
function initHardwareState(scenarioKey) {
  // TLB 数据: 列 V / P / F
  if (scenarioKey === 'A') {
    tlbData = [
      { v: 1, p: 2, f: 5, dirty: 0 },
      { v: 1, p: 0, f: 1, dirty: 0 },
      { v: 1, p: 4, f: 4, dirty: 0 },
      { v: 0, p: '-', f: '-', dirty: 0 }
    ];
  } else {
    // 场景 B 和 C 初始 TLB 中无目标页 (TLB 未命中)
    tlbData = [
      { v: 1, p: 0, f: 1, dirty: 0 },
      { v: 1, p: 4, f: 4, dirty: 0 },
      { v: 1, p: 7, f: 7, dirty: 0 },
      { v: 0, p: '-', f: '-', dirty: 0 }
    ];
  }

  // 页表数据: 列 P / V / F / 磁盘块
  ptData = [
    { p: 0, v: 1, f: 1, disk: 'Block 0' },
    { p: 1, v: 1, f: 3, disk: 'Block 1' },
    { p: 2, v: 1, f: 5, disk: 'Block 2' },
    { p: 3, v: (scenarioKey === 'C' ? 0 : 1), f: (scenarioKey === 'C' ? '-' : 6), disk: 'Block 3' },
    { p: 4, v: 1, f: 4, disk: 'Block 4' },
    { p: 5, v: 0, f: '-', disk: 'Block 5' },
    { p: 7, v: 1, f: 7, disk: 'Block 7' }
  ];

  // 物理内存 8 个帧
  ramFrames = [
    { id: 0, page: 'OS 内核', occupied: true, data: '0x00FF', color: 'bg-stone-100 border-stone-300' },
    { id: 1, page: 'Page 0', occupied: true, data: '0x1A2B', color: 'bg-blue-50 border-blue-200' },
    { id: 2, page: '空闲 (Free)', occupied: false, data: '--', color: 'bg-stone-50 border-stone-200' },
    { id: 3, page: 'Page 1', occupied: true, data: '0x5A5A', color: 'bg-emerald-50 border-emerald-200' },
    { id: 4, page: 'Page 4', occupied: true, data: '0x4444', color: 'bg-stone-50 border-stone-200' },
    { id: 5, page: 'Page 2', occupied: true, data: '0xCAFE', color: 'bg-emerald-50 border-emerald-200' },
    { id: 6, page: (scenarioKey === 'C' ? '空闲 (Free)' : 'Page 3'), occupied: (scenarioKey !== 'C'), data: (scenarioKey === 'C' ? '--' : '0xBEEF'), color: 'bg-stone-50 border-stone-200' },
    { id: 7, page: 'Page 7', occupied: true, data: '0x7777', color: 'bg-stone-50 border-stone-200' }
  ];

  // 磁盘 4 个块
  diskBlocks = [
    { id: 0, page: 'Page 0', state: '外存驻留' },
    { id: 1, page: 'Page 1', state: '外存驻留' },
    { id: 2, page: 'Page 2', state: '外存驻留' },
    { id: 3, page: 'Page 3', state: (scenarioKey === 'C' ? '待调入' : '已调入内存') }
  ];
}

// ============================================================
// 2. DOM 渲染
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  runScenario('A');
  let resizeFrame;
  const refreshGeometry = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { setupWires(); positionPacket(); });
  };
  window.addEventListener('resize', refreshGeometry);
  window.addEventListener('scroll', refreshGeometry, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(refreshGeometry).observe(document.querySelector('.layout-grid'));
  }
  document.fonts?.ready.then(refreshGeometry);
  document.addEventListener('visibilitychange', () => { lastFrameTime = null; });
  requestAnimationFrame(tick);
});

function renderAllComponents() {
  renderTLBTable();
  renderPageTable();
  renderRAMFrames();
  renderDiskBlocks();
}

function renderTLBTable() {
  const tbody = document.getElementById('tlb-table-body');
  tbody.innerHTML = '';
  tlbData.forEach((row, idx) => {
    const r = document.createElement('div');
    r.id = `tlb-row-${idx}`;
    r.className = 'grid grid-cols-3 py-1 px-2 text-center items-center transition-colors';
    r.innerHTML = `
      <span class="font-bold ${row.v ? 'text-emerald-700' : 'text-stone-400'}" id="tlb-v-${idx}">${row.v}</span>
      <span class="font-bold text-orange-700" id="tlb-p-${idx}">${row.p}</span>
      <span class="font-bold text-emerald-700" id="tlb-f-${idx}">${row.f}</span>
    `;
    tbody.appendChild(r);
  });
}

function renderPageTable() {
  const tbody = document.getElementById('pt-table-body');
  tbody.innerHTML = '';
  ptData.forEach((row) => {
    const r = document.createElement('div');
    r.id = `pt-row-${row.p}`;
    r.className = 'grid grid-cols-4 py-1 px-2 text-center items-center transition-colors';
    const isFault = (row.v === 0);
    r.innerHTML = `
      <span class="font-bold text-orange-700">P=${row.p}</span>
      <span class="font-bold text-xs ${isFault ? 'text-rose-700 bg-rose-50 rounded px-1' : 'text-emerald-700 bg-emerald-50 rounded px-1'}" id="pt-v-${row.p}">
        ${isFault ? '0 缺页' : '1 有效'}
      </span>
      <span class="font-bold text-emerald-700" id="pt-f-${row.p}">${row.f}</span>
      <span class="text-stone-500 text-[10px]" id="pt-disk-${row.p}">${row.disk}</span>
    `;
    tbody.appendChild(r);
  });
}

function renderRAMFrames() {
  const container = document.getElementById('ram-frames-grid');
  container.innerHTML = '';
  ramFrames.forEach((frame) => {
    const card = document.createElement('div');
    card.id = `ram-frame-${frame.id}`;
    card.className = `p-1.5 rounded-lg border flex flex-col justify-between transition-all ${frame.color}`;
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-bold text-purple-900 text-[11px]">Frame ${frame.id}</span>
        <span class="text-[9px] px-1 rounded ${frame.occupied ? 'bg-purple-100 text-purple-800' : 'bg-stone-200 text-stone-600'}">
          ${frame.occupied ? '占用' : '空闲'}
        </span>
      </div>
      <div class="py-1 px-1 rounded bg-white/90 border border-stone-200 text-center my-0.5">
        <span class="font-bold text-stone-800 text-[10px]" id="frame-page-${frame.id}">${frame.page}</span>
      </div>
      <div class="flex items-center justify-between text-[9px] text-stone-500">
        <span>数据:</span>
        <span class="font-mono font-bold text-stone-700" id="frame-data-${frame.id}">${frame.data}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderDiskBlocks() {
  const container = document.getElementById('disk-blocks-container');
  container.innerHTML = '';
  diskBlocks.forEach((block) => {
    const card = document.createElement('div');
    card.id = `disk-block-${block.id}`;
    card.className = 'p-1.5 rounded-lg border border-stone-300 bg-stone-50 flex items-center justify-between text-[11px] transition-all';
    card.innerHTML = `
      <span class="font-bold text-stone-700">Block ${block.id}</span>
      <span class="text-orange-700 font-bold">${block.page}</span>
      <span class="text-[9px] text-stone-500" id="disk-state-${block.id}">${block.state}</span>
    `;
    container.appendChild(card);
  });
}

// ============================================================
// 3. SVG 连线系统与动态定位
// ============================================================

function setupWires() {
  const wiresGroup = document.getElementById('svg-wires-group');
  const activeWire = document.querySelector('.bus-wire-active');
  const previousWire = activeWire ? {id:activeWire.id, classes:activeWire.getAttribute('class')} : null;
  wiresGroup.innerHTML = '';

  const cpu = document.getElementById('node-cpu');
  const mmu = document.getElementById('node-mmu');
  const tlb = document.getElementById('node-tlb');
  const pt = document.getElementById('node-pt');
  const ram = document.getElementById('node-ram');
  const disk = document.getElementById('node-disk');

  if (!cpu || !mmu || !tlb || !pt || !ram || !disk) return;

  // 1. CPU -> MMU
  createWire('wire-cpu-mmu', cpu, mmu, 'right', 'left', 'arrow-blue');
  // 2. MMU <-> TLB
  createWire('wire-mmu-tlb', mmu, tlb, 'top', 'bottom', 'arrow-orange');
  createWire('wire-tlb-mmu', tlb, mmu, 'bottom', 'top', 'arrow-green');
  // 3. MMU <-> PT
  createWire('wire-mmu-pt', mmu, pt, 'bottom', 'top', 'arrow-blue');
  createWire('wire-pt-mmu', pt, mmu, 'top', 'bottom', 'arrow-green');
  // 4. MMU -> RAM
  createWire('wire-mmu-ram', mmu, ram, 'right', 'left', 'arrow-purple');
  // 5. RAM -> CPU (数据返回)
  createWire('wire-ram-cpu', ram, cpu, 'bottom', 'bottom', 'arrow-green');
  // 6. OS <-> Disk
  createWire('wire-os-disk', cpu, disk, 'bottom', 'left', 'arrow-disk');
  createWire('wire-mmu-cpu', mmu, cpu, 'left', 'right', 'arrow-red');
  createWire('wire-cpu-pt', cpu, pt, 'right', 'left', 'arrow-purple');
  // 7. Disk -> RAM (调页调入)
  createWire('wire-disk-ram', disk, ram, 'top', 'bottom', 'arrow-green');
  if(previousWire && document.getElementById(previousWire.id)) {
    document.getElementById(previousWire.id).setAttribute('class',previousWire.classes);
  }
}

function createWire(id, fromEl, toEl, fromSide, toSide, markerId) {
  const r1 = fromEl.getBoundingClientRect();
  const r2 = toEl.getBoundingClientRect();
  const svg = document.getElementById('svg-network-layer').getBoundingClientRect();

  let p1 = getPointOnRect(r1, fromSide, svg);
  let p2 = getPointOnRect(r2, toSide, svg);

  let d = '';
  if (id === 'wire-ram-cpu') {
    // 经由底部的返回弧线
    const midY = Math.max(p1.y, p2.y) + 30;
    d = `M ${p1.x} ${p1.y} C ${p1.x} ${midY}, ${p2.x} ${midY}, ${p2.x} ${p2.y}`;
  } else if (id === 'wire-os-disk') {
    const midY = p1.y + 40;
    d = `M ${p1.x} ${p1.y} C ${p1.x} ${midY}, ${p2.x - 30} ${p2.y}, ${p2.x} ${p2.y}`;
  } else {
    const dx = (p2.x - p1.x) * 0.4;
    const dy = (p2.y - p1.y) * 0.4;
    d = `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y + dy}, ${p2.x - dx} ${p2.y - dy}, ${p2.x} ${p2.y}`;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('id', id);
  path.setAttribute('d', d);
  path.setAttribute('class', 'bus-wire');
  path.setAttribute('marker-end', `url(#${markerId})`);
  document.getElementById('svg-wires-group').appendChild(path);
}

function getPointOnRect(r, side, svgRect) {
  const x = r.left - svgRect.left;
  const y = r.top - svgRect.top;
  switch(side) {
    case 'top': return { x: x + r.width / 2, y: y };
    case 'bottom': return { x: x + r.width / 2, y: y + r.height };
    case 'left': return { x: x, y: y + r.height / 2 };
    case 'right': return { x: x + r.width, y: y + r.height / 2 };
    default: return { x: x + r.width / 2, y: y + r.height / 2 };
  }
}

// 激活特定导线发光流动
function activateWire(wireId, colorClass) {
  deactivateAllWires();
  const wire = document.getElementById(wireId);
  if (wire) {
    wire.classList.add('bus-wire-active', colorClass);
  }
}

function deactivateAllWires() {
  document.querySelectorAll('.bus-wire').forEach(w => {
    w.className.baseVal = 'bus-wire';
  });
}

// ============================================================
// 4. 访存日志系统 (每次访存必记录)
// ============================================================

function clearAccessLog() {
  document.getElementById('access-log-tbody').innerHTML = '';
}

function appendAccessLog(accessId, stage, target, addr, result, isMainMem, desc) {
  const tbody = document.getElementById('access-log-tbody');
  const tr = document.createElement('tr');
  tr.className = 'log-row-new hover:bg-stone-50 transition-colors';

  const isMemBadge = isMainMem 
    ? '<span class="px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 font-bold">是 (主存)</span>' 
    : '<span class="px-1.5 py-0.2 rounded bg-stone-100 text-stone-600">否</span>';

  let resultColor = 'text-stone-700';
  if (result.includes('命中') || result.includes('有效') || result.includes('成功')) resultColor = 'text-emerald-700 font-bold';
  if (result.includes('未命中')) resultColor = 'text-amber-700 font-bold';
  if (result.includes('缺页')) resultColor = 'text-rose-700 font-bold';

  tr.innerHTML = `
    <td class="py-1 px-2 font-bold text-stone-900">${accessId}</td>
    <td class="py-1 px-2 font-semibold text-stone-700">${stage}</td>
    <td class="py-1 px-2 font-bold text-blue-700">${target}</td>
    <td class="py-1 px-2 font-mono text-stone-800">${addr}</td>
    <td class="py-1 px-2 text-center ${resultColor}">${result}</td>
    <td class="py-1 px-2 text-center">${isMemBadge}</td>
    <td class="py-1 px-3 text-stone-600">${desc}</td>
  `;
  tbody.appendChild(tr);

  // 滚动到底部
  const container = document.querySelector('.log-table-container');
  if (container) container.scrollTop = container.scrollHeight;
}

// Every transfer, arrival and reading pause shares one animation clock.
const SCENARIO_DATA = {
  A: {p:2, f:5, d:'14A', value:'CAFE', title:'快表命中，直接找到物理帧'},
  B: {p:1, f:3, d:'0C8', value:'5A5A', title:'快表没有映射，继续查主存页表'},
  C: {p:3, f:6, d:'054', value:'BEEF', title:'页面不在内存，先调页，再重执行'}
};
let steps = [], stepIndex = 0, stepElapsed = 0, arrivalApplied = false;
let scenarioComplete = false, loopElapsed = 0, lastFrameTime = null;
let memoryReads = 0, pageTransfers = 0, tableWrites = 0;
let activePacket = null, activePath = null, pathLength = 0;
let singleStepping = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);
const put = (id, text) => { $(id).innerText = text; };
const mark = (id, name) => $(id).classList.add(name);

function buildSteps(key) {
  const {p,f,d,value} = SCENARIO_DATA[key];
  const la = `0x${p}${d}`, pa = `0x${f}${d}`;
  const list = [];
  const add = (title, detail, phase, from, to, wire, packet, kind, arrive, log, travel=1100) => {
    list.push({title,detail,phase,from,to,wire,packet,kind,arrive,log,travel,hold:850});
  };
  const split = () => {
    put('mmu-p-val',`P = ${p}`); put('mmu-d-val',`D = 0x${d}`);
    put('mmu-calc-d',`0x${d}`); put('mmu-state-badge','页号查映射，偏移量保持不变');
    mark('mmu-p-cell','box-highlight-blue'); mark('mmu-d-cell','box-highlight-green');
  };
  const assemble = () => {
    put('mmu-calc-f',f); put('mmu-pa-val',pa);
    put('mmu-state-badge',`PA = ${f} × 0x1000 + 0x${d} = ${pa}`);
    mark('mmu-pa-box','pa-assembled-glow');
  };
  const fillTLB = () => {
    tlbData[3] = {v:1,p,f,dirty:0}; renderTLBTable();
    mark('tlb-row-3','tlb-update-purple'); put('tlb-state-badge','新映射已缓存');
  };
  const log = (stage,target,addr,result,mem,desc) => [stage,target,addr,result,mem,desc];
  add('CPU 发出逻辑地址', `地址 ${la} 拆成页号 P=${p} 和偏移 D=0x${d}。只转换页号，偏移量始终保留。`,
    '地址变换','node-cpu','node-mmu','wire-cpu-mmu',`LA ${la}`,'la',split);
  add('用页号查询 TLB', '先找高速缓存中的页号→帧号映射。查询 TLB 不计入主存访问次数。',
    '地址变换','node-mmu','node-tlb','wire-mmu-tlb',`查 P=${p}`,'p',() => {
      put('tlb-state-badge',key==='A' ? `命中：P=${p} → F=${f}` : '未命中：继续查页表');
      if(key==='A') mark('tlb-row-0','tlb-row-hit');
      else mark('node-tlb','tlb-flash-miss');
    },log('查快表','TLB',`P=${p}`,key==='A'?'命中':'未命中',false,'TLB 缓存的是映射，不是页面内容'));
  if(key!=='A') {
    add('读取主存中的页表项',key==='C'?'TLB 未命中不等于缺页；读到页表 V=0，才确定 Page 3 不在主存。':'页表 V=1，页面已在主存；这里不需要磁盘调页。',
      '地址变换','node-mmu','node-pt','wire-mmu-pt',`PTE[${p}]`,'la',() => {
        memoryReads++; mark(`pt-row-${p}`,key==='C'?'pt-row-fault':'pt-row-active');
        put('pt-state-badge',key==='C'?'V=0：页面不在内存':`V=1：找到 F=${f}`);
      }, log('查页表','主存页表',`P=${p}`,key==='C'?'缺页 (V=0)':`有效 (F=${f})`,true,'读取一个页表项'));
  }
  if(key==='C') {
    add('缺页异常：原指令暂停', 'MMU 向 CPU 报告缺页，进入内核态。LOAD 尚未完成，R0 仍然没有数据。',
      '缺页处理','node-mmu','node-cpu','wire-mmu-cpu','缺页异常','fault',() => {
        $('mmu-fault-flag').classList.remove('hidden');
        put('cpu-mode-badge','内核态 · OS 接管'); mark('cpu-os-state-box','box-highlight-red');
        put('os-status-text','原指令等待调页'); put('os-detail-text','OS 选中空闲 Frame 6，准备将 Page 3 从磁盘调入。');
      });
    add('OS 请求读取磁盘页面','找到 Page 3 对应的 Block 3，并分配空闲 Frame 6。本例有空闲帧，无需页面置换。',
      '缺页处理','node-cpu','node-disk','wire-os-disk','读取 Block 3','disk',() => {
        mark('disk-block-3','disk-block-reading'); put('disk-state-3','页面就绪'); put('disk-state-badge','完成磁盘读取');
      },log('外存 I/O','磁盘','Block 3','读取成功',false,'磁盘 I/O 与主存单次读取分开统计'),1500);
    add('将完整页面装入空闲帧','搬运的是整个 4 KB 页面，不只是 LOAD 要读取的一个数据。此时页表还没有变为有效。',
      '缺页处理','node-disk','node-ram','wire-disk-ram','Page 3 · 4 KB','f',() => {
        pageTransfers++;
        Object.assign(ramFrames[6],{occupied:true,page:'Page 3 (新调入)',data:'0xBEEF',color:'bg-emerald-50 border-emerald-300'});
        renderRAMFrames(); mark('ram-frame-6','frame-active-write');
        put('disk-state-3','已调入 Frame 6'); put('disk-state-badge','外存待命');
      },log('调页写入','物理主存','Frame 6','整页写入',true,'4 KB 页面传输，不等同于一次字读取'),2000);
    add('更新页表：现在可以访问了','页面装入完成后，OS 将页表项改为 V=1、F=6，让地址变换能找到新页面。',
      '更新映射','node-cpu','node-pt','wire-cpu-pt','P=3 · V=1 · F=6','pa',() => {
        tableWrites++; ptData[3].v=1; ptData[3].f=6; renderPageTable();
        mark('pt-row-3','pt-update-purple'); put('pt-state-badge','V: 0 → 1，F: — → 6');
      },log('更新页表','主存页表','P=3 → F=6','写表完成',true,'先装入页面，再将页表标记为有效'));
    add('回填 TLB 映射','本演示采用调页后回填 TLB 的路径，让重执行时直接命中快表。',
      '更新映射','node-mmu','node-tlb','wire-mmu-tlb','P=3 → F=6','pa',fillTLB,
      log('写快表','TLB','P=3 → F=6','写入成功',false,'回填映射，未再次搬运页面'));
    add('回到原指令，重新执行','还是原来的 LOAD R0, [0x3054]，逻辑地址没有改变；变化的是页面已在内存。',
      '重新执行','node-cpu','node-mmu','wire-cpu-mmu','重执 LA 0x3054','la',() => {
        put('cpu-mode-badge','用户态执行'); put('os-status-text','调页完成，恢复原指令');
        put('os-detail-text','重新进行地址变换，再读取原指令需要的数据。');
        $('mmu-fault-flag').classList.add('hidden'); split();
      });
    add('再次查询 TLB，这次命中','新映射 P=3 → F=6 已经可用，不再触发缺页。',
      '重新执行','node-mmu','node-tlb','wire-mmu-tlb','查 P=3','p',() => {
        mark('tlb-row-3','tlb-row-hit'); put('tlb-state-badge','命中：P=3 → F=6');
      },log('重执查快表','TLB','P=3','命中',false,'使用调页后建立的新映射'));
  }
  if(key==='B') {
    add('页表返回物理帧号','从页表取得 F=3，接着把映射缓存到 TLB。偏移 D=0x0C8 一直留在 MMU。',
      '地址变换','node-pt','node-mmu','wire-pt-mmu','F = 3','f',() => put('mmu-calc-f',3));
    add('回填 TLB，方便下次访问','将 P=1 → F=3 写入空闲槽；本次仍只进行了 1 次主存读取。',
      '更新映射','node-mmu','node-tlb','wire-mmu-tlb','P=1 → F=3','pa',fillTLB,
      log('写快表','TLB','P=1 → F=3','写入成功',false,'只缓存页号到帧号的映射'));
    add('帧号与原偏移合成物理地址',`PA = F × 4096 + D = ${pa}。页号被替换，页内偏移不变。`,
      '地址变换',null,null,null,`F=${f} + D=0x${d}`,'pa',assemble,null,700);
  } else {
    add('帧号返回 MMU，合成物理地址',`用 F=${f} 替换页号，保留 D=0x${d}：${f} × 0x1000 + 0x${d} = ${pa}。`,
      key==='C'?'重新执行':'地址变换','node-tlb','node-mmu','wire-tlb-mmu',`F = ${f}`,'f',assemble);
  }
  add('用物理地址读取目标数据',`访问 Frame ${f} 中偏移为 0x${d} 的单元。现在读取的是指令需要的数据。`,
    '读取数据','node-mmu','node-ram','wire-mmu-ram',`PA ${pa}`,'pa',() => {
      memoryReads++; mark(`ram-frame-${f}`,'frame-active-read'); put('mmu-state-badge','主存已读出目标数据');
    },log('读取数据','物理主存',pa,'读取成功',true,`Frame ${f}，偏移 0x${d}`));
  add('数据返回 R0，指令完成',key==='C'?'缺页处理结束后，原指令终于完成。调入页面和读取数据是两个不同的动作。':`R0 获得 0x${value}。本场景共 ${key==='A'?1:2} 次主存读取，TLB 查询不算主存读取。`,
    '读取数据','node-ram','node-cpu','wire-ram-cpu',`数据 0x${value}`,'data',() => {
      put('cpu-data-val',`0x${value} (读取成功)`); mark('cpu-data-reg-box','box-highlight-green');
    });
  return list;
}

const transientClasses = ['box-highlight-blue','box-highlight-green','box-highlight-purple','box-highlight-red',
  'highlight-active','pa-assembled-glow','tlb-row-hit','tlb-flash-miss','tlb-update-purple','pt-row-active',
  'pt-row-fault','pt-update-purple','frame-active-read','frame-active-write','disk-block-reading','flow-focus'];
function clearHighlights() {
  document.querySelectorAll(transientClasses.map(c=>`.${c}`).join(',')).forEach(el=>el.classList.remove(...transientClasses));
}
function runScenario(key) {
  if (!SCENARIO_DATA[key]) return;
  activePacket?.remove(); activePacket=null; activePath=null;
  $('packet-container').innerHTML=''; clearHighlights(); deactivateAllWires(); clearAccessLog();
  currentScenario=key; currentAccessCount=0; memoryReads=0; pageTransfers=0; tableWrites=0;
  stepIndex=0; stepElapsed=0; loopElapsed=0; lastFrameTime=null; scenarioComplete=false; singleStepping=false;
  initHardwareState(key); renderAllComponents(); setupWires();
  const {p,d,title} = SCENARIO_DATA[key];
  put('cpu-current-inst',`LOAD R0, [0x${p}${d}]`); put('cpu-la-hex',`0x${p}${d}`);
  put('cpu-la-bin',parseInt(`${p}${d}`,16).toString(2).padStart(16,'0').match(/.{4}/g).join(' '));
  for (const id of ['mmu-p-val','mmu-d-val','mmu-calc-d','mmu-calc-f','mmu-pa-val','cpu-data-val']) put(id,'—');
  put('cpu-mode-badge','用户态执行'); put('os-status-text','待命中');
  put('os-detail-text','尚未发生缺页，CPU 正常执行用户指令。');
  put('mmu-state-badge','等待逻辑地址'); put('tlb-state-badge','就绪'); put('pt-state-badge','就绪');
  put('disk-state-badge','外存待命'); $('mmu-fault-flag').classList.add('hidden');
  put('scenario-title',title);
  CONFIG.SCENARIOS.forEach(sc=>{
    $(`pill-sc-${sc.toLowerCase()}`).classList.toggle('active',sc===key);
    $(`pill-sc-${sc.toLowerCase()}`).setAttribute('aria-pressed',String(sc===key));
  });
  steps=buildSteps(key);
  $('step-rail').innerHTML=steps.map((step,i)=>`<span class="flow-step" title="${step.title}"><b>${i+1}</b>${step.title}</span>`).join('');
  beginStep(); syncControls(); updateCounters();
}
function beginStep() {
  const step=steps[stepIndex]; arrivalApplied=false; stepElapsed=0;
  clearHighlights(); deactivateAllWires();
  if(step.from) mark(step.from,'flow-focus');
  if(step.to) mark(step.to,'flow-focus');
  put('step-number',`${String(stepIndex+1).padStart(2,'0')} / ${steps.length}`);
  put('step-title',step.title); put('step-detail',step.detail); put('flow-phase',step.phase);
  $('flow-phase').dataset.phase=step.phase;
  put('mmu-action-text',step.title);
  document.querySelectorAll('.flow-step').forEach((el,i)=>{
    el.classList.toggle('current',i===stepIndex); el.classList.toggle('done',i<stepIndex);
    if(i===stepIndex) el.setAttribute('aria-current','step'); else el.removeAttribute('aria-current');
  });
  const selected=document.querySelector('.flow-step.current');
  if(selected) $('step-rail').scrollLeft=selected.offsetLeft-$('step-rail').offsetLeft-16;
  if(step.wire) {
    const colors={la:'blue',p:'orange',f:'green',pa:'purple',data:'green',fault:'red',disk:'disk'};
    activateWire(step.wire,`wire-${colors[step.kind]}`);
    activePacket=document.createElement('div'); activePacket.className=`data-packet packet-${step.kind}`;
    activePacket.textContent=step.packet; $('packet-container').appendChild(activePacket);
  }
  positionPacket(); updateProgress();
}
function positionPacket() {
  if(!activePacket) return;
  const path=$(steps[stepIndex].wire);
  if(path!==activePath) { activePath=path; pathLength=path.getTotalLength(); }
  const ratio=Math.min(1,stepElapsed/steps[stepIndex].travel);
  const eased=ratio*ratio*(3-2*ratio);
  const pt=path.getPointAtLength(pathLength*(reducedMotion?1:eased));
  activePacket.style.transform=`translate3d(${pt.x}px,${pt.y}px,0) translate(-50%,-50%)`;
  activePacket.style.opacity=String(Math.min(1,ratio*8+0.2));
}
function applyArrival() {
  if(arrivalApplied) return;
  arrivalApplied=true; activePacket?.remove(); activePacket=null;
  const step=steps[stepIndex]; step.arrive?.();
  if(step.log) appendAccessLog(`事件 #${++currentAccessCount}`,...step.log);
  updateCounters();
}
function updateCounters() {
  put('memory-reads',memoryReads); put('page-transfers',pageTransfers); put('table-writes',tableWrites);
}
function updateProgress() {
  const step=steps[stepIndex];
  const progress=scenarioComplete?1:(stepIndex+Math.min(1,stepElapsed/(step.travel+step.hold)))/steps.length;
  $('flow-progress').style.transform=`scaleX(${progress})`;
  $('flow-progress-track').setAttribute('aria-valuenow',Math.round(progress*100));
}
function finishStep() {
  applyArrival();
  if(stepIndex===steps.length-1) {
    scenarioComplete=true; loopElapsed=0; deactivateAllWires(); updateProgress();
    put('flow-phase','本次指令已完成'); syncControls();
    return;
  }
  stepIndex++; beginStep();
}
function advancePlayback(delta) {
  if(!isAutoLooping && !singleStepping) return;
  if(scenarioComplete) {
    if(isAutoLooping) {
      loopElapsed+=delta*currentSpeed;
      if(loopElapsed>=CONFIG.LOOP_DELAY) runScenario(CONFIG.SCENARIOS[(CONFIG.SCENARIOS.indexOf(currentScenario)+1)%3]);
    }
    return;
  }
  stepElapsed+=delta*currentSpeed;
  positionPacket(); updateProgress();
  const step=steps[stepIndex];
  if(stepElapsed>=step.travel) applyArrival();
  if(stepElapsed>=step.travel+step.hold) {
    if(singleStepping) {
      singleStepping=false;
      if(stepIndex===steps.length-1) finishStep();
      syncControls();
    }
    else finishStep();
  }
}
function tick(now) {
  if(lastFrameTime!==null && !document.hidden) advancePlayback(Math.min(80,now-lastFrameTime));
  lastFrameTime=now;
  requestAnimationFrame(tick);
}
// Single-step leaves the completed state on screen. The following click starts the next transfer.
function playNextStep() {
  isAutoLooping=false;
  if(scenarioComplete) { syncControls(); return; }
  if(arrivalApplied) finishStep();
  if(!scenarioComplete) singleStepping=true;
  syncControls();
}
function syncControls() {
  const moving=isAutoLooping||singleStepping;
  put('loop-btn-text',moving?'⏸ 暂停':'▶ 继续播放');
  put('playback-status',scenarioComplete ? (isAutoLooping?'完成后切换下一场景':'已完成 · 可重播') : moving?'正在播放':'已暂停');
  document.body.classList.toggle('playback-paused',!moving);
  $('btn-next-step').disabled=scenarioComplete||singleStepping;
}
function toggleAutoLoop() {
  if(singleStepping) { singleStepping=false; isAutoLooping=false; }
  else isAutoLooping=!isAutoLooping;
  lastFrameTime=null; syncControls();
}
function cycleSpeed() { setSpeed(SPEED_STEPS[(SPEED_STEPS.indexOf(currentSpeed)+1)%SPEED_STEPS.length]); }
function setSpeed(speed) { if(!SPEED_STEPS.includes(speed)) return; currentSpeed=speed; put('speed-text',`${speed.toFixed(1)}x`); }
function manualJumpScenario(key) { runScenario(key); }
function replayScenario() { runScenario(currentScenario); }
