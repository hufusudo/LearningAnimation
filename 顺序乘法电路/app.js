/**
 * Sequential Multiplier Circuit Simulation Engine
 * Author: Antigravity Lab
 * Complies with the reference circuit layout & 60fps continuous GSAP tweens.
 */

// ==========================================================================
// 1. STATE & DATA STRUCTURES
// ==========================================================================

const State = {
  X: 13, // Multiplicand (0~15)
  Y: 11, // Multiplier (0~15)
  n: 4,  // Bit width (4 bits)

  currentStepIndex: 0,
  steps: [],
  isPlaying: false,
  playbackSpeed: 1.0,
  playTimer: null,
  activeTimeline: null
};

// Helper: convert number to array of binary bits
function toBinArr(val, len) {
  const s = (val >>> 0).toString(2).padStart(len, '0');
  return s.split('').slice(-len).map(Number);
}

// Generate the micro-phase steps for multiplication
function generateMultiplicationTrace(X, Y, n = 4) {
  const steps = [];
  let cout = 0;
  let acc = [0, 0, 0, 0];
  let mq = toBinArr(Y, 4);
  let xArr = toBinArr(X, 4);
  let counter = n;

  // Step 0: Initial State
  steps.push({
    stepId: 'S0',
    cycle: 0,
    phase: 'INIT',
    title: '初始状态 (Init)',
    actionDesc: `ACC 初始化清零 (0000)，Cout 清零 (0)，乘数 Y 载入 MQ (${mq.join('')})，被乘数 X 载入 X (${xArr.join('')})，计数器 Cn = 4`,
    cout: cout,
    acc: [...acc],
    mq: [...mq],
    x: [...xArr],
    counter: counter,
    isDone: false,
    activeWires: [],
    activeAlu: false,
    activeCtrl: false,
    activeShift: false,
    probeMq0: false,
    addActive: false,
    clkPulse: false
  });

  for (let i = 1; i <= n; i++) {
    const mq0 = mq[3]; // lowest bit

    // Phase 1: Probe MQ0
    steps.push({
      stepId: `S${i}-P1`,
      cycle: i,
      phase: 'PROBE',
      title: `第 ${i} 拍 · ① 探测乘数最低位 MQ₀`,
      actionDesc: `控制逻辑探针检测 MQ₀ = ${mq0}。${mq0 === 1 ? 'MQ₀=1 → 控制逻辑将发出加法命令 (+)' : 'MQ₀=0 → 控制逻辑将跳过加法 (+0)'}`,
      cout: cout,
      acc: [...acc],
      mq: [...mq],
      x: [...xArr],
      counter: counter,
      isDone: false,
      activeWires: ['wire-mq0-probe'],
      activeAlu: false,
      activeCtrl: true,
      activeShift: false,
      probeMq0: true,
      addActive: false,
      clkPulse: false
    });

    // Phase 2: ALU Addition (if mq0 == 1)
    if (mq0 === 1) {
      const accVal = parseInt(acc.join(''), 2);
      const xVal = X;
      const sumVal = accVal + xVal;
      cout = (sumVal >> 4) & 1; // carry out
      acc = toBinArr(sumVal & 0xF, 4); // 4-bit sum

      steps.push({
        stepId: `S${i}-P2`,
        cycle: i,
        phase: 'ADD',
        title: `第 ${i} 拍 · ② ALU 算术相加并打入 ACC 与 Cout`,
        actionDesc: `控制逻辑发出加法信号 (+) → ACC (${toBinArr(accVal, 4).join('')}) 与 X (${xArr.join('')}) 进入 ALU → 和数 (${acc.join('')}) 送回 ACC，进位 (${cout}) 送入 Cout`,
        cout: cout,
        acc: [...acc],
        mq: [...mq],
        x: [...xArr],
        counter: counter,
        isDone: false,
        activeWires: ['wire-acc-loop', 'wire-x-to-alu', 'wire-ctrl-add', 'wire-alu-sum', 'wire-alu-cout'],
        activeAlu: true,
        activeCtrl: true,
        activeShift: false,
        probeMq0: true,
        addActive: true,
        clkPulse: false,
        sumComputed: true
      });
    } else {
      steps.push({
        stepId: `S${i}-P2`,
        cycle: i,
        phase: 'PASS',
        title: `第 ${i} 拍 · ② 跳过加法 (ACC + 0)`,
        actionDesc: `MQ₀ = 0 → 控制逻辑不触发加法 (+) → ACC 与 Cout 保持原值不变，直接准备联合移位`,
        cout: cout,
        acc: [...acc],
        mq: [...mq],
        x: [...xArr],
        counter: counter,
        isDone: false,
        activeWires: [],
        activeAlu: false,
        activeCtrl: false,
        activeShift: false,
        probeMq0: true,
        addActive: false,
        clkPulse: false
      });
    }

    // Phase 3: Combined Right Shift [Cout -> ACC -> MQ]
    const oldCout = cout;
    const oldAcc = [...acc];
    const oldMq = [...mq];

    // Shift logic:
    // Cout -> ACC[0] (which is acc[3] in array)
    const newAcc3 = oldCout;
    const newAcc2 = oldAcc[0];
    const newAcc1 = oldAcc[1];
    const newAcc0 = oldAcc[2];

    const newMq3 = oldAcc[3]; // ACC lowest bit into MQ highest bit
    const newMq2 = oldMq[0];
    const newMq1 = oldMq[1];
    const newMq0 = oldMq[2];

    cout = 0; // Cout resets to 0 after shift
    acc = [newAcc3, newAcc2, newAcc1, newAcc0];
    mq = [newMq3, newMq2, newMq1, newMq0];

    steps.push({
      stepId: `S${i}-P3`,
      cycle: i,
      phase: 'SHIFT',
      title: `第 ${i} 拍 · ③ [ACC, MQ] 联合向右移位 1 位`,
      actionDesc: `控制逻辑发射 EN, >> 移位脉冲 → Cout(${oldCout}) 移入 ACC最高位 → ACC最低位(${oldAcc[3]}) 跨越注入 MQ最高位 → MQ最低位(${oldMq[3]}) 移出丢弃`,
      cout: cout,
      acc: [...acc],
      mq: [...mq],
      x: [...xArr],
      counter: counter,
      isDone: false,
      activeWires: ['wire-ctrl-shift'],
      activeAlu: false,
      activeCtrl: true,
      activeShift: true,
      probeMq0: false,
      addActive: false,
      clkPulse: false,
      isShiftTransition: true,
      prevCout: oldCout,
      prevAcc: oldAcc,
      prevMq: oldMq
    });

    // Phase 4: CLK Pulse & Counter Decrement
    counter -= 1;
    steps.push({
      stepId: `S${i}-P4`,
      cycle: i,
      phase: 'COUNT',
      title: `第 ${i} 拍 · ④ CLK 脉冲与计数器递减 (Cn = ${counter})`,
      actionDesc: `CLK 上升沿触发步数计数器递减：Cn ← Cn - 1 (${counter + 1} → ${counter})。${counter === 0 ? '计数器归零，乘法计算完成！' : '准备进入下一拍循环。'}`,
      cout: cout,
      acc: [...acc],
      mq: [...mq],
      x: [...xArr],
      counter: counter,
      isDone: counter === 0,
      activeWires: ['wire-clk'],
      activeAlu: false,
      activeCtrl: true,
      activeShift: false,
      probeMq0: false,
      addActive: false,
      clkPulse: true
    });
  }

  // Final Done Step
  const finalAccVal = parseInt(acc.join(''), 2);
  const finalMqVal = parseInt(mq.join(''), 2);
  const finalProduct = (finalAccVal << 4) | finalMqVal;

  steps.push({
    stepId: 'DONE',
    cycle: 4,
    phase: 'DONE',
    title: '乘法全流程圆满完成 (Multiplication Complete)',
    actionDesc: `计数器 Cn = 0 停止时钟！乘积高 4 位保存在 ACC (${acc.join('')})，低 4 位保存在 MQ (${mq.join('')})，拼接结果为 ${acc.join('')}${mq.join('')} (十进制: ${finalProduct})`,
    cout: cout,
    acc: [...acc],
    mq: [...mq],
    x: [...xArr],
    counter: 0,
    isDone: true,
    activeWires: [],
    activeAlu: false,
    activeCtrl: false,
    activeShift: false,
    probeMq0: false,
    addActive: false,
    clkPulse: false
  });

  return steps;
}

// ==========================================================================
// 2. TIMELINE & UI RENDERING
// ==========================================================================

function initTimeline() {
  const container = document.getElementById('timeline-container');
  container.innerHTML = '';

  State.steps.forEach((st, idx) => {
    const btn = document.createElement('button');
    btn.className = `step-node px-2.5 py-1 rounded-lg border text-xs font-mono font-bold flex flex-col items-center min-w-[50px] ${idx === 0 ? 'current' : 'future'}`;
    btn.dataset.index = idx;
    btn.innerHTML = `
      <span>${st.stepId}</span>
    `;
    btn.addEventListener('click', () => {
      pausePlayback();
      goToStep(idx);
    });
    container.appendChild(btn);
  });
}

function updateTimelineNodes(currIdx) {
  const nodes = document.querySelectorAll('.step-node');
  nodes.forEach((node, idx) => {
    node.classList.remove('current', 'passed', 'future');
    if (idx === currIdx) {
      node.classList.add('current');
    } else if (idx < currIdx) {
      node.classList.add('passed');
    } else {
      node.classList.add('future');
    }
  });
}

function clearCircuitHighlights() {
  // Clear wire highlights
  document.querySelectorAll('.wire-path, .wire-path-ctrl').forEach(wire => {
    wire.classList.remove('active', 'wire-animating');
  });

  // Clear chip highlights
  const alu = document.getElementById('alu-body');
  if (alu) alu.classList.remove('active');

  const ctrl = document.getElementById('ctrl-box');
  if (ctrl) ctrl.classList.remove('active');

  // Clear sliding tokens layer
  const layer = document.getElementById('sliding-bits-layer');
  if (layer) layer.innerHTML = '';
}

function renderStaticBitValues(step) {
  document.getElementById('val-cout').textContent = step.cout;

  document.getElementById('val-acc-3').textContent = step.acc[0];
  document.getElementById('val-acc-2').textContent = step.acc[1];
  document.getElementById('val-acc-1').textContent = step.acc[2];
  document.getElementById('val-acc-0').textContent = step.acc[3];

  document.getElementById('val-mq-3').textContent = step.mq[0];
  document.getElementById('val-mq-2').textContent = step.mq[1];
  document.getElementById('val-mq-1').textContent = step.mq[2];
  document.getElementById('val-mq-0').textContent = step.mq[3];

  document.getElementById('val-x-3').textContent = step.x[0];
  document.getElementById('val-x-2').textContent = step.x[1];
  document.getElementById('val-x-1').textContent = step.x[2];
  document.getElementById('val-x-0').textContent = step.x[3];

  // Counter text in Control Box
  const counterSpan = document.getElementById('ctrl-counter-text');
  counterSpan.innerHTML = `计数器C<tspan font-size="16" dy="4">n</tspan><tspan dy="-4"> = ${step.counter}</tspan>`;
}

function applyStep(step, animate = true) {
  clearCircuitHighlights();

  // 1. Text Status Banner
  document.getElementById('status-step-title').textContent = step.title;
  document.getElementById('status-step-action').textContent = step.actionDesc;
  document.getElementById('status-math-result').textContent = `${State.X} × ${State.Y} = ${State.X * State.Y} (0x${(State.X * State.Y).toString(16).toUpperCase()})`;

  // 2. Active Wires
  step.activeWires.forEach(wireId => {
    const el = document.getElementById(wireId);
    if (el) el.classList.add('active', 'wire-animating');
  });

  // 3. Active Chips
  if (step.activeAlu) {
    document.getElementById('alu-body').classList.add('active');
  }
  if (step.activeCtrl) {
    document.getElementById('ctrl-box').classList.add('active');
  }

  // 4. Physical Bit Sliding Continuous Animation (During Shift Phase)
  if (animate && step.isShiftTransition) {
    animateContinuousBitShift(step);
  } else {
    renderStaticBitValues(step);
  }
}

// 60fps Continuous Physical Bit Sliding Animation
function animateContinuousBitShift(step) {
  const layer = document.getElementById('sliding-bits-layer');
  layer.innerHTML = '';

  // Source positions:
  // Cout: (100, 118)
  // ACC[3..0]: (210, 118), (270, 118), (330, 118), (390, 118)
  // MQ[3..0]: (520, 118), (580, 118), (640, 118), (700, 118)

  const positions = [
    { name: 'cout', x: 100, val: step.prevCout },
    { name: 'a3', x: 210, val: step.prevAcc[0] },
    { name: 'a2', x: 270, val: step.prevAcc[1] },
    { name: 'a1', x: 330, val: step.prevAcc[2] },
    { name: 'a0', x: 390, val: step.prevAcc[3] },
    { name: 'm3', x: 520, val: step.prevMq[0] },
    { name: 'm2', x: 580, val: step.prevMq[1] },
    { name: 'm1', x: 640, val: step.prevMq[2] },
    { name: 'm0', x: 700, val: step.prevMq[3] }
  ];

  // Target positions:
  const targetX = [
    210, // cout -> ACC[3]
    270, // a3 -> a2
    330, // a2 -> a1
    390, // a1 -> a0
    520, // a0 -> m3 (Cross wire gap!)
    580, // m3 -> m2
    640, // m2 -> m1
    700, // m1 -> m0
    760  // m0 -> out
  ];

  // Hide static text during transition
  renderStaticBitValues(step);
  document.getElementById('val-cout').textContent = '';
  document.getElementById('val-acc-3').textContent = '';
  document.getElementById('val-acc-2').textContent = '';
  document.getElementById('val-acc-1').textContent = '';
  document.getElementById('val-acc-0').textContent = '';
  document.getElementById('val-mq-3').textContent = '';
  document.getElementById('val-mq-2').textContent = '';
  document.getElementById('val-mq-1').textContent = '';
  document.getElementById('val-mq-0').textContent = '';

  const tl = gsap.timeline({
    onComplete: () => {
      layer.innerHTML = '';
      renderStaticBitValues(step);
    }
  });

  const dur = (0.7 / State.playbackSpeed);

  positions.forEach((pos, idx) => {
    const textElem = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textElem.setAttribute('x', pos.x);
    textElem.setAttribute('y', 118);
    textElem.setAttribute('class', 'svg-bit-text sliding-token');
    textElem.textContent = pos.val;

    // A0 bit crossing into MQ gets extra amber highlight
    if (pos.name === 'a0') {
      textElem.setAttribute('fill', '#FEF08A');
    }

    layer.appendChild(textElem);

    tl.to(textElem, {
      attr: { x: targetX[idx] },
      opacity: idx === 8 ? 0 : 1, // m0 fades out
      duration: dur,
      ease: 'power2.inOut'
    }, 0);
  });

  State.activeTimeline = tl;
}

function goToStep(index, animate = true) {
  if (index < 0 || index >= State.steps.length) return;
  State.currentStepIndex = index;
  updateTimelineNodes(index);
  applyStep(State.steps[index], animate);
}

function nextStep() {
  if (State.currentStepIndex < State.steps.length - 1) {
    goToStep(State.currentStepIndex + 1, true);
  } else {
    if (State.isPlaying) {
      goToStep(0, true);
    }
  }
}

function prevStep() {
  if (State.currentStepIndex > 0) {
    goToStep(State.currentStepIndex - 1, true);
  }
}

function startPlayback() {
  State.isPlaying = true;
  document.getElementById('play-icon').textContent = '⏸';
  document.getElementById('play-text').textContent = '暂停演示';

  function playLoop() {
    if (!State.isPlaying) return;
    const stepDurationMs = (1400 / State.playbackSpeed);

    if (State.currentStepIndex < State.steps.length - 1) {
      nextStep();
      State.playTimer = setTimeout(playLoop, stepDurationMs);
    } else {
      State.playTimer = setTimeout(() => {
        if (!State.isPlaying) return;
        goToStep(0, true);
        State.playTimer = setTimeout(playLoop, stepDurationMs);
      }, stepDurationMs * 1.5);
    }
  }

  playLoop();
}

function pausePlayback() {
  State.isPlaying = false;
  clearTimeout(State.playTimer);
  document.getElementById('play-icon').textContent = '▶';
  document.getElementById('play-text').textContent = '自动连续演示';
}

function togglePlayback() {
  if (State.isPlaying) {
    pausePlayback();
  } else {
    startPlayback();
  }
}

function recomputeMultiplication() {
  State.steps = generateMultiplicationTrace(State.X, State.Y, State.n);
  initTimeline();
  goToStep(0, false);
}

// ==========================================================================
// 3. EVENT LISTENERS & INITIALIZATION
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  recomputeMultiplication();

  // Preset Formulas Change
  document.getElementById('formula-select').addEventListener('change', (e) => {
    pausePlayback();
    const val = e.target.value;
    if (val === '13x11') { State.X = 13; State.Y = 11; }
    else if (val === '5x3') { State.X = 5; State.Y = 3; }
    else if (val === '7x6') { State.X = 7; State.Y = 6; }
    else if (val === '9x13') { State.X = 9; State.Y = 13; }
    else if (val === '15x15') { State.X = 15; State.Y = 15; }

    document.getElementById('input-x').value = State.X;
    document.getElementById('input-y').value = State.Y;
    recomputeMultiplication();
  });

  // Custom Input Apply
  document.getElementById('btn-apply-custom').addEventListener('click', () => {
    pausePlayback();
    let x = parseInt(document.getElementById('input-x').value, 10);
    let y = parseInt(document.getElementById('input-y').value, 10);
    if (isNaN(x) || x < 0) x = 0;
    if (x > 15) x = 15;
    if (isNaN(y) || y < 0) y = 0;
    if (y > 15) y = 15;

    State.X = x;
    State.Y = y;
    document.getElementById('input-x').value = x;
    document.getElementById('input-y').value = y;
    recomputeMultiplication();
  });

  // Control Buttons
  document.getElementById('btn-play-pause').addEventListener('click', togglePlayback);
  document.getElementById('btn-step-next').addEventListener('click', () => {
    pausePlayback();
    nextStep();
  });
  document.getElementById('btn-step-prev').addEventListener('click', () => {
    pausePlayback();
    prevStep();
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    pausePlayback();
    goToStep(0, false);
  });

  // Speed Slider
  const speedSlider = document.getElementById('speed-slider');
  speedSlider.addEventListener('input', (e) => {
    State.playbackSpeed = parseFloat(e.target.value);
    document.getElementById('speed-val').textContent = State.playbackSpeed.toFixed(1) + 'x';
  });
});
