(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PagingModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCENARIOS = Object.freeze({
    A: Object.freeze({
      key: 'A', p: 2, f: 5, d: '0x14A', la: '0x214A', pa: '0x514A', value: '0xCAFE',
      title: '快表命中，直接找到物理帧'
    }),
    B: Object.freeze({
      key: 'B', p: 1, f: 3, d: '0x0C8', la: '0x10C8', pa: '0x30C8', value: '0x5A5A',
      title: '快表没有映射，继续查主存页表'
    }),
    C: Object.freeze({
      key: 'C', p: 3, f: 6, d: '0x054', la: '0x3054', pa: '0x6054', value: '0xBEEF',
      title: '页面不在内存，先调页，再重执行'
    })
  });

  const DEFAULT_TRAVEL = 1100;
  const DEFAULT_HOLD = 850;

  function makeStep(id, title, detail, phase, from, to, wire, packet, kind, travel) {
    return {
      id, title, detail, phase, from, to, wire, packet, kind,
      start: 0,
      travel: travel === undefined ? DEFAULT_TRAVEL : travel,
      hold: DEFAULT_HOLD,
      end: 0
    };
  }

  function scenarioSteps(key, meta) {
    const { p, f, d, la, pa, value } = meta;
    const steps = [
      makeStep('issue', 'CPU 发出逻辑地址', `发出 ${la}，拆分 P=${p} 与偏移 D=${d}。`, '地址变换', 'node-cpu', 'node-mmu', 'wire-cpu-mmu', `LA ${la}`, 'la'),
      makeStep('tlb', '用页号查询 TLB', '查询页号到帧号的缓存映射，不计主存读取。', '地址变换', 'node-mmu', 'node-tlb', 'wire-mmu-tlb', `查 P=${p}`, 'p')
    ];

    if (key !== 'A') {
      steps.push(makeStep(
        'pte', '读取主存中的页表项',
        key === 'C' ? 'TLB 未命中后读到 V=0，确认发生缺页。' : '页表 V=1，页面已在主存，无需调页。',
        '地址变换', 'node-mmu', 'node-pt', 'wire-mmu-pt', `PTE[${p}]`, 'la'
      ));
    }

    if (key === 'C') {
      steps.push(
        makeStep('fault', '缺页异常：原指令暂停', '进入内核态处理缺页，LOAD 等待且 R0 未改变。', '缺页处理', 'node-mmu', 'node-cpu', 'wire-mmu-cpu', '缺页异常', 'fault'),
        makeStep('disk', 'OS 请求读取磁盘页面', '读取 Block 3，并为 Page 3 分配空闲 Frame 6。', '缺页处理', 'node-cpu', 'node-disk', 'wire-os-disk', '读取 Block 3', 'disk', 1500),
        makeStep('page-in', '将完整页面装入空闲帧', '将完整 4 KB 的 Page 3 装入 Frame 6，页表仍为 V=0。', '缺页处理', 'node-disk', 'node-ram', 'wire-disk-ram', 'Page 3 · 4 KB', 'f', 2000),
        makeStep('update-pte', '更新页表：现在可以访问了', '页面装入后，将 P=3 更新为 V=1、F=6。', '更新映射', 'node-cpu', 'node-pt', 'wire-cpu-pt', 'P=3 · V=1 · F=6', 'pa'),
        makeStep('fill-tlb', '回填 TLB 映射', '将 P=3 → F=6 写入 TLB，供重执行命中。', '更新映射', 'node-mmu', 'node-tlb', 'wire-mmu-tlb', 'P=3 → F=6', 'pa'),
        makeStep('retry', '回到原指令，重新执行', `重执行原 LOAD ${la}，逻辑地址保持不变。`, '重新执行', 'node-cpu', 'node-mmu', 'wire-cpu-mmu', `重执 LA ${la}`, 'la'),
        makeStep('retry-tlb', '再次查询 TLB，这次命中', '重执行使用刚回填的 P=3 → F=6 映射。', '重新执行', 'node-mmu', 'node-tlb', 'wire-mmu-tlb', '查 P=3', 'p')
      );
    } else if (key === 'B') {
      steps.push(makeStep('frame', '页表返回物理帧号', `从页表取得 F=${f}，偏移 ${d} 保持不变。`, '地址变换', 'node-pt', 'node-mmu', 'wire-pt-mmu', `F = ${f}`, 'f'));
      steps.push(makeStep('fill-tlb', '回填 TLB，方便下次访问', `将 P=${p} → F=${f} 写入空闲槽。`, '更新映射', 'node-mmu', 'node-tlb', 'wire-mmu-tlb', `P=${p} → F=${f}`, 'pa'));
    }

    if (key === 'B') {
      steps.push(makeStep('assemble', '帧号与原偏移合成物理地址', `PA = F × 4096 + D = ${pa}，页内偏移不变。`, '地址变换', null, null, null, `F=${f} + D=${d}`, 'pa', 700));
    } else {
      steps.push(makeStep('assemble', '帧号返回 MMU，合成物理地址', `以 F=${f} 替换页号，保留 D=${d}，得到 ${pa}。`, key === 'C' ? '重新执行' : '地址变换', 'node-tlb', 'node-mmu', 'wire-tlb-mmu', `F = ${f}`, 'f'));
    }

    steps.push(
      makeStep('read', '用物理地址读取目标数据', `访问 Frame ${f} 的偏移 ${d}，读取指令需要的数据。`, '读取数据', 'node-mmu', 'node-ram', 'wire-mmu-ram', `PA ${pa}`, 'pa'),
      makeStep('return', '数据返回 R0，指令完成', `数据 ${value} 返回 CPU，LOAD 指令完成。`, '读取数据', 'node-ram', 'node-cpu', 'wire-ram-cpu', `数据 ${value}`, 'data')
    );

    let cursor = 0;
    for (const step of steps) {
      step.start = cursor;
      step.end = cursor + step.travel + step.hold;
      cursor = step.end;
    }
    return { steps, duration: cursor };
  }

  function buildScenario(key) {
    if (!Object.prototype.hasOwnProperty.call(SCENARIOS, key)) {
      throw new RangeError(`Unknown paging scenario: ${key}`);
    }
    const meta = { ...SCENARIOS[key] };
    const { steps, duration } = scenarioSteps(key, meta);
    return { key, meta, steps, duration };
  }

  function initialState(key) {
    const isA = key === 'A';
    const isC = key === 'C';
    return {
      tlb: (isA
        ? [
            { v: 1, p: 2, f: 5 }, { v: 1, p: 0, f: 1 },
            { v: 1, p: 4, f: 4 }, { v: 0, p: '-', f: '-' }
          ]
        : [
            { v: 1, p: 0, f: 1 }, { v: 1, p: 4, f: 4 },
            { v: 1, p: 7, f: 7 }, { v: 0, p: '-', f: '-' }
          ]),
      pt: [
        { p: 0, v: 1, f: 1, disk: 'Block 0' },
        { p: 1, v: 1, f: 3, disk: 'Block 1' },
        { p: 2, v: 1, f: 5, disk: 'Block 2' },
        { p: 3, v: isC ? 0 : 1, f: isC ? '-' : 6, disk: 'Block 3' },
        { p: 4, v: 1, f: 4, disk: 'Block 4' },
        { p: 5, v: 0, f: '-', disk: 'Block 5' },
        { p: 7, v: 1, f: 7, disk: 'Block 7' }
      ],
      frames: [
        { id: 0, page: 'OS 内核', occupied: true, data: '0x00FF' },
        { id: 1, page: 'Page 0', occupied: true, data: '0x1A2B' },
        { id: 2, page: '空闲', occupied: false, data: '—' },
        { id: 3, page: 'Page 1', occupied: true, data: '0x5A5A' },
        { id: 4, page: 'Page 4', occupied: true, data: '0x4444' },
        { id: 5, page: 'Page 2', occupied: true, data: '0xCAFE' },
        { id: 6, page: isC ? '空闲' : 'Page 3', occupied: !isC, data: isC ? '—' : '0xBEEF' },
        { id: 7, page: 'Page 7', occupied: true, data: '0x7777' }
      ],
      disk: [
        { id: 0, page: 'Page 0', state: '外存驻留' },
        { id: 1, page: 'Page 1', state: '外存驻留' },
        { id: 2, page: 'Page 2', state: '外存驻留' },
        { id: 3, page: 'Page 3', state: isC ? '待调入' : '已调入内存' }
      ]
    };
  }

  function addLog(state, stepId, stage, target, address, result, mainMemory, detail) {
    state.logs.push({ stepId, stage, target, address, result, mainMemory, detail });
  }

  function applyArrival(state, step, meta) {
    const { p, f, d, pa, value } = meta;
    switch (step.id) {
      case 'issue':
        state.split = true;
        break;
      case 'tlb':
        addLog(state, 'tlb', '查快表', 'TLB', `P=${p}`, state.key === 'A' ? '命中' : '未命中', false, 'TLB 缓存的是映射，不是页面内容');
        break;
      case 'pte':
        state.counters.memoryReads += 1;
        addLog(state, 'pte', '查页表', '主存页表', `P=${p}`, state.key === 'C' ? '缺页 (V=0)' : `有效 (F=${f})`, true, '读取一个页表项');
        break;
      case 'fault':
        state.fault = true;
        state.cpuMode = 'kernel';
        state.osStatus = '原指令等待调页';
        break;
      case 'disk':
        state.disk[3].state = '页面就绪';
        addLog(state, 'disk', '外存 I/O', '磁盘', 'Block 3', '读取成功', false, '磁盘 I/O 与主存单次读取分开统计');
        break;
      case 'page-in':
        state.counters.pageTransfers += 1;
        Object.assign(state.frames[6], { page: 'Page 3', occupied: true, data: '0xBEEF' });
        state.disk[3].state = '已调入 Frame 6';
        addLog(state, 'page-in', '调页写入', '物理主存', 'Frame 6', '整页写入', true, '4 KB 页面传输，不等同于一次字读取');
        break;
      case 'update-pte':
        state.counters.tableWrites += 1;
        state.pt.find(row => row.p === 3).v = 1;
        state.pt.find(row => row.p === 3).f = 6;
        addLog(state, 'update-pte', '更新页表', '主存页表', 'P=3 → F=6', '写表完成', true, '先装入页面，再将页表标记为有效');
        break;
      case 'fill-tlb':
        state.tlb[3] = { v: 1, p, f };
        if (state.key === 'B') {
          addLog(state, 'fill-tlb', '写快表', 'TLB', `P=${p} → F=${f}`, '写入成功', false, '只缓存页号到帧号的映射');
        } else {
          addLog(state, 'fill-tlb', '写快表', 'TLB', 'P=3 → F=6', '写入成功', false, '回填映射，未再次搬运页面');
        }
        break;
      case 'frame':
        state.frame = f;
        break;
      case 'retry':
        state.fault = false;
        state.cpuMode = 'user';
        state.osStatus = '调页完成，恢复原指令';
        break;
      case 'retry-tlb':
        addLog(state, 'retry-tlb', '重执查快表', 'TLB', 'P=3', '命中', false, '使用调页后建立的新映射');
        break;
      case 'assemble':
        state.frame = f;
        state.physicalAddress = pa;
        break;
      case 'read':
        state.counters.memoryReads += 1;
        addLog(state, 'read', '读取数据', '物理主存', pa, '读取成功', true, `Frame ${f}，偏移 ${d}`);
        break;
      case 'return':
        state.r0 = value;
        break;
    }
  }

  function sample(plan, time) {
    const requested = typeof time === 'number' && !Number.isNaN(time) ? time : 0;
    const boundedTime = Math.max(0, Math.min(plan.duration, requested));
    let stepIndex = plan.steps.findIndex((step, index) => boundedTime < step.end || index === plan.steps.length - 1);
    if (stepIndex < 0) stepIndex = plan.steps.length - 1;
    const step = plan.steps[stepIndex];
    const local = boundedTime - step.start;
    const state = {
      key: plan.key,
      ...initialState(plan.key),
      split: false,
      frame: null,
      physicalAddress: null,
      r0: null,
      cpuMode: 'user',
      fault: false,
      osStatus: '待命',
      counters: { memoryReads: 0, pageTransfers: 0, tableWrites: 0 },
      logs: []
    };

    for (const event of plan.steps) {
      if (boundedTime >= event.start + event.travel) applyArrival(state, event, plan.meta);
    }

    return {
      time: boundedTime,
      stepIndex,
      step: { ...step },
      local,
      travelProgress: Math.min(local / step.travel, 1),
      arrived: local >= step.travel,
      complete: boundedTime >= plan.duration,
      progress: boundedTime / plan.duration,
      tlb: state.tlb.map(row => ({ ...row })),
      pt: state.pt.map(row => ({ ...row })),
      frames: state.frames.map(row => ({ ...row })),
      disk: state.disk.map(row => ({ ...row })),
      split: state.split,
      frame: state.frame,
      physicalAddress: state.physicalAddress,
      r0: state.r0,
      cpuMode: state.cpuMode,
      fault: state.fault,
      osStatus: state.osStatus,
      counters: { ...state.counters },
      logs: state.logs.map(log => ({ ...log }))
    };
  }

  return { SCENARIOS, buildScenario, sample };
});
