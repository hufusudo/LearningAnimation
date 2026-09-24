/**
 * IP分组转发的过程与路由查表 - 408 核心交互逻辑与动画引擎
 * 严格遵循 Taste-Skill Light Editorial 设计哲学与 60fps GSAP 动画规范
 */

// ==========================================================================
// 1. 场景与步骤元数据定义
// ==========================================================================

const SCENARIOS = {
  1: {
    id: 1,
    name: "非跨网 (H1 → H1b)",
    title: "场景一：非跨网转发（本地直接交付）",
    desc: "源主机 H1 发送给同网主机 H1b (128.1.2.195)，经交换机直接交付，无需经过路由器",
    srcHost: { name: "H1", ip: "128.1.2.194", mask: "255.255.255.192", prefixLen: 26, net: "128.1.2.192" },
    dstHost: { name: "H1b", ip: "128.1.2.195", mask: "255.255.255.192", prefixLen: 26, net: "128.1.2.192" },
    steps: [
      {
        id: "step-1-1",
        title: "① 提取并二进制 AND",
        desc: "H1 提取目的 IP 128.1.2.195，与自身掩码 /26 进行按位与运算，判断网络号是否相同",
        type: "binary-and"
      },
      {
        id: "step-1-2",
        title: "② H1 发送至交换机 SW1",
        desc: "判定属于同一网络，直接交付！H1 封装数据帧发往本地以太网交换机 SW1",
        type: "forward",
        path: ["H1", "SW1"]
      },
      {
        id: "step-1-3",
        title: "③ SW1 转发至 H1b",
        desc: "SW1 查找本地 MAC 地址表，将帧直接转发给目的主机 H1b，路由器不转发该报文",
        type: "forward",
        path: ["SW1", "H1b"]
      },
      {
        id: "step-1-4",
        title: "④ 交付完成",
        desc: "主机 H1b 成功接收数据包，本地直接交付圆满完成！",
        type: "finish"
      }
    ]
  },
  2: {
    id: 2,
    name: "跨网 1 跳 (H1 → H2 对照原图)",
    title: "场景二：跨网 1 跳转发（间接交付至邻近网络，完全对照原图）",
    desc: "源主机 H1 发送给 N2 网络中的 H2 (128.1.2.132)，由路由器 R1 查表后直接交付",
    srcHost: { name: "H1", ip: "128.1.2.194", mask: "255.255.255.192", prefixLen: 26, net: "128.1.2.192" },
    dstHost: { name: "H2", ip: "128.1.2.132", mask: "255.255.255.192", prefixLen: 26, net: "128.1.2.128" },
    steps: [
      {
        id: "step-2-1",
        title: "① 提取并二进制 AND",
        desc: "H1 提取目的 IP 128.1.2.132，与自身掩码 /26 进行按位与，结果为 128.1.2.128，与源网络号不同",
        type: "binary-and"
      },
      {
        id: "step-2-2",
        title: "② H1 发送至网关 R1",
        desc: "判定不在同一网络，属于间接交付！H1 将 IP 分组发往默认网关 R1 接口 0 (128.1.2.193)",
        type: "forward",
        path: ["H1", "SW1", "R1_IF0"]
      },
      {
        id: "step-2-3",
        title: "③ 路由器 R1 查表",
        desc: "R1 逐行检查路由表，用目的 IP 与各表项掩码 AND，匹配到 128.1.2.128/26 (出接口 1)",
        type: "router-lookup",
        router: "R1"
      },
      {
        id: "step-2-4",
        title: "④ R1 转发至 SW2",
        desc: "R1 TTL 减 1，从接口 1 (128.1.2.129) 将分组发往 N2 网络交换机 SW2",
        type: "forward",
        path: ["R1_IF1", "SW2"]
      },
      {
        id: "step-2-5",
        title: "⑤ SW2 交付至 H2",
        desc: "SW2 将数据帧准确转发至目的主机 H2 (128.1.2.132)，跨网直接交付完成！",
        type: "forward",
        path: ["SW2", "H2"]
      },
      {
        id: "step-2-6",
        title: "⑥ 交付完成",
        desc: "主机 H2 成功接收分组，源 IP (128.1.2.194) 与目的 IP (128.1.2.132) 全程保持不变！",
        type: "finish"
      }
    ]
  },
  3: {
    id: 3,
    name: "跨网 2 跳 (H1 → H3 双路由)",
    title: "场景三：跨网 2 跳转发（多路由连续查表转发）",
    desc: "源主机 H1 发送给 N3 网络中的 H3 (128.1.3.66)，依次经 R1 查表转发至 R2，再由 R2 交付",
    srcHost: { name: "H1", ip: "128.1.2.194", mask: "255.255.255.192", prefixLen: 26, net: "128.1.2.192" },
    dstHost: { name: "H3", ip: "128.1.3.66", mask: "255.255.255.192", prefixLen: 26, net: "128.1.3.64" },
    steps: [
      {
        id: "step-3-1",
        title: "① 提取并二进制 AND",
        desc: "H1 提取目的 IP 128.1.3.66，与掩码 /26 按位与，结果为 128.1.3.64，不在 N1，交由默认网关 R1",
        type: "binary-and"
      },
      {
        id: "step-3-2",
        title: "② H1 发送至网关 R1",
        desc: "H1 发送数据包经 SW1 送达路由器 R1 的接口 0 (128.1.2.193)",
        type: "forward",
        path: ["H1", "SW1", "R1_IF0"]
      },
      {
        id: "step-3-3",
        title: "③ 路由器 R1 查表",
        desc: "R1 检查路由表，匹配到 128.1.3.64/26，下一跳为 R2 (128.1.2.130)，由接口 1 发出",
        type: "router-lookup",
        router: "R1"
      },
      {
        id: "step-3-4",
        title: "④ R1 经 N2 转发至 R2",
        desc: "R1 TTL 减 1，经接口 1 发出，通过 N2 网络送达下一跳路由器 R2 的接口 0 (128.1.2.130)",
        type: "forward",
        path: ["R1_IF1", "SW2", "R2_IF0"]
      },
      {
        id: "step-3-5",
        title: "⑤ 路由器 R2 查表",
        desc: "R2 检查自身路由表，匹配到 128.1.3.64/26 为直连网络，出接口为接口 1 (128.1.3.65)",
        type: "router-lookup",
        router: "R2"
      },
      {
        id: "step-3-6",
        title: "⑥ R2 转发至 H3",
        desc: "R2 TTL 再次减 1，从接口 1 发出，经 SW3 最终送达目的主机 H3 (128.1.3.66)",
        type: "forward",
        path: ["R2_IF1", "SW3", "H3"]
      },
      {
        id: "step-3-7",
        title: "⑦ 交付完成",
        desc: "主机 H3 成功接收分组！经历 2 次跨网路由跳转，TTL 减 2，MAC 换 3 次，IP 地址始终不变！",
        type: "finish"
      }
    ]
  }
};

// 路由表配置 (符合 408 标准与原图)
const ROUTING_TABLES = {
  R1: [
    { prefix: "128.1.2.192/26", net: "128.1.2.192", mask: "255.255.255.192", nextHop: "直接交付", iface: "接口 0 (128.1.2.193)", type: "direct" },
    { prefix: "128.1.2.128/26", net: "128.1.2.128", mask: "255.255.255.192", nextHop: "直接交付", iface: "接口 1 (128.1.2.129)", type: "direct" },
    { prefix: "128.1.3.64/26",  net: "128.1.3.64",  mask: "255.255.255.192", nextHop: "R2 (128.1.2.130)", iface: "接口 1 (128.1.2.129)", type: "indirect" }
  ],
  R2: [
    { prefix: "128.1.2.128/26", net: "128.1.2.128", mask: "255.255.255.192", nextHop: "直接交付", iface: "接口 0 (128.1.2.130)", type: "direct" },
    { prefix: "128.1.3.64/26",  net: "128.1.3.64",  mask: "255.255.255.192", nextHop: "直接交付", iface: "接口 1 (128.1.3.65)",  type: "direct" },
    { prefix: "128.1.2.192/26", net: "128.1.2.192", mask: "255.255.255.192", nextHop: "R1 (128.1.2.129)", iface: "接口 0 (128.1.2.130)", type: "indirect" }
  ]
};

// SVG 节点绝对坐标映射表
const NODE_COORDINATES = {
  H1: { x: 80, y: 101 },
  H1b: { x: 80, y: 231 },
  SW1: { x: 196, y: 166 },
  R1_IF0: { x: 316, y: 166 },
  R1_CENTER: { x: 356, y: 166 },
  R1_IF1: { x: 396, y: 166 },
  SW2: { x: 521, y: 166 },
  H2: { x: 575, y: 231 },
  R2_IF0: { x: 676, y: 166 },
  R2_CENTER: { x: 716, y: 166 },
  R2_IF1: { x: 756, y: 166 },
  SW3: { x: 861, y: 166 },
  H3: { x: 965, y: 101 },
  H3b: { x: 965, y: 231 }
};

// ==========================================================================
// 2. 状态机与全局变量
// ==========================================================================

let currentScenarioId = 1;
let currentStepIndex = 0;
let isPlaying = false;
let playSpeed = 1.0;
let playTimer = null;
let currentTimeline = null;

// ==========================================================================
// 3. 辅助数学与二进制工具函数
// ==========================================================================

function ipToBinaryArray(ipStr) {
  return ipStr.split('.').map(num => {
    return parseInt(num, 10).toString(2).padStart(8, '0');
  });
}

function binaryArrayToIp(binArr) {
  return binArr.map(b => parseInt(b, 2)).join('.');
}

function bitwiseAndIp(ip1, ip2) {
  const b1 = ipToBinaryArray(ip1);
  const b2 = ipToBinaryArray(ip2);
  const res = [];
  for (let i = 0; i < 4; i++) {
    let byteRes = '';
    for (let j = 0; j < 8; j++) {
      byteRes += (b1[i][j] === '1' && b2[i][j] === '1') ? '1' : '0';
    }
    res.push(byteRes);
  }
  return binaryArrayToIp(res);
}

// ==========================================================================
// 4. 界面初始化与控制逻辑
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initScenario(1);
});

function switchScenario(id) {
  if (isPlaying) togglePlay();
  currentScenarioId = id;
  currentStepIndex = 0;

  // 更新胶囊按钮状态
  [1, 2, 3].forEach(i => {
    const btn = document.getElementById(`scenario-btn-${i}`);
    if (i === id) {
      btn.className = "px-3 py-1.5 rounded-lg font-bold transition-all bg-white text-stone-900 shadow-sm";
    } else {
      btn.className = "px-3 py-1.5 rounded-lg font-medium text-stone-600 hover:text-stone-900 transition-all";
    }
  });

  initScenario(id);
}

function initScenario(id) {
  const scenario = SCENARIOS[id];
  currentStepIndex = 0;

  // 更新拓扑区域标题
  document.getElementById('topology-title').textContent = scenario.title;
  document.getElementById('topology-desc').textContent = scenario.desc;

  // 渲染步骤指示栏
  renderStepIndicators(scenario);

  // 初始化二进制推演面板（初始空白）
  initBinaryAndPanel(scenario);

  // 初始化路由表面板
  initRoutingTablePanel("R1");

  // 复位 SVG 动效元素
  resetSvgElements();

  // 初始步骤
  renderStep(0);
}

function renderStepIndicators(scenario) {
  const container = document.getElementById('step-indicators');
  container.innerHTML = '';
  scenario.steps.forEach((step, idx) => {
    const btn = document.createElement('button');
    btn.id = `step-indicator-${idx}`;
    btn.className = `px-2.5 py-1 rounded-md text-[11px] font-mono transition-all whitespace-nowrap ${
      idx === 0
        ? 'bg-stone-900 text-white font-bold shadow-sm'
        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
    }`;
    btn.textContent = step.title;
    btn.onclick = () => jumpToStep(idx, false);
    container.appendChild(btn);
  });
}

function jumpToStep(idx, fromAutoPlay = false) {
  // 如果非自动播放触发跳转且正在自动播放，暂停播放
  if (!fromAutoPlay && isPlaying) {
    togglePlay();
  }

  if (playTimer) {
    clearTimeout(playTimer);
    playTimer = null;
  }
  if (currentTimeline) {
    currentTimeline.kill();
    currentTimeline = null;
  }

  currentStepIndex = idx;
  renderStep(idx);
}

function stepNext(fromAutoPlay = false) {
  const scenario = SCENARIOS[currentScenarioId];
  if (currentStepIndex < scenario.steps.length - 1) {
    jumpToStep(currentStepIndex + 1, fromAutoPlay);
  } else {
    // 已经到达末尾，停止自动播放
    if (isPlaying) togglePlay();
  }
}

function stepPrev() {
  if (currentStepIndex > 0) {
    jumpToStep(currentStepIndex - 1, false);
  }
}

function resetCurrentScenario() {
  if (isPlaying) togglePlay();
  jumpToStep(0, false);
}

function togglePlay() {
  isPlaying = !isPlaying;
  const playIcon = document.getElementById('play-icon');
  const playText = document.getElementById('play-text');
  const playBtn = document.getElementById('btn-play-pause');

  if (isPlaying) {
    playIcon.textContent = "⏸";
    playText.textContent = "暂停播放";
    playBtn.classList.remove('btn-tactile-primary');
    playBtn.classList.add('bg-amber-600', 'text-white', 'border-amber-700');

    // 如果当前已经是最后一步，从第0步重新开始
    const scenario = SCENARIOS[currentScenarioId];
    if (currentStepIndex >= scenario.steps.length - 1) {
      currentStepIndex = 0;
    }
    renderStep(currentStepIndex);
  } else {
    playIcon.textContent = "▶";
    playText.textContent = "自动播放";
    playBtn.classList.add('btn-tactile-primary');
    playBtn.classList.remove('bg-amber-600', 'text-white', 'border-amber-700');
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    if (currentTimeline) {
      currentTimeline.pause();
    }
  }
}

function setSpeed(speed) {
  playSpeed = speed;
  ['05', '10', '15'].forEach(s => {
    const btn = document.getElementById(`speed-${s}`);
    if (parseFloat(btn.textContent) === speed) {
      btn.className = "px-1.5 py-0.5 rounded border border-stone-900 bg-stone-900 text-white";
    } else {
      btn.className = "px-1.5 py-0.5 rounded border border-stone-200 hover:bg-stone-100";
    }
  });
}

function onStepAnimationComplete() {
  if (isPlaying) {
    const pauseTime = 1200 / playSpeed;
    playTimer = setTimeout(() => {
      if (isPlaying) {
        stepNext(true);
      }
    }, pauseTime);
  }
}

// ==========================================================================
// 5. 二进制按位与 (AND) 推演面板动画与渲染
// ==========================================================================

function initBinaryAndPanel(scenario) {
  // 刚开始下面的判断空白
  const placeholder = document.getElementById('and-placeholder');
  const canvas = document.getElementById('and-canvas');
  if (placeholder) placeholder.classList.remove('hidden');
  if (canvas) canvas.classList.add('hidden');

  const statusTag = document.getElementById('and-status-tag');
  if (statusTag) {
    statusTag.textContent = "等待开始";
    statusTag.className = "px-2 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200";
  }
}

function renderBitsRow(containerId, binArr, prefixLen) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  let totalBitIdx = 0;
  binArr.forEach((byteStr, byteIdx) => {
    // 字节内 8 位
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      const bitVal = byteStr[bitIdx];
      const isPrefix = totalBitIdx < prefixLen;
      const span = document.createElement('span');
      span.className = `bit-box ${isPrefix ? 'bit-box-prefix' : 'bit-box-host'}`;
      if (totalBitIdx === 25) {
        span.classList.add('prefix-boundary-line');
      }
      span.id = `${containerId}-b${totalBitIdx}`;
      span.textContent = bitVal;
      span.title = `第 ${totalBitIdx + 1} 位: ${isPrefix ? '网络号部分 (前26位)' : '主机号部分 (后6位)'}`;
      container.appendChild(span);
      totalBitIdx++;
    }

    // 字节分隔点
    if (byteIdx < 3) {
      const dot = document.createElement('span');
      dot.className = "text-stone-400 font-bold px-0.5 self-center text-[10px]";
      dot.textContent = "•";
      container.appendChild(dot);
    }
  });
}

// 浮动飞入 IP 动画辅助函数 (从上方 SVG 节点飞至下方推演面板)
function flyElementFromNode(sourceElId, targetEl, text, badgeBgClass) {
  const sourceEl = document.getElementById(sourceElId);
  if (!sourceEl || !targetEl) return gsap.timeline();

  const srcRect = sourceEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();

  const flyingBadge = document.createElement('div');
  flyingBadge.className = `fixed z-50 px-3.5 py-1.5 rounded-xl font-mono font-bold text-xs text-white shadow-xl pointer-events-none floating-ip-badge ${badgeBgClass}`;
  flyingBadge.innerHTML = `<span class="mr-1 opacity-80">📍</span>${text}`;
  document.body.appendChild(flyingBadge);

  gsap.set(flyingBadge, {
    left: srcRect.left + srcRect.width / 2,
    top: srcRect.top + srcRect.height / 2,
    xPercent: -50,
    yPercent: -50,
    scale: 0.6,
    opacity: 0
  });

  const tl = gsap.timeline({
    onComplete: () => {
      flyingBadge.remove();
    }
  });

  tl.to(flyingBadge, {
    opacity: 1,
    scale: 1.15,
    duration: 0.35 / playSpeed,
    ease: "back.out(2)"
  })
  .to(flyingBadge, {
    left: targetRect.left + 140,
    top: targetRect.top + 20,
    scale: 1,
    duration: 0.8 / playSpeed,
    ease: "power2.inOut"
  })
  .to(flyingBadge, {
    opacity: 0,
    scale: 0.9,
    duration: 0.15 / playSpeed
  });

  return tl;
}

function animateBinaryAndStep(onComplete) {
  if (currentTimeline) {
    currentTimeline.kill();
    currentTimeline = null;
  }

  const scenario = SCENARIOS[currentScenarioId];
  const srcIp = scenario.srcHost.ip;       // "128.1.2.194"
  const maskIp = scenario.srcHost.mask;     // "255.255.255.192"
  const srcNet = scenario.srcHost.net;     // "128.1.2.192"
  const destIp = scenario.dstHost.ip;      // "128.1.2.132" 等
  const prefixLen = scenario.srcHost.prefixLen; // 26

  const srcBin = ipToBinaryArray(srcIp);
  const maskBin = ipToBinaryArray(maskIp);
  const destBin = ipToBinaryArray(destIp);
  const calcNet = bitwiseAndIp(destIp, maskIp);
  const calcBin = ipToBinaryArray(calcNet);
  const isMatch = (calcNet === srcNet);

  // 目的主机节点 ID
  const dstNodeId = (currentScenarioId === 1 ? 'node-H1b' : (currentScenarioId === 2 ? 'node-H2' : 'node-H3'));

  // 显示推演画布，隐藏空白占位符
  const placeholder = document.getElementById('and-placeholder');
  const canvas = document.getElementById('and-canvas');
  if (placeholder) placeholder.classList.add('hidden');
  if (canvas) canvas.classList.remove('hidden');

  const statusTag = document.getElementById('and-status-tag');
  const stageText = document.getElementById('and-stage-text');
  const maskRowLabel = document.getElementById('mask-row-label');
  const maskIpDecimal = document.getElementById('mask-ip-decimal');
  const destIpDecimal = document.getElementById('dest-ip-decimal');
  const calcNetDecimal = document.getElementById('calc-net-decimal');
  const compEl = document.getElementById('and-compare-result');
  const conclusionEl = document.getElementById('and-conclusion-box');

  statusTag.textContent = "推演中...";
  statusTag.className = "px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold";

  // 复位行状态与发光样式
  const rowDest = document.getElementById('row-dest-ip');
  const rowMask = document.getElementById('row-mask-ip');
  const calcDivider = document.getElementById('and-calc-divider');
  const rowCalc = document.getElementById('row-calc-net');
  const rowCompare = document.getElementById('row-compare');

  rowCompare.classList.remove('match-glow-green', 'match-glow-red');
  conclusionEl.classList.remove('match-glow-green', 'match-glow-red');

  gsap.set([rowDest, rowMask, calcDivider, rowCalc, rowCompare, conclusionEl], {
    opacity: 0,
    y: 10
  });

  // 预装填初始数据
  renderBitsRow('dest-ip-bits', destBin, prefixLen);
  renderBitsRow('mask-ip-bits', srcBin, prefixLen); // 首先渲染源主机 IP 的二进制
  renderBitsRow('calc-net-bits', Array(4).fill('00000000'), prefixLen);

  currentTimeline = gsap.timeline({
    onComplete: () => {
      statusTag.textContent = isMatch ? "推演完成 (匹配)" : "推演完成 (不匹配)";
      statusTag.className = isMatch
        ? "px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold"
        : "px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 font-bold";
      if (onComplete) onComplete();
    }
  });

  // -------------------------------------------------------------
  // 阶段 1：上方的源主机 IP (128.1.2.194) 移下来，渐渐展开为二进制
  // -------------------------------------------------------------
  currentTimeline.call(() => {
    stageText.textContent = `① 从上方提取源主机 H1 IP (${srcIp})，飞入推演区...`;
    gsap.fromTo('#node-H1', { scale: 1.1 }, { scale: 1, duration: 0.4 / playSpeed, ease: "back.out(2)" });
  });

  // 飞行动画从上方 H1 飞至下方 rowMask
  currentTimeline.add(flyElementFromNode('node-H1', rowMask, `源主机 IP: ${srcIp}`, 'bg-blue-600 shadow-blue-400/50'));

  currentTimeline.call(() => {
    stageText.textContent = `① 源主机 H1 (IP: ${srcIp}) 展开为 32 位二进制 (前26位网络号，后6位主机号)`;
    maskRowLabel.innerHTML = `<span class="w-2 h-2 rounded-full bg-blue-500"></span> 源主机 H1 IP`;
    maskIpDecimal.textContent = srcIp;
    maskIpDecimal.className = "text-blue-700 font-bold text-sm bg-blue-50 px-2 py-0.5 rounded border border-blue-200";
    renderBitsRow('mask-ip-bits', srcBin, prefixLen);
  })
  .to(rowMask, {
    opacity: 1,
    y: 0,
    duration: 0.5 / playSpeed,
    ease: "power2.out"
  })
  // 32 位二进制平滑展开
  .fromTo('#mask-ip-bits .bit-box', {
    scale: 0.4,
    opacity: 0,
    y: -8
  }, {
    scale: 1,
    opacity: 1,
    y: 0,
    stagger: 0.015 / playSpeed,
    duration: 0.35 / playSpeed,
    ease: "back.out(2)"
  });

  // -------------------------------------------------------------
  // 阶段 2：然后再渐渐的变为子网掩码 (显眼渐进式翻转动效，杜绝跳变)
  // -------------------------------------------------------------
  currentTimeline.to({}, { duration: 0.5 / playSpeed })
  .call(() => {
    stageText.textContent = `② 依据 /${prefixLen} 前缀渐变生成子网掩码：前 26 位全部置 1，后 6 位全部置 0`;
    maskRowLabel.innerHTML = `<span class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span> 渐变为子网掩码 (/26)`;
  });

  // 字节 0 (第 0~7 位): 翻转为 1，十进制 128 -> 255
  currentTimeline.to({}, {
    duration: 0.25 / playSpeed,
    onStart: () => {
      for (let b = 0; b < 8; b++) {
        const el = document.getElementById(`mask-ip-bits-b${b}`);
        if (el) {
          el.classList.add('mask-flip-one');
          el.textContent = '1';
        }
      }
      maskIpDecimal.innerHTML = `<span class="text-blue-700 font-extrabold bg-blue-100 px-1 rounded">255</span>.1.2.194`;
    }
  })
  .to('#mask-ip-bits .bit-box', {
    duration: 0.15 / playSpeed,
    onComplete: () => {
      for (let b = 0; b < 8; b++) {
        const el = document.getElementById(`mask-ip-bits-b${b}`);
        if (el) el.classList.remove('mask-flip-one');
      }
    }
  });

  // 字节 1 (第 8~15 位): 翻转为 1，十进制 1 -> 255
  currentTimeline.to({}, {
    duration: 0.25 / playSpeed,
    onStart: () => {
      for (let b = 8; b < 16; b++) {
        const el = document.getElementById(`mask-ip-bits-b${b}`);
        if (el) {
          el.classList.add('mask-flip-one');
          el.textContent = '1';
        }
      }
      maskIpDecimal.innerHTML = `255.<span class="text-blue-700 font-extrabold bg-blue-100 px-1 rounded">255</span>.2.194`;
    }
  })
  .to('#mask-ip-bits .bit-box', {
    duration: 0.15 / playSpeed,
    onComplete: () => {
      for (let b = 8; b < 16; b++) {
        const el = document.getElementById(`mask-ip-bits-b${b}`);
        if (el) el.classList.remove('mask-flip-one');
      }
    }
  });

  // 字节 2 (第 16~23 位): 翻转为 1，十进制 2 -> 255
  currentTimeline.to({}, {
    duration: 0.25 / playSpeed,
    onStart: () => {
      for (let b = 16; b < 24; b++) {
        const el = document.getElementById(`mask-ip-bits-b${b}`);
        if (el) {
          el.classList.add('mask-flip-one');
          el.textContent = '1';
        }
      }
      maskIpDecimal.innerHTML = `255.255.<span class="text-blue-700 font-extrabold bg-blue-100 px-1 rounded">255</span>.194`;
    }
  })
  .to('#mask-ip-bits .bit-box', {
    duration: 0.15 / playSpeed,
    onComplete: () => {
      for (let b = 16; b < 24; b++) {
        const el = document.getElementById(`mask-ip-bits-b${b}`);
        if (el) el.classList.remove('mask-flip-one');
      }
    }
  });

  // 字节 3 (第 24~31 位，子网分界字节！): 前 2 位翻为 1，后 6 位翻为 0，十进制 194 -> 192
  currentTimeline.to({}, {
    duration: 0.35 / playSpeed,
    onStart: () => {
      // 位 24, 25: 属于前 26 位网络前缀 -> 翻为 1
      for (let b = 24; b < 26; b++) {
        const el = document.getElementById(`mask-ip-bits-b${b}`);
        if (el) {
          el.classList.add('mask-flip-one');
          el.textContent = '1';
        }
      }
      // 位 26~31: 属于后 6 位主机号 -> 翻为 0
      for (let b = 26; b < 32; b++) {
        const el = document.getElementById(`mask-ip-bits-b${b}`);
        if (el) {
          el.classList.add('mask-flip-zero');
          el.textContent = '0';
        }
      }
      maskIpDecimal.innerHTML = `255.255.255.<span class="text-amber-700 font-extrabold bg-amber-100 px-1 rounded">192</span> (/26)`;
    }
  })
  .to('#mask-ip-bits .bit-box', {
    duration: 0.25 / playSpeed,
    onComplete: () => {
      for (let b = 24; b < 26; b++) {
        const el = document.getElementById(`mask-ip-bits-b${b}`);
        if (el) el.classList.remove('mask-flip-one');
      }
      for (let b = 26; b < 32; b++) {
        const el = document.getElementById(`mask-ip-bits-b${b}`);
        if (el) el.classList.remove('mask-flip-zero');
      }
    }
  })
  // 掩码整体完成，定型收尾
  .call(() => {
    maskRowLabel.innerHTML = `<span class="w-2 h-2 rounded-full bg-stone-600"></span> 源主机子网掩码 (Mask /${prefixLen})`;
    maskIpDecimal.textContent = `${maskIp} (/${prefixLen})`;
    maskIpDecimal.className = "text-stone-800 font-bold text-sm bg-stone-100 px-2 py-0.5 rounded border border-stone-300";
    gsap.fromTo(maskIpDecimal, { scale: 1.25 }, { scale: 1, duration: 0.3 / playSpeed, ease: "back.out(2)" });
  });

  // -------------------------------------------------------------
  // 阶段 3：上方的目的主机 IP 移下来，渐渐展开为二进制
  // -------------------------------------------------------------
  currentTimeline.to({}, { duration: 0.4 / playSpeed })
  .call(() => {
    stageText.textContent = `③ 从上方提取目的主机 ${scenario.dstHost.name} IP (${destIp})，飞入推演区...`;
    gsap.fromTo(`#${dstNodeId}`, { scale: 1.1 }, { scale: 1, duration: 0.4 / playSpeed, ease: "back.out(2)" });
  });

  // 飞行动画从上方目的主机飞至下方 rowDest
  currentTimeline.add(flyElementFromNode(dstNodeId, rowDest, `目的主机 IP: ${destIp}`, 'bg-indigo-600 shadow-indigo-400/50'));

  currentTimeline.call(() => {
    stageText.textContent = `③ 目的主机 IP (${destIp}) 展开为 32 位二进制 (前26位网络号，后6位主机号)`;
    destIpDecimal.textContent = destIp;
    renderBitsRow('dest-ip-bits', destBin, prefixLen);
  })
  .to(rowDest, {
    opacity: 1,
    y: 0,
    duration: 0.5 / playSpeed,
    ease: "power2.out"
  })
  .fromTo('#dest-ip-bits .bit-box', {
    scale: 0.4,
    opacity: 0,
    y: -8
  }, {
    scale: 1,
    opacity: 1,
    y: 0,
    stagger: 0.015 / playSpeed,
    duration: 0.35 / playSpeed,
    ease: "back.out(2)"
  });

  // -------------------------------------------------------------
  // 阶段 4：与子网掩码从开始按位相与，相与是有显眼的动画！
  // -------------------------------------------------------------
  currentTimeline.to({}, { duration: 0.5 / playSpeed })
  .call(() => {
    stageText.textContent = `④ 目的 IP 与子网掩码逐位相与 (AND)：1 & 1 = 1，其他皆为 0`;
    calcNetDecimal.textContent = "逐位相与计算中...";
    calcNetDecimal.className = "text-amber-700 font-bold text-sm bg-amber-50 px-2 py-0.5 rounded border border-amber-200 animate-pulse";
  })
  .to([calcDivider, rowCalc], {
    opacity: 1,
    y: 0,
    duration: 0.4 / playSpeed,
    ease: "power2.out"
  });

  // 显眼按位与动画：从第 0 位到第 31 位扫过去
  const calcFlatBits = calcBin.join('');
  for (let b = 0; b < 32; b++) {
    const isSlowDetailed = (b >= 24); // 第 4 字节特写
    const stepDuration = isSlowDetailed ? (0.14 / playSpeed) : (0.03 / playSpeed);

    currentTimeline.to({}, {
      duration: stepDuration,
      onStart: () => {
        const dEl = document.getElementById(`dest-ip-bits-b${b}`);
        const mEl = document.getElementById(`mask-ip-bits-b${b}`);
        const cEl = document.getElementById(`calc-net-bits-b${b}`);

        if (dEl && mEl && cEl) {
          dEl.classList.add('bit-box-active');
          mEl.classList.add('bit-box-active');

          cEl.textContent = calcFlatBits[b];
          cEl.classList.add('bit-box-laser');

          gsap.fromTo(cEl, { scale: 1.6, opacity: 0.4 }, {
            scale: 1,
            opacity: 1,
            duration: 0.2 / playSpeed,
            ease: "back.out(2)",
            onComplete: () => {
              cEl.classList.remove('bit-box-laser');
              dEl.classList.remove('bit-box-active');
              mEl.classList.remove('bit-box-active');
            }
          });
        }
      }
    });
  }

  // -------------------------------------------------------------
  // 阶段 5：相与得到的二进制在渐渐变为 IP 地址
  // -------------------------------------------------------------
  currentTimeline.to({}, { duration: 0.5 / playSpeed })
  .call(() => {
    stageText.textContent = `⑤ 二进制按 8 位一组，渐变还原为点分十进制网络号 ${calcNet}/${prefixLen}`;
  })
  .to('#calc-net-bits .bit-box', {
    scale: 1.15,
    stagger: 0.015 / playSpeed,
    yoyo: true,
    repeat: 1,
    duration: 0.15 / playSpeed
  })
  .call(() => {
    calcNetDecimal.textContent = `${calcNet}/${prefixLen}`;
    calcNetDecimal.className = "text-emerald-700 font-bold text-sm bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200";
    gsap.fromTo(calcNetDecimal, { scale: 1.35 }, { scale: 1, duration: 0.35 / playSpeed, ease: "back.out(2)" });
  });

  // -------------------------------------------------------------
  // 阶段 6：最终判断是否在一个网络 (显眼的匹配/不匹配动画：匹配为绿，不匹配为红)
  // -------------------------------------------------------------
  currentTimeline.to({}, { duration: 0.5 / playSpeed })
  .call(() => {
    stageText.textContent = `⑥ 最终比对：提取网络号 (${calcNet}) 与源网络号 (${srcNet}) 是否匹配？`;
    document.getElementById('src-net-decimal').textContent = `${srcNet}/${prefixLen}`;

    if (isMatch) {
      // 匹配为绿色！显眼动画
      rowCompare.classList.add('match-glow-green');
      conclusionEl.classList.add('match-glow-green');

      compEl.innerHTML = `<span class="flex items-center gap-1 text-emerald-800 font-extrabold text-sm"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>✔ 匹配成功 (绿色)</span>`;
      compEl.className = "px-3 py-1 rounded-lg bg-emerald-100 border border-emerald-400 shadow-sm";

      for (let b = 0; b < prefixLen; b++) {
        const cEl = document.getElementById(`calc-net-bits-b${b}`);
        if (cEl) cEl.classList.add('bit-box-match');
      }

      conclusionEl.className = "p-3.5 rounded-xl border text-xs leading-relaxed transition-all match-glow-green text-emerald-950";
      conclusionEl.innerHTML = `
        <div class="font-bold flex items-center gap-2 mb-1.5 text-emerald-800 text-sm">
          <span class="text-base">🟢</span> 【匹配成功】源与目的在同一网络 (${calcNet}/26 == ${srcNet}/26)
        </div>
        <p class="text-[12px] text-emerald-900 leading-normal">
          目的主机 <strong>${scenario.dstHost.name} (${destIp})</strong> 提取所得网络号与源主机 <strong>H1</strong> 完全一致！
        </p>
        <div class="mt-2 text-[11px] text-emerald-900 font-bold bg-emerald-100/90 p-2.5 rounded-lg border border-emerald-300 flex items-center gap-2">
          <span>🚀</span> 判定决策：采取<strong>【同网直接交付 (Direct Delivery)】</strong>，直接通过以太网交换机 SW1 转发给目的主机，无需路由器介入！
        </div>
      `;
    } else {
      // 不匹配为红色！显眼动画
      rowCompare.classList.add('match-glow-red');
      conclusionEl.classList.add('match-glow-red');

      compEl.innerHTML = `<span class="flex items-center gap-1 text-rose-800 font-extrabold text-sm"><span class="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping"></span>✕ 不匹配 (红色)</span>`;
      compEl.className = "px-3 py-1 rounded-lg bg-rose-100 border border-rose-400 shadow-sm";

      const srcBinFlat = ipToBinaryArray(srcNet).join('');
      for (let b = 0; b < prefixLen; b++) {
        const cEl = document.getElementById(`calc-net-bits-b${b}`);
        if (cEl && calcFlatBits[b] !== srcBinFlat[b]) {
          cEl.classList.add('bit-box-mismatch');
        }
      }

      conclusionEl.className = "p-3.5 rounded-xl border text-xs leading-relaxed transition-all match-glow-red text-rose-950";
      conclusionEl.innerHTML = `
        <div class="font-bold flex items-center gap-2 mb-1.5 text-rose-800 text-sm">
          <span class="text-base">🔴</span> 【不匹配】源与目的不在同一网络 (提取网络 ${calcNet}/26 ≠ 源网络 ${srcNet}/26)
        </div>
        <p class="text-[12px] text-rose-900 leading-normal">
          目的主机 <strong>${scenario.dstHost.name} (${destIp})</strong> 位于外网！H1 本地以太网交换机无法直接交付。
        </p>
        <div class="mt-2 text-[11px] text-rose-900 font-bold bg-rose-100/90 p-2.5 rounded-lg border border-rose-300 flex items-center gap-2">
          <span>📡</span> 判定决策：采取<strong>【跨网间接交付 (Indirect Delivery)】</strong>，必须封装为以太网帧，发往默认网关路由器 <strong>R1 接口 0 (128.1.2.193)</strong> 进行路由查表转发！
        </div>
      `;
    }
  })
  .to([rowCompare, conclusionEl], {
    opacity: 1,
    y: 0,
    duration: 0.6 / playSpeed,
    stagger: 0.15 / playSpeed,
    ease: "power2.out"
  });

  return currentTimeline;
}

// ==========================================================================
// 6. 路由器查表动态匹配动画
// ==========================================================================

function initRoutingTablePanel(routerName) {
  document.getElementById('router-table-title').textContent = `② 路由器 ${routerName} 查表动态匹配`;
  const tableBody = document.getElementById('routing-table-body');
  tableBody.innerHTML = '';

  const tableData = ROUTING_TABLES[routerName] || [];
  tableData.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.id = `route-row-${routerName}-${idx}`;
    tr.className = "route-row hover:bg-stone-50 transition-colors";
    tr.innerHTML = `
      <td class="py-2.5 px-2.5 font-bold text-stone-800">${row.prefix}</td>
      <td class="py-2.5 px-2 text-stone-700">${row.nextHop}</td>
      <td class="py-2.5 px-2 text-stone-600">${row.iface}</td>
      <td id="calc-cell-${routerName}-${idx}" class="py-2.5 px-2 text-stone-400 font-mono text-[11px]">-</td>
      <td id="status-cell-${routerName}-${idx}" class="py-2.5 px-2 text-center text-stone-400 font-bold">-</td>
    `;
    tableBody.appendChild(tr);
  });

  const statusTag = document.getElementById('lookup-status-tag');
  statusTag.textContent = "就绪";
  statusTag.className = "text-[11px] font-mono px-2 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200";

  const conclusionBox = document.getElementById('lookup-conclusion-box');
  conclusionBox.className = "p-3 rounded-xl border border-stone-200 bg-stone-50 text-xs text-stone-600";
  conclusionBox.innerHTML = `<span class="font-bold text-stone-700">查表状态：</span>当分组到达路由器时，将启动最长前缀匹配查表动画。`;
}

function animateRouterLookup(routerName, destIp, matchedRowIdx, onComplete) {
  if (currentTimeline) {
    currentTimeline.kill();
    currentTimeline = null;
  }

  initRoutingTablePanel(routerName);
  const statusTag = document.getElementById('lookup-status-tag');
  statusTag.textContent = `路由器 ${routerName} 正在逐行查表...`;
  statusTag.className = "text-[11px] font-mono px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold";

  const conclusionBox = document.getElementById('lookup-conclusion-box');
  const tableData = ROUTING_TABLES[routerName];

  currentTimeline = gsap.timeline({
    onComplete: () => {
      if (onComplete) onComplete();
    }
  });

  tableData.forEach((row, idx) => {
    const rowEl = document.getElementById(`route-row-${routerName}-${idx}`);
    const calcCell = document.getElementById(`calc-cell-${routerName}-${idx}`);
    const statusCell = document.getElementById(`status-cell-${routerName}-${idx}`);

    // 计算 Dest IP & 掩码
    const andResult = bitwiseAndIp(destIp, row.mask);
    const isRowMatch = (andResult === row.net);

    // 步骤 1: 光标扫描到此行
    currentTimeline.to(rowEl, {
      backgroundColor: "#FEF3C7",
      duration: 0.3 / playSpeed,
      onStart: () => {
        rowEl.classList.add('scanning');
        calcCell.innerHTML = `<span class="text-amber-800 font-bold">${destIp} & /26 = ${andResult}</span>`;
      }
    }, `+=${0.2 / playSpeed}`);

    // 步骤 2: 判定是否匹配
    currentTimeline.add(() => {
      rowEl.classList.remove('scanning');
      if (isRowMatch) {
        rowEl.classList.add('matched');
        calcCell.innerHTML = `<span class="text-emerald-700 font-bold">${destIp} & /26 = ${andResult} == 前缀</span>`;
        statusCell.innerHTML = `<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">✓ 匹配成功</span>`;
      } else {
        rowEl.classList.add('mismatched');
        calcCell.innerHTML = `<span class="text-stone-400 line-through">${destIp} & /26 = ${andResult} ≠ 前缀</span>`;
        statusCell.innerHTML = `<span class="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 font-bold text-[10px]">✕ 不匹配</span>`;
      }
    }, `+=${0.3 / playSpeed}`);

    // 如果是匹配行，锁定并展示结论
    if (isRowMatch) {
      currentTimeline.add(() => {
        statusTag.textContent = `查表完成：已锁定路由`;
        statusTag.className = "text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold";

        conclusionBox.className = "p-3 rounded-xl border border-emerald-200 bg-emerald-50/80 text-xs text-emerald-950 leading-relaxed";
        conclusionBox.innerHTML = `
          <div class="font-bold text-emerald-800 flex items-center gap-1 mb-1">
            <span>🎯</span> 路由查表命中：${row.prefix}
          </div>
          <p>目的 IP <strong>${destIp}</strong> 与表项子网掩码 AND 运算结果与前缀匹配！</p>
          <div class="mt-1.5 text-[11px] text-emerald-800 font-semibold bg-white/70 p-2 rounded-lg border border-emerald-200">
            &bull; 下一跳方式：<strong>${row.nextHop}</strong><br>
            &bull; 转发接口：<strong>${row.iface}</strong>
          </div>
        `;
      });
    }
  });

  return currentTimeline;
}

// ==========================================================================
// 7. SVG 动效与数据包转发动画
// ==========================================================================

function resetSvgElements() {
  const packetGroup = document.getElementById('packet-group');
  if (packetGroup) {
    gsap.set(packetGroup, { opacity: 0, x: 0, y: 0, scale: 1 });
  }

  // 重置网络高亮边框
  ['rect-N1', 'rect-N2', 'rect-N3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('class', 'network-boundary');
  });

  // 重置连线
  document.querySelectorAll('line[id^="line-"]').forEach(line => {
    line.setAttribute('stroke', '#94A3B8');
    line.setAttribute('stroke-width', '2');
  });

  // 重置状态标签
  const badge = document.getElementById('packet-status-badge');
  badge.innerHTML = `<span class="pulse-led pulse-led-blue"></span><span id="packet-badge-text">准备就绪</span>`;
}

function animatePacketAlongPath(nodeKeys, infoText, onComplete) {
  if (currentTimeline) {
    currentTimeline.kill();
    currentTimeline = null;
  }

  const packetGroup = document.getElementById('packet-group');
  const label = document.getElementById('packet-fly-label');
  const badgeText = document.getElementById('packet-badge-text');

  if (!packetGroup || nodeKeys.length < 2) {
    if (onComplete) onComplete();
    return;
  }

  label.textContent = infoText || "IP 分组转发中...";
  badgeText.textContent = infoText || "数据包正在链路上传输";

  // 获取路径起点与后续各个关键节点
  const startCoord = NODE_COORDINATES[nodeKeys[0]];
  gsap.set(packetGroup, {
    x: startCoord.x,
    y: startCoord.y,
    opacity: 1,
    scale: 0.5
  });

  currentTimeline = gsap.timeline({
    onComplete: () => {
      if (onComplete) onComplete();
    }
  });

  // 弹入数据包
  currentTimeline.to(packetGroup, { scale: 1, duration: 0.2 / playSpeed, ease: "back.out(2)" });

  // 依次补间位移至后续节点
  for (let i = 1; i < nodeKeys.length; i++) {
    const targetCoord = NODE_COORDINATES[nodeKeys[i]];
    const legDistance = Math.hypot(targetCoord.x - NODE_COORDINATES[nodeKeys[i-1]].x, targetCoord.y - NODE_COORDINATES[nodeKeys[i-1]].y);
    const legDuration = Math.max(0.45, (legDistance / 260)) / playSpeed;

    currentTimeline.to(packetGroup, {
      x: targetCoord.x,
      y: targetCoord.y,
      duration: legDuration,
      ease: "power1.inOut"
    });
  }

  return currentTimeline;
}

// ==========================================================================
// 8. 场景步骤主调度渲染函数
// ==========================================================================

function renderStep(stepIndex) {
  const scenario = SCENARIOS[currentScenarioId];
  const step = scenario.steps[stepIndex];

  // 更新步骤指示条高亮
  scenario.steps.forEach((s, idx) => {
    const btn = document.getElementById(`step-indicator-${idx}`);
    if (!btn) return;
    if (idx === stepIndex) {
      btn.className = 'px-2.5 py-1 rounded-md text-[11px] font-mono transition-all whitespace-nowrap bg-stone-900 text-white font-bold shadow-sm';
    } else if (idx < stepIndex) {
      btn.className = 'px-2.5 py-1 rounded-md text-[11px] font-mono transition-all whitespace-nowrap bg-emerald-100 text-emerald-800 font-semibold';
    } else {
      btn.className = 'px-2.5 py-1 rounded-md text-[11px] font-mono transition-all whitespace-nowrap bg-stone-100 text-stone-600 hover:bg-stone-200';
    }
  });

  const badgeText = document.getElementById('packet-badge-text');

  // 根据当前步骤类型执行对应逻辑
  if (step.type === 'binary-and') {
    badgeText.textContent = `步骤 1: 源主机 ${scenario.srcHost.name} 进行二进制相与判断`;
    animateBinaryAndStep(onStepAnimationComplete);
  } else if (step.type === 'forward') {
    badgeText.textContent = step.desc;
    animatePacketAlongPath(step.path, `IP: ${scenario.srcHost.ip} → ${scenario.dstHost.ip}`, onStepAnimationComplete);
  } else if (step.type === 'router-lookup') {
    badgeText.textContent = `路由器 ${step.router} 正在查表匹配下一跳`;
    animateRouterLookup(step.router, scenario.dstHost.ip, 1, onStepAnimationComplete);
  } else if (step.type === 'finish') {
    badgeText.textContent = `交付成功！IP 分组已顺利抵达目的主机 ${scenario.dstHost.name}`;
    const packetGroup = document.getElementById('packet-group');
    if (packetGroup) {
      currentTimeline = gsap.timeline({
        onComplete: () => {
          onStepAnimationComplete();
        }
      });
      currentTimeline.to(packetGroup, {
        scale: 1.4,
        duration: 0.25 / playSpeed,
        yoyo: true,
        repeat: 3,
        ease: "power2.inOut"
      });
    } else {
      onStepAnimationComplete();
    }
  }
}
