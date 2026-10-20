(function (root) {
  'use strict';

  const PRESETS = [
    { id: 'edge', name: '不稳定边界 [5,8,5,2]', values: [5, 8, 5, 2] },
    { id: 'dup', name: '同值前置 [5,5,3,8]', values: [5, 5, 3, 8] },
    { id: 'classic', name: '教材经典 [49,38,65,97,76,13,27]', values: [49, 38, 65, 97, 76, 13, 27] },
    { id: 'sorted', name: '完全有序 [10,20,30,40,50,60,70]', values: [10, 20, 30, 40, 50, 60, 70] },
    { id: 'desc', name: '完全逆序 [70,60,50,40,30,20,10]', values: [70, 60, 50, 40, 30, 20, 10] }
  ];

  function validate(values) {
    if (!Array.isArray(values) || values.length < 3 || values.length > 8 ||
        values.some(value => !Number.isInteger(value) || value < -999 || value > 999)) {
      throw new Error('请输入3到8个[-999,999]范围内的整数');
    }
  }

  function parseInput(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('请输入3到8个整数');
    const tokens = text.trim().split(/[\s,，;；]+/);
    if (tokens.some(token => !/^[+-]?\d+$/.test(token))) throw new Error('输入中含有非整数项');
    const values = tokens.map(Number);
    validate(values);
    return values;
  }

  function label(item) {
    return item.tag ? `${item.value}_${item.tag}` : String(item.value);
  }

  function inversions(arr) {
    const positions = new Map(arr.map((item, index) => [item.id, index]));
    const out = [];
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      if (arr[a].value === arr[b].value) {
        const low = Math.min(arr[a].id, arr[b].id), high = Math.max(arr[a].id, arr[b].id);
        if (positions.get(low) > positions.get(high)) out.push([low, high]);
      }
    }
    return out;
  }

  function buildSequence(values) {
    validate(values);
    const groups = new Map();
    values.forEach((value, id) => {
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(id);
    });
    const items = values.map((value, id) => {
      const group = groups.get(value);
      return { id, value, tag: group.length > 1 ? String.fromCharCode(65 + group.indexOf(id)) : '' };
    });
    const clone = state => ({ ...state, arr: state.arr.map(item => ({ ...item })) });
    let current = { arr: items.map(item => ({ ...item })), i: null, j: null, min: null,
      sorted: 0, comp: 0, swap: 0, title: '准备就绪', note: '元素按初始位置编号，开始扫描。', tag: '初始' };
    const initial = clone(current), steps = [], boundaries = [0];
    const snapshots = [initial];
    let watch = null;
    function emit(type, change, focus = [], pair = null, title, note, tag) {
      const before = clone(current);
      current = clone(current);
      change(current);
      current.title = title;
      current.note = note;
      current.tag = tag;
      const start = boundaries[boundaries.length - 1], duration = type === 'swap' ? 1.6 : 1, end = start + duration;
      steps.push({ type, before, after: clone(current), start, end, duration, focus: [...focus], pair: pair ? [...pair] : null });
      boundaries.push(end);
      snapshots.push(clone(current));
    }
    const n = items.length;
    for (let i = 0; i < n - 1; i++) {
      emit('focus', s => { s.i = i; s.j = null; s.min = i; }, [i], null, '本趟起点', '先把当前位置作为最小值候选。', '记最小');
      for (let j = i + 1; j < n; j++) {
        const oldMin = current.min;
        const candidate = current.arr[j], minimum = current.arr[oldMin];
        const less = candidate.value < minimum.value, equal = candidate.value === minimum.value;
        const result = less ? '是，下一步更新索引。' : equal ? '否，相等不更新。' : '否，保留最小值索引。';
        emit('compare', s => { s.j = j; s.comp++; }, [j], null, '比较元素', `${label(candidate)} < ${label(minimum)}？${result}`, equal ? '相等不更新' : '元素不动');
        if (less) {
          emit('update', s => { s.min = j; }, [j], null, '更新最小', `min 从 ${oldMin} 改为 ${j}，只记索引，不搬动元素。`, '只记索引');
        }
      }
      const min = current.min;
      if (min !== i) {
        const beforeInv = inversions(current.arr).map(pair => pair.join(':'));
        const swapped = clone(current);
        [swapped.arr[i], swapped.arr[min]] = [swapped.arr[min], swapped.arr[i]];
        const newInversions = inversions(swapped.arr).filter(pair => !beforeInv.includes(pair.join(':')));
        const crossed = newInversions.length > 0;
        emit('swap', s => { [s.arr[i], s.arr[min]] = [s.arr[min], s.arr[i]]; s.swap++; s.min = null; s.j = null; }, [i, min], [i, min], '趟末交换', crossed ? '趟首元素跨过同值身份，相对次序随交换改变。' : '扫描结束，只交换最小值与趟首一次。', crossed ? '同值逆序' : '趟末一次交换');
        if (!watch && crossed) watch = [...newInversions[0]];
      } else {
        emit('skip', () => {}, [i], null, '无需交换', '最小值已在趟首，跳过自交换。', '跳过自换');
      }
      emit('lock', s => { s.sorted = i + 1; s.j = null; s.min = null; }, [i], null, '固化有序', '本趟位置固定，后续不再参与比较。', '位置固化');
    }
    emit('lock', s => { s.sorted = n; s.i = null; s.j = null; s.min = null; }, [n - 1], null, '末项固化', '剩余末项自然就位，不再开启新一趟。', '自然就位');
    const hasDuplicates = groups.size < values.length;
    const finalInverted = inversions(current.arr).length > 0;
    const doneNote = finalInverted ? '数值已排好，同值身份却逆序：这就是不稳定。' : hasDuplicates ? '本例同值未逆序，不意味着算法稳定。' : '本例没有同值元素，无法据此判断稳定性。';
    emit('done', s => { s.i = null; s.j = null; s.min = null; }, [], null, '排序完成', doneNote, '完成');
    if (!watch) {
      for (let a = 0; a < items.length && !watch; a++) for (let b = a + 1; b < items.length; b++) {
        if (items[a].value === items[b].value) { watch = [a, b]; break; }
      }
    }
    const final = current.arr.map(item => ({ ...item }));
    const finalInversions = inversions(final);
    const summary = { n, comp: current.comp, swap: current.swap, hasDuplicates,
      unstable: finalInversions.length > 0,
      everInverted: snapshots.some(state => inversions(state.arr).length > 0), final };
    return { items: items.map(item => ({ ...item })), initial, steps, duration: boundaries[boundaries.length - 1], boundaries, watch, summary };
  }

  const api = { PRESETS, parseInput, buildSequence, label, inversions };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SelectionModel = api;
})(typeof globalThis === 'object' ? globalThis : this);
