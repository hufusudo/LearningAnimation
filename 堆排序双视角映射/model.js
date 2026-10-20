(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HeapModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_VALUES = [49, 38, 65, 97, 76, 13, 27];

  function buildSequence(values, mode = 'max') {
    if (!Array.isArray(values) || values.length > 15 || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new TypeError('values须为最多15个有限数的数组');
    }
    if (mode !== 'max' && mode !== 'min') throw new TypeError("mode须为'max'或'min'");

    const items = values.map((value, id) => ({ id, value }));
    const order = items.map(item => item.id);
    const n = order.length;
    const state = {
      order: order.slice(), treeSize: 0, heapSize: n, comp: 0, swaps: 0,
      focus: [], selected: null, links: [], phase: 'ready', trio: 0,
      title: '输入序列就绪', message: '先按输入顺序逐个放入树中，再调整成堆', tag: '等待层序建树'
    };
    const events = [];

    const clone = value => JSON.parse(JSON.stringify(value));
    const initial = clone(state);
    function emit(kind, slots, meta, update) {
      const before = clone(state);
      update();
      state.links = slots.filter(slot => slot < state.treeSize).map(slot => state.order[slot]);
      const after = clone(state);
      events.push(Object.assign({ kind, before, after, slots: slots.slice() }, meta || {}));
    }
    function better(a, b) {
      return mode === 'max' ? a > b : a < b;
    }
    function label(id) {
      return String(items[id].value);
    }
    function siftDown(start, phase) {
      let parent = start;
      while (true) {
        const left = parent * 2 + 1;
        if (left >= state.heapSize) break;
        const right = left + 1;
        const kids = right < state.heapSize ? [left, right] : [left];
        let child = left;
        if (kids.length === 2 && better(items[order[right]].value, items[order[left]].value)) child = right;
        emit('select', kids, { parent, child, kids: kids.slice() }, () => {
          state.phase = phase;
          state.focus = kids.slice();
          state.selected = child;
          state.trio = 1;
          state.title = '挑孩子';
          state.tag = kids.length === 2 ? (mode === 'max' ? '较大孩子' : '较小孩子') : '仅左孩子';
          state.message = kids.length === 2
            ? `${label(order[left])} 与 ${label(order[right])} 中选${mode === 'max' ? '较大' : '较小'}者 ${label(order[child])}`
            : `A[${parent}] 仅有左孩子 ${label(order[child])}，无需比较孩子`;
          if (kids.length === 2) state.comp += 1;
        });
        const need = better(items[order[child]].value, items[order[parent]].value);
        emit('judge', [parent, child], { parent, child, need }, () => {
          state.phase = phase;
          state.focus = [parent, child];
          state.selected = child;
          state.trio = 2;
          state.comp += 1;
          state.title = '比父子';
          state.tag = need ? '需要下沉' : '堆序成立';
          state.message = `${label(order[child])} ${mode === 'max' ? '>' : '<'} ${label(order[parent])} ${need ? '成立，父节点需下沉' : '不成立，停止本次下滤'}`;
        });
        if (!need) break;
        emit('swap', [parent, child], { parent, child }, () => {
          [order[parent], order[child]] = [order[child], order[parent]];
          state.order = order.slice();
          state.swaps += 1;
          state.phase = phase;
          state.focus = [child];
          state.selected = null;
          state.trio = 3;
          state.title = '交换下沉';
          state.tag = '下沉一步';
          state.message = `交换槽${parent}与槽${child}，继续向下调整`;
        });
        parent = child;
      }
      if (phase === 'sort' || start === 0) {
        emit('heapReady', [], {}, () => {
          state.phase = phase;
          state.focus = [];
          state.selected = null;
          state.trio = 0;
          state.title = '堆序就绪';
          state.tag = '堆已调整';
          state.message = '当前活动区满足堆序';
        });
      }
    }

    for (let slot = 0; slot < n; slot += 1) {
      emit('place', [slot], { slot }, () => {
        state.treeSize = slot + 1;
        state.phase = 'place';
        state.focus = [slot];
        state.title = `层序放入 A[${slot}]`;
        state.tag = slot === 0 ? '放入根节点' : '按层序放入';
        const parent = Math.floor((slot - 1) / 2);
        state.message = slot === 0 ? `将首项 ${label(order[slot])} 映射到根，数组原值保留`
          : `${label(order[slot])} 放在 A[${parent}] 的${slot % 2 ? '左' : '右'}孩子位置`;
      });
    }
    emit('treeDone', [], {}, () => {
      state.phase = 'place';
      state.focus = [];
      state.title = '层序建树完成';
      state.tag = '尚未调整堆序';
      state.message = '完全二叉树已齐，接下来自底向上调整成堆';
    });

    for (let parent = Math.floor(n / 2) - 1; parent >= 0; parent -= 1) {
      emit('focus', [parent], { parent }, () => {
        state.phase = 'build';
        state.focus = [parent];
        state.selected = null;
        state.trio = 0;
        state.title = '定位父节点';
        state.tag = parent === Math.floor(n / 2) - 1 ? '从这里建堆' : '向前一位';
        state.message = parent === Math.floor(n / 2) - 1
          ? `最后非叶子 i = ⌊${n}/2⌋−1 = ${parent}，从这里建堆`
          : `建堆下标移至 A[${parent}]，调整这棵子树`;
      });
      siftDown(parent, 'build');
    }
    emit('buildDone', [], {}, () => {
      state.phase = 'build';
      state.focus = [];
      state.selected = null;
      state.trio = 0;
      state.title = '建堆完成';
      state.tag = '堆已建立';
      state.message = `调整完成，${mode === 'max' ? '每个父节点不小于孩子' : '每个父节点不大于孩子'}`;
    });
    emit('sortStart', [], {}, () => {
      state.phase = 'sort';
      state.focus = n ? [0] : [];
      state.title = '开始堆排序';
      state.tag = mode === 'max' ? '每轮取最大值' : '每轮取最小值';
      state.message = '每轮交换堆顶与堆尾，缩小活动堆后重新下滤';
    });

    while (state.heapSize > 1) {
      const last = state.heapSize - 1;
      emit('exchange', [0, last], { root: 0, last }, () => {
        [order[0], order[last]] = [order[last], order[0]];
        state.order = order.slice();
        state.swaps += 1;
        state.phase = 'sort';
        state.focus = [0, last];
        state.selected = last;
        state.trio = 0;
        state.title = '移出堆顶';
        state.tag = '交换出堆';
        state.message = `A[0] ↔ A[${last}]，将极值 ${label(order[last])} 送到堆尾`;
      });
      emit('shrink', [last], { last }, () => {
        state.heapSize -= 1;
        state.treeSize = state.heapSize;
        state.phase = 'sort';
        state.focus = [last];
        state.selected = null;
        state.trio = 0;
        state.title = '缩小活动堆';
        state.tag = '尾部锁定';
        state.message = `槽${last}移出活动堆并锁定`;
      });
      if (state.heapSize > 1) siftDown(0, 'sort');
    }

    emit('final', [], {}, () => {
      state.heapSize = 0;
      state.treeSize = 0;
      state.phase = 'done';
      state.focus = [];
      state.selected = null;
      state.trio = 0;
      state.title = '排序完成';
      state.tag = '全部有序';
      state.message = mode === 'max' ? '已按升序完成排序' : '已按降序完成排序';
    });

    return { items, initial, events, duration: events.length };
  }

  return { DEFAULT_VALUES: DEFAULT_VALUES.slice(), buildSequence };
});
