(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShellModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CASES = {
    classic: {
      name: 'classic',
      items: [
        { id: '49a', value: 49, tag: 'a' }, { id: '38', value: 38, tag: '' },
        { id: '65', value: 65, tag: '' }, { id: '97', value: 97, tag: '' },
        { id: '76', value: 76, tag: '' }, { id: '13', value: 13, tag: '' },
        { id: '27', value: 27, tag: '' }, { id: '49b', value: 49, tag: 'b' }
      ],
      gaps: [4, 2, 1]
    },
    counter: {
      name: 'counter',
      items: [
        { id: '3', value: 3, tag: '' }, { id: '2a', value: 2, tag: 'a' },
        { id: '2b', value: 2, tag: 'b' }, { id: '1', value: 1, tag: '' }
      ],
      gaps: [2, 1]
    }
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  function countInversions(items) {
    const values = items.map(item => typeof item === 'number' ? item : item.value);
    let count = 0;
    for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
      if (values[i] > values[j]) count++;
    }
    return count;
  }
  function buildSequence(caseKey = 'classic') {
    const definition = CASES[caseKey];
    if (!definition) throw new RangeError('Unknown Shell sort case: ' + caseKey);
    const items = clone(definition.items), gaps = definition.gaps.slice();
    const byId = new Map(items.map(item => [item.id, item]));
    const state = {
      slots: items.map(item => item.id), temp: null, tempOrigin: null,
      gap: 0, i: null, j: null, group: null, raised: false, prefixEnd: null,
      comparisons: 0, moves: 0, inversions: countInversions(items), order: 'original',
      phase: '就绪', message: '每次抽起一整组，在上方完成这组的直接插入排序。', completed: false
    };
    const initial = clone(state), steps = [], checkpoints = [];
    let reversalTime = null;
    function emit(kind, details) {
      const before = clone(state);
      const { focus = null, from = null, to = null, label = '', ...updates } = details;
      Object.assign(state, updates);
      steps.push({ kind, before, after: clone(state), focus, from, to, label });
    }
    const aId = items.find(item => item.tag === 'a').id;
    const bId = items.find(item => item.tag === 'b').id;
    const orderOf = slots => slots.indexOf(aId) < slots.indexOf(bId) ? 'original' : 'reversed';
    const nameOf = id => byId.get(id).value + (byId.get(id).tag || '');

    for (const gap of gaps) {
      emit('gap', {
        gap, i: null, j: null, group: null, prefixEnd: null, phase: '切换增量',
        message: '增量 d=' + gap + '，每隔 ' + gap + ' 个位置的元素组成一组。', label: '增量 ' + gap
      });
      // Display whole sublists in turn. Different remainder classes are disjoint,
      // so every pass has the same result as the i++ interleaved implementation.
      for (let group = 0; group < gap; group++) {
        emit('group-select', {
          group, prefixEnd: group, i: null, j: null, phase: '圈定整组',
          message: '圈定余数 ' + group + ' 组，接下来整组一起上升。', label: '圈定整组'
        });
        emit('group-lift', {
          raised: true, phase: '整组上升',
          message: '整组抽到上方；首项已有序，从第二项开始插入。', label: '整组上升'
        });
        for (let i = group + gap; i < items.length; i += gap) {
          let j = i - gap;
          emit('select', {
            i, j, phase: '选待插入项',
            message: '取当前项，插入左侧的组内已排序区。',
            label: '待插入项', focus: state.slots[i]
          });
          const temp = state.slots[i];
          emit('lift', {
            slots: state.slots.map((id, index) => index === i ? null : id),
            temp, tempOrigin: i, phase: '提到暂存',
            message: nameOf(temp) + ' 暂存，空穴留在上方子表中。',
            label: '提到暂存', focus: temp, from: i
          });
          while (j >= group) {
            const leftId = state.slots[j];
            const shouldShift = byId.get(leftId).value > byId.get(temp).value;
            emit('compare', {
              comparisons: state.comparisons + 1, phase: '组内比较',
              message: shouldShift ? nameOf(leftId) + ' > ' + nameOf(temp) + '，已排序区的前项需后移。' : nameOf(leftId) + ' ≤ ' + nameOf(temp) + '，停止后移，准备插入。',
              label: nameOf(leftId) + (shouldShift ? ' > ' : ' ≤ ') + nameOf(temp),
              focus: leftId, from: j, to: j + gap
            });
            if (!shouldShift) break;
            const target = j + gap, nextJ = j - gap;
            const shiftedSlots = state.slots.slice();
            shiftedSlots[target] = leftId; shiftedSlots[j] = null;
            emit('shift', {
              slots: shiftedSlots, moves: state.moves + 1, j: nextJ,
              phase: '组内后移', message: nameOf(leftId) + ' 在组内后移一位，对应原数组跨 ' + gap + ' 格。',
              label: '组内后移一位', focus: leftId, from: j, to: target
            });
            j = nextJ;
          }
          const target = j + gap, insertedSlots = state.slots.slice();
          insertedSlots[target] = temp;
          const order = orderOf(insertedSlots);
          emit('insert', {
            slots: insertedSlots, temp: null, tempOrigin: null, prefixEnd: i,
            moves: state.moves + 1, inversions: countInversions(insertedSlots.map(id => byId.get(id))),
            order, phase: '插入已排序区',
            message: order !== state.order ? 'b 已落在 a 前方：同值次序发生真实逆转。' : nameOf(temp) + ' 插入空穴，组内已排序区扩展一项。',
            label: order !== state.order ? '同值次序逆转' : '已排序区扩展',
            focus: temp, to: target
          });
          if (state.order === 'reversed' && reversalTime === null) reversalTime = steps.length;
        }
        emit('group-lower', {
          raised: false, i: null, j: null, prefixEnd: null, phase: '整组归位',
          message: '这一组已排好，沿原下标映射整组放回数组。', label: '整组归位'
        });
      }
      emit('pass', {
        group: null, phase: '一趟完成',
        message: 'd=' + gap + ' 各组有序，完整阵列仍有 ' + state.inversions + ' 对逆序。', label: '完成一趟'
      });
      checkpoints.push({ gap, time: steps.length, inversions: state.inversions });
    }
    emit('finish', {
      completed: true, phase: '排序完成',
      message: state.order === 'reversed' ? '整体有序，但 b 仍在 a 前：希尔排序不稳定。' : '整体有序；本例未颠倒同值次序，不等于算法稳定。',
      label: state.order === 'reversed' ? '同值次序逆转' : '本例未逆转'
    });
    return { key: caseKey, items, gaps, initial, steps, duration: steps.length, checkpoints, reversalTime };
  }
  return { CASES: clone(CASES), buildSequence, countInversions };
});
