/**
 * 以太网交换机自学习与环路兜圈问题交互系统 (app.js)
 * 60fps GSAP 动效 · 像素级对齐教材「兜圈问题」图示 · 内部转发表动态演进与震荡展示
 */

(function () {
  'use strict';

  // =========================================================================
  // 全局视图模式切换 (Mode 1: 双交换机兜圈问题 | Mode 2: 单交换机自学习)
  // =========================================================================
  let currentMainMode = 'loop'; // 默认进入用户要求的“兜圈问题”

  window.setMainMode = function (mode) {
    currentMainMode = mode;
    const viewLoop = document.getElementById('view-loop');
    const viewSingle = document.getElementById('view-single');
    const tabLoop = document.getElementById('tab-mode-loop');
    const tabSingle = document.getElementById('tab-mode-single');

    if (mode === 'loop') {
      viewLoop.classList.remove('hidden');
      viewSingle.classList.add('hidden');
      tabLoop.className = 'px-3 py-1.5 rounded-lg font-bold bg-white text-stone-900 shadow-sm transition-all';
      tabSingle.className = 'px-3 py-1.5 rounded-lg font-medium text-stone-600 hover:text-stone-900 transition-all';
      window.location.hash = 'loop';
      setTimeout(() => {
        loopEngine.updateCoords();
        loopEngine.reset();
      }, 50);
    } else {
      viewLoop.classList.add('hidden');
      viewSingle.classList.remove('hidden');
      tabSingle.className = 'px-3 py-1.5 rounded-lg font-bold bg-white text-stone-900 shadow-sm transition-all';
      tabLoop.className = 'px-3 py-1.5 rounded-lg font-medium text-stone-600 hover:text-stone-900 transition-all';
      window.location.hash = 'single';
      setTimeout(() => {
        singleEngine.updateCoords();
        singleEngine.reset();
      }, 50);
    }
  };

  // =========================================================================
  // 模块 1：双交换机环路兜圈问题 (LoopEngine - 严格对齐用户图示)
  // =========================================================================
  const loopEngine = (function () {
    const loopState = {
      step: 0, // 0: 就绪, 1: A发帧, 2: 抵SW2, 3: 倒灌SW1, 4: 风暴死循环
      isPlaying: false,
      timer: null,
      speed: 1.0,
      stpEnabled: false,
      hostBCount: 0,
      activeTweens: [],
      sw1Table: [], // [{ mac: 'A', port: 1, isNew, isFlapping }]
      sw2Table: []  // [{ mac: 'A', port: 1, isNew, isFlapping }]
    };

    let loopCoords = {};

    const els = {
      container: document.getElementById('loop-canvas-container'),
      svgLinks: document.getElementById('loop-static-links'),
      svgPackets: document.getElementById('loop-packets'),

      btnPlay: document.getElementById('loop-btn-play'),
      playIcon: document.getElementById('loop-play-icon'),
      playText: document.getElementById('loop-play-text'),
      stpBadge: document.getElementById('stp-badge'),
      btnStp: document.getElementById('loop-btn-stp'),

      statusIcon: document.getElementById('loop-status-icon'),
      statusTitle: document.getElementById('loop-status-title'),
      statusDesc: document.getElementById('loop-status-desc'),
      hostBCount: document.getElementById('host-B-packet-count'),

      sw1TableBody: document.getElementById('sw1-table-body'),
      sw2TableBody: document.getElementById('sw2-table-body'),

      hostA: document.getElementById('loop-host-A'),
      hostC: document.getElementById('loop-host-C'),
      hostB: document.getElementById('loop-host-B'),
      hostD: document.getElementById('loop-host-D'),

      sw1Ports: {
        1: document.getElementById('sw1-p1'),
        2: document.getElementById('sw1-p2'),
        3: document.getElementById('sw1-p3'),
        4: document.getElementById('sw1-p4')
      },
      sw2Ports: {
        1: document.getElementById('sw2-p1'),
        2: document.getElementById('sw2-p2'),
        3: document.getElementById('sw2-p3'),
        4: document.getElementById('sw2-p4')
      }
    };

    function updateCoords() {
      if (!els.container) return;
      const rect = els.container.getBoundingClientRect();

      function getCenter(el) {
        if (!el) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        return {
          x: r.left + r.width / 2 - rect.left,
          y: r.top + r.height / 2 - rect.top
        };
      }

      loopCoords = {
        hostA: getCenter(els.hostA),
        hostC: getCenter(els.hostC),
        hostB: getCenter(els.hostB),
        hostD: getCenter(els.hostD),
        sw1: {
          1: getCenter(els.sw1Ports[1]),
          2: getCenter(els.sw1Ports[2]),
          3: getCenter(els.sw1Ports[3]),
          4: getCenter(els.sw1Ports[4])
        },
        sw2: {
          1: getCenter(els.sw2Ports[1]),
          2: getCenter(els.sw2Ports[2]),
          3: getCenter(els.sw2Ports[3]),
          4: getCenter(els.sw2Ports[4])
        }
      };

      renderStaticLinks();
    }

    // 绘制像素级对齐图示的拓扑连线
    function renderStaticLinks() {
      if (!els.svgLinks || !loopCoords.hostA) return;

      const links = [
        // 主机 A -> SW1 [1]
        { from: loopCoords.hostA, to: loopCoords.sw1[1] },
        // 主机 C -> SW1 [2]
        { from: loopCoords.hostC, to: loopCoords.sw1[2] },
        // 上联链路: SW1 [3] <-> SW2 [1] (水平直连)
        { from: loopCoords.sw1[3], to: loopCoords.sw2[1] },
        // 下联链路: SW1 [4] <-> SW2 [2] (水平直连)
        { from: loopCoords.sw1[4], to: loopCoords.sw2[2] },
        // SW2 [3] -> 主机 B
        { from: loopCoords.sw2[3], to: loopCoords.hostB },
        // SW2 [4] -> 主机 D
        { from: loopCoords.sw2[4], to: loopCoords.hostD }
      ];

      let html = '';
      links.forEach((l, idx) => {
        const isInterSwitch = (idx === 2 || idx === 3);
        const strokeColor = isInterSwitch ? '#1C1917' : '#1C1917';
        const strokeWidth = isInterSwitch ? 3 : 2.5;
        html += `<line x1="${l.from.x}" y1="${l.from.y}" x2="${l.to.x}" y2="${l.to.y}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
      });

      els.svgLinks.innerHTML = html;
    }

    // 渲染交换机内部转发表
    function renderTables() {
      // 表 1
      if (loopState.sw1Table.length === 0) {
        els.sw1TableBody.innerHTML = `<tr><td colspan="2" class="py-2.5 text-stone-400 italic text-[11px]">（空）</td></tr>`;
      } else {
        let html1 = '';
        loopState.sw1Table.forEach(row => {
          let trClass = 'transition-colors';
          let portText = `${row.port}`;
          if (row.isFlapping) {
            trClass += ' table-row-flapping bg-rose-50 text-rose-700';
            portText += ' (震荡!)';
          } else if (row.isNew) {
            trClass += ' bg-emerald-50 text-emerald-800 font-bold';
          }
          html1 += `
            <tr class="${trClass}">
              <td class="py-1 px-2 border-r border-stone-300 font-bold text-stone-900">${row.mac}</td>
              <td class="py-1 px-2 font-mono font-bold">${portText}</td>
            </tr>
          `;
        });
        els.sw1TableBody.innerHTML = html1;
      }

      // 表 2
      if (loopState.sw2Table.length === 0) {
        els.sw2TableBody.innerHTML = `<tr><td colspan="2" class="py-2.5 text-stone-400 italic text-[11px]">（空）</td></tr>`;
      } else {
        let html2 = '';
        loopState.sw2Table.forEach(row => {
          let trClass = 'transition-colors';
          let portText = `${row.port}`;
          if (row.isFlapping) {
            trClass += ' table-row-flapping bg-rose-50 text-rose-700';
            portText += ' (震荡!)';
          } else if (row.isNew) {
            trClass += ' bg-emerald-50 text-emerald-800 font-bold';
          }
          html2 += `
            <tr class="${trClass}">
              <td class="py-1 px-2 border-r border-stone-300 font-bold text-stone-900">${row.mac}</td>
              <td class="py-1 px-2 font-mono font-bold">${portText}</td>
            </tr>
          `;
        });
        els.sw2TableBody.innerHTML = html2;
      }
    }

    function clearVisuals() {
      killTweens();
      els.svgPackets.innerHTML = '';

      // 清除端口高亮
      [1, 2, 3, 4].forEach(p => {
        if (els.sw1Ports[p]) els.sw1Ports[p].className = 'loop-port';
        if (els.sw2Ports[p]) els.sw2Ports[p].className = 'loop-port';
      });

      // 如果启用了 STP，阻塞 SW2 端口 2
      if (loopState.stpEnabled) {
        if (els.sw2Ports[2]) els.sw2Ports[2].className = 'loop-port port-blocked';
      }
    }

    function killTweens() {
      loopState.activeTweens.forEach(t => t.kill());
      loopState.activeTweens = [];
    }

    function updateStatus(title, desc, type) {
      els.statusTitle.textContent = title;
      els.statusDesc.innerHTML = desc;

      if (type === 'rx') {
        els.statusIcon.className = 'w-6 h-6 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5';
        els.statusIcon.textContent = '📥';
      } else if (type === 'flapping') {
        els.statusIcon.className = 'w-6 h-6 rounded-md bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5 animate-pulse';
        els.statusIcon.textContent = '⚠️';
      } else if (type === 'storm') {
        els.statusIcon.className = 'w-6 h-6 rounded-md bg-red-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5';
        els.statusIcon.textContent = '🌪️';
      } else if (type === 'stp') {
        els.statusIcon.className = 'w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5';
        els.statusIcon.textContent = '🛡️';
      } else {
        els.statusIcon.className = 'w-6 h-6 rounded-md bg-stone-200 text-stone-700 flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5';
        els.statusIcon.textContent = 'ℹ';
      }
    }

    function updateStepTabs(step) {
      [1, 2, 3, 4].forEach(s => {
        const btn = document.getElementById(`loop-btn-s${s}`);
        if (!btn) return;
        if (s === step) {
          btn.className = 'loop-step-tab active text-left p-3 rounded-xl border border-stone-900 bg-stone-900 text-white transition-all';
        } else {
          btn.className = 'loop-step-tab text-left p-3 rounded-xl border border-[#E5E4DC] bg-stone-50 text-stone-800 hover:border-stone-400 transition-all';
        }
      });
    }

    // 创建飞行数据包 DOM (对齐 A->B 帧)
    function createPacket(text, color) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'loop-packet');
      g.innerHTML = `
        <rect x="-32" y="-11" width="64" height="22" rx="11" fill="${color}" stroke="#FFFFFF" stroke-width="1.5" />
        <text x="0" y="4" font-size="9" font-family="JetBrains Mono, monospace" font-weight="bold" fill="#FFFFFF" text-anchor="middle">
          ${text}
        </text>
      `;
      els.svgPackets.appendChild(g);
      return g;
    }

    // 执行阶段
    function executeStep(step, onFinish) {
      loopState.step = step;
      updateStepTabs(step);
      clearVisuals();
      const dur = 1.0 / loopState.speed;

      if (step === 1) {
        // -------------------------------------------------------------
        // 阶段 1: A 发出帧 -> SW1 [端口 1]，SW1 泛洪至 2, 3, 4
        // -------------------------------------------------------------
        loopState.sw1Table = [];
        loopState.sw2Table = [];
        loopState.hostBCount = 0;
        els.hostBCount.textContent = `0 份`;
        renderTables();

        updateStatus(
          `阶段 1: 主机 A 向 B 发送一帧进入交换机 1 [端口 1]`,
          `① <strong>自学习</strong>：交换机 1 检查源 MAC 为 <code>A</code>，在<strong>【交换表 1】记录 <code>A → 端口 1</code></strong>；<br>
           ② <strong>查表转发</strong>：目的 MAC 为 <code>B</code>，查表未找到（未知单播），交换机 1 <strong>向其余所有端口（2、3、4）盲目泛洪</strong>！`,
          'rx'
        );

        // 帧从 A 飞入 SW1 [1]
        const p1 = createPacket('A → B', '#2563EB');
        const tween1 = gsap.fromTo(p1,
          { x: loopCoords.hostA.x, y: loopCoords.hostA.y, scale: 0.8, opacity: 0 },
          {
            x: loopCoords.sw1[1].x,
            y: loopCoords.sw1[1].y,
            scale: 1,
            opacity: 1,
            duration: dur * 0.9,
            ease: 'power2.out',
            onComplete: () => {
              p1.remove();
              els.sw1Ports[1].classList.add('port-active-rx');
              // 写入交换表 1
              loopState.sw1Table = [{ mac: 'A', port: 1, isNew: true }];
              renderTables();

              // 向 2、3、4 泛洪
              [2, 3, 4].forEach(p => els.sw1Ports[p].classList.add('port-active-tx'));

              // 端口 2 飞向 主机 C
              const pToC = createPacket('A → B', '#D97706');
              gsap.fromTo(pToC,
                { x: loopCoords.sw1[2].x, y: loopCoords.sw1[2].y },
                {
                  x: loopCoords.hostC.x,
                  y: loopCoords.hostC.y,
                  duration: dur * 0.9,
                  ease: 'power2.out',
                  onComplete: () => pToC.remove()
                }
              );

              // 端口 3 飞向 SW2 [1] (上路)
              const pToSW2Top = createPacket('A → B', '#D97706');
              gsap.fromTo(pToSW2Top,
                { x: loopCoords.sw1[3].x, y: loopCoords.sw1[3].y },
                {
                  x: loopCoords.sw2[1].x,
                  y: loopCoords.sw2[1].y,
                  duration: dur * 1.2,
                  ease: 'power1.inOut',
                  onComplete: () => pToSW2Top.remove()
                }
              );

              // 端口 4 飞向 SW2 [2] (下路)
              const pToSW2Bottom = createPacket('A → B', '#D97706');
              const tweenEnd = gsap.fromTo(pToSW2Bottom,
                { x: loopCoords.sw1[4].x, y: loopCoords.sw1[4].y },
                {
                  x: loopCoords.sw2[2].x,
                  y: loopCoords.sw2[2].y,
                  duration: dur * 1.2,
                  ease: 'power1.inOut',
                  onComplete: () => {
                    pToSW2Bottom.remove();
                    if (onFinish) onFinish();
                  }
                }
              );
              loopState.activeTweens.push(tweenEnd);
            }
          }
        );
        loopState.activeTweens.push(tween1);

      } else if (step === 2) {
        // -------------------------------------------------------------
        // 阶段 2: 帧经双链路到达 交换机 2，发生表震荡与倒灌
        // -------------------------------------------------------------
        els.sw1Ports[3].classList.add('port-active-tx');
        els.sw1Ports[4].classList.add('port-active-tx');
        els.sw2Ports[1].classList.add('port-active-rx');
        els.sw2Ports[2].classList.add('port-active-rx');

        if (loopState.stpEnabled) {
          // STP 模式下阻塞端口 2，无环路
          updateStatus(
            `阶段 2 (STP 保护)：上路帧抵达 SW2 [1]，下路在 [2] 被阻塞阻断！`,
            `🛡️ <strong>STP 生效中</strong>：交换机 2 的端口 2 处于<strong>【阻塞状态 ✕】</strong>，下路帧直接丢弃！<br>
             仅上路帧从端口 1 进入，SW2 学习 <code>A → 1</code> 并单播/转发给主机 B。<strong>环路被彻底消除！</strong>`,
            'stp'
          );

          loopState.sw2Table = [{ mac: 'A', port: 1, isNew: true }];
          renderTables();

          // 转发至主机 B
          const pToB = createPacket('A → B', '#10B981');
          gsap.fromTo(pToB,
            { x: loopCoords.sw2[3].x, y: loopCoords.sw2[3].y },
            {
              x: loopCoords.hostB.x,
              y: loopCoords.hostB.y,
              duration: dur * 1.0,
              ease: 'power2.out',
              onComplete: () => {
                pToB.remove();
                loopState.hostBCount = 1;
                els.hostBCount.textContent = `1 份 (正常接收)`;
                if (onFinish) onFinish();
              }
            }
          );
          return;
        }

        // 无 STP：环路发生！
        updateStatus(
          `阶段 2: 双路帧分别抵达交换机 2 [端口 1] 与 [端口 2]，转发表发生震荡！`,
          `① 上路帧从 SW2 [端口 1] 注入：SW2 学习 <code>A → 端口 1</code>，向端口 3 (B)、4 (D) 和 <strong>下路端口 2</strong> 泛洪！主机 B 收到第 1 份帧；<br>
           ② 下路帧从 SW2 [端口 2] 注入：发现源也是 <code>A</code>，<strong>【交换表 2】被覆盖震荡为 <code>A → 端口 2</code></strong>！向端口 3 (B)、4 (D) 和 <strong>上路端口 1</strong> 泛洪！主机 B 收到第 2 份重复帧！`,
          'flapping'
        );

        // 先学 A->1
        loopState.sw2Table = [{ mac: 'A', port: 1, isNew: true }];
        renderTables();

        // 紧接着下路帧到达覆盖震荡为 A->2
        const tDelay = gsap.delayedCall(dur * 0.4, () => {
          loopState.sw2Table = [{ mac: 'A', port: 2, isFlapping: true }];
          renderTables();
        });
        loopState.activeTweens.push(tDelay);

        // 泛洪给主机 B 两次
        loopState.hostBCount = 2;
        els.hostBCount.textContent = `2 份 (重复收到!)`;

        const pB1 = createPacket('A → B (1)', '#2563EB');
        gsap.fromTo(pB1,
          { x: loopCoords.sw2[3].x, y: loopCoords.sw2[3].y },
          { x: loopCoords.hostB.x, y: loopCoords.hostB.y, duration: dur * 1.0, onComplete: () => pB1.remove() }
        );

        const pB2 = createPacket('A → B (2)', '#DC2626');
        gsap.fromTo(pB2,
          { x: loopCoords.sw2[3].x, y: loopCoords.sw2[3].y },
          { x: loopCoords.hostB.x, y: loopCoords.hostB.y, delay: dur * 0.3, duration: dur * 1.0, onComplete: () => pB2.remove() }
        );

        // 交换机 2 泛洪将帧倒灌回链路！
        // 从 SW2 [2] 沿下链路反向射向 SW1 [4]
        const pBack4 = createPacket('A → B 倒灌', '#DC2626');
        gsap.fromTo(pBack4,
          { x: loopCoords.sw2[2].x, y: loopCoords.sw2[2].y },
          { x: loopCoords.sw1[4].x, y: loopCoords.sw1[4].y, duration: dur * 1.2, ease: 'linear', onComplete: () => pBack4.remove() }
        );

        // 从 SW2 [1] 沿上链路反向射向 SW1 [3]
        const pBack3 = createPacket('A → B 倒灌', '#DC2626');
        const tweenEnd = gsap.fromTo(pBack3,
          { x: loopCoords.sw2[1].x, y: loopCoords.sw2[1].y },
          {
            x: loopCoords.sw1[3].x,
            y: loopCoords.sw1[3].y,
            duration: dur * 1.2,
            ease: 'linear',
            onComplete: () => {
              pBack3.remove();
              if (onFinish) onFinish();
            }
          }
        );
        loopState.activeTweens.push(tweenEnd);

      } else if (step === 3) {
        // -------------------------------------------------------------
        // 阶段 3: 帧倒灌回 交换机 1，交换表 1 严重震荡篡改
        // -------------------------------------------------------------
        if (loopState.stpEnabled) return;

        els.sw1Ports[4].classList.add('port-active-rx');
        els.sw1Ports[3].classList.add('port-active-rx');

        updateStatus(
          `阶段 3: 倒灌帧进入交换机 1 [端口 4] 与 [端口 3]，【交换表 1】遭受恶意篡改！`,
          `① 下路倒灌帧从 SW1 [端口 4] 进：SW1 误以为主机 A 搬家到了端口 4！<strong>交换表 1 被覆盖篡改为 <code>A → 端口 4</code></strong>！<br>
           ② 上路倒灌帧从 SW1 [端口 3] 进：SW1 紧接着又将<strong>交换表 1 覆盖篡改为 <code>A → 端口 3</code></strong>！<br>
           ③ 交换机 1 再次向其余端口泛洪，主机 A 居然收到了自己发出的帧，两帧再次被射向上路和下路！`,
          'flapping'
        );

        loopState.sw1Table = [{ mac: 'A', port: 4, isFlapping: true }];
        renderTables();

        const tDelay = gsap.delayedCall(dur * 0.4, () => {
          loopState.sw1Table = [{ mac: 'A', port: 3, isFlapping: true }];
          renderTables();
        });
        loopState.activeTweens.push(tDelay);

        // 倒灌帧流向 A (A收到自己帧)
        const pToA = createPacket('自身副本', '#DC2626');
        gsap.fromTo(pToA,
          { x: loopCoords.sw1[1].x, y: loopCoords.sw1[1].y },
          { x: loopCoords.hostA.x, y: loopCoords.hostA.y, duration: dur * 0.9, onComplete: () => pToA.remove() }
        );

        // 再次射向 SW2
        const pLoopTop = createPacket('A → B 兜圈', '#DC2626');
        gsap.fromTo(pLoopTop,
          { x: loopCoords.sw1[3].x, y: loopCoords.sw1[3].y },
          { x: loopCoords.sw2[1].x, y: loopCoords.sw2[1].y, duration: dur * 1.1, onComplete: () => pLoopTop.remove() }
        );

        const pLoopBottom = createPacket('A → B 兜圈', '#DC2626');
        const tweenEnd = gsap.fromTo(pLoopBottom,
          { x: loopCoords.sw1[4].x, y: loopCoords.sw1[4].y },
          {
            x: loopCoords.sw2[2].x,
            y: loopCoords.sw2[2].y,
            duration: dur * 1.1,
            onComplete: () => {
              pLoopBottom.remove();
              if (onFinish) onFinish();
            }
          }
        );
        loopState.activeTweens.push(tweenEnd);

      } else if (step === 4) {
        // -------------------------------------------------------------
        // 阶段 4: 无休止死循环兜圈与广播风暴 (Infinite Storm)
        // -------------------------------------------------------------
        if (loopState.stpEnabled) return;

        updateStatus(
          `阶段 4: 无休止死循环兜圈与广播风暴！以太网帧无 TTL，网络彻底瘫痪`,
          `⚠️ <strong>死循环形成</strong>：数据帧沿着 <code>SW1[3] → SW2[1] → SW2[2] → SW1[4] → SW1[3]</code> 顺时针与逆时针永远兜圈！<br>
           • <strong>MAC 地址表疯狂抖动</strong>：SW1 和 SW2 的表项在不同端口之间高频震荡覆写；<br>
           • <strong>信道耗尽</strong>：由于以太网 MAC 帧<strong>首部没有 TTL 机制</strong>，帧永远不会消亡，每兜一圈都在呈几何级数复制广播风暴，导致整个局域网彻底瘫痪！`,
          'storm'
        );

        // 循环发射动画模拟死循环
        runInfiniteLoopAnim();
      }
    }

    // 死循环连续动效
    function runInfiniteLoopAnim() {
      if (loopState.step !== 4 || loopState.stpEnabled) return;
      const dur = 1.2 / loopState.speed;

      // 顺时针环路帧
      const pCW = createPacket('🌪️ 兜圈帧', '#DC2626');
      const timelineCW = gsap.timeline({
        repeat: -1,
        onRepeat: () => {
          if (loopState.step !== 4 || loopState.stpEnabled) {
            timelineCW.kill();
            pCW.remove();
            return;
          }
          loopState.hostBCount += 2;
          els.hostBCount.textContent = `${loopState.hostBCount} 份 (暴增中!)`;
          // 随机跳变表项模拟抖动
          loopState.sw1Table = [{ mac: 'A', port: Math.random() > 0.5 ? 3 : 4, isFlapping: true }];
          loopState.sw2Table = [{ mac: 'A', port: Math.random() > 0.5 ? 1 : 2, isFlapping: true }];
          renderTables();
        }
      });

      timelineCW
        .fromTo(pCW, { x: loopCoords.sw1[3].x, y: loopCoords.sw1[3].y }, { x: loopCoords.sw2[1].x, y: loopCoords.sw2[1].y, duration: dur, ease: 'linear' })
        .to(pCW, { x: loopCoords.sw2[2].x, y: loopCoords.sw2[2].y, duration: dur * 0.4, ease: 'linear' })
        .to(pCW, { x: loopCoords.sw1[4].x, y: loopCoords.sw1[4].y, duration: dur, ease: 'linear' })
        .to(pCW, { x: loopCoords.sw1[3].x, y: loopCoords.sw1[3].y, duration: dur * 0.4, ease: 'linear' });

      loopState.activeTweens.push(timelineCW);
    }

    // 播放控制
    function togglePlay() {
      if (loopState.isPlaying) {
        stopPlay();
      } else {
        startPlay();
      }
    }

    function startPlay() {
      loopState.isPlaying = true;
      els.playIcon.textContent = '⏸';
      els.playText.textContent = '暂停播放';

      function playLoop() {
        if (!loopState.isPlaying) return;
        if (loopState.step < 4) {
          executeStep(loopState.step + 1, () => {
            if (!loopState.isPlaying) return;
            const waitTime = (loopState.stpEnabled && loopState.step >= 2) ? 1000 : (1400 / loopState.speed);
            loopState.timer = setTimeout(playLoop, waitTime);
          });
        } else {
          stopPlay();
        }
      }

      if (loopState.step >= 4) {
        loopState.step = 0;
        clearVisuals();
      }
      playLoop();
    }

    function stopPlay() {
      loopState.isPlaying = false;
      els.playIcon.textContent = '▶';
      els.playText.textContent = '自动演示兜圈';
      if (loopState.timer) {
        clearTimeout(loopState.timer);
        loopState.timer = null;
      }
    }

    function nextStep() {
      stopPlay();
      if (loopState.step < 4) {
        executeStep(loopState.step + 1);
      }
    }

    function prevStep() {
      stopPlay();
      if (loopState.step > 1) {
        executeStep(loopState.step - 1);
      } else {
        reset();
      }
    }

    function reset() {
      stopPlay();
      loopState.step = 0;
      loopState.hostBCount = 0;
      loopState.sw1Table = [];
      loopState.sw2Table = [];
      els.hostBCount.textContent = `0 份`;
      clearVisuals();
      renderTables();
      updateStepTabs(0);
      updateStatus(
        '准备就绪：A 向 B 发送一帧',
        '初始时交换机 1 与交换机 2 的转发表均为空。点击“自动演示兜圈”或“下一步”，观察由于两台交换机之间存在双重冗余链路（物理环路），数据帧如何形成无休止死循环兜圈。',
        'info'
      );
    }

    function setSpeed(spd) {
      loopState.speed = spd;
      document.querySelectorAll('.loop-speed-pill').forEach(btn => {
        btn.className = 'loop-speed-pill px-2 py-1 rounded border border-[#E5E4DC] hover:border-stone-400 text-stone-600';
      });
      if (event && event.target) {
        event.target.className = 'loop-speed-pill active px-2 py-1 rounded border border-stone-900 text-white';
      }
    }

    function toggleSTP() {
      loopState.stpEnabled = !loopState.stpEnabled;
      if (loopState.stpEnabled) {
        els.stpBadge.className = 'px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold';
        els.stpBadge.textContent = '✓ 已开启 (阻塞端口 2 破环)';
        els.btnStp.className = 'ctrl-btn px-3.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 font-mono text-xs font-bold flex items-center gap-1.5 transition-all';
      } else {
        els.stpBadge.className = 'px-1.5 py-0.2 rounded bg-stone-200 text-stone-700 text-[10px]';
        els.stpBadge.textContent = '未开启 (存在环路)';
        els.btnStp.className = 'ctrl-btn px-3.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-mono text-xs font-bold flex items-center gap-1.5 transition-all';
      }
      reset();
    }

    return {
      updateCoords,
      reset,
      togglePlay,
      nextStep,
      prevStep,
      setStep: (s) => { stopPlay(); executeStep(s); },
      setSpeed,
      toggleSTP
    };
  })();

  // 绑定全局 Loop API
  window.setLoopStep = loopEngine.setStep;
  window.toggleLoopPlay = loopEngine.togglePlay;
  window.nextLoopStep = loopEngine.nextStep;
  window.prevLoopStep = loopEngine.prevStep;
  window.resetLoop = loopEngine.reset;
  window.setLoopSpeed = loopEngine.setSpeed;
  window.toggleSTP = loopEngine.toggleSTP;


  // =========================================================================
  // 模块 2：单交换机基础自学习 (SingleSwitchEngine)
  // =========================================================================
  const singleEngine = (function () {
    const HOSTS = {
      A: { id: 'host-A', name: '主机 A', port: 1 },
      B: { id: 'host-B', name: '主机 B', port: 2 },
      C: { id: 'host-C', name: '主机 C', port: 3 },
      D: { id: 'host-D', name: '主机 D', port: 4 }
    };

    const PRESETS = {
      1: { src: 'A', dest: 'B', initTable: [] },
      2: { src: 'B', dest: 'A', initTable: [{ mac: '00-1A-2B-3C-4D-A1', port: 1, host: 'A', ttl: 298 }] },
      3: { src: 'C', dest: 'A', initTable: [{ mac: '00-1A-2B-3C-4D-A1', port: 1, host: 'A', ttl: 292 }, { mac: '00-1A-2B-3C-4D-B2', port: 2, host: 'B', ttl: 296 }] }
    };

    const sState = {
      procId: 1,
      subStep: 0,
      isPlaying: false,
      speed: 1.0,
      timer: null,
      activeTweens: [],
      macTable: []
    };

    let sCoords = {};

    function updateCoords() {
      const c = document.getElementById('canvas-container');
      if (!c) return;
      const rect = c.getBoundingClientRect();
      function getCenter(el) {
        if (!el) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2 - rect.left, y: r.top + r.height / 2 - rect.top };
      }
      sCoords = {
        hosts: {
          A: getCenter(document.getElementById('host-A')),
          B: getCenter(document.getElementById('host-B')),
          C: getCenter(document.getElementById('host-C')),
          D: getCenter(document.getElementById('host-D'))
        },
        ports: {
          1: getCenter(document.getElementById('port-1')),
          2: getCenter(document.getElementById('port-2')),
          3: getCenter(document.getElementById('port-3')),
          4: getCenter(document.getElementById('port-4'))
        }
      };

      const svgL = document.getElementById('svg-links');
      if (!svgL || !sCoords.hosts.A) return;
      let html = '';
      ['A', 'B', 'C', 'D'].forEach(k => {
        const p = HOSTS[k].port;
        html += `<line x1="${sCoords.hosts[k].x}" y1="${sCoords.hosts[k].y}" x2="${sCoords.ports[p].x}" y2="${sCoords.ports[p].y}" stroke="#CBD5E1" stroke-width="2.5" stroke-dasharray="4 4" />`;
      });
      svgL.innerHTML = html;
    }

    function renderMacTable() {
      const tb = document.getElementById('mac-table-body');
      const cnt = document.getElementById('mac-table-count');
      if (!tb) return;
      if (sState.macTable.length === 0) {
        tb.innerHTML = `<tr><td colspan="4" class="py-3 text-center text-stone-400 text-xs italic">转发表当前为空</td></tr>`;
        if (cnt) cnt.textContent = '0 条';
        return;
      }
      if (cnt) cnt.textContent = `${sState.macTable.length} 条`;
      let h = '';
      sState.macTable.forEach(r => {
        let cls = r.isNew ? 'bg-emerald-50 text-emerald-900 font-semibold' : (r.isHit ? 'bg-blue-50 text-blue-900 font-semibold' : '');
        h += `<tr class="${cls}">
          <td class="py-2 px-3 font-bold">${r.mac}</td>
          <td class="py-2 px-3 font-bold">端口 ${r.port}</td>
          <td class="py-2 px-3 font-mono text-stone-500">${r.ttl}s</td>
          <td class="py-2 px-3 text-[11px] text-stone-600">${r.isNew ? '✨ 新增' : (r.isHit ? '🎯 命中' : '有效')}</td>
        </tr>`;
      });
      tb.innerHTML = h;
    }

    function reset() {
      sState.subStep = 0;
      sState.macTable = JSON.parse(JSON.stringify(PRESETS[sState.procId] ? PRESETS[sState.procId].initTable : []));
      renderMacTable();
      const b = document.getElementById('step-badge');
      if (b) b.textContent = '阶段 0 / 4';
    }

    function switchProc(p) {
      sState.procId = p;
      [1, 2, 3].forEach(i => {
        const btn = document.getElementById(`tab-proc${i}`);
        if (btn) btn.className = (i === p) ? 'proc-tab active text-left p-3 rounded-xl border border-stone-900 bg-stone-900 text-white' : 'proc-tab text-left p-3 rounded-xl border border-[#E5E4DC] bg-stone-50 text-stone-800';
      });
      reset();
    }

    return {
      updateCoords,
      reset,
      switchProc
    };
  })();

  window.switchProcess = singleEngine.switchProc;

  // =========================================================================
  // 初始化引导
  // =========================================================================
  function init() {
    window.addEventListener('resize', () => {
      if (currentMainMode === 'loop') {
        loopEngine.updateCoords();
      } else {
        singleEngine.updateCoords();
      }
    });

    const hash = window.location.hash.replace('#', '');
    if (hash === 'single') {
      window.setMainMode('single');
    } else {
      window.setMainMode('loop');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
