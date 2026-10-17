const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('./model.js');

const B1 = model.buildExchange();
const B0 = model.buildExchange({ broadcastFlag: false });
const [discover, offer, request, ack] = B1.packets;
const P = B1.params;
const BROADCAST_MAC = model.BROADCAST_MAC;
const BROADCAST_IP = model.BROADCAST_IP;

test('四个报文按 DISCOVER、OFFER、REQUEST、ACK 排列，方向在客户端与服务器之间交替', () => {
  assert.deepEqual(B1.packets.map((p) => p.type), ['DHCP DISCOVER', 'DHCP OFFER', 'DHCP REQUEST', 'DHCP ACK']);
  assert.deepEqual(B1.packets.map((p) => p.sender), ['client', 'server', 'client', 'server']);
  assert.deepEqual(B1.packets.map((p) => p.receiver), ['server', 'client', 'server', 'client']);
});

test('DISCOVER：客户端还没有地址，源 IP 为 0.0.0.0，目的 IP 与目的 MAC 都是广播', () => {
  assert.equal(discover.ethSrc, P.clientMac);
  assert.equal(discover.ethDst, BROADCAST_MAC);
  assert.equal(discover.ipSrc, '0.0.0.0');
  assert.equal(discover.ipDst, BROADCAST_IP);
  assert.deepEqual(discover.udp, { src: 68, dst: 67 });
  assert.equal(discover.yiaddr, '0.0.0.0');
  assert.deepEqual(discover.options, [{ code: 53, name: '报文类型', value: 'DHCPDISCOVER' }]);
  assert.equal(discover.changes, null, '第一个报文没有前一报文可比较');
});

test('OFFER：源 IP 与源 MAC 换成服务器，目的仍是广播，yiaddr 携带待分配的地址', () => {
  assert.equal(offer.ethSrc, P.serverMac);
  assert.equal(offer.ethDst, BROADCAST_MAC);
  assert.equal(offer.ipSrc, P.serverIp);
  assert.equal(offer.ipDst, BROADCAST_IP);
  assert.deepEqual(offer.udp, { src: 67, dst: 68 });
  assert.equal(offer.yiaddr, P.offeredIp);
  assert.equal(offer.chaddr, P.clientMac);
  assert.ok(offer.options.some((o) => o.code === 53 && o.value === 'DHCPOFFER'));
  assert.ok(offer.options.some((o) => o.code === 54 && o.value === P.serverIp));
  assert.ok(offer.options.some((o) => o.code === 51 && o.value === `${P.leaseSeconds} 秒`));
});

test('REQUEST：客户端仍用 0.0.0.0 作源并广播，ciaddr 为 0，选项 50 与 54 写明所选的报价', () => {
  assert.equal(request.ethSrc, P.clientMac);
  assert.equal(request.ethDst, BROADCAST_MAC);
  assert.equal(request.ipSrc, '0.0.0.0');
  assert.equal(request.ipDst, BROADCAST_IP);
  assert.equal(request.ciaddr, '0.0.0.0');
  assert.equal(request.yiaddr, '0.0.0.0');
  assert.ok(request.options.some((o) => o.code === 50 && o.value === P.offeredIp));
  assert.ok(request.options.some((o) => o.code === 54 && o.value === P.serverIp));
  assert.ok(request.options.some((o) => o.code === 53 && o.value === 'DHCPREQUEST'));
});

test('ACK：源 IP 与源 MAC 换回服务器，目的仍是广播，yiaddr 为正式租出的地址', () => {
  assert.equal(ack.ethSrc, P.serverMac);
  assert.equal(ack.ethDst, BROADCAST_MAC);
  assert.equal(ack.ipSrc, P.serverIp);
  assert.equal(ack.ipDst, BROADCAST_IP);
  assert.equal(ack.yiaddr, P.offeredIp);
  assert.ok(ack.options.some((o) => o.code === 53 && o.value === 'DHCPACK'));
});

test('全程不变：事务号与 chaddr 始终相同；客户端 MAC 只作为客户端报文的源 MAC 出现', () => {
  for (const ex of [B1, B0]) {
    assert.ok(ex.packets.every((p) => p.xid === P.xid && p.chaddr === P.clientMac));
    for (const p of ex.packets) {
      if (p.sender === 'client') {
        assert.equal(p.ethSrc, P.clientMac);
        assert.equal(p.ipSrc, '0.0.0.0');
      } else {
        assert.equal(p.ethSrc, P.serverMac);
        assert.equal(p.ipSrc, P.serverIp);
      }
    }
    assert.ok(ex.packets.filter((p) => p.sender === 'client').every((p) => p.ethSrc !== P.serverMac));
  }
});

test('广播标志为 1：四个报文的目的 MAC 都是广播，目的 IP 都是 255.255.255.255', () => {
  assert.ok(B1.packets.every((p) => p.ethDst === BROADCAST_MAC && p.ipDst === BROADCAST_IP));
  assert.ok(B1.packets.every((p) => p.delivery === 'broadcast'));
  assert.ok(B1.packets.every((p) => p.flags.broadcast === 1));
});

test('广播标志为 0：OFFER 与 ACK 单播到 yiaddr，链路层地址用 chaddr；客户端报文仍然广播', () => {
  const [d0, o0, r0, a0] = B0.packets;
  assert.equal(o0.ipDst, P.offeredIp);
  assert.equal(o0.ethDst, P.clientMac);
  assert.equal(o0.delivery, 'unicast');
  assert.equal(a0.ipDst, P.offeredIp);
  assert.equal(a0.ethDst, P.clientMac);
  assert.equal(d0.ipDst, BROADCAST_IP);
  assert.equal(d0.ethDst, BROADCAST_MAC);
  assert.equal(r0.ipDst, BROADCAST_IP);
  assert.equal(r0.ethDst, BROADCAST_MAC);
  assert.ok(B0.packets.every((p) => p.flags.broadcast === 0));
});

test('相邻报文的变化：源地址、源 MAC、yiaddr 与选项地址来回切换，广播目的地址始终不变', () => {
  const expected = { ethSrc: true, ethDst: false, ipSrc: true, ipDst: false, yiaddr: true, optionAddresses: true };
  assert.deepEqual(offer.changes, expected);
  assert.deepEqual(request.changes, expected);
  assert.deepEqual(ack.changes, expected);
});

test('广播标志为 0 时，单播回复让 OFFER 与 ACK 的目的地址也发生变化', () => {
  assert.equal(B0.packets[1].changes.ipDst, true);
  assert.equal(B0.packets[1].changes.ethDst, true);
  assert.equal(B0.packets[3].changes.ipDst, true);
  assert.equal(B0.packets[3].changes.ethDst, true);
});

test('对照表的选项地址行：只有 50 与 54 两类地址，DISCOVER 没有', () => {
  assert.equal(discover.rows.optionAddresses, '—');
  assert.equal(offer.rows.optionAddresses, `54 = ${P.serverIp}`);
  assert.equal(request.rows.optionAddresses, `50 = ${P.offeredIp} · 54 = ${P.serverIp}`);
  assert.equal(ack.rows.optionAddresses, `54 = ${P.serverIp}`);
});

test('客户端 IP 只在收到 ACK 之后变为分配的地址；服务器状态按报文推进', () => {
  const states = B1.states;
  for (const key of ['init', 'discover', 'offer', 'request']) assert.equal(states.client[key].ip, '0.0.0.0', key);
  assert.equal(states.client.ack.ip, P.offeredIp);
  assert.match(states.server.discover.detail, new RegExp(P.offeredIp.replace(/\./g, '\\.')));
  assert.match(states.server.ack.detail, /已租出|192\.168\.1\.100|8 小时/);
});

test('替换服务器地址时，OFFER、REQUEST、ACK 中的源地址与选项 54 同步改变', () => {
  const ex = model.buildExchange({ serverIp: '10.0.0.1' });
  assert.equal(ex.packets[1].ipSrc, '10.0.0.1');
  assert.ok(ex.packets[2].options.some((o) => o.code === 54 && o.value === '10.0.0.1'));
  assert.equal(ex.packets[3].ipSrc, '10.0.0.1');
});

test('非法参数直接报错：IP 越界、MAC 小写、租期不是正整数', () => {
  assert.throws(() => model.buildExchange({ serverIp: '192.168.1.256' }), RangeError);
  assert.throws(() => model.buildExchange({ clientMac: '08:00:27:6a:9c:21' }), RangeError);
  assert.throws(() => model.buildExchange({ leaseSeconds: 0 }), RangeError);
});

test('报文底部一行给出事务号、广播标志与选项编号', () => {
  assert.equal(discover.footer, 'xid 0x4A3F21C8 · B=1 · 选项 53');
  assert.equal(request.footer, 'xid 0x4A3F21C8 · B=1 · 选项 53, 50, 54');
  assert.equal(B0.packets[0].footer, 'xid 0x4A3F21C8 · B=0 · 选项 53');
});
