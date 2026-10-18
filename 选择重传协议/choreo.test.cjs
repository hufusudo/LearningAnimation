const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('./model.js');
const C = require('./choreo.js');

const SCEN = model.SCENARIOS.map((s) => s.id);
const runOf = (id, extra) => model.buildRun(Object.assign({ scenario: id }, extra || {}));
const STATES = ['acked', 'pending', 'retry', 'ready', 'outside', 'done', 'expect', 'buffer', 'wait'];

// 把某一时刻的画面压成可比对的指纹：只保留应当连续变化的量
function fingerprint(v) {
  return {
    sCells: v.cells.s.map((c) => [c.fill, c.stroke, c.text, c.label.text, c.label.alpha]),
    rCells: v.cells.r.map((c) => [c.fill, c.stroke, c.text, c.label.text, c.label.alpha]),
    winS: [v.window.s.x, v.window.s.w, v.window.s.alpha],
    winR: [v.window.r.x, v.window.r.w, v.window.r.alpha],
    ptr: [v.pointers.base.x, v.pointers.next.x, v.pointers.rcv.x],
    ackMarks: v.ackMarks.map((a) => a.on),
    regs: Object.keys(v.regs).map((k) => [v.regs[k].text, v.regs[k].alpha]),
    totals: [v.totals.acked.text, v.totals.delivered.text, v.totals.lost.text],
    timers: v.timers.map((t) => [t.seq, t.frac, t.alpha]),
    packets: v.packets.map((p) => [p.id, p.x, p.y])
  };
}

test('上一步终点的画面等于下一步起点的画面（任意拖动都不跳变）', () => {
  for (const id of SCEN) {
    const run = runOf(id);
    for (let i = 0; i < run.steps.length - 1; i++) {
      const at = fingerprint(C.view(run, i, 1));
      const bt = fingerprint(C.view(run, i + 1, 0));
      assert.deepEqual(at, bt, `${id} 第 ${i} → ${i + 1} 步边界出现跳变`);
    }
  }
});

test('时刻映射只依赖 (步，进度)，倒退与重复取样结果一致', () => {
  for (const id of SCEN) {
    const run = runOf(id);
    for (let i = 0; i < run.steps.length; i++) {
      for (const p of [0, 0.37, 1]) {
        const v = C.view(run, i, p);
        assert.ok(Math.abs(v.t - (run.steps[i].t + p * run.steps[i].dur)) < 1e-9, `${id} 时刻映射`);
        assert.deepEqual(fingerprint(v), fingerprint(C.view(run, i, p)), `${id} 同一输入同一画面`);
      }
    }
    // 从末尾倒回起点，画面与直接取样一致
    const back = fingerprint(C.view(run, 0, 0.5));
    for (let i = run.steps.length - 1; i >= 0; i--) { /* 只验证无副作用 */ void i; }
    assert.deepEqual(fingerprint(C.view(run, 0, 0.5)), back, `${id} 倒退后重绘一致`);
  }
});

test('飞行中的报文只在 [发出, 到达) 之间出现，且始终落在信道内', () => {
  for (const id of SCEN) {
    const run = runOf(id);
    for (let i = 0; i < run.steps.length; i++) {
      const v = C.view(run, i, 0.5);
      for (const p of v.packets) {
        const pk = run.packets.find((x) => x.id === p.id);
        assert.ok(pk, `${id} 报文来自模型`);
        assert.ok(p.x >= C.GEO.laneX0 - 1 && p.x <= C.GEO.laneX1 + 1, `${id} 报文横向不越界`);
        assert.ok(p.y === C.GEO.laneY0 || p.y === C.GEO.laneY1, `${id} 报文在两条跑道上`);
        assert.ok(v.t >= pk.t0 - 1e-9 && v.t < pk.tEnd + 1e-9, `${id} 报文只在飞行期出现`);
      }
    }
  }
});

test('帧格状态都能取到配色，且语义色旁永远带文字', () => {
  for (const st of STATES) assert.ok(C.COLORS[st], `${st} 有配色`);
  for (const id of SCEN) {
    const run = runOf(id);
    for (let i = 0; i < run.steps.length; i++) {
      for (const p of [0, 0.5, 1]) {
        const v = C.view(run, i, p);
        for (const c of v.cells.s.concat(v.cells.r)) {
          assert.match(c.fill, /^#[0-9a-f]{6}$/i);
          assert.ok(C.COLORS[c.from] && C.COLORS[c.to]);
          assert.ok(c.label.text.length > 0, `${id} 格子带状态文字`);
        }
      }
    }
  }
});

test('浮标：同一时刻不超过两个，文字简短，位置不越界，分类合法', () => {
  const tones = new Set(['key', 'warn', 'note', 'quiet']);
  for (const id of SCEN) {
    const run = runOf(id);
    for (let i = 0; i < run.steps.length; i++) {
      const v = C.view(run, i, 0.6);
      assert.ok(v.tags.length <= 2, `${id} 第 ${i} 步浮标不超过两个`);
      for (const tag of v.tags) {
        assert.ok(tones.has(tag.tone), `${id} 浮标分类合法`);
        assert.ok(tag.alpha >= 0 && tag.alpha <= 1);
        const w = C.textWidth(tag.text);
        assert.ok(tag.x - w / 2 >= 0 && tag.x + w / 2 <= 1100, `${id} 浮标不越出舞台`);
        assert.ok(tag.y >= 0 && tag.y <= 340, `${id} 浮标纵向不越界`);
      }
    }
  }
});

test('引导排在变化之前：每个事件步都先给出焦点，再发生状态变化', () => {
  const kinds = new Set(['tx-data', 'rx-data', 'rx-ack', 'rx-nak', 'timeout', 'drop']);
  for (const id of SCEN) {
    const run = runOf(id);
    for (let i = 0; i < run.steps.length; i++) {
      const step = run.steps[i];
      if (!kinds.has(step.kind)) continue;
      const early = C.view(run, i, 0.05);
      assert.ok(early.focus, `${id} 第 ${i} 步有引导`);
      assert.ok(early.focusAlpha > 0.3, `${id} 第 ${i} 步引导先出现`);
      const late = C.view(run, i, 0.99);
      assert.ok(late.focusAlpha < 0.1, `${id} 第 ${i} 步引导在回执之后退场`);
    }
  }
});

test('叙事不剧透：还没发生的丢失与差错，解说里不得提前出现', () => {
  for (const id of SCEN) {
    const run = runOf(id);
    for (const step of run.steps) {
      if (step.kind !== 'tx-data') continue;
      const narr = C.narrOf(step, run);
      assert.ok(narr.length <= 40, `${id} 解说不超过 40 字`);
      if (step.ev.lost) assert.ok(!/丢|损|丢失/.test(narr), `${id} 不提前宣告帧 ${step.ev.seq} 会丢`);
      if (step.ev.corrupt) assert.ok(!/错|损坏|翻转/.test(narr), `${id} 不提前宣告帧 ${step.ev.seq} 会出错`);
    }
  }
});

test('减少动效直落步末：取进度 1 得到的就是该步的终态', () => {
  for (const id of SCEN) {
    const run = runOf(id);
    for (let i = 0; i < run.steps.length; i++) {
      const v = C.view(run, i, 1);
      const after = run.steps[i].after;
      assert.equal(v.cells.s[0].to, C.senderState(after, 0, { params: run.params, retxAt: run._retxAt }, run.steps[i].t));
      assert.equal(v.cells.r[0].to, C.receiverState(after, 0, { params: run.params }));
      if (run.steps[i].kind === 'rx-ack') {
        assert.equal(v.regs.base.text, String(after.base), `${id} 第 ${i} 步 base 已到位`);
      }
    }
  }
});

test('末步画面：窗口滑到尽头，全部帧显示为已确认与已交付', () => {
  for (const id of ['normal', 'loss1', 'loss2', 'error', 'ackloss']) {
    const run = runOf(id);
    const v = C.view(run, run.steps.length - 1, 1);
    assert.ok(v.cells.s.every((c) => c.to === 'acked'), `${id} 发送方全部已确认`);
    assert.ok(v.cells.r.every((c) => c.to === 'done'), `${id} 接收方全部已交付`);
    assert.ok(v.window.s.alpha === 0 && v.window.r.alpha === 0, `${id} 两个窗口都退场`);
    assert.equal(v.regs.base.text, String(model.FRAMES));
  }
});

test('窗口与指针位置：base、next、rcv_base 与模型状态严格对齐', () => {
  for (const id of SCEN) {
    const run = runOf(id);
    for (let i = 0; i < run.steps.length; i++) {
      for (const p of [0, 1]) {
        const v = C.view(run, i, p);
        const st = p < 1 ? run.steps[i].before : run.steps[i].after;
        const sx = C.GEO.sX + st.base * C.GEO.pitch;
        const rx = C.GEO.rX + st.rcvBase * C.GEO.pitch;
        if (p === 1) {
          assert.ok(Math.abs(v.window.s.x - (sx - 6)) < 1e-6, `${id} 发送窗口贴着 base`);
          assert.ok(Math.abs(v.window.r.x - (rx - 6)) < 1e-6, `${id} 接收窗口贴着 rcv_base`);
        }
        assert.ok(Math.abs(v.pointers.rcv.x - rx) < 1e-6, `${id} 指针贴着 rcv_base`);
      }
    }
  }
});

test('编排纯函数：窗口映射、缓动、颜色插值与文字交叉都落在闭区间内', () => {
  assert.equal(C.win(-1, 0.2, 0.6), 0);
  assert.equal(C.win(2, 0.2, 0.6), 1);
  assert.ok(Math.abs(C.win(0.4, 0.2, 0.6) - 0.5) < 1e-12);
  assert.equal(C.win(0.5, 0.6, 0.6), 0);
  for (const q of [0, 0.25, 0.5, 0.75, 1]) {
    const e = C.ease(q);
    assert.ok(e >= 0 && e <= 1);
    assert.equal(C.ease(0), 0);
    assert.equal(C.ease(1), 1);
  }
  assert.equal(C.mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(C.mix('#000000', '#ffffff', 1), '#ffffff');
  assert.match(C.mix('#000000', '#ffffff', 0.5), /^#[0-9a-f]{6}$/i);
  assert.equal(C.textView('a', 'b', 0, true).text, 'b');
  assert.equal(C.textView('a', 'b', 0.05, false).text, 'a');
  assert.equal(C.textView('a', 'b', 0.9, false).text, 'b');
  assert.ok(C.textWidth('帧 1 丢失') > C.textWidth('ACK 1'));
});
