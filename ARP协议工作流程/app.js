/**
 * ARP 协议工作流程与跨网路由转发交互系统 (app.js)
 * 遵循 agent.md 规范：GSAP 60fps 缓动 · 丝滑无跳变 ARP 缓存表更新 · 实时字段透视 · 路由器查表动画
 * 增强特性：初始显示 ARP/IP 载荷，随后动画加入 MAC 帧头；接收端平滑剥离 MAC 帧头；优化层叠避免任何文字遮挡
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. 全局配置与状态模型
  // =========================================================================
  const state = {
    scenario: 'same', // 'same' | 'cross'
    flowIndex: 1,     // 1, 2, 3
    stepIndex: 0,     // 当前步骤索引
    isPlaying: false,
    timer: null,
    speed: 1.0,
    activeTweens: [],
    
    // 缓存数据模型
    caches: {
      same: {
        h1: [],
        h2: [],
        h3: [],
        h4: []
      },
      cross: {
        ha: [],
        hb: [],
        r1: [],
        hc: [],
        hd: []
      }
    }
  };

  // 设备硬件与网络静态元数据
  const NET_DATA = {
    same: {
      h1: { ip: '192.168.1.10', mac: '00-11-22-33-44-01', name: '主机 1' },
      h2: { ip: '192.168.1.20', mac: '00-11-22-33-44-02', name: '主机 2' },
      h3: { ip: '192.168.1.30', mac: '00-11-22-33-44-03', name: '主机 3' },
      h4: { ip: '192.168.1.40', mac: '00-11-22-33-44-04', name: '主机 4' },
      broadcastMac: 'FF-FF-FF-FF-FF-FF'
    },
    cross: {
      ha: { ip: '192.168.1.10', mac: '00-11-22-33-AA-01', gw: '192.168.1.1', name: '主机 A' },
      hb: { ip: '192.168.1.20', mac: '00-11-22-33-AA-02', gw: '192.168.1.1', name: '主机 B' },
      r1_eth0: { ip: '192.168.1.1', mac: '00-11-22-AA-01', name: '路由器 eth0' },
      r1_eth1: { ip: '192.168.2.1', mac: '00-11-22-AA-02', name: '路由器 eth1' },
      hc: { ip: '192.168.2.10', mac: '00-11-22-33-CC-01', gw: '192.168.2.1', name: '主机 C' },
      hd: { ip: '192.168.2.20', mac: '00-11-22-33-CC-02', gw: '192.168.2.1', name: '主机 D' },
      broadcastMac: 'FF-FF-FF-FF-FF-FF'
    }
  };

  // DOM 元素引用集合
  let dom = {};

  function initDomRefs() {
    dom = {
      // 场景 Tab
      tabSame: document.getElementById('tab-mode-same'),
      tabCross: document.getElementById('tab-mode-cross'),
      viewSame: document.getElementById('view-same-network'),
      viewCross: document.getElementById('view-cross-network'),
      flowBtnsSame: document.getElementById('flow-buttons-same'),
      flowBtnsCross: document.getElementById('flow-buttons-cross'),

      // 控制按钮
      btnPlay: document.getElementById('btn-play'),
      playIcon: document.getElementById('play-icon'),
      playText: document.getElementById('play-text'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      btnReset: document.getElementById('btn-reset'),
      stateDot: document.getElementById('state-dot'),
      stateText: document.getElementById('state-text'),

      // 实时监测器
      inspStatusBadge: document.getElementById('inspector-status-badge'),
      encapBadge: document.getElementById('encap-badge'),
      inspType: document.getElementById('insp-type'),
      inspOpcode: document.getElementById('insp-opcode'),
      inspSmac: document.getElementById('insp-smac'),
      inspSmacNote: document.getElementById('insp-smac-note'),
      inspDmac: document.getElementById('insp-dmac'),
      inspDmacNote: document.getElementById('insp-dmac-note'),
      inspSip: document.getElementById('insp-sip'),
      inspSipNote: document.getElementById('insp-sip-note'),
      inspDip: document.getElementById('insp-dip'),
      inspDipNote: document.getElementById('insp-dip-note'),
      inspEtherType: document.getElementById('insp-ether-type'),
      inspAction: document.getElementById('insp-action'),
      descText: document.getElementById('desc-text'),
      descStep: document.getElementById('desc-step'),

      // 同网络舞台元素
      stageSameContainer: document.getElementById('stage-same-container'),
      svgSameLinks: document.getElementById('svg-same-links'),
      packetsLayerSame: document.getElementById('packets-layer-same'),
      sameSwitch: document.getElementById('same-switch'),
      hostH1: document.getElementById('host-h1'),
      hostH2: document.getElementById('host-h2'),
      hostH3: document.getElementById('host-h3'),
      hostH4: document.getElementById('host-h4'),
      h1Badge: document.getElementById('h1-badge'),
      h2Badge: document.getElementById('h2-badge'),
      h3Badge: document.getElementById('h3-badge'),
      h4Badge: document.getElementById('h4-badge'),
      h1EncapBox: document.getElementById('h1-encap-box'),
      h2EncapBox: document.getElementById('h2-encap-box'),
      h3EncapBox: document.getElementById('h3-encap-box'),
      h4EncapBox: document.getElementById('h4-encap-box'),
      h1Tbody: document.getElementById('h1-arp-tbody'),
      h2Tbody: document.getElementById('h2-arp-tbody'),
      h3Tbody: document.getElementById('h3-arp-tbody'),
      h4Tbody: document.getElementById('h4-arp-tbody'),

      // 跨网络舞台元素
      stageCrossContainer: document.getElementById('stage-cross-container'),
      svgCrossLinks: document.getElementById('svg-cross-links'),
      packetsLayerCross: document.getElementById('packets-layer-cross'),
      crossHostA: document.getElementById('cross-host-a'),
      crossHostB: document.getElementById('cross-host-b'),
      crossHostC: document.getElementById('cross-host-c'),
      crossHostD: document.getElementById('cross-host-d'),
      crossSw1: document.getElementById('cross-sw1'),
      crossSw2: document.getElementById('cross-sw2'),
      routerR1: document.getElementById('router-r1'),
      haBadge: document.getElementById('ha-badge'),
      hbBadge: document.getElementById('hb-badge'),
      hcBadge: document.getElementById('hc-badge'),
      hdBadge: document.getElementById('hd-badge'),
      haEncapBox: document.getElementById('ha-encap-box'),
      hbEncapBox: document.getElementById('hb-encap-box'),
      hcEncapBox: document.getElementById('hc-encap-box'),
      hdEncapBox: document.getElementById('hd-encap-box'),
      r1EncapBox: document.getElementById('r1-encap-box'),
      r1StatusBadge: document.getElementById('r1-status-badge'),
      routeLookupStatus: document.getElementById('route-lookup-status'),
      haTbody: document.getElementById('ha-arp-tbody'),
      hbTbody: document.getElementById('hb-arp-tbody'),
      hcTbody: document.getElementById('hc-arp-tbody'),
      hdTbody: document.getElementById('hd-arp-tbody'),
      r1Tbody: document.getElementById('r1-arp-tbody'),
      routeRow1: document.getElementById('route-row-1'),
      routeRow2: document.getElementById('route-row-2'),
      routeRowDef: document.getElementById('route-row-def')
    };
  }

  // =========================================================================
  // 2. 动效增强：封装 (加入 MAC 头) 与 解封装 (剥离 MAC 头) 动画系统
  // =========================================================================
  /**
   * 封装动画：
   * 1. 初始仅展示内部载荷 (ARP 报文 或 IP 数据报)；
   * 2. 随后通过 GSAP 动画，向其左侧滑入 MAC 帧头并包裹外框，形成完整以太网帧。
   */
  function animateEncapsulation({
    slotEl,
    payloadType = 'arp', // 'arp' | 'ip'
    payloadLabel = 'ARP 请求',
    payloadContent = '',
    macHeader = '',
    isIpFrame = false,
    onComplete = null
  }) {
    if (!slotEl) return;

    // 清空槽位
    slotEl.innerHTML = '';

    // 创建外层容器
    const frameContainer = document.createElement('div');
    frameContainer.className = `mac-outer-frame ${isIpFrame ? 'is-ip-frame' : ''}`;
    frameContainer.style.opacity = '0';
    frameContainer.style.transform = 'scale(0.95)';

    // 创建内部载荷 (先单独呈现)
    const payloadEl = document.createElement('div');
    payloadEl.className = `inner-payload-${payloadType}`;
    payloadEl.innerHTML = `
      <span class="px-1 py-0.2 rounded ${payloadType === 'arp' ? 'bg-amber-200 text-amber-900' : 'bg-sky-200 text-sky-900'} text-[9px] font-bold">
        ${payloadLabel}
      </span>
      <span>${payloadContent}</span>
    `;

    frameContainer.appendChild(payloadEl);
    slotEl.appendChild(frameContainer);

    // 载荷淡入
    gsap.to(frameContainer, {
      opacity: 1,
      scale: 1,
      duration: 0.3 / state.speed,
      ease: 'power2.out',
      onComplete: () => {
        // 延时后滑入 MAC 帧头
        setTimeout(() => {
          const macHeaderEl = document.createElement('div');
          macHeaderEl.className = 'mac-header-tag';
          macHeaderEl.style.opacity = '0';
          macHeaderEl.style.transform = 'translateX(-22px)';
          macHeaderEl.innerHTML = `
            <span class="text-amber-300 font-bold">MAC头</span>
            <span>${macHeader}</span>
          `;

          // 插入到载荷前面
          frameContainer.insertBefore(macHeaderEl, payloadEl);

          // GSAP 动画：滑入并包裹
          gsap.to(macHeaderEl, {
            opacity: 1,
            x: 0,
            duration: 0.45 / state.speed,
            ease: 'power2.out',
            onComplete: () => {
              if (onComplete) onComplete();
            }
          });
        }, 320 / state.speed);
      }
    });
  }

  /**
   * 解封装动画：
   * 1. 初始呈现完整 MAC 帧 (MAC 帧头 + 内部载荷)；
   * 2. 随后 MAC 帧头向上剥离淡出 (y: -22, opacity: 0)；
   * 3. 剥离完成后，内部载荷平滑居中并显示 IP 匹配高亮。
   */
  function animateDecapsulation({
    slotEl,
    macHeader = '',
    payloadType = 'arp',
    payloadContent = '',
    matchedText = '✓ 目的 IP 匹配本机！',
    isIpFrame = false,
    onComplete = null
  }) {
    if (!slotEl) return;

    slotEl.innerHTML = '';

    const frameContainer = document.createElement('div');
    frameContainer.className = `mac-outer-frame ${isIpFrame ? 'is-ip-frame' : ''}`;

    const macHeaderEl = document.createElement('div');
    macHeaderEl.className = 'mac-header-tag';
    macHeaderEl.innerHTML = `
      <span class="text-amber-300 font-bold">MAC头</span>
      <span>${macHeader}</span>
    `;

    const payloadEl = document.createElement('div');
    payloadEl.className = `inner-payload-${payloadType}`;
    payloadEl.innerHTML = `<span>${payloadContent}</span>`;

    frameContainer.appendChild(macHeaderEl);
    frameContainer.appendChild(payloadEl);
    slotEl.appendChild(frameContainer);

    // 短暂停留后执行剥离动画
    setTimeout(() => {
      gsap.to(macHeaderEl, {
        y: -22,
        opacity: 0,
        scale: 0.85,
        duration: 0.45 / state.speed,
        ease: 'power2.in',
        onComplete: () => {
          macHeaderEl.remove();

          // 呈现解封后的高亮条
          frameContainer.className = 'mac-outer-frame is-decap-done';
          payloadEl.className = 'decap-matched-payload';
          payloadEl.innerHTML = `<span>${matchedText}</span>`;

          gsap.fromTo(payloadEl, 
            { scale: 0.92, opacity: 0.8 }, 
            { scale: 1, opacity: 1, duration: 0.3 / state.speed, ease: 'back.out(1.5)', onComplete }
          );
        }
      });
    }, 380 / state.speed);
  }

  // =========================================================================
  // 3. 丝滑无跳变 ARP 缓存表更新系统 (Silky Smooth Cache Table Engine)
  // =========================================================================
  function insertArpRowSmooth(tbody, ip, mac, type = '动态', isHighlight = true, onComplete = null) {
    if (!tbody) return;

    const existingRows = tbody.querySelectorAll('tr:not(.empty-row)');
    for (let r of existingRows) {
      if (r.dataset.ip === ip) {
        if (isHighlight) {
          r.classList.add('arp-row-hit');
          setTimeout(() => r.classList.remove('arp-row-hit'), 1200 / state.speed);
        }
        if (onComplete) onComplete();
        return;
      }
    }

    const emptyRow = tbody.querySelector('.empty-row');
    if (emptyRow) {
      emptyRow.remove();
    }

    const tr = document.createElement('tr');
    tr.dataset.ip = ip;
    tr.className = 'arp-row-anim text-[10px]';
    tr.style.opacity = '0';
    tr.style.maxHeight = '0px';
    tr.style.transform = 'translateY(-6px)';
    tr.style.overflow = 'hidden';

    tr.innerHTML = `
      <td class="py-1 font-semibold text-stone-800">${ip}</td>
      <td class="py-1 text-stone-600">${mac}</td>
      <td class="py-1">
        <span class="px-1.5 py-0.2 rounded bg-stone-100 text-stone-600 text-[9px] font-mono border border-stone-200">
          ${type}
        </span>
      </td>
    `;

    tbody.appendChild(tr);

    tr.style.maxHeight = 'none';
    const naturalHeight = tr.offsetHeight || 28;
    tr.style.maxHeight = '0px';

    gsap.to(tr, {
      maxHeight: naturalHeight + 4,
      opacity: 1,
      y: 0,
      duration: 0.45 / state.speed,
      ease: 'power2.out',
      onComplete: () => {
        tr.style.maxHeight = 'none';
        if (isHighlight) {
          tr.classList.add('arp-row-new');
          setTimeout(() => {
            tr.classList.remove('arp-row-new');
          }, 1500 / state.speed);
        }
        if (onComplete) onComplete();
      }
    });
  }

  function clearArpTable(tbody, emptyMsg = '暂无条目 (冷启动)') {
    if (!tbody) return;
    tbody.innerHTML = `
      <tr class="empty-row text-stone-400 text-center">
        <td colspan="3" class="py-1.5">${emptyMsg}</td>
      </tr>
    `;
  }

  // =========================================================================
  // 4. 实时报文透视与字段监测器更新 (Packet Inspector HUD)
  // =========================================================================
  function updateInspector(data) {
    if (!data) {
      dom.inspStatusBadge.textContent = '等待报文生成';
      dom.inspStatusBadge.className = 'px-2 py-0.5 rounded text-[11px] font-mono bg-stone-100 text-stone-600 border border-stone-200';
      dom.encapBadge.textContent = '空闲';
      dom.encapBadge.className = 'font-semibold text-stone-800';
      dom.inspType.textContent = '--';
      dom.inspOpcode.textContent = '操作码: --';
      dom.inspSmac.textContent = '--';
      dom.inspSmacNote.textContent = '--';
      dom.inspDmac.textContent = '--';
      dom.inspDmacNote.textContent = '--';
      dom.inspSip.textContent = '--';
      dom.inspSipNote.textContent = '--';
      dom.inspDip.textContent = '--';
      dom.inspDipNote.textContent = '--';
      dom.inspEtherType.textContent = '--';
      dom.inspAction.textContent = '待命';
      return;
    }

    dom.inspStatusBadge.textContent = data.badgeText || '报文传输中';
    dom.inspStatusBadge.className = `px-2 py-0.5 rounded text-[11px] font-mono border ${data.badgeClass || 'bg-amber-50 text-amber-800 border-amber-200'}`;

    dom.encapBadge.textContent = data.encapStage || '已封装';
    dom.encapBadge.className = `font-semibold ${data.encapClass || 'text-stone-800'}`;

    dom.inspType.textContent = data.type || '--';
    dom.inspOpcode.textContent = data.opcode ? `操作码: ${data.opcode}` : '--';
    dom.inspSmac.textContent = data.smac || '--';
    dom.inspSmacNote.textContent = data.smacNote || '';
    dom.inspDmac.textContent = data.dmac || '--';
    dom.inspDmacNote.textContent = data.dmacNote || '';
    dom.inspSip.textContent = data.sip || '--';
    dom.inspSipNote.textContent = data.sipNote || '';
    dom.inspDip.textContent = data.dip || '--';
    dom.inspDipNote.textContent = data.dipNote || '';
    dom.inspEtherType.textContent = data.etherType || '0x0806 (ARP)';
    dom.inspAction.textContent = data.action || '';

    if (data.desc) {
      dom.descText.textContent = data.desc;
    }
    if (data.stepText) {
      dom.descStep.textContent = data.stepText;
    }
  }

  // =========================================================================
  // 5. 拓扑连线与坐标计算 (SVG Dynamic Links)
  // =========================================================================
  function getCenterCoords(el, container) {
    if (!el || !container) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    return {
      x: rect.left - cRect.left + rect.width / 2,
      y: rect.top - cRect.top + rect.height / 2
    };
  }

  function drawSvgLine(svg, id, p1, p2, strokeColor = '#E5E4DC', isDashed = false) {
    let line = svg.querySelector(`#${id}`);
    if (!line) {
      line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('id', id);
      svg.appendChild(line);
    }
    line.setAttribute('x1', p1.x);
    line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x);
    line.setAttribute('y2', p2.y);
    line.setAttribute('stroke', strokeColor);
    line.setAttribute('stroke-width', '2');
    if (isDashed) {
      line.setAttribute('stroke-dasharray', '5,5');
    } else {
      line.removeAttribute('stroke-dasharray');
    }
  }

  function updateTopologyLinks() {
    if (state.scenario === 'same') {
      const container = dom.stageSameContainer;
      const svg = dom.svgSameLinks;
      if (!container || !svg) return;

      const pSw = getCenterCoords(dom.sameSwitch, container);
      const pH1 = getCenterCoords(dom.hostH1, container);
      const pH2 = getCenterCoords(dom.hostH2, container);
      const pH3 = getCenterCoords(dom.hostH3, container);
      const pH4 = getCenterCoords(dom.hostH4, container);

      drawSvgLine(svg, 'link-sw-h1', pSw, pH1, '#CBD5E1');
      drawSvgLine(svg, 'link-sw-h2', pSw, pH2, '#CBD5E1');
      drawSvgLine(svg, 'link-sw-h3', pSw, pH3, '#CBD5E1');
      drawSvgLine(svg, 'link-sw-h4', pSw, pH4, '#CBD5E1');
    } else {
      const container = dom.stageCrossContainer;
      const svg = dom.svgCrossLinks;
      if (!container || !svg) return;

      const pHa = getCenterCoords(dom.crossHostA, container);
      const pHb = getCenterCoords(dom.crossHostB, container);
      const pSw1 = getCenterCoords(dom.crossSw1, container);
      const pR1Eth0 = getCenterCoords(document.getElementById('r1-eth0-card'), container);
      const pR1Eth1 = getCenterCoords(document.getElementById('r1-eth1-card'), container);
      const pSw2 = getCenterCoords(dom.crossSw2, container);
      const pHc = getCenterCoords(dom.crossHostC, container);
      const pHd = getCenterCoords(dom.crossHostD, container);

      drawSvgLine(svg, 'link-ha-sw1', pHa, pSw1, '#CBD5E1');
      drawSvgLine(svg, 'link-hb-sw1', pHb, pSw1, '#CBD5E1');
      drawSvgLine(svg, 'link-sw1-r1', pSw1, pR1Eth0, '#0284C7');
      drawSvgLine(svg, 'link-r1-sw2', pR1Eth1, pSw2, '#059669');
      drawSvgLine(svg, 'link-sw2-hc', pSw2, pHc, '#CBD5E1');
      drawSvgLine(svg, 'link-sw2-hd', pSw2, pHd, '#CBD5E1');
    }
  }

  // =========================================================================
  // 6. 报文飞行动画与上方实时字段浮窗 (Flying Packet Engine)
  // =========================================================================
  function flyPacket({
    layer,
    startPos,
    endPos,
    duration = 1.0,
    title = 'ARP 请求',
    detail = '',
    extra = '',
    coreType = 'arp-req',
    coreIcon = '📨',
    coreLabel = 'ARP Request',
    onComplete = null
  }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'flying-packet-wrapper';

    let typeClass = 'packet-capsule-arp-req';
    if (coreType === 'arp-rep') typeClass = 'packet-capsule-arp-rep';
    if (coreType === 'ip-data') typeClass = 'packet-capsule-ip-data';

    wrapper.innerHTML = `
      <div class="packet-field-tooltip">
        <div class="tooltip-title">${title}</div>
        <div class="tooltip-detail">${detail}</div>
        ${extra ? `<div class="tooltip-detail font-mono">${extra}</div>` : ''}
      </div>
      <div class="packet-capsule-core ${typeClass}">
        <span>${coreIcon}</span>
        <span>${coreLabel}</span>
      </div>
    `;

    wrapper.style.left = `${startPos.x}px`;
    wrapper.style.top = `${startPos.y}px`;
    layer.appendChild(wrapper);

    const actualDuration = duration / state.speed;

    const tween = gsap.to(wrapper, {
      left: endPos.x,
      top: endPos.y,
      duration: actualDuration,
      ease: 'power1.inOut',
      onComplete: () => {
        wrapper.remove();
        if (onComplete) onComplete();
      }
    });

    state.activeTweens.push(tween);
    return tween;
  }

  // 显示丢弃浮标 (保证位置在卡片上方偏高处，绝不遮挡槽位文字)
  function showDiscardBadge(container, pos, reason = 'IP 不匹配 (丢弃)') {
    const badge = document.createElement('div');
    badge.className = 'discard-badge animate-shake';
    badge.innerHTML = `<span>✕</span> <span>${reason}</span>`;
    badge.style.left = `${pos.x}px`;
    badge.style.top = `${pos.y - 75}px`; // 避开中间的槽位，置于顶部
    badge.style.transform = 'translate(-50%, -50%)';
    container.appendChild(badge);

    gsap.fromTo(badge, 
      { opacity: 0, scale: 0.8 }, 
      { 
        opacity: 1, 
        scale: 1, 
        duration: 0.25 / state.speed,
        onComplete: () => {
          gsap.to(badge, {
            opacity: 0,
            y: -10,
            delay: 1.2 / state.speed,
            duration: 0.4 / state.speed,
            onComplete: () => badge.remove()
          });
        }
      }
    );
  }

  // =========================================================================
  // 7. 同网络场景核心流程 (Same Network Workflows)
  // =========================================================================
  const sameEngine = {
    getStepCount(flow) {
      if (flow === 1) return 5;
      if (flow === 2) return 5;
      if (flow === 3) return 3;
      return 5;
    },

    runStep(flow, step) {
      if (flow === 1) this.runFlow1(step);
      else if (flow === 2) this.runFlow2(step);
      else if (flow === 3) this.runFlow3(step);
    },

    // 流程 1：H1 -> H2 (冷启动广播解析与交付)
    runFlow1(step) {
      const container = dom.stageSameContainer;
      const layer = dom.packetsLayerSame;
      const pSw = getCenterCoords(dom.sameSwitch, container);
      const pH1 = getCenterCoords(dom.hostH1, container);
      const pH2 = getCenterCoords(dom.hostH2, container);
      const pH3 = getCenterCoords(dom.hostH3, container);
      const pH4 = getCenterCoords(dom.hostH4, container);

      dom.hostH1.className = 'host-node-card bg-[#FAF9F5] border-2 border-[#E5E4DC] rounded-xl p-3 shadow-sm';
      dom.hostH2.className = 'host-node-card bg-[#FAF9F5] border-2 border-[#E5E4DC] rounded-xl p-3 shadow-sm';
      dom.hostH3.className = 'host-node-card bg-[#FAF9F5] border-2 border-[#E5E4DC] rounded-xl p-3 shadow-sm';
      dom.hostH4.className = 'host-node-card bg-[#FAF9F5] border-2 border-[#E5E4DC] rounded-xl p-3 shadow-sm';

      if (step === 1) {
        // 步骤 1：H1 生成 IP 数据报，检查 ARP 缓存未命中
        dom.hostH1.classList.add('is-active-src');
        dom.h1Badge.textContent = 'IP 数据报已生成';
        dom.h1Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-sky-100 text-sky-800 font-bold';

        // 初始仅显示 IP 数据报载荷
        dom.h1EncapBox.innerHTML = `
          <div class="inner-payload-ip">
            <span class="px-1 py-0.2 bg-sky-200 text-sky-900 rounded text-[9px] font-bold">IPv4 数据报</span>
            <span>192.168.1.10 → 192.168.1.20</span>
          </div>
        `;

        updateInspector({
          badgeText: 'IP 数据报已生成 · 触发 ARP',
          badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
          encapStage: '未封装 MAC 帧 (待求目的 MAC)',
          encapClass: 'text-amber-600',
          type: 'IPv4 数据报 (待交付)',
          opcode: '--',
          smac: '00-11-22-33-44-01',
          smacNote: '主机 1 网卡',
          dmac: '??-??-??-??-??-??',
          dmacNote: '未知 (查 ARP 缓存未命中)',
          sip: '192.168.1.10',
          sipNote: '主机 1',
          dip: '192.168.1.20',
          dipNote: '主机 2',
          etherType: '0x0800 (IPv4)',
          action: '查表未命中 (MISS)',
          desc: '【步骤 1/5】主机 1 准备向主机 2 发送 IP 数据报。查询本地 ARP 缓存表未命中，无法直接封装 MAC 帧，必须发起 ARP 请求广播！',
          stepText: '步骤 1 / 5'
        });
      }
      else if (step === 2) {
        // 步骤 2：初始显示 ARP 报文，随后动画加入 MAC 广播帧头！
        dom.hostH1.classList.add('is-active-src');
        dom.h1Badge.textContent = '封装 MAC 广播帧';
        dom.h1Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-100 text-amber-800 font-bold';

        animateEncapsulation({
          slotEl: dom.h1EncapBox,
          payloadType: 'arp',
          payloadLabel: 'ARP 请求 (0x0001)',
          payloadContent: '谁有 192.168.1.20? 告诉 192.168.1.10',
          macHeader: '目的: FF-FF-FF-FF-FF-FF | 类型: 0x0806'
        });

        updateInspector({
          badgeText: 'ARP 请求已封装以太网广播帧',
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          encapStage: '已封装 MAC 广播帧',
          encapClass: 'text-stone-800',
          type: 'ARP 请求 (ARP Request)',
          opcode: '0x0001 (Request)',
          smac: '00-11-22-33-44-01',
          smacNote: '源 MAC: 主机 1',
          dmac: 'FF-FF-FF-FF-FF-FF',
          dmacNote: '以太网广播 MAC',
          sip: '192.168.1.10',
          sipNote: '发送方 IP',
          dip: '192.168.1.20',
          dipNote: '目标 IP (Who has?)',
          etherType: '0x0806 (ARP)',
          action: '准备全网广播',
          desc: '【步骤 2/5】初始生成 ARP 请求报文，随后通过数据链路层为其添加 MAC 广播帧头（目的 MAC: FF-FF-FF-FF-FF-FF），封装完成准备广播。',
          stepText: '步骤 2 / 5'
        });
      }
      else if (step === 3) {
        // 步骤 3：广播传输，非目的丢弃，目的主机收到后动画剥离 MAC 帧头并匹配！
        dom.hostH1.classList.add('is-active-src');
        dom.hostH2.classList.add('is-active-dst');

        updateInspector({
          badgeText: '广播扩散中 · 交换机泛洪',
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          encapStage: 'MAC 广播帧传输中',
          encapClass: 'text-amber-700',
          type: 'ARP 请求 (0x0001)',
          opcode: '0x0001',
          smac: '00-11-22-33-44-01',
          smacNote: '主机 1',
          dmac: 'FF-FF-FF-FF-FF-FF',
          dmacNote: '全网广播',
          sip: '192.168.1.10',
          sipNote: '主机 1',
          dip: '192.168.1.20',
          dipNote: '主机 2',
          etherType: '0x0806 (ARP)',
          action: '交换机向全端口广播',
          desc: '【步骤 3/5】广播帧抵交换机并泛洪。H3、H4 收到后因目的 IP 不匹配硬件丢弃；H2 收到后剥离 MAC 帧头，确认 IP 匹配成功并更新缓存！',
          stepText: '步骤 3 / 5'
        });

        // H1 -> 交换机
        flyPacket({
          layer,
          startPos: pH1,
          endPos: pSw,
          duration: 0.6,
          title: 'ARP 请求 (0x0001)',
          detail: 'Src: H1 ➔ Dst: 广播',
          extra: '目标 IP: 192.168.1.20',
          coreType: 'arp-req',
          coreIcon: '📢',
          coreLabel: 'ARP Broadcast',
          onComplete: () => {
            // 交换机广播向 H3 (丢弃)
            flyPacket({
              layer,
              startPos: pSw,
              endPos: pH3,
              duration: 0.7,
              title: 'ARP 请求 (广播)',
              coreType: 'arp-req',
              coreIcon: '📢',
              coreLabel: 'ARP Req',
              onComplete: () => {
                showDiscardBadge(container, pH3, 'IP 192.168.1.20 ≠ 本机 (丢弃)');
                dom.hostH3.classList.add('is-discarded');
                dom.h3Badge.textContent = '✕ IP不匹配(丢弃)';
                dom.h3Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-100 text-rose-800 font-bold';
              }
            });

            // 交换机广播向 H4 (丢弃)
            flyPacket({
              layer,
              startPos: pSw,
              endPos: pH4,
              duration: 0.7,
              title: 'ARP 请求 (广播)',
              coreType: 'arp-req',
              coreIcon: '📢',
              coreLabel: 'ARP Req',
              onComplete: () => {
                showDiscardBadge(container, pH4, 'IP 192.168.1.20 ≠ 本机 (丢弃)');
                dom.hostH4.classList.add('is-discarded');
                dom.h4Badge.textContent = '✕ IP不匹配(丢弃)';
                dom.h4Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-100 text-rose-800 font-bold';
              }
            });

            // 交换机广播向 H2 (匹配接受并剥离 MAC 头)
            flyPacket({
              layer,
              startPos: pSw,
              endPos: pH2,
              duration: 0.7,
              title: 'ARP 请求 (广播)',
              detail: '目标: 192.168.1.20 (匹配!)',
              coreType: 'arp-req',
              coreIcon: '🎯',
              coreLabel: 'ARP Match',
              onComplete: () => {
                dom.h2Badge.textContent = '✓ IP 匹配成功';
                dom.h2Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                // 执行 MAC 帧头剥离动画！
                animateDecapsulation({
                  slotEl: dom.h2EncapBox,
                  macHeader: '目的: FF-FF-FF-FF-FF-FF',
                  payloadType: 'arp',
                  payloadContent: 'ARP: 谁有 192.168.1.20?',
                  matchedText: '✓ 剥离 MAC 头 · 目的 IP 匹配本机 (192.168.1.20)',
                  onComplete: () => {
                    // 丝滑更新 H2 的 ARP 缓存表
                    insertArpRowSmooth(dom.h2Tbody, '192.168.1.10', '00-11-22-33-44-01', '动态', true, () => {
                      document.getElementById('h2-cache-count').textContent = '1 条目';
                    });
                  }
                });
              }
            });
          }
        });
      }
      else if (step === 4) {
        // 步骤 4：H2 生成 ARP 响应，动画加入单播 MAC 帧头并发送给 H1
        dom.hostH2.classList.add('is-active-src');
        dom.hostH1.classList.add('is-active-dst');
        dom.h2Badge.textContent = '单播 ARP 响应';
        dom.h2Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-bold';

        animateEncapsulation({
          slotEl: dom.h2EncapBox,
          payloadType: 'arp',
          payloadLabel: 'ARP 响应 (0x0002)',
          payloadContent: '我的 MAC 是 00-11-22-33-44-02',
          macHeader: '目的: 00-11-22-33-44-01 | 类型: 0x0806'
        });

        updateInspector({
          badgeText: 'ARP 响应单播传输中',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          encapStage: '已封装单播 MAC 帧',
          encapClass: 'text-emerald-700',
          type: 'ARP 响应 (ARP Reply)',
          opcode: '0x0002 (Reply)',
          smac: '00-11-22-33-44-02',
          smacNote: '主机 2 网卡',
          dmac: '00-11-22-33-44-01',
          dmacNote: '主机 1 网卡 (单播)',
          sip: '192.168.1.20',
          sipNote: '主机 2',
          dip: '192.168.1.10',
          dipNote: '主机 1',
          etherType: '0x0806 (ARP)',
          action: '单播发往主机 1',
          desc: '【步骤 4/5】主机 2 初始构建 ARP Reply 响应报文，随后动画加入目的为 H1 的单播 MAC 帧头，单播送达主机 1。H1 剥离 MAC 头并更新缓存！',
          stepText: '步骤 4 / 5'
        });

        flyPacket({
          layer,
          startPos: pH2,
          endPos: pSw,
          duration: 0.6,
          title: 'ARP 响应 (0x0002)',
          detail: 'Src: H2 ➔ Dst: H1 (单播)',
          extra: '告知 MAC: 00-11-22-33-44-02',
          coreType: 'arp-rep',
          coreIcon: '✉️',
          coreLabel: 'ARP Reply',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw,
              endPos: pH1,
              duration: 0.6,
              title: 'ARP 响应 (0x0002)',
              detail: 'Src: H2 ➔ Dst: H1',
              coreType: 'arp-rep',
              coreIcon: '✉️',
              coreLabel: 'ARP Reply',
              onComplete: () => {
                dom.h1Badge.textContent = '✓ 获得 H2 MAC';
                dom.h1Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                // H1 剥离 MAC 头动画
                animateDecapsulation({
                  slotEl: dom.h1EncapBox,
                  macHeader: '目的: 00-11-22-33-44-01',
                  payloadType: 'arp',
                  payloadContent: 'ARP Reply: 192.168.1.20 MAC 是 00-11-22-33-44-02',
                  matchedText: '✓ 剥离 MAC 头 · 成功学到 H2 MAC 地址',
                  onComplete: () => {
                    insertArpRowSmooth(dom.h1Tbody, '192.168.1.20', '00-11-22-33-44-02', '动态', true, () => {
                      document.getElementById('h1-cache-count').textContent = '1 条目';
                    });
                  }
                });
              }
            });
          }
        });
      }
      else if (step === 5) {
        // 步骤 5：H1 初始显示 IP 数据报，随后动画加入 MAC 帧头，交付给 H2
        dom.hostH1.classList.add('is-active-src');
        dom.hostH2.classList.add('is-active-dst');
        dom.h1Badge.textContent = '封装 IP 数据帧';
        dom.h1Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-sky-100 text-sky-800 font-bold';

        animateEncapsulation({
          slotEl: dom.h1EncapBox,
          payloadType: 'ip',
          payloadLabel: 'IPv4 数据报',
          payloadContent: '192.168.1.10 → 192.168.1.20',
          macHeader: '目的: 00-11-22-33-44-02 | 类型: 0x0800',
          isIpFrame: true
        });

        updateInspector({
          badgeText: 'IP 数据报成功交付',
          badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
          encapStage: '已封装单播以太网帧 (Type 0x0800)',
          encapClass: 'text-sky-700',
          type: 'IPv4 数据报 (单播数据帧)',
          opcode: '--',
          smac: '00-11-22-33-44-01',
          smacNote: '源 MAC: 主机 1',
          dmac: '00-11-22-33-44-02',
          dmacNote: '目的 MAC: 主机 2 (已查缓存获得)',
          sip: '192.168.1.10',
          sipNote: '主机 1',
          dip: '192.168.1.20',
          dipNote: '主机 2',
          etherType: '0x0800 (IPv4)',
          action: '数据帧单播交付',
          desc: '【步骤 5/5】主机 1 查缓存获得 H2 的 MAC 地址，动画为其包裹 MAC 帧头封装成帧并发送。H2 接收后剥离 MAC 帧头取出 IP 数据报，交付完成！',
          stepText: '步骤 5 / 5'
        });

        flyPacket({
          layer,
          startPos: pH1,
          endPos: pSw,
          duration: 0.6,
          title: 'IP 数据帧 (0x0800)',
          detail: 'Src: H1 ➔ Dst: H2',
          extra: 'Payload: IPv4 Datagram',
          coreType: 'ip-data',
          coreIcon: '📦',
          coreLabel: 'IPv4 Data',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw,
              endPos: pH2,
              duration: 0.6,
              title: 'IP 数据帧 (0x0800)',
              detail: 'Src: H1 ➔ Dst: H2',
              coreType: 'ip-data',
              coreIcon: '📦',
              coreLabel: 'IPv4 Data',
              onComplete: () => {
                dom.h2Badge.textContent = '✓ 数据报交付完成';
                dom.h2Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                // H2 剥离 MAC 头动画
                animateDecapsulation({
                  slotEl: dom.h2EncapBox,
                  macHeader: '目的: 00-11-22-33-44-02',
                  payloadType: 'ip',
                  payloadContent: 'IP: 192.168.1.10 → 192.168.1.20',
                  matchedText: '✓ 剥离 MAC 帧头 · 完整交付 IP 数据报！',
                  isIpFrame: true
                });
              }
            });
          }
        });
      }
    },

    // 流程 2：H3 -> H4 (局域网独立解析)
    runFlow2(step) {
      const container = dom.stageSameContainer;
      const layer = dom.packetsLayerSame;
      const pSw = getCenterCoords(dom.sameSwitch, container);
      const pH1 = getCenterCoords(dom.hostH1, container);
      const pH2 = getCenterCoords(dom.hostH2, container);
      const pH3 = getCenterCoords(dom.hostH3, container);
      const pH4 = getCenterCoords(dom.hostH4, container);

      dom.hostH1.className = 'host-node-card bg-[#FAF9F5] border-2 border-[#E5E4DC] rounded-xl p-3 shadow-sm';
      dom.hostH2.className = 'host-node-card bg-[#FAF9F5] border-2 border-[#E5E4DC] rounded-xl p-3 shadow-sm';
      dom.hostH3.className = 'host-node-card bg-[#FAF9F5] border-2 border-[#E5E4DC] rounded-xl p-3 shadow-sm';
      dom.hostH4.className = 'host-node-card bg-[#FAF9F5] border-2 border-[#E5E4DC] rounded-xl p-3 shadow-sm';

      if (step === 1) {
        dom.hostH3.classList.add('is-active-src');
        dom.h3Badge.textContent = 'IP 数据报已生成';
        dom.h3Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-sky-100 text-sky-800 font-bold';

        dom.h3EncapBox.innerHTML = `
          <div class="inner-payload-ip">
            <span class="px-1 py-0.2 bg-sky-200 text-sky-900 rounded text-[9px] font-bold">IPv4 数据报</span>
            <span>192.168.1.30 → 192.168.1.40</span>
          </div>
        `;

        updateInspector({
          badgeText: 'IP 数据报已生成 · 查表未命中',
          badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
          encapStage: '未封装 MAC 帧',
          encapClass: 'text-amber-600',
          type: 'IPv4 数据报',
          opcode: '--',
          smac: '00-11-22-33-44-03',
          smacNote: '主机 3 网卡',
          dmac: '??-??-??-??-??-??',
          dmacNote: '未知 (查 ARP 缓存未命中)',
          sip: '192.168.1.30',
          sipNote: '主机 3',
          dip: '192.168.1.40',
          dipNote: '主机 4',
          etherType: '0x0800',
          action: '触发 ARP 请求',
          desc: '【步骤 1/5】主机 3 准备向主机 4 发送 IP 数据报。H3 的 ARP 缓存中没有 H4 的条目，准备广播 ARP 请求。',
          stepText: '步骤 1 / 5'
        });
      }
      else if (step === 2) {
        dom.hostH3.classList.add('is-active-src');
        dom.h3Badge.textContent = '封装 MAC 广播帧';
        dom.h3Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-100 text-amber-800 font-bold';

        animateEncapsulation({
          slotEl: dom.h3EncapBox,
          payloadType: 'arp',
          payloadLabel: 'ARP 请求 (0x0001)',
          payloadContent: '谁有 192.168.1.40? 告诉 192.168.1.30',
          macHeader: '目的: FF-FF-FF-FF-FF-FF | 类型: 0x0806'
        });

        updateInspector({
          badgeText: 'ARP 请求广播帧构建完毕',
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          encapStage: '已封装 MAC 广播帧',
          encapClass: 'text-stone-800',
          type: 'ARP 请求 (0x0001)',
          opcode: '0x0001 (Request)',
          smac: '00-11-22-33-44-03',
          smacNote: '主机 3',
          dmac: 'FF-FF-FF-FF-FF-FF',
          dmacNote: '以太网广播 MAC',
          sip: '192.168.1.30',
          sipNote: '主机 3',
          dip: '192.168.1.40',
          dipNote: '主机 4',
          etherType: '0x0806 (ARP)',
          action: '发起广播',
          desc: '【步骤 2/5】初始生成 ARP 请求报文，随后动画为其加入 MAC 广播帧头，准备全网广播。',
          stepText: '步骤 2 / 5'
        });
      }
      else if (step === 3) {
        dom.hostH3.classList.add('is-active-src');
        dom.hostH4.classList.add('is-active-dst');

        updateInspector({
          badgeText: '广播泛洪扩散',
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          encapStage: '广播帧扩散',
          encapClass: 'text-amber-700',
          type: 'ARP 请求 (0x0001)',
          opcode: '0x0001',
          smac: '00-11-22-33-44-03',
          smacNote: '主机 3',
          dmac: 'FF-FF-FF-FF-FF-FF',
          dmacNote: '全网广播',
          sip: '192.168.1.30',
          sipNote: '主机 3',
          dip: '192.168.1.40',
          dipNote: '主机 4',
          etherType: '0x0806',
          action: 'H1、H2 硬件丢弃，H4 接收',
          desc: '【步骤 3/5】H1 与 H2 收到 MAC 广播帧，核对 IP 发现不是自己硬件丢弃；H4 剥离 MAC 帧头确认匹配成功并更新缓存！',
          stepText: '步骤 3 / 5'
        });

        flyPacket({
          layer,
          startPos: pH3,
          endPos: pSw,
          duration: 0.6,
          title: 'ARP 请求 (0x0001)',
          detail: 'Src: H3 ➔ Dst: 广播',
          coreType: 'arp-req',
          coreIcon: '📢',
          coreLabel: 'ARP Req',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw,
              endPos: pH1,
              duration: 0.7,
              title: 'ARP 请求 (广播)',
              coreType: 'arp-req',
              coreIcon: '📢',
              coreLabel: 'ARP Req',
              onComplete: () => {
                showDiscardBadge(container, pH1, 'IP 不匹配 (丢弃)');
                dom.hostH1.classList.add('is-discarded');
                dom.h1Badge.textContent = '✕ IP不匹配(丢弃)';
                dom.h1Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-100 text-rose-800 font-bold';
              }
            });

            flyPacket({
              layer,
              startPos: pSw,
              endPos: pH2,
              duration: 0.7,
              title: 'ARP 请求 (广播)',
              coreType: 'arp-req',
              coreIcon: '📢',
              coreLabel: 'ARP Req',
              onComplete: () => {
                showDiscardBadge(container, pH2, 'IP 不匹配 (丢弃)');
                dom.hostH2.classList.add('is-discarded');
                dom.h2Badge.textContent = '✕ IP不匹配(丢弃)';
                dom.h2Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-100 text-rose-800 font-bold';
              }
            });

            flyPacket({
              layer,
              startPos: pSw,
              endPos: pH4,
              duration: 0.7,
              title: 'ARP 请求 (广播)',
              detail: '目标: 192.168.1.40 (匹配!)',
              coreType: 'arp-req',
              coreIcon: '🎯',
              coreLabel: 'ARP Match',
              onComplete: () => {
                dom.h4Badge.textContent = '✓ IP 匹配成功';
                dom.h4Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                animateDecapsulation({
                  slotEl: dom.h4EncapBox,
                  macHeader: '目的: FF-FF-FF-FF-FF-FF',
                  payloadType: 'arp',
                  payloadContent: 'ARP: 谁有 192.168.1.40?',
                  matchedText: '✓ 剥离 MAC 头 · 目的 IP 匹配本机 (192.168.1.40)',
                  onComplete: () => {
                    insertArpRowSmooth(dom.h4Tbody, '192.168.1.30', '00-11-22-33-44-03', '动态', true, () => {
                      document.getElementById('h4-cache-count').textContent = '1 条目';
                    });
                  }
                });
              }
            });
          }
        });
      }
      else if (step === 4) {
        dom.hostH4.classList.add('is-active-src');
        dom.hostH3.classList.add('is-active-dst');
        dom.h4Badge.textContent = '单播 ARP 响应';
        dom.h4Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-bold';

        animateEncapsulation({
          slotEl: dom.h4EncapBox,
          payloadType: 'arp',
          payloadLabel: 'ARP 响应 (0x0002)',
          payloadContent: '我的 MAC 是 00-11-22-33-44-04',
          macHeader: '目的: 00-11-22-33-44-03 | 类型: 0x0806'
        });

        updateInspector({
          badgeText: 'ARP 响应单播返回',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          encapStage: '已封装单播 MAC 帧',
          encapClass: 'text-emerald-700',
          type: 'ARP 响应 (0x0002)',
          opcode: '0x0002 (Reply)',
          smac: '00-11-22-33-44-04',
          smacNote: '主机 4',
          dmac: '00-11-22-33-44-03',
          dmacNote: '主机 3',
          sip: '192.168.1.40',
          sipNote: '主机 4',
          dip: '192.168.1.30',
          dipNote: '主机 3',
          etherType: '0x0806',
          action: '单播返回 H3',
          desc: '【步骤 4/5】主机 4 响应单播 ARP Reply 给主机 3。H3 接收后剥离 MAC 帧头并更新缓存表。',
          stepText: '步骤 4 / 5'
        });

        flyPacket({
          layer,
          startPos: pH4,
          endPos: pSw,
          duration: 0.6,
          title: 'ARP 响应 (0x0002)',
          detail: 'Src: H4 ➔ Dst: H3',
          coreType: 'arp-rep',
          coreIcon: '✉️',
          coreLabel: 'ARP Reply',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw,
              endPos: pH3,
              duration: 0.6,
              title: 'ARP 响应 (0x0002)',
              detail: 'Src: H4 ➔ Dst: H3',
              coreType: 'arp-rep',
              coreIcon: '✉️',
              coreLabel: 'ARP Reply',
              onComplete: () => {
                dom.h3Badge.textContent = '✓ 获得 H4 MAC';
                dom.h3Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                animateDecapsulation({
                  slotEl: dom.h3EncapBox,
                  macHeader: '目的: 00-11-22-33-44-03',
                  payloadType: 'arp',
                  payloadContent: 'ARP Reply: 192.168.1.40 MAC 是 00-11-22-33-44-04',
                  matchedText: '✓ 剥离 MAC 头 · 成功学到 H4 MAC 地址',
                  onComplete: () => {
                    insertArpRowSmooth(dom.h3Tbody, '192.168.1.40', '00-11-22-33-44-04', '动态', true, () => {
                      document.getElementById('h3-cache-count').textContent = '1 条目';
                    });
                  }
                });
              }
            });
          }
        });
      }
      else if (step === 5) {
        dom.hostH3.classList.add('is-active-src');
        dom.hostH4.classList.add('is-active-dst');
        dom.h3Badge.textContent = '交付 IP 数据帧';
        dom.h3Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-sky-100 text-sky-800 font-bold';

        animateEncapsulation({
          slotEl: dom.h3EncapBox,
          payloadType: 'ip',
          payloadLabel: 'IPv4 数据报',
          payloadContent: '192.168.1.30 → 192.168.1.40',
          macHeader: '目的: 00-11-22-33-44-04 | 类型: 0x0800',
          isIpFrame: true
        });

        updateInspector({
          badgeText: 'IP 数据报成功交付',
          badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
          encapStage: '已封装单播 MAC 帧',
          encapClass: 'text-sky-700',
          type: 'IPv4 数据报',
          opcode: '--',
          smac: '00-11-22-33-44-03',
          smacNote: '主机 3',
          dmac: '00-11-22-33-44-04',
          dmacNote: '主机 4 (已缓存)',
          sip: '192.168.1.30',
          sipNote: '主机 3',
          dip: '192.168.1.40',
          dipNote: '主机 4',
          etherType: '0x0800',
          action: '单播交付',
          desc: '【步骤 5/5】主机 3 使用学到的 MAC 地址封装并发送 IP 数据报，H4 剥离 MAC 帧头成功接收！',
          stepText: '步骤 5 / 5'
        });

        flyPacket({
          layer,
          startPos: pH3,
          endPos: pSw,
          duration: 0.6,
          title: 'IP 数据帧 (0x0800)',
          detail: 'Src: H3 ➔ Dst: H4',
          coreType: 'ip-data',
          coreIcon: '📦',
          coreLabel: 'IPv4 Data',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw,
              endPos: pH4,
              duration: 0.6,
              title: 'IP 数据帧 (0x0800)',
              detail: 'Src: H3 ➔ Dst: H4',
              coreType: 'ip-data',
              coreIcon: '📦',
              coreLabel: 'IPv4 Data',
              onComplete: () => {
                dom.h4Badge.textContent = '✓ 数据报交付完成';
                dom.h4Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                animateDecapsulation({
                  slotEl: dom.h4EncapBox,
                  macHeader: '目的: 00-11-22-33-44-04',
                  payloadType: 'ip',
                  payloadContent: 'IP: 192.168.1.30 → 192.168.1.40',
                  matchedText: '✓ 剥离 MAC 帧头 · 完整交付 IP 数据报！',
                  isIpFrame: true
                });
              }
            });
          }
        });
      }
    },

    // 流程 3：H2 -> H1 (缓存命中对比：无需广播)
    runFlow3(step) {
      const container = dom.stageSameContainer;
      const layer = dom.packetsLayerSame;
      const pSw = getCenterCoords(dom.sameSwitch, container);
      const pH1 = getCenterCoords(dom.hostH1, container);
      const pH2 = getCenterCoords(dom.hostH2, container);

      dom.hostH1.className = 'host-node-card bg-[#FAF9F5] border-2 border-[#E5E4DC] rounded-xl p-3 shadow-sm';
      dom.hostH2.className = 'host-node-card bg-[#FAF9F5] border-2 border-[#E5E4DC] rounded-xl p-3 shadow-sm';

      if (step === 1) {
        dom.hostH2.classList.add('is-active-src');
        dom.h2Badge.textContent = '查 ARP 缓存表';
        dom.h2Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-bold';

        insertArpRowSmooth(dom.h2Tbody, '192.168.1.10', '00-11-22-33-44-01', '动态', true);

        // 初始仅显示 IP 数据报载荷
        dom.h2EncapBox.innerHTML = `
          <div class="inner-payload-ip">
            <span class="px-1 py-0.2 bg-sky-200 text-sky-900 rounded text-[9px] font-bold">IPv4 数据报</span>
            <span>192.168.1.20 → 192.168.1.10</span>
          </div>
        `;

        updateInspector({
          badgeText: 'ARP 缓存命中 (Cache HIT)',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          encapStage: '直接封装单播 MAC 帧',
          encapClass: 'text-emerald-700',
          type: 'IPv4 数据报 (免 ARP 广播)',
          opcode: '--',
          smac: '00-11-22-33-44-02',
          smacNote: '主机 2',
          dmac: '00-11-22-33-44-01',
          dmacNote: '主机 1 (查表命中！)',
          sip: '192.168.1.20',
          sipNote: '主机 2',
          dip: '192.168.1.10',
          dipNote: '主机 1',
          etherType: '0x0800',
          action: '缓存命中 (HIT)',
          desc: '【步骤 1/3】主机 2 准备向主机 1 发送数据。查本地 ARP 缓存表直接命中（HIT），无需发送 ARP 广播！',
          stepText: '步骤 1 / 3'
        });
      }
      else if (step === 2) {
        dom.hostH2.classList.add('is-active-src');
        dom.h2Badge.textContent = '直接封装 MAC 帧';
        dom.h2Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-sky-100 text-sky-800 font-bold';

        // 动画加入 MAC 帧头
        animateEncapsulation({
          slotEl: dom.h2EncapBox,
          payloadType: 'ip',
          payloadLabel: 'IPv4 数据报',
          payloadContent: '192.168.1.20 → 192.168.1.10',
          macHeader: '目的: 00-11-22-33-44-01 | 类型: 0x0800',
          isIpFrame: true
        });

        updateInspector({
          badgeText: '单播 MAC 帧直接封装',
          badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
          encapStage: '已封装单播帧',
          encapClass: 'text-sky-700',
          type: 'IPv4 数据帧',
          opcode: '--',
          smac: '00-11-22-33-44-02',
          smacNote: '主机 2',
          dmac: '00-11-22-33-44-01',
          dmacNote: '主机 1',
          sip: '192.168.1.20',
          sipNote: '主机 2',
          dip: '192.168.1.10',
          dipNote: '主机 1',
          etherType: '0x0800',
          action: '直接发送单播帧',
          desc: '【步骤 2/3】主机 2 直接使用缓存中的 MAC 地址动画封装以太网帧，零广播开销！',
          stepText: '步骤 2 / 3'
        });
      }
      else if (step === 3) {
        dom.hostH2.classList.add('is-active-src');
        dom.hostH1.classList.add('is-active-dst');

        updateInspector({
          badgeText: '直接交付成功',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          encapStage: '数据帧交付完成',
          encapClass: 'text-emerald-700',
          type: 'IPv4 数据帧',
          opcode: '--',
          smac: '00-11-22-33-44-02',
          smacNote: '主机 2',
          dmac: '00-11-22-33-44-01',
          dmacNote: '主机 1',
          sip: '192.168.1.20',
          sipNote: '主机 2',
          dip: '192.168.1.10',
          dipNote: '主机 1',
          etherType: '0x0800',
          action: '交付完成',
          desc: '【步骤 3/3】数据帧通过交换机直接送达主机 1，主机 1 剥离 MAC 帧头接收。体现了 ARP 缓存避免重复广播的核心价值！',
          stepText: '步骤 3 / 3'
        });

        flyPacket({
          layer,
          startPos: pH2,
          endPos: pSw,
          duration: 0.6,
          title: 'IP 数据帧 (命中直发)',
          detail: 'Src: H2 ➔ Dst: H1',
          coreType: 'ip-data',
          coreIcon: '⚡',
          coreLabel: 'Direct Frame',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw,
              endPos: pH1,
              duration: 0.6,
              title: 'IP 数据帧 (命中直发)',
              detail: 'Src: H2 ➔ Dst: H1',
              coreType: 'ip-data',
              coreIcon: '⚡',
              coreLabel: 'Direct Frame',
              onComplete: () => {
                dom.h1Badge.textContent = '✓ 接收完成';
                dom.h1Badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                animateDecapsulation({
                  slotEl: dom.h1EncapBox,
                  macHeader: '目的: 00-11-22-33-44-01',
                  payloadType: 'ip',
                  payloadContent: 'IP: 192.168.1.20 → 192.168.1.10',
                  matchedText: '✓ 剥离 MAC 头 · 数据直达成功！',
                  isIpFrame: true
                });
              }
            });
          }
        });
      }
    }
  };

  // =========================================================================
  // 8. 跨网络场景核心流程 (Cross Network Workflows with Routing Table Scan)
  // =========================================================================
  const crossEngine = {
    getStepCount(flow) {
      if (flow === 1) return 8;
      if (flow === 2) return 6;
      if (flow === 3) return 6;
      return 8;
    },

    runStep(flow, step) {
      if (flow === 1) this.runFlow1(step);
      else if (flow === 2) this.runFlow2(step);
      else if (flow === 3) this.runFlow3(step);
    },

    animateRoutingLookup(targetRow, onMatched) {
      const rows = [dom.routeRow1, dom.routeRow2, dom.routeRowDef];
      dom.routeLookupStatus.textContent = '正在检索路由表...';
      dom.routeLookupStatus.className = 'text-[10px] font-mono text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-300 font-bold';

      rows.forEach(r => r.className = 'transition-colors duration-200 border-b border-stone-150');

      let current = 0;
      const interval = setInterval(() => {
        rows.forEach(r => r.classList.remove('route-row-scanning'));
        if (current < rows.length) {
          rows[current].classList.add('route-row-scanning');
          current++;
        } else {
          clearInterval(interval);
          rows.forEach(r => r.classList.remove('route-row-scanning'));
          targetRow.classList.add('route-row-matched');
          dom.routeLookupStatus.textContent = '✓ 路由命中: 直连 eth1';
          dom.routeLookupStatus.className = 'text-[10px] font-mono text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-300 font-bold';
          if (onMatched) onMatched();
        }
      }, 260 / state.speed);
    },

    // 流程 1：Host A -> Host C (跨网完整解析与路由)
    runFlow1(step) {
      const container = dom.stageCrossContainer;
      const layer = dom.packetsLayerCross;

      const pHa = getCenterCoords(dom.crossHostA, container);
      const pHb = getCenterCoords(dom.crossHostB, container);
      const pSw1 = getCenterCoords(dom.crossSw1, container);
      const pR1Eth0 = getCenterCoords(document.getElementById('r1-eth0-card'), container);
      const pR1Eth1 = getCenterCoords(document.getElementById('r1-eth1-card'), container);
      const pSw2 = getCenterCoords(dom.crossSw2, container);
      const pHc = getCenterCoords(dom.crossHostC, container);
      const pHd = getCenterCoords(dom.crossHostD, container);

      dom.crossHostA.className = 'host-node-card bg-white border-2 border-[#E5E4DC] rounded-xl p-2.5 shadow-sm';
      dom.crossHostB.className = 'host-node-card bg-white border-2 border-[#E5E4DC] rounded-xl p-2.5 shadow-sm';
      dom.crossHostC.className = 'host-node-card bg-white border-2 border-[#E5E4DC] rounded-xl p-2.5 shadow-sm';
      dom.crossHostD.className = 'host-node-card bg-white border-2 border-[#E5E4DC] rounded-xl p-2.5 shadow-sm';
      dom.routeRow1.className = 'border-b border-stone-150 transition-colors duration-200';
      dom.routeRow2.className = 'border-b border-stone-150 transition-colors duration-200';
      dom.routeRowDef.className = 'transition-colors duration-200';

      if (step === 1) {
        dom.crossHostA.classList.add('is-active-src');
        dom.haBadge.textContent = '识别跨网段';
        dom.haBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-sky-100 text-sky-800 font-bold';

        dom.haEncapBox.innerHTML = `
          <div class="inner-payload-ip">
            <span class="px-1 py-0.2 bg-sky-200 text-sky-900 rounded text-[9px] font-bold">IPv4 跨网</span>
            <span>192.168.1.10 → 192.168.2.10</span>
          </div>
        `;

        updateInspector({
          badgeText: '目的 IP 属于外网 · 需经网关转发',
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          encapStage: '未封装 MAC 帧 (待求网关 MAC)',
          encapClass: 'text-amber-700',
          type: 'IPv4 数据报 (跨网段)',
          opcode: '--',
          smac: '00-11-22-33-AA-01',
          smacNote: '主机 A',
          dmac: '??-??-??-??-??-??',
          dmacNote: '需获取默认网关 MAC (192.168.1.1)',
          sip: '192.168.1.10',
          sipNote: '源 IP: 主机 A',
          dip: '192.168.2.10',
          dipNote: '目的 IP: 主机 C (子网 2)',
          etherType: '0x0800',
          action: '掩码按位与运算 & 判断跨网',
          desc: '【步骤 1/8】主机 A 将目的 IP 192.168.2.10 与自身掩码按位与，发现不属于本网段（192.168.1.0/24），因此必须发往默认网关 192.168.1.1！',
          stepText: '步骤 1 / 8'
        });
      }
      else if (step === 2) {
        dom.crossHostA.classList.add('is-active-src');
        dom.haBadge.textContent = '求网关 MAC 广播';

        animateEncapsulation({
          slotEl: dom.haEncapBox,
          payloadType: 'arp',
          payloadLabel: 'ARP 请求 (0x0001)',
          payloadContent: '谁有 192.168.1.1 (网关)?',
          macHeader: '目的: FF-FF-FF-FF-FF-FF | 类型: 0x0806'
        });

        updateInspector({
          badgeText: '子网 1 广播求网关 MAC',
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          encapStage: '已封装 MAC 广播帧',
          encapClass: 'text-stone-800',
          type: 'ARP 请求 (0x0001)',
          opcode: '0x0001 (Request)',
          smac: '00-11-22-33-AA-01',
          smacNote: '主机 A',
          dmac: 'FF-FF-FF-FF-FF-FF',
          dmacNote: '以太网广播 MAC',
          sip: '192.168.1.10',
          sipNote: '主机 A',
          dip: '192.168.1.1',
          dipNote: '网关 IP (路由器 eth0)',
          etherType: '0x0806',
          action: '子网 1 广播 ARP',
          desc: '【步骤 2/8】主机 A 动画封装 MAC 广播帧，在子网 1 内广播求网关 192.168.1.1 的 MAC 地址。',
          stepText: '步骤 2 / 8'
        });

        flyPacket({
          layer,
          startPos: pHa,
          endPos: pSw1,
          duration: 0.5,
          title: 'ARP 请求 (求网关)',
          detail: 'Target: 192.168.1.1',
          coreType: 'arp-req',
          coreIcon: '📢',
          coreLabel: 'ARP Req',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw1,
              endPos: pHb,
              duration: 0.6,
              title: 'ARP 请求',
              coreType: 'arp-req',
              coreIcon: '📢',
              coreLabel: 'ARP Req',
              onComplete: () => {
                showDiscardBadge(container, pHb, '非本机 IP (丢弃)');
                dom.crossHostB.classList.add('is-discarded');
                dom.hbBadge.textContent = '✕ 丢弃';
                dom.hbBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-rose-100 text-rose-800 font-bold';
              }
            });

            flyPacket({
              layer,
              startPos: pSw1,
              endPos: pR1Eth0,
              duration: 0.6,
              title: 'ARP 请求',
              detail: '目标: 192.168.1.1 (网关命中)',
              coreType: 'arp-req',
              coreIcon: '🎯',
              coreLabel: 'GW Match',
              onComplete: () => {
                dom.r1StatusBadge.textContent = '网关匹配成功';
                dom.r1StatusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold';

                animateDecapsulation({
                  slotEl: dom.r1EncapBox,
                  macHeader: '目的: FF-FF-FF-FF-FF-FF',
                  payloadType: 'arp',
                  payloadContent: 'ARP: 谁有 192.168.1.1?',
                  matchedText: '✓ 剥离 MAC 头 · 目的 IP 匹配网关 eth0 (192.168.1.1)',
                  onComplete: () => {
                    insertArpRowSmooth(dom.r1Tbody, '192.168.1.10', '00-11-22-33-AA-01', '动态', true, () => {
                      document.getElementById('r1-cache-count').textContent = '1 条目';
                    });
                  }
                });
              }
            });
          }
        });
      }
      else if (step === 3) {
        dom.crossHostA.classList.add('is-active-dst');

        animateEncapsulation({
          slotEl: dom.r1EncapBox,
          payloadType: 'arp',
          payloadLabel: 'ARP 响应 (0x0002)',
          payloadContent: '网关 MAC: 00-11-22-AA-01',
          macHeader: '目的: 00-11-22-33-AA-01 | 类型: 0x0806'
        });

        updateInspector({
          badgeText: '网关单播 ARP 响应',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          encapStage: '已封装单播 MAC 帧',
          encapClass: 'text-emerald-700',
          type: 'ARP 响应 (0x0002)',
          opcode: '0x0002 (Reply)',
          smac: '00-11-22-AA-01',
          smacNote: '路由器 eth0 网卡',
          dmac: '00-11-22-33-AA-01',
          dmacNote: '主机 A 网卡',
          sip: '192.168.1.1',
          sipNote: '网关 IP',
          dip: '192.168.1.10',
          dipNote: '主机 A',
          etherType: '0x0806',
          action: '单播返回网关 MAC',
          desc: '【步骤 3/8】路由器 eth0 单播响应 ARP Reply，主机 A 收到后剥离 MAC 帧头并更新网关 MAC 缓存！',
          stepText: '步骤 3 / 8'
        });

        flyPacket({
          layer,
          startPos: pR1Eth0,
          endPos: pSw1,
          duration: 0.6,
          title: 'ARP 响应 (网关 MAC)',
          detail: 'Src: eth0 ➔ Dst: Host A',
          coreType: 'arp-rep',
          coreIcon: '✉️',
          coreLabel: 'ARP Reply',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw1,
              endPos: pHa,
              duration: 0.6,
              title: 'ARP 响应 (网关 MAC)',
              coreType: 'arp-rep',
              coreIcon: '✉️',
              coreLabel: 'ARP Reply',
              onComplete: () => {
                dom.haBadge.textContent = '✓ 获得网关 MAC';
                dom.haBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                animateDecapsulation({
                  slotEl: dom.haEncapBox,
                  macHeader: '目的: 00-11-22-33-AA-01',
                  payloadType: 'arp',
                  payloadContent: 'ARP Reply: 网关 MAC 是 00-11-22-AA-01',
                  matchedText: '✓ 剥离 MAC 头 · 成功学到网关 MAC 地址',
                  onComplete: () => {
                    insertArpRowSmooth(dom.haTbody, '192.168.1.1', '00-11-22-AA-01', '动态', true);
                  }
                });
              }
            });
          }
        });
      }
      else if (step === 4) {
        dom.crossHostA.classList.add('is-active-src');

        // 主机 A 动画为 IP 数据报加入网关 MAC 帧头
        animateEncapsulation({
          slotEl: dom.haEncapBox,
          payloadType: 'ip',
          payloadLabel: 'IPv4 数据报',
          payloadContent: '192.168.1.10 → 192.168.2.10',
          macHeader: '目的: 00-11-22-AA-01 (网关) | 类型: 0x0800',
          isIpFrame: true
        });

        updateInspector({
          badgeText: '数据帧已发往网关',
          badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
          encapStage: '已封装第一跳以太网帧',
          encapClass: 'text-sky-700',
          type: 'IPv4 数据帧 (第一跳)',
          opcode: '--',
          smac: '00-11-22-33-AA-01',
          smacNote: '源 MAC: 主机 A',
          dmac: '00-11-22-AA-01',
          dmacNote: '目的 MAC: 路由器 eth0 (网关)',
          sip: '192.168.1.10',
          sipNote: '源 IP: 主机 A (全程不变)',
          dip: '192.168.2.10',
          dipNote: '目的 IP: 主机 C (全程不变)',
          etherType: '0x0800',
          action: '第一跳传输',
          desc: '【步骤 4/8·核心考点】主机 A 发出以太网帧：目的 MAC 为网关，但目的 IP 仍是主机 C！IP 端到端不变，MAC 逐跳更换！',
          stepText: '步骤 4 / 8'
        });

        flyPacket({
          layer,
          startPos: pHa,
          endPos: pSw1,
          duration: 0.6,
          title: 'IP 数据帧 (第一跳)',
          detail: 'Dst MAC: eth0 | Dst IP: Host C',
          coreType: 'ip-data',
          coreIcon: '📦',
          coreLabel: 'To Gateway',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw1,
              endPos: pR1Eth0,
              duration: 0.6,
              title: 'IP 数据帧 (第一跳)',
              detail: '抵达路由器 eth0',
              coreType: 'ip-data',
              coreIcon: '📦',
              coreLabel: 'At Router',
              onComplete: () => {
                dom.r1StatusBadge.textContent = '接收第一跳帧';
                dom.r1StatusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-mono bg-sky-100 text-sky-800 border border-sky-300 font-bold';

                // 路由器剥离第一跳 MAC 帧头！
                animateDecapsulation({
                  slotEl: dom.r1EncapBox,
                  macHeader: '目的: 00-11-22-AA-01 (eth0)',
                  payloadType: 'ip',
                  payloadContent: 'IP 数据报: 192.168.1.10 → 192.168.2.10',
                  matchedText: '✓ 剥离第一跳 MAC 帧头 · 提取出 IP 数据报！',
                  isIpFrame: true
                });
              }
            });
          }
        });
      }
      else if (step === 5) {
        dom.r1StatusBadge.textContent = '查路由表与 TTL-1';
        dom.r1StatusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-mono bg-amber-100 text-amber-800 border border-amber-300 font-bold';

        updateInspector({
          badgeText: '路由器正在检索路由表...',
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          encapStage: '已剥除第一跳 MAC 帧头',
          encapClass: 'text-stone-800',
          type: '路由选择与转发查找',
          opcode: '--',
          smac: '--',
          smacNote: '已剥除上一跳 MAC',
          dmac: '--',
          dmacNote: '待由下一跳 ARP 确定',
          sip: '192.168.1.10',
          sipNote: '源 IP (不变)',
          dip: '192.168.2.10',
          dipNote: '目的 IP (用于查路由表)',
          etherType: '0x0800',
          action: '最长前缀匹配查表',
          desc: '【步骤 5/8·核心演示】路由器已剥去 MAC 帧头。根据目的 IP 192.168.2.10 逐行检索路由表！命中 192.168.2.0/24，出接口为 eth1，下一跳直连 192.168.2.10，TTL 减 1！',
          stepText: '步骤 5 / 8'
        });

        this.animateRoutingLookup(dom.routeRow2, () => {
          dom.r1EncapBox.innerHTML = `
            <div class="inner-payload-ip" style="background:#FEF3C7; border-color:#F59E0B; color:#92400E;">
              <span class="font-bold">路由表命中:</span>
              <span>出接口 eth1 · 下一跳 IP: 192.168.2.10 · TTL-1</span>
            </div>
          `;
        });
      }
      else if (step === 6) {
        dom.r1StatusBadge.textContent = '子网 2 发起 ARP';

        animateEncapsulation({
          slotEl: dom.r1EncapBox,
          payloadType: 'arp',
          payloadLabel: 'ARP 请求 (0x0001)',
          payloadContent: '谁有 192.168.2.10? 告诉 192.168.2.1',
          macHeader: '目的: FF-FF-FF-FF-FF-FF | 类型: 0x0806'
        });

        updateInspector({
          badgeText: '子网 2 广播求目的主机 MAC',
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          encapStage: '构建子网 2 ARP 广播帧',
          encapClass: 'text-stone-800',
          type: 'ARP 请求 (0x0001)',
          opcode: '0x0001 (Request)',
          smac: '00-11-22-AA-02',
          smacNote: '路由器 eth1',
          dmac: 'FF-FF-FF-FF-FF-FF',
          dmacNote: '子网 2 广播 MAC',
          sip: '192.168.2.1',
          sipNote: '路由器 eth1 IP',
          dip: '192.168.2.10',
          dipNote: '主机 C (Who has?)',
          etherType: '0x0806',
          action: '子网 2 广播 ARP',
          desc: '【步骤 6/8】路由器 eth1 在子网 2 广播 ARP：“谁拥有 192.168.2.10 的 MAC？” 主机 C 收到后剥除 MAC 帧头并匹配！',
          stepText: '步骤 6 / 8'
        });

        flyPacket({
          layer,
          startPos: pR1Eth1,
          endPos: pSw2,
          duration: 0.6,
          title: 'ARP 请求 (求主机 C)',
          detail: 'Target: 192.168.2.10',
          coreType: 'arp-req',
          coreIcon: '📢',
          coreLabel: 'ARP Req',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw2,
              endPos: pHd,
              duration: 0.6,
              title: 'ARP 请求',
              coreType: 'arp-req',
              coreIcon: '📢',
              coreLabel: 'ARP Req',
              onComplete: () => {
                showDiscardBadge(container, pHd, '非本机 IP (丢弃)');
                dom.crossHostD.classList.add('is-discarded');
                dom.hdBadge.textContent = '✕ 丢弃';
                dom.hdBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-rose-100 text-rose-800 font-bold';
              }
            });

            flyPacket({
              layer,
              startPos: pSw2,
              endPos: pHc,
              duration: 0.6,
              title: 'ARP 请求',
              detail: '目标: 192.168.2.10 (匹配!)',
              coreType: 'arp-req',
              coreIcon: '🎯',
              coreLabel: 'Match!',
              onComplete: () => {
                dom.hcBadge.textContent = '✓ IP 匹配成功';
                dom.hcBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                animateDecapsulation({
                  slotEl: dom.hcEncapBox,
                  macHeader: '目的: FF-FF-FF-FF-FF-FF',
                  payloadType: 'arp',
                  payloadContent: 'ARP: 谁有 192.168.2.10?',
                  matchedText: '✓ 剥离 MAC 头 · 目的 IP 匹配本机 (192.168.2.10)',
                  onComplete: () => {
                    insertArpRowSmooth(dom.hcTbody, '192.168.2.1', '00-11-22-AA-02', '动态', true);
                  }
                });
              }
            });
          }
        });
      }
      else if (step === 7) {
        dom.crossHostC.classList.add('is-active-src');
        dom.hcBadge.textContent = '单播 ARP 响应';

        animateEncapsulation({
          slotEl: dom.hcEncapBox,
          payloadType: 'arp',
          payloadLabel: 'ARP 响应 (0x0002)',
          payloadContent: '我的 MAC 是 00-11-22-33-CC-01',
          macHeader: '目的: 00-11-22-AA-02 (eth1) | 类型: 0x0806'
        });

        updateInspector({
          badgeText: '主机 C 单播 ARP 响应',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          encapStage: '已封装单播 MAC 帧',
          encapClass: 'text-emerald-700',
          type: 'ARP 响应 (0x0002)',
          opcode: '0x0002 (Reply)',
          smac: '00-11-22-33-CC-01',
          smacNote: '主机 C',
          dmac: '00-11-22-AA-02',
          dmacNote: '路由器 eth1',
          sip: '192.168.2.10',
          sipNote: '主机 C',
          dip: '192.168.2.1',
          dipNote: '路由器 eth1',
          etherType: '0x0806',
          action: '单播告知 MAC',
          desc: '【步骤 7/8】主机 C 将自己的 MAC 单播响应给路由器 eth1。路由器剥除 MAC 帧头并更新 ARP 缓存！',
          stepText: '步骤 7 / 8'
        });

        flyPacket({
          layer,
          startPos: pHc,
          endPos: pSw2,
          duration: 0.6,
          title: 'ARP 响应 (主机 C MAC)',
          detail: 'Src: Host C ➔ Dst: eth1',
          coreType: 'arp-rep',
          coreIcon: '✉️',
          coreLabel: 'ARP Reply',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw2,
              endPos: pR1Eth1,
              duration: 0.6,
              title: 'ARP 响应',
              coreType: 'arp-rep',
              coreIcon: '✉️',
              coreLabel: 'ARP Reply',
              onComplete: () => {
                dom.r1StatusBadge.textContent = '获得 Host C MAC';

                animateDecapsulation({
                  slotEl: dom.r1EncapBox,
                  macHeader: '目的: 00-11-22-AA-02',
                  payloadType: 'arp',
                  payloadContent: 'ARP Reply: 192.168.2.10 MAC 是 00-11-22-33-CC-01',
                  matchedText: '✓ 剥离 MAC 头 · 路由器学到主机 C MAC 地址',
                  onComplete: () => {
                    insertArpRowSmooth(dom.r1Tbody, '192.168.2.10', '00-11-22-33-CC-01', '动态', true, () => {
                      document.getElementById('r1-cache-count').textContent = '2 条目';
                    });
                  }
                });
              }
            });
          }
        });
      }
      else if (step === 8) {
        dom.crossHostC.classList.add('is-active-dst');

        // 路由器重新为原始 IP 数据报包裹第二跳 MAC 帧头！
        animateEncapsulation({
          slotEl: dom.r1EncapBox,
          payloadType: 'ip',
          payloadLabel: 'IPv4 (源/目IP不变)',
          payloadContent: '192.168.1.10 → 192.168.2.10',
          macHeader: '目的: 00-11-22-33-CC-01 (Host C) | 源: eth1',
          isIpFrame: true
        });

        updateInspector({
          badgeText: '跨网数据交付圆满完成！',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          encapStage: '已封装第二跳单播 MAC 帧',
          encapClass: 'text-emerald-700',
          type: 'IPv4 数据帧 (第二跳)',
          opcode: '--',
          smac: '00-11-22-AA-02',
          smacNote: '源 MAC: 路由器 eth1 (已重写)',
          dmac: '00-11-22-33-CC-01',
          dmacNote: '目的 MAC: 主机 C (已重写)',
          sip: '192.168.1.10',
          sipNote: '源 IP: 主机 A (保持不变)',
          dip: '192.168.2.10',
          dipNote: '目的 IP: 主机 C (保持不变)',
          etherType: '0x0800',
          action: '第二跳交付完成',
          desc: '【步骤 8/8·终局交付】路由器重写 MAC 帧头发送给主机 C。主机 C 剥离 MAC 帧头收到完整 IP 数据报！跨网路由转发成功！',
          stepText: '步骤 8 / 8'
        });

        flyPacket({
          layer,
          startPos: pR1Eth1,
          endPos: pSw2,
          duration: 0.6,
          title: 'IP 数据帧 (第二跳)',
          detail: 'Src MAC: eth1 ➔ Dst MAC: Host C',
          extra: 'Src IP: Host A ➔ Dst IP: Host C',
          coreType: 'ip-data',
          coreIcon: '📦',
          coreLabel: 'IPv4 Data',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw2,
              endPos: pHc,
              duration: 0.6,
              title: 'IP 数据帧 (第二跳)',
              detail: '交付主机 C',
              coreType: 'ip-data',
              coreIcon: '📦',
              coreLabel: 'IPv4 Data',
              onComplete: () => {
                dom.hcBadge.textContent = '✓ 跨网交付成功';
                dom.hcBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                animateDecapsulation({
                  slotEl: dom.hcEncapBox,
                  macHeader: '目的: 00-11-22-33-CC-01',
                  payloadType: 'ip',
                  payloadContent: 'IP: 192.168.1.10 → 192.168.2.10',
                  matchedText: '✓ 剥离 MAC 帧头 · 完整接收跨网 IP 数据报！',
                  isIpFrame: true
                });
              }
            });
          }
        });
      }
    },

    // 流程 2：Host B -> Host D (网关已缓存跨网转发)
    runFlow2(step) {
      const container = dom.stageCrossContainer;
      const layer = dom.packetsLayerCross;
      const pHb = getCenterCoords(dom.crossHostB, container);
      const pSw1 = getCenterCoords(dom.crossSw1, container);
      const pR1Eth0 = getCenterCoords(document.getElementById('r1-eth0-card'), container);
      const pR1Eth1 = getCenterCoords(document.getElementById('r1-eth1-card'), container);
      const pSw2 = getCenterCoords(dom.crossSw2, container);
      const pHd = getCenterCoords(dom.crossHostD, container);

      dom.crossHostB.className = 'host-node-card bg-white border-2 border-[#E5E4DC] rounded-xl p-2.5 shadow-sm';
      dom.crossHostD.className = 'host-node-card bg-white border-2 border-[#E5E4DC] rounded-xl p-2.5 shadow-sm';

      if (step === 1) {
        dom.crossHostB.classList.add('is-active-src');
        insertArpRowSmooth(dom.hbTbody, '192.168.1.1', '00-11-22-AA-01', '动态', true);

        animateEncapsulation({
          slotEl: dom.hbEncapBox,
          payloadType: 'ip',
          payloadLabel: 'IPv4 数据报',
          payloadContent: '192.168.1.20 → 192.168.2.20',
          macHeader: '目的: 00-11-22-AA-01 (网关已缓存)',
          isIpFrame: true
        });

        updateInspector({
          badgeText: '网关 MAC 已缓存 · 直接封装',
          badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
          encapStage: '已封装第一跳 MAC 帧',
          encapClass: 'text-sky-700',
          type: 'IPv4 数据帧 (跨网发往 Host D)',
          opcode: '--',
          smac: '00-11-22-33-AA-02',
          smacNote: '主机 B',
          dmac: '00-11-22-AA-01',
          dmacNote: '路由器 eth0 (缓存命中)',
          sip: '192.168.1.20',
          sipNote: '主机 B',
          dip: '192.168.2.20',
          dipNote: '主机 D (子网 2)',
          etherType: '0x0800',
          action: '免发 ARP 直接送网关',
          desc: '【步骤 1/6】主机 B 已缓存网关 MAC，动画为其封装以太网帧，直接发往路由器！',
          stepText: '步骤 1 / 6'
        });
      }
      else if (step === 2) {
        dom.crossHostB.classList.add('is-active-src');

        updateInspector({
          badgeText: '第一跳数据帧传输',
          badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
          encapStage: '第一跳传输',
          encapClass: 'text-sky-700',
          type: 'IPv4 数据帧',
          opcode: '--',
          smac: '00-11-22-33-AA-02',
          smacNote: '主机 B',
          dmac: '00-11-22-AA-01',
          dmacNote: '网关 eth0',
          sip: '192.168.1.20',
          sipNote: '主机 B',
          dip: '192.168.2.20',
          dipNote: '主机 D',
          etherType: '0x0800',
          action: '发往路由器',
          desc: '【步骤 2/6】数据帧顺利送达路由器 eth0，路由器剥除 MAC 帧头取出 IP 数据报。',
          stepText: '步骤 2 / 6'
        });

        flyPacket({
          layer,
          startPos: pHb,
          endPos: pSw1,
          duration: 0.6,
          title: 'IP 数据帧 (至网关)',
          coreType: 'ip-data',
          coreIcon: '📦',
          coreLabel: 'To Router',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw1,
              endPos: pR1Eth0,
              duration: 0.6,
              title: 'IP 数据帧',
              coreType: 'ip-data',
              coreIcon: '📦',
              coreLabel: 'At Router',
              onComplete: () => {
                animateDecapsulation({
                  slotEl: dom.r1EncapBox,
                  macHeader: '目的: 00-11-22-AA-01',
                  payloadType: 'ip',
                  payloadContent: 'IP: 192.168.1.20 → 192.168.2.20',
                  matchedText: '✓ 剥离第一跳 MAC 帧头',
                  isIpFrame: true
                });
              }
            });
          }
        });
      }
      else if (step === 3) {
        updateInspector({
          badgeText: '路由器查路由表...',
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          encapStage: '查路由表',
          encapClass: 'text-amber-700',
          type: '路由查找',
          opcode: '--',
          smac: '--',
          smacNote: '--',
          dmac: '--',
          dmacNote: '--',
          sip: '192.168.1.20',
          sipNote: '主机 B',
          dip: '192.168.2.20',
          dipNote: '主机 D',
          etherType: '0x0800',
          action: '匹配 192.168.2.0/24',
          desc: '【步骤 3/6】路由器查路由表，目的 IP 192.168.2.20 匹配条目 192.168.2.0/24，出接口为 eth1！',
          stepText: '步骤 3 / 6'
        });

        this.animateRoutingLookup(dom.routeRow2, () => {
          dom.r1EncapBox.innerHTML = `
            <div class="inner-payload-ip" style="background:#FEF3C7; border-color:#F59E0B; color:#92400E;">
              <span>路由命中: 出接口 eth1 · 下一跳 192.168.2.20</span>
            </div>
          `;
        });
      }
      else if (step === 4) {
        animateEncapsulation({
          slotEl: dom.r1EncapBox,
          payloadType: 'arp',
          payloadLabel: 'ARP 请求 (0x0001)',
          payloadContent: '谁有 192.168.2.20? 告诉 192.168.2.1',
          macHeader: '目的: FF-FF-FF-FF-FF-FF | 类型: 0x0806'
        });

        updateInspector({
          badgeText: '子网 2 广播解析 Host D',
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          encapStage: '广播 ARP',
          encapClass: 'text-amber-700',
          type: 'ARP 请求 (0x0001)',
          opcode: '0x0001',
          smac: '00-11-22-AA-02',
          smacNote: '路由器 eth1',
          dmac: 'FF-FF-FF-FF-FF-FF',
          dmacNote: '广播',
          sip: '192.168.2.1',
          sipNote: '路由器 eth1',
          dip: '192.168.2.20',
          dipNote: '主机 D',
          etherType: '0x0806',
          action: '子网 2 广播',
          desc: '【步骤 4/6】路由器在子网 2 广播 ARP 请求主机 D 的 MAC。Host D 收到后剥离 MAC 帧头并匹配！',
          stepText: '步骤 4 / 6'
        });

        flyPacket({
          layer,
          startPos: pR1Eth1,
          endPos: pSw2,
          duration: 0.6,
          title: 'ARP 请求 (求 Host D)',
          coreType: 'arp-req',
          coreIcon: '📢',
          coreLabel: 'ARP Req',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw2,
              endPos: pHd,
              duration: 0.6,
              title: 'ARP 请求',
              coreType: 'arp-req',
              coreIcon: '🎯',
              coreLabel: 'Match',
              onComplete: () => {
                dom.hdBadge.textContent = '✓ IP 匹配成功';
                dom.hdBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                animateDecapsulation({
                  slotEl: dom.hdEncapBox,
                  macHeader: '目的: FF-FF-FF-FF-FF-FF',
                  payloadType: 'arp',
                  payloadContent: 'ARP: 谁有 192.168.2.20?',
                  matchedText: '✓ 剥离 MAC 头 · 目的 IP 匹配本机 (192.168.2.20)',
                  onComplete: () => {
                    insertArpRowSmooth(dom.hdTbody, '192.168.2.1', '00-11-22-AA-02', '动态', true);
                  }
                });
              }
            });
          }
        });
      }
      else if (step === 5) {
        animateEncapsulation({
          slotEl: dom.hdEncapBox,
          payloadType: 'arp',
          payloadLabel: 'ARP 响应 (0x0002)',
          payloadContent: '我的 MAC 是 00-11-22-33-CC-02',
          macHeader: '目的: 00-11-22-AA-02 (eth1) | 类型: 0x0806'
        });

        updateInspector({
          badgeText: '主机 D 单播 ARP 响应',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          encapStage: '已封装单播帧',
          encapClass: 'text-emerald-700',
          type: 'ARP 响应 (0x0002)',
          opcode: '0x0002',
          smac: '00-11-22-33-CC-02',
          smacNote: '主机 D',
          dmac: '00-11-22-AA-02',
          dmacNote: '路由器 eth1',
          sip: '192.168.2.20',
          sipNote: '主机 D',
          dip: '192.168.2.1',
          dipNote: '路由器 eth1',
          etherType: '0x0806',
          action: '单播返回',
          desc: '【步骤 5/6】主机 D 响应单播报文给路由器 eth1。路由器剥离 MAC 头并更新 ARP 缓存。',
          stepText: '步骤 5 / 6'
        });

        flyPacket({
          layer,
          startPos: pHd,
          endPos: pSw2,
          duration: 0.6,
          title: 'ARP 响应',
          coreType: 'arp-rep',
          coreIcon: '✉️',
          coreLabel: 'ARP Reply',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw2,
              endPos: pR1Eth1,
              duration: 0.6,
              title: 'ARP 响应',
              coreType: 'arp-rep',
              coreIcon: '✉️',
              coreLabel: 'ARP Reply',
              onComplete: () => {
                animateDecapsulation({
                  slotEl: dom.r1EncapBox,
                  macHeader: '目的: 00-11-22-AA-02',
                  payloadType: 'arp',
                  payloadContent: 'ARP Reply: 192.168.2.20 MAC 是 00-11-22-33-CC-02',
                  matchedText: '✓ 剥离 MAC 头 · 路由器学到主机 D MAC',
                  onComplete: () => {
                    insertArpRowSmooth(dom.r1Tbody, '192.168.2.20', '00-11-22-33-CC-02', '动态', true);
                  }
                });
              }
            });
          }
        });
      }
      else if (step === 6) {
        dom.crossHostD.classList.add('is-active-dst');

        animateEncapsulation({
          slotEl: dom.r1EncapBox,
          payloadType: 'ip',
          payloadLabel: 'IPv4 数据报',
          payloadContent: '192.168.1.20 → 192.168.2.20',
          macHeader: '目的: 00-11-22-33-CC-02 (Host D) | 源: eth1',
          isIpFrame: true
        });

        updateInspector({
          badgeText: '跨网交付完成',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          encapStage: '第二跳交付',
          encapClass: 'text-emerald-700',
          type: 'IPv4 数据帧',
          opcode: '--',
          smac: '00-11-22-AA-02',
          smacNote: '路由器 eth1',
          dmac: '00-11-22-33-CC-02',
          dmacNote: '主机 D',
          sip: '192.168.1.20',
          sipNote: '主机 B',
          dip: '192.168.2.20',
          dipNote: '主机 D',
          etherType: '0x0800',
          action: '交付成功',
          desc: '【步骤 6/6】路由器将数据帧单播交付给主机 D，主机 D 剥离 MAC 帧头收到 IP 数据报！',
          stepText: '步骤 6 / 6'
        });

        flyPacket({
          layer,
          startPos: pR1Eth1,
          endPos: pSw2,
          duration: 0.6,
          title: 'IP 数据帧 (第二跳)',
          coreType: 'ip-data',
          coreIcon: '📦',
          coreLabel: 'IPv4 Data',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw2,
              endPos: pHd,
              duration: 0.6,
              title: 'IP 数据帧',
              coreType: 'ip-data',
              coreIcon: '📦',
              coreLabel: 'IPv4 Data',
              onComplete: () => {
                dom.hdBadge.textContent = '✓ 交付成功';
                dom.hdBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                animateDecapsulation({
                  slotEl: dom.hdEncapBox,
                  macHeader: '目的: 00-11-22-33-CC-02',
                  payloadType: 'ip',
                  payloadContent: 'IP: 192.168.1.20 → 192.168.2.20',
                  matchedText: '✓ 剥离 MAC 帧头 · 完整交付 IP 数据报！',
                  isIpFrame: true
                });
              }
            });
          }
        });
      }
    },

    // 流程 3：Host C -> Host A (反向跨网闭环)
    runFlow3(step) {
      const container = dom.stageCrossContainer;
      const layer = dom.packetsLayerCross;
      const pHc = getCenterCoords(dom.crossHostC, container);
      const pSw2 = getCenterCoords(dom.crossSw2, container);
      const pR1Eth1 = getCenterCoords(document.getElementById('r1-eth1-card'), container);
      const pR1Eth0 = getCenterCoords(document.getElementById('r1-eth0-card'), container);
      const pSw1 = getCenterCoords(dom.crossSw1, container);
      const pHa = getCenterCoords(dom.crossHostA, container);

      dom.crossHostC.className = 'host-node-card bg-white border-2 border-[#E5E4DC] rounded-xl p-2.5 shadow-sm';
      dom.crossHostA.className = 'host-node-card bg-white border-2 border-[#E5E4DC] rounded-xl p-2.5 shadow-sm';

      if (step === 1) {
        dom.crossHostC.classList.add('is-active-src');
        insertArpRowSmooth(dom.hcTbody, '192.168.2.1', '00-11-22-AA-02', '动态', true);

        animateEncapsulation({
          slotEl: dom.hcEncapBox,
          payloadType: 'ip',
          payloadLabel: 'IPv4 数据报',
          payloadContent: '192.168.2.10 → 192.168.1.10',
          macHeader: '目的: 00-11-22-AA-02 (网关 eth1)',
          isIpFrame: true
        });

        updateInspector({
          badgeText: '反向跨网通信发往网关',
          badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
          encapStage: '已封装网关 MAC 帧',
          encapClass: 'text-sky-700',
          type: 'IPv4 数据帧 (子网 2 ➔ 子网 1)',
          opcode: '--',
          smac: '00-11-22-33-CC-01',
          smacNote: '主机 C',
          dmac: '00-11-22-AA-02',
          dmacNote: '网关 eth1',
          sip: '192.168.2.10',
          sipNote: '主机 C',
          dip: '192.168.1.10',
          dipNote: '主机 A',
          etherType: '0x0800',
          action: '送往网关 eth1',
          desc: '【步骤 1/6】主机 C 反向发往主机 A。主机 C 动画封装网关 eth1 MAC，送往路由器。',
          stepText: '步骤 1 / 6'
        });
      }
      else if (step === 2) {
        updateInspector({
          badgeText: '第一跳数据传输',
          badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
          encapStage: '传输中',
          encapClass: 'text-sky-700',
          type: 'IPv4 数据帧',
          opcode: '--',
          smac: '00-11-22-33-CC-01',
          smacNote: '主机 C',
          dmac: '00-11-22-AA-02',
          dmacNote: '路由器 eth1',
          sip: '192.168.2.10',
          sipNote: '主机 C',
          dip: '192.168.1.10',
          dipNote: '主机 A',
          etherType: '0x0800',
          action: '送抵路由器',
          desc: '【步骤 2/6】数据帧抵达路由器 eth1，路由器剥离 MAC 帧头取出 IP 数据报。',
          stepText: '步骤 2 / 6'
        });

        flyPacket({
          layer,
          startPos: pHc,
          endPos: pSw2,
          duration: 0.6,
          title: 'IP 数据帧 (反向)',
          coreType: 'ip-data',
          coreIcon: '📦',
          coreLabel: 'To Router',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw2,
              endPos: pR1Eth1,
              duration: 0.6,
              title: 'IP 数据帧',
              coreType: 'ip-data',
              coreIcon: '📦',
              coreLabel: 'At Router',
              onComplete: () => {
                animateDecapsulation({
                  slotEl: dom.r1EncapBox,
                  macHeader: '目的: 00-11-22-AA-02 (eth1)',
                  payloadType: 'ip',
                  payloadContent: 'IP: 192.168.2.10 → 192.168.1.10',
                  matchedText: '✓ 剥离第一跳 MAC 帧头',
                  isIpFrame: true
                });
              }
            });
          }
        });
      }
      else if (step === 3) {
        updateInspector({
          badgeText: '路由器查路由表...',
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          encapStage: '查路由表',
          encapClass: 'text-amber-700',
          type: '路由查找',
          opcode: '--',
          smac: '--',
          smacNote: '--',
          dmac: '--',
          dmacNote: '--',
          sip: '192.168.2.10',
          sipNote: '主机 C',
          dip: '192.168.1.10',
          dipNote: '主机 A',
          etherType: '0x0800',
          action: '匹配 192.168.1.0/24',
          desc: '【步骤 3/6】路由器查路由表，发现目的网络 192.168.1.0/24 直连出接口为 eth0！',
          stepText: '步骤 3 / 6'
        });

        this.animateRoutingLookup(dom.routeRow1, () => {
          dom.r1EncapBox.innerHTML = `
            <div class="inner-payload-ip" style="background:#FEF3C7; border-color:#F59E0B; color:#92400E;">
              <span>路由命中: 出接口 eth0 · 下一跳 192.168.1.10</span>
            </div>
          `;
        });
      }
      else if (step === 4) {
        insertArpRowSmooth(dom.r1Tbody, '192.168.1.10', '00-11-22-33-AA-01', '动态', true);

        // 路由器重新封装出接口 MAC 帧
        animateEncapsulation({
          slotEl: dom.r1EncapBox,
          payloadType: 'ip',
          payloadLabel: 'IPv4 数据报',
          payloadContent: '192.168.2.10 → 192.168.1.10',
          macHeader: '目的: 00-11-22-33-AA-01 (Host A) | 源: eth0',
          isIpFrame: true
        });

        updateInspector({
          badgeText: '路由器 ARP 缓存命中主机 A',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          encapStage: '重新封装出接口 MAC 帧',
          encapClass: 'text-emerald-700',
          type: 'IPv4 数据帧',
          opcode: '--',
          smac: '00-11-22-AA-01',
          smacNote: '源 MAC: 路由器 eth0',
          dmac: '00-11-22-33-AA-01',
          dmacNote: '目的 MAC: 主机 A (缓存命中)',
          sip: '192.168.2.10',
          sipNote: '源 IP: 主机 C',
          dip: '192.168.1.10',
          dipNote: '目的 IP: 主机 A',
          etherType: '0x0800',
          action: '准备第二跳交付',
          desc: '【步骤 4/6】路由器查 eth0 的 ARP 缓存命中，动画重新封装出接口以太网帧准备交付！',
          stepText: '步骤 4 / 6'
        });
      }
      else if (step === 5 || step === 6) {
        dom.crossHostA.classList.add('is-active-dst');

        updateInspector({
          badgeText: '反向数据交付成功',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          encapStage: '交付完成',
          encapClass: 'text-emerald-700',
          type: 'IPv4 数据帧',
          opcode: '--',
          smac: '00-11-22-AA-01',
          smacNote: '路由器 eth0',
          dmac: '00-11-22-33-AA-01',
          dmacNote: '主机 A',
          sip: '192.168.2.10',
          sipNote: '主机 C',
          dip: '192.168.1.10',
          dipNote: '主机 A',
          etherType: '0x0800',
          action: '交付主机 A',
          desc: '【步骤 6/6】数据帧顺利送达主机 A，主机 A 剥除 MAC 帧头收到数据！双向跨网通信闭环完成！',
          stepText: '步骤 6 / 6'
        });

        flyPacket({
          layer,
          startPos: pR1Eth0,
          endPos: pSw1,
          duration: 0.6,
          title: 'IP 数据帧 (交付 Host A)',
          coreType: 'ip-data',
          coreIcon: '📦',
          coreLabel: 'IPv4 Data',
          onComplete: () => {
            flyPacket({
              layer,
              startPos: pSw1,
              endPos: pHa,
              duration: 0.6,
              title: 'IP 数据帧',
              coreType: 'ip-data',
              coreIcon: '📦',
              coreLabel: 'IPv4 Data',
              onComplete: () => {
                dom.haBadge.textContent = '✓ 接收完成';
                dom.haBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-100 text-emerald-800 font-bold';

                animateDecapsulation({
                  slotEl: dom.haEncapBox,
                  macHeader: '目的: 00-11-22-33-AA-01',
                  payloadType: 'ip',
                  payloadContent: 'IP: 192.168.2.10 → 192.168.1.10',
                  matchedText: '✓ 剥离 MAC 帧头 · 反向数据接收成功！',
                  isIpFrame: true
                });
              }
            });
          }
        });
      }
    }
  };

  // =========================================================================
  // 9. 全局控制器逻辑 (Play / Step / Reset / Switch Scenario)
  // =========================================================================
  window.switchScenario = function (scen) {
    if (state.scenario === scen) return;
    pause();
    state.scenario = scen;
    state.flowIndex = 1;
    state.stepIndex = 0;

    if (scen === 'same') {
      dom.tabSame.className = 'px-3 py-1.5 rounded-lg font-bold bg-white text-stone-900 shadow-sm transition-all';
      dom.tabCross.className = 'px-3 py-1.5 rounded-lg font-medium text-stone-600 hover:text-stone-900 transition-all';
      dom.viewSame.classList.remove('hidden');
      dom.viewCross.classList.add('hidden');
      dom.flowBtnsSame.classList.remove('hidden');
      dom.flowBtnsCross.classList.add('hidden');
    } else {
      dom.tabCross.className = 'px-3 py-1.5 rounded-lg font-bold bg-white text-stone-900 shadow-sm transition-all';
      dom.tabSame.className = 'px-3 py-1.5 rounded-lg font-medium text-stone-600 hover:text-stone-900 transition-all';
      dom.viewSame.classList.add('hidden');
      dom.viewCross.classList.remove('hidden');
      dom.flowBtnsSame.classList.add('hidden');
      dom.flowBtnsCross.classList.remove('hidden');
    }

    resetCurrentScenario();
    setTimeout(() => {
      updateTopologyLinks();
    }, 50);
  };

  window.selectFlow = function (scen, flow) {
    pause();
    state.flowIndex = flow;
    state.stepIndex = 0;

    const prefix = scen === 'same' ? 'same-flow-' : 'cross-flow-';
    for (let i = 1; i <= 3; i++) {
      const btn = document.getElementById(`${prefix}${i}`);
      if (btn) {
        if (i === flow) {
          btn.className = 'flow-step-tab active text-left p-3 rounded-xl border border-stone-900 bg-stone-900 text-white transition-all shadow-sm';
        } else {
          btn.className = 'flow-step-tab text-left p-3 rounded-xl border border-[#E5E4DC] bg-stone-50 text-stone-800 hover:border-stone-400 transition-all';
        }
      }
    }

    resetVisuals();
    updateInspector(null);
  };

  function getMaxSteps() {
    if (state.scenario === 'same') {
      return sameEngine.getStepCount(state.flowIndex);
    } else {
      return crossEngine.getStepCount(state.flowIndex);
    }
  }

  window.nextStep = function () {
    const max = getMaxSteps();
    if (state.stepIndex >= max) {
      pause();
      return;
    }
    state.stepIndex++;
    executeStep(state.stepIndex);
  };

  window.prevStep = function () {
    if (state.stepIndex <= 1) {
      resetVisuals();
      state.stepIndex = 0;
      updateInspector(null);
      return;
    }
    state.stepIndex--;
    executeStep(state.stepIndex);
  };

  function executeStep(step) {
    if (state.scenario === 'same') {
      sameEngine.runStep(state.flowIndex, step);
    } else {
      crossEngine.runStep(state.flowIndex, step);
    }
  }

  window.togglePlay = function () {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  };

  function play() {
    state.isPlaying = true;
    dom.playIcon.textContent = '⏸';
    dom.playText.textContent = '暂停演示';
    dom.stateDot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-ping';
    dom.stateText.textContent = '演示进行中';

    const stepInterval = 3200 / state.speed;

    if (state.stepIndex >= getMaxSteps()) {
      state.stepIndex = 0;
      resetVisuals();
    }

    nextStep();

    state.timer = setInterval(() => {
      if (state.stepIndex >= getMaxSteps()) {
        pause();
      } else {
        nextStep();
      }
    }, stepInterval);
  }

  function pause() {
    state.isPlaying = false;
    dom.playIcon.textContent = '▶';
    dom.playText.textContent = '自动连续演示';
    dom.stateDot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    dom.stateText.textContent = '就绪';
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  window.setSpeed = function (spd) {
    state.speed = spd;
    document.querySelectorAll('.speed-pill').forEach(btn => {
      btn.className = 'speed-pill px-2 py-0.8 rounded border border-[#E5E4DC] text-stone-600 hover:border-stone-400';
    });
    if (event && event.target) {
      event.target.className = 'speed-pill active px-2 py-0.8 rounded border border-stone-900 bg-stone-900 text-white font-bold';
    }
    if (state.isPlaying) {
      pause();
      play();
    }
  };

  function resetVisuals() {
    state.activeTweens.forEach(t => t.kill());
    state.activeTweens = [];

    if (dom.packetsLayerSame) dom.packetsLayerSame.innerHTML = '';
    if (dom.packetsLayerCross) dom.packetsLayerCross.innerHTML = '';

    // 清空所有封装槽位
    const encapSlots = [
      'h1EncapBox', 'h2EncapBox', 'h3EncapBox', 'h4EncapBox',
      'haEncapBox', 'hbEncapBox', 'hcEncapBox', 'hdEncapBox', 'r1EncapBox'
    ];
    encapSlots.forEach(k => {
      if (dom[k]) {
        dom[k].innerHTML = '<span class="encap-label text-stone-400">待发缓冲区空闲</span>';
      }
    });

    const hostCards = document.querySelectorAll('.host-node-card');
    hostCards.forEach(c => {
      c.className = c.className.replace(/is-active-src|is-active-dst|is-discarded/g, '').trim();
    });

    ['h1Badge', 'h2Badge', 'h3Badge', 'h4Badge', 'haBadge', 'hbBadge', 'hcBadge', 'hdBadge'].forEach(k => {
      if (dom[k]) {
        dom[k].textContent = '就绪';
        dom[k].className = 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-stone-200 text-stone-700';
      }
    });

    if (dom.routeRow1) dom.routeRow1.className = 'border-b border-stone-150 transition-colors duration-200';
    if (dom.routeRow2) dom.routeRow2.className = 'border-b border-stone-150 transition-colors duration-200';
    if (dom.routeRowDef) dom.routeRowDef.className = 'transition-colors duration-200';
    if (dom.routeLookupStatus) {
      dom.routeLookupStatus.textContent = '待查表';
      dom.routeLookupStatus.className = 'text-[10px] font-mono text-stone-500 bg-white px-1.5 py-0.2 rounded border border-stone-200';
    }
  }

  window.resetCurrentScenario = function () {
    pause();
    state.stepIndex = 0;
    resetVisuals();
    updateInspector(null);

    if (state.scenario === 'same') {
      clearArpTable(dom.h1Tbody);
      clearArpTable(dom.h2Tbody);
      clearArpTable(dom.h3Tbody);
      clearArpTable(dom.h4Tbody);
      document.getElementById('h1-cache-count').textContent = '0 条目';
      document.getElementById('h2-cache-count').textContent = '0 条目';
      document.getElementById('h3-cache-count').textContent = '0 条目';
      document.getElementById('h4-cache-count').textContent = '0 条目';
    } else {
      clearArpTable(dom.haTbody);
      clearArpTable(dom.hbTbody);
      clearArpTable(dom.hcTbody);
      clearArpTable(dom.hdTbody);
      clearArpTable(dom.r1Tbody);
      document.getElementById('r1-cache-count').textContent = '0 条目';
    }
  };

  // =========================================================================
  // 10. 窗口重绘自适应与启动初始化
  // =========================================================================
  window.addEventListener('resize', () => {
    updateTopologyLinks();
  });

  document.addEventListener('DOMContentLoaded', () => {
    initDomRefs();
    updateTopologyLinks();
    updateInspector(null);
  });

})();
