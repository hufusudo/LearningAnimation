const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DHCP_STEPS,
  getStep,
  getAdjacentStepIndex,
  getNextAutoplayStep,
  getPlaybackButtonState,
  getNetworkFacingAnchor,
  getMobileTransferPlan,
  getMobilePacketScrollTop,
  DHCPDemo,
} = require('./app.js');

test('DORA 报文按 Discover、Offer、Request、ACK 排列', () => {
  assert.deepEqual(
    DHCP_STEPS.map((step) => step.type),
    ['DHCP DISCOVER', 'DHCP OFFER', 'DHCP REQUEST', 'DHCP ACK'],
  );
});

test('报文方向在右侧主机与左侧服务器之间交替', () => {
  assert.deepEqual(
    DHCP_STEPS.map((step) => step.direction),
    ['right-to-left', 'left-to-right', 'right-to-left', 'left-to-right'],
  );
});

test('客户端尚未获得地址时，Discover 和 Request 使用广播', () => {
  for (const index of [0, 2]) {
    const step = getStep(index);
    assert.equal(step.sourceIp, '0.0.0.0');
    assert.equal(step.destinationIp, '255.255.255.255');
    assert.equal(step.destinationMac, 'FF:FF:FF:FF:FF:FF');
    assert.equal(step.sourcePort, 68);
    assert.equal(step.destinationPort, 67);
  }
});

test('服务器回复使用 DHCP 服务器端口到客户端端口', () => {
  for (const index of [1, 3]) {
    const step = getStep(index);
    assert.equal(step.sourceIp, '192.168.1.1');
    assert.equal(step.sourcePort, 67);
    assert.equal(step.destinationPort, 68);
  }
});

test('单步导航可以在四个阶段之间循环', () => {
  assert.equal(getAdjacentStepIndex(0, 1), 1);
  assert.equal(getAdjacentStepIndex(3, 1), 0);
  assert.equal(getAdjacentStepIndex(0, -1), 3);
});

test('自动播放在 ACK 完成后停止，不回到 Discover', () => {
  assert.equal(getNextAutoplayStep(0), 1);
  assert.equal(getNextAutoplayStep(2), 3);
  assert.equal(getNextAutoplayStep(3), null);
});

test('ACK 阶段只有在四个字段全部到达后才显示重新演示', () => {
  assert.deepEqual(getPlaybackButtonState(false, false), { icon: '▶', label: '自动演示' });
  assert.deepEqual(getPlaybackButtonState(true, false), { icon: 'Ⅱ', label: '暂停' });
  assert.deepEqual(getPlaybackButtonState(false, true), { icon: '↻', label: '重新演示' });
});

test('重新演示启动时保留 ACK 表格值，直到 Discover 字段到达', async () => {
  const demo = Object.create(DHCPDemo.prototype);
  let tableValue = '192.168.1.1';
  demo.currentStep = 3;
  demo.hasCompletedRun = true;
  demo.isPlaying = false;
  demo.runId = 0;
  demo.transitionId = 0;
  demo.speed = 1;
  demo.renderStep = async () => {
    demo.isPlaying = false;
    return false;
  };
  demo.updatePlayButton = () => {};
  demo.clearTableValues = () => { tableValue = '—'; };

  await demo.play();

  assert.equal(demo.currentStep, 0);
  assert.equal(tableValue, '192.168.1.1');
});

test('每种报文都为四个地址字段提供原因说明', () => {
  const reasonKeys = ['sourceIp', 'destinationIp', 'sourceMac', 'destinationMac'];
  for (const step of DHCP_STEPS) {
    assert.deepEqual(Object.keys(step.fieldReasons), reasonKeys);
    for (const reason of Object.values(step.fieldReasons)) {
      assert.equal(typeof reason, 'string');
      assert.ok(reason.length >= 8);
    }
  }
});

test('报文从两台设备面向链路的边缘出发和到达', () => {
  const zone = { left: 250, top: 400 };
  const server = { left: 35, right: 244, top: 401, height: 238 };
  const client = { left: 543, right: 752, top: 403, height: 233 };

  assert.deepEqual(getNetworkFacingAnchor(server, zone, 'server'), { x: -6, y: 120 });
  assert.deepEqual(getNetworkFacingAnchor(client, zone, 'client'), { x: 293, y: 120 });
});

test('手机窄屏竖向拓扑使用服务器底边与客户端顶边作为链路锚点', () => {
  const zone = { left: 20, top: 250 };
  const server = { left: 55, right: 275, top: 20, bottom: 240, height: 220 };
  const client = { left: 55, right: 275, top: 370, bottom: 590, height: 220 };

  assert.deepEqual(getNetworkFacingAnchor(server, zone, 'server', true), { x: 145, y: -10 });
  assert.deepEqual(getNetworkFacingAnchor(client, zone, 'client', true), { x: 145, y: 120 });
});

test('手机窄屏在报文与字段表无法同屏时固定报文卡', () => {
  assert.deepEqual(
    getMobileTransferPlan(
      { top: 66, bottom: 188 },
      { top: 732, bottom: 927 },
      844,
    ),
    { docked: true, scrollDelta: 95 },
  );
  assert.deepEqual(
    getMobileTransferPlan(
      { top: 90, bottom: 211 },
      { top: 638, bottom: 832 },
      844,
    ),
    { docked: false, scrollDelta: 0 },
  );
});

test('手机播放报文前将完整网络舞台移入安全可视区', () => {
  assert.equal(
    getMobilePacketScrollTop(
      { top: -720, bottom: -63, height: 657 },
      995,
      844,
    ),
    209,
  );
  assert.equal(
    getMobilePacketScrollTop(
      { top: 66, bottom: 723, height: 657 },
      209,
      844,
    ),
    209,
  );
});

test('电脑端从控制区开始播放时也会先把网络舞台移入视野', async () => {
  const demo = Object.create(DHCPDemo.prototype);
  const previousWindow = global.window;
  const scrollCalls = [];
  demo.transitionId = 9;
  demo.isVerticalLayout = () => false;
  demo.dom = {
    stage: {
      getBoundingClientRect: () => ({ top: -146, bottom: 184, height: 330 }),
    },
  };
  global.window = {
    scrollY: 403,
    innerHeight: 768,
    scrollTo: (options) => scrollCalls.push(options),
    setTimeout: (callback) => callback(),
  };

  try {
    assert.equal(await demo.preparePacketViewport(9), true);
  } finally {
    global.window = previousWindow;
  }

  assert.deepEqual(scrollCalls, [{ top: 191, behavior: 'smooth' }]);
});

test('手机字段落位后先恢复原滚动位置，再解除报文停靠', async () => {
  const demo = Object.create(DHCPDemo.prototype);
  const classes = new Set(['is-transfer-docked']);
  const viewportState = { transition: 7, scrollY: 42 };
  const scrollCalls = [];
  const previousWindow = global.window;
  demo.transitionId = 7;
  demo.transferViewport = viewportState;
  demo.dom = {
    packet: {
      classList: {
        contains: (name) => classes.has(name),
        remove: (name) => classes.delete(name),
      },
    },
  };
  global.window = {
    scrollY: 561,
    scrollTo: (options) => scrollCalls.push(options),
    setTimeout: (callback) => callback(),
  };

  try {
    await demo.restoreFieldTransferViewport(7);
  } finally {
    global.window = previousWindow;
  }

  assert.deepEqual(scrollCalls, [{ top: 42, behavior: 'smooth' }]);
  assert.equal(classes.has('is-transfer-docked'), false);
  assert.equal(demo.transferViewport, null);
});

test('快速切换阶段时，被取消的旧动画不得清除新动画状态', async () => {
  const demo = Object.create(DHCPDemo.prototype);
  const stageClasses = new Set();
  const makeEndpoint = (x) => ({
    x,
    classList: { add() {}, remove() {} },
  });
  const animations = [];

  demo.speed = 1;
  demo.getEndpointPosition = (endpoint) => ({ x: endpoint.x, y: 0 });
  demo.dom = {
    stage: {
      classList: {
        add: (name) => stageClasses.add(name),
        remove: (name) => stageClasses.delete(name),
      },
    },
    packet: {
      style: {},
      animate() {
        let resolveFinished;
        let rejectFinished;
        const animation = {
          finished: new Promise((resolve, reject) => {
            resolveFinished = resolve;
            rejectFinished = reject;
          }),
          finish: () => resolveFinished(),
          cancel: () => {
            const error = new Error('cancelled');
            error.name = 'AbortError';
            rejectFinished(error);
          },
        };
        animations.push(animation);
        return animation;
      },
    },
  };

  const first = demo.animatePacket(makeEndpoint(0), makeEndpoint(100));
  const second = demo.animatePacket(makeEndpoint(100), makeEndpoint(0));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(demo.activeAnimation, animations[1]);
  assert.equal(stageClasses.has('is-moving'), true);

  animations[1].finish();
  await Promise.all([first, second]);
  assert.equal(demo.activeAnimation, null);
  assert.equal(stageClasses.has('is-moving'), false);
});

test('演示页面包含双端拓扑、四步时间轴、报文字段与播放控件', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  for (const id of [
    'dhcp-server',
    'dhcp-client',
    'packet-capsule',
    'packet-source-ip',
    'packet-destination-ip',
    'packet-source-mac',
    'packet-destination-mac',
    'step-track',
    'source-ip',
    'destination-ip',
    'source-mac',
    'destination-mac',
    'play-button',
    'previous-button',
    'next-button',
    'reset-button',
    'speed-control',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  assert.match(html, /DHCP DISCOVER/);
  assert.match(html, /DHCP OFFER/);
  assert.match(html, /DHCP REQUEST/);
  assert.match(html, /DHCP ACK/);
});

test('动画支持系统减少动效偏好', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion\s*:\s*reduce/);
});

test('手机窄屏为字段落表阶段提供固定报文样式', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /\.packet-capsule\.is-transfer-docked/);
});

test('首页将 DHCP 演示收录到计算机网络展厅', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(home, /href=["']DHCP工作过程\/index\.html["'][^>]*data-discipline=["']net["']/);
});
