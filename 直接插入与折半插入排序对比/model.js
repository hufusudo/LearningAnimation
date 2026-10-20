(function (root) {
  'use strict';
  const SAMPLE = [8, 3, 6, 2, 7, 5, 4, 5];

  function makeItems(values) {
    const counts = new Map();
    const seen = new Map();
    values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    return values.map((value, id) => {
      const occurrence = seen.get(value) || 0;
      seen.set(value, occurrence + 1);
      return { id, value, suffix: counts.get(value) > 1 ? String.fromCharCode(97 + occurrence) : '' };
    });
  }
  const text = item => item ? String(item.value) + item.suffix : '空位';

  function buildTrace(items, mode) {
    const array = items.slice();
    const steps = [];
    let state = {
      phase: 'intro', title: '先把第一个数看作有序', copy: '每轮取一个数，插入左侧有序区。',
      cue: '左侧已排序，右侧等待处理', line: 1, pass: 0, i: items.length ? 1 : 0,
      low: null, high: null, mid: null, j: null, temp: null,
      sortedCount: Math.min(1, items.length), comparisons: 0, shifts: 0, completedPasses: 0
    };
    function emit(patch) {
      state = Object.assign({}, state, {
        compareIndex: null, moveFrom: null, moveTo: null, insertIndex: null, focus: null
      }, patch, { array: array.slice() });
      steps.push(state);
    }
    emit({});
    for (let i = 1; i < items.length; i += 1) {
      const temp = array[i];
      array[i] = null;
      emit({ phase: 'take', title: '取出 ' + text(temp) + '，暂存为 temp',
        copy: '保留待插入值，原位置成为空位。', cue: 'A[' + i + '] → temp',
        i, pass: i, temp, low: null, high: null, mid: null, j: null, focus: i,
        line: mode === 'direct' ? 2 : 1 });
      let position;
      if (mode === 'binary') {
        let low = 0;
        let high = i - 1;
        emit({ phase: 'bounds', title: '在左侧有序区中查找', copy: '先圈定闭区间 [low, high]。',
          cue: '查找范围 [0, ' + high + ']', low, high, line: 2 });
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          emit({ phase: 'mid', title: '先把 mid 移到区间中点',
            copy: '中点到位后，再比较它与 temp。',
            cue: 'mid = ⌊(' + low + ' + ' + high + ') / 2⌋ = ' + mid,
            mid, focus: mid, line: 4 });
          const right = array[mid].value <= temp.value;
          const relation = text(array[mid]) + (right ? ' ≤ ' : ' > ') + text(temp);
          emit({ phase: 'locate', title: '比较 A[mid] 与 temp',
            copy: right ? '中点不大于 temp，接下来向右找。' : '中点大于 temp，接下来向左找。',
            cue: relation + (right ? ' · 向右找' : ' · 向左找'),
            compareIndex: mid, focus: mid, comparisons: state.comparisons + 1,
            line: right ? 5 : 6 });
          const old = right ? low : high;
          if (right) low = mid + 1;
          else high = mid - 1;
          emit({ phase: 'narrow', title: right ? 'low 向右移动，排除左半边' : 'high 向左移动，排除右半边',
            copy: right ? '中点及其左侧都应留在 temp 前面。' : '中点及其右侧都比 temp 大。',
            cue: (right ? 'low' : 'high') + ': ' + old + ' → ' + (right ? low : high) +
              (low <= high ? ' · 保留 [' + low + ', ' + high + ']' : ' · 区间为空'),
            low, high, focus: mid, line: right ? 5 : 6 });
        }
        position = low;
        emit({ phase: 'position', title: '区间为空，插入位置已确定',
          copy: 'low > high；插入位置为 low = ' + low + '。',
          cue: 'low > high · 插入 A[' + low + ']', mid: null, insertIndex: low, focus: low, line: 7 });
      } else {
        let j = i - 1;
        while (j >= 0) {
          const shift = array[j].value > temp.value;
          emit({ phase: 'compare', title: '从右往左比较',
            copy: shift ? '当前值比 temp 大，需要向右移。' : '当前值不大于 temp，停止向左查找。',
            cue: text(array[j]) + (shift ? ' > ' : ' ≤ ') + text(temp) + (shift ? ' · 右移' : ' · 在它后面插入'),
            j, compareIndex: j, focus: j, comparisons: state.comparisons + 1, line: 4 });
          if (!shift) break;
          const item = array[j];
          array[j + 1] = item;
          array[j] = null;
          emit({ phase: 'shift', title: '较大的数向右移动一格', copy: '数向右移，空位向左移。',
            cue: text(item) + ': A[' + j + '] → A[' + (j + 1) + ']',
            moveFrom: j, moveTo: j + 1, focus: j, shifts: state.shifts + 1, line: 5 });
          j -= 1;
        }
        position = j + 1;
      }
      if (mode === 'binary') {
        for (let j = i - 1; j >= position; j -= 1) {
          const item = array[j];
          array[j + 1] = item;
          array[j] = null;
          emit({ phase: 'shift', title: '从右往左，逐个腾出空位', copy: '查找已经结束，现在只移动元素。',
            cue: text(item) + ': A[' + j + '] → A[' + (j + 1) + ']',
            moveFrom: j, moveTo: j + 1, insertIndex: position, focus: j,
            shifts: state.shifts + 1, line: 9 });
        }
      }
      array[position] = temp;
      emit({ phase: 'insert', title: '把 temp 放回 A[' + position + ']',
        copy: '落位后，有序区向右扩大一格。', cue: 'temp → A[' + position + '] · 本轮完成',
        temp: null, insertIndex: position, focus: position, sortedCount: i + 1,
        completedPasses: state.completedPasses + 1, line: mode === 'binary' ? 10 : 7 });
    }
    emit({ phase: 'done', title: '所有数都进入有序区', copy: '相同关键字的原有先后顺序保持不变。',
      cue: '排序完成 · ' + array.map(text).join('  '), i: items.length,
      low: null, high: null, mid: null, j: null, line: 0 });
    return steps;
  }
  const api = { SAMPLE, makeItems, text, buildTrace };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InsertionModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
