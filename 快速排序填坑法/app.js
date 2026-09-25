/**
 * 快速排序填坑法与完整递归全过程 — 核心引擎
 * 支持：完整递归全排序模式（二叉递归树 + 调用栈 + 全序列有序）与 单趟填坑微观演练
 * 严格遵循 Taste-Skill Light Editorial 规范与 60fps 缓动
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. 全局状态定义
  // =========================================================================
  const State = {
    mode: 'recursive', // 'recursive' | 'single'
    presets: {
      classic: [49, 38, 65, 97, 76, 13, 27],
      sorted: [10, 20, 30, 40, 50, 60, 70],
      alternate: [50, 20, 80, 15, 85, 30, 70],
      descending: [70, 60, 50, 40, 30, 20, 10]
    },
    rawArray: [49, 38, 65, 97, 76, 13, 27],
    steps: [],          // 当前时间线步骤列表
    treeNodes: [],      // 递归树节点列表
    currentStepIdx: 0,
    isPlaying: false,
    playTimer: null,
    speed: 1.0,
    currentTween: null
  };

  // =========================================================================
  // 2. 递归全过程时间线生成器 (Full Recursive QuickSort Timeline Generator)
  // =========================================================================
  function generateFullRecursiveSteps(initialArr) {
    const steps = [];
    const arr = [...initialArr];
    const n = arr.length;
    const locked = new Array(n).fill(false); // 标记已锁定的最终有序元素
    const callStack = [];
    let maxStackDepth = 1;
    let nodeCounter = 0;
    const isInitiallySorted = initialArr.every((val, idx) => idx === 0 || val >= initialArr[idx - 1]);

    // Helper: 浅拷贝单元格状态
    function getCellStates(activeLow, activeHigh, holeIdx, pivotIdx) {
      const states = [];
      for (let k = 0; k < n; k++) {
        if (k === holeIdx) {
          states.push('hole');
        } else if (locked[k]) {
          states.push('locked');
        } else if (k === pivotIdx) {
          states.push('pivot');
        } else {
          states.push('initial');
        }
      }
      return states;
    }

    // 预先构建完整的二叉递归树拓扑骨架 (保持树布局始终固定稳定)
    const treeNodes = [];
    let skeletonCounter = 0;
    const simArr = [...initialArr];

    function buildSkeleton(low, high, parentId, side, depth) {
      const id = `node_${skeletonCounter++}`;
      const isEmpty = (low > high);
      const node = {
        id,
        parentId,
        side,
        level: depth,
        low,
        high,
        subArr: isEmpty ? [] : simArr.slice(low, high + 1),
        pivot: low < high ? simArr[low] : null,
        pivotIdx: null,
        status: isEmpty ? 'base_case' : 'pending'
      };
      treeNodes.push(node);

      if (low >= high) return;

      const pivot = simArr[low];
      let i = low, j = high, hole = low;
      while (i < j) {
        while (i < j && simArr[j] >= pivot) j--;
        if (i < j) { simArr[hole] = simArr[j]; hole = j; }
        while (i < j && simArr[i] <= pivot) i++;
        if (i < j) { simArr[hole] = simArr[i]; hole = i; }
      }
      simArr[hole] = pivot;
      const pivotpos = hole;
      node.pivotIdx = pivotpos;

      buildSkeleton(low, pivotpos - 1, id, 'left', depth + 1);
      buildSkeleton(pivotpos + 1, high, id, 'right', depth + 1);
    }

    buildSkeleton(0, n - 1, null, 'root', 0);

    function pushStep(stepObj) {
      stepObj.isDegenerate = isInitiallySorted || callStack.length >= 4;
      steps.push(stepObj);
    }

    pushStep({
      stepTitle: isInitiallySorted ? 'Step 0: 已完全有序数组就绪 (最坏退化情形)' : 'Step 0: 初始乱序数组就绪',
      description: isInitiallySorted
        ? `【408最坏退化情形】待排序序列已呈完全升序 [${arr.join(', ')}]！固定选首元素为基准将无法找到更小元，导致划分极度失衡 (0 : ${n - 1})，二叉树退化为单支树，递归栈深度达到最大理论值 O(n)！`
        : `待排序序列共有 ${n} 个元素，全数组尚未有序。准备从根区间 A[0..${n - 1}] 开始递归划分。`,
      liveHint: isInitiallySorted ? '🚨 已完全有序！观察单支树与 O(n) 栈深度退化' : '点击“单步执行”或“自动播放”开始递归快速排序',
      array: [...arr],
      cellStates: getCellStates(0, n - 1, null, null),
      activeLow: 0,
      activeHigh: n - 1,
      pointerI: null,
      pointerJ: null,
      holeIndex: null,
      pivotValue: null,
      locked: [...locked],
      callStack: [],
      activeNodeId: null,
      treeNodes: JSON.parse(JSON.stringify(treeNodes)),
      codeLine: 1,
      sortedCount: 0,
      isVictory: false,
      animation: null
    });

    // 递归执行主体
    function recursiveQSort(low, high, parentNodeId, side, depth) {
      const currentCallLabel = `QuickSort(A, ${low}, ${high})`;
      callStack.push({ label: currentCallLabel, low, high });
      if (callStack.length > maxStackDepth) {
        maxStackDepth = callStack.length;
      }

      // 检索对应树节点
      let currentNode = treeNodes.find(node => node.low === low && node.high === high && node.parentId === parentNodeId && node.side === side) ||
                        treeNodes.find(node => node.parentId === parentNodeId && node.side === side) ||
                        treeNodes.find(node => node.low === low && node.high === high) ||
                        treeNodes[0];
      currentNode.status = 'running';

      const activeNodeId = currentNode.id;

      // 递归基底判断 (Base Case)
      if (low >= high) {
        if (low === high) {
          locked[low] = true;
          currentNode.status = 'base_case';
          currentNode.pivotIdx = low;

          pushStep({
            stepTitle: `基底边界: A[${low}] 单元素自动有序`,
            description: `子区间 A[${low}..${high}] 长度为 1，无需再进行划分，元素 ${arr[low]} 直接确立最终有序位置！`,
            liveHint: `区间长度为 1，A[${low}]=${arr[low]} 自动锁定归位`,
            array: [...arr],
            cellStates: getCellStates(low, high, null, null),
            activeLow: low,
            activeHigh: high,
            pointerI: low,
            pointerJ: high,
            holeIndex: null,
            pivotValue: arr[low],
            locked: [...locked],
            callStack: JSON.parse(JSON.stringify(callStack)),
            activeNodeId: activeNodeId,
            treeNodes: JSON.parse(JSON.stringify(treeNodes)),
            codeLine: 2,
            sortedCount: locked.filter(Boolean).length,
            isVictory: false,
            animation: null
          });
        } else {
          // 空区间
          currentNode.status = 'base_case';
          pushStep({
            stepTitle: `基底边界: 空子区间直接返回`,
            description: `子区间下标 [${low}..${high}] 满足 low > high，区间为空无需排序，递归返回。`,
            liveHint: `空区间返回`,
            array: [...arr],
            cellStates: getCellStates(low, high, null, null),
            activeLow: low,
            activeHigh: high,
            pointerI: null,
            pointerJ: null,
            holeIndex: null,
            pivotValue: null,
            locked: [...locked],
            callStack: JSON.parse(JSON.stringify(callStack)),
            activeNodeId: activeNodeId,
            treeNodes: JSON.parse(JSON.stringify(treeNodes)),
            codeLine: 2,
            sortedCount: locked.filter(Boolean).length,
            isVictory: false,
            animation: null
          });
        }

        callStack.pop();
        return;
      }

      // ---------------------------------------------------------------------
      // low < high: 执行填坑法划分 (Partition)
      // ---------------------------------------------------------------------
      const pivot = arr[low];
      currentNode.pivot = pivot;

      // 步骤 1: 选定基准并挖首坑
      let hole = low;
      const subCellStates = getCellStates(low, high, hole, low);

      pushStep({
        stepTitle: `划分开始: 激活 A[${low}..${high}]，选定基准 ${pivot}`,
        description: `进入 ${currentCallLabel}。以首元素 A[${low}]=${pivot} 为基准，挖出首坑 Hole [${low}]，指针 i=${low}, j=${high}。`,
        liveHint: `激活区间 [${low}..${high}]，挖出首坑 A[${low}]`,
        array: [...arr],
        cellStates: [...subCellStates],
        activeLow: low,
        activeHigh: high,
        pointerI: low,
        pointerJ: high,
        holeIndex: hole,
        pivotValue: pivot,
        locked: [...locked],
        callStack: JSON.parse(JSON.stringify(callStack)),
        activeNodeId: activeNodeId,
        treeNodes: JSON.parse(JSON.stringify(treeNodes)),
        codeLine: 3,
        sortedCount: locked.filter(Boolean).length,
        isVictory: false,
        animation: {
          type: 'fly_to_monitor',
          fromIdx: low,
          val: pivot
        }
      });

      // 双指针向内填坑
      let i = low;
      let j = high;

      while (i < j) {
        // j 从右向左找小元素
        while (i < j && arr[j] >= pivot) {
          j--;
        }
        if (i < j) {
          const movingVal = arr[j];
          arr[hole] = movingVal; // 填入坑
          const prevHole = hole;
          hole = j; // 新坑在 j

          const scanStates = getCellStates(low, high, hole, null);
          scanStates[prevHole] = 'smaller';

          pushStep({
            stepTitle: `j 找到较小元 ${movingVal}，填入坑 [${prevHole}]`,
            description: `指针 j 扫描到 A[${j}]=${movingVal} < pivot(${pivot})，填入当前坑位 [${prevHole}]；A[${j}] 成为新坑。`,
            liveHint: `A[${j}]=${movingVal} 飞入填坑 [${prevHole}]，新坑为 [${j}]`,
            array: [...arr],
            cellStates: [...scanStates],
            activeLow: low,
            activeHigh: high,
            pointerI: i,
            pointerJ: j,
            holeIndex: hole,
            pivotValue: pivot,
            locked: [...locked],
            callStack: JSON.parse(JSON.stringify(callStack)),
            activeNodeId: activeNodeId,
            treeNodes: JSON.parse(JSON.stringify(treeNodes)),
            codeLine: 3,
            sortedCount: locked.filter(Boolean).length,
            isVictory: false,
            animation: {
              type: 'fly_cell_to_hole',
              fromIdx: j,
              toIdx: prevHole,
              val: movingVal,
              colorClass: 'cell-state-smaller'
            }
          });
        }

        // i 从左向右找大元素
        while (i < j && arr[i] <= pivot) {
          i++;
        }
        if (i < j) {
          const movingVal = arr[i];
          arr[hole] = movingVal; // 填入坑
          const prevHole = hole;
          hole = i; // 新坑在 i

          const scanStates = getCellStates(low, high, hole, null);
          scanStates[prevHole] = 'greater';

          pushStep({
            stepTitle: `i 找到较大元 ${movingVal}，填入坑 [${prevHole}]`,
            description: `指针 i 扫描到 A[${i}]=${movingVal} > pivot(${pivot})，填入当前坑位 [${prevHole}]；A[${i}] 成为新坑。`,
            liveHint: `A[${i}]=${movingVal} 飞入填坑 [${prevHole}]，新坑为 [${i}]`,
            array: [...arr],
            cellStates: [...scanStates],
            activeLow: low,
            activeHigh: high,
            pointerI: i,
            pointerJ: j,
            holeIndex: hole,
            pivotValue: pivot,
            locked: [...locked],
            callStack: JSON.parse(JSON.stringify(callStack)),
            activeNodeId: activeNodeId,
            treeNodes: JSON.parse(JSON.stringify(treeNodes)),
            codeLine: 3,
            sortedCount: locked.filter(Boolean).length,
            isVictory: false,
            animation: {
              type: 'fly_cell_to_hole',
              fromIdx: i,
              toIdx: prevHole,
              val: movingVal,
              colorClass: 'cell-state-greater'
            }
          });
        }
      }

      // 相遇与填入基准
      const pivotpos = i;
      arr[pivotpos] = pivot;
      locked[pivotpos] = true; // 基准元素终身锁定归位！
      currentNode.pivotIdx = pivotpos;
      currentNode.status = 'partitioned';

      const lockedStates = getCellStates(low, high, null, null);

      let stepTitleText = `基准归位: pivot(${pivot}) 锁定在 A[${pivotpos}]`;
      let stepDescText = `指针 i 与 j 在下标 [${pivotpos}] 相遇碰撞！基准值 ${pivot} 填入并永久锁定归位 (已达成严格有序位置)。`;
      let liveHintText = `🤝 基准 ${pivot} 锁定归位在 A[${pivotpos}]！`;

      if (pivotpos === low && high > low) {
        stepTitleText = `【408退化】基准 ${pivot} 原地归位 A[${low}] (单支退化)`;
        stepDescText = `⚠️ 初始序列已局部升序！指针 j 从右端末尾向左一路扫描均未发现比 ${pivot} 更小的元。基准 ${pivot} 只能原地归位！导致划分极度失衡：左半区 0 个元素，右半区 ${high - low} 个元素！二叉树退化为单支树！`;
        liveHintText = `🚨 退化警告：基准原地归位，左区间为空，右侧产生 ${high - low} 长度长尾！`;
      }

      pushStep({
        stepTitle: stepTitleText,
        description: stepDescText,
        liveHint: liveHintText,
        array: [...arr],
        cellStates: [...lockedStates],
        activeLow: low,
        activeHigh: high,
        pointerI: pivotpos,
        pointerJ: pivotpos,
        holeIndex: null,
        pivotValue: pivot,
        locked: [...locked],
        callStack: JSON.parse(JSON.stringify(callStack)),
        activeNodeId: activeNodeId,
        treeNodes: JSON.parse(JSON.stringify(treeNodes)),
        codeLine: 3,
        sortedCount: locked.filter(Boolean).length,
        isVictory: false,
        animation: {
          type: 'fly_pivot_to_hole',
          toIdx: pivotpos,
          val: pivot
        }
      });

      // 递归左子区间
      pushStep({
        stepTitle: `分治推进: 准备递归左子区间 A[${low}..${pivotpos - 1}]`,
        description: `根据分治策略，基准左侧所有元素均 &le; ${pivot}，接下来递归处理左子序列 A[${low}..${pivotpos - 1}]。`,
        liveHint: `前序遍历：递归左半区 A[${low}..${pivotpos - 1}]`,
        array: [...arr],
        cellStates: getCellStates(low, pivotpos - 1, null, null),
        activeLow: low,
        activeHigh: pivotpos - 1,
        pointerI: null,
        pointerJ: null,
        holeIndex: null,
        pivotValue: null,
        locked: [...locked],
        callStack: JSON.parse(JSON.stringify(callStack)),
        activeNodeId: activeNodeId,
        treeNodes: JSON.parse(JSON.stringify(treeNodes)),
        codeLine: 4,
        sortedCount: locked.filter(Boolean).length,
        isVictory: false,
        animation: null
      });

      recursiveQSort(low, pivotpos - 1, activeNodeId, 'left', depth + 1);

      // 递归右子区间
      pushStep({
        stepTitle: `分治推进: 准备递归右子区间 A[${pivotpos + 1}..${high}]`,
        description: `左子序列已处理完毕，基准右侧所有元素均 &ge; ${pivot}，接下来递归处理右子序列 A[${pivotpos + 1}..${high}]。`,
        liveHint: `前序遍历：递归右半区 A[${pivotpos + 1}..${high}]`,
        array: [...arr],
        cellStates: getCellStates(pivotpos + 1, high, null, null),
        activeLow: pivotpos + 1,
        activeHigh: high,
        pointerI: null,
        pointerJ: null,
        holeIndex: null,
        pivotValue: null,
        locked: [...locked],
        callStack: JSON.parse(JSON.stringify(callStack)),
        activeNodeId: activeNodeId,
        treeNodes: JSON.parse(JSON.stringify(treeNodes)),
        codeLine: 5,
        sortedCount: locked.filter(Boolean).length,
        isVictory: false,
        animation: null
      });

      recursiveQSort(pivotpos + 1, high, activeNodeId, 'right', depth + 1);

      // 左右子区间均完成，弹出栈
      currentNode.status = 'completed';
      callStack.pop();
    }

    // 从根节点启动递归
    recursiveQSort(0, n - 1, null, 'root', 0);

    // -----------------------------------------------------------------------
    // 全排序胜利态 (Victory Step)
    // -----------------------------------------------------------------------
    for (let k = 0; k < n; k++) locked[k] = true;

    pushStep({
      stepTitle: isInitiallySorted ? '🎉 排序完成 (408单支树最坏情形分析)' : '🎉 全局快速排序完成！数组完全有序',
      description: isInitiallySorted
        ? `排序完成！由于初始序列已经完全有序，单趟划分始终无法二分序列，导致递归树高度达到了最大的 ${n} 层，调用栈深度达 ${maxStackDepth} (O(n))，累计比较次数达 ${n*(n-1)/2} 次 (O(n²))！充分印证了 408 考点中快排在已有序时的最坏性能退化。`
        : `全数组经过分治递归划分已达到完全升序：[${arr.join(', ')}]！所有基准全部锁定，二叉递归树全部解析完毕，调用栈清空返回。`,
      liveHint: isInitiallySorted ? '🚨 单支退化验证完成：O(n) 栈深度 + O(n²) 比较' : '🎉 排序成功完成！全序列已成为升序！',
      array: [...arr],
      cellStates: new Array(n).fill('locked'),
      activeLow: 0,
      activeHigh: n - 1,
      pointerI: null,
      pointerJ: null,
      holeIndex: null,
      pivotValue: null,
      locked: [...locked],
      callStack: [],
      activeNodeId: null,
      treeNodes: JSON.parse(JSON.stringify(treeNodes)),
      codeLine: 7,
      sortedCount: n,
      isVictory: true,
      animation: null
    });

    return { steps, treeNodes, maxStackDepth };
  }

  // =========================================================================
  // 3. 单趟模式状态机生成器 (Single-Pass Drill Generator)
  // =========================================================================
  function generateSinglePassSteps(initialArr) {
    const steps = [];
    const arr = [...initialArr];
    const n = arr.length;
    const pivot = arr[0];
    let swapCount = 0;

    function cloneStates(states) {
      return [...states];
    }

    let cellStates = new Array(n).fill('initial');

    // Step 0: 初始待命
    steps.push({
      stepTitle: 'Step 0: 单趟划分初始状态',
      description: `待排数组长度为 ${n}，全部元素处于初始中性灰色状态。`,
      liveHint: '点击“单步执行”开始单趟填坑划分',
      array: [...arr],
      cellStates: cloneStates(cellStates),
      activeLow: 0,
      activeHigh: n - 1,
      pointerI: null,
      pointerJ: null,
      holeIndex: null,
      pivotValue: pivot,
      locked: new Array(n).fill(false),
      callStack: [{ label: `Partition(A, 0, ${n-1})`, low: 0, high: n - 1 }],
      activeNodeId: null,
      treeNodes: [],
      codeLine: 1,
      sortedCount: 0,
      isVictory: false,
      animation: null
    });

    // Step 1: 选定基准
    cellStates[0] = 'pivot';
    steps.push({
      stepTitle: 'Step 1.1: 选定基准元素',
      description: `选定数组首元素 A[0]=${pivot} 为基准元素 (pivot)，亮起霓虹蓝。`,
      liveHint: `选定 A[0]=${pivot} 为基准`,
      array: [...arr],
      cellStates: cloneStates(cellStates),
      activeLow: 0,
      activeHigh: n - 1,
      pointerI: null,
      pointerJ: null,
      holeIndex: null,
      pivotValue: pivot,
      locked: new Array(n).fill(false),
      callStack: [{ label: `Partition(A, 0, ${n-1})`, low: 0, high: n - 1 }],
      activeNodeId: null,
      treeNodes: [],
      codeLine: 2,
      sortedCount: 0,
      isVictory: false,
      animation: null
    });

    // Step 2: 挖开首坑
    cellStates[0] = 'hole';
    let holeIdx = 0;
    steps.push({
      stepTitle: 'Step 1.2: 挖开首坑',
      description: `A[0] 的数值 ${pivot} 暂存进入基准监视器；原位置 A[0] 变为黑色虚线坑 (Hole = 0)。`,
      liveHint: `A[0] 变为第 1 个坑 (Hole 0)`,
      array: [...arr],
      cellStates: cloneStates(cellStates),
      activeLow: 0,
      activeHigh: n - 1,
      pointerI: null,
      pointerJ: null,
      holeIndex: 0,
      pivotValue: pivot,
      locked: new Array(n).fill(false),
      callStack: [{ label: `Partition(A, 0, ${n-1})`, low: 0, high: n - 1 }],
      activeNodeId: null,
      treeNodes: [],
      codeLine: 2,
      sortedCount: 0,
      isVictory: false,
      animation: {
        type: 'fly_to_monitor',
        fromIdx: 0,
        val: pivot
      }
    });

    // Step 3: 双指针就位
    let low = 0;
    let high = n - 1;
    steps.push({
      stepTitle: 'Step 1.3: 双指针就位',
      description: `指针 i（蓝色光标）对准第一个坑 (i=0)；指针 j（橙色光标）对准末尾 (j=${high})。`,
      liveHint: `双指针就位：i=0 对准坑，j=${high} 准备从右向左探测`,
      array: [...arr],
      cellStates: cloneStates(cellStates),
      activeLow: 0,
      activeHigh: n - 1,
      pointerI: low,
      pointerJ: high,
      holeIndex: 0,
      pivotValue: pivot,
      locked: new Array(n).fill(false),
      callStack: [{ label: `Partition(A, 0, ${n-1})`, low: 0, high: n - 1 }],
      activeNodeId: null,
      treeNodes: [],
      codeLine: 3,
      sortedCount: 0,
      isVictory: false,
      animation: null
    });

    // 循环扫描填坑
    while (low < high) {
      while (low < high && arr[high] >= pivot) {
        steps.push({
          stepTitle: `Step 2.1: j 检查 A[${high}] = ${arr[high]}`,
          description: `指针 j 指向 A[${high}]=${arr[high]} &ge; pivot(${pivot})，不满足小元素条件，继续向左扫描。`,
          liveHint: `j 扫过 A[${high}]=${arr[high]} >= ${pivot}，跳过向左移`,
          array: [...arr],
          cellStates: cloneStates(cellStates),
          activeLow: 0,
          activeHigh: n - 1,
          pointerI: low,
          pointerJ: high,
          holeIndex: holeIdx,
          pivotValue: pivot,
          locked: new Array(n).fill(false),
          callStack: [{ label: `Partition(A, 0, ${n-1})`, low: 0, high: n - 1 }],
          activeNodeId: null,
          treeNodes: [],
          codeLine: 3,
          sortedCount: 0,
          isVictory: false,
          animation: null
        });
        high--;
      }

      if (low < high) {
        const movingVal = arr[high];
        arr[holeIdx] = movingVal;
        const prevHole = holeIdx;
        holeIdx = high;
        cellStates[prevHole] = 'smaller';
        cellStates[holeIdx] = 'hole';
        swapCount++;

        steps.push({
          stepTitle: `Step 2.2: 较小元 ${movingVal} 填入 A[${prevHole}]，A[${holeIdx}] 成新坑`,
          description: `元素 ${movingVal} 从 A[${high}] 飘出填充到当前坑 A[${prevHole}]；原位置 A[${high}] 成为新坑。`,
          liveHint: `元素 ${movingVal} 飞入填坑 A[${prevHole}]，新坑为 [${holeIdx}]`,
          array: [...arr],
          cellStates: cloneStates(cellStates),
          activeLow: 0,
          activeHigh: n - 1,
          pointerI: low,
          pointerJ: high,
          holeIndex: holeIdx,
          pivotValue: pivot,
          locked: new Array(n).fill(false),
          callStack: [{ label: `Partition(A, 0, ${n-1})`, low: 0, high: n - 1 }],
          activeNodeId: null,
          treeNodes: [],
          codeLine: 3,
          sortedCount: 0,
          isVictory: false,
          animation: {
            type: 'fly_cell_to_hole',
            fromIdx: high,
            toIdx: prevHole,
            val: movingVal,
            colorClass: 'cell-state-smaller'
          }
        });
      }

      while (low < high && arr[low] <= pivot) {
        steps.push({
          stepTitle: `Step 3.1: i 检查 A[${low}] = ${arr[low]}`,
          description: `指针 i 指向 A[${low}]=${arr[low]} &le; pivot(${pivot})，不满足大元素条件，继续向右扫描。`,
          liveHint: `i 扫过 A[${low}]=${arr[low]} <= ${pivot}，跳过向右移`,
          array: [...arr],
          cellStates: cloneStates(cellStates),
          activeLow: 0,
          activeHigh: n - 1,
          pointerI: low,
          pointerJ: high,
          holeIndex: holeIdx,
          pivotValue: pivot,
          locked: new Array(n).fill(false),
          callStack: [{ label: `Partition(A, 0, ${n-1})`, low: 0, high: n - 1 }],
          activeNodeId: null,
          treeNodes: [],
          codeLine: 3,
          sortedCount: 0,
          isVictory: false,
          animation: null
        });
        low++;
      }

      if (low < high) {
        const movingVal = arr[low];
        arr[holeIdx] = movingVal;
        const prevHole = holeIdx;
        holeIdx = low;
        cellStates[prevHole] = 'greater';
        cellStates[holeIdx] = 'hole';
        swapCount++;

        steps.push({
          stepTitle: `Step 3.2: 较大元 ${movingVal} 填入 A[${prevHole}]，A[${holeIdx}] 成新坑`,
          description: `元素 ${movingVal} 从 A[${low}] 飘出填充到当前坑 A[${prevHole}]；原位置 A[${low}] 成为新坑。`,
          liveHint: `元素 ${movingVal} 飞入填坑 A[${prevHole}]，新坑为 [${holeIdx}]`,
          array: [...arr],
          cellStates: cloneStates(cellStates),
          activeLow: 0,
          activeHigh: n - 1,
          pointerI: low,
          pointerJ: high,
          holeIndex: holeIdx,
          pivotValue: pivot,
          locked: new Array(n).fill(false),
          callStack: [{ label: `Partition(A, 0, ${n-1})`, low: 0, high: n - 1 }],
          activeNodeId: null,
          treeNodes: [],
          codeLine: 3,
          sortedCount: 0,
          isVictory: false,
          animation: {
            type: 'fly_cell_to_hole',
            fromIdx: low,
            toIdx: prevHole,
            val: movingVal,
            colorClass: 'cell-state-greater'
          }
        });
      }
    }

    // 相遇撞坑
    steps.push({
      stepTitle: `Step 4.2: i 与 j 在坑位 [${low}] 相遇`,
      description: `指针 i 与 j 指向同一个黑色虚线框 (i = j = ${low})，单趟扫描终止！`,
      liveHint: `🤝 双指针在坑位 [${low}] 碰撞相遇！`,
      array: [...arr],
      cellStates: cloneStates(cellStates),
      activeLow: 0,
      activeHigh: n - 1,
      pointerI: low,
      pointerJ: low,
      holeIndex: low,
      pivotValue: pivot,
      locked: new Array(n).fill(false),
      callStack: [{ label: `Partition(A, 0, ${n-1})`, low: 0, high: n - 1 }],
      activeNodeId: null,
      treeNodes: [],
      codeLine: 3,
      sortedCount: 0,
      isVictory: false,
      isMeet: true,
      animation: null
    });

    // 基准归位
    arr[low] = pivot;
    cellStates[low] = 'pivot';
    const finalLocked = new Array(n).fill(false);
    finalLocked[low] = true;

    steps.push({
      stepTitle: `Step 4.3: 基准 pivot(${pivot}) 填入最终坑位 A[${low}]`,
      description: `霓虹蓝 pivot (${pivot}) 填入唯一的黑色坑 A[${low}] 中锁定归位！`,
      liveHint: `基准 ${pivot} 飞入最终坑位 A[${low}] 归位！`,
      array: [...arr],
      cellStates: cloneStates(cellStates),
      activeLow: 0,
      activeHigh: n - 1,
      pointerI: low,
      pointerJ: low,
      holeIndex: null,
      pivotValue: pivot,
      locked: [...finalLocked],
      callStack: [{ label: `Partition(A, 0, ${n-1})`, low: 0, high: n - 1 }],
      activeNodeId: null,
      treeNodes: [],
      codeLine: 3,
      sortedCount: 1,
      isVictory: false,
      animation: {
        type: 'fly_pivot_to_hole',
        toIdx: low,
        val: pivot
      }
    });

    // Phase 5 总结
    for (let k = 0; k < n; k++) {
      if (k !== low) cellStates[k] = 'sorted';
    }

    steps.push({
      stepTitle: 'Step 5.1: 单趟划分完成',
      description: `以 A[${low}]=${pivot} 为分界线，左侧元素均 &le; ${pivot}，右侧元素均 &ge; ${pivot}。单趟目标达成！`,
      liveHint: `左侧 <= ${pivot} <= 右侧，单趟划分成功！`,
      array: [...arr],
      cellStates: cloneStates(cellStates),
      activeLow: 0,
      activeHigh: n - 1,
      pointerI: low,
      pointerJ: low,
      holeIndex: null,
      pivotValue: pivot,
      locked: [...finalLocked],
      callStack: [],
      activeNodeId: null,
      treeNodes: [],
      codeLine: 4,
      sortedCount: 1,
      isVictory: false,
      animation: null
    });

    return { steps, treeNodes: [], maxStackDepth: 1 };
  }

  // =========================================================================
  // 4. DOM 元素缓存
  // =========================================================================
  const DOM = {
    // 模式切换
    modeRecursive: document.getElementById('mode-recursive'),
    modeSingle: document.getElementById('mode-single'),

    // 控制
    btnReset: document.getElementById('btn-reset'),
    btnPrev: document.getElementById('btn-prev'),
    btnPlay: document.getElementById('btn-play'),
    btnNext: document.getElementById('btn-next'),
    playIcon: document.getElementById('play-icon'),
    playLabel: document.getElementById('play-label'),
    phaseBadge: document.getElementById('phase-badge'),
    speedBtns: document.querySelectorAll('.speed-btn'),
    presetSelect: document.getElementById('preset-select'),
    btnCustom: document.getElementById('btn-custom'),
    customBar: document.getElementById('custom-input-bar'),
    inputArray: document.getElementById('input-array'),
    btnApplyCustom: document.getElementById('btn-apply-custom'),
    btnRandomData: document.getElementById('btn-random-data'),
    btnCancelCustom: document.getElementById('btn-cancel-custom'),

    // 进度与横幅
    stepCounter: document.getElementById('step-counter'),
    stepDesc: document.getElementById('step-description'),
    progressBarFill: document.getElementById('progress-bar-fill'),
    progressBarContainer: document.getElementById('progress-bar-container'),
    victoryBanner: document.getElementById('victory-banner'),
    victorySummary: document.getElementById('victory-summary'),
    btnReplay: document.getElementById('btn-replay'),
    btnDemoDegenerate: document.getElementById('btn-demo-degenerate'),
    degradeAlert: document.getElementById('degrade-alert'),

    // 数组主舞台
    arrayStage: document.getElementById('array-stage'),
    flightLayer: document.getElementById('flight-layer'),
    indexRow: document.getElementById('index-row'),
    arrayRow: document.getElementById('array-row'),
    pointerTrack: document.getElementById('pointer-track'),
    ptrI: document.getElementById('ptr-i'),
    ptrJ: document.getElementById('ptr-j'),
    ptrMeet: document.getElementById('ptr-meet'),
    liveHint: document.getElementById('status-live-hint'),
    activeRangeBadge: document.getElementById('active-range-badge'),
    activeRangeHint: document.getElementById('active-range-hint'),

    // 递归树
    treeSvgLinks: document.getElementById('tree-svg-links'),
    treeNodesContainer: document.getElementById('tree-nodes-container'),
    treeRootMount: document.getElementById('tree-root-mount'),

    // 调用栈与 HUD
    stackDepth: document.getElementById('stack-depth'),
    stackMaxDepth: document.getElementById('stack-max-depth'),
    stackFramesContainer: document.getElementById('stack-frames-container'),
    hudSortedCount: document.getElementById('hud-sorted-count'),
    hudTotalCount: document.getElementById('hud-total-count'),
    hudPivotBox: document.getElementById('hud-pivot-box'),
    hudPivotVal: document.getElementById('hud-pivot-val'),
    hudPivotRange: document.getElementById('hud-pivot-range'),
    hudHoleIdx: document.getElementById('hud-hole-idx'),
    hudHoleDesc: document.getElementById('hud-hole-desc'),
    hudPtrs: document.getElementById('hud-ptrs'),
    hudPtrsDesc: document.getElementById('hud-ptrs-desc'),
    hudProgressPct: document.getElementById('hud-progress-pct'),
    hudProgressBar: document.getElementById('hud-progress-bar'),

    // 伪代码行
    codeLines: document.querySelectorAll('.code-line')
  };

  // =========================================================================
  // 5. 视图渲染与 DOM 构建
  // =========================================================================

  function buildArrayDOM(arr) {
    DOM.indexRow.innerHTML = '';
    DOM.arrayRow.innerHTML = '';

    arr.forEach((val, idx) => {
      // 索引
      const idxEl = document.createElement('div');
      idxEl.className = 'cell-index-badge';
      idxEl.textContent = `[${idx}]`;
      DOM.indexRow.appendChild(idxEl);

      // 单元格
      const cellEl = document.createElement('div');
      cellEl.id = `cell-${idx}`;
      cellEl.className = 'array-cell cell-state-initial';
      cellEl.innerHTML = `<span class="cell-val">${val}</span>`;
      DOM.arrayRow.appendChild(cellEl);
    });

    updatePointers(null, null, false);
  }

  function updatePointers(idxI, idxJ, isMeet) {
    const trackRect = DOM.pointerTrack.getBoundingClientRect();
    const trackLeft = trackRect.left;

    if (idxI === null) {
      DOM.ptrI.style.opacity = '0';
      DOM.ptrI.style.pointerEvents = 'none';
    } else {
      const targetCellI = document.getElementById(`cell-${idxI}`);
      if (targetCellI && trackRect.width > 0) {
        const cellRect = targetCellI.getBoundingClientRect();
        let targetX = cellRect.left - trackLeft + (cellRect.width - DOM.ptrI.offsetWidth) / 2;
        if (isMeet && idxI === idxJ) {
          targetX -= 26;
        }
        DOM.ptrI.style.opacity = '1';
        DOM.ptrI.style.transform = `translateX(${targetX}px)`;
      }
    }

    if (idxJ === null) {
      DOM.ptrJ.style.opacity = '0';
      DOM.ptrJ.style.pointerEvents = 'none';
    } else {
      const targetCellJ = document.getElementById(`cell-${idxJ}`);
      if (targetCellJ && trackRect.width > 0) {
        const cellRect = targetCellJ.getBoundingClientRect();
        let targetX = cellRect.left - trackLeft + (cellRect.width - DOM.ptrJ.offsetWidth) / 2;
        if (isMeet && idxI === idxJ) {
          targetX += 26;
        }
        DOM.ptrJ.style.opacity = '1';
        DOM.ptrJ.style.transform = `translateX(${targetX}px)`;
      }
    }

    if (isMeet && idxI !== null) {
      const targetCell = document.getElementById(`cell-${idxI}`);
      if (targetCell && trackRect.width > 0) {
        const cellRect = targetCell.getBoundingClientRect();
        const targetX = cellRect.left - trackLeft + (cellRect.width - DOM.ptrMeet.offsetWidth) / 2;
        DOM.ptrMeet.classList.remove('hidden');
        DOM.ptrMeet.style.transform = `translateX(${targetX}px)`;
      }
    } else {
      DOM.ptrMeet.classList.add('hidden');
    }
  }

  // 递归生成树节点 DOM 结构 (Hierarchical Subtree HTML)
  function renderSubtreeHTML(nodeId, allNodes, activeNodeId) {
    const node = allNodes.find(n => n.id === nodeId);
    if (!node) return '';

    const isEmptyRange = (node.low > node.high);
    const isRunning = (node.id === activeNodeId);

    let statusClass = 'tree-node-pending';
    let statusBadge = '待递归';

    if (isRunning) {
      statusClass = 'tree-node-running';
      statusBadge = '⚡ 划分中';
    } else if (node.status === 'completed' || node.status === 'partitioned') {
      statusClass = 'tree-node-completed';
      statusBadge = node.pivot !== null ? `轴点: ${node.pivot}` : '完成';
    } else if (node.status === 'base_case') {
      statusClass = 'tree-node-base';
      statusBadge = isEmptyRange ? 'Ø 空' : '单元有序';
    }

    const label = `QSort(${node.low}, ${node.high})`;
    const subArrStr = isEmptyRange ? 'Ø (0元)' : (node.subArr && node.subArr.length > 0 ? `[${node.subArr.join(',')}]` : '[]');
    const cardEmptyClass = isEmptyRange ? 'tree-node-empty' : '';

    const leftChild = allNodes.find(n => n.parentId === node.id && n.side === 'left');
    const rightChild = allNodes.find(n => n.parentId === node.id && n.side === 'right');
    const hasChildren = Boolean(leftChild || rightChild);

    let childrenHTML = '';
    if (hasChildren) {
      childrenHTML = `
        <div class="tree-children-row">
          <div class="tree-branch-col left-col">
            ${leftChild ? renderSubtreeHTML(leftChild.id, allNodes, activeNodeId) : ''}
          </div>
          <div class="tree-branch-col right-col">
            ${rightChild ? renderSubtreeHTML(rightChild.id, allNodes, activeNodeId) : ''}
          </div>
        </div>
      `;
    }

    return `
      <div class="tree-sub-tree">
        <div class="tree-card-wrapper">
          <div class="tree-node-card ${statusClass} ${cardEmptyClass}" id="treenode-${node.id}" data-id="${node.id}">
            <div class="text-[11px] font-bold text-stone-800">${label}</div>
            <div class="text-[9px] text-stone-500 font-mono my-0.5 truncate max-w-[100px]">${subArrStr}</div>
            <div class="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-white/80 border border-stone-200">${statusBadge}</div>
          </div>
        </div>
        ${childrenHTML}
      </div>
    `;
  }

  // 渲染递归树 (Tree Rendering)
  function renderRecursionTree(treeNodes, activeNodeId) {
    if (!treeNodes || treeNodes.length === 0) {
      const mount = DOM.treeRootMount || DOM.treeNodesContainer;
      mount.innerHTML = '<div class="text-xs text-stone-400 py-8">单趟演练模式下暂不展示递归树</div>';
      DOM.treeSvgLinks.innerHTML = '';
      return;
    }

    const rootNode = treeNodes.find(n => n.parentId === null || n.side === 'root') || treeNodes[0];
    const mount = DOM.treeRootMount || DOM.treeNodesContainer;
    mount.innerHTML = renderSubtreeHTML(rootNode.id, treeNodes, activeNodeId);

    // 绘制连线
    requestAnimationFrame(() => drawTreeLinks(treeNodes, activeNodeId));
  }

  // 绘制递归树中父子节点之间的 SVG 曲线
  function drawTreeLinks(treeNodes, activeNodeId) {
    DOM.treeSvgLinks.innerHTML = '';
    const containerRect = DOM.treeNodesContainer.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) return;

    const w = DOM.treeNodesContainer.scrollWidth || DOM.treeNodesContainer.offsetWidth;
    const h = DOM.treeNodesContainer.scrollHeight || DOM.treeNodesContainer.offsetHeight;

    DOM.treeSvgLinks.setAttribute('width', `${w}`);
    DOM.treeSvgLinks.setAttribute('height', `${h}`);
    DOM.treeSvgLinks.setAttribute('viewBox', `0 0 ${w} ${h}`);

    treeNodes.forEach(node => {
      if (!node.parentId) return;
      const parentEl = document.getElementById(`treenode-${node.parentId}`);
      const childEl = document.getElementById(`treenode-${node.id}`);
      if (!parentEl || !childEl) return;

      const pRect = parentEl.getBoundingClientRect();
      const cRect = childEl.getBoundingClientRect();

      const x1 = pRect.left + pRect.width / 2 - containerRect.left;
      const y1 = pRect.bottom - containerRect.top;
      const x2 = cRect.left + cRect.width / 2 - containerRect.left;
      const y2 = cRect.top - containerRect.top;

      const midY = (y1 + y2) / 2;
      const pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathD);
      path.setAttribute('fill', 'none');

      const isNodeActive = (node.id === activeNodeId);
      if (isNodeActive) {
        path.setAttribute('stroke', '#F59E0B');
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('stroke-dasharray', '5 3');
      } else if (node.status === 'completed' || node.status === 'partitioned') {
        path.setAttribute('stroke', '#10B981');
        path.setAttribute('stroke-width', '1.5');
      } else if (node.status === 'base_case') {
        path.setAttribute('stroke', '#D6D3CD');
        path.setAttribute('stroke-width', '1.5');
      } else {
        path.setAttribute('stroke', '#CBD5E1');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-dasharray', '3 3');
      }
      DOM.treeSvgLinks.appendChild(path);
    });
  }

  // 渲染调用栈 (Call Stack)
  function renderCallStack(callStack) {
    if (!callStack || callStack.length === 0) {
      DOM.stackFramesContainer.innerHTML = '<div class="text-stone-400 text-center py-2">调用栈为空 (栈顶已清空)</div>';
      DOM.stackDepth.textContent = '0';
      return;
    }

    DOM.stackDepth.textContent = callStack.length;

    let html = '';
    callStack.forEach((frame, idx) => {
      const isTop = (idx === callStack.length - 1);
      html += `
        <div class="stack-frame ${isTop ? 'top-active' : ''}">
          <span class="flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full ${isTop ? 'bg-purple-600 animate-pulse' : 'bg-stone-300'}"></span>
            <span>${frame.label}</span>
          </span>
          <span class="text-[10px] text-stone-400">[深度 ${idx + 1}]</span>
        </div>
      `;
    });

    DOM.stackFramesContainer.innerHTML = html;
  }

  // 渲染单步快照
  function renderStep(stepIdx, triggerAnimation = true) {
    if (State.currentTween) {
      State.currentTween.kill();
      State.currentTween = null;
    }
    DOM.flightLayer.innerHTML = '';

    const step = State.steps[stepIdx];
    if (!step) return;

    // 1. 顶部指示与进度
    DOM.stepCounter.textContent = `步骤 ${stepIdx + 1} / ${State.steps.length}`;
    DOM.stepDesc.innerHTML = `<strong class="text-stone-900">${step.stepTitle}:</strong> ${step.description}`;
    DOM.liveHint.textContent = step.liveHint || '';

    // 退化警告横幅控制与徽章联动
    if (step.isDegenerate && DOM.degradeAlert) {
      DOM.degradeAlert.classList.remove('hidden');
      DOM.phaseBadge.textContent = `🚨 递归深度: ${step.callStack.length} 层 (退化最坏 O(n))`;
      DOM.phaseBadge.className = 'font-bold text-rose-700 animate-pulse';
    } else if (DOM.degradeAlert) {
      DOM.degradeAlert.classList.add('hidden');
      DOM.phaseBadge.textContent = State.mode === 'recursive' ? `递归深度: ${step.callStack.length} 层` : '单趟划分演练';
      DOM.phaseBadge.className = 'font-bold text-amber-700';
    }

    if (step.callStack && step.callStack.length >= 4) {
      DOM.stackDepth.className = 'font-bold text-rose-600 animate-pulse';
    } else {
      DOM.stackDepth.className = 'font-bold text-purple-700';
    }

    const pct = ((stepIdx) / (State.steps.length - 1)) * 100;
    DOM.progressBarFill.style.width = `${pct}%`;

    DOM.btnPrev.disabled = (stepIdx === 0);
    DOM.btnNext.disabled = (stepIdx === State.steps.length - 1);

    // 胜利态横幅
    if (step.isVictory) {
      DOM.victoryBanner.classList.remove('hidden');
      DOM.victorySummary.textContent = `全序列已排序为 [${step.array.join(', ')}]，总计经历 ${State.steps.length} 个状态微步骤，递归完全返回！`;
    } else {
      DOM.victoryBanner.classList.add('hidden');
    }

    // 2. 当前活动子区间
    DOM.activeRangeBadge.textContent = `当前区间: A[${step.activeLow}..${step.activeHigh}]`;
    DOM.activeRangeHint.innerHTML = `当前递归处理区间：<strong class="text-indigo-800 font-mono">A[${step.activeLow}..${step.activeHigh}]</strong>，区间外元素淡化或已锁定`;

    // 3. 数组单元格渲染
    step.array.forEach((val, idx) => {
      const cell = document.getElementById(`cell-${idx}`);
      if (!cell) return;

      const stateClass = `cell-state-${step.cellStates[idx]}`;
      cell.className = `array-cell ${stateClass}`;

      // 淡化区间外且非锁定的元素
      if (idx < step.activeLow || idx > step.activeHigh) {
        if (!step.locked[idx] && !step.isVictory) {
          cell.classList.add('cell-dimmed');
        }
      }

      // 已锁定角标
      let lockBadge = cell.querySelector('.cell-lock-badge');
      if (step.locked[idx] || step.isVictory) {
        if (!lockBadge) {
          lockBadge = document.createElement('div');
          lockBadge.className = 'cell-lock-badge';
          lockBadge.textContent = '✓';
          cell.appendChild(lockBadge);
        }
      } else {
        if (lockBadge) lockBadge.remove();
      }

      const valSpan = cell.querySelector('.cell-val');
      if (valSpan) {
        valSpan.textContent = val !== null ? val : '';
      }
    });

    // 4. 指针位置
    updatePointers(step.pointerI, step.pointerJ, step.isMeet || false);

    // 5. 递归树与调用栈
    renderRecursionTree(step.treeNodes, step.activeNodeId);
    renderCallStack(step.callStack);

    // 6. 右侧 HUD 状态
    DOM.hudSortedCount.textContent = step.sortedCount;
    DOM.hudTotalCount.textContent = State.rawArray.length;
    DOM.hudPivotVal.textContent = step.pivotValue !== null ? step.pivotValue : '--';
    DOM.hudPivotRange.textContent = step.pivotValue !== null ? `区间 [${step.activeLow}..${step.activeHigh}]` : '待选定';
    if (DOM.hudPivotBox) {
      if (step.pivotValue !== null) {
        DOM.hudPivotBox.classList.add('border-cyan-400', 'bg-cyan-100/70', 'shadow-xs');
        DOM.hudPivotBox.classList.remove('border-cyan-200', 'bg-cyan-50/60');
      } else {
        DOM.hudPivotBox.classList.remove('border-cyan-400', 'bg-cyan-100/70', 'shadow-xs');
        DOM.hudPivotBox.classList.add('border-cyan-200', 'bg-cyan-50/60');
      }
    }
    DOM.hudHoleIdx.textContent = step.holeIndex !== null ? `[${step.holeIndex}]` : '--';
    DOM.hudHoleDesc.textContent = step.holeIndex !== null ? '当前空缺等待填充' : '无空坑';

    if (step.pointerI !== null && step.pointerJ !== null) {
      DOM.hudPtrs.textContent = `${step.pointerI} / ${step.pointerJ}`;
      DOM.hudPtrsDesc.textContent = `距离差: ${Math.abs(step.pointerJ - step.pointerI)}`;
    } else {
      DOM.hudPtrs.textContent = '-- / --';
      DOM.hudPtrsDesc.textContent = '指针休眠';
    }

    const sortPct = Math.round((step.sortedCount / State.rawArray.length) * 100);
    DOM.hudProgressPct.textContent = `${sortPct}%`;
    DOM.hudProgressBar.style.width = `${sortPct}%`;

    // 7. 伪代码高亮
    DOM.codeLines.forEach(line => line.classList.remove('active'));
    if (step.codeLine) {
      const activeLineEl = document.getElementById(`code-line-${step.codeLine}`);
      if (activeLineEl) activeLineEl.classList.add('active');
    }

    // 8. GSAP 飞渡抛物线动效
    if (triggerAnimation && step.animation && window.gsap) {
      playStepAnimation(step.animation);
    }
  }

  // =========================================================================
  // 6. GSAP 动画执行
  // =========================================================================
  function playStepAnimation(anim) {
    const baseDuration = 0.55 / State.speed;

    if (anim.type === 'fly_cell_to_hole') {
      const srcCell = document.getElementById(`cell-${anim.fromIdx}`);
      const targetCell = document.getElementById(`cell-${anim.toIdx}`);
      if (!srcCell || !targetCell) return;

      const srcRect = srcCell.getBoundingClientRect();
      const targetRect = targetCell.getBoundingClientRect();

      const ghost = document.createElement('div');
      ghost.className = `flying-ghost ${anim.colorClass || 'cell-state-smaller'}`;
      ghost.textContent = anim.val;
      document.body.appendChild(ghost);

      gsap.set(ghost, {
        position: 'fixed',
        left: srcRect.left,
        top: srcRect.top,
        width: srcRect.width,
        height: srcRect.height,
        opacity: 1,
        zIndex: 9999
      });

      State.currentTween = gsap.timeline({
        onComplete: () => {
          ghost.remove();
          State.currentTween = null;
          gsap.fromTo(targetCell, { scale: 1.15 }, { scale: 1, duration: 0.25, ease: 'back.out(2)' });
        }
      });

      const arcHeight = Math.min(75, Math.abs(targetRect.left - srcRect.left) * 0.25 + 35);

      State.currentTween
        .to(ghost, {
          y: -arcHeight,
          scale: 1.12,
          duration: baseDuration * 0.5,
          ease: 'power2.out'
        })
        .to(ghost, {
          left: targetRect.left,
          top: targetRect.top,
          scale: 1,
          duration: baseDuration * 0.5,
          ease: 'bounce.out'
        });

    } else if (anim.type === 'fly_to_monitor') {
      // 基准元素挖出并移下至状态区的 pivot 框
      const srcCell = document.getElementById(`cell-${anim.fromIdx}`);
      const targetBox = DOM.hudPivotBox || (DOM.hudPivotVal ? DOM.hudPivotVal.parentElement : null);
      if (!srcCell || !targetBox) return;

      const srcRect = srcCell.getBoundingClientRect();
      const targetRect = targetBox.getBoundingClientRect();

      const ghost = document.createElement('div');
      ghost.className = 'flying-ghost cell-state-pivot';
      ghost.textContent = anim.val;
      document.body.appendChild(ghost);

      gsap.set(ghost, {
        position: 'fixed',
        left: srcRect.left,
        top: srcRect.top,
        width: srcRect.width,
        height: srcRect.height,
        scale: 1.15,
        opacity: 1,
        zIndex: 9999
      });

      State.currentTween = gsap.timeline({
        onComplete: () => {
          ghost.remove();
          State.currentTween = null;
          gsap.fromTo(targetBox, 
            { scale: 1.2, borderColor: '#00FFFF', boxShadow: '0 0 20px rgba(0, 255, 255, 0.7)' },
            { scale: 1, borderColor: '', boxShadow: '', duration: 0.35, ease: 'power2.out' }
          );
        }
      });

      State.currentTween
        .to(ghost, {
          y: -22,
          scale: 1.15,
          duration: baseDuration * 0.35,
          ease: 'power2.out'
        })
        .to(ghost, {
          left: targetRect.left + (targetRect.width - srcRect.width) / 2,
          top: targetRect.top + (targetRect.height - srcRect.height) / 2,
          y: 0,
          scale: 0.88,
          duration: baseDuration * 0.65,
          ease: 'power2.inOut'
        });

    } else if (anim.type === 'fly_pivot_to_hole') {
      // 基准元素从状态区的 pivot 框飞回数组中相遇的坑位
      const targetCell = document.getElementById(`cell-${anim.toIdx}`);
      const srcBox = DOM.hudPivotBox || (DOM.hudPivotVal ? DOM.hudPivotVal.parentElement : null);
      if (!targetCell) return;

      const targetRect = targetCell.getBoundingClientRect();
      const srcRect = srcBox ? srcBox.getBoundingClientRect() : {
        left: targetRect.left,
        top: targetRect.top + 140,
        width: targetRect.width,
        height: targetRect.height
      };

      const ghost = document.createElement('div');
      ghost.className = 'flying-ghost cell-state-pivot';
      ghost.textContent = anim.val;
      document.body.appendChild(ghost);

      gsap.set(ghost, {
        position: 'fixed',
        left: srcRect.left + (srcRect.width - targetRect.width) / 2,
        top: srcRect.top,
        width: targetRect.width,
        height: targetRect.height,
        scale: 0.88,
        opacity: 1,
        zIndex: 9999
      });

      State.currentTween = gsap.timeline({
        onComplete: () => {
          ghost.remove();
          State.currentTween = null;
          gsap.fromTo(targetCell, { scale: 1.25 }, { scale: 1, duration: 0.35, ease: 'back.out(2)' });
        }
      });

      State.currentTween
        .to(ghost, {
          top: srcRect.top - 25,
          scale: 1.15,
          duration: baseDuration * 0.35,
          ease: 'power2.out'
        })
        .to(ghost, {
          left: targetRect.left,
          top: targetRect.top,
          scale: 1,
          duration: baseDuration * 0.65,
          ease: 'power2.out'
        });
    }
  }

  // =========================================================================
  // 7. 播放控制与单步推进
  // =========================================================================
  function nextStep() {
    if (State.currentStepIdx < State.steps.length - 1) {
      State.currentStepIdx++;
      renderStep(State.currentStepIdx, true);
    } else {
      pause();
    }
  }

  function prevStep() {
    if (State.currentStepIdx > 0) {
      State.currentStepIdx--;
      renderStep(State.currentStepIdx, false);
    }
  }

  function reset() {
    pause();
    State.currentStepIdx = 0;
    renderStep(0, false);
  }

  function togglePlay() {
    if (State.isPlaying) {
      pause();
    } else {
      play();
    }
  }

  function play() {
    if (State.currentStepIdx >= State.steps.length - 1) {
      State.currentStepIdx = 0;
      renderStep(0, false);
    }

    State.isPlaying = true;
    DOM.playIcon.textContent = '❚❚';
    DOM.playLabel.textContent = '暂停';
    DOM.btnPlay.classList.add('bg-amber-700', 'border-amber-700');

    runPlayLoop();
  }

  function runPlayLoop() {
    if (!State.isPlaying) return;

    if (State.currentStepIdx >= State.steps.length - 1) {
      pause();
      return;
    }

    const stepInterval = Math.max(650, 1350 / State.speed);

    State.playTimer = setTimeout(() => {
      if (State.isPlaying) {
        nextStep();
        runPlayLoop();
      }
    }, stepInterval);
  }

  function pause() {
    State.isPlaying = false;
    if (State.playTimer) {
      clearTimeout(State.playTimer);
      State.playTimer = null;
    }
    DOM.playIcon.textContent = '▶';
    DOM.playLabel.textContent = '自动播放';
    DOM.btnPlay.classList.remove('bg-amber-700', 'border-amber-700');
  }

  function jumpToStep(idx) {
    pause();
    State.currentStepIdx = Math.max(0, Math.min(idx, State.steps.length - 1));
    renderStep(State.currentStepIdx, false);
  }

  // =========================================================================
  // 8. 模式切换与数据载入
  // =========================================================================
  function loadArray(newArr) {
    pause();
    State.rawArray = [...newArr];

    if (State.mode === 'recursive') {
      const res = generateFullRecursiveSteps(State.rawArray);
      State.steps = res.steps;
      State.treeNodes = res.treeNodes;
      DOM.stackMaxDepth.textContent = `${res.maxStackDepth}`;
    } else {
      const res = generateSinglePassSteps(State.rawArray);
      State.steps = res.steps;
      State.treeNodes = [];
      DOM.stackMaxDepth.textContent = '1';
    }

    State.currentStepIdx = 0;
    buildArrayDOM(State.rawArray);
    renderStep(0, false);
  }

  function setMode(newMode) {
    if (State.mode === newMode) return;
    State.mode = newMode;

    if (newMode === 'recursive') {
      DOM.modeRecursive.classList.add('active');
      DOM.modeRecursive.classList.remove('text-stone-500');
      DOM.modeSingle.classList.remove('active');
      DOM.modeSingle.classList.add('text-stone-500');
    } else {
      DOM.modeSingle.classList.add('active');
      DOM.modeSingle.classList.remove('text-stone-500');
      DOM.modeRecursive.classList.remove('active');
      DOM.modeRecursive.classList.add('text-stone-500');
    }

    loadArray(State.rawArray);
  }

  // =========================================================================
  // 9. 事件绑定
  // =========================================================================
  function bindEvents() {
    // 模式切换按键
    DOM.modeRecursive.addEventListener('click', () => setMode('recursive'));
    DOM.modeSingle.addEventListener('click', () => setMode('single'));

    // 控制按键
    DOM.btnNext.addEventListener('click', () => {
      pause();
      nextStep();
    });

    DOM.btnPrev.addEventListener('click', () => {
      pause();
      prevStep();
    });

    DOM.btnReset.addEventListener('click', reset);
    DOM.btnPlay.addEventListener('click', togglePlay);
    DOM.btnReplay.addEventListener('click', reset);

    // 速度切换
    DOM.speedBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        DOM.speedBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        State.speed = parseFloat(e.target.getAttribute('data-speed')) || 1.0;
      });
    });

    // 进度条跳转
    DOM.progressBarContainer.addEventListener('click', (e) => {
      const rect = DOM.progressBarContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      const targetIdx = Math.round(pct * (State.steps.length - 1));
      jumpToStep(targetIdx);
    });

    // 预设选择
    DOM.presetSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'custom') {
        DOM.customBar.classList.remove('hidden');
        DOM.inputArray.focus();
      } else if (State.presets[val]) {
        DOM.customBar.classList.add('hidden');
        loadArray(State.presets[val]);
      }
    });

    // 演示有序退化按键快捷切换
    if (DOM.btnDemoDegenerate) {
      DOM.btnDemoDegenerate.addEventListener('click', () => {
        DOM.presetSelect.value = 'sorted';
        State.mode = 'recursive';
        DOM.modeRecursive.classList.add('active');
        DOM.modeRecursive.classList.remove('text-stone-500');
        DOM.modeSingle.classList.remove('active');
        DOM.modeSingle.classList.add('text-stone-500');
        loadArray(State.presets.sorted);
      });
    }

    // 自定义数据
    DOM.btnCustom.addEventListener('click', () => {
      DOM.customBar.classList.toggle('hidden');
      if (!DOM.customBar.classList.contains('hidden')) {
        DOM.inputArray.value = State.rawArray.join(', ');
        DOM.inputArray.focus();
      }
    });

    DOM.btnCancelCustom.addEventListener('click', () => {
      DOM.customBar.classList.add('hidden');
    });

    DOM.btnApplyCustom.addEventListener('click', () => {
      const inputStr = DOM.inputArray.value.trim();
      const parsed = inputStr
        .split(/[,\s，]+/)
        .map(x => parseInt(x, 10))
        .filter(x => !isNaN(x));

      if (parsed.length < 3 || parsed.length > 9) {
        alert('请输入 3 到 9 个整数以获得最佳递归演示效果！');
        return;
      }

      DOM.customBar.classList.add('hidden');
      loadArray(parsed);
    });

    DOM.btnRandomData.addEventListener('click', () => {
      const len = 7;
      const randomArr = [];
      while (randomArr.length < len) {
        const val = Math.floor(Math.random() * 85) + 12;
        if (!randomArr.includes(val)) {
          randomArr.push(val);
        }
      }
      DOM.inputArray.value = randomArr.join(', ');
      loadArray(randomArr);
      DOM.customBar.classList.add('hidden');
    });

    // 快捷键
    window.addEventListener('keydown', (e) => {
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

    // 点击递归树节点跳转至对应执行步
    if (DOM.treeNodesContainer) {
      DOM.treeNodesContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.tree-node-card');
        if (!card) return;
        const nodeId = card.getAttribute('data-id');
        if (!nodeId) return;

        const targetStepIdx = State.steps.findIndex(s => s.activeNodeId === nodeId);
        if (targetStepIdx !== -1) {
          jumpToStep(targetStepIdx);
        }
      });
    }

    // 窗口尺寸适应
    window.addEventListener('resize', () => {
      if (State.steps.length > 0) {
        const step = State.steps[State.currentStepIdx];
        updatePointers(step.pointerI, step.pointerJ, step.isMeet || false);
        if (State.mode === 'recursive') {
          drawTreeLinks(step.treeNodes, step.activeNodeId);
        }
      }
    });
  }

  // =========================================================================
  // 10. 初始化启动
  // =========================================================================
  function init() {
    loadArray(State.rawArray);
    bindEvents();

    if (window.renderMathInElement) {
      renderMathInElement(document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
