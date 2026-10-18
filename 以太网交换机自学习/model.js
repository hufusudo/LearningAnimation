/**
 * 以太网交换机自学习与兜圈问题 —— 推演模型（纯计算，不碰 DOM）
 *
 * 每个 beat（一步）记录 before / after 两份完整快照，frameOf(seq, i, p) 只由
 * 「第几步 + 步内进度」算出这一刻的画面：芯片位置、拖尾、端口脉冲、表行、
 * 浮标、回执、计数与风暴环。因此拖动、倒退、暂停都能精确重绘。
 */
(function (root) {
  'use strict';

  const HOST_MAC = {
    A: '00-1A-2B-3C-4D-A1',
    B: '00-1A-2B-3C-4D-B2',
    C: '00-1A-2B-3C-4D-C3',
    D: '00-1A-2B-3C-4D-D4'
  };

  // ---------- 数值与路径工具 ----------

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const win = (p, a, b) => (b <= a ? (p >= b ? 1 : 0) : clamp((p - a) / (b - a), 0, 1));
  const ease = (t) => {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  // 折线：返回累计长度，便于按比例取点与截取拖尾
  function poly(points) {
    const segs = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      segs.push({ a, b, len, start: total });
      total += len;
    }
    return { points, segs, total };
  }

  function pointAt(line, q) {
    const t = clamp(q, 0, 1) * line.total;
    for (let i = 0; i < line.segs.length; i++) {
      const s = line.segs[i];
      if (t <= s.start + s.len || i === line.segs.length - 1) {
        const k = s.len === 0 ? 0 : (t - s.start) / s.len;
        return { x: lerp(s.a.x, s.b.x, k), y: lerp(s.a.y, s.b.y, k) };
      }
    }
    const last = line.points[line.points.length - 1];
    return { x: last.x, y: last.y };
  }

  function subPath(line, q) {
    const t = clamp(q, 0, 1) * line.total;
    const pts = [line.points[0]];
    for (let i = 0; i < line.segs.length; i++) {
      const s = line.segs[i];
      if (t >= s.start + s.len) {
        pts.push(s.b);
      } else {
        if (t > s.start) pts.push(pointAt(line, t / (line.total || 1)));
        break;
      }
    }
    return pts;
  }

  const pathD = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // 取 [a, b] 之间的折线段（用于环形拖尾，不从头画起）
  function pathSegment(line, a, b, n) {
    const steps = n || 12;
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push(pointAt(line, a + (b - a) * (i / steps)));
    return pts;
  }

  // 二次贝塞尔采样成折线（用于查表命中的连线）
  function curve(p0, p1, p2, n) {
    const pts = [];
    const steps = n || 14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      pts.push({
        x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
      });
    }
    return pts;
  }

  // 圆角矩形采样成闭合折线（风暴环：两台交换机之间的循环）
  function roundRectPoints(x, y, w, h, r, step) {
    const rr = Math.min(r, w / 2, h / 2);
    const pts = [];
    const arc = (cx, cy, from, to) => {
      const n = Math.max(2, Math.round((Math.abs(to - from) / (Math.PI / 2)) * 4));
      for (let i = 0; i <= n; i++) {
        const a = from + ((to - from) * i) / n;
        pts.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
      }
    };
    arc(x + w - rr, y + rr, -Math.PI / 2, 0);
    arc(x + w - rr, y + h - rr, 0, Math.PI / 2);
    arc(x + rr, y + h - rr, Math.PI / 2, Math.PI);
    arc(x + rr, y + rr, Math.PI, Math.PI * 1.5);
    pts.push({ ...pts[0] });
    return pts;
  }

  // ---------- 几何：单交换机（4 台主机占 4 个端口） ----------

  const SG = {
    id: 'single',
    viewBox: [0, 0, 1100, 560],
    hosts: {
      A: { x: 140, y: 118, w: 168, h: 68, port: '1:1' },
      B: { x: 140, y: 208, w: 168, h: 68, port: '1:2' },
      C: { x: 140, y: 298, w: 168, h: 68, port: '1:3' },
      D: { x: 140, y: 388, w: 168, h: 68, port: '1:4' }
    },
    switches: {
      1: {
        x: 380, y: 70, w: 520, h: 350,
        name: '以太网交换机',
        table: {
          x: 404, y: 170, w: 472, headH: 28, rowH: 40, slots: 4,
          cols: [
            { key: 'mac', label: 'MAC 地址', x: 420, align: 'start' },
            { key: 'port', label: '端口', x: 680, align: 'middle' },
            { key: 'ttl', label: '老化', x: 856, align: 'end' }
          ]
        },
        lines: [{ key: 'src', x: 404, y: 128 }, { key: 'dst', x: 404, y: 152 }],
        footer: '存储转发 · 老化时间 300 s',
        pill: { x: 560, y: 96 }
      }
    },
    ports: {
      '1:1': { sw: 1, x: 380, y: 118 },
      '1:2': { sw: 1, x: 380, y: 208 },
      '1:3': { sw: 1, x: 380, y: 298 },
      '1:4': { sw: 1, x: 380, y: 388 }
    },
    stats: [{ x: 430, label: '泛洪' }, { x: 550, label: '单播' }, { x: 670, label: '表项' }],
    statsY: 500
  };

  // ---------- 几何：双交换机（两条冗余链路） ----------

  const LG = {
    id: 'loop',
    viewBox: [0, 0, 1100, 560],
    hosts: {
      A: { x: 105, y: 168, w: 150, h: 72, port: '1:1' },
      C: { x: 105, y: 372, w: 150, h: 72, port: '1:2' },
      B: { x: 995, y: 168, w: 150, h: 72, port: '2:3' },
      D: { x: 995, y: 372, w: 150, h: 72, port: '2:4' }
    },
    switches: {
      1: {
        x: 260, y: 120, w: 200, h: 300,
        name: '交换机 1',
        table: {
          x: 284, y: 170, w: 152, headH: 24, rowH: 46, slots: 3, shortMac: true,
          cols: [
            { key: 'mac', label: 'MAC 尾段', x: 296, align: 'start' },
            { key: 'port', label: '端口', x: 400, align: 'middle' }
          ]
        },
        lines: [{ key: 'note1', x: 284, y: 362 }],
        footer: '端口 1、2 接主机 · 3、4 互联',
        pill: { x: 360, y: 378 }
      },
      2: {
        x: 640, y: 120, w: 200, h: 300,
        name: '交换机 2',
        table: {
          x: 664, y: 170, w: 152, headH: 24, rowH: 46, slots: 3, shortMac: true,
          cols: [
            { key: 'mac', label: 'MAC 尾段', x: 676, align: 'start' },
            { key: 'port', label: '端口', x: 780, align: 'middle' }
          ]
        },
        lines: [{ key: 'note2', x: 664, y: 362 }],
        footer: '端口 3、4 接主机 · 1、2 互联',
        pill: { x: 740, y: 378 }
      }
    },
    ports: {
      '1:1': { sw: 1, x: 260, y: 168 },
      '1:3': { sw: 1, x: 460, y: 168 },
      '1:2': { sw: 1, x: 260, y: 372 },
      '1:4': { sw: 1, x: 460, y: 372 },
      '2:1': { sw: 2, x: 640, y: 168 },
      '2:3': { sw: 2, x: 840, y: 168 },
      '2:2': { sw: 2, x: 640, y: 372 },
      '2:4': { sw: 2, x: 840, y: 372 }
    },
    extraLinks: [
      { a: { x: 460, y: 168 }, b: { x: 640, y: 168 }, label: '冗余链路 1', lx: 550, ly: 146 },
      { a: { x: 460, y: 372 }, b: { x: 640, y: 372 }, label: '冗余链路 2', lx: 550, ly: 402 }
    ],
    loopPath: roundRectPoints(492, 168, 116, 204, 30),
    stats: [{ x: 550, label: 'B 收到副本', unit: '份' }],
    statsY: 470,
    meter: { x: 430, y: 490, w: 240, h: 7 }
  };

  function hostEdge(geom, id) {
    const h = geom.hosts[id];
    const port = geom.ports[h.port];
    const side = port.x >= h.x ? 1 : -1;
    return { x: h.x + (side * h.w) / 2, y: h.y };
  }

  // ---------- 状态 ----------

  function state0() {
    return {
      tables: { 1: [], 2: [] },
      copies: 0,
      blocked: [],
      tally: { flood: 0, unicast: 0 },
      lines: {
        src: { label: '源 MAC', value: '—', tone: 'idle' },
        dst: { label: '目的 MAC', value: '—', tone: 'idle' },
        note1: { label: '', value: '', tone: 'idle' },
        note2: { label: '', value: '', tone: 'idle' }
      }
    };
  }

  function cloneState(s) {
    return {
      tables: { 1: s.tables[1].map((r) => ({ ...r })), 2: s.tables[2].map((r) => ({ ...r })) },
      copies: s.copies,
      blocked: s.blocked.slice(),
      tally: { flood: s.tally.flood, unicast: s.tally.unicast },
      lines: Object.keys(s.lines).reduce((acc, k) => {
        acc[k] = { label: s.lines[k].label, value: s.lines[k].value, tone: s.lines[k].tone };
        return acc;
      }, {})
    };
  }

  function applyChange(state, ch) {
    const rows = state.tables[ch.sw];
    if (ch.kind === 'insert') {
      rows.push({ mac: ch.mac, port: ch.to, ttl: ch.ttl == null ? 300 : ch.ttl });
    } else if (ch.kind === 'update') {
      const row = rows.find((r) => r.mac === ch.mac);
      if (row) {
        row.port = ch.to;
        row.ttl = ch.ttl == null ? 300 : ch.ttl;
        // 被覆写的表项保持标红，直到下次被正常刷新
        if (ch.flap) row.bad = true;
      }
    } else if (ch.kind === 'remove') {
      state.tables[ch.sw] = rows.filter((r) => r.mac !== ch.mac);
    }
  }

  function addBeat(list, st, def) {
    const before = st;
    const after = cloneState(before);
    if (def.tableChange) applyChange(after, def.tableChange);
    (def.lines || []).forEach((l) => {
      after.lines[l.key] = { label: l.label, value: l.value, tone: l.tone };
    });
    if (def.copies != null) after.copies = def.copies;
    if (def.tally) {
      after.tally.flood += def.tally.flood || 0;
      after.tally.unicast += def.tally.unicast || 0;
    }
    if (def.block) after.blocked = after.blocked.concat(def.block);
    const beat = Object.assign({ dur: 1.1 }, def, { before, after });
    list.push(beat);
    return after;
  }

  function chip(from, to, label, tone, t0, t1, bend) {
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + (bend || 0) };
    const pts = bend ? [from, mid, to] : [from, to];
    return { path: poly(pts), label, tone, t0: t0 == null ? 0.1 : t0, t1: t1 == null ? 0.78 : t1 };
  }

  // ---------- 单交换机推演 ----------

  function buildSingle() {
    const G = SG;
    const P = G.ports;
    const edge = (id) => hostEdge(G, id);
    const beats = [];
    let st = state0();

    st = addBeat(beats, st, {
      id: 'arrive1', group: 0, phase: '入帧', frame: 'A→B', dur: 1.15,
      caption: 'A 给 B 发一帧，先进入端口 1。',
      chips: [chip(edge('A'), P['1:1'], 'A→B', 'blue')],
      ports: [{ key: '1:1', tone: 'rx', t0: 0.55, t1: 1 }],
      pill: { 1: { text: '收帧', tone: 'blue' } }
    });

    st = addBeat(beats, st, {
      id: 'learn1', group: 0, phase: '学习', frame: 'A→B', dur: 1.1,
      caption: '源 MAC 是 A：把 A 记在端口 1。',
      tableChange: { sw: 1, kind: 'insert', mac: 'A', to: 1, ttl: 300, win: [0.14, 0.58] },
      lines: [{ key: 'src', label: '源 MAC', value: 'A → 学到端口 1', tone: 'learn', win: [0.28, 0.48] }],
      ports: [{ key: '1:1', tone: 'rx', t0: 0, t1: 1 }],
      tags: [{ text: '记 A→1', tone: 'learn', x: 640, y: 58, t0: 0.4, t1: 1 }],
      pill: { 1: { text: '学习中', tone: 'green' } }
    });

    st = addBeat(beats, st, {
      id: 'lookup1', group: 0, phase: '查表', frame: 'A→B', dur: 1.0,
      caption: '目的 MAC 是 B，表里没有 B。',
      lines: [{ key: 'dst', label: '目的 MAC', value: 'B → 未命中', tone: 'flood', win: [0.26, 0.48] }],
      tags: [{ text: '查无 B', tone: 'flood', x: 640, y: 58, t0: 0.34, t1: 0.96 }],
      pill: { 1: { text: '查表中', tone: 'gold' } }
    });

    st = addBeat(beats, st, {
      id: 'flood1', group: 0, phase: '泛洪', frame: 'A→B', dur: 1.5,
      caption: '未知单播：向 2、3、4 端口盲目泛洪。',
      chips: [
        chip(P['1:2'], edge('B'), 'A→B', 'gold', 0.14, 0.6),
        chip(P['1:3'], edge('C'), 'A→B', 'gold', 0.14, 0.6),
        chip(P['1:4'], edge('D'), 'A→B', 'gold', 0.14, 0.6)
      ],
      ports: [
        { key: '1:2', tone: 'flood', t0: 0.08, t1: 0.66 },
        { key: '1:3', tone: 'flood', t0: 0.08, t1: 0.66 },
        { key: '1:4', tone: 'flood', t0: 0.08, t1: 0.66 }
      ],
      receipts: [
        { host: 'B', text: '收下', tone: 'green', t0: 0.62, t1: 0.94 },
        { host: 'C', text: '丢弃', tone: 'quiet', t0: 0.62, t1: 0.94 },
        { host: 'D', text: '丢弃', tone: 'quiet', t0: 0.62, t1: 0.94 }
      ],
      tags: [{ text: '泛洪 2/3/4', tone: 'flood', x: 302, y: 253, t0: 0.1, t1: 0.94 }],
      tally: { flood: 1 },
      pill: { 1: { text: '泛洪中', tone: 'gold' } }
    });

    st = addBeat(beats, st, {
      id: 'arrive2', group: 1, phase: '入帧', frame: 'B→A', dur: 1.15,
      caption: 'B 回一帧给 A，进入端口 2。',
      chips: [chip(edge('B'), P['1:2'], 'B→A', 'blue')],
      ports: [{ key: '1:2', tone: 'rx', t0: 0.55, t1: 1 }],
      pill: { 1: { text: '收帧', tone: 'blue' } }
    });

    st = addBeat(beats, st, {
      id: 'learn2', group: 1, phase: '学习', frame: 'B→A', dur: 1.1,
      caption: '源 MAC 是 B：把 B 记在端口 2。',
      tableChange: { sw: 1, kind: 'insert', mac: 'B', to: 2, ttl: 300, win: [0.14, 0.58] },
      lines: [{ key: 'src', label: '源 MAC', value: 'B → 学到端口 2', tone: 'learn', win: [0.28, 0.48] }],
      ports: [{ key: '1:2', tone: 'rx', t0: 0, t1: 1 }],
      tags: [{ text: '记 B→2', tone: 'learn', x: 640, y: 58, t0: 0.4, t1: 1 }],
      pill: { 1: { text: '学习中', tone: 'green' } }
    });

    st = addBeat(beats, st, {
      id: 'lookup2', group: 1, phase: '查表', frame: 'B→A', dur: 1.15,
      caption: '目的 MAC 是 A：表里查到 A 在端口 1。',
      lines: [{ key: 'dst', label: '目的 MAC', value: 'A → 命中 端口 1', tone: 'learn', win: [0.24, 0.46] }],
      connector: { mac: 'A', to: '1:1', t0: 0.46, t1: 0.72, tone: 'green' },
      ports: [{ key: '1:1', tone: 'unicast', t0: 0.66, t1: 1 }],
      tags: [{ text: '命中 A→1', tone: 'learn', x: 640, y: 58, t0: 0.44, t1: 0.96 }],
      pill: { 1: { text: '命中', tone: 'green' } }
    });

    st = addBeat(beats, st, {
      id: 'unicast2', group: 1, phase: '单播', frame: 'B→A', dur: 1.4,
      caption: '只从端口 1 发出，其余端口不动。',
      chips: [chip(P['1:1'], edge('A'), 'B→A', 'green', 0.12, 0.68)],
      ports: [{ key: '1:1', tone: 'unicast', t0: 0, t1: 0.74 }],
      receipts: [{ host: 'A', text: '收下', tone: 'green', t0: 0.7, t1: 0.94 }],
      tags: [{ text: '单播 1 口', tone: 'quiet', x: 302, y: 163, t0: 0.2, t1: 0.94 }],
      tally: { unicast: 1 },
      pill: { 1: { text: '单播', tone: 'green' } }
    });

    st = addBeat(beats, st, {
      id: 'arrive3', group: 2, phase: '入帧', frame: 'C→A', dur: 1.15,
      caption: 'C 也来找 A，进入端口 3。',
      chips: [chip(edge('C'), P['1:3'], 'C→A', 'blue')],
      ports: [{ key: '1:3', tone: 'rx', t0: 0.55, t1: 1 }],
      pill: { 1: { text: '收帧', tone: 'blue' } }
    });

    st = addBeat(beats, st, {
      id: 'learn3', group: 2, phase: '学习', frame: 'C→A', dur: 1.1,
      caption: '源 MAC 是 C：把 C 记在端口 3。',
      tableChange: { sw: 1, kind: 'insert', mac: 'C', to: 3, ttl: 300, win: [0.14, 0.58] },
      lines: [{ key: 'src', label: '源 MAC', value: 'C → 学到端口 3', tone: 'learn', win: [0.28, 0.48] }],
      ports: [{ key: '1:3', tone: 'rx', t0: 0, t1: 1 }],
      tags: [{ text: '记 C→3', tone: 'learn', x: 640, y: 58, t0: 0.4, t1: 1 }],
      pill: { 1: { text: '学习中', tone: 'green' } }
    });

    st = addBeat(beats, st, {
      id: 'lookup3', group: 2, phase: '查表', frame: 'C→A', dur: 1.15,
      caption: '目的 MAC 是 A，仍然命中端口 1。',
      lines: [{ key: 'dst', label: '目的 MAC', value: 'A → 命中 端口 1', tone: 'learn', win: [0.24, 0.46] }],
      connector: { mac: 'A', to: '1:1', t0: 0.46, t1: 0.72, tone: 'green' },
      ports: [{ key: '1:1', tone: 'unicast', t0: 0.66, t1: 1 }],
      tags: [{ text: '命中 A→1', tone: 'learn', x: 640, y: 58, t0: 0.44, t1: 0.96 }],
      pill: { 1: { text: '命中', tone: 'green' } }
    });

    st = addBeat(beats, st, {
      id: 'unicast3', group: 2, phase: '单播', frame: 'C→A', dur: 1.4,
      caption: '定向单播：只有 A 收到这一帧。',
      chips: [chip(P['1:1'], edge('A'), 'C→A', 'green', 0.12, 0.68)],
      ports: [{ key: '1:1', tone: 'unicast', t0: 0, t1: 0.74 }],
      receipts: [{ host: 'A', text: '收下', tone: 'green', t0: 0.7, t1: 0.94 }],
      tags: [{ text: '单播 1 口', tone: 'quiet', x: 302, y: 163, t0: 0.2, t1: 0.94 }],
      tally: { unicast: 1 },
      pill: { 1: { text: '单播', tone: 'green' } }
    });

    st = addBeat(beats, st, {
      id: 'aging', group: 3, phase: '老化', frame: '—', dur: 1.9,
      caption: 'A 的表项 300 s 没刷新，被老化删除。',
      tableChange: { sw: 1, kind: 'remove', mac: 'A', win: [0.16, 0.9] },
      lines: [{ key: 'dst', label: '寿命', value: 'A 的表项到期 → 删除', tone: 'quiet', win: [0.24, 0.46] }],
      tags: [{ text: '老化 300s', tone: 'quiet', x: 640, y: 58, t0: 0.12, t1: 0.96 }],
      pill: { 1: { text: '老化中', tone: 'gray' } }
    });

    st = addBeat(beats, st, {
      id: 'arrive4', group: 4, phase: '入帧', frame: 'D→A', dur: 1.15,
      caption: 'D 来找 A，进入端口 4。',
      chips: [chip(edge('D'), P['1:4'], 'D→A', 'blue')],
      ports: [{ key: '1:4', tone: 'rx', t0: 0.55, t1: 1 }],
      pill: { 1: { text: '收帧', tone: 'blue' } }
    });

    st = addBeat(beats, st, {
      id: 'learn4', group: 4, phase: '学习', frame: 'D→A', dur: 1.1,
      caption: '源 MAC 是 D：把 D 记在端口 4。',
      tableChange: { sw: 1, kind: 'insert', mac: 'D', to: 4, ttl: 300, win: [0.14, 0.58] },
      lines: [{ key: 'src', label: '源 MAC', value: 'D → 学到端口 4', tone: 'learn', win: [0.28, 0.48] }],
      ports: [{ key: '1:4', tone: 'rx', t0: 0, t1: 1 }],
      tags: [{ text: '记 D→4', tone: 'learn', x: 640, y: 58, t0: 0.4, t1: 1 }],
      pill: { 1: { text: '学习中', tone: 'green' } }
    });

    st = addBeat(beats, st, {
      id: 'lookup4', group: 4, phase: '查表', frame: 'D→A', dur: 1.0,
      caption: 'A 刚被老化，表里又查不到 A 了。',
      lines: [{ key: 'dst', label: '目的 MAC', value: 'A → 未命中', tone: 'flood', win: [0.26, 0.48] }],
      tags: [{ text: 'A 已老化', tone: 'flood', x: 640, y: 58, t0: 0.34, t1: 0.96 }],
      pill: { 1: { text: '查表中', tone: 'gold' } }
    });

    st = addBeat(beats, st, {
      id: 'flood4', group: 4, phase: '泛洪', frame: 'D→A', dur: 1.5,
      caption: '只好再次泛洪：A、B、C 都收到副本。',
      chips: [
        chip(P['1:1'], edge('A'), 'D→A', 'gold', 0.14, 0.6),
        chip(P['1:2'], edge('B'), 'D→A', 'gold', 0.14, 0.6),
        chip(P['1:3'], edge('C'), 'D→A', 'gold', 0.14, 0.6)
      ],
      ports: [
        { key: '1:1', tone: 'flood', t0: 0.08, t1: 0.66 },
        { key: '1:2', tone: 'flood', t0: 0.08, t1: 0.66 },
        { key: '1:3', tone: 'flood', t0: 0.08, t1: 0.66 }
      ],
      receipts: [
        { host: 'A', text: '收下', tone: 'green', t0: 0.62, t1: 0.94 },
        { host: 'B', text: '丢弃', tone: 'quiet', t0: 0.62, t1: 0.94 },
        { host: 'C', text: '丢弃', tone: 'quiet', t0: 0.62, t1: 0.94 }
      ],
      tags: [{ text: '再次泛洪', tone: 'flood', x: 302, y: 343, t0: 0.1, t1: 0.94 }],
      tally: { flood: 1 },
      pill: { 1: { text: '泛洪中', tone: 'gold' } }
    });

    return {
      id: 'single',
      geom: G,
      beats,
      groups: [
        { label: '① A→B 未知单播', from: 0 },
        { label: '② B→A 命中单播', from: 4 },
        { label: '③ C→A 命中单播', from: 8 },
        { label: '④ 表项老化', from: 12 },
        { label: '⑤ 老化后再发', from: 13 }
      ]
    };
  }

  // ---------- 双交换机兜圈推演 ----------

  function buildLoop(stp) {
    const G = LG;
    const P = G.ports;
    const edge = (id) => hostEdge(G, id);
    const beats = [];
    let st = state0();

    const push = (def) => {
      st = addBeat(beats, st, def);
    };

    push({
      id: 'send', group: 0, phase: '入帧', frame: 'A→B', dur: 1.15,
      caption: 'A 给 B 发一帧，进入交换机 1 的端口 1。',
      chips: [chip(edge('A'), P['1:1'], 'A→B', 'blue')],
      ports: [{ key: '1:1', tone: 'rx', t0: 0.55, t1: 1 }],
      pill: { 1: { text: '收帧', tone: 'blue' } }
    });

    push({
      id: 'learn1', group: 0, phase: '学习', frame: 'A→B', dur: 1.1,
      caption: '交换机 1 记下 A 在端口 1。',
      tableChange: { sw: 1, kind: 'insert', mac: 'A', to: 1, ttl: 300, win: [0.14, 0.58] },
      lines: [{ key: 'note1', value: '源 A → 端口 1', tone: 'learn', win: [0.28, 0.48] }],
      ports: [{ key: '1:1', tone: 'rx', t0: 0, t1: 1 }],
      tags: [{ text: '记 A→1', tone: 'learn', x: 360, y: 86, t0: 0.4, t1: 1 }],
      pill: { 1: { text: '学习中', tone: 'green' } }
    });

    if (!stp) {
      push({
        id: 'flood1', group: 0, phase: '泛洪', frame: 'A→B', dur: 1.55,
        caption: '表里没有 B：向 2、3、4 端口泛洪。',
        chips: [
          chip(P['1:2'], edge('C'), 'A→B', 'gold', 0.12, 0.56),
          chip(P['1:3'], P['2:1'], 'A→B', 'gold', 0.12, 0.72, -8),
          chip(P['1:4'], P['2:2'], 'A→B', 'gold', 0.12, 0.72, 8)
        ],
        ports: [
          { key: '1:2', tone: 'flood', t0: 0.06, t1: 0.62 },
          { key: '1:3', tone: 'flood', t0: 0.06, t1: 0.74 },
          { key: '1:4', tone: 'flood', t0: 0.06, t1: 0.74 }
        ],
        receipts: [{ host: 'C', text: '丢弃', tone: 'quiet', t0: 0.58, t1: 0.9 }],
        lines: [{ key: 'note1', value: '查 B 未命中 → 泛洪', tone: 'flood', win: [0.08, 0.26] }],
        tags: [{ text: '查无 B·泛洪', tone: 'flood', x: 360, y: 86, t0: 0.1, t1: 0.94 }],
        tally: { flood: 1 },
        pill: { 1: { text: '泛洪中', tone: 'gold' } }
      });

      push({
        id: 'arrive2', group: 1, phase: '双路抵达', frame: 'A→B', dur: 1.2,
        caption: '两条冗余链路各送一份副本进交换机 2。',
        chips: [
          chip(P['1:3'], P['2:1'], 'A→B', 'gold', 0.1, 0.66, -8),
          chip(P['1:4'], P['2:2'], 'A→B', 'gold', 0.1, 0.66, 8)
        ],
        lines: [{ key: 'note2', value: '两副本同时抵达', tone: 'warn', win: [0.6, 0.78] }],
        ports: [{ key: '2:1', tone: 'rx', t0: 0.6, t1: 1 }, { key: '2:2', tone: 'rx', t0: 0.6, t1: 1 }],
        tags: [{ text: '双副本抵达', tone: 'warn', x: 740, y: 86, t0: 0.62, t1: 0.98 }],
        pill: { 2: { text: '收帧', tone: 'blue' } }
      });

      push({
        id: 'learn2', group: 1, phase: '学习', frame: 'A→B', dur: 1.1,
        caption: '上路副本先到：记下 A 在端口 1。',
        tableChange: { sw: 2, kind: 'insert', mac: 'A', to: 1, ttl: 300, win: [0.14, 0.58] },
        lines: [{ key: 'note2', value: '源 A → 端口 1', tone: 'learn', win: [0.28, 0.48] }],
        ports: [{ key: '2:1', tone: 'rx', t0: 0, t1: 1 }],
        tags: [{ text: '记 A→1', tone: 'learn', x: 740, y: 86, t0: 0.4, t1: 0.98 }],
        pill: { 2: { text: '学习中', tone: 'green' } }
      });

      push({
        id: 'flap2', group: 1, phase: '震荡', frame: 'A→B', dur: 1.25,
        caption: '下路副本也来自 A：表项被改写成端口 2。',
        tableChange: { sw: 2, kind: 'update', mac: 'A', from: 1, to: 2, flap: true, win: [0.12, 0.62] },
        lines: [{ key: 'note2', value: '覆写为端口 2', tone: 'warn', win: [0.34, 0.54] }],
        ports: [{ key: '2:2', tone: 'rx', t0: 0, t1: 1 }],
        tags: [{ text: '改写到端口 2', tone: 'warn', x: 740, y: 86, t0: 0.5, t1: 0.98 }],
        pill: { 2: { text: '震荡', tone: 'red' } }
      });

      push({
        id: 'flood2', group: 1, phase: '泛洪', frame: 'A→B', dur: 1.7,
        caption: '泛洪到 B 和 D：B 收到两份重复帧。',
        chips: [
          chip(P['2:3'], edge('B'), 'A→B', 'gold', 0.08, 0.46, -10),
          chip(P['2:3'], edge('B'), 'A→B', 'gold', 0.3, 0.68, 10),
          chip(P['2:4'], edge('D'), 'A→B', 'gold', 0.14, 0.52, 10)
        ],
        ports: [
          { key: '2:3', tone: 'flood', t0: 0.04, t1: 0.7 },
          { key: '2:4', tone: 'flood', t0: 0.04, t1: 0.58 }
        ],
        receipts: [
          { host: 'B', text: '×2 重复', tone: 'warn', t0: 0.62, t1: 0.96 },
          { host: 'D', text: '丢弃', tone: 'quiet', t0: 0.54, t1: 0.9 }
        ],
        lines: [{ key: 'note2', value: '泛洪 3、4 与回程', tone: 'flood', win: [0.06, 0.24] }],
        tags: [{ text: 'B 收到 2 份', tone: 'warn', x: 995, y: 86, t0: 0.64, t1: 0.98 }],
        copies: 2,
        pill: { 2: { text: '泛洪中', tone: 'gold' } }
      });

      push({
        id: 'back1', group: 2, phase: '倒灌', frame: 'A→B', dur: 1.35,
        caption: '两份副本沿两条链路倒灌回交换机 1。',
        chips: [
          chip(P['2:1'], P['1:3'], 'A→B', 'red', 0.1, 0.72, -8),
          chip(P['2:2'], P['1:4'], 'A→B', 'red', 0.1, 0.72, 8)
        ],
        ports: [
          { key: '2:1', tone: 'flood', t0: 0.04, t1: 0.74 },
          { key: '2:2', tone: 'flood', t0: 0.04, t1: 0.74 }
        ],
        lines: [
          { key: 'note1', value: '副本回到 3、4 口', tone: 'warn', win: [0.4, 0.6] },
          { key: 'note2', value: '', tone: 'idle', win: [0.1, 0.24] }
        ],
        tags: [{ text: '倒灌 SW1', tone: 'warn', x: 550, y: 270, t0: 0.36, t1: 0.98 }]
      });

      push({
        id: 'flap1', group: 2, phase: '震荡', frame: 'A→B', dur: 1.25,
        caption: '交换机 1 以为 A 搬到了端口 4。',
        tableChange: { sw: 1, kind: 'update', mac: 'A', from: 1, to: 4, flap: true, win: [0.12, 0.62] },
        lines: [
          { key: 'note1', value: '覆写为端口 4', tone: 'warn', win: [0.34, 0.54] },
          { key: 'note2', value: '', tone: 'idle', win: [0.02, 0.1] }
        ],
        ports: [{ key: '1:4', tone: 'rx', t0: 0, t1: 1 }],
        tags: [{ text: '表项改成端口 4', tone: 'warn', x: 360, y: 86, t0: 0.5, t1: 0.98 }],
        pill: { 1: { text: '震荡', tone: 'red' } }
      });

      push({
        id: 'flap1b', group: 2, phase: '震荡', frame: 'A→B', dur: 1.45,
        caption: '第二份又把表项改成端口 3，环路闭合。',
        tableChange: { sw: 1, kind: 'update', mac: 'A', from: 4, to: 3, flap: true, win: [0.1, 0.52] },
        chips: [chip(P['1:1'], edge('A'), 'A→B', 'red', 0.52, 0.94)],
        ports: [{ key: '1:3', tone: 'rx', t0: 0, t1: 0.6 }, { key: '1:1', tone: 'flood', t0: 0.5, t1: 1 }],
        lines: [{ key: 'note1', value: '覆写为端口 3', tone: 'warn', win: [0.16, 0.34] }],
        receipts: [{ host: 'A', text: '自身副本', tone: 'warn', t0: 0.88, t1: 1 }],
        tags: [{ text: '又改成端口 3', tone: 'warn', x: 360, y: 86, t0: 0.24, t1: 0.9 }],
        pill: { 1: { text: '震荡', tone: 'red' } }
      });

      push({
        id: 'storm', group: 3, phase: '风暴', frame: 'A→B', dur: 8.0,
        storm: true,
        caption: 'MAC 帧没有 TTL：副本永远兜圈，越积越多。',
        ports: [
          { key: '1:3', tone: 'flood', t0: 0, t1: 1 },
          { key: '1:4', tone: 'flood', t0: 0, t1: 1 },
          { key: '2:1', tone: 'flood', t0: 0, t1: 1 },
          { key: '2:2', tone: 'flood', t0: 0, t1: 1 }
        ],
        lines: [
          { key: 'note1', value: '表项反复覆写', tone: 'warn', win: [0.02, 0.16] },
          { key: 'note2', value: '表项反复覆写', tone: 'warn', win: [0.02, 0.16] }
        ],
        pill: { 1: { text: '反复覆写', tone: 'red' }, 2: { text: '反复覆写', tone: 'red' } },
        tags: [{ text: '没有 TTL', tone: 'warn', x: 550, y: 62, t0: 0.04, t1: 1, persist: true }]
      });
    } else {
      push({
        id: 'block', group: 0, phase: '生成树', frame: 'A→B', dur: 1.35,
        caption: '生成树生效：交换机 2 的端口 2 被阻塞。',
        block: ['2:2'],
        lines: [{ key: 'note2', value: '端口 2 被阻塞', tone: 'blue', win: [0.34, 0.52] }],
        tags: [{ text: '阻塞端口 2', tone: 'key', x: 740, y: 86, t0: 0.2, t1: 0.98 }],
        pill: { 2: { text: '部分阻塞', tone: 'blue' } }
      });

      push({
        id: 'flood1', group: 0, phase: '泛洪', frame: 'A→B', dur: 1.7,
        caption: '泛洪照旧，但下路副本在阻塞口被丢弃。',
        chips: [
          chip(P['1:2'], edge('C'), 'A→B', 'gold', 0.1, 0.5),
          chip(P['1:3'], P['2:1'], 'A→B', 'gold', 0.1, 0.66, -8),
          chip(P['1:4'], { x: 600, y: 370 }, 'A→B', 'gold', 0.1, 0.6, 8)
        ],
        ports: [
          { key: '1:2', tone: 'flood', t0: 0.06, t1: 0.56 },
          { key: '1:3', tone: 'flood', t0: 0.06, t1: 0.68 },
          { key: '1:4', tone: 'flood', t0: 0.06, t1: 0.62 }
        ],
        receipts: [
          { host: 'C', text: '丢弃', tone: 'quiet', t0: 0.52, t1: 0.86 },
          { host: 'SW2 端口 2', text: '阻塞丢弃', tone: 'warn', t0: 0.6, t1: 0.94 }
        ],
        lines: [{ key: 'note1', value: '查 B 未命中 → 泛洪', tone: 'flood', win: [0.06, 0.24] }],
        tags: [{ text: '查无 B·泛洪', tone: 'flood', x: 360, y: 86, t0: 0.08, t1: 0.92 }],
        tally: { flood: 1 },
        pill: { 1: { text: '泛洪中', tone: 'gold' } }
      });

      push({
        id: 'learn2', group: 1, phase: '学习', frame: 'A→B', dur: 1.1,
        caption: '只有上路副本进来：记下 A 在端口 1。',
        tableChange: { sw: 2, kind: 'insert', mac: 'A', to: 1, ttl: 300, win: [0.14, 0.58] },
        lines: [{ key: 'note2', value: '源 A → 端口 1', tone: 'learn', win: [0.28, 0.48] }],
        lines: [{ key: 'note2', value: '源 A → 端口 1', tone: 'learn', win: [0.28, 0.48] }],
        ports: [{ key: '2:1', tone: 'rx', t0: 0, t1: 1 }],
        tags: [{ text: '记 A→1', tone: 'learn', x: 740, y: 86, t0: 0.4, t1: 0.98 }],
        pill: { 2: { text: '学习中', tone: 'green' } }
      });

      push({
        id: 'forward', group: 1, phase: '单播', frame: 'A→B', dur: 1.55,
        caption: '环路断开，B 只收到一份，表项不再震荡。',
        lines: [{ key: 'note2', value: '命中 → 端口 3', tone: 'learn', win: [0.2, 0.36] }],
        connector: { mac: 'A', to: '2:3', t0: 0.2, t1: 0.46, tone: 'green' },
        chips: [chip(P['2:3'], edge('B'), 'A→B', 'green', 0.48, 0.86)],
        ports: [{ key: '2:3', tone: 'unicast', t0: 0.44, t1: 0.92 }],
        receipts: [{ host: 'B', text: '收下 1 份', tone: 'green', t0: 0.84, t1: 1 }],
        tags: [{ text: '单播到 B', tone: 'learn', x: 995, y: 86, t0: 0.7, t1: 1 }],
        copies: 1,
        tally: { unicast: 1 },
        pill: { 2: { text: '命中', tone: 'green' } }
      });
    }

    return {
      id: 'loop',
      stp: Boolean(stp),
      geom: G,
      beats,
      groups: stp
        ? [
            { label: '① 发帧与阻塞', from: 0 },
            { label: '② 唯一的转发路径', from: 2 }
          ]
        : [
            { label: '① A 发帧 · 泛洪', from: 0 },
            { label: '② 双路抵 SW2 · 震荡', from: 2 },
            { label: '③ 倒灌 SW1', from: 7 },
            { label: '④ 无休止兜圈', from: 9 }
          ]
    };
  }

  // ---------- 画面：由（步，步内进度）算出这一刻 ----------

  const EMPTY_ROW = { empty: true, alpha: 0, dy: 0, sy: 1, tone: '', shake: 0, mac: '', port: '', ttl: null };

  function mkRow(r, alpha, dy, sy, tone, shake) {
    if (!r) return { ...EMPTY_ROW };
    return {
      empty: false,
      mac: r.mac,
      port: r.port,
      ttl: r.ttl,
      alpha: alpha == null ? 1 : alpha,
      dy: dy || 0,
      sy: sy == null ? 1 : sy,
      tone: tone || '',
      shake: shake || 0
    };
  }

  function tableSlots(beat, q, swKey, rowH, slotCount) {
    const before = beat.before.tables[swKey] || [];
    const after = beat.after.tables[swKey] || [];
    const N = slotCount || 4;
    const ch = beat.tableChange && String(beat.tableChange.sw) === swKey ? beat.tableChange : null;
    const slots = [];

    if (!ch) {
      for (let j = 0; j < N; j++) slots.push(mkRow(after[j], 1, 0, 1, after[j] && after[j].bad ? 'warn' : ''));
      return slots;
    }

    const w = ch.win || [0.15, 0.6];
    const qq = win(q, w[0], w[1]);

    if (ch.kind === 'insert') {
      const k = after.findIndex((r) => r.mac === ch.mac);
      for (let j = 0; j < N; j++) {
        const r = after[j];
        if (j === k) {
          const a = ease(qq);
          slots.push(mkRow(r, a, -10 * (1 - a), 1, qq > 0.1 && qq < 0.9 ? 'learn' : ''));
        } else {
          slots.push(mkRow(r, 1, 0, 1, r && r.bad ? 'warn' : ''));
        }
      }
      return slots;
    }

    if (ch.kind === 'update') {
      const k = after.findIndex((r) => r.mac === ch.mac);
      const wasBad = Boolean(before[k] && before[k].bad);
      for (let j = 0; j < N; j++) {
        const r = after[j];
        if (j !== k) {
          slots.push(mkRow(r, 1, 0, 1, r && r.bad ? 'warn' : ''));
          continue;
        }
        const shown = { ...r, port: qq < 0.5 ? (ch.from == null ? r.port : ch.from) : r.port };
        const sy = Math.abs(1 - 2 * qq);
        const shake = ch.flap ? Math.sin(qq * Math.PI * 7) * 4 * (1 - qq) : 0;
        slots.push(mkRow(shown, 1, 0, Math.max(0.18, sy), wasBad || qq > 0.45 ? 'warn' : '', shake));
      }
      return slots;
    }

    if (ch.kind === 'remove') {
      const k = before.findIndex((r) => r.mac === ch.mac);
      if (qq >= 1) {
        for (let j = 0; j < N; j++) slots.push(mkRow(after[j], 1, 0, 1, ''));
        return slots;
      }
      const holdEnd = w[0] + (w[1] - w[0]) * 0.55;
      for (let j = 0; j < N; j++) {
        const r = before[j];
        if (!r) {
          slots.push(mkRow(after[j - (j > k ? 1 : 0)], 1, 0, 1, ''));
          continue;
        }
        if (j === k) {
          const ttl = Math.round(lerp(r.ttl, 0, ease(win(q, w[0], holdEnd))));
          const alpha = 1 - ease(win(q, holdEnd, w[1]));
          slots.push(mkRow({ ...r, ttl }, alpha, -4 * (1 - alpha), 1, 'gray'));
        } else {
          slots.push(mkRow(r, 1, j > k ? -rowH * ease(qq) : 0, 1, r.bad ? 'warn' : ''));
        }
      }
      return slots;
    }

    for (let j = 0; j < N; j++) slots.push(mkRow(after[j], 1, 0, 1, ''));
    return slots;
  }

  function chipViews(beat, q) {
    const out = [];
    (beat.chips || []).forEach((c) => {
      const k = win(q, c.t0, c.t1);
      if (k <= 0 || k >= 1) return;
      const pt = pointAt(c.path, k);
      const fadeIn = Math.min(1, k / 0.14);
      const fadeOut = Math.min(1, (1 - k) / 0.07);
      out.push({
        x: pt.x,
        y: pt.y,
        alpha: Math.min(fadeIn, fadeOut),
        tone: c.tone,
        label: c.label,
        trail: pathD(subPath(c.path, k * 0.985)),
        scale: 0.86 + 0.14 * Math.min(1, k / 0.12)
      });
    });
    return out;
  }

  function portViews(beat, q, G) {
    const map = {};
    Object.keys(G.ports).forEach((k) => {
      map[k] = { tone: 'idle', ring: 0 };
    });
    // 阻塞端口的出现有自己的时刻：窗口之前仍按步首状态显示
    const blockAt = beat.blockAt == null ? 0.32 : beat.blockAt;
    const blocked = beat.block && q >= blockAt ? beat.after.blocked : beat.before.blocked;
    (blocked || []).forEach((k) => {
      if (map[k]) map[k] = { tone: 'blocked', ring: 0 };
    });
    if (beat.block && q >= blockAt) {
      const k = win(q, blockAt, blockAt + 0.35);
      if (k > 0 && k < 1) {
        beat.after.blocked.forEach((key) => {
          if (map[key]) map[key] = { tone: 'blocked', ring: 1 - k };
        });
      }
    }
    (beat.ports || []).forEach((p) => {
      const k = win(q, p.t0, p.t1);
      if (k <= 0 || k >= 1) return;
      if (map[p.key] && map[p.key].tone === 'blocked' && p.tone === 'rx') return;
      map[p.key] = { tone: p.tone, ring: k < 0.55 ? 1 - k / 0.55 : 0 };
    });
    return map;
  }

  function tagViews(beat, q) {
    return (beat.tags || [])
      .map((t) => {
        if (q < t.t0) return null;
        const inK = Math.min(1, (q - t.t0) / 0.12);
        const outK = t.persist || t.t1 >= 1 ? 1 : Math.min(1, (t.t1 - q) / 0.16);
        const alpha = Math.max(0, Math.min(inK, outK));
        return {
          x: t.x,
          y: t.y - 6 * (1 - ease(inK)),
          text: t.text,
          tone: t.tone,
          alpha
        };
      })
      .filter(Boolean);
  }

  function receiptViews(beat, q, G) {
    return (beat.receipts || [])
      .map((r) => {
        const k = win(q, r.t0, r.t1);
        if (k <= 0 || k >= 1) return null;
        const alpha = Math.min(1, k / 0.16) * Math.min(1, (1 - k) / 0.14);
        const host = G.hosts[r.host];
        let x;
        let y;
        if (host) {
          const port = G.ports[host.port];
          const right = port.x >= host.x;
          x = right ? host.x + host.w / 2 + 46 : host.x - host.w / 2 - 46;
          y = host.y - 26;
        } else {
          x = 560;
          y = 336;
        }
        return { x, y, text: r.text, tone: r.tone, alpha };
      })
      .filter(Boolean);
  }

  function lineView(beat, q, key) {
    const b = beat.before.lines[key] || { label: '', value: '', tone: 'idle' };
    const entry = (beat.lines || []).find((l) => l.key === key);
    const a = beat.after.lines[key];
    const same = b.label === a.label && b.value === a.value && b.tone === a.tone;
    if (!entry || same) return { label: a.label, value: a.value, tone: a.tone, sy: 1 };
    const w = entry.win || [0.26, 0.46];
    const qq = win(q, w[0], w[1]);
    if (qq <= 0) return { label: b.label, value: b.value, tone: b.tone, sy: 1 };
    if (qq >= 1) return { label: a.label, value: a.value, tone: a.tone, sy: 1 };
    return {
      label: qq < 0.5 ? b.label : a.label,
      value: qq < 0.5 ? b.value : a.value,
      tone: qq < 0.5 ? b.tone : a.tone,
      sy: Math.max(0.15, Math.abs(1 - 2 * qq))
    };
  }

  function connectorView(beat, q, G) {
    const c = beat.connector;
    if (!c) return null;
    const k = win(q, c.t0, c.t1);
    if (k <= 0) return null;
    const port = G.ports[c.to];
    if (!port) return null;
    const sw = G.switches[port.sw];
    if (!sw) return null;
    const rows = beat.after.tables[String(port.sw)] || [];
    const rowIndex = rows.findIndex((r) => r.mac === c.mac);
    if (rowIndex < 0) return null;
    const portCol = sw.table.cols.find((col) => col.key === 'port');
    const y = sw.table.y + sw.table.headH + rowIndex * sw.table.rowH + sw.table.rowH / 2;
    const rowTop = sw.table.y + sw.table.headH + rowIndex * sw.table.rowH;
    const from = { x: portCol.x, y: rowTop + 2 };
    const pts = curve(from, { x: port.x + 14, y: rowTop + 2 }, { x: port.x, y: port.y }, 18);
    const line = poly(pts);
    const drawn = subPath(line, ease(k));
    return {
      d: pathD(drawn),
      alpha: k >= 1 ? 0.55 : 0.95,
      tone: c.tone,
      from,
      dot: ease(win(k, 0, 0.25))
    };
  }

  function stormView(beat, q, G) {
    const ring = poly(G.loopPath);
    const turns = (q * beat.dur) / 1.5;
    const chips = [];
    for (let j = 0; j < 3; j++) {
      const k = (turns + j / 3) % 1;
      const pt = pointAt(ring, k);
      chips.push({
        x: pt.x,
        y: pt.y,
        alpha: (0.95 - j * 0.12) * Math.min(1, q / 0.05),
        tone: 'red',
        label: 'A→B',
        trail: pathD(pathSegment(ring, Math.max(0, k - 0.16), k, 12)),
        scale: 1
      });
    }
    const flapPhase = Math.floor(q * beat.dur * 2.5) % 2;
    const empty = () => ({ ...EMPTY_ROW });
    // 从步首的端口出发抖动，保证与上一步末尾连续
    const base1 = (beat.before.tables[1][0] || { port: 3 }).port;
    const base2 = (beat.before.tables[2][0] || { port: 2 }).port;
    const flip = (base) => (base === 3 ? 4 : base === 4 ? 3 : base === 1 ? 2 : 1);
    const makeRows = (port, wobble) => {
      const rows = [
        { mac: 'A', port: flapPhase ? flip(port) : port, ttl: 300, alpha: 1, dy: 0, sy: 1, tone: 'warn', shake: Math.sin(q * 60 + wobble) * 2.5 }
      ];
      for (let j = 1; j < G.switches[1].table.slots; j++) rows.push(empty());
      return rows;
    };
    const rows1 = makeRows(base1, 0);
    const rows2 = makeRows(base2, 1);
    return {
      chips,
      rows: { 1: rows1, 2: rows2 },
      ring: { alpha: 0.85, dash: -(turns * 30) % 26 },
      copies: beat.before.copies + Math.floor(q * beat.dur * 2.2),
      meter: clamp((beat.before.copies + q * beat.dur * 2.2) / 24, 0, 1)
    };
  }

  function frameOf(seq, i, p) {
    const N = seq.beats.length;
    const idx = clamp(Math.floor(Number(i) || 0), 0, N - 1);
    const beat = seq.beats[idx];
    const q = clamp(Number(p) || 0, 0, 1);
    const G = seq.geom;

    const out = {
      index: idx,
      count: N,
      phase: beat.phase,
      caption: beat.caption,
      frame: beat.frame || '',
      rows: {},
      pills: {},
      chips: [],
      ports: portViews(beat, q, G),
      tags: tagViews(beat, q),
      receipts: receiptViews(beat, q, G),
      connector: connectorView(beat, q, G),
      lines: {},
      stats: [],
      storm: null,
      meter: null
    };

    Object.keys(G.switches).forEach((sw) => {
      out.rows[sw] = tableSlots(beat, q, String(sw), G.switches[sw].table.rowH, G.switches[sw].table.slots);
      const pill = (beat.pill || {})[sw];
      out.pills[sw] = pill ? { text: pill.text, tone: pill.tone } : { text: '空闲', tone: 'idle' };
    });

    let stormCopies = null;
    if (beat.storm) {
      const sv = stormView(beat, q, G);
      out.chips = sv.chips;
      out.rows = sv.rows;
      out.storm = sv.ring;
      out.meter = sv.meter;
      out.copies = sv.copies;
      stormCopies = sv.copies;
    } else {
      out.chips = chipViews(beat, q);
      out.copies = q >= 0.62 ? beat.after.copies : beat.before.copies;
    }

    Object.keys(beat.after.lines).forEach((key) => {
      out.lines[key] = lineView(beat, q, key);
    });

    // 底部计数：先显示旧值，回执窗口后切到新值并弹一下
    const settled = q >= 0.62;
    const pop = (at) => (q >= at ? 1 + 0.18 * (1 - ease(win(q, at, at + 0.3))) : 1);

    if (seq.id === 'single') {
      const tallyVal = (key) => (settled ? beat.after.tally[key] : beat.before.tally[key]);
      const countOf = (st) => (st.tables[1] || []).length;
      out.stats = [
        { value: tallyVal('flood'), unit: '次', tone: 'flood', pop: beat.tally && beat.tally.flood && q >= 0.6 ? pop(0.6) : 1 },
        { value: tallyVal('unicast'), unit: '次', tone: 'green', pop: beat.tally && beat.tally.unicast && q >= 0.6 ? pop(0.6) : 1 },
        {
          value: countOf(settled ? beat.after : beat.before),
          unit: '条',
          tone: 'ink',
          pop: beat.tableChange && q >= 0.5 ? pop(0.5) : 1
        }
      ];
    } else {
      const copies = stormCopies != null ? stormCopies : settled ? beat.after.copies : beat.before.copies;
      out.stats = [{ value: copies, unit: '份', tone: copies > 1 ? 'red' : 'ink', pop: beat.storm || (beat.copies != null && q >= 0.6) ? pop(0.6) : 1 }];
    }

    return out;
  }

  function beatStarts(seq) {
    const starts = [];
    let t = 0;
    seq.beats.forEach((b) => {
      starts.push(t);
      t += b.dur;
    });
    return { starts, total: t };
  }

  function locate(seq, t) {
    const { starts, total } = beatStarts(seq);
    const time = clamp(Number(t) || 0, 0, total);
    let i = 0;
    for (let k = 0; k < starts.length; k++) {
      if (time >= starts[k]) i = k;
    }
    const p = Math.min(1, (time - starts[i]) / (seq.beats[i].dur || 1));
    return { index: i, p, total };
  }

  const api = {
    HOST_MAC,
    SG,
    LG,
    buildSingle,
    buildLoop,
    frameOf,
    beatStarts,
    locate,
    pointAt,
    subPath,
    pathD,
    poly,
    hostEdge,
    win,
    ease
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EtherModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
