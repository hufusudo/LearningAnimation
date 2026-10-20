(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MergeModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_VALUES = [49, 38, 65, 97, 76, 13, 27, 49];
  const clone = value => JSON.parse(JSON.stringify(value));

  function build(values) {
    if (values === undefined) values = DEFAULT_VALUES;
    if (!Array.isArray(values) || values.length < 1 || values.length > 8 || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new TypeError('values 必须是包含 1..8 个有限数值的数组');
    }

    const frequencies = new Map();
    for (const value of values) frequencies.set(value, (frequencies.get(value) || 0) + 1);
    const occurrence = new Map();
    const cards = values.map((value, id) => {
      const index = occurrence.get(value) || 0;
      occurrence.set(value, index + 1);
      return { id, value, sub: frequencies.get(value) > 1 ? String.fromCharCode(97 + index) : '' };
    });
    const n = cards.length;
    const state = {
      row: cards.map(card => card.id),
      gaps: Array(Math.max(0, n - 1)).fill(8),
      groups: [{ lo: 0, hi: n - 1, ordered: n === 1 }],
      tray: null,
      focus: null,
      heads: { L: null, R: null },
      comparison: '',
      stats: { cmp: 0, mv: 0 },
      phase: '就绪',
      caption: '待将序列逐层分裂，再从底向上归并。'
    };
    const initial = clone(state);
    const events = [];
    let checkpoint = clone(state);

    function emit(kind, fields, phase, caption, duration) {
      const before = checkpoint;
      state.phase = phase;
      state.caption = caption;
      const after = clone(state);
      events.push(Object.assign({ kind, before, after }, fields || {}, { tag: (fields && fields.tag) || '', duration: duration || 1 }));
      checkpoint = clone(after);
    }

    // Split each level from left to right; a cut is placed at the midpoint between cells.
    let level = 1;
    while (state.groups.some(group => group.lo < group.hi)) {
      for (const group of state.groups.slice()) {
        if (group.lo === group.hi) continue;
        const mid = Math.floor((group.lo + group.hi) / 2);
        const depth = level === 1 ? 64 : level === 2 ? 38 : 24;
        state.gaps[mid] = depth;
        const left = { lo: group.lo, hi: mid, ordered: false };
        const right = { lo: mid + 1, hi: group.hi, ordered: false };
        const at = state.groups.indexOf(group);
        state.groups.splice(at, 1, left, right);
        emit('split', { lo: group.lo, mid, hi: group.hi, tag: '对半切分' }, '分裂', `A[${group.lo}..${group.hi}] 在中点裂为两段。`, 1.1);
      }
      level++;
      // loop observes the current, fully split level
      if (state.groups.every(group => group.lo === group.hi)) break;
    }

    if (n > 1) {
      state.groups = state.groups.map(group => ({ lo: group.lo, hi: group.hi, ordered: true }));
      emit('singleton', { tag: '单元素有序' }, '单项有序', '每个单项区间自身有序，开始逐层归并。', 1);
    }

    for (let width = 1; width < n; width *= 2) {
      for (let lo = 0; lo < n; lo += width * 2) {
        const mid = Math.min(lo + width - 1, n - 1);
        const hi = Math.min(lo + width * 2 - 1, n - 1);
        if (mid >= hi) continue;
        const leftGroup = state.groups.find(group => group.lo === lo && group.hi === mid);
        const rightGroup = state.groups.find(group => group.lo === mid + 1 && group.hi === hi);
        if (!leftGroup || !rightGroup) throw new Error('归并区间不连续');

        state.tray = { lo, mid, hi, cards: Array(hi - lo + 1).fill(null) };
        state.focus = { lo, mid, hi };
        let i = lo;
        let j = mid + 1;
        state.heads = { L: i, R: j };
        state.comparison = '';
        emit('prepare', { lo, mid, hi }, '准备归并', `归并 A[${lo}..${mid}] 与 A[${mid + 1}..${hi}]。`, 1.1);

        let slot = 0;
        while (i <= mid && j <= hi) {
          const leftId = state.row[i];
          const rightId = state.row[j];
          const left = cards[leftId];
          const right = cards[rightId];
          const tie = left.value === right.value;
          const winner = left.value <= right.value ? 'L' : 'R';
          state.stats.cmp++;
          state.comparison = `${left.value}${left.sub} ${tie ? '=' : (winner === 'L' ? '<' : '>')} ${right.value}${right.sub}${tie ? ' · 等值取左' : ''}`;
          emit('compare', { lo, mid, hi, winner, tie, tag: tie ? '等值取左' : '' }, '比较', state.comparison, 1);
          const from = winner === 'L' ? i++ : j++;
          const cardId = state.row[from];
          state.row[from] = null;
          state.tray.cards[slot] = cardId;
          state.stats.mv++;
          state.heads = { L: i <= mid ? i : null, R: j <= hi ? j : null };
          state.comparison = '';
          emit('take', { lo, mid, hi, card: cardId, from, slot, winner, tie: false }, '取牌', `将 ${cards[cardId].value}${cards[cardId].sub} 移入托盘第 ${slot + 1} 格。`, 1.1);
          slot++;
        }
        while (i <= mid || j <= hi) {
          const fromSide = i <= mid ? 'L' : 'R';
          const from = fromSide === 'L' ? i++ : j++;
          const cardId = state.row[from];
          state.row[from] = null;
          state.tray.cards[slot] = cardId;
          state.stats.mv++;
          state.heads = { L: i <= mid ? i : null, R: j <= hi ? j : null };
          const tag = fromSide === 'L' ? '右段已空' : '左段已空';
          emit('take', { lo, mid, hi, card: cardId, from, slot, winner: fromSide, tie: false, tag }, '收尾', `${tag}，将剩余牌逐张移入托盘。`, 1.1);
          slot++;
        }

        for (let offset = 0; offset < state.tray.cards.length; offset++) state.row[lo + offset] = state.tray.cards[offset];
        state.tray.cards.fill(null);
        state.heads = { L: null, R: null };
        state.comparison = '';
        emit('lift', { lo, mid, hi, tag: '整体回填' }, '回填', '托盘中的有序牌整体回到原区间。', 1.2);
        for (let gap = lo; gap < hi; gap++) state.gaps[gap] = 8;
        const leftIndex = state.groups.findIndex(group => group.lo === lo && group.hi === mid);
        state.groups.splice(leftIndex, 2, { lo, hi, ordered: true });
        emit('close', { lo, mid, hi, tag: '区间有序' }, '合并完成', `A[${lo}..${hi}] 已有序。`, 1);
        state.tray = null;
        state.focus = null;
        state.heads = { L: null, R: null };
        state.comparison = '';
        emit('release', { lo, mid, hi }, '释放托盘', '托盘与比较焦点收起，准备下一组。', 1);
      }
    }

    emit('done', { tag: '稳定有序' }, '完成', '所有牌已稳定排序。', 1);
    const duration = events.reduce((sum, event) => sum + event.duration, 0);
    return { cards: clone(cards), initial, events, duration };
  }

  return { build };
});
