(function () {
  'use strict';

  /* ============================================================
     0. 基础工具
     ============================================================ */
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const flow = $('flow');
  const svg = $('links');
  const layerLinks = $('layer-links');
  const layerFx = $('layer-fx');

  const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const EASES = {
    'power1.inOut': t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    'power2.out': t => 1 - Math.pow(1 - t, 2),
    'power3.out': t => 1 - Math.pow(1 - t, 3),
    'sine.inOut': t => -(Math.cos(Math.PI * t) - 1) / 2,
    'back.out(1.7)': t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2)
  };

  const State = { step: 0, speed: 1, playing: false, busy: false };
  let EPOCH = 0;   // 每次重置递增，用于作废尚未完成的异步回调

  function tween(opts) {
    return new Promise(resolve => {
      const ease = EASES[opts.ease] || EASES['power2.out'];
      const dur = Math.max(0, opts.duration || 0);
      const delay = opts.delay || 0;
      const done = () => { if (opts.onComplete) opts.onComplete(); resolve(); };
      if (window.gsap && typeof window.gsap.to === 'function' && !RM) {
        const holder = { v: opts.from === undefined ? 0 : opts.from };
        window.gsap.to(holder, {
          v: opts.to,
          duration: dur,
          delay,
          ease: opts.ease || 'power2.out',
          onUpdate: () => opts.onUpdate && opts.onUpdate(holder.v),
          onComplete: done
        });
        return;
      }
      let start = null;
      const frame = now => {
        if (start === null) start = now + delay * 1000;
        const elapsed = (now - start) / 1000;
        if (elapsed < 0) { requestAnimationFrame(frame); return; }
        const t = dur === 0 ? 1 : Math.min(1, elapsed / dur);
        if (opts.onUpdate) opts.onUpdate((opts.from || 0) + (opts.to - (opts.from || 0)) * ease(t));
        if (t < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
  }

  const D = d => (RM ? 0.05 : Math.max(0.05, d / State.speed));
  const wait = (d = 0.2) => tween({ duration: D(d) });

  function fadeIn(target) {
    if (!window.gsap || RM) return;
    window.gsap.fromTo(target, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
  }

  /* ============================================================
     1. 锚点、折线路径与持久连线
     ============================================================ */
  function anchor(sel, side) {
    const node = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!node || node.offsetParent === null || node.getClientRects().length === 0) return null;
    const r = node.getBoundingClientRect();
    const f = flow.getBoundingClientRect();
    const p = { x: 0, y: 0, rect: r };
    switch (side) {
      case 'left': p.x = r.left - f.left; p.y = r.top - f.top + r.height / 2; break;
      case 'right': p.x = r.right - f.left; p.y = r.top - f.top + r.height / 2; break;
      case 'top': p.x = r.left - f.left + r.width / 2; p.y = r.top - f.top; break;
      case 'bottom': p.x = r.left - f.left + r.width / 2; p.y = r.bottom - f.top; break;
      default: p.x = r.left - f.left + r.width / 2; p.y = r.top - f.top + r.height / 2;
    }
    return p;
  }

  function elbow(a, b, fromSide, toSide) {
    const horiz = (fromSide === 'left' || fromSide === 'right');
    if (horiz) {
      const mx = (a.x + b.x) / 2;
      return `M ${a.x} ${a.y} H ${mx} V ${b.y} H ${b.x}`;
    }
    const my = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y} V ${my} H ${b.x} V ${b.y}`;
  }

  function mkPath(d, cls, layer) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', cls);
    layer.appendChild(p);
    return p;
  }

  const LIVE = {};   // id → spec（持久连线，resize 时重算）

  function drawLink(spec, instant) {
    if (LIVE[spec.id] && document.body.contains(LIVE[spec.id].node)) {
      LIVE[spec.id].node.setAttribute('d', buildD(spec));
      return LIVE[spec.id].node;
    }
    const d = buildD(spec);
    if (!d) return null;
    const path = mkPath(d, `link-path ${spec.cls || 'link-blue'}`, layerLinks);
    LIVE[spec.id] = Object.assign({}, spec, { node: path });
    if (spec.label) {
      const a = anchor(spec.from, spec.fromSide), b = anchor(spec.to, spec.toSide);
      if (a && b) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', (a.x + b.x) / 2);
        t.setAttribute('y', (a.y + b.y) / 2 - 7);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'link-label');
        t.setAttribute('fill', spec.labelColor || '#2563eb');
        t.textContent = spec.label;
        path.__label = t;
        layerLinks.appendChild(t);
      }
    }
    if (!instant && !RM) {
      const L = path.getTotalLength();
      path.style.strokeDasharray = L;
      path.style.strokeDashoffset = L;
      tween({ from: L, to: 0, duration: D(0.55), ease: 'power2.out', onUpdate: v => { path.style.strokeDashoffset = v; } })
        .then(() => { path.style.strokeDasharray = ''; path.style.strokeDashoffset = ''; });
    }
    return path;
  }

  function buildD(spec) {
    const a = anchor(spec.from, spec.fromSide);
    const b = anchor(spec.to, spec.toSide);
    if (!a || !b) return null;
    return elbow(a, b, spec.fromSide, spec.toSide);
  }

  function redrawLinks() {
    Object.keys(LIVE).forEach(id => {
      const spec = LIVE[id];
      if (!spec.node || !document.body.contains(spec.node)) { delete LIVE[id]; return; }
      const d = buildD(spec);
      if (d) spec.node.setAttribute('d', d);
      if (spec.node.__label) {
        const a = anchor(spec.from, spec.fromSide), b = anchor(spec.to, spec.toSide);
        if (a && b) {
          spec.node.__label.setAttribute('x', (a.x + b.x) / 2);
          spec.node.__label.setAttribute('y', (a.y + b.y) / 2 - 7);
        }
      }
    });
  }

  /* ============================================================
     2. 瞬态特效：光标探针 / 飞行筹码 / 数据块
     ============================================================ */
  function makeChip(text, cls) {
    const c = document.createElement('div');
    c.className = 'fly-chip ' + (cls || 'blue');
    c.textContent = text;
    flow.appendChild(c);
    return c;
  }

  function bezier(a, ctrl, b, t) {
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y
    };
  }

  async function fly(text, cls, fromSel, toSel, opts) {
    opts = opts || {};
    const a = anchor(fromSel, opts.fromSide || 'center');
    const b = anchor(toSel, opts.toSide || 'center');
    if (!a || !b) return;
    const ctrl = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - (opts.arc === undefined ? 55 : opts.arc) };
    const chip = makeChip(text, cls);
    chip.style.left = a.x + 'px';
    chip.style.top = a.y + 'px';
    await tween({
      from: 0, to: 1, duration: D(opts.dur || 0.75), ease: opts.ease || 'power1.inOut',
      onUpdate: t => {
        const p = bezier(a, ctrl, b, t);
        chip.style.left = p.x + 'px';
        chip.style.top = p.y + 'px';
        chip.style.opacity = t < 0.12 ? t / 0.12 : (t > 0.86 ? (1 - t) / 0.14 : 1);
      }
    });
    chip.remove();
  }

  async function probe(opts) {
    const a = anchor(opts.from, opts.fromSide);
    const b = anchor(opts.to, opts.toSide);
    if (!a || !b) return;
    const d = elbow(a, b, opts.fromSide, opts.toSide);
    const path = mkPath(d, `link-path link-ghost ${opts.cls || 'link-blue'}`, layerFx);
    const L = path.getTotalLength();
    path.style.strokeDasharray = L;
    path.style.strokeDashoffset = L;
    path.style.opacity = 0.8;

    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', opts.r || 5);
    dot.setAttribute('fill', opts.dot || '#2563eb');
    dot.setAttribute('class', 'probe-dot');
    dot.setAttribute('cx', a.x);
    dot.setAttribute('cy', a.y);
    layerFx.appendChild(dot);

    const carry = opts.carry ? makeChip(opts.carry, opts.chipCls || 'blue') : null;

    await tween({
      from: 0, to: 1, duration: D(opts.dur || 0.8), ease: 'power1.inOut',
      onUpdate: t => {
        path.style.strokeDashoffset = L * (1 - t);
        const p = path.getPointAtLength(L * t);
        dot.setAttribute('cx', p.x);
        dot.setAttribute('cy', p.y);
        if (carry) { carry.style.left = p.x + 'px'; carry.style.top = (p.y - 16) + 'px'; }
      }
    });
    path.style.strokeDasharray = '6 6';
    path.style.strokeDashoffset = '0';
    await wait(opts.hold === undefined ? 0.22 : opts.hold);

    await tween({
      from: 1, to: 0, duration: D(0.3),
      onUpdate: v => { path.style.opacity = 0.8 * v; dot.style.opacity = v; if (carry) carry.style.opacity = v; }
    });
    path.remove();
    dot.remove();
    if (carry) carry.remove();
  }

  function pulse(node, cls, ms) {
    if (!node) return Promise.resolve();
    node.classList.add(cls);
    if (window.gsap && !RM) {
      window.gsap.fromTo(node, { scale: 1 }, { scale: 1.03, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.out', transformOrigin: '50% 50%' });
    }
    return wait((ms || 500) / 1000);
  }

  /* ============================================================
     3. 步骤元数据
     ============================================================ */
  const STEPS = [
    null,
    {
      phase: '阶段一 · open', cls: 'p1',
      title: 'open 第 1 步：路径解析，inode 调入内存',
      kicker: '阶段一 · STEP 1 / 6',
      desc: 'open("/a/b.txt") 陷入内核，namei 沿 / → a → b.txt 逐级查目录项，得到 b.txt 的 inode 编号 42；该 inode 不在内存，于是从磁盘复制装入活动 inode 表。',
      formula: '"/a/b.txt" → Block2(a→7) → Block7(b.txt→42) → inode 42',
      note: '路径解析只在 open 时发生一次；活动 inode 表命中即可免去磁盘 I/O（i_count > 0）。',
      hint: '路径解析完成：/ → /a → /a/b.txt → 磁盘 inode 42 已复制进内存活动表。'
    },
    {
      phase: '阶段一 · open', cls: 'p1',
      title: 'open 第 2 步：创建系统打开文件表项',
      kicker: '阶段一 · STEP 2 / 6',
      desc: '内核分配一个全局 file 对象：offset = 0（从文件头读）、flags = O_RDONLY、引用计数 count = 1，并保存指向活动 inode 42 的指针。',
      formula: 'file[#3] = { offset:0, flags:O_RDONLY, count:1, inode* → 42 }',
      note: '系统打开文件表是全系统共享的：同一文件被多次 open 各占一个表项；只有 dup / fork 共用一个表项时 count 才 ++。',
      hint: '系统表项 #3 已插入：offset=0，count=1，inode* 指向内存 inode 42。'
    },
    {
      phase: '阶段一 · open', cls: 'p1',
      title: 'open 第 3 步：分配 fd 并绑定指针',
      kicker: '阶段一 · STEP 3 / 6',
      desc: '在进程打开文件表中扫描最小空闲下标（0/1/2 已被标准流占用）得到 fd = 3；把 file* 写入 fds[3]，再把整数 3 返回给用户态变量 fd。',
      formula: 'fd = 3;  fds[3] = &file[#3];  return 3',
      note: 'fd 是进程级的整数索引而非地址——不同进程的 fd 可以不同，只要指向同一个 file 就共享状态。',
      hint: 'fd = 3 已回传用户态：fds[3] → 系统表项 #3（指针绑定完成）。'
    },
    {
      phase: '阶段二 · read', cls: 'p2',
      title: 'read 第 1 步：按 fd 寻址，取出 offset',
      kicker: '阶段二 · STEP 4 / 6',
      desc: 'read(3, buf, 100) 再次陷入内核：fd = 3 只是下标，经 fds[3] 瞬间跳到系统打开文件表，读出当前读写位置 offset = 0，确认从文件起始处开始。',
      formula: 'file = current->files[3];  pos = file->offset = 0',
      note: 'offset 挂在 file 对象上，既不属于进程也不属于 inode——这正是 dup / fork 后共享读写位置的原因。',
      hint: 'read(3)：fds[3] → 表项 #3，读出 offset = 0（从文件头开始读）。'
    },
    {
      phase: '阶段二 · read', cls: 'p2',
      title: 'read 第 2 步：inode 定位盘块，搬运数据',
      kicker: '阶段二 · STEP 5 / 6',
      desc: '顺着 file 的 inode* 找到内存 inode 42，查块索引 addrs[0] = 12 精确定位磁盘 Block 12，内核把其中的 100 字节复制到用户空间的 buf[]。',
      formula: 'blk = inode.addrs[0] = 12;  copy_to_user(buf, blk12, 100)',
      note: 'read 不再查目录：fd → file → inode.addrs 三级指针直达盘块（真实系统中常先命中页缓存）。',
      hint: 'Block 12 已读出 100 字节，流式写入用户空间 buf[]。'
    },
    {
      phase: '阶段二 · read', cls: 'p2',
      title: 'read 完成：offset 前进到 100',
      kicker: '阶段二 · STEP 6 / 6',
      desc: '数据交付完毕，file->offset 由 0 滚动到 100，read() 向用户态返回 100；打开期间 count 仍为 1，inode i_count 仍为 1。',
      formula: 'file->offset += 100 → 100;  return 100',
      note: '考研常考：下次 read 直接从 offset 继续，不再做路径解析，也不再查目录。',
      hint: 'offset 已更新为 100：三级映射保持不变，等待下一次 read。'
    }
  ];

  const MILESTONES = [
    '路径解析 / inode 调入',
    '创建系统表项',
    '分配 fd 并绑定',
    '描述符寻址取 offset',
    '定位盘块搬运数据',
    'offset 更新为 100'
  ];

  const TITLES = [
    '初始状态：文件尚未打开',
    STEPS[1].title, STEPS[2].title, STEPS[3].title,
    STEPS[4].title, STEPS[5].title, STEPS[6].title
  ];

  const HEX = ['48', '65', '6c', '6c', '6f', '2c', '20', '4f', '53', '21'];

  /* ============================================================
     4. DOM 引用
     ============================================================ */
  const el = {
    code1: $('a-code1'), code2: $('a-code2'),
    varFd: $('var-fd'), varN: $('var-n'),
    fdChip: $('a-varfd'), nChip: $('a-varn'),
    bufCells: Array.prototype.slice.call(document.querySelectorAll('.buf-cell')),
    bufBytes: $('buf-bytes'),
    fdRows: Array.prototype.slice.call(document.querySelectorAll('.fd-tbl tbody tr')),
    fd3: $('a-fd3'),
    sysEmpty: $('sys-empty'), sysTbl: $('sys-tbl'), sysRow: $('a-sysrow'),
    sysOffset: $('sys-offset'), offsetCell: $('a-sysoffset'),
    memEmpty: $('mem-empty'), memTbl: $('mem-tbl'),
    addr0: $('a-addr0'),
    dir2: $('a-dir2'), dir7: $('a-dir7'), diskino: $('a-diskino'), blk12: $('a-blk12'),
    trapChip: $('trap-chip'), ledUser: $('led-user'), ledTrap: $('led-trap'),
    share: $('share-badge'), tip: $('tip'),
    phase: $('phase'), stageTitle: $('stage-title'), stageHint: $('stage-hint'),
    kicker: $('step-kicker'), stitle: $('step-title'), sdesc: $('step-desc'),
    formula: $('formula'), snote: $('step-note'),
    snFd: $('sn-fd'), snOffset: $('sn-offset'), snCount: $('sn-count'),
    snInode: $('sn-inode'), snBuf: $('sn-buf'), snRet: $('sn-ret')
  };

  /* ============================================================
     5. 状态突变（幂等，可瞬时回放）
     ============================================================ */
  function showMemInode() { el.memTbl.hidden = false; el.memEmpty.hidden = true; }
  function showSysTbl() { el.sysTbl.hidden = false; el.sysEmpty.hidden = true; }

  function setSnap(node, value, cls) {
    node.textContent = value;
    node.className = cls || '';
  }

  function applyStep(i, instant) {
    switch (i) {
      case 1:
        el.code1.classList.add('on-blue');
        showMemInode();
        setSnap(el.snInode, '是', 'good');
        break;
      case 2:
        showSysTbl();
        el.sysRow.classList.add('hot');
        setSnap(el.snOffset, '0', 'good');
        setSnap(el.snCount, '1', 'good');
        drawLink({
          id: 'l-sys-inode', from: '#a-sysinode', fromSide: 'right',
          to: '#a-memino', toSide: 'left', cls: 'link-blue'
        }, instant);
        break;
      case 3:
        el.fd3.classList.add('bound');
        el.fd3.querySelector('.ptr').textContent = '0x4e80 → #3';
        el.fd3.querySelector('td').innerHTML = '<b>3</b> b.txt';
        el.varFd.textContent = '3';
        el.fdChip.classList.add('hot');
        setSnap(el.snFd, '3', 'hot');
        drawLink({
          id: 'l-fd-sys', from: '#a-fd3', fromSide: 'right',
          to: '#a-sysrow', toSide: 'left', cls: 'link-blue', label: 'file*'
        }, instant);
        break;
      case 4:
        el.code1.classList.remove('on-blue');
        el.code1.classList.add('done');
        el.code2.classList.add('on-green');
        el.trapChip.classList.add('hot');
        el.ledTrap.classList.add('on');
        el.sysRow.classList.remove('hot');
        el.sysRow.classList.add('row-green');
        el.offsetCell.classList.add('peek');
        setSnap(el.snOffset, '0', 'good');
        break;
      case 5:
        el.addr0.classList.add('hit');
        el.blk12.classList.add('lit');
        el.bufCells.forEach((c, idx) => {
          c.classList.add('on');
          c.querySelector('b').textContent = HEX[idx];
        });
        el.bufBytes.textContent = '100';
        el.varN.textContent = '100';
        el.nChip.classList.add('hit');
        setSnap(el.snBuf, '100 / 100 B', 'good');
        setSnap(el.snRet, '100', 'good');
        drawLink({
          id: 'l-inode-blk', from: '#a-addr0', fromSide: 'bottom',
          to: '#a-blk12', toSide: 'left', cls: 'link-green'
        }, instant);
        break;
      case 6:
        el.offsetCell.classList.remove('peek');
        el.offsetCell.classList.add('settled');
        el.sysOffset.textContent = '100';
        el.tip.hidden = false;
        setSnap(el.snOffset, '100', 'warn');
        break;
    }
  }

  function resetAll() {
    EPOCH++;
    if (window.gsap) window.gsap.killTweensOf(['#mem-tbl', el.tip, el.offsetCell, el.fdChip, el.nChip]);
    while (layerLinks.firstChild) layerLinks.removeChild(layerLinks.firstChild);
    while (layerFx.firstChild) layerFx.removeChild(layerFx.firstChild);
    Array.prototype.slice.call(flow.querySelectorAll('.fly-chip')).forEach(n => n.remove());
    Object.keys(LIVE).forEach(k => delete LIVE[k]);

    el.code1.className = 'code-line';
    el.code2.className = 'code-line';
    el.varFd.textContent = '—';
    el.varN.textContent = '0';
    el.fdChip.className = 'var-chip';
    el.nChip.className = 'var-chip';
    el.bufCells.forEach(c => { c.classList.remove('on'); c.querySelector('b').textContent = '--'; });
    el.bufBytes.textContent = '0';

    el.fdRows.forEach(r => {
      r.classList.remove('scan', 'picked', 'bound');
      const fd = r.getAttribute('data-fd');
      if (fd === '3') {
        r.querySelector('.ptr').textContent = '—';
        r.querySelector('td').innerHTML = '<b>3</b> 空闲';
      }
    });

    el.sysTbl.hidden = true;
    el.sysEmpty.hidden = false;
    el.sysRow.className = '';
    el.sysOffset.textContent = '0';
    el.offsetCell.className = 'mono offset-cell';
    el.memTbl.hidden = true;
    el.memEmpty.hidden = false;
    el.addr0.className = 'addr on';

    el.blk12.classList.remove('lit', 'scan', 'pulse-once', 'cooled');
    [el.dir2, el.dir7, el.diskino].forEach(n => n.classList.remove('scan', 'lit', 'pulse-once', 'cooled'));
    el.trapChip.classList.remove('hot');
    el.ledTrap.classList.remove('on');
    el.ledUser.classList.remove('on');
    el.tip.hidden = true;
    el.tip.style.opacity = '';
    el.tip.style.transform = '';

    setSnap(el.snFd, '—', '');
    setSnap(el.snOffset, '—', '');
    setSnap(el.snCount, '—', '');
    setSnap(el.snInode, '否', '');
    setSnap(el.snBuf, '0 / 100 B', '');
    setSnap(el.snRet, '—', '');
    State.step = 0;
  }

  /* ============================================================
     6. 各步骤的动画编排
     ============================================================ */
  async function fxStep(i) {
    switch (i) {

      /* ── Step 1：目录逐级检索 + inode 调入 ── */
      case 1: {
        el.ledUser.classList.add('on');
        el.code1.classList.add('on-blue');
        await wait(0.25);

        el.stageHint.textContent = '解析第 1 级：读取根目录 Block 2 …';
        await probe({
          from: '#a-code1', fromSide: 'right', to: '#a-dir2', toSide: 'left',
          cls: 'link-blue', dot: '#2563eb', carry: '/a', chipCls: 'ghost', dur: 0.85
        });
        await pulse(el.dir2, 'scan', 420);

        el.stageHint.textContent = '解析第 2 级：读取目录 /a 的 Block 7 …';
        await probe({
          from: '#a-dir2', fromSide: 'right', to: '#a-dir7', toSide: 'left',
          cls: 'link-blue', dot: '#2563eb', carry: '/a/b.txt', chipCls: 'ghost', dur: 0.5
        });
        await pulse(el.dir7, 'scan', 420);

        el.stageHint.textContent = '命中目录项：b.txt → inode 42';
        await probe({
          from: '#a-dir7', fromSide: 'right', to: '#a-diskino', toSide: 'left',
          cls: 'link-blue', dot: '#2563eb', carry: '42', chipCls: 'ghost', dur: 0.5
        });
        await pulse(el.diskino, 'lit', 460);

        // 磁盘 inode 复制 → 内存活动 inode 表
        showMemInode();
        if (window.gsap && !RM) window.gsap.set('#mem-tbl', { opacity: 0, y: -10, scale: 0.97 });
        await fly('inode 42 ⧉', 'ghost', '#a-diskino', '#mem-tbl', { fromSide: 'top', toSide: 'left', arc: 90, dur: 0.8 });
        if (window.gsap && !RM) {
          window.gsap.to('#mem-tbl', { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.7)' });
        } else {
          const mt = document.getElementById('mem-tbl');
          if (mt) { mt.style.opacity = 1; mt.style.transform = 'none'; }
        }
        [el.dir2, el.dir7].forEach(n => n.classList.add('cooled'));
        await wait(0.2);
        break;
      }

      /* ── Step 2：插入系统打开文件表项 ── */
      case 2: {
        showSysTbl();
        if (window.gsap && !RM) {
          window.gsap.fromTo('#sys-tbl', { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });
          window.gsap.fromTo('#a-sysrow', { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.55, delay: 0.1, ease: 'back.out(1.7)' });
        }
        await wait(0.45);
        drawLink({
          id: 'l-sys-inode', from: '#a-sysinode', fromSide: 'right',
          to: '#a-memino', toSide: 'left', cls: 'link-blue'
        }, false);
        el.sysRow.classList.add('hot');
        el.share.classList.remove('flash');
        void el.share.offsetWidth;
        el.share.classList.add('flash');
        await wait(0.55);
        break;
      }

      /* ── Step 3：扫描空闲 fd，绑定并回传 3 ── */
      case 3: {
        for (const row of el.fdRows) {
          row.classList.add('scan');
          await wait(0.14);
          if (row.getAttribute('data-fd') === '3') break;
          row.classList.remove('scan');
        }
        el.fd3.classList.remove('scan');
        el.fd3.classList.add('picked');
        if (window.gsap && !RM) {
          window.gsap.fromTo(el.fd3, { scale: 1 }, { scale: 1.04, duration: 0.18, yoyo: true, repeat: 1, transformOrigin: '0 50%' });
        }
        await wait(0.3);

        el.fd3.classList.remove('picked');
        el.fd3.classList.add('bound');
        el.fd3.querySelector('.ptr').textContent = '0x4e80 → #3';
        el.fd3.querySelector('td').innerHTML = '<b>3</b> b.txt';
        drawLink({
          id: 'l-fd-sys', from: '#a-fd3', fromSide: 'right',
          to: '#a-sysrow', toSide: 'left', cls: 'link-blue', label: 'file*'
        }, false);
        await wait(0.35);

        // 数值 3 沿原路回传到用户态变量 fd
        await fly('3', 'blue', '#a-fd3', '#a-varfd', { fromSide: 'right', toSide: 'left', arc: 70, dur: 0.75 });
        el.varFd.textContent = '3';
        el.fdChip.classList.add('hot');
        if (window.gsap && !RM) {
          window.gsap.fromTo(el.fdChip, { scale: 1 }, { scale: 1.16, duration: 0.2, yoyo: true, repeat: 1, ease: 'back.out(1.7)' });
        }
        el.fdRows.forEach(r => r.classList.remove('scan'));
        await wait(0.3);
        break;
      }

      /* ── Step 4：read(3) 陷入内核，描述符寻址 ── */
      case 4: {
        el.code2.classList.add('on-green');
        el.trapChip.classList.add('hot');
        el.ledTrap.classList.add('on');
        if (window.gsap && !RM) {
          window.gsap.fromTo('#trap-card', { scale: 1 }, { scale: 1.03, duration: 0.2, yoyo: true, repeat: 1 });
        }
        await wait(0.35);

        await probe({
          from: '#a-code2', fromSide: 'right', to: '#a-fd3', toSide: 'left',
          cls: 'link-green', dot: '#059669', carry: 'fd = 3', chipCls: 'green', dur: 0.75
        });
        el.fd3.classList.add('picked');
        await wait(0.25);

        await probe({
          from: '#a-fd3', fromSide: 'right', to: '#a-sysrow', toSide: 'left',
          cls: 'link-green', dot: '#059669', carry: 'file*', chipCls: 'green', dur: 0.5
        });
        el.fd3.classList.remove('picked');

        el.sysRow.classList.remove('hot');
        el.sysRow.classList.add('row-green');
        el.offsetCell.classList.add('peek');
        if (window.gsap && !RM) {
          window.gsap.fromTo(el.offsetCell, { scale: 1 }, { scale: 1.12, duration: 0.2, yoyo: true, repeat: 1 });
        }
        await wait(0.4);
        break;
      }

      /* ── Step 5：inode → Block 12 → buf[] ── */
      case 5: {
        await probe({
          from: '#a-sysinode', fromSide: 'right', to: '#a-memino', toSide: 'left',
          cls: 'link-green', dot: '#059669', carry: 'inode* → 42', chipCls: 'green', dur: 0.5
        });
        el.addr0.classList.add('hit');
        if (window.gsap && !RM) {
          window.gsap.fromTo(el.addr0, { scale: 1 }, { scale: 1.2, duration: 0.2, yoyo: true, repeat: 1 });
        }
        await wait(0.3);

        drawLink({
          id: 'l-inode-blk', from: '#a-addr0', fromSide: 'bottom',
          to: '#a-blk12', toSide: 'left', cls: 'link-green'
        }, false);
        await probe({
          from: '#a-addr0', fromSide: 'bottom', to: '#a-blk12', toSide: 'left',
          cls: 'link-green', dot: '#059669', dur: 0.5, hold: 0.05
        });

        // Block 12 闪烁发光
        el.blk12.classList.add('lit');
        for (let k = 0; k < 2; k++) {
          el.blk12.classList.remove('pulse-once');
          void el.blk12.offsetWidth;
          el.blk12.classList.add('pulse-once');
          await wait(0.32);
        }

        // 流光搬运 100 字节
        const flights = [];
        for (let k = 0; k < 6; k++) {
          flights.push(fly('10B', 'green', '#a-blk12', '#a-buf', {
            fromSide: 'left', toSide: 'top', arc: 40 + k * 14, dur: 0.75
          }));
          await wait(0.09);
        }
        const ep5 = EPOCH;
        el.bufCells.forEach((c, idx) => {
          setTimeout(() => {
            if (ep5 !== EPOCH) return;
            c.classList.add('on');
            c.querySelector('b').textContent = HEX[idx];
          }, RM ? 0 : idx * 70);
        });
        // 字节数字滚动
        tween({
          from: 0, to: 100, duration: D(1.0), ease: 'power2.out',
          onUpdate: v => {
            if (ep5 !== EPOCH) return;
            const n = Math.round(v);
            el.bufBytes.textContent = n;
            el.varN.textContent = n;
          }
        });
        el.nChip.classList.add('hit');
        await Promise.all(flights);
        await wait(0.35);
        break;
      }

      /* ── Step 6：offset 数字滚动 + 小贴士 ── */
      case 6: {
        el.offsetCell.classList.remove('peek');
        el.offsetCell.classList.add('roll');
        const ep6 = EPOCH;
        tween({
          from: 0, to: 100, duration: D(0.9), ease: 'power2.out',
          onUpdate: v => { if (ep6 === EPOCH) el.sysOffset.textContent = Math.round(v); }
        });
        await wait(0.55);
        el.offsetCell.classList.remove('roll');
        el.offsetCell.classList.add('settled');
        if (window.gsap && !RM) {
          window.gsap.fromTo(el.offsetCell, { scale: 1 }, { scale: 1.14, duration: 0.2, yoyo: true, repeat: 1 });
        }

        el.tip.hidden = false;
        if (window.gsap && !RM) {
          window.gsap.fromTo(el.tip, { opacity: 0, y: -8, scale: 0.94 },
            { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'back.out(1.7)' });
        }
        if (window.gsap && !RM) {
          window.gsap.fromTo(el.nChip, { scale: 1 }, { scale: 1.12, duration: 0.22, yoyo: true, repeat: 1 });
        }
        await wait(0.5);
        break;
      }
    }
  }

  /* ============================================================
     7. 步骤调度与界面同步
     ============================================================ */
  function renderStepUI(n) {
    const s = STEPS[n];
    el.stageTitle.textContent = TITLES[n];
    el.kicker.textContent = n === 0 ? '准备' : s.kicker;
    el.stitle.textContent = n === 0 ? '点击“下一步”开始演示' : s.title;
    el.sdesc.textContent = n === 0
      ? '阶段一让 open() 建立 fd → file → inode 的映射；阶段二让 read() 沿映射取回数据并推进 offset。'
      : s.desc;
    el.formula.textContent = s ? (s.formula || '') : '';
    el.snote.textContent = s ? (s.note || '') : '';
    el.stageHint.textContent = s ? s.hint : '四列映射链：fd（进程表） → file（系统表） → inode（活动表） → 磁盘块。';

    el.phase.textContent = n === 0 ? '准备' : s.phase;
    el.phase.className = 'phase' + (n === 0 ? '' : ' ' + s.cls);

    if (n > 0) { fadeIn(el.stitle); fadeIn(el.sdesc); }

    // 进度条 / 里程碑
    $('seek').value = n;
    $('progress').textContent = n + ' / 6';
    Array.prototype.slice.call(document.querySelectorAll('#milestones button')).forEach((b, idx) => {
      const i = idx + 1;
      b.dataset.state = i < n ? 'done' : (i === n ? 'current' : '');
      b.setAttribute('aria-current', i === n ? 'step' : 'false');
    });
    syncButtons();
  }

  function syncButtons() {
    const s = State.step, busy = State.busy;
    $('btn-prev').disabled = busy || s === 0;
    $('btn-next').disabled = busy || s >= 6;
    $('btn-reset').disabled = busy || s === 0;
    $('btn-play').disabled = busy || State.playing || s >= 6;
    $('btn-pause').disabled = busy || !State.playing;
    $('seek').disabled = busy;
  }

  async function seekTo(n) {
    n = Math.max(0, Math.min(6, n));
    if (State.busy || n === State.step) return;
    State.busy = true;
    syncButtons();

    if (n < State.step) {
      resetAll();
      for (let i = 1; i <= n; i++) applyStep(i, true);
      State.step = n;
      renderStepUI(n);
    } else {
      for (let i = State.step + 1; i <= n; i++) {
        // 多步跳跃时，中间步骤以加速动画过渡，避免长时间等待又不产生硬跳变
        const jump = (n - i) >= 1;
        const savedSpeed = State.speed;
        if (jump) State.speed = savedSpeed * 3;
        renderStepUI(i - 1 < 0 ? 0 : i - 1);
        await fxStep(i);
        applyStep(i, false);
        State.speed = savedSpeed;
        State.step = i;
        renderStepUI(i);
        if (State.playing && i < n) await wait(0.35);
      }
    }
    State.busy = false;
    syncButtons();
  }

  async function autoplay() {
    if (State.playing || State.step >= 6) return;
    State.playing = true;
    syncButtons();
    while (State.playing && State.step < 6) {
      await seekTo(State.step + 1);
      if (State.playing && State.step < 6) await wait(0.55);
    }
    State.playing = false;
    syncButtons();
  }

  function pause() { State.playing = false; syncButtons(); }

  /* ============================================================
     8. 初始化
     ============================================================ */
  function buildMilestones() {
    const box = $('milestones');
    MILESTONES.forEach((label, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      const parts = label.split(' / ');
      b.innerHTML = '<span>STEP ' + (idx + 1) + '</span><b>' + (parts[0] || label) + '</b>';
      b.title = label;
      b.addEventListener('click', () => { pause(); seekTo(idx + 1); });
      box.appendChild(b);
    });
  }

  function bindControls() {
    $('btn-next').addEventListener('click', () => { pause(); seekTo(State.step + 1); });
    $('btn-prev').addEventListener('click', () => { pause(); seekTo(State.step - 1); });
    $('btn-reset').addEventListener('click', () => { pause(); seekTo(0); });
    $('btn-play').addEventListener('click', autoplay);
    $('btn-pause').addEventListener('click', pause);
    $('speed').addEventListener('change', e => { State.speed = parseFloat(e.target.value) || 1; });
    $('seek').addEventListener('input', e => { pause(); seekTo(parseInt(e.target.value, 10)); });
    document.addEventListener('keydown', e => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { pause(); seekTo(State.step + 1); }
      if (e.key === 'ArrowLeft') { pause(); seekTo(State.step - 1); }
    });

    let t = null;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(redrawLinks, 120);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => setTimeout(redrawLinks, 60));
  }

  function init() {
    buildMilestones();
    bindControls();
    resetAll();
    renderStepUI(0);
    syncButtons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
