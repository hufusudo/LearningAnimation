/**
 * 伙伴系统 (Buddy System) 动态分区内存管理与回收
 * 动效与决策增强版：
 * 1. 划分未达到目的时，上方显著提示过大并继续划分
 * 2. 每次划分产生的新伙伴块均平滑移动并链接到对应空闲链表
 * 3. 达到目的时进程从左侧平滑移入占用
 * 4. 进程回收时检测伙伴块占用阻断合并，作为独立伙伴块平滑移入链表
 */

(function () {
  'use strict';

  const TOTAL_MEMORY = 1024; // 1024 KB

  // 完整 8 阶段细粒度演进定义 (Step 0 ~ 7)
  const STEPS = [
    {
      id: 0,
      badge: 'STEP 0 / 7',
      actionTag: '初始整块就绪',
      actionDesc: '物理内存为单一整块 1024KB 空间，直接挂入 1024KB 空闲链表，各进程处于待申请状态。',
      banner: {
        icon: '💡',
        main: '初始状态：物理内存为单一整块 1024KB 空间，挂入 1024KB 空闲双向链表',
        sub: '系统准备接收进程申请，三进程 P1(70K)、P2(256K)、P3(190K) 在左侧就绪',
        badgeText: '1024K 就绪',
        styleClass: 'bg-stone-50 border-stone-300 text-stone-800',
        badgeClass: 'bg-stone-200 text-stone-700'
      },
      procs: {
        p1: { status: '待申请', badgeClass: 'bg-white text-stone-600 border border-stone-200' },
        p2: { status: '待申请', badgeClass: 'bg-white text-stone-600 border border-stone-200' },
        p3: { status: '待申请', badgeClass: 'bg-white text-stone-600 border border-stone-200' }
      },
      memoryBlocks: [
        { start: 0, size: 1024, status: 'free', proc: null, label: '1024 KB 空闲整块' }
      ],
      freeLists: {
        1024: [{ start: 0, size: 1024 }],
        512: [],
        256: [],
        128: [],
        64: []
      },
      treeNodes: [
        { id: '1024_0', label: '1024K [0..1024K]', status: 'free', level: 0, x: 380, y: 25 }
      ],
      treeEdges: [],
      motion: null
    },

    {
      id: 1,
      badge: 'STEP 1 / 7',
      actionTag: 'P1 首次划分 (1024K➔512K)',
      actionDesc: 'P1 申请 70KB ➔ 目标需 128KB ➔ 首次划分 1024K 得到 512K 块，区域过大继续划分！新伙伴 [512..1024K] 移动链接入 512K 链表。',
      banner: {
        icon: '⚠️',
        main: 'P1 申请 70K (需 128K)：首次划分块大小为 512K，区域过大，继续折半划分！',
        sub: '右半部分 [512K..1024K] 作为新伙伴块，平滑移入下方 512KB 空闲链表建立链接',
        badgeText: '区域过大 · 继续划分',
        styleClass: 'bg-amber-50 border-amber-300 text-amber-900',
        badgeClass: 'bg-amber-200 text-amber-900'
      },
      procs: {
        p1: { status: '折半划分中 (512K过大)...', badgeClass: 'bg-amber-100 text-amber-800 font-bold' },
        p2: { status: '待申请', badgeClass: 'bg-white text-stone-600 border border-stone-200' },
        p3: { status: '待申请', badgeClass: 'bg-white text-stone-600 border border-stone-200' }
      },
      memoryBlocks: [
        { start: 0, size: 512, status: 'splitting', proc: null, label: '512 KB (过大·待继续折半)' },
        { start: 512, size: 512, status: 'new_buddy', proc: null, label: '512 KB (新伙伴块 ➔ 移入512K链表)' }
      ],
      freeLists: {
        1024: [],
        512: [{ start: 512, size: 512, isNew: true }],
        256: [],
        128: [],
        64: []
      },
      treeNodes: [
        { id: '1024_0', label: '1024K [0..1024K]', status: 'split', level: 0, x: 380, y: 25 },
        { id: '512_0', label: '512K [0..512K] (过大)', status: 'split', level: 1, x: 200, y: 70 },
        { id: '512_1', label: '512K [512..1024K]', status: 'free', level: 1, x: 560, y: 70 }
      ],
      treeEdges: [
        { from: '1024_0', to: '512_0' },
        { from: '1024_0', to: '512_1' }
      ],
      motion: {
        type: 'split_and_link_buddy',
        splitLaserPct: 50,
        buddyFrom: 'block-512-1024',
        buddyToList: 'list-row-512',
        buddyText: '新伙伴块 [512..1024K] ➔ 链接入 512KB 链表'
      }
    },

    {
      id: 2,
      badge: 'STEP 2 / 7',
      actionTag: 'P1 二次划分 (512K➔256K)',
      actionDesc: 'P1 目标为 128KB ➔ 对 [0..512K] 再次划分得到 256K 块，区域仍然过大，继续折半划分！新伙伴 [256..512K] 移动链接入 256K 链表。',
      banner: {
        icon: '⚠️',
        main: 'P1 需 128K：本次划分块大小为 256K，区域仍然过大，继续折半划分！',
        sub: '右半部分 [256K..512K] 作为新伙伴块，平滑移入下方 256KB 空闲链表建立链接',
        badgeText: '仍然过大 · 继续划分',
        styleClass: 'bg-amber-50 border-amber-300 text-amber-900',
        badgeClass: 'bg-amber-200 text-amber-900'
      },
      procs: {
        p1: { status: '折半划分中 (256K仍过大)...', badgeClass: 'bg-amber-100 text-amber-800 font-bold' },
        p2: { status: '待申请', badgeClass: 'bg-white text-stone-600 border border-stone-200' },
        p3: { status: '待申请', badgeClass: 'bg-white text-stone-600 border border-stone-200' }
      },
      memoryBlocks: [
        { start: 0, size: 256, status: 'splitting', proc: null, label: '256 KB (仍过大·待继续折半)' },
        { start: 256, size: 256, status: 'new_buddy', proc: null, label: '256 KB (新伙伴块 ➔ 移入256K链表)' },
        { start: 512, size: 512, status: 'free', proc: null, label: '512 KB 空闲伙伴' }
      ],
      freeLists: {
        1024: [],
        512: [{ start: 512, size: 512 }],
        256: [{ start: 256, size: 256, isNew: true }],
        128: [],
        64: []
      },
      treeNodes: [
        { id: '1024_0', label: '1024K [0..1024K]', status: 'split', level: 0, x: 380, y: 25 },
        { id: '512_0', label: '512K [0..512K]', status: 'split', level: 1, x: 200, y: 70 },
        { id: '512_1', label: '512K [512..1024K]', status: 'free', level: 1, x: 560, y: 70 },
        { id: '256_0', label: '256K [0..256K] (仍过大)', status: 'split', level: 2, x: 110, y: 115 },
        { id: '256_1', label: '256K [256..512K]', status: 'free', level: 2, x: 290, y: 115 }
      ],
      treeEdges: [
        { from: '1024_0', to: '512_0' },
        { from: '1024_0', to: '512_1' },
        { from: '512_0', to: '256_0' },
        { from: '512_0', to: '256_1' }
      ],
      motion: {
        type: 'split_and_link_buddy',
        splitLaserPct: 25,
        buddyFrom: 'block-256-512',
        buddyToList: 'list-row-256',
        buddyText: '新伙伴块 [256..512K] ➔ 链接入 256KB 链表'
      }
    },

    {
      id: 3,
      badge: 'STEP 3 / 7',
      actionTag: 'P1 达到目标并占用',
      actionDesc: '本次划分块大小为 128K，恰好达到 P1 目标大小！右伙伴 [128..256K] 移入 128K 链表；P1 从左侧平滑移入主存占用 [0..128K]！',
      banner: {
        icon: '✨',
        main: '本次划分块大小为 128K，恰好达到 P1 目标大小！',
        sub: '右伙伴 [128..256K] 移入 128KB 链表建立链接；左伙伴 [0..128K] 由 P1 从左侧平滑移入占用！',
        badgeText: '达到目标 · 移入占用',
        styleClass: 'bg-blue-50 border-blue-300 text-blue-900',
        badgeClass: 'bg-blue-600 text-white'
      },
      procs: {
        p1: { status: '已移入内存 (70K/128K)', badgeClass: 'bg-blue-600 text-white font-bold' },
        p2: { status: '待申请', badgeClass: 'bg-white text-stone-600 border border-stone-200' },
        p3: { status: '待申请', badgeClass: 'bg-white text-stone-600 border border-stone-200' }
      },
      memoryBlocks: [
        {
          start: 0, size: 128, status: 'allocated',
          proc: { pid: 'P1', reqSize: 70, color: 'p1', fragSize: 58 },
          label: 'P1 (70K / 128K)'
        },
        { start: 128, size: 128, status: 'new_buddy', proc: null, label: '128 KB (新伙伴块 ➔ 移入128K链表)' },
        { start: 256, size: 256, status: 'free', proc: null, label: '256 KB (伙伴块在链表)' },
        { start: 512, size: 512, status: 'free', proc: null, label: '512 KB (伙伴块在链表)' }
      ],
      freeLists: {
        1024: [],
        512: [{ start: 512, size: 512 }],
        256: [{ start: 256, size: 256 }],
        128: [{ start: 128, size: 128, isNew: true }],
        64: []
      },
      treeNodes: [
        { id: '1024_0', label: '1024K [0..1024K]', status: 'split', level: 0, x: 380, y: 25 },
        { id: '512_0', label: '512K [0..512K]', status: 'split', level: 1, x: 200, y: 70 },
        { id: '512_1', label: '512K [512..1024K]', status: 'free', level: 1, x: 560, y: 70 },
        { id: '256_0', label: '256K [0..256K]', status: 'split', level: 2, x: 110, y: 115 },
        { id: '256_1', label: '256K [256..512K]', status: 'free', level: 2, x: 290, y: 115 },
        { id: '128_0', label: 'P1: 128K (70K实占)', status: 'p1', level: 3, x: 60, y: 160 },
        { id: '128_1', label: '128K [128..256K]', status: 'free', level: 3, x: 160, y: 160 }
      ],
      treeEdges: [
        { from: '1024_0', to: '512_0' },
        { from: '1024_0', to: '512_1' },
        { from: '512_0', to: '256_0' },
        { from: '512_0', to: '256_1' },
        { from: '256_0', to: '128_0' },
        { from: '256_0', to: '128_1' }
      ],
      motion: {
        type: 'proc_and_buddy',
        procId: 'p1',
        fromProc: 'proc-card-p1',
        toBlock: 'block-0-128',
        buddyFrom: 'block-128-256',
        buddyToList: 'list-row-128',
        buddyText: '新伙伴块 [128..256K] ➔ 链接入 128KB 链表'
      }
    },

    {
      id: 4,
      badge: 'STEP 4 / 7',
      actionTag: 'P2 等额命中移入',
      actionDesc: 'P2 申请 256KB ➔ 恰好等额吻合 256K 链表中的伙伴块 [256..512K] ➔ 链表节点移出 ➔ P2 从左侧平滑移入主存占用 (0 内部碎片)！',
      banner: {
        icon: '★',
        main: 'P2 申请 256K：直接命中 256KB 空闲链表中的伙伴块，出链分配！',
        sub: '申请空间刚好是切分块大小，无需再次划分，零内部碎片！P2 从左侧平滑移入占用',
        badgeText: '等额命中 · 零碎片',
        styleClass: 'bg-emerald-50 border-emerald-300 text-emerald-900',
        badgeClass: 'bg-emerald-600 text-white'
      },
      procs: {
        p1: { status: '已在内存运行 (70K/128K)', badgeClass: 'bg-blue-600 text-white font-bold' },
        p2: { status: '已移入内存 (256K 满额)', badgeClass: 'bg-emerald-600 text-white font-bold' },
        p3: { status: '待申请', badgeClass: 'bg-white text-stone-600 border border-stone-200' }
      },
      memoryBlocks: [
        {
          start: 0, size: 128, status: 'allocated',
          proc: { pid: 'P1', reqSize: 70, color: 'p1', fragSize: 58 },
          label: 'P1 (70K / 128K)'
        },
        { start: 128, size: 128, status: 'free', proc: null, label: '128 KB 空闲' },
        {
          start: 256, size: 256, status: 'allocated',
          proc: { pid: 'P2', reqSize: 256, color: 'p2', fragSize: 0 },
          label: 'P2 (256K / 256K 等额)'
        },
        { start: 512, size: 512, status: 'free', proc: null, label: '512 KB 空闲' }
      ],
      freeLists: {
        1024: [],
        512: [{ start: 512, size: 512 }],
        256: [], // 刚才的 256K 伙伴块被 P2 取出占用，平滑移动变空
        128: [{ start: 128, size: 128 }],
        64: []
      },
      treeNodes: [
        { id: '1024_0', label: '1024K [0..1024K]', status: 'split', level: 0, x: 380, y: 25 },
        { id: '512_0', label: '512K [0..512K]', status: 'split', level: 1, x: 200, y: 70 },
        { id: '512_1', label: '512K [512..1024K]', status: 'free', level: 1, x: 560, y: 70 },
        { id: '256_0', label: '256K [0..256K]', status: 'split', level: 2, x: 110, y: 115 },
        { id: '256_1', label: 'P2: 256K (满额占用)', status: 'p2', level: 2, x: 290, y: 115 },
        { id: '128_0', label: 'P1: 128K (70K实占)', status: 'p1', level: 3, x: 60, y: 160 },
        { id: '128_1', label: '128K [128..256K]', status: 'free', level: 3, x: 160, y: 160 }
      ],
      treeEdges: [
        { from: '1024_0', to: '512_0' },
        { from: '1024_0', to: '512_1' },
        { from: '512_0', to: '256_0' },
        { from: '512_0', to: '256_1' },
        { from: '256_0', to: '128_0' },
        { from: '256_0', to: '128_1' }
      ],
      motion: {
        type: 'proc_from_left_and_list_pull',
        procId: 'p2',
        fromProc: 'proc-card-p2',
        toBlock: 'block-256-512',
        pullFromList: 'list-row-256'
      }
    },

    {
      id: 5,
      badge: 'STEP 5 / 7',
      actionTag: 'P3 划分 512K 并占用',
      actionDesc: 'P3 申请 190KB (需 256KB) ➔ 256K 链表为空 ➔ 取出 512K 块折半切分 ➔ 新伙伴 [768..1024K] 移动链接入 256K 链表 ➔ P3 从左侧平滑移入主存 [512..768K]！',
      banner: {
        icon: '⚡',
        main: 'P3 申请 190K (需 256K)：256K 链表为空，划分 512K 伙伴块得到 256K 刚好满足！',
        sub: '新伙伴 [768..1024K] 平滑移入 256KB 链表建立链接；左半部分由 P3 从左侧移入占用！',
        badgeText: '折半满足 · 移入占用',
        styleClass: 'bg-purple-50 border-purple-300 text-purple-900',
        badgeClass: 'bg-purple-600 text-white'
      },
      procs: {
        p1: { status: '已在内存运行', badgeClass: 'bg-blue-600 text-white font-bold' },
        p2: { status: '已在内存运行', badgeClass: 'bg-emerald-600 text-white font-bold' },
        p3: { status: '已移入内存 (190K/256K)', badgeClass: 'bg-purple-600 text-white font-bold' }
      },
      memoryBlocks: [
        {
          start: 0, size: 128, status: 'allocated',
          proc: { pid: 'P1', reqSize: 70, color: 'p1', fragSize: 58 },
          label: 'P1 (70K / 128K)'
        },
        { start: 128, size: 128, status: 'free', proc: null, label: '128 KB 空闲' },
        {
          start: 256, size: 256, status: 'allocated',
          proc: { pid: 'P2', reqSize: 256, color: 'p2', fragSize: 0 },
          label: 'P2 (256K / 256K 等额)'
        },
        {
          start: 512, size: 256, status: 'allocated',
          proc: { pid: 'P3', reqSize: 190, color: 'p3', fragSize: 66 },
          label: 'P3 (190K / 256K)'
        },
        { start: 768, size: 256, status: 'new_buddy', proc: null, label: '256 KB (新伙伴块 ➔ 移入256K链表)' }
      ],
      freeLists: {
        1024: [],
        512: [],
        256: [{ start: 768, size: 256, isNew: true }],
        128: [{ start: 128, size: 128 }],
        64: []
      },
      treeNodes: [
        { id: '1024_0', label: '1024K [0..1024K]', status: 'split', level: 0, x: 380, y: 25 },
        { id: '512_0', label: '512K [0..512K]', status: 'split', level: 1, x: 200, y: 70 },
        { id: '512_1', label: '512K [512..1024K]', status: 'split', level: 1, x: 560, y: 70 },
        { id: '256_0', label: '256K [0..256K]', status: 'split', level: 2, x: 110, y: 115 },
        { id: '256_1', label: 'P2: 256K (满额)', status: 'p2', level: 2, x: 290, y: 115 },
        { id: '256_2', label: 'P3: 256K (190K实占)', status: 'p3', level: 2, x: 470, y: 115 },
        { id: '256_3', label: '256K [768..1024K]', status: 'free', level: 2, x: 650, y: 115 },
        { id: '128_0', label: 'P1: 128K (70K实占)', status: 'p1', level: 3, x: 60, y: 160 },
        { id: '128_1', label: '128K [128..256K]', status: 'free', level: 3, x: 160, y: 160 }
      ],
      treeEdges: [
        { from: '1024_0', to: '512_0' },
        { from: '1024_0', to: '512_1' },
        { from: '512_0', to: '256_0' },
        { from: '512_0', to: '256_1' },
        { from: '512_1', to: '256_2' },
        { from: '512_1', to: '256_3' },
        { from: '256_0', to: '128_0' },
        { from: '256_0', to: '128_1' }
      ],
      motion: {
        type: 'proc_and_buddy',
        procId: 'p3',
        fromProc: 'proc-card-p3',
        toBlock: 'block-512-768',
        buddyFrom: 'block-768-1024',
        buddyToList: 'list-row-256',
        buddyText: '新伙伴块 [768..1024K] ➔ 链接入 256KB 链表'
      }
    },

    {
      id: 6,
      badge: 'STEP 6 / 7',
      actionTag: 'P2回收 · 伙伴被占阻断合并',
      actionDesc: 'P2 进程释放回收 ➔ 计算伙伴基址 256 ⊕ 256 = 0 [0..256K] ➔ 检验发现伙伴块内仍有 P1 运行(仍被占用) ➔ 无法合并！该块变为独立空闲块，平滑移动下移至 256KB 链表建立链接！',
      banner: {
        icon: '⛔',
        main: 'P2 释放回收：检验伙伴基址 0 发现 [0..256K] 仍被 P1 占用，无法合并！',
        sub: '回收块 [256..512K] 独立作为新伙伴块，平滑移动下移至 256KB 链表重新建立双向链接！',
        badgeText: '伙伴被占 · 移入链表',
        styleClass: 'bg-red-50 border-red-300 text-red-900',
        badgeClass: 'bg-red-600 text-white'
      },
      procs: {
        p1: { status: '仍占用 [0..128K] (阻塞P2合并)', badgeClass: 'bg-blue-600 text-white font-bold animate-pulse' },
        p2: { status: '已回收释放', badgeClass: 'bg-stone-200 text-stone-700 font-bold' },
        p3: { status: '已在内存运行', badgeClass: 'bg-purple-600 text-white font-bold' }
      },
      memoryBlocks: [
        {
          start: 0, size: 128, status: 'allocated',
          proc: { pid: 'P1', reqSize: 70, color: 'p1', fragSize: 58 },
          label: 'P1 (运行中·阻碍合并)'
        },
        { start: 128, size: 128, status: 'free', proc: null, label: '128 KB 空闲' },
        { start: 256, size: 256, status: 'new_buddy', proc: null, label: '256 KB (P2回收 ➔ 伙伴被占 ➔ 移入256K链表)' },
        {
          start: 512, size: 256, status: 'allocated',
          proc: { pid: 'P3', reqSize: 190, color: 'p3', fragSize: 66 },
          label: 'P3 (190K / 256K)'
        },
        { start: 768, size: 256, status: 'free', proc: null, label: '256 KB 空闲伙伴' }
      ],
      freeLists: {
        1024: [],
        512: [],
        256: [
          { start: 256, size: 256, isNew: true },
          { start: 768, size: 256 }
        ],
        128: [{ start: 128, size: 128 }],
        64: []
      },
      treeNodes: [
        { id: '1024_0', label: '1024K [0..1024K]', status: 'split', level: 0, x: 380, y: 25 },
        { id: '512_0', label: '512K [0..512K]', status: 'split', level: 1, x: 200, y: 70 },
        { id: '512_1', label: '512K [512..1024K]', status: 'split', level: 1, x: 560, y: 70 },
        { id: '256_0', label: '256K [0..256K] (P1占用中)', status: 'split', level: 2, x: 110, y: 115 },
        { id: '256_1', label: '256K [256..512K] (P2释放)', status: 'free', level: 2, x: 290, y: 115 },
        { id: '256_2', label: 'P3: 256K (190K实占)', status: 'p3', level: 2, x: 470, y: 115 },
        { id: '256_3', label: '256K [768..1024K]', status: 'free', level: 2, x: 650, y: 115 },
        { id: '128_0', label: 'P1: 128K (70K实占)', status: 'p1', level: 3, x: 60, y: 160 },
        { id: '128_1', label: '128K [128..256K]', status: 'free', level: 3, x: 160, y: 160 }
      ],
      treeEdges: [
        { from: '1024_0', to: '512_0' },
        { from: '1024_0', to: '512_1' },
        { from: '512_0', to: '256_0' },
        { from: '512_0', to: '256_1' },
        { from: '512_1', to: '256_2' },
        { from: '512_1', to: '256_3' },
        { from: '256_0', to: '128_0' },
        { from: '256_0', to: '128_1' }
      ],
      motion: {
        type: 'recycle_blocked_coalesce',
        procId: 'p2',
        fromBlock: 'block-256-512',
        busyBuddyBlock: 'block-0-128',
        toList: 'list-row-256',
        buddyText: '回收块 [256..512K] (伙伴被占 ➔ 链接入 256KB 链表)'
      }
    },

    {
      id: 7,
      badge: 'STEP 7 / 7',
      actionTag: '全景稳定状态',
      actionDesc: '各空闲伙伴块已平滑归位各自链表：256K 链表维护两个空闲块，128K 链表维护一个空闲块。',
      banner: {
        icon: '🏁',
        main: '全流程演示完毕：内存占用稳定，伙伴链表维护全部空闲块',
        sub: '256K 链表链接两个空闲块 [256..512K] 与 [768..1024K]，128K 链表链接 [128..256K]',
        badgeText: '稳定状态',
        styleClass: 'bg-stone-50 border-stone-300 text-stone-800',
        badgeClass: 'bg-stone-800 text-white'
      },
      procs: {
        p1: { status: '运行中 (70K/128K)', badgeClass: 'bg-blue-600 text-white font-bold' },
        p2: { status: '已回收释放', badgeClass: 'bg-stone-200 text-stone-700 font-bold' },
        p3: { status: '运行中 (190K/256K)', badgeClass: 'bg-purple-600 text-white font-bold' }
      },
      memoryBlocks: [
        {
          start: 0, size: 128, status: 'allocated',
          proc: { pid: 'P1', reqSize: 70, color: 'p1', fragSize: 58 },
          label: 'P1 (70K / 128K)'
        },
        { start: 128, size: 128, status: 'free', proc: null, label: '128 KB 空闲伙伴' },
        { start: 256, size: 256, status: 'free', proc: null, label: '256 KB 空闲伙伴' },
        {
          start: 512, size: 256, status: 'allocated',
          proc: { pid: 'P3', reqSize: 190, color: 'p3', fragSize: 66 },
          label: 'P3 (190K / 256K)'
        },
        { start: 768, size: 256, status: 'free', proc: null, label: '256 KB 空闲伙伴' }
      ],
      freeLists: {
        1024: [],
        512: [],
        256: [
          { start: 256, size: 256 },
          { start: 768, size: 256 }
        ],
        128: [{ start: 128, size: 128 }],
        64: []
      },
      treeNodes: [
        { id: '1024_0', label: '1024K [0..1024K]', status: 'split', level: 0, x: 380, y: 25 },
        { id: '512_0', label: '512K [0..512K]', status: 'split', level: 1, x: 200, y: 70 },
        { id: '512_1', label: '512K [512..1024K]', status: 'split', level: 1, x: 560, y: 70 },
        { id: '256_0', label: '256K [0..256K]', status: 'split', level: 2, x: 110, y: 115 },
        { id: '256_1', label: '256K [256..512K] (空闲)', status: 'free', level: 2, x: 290, y: 115 },
        { id: '256_2', label: 'P3: 256K (190K实占)', status: 'p3', level: 2, x: 470, y: 115 },
        { id: '256_3', label: '256K [768..1024K]', status: 'free', level: 2, x: 650, y: 115 },
        { id: '128_0', label: 'P1: 128K (70K实占)', status: 'p1', level: 3, x: 60, y: 160 },
        { id: '128_1', label: '128K [128..256K]', status: 'free', level: 3, x: 160, y: 160 }
      ],
      treeEdges: [
        { from: '1024_0', to: '512_0' },
        { from: '1024_0', to: '512_1' },
        { from: '512_0', to: '256_0' },
        { from: '512_0', to: '256_1' },
        { from: '512_1', to: '256_2' },
        { from: '512_1', to: '256_3' },
        { from: '256_0', to: '128_0' },
        { from: '256_0', to: '128_1' }
      ],
      motion: null
    }
  ];

  // 运行控制器
  let currentStepIndex = 0;
  let isPlaying = false;
  let playTimer = null;
  let playSpeed = 1.0;

  // DOM 元素引用
  const dom = {
    memBar: document.getElementById('memory-bar'),
    freeListsContainer: document.getElementById('free-lists-container'),
    buddyTreeSvg: document.getElementById('buddy-tree-svg'),
    stepBadge: document.getElementById('step-badge'),
    currentActionTag: document.getElementById('current-action-tag'),
    actionDesc: document.getElementById('action-desc'),
    splitAlert: document.getElementById('split-alert'),
    splitAlertText: document.getElementById('split-alert-text'),
    splitAlertTag: document.getElementById('split-alert-tag'),
    timelineContainer: document.getElementById('step-timeline-container'),

    // 上方核心决策看板
    decisionBanner: document.getElementById('decision-banner'),
    decisionIcon: document.getElementById('decision-icon'),
    decisionMainText: document.getElementById('decision-main-text'),
    decisionSubText: document.getElementById('decision-sub-text'),
    decisionBadge: document.getElementById('decision-badge'),

    // 进程卡状态
    p1Status: document.getElementById('p1-status'),
    p2Status: document.getElementById('p2-status'),
    p3Status: document.getElementById('p3-status'),
    procCardP1: document.getElementById('proc-card-p1'),
    procCardP2: document.getElementById('proc-card-p2'),
    procCardP3: document.getElementById('proc-card-p3'),

    // 控制按钮
    btnPlay: document.getElementById('btn-play'),
    playIcon: document.getElementById('play-icon'),
    playText: document.getElementById('play-text'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    btnReset: document.getElementById('btn-reset'),

    // 速度按钮
    speed05: document.getElementById('speed-05'),
    speed10: document.getElementById('speed-10'),
    speed15: document.getElementById('speed-15')
  };

  // =========================================================================
  // 核心渲染逻辑 (Render Step)
  // =========================================================================

  function renderStep(index, animate = true) {
    if (index < 0) index = 0;
    if (index >= STEPS.length) index = STEPS.length - 1;
    currentStepIndex = index;

    const step = STEPS[index];

    // 更新标签与指示
    dom.stepBadge.textContent = step.badge;
    dom.currentActionTag.textContent = step.actionTag;
    dom.actionDesc.textContent = step.actionDesc;

    // 更新上方核心决策提示横幅
    if (step.banner) {
      dom.decisionIcon.textContent = step.banner.icon;
      dom.decisionMainText.textContent = step.banner.main;
      dom.decisionSubText.textContent = step.banner.sub;
      dom.decisionBadge.textContent = step.banner.badgeText;
      dom.decisionBanner.className = `mb-3 py-2.5 px-4 rounded-xl border font-mono transition-all flex items-center justify-between shadow-xs ${step.banner.styleClass}`;
      dom.decisionBadge.className = `px-2.5 py-1 rounded-lg text-[11px] font-bold flex-shrink-0 ml-3 ${step.banner.badgeClass}`;

      // 若有 GSAP，横幅轻微弹入
      if (animate && window.gsap) {
        gsap.fromTo(dom.decisionBanner, { y: -4, opacity: 0.8 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out' });
      }
    }

    if (step.splitAlert) {
      dom.splitAlertText.textContent = step.splitAlert.text;
      dom.splitAlertTag.textContent = step.splitAlert.tag;
      dom.splitAlert.classList.remove('opacity-0');
      dom.splitAlert.classList.add('opacity-100');
    } else {
      dom.splitAlert.classList.remove('opacity-100');
      dom.splitAlert.classList.add('opacity-0');
    }

    // 更新左侧进程卡片状态
    updateProcessCards(step.procs);

    // 渲染主存物理条
    renderMemoryBar(step.memoryBlocks);

    // 渲染伙伴树 SVG
    renderBuddyTree(step.treeNodes, step.treeEdges);

    // 渲染空闲双向链表
    renderFreeLists(step.freeLists, animate);

    // 更新时间线节点
    updateTimelineNav(index);

    // 按钮禁用状态
    dom.btnPrev.disabled = (index === 0);
    dom.btnNext.disabled = (index === STEPS.length - 1);

    // 触发平滑位移动画
    if (animate && step.motion) {
      runStepMotion(step.motion);
    }
  }

  // =========================================================================
  // 渲染主存连续条
  // =========================================================================

  function renderMemoryBar(blocks) {
    dom.memBar.innerHTML = '';

    blocks.forEach((block) => {
      const widthPct = (block.size / TOTAL_MEMORY) * 100;
      const blockEl = document.createElement('div');
      blockEl.className = 'mem-block h-full relative flex items-center justify-center border-r border-stone-300 overflow-hidden';
      blockEl.style.width = `${widthPct}%`;
      blockEl.id = `block-${block.start}-${block.start + block.size}`;

      if (block.status === 'allocated' && block.proc) {
        const proc = block.proc;
        let bgClass = 'bg-blue-50';
        let borderClass = 'border-blue-500';
        let badgeBg = 'bg-blue-600 text-white';

        if (proc.color === 'p2') {
          bgClass = 'bg-emerald-50';
          borderClass = 'border-emerald-500';
          badgeBg = 'bg-emerald-600 text-white';
        } else if (proc.color === 'p3') {
          bgClass = 'bg-purple-50';
          borderClass = 'border-purple-500';
          badgeBg = 'bg-purple-600 text-white';
        }

        blockEl.className += ` ${bgClass} border-2 ${borderClass}`;

        const usedPct = (proc.reqSize / block.size) * 100;
        const fragPct = 100 - usedPct;

        let innerContent = `
          <div class="h-full flex w-full relative">
            <div style="width: ${usedPct}%;" class="h-full flex flex-col items-center justify-center p-1 relative z-10">
              <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${badgeBg}">
                ${proc.pid}
              </span>
              <span class="font-mono text-[10.5px] text-stone-800 font-bold mt-0.5 whitespace-nowrap">
                ${proc.reqSize} KB
              </span>
              <span class="font-mono text-[9px] text-stone-500">已占用</span>
            </div>
        `;

        if (fragPct > 0.01) {
          innerContent += `
            <div style="width: ${fragPct}%;" class="h-full pattern-fragment border-l border-dashed border-red-300 flex flex-col items-center justify-center p-1 relative z-10">
              <span class="font-mono text-[9.5px] text-red-600 font-bold whitespace-nowrap">
                内部碎片 ${proc.fragSize}K
              </span>
              <span class="font-mono text-[8.5px] text-red-400 font-semibold">
                (${Math.round(fragPct)}%)
              </span>
            </div>
          `;
        }

        innerContent += `</div>
          <span class="absolute bottom-0.5 left-1 font-mono text-[8.5px] text-stone-400">
            [${block.start}K~${block.start + block.size}K]
          </span>
        `;
        blockEl.innerHTML = innerContent;

      } else if (block.status === 'splitting') {
        blockEl.className += ' bg-amber-50 highlight-split';
        blockEl.innerHTML = `
          <div class="flex flex-col items-center justify-center p-1 text-center">
            <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-600 text-white animate-pulse">
              折半划分中...
            </span>
            <span class="font-mono text-[10px] text-amber-900 font-bold mt-0.5">${block.size} KB</span>
            <span class="font-mono text-[8.5px] text-amber-600">[${block.start}K~${block.start + block.size}K]</span>
          </div>
        `;
      } else if (block.status === 'new_buddy') {
        blockEl.className += ' highlight-buddy';
        blockEl.innerHTML = `
          <div class="flex flex-col items-center justify-center p-1 text-center">
            <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-orange-600 text-white">
              ★ 产生新伙伴块
            </span>
            <span class="font-mono text-[10.5px] text-orange-800 font-bold mt-0.5">
              ${block.size} KB
            </span>
            <span class="font-mono text-[8.5px] text-orange-600">
              [${block.start}K~${block.start + block.size}K]
            </span>
          </div>
        `;
      } else {
        blockEl.className += ' bg-[#FAFAF9]';
        blockEl.innerHTML = `
          <div class="flex flex-col items-center justify-center p-1 text-center">
            <span class="font-mono text-[11px] text-stone-600 font-semibold">
              ${block.size} KB 空闲
            </span>
            <span class="font-mono text-[9px] text-stone-400">
              [${block.start}K ~ ${block.start + block.size}K]
            </span>
          </div>
        `;
      }

      dom.memBar.appendChild(blockEl);
    });
  }

  // =========================================================================
  // 渲染伙伴块空闲双向链表数组 (平滑移动与链接)
  // =========================================================================

  function renderFreeLists(freeLists, animate = false) {
    dom.freeListsContainer.innerHTML = '';

    const listSizes = [1024, 512, 256, 128, 64];

    listSizes.forEach((size) => {
      const blocks = freeLists[size] || [];
      const row = document.createElement('div');
      row.className = 'list-row flex items-center gap-2 p-2 rounded-xl border border-stone-200 bg-[#FAF9F5]';
      row.id = `list-row-${size}`;

      // 链表头
      const headBadge = document.createElement('div');
      headBadge.className = 'w-28 flex-shrink-0 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white border border-stone-300 font-mono text-xs shadow-xs';
      headBadge.innerHTML = `
        <span class="font-bold text-stone-800">${size} KB</span>
        <span class="text-[10px] text-stone-400 font-semibold">2^${Math.log2(size)}</span>
      `;
      row.appendChild(headBadge);

      // 节点链容器
      const nodesContainer = document.createElement('div');
      nodesContainer.className = 'flex-1 flex items-center gap-2 overflow-x-auto py-0.5';

      // Head ➔
      const headArrow = document.createElement('span');
      headArrow.className = 'pointer-arrow font-mono text-stone-400 text-xs flex-shrink-0';
      headArrow.innerHTML = '&rarr;';
      nodesContainer.appendChild(headArrow);

      if (blocks.length === 0) {
        const nullNode = document.createElement('span');
        nullNode.className = 'px-2 py-0.5 rounded text-[10.5px] font-mono text-stone-400 italic bg-stone-100/70 border border-dashed border-stone-200 flex-shrink-0';
        nullNode.textContent = 'NULL (空链)';
        nodesContainer.appendChild(nullNode);
      } else {
        blocks.forEach((node) => {
          const nodeEl = document.createElement('div');
          const isNewClass = node.isNew ? 'node-new bg-orange-50 border-orange-400' : 'bg-white border-stone-300';

          nodeEl.className = `list-node flex-shrink-0 px-2.5 py-1.5 rounded-lg border shadow-xs font-mono text-xs flex items-center gap-2 ${isNewClass}`;
          nodeEl.id = `freenode-${size}-${node.start}`;

          nodeEl.innerHTML = `
            <div class="flex flex-col">
              <span class="font-bold text-stone-800 text-[11px] flex items-center gap-1">
                ${node.isNew ? '<span class="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>' : ''}
                基址: ${node.start} KB
              </span>
              <span class="text-[9.5px] text-stone-500">区间 [${node.start}..${node.start + node.size}K]</span>
            </div>
            <div class="border-l border-stone-200 pl-1.5 flex flex-col text-[8.5px] text-stone-400 leading-tight">
              <span>prev</span>
              <span>next</span>
            </div>
          `;

          nodesContainer.appendChild(nodeEl);

          // 连线箭头
          const nextArrow = document.createElement('span');
          nextArrow.className = 'pointer-arrow font-mono text-stone-400 text-xs flex-shrink-0';
          nextArrow.innerHTML = '&rarr;';
          nodesContainer.appendChild(nextArrow);

          // 新入链节点的平滑滑入动效
          if (animate && node.isNew && window.gsap) {
            gsap.fromTo(nodeEl,
              { opacity: 0, x: -28, scale: 0.85 },
              { opacity: 1, x: 0, scale: 1, duration: 0.65 / playSpeed, ease: 'power2.out' }
            );
          }
        });

        const nullTail = document.createElement('span');
        nullTail.className = 'font-mono text-[10px] text-stone-400 font-semibold flex-shrink-0';
        nullTail.textContent = 'NULL';
        nodesContainer.appendChild(nullTail);
      }

      row.appendChild(nodesContainer);
      dom.freeListsContainer.appendChild(row);
    });
  }

  // =========================================================================
  // 渲染二叉树 SVG
  // =========================================================================

  function renderBuddyTree(nodes, edges) {
    dom.buddyTreeSvg.innerHTML = '';

    edges.forEach((edge) => {
      const fromNode = nodes.find(n => n.id === edge.from);
      const toNode = nodes.find(n => n.id === edge.to);
      if (!fromNode || !toNode) return;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = `M ${fromNode.x} ${fromNode.y + 11} L ${toNode.x} ${toNode.y - 11}`;
      line.setAttribute('d', d);
      line.setAttribute('stroke', '#CBD5E1');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '3 2');
      dom.buddyTreeSvg.appendChild(line);
    });

    nodes.forEach((n) => {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('transform', `translate(${n.x}, ${n.y})`);

      let rectFill = '#FFFFFF';
      let rectStroke = '#94A3B8';
      let textColor = '#1E293B';

      if (n.status === 'split') {
        rectFill = '#F1F5F9';
        rectStroke = '#CBD5E1';
        textColor = '#64748B';
      } else if (n.status === 'p1') {
        rectFill = '#EFF6FF';
        rectStroke = '#3B82F6';
        textColor = '#1D4ED8';
      } else if (n.status === 'p2') {
        rectFill = '#ECFDF5';
        rectStroke = '#10B981';
        textColor = '#047857';
      } else if (n.status === 'p3') {
        rectFill = '#F5F3FF';
        rectStroke = '#8B5CF6';
        textColor = '#6D28D9';
      } else if (n.status === 'free') {
        rectFill = '#FFFFFF';
        rectStroke = '#64748B';
        textColor = '#334155';
      }

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const textWidth = Math.max(90, n.label.length * 7.2);
      rect.setAttribute('x', -textWidth / 2);
      rect.setAttribute('y', -11);
      rect.setAttribute('width', textWidth);
      rect.setAttribute('height', 22);
      rect.setAttribute('rx', '5');
      rect.setAttribute('fill', rectFill);
      rect.setAttribute('stroke', rectStroke);
      rect.setAttribute('stroke-width', '1.2');
      group.appendChild(rect);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dy', '3.5');
      text.setAttribute('font-family', 'JetBrains Mono, monospace');
      text.setAttribute('font-size', '9.5');
      text.setAttribute('font-weight', '600');
      text.setAttribute('fill', textColor);
      text.textContent = n.label;
      group.appendChild(text);

      dom.buddyTreeSvg.appendChild(group);
    });
  }

  // =========================================================================
  // 核心动效引擎：平滑移动与链接动效 (Smooth Motion Engine)
  // =========================================================================

  function runStepMotion(motion) {
    if (!window.gsap || !motion) return;

    const dur = 0.95 / playSpeed;

    // 0. 激光切分线指示 (Laser Divide Animation)
    if (motion.splitLaserPct) {
      const laser = document.createElement('div');
      laser.className = 'split-laser-line';
      laser.style.left = `${motion.splitLaserPct}%`;
      dom.memBar.appendChild(laser);

      gsap.to(laser, {
        opacity: 0,
        duration: 0.8 / playSpeed,
        delay: 0.6 / playSpeed,
        onComplete: () => {
          if (laser.parentNode) laser.parentNode.removeChild(laser);
        }
      });
    }

    // 1. 进程平滑移入主存动画 (Left Card ➔ Memory Block)
    if (motion.fromProc && motion.toBlock) {
      const srcEl = document.getElementById(motion.fromProc);
      const dstEl = document.getElementById(motion.toBlock);

      if (srcEl && dstEl) {
        const srcRect = srcEl.getBoundingClientRect();
        const dstRect = dstEl.getBoundingClientRect();

        let cardBg = '#EFF6FF';
        let cardBorder = '#3B82F6';
        let cardText = '#1D4ED8';
        let procName = 'P1 (70 KB)';

        if (motion.procId === 'p2') {
          cardBg = '#ECFDF5';
          cardBorder = '#10B981';
          cardText = '#047857';
          procName = 'P2 (256 KB 等额)';
        } else if (motion.procId === 'p3') {
          cardBg = '#F5F3FF';
          cardBorder = '#8B5CF6';
          cardText = '#6D28D9';
          procName = 'P3 (190 KB)';
        }

        const flyingCard = document.createElement('div');
        flyingCard.className = 'moving-process-card';
        flyingCard.style.left = `${srcRect.left}px`;
        flyingCard.style.top = `${srcRect.top}px`;
        flyingCard.style.width = `${srcRect.width}px`;
        flyingCard.style.height = `${srcRect.height}px`;
        flyingCard.style.backgroundColor = cardBg;
        flyingCard.style.borderColor = cardBorder;
        flyingCard.style.color = cardText;
        flyingCard.innerHTML = `
          <span class="text-xs font-bold font-mono">✈ 正在移动并占用...</span>
          <span class="text-sm font-extrabold font-mono mt-0.5">${procName}</span>
        `;

        document.body.appendChild(flyingCard);

        gsap.fromTo(dstEl, { opacity: 0.35 }, { opacity: 1, duration: dur, ease: 'power2.out', delay: dur * 0.4 });

        gsap.to(flyingCard, {
          left: dstRect.left,
          top: dstRect.top,
          width: dstRect.width,
          height: dstRect.height,
          scale: 0.98,
          duration: dur,
          ease: 'power2.inOut',
          onComplete: () => {
            if (flyingCard.parentNode) {
              flyingCard.parentNode.removeChild(flyingCard);
            }
            gsap.fromTo(dstEl, { scale: 0.96 }, { scale: 1, duration: 0.35, ease: 'back.out(2)' });
          }
        });
      }
    }

    // 2. 伙伴块平滑移动入链表 (Memory Bar ➔ Free List)
    if (motion.buddyFrom && motion.buddyToList) {
      setTimeout(() => {
        const bSrc = document.getElementById(motion.buddyFrom);
        const bDst = document.getElementById(motion.buddyToList);

        if (bSrc && bDst) {
          const sRect = bSrc.getBoundingClientRect();
          const dRect = bDst.getBoundingClientRect();

          const flyingBuddy = document.createElement('div');
          flyingBuddy.className = 'moving-buddy-block';
          flyingBuddy.style.left = `${sRect.left}px`;
          flyingBuddy.style.top = `${sRect.top}px`;
          flyingBuddy.style.width = `${sRect.width}px`;
          flyingBuddy.style.height = `${sRect.height}px`;
          flyingBuddy.innerHTML = `
            <span class="text-[11px] font-bold">★ 新伙伴块平滑移入链表</span>
            <span class="text-xs font-extrabold mt-0.5">${motion.buddyText}</span>
          `;

          document.body.appendChild(flyingBuddy);

          gsap.to(flyingBuddy, {
            left: dRect.left + 140,
            top: dRect.top + 4,
            width: 170,
            height: 40,
            opacity: 0.95,
            duration: dur,
            ease: 'power2.inOut',
            onComplete: () => {
              if (flyingBuddy.parentNode) {
                flyingBuddy.parentNode.removeChild(flyingBuddy);
              }
              // 高亮链表行，指示新节点链接完成
              bDst.classList.add('bg-orange-50', 'border-orange-300');
              setTimeout(() => {
                bDst.classList.remove('bg-orange-50', 'border-orange-300');
              }, 700);
            }
          });
        }
      }, 300 / playSpeed);
    }

    // 3. STEP 6: P2 回收，检测伙伴块被占用阻断合并，并平滑移动入 256K 链表
    if (motion.type === 'recycle_blocked_coalesce') {
      const busyBuddy = document.getElementById(motion.busyBuddyBlock);
      const freedBlock = document.getElementById(motion.fromBlock);
      const targetList = document.getElementById(motion.toList);

      if (busyBuddy && freedBlock && targetList) {
        busyBuddy.classList.add('highlight-busy-buddy');
        const alertSpan = document.createElement('div');
        alertSpan.className = 'absolute top-1 left-1/2 -translate-x-1/2 z-30 bg-red-600 text-white font-mono text-[9.5px] px-2 py-0.5 rounded shadow-lg font-bold whitespace-nowrap animate-bounce';
        alertSpan.textContent = '⛔ 伙伴块仍被占用中！';
        busyBuddy.appendChild(alertSpan);

        setTimeout(() => {
          busyBuddy.classList.remove('highlight-busy-buddy');
          if (alertSpan.parentNode) alertSpan.parentNode.removeChild(alertSpan);

          const fRect = freedBlock.getBoundingClientRect();
          const tRect = targetList.getBoundingClientRect();

          const ghostRecycle = document.createElement('div');
          ghostRecycle.className = 'moving-buddy-block';
          ghostRecycle.style.left = `${fRect.left}px`;
          ghostRecycle.style.top = `${fRect.top}px`;
          ghostRecycle.style.width = `${fRect.width}px`;
          ghostRecycle.style.height = `${fRect.height}px`;
          ghostRecycle.innerHTML = `
            <span class="text-[10.5px] font-bold">无法合并 ➔ 移入空闲链表</span>
            <span class="text-xs font-extrabold mt-0.5">[256..512K] 256 KB</span>
          `;
          document.body.appendChild(ghostRecycle);

          gsap.to(ghostRecycle, {
            left: tRect.left + 140,
            top: tRect.top + 4,
            width: 175,
            height: 40,
            duration: dur * 1.1,
            ease: 'power2.inOut',
            onComplete: () => {
              if (ghostRecycle.parentNode) {
                ghostRecycle.parentNode.removeChild(ghostRecycle);
              }
              targetList.classList.add('bg-orange-50', 'border-orange-300');
              setTimeout(() => {
                targetList.classList.remove('bg-orange-50', 'border-orange-300');
              }, 700);
            }
          });

        }, 1100 / playSpeed);
      }
    }
  }

  // =========================================================================
  // 更新左侧进程卡状态
  // =========================================================================

  function updateProcessCards(procs) {
    if (!procs) return;

    if (procs.p1) {
      dom.p1Status.textContent = procs.p1.status;
      dom.p1Status.className = `px-2 py-0.5 rounded text-[10px] font-mono ${procs.p1.badgeClass}`;
    }
    if (procs.p2) {
      dom.p2Status.textContent = procs.p2.status;
      dom.p2Status.className = `px-2 py-0.5 rounded text-[10px] font-mono ${procs.p2.badgeClass}`;
    }
    if (procs.p3) {
      dom.p3Status.textContent = procs.p3.status;
      dom.p3Status.className = `px-2 py-0.5 rounded text-[10px] font-mono ${procs.p3.badgeClass}`;
    }
  }

  // =========================================================================
  // 顶部步骤导航条
  // =========================================================================

  function initTimelineNav() {
    dom.timelineContainer.innerHTML = '';

    STEPS.forEach((step, idx) => {
      const btn = document.createElement('button');
      btn.className = `timeline-step whitespace-nowrap`;
      btn.id = `step-btn-${idx}`;
      btn.innerHTML = `<span>${step.badge} ${step.actionTag}</span>`;

      btn.addEventListener('click', () => {
        pause();
        renderStep(idx, true);
      });

      dom.timelineContainer.appendChild(btn);
    });
  }

  function updateTimelineNav(activeIdx) {
    STEPS.forEach((step, idx) => {
      const btn = document.getElementById(`step-btn-${idx}`);
      if (!btn) return;
      btn.classList.remove('active', 'passed');
      if (idx === activeIdx) {
        btn.classList.add('active');
      } else if (idx < activeIdx) {
        btn.classList.add('passed');
      }
    });
  }

  // =========================================================================
  // 控制器：自动演示、单步前进、后退、重置与调速
  // =========================================================================

  function play() {
    if (isPlaying) return;
    isPlaying = true;
    dom.playIcon.textContent = '⏸';
    dom.playText.textContent = '暂停';
    dom.btnPlay.classList.remove('bg-stone-900');
    dom.btnPlay.classList.add('bg-blue-600');

    runPlayLoop();
  }

  function pause() {
    isPlaying = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    dom.playIcon.textContent = '▶';
    dom.playText.textContent = '自动连续演示';
    dom.btnPlay.classList.remove('bg-blue-600');
    dom.btnPlay.classList.add('bg-stone-900');
  }

  function togglePlay() {
    if (isPlaying) {
      pause();
    } else {
      if (currentStepIndex >= STEPS.length - 1) {
        currentStepIndex = 0;
        renderStep(0, false);
      }
      play();
    }
  }

  function runPlayLoop() {
    if (!isPlaying) return;

    if (currentStepIndex < STEPS.length - 1) {
      playTimer = setTimeout(() => {
        currentStepIndex++;
        renderStep(currentStepIndex, true);
        runPlayLoop();
      }, 2700 / playSpeed);
    } else {
      pause();
    }
  }

  function stepNext() {
    pause();
    if (currentStepIndex < STEPS.length - 1) {
      renderStep(currentStepIndex + 1, true);
    }
  }

  function stepPrev() {
    pause();
    if (currentStepIndex > 0) {
      renderStep(currentStepIndex - 1, false);
    }
  }

  function reset() {
    pause();
    renderStep(0, false);
  }

  function setSpeed(speed, activeBtn) {
    playSpeed = speed;
    [dom.speed05, dom.speed10, dom.speed15].forEach(btn => {
      btn.className = 'px-2 py-0.5 rounded border border-stone-200 hover:border-stone-400 text-stone-600';
    });
    activeBtn.className = 'px-2 py-0.5 rounded border border-stone-900 bg-stone-900 text-white font-bold';
  }

  // =========================================================================
  // 事件绑定与装载入口
  // =========================================================================

  function bindEvents() {
    dom.btnPlay.addEventListener('click', togglePlay);
    dom.btnNext.addEventListener('click', stepNext);
    dom.btnPrev.addEventListener('click', stepPrev);
    dom.btnReset.addEventListener('click', reset);

    dom.speed05.addEventListener('click', () => setSpeed(0.5, dom.speed05));
    dom.speed10.addEventListener('click', () => setSpeed(1.0, dom.speed10));
    dom.speed15.addEventListener('click', () => setSpeed(1.5, dom.speed15));
  }

  window.addEventListener('DOMContentLoaded', () => {
    initTimelineNav();
    bindEvents();
    renderStep(0, false);
  });

})();
