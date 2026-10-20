// 动效选用：A1、A3、B1、B3、C3、D1、E1（见 docs/motion-library.md）
/* All visual interpolation is a pure function of (step, progress). */
(function (root) {
  'use strict';
  const clamp = value => Math.max(0, Math.min(1, value));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const POINTS = { A: [282, 148], B: [282, 258], C: [282, 368], router: [550, 215], server: [875, 215] };
  function route(from, to) {
    if (from === to) return [POINTS[from], POINTS[to]];
    const host = ['A', 'B', 'C'].includes(from) ? from : ['A', 'B', 'C'].includes(to) ? to : null;
    if (!host) return [POINTS[from], POINTS[to]];
    const points = [POINTS[host], [335, POINTS[host][1]], [403, 215], POINTS.router];
    return from === host ? points : points.slice().reverse();
  }
  function along(points, k) {
    const lengths = points.slice(1).map((point, i) => Math.hypot(point[0] - points[i][0], point[1] - points[i][1]));
    let distance = lengths.reduce((a, b) => a + b, 0) * clamp(k);
    for (let i = 0; i < lengths.length; i++) {
      if (distance <= lengths[i] || i === lengths.length - 1) {
        const q = lengths[i] ? distance / lengths[i] : 0;
        return [lerp(points[i][0], points[i + 1][0], q), lerp(points[i][1], points[i + 1][1], q)];
      }
      distance -= lengths[i];
    }
    return points[0];
  }
  function text(before, after, p, a = 0.72, b = 0.94) {
    if (before === after) return { value: before, alpha: 1 };
    const k = win(p, a, b);
    return { value: k < 0.5 ? before : after, alpha: Math.abs(1 - 2 * k) };
  }
  function hintContent(step, mode) {
    const { type, before, after, host } = step;
    const endpoint = (packet, source) => {
      const ip = source ? packet.sip : packet.dip;
      return ip + (mode === 'napt' ? ':' + (source ? packet.sport : packet.dport) : '');
    };
    const row = after.table.find(item => item.host === host);
    const fields = ['sip', 'sport', 'dip', 'dport'].filter(key => before.packet[key] !== after.packet[key]);
    if (type === 'snat' || type === 'dnat') return {
      title: type === 'snat' ? '改写源端点' : '还原目的端点',
      from: endpoint(before.packet, type === 'snat'), to: endpoint(after.packet, type === 'snat'),
      note: mode === 'basic' ? '只改变 IP · 端口不变' : type === 'snat' ? '目的端点保持不变' : '源端点保持不变', fields
    };
    if (type === 'allocate') return {
      title: '建立映射', from: row.privateIP + (mode === 'napt' ? ':' + row.privatePort : ''),
      to: row.publicIP + (mode === 'napt' ? ':' + row.publicPort : ''),
      note: mode === 'napt' ? '共享公网 IP · 分配独立端口' : '为该主机分配独立公网 IP', fields: []
    };
    if (type === 'lookup') return {
      title: mode === 'napt' ? '按端口查表' : '按地址查表',
      from: endpoint(before.packet, false), to: '主机 ' + host,
      note: mode === 'napt' ? '匹配公网 IP + TCP 目的端口' : '匹配目的公网 IP',
      fields: mode === 'napt' ? ['dip', 'dport'] : ['dip']
    };
    if (type === 'pool' || type === 'drop') return {
      title: type === 'pool' ? '公网地址用尽' : '报文已丢弃',
      from: '公网 IP  2 / 2', to: '无可用地址',
      note: type === 'pool' ? 'C 无法建立新的地址映射' : '未建立映射 · 请求未转发', fields: [], warning: true
    };
    return null;
  }
  // Hints live across a step boundary, then hand off without a visual jump.
  function hints(sequence, time) {
    const t = Math.max(0, Math.min(sequence.duration, Number(time) || 0));
    const index = Math.min(sequence.steps.length - 1, Math.floor(t / sequence.stepSeconds));
    const p = (t - index * sequence.stepSeconds) / sequence.stepSeconds;
    let hintStep = sequence.steps[index];
    let content = hintContent(hintStep, sequence.mode);
    let alpha = win(p, .12, .24);
    if (p < .12 && index > 0) {
      hintStep = sequence.steps[index - 1];
      content = hintContent(hintStep, sequence.mode);
      alpha = 1 - win(p, 0, .12);
    }
    const panel = content ? { ...content, alpha, type: hintStep.type, host: hintStep.host } : null;
    const step = sequence.steps[index];
    const travel = step.type === 'travel';
    const routeAlpha = travel ? win(p, 0, .12) * (1 - win(p, .88, 1)) : 0;
    const match = panel && ['allocate', 'lookup'].includes(panel.type)
      ? { host: panel.host, alpha: panel.alpha, progress: hintStep === step ? win(p, .12, .62) : 1 } : null;
    return { panel, match,
      fields: Object.fromEntries(['sip', 'sport', 'dip', 'dport'].map(key => [key, panel && panel.fields.includes(key) ? panel.alpha : 0])),
      route: { points: travel ? route(step.before.packet.location, step.after.packet.location) : [], alpha: routeAlpha,
        target: travel ? step.after.packet.location : null, arrival: travel ? win(p, .68, .8) * (1 - win(p, .88, 1)) : 0 }
    };
  }
  function frame(step, progress) {
    const p = clamp(progress);
    const { before, after, type } = step;
    const moving = type === 'travel';
    const fresh = type === 'reply' || type === 'newReply';
    const transition = win(p, 0.22, 0.68);
    const packet = fresh && transition >= 0.5 ? after.packet : before.packet;
    let position = moving
      ? along(route(before.packet.location, after.packet.location), win(p, 0.16, 0.72))
      : POINTS[packet.location];
    let packetAlpha = before.packet.visible ? 1 : 0;
    if (type === 'drop') packetAlpha = 1 - win(p, 0.22, 0.68);
    if (fresh) packetAlpha = Math.abs(1 - 2 * transition);
    if (p === 1) { position = POINTS[after.packet.location]; packetAlpha = after.packet.visible ? 1 : 0; }
    const fields = {};
    for (const field of ['sip', 'sport', 'dip', 'dport']) {
      fields[field] = text(before.packet[field], after.packet[field], p, 0.22, 0.68);
    }
    const hosts = {};
    for (const host of ['A', 'B', 'C']) hosts[host] = text(before.hosts[host], after.hosts[host], p);
    const rows = after.table.map(row => ({ ...row,
      alpha: before.table.some(old => old.host === row.host) ? 1 : win(p, 0.28, 0.7),
      offset: before.table.some(old => old.host === row.host) ? 0 : 9 * (1 - win(p, 0.28, 0.7)),
      focus: lerp(before.selected === row.host ? 1 : 0, after.selected === row.host ? 1 : 0, win(p, 0.16, 0.7))
    }));
    // Zero-opacity future rows do not become visual state before their insertion.
    const visibleRows = rows.filter(row => row.alpha > 0);
    const focus = Math.sin(Math.PI * win(p, 0, 0.32)) * (p < 0.32 ? 1 : 0);
    const tagAlpha = win(p, 0.72, 0.83) * (1 - win(p, 0.94, 1));
    return { packet: { position, alpha: packetAlpha, host: packet.host,
      direction: text(before.packet.direction, after.packet.direction, p, 0.22, 0.68) },
      fields, hosts, rows: visibleRows,
      router: text(before.router, after.router, p), server: text(before.server, after.server, p),
      count: text(String(before.table.length), String(after.table.length), p),
      tagAlpha, tagOffset: 5 * (1 - win(p, 0.72, 0.83)), focus,
      tableLink: ['lookup', 'allocate', 'pool'].includes(type) ? Math.sin(Math.PI * p) : 0,
      fieldFocus: Object.fromEntries(['sip', 'sport', 'dip', 'dport'].map(key => [key,
        before.packet[key] !== after.packet[key] ? Math.sin(Math.PI * p) : 0])) };
  }
  const api = { POINTS, win, text, route, along, frame, hints };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NATChoreo = api;
})(typeof globalThis === 'object' ? globalThis : this);
