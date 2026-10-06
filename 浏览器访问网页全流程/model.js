/* 纯数据模型：每一步的完成状态可独立重建，回退不会留下未来结果。 */
(function (root) {
  'use strict';
  const URL_PARTS = { scheme: 'https://', host: 'learn.example', path: '/net/index.html', query: '?chapter=4', fragment: '#tcp' };
  const IP = '203.0.113.20';
  const REQUEST = 'GET /net/index.html?chapter=4 HTTP/1.1\nHost: learn.example\nAccept: text/html';
  const HTML = '<link rel="stylesheet" href="/site.css">\n<h1 id="tcp">网络学习笔记</h1>\n<p>一次访问，从域名走到页面。</p>\n<img src="/network.svg" width="240" height="80">\n<p id="welcome">页面已显示，脚本尚未更新提示。</p>\n<script defer src="/app.js"></script>';
  const PHASES = [
    { name: '解析网址', short: 'URL', start: 0, output: '主机名与资源路径', detail: 'https 决定使用安全连接，默认目标端口为 443。DNS 只处理主机名；HTTP 负责路径与查询参数；#tcp 不随请求发送，浏览器用它定位页面中的元素。' },
    { name: '找到服务器', short: 'DNS', start: 2, output: '目标 IP 地址', detail: '图中的 DNS 是递归解析器。它可能直接命中缓存，也可能继续查询根、顶级域和权威服务器。主线将其内部工作概括成一次查询、一次应答。DNS 也支持 IPv6；这里只取一个示意 IPv4 地址。' },
    { name: '建立连接', short: 'TCP', start: 4, output: '可靠的双向连接', detail: '客户端初始序号 x=100，服务器 y=700。SYN 各占用一个序号；不携带数据的 ACK 不占用序号。第三次握手发出后客户端可进入 ESTABLISHED，服务器收到后也进入 ESTABLISHED。' },
    { name: '保护通信', short: 'TLS', start: 7, output: '认证与加密通道', detail: '采用 TLS 1.3 的简化消息组。服务端消息包含证书和握手证明；客户端检查证书链、域名和签名。双方通过密钥协商派生流量密钥，随后交换受保护的数据。图中不逐条展示记录、可选消息和分片。' },
    { name: '获取文档', short: 'HTTP', start: 10, output: 'HTML 文档', detail: '面板展示应用层读取的明文；网络上传输的 HTTP 内容由 TLS 保护。200 OK 是成功响应，Content-Type 描述内容类型。HTML 中的资源引用不会自动把对应文件一起装入这次响应。' },
    { name: '呈现页面', short: '渲染', start: 12, output: '屏幕上的网页', detail: 'HTML 构建 DOM，CSS 构建 CSSOM，计算样式后进行布局和绘制。本例用一条持久连接依次获取资源；实际下载、解析与渲染可以交叠。defer 保证脚本在文档解析完成后执行，不保证首次绘制在它之前。本例选择先展示绘制结果，再观察脚本更新；首屏也不必等待所有资源到齐。' }
  ];
  function step(phase, title, why, result, next, extra) { return Object.assign({ phase, title, why, result, next }, extra); }
  const STEPS = [
    step(0, '在地址栏按下回车', '浏览器拿到的是一段网址，还不知道该联系哪台服务器。', '本次导航开始，页面仍是空白。', '先把网址拆成不同用途的部分。'),
    step(0, '拆出主机名和资源路径', '找哪台服务器，与向它索取什么，是两个问题。', '主机名交给 DNS；路径与查询参数留给 HTTP。', '先将 learn.example 解析为 IP。', { unlock: 'url' }),
    step(1, '向 DNS 询问目标地址', 'IP 网络需要目标 IP，只有域名还不能连接网站。', '递归解析器收到 learn.example 的 A 记录查询。', '等待解析结果；这里还没有请求网页。', { from: 'browser', to: 'dns', label: 'DNS 查询：learn.example 的 A 记录？', sub: '客户端 → 递归解析器 · 传统 DNS / UDP 53' }),
    step(1, '接收 DNS 应答', '解析器负责查出这个主机名对应的地址。', '拿到示意地址 203.0.113.20，并暂存解析结果。', '用这个 IP 联系网站的 443 端口。', { from: 'dns', to: 'browser', label: 'DNS 应答：203.0.113.20', sub: '递归解析器 → 客户端 · 得到地址，未得到网页', unlock: 'ip' }),
    step(2, '① 客户端发送 SYN', 'IP 已知，但双方还没有建立 TCP 连接。', '客户端处于 SYN-SENT；服务器收到连接请求。', '服务器确认，并告知自己的初始序号。', { from: 'browser', to: 'server', label: 'SYN · seq = 100', sub: '客户端临时端口 → 203.0.113.20 : 443' }),
    step(2, '② 服务器返回 SYN + ACK', '双方都要同步初始序号，并确认对方的发送能力。', '服务器处于 SYN-RECEIVED；ack=101 确认客户端 SYN。', '客户端再确认服务器的 SYN。', { from: 'server', to: 'browser', label: 'SYN + ACK · seq = 700，ack = 101', sub: '服务器 → 客户端 · SYN 各占一个序号' }),
    step(2, '③ 客户端发送 ACK', '服务器需要知道自己的 SYN 已被客户端收到。', 'ACK 到达后，双方都进入 ESTABLISHED。', '现在有可靠连接；HTTPS 还需要 TLS。', { from: 'browser', to: 'server', label: 'ACK · seq = 101，ack = 701', sub: '客户端 → 服务器 · TCP 三次握手完成', unlock: 'tcp' }),
    step(3, '客户端发起 TLS 协商', 'TCP 提供可靠传输，但还未提供网站身份认证和内容保护。', '服务器收到 ClientHello，包含支持参数与密钥协商信息。', '服务器返回协商结果及身份证明。', { from: 'browser', to: 'server', label: 'ClientHello · 协商参数 + 密钥份额', sub: 'TLS 1.3 · 简化消息组 ①' }),
    step(3, '服务器返回身份证明', '浏览器要确认自己连到的是网址所指的网站。', '客户端收到 ServerHello、证书、签名证明与 Finished。', '验证证书及握手证明，完成客户端确认。', { from: 'server', to: 'browser', label: 'ServerHello + 证书与证明 + Finished', sub: 'TLS 1.3 · 简化消息组 ②，不表示单个数据包' }),
    step(3, '验证通过，完成 TLS 握手', '身份验证通过后，双方才能使用协商所得密钥保护通信。', '客户端 Finished 到达；安全通道就绪。', '在这条通道中发送 HTTP 请求。', { from: 'browser', to: 'server', label: '验证证书 ✓ · 客户端 Finished', sub: 'TLS 1.3 · 简化消息组 ③', unlock: 'tls' }),
    step(4, '发送 HTTP 请求', '连接已经就绪，现在才告诉网站“我要哪份文档”。', '服务器收到路径 /net/index.html 与查询 chapter=4。', '服务器处理请求并返回 HTML。', { from: 'browser', to: 'server', label: 'GET /net/index.html?chapter=4', sub: 'HTTP/1.1 · 在 TLS 保护的连接中发送' }),
    step(4, '接收 HTML 响应', '服务器根据请求返回状态、响应头和文档正文。', '200 OK；收到 HTML，尚未等于完整网页。', '解析 HTML，发现它还引用了哪些资源。', { from: 'server', to: 'browser', label: 'HTTP/1.1 200 OK · text/html', sub: '响应正文：HTML 文档 · CSS / 图片 / JS 另行获取', unlock: 'html' }),
    step(5, '解析 HTML，发现资源引用', 'HTML 是结构描述。浏览器需要把标签组织成 DOM，并发现外部资源。', 'DOM 初步建立；发现 site.css、network.svg 和 app.js。', '通过已建立的连接获取 CSS。', { unlock: 'dom' }),
    step(5, '请求样式文件', 'HTML 里的 link 只是一个引用，CSS 内容还未下载。', '服务器收到 GET /site.css。', '收到样式后建立 CSSOM。', { from: 'browser', to: 'server', label: 'GET /site.css', sub: '同源资源 · 复用既有 TCP + TLS 连接' }),
    step(5, '接收 CSS，建立 CSSOM', '浏览器需要样式规则，才能计算元素的外观。', 'CSS 已到达，样式规则可用于后续渲染。', '继续获取文档引用的图片。', { from: 'server', to: 'browser', label: '200 OK · text/css', sub: 'h1 { color: #2563eb; } · .page { padding: 20px; }', unlock: 'css' }),
    step(5, '请求图片', 'img 标签中的 src 指向另一份资源。', '服务器收到 GET /network.svg。', '接收图片内容。', { from: 'browser', to: 'server', label: 'GET /network.svg', sub: '同一持久连接中的下一次请求' }),
    step(5, '接收图片内容', '图片的内容也要通过独立的 HTTP 响应到达。', '图片已可解码；本例预设了宽高以保留布局空间。', '获取 defer 脚本。', { from: 'server', to: 'browser', label: '200 OK · image/svg+xml', sub: '资源到达 · 不代表页面已完成绘制', unlock: 'image' }),
    step(5, '请求脚本文件', 'script 的 src 指向脚本内容；defer 允许先继续解析文档。', '服务器收到 GET /app.js。', '接收脚本；下载完成与执行是两件事。', { from: 'browser', to: 'server', label: 'GET /app.js', sub: 'defer 脚本 · 文档解析期间可以下载' }),
    step(5, '接收脚本，等待执行', 'defer 脚本要在文档解析完成后按顺序执行。', '脚本已下载；示例逻辑将修改页面提示文字。', '观察 DOM 与 CSSOM 如何决定页面外观。', { from: 'server', to: 'browser', label: '200 OK · text/javascript', sub: '脚本准备就绪 · 此刻尚未执行', unlock: 'js' }),
    step(5, '计算样式：结构 + 样式规则', 'DOM 回答“有什么”，CSSOM 回答“长什么样”。', '为可见元素计算样式，准备渲染结构。', '计算每个元素在视口中的位置和大小。', { unlock: 'style' }),
    step(5, '布局：确定每个盒子的位置', '知道颜色和字体还不够，必须确定元素几何位置。', '标题、段落与图片的尺寸和位置已确定。', '将这些可见内容绘制到屏幕。', { unlock: 'layout' }),
    step(5, '绘制：页面第一次变得可见', '布局结果需要转换为实际可显示的内容。', '标题、样式和图片显示出来。', '示例 defer 脚本还会更新页面内容。', { unlock: 'paint' }),
    step(5, '执行脚本，更新页面', '脚本可以修改 DOM，引发后续样式、布局或绘制。', '提示变为“欢迎回来”，页面在屏幕上完成更新。', '已串起：域名 → IP → 可靠连接 → 安全通道 → 文档 → 页面。', { unlock: 'complete' })
  ];
  function snapshot(index) {
    const state = { url: false, ip: false, tcp: false, tls: false, html: false, dom: false, css: false, image: false, js: false, render: 'blank', client: 'CLOSED', server: 'LISTEN' };
    for (let i = 0; i <= Math.min(index, STEPS.length - 1); i++) {
      const key = STEPS[i].unlock;
      if (key && ['style','layout','paint','complete'].includes(key)) state.render = key;
      else if (key) state[key] = true;
      if (i === 4) state.client = 'SYN-SENT';
      if (i === 5) state.server = 'SYN-RECEIVED';
      if (i === 6) state.client = state.server = 'ESTABLISHED';
    }
    return state;
  }
  const api = { URL_PARTS, IP, REQUEST, HTML, PHASES, STEPS, snapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WebJourney = api;
})(typeof window === 'undefined' ? globalThis : window);
