'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

const seq1 = M.buildSequence({ active: 1 });
const seq2 = M.buildSequence({ active: 2 });

test('默认总时长 26 s，十个阶段首尾相接且时长为正', () => {
  assert.equal(seq1.duration, 26);
  assert.equal(seq1.steps.length, 10);
  seq1.steps.forEach((s, i) => {
    assert.ok(s.dur > 0, `${s.id} 时长应为正`);
    if (i > 0) assert.equal(s.t0, seq1.steps[i - 1].t1, `${s.id} 应接上一阶段`);
  });
  assert.equal(seq1.steps[seq1.steps.length - 1].t1, seq1.duration);
});

test('阶段 id 唯一，解说不超过 40 字', () => {
  const ids = new Set(M.STEP_SPEC.map((s) => s.id));
  assert.equal(ids.size, M.STEP_SPEC.length);
  M.STEP_SPEC.forEach((s) => assert.ok(s.say.length <= 40, `${s.id} 解说过长：${s.say.length}`));
});

test('活动分区只接受 1 或 2 的整数，其余抛出 RangeError', () => {
  for (const bad of [0, 3, 1.5, '1', NaN, null]) {
    assert.throws(() => M.buildSequence({ active: bad }), RangeError, `应拒绝 ${String(bad)}`);
  }
  assert.equal(M.buildSequence().params.active, 1, '缺省为分区 1');
});

test('关键时刻按引导顺序递增：MBR 读入 → 搬家扫描 → 引导扇区 → 管理器 → 内核 → 登录', () => {
  const T = seq1.times;
  const ordered = [
    T.mbrArrive, T.mbrCopyEnd, T.found, T.pbrArrive, T.bmArrive, T.kArrive, T.ivtEnd, T.login
  ];
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i] > ordered[i - 1], `第 ${i} 个时刻应晚于前一个`);
  }
});

test('分区 1 为活动时只检查第一项即命中；分区 2 为活动时先跳过第一项', () => {
  const at = (seq) => seq.times.found;
  const s1 = M.sample(seq1, at(seq1) + 0.01);
  assert.deepEqual(s1.dpt.map((r) => r.state), ['found', 'idle', 'idle', 'idle']);
  assert.equal(s1.scanned, 1);

  const mid = seq2.times.scanStart + 0.1;
  const s2mid = M.sample(seq2, mid);
  assert.equal(s2mid.dpt[0].state, 'scan', '第一项检查中');

  const later = M.sample(seq2, seq2.times.found + 0.01);
  assert.deepEqual(later.dpt.map((r) => r.state), ['skip', 'found', 'idle', 'idle']);
  assert.equal(later.scanned, 2);
  assert.equal(later.partitions[1].active, true);
  assert.equal(later.partitions[0].active, false);
});

test('0x7C00 的内容：读入前为空，MBR 读入后为 MBR，引导扇区覆盖后为 PBR', () => {
  const T = seq1.times;
  assert.equal(M.sample(seq1, T.mbrArrive - 0.01).boot.slot, 'empty');
  assert.equal(M.sample(seq1, T.mbrArrive + 0.01).boot.slot, 'mbr');
  assert.equal(M.sample(seq1, T.pbrArrive - 0.01).boot.slot, 'mbr');
  assert.equal(M.sample(seq1, T.pbrArrive + 0.01).boot.slot, 'pbr');
});

test('MBR 副本在搬家完成后才出现在 0x0600', () => {
  const T = seq1.times;
  assert.equal(M.sample(seq1, T.mbrCopyEnd - 0.01).boot.mbrCopy, false);
  assert.equal(M.sample(seq1, T.mbrCopyEnd + 0.01).boot.mbrCopy, true);
});

test('中断向量表计数单调不减，初始为 0，终点 256 项，BIOS 先登记 4 项', () => {
  let prev = -1;
  const steps = 400;
  for (let i = 0; i <= steps; i++) {
    const t = (seq1.duration * i) / steps;
    const total = M.sample(seq1, t).ivt.total;
    assert.ok(total >= prev, `t=${t} 计数回退：${total} < ${prev}`);
    prev = total;
  }
  assert.equal(M.sample(seq1, 0).ivt.total, 0);
  const end = M.sample(seq1, seq1.duration);
  assert.equal(end.ivt.total, M.IVT_SIZE);
  assert.equal(end.ivt.bios, M.BIOS_VECTORS.length);
  // BIOS 登记的四项在内核初始化之前就已出现
  assert.ok(M.sample(seq1, seq1.times.bios[0] + 0.01).ivt.bios >= 1);
  assert.equal(M.sample(seq1, seq1.times.ivtBegin - 0.01).ivt.kernel, 0);
});

test('内核驻留前不可登录；登录后四项服务全部点亮', () => {
  const T = seq1.times;
  assert.equal(M.sample(seq1, T.kArrive - 0.01).boot.kernel.state, 'loading');
  assert.equal(M.sample(seq1, T.kArrive + 0.01).boot.kernel.state, 'resident');
  assert.equal(M.sample(seq1, T.login - 0.01).login, false);
  const end = M.sample(seq1, seq1.duration);
  assert.equal(end.login, true);
  assert.equal(end.svcUp, 4);
});

test('数据块进度始终在 0 到 1 之间，且只在窗口内可见', () => {
  const steps = 300;
  for (let i = 0; i <= steps; i++) {
    const s = M.sample(seq2, (seq2.duration * i) / steps);
    for (const key of Object.keys(s.packets)) {
      const pk = s.packets[key];
      assert.ok(pk.p >= 0 && pk.p <= 1, `${key} 进度越界：${pk.p}`);
    }
  }
  const mid = M.sample(seq1, seq1.times.mbrBegin + 0.5);
  assert.equal(mid.packets.mbr.visible, true);
  assert.equal(M.sample(seq1, seq1.times.mbrArrive + 0.01).packets.mbr.visible, false);
});

test('活动分区切换后，启动管理器的名称与引导来源随之变化', () => {
  const t = seq2.times.bmArrive + 0.2;
  assert.equal(M.sample(seq1, t).boot.loader, 'bootmgr');
  assert.equal(M.sample(seq2, t).boot.loader, 'grldr');
  assert.equal(M.sample(seq2, t).partitions[1].bmReading, false, '管理器已读完');
  const reading = M.sample(seq2, seq2.times.bmBegin + 0.3);
  assert.equal(reading.partitions[1].bmReading, true);
  assert.equal(reading.partitions[0].bmReading, false, '非活动分区不参与');
});

test('浮标在寿命内可见，寿命后消失；倒回之前也不出现', () => {
  const tag = (s, id) => s.tags.find((x) => x.id === id);
  const pre = M.sample(seq1, 0.1);
  assert.equal(tag(pre, 'reset-rom').opacity, 0, '未到时刻');
  const on = M.sample(seq1, 0.6);
  assert.ok(tag(on, 'reset-rom').opacity > 0, '寿命内可见');
  const off = M.sample(seq1, 3.0);
  assert.equal(tag(off, 'reset-rom').opacity, 0, '寿命后消失');
});

test('同一时刻与参数的画面可重复（纯函数，不依赖历史）', () => {
  const a = M.sample(seq2, 14.3);
  const b = M.sample(seq2, 0);
  const c = M.sample(seq2, 14.3);
  assert.deepEqual(a, c);
  assert.notDeepEqual(a, b);
});

test('stepIndexAt 在阶段起点取到本阶段，超界时钳制', () => {
  seq1.steps.forEach((s, i) => assert.equal(M.stepIndexAt(seq1, s.t0), i));
  assert.equal(M.stepIndexAt(seq1, -5), 0);
  assert.equal(M.stepIndexAt(seq1, 999), 9);
  assert.deepEqual(M.stepStarts(seq1), seq1.steps.map((s) => s.t0));
});

test('阶段归属：前八步为初始引导，第九步内核初始化，第十步全系统初始化', () => {
  const phaseOf = (i) => M.sample(seq1, seq1.steps[i].t0).phase;
  for (let i = 0; i < 8; i++) assert.equal(phaseOf(i), 'init');
  assert.equal(phaseOf(8), 'kernel');
  assert.equal(phaseOf(9), 'services');
});

test('PC 与执行者随时刻变化：ROM 执行 → MBR 代码 → 引导扇区代码 → 内核', () => {
  const at = (seq, id) => M.sample(seq, seq.steps.find((s) => s.id === id).t0 + 0.05);
  assert.equal(at(seq1, 'reset').pc, 'F000:FFF0');
  assert.equal(at(seq1, 'reset').exec, 'ROM · BIOS');
  assert.equal(at(seq1, 'scan').exec, 'MBR 代码');
  assert.equal(at(seq1, 'find-bm').exec, '引导扇区代码');
  assert.equal(at(seq1, 'kinit').pc, '内核入口');
});
