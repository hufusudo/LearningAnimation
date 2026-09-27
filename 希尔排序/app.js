/**
 * 希尔排序（Shell Sort）· 交织跳跃抽样机制与稳定性分析 — 核心驱动引擎 (v2 动量重构版)
 * 采用绝对定位连续动量动画（GSAP 60fps 平滑物理滑移）、子序列高亮聚光灯（消除认知负荷）与原子化步骤
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. 全局常量与状态定义
  // =========================================================================
  const INITIAL_ARR = [
    { v: 49, tag: 'a', id: 'elem_49a' },
    { v: 38, tag: null, id: 'elem_38' },
    { v: 65, tag: null, id: 'elem_65' },
    { v: 97, tag: null, id: 'elem_97' },
    { v: 76, tag: null, id: 'elem_76' },
    { v: 13, tag: null, id: 'elem_13' },
    { v: 27, tag: null, id: 'elem_27' },
    { v: 49, tag: 'b', id: 'elem_49b' }
  ];

  const REM_COLORS = ['#00B4D8', '#F77F00', '#2EC4B6', '#7209B7'];
  const REM_NAMES = ['天蓝子表 0', '珊瑚橙子表 1', '薄荷绿子表 2', '紫罗兰子表 3'];

  const State = {
    steps: [],
    idx: 0,
    playing: false,
    timer: null,
    speed: 1.0,
    animating: false
  };

  // =========================================================================
  // 2. 逆序对计算实用函数
  // =========================================================================
  function countInversions(arr) {
    let count = 0;
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (arr[i].v > arr[j].v) {
          count++;
        }
      }
    }
    return count;
  }

  // =========================================================================
  // 3. 步骤时间轴生成器 (Timeline Generator - 原子化细粒度流转)
  // =========================================================================
  function generateSteps() {
    const steps = [];
    const curArr = INITIAL_ARR.map(item => ({ ...item }));

    function addStep(data) {
      // 构造完整 8 元素的逻辑状态数组（空穴处放置 tempItem）
      const logicalArr = curArr.map((item, idx) => {
        if (data.tempItem && data.holeSlot === idx) {
          return data.tempItem;
        }
        return item;
      });
      const invCount = countInversions(logicalArr);
      const prevInv = steps.length > 0 ? steps[steps.length - 1].inversions : invCount;
      const autoDelta = (invCount < prevInv) ? (invCount - prevInv) : null;

      steps.push(Object.assign({
        phaseName: 'Phase 0 · 阵列初始化',
        title: '',
        terminal: '',
        d: 4,
        i: null,
        j: null,
        tempItem: null,    // 当前在 Temp 槽的元素对象
        tempSlot: null,    // 位于哪个 Temp 槽 (0..7)
        holeSlot: null,    // 当前数组中的空穴槽位 (0..7)
        activeSublist: null, // 当前活跃子序列 rem (0, 1, 2, 3) 或 null
        sublistSummary: '',// 子序列提取说明文字
        actionTag: '',     // 动作小胶囊文字
        sortedPrefix: '',  // 子表已排序区
        insertTarget: '',  // 待插入元素
        unsortedSuffix: '',// 待扫描后驱
        opDesc: '',        // 插入排序当前微操作讲解
        arr: curArr.map(x => ({ ...x })),
        inversions: invCount,
        invDelta: autoDelta,
        codeLine: 1,
        hold: 2000,
        activeArcPair: null,
        alertInstability: false,
        compareInfo: null, // { leftVal, rightVal, op, resText }
        motion: null       // { type: 'lift'|'slide'|'drop'|'settle', from, to, elemId }
      }, data));
    }

    // -------------------------------------------------------------------------
    // Phase 0: 初始化与用例装载
    // -------------------------------------------------------------------------
    addStep({
      phaseName: 'Phase 0 · 阵列初始化',
      title: 'Step 0 · 8 元素测试序列装载与逆序对初筛',
      terminal: '装载经典 8 元素测试序列：[49_a, 38, 65, 97, 76, 13, 27, 49_b]。初始逆序对共 15 对。金色 49_a 位于下标 0，银紫 49_b 位于下标 7，初始相对次序正常（间距 7）。',
      d: 4,
      sublistSummary: '全序列就绪：初始状态 15 对逆序对',
      actionTag: '初始化就绪',
      codeLine: 1,
      hold: 2400
    });

    // -------------------------------------------------------------------------
    // Phase 1: 第一趟排序 (d = 4)
    // -------------------------------------------------------------------------
    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.0 · 增量步长锁定 d = 4 与 4 组同余贝塞尔跳线投影',
      terminal: '增量步长锁定 d = 4。全数组逻辑切分为 4 个独立的同余子序列，各自步长跨越 4 格。注意：49_a 在蓝组，49_b 在紫组，已被物理隔离在不同子序列中！',
      d: 4,
      sublistSummary: '逻辑划分 4 个独立子序列：余数 0(蓝), 1(橙), 2(绿), 3(紫)',
      actionTag: '步长锁定 d=4',
      codeLine: 2,
      hold: 2500
    });

    // --- Sublist 0 (rem = 0): 49_a 与 76 ---
    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.1 · 聚焦【天蓝子表 0】：A[4]=76 升入暂存槽',
      terminal: '指针 i = 4：聚焦【天蓝子表 0】（其余元素淡出聚光灯）。卡片 76 抽离升入 Temp 4 暂存槽，slot 4 变为虚线空穴。',
      d: 4,
      i: 4,
      j: 0,
      tempItem: curArr[4],
      tempSlot: 4,
      holeSlot: 4,
      activeSublist: 0,
      activeArcPair: [0, 4],
      sublistSummary: '子序列 0：[ A[0]=49_a, A[4]=76 ] · 抽离 76 准备前向比较',
      actionTag: '抽离升起',
      motion: { type: 'lift', slot: 4, elemId: 'elem_76' },
      codeLine: 4,
      hold: 1800
    });

    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.2 · 跨步对比：A[0](49_a) ≤ 76（递增有序，直接落位）',
      terminal: '指针 j = 0：沿天蓝跳线跨步 4 格对比 A[0]=49_a 与 temp=76。49_a ≤ 76 递增有序，无需位移！卡片 76 垂直落回 slot 4 填平空穴。',
      d: 4,
      i: 4,
      j: 0,
      tempItem: curArr[4],
      tempSlot: 4,
      holeSlot: 4,
      activeSublist: 0,
      activeArcPair: [0, 4],
      sublistSummary: '判定 49_a ≤ 76：无需位移，76 原位归位',
      actionTag: '原位就绪',
      compareInfo: { leftVal: 49, rightVal: 76, op: '≤', resText: '无需位移' },
      motion: { type: 'drop', targetSlot: 4, elemId: 'elem_76' },
      codeLine: 6,
      hold: 1900
    });

    // --- Sublist 1 (rem = 1): 38 与 13 ---
    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.3 · 聚焦【珊瑚橙子表 1】：A[5]=13 升入暂存槽',
      terminal: '指针 i = 5：聚焦【珊瑚橙子表 1】。卡片 13 升入 Temp 5 游离槽，slot 5 原地留出待填空穴。',
      d: 4,
      i: 5,
      j: 1,
      tempItem: curArr[5],
      tempSlot: 5,
      holeSlot: 5,
      activeSublist: 1,
      activeArcPair: [1, 5],
      sublistSummary: '子序列 1：[ A[1]=38, A[5]=13 ] · 抽离 13 准备跨步对比',
      actionTag: '抽离升起',
      motion: { type: 'lift', slot: 5, elemId: 'elem_13' },
      codeLine: 4,
      hold: 1800
    });

    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.4 · 跨步对比：A[1](38) > 13（存在逆序！38 需后移）',
      terminal: '指针 j = 1：沿珊瑚橙跳线对比 A[1]=38 与 temp=13。判定 38 > 13！卡片 38 即将顺着橙线向右滑移 4 格填补 slot 5 空穴。',
      d: 4,
      i: 5,
      j: 1,
      tempItem: curArr[5],
      tempSlot: 5,
      holeSlot: 5,
      activeSublist: 1,
      activeArcPair: [1, 5],
      sublistSummary: '判定 38 > 13：卡片 38 需跨越步长 4 向右滑动填坑',
      actionTag: '逆序判定',
      compareInfo: { leftVal: 38, rightVal: 13, op: '>', resText: '顺弧线右移填坑' },
      codeLine: 6,
      hold: 1800
    });

    // 执行滑动：38 移到 5，空穴变为 1
    const item38 = curArr[1];
    const item13 = curArr[5];
    curArr[5] = item38; // 38 占了 5
    // 此时 slot 1 是空穴
    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.5 · 卡片 38 顺橙色跳线大跨步右移 4 格至 slot 5！',
      terminal: '动效特写：卡片 38 沿橙色弧线大跨步平滑右移 4 格填入 slot 5！此时 slot 1 变为新的待填空穴。指针 j 退步 4 格到 -3 < 0，确定插入位为 slot 1。',
      d: 4,
      i: 5,
      j: 1,
      tempItem: item13,
      tempSlot: 5,
      holeSlot: 1,
      activeSublist: 1,
      activeArcPair: [1, 5],
      sublistSummary: '38 已平移至 slot 5，空穴转移至 slot 1',
      actionTag: '跨步平移填坑',
      motion: { type: 'slide', from: 1, to: 5, elemId: 'elem_38' },
      codeLine: 7,
      hold: 2100
    });

    // 13 插入 slot 1
    curArr[1] = item13;
    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.6 · temp=13 下坠精准落入 slot 1！',
      terminal: '卡片 13 从 Temp 5 槽空中平移并下坠，精准嵌入 slot 1 空穴！珊瑚橙子表排序完成为 [13, 38]。全局逆序对由 15 降至 14。',
      d: 4,
      i: 5,
      j: 1,
      holeSlot: null,
      activeSublist: 1,
      sublistSummary: '子序列 1 排序完成：[ A[1]=13, A[5]=38 ]',
      actionTag: '下坠落位',
      motion: { type: 'drop', targetSlot: 1, elemId: 'elem_13' },
      codeLine: 10,
      hold: 2000
    });

    // --- Sublist 2 (rem = 2): 65 与 27 ---
    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.7 · 聚焦【薄荷绿子表 2】：A[6]=27 升入暂存槽',
      terminal: '指针 i = 6：聚焦【薄荷绿子表 2】。卡片 27 升入 Temp 6 暂存槽，slot 6 原地留出虚线空穴。',
      d: 4,
      i: 6,
      j: 2,
      tempItem: curArr[6],
      tempSlot: 6,
      holeSlot: 6,
      activeSublist: 2,
      activeArcPair: [2, 6],
      sublistSummary: '子序列 2：[ A[2]=65, A[6]=27 ] · 抽离 27 准备跨步对比',
      actionTag: '抽离升起',
      motion: { type: 'lift', slot: 6, elemId: 'elem_27' },
      codeLine: 4,
      hold: 1800
    });

    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.8 · 跨步对比：A[2](65) > 27（存在逆序！65 需后移）',
      terminal: '指针 j = 2：沿薄荷绿跳线对比 A[2]=65 与 temp=27。65 > 27 存在逆序！卡片 65 顺绿线大跨步右移 4 格填补 slot 6 空穴。',
      d: 4,
      i: 6,
      j: 2,
      tempItem: curArr[6],
      tempSlot: 6,
      holeSlot: 6,
      activeSublist: 2,
      activeArcPair: [2, 6],
      sublistSummary: '判定 65 > 27：卡片 65 跨步滑动填坑',
      actionTag: '逆序判定',
      compareInfo: { leftVal: 65, rightVal: 27, op: '>', resText: '顺弧线右移填坑' },
      codeLine: 6,
      hold: 1800
    });

    // 执行滑动：65 移到 6，空穴变为 2
    const item65 = curArr[2];
    const item27 = curArr[6];
    curArr[6] = item65;
    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.9 · 卡片 65 顺绿色跳线大跨步右移 4 格至 slot 6！',
      terminal: '卡片 65 沿薄荷绿弧线平滑右移 4 格填入 slot 6！slot 2 成为新空穴。指针 j 退步 4 格到 -2 < 0，确定插入 slot 2。',
      d: 4,
      i: 6,
      j: 2,
      tempItem: item27,
      tempSlot: 6,
      holeSlot: 2,
      activeSublist: 2,
      activeArcPair: [2, 6],
      sublistSummary: '65 已平移至 slot 6，空穴转移至 slot 2',
      actionTag: '跨步平移填坑',
      motion: { type: 'slide', from: 2, to: 6, elemId: 'elem_65' },
      codeLine: 7,
      hold: 2100
    });

    // 27 插入 slot 2
    curArr[2] = item27;
    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.10 · temp=27 下坠精准落入 slot 2【逆序对大减】',
      terminal: '卡片 27 从 Temp 6 平移并下坠落入 slot 2！薄荷绿子表排序完成为 [27, 65]。单次跨步消除了 (65, 27) 及多个跨区间逆序，全局逆序对由 14 降至 11（消减 3 对）！',
      d: 4,
      i: 6,
      j: 2,
      holeSlot: null,
      activeSublist: 2,
      sublistSummary: '子序列 2 排序完成：[ A[2]=27, A[6]=65 ]',
      actionTag: '下坠落位',
      motion: { type: 'drop', targetSlot: 2, elemId: 'elem_27' },
      codeLine: 10,
      hold: 2000
    });

    // --- Sublist 3 (rem = 3): 97 与 49_b ---
    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.11 · 聚焦【紫罗兰子表 3】：相同键值 49_b 升入暂存槽',
      terminal: '指针 i = 7：聚焦【紫罗兰子表 3】。关键元素 49_b（银紫徽章）垂直升入 Temp 7 暂存槽，slot 7 成为空穴。注意：49_a 仍在槽 0！',
      d: 4,
      i: 7,
      j: 3,
      tempItem: curArr[7],
      tempSlot: 7,
      holeSlot: 7,
      activeSublist: 3,
      activeArcPair: [3, 7],
      sublistSummary: '子序列 3：[ A[3]=97, A[7]=49_b ] · 抽离 49_b',
      actionTag: '抽离升起',
      motion: { type: 'lift', slot: 7, elemId: 'elem_49b' },
      codeLine: 4,
      hold: 1900
    });

    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.12 · 跨步对比：A[3](97) > 49_b（97 需跨步后移）',
      terminal: '指针 j = 3：沿紫线对比 A[3]=97 与 temp=49_b。判定 97 > 49_b！卡片 97 即将大跨步后移 4 格填补 slot 7 空穴。',
      d: 4,
      i: 7,
      j: 3,
      tempItem: curArr[7],
      tempSlot: 7,
      holeSlot: 7,
      activeSublist: 3,
      activeArcPair: [3, 7],
      sublistSummary: '判定 97 > 49_b：卡片 97 跨步右移',
      actionTag: '逆序判定',
      compareInfo: { leftVal: 97, rightVal: 49, op: '>', resText: '顺弧线右移填坑' },
      codeLine: 6,
      hold: 1800
    });

    // 97 滑入 7，空穴变为 3
    const item97 = curArr[3];
    const item49b = curArr[7];
    curArr[7] = item97;
    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.13 · 卡片 97 顺紫色跳线大跨步右移 4 格至 slot 7！',
      terminal: '卡片 97 平滑右移 4 格填入 slot 7！slot 3 成为新空穴。指针 j 退步 4 格到 -1 < 0，确定插入 slot 3。',
      d: 4,
      i: 7,
      j: 3,
      tempItem: item49b,
      tempSlot: 7,
      holeSlot: 3,
      activeSublist: 3,
      activeArcPair: [3, 7],
      sublistSummary: '97 已平移至 slot 7，空穴转移至 slot 3',
      actionTag: '跨步平移填坑',
      motion: { type: 'slide', from: 3, to: 7, elemId: 'elem_97' },
      codeLine: 7,
      hold: 2100
    });

    // 49_b 插入 slot 3
    curArr[3] = item49b;
    addStep({
      phaseName: 'Phase 1 · 第一趟 (d = 4)',
      title: 'Step 1.14 · 49_b 下坠嵌入 slot 3【逆序对悬崖暴跌】！',
      terminal: '卡片 49_b 从 Temp 7 槽平移并下坠嵌入 slot 3！全局逆序对由 11 悬崖式暴跌至 6（单步直接消除 5 个跨区间逆序）！第一趟所有子表完成。',
      d: 4,
      i: 7,
      j: 3,
      holeSlot: null,
      activeSublist: 3,
      sublistSummary: '子序列 3 排序完成：[ A[3]=49_b, A[7]=97 ]',
      actionTag: '下坠落位',
      motion: { type: 'drop', targetSlot: 3, elemId: 'elem_49b' },
      codeLine: 10,
      hold: 2200
    });

    // Phase 1 结语与不稳定性首现特写
    addStep({
      phaseName: 'Phase 1 结语 · 不稳定性首现',
      title: 'Step 1.15 · 【408 核心考点特写：跨步长破坏相对次序预警】',
      terminal: '【考点爆发特写】第一趟结束序列为 [49_a, 13, 27, 49_b, 76, 38, 65, 97]，逆序对从 15 骤降至 6（暴跌 60%）！镜头聚焦 49_a（仍在槽 0）与 49_b（被拉到槽 3）：原本在末尾的 49_b 因紫色子表内部跳跃被强行拉至槽位 3，相同元素的绝对间距由 7 剧烈压缩为 3，不同子序列的孤立操作彻底摧毁了维持稳定性的环境！',
      d: 4,
      alertInstability: true,
      sublistSummary: '第一趟完成：序列初具局部有序，但 49_a 与 49_b 相对次序受损！',
      actionTag: '稳定性预警',
      codeLine: 2,
      hold: 3400
    });

    // -------------------------------------------------------------------------
    // Phase 2: 第二趟排序 (d = 2) —— 子表合并与基本有序
    // -------------------------------------------------------------------------
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.0 · 步长收敛 d = 2 与偶奇双子表贝塞尔重构',
      terminal: '步长递减收敛为 d = 2。原有 4 组弧线收敛，重新拉起 2 组宽幅贝塞尔跳线：偶数子表（蓝线：0, 2, 4, 6）与奇数子表（橙线：1, 3, 5, 7）。当前逆序对仅存 6 对，已初具局部有序雏形。',
      d: 2,
      sublistSummary: '子序列合并为 2 组：偶数表 [49_a, 27, 76, 65] 与 奇数表 [13, 49_b, 38, 97]',
      actionTag: '步长减半 d=2',
      codeLine: 2,
      hold: 2400
    });

    // --- Even Sublist: i = 2 (27 与 49_a) ---
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.1 · 聚焦【偶数子表】：A[2]=27 升入暂存槽',
      terminal: '指针 i = 2：聚焦偶数子表。卡片 27 升入 Temp 2，slot 2 成为空穴。比较指针 j = 0 指向 A[0]=49_a。',
      d: 2,
      i: 2,
      j: 0,
      tempItem: curArr[2],
      tempSlot: 2,
      holeSlot: 2,
      activeSublist: 0,
      activeArcPair: [0, 2],
      sublistSummary: '偶数子表：将 27 插入到 [49_a] 中',
      actionTag: '抽离升起',
      motion: { type: 'lift', slot: 2, elemId: 'elem_27' },
      codeLine: 4,
      hold: 1800
    });

    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.2 · 跨步对比：A[0](49_a) > 27（49_a 需后移）',
      terminal: '指针 j = 0：沿蓝线对比 A[0]=49_a 与 temp=27。49_a > 27！卡片 49_a 顺蓝线平滑右移 2 格填补 slot 2 空穴。',
      d: 2,
      i: 2,
      j: 0,
      tempItem: curArr[2],
      tempSlot: 2,
      holeSlot: 2,
      activeSublist: 0,
      activeArcPair: [0, 2],
      sublistSummary: '判定 49_a > 27：49_a 顺蓝线右移 2 格',
      actionTag: '逆序判定',
      compareInfo: { leftVal: 49, rightVal: 27, op: '>', resText: '49_a 顺弧线右移' },
      codeLine: 6,
      hold: 1800
    });

    // 49_a 滑入 2，空穴变为 0
    const item49a = curArr[0];
    const item27_cur = curArr[2];
    curArr[2] = item49a;
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.3 · 49_a 顺蓝线大跨步右移至 slot 2！',
      terminal: '卡片 49_a 平滑右滑 2 格填入 slot 2！金色 49_a 发生物理位移！slot 0 变为新空穴。指针 j 退步到 -2 < 0，确定插入 slot 0。',
      d: 2,
      i: 2,
      j: 0,
      tempItem: item27_cur,
      tempSlot: 2,
      holeSlot: 0,
      activeSublist: 0,
      activeArcPair: [0, 2],
      sublistSummary: '49_a 已后移至 slot 2，空穴转移至 slot 0',
      actionTag: '跨步平移填坑',
      motion: { type: 'slide', from: 0, to: 2, elemId: 'elem_49a' },
      codeLine: 7,
      hold: 2000
    });

    // 27 插入 0
    curArr[0] = item27_cur;
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.4 · 27 下坠落入 slot 0！偶数前驱有序',
      terminal: '卡片 27 嵌入 slot 0。偶数子表前两项达到有序：[27, 49_a]。全局逆序对由 6 降至 5。',
      d: 2,
      i: 2,
      j: 0,
      holeSlot: null,
      activeSublist: 0,
      sublistSummary: '偶数表前驱有序：[ A[0]=27, A[2]=49_a ]',
      actionTag: '下坠落位',
      motion: { type: 'drop', targetSlot: 0, elemId: 'elem_27' },
      codeLine: 10,
      hold: 1900
    });

    // --- Odd Sublist: i = 3 (49_b 与 13) ---
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.5 · 聚焦【奇数子表】：A[3]=49_b 对比 A[1]=13（递增就位）',
      terminal: '指针 i = 3：聚焦奇数子表。A[3]=49_b 与 A[1]=13 跨步比较：13 ≤ 49_b，递增有序无需位移！49_b 稳居 slot 3。',
      d: 2,
      i: 3,
      j: 1,
      tempItem: curArr[3],
      tempSlot: 3,
      activeSublist: 1,
      activeArcPair: [1, 3],
      sublistSummary: '奇数表判定：13 ≤ 49_b，递增有序无需位移',
      actionTag: '原位就绪',
      compareInfo: { leftVal: 13, rightVal: 49, op: '≤', resText: '无需位移' },
      codeLine: 6,
      hold: 1800
    });

    // --- Even Sublist: i = 4 (76 与 49_a) ---
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.6 · 聚焦【偶数子表】：A[4]=76 对比 A[2]=49_a（递增就位）',
      terminal: '指针 i = 4：聚焦偶数子表。A[4]=76 与 A[2]=49_a 跨步比较：49_a ≤ 76，递增有序无需位移！76 稳居 slot 4。',
      d: 2,
      i: 4,
      j: 2,
      tempItem: curArr[4],
      tempSlot: 4,
      activeSublist: 0,
      activeArcPair: [2, 4],
      sublistSummary: '偶数表判定：49_a ≤ 76，递增有序无需位移',
      actionTag: '原位就绪',
      compareInfo: { leftVal: 49, rightVal: 76, op: '≤', resText: '无需位移' },
      codeLine: 6,
      hold: 1800
    });

    // --- Odd Sublist: i = 5 (38 插入 13, 49_b) ---
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.7 · 聚焦【奇数子表】：A[5]=38 升入暂存槽',
      terminal: '指针 i = 5：聚焦奇数子表。卡片 38 升入 Temp 5，slot 5 成为空穴。比较指针 j = 3 锁定 A[3]=49_b。',
      d: 2,
      i: 5,
      j: 3,
      tempItem: curArr[5],
      tempSlot: 5,
      holeSlot: 5,
      activeSublist: 1,
      activeArcPair: [3, 5],
      sublistSummary: '奇数表：将 38 插入到有序前驱 [13, 49_b] 中',
      actionTag: '抽离升起',
      motion: { type: 'lift', slot: 5, elemId: 'elem_38' },
      codeLine: 4,
      hold: 1800
    });

    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.8 · 跨步对比：A[3](49_b) > 38（49_b 需后移）',
      terminal: '指针 j = 3：沿橙线对比 A[3]=49_b 与 temp=38。49_b > 38！卡片 49_b 顺橙线平滑右移 2 格填补 slot 5 空穴。',
      d: 2,
      i: 5,
      j: 3,
      tempItem: curArr[5],
      tempSlot: 5,
      holeSlot: 5,
      activeSublist: 1,
      activeArcPair: [3, 5],
      sublistSummary: '判定 49_b > 38：49_b 顺橙线右移 2 格',
      actionTag: '逆序判定',
      compareInfo: { leftVal: 49, rightVal: 38, op: '>', resText: '49_b 顺弧线右移' },
      codeLine: 6,
      hold: 1800
    });

    // 49_b 滑入 5，空穴变为 3
    const item49b_cur = curArr[3];
    const item38_cur = curArr[5];
    curArr[5] = item49b_cur;
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.9 · 49_b 顺橙线右移至 slot 5，再与 A[1]=13 对比！',
      terminal: '卡片 49_b 平滑右移至 slot 5！slot 3 成为新空穴。指针 j 退步 2 格到 1 指向 A[1]=13。对比 13 与 38：13 ≤ 38 递增，终止内循环！确定插入位为 slot 3。',
      d: 2,
      i: 5,
      j: 1,
      tempItem: item38_cur,
      tempSlot: 5,
      holeSlot: 3,
      activeSublist: 1,
      activeArcPair: [1, 3],
      sublistSummary: '49_b 已后移至 slot 5；对比 13 ≤ 38 终止循环',
      actionTag: '跨步平移填坑',
      compareInfo: { leftVal: 13, rightVal: 38, op: '≤', resText: '直接 break' },
      motion: { type: 'slide', from: 3, to: 5, elemId: 'elem_49b' },
      codeLine: 7,
      hold: 2100
    });

    // 38 插入 3
    curArr[3] = item38_cur;
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.10 · 38 下坠落入 slot 3！奇数前驱有序',
      terminal: '卡片 38 嵌入 slot 3。奇数子表前三项有序：[13, 38, 49_b]。全局逆序对由 5 降至 4。',
      d: 2,
      i: 5,
      j: 1,
      holeSlot: null,
      activeSublist: 1,
      sublistSummary: '奇数表前驱有序：[ A[1]=13, A[3]=38, A[5]=49_b ]',
      actionTag: '下坠落位',
      motion: { type: 'drop', targetSlot: 3, elemId: 'elem_38' },
      codeLine: 10,
      hold: 1900
    });

    // --- Even Sublist: i = 6 (65 插入 27, 49_a, 76) ---
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.11 · 聚焦【偶数子表】：A[6]=65 升入暂存槽',
      terminal: '指针 i = 6：聚焦偶数子表。卡片 65 升入 Temp 6，slot 6 成为空穴。比较指针 j = 4 锁定 A[4]=76。',
      d: 2,
      i: 6,
      j: 4,
      tempItem: curArr[6],
      tempSlot: 6,
      holeSlot: 6,
      activeSublist: 0,
      activeArcPair: [4, 6],
      sublistSummary: '偶数表：将 65 插入到有序前驱 [27, 49_a, 76] 中',
      actionTag: '抽离升起',
      motion: { type: 'lift', slot: 6, elemId: 'elem_65' },
      codeLine: 4,
      hold: 1800
    });

    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.12 · 跨步对比：A[4](76) > 65（76 需后移）',
      terminal: '指针 j = 4：沿蓝线对比 A[4]=76 与 temp=65。76 > 65！卡片 76 顺蓝线平滑右移 2 格填补 slot 6 空穴。',
      d: 2,
      i: 6,
      j: 4,
      tempItem: curArr[6],
      tempSlot: 6,
      holeSlot: 6,
      activeSublist: 0,
      activeArcPair: [4, 6],
      sublistSummary: '判定 76 > 65：76 顺蓝线右移 2 格',
      actionTag: '逆序判定',
      compareInfo: { leftVal: 76, rightVal: 65, op: '>', resText: '76 顺弧线右移' },
      codeLine: 6,
      hold: 1800
    });

    // 76 滑入 6，空穴变为 4
    const item76_cur = curArr[4];
    const item65_cur = curArr[6];
    curArr[6] = item76_cur;
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.13 · 76 顺蓝线右移至 slot 6，再与 A[2]=49_a 对比！',
      terminal: '卡片 76 平滑右移至 slot 6！slot 4 成为新空穴。指针 j 退步 2 格到 2 指向 A[2]=49_a。对比 49_a 与 65：49_a ≤ 65 递增，终止循环！确定插入位为 slot 4。',
      d: 2,
      i: 6,
      j: 2,
      tempItem: item65_cur,
      tempSlot: 6,
      holeSlot: 4,
      activeSublist: 0,
      activeArcPair: [2, 4],
      sublistSummary: '76 已后移至 slot 6；对比 49_a ≤ 65 终止循环',
      actionTag: '跨步平移填坑',
      compareInfo: { leftVal: 49, rightVal: 65, op: '≤', resText: '直接 break' },
      motion: { type: 'slide', from: 4, to: 6, elemId: 'elem_76' },
      codeLine: 7,
      hold: 2100
    });

    // 65 插入 4
    curArr[4] = item65_cur;
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.14 · 65 下坠落入 slot 4！偶数表全量有序',
      terminal: '卡片 65 嵌入 slot 4。偶数子表全量有序：[27, 49_a, 65, 76]！全局逆序对由 4 降至 3。',
      d: 2,
      i: 6,
      j: 2,
      holeSlot: null,
      activeSublist: 0,
      sublistSummary: '偶数表全量有序：[ A[0]=27, A[2]=49_a, A[4]=65, A[6]=76 ]',
      actionTag: '下坠落位',
      motion: { type: 'drop', targetSlot: 4, elemId: 'elem_65' },
      codeLine: 10,
      hold: 1900
    });

    // --- Odd Sublist: i = 7 (97 与 49_b) ---
    addStep({
      phaseName: 'Phase 2 · 第二趟 (d = 2)',
      title: 'Step 2.15 · 聚焦【奇数子表】：A[7]=97 对比 A[5]=49_b（递增就位）',
      terminal: '指针 i = 7：聚焦奇数子表。A[7]=97 与 A[5]=49_b 对比：49_b ≤ 97，递增有序无需位移！第二趟全量结束。',
      d: 2,
      i: 7,
      j: 5,
      tempItem: curArr[7],
      tempSlot: 7,
      activeSublist: 1,
      activeArcPair: [5, 7],
      sublistSummary: '奇数表全量有序：[ A[1]=13, A[3]=38, A[5]=49_b, A[7]=97 ]',
      actionTag: '原位就绪',
      compareInfo: { leftVal: 49, rightVal: 97, op: '≤', resText: '无需位移' },
      codeLine: 6,
      hold: 1800
    });

    // Phase 2 结语
    addStep({
      phaseName: 'Phase 2 结语 · 基本有序达成',
      title: 'Step 2.16 · 宏观粗排收敛，逆序对仅存 3 对（基本有序！）',
      terminal: '第二趟结束：当前阵列更新为 [27, 13, 49_a, 38, 65, 49_b, 76, 97]。全局逆序对仅存 3 对（(27,13), (49_a,38), (65,49_b)）。阵列震荡波幅大幅收缩，已进入极高程度的“基本有序”状态！',
      d: 2,
      sublistSummary: '全序列基本有序：仅存 3 对近邻逆序！为最后一趟微调扫清障碍',
      actionTag: '基本有序',
      codeLine: 2,
      hold: 2600
    });

    // -------------------------------------------------------------------------
    // Phase 3: 第三趟排序 (d = 1) —— 经典插入与微动极速收敛
    // -------------------------------------------------------------------------
    addStep({
      phaseName: 'Phase 3 · 第三趟 (d = 1)',
      title: 'Step 3.0 · 增量触底 d = 1（退化为直接插入排序）',
      terminal: '增量步长触底 d = 1，顶部控制台变红脉冲闪烁！彩色跳线全部消失，退化为经典相邻扫描。但由于前两趟的宏观粗排，待排数组已“基本有序”，直接插入排序将以极少移动次数飞速完成。',
      d: 1,
      sublistSummary: '增量触底 d = 1：全序列直接插入排序（仅需微调极少数近邻元素）',
      actionTag: '触底 d=1',
      codeLine: 2,
      hold: 2400
    });

    // i = 1: 13 越过 27
    addStep({
      phaseName: 'Phase 3 · 第三趟 (d = 1)',
      title: 'Step 3.1 · i = 1：A[1]=13 升起，对比 A[0]=27（需微调 1 位）',
      terminal: 'i = 1：抽离 13 进入 Temp 1。对比 A[0]=27 与 13：27 > 13！卡片 27 顺次右移 1 格，13 嵌入 slot 0。逆序对降至 2。',
      d: 1,
      i: 1,
      j: 0,
      tempItem: curArr[1],
      tempSlot: 1,
      holeSlot: 1,
      activeSublist: 0,
      sublistSummary: '微调近邻：27 > 13，27 右移 1 位，13 嵌入 slot 0',
      actionTag: '近邻微调',
      compareInfo: { leftVal: 27, rightVal: 13, op: '>', resText: '27 右移' },
      codeLine: 6,
      hold: 1800
    });

    const it27 = curArr[0];
    const it13 = curArr[1];
    curArr[0] = it13;
    curArr[1] = it27;

    addStep({
      phaseName: 'Phase 3 · 第三趟 (d = 1)',
      title: 'Step 3.2 · 27 移至 slot 1，13 嵌入 slot 0',
      terminal: '27 右移 1 位，13 落入 slot 0！序列变为 [13, 27, 49_a, 38, 65, 49_b, 76, 97]。',
      d: 1,
      i: 1,
      j: 0,
      holeSlot: null,
      activeSublist: 0,
      sublistSummary: '13 已归位至首位：[13, 27]',
      actionTag: '下坠就绪',
      motion: { type: 'slide', from: 0, to: 1, elemId: 'elem_27' },
      codeLine: 10,
      hold: 1800
    });

    // i = 2: 49_a 与 27 (无需移动)
    addStep({
      phaseName: 'Phase 3 · 第三趟 (d = 1)',
      title: 'Step 3.3 · i = 2：A[2]=49_a 与 A[1]=27 判定（零位移直接 break）',
      terminal: 'i = 2：A[2]=49_a 与前驱 A[1]=27 对比。27 ≤ 49_a，直接 break！零位移完成。',
      d: 1,
      i: 2,
      j: 1,
      tempItem: curArr[2],
      tempSlot: 2,
      activeSublist: 0,
      sublistSummary: '27 ≤ 49_a：直接 break，零位移',
      actionTag: '直接 break',
      compareInfo: { leftVal: 27, rightVal: 49, op: '≤', resText: '直接 break' },
      codeLine: 6,
      hold: 1500
    });

    // i = 3: 38 越过 49_a，停在 27 后面
    addStep({
      phaseName: 'Phase 3 · 第三趟 (d = 1)',
      title: 'Step 3.4 · i = 3：A[3]=38 升起，越过 49_a 嵌入 slot 2',
      terminal: 'i = 3：抽离 38。对比 A[2]=49_a 与 38：49_a > 38，49_a 右移到 slot 3；再与 A[1]=27 比：27 ≤ 38 直接 break。38 嵌入 slot 2！逆序对降至 1。',
      d: 1,
      i: 3,
      j: 2,
      tempItem: curArr[3],
      tempSlot: 3,
      holeSlot: 3,
      activeSublist: 0,
      sublistSummary: '微调近邻：49_a 右移至 slot 3，38 嵌入 slot 2',
      actionTag: '微调填坑',
      compareInfo: { leftVal: 49, rightVal: 38, op: '>', resText: '49_a 右移' },
      codeLine: 6,
      hold: 1800
    });

    const it49a = curArr[2];
    const it38 = curArr[3];
    curArr[2] = it38;
    curArr[3] = it49a;

    addStep({
      phaseName: 'Phase 3 · 第三趟 (d = 1)',
      title: 'Step 3.5 · 49_a 移至 slot 3，38 嵌入 slot 2',
      terminal: '49_a 移至 slot 3，38 嵌入 slot 2！当前序列：[13, 27, 38, 49_a, 65, 49_b, 76, 97]。逆序对仅存 1 对 (65, 49_b)。',
      d: 1,
      i: 3,
      j: 2,
      holeSlot: null,
      activeSublist: 0,
      sublistSummary: '前四项有序：[13, 27, 38, 49_a]',
      actionTag: '下坠就绪',
      motion: { type: 'slide', from: 2, to: 3, elemId: 'elem_49a' },
      codeLine: 10,
      hold: 1800
    });

    // i = 4: 65 与 49_a (无需移动)
    addStep({
      phaseName: 'Phase 3 · 第三趟 (d = 1)',
      title: 'Step 3.6 · i = 4：A[4]=65 与 A[3]=49_a 判定（零位移直接 break）',
      terminal: 'i = 4：A[4]=65 与前驱 49_a 对比。49_a ≤ 65，直接 break！零位移完成。',
      d: 1,
      i: 4,
      j: 3,
      tempItem: curArr[4],
      tempSlot: 4,
      activeSublist: 0,
      sublistSummary: '49_a ≤ 65：直接 break，零位移',
      actionTag: '直接 break',
      compareInfo: { leftVal: 49, rightVal: 65, op: '≤', resText: '直接 break' },
      codeLine: 6,
      hold: 1500
    });

    // i = 5: 49_b 越过 65，停在 49_a 后面
    addStep({
      phaseName: 'Phase 3 · 第三趟 (d = 1)',
      title: 'Step 3.7 · i = 5：A[5]=49_b 升起，越过 65 嵌入 slot 4（最后一对逆序消除）',
      terminal: 'i = 5：抽离 49_b。对比 A[4]=65 与 49_b：65 > 49_b，65 右移到 slot 5；继续与 A[3]=49_a 比：49_a ≤ 49_b 直接 break！49_b 嵌入 slot 4。全局逆序对彻底清零！',
      d: 1,
      i: 5,
      j: 4,
      tempItem: curArr[5],
      tempSlot: 5,
      holeSlot: 5,
      activeSublist: 0,
      sublistSummary: '最后一对逆序消除：65 右移至 slot 5，49_b 嵌入 slot 4',
      actionTag: '清零微调',
      compareInfo: { leftVal: 65, rightVal: 49, op: '>', resText: '65 右移' },
      codeLine: 6,
      hold: 1900
    });

    const it65 = curArr[4];
    const it49b_final = curArr[5];
    curArr[4] = it49b_final;
    curArr[5] = it65;

    addStep({
      phaseName: 'Phase 3 · 第三趟 (d = 1)',
      title: 'Step 3.8 · 65 移至 slot 5，49_b 嵌入 slot 4【逆序对彻底归零】！',
      terminal: '65 移至 slot 5，49_b 嵌入 slot 4！当前序列：[13, 27, 38, 49_a, 49_b, 65, 76, 97]。全局逆序对降为 0！',
      d: 1,
      i: 5,
      j: 4,
      holeSlot: null,
      activeSublist: 0,
      sublistSummary: '全局逆序对彻底清零！',
      actionTag: '逆序归零',
      motion: { type: 'slide', from: 4, to: 5, elemId: 'elem_65' },
      codeLine: 10,
      hold: 1900
    });

    // i = 6, 7: 76 与 97 高速掠过
    addStep({
      phaseName: 'Phase 3 · 第三趟 (d = 1)',
      title: 'Step 3.9 · i = 6, 7：76 与 97 高速掠过（全量 break）',
      terminal: 'i = 6 与 i = 7：元素 76 与 97 均严格大于前驱，直接 break 零位移！全算法结束。',
      d: 1,
      i: 7,
      j: 6,
      tempItem: curArr[7],
      tempSlot: 7,
      activeSublist: 0,
      sublistSummary: '76 与 97 均满足递增：直接 break 零位移',
      actionTag: '全量 break',
      codeLine: 12,
      hold: 1600
    });

    // Phase 3 终局定格
    addStep({
      phaseName: 'Phase 3 终局 · 算法定格',
      title: 'Step 3.10 · 全局完全有序达成 · 考点终极总结',
      terminal: '最终有序序列：[13, 27, 38, 49_a, 49_b, 65, 76, 97]。逆序对为 0！由于前两趟大跨度移动消除了绝大多数逆序对，第 3 趟直接插入排序几乎全为 O(1) 的即时 break，总体耗时远优于 O(n²)。同时证实：跨步子序列独立乱跳是破坏算法稳定性的本质原因！',
      d: 1,
      codeLine: 13,
      alertInstability: true,
      sublistSummary: '最终有序达成：比较移动次数远小于 O(n²)，稳定性被破坏',
      actionTag: '算法定格',
      hold: 3500
    });

    return steps;
  }

  // =========================================================================
  // 4. 槽位坐标计算与 DOM 初始化 (Physical Slot Coordinates)
  // =========================================================================
  function getSlotCoord(slotIdx, isTemp = false) {
    const container = document.getElementById('stage-container');
    const slotEl = isTemp
      ? document.querySelector(`.temp-slot[data-slot="${slotIdx}"]`)
      : document.getElementById(`phys-slot-${slotIdx}`);
    if (!container || !slotEl) return { x: 0, y: 0, width: 80, height: 74 };

    const cRect = container.getBoundingClientRect();
    const sRect = slotEl.getBoundingClientRect();

    return {
      x: sRect.left - cRect.left,
      y: sRect.top - cRect.top,
      width: sRect.width,
      height: sRect.height
    };
  }

  function initStageDOM() {
    // 1. 初始化 8 个固定底座
    const slotRow = document.getElementById('array-slot-row');
    slotRow.innerHTML = '';
    for (let idx = 0; idx < 8; idx++) {
      const physSlot = document.createElement('div');
      physSlot.className = 'phys-slot';
      physSlot.id = `phys-slot-${idx}`;
      physSlot.dataset.idx = idx;

      // 槽位下标标签
      const idxLbl = document.createElement('span');
      idxLbl.className = 'slot-idx';
      idxLbl.innerText = `A[${idx}]`;
      physSlot.appendChild(idxLbl);

      slotRow.appendChild(physSlot);
    }

    // 2. 初始化实体卡片到 #card-layer
    const cardLayer = document.getElementById('card-layer');
    cardLayer.innerHTML = '';
    INITIAL_ARR.forEach(item => {
      const card = createCardElement(item);
      card.id = item.id;
      cardLayer.appendChild(card);
    });

    // 3. 初始化 Sparkline
    renderSparkline();
  }

  function createCardElement(item) {
    const card = document.createElement('div');
    card.className = 'elem-card';

    // 数值显示
    const valEl = document.createElement('div');
    valEl.className = 'elem-value';
    valEl.innerText = item.v;
    card.appendChild(valEl);

    // 相同键值身份标签
    if (item.tag === 'a') {
      const tag = document.createElement('span');
      tag.className = 'tag-badge-49a';
      tag.innerText = '49a';
      card.appendChild(tag);
    } else if (item.tag === 'b') {
      const tag = document.createElement('span');
      tag.className = 'tag-badge-49b';
      tag.innerText = '49b';
      card.appendChild(tag);
    }

    // 余数微徽章
    const remBadge = document.createElement('span');
    remBadge.className = 'elem-rem-badge';
    remBadge.id = `${item.id}-rem-badge`;
    remBadge.style.display = 'none';
    card.appendChild(remBadge);

    // 子表直接插入排序角色微角标 (已序前驱 / 待插入 / 待扫描)
    const roleBadge = document.createElement('span');
    roleBadge.className = 'sublist-role-badge';
    roleBadge.id = `${item.id}-role-badge`;
    roleBadge.style.display = 'none';
    card.appendChild(roleBadge);

    return card;
  }

  function renderSparkline() {
    const container = document.getElementById('inv-sparkline');
    if (!container) return;
    container.innerHTML = '';
    const totalSteps = State.steps.length;
    for (let s = 0; s < totalSteps; s++) {
      const bar = document.createElement('div');
      bar.className = 'spark-bar';
      bar.id = `spark-bar-${s}`;
      const inv = State.steps[s].inversions;
      const h = Math.max(3, Math.round((inv / 15) * 18));
      bar.style.height = `${h}px`;
      container.appendChild(bar);
    }
  }

  // =========================================================================
  // 5. SVG 贝塞尔跳线绘制 (Bézier Arcs)
  // =========================================================================
  function renderBezierArcs(d, activePair = null) {
    const group = document.getElementById('bezier-paths-group');
    if (!group) return;
    group.innerHTML = '';

    if (d <= 1) return; // d = 1 时隐藏跳线

    const container = document.getElementById('stage-container');
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    const centers = [];
    for (let i = 0; i < 8; i++) {
      const slotEl = document.getElementById(`phys-slot-${i}`);
      if (slotEl) {
        const r = slotEl.getBoundingClientRect();
        centers.push({
          x: r.left + r.width / 2 - containerRect.left,
          y: r.top - containerRect.top
        });
      }
    }

    const pairs = [];
    if (d === 4) {
      pairs.push({ from: 0, to: 4, rem: 0 });
      pairs.push({ from: 1, to: 5, rem: 1 });
      pairs.push({ from: 2, to: 6, rem: 2 });
      pairs.push({ from: 3, to: 7, rem: 3 });
    } else if (d === 2) {
      pairs.push({ from: 0, to: 2, rem: 0 });
      pairs.push({ from: 2, to: 4, rem: 0 });
      pairs.push({ from: 4, to: 6, rem: 0 });
      pairs.push({ from: 1, to: 3, rem: 1 });
      pairs.push({ from: 3, to: 5, rem: 1 });
      pairs.push({ from: 5, to: 7, rem: 1 });
    }

    pairs.forEach(p => {
      const p1 = centers[p.from];
      const p2 = centers[p.to];
      if (!p1 || !p2) return;

      const arcHeight = d === 4 ? 68 : 44;
      const midX = (p1.x + p2.x) / 2;
      const ctrlY = Math.max(10, p1.y - arcHeight);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const dAttr = `M ${p1.x} ${p1.y} Q ${midX} ${ctrlY} ${p2.x} ${p2.y}`;
      path.setAttribute('d', dAttr);
      path.setAttribute('stroke', REM_COLORS[p.rem]);

      const isActive = activePair && (
        (activePair[0] === p.from && activePair[1] === p.to) ||
        (activePair[0] === p.to && activePair[1] === p.from)
      );

      if (isActive) {
        path.setAttribute('class', 'bezier-arc active');
      } else if (activePair) {
        path.setAttribute('class', 'bezier-arc dimmed');
      } else {
        path.setAttribute('class', 'bezier-arc');
        path.style.opacity = '0.75';
      }

      group.appendChild(path);
    });
  }

  // =========================================================================
  // 6. 子序列直接插入排序透视展台数据计算 (Sublist Insertion Sort Inspector)
  // =========================================================================
  function computeSublistInspectorData(step) {
    if (step.sortedPrefix && step.insertTarget && step.unsortedSuffix && step.opDesc) {
      return {
        sortedPrefix: step.sortedPrefix,
        insertTarget: step.insertTarget,
        unsortedSuffix: step.unsortedSuffix,
        opDesc: step.opDesc
      };
    }

    const formatItem = (item, slotIdx) => {
      if (!item) return `A[${slotIdx}]`;
      const tagStr = item.tag === 'a' ? 'ₐ' : (item.tag === 'b' ? 'ᵦ' : '');
      return `A[${slotIdx}]=${item.v}${tagStr}`;
    };

    if (step.d === 4 || step.d === 2) {
      if (step.activeSublist === null || step.i === null) {
        return {
          sortedPrefix: step.sortedPrefix || '[ 等待分组开始 ]',
          insertTarget: step.insertTarget || '—',
          unsortedSuffix: step.unsortedSuffix || (step.d === 4 ? '[ 共 4 组独立子表 ]' : '[ 偶数表 / 奇数表 ]'),
          opDesc: step.opDesc || step.sublistSummary || '准备进入同余子序列直接插入排序。'
        };
      }

      // 提取当前活跃子序列的所有物理槽位
      const sublistIndices = [];
      for (let idx = step.activeSublist; idx < 8; idx += step.d) {
        sublistIndices.push(idx);
      }

      const prefixSlots = sublistIndices.filter(k => k < step.i);
      const suffixSlots = sublistIndices.filter(k => k > step.i);

      // 已排序前驱文本
      let sortedPrefixStr = '[ 首元素默认有序 ]';
      if (prefixSlots.length > 0) {
        sortedPrefixStr = '[ ' + prefixSlots.map(k => {
          if (step.holeSlot === k) {
            return `A[${k}] (空穴)`;
          }
          return formatItem(step.arr[k], k);
        }).join(', ') + ' ]';
      }

      // 待插入目标文本
      let targetStr = '—';
      if (step.tempItem) {
        const tagStr = step.tempItem.tag === 'a' ? 'ₐ' : (step.tempItem.tag === 'b' ? 'ᵦ' : '');
        targetStr = `A[${step.i}]=${step.tempItem.v}${tagStr}`;
        if (step.tempSlot !== null) {
          targetStr += ` ⤉ [Temp ${step.tempSlot}]`;
        }
      } else if (step.arr[step.i]) {
        targetStr = formatItem(step.arr[step.i], step.i);
      }

      // 待扫描后驱文本
      let suffixStr = '[ 无 ]';
      if (suffixSlots.length > 0) {
        suffixStr = '[ ' + suffixSlots.map(k => formatItem(step.arr[k], k)).join(', ') + ' ]';
      }

      // 操作说明文本
      let opDescStr = step.sublistSummary;
      if (step.motion && step.motion.type === 'lift') {
        opDescStr = `【直接插入·抽离】将待插入元素 A[${step.i}] 抽离至 Temp 槽，原槽化为空穴，准备在已序前驱中反向查找插入位。`;
      } else if (step.compareInfo) {
        if (step.compareInfo.op === '>') {
          opDescStr = `【直接插入·逆序】比较 A[${step.j}](${step.compareInfo.leftVal}) > temp(${step.compareInfo.rightVal})：前驱较大，需顺着同余跳线向右大跨步后移填补空穴！`;
        } else {
          opDescStr = `【直接插入·有序】比较 A[${step.j}](${step.compareInfo.leftVal}) ≤ temp(${step.compareInfo.rightVal})：满足递增有序，找到插入位置，终止比较循环！`;
        }
      } else if (step.motion && step.motion.type === 'slide') {
        opDescStr = `【直接插入·后移】已序前驱卡片沿跳线平滑右移 ${step.d} 格填入空穴，腾出新空穴供 temp 插入。`;
      } else if (step.motion && step.motion.type === 'drop') {
        const sortedSlots = sublistIndices.filter(k => k <= step.i);
        sortedPrefixStr = '[ ' + sortedSlots.map(k => formatItem(step.arr[k], k)).join(', ') + ' ]';
        targetStr = `${formatItem(step.arr[step.motion.targetSlot || step.i], step.motion.targetSlot || step.i)} (已成功嵌入)`;
        opDescStr = `【直接插入·就位】temp 元素精准落入空穴完成插入，当前子表【已排序区】规模向右扩大 1 位！`;
      }

      return {
        sortedPrefix: step.sortedPrefix || sortedPrefixStr,
        insertTarget: step.insertTarget || targetStr,
        unsortedSuffix: step.unsortedSuffix || suffixStr,
        opDesc: step.opDesc || opDescStr
      };
    } else {
      // d === 1
      if (step.i === null) {
        return {
          sortedPrefix: step.sortedPrefix || '[ 全序列基本有序 ]',
          insertTarget: step.insertTarget || '—',
          unsortedSuffix: step.unsortedSuffix || '[ — ]',
          opDesc: step.opDesc || step.sublistSummary || '步长触底 d=1，全序列退化为经典直接插入排序。'
        };
      }

      const prefixSlots = [];
      for (let k = 0; k < step.i; k++) prefixSlots.push(k);
      const suffixSlots = [];
      for (let k = step.i + 1; k < 8; k++) suffixSlots.push(k);

      let sortedPrefixStr = '[ 首元素有序 ]';
      if (prefixSlots.length > 0) {
        sortedPrefixStr = '[ ' + prefixSlots.map(k => {
          if (step.holeSlot === k) {
            return `A[${k}] (空穴)`;
          }
          return formatItem(step.arr[k], k);
        }).join(', ') + ' ]';
      }

      let targetStr = '—';
      if (step.tempItem) {
        const tagStr = step.tempItem.tag === 'a' ? 'ₐ' : (step.tempItem.tag === 'b' ? 'ᵦ' : '');
        targetStr = `A[${step.i}]=${step.tempItem.v}${tagStr}`;
      } else if (step.arr[step.i]) {
        targetStr = formatItem(step.arr[step.i], step.i);
      }

      let suffixStr = '[ 无 ]';
      if (suffixSlots.length > 0) {
        suffixStr = '[ ' + suffixSlots.map(k => formatItem(step.arr[k], k)).join(', ') + ' ]';
      }

      let opDescStr = step.sublistSummary;
      if (step.motion && step.motion.type === 'slide') {
        opDescStr = `【近邻微调】由于前两趟粗排已基本有序，前驱仅需右移 1 位即可腾出插入位。`;
      } else if (step.compareInfo && step.compareInfo.op === '≤') {
        opDescStr = `【即时 break】待插入元素已大于等于前驱，零位移直接 break（基本有序下的 O(1) 最优表现）！`;
      }

      return {
        sortedPrefix: step.sortedPrefix || sortedPrefixStr,
        insertTarget: step.insertTarget || targetStr,
        unsortedSuffix: step.unsortedSuffix || suffixStr,
        opDesc: step.opDesc || opDescStr
      };
    }
  }

  // =========================================================================
  // 7. 视图渲染与 60fps 连续动量位移 (Render Step)
  // =========================================================================
  function renderStep(stepIndex, animate = true) {
    const step = State.steps[stepIndex];
    if (!step) return;

    // 1. 顶部控制台更新
    document.getElementById('step-counter').innerText = `步骤 ${stepIndex} / ${State.steps.length - 1}`;
    document.getElementById('step-description').innerText = step.title;
    document.getElementById('phase-badge').innerText = step.phaseName;

    // 增量显示器
    const badgeEl = document.getElementById('hud-d');
    badgeEl.innerText = `d = ${step.d}`;
    badgeEl.className = `step-badge-d d${step.d}`;

    // 逆序对计数板
    const invEl = document.getElementById('hud-inv');
    invEl.innerText = step.inversions;

    const deltaEl = document.getElementById('hud-inv-delta');
    if (step.invDelta) {
      deltaEl.innerText = `${step.invDelta}`;
      deltaEl.style.display = 'inline-flex';
    } else {
      deltaEl.style.display = 'none';
    }

    // 指针与指标
    document.getElementById('hud-i').innerText = step.i !== null ? `A[${step.i}]` : '—';
    document.getElementById('hud-j').innerText = step.j !== null ? `A[${step.j}]` : '—';
    const tempValStr = step.tempItem ? (step.tempItem.tag ? `49_${step.tempItem.tag}` : `${step.tempItem.v}`) : '—';
    document.getElementById('hud-temp').innerText = tempValStr;

    // Sparkline 激活状态
    State.steps.forEach((_, s) => {
      const bar = document.getElementById(`spark-bar-${s}`);
      if (bar) {
        if (s === stepIndex) {
          bar.className = 'spark-bar active';
        } else if (s < stepIndex) {
          bar.className = 'spark-bar final';
        } else {
          bar.className = 'spark-bar';
        }
      }
    });

    // 进度条
    const progressPercent = (stepIndex / (State.steps.length - 1)) * 100;
    document.getElementById('progress-bar-fill').style.width = `${progressPercent}%`;

    // 2. 子序列直接插入排序透视展台更新 (Sublist Insertion Sort Inspector)
    const inspData = computeSublistInspectorData(step);

    const spotDot = document.getElementById('spotlight-dot');
    const spotTitle = document.getElementById('spotlight-title');
    const spotStride = document.getElementById('spotlight-stride');
    const spotAction = document.getElementById('spotlight-action');
    const sortedPrefixEl = document.getElementById('inspector-sorted-prefix');
    const insertTargetEl = document.getElementById('inspector-insert-target');
    const unsortedSuffixEl = document.getElementById('inspector-unsorted-suffix');
    const opDescEl = document.getElementById('inspector-op-desc');

    if (spotDot) {
      if (step.activeSublist !== null && step.d > 1) {
        spotDot.style.backgroundColor = REM_COLORS[step.activeSublist];
      } else if (step.d === 1) {
        spotDot.style.backgroundColor = '#DC2626';
      } else {
        spotDot.style.backgroundColor = '#00B4D8';
      }
    }

    if (spotTitle) {
      if (step.activeSublist !== null && step.d > 1) {
        spotTitle.innerText = `【${REM_NAMES[step.activeSublist]}】(步长 d = ${step.d})`;
      } else if (step.d === 1) {
        spotTitle.innerText = '【全序列直接插入排序】(步长 d = 1)';
      } else {
        spotTitle.innerText = '【就绪】初始化测试用例';
      }
    }

    if (spotStride) {
      spotStride.innerText = `步长 d = ${step.d}`;
    }

    if (spotAction) {
      spotAction.innerText = step.actionTag || '运行中';
    }

    if (sortedPrefixEl) sortedPrefixEl.innerText = inspData.sortedPrefix;
    if (insertTargetEl) insertTargetEl.innerText = inspData.insertTarget;
    if (unsortedSuffixEl) unsortedSuffixEl.innerText = inspData.unsortedSuffix;
    if (opDescEl) opDescEl.innerText = inspData.opDesc;

    // 3. 空穴状态更新 (Hole Indication)
    for (let k = 0; k < 8; k++) {
      const slotEl = document.getElementById(`phys-slot-${k}`);
      if (slotEl) {
        if (step.holeSlot === k) {
          slotEl.classList.add('is-hole');
          if (!slotEl.querySelector('.hole-tag')) {
            const hTag = document.createElement('span');
            hTag.className = 'hole-tag';
            hTag.innerText = '待填空穴';
            slotEl.appendChild(hTag);
          }
        } else {
          slotEl.classList.remove('is-hole');
          const hTag = slotEl.querySelector('.hole-tag');
          if (hTag) slotEl.removeChild(hTag);
        }
      }
    }

    // 暂存槽高亮
    for (let t = 0; t < 8; t++) {
      const tSlot = document.querySelector(`.temp-slot[data-slot="${t}"]`);
      if (tSlot) {
        if (step.tempSlot === t) {
          tSlot.classList.add('active');
        } else {
          tSlot.classList.remove('active');
        }
      }
    }

    // 4. 连续动量卡片物理位移 (60fps GSAP continuous positioning)
    step.arr.forEach((item, slotIdx) => {
      const card = document.getElementById(item.id);
      if (!card) return;

      const isCurrentTemp = step.tempItem && step.tempItem.id === item.id;
      const targetCoord = isCurrentTemp
        ? getSlotCoord(step.tempSlot, true)
        : getSlotCoord(slotIdx, false);

      // 设置卡片实际宽度以契合槽位
      card.style.width = `${targetCoord.width}px`;

      // 聚光灯聚焦逻辑：
      // 如果当前有 activeSublist，属于该 sublist 的元素或者正在操作的 temp 元素保持 full 颜色与 100% 显性
      // 不属于的元素淡化为 0.2 灰度
      const itemSublist = slotIdx % step.d;
      const isBelongActive = (step.activeSublist !== null && (step.d === 1 || itemSublist === step.activeSublist)) || isCurrentTemp;

      if (step.activeSublist !== null && step.d > 1) {
        if (isBelongActive) {
          card.classList.remove('card-dimmed');
          card.classList.add('card-spotlight');
        } else {
          card.classList.add('card-dimmed');
          card.classList.remove('card-spotlight');
        }
      } else {
        card.classList.remove('card-dimmed', 'card-spotlight');
      }

      // 子表直接插入排序角色角标更新
      const roleBadge = document.getElementById(`${item.id}-role-badge`);
      if (roleBadge) {
        if (isBelongActive && step.i !== null) {
          roleBadge.style.display = 'block';
          if (isCurrentTemp) {
            roleBadge.className = 'sublist-role-badge role-target';
            roleBadge.innerText = '待插入 temp';
          } else if (step.holeSlot !== null && slotIdx === step.holeSlot) {
            roleBadge.style.display = 'none';
          } else if (slotIdx < step.i) {
            roleBadge.className = 'sublist-role-badge role-sorted';
            roleBadge.innerText = '已序前驱';
          } else if (slotIdx === step.i) {
            roleBadge.className = 'sublist-role-badge role-sorted';
            roleBadge.innerText = (step.motion && step.motion.type === 'drop') ? '已序落位' : '待插入';
          } else {
            roleBadge.className = 'sublist-role-badge role-unsorted';
            roleBadge.innerText = '待扫描';
          }
        } else {
          roleBadge.style.display = 'none';
        }
      }

      // 余数边框着色
      card.classList.remove('rem-color-0', 'rem-color-1', 'rem-color-2', 'rem-color-3');
      if (step.d > 1) {
        card.classList.add(`rem-color-${itemSublist}`);
      }

      // 余数微角标
      const remBadge = document.getElementById(`${item.id}-rem-badge`);
      if (remBadge) {
        if (step.d > 1) {
          remBadge.style.display = 'block';
          remBadge.innerText = `r${itemSublist}`;
          remBadge.className = `elem-rem-badge rem-badge-${itemSublist}`;
        } else {
          remBadge.style.display = 'none';
        }
      }

      // 执行物理补间位移
      const isMotionTarget = step.motion && step.motion.elemId === item.id;
      if (animate && isMotionTarget) {
        if (step.motion.type === 'slide') {
          // 顺弧线跨步滑动：略微上浮 16px 产生真实物理跨步抛物线质感
          const midY = targetCoord.y - 16;
          gsap.timeline()
            .to(card, {
              y: midY,
              duration: 0.28 / State.speed,
              ease: 'power1.out'
            })
            .to(card, {
              y: targetCoord.y,
              duration: 0.35 / State.speed,
              ease: 'power1.in'
            }, 0.28 / State.speed)
            .to(card, {
              x: targetCoord.x,
              duration: 0.63 / State.speed,
              ease: 'power2.inOut'
            }, 0);
        } else if (step.motion.type === 'lift') {
          // 垂直抽离升入暂存槽
          gsap.to(card, {
            x: targetCoord.x,
            y: targetCoord.y,
            duration: 0.45 / State.speed,
            ease: 'power2.out'
          });
        } else if (step.motion.type === 'drop') {
          // 下坠落入空穴
          gsap.to(card, {
            x: targetCoord.x,
            y: targetCoord.y,
            duration: 0.55 / State.speed,
            ease: 'back.out(1.3)'
          });
        }
      } else if (animate) {
        // 其他卡片平滑维持或微调到位
        gsap.to(card, {
          x: targetCoord.x,
          y: targetCoord.y,
          duration: 0.35 / State.speed,
          ease: 'power2.out'
        });
      } else {
        // 无动画直接定位
        gsap.set(card, {
          x: targetCoord.x,
          y: targetCoord.y
        });
      }
    });

    // 5. SVG 贝塞尔跳线
    renderBezierArcs(step.d, step.activeArcPair);

    // 6. 指针游标 (Cursor i & j)
    const cursorI = document.getElementById('cursor-i-node');
    const cursorJ = document.getElementById('cursor-j-node');

    if (step.i !== null) {
      cursorI.style.display = 'flex';
      document.getElementById('val-cursor-i').innerText = step.i;
      const c = getSlotCoord(step.i, false);
      cursorI.style.left = `${c.x + c.width / 2}px`;
    } else {
      cursorI.style.display = 'none';
    }

    if (step.j !== null && step.j >= 0) {
      cursorJ.style.display = 'flex';
      document.getElementById('val-cursor-j').innerText = step.j;
      const c = getSlotCoord(step.j, false);
      cursorJ.style.left = `${c.x + c.width / 2}px`;
    } else {
      cursorJ.style.display = 'none';
    }

    // 7. 比较判定气泡
    const bubble = document.getElementById('compare-bubble');
    if (step.compareInfo) {
      bubble.style.display = 'inline-flex';
      document.getElementById('cmp-left').innerText = step.compareInfo.leftVal;
      document.getElementById('cmp-op').innerText = step.compareInfo.op;
      document.getElementById('cmp-right').innerText = step.compareInfo.rightVal;
      document.getElementById('cmp-res').innerText = step.compareInfo.resText;
    } else {
      bubble.style.display = 'none';
    }

    // 8. 相同键值稳定性实时雷达
    const idxA = step.arr.findIndex(x => x.id === 'elem_49a');
    const idxB = step.arr.findIndex(x => x.id === 'elem_49b');
    if (idxA !== -1 && idxB !== -1) {
      document.getElementById('pos-49a').innerText = `49ₐ 位于槽位 ${idxA}`;
      document.getElementById('pos-49b').innerText = `49ᵦ 位于槽位 ${idxB}`;
      const dist = Math.abs(idxB - idxA);
      document.getElementById('dist-49').innerText = dist;

      const pill = document.getElementById('stability-status-pill');
      if (idxA < idxB) {
        if (dist === 7) {
          pill.className = 'px-2 py-0.5 rounded font-semibold text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200';
          pill.innerText = '相对次序完好 (间距 7)';
        } else {
          pill.className = 'px-2 py-0.5 rounded font-semibold text-[11px] bg-amber-50 text-amber-700 border border-amber-200';
          pill.innerText = `次序虽保，但间距骤缩为 ${dist} (独立跳跃破坏稳定环境)`;
        }
      } else {
        pill.className = 'px-2 py-0.5 rounded font-semibold text-[11px] bg-red-50 text-red-700 border border-red-200';
        pill.innerText = '严重逆转！49ᵦ 飞跃至 49ₐ 前面！';
      }
    }

    // 9. 不稳定性特写横幅
    const alertBox = document.getElementById('instability-alert');
    if (step.alertInstability) {
      alertBox.classList.remove('hidden');
    } else {
      alertBox.classList.add('hidden');
    }

    // 10. 底部终端信息提示
    document.getElementById('terminal-text').innerText = step.terminal;

    // 11. 伪代码高亮逐行追踪
    for (let c = 1; c <= 13; c++) {
      const codeEl = document.getElementById(`code-${c}`);
      if (codeEl) {
        if (c === step.codeLine) {
          codeEl.classList.add('active');
        } else {
          codeEl.classList.remove('active');
        }
      }
    }
  }

  // =========================================================================
  // 7. 播放控制与用户交互 (Playback Controls)
  // =========================================================================
  function nextStep() {
    if (State.idx < State.steps.length - 1) {
      State.idx++;
      renderStep(State.idx, true);
    } else {
      pause();
    }
  }

  function prevStep() {
    if (State.idx > 0) {
      State.idx--;
      renderStep(State.idx, true);
    }
  }

  function reset() {
    pause();
    State.idx = 0;
    renderStep(0, false);
  }

  function play() {
    if (State.idx >= State.steps.length - 1) {
      State.idx = 0;
      renderStep(0, false);
    }
    State.playing = true;
    updatePlayButton();
    runPlayLoop();
  }

  function pause() {
    State.playing = false;
    if (State.timer) {
      clearTimeout(State.timer);
      State.timer = null;
    }
    updatePlayButton();
  }

  function togglePlay() {
    if (State.playing) {
      pause();
    } else {
      play();
    }
  }

  function updatePlayButton() {
    const icon = document.getElementById('play-icon');
    const label = document.getElementById('play-label');
    if (State.playing) {
      icon.innerText = '⏸';
      label.innerText = '暂停';
    } else {
      icon.innerText = '▶';
      label.innerText = '自动播放';
    }
  }

  function runPlayLoop() {
    if (!State.playing) return;

    if (State.idx >= State.steps.length - 1) {
      pause();
      return;
    }

    const currentHold = (State.steps[State.idx].hold || 2000) / State.speed;
    State.timer = setTimeout(() => {
      if (!State.playing) return;
      State.idx++;
      renderStep(State.idx, true);
      runPlayLoop();
    }, currentHold);
  }

  function setSpeed(speedVal) {
    State.speed = speedVal;
    document.querySelectorAll('.speed-btn').forEach(btn => {
      if (parseFloat(btn.dataset.speed) === speedVal) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // =========================================================================
  // 8. 事件监听器绑定
  // =========================================================================
  function bindEvents() {
    document.getElementById('btn-play').addEventListener('click', togglePlay);
    document.getElementById('btn-next').addEventListener('click', () => {
      pause();
      nextStep();
    });
    document.getElementById('btn-prev').addEventListener('click', () => {
      pause();
      prevStep();
    });
    document.getElementById('btn-reset').addEventListener('click', reset);

    // 速率按键
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setSpeed(parseFloat(btn.dataset.speed));
      });
    });

    // 进度条点击跳转
    const progressContainer = document.getElementById('progress-bar-container');
    if (progressContainer) {
      progressContainer.addEventListener('click', e => {
        pause();
        const rect = progressContainer.getBoundingClientRect();
        const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const targetIdx = Math.round(clickRatio * (State.steps.length - 1));
        State.idx = targetIdx;
        renderStep(State.idx, false);
      });
    }

    // 键盘全局快捷键
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        pause();
        nextStep();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        pause();
        prevStep();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        reset();
      }
    });

    // 窗口尺寸自适应重新定位卡片与跳线
    window.addEventListener('resize', () => {
      if (State.steps.length > 0) {
        renderStep(State.idx, false);
      }
    });
  }

  // =========================================================================
  // 9. 启动入口
  // =========================================================================
  window.addEventListener('DOMContentLoaded', () => {
    State.steps = generateSteps();
    initStageDOM();
    bindEvents();

    if (window.renderMathInElement) {
      window.renderMathInElement(document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    }

    requestAnimationFrame(() => {
      renderStep(0, false);
      setTimeout(() => {
        renderStep(0, false);
      }, 50);
    });
  });

})();
