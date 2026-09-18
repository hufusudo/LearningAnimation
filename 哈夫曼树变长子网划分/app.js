/**
 * 哈夫曼树与变长子网划分 (VLSM) 核心交互与动画逻辑
 * 408 计算机网络二叉前缀树可视化
 */

// ==========================================================================
// 1. 数据模型与树节点定义
// ==========================================================================
const BASE_NETWORK = "192.168.1.0";
const BASE_PREFIX = 24;

// 树节点定义 (0: root /24, 1-2: /25, 3-6: /26)
const TREE_NODES = {
  root: {
    id: "root",
    label: "192.168.1.0/24",
    cidr: "192.168.1.0/24",
    mask: "255.255.255.0",
    depth: 0,
    prefixLen: 24,
    prefixBits: "",
    range: [0, 255],
    count: 256,
    subBits: "",
    x: 50, // 百分比
    y: 12,
    parent: null,
    children: ["n0", "n1"]
  },
  n0: {
    id: "n0",
    label: "192.168.1.0/25",
    cidr: "192.168.1.0/25",
    mask: "255.255.255.128",
    depth: 1,
    prefixLen: 25,
    prefixBits: "0",
    range: [0, 127],
    count: 128,
    subBits: "0",
    branch: "0",
    x: 25,
    y: 44,
    parent: "root",
    children: ["n00", "n01"]
  },
  n1: {
    id: "n1",
    label: "192.168.1.128/25",
    cidr: "192.168.1.128/25",
    mask: "255.255.255.128",
    depth: 1,
    prefixLen: 25,
    prefixBits: "1",
    range: [128, 255],
    count: 128,
    subBits: "1",
    branch: "1",
    x: 75,
    y: 44,
    parent: "root",
    children: ["n10", "n11"]
  },
  n00: {
    id: "n00",
    label: "192.168.1.0/26",
    cidr: "192.168.1.0/26",
    mask: "255.255.255.192",
    depth: 2,
    prefixLen: 26,
    prefixBits: "00",
    range: [0, 63],
    count: 64,
    subBits: "00",
    branch: "0",
    x: 12.5,
    y: 80,
    parent: "n0",
    children: []
  },
  n01: {
    id: "n01",
    label: "192.168.1.64/26",
    cidr: "192.168.1.64/26",
    mask: "255.255.255.192",
    depth: 2,
    prefixLen: 26,
    prefixBits: "01",
    range: [64, 127],
    count: 64,
    subBits: "01",
    branch: "1",
    x: 37.5,
    y: 80,
    parent: "n0",
    children: []
  },
  n10: {
    id: "n10",
    label: "192.168.1.128/26",
    cidr: "192.168.1.128/26",
    mask: "255.255.255.192",
    depth: 2,
    prefixLen: 26,
    prefixBits: "10",
    range: [128, 191],
    count: 64,
    subBits: "10",
    branch: "0",
    x: 62.5,
    y: 80,
    parent: "n1",
    children: []
  },
  n11: {
    id: "n11",
    label: "192.168.1.192/26",
    cidr: "192.168.1.192/26",
    mask: "255.255.255.192",
    depth: 2,
    prefixLen: 26,
    prefixBits: "11",
    range: [192, 255],
    count: 64,
    subBits: "11",
    branch: "1",
    x: 87.5,
    y: 80,
    parent: "n1",
    children: []
  }
};

// ==========================================================================
// 2. 状态管理
// ==========================================================================
let currentMode = "step"; // 'step' | 'sandbox'
let currentStep = 1;      // 1 ~ 6
let isAutoPlaying = false;
let autoPlayTimer = null;
let animSpeed = 1.0;
let step3Timeline = null;

// 当前检查器聚焦的节点
let activeInspectNodeId = "root";

// 自由探究模式下用户选中的节点
let sandboxSelectedIds = new Set(["n00", "n01", "n1"]);

// 正确示范方案切换 (方案 A: 右大左小; 方案 B: 左大右小)
let correctScheme = "A";

// ==========================================================================
// 3. 初始化入口
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  renderFixedPrefixBits();
  renderTree();
  applyStep(1);

  // 窗口缩放重绘树连接线
  window.addEventListener("resize", () => {
    drawTreeEdges();
  });
});

// ==========================================================================
// 4. 模式切换与播放控制器
// ==========================================================================
function switchMainMode(mode) {
  currentMode = mode;
  stopAutoPlay();

  const tabStep = document.getElementById("tab-mode-step");
  const tabSandbox = document.getElementById("tab-mode-sandbox");
  const stepTimeline = document.getElementById("step-timeline");

  if (mode === "step") {
    tabStep.className = "px-3 py-1.5 rounded-lg font-bold bg-white text-stone-900 shadow-sm transition-all";
    tabSandbox.className = "px-3 py-1.5 rounded-lg font-medium text-stone-600 hover:text-stone-900 transition-all";
    stepTimeline.style.display = "flex";
    applyStep(currentStep);
  } else {
    tabSandbox.className = "px-3 py-1.5 rounded-lg font-bold bg-white text-stone-900 shadow-sm transition-all";
    tabStep.className = "px-3 py-1.5 rounded-lg font-medium text-stone-600 hover:text-stone-900 transition-all";
    stepTimeline.style.display = "none";
    renderSandboxView();
  }
}

function setSpeed(speed) {
  animSpeed = speed;
  document.querySelectorAll("[id^='speed-btn-']").forEach(btn => {
    btn.className = "px-2 py-0.5 rounded border border-stone-200 text-stone-600 hover:border-stone-400";
  });
  const activeBtn = document.getElementById(`speed-btn-${speed === 0.5 ? "05" : speed === 1.0 ? "10" : "15"}`);
  if (activeBtn) {
    activeBtn.className = "px-2 py-0.5 rounded border border-stone-900 bg-stone-900 text-white font-bold";
  }
  if (step3Timeline) {
    step3Timeline.timeScale(animSpeed);
  }
}

function toggleAutoPlay() {
  if (isAutoPlaying) {
    stopAutoPlay();
  } else {
    startAutoPlay();
  }
}

function startAutoPlay() {
  // 如果已处于最后一步，自动重置回第 1 步从头播放
  if (currentStep >= 6) {
    applyStep(1);
  }

  isAutoPlaying = true;
  document.getElementById("play-icon").textContent = "⏸";
  document.getElementById("play-text").textContent = "暂停演示";

  scheduleNextAutoStep();
}

function scheduleNextAutoStep() {
  clearTimeout(autoPlayTimer);
  if (!isAutoPlaying) return;

  // 根据当前所在步骤决定停留推演时间（第3步进位与完全分尽推演需要稍长观察时间）
  const delay = (currentStep === 3 ? 7500 : 4200) / animSpeed;

  autoPlayTimer = setTimeout(() => {
    if (!isAutoPlaying) return;
    if (currentStep < 6) {
      applyStep(currentStep + 1);
      scheduleNextAutoStep();
    } else {
      stopAutoPlay();
    }
  }, delay);
}

function stopAutoPlay() {
  isAutoPlaying = false;
  clearTimeout(autoPlayTimer);
  document.getElementById("play-icon").textContent = "▶";
  document.getElementById("play-text").textContent = "自动连续演示";
}

function goToStep(step) {
  stopAutoPlay();
  applyStep(step);
}

function prevStep() {
  stopAutoPlay();
  if (currentStep > 1) {
    applyStep(currentStep - 1);
  }
}

function nextStep() {
  stopAutoPlay();
  if (currentStep < 6) {
    applyStep(currentStep + 1);
  }
}

function resetToStep(step = 1) {
  stopAutoPlay();
  applyStep(step);
}

// ==========================================================================
// 5. 步骤应用总控 (核心逻辑)
// ==========================================================================
function applyStep(step) {
  currentStep = step;

  // 更新时间线胶囊高亮
  document.querySelectorAll(".step-pill").forEach((pill, idx) => {
    if (idx + 1 === step) {
      pill.classList.add("active");
    } else {
      pill.classList.remove("active");
    }
  });

  // 更新按键可用状态
  document.getElementById("btn-prev").disabled = step === 1;
  document.getElementById("btn-next").disabled = step === 6;

  // 状态与标题配置
  const stepConfigs = {
    1: {
      hint: "阶段 1/6：初始网段点分十进制与32位二进制结构（网络号标红，主机号标绿）",
      badge: "STEP 1",
      title: "设计初始 IP 网段与 32 位二进制结构透视",
      summary: "空间总计: 2^8 = 256 个地址",
      inspectNode: "root",
      visibleLevels: 0,
      selectedNodes: ["root"],
      conflictNodes: []
    },
    2: {
      hint: "阶段 2/6：选取主机号第 1 位作为子网号向下分裂（左分支为 0，右分支为 1）",
      badge: "STEP 2",
      title: "首次二叉分裂：借用 1 位主机号划分两个 /25 子网 (左0右1)",
      summary: "划分子网: 2^1 = 2 个子网，各含 2^7 = 128 个地址",
      inspectNode: "n0",
      visibleLevels: 1,
      selectedNodes: ["n0", "n1"],
      conflictNodes: []
    },
    3: {
      hint: "阶段 3/6：0子网全0~全1推演，+1进位无缝衔接至1子网全0，地址完全分尽证明",
      badge: "STEP 3",
      title: "动画推演：0 子网全 1 加 1 进位穿透至 1 子网全 0，完全分尽证明",
      summary: "无缝衔接: 128 + 128 = 256，无遗漏无重叠",
      inspectNode: "n0",
      visibleLevels: 1,
      selectedNodes: ["n0", "n1"],
      conflictNodes: []
    },
    4: {
      hint: "阶段 4/6：两个 /25 子节点再次二分分裂为 4 个 /26 子网（精简推演）",
      badge: "STEP 4",
      title: "再次向下二分分裂：由上一次讲解可知，其两子节点能分尽父节点",
      summary: "4 个 /26 子网各含 64 地址，64 × 4 = 256",
      inspectNode: "n00",
      visibleLevels: 2,
      selectedNodes: ["n00", "n01", "n10", "n11"],
      conflictNodes: []
    },
    5: {
      hint: "阶段 5/6：【错误示范】选父节点与其子节点，剖析地址重叠冲突与前缀二义性",
      badge: "STEP 5 错误警示",
      title: "错误示范反思：选取父节点与其子节点导致地址重叠与前缀冲突！",
      summary: "严重冲突: 0~63 重叠被选，192~255 缺失丢弃",
      inspectNode: "n0",
      visibleLevels: 2,
      selectedNodes: ["n0", "n00", "n10"], // 选父节点 n0(/25), 子节点 n00(/26), 另一节点 n10(/26)
      conflictNodes: ["n0", "n00"]
    },
    6: {
      hint: "阶段 6/6：【正确示范】选择互不为祖先的 3 个叶子节点，实现无歧义完全瓜分",
      badge: "STEP 6 正确规范",
      title: "正确示范：如何选取 3 个合法的变长子网（叶子节点前缀互斥）",
      summary: "合法方案: 64 + 64 + 128 = 256 完美覆盖",
      inspectNode: correctScheme === "A" ? "n1" : "n0",
      visibleLevels: 2,
      selectedNodes: correctScheme === "A" ? ["n00", "n01", "n1"] : ["n0", "n10", "n11"],
      conflictNodes: []
    }
  };

  const cfg = stepConfigs[step];
  document.getElementById("header-status-hint").textContent = cfg.hint;
  document.getElementById("step-badge").textContent = cfg.badge;
  document.getElementById("step-title").textContent = cfg.title;
  document.getElementById("step-math-summary").textContent = cfg.summary;

  // 更新检查器聚焦的节点
  activeInspectNodeId = cfg.inspectNode;
  updateInspector(activeInspectNodeId);

  // 刷新树图显示状态
  updateTreeVisuals(cfg.visibleLevels, cfg.selectedNodes, cfg.conflictNodes);

  // 刷新地址覆盖条 (平滑连续形变，绝不重新生成 DOM)
  updateAddressStrip(cfg.selectedNodes, cfg.conflictNodes);

  // 渲染下半区步骤详解视口 (平滑交叉淡入淡出)
  transitionStepExplanation(step);
}

// ==========================================================================
// 6. 二进制与检查器卡片渲染 (网络号标红，主机号标绿)
// ==========================================================================
function renderFixedPrefixBits() {
  // 前 24 位网络号固定：192 (11000000) . 168 (10101000) . 1 (00000001)
  const byte1 = "11000000";
  const byte2 = "10101000";
  const byte3 = "00000001";

  const renderByte = (containerId, bitStr, bitOffset) => {
    const el = document.getElementById(containerId);
    el.innerHTML = "";
    for (let i = 0; i < 8; i++) {
      const b = document.createElement("div");
      b.className = "bit-box bit-net";
      b.innerHTML = `<span>${bitStr[i]}</span><span class="bit-idx">${bitOffset + i + 1}</span>`;
      el.appendChild(b);
    }
  };

  renderByte("byte1-container", byte1, 0);
  renderByte("byte2-container", byte2, 8);
  renderByte("byte3-container", byte3, 16);
}

function updateInspector(nodeId) {
  const node = TREE_NODES[nodeId] || TREE_NODES["root"];

  document.getElementById("inspector-cidr-text").textContent = node.cidr;
  document.getElementById("inspector-mask-text").textContent = `子网掩码: ${node.mask}`;
  document.getElementById("inspector-capacity").textContent = `包含 ${node.count} 个 IP 地址 (${node.range[0]} ~ ${node.range[1]})`;
  document.getElementById("inspector-level-badge").textContent = `当前选中 /${node.prefixLen} 节点`;

  // 保持 4 字节的 8 个 DOM 节点持久存在，仅平滑变换样式与文本，避免重绘跳变
  const byte4El = document.getElementById("byte4-container");
  let bitBoxes = byte4El.querySelectorAll(".bit-box");
  if (bitBoxes.length !== 8) {
    byte4El.innerHTML = "";
    for (let i = 0; i < 8; i++) {
      const b = document.createElement("div");
      b.className = "bit-box bit-host";
      b.id = `inspector-bit-${i}`;
      b.innerHTML = `<span class="bit-val">0</span><span class="bit-idx">H${i+1}</span>`;
      byte4El.appendChild(b);
    }
    bitBoxes = byte4El.querySelectorAll(".bit-box");
  }

  const subLen = node.prefixLen - 24; // 借位数量 (0, 1 或 2)

  for (let i = 0; i < 8; i++) {
    const box = bitBoxes[i];
    const valEl = box.querySelector(".bit-val");
    const idxEl = box.querySelector(".bit-idx");
    const bitNum = 25 + i;

    if (i < subLen) {
      // 借用的子网号位
      const bitVal = node.subBits[i] || "0";
      const wasSubnet = box.classList.contains("bit-subnet");
      box.className = "bit-box bit-subnet font-bold";
      if (!wasSubnet) {
        gsap.fromTo(box, { scale: 1.22 }, { scale: 1, duration: 0.35 / animSpeed, ease: "back.out(2)" });
      }
      if (valEl.textContent !== bitVal) {
        valEl.textContent = bitVal;
        gsap.fromTo(valEl, { scale: 1.4, color: "#D97706" }, { scale: 1, color: "#B45309", duration: 0.3 / animSpeed });
      }
      idxEl.textContent = `S${i+1}`;
      box.title = `第 ${bitNum} 位: 子网号位 (借自原主机号)`;
    } else {
      // 剩余主机号位 (绿色)
      const wasSubnet = box.classList.contains("bit-subnet");
      box.className = "bit-box bit-host";
      if (wasSubnet) {
        gsap.fromTo(box, { scale: 0.85 }, { scale: 1, duration: 0.25 / animSpeed });
      }
      valEl.textContent = "0";
      idxEl.textContent = `H${i - subLen + 1}`;
      box.title = `第 ${bitNum} 位: 主机号位 (共 ${8 - subLen} 位)`;
    }
  }
}

// ==========================================================================
// 7. 地址条 (Address Strip 0~255) 丝滑形变 (持久 DOM 结构)
// ==========================================================================
function ensureStripSegments() {
  const stripEl = document.getElementById("address-strip");
  if (!stripEl) return [];
  let segs = stripEl.querySelectorAll(".strip-segment");
  if (segs.length !== 4) {
    stripEl.innerHTML = "";
    for (let i = 0; i < 4; i++) {
      const seg = document.createElement("div");
      seg.className = "strip-segment";
      seg.id = `strip-seg-${i}`;
      stripEl.appendChild(seg);
    }
    segs = stripEl.querySelectorAll(".strip-segment");
  }
  return segs;
}

function updateAddressStrip(selectedNodeIds, conflictNodeIds = []) {
  const segs = ensureStripSegments();
  if (!segs || segs.length < 4) return;

  const setSeg = (idx, widthPct, className, html) => {
    const s = segs[idx];
    s.style.width = `${widthPct}%`;
    s.style.opacity = widthPct > 0 ? "1" : "0";
    s.style.pointerEvents = widthPct > 0 ? "auto" : "none";
    s.style.borderRightWidth = widthPct > 0 && idx < 3 ? "1px" : "0px";
    s.className = `strip-segment ${className}`;
    s.innerHTML = html;
  };

  if (currentStep === 1) {
    setSeg(0, 100, "bg-emerald-600 text-white", "192.168.1.0/24 (全 256 个 IP: 0~255)");
    setSeg(1, 0, "", "");
    setSeg(2, 0, "", "");
    setSeg(3, 0, "", "");
    document.getElementById("coverage-percentage").innerHTML = `<span class="text-emerald-700 font-bold">256 / 256 (100% 完整覆盖)</span>`;
    return;
  }

  if (currentStep === 2 || currentStep === 3) {
    setSeg(0, 50, "bg-sky-600 text-white", "0 子网 /25 (0~127: 128个)");
    setSeg(1, 50, "bg-indigo-600 text-white", "1 子网 /25 (128~255: 128个)");
    setSeg(2, 0, "", "");
    setSeg(3, 0, "", "");
    document.getElementById("coverage-percentage").innerHTML = `<span class="text-emerald-700 font-bold">128 + 128 = 256 (100% 完全分尽)</span>`;
    return;
  }

  if (currentStep === 4) {
    setSeg(0, 25, "bg-sky-600 text-white", "00: 0~63 (64)");
    setSeg(1, 25, "bg-teal-600 text-white", "01: 64~127 (64)");
    setSeg(2, 25, "bg-indigo-600 text-white", "10: 128~191 (64)");
    setSeg(3, 25, "bg-purple-600 text-white", "11: 192~255 (64)");
    document.getElementById("coverage-percentage").innerHTML = `<span class="text-emerald-700 font-bold">64 × 4 = 256 (100% 完全分尽)</span>`;
    return;
  }

  if (currentStep === 5) {
    setSeg(0, 25, "strip-conflict", "⚠️ 0~63 冲突重叠!");
    setSeg(1, 25, "bg-rose-200 text-rose-900", "64~127 父网余部");
    setSeg(2, 25, "bg-indigo-600 text-white", "128~191 (n10)");
    setSeg(3, 25, "strip-hole", "❌ 192~255 缺失!");
    document.getElementById("coverage-percentage").innerHTML = `<span class="text-rose-600 font-bold">前缀冲突！0~63 发生二义性重叠，192~255 碎片丢失</span>`;
    return;
  }

  if (currentStep === 6) {
    if (correctScheme === "A") {
      setSeg(0, 25, "bg-sky-600 text-white", "00: 0~63 (64)");
      setSeg(1, 25, "bg-teal-600 text-white", "01: 64~127 (64)");
      setSeg(2, 50, "bg-indigo-700 text-white", "1: 128~255 (大网 128 个)");
      setSeg(3, 0, "", "");
    } else {
      setSeg(0, 50, "bg-sky-700 text-white", "0: 0~127 (大网 128 个)");
      setSeg(1, 25, "bg-indigo-600 text-white", "10: 128~191 (64)");
      setSeg(2, 25, "bg-purple-600 text-white", "11: 192~255 (64)");
      setSeg(3, 0, "", "");
    }
    document.getElementById("coverage-percentage").innerHTML = `<span class="text-emerald-700 font-bold">64 + 64 + 128 = 256 (100% 互斥且分尽)</span>`;
  }
}

// ==========================================================================
// 8. 二叉前缀树 (SVG 连线 + DOM 节点) 渲染与状态更新
// ==========================================================================
function renderTree() {
  const container = document.getElementById("tree-nodes-container");
  container.innerHTML = "";

  Object.values(TREE_NODES).forEach(node => {
    const el = document.createElement("div");
    el.id = `node-${node.id}`;
    el.className = "tree-node absolute cursor-pointer transform -translate-x-1/2 -translate-y-1/2";
    el.style.left = `${node.x}%`;
    el.style.top = `${node.y}%`;

    el.innerHTML = `
      <div class="flex items-center justify-between gap-1.5 mb-0.5">
        <span class="text-[11px] font-bold font-mono text-stone-900">${node.label}</span>
        <span class="node-tag text-[9px] font-mono px-1 py-0.2 rounded bg-stone-100 text-stone-600">
          /${node.prefixLen}
        </span>
      </div>
      <div class="flex items-center justify-between text-[10px] font-mono text-stone-500 gap-2">
        <span>.${node.range[0]} ~ .${node.range[1]}</span>
        <span class="font-semibold text-stone-700">${node.count} IPs</span>
      </div>
    `;

    // 点击节点
    el.addEventListener("click", () => {
      onNodeClicked(node.id);
    });

    container.appendChild(el);
  });

  // 延时等待 DOM 尺寸就绪后绘制树连接线
  setTimeout(drawTreeEdges, 50);
}

function drawTreeEdges() {
  const svg = document.getElementById("tree-edges-svg");
  if (!svg) return;
  svg.innerHTML = "";

  const containerRect = svg.getBoundingClientRect();
  const width = containerRect.width;
  const height = containerRect.height;

  if (width === 0 || height === 0) return;

  const edges = [
    { parent: "root", child: "n0", bit: "0", color: "#0284C7" },
    { parent: "root", child: "n1", bit: "1", color: "#4F46E5" },
    { parent: "n0", child: "n00", bit: "0", color: "#0284C7" },
    { parent: "n0", child: "n01", bit: "1", color: "#0D9488" },
    { parent: "n1", child: "n10", bit: "0", color: "#6366F1" },
    { parent: "n1", child: "n11", bit: "1", color: "#9333EA" }
  ];

  edges.forEach(edge => {
    const pNode = TREE_NODES[edge.parent];
    const cNode = TREE_NODES[edge.child];

    const x1 = (pNode.x / 100) * width;
    const y1 = (pNode.y / 100) * height + 16;
    const x2 = (cNode.x / 100) * width;
    const y2 = (cNode.y / 100) * height - 16;

    // 创建带丝滑过渡属性的 SVG 分组
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("id", `edge-group-${edge.parent}-${edge.child}`);
    g.style.transition = "opacity 0.45s cubic-bezier(0.16, 1, 0.3, 1), transform 0.45s ease";

    // 贝塞尔曲线连接线
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const cpy = (y1 + y2) / 2;
    const d = `M ${x1} ${y1} C ${x1} ${cpy}, ${x2} ${cpy}, ${x2} ${y2}`;

    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", edge.color);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-dasharray", "4,2");
    path.setAttribute("id", `edge-${edge.parent}-${edge.child}`);
    g.appendChild(path);

    // 0 / 1 分支指示气泡
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    bgRect.setAttribute("cx", midX);
    bgRect.setAttribute("cy", midY);
    bgRect.setAttribute("r", "9");
    bgRect.setAttribute("fill", "#FFFFFF");
    bgRect.setAttribute("stroke", edge.color);
    bgRect.setAttribute("stroke-width", "1.5");
    g.appendChild(bgRect);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", midX);
    text.setAttribute("y", midY + 3.5);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-family", "JetBrains Mono");
    text.setAttribute("font-weight", "bold");
    text.setAttribute("font-size", "10px");
    text.setAttribute("fill", edge.color);
    text.textContent = edge.bit;
    g.appendChild(text);

    svg.appendChild(g);
  });
}

function updateTreeVisuals(visibleLevels, selectedNodes, conflictNodes = []) {
  Object.values(TREE_NODES).forEach(node => {
    const el = document.getElementById(`node-${node.id}`);
    if (!el) return;

    // 清理所有动效类
    el.classList.remove("node-active", "node-selected", "node-conflict", "node-collapsed");

    // 层级可见性
    if (node.depth > visibleLevels) {
      el.classList.add("node-collapsed");
    } else {
      el.classList.remove("node-collapsed");
    }

    // 状态标记
    if (conflictNodes.includes(node.id)) {
      el.classList.add("node-conflict");
      const tag = el.querySelector(".node-tag");
      if (tag) {
        tag.className = "node-tag text-[9px] font-mono px-1 py-0.2 rounded bg-rose-500 text-white font-bold";
        tag.textContent = "冲突!";
      }
    } else if (selectedNodes.includes(node.id)) {
      el.classList.add("node-selected");
      const tag = el.querySelector(".node-tag");
      if (tag) {
        tag.className = "node-tag text-[9px] font-mono px-1 py-0.2 rounded bg-emerald-700 text-white font-bold";
        tag.textContent = "已选中";
      }
    } else {
      const tag = el.querySelector(".node-tag");
      if (tag) {
        tag.className = "node-tag text-[9px] font-mono px-1 py-0.2 rounded bg-stone-100 text-stone-600";
        tag.textContent = `/${node.prefixLen}`;
      }
    }

    if (node.id === activeInspectNodeId) {
      el.classList.add("node-active");
    }
  });

  // 控制连接线显示与隐藏（操作整个 g 分组，淡入淡出更丝滑）
  const setEdgeVis = (groupId, show) => {
    const el = document.getElementById(groupId);
    if (el) {
      el.style.opacity = show ? "1" : "0.06";
      el.style.pointerEvents = show ? "auto" : "none";
    }
  };

  setEdgeVis("edge-group-root-n0", visibleLevels >= 1);
  setEdgeVis("edge-group-root-n1", visibleLevels >= 1);
  setEdgeVis("edge-group-n0-n00", visibleLevels >= 2);
  setEdgeVis("edge-group-n0-n01", visibleLevels >= 2);
  setEdgeVis("edge-group-n1-n10", visibleLevels >= 2);
  setEdgeVis("edge-group-n1-n11", visibleLevels >= 2);
}

function onNodeClicked(nodeId) {
  activeInspectNodeId = nodeId;
  updateInspector(nodeId);

  if (currentMode === "sandbox") {
    // 自由模式下切换节点选中状态
    if (sandboxSelectedIds.has(nodeId)) {
      sandboxSelectedIds.delete(nodeId);
    } else {
      sandboxSelectedIds.add(nodeId);
    }
    renderSandboxView();
  } else {
    // 分步模式下高亮当前节点
    document.querySelectorAll(".tree-node").forEach(el => el.classList.remove("node-active"));
    const activeEl = document.getElementById(`node-${nodeId}`);
    if (activeEl) activeEl.classList.add("node-active");
  }
}

// ==========================================================================
// 9. 核心重点步骤讲解视口渲染与过渡 (包含平滑交叉淡入与 +1 进位连环动画特写)
// ==========================================================================
function transitionStepExplanation(step) {
  const viewport = document.getElementById("step-content-viewport");
  if (!viewport) return;

  if (step3Timeline) {
    step3Timeline.kill();
    step3Timeline = null;
  }

  gsap.to(viewport, {
    opacity: 0,
    y: -6,
    duration: 0.18 / animSpeed,
    ease: "power1.in",
    onComplete: () => {
      renderStepExplanation(step);
      triggerMathRender();

      if (step === 3) {
        startStep3CarryAnimation(1);
      }

      gsap.fromTo(
        viewport,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.32 / animSpeed, ease: "power2.out" }
      );
    }
  });
}

function renderStepExplanation(step) {
  const viewport = document.getElementById("step-content-viewport");

  switch (step) {
    case 1:
      // STEP 1: 初始网段
      viewport.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          <div class="md:col-span-2 space-y-2">
            <h3 class="text-sm font-bold text-stone-900 flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-rose-500"></span>
              初始网段设定：C 类网络 192.168.1.0/24
            </h3>
            <p class="text-xs text-stone-600 leading-relaxed">
              在 CIDR（无分类域间路由）中，该网段的子网掩码为 <code class="font-mono bg-stone-100 px-1 py-0.5 rounded text-stone-800">255.255.255.0</code>。
              其中前 <strong class="text-rose-600 font-mono">24 位</strong>为固定的网络号（标红），后 <strong class="text-emerald-600 font-mono">8 位</strong>为主机号（标绿）。
            </p>
            <div class="flex items-center gap-2 text-xs font-mono pt-1">
              <span class="px-2 py-1 rounded bg-stone-100 text-stone-700">可分配主机容量: 2^8 = 256 个地址</span>
              <span class="text-stone-400">→</span>
              <span class="px-2 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">地址范围: 192.168.1.0 ~ 192.168.1.255</span>
            </div>
          </div>
          <div class="p-3 rounded-xl bg-stone-50 border border-[#E5E4DC] text-xs font-mono space-y-1.5">
            <div class="text-[11px] text-stone-500">哈夫曼前缀树根节点 (Root):</div>
            <div class="font-bold text-stone-800">根节点未分裂前，代表整个未划分的 /24 地址空间。</div>
            <div class="text-stone-500 text-[11px] pt-1">点击“下一步”借用第 25 位主机号，开始首次二叉分裂。</div>
          </div>
        </div>
      `;
      break;

    case 2:
      // STEP 2: 首次二叉分裂
      viewport.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <div class="space-y-2">
            <h3 class="text-sm font-bold text-stone-900 flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-sky-500"></span>
              选取主机号第 1 位（第 25 位）作为子网号：左 0 右 1
            </h3>
            <p class="text-xs text-stone-600 leading-relaxed">
              从原 8 位主机号中借出最高 1 位作为子网号（Subnet ID）。二叉树向下分裂出两个对称的子节点：
            </p>
            <ul class="text-xs space-y-1.5 font-mono">
              <li class="p-2 rounded-lg bg-sky-50 border border-sky-200 text-sky-900 flex items-center justify-between">
                <span><strong>左子节点 (分支 0):</strong> 192.168.1.0/25</span>
                <span class="text-[11px] text-sky-700">掩码 .128 · 范围 .0~.127 (128个)</span>
              </li>
              <li class="p-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-900 flex items-center justify-between">
                <span><strong>右子节点 (分支 1):</strong> 192.168.1.128/25</span>
                <span class="text-[11px] text-indigo-700">掩码 .128 · 范围 .128~.255 (128个)</span>
              </li>
            </ul>
          </div>
          <div class="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs space-y-2">
            <div class="font-bold text-amber-900 flex items-center gap-1.5">
              <span>💡</span> 核心前缀特性：
            </div>
            <p class="text-amber-800 text-[11px] leading-relaxed">
              左子网前缀以 <code class="font-mono bg-white px-1 py-0.2 rounded border border-amber-200">0</code> 开头，右子网前缀以 <code class="font-mono bg-white px-1 py-0.2 rounded border border-amber-200">1</code> 开头。
              两者的主机位均剩余 7 位（\\(2^7 = 128\\) 个地址）。
            </p>
            <div class="text-[11px] font-mono text-amber-900 font-semibold bg-white p-2 rounded-lg border border-amber-200">
              问题引申：这两个子网是否刚好将父节点的 256 个地址严丝合缝瓜分完毕？
            </div>
          </div>
        </div>
      `;
      break;

    case 3:
      // STEP 3: 核心动画推演 (0子网全0~全1, +1 进位无缝衔接至 1子网全0, 分尽证明)
      viewport.innerHTML = `
        <div class="space-y-3" id="step3-container">
          <!-- 1. 动态实时 8 位位流与累加器仪表盘 -->
          <div class="p-3 rounded-xl bg-white border border-[#E5E4DC] shadow-sm space-y-2">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <!-- 状态与阶段提示 -->
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                <span id="step3-phase-text" class="text-xs font-bold font-mono text-stone-800">
                  阶段 1/4: 0 子网由全 0 向全 1 递增推演
                </span>
              </div>

              <!-- 控制器：重新播放 & 四阶段跳转按钮 -->
              <div class="flex items-center gap-1 text-xs font-mono">
                <button onclick="startStep3CarryAnimation(1)" class="ctl-btn py-0.5 px-2" title="从头播放">
                  <span>↺</span> 重播
                </button>
                <button onclick="jumpStep3Phase(1)" id="p-btn-1" class="px-2 py-0.5 rounded border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700">
                  1. 0子网递增
                </button>
                <button onclick="jumpStep3Phase(2)" id="p-btn-2" class="px-2 py-0.5 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold">
                  2. ⚡+1进位特写
                </button>
                <button onclick="jumpStep3Phase(3)" id="p-btn-3" class="px-2 py-0.5 rounded border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700">
                  3. 1子网递增
                </button>
                <button onclick="jumpStep3Phase(4)" id="p-btn-4" class="px-2 py-0.5 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold">
                  4. 完全分尽证明
                </button>
              </div>
            </div>

            <!-- 动态 8 位寄存器展示行 -->
            <div class="flex items-center justify-between flex-wrap gap-3 bg-stone-50 p-2 rounded-lg border border-[#E5E4DC]">
              <div class="flex items-center gap-3">
                <span class="text-xs font-mono text-stone-500">第 4 字节实时寄存器:</span>
                <div class="flex items-center gap-1 font-mono">
                  <!-- 子网位 S1 (第25位) -->
                  <div class="flex flex-col items-center">
                    <span class="text-[9px] text-stone-400 font-mono">子网位(S1)</span>
                    <div id="reg-s1" class="bit-box bit-subnet text-sm font-bold w-7 h-8">0</div>
                  </div>
                  <span class="text-stone-400 font-bold px-0.5">.</span>
                  <!-- 主机位 H1 ~ H7 (第26~32位) -->
                  <div class="flex flex-col items-center">
                    <span class="text-[9px] text-stone-400 font-mono">主机位 (H1 ~ H7)</span>
                    <div class="flex items-center gap-1">
                      <div id="reg-h1" class="bit-box bit-host text-sm font-bold w-6 h-8">0</div>
                      <div id="reg-h2" class="bit-box bit-host text-sm font-bold w-6 h-8">0</div>
                      <div id="reg-h3" class="bit-box bit-host text-sm font-bold w-6 h-8">0</div>
                      <div id="reg-h4" class="bit-box bit-host text-sm font-bold w-6 h-8">0</div>
                      <div id="reg-h5" class="bit-box bit-host text-sm font-bold w-6 h-8">0</div>
                      <div id="reg-h6" class="bit-box bit-host text-sm font-bold w-6 h-8">0</div>
                      <div id="reg-h7" class="bit-box bit-host text-sm font-bold w-6 h-8">0</div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 十进制数值动态指示 -->
              <div class="flex items-center gap-3 font-mono">
                <div class="text-right">
                  <div class="text-[10px] text-stone-400">当前点分十进制与序号:</div>
                  <div id="reg-ip-decimal" class="text-sm font-bold text-stone-900">
                    192.168.1.<span id="reg-host-val" class="text-sky-700 text-base">0</span>
                  </div>
                </div>
                <div class="w-24 bg-stone-200 h-2 rounded-full overflow-hidden">
                  <div id="step3-progress-bar" class="bg-amber-500 h-full w-0 transition-all duration-300"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. 动画推演三大分区对比 -->
          <div class="grid grid-cols-1 md:grid-cols-12 gap-3">
            
            <!-- 0 子网从全 0 到全 1 (4 列) -->
            <div id="sub0-col" class="md:col-span-4 p-3 rounded-xl bg-sky-50/70 border border-sky-200 space-y-2 transition-all duration-300">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-sky-900 font-mono">0 子网 (192.168.1.0/25)</span>
                <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-200 text-sky-800">128 个地址</span>
              </div>
              <div class="space-y-1 font-mono text-[11px] bg-white p-2 rounded-lg border border-sky-100">
                <div id="row-sub0-start" class="flex justify-between items-center text-stone-700 p-0.5 rounded transition-colors">
                  <span>起始: 192.168.1.<strong class="text-sky-700">0</strong> <span class="text-emerald-700">0000000</span></span>
                  <span class="text-[10px] text-stone-400">(.0)</span>
                </div>
                <div id="row-sub0-inc" class="flex justify-between items-center text-stone-600 p-0.5 rounded transition-colors">
                  <span>递增: 192.168.1.<strong class="text-sky-700">0</strong> <span class="text-emerald-700">0000001</span></span>
                  <span class="text-[10px] text-stone-400">(.1)</span>
                </div>
                <div id="row-sub0-dots" class="text-center text-stone-400 font-bold tracking-widest text-[10px] py-0.5 rounded transition-colors">
                  ⋮ (连续递增 .2 ~ .125 省略) ⋮
                </div>
                <div id="row-sub0-end" class="flex justify-between items-center text-stone-700 p-0.5 rounded transition-colors">
                  <span>末尾: 192.168.1.<strong class="text-sky-700">0</strong> <span class="text-emerald-700">1111110</span></span>
                  <span class="text-[10px] text-stone-400">(.126)</span>
                </div>
                <div id="row-sub0-full" class="flex justify-between items-center text-rose-700 font-bold bg-rose-50 px-1 py-0.5 rounded border border-rose-200 transition-all">
                  <span>全1: 192.168.1.<strong class="text-sky-700">0</strong> <span class="text-rose-600">1111111</span></span>
                  <span class="text-[10px]">(.127)</span>
                </div>
              </div>
            </div>

            <!-- 核心重点过程：全 1 + 1 进位特写 (4 列) -->
            <div id="carry-animation-card" class="md:col-span-4 p-3 rounded-xl bg-amber-50/90 border-2 border-amber-300 space-y-2 relative overflow-hidden transition-all duration-300">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-amber-900 font-mono flex items-center gap-1">
                  <span>⚡</span> 重点过程：全 1 加上 1 进位
                </span>
                <span id="carry-badge-status" class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-200 text-amber-900 font-bold">
                  连环穿透进位
                </span>
              </div>

              <!-- 进位竖式模拟 -->
              <div class="bg-white p-2.5 rounded-lg border border-amber-200 font-mono text-xs space-y-1">
                <div class="flex justify-between text-stone-600 text-[11px]">
                  <span>0子网全1:</span>
                  <span>192.168.1.<strong class="text-sky-700">0</strong> <strong class="text-rose-600">1111111</strong> (.127)</span>
                </div>
                <div class="flex justify-between text-amber-700 font-bold border-b border-stone-300 pb-1 text-[11px]">
                  <span>下一地址加1:</span>
                  <span>+&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<strong class="text-amber-600">1</strong></span>
                </div>
                <div id="carry-result-box" class="flex justify-between items-center text-stone-600 font-bold pt-0.5 text-xs transition-all duration-300">
                  <span>进位后结果:</span>
                  <span id="carry-result-display" class="bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200 text-stone-500 font-mono">
                    等待进位触发...
                  </span>
                </div>
              </div>

              <div class="text-[10px] text-amber-800 leading-tight">
                <strong>进位涟漪现象：</strong>后 7 位主机号逢二进一全部清零，进位向左逐级传递，刚好穿透至第 25 位子网号，使 <code class="bg-white px-1 rounded text-sky-700">0</code> 变成 <code class="bg-white px-1 rounded text-indigo-700">1</code>！
              </div>
            </div>

            <!-- 1 子网从全 0 到全 1 (4 列) -->
            <div id="sub1-col" class="md:col-span-4 p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-2 transition-all duration-300">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-indigo-900 font-mono">1 子网 (192.168.1.128/25)</span>
                <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-200 text-indigo-800">128 个地址</span>
              </div>
              <div class="space-y-1 font-mono text-[11px] bg-white p-2 rounded-lg border border-indigo-100">
                <div id="row-sub1-start" class="flex justify-between items-center text-stone-700 p-0.5 rounded transition-colors">
                  <span>全0: 192.168.1.<strong class="text-indigo-700">1</strong> <span class="text-emerald-700">0000000</span></span>
                  <span class="text-[10px]">(.128)</span>
                </div>
                <div id="row-sub1-inc" class="flex justify-between items-center text-stone-600 p-0.5 rounded transition-colors">
                  <span>递增: 192.168.1.<strong class="text-indigo-700">1</strong> <span class="text-emerald-700">0000001</span></span>
                  <span class="text-[10px] text-stone-400">(.129)</span>
                </div>
                <div id="row-sub1-dots" class="text-center text-stone-400 font-bold tracking-widest text-[10px] py-0.5 rounded transition-colors">
                  ⋮ (连续递增 .130 ~ .253 省略) ⋮
                </div>
                <div id="row-sub1-end" class="flex justify-between items-center text-stone-700 p-0.5 rounded transition-colors">
                  <span>末尾: 192.168.1.<strong class="text-indigo-700">1</strong> <span class="text-emerald-700">1111110</span></span>
                  <span class="text-[10px] text-stone-400">(.254)</span>
                </div>
                <div id="row-sub1-full" class="flex justify-between items-center text-stone-700 p-0.5 rounded transition-colors">
                  <span>全1: 192.168.1.<strong class="text-indigo-700">1</strong> <span class="text-emerald-700">1111111</span></span>
                  <span class="text-[10px] text-stone-400">(.255)</span>
                </div>
              </div>
            </div>

          </div>

          <!-- 3. 结论横幅 -->
          <div id="step3-conclusion-banner" class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-300 flex items-center justify-between text-xs transition-all duration-300 opacity-0 transform translate-y-2">
            <div class="flex items-center gap-2 text-emerald-900 font-bold">
              <span class="text-base">✅</span>
              <span>核心结论：0 子网下的全 1 加 1 恰好变成 1 子网下的全 0，两区间严丝合缝无缝衔接！</span>
            </div>
            <span class="font-mono text-emerald-800 font-semibold">
              这次子网划分将父节点 IP 地址完全分尽 (128 + 128 = 256)
            </span>
          </div>
        </div>
      `;
      break;

    case 4:
      // STEP 4: 再次二叉分裂 (规范要求的精简说明)
      viewport.innerHTML = `
        <div class="p-4 rounded-xl bg-stone-50 border border-[#E5E4DC] space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-bold text-stone-900 flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-indigo-500"></span>
              再次分别往下二叉分裂：生成 4 个 /26 子网
            </h3>
            <span class="text-xs font-mono px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200">
              借用 2 位子网号 · 剩余 6 位主机号
            </span>
          </div>

          <!-- 规范指定的核心解说段落 -->
          <div class="p-3 rounded-lg bg-white border border-stone-200 text-stone-800 text-xs leading-relaxed font-serif text-sm">
            <strong class="font-mono text-xs text-stone-900 font-bold">【动画推演结论】：</strong>
            由上一次的讲解可知，其两个子节点能分尽父节点。
          </div>

          <!-- 4 个子网列表 -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
            <div class="p-2 rounded-lg bg-white border border-stone-200">
              <div class="font-bold text-sky-800">192.168.1.0/26</div>
              <div class="text-[11px] text-stone-500">前缀: 00 · .0~.63</div>
              <div class="text-[10px] text-stone-400">容量: 64 个 IP</div>
            </div>
            <div class="p-2 rounded-lg bg-white border border-stone-200">
              <div class="font-bold text-teal-800">192.168.1.64/26</div>
              <div class="text-[11px] text-stone-500">前缀: 01 · .64~.127</div>
              <div class="text-[10px] text-stone-400">容量: 64 个 IP</div>
            </div>
            <div class="p-2 rounded-lg bg-white border border-stone-200">
              <div class="font-bold text-indigo-800">192.168.1.128/26</div>
              <div class="text-[11px] text-stone-500">前缀: 10 · .128~.191</div>
              <div class="text-[10px] text-stone-400">容量: 64 个 IP</div>
            </div>
            <div class="p-2 rounded-lg bg-white border border-stone-200">
              <div class="font-bold text-purple-800">192.168.1.192/26</div>
              <div class="text-[11px] text-stone-500">前缀: 11 · .192~.255</div>
              <div class="text-[10px] text-stone-400">容量: 64 个 IP</div>
            </div>
          </div>
        </div>
      `;
      break;

    case 5:
      // STEP 5: 错误示范反思 (选父节点与子节点冲突)
      viewport.innerHTML = `
        <div class="p-4 rounded-xl bg-rose-50/70 border-2 border-rose-300 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-bold text-rose-900 flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-rose-600 text-white flex items-center justify-center text-[10px]">✕</span>
              错误示范：选一个父节点和其子节点，另一个选其他的任意节点
            </h3>
            <span class="text-xs font-mono font-bold px-2 py-0.5 rounded bg-rose-600 text-white animate-pulse">
              非法划分 · 冲突警报
            </span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
            <div class="p-2.5 rounded-lg bg-white border-2 border-rose-400 space-y-1">
              <div class="text-rose-700 font-bold flex items-center justify-between">
                <span>① 父节点 (已选)</span>
                <span class="text-[10px] bg-rose-100 px-1 rounded">192.168.1.0/25</span>
              </div>
              <div class="text-stone-600 text-[11px]">覆盖地址: 0 ~ 127</div>
              <div class="text-rose-600 text-[10px]">包容整个左半区</div>
            </div>

            <div class="p-2.5 rounded-lg bg-white border-2 border-rose-400 space-y-1">
              <div class="text-rose-700 font-bold flex items-center justify-between">
                <span>② 它的子节点 (已选)</span>
                <span class="text-[10px] bg-rose-100 px-1 rounded">192.168.1.0/26</span>
              </div>
              <div class="text-stone-600 text-[11px]">覆盖地址: 0 ~ 63</div>
              <div class="text-rose-600 text-[10px] font-bold">⚠️ 完全落在父节点内部！</div>
            </div>

            <div class="p-2.5 rounded-lg bg-white border border-stone-300 space-y-1">
              <div class="text-stone-800 font-bold flex items-center justify-between">
                <span>③ 另一任意节点</span>
                <span class="text-[10px] bg-stone-100 px-1 rounded">192.168.1.128/26</span>
              </div>
              <div class="text-stone-600 text-[11px]">覆盖地址: 128 ~ 191</div>
              <div class="text-stone-500 text-[10px]">独立右子网</div>
            </div>
          </div>

          <!-- 规范指定的核心冲突机理说明 -->
          <div class="p-3 rounded-lg bg-white border border-rose-200 text-xs text-rose-950 space-y-1.5 leading-relaxed">
            <div class="font-bold text-rose-900 flex items-center gap-1">
              <span>📌</span> 核心错误机理剖析：
            </div>
            <p>
              如果选父节点的子节点，<strong>则子节点的 IP 地址必有与父节点重合的部分（此处 0~63 完全重合），不符合前缀匹配！</strong>
            </p>
            <p class="text-stone-600 text-[11px]">
              当一个目的 IP（如 <code class="font-mono bg-rose-50 px-1 text-rose-700">192.168.1.10</code>）到达路由器时，它同时与父网 /25 和子网 /26 发生重叠匹配，导致路由二义性；在哈夫曼树中，<strong>内部节点（非叶子节点）绝不能与它的后代节点同时作为有效编码</strong>！
              同时，网段 <code class="font-mono bg-stone-100 px-1 text-stone-700">192.168.1.192 ~ 255</code> 未被选中，产生了无法分配的孤立漏洞。
            </p>
          </div>
        </div>
      `;
      break;

    case 6:
      // STEP 6: 正确示范 (如何选取 3 个合法子网)
      viewport.innerHTML = `
        <div class="p-4 rounded-xl bg-emerald-50/70 border-2 border-emerald-300 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <h3 class="text-sm font-bold text-emerald-900 flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">✓</span>
              正确示范：如何在二叉前缀树上选取 3 个合法的变长子网？
            </h3>
            <!-- 方案切换胶囊 -->
            <div class="flex items-center gap-1 text-xs font-mono">
              <span class="text-stone-500 mr-1">切换方案:</span>
              <button onclick="toggleScheme('A')" class="px-2 py-0.5 rounded border ${correctScheme === 'A' ? 'border-emerald-700 bg-emerald-700 text-white font-bold' : 'border-stone-300 bg-white text-stone-700'}">
                方案 A (右大左小)
              </button>
              <button onclick="toggleScheme('B')" class="px-2 py-0.5 rounded border ${correctScheme === 'B' ? 'border-emerald-700 bg-emerald-700 text-white font-bold' : 'border-stone-300 bg-white text-stone-700'}">
                方案 B (左大右小)
              </button>
            </div>
          </div>

          <!-- 3 个合法子网展示 -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
            ${correctScheme === 'A' ? `
              <div class="p-2.5 rounded-lg bg-white border border-emerald-300 space-y-1">
                <div class="text-emerald-800 font-bold flex items-center justify-between">
                  <span>子网 1 (小网):</span>
                  <span class="text-[10px] bg-sky-50 text-sky-800 border border-sky-200 px-1 rounded">192.168.1.0/26</span>
                </div>
                <div class="text-stone-600 text-[11px]">前缀码: 00 · 范围: 0 ~ 63</div>
                <div class="text-emerald-600 font-semibold text-[10px]">容量: 64 个 IP (叶子节点)</div>
              </div>

              <div class="p-2.5 rounded-lg bg-white border border-emerald-300 space-y-1">
                <div class="text-emerald-800 font-bold flex items-center justify-between">
                  <span>子网 2 (小网):</span>
                  <span class="text-[10px] bg-teal-50 text-teal-800 border border-teal-200 px-1 rounded">192.168.1.64/26</span>
                </div>
                <div class="text-stone-600 text-[11px]">前缀码: 01 · 范围: 64 ~ 127</div>
                <div class="text-emerald-600 font-semibold text-[10px]">容量: 64 个 IP (叶子节点)</div>
              </div>

              <div class="p-2.5 rounded-lg bg-white border-2 border-emerald-500 space-y-1 shadow-sm">
                <div class="text-emerald-800 font-bold flex items-center justify-between">
                  <span>子网 3 (大网):</span>
                  <span class="text-[10px] bg-indigo-50 text-indigo-800 border border-indigo-200 px-1 rounded">192.168.1.128/25</span>
                </div>
                <div class="text-stone-600 text-[11px]">前缀码: 1 · 范围: 128 ~ 255</div>
                <div class="text-emerald-600 font-semibold text-[10px]">容量: 128 个 IP (叶子节点)</div>
              </div>
            ` : `
              <div class="p-2.5 rounded-lg bg-white border-2 border-emerald-500 space-y-1 shadow-sm">
                <div class="text-emerald-800 font-bold flex items-center justify-between">
                  <span>子网 1 (大网):</span>
                  <span class="text-[10px] bg-sky-50 text-sky-800 border border-sky-200 px-1 rounded">192.168.1.0/25</span>
                </div>
                <div class="text-stone-600 text-[11px]">前缀码: 0 · 范围: 0 ~ 127</div>
                <div class="text-emerald-600 font-semibold text-[10px]">容量: 128 个 IP (叶子节点)</div>
              </div>

              <div class="p-2.5 rounded-lg bg-white border border-emerald-300 space-y-1">
                <div class="text-emerald-800 font-bold flex items-center justify-between">
                  <span>子网 2 (小网):</span>
                  <span class="text-[10px] bg-indigo-50 text-indigo-800 border border-indigo-200 px-1 rounded">192.168.1.128/26</span>
                </div>
                <div class="text-stone-600 text-[11px]">前缀码: 10 · 范围: 128 ~ 191</div>
                <div class="text-emerald-600 font-semibold text-[10px]">容量: 64 个 IP (叶子节点)</div>
              </div>

              <div class="p-2.5 rounded-lg bg-white border border-emerald-300 space-y-1">
                <div class="text-emerald-800 font-bold flex items-center justify-between">
                  <span>子网 3 (小网):</span>
                  <span class="text-[10px] bg-purple-50 text-purple-800 border border-purple-200 px-1 rounded">192.168.1.192/26</span>
                </div>
                <div class="text-stone-600 text-[11px]">前缀码: 11 · 范围: 192 ~ 255</div>
                <div class="text-emerald-600 font-semibold text-[10px]">容量: 64 个 IP (叶子节点)</div>
              </div>
            `}
          </div>

          <!-- 哈夫曼树前缀互斥法则总结 -->
          <div class="p-3 rounded-lg bg-white border border-emerald-200 text-xs text-stone-700 space-y-1 leading-relaxed">
            <div class="font-bold text-emerald-900 flex items-center gap-1.5">
              <span>🎯</span> 哈夫曼前缀编码核心定理：
            </div>
            <p>
              若要选取 3 个合法子网，在二叉树中<strong>所选节点必须全部是“剪枝后的叶子节点”，彼此绝不能互为祖先或后代！</strong>
            </p>
            <p class="text-[11px] text-stone-500 font-mono">
              满足条件：前缀互不包含（无歧义瞬时码）且 \\(64 + 64 + 128 = 256\\)，不多不少，刚好将整个 IP 空间分尽！
            </p>
          </div>
        </div>
      `;
      break;
  }
}

// ==========================================================================
// 9.1 STEP 3 核心动态 +1 进位流水线动画引擎 (Silky Smooth Carry Animation)
// ==========================================================================
function jumpStep3Phase(phase) {
  if (!step3Timeline) {
    startStep3CarryAnimation(phase);
    return;
  }
  const timeLabels = {
    1: 0,
    2: 2.8,
    3: 5.1,
    4: 7.6
  };
  step3Timeline.seek(timeLabels[phase] || 0);
  step3Timeline.play();
}

function startStep3CarryAnimation(startPhase = 1) {
  if (step3Timeline) {
    step3Timeline.kill();
    step3Timeline = null;
  }

  const s1El = document.getElementById("reg-s1");
  const hEls = [1, 2, 3, 4, 5, 6, 7].map(i => document.getElementById(`reg-h${i}`));
  const hostValEl = document.getElementById("reg-host-val");
  const barEl = document.getElementById("step3-progress-bar");
  const phaseEl = document.getElementById("step3-phase-text");
  const carryResultDisplay = document.getElementById("carry-result-display");
  const conclusionBanner = document.getElementById("step3-conclusion-banner");
  const carryCard = document.getElementById("carry-animation-card");
  const sub1Col = document.getElementById("sub1-col");

  if (!s1El || !hEls[0]) return;

  // 辅助函数：重置状态
  const resetLiveState = () => {
    s1El.textContent = "0";
    s1El.className = "bit-box bit-subnet text-sm font-bold w-7 h-8";
    hEls.forEach(el => {
      if (el) {
        el.textContent = "0";
        el.className = "bit-box bit-host text-sm font-bold w-6 h-8";
      }
    });
    if (hostValEl) hostValEl.textContent = "0";
    if (barEl) barEl.style.width = "0%";
    if (carryResultDisplay) {
      carryResultDisplay.className = "bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200 text-stone-500 font-mono";
      carryResultDisplay.textContent = "等待进位触发...";
    }
    if (conclusionBanner) {
      conclusionBanner.style.opacity = "0";
      conclusionBanner.style.transform = "translateY(8px)";
    }
    document.querySelectorAll("[id^='row-sub']").forEach(r => {
      r.classList.remove("bg-sky-100", "bg-indigo-100", "ring-1", "ring-sky-300", "ring-indigo-300");
    });
    document.querySelectorAll("[id^='p-btn-']").forEach(b => {
      b.classList.remove("ring-2", "ring-stone-900");
    });
  };

  resetLiveState();

  const setByteDisplay = (s1, hArr, dec, pct, phaseTxt, activePhaseNum) => {
    if (s1El) s1El.textContent = s1;
    hEls.forEach((el, idx) => {
      if (el) el.textContent = hArr[idx];
    });
    if (hostValEl) hostValEl.textContent = dec;
    if (barEl) barEl.style.width = `${pct}%`;
    if (phaseEl) phaseEl.textContent = phaseTxt;

    document.querySelectorAll("[id^='p-btn-']").forEach(b => b.classList.remove("ring-2", "ring-stone-900"));
    const pBtn = document.getElementById(`p-btn-${activePhaseNum}`);
    if (pBtn) pBtn.classList.add("ring-2", "ring-stone-900");
  };

  const tl = gsap.timeline({
    defaults: { ease: "power1.inOut" }
  });
  tl.timeScale(animSpeed);
  step3Timeline = tl;

  // ===== 阶段 1: 0 子网从全 0 到全 1 =====
  tl.addLabel("phase1", 0);
  tl.call(() => {
    setByteDisplay("0", ["0","0","0","0","0","0","0"], 0, 5, "阶段 1/4: 0 子网全 0 起始 (192.168.1.0)", 1);
    const r = document.getElementById("row-sub0-start");
    if (r) r.classList.add("bg-sky-100", "ring-1", "ring-sky-300");
  }, null, 0);

  tl.to({}, { duration: 0.6 }, "+=0");

  tl.call(() => {
    setByteDisplay("0", ["0","0","0","0","0","0","1"], 1, 15, "阶段 1/4: 主机号递增至 1 (192.168.1.1)", 1);
    const rStart = document.getElementById("row-sub0-start");
    const rInc = document.getElementById("row-sub0-inc");
    if (rStart) rStart.classList.remove("bg-sky-100", "ring-1", "ring-sky-300");
    if (rInc) rInc.classList.add("bg-sky-100", "ring-1", "ring-sky-300");
  });

  tl.to({}, { duration: 0.6 }, "+=0");

  tl.call(() => {
    setByteDisplay("0", ["0","0","0","0","0","1","0"], 2, 28, "阶段 1/4: 主机号连续递增 (省略中间大段 .2 ~ .125)", 1);
    const rInc = document.getElementById("row-sub0-inc");
    const rDots = document.getElementById("row-sub0-dots");
    if (rInc) rInc.classList.remove("bg-sky-100", "ring-1", "ring-sky-300");
    if (rDots) rDots.classList.add("bg-sky-100", "ring-1", "ring-sky-300");
  });

  tl.to({}, { duration: 0.6 }, "+=0");

  tl.call(() => {
    setByteDisplay("0", ["1","1","1","1","1","1","0"], 126, 45, "阶段 1/4: 0 子网接近饱和 (.126)", 1);
    const rDots = document.getElementById("row-sub0-dots");
    const rEnd = document.getElementById("row-sub0-end");
    if (rDots) rDots.classList.remove("bg-sky-100", "ring-1", "ring-sky-300");
    if (rEnd) rEnd.classList.add("bg-sky-100", "ring-1", "ring-sky-300");
  });

  tl.to({}, { duration: 0.6 }, "+=0");

  tl.call(() => {
    setByteDisplay("0", ["1","1","1","1","1","1","1"], 127, 50, "阶段 1/4: 0 子网达到全 1 饱和 (.127)", 1);
    const rEnd = document.getElementById("row-sub0-end");
    const rFull = document.getElementById("row-sub0-full");
    if (rEnd) rEnd.classList.remove("bg-sky-100", "ring-1", "ring-sky-300");
    if (rFull) rFull.classList.add("bg-rose-100", "ring-2", "ring-rose-400");
    hEls.forEach(el => {
      if (el) el.classList.add("bit-subnet");
    });
  });

  tl.to({}, { duration: 0.6 }, "+=0");

  // ===== 阶段 2: ⚡ 核心全 1 + 1 穿透进位特写 =====
  tl.addLabel("phase2", 2.8);
  tl.call(() => {
    const rFull = document.getElementById("row-sub0-full");
    if (rFull) rFull.classList.remove("ring-2");
    if (carryCard) {
      gsap.fromTo(carryCard, { scale: 0.96 }, { scale: 1, duration: 0.4, ease: "back.out(2)" });
    }
    const badge = document.getElementById("carry-badge-status");
    if (badge) {
      badge.className = "text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500 text-white font-bold animate-pulse";
      badge.textContent = "⚡ +1 进位中...";
    }
    if (phaseEl) phaseEl.textContent = "阶段 2/4: ⚡ 核心特写：0 子网全 1 加上 1 触发连环进位！";
    document.querySelectorAll("[id^='p-btn-']").forEach(b => b.classList.remove("ring-2", "ring-stone-900"));
    const pBtn = document.getElementById("p-btn-2");
    if (pBtn) pBtn.classList.add("ring-2", "ring-stone-900");
  });

  // 连环进位波纹传递：从 bit 7 逐级左推至 bit 1
  for (let i = 6; i >= 0; i--) {
    tl.to({}, { duration: 0.12 });
    tl.call(() => {
      const bitEl = hEls[i];
      if (bitEl) {
        bitEl.classList.remove("bit-subnet");
        bitEl.classList.add("carry-active-bit");
        bitEl.textContent = "0";
        setTimeout(() => {
          bitEl.classList.remove("carry-active-bit");
          bitEl.classList.add("bit-host");
        }, 260);
      }
    });
  }

  // 进位穿透至子网位 S1 (第 25 位)！
  tl.to({}, { duration: 0.15 });
  tl.call(() => {
    if (s1El) {
      s1El.textContent = "1";
      s1El.classList.add("subnet-flipped-bit");
      gsap.fromTo(s1El, { scale: 1.35 }, { scale: 1, duration: 0.4, ease: "elastic.out(1, 0.4)" });
    }
    if (hostValEl) hostValEl.textContent = "128";
    if (phaseEl) phaseEl.textContent = "阶段 2/4: 进位击穿至第 25 位子网位：0 变为 1！从 .127 无缝进入 .128！";

    if (carryResultDisplay) {
      carryResultDisplay.className = "bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300 text-emerald-800 font-bold font-mono";
      carryResultDisplay.innerHTML = `192.168.1.<strong class="text-indigo-700">1</strong><strong class="text-emerald-700">0000000</strong> (.128) 完美衔接！`;
    }
    const badge = document.getElementById("carry-badge-status");
    if (badge) {
      badge.className = "text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-600 text-white font-bold";
      badge.textContent = "✓ 进位完成";
    }
  });

  tl.to({}, { duration: 0.8 }, "+=0");

  // ===== 阶段 3: 1 子网从全 0 到全 1 =====
  tl.addLabel("phase3", 5.1);
  tl.call(() => {
    if (sub1Col) {
      gsap.fromTo(sub1Col, { scale: 0.97 }, { scale: 1, duration: 0.35 });
    }
    setByteDisplay("1", ["0","0","0","0","0","0","0"], 128, 55, "阶段 3/4: 1 子网全 0 起始 (192.168.1.128)", 3);
    const rStart = document.getElementById("row-sub1-start");
    if (rStart) rStart.classList.add("bg-indigo-100", "ring-1", "ring-indigo-300");
  });

  tl.to({}, { duration: 0.6 }, "+=0");

  tl.call(() => {
    setByteDisplay("1", ["0","0","0","0","0","0","1"], 129, 65, "阶段 3/4: 1 子网递增至 1 (192.168.1.129)", 3);
    const rStart = document.getElementById("row-sub1-start");
    const rInc = document.getElementById("row-sub1-inc");
    if (rStart) rStart.classList.remove("bg-indigo-100", "ring-1", "ring-indigo-300");
    if (rInc) rInc.classList.add("bg-indigo-100", "ring-1", "ring-indigo-300");
  });

  tl.to({}, { duration: 0.6 }, "+=0");

  tl.call(() => {
    setByteDisplay("1", ["0","0","0","0","0","1","0"], 130, 78, "阶段 3/4: 1 子网连续递增 (省略中间大段 .130 ~ .253)", 3);
    const rInc = document.getElementById("row-sub1-inc");
    const rDots = document.getElementById("row-sub1-dots");
    if (rInc) rInc.classList.remove("bg-indigo-100", "ring-1", "ring-indigo-300");
    if (rDots) rDots.classList.add("bg-indigo-100", "ring-1", "ring-indigo-300");
  });

  tl.to({}, { duration: 0.6 }, "+=0");

  tl.call(() => {
    setByteDisplay("1", ["1","1","1","1","1","1","0"], 254, 92, "阶段 3/4: 1 子网接近饱和 (.254)", 3);
    const rDots = document.getElementById("row-sub1-dots");
    const rEnd = document.getElementById("row-sub1-end");
    if (rDots) rDots.classList.remove("bg-indigo-100", "ring-1", "ring-indigo-300");
    if (rEnd) rEnd.classList.add("bg-indigo-100", "ring-1", "ring-indigo-300");
  });

  tl.to({}, { duration: 0.6 }, "+=0");

  tl.call(() => {
    setByteDisplay("1", ["1","1","1","1","1","1","1"], 255, 100, "阶段 3/4: 1 子网达到全 1 饱和 (.255)", 3);
    const rEnd = document.getElementById("row-sub1-end");
    const rFull = document.getElementById("row-sub1-full");
    if (rEnd) rEnd.classList.remove("bg-indigo-100", "ring-1", "ring-indigo-300");
    if (rFull) rFull.classList.add("bg-indigo-100", "ring-1", "ring-indigo-300");
  });

  tl.to({}, { duration: 0.5 }, "+=0");

  // ===== 阶段 4: 完全分尽证明与结论横幅 =====
  tl.addLabel("phase4", 7.6);
  tl.call(() => {
    if (phaseEl) phaseEl.textContent = "阶段 4/4: ✅ 推演完成 · 父节点 256 个 IP 地址完全分尽！";
    document.querySelectorAll("[id^='p-btn-']").forEach(b => b.classList.remove("ring-2", "ring-stone-900"));
    const pBtn = document.getElementById("p-btn-4");
    if (pBtn) pBtn.classList.add("ring-2", "ring-stone-900");

    if (conclusionBanner) {
      gsap.to(conclusionBanner, {
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: "power2.out"
      });
    }
  });

  if (startPhase > 1) {
    jumpStep3Phase(startPhase);
  }
}

function toggleScheme(scheme) {
  correctScheme = scheme;
  applyStep(6);
}

// ==========================================================================
// 10. 自由拓扑探究模式 (Sandbox Live Validator)
// ==========================================================================
function renderSandboxView() {
  const selectedList = Array.from(sandboxSelectedIds);

  // 1. 碰撞与前缀合法性算法
  const conflictPairs = [];
  const selectedNodes = selectedList.map(id => TREE_NODES[id]).filter(Boolean);

  for (let i = 0; i < selectedNodes.length; i++) {
    for (let j = i + 1; j < selectedNodes.length; j++) {
      const a = selectedNodes[i];
      const b = selectedNodes[j];
      // 判断 a 和 b 是否有祖先后代关系
      if (isAncestorOf(a.id, b.id) || isAncestorOf(b.id, a.id)) {
        conflictPairs.push([a.id, b.id]);
      }
    }
  }

  const conflictNodeIds = Array.from(new Set(conflictPairs.flat()));
  const totalCount = selectedNodes.reduce((acc, n) => acc + n.count, 0);

  // 2. 更新树图
  updateTreeVisuals(2, selectedList, conflictNodeIds);

  // 3. 更新下半区为自由探究面板
  const viewport = document.getElementById("step-content-viewport");
  const isConflict = conflictNodeIds.length > 0;
  const isExactCoverage = !isConflict && totalCount === 256;

  document.getElementById("step-badge").textContent = "自由探究";
  document.getElementById("step-title").textContent = "自由点击二叉树节点，实时检验前缀互斥与地址分尽";
  document.getElementById("step-math-summary").textContent = `当前选中 ${selectedList.length} 个节点，地址数: ${totalCount}/256`;

  viewport.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="flex items-center gap-2">
          ${isConflict ? `
            <span class="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-800 font-bold text-xs flex items-center gap-1 border border-rose-300">
              ❌ 检测到父子节点冲突重叠！
            </span>
          ` : isExactCoverage ? `
            <span class="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center gap-1 border border-emerald-300">
              ✅ 完美前缀集合！互不冲突且 100% 完全分尽
            </span>
          ` : totalCount > 256 ? `
            <span class="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 font-bold text-xs border border-amber-300">
              ⚠️ 总地址超出 256 (重复涵盖)
            </span>
          ` : `
            <span class="px-2.5 py-1 rounded-lg bg-sky-100 text-sky-800 font-bold text-xs border border-sky-300">
              ℹ️ 前缀互斥，但地址未分尽 (${totalCount}/256)
            </span>
          `}
        </div>

        <div class="flex items-center gap-2">
          <button onclick="sandboxQuickSelect('correct3A')" class="ctl-btn">
            预设：正确 3 子网 (方案A)
          </button>
          <button onclick="sandboxQuickSelect('correct3B')" class="ctl-btn">
            预设：正确 3 子网 (方案B)
          </button>
          <button onclick="sandboxQuickSelect('errorConflict')" class="ctl-btn text-rose-700">
            预设：典型父子冲突
          </button>
          <button onclick="sandboxQuickSelect('clear')" class="ctl-btn">
            清空已选
          </button>
        </div>
      </div>

      <!-- 当前选中清单 -->
      <div class="p-3 rounded-xl bg-white border border-[#E5E4DC] flex items-center gap-2 flex-wrap font-mono text-xs">
        <span class="text-stone-400">已选中节点:</span>
        ${selectedList.length === 0 ? `<span class="text-stone-400 italic">暂未选中任何节点，请在上方树中点击</span>` : ''}
        ${selectedList.map(id => {
          const n = TREE_NODES[id];
          const hasErr = conflictNodeIds.includes(id);
          return `
            <span class="px-2 py-0.5 rounded border ${hasErr ? 'bg-rose-50 border-rose-300 text-rose-700 font-bold' : 'bg-stone-100 border-stone-200 text-stone-800'} flex items-center gap-1">
              ${n.cidr} (${n.count} IPs)
              <button onclick="onNodeClicked('${id}')" class="text-stone-400 hover:text-stone-900 ml-1">×</button>
            </span>
          `;
        }).join('')}
      </div>
    </div>
  `;

  // 4. 更新地址条
  updateAddressStripSandbox(selectedNodes, conflictNodeIds);
}

function isAncestorOf(ancestorId, childId) {
  let curr = TREE_NODES[childId];
  while (curr && curr.parent) {
    if (curr.parent === ancestorId) return true;
    curr = TREE_NODES[curr.parent];
  }
  return false;
}

function sandboxQuickSelect(preset) {
  sandboxSelectedIds.clear();
  if (preset === "correct3A") {
    sandboxSelectedIds.add("n00");
    sandboxSelectedIds.add("n01");
    sandboxSelectedIds.add("n1");
  } else if (preset === "correct3B") {
    sandboxSelectedIds.add("n0");
    sandboxSelectedIds.add("n10");
    sandboxSelectedIds.add("n11");
  } else if (preset === "errorConflict") {
    sandboxSelectedIds.add("n0");
    sandboxSelectedIds.add("n00");
    sandboxSelectedIds.add("n10");
  }
  renderSandboxView();
}

function updateAddressStripSandbox(selectedNodes, conflictNodeIds) {
  const stripEl = document.getElementById("address-strip");
  stripEl.innerHTML = "";

  if (selectedNodes.length === 0) {
    const seg = document.createElement("div");
    seg.className = "strip-segment strip-hole";
    seg.style.width = "100%";
    seg.innerHTML = `未分配任何子网`;
    stripEl.appendChild(seg);
    document.getElementById("coverage-percentage").textContent = "0 / 256 (0%)";
    return;
  }

  // 简单绘制各段
  selectedNodes.forEach((n, idx) => {
    const isConflict = conflictNodeIds.includes(n.id);
    const seg = document.createElement("div");
    seg.className = `strip-segment ${isConflict ? 'strip-conflict' : 'bg-stone-800 text-white'}`;
    seg.style.width = `${(n.count / 256) * 100}%`;
    seg.innerHTML = `${n.cidr} (${n.count})`;
    stripEl.appendChild(seg);
  });
}

/**
 * 触发 KaTeX 渲染
 */
function triggerMathRender() {
  if (window.renderMathInElement) {
    try {
      renderMathInElement(document.getElementById("explanation-stage"), {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false }
        ],
        throwOnError: false
      });
    } catch (e) {
      console.warn("KaTeX render notice:", e);
    }
  }
}

