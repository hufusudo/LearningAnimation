(() => {
  const CAPACITY = 16;
  const INITIAL_SSTHRESH = 16;
  const $ = (id) => document.getElementById(id);
  const phaseNames = {
    slowStart: "慢开始",
    congestionAvoidance: "拥塞避免",
    fastRetransmit: "快重传",
    fastRecovery: "快恢复"
  };
  const state = {
    cwnd: 1,
    ssthresh: INITIAL_SSTHRESH,
    phase: "slowStart",
    rtt: 0,
    speed: 1,
    playing: false,
    busy: false,
    incidentRunning: false,
    pendingIncident: null,
    nextAutomaticLoss: "timeout",
    lastLoss: null,
    playbackId: 0,
    inFlight: 0,
    received: 0,
    duplicateAcks: 0,
    points: [{ rtt: 0, cwnd: 1, kind: "start" }],
    timelines: new Set(),
    epoch: 0
  };
  const dom = {
    play: $("btn-play"),
    playIcon: $("play-icon"),
    playLabel: $("play-label"),
    step: $("btn-step"),
    reset: $("btn-reset"),
    timeout: $("btn-timeout"),
    fastLoss: $("btn-fast-loss"),
    speed: $("speed-slider"),
    speedValue: $("speed-value"),
    phase: $("phase-value"),
    phasePill: document.querySelector(".phase-pill"),
    cwnd: $("cwnd-value"),
    ssthresh: $("ssthresh-value"),
    round: $("round-value"),
    statusNote: $("status-note"),
    senderHost: $("sender-host"),
    receiverHost: $("receiver-host"),
    senderWindow: $("sender-window"),
    senderFlight: $("sender-flight"),
    receiverAck: $("receiver-ack"),
    receiverCount: $("receiver-count"),
    receiverState: $("receiver-state"),
    timerLabel: $("timer-label"),
    timerProgress: $("timer-progress"),
    dataLane: $("data-lane"),
    ackLane: $("ack-lane"),
    channelDetail: $("channel-caption-detail"),
    eventBanner: $("event-banner"),
    roundToast: $("round-toast"),
    duplicateCounter: $("duplicate-counter"),
    duplicateValue: $("duplicate-value"),
    flightNote: $("flight-note"),
    chartGrid: $("chart-grid"),
    chartXLabels: $("chart-x-labels"),
    thresholdLine: $("ssthresh-line"),
    thresholdLabel: $("ssthresh-label"),
    cursor: $("time-cursor"),
    chartPath: $("cwnd-path"),
    latestSegment: $("cwnd-latest-segment"),
    chartPoints: $("chart-points")
  };
  Object.assign(dom, {
    eventSteps: $("event-steps"),
    lossSummary: $("loss-summary"),
    lossTitle: $("loss-title"),
    lossProgress: $("loss-progress"),
    lossBefore: $("loss-before"),
    lossThreshold: $("loss-threshold"),
    lossFormula: $("loss-formula"),
    lossWindow: $("loss-window"),
    previousThresholdLine: $("previous-threshold-line"),
    previousThresholdLabel: $("previous-threshold-label"),
    thresholdArrow: $("threshold-change-arrow")
  });

  function showEventStep(kind, current) {
    const labels = kind === "fast"
      ? ["第 2 包丢失", "3 次重复 ACK", "立即快重传", "快恢复：保持半窗", "拥塞避免：每 RTT +1"]
      : ["数据包滞留", "重传计时归零", "门限按半窗更新", "cwnd = 1 重传", "重新慢开始"];
    dom.eventSteps.hidden = false;
    labels.forEach((label, index) => {
      const item = $("event-step-" + index);
      item.textContent = label;
      item.classList.toggle("is-current", index === current);
      item.classList.toggle("is-complete", index < current);
    });
  }

  function showLossSummary(kind, before, previousThreshold) {
    state.lastLoss = { kind, before, previousThreshold, threshold: state.ssthresh };
    dom.lossSummary.hidden = false;
    dom.lossTitle.textContent = kind === "timeout" ? "Timeout · 门限取丢包前半窗，cwnd 回到 1" : "快重传 / 快恢复 · 窗口折半";
    dom.lossBefore.textContent = before + " MSS";
    dom.lossThreshold.textContent = previousThreshold + " → " + state.ssthresh + " MSS";
    dom.lossFormula.textContent = "ssthresh = max(2, ⌊" + before + " / 2⌋) = " + state.ssthresh;
    dom.lossWindow.textContent = before + " → " + state.cwnd + " MSS";
    dom.lossProgress.textContent = "门限依据丢包前的 cwnd 计算";
  }

  function updateUpcomingEvent() {
    dom.flightNote.textContent = state.nextAutomaticLoss === "timeout"
      ? "下一事件：cwnd 超过 16 时，演示超时重传"
      : "下一事件：cwnd 增长至 12 时，演示快重传与快恢复";
  }

  function phaseLabel(phase) {
    return phaseNames[phase] || phaseNames.slowStart;
  }

  function updateStatus() {
    dom.phase.textContent = phaseLabel(state.phase);
    dom.phasePill.classList.toggle("phase-ca", state.phase === "congestionAvoidance");
    dom.phasePill.classList.toggle("phase-fast", state.phase === "fastRetransmit" || state.phase === "fastRecovery");
    dom.cwnd.textContent = state.cwnd + " MSS";
    dom.ssthresh.textContent = state.ssthresh + " MSS";
    dom.round.textContent = String(state.rtt);
    dom.senderWindow.textContent = state.cwnd + " 包";
    dom.senderFlight.textContent = state.inFlight + " 包";
    dom.receiverCount.textContent = state.received + " 包";
    dom.duplicateValue.textContent = String(state.duplicateAcks);
  }

  function updateControls() {
    dom.playIcon.textContent = state.playing ? "Ⅱ" : "▶";
    dom.playLabel.textContent = state.playing ? "暂停" : "播放";
    dom.play.disabled = (state.busy || state.incidentRunning) && !state.playing;
    dom.step.disabled = state.busy || state.playing || state.incidentRunning;
    dom.timeout.disabled = state.incidentRunning || Boolean(state.pendingIncident);
    dom.fastLoss.disabled = state.incidentRunning || Boolean(state.pendingIncident);
  }

  function setNote(message) {
    dom.statusNote.textContent = message;
  }

  function setBanner(message, type) {
    gsap.killTweensOf(dom.eventBanner);
    dom.eventBanner.hidden = false;
    dom.eventBanner.className = "event-banner" + (type ? " " + type : "");
    dom.eventBanner.textContent = message;
    if (window.gsap) {
      gsap.fromTo(dom.eventBanner, { autoAlpha: 0, y: -5, scale: 0.985 }, {
        autoAlpha: 1, y: 0, scale: 1, duration: 0.34, ease: "power2.out"
      });
    }
  }

  function clearBanner() {
    if (dom.eventBanner.hidden) return;
    if (window.gsap) {
      gsap.to(dom.eventBanner, {
        autoAlpha: 0, y: -4, duration: 0.22, ease: "power2.in",
        onComplete: () => { dom.eventBanner.hidden = true; dom.eventBanner.removeAttribute("style"); }
      });
    } else {
      dom.eventBanner.hidden = true;
    }
  }

  function showRoundToast(oldValue, nextValue) {
    dom.roundToast.textContent = "✨ 1 个 RTT 轮次完成！cwnd: " + oldValue + " → " + nextValue + "（当前 RTT " + state.rtt + "）";
    if (!window.gsap) return;
    gsap.killTweensOf(dom.roundToast);
    gsap.fromTo(dom.roundToast,
      { autoAlpha: 0, y: 7, scale: 0.92 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.32, ease: "back.out(1.5)", onComplete: () => {
        gsap.to(dom.roundToast, { autoAlpha: 0, y: -5, delay: 1.15, duration: 0.3, ease: "power2.in" });
      } }
    );
  }

  function makePointPath(points, xFor, yFor) {
    if (!points.length) return "";
    return points.map((point, index) => (index ? "L " : "M ") + xFor(point.rtt) + " " + yFor(point.cwnd)).join(" ");
  }

  function renderChart(animateLatest) {
    const left = 74;
    const right = 930;
    const top = 22;
    const bottom = 260;
    const maxValue = Math.max(state.ssthresh, state.lastLoss?.previousThreshold || 0, ...state.points.map((point) => point.cwnd), 8);
    const yMax = Math.max(12, Math.ceil((maxValue + 2) / 4) * 4);
    const lastRtt = state.points.length ? state.points[state.points.length - 1].rtt : 0;
    const xMax = Math.max(8, lastRtt + 3);
    const xFor = (rtt) => left + (Math.max(0, rtt) / xMax) * (right - left);
    const yFor = (value) => bottom - (Math.max(0, value) / yMax) * (bottom - top);
    const gridParts = [];
    for (let index = 0; index <= 4; index += 1) {
      const value = Math.round((yMax / 4) * index);
      const y = yFor(value);
      gridParts.push('<line class="grid-line" x1="' + left + '" x2="' + right + '" y1="' + y + '" y2="' + y + '"></line>');
      gridParts.push('<text class="grid-label" x="' + (left - 13) + '" y="' + (y + 3) + '" text-anchor="end">' + value + '</text>');
    }
    dom.chartGrid.innerHTML = gridParts.join("");

    const tickStep = Math.max(1, Math.ceil(xMax / 10));
    const ticks = [];
    for (let tick = 0; tick <= xMax; tick += tickStep) ticks.push(tick);
    if (ticks[ticks.length - 1] !== xMax) ticks.push(xMax);
    dom.chartXLabels.innerHTML = ticks.map((tick) =>
      '<text class="x-label" x="' + xFor(tick) + '" y="282">' + tick + '</text>'
    ).join("");

    const thresholdY = yFor(state.ssthresh);
    const previousThresholdY = Number(dom.thresholdLine.getAttribute("y1")) || thresholdY;
    dom.thresholdLabel.textContent = "ssthresh " + state.ssthresh;
    const thresholdDuration = state.lastLoss ? 1.3 : 0.62;
    if (animateLatest && window.gsap) {
      gsap.killTweensOf([dom.thresholdLine, dom.thresholdLabel]);
      gsap.fromTo(dom.thresholdLine,
        { attr: { y1: previousThresholdY, y2: previousThresholdY } },
        { attr: { y1: thresholdY, y2: thresholdY }, duration: thresholdDuration, ease: "power2.inOut" }
      );
      gsap.to(dom.thresholdLabel, { attr: { y: thresholdY - 7 }, duration: thresholdDuration, ease: "power2.inOut" });
    } else {
      dom.thresholdLabel.setAttribute("y", String(thresholdY - 7));
      dom.thresholdLine.setAttribute("y1", String(thresholdY));
      dom.thresholdLine.setAttribute("y2", String(thresholdY));
    }
    const changedThreshold = state.lastLoss && state.lastLoss.previousThreshold !== state.lastLoss.threshold;
    [dom.previousThresholdLine, dom.previousThresholdLabel, dom.thresholdArrow].forEach((element) => {
      element.setAttribute("visibility", changedThreshold ? "visible" : "hidden");
    });
    if (changedThreshold) {
      const oldY = yFor(state.lastLoss.previousThreshold);
      dom.previousThresholdLine.setAttribute("y1", oldY);
      dom.previousThresholdLine.setAttribute("y2", oldY);
      dom.previousThresholdLabel.setAttribute("y", oldY - 7);
      dom.previousThresholdLabel.textContent = "旧 ssthresh = " + state.lastLoss.previousThreshold;
      dom.thresholdArrow.setAttribute("y1", oldY);
      dom.thresholdArrow.setAttribute("y2", thresholdY);
    }

    const cursorX = xFor(lastRtt);
    if (animateLatest && window.gsap) {
      gsap.to(dom.cursor, { attr: { x1: cursorX, x2: cursorX }, duration: 0.58, ease: "power2.inOut" });
    } else {
      dom.cursor.setAttribute("x1", String(cursorX));
      dom.cursor.setAttribute("x2", String(cursorX));
    }

    const previousPoints = state.points.slice(0, -1);
    const lastTwo = state.points.slice(-2);
    dom.chartPath.setAttribute("d", makePointPath(previousPoints.length ? previousPoints : state.points.slice(0, 1), xFor, yFor));
    const latestD = lastTwo.length === 2 ? makePointPath(lastTwo, xFor, yFor) : "";
    dom.latestSegment.setAttribute("d", latestD);
    const pointMarkup = state.points.map((point, index) => {
      const isLatest = index === state.points.length - 1;
      const isLoss = point.kind === "timeout" || point.kind === "fast";
      const isAttempt = point.kind === "attempt";
      const x = xFor(point.rtt);
      const y = yFor(point.cwnd);
      const className = "chart-point" + (isLoss ? " loss-point" : "") + (isAttempt ? " attempt-point" : "") + (isLatest && !isLoss && !isAttempt ? " latest-point" : "");
      const label = isLatest || isLoss || isAttempt
        ? '<text class="chart-point-label" x="' + (x + 7) + '" y="' + (y - 8) + '">' + point.cwnd + '</text>'
        : "";
      return '<circle class="' + className + '" cx="' + x + '" cy="' + y + '" r="' + (isLatest ? 5 : 3.7) + '"></circle>' + label;
    }).join("");
    dom.chartPoints.innerHTML = pointMarkup;

    if (animateLatest && latestD && window.gsap) {
      const length = dom.latestSegment.getTotalLength();
      gsap.set(dom.latestSegment, { strokeDasharray: length, strokeDashoffset: length });
      gsap.to(dom.latestSegment, { strokeDashoffset: 0, duration: 0.58, ease: "power2.out", clearProps: "strokeDasharray,strokeDashoffset" });
      const latestPoint = dom.chartPoints.querySelector(".chart-point:last-of-type");
      if (latestPoint) gsap.fromTo(latestPoint, { scale: 0.5, transformOrigin: "center center" }, { scale: 1, duration: 0.4, ease: "back.out(2)" });
    } else if (window.gsap) {
      gsap.set(dom.latestSegment, { clearProps: "strokeDasharray,strokeDashoffset" });
    }
  }

  function makePacket(lane, packetType, number, label, highlight) {
    const packet = document.createElement("div");
    packet.className = "packet packet-" + packetType + (highlight ? " is-highlight" : "");
    packet.setAttribute("aria-label", label + " " + number);
    packet.innerHTML = '<span class="packet-label">' + label + '</span><strong></strong>';
    packet.querySelector("strong").textContent = String(number);
    lane.appendChild(packet);
    return packet;
  }

  function trackedTimeline(resolve, delay) {
    let settled = false;
    let timeline;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (timeline) state.timelines.delete(timeline);
      resolve();
    };
    timeline = gsap.timeline({
      delay: delay || 0,
      onComplete: settle,
      onInterrupt: settle
    });
    state.timelines.add(timeline);
    return timeline;
  }

  function animatePacket(number, options) {
    const opts = options || {};
    const lane = dom.dataLane;
    const distance = Math.max(90, lane.clientWidth - 48);
    const packet = makePacket(lane, "data", number, opts.retransmission ? "RE-SEND" : "DATA", opts.highlight);
    state.inFlight += 1;
    updateStatus();

    return new Promise((resolve) => {
      const ack = opts.lost ? null : makePacket(dom.ackLane, "ack", opts.ackText || ("<ack=" + (number + 1) + ">"), "ACK", false);
      if (ack) gsap.set(ack, { x: distance, yPercent: -50, autoAlpha: 0 });
      const timeline = trackedTimeline(resolve, opts.delay || 0);
      if (opts.lost) {
        timeline.to(packet, { x: distance * 0.52, duration: 0.68, ease: "power1.inOut", onComplete: () => {
          packet.classList.add(opts.keepStuck ? "is-lost" : "is-dropped");
        } });
        if (opts.keepStuck) {
          timeline.call(() => packet.classList.add("timeout-stuck"));
        } else {
          timeline.to(packet, { scale: 1.15, duration: 0.2, repeat: 1, yoyo: true });
          timeline.to(packet, { opacity: 0.22, scale: 0.64, rotation: -14, duration: 0.3, ease: "power2.in", onComplete: () => {
            packet.remove();
            state.inFlight = Math.max(0, state.inFlight - 1);
            updateStatus();
          } });
        }
        return;
      }
      timeline
        .to(packet, { x: distance, duration: 0.66, ease: "power1.inOut", onComplete: () => {
          packet.remove();
          state.received += 1;
          dom.receiverState.textContent = opts.retransmission ? "缺失段补齐，累计 ACK 前移" : "收到数据，生成累计 ACK";
          dom.receiverHost.classList.add("is-receiving");
          dom.receiverAck.textContent = opts.ackText || ("<ack=" + (number + 1) + ">");
          gsap.delayedCall(0.32, () => dom.receiverHost.classList.remove("is-receiving"));
          updateStatus();
        } })
        .set(ack, { autoAlpha: 1 })
        .to(ack, { x: 0, duration: 0.66, ease: "power1.inOut", onComplete: () => {
          ack.remove();
          state.inFlight = Math.max(0, state.inFlight - 1);
          dom.senderHost.classList.add("is-active");
          gsap.delayedCall(0.28, () => dom.senderHost.classList.remove("is-active"));
          if (typeof opts.onAck === "function") opts.onAck();
          updateStatus();
        } });
    });
  }

  function animateStuckPacket(number, delay) {
    const distance = Math.max(90, dom.dataLane.clientWidth - 48);
    const packet = makePacket(dom.dataLane, "data", number, "DATA", false);
    packet.classList.add("is-lost", "timeout-stuck");
    state.inFlight += 1;
    updateStatus();
    return new Promise((resolve) => {
      const timeline = trackedTimeline(resolve, delay || 0);
      const stopAt = Math.min(distance - 44, distance * 0.45 + (number - 1) * 18);
      timeline.to(packet, { x: stopAt, duration: 0.72, ease: "power1.inOut" });
    }).then(() => packet);
  }

  function animateOneShot(element, vars) {
    return new Promise((resolve) => {
      const timeline = trackedTimeline(resolve, 0);
      timeline.to(element, Object.assign({}, vars, { onComplete: resolve }));
    });
  }

  function timerCountdown(seconds) {
    dom.timerLabel.textContent = seconds.toFixed(1) + "s";
    if (window.gsap) {
      gsap.set(dom.timerProgress, { strokeDashoffset: 0 });
      gsap.to(dom.timerProgress, {
        strokeDashoffset: 100.53,
        duration: seconds,
        ease: "none",
        onUpdate: function () {
          const remaining = Math.max(0, seconds * (1 - this.progress()));
          dom.timerLabel.textContent = remaining.toFixed(1) + "s";
        }
      });
    }
    return waitFor(seconds);
  }

  function recordPoint(kind, animate) {
    state.points.push({ rtt: state.rtt, cwnd: state.cwnd, kind: kind || "normal" });
    renderChart(Boolean(animate));
  }

  function applyLoss(kind) {
    const before = state.cwnd;
    const previousThreshold = state.ssthresh;
    state.ssthresh = Math.max(2, Math.floor(before / 2));
    state.cwnd = kind === "timeout" ? 1 : state.ssthresh;
    state.phase = kind === "timeout" ? "slowStart" : "congestionAvoidance";
    state.duplicateAcks = 0;
    dom.duplicateCounter.hidden = true;
    dom.timerLabel.textContent = "空闲";
    gsap.set(dom.timerProgress, { strokeDashoffset: 0 });
    dom.senderHost.classList.remove("is-loss");
    showLossSummary(kind, before, previousThreshold);
    state.nextAutomaticLoss = kind === "timeout" ? "fast" : "timeout";
    updateUpcomingEvent();
    updateStatus();
    setNote(kind === "timeout"
      ? "超时：ssthresh 取丢包前 cwnd 的一半，cwnd 回到 1 MSS"
      : "快恢复结束：从折半窗口继续拥塞避免");
    recordPoint(kind, true);
  }

  async function completeTimeout(reason) {
    if (state.epoch !== reason.epoch) return;
    dom.senderHost.classList.add("is-loss");
    setBanner("数据包未获确认 · 等待重传计时器归零", "timeout-banner");
    showEventStep("timeout", 1);
    await timerCountdown(reason.duration || 1.45);
    if (state.epoch !== reason.epoch) return;
    dom.timerLabel.textContent = "Timeout";
    setBanner(reason.message, "timeout-banner");
    const stuck = Array.from(document.querySelectorAll(".timeout-stuck"));
    await Promise.all(stuck.map((packet) => animateOneShot(packet, {
      opacity: 0, scale: 0.58, rotation: -13, duration: 0.34, ease: "power2.in"
    }).then(() => packet.remove())));
    state.inFlight = Math.max(0, state.inFlight - stuck.length);
    updateStatus();
    if (state.epoch !== reason.epoch) return;
    if (reason.networkRound) {
      state.rtt += 1;
      state.points.push({ rtt: state.rtt, cwnd: state.cwnd, kind: "attempt" });
      renderChart(true);
    }
    applyLoss("timeout");
    showEventStep("timeout", 2);
    dom.lossProgress.textContent = "虚线移动到新的 ssthresh；曲线在同一 RTT 垂直降到 1";
    await waitFor(1.5);
    if (state.epoch !== reason.epoch) return;
    const missingPacket = reason.packetNumber || 1;
    showEventStep("timeout", 3);
    dom.channelDetail.textContent = "超时重传：以 cwnd = 1 补发第 " + missingPacket + " 包";
    setNote("Timeout：窗口回到 1 MSS，立即重传未确认的数据包");
    await animatePacket(missingPacket, {
      retransmission: true,
      highlight: true,
      ackText: "<ack=" + (missingPacket + 1) + ">"
    });
    if (state.epoch !== reason.epoch) return;
    showEventStep("timeout", 4);
    dom.lossProgress.textContent = "重传已确认：cwnd 保持 1，随后重新慢开始；门限保持 " + state.ssthresh;
    dom.receiverState.textContent = "重传包已确认，下一轮重新慢开始";
    setNote("超时重传完成：cwnd = 1 MSS，下一轮从慢开始恢复增长");
    await waitFor(1.2);
  }

  async function runRound() {
    if (state.busy || state.epoch < 0) return;
    state.busy = true;
    const epoch = state.epoch;
    try {
      clearBanner();
      updateControls();
      dom.senderHost.classList.add("is-active");
      dom.channelDetail.textContent = "本轮发送 " + state.cwnd + " 个数据包";
      dom.receiverState.textContent = "等待本轮数据与确认";
      setNote("发送端按 cwnd 连续发包，接收端逐包返回 ACK");
      const currentWindow = state.cwnd;
      const overflow = currentWindow > CAPACITY;
      if (overflow) showEventStep("timeout", 0);
      const count = Math.min(currentWindow, CAPACITY + 1);
      const flights = [];
      for (let number = 1; number <= count; number += 1) {
        const lost = overflow && number > CAPACITY;
        flights.push(animatePacket(number, {
          lost,
          keepStuck: lost,
          delay: (number - 1) * 0.075,
          ackText: "<ack=" + (number + 1) + ">"
        }));
      }
      await Promise.all(flights);
      if (state.epoch !== epoch) return;
      dom.senderHost.classList.remove("is-active");
      if (overflow) {
        dom.channelDetail.textContent = "第 " + (CAPACITY + 1) + " 包超过承载极限，等待重传计时器";
        dom.receiverState.textContent = "有包丢失，缺口未补齐";
        setNote("链路容量为 16 包；超出承载能力的包没有 ACK");
        await completeTimeout({
          epoch,
          networkRound: true,
          packetNumber: CAPACITY + 1,
          duration: 1.4,
          message: "网络承载极限已达到 · 超时计时器归零，触发 Timeout"
        });
        if (state.epoch !== epoch) return;
        dom.channelDetail.textContent = "拥塞窗口决定本轮发送量";
      } else {
        const oldValue = state.cwnd;
        const completedPhase = state.phase;
        state.rtt += 1;
        if (completedPhase === "slowStart") {
          state.cwnd = Math.min(state.cwnd * 2, state.ssthresh);
          if (state.cwnd >= state.ssthresh) state.phase = "congestionAvoidance";
        } else {
          state.cwnd += 1;
        }
        dom.receiverState.textContent = "本轮数据全部确认";
        dom.senderHost.classList.remove("is-active");
        dom.senderHost.classList.add("is-round-pulse");
        gsap.delayedCall(0.8, () => dom.senderHost.classList.remove("is-round-pulse"));
        updateStatus();
        setNote(completedPhase === "slowStart"
          ? "RTT 完成：慢开始将 cwnd 翻倍；达到门限后切换拥塞避免"
          : "RTT 完成：拥塞避免将 cwnd 增加 1 MSS");
        recordPoint("normal", true);
        showRoundToast(oldValue, state.cwnd);
      }
    } catch (error) {
      console.error("TCP congestion-control round stopped:", error);
      if (state.epoch === epoch) {
        state.playing = false;
        setNote("动画被中断；可以重新开始后继续");
      }
    } finally {
      if (state.epoch === epoch) {
        state.busy = false;
        updateControls();
      }
    }
  }

  async function prepareWindow(minimum, epoch) {
    while (state.cwnd < minimum && state.epoch === epoch) {
      const previousRtt = state.rtt;
      await runRound();
      if (state.epoch !== epoch) return;
      if (state.rtt === previousRtt) throw new Error("窗口准备过程未完成 RTT");
    }
  }

  async function runTimeoutEvent() {
    if (state.busy) return;
    const epoch = state.epoch;
    setNote("先完成正常 RTT，使窗口增长到至少 8，再演示超时与门限变化");
    await prepareWindow(8, epoch);
    if (state.epoch !== epoch) return;
    state.busy = true;
    updateControls();
    clearBanner();
    showEventStep("timeout", 0);
    dom.channelDetail.textContent = "数据包滞留在信道中，ACK 未返回";
    dom.receiverState.textContent = "部分数据未送达";
    setNote("灰色包停在信道中央，接下来等待超时计时器归零");
    const pending = [];
    for (let number = 1; number <= Math.min(state.cwnd, 4); number += 1) {
      pending.push(animateStuckPacket(number, (number - 1) * 0.12));
    }
    await Promise.all(pending);
    if (state.epoch !== epoch) return;
    await completeTimeout({epoch, duration: 2.2, message: "💥 计时器归零！触发超时重传，先更新门限与窗口"});
    if (state.epoch !== epoch) return;
    dom.channelDetail.textContent = "超时重传已确认，下一轮从 cwnd = 1 开始";
    state.busy = false;
    updateControls();
  }

  async function runFastRetransmit() {
    if (state.busy) return;
    const epoch = state.epoch;
    await prepareWindow(5, epoch);
    if (state.epoch !== epoch) return;
    state.busy = true;
    updateControls();
    clearBanner();
    const originalWindow = state.cwnd;
    const previousThreshold = state.ssthresh;
    let enteredRecovery = false;
    state.duplicateAcks = 0;
    dom.duplicateCounter.hidden = false;
    updateStatus();
    showEventStep("fast", 0);
    dom.receiverState.textContent = "第 2 包将丢失，后续包返回重复 ACK";
    dom.receiverAck.textContent = "<ack=1>";
    dom.channelDetail.textContent = "快重传特写：本组相对编号 1–5，丢失第 2 包";
    setBanner("个别丢包：观察第 2 包在信道中央丢失，以及三次重复 <ack=2>", "fast-banner");
    const flights = [];
    for (let number = 1; number <= 5; number += 1) {
      flights.push(animatePacket(number, {
        lost: number === 2,
        delay: (number - 1) * 0.5,
        ackText: "<ack=2>",
        onAck: () => {
          if (state.epoch !== epoch) return;
          if (number === 1) {
            showEventStep("fast", 1);
            setNote("正常 ACK：第 1 包已确认，期待第 2 包；重复 ACK 计数仍为 0");
            return;
          }
          if (number < 3) return;
          state.duplicateAcks += 1;
          updateStatus();
          $("event-step-1").textContent = "重复 ACK " + state.duplicateAcks + " / 3";
          setNote("第 " + number + " 包已到达，发送端收到第 " + state.duplicateAcks + " 次重复 <ack=2>");
          if (state.duplicateAcks === 3 && !enteredRecovery) {
            enteredRecovery = true;
            state.ssthresh = Math.max(2, Math.floor(originalWindow / 2));
            state.cwnd = state.ssthresh;
            state.phase = "fastRetransmit";
            showEventStep("fast", 2);
            showLossSummary("fast", originalWindow, previousThreshold);
            dom.lossProgress.textContent = "3 次重复 ACK 已到达，立即补发第 2 包，不等待计时器";
            setBanner("⚡ 收到 3 个重复 ACK！触发【快重传】，立即补发第 2 包！", "fast-banner");
            updateStatus();
            recordPoint("fast", true);
          }
        }
      }));
    }
    await Promise.all(flights);
    if (state.epoch !== epoch) return;
    if (!enteredRecovery) throw new Error("未收到三次重复 ACK");
    dom.channelDetail.textContent = "快重传：单独弹射第 2 包，接收端随后累计确认到 6";
    await animatePacket(2, {retransmission: true, highlight: true, ackText: "<ack=6>"});
    if (state.epoch !== epoch) return;
    state.phase = "fastRecovery";
    state.rtt += 1;
    showEventStep("fast", 3);
    setBanner("快恢复：缺失段已补齐，cwnd = ssthresh = " + state.cwnd + "，保持折半后的窗口", "fast-banner");
    dom.lossProgress.textContent = "快恢复：" + originalWindow + " → " + state.cwnd + "，不会回到 1";
    dom.receiverState.textContent = "累计 ACK = 6 返回，缺口已修复";
    updateStatus();
    recordPoint("recovery", true);
    await waitFor(2.4);
    if (state.epoch !== epoch) return;
    state.phase = "congestionAvoidance";
    state.nextAutomaticLoss = "timeout";
    updateUpcomingEvent();
    showEventStep("fast", 4);
    dom.duplicateCounter.hidden = true;
    const recoveredWindow = state.cwnd;
    dom.lossProgress.textContent = "接着演示一轮拥塞避免：" + recoveredWindow + " → " + (recoveredWindow + 1) + "（+1）";
    state.busy = false;
    updateStatus();
    await runRound();
    if (state.epoch !== epoch) return;
    setNote("快恢复完成：已从半窗 " + recoveredWindow + " 按拥塞避免规则增长到 " + state.cwnd);
    dom.lossProgress.textContent = "恢复后首轮 RTT 已完成：" + recoveredWindow + " → " + state.cwnd + "（+1），继续线性增长";
    updateControls();
  }

  async function executeIncident(kind) {
    const epoch = state.epoch;
    state.pendingIncident = null;
    state.incidentRunning = true;
    updateControls();
    try {
      if (kind === "fast") await runFastRetransmit();
      else await runTimeoutEvent();
    } catch (error) {
      console.error("TCP incident stopped:", error);
      if (state.epoch === epoch) {
        state.playing = false;
        setNote("丢包演示被中断，可重新开始");
      }
    } finally {
      if (state.epoch === epoch) {
        state.incidentRunning = false;
        state.busy = false;
        updateControls();
      }
    }
  }

  async function advanceSimulation() {
    if (state.busy || state.incidentRunning) return;
    const epoch = state.epoch;
    if (state.pendingIncident) await executeIncident(state.pendingIncident);
    else if (state.nextAutomaticLoss === "fast" && state.cwnd >= 12) await executeIncident("fast");
    else await runRound();
    if (state.epoch === epoch && state.pendingIncident) await executeIncident(state.pendingIncident);
  }

  function requestIncident(kind) {
    if (state.incidentRunning || state.pendingIncident) return;
    state.pendingIncident = kind;
    updateControls();
    setNote("已预约" + (kind === "fast" ? "快重传与快恢复" : "超时重传") + "，当前 RTT 完成后自动演示");
    if (!state.busy && !state.playing) advanceSimulation();
  }

  function waitFor(seconds) {
    return new Promise((resolve) => {
      let timer;
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (timer) state.timelines.delete(timer);
        resolve();
      };
      timer = gsap.delayedCall(seconds, settle);
      timer.eventCallback("onInterrupt", settle);
      state.timelines.add(timer);
    });
  }

  async function playLoop() {
    const epoch = state.epoch;
    const playbackId = ++state.playbackId;
    state.playing = true;
    updateControls();
    while (state.playing && state.epoch === epoch && state.playbackId === playbackId) {
      await advanceSimulation();
      if (!state.playing || state.epoch !== epoch || state.playbackId !== playbackId) break;
      await waitFor(0.24);
    }
    if (state.epoch === epoch && state.playbackId === playbackId) {
      state.playing = false;
      updateControls();
    }
  }

  function setSpeed(value) {
    state.speed = Number(value);
    dom.speedValue.textContent = state.speed.toFixed(1) + "×";
    const percentage = ((state.speed - 0.5) / 2) * 100;
    dom.speed.style.setProperty("--pct", percentage + "%");
    gsap.globalTimeline.timeScale(state.speed);
  }

  function clearParticles() {
    document.querySelectorAll(".packet").forEach((packet) => packet.remove());
    gsap.killTweensOf([dom.senderHost, dom.receiverHost, dom.roundToast, dom.timerProgress, dom.eventBanner]);
    gsap.killTweensOf(".packet");
    gsap.set([dom.senderHost, dom.receiverHost], { clearProps: "transform,opacity" });
    dom.senderHost.classList.remove("is-active", "is-loss", "is-round-pulse");
    dom.receiverHost.classList.remove("is-active", "is-loss", "is-receiving");
  }

  function resetSimulation() {
    state.epoch += 1;
    state.playbackId += 1;
    state.playing = false;
    state.busy = false;
    state.pendingIncident = null;
    state.incidentRunning = false;
    state.nextAutomaticLoss = "timeout";
    state.lastLoss = null;
    state.timelines.forEach((timeline) => timeline.kill());
    state.timelines.clear();
    gsap.killTweensOf("*");
    clearParticles();
    state.cwnd = 1;
    state.ssthresh = INITIAL_SSTHRESH;
    state.phase = "slowStart";
    state.rtt = 0;
    state.inFlight = 0;
    state.received = 0;
    state.duplicateAcks = 0;
    state.points = [{ rtt: 0, cwnd: 1, kind: "start" }];
    dom.receiverAck.textContent = "<ack=1>";
    dom.receiverState.textContent = "就绪，等待数据";
    dom.timerLabel.textContent = "空闲";
    dom.duplicateCounter.hidden = true;
    dom.eventBanner.hidden = true;
    dom.eventBanner.className = "event-banner";
    dom.eventBanner.removeAttribute("style");
    dom.eventSteps.hidden = true;
    dom.lossSummary.hidden = true;
    dom.roundToast.textContent = "";
    dom.roundToast.removeAttribute("style");
    dom.channelDetail.textContent = "拥塞窗口决定本轮发送量";
    updateUpcomingEvent();
    gsap.set(dom.timerProgress, { strokeDashoffset: 0 });
    setNote("等待开始 · 每轮 RTT 完成后更新窗口");
    updateStatus();
    updateControls();
    renderChart(false);
  }

  dom.play.addEventListener("click", () => {
    if (state.playing) {
      state.playing = false;
      state.playbackId += 1;
      updateControls();
    } else if (!state.busy && !state.incidentRunning) {
      playLoop();
    }
  });
  dom.step.addEventListener("click", () => { if (!state.busy && !state.playing) advanceSimulation(); });
  dom.reset.addEventListener("click", resetSimulation);
  dom.timeout.addEventListener("click", () => requestIncident("timeout"));
  dom.fastLoss.addEventListener("click", () => requestIncident("fast"));
  dom.speed.addEventListener("input", (event) => setSpeed(event.target.value));

  setSpeed(dom.speed.value);
  updateStatus();
  updateControls();
  renderChart(false);
})();
