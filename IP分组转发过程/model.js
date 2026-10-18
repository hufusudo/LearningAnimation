/**
 * IP 分组转发过程 —— 推演模型（纯计算，不碰 DOM）
 *
 * 每个 beat（一步）记录 before / after 两份完整快照；
 * frameOf(seq, i, p) 只由「第几步 + 步内进度」算出这一刻的画面：
 * 分组位置、当前链路、帧头、TTL、判断/查表过程、浮标与统计。
 * 因此播放、暂停、拖动与倒退都能精确重绘。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IPModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------- 数值与 IP 工具 ----------

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const win = (p, a, b) => (b <= a ? (p >= b ? 1 : 0) : clamp((p - a) / (b - a), 0, 1));
  const ease = (t) => {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  function ipBits(ip) {
    return ip
      .split('.')
      .map((n) => parseInt(n, 10).toString(2).padStart(8, '0'))
      .join('');
  }

  function andIp(a, b) {
    const ba = ipBits(a);
    const bb = ipBits(b);
    let out = '';
    for (let i = 0; i < 32; i++) out += ba[i] === '1' && bb[i] === '1' ? '1' : '0';
    return out
      .match(/.{8}/g)
      .map((x) => parseInt(x, 2))
      .join('.');
  }

  const netOf = (ip, mask) => andIp(ip, mask);

  // ---------- 固定拓扑与地址 ----------

  const PREFIX = 26;
  const MASK = '255.255.255.192';
  const INITIAL_TTL = 64;

  const SUBNETS = {
    N1: { id: 'N1', net: '128.1.2.192', mask: MASK, prefix: PREFIX, label: '128.1.2.192/26' },
    N2: { id: 'N2', net: '128.1.2.128', mask: MASK, prefix: PREFIX, label: '128.1.2.128/26' },
    N3: { id: 'N3', net: '128.1.3.64', mask: MASK, prefix: PREFIX, label: '128.1.3.64/26' }
  };

  const HOSTS = {
    H1: {
      id: 'H1',
      ip: '128.1.2.194',
      mac: '00-1A-2B-00-01-11',
      subnet: 'N1',
      gateway: '128.1.2.193'
    },
    H1b: {
      id: 'H1b',
      ip: '128.1.2.195',
      mac: '00-1A-2B-00-01-12',
      subnet: 'N1'
    },
    H2: {
      id: 'H2',
      ip: '128.1.2.132',
      mac: '00-1A-2B-00-02-21',
      subnet: 'N2'
    },
    H3: {
      id: 'H3',
      ip: '128.1.3.66',
      mac: '00-1A-2B-00-03-31',
      subnet: 'N3'
    },
    H3b: {
      id: 'H3b',
      ip: '128.1.3.67',
      mac: '00-1A-2B-00-03-32',
      subnet: 'N3'
    }
  };

  const ROUTERS = {
    R1: {
      id: 'R1',
      ifaces: [
        { key: 'R1-0', idx: 0, ip: '128.1.2.193', mac: '00-1A-2B-0A-01-01', subnet: 'N1' },
        { key: 'R1-1', idx: 1, ip: '128.1.2.129', mac: '00-1A-2B-0A-01-02', subnet: 'N2' }
      ],
      table: [
        {
          prefix: '128.1.2.192/26',
          net: '128.1.2.192',
          mask: MASK,
          out: 'R1-0',
          type: 'direct',
          nextHop: '直连',
          iface: '接口 0 · 128.1.2.193'
        },
        {
          prefix: '128.1.2.128/26',
          net: '128.1.2.128',
          mask: MASK,
          out: 'R1-1',
          type: 'direct',
          nextHop: '直连',
          iface: '接口 1 · 128.1.2.129'
        },
        {
          prefix: '128.1.3.64/26',
          net: '128.1.3.64',
          mask: MASK,
          out: 'R1-1',
          type: 'via',
          via: 'R2',
          nextHop: 'R2 · 128.1.2.130',
          iface: '接口 1 · 128.1.2.129'
        }
      ]
    },
    R2: {
      id: 'R2',
      ifaces: [
        { key: 'R2-0', idx: 0, ip: '128.1.2.130', mac: '00-1A-2B-0A-02-01', subnet: 'N2' },
        { key: 'R2-1', idx: 1, ip: '128.1.3.65', mac: '00-1A-2B-0A-02-02', subnet: 'N3' }
      ],
      table: [
        {
          prefix: '128.1.2.128/26',
          net: '128.1.2.128',
          mask: MASK,
          out: 'R2-0',
          type: 'direct',
          nextHop: '直连',
          iface: '接口 0 · 128.1.2.130'
        },
        {
          prefix: '128.1.3.64/26',
          net: '128.1.3.64',
          mask: MASK,
          out: 'R2-1',
          type: 'direct',
          nextHop: '直连',
          iface: '接口 1 · 128.1.3.65'
        },
        {
          prefix: '128.1.2.192/26',
          net: '128.1.2.192',
          mask: MASK,
          out: 'R2-0',
          type: 'via',
          via: 'R1',
          nextHop: 'R1 · 128.1.2.129',
          iface: '接口 0 · 128.1.2.130'
        }
      ]
    }
  };

  const IFACES = {};
  Object.keys(ROUTERS).forEach((rid) => {
    ROUTERS[rid].ifaces.forEach((f) => {
      IFACES[f.key] = Object.assign({ router: rid }, f);
    });
  });

  // ---------- 几何：宽屏舞台坐标 ----------

  const GEO = {
    viewBox: [0, 0, 1160, 560],
    subnets: {
      N1: { x: 40, y: 105, w: 270, h: 340 },
      N2: { x: 402, y: 105, w: 336, h: 340 },
      N3: { x: 838, y: 105, w: 282, h: 340 }
    },
    hosts: {
      H1: { x: 140, y: 175, w: 120, h: 72 },
      H1b: { x: 140, y: 385, w: 120, h: 72 },
      H2: { x: 610, y: 385, w: 120, h: 72 },
      H3: { x: 1030, y: 175, w: 120, h: 72 },
      H3b: { x: 1030, y: 385, w: 120, h: 72 }
    },
    switches: {
      SW1: { x: 260, y: 280, s: 44 },
      SW2: { x: 500, y: 280, s: 44 },
      SW3: { x: 925, y: 280, s: 44 }
    },
    routers: {
      R1: { x: 356, y: 280, r: 30 },
      R2: { x: 770, y: 280, r: 30 }
    },
    tags: {
      H1: { x: 140, y: 112 },
      H1b: { x: 140, y: 312 },
      H2: { x: 610, y: 312 },
      H3: { x: 1030, y: 104 },
      H3b: { x: 1030, y: 312 },
      R1: { x: 356, y: 214 },
      R2: { x: 770, y: 214 }
    },
    // 路径端点取节点中心/接口，保证相邻两步的首尾画面完全一致
    paths: {
      'H1->SW1': { id: 'H1-SW1', subnet: 'N1', from: { x: 140, y: 232 }, to: { x: 260, y: 280 } },
      'SW1->H1b': { id: 'SW1-H1b', subnet: 'N1', from: { x: 260, y: 280 }, to: { x: 140, y: 349 } },
      'SW1->R1': { id: 'SW1-R1', subnet: 'N1', from: { x: 260, y: 280 }, to: { x: 326, y: 280 } },
      'R1->SW2': { id: 'R1-SW2', subnet: 'N2', from: { x: 386, y: 280 }, to: { x: 500, y: 280 } },
      'SW2->H2': { id: 'SW2-H2', subnet: 'N2', from: { x: 500, y: 280 }, to: { x: 610, y: 349 } },
      'SW2->R2': { id: 'SW2-R2', subnet: 'N2', from: { x: 500, y: 280 }, to: { x: 740, y: 280 } },
      'R2->SW3': { id: 'R2-SW3', subnet: 'N3', from: { x: 800, y: 280 }, to: { x: 925, y: 280 } },
      'SW3->H3': { id: 'SW3-H3', subnet: 'N3', from: { x: 925, y: 280 }, to: { x: 1030, y: 211 } },
      'SW3->H3b': { id: 'SW3-H3b', subnet: 'N3', from: { x: 925, y: 280 }, to: { x: 1030, y: 349 } }
    }
  };

  function nodeCenter(id) {
    if (GEO.hosts[id]) return { x: GEO.hosts[id].x, y: GEO.hosts[id].y };
    if (GEO.switches[id]) return { x: GEO.switches[id].x, y: GEO.switches[id].y };
    if (GEO.routers[id]) return { x: GEO.routers[id].x, y: GEO.routers[id].y };
    return { x: 0, y: 0 };
  }

  // ---------- 场景定义 ----------

  const SCENARIOS = {
    1: {
      id: 1,
      label: '同网直交',
      route: 'H1 → H1b',
      title: '同一网络：直接交付',
      src: 'H1',
      dst: 'H1b',
      routers: [],
      nodePath: ['H1', 'SW1', 'H1b'],
      captions: [
        'H1 用 /26 掩码取出目的网络，与自身网络比较。',
        '同网：目的 MAC 填 H1b，帧经 SW1 直接交付。',
        'SW1 按目的 MAC 转发，帧到达 H1b，不经过路由器。',
        'H1b 收下分组；IP 地址未变，TTL 仍为 64。'
      ]
    },
    2: {
      id: 2,
      label: '跨网 1 跳',
      route: 'H1 → H2',
      title: '跨一个网络：经 R1 一次查表',
      src: 'H1',
      dst: 'H2',
      routers: ['R1'],
      nodePath: ['H1', 'SW1', 'R1', 'SW2', 'H2'],
      captions: [
        'H1 用 /26 掩码取出目的网络，与自身网络比较。',
        '不同网：目的 MAC 填默认网关 R1-0，帧发往 R1。',
        'SW1 按目的 MAC 把帧送到 R1 接口 0。',
        'R1 用目的 IP 与每条表项掩码相与，逐行查表。',
        'TTL 64→63；源 MAC 改为 R1-1，目的 MAC 填 H2。',
        '帧经 SW2 送到 H2，目的 IP 仍是 128.1.2.132。',
        'H2 收下分组；TTL 63，帧头共换了 2 段。'
      ]
    },
    3: {
      id: 3,
      label: '跨网 2 跳',
      route: 'H1 → H3',
      title: '跨两个网络：R1、R2 连续查表',
      src: 'H1',
      dst: 'H3',
      routers: ['R1', 'R2'],
      nodePath: ['H1', 'SW1', 'R1', 'SW2', 'R2', 'SW3', 'H3'],
      captions: [
        'H1 用 /26 掩码取出目的网络，与自身网络比较。',
        '目的 MAC 填 R1-0，帧经 SW1 送往 R1。',
        'R1 收到帧，取出目的 IP 128.1.3.66 准备查表。',
        'R1 逐行相与，寻找 128.1.3.66 对应的表项。',
        'TTL 63；源 MAC 改为 R1-1，目的 MAC 填 R2-0。',
        '帧经 SW2 到达 R2 接口 0，R2 开始查表。',
        'R2 再查一次表，确定直连网络的出接口。',
        'TTL 62；源 MAC 改为 R2-1，目的 MAC 填 H3。',
        '帧经 SW3 送到 H3，源、目的 IP 仍是 H1 → H3。',
        'H3 收下分组；TTL 62，帧头共换了 3 段。'
      ]
    }
  };

  const ROUTER_IDS = new Set(Object.keys(ROUTERS));

  // ---------- 判断与查表 ----------

  function ifaceOnSubnet(subnet) {
    return Object.keys(IFACES)
      .map((k) => IFACES[k])
      .find((f) => f.subnet === subnet);
  }

  function checkData(src, dst) {
    const destBits = ipBits(dst.ip);
    const maskBits = ipBits(MASK);
    const andNet = netOf(dst.ip, MASK);
    return {
      srcIp: src.ip,
      srcNet: netOf(src.ip, MASK),
      dstIp: dst.ip,
      mask: MASK,
      prefix: PREFIX,
      destBits,
      maskBits,
      andBits: ipBits(andNet),
      andNet,
      match: andNet === netOf(src.ip, MASK),
      nextHopIp: andNet === netOf(src.ip, MASK) ? dst.ip : src.gateway
    };
  }

  function lookupTable(routerId, dstIp) {
    const router = ROUTERS[routerId];
    const rows = router.table.map((row) => {
      const andResult = andIp(dstIp, row.mask);
      return Object.assign({}, row, { andResult, match: andResult === row.net });
    });
    let matchedIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].match) {
        matchedIdx = i;
        break;
      }
    }
    return { router: routerId, dstIp, rows, matchedIdx, row: matchedIdx >= 0 ? rows[matchedIdx] : null };
  }

  // ---------- 推演构造 ----------

  function snapshot(src, dst, extra) {
    return Object.assign(
      {
        ttl: INITIAL_TTL,
        ipSrc: src.ip,
        ipDst: dst.ip,
        macSrc: null,
        macDst: null,
        nextHopIp: null,
        macReason: '待封装',
        seg: 0,
        segTotal: 1,
        routerIndex: 0,
        at: src.id,
        delivered: false
      },
      extra || {}
    );
  }

  function makeBeat(id, kind, phase, group, dur, caption, before, after, extra) {
    return Object.assign(
      {
        id,
        kind,
        phase,
        group,
        dur,
        caption,
        before,
        after
      },
      extra || {}
    );
  }

  function buildSequence(id) {
    const cfg = SCENARIOS[id];
    if (!cfg) throw new Error('未知场景: ' + id);
    const src = HOSTS[cfg.src];
    const dst = HOSTS[cfg.dst];
    const check = checkData(src, dst);
    const sameNet = check.match;
    const segTotal = cfg.routers.length + 1;
    const firstPath = GEO.paths[cfg.nodePath[0] + '->' + cfg.nodePath[1]];
    const beats = [];

    const base = snapshot(src, dst, { segTotal });
    const gateway = ifaceOnSubnet(src.subnet);
    const afterCheck = Object.assign({}, base, {
      macSrc: src.mac,
      macDst: sameNet ? dst.mac : gateway.mac,
      nextHopIp: sameNet ? dst.ip : gateway.ip,
      macReason: sameNet ? '目的 MAC = 目的主机' : '目的 MAC = 默认网关',
      seg: 1
    });

    // 1. 源端判断：目的网络是否等于本机网络
    beats.push(
      makeBeat(
        'check',
        'check',
        '判断',
        '判断',
        5.0,
        cfg.captions[0],
        base,
        afterCheck,
        {
          check,
          packetFrom: firstPath.from,
          packetTo: firstPath.from,
          tagNode: src.id,
          newFrame: false
        }
      )
    );

    let state = afterCheck;
    let justChanged = true;
    let captionIndex = 1;
    let lastPath = null;
    const nodePath = cfg.nodePath;

    for (let k = 0; k < nodePath.length - 1; k++) {
      const fromId = nodePath[k];
      const toId = nodePath[k + 1];
      const path = GEO.paths[fromId + '->' + toId];
      if (!path) throw new Error('缺少路径: ' + fromId + '->' + toId);
      const len = Math.hypot(path.to.x - path.from.x, path.to.y - path.from.y);
      const dur = clamp(len / 170, 1.0, 1.6);

      beats.push(
        makeBeat(
          'move-' + k,
          'move',
          path.subnet,
          path.subnet,
          dur,
          cfg.captions[captionIndex++],
          state,
          Object.assign({}, state, { at: toId }),
          {
            path,
            fromId,
            toId,
            packetFrom: path.from,
            packetTo: path.to,
            newFrame: justChanged,
            tagNode: null
          }
        )
      );
      state = Object.assign({}, state, { at: toId });
      justChanged = false;
      lastPath = path;

      // 到达路由器：插入查表步
      if (ROUTER_IDS.has(toId)) {
        const table = lookupTable(toId, dst.ip);
        const row = table.row;
        if (!row) throw new Error('查表没有命中: ' + toId + ' ' + dst.ip);
        const out = IFACES[row.out];
        let dstMac;
        let nextHopIp;
        if (row.type === 'direct') {
          dstMac = dst.mac;
          nextHopIp = dst.ip;
        } else {
          const via = ROUTERS[row.via];
          const viaIf = via.ifaces.find((f) => f.subnet === out.subnet);
          if (!viaIf) throw new Error('找不到下一跳接口: ' + row.via);
          dstMac = viaIf.mac;
          nextHopIp = viaIf.ip;
        }
        const afterLookup = Object.assign({}, state, {
          ttl: state.ttl - 1,
          macSrc: out.mac,
          macDst: dstMac,
          nextHopIp,
          macReason: row.type === 'direct' ? '目的 MAC = 目的主机' : '目的 MAC = 下一跳路由器',
          seg: state.seg + 1,
          routerIndex: state.routerIndex + 1
        });
        const rg = GEO.routers[toId];
        const inIface = ROUTERS[toId].ifaces.find((f) => f.subnet === path.subnet) || ROUTERS[toId].ifaces[0];
        const inX = inIface.idx === 0 ? rg.x - rg.r : rg.x + rg.r;
        const outX = out.idx === 0 ? rg.x - rg.r : rg.x + rg.r;
        beats.push(
          makeBeat(
            'lookup-' + toId,
            'lookup',
            '查表',
            toId,
            3.2,
            cfg.captions[captionIndex++],
            state,
            afterLookup,
            {
              router: toId,
              lookup: table,
              ttlFrom: state.ttl,
              ttlTo: afterLookup.ttl,
              segFrom: state.seg,
              segTo: afterLookup.seg,
              packetFrom: { x: inX, y: rg.y },
              packetTo: { x: outX, y: rg.y },
              tagNode: toId
            }
          )
        );
        state = afterLookup;
        justChanged = true;
      }
    }

    const dstCenter = { x: GEO.hosts[dst.id].x, y: GEO.hosts[dst.id].y };
    beats.push(
      makeBeat(
        'finish',
        'finish',
        '交付',
        '交付',
        1.4,
        cfg.captions[captionIndex++],
        state,
        Object.assign({}, state, { delivered: true }),
        {
          packetFrom: lastPath ? lastPath.to : dstCenter,
          packetTo: dstCenter,
          tagNode: dst.id,
          newFrame: false
        }
      )
    );

    return {
      id: cfg.id,
      meta: cfg,
      src: src.id,
      dst: dst.id,
      srcIp: src.ip,
      dstIp: dst.ip,
      prefix: PREFIX,
      ttl0: INITIAL_TTL,
      segTotal,
      check,
      beats
    };
  }

  function beatStarts(seq) {
    const starts = [];
    let total = 0;
    seq.beats.forEach((b) => {
      starts.push(total);
      total += b.dur;
    });
    return { starts, total };
  }

  function locate(seq, t) {
    const { starts, total } = beatStarts(seq);
    const time = clamp(Number(t) || 0, 0, total);
    let index = seq.beats.length - 1;
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1] : total;
      if (time < end || i === starts.length - 1) {
        index = i;
        break;
      }
    }
    const start = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1] : total;
    const dur = end - start;
    return { index, p: dur > 0 ? clamp((time - start) / dur, 0, 1) : 1, start, end, total };
  }

  // ---------- 画面取样 ----------

  function tag(text, x, y, tone, alpha) {
    return { text, x, y, tone, alpha: clamp(alpha, 0, 1) };
  }

  function firstPathFrom(seq) {
    const cfg = SCENARIOS[seq.id];
    return GEO.paths[cfg.nodePath[0] + '->' + cfg.nodePath[1]].from;
  }

  function frameSnapshot(state) {
    return {
      ttl: state.ttl,
      srcMac: state.macSrc,
      dstMac: state.macDst,
      ipSrc: state.ipSrc,
      ipDst: state.ipDst,
      nextHopIp: state.nextHopIp,
      macReason: state.macReason,
      seg: state.seg,
      segTotal: state.segTotal,
      decided: Boolean(state.macSrc && state.macDst)
    };
  }

  function frameOf(seq, i, progress) {
    const index = clamp(Math.floor(i), 0, seq.beats.length - 1);
    const b = seq.beats[index];
    const p = clamp(Number(progress) || 0, 0, 1);
    const tags = [];
    let frameState = b.before;
    let packet = { x: 0, y: 0, alpha: 0, scale: 1, halo: 0 };
    let link = null;
    let trail = [];
    let check = null;
    let lookup = null;
    let focus = {};
    let subnet = null;
    const pulses = [];
    const chevrons = [];

    if (b.kind === 'check') {
      const decided = p >= 0.85;
      if (decided) frameState = b.after;
      const c = b.check;
      const destAlpha = c.destBits.split('').map(() => 1);
      const maskAlpha = c.maskBits.split('').map((_, k) => 0.22 + 0.78 * win(p, 0.12 + k * 0.0035, 0.21 + k * 0.0035));
      const andAlpha = c.andBits.split('').map((_, k) => win(p, 0.34 + k * 0.0145, 0.362 + k * 0.0145));
      check = {
        srcIp: c.srcIp,
        srcNet: c.srcNet,
        dstIp: c.dstIp,
        mask: c.mask,
        prefix: c.prefix,
        destBits: c.destBits,
        maskBits: c.maskBits,
        andBits: c.andBits,
        andNet: c.andNet,
        match: decided ? c.match : null,
        nextHopIp: c.nextHopIp,
        destAlpha,
        maskAlpha,
        andAlpha,
        compareAlpha: win(p, 0.83, 0.93),
        tone: c.match ? 'green' : 'red'
      };
      packet = {
        x: b.packetFrom.x,
        y: b.packetFrom.y,
        alpha: 1,
        scale: lerp(0.72, 1, ease(win(p, 0, 0.16))),
        halo: 1 - win(p, 0.1, 0.55)
      };
      const cp = win(p, 0, 0.28);
      if (cp > 0 && cp < 1) {
        pulses.push({
          x: firstPathFrom(seq).x,
          y: firstPathFrom(seq).y,
          r: 16 + 14 * ease(cp),
          alpha: (1 - cp) * 0.32,
          tone: 'blue'
        });
      }
      focus[b.tagNode] = 'source';
      focus[seq.dst] = 'dest';
      subnet = HOSTS[seq.src].subnet;
      tags.push(tag('判断网络', GEO.tags[b.tagNode].x, GEO.tags[b.tagNode].y, 'blue', win(p, 0.02, 0.12) * (1 - win(p, 0.76, 0.84))));
      if (p >= 0.85) {
        tags.push(
          tag(
            c.match ? '同网 · 直接交付' : '不同网 · 交给网关',
            GEO.tags[b.tagNode].x,
            GEO.tags[b.tagNode].y,
            c.match ? 'green' : 'red',
            win(p, 0.85, 0.92)
          )
        );
      }
    } else if (b.kind === 'move') {
      const q = win(p, 0.05, 0.95);
      const x = lerp(b.packetFrom.x, b.packetTo.x, q);
      const y = lerp(b.packetFrom.y, b.packetTo.y, q);
      packet = { x, y, alpha: 1, scale: 1, halo: 0 };
      link = {
        id: b.path.id,
        from: b.packetFrom,
        to: b.packetTo,
        pos: { x, y },
        q
      };
      for (let k = 1; k <= 3; k++) {
        const qq = q - k * 0.045;
        if (qq > 0) {
          trail.push({
            x: lerp(b.packetFrom.x, b.packetTo.x, qq),
            y: lerp(b.packetFrom.y, b.packetTo.y, qq),
            alpha: 0.26 / k
          });
        }
      }
      if (q < 0.995) {
        const dx = b.packetTo.x - b.packetFrom.x;
        const dy = b.packetTo.y - b.packetFrom.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const traveled = q * len;
        for (let k = 1; k <= 3; k++) {
          const ahead = traveled + 34 + k * 17;
          if (ahead < len - 2) {
            chevrons.push({
              x: b.packetFrom.x + ux * ahead,
              y: b.packetFrom.y + uy * ahead,
              angle,
              alpha: 0.55 * (1 - k * 0.15)
            });
          }
        }
      }
      const arrive = win(p, 0.45, 1);
      if (arrive > 0 && arrive < 1) {
        const c = nodeCenter(b.toId);
        pulses.push({
          x: c.x,
          y: c.y,
          r: 14 + 30 * ease(arrive),
          alpha: (1 - arrive) * 0.52,
          tone: 'blue'
        });
      }
      focus[b.fromId] = 'active';
      focus[b.toId] = ROUTER_IDS.has(b.toId) ? 'arrive' : 'active';
      subnet = b.path.subnet;
    } else if (b.kind === 'lookup') {
      const resolved = p >= 0.8;
      if (resolved) frameState = b.after;
      const q = win(p, 0.7, 1);
      const x = lerp(b.packetFrom.x, b.packetTo.x, q);
      const y = lerp(b.packetFrom.y, b.packetTo.y, q);
      packet = {
        x,
        y,
        alpha: 1,
        scale: 0.94,
        halo: 1 - win(p, 0.15, 0.65)
      };
      const table = b.lookup;
      const scanEnd = 0.66;
      const rows = table.rows.map((row, k) => {
        const span = scanEnd / Math.max(1, table.matchedIdx + 1);
        const start = 0.08 + k * span;
        const rq = k <= table.matchedIdx ? win(p, start, start + span * 0.82) : 0;
        const alpha = win(p, 0.03 + k * 0.05, 0.08 + k * 0.05) * (k <= table.matchedIdx + 1 ? 1 : 0.5);
        let state = 'idle';
        if (k <= table.matchedIdx && rq > 0) state = rq < 0.72 ? 'scan' : row.match ? 'match' : 'miss';
        return Object.assign({}, row, {
          alpha,
          q: rq,
          state,
          andAlpha: win(rq, 0.08, 0.5),
          badgeAlpha: win(rq, 0.55, 0.82)
        });
      });
      lookup = {
        router: table.router,
        dstIp: table.dstIp,
        rows,
        matchedIdx: table.matchedIdx,
        resolved,
        ttlFrom: b.ttlFrom,
        ttlTo: b.ttlTo,
        segFrom: b.segFrom,
        segTo: b.segTo,
        receiptAlpha: win(p, 0.8, 0.9)
      };
      const rp = win(p, 0, 0.36);
      const rg = GEO.routers[b.router];
      if (rp > 0 && rp < 1) {
        pulses.push({
          x: rg.x,
          y: rg.y,
          r: 33 + 15 * ease(rp),
          alpha: (1 - rp) * 0.46,
          tone: 'gold'
        });
      }
      const lp = win(p, 0.76, 1);
      if (lp > 0 && lp < 1) {
        pulses.push({
          x: b.packetTo.x,
          y: b.packetTo.y,
          r: 11 + 15 * ease(lp),
          alpha: (1 - lp) * 0.4,
          tone: 'blue'
        });
      }
      focus[b.router] = 'lookup';
      focus[seq.dst] = 'dest';
      subnet = b.before.at === b.router ? ROUTERS[b.router].ifaces[0].subnet : null;
      tags.push(tag('逐行查表', GEO.tags[b.router].x, GEO.tags[b.router].y, 'gold', win(p, 0.02, 0.12) * (1 - win(p, 0.66, 0.75))));
      if (p >= 0.7) {
        tags.push(tag('命中 /26', GEO.tags[b.router].x, GEO.tags[b.router].y, 'green', win(p, 0.72, 0.82)));
      }
      if (p >= 0.82) {
        tags.push(tag('TTL ' + b.ttlFrom + '→' + b.ttlTo, GEO.tags[b.router].x, GEO.tags[b.router].y + 158, 'gold', win(p, 0.84, 0.92)));
      }
    } else if (b.kind === 'finish') {
      packet = {
        x: b.packetFrom.x,
        y: b.packetFrom.y,
        alpha: 1 - win(p, 0.05, 0.32),
        scale: 1 + 0.16 * win(p, 0.05, 0.32),
        halo: 0
      };
      const fp = win(p, 0.12, 0.8);
      if (fp > 0 && fp < 1) {
        const c = nodeCenter(b.tagNode);
        pulses.push({
          x: c.x,
          y: c.y,
          r: 20 + 38 * ease(fp),
          alpha: (1 - fp) * 0.55,
          tone: 'green'
        });
      }
      focus[b.tagNode] = 'delivered';
      subnet = HOSTS[seq.dst].subnet;
      tags.push(tag('已交付', GEO.tags[b.tagNode].x, GEO.tags[b.tagNode].y, 'green', win(p, 0.08, 0.24)));
      tags.push(tag('IP 地址不变', GEO.tags[b.tagNode].x, GEO.tags[b.tagNode].y + 22, 'ink', win(p, 0.32, 0.5)));
    }

    const frame = frameSnapshot(frameState);
    return {
      index,
      count: seq.beats.length,
      phase: b.phase,
      group: b.group,
      caption: b.caption,
      kind: b.kind,
      progress: p,
      frame,
      stats: {
        ttl: frame.ttl,
        seg: frame.seg,
        segTotal: frame.segTotal,
        routerIndex: frameState.routerIndex,
        ipFixed: true,
        delivered: b.kind === 'finish' ? p >= 0.35 : frameState.delivered
      },
      packet,
      link,
      trail,
      tags,
      pulses,
      chevrons,
      check,
      lookup,
      focus,
      subnet,
      route: seq.meta.route,
      title: seq.meta.title,
      scenario: seq.meta.label
    };
  }

  return {
    GEO,
    SUBNETS,
    HOSTS,
    ROUTERS,
    IFACES,
    SCENARIOS,
    INITIAL_TTL,
    PREFIX,
    MASK,
    ipBits,
    andIp,
    netOf,
    buildSequence,
    beatStarts,
    locate,
    frameOf,
    lookupTable,
    checkData
  };
});
