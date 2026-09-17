/**
 * VLAN 原理与 802.1Q 帧流动机制 (app.js)
 * 宽敞内部空间 · 全同VLAN端口并发广播 · 全异VLAN端口严格拒绝 (SW1: P5,P6,P7; SW2: P4,P5,P6) · 丝滑形变
 */

(function () {
  'use strict';

  // 动画状态机
  const state = {
    currentStep: 1,
    totalSteps: 4,
    isPlaying: false,
    speedMultiplier: 1.0,
    timer: null,
    activeTweens: []
  };

  let coords = {};

  // DOM 元素引用
  const els = {
    btnPlay: document.getElementById('btn-play'),
    playIcon: document.getElementById('play-icon'),
    playText: document.getElementById('play-text'),
    btnReset: document.getElementById('btn-reset'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    speedBtns: document.querySelectorAll('.speed-btn'),
    stepBadge: document.getElementById('step-badge'),
    stepDesc: document.getElementById('step-desc'),
    statusDot: document.getElementById('status-dot'),

    canvasContainer: document.getElementById('canvas-container'),
    svgLinks: document.getElementById('svg-links'),
    svgPackets: document.getElementById('svg-packets'),
    svgIsolations: document.getElementById('svg-isolations'),

    // 设备终端
    hostA: document.getElementById('host-A'),
    hostB: document.getElementById('host-B'),
    hostA2: document.getElementById('host-A2'), // 终端 3
    hostA3: document.getElementById('host-A3'), // 终端 4
    hostC: document.getElementById('host-C'),
    hostD: document.getElementById('host-D'),
    hostC2: document.getElementById('host-C2'), // 终端 7

    hostE: document.getElementById('host-E'),
    hostE2: document.getElementById('host-E2'), // 终端 E2
    hostF: document.getElementById('host-F'),
    hostF2: document.getElementById('host-F2'),
    hostF3: document.getElementById('host-F3'),

    // 交换机 1 端口与内部中心
    sw1P1: document.getElementById('sw1-p1'),
    sw1P2: document.getElementById('sw1-p2'),
    sw1P3: document.getElementById('sw1-p3'),
    sw1P4: document.getElementById('sw1-p4'),
    sw1P5: document.getElementById('sw1-p5'),
    sw1P6: document.getElementById('sw1-p6'),
    sw1P7: document.getElementById('sw1-p7'),
    sw1P8: document.getElementById('sw1-p8'),
    sw1Center: document.getElementById('sw1-center'),

    // 交换机 2 端口与内部中心
    sw2P1: document.getElementById('sw2-p1'),
    sw2P2: document.getElementById('sw2-p2'),
    sw2P3: document.getElementById('sw2-p3'),
    sw2P4: document.getElementById('sw2-p4'),
    sw2P5: document.getElementById('sw2-p5'),
    sw2P6: document.getElementById('sw2-p6'),
    sw2Center: document.getElementById('sw2-center')
  };

  // 测量所有节点在 SVG 视口中的精准中心坐标
  function updateCoordinates() {
    const containerRect = els.canvasContainer.getBoundingClientRect();

    function getCenter(el) {
      if (!el) return { x: 0, y: 0, top: 0, bottom: 0 };
      const r = el.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 - containerRect.left,
        y: r.top + r.height / 2 - containerRect.top,
        top: r.top - containerRect.top,
        bottom: r.bottom - containerRect.top
      };
    }

    coords = {
      hostA: getCenter(els.hostA),
      hostB: getCenter(els.hostB),
      hostA2: getCenter(els.hostA2),
      hostA3: getCenter(els.hostA3),
      hostC: getCenter(els.hostC),
      hostD: getCenter(els.hostD),
      hostC2: getCenter(els.hostC2),

      hostE: getCenter(els.hostE),
      hostE2: getCenter(els.hostE2),
      hostF: getCenter(els.hostF),
      hostF2: getCenter(els.hostF2),
      hostF3: getCenter(els.hostF3),

      sw1P1: getCenter(els.sw1P1),
      sw1P2: getCenter(els.sw1P2),
      sw1P3: getCenter(els.sw1P3),
      sw1P4: getCenter(els.sw1P4),
      sw1P5: getCenter(els.sw1P5),
      sw1P6: getCenter(els.sw1P6),
      sw1P7: getCenter(els.sw1P7),
      sw1P8: getCenter(els.sw1P8),
      sw1Center: getCenter(els.sw1Center),

      sw2P1: getCenter(els.sw2P1),
      sw2P2: getCenter(els.sw2P2),
      sw2P3: getCenter(els.sw2P3),
      sw2P4: getCenter(els.sw2P4),
      sw2P5: getCenter(els.sw2P5),
      sw2P6: getCenter(els.sw2P6),
      sw2Center: getCenter(els.sw2Center)
    };

    renderLinks();
  }

  // 绘制内部总线与外部物理连线
  function renderLinks() {
    let html = '';

    function drawLine(p1, p2, color = '#CBD5E1', width = 2, dash = '') {
      if (!p1 || !p2 || (p1.x === 0 && p1.y === 0) || (p2.x === 0 && p2.y === 0)) return;
      html += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''} />`;
    }

    // 1. 交换机 1 内部总线 (内部处理空间中的浅灰虚线)
    drawLine(coords.sw1P1, coords.sw1Center, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw1Center, coords.sw1P2, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw1Center, coords.sw1P3, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw1Center, coords.sw1P4, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw1Center, coords.sw1P5, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw1Center, coords.sw1P6, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw1Center, coords.sw1P7, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw1Center, coords.sw1P8, '#CBD5E1', 1.8, '4,3');

    // 2. 交换机 2 内部总线
    drawLine(coords.sw2P1, coords.sw2Center, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw2Center, coords.sw2P2, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw2Center, coords.sw2P3, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw2Center, coords.sw2P4, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw2Center, coords.sw2P5, '#CBD5E1', 1.8, '4,3');
    drawLine(coords.sw2Center, coords.sw2P6, '#CBD5E1', 1.8, '4,3');

    // 3. 交换机与主机外部双绞线
    drawLine(coords.sw1P1, coords.hostA, '#93C5FD', 2.2);
    drawLine(coords.sw1P2, coords.hostB, '#93C5FD', 2.2);
    drawLine(coords.sw1P3, coords.hostA2, '#93C5FD', 2.2);
    drawLine(coords.sw1P4, coords.hostA3, '#93C5FD', 2.2);
    drawLine(coords.sw1P5, coords.hostC, '#FCD34D', 2.2);
    drawLine(coords.sw1P6, coords.hostD, '#FCD34D', 2.2);
    drawLine(coords.sw1P7, coords.hostC2, '#FCD34D', 2.2);

    drawLine(coords.sw2P2, coords.hostE, '#93C5FD', 2.2);
    drawLine(coords.sw2P3, coords.hostE2, '#93C5FD', 2.2);
    drawLine(coords.sw2P4, coords.hostF, '#FCD34D', 2.2);
    drawLine(coords.sw2P5, coords.hostF2, '#FCD34D', 2.2);
    drawLine(coords.sw2P6, coords.hostF3, '#FCD34D', 2.2);

    // 4. SW1(P8) 与 SW2(P1) 之间的 Trunk 跨越链路
    if (coords.sw1P8 && coords.sw2P1) {
      const yMid = (coords.sw1P8.y + coords.sw2P1.y) / 2;
      html += `<path d="M ${coords.sw1P8.x} ${coords.sw1P8.y} C ${coords.sw1P8.x + 35} ${yMid - 15}, ${coords.sw2P1.x - 35} ${yMid - 15}, ${coords.sw2P1.x} ${coords.sw2P1.y}" fill="none" stroke="#10B981" stroke-width="3.5" stroke-dasharray="7,4" />`;
    }

    els.svgLinks.innerHTML = html;
  }

  // ==========================================================================
  // 高保真可平滑形变的报文对象构造器
  // ==========================================================================
  function createMorphablePacket(id = 'pkt-morph', initialType = 'mac') {
    const isMac = initialType === 'mac';
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', id);
    g.setAttribute('class', 'packet-node');

    g.innerHTML = `
      <!-- 报文主体方块 -->
      <rect class="pkt-bg" x="${isMac ? -20 : -25}" y="-14" width="${isMac ? 40 : 50}" height="28" rx="4"
            fill="${isMac ? '#EF4444' : '#059669'}" stroke="${isMac ? '#B91C1C' : '#047857'}" stroke-width="1.5" />
      
      <!-- 报文文字标题 -->
      <text class="pkt-text" x="0" y="${isMac ? 4 : 0}" fill="#FFFFFF" font-size="9.5"
            font-family="JetBrains Mono, monospace" font-weight="bold" text-anchor="middle">
        ${isMac ? 'MAC帧' : '802.1Q'}
      </text>
      
      <!-- 4B VLAN Tag 角标 (可平滑缩放/展开) -->
      <g class="pkt-tag" opacity="${isMac ? 0 : 1}" transform="${isMac ? 'scale(0)' : 'scale(1)'}">
        <rect x="-16" y="5" width="32" height="9" rx="2" fill="#34D399" />
        <text x="0" y="12" fill="#064E3B" font-size="7.5" font-family="JetBrains Mono, monospace" font-weight="800" text-anchor="middle">
          VID:10
        </text>
      </g>
    `;
    return g;
  }

  // 丝滑形变：红色 MAC 帧 -> 绿色 802.1Q 打标帧
  function smoothMorphTo1Q(pktEl, duration = 0.5) {
    if (!pktEl) return;
    const bg = pktEl.querySelector('.pkt-bg');
    const text = pktEl.querySelector('.pkt-text');
    const tag = pktEl.querySelector('.pkt-tag');

    const tl = gsap.timeline();
    tl.to(bg, {
      fill: '#059669',
      stroke: '#047857',
      width: 50,
      x: -25,
      duration: duration,
      ease: 'power2.inOut'
    }, 0);

    tl.to(text, {
      textContent: '802.1Q',
      y: 0,
      duration: duration * 0.4
    }, 0);

    tl.to(tag, {
      opacity: 1,
      scale: 1,
      duration: duration * 0.6,
      ease: 'back.out(2)'
    }, duration * 0.2);

    return tl;
  }

  // 丝滑形变：绿色 802.1Q 帧 -> 红色 MAC 帧 (剥除 Tag)
  function smoothMorphToMac(pktEl, duration = 0.5) {
    if (!pktEl) return;
    const bg = pktEl.querySelector('.pkt-bg');
    const text = pktEl.querySelector('.pkt-text');
    const tag = pktEl.querySelector('.pkt-tag');

    const tl = gsap.timeline();
    tl.to(tag, {
      opacity: 0,
      scale: 0,
      duration: duration * 0.35,
      ease: 'power2.in'
    }, 0);

    tl.to(bg, {
      fill: '#EF4444',
      stroke: '#B91C1C',
      width: 40,
      x: -20,
      duration: duration,
      ease: 'power2.inOut'
    }, 0.05);

    tl.to(text, {
      textContent: 'MAC帧',
      y: 4,
      duration: duration * 0.4
    }, 0.1);

    return tl;
  }

  // 创建拒绝转发/隔离 ❌ 标志 (紧凑美观，适应每个被拒绝的端口)
  function createIsolationBarrier(x, y, label = '拒绝') {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'isolation-badge');
    g.innerHTML = `
      <circle cx="${x}" cy="${y}" r="8.5" fill="#FEE2E2" stroke="#EF4444" stroke-width="1.8" />
      <line x1="${x - 3}" y1="${y - 3}" x2="${x + 3}" y2="${y + 3}" stroke="#DC2626" stroke-width="1.8" stroke-linecap="round" />
      <line x1="${x + 3}" y1="${y - 3}" x2="${x - 3}" y2="${y + 3}" stroke="#DC2626" stroke-width="1.8" stroke-linecap="round" />
      <rect x="${x - 16}" y="${y + 10}" width="32" height="12" rx="2.5" fill="#DC2626" opacity="0.95" />
      <text x="${x}" y="${y + 19}" fill="#FFFFFF" font-size="7.5" font-family="-apple-system, sans-serif" font-weight="bold" text-anchor="middle">
        ${label}
      </text>
    `;
    return g;
  }

  // 清空动效与残留图元
  function clearArtifacts() {
    state.activeTweens.forEach(t => t.kill());
    state.activeTweens = [];

    els.svgPackets.innerHTML = '';
    els.svgIsolations.innerHTML = '';

    document.querySelectorAll('.host-card').forEach(h => h.classList.remove('receiving-pulse', 'sending-pulse'));
    document.querySelectorAll('.port-badge').forEach(p => p.classList.remove('active-port', 'blocked-port'));
  }

  // ==========================================================================
  // 核心动画步骤调度机 (4 大阶段)
  // ==========================================================================
  function goToStep(step) {
    if (step < 1) step = 1;
    if (step > state.totalSteps) step = state.totalSteps;

    state.currentStep = step;
    els.stepBadge.innerText = `${step} / ${state.totalSteps}`;

    els.btnPrev.disabled = (step === 1);
    els.btnNext.disabled = (step === state.totalSteps);

    clearArtifacts();
    updateCoordinates();

    const speed = state.speedMultiplier;
    const durBase = 1.2 / speed;

    switch (step) {
      // ----------------------------------------------------------------------
      // 阶段 1：主机 A 发送 MAC 帧 -> 进入交换机 1 内部 -> 丝滑变为 1Q 帧
      // ----------------------------------------------------------------------
      case 1:
        els.stepDesc.innerText = '阶段 1：主机 A 发送红色 MAC 帧，进入交换机 1 内部打标，丝滑转变为绿色 802.1Q 帧 (VID:10)';
        els.statusDot.className = 'w-2 h-2 rounded-full bg-red-500 animate-pulse';

        els.hostA.classList.add('sending-pulse');
        els.sw1P1.classList.add('active-port');

        const p1 = createMorphablePacket('pkt-step1', 'mac');
        els.svgPackets.appendChild(p1);
        gsap.set(p1, { x: coords.hostA.x, y: coords.hostA.y - 12 });

        const tl1 = gsap.timeline();
        // A -> SW1 P1 (保持红色)
        tl1.to(p1, {
          x: coords.sw1P1.x,
          y: coords.sw1P1.y,
          duration: durBase * 0.8,
          ease: 'power2.in'
        });

        // 穿越 P1 进入交换机内部核心 (开始丝滑形变：Red -> Green 1Q)
        tl1.to(p1, {
          x: coords.sw1Center.x,
          y: coords.sw1Center.y,
          duration: durBase * 1.0,
          ease: 'power1.out',
          onStart: () => {
            smoothMorphTo1Q(p1, durBase * 0.8);
          },
          onComplete: () => {
            gsap.fromTo(els.sw1Center, { scale: 0.95 }, { scale: 1.12, duration: 0.2, yoyo: true, repeat: 1 });
          }
        });

        state.activeTweens.push(tl1);
        break;

      // ----------------------------------------------------------------------
      // 阶段 2：SW1 内部全广播：同 VLAN (P2, P3, P4) 全部转发变回 MAC 帧；所有异 VLAN 端口 (P5, P6, P7) 全部拒绝转发！
      // ----------------------------------------------------------------------
      case 2:
        els.stepDesc.innerText = '阶段 2：交换机 1 广播至同 VLAN 端口 (P2、P3、P4) 变回 MAC 帧；所有不同 VLAN 端口 (P5、P6、P7) 全部直接拒绝 ❌';
        els.statusDot.className = 'w-2 h-2 rounded-full bg-blue-500 animate-pulse';

        // 高亮同 VLAN 转发端口
        els.sw1P1.classList.add('active-port');
        els.sw1P2.classList.add('active-port');
        els.sw1P3.classList.add('active-port');
        els.sw1P4.classList.add('active-port');

        const tl2 = gsap.timeline();

        // 1. 同 VLAN 分支转发辅助函数
        function createSameVlanBranch(targetPortCoord, targetHostCoord, targetHostEl, delay = 0) {
          const pkt = createMorphablePacket('pkt-sw1-branch', '1q');
          els.svgPackets.appendChild(pkt);
          gsap.set(pkt, { x: coords.sw1Center.x, y: coords.sw1Center.y });

          // 中心 -> Access 端口
          tl2.to(pkt, {
            x: targetPortCoord.x,
            y: targetPortCoord.y,
            duration: durBase * 0.7,
            ease: 'power1.in',
            onComplete: () => {
              // 端口出向强制剥离 Tag，丝滑变回红色 MAC 帧
              smoothMorphToMac(pkt, durBase * 0.55);
            }
          }, delay);

          // Access 端口 -> 对应主机
          tl2.to(pkt, {
            x: targetHostCoord.x,
            y: targetHostCoord.y - 12,
            duration: durBase * 0.8,
            ease: 'power2.out',
            onComplete: () => {
              targetHostEl.classList.add('receiving-pulse');
            }
          }, delay + durBase * 0.7);
        }

        // 2. 异 VLAN 端口拒绝辅助函数 (所有该拒绝的端口都要拒绝！)
        function createRejectBranch(targetPortCoord, targetPortEl, delay = 0) {
          const pkt = createMorphablePacket('pkt-sw1-reject', '1q');
          els.svgPackets.appendChild(pkt);
          gsap.set(pkt, { x: coords.sw1Center.x, y: coords.sw1Center.y });

          tl2.to(pkt, {
            x: targetPortCoord.x,
            y: targetPortCoord.y,
            duration: durBase * 0.65,
            ease: 'power1.in',
            onComplete: () => {
              targetPortEl.classList.add('blocked-port');
              const barrier = createIsolationBarrier(targetPortCoord.x, targetPortCoord.y, '拒绝');
              els.svgIsolations.appendChild(barrier);
              gsap.from(barrier, { scale: 0, duration: 0.25, ease: 'back.out(2)' });
              gsap.to(pkt, { opacity: 0, scale: 0.2, duration: 0.2, onComplete: () => pkt.remove() });
            }
          }, delay);
        }

        // --- 同 VLAN 端口并发转发 ---
        createSameVlanBranch(coords.sw1P2, coords.hostB, els.hostB, 0);       // 发往 P2 -> 主机 B
        createSameVlanBranch(coords.sw1P3, coords.hostA2, els.hostA2, 0.04);   // 发往 P3 -> 终端 3
        createSameVlanBranch(coords.sw1P4, coords.hostA3, els.hostA3, 0.08);   // 发往 P4 -> 终端 4

        // --- 所有不同 VLAN 端口 (P5, P6, P7) 全部拒绝 ---
        createRejectBranch(coords.sw1P5, els.sw1P5, 0);                        // P5 拒绝！
        createRejectBranch(coords.sw1P6, els.sw1P6, 0.04);                     // P6 拒绝！
        createRejectBranch(coords.sw1P7, els.sw1P7, 0.08);                     // P7 拒绝！

        state.activeTweens.push(tl2);
        break;

      // ----------------------------------------------------------------------
      // 阶段 3：1Q 帧到达 Trunk 端口 -> 保持 1Q 绿色帧穿越到达交换机 2
      // ----------------------------------------------------------------------
      case 3:
        els.stepDesc.innerText = '阶段 3：1Q 帧到达 Trunk 口 (P8)，保持绿色 802.1Q 帧在中继链路上传输到达交换机 2';
        els.statusDot.className = 'w-2 h-2 rounded-full bg-emerald-600 animate-pulse';

        els.sw1P8.classList.add('active-port');
        els.sw2P1.classList.add('active-port');

        const pTrunk = createMorphablePacket('pkt-trunk', '1q');
        els.svgPackets.appendChild(pTrunk);
        gsap.set(pTrunk, { x: coords.sw1Center.x, y: coords.sw1Center.y });

        const tl3 = gsap.timeline();

        // 1. SW1 中心 -> SW1 Trunk 端口 (P8)
        tl3.to(pTrunk, {
          x: coords.sw1P8.x,
          y: coords.sw1P8.y,
          duration: durBase * 0.6,
          ease: 'power1.out',
          onComplete: () => {
            gsap.fromTo(els.sw1P8, { scale: 0.95 }, { scale: 1.15, duration: 0.15, yoyo: true, repeat: 1 });
          }
        });

        // 2. 沿 Trunk 贝塞尔曲线平滑飞向 SW2 的 Trunk 端口 (P1)
        const trunkPath = { progress: 0 };
        const pStart = coords.sw1P8, pEnd = coords.sw2P1;
        const yMid = (pStart.y + pEnd.y) / 2;

        tl3.to(trunkPath, {
          progress: 1,
          duration: durBase * 1.3,
          ease: 'power1.inOut',
          onUpdate: () => {
            const t = trunkPath.progress;
            const cx1 = pStart.x + 35, cy1 = yMid - 15;
            const cx2 = pEnd.x - 35, cy2 = yMid - 15;
            const x = Math.pow(1 - t, 3) * pStart.x + 3 * Math.pow(1 - t, 2) * t * cx1 + 3 * (1 - t) * Math.pow(t, 2) * cx2 + Math.pow(t, 3) * pEnd.x;
            const y = Math.pow(1 - t, 3) * pStart.y + 3 * Math.pow(1 - t, 2) * t * cy1 + 3 * (1 - t) * Math.pow(t, 2) * cy2 + Math.pow(t, 3) * pEnd.y;
            gsap.set(pTrunk, { x: x, y: y });
          },
          onComplete: () => {
            gsap.fromTo(els.sw2P1, { scale: 0.95 }, { scale: 1.15, duration: 0.15, yoyo: true, repeat: 1 });
          }
        });

        // 3. 进入 SW2 内部中心
        tl3.to(pTrunk, {
          x: coords.sw2Center.x,
          y: coords.sw2Center.y,
          duration: durBase * 0.7,
          ease: 'power1.out'
        });

        state.activeTweens.push(tl3);
        break;

      // ----------------------------------------------------------------------
      // 阶段 4：SW2 内部全广播：同 VLAN (P2, P3) 均转发并变回 MAC 帧；所有异 VLAN 端口 (P4, P5, P6) 全部拒绝转发！
      // ----------------------------------------------------------------------
      case 4:
        els.stepDesc.innerText = '阶段 4：交换机 2 广播至同 VLAN 端口 (P2、P3) 变回 MAC 帧；所有不同 VLAN 端口 (P4、P5、P6) 全部直接拒绝 ❌';
        els.statusDot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';

        // 高亮 SW2 同 VLAN 端口
        els.sw2P2.classList.add('active-port');
        els.sw2P3.classList.add('active-port');

        const tl4 = gsap.timeline();

        // 1. SW2 同 VLAN 分支转发辅助函数
        function createSw2SameVlanBranch(targetPortCoord, targetHostCoord, targetHostEl, delay = 0) {
          const pkt = createMorphablePacket('pkt-sw2-branch', '1q');
          els.svgPackets.appendChild(pkt);
          gsap.set(pkt, { x: coords.sw2Center.x, y: coords.sw2Center.y });

          // 中心 -> Port
          tl4.to(pkt, {
            x: targetPortCoord.x,
            y: targetPortCoord.y,
            duration: durBase * 0.7,
            ease: 'power1.in',
            onComplete: () => {
              smoothMorphToMac(pkt, durBase * 0.55);
            }
          }, delay);

          // Port -> 主机
          tl4.to(pkt, {
            x: targetHostCoord.x,
            y: targetHostCoord.y - 12,
            duration: durBase * 0.8,
            ease: 'power2.out',
            onComplete: () => {
              targetHostEl.classList.add('receiving-pulse');
            }
          }, delay + durBase * 0.7);
        }

        // 2. SW2 异 VLAN 端口拒绝辅助函数 (所有该拒绝的端口都要拒绝！)
        function createSw2RejectBranch(targetPortCoord, targetPortEl, delay = 0) {
          const pkt = createMorphablePacket('pkt-sw2-reject', '1q');
          els.svgPackets.appendChild(pkt);
          gsap.set(pkt, { x: coords.sw2Center.x, y: coords.sw2Center.y });

          tl4.to(pkt, {
            x: targetPortCoord.x,
            y: targetPortCoord.y,
            duration: durBase * 0.65,
            ease: 'power1.in',
            onComplete: () => {
              targetPortEl.classList.add('blocked-port');
              const barrier = createIsolationBarrier(targetPortCoord.x, targetPortCoord.y, '拒绝');
              els.svgIsolations.appendChild(barrier);
              gsap.from(barrier, { scale: 0, duration: 0.25, ease: 'back.out(2)' });
              gsap.to(pkt, { opacity: 0, scale: 0.2, duration: 0.2, onComplete: () => pkt.remove() });
            }
          }, delay);
        }

        // --- SW2 同 VLAN 端口并发转发 ---
        createSw2SameVlanBranch(coords.sw2P2, coords.hostE, els.hostE, 0);     // P2 -> 主机 E
        createSw2SameVlanBranch(coords.sw2P3, coords.hostE2, els.hostE2, 0.05); // P3 -> 终端 E2

        // --- SW2 所有不同 VLAN 端口 (P4, P5, P6) 全部拒绝 ---
        createSw2RejectBranch(coords.sw2P4, els.sw2P4, 0);                     // P4 拒绝！
        createSw2RejectBranch(coords.sw2P5, els.sw2P5, 0.04);                  // P5 拒绝！
        createSw2RejectBranch(coords.sw2P6, els.sw2P6, 0.08);                  // P6 拒绝！

        state.activeTweens.push(tl4);
        break;
    }
  }

  // ==========================================================================
  // 自动循环播放与用户按键交互
  // ==========================================================================
  function togglePlay() {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  }

  function play() {
    state.isPlaying = true;
    els.playIcon.innerText = '⏸';
    els.playText.innerText = '暂停';
    scheduleNext();
  }

  function pause() {
    state.isPlaying = false;
    els.playIcon.innerText = '▶';
    els.playText.innerText = '播放动画';
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function scheduleNext() {
    if (!state.isPlaying) return;

    if (state.currentStep >= state.totalSteps) {
      state.timer = setTimeout(() => {
        if (!state.isPlaying) return;
        goToStep(1);
        scheduleNext();
      }, 2500 / state.speedMultiplier);
      return;
    }

    state.timer = setTimeout(() => {
      if (!state.isPlaying) return;
      goToStep(state.currentStep + 1);
      scheduleNext();
    }, 2800 / state.speedMultiplier);
  }

  // 事件绑定
  function bindEvents() {
    els.btnPlay.addEventListener('click', togglePlay);

    els.btnReset.addEventListener('click', () => {
      pause();
      goToStep(1);
    });

    els.btnPrev.addEventListener('click', () => {
      pause();
      goToStep(state.currentStep - 1);
    });

    els.btnNext.addEventListener('click', () => {
      pause();
      goToStep(state.currentStep + 1);
    });

    els.speedBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        els.speedBtns.forEach(b => {
          b.classList.remove('active', 'border-stone-900', 'bg-stone-900', 'text-white');
          b.classList.add('border-[#E5E4DC]', 'bg-white', 'text-stone-700');
        });
        btn.classList.add('active', 'border-stone-900', 'bg-stone-900', 'text-white');
        btn.classList.remove('border-[#E5E4DC]', 'bg-white', 'text-stone-700');
        state.speedMultiplier = parseFloat(btn.getAttribute('data-speed'));
      });
    });

    window.addEventListener('resize', () => {
      updateCoordinates();
    });

    // 点击主机可手动跳转对应阶段观察
    els.hostA.addEventListener('click', () => { pause(); goToStep(1); });
    els.hostB.addEventListener('click', () => { pause(); goToStep(2); });
    els.hostE.addEventListener('click', () => { pause(); goToStep(4); });
  }

  // 初始化入口
  window.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    setTimeout(() => {
      updateCoordinates();
      goToStep(1);
      play();
    }, 200);
  });

})();
