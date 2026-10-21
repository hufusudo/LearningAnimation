const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

const runs = () => {
  const out = [];
  for (let X = 0; X < 16; X++) {
    for (let Y = 0; Y < 16; Y++) out.push(M.buildTrace(X, Y, 4).steps);
  }
  return out;
};

const r3 = (v) => Math.round(v * 1000) / 1000 + 0;   // + 0 把 -0 归为 0
const SAMPLES = Array.from({ length: 41 }, (_, k) => k / 40);

// 画面上“看得见”的内容：可见的位与文字、可见的连线、可见的浮标与计数
function visible(f) {
  return {
    ring: r3(f.ring.alpha) > 0 ? [f.ring.target, r3(f.ring.alpha)] : null,
    contour: r3(f.contour.alpha),
    seam: r3(f.seam.lit),
    alu: r3(f.alu.lit),
    en: f.wires.en.alpha > 1e-6 && f.wires.en.draw > 1e-6 ? [r3(f.wires.en.alpha), r3(f.wires.en.draw)] : null,
    plus: f.wires.plus.alpha > 1e-6 && f.wires.plus.draw > 1e-6 ? [r3(f.wires.plus.alpha), r3(f.wires.plus.draw)] : null,
    sum: f.wires.sum.alpha > 1e-6 && f.wires.sum.draw > 1e-6 ? [r3(f.wires.sum.alpha), r3(f.wires.sum.draw)] : null,
    slots: f.slots.map((s) => (s.alpha > 1e-6 ? [s.text, r3(s.alpha), r3(s.tint)] : [null, 0, r3(s.tint)])),
    chips: f.chips.map((c) => (c.alpha > 1e-6 ? [r3(c.x), r3(c.y), r3(c.alpha), c.text] : null)),
    counter: [f.counter.text, r3(f.counter.alpha), r3(f.counter.dy)],
    tag: f.tag.alpha > 1e-6 ? [f.tag.text, f.tag.at, r3(f.tag.alpha), r3(f.tag.dy)] : null,
    result: r3(f.result.clip)
  };
}

test('边界无跳变：上一步终点的画面等于下一步起点的画面', () => {
  for (const steps of runs()) {
    for (let k = 0; k + 1 < steps.length; k++) {
      const end = C.frame(steps[k], 1, k > 0 ? steps[k - 1] : null);
      const start = C.frame(steps[k + 1], 0, steps[k]);
      assert.deepEqual(visible(end), visible(start), `第 ${k} 步到第 ${k + 1} 步（${steps[k].kind} → ${steps[k + 1].kind}）`);
    }
  }
});

test('起止画面：进度 0 显示起态，进度 1 显示终态（链上的位与计数器）', () => {
  for (const steps of runs().slice(0, 64)) {
    steps.forEach((s, k) => {
      const prev = k > 0 ? steps[k - 1] : null;
      const f0 = C.frame(s, 0, prev);
      const f1 = C.frame(s, 1, prev);
      const before = C.chainOf(s.before);
      const after = C.chainOf(s.after);
      for (let j = 0; j < 9; j++) {
        assert.equal(f0.slots[j].text, String(before[j]), `${s.kind} 起态 第 ${j} 位`);
        assert.equal(f0.slots[j].alpha, 1);
        assert.equal(f1.slots[j].text, String(after[j]), `${s.kind} 终态 第 ${j} 位`);
        assert.equal(f1.slots[j].alpha, 1);
      }
      assert.equal(f0.counter.text, String(s.before.counter));
      assert.equal(f1.counter.text, String(s.after.counter));
    });
  }
});

test('每一步只动它该动的通道（一步一个主动作）', () => {
  const allowed = {
    init: [],
    probe: ['ring', 'plus'],
    add: ['ring', 'alu', 'plus', 'sum', 'chips', 'slots'],
    shift: ['contour', 'en', 'seam', 'chips', 'slots'],
    count: ['ring', 'counter'],
    done: ['slots', 'result']
  };
  const channel = (f, name) => {
    const get = {
      ring: () => [f.ring.target, r3(f.ring.alpha)],
      contour: () => r3(f.contour.alpha),
      seam: () => r3(f.seam.lit),
      alu: () => r3(f.alu.lit),
      en: () => [r3(f.wires.en.alpha), r3(f.wires.en.draw)],
      plus: () => [r3(f.wires.plus.alpha), r3(f.wires.plus.draw)],
      sum: () => [r3(f.wires.sum.alpha), r3(f.wires.sum.draw)],
      slots: () => f.slots.map((s) => [s.text, r3(s.alpha), r3(s.tint)]),
      chips: () => f.chips.map((c) => r3(c.alpha)),
      counter: () => [f.counter.text, r3(f.counter.alpha), r3(f.counter.dy)],
      result: () => r3(f.result.clip)
    };
    return JSON.stringify(get[name]());
  };
  const all = Object.keys({ ring: 1, contour: 1, seam: 1, alu: 1, en: 1, plus: 1, sum: 1, slots: 1, chips: 1, counter: 1, result: 1 });

  for (const steps of runs().slice(0, 64)) {
    steps.forEach((s, k) => {
      const prev = k > 0 ? steps[k - 1] : null;
      const base = C.frame(s, 0, prev);
      for (const name of all) {
        if (allowed[s.kind].includes(name)) continue;
        const v0 = channel(base, name);
        for (const p of SAMPLES) {
          assert.equal(channel(C.frame(s, p, prev), name), v0, `${s.kind} 步不应改变 ${name}（p=${p}）`);
        }
      }
    });
  }
});

test('联合右移：位块整体线性平移，ACC₀ 跨界进入 MQ₃，MQ₀ 移出', () => {
  const { steps } = M.buildTrace(13, 11, 4);
  const sh = steps.find((s) => s.kind === 'shift');
  const xs = [0.2, 0.45, 0.7].map((p) => C.frame(sh, p).chips[4].x);
  // 第 4 个位块（ACC₀）：起点 slotX[4]，终点 slotX[5]，中点正好是两端的平均
  const start = C.GEOM.slotX[4] + (C.GEOM.cell - C.GEOM.chipW) / 2;
  const end = C.GEOM.slotX[5] + (C.GEOM.cell - C.GEOM.chipW) / 2;
  assert.ok(Math.abs(xs[0] - start) < 1e-9);
  assert.ok(Math.abs(xs[2] - end) < 1e-9);
  assert.ok(Math.abs(xs[1] - (start + end) / 2) < 1e-9, '位块匀速平移，不回弹');

  const f = C.frame(sh, 0.3);
  assert.equal(f.chips[4].text, String(sh.before.acc[3]), 'ACC₀ 这一位就是跨界的那一位');
  assert.equal(C.frame(sh, 0.9).chips[8].alpha, 0, 'MQ₀ 移出后淡去');
  assert.ok(C.frame(sh, 0.7).chips[8].alpha > 0.99, '移到移出位时仍可见');
});

test('X 字飞入 ALU：自上一步的 X 寄存器到 ALU 内，线性前进', () => {
  const { steps } = M.buildTrace(13, 11, 4);
  const add = steps.find((s) => s.kind === 'add');
  assert.equal(C.frame(add, 0).chips[9].alpha, 0);
  assert.equal(C.frame(add, 0.3).chips[9].text, '1101');
  const y0 = C.frame(add, 0.15).chips[9].y;
  const y1 = C.frame(add, 0.375).chips[9].y;
  const y2 = C.frame(add, 0.6).chips[9].y;
  assert.equal(y0, C.GEOM.xFlyFrom);
  assert.equal(y2, C.GEOM.xFlyTo);
  assert.ok(Math.abs(y1 - (y0 + y2) / 2) < 1e-9);
});

test('焦点环与轮廓：步首淡入、步尾淡出，中段完整', () => {
  assert.equal(C.guide(0), 0);
  assert.equal(C.guide(1), 0);
  assert.equal(C.guide(0.5), 1);
});

test('计数与写回：数字与位只在旧值与新值之间切换，不出现中间数', () => {
  const { steps } = M.buildTrace(13, 11, 4);
  const cnt = steps.find((s) => s.kind === 'count');
  const add = steps.find((s) => s.kind === 'add' && s.carry === 0);
  for (const p of SAMPLES) {
    const txt = C.frame(cnt, p).counter.text;
    assert.ok([String(cnt.before.counter), String(cnt.after.counter)].includes(txt), `计数器在 p=${p} 时为 ${txt}`);
    const acc = C.frame(add, p).slots;
    for (let j = 1; j <= 4; j++) {
      assert.ok([String(add.before.acc[j - 1]), String(add.after.acc[j - 1])].includes(acc[j].text), `ACC 在 p=${p} 时为 ${acc[j].text}`);
    }
  }
});

test('浮标：上一步的浮标在本步开头淡出，锚点不跳动', () => {
  const { steps } = M.buildTrace(13, 11, 4);
  for (let k = 1; k < steps.length; k++) {
    const prev = steps[k - 1];
    if (!prev.tag) continue;
    for (const p of [0, 0.05, 0.1, 0.15]) {
      const t = C.frame(steps[k], p, prev).tag;
      assert.equal(t.at, prev.tag.at, `第 ${k} 步 p=${p} 的浮标锚点`);
      assert.equal(t.text, prev.tag.text);
    }
  }
});

test('时刻定位：τ 落在第几步、步内进度，超出末尾停在终态', () => {
  assert.deepEqual(C.locate(17, 0), { i: 0, p: 0 });
  assert.deepEqual(C.locate(17, 2.25), { i: 2, p: 0.25 });
  assert.deepEqual(C.locate(17, 17), { i: 16, p: 1 });
  assert.deepEqual(C.locate(17, 99), { i: 16, p: 1 });
  assert.deepEqual(C.locate(17, -3), { i: 0, p: 0 });
});
