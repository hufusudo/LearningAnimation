/**
 * 文件索引寻道与缓冲写回 · 核心交互逻辑与动效状态机
 *
 * 四栏贯通：目录树(用户态) → 进程 fd 表(PCB) → 内核工作区(常驻区/系统表/Buffer Pool) → 外存磁盘阵列
 * 四个阶段：① 目录逐级定位 ② 双进程打开与引用计数 ③ 多级索引寻道 ④ 修改·改一变二·刷盘写回
 */
(function () {
  'use strict';

  /* ══════════════════ 0. 基础工具 ══════════════════ */
  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ABORT = 'ABORT';

  const RUN = { token: 0, speed: 1, busy: false };

  /** 阶段性里程碑（驱动按钮可用态与阶段胶囊） */
  const F = { located: false, indexed: false, modified: false, verified: false, flushed: false };

  function check(token) { if (token !== RUN.token) { const e = new Error(ABORT); e.abort = true; throw e; } }
  const isAbort = (e) => e && (e.abort || e.message === ABORT);

  /** 速度自适应休眠：duration / speed */
  function sleep(ms, token) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (token !== RUN.token) { const e = new Error(ABORT); e.abort = true; reject(e); return; }
        resolve();
      }, Math.max(16, ms / RUN.speed));
    });
  }

  /** 60fps rAF 补间，token 失效立即中止（防呆铁律 1：竞态清理） */
  function anim(duration, onUpdate, token) {
    return new Promise((resolve, reject) => {
      const dur = Math.max(1, duration / RUN.speed);
      const t0 = performance.now();
      const frame = (now) => {
        if (token !== RUN.token) { const e = new Error(ABORT); e.abort = true; reject(e); return; }
        const p = Math.min(1, (now - t0) / dur);
        onUpdate(p);
        if (p < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  function popIn(el) {
    if (window.gsap) {
      gsap.fromTo(el, { scale: 0.55, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(2.2)' });
    }
  }

  /* ══════════════════ 1. 叠加特效层（探针 / 引线 / 光束） ══════════════════ */
  const svg = $('fx');
  const ws = $('workspace');
  const leaders = [];

  function mk(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function rectIn(el) {
    const a = el.getBoundingClientRect(), b = ws.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  }
  function anchor(el, side) {
    const r = rectIn(el);
    switch (side) {
      case 'l': return { x: r.x, y: r.y + r.h / 2 };
      case 'r': return { x: r.x + r.w, y: r.y + r.h / 2 };
      case 't': return { x: r.x + r.w / 2, y: r.y };
      case 'b': return { x: r.x + r.w / 2, y: r.y + r.h };
      default: return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }
  }
  /** 依据两元素的相对方位自动选边：横排走左右，纵排走上下 */
  function pickSides(e1, e2) {
    const a = rectIn(e1), b = rectIn(e2);
    if (b.x >= a.x + a.w - 6) return ['r', 'l'];
    if (a.x >= b.x + b.w - 6) return ['l', 'r'];
    if (b.y >= a.y + a.h - 6) return ['b', 't'];
    return ['t', 'b'];
  }
  function ctrl(a, b, lift) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
      ? { x: mx, y: my + lift }      // 水平为主：上下起拱
      : { x: mx - lift, y: my };     // 垂直为主：左右起拱
  }
  function segPath(a, b, lift) {
    const c = ctrl(a, b, lift);
    return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }
  function fadeOut(el, ms) {
    el.style.transition = `opacity ${ms}ms ease`;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), ms + 60);
  }

  /** 物理探针：带轨迹从 fromEl 飞向 toEl */
  async function flyProbe(fromEl, toEl, token, lift) {
    const [s1, s2] = pickSides(fromEl, toEl);
    const a = anchor(fromEl, s1), b = anchor(toEl, s2);
    const path = mk('path', { d: segPath(a, b, lift == null ? -46 : lift), class: 'fx-trail' });
    const cap = mk('circle', { cx: a.x, cy: a.y, r: 6, class: 'fx-dot' });
    svg.appendChild(path); svg.appendChild(cap);
    const len = path.getTotalLength();
    await anim(760, (p) => {
      const pt = path.getPointAtLength(len * p);
      cap.setAttribute('cx', pt.x); cap.setAttribute('cy', pt.y);
      cap.setAttribute('r', 6 + 2 * Math.sin(Math.PI * p));
    }, token);
    fadeOut(path, 420); fadeOut(cap, 420);
  }

  /** 数据回传：蓝色数据包从外存返回内存缓冲区 */
  async function carryBack(fromEl, toEl, token, lift) {
    const [s1, s2] = pickSides(fromEl, toEl);
    const a = anchor(fromEl, s1), b = anchor(toEl, s2);
    const path = mk('path', { d: segPath(a, b, lift == null ? 52 : lift), class: 'fx-trail-back' });
    const cap = mk('rect', { x: a.x - 5, y: a.y - 5, width: 10, height: 10, rx: 2, class: 'fx-cap-blue' });
    svg.appendChild(path); svg.appendChild(cap);
    const len = path.getTotalLength();
    await anim(620, (p) => {
      const pt = path.getPointAtLength(len * p);
      cap.setAttribute('x', pt.x - 5); cap.setAttribute('y', pt.y - 5);
    }, token);
    cap.remove();
    fadeOut(path, 380);
  }

  /** 持久引线：fd 行 ➔ 系统打开文件表项（随 resize 重算） */
  function addLeader(fromEl, toEl, token, lift) {
    const rec = { fromEl, toEl, lift: lift == null ? -26 : lift, path: mk('path', { class: 'fx-leader' }), dot: mk('circle', { r: 3.5, class: 'fx-cap' }) };
    svg.appendChild(rec.path); svg.appendChild(rec.dot);
    updateLeader(rec);
    leaders.push(rec);
    const len = rec.path.getTotalLength();
    rec.path.style.strokeDasharray = len;
    rec.path.style.strokeDashoffset = len;
    anim(520, (p) => { rec.path.style.strokeDashoffset = len * (1 - p); }, token)
      .then(() => { rec.path.style.strokeDasharray = ''; rec.path.style.strokeDashoffset = ''; })
      .catch(() => { });
    return rec;
  }
  function updateLeader(rec) {
    const [s1, s2] = pickSides(rec.fromEl, rec.toEl);
    const a = anchor(rec.fromEl, s1), b = anchor(rec.toEl, s2);
    rec.path.setAttribute('d', segPath(a, b, rec.lift));
    rec.dot.setAttribute('cx', b.x); rec.dot.setAttribute('cy', b.y);
  }
  function redrawLeaders() { leaders.forEach(updateLeader); }

  /** 双光束：目录项 → fd → 内存缓冲块（汇聚照射） */
  async function drawBeam(p1, p2, p3, cls, label, token) {
    const [sa, sb] = pickSides(p1, p2);
    const a1 = anchor(p1, sa), b1 = anchor(p2, sb);
    const [sc, sd] = pickSides(p2, p3);
    const a2 = anchor(p2, sc), b2 = anchor(p3, sd);
    const made = [];
    for (const [A, B] of [[a1, b1], [a2, b2]]) {
      const path = mk('path', { d: segPath(A, B, -34), class: 'beam ' + cls });
      svg.appendChild(path);
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      await anim(430, (p) => { path.style.strokeDashoffset = len * (1 - p); }, token);
      path.style.strokeDasharray = '';
      path.style.strokeDashoffset = '';
      path.classList.add('beam-flow');
      made.push(path);
      const mid = path.getPointAtLength(len * 0.5);
      const dot = mk('circle', { cx: mid.x, cy: mid.y, r: 4.5, class: cls === 'beam-a' ? 'fx-cap-blue' : 'fx-cap' });
      svg.appendChild(dot);
      const txt = mk('text', {
        x: mid.x + 8, y: mid.y - 7, class: 'fx-label ' + (cls === 'beam-a' ? 'la' : 'lb')
      });
      txt.textContent = label;
      svg.appendChild(txt);
      made.push(dot, txt);
      await sleep(140, token);
    }
    return made;
  }

  /** 抛物线载荷飞行（写回时脏块飞回磁盘） */
  async function flyPayload(fromEl, toEl, token, html) {
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'fly-payload';
    el.innerHTML = html;
    document.body.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
    const x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
    const H = Math.max(90, Math.abs(x1 - x0) * 0.4);
    try {
      await anim(950, (p) => {
        const x = x0 + (x1 - x0) * p;
        const y = y0 + (y1 - y0) * p - H * 4 * p * (1 - p);
        el.style.transform = `translate(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px) scale(${(1 - 0.42 * p).toFixed(3)})`;
        el.style.opacity = p > 0.86 ? String((1 - p) / 0.14) : '1';
      }, token);
    } finally { el.remove(); }
  }

  /* ══════════════════ 2. HUD / 状态提示 ══════════════════ */
  const opLabel = $('op-label'), opStage = $('op-stage'), opLed = $('op-led');
  const ioStatus = $('io-status'), ioLed = $('led-io');
  const chips = Array.from(document.querySelectorAll('#stage-chips .chip'));
  let toastTimer = null;

  function setOp(stage, text) {
    opStage.textContent = stage ? `阶段 ${stage} / 4` : '阶段 0 / 4';
    opLabel.textContent = text;
  }
  function setChip(n, state) {
    const c = chips[n - 1];
    if (!c) return;
    c.classList.remove('chip-active', 'chip-done');
    if (state) c.classList.add(state);
  }
  function io(text, tone) {
    ioStatus.textContent = text;
    ioLed.className = 'led ' + (tone === 'blue' ? 'led-blue' : tone === 'amber' ? 'led-amber' : tone === 'emerald' ? 'led-emerald' : 'led-stone');
  }
  function toast(msg, warn) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    if (warn) { t.classList.remove('shake'); void t.offsetWidth; t.classList.add('shake'); }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show', 'shake'); }, 2800);
  }
  function busyLED(on) {
    opLed.className = 'led ' + (on ? 'led-amber' : (F.flushed ? 'led-emerald' : 'led-stone'));
  }

  /* ══════════════════ 3. 栏 1：目录树随动高亮 ══════════════════ */
  function treeMark(id, mode) {
    const el = $(id);
    if (!el) return;
    if (mode === 'focus') { el.classList.add('tree-focus'); el.classList.remove('tree-lock', 'tree-share'); }
    else if (mode === 'seen') {
      // 锁定态 / 硬链接共享态优先级最高，不让位于「已访问」弱化态
      if (el.classList.contains('tree-lock') || el.classList.contains('tree-share')) return;
      el.classList.remove('tree-focus'); el.classList.add('tree-seen');
    }
    else if (mode === 'lock') { el.classList.remove('tree-focus', 'tree-share'); el.classList.add('tree-lock'); }
    else if (mode === 'share') { el.classList.remove('tree-focus', 'tree-lock'); el.classList.add('tree-share'); }
    else { el.classList.remove('tree-focus', 'tree-seen', 'tree-lock', 'tree-share'); }
  }
  /** 高亮前先让上一个节点退为"已访问"态，杜绝寻路迷失 */
  let lastFocus = null;
  function focusNode(id) {
    if (lastFocus && lastFocus !== id) treeMark(lastFocus, 'seen');
    treeMark(id, 'focus');
    lastFocus = id;
  }

  /* ══════════════════ 4. 栏 3/4：缓冲槽与磁盘块 ══════════════════ */
  const DISK_BLOCKS = [
    { n: 0, cat: 'super', lab: '超级块', ctr: 's_block' },
    { n: 1, cat: 'dir', lab: 'users 目录', ctr: '#2' },
    { n: 2, cat: 'dir', lab: 'docs 目录', ctr: '#5' },
    { n: 3, cat: 'idx', lab: '一级间接索引', ctr: '5,6' },
    { n: 4, cat: 'data', lab: 'test.txt', ctr: 'Hello OS' },
    { n: 5, cat: 'data', lab: 'test.txt', ctr: '后继块' },
    { n: 6, cat: 'data', lab: 'test.txt', ctr: '后继块' },
    { n: 7, cat: 'dir', lab: 'backup 目录', ctr: '#6' },
    { n: 8, cat: 'data', lab: 'app.log', ctr: '12KB' },
    { n: 9, cat: 'data', lab: 'app.log', ctr: '12KB' }
  ];
  const diskEl = (n) => $('disk-' + n);

  function buildDisk() {
    const wrap = $('disk');
    let html = '';
    for (let n = 0; n < 32; n++) {
      const b = DISK_BLOCKS.find((x) => x.n === n) || { n, cat: 'free', lab: '空闲', ctr: '—' };
      html += `<div class="dblk d-${b.cat}" id="disk-${b.n}" data-ctr="${b.ctr}" title="Block ${b.n} · ${b.lab}">` +
        `<div class="d-no">B${b.n}</div><div class="d-lab">${b.lab}</div><div class="d-ctr">${b.ctr}</div></div>`;
    }
    wrap.innerHTML = html;
  }
  function setDiskCtr(n, text) {
    const el = diskEl(n);
    el.querySelector('.d-ctr').textContent = text;
    el.classList.add('d-updated');
  }

  function resetSlot(id) {
    const s = $(id);
    s.classList.remove('slot-loaded', 'slot-dirty');
    s.classList.add('slot-empty');
    s.querySelector('.st-pill').textContent = '未载入';
    const body = s.querySelector('.slot-body');
    const tab = body.querySelector('.dirtab');
    if (tab) {
      tab.classList.add('hidden');
      tab.querySelectorAll('.dirrow').forEach((r) => r.classList.remove('show', 'scan-hit'));
    }
    const dc = body.querySelector('.datacell');
    if (dc) dc.classList.add('hidden');
    const ph = body.querySelector('.slot-placeholder');
    if (ph) ph.textContent = '— 空 —';
  }

  async function loadSlot(slot, token, content) {
    slot.classList.remove('slot-empty');
    slot.classList.add('slot-loaded');
    slot.querySelector('.st-pill').textContent = 'Clean';
    const body = slot.querySelector('.slot-body');
    const ph = body.querySelector('.slot-placeholder');
    if (ph) ph.textContent = '— 空 —';
    await sleep(90, token);

    if (content && content.type === 'dir') {
      const tab = body.querySelector('.dirtab');
      tab.classList.remove('hidden');
      const rows = tab.querySelectorAll('.dirrow');
      for (const r of rows) { r.classList.add('show'); await sleep(70, token); }
    } else if (content && content.type === 'data') {
      const dc = body.querySelector('.datacell');
      dc.classList.remove('hidden');
      const target = $(content.target);
      target.textContent = '';
      const caret = $('data-caret');
      if (content.caret && caret) caret.classList.remove('off');
      for (let i = 0; i < content.text.length; i++) {
        target.textContent += content.text[i];
        await sleep(38, token);
      }
      if (content.caret && caret) caret.classList.add('off');
    }
  }
  async function scanHit(slot, match, token) {
    const row = slot.querySelector(`.dirrow[data-match="${match}"]`);
    if (!row) return;
    row.classList.add('scan-hit');
    await sleep(720, token);
  }

  /** 一次完整磁盘读：探针去 → 块高亮 → 数据包回 → 槽位展开 */
  async function ioRead(fromEl, blockNo, slotId, token, content, label) {
    const d = diskEl(blockNo), slot = $(slotId);
    io(`寻道 · 探针飞向 Block ${blockNo}`, 'blue');
    await flyProbe(fromEl, d, token);
    d.classList.add('d-focus', 'd-reading');
    io(label || `READ Block ${blockNo} → ${slot.querySelector('.slot-id').textContent}`, 'blue');
    await sleep(300, token);
    await carryBack(d, slot, token);
    await loadSlot(slot, token, content);
    d.classList.remove('d-reading');
    await sleep(150, token);
    d.classList.remove('d-focus');
    io('I/O 完成 · 缓冲区已更新', 'emerald');
    await sleep(220, token);
    io('I/O 空闲 · 探针待命');
  }

  /* ══════════════════ 5. 阶段一：顺藤摸瓜 · 目录逐级定位 ══════════════════ */
  async function stageLocate(token) {
    setChip(1, 'chip-active');
    setOp(1, '解析根目录 · 常驻内存区命中 users ➔ inode #2');
    focusNode('n-root');
    $('resident').classList.add('k-live');
    $('row-users').classList.add('scan-hit');
    io('常驻内存命中 · 无磁盘 I/O', 'emerald');
    await sleep(950, token);

    setOp(1, '读入 users 目录块 · 探针飞向 Block 1');
    focusNode('n-users');
    await ioRead($('resident'), 1, 'buf-users', token, { type: 'dir' });

    setOp(1, '扫描目录项 · 匹配 docs ➔ inode #5');
    await scanHit($('buf-users'), 'docs', token);

    setOp(1, '读入 docs 目录块 · 探针飞向 Block 2');
    focusNode('n-docs');
    await ioRead($('buf-users'), 2, 'buf-docs', token, { type: 'dir' });

    setOp(1, '锁定目标 · test.txt ➔ inode #8 已获取');
    await scanHit($('buf-docs'), 'test.txt', token);
    focusNode('n-test');          // docs 让位为「已访问」，焦点移到 test.txt
    treeMark('n-test', 'lock');   // 再升级为锁定态（目标高亮优先级最高）
    lastFocus = 'n-test';
    io('目录解析完成 · 已定位 inode #8', 'emerald');
    await sleep(700, token);

    F.located = true;
    setChip(1, 'chip-done');
  }

  /* ══════════════════ 6. 阶段二：打开文件 · 引用计数递增 ══════════════════ */
  function addFdRow(tbodyId, rowId, fd, target) {
    const tr = document.createElement('tr');
    tr.className = 'fd-dyn';
    tr.id = rowId;
    tr.innerHTML = `<td>${fd}</td><td><span class="fd-target">${target}</span><span class="fd-inode">inode #8</span></td>`;
    $(tbodyId).appendChild(tr);
    popIn(tr);
    return tr;
  }
  function bumpCount(to) {
    const num = $('oc-num');
    num.textContent = String(to);
    num.classList.remove('oc-bump'); void num.offsetWidth; num.classList.add('oc-bump');
    $('ino-count').textContent = String(to);
    $('led-oc').className = 'led ' + (to > 0 ? 'led-emerald' : 'led-stone');
  }

  async function stageOpen(token) {
    setChip(2, 'chip-active');

    setOp(2, '进程 A 调用 open() · 内核分配 fd = 3');
    $('proc-a').classList.add('proc-live');
    $('led-a').className = 'led led-blue';
    await sleep(320, token);
    const fd3 = addFdRow('fd-a', 'fd-a3', '3', '系统表 #0');
    await sleep(340, token);

    $('sysrow').classList.remove('sy-off');
    $('sysrow').classList.add('sy-on');
    $('share-flag').hidden = false;
    await sleep(360, token);

    addLeader(fd3, $('sysrow'), token, -22);
    await sleep(420, token);
    bumpCount(1);
    setOp(2, '系统打开文件表 · inode #8 的 Open Count: 0 ➔ 1');
    await sleep(760, token);

    setOp(2, '定位硬链接 · 读入 backup 目录块 Block 7');
    focusNode('n-backup');
    await ioRead($('sysrow'), 7, 'buf-backup', token, { type: 'dir' });

    setOp(2, '扫描目录项 · 匹配 link.txt ➔ inode #8');
    await scanHit($('buf-backup'), 'link.txt', token);
    treeMark('n-link', 'share');
    await sleep(520, token);

    setOp(2, '进程 B 调用 open() · 内核分配 fd = 4');
    $('proc-b').classList.add('proc-live');
    $('led-b').className = 'led led-blue';
    await sleep(300, token);
    const fd4 = addFdRow('fd-b', 'fd-b4', '4', '系统表 #0');
    await sleep(320, token);
    addLeader(fd4, $('sysrow'), token, 26);
    await sleep(430, token);
    bumpCount(2);
    setOp(2, '共享同一表项 · Open Count: 1 ➔ 2（硬链接共用 inode #8）');
    io('两次 open() 命中同一系统表项', 'emerald');
    await sleep(900, token);

    setChip(2, 'chip-done');
  }

  /* ══════════════════ 7. 阶段三：多级索引寻道与数据载入 ══════════════════ */
  async function stageIndex(token) {
    setChip(3, 'chip-active');

    setOp(3, '展开 inode #8 的索引结构卡片');
    $('ino-body').classList.add('open');
    $('ino-toggle-tag').textContent = '▾ 收起索引';
    $('ino-card').classList.add('k-live');
    await sleep(760, token);

    setOp(3, '直接索引 [0] ➜ Block 4 · 发起物理寻道');
    $('ino-direct').classList.add('lit');
    await sleep(320, token);
    await ioRead($('ino-direct'), 4, 'buf-data', token,
      { type: 'data', target: 'data-text', text: 'Hello OS', caret: true },
      'READ Block 4 → buf #4（真实数据）');
    setOp(3, '数据到手 · 缓冲区 buf #4 = "Hello OS"（状态 Clean）');
    $('sys-offset').textContent = '8';
    await sleep(820, token);

    setOp(3, '一级间接索引 · 读入索引块 Block 3 解析物理块号');
    $('ino-indirect').classList.add('lit');
    await ioRead($('ino-direct'), 3, 'buf-idx', token, { type: 'dir' });

    setOp(3, '解析间接表 · ind[0] ➜ Block 5');
    $('ino-sub').querySelector('[data-ind="0"]').classList.add('lit');
    await scanHit($('buf-idx'), 'ind0', token);

    setOp(3, '二次跳跃 · 按 ind[0] 载入后续数据块 Block 5');
    await ioRead($('buf-idx'), 5, 'buf-data2', token,
      { type: 'data', target: 'data2-text', text: '—— 大文件后继数据（由一级间接索引给出）' },
      'READ Block 5 → buf #5（间接寻址命中）');
    setOp(3, '多级索引寻道完成 · 直接块 + 一级间接块均已驻留');
    await sleep(760, token);

    F.indexed = true;
    setChip(3, 'chip-done');
  }

  /* ══════════════════ 8. 阶段四：修改 · 改一变二 · 刷盘 ══════════════════ */
  async function stageModify(token) {
    setChip(4, 'chip-active');
    setOp(4, '进程 A 对缓冲区 buf #4 原位修改 · 追加写入');
    $('data-caret').classList.remove('off');
    const target = $('data-text');
    const add = '! Modified!';
    for (let i = 0; i < add.length; i++) {
      target.textContent += add[i];
      await sleep(52, token);
    }
    $('data-caret').classList.add('off');
    $('sys-offset').textContent = '19';

    setOp(4, '标记脏块 · Status: Dirty（未刷盘），外存 Block 4 保持原值');
    const slot = $('buf-data');
    slot.classList.add('slot-dirty');
    slot.querySelector('.st-pill').textContent = 'Dirty (未刷盘)';
    $('led-oc').className = 'led led-amber';
    diskEl(4).classList.add('d-stale');
    io('缓冲区已改 · 磁盘未刷盘（原值未变）', 'amber');
    await sleep(1000, token);

    F.modified = true;
  }

  async function stageVerify(token) {
    setOp(4, '进程 B 通过 fd = 4 读取 link.txt · 两道光束出发');
    await drawBeam($('n-test'), $('fd-a3'), $('buf-data'), 'beam-a', 'fd = 3', token);
    await drawBeam($('n-link'), $('fd-b4'), $('buf-data'), 'beam-b', 'fd = 4', token);
    $('buf-data').classList.add('slot-converge');
    await sleep(520, token);

    setOp(4, '汇聚命中 · 同一 inode #8 + 同一内存块 buf #4');
    F.verified = true;
    $('cmp-backdrop').classList.add('open');
    io('双进程共享同一内存缓冲块', 'emerald');
    await sleep(5400, token);
    $('cmp-backdrop').classList.remove('open');
    setOp(4, '「改一变二」验证通过 · 脏块等待刷盘');
    $('buf-data').classList.remove('slot-converge');
    await sleep(560, token);
  }

  async function stageFlush(token) {
    setChip(4, 'chip-active');
    setOp(4, 'sync() 触发刷盘 · 脏块沿抛物线飞回外存 Block 4');
    io('WRITE buf #4 → Block 4', 'blue');
    await flyPayload($('buf-data'), diskEl(4), token,
      '<b>Hello OS! Modified!</b>');
    setDiskCtr(4, 'Hello OS! Modified!');
    diskEl(4).classList.remove('d-stale');
    diskEl(4).classList.add('d-written');
    await sleep(520, token);

    setOp(4, '脏块红灯熄灭 · Status: Dirty ➔ Clean');
    const slot = $('buf-data');
    slot.classList.remove('slot-dirty');
    slot.querySelector('.st-pill').textContent = 'Clean';
    $('led-oc').className = 'led led-emerald';
    $('cmp-backdrop').classList.remove('open');
    await sleep(760, token);

    setOp(4, '✅ 全流程闭环 · 内存与外存内容一致（Hello OS! Modified!）');
    io('刷盘完成 · 内存与磁盘一致', 'emerald');
    F.flushed = true;
    setChip(4, 'chip-done');
    busyLED(false);
  }

  /* ══════════════════ 9. 运行器与按钮编排 ══════════════════ */
  const btnSeek = $('btn-seek'), btnModify = $('btn-modify'), btnFlush = $('btn-flush'), btnReset = $('btn-reset');

  function syncButtons() {
    // 运行期禁用以防并发；前置条件不满足时由点击 Toast 给出状态机解释
    btnSeek.disabled = RUN.busy;
    btnModify.disabled = RUN.busy;
    btnFlush.disabled = RUN.busy;
    btnReset.disabled = false;
  }

  async function runAction(chain) {
    if (RUN.busy) return;
    RUN.busy = true;
    busyLED(true);
    syncButtons();
    const token = ++RUN.token;
    try {
      for (const step of chain) await step(token);
    } catch (e) {
      if (!isAbort(e)) console.error('[演示异常]', e);
    } finally {
      if (token === RUN.token) {
        RUN.busy = false;
        busyLED(false);
        syncButtons();
      }
    }
  }

  function bindEvents() {
    btnSeek.addEventListener('click', () => {
      if (F.located) { toast('寻道已完成 · 如需重演请先【↺ 复位】', true); return; }
      runAction([stageLocate, stageOpen, stageIndex]);
    });
    btnModify.addEventListener('click', () => {
      if (!F.indexed) { toast('请先执行【完整寻道读取】拿到 inode #8 与数据块', true); return; }
      if (F.modified) { toast('已修改并验证 · 可直接执行【刷盘写回】', true); return; }
      runAction([stageModify, stageVerify]);
    });
    btnFlush.addEventListener('click', () => {
      if (!F.modified) { toast('缓冲区尚无脏块 · 请先【修改 test.txt 并验证 link.txt】', true); return; }
      if (!F.verified) { toast('脏块尚未通过「改一变二」验证', true); return; }
      if (F.flushed) { toast('已刷盘完成 · 内存与外存一致', true); return; }
      runAction([stageFlush]);
    });
    btnReset.addEventListener('click', resetAll);

    $('cmp-close').addEventListener('click', () => $('cmp-backdrop').classList.remove('open'));
    $('cmp-backdrop').addEventListener('click', (e) => {
      if (e.target === $('cmp-backdrop')) $('cmp-backdrop').classList.remove('open');
    });

    const speed = $('speed');
    speed.addEventListener('input', () => {
      RUN.speed = parseFloat(speed.value);
      $('speed-val').textContent = RUN.speed.toFixed(1) + 'x';
    });

    $('ino-toggle').addEventListener('click', () => {
      const body = $('ino-body');
      const open = body.classList.toggle('open');
      $('ino-toggle-tag').textContent = open ? '▾ 收起索引' : '▸ 展开索引';
    });

    $('path-input').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = $('path-input').value.trim();
      if (v !== '/users/docs/test.txt') {
        toast('本演示固定映射到 /users/docs/test.txt（含硬链接 link.txt）', true);
        $('path-input').value = '/users/docs/test.txt';
      } else if (!F.located) {
        btnSeek.click();
      }
    });

    // 防呆铁律 2：视口弹性自适应，引线随 resize 重算
    let rz = null;
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(redrawLeaders, 120);
    });
  }

  /* ══════════════════ 10. 复位（先杀补间与特效，再回落状态） ══════════════════ */
  function resetAll() {
    RUN.token++;                       // 使在途微操作全部失效
    RUN.busy = false;
    if (window.gsap) gsap.killTweensOf('*');

    // 清空叠加特效层与引线注册表
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    leaders.length = 0;

    // 目录树
    document.querySelectorAll('.tnode').forEach((n) => n.classList.remove('tree-focus', 'tree-seen', 'tree-lock', 'tree-share'));
    lastFocus = null;

    // 磁盘阵列
    document.querySelectorAll('.dblk').forEach((d) => {
      d.classList.remove('d-focus', 'd-reading', 'd-written', 'd-stale', 'd-updated');
      d.querySelector('.d-ctr').textContent = d.dataset.ctr;
    });

    // 缓冲区
    ['buf-users', 'buf-docs', 'buf-backup', 'buf-idx', 'buf-data', 'buf-data2'].forEach(resetSlot);
    $('buf-data').classList.remove('slot-converge', 'k-live');
    $('data-text').textContent = '';
    $('data2-text').textContent = '';
    $('data-caret').classList.add('off');

    // 内核工作区
    $('resident').classList.remove('k-live');
    $('row-users').classList.remove('scan-hit');
    $('sysrow').classList.add('sy-off');
    $('sysrow').classList.remove('sy-on');
    $('share-flag').hidden = true;
    $('oc-num').textContent = '0';
    $('led-oc').className = 'led led-stone';
    $('sys-offset').textContent = '0';
    $('ino-count').textContent = '0';
    $('ino-body').classList.remove('open');
    $('ino-toggle-tag').textContent = '▸ 展开索引';
    $('ino-card').classList.remove('k-live');
    $('ino-direct').classList.remove('lit');
    $('ino-indirect').classList.remove('lit');
    $('ino-sub').querySelectorAll('.ind-row').forEach((r) => r.classList.remove('lit'));

    // 进程表
    ['proc-a', 'proc-b'].forEach((id) => $(id).classList.remove('proc-live'));
    $('led-a').className = 'led led-stone';
    $('led-b').className = 'led led-stone';
    ['fd-a3', 'fd-b4'].forEach((id) => { const r = $(id); if (r) r.remove(); });

    // HUD
    $('cmp-backdrop').classList.remove('open');
    chips.forEach((c) => c.classList.remove('chip-active', 'chip-done'));
    Object.keys(F).forEach((k) => { F[k] = false; });
    setOp(0, '待机 · 点击下方按钮开始寻道演示');
    io('I/O 空闲 · 探针待命');
    busyLED(false);
    syncButtons();
    toast('已复位 · 状态机与特效全部清理');
  }

  /* ══════════════════ 11. 初始化 ══════════════════ */
  function init() {
    buildDisk();
    $('data-caret').classList.add('off');
    bindEvents();
    syncButtons();
    setOp(0, '待机 · 点击下方按钮开始寻道演示');
    console.log('🚀 [文件索引寻道与缓冲写回] 模块初始化就绪');
  }

  window.addEventListener('DOMContentLoaded', init);
})();
