/**
 * 磁盘调度 SCAN 与 C-SCAN · 核心交互逻辑与动效状态机 (Step 2)
 * 严格按《设计方案.md》§3《动作时序规格表》编排。
 *
 * 架构铁律：
 *  1. 单一 master = gsap.timeline({ paused: true })；每个 Beat 用绝对时间偏移排布，
 *     拍窗（nominal）与次级动作分离 —— 次级动作允许溢出拍窗，但状态切换只认拍窗。
 *  2. render(time) 是「时间 → 界面」的纯函数：文字、计数、类状态全部由当前时间推导，
 *     不依赖一次性回调，倒带天然可逆。
 *  3. 补间只负责 transform / opacity / 颜色 / SVG 几何，一律 fromTo（显式起止），
 *     初始态用 gsap.set 预置，保证任意 seek 结果一致。
 *  4. 重建（换组）前 timeline.kill() + gsap.killTweensOf('*')（AGENTS.md §3.5 防呆铁律）。
 */
(function () {
  'use strict';

  /* ══════════════════ 1. 数据与算法 ══════════════════ */

  var MAX = 199;           // 最大磁道号
  var HEAD_START = 53;      // 初始磁头
  var DIR_START = 1;        // 初始方向：+1 向大号

  var GROUPS = [
    { key: 'A', name: '组 A · 教材例题', reqs: [98, 183, 37, 122, 14, 124, 65, 67] },
    { key: 'B', name: '组 B · 密集请求', reqs: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51] },
    { key: 'C', name: '组 C · 极端稀疏', reqs: [178] }
  ];

  var SCAN_ROWS = [18, 38];     // 泳道 A：去程 / 回程子行
  var CSCAN_ROWS = [64, 86];    // 泳道 B：去程 / 回程子行

  /** 磁道 → 轴轨内横向百分比（轴轨自身宽度由 .stage 的 CSS 变量控制，元素不感知内缩） */
  function xPct(c) { return (c / MAX) * 100; }
  /** 磁道 → 轨迹 SVG 局部坐标（viewBox 0 0 1000 100，与轴轨同宽） */
  function tX(c) { return (c / MAX) * 1000; }
  /** 磁头匀速移动：250ms + 4ms × 柱道距离，封顶 1600ms（倍速由 timeScale 统一缩放） */
  function moveDur(d) { return Math.min(1.6, 0.25 + 0.004 * Math.abs(d)); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /**
   * 生成服务路径：沿当前方向吃请求 → 到端点 → 折返（SCAN）或跳回起点（C-SCAN）
   */
  function sweepPath(head, dir, reqs, mode) {
    var path = [head];
    var pos = head, d = dir;
    var rem = reqs.slice();
    var guard = 0;
    while (rem.length && guard++ < 500) {
      var fwd = rem.filter(function (r) { return d > 0 ? r >= pos : r <= pos; })
        .sort(function (a, b) { return d > 0 ? a - b : b - a; });
      fwd.forEach(function (r) { path.push(r); pos = r; });
      rem = rem.filter(function (r) { return fwd.indexOf(r) < 0; });
      if (!rem.length) break;
      var edge = d > 0 ? MAX : 0;
      if (pos !== edge) path.push(edge);
      pos = edge;
      if (mode === 'scan') { d = -d; }
      else { var back = d > 0 ? 0 : MAX; if (pos !== back) path.push(back); pos = back; }
    }
    return path;
  }

  /**
   * 路径 → 分段：move（寻道并服务）/ turn（SCAN 端点掉头，竖线）/ jump（C-SCAN 空跑回跳，虚线对角）
   * row: 0 = 去程子行，1 = 回程子行
   */
  function toSegments(path, mode) {
    var segs = [], prevDir = 0, row = 0;
    for (var i = 1; i < path.length; i++) {
      var a = path[i - 1], b = path[i];
      if (a === b) continue;
      var d = Math.sign(b - a);
      var isJump = mode === 'cscan' && ((a === MAX && b === 0) || (a === 0 && b === MAX));
      if (isJump) {
        segs.push({ type: 'jump', from: a, to: b, row: 0, toRow: 1 });
        row = 1;                  // 跳回后进入回程子行；行进方向不变，prevDir 保持
      } else if (prevDir !== 0 && d !== prevDir) {
        segs.push({ type: 'turn', from: a, at: a, to: b, row: 0, toRow: 1 });
        segs.push({ type: 'move', from: a, to: b, row: 1 });
        row = 1; prevDir = d;
      } else {
        segs.push({ type: 'move', from: a, to: b, row: row });
        prevDir = d;
      }
    }
    return segs;
  }

  /** 服务序列文案：199 ↺ 37（SCAN 折返）/ 199 ⇢ 0（C-SCAN 回跳） */
  function pathText(path, segs) {
    var marker = {};
    segs.forEach(function (s) {
      if (s.type === 'turn') marker[path.indexOf(s.at) + 1] = '↺';
      if (s.type === 'jump') marker[path.indexOf(s.from) + 1] = '⇢';
    });
    var out = String(path[0]);
    for (var i = 1; i < path.length; i++) {
      out += (marker[i] ? ' ' + marker[i] + ' ' : ' → ') + path[i];
    }
    return out;
  }

  /* ══════════════════ 2. 运行期状态 ══════════════════ */

  var State = {
    isPlaying: false,
    speed: 1.0,
    groupIndex: 0,
    autoIntro: true
  };

  var master = null;   // 主时间轴
  var beats = [];      // { t, kind, state } —— render 的数据源
  var cursor = 0;      // 下一个 Beat 的绝对起点
  var meta = {};       // 阶段起点 / P4 计数拍 / 就绪时刻
  var data = null;     // 当前组的全部派生数据
  var cache = {};      // render 写入去重
  var ui = {};         // 元素句柄

  /* ══════════════════ 3. DOM 构建 ══════════════════ */

  function svgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function collectUi() {
    ui.stage = document.getElementById('stage-container');
    ui.rail = ui.stage.querySelector('.axis-rail');
    ui.head = document.getElementById('head');
    ui.headArrow = document.getElementById('head-arrow');
    ui.headCyl = document.getElementById('head-cyl');
    ui.flags = document.getElementById('flags');
    ui.queue = document.getElementById('queue');
    ui.trails = ui.stage.querySelector('.trails');
    ui.laneScan = ui.trails.querySelector('.trail-scan');
    ui.laneCscan = ui.trails.querySelector('.trail-cscan');
    ui.hudDir = document.getElementById('hud-dir');
    ui.hudDist = document.getElementById('hud-dist');
    ui.hudProgress = document.getElementById('hud-progress');
    ui.hudSeg = document.getElementById('hud-seg');
    ui.hudNext = document.getElementById('hud-next');
    ui.hudStep = document.getElementById('hud-step');
    ui.seqMeta = document.getElementById('seq-meta');
    ui.seqEmpty = document.getElementById('seq-empty');
    ui.seqScanList = document.getElementById('seq-scan');
    ui.seqCscanList = document.getElementById('seq-cscan');
    ui.queueMeta = document.getElementById('queue-meta');
    ui.groupLabel = document.getElementById('group-label');
    ui.dirBeam = document.getElementById('dir-beam');
    ui.hudCand = document.getElementById('hud-cand');
    ui.ghostLayer = document.getElementById('ghost-layer');
    ui.phaseBadges = Array.prototype.slice.call(document.querySelectorAll('.phase-badge'));
    ui.algoScan = document.getElementById('algo-scan');
    ui.algoCscan = document.getElementById('algo-cscan');
    ui.btnPlay = document.getElementById('btn-play');
    ui.btnPlayText = document.getElementById('btn-play-text');
    ui.btnPlayIcon = document.getElementById('btn-play-icon');
    ui.cmpNumScan = document.getElementById('cmp-num-scan');
    ui.cmpNumCscan = document.getElementById('cmp-num-cscan');
    ui.cmpDeltaNum = document.getElementById('cmp-delta-num');
    ui.cmpSeqScan = document.getElementById('cmp-seq-scan');
    ui.cmpSeqCscan = document.getElementById('cmp-seq-cscan');
    ui.capZero = document.getElementById('axis-cap-0');
    ui.cap199 = document.getElementById('axis-cap-199');
  }

  /** 按当前组重建：队列 chips / 请求旗帜 / 序列条目 / 飞行幽灵 / 轨迹线 / 文案 */
  function buildDom(group) {
    var reqs = group.reqs;
    var sorted = reqs.slice().sort(function (a, b) { return a - b; });

    // 队列 chips（保持题目给出的到达顺序）
    ui.queue.querySelectorAll('.chip').forEach(function (n) { n.remove(); });
    ui.chip = {};
    reqs.forEach(function (c) {
      var el = document.createElement('span');
      el.className = 'chip';
      el.dataset.cyl = c;
      el.textContent = c;
      ui.queue.appendChild(el);
      ui.chip[c] = el;
    });

    // 请求旗帜（外层只定位，内层承接动画）
    ui.flags.innerHTML = '';
    ui.flag = {};
    sorted.forEach(function (c) {
      var el = document.createElement('span');
      el.className = 'flag';
      el.dataset.cyl = c;
      el.style.left = xPct(c) + '%';
      el.innerHTML = '<span class="flag__body">' +
        '<span class="flag__label">' + c + '</span>' +
        '<span class="flag__dot"></span>' +
        '<span class="flag__stem"></span></span>';
      ui.flags.appendChild(el);
      ui.flag[c] = el;
    });

    // 距离徽标（方向内选取提示；位置与高低档由 layoutFlags 同步）
    ui.distChip = {};
    sorted.forEach(function (c) {
      var b = document.createElement('span');
      b.className = 'dist-chip';
      b.dataset.cyl = c;
      b.textContent = '+0';
      ui.flags.appendChild(b);
      ui.distChip[c] = b;
    });

    // 已服务序列（两轮各一套常驻元素，补间才可逆）
    ui.seqScanList.innerHTML = '';
    ui.seqCscanList.innerHTML = '';
    ui.seqScan = {}; ui.seqCscan = {};
    data.scanOrder.forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'seq-item';
      li.textContent = c;
      ui.seqScanList.appendChild(li);
      ui.seqScan[c] = li;
    });
    data.cscanOrder.forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'seq-item';
      li.textContent = c;
      ui.seqCscanList.appendChild(li);
      ui.seqCscan[c] = li;
    });

    // 飞行幽灵（每个磁道一个，两轮复用）
    ui.ghostLayer.innerHTML = '';
    ui.ghost = {};
    reqs.forEach(function (c) {
      var g = document.createElement('span');
      g.className = 'ghost';
      g.textContent = c;
      ui.ghostLayer.appendChild(g);
      ui.ghost[c] = g;
    });

    // 轨迹线：move / turn / jump 三种 line，靠 SVG 局部坐标随容器自适应
    ui.laneScan.innerHTML = '';
    ui.laneCscan.innerHTML = '';
    ui.trailLine = { scan: [], cscan: [] };
    ['scan', 'cscan'].forEach(function (run) {
      var lane = run === 'scan' ? ui.laneScan : ui.laneCscan;
      var rows = run === 'scan' ? SCAN_ROWS : CSCAN_ROWS;
      data[run + 'Segs'].forEach(function (seg) {
        var el;
        if (seg.type === 'move') {
          el = svgEl('line', { 'class': 'trail-seg', x1: tX(seg.from), y1: rows[seg.row], x2: tX(seg.from), y2: rows[seg.row] });
        } else if (seg.type === 'turn') {
          el = svgEl('line', { 'class': 'trail-turn', x1: tX(seg.at), y1: rows[0], x2: tX(seg.at), y2: rows[0] });
        } else {
          el = svgEl('line', { 'class': 'trail-dash', x1: tX(seg.from), y1: rows[0], x2: tX(seg.from), y2: rows[0] });
        }
        lane.appendChild(el);
        ui.trailLine[run].push({ seg: seg, el: el, rows: rows });
      });
    });

    // 文案
    ui.queueMeta.textContent = reqs.length + ' 个请求 · 磁道 0–' + MAX;
    ui.groupLabel.textContent = group.name;
    ui.cmpSeqScan.textContent = data.scanText;
    ui.cmpSeqCscan.textContent = data.cscanText;
  }

  /**
   * 旗帜布局：密簇合并 + 高低两档 + z-index 分层（设计方案 §2.4）
   * 纯布局函数，resize 后可重复调用，不触碰时间轴。
   */
  function layoutFlags() {
    if (!data) return;
    var W = ui.rail.clientWidth || 1;
    var px = function (c) { return (c / MAX) * W; };
    var LABEL_MIN = 26;   // 最小标签宽（px）

    var items = data.sorted.map(function (c) {
      var el = ui.flag[c];
      return { c: c, el: el, w: el.querySelector('.flag__label').offsetWidth || 26 };
    });

    // 1) 按像素间距贪心分簇
    var groups = [];
    items.forEach(function (it) {
      var g = groups[groups.length - 1];
      if (g && px(it.c) - px(g[g.length - 1].c) < LABEL_MIN) g.push(it);
      else groups.push([it]);
    });

    // 2) 清掉旧簇后重建（含簇徽标）
    ui.flags.querySelectorAll('.flag--range').forEach(function (n) { n.remove(); });
    ui.flags.querySelectorAll('.dist-chip--cluster').forEach(function (n) { n.remove(); });
    items.forEach(function (it) {
      it.el.classList.remove('is-in-cluster');
      if (ui.distChip[it.c]) ui.distChip[it.c].classList.remove('is-clustered');
    });
    data.cluster = null;

    var lowRight = -1e9, highRight = -1e9;
    groups.forEach(function (g) {
      if (g.length >= 3) {
        var c0 = g[0].c, c1 = g[g.length - 1].c;
        var center = (px(c0) + px(c1)) / 2;
        var span = Math.max(px(c1) - px(c0), 10);
        var el = document.createElement('span');
        el.className = 'flag flag--range';
        el.style.left = (center / W * 100) + '%';
        el.style.setProperty('--span-w', span.toFixed(1) + 'px');
        el.innerHTML = '<span class="flag__body">' +
          '<span class="flag__label">' + c0 + '–' + c1 + '</span>' +
          '<span class="cluster__bar"></span>' +
          '<span class="cluster__dots">' + new Array(g.length + 1).join('<i></i>') + '</span>' +
          '<span class="flag__stem"></span></span>';
        ui.flags.appendChild(el);
        // 密簇只出一个簇徽标（取簇内到磁头的最近距离）
        var cb = document.createElement('span');
        cb.className = 'dist-chip dist-chip--low dist-chip--cluster';
        cb.style.left = (center / W * 100) + '%';
        cb.textContent = '+0';
        ui.flags.appendChild(cb);
        data.cluster = { members: g.map(function (it) { return it.c; }), el: cb };
        g.forEach(function (it) {
          it.el.classList.add('is-in-cluster');
          if (ui.distChip[it.c]) ui.distChip[it.c].classList.add('is-clustered');
        });
        // 新簇与当前入场进度保持一致
        var ref = items[0].el.querySelector('.flag__body');
        gsap.set(el.querySelector('.flag__body'), { opacity: parseFloat(getComputedStyle(ref).opacity) || 0 });
      } else {
        // 单体：高低两档，同档间距 ≥ 标签宽 + 4px；跨档遮挡由 z-index 解决
        g.forEach(function (it) {
          var half = it.w / 2, x = px(it.c);
          var tier = 'low';
          if (x - half < lowRight + 4) tier = 'high';
          if (tier === 'high' && x - half < highRight + 4) tier = 'low';
          if (tier === 'low') lowRight = x + half; else highRight = x + half;
          it.el.classList.toggle('flag--low', tier === 'low');
          it.el.classList.toggle('flag--high', tier === 'high');
          var dchip = ui.distChip[it.c];
          if (dchip) {
            dchip.classList.toggle('dist-chip--low', tier === 'low');
            dchip.classList.toggle('dist-chip--high', tier === 'high');
          }
        });
      }
    });

    // 3) 写回位置（轨内百分比，resize 免疫）
    items.forEach(function (it) {
      var lp = xPct(it.c).toFixed(3) + '%';
      it.el.style.left = lp;
      if (ui.distChip[it.c]) ui.distChip[it.c].style.left = lp;
    });

    // 布局变了 → 选择提示的派生结果需要重算
    cache = {};
  }

  /* ══════════════════ 4. Beat 构建 ══════════════════ */

  function initState() {
    return {
      phase: 0, run: 'scan',
      dist: 0, distTo: 0,
      servedIdx: 0,
      target: null, seg: '待启动', next: '—',
      dir: DIR_START, head: HEAD_START, headFrom: HEAD_START, headTo: HEAD_START,
      skipping: false, done: false
    };
  }

  /**
   * 追加一个 Beat：状态快照在拍起点生效；build(t0) 排该拍补间（绝对时间偏移）；
   * dur = 拍窗（状态切换的节拍），次级动作可以溢出拍窗。
   */
  function beat(kind, build, patch, dur) {
    var t0 = cursor;
    if (patch) Object.keys(patch).forEach(function (k) { data.state[k] = patch[k]; });
    beats.push({ t: t0, kind: kind, state: Object.assign({}, data.state) });
    if (build) build(t0);
    cursor = t0 + dur;
    return beats[beats.length - 1];
  }
  function hold(d) {
    return function (t0) { master.to({}, { duration: d }, t0); };
  }

  /* —— P1 初始布景 —— */
  function addP1() {
    var m = master;

    beat('p1-axis', function (t0) {
      m.fromTo('.axis-line', { scaleX: 0 },
        { scaleX: 1, duration: 0.3, ease: 'expo.out', immediateRender: false }, t0);
      m.fromTo(['.tick', '.axis-cap', '.cap-label'], { opacity: 0 },
        { opacity: 1, duration: 0.25, ease: 'power1.out', stagger: 0.04, immediateRender: false }, t0);
    }, null, 0.3);

    // 含密簇元素在内的全部旗帜内层（密簇在 layoutFlags 动态创建，必须一并入场）
    var flagBodies = Array.prototype.slice.call(ui.flags.querySelectorAll('.flag__body'));
    var chips = data.reqs.map(function (c) { return ui.chip[c]; });
    beat('p1-in', function (t0) {
      m.fromTo(flagBodies, { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out', stagger: 0.06, immediateRender: false }, t0);
      m.fromTo(chips, { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out', stagger: 0.06, immediateRender: false }, t0);
    }, null, 0.28);

    beat('p1-head', function (t0) {
      m.fromTo('#head', { x: -140, opacity: 0, y: -4, scale: 1.06 },
        { x: 0, opacity: 1, y: -4, scale: 1.06, duration: 0.5, ease: 'power2.inOut', immediateRender: false }, t0);
      m.fromTo('#head-arrow', { scaleX: 0 },
        { scaleX: 1, duration: 0.3, ease: 'power2.out', immediateRender: false }, t0 + 0.2);
    }, { head: HEAD_START, headFrom: HEAD_START, headTo: HEAD_START }, 0.5);

    beat('p1-settle', function (t0) {
      m.fromTo('#head', { y: -4, scale: 1.06 },
        { y: 0, scale: 1, duration: 0.15, ease: 'back.out(1.3)', immediateRender: false }, t0);
      m.fromTo('#dot-halo', { scale: 0.4, opacity: 0.9 },
        { scale: 1.7, opacity: 0, duration: 0.4, ease: 'power2.out', immediateRender: false }, t0);
    }, null, 0.15);

    beat('p1-ready', function (t0) {
      m.fromTo(['.hud-row', '.dot-card__foot', '.controls'], { opacity: 0 },
        { opacity: 1, duration: 0.2, ease: 'power1.inOut', immediateRender: false }, t0);
      m.fromTo('.legend__item', { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.2, ease: 'power1.out', stagger: 0.04, immediateRender: false }, t0);
    }, null, 0.2);

    // 就绪时刻：落在 P1 最后一拍的拍窗内（否则会踩到 P2 第一拍的状态）
    meta.readyT = Math.max(0, cursor - 0.0005);
    meta.phaseStart = { 0: 0 };
  }

  /* —— 端点折返拍（SCAN）—— */
  function addTurnBeats(seg) {
    var m = master;
    var item = ui.trailLine.scan.find(function (t) { return t.seg === seg; });
    var line = item.el;
    var newDir = -data.state.dir;

    beat('turn-in', function (t0) {
      m.fromTo('#callout-turn', { opacity: 0, y: -6 },
        { opacity: 1, y: 0, duration: 0.2, ease: 'power1.out', immediateRender: false }, t0);
      m.fromTo('#axis-cap-199', { backgroundColor: '#FFFFFF' },
        { backgroundColor: '#D97706', duration: 0.35, ease: 'power2.out', immediateRender: false }, t0);
    }, { target: null, next: '—', head: seg.at }, 0.2);

    beat('turn-flip', function (t0) {
      m.fromTo('#head-arrow', { rotationY: 0 },
        { rotationY: 180, duration: 0.2, ease: 'expo.out', immediateRender: false }, t0);
      m.fromTo('#hud-dir', { rotationY: -90 },
        { rotationY: 0, duration: 0.3, ease: 'power4.out', immediateRender: false }, t0);
      m.fromTo(line, { attr: { y2: item.rows[0] } },
        { attr: { y2: item.rows[1] }, duration: 0.2, ease: 'none', immediateRender: false }, t0);
    }, { dir: newDir, headFrom: seg.at, headTo: seg.at }, 0.2);

    beat('turn-hold', hold(0.2), null, 0.2);

    beat('turn-out', function (t0) {
      m.fromTo('#callout-turn', { opacity: 1, y: 0 },
        { opacity: 0, y: -6, duration: 0.2, ease: 'power2.in', immediateRender: false }, t0);
    }, null, 0.2);

    beat('turn-resume', hold(0.2), null, 0.2);
  }

  /* —— 空跑回跳拍（C-SCAN）—— */
  function addJumpBeats(seg) {
    var m = master;
    var item = ui.trailLine.cscan.find(function (t) { return t.seg === seg; });
    var line = item.el;
    var d = Math.abs(seg.to - seg.from);

    beat('jump-in', function (t0) {
      m.fromTo('#callout-jump', { opacity: 0, y: -6 },
        { opacity: 1, y: 0, duration: 0.2, ease: 'power1.out', immediateRender: false }, t0);
      m.fromTo('#axis-cap-199', { backgroundColor: '#FFFFFF' },
        { backgroundColor: '#D97706', duration: 0.35, ease: 'power2.out', immediateRender: false }, t0);
    }, { target: null, head: seg.from }, 0.2);

    beat('jump-anticipate', function (t0) {
      m.fromTo('#head', { y: 0, scale: 1 },
        { y: -6, scale: 1.08, duration: 0.2, ease: 'power1.out', immediateRender: false }, t0);
    }, { next: seg.from + ' → ' + seg.to + ' (' + d + '，空跑)', headFrom: seg.from, headTo: seg.to }, 0.2);

    beat('jump-move', function (t0) {
      m.fromTo('#head', { left: xPct(seg.from) + '%' },
        { left: xPct(seg.to) + '%', duration: 1.05, ease: 'none', immediateRender: false }, t0);
      m.fromTo(line, { attr: { x2: tX(seg.from), y2: item.rows[0] } },
        { attr: { x2: tX(seg.to), y2: item.rows[1] }, duration: 1.05, ease: 'none', immediateRender: false }, t0);
    }, {
      dist: data.state.dist, distTo: data.state.dist + d,
      seg: seg.from + ' → ' + seg.to + '（空跑）',
      skipping: true
    }, 1.05);

    beat('jump-land', function (t0) {
      m.fromTo('#head', { y: -6, scale: 1.08 },
        { y: 0, scale: 1, duration: 0.18, ease: 'back.out(1.2)', immediateRender: false }, t0);
      m.fromTo('#callout-jump', { opacity: 1, y: 0 },
        { opacity: 0, y: -6, duration: 0.2, ease: 'power2.in', immediateRender: false }, t0);
      m.fromTo('#axis-cap-0', { backgroundColor: '#FFFFFF' },
        { backgroundColor: '#A8A29E', duration: 0.4, ease: 'power2.out', immediateRender: false }, t0);
    }, {
      dist: data.state.dist + d, head: seg.to, headFrom: seg.to, headTo: seg.to,
      skipping: false, next: '—'
    }, 0.2);

    beat('jump-confirm', hold(0.2), null, 0.2);
  }

  /* —— 服务一个请求的 5-Beat 主循环 —— */
  function addServiceBeats(seg, run, orderIdx, fadeSel) {
    var m = master;
    var serves = data.reqs.indexOf(seg.to) >= 0;
    var d = Math.abs(seg.to - seg.from);
    var dur = moveDur(d);
    var line = ui.trailLine[run].find(function (t) { return t.seg === seg; }).el;

    if (serves) {
      // 01 上下文建立：目标 chip 点亮（render 类 + CSS 过渡）
      beat('svc-target', function (t0) {
        if (fadeSel) {
          m.fromTo(fadeSel, { opacity: 1, y: 0 },
            { opacity: 0, y: -6, duration: 0.2, ease: 'power2.in', immediateRender: false }, t0);
        }
        hold(0.2)(t0);
      }, { target: seg.to }, 0.2);
    }

    // 02 产生预期
    beat('svc-anticipate', function (t0) {
      m.fromTo('#head', { y: 0, scale: 1 },
        { y: -4, scale: 1.05, duration: 0.15, ease: 'power1.out', immediateRender: false }, t0);
    }, { next: seg.from + ' → ' + seg.to + ' (' + d + ')', headFrom: seg.from, headTo: seg.to }, 0.15);

    // 03 核心动作：匀速寻道，轨迹与计数同步生长
    beat('svc-move', function (t0) {
      m.fromTo('#head', { left: xPct(seg.from) + '%' },
        { left: xPct(seg.to) + '%', duration: dur, ease: 'none', immediateRender: false }, t0);
      m.fromTo(line, { attr: { x2: tX(seg.from) } },
        { attr: { x2: tX(seg.to) }, duration: dur, ease: 'none', immediateRender: false }, t0);
    }, {
      dist: data.state.dist, distTo: data.state.dist + d,
      seg: seg.from + ' → ' + seg.to, headFrom: seg.from, headTo: seg.to
    }, dur);

    if (!serves) {   // 端点扫掠：只走不服务
      beat('svc-pass', function (t0) {
        master.fromTo('#head', { y: -4, scale: 1.05 },
          { y: 0, scale: 1, duration: 0.18, ease: 'back.out(1.2)', immediateRender: false }, t0);
      }, { dist: data.state.dist + d, head: seg.to, next: '—' }, 0.18);
      return;
    }

    // 04 落位沉淀：磁头回位 + 幽灵弧线飞入序列 + 旗帜变实心
    var ghost = ui.ghost[seg.to];
    var chip = ui.chip[seg.to];
    var flag = ui.flag[seg.to];
    var seqItem = run === 'scan' ? ui.seqScan[seg.to] : ui.seqCscan[seg.to];
    beat('svc-land', function (t0) {
      m.fromTo('#head', { y: -4, scale: 1.05 },
        { y: 0, scale: 1, duration: 0.18, ease: 'back.out(1.2)', immediateRender: false }, t0);
      // x 匀速 + y 加速 = 上弓弧线
      m.fromTo(ghost,
        { x: function () { return ui.chip[seg.to].getBoundingClientRect().left; } },
        { x: function () { return seqGhostX(run, seg.to); }, duration: 0.32, ease: 'none', immediateRender: false }, t0 + 0.05);
      m.fromTo(ghost,
        { y: function () { return ui.chip[seg.to].getBoundingClientRect().top; }, scale: 1 },
        { y: function () { return seqGhostY(run, seg.to); }, scale: 0.7, duration: 0.32, ease: 'power2.in', immediateRender: false }, t0 + 0.05);
      m.fromTo(ghost, { opacity: 1 },
        { opacity: 0, duration: 0.12, immediateRender: false }, t0 + 0.25);
      m.fromTo(chip, { opacity: 1 },
        { opacity: 0.35, duration: 0.32, ease: 'power2.inOut', immediateRender: false }, t0);
      m.fromTo(flag.querySelector('.flag__dot'), { backgroundColor: '#FFFFFF' },
        { backgroundColor: '#2563EB', duration: 0.3, ease: 'power2.out', immediateRender: false }, t0);
      m.fromTo(flag.querySelector('.flag__label'), { opacity: 1 },
        { opacity: 0.45, duration: 0.3, ease: 'power2.out', immediateRender: false }, t0);
    }, {
      servedIdx: orderIdx + 1, dist: data.state.dist + d,
      head: seg.to, headFrom: seg.to, headTo: seg.to, target: null, next: '—'
    }, 0.37);

    // 05 状态确认：序列入列 + 进度翻牌
    beat('svc-confirm', function (t0) {
      m.fromTo(seqItem, { opacity: 0, x: -8 },
        { opacity: 1, x: 0, duration: 0.2, ease: 'power1.inOut', immediateRender: false }, t0);
    }, null, 0.2);
  }

  /** 幽灵落点：裁进可见的序列列表区域，避免飞出可视范围 */
  function seqGhostX(run, cyl) {
    var list = run === 'scan' ? ui.seqScanList : ui.seqCscanList;
    var item = run === 'scan' ? ui.seqScan[cyl] : ui.seqCscan[cyl];
    var lr = list.getBoundingClientRect(), ir = item.getBoundingClientRect();
    var min = lr.left + 2, max = Math.max(min, lr.right - ir.width - 2);
    return Math.min(Math.max(ir.left, min), max);
  }
  function seqGhostY(run, cyl) {
    var list = run === 'scan' ? ui.seqScanList : ui.seqCscanList;
    var item = run === 'scan' ? ui.seqScan[cyl] : ui.seqCscan[cyl];
    var lr = list.getBoundingClientRect(), ir = item.getBoundingClientRect();
    var min = lr.top + 2, max = Math.max(min, lr.bottom - ir.height - 2);
    return Math.min(Math.max(ir.top, min), max);
  }

  /* —— 一轮算法（P2 / P3）—— */
  function addRun(run, phaseIdx) {
    var segs = data[run + 'Segs'];
    var order = data[run + 'Order'];
    var fadeCallout = null;

    if (meta.phaseStart[phaseIdx] === undefined) meta.phaseStart[phaseIdx] = cursor;

    segs.forEach(function (seg) {
      if (seg.type === 'move') {
        addServiceBeats(seg, run, order.indexOf(seg.to), fadeCallout);
        fadeCallout = null;
      } else if (seg.type === 'turn') {
        addTurnBeats(seg);
      } else {
        addJumpBeats(seg);
        fadeCallout = '#callout-jump';   // 紧跟的下一个服务拍顺带回跳 callout
      }
    });

    // 收尾：该泳道全线提亮定格
    var laneSel = run === 'scan' ? '.trail-scan' : '.trail-cscan';
    beat('run-finish', function (t0) {
      mFinish(t0, laneSel);
    }, { target: null, done: true }, 0.4);
  }
  function mFinish(t0, laneSel) {
    master.fromTo(laneSel, { opacity: 0.55 },
      { opacity: 1, duration: 0.4, ease: 'power2.out', immediateRender: false }, t0);
  }

  /* —— P2 → P3 的 3 阶段管线（Outro → Pivot → Intro）—— */
  function addTransition() {
    var m = master;
    if (meta.phaseStart[2] === undefined) meta.phaseStart[2] = cursor;

    // Outro：P2 结果层退场、SCAN 泳道降权
    beat('trans-outro', function (t0) {
      m.fromTo(ui.seqScanList.querySelectorAll('.seq-item'), { opacity: 1, y: 0 },
        { opacity: 0, y: -6, duration: 0.2, ease: 'power2.in', immediateRender: false }, t0);
      m.fromTo('.trail-scan', { opacity: 1 },
        { opacity: 0.45, duration: 0.2, ease: 'power2.in', immediateRender: false }, t0);
    }, { phase: 2, target: null, done: false }, 0.2);

    // Pivot：算法徽牌 Y 轴翻转 + 复位 callout 登场
    beat('trans-pivot', function (t0) {
      m.fromTo(['#algo-scan', '#algo-cscan'], { rotationY: 0 },
        { rotationY: 90, duration: 0.15, ease: 'power2.in', immediateRender: false }, t0);
      m.fromTo(['#algo-scan', '#algo-cscan'], { rotationY: -90 },
        { rotationY: 0, duration: 0.15, ease: 'expo.out', immediateRender: false }, t0 + 0.15);
      m.fromTo('#callout-pivot', { opacity: 0, y: -6 },
        { opacity: 1, y: 0, duration: 0.2, ease: 'power1.out', immediateRender: false }, t0 + 0.1);
    }, { run: 'cscan' }, 0.3);

    // Intro：磁头复位、队列与旗帜恢复、仪表清零（零回弹）
    beat('trans-intro', function (t0) {
      m.fromTo('#head', { left: xPct(data.scanEnd) + '%' },
        { left: xPct(HEAD_START) + '%', duration: 0.4, ease: 'power4.out', immediateRender: false }, t0);
      m.fromTo(data.reqs.map(function (c) { return ui.chip[c]; }), { opacity: 0.35 },
        { opacity: 1, duration: 0.4, ease: 'power4.out', stagger: 0.02, immediateRender: false }, t0);
      data.reqs.forEach(function (c) {
        m.fromTo(ui.flag[c].querySelector('.flag__dot'), { backgroundColor: '#2563EB' },
          { backgroundColor: '#FFFFFF', duration: 0.4, ease: 'power4.out', immediateRender: false }, t0);
        m.fromTo(ui.flag[c].querySelector('.flag__label'), { opacity: 0.45 },
          { opacity: 1, duration: 0.4, ease: 'power4.out', immediateRender: false }, t0);
      });
      m.fromTo('#head-arrow', { rotationY: 180 },
        { rotationY: 0, duration: 0.3, ease: 'power4.out', immediateRender: false }, t0 + 0.1);
      m.fromTo('#callout-pivot', { opacity: 1, y: 0 },
        { opacity: 0, y: -6, duration: 0.2, ease: 'power2.in', immediateRender: false }, t0 + 0.25);
    }, {
      dist: 0, distTo: 0, servedIdx: 0, target: null,
      seg: '待启动', next: '—', head: HEAD_START, headFrom: HEAD_START, headTo: HEAD_START,
      dir: DIR_START, skipping: false, done: false
    }, 0.4);
  }

  /* —— P4 对比总结 —— */
  function addP4() {
    var m = master;
    meta.phaseStart[3] = cursor;

    // 01 上下文建立：两条泳道提亮平铺 + 之字/锯齿标签登场
    beat('cmp-context', function (t0) {
      m.fromTo('.trail-scan', { opacity: 0.45 },
        { opacity: 1, duration: 0.4, ease: 'expo.out', immediateRender: false }, t0);
      m.fromTo('.trail-tag', { opacity: 0, scale: 0.92 },
        { opacity: 1, scale: 1, duration: 0.4, ease: 'expo.out', stagger: 0.06, immediateRender: false }, t0);
    }, { phase: 3, target: null }, 0.4);

    // 02 产生预期：两侧距离与服务序列展开
    beat('cmp-rows', function (t0) {
      m.fromTo(['.cmp-dist', '.cmp-seq'], { opacity: 0, y: -6 },
        { opacity: 1, y: 0, duration: 0.2, ease: 'power1.out', stagger: 0.04, immediateRender: false }, t0);
    }, null, 0.2);

    // 03 核心动作：总寻道 countup（render 以 power2.out 推导）+ 中缝 Δ 徽章生长
    beat('cmp-count', function (t0) {
      m.fromTo('#cmp-delta', { opacity: 0, scale: 0.7 },
        { opacity: 1, scale: 1, duration: 0.4, ease: 'power2.out', immediateRender: false }, t0);
    }, null, 0.9);
    meta.p4CountIdx = beats.length - 1;

    // 04 落位沉淀
    beat('cmp-settle', function (t0) {
      m.fromTo('#cmp-delta', { scale: 0.8 },
        { scale: 1, duration: 0.18, ease: 'back.out(1.3)', immediateRender: false }, t0);
    }, null, 0.18);

    // 05 状态确认：认知目标原句
    beat('cmp-conclusion', function (t0) {
      m.fromTo('#conclusion', { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.3, ease: 'power1.inOut', immediateRender: false }, t0);
    }, { done: true }, 0.3);

    // 保证时间轴长度覆盖到最后一个拍窗
    master.to({}, { duration: 0.001 }, cursor);
  }

  /* ══════════════════ 5. 时间 → 界面（纯函数，可倒带） ══════════════════ */

  function put(key, value, apply) {
    if (cache[key] === value) return;
    cache[key] = value;
    apply(value);
  }

  function beatIndexAt(t) {
    var lo = 0, hi = beats.length - 1, i = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (beats[mid].t <= t + 1e-6) { i = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return i;
  }

  function render(t) {
    if (!beats.length || !data) return;
    var i = beatIndexAt(t);
    var b = beats[i], nx = beats[i + 1];
    var win = nx ? nx.t - b.t : 0;
    var p = win > 1e-6 ? clamp01((t - b.t) / win) : 1;
    var st = b.state;
    var moving = b.kind === 'svc-move' || b.kind === 'jump-move';

    // 移动拍内按时间线性插值（磁头匀速，距离∝时间）
    var dist = moving ? Math.round(st.dist + (st.distTo - st.dist) * p) : st.dist;
    var head = moving ? Math.round(st.headFrom + (st.headTo - st.headFrom) * p) : st.head;

    put('dist', dist, function (v) { ui.hudDist.textContent = v; });
    put('head', head, function (v) { ui.headCyl.textContent = v; });
    put('dir', st.dir, function (v) { ui.hudDir.innerHTML = v > 0 ? '&rarr;' : '&larr;'; });
    put('seg', st.seg, function (v) { ui.hudSeg.textContent = v; });
    put('next', st.next, function (v) { ui.hudNext.textContent = v; });
    put('step', i, function (v) { ui.hudStep.textContent = 'STEP #' + (v < 10 ? '0' + v : v); });
    put('progress', st.servedIdx + '/' + data.reqs.length, function (v) {
      var txt = v.replace('/', ' / ');
      ui.hudProgress.textContent = txt;
      ui.seqMeta.textContent = txt;
    });
    put('phase', st.phase, function (v) {
      ui.phaseBadges.forEach(function (el, k) { el.classList.toggle('is-active', k === v); });
    });
    put('run', st.run, function (v) {
      ui.algoScan.classList.toggle('is-active', v === 'scan');
      ui.algoCscan.classList.toggle('is-active', v !== 'scan');
      ui.seqScanList.hidden = v !== 'scan';
      ui.seqCscanList.hidden = v === 'scan';
    });
    put('target', st.target, function (v) {
      data.reqs.forEach(function (c) { ui.chip[c].classList.toggle('is-next', c === v); });
    });

    // 已服务集合：按当前轮服务顺序取前 n 个
    var order = st.run === 'scan' ? data.scanOrder : data.cscanOrder;
    var served = order.slice(0, st.servedIdx);
    put('servedSet', st.run + ':' + st.servedIdx, function () {
      data.reqs.forEach(function (c) { ui.chip[c].classList.toggle('is-served', served.indexOf(c) >= 0); });
      ui.seqEmpty.hidden = st.servedIdx > 0;
      if (st.servedIdx > 0) {
        var list = st.run === 'scan' ? ui.seqScanList : ui.seqCscanList;
        list.scrollLeft = list.scrollWidth;
      }
    });

    // ── 方向内「最近」选取提示（候选 = 未服务 && 在当前方向前方；全部由时间推导）──
    var unservedList = data.reqs.filter(function (c) { return served.indexOf(c) < 0; });
    var candList = unservedList.filter(function (c) { return st.dir > 0 ? c >= st.head : c <= st.head; });
    var cluster = data.cluster;
    var inCl = function (c) { return !!cluster && cluster.members.indexOf(c) >= 0; };
    var entries = [];
    candList.forEach(function (c) { if (!inCl(c)) entries.push({ cyl: c, dist: Math.abs(c - st.head) }); });
    if (cluster) {
      var cm = cluster.members.filter(function (c) { return candList.indexOf(c) >= 0; });
      if (cm.length) {
        var dmin = Infinity;
        cm.forEach(function (c) { dmin = Math.min(dmin, Math.abs(c - st.head)); });
        entries.push({ cyl: -1, cluster: true, dist: dmin });
      }
    }
    var minDist = null;
    entries.forEach(function (e) { if (minDist === null || e.dist < minDist) minDist = e.dist; });
    var showSel = b.kind === 'svc-target' || b.kind === 'svc-anticipate';
    var resolving = showSel && b.kind === 'svc-anticipate';

    put('sel', [b.kind, st.dir, st.head, st.servedIdx, minDist, entries.length].join('|'), function () {
      var byCyl = {};
      entries.forEach(function (e) { if (!e.cluster) byCyl[e.cyl] = e; });
      // 错峰：按到磁头的距离由近及远依次亮起
      var ranked = entries.slice().sort(function (a, b2) { return a.dist - b2.dist; });
      var rank = {};
      ranked.forEach(function (e, i) { rank[e.cluster ? 'cl' : e.cyl] = i; });
      data.reqs.forEach(function (c) {
        var el = ui.distChip[c];
        if (!el) return;
        var e = byCyl[c];
        var on = showSel && !!e;
        el.classList.toggle('is-on', on);
        el.classList.toggle('is-min', !!(on && resolving && e.dist === minDist));
        el.classList.toggle('is-far', !!(on && resolving && e.dist !== minDist));
        el.style.transitionDelay = on ? ((resolving ? 0 : rank[c]) * 0.02).toFixed(2) + 's' : '0s';
        if (e) el.textContent = '+' + e.dist;
      });
      if (cluster && cluster.el) {
        var ec = entries.filter(function (e) { return e.cluster; })[0];
        var onc = showSel && !!ec;
        cluster.el.classList.toggle('is-on', onc);
        cluster.el.classList.toggle('is-min', !!(onc && resolving && ec.dist === minDist));
        cluster.el.classList.toggle('is-far', !!(onc && resolving && ec.dist !== minDist));
        cluster.el.style.transitionDelay = onc ? ((resolving ? 0 : rank['cl']) * 0.02).toFixed(2) + 's' : '0s';
        if (ec) cluster.el.textContent = '+' + ec.dist;
      }
      // 方向扫描窗：从磁头射向方向端点
      ui.dirBeam.classList.toggle('is-on', showSel);
      ui.dirBeam.classList.toggle('to-right', st.dir > 0);
      ui.dirBeam.classList.toggle('to-left', st.dir <= 0);
      if (showSel) {
        var hp = xPct(st.head), end = st.dir > 0 ? 100 : 0;
        ui.dirBeam.style.left = Math.min(hp, end).toFixed(3) + '%';
        ui.dirBeam.style.width = Math.abs(end - hp).toFixed(3) + '%';
        ui.dirBeam.style.transformOrigin = (st.dir > 0 ? '0%' : '100%') + ' 50%';
      }
      // 方向之外的整体降权
      data.reqs.forEach(function (c) {
        ui.flag[c].classList.toggle('is-outside', served.indexOf(c) < 0 && candList.indexOf(c) < 0);
      });
      // HUD：方向内候选
      ui.hudCand.textContent = unservedList.length === 0 ? '—'
        : (candList.length === 0 ? '前方无请求 → 扫到端点'
          : candList.length + ' 个 · 最近 +' + minDist);
    });

    // C-SCAN 空跑：途经的未服务请求变灰（此趟不服务）
    put('skip', st.skipping, function (v) {
      var served = order.slice(0, st.servedIdx);
      data.reqs.forEach(function (c) {
        ui.flag[c].classList.toggle('is-skipped', !!v && served.indexOf(c) < 0);
      });
    });

    // P4 计数（power2.out，与规格表一致）
    var scanN = data.scanDist, cscanN = data.cscanDist, dN = Math.abs(cscanN - scanN);
    var cnt = 0;
    if (meta.p4CountIdx !== undefined) {
      if (i < meta.p4CountIdx) cnt = 0;
      else if (i === meta.p4CountIdx) cnt = 1 - (1 - p) * (1 - p);
      else cnt = 1;
    }
    put('cnt', Math.round(scanN * cnt) + '|' + i, function () {
      ui.cmpNumScan.textContent = Math.round(scanN * cnt);
      ui.cmpNumCscan.textContent = Math.round(cscanN * cnt);
      ui.cmpDeltaNum.textContent = Math.round(dN * cnt);
    });
  }

  function updatePlayBtn() {
    if (!master) return;
    var atEnd = master.time() >= master.duration() - 0.002;
    var text = State.isPlaying ? '暂停演进' : (atEnd ? '↺ 重放对比' : '自动演进');
    var icon = State.isPlaying ? '⏸' : '▶';
    put('btnText', text, function (v) { ui.btnPlayText.textContent = v; });
    put('btnIcon', icon, function (v) { ui.btnPlayIcon.textContent = v; });
  }

  /* ══════════════════ 6. 构建 / 控制 ══════════════════ */

  function deriveData(group) {
    var sorted = group.reqs.slice().sort(function (a, b) { return a - b; });
    var scanPath = sweepPath(HEAD_START, DIR_START, group.reqs, 'scan');
    var cscanPath = sweepPath(HEAD_START, DIR_START, group.reqs, 'cscan');
    var scanSegs = toSegments(scanPath, 'scan');
    var cscanSegs = toSegments(cscanPath, 'cscan');
    var dist = function (p) {
      var s = 0;
      for (var i = 1; i < p.length; i++) s += Math.abs(p[i] - p[i - 1]);
      return s;
    };
    return {
      group: group, reqs: group.reqs, sorted: sorted,
      scanPath: scanPath, cscanPath: cscanPath,
      scanSegs: scanSegs, cscanSegs: cscanSegs,
      scanOrder: scanPath.filter(function (c, i) { return i > 0 && group.reqs.indexOf(c) >= 0; }),
      cscanOrder: cscanPath.filter(function (c, i) { return i > 0 && group.reqs.indexOf(c) >= 0; }),
      scanText: pathText(scanPath, scanSegs),
      cscanText: pathText(cscanPath, cscanSegs),
      scanDist: dist(scanPath), cscanDist: dist(cscanPath),
      scanEnd: scanPath[scanPath.length - 1],
      state: initState()
    };
  }

  /** 时间轴初始态：所有会被补间触碰的属性都在这里归零/定位 */
  function setInitialDom() {
    gsap.set('.axis-line', { scaleX: 0 });
    gsap.set(['.tick', '.axis-cap', '.cap-label'], { opacity: 0 });
    gsap.set('.flag__body', { opacity: 0 });
    gsap.set('.chip', { opacity: 0 });
    gsap.set('#head', { x: -140, y: 0, scale: 1, opacity: 0, left: xPct(HEAD_START) + '%' });
    gsap.set('#head-arrow', { scaleX: 0, rotationY: 0 });
    gsap.set(['.hud-row', '.dot-card__foot', '.controls'], { opacity: 0 });
    gsap.set('.legend__item', { opacity: 0 });
    gsap.set('.trail-tag', { opacity: 0 });
    gsap.set(['.cmp-dist', '.cmp-seq', '#cmp-delta', '#conclusion'], { opacity: 0, scale: 1, y: 0 });
    gsap.set('.ghost', { opacity: 0, x: 0, y: 0, scale: 1 });
    gsap.set(['#callout-turn', '#callout-jump', '#callout-pivot'], { opacity: 0, y: -6 });
    gsap.set('.seq-item', { opacity: 0 });
    gsap.set(['.trail-scan', '.trail-cscan'], { opacity: 1 });
    gsap.set(['#algo-scan', '#algo-cscan'], { rotationY: 0 });
    gsap.set('#hud-dir', { rotationY: 0 });
    gsap.set('#axis-cap-199', { backgroundColor: '#D97706' });
    gsap.set('#axis-cap-0', { backgroundColor: '#A8A29E' });
    gsap.set('#dot-halo', { scale: 0.4, opacity: 0 });
  }

  function build() {
    data = deriveData(GROUPS[State.groupIndex]);
    buildDom(GROUPS[State.groupIndex]);
    layoutFlags();

    if (master) master.kill();
    gsap.killTweensOf('*');           // 铁律：重建前彻底清理前序补间
    setInitialDom();

    beats = [];
    cursor = 0;
    cache = {};
    meta = { phaseStart: {} };

    master = gsap.timeline({
      paused: true,
      onComplete: function () {          // 播到结尾交回「↺ 重放对比」
        State.isPlaying = false;
        render(master.time());
        updatePlayBtn();
      },
      onUpdate: function () {
        if (State.isPlaying && master.time() >= master.duration() - 0.002) {
          State.isPlaying = false;
        }
        render(master.time());
        updatePlayBtn();
        // 开场自动播完 P1 布景后交回用户控制（不使用 setInterval 控制动画）
        if (State.autoIntro && master.time() >= meta.readyT - 0.002) {
          State.autoIntro = false;
          State.isPlaying = false;
          master.pause(meta.readyT);
          render(meta.readyT);
          updatePlayBtn();
        }
      }
    });

    addP1();
    data.state.phase = 1;
    addRun('scan', 1);
    addTransition();
    addRun('cscan', 2);
    addP4();

    render(0);
    updatePlayBtn();
  }

  /** seek 后必须手动 render：gsap.seek() 默认不派发 onUpdate */
  function seekTo(t) {
    master.seek(t);
    render(master.time());
    updatePlayBtn();
  }

  function loadGroup(idx) {
    pause();
    State.groupIndex = (idx + GROUPS.length) % GROUPS.length;
    State.autoIntro = false;
    build();
    seekTo(meta.readyT);
  }

  /* —— 控制器 —— */
  function play() {
    if (!master) return;
    State.autoIntro = false;
    if (master.time() >= master.duration() - 0.002) seekTo(0);
    State.isPlaying = true;
    master.timeScale(State.speed);
    master.play();
    updatePlayBtn();
  }
  function pause() {
    State.isPlaying = false;
    if (master) master.pause();
    updatePlayBtn();
  }
  function toggle() { State.isPlaying ? pause() : play(); }

  function step(dir) {
    State.autoIntro = false;
    pause();
    var i = beatIndexAt(master.time());
    var j = Math.min(Math.max(i + (dir > 0 ? 1 : -1), 0), beats.length - 1);
    seekTo(beats[j].t);
  }

  function reset() {
    State.autoIntro = false;
    pause();
    gsap.killTweensOf('.ghost, #ghost-layer *');   // 铁律：复位前清理幽灵残留
    seekTo(meta.readyT);
  }

  function gotoPhase(p) {
    State.autoIntro = false;
    pause();
    seekTo(meta.phaseStart[p] || 0);
    play();
  }

  function setSpeed(v) {
    State.speed = v;
    if (master) master.timeScale(v);
    var el = document.getElementById('label-speed');
    if (el) el.textContent = v.toFixed(1) + 'x';
  }

  /* ══════════════════ 7. 初始化 ══════════════════ */

  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);        // 仅用于布局防抖，不驱动动画
    resizeTimer = setTimeout(function () {
      if (!data) return;
      layoutFlags();
      if (master) render(master.time());
    }, 150);
  }

  function bind() {
    ui.btnPlay.addEventListener('click', toggle);
    document.getElementById('btn-prev').addEventListener('click', function () { step(-1); });
    document.getElementById('btn-next').addEventListener('click', function () { step(1); });
    document.getElementById('btn-reset').addEventListener('click', reset);
    document.getElementById('btn-group').addEventListener('click', function () {
      loadGroup(State.groupIndex + 1);
    });
    document.getElementById('slider-speed').addEventListener('input', function (e) {
      setSpeed(parseFloat(e.target.value));
    });
    ui.phaseBadges.forEach(function (el) {
      el.addEventListener('click', function () { gotoPhase(parseInt(el.dataset.phase, 10)); });
    });
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
      else if (e.key === ' ') { toggle(); e.preventDefault(); }
    });
  }

  function init() {
    collectUi();
    build();
    bind();

    // 开场自动播一遍 P1 布景
    master.seek(0);
    State.isPlaying = true;
    master.timeScale(State.speed);
    master.play();
    updatePlayBtn();

    console.log('🚀 [磁盘调度SCAN与C-SCAN] 时间轴就绪：' + beats.length + ' 拍 · ' +
      'SCAN ' + data.scanDist + ' 柱道 / C-SCAN ' + data.cscanDist + ' 柱道 · 组 ' + GROUPS[State.groupIndex].key);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
