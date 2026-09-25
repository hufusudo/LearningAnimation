/**
 * 硬链接与软链接工作机制可视化引擎 (Linux Inode Architecture Visualizer)
 * 遵循 Taste-Skill Light Editorial 浅色纸质美学与 60fps 平滑过渡规范
 * 包含：目录树、Inode 表、磁盘块网格、SVG 矢量箭头动态覆盖、节拍式步进流水线与对比模式
 */

// ============================================================
// 1. 全局数据结构与初始状态
// ============================================================

const State = {
  mode: 'hard', // 'hard' | 'soft' | 'compare'
  speed: 1.0,   // 0.5, 1.0, 2.0
  isPlaying: false,
  isPaused: false,
  timer: null,

  // 文件系统核心状态
  files: {
    orig: {
      exists: true,
      name: 'report.txt',
      inode: 10,
      path: '/home/user/report.txt'
    },
    hard: {
      exists: false,
      name: 'report-hard',
      inode: 10,
      path: '/home/user/report-hard'
    },
    soft: {
      exists: false,
      name: 'report-soft',
      inode: 20,
      path: '/home/user/report-soft',
      targetPath: '/home/user/report.txt'
    }
  },

  // Inode 表状态
  inodes: {
    10: {
      allocated: true,
      type: 'regular', // 'regular' | 'symlink'
      nlink: 1,
      blockPtr: 5,
      status: 'active', // 'active' | 'free'
      fileRef: ['report.txt']
    },
    20: {
      allocated: false,
      type: 'symlink',
      nlink: 0,
      blockPtr: null,
      status: 'free',
      fileRef: []
    }
  },

  // 磁盘块状态 (0~15)
  blocks: [],

  // 打开目标选择
  openTarget: 'report.txt',

  // 删除链接选择 ('hard' | 'soft')
  deleteLinkTarget: 'hard',

  // 动作节拍执行流水线
  activePipeline: null,
  currentBeatIndex: 0,
  
  // 剧本演练队列
  tourQueue: [],
  tourRunning: false,

  // 对比模式状态
  comparison: {
    stage: 'initial' // 'initial' | 'create' | 'open' | 'delete_orig' | 'delete_link'
  }
};

// ============================================================
// 2. 初始化与 DOM 构建
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initDiskBlocks();
  renderDiskGrid();
  renderAllViews();
  bindEvents();
  updateSvgArrows();

  addLog('系统就绪', '文件系统初始化完毕。已创建初始普通文件 /home/user/report.txt (inode 10, 数据块 5)。');

  // 自适应重绘连线
  window.addEventListener('resize', debounce(updateSvgArrows, 80));
  window.addEventListener('scroll', debounce(updateSvgArrows, 80));
});

/**
 * 初始化 16 个磁盘块数据
 */
function initDiskBlocks() {
  State.blocks = [];
  for (let i = 0; i < 16; i++) {
    let type = 'free';
    let label = `Block #${i}`;
    let content = '空闲 (Free)';
    let isReserved = false;

    if (i === 0) {
      type = 'reserved';
      label = 'Superblock';
      content = '超级块 (元信息)';
      isReserved = true;
    } else if (i === 1) {
      type = 'reserved';
      label = 'Inode Bitmap';
      content = 'inode 位图区';
      isReserved = true;
    } else if (i === 2) {
      type = 'reserved';
      label = 'Block Bitmap';
      content = '块位图区';
      isReserved = true;
    } else if (i === 3) {
      type = 'reserved';
      label = 'Inode Table';
      content = 'inode 数组表区';
      isReserved = true;
    } else if (i === 4) {
      type = 'reserved';
      label = 'Dir Block';
      content = '/home/user/ 目录块';
      isReserved = true;
    } else if (i === 5) {
      // 初始占用的数据块 5
      type = 'occupied';
      label = 'Block #5';
      content = 'Hello';
    }

    State.blocks.push({
      id: i,
      type: type, // 'free' | 'occupied' | 'symlink' | 'reserved'
      label: label,
      content: content,
      isReserved: isReserved,
      owner: i === 5 ? 'report.txt' : null
    });
  }
}

/**
 * 渲染磁盘块网格 DOM
 */
function renderDiskGrid() {
  const container = document.getElementById('disk-grid-container');
  if (!container) return;
  container.innerHTML = '';

  State.blocks.forEach(b => {
    const card = document.createElement('div');
    card.id = `disk-block-${b.id}`;
    card.className = `relative p-2 rounded-xl border transition-all text-xs font-mono cursor-pointer flex flex-col justify-between h-20 ${getBlockClass(b.type)}`;
    card.onclick = () => inspectBlock(b.id);

    // 块标号与标签
    const topRow = document.createElement('div');
    topRow.className = 'flex items-center justify-between';
    topRow.innerHTML = `
      <span class="font-bold text-[11px]">${b.id < 10 ? '0' + b.id : b.id}#</span>
      <span class="text-[9px] px-1 py-0.2 rounded ${getBlockBadgeClass(b.type)}">${getBlockShortType(b.type)}</span>
    `;

    // 块内容缩略
    const contentRow = document.createElement('div');
    contentRow.className = 'my-auto truncate text-[11px] font-bold text-center';
    contentRow.textContent = b.type === 'free' ? '[空闲]' : b.content;

    // 左侧锚点 (接入 Inode 指针连线)
    const anchor = document.createElement('div');
    anchor.id = `anchor-block-${b.id}-left`;
    anchor.className = 'connect-anchor connect-anchor-left bg-emerald-600';
    card.appendChild(anchor);

    card.appendChild(topRow);
    card.appendChild(contentRow);
    container.appendChild(card);
  });
}

function getBlockClass(type) {
  switch (type) {
    case 'free':
      return 'block-free hover:border-emerald-400 bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]';
    case 'occupied':
      return 'block-occupied hover:border-rose-400 bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]';
    case 'symlink':
      return 'block-symlink hover:border-amber-400 bg-[#FFF7ED] border-[#FDBA74] text-[#C2410C]';
    case 'reserved':
      return 'bg-stone-100 border-stone-200 text-stone-600 hover:border-stone-300';
    default:
      return 'bg-stone-50 border-stone-200';
  }
}

function getBlockBadgeClass(type) {
  switch (type) {
    case 'free':
      return 'bg-emerald-100 text-emerald-800';
    case 'occupied':
      return 'bg-rose-100 text-rose-800 font-bold';
    case 'symlink':
      return 'bg-amber-100 text-amber-800 font-bold';
    case 'reserved':
      return 'bg-stone-200 text-stone-700';
    default:
      return 'bg-stone-100 text-stone-600';
  }
}

function getBlockShortType(type) {
  switch (type) {
    case 'free': return 'Free';
    case 'occupied': return '数据块';
    case 'symlink': return '路径块';
    case 'reserved': return '系统';
    default: return '';
  }
}

/**
 * 盘块检视详情
 */
function inspectBlock(blockId) {
  const b = State.blocks[blockId];
  if (!b) return;

  const idEl = document.getElementById('inspect-block-id');
  const typeEl = document.getElementById('inspect-block-type');
  const contentEl = document.getElementById('inspect-block-content');
  const descEl = document.getElementById('inspect-block-desc');
  const sizeEl = document.getElementById('inspect-block-size');

  idEl.textContent = `Block #${b.id}`;
  
  if (b.type === 'free') {
    typeEl.textContent = '空闲盘块 (Free Block)';
    typeEl.className = 'px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px]';
    contentEl.textContent = '0x00 (全零未分配)';
    descEl.textContent = '外存未分配空间，随时可供新文件或新数据写入';
    sizeEl.textContent = '容量: 4 KB';
  } else if (b.type === 'occupied') {
    typeEl.textContent = '普通文件数据块 (Payload)';
    typeEl.className = 'px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[10px]';
    contentEl.textContent = `"${b.content}"`;
    descEl.textContent = '存放用户写入文件的真实二进制/文本内容';
    sizeEl.textContent = `占用: ${b.content.length} 字节`;
  } else if (b.type === 'symlink') {
    typeEl.textContent = '符号链接路径数据块 (Symlink Target)';
    typeEl.className = 'px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-300 font-bold text-[10px]';
    contentEl.textContent = `"${b.content}"`;
    descEl.textContent = '保存目标文件的路径文本，供内核路径解析器跳转读取';
    sizeEl.textContent = `占用: ${b.content.length} 字节`;
  } else {
    typeEl.textContent = '文件系统保留管理块 (Metadata)';
    typeEl.className = 'px-1.5 py-0.2 rounded bg-stone-100 text-stone-700 border border-stone-300 font-bold text-[10px]';
    contentEl.textContent = b.content;
    descEl.textContent = 'Linux Ext4/VFS 系统元数据存储区';
    sizeEl.textContent = '固定开销';
  }

  // 触发卡片呼吸动效
  gsap.fromTo('#block-inspector', { scale: 0.98 }, { scale: 1, duration: 0.2, ease: 'power2.out' });
}

// ============================================================
// 3. 视图渲染与状态更新
// ============================================================

function renderAllViews() {
  renderDirectoryTree();
  renderInodeTable();
  renderDiskGrid();
  updateButtonStates();
  setTimeout(updateSvgArrows, 50);
}

/**
 * 渲染左侧目录树
 */
function renderDirectoryTree() {
  const txtEntry = document.getElementById('dentry-report-txt');
  const hardEntry = document.getElementById('dentry-report-hard');
  const softEntry = document.getElementById('dentry-report-soft');

  if (State.files.orig.exists) {
    txtEntry.classList.remove('hidden');
  } else {
    txtEntry.classList.add('hidden');
  }

  if (State.files.hard.exists) {
    hardEntry.classList.remove('hidden');
  } else {
    hardEntry.classList.add('hidden');
  }

  if (State.files.soft.exists) {
    softEntry.classList.remove('hidden');
  } else {
    softEntry.classList.add('hidden');
  }
}

/**
 * 渲染中间 Inode 表
 */
function renderInodeTable() {
  // Inode 10
  const row10 = document.getElementById('inode-row-10');
  const nlink10 = document.getElementById('inode-10-nlink');
  const ptr10 = document.getElementById('inode-10-ptr');
  const status10 = document.getElementById('inode-10-status-badge');

  if (State.inodes[10].allocated) {
    row10.classList.remove('opacity-40');
    status10.textContent = '活跃 (Active)';
    status10.className = 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono font-bold';
    ptr10.textContent = 'Block #5';
  } else {
    row10.classList.add('opacity-40');
    status10.textContent = '已释放 (Free)';
    status10.className = 'text-[10px] px-2 py-0.5 rounded-full bg-stone-200 text-stone-600 font-mono font-bold';
    ptr10.textContent = 'None (空)';
  }
  animateDigit('inode-10-nlink', State.inodes[10].nlink);

  // Inode 20
  const row20 = document.getElementById('inode-row-20');
  const nlink20 = document.getElementById('inode-20-nlink');
  const ptr20 = document.getElementById('inode-20-ptr');
  const status20 = document.getElementById('inode-20-status-badge');

  if (State.inodes[20].allocated) {
    row20.classList.remove('hidden');
    row20.classList.remove('opacity-40');
    status20.textContent = '独立分配 (Active)';
    status20.className = 'text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-mono font-bold';
    ptr20.textContent = 'Block #6';
    animateDigit('inode-20-nlink', State.inodes[20].nlink);
  } else {
    if (State.files.soft.exists) {
      row20.classList.remove('hidden');
      row20.classList.add('opacity-40');
      status20.textContent = '已释放 (Free)';
      status20.className = 'text-[10px] px-2 py-0.5 rounded-full bg-stone-200 text-stone-600 font-mono font-bold';
      ptr20.textContent = 'None (空)';
      animateDigit('inode-20-nlink', 0);
    } else {
      row20.classList.add('hidden');
    }
  }
}

/**
 * 链接计数平滑翻滚/缩放数字动效
 */
function animateDigit(elemId, newValue) {
  const el = document.getElementById(elemId);
  if (!el) return;
  const currentVal = parseInt(el.textContent, 10);
  if (currentVal === newValue) return;

  gsap.fromTo(el,
    { scale: 1.4, color: '#2563EB', y: -2 },
    { scale: 1, color: '#1C1917', y: 0, duration: 0.35 / State.speed, ease: 'back.out(2)', onStart: () => {
      el.textContent = newValue;
    }}
  );
}

/**
 * 按钮可用性控制
 */
function updateButtonStates() {
  const btnCreateOrig = document.getElementById('btn-create-file');
  const btnCreateHard = document.getElementById('btn-create-hard');
  const btnCreateSoft = document.getElementById('btn-create-soft');
  const btnDeleteOrig = document.getElementById('btn-delete-orig');
  const btnDeleteLink = document.getElementById('btn-delete-link');
  const deleteBadge = document.getElementById('delete-link-badge');

  if (btnCreateOrig) btnCreateOrig.disabled = State.files.orig.exists;
  if (btnCreateHard) btnCreateHard.disabled = State.files.hard.exists || !State.files.orig.exists;
  if (btnCreateSoft) btnCreateSoft.disabled = State.files.soft.exists;
  if (btnDeleteOrig) btnDeleteOrig.disabled = !State.files.orig.exists;

  // 删除链接按钮提示
  const hasHard = State.files.hard.exists;
  const hasSoft = State.files.soft.exists;

  if (btnDeleteLink) {
    if (State.mode === 'hard') {
      btnDeleteLink.disabled = !hasHard;
      deleteBadge.textContent = '硬链接';
    } else if (State.mode === 'soft') {
      btnDeleteLink.disabled = !hasSoft;
      deleteBadge.textContent = '软链接';
    } else {
      btnDeleteLink.disabled = !hasHard && !hasSoft;
      deleteBadge.textContent = hasHard ? '硬链接' : (hasSoft ? '软链接' : '链接');
    }
  }
}

// ============================================================
// 4. SVG 动态箭头绘制与更新 (核心视觉覆盖层)
// ============================================================

/**
 * 实时刷新所有当前激活的 SVG 箭头
 */
function updateSvgArrows(immediate = true) {
  const svg = document.getElementById('connection-svg-layer');
  if (!svg) return;
  
  // 清理现有箭头
  const existingArrows = svg.querySelectorAll('.dynamic-arrow-group');
  existingArrows.forEach(el => el.remove());

  if (State.mode === 'compare') {
    return; // 对比模式有独立的内部沙盒连线
  }

  // 1. 目录项 report.txt -> inode 10 (蓝色实线)
  if (State.files.orig.exists && State.inodes[10].allocated) {
    drawSvgCurve(
      'anchor-dentry-txt',
      'anchor-inode-10-left',
      '#2563EB',
      'arrow-blue',
      false,
      0.15,
      immediate
    );
  }

  // 2. 目录项 report-hard -> inode 10 (蓝色实线)
  if (State.files.hard.exists && State.inodes[10].allocated) {
    drawSvgCurve(
      'anchor-dentry-hard',
      'anchor-inode-10-left',
      '#2563EB',
      'arrow-blue',
      false,
      -0.18,
      immediate
    );
  }

  // 3. inode 10 -> 数据块 5 (绿色实线)
  if (State.inodes[10].allocated && State.inodes[10].blockPtr === 5) {
    drawSvgCurve(
      'anchor-inode-10-right',
      'anchor-block-5-left',
      '#059669',
      'arrow-green',
      false,
      0.08,
      immediate
    );
  }

  // 4. 目录项 report-soft -> inode 20 (蓝色/琥珀实线)
  if (State.files.soft.exists && State.inodes[20].allocated) {
    drawSvgCurve(
      'anchor-dentry-soft',
      'anchor-inode-20-left',
      '#2563EB',
      'arrow-blue',
      false,
      0.15,
      immediate
    );
  }

  // 5. inode 20 -> 数据块 6 (绿色实线)
  if (State.inodes[20].allocated && State.inodes[20].blockPtr === 6) {
    drawSvgCurve(
      'anchor-inode-20-right',
      'anchor-block-6-left',
      '#059669',
      'arrow-green',
      false,
      0.12,
      immediate
    );
  }
}

/**
 * 绘制两锚点之间的平滑三次贝塞尔贝塞尔曲线
 */
function drawSvgCurve(anchorStartId, anchorEndId, color = '#2563EB', markerId = 'arrow-blue', dashed = false, curvature = 0.15, immediate = false, customClass = '') {
  const el1 = document.getElementById(anchorStartId);
  const el2 = document.getElementById(anchorEndId);
  if (!el1 || !el2) return null;

  // 确保元素可见
  if (el1.offsetParent === null || el2.offsetParent === null) return null;

  const r1 = el1.getBoundingClientRect();
  const r2 = el2.getBoundingClientRect();

  const svg = document.getElementById('connection-svg-layer');
  if (!svg) return null;
  const svgRect = svg.getBoundingClientRect();

  const x1 = r1.left + r1.width / 2 - svgRect.left;
  const y1 = r1.top + r1.height / 2 - svgRect.top;
  const x2 = r2.left + r2.width / 2 - svgRect.left;
  const y2 = r2.top + r2.height / 2 - svgRect.top;

  const dx = x2 - x1;
  const dy = y2 - y1;

  // 控制点坐标 (横向平滑引导)
  const cx1 = x1 + dx * 0.5;
  const cy1 = y1 + dy * curvature;
  const cx2 = x1 + dx * 0.5;
  const cy2 = y2 - dy * curvature;

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', `dynamic-arrow-group ${customClass}`);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${cy1} ${cx2} ${cy2} ${x2} ${y2}`);
  path.setAttribute('class', `flow-arrow-path ${dashed ? 'flow-arrow-dash' : ''}`);
  path.setAttribute('stroke', color);
  path.setAttribute('marker-end', `url(#${markerId})`);

  group.appendChild(path);
  svg.appendChild(group);

  if (!immediate) {
    const len = path.getTotalLength() || 150;
    path.style.strokeDasharray = `${len} ${len}`;
    path.style.strokeDashoffset = len;
    gsap.to(path, {
      strokeDashoffset: 0,
      duration: 0.45 / State.speed,
      ease: 'power2.out'
    });
  }

  return group;
}

// ============================================================
// 5. 核心动作节拍执行流水线 (Beats Architecture)
// ============================================================

/**
 * 切换模式 (硬链接 / 软链接 / 对比模式)
 */
function switchMode(modeKey) {
  if (State.isPlaying) stopAutoPlay();
  State.mode = modeKey;

  ['hard', 'soft', 'compare'].forEach(m => {
    const btn = document.getElementById(`tab-${m}`);
    if (btn) {
      if (m === modeKey) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  const singleView = document.getElementById('single-mode-view');
  const compView = document.getElementById('comparison-mode-view');

  if (modeKey === 'compare') {
    singleView.classList.add('hidden');
    compView.classList.remove('hidden');
    initComparisonView();
  } else {
    singleView.classList.remove('hidden');
    compView.classList.add('hidden');
    renderAllViews();
  }

  addLog('模式切换', `已进入：${modeKey === 'hard' ? '硬链接模式 (Hard Link)' : (modeKey === 'soft' ? '软链接模式 (Symbolic Link)' : '双侧并排对比模式')}`);
}

/**
 * 设置播放速率
 */
function setSpeed(spd) {
  State.speed = spd;
  [0.5, 1.0, 2.0].forEach(s => {
    const id = `spd-${s.toString().replace('.', '')}`;
    const btn = document.getElementById(id);
    if (!btn) return;
    if (s === spd) {
      btn.className = 'px-2 py-0.5 rounded bg-white font-bold text-stone-900 shadow-xs';
    } else {
      btn.className = 'px-2 py-0.5 rounded text-stone-600 hover:text-stone-900';
    }
  });
  addLog('速率调节', `当前动画播放速率已设为 ${spd}x`);
}

/**
 * 节拍状态重置与高亮
 */
function setBeatProgress(beatNum) {
  for (let i = 1; i <= 5; i++) {
    const dot = document.getElementById(`beat-dot-${i}`);
    const box = document.getElementById(`beat-${i}`);
    if (!dot || !box) continue;

    if (i < beatNum) {
      dot.className = 'step-dot step-dot-done';
      box.className = 'flex items-center gap-1 text-stone-500 font-bold';
    } else if (i === beatNum) {
      dot.className = 'step-dot step-dot-active';
      box.className = 'flex items-center gap-1 text-stone-900 font-bold';
    } else {
      dot.className = 'step-dot step-dot-pending';
      box.className = 'flex items-center gap-1 text-stone-400';
    }
  }
}

/**
 * 清除所有临时高亮动效
 */
function clearAllHighlights() {
  document.querySelectorAll('.pulse-target-blue, .pulse-target-green, .pulse-target-orange, .broken-link-alert').forEach(el => {
    el.classList.remove('pulse-target-blue', 'pulse-target-green', 'pulse-target-orange', 'broken-link-alert');
  });
  // 移除临时虚线/解析箭头
  document.querySelectorAll('.temp-arrow-element').forEach(el => el.remove());
}

/**
 * 执行指定原子操作
 */
function handleAction(actionType) {
  if (State.isPlaying) stopAutoPlay();
  clearAllHighlights();

  switch (actionType) {
    case 'create_file':
      setupCreateFilePipeline();
      break;
    case 'create_hard':
      setupCreateHardLinkPipeline();
      break;
    case 'create_soft':
      setupCreateSoftLinkPipeline();
      break;
    case 'open_file':
      setupOpenFilePipeline(State.openTarget);
      break;
    case 'delete_original':
      setupDeleteOriginalPipeline();
      break;
    case 'delete_link':
      if (State.mode === 'soft' || (State.files.soft.exists && !State.files.hard.exists)) {
        setupDeleteSoftLinkPipeline();
      } else {
        setupDeleteHardLinkPipeline();
      }
      break;
    default:
      break;
  }

  // 立即执行第一步
  stepForward();
}

/**
 * 单步前进 (Step)
 */
function stepForward() {
  if (!State.activePipeline) return;

  if (State.currentBeatIndex < State.activePipeline.beats.length) {
    const beatFn = State.activePipeline.beats[State.currentBeatIndex];
    State.currentBeatIndex++;
    setBeatProgress(State.currentBeatIndex);
    beatFn();
  } else {
    // 流水线已全部完成
    clearAllHighlights();
    setBeatProgress(5);
    State.activePipeline = null;
    State.currentBeatIndex = 0;

    // 若处于全流程剧本演练中，驱动下一个动作
    if (State.tourRunning && State.tourQueue.length > 0) {
      setTimeout(() => {
        executeNextTourStep();
      }, 700 / State.speed);
    } else {
      stopAutoPlay();
    }
  }
}

/**
 * 自动播放与暂停切换
 */
function togglePlayPause() {
  if (State.isPlaying) {
    stopAutoPlay();
  } else {
    startAutoPlay();
  }
}

function startAutoPlay() {
  State.isPlaying = true;
  document.getElementById('play-icon').textContent = '⏸';
  document.getElementById('play-label').textContent = '暂停播放';

  // 若当前无活跃动作，默认根据模式提供推荐动作
  if (!State.activePipeline) {
    if (!State.files.orig.exists) {
      setupCreateFilePipeline();
    } else if (State.mode === 'hard' && !State.files.hard.exists) {
      setupCreateHardLinkPipeline();
    } else if (State.mode === 'soft' && !State.files.soft.exists) {
      setupCreateSoftLinkPipeline();
    } else {
      setupOpenFilePipeline(State.openTarget);
    }
  }

  scheduleNextAutoBeat();
}

function stopAutoPlay() {
  State.isPlaying = false;
  State.tourRunning = false;
  if (State.timer) {
    clearTimeout(State.timer);
    State.timer = null;
  }
  const icon = document.getElementById('play-icon');
  const label = document.getElementById('play-label');
  if (icon) icon.textContent = '▶';
  if (label) label.textContent = '自动播放';
}

function scheduleNextAutoBeat() {
  if (!State.isPlaying) return;
  const interval = (900 / State.speed);
  State.timer = setTimeout(() => {
    if (!State.isPlaying) return;
    stepForward();
    if (State.activePipeline || State.tourQueue.length > 0) {
      scheduleNextAutoBeat();
    } else {
      stopAutoPlay();
    }
  }, interval);
}

// ============================================================
// 6. 各操作专属流水线规划 (严格遵循题意 5 大节拍)
// ============================================================

/**
 * 流水线 0：创建原文件 report.txt
 */
function setupCreateFilePipeline() {
  State.currentBeatIndex = 0;
  State.activePipeline = {
    name: '创建原文件 report.txt',
    beats: [
      // 1. 定位
      () => {
        addLog('节拍 1: 定位目录项', '检索 /home/user/ 目录，检查文件名 report.txt 是否已存在。');
        document.getElementById('dir-node-user').classList.add('pulse-target-blue');
      },
      // 2. 查找/创建 Inode
      () => {
        clearAllHighlights();
        addLog('节拍 2: 分配 Inode', '分配全新 Inode 10，标记类型为「普通文件」，数据块直接指针指向 Block #5。');
        State.inodes[10].allocated = true;
        State.inodes[10].nlink = 1;
        State.inodes[10].blockPtr = 5;
        renderInodeTable();
        document.getElementById('inode-row-10').classList.add('pulse-target-green');
      },
      // 3. 状态变化 (占用盘块 5)
      () => {
        clearAllHighlights();
        addLog('节拍 3: 数据块分配', '从外存位图中分配空闲块 Block #5，写入内容 "Hello"，状态标记为已占用。');
        State.blocks[5].type = 'occupied';
        State.blocks[5].content = 'Hello';
        renderDiskGrid();
        document.getElementById('disk-block-5').classList.add('pulse-target-green');
      },
      // 4. 更新连线
      () => {
        clearAllHighlights();
        addLog('节拍 4: 构建映射连线', '在目录中新增 report.txt -> inode 10 映射，绘制蓝色实线与绿色实线。');
        State.files.orig.exists = true;
        renderDirectoryTree();
        updateSvgArrows(false);
      },
      // 5. 写入日志
      () => {
        addLog('完成创建', '原文件 report.txt 创建成功！inode 10 链接计数 i_nlink = 1，数据块 5 内容为 "Hello"。');
        updateButtonStates();
      }
    ]
  };
}

/**
 * 流水线 1：创建硬链接 report-hard
 */
function setupCreateHardLinkPipeline() {
  State.currentBeatIndex = 0;
  State.activePipeline = {
    name: '创建硬链接 report-hard',
    beats: [
      // 1. 定位
      () => {
        addLog('节拍 1: 定位原文件', '系统调用 link()：根据原路径 /home/user/report.txt 检索到目标对应 Inode 10。');
        document.getElementById('dentry-report-txt').classList.add('pulse-target-blue');
      },
      // 2. 查找/创建 (不新建 Inode！)
      () => {
        clearAllHighlights();
        addLog('节拍 2: 共享 Inode 核心特性', '重要机制：硬链接【绝不新建 Inode】！直接复用现有的 Inode 10。');
        document.getElementById('inode-row-10').classList.add('pulse-target-blue');
      },
      // 3. 状态变化：计数 1 -> 2
      () => {
        clearAllHighlights();
        State.inodes[10].nlink = 2;
        State.inodes[10].fileRef.push('report-hard');
        renderInodeTable();
        addLog('节拍 3: 计数递增', 'Inode 10 物理引用计数递增：i_nlink 由 1 &rarr; 2。');
      },
      // 4. 画箭头
      () => {
        State.files.hard.exists = true;
        renderDirectoryTree();
        updateSvgArrows(false);
        addLog('节拍 4: 画出新映射箭头', '在目录表中追加条目 report-hard，直接指向 Inode 10，绘制蓝色实线箭头。');
      },
      // 5. 总结
      () => {
        addLog('完成创建硬链接', '硬链接 report-hard 创建成功！磁盘不消耗任何新 inode 或新数据块。');
        updateButtonStates();
      }
    ]
  };
}

/**
 * 流水线 2：打开文件/链接 (支持 report.txt / report-hard / report-soft)
 */
function setupOpenFilePipeline(targetKey) {
  State.currentBeatIndex = 0;

  if (targetKey === 'report-soft') {
    // 软链接打开 (逐段解析)
    setupOpenSoftLinkPipeline();
    return;
  }

  const isHard = (targetKey === 'report-hard');
  const dentryId = isHard ? 'dentry-report-hard' : 'dentry-report-txt';
  const targetLabel = isHard ? '硬链接 report-hard' : '原文件 report.txt';

  State.activePipeline = {
    name: `打开 ${targetLabel}`,
    beats: [
      // 1. 定位目录项
      () => {
        addLog('节拍 1: 定位目录项', `在目录 /home/user/ 中检索条目 ${targetLabel}。`);
        const el = document.getElementById(dentryId);
        if (el) el.classList.add('pulse-target-blue');
      },
      // 2. 查 Inode
      () => {
        clearAllHighlights();
        addLog('节拍 2: 寻址 Inode', `沿蓝色实线直达 Inode 10，检查属性：普通文件 (-)，i_nlink = ${State.inodes[10].nlink}。`);
        document.getElementById('inode-row-10').classList.add('pulse-target-blue');
      },
      // 3. 寻址数据块
      () => {
        clearAllHighlights();
        addLog('节拍 3: 磁盘指针寻址', '读取 Inode 10 直接指针，直达 Block #5。');
        document.getElementById('disk-block-5').classList.add('pulse-target-green');
      },
      // 4. 数据读取
      () => {
        clearAllHighlights();
        inspectBlock(5);
        addLog('节拍 4: I/O 数据读取', '磁盘控制器读取 Block #5 扇区数据："Hello" 并加载至内核页缓存。');
      },
      // 5. 成功打开
      () => {
        addLog('打开成功', `【${targetLabel}】打开成功！直接读取到内容 "Hello"。一步直达，无多级重定向损耗。`);
      }
    ]
  };
}

/**
 * 流水线 3：删除原文件 report.txt (硬链接存活演练)
 */
function setupDeleteOriginalPipeline() {
  State.currentBeatIndex = 0;
  State.activePipeline = {
    name: '删除原文件 report.txt',
    beats: [
      // 1. 定位
      () => {
        addLog('节拍 1: 定位待删除条目', '系统调用 unlink("report.txt")：在目录树中找到待删除项 report.txt。');
        document.getElementById('dentry-report-txt').classList.add('pulse-target-blue');
      },
      // 2. 擦除目录项与箭头
      () => {
        clearAllHighlights();
        State.files.orig.exists = false;
        renderDirectoryTree();
        updateSvgArrows(false);
        addLog('节拍 2: 注销目录项', '从目录表中擦除 report.txt 映射条目，并移除其指向 Inode 10 的蓝色箭头。');
      },
      // 3. 链接计数递减
      () => {
        State.inodes[10].nlink = Math.max(0, State.inodes[10].nlink - 1);
        renderInodeTable();
        addLog('节拍 3: 计数递减', `Inode 10 链接计数递减为：i_nlink = ${State.inodes[10].nlink}。`);
      },
      // 4. 内核回收裁决
      () => {
        if (State.inodes[10].nlink > 0) {
          addLog('节拍 4: 判断 i_nlink > 0', '关键机制：因为 i_nlink = 1 > 0，Inode 10 与数据块 5 完全保留，不释放！');
          document.getElementById('inode-row-10').classList.add('pulse-target-green');
        } else {
          // 若无硬链接，直接释放
          State.inodes[10].allocated = false;
          State.blocks[5].type = 'free';
          State.blocks[5].content = '空闲 (Free)';
          renderInodeTable();
          renderDiskGrid();
          updateSvgArrows(false);
          addLog('节拍 4: 计数归零触发释放', 'i_nlink = 0 且无打开句柄，内核正式释放 Inode 10 及数据块 5。');
        }
      },
      // 5. 总结验证
      () => {
        clearAllHighlights();
        if (State.files.hard.exists) {
          addLog('验证硬链接可用性', '原文件 report.txt 已彻底被删，但 report-hard 依旧健在且能正常读写！');
        } else {
          addLog('删除完成', '文件及其底层 Inode 已完全销毁。');
        }
        updateButtonStates();
      }
    ]
  };
}

/**
 * 流水线 4：删除最后一个硬链接 report-hard
 */
function setupDeleteHardLinkPipeline() {
  State.currentBeatIndex = 0;
  State.activePipeline = {
    name: '删除硬链接 report-hard',
    beats: [
      // 1. 定位
      () => {
        addLog('节拍 1: 定位硬链接条目', '系统调用 unlink("report-hard")：找到目录项 report-hard。');
        document.getElementById('dentry-report-hard').classList.add('pulse-target-blue');
      },
      // 2. 擦除目录项
      () => {
        clearAllHighlights();
        State.files.hard.exists = false;
        renderDirectoryTree();
        updateSvgArrows(false);
        addLog('节拍 2: 移除硬链接目录项', '擦除 report-hard 映射条目，并消除其箭头。');
      },
      // 3. 计数归零
      () => {
        State.inodes[10].nlink = Math.max(0, State.inodes[10].nlink - 1);
        renderInodeTable();
        addLog('节拍 3: 计数递减至 0', `Inode 10 链接计数递减：i_nlink = ${State.inodes[10].nlink}。`);
      },
      // 4. 释放 Inode 与数据块
      () => {
        State.inodes[10].allocated = false;
        State.inodes[10].blockPtr = null;
        State.blocks[5].type = 'free';
        State.blocks[5].content = '空闲 (Free)';
        renderInodeTable();
        renderDiskGrid();
        updateSvgArrows(false);
        addLog('节拍 4: 垃圾回收', 'i_nlink 归零！内核回收 Inode 10，并将 Block #5 标记回绿色空闲状态！');
      },
      // 5. 总结
      () => {
        addLog('彻底回收完毕', '最后一个硬链接删除完毕，原文件数据块与 Inode 已全部归还系统。');
        updateButtonStates();
      }
    ]
  };
}

/**
 * 流水线 5：创建软链接 report-soft
 */
function setupCreateSoftLinkPipeline() {
  State.currentBeatIndex = 0;
  State.activePipeline = {
    name: '创建软链接 report-soft',
    beats: [
      // 1. 定位
      () => {
        addLog('节拍 1: 发起 symlink 系统调用', '调用 symlink("/home/user/report.txt", "report-soft")。');
        document.getElementById('dir-node-user').classList.add('pulse-target-orange');
      },
      // 2. 创建独立 Inode 20
      () => {
        clearAllHighlights();
        State.inodes[20].allocated = true;
        State.inodes[20].type = 'symlink';
        State.inodes[20].nlink = 1;
        State.inodes[20].blockPtr = 6;
        renderInodeTable();
        document.getElementById('inode-row-20').classList.add('pulse-target-orange');
        addLog('节拍 2: 独立分配 Inode 20', '软链接【分配全新 Inode 20】，文件类型设为「符号链接 (l)」，独立拥有元数据！');
      },
      // 3. 分配数据块 6 存储路径字符串
      () => {
        clearAllHighlights();
        State.blocks[6].type = 'symlink';
        State.blocks[6].content = '/home/user/report.txt';
        renderDiskGrid();
        document.getElementById('disk-block-6').classList.add('pulse-target-orange');
        inspectBlock(6);
        addLog('节拍 3: 分配路径数据块', '分配全新磁盘块 Block #6，将目标绝对路径字符串 "/home/user/report.txt" 存入块中。');
      },
      // 4. 更新连线
      () => {
        clearAllHighlights();
        State.files.soft.exists = true;
        renderDirectoryTree();
        updateSvgArrows(false);
        addLog('节拍 4: 建立多级映射', '在目录中添加 report-soft -> inode 20 映射，并建立 inode 20 -> Block #6 指针。');
      },
      // 5. 总结
      () => {
        addLog('完成软链接创建', '软链接 report-soft 创建完毕！消耗独立 Inode 20 和独立数据块 6。');
        updateButtonStates();
      }
    ]
  };
}

/**
 * 流水线 6：打开软链接 report-soft (逐段路径解析与悬空检测)
 */
function setupOpenSoftLinkPipeline() {
  State.currentBeatIndex = 0;
  const isTargetAlive = State.files.orig.exists;

  State.activePipeline = {
    name: '打开软链接 report-soft',
    beats: [
      // 1. 定位软链接并读取 Inode 20
      () => {
        addLog('节拍 1: 定位符号链接', '在目录中检索 report-soft，沿蓝色线直达其专属 Inode 20。');
        const el = document.getElementById('dentry-report-soft');
        if (el) el.classList.add('pulse-target-blue');
        document.getElementById('inode-row-20').classList.add('pulse-target-orange');
      },
      // 2. 读取数据块 6 获取路径字符串
      () => {
        clearAllHighlights();
        addLog('节拍 2: 提取路径文本', '发现文件类型为符号链接，读取 Block #6 获取路径文本："/home/user/report.txt"。');
        document.getElementById('disk-block-6').classList.add('pulse-target-orange');
        inspectBlock(6);
      },
      // 3. 逐段高亮路径解析 (Path Resolution)
      () => {
        clearAllHighlights();
        addLog('节拍 3: 启动逐段路径解析', '内核路径解析器从根目录 / 递归遍历：/ &rarr; home/ &rarr; user/ ...');
        highlightPathResolutionStep();
      },
      // 4. 判定目标是否存在
      () => {
        clearAllHighlights();
        if (isTargetAlive) {
          // 目标存在：成功命中
          addLog('节拍 4: 成功匹配目标条目', '在 user/ 目录下成功匹配到 report.txt 目录项，重定向至 Inode 10！');
          document.getElementById('dentry-report-txt').classList.add('pulse-target-green');
          document.getElementById('inode-row-10').classList.add('pulse-target-green');
          document.getElementById('disk-block-5').classList.add('pulse-target-green');
          inspectBlock(5);
        } else {
          // 目标已被删除：悬空断链！红色闪烁！
          addLog('节拍 4: 路径解析失败 (断链！)', '【悬空链接异常】user/ 目录下不存在 report.txt！目标文件已消失！');
          document.getElementById('dentry-report-soft').classList.add('broken-link-alert');
          drawBrokenArrow('anchor-dentry-soft', 'anchor-inode-10-left');
        }
      },
      // 5. 结果反馈
      () => {
        clearAllHighlights();
        if (isTargetAlive) {
          addLog('成功读取内容', '软链接解析完毕：经多级重定向最终读取数据块 5 内容 "Hello"！');
        } else {
          addLog('系统报错', '❌ 错误: 悬空链接 (Dangling Symlink / Broken Link)！返回错误码 ENOENT: No such file or directory。');
        }
      }
    ]
  };
}

/**
 * 逐段高亮路径解析
 */
function highlightPathResolutionStep() {
  const steps = [
    { id: 'dir-node-root', name: '/' },
    { id: 'dir-node-home', name: 'home/' },
    { id: 'dir-node-user', name: 'user/' }
  ];

  steps.forEach((s, idx) => {
    setTimeout(() => {
      const el = document.getElementById(s.id);
      if (el) {
        el.classList.add('bg-amber-100', 'text-amber-900', 'font-bold');
        setTimeout(() => {
          el.classList.remove('bg-amber-100', 'text-amber-900', 'font-bold');
        }, 600 / State.speed);
      }
    }, idx * (250 / State.speed));
  });

  // 绘制一条由 Block 6 指向 user/ 目录的橙色虚线
  setTimeout(() => {
    drawSvgCurve(
      'anchor-block-6-left',
      'anchor-dentry-txt',
      '#EA580C',
      'arrow-orange',
      true,
      -0.35,
      false,
      'temp-arrow-element'
    );
  }, 350 / State.speed);
}

/**
 * 绘制断裂红色闪烁虚线
 */
function drawBrokenArrow(fromAnchor, toAnchor) {
  const arrow = drawSvgCurve(
    fromAnchor,
    toAnchor,
    '#DC2626',
    'arrow-red',
    true,
    -0.2,
    false,
    'temp-arrow-element broken-link-alert'
  );
}

/**
 * 流水线 7：删除软链接 report-soft
 */
function setupDeleteSoftLinkPipeline() {
  State.currentBeatIndex = 0;
  State.activePipeline = {
    name: '删除软链接 report-soft',
    beats: [
      // 1. 定位
      () => {
        addLog('节拍 1: 定位软链接', '系统调用 unlink("report-soft")：在目录树中定位该条目。');
        document.getElementById('dentry-report-soft').classList.add('pulse-target-blue');
      },
      // 2. 擦除条目
      () => {
        clearAllHighlights();
        State.files.soft.exists = false;
        renderDirectoryTree();
        updateSvgArrows(false);
        addLog('节拍 2: 移除软链接目录项', '注销 report-soft 映射记录，移除对应箭头。');
      },
      // 3. 释放 Inode 20
      () => {
        State.inodes[20].allocated = false;
        State.inodes[20].nlink = 0;
        State.inodes[20].blockPtr = null;
        renderInodeTable();
        addLog('节拍 3: 释放 Inode 20', '软链接自身引用计数降为 0，释放其独占的 Inode 20。');
      },
      // 4. 释放路径数据块 6
      () => {
        State.blocks[6].type = 'free';
        State.blocks[6].content = '空闲 (Free)';
        renderDiskGrid();
        updateSvgArrows(false);
        inspectBlock(6);
        addLog('节拍 4: 释放路径数据块', '回收存储目标路径的 Block #6，归还为绿色空闲状态。');
      },
      // 5. 总结
      () => {
        addLog('删除软链接完成', '软链接及其自身 Inode 与数据块已彻底回收，对原文件毫无影响。');
        updateButtonStates();
      }
    ]
  };
}

// ============================================================
// 7. 预设经典剧本演练 (Scenario Tours)
// ============================================================

/**
 * 运行全流程演练剧本
 */
function playScenarioTour(tourType) {
  if (State.isPlaying) stopAutoPlay();
  resetToInitialState();

  State.tourRunning = true;
  State.isPlaying = true;
  document.getElementById('play-icon').textContent = '⏸';
  document.getElementById('play-label').textContent = '正在演练';

  if (tourType === 'hard_lifecycle') {
    // 硬链接全生命周期剧本：
    // 1. 创建硬链接
    // 2. 打开硬链接
    // 3. 删除原文件
    // 4. 再次打开硬链接 (验证仍然可访问)
    // 5. 删除最后一个硬链接 (释放 Inode 10 和 Block 5)
    State.tourQueue = [
      () => { switchMode('hard'); setupCreateHardLinkPipeline(); },
      () => { setupOpenFilePipeline('report-hard'); },
      () => { setupDeleteOriginalPipeline(); },
      () => { setupOpenFilePipeline('report-hard'); },
      () => { setupDeleteHardLinkPipeline(); }
    ];
    addLog('剧本启动', '🎬 启动【硬链接全生命周期】连贯演练：创建 &rarr; 打开 &rarr; 删原文件 &rarr; 再次读取 &rarr; 删链接回收。');
  } else if (tourType === 'soft_lifecycle') {
    // 软链接与悬空断链剧本：
    // 1. 创建软链接
    // 2. 打开软链接 (正常逐段解析)
    // 3. 删除原文件 (Inode 10 释放，软链接保留)
    // 4. 再次打开软链接 (触发悬空断裂报错)
    // 5. 删除软链接 (回收 Inode 20 和 Block 6)
    State.tourQueue = [
      () => { switchMode('soft'); setupCreateSoftLinkPipeline(); },
      () => { setupOpenFilePipeline('report-soft'); },
      () => { setupDeleteOriginalPipeline(); },
      () => { setupOpenFilePipeline('report-soft'); },
      () => { setupDeleteSoftLinkPipeline(); }
    ];
    addLog('剧本启动', '🎬 启动【软链接与悬空断链】连贯演练：创建 &rarr; 正常打开 &rarr; 删原文件 &rarr; 悬空断链警报 &rarr; 删除软链接。');
  }

  executeNextTourStep();
}

function executeNextTourStep() {
  if (State.tourQueue.length > 0) {
    const nextSetup = State.tourQueue.shift();
    nextSetup();
    scheduleNextAutoBeat();
  } else {
    State.tourRunning = false;
    stopAutoPlay();
    addLog('剧本完成', '🎉 剧本演练全部顺利完成！');
  }
}

// ============================================================
// 8. 对比模式专属逻辑 (五、对比模式)
// ============================================================

function initComparisonView() {
  runComparisonScenario('create');
}

/**
 * 运行四组对比场景
 */
function runComparisonScenario(scenarioKey) {
  State.comparison.stage = scenarioKey;

  const dentryHard1 = document.getElementById('comp-hard-dentry1');
  const dentryHard2 = document.getElementById('comp-hard-dentry2');
  const nlinkHard = document.getElementById('comp-hard-nlink');
  const hardDataStatus = document.getElementById('comp-hard-data-status');
  const hardAnalysis = document.getElementById('comp-hard-analysis');

  const dentrySoft1 = document.getElementById('comp-soft-dentry1');
  const dentrySoft2 = document.getElementById('comp-soft-dentry2');
  const targetVal = document.getElementById('comp-soft-target-val');
  const targetBadge = document.getElementById('comp-soft-target-badge');
  const softAnalysis = document.getElementById('comp-soft-analysis');

  switch (scenarioKey) {
    case 'create':
      // 1. 创建链接对比
      dentryHard1.className = 'px-2 py-1 rounded bg-white border border-blue-200 text-stone-800 font-semibold';
      dentryHard2.className = 'px-2 py-1 rounded bg-white border border-blue-200 text-blue-700 font-semibold';
      nlinkHard.textContent = '2';
      hardDataStatus.textContent = '正常共享';
      hardDataStatus.className = 'text-[10px] font-semibold text-emerald-600';
      hardAnalysis.innerHTML = `
        <div class="font-bold text-blue-900 flex items-center gap-1"><span>📌 创建阶段：硬链接机制</span></div>
        <p class="text-stone-600 leading-relaxed mt-1">
          <b>不新建 Inode</b>：仅在目录表中新增一条 <code>report-hard &rarr; 10</code> 映射。Inode 10 链接计数从 1 增至 2。零新盘块消耗。
        </p>
      `;

      dentrySoft1.className = 'px-2 py-1 rounded bg-white border border-stone-200 text-stone-800 font-semibold';
      dentrySoft2.className = 'px-2 py-1 rounded bg-white border border-amber-300 text-amber-700 font-semibold';
      targetVal.textContent = 'Inode 10 → Block 5 ("Hello")';
      targetBadge.textContent = '映射就绪';
      targetBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold';
      softAnalysis.innerHTML = `
        <div class="font-bold text-amber-900 flex items-center gap-1"><span>📌 创建阶段：软链接机制</span></div>
        <p class="text-stone-600 leading-relaxed mt-1">
          <b>分配独立 Inode 20 与数据块 6</b>：写入目标路径文本 <code>"/home/user/report.txt"</code>。消耗文件系统元数据与磁盘存储空间。
        </p>
      `;
      addLog('对比模式', '【对比 1：创建链接】硬链接不建 Inode，只加引用计数；软链接新建 Inode 20 与路径数据块 6。');
      break;

    case 'open':
      // 2. 打开访问对比
      hardAnalysis.innerHTML = `
        <div class="font-bold text-emerald-900 flex items-center gap-1"><span>📌 访问阶段：一步直达</span></div>
        <p class="text-stone-600 leading-relaxed mt-1">
          <b>寻址步骤 (1步)</b>：<code>report-hard &rarr; Inode 10 &rarr; Block 5</code>。<br>
          地位与原文件完全平等，没有任何间接重定向惩罚，I/O 速度极快。
        </p>
      `;

      softAnalysis.innerHTML = `
        <div class="font-bold text-amber-900 flex items-center gap-1"><span>📌 访问阶段：逐段间接解析</span></div>
        <p class="text-stone-600 leading-relaxed mt-1">
          <b>寻址步骤 (多步)</b>：<code>report-soft &rarr; Inode 20 &rarr; 读 Block 6 路径 &rarr; 内核由根遍历 /home/user/ &rarr; 定位 report.txt &rarr; Inode 10 &rarr; Block 5</code>。<br>
          存在额外的磁盘寻道与目录检索开销。
        </p>
      `;
      addLog('对比模式', '【对比 2：打开访问】硬链接 1 步直达数据块；软链接需先读路径，再从根逐级解析目录树。');
      break;

    case 'delete_orig':
      // 3. 删除原文件对比
      dentryHard1.className = 'px-2 py-1 rounded bg-stone-100 border border-stone-200 text-stone-400 line-through';
      nlinkHard.textContent = '1';
      hardDataStatus.textContent = '依然正常访问！';
      hardDataStatus.className = 'text-[10px] font-semibold text-emerald-600';
      hardAnalysis.innerHTML = `
        <div class="font-bold text-emerald-900 flex items-center gap-1"><span>📌 删除原文件：硬链接完全无影响</span></div>
        <p class="text-stone-600 leading-relaxed mt-1">
          原文件 <code>report.txt</code> 目录项被删，Inode 10 计数从 2 降为 1。<br>
          <b>因为 i_nlink > 0，数据块 5 不会被释放</b>，硬链接依然可以毫无阻碍地打开读取内容！
        </p>
      `;

      dentrySoft1.className = 'px-2 py-1 rounded bg-stone-100 border border-stone-200 text-stone-400 line-through';
      targetVal.textContent = '❌ 目标不存在 (ENOENT)';
      targetBadge.textContent = '悬空断链 (Dangling)';
      targetBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-bold';
      softAnalysis.innerHTML = `
        <div class="font-bold text-rose-900 flex items-center gap-1"><span>📌 删除原文件：软链接瞬间悬空</span></div>
        <p class="text-stone-600 leading-relaxed mt-1">
          原文件 Inode 10 及其数据块 5 彻底释放。<br>
          <b>软链接自身还在，但其记录的目标路径已成空</b>！再次访问时解析到 report.txt 发生断裂，报 <code>No such file or directory</code>。
        </p>
      `;
      addLog('对比模式', '【对比 3：删除原文件】硬链接计数减 1，数据仍完好；软链接目标消失，沦为「悬空断链」！');
      break;

    case 'delete_link':
      // 4. 删除链接本身对比
      dentryHard2.className = 'px-2 py-1 rounded bg-stone-100 border border-stone-200 text-stone-400 line-through';
      nlinkHard.textContent = '0 (彻底释放)';
      hardDataStatus.textContent = '已回收';
      hardDataStatus.className = 'text-[10px] font-semibold text-stone-400';
      hardAnalysis.innerHTML = `
        <div class="font-bold text-stone-900 flex items-center gap-1"><span>📌 删除硬链接本身</span></div>
        <p class="text-stone-600 leading-relaxed mt-1">
          删除了最后一个硬链接，Inode 10 计数降至 0。文件系统触发物理回收，释放 Inode 10 和数据块 5。
        </p>
      `;

      dentrySoft2.className = 'px-2 py-1 rounded bg-stone-100 border border-stone-200 text-stone-400 line-through';
      targetVal.textContent = 'None';
      targetBadge.textContent = '已销毁';
      targetBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-stone-200 text-stone-600 font-bold';
      softAnalysis.innerHTML = `
        <div class="font-bold text-stone-900 flex items-center gap-1"><span>📌 删除软链接本身</span></div>
        <p class="text-stone-600 leading-relaxed mt-1">
          直接销毁 Inode 20 与 Block 6 路径数据块。对原文件 Inode 10 及其引用计数没有任何微小的影响。
        </p>
      `;
      addLog('对比模式', '【对比 4：删除链接本身】硬链接使原 Inode 计数减 1；软链接销毁自身 Inode 20 与路径块，对原文件毫无影响。');
      break;
  }
}

// ============================================================
// 9. 重置与交互下拉菜单
// ============================================================

/**
 * 重置恢复初始 report.txt 场景
 */
function resetToInitialState() {
  if (State.isPlaying) stopAutoPlay();
  clearAllHighlights();

  // 重置文件状态
  State.files.orig.exists = true;
  State.files.hard.exists = false;
  State.files.soft.exists = false;

  // 重置 Inode 10
  State.inodes[10].allocated = true;
  State.inodes[10].type = 'regular';
  State.inodes[10].nlink = 1;
  State.inodes[10].blockPtr = 5;
  State.inodes[10].fileRef = ['report.txt'];

  // 重置 Inode 20
  State.inodes[20].allocated = false;
  State.inodes[20].nlink = 0;
  State.inodes[20].blockPtr = null;
  State.inodes[20].fileRef = [];

  // 重置磁盘块
  initDiskBlocks();

  // 清除流水线与对比
  State.activePipeline = null;
  State.currentBeatIndex = 0;
  State.tourQueue = [];
  State.tourRunning = false;
  setBeatProgress(1);

  renderAllViews();
  inspectBlock(5);

  addLog('系统重置', '🔄 已重置恢复至初始场景：/home/user/report.txt (inode 10, i_nlink = 1, 数据块 5 内容 "Hello")。');
}

/**
 * 切换打开目标下拉菜单
 */
function toggleOpenMenu() {
  const menu = document.getElementById('open-menu');
  if (!menu) return;
  menu.classList.toggle('hidden');
}

function selectOpenTarget(target) {
  State.openTarget = target;
  const label = document.getElementById('open-target-label');
  if (label) label.textContent = `打开: ${target}`;
  const menu = document.getElementById('open-menu');
  if (menu) menu.classList.add('hidden');
  addLog('目标选择', `已选择打开目标：${target}`);
}

/**
 * 绑定全局 UI 点击事件 (点击空白处收起下拉菜单)
 */
function bindEvents() {
  document.addEventListener('click', (e) => {
    const container = document.getElementById('open-dropdown-container');
    const menu = document.getElementById('open-menu');
    if (container && menu && !container.contains(e.target)) {
      menu.classList.add('hidden');
    }
  });
}

// ============================================================
// 10. 日志系统与辅助工具函数
// ============================================================

/**
 * 增加日志条目
 */
function addLog(action, detail) {
  const container = document.getElementById('log-container');
  if (!container) return;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const row = document.createElement('div');
  row.className = 'flex items-start gap-2 p-1.5 rounded-lg hover:bg-stone-50 transition-colors text-[11px] leading-relaxed';
  row.innerHTML = `
    <span class="text-stone-400 font-mono flex-shrink-0">${timeStr}</span>
    <span class="px-1.5 py-0.2 rounded bg-stone-100 text-stone-800 font-bold border border-stone-200 flex-shrink-0">${action}</span>
    <span class="text-stone-600 flex-1">${detail}</span>
  `;

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;

  const statusTag = document.getElementById('log-status-tag');
  if (statusTag) {
    statusTag.textContent = action;
  }
}

/**
 * 清空日志
 */
function clearLogs() {
  const container = document.getElementById('log-container');
  if (container) container.innerHTML = '';
  addLog('日志已清空', '监控控制台重置完毕。');
}

/**
 * 防抖函数
 */
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
