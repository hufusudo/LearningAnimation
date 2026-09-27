(function () {
  'use strict';

  const SAMPLE = [8, 3, 6, 2, 7, 5, 4, 5];
  const $ = function (id) { return document.getElementById(id); };
  const labels = {
    intro: '先看有序区',
    take: '取出 temp',
    compare: '关键字比较',
    locate: '折半查找',
    position: '确定插入位',
    shift: '元素右移',
    insert: '插入完成',
    done: '排序完成'
  };

  let mode = 'direct';
  let steps = [];
  let currentIndex = 0;
  let timer = null;
  let items = [];
  let tileById = new Map();
  let slots = [];
  let pointerCells = [];
  let duplicateLetters = new Map();

  const nodes = {
    modeSummary: $('mode-summary'),
    roundLabel: $('round-label'),
    stageTitle: $('stage-title'),
    stepCounter: $('step-counter'),
    tempSlot: $('temp-slot'),
    pointerGrid: $('pointer-grid'),
    arrayTrack: $('array-track'),
    indexTrack: $('index-track'),
    regionTrack: $('region-track'),
    actionKind: $('action-kind'),
    actionStep: $('action-step'),
    actionTitle: $('action-title'),
    actionCopy: $('action-copy'),
    decisionNote: $('decision-note'),
    comparisonCount: $('comparison-count'),
    shiftCount: $('shift-count'),
    passCount: $('pass-count'),
    codeList: $('code-list'),
    takeaway: $('takeaway-copy'),
    slider: $('step-slider'),
    timelineLabel: $('timeline-label'),
    timelineTotal: $('timeline-total'),
    previous: $('previous-button'),
    play: $('play-button'),
    next: $('next-button'),
    reset: $('reset-button'),
    speed: $('speed-select')
  };

  function prepareItems(values) {
    const counts = new Map();
    values.forEach(function (value) { counts.set(value, (counts.get(value) || 0) + 1); });
    const seen = new Map();
    duplicateLetters = new Map();
    items = values.map(function (value, id) {
      const letterIndex = seen.get(value) || 0;
      seen.set(value, letterIndex + 1);
      if (counts.get(value) > 1) duplicateLetters.set(id, String.fromCharCode(97 + letterIndex));
      return { id: id, value: value };
    });
  }

  function tokenText(item) {
    if (!item) return '空位';
    const letter = duplicateLetters.get(item.id);
    return String(item.value) + (letter ? letter : '');
  }

  function tokenHtml(item) {
    if (!item) return '';
    const value = document.createElement('span');
    value.className = 'tile-number';
    value.textContent = String(item.value);
    const wrapper = document.createElement('span');
    wrapper.className = 'value-tile';
    wrapper.setAttribute('data-item-id', String(item.id));
    wrapper.appendChild(value);
    const letter = duplicateLetters.get(item.id);
    if (letter) {
      const suffix = document.createElement('small');
      suffix.textContent = letter;
      wrapper.appendChild(suffix);
    }
    return wrapper;
  }

  function record(trace, array, meta, totals) {
    const step = Object.assign({
      phase: 'intro',
      title: '',
      copy: '',
      note: '',
      line: 0,
      pass: 1,
      i: 1,
      j: null,
      low: null,
      high: null,
      mid: null,
      compareIndex: null,
      moveFrom: null,
      moveTo: null,
      insertIndex: null,
      temp: null,
      outcome: null,
      nextLow: null,
      nextHigh: null,
      sortedCount: 1
    }, meta, {
      array: array.slice(),
      comparisons: totals.comparisons,
      shifts: totals.shifts,
      completedPasses: totals.completedPasses
    });
    trace.push(step);
  }

  function buildTrace(inputItems, algorithm) {
    const array = inputItems.slice();
    const trace = [];
    const totals = { comparisons: 0, shifts: 0, completedPasses: 0 };
    const count = array.length;

    record(trace, array, {
      phase: 'intro',
      title: '先把第一个数看作有序',
      copy: '第一个数自然有序。接下来，每一轮都从右边取一个数，插进左侧。',
      note: '本例里 5a、5b 是两个相同的数，用来观察原有顺序是否保留。',
      line: 1,
      pass: 0,
      i: 1,
      sortedCount: 1
    }, totals);

    for (let i = 1; i < count; i += 1) {
      const temp = array[i];
      array[i] = null;

      record(trace, array, {
        phase: 'take',
        title: '把 A[' + i + '] 暂存在 temp',
        copy: '取出 ' + tokenText(temp) + '，先留住这个值；A[' + i + '] 暂时空出来。',
        note: '左边 ' + i + ' 个数已经有序，这一轮只处理索引 i = ' + i + '。',
        line: algorithm === 'direct' ? 2 : 1,
        pass: i,
        i: i,
        temp: temp,
        sortedCount: i
      }, totals);

      if (algorithm === 'direct') {
        let j = i - 1;
        while (j >= 0) {
          const current = array[j];
          const mustShift = current.value > temp.value;
          totals.comparisons += 1;
          record(trace, array, {
            phase: 'compare',
            title: '从右往左比较',
            copy: 'A[' + j + '] = ' + tokenText(current) + (mustShift ? ' 大于 ' : ' 小于或等于 ') + 'temp = ' + tokenText(temp) + '。',
            note: mustShift ? tokenText(current) + ' 比 temp 大，所以要向右移。' : '这里已经不大于 temp；停止扫描，把 temp 放在它后面。',
            line: 4,
            pass: i,
            i: i,
            j: j,
            temp: temp,
            compareIndex: j,
            outcome: mustShift ? 'shift' : 'stop',
            sortedCount: i
          }, totals);

          if (!mustShift) break;
          const from = j;
          array[j + 1] = current;
          array[j] = null;
          totals.shifts += 1;
          j -= 1;
          record(trace, array, {
            phase: 'shift',
            title: '把较大的数向右挪一格',
            copy: '将 ' + tokenText(current) + ' 从 A[' + from + '] 移到 A[' + (from + 1) + ']；空位随之移到左边。',
            note: '每次只挪一个位置，因此插入点左侧的相对顺序不变。',
            line: 5,
            pass: i,
            i: i,
            j: j,
            temp: temp,
            moveFrom: from,
            moveTo: from + 1,
            sortedCount: i
          }, totals);
        }

        const insertAt = j + 1;
        array[insertAt] = temp;
        totals.completedPasses += 1;
        record(trace, array, {
          phase: 'insert',
          title: '把 temp 放进空位',
          copy: '把 temp = ' + tokenText(temp) + ' 放到 A[' + insertAt + ']。这一轮结束，左侧有序区扩大一格。',
          note: '只在左边的数严格大于 temp 时才右移；相等的数不会越过彼此。',
          line: 7,
          pass: i,
          i: i,
          j: j,
          temp: null,
          insertIndex: insertAt,
          sortedCount: i + 1
        }, totals);
      } else {
        let low = 0;
        let high = i - 1;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const current = array[mid];
          const goesBefore = current.value <= temp.value;
          totals.comparisons += 1;
          const nextLow = goesBefore ? mid + 1 : low;
          const nextHigh = goesBefore ? high : mid - 1;
          record(trace, array, {
            phase: 'locate',
            title: '在有序区中点比较',
            copy: '检查 A[' + mid + '] = ' + tokenText(current) + ' 与 temp = ' + tokenText(temp) + '。',
            note: goesBefore
              ? 'A[mid] ≤ temp，插入点还要向右找；low 移到 ' + nextLow + '。'
              : 'A[mid] > temp，插入点在左半边；high 移到 ' + nextHigh + '。',
            line: goesBefore ? 5 : 6,
            pass: i,
            i: i,
            low: low,
            high: high,
            mid: mid,
            temp: temp,
            compareIndex: mid,
            outcome: goesBefore ? 'left-of-or-equal' : 'greater',
            nextLow: nextLow,
            nextHigh: nextHigh,
            sortedCount: i
          }, totals);
          low = nextLow;
          high = nextHigh;
        }

        record(trace, array, {
          phase: 'position',
          title: 'low 指向插入位置',
          copy: '查找区间已经收敛。把 temp 插在 low = ' + low + '，也就是所有不大于它的数之后。',
          note: '使用 A[mid] ≤ temp 时让 low 右移，相同的数会留在 temp 前面。',
          line: 7,
          pass: i,
          i: i,
          low: low,
          high: high,
          temp: temp,
          insertIndex: low,
          sortedCount: i
        }, totals);

        for (let j = i - 1; j >= low; j -= 1) {
          const current = array[j];
          array[j + 1] = current;
          array[j] = null;
          totals.shifts += 1;
          record(trace, array, {
            phase: 'shift',
            title: '把插入点右侧的数逐个后移',
            copy: '将 A[' + j + '] = ' + tokenText(current) + ' 右移到 A[' + (j + 1) + ']。',
            note: '折半查找只更快地找到位置；腾出空位仍要逐个移动元素。',
            line: 9,
            pass: i,
            i: i,
            j: j,
            low: low,
            high: high,
            mid: null,
            temp: temp,
            moveFrom: j,
            moveTo: j + 1,
            insertIndex: low,
            sortedCount: i
          }, totals);
        }

        array[low] = temp;
        totals.completedPasses += 1;
        record(trace, array, {
          phase: 'insert',
          title: '把 temp 放进 low 指向的空位',
          copy: 'A[' + low + '] = temp = ' + tokenText(temp) + '。本轮完成，左侧有序区扩大一格。',
          note: '5a 仍排在 5b 前面；折半定位也保留了相同关键字的原有次序。',
          line: 10,
          pass: i,
          i: i,
          low: low,
          high: high,
          temp: null,
          insertIndex: low,
          sortedCount: i + 1
        }, totals);
      }
    }

    record(trace, array, {
      phase: 'done',
      title: '所有数都进入有序区',
      copy: '从左到右检查，数组已经排好。每一轮都把一个数插进了已排序前缀。',
      note: '有序结果：[' + array.map(tokenText).join(', ') + ']。比较决定插入位置，右移负责腾出位置。',
      line: 0,
      pass: count - 1,
      i: count,
      temp: null,
      sortedCount: count
    }, totals);

    return trace;
  }

  function codeFor(algorithm) {
    if (algorithm === 'binary') {
      return [
        'temp = A[i]',
        'low = 0, high = i - 1',
        'while low <= high',
        '  mid = floor((low + high) / 2)',
        '  if A[mid] <= temp: low = mid + 1',
        '  else: high = mid - 1',
        'position = low',
        'for j = i - 1 down to low',
        '  A[j + 1] = A[j]',
        'A[low] = temp'
      ];
    }
    return [
      'for i = 1 to n - 1',
      '  temp = A[i]',
      '  j = i - 1',
      '  while j >= 0 and A[j] > temp',
      '    A[j + 1] = A[j]',
      '    j = j - 1',
      '  A[j + 1] = temp'
    ];
  }

  function buildStaticBoard() {
    nodes.arrayTrack.style.setProperty('--slot-count', String(items.length));
    nodes.pointerGrid.style.setProperty('--slot-count', String(items.length));
    nodes.indexTrack.style.setProperty('--slot-count', String(items.length));
    nodes.regionTrack.style.setProperty('--slot-count', String(items.length));
    nodes.arrayTrack.replaceChildren();
    nodes.pointerGrid.replaceChildren();
    nodes.indexTrack.replaceChildren();
    nodes.regionTrack.replaceChildren();
    tileById = new Map();
    slots = [];
    pointerCells = [];

    items.forEach(function (item, index) {
      const slot = document.createElement('div');
      slot.className = 'array-slot';
      slot.setAttribute('data-index', String(index));
      slot.setAttribute('aria-label', 'A[' + index + ']');
      nodes.arrayTrack.appendChild(slot);
      slots.push(slot);

      const pointerCell = document.createElement('div');
      pointerCell.className = 'pointer-cell';
      nodes.pointerGrid.appendChild(pointerCell);
      pointerCells.push(pointerCell);

      const indexLabel = document.createElement('span');
      indexLabel.className = 'index-label';
      indexLabel.textContent = String(index);
      nodes.indexTrack.appendChild(indexLabel);

      const tile = tokenHtml(item);
      tileById.set(item.id, tile);
    });
  }

  function renderCode(activeLine) {
    nodes.codeList.replaceChildren();
    codeFor(mode).forEach(function (source, index) {
      const line = document.createElement('span');
      line.className = 'code-line' + (activeLine === index + 1 ? ' is-active' : '');
      const number = document.createElement('span');
      number.className = 'line-number';
      number.textContent = String(index + 1);
      line.appendChild(number);
      line.appendChild(document.createTextNode(source));
      nodes.codeList.appendChild(line);
    });
  }

  function addPointer(index, text, className) {
    if (index === null || index === undefined || index < 0 || index >= pointerCells.length) return;
    const marker = document.createElement('span');
    marker.className = 'pointer ' + className;
    marker.textContent = text;
    pointerCells[index].appendChild(marker);
  }

  function renderPointers(step) {
    pointerCells.forEach(function (cell) { cell.replaceChildren(); });
    if (step.phase === 'done') return;
    addPointer(step.i, 'i', 'pointer-i');
    if (mode === 'direct') {
      if (step.j !== null && step.j !== undefined) addPointer(step.j, 'j', 'pointer-j');
    } else {
      addPointer(step.low, 'low', 'pointer-low');
      addPointer(step.mid, 'mid', 'pointer-mid');
      addPointer(step.high, 'high', 'pointer-high');
    }
  }

  function renderRegions(step) {
    nodes.regionTrack.replaceChildren();
    if (step.sortedCount > 0) {
      const sorted = document.createElement('span');
      sorted.className = 'region-label sorted-label';
      sorted.style.gridColumn = '1 / span ' + step.sortedCount;
      sorted.textContent = '已排序前缀';
      nodes.regionTrack.appendChild(sorted);
    }
    if (step.phase !== 'done' && step.i < items.length) {
      const current = document.createElement('span');
      current.className = 'region-label current-label';
      current.style.gridColumn = String(step.i + 1);
      current.textContent = '本轮';
      nodes.regionTrack.appendChild(current);
      if (step.i + 1 < items.length) {
        const pending = document.createElement('span');
        pending.className = 'region-label pending-label';
        pending.style.gridColumn = (step.i + 2) + ' / span ' + (items.length - step.i - 1);
        pending.textContent = '还未处理';
        nodes.regionTrack.appendChild(pending);
      }
    }
  }

  function movementAnimation(before) {
    if (!window.gsap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    tileById.forEach(function (tile, id) {
      const previous = before.get(id);
      if (!previous || !tile.isConnected) return;
      const next = tile.getBoundingClientRect();
      const dx = previous.left - next.left;
      const dy = previous.top - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      window.gsap.killTweensOf(tile);
      window.gsap.fromTo(tile, { x: dx, y: dy }, {
        x: 0,
        y: 0,
        duration: 0.34,
        ease: 'power2.out',
        overwrite: 'auto',
        clearProps: 'transform'
      });
    });
  }

  function render(index, animate) {
    currentIndex = Math.max(0, Math.min(index, steps.length - 1));
    const step = steps[currentIndex];
    const before = new Map();
    if (animate && window.gsap) {
      tileById.forEach(function (tile, id) {
        if (tile.isConnected) before.set(id, tile.getBoundingClientRect());
      });
    }

    slots.forEach(function (slot, slotIndex) {
      const item = step.array[slotIndex];
      slot.className = 'array-slot';
      if (slotIndex < step.sortedCount) slot.classList.add('is-sorted');
      else slot.classList.add('is-unsorted');
      if (step.compareIndex === slotIndex) slot.classList.add('is-compared');
      if (step.moveFrom === slotIndex) slot.classList.add('is-shift-source');
      if (step.moveTo === slotIndex) slot.classList.add('is-shift-target');
      if (step.phase === 'insert' && step.insertIndex === slotIndex) slot.classList.add('is-inserted');
      slot.replaceChildren();
      if (item) {
        slot.appendChild(tileById.get(item.id));
        slot.setAttribute('aria-label', 'A[' + slotIndex + '] = ' + tokenText(item));
      } else {
        const hole = document.createElement('span');
        hole.className = 'hole-mark';
        hole.textContent = '·';
        slot.appendChild(hole);
        slot.classList.add('is-hole');
        slot.setAttribute('aria-label', 'A[' + slotIndex + '] 是空位');
      }
    });

    nodes.tempSlot.replaceChildren();
    if (step.temp) {
      nodes.tempSlot.appendChild(tileById.get(step.temp.id));
      nodes.tempSlot.setAttribute('aria-label', '暂存 temp = ' + tokenText(step.temp));
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'temp-placeholder';
      placeholder.textContent = '等待取数';
      nodes.tempSlot.appendChild(placeholder);
      nodes.tempSlot.setAttribute('aria-label', '暂存槽为空');
    }

    renderPointers(step);
    renderRegions(step);
    renderCode(step.line);
    if (animate) movementAnimation(before);

    nodes.roundLabel.textContent = step.phase === 'done'
      ? '排序完成'
      : step.phase === 'intro'
        ? '准备 · 第一个数已天然有序'
        : '第 ' + step.pass + ' 轮 · 插入索引 i = ' + step.i;
    nodes.stageTitle.textContent = step.phase === 'done'
      ? '左侧有序区已经覆盖整个数组'
      : step.phase === 'intro'
        ? '先把第一个数看作有序'
        : step.title;
    nodes.stepCounter.textContent = '步骤 ' + (currentIndex + 1) + ' / ' + steps.length;
    nodes.actionKind.textContent = labels[step.phase] || '观察';
    nodes.actionStep.textContent = step.phase === 'done' ? 'n = ' + items.length : (step.i > 0 ? 'i = ' + step.i : '');
    nodes.actionTitle.textContent = step.title;
    nodes.actionCopy.textContent = step.copy;
    nodes.decisionNote.textContent = step.note;
    nodes.decisionNote.hidden = !step.note;
    nodes.comparisonCount.textContent = String(step.comparisons);
    nodes.shiftCount.textContent = String(step.shifts);
    nodes.passCount.textContent = String(step.completedPasses);
    nodes.slider.max = String(steps.length - 1);
    nodes.slider.value = String(currentIndex);
    nodes.timelineLabel.textContent = '第 ' + (currentIndex + 1) + ' 步';
    nodes.timelineTotal.textContent = '共 ' + steps.length + ' 步';
    nodes.previous.disabled = currentIndex === 0;
    nodes.next.disabled = currentIndex === steps.length - 1;

    const arrayText = step.array.map(function (item, slotIndex) {
      return item ? 'A[' + slotIndex + '] ' + tokenText(item) : 'A[' + slotIndex + '] 空位';
    }).join('，');
    nodes.arrayTrack.setAttribute('aria-label', '当前数组：' + arrayText);
    updatePlayButton();
  }

  function updatePlayButton() {
    const playing = timer !== null;
    nodes.play.innerHTML = playing
      ? 'Ⅱ <span>暂停</span>'
      : '▶ <span>自动演示</span>';
    nodes.play.setAttribute('aria-label', playing ? '暂停自动演示' : '自动演示');
  }

  function stopPlayback() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    updatePlayButton();
  }

  function advancePlayback() {
    if (currentIndex >= steps.length - 1) {
      stopPlayback();
      return;
    }
    render(currentIndex + 1, true);
    if (currentIndex >= steps.length - 1) stopPlayback();
  }

  function startPlayback() {
    if (timer !== null) {
      stopPlayback();
      return;
    }
    if (currentIndex >= steps.length - 1) render(0, false);
    timer = window.setInterval(advancePlayback, Number(nodes.speed.value));
    updatePlayButton();
  }

  function updateSummary() {
    const comparisonText = mode === 'direct'
      ? '从 i 左边的数开始逐个向左找位置；每发现一个较大的数，就把它右移一格。'
      : '先用二分法找插入点，再把右侧的数逐个后移；查找更快，移动过程相同。';
    nodes.modeSummary.textContent = comparisonText + ' 示例数组中有两个相同的 5（5a、5b），可以顺便检查它们的先后顺序。';

    const directTrace = buildTrace(items, 'direct');
    const directFinal = directTrace[directTrace.length - 1];
    const binaryTrace = buildTrace(items, 'binary');
    const binaryFinal = binaryTrace[binaryTrace.length - 1];
    nodes.takeaway.textContent = mode === 'direct'
      ? '本例的直接插入：比较 ' + directFinal.comparisons + ' 次，右移 ' + directFinal.shifts + ' 次。遇到相等的数就停下，因此 5a 仍在 5b 前面。'
      : '同一组数中，折半插入比较 ' + binaryFinal.comparisons + ' 次（直接插入 ' + directFinal.comparisons + ' 次）；两者都右移 ' + binaryFinal.shifts + ' 次。二分省比较，不省移动。';
  }

  function rebuild(nextMode) {
    stopPlayback();
    mode = nextMode;
    steps = buildTrace(items, mode);
    currentIndex = 0;
    document.querySelectorAll('.mode-button').forEach(function (button) {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    updateSummary();
    render(0, false);
  }

  prepareItems(SAMPLE);
  buildStaticBoard();
  document.querySelectorAll('.mode-button').forEach(function (button) {
    button.addEventListener('click', function () { rebuild(button.dataset.mode); });
  });
  nodes.previous.addEventListener('click', function () {
    stopPlayback();
    render(currentIndex - 1, true);
  });
  nodes.next.addEventListener('click', function () {
    stopPlayback();
    render(currentIndex + 1, true);
  });
  nodes.play.addEventListener('click', startPlayback);
  nodes.reset.addEventListener('click', function () {
    stopPlayback();
    render(0, false);
  });
  nodes.slider.addEventListener('input', function () {
    stopPlayback();
    render(Number(nodes.slider.value), true);
  });
  nodes.speed.addEventListener('change', function () {
    if (timer !== null) {
      stopPlayback();
      startPlayback();
    }
  });
  document.addEventListener('keydown', function (event) {
    const target = event.target;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'select' || tag === 'button' || tag === 'textarea') return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stopPlayback();
      render(currentIndex - 1, true);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      stopPlayback();
      render(currentIndex + 1, true);
    } else if (event.code === 'Space' && tag !== 'a') {
      event.preventDefault();
      startPlayback();
    }
  });

  rebuild('direct');
})();
