/**
 * VLAN · 帧流动的画面编排（纯函数）。
 *
 * world(index, p) 只由「第几步 + 步内进度」算出这一刻的画面：
 * 帧的位置/标签/透明度、端口发光与 ✕、主机的 ✓ 回执、广播域压暗、查表高亮、浮标与结论。
 * 不读 DOM、不读上一帧，因此拖动、倒退、单步都能精确重绘；上一步终点与下一步步首的画面相等（单测锁定）。
 */
(function (root) {
  'use strict';

  const M = typeof module === 'object' && module.exports ? require('./model.js') : root.VlanModel;
  const G = M.GEO;
  const L = M.LAYOUT;

  // ---------- 帧芯片的字段几何（未打标 112，打标后 +44） ----------
  const CELLS = Object.freeze([
    { key: 'da', w: 22, label: 'DA' },
    { key: 'sa', w: 22, label: 'SA' },
    { key: 'tag', w: 46, label: 'VID 10' },
    { key: 'type', w: 28, label: 'Type' },
    { key: 'data', w: 30, label: 'Data' },
    { key: 'fcs', w: 20, label: 'FCS' }
  ]);
  const FRAME_H = 30;
  const FRAME_BASE = CELLS.filter((c) => c.key !== 'tag').reduce((a, c) => a + c.w, 0);
  const FRAME_TAG = CELLS.find((c) => c.key === 'tag').w;
  const GHOST_SCALE = 0.46;

  // ---------- 时间表（步内 0–1） ----------
  // SW1 同 VLAN 转发：出总线 → 到端口上方 → 剥标 → 下降进主机
  const SW1_FAN = Object.freeze([
    { key: 'sw1:P2', t0: 0.26, arrive: 0.48, strip: [0.575, 0.63], down: [0.55, 0.73], recv: [0.73, 0.78] },
    { key: 'sw1:P3', t0: 0.32, arrive: 0.54, strip: [0.635, 0.69], down: [0.61, 0.79], recv: [0.79, 0.84] },
    { key: 'sw1:P4', t0: 0.38, arrive: 0.60, strip: [0.695, 0.75], down: [0.67, 0.85], recv: [0.85, 0.895] }
  ]);
  // SW1 异 VLAN：三条"试探"在中途消散，随后端口出现 ✕
  const SW1_BLOCK = Object.freeze([
    { key: 'sw1:P5', t0: 0.14, mark: [0.42, 0.50] },
    { key: 'sw1:P6', t0: 0.17, mark: [0.45, 0.53] },
    { key: 'sw1:P7', t0: 0.20, mark: [0.48, 0.56] }
  ]);
  // SW2 交付：P2 由主帧送达，P3 由副本送达
  const SW2_DELIVER = Object.freeze([
    { key: 'sw2:P2', t0: 0.04, arrive: 0.28, strip: [0.44, 0.50], down: [0.42, 0.66], recv: [0.68, 0.74] },
    { key: 'sw2:P3', t0: 0.10, arrive: 0.46, strip: [0.58, 0.64], down: [0.62, 0.80], recv: [0.80, 0.86] }
  ]);
  const SW2_BLOCK = Object.freeze([
    { key: 'sw2:P4', mark: [0.58, 0.66] },
    { key: 'sw2:P5', mark: [0.61, 0.69] },
    { key: 'sw2:P6', mark: [0.64, 0.72] }
  ]);

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const win = (p, a, b) => (b <= a ? (p >= b ? 1 : 0) : clamp01((p - a) / (b - a)));
  const lerp = (a, b, q) => a + (b - a) * q;
  const ptLine = (a, b, q) => ({ x: lerp(a.x, b.x, q), y: lerp(a.y, b.y, q) });
  const ptQuad = (a, c, b, q) => {
    const u = 1 - q;
    return {
      x: u * u * a.x + 2 * u * q * c.x + q * q * b.x,
      y: u * u * a.y + 2 * u * q * c.y + q * q * b.y
    };
  };
  const bump = (p, c, w) => clamp01(1 - Math.abs(p - c) / w);

  // 同一段形状在 q 处的位置与已经走过的折线（用来点亮走过的线路）
  function shapePoint(shape, q) {
    return shape.type === 'quad' ? ptQuad(shape.a, shape.c, shape.b, q) : ptLine(shape.a, shape.b, q);
  }
  function shapeTrail(shape, q, alpha) {
    if (alpha <= 0.002 || q <= 0) return null;
    const n = 14;
    const points = [];
    for (let i = 0; i <= n; i++) {
      const pt = shapePoint(shape, (q * i) / n);
      points.push([pt.x, pt.y]);
    }
    return { points, alpha };
  }

  const port = (key) => L.ports[key];
  const host = (id) => L.hosts[id];
  const anchorOf = (key) => ({ x: port(key).cx, y: G.anchorY });
  const busOf = (swId) => ({ x: L.switches[swId].fabric.cx, y: G.busY });
  const hostTop = (id) => ({ x: host(id).cx, y: host(id).top });

  const frame = (id, pos, tag, alpha, scale, label, ghost) => ({
    id,
    x: pos.x,
    y: pos.y,
    tag,
    alpha,
    scale,
    label,
    ghost: !!ghost
  });

  function addTag(w, text, x, y, anchor, kind, alpha) {
    if (alpha <= 0.002) return;
    w.tags.push({ text, x, y, anchor, kind, alpha });
  }

  // 从第 step 步起持续成立的状态（如"已收到"）
  function afterStep(index, step, p, fn) {
    if (index > step) return 1;
    if (index < step) return 0;
    return fn(p);
  }
  // 只在第 step 步内出现、步末归零的状态（如回执光环）
  function duringStep(index, step, p, fn) {
    return index === step ? fn(p) : 0;
  }
  // 一次回执光环：起手淡入、结束前淡出，步末一定为 0
  const pulse = (q, a, span) => win(q, a, a + 0.03) * (1 - win(q, a + 0.04, a + 0.04 + span));

  function world(index, p) {
    const w = {
      frames: [],
      ports: {},
      hosts: {},
      bands: {},
      tags: [],
      lookup: null,
      fabric: null,
      pvid: null,
      trail: null,
      result: 0,
      mainTag: 0
    };

    Object.keys(L.ports).forEach((key) => {
      w.ports[key] = { glow: 0, mark: 0 };
    });
    Object.keys(L.hosts).forEach((id) => {
      w.hosts[id] = { recv: 0, ring: 0, send: 0 };
    });
    Object.keys(L.bands).forEach((key) => {
      w.bands[key] = { dim: 0 };
    });

    // ---------- 累积状态：已收到、已隔离、广播域压暗 ----------
    w.hosts.A.send = afterStep(index, 0, p, (q) => win(q, 0.02, 0.12));
    w.hosts.A.ring = duringStep(index, 0, p, (q) => 1 - win(q, 0.03, 0.22));

    [
      { id: 'B', at: SW1_FAN[0].recv },
      { id: 'T3', at: SW1_FAN[1].recv },
      { id: 'T4', at: SW1_FAN[2].recv }
    ].forEach((item) => {
      w.hosts[item.id].recv = afterStep(index, 2, p, (q) => win(q, item.at[0], item.at[1]));
      w.hosts[item.id].ring = duringStep(index, 2, p, (q) => pulse(q, item.at[0], 0.08));
    });
    [
      { id: 'E', at: SW2_DELIVER[0].recv },
      { id: 'T9', at: SW2_DELIVER[1].recv }
    ].forEach((item) => {
      w.hosts[item.id].recv = afterStep(index, 5, p, (q) => win(q, item.at[0], item.at[1]));
      w.hosts[item.id].ring = duringStep(index, 5, p, (q) => pulse(q, item.at[0], 0.08));
    });

    SW1_BLOCK.forEach((item) => {
      w.ports[item.key].mark = afterStep(index, 3, p, (q) => win(q, item.mark[0], item.mark[1]));
    });
    SW2_BLOCK.forEach((item) => {
      w.ports[item.key].mark = afterStep(index, 5, p, (q) => win(q, item.mark[0], item.mark[1]));
    });

    w.bands['sw1:20'].dim = 0.4 * afterStep(index, 3, p, (q) => win(q, 0.42, 0.66));
    w.bands['sw2:20'].dim = 0.4 * afterStep(index, 5, p, (q) => win(q, 0.56, 0.74));

    // ---------- 第 1 步：主机 A 发出标准帧 ----------
    if (index === 0) {
      const a = host('A');
      const pk = a.port;
      const shape = { type: 'line', a: hostTop('A'), b: anchorOf(pk) };
      const q = win(p, 0.14, 0.86);
      const pos = shapePoint(shape, q);
      const alpha = win(p, 0.06, 0.16);
      w.frames.push(frame('main', pos, 0, alpha, 1, '1518 B'));
      w.ports[pk].glow = win(p, 0.60, 0.86);
      w.trail = shapeTrail(shape, q, 0.5 * (1 - win(p, 0.86, 1)));
    }

    // ---------- 第 2 步：入口按 PVID 10 打标 ----------
    if (index === 1) {
      const pk = host('A').port;
      const at = anchorOf(pk);
      const tag = win(p, 0.30, 0.62);
      w.frames.push(frame('main', at, tag, 1, 1, tag > 0.5 ? '1522 B' : '1518 B'));
      w.mainTag = tag;
      w.ports[pk].glow = 1;
      // 标签从端口的 PVID 处飞进帧里
      const chipAlpha = win(p, 0.06, 0.14) * (1 - win(p, 0.30, 0.40));
      if (chipAlpha > 0.002) {
        w.pvid = {
          x: at.x,
          y: lerp(port(pk).cy, at.y, win(p, 0.10, 0.30)),
          alpha: chipAlpha
        };
      }
      addTag(w, '插入 4B', at.x + 146, at.y, 'start', 'key', win(p, 0.34, 0.44) * (1 - win(p, 0.80, 0.90)));
    }

    // ---------- 第 3 步：按 VID 转发给同 VLAN 端口 ----------
    if (index === 2) {
      const pk = 'sw1:P1';
      const from = anchorOf(pk);
      const bus = busOf('sw1');
      const moveShape = { type: 'quad', a: from, c: { x: from.x, y: G.busY }, b: bus };
      const q = win(p, 0.03, 0.20);
      const pos = shapePoint(moveShape, q);
      w.frames.push(frame('main', pos, 1, 1, 1, '1522 B'));
      w.mainTag = 1;
      w.ports[pk].glow = 1 - win(p, 0.03, 0.22);
      w.trail = shapeTrail(moveShape, q, 0.5 * (1 - win(p, 0.24, 0.34)));

      w.lookup = { sw: 'sw1', vid: 10, alpha: win(p, 0.20, 0.30) * (1 - win(p, 0.80, 0.90)) };
      w.fabric = { sw: 'sw1', alpha: win(p, 0.20, 0.26) * (1 - win(p, 0.30, 0.48)) };
      addTag(w, '查 VID 10', bus.x + 74, G.fabricY, 'start', 'key', win(p, 0.20, 0.28) * (1 - win(p, 0.40, 0.48)));
      addTag(w, '复制 3 份', bus.x + 74, G.fabricY, 'start', 'key', win(p, 0.46, 0.54) * (1 - win(p, 0.82, 0.90)));

      SW1_FAN.forEach((item, k) => {
        const pt = port(item.key);
        const end = anchorOf(item.key);
        const shape = { type: 'quad', a: bus, c: { x: pt.cx, y: G.busY }, b: end };
        const q1 = win(p, item.t0, item.arrive);
        const tag = 1 - win(p, item.strip[0], item.strip[1]);
        const q2 = win(p, item.down[0], item.down[1]);
        const pos2 = q2 > 0 ? ptLine(end, hostTop(pt.host), q2) : shapePoint(shape, q1);
        const alpha = win(p, item.t0 - 0.01, item.t0 + 0.07) * (1 - win(p, item.down[1] - 0.02, item.down[1] + 0.05));
        const sink = 1 - 0.12 * win(p, item.down[1] - 0.05, item.down[1] + 0.03);
        if (alpha > 0.002) w.frames.push(frame('fan' + k, pos2, tag, alpha, GHOST_SCALE * sink, null, true));
        w.ports[item.key].glow = bump(p, item.arrive, 0.055);
      });
    }

    // ---------- 第 4 步：异 VLAN 端口不转发 ----------
    if (index === 3) {
      const bus = busOf('sw1');
      w.frames.push(frame('main', bus, 1, 1, 1, '1522 B'));
      w.mainTag = 1;
      w.lookup = { sw: 'sw1', vid: 20, alpha: win(p, 0.28, 0.40) * (1 - win(p, 0.80, 0.90)) };
      w.fabric = { sw: 'sw1', alpha: win(p, 0.10, 0.18) * (1 - win(p, 0.24, 0.40)) };

      SW1_BLOCK.forEach((item, k) => {
        const pt = port(item.key);
        // 试探副本一路下探到端口槽上沿，在端口前消散
        const shape = { type: 'quad', a: bus, c: { x: pt.cx, y: G.busY }, b: { x: pt.cx, y: G.portTop + 2 } };
        const q1 = win(p, item.t0, item.t0 + 0.26) * 0.94;
        const alpha = win(p, item.t0 - 0.02, item.t0 + 0.02) * (1 - win(p, item.t0 + 0.16, item.t0 + 0.26));
        if (alpha > 0.002) w.frames.push(frame('blk' + k, shapePoint(shape, q1), 1, alpha, GHOST_SCALE, null, true));
      });

      addTag(
        w,
        'VID 不匹配',
        L.bands['sw1:20'].cx,
        232,
        'middle',
        'warn',
        win(p, 0.34, 0.44) * (1 - win(p, 0.82, 0.92))
      );
    }

    // ---------- 第 5 步：Trunk 带标穿越 ----------
    if (index === 4) {
      const a = busOf('sw1');
      const b = busOf('sw2');
      const shape = { type: 'line', a, b };
      const q = win(p, 0.14, 0.78);
      const pos = shapePoint(shape, q);
      w.frames.push(frame('main', pos, 1, 1, 1, '1522 B'));
      w.mainTag = 1;
      w.ports['sw1:P8'].glow = bump(p, 0.28, 0.06);
      w.ports['sw2:P1'].glow = bump(p, 0.55, 0.06);
      w.trail = shapeTrail(shape, q, 0.5 * (1 - win(p, 0.86, 1)));
      addTag(w, '带标穿越', 560, 86, 'middle', 'key', win(p, 0.34, 0.44) * (1 - win(p, 0.80, 0.90)));
    }

    // ---------- 第 6 步：SW2 转发、出向剥标、交付 ----------
    if (index === 5) {
      const bus = busOf('sw2');
      const main = SW2_DELIVER[0];
      const mainPort = port(main.key);
      const mainShape = { type: 'quad', a: bus, c: { x: mainPort.cx, y: G.busY }, b: anchorOf(main.key) };
      const q1 = win(p, main.t0, main.arrive);
      const tag = 1 - win(p, main.strip[0], main.strip[1]);
      const q2 = win(p, main.down[0], main.down[1]);
      const pos = q2 > 0 ? ptLine(anchorOf(main.key), hostTop(mainPort.host), q2) : shapePoint(mainShape, q1);
      const alpha = 1 - win(p, main.down[1] + 0.02, main.down[1] + 0.10);
      const sink = 1 - 0.14 * win(p, main.down[1] - 0.06, main.down[1] + 0.02);
      w.frames.push(frame('main', pos, tag, alpha, sink, tag > 0.5 ? '1522 B' : '1518 B'));
      w.mainTag = tag;
      w.trail = shapeTrail(mainShape, q1, 0.5 * (1 - win(p, 0.34, 0.46)));
      w.ports[main.key].glow = bump(p, main.arrive, 0.045);
      w.lookup = { sw: 'sw2', vid: 10, alpha: win(p, 0.04, 0.14) * (1 - win(p, 0.72, 0.84)) };
      w.fabric = { sw: 'sw2', alpha: win(p, 0.04, 0.10) * (1 - win(p, 0.14, 0.30)) };

      // 第二份副本给 P3
      const copy = SW2_DELIVER[1];
      const copyPort = port(copy.key);
      const copyShape = { type: 'quad', a: bus, c: { x: copyPort.cx, y: G.busY }, b: anchorOf(copy.key) };
      const cq1 = win(p, copy.t0, copy.arrive);
      const ctag = 1 - win(p, copy.strip[0], copy.strip[1]);
      const cq2 = win(p, copy.down[0], copy.down[1]);
      const cpos = cq2 > 0 ? ptLine(anchorOf(copy.key), hostTop(copyPort.host), cq2) : shapePoint(copyShape, cq1);
      const calpha = win(p, copy.t0 - 0.02, copy.t0 + 0.02) * (1 - win(p, copy.down[1] - 0.02, copy.down[1] + 0.05));
      const csink = 1 - 0.12 * win(p, copy.down[1] - 0.05, copy.down[1] + 0.03);
      if (calpha > 0.002) w.frames.push(frame('copy', cpos, ctag, calpha, GHOST_SCALE * csink, null, true));
      w.ports[copy.key].glow = bump(p, copy.arrive, 0.05);

      addTag(w, '剥标 −4B', mainPort.cx, 84, 'middle', 'key', win(p, 0.30, 0.38) * (1 - win(p, 0.60, 0.70)));

      w.result = win(p, 0.80, 0.92);
    }

    // 步末统一清场：只剩有内容的东西，边界上不会残留半透明对象
    w.frames = w.frames.filter((f) => f.alpha > 0.002);
    if (w.lookup && w.lookup.alpha <= 0.002) w.lookup = null;
    if (w.fabric && w.fabric.alpha <= 0.002) w.fabric = null;
    if (w.trail && w.trail.alpha <= 0.002) w.trail = null;

    return w;
  }

  const api = {
    CELLS,
    FRAME_H,
    FRAME_BASE,
    FRAME_TAG,
    GHOST_SCALE,
    SW1_FAN,
    SW1_BLOCK,
    SW2_DELIVER,
    SW2_BLOCK,
    frameWidth: (tag) => FRAME_BASE + FRAME_TAG * clamp01(tag),
    world
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VlanChoreo = api;
})(typeof window !== 'undefined' ? window : globalThis);
