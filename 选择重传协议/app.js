/**
 * 选择重传 (Selective Repeat, SR) 滑动窗口协议核心交互引擎
 * 遵循 408 计算机网络标准与 Taste-Skill Light Editorial 浅色纸质美学
 */

class SRSimulator {
  constructor() {
    // 协议基础参数
    this.TOTAL_FRAMES = 10; // 0 ~ 9 共 10 个数据帧
    this.WINDOW_SIZE = 4;   // Wt = Wr = 4
    this.TIMEOUT_DURATION = 6500; // ms 超时定时器时长
    this.TRANSIT_TIME = 2200;     // ms 单向信道传输时延

    // 发送方状态机
    this.senderBase = 0;
    this.nextSeqNum = 0;
    this.senderAcked = new Set(); // 记录发送方已收到单独 ACK 的帧集合

    // 接收方状态机
    this.rcvBase = 0;
    this.receiverBuffer = new Set();    // 乱序到达并缓存在窗口内的帧集合
    this.receiverDelivered = new Set(); // 已按序交付给上层的帧集合

    // SR 核心特色：多定时器管理 Map: seq -> { running, startTime, duration, elapsed, isRetransmit }
    this.timers = new Map();

    // 飞行报文队列
    this.inflightPackets = [];
    this.packetIdCounter = 1;

    // 时空梯形图记录
    this.spaceTimeLines = [];
    this.spaceTimeAnnotations = [];
    this.virtualTime = 0;

    // 运行控制器
    this.isPlaying = false;
    this.playSpeed = 1.0;
    this.currentScenario = 'normal'; // 'normal', 'loss', 'sandbox'
    this.lossStage = 1; // 丢包场景当前阶段：1 为单帧丢失，2 为双帧不连续丢失
    this.scenarioStepIndex = 0;
    this.scenarioTimer = 0;

    // 会话与交互
    this.sessionId = 0;
    this.dropNextData = false;
    this.dropNextAck = false;
    this.logs = [];

    // 高亮/告警标记
    this.senderLostSeqs = new Set();
    this.senderRetransmitSeq = null;

    this.cacheDOM();
    this.bindEvents();
    this.resetSimulation();
  }

  cacheDOM() {
    this.dom = {
      senderCellsContainer: document.getElementById('sender-cells'),
      senderBracket: document.getElementById('sender-bracket'),
      senderBasePointer: document.getElementById('sender-base-pointer'),
      senderNextPointer: document.getElementById('sender-next-pointer'),
      senderAlertBanner: document.getElementById('sender-alert-banner'),
      senderStripWrapper: document.getElementById('sender-strip-wrapper'),
      multiTimersBar: document.getElementById('multi-timers-bar'),

      receiverCellsContainer: document.getElementById('receiver-cells'),
      receiverBracket: document.getElementById('receiver-bracket'),
      receiverPointer: document.getElementById('receiver-pointer'),
      receiverAlertBanner: document.getElementById('receiver-alert-banner'),
      receiverStripWrapper: document.getElementById('receiver-strip-wrapper'),

      channelLane: document.getElementById('flight-channel'),
      spacetimeCanvas: document.getElementById('spacetime-canvas'),

      statBase: document.getElementById('stat-base'),
      statNext: document.getElementById('stat-next'),
      statRcvBase: document.getElementById('stat-rcv-base'),
      statBuffer: document.getElementById('stat-buffer'),
      statTimersCount: document.getElementById('stat-timers-count'),
      statInflight: document.getElementById('stat-inflight'),

      explanationBox: document.getElementById('explanation-text'),
      stageBadge: document.getElementById('stage-badge'),
      logContainer: document.getElementById('event-logs'),

      btnPlay: document.getElementById('btn-play'),
      btnPlayText: document.getElementById('btn-play-text'),
      btnStep: document.getElementById('btn-step'),
      btnReset: document.getElementById('btn-reset'),
      btnSendOne: document.getElementById('btn-send-one'),
      btnDropData: document.getElementById('btn-drop-data'),
      btnDropAck: document.getElementById('btn-drop-ack'),
      speedSlider: document.getElementById('speed-slider'),
      speedVal: document.getElementById('speed-val'),

      tabNormal: document.getElementById('tab-normal'),
      tabLoss: document.getElementById('tab-loss'),
      tabError: document.getElementById('tab-error'),
      tabSandbox: document.getElementById('tab-sandbox'),

      stageJumpGroup: document.getElementById('stage-jump-group'),
      btnJumpStage1: document.getElementById('btn-jump-stage1'),
      btnJumpStage2: document.getElementById('btn-jump-stage2')
    };

    if (this.dom.spacetimeCanvas) {
      this.ctx = this.dom.spacetimeCanvas.getContext('2d');
    }
  }

  bindEvents() {
    // 自动播放 / 暂停
    this.dom.btnPlay.addEventListener('click', () => {
      if (!this.isPlaying && this.senderBase >= this.TOTAL_FRAMES) {
        this.resetSimulation();
      }
      this.isPlaying = !this.isPlaying;
      this.updatePlayBtn();
      if (this.isPlaying && this.scenarioStepIndex === 0 && this.nextSeqNum === 0) {
        this.stepForward();
        this.scenarioTimer = 0;
      }
    });

    // 单步执行
    this.dom.btnStep.addEventListener('click', () => {
      this.isPlaying = false;
      this.updatePlayBtn();
      this.stepForward();
    });

    // 重置
    this.dom.btnReset.addEventListener('click', () => {
      this.resetSimulation();
    });

    // 速度滑块
    this.dom.speedSlider.addEventListener('input', (e) => {
      this.playSpeed = parseFloat(e.target.value);
      this.dom.speedVal.innerText = this.playSpeed.toFixed(1) + 'x';
    });

    // 场景切换
    this.dom.tabNormal.addEventListener('click', () => this.switchScenario('normal'));
    this.dom.tabLoss.addEventListener('click', () => this.switchScenario('loss'));
    if (this.dom.tabError) this.dom.tabError.addEventListener('click', () => this.switchScenario('error'));
    this.dom.tabSandbox.addEventListener('click', () => this.switchScenario('sandbox'));

    // 快速阶段跳转 (丢包场景专属)
    if (this.dom.btnJumpStage1) {
      this.dom.btnJumpStage1.addEventListener('click', () => {
        this.lossStage = 1;
        this.resetSimulation();
        this.updateStageJumpStyles();
      });
    }
    if (this.dom.btnJumpStage2) {
      this.dom.btnJumpStage2.addEventListener('click', () => {
        this.lossStage = 2;
        this.resetSimulation();
        this.updateStageJumpStyles();
      });
    }

    // 自由测试按键
    this.dom.btnSendOne.addEventListener('click', () => {
      this.manualSendFrame();
    });
    this.dom.btnDropData.addEventListener('click', () => {
      this.dropNextData = !this.dropNextData;
      this.updateDropBtnStyles();
    });
    this.dom.btnDropAck.addEventListener('click', () => {
      this.dropNextAck = !this.dropNextAck;
      this.updateDropBtnStyles();
    });

    // 窗口尺寸自适应
    window.addEventListener('resize', () => {
      this.resizeCanvas();
    });
  }

  switchScenario(key) {
    [this.dom.tabNormal, this.dom.tabLoss, this.dom.tabError, this.dom.tabSandbox].forEach(tab => {
      if (tab) tab.classList.remove('active');
    });

    if (key === 'normal') this.dom.tabNormal.classList.add('active');
    else if (key === 'loss') this.dom.tabLoss.classList.add('active');
    else if (key === 'error') {
      if (this.dom.tabError) this.dom.tabError.classList.add('active');
    }
    else if (key === 'sandbox') this.dom.tabSandbox.classList.add('active');

    this.currentScenario = key;
    if (key === 'loss') {
      this.lossStage = 1;
      this.dom.stageJumpGroup.classList.remove('hidden');
      this.dom.stageJumpGroup.classList.add('inline-flex');
      this.updateStageJumpStyles();
    } else {
      this.dom.stageJumpGroup.classList.add('hidden');
      this.dom.stageJumpGroup.classList.remove('inline-flex');
    }

    this.resetSimulation();
  }

  updateStageJumpStyles() {
    if (!this.dom.btnJumpStage1 || !this.dom.btnJumpStage2) return;
    if (this.lossStage === 1) {
      this.dom.btnJumpStage1.className = 'px-2 py-1 rounded bg-white text-blue-700 shadow-xs font-bold text-[11px]';
      this.dom.btnJumpStage2.className = 'px-2 py-1 rounded bg-stone-50 text-stone-600 hover:text-blue-700 font-medium text-[11px]';
    } else {
      this.dom.btnJumpStage1.className = 'px-2 py-1 rounded bg-stone-50 text-stone-600 hover:text-blue-700 font-medium text-[11px]';
      this.dom.btnJumpStage2.className = 'px-2 py-1 rounded bg-white text-blue-700 shadow-xs font-bold text-[11px]';
    }
  }

  updatePlayBtn() {
    if (this.isPlaying) {
      this.dom.btnPlay.classList.remove('bg-stone-900', 'text-white');
      this.dom.btnPlay.classList.add('bg-amber-600', 'text-white');
      this.dom.btnPlayText.innerText = '暂停';
    } else {
      this.dom.btnPlay.classList.remove('bg-amber-600', 'text-white');
      this.dom.btnPlay.classList.add('bg-stone-900', 'text-white');
      this.dom.btnPlayText.innerText = '自动播放';
    }
  }

  updateDropBtnStyles() {
    if (this.dropNextData) {
      this.dom.btnDropData.classList.add('bg-red-50', 'border-red-400', 'text-red-700');
      this.dom.btnDropData.innerText = '● 下一数据帧将丢失';
    } else {
      this.dom.btnDropData.classList.remove('bg-red-50', 'border-red-400', 'text-red-700');
      this.dom.btnDropData.innerText = '模拟丢弃下一数据帧';
    }

    if (this.dropNextAck) {
      this.dom.btnDropAck.classList.add('bg-red-50', 'border-red-400', 'text-red-700');
      this.dom.btnDropAck.innerText = '● 下一ACK将丢失';
    } else {
      this.dom.btnDropAck.classList.remove('bg-red-50', 'border-red-400', 'text-red-700');
      this.dom.btnDropAck.innerText = '模拟丢弃下一ACK';
    }
  }

  showSenderAlert(msg, type = 'info') {
    const banner = this.dom.senderAlertBanner;
    if (!banner) return;
    banner.className = 'mb-3 text-xs font-mono font-bold px-3 py-1.5 rounded-lg border flex items-center justify-between transition-all';
    if (type === 'error') {
      banner.classList.add('bg-red-50', 'text-red-700', 'border-red-300', 'animate-pulse');
    } else if (type === 'warn') {
      banner.classList.add('bg-amber-50', 'text-amber-800', 'border-amber-300');
    } else if (type === 'success') {
      banner.classList.add('bg-emerald-50', 'text-emerald-700', 'border-emerald-300');
    } else {
      banner.classList.add('bg-blue-50', 'text-blue-700', 'border-blue-200');
    }
    banner.innerHTML = `<span>${msg}</span><button onclick="this.parentElement.classList.add('hidden')" class="text-xs opacity-60 hover:opacity-100 ml-2">✕</button>`;
    banner.classList.remove('hidden');
  }

  hideSenderAlert() {
    if (this.dom.senderAlertBanner) this.dom.senderAlertBanner.classList.add('hidden');
  }

  showReceiverAlert(msg, type = 'info') {
    const banner = this.dom.receiverAlertBanner;
    if (!banner) return;
    banner.className = 'mb-3 text-xs font-mono font-bold px-3 py-1.5 rounded-lg border flex items-center justify-between transition-all';
    if (type === 'purple') {
      banner.classList.add('bg-purple-50', 'text-purple-800', 'border-purple-300', 'shadow-sm');
    } else if (type === 'success') {
      banner.classList.add('bg-emerald-50', 'text-emerald-700', 'border-emerald-300');
    } else if (type === 'warn') {
      banner.classList.add('bg-amber-50', 'text-amber-800', 'border-amber-300');
    } else {
      banner.classList.add('bg-blue-50', 'text-blue-700', 'border-blue-200');
    }
    banner.innerHTML = `<span>${msg}</span><button onclick="this.parentElement.classList.add('hidden')" class="text-xs opacity-60 hover:opacity-100 ml-2">✕</button>`;
    banner.classList.remove('hidden');
  }

  hideReceiverAlert() {
    if (this.dom.receiverAlertBanner) this.dom.receiverAlertBanner.classList.add('hidden');
  }

  resetSimulation() {
    this.senderBase = 0;
    this.nextSeqNum = 0;
    this.rcvBase = 0;
    this.senderAcked.clear();
    this.receiverBuffer.clear();
    this.receiverDelivered.clear();

    // 清理所有独立定时器
    this.timers.clear();

    this.virtualTime = 0;
    this.inflightPackets = [];
    this.spaceTimeLines = [];
    this.spaceTimeAnnotations = [];
    this.logs = [];
    this.scenarioStepIndex = 0;
    this.scenarioTimer = 0;

    this.dropNextData = false;
    this.dropNextAck = false;
    this.updateDropBtnStyles();

    this.senderLostSeqs.clear();
    this.senderRetransmitSeq = null;
    this.hideSenderAlert();
    this.hideReceiverAlert();

    this.sessionId++;

    // 丢失场景若从阶段 2 开始跳入，初始化对应前置状态
    if (this.currentScenario === 'loss' && this.lossStage === 2) {
      this.initLossStage2State();
    } else {
      this.initDefaultDescriptions();
    }

    this.initCellsDOM();
    this.resizeCanvas();
    this.render();
  }

  initDefaultDescriptions() {
    if (this.currentScenario === 'normal') {
      this.dom.stageBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold';
      this.dom.stageBadge.innerText = '正常连续突发模式';
      this.setExplanation('【场景一：正常情况 (连续突发收发)】\n发送窗口 Wt=4，接收窗口 Wr=4。\n发送方在当前可用窗口内【依次连续并发发射多帧】（如帧 0、1、2、3 并行在途），在信道中形成连续飞行梯队；接收方按序【连续接收多帧】并依次回复独立确认 ACK 0~3，接收窗口平滑连续滑动；发送方收到 ACK 逐一关闭独立定时器，并紧接着连续发射下一波帧，流水线饱满高效！');
      this.addLog('系统已重置：选择重传协议 [正常连续突发收发模式]', 'info');
    } else if (this.currentScenario === 'loss') {
      this.dom.stageBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold';
      this.dom.stageBadge.innerText = '阶段一：单帧丢失演练';
      this.setExplanation('【场景二：发送帧丢失 (阶段一：丢失单帧 1)】\n发送方连续发射帧 0、1、2、3，其中【帧 1 途中丢失】。\n关键机制看点：\n1. 帧 0 正常交付；而失序的帧 2、3 到达后，接收方不会丢弃，而是【存入接收缓冲区 (标紫)】，并回复独立 ACK 2、3！\n2. 发送方收到 ACK 2、3 标记已确认，但 base 阻滞于 1，直到帧 1 定时器超时；\n3. 发送方【仅重传帧 1】（绝不回退重传 2、3）；\n4. 帧 1 抵达填补空洞后，接收方连同已缓存帧【批量级联交付】，两端窗口跨步跃升！');
      this.addLog('系统已重置：选择重传协议 [阶段一：丢失单帧 1 演练]', 'warn');
    } else if (this.currentScenario === 'error') {
      this.dom.stageBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold';
      this.dom.stageBadge.innerText = '发送帧出错 (NAK快速重传)';
      this.setExplanation('【场景三：发送帧出错与 NAK 快速重传】\n发送方连续发射帧 0、1、2、3；其中【帧 1 在传输途中遭遇比特翻转出错 (CRC校验失败)】。\n关键机制看点：\n1. 接收方收到帧 1 进行校验，检测出错误后【当场丢弃错误帧】，并立即向发送方回传【NAK 1 (否定确认)】！\n2. 随后的正常帧 2、3 到达被【乱序缓存 (标紫)】；\n3. 发送方收到 NAK 1：【不等定时器倒计时归零，立即触发快速选择重传】！\n4. 补齐空洞后，接收方连同已缓存帧【批量级联交付】，窗口顺畅跃升！');
      this.addLog('系统已重置：选择重传协议 [发送帧出错与 NAK 快速重传模式]', 'warn');
    } else {
      this.dom.stageBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-stone-200 text-stone-800 font-bold';
      this.dom.stageBadge.innerText = '自由演练沙盒';
      this.setExplanation('【自由演练沙盒】\n您可自由点击“＋ 发送单个帧”，点击飞行中的报文模拟丢包，或点击“模拟丢弃下一数据帧”观察选择重传与接收方乱序缓存过程。');
      this.addLog('系统已重置：选择重传协议 [自由演练沙盒]', 'info');
    }
  }

  initLossStage2State() {
    this.senderBase = 5;
    this.nextSeqNum = 5;
    this.rcvBase = 5;

    // 前序帧 0~4 均已确认和交付
    for (let i = 0; i < 5; i++) {
      this.senderAcked.add(i);
      this.receiverDelivered.add(i);
    }

    this.dom.stageBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-bold';
    this.dom.stageBadge.innerText = '阶段二：不连续双帧丢失';
    this.setExplanation('【场景二：发送帧丢失 (阶段二：丢失不连续双帧 5 与 7)】\n当前 base = 5，发送方连续发射帧 5、6、7、8，其中【帧 5 丢失】且【帧 7 丢失】（两帧不连续！）。\n关键机制看点：\n1. 帧 6 与帧 8 顺利到达被接收方【分别缓存】，回复 ACK 6 与 ACK 8；\n2. 帧 5 定时器先到期：发送方仅重传帧 5！\n3. 帧 5 补齐空洞 5，接收方交付 5、6，rcv_base 推进到 7（帧 7 依然缺失，已缓存的帧 8 继续保留）；\n4. 帧 7 定时器随后到期：发送方仅重传帧 7！\n5. 帧 7 补齐空洞 7，接收方交付 7、8，窗口跃升至 9！完整展示多空洞独立维护与两级填洞推进。');
    this.addLog('系统已跳转：选择重传协议 [阶段二：丢失不连续双帧 5、7 演练]', 'warn');
  }

  initCellsDOM() {
    // 发送方单元格
    this.dom.senderCellsContainer.innerHTML = '';
    for (let i = 0; i < this.TOTAL_FRAMES; i++) {
      const cell = document.createElement('div');
      cell.className = 'seq-cell';
      cell.id = `sender-cell-${i}`;
      cell.innerHTML = `
        <span class="text-xs font-mono font-bold">${i}</span>
        <span class="text-[9px] font-mono text-stone-400 mt-0.5" id="s-tag-${i}">可发</span>
      `;
      this.dom.senderCellsContainer.appendChild(cell);
    }

    // 接收方单元格
    this.dom.receiverCellsContainer.innerHTML = '';
    for (let i = 0; i < this.TOTAL_FRAMES; i++) {
      const cell = document.createElement('div');
      cell.className = 'seq-cell';
      cell.id = `receiver-cell-${i}`;
      cell.innerHTML = `
        <span class="text-xs font-mono font-bold">${i}</span>
        <span class="text-[9px] font-mono text-stone-400 mt-0.5" id="r-tag-${i}">待收</span>
      `;
      this.dom.receiverCellsContainer.appendChild(cell);
    }
  }

  resizeCanvas() {
    if (!this.dom.spacetimeCanvas) return;
    const rect = this.dom.spacetimeCanvas.getBoundingClientRect();
    this.dom.spacetimeCanvas.width = rect.width * window.devicePixelRatio || 600 * window.devicePixelRatio;
    this.dom.spacetimeCanvas.height = rect.height * window.devicePixelRatio || 400 * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.canvasWidth = rect.width || 600;
    this.canvasHeight = rect.height || 400;
  }

  // =========================================================================
  // 定时器管理 (SR 独立定时器机制)
  // =========================================================================

  startTimerFor(seq, isRetransmit = false) {
    this.timers.set(seq, {
      running: true,
      duration: this.TIMEOUT_DURATION,
      elapsed: 0,
      isRetransmit: isRetransmit
    });
  }

  stopTimerFor(seq) {
    this.timers.delete(seq);
  }

  // =========================================================================
  // 发送与接收交互核心
  // =========================================================================

  sendDataFrame(seq, forceDrop = false, isRetransmit = false, isCorrupted = false) {
    // 检查发送窗口是否溢出
    if (!isRetransmit && seq >= this.senderBase + this.WINDOW_SIZE) {
      this.setExplanation(`【发送受阻】发送窗口 [${this.senderBase} ~ ${this.senderBase + this.WINDOW_SIZE - 1}] 已满，必须等待旧帧的 ACK 抵达推进 base 后方可发送新帧！`);
      this.addLog(`发送阻塞：窗口已满，无法发射新帧 Frame [${seq}]`, 'warn');
      return false;
    }

    // 启动该帧独立的定时器
    this.startTimerFor(seq, isRetransmit);

    const packet = {
      id: this.packetIdCounter++,
      type: 'DATA',
      seq: seq,
      progress: 0,
      duration: this.TRANSIT_TIME,
      dropped: forceDrop,
      dropAtProgress: forceDrop ? 0.48 : null,
      dropStartTime: null,
      isDropping: false,
      isRetransmit: isRetransmit,
      isCorrupted: isCorrupted,
      startX: 40,
      endX: 420,
      creationVirtualTime: this.virtualTime
    };

    this.inflightPackets.push(packet);

    // 时空梯形图记录
    this.spaceTimeLines.push({
      id: packet.id,
      type: 'DATA',
      seq: seq,
      startTime: this.virtualTime,
      dropped: forceDrop,
      isRetransmit: isRetransmit,
      isCorrupted: isCorrupted,
      state: 'inflight'
    });

    if (forceDrop) {
      this.senderLostSeqs.add(seq);
    }

    const prefix = isRetransmit ? '⚡ 选择重传' : '发送方';
    let extra = '';
    if (forceDrop) extra = ' [注：信道中将丢失]';
    else if (isCorrupted) extra = ' [注：信道中将发生比特翻转/CRC错]';

    this.addLog(`${prefix}：发出数据帧 Frame [${seq}] (启动独立定时器 T${seq})${extra}`, isRetransmit || isCorrupted ? 'warn' : 'info');
    return true;
  }

  // 连续依次发射批次多帧 (流水线突发)
  burstSendFrames(seqList, corruptedSeq = null, isRetransmit = false) {
    const session = this.sessionId;
    seqList.forEach((seq, idx) => {
      setTimeout(() => {
        if (this.sessionId !== session) return;
        const isCorrupt = (seq === corruptedSeq);
        this.sendDataFrame(seq, false, isRetransmit, isCorrupt);
        this.render();
      }, idx * 240 / this.playSpeed);
    });
  }

  sendAckFrame(seq, forceDrop = false) {
    const packet = {
      id: this.packetIdCounter++,
      type: 'ACK',
      seq: seq,
      progress: 0,
      duration: this.TRANSIT_TIME,
      dropped: forceDrop,
      dropAtProgress: forceDrop ? 0.5 : null,
      dropStartTime: null,
      isDropping: false,
      startX: 420,
      endX: 40,
      creationVirtualTime: this.virtualTime
    };

    this.inflightPackets.push(packet);

    this.spaceTimeLines.push({
      id: packet.id,
      type: 'ACK',
      seq: seq,
      startTime: this.virtualTime,
      dropped: forceDrop,
      state: 'inflight'
    });

    this.addLog(`接收方：回复独立确认 Selective ACK [${seq}]${forceDrop ? ' [注：信道中将丢失]' : ''}`, 'success');
  }

  // 接收方回复否定确认 (NAK Frame)
  sendNakFrame(seq, forceDrop = false) {
    const packet = {
      id: this.packetIdCounter++,
      type: 'NAK',
      seq: seq,
      progress: 0,
      duration: this.TRANSIT_TIME,
      dropped: forceDrop,
      dropAtProgress: forceDrop ? 0.5 : null,
      dropStartTime: null,
      isDropping: false,
      startX: 420,
      endX: 40,
      creationVirtualTime: this.virtualTime
    };

    this.inflightPackets.push(packet);

    this.spaceTimeLines.push({
      id: packet.id,
      type: 'NAK',
      seq: seq,
      startTime: this.virtualTime,
      dropped: forceDrop,
      state: 'inflight'
    });

    this.addLog(`接收方：检测到错误帧！回传否定确认 NAK [${seq}]，请求发送方立即快速重传！`, 'error');
  }

  // 接收方处理到达的数据帧 (SR 核心算法)
  onReceiveDataFrame(packet) {
    const seq = packet.seq;
    const wr = this.WINDOW_SIZE;
    const rBase = this.rcvBase;

    // 0. 检验和检查：如果数据帧发生比特差错 (CRC校验失败)
    if (packet.isCorrupted) {
      this.showReceiverAlert(`⚠️ 接收方收到损坏帧 [${seq}]！CRC 校验和检验失败，丢弃错误帧并立即回传 NAK [${seq}]！`, 'warn');
      this.addLog(`接收方：帧 [${seq}] CRC 校验失败！丢弃错误帧，向发送方回传 NAK [${seq}] 请求立即快速重传`, 'error');
      this.sendNakFrame(seq, this.dropNextAck);
      if (this.dropNextAck) this.dropNextAck = false;
      this.render();
      return;
    }

    // 1. 落在接收窗口内 [rcvBase, rcvBase + Wr - 1]
    if (seq >= rBase && seq < rBase + wr) {
      // 回复独立 ACK(seq)
      this.sendAckFrame(seq, this.dropNextAck);
      if (this.dropNextAck) this.dropNextAck = false;

      // 无论是否是基序号，先缓存
      this.receiverBuffer.add(seq);

      // 判断是否正好填补了基序号 (填洞)
      if (seq === rBase) {
        // 从 rBase 开始，连续交付所有已缓存的帧
        const deliveredBatch = [];
        let cur = rBase;
        while (this.receiverBuffer.has(cur)) {
          this.receiverBuffer.delete(cur);
          this.receiverDelivered.add(cur);
          deliveredBatch.push(cur);
          cur++;
        }
        const oldBase = this.rcvBase;
        this.rcvBase = cur;

        if (deliveredBatch.length > 1) {
          // 级联批量交付
          this.showReceiverAlert(`🎉 填洞成功！基序号帧 [${seq}] 抵达，批量级联交付帧 [${deliveredBatch.join(', ')}]，接收窗口滑动至 ${this.rcvBase}！`, 'success');
          this.addLog(`接收方：填洞成功！批量交付连续帧 [${deliveredBatch.join(', ')}]，rcv_base 推进由 ${oldBase} &rarr; ${this.rcvBase}`, 'success');
        } else {
          this.showReceiverAlert(`📥 接收方按序接收帧 [${seq}]，已交付上层，接收窗口滑动至 ${this.rcvBase}`, 'success');
          this.addLog(`接收方：按序接收并交付帧 [${seq}]，rcv_base 推进为 ${this.rcvBase}`, 'info');
        }
      } else {
        // 失序但落在窗口内 -> 乱序缓存！
        this.showReceiverAlert(`🟣 乱序帧 [${seq}] 到达！符合接收窗口 [${rBase} ~ ${rBase + wr - 1}]，已存入接收缓冲区，等待基序号帧填洞！`, 'purple');
        this.addLog(`接收方：乱序到达！将帧 [${seq}] 存入接收缓冲区，回复独立 ACK [${seq}]，rcv_base 仍为 ${rBase}`, 'warn');
      }
    }
    // 2. 落在 [rcvBase - Wr, rcvBase - 1] 之间 (早期已确认帧，发送方可能因 ACK 丢失超时重传)
    else if (seq >= Math.max(0, rBase - wr) && seq < rBase) {
      // 必须重新回复 ACK，避免发送方卡住
      this.sendAckFrame(seq, false);
      this.showReceiverAlert(`🔁 收到已交付过的旧帧 [${seq}]，重新回复 ACK [${seq}] 协助发送方对齐`, 'info');
      this.addLog(`接收方：收到已交付帧 [${seq}]，重发确认 ACK [${seq}]`, 'info');
    }
    // 3. 其他序号忽略
    else {
      this.addLog(`接收方：收到窗口外无效帧 [${seq}]，直接忽略`, 'warn');
    }

    this.render();
  }

  // 发送方处理到达的 NAK 帧 (触发快速选择重传)
  onReceiveNakFrame(packet) {
    const nakSeq = packet.seq;
    this.addLog(`发送方：收到否定确认 NAK [${nakSeq}]！接收方已丢弃损坏帧`, 'warn');
    this.showSenderAlert(`⚡ 收到 NAK [${nakSeq}]！不等定时器倒计时归零，立即触发快速选择重传帧 [${nakSeq}]！`, 'warn');
    this.setExplanation(`【收到 NAK 立即快速选择重传】\n发送方收到接收方发来的否定确认 NAK ${nakSeq}！\n优势体现：此时定时器 T${nakSeq} 仍在倒计时，但 NAK 机制让发送方【免除被动苦等超时】，当场重新发射正确帧 [${nakSeq}]，极大地降低了网络传输时延！`);

    this.senderRetransmitSeq = nakSeq;
    // 重启定时器并立即重发未损坏帧 (isRetransmit = true)
    this.sendDataFrame(nakSeq, false, true, false);
    this.render();
  }

  // 发送方处理到达的 ACK 帧
  onReceiveAckFrame(packet) {
    const ackSeq = packet.seq;

    // 1. 关闭该帧的独立定时器
    this.stopTimerFor(ackSeq);

    // 2. 标记该帧已确认
    this.senderAcked.add(ackSeq);
    this.senderLostSeqs.delete(ackSeq);

    const oldBase = this.senderBase;

    // 3. 如果确认的正好是基序号 sendBase，滑动窗口前进到第一个未确认的帧
    if (ackSeq === this.senderBase) {
      let cur = this.senderBase;
      while (this.senderAcked.has(cur)) {
        cur++;
      }
      this.senderBase = cur;

      if (this.senderBase > oldBase + 1) {
        this.showSenderAlert(`🎉 收到基序号 ACK [${ackSeq}]！由于后续帧已被先前 ACK 确认，发送窗口级联跃升：base 由 ${oldBase} &rarr; ${this.senderBase}！`, 'success');
        this.addLog(`发送方：收到基序号 ACK [${ackSeq}]，窗口级联滑动：base ${oldBase} &rarr; ${this.senderBase}`, 'success');
      } else {
        this.showSenderAlert(`✅ 收到基序号 ACK [${ackSeq}]，发送窗口推进：base 由 ${oldBase} &rarr; ${this.senderBase}`, 'success');
        this.addLog(`发送方：收到 ACK [${ackSeq}]，base 推进为 ${this.senderBase}`, 'info');
      }
    } else if (ackSeq > this.senderBase) {
      this.showSenderAlert(`📌 收到失序确认 ACK [${ackSeq}]！标记帧 [${ackSeq}] 已确认并关闭定时器 T${ackSeq}；基序号 base 依然为 ${this.senderBase} 等待前序帧`, 'info');
      this.addLog(`发送方：收到乱序确认 ACK [${ackSeq}]，关闭 T${ackSeq}，base 阻滞于 ${this.senderBase}`, 'info');
    } else {
      this.addLog(`发送方：收到重复或旧确认 ACK [${ackSeq}]，忽略`, 'info');
    }

    this.render();
  }

  // 某个帧的独立定时器超时
  onTimeout(seq) {
    this.addLog(`⏰ 定时器超时：帧 [${seq}] 的独立定时器 T${seq} 到期！`, 'warn');
    this.showSenderAlert(`⏰ 帧 [${seq}] 超时！选择重传机制触发：仅重发损坏/丢失的帧 [${seq}]！`, 'error');

    this.senderRetransmitSeq = seq;
    this.senderLostSeqs.delete(seq);

    // 触发选择重传：只重发 seq 帧！
    this.sendDataFrame(seq, false, true);
    this.render();
  }

  // =========================================================================
  // 自动化推演与场景脚本
  // =========================================================================

  stepForward() {
    if (this.currentScenario === 'normal') {
      this.stepNormalScenario();
    } else if (this.currentScenario === 'loss') {
      this.stepLossScenario();
    } else if (this.currentScenario === 'error') {
      this.stepErrorScenario();
    } else {
      this.manualSendFrame();
    }
  }

  // 1. 正常情况推演：连续突发流水线收发 (Burst & Pipelining)
  stepNormalScenario() {
    // 拍 1：窗口 [0 ~ 3]，连续依次发射帧 0、1、2、3
    if (this.nextSeqNum === 0) {
      this.nextSeqNum = 4;
      this.burstSendFrames([0, 1, 2, 3]);
      this.setExplanation('【第 1 波：连续突发流水发射】\n发送方在当前发送窗口 [0 ~ 3] 内，依次连续发出帧 0、1、2、3！\n4 个数据帧在信道中形成并发飞行梯队；接收方将按序连续接收，并依次回复独立确认 ACK 0~3。');
      this.showSenderAlert('🚀 发送方依次连续发射首波帧 [0, 1, 2, 3] 入信道...', 'info');
      this.render();
      return;
    }

    // 拍 2：当 ACK 0~3 陆续抵达将 base 推进到 4 时，连续发射第 2 波帧 4、5、6、7
    if (this.senderBase >= 4 && this.nextSeqNum === 4) {
      this.nextSeqNum = 8;
      this.burstSendFrames([4, 5, 6, 7]);
      this.setExplanation('【第 2 波：窗口滑动连续并发】\n首波全部确认，base 推进至 4！发送方依次连续发出第 2 波帧 4、5、6、7。\n接收方按序连续接收并批量向上层交付！');
      this.showSenderAlert('🚀 发送方依次连续发射第 2 波帧 [4, 5, 6, 7] 入信道...', 'info');
      this.render();
      return;
    }

    // 拍 3：当 base 到达 8 时，连续发射最后的帧 8、9
    if (this.senderBase >= 8 && this.nextSeqNum === 8) {
      this.nextSeqNum = 10;
      this.burstSendFrames([8, 9]);
      this.setExplanation('【第 3 波：收尾帧连续发射】\nbase 推进至 8，发送方发出最后的收尾帧 [8, 9]！');
      this.showSenderAlert('🚀 发送方发出收尾帧 [8, 9]...', 'info');
      this.render();
      return;
    }

    // 全部发完，等待确认
    if (this.senderBase < this.TOTAL_FRAMES) {
      this.setExplanation('【流水线推进中】多帧正在双向信道中连续飞行并回复 ACK，接收方连续按序接收，滑动窗口平稳右滑，请稍候……');
      return;
    }

    this.setExplanation('🎉【正常连续突发收发场景圆满完成】\n10 个数据帧全部以连续并发流水线形式发射，接收方连续按序接收并独立确认，两端滑动窗口顺畅滑向终点！');
    this.showSenderAlert('🎉 全部 10 帧连续突发收发并确认完毕！', 'success');
    this.isPlaying = false;
    this.updatePlayBtn();
  }

  // 2. 发送帧出错场景：接收方检错丢弃并回传 NAK，发送方不等超时立即快速选择重传
  stepErrorScenario() {
    // 拍 1：发射首波帧 0、1、2、3 (其中帧 1 在信道中发生比特差错/CRC错)
    if (this.nextSeqNum === 0) {
      this.nextSeqNum = 4;
      this.burstSendFrames([0, 1, 2, 3], 1); // 帧 1 带有 CRC 差错
      this.setExplanation('【第 1 拍：连续发射 4 帧，帧 1 途中出错】\n发送方连续发出帧 0、1、2、3。\n【关键看点】：帧 1 在信道传输中遭受噪声干扰，发生比特翻转（CRC校验失败）！\n请观察稍后接收方收到错误帧 1 时的【检错丢弃】与【NAK 回传】。');
      this.showSenderAlert('📤 发送方连续发射帧 [0, 1, 2, 3]，其中帧 [1] 将发生差错...', 'warn');
      this.render();
      return;
    }

    // 拍 2：错误帧已被 NAK 修复并确认，base 推进到 4，连续发射第 2 波帧 4、5、6、7
    if (this.senderBase >= 4 && this.nextSeqNum === 4) {
      this.nextSeqNum = 8;
      this.burstSendFrames([4, 5, 6, 7]);
      this.setExplanation('【第 2 拍：错误化解，窗口推进】\n错误帧 1 已被 NAK 机制快速重传并确认，base 跃升至 4！\n发送方连续发出第 2 波帧 4、5、6、7，流水线恢复高效运转。');
      this.showSenderAlert('🚀 发送方连续发出第 2 波帧 [4, 5, 6, 7]...', 'info');
      this.render();
      return;
    }

    // 拍 3：base 推进到 8，发射最后帧 8、9
    if (this.senderBase >= 8 && this.nextSeqNum === 8) {
      this.nextSeqNum = 10;
      this.burstSendFrames([8, 9]);
      this.setExplanation('【第 3 拍：收尾帧发射】\nbase 推进至 8，发送方发出最后的帧 [8, 9]！');
      this.showSenderAlert('🚀 发送方发出收尾帧 [8, 9]...', 'info');
      this.render();
      return;
    }

    // 全部发完，等待确认
    if (this.senderBase < this.TOTAL_FRAMES) {
      this.setExplanation('【报文传输中】信道中报文/NAK/ACK 正在传输中，请稍候……');
      return;
    }

    this.setExplanation('🎉【发送帧出错与 NAK 快速重传场景圆满完成】\n1. 接收方收到损坏帧 1 运行 CRC 校验失败，坚决【丢弃错误帧】，避免提交脏数据；\n2. 接收方即刻回传【NAK 1】，发送方【不等超时】立即触发快速选择重传；\n3. 接收方填洞后连同已缓存的帧 2、3 批量级联交付，演示圆满结束！');
    this.showSenderAlert('🎉 演示圆满完成：NAK 快速重传化解帧出错，全部 10 帧顺利交付！', 'success');
    this.isPlaying = false;
    this.updatePlayBtn();
  }

  // 2. 丢包场景推演 (包含阶段一：丢失单帧 1，阶段二：丢失不连续双帧 5 与 7)
  stepLossScenario() {
    if (this.lossStage === 1) {
      this.stepLossStage1();
    } else {
      this.stepLossStage2();
    }
  }

  // 阶段一：单帧丢失 (帧 1 丢失)
  stepLossStage1() {
    const s = this.scenarioStepIndex;

    // 拍 0：发送首批帧 0、1、2、3 (其中帧 1 设为丢失)
    if (this.nextSeqNum < 4) {
      const seq = this.nextSeqNum;
      this.nextSeqNum++;
      const willDrop = (seq === 1);
      this.sendDataFrame(seq, willDrop, false);

      if (willDrop) {
        this.setExplanation(`【阶段一：发射帧 1 (预设丢失)】发送方发出帧 [1]，但该帧将在信道中意外损毁丢失！\n请注意观察稍后帧 2、3 到达接收方时的【乱序缓存】行为。`);
      } else {
        this.setExplanation(`【阶段一：流水线发帧】发送方发出帧 [${seq}]，启动独立定时器 T${seq}。窗口：[${this.senderBase} ~ ${this.senderBase + this.WINDOW_SIZE - 1}]。`);
      }
      this.render();
      return;
    }

    // 拍 1：窗口已达 4，如果 ACK 0 抵达推进了 base 到 1，窗口释放新名额，可发帧 4
    if (this.senderBase === 1 && this.nextSeqNum === 4) {
      this.nextSeqNum++;
      this.sendDataFrame(4, false, false);
      this.setExplanation(`【阶段一：释放新序号发射】ACK 0 到达将 base 推进到 1，窗口前移容纳了帧 [4]！发送方发射帧 [4]。\n帧 4 抵达接收方后也将被暂存进接收缓冲区。`);
      this.render();
      return;
    }

    // 拍 2：此时帧 1 尚未重传，等待帧 1 超时
    if (this.senderAcked.has(2) && this.senderAcked.has(3) && !this.senderAcked.has(1)) {
      if (this.timers.has(1)) {
        const t1 = this.timers.get(1);
        if (!t1.isRetransmit) {
          t1.elapsed = t1.duration; // 立即触发超时
          this.setExplanation(`【阶段一：帧 1 独立超时！】\n关键对比时刻：帧 2、3、4 的 ACK 早已到达并关闭了各自的定时器。\n由于只有帧 1 的定时器 T1 超时，选择重传机制【仅重发帧 1】！（绝非像 GBN 那样把 2、3、4 全部重发）。`);
          return;
        } else {
          this.setExplanation(`【阶段一：等待重传帧 1 抵达】重传的数据帧 Frame [1] 正在信道中飞向接收方……抵达后将填补接收方基序号空洞！`);
          return;
        }
      }
    }

    // 拍 3：等待重传的帧 1 到达接收方填洞
    if (this.senderAcked.has(1)) {
      this.setExplanation(`🎉【阶段一成功化解！】\n重传的帧 1 成功填补了接收方空洞，接收方将已缓存的 2、3、4 批量级联交付，发送方窗口一举跃升至 base = 5！\n\n即将自动进入【阶段二：丢失不连续的两帧 (帧 5 与 帧 7)】……`);
      this.showSenderAlert('🎉 阶段一完成！即将进入阶段二（不连续双帧丢失）...', 'success');

      // 准备切换到阶段二
      this.lossStage = 2;
      this.updateStageJumpStyles();
      this.dom.stageBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-bold';
      this.dom.stageBadge.innerText = '阶段二：不连续双帧丢失';
      return;
    }

    this.setExplanation('【阶段一推演中】信道中报文正在传输或等待定时器触发中，请稍候……');
  }

  // 阶段二：不连续双帧丢失 (帧 5 与 帧 7 丢失)
  stepLossStage2() {
    // 拍 0：发送帧 5、6、7、8 (其中帧 5 丢失，帧 7 丢失)
    if (this.nextSeqNum < 9) {
      const seq = this.nextSeqNum;
      this.nextSeqNum++;
      const willDrop = (seq === 5 || seq === 7);
      this.sendDataFrame(seq, willDrop, false);

      if (seq === 5) {
        this.setExplanation(`【阶段二：发射帧 5 (丢失 #1)】发送方发出帧 [5]，信道中预设丢失！`);
      } else if (seq === 6) {
        this.setExplanation(`【阶段二：发射帧 6 (正常)】发送方发出帧 [6]。由于帧 5 丢失，帧 6 到达接收方后将被【缓存】！`);
      } else if (seq === 7) {
        this.setExplanation(`【阶段二：发射帧 7 (丢失 #2)】发送方发出帧 [7]，信道中预设丢失！注意：丢失的 5 与 7 不连续！`);
      } else if (seq === 8) {
        this.setExplanation(`【阶段二：发射帧 8 (正常)】发送方发出帧 [8]。帧 8 到达接收方后也将被【缓存】在缓冲区！`);
      }
      this.render();
      return;
    }

    // 拍 1：帧 6 与 8 的 ACK 已送达，帧 5 超时
    if (this.senderAcked.has(6) && !this.senderAcked.has(5)) {
      if (this.timers.has(5)) {
        const t5 = this.timers.get(5);
        if (!t5.isRetransmit) {
          t5.elapsed = t5.duration; // 立即触发超时
          this.setExplanation(`【阶段二：帧 5 独立超时】\n定时器 T5 到期，发送方【仅重传帧 5】！\n帧 5 抵达后将填补空洞 5，连同已缓存的 6 一并交付；但由于帧 7 依然缺失，rcv_base 将在 7 处再次刹车！`);
          return;
        } else {
          this.setExplanation(`【阶段二：等待重传帧 5 抵达】重传的帧 [5] 正在信道中飞行，即将填补第一处空洞……`);
          return;
        }
      }
    }

    // 拍 2：帧 5 已补齐，等待帧 7 超时
    if (this.senderAcked.has(5) && !this.senderAcked.has(7)) {
      if (this.timers.has(7)) {
        const t7 = this.timers.get(7);
        if (!t7.isRetransmit) {
          t7.elapsed = t7.duration; // 立即触发超时
          this.setExplanation(`【阶段二：帧 7 独立超时】\n帧 5 已解决并将 base 推进到 7！此时第二处空洞——帧 7 定时器 T7 到期，发送方【仅重发帧 7】！\n帧 7 抵达后将填补空洞 7，并连同之前已缓存的帧 8 一起批量交付！`);
          return;
        } else {
          this.setExplanation(`【阶段二：等待重传帧 7 抵达】重传的帧 [7] 正在信道中飞行，即将填补第二处空洞……`);
          return;
        }
      }
    }

    // 拍 3：帧 7 也已补齐，发射最后的帧 9
    if (this.senderAcked.has(7) && this.senderAcked.has(8) && this.nextSeqNum === 9) {
      this.nextSeqNum++;
      this.sendDataFrame(9, false, false);
      this.setExplanation(`【阶段二：两处空洞全补齐】帧 5、6、7、8 全部交付！发送方发射最后的帧 [9]。`);
      this.render();
      return;
    }

    // 拍 4：末尾确认收齐
    if (this.senderAcked.has(9)) {
      this.setExplanation('🎉【选择重传协议丢包场景演示圆满完成】\n1. 阶段一成功演示单帧丢失后的独立重传与接收方填洞批量交付；\n2. 阶段二成功演示不连续双帧 (5 与 7) 丢失时，多定时器独立运作、接收方多次暂存与两级分步填洞推进！\n所有 10 个数据帧全部确认，完美展现选择重传协议的强大容错与并发性能！');
      this.showSenderAlert('🎉 演示圆满完成：单帧丢失与双帧不连续丢失全部成功解决！', 'success');
      this.isPlaying = false;
      this.updatePlayBtn();
      return;
    }

    this.setExplanation('【阶段二推演中】信道中报文正在传输或等待独立超时重发中……');
  }

  // 自由模式发送单个帧
  manualSendFrame() {
    if (this.nextSeqNum >= this.TOTAL_FRAMES) {
      this.addLog(`发送已达最大序号 ${this.TOTAL_FRAMES - 1}，请重置后重试`, 'warn');
      return;
    }
    const seq = this.nextSeqNum;
    if (this.sendDataFrame(seq, this.dropNextData, false)) {
      this.nextSeqNum++;
      if (this.dropNextData) this.dropNextData = false;
      this.updateDropBtnStyles();
    }
    this.render();
  }

  // =========================================================================
  // 60FPS 渲染循环与报文位移物理更新
  // =========================================================================

  update(deltaTime) {
    const adjustedDelta = deltaTime * this.playSpeed;
    this.virtualTime += adjustedDelta;

    // 1. 各帧独立定时器更新
    for (let [seq, t] of this.timers.entries()) {
      if (t.running) {
        t.elapsed += adjustedDelta;
        if (t.elapsed >= t.duration) {
          this.onTimeout(seq);
        }
      }
    }

    // 2. 飞行报文位置更新
    for (let i = this.inflightPackets.length - 1; i >= 0; i--) {
      const p = this.inflightPackets[i];

      // 正在播放丢包爆炸动画
      if (p.isDropping) {
        if (this.virtualTime - p.dropStartTime >= 800) {
          this.inflightPackets.splice(i, 1);
        }
        continue;
      }

      p.progress += adjustedDelta / p.duration;

      // 触发信道丢包
      if (p.dropped && p.dropAtProgress && p.progress >= p.dropAtProgress) {
        p.isDropping = true;
        p.dropStartTime = this.virtualTime;
        this.addLog(`💥 信道意外：${p.type} [${p.seq}] 在传输途中损毁丢失！`, 'warn');
        if (p.type === 'DATA') {
          this.showSenderAlert(`💥 数据帧 Frame [${p.seq}] 在传输信道中丢失！等待独立定时器超时重发...`, 'error');
        }
        continue;
      }

      // 报文安全抵达对端
      if (p.progress >= 1.0) {
        this.inflightPackets.splice(i, 1);
        if (p.type === 'DATA') {
          this.onReceiveDataFrame(p);
        } else if (p.type === 'ACK') {
          this.onReceiveAckFrame(p);
        } else if (p.type === 'NAK') {
          this.onReceiveNakFrame(p);
        }
      }
    }

    // 自动播放节奏推演
    if (this.isPlaying) {
      this.scenarioTimer += adjustedDelta;
      if (this.scenarioTimer >= 2200) {
        this.scenarioTimer = 0;
        this.stepForward();
      }
    }
  }

  // =========================================================================
  // 视图渲染 (DOM + Canvas)
  // =========================================================================

  render() {
    this.renderSenderBuffer();
    this.renderReceiverBuffer();
    this.renderMultiTimers();
    this.renderStats();
    this.renderInflightPacketsDOM();
    this.drawSpaceTimeDiagram();
  }

  renderSenderBuffer() {
    const base = this.senderBase;
    const next = this.nextSeqNum;
    const N = this.WINDOW_SIZE;

    for (let i = 0; i < this.TOTAL_FRAMES; i++) {
      const cell = document.getElementById(`sender-cell-${i}`);
      const tag = document.getElementById(`s-tag-${i}`);
      if (!cell) continue;

      cell.className = 'seq-cell';

      if (this.senderLostSeqs.has(i)) {
        cell.classList.add('status-lost');
        tag.innerText = '丢包待传';
      } else if (this.senderAcked.has(i)) {
        cell.classList.add('status-acked');
        tag.innerText = '已确认';
      } else if (i >= base && i < next) {
        // 已发送未确认
        if (this.timers.has(i) && this.timers.get(i).isRetransmit) {
          cell.classList.add('status-retransmit');
          tag.innerText = '重传在途';
        } else {
          cell.classList.add('status-unack');
          tag.innerText = '已发未认';
        }
      } else if (i >= next && i < base + N) {
        cell.classList.add('status-usable');
        tag.innerText = '可用未发';
      } else {
        cell.classList.add('status-outside');
        tag.innerText = '窗口外';
      }
    }

    // 更新滑动窗口包围框位置与尺寸
    const cellWidth = 44 + 8; // 44px 宽 + 8px gap
    const leftPos = Math.min(base, this.TOTAL_FRAMES) * cellWidth;
    const remaining = Math.max(0, this.TOTAL_FRAMES - base);
    const visibleCount = Math.min(N, remaining);

    if (this.dom.senderBracket) {
      if (visibleCount <= 0) {
        this.dom.senderBracket.style.opacity = '0';
      } else {
        this.dom.senderBracket.style.opacity = '1';
        this.dom.senderBracket.style.transform = `translateX(${leftPos}px)`;
        this.dom.senderBracket.style.width = `${visibleCount * cellWidth - 8}px`;
      }
    }

    // 指针位置
    if (this.dom.senderBasePointer) {
      this.dom.senderBasePointer.style.transform = `translateX(${leftPos + 6}px)`;
      this.dom.senderBasePointer.innerHTML = base >= this.TOTAL_FRAMES
        ? `▲ base = ${base} (全确认)`
        : `▲ base = ${base}`;
    }

    if (this.dom.senderNextPointer) {
      const nextPos = Math.min(next, this.TOTAL_FRAMES) * cellWidth;
      this.dom.senderNextPointer.style.transform = `translateX(${nextPos + 6}px)`;
      this.dom.senderNextPointer.innerHTML = next >= this.TOTAL_FRAMES
        ? `▲ nextseq = ${next} (全发出)`
        : `▲ nextseq = ${next}`;
    }
  }

  renderReceiverBuffer() {
    const rBase = this.rcvBase;
    const wr = this.WINDOW_SIZE;

    for (let i = 0; i < this.TOTAL_FRAMES; i++) {
      const cell = document.getElementById(`receiver-cell-${i}`);
      const tag = document.getElementById(`r-tag-${i}`);
      if (!cell) continue;

      cell.className = 'seq-cell';

      if (this.receiverDelivered.has(i)) {
        cell.classList.add('status-acked');
        tag.innerText = '已交付';
      } else if (this.receiverBuffer.has(i)) {
        // SR 核心：乱序已缓存，等待填洞
        cell.classList.add('status-buffered');
        tag.innerText = '缓存待交';
      } else if (i === rBase) {
        cell.classList.add('status-expected');
        tag.innerText = '期待填洞';
      } else if (i > rBase && i < rBase + wr) {
        cell.classList.add('status-outside');
        tag.innerText = '窗内待收';
      } else {
        cell.classList.add('status-outside');
        tag.innerText = '窗口外';
      }
    }

    // 接收窗口滑动框 (Wr = 4)
    const cellWidth = 44 + 8;
    const leftPos = Math.min(rBase, this.TOTAL_FRAMES) * cellWidth;
    const remaining = Math.max(0, this.TOTAL_FRAMES - rBase);
    const visibleCount = Math.min(wr, remaining);

    if (this.dom.receiverBracket) {
      if (visibleCount <= 0) {
        this.dom.receiverBracket.style.opacity = '0';
      } else {
        this.dom.receiverBracket.style.opacity = '1';
        this.dom.receiverBracket.style.transform = `translateX(${leftPos}px)`;
        this.dom.receiverBracket.style.width = `${visibleCount * cellWidth - 8}px`;
      }
    }

    if (this.dom.receiverPointer) {
      this.dom.receiverPointer.style.transform = `translateX(${leftPos + 6}px)`;
      this.dom.receiverPointer.innerHTML = rBase >= this.TOTAL_FRAMES
        ? `▲ 全部交付完毕 (Wr=4)`
        : `▲ rcv_base = ${rBase} (Wr=4)`;
    }
  }

  renderMultiTimers() {
    const container = this.dom.multiTimersBar;
    if (!container) return;

    if (this.timers.size === 0) {
      container.innerHTML = `<span class="text-[11px] font-mono text-stone-400">无活动定时器</span>`;
      return;
    }

    let html = '';
    for (let [seq, t] of this.timers.entries()) {
      const remaining = Math.max(0, (t.duration - t.elapsed) / 1000).toFixed(1);
      const isUrgent = t.elapsed / t.duration > 0.75;
      const isTimeout = t.elapsed >= t.duration;
      const chipClass = isTimeout ? 'timer-chip timeout' : (isUrgent ? 'timer-chip active' : 'timer-chip');

      html += `
        <div class="${chipClass}">
          <span class="font-bold">T${seq}:</span>
          <span>${remaining}s</span>
        </div>
      `;
    }
    container.innerHTML = html;
  }

  renderStats() {
    this.dom.statBase.innerText = this.senderBase;
    this.dom.statNext.innerText = this.nextSeqNum;
    this.dom.statRcvBase.innerText = this.rcvBase;

    if (this.receiverBuffer.size === 0) {
      this.dom.statBuffer.innerText = '空 (无乱序帧)';
      this.dom.statBuffer.className = 'text-sm font-bold text-stone-400';
    } else {
      const bufList = Array.from(this.receiverBuffer).sort((a, b) => a - b);
      this.dom.statBuffer.innerText = `帧 [${bufList.join(', ')}] 暂存待交付`;
      this.dom.statBuffer.className = 'text-sm font-bold text-purple-700';
    }

    this.dom.statTimersCount.innerText = this.timers.size;
    this.dom.statInflight.innerText = this.inflightPackets.length;
  }

  renderInflightPacketsDOM() {
    const lane = this.dom.channelLane;
    if (!lane) return;

    // 清空现有飞行报文 DOM (保留引导线和提示)
    const oldPackets = lane.querySelectorAll('.inflight-packet');
    oldPackets.forEach(el => el.remove());

    const laneWidth = lane.clientWidth || 500;
    const leftMargin = 50;
    const rightMargin = laneWidth - 50;

    this.inflightPackets.forEach(p => {
      const el = document.createElement('div');
      el.className = 'inflight-packet';

      if (p.type === 'DATA') {
        el.classList.add('packet-data');
        if (p.isRetransmit) el.classList.add('packet-retransmit');
        if (p.isCorrupted) el.classList.add('packet-corrupted');
      } else if (p.type === 'NAK') {
        el.classList.add('packet-nak');
      } else {
        el.classList.add('packet-ack');
      }

      if (p.isDropping) el.classList.add('is-dropping');

      let curX, curY;
      if (p.type === 'DATA') {
        curX = leftMargin + (rightMargin - leftMargin) * p.progress;
        curY = 30; // 数据帧高度
        if (p.isDropping) {
          el.innerHTML = `<span>💥 帧 [${p.seq}] 丢失!</span>`;
        } else if (p.isCorrupted) {
          el.innerHTML = `<span>⚠️ [CRC错] Frame [${p.seq}]</span>`;
        } else if (p.isRetransmit) {
          el.innerHTML = `<span>⚡ [重传] Frame [${p.seq}]</span>`;
        } else {
          el.innerHTML = `<span>▶ Frame [${p.seq}]</span>`;
        }
      } else if (p.type === 'NAK') {
        curX = rightMargin - (rightMargin - leftMargin) * p.progress;
        curY = 68; // NAK 跑道高度
        if (p.isDropping) {
          el.innerHTML = `<span>💥 NAK [${p.seq}] 丢失!</span>`;
        } else {
          el.innerHTML = `<span>✖ NAK [${p.seq}]</span>`;
        }
      } else {
        curX = rightMargin - (rightMargin - leftMargin) * p.progress;
        curY = 68; // ACK 帧高度
        if (p.isDropping) {
          el.innerHTML = `<span>💥 ACK [${p.seq}] 丢失!</span>`;
        } else {
          el.innerHTML = `<span>◀ ACK [${p.seq}]</span>`;
        }
      }

      el.style.left = `${curX}px`;
      el.style.top = `${curY}px`;

      // 交互：点击丢包
      el.title = '点击可在信道中人为丢弃该报文';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        p.dropped = true;
        p.dropAtProgress = p.progress;
        this.addLog(`用户交互：手动丢弃了飞行中的 ${p.type} [${p.seq}]！`, 'warn');
      });

      lane.appendChild(el);
    });
  }

  // 时空梯形图绘制
  drawSpaceTimeDiagram() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvasWidth;
    const h = this.canvasHeight;

    ctx.clearRect(0, 0, w, h);

    const xSender = 110;
    const xReceiver = w - 110;

    // 双时间轴
    ctx.strokeStyle = '#E5E4DC';
    ctx.lineWidth = 2;

    // 发送方时间轴
    ctx.beginPath();
    ctx.moveTo(xSender, 30);
    ctx.lineTo(xSender, h - 20);
    ctx.stroke();

    // 接收方时间轴
    ctx.beginPath();
    ctx.moveTo(xReceiver, 30);
    ctx.lineTo(xReceiver, h - 20);
    ctx.stroke();

    // 轴标题
    ctx.fillStyle = '#1C1917';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('发送方 (Sender, Wt=4)', xSender, 20);
    ctx.fillText('接收方 (Receiver, Wr=4)', xReceiver, 20);

    // 绘制传输斜线 (显示最近 10 条事件)
    const recentLines = this.spaceTimeLines.slice(-10);
    const lineSpacing = 28;
    const startY = 45;

    recentLines.forEach((line, idx) => {
      const y1 = startY + idx * lineSpacing;
      const y2 = y1 + lineSpacing * 0.85;

      if (line.type === 'DATA') {
        let strokeColor = line.dropped ? '#DC2626' : (line.isRetransmit ? '#EA580C' : '#2563EB');
        if (line.isCorrupted) strokeColor = '#D97706';
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = line.isRetransmit || line.isCorrupted ? 2.2 : 1.8;

        ctx.beginPath();
        ctx.moveTo(xSender, y1);
        if (line.dropped) {
          const midX = xSender + (xReceiver - xSender) * 0.5;
          const midY = y1 + (y2 - y1) * 0.5;
          ctx.lineTo(midX, midY);
          ctx.stroke();

          // 丢包红叉
          ctx.fillStyle = '#DC2626';
          ctx.font = 'bold 11px sans-serif';
          ctx.fillText('✕ (丢失)', midX + 24, midY + 4);
        } else {
          ctx.lineTo(xReceiver, y2);
          ctx.stroke();
          this.drawArrowhead(ctx, xSender, y1, xReceiver, y2, strokeColor);
          if (line.isCorrupted) {
            ctx.fillStyle = '#D97706';
            ctx.font = 'bold 10px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText('⚠️[CRC错]', xReceiver + 6, y2 + 4);
          }
        }

        // 标签
        ctx.fillStyle = line.isCorrupted ? '#D97706' : (line.isRetransmit ? '#EA580C' : '#1D4ED8');
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        let label = `Frame ${line.seq}`;
        if (line.isCorrupted) label = `⚠️Frame ${line.seq}[出错]`;
        else if (line.isRetransmit) label = `⚡Frame ${line.seq}[重传]`;
        ctx.fillText(label, xSender - 8, y1 + 4);

      } else if (line.type === 'NAK') {
        ctx.strokeStyle = '#E11D48';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([5, 3]);

        ctx.beginPath();
        ctx.moveTo(xReceiver, y1);
        if (line.dropped) {
          const midX = xReceiver - (xReceiver - xSender) * 0.5;
          const midY = y1 + (y2 - y1) * 0.5;
          ctx.lineTo(midX, midY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#DC2626';
          ctx.font = 'bold 11px sans-serif';
          ctx.fillText('✕ (丢失)', midX - 24, midY + 4);
        } else {
          ctx.lineTo(xSender, y2);
          ctx.stroke();
          ctx.setLineDash([]);
          this.drawArrowhead(ctx, xReceiver, y1, xSender, y2, '#E11D48');
        }

        ctx.fillStyle = '#E11D48';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`✖ NAK ${line.seq}`, xReceiver + 8, y1 + 4);

      } else if (line.type === 'ACK') {
        ctx.strokeStyle = line.dropped ? '#DC2626' : '#059669';
        ctx.lineWidth = 1.8;

        ctx.beginPath();
        ctx.moveTo(xReceiver, y1);
        if (line.dropped) {
          const midX = xReceiver - (xReceiver - xSender) * 0.5;
          const midY = y1 + (y2 - y1) * 0.5;
          ctx.lineTo(midX, midY);
          ctx.stroke();

          ctx.fillStyle = '#DC2626';
          ctx.font = 'bold 11px sans-serif';
          ctx.fillText('✕ (丢失)', midX - 24, midY + 4);
        } else {
          ctx.lineTo(xSender, y2);
          ctx.stroke();
          this.drawArrowhead(ctx, xReceiver, y1, xSender, y2, '#059669');
        }

        ctx.fillStyle = '#059669';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`ACK ${line.seq}`, xReceiver + 8, y1 + 4);
      }
    });
  }

  drawArrowhead(ctx, fromX, fromY, toX, toY, color) {
    const headlen = 7;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    ctx.fill();
  }

  setExplanation(text) {
    if (this.dom.explanationBox) {
      this.dom.explanationBox.innerText = text;
    }
  }

  addLog(msg, type = 'info') {
    const timeStr = (this.virtualTime / 1000).toFixed(2);
    const item = { time: timeStr, msg, type };
    this.logs.unshift(item);
    if (this.logs.length > 50) this.logs.pop();

    if (this.dom.logContainer) {
      const el = document.createElement('div');
      el.className = 'py-1 border-b border-stone-100 flex items-start gap-2';

      let badgeColor = 'bg-stone-100 text-stone-600';
      if (type === 'warn') badgeColor = 'bg-amber-50 text-amber-700 border border-amber-200';
      if (type === 'success') badgeColor = 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      if (type === 'error') badgeColor = 'bg-red-50 text-red-700 border border-red-200';

      el.innerHTML = `
        <span class="text-[10px] font-mono px-1 py-0.5 rounded ${badgeColor} flex-shrink-0">${timeStr}s</span>
        <span class="text-[11px] text-stone-800 leading-snug break-all">${msg}</span>
      `;
      this.dom.logContainer.prepend(el);
    }
  }
}

// 实例化并接入 requestAnimationFrame
let simulatorInstance = null;
let lastTimestamp = 0;

function animationTick(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const delta = Math.min(timestamp - lastTimestamp, 100);
  lastTimestamp = timestamp;

  if (simulatorInstance) {
    simulatorInstance.update(delta);
    simulatorInstance.render();
  }
  requestAnimationFrame(animationTick);
}

window.addEventListener('DOMContentLoaded', () => {
  simulatorInstance = new SRSimulator();
  requestAnimationFrame(animationTick);

  // 渲染 KaTeX 公式
  if (window.renderMathInElement) {
    renderMathInElement(document.body, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
      ]
    });
  }
});
