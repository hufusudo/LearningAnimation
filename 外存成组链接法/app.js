(function () {
  'use strict';

  const MAX_COUNT = 4;
  const INITIAL = {
    memory: { count: 4, next: 100, free: [101, 102, 103] },
    groups: {
      100: { count: 4, next: 90, free: [91, 92, 93] },
      90: { count: 4, next: 80, free: [81, 82, 83] },
      80: { count: 1, next: null, free: [] }
    },
    occupied: [],
    log: [{
      time: '初始',
      type: 'note',
      text: '初始状态就绪：内存栈 count=4、next=100；外存链为 100 → 90 → 80。'
    }]
  };

  let state = freshState();
  let selectedMode = 'allocate';
  let playbackActive = false;
  let pausedByUser = false;
  let actionLock = false;
  let operationToken = 0;
  let speed = 1;

  const workspace = document.getElementById('workspace');
  const linkLayer = document.getElementById('link-layer');
  const memoryStack = document.getElementById('memory-stack');
  const externalGroups = document.getElementById('external-groups');
  const freePool = document.getElementById('free-pool');
  const occupiedPool = document.getElementById('occupied-pool');
  const operationLog = document.getElementById('operation-log');
  const operationStatus = document.getElementById('operation-status');

  function freshState() {
    return {
      memory: {
        count: INITIAL.memory.count,
        next: INITIAL.memory.next,
        free: INITIAL.memory.free.slice()
      },
      groups: {
        100: { count: 4, next: 90, free: [91, 92, 93] },
        90: { count: 4, next: 80, free: [81, 82, 83] },
        80: { count: 1, next: null, free: [] }
      },
      occupied: [],
      log: INITIAL.log.map(function (entry) {
        return { time: entry.time, type: entry.type, text: entry.text };
      }),
      highlightGroup: null
    };
  }

  function groupChain() {
    const chain = [];
    const visited = new Set();
    let pointer = state.memory.next;
    while (pointer !== null && !visited.has(pointer)) {
      const group = state.groups[pointer];
      if (!group) break;
      visited.add(pointer);
      chain.push({ id: Number(pointer), data: group });
      pointer = group.next;
    }
    return chain;
  }

  function freeBlockNumbers() {
    const blocks = new Set(state.memory.free);
    let pointer = state.memory.next;
    const visited = new Set();
    while (pointer !== null && !visited.has(pointer)) {
      const group = state.groups[pointer];
      if (!group) break;
      visited.add(pointer);
      blocks.add(Number(pointer));
      group.free.forEach(function (number) { blocks.add(number); });
      pointer = group.next;
    }
    return Array.from(blocks).sort(function (a, b) { return a - b; });
  }

  function renderMemory() {
    const memory = state.memory;
    const chips = memory.free.slice().reverse().map(function (number, index) {
      const isTop = index === 0;
      const highlight = state.highlightMemory === number ? ' is-highlighted' : '';
      return '<button class="memory-chip' + (isTop ? ' is-top' : '') + highlight + '" id="memory-chip-' + number +
        '" type="button" data-allocate-id="' + number + '"' + (isTop ? '' : ' disabled') +
        ' aria-label="' + (isTop ? '分配栈顶盘块 ' : '内存栈中的空闲盘块 ') + number + '">' +
        '<span class="slot-caption">' + (isTop ? '栈顶 · 点击分配' : '空闲盘块') + '</span>' +
        '<strong class="slot-number">' + number + '</strong></button>';
    }).join('');

    let nextField;
    const nextText = memory.next === null ? 'null' : String(memory.next);
    if (memory.count === 1 && memory.next !== null) {
      nextField = '<button class="stack-field next-field is-top next-action" id="memory-next-anchor" type="button" data-allocate-id="' +
        memory.next + '" aria-label="换入外存盘块 ' + memory.next + ' 中的下一组">' +
        '<span>次栈底 · next · 点击换组</span><strong class="mono-value">' + nextText + '</strong></button>';
    } else {
      nextField = '<div class="stack-field next-field" id="memory-next-anchor"><span>次栈底 · next</span>' +
        '<strong class="mono-value">' + nextText + '</strong></div>';
    }

    memoryStack.innerHTML =
      '<div class="stack-top-label">[ 栈顶 ]</div>' +
      (chips || '<div class="stack-empty">当前没有直接可弹出的盘块号</div>') +
      nextField +
      '<div class="stack-field count-field"><span>[ 栈底 ]</span><strong>count = ' + memory.count +
      ' <small>/ ' + MAX_COUNT + '</small></strong></div>';

    document.getElementById('memory-summary').innerHTML =
      '<div class="summary-cell"><span>当前 count</span><strong>' + memory.count + ' / ' + MAX_COUNT + '</strong></div>' +
      '<div class="summary-cell"><span>直接可分配</span><strong>' + memory.free.length + ' 块</strong></div>';
  }

  function renderGroups() {
    const chain = groupChain();
    document.getElementById('group-count').textContent = chain.length + ' 组';
    document.getElementById('empty-chain').hidden = chain.length !== 0;
    externalGroups.innerHTML = chain.map(function (item) {
      const id = item.id;
      const group = item.data;
      const freeMarkup = group.free.length
        ? group.free.map(function (number) {
          return '<span class="group-free-chip">' + number + '</span>';
        }).join('')
        : '<span class="group-free-empty">本组没有其他空闲盘块号</span>';
      const nextValue = group.next === null ? 'null' : String(group.next);
      const active = state.highlightGroup === id ? ' is-active' : '';
      return '<article class="group-card' + active + '" id="group-card-' + id + '" data-group-id="' + id + '">' +
        '<div class="group-heading"><h4>盘块号 <span class="group-block-label" id="group-title-' + id + '">' + id +
        '</span></h4><span class="group-storage-tag">本组信息存于此块</span></div>' +
        '<div class="group-fields">' +
          '<div class="group-field"><span>count</span><strong>' + group.count + '</strong></div>' +
          '<div class="group-field next-anchor" id="group-next-' + id + '"><span>next</span><strong>' + nextValue + '</strong></div>' +
        '</div>' +
        '<p class="group-free-label">free =</p>' +
        '<div class="group-free-list">' + freeMarkup + '</div>' +
      '</article>';
    }).join('');
  }

  function renderPools() {
    const free = freeBlockNumbers();
    document.getElementById('free-count').textContent = free.length + ' 块';
    document.getElementById('occupied-count').textContent = state.occupied.length + ' 块';
    freePool.innerHTML = free.length
      ? free.map(function (number) {
        return '<span class="pool-chip" id="free-chip-' + number + '">' + number + '</span>';
      }).join('')
      : '<div class="pool-empty" style="grid-column:1/-1">没有空闲盘块</div>';

    occupiedPool.innerHTML = state.occupied.slice().reverse().map(function (number) {
      return '<button class="occupied-chip" type="button" id="occupied-chip-' + number +
        '" data-reclaim-id="' + number + '" aria-label="回收已占用盘块 ' + number + '">' + number + '</button>';
    }).join('');
    document.getElementById('occupied-empty').hidden = state.occupied.length !== 0;
  }

  function renderLog() {
    document.getElementById('log-count').textContent = state.log.length + ' 条记录';
    operationLog.innerHTML = state.log.slice(0, 36).map(function (entry) {
      return '<li class="log-entry is-' + entry.type + '"><time class="log-time">' + entry.time +
        '</time><span class="log-message">' + entry.text + '</span></li>';
    }).join('');
  }

  function renderControls() {
    document.querySelectorAll('[data-mode]').forEach(function (button) {
      const selected = button.dataset.mode === selectedMode;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.disabled = playbackActive || actionLock;
    });
    document.getElementById('btn-allocate').disabled = playbackActive || actionLock;
    document.getElementById('btn-reclaim').disabled = playbackActive || actionLock;
    document.getElementById('btn-step').disabled = playbackActive || actionLock;
    document.getElementById('btn-play').disabled = playbackActive || actionLock;
    document.getElementById('btn-pause').disabled = !playbackActive;
    document.getElementById('btn-reset').disabled = false;
    document.getElementById('speed').disabled = playbackActive || actionLock;
  }

  function render() {
    renderMemory();
    renderGroups();
    renderPools();
    renderLog();
    renderControls();
    requestAnimationFrame(drawLinks);
  }

  function linkPath(source, target, vertical) {
    if (!source || !target) return '';
    const root = workspace.getBoundingClientRect();
    const a = source.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    let x1;
    let y1;
    let x2;
    let y2;
    let d;

    if (vertical) {
      x1 = a.right - root.left - 2;
      y1 = a.top + a.height / 2 - root.top;
      x2 = b.right - root.left - 2;
      y2 = b.top + Math.min(22, b.height / 2) - root.top;
      const lane = Math.max(x1, x2) + 11;
      d = 'M ' + x1 + ' ' + y1 + ' C ' + lane + ' ' + y1 + ', ' + lane + ' ' + y2 + ', ' + x2 + ' ' + y2;
    } else {
      const forward = b.left >= a.left;
      x1 = (forward ? a.right : a.left) - root.left;
      y1 = a.top + a.height / 2 - root.top;
      x2 = (forward ? b.left : b.right) - root.left;
      y2 = b.top + b.height / 2 - root.top;
      const bend = (x2 - x1) * 0.48;
      d = 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + bend) + ' ' + y1 + ', ' + (x2 - bend) + ' ' + y2 + ', ' + x2 + ' ' + y2;
    }
    return d;
  }

  function drawLinks() {
    const root = workspace.getBoundingClientRect();
    if (!root.width || !root.height) return;
    linkLayer.setAttribute('viewBox', '0 0 ' + root.width + ' ' + root.height);
    const paths = [];
    const chain = groupChain();
    const head = chain.length ? document.getElementById('group-card-' + chain[0].id) : null;
    const memoryNext = document.getElementById('memory-next-anchor');
    if (head && state.memory.next !== null) {
      const vertical = Math.abs(head.getBoundingClientRect().top - memoryNext.getBoundingClientRect().top) >
        Math.abs(head.getBoundingClientRect().left - memoryNext.getBoundingClientRect().left);
      paths.push('<path class="link-path' + (state.highlightLink === Number(state.memory.next) ? ' is-pulsing' : '') +
        '" data-target-group="' + state.memory.next + '" d="' + linkPath(memoryNext, head, vertical) + '"></path>');
    }
    chain.forEach(function (item, index) {
      if (item.data.next === null) return;
      const nextIndex = chain[index + 1];
      if (!nextIndex || nextIndex.id !== item.data.next) return;
      const source = document.getElementById('group-card-' + item.id);
      const target = document.getElementById('group-card-' + nextIndex.id);
      const vertical = Math.abs(target.getBoundingClientRect().top - source.getBoundingClientRect().top) >
        Math.abs(target.getBoundingClientRect().left - source.getBoundingClientRect().left);
      const pointer = document.getElementById('group-next-' + item.id);
      paths.push('<path class="link-path' + (state.highlightLink === nextIndex.id ? ' is-pulsing' : '') +
        '" data-target-group="' + nextIndex.id + '" d="' + linkPath(vertical ? source : pointer, target, vertical) + '"></path>');
    });
    linkLayer.innerHTML =
      '<defs><marker id="arrow-head" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto">' +
      '<path d="M 0 1 L 9 5 L 0 9 z" fill="#7654a6"></path></marker></defs>' + paths.join('');
  }

  function addLog(messages, type) {
    const time = new Date().toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    messages.forEach(function (message) {
      state.log.unshift({ time: time, type: type, text: message });
    });
    state.log = state.log.slice(0, 80);
  }

  function setStatus(message, kind) {
    operationStatus.textContent = message;
    operationStatus.classList.toggle('is-warning', kind === 'warning');
    operationStatus.classList.toggle('is-success', kind === 'success');
  }

  function makePlan(type, targetId) {
    if (type === 'allocate') {
      if (state.memory.count > 1) {
        const id = state.memory.free[state.memory.free.length - 1];
        if (targetId !== undefined && targetId !== id) return null;
        return { kind: 'allocate-pop', id: id };
      }
      if (state.memory.next !== null) {
        const id = state.memory.next;
        if (targetId !== undefined && targetId !== id) return null;
        const group = state.groups[id];
        if (!group) return null;
        return {
          kind: 'allocate-group',
          id: id,
          group: { count: group.count, next: group.next, free: group.free.slice() }
        };
      }
      return null;
    }

    const id = targetId === undefined || targetId === null
      ? state.occupied[state.occupied.length - 1]
      : Number(targetId);
    if (id === undefined || !state.occupied.includes(id)) return null;
    if (state.memory.count < MAX_COUNT) {
      return { kind: 'reclaim-push', id: id };
    }
    const chain = groupChain();
    return {
      kind: 'reclaim-spill',
      id: id,
      chainIds: chain.map(function (item) { return item.id; }),
      tailId: chain.length ? chain[chain.length - 1].id : null,
      memory: {
        count: state.memory.count,
        next: state.memory.next,
        free: state.memory.free.slice()
      }
    };
  }

  function wait(duration) {
    return new Promise(function (resolve) { window.setTimeout(resolve, duration); });
  }

  function flight(source, target, label, token) {
    if (!source || !target) return Promise.resolve();
    const start = source.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'flight-token';
    ghost.textContent = String(label);
    ghost.style.left = start.left + 'px';
    ghost.style.top = start.top + 'px';
    ghost.style.width = Math.max(38, start.width) + 'px';
    ghost.style.height = Math.max(32, start.height) + 'px';
    document.body.appendChild(ghost);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return wait(80).then(function () { ghost.remove(); });
    }

    const dx = (end.left + end.width / 2) - (start.left + start.width / 2);
    const dy = (end.top + Math.min(26, end.height / 2)) - (start.top + start.height / 2);
    const animation = ghost.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(0.82)', opacity: 0.9 }
    ], {
      duration: Math.max(190, 450 / speed),
      easing: 'cubic-bezier(0.22, 0.72, 0.24, 1)',
      fill: 'forwards'
    });
    return animation.finished.catch(function () {}).then(function () {
      if (token !== operationToken) ghost.remove();
      else ghost.remove();
    });
  }

  async function animatePlan(plan, token) {
    const occupiedTarget = document.getElementById('occupied-pool');
    const memoryTarget = document.getElementById('memory-stack');
    const diskTarget = document.getElementById('external-groups');
    const flights = [];
    state.highlightLink = plan.kind === 'allocate-group' ? plan.id : null;
    requestAnimationFrame(drawLinks);

    if (plan.kind === 'allocate-pop') {
      const source = document.getElementById('memory-chip-' + plan.id);
      if (source) source.classList.add('is-highlighted');
      flights.push(flight(source, occupiedTarget, plan.id, token));
      setStatus('高亮栈顶盘块 ' + plan.id + '，准备将它移入已占用池。');
    } else if (plan.kind === 'allocate-group') {
      const source = document.getElementById('group-card-' + plan.id);
      if (source) source.classList.add('is-highlighted');
      flights.push(flight(source, occupiedTarget, plan.id, token));
      flights.push(flight(source, memoryTarget, 'count · next · free', token));
      setStatus('内存只剩 next=' + plan.id + '，读取这张外存组卡片。');
    } else if (plan.kind === 'reclaim-push') {
      const source = document.getElementById('occupied-chip-' + plan.id);
      if (source) source.classList.add('is-highlighted');
      flights.push(flight(source, memoryTarget, plan.id, token));
      setStatus('盘块 ' + plan.id + ' 正从已占用池回到内存栈顶。');
    } else if (plan.kind === 'reclaim-spill') {
      const source = document.getElementById('occupied-chip-' + plan.id);
      source?.classList.add('is-highlighted');
      memoryStack.classList.add('is-highlighted');
      const tailPointer = plan.tailId === null
        ? document.getElementById('memory-next-anchor')
        : document.getElementById('group-next-' + plan.tailId);
      tailPointer?.classList.add('is-highlighted');
      flights.push(flight(source, tailPointer || diskTarget, plan.id, token));
      flights.push(flight(memoryStack, diskTarget, '整组数据', token));
      setStatus(plan.tailId === null
        ? '内存栈已满，正在创建新组 ' + plan.id + '，并让它成为外存链首。'
        : '内存栈已满，正在把新组 ' + plan.id + ' 接到尾组 ' + plan.tailId + ' 之后。');
    }

    await Promise.all(flights);
    if (token !== operationToken) return;
    memoryStack.classList.remove('is-highlighted');
    document.querySelectorAll('.is-highlighted').forEach(function (node) {
      node.classList.remove('is-highlighted');
    });
    state.highlightLink = null;
  }

  function removeOccupied(id) {
    state.occupied = state.occupied.filter(function (number) { return number !== id; });
  }

  function applyPlan(plan) {
    if (plan.kind === 'allocate-pop') {
      state.memory.free.pop();
      state.memory.count -= 1;
      state.occupied.push(plan.id);
      state.highlightMemory = state.memory.free[state.memory.free.length - 1] || null;
      addLog([
        '从内存栈顶分配盘块 ' + plan.id + '，count 减 1（' + (state.memory.count + 1) + ' → ' + state.memory.count + '）。',
        '盘块 ' + plan.id + ' 从空闲池移入已占用池。'
      ], 'allocation');
      setStatus('已分配盘块 ' + plan.id + '。', 'success');
      return;
    }

    if (plan.kind === 'allocate-group') {
      const oldHead = plan.id;
      state.memory = {
        count: plan.group.count,
        next: plan.group.next,
        free: plan.group.free.slice()
      };
      delete state.groups[oldHead];
      state.occupied.push(oldHead);
      state.highlightMemory = state.memory.free[state.memory.free.length - 1] || null;
      addLog([
        '内存栈只剩 next=' + oldHead + '，将外存盘块 ' + oldHead + ' 中的组信息读入内存。',
        '内存栈更新为 count=' + state.memory.count + '、next=' +
          (state.memory.next === null ? 'null' : state.memory.next) + '、free=[' + state.memory.free.join(', ') + ']。',
        '盘块 ' + oldHead + ' 本身已分配，从外存空闲链移除并进入已占用池。'
      ], 'group');
      setStatus('已换入盘块 ' + oldHead + ' 中的下一组；盘块 ' + oldHead + ' 本身已分配。', 'success');
      return;
    }

    if (plan.kind === 'reclaim-push') {
      const oldCount = state.memory.count;
      removeOccupied(plan.id);
      state.memory.free.push(plan.id);
      state.memory.count += 1;
      state.highlightMemory = plan.id;
      addLog([
        '回收盘块 ' + plan.id + '，压入内存栈顶，count 加 1（' + oldCount + ' → ' + state.memory.count + '）。',
        '盘块 ' + plan.id + ' 从已占用池移回空闲盘块池。'
      ], 'reclaim');
      setStatus('已回收盘块 ' + plan.id + '，压入内存栈顶。', 'success');
      return;
    }

    const oldHead = plan.memory.next;
    const oldChain = plan.chainIds;
    const oldTail = plan.tailId;
    removeOccupied(plan.id);
    state.groups[plan.id] = {
      count: plan.memory.count,
      next: null,
      free: plan.memory.free.slice()
    };
    if (oldTail !== null) {
      state.groups[oldTail].next = plan.id;
    }
    state.memory = {
      count: 1,
      next: oldHead === null ? plan.id : oldHead,
      free: []
    };
    state.highlightGroup = plan.id;
    state.highlightLink = plan.id;
    const newChain = oldChain.length ? oldChain.concat([plan.id]) : [plan.id];
    addLog([
      '内存栈已满（count=' + plan.memory.count + '），将当前 count=' + plan.memory.count +
        '、free=[' + plan.memory.free.join(', ') + '] 写入盘块 ' + plan.id + '；新组 next=null。',
      oldTail === null
        ? '原外存链为空，新组 ' + plan.id + ' 成为链首；内存栈清为 count=1、next=' + plan.id + '。'
        : '尾组 ' + oldTail + ' 的 next 从 null 更新为 ' + plan.id + '；内存栈清为 count=1、next=' + oldHead + '，保留原链首入口。',
      '外存链更新为 ' + newChain.join(' → ') + '；回收盘块 ' + plan.id + ' 作为新组存储块进入空闲池。'
    ], 'group');
    setStatus(oldTail === null
      ? '新组 ' + plan.id + ' 已成为外存链首。'
      : '新组 ' + plan.id + ' 已接在尾组 ' + oldTail + ' 之后。', 'success');
    window.setTimeout(function () {
      if (state.highlightGroup === plan.id) {
        state.highlightGroup = null;
        if (state.highlightLink === plan.id) state.highlightLink = null;
        renderGroups();
        requestAnimationFrame(drawLinks);
      }
    }, 850);
  }

  async function performAction(type, targetId, fromPlayback) {
    if (actionLock || (playbackActive && !fromPlayback)) return false;
    const plan = makePlan(type, targetId);
    if (!plan) {
      const message = type === 'allocate' ? '无空闲盘块可分配。' : '没有可回收盘块。';
      addLog([message], 'note');
      setStatus(message, 'warning');
      renderLog();
      renderControls();
      return false;
    }

    actionLock = true;
    const token = operationToken;
    renderControls();
    try {
      await animatePlan(plan, token);
      if (token !== operationToken) return false;
      applyPlan(plan);
      render();
      return true;
    } finally {
      if (token === operationToken) {
        actionLock = false;
        renderControls();
      }
    }
  }

  async function startPlayback() {
    if (playbackActive || actionLock) return;
    playbackActive = true;
    pausedByUser = false;
    const token = operationToken;
    const mode = selectedMode;
    setStatus((mode === 'allocate' ? '自动分配' : '自动回收') + '已开始。');
    renderControls();
    while (playbackActive && token === operationToken) {
      const changed = await performAction(mode, undefined, true);
      if (!changed) break;
      await playbackDelay(Math.max(120, 520 / speed), token);
    }
    if (token === operationToken) {
      playbackActive = false;
      renderControls();
      if (pausedByUser) {
        setStatus('已暂停；当前盘块动画已完成。');
      } else if (!operationStatus.classList.contains('is-warning')) {
        setStatus('自动播放已停止。');
      }
    }
  }

  function playbackDelay(duration, token) {
    return new Promise(function (resolve) {
      const started = Date.now();
      function tick() {
        if (!playbackActive || token !== operationToken || Date.now() - started >= duration) {
          resolve();
          return;
        }
        window.setTimeout(tick, 30);
      }
      tick();
    });
  }

  function pausePlayback() {
    if (!playbackActive) return;
    playbackActive = false;
    pausedByUser = true;
    setStatus('已暂停；当前盘块动画完成后停止。');
    renderControls();
  }

  function reset() {
    operationToken += 1;
    playbackActive = false;
    pausedByUser = false;
    actionLock = false;
    selectedMode = 'allocate';
    state = freshState();
    document.querySelectorAll('.flight-token').forEach(function (node) {
      node.remove();
    });
    document.querySelectorAll('.is-highlighted').forEach(function (node) {
      node.classList.remove('is-highlighted');
    });
    setStatus('系统已恢复到初始状态。', 'success');
    render();
  }

  function selectMode(mode) {
    if (playbackActive || actionLock) return;
    selectedMode = mode;
    renderControls();
  }

  document.addEventListener('click', function (event) {
    const modeButton = event.target.closest('[data-mode]');
    if (modeButton) {
      selectMode(modeButton.dataset.mode);
      return;
    }
    if (event.target.closest('#btn-allocate')) {
      selectedMode = 'allocate';
      renderControls();
      performAction('allocate');
      return;
    }
    if (event.target.closest('#btn-reclaim')) {
      selectedMode = 'reclaim';
      renderControls();
      performAction('reclaim');
      return;
    }
    if (event.target.closest('#btn-step')) {
      performAction(selectedMode);
      return;
    }
    if (event.target.closest('#btn-play')) {
      startPlayback();
      return;
    }
    if (event.target.closest('#btn-pause')) {
      pausePlayback();
      return;
    }
    if (event.target.closest('#btn-reset')) {
      reset();
      return;
    }
    const memoryButton = event.target.closest('[data-allocate-id]');
    if (memoryButton && !memoryButton.disabled) {
      selectedMode = 'allocate';
      renderControls();
      performAction('allocate', Number(memoryButton.dataset.allocateId));
      return;
    }
    const occupiedButton = event.target.closest('[data-reclaim-id]');
    if (occupiedButton) {
      selectedMode = 'reclaim';
      renderControls();
      performAction('reclaim', Number(occupiedButton.dataset.reclaimId));
    }
  });

  document.getElementById('speed').addEventListener('input', function (event) {
    speed = Number(event.target.value);
    document.getElementById('speed-value').textContent = speed + '×';
  });

  window.addEventListener('resize', function () { requestAnimationFrame(drawLinks); });
  if ('ResizeObserver' in window) {
    new ResizeObserver(function () { requestAnimationFrame(drawLinks); }).observe(workspace);
  }
  document.fonts?.ready.then(function () { requestAnimationFrame(drawLinks); });

  render();
  setStatus('就绪。点击内存栈顶可分配，点击已占用盘块可回收。');
})();
