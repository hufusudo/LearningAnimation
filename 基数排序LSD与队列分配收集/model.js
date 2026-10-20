(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RadixModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PRESETS = {
    classic: [278, 109, 63, 930, 589, 184, 505, 269],
    reverse: [982, 874, 763, 651, 540, 439, 328, 217],
    conflict: [524, 124, 524, 324, 124, 24, 624, 424]
  };

  function validateNumbers(numbers) {
    if (!Array.isArray(numbers) || numbers.length !== 8 ||
        numbers.some(value => !Number.isInteger(value) || value < 0 || value > 999)) {
      throw new Error('请输入恰好 8 个 0–999 的整数，不使用负数或小数。');
    }
  }

  function parseInput(text) {
    if (typeof text !== 'string') throw new Error('请以逗号或空格分隔 8 个整数。');
    const trimmed = text.trim();
    if (!trimmed) throw new Error('请输入恰好 8 个 0–999 的整数。');
    const parts = trimmed.split(/[，,\s]+/);
    if (parts.length !== 8 || parts.some(part => !/^\d+$/.test(part))) {
      throw new Error('请输入恰好 8 个 0–999 的整数，以逗号或空格分隔。');
    }
    const numbers = parts.map(Number);
    validateNumbers(numbers);
    return numbers;
  }

  function cloneState(state) {
    return {
      belt: state.belt.slice(),
      buckets: state.buckets.map(bucket => bucket.slice()),
      pass: state.pass,
      phase: state.phase,
      processed: state.processed,
      complete: state.complete
    };
  }

  function build(numbers) {
    validateNumbers(numbers);
    const items = numbers.map((value, id) => {
      const str = String(value).padStart(3, '0');
      return {
        id,
        value,
        str,
        tag: String.fromCharCode(65 + id),
        digits: [Number(str[2]), Number(str[1]), Number(str[0])]
      };
    });

    let state = {
      belt: items.map(item => item.id),
      buckets: Array.from({ length: 10 }, () => []),
      pass: 0,
      phase: 'ready',
      processed: 0,
      complete: false
    };
    const initial = cloneState(state);
    const steps = [];
    const rounds = [];

    function addStep(fields, nextState) {
      const before = cloneState(state);
      state = nextState;
      steps.push({
        kind: fields.kind,
        pass: fields.pass,
        item: fields.item,
        bucket: fields.bucket,
        index: fields.index,
        before,
        after: cloneState(state),
        text: fields.text
      });
    }

    for (let pass = 0; pass < 3; pass++) {
      const start = steps.length;
      addStep({
        kind: 'digit', pass, item: null, bucket: null, index: null,
        text: `第 ${pass + 1} 轮：只看${['个位', '十位', '百位'][pass]}，依序入队以保留已有次序。`
      }, { ...state, pass, phase: 'distribute', processed: 0 });

      for (let index = 0; index < 8; index++) {
        const item = state.belt[index];
        if (item === null) continue;
        const bucket = items[item].digits[pass];
        const belt = state.belt.slice();
        const buckets = state.buckets.map(queue => queue.slice());
        buckets[bucket].push(item);
        belt[index] = null;
        addStep({
          kind: 'distribute', pass, item, bucket, index,
          text: `${items[item].str}·${items[item].tag} 的${['个位', '十位', '百位'][pass]}为 ${bucket}，加入 ${bucket} 桶队尾。`
        }, { ...state, belt, buckets, phase: 'distribute', processed: state.processed + 1 });
      }
      const distributed = steps.length;

      addStep({
        kind: 'digit', pass, item: null, bucket: null, index: null,
        text: '按 0 → 9 扫描队列，每桶都从队头开始收集。'
      }, { ...state, phase: 'collect', processed: 0 });

      let index = 0;
      for (let bucket = 0; bucket < 10; bucket++) {
        while (state.buckets[bucket].length > 0) {
          const buckets = state.buckets.map(queue => queue.slice());
          const item = buckets[bucket].shift();
          const belt = state.belt.slice();
          belt[index] = item;
          addStep({
            kind: 'collect', pass, item, bucket, index,
            text: `${bucket} 桶队头 ${items[item].str}·${items[item].tag} 先出，放回序列 [${index}]。`
          }, { ...state, belt, buckets, phase: 'collect', processed: state.processed + 1 });
          index++;
        }
      }
      rounds.push({ pass, start, distributed, end: steps.length, order: state.belt.slice() });
    }

    addStep({
      kind: 'finish', pass: 2, item: null, bucket: null, index: null,
      text: '三轮完成：数值升序，相同数值的字母仍保持原始顺序。'
    }, { ...state, phase: 'done', complete: true });

    return {
      items,
      initial,
      steps,
      rounds,
      result: state.belt.map(id => items[id])
    };
  }

  return { PRESETS, build, parseInput };
});
