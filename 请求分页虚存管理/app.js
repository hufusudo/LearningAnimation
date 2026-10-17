/* 单一演示时钟；硬件、计数和记录均由 model.sample(time) 重绘。 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) {
    root.PagingPlayback = api;
    root.document.addEventListener('DOMContentLoaded', () => api.boot(root));
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createController(Model, options = {}) {
    const requestFrame = options.requestFrame || (fn => requestAnimationFrame(fn));
    const cancelFrame = options.cancelFrame || (id => cancelAnimationFrame(id));
    const onRender = options.onRender || (() => {});
    let plan = Model.buildScenario('A');
    let time = 0, speed = 1, playing = options.autoplay !== false;
    let autoCycle = options.autoCycle !== false, reduced = !!options.reduced;
    let frame = null, lastNow = null, singleStepping = false, stopAt = null;
    let loopElapsed = 0, reducedElapsed = 0, destroyed = false;

    function state() {
      return { plan, time, speed, playing, autoCycle, reduced, singleStepping, loopElapsed, framePending: frame !== null };
    }
    function render() { onRender(Model.sample(plan, time), state()); }
    function cancel() {
      if (frame !== null) cancelFrame(frame);
      frame = null; lastNow = null;
    }
    function schedule() {
      if (!destroyed && playing && frame === null) frame = requestFrame(tick);
    }
    function tick(now) {
      frame = null;
      if (!playing || destroyed) return;
      if (lastNow !== null) advance(Math.max(0, Math.min(80, now - lastNow)));
      lastNow = now;
      schedule();
    }
    function pause() {
      playing = false; singleStepping = false; stopAt = null;
      cancel(); render();
    }
    function play() {
      if (destroyed) return;
      if (time >= plan.duration && !autoCycle) { time = 0; loopElapsed = 0; reducedElapsed = 0; }
      singleStepping = false; stopAt = null;
      playing = true; lastNow = null; render(); schedule();
    }
    function seek(value) {
      playing = false; singleStepping = false; stopAt = null;
      cancel(); time = Model.sample(plan, value).time;
      loopElapsed = 0; reducedElapsed = 0; render();
    }
    function setScenario(key, playAfter = playing) {
      const next = Model.buildScenario(key);
      cancel(); plan = next; time = 0; loopElapsed = 0; reducedElapsed = 0;
      singleStepping = false; stopAt = null; playing = !!playAfter;
      render(); schedule();
    }
    function next() {
      if (singleStepping || time >= plan.duration) return;
      const s = Model.sample(plan, time);
      if (s.arrived && s.stepIndex === plan.steps.length - 1) { seek(plan.duration); return; }
      const index = s.arrived ? s.stepIndex + 1 : s.stepIndex;
      if (s.arrived) time = plan.steps[index].start;
      cancel(); loopElapsed = 0; reducedElapsed = 0;
      stopAt = index === plan.steps.length - 1 ? plan.duration : plan.steps[index].end - 0.001;
      singleStepping = true; playing = true; render(); schedule();
    }
    function previous() {
      const index = Model.sample(plan, time).stepIndex;
      seek(index === 0 ? 0 : plan.steps[index - 1].start + plan.steps[index - 1].travel);
    }
    function advance(delta) {
      if (!playing || destroyed || !Number.isFinite(delta) || delta < 0) return;
      const elapsed = delta * speed;
      if (time >= plan.duration) {
        if (autoCycle && !singleStepping) {
          loopElapsed += elapsed;
          if (loopElapsed >= 3500) {
            const keys = ['A', 'B', 'C'];
            setScenario(keys[(keys.indexOf(plan.key) + 1) % keys.length], true);
          }
        } else { playing = false; cancel(); }
        render(); return;
      }
      if (reduced) {
        reducedElapsed += elapsed;
        const s = Model.sample(plan, time);
        // 只显示动作的到达结果；保留可读停留，不把数据包瞬移解释成真实耗时。
        time = Math.max(time, s.step.start + s.step.travel);
        if (reducedElapsed >= 900) {
          reducedElapsed -= 900;
          if (singleStepping) {
            time = stopAt; playing = false; singleStepping = false; stopAt = null; cancel();
          } else if (s.stepIndex === plan.steps.length - 1) {
            time = plan.duration;
          } else {
            const nextStep = plan.steps[s.stepIndex + 1];
            time = nextStep.start + nextStep.travel;
          }
        }
      } else {
        time = Math.min(stopAt === null ? plan.duration : stopAt, time + elapsed);
        if (singleStepping && time >= stopAt) {
          singleStepping = false; stopAt = null; playing = false; cancel();
        }
      }
      if (time >= plan.duration && !autoCycle) { playing = false; cancel(); }
      render();
    }
    function setSpeed(value) {
      if (![0.5, 1, 1.5, 2].includes(value)) return;
      speed = value; render();
    }
    function setAutoCycle(value) {
      autoCycle = !!value;
      if (!autoCycle && time >= plan.duration) { playing = false; cancel(); }
      render();
    }
    function setReduced(value) { reduced = !!value; reducedElapsed = 0; render(); }
    function destroy() { destroyed = true; playing = false; cancel(); }
    const controller = {
      state, sample: () => Model.sample(plan, time), pause, play, seek, setScenario, next, previous, advance,
      toggle: () => playing ? pause() : play(),
      replay: () => setScenario(plan.key, playing),
      setSpeed, setAutoCycle, setReduced, destroy,
      start: () => { render(); schedule(); }
    };
    return controller;
  }

  const ROUTES = {
    'wire-cpu-mmu': 'M 280 318 H 390',
    'wire-mmu-cpu': 'M 390 318 H 280',
    'wire-mmu-tlb': 'M 550 220 V 180',
    'wire-tlb-mmu': 'M 550 180 V 220',
    'wire-mmu-pt': 'M 550 415 V 465',
    'wire-pt-mmu': 'M 550 465 V 415',
    'wire-mmu-ram': 'M 710 318 H 775 V 245 H 840',
    'wire-ram-cpu': 'M 960 85 V 15 H 160 V 205',
    'wire-os-disk': 'M 160 501 V 670 H 960 V 600',
    'wire-cpu-pt': 'M 280 426 H 335 V 555 H 390',
    'wire-disk-ram': 'M 960 490 V 405'
  };

  function boot(root) {
    const document = root.document;
    const $ = id => document.getElementById(id);
    if (!root.PagingModel) {
      $('resource-notice').hidden = false;
      $('resource-notice').textContent = '分页推演脚本未加载，请检查 model.js；静态结构图仍可查看。';
      document.querySelectorAll('button, input, select').forEach(el => { el.disabled = true; });
      $('playback-status').textContent = '脚本未加载';
      return;
    }
    const Model = root.PagingModel;
    const media = root.matchMedia('(prefers-reduced-motion: reduce)');
    const ns = 'http://www.w3.org/2000/svg';
    function svg(tag, attributes, text) {
      const el = document.createElementNS(ns, tag);
      Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
      if (text !== undefined) el.textContent = text;
      return el;
    }
    function put(id, text) {
      const el = $(id);
      const value = String(text);
      if (el.textContent !== value) el.textContent = value;
    }
    function attr(el, key, value) {
      if (el.getAttribute(key) !== String(value)) el.setAttribute(key, value);
    }
    const paths = {};
    Object.entries(ROUTES).forEach(([id, d]) => {
      paths[id] = svg('path', { id, d, class: 'bus-wire' });
      $('svg-wires-group').appendChild(paths[id]);
    });
    // 构图固定；SVG 随容器缩放，连线和数据包共用相同坐标，不监听整页滚动。
    const lengths = Object.fromEntries(Object.entries(paths).map(([id, el]) => [id, el.getTotalLength()]));
    const tlbRows = [], ptRows = [], frameRows = [];
    function makeRow(parent, id, baseline, columns) {
      const group = svg('g', { id, class: 'table-row' });
      group.appendChild(svg('rect', { x: 406, y: baseline - 12, width: 288, height: 16, rx: 2, class: 'table-row-bg' }));
      const cells = columns.map(x => {
        const cell = svg('text', { x, y: baseline, class: 'table-cell center' });
        group.appendChild(cell); return cell;
      });
      parent.appendChild(group);
      return { group, cells };
    }
    for (let i = 0; i < 4; i++) tlbRows.push(makeRow($('tlb-table-body'), 'tlb-row-' + i, 110 + i * 18, [440, 545, 650]));
    [0, 1, 2, 3, 4, 5, 7].forEach((p, i) => ptRows.push(makeRow($('pt-table-body'), 'pt-row-' + p, 535 + i * 16, [434, 507, 580, 653])));
    for (let i = 0; i < 8; i++) {
      const x = 858 + (i % 2) * 107, y = 131 + Math.floor(i / 2) * 65;
      const group = svg('g', { id: 'ram-frame-' + i, class: 'frame' });
      group.appendChild(svg('rect', { x, y, width: 97, height: 58, rx: 5, class: 'frame-bg' }));
      group.appendChild(svg('text', { x: x + 9, y: y + 15, class: 'frame-id' }, 'Frame ' + i));
      const page = svg('text', { id: 'frame-page-' + i, x: x + 9, y: y + 32, class: 'frame-page' });
      const data = svg('text', { id: 'frame-data-' + i, x: x + 9, y: y + 48, class: 'frame-data' });
      group.append(page, data); $('ram-frames-grid').appendChild(group);
      frameRows.push({ group, page, data });
    }
    let renderedScenario = null, logKey = null, packetKey = null;
    const hardware = ['node-cpu', 'node-mmu', 'node-tlb', 'node-pt', 'node-ram', 'node-disk'];
    function render(s, state) {
      const { plan, playing, reduced, singleStepping, autoCycle } = state;
      const meta = plan.meta;
      const reached = id => {
        const step = plan.steps.find(item => item.id === id);
        return !!step && s.time >= step.start + step.travel;
      };
      if (renderedScenario !== plan.key) {
        renderedScenario = plan.key; logKey = null;
        document.querySelectorAll('.scenario-pill').forEach(el => {
          const selected = el.dataset.scenario === plan.key;
          el.classList.toggle('active', selected); el.setAttribute('aria-pressed', String(selected));
        });
        $('step-rail').replaceChildren(...plan.steps.map((step, i) => {
          const button = document.createElement('button');
          button.className = 'flow-step'; button.type = 'button';
          const number = document.createElement('b'); number.textContent = String(i + 1).padStart(2, '0');
          button.append(number, document.createTextNode(step.title));
          button.addEventListener('click', () => controller.seek(step.start + step.travel));
          return button;
        }));
      }
      put('cpu-current-inst', `LOAD R0, [${meta.la}]`);
      put('cpu-la-hex', meta.la);
      put('cpu-mode-badge', s.cpuMode === 'kernel' ? '内核态' : '用户态');
      put('os-status-text', s.fault ? '原指令等待 · 调页中' : reached('retry') ? '调页完成 · 原指令重执' : '待命');
      put('cpu-data-val', s.r0 === null ? '—' : s.r0);
      put('cpu-result-status', s.r0 === null ? '等待读取' : '指令完成');
      put('mmu-p-val', s.split ? meta.p : '—');
      put('mmu-d-val', s.split ? meta.d : '—');
      put('mmu-calc-f', s.frame === null ? '—' : s.frame);
      put('mmu-pa-val', s.physicalAddress === null ? '—' : s.physicalAddress);
      $('offset-lock').classList.toggle('is-visible', s.split);
      put('mmu-state-badge', s.fault ? '缺页 · 等待调入' : s.physicalAddress !== null ? '物理地址就绪' : s.frame !== null ? '已取得帧号' : s.split ? '页号查映射，D 保留' : '等待逻辑地址');
      const tlbHit = reached('tlb') && plan.key === 'A' || reached('retry-tlb');
      put('tlb-state-badge', tlbHit ? `命中 · P${meta.p} → F${meta.f}` : reached('fill-tlb') ? '映射已回填' : reached('tlb') ? '未命中' : '就绪');
      const updated = reached('update-pte');
      put('pt-state-badge', updated ? 'V: 0 → 1 · F6' : reached('pte') ? plan.key === 'C' ? 'V=0 · 缺页' : `V=1 · F${meta.f}` : 'PTBR 0x1000');
      tlbRows.forEach((row, i) => {
        const value = s.tlb[i];
        [value.v, value.p, value.f].forEach((v, j) => { const text = String(v); if (row.cells[j].textContent !== text) row.cells[j].textContent = text; });
        const target = value.v === 1 && value.p === meta.p;
        attr(row.group, 'class', 'table-row' + (target && tlbHit ? ' active' : target && reached('fill-tlb') ? ' updated' : ''));
      });
      ptRows.forEach((row, i) => {
        const value = s.pt[i];
        [value.p, value.v, value.f, value.disk].forEach((v, j) => {
          const text = String(v); if (row.cells[j].textContent !== text) row.cells[j].textContent = text;
        });
        row.cells[1].classList.add('valid-cell');
        const target = value.p === meta.p;
        attr(row.group, 'class', 'table-row' + (target && reached('pte') ? updated ? ' updated' : value.v === 0 ? ' fault' : ' active' : ''));
      });
      frameRows.forEach((row, i) => {
        const frame = s.frames[i];
        const page = frame.page === 'OS 内核' ? 'OS 内核' : frame.occupied ? frame.page : '空闲';
        if (row.page.textContent !== page) row.page.textContent = page;
        const data = i === 6 && s.step.id === 'page-in' && s.arrived ? '整页已装入' : frame.data;
        if (row.data.textContent !== data) row.data.textContent = data;
        attr(row.group, 'class', 'frame' + (!frame.occupied ? ' empty' : '') + (i === meta.f && reached('read') ? ' active' : i === 6 && reached('page-in') ? ' written' : ''));
      });
      put('disk-block-label', `Block ${meta.p} · Page ${meta.p}`);
      put('disk-state-badge', plan.key !== 'C' ? '未访问' : reached('page-in') ? '调入完成' : reached('disk') ? '页面已读出' : s.step.id === 'disk' ? 'I/O 请求' : '待命');
      put('disk-state-text', plan.key !== 'C' ? '本场景无需访问磁盘' : reached('page-in') ? 'Page 3 已装入 Frame 6' : reached('disk') ? '等待搬运完整的 4 KB 页面' : 'Page 3 驻留磁盘');
      hardware.forEach(id => {
        $(id).classList.toggle('is-focused', !s.complete && (s.step.from === id || s.step.to === id));
      });
      $('node-cpu').classList.toggle('is-fault', s.fault);
      $('cpu-mode-badge').classList.toggle('fault-ink', s.cpuMode === 'kernel');
      $('pt-state-badge').classList.toggle('fault-ink', reached('pte') && !updated && plan.key === 'C');
      const wire = s.step.wire;
      const visibleWire = !!wire && !s.complete;
      attr($('active-wire'), 'visibility', visibleWire ? 'visible' : 'hidden');
      attr($('active-wire'), 'class', 'active-wire' + (s.step.kind === 'fault' ? ' is-fault' : ''));
      if (visibleWire) attr($('active-wire'), 'd', ROUTES[wire]);
      const showPacket = visibleWire && !s.arrived && !reduced;
      attr($('packet'), 'visibility', showPacket ? 'visible' : 'hidden');
      if (showPacket) {
        if (packetKey !== s.step.packet) {
          packetKey = s.step.packet; put('packet-text', packetKey);
          const width = Math.max(60, $('packet-text').getComputedTextLength() + 22);
          attr($('packet-bg'), 'x', -width / 2); attr($('packet-bg'), 'width', width);
        }
        const p = s.travelProgress;
        const point = paths[wire].getPointAtLength(lengths[wire] * p);
        attr($('packet'), 'transform', `translate(${point.x},${point.y})`);
        attr($('packet'), 'opacity', Math.max(0, Math.min(1, p * 7, (1 - p) * 7)));
        attr($('packet'), 'class', 'packet' + (s.step.kind === 'fault' ? ' is-fault' : ''));
      }
      put('memory-reads', s.counters.memoryReads);
      put('page-transfers', s.counters.pageTransfers);
      put('table-writes', s.counters.tableWrites);
      put('flow-phase', s.complete ? '指令完成' : s.step.phase);
      put('step-number', `${String(s.stepIndex + 1).padStart(2, '0')} / ${String(plan.steps.length).padStart(2, '0')}`);
      put('scene-time', `${(s.time / 1000).toFixed(1)} s`);
      put('step-title', s.step.title); put('step-detail', s.step.detail);
      const percent = Math.round(s.progress * 1000);
      if ($('progress-slider').value !== String(percent)) $('progress-slider').value = percent;
      put('progress-value', Math.round(percent / 10) + '%');
      put('loop-btn-text', playing ? 'Ⅱ 暂停' : s.complete && !autoCycle ? '↺ 再播放' : '▶ 播放');
      put('playback-status', s.complete ? playing && autoCycle ? '稍后切换场景' : '本次已完成' : singleStepping ? '单步演示' : playing ? '正在播放' : '已暂停');
      $('btn-next-step').disabled = s.complete || singleStepping;
      $('btn-prev-step').disabled = s.time === 0;
      $('speed-select').value = String(state.speed);
      $('reduce-motion').checked = reduced;
      $('auto-cycle').checked = autoCycle;
      document.body.classList.toggle('is-playing', playing);
      document.body.dataset.reduced = String(reduced);
      const stepButtons = $('step-rail').children;
      for (let i = 0; i < stepButtons.length; i++) {
        const button = stepButtons[i], current = i === s.stepIndex;
        const wasCurrent = button.classList.contains('current');
        button.classList.toggle('current', current); button.classList.toggle('done', i < s.stepIndex);
        if (current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
        if (current && !wasCurrent) {
          const rail = $('step-rail');
          if (button.offsetLeft < rail.scrollLeft || button.offsetLeft + button.offsetWidth > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = Math.max(0, button.offsetLeft - 12);
        }
      }
      const nextLogKey = plan.key + ':' + s.logs.length;
      if (logKey !== nextLogKey) {
        logKey = nextLogKey; put('log-count', s.logs.length);
        $('access-log-tbody').replaceChildren(...s.logs.map((item, i) => {
          const row = document.createElement('tr');
          [String(i + 1).padStart(2, '0'), item.stage, item.target, item.address, item.result, item.mainMemory ? '是' : '否', item.detail].forEach(value => {
            const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
          });
          return row;
        }));
      }
    }
    const controller = createController(Model, {
      onRender: render,
      requestFrame: fn => root.requestAnimationFrame(fn), cancelFrame: id => root.cancelAnimationFrame(id),
      reduced: media.matches, autoplay: !media.matches
    });
    root.pagingDemo = controller;
    $('btn-pause-cycle').addEventListener('click', controller.toggle);
    $('btn-next-step').addEventListener('click', controller.next);
    $('btn-prev-step').addEventListener('click', controller.previous);
    $('btn-replay').addEventListener('click', controller.replay);
    $('progress-slider').addEventListener('input', event => controller.seek(Number(event.target.value) / 1000 * controller.state().plan.duration));
    $('speed-select').addEventListener('change', event => controller.setSpeed(Number(event.target.value)));
    $('auto-cycle').addEventListener('change', event => controller.setAutoCycle(event.target.checked));
    $('reduce-motion').addEventListener('change', event => controller.setReduced(event.target.checked));
    document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => controller.setScenario(button.dataset.scenario)));
    media.addEventListener('change', event => controller.setReduced(event.matches));
    document.addEventListener('visibilitychange', () => { if (document.hidden) controller.pause(); });
    root.addEventListener('pagehide', controller.pause);
    document.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('button, a, input, select, textarea, summary, [contenteditable]')) return;
      if (event.code === 'Space') { event.preventDefault(); controller.toggle(); }
      else if (event.code === 'ArrowRight') { event.preventDefault(); controller.next(); }
      else if (event.code === 'ArrowLeft') { event.preventDefault(); controller.previous(); }
      else if (event.code === 'Home') { event.preventDefault(); controller.seek(0); }
    });
    controller.start();
  }

  return { createController, boot };
});
