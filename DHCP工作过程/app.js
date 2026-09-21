const CLIENT_MAC = '08:00:27:6A:9C:21';
const SERVER_MAC = '52:54:00:12:34:56';

const DHCP_STEPS = [
  {
    id: 'discover',
    type: 'DHCP DISCOVER',
    chineseName: '发现',
    direction: 'right-to-left',
    sourceIp: '0.0.0.0',
    destinationIp: '255.255.255.255',
    sourceMac: CLIENT_MAC,
    destinationMac: 'FF:FF:FF:FF:FF:FF',
    sourcePort: 68,
    destinationPort: 67,
    explanation: '客户端刚接入网络，既没有 IP，也不知道 DHCP 服务器在哪里，因此从 0.0.0.0 发出全网广播。',
    optionLabel: '客户端请求',
    optionValue: '获取可用配置',
    sourceIpNote: '尚未分配',
    sourceMacNote: '客户端网卡',
    fieldReasons: {
      sourceIp: '客户端还没有租约，源 IP 只能填 0.0.0.0。',
      destinationIp: '客户端不知道服务器位置，因此向本网广播。',
      sourceMac: '客户端用自己的网卡 MAC 标识这次请求。',
      destinationMac: '广播帧的目的 MAC 必须是全 F。',
    },
  },
  {
    id: 'offer',
    type: 'DHCP OFFER',
    chineseName: '提供',
    direction: 'left-to-right',
    sourceIp: '192.168.1.1',
    destinationIp: '255.255.255.255',
    sourceMac: SERVER_MAC,
    destinationMac: 'FF:FF:FF:FF:FF:FF',
    sourcePort: 67,
    destinationPort: 68,
    explanation: '服务器收到寻找报文后，从地址池中预留 192.168.1.100，并附带子网掩码、网关、DNS 与租期参数。',
    optionLabel: '提供地址',
    optionValue: '192.168.1.100 / 24',
    sourceIpNote: 'DHCP 服务器',
    sourceMacNote: '服务器网卡',
    fieldReasons: {
      sourceIp: '报价由 DHCP 服务器发出，所以使用服务器 IP。',
      destinationIp: '客户端尚未正式启用地址，服务器按广播标志回复。',
      sourceMac: '以太网帧由服务器网卡发出。',
      destinationMac: '为确保未配置 IP 的客户端收到，使用广播 MAC。',
    },
  },
  {
    id: 'request',
    type: 'DHCP REQUEST',
    chineseName: '请求',
    direction: 'right-to-left',
    sourceIp: '0.0.0.0',
    destinationIp: '255.255.255.255',
    sourceMac: CLIENT_MAC,
    destinationMac: 'FF:FF:FF:FF:FF:FF',
    sourcePort: 68,
    destinationPort: 67,
    explanation: '客户端广播宣布选择 192.168.1.1 的报价，同时通知其他 DHCP 服务器释放它们预留的地址。',
    optionLabel: '请求地址',
    optionValue: '192.168.1.100',
    sourceIpNote: '地址尚未生效',
    sourceMacNote: '客户端网卡',
    fieldReasons: {
      sourceIp: '租约尚未被 ACK 确认，客户端仍然使用 0.0.0.0。',
      destinationIp: '客户端广播自己选中的报价，让所有服务器都知道。',
      sourceMac: '请求由同一台客户端网卡发出。',
      destinationMac: '请求要通知所有 DHCP 服务器，因此使用广播 MAC。',
    },
  },
  {
    id: 'ack',
    type: 'DHCP ACK',
    chineseName: '确认',
    direction: 'left-to-right',
    sourceIp: '192.168.1.1',
    destinationIp: '255.255.255.255',
    sourceMac: SERVER_MAC,
    destinationMac: 'FF:FF:FF:FF:FF:FF',
    sourcePort: 67,
    destinationPort: 68,
    explanation: '服务器确认租约，客户端收到 ACK 后才正式使用 192.168.1.100，并开始计算租期。',
    optionLabel: '租约结果',
    optionValue: '192.168.1.100 · 8 小时',
    sourceIpNote: 'DHCP 服务器',
    sourceMacNote: '服务器网卡',
    fieldReasons: {
      sourceIp: '租约确认由 DHCP 服务器发出。',
      destinationIp: '客户端尚未完成地址安装，服务器继续广播 ACK。',
      sourceMac: '确认帧由服务器网卡发出。',
      destinationMac: '按客户端的广播标志，ACK 帧仍然使用全 F 目的 MAC。',
    },
  },
];

function getStep(index) {
  return DHCP_STEPS[index];
}

function getAdjacentStepIndex(index, delta) {
  return (index + delta + DHCP_STEPS.length) % DHCP_STEPS.length;
}

function getNextAutoplayStep(index) {
  return index < DHCP_STEPS.length - 1 ? index + 1 : null;
}

function getPlaybackButtonState(isPlaying, hasCompletedRun) {
  if (isPlaying) return { icon: 'Ⅱ', label: '暂停' };
  if (hasCompletedRun) return { icon: '↻', label: '重新演示' };
  return { icon: '▶', label: '自动演示' };
}

function getNetworkFacingAnchor(endpointRect, zoneRect, side, vertical = false) {
  if (vertical) {
    const edgeY = side === 'server' ? endpointRect.bottom : endpointRect.top;
    return {
      x: Math.round(endpointRect.left + (endpointRect.right - endpointRect.left) / 2 - zoneRect.left),
      y: Math.round(edgeY - zoneRect.top),
    };
  }
  const edgeX = side === 'server' ? endpointRect.right : endpointRect.left;
  return {
    x: Math.round(edgeX - zoneRect.left),
    y: Math.round(endpointRect.top + endpointRect.height / 2 - zoneRect.top),
  };
}

function getMobileTransferPlan(packetRect, gridRect, viewportHeight, topMargin = 66, bottomMargin = 12) {
  const contentSpan = gridRect.bottom - packetRect.top;
  const availableHeight = viewportHeight - topMargin - bottomMargin;
  if (contentSpan > availableHeight) {
    return {
      docked: true,
      scrollDelta: Math.round(gridRect.bottom - (viewportHeight - bottomMargin)),
    };
  }

  const desiredPacketTop = Math.max(
    topMargin,
    viewportHeight - bottomMargin - contentSpan,
  );
  return {
    docked: false,
    scrollDelta: Math.round(packetRect.top - desiredPacketTop),
  };
}

function getMobilePacketScrollTop(stageRect, scrollY, viewportHeight, topMargin = 66) {
  const stageDocumentTop = stageRect.top + scrollY;
  return Math.max(0, Math.round(stageDocumentTop - topMargin));
}

class DHCPDemo {
  constructor(root = document) {
    this.root = root;
    this.currentStep = 0;
    this.speed = 1;
    this.isPlaying = false;
    this.hasCompletedRun = false;
    this.runId = 0;
    this.transitionId = 0;
    this.activeAnimation = null;
    this.activeTransfers = [];
    this.transferViewport = null;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.dom = {
      stage: root.getElementById('network-stage'),
      linkZone: root.querySelector('.link-zone'),
      server: root.getElementById('dhcp-server'),
      client: root.getElementById('dhcp-client'),
      clientIp: root.getElementById('client-ip'),
      clientStatus: root.getElementById('client-status'),
      packet: root.getElementById('packet-capsule'),
      packetType: root.querySelector('.packet-heading strong'),
      packetMode: root.querySelector('.packet-heading small'),
      packetSourceIp: root.getElementById('packet-source-ip'),
      packetDestinationIp: root.getElementById('packet-destination-ip'),
      packetSourceMac: root.getElementById('packet-source-mac'),
      packetDestinationMac: root.getElementById('packet-destination-mac'),
      directionIcon: root.getElementById('direction-icon'),
      directionText: root.getElementById('direction-text'),
      stepKicker: root.getElementById('step-kicker'),
      messageType: root.getElementById('message-type'),
      explanation: root.getElementById('message-explanation'),
      sourceIp: root.getElementById('source-ip'),
      destinationIp: root.getElementById('destination-ip'),
      sourceMac: root.getElementById('source-mac'),
      destinationMac: root.getElementById('destination-mac'),
      sourceIpNote: root.getElementById('source-ip-note'),
      destinationIpNote: root.getElementById('destination-ip-note'),
      sourceMacNote: root.getElementById('source-mac-note'),
      destinationMacNote: root.getElementById('destination-mac-note'),
      fieldGrid: root.querySelector('.field-grid'),
      portFlow: root.getElementById('port-flow'),
      optionLabel: root.getElementById('option-label'),
      optionValue: root.getElementById('option-value'),
      playButton: root.getElementById('play-button'),
      playIcon: root.getElementById('play-icon'),
      playLabel: root.getElementById('play-label'),
      previousButton: root.getElementById('previous-button'),
      nextButton: root.getElementById('next-button'),
      resetButton: root.getElementById('reset-button'),
      speedControl: root.getElementById('speed-control'),
      speedOutput: root.getElementById('speed-output'),
      stepButtons: [...root.querySelectorAll('.step-button')],
    };

    this.bindEvents();
    this.renderStep(false);
  }

  bindEvents() {
    this.dom.playButton.addEventListener('click', () => {
      if (this.isPlaying) this.pause();
      else this.play();
    });
    this.dom.previousButton.addEventListener('click', () => this.goTo(getAdjacentStepIndex(this.currentStep, -1)));
    this.dom.nextButton.addEventListener('click', () => this.goTo(getAdjacentStepIndex(this.currentStep, 1)));
    this.dom.resetButton.addEventListener('click', () => {
      this.pause();
      this.currentStep = 0;
      this.renderStep(false);
    });
    this.dom.speedControl.addEventListener('input', (event) => {
      this.speed = Number(event.target.value);
      this.dom.speedOutput.value = `${this.speed.toFixed(1)}×`;
      this.dom.speedOutput.textContent = `${this.speed.toFixed(1)}×`;
    });
    this.dom.stepButtons.forEach((button) => {
      button.addEventListener('click', () => this.goTo(Number(button.dataset.step)));
    });
    window.addEventListener('resize', () => {
      this.updateText(getStep(this.currentStep), false);
      if (!this.isPlaying) this.positionPacket(this.currentStep, 'source');
    });
  }

  isVerticalLayout() {
    return window.matchMedia('(max-width: 560px)').matches;
  }

  getEndpoint(step, role) {
    const fromClient = step.direction === 'right-to-left';
    if (role === 'source') return fromClient ? this.dom.client : this.dom.server;
    return fromClient ? this.dom.server : this.dom.client;
  }

  getEndpointPosition(endpoint) {
    const zoneRect = this.dom.linkZone.getBoundingClientRect();
    const endpointRect = endpoint.getBoundingClientRect();
    const side = endpoint === this.dom.server ? 'server' : 'client';
    return getNetworkFacingAnchor(endpointRect, zoneRect, side, this.isVerticalLayout());
  }

  positionPacket(index, role) {
    const step = getStep(index);
    const point = this.getEndpointPosition(this.getEndpoint(step, role));
    this.dom.packet.style.left = `${point.x}px`;
    this.dom.packet.style.top = `${point.y}px`;
  }

  updateText(step, updateTable = true) {
    const number = this.currentStep + 1;
    const clientToServer = step.direction === 'right-to-left';
    const vertical = this.isVerticalLayout();

    this.dom.stepKicker.textContent = `第 ${number} 步 · ${step.chineseName}`;
    this.dom.messageType.textContent = step.type;
    this.dom.explanation.textContent = step.explanation;
    this.dom.portFlow.textContent = `${step.sourcePort} → ${step.destinationPort}`;
    this.dom.optionLabel.textContent = step.optionLabel;
    this.dom.optionValue.textContent = step.optionValue;
    this.dom.packetType.textContent = step.type;
    this.dom.packetMode.textContent = '广播';
    this.dom.packetSourceIp.textContent = step.sourceIp;
    this.dom.packetDestinationIp.textContent = step.destinationIp;
    this.dom.packetSourceMac.textContent = step.sourceMac;
    this.dom.packetDestinationMac.textContent = step.destinationMac;
    this.dom.directionIcon.textContent = vertical ? (clientToServer ? '↑' : '↓') : (clientToServer ? '←' : '→');
    this.dom.directionText.textContent = clientToServer ? '客户端 → 服务器' : '服务器 → 客户端';
    this.dom.stage.classList.toggle('is-reverse', clientToServer);
    if (updateTable) this.applyTableValues(step);
  }

  getFieldBindings(step) {
    return [
      { key: 'sourceIp', packet: this.dom.packetSourceIp, target: this.dom.sourceIp, note: this.dom.sourceIpNote, value: step.sourceIp },
      { key: 'destinationIp', packet: this.dom.packetDestinationIp, target: this.dom.destinationIp, note: this.dom.destinationIpNote, value: step.destinationIp },
      { key: 'sourceMac', packet: this.dom.packetSourceMac, target: this.dom.sourceMac, note: this.dom.sourceMacNote, value: step.sourceMac },
      { key: 'destinationMac', packet: this.dom.packetDestinationMac, target: this.dom.destinationMac, note: this.dom.destinationMacNote, value: step.destinationMac },
    ];
  }

  updateClientLease(step) {
    const clientHasLease = step.id === 'ack';
    this.dom.clientIp.textContent = clientHasLease ? '192.168.1.100' : '0.0.0.0';
    this.dom.clientStatus.classList.toggle('is-waiting', !clientHasLease);
    this.dom.clientStatus.innerHTML = clientHasLease ? '<span></span>租约已生效' : '<span></span>等待地址';
  }

  applyTableValues(step) {
    this.getFieldBindings(step).forEach((binding) => {
      binding.target.textContent = binding.value;
      binding.note.textContent = step.fieldReasons[binding.key];
      binding.target.closest('.field-card').classList.remove('is-awaiting');
    });
    this.updateClientLease(step);
  }

  clearTableValues() {
    const step = getStep(0);
    this.getFieldBindings(step).forEach((binding) => {
      binding.target.textContent = '—';
      binding.note.textContent = '等待报文到达后更新。';
      binding.target.closest('.field-card').classList.add('is-awaiting');
    });
    this.updateClientLease(step);
  }

  updateStepTrack() {
    this.dom.stepButtons.forEach((button, index) => {
      const active = index === this.currentStep;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  async renderStep(animate = true) {
    const step = getStep(this.currentStep);
    this.hasCompletedRun = false;
    const transition = ++this.transitionId;
    this.cancelFieldTransfers();
    this.updateText(step, !animate || this.reducedMotion);
    this.updateStepTrack();
    this.dom.server.classList.remove('is-sending', 'is-receiving');
    this.dom.client.classList.remove('is-sending', 'is-receiving');

    const source = this.getEndpoint(step, 'source');
    const destination = this.getEndpoint(step, 'destination');
    source.classList.add('is-sending');
    this.positionPacket(this.currentStep, 'source');

    if (!animate || this.reducedMotion) {
      this.hasCompletedRun = step.id === 'ack';
      this.updatePlayButton();
      return true;
    }
    const viewportReady = await this.preparePacketViewport(transition);
    if (!viewportReady || transition !== this.transitionId) return false;
    const arrived = await this.animatePacket(source, destination);
    if (!arrived || transition !== this.transitionId) return false;
    await this.animateFieldTransfers(step, transition);
    if (transition !== this.transitionId) return false;
    this.hasCompletedRun = step.id === 'ack';
    this.updatePlayButton();
    return true;
  }

  async animatePacket(source, destination) {
    if (this.activeAnimation) this.activeAnimation.cancel();

    const start = this.getEndpointPosition(source);
    const end = this.getEndpointPosition(destination);
    this.dom.stage.classList.add('is-moving');

    const animation = this.dom.packet.animate([
      { left: `${start.x}px`, top: `${start.y}px`, opacity: .18, transform: 'translate(-50%, -50%) scale(.78)' },
      { offset: .12, opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
      { offset: .52, opacity: 1, transform: 'translate(-50%, -50%) scale(1.045)' },
      { left: `${end.x}px`, top: `${end.y}px`, opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
    ], {
      duration: 1550 / this.speed,
      easing: 'cubic-bezier(.22, .78, .16, 1)',
      fill: 'forwards',
    });
    this.activeAnimation = animation;

    try {
      await animation.finished;
      if (this.activeAnimation !== animation) return;
      this.dom.packet.style.left = `${end.x}px`;
      this.dom.packet.style.top = `${end.y}px`;
      source.classList.remove('is-sending');
      destination.classList.add('is-receiving');
      return true;
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
      return false;
    } finally {
      if (this.activeAnimation === animation) {
        this.dom.stage.classList.remove('is-moving');
        this.activeAnimation = null;
      }
    }
  }

  cancelFieldTransfers() {
    const viewportState = this.transferViewport;
    this.transferViewport = null;
    if (viewportState) {
      window.scrollTo({ top: viewportState.scrollY, behavior: 'auto' });
    }
    this.dom.packet.classList.remove('is-transfer-docked');
    this.activeTransfers.forEach(({ animation, chip }) => {
      animation.cancel();
      chip.remove();
    });
    this.activeTransfers = [];
  }

  async animateFieldTransfers(step, transition) {
    await this.prepareFieldTransferViewport(transition);
    if (transition !== this.transitionId) return;
    const bindings = this.getFieldBindings(step);
    bindings.forEach((binding) => binding.target.closest('.field-card').classList.add('is-awaiting'));

    const transfers = bindings.map(async (binding, index) => {
      await new Promise((resolve) => window.setTimeout(resolve, (index * 130) / this.speed));
      if (transition !== this.transitionId) return;

      const from = binding.packet.getBoundingClientRect();
      const to = binding.target.getBoundingClientRect();
      const chip = document.createElement('span');
      chip.className = 'field-transfer-chip';
      chip.setAttribute('aria-hidden', 'true');
      chip.textContent = binding.value;
      chip.style.left = `${from.left}px`;
      chip.style.top = `${from.top}px`;
      chip.style.width = `${Math.max(from.width, 72)}px`;
      document.body.appendChild(chip);

      const deltaX = to.left + to.width / 2 - (from.left + Math.max(from.width, 72) / 2);
      const deltaY = to.top + to.height / 2 - (from.top + from.height / 2);
      const animation = chip.animate([
        { transform: 'translate(0, 0) scale(.94)', opacity: .35 },
        { offset: .18, opacity: 1 },
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(1.04)`, opacity: 1 },
      ], {
        duration: 620 / this.speed,
        easing: 'cubic-bezier(.22, .78, .16, 1)',
        fill: 'forwards',
      });
      const record = { animation, chip };
      this.activeTransfers.push(record);

      try {
        await animation.finished;
        if (transition !== this.transitionId) return;
        const card = binding.target.closest('.field-card');
        binding.target.textContent = binding.value;
        binding.note.textContent = step.fieldReasons[binding.key];
        card.classList.remove('is-awaiting');
        card.classList.add('is-updated');
        window.setTimeout(() => card.classList.remove('is-updated'), 520 / this.speed);
      } catch (error) {
        if (error.name !== 'AbortError') throw error;
      } finally {
        chip.remove();
        this.activeTransfers = this.activeTransfers.filter((item) => item !== record);
      }
    });

    try {
      await Promise.all(transfers);
      if (transition === this.transitionId) this.updateClientLease(step);
    } finally {
      await this.restoreFieldTransferViewport(transition);
    }
  }

  async prepareFieldTransferViewport(transition) {
    if (!this.isVerticalLayout()) return;
    const packetRect = this.dom.packet.getBoundingClientRect();
    const gridRect = this.dom.fieldGrid.getBoundingClientRect();
    const plan = getMobileTransferPlan(packetRect, gridRect, window.innerHeight);
    if (plan.docked || Math.abs(plan.scrollDelta) >= 8) {
      this.transferViewport = { transition, scrollY: window.scrollY };
    }
    this.dom.packet.classList.toggle('is-transfer-docked', plan.docked);
    if (Math.abs(plan.scrollDelta) < 8) return;

    window.scrollBy({ top: plan.scrollDelta, behavior: 'smooth' });
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    if (transition !== this.transitionId) return;
  }

  async preparePacketViewport(transition) {
    const stageRect = this.dom.stage.getBoundingClientRect();
    const scrollTop = getMobilePacketScrollTop(stageRect, window.scrollY, window.innerHeight);
    if (Math.abs(window.scrollY - scrollTop) >= 8) {
      window.scrollTo({ top: scrollTop, behavior: 'smooth' });
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    return transition === this.transitionId;
  }

  async restoreFieldTransferViewport(transition) {
    const viewportState = this.transferViewport;
    if (!viewportState || viewportState.transition !== transition) return;

    if (Math.abs(window.scrollY - viewportState.scrollY) >= 8) {
      window.scrollTo({ top: viewportState.scrollY, behavior: 'smooth' });
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    if (this.transferViewport !== viewportState || transition !== this.transitionId) return;

    this.transferViewport = null;
    this.dom.packet.classList.remove('is-transfer-docked');
  }

  async goTo(index) {
    this.pause();
    this.currentStep = index;
    await this.renderStep(true);
  }

  updatePlayButton() {
    this.dom.playButton.classList.toggle('is-playing', this.isPlaying);
    const state = getPlaybackButtonState(this.isPlaying, this.hasCompletedRun);
    this.dom.playIcon.textContent = state.icon;
    this.dom.playLabel.textContent = state.label;
  }

  pause() {
    this.isPlaying = false;
    this.runId += 1;
    this.transitionId += 1;
    if (this.activeAnimation) this.activeAnimation.cancel();
    this.cancelFieldTransfers();
    this.updatePlayButton();
  }

  async play() {
    if (this.hasCompletedRun) {
      this.currentStep = 0;
      this.hasCompletedRun = false;
    }
    this.isPlaying = true;
    const activeRun = ++this.runId;
    this.updatePlayButton();

    while (this.isPlaying && activeRun === this.runId) {
      const completed = await this.renderStep(true);
      if (!completed) break;
      await new Promise((resolve) => window.setTimeout(resolve, 520 / this.speed));
      if (!this.isPlaying || activeRun !== this.runId) break;
      const nextStep = getNextAutoplayStep(this.currentStep);
      if (nextStep === null) {
        this.isPlaying = false;
        this.updatePlayButton();
        break;
      }
      this.currentStep = nextStep;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DHCP_STEPS,
    getStep,
    getAdjacentStepIndex,
    getNextAutoplayStep,
    getPlaybackButtonState,
    getNetworkFacingAnchor,
    getMobileTransferPlan,
    getMobilePacketScrollTop,
    DHCPDemo,
  };
}

if (typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.dhcpDemo = new DHCPDemo(document);
  });
}
