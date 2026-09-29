/**
 * 基数排序 (Radix Sort)：LSD 最低位优先与队列分配收集机制
 * 遵循 Taste-Skill Light Editorial & Cyber-Paper 美学与 3-Stage 动效规范
 */

(function () {
  'use strict';

  // ══════════════ 全局数据集预设 ══════════════
  const PRESETS = {
    classic: [278, 109, 63, 930, 589, 184, 505, 269],
    reverse: [982, 874, 763, 651, 540, 439, 328, 217],
    conflict: [524, 124, 724, 324, 914, 24, 624, 424] // 验证稳定性的同数位对抗
  };

  // ══════════════ 状态机 ══════════════
  const State = {
    rawNumbers: [...PRESETS.classic],
    items: [],           // 格式化卡片对象数组 { id, str, val, tag, digits: [个, 十, 百] }
    steps: [],           // 离散预先计算好的 48 个原子步骤序列
    currentStep: 0,      // 当前处于哪一步 (0 ~ steps.length)
    isPlaying: false,    // 是否正在自动播放
    speed: 1.0,          // 速率倍率
    playTimer: null,     // 播放定时器引用
    isAnimating: false   // 当前是否有物理弹道正在飞行
  };

  // ══════════════ DOM 节点缓存 ══════════════
  const DOM = {
    stage: null,
    flightLayer: null,
    conveyorSlots: null,
    readProbe: null,
    probeVal: null,
    bucketMatrix: null,
    collectScannerBeam: null,
    collectScannerLabel: null,
    hudText: null,
    hudStepBadge: null,
    metricDigit: null,
    metricPhase: null,
    btnPlay: null,
    btnPlayText: null,
    btnPlayIcon: null,
    btnStepPrev: null,
    btnStepNext: null,
    btnReset: null,
    sliderSpeed: null,
    labelSpeed: null,
    stepCounter: null,
    beltStatusBadge: null,
    roundPills: [null, null, null],
    phasePillDistribute: null,
    phasePillCollect: null,
    customPanel: null,
    inputCustom: null,
    btnCustomToggle: null,
    btnCustomApply: null,
    presetBtns: []
  };

  // ══════════════ 初始化入口 ══════════════
  function init() {
    cacheDOM();
    bindEvents();
    loadDataset(State.rawNumbers);
    console.log('🚀 基数排序 (Radix Sort LSD) 可视化实验室初始化完成');
  }

  function cacheDOM() {
    DOM.stage = document.getElementById('stage-container');
    DOM.flightLayer = document.getElementById('flight-layer');
    DOM.conveyorSlots = document.getElementById('conveyor-slots');
    DOM.readProbe = document.getElementById('read-probe');
    DOM.probeVal = document.getElementById('probe-val');
    DOM.bucketMatrix = document.getElementById('bucket-matrix');
    DOM.collectScannerBeam = document.getElementById('collect-scanner-beam');
    DOM.collectScannerLabel = document.getElementById('collect-scanner-label');
    DOM.hudText = document.getElementById('hud-text');
    DOM.hudStepBadge = document.getElementById('hud-step-badge');
    DOM.metricDigit = document.getElementById('metric-digit');
    DOM.metricPhase = document.getElementById('metric-phase');
    DOM.btnPlay = document.getElementById('btn-play');
    DOM.btnPlayText = document.getElementById('btn-play-text');
    DOM.btnPlayIcon = document.getElementById('btn-play-icon');
    DOM.btnStepPrev = document.getElementById('btn-step-prev');
    DOM.btnStepNext = document.getElementById('btn-step-next');
    DOM.btnReset = document.getElementById('btn-reset');
    DOM.sliderSpeed = document.getElementById('slider-speed');
    DOM.labelSpeed = document.getElementById('label-speed');
    DOM.stepCounter = document.getElementById('step-counter');
    DOM.beltStatusBadge = document.getElementById('belt-status-badge');
    DOM.roundPills[0] = document.getElementById('round-pill-0');
    DOM.roundPills[1] = document.getElementById('round-pill-1');
    DOM.roundPills[2] = document.getElementById('round-pill-2');
    DOM.phasePillDistribute = document.getElementById('phase-pill-distribute');
    DOM.phasePillCollect = document.getElementById('phase-pill-collect');
    DOM.customPanel = document.getElementById('custom-panel');
    DOM.inputCustom = document.getElementById('input-custom');
    DOM.btnCustomToggle = document.getElementById('btn-custom-toggle');
    DOM.btnCustomApply = document.getElementById('btn-custom-apply');
    DOM.presetBtns = Array.from(document.querySelectorAll('.preset-btn'));
  }

  // ══════════════ 离散仿真计算与步骤生成 ══════════════
  function loadDataset(numbers) {
    killActiveTweens();
    State.rawNumbers = [...numbers];

    // 格式化 8 张卡片实体
    // 若存在相同数字，自动打上 A, B, C... 标签以供观测稳定性
    const valueCounts = {};
    State.items = State.rawNumbers.map((num, idx) => {
      const val = parseInt(num, 10);
      const str = String(val).padStart(3, '0');
      const count = (valueCounts[val] || 0) + 1;
      valueCounts[val] = count;
      const tag = count > 1 ? `#${count}` : '';
      return {
        id: idx,
        val: val,
        str: str,
        tag: tag,
        digits: [
          parseInt(str[2], 10), // 个位 (d=0)
          parseInt(str[1], 10), // 十位 (d=1)
          parseInt(str[0], 10)  // 百位 (d=2)
        ]
      };
    });

    // 编译完整的 48 步离散执行计划
    compileExecutionSteps();

    // 复位并初次渲染
    State.currentStep = 0;
    renderStaticState(0);
    updateControlsUI();
  }

  /**
   * 预先计算出 LSD 排序全部原子动作与状态快照
   */
  function compileExecutionSteps() {
    State.steps = [];
    let currentBelt = [...State.items];
    const digitNames = ['个位 (LSD)', '十位', '百位 (MSD)'];
    const powers = ['10⁰', '10¹', '10²'];

    // 3 轮循环 (pass 0: 个位, pass 1: 十位, pass 2: 百位)
    for (let pass = 0; pass < 3; pass++) {
      const buckets = Array.from({ length: 10 }, () => []);

      // ────────────────── 阶段 1: 依次分配到 10 个桶 (8 步) ──────────────────
      for (let i = 0; i < currentBelt.length; i++) {
        const item = currentBelt[i];
        const digit = item.digits[pass];

        // 记录分配前快照
        const snapshotBefore = {
          belt: [...currentBelt],
          buckets: buckets.map(b => [...b]),
          pass: pass,
          phase: 'distribute'
        };

        // 执行分配逻辑：放入对应桶中（入队列尾）
        buckets[digit].push(item);
        currentBelt[i] = null; // 传送带当前槽位离开留空

        // 记录分配后快照
        const snapshotAfter = {
          belt: [...currentBelt],
          buckets: buckets.map(b => [...b]),
          pass: pass,
          phase: 'distribute'
        };

        State.steps.push({
          stepIndex: State.steps.length,
          pass: pass,
          phase: 'distribute',
          item: item,
          sourceSlot: i,
          targetBucket: digit,
          targetSlot: -1,
          digitName: digitNames[pass],
          power: powers[pass],
          explanation: `【第 ${pass + 1} 轮 · ${digitNames[pass]}分配】探针锁定槽位 [${i}] 数值 ${item.str}，提取其${digitNames[pass]}【${digit}】，沿抛物线弹道投递入 ${digit} 号 FIFO 队列管道。`,
          before: snapshotBefore,
          after: snapshotAfter
        });
      }

      // ────────────────── 阶段 2: 从 0~9 桶中按 FIFO 顺序收集 (8 步) ──────────────────
      let collectIndex = 0;
      for (let b = 0; b < 10; b++) {
        while (buckets[b].length > 0) {
          // FIFO: 从队头（桶底）出列
          const snapshotBefore = {
            belt: [...currentBelt],
            buckets: buckets.map(bk => [...bk]),
            pass: pass,
            phase: 'collect'
          };

          const item = buckets[b].shift(); // 底部元素率先出列
          currentBelt[collectIndex] = item;

          const snapshotAfter = {
            belt: [...currentBelt],
            buckets: buckets.map(bk => [...bk]),
            pass: pass,
            phase: 'collect'
          };

          State.steps.push({
            stepIndex: State.steps.length,
            pass: pass,
            phase: 'collect',
            item: item,
            sourceSlot: -1,
            targetBucket: b,
            targetSlot: collectIndex,
            digitName: digitNames[pass],
            power: powers[pass],
            explanation: `【第 ${pass + 1} 轮 · ${digitNames[pass]}收集】扫描线抵达 ${b} 号桶，桶底开闸！最先入队的卡片 ${item.str} 率先出列滑回传送带 [${collectIndex}]，严格维系 FIFO 稳定性。`,
            before: snapshotBefore,
            after: snapshotAfter
          });

          collectIndex++;
        }
      }
    }
  }

  // ══════════════ 静态 DOM 渲染（无漂移保障） ══════════════
  function renderStaticState(stepIdx) {
    killActiveTweens();
    if (DOM.flightLayer) DOM.flightLayer.innerHTML = '';

    // 当前处于的快照状态
    let stateData;
    let currentPass = 0;
    let currentPhase = 'distribute';

    if (stepIdx === 0) {
      stateData = {
        belt: [...State.items],
        buckets: Array.from({ length: 10 }, () => [])
      };
      currentPass = 0;
      currentPhase = 'ready';
    } else {
      const step = State.steps[stepIdx - 1];
      stateData = step.after;
      currentPass = step.pass;
      currentPhase = step.phase;
    }

    const isCompleted = stepIdx >= State.steps.length;

    // 1. 渲染顶层主序列传送带
    renderBelt(stateData.belt, isCompleted ? -1 : currentPass, isCompleted);

    // 2. 渲染中层基数桶队列
    renderBuckets(stateData.buckets, currentPass);

    // 3. 更新探针与光标
    updateProbes(stepIdx);

    // 4. 更新 HUD 与指标
    updateHUD(stepIdx);
  }

  /**
   * 渲染传送带槽位与卡片
   */
  function renderBelt(beltArray, activePass, isCompleted = false) {
    if (!DOM.conveyorSlots) return;
    DOM.conveyorSlots.innerHTML = '';

    beltArray.forEach((item, idx) => {
      const slot = document.createElement('div');
      slot.className = 'conveyor-slot';
      slot.id = `conveyor-slot-${idx}`;
      if (isCompleted) {
        slot.classList.add('border-emerald-300', 'bg-emerald-50/20');
      }

      // 槽位编号
      const slotNum = document.createElement('div');
      slotNum.className = 'absolute top-1 left-1.5 text-[9px] font-mono text-stone-400 select-none';
      slotNum.innerText = `[${idx}]`;
      slot.appendChild(slotNum);

      if (item) {
        const card = createCardDOM(item, activePass, isCompleted);
        card.id = `card-belt-${idx}`;
        slot.appendChild(card);
      } else {
        const emptyLabel = document.createElement('div');
        emptyLabel.className = 'text-[10px] font-mono text-stone-300';
        emptyLabel.innerText = '空槽';
        slot.appendChild(emptyLabel);
      }

      DOM.conveyorSlots.appendChild(slot);
    });
  }

  /**
   * 创建数位显微镜卡片 DOM
   */
  function createCardDOM(item, activePass, isCompleted = false) {
    const card = document.createElement('div');
    card.className = 'num-card flex flex-col items-center justify-center relative cursor-default';
    card.setAttribute('data-card-id', item.id);

    if (isCompleted) {
      card.classList.add('card-sorted');
    }

    // 标签微徽标 (若是稳定性对抗模式)
    if (item.tag) {
      const badge = document.createElement('span');
      badge.className = 'absolute -top-1.5 -right-1.5 px-1 py-0.2 bg-amber-100 text-amber-800 border border-amber-300 rounded font-mono text-[9px] font-bold shadow-xs';
      badge.innerText = item.tag;
      card.appendChild(badge);
    }

    if (isCompleted) {
      // 排序完成：不再只高亮百位，完整清晰显示原来的十进制数字！
      const fullNumContainer = document.createElement('div');
      fullNumContainer.className = 'flex items-center justify-center my-0.5';

      const numSpan = document.createElement('span');
      numSpan.className = 'px-2.5 py-0.5 bg-emerald-50 border border-emerald-300 rounded-md font-mono text-sm font-bold text-emerald-800 tracking-wider shadow-xs';
      numSpan.innerText = item.str;
      fullNumContainer.appendChild(numSpan);
      card.appendChild(fullNumContainer);

      const statusText = document.createElement('div');
      statusText.className = 'text-[9px] font-mono text-emerald-600 font-semibold flex items-center gap-0.5 mt-0.5';
      statusText.innerHTML = '<span>✓</span><span>全位有序</span>';
      card.appendChild(statusText);
    } else {
      // 演进过程中：数位显微镜方格区 (百、十、个)
      const digitsContainer = document.createElement('div');
      digitsContainer.className = 'flex items-center justify-center gap-1 my-0.5';

      // item.str 为 3 位字符，例如 "278"
      // pass = 0 对应 个位 item.str[2]
      // pass = 1 对应 十位 item.str[1]
      // pass = 2 对应 百位 item.str[0]
      const digitIndices = [0, 1, 2]; // [百, 十, 个]
      const activeCharIndex = 2 - activePass; // 0对应百，1对应十，2对应个

      digitIndices.forEach(dIdx => {
        const cell = document.createElement('span');
        cell.className = 'digit-cell';
        cell.innerText = item.str[dIdx];

        if (activePass >= 0 && dIdx === activeCharIndex) {
          cell.classList.add('active-digit');
        } else {
          cell.classList.add('dim-digit');
        }

        digitsContainer.appendChild(cell);
      });

      card.appendChild(digitsContainer);

      // 底部微字标 (原始十进制)
      const valText = document.createElement('div');
      valText.className = 'text-[10px] font-mono text-stone-400 font-medium tracking-tight';
      valText.innerText = item.str;
      card.appendChild(valText);
    }

    return card;
  }

  /**
   * 渲染 0 ~ 9 号基数桶队列管道
   */
  function renderBuckets(bucketsArray, activePass) {
    if (!DOM.bucketMatrix) return;
    DOM.bucketMatrix.innerHTML = '';

    for (let b = 0; b < 10; b++) {
      const bucketPipe = document.createElement('div');
      bucketPipe.className = 'bucket-pipe';
      bucketPipe.id = `bucket-pipe-${b}`;

      // 1. 顶部漏斗标号入口
      const header = document.createElement('div');
      header.className = 'flex items-center justify-between px-2 py-1.5 border-b border-stone-100 bg-[#FAF9F5]/80';
      
      const title = document.createElement('div');
      title.className = 'flex items-center gap-1';
      const badge = document.createElement('span');
      badge.className = 'w-4 h-4 rounded-full bg-stone-800 text-white flex items-center justify-center text-[10px] font-mono font-bold';
      badge.innerText = b;
      const count = document.createElement('span');
      count.className = 'text-[10px] font-mono text-stone-400';
      count.innerText = `(${bucketsArray[b].length})`;
      title.appendChild(badge);
      title.appendChild(count);

      const funnelIcon = document.createElement('span');
      funnelIcon.className = 'text-[10px] text-stone-300';
      funnelIcon.innerText = '▼';
      header.appendChild(title);
      header.appendChild(funnelIcon);
      bucketPipe.appendChild(header);

      // 2. 队列垂直堆叠道 (自下而上排列)
      const stack = document.createElement('div');
      stack.className = 'bucket-stack';
      stack.id = `bucket-stack-${b}`;

      // 渲染堆叠卡片 (队头在底部，队尾在顶部)
      bucketsArray[b].forEach((item, stackIdx) => {
        const miniCard = createCardDOM(item, activePass);
        miniCard.id = `card-bucket-${b}-${stackIdx}`;
        miniCard.style.maxWidth = '92px';
        stack.appendChild(miniCard);
      });

      bucketPipe.appendChild(stack);

      // 3. 底部出闸口
      const gate = document.createElement('div');
      gate.className = 'bucket-gate';
      gate.id = `bucket-gate-${b}`;
      gate.innerText = 'GATE ▼';
      bucketPipe.appendChild(gate);

      DOM.bucketMatrix.appendChild(bucketPipe);
    }
  }

  // ══════════════ 动态探针与光标定位 ══════════════
  function updateProbes(stepIdx) {
    if (!DOM.readProbe) return;

    if (stepIdx === 0 || stepIdx > State.steps.length) {
      DOM.readProbe.style.opacity = '0';
      if (DOM.collectScannerBeam) DOM.collectScannerBeam.style.opacity = '0';
      if (DOM.collectScannerLabel) DOM.collectScannerLabel.classList.add('hidden');
      return;
    }

    const currentAction = State.steps[Math.min(stepIdx, State.steps.length - 1)];

    if (currentAction.phase === 'distribute') {
      // 分配阶段：探针移动到当前读取槽位上方
      const slotEl = document.getElementById(`conveyor-slot-${currentAction.sourceSlot}`);
      if (slotEl && DOM.stage) {
        const stageRect = DOM.stage.getBoundingClientRect();
        const slotRect = slotEl.getBoundingClientRect();
        const targetX = slotRect.left - stageRect.left + slotRect.width / 2 - 25;
        
        DOM.readProbe.style.opacity = '1';
        DOM.readProbe.style.transform = `translateX(${targetX}px)`;
        if (DOM.probeVal) DOM.probeVal.innerText = `#${currentAction.sourceSlot}`;
      }
      if (DOM.collectScannerBeam) DOM.collectScannerBeam.style.opacity = '0';
      if (DOM.collectScannerLabel) DOM.collectScannerLabel.classList.add('hidden');
    } else {
      // 收集阶段：扫描光束在桶底滑动
      DOM.readProbe.style.opacity = '0';
      if (DOM.collectScannerBeam) {
        DOM.collectScannerBeam.style.opacity = '1';
        if (DOM.collectScannerLabel) DOM.collectScannerLabel.classList.remove('hidden');
      }
    }
  }

  // ══════════════ 实时 HUD 与状态指示更新 ══════════════
  function updateHUD(stepIdx) {
    if (stepIdx === 0) {
      DOM.hudStepBadge.innerText = 'READY';
      DOM.hudStepBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-stone-100 text-stone-700 border border-stone-200 shrink-0';
      DOM.hudText.innerText = '准备就绪。数据已置于传送带。点击【启动连续演进】或【单步步进】开始第 1 轮（个位 LSD）物理分配。';
      DOM.metricDigit.innerText = '个位 (10⁰)';
      DOM.metricPhase.innerText = '就绪待命';
      DOM.stepCounter.innerText = `步骤: 0 / ${State.steps.length}`;
      DOM.beltStatusBadge.innerText = '待命就绪';
      DOM.beltStatusBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full border border-stone-200 bg-white text-stone-600';
      highlightRoundAndPhase(0, 'distribute');
      return;
    }

    if (stepIdx >= State.steps.length) {
      DOM.hudStepBadge.innerText = 'FINISH';
      DOM.hudStepBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0';
      DOM.hudText.innerHTML = '🎉 <strong class="text-emerald-800">基数排序全部完成！</strong> 历经个位、十位、百位 3 轮分配与 FIFO 收集，主传送带序列已完全升序有序，稳定性完美保全！';
      DOM.metricDigit.innerText = '全部数位已锁定';
      DOM.metricPhase.innerText = '排序完成';
      DOM.stepCounter.innerText = `步骤: ${State.steps.length} / ${State.steps.length}`;
      DOM.beltStatusBadge.innerText = '全局升序有序 ✓';
      DOM.beltStatusBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold';
      highlightRoundAndPhase(2, 'collect');

      // 全体卡片庆祝高亮
      triggerCelebration();
      return;
    }

    const step = State.steps[stepIdx - 1];
    DOM.hudStepBadge.innerText = `STEP #${stepIdx}`;
    DOM.hudStepBadge.className = step.phase === 'distribute'
      ? 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-blue-100 text-blue-800 border border-blue-200 shrink-0'
      : 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0';

    DOM.hudText.innerText = step.explanation;
    DOM.metricDigit.innerText = `${step.digitName} (${step.power})`;
    DOM.metricPhase.innerText = step.phase === 'distribute' ? '队列分配中' : 'FIFO 开闸收集中';
    DOM.stepCounter.innerText = `步骤: ${stepIdx} / ${State.steps.length}`;
    DOM.beltStatusBadge.innerText = `第 ${step.pass + 1} 轮 · ${step.phase === 'distribute' ? '分配' : '收集'}`;
    
    highlightRoundAndPhase(step.pass, step.phase);
  }

  function highlightRoundAndPhase(pass, phase) {
    // 轮次药丸
    DOM.roundPills.forEach((pill, idx) => {
      if (idx === pass) {
        pill.className = 'round-pill active-pill px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 font-mono text-xs font-semibold shadow-xs flex items-center gap-1';
      } else {
        pill.className = 'round-pill px-2.5 py-1 rounded-lg border border-stone-200 bg-stone-50 text-stone-400 font-mono text-xs font-medium flex items-center gap-1';
      }
    });

    // 阶段药丸
    if (phase === 'distribute') {
      DOM.phasePillDistribute.className = 'px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 font-mono text-xs font-medium flex items-center gap-1.5 shadow-xs';
      DOM.phasePillDistribute.querySelector('span').className = 'w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse';
      DOM.phasePillCollect.className = 'px-2.5 py-1 rounded-lg border border-stone-200 bg-stone-50 text-stone-400 font-mono text-xs flex items-center gap-1.5';
      DOM.phasePillCollect.querySelector('span').className = 'w-1.5 h-1.5 rounded-full bg-stone-300';
    } else {
      DOM.phasePillCollect.className = 'px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 font-mono text-xs font-medium flex items-center gap-1.5 shadow-xs';
      DOM.phasePillCollect.querySelector('span').className = 'w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse';
      DOM.phasePillDistribute.className = 'px-2.5 py-1 rounded-lg border border-stone-200 bg-stone-50 text-stone-400 font-mono text-xs flex items-center gap-1.5';
      DOM.phasePillDistribute.querySelector('span').className = 'w-1.5 h-1.5 rounded-full bg-stone-300';
    }
  }

  // ══════════════ 核心动力学与 GSAP 物理弹道动画 ══════════════
  /**
   * 前进执行一步（带平滑抛物线与开闸动画）
   */
  function stepForwardWithAnimation(onCompleteCallback) {
    if (State.currentStep >= State.steps.length) {
      pause();
      return;
    }

    const action = State.steps[State.currentStep];
    State.isAnimating = true;

    // 先确保当前静态状态与 action.before 一致
    renderStaticState(State.currentStep);

    if (action.phase === 'distribute') {
      // ────────────────── 阶段 1: 分配弹道 (顶层飞向桶底) ──────────────────
      animateDistribution(action, () => {
        State.currentStep++;
        renderStaticState(State.currentStep);
        State.isAnimating = false;
        if (typeof onCompleteCallback === 'function') onCompleteCallback();
      });
    } else {
      // ────────────────── 阶段 2: 收集弹道 (桶底开闸滑向顶层) ──────────────────
      animateCollection(action, () => {
        State.currentStep++;
        renderStaticState(State.currentStep);
        State.isAnimating = false;
        if (typeof onCompleteCallback === 'function') onCompleteCallback();
      });
    }
  }

  /**
   * 分配动画：升起 -> 抛物线飞跃 -> 垂直落入桶内堆叠
   */
  function animateDistribution(action, done) {
    if (!window.gsap) { done(); return; }

    const sourceSlotEl = document.getElementById(`conveyor-slot-${action.sourceSlot}`);
    const sourceCardEl = sourceSlotEl ? sourceSlotEl.querySelector('.num-card') : null;
    const targetPipeEl = document.getElementById(`bucket-pipe-${action.targetBucket}`);
    const targetStackEl = document.getElementById(`bucket-stack-${action.targetBucket}`);

    if (!sourceCardEl || !targetPipeEl || !DOM.stage) {
      done();
      return;
    }

    const stageRect = DOM.stage.getBoundingClientRect();
    const sourceRect = sourceCardEl.getBoundingClientRect();
    const targetPipeRect = targetPipeEl.getBoundingClientRect();

    // 目标落点：桶内堆叠区当前顶部位置 (自下而上堆叠)
    const existingCount = action.before.buckets[action.targetBucket].length;
    let targetStackY;
    if (existingCount === 0) {
      const stackRect = targetStackEl.getBoundingClientRect();
      targetStackY = stackRect.bottom - 6 - sourceRect.height;
    } else if (targetStackEl.lastElementChild) {
      const topCardRect = targetStackEl.lastElementChild.getBoundingClientRect();
      targetStackY = topCardRect.top - 4 - sourceRect.height;
    } else {
      targetStackY = targetPipeRect.bottom - 24 - (existingCount * (sourceRect.height + 4)) - sourceRect.height;
    }
    const targetStackX = targetPipeRect.left + (targetPipeRect.width - sourceRect.width) / 2;

    // 创建飞行卡片克隆体挂入 flightLayer
    const flyingClone = sourceCardEl.cloneNode(true);
    flyingClone.className = sourceCardEl.className + ' flying-card-entity';
    flyingClone.style.width = `${sourceRect.width}px`;
    flyingClone.style.left = `${sourceRect.left - stageRect.left}px`;
    flyingClone.style.top = `${sourceRect.top - stageRect.top}px`;
    DOM.flightLayer.appendChild(flyingClone);

    // 隐藏原始卡片
    sourceCardEl.style.visibility = 'hidden';

    // 高亮目标桶管道
    targetPipeEl.classList.add('pipe-target');

    const durationFactor = 1 / State.speed;
    const tl = gsap.timeline({
      onComplete: () => {
        targetPipeEl.classList.remove('pipe-target');
        if (flyingClone.parentNode) flyingClone.parentNode.removeChild(flyingClone);
        done();
      }
    });

    // 1. 升起与微倾斜 (120ms)
    tl.to(flyingClone, {
      y: -20,
      scale: 1.08,
      rotation: -4,
      boxShadow: '0 16px 32px rgba(37,99,235,0.25)',
      duration: 0.12 * durationFactor,
      ease: 'power2.out'
    });

    // 2. 平滑抛物线飞往桶顶口 (320ms)
    const topInletX = targetPipeRect.left - stageRect.left + (targetPipeRect.width - sourceRect.width) / 2;
    const topInletY = targetPipeRect.top - stageRect.top + 28;

    tl.to(flyingClone, {
      left: topInletX,
      top: topInletY,
      rotation: 0,
      duration: 0.32 * durationFactor,
      ease: 'power2.inOut'
    });

    // 3. 穿入桶口直落堆叠位置 (200ms)
    const finalTop = targetStackY - stageRect.top;
    tl.to(flyingClone, {
      top: finalTop,
      scale: 1.0,
      duration: 0.2 * durationFactor,
      ease: 'power3.in'
    });

    // 4. 落地微压缩缓冲 (80ms)
    tl.to(flyingClone, {
      scaleY: 0.94,
      duration: 0.05 * durationFactor,
      yoyo: true,
      repeat: 1
    });
  }

  /**
   * 收集动画：扫描线对准 -> 桶底开闸 -> 底部卡片滑出 -> 弧线滑回传送带槽位
   */
  function animateCollection(action, done) {
    if (!window.gsap) { done(); return; }

    const sourcePipeEl = document.getElementById(`bucket-pipe-${action.targetBucket}`);
    const sourceStackEl = document.getElementById(`bucket-stack-${action.targetBucket}`);
    const targetSlotEl = document.getElementById(`conveyor-slot-${action.targetSlot}`);

    if (!sourcePipeEl || !sourceStackEl || !targetSlotEl || !DOM.stage) {
      done();
      return;
    }

    // 队列先进先出：当前滑出的是最底部的卡片 (stack 的第一个子元素)
    const bottomCardEl = sourceStackEl.firstElementChild;
    if (!bottomCardEl) {
      done();
      return;
    }

    const stageRect = DOM.stage.getBoundingClientRect();
    const sourceRect = bottomCardEl.getBoundingClientRect();
    const targetRect = targetSlotEl.getBoundingClientRect();

    // 创建飞行克隆
    const flyingClone = bottomCardEl.cloneNode(true);
    flyingClone.className = bottomCardEl.className + ' flying-card-entity';
    flyingClone.style.width = `${sourceRect.width}px`;
    flyingClone.style.left = `${sourceRect.left - stageRect.left}px`;
    flyingClone.style.top = `${sourceRect.top - stageRect.top}px`;
    DOM.flightLayer.appendChild(flyingClone);

    // 隐藏原始卡片
    bottomCardEl.style.visibility = 'hidden';

    // 高亮开闸出列
    sourcePipeEl.classList.add('pipe-discharging');
    targetSlotEl.classList.add('slot-highlight');

    const durationFactor = 1 / State.speed;
    const tl = gsap.timeline({
      onComplete: () => {
        sourcePipeEl.classList.remove('pipe-discharging');
        targetSlotEl.classList.remove('slot-highlight');
        if (flyingClone.parentNode) flyingClone.parentNode.removeChild(flyingClone);
        done();
      }
    });

    // 1. 底部开闸向下移出 (140ms)
    tl.to(flyingClone, {
      top: '+=20',
      scale: 1.05,
      boxShadow: '0 12px 24px rgba(5,150,105,0.25)',
      duration: 0.14 * durationFactor,
      ease: 'power2.in'
    });

    // 桶内上层剩余卡片同时平滑向下填补一位 (FIFO 视觉见证!)
    const remainingCards = Array.from(sourceStackEl.children).slice(1);
    if (remainingCards.length > 0) {
      tl.to(remainingCards, {
        y: sourceRect.height + 4,
        duration: 0.2 * durationFactor,
        ease: 'power2.out'
      }, '-=0.1');
    }

    // 2. 弧线飞向顶层主传送带槽位 (360ms)
    const targetLeft = targetRect.left - stageRect.left + (targetRect.width - sourceRect.width) / 2;
    const targetTop = targetRect.top - stageRect.top + (targetRect.height - sourceRect.height) / 2;

    tl.to(flyingClone, {
      left: targetLeft,
      top: targetTop,
      scale: 1.0,
      duration: 0.36 * durationFactor,
      ease: 'power3.out'
    });

    // 3. 入定微触弹 (80ms)
    tl.to(flyingClone, {
      scale: 1.02,
      duration: 0.05 * durationFactor,
      yoyo: true,
      repeat: 1
    });
  }

  /**
   * 全流程完成后的全卡片波浪弹跳与金色光波庆祝
   */
  function triggerCelebration() {
    if (!window.gsap) return;
    const cards = DOM.conveyorSlots.querySelectorAll('.num-card');
    cards.forEach(c => c.classList.add('card-sorted'));

    gsap.fromTo(cards,
      { y: 0 },
      {
        y: -14,
        stagger: 0.06,
        duration: 0.3,
        yoyo: true,
        repeat: 1,
        ease: 'power2.out'
      }
    );
  }

  // ══════════════ 播放控制器 ══════════════
  function play() {
    if (State.currentStep >= State.steps.length) {
      // 若已在终点，则从头重新播放
      State.currentStep = 0;
      renderStaticState(0);
    }

    State.isPlaying = true;
    updateControlsUI();

    function tick() {
      if (!State.isPlaying) return;

      if (State.currentStep >= State.steps.length) {
        pause();
        return;
      }

      stepForwardWithAnimation(() => {
        if (!State.isPlaying) return;
        // 每步之间保留 180ms 间隙
        State.playTimer = setTimeout(tick, 180 / State.speed);
      });
    }

    tick();
  }

  function pause() {
    State.isPlaying = false;
    if (State.playTimer) {
      clearTimeout(State.playTimer);
      State.playTimer = null;
    }
    updateControlsUI();
  }

  function togglePlay() {
    if (State.isPlaying) {
      pause();
    } else {
      play();
    }
  }

  function stepNext() {
    pause();
    killActiveTweens();
    stepForwardWithAnimation(() => {
      updateControlsUI();
    });
  }

  function stepPrev() {
    pause();
    killActiveTweens();

    if (State.currentStep <= 0) return;
    State.currentStep--;
    renderStaticState(State.currentStep);
    updateControlsUI();
  }

  function reset() {
    pause();
    killActiveTweens();
    State.currentStep = 0;
    renderStaticState(0);
    updateControlsUI();
  }

  function killActiveTweens() {
    if (window.gsap) {
      gsap.killTweensOf('*');
    }
    if (DOM.flightLayer) DOM.flightLayer.innerHTML = '';
    State.isAnimating = false;
  }

  function updateControlsUI() {
    if (!DOM.btnPlayText || !DOM.btnPlayIcon) return;
    DOM.btnPlayText.innerText = State.isPlaying ? '暂停演进' : '启动连续演进';
    DOM.btnPlayIcon.innerText = State.isPlaying ? '⏸' : '▶';

    if (DOM.btnStepPrev) {
      DOM.btnStepPrev.disabled = State.currentStep <= 0;
      DOM.btnStepPrev.style.opacity = State.currentStep <= 0 ? '0.5' : '1';
    }
    if (DOM.btnStepNext) {
      DOM.btnStepNext.disabled = State.currentStep >= State.steps.length;
      DOM.btnStepNext.style.opacity = State.currentStep >= State.steps.length ? '0.5' : '1';
    }
  }

  // ══════════════ 事件绑定 ══════════════
  function bindEvents() {
    // 播放/单步/重置
    if (DOM.btnPlay) DOM.btnPlay.addEventListener('click', togglePlay);
    if (DOM.btnStepNext) DOM.btnStepNext.addEventListener('click', stepNext);
    if (DOM.btnStepPrev) DOM.btnStepPrev.addEventListener('click', stepPrev);
    if (DOM.btnReset) DOM.btnReset.addEventListener('click', reset);

    // 速率滑块
    if (DOM.sliderSpeed) {
      DOM.sliderSpeed.addEventListener('input', (e) => {
        State.speed = parseFloat(e.target.value);
        if (DOM.labelSpeed) DOM.labelSpeed.innerText = State.speed.toFixed(1) + 'x';
      });
    }

    // 预设切换
    DOM.presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        DOM.presetBtns.forEach(b => {
          b.className = 'preset-btn px-2.5 py-1.5 rounded-lg border border-[#E5E4DC] bg-white text-stone-600 hover:bg-stone-50 transition-colors';
        });
        btn.className = 'preset-btn active-preset px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 transition-colors';

        const presetKey = btn.getAttribute('data-preset');
        if (PRESETS[presetKey]) {
          loadDataset(PRESETS[presetKey]);
          if (DOM.customPanel) DOM.customPanel.classList.add('hidden');
        }
      });
    });

    // 自定义数据面板展开与应用
    if (DOM.btnCustomToggle) {
      DOM.btnCustomToggle.addEventListener('click', () => {
        if (!DOM.customPanel) return;
        DOM.customPanel.classList.toggle('hidden');
      });
    }

    if (DOM.btnCustomApply) {
      DOM.btnCustomApply.addEventListener('click', () => {
        const val = DOM.inputCustom.value.trim();
        const parts = val.split(/[,，\s]+/).filter(Boolean);
        if (parts.length < 8) {
          alert('请至少输入 8 个三位以内数字（以逗号分隔）！');
          return;
        }
        const nums = parts.slice(0, 8).map(n => Math.min(999, Math.max(0, parseInt(n, 10) || 0)));
        loadDataset(nums);
      });
    }

    // 视口自适应几何防呆
    window.addEventListener('resize', () => {
      if (!State.isPlaying) {
        killActiveTweens();
        renderStaticState(State.currentStep);
      }
    });
  }

  // DOM 挂载就绪后启动
  window.addEventListener('DOMContentLoaded', init);
})();
