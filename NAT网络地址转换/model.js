/* Pure, deterministic NAT teaching scenarios. No TCP handshake is simulated. */
(function (root) {
  'use strict';
  const HOSTS = [
    { id: 'A', ip: '192.168.1.2', port: '50001' },
    { id: 'B', ip: '192.168.1.3', port: '50001' },
    { id: 'C', ip: '192.168.1.4', port: '50001' }
  ];
  const SERVER = { ip: '203.0.113.88', port: '80' };
  const POOL = ['198.51.100.1', '198.51.100.2'];
  const STEP_SECONDS = 1.6;
  const clone = value => JSON.parse(JSON.stringify(value));
  function mapping(mode, host) {
    const i = HOSTS.findIndex(item => item.id === host);
    return { host, privateIP: HOSTS[i].ip, privatePort: HOSTS[i].port,
      publicIP: POOL[mode === 'basic' ? i : 0],
      publicPort: mode === 'basic' ? '50001' : String(30001 + i), protocol: 'TCP' };
  }
  function request(host) {
    const source = HOSTS.find(item => item.id === host);
    return { host, direction: 'out', location: host, visible: true,
      sip: source.ip, sport: source.port, dip: SERVER.ip, dport: SERVER.port };
  }
  function response(row) {
    return { host: row.host, direction: 'in', location: 'server', visible: true,
      sip: SERVER.ip, sport: SERVER.port, dip: row.publicIP, dport: row.publicPort };
  }
  function buildScenario(mode = 'basic', scenario = 'a') {
    mode = mode === 'napt' ? 'napt' : 'basic';
    scenario = ['a', 'b', 'special'].includes(scenario) ? scenario : 'a';
    const special = scenario === 'special';
    const prefilled = special ? ['A', 'B'] : scenario === 'b' ? ['A'] : [];
    let state = { table: prefilled.map(host => mapping(mode, host)),
      hosts: { A: '就绪', B: '就绪', C: '就绪' }, server: '等待请求',
      router: '等待报文', selected: null, packet: request(scenario === 'b' ? 'B' : 'A') };
    prefilled.forEach(host => { state.hosts[host] = '映射已保留'; });
    const steps = [];
    function add(type, label, caption, tag, host, mutate) {
      const before = clone(state);
      mutate(state);
      steps.push({ type, label, caption, tag, host, before, after: clone(state) });
    }
    function incoming(host, first) {
      const row = mapping(mode, host);
      if (!first) add('newReply', '另一回包', '另一个回包的目的端口不同，继续按表分流。', '另一目的端口', host,
        s => { s.packet = response(row); s.server = '发送响应'; s.router = '等待回包'; s.selected = null; });
      add('travel', '回到网关', `回包目的端口 ${row.publicPort}，尚未进入私网。`, '回包到达', host,
        s => { s.packet.location = 'router'; s.router = '等待查表'; });
      add('lookup', '反向查表', mode === 'basic' ? '用回包的目的公网 IP 查找对应私网地址。' : `TCP 目的端口 ${row.publicPort} 命中主机 ${host} 的表项。`, `命中主机 ${host}`, host,
        s => { s.router = `命中主机 ${host}`; s.selected = host; });
      add('dnat', '还原目的', mode === 'basic' ? '还原目的 IP，回包的源与两个端口保持不变。' : '还原目的 IP 和目的端口，回包的源端点不变。', '目的字段还原', host,
        s => { s.packet.dip = row.privateIP; s.packet.dport = row.privatePort; s.router = '目的已还原'; });
      add('travel', '交付主机', `回包交付主机 ${host} 的端口 50001，映射仍保留。`, `交付主机 ${host}`, host,
        s => { s.packet.location = host; s.hosts[host] = '收到响应'; s.router = '转发完成'; });
    }
    if (special && mode === 'basic') {
      state.packet = request('C');
      add('travel', '新的请求', 'A、B 已占用两个公网地址，C 的请求到达网关。', '主机 C 请求', 'C',
        s => { s.packet.location = 'router'; s.hosts.C = '等待分配'; s.router = '新主机请求'; });
      add('pool', '检查地址池', '两个公网地址均已占用，无法再建立一对一映射。', '公网地址用尽', 'C',
        s => { s.router = '地址池已满'; });
      add('drop', '丢弃请求', '没有可分配的公网地址，C 的报文不能转发。', '报文丢弃', 'C',
        s => { s.packet.visible = false; s.hosts.C = '请求被丢弃'; s.router = '无法建立映射'; });
    } else if (special) {
      state.packet = response(mapping(mode, 'B'));
      state.server = '发送响应';
      incoming('B', true);
      incoming('A', false);
    } else {
      const host = scenario === 'b' ? 'B' : 'A';
      const row = mapping(mode, host);
      add('travel', '到达网关', `主机 ${host} 以私网地址和端口 50001 发起请求。`, '请求到达', host,
        s => { s.packet.location = 'router'; s.hosts[host] = '等待响应'; s.router = '等待分配'; });
      add('allocate', '建立映射', mode === 'basic' ? `为主机 ${host} 分配独立公网 IP，不改端口。` : `为主机 ${host} 分配公网端口 ${row.publicPort}，共享同一公网 IP。`, '建立映射', host,
        s => { s.table.push(row); s.router = '映射已建立'; s.selected = host; });
      add('snat', '改写源', mode === 'basic' ? '只改写源 IP；源端口、目的 IP 和目的端口不变。' : '改写源 IP 与源端口；目的端点保持不变。', mode === 'basic' ? '只改源地址' : '源端点改写', host,
        s => { s.packet.sip = row.publicIP; s.packet.sport = row.publicPort; s.router = '源已改写'; });
      add('travel', '发往公网', '服务器只能看到转换后的公网源端点。', '请求送达', host,
        s => { s.packet.location = 'server'; s.server = '收到请求'; s.router = '等待回包'; });
      add('reply', '服务器响应', '服务器交换源与目的端点，向公网端点返回响应。', '生成响应', host,
        s => { s.packet = response(row); s.server = '发送响应'; });
      incoming(host, true);
    }
    return { mode, scenario, steps, initial: clone(steps[0].before),
      duration: Math.round(steps.length * STEP_SECONDS * 1000) / 1000, stepSeconds: STEP_SECONDS };
  }
  function sample(sequence, t) {
    const time = Math.max(0, Math.min(sequence.duration, Number(t) || 0));
    const index = Math.min(sequence.steps.length - 1, Math.floor(time / STEP_SECONDS));
    const progress = time === sequence.duration ? 1 : (time - index * STEP_SECONDS) / STEP_SECONDS;
    return { time, index, progress, step: sequence.steps[index] };
  }
  const api = { HOSTS, SERVER, POOL, STEP_SECONDS, mapping, buildScenario, sample };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NATModel = api;
})(typeof globalThis === 'object' ? globalThis : this);
