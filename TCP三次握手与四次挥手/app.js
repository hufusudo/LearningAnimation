/**
 * TCP 三次握手与四次挥手演示系统 · 核心交互引擎
 * 双主机时空交互梯形图 + 报文透视显微镜
 * 遵循 408 计算机网络标准与 Taste-Skill Light Editorial 浅色纸质美学
 */

/* ==========================================================================
   1. 状态机视觉字典
   ========================================================================== */

const STATE_STYLE = {
  'CLOSED':      { color: '#57534E', bg: '#F4F3EE', bd: '#D6D3CD', led: '#A8A29E' },
  'LISTEN':      { color: '#1D4ED8', bg: '#EFF6FF', bd: '#93C5FD', led: '#2563EB' },
  'SYN-SENT':    { color: '#B45309', bg: '#FFFBEB', bd: '#FCD34D', led: '#D97706' },
  'SYN-RCVD':    { color: '#B45309', bg: '#FFFBEB', bd: '#FCD34D', led: '#D97706' },
  'ESTABLISHED': { color: '#047857', bg: '#ECFDF5', bd: '#6EE7B7', led: '#059669' },
  'FIN-WAIT-1':  { color: '#B45309', bg: '#FFFBEB', bd: '#FCD34D', led: '#D97706' },
  'FIN-WAIT-2':  { color: '#B45309', bg: '#FFFBEB', bd: '#FCD34D', led: '#D97706' },
  'CLOSE-WAIT':  { color: '#B45309', bg: '#FFFBEB', bd: '#FCD34D', led: '#D97706' },
  'LAST-ACK':    { color: '#BE123C', bg: '#FFF1F2', bd: '#FDA4AF', led: '#E11D48' },
  'TIME_WAIT':   { color: '#BE123C', bg: '#FFF1F2', bd: '#FDA4AF', led: '#E11D48' }
};

const STATE_HINT = {
  'CLOSED':      '连接已关闭 · 无任何连接资源',
  'LISTEN':      '被动打开 · 等待远端连接请求',
  'SYN-SENT':    '已发出 SYN · 等待对方确认',
  'SYN-RCVD':    '已收到 SYN · 等待最后的 ACK',
  'ESTABLISHED': '连接已建立 · 双向数据通道打通',
  'FIN-WAIT-1':  '已发 FIN · 等待对方 ACK',
  'FIN-WAIT-2':  '已收 ACK · 关闭发送、保持单向接收',
  'CLOSE-WAIT':  '收到 FIN · 自己还有残存数据要发',
  'LAST-ACK':    '已发 FIN · 等待最终 ACK 确认',
  'TIME_WAIT':   '2MSL 倒计时等待中 · 防止残余报文串扰'
};

const KIND_COLOR = {
  SYN: '#2563EB', SYNACK: '#1D4ED8', ACK: '#059669',
  FIN: '#D97706', FINACK: '#B45309', DATA: '#57534E'
};

const KIND_LABEL = {
  SYN: 'SYN', SYNACK: 'SYN,ACK', ACK: 'ACK',
  FIN: 'FIN', FINACK: 'FIN,ACK', DATA: 'DATA'
};

/* ==========================================================================
   2. 模式与节拍定义（纯数据，便于前后推演与状态快照）
   ========================================================================== */

const MODES = {
  /* ---------------------------------------------------------------- 三次握手 */
  handshake: {
    label: '三次握手',
    base: {
      cState: 'CLOSED', sState: 'LISTEN',
      cSeq: 100, sSeq: 300,
      buffer: 0, link: false, hourglass: false
    },
    intro: '客户端 CLOSED、服务端 LISTEN：连接尚未建立。服务端已在 80 端口被动监听，等待远端的连接请求。',
    steps: [
      {
        tag: '第 1 拍',
        title: '客户端发出 SYN',
        meaning: '客户端（主动打开方）向服务端发送 SYN 报文请求建立连接，自己随即进入 SYN-SENT。SYN 虽不含数据却占用 1 个序号，因此 seq=100 之后的下一个序号是 101。',
        send: { cState: 'SYN-SENT', cSeq: 101 },
        effects: { cState: 'SYN-SENT', cSeq: 101 },
        tracks: [{
          id: 'h1', dir: 'c2s', kind: 'SYN',
          chip: 'SYN · seq=100',
          flags: { syn: 1, ack: 0, fin: 0 },
          seq: '100', ack: '', len: null,
          flashAck: [], flashSeq: false,
          seqHint: '客户端初始序号 100 · SYN 占 1 个序号',
          ackHint: '本条报文不携带确认号',
          meaning: 'SYN=1 表示「我想和你建立连接」；seq=100 是客户端的初始序号。这条报文没有应用层数据，但 SYN 自身要占用 1 个序号，所以下一号应为 101。',
          recv: {}
        }],
        logs: [
          { side: 'c', html: 'Client 发送 <b>SYN, seq=100</b>　CLOSED ⇒ <b>SYN-SENT</b>' }
        ]
      },
      {
        tag: '第 2 拍',
        title: '服务端响应 SYN + ACK',
        meaning: '服务端同意建立连接，回发 SYN+ACK：既同步自己的初始序号 300，又用 ack=101 确认已收到客户端的 SYN（100+1）。服务端进入 SYN-RCVD。',
        send: { sState: 'SYN-RCVD', sSeq: 301 },
        effects: { sState: 'SYN-RCVD', sSeq: 301 },
        tracks: [{
          id: 'h2', dir: 's2c', kind: 'SYNACK',
          chip: 'SYN,ACK · seq=300 · ack=101',
          flags: { syn: 1, ack: 1, fin: 0 },
          seq: '300', ack: '101', len: null,
          flashAck: ['101'], flashSeq: false,
          seqHint: '服务端初始序号 300 · SYN 占 1 个序号',
          ackHint: '101 = 100 + 1：SYN(seq=100) 已收妥',
          meaning: 'SYN=1,ACK=1 表示「我同意建立，并同步我的序号」；ack=101 是 100+1——确认号永远等于「已收到的最后一个序号 + 1」，即下一个期望收到的字节序号。',
          recv: {}
        }],
        logs: [
          { side: 's', html: 'Server 回发 <b>SYN+ACK, seq=300, ack=101</b>（=100+1）　LISTEN ⇒ <b>SYN-RCVD</b>' }
        ]
      },
      {
        tag: '第 3 拍',
        title: '客户端确认 ACK · 连接打通',
        meaning: '客户端回发纯 ACK：ack=301 = 300+1，确认服务端的 SYN。客户端在发送时即进入 ESTABLISHED；服务端收到后同样进入 ESTABLISHED，双主机之间点亮常驻连通光带，三次握手完成。',
        send: { cState: 'ESTABLISHED' },
        effects: { cState: 'ESTABLISHED', sState: 'ESTABLISHED', link: true },
        tracks: [{
          id: 'h3', dir: 'c2s', kind: 'ACK',
          chip: 'ACK · seq=101 · ack=301',
          flags: { syn: 0, ack: 1, fin: 0 },
          seq: '101', ack: '301', len: null,
          flashAck: ['301'], flashSeq: false,
          seqHint: 'SYN 已占用 100，本端下一字节序号 101',
          ackHint: '301 = 300 + 1：服务端的 SYN 已收妥',
          meaning: 'ACK=1 完成最后的确认，这条纯 ACK 不消耗序号（seq 仍为 101）。至此双方都确认了「对方的发送与接收能力」，连接建立，可以开始传输数据。',
          recv: { sState: 'ESTABLISHED', link: true, pulse: ['client', 'server'] }
        }],
        logs: [
          { side: 'c', html: 'Client 发送 <b>ACK, seq=101, ack=301</b>（=300+1）　SYN-SENT ⇒ <b>ESTABLISHED</b>' },
          { side: 'o', html: 'Server 收到 ACK　SYN-RCVD ⇒ <b>ESTABLISHED</b> · 连通光带点亮，握手完成' }
        ]
      }
    ]
  },

  /* ---------------------------------------------------------------- 四次挥手 */
  wave: {
    label: '四次挥手',
    base: {
      cState: 'ESTABLISHED', sState: 'ESTABLISHED',
      cSeq: 200, sSeq: 400,
      buffer: 50, link: true, hourglass: false
    },
    intro: '连接已建立（ESTABLISHED），双方可双向传输；服务端仍有 50 字节应用层残存数据积压在缓冲管中，等待发送完毕后才能关闭。',
    steps: [
      {
        tag: '第 1 拍',
        title: '客户端提出关闭（FIN）',
        meaning: '客户端数据已发送完毕，于是发送 FIN 报文请求释放连接，自己进入 FIN-WAIT-1 等待对方确认。FIN 同样占用 1 个序号，因此 seq=200。',
        send: { cState: 'FIN-WAIT-1', cSeq: 201 },
        effects: { cState: 'FIN-WAIT-1', cSeq: 201 },
        tracks: [{
          id: 'w1', dir: 'c2s', kind: 'FIN',
          chip: 'FIN · seq=200',
          flags: { syn: 0, ack: 0, fin: 1 },
          seq: '200', ack: '', len: 0,
          flashAck: [], flashSeq: false,
          seqHint: 'FIN 占用 1 个序号：200 之后是 201',
          ackHint: 'FIN 本身不含确认号',
          meaning: 'FIN=1 表示「我的数据发完了，请求释放连接」。FIN 没有载荷，却同样占用 1 个序号，所以服务端必须回 ack=201 才算确认完毕。',
          recv: {}
        }],
        logs: [
          { side: 'c', html: 'Client 发送 <b>FIN, seq=200</b>　ESTABLISHED ⇒ <b>FIN-WAIT-1</b>' }
        ]
      },
      {
        tag: '第 2 拍',
        title: '服务端初步响应（ACK）',
        meaning: '服务端先回一个纯 ACK（ack=201 = 200+1）表示「关闭请求收到」，但它还有数据没发完，故进入 CLOSE-WAIT 半关闭状态；客户端收到 ACK 后进入 FIN-WAIT-2，关闭发送方向、保持单向接收。',
        send: { sState: 'CLOSE-WAIT' },
        effects: { sState: 'CLOSE-WAIT', cState: 'FIN-WAIT-2' },
        tracks: [{
          id: 'w2', dir: 's2c', kind: 'ACK',
          chip: 'ACK · seq=400 · ack=201',
          flags: { syn: 0, ack: 1, fin: 0 },
          seq: '400', ack: '201', len: null,
          flashAck: ['201'], flashSeq: false,
          seqHint: '服务端当前基准序号 400（纯 ACK 不消耗序号）',
          ackHint: '201 = 200 + 1：FIN(seq=200) 已收妥',
          meaning: '这一步只是「收到关闭请求」的回执，并不等于连接关闭。TCP 是全双工，服务端把该发的数据发完之前，连接处于半关闭状态。',
          recv: { cState: 'FIN-WAIT-2' }
        }],
        logs: [
          { side: 's', html: 'Server 回发 <b>ACK, seq=400, ack=201</b>（=200+1）　ESTABLISHED ⇒ <b>CLOSE-WAIT</b>（半关闭）' },
          { side: 'c', html: 'Client 收到 ACK　FIN-WAIT-1 ⇒ <b>FIN-WAIT-2</b>（关闭发送方向，只收不发）' }
        ]
      },
      {
        tag: '第 2.5 拍',
        title: '服务端补发残存数据 · 序号暴涨',
        meaning: 'CLOSE-WAIT 期间服务端继续把积压的 50 字节数据发完：先发 20 字节（400→420），再发 30 字节（420→450）。seq 计数器像里程表一样连跳 50，积压管同步清空——这正是下一步 FIN 的 seq 变成 451 的原因。',
        send: {},
        effects: { sSeq: 450, buffer: 0 },
        bufferHot: true,
        tracks: [
          {
            id: 'w3a', dir: 's2c', kind: 'DATA',
            chip: 'DATA · 20B · seq=400',
            flags: { syn: 0, ack: 0, fin: 0 },
            seq: '400', ack: '201', len: 20,
            flashAck: [], flashSeq: false,
            seqHint: '起始序号 400，共 20 字节 → 下一序号 420',
            ackHint: '仍确认 201：客户端的 FIN 早已收妥',
            odoTo: 420, chunk: 20,
            meaning: '纯数据报文：三个控制标志位全为 0。序号 400–419 共 20 字节，服务端计数器随之推进到 420。',
            recv: {}
          },
          {
            id: 'w3b', dir: 's2c', kind: 'DATA',
            chip: 'DATA · 30B · seq=420',
            flags: { syn: 0, ack: 0, fin: 0 },
            seq: '420', ack: '201', len: 30,
            flashAck: [], flashSeq: false,
            seqHint: '起始序号 420，共 30 字节 → 下一序号 450',
            ackHint: '仍确认 201：本端尚未关闭接收方向',
            odoTo: 450, chunk: 30,
            meaning: '剩余 30 字节（420–449）发送完毕，积压管清空，计数器由 420 跃升到 450，此时服务端才具备发送 FIN 的条件。',
            recv: {}
          }
        ],
        logs: [
          { side: 's', html: 'Server 积压管展开：残存应用层数据 <b>50 字节</b> 待补发' },
          { side: 's', html: 'Server 发送 <b>DATA 20B, seq=400→420</b>　积压剩余 30 字节' },
          { side: 's', html: 'Server 发送 <b>DATA 30B, seq=420→450</b>　积压管清空 · seq 计数器 <b>400 ⇒ 450</b>' }
        ]
      },
      {
        tag: '第 3 拍',
        title: '服务端正式告别（FIN + ACK）',
        meaning: '残存数据发完后，服务端才发送 FIN+ACK 正式关闭自己的发送方向：seq=451（400 + 50 字节数据 + 1 个 FIN 序号），ack=201。服务端进入 LAST-ACK 等待最后确认。',
        send: { sState: 'LAST-ACK', sSeq: 451 },
        effects: { sState: 'LAST-ACK', sSeq: 451 },
        compare: true,
        tracks: [{
          id: 'w4', dir: 's2c', kind: 'FINACK',
          chip: 'FIN,ACK · seq=451 · ack=201',
          flags: { syn: 0, ack: 1, fin: 1 },
          seq: '451', ack: '201', len: 0,
          flashAck: [], flashSeq: true,
          seqHint: '451 = 400 + 50 字节数据 + 1 个 FIN 序号',
          ackHint: '201 = 200 + 1：客户端的 FIN 仍被确认',
          meaning: 'FIN=1,ACK=1 既确认客户端的关闭请求，又宣告自己也发完了。序号从 400 跳到 451 的全部原因，都在中间那 50 字节数据与 FIN 自身占用的 1 个序号上。',
          recv: {}
        }],
        logs: [
          { side: 's', html: 'Server 发送 <b>FIN+ACK, seq=451, ack=201</b>　CLOSE-WAIT ⇒ <b>LAST-ACK</b>' },
          { side: 'x', html: '序号溯源：<b>400 + 50 B 数据 + 1 个 FIN 序号 = 451</b>' }
        ]
      },
      {
        tag: '第 4 拍',
        title: '客户端最终确认与 2MSL 等待',
        meaning: '客户端发出最后一个 ACK（seq=201、ack=452 = 451+1），随即进入 TIME_WAIT 并启动 2MSL 沙漏；服务端收到后转为 CLOSED。倒计时结束后客户端也转入 CLOSED，连通光带平滑淡出，连接彻底释放。',
        send: { cState: 'TIME_WAIT', hourglass: true },
        effects: { cState: 'CLOSED', sState: 'CLOSED', link: false, hourglass: false },
        tracks: [{
          id: 'w5', dir: 'c2s', kind: 'ACK',
          chip: 'ACK · seq=201 · ack=452',
          flags: { syn: 0, ack: 1, fin: 0 },
          seq: '201', ack: '452', len: null,
          flashAck: ['452'], flashSeq: false,
          seqHint: '纯 ACK 不消耗序号，仍为 201',
          ackHint: '452 = 451 + 1：服务端的 FIN 已收妥',
          meaning: '最后这条 ACK 不消耗序号。主动关闭方必须在 TIME_WAIT 停留 2MSL：既能等可能丢失的 FIN 重传，也让本连接的残余报文彻底消散。',
          recv: { sState: 'CLOSED', pulse: ['server'] }
        }],
        post: { cState: 'CLOSED', link: false, hourglass: false, pulse: ['client'] },
        postLabel: '2MSL 倒计时结束',
        logs: [
          { side: 'c', html: 'Client 发送 <b>ACK, seq=201, ack=452</b>（=451+1）　FIN-WAIT-2 ⇒ <b>TIME_WAIT</b>' },
          { side: 's', html: 'Server 收到 ACK　LAST-ACK ⇒ <b>CLOSED</b>' },
          { side: 'o', html: 'TIME_WAIT 的 <b>2MSL</b> 倒计时结束 ⇒ <b>CLOSED</b> · 连通光带淡出，连接释放' }
        ]
      }
    ]
  }
};

/* ==========================================================================
   3. 演示引擎
   ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';
const FLIGHT_D = 1.0;   // 报文飞行基准时长（受播放速度缩放）
const FLIGHT_GAP = 0.42; // 相邻报文间隔
const COUNTDOWN_D = 3.0; // 2MSL 倒计时基准时长

class TCPSimulator {
  constructor() {
    this.mode = 'handshake';
    this.idx = 0;            // 已完成节拍数
    this.speed = 1;
    this.playing = false;
    this.stepRunning = false;
    this.currentTl = null;
    this.nextTimer = null;
    this.trackEls = {};      // id -> DOM/SVG 元素集合
    this.currentTrackId = null;
    this.geo = null;
    this.lanes = {};

    this.cacheDOM();
    this.bindEvents();
    this.setMode('handshake', true);
  }

  /* ---------------------------------------------------------- DOM 与事件 */
  cacheDOM() {
    this.dom = {
      channel: document.getElementById('channel'),
      svg: document.getElementById('ch-svg'),
      packetLayer: document.getElementById('packet-layer'),
      beam: document.getElementById('link-beam'),

      stateClient: document.getElementById('state-client'),
      stateServer: document.getElementById('state-server'),
      ledClient: document.getElementById('led-client'),
      ledServer: document.getElementById('led-server'),
      hintClient: document.getElementById('hint-client'),
      hintServer: document.getElementById('hint-server'),
      hostClient: document.getElementById('host-client'),
      hostServer: document.getElementById('host-server'),
      seqClient: document.getElementById('seq-client'),
      seqServer: document.getElementById('seq-server'),
      seqJump: document.getElementById('seq-jump'),
      seqJumpRow: document.getElementById('seq-jump-row'),

      hourglass: document.getElementById('hourglass-client'),
      hgCount: document.getElementById('hg-count'),
      hgSandTop: document.getElementById('hg-sand-top'),
      hgSandBot: document.getElementById('hg-sand-bot'),

      pipe: document.getElementById('buffer-pipe'),
      bpFill: document.getElementById('bp-fill'),
      bpMeta: document.getElementById('bp-meta'),

      statusTag: document.getElementById('status-tag'),
      statusTitle: document.getElementById('status-title'),
      statusMeaning: document.getElementById('status-meaning'),
      dots: document.getElementById('progress-dots'),
      explanation: document.getElementById('explanation'),
      compare: document.getElementById('compare-callout'),

      btnPlay: document.getElementById('btn-play'),
      btnPlayText: document.getElementById('btn-play-text'),
      btnPlayIcon: document.getElementById('btn-play-icon'),
      btnNext: document.getElementById('btn-next'),
      btnPrev: document.getElementById('btn-prev'),
      btnRestart: document.getElementById('btn-restart'),
      speedSlider: document.getElementById('speed-slider'),
      speedVal: document.getElementById('speed-val'),

      mscTag: document.getElementById('msc-step-tag'),
      dirArrow: document.getElementById('dir-arrow'),
      dirA: document.getElementById('dir-node-a'),
      dirB: document.getElementById('dir-node-b'),
      flagSyn: document.getElementById('flag-syn'),
      flagAck: document.getElementById('flag-ack'),
      flagFin: document.getElementById('flag-fin'),
      mscSeq: document.getElementById('msc-seq'),
      mscAck: document.getElementById('msc-ack'),
      mscLen: document.getElementById('msc-len'),
      mscLenBox: document.getElementById('msc-len-box'),
      mscSeqHint: document.getElementById('msc-seq-hint'),
      mscAckHint: document.getElementById('msc-ack-hint'),
      mscMeaning: document.getElementById('msc-meaning'),
      mscSeqBox: document.getElementById('msc-seq').parentElement,
      mscAckBox: document.getElementById('msc-ack').parentElement,

      logs: document.getElementById('event-logs'),
      modeBtns: Array.from(document.querySelectorAll('.mode-btn'))
    };
  }

  bindEvents() {
    const d = this.dom;
    d.btnPlay.addEventListener('click', () => this.togglePlay());
    d.btnNext.addEventListener('click', () => { this.pause(); this.stepForward(); });
    d.btnPrev.addEventListener('click', () => { this.pause(); this.stepBack(); });
    d.btnRestart.addEventListener('click', () => { this.pause(); this.restart(); });

    d.speedSlider.addEventListener('input', (e) => {
      this.speed = parseFloat(e.target.value);
      d.speedVal.textContent = this.speed.toFixed(1) + 'x';
      d.speedSlider.style.setProperty('--pct', ((this.speed - 0.5) / 1.5 * 100) + '%');
      if (this.currentTl) this.currentTl.timeScale(this.speed);
    });
    d.speedSlider.style.setProperty('--pct', '33.3%');

    d.modeBtns.forEach(btn => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); this.pause(); this.stepForward(); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); this.pause(); this.stepBack(); }
      else if (e.key === 'r' || e.key === 'R') { this.pause(); this.restart(); }
    });

    let rt = null;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => this.layout(), 140);
    });
  }

  /* ---------------------------------------------------------- 模式与复位 */
  get def() { return MODES[this.mode]; }
  get steps() { return this.def.steps; }

  setMode(mode, silent = false) {
    if (!MODES[mode]) return;
    if (this.mode === mode && !silent) { this.pause(); this.restart(); return; }
    this.mode = mode;
    this.pause();

    this.dom.modeBtns.forEach(b => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const apply = () => {
      this.killTimeline();
      this.idx = 0;
      this.clearAllTracks();
      this.rebuildIndex();
      this.layout();
      this.applySnapshot(0, { micro: true });
      this.clearLogs();
      this.renderDots();
      gsap.fromTo(this.dom.channel, { opacity: 0.25 }, { opacity: 1, duration: 0.45, ease: 'power2.out' });
    };

    if (silent) apply();
    else this.fadeOutStage(apply);
  }

  restart(autoPlay = false) {
    this.pause();
    this.killTimeline();
    this.idx = 0;
    this.clearAllTracks();
    this.applySnapshot(0, { micro: true });
    this.clearLogs();
    this.renderDots();
    if (autoPlay) this.togglePlay();
  }

  fadeOutStage(done) {
    const kids = Array.from(this.dom.packetLayer.children);
    const trackGroups = Object.values(this.trackEls).map(e => e.g);
    const targets = kids.concat(trackGroups);
    if (!targets.length) { done(); return; }
    gsap.to(targets, {
      opacity: 0, duration: 0.28, ease: 'power2.in', stagger: 0.04,
      onComplete: done
    });
  }

  /* 节拍索引：扁平的报文飞行轨道顺序 + 归属节拍 */
  rebuildIndex() {
    this.trackOrder = [];
    this.trackStep = {};
    this._trackById = {};
    this.steps.forEach((st, i) => {
      st.tracks.forEach(tr => {
        this.trackOrder.push(tr.id);
        this.trackStep[tr.id] = i + 1;
        this._trackById[tr.id] = tr;
      });
    });
  }

  /* ---------------------------------------------------------- 版面布局 */
  layout() {
    const w = this.dom.channel.clientWidth;
    const h = this.dom.channel.clientHeight;
    if (!w || !h) return;

    const top = 52, bottom = h - 40;
    const n = this.trackOrder.length;
    const laneH = n ? (bottom - top) / n : 60;

    this.geo = { w, h, lx: 36, rx: w - 36, top, bottom };
    this.lanes = {};
    this.trackOrder.forEach((id, i) => {
      const tr = this._trackById[id];
      const drop = Math.max(26, Math.min(laneH * 0.78, 110));
      const y0 = top + i * laneH + Math.max(6, (laneH - drop) / 2);
      this.lanes[id] = tr.dir === 'c2s'
        ? { x0: this.geo.lx, y0, x1: this.geo.rx, y1: y0 + drop, dir: 1 }
        : { x0: this.geo.rx, y0, x1: this.geo.lx, y1: y0 + drop, dir: -1 };
    });

    this.dom.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.drawRails();
    Object.keys(this.trackEls).forEach(id => this.syncTrackGeometry(id));
    this.trackOrder.forEach(id => {
      if (this.trackEls[id] && this.trackStep[id] <= this.idx) this.paintStatic(id);
    });
  }

  drawRails() {
    const { w, h, lx, rx } = this.geo;
    const g = document.getElementById('rails');
    if (g) g.remove();

    const rails = document.createElementNS(SVG_NS, 'g');
    rails.setAttribute('id', 'rails');

    [lx, rx].forEach(x => {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x); line.setAttribute('y1', 14);
      line.setAttribute('x2', x); line.setAttribute('y2', h - 22);
      line.setAttribute('class', 'rail-line');
      rails.appendChild(line);

      const head = document.createElementNS(SVG_NS, 'path');
      head.setAttribute('d', `M${x - 5} ${h - 30} L${x + 5} ${h - 30} L${x} ${h - 18} Z`);
      head.setAttribute('class', 'rail-cap');
      rails.appendChild(head);
    });

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', w / 2);
    label.setAttribute('y', h - 6);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'rail-label');
    label.textContent = '时间自上而下流逝 ↓';
    rails.appendChild(label);

    this.dom.svg.appendChild(rails);
  }

  /* ---------------------------------------------------------- 轨道元素 */
  laneOf(id) { return this.lanes[id]; }

  cancelRetire(els) {
    if (!els) return;
    if (els.retireTl) { els.retireTl.kill(); els.retireTl = null; }
    els.retiring = false;
  }

  ensureTrackEls(tr) {
    if (this.trackEls[tr.id]) {
      this.cancelRetire(this.trackEls[tr.id]);
      return this.trackEls[tr.id];
    }
    const lane = this.laneOf(tr.id);
    const color = KIND_COLOR[tr.kind];

    const g = document.createElementNS(SVG_NS, 'g');
    const glow = document.createElementNS(SVG_NS, 'path');
    glow.setAttribute('class', 'track-glow');
    glow.setAttribute('stroke', color);
    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('class', 'track-line');
    line.setAttribute('stroke', color);
    const head = document.createElementNS(SVG_NS, 'path');
    head.setAttribute('class', 'track-head');
    head.setAttribute('fill', color);
    g.appendChild(glow); g.appendChild(line); g.appendChild(head);
    this.dom.svg.appendChild(g);

    const chip = document.createElement('div');
    chip.className = 'track-chip';
    chip.innerHTML = tr.chip;
    this.dom.packetLayer.appendChild(chip);

    const env = document.createElement('div');
    env.className = 'envelope env-' + tr.kind.toLowerCase() + (tr.dir === 's2c' ? ' rev' : '');
    env.innerHTML =
      `<span>${KIND_LABEL[tr.kind]}</span>` +
      `<span${tr.flashSeq ? ' class="flash-num"' : ''}>seq=${tr.seq}</span>` +
      (tr.ack ? `<span class="env-ack${(tr.flashAck && tr.flashAck.length) ? ' flash-num' : ''}">ack=${tr.ack}</span>` : '') +
      (tr.len ? `<span class="env-len">${tr.len}B</span>` : '');
    this.dom.packetLayer.appendChild(env);
    gsap.set([chip, env], { xPercent: -50, yPercent: -50 });

    const els = { g, glow, line, head, chip, env, color, retiring: false, retireTl: null };
    this.trackEls[tr.id] = els;
    this.syncTrackGeometry(tr.id);
    return els;
  }

  syncTrackGeometry(id) {
    const els = this.trackEls[id];
    const lane = this.laneOf(id);
    if (!els || !lane) return;
    const d = `M${lane.x0} ${lane.y0} L${lane.x1} ${lane.y1}`;
    els.line.setAttribute('d', d);
    els.glow.setAttribute('d', d);

    const len = Math.hypot(lane.x1 - lane.x0, lane.y1 - lane.y0);
    els.len = len;

    // 箭头头部
    const ang = Math.atan2(lane.y1 - lane.y0, lane.x1 - lane.x0);
    const a1 = ang + Math.PI * 0.82, a2 = ang - Math.PI * 0.82;
    const s = 8.5;
    els.head.setAttribute('d',
      `M${lane.x1} ${lane.y1} L${lane.x1 + Math.cos(a1) * s} ${lane.y1 + Math.sin(a1) * s} ` +
      `L${lane.x1 + Math.cos(a2) * s} ${lane.y1 + Math.sin(a2) * s} Z`);

    els.chip.style.left = ((lane.x0 + lane.x1) / 2) + 'px';
    els.chip.style.top = ((lane.y0 + lane.y1) / 2 - 15) + 'px';
  }

  paintStatic(id) {
    const els = this.trackEls[id];
    if (!els) return;
    this.cancelRetire(els);
    gsap.killTweensOf([els.g, els.chip, els.head, els.env, els.line, els.glow]);
    gsap.set(els.g, { opacity: 1 });
    gsap.set(els.line, { attr: { 'stroke-dasharray': els.len, 'stroke-dashoffset': 0 } });
    gsap.set(els.glow, { attr: { 'stroke-dasharray': els.len, 'stroke-dashoffset': 0 } });
    gsap.set(els.head, { opacity: 1 });
    gsap.set(els.chip, { opacity: 1, y: 0 });
    gsap.set(els.env, { opacity: 0 });
  }

  clearAllTracks() {
    Object.keys(this.trackEls).forEach(id => this.removeTrackEls(id));
    this.dom.packetLayer.innerHTML = '';
    this.currentTrackId = null;
  }

  removeTrackEls(id) {
    const els = this.trackEls[id];
    if (!els) return;
    this.cancelRetire(els);
    gsap.killTweensOf([els.g, els.chip, els.head, els.env, els.line, els.glow]);
    els.g.remove(); els.chip.remove(); els.env.remove();
    delete this.trackEls[id];
    if (this.currentTrackId === id) this.currentTrackId = null;
  }

  /** 后退时：预热闪烁 → 淡出收缩 → 移除 */
  retireTrack(id) {
    const els = this.trackEls[id];
    if (!els || els.retiring) return;
    els.retiring = true;
    const tl = gsap.timeline({
      onComplete: () => { els.retireTl = null; this.removeTrackEls(id); }
    });
    els.retireTl = tl;
    tl.to([els.chip, els.head], { opacity: 0.3, duration: 0.14, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 0);
    tl.to(els.g, { opacity: 0, duration: 0.3, ease: 'power2.in' }, 0.14);
    tl.to(els.chip, { opacity: 0, y: -5, duration: 0.3, ease: 'power2.in' }, 0.14);
    tl.to(els.env, { opacity: 0, scale: 0.7, duration: 0.25, ease: 'power2.in' }, 0.14);
  }

  syncTracks(idx, animate = true) {
    this.trackOrder.forEach(id => {
      const visible = this.trackStep[id] <= idx;
      const els = this.trackEls[id];
      if (visible) {
        const tr = this._trackById[id];
        const e = this.ensureTrackEls(tr);
        this.syncTrackGeometry(id);
        this.paintStatic(id);
      } else if (els) {
        animate ? this.retireTrack(id) : this.removeTrackEls(id);
      }
    });
  }

  /* ---------------------------------------------------------- 快照渲染 */
  snapshot(idx) {
    const s = Object.assign({}, this.def.base);
    for (let i = 0; i < idx; i++) Object.assign(s, this.steps[i].effects);
    return s;
  }

  applySnapshot(idx, opts = {}) {
    const { micro = false } = opts;
    const s = this.snapshot(idx);
    this.applyStates({
      cState: s.cState, sState: s.sState,
      link: s.link, hourglass: s.hourglass, buffer: s.buffer
    });
    this.setCounter('client', s.cSeq, 0.5);
    this.setCounter('server', s.sSeq, 0.5);
    this.syncTracks(idx, true);
    this.renderStatus(idx);
    this.trimLogs(idx);
    if (micro) {
      const last = idx > 0 ? this.steps[idx - 1] : null;
      const tr = last ? last.tracks[last.tracks.length - 1] : null;
      this.currentTrackId = null;
      this.showMicroscope(tr, last);
    }
  }

  /** 由节拍内的 send / recv 描述统一推进可视化状态 */
  applyStates(o, animate = true) {
    if (!o) return;
    if (o.cState) this.setState('client', o.cState, animate);
    if (o.sState) this.setState('server', o.sState, animate);
    if ('link' in o) this.setLink(o.link, animate);
    if ('hourglass' in o) this.setHourglass(o.hourglass, animate);
    if ('buffer' in o) this.renderBuffer(o.buffer, animate);
    if (o.cSeq != null) this.setCounter('client', o.cSeq, animate ? 0.5 : 0);
    if (o.sSeq != null) this.setCounter('server', o.sSeq, animate ? 0.5 : 0);
    if (o.pulse) o.pulse.forEach(side => this.pulseHost(side));
  }

  setState(side, state, animate = true) {
    const chip = side === 'client' ? this.dom.stateClient : this.dom.stateServer;
    const led = side === 'client' ? this.dom.ledClient : this.dom.ledServer;
    const hint = side === 'client' ? this.dom.hintClient : this.dom.hintServer;
    const st = STATE_STYLE[state] || STATE_STYLE.CLOSED;
    const changed = chip.textContent !== state;

    chip.textContent = state;
    chip.style.background = st.bg;
    chip.style.color = st.color;
    chip.style.borderColor = st.bd;
    led.style.background = st.led;
    led.style.boxShadow = `0 0 7px ${st.led}`;
    led.classList.toggle('blink', state !== 'CLOSED' && state !== 'LISTEN');
    hint.textContent = STATE_HINT[state] || '';

    if (changed && animate) {
      gsap.fromTo(chip, { scale: 1 }, { scale: 1, duration: 0.01 });
      chip.classList.remove('bump');
      void chip.offsetWidth;
      chip.classList.add('bump');
    }
  }

  pulseHost(side) {
    const el = side === 'client' ? this.dom.hostClient : this.dom.hostServer;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  setLink(on, animate = true) {
    const beam = this.dom.beam;
    if (this._linkTl) { this._linkTl.kill(); this._linkTl = null; }
    const apply = () => {
      beam.classList.toggle('on', !!on);
      this.dom.hostClient.classList.toggle('linked', !!on);
      this.dom.hostServer.classList.toggle('linked', !!on);
      beam.style.opacity = '';
    };
    if (!on && animate && beam.classList.contains('on')) {
      const tl = gsap.timeline({
        onComplete: () => { this._linkTl = null; apply(); }
      });
      this._linkTl = tl;
      tl.to(beam, { opacity: 1, duration: 0.1 })
        .to(beam, { opacity: 0.18, duration: 0.14, yoyo: true, repeat: 3 })
        .to(beam, { opacity: 0, duration: 0.5, ease: 'power2.out' });
      gsap.to([this.dom.hostClient, this.dom.hostServer], {
        boxShadow: '0 0 0 0 rgba(5,150,105,0)', duration: 0.6
      });
    } else {
      apply();
    }
  }

  setCounter(side, value, dur = 0.5) {
    const el = side === 'client' ? this.dom.seqClient : this.dom.seqServer;
    const from = parseInt(el.textContent, 10);
    if (isNaN(from) || from === value || !dur) { el.textContent = value; return; }
    const obj = { v: from };
    el.classList.add('rolling');
    gsap.to(obj, {
      v: value, duration: dur, ease: 'power2.out',
      onUpdate: () => { el.textContent = Math.round(obj.v); },
      onComplete: () => { el.textContent = value; el.classList.remove('rolling'); }
    });
  }

  setHourglass(on, animate = true) {
    const hg = this.dom.hourglass;
    if (on) {
      if (hg.classList.contains('show')) return;
      hg.classList.add('show');
      this.resetSand();
      if (animate) gsap.fromTo(hg, { opacity: 0, y: -8, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'back.out(1.6)' });
      else gsap.set(hg, { opacity: 1, y: 0, scale: 1 });
    } else {
      if (!hg.classList.contains('show')) return;
      hg.classList.remove('show');
      gsap.set(hg, { clearProps: 'opacity,transform' });
      this.resetSand();
    }
  }

  resetSand() {
    this.dom.hgCount.textContent = '2.5';
    this.dom.hgSandTop.setAttribute('height', 17);
    this.dom.hgSandTop.setAttribute('y', 5);
    this.dom.hgSandBot.setAttribute('height', 0);
    this.dom.hgSandBot.setAttribute('y', 39);
  }

  /** 2MSL 沙漏流逝（写入节拍时间轴，受速度缩放） */
  countdownTween(tl, at) {
    const obj = { v: 2.5 };
    tl.to(obj, {
      v: 0, duration: COUNTDOWN_D, ease: 'none',
      onUpdate: () => {
        this.dom.hgCount.textContent = obj.v.toFixed(1);
        const p = 1 - obj.v / 2.5;
        this.dom.hgSandTop.setAttribute('height', Math.max(0, 17 * (1 - p)));
        this.dom.hgSandTop.setAttribute('y', 5 + 17 * p);
        this.dom.hgSandBot.setAttribute('height', Math.max(0, 17 * p));
        this.dom.hgSandBot.setAttribute('y', 39 - 17 * p);
      }
    }, at);
  }

  /* ---------------------------------------------------------- 积压管 */
  renderBuffer(remaining, animate = true) {
    const chunks = Array.from(this.dom.bpFill.querySelectorAll('.bp-chunk'));
    const showChunk = (len, show) => {
      const c = chunks.find(x => x.dataset.len === String(len));
      if (!c) return;
      const visible = c.style.display !== 'none';
      if (show === visible) return;
      if (show) {
        gsap.set(c, { display: 'flex', opacity: 1, scale: 1, y: 0 });
      } else if (animate) {
        gsap.to(c, { opacity: 0, scale: 0.6, y: 10, duration: 0.3, ease: 'power2.in', onComplete: () => gsap.set(c, { display: 'none' }) });
      } else {
        gsap.killTweensOf(c);
        gsap.set(c, { display: 'none', opacity: 0, clearProps: 'transform' });
      }
    };

    showChunk(20, remaining >= 50);
    showChunk(30, remaining >= 30);

    const pipe = this.dom.pipe;
    const isWave = this.mode === 'wave';
    pipe.classList.toggle('active', isWave);

    if (!isWave) {
      this.dom.bpMeta.textContent = '挥手阶段启用 · 当前无积压';
      this.dom.bpMeta.classList.remove('empty');
    } else if (remaining >= 50) {
      this.dom.bpMeta.textContent = '残存 50 字节 · 未发送';
      this.dom.bpMeta.classList.remove('empty');
    } else if (remaining > 0) {
      this.dom.bpMeta.textContent = `已发送 ${50 - remaining} 字节 · 剩余 ${remaining} 字节`;
      this.dom.bpMeta.classList.remove('empty');
    } else {
      this.dom.bpMeta.textContent = '积压已清空 · 0 字节';
      this.dom.bpMeta.classList.add('empty');
    }
  }

  /** 报文发射瞬间，把对应数据块从积压管中“抽走” */
  emitChunk(len) {
    const c = this.dom.bpFill.querySelector(`.bp-chunk[data-len="${len}"]`);
    if (!c) return;
    gsap.to(c, { opacity: 0, scale: 0.55, y: 14, duration: 0.4, ease: 'power2.in', onComplete: () => gsap.set(c, { display: 'none' }) });
    const remain = len === 20 ? 30 : 0;
    this.dom.bpMeta.textContent = remain > 0
      ? `已发送 ${50 - remain} 字节 · 剩余 ${remain} 字节`
      : '积压已清空 · 0 字节';
    this.dom.bpMeta.classList.toggle('empty', remain === 0);
  }

  /* ---------------------------------------------------------- 显微镜 */
  showMicroscope(tr, step) {
    const d = this.dom;
    if (!tr) {
      this.currentTrackId = null;
      d.mscTag.textContent = '待机 · 等待报文进入信道';
      d.mscTag.style.cssText = '';
      [d.flagSyn, d.flagAck, d.flagFin].forEach(f => f.classList.remove('on'));
      d.mscSeq.textContent = '—'; d.mscAck.textContent = '—'; d.mscLen.textContent = '—';
      d.mscSeqHint.textContent = '本条报文携带的起始序号';
      d.mscAckHint.textContent = '期望收到的下一个序号';
      d.mscMeaning.textContent = '报文在信道中飞行时，此处同步放大其内部字段：控制标志位、序号与确认号的来龙去脉。';
      d.mscSeqBox.classList.remove('hot'); d.mscAckBox.classList.remove('hot');
      d.dirArrow.classList.remove('rev');
      d.dirA.textContent = 'Client'; d.dirB.textContent = 'Server';
      return;
    }
    if (this.currentTrackId === tr.id) return;
    this.currentTrackId = tr.id;

    const c2s = tr.dir === 'c2s';
    d.dirArrow.classList.toggle('rev', !c2s);
    d.dirA.textContent = c2s ? 'Client' : 'Server';
    d.dirB.textContent = c2s ? 'Server' : 'Client';

    d.mscTag.textContent = `${step ? step.tag + ' · ' : ''}${c2s ? 'Client → Server' : 'Server → Client'} · ${KIND_LABEL[tr.kind]}`;

    d.flagSyn.classList.toggle('on', !!tr.flags.syn);
    d.flagAck.classList.toggle('on', !!tr.flags.ack);
    d.flagFin.classList.toggle('on', !!tr.flags.fin);

    d.mscSeq.textContent = tr.seq;
    d.mscSeqHint.textContent = tr.seqHint || '';
    d.mscAck.textContent = tr.ack || '—';
    d.mscAckHint.textContent = tr.ackHint || '';
    d.mscLen.textContent = tr.len == null ? '—' : (tr.len === 0 ? '0' : tr.len + ' B');
    d.mscLenBox.style.opacity = tr.len == null ? '0.5' : '1';
    d.mscMeaning.textContent = tr.meaning;

    // 闪烁微光：确认号 / 序号
    d.mscAckBox.classList.remove('hot');
    d.mscSeqBox.classList.remove('hot');
    d.mscAck.classList.remove('flash-num', 'glow');
    d.mscSeq.classList.remove('flash-num', 'glow');

    const flashValue = (el, box, val, hint) => {
      if (!val) return;
      el.innerHTML = `<span class="flash-num">${val}</span>`;
      box.classList.add('hot');
      const span = el.querySelector('.flash-num');
      span.classList.add('glow');
      gsap.fromTo(span, { scale: 0.86 }, { scale: 1, duration: 0.45, ease: 'back.out(2.4)' });
      gsap.delayedCall(3.0 / this.speed, () => span.classList.remove('glow'));
    };

    if (tr.flashAck && tr.flashAck.length) flashValue(d.mscAck, d.mscAckBox, tr.ack);
    if (tr.flashSeq) flashValue(d.mscSeq, d.mscSeqBox, tr.seq);

    gsap.fromTo(d.mscTag, { scale: 0.94, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'power2.out' });
    gsap.fromTo([d.flagSyn, d.flagAck, d.flagFin],
      { y: -3 }, { y: 0, duration: 0.3, stagger: 0.05, ease: 'back.out(2)', clearProps: 'y' });
  }

  /* ---------------------------------------------------------- 状态标签 */
  renderDots() {
    const n = this.steps.length;
    this.dom.dots.innerHTML = '';
    for (let i = 1; i <= n; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot' + (i <= this.idx ? ' on' : '') + (i === this.idx && this.idx > 0 ? ' cur' : '');
      this.dom.dots.appendChild(dot);
    }
  }

  renderStatus(idx) {
    const d = this.dom;
    const n = this.steps.length;
    let tag, title, meaning;

    if (idx <= 0) {
      tag = `初始状态 · 进度 0/${n}`;
      title = this.mode === 'handshake' ? '连接尚未建立' : '连接已建立 · 准备释放';
      meaning = this.def.intro;
    } else {
      const st = this.steps[idx - 1];
      tag = `${st.tag} · 进度 ${idx}/${n}`;
      title = st.title;
      meaning = st.meaning;
    }

    d.statusTag.textContent = tag;
    const finished = idx >= n && !this.stepRunning;
    d.statusTag.classList.toggle('is-done', finished);
    d.statusTitle.textContent = finished ? title + '（演进完成）' : title;

    gsap.fromTo([d.statusTitle, d.statusMeaning], { opacity: 0, y: 5 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', stagger: 0.05 });
    d.statusMeaning.textContent = meaning;
    gsap.fromTo(d.explanation, { opacity: 0.25 }, { opacity: 1, duration: 0.4, ease: 'power2.out' });
    d.explanation.textContent = meaning;

    this.renderDots();

    // 序号暴涨对比高亮
    const showCompare = this.mode === 'wave' && idx >= 4;
    if (showCompare !== d.compare.classList.contains('show')) {
      d.compare.classList.toggle('show', showCompare);
      if (showCompare) gsap.fromTo(d.compare, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });
    }
    d.seqJumpRow.style.display = this.mode === 'wave' ? 'flex' : 'none';
    if (this.mode === 'wave' && idx >= 4 && !d.seqJumpRow.dataset.flashed) {
      d.seqJumpRow.dataset.flashed = '1';
      d.seqJumpRow.classList.remove('seq-jump-flash'); void d.seqJumpRow.offsetWidth;
      d.seqJumpRow.classList.add('seq-jump-flash');
    }
    if (idx < 4) delete d.seqJumpRow.dataset.flashed;

    this.renderControls();
  }

  renderControls() {
    const n = this.steps.length;
    this.dom.btnPrev.disabled = this.stepRunning || this.idx <= 0;
    this.dom.btnNext.disabled = this.stepRunning || this.idx >= n;
    this.dom.btnRestart.disabled = false;
    this.dom.btnPlayText.textContent = this.playing ? '暂停' : (this.idx >= n ? '重播' : '播放');
    this.dom.btnPlayIcon.textContent = this.playing ? '❚❚' : '▶';
  }

  /* ---------------------------------------------------------- 日志 */
  appendLogs(stepIdx) {
    const st = this.steps[stepIdx - 1];
    if (!st) return;
    st.logs.forEach((l, i) => {
      const el = document.createElement('div');
      el.className = 'log-line lg-' + l.side;
      el.dataset.step = stepIdx;
      el.innerHTML = `<span class="text-stone-400 shrink-0">${st.tag}</span><span>${l.html}</span>`;
      this.dom.logs.appendChild(el);
      gsap.fromTo(el, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.35, delay: i * 0.12, ease: 'power2.out' });
    });
    this.dom.logs.scrollTop = this.dom.logs.scrollHeight;
  }

  trimLogs(idx) {
    Array.from(this.dom.logs.children).forEach(el => {
      if (parseInt(el.dataset.step, 10) > idx) {
        gsap.to(el, { opacity: 0, height: 0, marginBottom: -5, duration: 0.3, ease: 'power2.in', onComplete: () => el.remove() });
      }
    });
  }

  clearLogs() { this.dom.logs.innerHTML = ''; }

  /* ---------------------------------------------------------- 推演推进 */
  stepForward() {
    if (this.stepRunning || this.idx >= this.steps.length) return;
    this.playStep(this.idx + 1);
  }

  stepBack() {
    if (this.stepRunning || this.idx <= 0) return;
    const target = this.idx - 1;
    this.idx = target;
    this.applySnapshot(target, { micro: true });
  }

  killTimeline() {
    if (this.currentTl) { this.currentTl.kill(); this.currentTl = null; }
    this.stepRunning = false;
    clearTimeout(this.nextTimer);
    this.dom.pipe.classList.remove('hot');
  }

  playStep(k) {
    const st = this.steps[k - 1];
    this.stepRunning = true;
    this.renderControls();

    const tl = gsap.timeline({
      paused: true,
      onComplete: () => this.onStepDone(k)
    });

    tl.call(() => {
      this.renderStatus(k);
      this.appendLogs(k);
      if (st.bufferHot) this.dom.pipe.classList.add('hot');
    }, null, 0);

    if (st.send) tl.call(() => this.applyStates(st.send), null, 0.12);

    let t = 0.2;
    st.tracks.forEach((tr) => {
      tl.call(() => { this.showMicroscope(tr, st); }, null, t);
      this.appendTrackAnim(tl, tr, t);
      t += FLIGHT_D + FLIGHT_GAP;
    });

    if (st.post) {
      tl.call(() => this.setHourglass(true), null, t);
      this.countdownTween(tl, t);
      tl.call(() => this.applyStates(st.post), null, t + COUNTDOWN_D);
      t += COUNTDOWN_D;
    }

    tl.timeScale(this.speed);
    this.currentTl = tl;
    tl.play();
  }

  appendTrackAnim(tl, tr, at) {
    const els = this.ensureTrackEls(tr);
    const lane = this.laneOf(tr.id);
    const D = FLIGHT_D;
    const len = els.len;

    tl.set(els.g, { opacity: 1 }, at);
    tl.set(els.line, { attr: { 'stroke-dasharray': len, 'stroke-dashoffset': len } }, at);
    tl.set(els.glow, { attr: { 'stroke-dasharray': len, 'stroke-dashoffset': len } }, at);
    tl.set(els.head, { opacity: 0 }, at);
    tl.set(els.chip, { opacity: 0, y: -6 }, at);
    tl.set(els.env, { left: lane.x0, top: lane.y0, opacity: 1, scale: 1 }, at);

    // 序号里程表 / 积压管抽块
    if (tr.odoTo != null) {
      tl.call(() => this.setCounter('server', tr.odoTo, D * 0.95), null, at);
      const el = this.dom.seqServer;
      tl.fromTo(el, { scale: 1.08 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' }, at);
    }
    if (tr.chunk) tl.call(() => this.emitChunk(tr.chunk), null, at);

    // 报文沿斜向轨迹飞行 + 轨迹同步描线
    tl.to(els.env, { left: lane.x1, top: lane.y1, duration: D, ease: 'power1.inOut' }, at);
    tl.to(els.line, { attr: { 'stroke-dashoffset': 0 }, duration: D, ease: 'power1.inOut' }, at);
    tl.to(els.glow, { attr: { 'stroke-dashoffset': 0 }, duration: D, ease: 'power1.inOut' }, at);
    tl.to(els.chip, { opacity: 1, y: 0, duration: 0.3, ease: 'back.out(2)' }, at + D * 0.85);
    tl.to(els.head, { opacity: 1, duration: 0.28, ease: 'back.out(2.4)' }, at + D);
    tl.to(els.env, { opacity: 0, scale: 0.7, duration: 0.24, ease: 'power2.in' }, at + D);

    // 对端接收后的状态跃迁
    if (tr.recv && Object.keys(tr.recv).length) {
      tl.call(() => this.applyStates(tr.recv), null, at + D);
    }
  }

  onStepDone(k) {
    this.currentTl = null;
    this.stepRunning = false;
    this.idx = k;
    this.dom.pipe.classList.remove('hot');
    // 收敛到该节拍的规范快照，保证后续后退/前进一致
    this.applySnapshot(k, { micro: false });
    if (k >= this.steps.length) this.playing = false;
    this.renderControls();
    if (this.playing) this.scheduleNext();
  }

  scheduleNext() {
    clearTimeout(this.nextTimer);
    if (!this.playing) return;
    if (this.idx >= this.steps.length) { this.playing = false; this.renderControls(); return; }
    this.nextTimer = setTimeout(() => {
      if (this.playing) this.stepForward();
    }, 750 / this.speed);
  }

  togglePlay() {
    if (this.playing) { this.pause(); return; }
    if (this.idx >= this.steps.length) { this.restart(true); return; }
    this.playing = true;
    this.renderControls();
    if (this.stepRunning && this.currentTl) this.currentTl.play();
    else this.stepForward();
  }

  pause() {
    this.playing = false;
    clearTimeout(this.nextTimer);
    if (this.currentTl && this.stepRunning) this.currentTl.pause();
    this.renderControls();
  }
}

/* 启动 */
window.addEventListener('DOMContentLoaded', () => { window.tcpDemo = new TCPSimulator(); });
