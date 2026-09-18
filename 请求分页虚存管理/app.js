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
let loopTimer = null;
let currentStepTimeline = null;
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
    { p: 4, v: 0, f: '-', disk: 'Block 4' },
    { p: 5, v: 0, f: '-', disk: 'Block 5' }
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
  setupWires();
  runScenario('A');
  window.addEventListener('resize', () => {
    setupWires();
  });
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
  // 7. Disk -> RAM (调页调入)
  createWire('wire-disk-ram', disk, ram, 'top', 'bottom', 'arrow-green');
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

// 在连线旁显示访存编号浮动标签
function showAccessTag(fromEl, toEl, text, bgClass = 'bg-stone-900 text-white') {
  clearAccessTags();
  const r1 = fromEl.getBoundingClientRect();
  const r2 = toEl.getBoundingClientRect();

  const midX = (r1.left + r1.width / 2 + r2.left + r2.width / 2) / 2;
  const midY = (r1.top + r1.height / 2 + r2.top + r2.height / 2) / 2;

  const badge = document.createElement('div');
  badge.className = `access-tag-badge ${bgClass}`;
  badge.id = 'active-access-tag';
  badge.style.left = `${midX}px`;
  badge.style.top = `${midY}px`;
  badge.innerHTML = `<span>${text}</span>`;
  document.getElementById('packet-container').appendChild(badge);
}

function clearAccessTags() {
  const t = document.getElementById('active-access-tag');
  if (t) t.remove();
}

// 沿箭头移动的绝对定位“地址包/数据包” div
function animatePacket(fromEl, toEl, text, packetClass, duration = 0.6, onComplete = null) {
  const container = document.getElementById('packet-container');
  const packet = document.createElement('div');
  packet.className = `data-packet ${packetClass}`;
  packet.innerText = text;
  container.appendChild(packet);

  const r1 = fromEl.getBoundingClientRect();
  const r2 = toEl.getBoundingClientRect();

  const startX = r1.left + r1.width / 2;
  const startY = r1.top + r1.height / 2;
  const endX = r2.left + r2.width / 2;
  const endY = r2.top + r2.height / 2;

  gsap.set(packet, { x: startX, y: startY, scale: 0.8, opacity: 1 });

  gsap.to(packet, {
    x: endX,
    y: endY,
    scale: 1,
    duration: duration,
    ease: 'power2.inOut',
    onComplete: () => {
      packet.remove();
      if (onComplete) onComplete();
    }
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

// ============================================================
// 5. 三大场景动画流水线 (严格遵循用户步骤)
// ============================================================

function runScenario(key) {
  if (currentStepTimeline) {
    currentStepTimeline.kill();
  }
  if (loopTimer) {
    clearTimeout(loopTimer);
  }

  currentScenario = key;
  currentAccessCount = 0;
  clearAccessLog();
  clearAccessTags();
  deactivateAllWires();
  resetAllHighlights();

  // 更新胶囊高亮
  CONFIG.SCENARIOS.forEach(sc => {
    const pill = document.getElementById(`pill-sc-${sc.toLowerCase()}`);
    if (pill) {
      if (sc === key) pill.classList.add('active');
      else pill.classList.remove('active');
    }
  });

  initHardwareState(key);
  renderAllComponents();

  if (key === 'A') {
    executeScenarioA();
  } else if (key === 'B') {
    executeScenarioB();
  } else if (key === 'C') {
    executeScenarioC();
  }
}

// ------------------------------------------------------------
// 场景 A: TLB 命中
// 步骤：CPU发逻辑地址 -> MMU拆分 -> 访存#1 TLB查P命中 -> MMU合成PA -> 访存#2 内存读F+D -> 数据返回CPU
// ------------------------------------------------------------
function executeScenarioA() {
  const cpu = document.getElementById('node-cpu');
  const mmu = document.getElementById('node-mmu');
  const tlb = document.getElementById('node-tlb');
  const ram = document.getElementById('node-ram');

  // 1. 初始化 CPU 指令与逻辑地址
  document.getElementById('cpu-current-inst').innerText = 'LOAD R0, [0x214A]';
  document.getElementById('cpu-la-hex').innerText = '0x214A';
  document.getElementById('cpu-la-bin').innerText = '0010 0001 0100 1010';
  document.getElementById('cpu-data-val').innerText = '--';
  document.getElementById('cpu-data-val').className = 'font-bold px-2 py-0.5 rounded bg-white border border-stone-300 text-stone-400';

  const tl = gsap.timeline();
  tl.timeScale(currentSpeed);
  currentStepTimeline = tl;

  // Step 1: CPU 发逻辑地址 -> MMU 接收并拆分
  tl.add(() => {
    document.getElementById('cpu-la-box').classList.add('box-highlight-blue');
    activateWire('wire-cpu-mmu', 'wire-blue');
    animatePacket(cpu, mmu, 'LA: 0x214A', 'packet-la', 0.65, () => {
      // MMU 拆分
      document.getElementById('mmu-p-val').innerText = 'P = 2';
      document.getElementById('mmu-d-val').innerText = 'D = 0x14A';
      document.getElementById('mmu-calc-d').innerText = '0x14A';
      document.getElementById('mmu-state-badge').innerText = '拆分完成 (P=2, D=0x14A)';
      document.getElementById('node-mmu').classList.add('highlight-active');
    });
  }, '+=0.2');

  // Step 2: 访存#1 TLB 查 P=2 命中
  tl.add(() => {
    currentAccessCount = 1;
    activateWire('wire-mmu-tlb', 'wire-orange');
    showAccessTag(mmu, tlb, '访存#1: TLB 查 P=2', 'bg-orange-600 text-white');
    appendAccessLog('访存#1', '地址变换', 'TLB 快表', 'P = 2', '命中 (Hit)', false, 'CAM 联想快速查找命中，有效位 V=1，取出帧号 F=5');

    animatePacket(mmu, tlb, '查 P=2', 'packet-p', 0.6, () => {
      // TLB 命中整行绿色高亮
      const hitRow = document.getElementById('tlb-row-0');
      if (hitRow) hitRow.classList.add('tlb-row-hit');
      document.getElementById('tlb-state-badge').innerText = '⚡ TLB HIT (有效位=1)';
      document.getElementById('tlb-state-badge').className = 'text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300';
    });
  }, '+=1.0');

  // Step 3: TLB 返回 F=5 给 MMU，MMU 合成 PA = F(5) + D(0x14A)
  tl.add(() => {
    activateWire('wire-tlb-mmu', 'wire-green');
    animatePacket(tlb, mmu, 'F = 5', 'packet-f', 0.55, () => {
      document.getElementById('mmu-calc-f').innerText = '5';
      document.getElementById('mmu-pa-val').innerText = '0x514A (Frame 5 + 0x14A)';
      document.getElementById('mmu-pa-box').classList.add('pa-assembled-glow');
      document.getElementById('mmu-state-badge').innerText = '物理地址合成完成';
    });
  }, '+=0.9');

  // Step 4: 访存#2 MMU 发 PA 访问物理内存，读 F=5+D (Frame 5)
  tl.add(() => {
    currentAccessCount = 2;
    activateWire('wire-mmu-ram', 'wire-purple');
    showAccessTag(mmu, ram, '访存#2: 内存读 Frame 5', 'bg-purple-700 text-white');
    appendAccessLog('访存#2', '物理访存', '物理主存', 'PA = 0x514A', '命中 (Hit)', true, '主存直接访问 Frame 5 (Page 2)，读取偏移量 0x14A 单元数据');

    animatePacket(mmu, ram, 'PA: 0x514A', 'packet-pa', 0.65, () => {
      const frameEl = document.getElementById('ram-frame-5');
      if (frameEl) frameEl.classList.add('frame-active-read');
    });
  }, '+=1.0');

  // Step 5: 物理内存读出数据返回 CPU
  tl.add(() => {
    clearAccessTags();
    activateWire('wire-ram-cpu', 'wire-green');
    animatePacket(ram, cpu, 'Data: 0xCAFE', 'packet-data', 0.75, () => {
      const dataReg = document.getElementById('cpu-data-val');
      dataReg.innerText = '0xCAFE (读取成功)';
      dataReg.className = 'font-bold px-2 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-800';
      document.getElementById('cpu-data-reg-box').classList.add('box-highlight-green');
    });
  }, '+=1.0');

  // 场景 A 结束，安排循环进入场景 B
  tl.add(() => {
    scheduleNextScenario('B');
  }, '+=1.2');
}

// ------------------------------------------------------------
// 场景 B: TLB 未命中，页表命中
// 步骤：CPU发逻辑地址 -> MMU拆分 -> 访存#1 TLB查P未命中 -> 访存#2 页表查P有效得F -> 访存#3 写TLB -> MMU合成PA -> 访存#4 内存读F+D -> 数据返回CPU
// ------------------------------------------------------------
function executeScenarioB() {
  const cpu = document.getElementById('node-cpu');
  const mmu = document.getElementById('node-mmu');
  const tlb = document.getElementById('node-tlb');
  const pt = document.getElementById('node-pt');
  const ram = document.getElementById('node-ram');

  document.getElementById('cpu-current-inst').innerText = 'LOAD R0, [0x10C8]';
  document.getElementById('cpu-la-hex').innerText = '0x10C8';
  document.getElementById('cpu-la-bin').innerText = '0001 0000 1100 1000';
  document.getElementById('cpu-data-val').innerText = '--';
  document.getElementById('cpu-data-val').className = 'font-bold px-2 py-0.5 rounded bg-white border border-stone-300 text-stone-400';

  const tl = gsap.timeline();
  tl.timeScale(currentSpeed);
  currentStepTimeline = tl;

  // Step 1: CPU 发逻辑地址 -> MMU 接收拆分
  tl.add(() => {
    document.getElementById('cpu-la-box').classList.add('box-highlight-blue');
    activateWire('wire-cpu-mmu', 'wire-blue');
    animatePacket(cpu, mmu, 'LA: 0x10C8', 'packet-la', 0.65, () => {
      document.getElementById('mmu-p-val').innerText = 'P = 1';
      document.getElementById('mmu-d-val').innerText = 'D = 0x0C8';
      document.getElementById('mmu-calc-d').innerText = '0x0C8';
      document.getElementById('mmu-state-badge').innerText = '拆分完成 (P=1, D=0x0C8)';
      document.getElementById('node-mmu').classList.add('highlight-active');
    });
  }, '+=0.2');

  // Step 2: 访存#1 TLB 查 P=1 未命中 (黄色闪烁)
  tl.add(() => {
    currentAccessCount = 1;
    activateWire('wire-mmu-tlb', 'wire-orange');
    showAccessTag(mmu, tlb, '访存#1: TLB 查 P=1', 'bg-amber-600 text-white');
    appendAccessLog('访存#1', '地址变换', 'TLB 快表', 'P = 1', '未命中 (Miss)', false, '查 TLB 未找到 P=1 条目，触发 TLB Miss');

    animatePacket(mmu, tlb, '查 P=1', 'packet-p', 0.6, () => {
      document.getElementById('node-tlb').classList.add('tlb-flash-miss');
      document.getElementById('tlb-state-badge').innerText = '❌ TLB MISS (未命中)';
      document.getElementById('tlb-state-badge').className = 'text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-300';
    });
  }, '+=1.0');

  // Step 3: 访存#2 MMU 发起查页表，PTE 查 P=1 有效，得到 F=3
  tl.add(() => {
    currentAccessCount = 2;
    activateWire('wire-mmu-pt', 'wire-blue');
    showAccessTag(mmu, pt, '访存#2: 查主存页表 P=1', 'bg-blue-700 text-white');
    appendAccessLog('访存#2', '查页表', '主存页表', 'P = 1', '有效 (V=1, F=3)', true, '【第一次主存访问】查得有效位 V=1，物理帧号 F=3');

    animatePacket(mmu, pt, '查 PTE 1', 'packet-la', 0.6, () => {
      const ptRow = document.getElementById('pt-row-1');
      if (ptRow) ptRow.classList.add('pt-row-active');
      document.getElementById('pt-state-badge').innerText = 'PTE 命中 (F=3)';
    });
  }, '+=1.0');

  // Step 4: 访存#3 写 TLB 回填 P=1 -> F=3 (紫色高亮)
  tl.add(() => {
    currentAccessCount = 3;
    activateWire('wire-pt-mmu', 'wire-green');
    animatePacket(pt, mmu, 'F = 3', 'packet-f', 0.5, () => {
      // MMU 收到 F=3，写入 TLB
      activateWire('wire-mmu-tlb', 'wire-purple');
      showAccessTag(mmu, tlb, '访存#3: 写 TLB (回填)', 'bg-purple-700 text-white');
      appendAccessLog('访存#3', '写快表', 'TLB 快表', 'P=1 &rarr; F=3', '写入成功', false, '将新映射 P=1 &rarr; Frame 3 写入 TLB 空闲槽');

      animatePacket(mmu, tlb, '写 P=1&rarr;F=3', 'packet-pa', 0.55, () => {
        // 更新 TLB 第 4 行
        tlbData[3] = { v: 1, p: 1, f: 3, dirty: 0 };
        renderTLBTable();
        const row3 = document.getElementById('tlb-row-3');
        if (row3) row3.classList.add('tlb-update-purple');
        document.getElementById('tlb-state-badge').innerText = 'TLB 回填完成';
      });
    });
  }, '+=1.0');

  // Step 5: MMU 合成物理地址 PA = F(3) + D(0x0C8) = 0x30C8
  tl.add(() => {
    document.getElementById('mmu-calc-f').innerText = '3';
    document.getElementById('mmu-pa-val').innerText = '0x30C8 (Frame 3 + 0x0C8)';
    document.getElementById('mmu-pa-box').classList.add('pa-assembled-glow');
    document.getElementById('mmu-state-badge').innerText = '物理地址合成完成';
  }, '+=0.9');

  // Step 6: 访存#4 MMU 输出 PA 到物理内存读 Frame 3
  tl.add(() => {
    currentAccessCount = 4;
    activateWire('wire-mmu-ram', 'wire-purple');
    showAccessTag(mmu, ram, '访存#4: 内存读 Frame 3', 'bg-purple-700 text-white');
    appendAccessLog('访存#4', '物理访存', '物理主存', 'PA = 0x30C8', '命中 (Hit)', true, '【第二次主存访问】访问 Frame 3 (Page 1) 数据单元');

    animatePacket(mmu, ram, 'PA: 0x30C8', 'packet-pa', 0.65, () => {
      const frameEl = document.getElementById('ram-frame-3');
      if (frameEl) frameEl.classList.add('frame-active-read');
    });
  }, '+=1.0');

  // Step 7: 物理内存返回数据给 CPU
  tl.add(() => {
    clearAccessTags();
    activateWire('wire-ram-cpu', 'wire-green');
    animatePacket(ram, cpu, 'Data: 0x5A5A', 'packet-data', 0.75, () => {
      const dataReg = document.getElementById('cpu-data-val');
      dataReg.innerText = '0x5A5A (读取成功)';
      dataReg.className = 'font-bold px-2 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-800';
      document.getElementById('cpu-data-reg-box').classList.add('box-highlight-green');
    });
  }, '+=1.0');

  // 场景 B 结束，安排循环进入场景 C
  tl.add(() => {
    scheduleNextScenario('C');
  }, '+=1.2');
}

// ------------------------------------------------------------
// 场景 C: 缺页与外存调入 (Demand Paging)
// 步骤：CPU发LA -> MMU拆分 -> 访存#1 TLB查P未命中 -> 访存#2 页表查P有效位0缺页 -> MMU发缺页异常 -> CPU/OS暂停 -> OS取磁盘块 -> 访存#3 磁盘读块 -> 页调入空闲帧 -> 访存#4 内存写帧 -> 访存#5 页表写P,V=1,F=帧号 -> 访存#6 写TLB P->F -> 重新执行指令 -> 访存#7 TLB查P命中 -> 访存#8 内存读F+D -> 数据返回CPU
// ------------------------------------------------------------
function executeScenarioC() {
  const cpu = document.getElementById('node-cpu');
  const mmu = document.getElementById('node-mmu');
  const tlb = document.getElementById('node-tlb');
  const pt = document.getElementById('node-pt');
  const ram = document.getElementById('node-ram');
  const disk = document.getElementById('node-disk');

  document.getElementById('cpu-current-inst').innerText = 'LOAD R0, [0x3054]';
  document.getElementById('cpu-la-hex').innerText = '0x3054';
  document.getElementById('cpu-la-bin').innerText = '0011 0000 0101 0100';
  document.getElementById('cpu-data-val').innerText = '--';
  document.getElementById('cpu-data-val').className = 'font-bold px-2 py-0.5 rounded bg-white border border-stone-300 text-stone-400';

  const tl = gsap.timeline();
  tl.timeScale(currentSpeed);
  currentStepTimeline = tl;

  // Step 1: CPU 发逻辑地址 -> MMU 接收拆分
  tl.add(() => {
    document.getElementById('cpu-la-box').classList.add('box-highlight-blue');
    activateWire('wire-cpu-mmu', 'wire-blue');
    animatePacket(cpu, mmu, 'LA: 0x3054', 'packet-la', 0.65, () => {
      document.getElementById('mmu-p-val').innerText = 'P = 3';
      document.getElementById('mmu-d-val').innerText = 'D = 0x054';
      document.getElementById('mmu-calc-d').innerText = '0x054';
      document.getElementById('mmu-state-badge').innerText = '拆分完成 (P=3, D=0x054)';
      document.getElementById('node-mmu').classList.add('highlight-active');
    });
  }, '+=0.2');

  // Step 2: 访存#1 TLB 查 P=3 未命中
  tl.add(() => {
    currentAccessCount = 1;
    activateWire('wire-mmu-tlb', 'wire-orange');
    showAccessTag(mmu, tlb, '访存#1: TLB 查 P=3', 'bg-amber-600 text-white');
    appendAccessLog('访存#1', '地址变换', 'TLB 快表', 'P = 3', '未命中 (Miss)', false, '查快表未命中');

    animatePacket(mmu, tlb, '查 P=3', 'packet-p', 0.6, () => {
      document.getElementById('node-tlb').classList.add('tlb-flash-miss');
      document.getElementById('tlb-state-badge').innerText = '❌ TLB MISS';
    });
  }, '+=1.0');

  // Step 3: 访存#2 页表查 P=3，有效位 0，缺页！
  tl.add(() => {
    currentAccessCount = 2;
    activateWire('wire-mmu-pt', 'wire-blue');
    showAccessTag(mmu, pt, '访存#2: 查页表 P=3', 'bg-rose-700 text-white');
    appendAccessLog('访存#2', '查页表', '主存页表', 'P = 3', '缺页 (V=0)', true, '【第一次主存访问】有效位 V=0，页面不在主存中');

    animatePacket(mmu, pt, '查 PTE 3', 'packet-la', 0.6, () => {
      const ptRow = document.getElementById('pt-row-3');
      if (ptRow) ptRow.classList.add('pt-row-fault');
      document.getElementById('pt-state-badge').innerText = '⚠️ 缺页异常产生';
    });
  }, '+=1.0');

  // Step 4: MMU 发缺页异常 -> CPU / OS 暂停并转入内核中断处理
  tl.add(() => {
    document.getElementById('mmu-fault-flag').classList.remove('hidden');
    document.getElementById('mmu-action-text').innerText = '检测到 V=0，向 CPU 发出缺页中断信号！';
    document.getElementById('node-mmu').classList.add('box-highlight-red');

    // 缺页异常包回传 CPU/OS
    animatePacket(mmu, cpu, '⚡ 缺页异常中断', 'packet-fault', 0.6, () => {
      document.getElementById('cpu-mode-badge').innerText = '内核态 (OS 接管)';
      document.getElementById('cpu-mode-badge').className = 'text-[10px] font-mono px-1.5 py-0.5 rounded font-bold bg-rose-600 text-white';
      document.getElementById('os-status-text').innerText = '缺页处理程序执行中';
      document.getElementById('os-status-text').className = 'text-[10px] font-mono font-bold text-rose-700';
      document.getElementById('os-detail-text').innerText = '指令挂起！OS 正在查找空闲物理帧 (选中 Frame 6) 并调度磁盘调页。';
      document.getElementById('cpu-os-state-box').classList.add('box-highlight-red');
    });
  }, '+=1.0');

  // Step 5: 访存#3 OS 发起磁盘读块 (Block 3)
  tl.add(() => {
    currentAccessCount = 3;
    activateWire('wire-os-disk', 'wire-disk');
    showAccessTag(cpu, disk, '访存#3: 磁盘读 Block 3', 'bg-slate-700 text-white');
    appendAccessLog('访存#3', '外存I/O', '磁盘', 'Block 3 (Page 3)', '读取成功', false, 'OS 中断处理程序通过磁盘控制器读取 Block 3 页面');

    animatePacket(cpu, disk, '读 Block 3', 'packet-disk', 0.65, () => {
      const blockEl = document.getElementById('disk-block-3');
      if (blockEl) blockEl.classList.add('disk-block-reading');
      document.getElementById('disk-state-3').innerText = '正在调入内存...';
    });
  }, '+=1.1');

  // Step 6: 访存#4 磁盘读出页调入空闲帧，写内存帧 (Frame 6)
  tl.add(() => {
    currentAccessCount = 4;
    activateWire('wire-disk-ram', 'wire-green');
    showAccessTag(disk, ram, '访存#4: 内存写 Frame 6', 'bg-emerald-700 text-white');
    appendAccessLog('访存#4', '调页写入', '物理主存', 'Frame 6 (Page 3)', '写入成功', true, '将磁盘读出的 Page 3 实体装入空闲页框 Frame 6');

    animatePacket(disk, ram, '调入 Page 3', 'packet-f', 0.75, () => {
      // 物理内存 Frame 6 更新
      ramFrames[6].occupied = true;
      ramFrames[6].page = 'Page 3 (新调入)';
      ramFrames[6].data = '0xBEEF';
      ramFrames[6].color = 'bg-emerald-50 border-emerald-300';
      renderRAMFrames();

      const frame6 = document.getElementById('ram-frame-6');
      if (frame6) frame6.classList.add('frame-active-write');
    });
  }, '+=1.1');

  // Step 7: 访存#5 OS 更新页表 (P=3, V=1, F=6) (紫色高亮)
  tl.add(() => {
    currentAccessCount = 5;
    showAccessTag(cpu, pt, '访存#5: 页表写 P=3, V=1, F=6', 'bg-purple-700 text-white');
    appendAccessLog('访存#5', '更新页表', '主存页表', 'P=3 &rarr; F=6', '写表完成', true, '修改 PTE 3：有效位置 1，填入分配的物理帧号 6');

    animatePacket(cpu, pt, '写 PTE 3 (V=1, F=6)', 'packet-pa', 0.6, () => {
      ptData[3].v = 1;
      ptData[3].f = 6;
      renderPageTable();

      const ptRow3 = document.getElementById('pt-row-3');
      if (ptRow3) ptRow3.classList.add('pt-update-purple');
    });
  }, '+=1.0');

  // Step 8: 访存#6 写 TLB (回填 P=3 -> F=6, V=1) (紫色高亮)
  tl.add(() => {
    currentAccessCount = 6;
    activateWire('wire-mmu-tlb', 'wire-purple');
    showAccessTag(mmu, tlb, '访存#6: 写 TLB (P=3&rarr;F=6)', 'bg-purple-700 text-white');
    appendAccessLog('访存#6', '写快表', 'TLB 快表', 'P=3 &rarr; F=6', '写入成功', false, '将新映射装入 TLB，加速后续访存');

    animatePacket(mmu, tlb, '写 TLB P=3&rarr;F=6', 'packet-pa', 0.55, () => {
      tlbData[3] = { v: 1, p: 3, f: 6, dirty: 0 };
      renderTLBTable();

      const row3 = document.getElementById('tlb-row-3');
      if (row3) row3.classList.add('tlb-update-purple');
      document.getElementById('tlb-state-badge').innerText = 'TLB 已回填';
    });
  }, '+=1.0');

  // Step 9: 重新执行指令 -> CPU 恢复执行，重新发送逻辑地址 0x3054
  tl.add(() => {
    document.getElementById('cpu-mode-badge').innerText = '用户态执行';
    document.getElementById('cpu-mode-badge').className = 'text-[10px] font-mono px-1.5 py-0.5 rounded font-bold bg-blue-50 text-blue-700 border border-blue-200';
    document.getElementById('os-status-text').innerText = '调页完成 (正常)';
    document.getElementById('os-status-text').className = 'text-[10px] font-mono font-bold text-emerald-700';
    document.getElementById('os-detail-text').innerText = '中断返回！CPU 重新执行原先暂停的 LOAD 指令。';
    document.getElementById('mmu-fault-flag').classList.add('hidden');
    document.getElementById('node-mmu').classList.remove('box-highlight-red');

    activateWire('wire-cpu-mmu', 'wire-blue');
    animatePacket(cpu, mmu, '重新执行: 0x3054', 'packet-la', 0.6, () => {
      document.getElementById('mmu-state-badge').innerText = '指令重执';
    });
  }, '+=1.1');

  // Step 10: 访存#7 TLB 查 P=3 命中！(绿色高亮)
  tl.add(() => {
    currentAccessCount = 7;
    activateWire('wire-mmu-tlb', 'wire-green');
    showAccessTag(mmu, tlb, '访存#7: TLB 查 P=3 (命中)', 'bg-emerald-700 text-white');
    appendAccessLog('访存#7', '地址变换', 'TLB 快表', 'P = 3', '命中 (Hit)', false, '重执时快表已回填，直接命中取出 F=6');

    animatePacket(mmu, tlb, '查 P=3', 'packet-p', 0.55, () => {
      const hitRow = document.getElementById('tlb-row-3');
      if (hitRow) hitRow.classList.add('tlb-row-hit');
      document.getElementById('tlb-state-badge').innerText = '⚡ TLB 命中 (F=6)';
      document.getElementById('tlb-state-badge').className = 'text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300';

      // MMU 合成 PA = 6 + 0x054 = 0x6054
      document.getElementById('mmu-calc-f').innerText = '6';
      document.getElementById('mmu-pa-val').innerText = '0x6054 (Frame 6 + 0x054)';
      document.getElementById('mmu-pa-box').classList.add('pa-assembled-glow');
    });
  }, '+=1.0');

  // Step 11: 访存#8 内存读 F=6 + D (Frame 6)
  tl.add(() => {
    currentAccessCount = 8;
    activateWire('wire-mmu-ram', 'wire-purple');
    showAccessTag(mmu, ram, '访存#8: 内存读 Frame 6', 'bg-purple-700 text-white');
    appendAccessLog('访存#8', '物理访存', '物理主存', 'PA = 0x6054', '命中 (Hit)', true, '【重新执行访存】直接读取新调入的 Frame 6 数据');

    animatePacket(mmu, ram, 'PA: 0x6054', 'packet-pa', 0.65, () => {
      const frameEl = document.getElementById('ram-frame-6');
      if (frameEl) frameEl.classList.add('frame-active-read');
    });
  }, '+=1.1');

  // Step 12: 数据返回 CPU R0
  tl.add(() => {
    clearAccessTags();
    activateWire('wire-ram-cpu', 'wire-green');
    animatePacket(ram, cpu, 'Data: 0xBEEF', 'packet-data', 0.75, () => {
      const dataReg = document.getElementById('cpu-data-val');
      dataReg.innerText = '0xBEEF (读取成功)';
      dataReg.className = 'font-bold px-2 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-800';
      document.getElementById('cpu-data-reg-box').classList.add('box-highlight-green');
    });
  }, '+=1.0');

  // 场景 C 结束，安排循环回到场景 A
  tl.add(() => {
    scheduleNextScenario('A');
  }, '+=1.5');
}

// ============================================================
// 6. 辅助重置与自动循环控制
// ============================================================

function resetAllHighlights() {
  document.querySelectorAll('.box-highlight-blue, .box-highlight-green, .box-highlight-purple, .box-highlight-red, .highlight-active, .pa-assembled-glow').forEach(el => {
    el.classList.remove('box-highlight-blue', 'box-highlight-green', 'box-highlight-purple', 'box-highlight-red', 'highlight-active', 'pa-assembled-glow');
  });

  document.querySelectorAll('.tlb-row-hit, .tlb-flash-miss, .tlb-update-purple, .pt-row-active, .pt-row-fault, .pt-update-purple, .frame-active-read, .frame-active-write, .disk-block-reading').forEach(el => {
    el.classList.remove('tlb-row-hit', 'tlb-flash-miss', 'tlb-update-purple', 'pt-row-active', 'pt-row-fault', 'pt-update-purple', 'frame-active-read', 'frame-active-write', 'disk-block-reading');
  });

  document.getElementById('mmu-fault-flag').classList.add('hidden');
  document.getElementById('mmu-state-badge').innerText = '待命 (IDLE)';
  document.getElementById('tlb-state-badge').innerText = '就绪';
  document.getElementById('tlb-state-badge').className = 'text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-stone-100 text-stone-600 border border-stone-200';
  document.getElementById('pt-state-badge').innerText = '就绪';
}

function scheduleNextScenario(nextKey) {
  if (!isAutoLooping) return;
  loopTimer = setTimeout(() => {
    runScenario(nextKey);
  }, CONFIG.LOOP_DELAY / currentSpeed);
}

function cycleSpeed() {
  const currentIndex = SPEED_STEPS.indexOf(currentSpeed);
  const nextIndex = (currentIndex + 1) % SPEED_STEPS.length;
  setSpeed(SPEED_STEPS[nextIndex]);
}

function setSpeed(spd) {
  currentSpeed = spd;
  const speedText = document.getElementById('speed-text');
  if (speedText) {
    speedText.innerText = `${spd.toFixed(1)}x`;
  }
  gsap.globalTimeline.timeScale(currentSpeed);
  if (currentStepTimeline) {
    currentStepTimeline.timeScale(currentSpeed);
  }
}

function manualJumpScenario(key) {
  if (loopTimer) clearTimeout(loopTimer);
  runScenario(key);
}

function toggleAutoLoop() {
  isAutoLooping = !isAutoLooping;
  const btnText = document.getElementById('loop-btn-text');
  if (isAutoLooping) {
    btnText.innerText = '⏸ 暂停循环';
    // 立即启动下一步
    const nextIdx = (CONFIG.SCENARIOS.indexOf(currentScenario) + 1) % CONFIG.SCENARIOS.length;
    scheduleNextScenario(CONFIG.SCENARIOS[nextIdx]);
  } else {
    btnText.innerText = '▶ 继续循环';
    if (loopTimer) clearTimeout(loopTimer);
  }
}
