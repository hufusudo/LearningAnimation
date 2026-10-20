(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReplacementModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const PRESETS = {
    textbook: [51, 49, 39, 46, 38, 29, 14, 61, 15, 30, 1, 48, 52, 3, 63, 27, 4, 13, 89, 24, 46, 58, 33, 76],
    nearly_sorted: [12, 15, 23, 28, 35, 18, 42, 49, 53, 60, 58, 67, 73, 80, 75, 88, 92, 95, 30, 34, 45, 50, 55, 62],
    reverse: [99, 91, 85, 78, 70, 65, 59, 52, 47, 41, 36, 30, 25, 20, 15, 11, 8, 5, 3, 2]
  };

  const cloneState = s => ({
    inputIndex: s.inputIndex, active: [...s.active], frozen: [...s.frozen], pending: s.pending,
    runs: s.runs.map(run => [...run]), runIndex: s.runIndex, lastKey: s.lastKey,
    selected: s.selected, comparison: s.comparison, phase: s.phase, message: s.message
  });

  function buildSequence(input, capacity) {
    if (!Array.isArray(input)) throw new TypeError('input must be an array of finite integers');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8) throw new RangeError('capacity must be an integer from 1 to 8');
    if (Array.from(input).some(n => !Number.isFinite(n) || !Number.isInteger(n))) throw new TypeError('input values must be finite integers');
    const values = [...input];
    const tokens = values.map((value, i) => ({ id: `token-${i + 1}`, value }));
    const state = { inputIndex: 0, active: [], frozen: [], pending: null, runs: [[]], runIndex: 0, lastKey: null, selected: null, comparison: null, phase: '就绪', message: '准备读入记录' };
    const initial = cloneState(state), steps = [];
    const phases = { load: '初始装入', swap: '堆调整', ready: '工作区就绪', select: '选择最小', emit: '输出本段', read: '读入新数', compare: '置换判定', activate: '接续本段', freeze: '冻结待用', compact: '收缩活跃堆', close: '本段结束', 'new-run': '开启新段', thaw: '解冻记录', done: '全部完成' };
    const record = (type, label, message, focusIds = [], tokenId) => {
      state.phase = phases[type];
      state.message = message.slice(0, 40);
      const after = cloneState(state);
      const step = { type, label, message: state.message, focusIds: [...focusIds], before: cloneState(steps.length ? steps[steps.length - 1].after : initial), after };
      if (tokenId !== undefined) step.tokenId = tokenId;
      steps.push(step);
    };
    const sift = (start, context) => {
      let i = start;
      while (i < state.active.length && state.active[i]) {
        const l = 2 * i + 1, r = l + 1;
        let smallest = i;
        if (l < state.active.length && state.active[l] && state.active[l].value < state.active[smallest].value) smallest = l;
        if (r < state.active.length && state.active[r] && state.active[r].value < state.active[smallest].value) smallest = r;
        if (smallest === i) break;
        const a = state.active[i], b = state.active[smallest];
        [state.active[i], state.active[smallest]] = [b, a];
        state.selected = null;
        record('swap', '调整小顶堆', `${context}：交换堆中记录`, [a.id, b.id]);
        i = smallest;
      }
    };
    const heapify = context => { for (let i = Math.floor(state.active.length / 2) - 1; i >= 0; i--) sift(i, context); };

    while (state.inputIndex < Math.min(capacity, tokens.length)) {
      const token = tokens[state.inputIndex++];
      state.active.push(token);
      record('load', '读入初始记录', `记录 ${token.value} 进入工作区`, [token.id], token.id);
    }
    heapify('初始建堆');
    record('ready', '初堆完成', tokens.length ? '初始小顶堆已就绪' : '输入为空，准备结束', state.active[0] ? [state.active[0].id] : []);

    while (state.active.some(Boolean) || state.frozen.length || state.inputIndex < tokens.length) {
      if (!state.active.some(Boolean)) {
        record('close', '结束当前归并段', '当前归并段生成完毕');
        state.runs.push([]); state.runIndex++; state.lastKey = null; state.selected = null; state.comparison = null;
        record('new-run', '开启新归并段', '新段开始，基准值重置');
        state.active = state.frozen; state.frozen = [];
        record('thaw', '解冻工作区记录', '冻结记录全部恢复为活跃记录', state.active.filter(Boolean).map(t => t.id));
        heapify('解冻后建堆');
        continue;
      }
      const top = state.active[0];
      state.selected = top.id;
      record('select', '选择堆顶', `选择当前最小记录 ${top.value}`, [top.id], top.id);
      state.runs[state.runIndex].push(top);
      state.active[0] = null;
      state.lastKey = top.value;
      state.selected = null;
      record('emit', '输出堆顶记录', `记录 ${top.value} 输出至当前段`, [top.id], top.id);

      if (state.inputIndex < tokens.length) {
        const incoming = tokens[state.inputIndex++];
        state.pending = incoming;
        state.comparison = null;
        record('read', '读入下一记录', `读入记录 ${incoming.value}`, [incoming.id], incoming.id);
        state.comparison = incoming.value >= state.lastKey ? 'active' : 'frozen';
        record('compare', '比较置换条件', incoming.value >= state.lastKey ? '记录不小于末值，可留本段' : '记录小于末值，冻结至下一段', [incoming.id], incoming.id);
        if (state.comparison === 'active') {
          state.active[0] = incoming; state.pending = null; state.comparison = null;
          record('activate', '记录进入活跃堆', `记录 ${incoming.value} 填入堆顶`, [incoming.id], incoming.id);
          sift(0, '活跃堆调整');
        } else {
          state.frozen.push(incoming); state.pending = null; state.comparison = null;
          record('freeze', '记录进入冻结区', `记录 ${incoming.value} 冻结待下一段`, [incoming.id], incoming.id);
          compact();
        }
      } else compact();
    }
    record('close', '结束当前归并段', tokens.length ? '所有记录均已归并分段' : '空输入，无归并记录');
    record('done', '置换选择完成', '全部归并段已生成');
    return { initial, steps, duration: steps.length, input: values, capacity, tokens, final: cloneState(state) };

    function compact() {
      if (state.active.length > 1) {
        const tail = state.active.pop();
        state.active[0] = tail;
        state.selected = null;
        record('compact', '收缩活跃堆', '堆尾记录移至空出的堆顶', [tail.id], tail.id);
        sift(0, '收缩后堆调整');
      } else if (state.active.length === 1) {
        state.active.pop();
        state.selected = null;
        record('compact', '移除最后记录', '空出的堆槽已移除');
      }
    }
  }
  return { PRESETS, buildSequence };
});
