/**
 * DNS 查询全景：域与区的划分及迭代/递归查询机制
 * 核心交互状态机与 60fps GSAP 动画引擎
 */

// 1. 域名树节点坐标配置 (基于左侧 SVG: 540 x 440)
const TREE_COORDS = {
  'root':    { x: 270, y: 42,  label: '根域 (.)', level: 0 },
  'org':     { x: 90,  y: 110, label: 'org (顶级域)', level: 1 },
  'com':     { x: 270, y: 110, label: 'com (顶级域)', level: 1 },
  'edu':     { x: 450, y: 110, label: 'edu (顶级域)', level: 1 },
  'abc':     { x: 195, y: 185, label: 'abc (二级域)', level: 2 },
  'xyz':     { x: 370, y: 185, label: 'xyz (二级域)', level: 2 },
  'x':       { x: 135, y: 265, label: 'x (三级域)', level: 3 },
  'y':       { x: 280, y: 265, label: 'y (三级域)', level: 3 },
  'u':       { x: 90,  y: 350, label: 'u (主机)', level: 4 },
  'v':       { x: 135, y: 350, label: 'v (主机)', level: 4 },
  'w':       { x: 180, y: 350, label: 'w (主机)', level: 4 },
  't':       { x: 280, y: 350, label: 't (目标主机)', level: 4 },
  'dns-xyz': { x: 340, y: 265, label: 'dns.xyz.com', level: 3 },
  'm-xyz':   { x: 410, y: 265, label: 'm.xyz.com', level: 3 }
};

// 2. 物理服务器拓扑节点坐标 (基于右侧 SVG: 540 x 460)
const TOPO_COORDS = {
  'client': { x: 120, y: 395, name: 'm.xyz.com' },
  'local':  { x: 120, y: 260, name: 'dns.xyz.com' },
  'root':   { x: 120, y: 75,  name: '根域名服务器' },
  'tld':    { x: 420, y: 75,  name: 'dns.com (TLD)' },
  'auth':   { x: 420, y: 260, name: 'dns.abc.com' },
  'authy':  { x: 420, y: 395, name: 'dns.y.abc.com' }
};

// 3. 全局状态容器
const State = {
  zoneMode: 'single',        // 'single' | 'two'
  queryMode: 'iterative',    // 'iterative' | 'recursive'
  targetHost: 't.y.abc.com', // 't.y.abc.com' | 'u.x.abc.com'
  currentStep: 0,
  totalSteps: 4,
  isPlaying: false,
  speed: 1.0,
  outboundCount: 0,
  playTimer: null,
  activeTimeline: null,
  steps: []
};

// 4. 时序步骤生成器 (严密覆盖 2种区划 x 2种查询 x 2种目标主机 = 8种场景)
function generateSteps(zoneMode, queryMode, targetHost) {
  const isTargetT = (targetHost === 't.y.abc.com');
  const steps = [];

  // ====================== 场景 A: 迭代查询 ======================
  if (queryMode === 'iterative') {
    if (isTargetT) {
      if (zoneMode === 'single') {
        // [迭代 · 单区 · t.y.abc.com] - 总计 4 步, 最终对外计数: 3 次
        steps.push({
          stepNum: 1,
          title: '客户端发起域名查询',
          desc: '主机 m.xyz.com 向本地域名服务器发起递归查询请求（RD=1）。本地 DNS 缓存未命中，启动对外迭代查询。本地对外计数保持为 0。',
          outboundTotal: 0,
          probeNode: 'root',
          probeLabel: '定位目标域: .',
          isFinal: false,
          flights: [
            { from: 'client', to: 'local', seq: '①', label: 'Query', summary: 'Query: t.y.abc.com', cable: 'cable-client-local' }
          ],
          inspector: { qr: 0, op: 0, aa: 0, rd: 1, an: 0, ns: 0, ar: 0, tag: '客户端请求', detail: 'Questions: t.y.abc.com (A记录), RD=1' }
        });

        steps.push({
          stepNum: 2,
          title: '本地 DNS 向根服务器查询',
          desc: '本地 DNS 向根服务器发出请求报文（本地节点徽标跳升至 1！）；左侧树指针锁定根节点 .；根服务器无法直答最终 IP，但识别 .com 顶级域，返回管辖 TLD 服务器地址。',
          outboundTotal: 1,
          probeNode: 'root',
          probeLabel: '锁定: . (根)',
          isFinal: false,
          flights: [
            { from: 'local', to: 'root', seq: '②', label: 'Query', summary: 'Query: t.y.abc.com', cable: 'cable-local-root' },
            { from: 'root', to: 'local', seq: '③', label: 'Referral', summary: 'Referral: TLD .com (dns.com)', cable: 'cable-local-root' }
          ],
          inspector: { qr: 1, op: 0, aa: 0, rd: 0, an: 0, ns: 1, ar: 1, tag: '根服务器推荐', detail: 'Authority: com NS dns.com; Additional: dns.com A 192.5.6.30' }
        });

        steps.push({
          stepNum: 3,
          title: '本地 DNS 向顶级 .com 查询',
          desc: '本地 DNS 向顶级服务器发出请求（本地节点徽标跳升至 2！）；左侧树指针滑移至 com 节点；顶级服务器返回二级域 abc.com 权限服务器地址。',
          outboundTotal: 2,
          probeNode: 'com',
          probeLabel: '匹配: com (顶级域)',
          isFinal: false,
          flights: [
            { from: 'local', to: 'tld', seq: '④', label: 'Query', summary: 'Query: t.y.abc.com', cable: 'cable-local-tld' },
            { from: 'tld', to: 'local', seq: '⑤', label: 'Referral', summary: 'Referral: Auth abc.com', cable: 'cable-local-tld' }
          ],
          inspector: { qr: 1, op: 0, aa: 0, rd: 0, an: 0, ns: 1, ar: 1, tag: '顶级服务器推荐', detail: 'Authority: abc.com NS dns.abc.com; Additional: A 198.51.100.2' }
        });

        steps.push({
          stepNum: 4,
          title: '权限服务器单区权威应答并送达',
          desc: '本地 DNS 向 abc.com 权限服务器发出请求（本地节点徽标跳升至 3！）；左侧树指针滑移至 abc 并直接探底锁定 t 节点全绿高亮！单区模式下直接拥有主机 t 的权威记录，返回最终 IP 并交付客户端（最终计数：3 次）。',
          outboundTotal: 3,
          probeNode: 't',
          probeLabel: '命中权威: t (已锁定)',
          isFinal: true,
          flights: [
            { from: 'local', to: 'auth', seq: '⑥', label: 'Query', summary: 'Query: t.y.abc.com', cable: 'cable-local-auth' },
            { from: 'auth', to: 'local', seq: '⑦', label: 'Answer', summary: 'Answer: IP 192.0.2.88 (AA=1)', cable: 'cable-local-auth' },
            { from: 'local', to: 'client', seq: '⑧', label: 'Answer', summary: 'Answer: Delivered to Client', cable: 'cable-client-local' }
          ],
          inspector: { qr: 1, op: 0, aa: 1, rd: 1, an: 1, ns: 1, ar: 0, tag: '权威应答命中', detail: 'Answer: t.y.abc.com A 192.0.2.88 (AA=1 权威应答, TTL=3600)' }
        });

      } else {
        // [迭代 · 两区 · t.y.abc.com] - 总计 5 步, 最终对外计数: 4 次
        steps.push({
          stepNum: 1,
          title: '客户端发起域名查询',
          desc: '主机 m.xyz.com 向本地 DNS 发起查询请求。本地 DNS 缓存未命中，启动对外迭代查询。本地对外计数保持为 0。',
          outboundTotal: 0,
          probeNode: 'root',
          probeLabel: '准备解析: .',
          isFinal: false,
          flights: [
            { from: 'client', to: 'local', seq: '①', label: 'Query', summary: 'Query: t.y.abc.com', cable: 'cable-client-local' }
          ],
          inspector: { qr: 0, op: 0, aa: 0, rd: 1, an: 0, ns: 0, ar: 0, tag: '客户端请求', detail: 'Questions: t.y.abc.com (A记录)' }
        });

        steps.push({
          stepNum: 2,
          title: '本地 DNS 向根服务器查询',
          desc: '本地 DNS 向根服务器发出请求（本地节点徽标跳升至 1！）；左侧树指针锁定根节点 .；根返回顶级 .com 服务器地址。',
          outboundTotal: 1,
          probeNode: 'root',
          probeLabel: '锁定: . (根)',
          isFinal: false,
          flights: [
            { from: 'local', to: 'root', seq: '②', label: 'Query', summary: 'Query: t.y.abc.com', cable: 'cable-local-root' },
            { from: 'root', to: 'local', seq: '③', label: 'Referral', summary: 'Referral: TLD .com (dns.com)', cable: 'cable-local-root' }
          ],
          inspector: { qr: 1, op: 0, aa: 0, rd: 0, an: 0, ns: 1, ar: 1, tag: '根服务器推荐', detail: 'Authority: com NS dns.com' }
        });

        steps.push({
          stepNum: 3,
          title: '本地 DNS 向顶级 .com 查询',
          desc: '本地 DNS 向顶级服务器发出请求（本地节点徽标跳升至 2！）；左侧树指针滑移至 com 节点；顶级返回 abc.com 权限服务器地址。',
          outboundTotal: 2,
          probeNode: 'com',
          probeLabel: '匹配: com (顶级域)',
          isFinal: false,
          flights: [
            { from: 'local', to: 'tld', seq: '④', label: 'Query', summary: 'Query: t.y.abc.com', cable: 'cable-local-tld' },
            { from: 'tld', to: 'local', seq: '⑤', label: 'Referral', summary: 'Referral: Auth abc.com', cable: 'cable-local-tld' }
          ],
          inspector: { qr: 1, op: 0, aa: 0, rd: 0, an: 0, ns: 1, ar: 1, tag: '顶级服务器推荐', detail: 'Authority: abc.com NS dns.abc.com' }
        });

        steps.push({
          stepNum: 4,
          title: '识别独立区：abc.com 委派重定向',
          desc: '本地 DNS 向 abc.com 发出请求（本地节点徽标跳升至 3！）；左侧树指针滑移至 abc 节点。两区模式下，abc 识别出 y 已独立成区并委派，返回委派给 dns.y.abc.com 的响应；报文飞回本地 DNS。',
          outboundTotal: 3,
          probeNode: 'abc',
          probeLabel: '匹配: abc (识别独立委派)',
          isFinal: false,
          flights: [
            { from: 'local', to: 'auth', seq: '⑥', label: 'Query', summary: 'Query: t.y.abc.com', cable: 'cable-local-auth' },
            { from: 'auth', to: 'local', seq: '⑦', label: 'Referral', summary: 'Referral: 委派 dns.y.abc.com', cable: 'cable-local-auth' }
          ],
          inspector: { qr: 1, op: 0, aa: 0, rd: 0, an: 0, ns: 1, ar: 1, tag: '委派授权响应', detail: 'Authority: y.abc.com NS dns.y.abc.com (已独立委派成区); Additional: dns.y.abc.com A 198.51.100.99' }
        });

        steps.push({
          stepNum: 5,
          title: '向独立区权限服务器查询并完成',
          desc: '本地 DNS 向 dns.y.abc.com 发出额外请求（本地节点徽标跳升至 4！）；左侧树指针跨区进入独立气泡锁定 t 节点全绿高亮！独立区服务器返回最终 IP，报文回送客户端（最终计数：4 次）。',
          outboundTotal: 4,
          probeNode: 't',
          probeLabel: '跨区命中权威: t',
          isFinal: true,
          flights: [
            { from: 'local', to: 'authy', seq: '⑧', label: 'Query', summary: 'Query: t.y.abc.com', cable: 'cable-local-authy' },
            { from: 'authy', to: 'local', seq: '⑨', label: 'Answer', summary: 'Answer: IP 192.0.2.88 (AA=1)', cable: 'cable-local-authy' },
            { from: 'local', to: 'client', seq: '⑩', label: 'Answer', summary: 'Answer: Delivered to Client', cable: 'cable-client-local' }
          ],
          inspector: { qr: 1, op: 0, aa: 1, rd: 1, an: 1, ns: 1, ar: 0, tag: '独立区权威命中', detail: 'Answer: t.y.abc.com A 192.0.2.88 (AA=1 独立区权威, TTL=3600)' }
        });
      }
    } else {
      // [迭代 · 对照目标 u.x.abc.com] - 无论单区还是两区，x 和 u 均在 abc.com 区内，总计 4 步, 最终对外计数: 3 次
      steps.push({
        stepNum: 1,
        title: '客户端发起 u.x.abc.com 查询',
        desc: '主机向本地 DNS 发起对 u.x.abc.com 的解析请求。本地对外计数为 0。',
        outboundTotal: 0,
        probeNode: 'root',
        probeLabel: '对照目标: u.x.abc.com',
        isFinal: false,
        flights: [
          { from: 'client', to: 'local', seq: '①', label: 'Query', summary: 'Query: u.x.abc.com', cable: 'cable-client-local' }
        ],
        inspector: { qr: 0, op: 0, aa: 0, rd: 1, an: 0, ns: 0, ar: 0, tag: '客户端请求', detail: 'Questions: u.x.abc.com (A记录)' }
      });

      steps.push({
        stepNum: 2,
        title: '本地 DNS 向根服务器查询',
        desc: '本地向根服务器查询（本地徽标跳升至 1！）；探针锁定根 .；根返回顶级 .com 服务器。',
        outboundTotal: 1,
        probeNode: 'root',
        probeLabel: '锁定: . (根)',
        isFinal: false,
        flights: [
          { from: 'local', to: 'root', seq: '②', label: 'Query', summary: 'Query: u.x.abc.com', cable: 'cable-local-root' },
          { from: 'root', to: 'local', seq: '③', label: 'Referral', summary: 'Referral: TLD .com', cable: 'cable-local-root' }
        ],
        inspector: { qr: 1, op: 0, aa: 0, rd: 0, an: 0, ns: 1, ar: 1, tag: '根推荐', detail: 'Authority: com NS dns.com' }
      });

      steps.push({
        stepNum: 3,
        title: '本地 DNS 向顶级 .com 查询',
        desc: '本地向顶级 .com 查询（本地徽标跳升至 2！）；探针滑移至 com；返回 abc.com 权限服务器。',
        outboundTotal: 2,
        probeNode: 'com',
        probeLabel: '匹配: com',
        isFinal: false,
        flights: [
          { from: 'local', to: 'tld', seq: '④', label: 'Query', summary: 'Query: u.x.abc.com', cable: 'cable-local-tld' },
          { from: 'tld', to: 'local', seq: '⑤', label: 'Referral', summary: 'Referral: Auth abc.com', cable: 'cable-local-tld' }
        ],
        inspector: { qr: 1, op: 0, aa: 0, rd: 0, an: 0, ns: 1, ar: 1, tag: '顶级推荐', detail: 'Authority: abc.com NS dns.abc.com' }
      });

      steps.push({
        stepNum: 4,
        title: '主区直接权威解析命中 (同区对照)',
        desc: '主机 u 隶属于 x 子域，未被独立委派，始终包含在 abc.com 主区内！dns.abc.com 直接权威应答最终 IP（本地徽标跳至 3！计数终止于 3 次，无需步骤 5）。',
        outboundTotal: 3,
        probeNode: 'u',
        probeLabel: '同区权威命中: u',
        isFinal: true,
        flights: [
          { from: 'local', to: 'auth', seq: '⑥', label: 'Query', summary: 'Query: u.x.abc.com', cable: 'cable-local-auth' },
          { from: 'auth', to: 'local', seq: '⑦', label: 'Answer', summary: 'Answer: IP 192.0.2.66 (AA=1)', cable: 'cable-local-auth' },
          { from: 'local', to: 'client', seq: '⑧', label: 'Answer', summary: 'Answer to Client', cable: 'cable-client-local' }
        ],
        inspector: { qr: 1, op: 0, aa: 1, rd: 1, an: 1, ns: 1, ar: 0, tag: '主区权威直接命中', detail: 'Answer: u.x.abc.com A 192.0.2.66 (x 子域未独立委派，同区直接应答)' }
      });
    }

  // ====================== 场景 B: 递归查询 ======================
  } else {
    // 递归查询：本地仅向根发出 1 次请求，后续链路层层代为询问，本地计数始终保持为 1！
    steps.push({
      stepNum: 1,
      title: '客户端发起递归查询',
      desc: '客户端向本地 DNS 发送查询请求，本地对外计数为 0。',
      outboundTotal: 0,
      probeNode: 'root',
      probeLabel: '就绪: 准备递归',
      isFinal: false,
      flights: [
        { from: 'client', to: 'local', seq: '①', label: 'Query', summary: 'Query: ' + targetHost + ' (RD=1)', cable: 'cable-client-local' }
      ],
      inspector: { qr: 0, op: 0, aa: 0, rd: 1, an: 0, ns: 0, ar: 0, tag: '客户端请求', detail: 'Questions: ' + targetHost + ' (RD=1 期望递归)' }
    });

    steps.push({
      stepNum: 2,
      title: '本地 DNS 开启递归调用链',
      desc: '本地 DNS 承担代理责任向根服务器请求（本地节点徽标跳升至 1！）；探针锁定根节点 .；根服务器进入递归处理。',
      outboundTotal: 1,
      probeNode: 'root',
      probeLabel: '锁定: . (根)',
      isFinal: false,
      flights: [
        { from: 'local', to: 'root', seq: '②', label: 'Query', summary: 'Recursive Query: ' + targetHost, cable: 'cable-local-root' }
      ],
      inspector: { qr: 0, op: 0, aa: 0, rd: 1, an: 0, ns: 0, ar: 0, tag: '本地代理发包', detail: '本地对外查询计数值更新为 1' }
    });

    steps.push({
      stepNum: 3,
      title: '击鼓传花：根代为向顶级 .com 查询',
      desc: '根服务器代劳向顶级服务器 dns.com 发起递归查询；探针滑向 com。关键考点：本地 DNS 保持静候，对外查询计数保持为 1 不再增加！',
      outboundTotal: 1,
      probeNode: 'com',
      probeLabel: '传递: com (顶级)',
      isFinal: false,
      flights: [
        { from: 'root', to: 'tld', seq: '③', label: 'Query', summary: 'Root -> TLD: ' + targetHost, cable: 'cable-root-tld' }
      ],
      inspector: { qr: 0, op: 0, aa: 0, rd: 1, an: 0, ns: 0, ar: 0, tag: '链式传递', detail: '由根服务器代为向下级顶级服务器发起请求' }
    });

    steps.push({
      stepNum: 4,
      title: '深度递归：顶级代向权限服务器查询',
      desc: '顶级服务器代向 abc.com 权限服务器发起查询；探针滑向 abc 节点。本地对外查询计数继续保持为 1。',
      outboundTotal: 1,
      probeNode: 'abc',
      probeLabel: '传递: abc (权限)',
      isFinal: false,
      flights: [
        { from: 'tld', to: 'auth', seq: '④', label: 'Query', summary: 'TLD -> Auth abc: ' + targetHost, cable: 'cable-tld-auth' }
      ],
      inspector: { qr: 0, op: 0, aa: 0, rd: 1, an: 0, ns: 0, ar: 0, tag: '链式传递', detail: '顶级代向二级域权限服务器 dns.abc.com 发起请求' }
    });

    if (zoneMode === 'two' && isTargetT) {
      // 两区模式下跨区递归多一步
      steps.push({
        stepNum: 5,
        title: '跨区递归：abc 代向独立区 y 查询',
        desc: 'dns.abc.com 识别出 y 独立成区，代为向独立区服务器 dns.y.abc.com 发起最终递归请求；探针跨区进入独立气泡锁定 t 节点。本地计数依然保持为 1！',
        outboundTotal: 1,
        probeNode: 't',
        probeLabel: '跨区击鼓传花: y -> t',
        isFinal: false,
        flights: [
          { from: 'auth', to: 'authy', seq: '⑤', label: 'Query', summary: 'Auth abc -> Auth y: ' + targetHost, cable: 'cable-auth-authy' }
        ],
        inspector: { qr: 0, op: 0, aa: 0, rd: 1, an: 0, ns: 0, ar: 0, tag: '跨区递归代理', detail: 'dns.abc.com 代向独立区权威 dns.y.abc.com 发送请求' }
      });

      steps.push({
        stepNum: 6,
        title: '原路逐级反向应答回送客户端',
        desc: '最终 IP 沿原路逐层倒序返回：dns.y -> dns.abc -> TLD -> 根 -> 本地 DNS -> 客户端。全过程本地域名服务器对外仅查询 1 次！',
        outboundTotal: 1,
        probeNode: 't',
        probeLabel: '锁定解析: t (回传完成)',
        isFinal: true,
        flights: [
          { from: 'authy', to: 'auth', seq: '⑥', label: 'Answer', summary: 'IP: 192.0.2.88', cable: 'cable-auth-authy' },
          { from: 'auth', to: 'tld', seq: '⑦', label: 'Answer', summary: 'Pass to TLD', cable: 'cable-tld-auth' },
          { from: 'tld', to: 'root', seq: '⑧', label: 'Answer', summary: 'Pass to Root', cable: 'cable-root-tld' },
          { from: 'root', to: 'local', seq: '⑨', label: 'Answer', summary: 'Pass to Local', cable: 'cable-local-root' },
          { from: 'local', to: 'client', seq: '⑩', label: 'Answer', summary: 'Deliver to Client', cable: 'cable-client-local' }
        ],
        inspector: { qr: 1, op: 0, aa: 1, rd: 1, an: 1, ns: 1, ar: 0, tag: '逐级原路返回', detail: 'Answer: t.y.abc.com A 192.0.2.88 逐层回送到客户端' }
      });

    } else {
      // 单区模式或 u.x 目标：在 abc 处命中并原路返回
      steps.push({
        stepNum: 5,
        title: '原路逐级反向应答回送客户端',
        desc: 'dns.abc.com 命中权威记录，沿链路原路返回：abc -> TLD -> 根 -> 本地 DNS -> 客户端。本地对外查询始终为 1 次。',
        outboundTotal: 1,
        probeNode: isTargetT ? 't' : 'u',
        probeLabel: '权威锁定 (原路返回)',
        isFinal: true,
        flights: [
          { from: 'auth', to: 'tld', seq: '⑤', label: 'Answer', summary: 'Auth -> TLD', cable: 'cable-tld-auth' },
          { from: 'tld', to: 'root', seq: '⑥', label: 'Answer', summary: 'TLD -> Root', cable: 'cable-root-tld' },
          { from: 'root', to: 'local', seq: '⑦', label: 'Answer', summary: 'Root -> Local', cable: 'cable-local-root' },
          { from: 'local', to: 'client', seq: '⑧', label: 'Answer', summary: 'Deliver to Client', cable: 'cable-client-local' }
        ],
        inspector: { qr: 1, op: 0, aa: 1, rd: 1, an: 1, ns: 1, ar: 0, tag: '逐级原路返回', detail: '最终 IP 沿链路逆序回传，本地对外计数维持 1 次' }
      });
    }
  }

  return steps;
}

// 5. 画布内原位计数指示器驱动 (弹性缩放 scale bounce)
function updateBadgeCounter(count, bounce = true) {
  const el = document.getElementById('counter-val');
  const badgeCard = document.getElementById('badge-counter-card');
  const hudNum = document.getElementById('hud-outbound-num');

  if (hudNum) hudNum.textContent = `${count} 次`;
  if (!el || !badgeCard) return;

  const currentDisplayed = parseInt(el.textContent, 10) || 0;
  el.textContent = count;

  if (bounce && count > currentDisplayed) {
    gsap.killTweensOf(badgeCard);
    gsap.fromTo(badgeCard,
      { scale: 1.45, transformOrigin: 'center center' },
      { scale: 1.0, duration: 0.55 / State.speed, ease: 'back.out(2.5)' }
    );
    gsap.fromTo(badgeCard,
      { fill: '#FEF3C7', stroke: '#D97706', strokeWidth: 3 },
      { fill: '#FFFFFF', stroke: '#D97706', strokeWidth: 1.8, duration: 0.6 / State.speed }
    );
  }
}

// 6. 区域划分视觉过渡 (GSAP 平滑驱动气泡与第 5 台服务器)
function applyZoneModeVisuals(zoneMode, immediate = false) {
  const bubbleAbc = document.getElementById('zone-bubble-abc');
  const tagBgAbc = document.getElementById('zone-tag-bg-abc');
  const tagTextAbc = document.getElementById('zone-tag-text-abc');
  const zoneGroupY = document.getElementById('zone-group-y');
  const serverYGroup = document.getElementById('server-y-group');
  const delegationGroup = document.getElementById('delegation-link-group');
  const cableAuthy = document.getElementById('cable-local-authy');
  const legendY = document.getElementById('legend-zone-y');
  const zoneStatusText = document.getElementById('zone-status-text');

  const dur = immediate ? 0 : 0.6 / State.speed;

  if (zoneMode === 'single') {
    // 单区模式：气泡包裹全部 abc 树（宽 275）
    gsap.to(bubbleAbc, {
      attr: { x: 55, y: 150, width: 275, height: 248 },
      duration: dur,
      ease: 'power2.inOut'
    });
    if (tagTextAbc) tagTextAbc.textContent = '区: abc.com (单区统管)';
    if (tagBgAbc) gsap.to(tagBgAbc, { attr: { width: 138 }, duration: dur });

    // 隐藏独立区 y 气泡
    gsap.to(zoneGroupY, {
      opacity: 0,
      scale: 0.85,
      transformOrigin: '287px 321px',
      duration: dur,
      ease: 'power2.in'
    });

    // 右侧拓扑：第 5 台服务器与其委派连线淡出
    if (serverYGroup) {
      gsap.to(serverYGroup, {
        opacity: 0,
        y: 15,
        scale: 0.9,
        duration: dur,
        ease: 'power2.in',
        onComplete: () => {
          serverYGroup.style.pointerEvents = 'none';
        }
      });
    }
    if (delegationGroup) {
      gsap.to(delegationGroup, { opacity: 0, duration: dur });
    }
    if (cableAuthy) gsap.to(cableAuthy, { opacity: 0.08, duration: dur });
    if (legendY) legendY.classList.add('opacity-40');
    if (zoneStatusText) {
      zoneStatusText.textContent = '当前划分：单区模式 (abc.com 统管全域)';
      zoneStatusText.className = 'text-amber-800 font-sans font-medium';
    }
  } else {
    // 两区模式：气泡 abc 收缩为只包裹 abc, x, u, v, w（宽 170）
    gsap.to(bubbleAbc, {
      attr: { x: 55, y: 150, width: 170, height: 248 },
      duration: dur,
      ease: 'power2.inOut'
    });
    if (tagTextAbc) tagTextAbc.textContent = '区 1: abc.com';
    if (tagBgAbc) gsap.to(tagBgAbc, { attr: { width: 85 }, duration: dur });

    // 分裂展现独立区 y 气泡
    gsap.fromTo(zoneGroupY,
      { opacity: 0, scale: 0.8 },
      { opacity: 1, scale: 1, transformOrigin: '287px 321px', duration: dur, ease: 'back.out(1.5)' }
    );

    // 右侧拓扑：第 5 台服务器与其委派连线淡入
    if (serverYGroup) {
      serverYGroup.style.pointerEvents = 'auto';
      gsap.fromTo(serverYGroup,
        { opacity: 0, y: 15, scale: 0.9 },
        { opacity: 1, y: 0, scale: 1.0, duration: dur, ease: 'back.out(1.6)' }
      );
    }
    if (delegationGroup) {
      gsap.to(delegationGroup, { opacity: 1, duration: dur });
    }
    if (cableAuthy) gsap.to(cableAuthy, { opacity: 0.7, duration: dur });
    if (legendY) legendY.classList.remove('opacity-40');
    if (zoneStatusText) {
      zoneStatusText.textContent = '当前划分：两区模式 (y.abc.com 独立委派成区)';
      zoneStatusText.className = 'text-emerald-800 font-sans font-medium';
    }
  }
}

// 7. 左侧树节点高亮管理
function highlightTreeNode(nodeId, isFinal) {
  // 恢复其余节点状态
  document.querySelectorAll('#tree-nodes .tree-node').forEach(node => {
    const circle = node.querySelector('circle');
    if (circle) {
      gsap.to(circle, { fill: '#FFFFFF', duration: 0.25 });
    }
  });

  const targetNode = document.getElementById(`node-${nodeId}`);
  if (!targetNode) return;

  const circle = targetNode.querySelector('circle');
  if (circle) {
    if (isFinal) {
      gsap.to(circle, { fill: '#D1FAE5', stroke: '#059669', strokeWidth: 3, duration: 0.35 });
    } else {
      gsap.to(circle, { fill: '#EFF6FF', stroke: '#2563EB', strokeWidth: 2.5, duration: 0.35 });
    }
  }
}

// 8. 寻址指示探针移动吸附
function moveSearchPointer(nodeId, labelText, isResolved = false) {
  const coords = TREE_COORDS[nodeId];
  if (!coords) return;

  const pointerEl = document.getElementById('search-pointer');
  const labelEl = document.getElementById('probe-label-text');
  const ringEl = document.getElementById('probe-pulse-ring');
  const resolvedBadge = document.getElementById('target-resolved-badge');
  const hudProbeNode = document.getElementById('hud-probe-node');

  if (hudProbeNode) hudProbeNode.textContent = coords.label || nodeId;

  gsap.killTweensOf(pointerEl);
  gsap.to(pointerEl, {
    x: coords.x,
    y: coords.y,
    duration: 0.65 / State.speed,
    ease: 'power2.out',
    onUpdate: () => {
      if (labelEl) labelEl.textContent = labelText;
    }
  });

  highlightTreeNode(nodeId, isResolved);

  if (isResolved) {
    if (ringEl) gsap.to(ringEl, { stroke: '#059669', duration: 0.3 });
    if (resolvedBadge) {
      gsap.killTweensOf(resolvedBadge);
      gsap.fromTo(resolvedBadge,
        { opacity: 0, scale: 0.6, x: coords.x, y: coords.y },
        { opacity: 1, scale: 1, duration: 0.55 / State.speed, ease: 'back.out(2)' }
      );
    }
  } else {
    if (ringEl) gsap.to(ringEl, { stroke: '#2563EB', duration: 0.3 });
    if (resolvedBadge) gsap.to(resolvedBadge, { opacity: 0, duration: 0.2 });
  }
}

// 9. 辅助函数：根据通信信道方向计算法向垂直偏移，生成带圈序号与悬浮提示
function createSeqBadge(flight, idx) {
  const start = TOPO_COORDS[flight.from];
  const end = TOPO_COORDS[flight.to];
  if (!start || !end) return null;

  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const normalX = -dy / len;
  const normalY = dx / len;

  // 沿法线方向微偏移，使往返序号互不遮挡
  const offsetDist = (idx % 2 === 1) ? 16 : -16;
  const posX = midX + normalX * offsetDist;
  const posY = midY + normalY * offsetDist;

  const badgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  badgeGroup.setAttribute('class', 'seq-badge');
  badgeGroup.setAttribute('transform', `translate(${posX}, ${posY})`);

  const isQuery = (flight.label === 'Query');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('r', '10');
  circle.setAttribute('fill', isQuery ? '#2563EB' : '#059669');
  circle.setAttribute('stroke', '#FFFFFF');
  circle.setAttribute('stroke-width', '1.5');
  circle.setAttribute('filter', 'url(#server-card-shadow)');

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dy', '3.5');
  text.setAttribute('font-size', '10');
  text.setAttribute('font-weight', '700');
  text.setAttribute('fill', '#FFFFFF');
  text.textContent = flight.seq;

  badgeGroup.appendChild(circle);
  badgeGroup.appendChild(text);

  // 鼠标悬停显示摘要
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = `${flight.seq} ${flight.summary}`;
  badgeGroup.appendChild(title);

  return badgeGroup;
}

// 10. 物理报文飞行轨迹与序号标记
function animatePacketFlights(flights, onComplete) {
  const packetEl = document.getElementById('flight-packet');
  const packetLabel = document.getElementById('flight-packet-label');
  const badgesContainer = document.getElementById('cable-seq-badges');

  if (!flights || flights.length === 0) {
    if (onComplete) onComplete();
    return;
  }

  // 顺序执行当前步骤的每一跳报文飞行
  let timeline = gsap.timeline({
    onComplete: () => {
      gsap.to(packetEl, { opacity: 0, duration: 0.2 });
      if (onComplete) onComplete();
    }
  });

  State.activeTimeline = timeline;

  flights.forEach((flight, idx) => {
    const start = TOPO_COORDS[flight.from];
    const end = TOPO_COORDS[flight.to];
    const cable = document.getElementById(flight.cable);

    if (!start || !end) return;

    // 飞行准备
    timeline.call(() => {
      if (packetLabel) packetLabel.textContent = flight.label.toUpperCase();
      if (cable) cable.classList.add('active-link');
    });

    // 报文实体飞行
    timeline.fromTo(packetEl,
      { x: start.x, y: start.y, opacity: 1, scale: 0.8 },
      {
        x: end.x,
        y: end.y,
        opacity: 1,
        scale: 1,
        duration: 0.65 / State.speed,
        ease: 'power1.inOut'
      }
    );

    // 落地瞬间在信道中间生成带圈序号与摘要
    timeline.call(() => {
      if (cable) cable.classList.remove('active-link');

      // 目标服务器微脉冲 (对内部 rect 进行描边微动画，严禁污染外层 group transform)
      let destRect = null;
      if (flight.to === 'authy') {
        destRect = document.getElementById('rect-authy-dns');
      } else {
        const destNode = document.getElementById(`node-${flight.to}`);
        if (destNode) destRect = destNode.querySelector('rect');
      }
      if (destRect) {
        gsap.fromTo(destRect,
          { strokeWidth: 3.5 },
          { strokeWidth: 1.8, duration: 0.35 / State.speed, ease: 'power2.out' }
        );
      }

      // 添加飞行路径序号标记
      const badgeGroup = createSeqBadge(flight, idx);
      if (badgeGroup && badgesContainer) {
        badgesContainer.appendChild(badgeGroup);
        gsap.fromTo(badgeGroup,
          { scale: 0.2, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.3 / State.speed, ease: 'back.out(2)' }
        );
      }
    });

    // 往返间的微小停顿
    if (idx < flights.length - 1) {
      timeline.to({}, { duration: 0.25 / State.speed });
    }
  });
}

// 10. 步骤进度指示器胶囊渲染
function renderProgressPills() {
  const container = document.getElementById('step-progress-pills');
  if (!container) return;
  container.innerHTML = '';

  for (let i = 1; i <= State.totalSteps; i++) {
    const pill = document.createElement('button');
    pill.className = `px-2 py-0.5 rounded text-[11px] font-mono transition-all ${
      i === State.currentStep
        ? 'bg-stone-900 text-white font-bold shadow-xs'
        : i < State.currentStep
        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
        : 'bg-stone-100 text-stone-500 border border-stone-200'
    }`;
    pill.textContent = `步 ${i}`;
    pill.onclick = () => {
      goToStep(i);
    };
    container.appendChild(pill);
  }
}

// 11. 更新 HUD 解说与报文显微镜
function updateHUD(stepData) {
  const pillEl = document.getElementById('hud-step-pill');
  const titleEl = document.getElementById('hud-step-title');
  const descEl = document.getElementById('hud-step-desc');

  if (pillEl) {
    pillEl.textContent = `步骤 ${State.currentStep} / ${State.totalSteps}`;
    if (State.currentStep === State.totalSteps) {
      pillEl.className = 'px-2.5 py-1 rounded bg-emerald-700 text-white text-xs font-mono font-bold shrink-0 shadow-sm';
    } else {
      pillEl.className = 'px-2.5 py-1 rounded bg-stone-800 text-white text-xs font-mono font-bold shrink-0 shadow-sm';
    }
  }
  if (titleEl) titleEl.textContent = stepData ? `【步骤 ${stepData.stepNum}】${stepData.title}` : '已复位至初始就绪态';
  if (descEl) descEl.textContent = stepData ? stepData.desc : '点击「自动演进」或「下一步」逐拍观察域名树匹配与物理报文交互拓扑。';

  // 显微镜字段更新
  if (stepData && stepData.inspector) {
    const insp = stepData.inspector;
    const tagEl = document.getElementById('inspector-tag');
    if (tagEl) tagEl.textContent = insp.tag;

    const qrEl = document.getElementById('dns-flag-qr');
    if (qrEl) qrEl.textContent = insp.qr === 0 ? '0 (Query 查询报文)' : '1 (Response 应答报文)';

    const aaEl = document.getElementById('dns-flag-aa');
    if (aaEl) aaEl.textContent = insp.aa === 1 ? '1 (权威应答 Authoritative)' : '0 (非权威/推荐应答)';

    const rdEl = document.getElementById('dns-flag-rd');
    if (rdEl) rdEl.textContent = insp.rd === 1 ? '1 (期望递归 Recursion Desired)' : '0 (迭代查询/无需递归)';

    const qnameEl = document.getElementById('dns-qname');
    if (qnameEl) qnameEl.textContent = State.targetHost;

    const ancountEl = document.getElementById('dns-ancount');
    if (ancountEl) ancountEl.textContent = insp.an;

    const nscountEl = document.getElementById('dns-nscount');
    if (nscountEl) nscountEl.textContent = insp.ns;

    const arcountEl = document.getElementById('dns-arcount');
    if (arcountEl) arcountEl.textContent = insp.ar;

    const detailEl = document.getElementById('dns-rr-detail');
    if (detailEl) detailEl.textContent = insp.detail;
  }
}

// 12. 执行指定步骤动画
function executeStep(stepIndex) {
  if (stepIndex < 1 || stepIndex > State.totalSteps) return;

  const stepData = State.steps[stepIndex - 1];
  if (!stepData) return;

  State.currentStep = stepIndex;
  renderProgressPills();
  updateHUD(stepData);

  // 1. 本地对外计数徽标弹性更新 (若本步有发包递增)
  updateBadgeCounter(stepData.outboundTotal, true);

  // 2. 左侧树探针滑移吸附
  moveSearchPointer(stepData.probeNode, stepData.probeLabel, stepData.isFinal);

  // 3. 右侧拓扑报文顺滑飞行
  animatePacketFlights(stepData.flights, () => {
    // 若处于自动播放模式且尚未到达最后一步，自动调度下一步
    if (State.isPlaying) {
      if (State.currentStep < State.totalSteps) {
        clearTimeout(State.playTimer);
        State.playTimer = setTimeout(() => {
          if (State.isPlaying) {
            executeStep(State.currentStep + 1);
          }
        }, 1200 / State.speed);
      } else {
        stopPlay();
      }
    }
  });
}

// 13. 前往特定步骤
function goToStep(stepIndex) {
  // 防呆：清理前序所有 GSAP 补间与计时器
  if (window.gsap) gsap.killTweensOf('*');
  clearTimeout(State.playTimer);
  State.activeTimeline = null;

  // 清除旧的飞行轨迹序号徽标
  const badgesContainer = document.getElementById('cable-seq-badges');
  if (badgesContainer) badgesContainer.innerHTML = '';

  // 恢复之前各步骤的序号徽标
  for (let i = 0; i < stepIndex - 1; i++) {
    const prevStep = State.steps[i];
    if (prevStep && prevStep.flights) {
      prevStep.flights.forEach((flight, idx) => {
        const badgeGroup = createSeqBadge(flight, idx);
        if (badgeGroup && badgesContainer) {
          badgesContainer.appendChild(badgeGroup);
        }
      });
    }
  }

  executeStep(stepIndex);
}

// 14. 播放控制：开始 / 停止 / 单步 / 复位
function startPlay() {
  State.isPlaying = true;
  const playIcon = document.getElementById('play-icon');
  const playText = document.getElementById('play-text');
  if (playIcon) playIcon.textContent = '⏸';
  if (playText) playText.textContent = '暂停演进';

  if (State.currentStep >= State.totalSteps) {
    resetState();
  }

  executeStep(State.currentStep === 0 ? 1 : State.currentStep);
}

function stopPlay() {
  State.isPlaying = false;
  clearTimeout(State.playTimer);
  const playIcon = document.getElementById('play-icon');
  const playText = document.getElementById('play-text');
  if (playIcon) playIcon.textContent = '▶';
  if (playText) playText.textContent = '自动演进';
}

function togglePlay() {
  if (State.isPlaying) {
    stopPlay();
  } else {
    startPlay();
  }
}

function stepNext() {
  stopPlay();
  if (State.currentStep < State.totalSteps) {
    goToStep(State.currentStep + 1);
  }
}

function stepPrev() {
  stopPlay();
  if (State.currentStep > 1) {
    goToStep(State.currentStep - 1);
  } else {
    resetState();
  }
}

function resetState() {
  stopPlay();
  if (window.gsap) gsap.killTweensOf('*');
  clearTimeout(State.playTimer);
  State.activeTimeline = null;
  State.currentStep = 0;

  // 隐藏飞行报文
  const packetEl = document.getElementById('flight-packet');
  if (packetEl) gsap.to(packetEl, { opacity: 0, duration: 0.2 });

  // 清空信道序号徽标
  const badgesContainer = document.getElementById('cable-seq-badges');
  if (badgesContainer) badgesContainer.innerHTML = '';

  // 复位计数器
  updateBadgeCounter(0, false);

  // 复位探针至根节点就绪态
  moveSearchPointer('root', '就绪: 准备解析', false);

  // 隐藏目标达成标志
  const resolvedBadge = document.getElementById('target-resolved-badge');
  if (resolvedBadge) gsap.to(resolvedBadge, { opacity: 0, duration: 0.2 });

  // 恢复所有树节点颜色
  document.querySelectorAll('#tree-nodes .tree-node circle').forEach(c => {
    gsap.to(c, { fill: '#FFFFFF', duration: 0.2 });
  });

  renderProgressPills();
  updateHUD(null);
}

// 15. 模式同步与重新生成
function syncConfiguration(options = {}) {
  resetState();

  if (options.zoneMode) State.zoneMode = options.zoneMode;
  if (options.queryMode) State.queryMode = options.queryMode;
  if (options.targetHost) State.targetHost = options.targetHost;

  // 生成时序序列
  State.steps = generateSteps(State.zoneMode, State.queryMode, State.targetHost);
  State.totalSteps = State.steps.length;

  // 平滑过渡区划视图
  applyZoneModeVisuals(State.zoneMode, false);

  // 更新右上角查询模式标识
  const modeBadge = document.getElementById('active-query-mode-badge');
  if (modeBadge) {
    modeBadge.textContent = State.queryMode === 'iterative' ? '迭代查询模式 (跑腿逐级)' : '递归查询模式 (链式传递)';
    modeBadge.className = State.queryMode === 'iterative'
      ? 'px-2 py-0.5 rounded bg-amber-50 text-amber-800 font-semibold border border-amber-200'
      : 'px-2 py-0.5 rounded bg-blue-50 text-blue-800 font-semibold border border-blue-200';
  }

  // 递归连线透明度提示
  const recurCables = document.getElementById('recursive-cables');
  if (recurCables) {
    gsap.to(recurCables, {
      opacity: State.queryMode === 'recursive' ? 0.9 : 0.2,
      duration: 0.4
    });
  }

  renderProgressPills();
}

// 16. 事件监听与界面交互绑定
function initEvents() {
  // 1. 区域划分按钮
  const btnSingle = document.getElementById('btn-mode-single');
  const btnTwo = document.getElementById('btn-mode-two');

  btnSingle.onclick = () => {
    btnSingle.classList.add('active-mode');
    btnTwo.classList.remove('active-mode');
    syncConfiguration({ zoneMode: 'single' });
  };
  btnTwo.onclick = () => {
    btnTwo.classList.add('active-mode');
    btnSingle.classList.remove('active-mode');
    syncConfiguration({ zoneMode: 'two' });
  };

  // 2. 查询机制按钮
  const btnIter = document.getElementById('btn-query-iter');
  const btnRecur = document.getElementById('btn-query-recur');

  btnIter.onclick = () => {
    btnIter.classList.add('active-mode');
    btnRecur.classList.remove('active-mode');
    syncConfiguration({ queryMode: 'iterative' });
  };
  btnRecur.onclick = () => {
    btnRecur.classList.add('active-mode');
    btnIter.classList.remove('active-mode');
    syncConfiguration({ queryMode: 'recursive' });
  };

  // 3. 目标主机按钮
  const btnTargetT = document.getElementById('btn-target-t');
  const btnTargetU = document.getElementById('btn-target-u');

  btnTargetT.onclick = () => {
    btnTargetT.classList.add('active-mode');
    btnTargetU.classList.remove('active-mode');
    syncConfiguration({ targetHost: 't.y.abc.com' });
  };
  btnTargetU.onclick = () => {
    btnTargetU.classList.add('active-mode');
    btnTargetT.classList.remove('active-mode');
    syncConfiguration({ targetHost: 'u.x.abc.com' });
  };

  // 4. 播放控制按钮
  document.getElementById('btn-play-toggle').onclick = togglePlay;
  document.getElementById('btn-next').onclick = stepNext;
  document.getElementById('btn-prev').onclick = stepPrev;
  document.getElementById('btn-reset').onclick = resetState;

  // 5. 速率滑块
  const speedSlider = document.getElementById('slider-speed');
  const speedLabel = document.getElementById('speed-label');
  speedSlider.oninput = (e) => {
    State.speed = parseFloat(e.target.value);
    speedLabel.textContent = `${State.speed.toFixed(1)}x`;
  };

  // 6. 点击树节点触发探索反馈
  document.querySelectorAll('#tree-nodes .tree-node').forEach(node => {
    node.onclick = () => {
      const rawId = node.id.replace('node-', '');
      if (TREE_COORDS[rawId]) {
        moveSearchPointer(rawId, `选中: ${rawId}`, rawId === 't' || rawId === 'u');
      }
    };
  });
}

// 17. 页面启动自检与初始化
document.addEventListener('DOMContentLoaded', () => {
  initEvents();
  syncConfiguration({
    zoneMode: 'single',
    queryMode: 'iterative',
    targetHost: 't.y.abc.com'
  });
});
