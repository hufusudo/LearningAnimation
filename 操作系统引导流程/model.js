/**
 * 操作系统引导流程的阶段模型。时间单位为秒，阶段时长固定。
 * 画面只由时刻 t 与参数（活动分区）决定：sample(seq, t) 不依赖历史，倒退与拖动都能精确重绘。
 * 界面只读取这里算好的状态，渲染时不做任何推演判断。
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({ active: 1 });

  // 两个操作系统分区：活动标志 0x80 落在哪一项，就引导哪一个系统
  const PARTITIONS = Object.freeze([
    Object.freeze({ id: 1, system: '系统 A', loader: 'bootmgr' }),
    Object.freeze({ id: 2, system: '系统 B', loader: 'grldr' })
  ]);

  const DPT_ENTRIES = 4;            // 分区表 4 项，每项 16 B
  const IVT_SIZE = 256;             // 中断向量表 256 项
  const BIOS_VECTORS = Object.freeze([0x10, 0x13, 0x16, 0x19]); // 视频、磁盘、键盘、自举
  const SCAN_STEP = 0.4;            // 逐项检查分区表，每项 0.4 s
  const PHASE_NAME = Object.freeze({ init: '初始引导', kernel: '内核初始化', services: '全系统初始化' });

  // 十个阶段。say 为舞台底部的一句因果解说（≤ 40 字）；tags 为瞬时浮标（at 相对本阶段起点）
  const STEP_SPEC = Object.freeze([
    Object.freeze({
      id: 'reset', phase: 'init', dur: 2.0, track: '加电', title: '加电复位',
      say: 'CPU 复位，CS:IP 指向 ROM 中的 BIOS，内存尚未可用。',
      tags: Object.freeze([{ id: 'reset-rom', text: '取指 · ROM', tone: 'note', at: 0.3, life: 1.8, anchor: 'rom' }])
    }),
    Object.freeze({
      id: 'post', phase: 'init', dur: 2.6, track: '自检', title: 'POST 自检',
      say: 'BIOS 自检硬件，并在中断向量表中登记 INT 13H 等服务。',
      tags: Object.freeze([{ id: 'post-vec', text: '服务已登记', tone: 'note', at: 1.0, life: 2.0, anchor: 'cpu' }])
    }),
    Object.freeze({
      id: 'pick', phase: 'init', dur: 2.2, track: '选盘', title: '选择启动盘',
      say: '按 CMOS 的启动顺序检查磁盘，0 扇区末尾为 55 AA 才可引导。',
      tags: Object.freeze([{ id: 'pick-sig', text: '55 AA ✓', tone: 'quiet', at: 1.0, life: 1.6, anchor: 'pick' }])
    }),
    Object.freeze({
      id: 'read-mbr', phase: 'init', dur: 2.6, track: '读 MBR', title: '读入 MBR',
      say: 'INT 13H 把 MBR（512 B）读到 0x7C00，然后交出控制权。',
      tags: Object.freeze([{ id: 'mbr-read', text: '读入 0x7C00', tone: 'note', at: 1.8, life: 1.6, anchor: 'lane' }])
    }),
    Object.freeze({
      id: 'scan', phase: 'init', dur: 3.4, track: '分区表', title: '扫描分区表',
      say: 'MBR 先把自己搬到 0x0600，再逐项检查分区表，首字节 80 为活动。',
      tags: Object.freeze([{ id: 'mbr-copy', text: '搬到 0x0600', tone: 'note', at: 0.5, life: 1.6, anchor: 'lane' }])
    }),
    Object.freeze({
      id: 'read-pbr', phase: 'init', dur: 2.6, track: '引导扇区', title: '读引导扇区',
      say: '读入活动分区的第一个扇区覆盖 0x7C00，校验 55 AA 后跳转执行。',
      tags: Object.freeze([{ id: 'pbr-over', text: '覆盖 0x7C00', tone: 'note', at: 1.6, life: 1.8, anchor: 'lane' }])
    }),
    Object.freeze({
      id: 'find-bm', phase: 'init', dur: 2.4, track: '管理器', title: '找启动管理器',
      say: '引导扇区在活动分区根目录中找到启动管理器，并读入内存。',
      tags: Object.freeze([{ id: 'bm-found', text: '找到 {loader}', tone: 'note', at: 0.9, life: 1.6, anchor: 'lane' }])
    }),
    Object.freeze({
      id: 'load-k', phase: 'init', dur: 3.0, track: '装内核', title: '装入内核',
      say: '启动管理器把内核镜像装入内存，内核驻留 RAM，控制权交给内核。',
      tags: Object.freeze([{ id: 'k-load', text: '内核装入 RAM', tone: 'note', at: 0.4, life: 2.0, anchor: 'lane' }])
    }),
    Object.freeze({
      id: 'kinit', phase: 'kernel', dur: 2.8, track: '内核', title: '内核初始化',
      say: '内核初始化硬件与数据结构，并在中断向量表中装入自己的服务程序。',
      tags: Object.freeze([{ id: 'k-ivt', text: '写入中断向量', tone: 'note', at: 0.5, life: 1.8, anchor: 'ivt' }])
    }),
    Object.freeze({
      id: 'services', phase: 'services', dur: 2.4, track: '服务', title: '全系统初始化',
      say: '启动驱动与文件系统等服务，全部就绪后即可登录使用。',
      tags: Object.freeze([])
    })
  ]);

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  function normalize(params) {
    const p = { ...DEFAULTS, ...(params || {}) };
    if (!Number.isInteger(p.active) || p.active < 1 || p.active > PARTITIONS.length) {
      throw new RangeError(`active 必须是 1 到 ${PARTITIONS.length} 之间的整数`);
    }
    return Object.freeze({ active: p.active });
  }

  // 生成阶段序列与关键时刻（绝对时间，单位秒）
  function buildSequence(params) {
    const p = normalize(params);
    let cursor = 0;
    const steps = STEP_SPEC.map((spec) => {
      const t0 = cursor;
      cursor = Number((cursor + spec.dur).toFixed(6));
      return Object.freeze({ ...spec, t0, t1: cursor });
    });
    const duration = cursor;
    const at = (id, local) => steps.find((s) => s.id === id).t0 + local;

    const scanStart = at('scan', 1.0);
    // 第 e 项的检查窗口为 [scanStart + (e-1)·步长, + 步长)；活动项检查完成后才确认
    const times = Object.freeze({
      bios: BIOS_VECTORS.map((_, j) => at('post', 0.4 + j * 0.18)),
      mbrBegin: at('read-mbr', 0.2),
      mbrArrive: at('read-mbr', 1.8),
      pcMbr: at('read-mbr', 1.9),
      mbrCopyEnd: at('scan', 1.0),
      scanStart,
      found: scanStart + p.active * SCAN_STEP,
      pbrBegin: at('read-pbr', 0.2),
      pbrArrive: at('read-pbr', 1.6),
      pcPbr: at('read-pbr', 1.9),
      bmBegin: at('find-bm', 0.2),
      bmSend: at('find-bm', 0.9),
      bmArrive: at('find-bm', 2.0),
      kBegin: at('load-k', 0.3),
      kArrive: at('load-k', 2.6),
      ivtBegin: at('kinit', 0.3),
      ivtEnd: at('kinit', 2.2),
      svc: [0, 1, 2, 3].map((i) => at('services', 0.3 + i * 0.4)),
      login: at('services', 2.2)
    });
    return Object.freeze({ params: p, steps: Object.freeze(steps), duration, times });
  }

  function stepIndexAt(seq, t) {
    const now = clamp(Number(t) || 0, 0, seq.duration);
    let idx = 0;
    seq.steps.forEach((s, i) => { if (now >= s.t0) idx = i; });
    return idx;
  }

  function stepStarts(seq) {
    return seq.steps.map((s) => s.t0);
  }

  // 第 1 步的 PC 与执行者随时刻变化：PC 为 0x7C00 之后不变，只换执行者
  function pcLabel(id, now, T) {
    switch (id) {
      case 'reset': return 'F000:FFF0';
      case 'post':
      case 'pick': return 'F000:····';
      case 'read-mbr': return now < T.pcMbr ? 'F000:····' : '0x007C00';
      case 'scan':
      case 'read-pbr':
      case 'find-bm': return '0x007C00';
      case 'load-k': return '启动管理器';
      default: return '内核入口';
    }
  }

  function execLabel(id, now, T) {
    switch (id) {
      case 'reset': return 'ROM · BIOS';
      case 'post': return 'ROM · POST';
      case 'pick': return 'ROM · 选盘';
      case 'read-mbr': return now < T.pcMbr ? 'ROM · INT 13H' : 'MBR 代码';
      case 'scan': return 'MBR 代码';
      case 'read-pbr': return now < T.pcPbr ? 'MBR 代码' : '引导扇区代码';
      case 'find-bm': return '引导扇区代码';
      case 'load-k': return '启动管理器';
      case 'kinit': return '内核 · 初始化';
      default: return '内核 · 系统服务';
    }
  }

  // 分区表第 e 项（1 起）的检查状态：idle 未检查 / scan 检查中 / skip 已跳过 / found 命中活动项
  function dptRow(e, active, now, T) {
    const start = T.scanStart + (e - 1) * SCAN_STEP;
    const end = start + SCAN_STEP;
    let state = 'idle';
    if (e <= active && now >= start) {
      if (now < end) state = 'scan';
      else state = e < active ? 'skip' : 'found';
    }
    return { id: e, flag: e === active ? '80' : '00', state };
  }

  function travel(now, begin, end) {
    const visible = now >= begin && now < end;
    const p = clamp((now - begin) / (end - begin), 0, 1);
    return { visible, p };
  }

  // 瞬时浮标：寿命内淡入、末段淡出，向上轻微漂移
  function tagState(tg, now, loader) {
    const age = now - tg.at;
    const text = tg.text.replace('{loader}', loader);
    if (age < 0 || age > tg.life) return { id: tg.id, text, tone: tg.tone, anchor: tg.anchor, opacity: 0, rise: 0 };
    const opacity = Math.min(1, age / 0.25) * Math.min(1, (tg.life - age) / 0.7);
    return { id: tg.id, text, tone: tg.tone, anchor: tg.anchor, opacity, rise: 6 * (age / tg.life) };
  }

  // 第 t 秒的完整画面（纯函数）
  function sample(seq, t) {
    const T = seq.times;
    const dur = seq.duration;
    const now = clamp(Number(t) || 0, 0, dur);
    const index = stepIndexAt(seq, now);
    const step = seq.steps[index];
    const active = seq.params.active;
    const part = PARTITIONS[active - 1];

    // 中断向量表：BIOS 登记的四项按顺序点亮，其余项由内核初始化补全
    const biosFilled = BIOS_VECTORS.filter((_, j) => now >= T.bios[j]).length;
    const kernelTotal = IVT_SIZE - BIOS_VECTORS.length;
    let kernelFilled = 0;
    if (now >= T.ivtEnd) kernelFilled = kernelTotal;
    else if (now > T.ivtBegin) kernelFilled = Math.floor(((now - T.ivtBegin) / (T.ivtEnd - T.ivtBegin)) * kernelTotal);

    // 分区表：从第 1 项起逐项检查，命中活动项即停止
    const dpt = [1, 2, 3, 4].map((e) => dptRow(e, active, now, T));
    const scanned = now >= T.scanStart
      ? Math.min(active, Math.floor((now - T.scanStart) / SCAN_STEP + 1e-9) + 1)
      : 0;

    const partitions = PARTITIONS.map((pt) => {
      const on = pt.id === active;
      return {
        id: pt.id,
        system: pt.system,
        loader: pt.loader,
        active: on,
        bootReading: on && now >= T.pbrBegin && now < T.pbrArrive,
        bmReading: on && now >= T.bmBegin && now < T.bmSend,
        kReading: on && now >= T.kBegin && now < T.kArrive
      };
    });

    let bootSlot = 'empty';
    if (now >= T.pbrArrive) bootSlot = 'pbr';
    else if (now >= T.mbrArrive) bootSlot = 'mbr';

    let kernel;
    if (now < T.kBegin) kernel = { state: 'empty', frac: 0 };
    else if (now < T.kArrive) kernel = { state: 'loading', frac: clamp((now - T.kBegin) / (T.kArrive - T.kBegin), 0, 1) };
    else kernel = { state: 'resident', frac: 1 };

    const tags = seq.steps
      .flatMap((s) => s.tags.map((tg) => ({ ...tg, at: s.t0 + tg.at })))
      .map((tg) => tagState(tg, now, part.loader));

    return Object.freeze({
      t: now,
      duration: dur,
      index,
      count: seq.steps.length,
      phase: step.phase,
      phaseName: PHASE_NAME[step.phase],
      title: step.title,
      say: step.say,
      track: step.track,
      pc: pcLabel(step.id, now, T),
      exec: execLabel(step.id, now, T),
      romActive: now < T.pcMbr,
      ivt: {
        bios: biosFilled,
        kernel: kernelFilled,
        total: biosFilled + kernelFilled,
        size: IVT_SIZE
      },
      dpt,
      scanned,
      partitions,
      boot: {
        slot: bootSlot,
        mbrCopy: now >= T.mbrCopyEnd,
        bootmgr: now >= T.bmArrive,
        loader: part.loader,
        kernel
      },
      disk: { mbrReading: now >= T.mbrBegin && now < T.mbrArrive },
      packets: {
        mbr: travel(now, T.mbrBegin, T.mbrArrive),
        pbr: travel(now, T.pbrBegin, T.pbrArrive),
        bm: travel(now, T.bmSend, T.bmArrive),
        k: travel(now, T.kBegin, T.kArrive)
      },
      svcUp: T.svc.filter((x) => now >= x).length,
      login: now >= T.login,
      tags
    });
  }

  const api = {
    DEFAULTS, PARTITIONS, DPT_ENTRIES, IVT_SIZE, BIOS_VECTORS, SCAN_STEP, PHASE_NAME, STEP_SPEC,
    buildSequence, sample, stepIndexAt, stepStarts
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BootModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
