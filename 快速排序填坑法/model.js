(function (root) {
  'use strict';

  const PRESETS = {
    classic: [49, 38, 65, 97, 76, 13, 27],
    sorted: [10, 20, 30, 40, 50, 60, 70],
    descending: [70, 60, 50, 40, 30, 20, 10],
    duplicates: [49, 27, 49, 13, 27, 65, 38]
  };

  function parseInput(text) {
    const fail = error => ({ values: null, error });
    if (typeof text !== 'string' || !text.trim()) return fail('请输入1到10个整数');
    const segments = text.trim().split(/[,，]/);
    if (segments.some(segment => !segment.trim())) return fail('逗号之间不能为空');
    const tokens = segments.flatMap(segment => segment.trim().split(/\s+/));
    if (tokens.some(token => !/^-?\d+$/.test(token))) return fail('请输入整数');
    const values = tokens.map(Number);
    if (values.some(value => !Number.isSafeInteger(value) || value < -999 || value > 999)) {
      return fail('整数范围为-999到999');
    }
    if (values.length < 1 || values.length > 10) return fail('请输入1到10个整数');
    return { values, error: '' };
  }

  function buildTrace(values, mode = 'recursive') {
    if (!Array.isArray(values) || values.length < 1 || values.length > 10 ||
        values.some(value => !Number.isInteger(value) || value < -999 || value > 999)) {
      throw new TypeError('values须为1到10个[-999,999]整数');
    }
    if (mode !== 'recursive' && mode !== 'single') throw new TypeError('mode须为recursive或single');

    const initial = {
      cells: values.map((value, index) => ({ id: `v${index}`, value })),
      pivot: null, hole: null, i: null, j: null, range: null, stack: [],
      nodeStates: {}, locked: values.map(() => false), comparisons: 0, moves: 0,
      maxDepth: 0, caption: '准备就绪', phase: '准备就绪'
    };
    let state = initial;
    const events = [];
    const nodes = [];
    let nextNodeId = 0;

    function emit(kind, change, details = {}) {
      const before = JSON.parse(JSON.stringify(state));
      state = JSON.parse(JSON.stringify(state));
      change(state);
      state.caption = details.caption || state.caption;
      state.phase = details.phase || state.phase;
      const event = { kind, before, after: state, focus: details.focus || [] };
      if (details.from !== undefined) event.from = details.from;
      if (details.to !== undefined) event.to = details.to;
      if (details.nodeId !== undefined) event.nodeId = details.nodeId;
      if (details.tag !== undefined) event.tag = details.tag;
      events.push(event);
      return events.length;
    }

    function enter(low, high, parentId, side, depth) {
      const node = { id: `n${nextNodeId++}`, parentId, side, low, high, depth,
        entry: 0, exit: 0, pivotIndex: null, pivotValue: null };
      nodes.push(node);
      node.entry = emit('enter', s => {
        if (parentId !== null) s.nodeStates[parentId] = 'waiting';
        s.stack.push(node.id);
        s.range = [low, high];
        s.pivot = null; s.hole = null; s.i = null; s.j = null;
        s.nodeStates[node.id] = 'active';
        s.maxDepth = Math.max(s.maxDepth, depth);
      }, { nodeId: node.id, focus: low <= high ? [low, high] : [],
        caption: low <= high ? `进入区间[${low},${high}]` : '进入空区间', phase: '递归进入' });
      return node;
    }

    function finishNode(node, parent) {
      node.exit = emit('return', s => {
        s.stack.pop();
        s.nodeStates[node.id] = 'done';
        s.pivot = null; s.hole = null; s.i = null; s.j = null;
        s.range = parent ? [parent.low, parent.high] : null;
        if (parent) s.nodeStates[parent.id] = 'active';
      }, { nodeId: node.id, focus: node.low <= node.high ? [node.low, node.high] : [],
        caption: parent ? '返回父区间' : '根调用返回', phase: '递归返回' });
    }

    function visit(low, high, parent, side, depth) {
      const node = enter(low, high, parent ? parent.id : null, side, depth);
      if (low > high) {
        emit('base', s => { s.nodeStates[node.id] = 'partitioned'; }, {
          nodeId: node.id, caption: '空区间，无需处理', phase: '空区间基例'
        });
        finishNode(node, parent);
        return;
      }
      if (low === high) {
        emit('base', s => {
          s.locked[low] = true;
          s.nodeStates[node.id] = 'partitioned';
        }, { nodeId: node.id, focus: [low], caption: '单元素位置已锁定', phase: '单元素基例' });
        finishNode(node, parent);
        return;
      }

      const pivotToken = state.cells[low];
      emit('lift', s => {
        s.cells[low] = null;
        s.pivot = { id: pivotToken.id, value: pivotToken.value };
        s.hole = low;
        s.i = low; s.j = high;
        s.moves++;
      }, { nodeId: node.id, from: low, to: low, focus: [low], tag: '暂存基准',
        caption: `暂存首元素${pivotToken.value}，形成坑位`, phase: '暂存基准' });

      let hole = low;
      let i = low;
      let j = high;
      while (i < j) {
        const rightValue = state.cells[j].value;
        const rightFits = rightValue >= pivotToken.value;
        emit('compare', s => { s.comparisons++; }, {
          nodeId: node.id, focus: [j], tag: '右比较',
          caption: `${rightValue} ${rightFits ? '>=' : '<'} ${pivotToken.value}`, phase: '比较右侧元素'
        });
        if (rightFits) {
          j--;
          emit('scan', s => { s.j = j; }, { nodeId: node.id, focus: [j + 1, j], tag: 'j左移',
            caption: `右指针左移至${j}`, phase: '右侧扫描' });
          continue;
        }
        const fromRight = state.cells[j];
        emit('fill', s => {
          s.cells[hole] = { id: fromRight.id, value: fromRight.value };
          s.cells[j] = null;
          s.hole = j;
          s.moves++;
        }, { nodeId: node.id, from: j, to: hole, focus: [j, hole], tag: '右填坑',
          caption: `元素${fromRight.value}移入坑位`, phase: '右侧填坑' });
        hole = j;

        while (i < j) {
          const leftValue = state.cells[i].value;
          const leftFits = leftValue <= pivotToken.value;
          emit('compare', s => { s.comparisons++; }, {
            nodeId: node.id, focus: [i], tag: '左比较',
            caption: `${leftValue} ${leftFits ? '<=' : '>'} ${pivotToken.value}`, phase: '比较左侧元素'
          });
          if (leftFits) {
            i++;
            emit('scan', s => { s.i = i; }, { nodeId: node.id, focus: [i - 1, i], tag: 'i右移',
              caption: `左指针右移至${i}`, phase: '左侧扫描' });
            continue;
          }
          const fromLeft = state.cells[i];
          emit('fill', s => {
            s.cells[hole] = { id: fromLeft.id, value: fromLeft.value };
            s.cells[i] = null;
            s.hole = i;
            s.moves++;
          }, { nodeId: node.id, from: i, to: hole, focus: [i, hole], tag: '左填坑',
            caption: `元素${fromLeft.value}移入坑位`, phase: '左侧填坑' });
          hole = i;
          break;
        }
      }

      emit('place', s => {
        s.cells[hole] = { id: s.pivot.id, value: s.pivot.value };
        s.pivot = null; s.hole = null;
        s.locked[hole] = true;
        s.moves++;
        s.nodeStates[node.id] = 'partitioned';
      }, { nodeId: node.id, from: hole, to: hole, focus: [hole], tag: '基准归位',
        caption: `基准${pivotToken.value}归位于${hole}`, phase: '基准归位' });
      node.pivotIndex = hole;
      node.pivotValue = pivotToken.value;

      if (mode === 'single') {
        finishNode(node, null);
        return;
      }

      visit(low, hole - 1, node, 'left', depth + 1);
      visit(hole + 1, high, node, 'right', depth + 1);
      finishNode(node, parent);
    }

    visit(0, values.length - 1, null, 'root', 1);
    if (mode === 'single') {
      const isSingleton = values.length === 1;
      const caption = isSingleton ? '单元素本身有序' : '单次分区完成（未保证全局有序）';
      emit('complete', s => {
        s.caption = caption; s.phase = '单次分区完成';
      }, { caption, phase: '单次分区完成' });
    } else {
      emit('complete', s => {
        s.caption = '排序完成'; s.phase = '排序完成';
      }, { caption: '排序完成', phase: '排序完成' });
    }
    return { initial: JSON.parse(JSON.stringify(initial)), events, nodes, duration: events.length,
      result: state.cells.map(cell => cell.value) };
  }

  const api = { buildTrace, parseInput, PRESETS };
  root.QuickSortModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
