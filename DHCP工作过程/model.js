/**
 * DHCP DORA 四步报文的地址模型。纯计算，不碰 DOM；界面只读取这里算出的报文字段、变化标记与主机状态。
 * 场景：一台刚接入的客户端（尚无 IP）与一台 DHCP 服务器位于同一以太网段。
 * 依据：RFC 2131 §4.1 规定广播标志决定 OFFER／ACK 的目的地址；§4.3.2 规定 SELECTING 状态下 REQUEST 的
 * ciaddr 必须为 0、选项 50 填 yiaddr、选项 54 填选中的服务器；选项编号见 RFC 2132。
 */
(function (root) {
  'use strict';

  const BROADCAST_IP = '255.255.255.255';
  const BROADCAST_MAC = 'FF:FF:FF:FF:FF:FF';
  const UNSPECIFIED_IP = '0.0.0.0';
  const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
  // 对照表与信封中会比较变化的地址行
  const ADDRESS_ROWS = ['ethSrc', 'ethDst', 'ipSrc', 'ipDst', 'yiaddr', 'optionAddresses'];

  const DEFAULTS = Object.freeze({
    clientMac: '08:00:27:6A:9C:21',
    serverMac: '52:54:00:12:34:56',
    serverIp: '192.168.1.1',
    offeredIp: '192.168.1.100',
    subnetMask: '255.255.255.0',
    router: '192.168.1.1',
    leaseSeconds: 28800,
    xid: '0x4A3F21C8',
    broadcastFlag: true
  });

  function checkIp(value, name) {
    const m = IP_RE.exec(value);
    if (!m || m.slice(1).some((n) => Number(n) > 255)) throw new RangeError(`${name} 不是合法的 IPv4 地址`);
    return value;
  }

  function checkMac(value, name) {
    if (!MAC_RE.test(value)) throw new RangeError(`${name} 必须是大写的六组十六进制 MAC 地址`);
    return value;
  }

  // 两端主机在各个节点后显示的状态（标题 + 说明）；客户端的 ip 字段只在收到 ACK 后才是分配的地址
  function stateTexts(params) {
    const { offeredIp, serverIp, leaseSeconds } = params;
    const hours = leaseSeconds / 3600;
    return {
      client: {
        init: { title: '无地址', detail: '尚未发出任何报文', ip: UNSPECIFIED_IP },
        discover: { title: '已广播 DISCOVER', detail: '等待服务器的 OFFER', ip: UNSPECIFIED_IP },
        offer: { title: '收到 OFFER', detail: `选中 ${serverIp} 的报价`, ip: UNSPECIFIED_IP },
        request: { title: '已广播 REQUEST', detail: `请求 ${offeredIp}`, ip: UNSPECIFIED_IP },
        ack: { title: '地址生效', detail: `租期 ${hours} 小时`, ip: offeredIp }
      },
      server: {
        init: { title: '待机', detail: '地址池可用' },
        discover: { title: '预留地址', detail: offeredIp },
        offer: { title: '已发 OFFER', detail: '等待客户端选择' },
        request: { title: '校验选择', detail: '选项 54 指向本机' },
        ack: { title: '已租出', detail: `${offeredIp} · ${hours} 小时` }
      }
    };
  }

  // 相邻两个报文之间，哪些地址行发生了变化
  function changedFields(prev, cur) {
    const out = {};
    for (const key of ADDRESS_ROWS) out[key] = prev[key] !== cur[key];
    return out;
  }

  function buildExchange(overrides) {
    const params = { ...DEFAULTS, ...(overrides || {}) };
    checkMac(params.clientMac, 'clientMac');
    checkMac(params.serverMac, 'serverMac');
    ['serverIp', 'offeredIp', 'subnetMask', 'router'].forEach((key) => checkIp(params[key], key));
    if (!Number.isInteger(params.leaseSeconds) || params.leaseSeconds < 1) {
      throw new RangeError('leaseSeconds 必须是正整数');
    }

    // 客户端的 DISCOVER、REQUEST 永远广播（它还没有地址）；广播标志只影响服务器的回复方式
    const common = {
      xid: params.xid,
      chaddr: params.clientMac,
      ciaddr: UNSPECIFIED_IP,
      flags: { broadcast: params.broadcastFlag ? 1 : 0 }
    };
    const reply = params.broadcastFlag
      ? { delivery: 'broadcast', ethDst: BROADCAST_MAC, ipDst: BROADCAST_IP }
      : { delivery: 'unicast', ethDst: params.clientMac, ipDst: params.offeredIp };
    const serverOptions = (type) => [
      { code: 53, name: '报文类型', value: type },
      { code: 54, name: '服务器标识', value: params.serverIp },
      { code: 51, name: '租期', value: `${params.leaseSeconds} 秒` },
      { code: 1, name: '子网掩码', value: params.subnetMask },
      { code: 3, name: '网关', value: params.router }
    ];

    const raw = [
      {
        key: 'discover', type: 'DHCP DISCOVER', op: 'BOOTREQUEST', sender: 'client', receiver: 'server',
        delivery: 'broadcast', ethSrc: params.clientMac, ethDst: BROADCAST_MAC,
        ipSrc: UNSPECIFIED_IP, ipDst: BROADCAST_IP, udp: { src: 68, dst: 67 }, yiaddr: UNSPECIFIED_IP,
        options: [{ code: 53, name: '报文类型', value: 'DHCPDISCOVER' }]
      },
      {
        key: 'offer', type: 'DHCP OFFER', op: 'BOOTREPLY', sender: 'server', receiver: 'client', ...reply,
        ethSrc: params.serverMac, ipSrc: params.serverIp, udp: { src: 67, dst: 68 },
        yiaddr: params.offeredIp, options: serverOptions('DHCPOFFER')
      },
      {
        key: 'request', type: 'DHCP REQUEST', op: 'BOOTREQUEST', sender: 'client', receiver: 'server',
        delivery: 'broadcast', ethSrc: params.clientMac, ethDst: BROADCAST_MAC,
        ipSrc: UNSPECIFIED_IP, ipDst: BROADCAST_IP, udp: { src: 68, dst: 67 }, yiaddr: UNSPECIFIED_IP,
        options: [
          { code: 53, name: '报文类型', value: 'DHCPREQUEST' },
          { code: 50, name: '请求地址', value: params.offeredIp },
          { code: 54, name: '服务器标识', value: params.serverIp }
        ]
      },
      {
        key: 'ack', type: 'DHCP ACK', op: 'BOOTREPLY', sender: 'server', receiver: 'client', ...reply,
        ethSrc: params.serverMac, ipSrc: params.serverIp, udp: { src: 67, dst: 68 },
        yiaddr: params.offeredIp, options: serverOptions('DHCPACK')
      }
    ].map((pkt) => ({ ...common, ...pkt }));

    // 对照表与信封使用的地址行（方向只用于展示，不参与变化判定）
    const packets = raw.map((pkt) => {
      const who = pkt.sender === 'client' ? '客户端' : '服务器';
      const dest = pkt.delivery === 'broadcast' ? '广播' : '单播';
      return {
        ...pkt,
        rows: {
          direction: `${who} → ${dest}`,
          ethSrc: pkt.ethSrc,
          ethDst: pkt.ethDst,
          ipSrc: pkt.ipSrc,
          ipDst: pkt.ipDst,
          yiaddr: pkt.yiaddr,
          optionAddresses: pkt.options
            .filter((o) => o.code === 50 || o.code === 54)
            .map((o) => `${o.code} = ${o.value}`)
            .join(' · ') || '—'
        },
        optionCodes: pkt.options.map((o) => o.code)
      };
    });
    packets.forEach((pkt, i) => {
      pkt.changes = i === 0 ? null : changedFields(packets[i - 1].rows, pkt.rows);
      pkt.footer = `xid ${pkt.xid} · B=${pkt.flags.broadcast} · 选项 ${pkt.optionCodes.join(', ')}`;
    });

    return { params, packets, states: stateTexts(params) };
  }

  const api = { DEFAULTS, BROADCAST_IP, BROADCAST_MAC, UNSPECIFIED_IP, buildExchange, changedFields, stateTexts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DhcpModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
