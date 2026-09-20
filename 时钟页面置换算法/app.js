/**
 * 时钟页面置换算法 (Clock Page Replacement Algorithm)
 * 驻留集 = 4 · 顺时针旋转扫描 · 访问位 (R) 与修改位 (M) 动态翻转与高光突显
 * 严格遵循 408 计算机操作系统考研标准算法
 */

// ================= 全局状态机 =================
const RESIDENT_SET_SIZE = 4;
// 进程被划分的所有逻辑页 (Page 1 ~ Page 8)
const PROCESS_PAGES = [1, 2, 3, 4, 5, 6, 7, 8];

// 驻留集 4 个页框 (Frame 0: 顶部, Frame 1: 右侧, Frame 2: 底部, Frame 3: 左侧)
let frames = [
  { frameId: 0, page: 1, r: 1, m: 0 },
  { frameId: 1, page: 2, r: 1, m: 1 },
  { frameId: 2, page: 3, r: 0, m: 1 },
  { frameId: 3, page: 4, r: 0, m: 0 }
];

// 指针当前指向的 Frame 索引 (0, 1, 2, 3)
let pointerIndex = 0;
// 累积顺时针旋转角度 (确保每次只顺时针向前转，不逆时针倒车)
let cumulativeRotationDeg = 0;

// 算法模式: 'enhanced' (改进型四轮) 或 'basic' (简单单R位)
let algorithmMode = 'enhanced';

// 播放控制
let isPlaying = false;
let playTimer = null;
let animSpeed = 1.0; // 0.5x, 1.0x, 2.0x

// 当前访问请求队列
let requestQueue = [];
let currentQueueIndex = 0;

// 当前正在处理的单步微操作任务队列
let microSteps = [];
let currentMicroStepIndex = 0;
let isBusyAnimating = false;

// 统计数据
let statTotal = 0;
let statHits = 0;
let statFaults = 0;
let statDiskWrites = 0;

// 预设场景定义
const SCENARIOS = {
  1: {
    name: "考研经典混合读写",
    desc: "4个驻留集满，混合读写访问，包含多轮扫描、R位清零与脏页写回",
    initFrames: [
      { frameId: 0, page: 1, r: 1, m: 0 },
      { frameId: 1, page: 2, r: 1, m: 1 },
      { frameId: 2, page: 3, r: 0, m: 1 },
      { frameId: 3, page: 4, r: 0, m: 0 }
    ],
    initPointer: 0,
    requests: [
      { page: 4, op: 'R' }, // 命中 Frame 3, R置1
      { page: 5, op: 'W' }, // 缺页淘汰 (经历两轮，清R，淘汰Frame 1脏页写回)
      { page: 1, op: 'R' }, // 命中或置换
      { page: 6, op: 'R' }, // 缺页淘汰
      { page: 3, op: 'W' }, // 访问
      { page: 7, op: 'R' }, // 缺页淘汰
      { page: 5, op: 'R' }, // 命中
      { page: 8, op: 'W' }  // 缺页淘汰
    ]
  },
  2: {
    name: "一轮速中 (0, 0)",
    desc: "指针顺时针扫描，直接命中第1类最佳淘汰页 (0, 0)，不改标志位直接替换",
    initFrames: [
      { frameId: 0, page: 1, r: 1, m: 1 },
      { frameId: 1, page: 2, r: 0, m: 0 }, // (0,0) 最佳淘汰
      { frameId: 2, page: 3, r: 1, m: 0 },
      { frameId: 3, page: 4, r: 0, m: 1 }
    ],
    initPointer: 0,
    requests: [
      { page: 9, op: 'R' },
      { page: 8, op: 'W' }
    ]
  },
  3: {
    name: "二轮 R 清零淘汰 (0, 1)",
    desc: "第一轮无 (0, 0)，第二轮顺时针将经过的 R: 1→0 视觉爆发，淘汰 (0, 1) 脏页并写回外存",
    initFrames: [
      { frameId: 0, page: 1, r: 1, m: 1 }, // (1, 1)
      { frameId: 1, page: 2, r: 1, m: 0 }, // (1, 0)
      { frameId: 2, page: 3, r: 0, m: 1 }, // (0, 1) -> 第二轮命中！
      { frameId: 3, page: 4, r: 1, m: 1 }  // (1, 1)
    ],
    initPointer: 0,
    requests: [
      { page: 7, op: 'W' }
    ]
  },
  4: {
    name: "四轮极限淘汰",
    desc: "驻留集所有页面均为 (1, 1)，展示算法历经 4 轮严格淘汰判决并全盘位翻转",
    initFrames: [
      { frameId: 0, page: 1, r: 1, m: 1 },
      { frameId: 1, page: 2, r: 1, m: 1 },
      { frameId: 2, page: 3, r: 1, m: 1 },
      { frameId: 3, page: 4, r: 1, m: 1 }
    ],
    initPointer: 0,
    requests: [
      { page: 9, op: 'R' }
    ]
  },
  5: {
    name: "读写命中测试",
    desc: "测试读命中 (R: 0→1) 与写命中 (R: 0→1, M: 0→1)，观察指针不动、位闪烁翻转",
    initFrames: [
      { frameId: 0, page: 1, r: 0, m: 0 },
      { frameId: 1, page: 2, r: 0, m: 0 },
      { frameId: 2, page: 3, r: 1, m: 0 },
      { frameId: 3, page: 4, r: 0, m: 1 }
    ],
    initPointer: 2,
    requests: [
      { page: 1, op: 'R' }, // 读命中 Frame 0，R从0变1
      { page: 2, op: 'W' }, // 写命中 Frame 1，R从0变1，M从0变1
      { page: 3, op: 'W' }  // 写命中 Frame 2，M从0变1
    ]
  }
};

// ================= 初始化与挂载 =================
document.addEventListener('DOMContentLoaded', () => {
  loadScenario(1);
  updateUI();
});

// ================= 场景加载与重置 =================
function loadScenario(scId) {
  stopAutoPlay();
  const sc = SCENARIOS[scId];
  if (!sc) return;

  // 更新预设按钮样式
  [1, 2, 3, 4, 5].forEach(id => {
    const btn = document.getElementById(`pill-sc-${id}`);
    if (btn) {
      if (id === scId) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  // 深拷贝初始化数据
  frames = JSON.parse(JSON.stringify(sc.initFrames));
  pointerIndex = sc.initPointer;
  cumulativeRotationDeg = pointerIndex * 90;
  
  // 初始化队列
  requestQueue = JSON.parse(JSON.stringify(sc.requests));
  currentQueueIndex = 0;
  
  // 清空微操作队列
  microSteps = [];
  currentMicroStepIndex = 0;

  // 重置统计
  statTotal = 0;
  statHits = 0;
  statFaults = 0;
  statDiskWrites = 0;

  // 更新指针旋转动画
  gsap.set('#clock-hand-wrapper', { rotation: cumulativeRotationDeg });

  // 展开当前请求的微操作
  prepareNextRequestSteps();

  // 更新界面
  updateUI();
  updateQueueUI();
  updateInspectorDefault();
  clearHistoryLog();

  document.getElementById('action-narrative').textContent = `已加载【场景 ${scId}：${sc.name}】。${sc.desc}。点击“单步执行”或“自动播放”开始。`;
  document.getElementById('hit-or-fault-badge').textContent = '就绪待命';
  document.getElementById('hit-or-fault-badge').className = 'text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-blue-100 text-blue-800 border border-blue-300';
}

function resetAll() {
  loadScenario(1);
}

// ================= 微操作生成器 (核心算法离散化) =================
function prepareNextRequestSteps() {
  microSteps = [];
  currentMicroStepIndex = 0;

  if (currentQueueIndex >= requestQueue.length) {
    return; // 队列处理完毕
  }

  const req = requestQueue[currentQueueIndex];
  const targetPage = req.page;
  const op = req.op; // 'R' or 'W'

  // 1. 检查是否命中
  const hitIndex = frames.findIndex(f => f.page === targetPage);
  if (hitIndex !== -1) {
    // 命中！
    microSteps.push({
      type: 'HIT_FOUND',
      frameId: hitIndex,
      targetPage: targetPage,
      op: op,
      desc: `请求页面 Page ${targetPage} (${op === 'W' ? '写' : '读'}) 命中驻留集 Frame ${hitIndex}！指针保持原位不动。`
    });

    // 命中后的标志位更新微操作
    microSteps.push({
      type: 'HIT_UPDATE_BITS',
      frameId: hitIndex,
      targetPage: targetPage,
      op: op,
      desc: `更新 Frame ${hitIndex} 标志位：访问位置 1 (R: ${frames[hitIndex].r}→1)${op === 'W' ? '，写访问置修改位 (M: ' + frames[hitIndex].m + '→1)' : ''}。`
    });

    microSteps.push({
      type: 'REQUEST_DONE',
      isHit: true,
      hitFrame: hitIndex,
      targetPage: targetPage,
      op: op,
      desc: `Page ${targetPage} 访问完成 (命中)。`
    });
    return;
  }

  // 2. 缺页！
  microSteps.push({
    type: 'PAGE_FAULT_TRIGGER',
    targetPage: targetPage,
    op: op,
    desc: `请求页面 Page ${targetPage} 未在驻留集中，触发【缺页中断】！启动时钟置换扫描。`
  });

  // 检查是否有空闲页框
  const emptyIndex = frames.findIndex(f => f.page === null || f.page === undefined);
  if (emptyIndex !== -1) {
    // 直接装入空闲页框
    microSteps.push({
      type: 'LOAD_EMPTY_FRAME',
      frameId: emptyIndex,
      targetPage: targetPage,
      op: op,
      desc: `检测到 Frame ${emptyIndex} 为空闲页框，直接调入 Page ${targetPage}，指针顺时针前移。`
    });
    microSteps.push({
      type: 'REQUEST_DONE',
      isHit: false,
      hitFrame: emptyIndex,
      targetPage: targetPage,
      op: op,
      desc: `Page ${targetPage} 调入空闲页框完成。`
    });
    return;
  }

  // 3. 驻留集满，执行时钟置换算法扫描
  if (algorithmMode === 'enhanced') {
    generateEnhancedClockSteps(targetPage, op);
  } else {
    generateBasicClockSteps(targetPage, op);
  }
}

// 改进型时钟置换算法 (Enhanced Clock - 408 核心)
function generateEnhancedClockSteps(targetPage, op) {
  // 模拟执行环境
  let simFrames = JSON.parse(JSON.stringify(frames));
  let curPtr = pointerIndex;
  let victimFrame = -1;
  let scanRound = 1;

  // 循环四轮
  for (let r = 1; r <= 4; r++) {
    scanRound = r;
    let roundFound = false;

    for (let step = 0; step < RESIDENT_SET_SIZE; step++) {
      let fIdx = (curPtr + step) % RESIDENT_SET_SIZE;
      let f = simFrames[fIdx];

      // 顺时针旋转指针指向 fIdx
      microSteps.push({
        type: 'SCAN_INSPECT',
        round: r,
        frameId: fIdx,
        fState: { ...f },
        desc: `【第 ${r} 轮扫描】指针顺时针移动至 Frame ${fIdx} (Page ${f.page})，检查条件: ${getRoundTargetDesc(r)}。`
      });

      if (r === 1) {
        // 第 1 轮：寻找 (0, 0)，不修改任何位
        if (f.r === 0 && f.m === 0) {
          victimFrame = fIdx;
          roundFound = true;
          microSteps.push({
            type: 'VICTIM_FOUND',
            round: 1,
            frameId: fIdx,
            victimPage: f.page,
            fState: { ...f },
            desc: `【命中淘汰页】Frame ${fIdx} 当前为 (0, 0)，符合第 1 轮淘汰条件！选为淘汰页。`
          });
          break;
        } else {
          microSteps.push({
            type: 'ROUND1_SKIP',
            round: 1,
            frameId: fIdx,
            fState: { ...f },
            desc: `Frame ${fIdx} 当前为 (${f.r}, ${f.m}) ≠ (0, 0)，第 1 轮不修改标志位，指针继续前进。`
          });
        }
      } else if (r === 2) {
        // 第 2 轮：寻找 (0, 1)。扫描过程中将所有 R 置 0！
        let origR = f.r;
        let origM = f.m;

        // 关键视觉：如果 R 为 1，则必须将其清零 (R: 1 -> 0)！
        if (origR === 1) {
          f.r = 0; // 模拟更新
          microSteps.push({
            type: 'CLEAR_R_BIT',
            round: 2,
            frameId: fIdx,
            origR: 1,
            newR: 0,
            fState: { ...f },
            desc: `【置换降权】Frame ${fIdx} 的访问位 R 从 1 置为 0！给该页一次留存机会。`
          });
        }

        // 检查原先是否为 (0, 1)
        // 注意 408 标准：第2轮寻找的是原先为 (0, 1) 的页面
        if (origR === 0 && origM === 1) {
          victimFrame = fIdx;
          roundFound = true;
          microSteps.push({
            type: 'VICTIM_FOUND',
            round: 2,
            frameId: fIdx,
            victimPage: f.page,
            fState: { ...f },
            desc: `【命中淘汰页】Frame ${fIdx} 原先为 (0, 1)，符合第 2 轮淘汰条件！选为淘汰页（脏页需写回外存）。`
          });
          break;
        } else {
          microSteps.push({
            type: 'ROUND2_SKIP',
            round: 2,
            frameId: fIdx,
            fState: { ...f },
            desc: `Frame ${fIdx} 原状态为 (${origR}, ${origM}) ≠ (0, 1)，未能中选，指针继续前进。`
          });
        }
      } else if (r === 3) {
        // 第 3 轮：重新寻找 (0, 0)
        if (f.r === 0 && f.m === 0) {
          victimFrame = fIdx;
          roundFound = true;
          microSteps.push({
            type: 'VICTIM_FOUND',
            round: 3,
            frameId: fIdx,
            victimPage: f.page,
            fState: { ...f },
            desc: `【命中淘汰页】Frame ${fIdx} 当前为 (0, 0)（原(1, 0)经第2轮清0变来），符合第 3 轮淘汰条件！`
          });
          break;
        } else {
          microSteps.push({
            type: 'ROUND3_SKIP',
            round: 3,
            frameId: fIdx,
            fState: { ...f },
            desc: `Frame ${fIdx} 当前为 (${f.r}, ${f.m}) ≠ (0, 0)，指针继续前进。`
          });
        }
      } else if (r === 4) {
        // 第 4 轮：寻找 (0, 1)
        if (f.r === 0 && f.m === 1) {
          victimFrame = fIdx;
          roundFound = true;
          microSteps.push({
            type: 'VICTIM_FOUND',
            round: 4,
            frameId: fIdx,
            victimPage: f.page,
            fState: { ...f },
            desc: `【命中淘汰页】Frame ${fIdx} 当前为 (0, 1)（原(1, 1)经第2轮清0变来），第 4 轮兜底淘汰！`
          });
          break;
        }
      }
    }

    if (roundFound) break;
  }

  // 淘汰与换入微操作
  if (victimFrame !== -1) {
    let victimObj = frames[victimFrame];
    let isDirty = victimObj.m === 1;

    microSteps.push({
      type: 'EVICT_PAGE',
      frameId: victimFrame,
      victimPage: victimObj.page,
      isDirty: isDirty,
      desc: `淘汰 Frame ${victimFrame} 中的 Page ${victimObj.page}。${isDirty ? '【脏页 M=1】必须写回外存磁盘！' : '【干净页 M=0】无需写回外存，直接覆盖。'}`
    });

    microSteps.push({
      type: 'LOAD_NEW_PAGE',
      frameId: victimFrame,
      targetPage: targetPage,
      op: op,
      desc: `将新页面 Page ${targetPage} 装入 Frame ${victimFrame}，置访问位 R=1${op === 'W' ? '，修改位 M=1' : '，修改位 M=0'}。`
    });

    // 指针前进一位
    let nextPointer = (victimFrame + 1) % RESIDENT_SET_SIZE;
    microSteps.push({
      type: 'ADVANCE_POINTER',
      newPointer: nextPointer,
      desc: `指针顺时针前进至下一个页框 Frame ${nextPointer}。置换流程结束。`
    });

    microSteps.push({
      type: 'REQUEST_DONE',
      isHit: false,
      victimFrame: victimFrame,
      victimPage: victimObj.page,
      targetPage: targetPage,
      op: op,
      isDirty: isDirty,
      scanRound: scanRound,
      desc: `Page ${targetPage} 置换调入完成。`
    });
  }
}

// 简单时钟置换算法 (Basic Clock)
function generateBasicClockSteps(targetPage, op) {
  let simFrames = JSON.parse(JSON.stringify(frames));
  let curPtr = pointerIndex;
  let victimFrame = -1;

  for (let step = 0; step < RESIDENT_SET_SIZE * 2; step++) {
    let fIdx = (curPtr + step) % RESIDENT_SET_SIZE;
    let f = simFrames[fIdx];

    microSteps.push({
      type: 'SCAN_INSPECT',
      round: 1,
      frameId: fIdx,
      fState: { ...f },
      desc: `【简单Clock】指针检查 Frame ${fIdx} (Page ${f.page})，检查 R 位。`
    });

    if (f.r === 0) {
      victimFrame = fIdx;
      microSteps.push({
        type: 'VICTIM_FOUND',
        round: 1,
        frameId: fIdx,
        victimPage: f.page,
        fState: { ...f },
        desc: `Frame ${fIdx} 的 R=0，选为淘汰页！`
      });
      break;
    } else {
      f.r = 0;
      microSteps.push({
        type: 'CLEAR_R_BIT',
        round: 1,
        frameId: fIdx,
        origR: 1,
        newR: 0,
        fState: { ...f },
        desc: `Frame ${fIdx} 的 R=1，将其置为 0 (R: 1→0)，指针顺时针前进。`
      });
    }
  }

  if (victimFrame !== -1) {
    let victimObj = frames[victimFrame];
    let isDirty = victimObj.m === 1;

    microSteps.push({
      type: 'EVICT_PAGE',
      frameId: victimFrame,
      victimPage: victimObj.page,
      isDirty: isDirty,
      desc: `淘汰 Frame ${victimFrame} 中的 Page ${victimObj.page}。`
    });

    microSteps.push({
      type: 'LOAD_NEW_PAGE',
      frameId: victimFrame,
      targetPage: targetPage,
      op: op,
      desc: `装入 Page ${targetPage}，置 R=1。`
    });

    let nextPointer = (victimFrame + 1) % RESIDENT_SET_SIZE;
    microSteps.push({
      type: 'ADVANCE_POINTER',
      newPointer: nextPointer,
      desc: `指针顺时针前进至 Frame ${nextPointer}。`
    });

    microSteps.push({
      type: 'REQUEST_DONE',
      isHit: false,
      victimFrame: victimFrame,
      victimPage: victimObj.page,
      targetPage: targetPage,
      op: op,
      isDirty: isDirty,
      scanRound: 1,
      desc: `Page ${targetPage} 调入完成。`
    });
  }
}

function getRoundTargetDesc(r) {
  if (r === 1) return '第 1 轮寻找 (0, 0) [不改位]';
  if (r === 2) return '第 2 轮寻找 (0, 1) [并清零 R 位]';
  if (r === 3) return '第 3 轮寻找 (0, 0) [必能找到]';
  if (r === 4) return '第 4 轮寻找 (0, 1)';
  return '';
}

// ================= 单步执行引擎 (Step Execution Engine) =================
function stepForward() {
  if (isBusyAnimating) return;

  // 如果当前微操作完成，尝试准备下一个请求
  if (currentMicroStepIndex >= microSteps.length) {
    if (currentQueueIndex < requestQueue.length - 1) {
      currentQueueIndex++;
      prepareNextRequestSteps();
      updateQueueUI();
    } else {
      // 队列已全部执行完毕
      document.getElementById('action-narrative').textContent = '所有访问序列已执行完毕！可选择其他预设或手动发起访问。';
      stopAutoPlay();
      return;
    }
  }

  const step = microSteps[currentMicroStepIndex];
  executeMicroStep(step);
}

// 执行具体的微操作
function executeMicroStep(step) {
  isBusyAnimating = true;
  const duration = 0.4 / animSpeed;

  document.getElementById('action-narrative').textContent = step.desc;

  switch (step.type) {
    case 'HIT_FOUND':
      handleStepHitFound(step, duration);
      break;

    case 'HIT_UPDATE_BITS':
      handleStepHitUpdateBits(step, duration);
      break;

    case 'PAGE_FAULT_TRIGGER':
      handleStepPageFault(step, duration);
      break;

    case 'LOAD_EMPTY_FRAME':
      handleStepLoadEmpty(step, duration);
      break;

    case 'SCAN_INSPECT':
      handleStepScanInspect(step, duration);
      break;

    case 'CLEAR_R_BIT':
      handleStepClearRBit(step, duration);
      break;

    case 'ROUND1_SKIP':
    case 'ROUND2_SKIP':
    case 'ROUND3_SKIP':
      handleStepSkip(step, duration);
      break;

    case 'VICTIM_FOUND':
      handleStepVictimFound(step, duration);
      break;

    case 'EVICT_PAGE':
      handleStepEvictPage(step, duration);
      break;

    case 'LOAD_NEW_PAGE':
      handleStepLoadNewPage(step, duration);
      break;

    case 'ADVANCE_POINTER':
      handleStepAdvancePointer(step, duration);
      break;

    case 'REQUEST_DONE':
      handleStepRequestDone(step, duration);
      break;

    default:
      finishStep();
  }
}

function finishStep() {
  currentMicroStepIndex++;
  isBusyAnimating = false;
  updateUI();
}

// ================= 各微操作的具体动效与逻辑 =================

// 1. 命中
function handleStepHitFound(step, duration) {
  const card = document.getElementById(`frame-card-${step.frameId}`);
  gsap.fromTo(card, { scale: 1 }, {
    scale: 1.08,
    borderColor: '#10B981',
    boxShadow: '0 0 20px rgba(16, 185, 129, 0.4)',
    duration: duration,
    yoyo: true,
    repeat: 1,
    onComplete: () => finishStep()
  });

  document.getElementById('hit-or-fault-badge').textContent = '页面命中 HIT';
  document.getElementById('hit-or-fault-badge').className = 'text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-emerald-100 text-emerald-800 border border-emerald-300';
  updateInspectorForFrame(step.frameId);
}

// 2. 命中更新位
function handleStepHitUpdateBits(step, duration) {
  const f = frames[step.frameId];
  const oldR = f.r;
  const oldM = f.m;
  f.r = 1;

  if (oldR === 0) {
    triggerBitFlipAnimation(step.frameId, 'R', 0, 1);
    spawnFloatingToast(step.frameId, 'R: 0 → 1 (访问位置1)', 'toast-set-r');
  }

  // 若执行写操作且原来是干净页 (M=0)，上方进程写操作页高亮，随后修改位 0→1
  if (step.op === 'W' && oldM === 0 && algorithmMode === 'enhanced') {
    const srcPageEl = document.getElementById(`process-page-${step.targetPage}`);
    if (srcPageEl) srcPageEl.classList.add('is-writing-active');
    document.getElementById('action-narrative').textContent = `命中页框 ${step.frameId}！CPU 正在对上方进程的 Page ${step.targetPage} 执行写操作 (Write)...`;

    gsap.delayedCall(0.5 / animSpeed, () => {
      if (srcPageEl) srcPageEl.classList.remove('is-writing-active');
      f.m = 1;
      triggerBitFlipAnimation(step.frameId, 'M', 0, 1);
      spawnFloatingToast(step.frameId, 'M: 0 → 1 (写脏Dirty🔥)', 'toast-set-m');
      updateUI();
      updateInspectorBitChange(oldR, f.r, 0, 1);
      document.getElementById('action-narrative').textContent = `写操作完成！驻留集页框 ${step.frameId} 修改位由 0 变 1 (M: 0→1，标记为脏页)。`;
      gsap.delayedCall(0.35 / animSpeed, () => finishStep());
    });
  } else {
    updateUI();
    updateInspectorBitChange(oldR, f.r, oldM, f.m);
    gsap.delayedCall(duration, () => finishStep());
  }
}

// 3. 缺页触发
function handleStepPageFault(step, duration) {
  document.getElementById('hit-or-fault-badge').textContent = '缺页中断 FAULT';
  document.getElementById('hit-or-fault-badge').className = 'text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-red-100 text-red-800 border border-red-300 animate-pulse';

  gsap.delayedCall(duration, () => finishStep());
}

// 4. 装入空闲页框 (平滑飞入并在写操作时依次触发高亮与 M: 0→1)
function handleStepLoadEmpty(step, duration) {
  const f = frames[step.frameId];
  const targetCard = document.getElementById(`frame-card-${step.frameId}`);
  const sourcePageEl = document.getElementById(`process-page-${step.targetPage}`);

  // 获取起始坐标与目标坐标
  const startRect = sourcePageEl ? sourcePageEl.getBoundingClientRect() : { left: window.innerWidth / 2, top: 100 };
  const targetRect = targetCard.getBoundingClientRect();

  // 创建平滑飞入元素
  const flyingEl = document.createElement('div');
  flyingEl.className = 'flying-page-card';
  flyingEl.innerHTML = `<span>调入 Page ${step.targetPage}</span><span class="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">装入空闲页框 ${step.frameId}</span>`;
  flyingEl.style.left = `${startRect.left}px`;
  flyingEl.style.top = `${startRect.top}px`;
  document.body.appendChild(flyingEl);

  const flyDuration = Math.max(duration * 1.6, 0.65);
  gsap.to(flyingEl, {
    x: (targetRect.left + targetRect.width / 2) - (startRect.left + 50),
    y: (targetRect.top + targetRect.height / 2) - (startRect.top + 20),
    scale: 1.05,
    duration: flyDuration,
    ease: 'power2.inOut',
    onComplete: () => {
      flyingEl.remove();

      // 落地：先装入页面，置 R=1，初态 M=0 (刚从外存读入内存)
      f.page = step.targetPage;
      f.r = 1;
      f.m = 0;

      gsap.fromTo(targetCard, { scale: 1.12, borderColor: '#2563EB' }, {
        scale: 1,
        borderColor: '#E5E4DC',
        duration: 0.35,
        ease: 'power2.out'
      });

      triggerBitFlipAnimation(step.frameId, 'R', 0, 1);
      spawnFloatingToast(step.frameId, `页框 ${step.frameId} 恒定 · 装入 P${step.targetPage}`, 'toast-set-r');
      updateUI();
      updateInspectorForFrame(step.frameId);

      // 若为写操作且处于改进型模式，紧接着触发：上方写操作页高亮 -> 修改位 0变1
      if (step.op === 'W' && algorithmMode === 'enhanced') {
        const srcPageEl = document.getElementById(`process-page-${step.targetPage}`);
        if (srcPageEl) srcPageEl.classList.add('is-writing-active');
        document.getElementById('action-narrative').textContent = `Page ${step.targetPage} 已调入页框 ${step.frameId}。CPU 正在对上方进程的 Page ${step.targetPage} 执行写操作 (Write)...`;

        gsap.delayedCall(0.55 / animSpeed, () => {
          if (srcPageEl) srcPageEl.classList.remove('is-writing-active');
          f.m = 1;
          triggerBitFlipAnimation(step.frameId, 'M', 0, 1);
          spawnFloatingToast(step.frameId, 'M: 0 → 1 (写脏Dirty🔥)', 'toast-set-m');
          updateUI();
          updateInspectorBitChange(f.r, f.r, 0, 1);
          document.getElementById('action-narrative').textContent = `写操作完成！驻留集页框 ${step.frameId} 的修改位由 0 变 1 (M: 0→1，标记为脏页)。`;
          gsap.delayedCall(0.35 / animSpeed, () => finishStep());
        });
      } else {
        finishStep();
      }
    }
  });
}

// 5. 顺时针扫描检查某页框
function handleStepScanInspect(step, duration) {
  // 更新轮次指示器
  updateRoundIndicators(step.round);

  // 顺时针平滑旋转指针到目标页框
  rotatePointerTo(step.frameId, duration, () => {
    // 聚焦该页框
    highlightPointingFrame(step.frameId);
    // 显微镜实时联动
    updateInspectorForFrame(step.frameId);
    finishStep();
  });
}

// 6. 核心考点视觉：R 位从 1 清零 (R: 1 -> 0)
function handleStepClearRBit(step, duration) {
  const f = frames[step.frameId];
  f.r = 0; // 清零

  // 1. 3D 翻牌动画
  triggerBitFlipAnimation(step.frameId, 'R', 1, 0);

  // 2. 气泡爆发 Toast
  spawnFloatingToast(step.frameId, 'R: 1 → 0 (降权清零)', 'toast-clear-r');

  // 3. 显微镜视窗超大动态对比
  updateInspectorBitChange(1, 0, f.m, f.m);

  // 4. 扇区卡片微震颤
  const card = document.getElementById(`frame-card-${step.frameId}`);
  gsap.fromTo(card, { x: -3 }, { x: 3, duration: 0.05, repeat: 4, yoyo: true, onComplete: () => {
    gsap.set(card, { x: 0 });
    gsap.delayedCall(duration * 0.5, () => finishStep());
  }});
}

// 7. 跳过不匹配
function handleStepSkip(step, duration) {
  gsap.delayedCall(duration * 0.4, () => finishStep());
}

// 8. 找到淘汰页
function handleStepVictimFound(step, duration) {
  const card = document.getElementById(`frame-card-${step.frameId}`);
  card.classList.add('is-victim');

  spawnFloatingToast(step.frameId, `选定淘汰 Page ${step.victimPage}!`, 'toast-clear-r');

  gsap.delayedCall(duration * 0.8, () => finishStep());
}

// 9. 淘汰旧页并处理磁盘 I/O (平滑飞出外存移动动画)
function handleStepEvictPage(step, duration) {
  const card = document.getElementById(`frame-card-${step.frameId}`);
  card.classList.remove('is-victim');

  // 创建淘汰页飞出动效 (而非瞬间消失)
  const diskBox = document.getElementById('disk-io-box');
  const startRect = card.getBoundingClientRect();
  const endRect = diskBox ? diskBox.getBoundingClientRect() : { left: window.innerWidth - 100, top: window.innerHeight - 100 };

  const evictEl = document.createElement('div');
  evictEl.className = 'evicting-page-card';
  evictEl.innerHTML = `<span>淘汰 P${step.victimPage} (离开页框 ${step.frameId})</span><span class="text-[10px] ${step.isDirty ? 'text-amber-600 font-bold' : 'text-stone-500'}">${step.isDirty ? '🔥写回磁盘' : '覆盖'}</span>`;
  evictEl.style.left = `${startRect.left + 5}px`;
  evictEl.style.top = `${startRect.top + 5}px`;
  document.body.appendChild(evictEl);

  const evictDuration = Math.max(duration * 1.5, 0.6);
  gsap.to(evictEl, {
    x: (endRect.left + endRect.width / 2) - (startRect.left + 50),
    y: (endRect.top + endRect.height / 2) - (startRect.top + 20),
    scale: 0.7,
    opacity: 0.15,
    duration: evictDuration,
    ease: 'power2.in',
    onComplete: () => evictEl.remove()
  });

  if (step.isDirty) {
    // 脏页必须写回外存！
    statDiskWrites++;
    document.getElementById('disk-write-badge').textContent = `${statDiskWrites} 次写回`;
    document.getElementById('disk-io-title').textContent = `外存 I/O: 正在写回 Page ${step.victimPage}`;
    document.getElementById('disk-io-desc').textContent = `修改位 M=1 为脏页，已向磁盘写入脏块`;
    document.getElementById('disk-io-box').className = 'p-2.5 rounded-lg bg-amber-50 border border-amber-300 flex items-center justify-between text-xs font-mono animate-pulse';

    spawnFloatingToast(step.frameId, `🔥 脏页写回外存磁盘!`, 'toast-set-m');
  } else {
    document.getElementById('disk-io-title').textContent = `外存 I/O: 覆盖 Page ${step.victimPage}`;
    document.getElementById('disk-io-desc').textContent = `修改位 M=0 为干净页，无需写回外存`;
    document.getElementById('disk-io-box').className = 'p-2.5 rounded-lg bg-stone-50 border border-stone-200 flex items-center justify-between text-xs font-mono';
  }

  gsap.delayedCall(duration, () => finishStep());
}

// 10. 调入新页 (从上方逻辑页平滑飞入目标页框，强化页框号不变概念)
function handleStepLoadNewPage(step, duration) {
  const f = frames[step.frameId];
  const targetCard = document.getElementById(`frame-card-${step.frameId}`);
  const sourcePageEl = document.getElementById(`process-page-${step.targetPage}`);

  // 获取起始坐标与目标坐标
  const startRect = sourcePageEl ? sourcePageEl.getBoundingClientRect() : { left: window.innerWidth / 2, top: 100 };
  const targetRect = targetCard.getBoundingClientRect();

  // 创建平滑飞入卡片
  const flyingEl = document.createElement('div');
  flyingEl.className = 'flying-page-card';
  flyingEl.innerHTML = `<span>调入 Page ${step.targetPage}</span><span class="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200 font-bold">装入页框 ${step.frameId} (页框号保持恒定)</span>`;
  flyingEl.style.left = `${startRect.left}px`;
  flyingEl.style.top = `${startRect.top}px`;
  document.body.appendChild(flyingEl);

  const flyDuration = Math.max(duration * 1.8, 0.75);
  gsap.to(flyingEl, {
    x: (targetRect.left + targetRect.width / 2) - (startRect.left + 50),
    y: (targetRect.top + targetRect.height / 2) - (startRect.top + 20),
    scale: 1.05,
    duration: flyDuration,
    ease: 'power2.inOut',
    onComplete: () => {
      flyingEl.remove();

      // 落地：更新驻留集数据 (注意：页框号 frameId 永远不变，改变的只是装入的 page 属性)
      // 先将页面调入内存，置 R=1，初态 M=0 (刚从外存调入，尚未执行写入)
      f.page = step.targetPage;
      f.r = 1;
      f.m = 0;

      // 落地冲击波涟漪
      gsap.fromTo(targetCard, { scale: 1.15, borderColor: '#2563EB' }, {
        scale: 1,
        borderColor: '#E5E4DC',
        duration: 0.35,
        ease: 'power2.out'
      });

      // 触发标志位翻牌动画 R: 0 -> 1
      triggerBitFlipAnimation(step.frameId, 'R', 0, 1);
      spawnFloatingToast(step.frameId, `页框 ${step.frameId} 不变 · 装入 P${step.targetPage}`, 'toast-set-r');

      updateUI();
      updateInspectorForFrame(step.frameId);

      // 若为写操作且处于改进型模式：先让上方进程写操作页高亮一下，接着修改位从0变1
      if (step.op === 'W' && algorithmMode === 'enhanced') {
        const srcPageEl = document.getElementById(`process-page-${step.targetPage}`);
        if (srcPageEl) srcPageEl.classList.add('is-writing-active');
        document.getElementById('action-narrative').textContent = `Page ${step.targetPage} 已调入页框 ${step.frameId}。CPU 正在对上方进程的 Page ${step.targetPage} 执行写操作 (Write)...`;

        gsap.delayedCall(0.55 / animSpeed, () => {
          if (srcPageEl) srcPageEl.classList.remove('is-writing-active');
          f.m = 1;
          triggerBitFlipAnimation(step.frameId, 'M', 0, 1);
          spawnFloatingToast(step.frameId, 'M: 0 → 1 (写脏Dirty🔥)', 'toast-set-m');
          updateUI();
          updateInspectorBitChange(f.r, f.r, 0, 1);
          document.getElementById('action-narrative').textContent = `写操作完成！驻留集页框 ${step.frameId} 的修改位由 0 变 1 (M: 0→1，标记为脏页)。`;
          gsap.delayedCall(0.35 / animSpeed, () => finishStep());
        });
      } else {
        finishStep();
      }
    }
  });
}

// 11. 指针前进一位
function handleStepAdvancePointer(step, duration) {
  rotatePointerTo(step.newPointer, duration, () => {
    pointerIndex = step.newPointer;
    highlightPointingFrame(pointerIndex);
    finishStep();
  });
}

// 12. 请求完成，记录日志
function handleStepRequestDone(step, duration) {
  statTotal++;
  if (step.isHit) {
    statHits++;
  } else {
    statFaults++;
  }
  updateStats();

  // 添加到历史流水表格
  appendHistoryLogRow(step);

  // 恢复磁盘状态
  setTimeout(() => {
    document.getElementById('disk-io-title').textContent = `外存磁盘 I/O: 空闲`;
    document.getElementById('disk-io-desc').textContent = `等待下一次置换`;
    document.getElementById('disk-io-box').className = 'p-2.5 rounded-lg bg-stone-50 border border-stone-200 flex items-center justify-between text-xs font-mono';
  }, 1000);

  // 清除轮次高亮
  updateRoundIndicators(0);

  finishStep();
}

// ================= 指针旋转与扇区高亮 =================
function rotatePointerTo(targetFrameId, duration, onComplete) {
  // 计算顺时针增量角度
  const currentMod = ((cumulativeRotationDeg % 360) + 360) % 360;
  const targetDeg = targetFrameId * 90;
  
  let diff = targetDeg - currentMod;
  if (diff < 0) {
    diff += 360; // 强制顺时针旋转！
  }
  if (diff === 0 && duration > 0.05) {
    // 保持轻微旋转感或原地不动
  }

  cumulativeRotationDeg += diff;
  pointerIndex = targetFrameId;

  gsap.to('#clock-hand-wrapper', {
    rotation: cumulativeRotationDeg,
    duration: duration,
    ease: 'power2.out',
    onComplete: onComplete
  });

  document.getElementById('current-scan-badge').textContent = `指针当前指向: Frame ${targetFrameId}`;
}

function highlightPointingFrame(frameId) {
  for (let i = 0; i < RESIDENT_SET_SIZE; i++) {
    const card = document.getElementById(`frame-card-${i}`);
    if (i === frameId) {
      card.classList.add('is-pointing');
    } else {
      card.classList.remove('is-pointing');
    }
  }
}

// ================= 位动画与浮动气泡特效 =================
function triggerBitFlipAnimation(frameId, bitType, oldVal, newVal) {
  const elId = bitType === 'R' ? `bit-r-${frameId}` : `bit-m-${frameId}`;
  const el = document.getElementById(elId);
  if (!el) return;

  if (oldVal === 1 && newVal === 0) {
    el.classList.add('bit-flip-clear');
    setTimeout(() => el.classList.remove('bit-flip-clear'), 600);
  } else {
    el.classList.add('bit-flip-set');
    setTimeout(() => el.classList.remove('bit-flip-set'), 600);
  }
}

function spawnFloatingToast(frameId, text, toastClass) {
  const card = document.getElementById(`frame-card-${frameId}`);
  if (!card) return;

  const rect = card.getBoundingClientRect();
  const toast = document.createElement('div');
  toast.className = `bit-float-toast ${toastClass}`;
  toast.textContent = text;
  toast.style.left = `${rect.left + rect.width / 2}px`;
  toast.style.top = `${rect.top}px`;
  toast.style.transform = 'translate(-50%, -50%)';

  document.getElementById('toast-layer').appendChild(toast);

  gsap.to(toast, {
    y: -32,
    opacity: 0,
    duration: 1.2 / animSpeed,
    ease: 'power2.out',
    onComplete: () => toast.remove()
  });
}

// ================= 显微镜实时更新 =================
function updateInspectorForFrame(frameId) {
  const f = frames[frameId];
  if (!f) return;

  document.getElementById('inspector-target-frame').textContent = `当前检测: Frame ${frameId}`;

  // R 位
  const rValEl = document.getElementById('inspector-r-val');
  const rTagEl = document.getElementById('inspector-r-tag');
  rValEl.textContent = f.r;
  if (f.r === 1) {
    rValEl.className = 'inspector-bit-val text-emerald-600';
    rTagEl.textContent = '已访问';
    rTagEl.className = 'text-[10px] px-1 rounded bg-emerald-100 text-emerald-700 font-bold';
    document.getElementById('inspector-box-r').style.borderColor = '#A7F3D0';
    document.getElementById('inspector-box-r').style.backgroundColor = '#ECFDF5';
  } else {
    rValEl.className = 'inspector-bit-val text-stone-500';
    rTagEl.textContent = '未访问';
    rTagEl.className = 'text-[10px] px-1 rounded bg-stone-200 text-stone-600 font-bold';
    document.getElementById('inspector-box-r').style.borderColor = '#E5E4DC';
    document.getElementById('inspector-box-r').style.backgroundColor = '#FAFAF9';
  }

  // M 位
  const mValEl = document.getElementById('inspector-m-val');
  const mTagEl = document.getElementById('inspector-m-tag');
  mValEl.textContent = f.m;
  if (f.m === 1) {
    mValEl.className = 'inspector-bit-val text-amber-600';
    mTagEl.textContent = '脏页(需写回)';
    mTagEl.className = 'text-[10px] px-1 rounded bg-amber-100 text-amber-700 font-bold';
    document.getElementById('inspector-box-m').style.borderColor = '#FED7AA';
    document.getElementById('inspector-box-m').style.backgroundColor = '#FFF7ED';
  } else {
    mValEl.className = 'inspector-bit-val text-stone-500';
    mTagEl.textContent = '干净';
    mTagEl.className = 'text-[10px] px-1 rounded bg-stone-200 text-stone-600 font-bold';
    document.getElementById('inspector-box-m').style.borderColor = '#E5E4DC';
    document.getElementById('inspector-box-m').style.backgroundColor = '#FAFAF9';
  }

  // 隐藏对比
  document.getElementById('inspector-r-prev').classList.add('hidden');
  document.getElementById('inspector-m-prev').classList.add('hidden');
}

function updateInspectorBitChange(oldR, newR, oldM, newM) {
  if (oldR !== newR) {
    const prevEl = document.getElementById('inspector-r-prev');
    prevEl.textContent = oldR;
    prevEl.classList.remove('hidden');

    const valEl = document.getElementById('inspector-r-val');
    valEl.textContent = newR;
    gsap.fromTo(valEl, { scale: 1.6 }, { scale: 1, duration: 0.4 });
  }

  if (oldM !== newM) {
    const prevEl = document.getElementById('inspector-m-prev');
    prevEl.textContent = oldM;
    prevEl.classList.remove('hidden');

    const valEl = document.getElementById('inspector-m-val');
    valEl.textContent = newM;
    gsap.fromTo(valEl, { scale: 1.6 }, { scale: 1, duration: 0.4 });
  }
}

function updateInspectorDefault() {
  updateInspectorForFrame(pointerIndex);
}

// 轮次高亮更新
function updateRoundIndicators(activeRound) {
  const textMap = {
    0: '空闲',
    1: '第 1 轮扫描中',
    2: '第 2 轮扫描中',
    3: '第 3 轮扫描中',
    4: '第 4 轮扫描中'
  };
  document.getElementById('current-round-indicator').textContent = textMap[activeRound] || '进行中';

  for (let r = 1; r <= 4; r++) {
    const card = document.getElementById(`round-card-${r}`);
    if (!card) continue;
    if (r === activeRound) {
      card.className = 'round-step-badge current flex flex-col gap-1';
    } else if (r < activeRound) {
      card.className = 'round-step-badge done flex flex-col gap-1';
    } else {
      card.className = 'round-step-badge flex flex-col gap-1';
    }
  }
}

// 渲染上方进程所有逻辑页地图
function renderProcessPages() {
  const container = document.getElementById('process-pages-container');
  if (!container) return;
  container.innerHTML = '';

  const currentReq = requestQueue[currentQueueIndex];
  const targetPage = currentReq ? currentReq.page : null;

  PROCESS_PAGES.forEach(p => {
    const frameIdx = frames.findIndex(f => f.page === p);
    const inMem = frameIdx !== -1;
    const isTarget = p === targetPage;

    const card = document.createElement('div');
    card.id = `process-page-${p}`;
    card.className = `process-page-card ${inMem ? 'in-memory' : 'in-disk'} ${isTarget ? 'is-request-target' : ''}`;
    card.title = `点击直接发起对 Page ${p} 的访问`;
    card.onclick = () => {
      document.getElementById('input-page-id').value = p;
      handleManualAccess();
    };

    card.innerHTML = `
      <div class="flex items-center justify-between w-full">
        <span class="text-[11px] font-bold ${inMem ? 'text-emerald-800' : 'text-stone-700'}">P${p}</span>
        <span class="text-[9px] ${inMem ? 'text-emerald-600 font-bold' : 'text-stone-400'}">${inMem ? '●在内存' : '○外存'}</span>
      </div>
      <div class="w-full flex items-center justify-center">
        <span class="text-[9px] font-mono px-1 py-0.2 rounded whitespace-nowrap ${inMem ? 'bg-purple-100 text-purple-800 font-bold border border-purple-200' : 'bg-stone-100 text-stone-500 border border-dashed border-stone-300'}">
          ${inMem ? '页框 ' + frameIdx : '未调入'}
        </span>
      </div>
    `;

    container.appendChild(card);
  });
}

// ================= UI 与数据渲染 =================
function updateUI() {
  // 渲染上方进程所有页
  renderProcessPages();

  // 渲染 4 个 Frame
  frames.forEach(f => {
    const pageEl = document.getElementById(`frame-page-${f.frameId}`);
    const rEl = document.getElementById(`bit-r-${f.frameId}`);
    const mEl = document.getElementById(`bit-m-${f.frameId}`);
    const classEl = document.getElementById(`frame-class-${f.frameId}`);

    if (f.page !== null && f.page !== undefined) {
      pageEl.textContent = `Page ${f.page}`;
    } else {
      pageEl.textContent = `[空闲]`;
    }

    // R 位
    rEl.textContent = f.r;
    rEl.className = f.r === 1 ? 'bit-badge bit-r-1' : 'bit-badge bit-r-0';

    // M 位 (仅在改进型模式下展示)
    if (algorithmMode === 'enhanced') {
      mEl.textContent = f.m;
      mEl.className = f.m === 1 ? 'bit-badge bit-m-1' : 'bit-badge bit-m-0';

      // 改进型 (R, M) 分类标签
      classEl.textContent = `(${f.r},${f.m})`;
      if (f.r === 0 && f.m === 0) {
        classEl.className = 'text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-1 rounded border border-emerald-200';
        classEl.title = '第1类: (0,0) 最佳淘汰';
      } else if (f.r === 0 && f.m === 1) {
        classEl.className = 'text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-1 rounded border border-amber-200';
        classEl.title = '第2类: (0,1) 次佳·淘汰需写回';
      } else if (f.r === 1 && f.m === 0) {
        classEl.className = 'text-[10px] font-mono font-semibold text-blue-700 bg-blue-50 px-1 rounded border border-blue-200';
        classEl.title = '第3类: (1,0) 已访问';
      } else {
        classEl.className = 'text-[10px] font-mono font-semibold text-purple-700 bg-purple-50 px-1 rounded border border-purple-200';
        classEl.title = '第4类: (1,1) 已访问且已修改';
      }
    } else {
      // 简单 Clock 模式：只展示 R 位
      if (f.r === 0) {
        classEl.textContent = 'R=0 淘汰候选';
        classEl.className = 'text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-1 rounded border border-emerald-200';
        classEl.title = '简单Clock: 遇R=0立即淘汰';
      } else {
        classEl.textContent = 'R=1 最近访问';
        classEl.className = 'text-[10px] font-mono font-semibold text-blue-700 bg-blue-50 px-1 rounded border border-blue-200';
        classEl.title = '简单Clock: 遇R=1将置0并前进';
      }
    }
  });

  highlightPointingFrame(pointerIndex);
}

// 渲染访问序列胶囊
function updateQueueUI() {
  const container = document.getElementById('request-queue-container');
  container.innerHTML = '';

  document.getElementById('queue-progress-badge').textContent = `${currentQueueIndex} / ${requestQueue.length}`;

  requestQueue.forEach((req, idx) => {
    const pill = document.createElement('div');
    pill.className = `queue-pill ${idx === currentQueueIndex ? 'current-active' : ''} ${idx < currentQueueIndex ? 'processed' : ''}`;
    pill.onclick = () => {
      // 点击跳转执行到该位置
      if (idx > currentQueueIndex && !isPlaying) {
        stepForward();
      }
    };

    const pageSpan = document.createElement('span');
    pageSpan.className = 'text-xs font-bold text-stone-900';
    pageSpan.textContent = `P${req.page}`;

    const opSpan = document.createElement('span');
    if (algorithmMode === 'basic') {
      opSpan.className = 'text-[9px] font-bold text-purple-600';
      opSpan.textContent = '访问 (R)';
    } else {
      opSpan.className = `text-[9px] font-bold ${req.op === 'W' ? 'text-amber-600' : 'text-blue-600'}`;
      opSpan.textContent = req.op === 'W' ? '写 (W)' : '读 (R)';
    }

    pill.appendChild(pageSpan);
    pill.appendChild(opSpan);
    container.appendChild(pill);
  });
}

// 统计数据
function updateStats() {
  document.getElementById('stat-total').textContent = statTotal;
  document.getElementById('stat-hits').textContent = statHits;
  document.getElementById('stat-faults').textContent = statFaults;
  const rate = statTotal > 0 ? ((statHits / statTotal) * 100).toFixed(1) : '0.0';
  document.getElementById('stat-rate').textContent = `${rate}%`;
}

// 历史日志表格
function appendHistoryLogRow(step) {
  const tbody = document.getElementById('history-log-tbody');
  const tr = document.createElement('tr');
  tr.className = 'hover:bg-stone-50 transition-colors';

  const framesSnap = frames.map(f => {
    return algorithmMode === 'basic' ? `P${f.page}(R=${f.r})` : `P${f.page}(${f.r},${f.m})`;
  }).join(' · ');

  const opLabel = algorithmMode === 'basic' 
    ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">页面访问</span>'
    : `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${step.op === 'W' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}">${step.op === 'W' ? '写 (Write)' : '读 (Read)'}</span>`;

  const writeBackNote = algorithmMode === 'basic'
    ? '直接调入覆盖'
    : (step.isDirty ? '<span class="text-amber-600 font-bold">脏页写回磁盘</span>' : '无写回覆盖');

  tr.innerHTML = `
    <td class="py-1 px-2 text-stone-400 font-mono">${statTotal}</td>
    <td class="py-1 px-2 font-bold text-stone-900">Page ${step.targetPage}</td>
    <td class="py-1 px-2">${opLabel}</td>
    <td class="py-1 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${step.isHit ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">${step.isHit ? '命中 HIT' : '缺页 FAULT'}</span></td>
    <td class="py-1 px-2">${step.isHit ? '-' : (algorithmMode === 'basic' ? '单循环' : '第 ' + (step.scanRound || 1) + ' 轮')}</td>
    <td class="py-1 px-2 text-stone-700">${step.isHit ? '-' : 'Page ' + step.victimPage + ' (F' + step.victimFrame + ')'}</td>
    <td class="py-1 px-2 text-[11px]">${step.isHit ? 'R位置1' : writeBackNote}</td>
    <td class="py-1 px-2 font-mono text-[11px] text-stone-600">[ ${framesSnap} ]</td>
  `;

  tbody.insertBefore(tr, tbody.firstChild);
}

function clearHistoryLog() {
  document.getElementById('history-log-tbody').innerHTML = '';
}

// ================= 手动访问与算法模式切换 =================
function handleManualAccess() {
  const pageInput = document.getElementById('input-page-id');
  const opSelect = document.getElementById('select-op-type');
  const page = parseInt(pageInput.value, 10) || 5;
  const op = algorithmMode === 'basic' ? 'R' : (opSelect.value || 'R');

  // 将新请求推入队列当前位置之后
  requestQueue.splice(currentQueueIndex + 1, 0, { page: page, op: op });
  updateQueueUI();

  // 如果当前微操作已经完成，立即步进到新请求
  if (currentMicroStepIndex >= microSteps.length) {
    currentQueueIndex++;
    prepareNextRequestSteps();
    updateQueueUI();
  }

  stepForward();
}

function setAlgorithmMode(mode) {
  algorithmMode = mode;
  const btnEnh = document.getElementById('btn-mode-enhanced');
  const btnBas = document.getElementById('btn-mode-basic');

  const legendM = document.getElementById('legend-m-bit');
  const selectOp = document.getElementById('select-op-type');
  const inspectorBoxM = document.getElementById('inspector-box-m');
  const inspectorBoxR = document.getElementById('inspector-box-r');
  const trackerTitle = document.getElementById('tracker-title');
  const trackerSubtitle = document.getElementById('tracker-subtitle');

  if (mode === 'enhanced') {
    btnEnh.className = 'px-2 py-1 rounded font-bold bg-white shadow-xs text-purple-700';
    btnBas.className = 'px-2 py-1 rounded text-stone-500 hover:text-stone-800';

    if (legendM) legendM.classList.remove('hidden');
    if (selectOp) selectOp.classList.remove('hidden');
    if (inspectorBoxM) inspectorBoxM.classList.remove('hidden');
    if (inspectorBoxR) inspectorBoxR.classList.remove('col-span-2');

    // 显示 4 个页框的 M 位
    for (let i = 0; i < RESIDENT_SET_SIZE; i++) {
      const wrapM = document.getElementById(`wrap-bit-m-${i}`);
      if (wrapM) wrapM.classList.remove('hidden');
    }

    if (trackerTitle) trackerTitle.textContent = '四轮扫描淘汰判决引擎';
    if (trackerSubtitle) trackerSubtitle.textContent = '(408 核心考点)';

    // 恢复四轮卡片内容
    setTrackerCardContent(1, '第 1 轮: 找 (0, 0)', '不改位', '最佳候选：未访问且未修改，直接替换无需写回。');
    setTrackerCardContent(2, '第 2 轮: 找 (0, 1)', 'R: 1→0', '扫描经过时将所有 R 置 0；中则淘汰并写回外存。');
    setTrackerCardContent(3, '第 3 轮: 找 (0, 0)', '必能找到', '原 (1, 0) 经第 2 轮清 0 后已成为 (0, 0)，此时必中。');
    setTrackerCardContent(4, '第 4 轮: 找 (0, 1)', '兜底淘汰', '若第 3 轮仍未找到，淘汰原 (1, 1) 变成的 (0, 1)。');

    document.getElementById('action-narrative').textContent = '已切换至【改进型 Clock 算法】：同时维护访问位 R 与修改位 M，经历四轮优先级淘汰。';
  } else {
    btnBas.className = 'px-2 py-1 rounded font-bold bg-white shadow-xs text-purple-700';
    btnEnh.className = 'px-2 py-1 rounded text-stone-500 hover:text-stone-800';

    // 隐藏修改位 M
    if (legendM) legendM.classList.add('hidden');
    if (selectOp) selectOp.classList.add('hidden');
    if (inspectorBoxM) inspectorBoxM.classList.add('hidden');
    if (inspectorBoxR) inspectorBoxR.classList.add('col-span-2');

    // 隐藏 4 个页框的 M 位
    for (let i = 0; i < RESIDENT_SET_SIZE; i++) {
      const wrapM = document.getElementById(`wrap-bit-m-${i}`);
      if (wrapM) wrapM.classList.add('hidden');
    }

    if (trackerTitle) trackerTitle.textContent = '简单 Clock 循环淘汰判决引擎';
    if (trackerSubtitle) trackerSubtitle.textContent = '(无需修改位 M · 仅维护访问位 R)';

    // 切换为简单 Clock 判定说明
    setTrackerCardContent(1, '遇到 R = 0 (淘汰页)', '立即置换', '选中该页作为淘汰页！调入新页并置 R=1，指针前移一位。');
    setTrackerCardContent(2, '遇到 R = 1 (清零前进)', 'R: 1→0', '给该页一次机会：将访问位 R 置 0，指针前移继续扫描。');
    setTrackerCardContent(3, '无需修改位 M', '无脏页区分', '简单 Clock 算法不跟踪写操作，无需维护修改位 M。');
    setTrackerCardContent(4, '最多 2 轮扫除', '必定命中', '若所有页 R 均为 1，第一圈全置 0，第二圈必中首个页框。');

    document.getElementById('action-narrative').textContent = '已切换至【简单 Clock 算法】：无需修改位 M，仅依据访问位 R 循环扫描（遇到 0 淘汰，遇到 1 置 0 并前进）。';
  }

  updateUI();
  updateInspectorDefault();
  updateQueueUI();
  prepareNextRequestSteps();
}

function setTrackerCardContent(num, title, badge, desc) {
  const card = document.getElementById(`round-card-${num}`);
  if (!card) return;
  card.innerHTML = `
    <div class="flex items-center justify-between">
      <span>${title}</span>
      <span class="text-[9px] text-stone-400">${badge}</span>
    </div>
    <p class="text-[10px] font-sans text-stone-500 font-normal leading-tight">
      ${desc}
    </p>
  `;
}

// ================= 播放与调速控制 =================
function toggleAutoPlay() {
  if (isPlaying) {
    stopAutoPlay();
  } else {
    startAutoPlay();
  }
}

function startAutoPlay() {
  isPlaying = true;
  document.getElementById('play-btn-text').textContent = '⏸ 暂停';
  document.getElementById('btn-play-pause').classList.add('bg-stone-900', 'text-white');
  document.getElementById('btn-play-pause').classList.remove('border-stone-300');

  runAutoLoop();
}

function stopAutoPlay() {
  isPlaying = false;
  clearTimeout(playTimer);
  document.getElementById('play-btn-text').textContent = '▶ 自动播放';
  document.getElementById('btn-play-pause').classList.remove('bg-stone-900', 'text-white');
  document.getElementById('btn-play-pause').classList.add('border-stone-300');
}

function runAutoLoop() {
  if (!isPlaying) return;

  stepForward();

  const delay = Math.max(700 / animSpeed, 350);
  playTimer = setTimeout(() => {
    if (isPlaying) runAutoLoop();
  }, delay);
}

function cycleSpeed() {
  const speeds = [1.0, 1.5, 2.0, 0.5];
  const idx = speeds.indexOf(animSpeed);
  animSpeed = speeds[(idx + 1) % speeds.length];
  document.getElementById('speed-text').textContent = `${animSpeed.toFixed(1)}x`;
}
