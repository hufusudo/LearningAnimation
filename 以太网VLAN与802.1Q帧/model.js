/**
 * 以太网 VLAN 与 802.1Q 帧流动 · 拓扑几何与时刻表（纯计算，不碰 DOM）。
 *
 * 舞台是一个固定 viewBox 的沙盘：两台交换机、端口槽、主机、广播域带、内部总线与 Trunk 链路，
 * 所有坐标都由 buildLayout() 算出，渲染与单测共用同一份几何，不测量 DOM。
 * 六步时刻表在 STEPS 中：每步有阶段名、作用域、一句解说与时长；画面由 choreo.js 从（步，进度）算出。
 */
(function (root) {
  'use strict';

  const GEO = Object.freeze({
    stageW: 1120,
    stageH: 386,
    bodyTop: 16,
    bodyH: 180,
    busY: 112,          // 内部总线（也是 Trunk 端口与跨链路的高度）
    anchorY: 132,       // 帧在端口上方的停留点
    fabricY: 78,        // VLAN 转发表芯片中心
    fabricW: 104,
    fabricH: 28,
    portTop: 152,
    portW: 52,
    portH: 44,
    portGap: 5,
    groupGap: 14,
    trunkW: 56,
    trunkH: 34,
    hostTop: 284,
    hostW: 52,
    hostH: 44,
    bandTop: 272,
    bandH: 84,
    bandLabelY: 342,
    resultY: 372
  });

  const HOST_META = Object.freeze({
    A: { badge: 'A', role: '主机' },
    B: { badge: 'B', role: '主机' },
    T3: { badge: '3', role: '终端' },
    T4: { badge: '4', role: '终端' },
    C: { badge: 'C', role: '主机' },
    D: { badge: 'D', role: '主机' },
    T7: { badge: '7', role: '终端' },
    E: { badge: 'E', role: '主机' },
    T9: { badge: 'E2', role: '终端' },
    F: { badge: 'F', role: '主机' },
    T10: { badge: 'F2', role: '终端' },
    T11: { badge: 'F3', role: '终端' }
  });

  const SWITCH_SPECS = [
    {
      id: 'sw1',
      title: '交换机 1',
      code: 'SW1 · Access P1–P7 · Trunk P8',
      x: 60,
      w: 440,
      trunk: { id: 'P8', side: 'right' },
      ports: [
        { id: 'P1', vid: 10, host: 'A' },
        { id: 'P2', vid: 10, host: 'B' },
        { id: 'P3', vid: 10, host: 'T3' },
        { id: 'P4', vid: 10, host: 'T4' },
        { id: 'P5', vid: 20, host: 'C' },
        { id: 'P6', vid: 20, host: 'D' },
        { id: 'P7', vid: 20, host: 'T7' }
      ]
    },
    {
      id: 'sw2',
      title: '交换机 2',
      code: 'SW2 · Access P2–P6 · Trunk P1',
      x: 620,
      w: 440,
      trunk: { id: 'P1', side: 'left' },
      ports: [
        { id: 'P2', vid: 10, host: 'E' },
        { id: 'P3', vid: 10, host: 'T9' },
        { id: 'P4', vid: 20, host: 'F' },
        { id: 'P5', vid: 20, host: 'T10' },
        { id: 'P6', vid: 20, host: 'T11' }
      ]
    }
  ];

  function buildLayout() {
    const switches = {};
    const ports = {};
    const hosts = {};
    const bands = {};

    SWITCH_SPECS.forEach((spec) => {
      // 按 VID 分组，组间留更宽的间隔，让"同 VLAN 的一组端口"在形上就能看出来
      const groups = [];
      spec.ports.forEach((pt) => {
        const g = groups[groups.length - 1];
        if (g && g.vid === pt.vid) g.ids.push(pt.id);
        else groups.push({ vid: pt.vid, ids: [pt.id] });
      });

      const n = spec.ports.length;
      const between = groups.length - 1;
      const total = n * GEO.portW + (n - 1 - between) * GEO.portGap + between * GEO.groupGap;
      const list = [];
      let cursor = spec.x + (spec.w - total) / 2;

      spec.ports.forEach((pt, i) => {
        const key = spec.id + ':' + pt.id;
        const item = {
          key,
          sw: spec.id,
          id: pt.id,
          vid: pt.vid,
          host: pt.host,
          kind: 'access',
          x1: cursor,
          x2: cursor + GEO.portW,
          cx: cursor + GEO.portW / 2,
          y1: GEO.portTop,
          y2: GEO.portTop + GEO.portH,
          cy: GEO.portTop + GEO.portH / 2
        };
        list.push(item);
        ports[key] = item;
        if (i < n - 1) cursor += GEO.portW + (spec.ports[i + 1].vid !== pt.vid ? GEO.groupGap : GEO.portGap);
      });

      groups.forEach((g) => {
        const members = g.ids.map((id) => ports[spec.id + ':' + id]);
        const first = members[0];
        const last = members[members.length - 1];
        const x1 = first.x1 - 8;
        const x2 = last.x2 + 8;
        bands[spec.id + ':' + g.vid] = {
          key: spec.id + ':' + g.vid,
          sw: spec.id,
          vid: g.vid,
          x1,
          x2,
          cx: (x1 + x2) / 2,
          top: GEO.bandTop,
          h: GEO.bandH,
          label: 'VLAN ' + g.vid + ' 广播域 · ' + first.id + '–' + last.id
        };
      });

      const side = spec.trunk.side;
      const trunk = {
        key: spec.id + ':' + spec.trunk.id,
        sw: spec.id,
        id: spec.trunk.id,
        kind: 'trunk',
        side,
        x1: side === 'right' ? spec.x + spec.w - GEO.trunkW : spec.x,
        x2: side === 'right' ? spec.x + spec.w : spec.x + GEO.trunkW,
        y1: GEO.busY - GEO.trunkH / 2,
        y2: GEO.busY + GEO.trunkH / 2,
        cy: GEO.busY
      };
      trunk.cx = (trunk.x1 + trunk.x2) / 2;
      ports[trunk.key] = trunk;

      switches[spec.id] = {
        id: spec.id,
        title: spec.title,
        code: spec.code,
        x: spec.x,
        y: GEO.bodyTop,
        w: spec.w,
        h: GEO.bodyH,
        x2: spec.x + spec.w,
        y2: GEO.bodyTop + GEO.bodyH,
        fabric: { cx: spec.x + spec.w / 2, cy: GEO.fabricY },
        bus: {
          x1: side === 'left' ? spec.x : spec.x + 24,
          x2: side === 'right' ? spec.x + spec.w : spec.x + spec.w - 24,
          y: GEO.busY
        },
        map: groups.map((g) => ({
          vid: g.vid,
          text: 'VID ' + g.vid + ' → ' + g.ids[0] + (g.ids.length > 1 ? '–' + g.ids[g.ids.length - 1] : ''),
          ids: g.ids.slice()
        })),
        ports: list.map((pt) => pt.key),
        trunk: trunk.key
      };

      list.forEach((pt) => {
        const meta = HOST_META[pt.host];
        hosts[pt.host] = {
          id: pt.host,
          badge: meta.badge,
          role: meta.role,
          cx: pt.cx,
          top: GEO.hostTop,
          bottom: GEO.hostTop + GEO.hostH,
          cy: GEO.hostTop + GEO.hostH / 2,
          w: GEO.hostW,
          h: GEO.hostH,
          vid: pt.vid,
          sw: spec.id,
          port: pt.key
        };
      });
    });

    return { switches, ports, hosts, bands };
  }

  const LAYOUT = buildLayout();

  const STEPS = Object.freeze([
    {
      id: 'send',
      phase: '发送',
      scope: 'A → P1 · 未打标',
      dur: 1.8,
      narr: '主机 A 发出标准以太网帧：没有标签，交换机还不知道它属于哪个 VLAN。'
    },
    {
      id: 'tag',
      phase: '打标',
      scope: 'P1 的 PVID = 10 → 加 4B 标签',
      dur: 2.4,
      narr: 'Access 口按 PVID 10 打标：帧长 1518 → 1522 B。'
    },
    {
      id: 'fanout',
      phase: '转发',
      scope: 'VID 10 → P2 · P3 · P4',
      dur: 3.2,
      narr: '交换机按 VID 10 查表，把帧复制给同一广播域的 P2、P3、P4。'
    },
    {
      id: 'isolate',
      phase: '隔离',
      scope: 'VID 10 ✕ VLAN 20（P5–P7）',
      dur: 2.2,
      narr: 'P5–P7 属于 VLAN 20：帧不会从这些端口送出，这就是 VLAN 隔离。'
    },
    {
      id: 'trunk',
      phase: '中继',
      scope: 'P8 ↔ P1 · 标签保留',
      dur: 2.6,
      narr: 'Trunk 链路保留标签：对端靠 VID 10 判断帧属于哪个 VLAN。'
    },
    {
      id: 'deliver',
      phase: '交付',
      scope: 'VID 10 → P2 · P3 · 出向剥标',
      dur: 3.2,
      narr: 'SW2 只送给 VLAN 10 的 P2、P3，剥标后 E 收到的仍是标准帧。'
    }
  ]);

  function buildRun() {
    const steps = STEPS.map((s) => ({ ...s }));
    const bounds = [];
    let acc = 0;
    steps.forEach((s) => {
      bounds.push(acc);
      acc += s.dur;
    });
    return { steps, bounds, total: acc, N: steps.length };
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function sampleAt(run, t) {
    const T = clamp(Number.isFinite(t) ? t : 0, 0, run.total);
    let index = run.N - 1;
    for (let k = 0; k < run.N; k++) {
      if (T < run.bounds[k] + run.steps[k].dur) {
        index = k;
        break;
      }
    }
    const dur = run.steps[index].dur;
    const p = clamp((T - run.bounds[index]) / dur, 0, 1);
    return { index, p, t: T, start: run.bounds[index], end: run.bounds[index] + dur };
  }

  // 第 i 步的结束时刻（用于单步跳转，取向前一点点以停在步末画面上）
  function stepEnd(run, i) {
    return run.bounds[i] + run.steps[i].dur;
  }

  const api = {
    GEO,
    STEPS,
    LAYOUT,
    buildRun,
    sampleAt,
    stepEnd
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VlanModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
