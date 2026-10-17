const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');

const runs = () => M.SCENARIOS.flatMap((s) => ['enhanced', 'basic'].map((mode) =>
  M.buildRun({ mode, frames: s.frames, pointer: s.pointer, requests: s.requests })));

// 画面上“看得见”的内容：页号（或空闲）、两个位（完全可见时才有值）、选中染色、是否虚线
function seen(v) {
  const page = v.page.alpha >= 0.999 ? v.page.text : (v.empty.alpha >= 0.999 ? null : 'mid');
  const bits = v.chips.alpha >= 0.999 ? { r: v.r.value, m: v.m.value } : null;
  return { page, bits, victim: v.victim, dashed: v.dashed };
}

const expectFrame = (fr) => (fr.page === null
  ? { page: null, bits: null }
  : { page: `P${fr.page}`, bits: { r: fr.r, m: fr.m } });

test('边界无跳变：上一步终点的画面等于下一步起点的画面', () => {
  for (const run of runs()) {
    for (let i = 0; i + 1 < run.N; i++) {
      for (let f = 0; f < M.FRAMES; f++) {
        assert.deepEqual(seen(C.cardView(run.steps[i], 1, f)), seen(C.cardView(run.steps[i + 1], 0, f)),
          `第 ${i} 步到第 ${i + 1} 步，F${f} 在边界上跳变`);
      }
    }
  }
});

test('每一步的起点与终点画面与快照一致（页号、两个位、选中染色）', () => {
  for (const run of runs()) {
    for (const step of run.steps) {
      for (let f = 0; f < M.FRAMES; f++) {
        const got0 = seen(C.cardView(step, 0, f));
        const got1 = seen(C.cardView(step, 1, f));
        const want0 = expectFrame(step.before.frames[f]);
        const want1 = expectFrame(step.after.frames[f]);
        assert.equal(got0.page, want0.page, `${step.kind} 起点 F${f} 的页号`);
        assert.deepEqual(got0.bits, want0.bits, `${step.kind} 起点 F${f} 的位`);
        assert.equal(got0.victim, step.before.victim === f ? 1 : 0, `${step.kind} 起点 F${f} 的选中染色`);
        assert.equal(got1.page, want1.page, `${step.kind} 终点 F${f} 的页号`);
        assert.deepEqual(got1.bits, want1.bits, `${step.kind} 终点 F${f} 的位`);
        assert.equal(got1.victim, step.after.victim === f ? 1 : 0, `${step.kind} 终点 F${f} 的选中染色`);
      }
    }
  }
});

test('翻牌：中途换值一次，中点时缩成一条线，两端分别是旧值与新值', () => {
  const w = [0.2, 0.6];
  assert.deepEqual(C.bitView(0, 1, 0.2, w), { value: 0, sy: 1 });
  assert.deepEqual(C.bitView(0, 1, 0.6, w), { value: 1, sy: 1 });
  assert.ok(Math.abs(C.bitView(0, 1, 0.4, w).sy) < 1e-9, '中点缩成一条线');
  let flips = 0;
  let prev = C.bitView(0, 1, 0, w).value;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const v = C.bitView(0, 1, p, w);
    assert.ok(v.sy >= 0 && v.sy <= 1);
    if (v.value !== prev) flips++;
    prev = v.value;
  }
  assert.equal(flips, 1, '只换值一次');
  assert.deepEqual(C.bitView(1, 1, 0.5, w), { value: 1, sy: 1 }, '未变化的位不翻');
});

test('幽灵：脏页淘汰从页框飞向外存，装入从访问标记飞入；起止都不可见', () => {
  let evictSeen = 0;
  let loadSeen = 0;
  for (const run of runs()) {
    run.steps.forEach((st) => {
      if (st.kind === 'evict' && st.dirty) {
        evictSeen++;
        assert.equal(C.ghostView(st, 0), null);
        assert.equal(C.ghostView(st, 1), null);
        let lastQ = -1;
        let visible = false;
        for (let p = 0; p <= 1.0001; p += 0.01) {
          const g = C.ghostView(st, p);
          if (!g) continue;
          visible = true;
          assert.equal(g.kind, 'out');
          assert.equal(g.label, `P${st.before.frames[st.focus].page}`);
          assert.ok(g.q >= lastQ - 1e-9, '幽灵的行程只能向前');
          lastQ = g.q;
        }
        assert.ok(visible, '脏页淘汰时幽灵应可见');
      }
      if (st.kind === 'load') {
        loadSeen++;
        assert.equal(C.ghostView(st, 0), null);
        assert.equal(C.ghostView(st, 0.8), null, '落地后幽灵消失，由页框接替');
        let lastQ = -1;
        for (let p = 0; p <= 0.75; p += 0.01) {
          const g = C.ghostView(st, p);
          if (!g) continue;
          assert.equal(g.kind, 'in');
          assert.equal(g.label, `P${st.after.frames[st.focus].page}`);
          assert.ok(g.q >= lastQ - 1e-9);
          lastQ = g.q;
        }
      }
    });
  }
  assert.ok(evictSeen > 0 && loadSeen > 0, '测试序列应覆盖淘汰与装入');
});

test('浮标：弹出时透明度单调增加到 1；上一步的浮标在本步开头淡出', () => {
  for (const run of runs()) {
    run.steps.forEach((st, i) => {
      if (st.tag) {
        let last = -1;
        for (let p = 0; p <= 1.0001; p += 0.01) {
          const mine = C.tagsView(st, null, p).filter((t) => t.text === st.tag.text);
          const a = mine.length ? mine[0].alpha : 0;
          assert.ok(a >= last - 1e-9, `第 ${i} 步的浮标透明度应单调不减`);
          last = a;
        }
        assert.equal(last, 1);
      }
      if (i > 0 && run.steps[i - 1].tag) {
        const prev = run.steps[i - 1];
        let last = 1;
        for (let p = 0; p <= 0.25; p += 0.01) {
          const out = C.tagsView(null, prev, p);
          const a = out.length ? out[0].alpha : 0;
          assert.ok(a <= last + 1e-9, `第 ${i} 步开头，上一步的浮标应单调淡出`);
          last = a;
        }
        assert.equal(C.tagsView(null, prev, 0.2).length, 0);
      }
    });
  }
});

test('计数滚动：窗口开始前显示旧值，结束后显示新值', () => {
  for (const run of runs()) {
    for (const step of run.steps) {
      const s0 = C.statsView(step, 0);
      const s1 = C.statsView(step, 1);
      for (const k of ['total', 'hits', 'faults', 'writes']) {
        assert.equal(s0[k].from, step.before.stats[k]);
        assert.equal(s1[k].to, step.after.stats[k]);
        assert.equal(s0[k].q === 1, step.before.stats[k] === step.after.stats[k]);
        assert.equal(s1[k].q, 1);
      }
    }
  }
});

test('文字：先淡出旧文字再淡入新文字，首尾分别是旧与新', () => {
  assert.deepEqual(C.textView('旧', '新', 0, false), { text: '旧', alpha: 1 });
  assert.deepEqual(C.textView('旧', '新', 1, false), { text: '新', alpha: 1 });
  let last = 1;
  for (let p = 0; p <= 0.2; p += 0.01) {
    const v = C.textView('旧', '新', p, false);
    assert.equal(v.text, '旧');
    assert.ok(v.alpha <= last + 1e-9);
    last = v.alpha;
  }
  assert.equal(C.textView('旧', '新', 0.2, false).alpha, 0);
  assert.deepEqual(C.textView('旧', '旧', 0.1, false), { text: '旧', alpha: 1 });
  assert.deepEqual(C.textView('旧', '新', 0.1, true), { text: '新', alpha: 1 }, '结束时直接是新文字');
});

test('指针：匀速转到目标并保持；转动期间扫过的弧随之展开', () => {
  const step = { handFrom: 90, handTo: 270, moves: true };
  assert.equal(C.handDeg(step, 0), 90);
  assert.equal(C.handDeg(step, C.HAND_END), 270);
  assert.equal(C.handDeg(step, 1), 270);
  let last = -Infinity;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const d = C.handDeg(step, p);
    assert.ok(d >= last - 1e-9);
    last = d;
  }
  assert.equal(C.trailView(step, 0).from, 90);
  assert.equal(C.trailView({ handFrom: 0, handTo: 0, moves: false }, 0.5), null);
});

test('焦点外环：同一页框连续被关注时不闪烁，未到位前不出现', () => {
  const same = { focus: 2, moves: true };
  assert.equal(C.ringView(same, { focus: 2 }, 0, 2).alpha, 1);
  assert.equal(C.ringView(same, { focus: 2 }, 0.3, 2).alpha, 1);
  assert.equal(C.ringView(same, { focus: 0 }, 0, 2).alpha, 0, '还没到位时不出现');
  assert.equal(C.ringView(same, { focus: 0 }, 1, 2).alpha, 1);
});

test('命中连线：查表命中后画出，下一步开始时淡出', () => {
  const s = M.SCENARIOS[4];   // 场景 5：全部命中
  const run = M.buildRun({ mode: 'enhanced', frames: s.frames, pointer: s.pointer, requests: s.requests });
  const idx = run.steps.findIndex((st) => st.kind === 'lookup');
  const look = run.steps[idx];
  assert.equal(C.connectorView(look, run.steps[idx - 1], 0).draw, 0);
  assert.equal(C.connectorView(look, run.steps[idx - 1], 1).draw, 1);
  const next = run.steps[idx + 1];
  assert.equal(C.connectorView(next, look, 0).alpha, 1);
  assert.equal(C.connectorView(next, look, 0.2).alpha, 0);
});

test('托盘：只有脏页淘汰时发光，并在到达后熄灭', () => {
  for (const run of runs()) {
    for (const st of run.steps) {
      if (st.kind === 'evict' && st.dirty) {
        assert.equal(C.trayView(st, 0).glow, 0);
        assert.ok(C.trayView(st, 0.9).glow > 0.9);
        assert.ok(Math.abs(C.trayView(st, 1).glow) < 1e-9);
      } else {
        assert.equal(C.trayView(st, 0.9).glow, 0);
      }
    }
  }
});
