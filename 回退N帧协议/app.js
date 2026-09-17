/**
 * 回退N帧 (GBN) 滑动窗口协议核心交互引擎
 * 遵循 408 计算机网络标准与 Taste-Skill Light Editorial 浅色纸质美学
 */

class GBNSimulator {
  constructor() {
    // 协议基础参数
    this.TOTAL_FRAMES = 8; // 精简为 8 个帧（恰好容纳两个完整窗口 0~3 与 4~7），去除末尾无用冗余帧
    this.WINDOW_SIZE = 4; // Wt = 4
    this.TIMEOUT_DURATION = 7000; // ms (超时重传定时器适度加长，确保正常流水线与批次确认不发生虚假超时)
    this.TRANSIT_TIME = 2000; // ms (单向传播时延)

    // 状态机
    this.senderBase = 0;
    this.nextSeqNum = 0;
    this.expectedSeqNum = 0;

    // 单一定时器对象
    this.timer = {
      running: false,
      startTime: 0,
      duration: this.TIMEOUT_DURATION,
      elapsed: 0,
      trackedSeq: null
    };

    // 信道中的飞行报文列表
    this.inflightPackets = [];
    this.packetIdCounter = 1;

    // 时空图数据记录
    this.spaceTimeLines = []; // { id, type, seq, tStart, tEnd, fromX, toX, yStart, yEnd, dropped, dropProgress, note }
    this.virtualTime = 0; // 模拟时间戳 ms

    // 控制器参数
    this.isPlaying = false;
    this.playSpeed = 1.0;
    this.currentScenario = 'normal'; // normal, data_loss, ack_loss, duplicate, sandbox
    this.scenarioStepIndex = 0;
    this.scenarioTimer = 0;

    // 日志与解析
    this.logs = [];
    this.currentExplanation = '就绪。请选择场景并点击“播放”或“单步执行”开始演示。';

    // 自由模式配置
    this.dropNextData = false;
    this.dropNextAck = false;

    // 场景会话编号 (递增后，上一场景遗留的 setTimeout 回调自动失效)
    this.sessionId = 0;

    // 显眼动画状态标记
    this.senderLostFrameSeq = null;
    this.senderRetransmitActive = false;
    this.receiverDuplicateFrameSeq = null;

    // DOM 元素引用缓存
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

      receiverCellsContainer: document.getElementById('receiver-cells'),
      receiverBracket: document.getElementById('receiver-bracket'),
      receiverPointer: document.getElementById('receiver-pointer'),
      receiverAlertBanner: document.getElementById('receiver-alert-banner'),
      receiverStripWrapper: document.getElementById('receiver-strip-wrapper'),

      channelLane: document.getElementById('flight-channel'),
      spacetimeCanvas: document.getElementById('spacetime-canvas'),

      timerRing: document.getElementById('timer-ring-progress'),
      timerText: document.getElementById('timer-display-text'),
      timerSub: document.getElementById('timer-sub-text'),

      statBase: document.getElementById('stat-base'),
      statNext: document.getElementById('stat-next'),
      statExpected: document.getElementById('stat-expected'),
      statInflight: document.getElementById('stat-inflight'),

      explanationBox: document.getElementById('explanation-text'),
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
      tabDataLoss: document.getElementById('tab-data-loss'),
      tabAckLoss: document.getElementById('tab-ack-loss'),
      tabDuplicate: document.getElementById('tab-duplicate'),
      tabSandbox: document.getElementById('tab-sandbox')
    };

    if (this.dom.spacetimeCanvas) {
      this.ctx = this.dom.spacetimeCanvas.getContext('2d');
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

  showReceiverAlert(msg, type = 'info', shake = false) {
    const banner = this.dom.receiverAlertBanner;
    if (!banner) return;
    banner.className = 'mb-3 text-xs font-mono font-bold px-3 py-1.5 rounded-lg border flex items-center justify-between transition-all';
    if (type === 'error') {
      banner.classList.add('bg-red-50', 'text-red-700', 'border-red-300', 'animate-pulse');
    } else if (type === 'warn') {
      banner.classList.add('bg-amber-50', 'text-amber-800', 'border-amber-300');
    } else if (type === 'success') {
      banner.classList.add('bg-emerald-50', 'text-emerald-700', 'border-emerald-300');
    } else if (type === 'purple') {
      banner.classList.add('bg-purple-50', 'text-purple-800', 'border-purple-300', 'shadow-sm');
    } else {
      banner.classList.add('bg-blue-50', 'text-blue-700', 'border-blue-200');
    }
    banner.innerHTML = `<span>${msg}</span><button onclick="this.parentElement.classList.add('hidden')" class="text-xs opacity-60 hover:opacity-100 ml-2">✕</button>`;
    banner.classList.remove('hidden');

    if (shake && this.dom.receiverStripWrapper) {
      this.dom.receiverStripWrapper.classList.remove('discard-shake');
      void this.dom.receiverStripWrapper.offsetWidth; // 触发回流重播震颤
      this.dom.receiverStripWrapper.classList.add('discard-shake');
    }
  }

  hideReceiverAlert() {
    if (this.dom.receiverAlertBanner) this.dom.receiverAlertBanner.classList.add('hidden');
  }

  bindEvents() {
    // 播放/暂停
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

    // 自由模式：手动发帧
    this.dom.btnSendOne.addEventListener('click', () => {
      this.manualSendFrame();
    });

    // 自由模式：丢弃下一帧/ACK 开关
    this.dom.btnDropData.addEventListener('click', () => {
      this.dropNextData = !this.dropNextData;
      this.updateDropBtnStyles();
    });
    this.dom.btnDropAck.addEventListener('click', () => {
      this.dropNextAck = !this.dropNextAck;
      this.updateDropBtnStyles();
    });

    // 场景切换
    const tabs = [
      { el: this.dom.tabNormal, key: 'normal' },
      { el: this.dom.tabDataLoss, key: 'data_loss' },
      { el: this.dom.tabAckLoss, key: 'ack_loss' },
      { el: this.dom.tabDuplicate, key: 'duplicate' },
      { el: this.dom.tabSandbox, key: 'sandbox' }
    ];

    tabs.forEach(({ el, key }) => {
      el.addEventListener('click', () => {
        tabs.forEach(t => t.el.classList.remove('active'));
        el.classList.add('active');
        this.currentScenario = key;
        this.resetSimulation();
      });
    });

    // 响应时空画布尺寸变化
    window.addEventListener('resize', () => {
      this.resizeCanvas();
    });
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
      this.dom.btnDropAck.innerText = '● 下一ACK帧将丢失';
    } else {
      this.dom.btnDropAck.classList.remove('bg-red-50', 'border-red-400', 'text-red-700');
      this.dom.btnDropAck.innerText = '模拟丢弃下一ACK';
    }
  }

  resetSimulation() {
    this.senderBase = 0;
    this.nextSeqNum = 0;
    this.expectedSeqNum = 0;
    this.virtualTime = 0;
    this.inflightPackets = [];
    this.spaceTimeLines = [];
    this.logs = [];
    this.scenarioStepIndex = 0;
    this.scenarioTimer = 0;

    this.timer = {
      running: false,
      startTime: 0,
      duration: this.TIMEOUT_DURATION,
      elapsed: 0,
      trackedSeq: null
    };

    this.dropNextData = false;
    this.dropNextAck = false;
    this.updateDropBtnStyles();

    // 场景会话编号递增：让上一场景遗留的 setTimeout 回调自动失效
    this.sessionId++;

    // 事件驱动场景标记 (ACK 丢失 / 重复帧场景按真实协议事件推进)
    this.scenarioFlags = {
      ackLossNoticeShown: false,
      duplicatePrepared: false,
      duplicateInjected: false,
      duplicateDiscarded: false,
      duplicateWaitNoticeShown: false,
      compensationAckReceived: false
    };
    this.ackLossDroppedSeqs = new Set();

    // 重置显眼动画与告警状态
    this.senderLostFrameSeq = null;
    this.senderRetransmitActive = false;
    this.receiverDuplicateFrameSeq = null;
    this.hideSenderAlert();
    this.hideReceiverAlert();
    if (this.dom.receiverStripWrapper) {
      this.dom.receiverStripWrapper.classList.remove('discard-shake');
    }

    // 场景说明初始化
    const scenarioDesc = {
      normal: '【场景一：未丢失帧与按序流水线】发送方发送首帧 0，随后在窗口内连续并发发送帧 1、2、3；接收方按序接收并回复 ACK，滑动窗口持续顺畅前移，流水线平稳高效运转。',
      data_loss: '【场景二：发送帧丢失与回退N帧】发送方连续发帧，帧 1 途中标红爆炸丢失；接收方收到失序帧 2、3 时震颤丢弃；发送方显示丢包告警并在超时后激活显眼回退重传！',
      ack_loss: '【场景三：确认帧丢失与累积吸收】发送方发送帧 0~2；接收方顺利按序接收并回复 ACK 0~2；途中 ACK 0 与 ACK 1 意外丢失，但后序的 ACK 2 到达后，依靠累积确认机制直接确认前序所有帧，无需重传！',
      duplicate: '【场景四：收到重复帧与补偿回复】因网络延迟或提早重发，接收方已接收并期望帧 2，此时迟到的帧 1 到达；接收方检测为重复帧直接丢弃，但必须重新回复 ACK 1 提醒发送方，避免僵局。',
      sandbox: '【自由演练沙盒】您可自由点击“发送单个帧”、点击飞行报文进行丢包注入、或点击下方丢包开关，观察各种复杂情况下的协议滑动与时空梯形图演化。'
    };

    this.setExplanation(scenarioDesc[this.currentScenario]);
    this.addLog('系统已重置，当前模式：' + this.currentScenario, 'info');

    this.initCellsDOM();
    this.resizeCanvas();
    this.render();
  }

  initCellsDOM() {
    // 渲染发送方格子
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

    // 渲染接收方格子
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
  // GBN 协议核心逻辑
  // =========================================================================

  // 发送方发送数据帧 (Data Frame)
  sendDataFrame(seq, forceDrop = false, isRetransmit = false) {
    // 检查窗口是否已满 (nextSeqNum < base + N)
    if (this.nextSeqNum >= this.senderBase + this.WINDOW_SIZE && !forceDrop && !isRetransmit && arguments.length === 1) {
      this.setExplanation(`【窗口已满】当前 base = ${this.senderBase}, nextseqnum = ${this.nextSeqNum}, 窗口大小 N = ${this.WINDOW_SIZE}。发送窗口已达上限，必须等待旧帧的 ACK 到达才能继续发送！`);
      this.addLog(`发送阻塞：窗口已满 [${this.senderBase}, ${this.senderBase + this.WINDOW_SIZE - 1}]，无法发送帧 ${seq}`, 'warn');
      return false;
    }

    // 启动定时器：如果这是当前窗口内最早未确认的帧 (base == seq 且定时器未运行)
    if (!this.timer.running) {
      this.startTimer(seq);
    }

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
      startX: 80,
      endX: 420,
      startY: 40,
      endY: 40,
      creationVirtualTime: this.virtualTime
    };

    this.inflightPackets.push(packet);

    // 时空梯形图记录
    this.spaceTimeLines.push({
      id: packet.id,
      type: 'DATA',
      seq: seq,
      startTime: this.virtualTime,
      endTime: this.virtualTime + this.TRANSIT_TIME,
      fromX: 100,
      toX: 380,
      dropped: forceDrop,
      dropProgress: forceDrop ? 0.5 : 1.0,
      state: 'inflight',
      isRetransmit: isRetransmit
    });

    const prefix = isRetransmit ? '⚡ 发送方回退重传' : '发送方';
    this.addLog(`${prefix}：发出数据帧 Frame [${seq}] ${forceDrop ? '(预设在信道中丢失)' : ''}`, isRetransmit ? 'warn' : 'info');
    return true;
  }

  // 接收方回复确认帧 (ACK Frame)
  sendAckFrame(ackSeq, forceDrop = false, isCumulativeBatch = false, isCompensation = false) {
    const packet = {
      id: this.packetIdCounter++,
      type: 'ACK',
      seq: ackSeq,
      progress: 0,
      duration: this.TRANSIT_TIME,
      dropped: forceDrop,
      dropAtProgress: forceDrop ? 0.5 : null,
      dropStartTime: null,
      isDropping: false,
      isCumulativeBatch: isCumulativeBatch,
      isCompensation: isCompensation,
      startX: 420,
      endX: 80,
      startY: 75,
      endY: 75,
      creationVirtualTime: this.virtualTime
    };

    this.inflightPackets.push(packet);

    this.spaceTimeLines.push({
      id: packet.id,
      type: 'ACK',
      seq: ackSeq,
      startTime: this.virtualTime,
      endTime: this.virtualTime + this.TRANSIT_TIME,
      fromX: 380,
      toX: 100,
      dropped: forceDrop,
      dropProgress: forceDrop ? 0.5 : 1.0,
      state: 'inflight',
      isCumulativeBatch: isCumulativeBatch,
      isCompensation: isCompensation
    });

    const logDesc = isCompensation
      ? `接收方：收到重复帧丢弃，重新重传补偿确认 ACK [${ackSeq}]！`
      : (isCumulativeBatch
        ? `接收方：聚合回复单张累积确认 ACK [${ackSeq}] (一次性全权确认 ≤ ${ackSeq} 所有帧)`
        : `接收方：回复累积确认 ACK [${ackSeq}] ${forceDrop ? '(预设在信道中丢失)' : ''}`);
    this.addLog(logDesc, isCompensation ? 'warn' : (isCumulativeBatch ? 'success' : 'info'));
  }

  // 接收方收到数据帧的判定逻辑
  onReceiveDataFrame(packet) {
    const seq = packet.seq;
    this.addLog(`接收方：收到数据帧 Frame [${seq}]，当前期望 expected = ${this.expectedSeqNum}`, 'info');

    if (seq === this.expectedSeqNum) {
      // 1. 按序到达：接收、交付上层、窗口前移 1 格
      this.expectedSeqNum++;


      // 常规按序接收处理
      this.setExplanation(`【按序接收成功】接收方收到期望的帧 ${seq}。执行 GBN 协议规则：\n1. 接收数据并交付上层应用程序；\n2. 接收窗口移动到 ${this.expectedSeqNum}；\n3. 发送累积确认 ACK ${seq}（代表已成功接收序号 ≤ ${seq} 的所有帧）。`);
      this.showReceiverAlert(`✅ 接收方按序接收 Frame [${seq}] 成功，窗口前移至 ${this.expectedSeqNum}，回复 ACK [${seq}]`, 'success');
      this.addLog(`接收方：按序接收 Frame [${seq}] 成功，接收窗口前移至 ${this.expectedSeqNum}，回复 ACK [${seq}]`, 'success');

      // 检查是否有自由丢包预设或确认帧丢失场景预设 (ACK 0 与 ACK 1 标红并消失，且每个序号只丢一次)
      let drop = false;
      if (this.currentScenario === 'ack_loss' && (seq === 0 || seq === 1) && !this.ackLossDroppedSeqs.has(seq)) {
        drop = true;
        this.ackLossDroppedSeqs.add(seq);
      } else if (this.dropNextAck) {
        drop = true;
        this.dropNextAck = false;
        this.updateDropBtnStyles();
      }
      this.sendAckFrame(seq, drop);

    } else if (seq < this.expectedSeqNum) {
      // 2. 收到重复帧 (Duplicate Frame)：标紫丢弃并重传补偿 ACK
      this.receiverDuplicateFrameSeq = seq;
      if (this.currentScenario === 'duplicate') {
        this.scenarioFlags.duplicateDiscarded = true;
      }
      this.setExplanation(`【收到重复帧，标紫丢弃并重传ACK】接收方收到帧 ${seq}，但当前期望是 ${this.expectedSeqNum}（该帧早已接收过）。\n处理方式：坚决【标紫丢弃】重复帧，但【必须重新发送当前最高已接收帧的确认】ACK ${this.expectedSeqNum - 1}，以防发送方因缺少 ACK 陷入无限超时重传！`);
      this.showReceiverAlert(`🟣 接收方检测到重复帧 [${seq}]！当场标紫丢弃，并重传补偿确认 ACK [${this.expectedSeqNum - 1}]`, 'purple', true);
      this.addLog(`接收方：检测到重复帧 Frame [${seq}]，标紫丢弃该帧，并重传补偿 ACK [${this.expectedSeqNum - 1}]`, 'warn');

      this.sendAckFrame(this.expectedSeqNum - 1, false, false, true);

    } else {
      // 3. 失序到达 (Out-of-order Frame): seq > expectedSeqNum
      this.setExplanation(`【失序丢弃】接收方期待帧 ${this.expectedSeqNum}，收到失序帧 ${seq}。\n处理方式：丢弃帧 ${seq}（接收窗口 Wr = 1 不做缓存），并重新回复上一次成功接收帧的累积确认 ACK ${this.expectedSeqNum - 1}。`);
      this.showReceiverAlert(`🚫 接收方丢弃警告：收到失序帧 [${seq}]（期望 [${this.expectedSeqNum}]）！Wr=1 无缓存能力，果断丢弃！重复发送旧确认 ACK [${this.expectedSeqNum - 1 >= 0 ? this.expectedSeqNum - 1 : 0}]`, 'error', true);
      this.addLog(`接收方：帧 [${seq}] 失序！接收窗口无缓存能力，丢弃该帧！重复发送旧确认 ACK ${this.expectedSeqNum - 1 >= 0 ? this.expectedSeqNum - 1 : 0}`, 'warn');

      if (this.expectedSeqNum > 0) {
        this.sendAckFrame(this.expectedSeqNum - 1, false);
      }
    }
  }

  // 发送方收到 ACK 的判定逻辑
  onReceiveAckFrame(packet) {
    const ackSeq = packet.seq;
    this.addLog(`发送方：收到确认帧 ACK [${ackSeq}]，当前 base = ${this.senderBase}`, 'info');

    // 累积确认机制：ACK n 确认序号 ≤ n 的所有帧
    if (ackSeq >= this.senderBase) {
      const oldBase = this.senderBase;
      this.senderBase = ackSeq + 1;

      // 清除丢失或重传状态
      if (this.senderLostFrameSeq !== null && ackSeq >= this.senderLostFrameSeq) {
        this.senderLostFrameSeq = null;
      }
      if (this.senderRetransmitActive) {
        this.senderRetransmitActive = false;
        this.showSenderAlert(`🎉 重传确认完成！base 前移至 ${this.senderBase}，所有丢失/待传帧均已确认！`, 'success');
      } else {
        this.showSenderAlert(`✅ 收到 ACK [${ackSeq}]，发送窗口平稳前移：base 从 ${oldBase} 滑至 ${this.senderBase}`, 'info');
      }

      this.setExplanation(`【累积确认生效】发送方收到 ACK ${ackSeq}。\n因为 GBN 采用累积确认机制（Cumulative ACK），ACK ${ackSeq} 表示序号 ≤ ${ackSeq} 的所有帧均已成功送达！\n发送窗口 base 直接从 ${oldBase} 滑向 ${this.senderBase}，释放已确认帧的缓冲区！`);
      this.addLog(`发送方：累积确认成功！滑动发送窗口：base [${oldBase} → ${this.senderBase}]`, 'success');

      // 定时器管理规则：
      // 如果窗口内所有帧都已被确认 (base == nextSeqNum)，停止定时器！
      // 如果窗口内还有已发未确认的帧 (base < nextSeqNum)，重启定时器追踪新的 base 帧；
      if (this.senderBase === this.nextSeqNum) {
        this.stopTimer();
        this.addLog(`发送方：窗口内已无未确认帧，单一定时器停止运行。`, 'info');

        if (this.currentScenario === 'normal' && this.senderBase >= this.TOTAL_FRAMES) {
          this.setExplanation(`【全流程演示圆满完成】所有 8 个数据帧 [0 ~ 7] 均已全部按序发送并成功通过累积确认！\n发送窗口成功推移完毕，无丢包与多余重传，GBN 滑动窗口高效流水线演示圆满结束。`);
          this.showSenderAlert(`🎉 恭喜！全部 8 个帧按序收发并累积确认完毕，演示圆满完成！`, 'success');
          this.isPlaying = false;
          this.updatePlayBtn();
        }
      } else {
        this.startTimer(this.senderBase);
        this.addLog(`发送方：窗口内仍有未确认帧，单一定时器重启，追踪最早未确认帧 [${this.senderBase}]`, 'info');
      }

    } else {
      // 收到小于 base 的 ACK，属于重复 ACK 或迟到 ACK，直接忽略
      if (packet.isCompensation && this.currentScenario === 'duplicate') {
        this.scenarioFlags.compensationAckReceived = true;
      }
      this.setExplanation(`【忽略冗余/迟到 ACK】发送方收到 ACK ${ackSeq}，但当前 base 已前进至 ${this.senderBase}（序号 ${ackSeq} 早已确认）。\n发送方不作任何窗口调整。`);
      this.addLog(`发送方：收到旧确认 ACK [${ackSeq}] < base [${this.senderBase}]，忽略此 ACK。`, 'info');
    }
  }

  // 单一定时器超时事件 (Timeout Event)
  onTimeout() {
    // 防止重复触发重传风暴 (适当即可，避免过多重传)
    if (this.senderRetransmitActive) {
      return;
    }
    this.senderLostFrameSeq = null; // 进入重传，清除丢包红灯，转入重传动画
    this.senderRetransmitActive = true; // 激活重传单元格扫光

    this.showSenderAlert(`🔄【超时警报】帧 [${this.senderBase}] 定时器超时！触发 GBN 全量回退重传窗口内全部未确认帧 [${this.senderBase} ~ ${this.nextSeqNum - 1}]！`, 'warn');

    this.setExplanation(`【定时器超时！触发回退N帧 (Go-Back-N)】\n发送方针对最早未确认帧 ${this.senderBase} 的定时器超时！\nGBN 策略：发送方【全量回退】重传当前发送窗口内自 base (${this.senderBase}) 起到 nextseqnum - 1 (${this.nextSeqNum - 1}) 的所有帧（即使部分后续帧可能已被接收方丢弃或暂未到达）！`);
    this.addLog(`【超时警报】帧 [${this.senderBase}] 定时器超时！触发 GBN 回退重传帧 [${this.senderBase} ~ ${this.nextSeqNum - 1}]`, 'error');

    // 重启定时器
    this.startTimer(this.senderBase);

    // 记录时空图超时线
    this.spaceTimeLines.push({
      id: this.packetIdCounter++,
      type: 'TIMEOUT',
      seq: this.senderBase,
      startTime: this.virtualTime,
      endTime: this.virtualTime + 200,
      fromX: 100,
      toX: 100,
      state: 'timeout'
    });

    // 回退重传当前窗口内所有未确认帧 (携带 isRetransmit = true)
    const retransmitCount = this.nextSeqNum - this.senderBase;
    const session = this.sessionId;
    for (let i = 0; i < retransmitCount; i++) {
      const reSeq = this.senderBase + i;
      // 微量错开重新注入信道
      setTimeout(() => {
        if (this.sessionId !== session) return; // 场景已重置，丢弃过期回调
        this.sendDataFrame(reSeq, false, true);
      }, i * 260 / this.playSpeed);
    }
  }

  // 定时器控制
  startTimer(seq) {
    this.timer.running = true;
    this.timer.startTime = this.virtualTime;
    this.timer.elapsed = 0;
    this.timer.trackedSeq = seq;
  }

  stopTimer() {
    this.timer.running = false;
    this.timer.elapsed = 0;
    this.timer.trackedSeq = null;
  }

  // 手动发帧 (自由模式或单步模式)
  manualSendFrame() {
    if (this.nextSeqNum >= this.TOTAL_FRAMES) {
      this.setExplanation(`【已达最大可用序号】当前总帧数为 ${this.TOTAL_FRAMES} 帧 [0 ~ ${this.TOTAL_FRAMES - 1}]，所有帧均已发出！`);
      this.addLog(`发送失败：已达最大可用序号 [${this.TOTAL_FRAMES - 1}]`, 'warn');
      return;
    }
    if (this.nextSeqNum >= this.senderBase + this.WINDOW_SIZE) {
      this.setExplanation(`【窗口已满】发送窗口 [${this.senderBase} ~ ${this.senderBase + this.WINDOW_SIZE - 1}] 当前已全部占用。必须收到 ACK 使 base 前移后方可发送新帧。`);
      this.addLog(`发送失败：窗口已满 (Wt = ${this.WINDOW_SIZE})`, 'warn');
      return;
    }
    const drop = this.dropNextData;
    this.dropNextData = false;
    this.updateDropBtnStyles();

    const seq = this.nextSeqNum++;
    this.sendDataFrame(seq, drop);
  }

  // =========================================================================
  // 自动化场景编排脚本驱动
  // =========================================================================

  stepForward() {
    // 针对不同场景执行分步推演
    switch (this.currentScenario) {
      case 'normal':
        this.stepNormalScenario();
        break;
      case 'data_loss':
        this.stepDataLossScenario();
        break;
      case 'ack_loss':
        this.stepAckLossScenario();
        break;
      case 'duplicate':
        this.stepDuplicateScenario();
        break;
      case 'sandbox':
        this.manualSendFrame();
        break;
    }
  }

  // 通用工具：若发送窗口内仍有余量且尚有未发送帧，按流水线继续发送一帧
  // 返回 true 表示成功发出，false 表示窗口已满或帧已发完
  pumpNextFrame() {
    if (this.nextSeqNum >= this.TOTAL_FRAMES) return false;
    if (this.nextSeqNum >= this.senderBase + this.WINDOW_SIZE) return false;
    const seq = this.nextSeqNum++;
    this.sendDataFrame(seq, false);
    return true;
  }

  // 通用工具：向信道注入一张“迟到的重复数据帧”，供重复帧场景演示
  injectDuplicateFrame(seq) {
    const packet = {
      id: this.packetIdCounter++,
      type: 'DATA',
      seq: seq,
      progress: 0,
      duration: this.TRANSIT_TIME,
      dropped: false,
      isDuplicate: true,
      dropAtProgress: null,
      dropStartTime: null,
      isDropping: false,
      isDuplicateDropping: false,
      isRetransmit: false,
      startX: 80,
      endX: 420,
      startY: 40,
      endY: 40,
      creationVirtualTime: this.virtualTime
    };

    this.inflightPackets.push(packet);
    this.spaceTimeLines.push({
      id: packet.id,
      type: 'DATA',
      seq: seq,
      startTime: this.virtualTime,
      endTime: this.virtualTime + this.TRANSIT_TIME,
      fromX: 100,
      toX: 380,
      dropped: false,
      dropProgress: 1.0,
      state: 'inflight',
      isDuplicate: true
    });

    this.addLog(`信道：注入迟到的重复帧 Frame [${seq}]，正在飞往接收方...`, 'warn');
  }

  stepNormalScenario() {
    const step = this.scenarioStepIndex;
    if (step === 0) {
      this.setExplanation('【步骤 1：流水线启动】发送方准备发送帧 0。启动单一定时器（追踪帧 0），首帧注入信道向接收方飞去。');
      this.showSenderAlert('🚀 发送方发出首帧 Frame [0]，单一定时器启动...', 'info');
      this.sendDataFrame(this.nextSeqNum++, false);
      this.scenarioStepIndex = 1;
    } else if (step === 1) {
      this.setExplanation('【步骤 2：连续发帧】流水线并发发帧：发送方继续发送帧 1、帧 2，充分利用信道带宽。');
      this.showSenderAlert('🚀 发送方流水线连续发送帧 [1, 2]...', 'info');
      this.sendDataFrame(this.nextSeqNum++, false);
      const normalSession = this.sessionId;
      setTimeout(() => {
        if (this.sessionId !== normalSession || this.currentScenario !== 'normal') return;
        if (this.nextSeqNum < this.TOTAL_FRAMES) {
          this.sendDataFrame(this.nextSeqNum++, false);
        }
      }, 200 / this.playSpeed);
      this.scenarioStepIndex = 2;
    } else if (step === 2) {
      this.setExplanation('【步骤 3：填满窗口】发送方发送帧 3，此时发送窗口 [0 ~ 3] 满额 (Wt = 4)，暂停发送等待 ACK。');
      this.showSenderAlert('🚀 发送方发出帧 [3]，发送窗口满额 (Wt = 4)，暂停等待 ACK...', 'info');
      this.sendDataFrame(this.nextSeqNum++, false);
      this.scenarioStepIndex = 3;
    } else {
      if (this.nextSeqNum < this.TOTAL_FRAMES) {
        if (this.nextSeqNum < this.senderBase + this.WINDOW_SIZE) {
          this.setExplanation(`【步骤 ${step + 1}：滑动窗口并发送后续帧】接收方按序收到并回复 ACK，发送窗口前移，允许发送后续帧 [${this.nextSeqNum}]！`);
          this.showSenderAlert(`🚀 发送窗口已前移，发送方发送新帧 [${this.nextSeqNum}]...`, 'info');
          this.sendDataFrame(this.nextSeqNum++, false);
          this.scenarioStepIndex++;
        } else {
          this.setExplanation(`【等待 ACK 滑动窗口】发送窗口已满 [${this.senderBase} ~ ${this.senderBase + this.WINDOW_SIZE - 1}]，等待接收方确认抵达以腾出窗口空间...`);
          this.showSenderAlert(`⏳ 发送窗口已满，等待接收方 ACK 抵达...`, 'info');
        }
      } else {
        if (this.senderBase >= this.TOTAL_FRAMES) {
          this.setExplanation('【正常流程演示完成】所有 8 个数据帧按序平稳收发，累积确认推动滑动窗口流水线顺利前移结束。');
          this.showSenderAlert('🎉 演示圆满完成：全部 8 个帧按序收发并累积确认！', 'success');
          this.isPlaying = false;
          this.updatePlayBtn();
        } else {
          this.setExplanation('【等待末尾确认】所有 8 个帧已发送完毕，正在等待回程信道中的最后确认帧抵达滑动窗口...');
        }
        this.scenarioStepIndex++;
      }
    }
  }

  stepDataLossScenario() {
    const step = this.scenarioStepIndex;
    if (step === 0) {
      this.setExplanation('【步骤 1：正常发送首帧】发送方发送首帧 0，信道畅通，顺利到达接收方并交付，接收方回复 ACK 0。');
      this.showSenderAlert('🚀 发送方发出首帧 Frame [0]，单一定时器启动...', 'info');
      this.sendDataFrame(this.nextSeqNum++, false);
      this.scenarioStepIndex = 1;
    } else if (step === 1) {
      this.setExplanation('【步骤 2：突发丢包与失序丢弃！】发送方连续发出帧 1、2、3。\n💥 帧 1 在信道半途突发损坏丢失，标红剧烈爆炸并消散！\n⚠️ 发送方窗口 strip 上帧 1 触发红色丢失警告呼吸光！\n🚫 随后帧 2、3 到达接收方，接收方检测到失序全部果断丢弃（伴随剧烈震颤动画），并持续回复旧确认 ACK 0！');
      this.showSenderAlert('📤 发送方连续发出帧 [1, 2, 3]，单一定时器正在追踪帧 [1]...', 'info');
      this.sendDataFrame(this.nextSeqNum++, true); // 帧 1 丢失
      const lossSession = this.sessionId;
      setTimeout(() => {
        if (this.sessionId !== lossSession || this.currentScenario !== 'data_loss') return;
        this.sendDataFrame(this.nextSeqNum++, false);
      }, 280 / this.playSpeed);
      setTimeout(() => {
        if (this.sessionId !== lossSession || this.currentScenario !== 'data_loss') return;
        this.sendDataFrame(this.nextSeqNum++, false);
      }, 560 / this.playSpeed);
      this.scenarioStepIndex = 2;
    } else if (step === 2) {
      this.setExplanation('【步骤 3：定时器超时！GBN 全量回退重传】发送方关于帧 1 的单一定时器超时！\n🔄 发送方激活全量回退重传，窗口内所有已发未确认帧 [1, 2, 3] 触发金色光环，打上【重传】标记重新注入信道！');
      this.onTimeout();
      this.scenarioStepIndex = 3;
    } else {
      // 步骤 4 及后续：重传确认后，滑动窗口推进，继续发送剩余的帧 4~7 直至全部用完
      if (this.nextSeqNum < this.TOTAL_FRAMES) {
        if (this.nextSeqNum < this.senderBase + this.WINDOW_SIZE) {
          this.setExplanation(`【步骤 ${step + 1}：重传成功，恢复流水线发送后续帧】丢包重传已被确认，发送窗口顺利滑移至 [${this.senderBase} ~ ${Math.min(this.TOTAL_FRAMES - 1, this.senderBase + this.WINDOW_SIZE - 1)}]！\n流水线恢复常态，发送方继续发送后续新帧 [${this.nextSeqNum}]！`);
          this.showSenderAlert(`🚀 重传成功，窗口前移！发送方继续发出后续新帧 [${this.nextSeqNum}]...`, 'info');
          this.sendDataFrame(this.nextSeqNum++, false);
          this.scenarioStepIndex++;
        } else {
          this.setExplanation(`【等待确认推进窗口】发送方正在等待重传帧确认抵达，以推进发送窗口发送剩余帧...`);
          this.showSenderAlert(`⏳ 正在等待 ACK 抵达以推进发送窗口...`, 'info');
        }
      } else {
        if (this.senderBase >= this.TOTAL_FRAMES) {
          this.setExplanation('【丢包重传场景圆满完成】所有 8 个数据帧全部发送、重传并顺利按序确认！滑动窗口成功推移完毕。');
          this.showSenderAlert('🎉 演示圆满完成：全部 8 个帧按序确认，无遗漏！', 'success');
          this.isPlaying = false;
          this.updatePlayBtn();
        } else {
          this.setExplanation('【等待末尾确认】所有 8 个数据帧均已发送完毕，正在等待回程信道中最后的确认帧抵达...');
        }
        this.scenarioStepIndex++;
      }
    }
  }

  stepAckLossScenario() {
    const flags = this.scenarioFlags;

    // ---- 阶段 1：并发发送前 3 帧（仅执行一次）----
    if (this.nextSeqNum === 0 && this.senderBase === 0) {
      this.setExplanation('【步骤 1：并发发送前 3 帧】发送方连续发出帧 0、帧 1、帧 2，流水线并发传输，单一定时器追踪最早未确认的帧 0。\n⚠️ 注意：接下来 ACK 0 与 ACK 1 将在回程信道中意外丢失，请盯紧信道！');
      this.showSenderAlert('🚀 发送方连续发出帧 [0, 1, 2]，单一定时器正在追踪帧 [0]...', 'info');
      const session = this.sessionId;
      this.sendDataFrame(this.nextSeqNum++, false);
      [1, 2].forEach(i => {
        setTimeout(() => {
          if (this.sessionId !== session || this.currentScenario !== 'ack_loss') return;
          if (this.nextSeqNum < 3) this.sendDataFrame(this.nextSeqNum++, false);
        }, i * 220 / this.playSpeed);
      });
      return;
    }

    // ---- 阶段 2：等待 ACK 2 的累积确认把 base 推进到 3 ----
    if (this.senderBase < 3) {
      this.setExplanation(`【步骤 2：确认帧半途丢失，等待累积确认救援】接收方早已按序收下帧 0、1、2，但 ACK 0 与 ACK 1 先后在回程信道【标红爆炸消失】；发送方 base 停留在 ${this.senderBase}，暂时无法推进窗口。\n只要 ACK 2 平安抵达，累积确认机制就能一次性确认序号 ≤ 2 的全部帧，实现零重传容错！`);
      if (!flags.ackLossNoticeShown) {
        flags.ackLossNoticeShown = true;
        this.showReceiverAlert('⚠️ 警告：ACK [0] 与 ACK [1] 在回程信道突发丢失，标红消散！发送方正在等待 ACK [2]...', 'warn');
      }
      return;
    }

    // ---- 阶段 3：累积确认已生效，继续发送剩余帧直至全部用完 ----
    if (this.nextSeqNum < this.TOTAL_FRAMES) {
      if (this.pumpNextFrame()) {
        this.setExplanation(`【步骤 3：累积确认吸收成功，恢复流水线】ACK 2 平安抵达，base 从 0 直接跃迁至 ${this.senderBase}——丢失的 ACK 0/1 被累积确认完全吸收，未触发任何超时重传！\n发送窗口前移，发送方继续发出后续新帧 [${this.nextSeqNum - 1}]，流水线恢复常态。`);
        this.showSenderAlert(`🚀 累积确认生效，发送方继续发出后续帧 [${this.nextSeqNum - 1}]...`, 'info');
      } else {
        this.setExplanation(`【步骤 3：等待 ACK 腾出窗口】发送窗口 [${this.senderBase} ~ ${this.senderBase + this.WINDOW_SIZE - 1}] 已满，先让回程 ACK 把 base 推向前方，随后继续发送剩余帧。`);
        this.showSenderAlert('⏳ 发送窗口已满，等待接收方 ACK 抵达...', 'info');
      }
      return;
    }

    // ---- 阶段 4：全部发完，等待末尾累积确认到达 ----
    if (this.senderBase < this.TOTAL_FRAMES) {
      this.setExplanation('【步骤 4：等待末尾确认】全部 8 个数据帧均已发送完毕，正在等待回程信道中最后的累积确认抵达，将发送窗口推到终点...');
      this.showSenderAlert('⏳ 等待最后的累积确认 ACK 抵达...', 'info');
      return;
    }

    // ---- 阶段 5：圆满完成 ----
    this.setExplanation('【确认帧丢失场景圆满完成】ACK 0 与 ACK 1 的丢失被 ACK 2 的累积确认能力完美吸收，全程零超时重传；随后帧 3~7 依次发送并确认，8 个数据帧全部用完！');
    this.showSenderAlert('🎉 演示圆满完成：累积确认吸收了丢失的 ACK，全部 8 个帧发送并确认完毕！', 'success');
    this.isPlaying = false;
    this.updatePlayBtn();
  }

  stepDuplicateScenario() {
    const flags = this.scenarioFlags;

    // ---- 阶段 1：前置状态准备（帧 0、1 已确认，expected = 2）----
    if (!flags.duplicatePrepared) {
      flags.duplicatePrepared = true;
      this.senderBase = 2;
      this.nextSeqNum = 2;
      this.expectedSeqNum = 2;
      this.setExplanation('【步骤 1：前置状态就绪】发送方与接收方均已完成帧 0 与帧 1 的正常收发；发送窗口 base = 2、nextseqnum = 2，接收方当前正期待帧 2 (expected = 2)。\n下一拍，信道上将出现一份“迟到的重复帧 1”，请留意观察！');
      this.showSenderAlert('📋 前置状态就绪：帧 0、1 已确认，接收方当前期待帧 [2]...', 'info');
      this.render();
      return;
    }

    // ---- 阶段 2：注入迟到的重复帧 1 ----
    if (!flags.duplicateInjected) {
      flags.duplicateInjected = true;
      this.injectDuplicateFrame(1);
      this.setExplanation('【步骤 2：迟到重复帧来袭】因早期网络传输延迟，一份早已被确认过的【重复帧 1】此时从信道飞向接收方！\n它虽然序号 1 < 接收方期望的 2，但接收方仍需认真对待：丢弃它的同时必须重传补偿确认 ACK 1，防止发送方误以为确认丢失而陷入超时重传。');
      this.showSenderAlert('📤 信道中出现一份迟到的重复帧 Frame [1]，向接收方飞去...', 'warn');
      return;
    }

    // ---- 阶段 3：等待接收方判别并标紫丢弃 ----
    if (!flags.duplicateDiscarded) {
      this.setExplanation('【步骤 3：接收方判别中……】重复帧 Frame [1] 正在信道中飞行。抵达接收方后，它将被立即判定为重复帧、【标紫丢弃】，随后接收方重传当前最高确认 ACK 1。');
      if (!flags.duplicateWaitNoticeShown) {
        flags.duplicateWaitNoticeShown = true;
        this.showReceiverAlert('⏳ 接收方正在等待帧 [2]，若收到序号 1 的重复帧将立即标紫丢弃并重传补偿 ACK...', 'info');
      }
      return;
    }

    // ---- 阶段 4：等待补偿 ACK 回到发送方并被安全忽略 ----
    if (!flags.compensationAckReceived) {
      this.setExplanation(`【步骤 4：补偿 ACK 回传】接收方已【标紫丢弃】重复帧 1，并重传补偿确认 ACK 1！\n由于发送方 base 已前进到 2，这张迟到的 ACK 1 属于“旧确认”，送达后将被安全忽略——既不推进窗口，也不会引起任何抖动，彻底消除了僵局隐患。`);
      this.showReceiverAlert('🟣 重复帧 [1] 已被标紫丢弃，重传补偿确认 ACK [1] 正在回传...', 'purple', true);
      return;
    }

    // ---- 阶段 5：重复帧事件解除，继续发送剩余帧直至全部用完 ----
    if (this.nextSeqNum < this.TOTAL_FRAMES) {
      if (this.pumpNextFrame()) {
        this.setExplanation(`【步骤 5：重复帧事件解除，恢复流水线】补偿 ACK 已被发送方安全忽略，协议状态稳定无虞。\n发送窗口继续工作，发送方发出后续新帧 [${this.nextSeqNum - 1}]，接收方按序接收后回复正常累积确认。`);
        this.showSenderAlert(`🚀 协议稳定，发送方继续发出后续帧 [${this.nextSeqNum - 1}]...`, 'info');
      } else {
        this.setExplanation(`【步骤 5：等待 ACK 腾出窗口】发送窗口 [${this.senderBase} ~ ${this.senderBase + this.WINDOW_SIZE - 1}] 已满，等待回程 ACK 推进 base 后继续发送剩余帧。`);
        this.showSenderAlert('⏳ 发送窗口已满，等待接收方 ACK 抵达...', 'info');
      }
      return;
    }

    // ---- 阶段 6：等待末尾确认 ----
    if (this.senderBase < this.TOTAL_FRAMES) {
      this.setExplanation('【步骤 6：等待末尾确认】全部 8 个数据帧均已发送完毕，正在等待回程信道中最后的累积确认抵达...');
      this.showSenderAlert('⏳ 等待最后的累积确认 ACK 抵达...', 'info');
      return;
    }

    // ---- 阶段 7：圆满完成 ----
    this.setExplanation('【收到重复帧场景圆满完成】重复帧 1 被标紫丢弃，接收方重传的补偿 ACK 1 被发送方安全忽略；协议未受任何影响，随后帧 2~7 全部顺畅发送并确认，8 个数据帧全部用完！');
    this.showSenderAlert('🎉 演示圆满完成：重复帧被妥善处置，协议稳定运行直至全部 8 帧确认完毕！', 'success');
    this.isPlaying = false;
    this.updatePlayBtn();
  }

  // =========================================================================
  // 60FPS 渲染循环与报文移动更新
  // =========================================================================

  update(deltaTime) {
    const adjustedDelta = deltaTime * this.playSpeed;
    this.virtualTime += adjustedDelta;

    // 1. 定时器计时演进
    if (this.timer.running) {
      this.timer.elapsed += adjustedDelta;
      if (this.timer.elapsed >= this.timer.duration) {
        this.onTimeout();
      }
    }

    // 2. 更新飞行中报文位置
    for (let i = this.inflightPackets.length - 1; i >= 0; i--) {
      const p = this.inflightPackets[i];

      // 如果正在播放丢包爆炸消失动画或重复帧标紫丢弃动画 (保留 900ms 供 CSS 动画播放)
      if (p.isDropping || p.isDuplicateDropping) {
        if (this.virtualTime - p.dropStartTime >= 900) {
          this.inflightPackets.splice(i, 1);
        }
        continue;
      }

      p.progress += adjustedDelta / p.duration;

      // 检查丢包触发
      if (p.dropped && p.dropAtProgress && p.progress >= p.dropAtProgress) {
        p.isDropping = true;
        p.dropStartTime = this.virtualTime;
        if (p.type === 'DATA') {
          this.senderLostFrameSeq = p.seq;
          this.showSenderAlert(`⚠️ 发送方警告：信道监测到帧 [${p.seq}] 发生突发丢包！发送方单一定时器继续倒计时，等待超时触发回退重传！`, 'error');
        } else {
          this.showReceiverAlert(`⚠️ 接收方警告：信道中确认帧 ACK [${p.seq}] 丢失！发送方将无法推进窗口！`, 'warn');
        }
        this.addLog(`信道：${p.type === 'DATA' ? '数据帧 Frame' : '确认帧 ACK'} [${p.seq}] 途中突发丢包，标红爆炸消散！`, 'error');
        continue;
      }

      // 报文到达对端
      if (p.progress >= 1.0) {
        if (p.type === 'DATA') {
          if (p.seq < this.expectedSeqNum) {
            // 收到重复帧：当场标紫丢弃，保留 900ms 供紫色丢弃动画播放
            p.isDuplicateDropping = true;
            p.dropStartTime = this.virtualTime;
            p.progress = 1.0;
            this.onReceiveDataFrame(p);
            continue;
          } else {
            this.inflightPackets.splice(i, 1);
            this.onReceiveDataFrame(p);
          }
        } else if (p.type === 'ACK') {
          this.inflightPackets.splice(i, 1);
          this.onReceiveAckFrame(p);
        }
      }
    }

    // 3. 自动播放脚本触发器 (仅在 isPlaying 为 true 时自动推进)
    if (this.isPlaying) {
      this.scenarioTimer += adjustedDelta;
      // normal / ack_loss / duplicate 采用紧凑节奏；data_loss 前几步与 sandbox 保留原有较长等待
      const fastPacing = this.currentScenario === 'normal' || this.currentScenario === 'ack_loss' || this.currentScenario === 'duplicate' || this.scenarioStepIndex >= 3;
      const stepDelay = fastPacing ? 2200 : 4500;
      if (this.scenarioTimer >= stepDelay) {
        this.scenarioTimer = 0;
        this.stepForward();
      }
    }
  }

  render() {
    this.renderSenderBuffer();
    this.renderReceiverBuffer();
    this.renderTimer();
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

      // 显眼状态判定：丢失帧告警 > 重传光环 > 常规 GBN 状态
      if (this.senderLostFrameSeq !== null && i === this.senderLostFrameSeq) {
        cell.classList.add('status-lost');
        tag.innerText = '丢失待传';
      } else if (this.senderRetransmitActive && i >= base && i < next) {
        cell.classList.add('status-retransmit');
        tag.innerText = '回退重传';
      } else if (i < base) {
        cell.classList.add('status-acked');
        tag.innerText = '已确认';
      } else if (i >= base && i < next) {
        cell.classList.add('status-unack');
        tag.innerText = '已发未认';
      } else if (i >= next && i < base + N) {
        cell.classList.add('status-usable');
        tag.innerText = '可用未发';
      } else {
        cell.classList.add('status-outside');
        tag.innerText = '暂不可用';
      }
    }

    // 更新滑动窗口范围框位置与尺寸
    const cellWidth = 44 + 8; // width + gap
    const leftPos = Math.min(base, this.TOTAL_FRAMES) * cellWidth;
    const remainingFrames = Math.max(0, this.TOTAL_FRAMES - base);
    const visibleCount = Math.min(N, remainingFrames);

    if (this.dom.senderBracket) {
      if (visibleCount <= 0) {
        this.dom.senderBracket.style.opacity = '0';
      } else {
        this.dom.senderBracket.style.opacity = '1';
        this.dom.senderBracket.style.transform = `translateX(${leftPos}px)`;
        this.dom.senderBracket.style.width = `${visibleCount * cellWidth - 8}px`;
      }
    }

    // 指针位置 (分两层显示，彻底解决重叠)
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
        ? `▲ nextseq = ${next} (全发完)`
        : `▲ nextseq = ${next}`;
    }
  }

  renderReceiverBuffer() {
    const expected = this.expectedSeqNum;

    for (let i = 0; i < this.TOTAL_FRAMES; i++) {
      const cell = document.getElementById(`receiver-cell-${i}`);
      const tag = document.getElementById(`r-tag-${i}`);
      if (!cell) continue;

      cell.className = 'seq-cell';

      if (this.receiverDuplicateFrameSeq !== null && i === this.receiverDuplicateFrameSeq) {
        cell.classList.add('status-duplicate-discard');
        tag.innerText = '标紫丢弃';
      } else if (i < expected) {
        cell.classList.add('status-acked');
        tag.innerText = '已上交';
      } else if (i === expected) {
        cell.classList.add('status-expected');
        tag.innerText = '期待接收';
      } else {
        cell.classList.add('status-outside');
        tag.innerText = '失序待收';
      }
    }

    // 接收方严格 Wr = 1 窗口框
    const cellWidth = 44 + 8;
    const expPos = Math.min(expected, this.TOTAL_FRAMES) * cellWidth;

    if (this.dom.receiverBracket) {
      if (expected >= this.TOTAL_FRAMES) {
        this.dom.receiverBracket.style.opacity = '0';
      } else {
        this.dom.receiverBracket.style.opacity = '1';
        this.dom.receiverBracket.style.transform = `translateX(${expPos}px)`;
        this.dom.receiverBracket.style.width = `${cellWidth - 8}px`;
      }
    }

    if (this.dom.receiverPointer) {
      this.dom.receiverPointer.style.transform = `translateX(${expPos + 6}px)`;
      this.dom.receiverPointer.innerHTML = expected >= this.TOTAL_FRAMES
        ? `▲ 全部按序收齐 (Wr=1)`
        : `▲ expected = ${expected} (Wr=1)`;
    }
  }

  renderTimer() {
    if (!this.timer.running) {
      this.dom.timerText.innerText = 'STOPPED';
      this.dom.timerText.className = 'text-xs font-mono font-bold text-stone-400';
      this.dom.timerSub.innerText = '无未确认帧，定时器休眠';
      if (this.dom.timerRing) {
        this.dom.timerRing.style.strokeDashoffset = '100';
      }
      return;
    }

    const remaining = Math.max(0, this.timer.duration - this.timer.elapsed);
    const pct = Math.min(1.0, this.timer.elapsed / this.timer.duration);
    const secs = (remaining / 1000).toFixed(1);

    this.dom.timerText.innerText = `${secs}s`;
    this.dom.timerText.className = 'text-sm font-mono font-bold text-amber-600';
    this.dom.timerSub.innerText = `追踪帧 [${this.timer.trackedSeq}] 倒计时`;

    if (this.dom.timerRing) {
      // 周长约为 100
      this.dom.timerRing.style.strokeDashoffset = `${pct * 100}`;
    }
  }

  renderStats() {
    this.dom.statBase.innerText = this.senderBase;
    this.dom.statNext.innerText = this.nextSeqNum;
    this.dom.statExpected.innerText = this.expectedSeqNum;
    this.dom.statInflight.innerText = this.inflightPackets.length;
  }

  renderInflightPacketsDOM() {
    const lane = this.dom.channelLane;
    if (!lane) return;

    // 清空现有 DOM 并重新挂载飞行元素
    lane.innerHTML = '';
    const rect = lane.getBoundingClientRect();
    const laneWidth = rect.width || 600;

    this.inflightPackets.forEach(p => {
      const el = document.createElement('div');
      el.className = `flying-packet ${p.type === 'DATA' ? 'type-data' : 'type-ack'}`;
      
      if (p.isDropping) {
        el.classList.add('is-dropping');
      }
      if (p.isDuplicateDropping) {
        el.classList.add('duplicate-discard');
      }
      if (p.isRetransmit) {
        el.classList.add('retransmit');
      }
      if (p.isDuplicate) {
        el.classList.add('is-duplicate');
      }
      if (p.isCompensation) {
        el.classList.add('is-compensation');
      }
      if (p.isCumulativeBatch) {
        el.classList.add('cumulative-batch');
      }

      // 从发送方(左 10%) 到 接收方(右 90%)
      const leftMargin = 40;
      const rightMargin = laneWidth - 40;
      let curX, curY;

      if (p.type === 'DATA') {
        curX = leftMargin + (rightMargin - leftMargin) * p.progress;
        curY = 32; // 数据帧通道高度
        if (p.isDuplicateDropping) {
          el.innerHTML = `<span>🟣 重复帧 [${p.seq}] 标紫丢弃!</span>`;
        } else if (p.isDropping) {
          el.innerHTML = `<span>💥 帧 [${p.seq}] 丢失!</span>`;
        } else if (p.isRetransmit) {
          el.innerHTML = `<span>⚡ [重传] Frame [${p.seq}]</span>`;
        } else if (p.isDuplicate) {
          el.innerHTML = `<span>🔁 迟到重复帧 Frame [${p.seq}]</span>`;
        } else {
          el.innerHTML = `<span>▶ Frame [${p.seq}]</span>`;
        }
      } else {
        curX = rightMargin - (rightMargin - leftMargin) * p.progress;
        curY = 72; // ACK 帧通道高度
        if (p.isDropping) {
          el.innerHTML = `<span>💥 ACK [${p.seq}] 丢失!</span>`;
        } else if (p.isCompensation) {
          el.innerHTML = `<span>⚡ [补偿] ACK [${p.seq}]</span>`;
        } else if (p.isCumulativeBatch) {
          el.innerHTML = `<span>◀ 累积确认 ACK [${p.seq}]</span>`;
        } else {
          el.innerHTML = `<span>◀ ACK [${p.seq}]</span>`;
        }
      }

      el.style.left = `${curX}px`;
      el.style.top = `${curY}px`;

      // 交互：点击任意飞行报文可手动注入丢包！
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

  drawSpaceTimeDiagram() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvasWidth;
    const h = this.canvasHeight;

    ctx.clearRect(0, 0, w, h);

    // 绘制发送方与接收方双时间轴
    const xSender = 110;
    const xReceiver = w - 110;

    ctx.strokeStyle = '#E5E4DC';
    ctx.lineWidth = 2;

    // 发送方纵轴
    ctx.beginPath();
    ctx.moveTo(xSender, 30);
    ctx.lineTo(xSender, h - 20);
    ctx.stroke();

    // 接收方纵轴
    ctx.beginPath();
    ctx.moveTo(xReceiver, 30);
    ctx.lineTo(xReceiver, h - 20);
    ctx.stroke();

    // 轴标题
    ctx.fillStyle = '#1C1917';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('发送方 (Sender)', xSender, 20);
    ctx.fillText('接收方 (Receiver)', xReceiver, 20);

    // 绘制所有斜线传输事件 (滚动时空图，保留最近 8 个事件)
    const recentLines = this.spaceTimeLines.slice(-10);
    const lineSpacing = 32;
    const startY = 50;

    recentLines.forEach((line, idx) => {
      const y1 = startY + idx * lineSpacing;
      const y2 = y1 + lineSpacing * 0.85;

      if (line.type === 'DATA') {
        ctx.strokeStyle = line.dropped ? '#DC2626' : (line.isRetransmit ? '#EA580C' : '#2563EB');
        ctx.lineWidth = line.isRetransmit ? 2.2 : 1.8;

        ctx.beginPath();
        ctx.moveTo(xSender, y1);
        if (line.dropped) {
          const midX = xSender + (xReceiver - xSender) * 0.5;
          const midY = y1 + (y2 - y1) * 0.5;
          ctx.lineTo(midX, midY);
          ctx.stroke();

          // 绘制丢包红叉 ✕
          ctx.fillStyle = '#DC2626';
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText('✕ (丢失)', midX + 22, midY + 4);
        } else {
          ctx.lineTo(xReceiver, y2);
          ctx.stroke();

          // 到达点箭头
          this.drawArrowhead(ctx, xSender, y1, xReceiver, y2, line.isRetransmit ? '#EA580C' : '#2563EB');
        }

        // 标签文字
        ctx.fillStyle = line.isRetransmit ? '#EA580C' : '#1D4ED8';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(line.isRetransmit ? `⚡Frame ${line.seq}[重传]` : `Frame ${line.seq}`, xSender - 8, y1 + 4);

      } else if (line.type === 'ACK') {
        ctx.strokeStyle = line.dropped ? '#DC2626' : '#059669';
        ctx.lineWidth = line.isCumulativeBatch ? 2.4 : 1.8;

        ctx.beginPath();
        ctx.moveTo(xReceiver, y1);
        if (line.dropped) {
          const midX = xReceiver - (xReceiver - xSender) * 0.5;
          const midY = y1 + (y2 - y1) * 0.5;
          ctx.lineTo(midX, midY);
          ctx.stroke();

          ctx.fillStyle = '#DC2626';
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText('✕ (丢失)', midX - 22, midY + 4);
        } else {
          ctx.lineTo(xSender, y2);
          ctx.stroke();

          this.drawArrowhead(ctx, xReceiver, y1, xSender, y2, '#059669');
        }

        ctx.fillStyle = '#047857';
        ctx.font = line.isCumulativeBatch ? 'bold 11px "JetBrains Mono", monospace' : '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(line.isCumulativeBatch ? `ACK ${line.seq} [累积]` : `ACK ${line.seq}`, xReceiver + 8, y1 + 4);

      } else if (line.type === 'TIMEOUT') {
        // 超时警示横虚线
        ctx.strokeStyle = '#D97706';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.moveTo(xSender - 15, y1);
        ctx.lineTo(xSender + 65, y1);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#D97706';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`⏰ 超时! 回退重传`, xSender + 10, y1 - 6);
      }
    });
  }

  drawArrowhead(ctx, fromX, fromY, toX, toY, color) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const headlen = 7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  setExplanation(text) {
    this.currentExplanation = text;
    if (this.dom.explanationBox) {
      this.dom.explanationBox.innerText = text;
    }
  }

  addLog(msg, type = 'info') {
    const timeStr = new Date().toTimeString().split(' ')[0];
    const logItem = { time: timeStr, text: msg, type: type };
    this.logs.unshift(logItem);
    if (this.logs.length > 25) this.logs.pop();

    if (this.dom.logContainer) {
      const colorMap = {
        info: 'text-stone-700',
        success: 'text-emerald-700 font-semibold',
        warn: 'text-amber-800 font-semibold',
        error: 'text-red-700 font-semibold'
      };

      const html = this.logs.map(l => `
        <div class="text-[11px] font-mono leading-relaxed py-0.5 border-b border-stone-100 flex items-start gap-1.5 ${colorMap[l.type]}">
          <span class="text-stone-400 flex-shrink-0">[${l.time}]</span>
          <span>${l.text}</span>
        </div>
      `).join('');

      this.dom.logContainer.innerHTML = html;
    }
  }
}

// =========================================================================
// 主循环初始化与启动
// =========================================================================

let simulatorInstance = null;
let lastTimestamp = 0;

function animationTick(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const deltaTime = Math.min(100, timestamp - lastTimestamp);
  lastTimestamp = timestamp;

  if (simulatorInstance) {
    simulatorInstance.update(deltaTime);
    simulatorInstance.render();
  }

  requestAnimationFrame(animationTick);
}

window.addEventListener('DOMContentLoaded', () => {
  simulatorInstance = new GBNSimulator();
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
