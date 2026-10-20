(function () {
  'use strict';
  const { SAMPLE, makeItems, text, buildTrace } = window.InsertionModel;
  const { sample, textView } = window.InsertionChoreo;
  const $ = id => document.getElementById(id);
  const items = makeItems(SAMPLE);
  const clock = { t: 0 };
  const BEAT = 1.15;
  const labels = { intro: '准备', take: '取数', bounds: '圈定区间', mid: '中点定位', locate: '比较',
    narrow: '移动边界', position: '确定位置', compare: '比较', shift: '右移', insert: '落位', done: '完成' };
  const colors = { sorted: [221, 239, 227], pending: [242, 241, 237], blue: [234, 240, 254], green: [202, 232, 213] };
  let mode = 'direct';
  let steps = [];
  let timeline = null;
  let reducedCall = null;
  let running = false;
  let target = null;
  let direction = 1;
  let geometry;
  const tiles = new Map();
  const slots = [];
  const markers = {};
  const scene = $('sort-scene');
  const track = $('array-track');
  const pointerGrid = $('pointer-grid');
  const regionTrack = $('region-track');
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduce = $('reduce-motion');
  reduce.checked = motionQuery.matches;

  function setText(node, value) {
    const next = String(value);
    if (node.textContent !== next) node.textContent = next;
  }
  function showText(node, view) {
    setText(node, view.text);
    node.style.opacity = view.alpha;
  }
  function div(className, parent, content) {
    const node = document.createElement('div');
    node.className = className;
    if (content !== undefined) node.textContent = content;
    parent.appendChild(node);
    return node;
  }
  const sortedBand = div('zone-band sorted-band', track);
  const pendingBand = div('zone-band pending-band', track);
  const searchRange = div('search-range', track);
  const sortedLabel = div('region-label sorted-label', regionTrack);
  const pendingLabel = div('region-label pending-label', regionTrack);
  const borderLabel = div('region-boundary', regionTrack, '有序区边界');
  const placeholder = $('temp-slot').firstElementChild;
  const codeLines = [];

  function codeFor() {
    return mode === 'binary' ? [
      'temp = A[i]', 'low = 0, high = i - 1', 'while low <= high',
      '  mid = floor((low + high) / 2)', '  if A[mid] <= temp: low = mid + 1',
      '  else: high = mid - 1', 'position = low', 'for j = i - 1 down to low',
      '  A[j + 1] = A[j]', 'A[low] = temp'
    ] : [
      'for i = 1 to n - 1', '  temp = A[i]', '  j = i - 1',
      '  while j >= 0 and A[j] > temp', '    A[j + 1] = A[j]', '    j = j - 1', '  A[j + 1] = temp'
    ];
  }
  function buildCode() {
    $('code-list').replaceChildren();
    codeLines.length = 0;
    codeFor().forEach((source, index) => {
      const line = div('code-line', $('code-list'));
      const number = document.createElement('span');
      number.className = 'line-number';
      number.textContent = index + 1;
      line.append(number, document.createTextNode(source));
      codeLines.push(line);
    });
  }
  items.forEach((item, index) => {
    const slot = div('array-slot', track);
    slot.dataset.index = index;
    div('hole-mark', slot, '空位');
    div('excluded-mark', slot);
    slots.push(slot);
    div('index-label', $('index-track'), index);
    const tile = div('value-tile', $('tile-layer'));
    tile.dataset.itemId = item.id;
    div('tile-number', tile, item.value);
    if (item.suffix) {
      const suffix = document.createElement('small');
      suffix.textContent = item.suffix;
      tile.appendChild(suffix);
    }
    tiles.set(item.id, tile);
  });
  ['low', 'high', 'mid', 'i', 'j'].forEach(name => {
    const marker = div('pointer pointer-' + name, pointerGrid);
    const label = document.createElement('span');
    label.textContent = name;
    const value = document.createElement('b');
    marker.append(label, value);
    const guide = div('pointer-guide guide-' + name, pointerGrid);
    markers[name] = { marker, value, guide };
  });

  function measure() {
    const base = scene.getBoundingClientRect();
    const first = slots[0].getBoundingClientRect();
    const second = slots[1].getBoundingClientRect();
    const temp = $('temp-slot').getBoundingClientRect();
    const array = track.getBoundingClientRect();
    $('scroll-hint').hidden = scene.scrollWidth <= $('sort-viewport').clientWidth + 1;
    geometry = {
      first: first.left + first.width / 2 - base.left,
      stride: second.left - first.left,
      tileY: first.top + first.height / 2 - base.top,
      tempX: temp.left + temp.width / 2 - base.left,
      tempY: temp.top + temp.height / 2 - base.top,
      width: first.width,
      pointerX: pointerGrid.getBoundingClientRect().left - base.left,
      arrayY: array.top - base.top
    };
    render();
  }
  function mix(a, b, p) { return a.map((value, index) => value + (b[index] - value) * p); }
  function rgb(a) { return 'rgb(' + a.map(Math.round).join(',') + ')'; }
  function band(node, x, width, alpha = 1) {
    node.style.transform = 'translateX(' + x + 'px) scaleX(' + Math.max(0, width) + ')';
    node.style.opacity = alpha;
  }
  function render() {
    if (!geometry || !steps.length) return;
    const view = sample(steps, clock.t);
    const g = geometry;
    const st = view.state;
    const boundary = view.sortedCount * g.stride - (g.stride - g.width) / 2;
    band(sortedBand, -5, boundary + 5);
    band(pendingBand, boundary + 3, track.clientWidth - boundary + 2);
    const rangeLeft = view.range.left * g.stride - 3;
    const rangeWidth = Math.max(0, (view.range.right - view.range.left) * g.stride - (g.stride - g.width) + 6);
    searchRange.style.transform = 'translateX(' + rangeLeft + 'px)';
    searchRange.style.width = rangeWidth + 'px';
    searchRange.style.opacity = view.range.alpha * (rangeWidth > 0 ? 1 : 0);
    view.tiles.forEach(item => {
      const tile = tiles.get(item.id);
      const x = g.first + item.x * g.stride + item.temp * (g.tempX - g.first);
      const y = g.tileY + item.temp * (g.tempY - g.tileY);
      tile.style.transform = 'translate(' + x + 'px,' + y + 'px) translate(-50%, -50%)';
      tile.style.zIndex = item.temp > 0 && item.temp < 1 ? '5' : '2';
      tile.style.borderColor = item.temp > 0.5 ? '#BD8735' : '#B6C2B6';
    });
    view.slots.forEach((state, index) => {
      const slot = slots[index];
      let color = mix(colors.pending, colors.sorted, state.sorted);
      color = mix(color, colors.blue, state.compared);
      color = mix(color, colors.green, state.inserted);
      slot.style.backgroundColor = rgb(color);
      slot.style.borderColor = state.compared > 0.1 ? '#2563EB' : state.sorted > 0.5 ? '#82B698' : '#C7C7BD';
      slot.style.boxShadow = '0 0 0 ' + (3 * state.focus) + 'px rgba(37,99,235,' + (0.32 * state.focus) + ')';
      slot.firstElementChild.style.opacity = state.hole;
      slot.lastElementChild.style.opacity = state.excluded * 0.75;
      const item = st.array[index];
      slot.setAttribute('aria-label', 'A[' + index + '] ' + text(item));
    });
    const index = Math.min(Math.floor(clock.t), steps.length - 2);
    const before = steps[index];
    const after = steps[index + 1];
    const progress = clock.t - index;
    Object.keys(markers).forEach(name => {
      const { marker, value, guide } = markers[name];
      const pointer = view.pointers[name];
      const visible = mode === 'binary' ? name !== 'j' : !['low', 'high', 'mid'].includes(name);
      // Outside boundaries stay in the left/right gutter and retain their actual value.
      const x = Math.max(25, Math.min(pointerGrid.clientWidth - 25, g.first - g.pointerX + pointer.index * g.stride));
      marker.style.transform = 'translateX(' + x + 'px) translateX(-50%)';
      marker.style.opacity = visible ? pointer.alpha : 0;
      marker.style.visibility = visible && pointer.alpha > 0 ? 'visible' : 'hidden';
      marker.classList.toggle('is-outside', pointer.index < 0 || pointer.index >= items.length);
      guide.style.transform = 'translateX(' + x + 'px)';
      guide.style.opacity = visible ? pointer.alpha * 0.25 : 0;
      const a = before[name] == null ? after[name] : before[name];
      const b = after[name] == null ? before[name] : after[name];
      showText(value, textView(String(a), String(b), progress, 0.52, 0.78));
    });
    const count = Math.round(view.sortedCount);
    showText(sortedLabel, textView('已排序区\n' + before.sortedCount + ' 格', '已排序区\n' + after.sortedCount + ' 格', progress, 0.72, 0.96));
    sortedLabel.style.width = Math.max(58, boundary) + 'px';
    pendingLabel.style.left = boundary + 10 + 'px';
    const pendingText = textView('未处理\n' + (items.length - before.sortedCount) + ' 格', '未处理\n' + (items.length - after.sortedCount) + ' 格', progress, 0.72, 0.96);
    showText(pendingLabel, pendingText);
    if (count === items.length) pendingLabel.style.opacity = 0;
    borderLabel.style.transform = 'translateX(' + Math.min(boundary, track.clientWidth - 65) + 'px)';
    borderLabel.style.opacity = count < items.length ? 1 : 0;
    const tempAlpha = view.tiles.reduce((sum, item) => sum + item.temp, 0);
    placeholder.style.opacity = 1 - tempAlpha;
    $('temp-slot').setAttribute('aria-label', st.temp ? '暂存 temp = ' + text(st.temp) : '暂存槽为空');
    const compared = view.slots.findIndex(slot => slot.compared > 0);
    const link = $('compare-link');
    if (compared >= 0) {
      const x = g.first + compared * g.stride;
      const y = g.arrayY + 4;
      link.setAttribute('d', 'M ' + (g.tempX - 28) + ' ' + g.tempY + ' H ' + x + ' V ' + y);
      link.style.opacity = view.slots[compared].compared * 0.7;
    } else link.style.opacity = 0;
    showText($('stage-title'), view.title);
    showText($('action-title'), view.title);
    showText($('action-copy'), view.copy);
    showText($('stage-cue'), view.cue);
    const round = state => state.phase === 'intro' ? '准备 · 第一个数自然有序' : state.phase === 'done' ? '排序完成' : '第 ' + state.pass + ' 轮 · 取数位 i = ' + state.i;
    const actionStep = state => state.phase === 'done' ? 'n = ' + items.length : 'i = ' + state.i;
    showText($('round-label'), textView(round(before), round(after), progress, 0.72, 0.96));
    showText($('action-kind'), textView(labels[before.phase], labels[after.phase], progress, 0, 0.18));
    showText($('action-step'), textView(actionStep(before), actionStep(after), progress, 0.72, 0.96));
    const boundaryNote = st.low == null ? '每轮插入一个数，有序区向右扩展。' :
      ['position', 'shift', 'insert'].includes(st.phase) ? '查找已结束 · low = ' + st.low + '，high = ' + st.high + ' · 插入位置 ' + st.low :
        '当前查找：low = ' + st.low + '，high = ' + st.high + (st.low > st.high ? ' · 区间为空' : ' · 闭区间 [' + st.low + ', ' + st.high + ']');
    showText($('pointer-summary'), textView(pointerSummary(before), pointerSummary(after), progress));
    showText($('decision-note'), textView(note(before), note(after), progress));
    $('decision-note').hidden = false;
    $('pointer-summary').setAttribute('aria-label', boundaryNote);
    showText($('comparison-count'), view.comparisonText);
    showText($('shift-count'), view.shiftText);
    showText($('pass-count'), view.passText);
    const codeProgress = Math.max(0, Math.min(1, progress / 0.18));
    codeLines.forEach((line, i) => {
      const active = (before.line === i + 1 ? 1 - codeProgress : 0) + (after.line === i + 1 ? codeProgress : 0);
      line.style.backgroundColor = rgb(mix([255, 255, 255], [255, 244, 222], active));
      line.style.borderLeftColor = 'rgba(180, 115, 16,' + active + ')';
    });
    const displayed = Math.round(clock.t) + 1;
    setText($('step-counter'), '步骤 ' + displayed + ' / ' + steps.length);
    setText($('timeline-label'), '第 ' + displayed + ' 步');
    $('step-slider').value = clock.t;
    $('previous-button').disabled = clock.t <= 0;
    $('next-button').disabled = clock.t >= steps.length - 1;
    track.setAttribute('aria-label', '当前数组：' + st.array.map((item, i) => 'A[' + i + '] ' + text(item)).join('，'));
  }
  function pointerSummary(st) {
    if (st.low == null) return st.phase === 'done' ? '全部有序' : '本轮取数位 i = ' + st.i + (st.j == null ? '' : ' · 比较位置 j = ' + st.j);
    return 'low = ' + st.low + ' · high = ' + st.high + (st.mid == null ? '' : ' · mid = ' + st.mid) +
      (st.low > st.high ? ' · 区间为空' : ' · 查找 [' + st.low + ', ' + st.high + ']');
  }
  function note(st) {
    if (st.phase === 'take' || st.phase === 'shift') return '有序区正在插入调整；虚线框标记当前空位。';
    if (st.phase === 'narrow') return '斜纹只表示不再参与查找，元素没有被删除。';
    if (st.phase === 'position') return 'low > high 不再访问数组；low 是最终插入位置。';
    if (st.phase === 'locate') return st.copy;
    return st.phase === 'insert' ? '落位后，有序区底带扩大一格。' : '相等时向右找，保持 5a 在 5b 前面。';
  }
  function controls() {
    $('play-button').innerHTML = running ? 'Ⅱ <span>暂停</span>' : '▶ <span>自动演示</span>';
    $('play-button').setAttribute('aria-label', running ? '暂停自动演示' : '自动演示');
    document.body.dataset.playing = running ? 'true' : 'false';
  }
  function pause() {
    if (timeline) timeline.pause();
    if (reducedCall) { reducedCall.kill(); reducedCall = null; }
    running = false;
    controls();
  }
  function seek(time) {
    pause();
    clock.t = Math.max(0, Math.min(steps.length - 1, time));
    if (timeline) timeline.time(clock.t * BEAT, true);
    render();
  }
  function onTick() {
    if (target !== null && ((direction > 0 && clock.t >= target) || (direction < 0 && clock.t <= target))) {
      clock.t = target;
      timeline.pause(target * BEAT, true);
      running = false;
      controls();
    }
    render();
  }
  function reducedAdvance() {
    if (!running) return;
    clock.t = Math.min(steps.length - 1, Math.floor(clock.t + 0.0001) + 1);
    if (timeline) timeline.time(clock.t * BEAT, true);
    render();
    if (clock.t >= steps.length - 1) { pause(); return; }
    reducedCall = window.gsap.delayedCall(0.9, reducedAdvance);
    reducedCall.timeScale(950 / Number($('speed-select').value));
  }
  function play() {
    if (running) { pause(); return; }
    if (!timeline) return;
    if (clock.t >= steps.length - 1) seek(0);
    running = true;
    direction = 1;
    target = steps.length - 1;
    controls();
    if (reduce.checked) reducedAdvance();
    else timeline.play();
  }
  function step(delta) {
    const goal = delta > 0 ? Math.min(steps.length - 1, Math.floor(clock.t + 0.0001) + 1) : Math.max(0, Math.ceil(clock.t - 0.0001) - 1);
    pause();
    if (!timeline || reduce.checked) { seek(goal); return; }
    target = goal;
    direction = delta;
    if (goal === clock.t) return;
    running = true;
    controls();
    if (delta > 0) timeline.play();
    else timeline.reverse();
  }
  function rebuild(nextMode) {
    pause();
    if (timeline) timeline.kill();
    mode = nextMode;
    document.body.dataset.mode = mode;
    steps = buildTrace(items, mode);
    clock.t = 0;
    target = null;
    if (window.gsap) {
      timeline = window.gsap.timeline({ paused: true, onUpdate: onTick });
      timeline.fromTo(clock, { t: 0 }, { t: steps.length - 1, duration: (steps.length - 1) * BEAT, ease: 'none', immediateRender: true });
      timeline.timeScale(950 / Number($('speed-select').value));
    }
    document.querySelectorAll('.mode-button').forEach(button => {
      button.classList.toggle('is-active', button.dataset.mode === mode);
      button.setAttribute('aria-selected', String(button.dataset.mode === mode));
    });
    $('mode-summary').textContent = mode === 'binary' ? '先圈定区间，再定位中点、比较、移动一个边界；区间为空后才开始右移。' : '从右向左比较；较大的数逐个右移，空位向左移动，最后放回 temp。';
    const processCopy = document.querySelectorAll('.process-step')[1].querySelector(':scope > div > span');
    setText(processCopy, mode === 'binary' ? '折半收缩查找区间' : '从右往左比较');
    const direct = buildTrace(items, 'direct').at(-1);
    const binary = buildTrace(items, 'binary').at(-1);
    $('takeaway-copy').textContent = '本例：直接比较 ' + direct.comparisons + ' 次，折半比较 ' + binary.comparisons + ' 次；都右移 ' + direct.shifts + ' 次。折半省比较，不省移动。';
    buildCode();
    $('step-slider').max = steps.length - 1;
    setText($('timeline-total'), '共 ' + steps.length + ' 步');
    $('play-button').disabled = !window.gsap;
    $('engine-notice').hidden = Boolean(window.gsap);
    measure();
  }

  document.querySelectorAll('.mode-button').forEach(button => button.addEventListener('click', () => rebuild(button.dataset.mode)));
  $('previous-button').addEventListener('click', () => step(-1));
  $('next-button').addEventListener('click', () => step(1));
  $('play-button').addEventListener('click', play);
  $('reset-button').addEventListener('click', () => seek(0));
  $('step-slider').addEventListener('input', event => seek(reduce.checked ? Math.round(Number(event.target.value)) : Number(event.target.value)));
  $('speed-select').addEventListener('change', () => {
    const scale = 950 / Number($('speed-select').value);
    if (timeline) timeline.timeScale(scale);
    if (reducedCall) reducedCall.timeScale(scale);
  });
  function motionChanged() {
    const resume = running;
    pause();
    document.body.dataset.motion = reduce.checked ? 'reduced' : 'full';
    if (reduce.checked) seek(Math.ceil(clock.t));
    if (resume) play();
  }
  reduce.addEventListener('change', motionChanged);
  motionQuery.addEventListener('change', event => { reduce.checked = event.matches; motionChanged(); });
  document.body.dataset.motion = reduce.checked ? 'reduced' : 'full';
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, select, textarea, button, a')) return;
    if (event.code === 'Space') { event.preventDefault(); play(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    if (event.key === 'Home') { event.preventDefault(); seek(0); }
  });
  new ResizeObserver(measure).observe(scene);
  window.addEventListener('pagehide', () => { pause(); if (timeline) timeline.kill(); });
  rebuild('direct');
})();
