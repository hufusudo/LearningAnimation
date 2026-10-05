(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { RBTree } = window.RedBlack;
  const renderer = new window.RedBlackVisual.TreeRenderer($('tree-canvas'), $('node-note'));
  const scenarios = {
    rotate: { values: [60, 30, 80, 20, 45, 70, 90, 10], mode: 'insert', value: 5 },
    zigzag: { values: [60, 30, 80, 20, 45, 70, 90, 10], mode: 'insert', value: 15 },
    recolor: { values: [60, 30, 80, 20, 45, 70, 90], mode: 'insert', value: 10 },
    borrow: { values: [40, 20, 60, 70], mode: 'delete', value: 20 },
    near: { values: [40, 20, 60, 50], mode: 'delete', value: 20 },
    sibling: { values: [10, 5, 20, 15, 25, 13], mode: 'delete', value: 5 },
    push: { values: [40, 20, 60, 10, 30, 50, 70, 5, 25, 45, 65], prune: [5, 25, 45, 65], mode: 'delete', value: 10 },
    successor: { values: [60, 30, 80, 20, 45, 70, 90, 65, 75], mode: 'delete', value: 60 },
    empty: { values: [], mode: 'insert', value: 40 }
  };
  const state = { frames: [], cursor: 0, progress: 1, playing: false, animating: false,
    speed: 1, mode: 'insert', lastTime: 0, selected: null, immersive: false, raf: 0 };
  let finalTree = new RBTree();
  const speeds = [.5, 1, 1.5, 2];
  renderer.onInvalidate = schedule;

  function schedule() {
    if (state.raf || document.hidden) return;
    state.lastTime = performance.now();
    state.raf = requestAnimationFrame(tick);
  }

  function duration() {
    const frame = state.frames[state.cursor];
    return renderer.reduced ? Math.min(frame.duration, frame.type === 'settle' ? 600 : 220) : frame.duration;
  }

  function setMode(mode) {
    state.mode = mode;
    document.body.classList.toggle('delete-mode', mode === 'delete');
    for (const m of ['insert', 'delete']) {
      $(`mode-${m}`).classList.toggle('active', mode === m);
      $(`mode-${m}`).setAttribute('aria-pressed', String(mode === m));
    }
    $('run-label').textContent = mode === 'insert' ? '插入节点' : '删除节点';
  }

  function ui() {
    const frame = state.frames[state.cursor], last = state.frames.length - 1;
    $('play-symbol').textContent = state.playing ? 'Ⅱ' : '▶';
    $('play').setAttribute('aria-label', state.playing ? '暂停演示' : '播放演示');
    $('previous').disabled = state.cursor === 0 && !state.animating;
    $('next').disabled = state.cursor === last && !state.animating;
    $('play').disabled = state.frames.length <= 1;
    $('restart').disabled = state.frames.length <= 1;
    $('progress').max = String(Math.max(1, last));
    $('progress').value = String(state.cursor);
    $('progress').disabled = state.frames.length <= 1;
    $('progress').style.setProperty('--progress', `${last ? state.cursor / last * 100 : 0}%`);
    $('progress').setAttribute('aria-valuetext', `步骤 ${state.cursor + 1}，共 ${state.frames.length} 步：${frame.title}`);
    $('a11y-state').textContent = `${frame.title}。${frame.text}`;
    $('a11y-tree').replaceChildren(...frame.tree.nodes.map(n => {
      const li = document.createElement('li'), p = frame.tree.nodes.find(x => x.id === n.parent);
      li.textContent = `${n.value}，${n.color === 'red' ? '红' : '黑'}${p ? `，父节点 ${p.value}` : '，根节点'}`;
      return li;
    }));
    $('empty-message').hidden = frame.tree.nodes.length > 0 || !!frame.ghost || state.animating || state.playing;
  }

  function cancelPlayback() {
    state.playing = false; state.animating = false;
    state.lastTime = performance.now();
  }

  function visit(index, animate = true) {
    state.cursor = Math.max(0, Math.min(state.frames.length - 1, index));
    state.progress = animate ? 0 : 1; state.animating = animate;
    renderer.setFrame(state.frames[state.cursor], !animate);
    renderer.selected = null; state.selected = null;
    if (state.cursor > 0) $('welcome').classList.add('dismissed');
    schedule();
    ui();
  }

  function loadScenario(key) {
    cancelPlayback();
    const scenario = scenarios[key];
    const base = RBTree.from(scenario.values);
    (scenario.prune || []).forEach(value => base.delete(value));
    finalTree = RBTree.fromSnapshot(base.snapshot());
    setMode(scenario.mode); $('value-input').value = scenario.value;
    $('value-input').classList.remove('invalid');
    state.frames = key === 'empty' ? [{ type: 'ready', title: '从空树开始', text: '输入数值，让红色能量进入舞台', tree: base.snapshot(), focus: [], anchor: null, debt: null, duration: 700 }]
      : finalTree[scenario.mode](scenario.value);
    $('welcome').classList.remove('dismissed');
    visit(0, false);
  }

  function execute(event) {
    event?.preventDefault();
    const raw = $('value-input').value.trim();
    const value = Number(raw);
    const anchor = state.selected || state.frames[state.cursor].tree.root;
    if (!/^-?\d+$/.test(raw) || !Number.isInteger(value) || value < -999 || value > 999) {
      $('value-input').classList.add('invalid');
      renderer.say('需要一个整数', '请输入 -999～999 的整数', anchor); return;
    }
    if (state.cursor > 0 && (state.cursor < state.frames.length - 1 || state.animating)) {
      renderer.say('先让当前操作完成', '播放到「平衡复原」，再进行下一次增删', state.frames[state.cursor].anchor); return;
    }
    const snapshot = state.frames[state.cursor].tree;
    if (state.mode === 'insert' && snapshot.nodes.length >= 31) {
      renderer.say('舞台已有 31 个节点', '先删除一些节点，再观察新的插入', anchor); return;
    }
    cancelPlayback();
    const base = RBTree.fromSnapshot(snapshot);
    finalTree = base;
    state.frames = finalTree[state.mode](value);
    $('value-input').classList.remove('invalid');
    visit(0, false);
    state.playing = true;
    if (state.frames.length > 1) visit(1, true);
    schedule();
    ui();
  }

  function togglePlay() {
    if (state.frames.length <= 1) return;
    if (state.playing) { state.playing = false; state.animating = false; ui(); schedule(); return; }
    state.playing = true;
    state.lastTime = performance.now();
    if (state.cursor === state.frames.length - 1 && state.progress >= 1) visit(0, false);
    if (state.progress >= 1) visit(state.cursor + 1, true);
    else state.animating = true;
    schedule();
    ui();
  }

  function step(direction) {
    const wasMid = state.progress < 1;
    cancelPlayback();
    if (wasMid && direction > 0) {
      // Finish the current microstep before advancing to the next one.
      state.animating = true; ui(); schedule(); return;
    }
    visit(state.cursor + direction, true);
    schedule();
  }

  function restart() { cancelPlayback(); visit(0, true); }

  function immersive() {
    state.immersive = !state.immersive;
    document.body.classList.toggle('immersed', state.immersive);
    $('immersive').setAttribute('aria-pressed', String(state.immersive));
    $('show-controls').hidden = !state.immersive;
    $('controls').inert = state.immersive;
    $('masthead')?.toggleAttribute('inert', state.immersive);
    document.querySelector('.view-actions').inert = state.immersive;
    if (state.immersive) $('show-controls').focus(); else $('immersive').focus();
  }

  $('operation-form').addEventListener('submit', execute);
  $('mode-insert').addEventListener('click', () => setMode('insert'));
  $('mode-delete').addEventListener('click', () => setMode('delete'));
  $('scenario').addEventListener('change', event => loadScenario(event.target.value));
  $('play').addEventListener('click', togglePlay);
  $('next').addEventListener('click', () => step(1));
  $('previous').addEventListener('click', () => step(-1));
  $('restart').addEventListener('click', restart);
  $('progress').addEventListener('input', event => {
    cancelPlayback();
    visit(Number(event.target.value), true);
  });
  $('speed').addEventListener('click', () => {
    state.speed = speeds[(speeds.indexOf(state.speed) + 1) % speeds.length];
    $('speed').textContent = `${state.speed}×`;
    $('speed').setAttribute('aria-label', `播放速度 ${state.speed} 倍`);
  });
  $('immersive').addEventListener('click', immersive);
  $('show-controls').addEventListener('click', immersive);
  $('load-toggle').addEventListener('click', () => {
    renderer.load = !renderer.load;
    $('load-toggle').setAttribute('aria-pressed', String(renderer.load));
    if (renderer.load) renderer.say('黑色承重脉冲', 'NIL 也计一份黑色；观察每条根至空叶路径', state.frames[state.cursor].tree.root);
    schedule();
  });
  $('empty-insert').addEventListener('click', () => { setMode('insert'); $('value-input').focus(); $('value-input').select(); });
  $('value-input').addEventListener('input', () => $('value-input').classList.remove('invalid'));

  const canvas = $('tree-canvas');
  function coords(event) { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  canvas.addEventListener('pointermove', event => {
    const { x, y } = coords(event), hovered = renderer.hit(x, y);
    if (hovered === renderer.hover) return;
    renderer.hover = hovered; canvas.style.cursor = renderer.hover ? 'pointer' : 'default'; schedule();
  });
  canvas.addEventListener('pointerleave', () => { if (renderer.hover !== null) { renderer.hover = null; schedule(); } });
  canvas.addEventListener('click', event => {
    const { x, y } = coords(event), id = renderer.hit(x, y);
    if (!id) { renderer.selected = null; state.selected = null; schedule(); return; }
    const n = state.frames[state.cursor].tree.nodes.find(n => n.id === id);
    if (!n) return;
    renderer.selected = id; state.selected = id;
    setMode('delete'); $('value-input').value = n.value;
    $('welcome').classList.add('dismissed');
    schedule();
  });

  window.addEventListener('keydown', event => {
    if (event.target.closest('input, select, textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === ' ') { event.preventDefault(); togglePlay(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    else if (event.key.toLowerCase() === 'r') restart();
    else if (event.key.toLowerCase() === 'h') immersive();
    else if (event.key === 'Escape' && state.immersive) immersive();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      state.playing = false; state.animating = false;
      cancelAnimationFrame(state.raf); state.raf = 0; ui();
    } else schedule();
    state.lastTime = performance.now();
  });

  function tick(now) {
    state.raf = 0;
    const dt = Math.min(.05, Math.max(0, (now - (state.lastTime || now)) / 1000));
    state.lastTime = now;
    let painted = false;
    if (state.animating) {
      state.progress = Math.min(1, state.progress + dt * 1000 * state.speed / duration());
      if (state.progress >= 1) {
        state.animating = false;
        renderer.update(dt, 1, true);
        painted = true;
        if (state.playing && state.cursor < state.frames.length - 1) visit(state.cursor + 1, true);
        else { state.playing = false; ui(); }
      }
    }
    if (!painted) renderer.update(dt, state.progress, state.playing || state.animating || renderer.load || renderer.message !== null);
    if (!state.raf && (state.playing || state.animating || renderer.load || renderer.needsAnimation())) {
      state.raf = requestAnimationFrame(tick);
    }
  }

  loadScenario('rotate');
  schedule();
})();
