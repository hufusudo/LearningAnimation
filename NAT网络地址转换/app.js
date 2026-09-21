/**
 * NAT 网络地址转换与 NAPT 端口多路复用交互系统 (app.js)
 * 遵循 agent.md 规范：GSAP 60fps 缓动 · 地址渐变转换 (私变公/公变私) · 动态 NAT 表 · 互联网云朵
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. 全局配置与状态模型
  // =========================================================================
  const state = {
    mode: 'basic',     // 'basic' (普通NAT) | 'napt' (端口NAT)
    flowIndex: 1,      // 1, 2, 3
    stepIndex: 0,      // 当前步骤
    isPlaying: false,
    timer: null,
    speed: 1.0,
    activeTweens: [],
    activeTimers: [],
    natTable: []       // 当前 NAT 表项
  };

  const NET_DATA = {
    hostA: { ip: '192.168.1.2', port: '50001', name: '主机 A' },
    hostB: { ip: '192.168.1.3', port: '50001', name: '主机 B' },
    routerLan: { ip: '192.168.1.1' },
    routerWanBasicPool: ['210.38.10.1', '210.38.10.2'],
    routerWanNaptIp: '210.38.10.1',
    server: { ip: '203.0.113.88', port: '80', name: 'Web 服务器' }
  };

  let dom = {};

  function initDomRefs() {
    dom = {
      // 模式 Tab
      tabBasic: document.getElementById('tab-mode-basic'),
      tabNapt: document.getElementById('tab-mode-napt'),
      flowBtnsBasic: document.getElementById('flow-btns-basic'),
      flowBtnsNapt: document.getElementById('flow-btns-napt'),

      // 控制按钮
      btnPlay: document.getElementById('btn-play'),
      playIcon: document.getElementById('play-icon'),
      playText: document.getElementById('play-text'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      btnReset: document.getElementById('btn-reset'),
      stateDot: document.getElementById('state-dot'),
      stateText: document.getElementById('state-text'),

      // 监测器
      natDirectionBadge: document.getElementById('nat-direction-badge'),
      natTypeBadge: document.getElementById('nat-type-badge'),
      inspSip: document.getElementById('insp-sip'),
      inspSipNote: document.getElementById('insp-sip-note'),
      inspDip: document.getElementById('insp-dip'),
      inspDipNote: document.getElementById('insp-dip-note'),
      inspSport: document.getElementById('insp-sport'),
      inspSportNote: document.getElementById('insp-sport-note'),
      inspDport: document.getElementById('insp-dport'),
      inspDportNote: document.getElementById('insp-dport-note'),
      descText: document.getElementById('desc-text'),
      descStep: document.getElementById('desc-step'),

      // 舞台与拓扑
      stageContainer: document.getElementById('stage-nat-container'),
      svgLinks: document.getElementById('svg-nat-links'),
      packetsLayer: document.getElementById('packets-layer-nat'),
      hostACard: document.getElementById('nat-host-a'),
      hostBCard: document.getElementById('nat-host-b'),
      haPortDisplay: document.getElementById('ha-port-display'),
      hbPortDisplay: document.getElementById('hb-port-display'),
      haSlot: document.getElementById('ha-slot'),
      hbSlot: document.getElementById('hb-slot'),
      haBadge: document.getElementById('ha-badge'),
      hbBadge: document.getElementById('hb-badge'),
      lanSwitch: document.getElementById('lan-switch-node'),
      routerCard: document.getElementById('nat-router-card'),
      routerStatusBadge: document.getElementById('router-status-badge'),
      wanModeTag: document.getElementById('wan-mode-tag'),
      wanIpDisplay: document.getElementById('wan-ip-display'),
      wanPoolDesc: document.getElementById('wan-pool-desc'),
      morphDirectionTag: document.getElementById('morph-direction-tag'),
      morphStageBox: document.getElementById('morph-stage-box'),
      thCol1: document.getElementById('th-col-1'),
      thCol2: document.getElementById('th-col-2'),
      thCol3: document.getElementById('th-col-3'),
      natTableCount: document.getElementById('nat-table-count'),
      natTableBody: document.getElementById('nat-table-body'),
      cloudBox: document.getElementById('internet-cloud-box'),
      destServerCard: document.getElementById('dest-server-card'),
      serverSlot: document.getElementById('server-slot'),
      serverBadge: document.getElementById('server-badge')
    };
  }

  // =========================================================================
  // 2. 动态地址渐变转换动画 (Address Morphing Engine)
  // =========================================================================

  // 格式化端点文字：若包含 :端口（如 :50001），则将其抽离并封装为带特定样式的 .port-chip 标签
  function formatEndpointHtml(str, isNew = false) {
    const portMatch = str.match(/:(\d+)/);
    if (!portMatch) {
      return str;
    }

    const portNum = portMatch[1];
    const fullPort = `:${portNum}`;
    const idx = str.indexOf(fullPort);
    const before = str.substring(0, idx);
    const after = str.substring(idx + fullPort.length);

    const chipClass = isNew ? 'port-chip port-chip-new' : 'port-chip port-chip-old';
    const portId = isNew ? 'morph-new-port' : 'morph-old-port';

    return `${before}<span class="${chipClass}"><span class="port-colon">:</span><span id="${portId}" class="port-num">${portNum}</span></span>${after}`;
  }

  // 端口号专属数字老虎机滚动动效 (Digital Slot Roll)
  function rollPortNumber(el, finalPort, durationSec = 0.35) {
    if (!el) return;
    const finalNum = parseInt(finalPort, 10);
    if (isNaN(finalNum)) {
      el.textContent = finalPort;
      return;
    }

    const totalSteps = Math.max(6, Math.floor(10 * durationSec * state.speed));
    let step = 0;
    const interval = (durationSec * 1000) / totalSteps;

    const timer = setInterval(() => {
      step++;
      if (step >= totalSteps) {
        clearInterval(timer);
        el.textContent = finalPort;
        // 锁定瞬间弹跳闪烁
        gsap.fromTo(el,
          { scale: 1.35, color: '#F59E0B' },
          { scale: 1.0, color: '#6D28D9', duration: 0.25 / state.speed, ease: 'back.out(2)' }
        );
      } else {
        // 随机 5 位端口号滚动
        const rand = Math.floor(20000 + Math.random() * 45000);
        el.textContent = String(rand);
      }
    }, interval);

    state.activeTimers.push(timer);
  }

  /**
   * 渐变动画：
   * 1. 先显示原本的 IP 地址与端口号
   * 2. 然后高亮一下变为转换后的 IP 地址与端口 (伴随箭头展开、端口3D翻转与数字老虎机滚动)
   * 3. 再把原来 IP 划去 (红色划线丝滑展开，原文字变暗褪色)
   * 方向要求：
   * - 私变公 (SNAT): 从左变到右 (oldValue ➔ newValue)
   * - 公变私 (DNAT): 从右变到左 (newValue ← oldValue)
   */
  function animateAddressMorph({
    direction = 'snat', // 'snat' (私变公) | 'dnat' (公变私)
    fieldLabel = '源 IP 地址',
    oldValue = '192.168.1.2',
    newValue = '210.38.10.1',
    onComplete = null
  }) {
    if (!dom.morphStageBox) return;

    const isSnat = direction === 'snat';
    const badgeClass = isSnat ? 'badge-snat' : 'badge-dnat';
    const badgeText = isSnat ? `⚡ 【私网 ➔ 公网 (SNAT)】${fieldLabel}转换` : `⚡ 【公网 ➔ 私网 (DNAT)】${fieldLabel}转换`;
    const tagText = isSnat ? '私变公 (SNAT)' : '公变私 (DNAT)';

    dom.morphDirectionTag.textContent = tagText;
    dom.morphDirectionTag.className = `px-2 py-0.2 rounded text-[10px] font-mono font-bold ${isSnat ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`;

    // 格式化端点文字（智能解析并提取端口号）
    const oldHtml = formatEndpointHtml(oldValue, false);
    const newHtml = formatEndpointHtml(newValue, true);

    // 检查是否存在端口号变换并生成提示横幅
    let portBannerHtml = '';
    const oldPortMatch = oldValue.match(/:(\d+)/);
    const newPortMatch = newValue.match(/:(\d+)/);
    if (oldPortMatch && newPortMatch && oldPortMatch[1] !== newPortMatch[1]) {
      const oldP = oldPortMatch[1];
      const newP = newPortMatch[1];
      const portDesc = isSnat ? 'NAT 分配外网端口' : '精准分流解复用';
      const arrowChar = isSnat ? '➔' : '←';
      portBannerHtml = `
        <div id="morph-port-banner" class="port-change-banner" style="opacity: 0; transform: translateY(6px);">
          <span>🔌 传输层端口变换:</span>
          ${isSnat ? `
            <span class="text-stone-500 font-bold">${oldP}</span>
            <span class="text-amber-500 font-bold">${arrowChar}</span>
            <span class="text-purple-700 font-bold bg-purple-100 px-1.5 py-0.2 rounded border border-purple-300 shadow-sm">${newP}</span>
          ` : `
            <span class="text-purple-700 font-bold bg-purple-100 px-1.5 py-0.2 rounded border border-purple-300 shadow-sm">${newP}</span>
            <span class="text-amber-500 font-bold">${arrowChar}</span>
            <span class="text-stone-500 font-bold">${oldP}</span>
          `}
          <span class="text-[9px] text-stone-400 font-sans">(${portDesc})</span>
        </div>
      `;
    }

    // 私变公：从左到右 (左边原私网地址，右边新公网地址，箭头向右 ➔)
    // 公变私：从右到左 (右边原公网地址，左边新私网地址，箭头向左 ←)
    if (isSnat) {
      dom.morphStageBox.innerHTML = `
        <div class="morph-wrapper">
          <div class="${badgeClass}">${badgeText}</div>
          <div class="morph-row">
            <span class="text-stone-500 text-[10px] whitespace-nowrap">${fieldLabel}:</span>
            <span id="morph-old-wrap" class="morph-old-wrap">
              <span id="morph-old-text" class="morph-old-text">${oldHtml}</span>
              <span id="morph-strike-line" class="morph-strike-line"></span>
            </span>
            <span id="morph-arrow" class="morph-arrow">➔</span>
            <span id="morph-new-el" class="morph-new" style="opacity: 0; transform: scale(0.85);">${newHtml}</span>
          </div>
          ${portBannerHtml}
        </div>
      `;
    } else {
      dom.morphStageBox.innerHTML = `
        <div class="morph-wrapper">
          <div class="${badgeClass}">${badgeText}</div>
          <div class="morph-row">
            <span class="text-stone-500 text-[10px] whitespace-nowrap">${fieldLabel}:</span>
            <span id="morph-new-el" class="morph-new" style="opacity: 0; transform: scale(0.85);">${newHtml}</span>
            <span id="morph-arrow" class="morph-arrow">←</span>
            <span id="morph-old-wrap" class="morph-old-wrap">
              <span id="morph-old-text" class="morph-old-text">${oldHtml}</span>
              <span id="morph-strike-line" class="morph-strike-line"></span>
            </span>
          </div>
          ${portBannerHtml}
        </div>
      `;
    }

    const oldTextEl = document.getElementById('morph-old-text');
    const strikeLine = document.getElementById('morph-strike-line');
    const arrowEl = document.getElementById('morph-arrow');
    const newEl = document.getElementById('morph-new-el');

    // 划线起点方向设置：
    // 私变公（从左到右）：划线从左侧向右侧拉伸
    // 公变私（从右到左）：划线从右侧向左侧拉伸
    gsap.set(strikeLine, {
      scaleX: 0,
      transformOrigin: isSnat ? 'left center' : 'right center'
    });

    const sp = state.speed;

    // 创建动画时间线并记录至 activeTweens，确保可平滑打断与重置
    const tl = gsap.timeline({
      onComplete: () => {
        if (onComplete) onComplete();
      }
    });
    state.activeTweens.push(tl);

    // 阶段 1：先显示原本的 IP 地址与端口号
    const delayPhase1 = 0.45 / sp;

    // 阶段 2：然后高亮一下变为转换后的 IP 地址与端口
    // 箭头展开入场
    tl.to(arrowEl, {
      opacity: 1,
      scale: 1,
      duration: 0.25 / sp,
      ease: 'back.out(1.6)'
    }, `+=${delayPhase1}`);

    // 新 IP 伴随明亮金黄高亮光效闪现并放大入场 (高亮一下)
    tl.fromTo(newEl,
      {
        opacity: 0,
        scale: 0.8,
        backgroundColor: '#FEF08A', // 明亮高亮闪烁
        borderColor: '#F59E0B',
        boxShadow: '0 0 16px rgba(245, 158, 11, 0.7)'
      },
      {
        opacity: 1,
        scale: 1.12,
        duration: 0.35 / sp,
        ease: 'back.out(1.7)'
      },
      "<"
    );

    // 端口号专属动效：3D 翻转 + 数字老虎机滚动 (Digital Slot Roll)
    const newPortEl = document.getElementById('morph-new-port');
    if (newPortEl) {
      const newPortChip = newPortEl.closest('.port-chip');
      if (newPortChip) {
        gsap.fromTo(newPortChip,
          {
            scale: 0.7,
            rotationX: -90,
            transformPerspective: 400,
            backgroundColor: '#FDE047',
            borderColor: '#EAB308',
            boxShadow: '0 0 14px rgba(234, 179, 8, 0.8)'
          },
          {
            scale: 1.15,
            rotationX: 0,
            duration: 0.35 / sp,
            ease: 'back.out(2)',
            onComplete: () => {
              gsap.to(newPortChip, {
                scale: 1.0,
                backgroundColor: '#EDE9FE',
                borderColor: '#C4B5FD',
                boxShadow: '0 0 8px rgba(124, 58, 237, 0.35)',
                duration: 0.2 / sp
              });
            }
          }
        );
      }
      const targetPort = newPortEl.textContent.trim();
      rollPortNumber(newPortEl, targetPort, 0.35 / sp);
    }

    // 端口转换提示横幅平滑展开
    const portBanner = document.getElementById('morph-port-banner');
    if (portBanner) {
      tl.to(portBanner, {
        opacity: 1,
        y: 0,
        duration: 0.3 / sp,
        ease: 'power2.out'
      }, "<");
    }

    // 高亮后平滑回归常态色彩
    tl.to(newEl, {
      scale: 1.0,
      backgroundColor: isSnat ? '#FEF3C7' : '#D1FAE5',
      borderColor: isSnat ? '#F59E0B' : '#6EE7B7',
      color: isSnat ? '#B45309' : '#047857',
      boxShadow: isSnat ? '0 0 10px rgba(245, 158, 11, 0.25)' : '0 0 10px rgba(16, 185, 129, 0.25)',
      duration: 0.25 / sp,
      ease: 'power2.out'
    });

    // 阶段 3：再把原来 IP 划去！红色划线丝滑横穿展开，原 IP 文字褪色变暗
    const delayPhase3 = 0.15 / sp;
    tl.to(strikeLine, {
      scaleX: 1,
      duration: 0.35 / sp,
      ease: 'power2.inOut'
    }, `+=${delayPhase3}`);

    tl.to(oldTextEl, {
      opacity: 0.4,
      color: '#78716C',
      duration: 0.3 / sp
    }, "<");
  }

  // =========================================================================
  // 3. 丝滑 NAT 转换表更新 (Silky Smooth NAT Table)
  // =========================================================================
  function insertNatTableRow(col1Val, col2Val, statusVal = '活跃 (Active)', isHighlight = true, onComplete = null) {
    const tbody = dom.natTableBody;
    if (!tbody) return;

    // 检查是否已有相同项
    const existing = tbody.querySelectorAll('tr:not(.empty-row)');
    for (let r of existing) {
      if (r.dataset.key === col1Val) {
        if (isHighlight) {
          r.classList.add('nat-row-hit');
          setTimeout(() => r.classList.remove('nat-row-hit'), 1200 / state.speed);
        }
        if (onComplete) onComplete();
        return;
      }
    }

    const emptyRow = tbody.querySelector('.empty-row');
    if (emptyRow) emptyRow.remove();

    const tr = document.createElement('tr');
    tr.dataset.key = col1Val;
    tr.className = 'nat-row-anim text-[9px] border-b border-stone-100';
    tr.style.opacity = '0';
    tr.style.maxHeight = '0px';
    tr.style.transform = 'translateY(-6px)';
    tr.style.overflow = 'hidden';

    tr.innerHTML = `
      <td class="py-1 font-semibold text-sky-800">${col1Val}</td>
      <td class="py-1 font-semibold text-amber-800">${col2Val}</td>
      <td class="py-1">
        <span class="px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 text-[8px] border border-emerald-200">
          ${statusVal}
        </span>
      </td>
    `;

    tbody.appendChild(tr);

    tr.style.maxHeight = 'none';
    const h = tr.offsetHeight || 26;
    tr.style.maxHeight = '0px';

    gsap.to(tr, {
      maxHeight: h + 2,
      opacity: 1,
      y: 0,
      duration: 0.4 / state.speed,
      ease: 'power2.out',
      onComplete: () => {
        tr.style.maxHeight = 'none';
        if (isHighlight) {
          tr.classList.add('nat-row-new');
          setTimeout(() => tr.classList.remove('nat-row-new'), 1400 / state.speed);
        }
        updateTableCount();
        if (onComplete) onComplete();
      }
    });
  }

  function updateTableCount() {
    const rows = dom.natTableBody.querySelectorAll('tr:not(.empty-row)');
    dom.natTableCount.textContent = `${rows.length} 条目`;
  }

  function clearNatTable(emptyMsg = '暂无转换表项 (冷启动)') {
    if (!dom.natTableBody) return;
    dom.natTableBody.innerHTML = `
      <tr class="empty-row text-stone-400 text-center">
        <td colspan="3" class="py-2">${emptyMsg}</td>
      </tr>
    `;
    dom.natTableCount.textContent = '0 条目';
  }

  // =========================================================================
  // 4. 实时报文透视与字段监测器更新 (Packet Inspector HUD)
  // =========================================================================
  function updateInspector(data) {
    if (!data) {
      dom.natDirectionBadge.textContent = '等待报文生成';
      dom.natDirectionBadge.className = 'px-2 py-0.5 rounded text-[11px] font-mono bg-stone-100 text-stone-600 border border-stone-200';
      dom.natTypeBadge.textContent = '--';
      dom.inspSip.textContent = '--';
      dom.inspSipNote.textContent = '--';
      dom.inspDip.textContent = '--';
      dom.inspDipNote.textContent = '--';
      dom.inspSport.textContent = '--';
      dom.inspSportNote.textContent = '--';
      dom.inspDport.textContent = '--';
      dom.inspDportNote.textContent = '--';
      return;
    }

    dom.natDirectionBadge.textContent = data.badgeText || '报文传输中';
    dom.natDirectionBadge.className = `px-2 py-0.5 rounded text-[11px] font-mono border ${data.badgeClass || 'bg-amber-50 text-amber-800 border-amber-200'}`;

    dom.natTypeBadge.textContent = data.typeBadge || '--';
    dom.natTypeBadge.className = `font-semibold ${data.typeClass || 'text-stone-800'}`;

    dom.inspSip.textContent = data.sip || '--';
    dom.inspSipNote.textContent = data.sipNote || '';
    dom.inspDip.textContent = data.dip || '--';
    dom.inspDipNote.textContent = data.dipNote || '';

    const oldSport = dom.inspSport.textContent;
    const oldDport = dom.inspDport.textContent;

    dom.inspSport.textContent = data.sport || '--';
    dom.inspSportNote.textContent = data.sportNote || '';
    dom.inspDport.textContent = data.dport || '--';
    dom.inspDportNote.textContent = data.dportNote || '';

    // 端口号发生有效变更时，触发醒目的跳动高亮动效
    if (data.sport && data.sport !== '--' && data.sport !== oldSport) {
      gsap.fromTo(dom.inspSport,
        { scale: 1.35, color: '#7C3AED', backgroundColor: '#EDE9FE', borderRadius: '4px' },
        { scale: 1.0, color: '', backgroundColor: '', duration: 0.45 / state.speed, ease: 'back.out(2)' }
      );
    }
    if (data.dport && data.dport !== '--' && data.dport !== oldDport) {
      gsap.fromTo(dom.inspDport,
        { scale: 1.35, color: '#7C3AED', backgroundColor: '#EDE9FE', borderRadius: '4px' },
        { scale: 1.0, color: '', backgroundColor: '', duration: 0.45 / state.speed, ease: 'back.out(2)' }
      );
    }

    if (data.desc) dom.descText.textContent = data.desc;
    if (data.stepText) dom.descStep.textContent = data.stepText;
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

  function drawSvgLine(svg, id, p1, p2, strokeColor = '#CBD5E1', isDashed = false) {
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
    const container = dom.stageContainer;
    const svg = dom.svgLinks;
    if (!container || !svg) return;

    const pHa = getCenterCoords(dom.hostACard, container);
    const pHb = getCenterCoords(dom.hostBCard, container);
    const pSw = getCenterCoords(dom.lanSwitch, container);
    const pRouterLan = getCenterCoords(document.getElementById('router-lan-card'), container);
    const pRouterWan = getCenterCoords(document.getElementById('router-wan-card'), container);
    const pCloud = getCenterCoords(dom.cloudBox, container);
    const pServer = getCenterCoords(dom.destServerCard, container);

    drawSvgLine(svg, 'link-ha-sw', pHa, pSw, '#0284C7');
    drawSvgLine(svg, 'link-hb-sw', pHb, pSw, '#0284C7');
    drawSvgLine(svg, 'link-sw-router', pSw, pRouterLan, '#0284C7');
    drawSvgLine(svg, 'link-router-cloud', pRouterWan, pCloud, '#D97706');
    drawSvgLine(svg, 'link-cloud-server', pCloud, pServer, '#D97706');
  }

  // =========================================================================
  // 6. 飞行报文驱动 (Flying Packet Engine)
  // =========================================================================
  function flyPacket({
    layer,
    startPos,
    endPos,
    duration = 0.8,
    title = 'IP 数据报',
    detail = '',
    extra = '',
    isWan = false,
    icon = '📦',
    label = 'IP Packet',
    onComplete = null
  }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'flying-packet-wrapper';

    const typeClass = isWan ? 'packet-wan-data' : 'packet-lan-data';

    wrapper.innerHTML = `
      <div class="packet-field-tooltip">
        <div class="tooltip-title">${title}</div>
        <div class="tooltip-detail">${detail}</div>
        ${extra ? `<div class="tooltip-detail font-mono">${extra}</div>` : ''}
      </div>
      <div class="packet-capsule-core ${typeClass}">
        <span>${icon}</span>
        <span>${label}</span>
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

  // =========================================================================
  // 7. 流程执行引擎 (Basic NAT 与 NAPT 统一编排)
  // =========================================================================
  const engine = {
    getStepCount() {
      if (state.mode === 'basic') {
        if (state.flowIndex === 1) return 6; // Host A 完整往返
        if (state.flowIndex === 2) return 6; // Host B 独立公网 IP
        if (state.flowIndex === 3) return 4; // 双机并发对比
      } else {
        if (state.flowIndex === 1) return 6; // NAPT Host A
        if (state.flowIndex === 2) return 6; // NAPT Host B 同端口冲突解决
        if (state.flowIndex === 3) return 4; // 双回包解复用
      }
      return 6;
    },

    runStep(step) {
      if (state.mode === 'basic') {
        this.runBasic(state.flowIndex, step);
      } else {
        this.runNapt(state.flowIndex, step);
      }
    },

    // -----------------------------------------------------------------------
    // 模式一：普通 NAT (Basic NAT)
    // -----------------------------------------------------------------------
    runBasic(flow, step) {
      const container = dom.stageContainer;
      const layer = dom.packetsLayer;

      const pHa = getCenterCoords(dom.hostACard, container);
      const pHb = getCenterCoords(dom.hostBCard, container);
      const pRouterLan = getCenterCoords(document.getElementById('router-lan-card'), container);
      const pRouterWan = getCenterCoords(document.getElementById('router-wan-card'), container);
      const pCloud = getCenterCoords(dom.cloudBox, container);
      const pServer = getCenterCoords(dom.destServerCard, container);

      // 流程 1：主机 A 发送与响应 (分配公网 IP: 210.38.10.1)
      if (flow === 1) {
        if (step === 1) {
          dom.hostACard.classList.add('is-active-src');
          dom.haBadge.textContent = '生成请求报文';
          dom.haBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-sky-100 text-sky-800 font-bold';

          dom.haSlot.innerHTML = `
            <div class="px-2 py-1 rounded bg-sky-100 border border-sky-300 text-sky-900 text-[10px] font-mono font-bold">
              Src: 192.168.1.2 ➔ Dst: 203.0.113.88
            </div>
          `;

          updateInspector({
            badgeText: '主机 A 发出内网请求',
            badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
            typeBadge: '内网私有数据报',
            typeClass: 'text-sky-700',
            sip: '192.168.1.2',
            sipNote: '私网 IP (RFC 1918)',
            dip: '203.0.113.88',
            dipNote: '公网目的服务器',
            sport: '--',
            sportNote: '普通 NAT 无端口转换',
            dport: '--',
            dportNote: '普通 NAT 无端口转换',
            desc: '【步骤 1/6】主机 A 准备访问外网服务器，封装 IP 数据报：源 IP 为私有地址 192.168.1.2，目的 IP 为外网服务器 203.0.113.88。',
            stepText: '步骤 1 / 6'
          });
        }
        else if (step === 2) {
          // 主机 A ➔ NAT 路由器
          updateInspector({
            badgeText: '数据报飞向 NAT 路由器',
            badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
            typeBadge: '私网传输中',
            sip: '192.168.1.2',
            dip: '203.0.113.88',
            desc: '【步骤 2/6】私网数据报到达 NAT 路由器内网接口。因私网 IP 在互联网不可路由，路由器必须执行 SNAT 转换！',
            stepText: '步骤 2 / 6'
          });

          flyPacket({
            layer,
            startPos: pHa,
            endPos: pRouterLan,
            duration: 0.7,
            title: '私网 IP 数据报',
            detail: 'Src: 192.168.1.2 ➔ Dst: 203.0.113.88',
            icon: '📦',
            label: 'LAN Packet',
            onComplete: () => {
              dom.routerStatusBadge.textContent = '接收私网报文';
              dom.routerStatusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-mono bg-sky-100 text-sky-800 border border-sky-300 font-bold';
            }
          });
        }
        else if (step === 3) {
          // NAT 路由器：记录 NAT 表，执行私变公 (SNAT) 渐变转换
          dom.routerStatusBadge.textContent = '执行 SNAT 转换';
          dom.routerStatusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-mono bg-amber-100 text-amber-800 border border-amber-300 font-bold';

          // 记录 NAT 表
          insertNatTableRow('192.168.1.2', '210.38.10.1', '映射中');

          // 地址渐变转换动画
          animateAddressMorph({
            direction: 'snat',
            fieldLabel: '源 IP (Src IP)',
            oldValue: '192.168.1.2 (私网)',
            newValue: '210.38.10.1 (公网池分配)',
            onComplete: () => {
              updateInspector({
                badgeText: 'SNAT 转换完成 · 私变公',
                badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
                typeBadge: '公网数据报 (SNAT)',
                typeClass: 'text-amber-700',
                sip: '210.38.10.1',
                sipNote: '已替换为公网 IP 1',
                dip: '203.0.113.88',
                dipNote: '外网服务器',
                desc: '【步骤 3/6·核心考点】NAT 路由器从公网 IP 池分配 210.38.10.1，并在 NAT 表建立映射。源 IP 由 192.168.1.2 平滑渐变为 210.38.10.1【私变公 (SNAT)】！',
                stepText: '步骤 3 / 6'
              });
            }
          });
        }
        else if (step === 4) {
          // 穿过云朵送达服务器
          dom.destServerCard.classList.add('is-active-dst');

          updateInspector({
            badgeText: '穿过互联网云朵 ➔ 送达目的服务器',
            badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
            typeBadge: '公网传输中',
            sip: '210.38.10.1',
            dip: '203.0.113.88',
            desc: '【步骤 4/6】报文以公网 IP 作为源地址，顺利穿过互联网云朵路由送达目的 Web 服务器。服务器记录客户端为 210.38.10.1。',
            stepText: '步骤 4 / 6'
          });

          flyPacket({
            layer,
            startPos: pRouterWan,
            endPos: pCloud,
            duration: 0.6,
            title: '公网 IP 数据报',
            detail: 'Src: 210.38.10.1 ➔ Dst: 203.0.113.88',
            isWan: true,
            icon: '☁️',
            label: 'WAN Packet',
            onComplete: () => {
              flyPacket({
                layer,
                startPos: pCloud,
                endPos: pServer,
                duration: 0.6,
                title: '送达服务器',
                isWan: true,
                icon: '🌐',
                label: 'To Server',
                onComplete: () => {
                  dom.serverBadge.textContent = '收到请求并响应';
                  dom.serverBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-100 text-emerald-800 font-bold';
                  dom.serverSlot.innerHTML = `
                    <div class="px-2 py-1 rounded bg-emerald-100 text-emerald-900 font-bold font-mono text-[9px]">
                      收到来自 210.38.10.1 的请求
                    </div>
                  `;
                }
              });
            }
          });
        }
        else if (step === 5) {
          // 服务器响应包送达 NAT 路由器
          updateInspector({
            badgeText: '服务器响应 ➔ 穿过云朵抵 NAT',
            badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
            typeBadge: '公网回包',
            sip: '203.0.113.88',
            sipNote: '服务器',
            dip: '210.38.10.1',
            dipNote: '目的为 NAT 公网 IP',
            desc: '【步骤 5/6】Web 服务器发出响应包：目的 IP 填写公网地址 210.38.10.1。回包穿过互联网云朵到达 NAT 路由器外网接口。',
            stepText: '步骤 5 / 6'
          });

          flyPacket({
            layer,
            startPos: pServer,
            endPos: pCloud,
            duration: 0.6,
            title: '服务器响应包',
            detail: 'Dst: 210.38.10.1',
            isWan: true,
            icon: '☁️',
            label: 'Response',
            onComplete: () => {
              flyPacket({
                layer,
                startPos: pCloud,
                endPos: pRouterWan,
                duration: 0.6,
                title: '回抵 NAT 路由器',
                isWan: true,
                icon: '🔀',
                label: 'At NAT',
                onComplete: () => {
                  dom.routerStatusBadge.textContent = '查表执行 DNAT';
                  dom.routerStatusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-mono bg-sky-100 text-sky-800 border border-sky-300 font-bold';

                  // 执行公变私 (DNAT) 渐变转换！
                  animateAddressMorph({
                    direction: 'dnat',
                    fieldLabel: '目的 IP (Dst IP)',
                    oldValue: '210.38.10.1 (公网)',
                    newValue: '192.168.1.2 (私网主机 A)',
                    onComplete: () => {
                      updateInspector({
                        badgeText: 'DNAT 转换完成 · 公变私',
                        badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
                        typeBadge: '私网数据报 (DNAT)',
                        typeClass: 'text-sky-700',
                        sip: '203.0.113.88',
                        dip: '192.168.1.2',
                        dipNote: '已替换为私网 IP',
                        desc: '【步骤 5/6·核心考点】NAT 路由器根据目的 IP 210.38.10.1 查表，将目的地址渐变转换回私网 IP 192.168.1.2【公变私 (DNAT)】！',
                        stepText: '步骤 5 / 6'
                      });
                    }
                  });
                }
              });
            }
          });
        }
        else if (step === 6) {
          // 交付主机 A
          dom.hostACard.classList.add('is-active-dst');

          updateInspector({
            badgeText: '数据交付完成！',
            badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
            typeBadge: '交付完成',
            typeClass: 'text-emerald-700',
            sip: '203.0.113.88',
            dip: '192.168.1.2',
            desc: '【步骤 6/6】响应数据报通过内网接口送达主机 A，主机 A 成功获得来自 Web 服务器的网页数据！普通 NAT 往返流程圆满完成！',
            stepText: '步骤 6 / 6'
          });

          flyPacket({
            layer,
            startPos: pRouterLan,
            endPos: pHa,
            duration: 0.6,
            title: '交付主机 A',
            detail: 'Dst: 192.168.1.2',
            icon: '📦',
            label: 'To Host A',
            onComplete: () => {
              dom.haBadge.textContent = '✓ 收到响应';
              dom.haBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-100 text-emerald-800 font-bold';
              dom.haSlot.innerHTML = `
                <div class="px-2 py-1 rounded bg-emerald-100 text-emerald-900 font-bold font-mono text-[9px]">
                  ✓ 收到来自服务器的响应！
                </div>
              `;
            }
          });
        }
      }

      // 流程 2：主机 B 发起请求 (分配不同公网 IP: 210.38.10.2)
      else if (flow === 2) {
        if (step === 1) {
          dom.hostBCard.classList.add('is-active-src');
          dom.hbBadge.textContent = '生成请求报文';
          dom.hbBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-sky-100 text-sky-800 font-bold';

          dom.hbSlot.innerHTML = `
            <div class="px-2 py-1 rounded bg-sky-100 border border-sky-300 text-sky-900 text-[10px] font-mono font-bold">
              Src: 192.168.1.3 ➔ Dst: 203.0.113.88
            </div>
          `;

          updateInspector({
            badgeText: '主机 B 发出内网请求',
            badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
            typeBadge: '内网私有数据报',
            sip: '192.168.1.3',
            sipNote: '主机 B 私网 IP',
            dip: '203.0.113.88',
            dipNote: '目的服务器',
            desc: '【步骤 1/6】主机 B 发送请求：源 IP 为 192.168.1.3。',
            stepText: '步骤 1 / 6'
          });
        }
        else if (step === 2) {
          flyPacket({
            layer,
            startPos: pHb,
            endPos: pRouterLan,
            duration: 0.7,
            title: '私网数据报 (主机 B)',
            detail: 'Src: 192.168.1.3',
            icon: '📦',
            label: 'From Host B',
            onComplete: () => {
              dom.routerStatusBadge.textContent = '为 Host B 分配 IP 2';
            }
          });
        }
        else if (step === 3) {
          // 分配第二个不同的公网 IP
          insertNatTableRow('192.168.1.3', '210.38.10.2', '映射中');

          animateAddressMorph({
            direction: 'snat',
            fieldLabel: '源 IP (Src IP)',
            oldValue: '192.168.1.3 (私网)',
            newValue: '210.38.10.2 (公网 IP 2)',
            onComplete: () => {
              updateInspector({
                badgeText: 'SNAT 转换 · 分配不同公网 IP',
                badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
                typeBadge: 'SNAT (公网 IP 2)',
                sip: '210.38.10.2',
                sipNote: '分配公网 IP 2',
                dip: '203.0.113.88',
                desc: '【步骤 3/6·核心考点】普通 NAT 为主机 B 分配不同的公网 IP 210.38.10.2！两台主机占用两个独立公网 IP。',
                stepText: '步骤 3 / 6'
              });
            }
          });
        }
        else if (step === 4) {
          flyPacket({
            layer,
            startPos: pRouterWan,
            endPos: pServer,
            duration: 1.0,
            title: '公网数据报 (IP 2)',
            detail: 'Src: 210.38.10.2',
            isWan: true,
            icon: '☁️',
            label: 'To Server',
            onComplete: () => {
              dom.serverSlot.innerHTML = `
                <div class="px-2 py-1 rounded bg-emerald-100 text-emerald-900 font-bold font-mono text-[9px]">
                  收到来自 210.38.10.2 的请求
                </div>
              `;
            }
          });
        }
        else if (step === 5) {
          flyPacket({
            layer,
            startPos: pServer,
            endPos: pRouterWan,
            duration: 1.0,
            title: '服务器响应 (至 IP 2)',
            detail: 'Dst: 210.38.10.2',
            isWan: true,
            icon: '☁️',
            label: 'Response',
            onComplete: () => {
              animateAddressMorph({
                direction: 'dnat',
                fieldLabel: '目的 IP (Dst IP)',
                oldValue: '210.38.10.2 (公网)',
                newValue: '192.168.1.3 (私网主机 B)',
                onComplete: () => {
                  updateInspector({
                    badgeText: 'DNAT 转换回主机 B',
                    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
                    sip: '203.0.113.88',
                    dip: '192.168.1.3',
                    desc: '【步骤 5/6】根据 210.38.10.2 查表命中，转换回 192.168.1.3【公变私 (DNAT)】。',
                    stepText: '步骤 5 / 6'
                  });
                }
              });
            }
          });
        }
        else if (step === 6) {
          dom.hostBCard.classList.add('is-active-dst');

          flyPacket({
            layer,
            startPos: pRouterLan,
            endPos: pHb,
            duration: 0.6,
            title: '交付主机 B',
            icon: '📦',
            label: 'To Host B',
            onComplete: () => {
              dom.hbBadge.textContent = '✓ 收到响应';
              dom.hbBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-100 text-emerald-800 font-bold';
              dom.hbSlot.innerHTML = `
                <div class="px-2 py-1 rounded bg-emerald-100 text-emerald-900 font-bold font-mono text-[9px]">
                  ✓ 主机 B 收到响应！
                </div>
              `;
            }
          });
        }
      }

      // 流程 3：双机并发与地址池耗尽机制
      else if (flow === 3) {
        if (step === 1) {
          insertNatTableRow('192.168.1.2', '210.38.10.1', '占用');
          insertNatTableRow('192.168.1.3', '210.38.10.2', '占用');

          updateInspector({
            badgeText: '双机同时在线 · IP 池已满',
            badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
            typeBadge: '普通 NAT 瓶颈',
            typeClass: 'text-amber-700',
            sip: '192.168.1.x',
            dip: '203.0.113.88',
            desc: '【步骤 1/4】主机 A 和主机 B 同时访问外网，NAT 路由器的公网 IP 池（共 2 个）被全部占满！',
            stepText: '步骤 1 / 4'
          });
        }
        else if (step === 2) {
          dom.wanPoolDesc.textContent = '⚠️ 公网 IP 池已耗尽 (0 可用)';
          dom.wanPoolDesc.className = 'text-rose-600 text-[9px] font-bold';

          dom.morphStageBox.innerHTML = `
            <div class="p-2 rounded bg-rose-50 border border-rose-200 text-rose-800 font-bold text-center">
              ⚠️ 公网 IP 资源耗尽！若有主机 C 请求外网将直接被丢弃！
            </div>
          `;

          updateInspector({
            badgeText: '普通 NAT 无法解决 IPv4 枯竭',
            badgeClass: 'bg-rose-50 text-rose-800 border-rose-200',
            desc: '【步骤 2/4·408 核心考点】普通 NAT 仅转换 IP 不转换端口，公网与私网是 1:1 静态或动态映射，无法复用，因此必须引入 NAPT！',
            stepText: '步骤 2 / 4'
          });
        }
        else if (step >= 3) {
          updateInspector({
            badgeText: '引出 NAPT / 端口多路复用',
            badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
            desc: '【步骤 3/4】请切换到顶部的“② NAPT / 端口 NAT”，观察成千上万台主机如何共享单公网 IP！',
            stepText: '步骤 3 / 4'
          });
        }
      }
    },

    // -----------------------------------------------------------------------
    // 模式二：使用端口号的 NAT (NAPT / PAT)
    // -----------------------------------------------------------------------
    runNapt(flow, step) {
      const container = dom.stageContainer;
      const layer = dom.packetsLayer;

      const pHa = getCenterCoords(dom.hostACard, container);
      const pHb = getCenterCoords(dom.hostBCard, container);
      const pRouterLan = getCenterCoords(document.getElementById('router-lan-card'), container);
      const pRouterWan = getCenterCoords(document.getElementById('router-wan-card'), container);
      const pCloud = getCenterCoords(dom.cloudBox, container);
      const pServer = getCenterCoords(dom.destServerCard, container);

      // 流程 1：主机 A 端口映射 (50001 ➔ 30001)
      if (flow === 1) {
        if (step === 1) {
          dom.hostACard.classList.add('is-active-src');
          dom.haBadge.textContent = '生成 TCP 报文';

          dom.haSlot.innerHTML = `
            <div class="px-2 py-1 rounded bg-sky-100 border border-sky-300 text-sky-900 text-[10px] font-mono font-bold">
              192.168.1.2:50001 ➔ 203.0.113.88:80
            </div>
          `;

          updateInspector({
            badgeText: '主机 A 发出内网数据包',
            badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
            typeBadge: '内网 IP + 端口',
            sip: '192.168.1.2',
            sipNote: '私网 IP',
            sport: '50001',
            sportNote: '客户端源端口',
            dip: '203.0.113.88',
            dipNote: '服务器 IP',
            dport: '80',
            dportNote: 'HTTP 目的端口',
            desc: '【步骤 1/6】主机 A 发起 HTTP 请求：源端点为 192.168.1.2:50001，目的端点为 203.0.113.88:80。',
            stepText: '步骤 1 / 6'
          });
        }
        else if (step === 2) {
          flyPacket({
            layer,
            startPos: pHa,
            endPos: pRouterLan,
            duration: 0.7,
            title: 'NAPT 内网数据包',
            detail: 'Src: 192.168.1.2:50001',
            icon: '📦',
            label: 'TCP SYN/DATA'
          });
        }
        else if (step === 3) {
          // NAPT 路由器：建立 IP + 端口映射表项，执行渐变转换
          insertNatTableRow('192.168.1.2:50001', '210.38.10.1:30001', 'ESTABLISHED');

          animateAddressMorph({
            direction: 'snat',
            fieldLabel: '源端点 (Src IP:Port)',
            oldValue: '192.168.1.2:50001 (私网)',
            newValue: '210.38.10.1:30001 (公网)',
            onComplete: () => {
              updateInspector({
                badgeText: 'NAPT SNAT 转换完成',
                badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
                typeBadge: 'NAPT (私变公)',
                sip: '210.38.10.1',
                sipNote: '共享公网 IP',
                sport: '30001',
                sportNote: '分配外网端口 1',
                dip: '203.0.113.88',
                dport: '80',
                desc: '【步骤 3/6·核心考点】NAPT 路由器将源端点由 192.168.1.2:50001 渐变替换为 210.38.10.1:30001【私变公 (SNAT)】！',
                stepText: '步骤 3 / 6'
              });
            }
          });
        }
        else if (step === 4) {
          flyPacket({
            layer,
            startPos: pRouterWan,
            endPos: pServer,
            duration: 1.0,
            title: 'NAPT 外网数据包',
            detail: 'Src: 210.38.10.1:30001',
            isWan: true,
            icon: '☁️',
            label: 'To Web Server',
            onComplete: () => {
              dom.serverSlot.innerHTML = `
                <div class="px-2 py-1 rounded bg-emerald-100 text-emerald-900 font-bold font-mono text-[9px]">
                  收到连接: 210.38.10.1:30001
                </div>
              `;
            }
          });
        }
        else if (step === 5) {
          flyPacket({
            layer,
            startPos: pServer,
            endPos: pRouterWan,
            duration: 1.0,
            title: '服务器响应 (至端口 30001)',
            detail: 'Dst: 210.38.10.1:30001',
            isWan: true,
            icon: '☁️',
            label: 'HTTP 200 OK',
            onComplete: () => {
              animateAddressMorph({
                direction: 'dnat',
                fieldLabel: '目的端点 (Dst IP:Port)',
                oldValue: '210.38.10.1:30001 (公网)',
                newValue: '192.168.1.2:50001 (私网主机 A)',
                onComplete: () => {
                  updateInspector({
                    badgeText: 'NAPT DNAT 转换完成',
                    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
                    sip: '203.0.113.88',
                    sport: '80',
                    dip: '192.168.1.2',
                    dport: '50001',
                    desc: '【步骤 5/6】根据目的端口 30001 查表，将目的端点渐变还原为 192.168.1.2:50001【公变私 (DNAT)】！',
                    stepText: '步骤 5 / 6'
                  });
                }
              });
            }
          });
        }
        else if (step === 6) {
          dom.hostACard.classList.add('is-active-dst');

          flyPacket({
            layer,
            startPos: pRouterLan,
            endPos: pHa,
            duration: 0.6,
            title: '交付主机 A',
            detail: 'Dst: :50001',
            icon: '📦',
            label: 'HTTP Data',
            onComplete: () => {
              dom.haBadge.textContent = '✓ 收到网页';
              dom.haSlot.innerHTML = `
                <div class="px-2 py-1 rounded bg-emerald-100 text-emerald-900 font-bold font-mono text-[9px]">
                  ✓ 端口 50001 收到数据！
                </div>
              `;
            }
          });
        }
      }

      // 流程 2：同端口号冲突解决 (主机 B 也使用 50001 端口!)
      else if (flow === 2) {
        if (step === 1) {
          dom.hostBCard.classList.add('is-active-src');
          dom.hbBadge.textContent = '同端口 50001 请求';

          dom.hbSlot.innerHTML = `
            <div class="px-2 py-1 rounded bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-mono font-bold">
              192.168.1.3:50001 ➔ 203.0.113.88:80
            </div>
          `;

          updateInspector({
            badgeText: '主机 B 同样使用 50001 端口',
            badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
            typeBadge: '408 核心考点',
            sip: '192.168.1.3',
            sport: '50001',
            dip: '203.0.113.88',
            dport: '80',
            desc: '【步骤 1/6·408 经典考点】主机 B 巧合地也使用了相同的源端口 50001！看 NAPT 如何解决此冲突！',
            stepText: '步骤 1 / 6'
          });
        }
        else if (step === 2) {
          flyPacket({
            layer,
            startPos: pHb,
            endPos: pRouterLan,
            duration: 0.7,
            title: '内网数据包 (同为 50001)',
            detail: 'Src: 192.168.1.3:50001',
            icon: '📦',
            label: 'TCP SYN'
          });
        }
        else if (step === 3) {
          // NAPT 分配不同的外网端口 30002！
          insertNatTableRow('192.168.1.3:50001', '210.38.10.1:30002', 'ESTABLISHED');

          animateAddressMorph({
            direction: 'snat',
            fieldLabel: '源端点 (Src IP:Port)',
            oldValue: '192.168.1.3:50001 (内网冲突端口)',
            newValue: '210.38.10.1:30002 (分配不同外网端口)',
            onComplete: () => {
              updateInspector({
                badgeText: '外网端口成功解冲突！',
                badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
                typeBadge: '端口多路复用',
                sip: '210.38.10.1',
                sport: '30002',
                sportNote: '分配不同端口 30002！',
                dip: '203.0.113.88',
                dport: '80',
                desc: '【步骤 3/6·核心考点】虽然内网端口同为 50001，但 NAPT 路由器为主机 B 分配了不同的公网端口 30002，完美化解冲突！',
                stepText: '步骤 3 / 6'
              });
            }
          });
        }
        else if (step === 4) {
          flyPacket({
            layer,
            startPos: pRouterWan,
            endPos: pServer,
            duration: 1.0,
            title: '公网数据包 (端口 30002)',
            detail: 'Src: 210.38.10.1:30002',
            isWan: true,
            icon: '☁️',
            label: 'To Server'
          });
        }
        else if (step === 5) {
          flyPacket({
            layer,
            startPos: pServer,
            endPos: pRouterWan,
            duration: 1.0,
            title: '服务器响应 (至端口 30002)',
            detail: 'Dst: 210.38.10.1:30002',
            isWan: true,
            icon: '☁️',
            label: 'Response',
            onComplete: () => {
              animateAddressMorph({
                direction: 'dnat',
                fieldLabel: '目的端点 (Dst IP:Port)',
                oldValue: '210.38.10.1:30002 (公网)',
                newValue: '192.168.1.3:50001 (私网主机 B)',
                onComplete: () => {
                  updateInspector({
                    badgeText: '根据端口 30002 精准回流主机 B',
                    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
                    sip: '203.0.113.88',
                    sport: '80',
                    dip: '192.168.1.3',
                    dport: '50001',
                    desc: '【步骤 5/6】路由器凭借目的端口 30002 查表，精确将回包分流给主机 B，而绝不会误发给主机 A！',
                    stepText: '步骤 5 / 6'
                  });
                }
              });
            }
          });
        }
        else if (step === 6) {
          dom.hostBCard.classList.add('is-active-dst');

          flyPacket({
            layer,
            startPos: pRouterLan,
            endPos: pHb,
            duration: 0.6,
            title: '交付主机 B',
            icon: '📦',
            label: 'To Host B',
            onComplete: () => {
              dom.hbBadge.textContent = '✓ 收到响应';
              dom.hbSlot.innerHTML = `
                <div class="px-2 py-1 rounded bg-emerald-100 text-emerald-900 font-bold font-mono text-[9px]">
                  ✓ 主机 B 端口 50001 收到回包！
                </div>
              `;
            }
          });
        }
      }

      // 流程 3：双回包根据端口精准分流
      else if (flow === 3) {
        if (step === 1) {
          insertNatTableRow('192.168.1.2:50001', '210.38.10.1:30001', 'ACTIVE');
          insertNatTableRow('192.168.1.3:50001', '210.38.10.1:30002', 'ACTIVE');

          updateInspector({
            badgeText: '双回包同时到达 NAT 路由器',
            badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
            typeBadge: '端口解复用',
            desc: '【步骤 1/4】服务器同时发来两个回包：包 1 目的为 :30001，包 2 目的为 :30002。',
            stepText: '步骤 1 / 4'
          });
        }
        else if (step === 2) {
          animateAddressMorph({
            direction: 'dnat',
            fieldLabel: '双端口查表分流',
            oldValue: ':30001 & :30002 (公网端口)',
            newValue: 'A(:50001) & B(:50001) (私网)',
            onComplete: () => {
              updateInspector({
                badgeText: '端口解复用 (Demultiplexing) 成功',
                badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
                desc: '【步骤 2/4·408 核心考点】NAPT 彻底解决了“单个公网 IP 如何同时服务多个局域网客户”的根本难题！',
                stepText: '步骤 2 / 4'
              });
            }
          });
        }
        else if (step >= 3) {
          updateInspector({
            badgeText: 'NAPT 原理演示圆满完成',
            badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
            desc: '【步骤 3/4】成千上万台主机共享 1 个公网 IP（利用 65535 个端口号多路复用），这就是家用无线路由器和企业网关的基石！',
            stepText: '步骤 3 / 4'
          });
        }
      }
    }
  };

  // =========================================================================
  // 8. 全局控制器 (模式切换 / 流程选择 / 播放控制)
  // =========================================================================
  window.switchNatMode = function (mode) {
    if (state.mode === mode) return;
    pause();
    state.mode = mode;
    state.flowIndex = 1;
    state.stepIndex = 0;

    if (mode === 'basic') {
      dom.tabBasic.className = 'px-3 py-1.5 rounded-lg font-bold bg-white text-stone-900 shadow-sm transition-all';
      dom.tabNapt.className = 'px-3 py-1.5 rounded-lg font-medium text-stone-600 hover:text-stone-900 transition-all';
      dom.flowBtnsBasic.classList.remove('hidden');
      dom.flowBtnsNapt.classList.add('hidden');

      // 更新表头与卡片标签
      dom.thCol1.textContent = '私网 IP';
      dom.thCol2.textContent = '公网 IP (池分配)';
      dom.wanModeTag.textContent = '公网 IP 池';
      dom.wanIpDisplay.innerHTML = 'IP: <b>210.38.10.1~2</b>';
      dom.wanPoolDesc.textContent = '公网 IP 池: 210.38.10.1, 210.38.10.2';
      dom.haPortDisplay.textContent = '-- (不涉及)';
      dom.hbPortDisplay.textContent = '-- (不涉及)';
    } else {
      dom.tabNapt.className = 'px-3 py-1.5 rounded-lg font-bold bg-white text-stone-900 shadow-sm transition-all';
      dom.tabBasic.className = 'px-3 py-1.5 rounded-lg font-medium text-stone-600 hover:text-stone-900 transition-all';
      dom.flowBtnsBasic.classList.add('hidden');
      dom.flowBtnsNapt.classList.remove('hidden');

      dom.thCol1.textContent = '私网 IP:端口';
      dom.thCol2.textContent = 'WAN 公网 IP:端口';
      dom.wanModeTag.textContent = '单 IP 复用';
      dom.wanIpDisplay.innerHTML = 'IP: <b>210.38.10.1</b>';
      dom.wanPoolDesc.textContent = '单公网 IP · 端口号多路复用';
      dom.haPortDisplay.textContent = '50001';
      dom.hbPortDisplay.textContent = '50001';
    }

    resetCurrentScenario();
  };

  window.selectFlow = function (mode, flow) {
    pause();
    state.flowIndex = flow;
    state.stepIndex = 0;

    const prefix = mode === 'basic' ? 'basic-flow-' : 'napt-flow-';
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

  window.nextStep = function () {
    const max = engine.getStepCount();
    if (state.stepIndex >= max) {
      pause();
      return;
    }
    state.stepIndex++;
    engine.runStep(state.stepIndex);
  };

  window.prevStep = function () {
    if (state.stepIndex <= 1) {
      resetVisuals();
      state.stepIndex = 0;
      updateInspector(null);
      return;
    }
    state.stepIndex--;
    engine.runStep(state.stepIndex);
  };

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

    if (state.stepIndex >= engine.getStepCount()) {
      state.stepIndex = 0;
      resetVisuals();
    }

    nextStep();

    state.timer = setInterval(() => {
      if (state.stepIndex >= engine.getStepCount()) {
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
    state.activeTimers.forEach(t => clearInterval(t));
    state.activeTimers = [];

    if (dom.packetsLayer) dom.packetsLayer.innerHTML = '';

    dom.haSlot.innerHTML = '<span class="encap-label text-stone-400">待发缓冲区空闲</span>';
    dom.hbSlot.innerHTML = '<span class="encap-label text-stone-400">待发缓冲区空闲</span>';
    dom.serverSlot.innerHTML = '<span class="encap-label text-stone-400">等待客户请求</span>';

    dom.morphStageBox.innerHTML = '<span class="text-stone-400">等待报文穿过 NAT 边界...</span>';
    dom.morphDirectionTag.textContent = '静止中';
    dom.morphDirectionTag.className = 'px-2 py-0.2 rounded text-[10px] font-mono font-bold bg-stone-200 text-stone-600';

    [dom.hostACard, dom.hostBCard, dom.destServerCard].forEach(c => {
      if (c) c.className = c.className.replace(/is-active-src|is-active-dst/g, '').trim();
    });

    dom.haBadge.textContent = '就绪';
    dom.haBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-stone-100 text-stone-600';
    dom.hbBadge.textContent = '就绪';
    dom.hbBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-stone-100 text-stone-600';
    dom.serverBadge.textContent = '服务正常';
    dom.serverBadge.className = 'px-1 py-0.2 rounded text-[9px] font-mono bg-stone-100 text-stone-600';
    dom.routerStatusBadge.textContent = '待转换';
    dom.routerStatusBadge.className = 'px-2 py-0.5 rounded text-[10px] font-mono bg-stone-100 text-stone-700 border border-stone-300';
  }

  window.resetCurrentScenario = function () {
    pause();
    state.stepIndex = 0;
    resetVisuals();
    updateInspector(null);
    clearNatTable();
  };

  // =========================================================================
  // 9. 自适应与启动初始化
  // =========================================================================
  window.addEventListener('resize', () => {
    updateTopologyLinks();
  });

  document.addEventListener('DOMContentLoaded', () => {
    initDomRefs();
    updateTopologyLinks();
    updateInspector(null);
    switchNatMode('basic');
  });

})();
