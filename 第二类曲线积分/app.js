(function () {
  'use strict';
  const M = window.LineIntegralModel;
  const $ = id => document.getElementById(id);
  const colors = { teal: '#69dfc9', blue: '#8cb6ff', coral: '#ff796d', amber: '#ffc06e', white: '#edf5f3' };
  const descriptions = [
    { kicker: '阶段 01 / 先看整段路', headline: '沿路看清力与前进方向。', copy: '空间中的每一根小箭头，代表那一点的力。涡旋场与发散场中的力随位置变化；恒力场可以作对照。', note: '沿曲线运动时，力可能变化，前进方向也可能改变；不能把整段功直接写成“力 × 距离”。' },
    { kicker: '阶段 02 / 把斜向拆开', headline: '一小步的功，来自两个正交方向。', copy: '显微台同时放大受力 F 与微位移 dr。蓝色水平投影相乘、青色竖直投影相乘，再把两份微功相加。', note: '看右侧：力与位移各自分成 x、y 分量。水平配水平，竖直配竖直。' },
    { kicker: '阶段 03 / 沿路带符号累加', headline: '顺力增加，逆力扣回；掉头整段变号。', copy: '每一小步的 P dx 与 Q dy 流入下方仪表盘。切换方向后，力场保留，位移的两个分量一起反向。', note: '选择“折线 + 旋转涡旋场”，可在同一程看到青色正功与琥珀色负功的接力。' }
  ];
  const fieldNames = { vortex: 'F = (−y, x)', radial: 'F = (x, y)', constant: 'F = (1.3, 0.7)' };
  const state = { stage: 1, path: 'parabola', field: 'vortex', reverse: false, progress: 0, playing: false, speed: 1, focus: 'all', lastFrame: 0 };
  let route = M.buildTrajectory(state.path, state.field);
  let flowValues = [];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fixed = (v, places = 2) => (Math.abs(v) < 0.5 * Math.pow(10, -places) ? 0 : v).toFixed(places);
  const signed = (v, places = 3) => (v < -0.5 * Math.pow(10, -places) ? '−' : '+') + fixed(Math.abs(v), places);
  const px = x => 380 + x * 125;
  const py = y => 260 - y * 125;
  const screen = p => ({ x: px(p.x), y: py(p.y) });
  const n = v => Number(v).toFixed(2);
  const line = (x1, y1, x2, y2, stroke, width = 1, extra = '') => '<line x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) + '" stroke="' + stroke + '" stroke-width="' + width + '" stroke-linecap="round" ' + extra + '/>';
  const circle = (x, y, r, fill, extra = '') => '<circle cx="' + n(x) + '" cy="' + n(y) + '" r="' + r + '" fill="' + fill + '" ' + extra + '/>';
  const label = (x, y, content, cls = '', anchor = 'start') => '<text x="' + n(x) + '" y="' + n(y) + '" class="' + cls + '" text-anchor="' + anchor + '">' + content + '</text>';
  function arrow(x1, y1, x2, y2, color, width = 2, opacity = 1) {
    const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
    if (length < 1) return '';
    const ux = dx / length, uy = dy / length, h = Math.min(10, length * 0.32), wing = Math.min(5, h * 0.52);
    const points = [
      [x2, y2],
      [x2 - h * ux - wing * uy, y2 - h * uy + wing * ux],
      [x2 - h * ux + wing * uy, y2 - h * uy - wing * ux]
    ].map(p => n(p[0]) + ',' + n(p[1])).join(' ');
    return '<g opacity="' + opacity + '">' + line(x1, y1, x2, y2, color, width) + '<polygon points="' + points + '" fill="' + color + '"/></g>';
  }
  function pathData(start, end, count = 130) {
    let result = '';
    for (let i = 0; i <= count; i++) {
      const point = screen(M.stateAt(route, start + (end - start) * i / count, state.reverse));
      result += (i ? ' L ' : 'M ') + n(point.x) + ' ' + n(point.y);
    }
    return result;
  }
  function drawStaticField() {
    let grid = '', arrows = '';
    for (let x = -2; x <= 2.01; x += 0.5) grid += line(px(x), 34, px(x), 457, '#234050', 1, 'opacity=".44"');
    for (let y = -1.5; y <= 1.51; y += 0.5) grid += line(54, py(y), 706, py(y), '#234050', 1, 'opacity=".44"');
    for (let x = -2.2; x <= 2.21; x += 0.44) {
      for (let y = -1.5; y <= 1.51; y += 0.5) {
        const f = M.forceAt(state.field, x, y), size = Math.hypot(f.P, f.Q);
        if (size < 0.06) continue;
        const length = 5 + Math.min(size * 6.7, 17), sx = px(x), sy = py(y);
        arrows += arrow(sx - f.P / size * length * 0.5, sy + f.Q / size * length * 0.5, sx + f.P / size * length * 0.5, sy - f.Q / size * length * 0.5, '#67919e', 1.25, 0.36 + Math.min(size / 8, 0.25));
      }
    }
    const full = pathData(0, 1), begin = screen(M.stateAt(route, 0, state.reverse)), end = screen(M.stateAt(route, 1, state.reverse));
    let chevrons = '';
    [0.19, 0.43, 0.68, 0.88].forEach(fraction => {
      const a = screen(M.stateAt(route, clamp(fraction - 0.012, 0, 1), state.reverse));
      const b = screen(M.stateAt(route, clamp(fraction + 0.012, 0, 1), state.reverse));
      chevrons += arrow(a.x, a.y, b.x, b.y, colors.teal, 2.8, 0.9);
    });
    $('field-static').innerHTML = '<rect x="0" y="0" width="760" height="500" fill="transparent"/>' +
      grid + line(54, py(0), 710, py(0), '#527180', 1.5) + line(px(0), 34, px(0), 458, '#527180', 1.5) +
      label(714, py(0) - 8, 'x', 'axis-label mono') + label(px(0) + 10, 43, 'y', 'axis-label mono') +
      arrows + '<path d="' + full + '" fill="none" stroke="#52d9c3" stroke-width="15" opacity=".08" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="' + full + '" fill="none" stroke="#67d9c4" stroke-width="4" opacity=".32" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path class="path-flow" d="' + full + '" fill="none" stroke="#afffe8" stroke-width="2" opacity=".7" stroke-dasharray="3 16" stroke-linecap="round"/>' +
      chevrons + circle(begin.x, begin.y, 7, '#0f2733', 'stroke="' + colors.teal + '" stroke-width="2"') +
      circle(end.x, end.y, 7, '#0f2733', 'stroke="' + colors.teal + '" stroke-width="2"') +
      label(begin.x + (begin.x < 380 ? -16 : 16), begin.y - 12, state.reverse ? 'B' : 'A', 'point-label', begin.x < 380 ? 'end' : 'start') +
      label(end.x + (end.x < 380 ? -16 : 16), end.y - 12, state.reverse ? 'A' : 'B', 'point-label', end.x < 380 ? 'end' : 'start') +
      label(75, 48, 'xOy · 空间中的力', 'tiny-label') + label(686, 48, state.reverse ? 'B → A' : 'A → B', 'svg-label mono', 'end');
    $('field-formula').textContent = fieldNames[state.field];
    $('start-label').textContent = state.reverse ? 'B 起点' : 'A 起点';
    $('end-label').textContent = state.reverse ? 'A 终点' : 'B 终点';
    $('flow-start').textContent = state.reverse ? 'B' : 'A';
    $('flow-end').textContent = state.reverse ? 'A' : 'B';
  }
  function drawDynamicField(current, micro) {
    const p = screen(current), tip = { x: p.x + current.P * 35, y: p.y - current.Q * 35 };
    const d = { x: p.x + micro.dx * 145, y: p.y - micro.dy * 145 };
    const trace = state.progress > 0.001 ? '<path d="' + pathData(0, state.progress, Math.max(3, Math.floor(state.progress * 130))) + '" fill="none" stroke="' + colors.teal + '" stroke-width="5" stroke-linecap="round" opacity=".94"/>' : '';
    $('field-dynamic').innerHTML = trace +
      circle(p.x, p.y, 19, colors.teal, 'opacity=".11" class="particle-halo"') +
      arrow(p.x, p.y, d.x, d.y, colors.blue, 3, 0.92) +
      arrow(p.x, p.y, tip.x, tip.y, colors.coral, 4, 1) +
      circle(p.x, p.y, 8, '#e4fff4', 'stroke="#0d2732" stroke-width="3" class="particle-halo"') +
      circle(p.x, p.y, 3, colors.teal) +
      label(tip.x + (current.P < 0 ? -11 : 11), tip.y - 9, 'F', 'force-label', current.P < 0 ? 'end' : 'start') +
      label(d.x + 8, d.y + 16, 'dr', 'blue-label') +
      '<rect x="79" y="443" width="181" height="29" rx="5" fill="#0b1d2b" stroke="#355466"/>' +
      label(92, 462, 'r = (' + fixed(current.x) + ', ' + fixed(current.y) + ')', 'tiny-label mono');
  }
  function drawMicro(current, micro) {
    const xAlpha = state.focus === 'y' ? 0.22 : 1;
    const yAlpha = state.focus === 'x' ? 0.22 : 1;
    function plot(originX, originY, vx, vy, scale, heading, kind) {
      const hx = originX + vx * scale, ty = originY - vy * scale;
      const mx = clamp(originX + vx * scale, 20, 480);
      const signX = vx < 0 ? -1 : 1, signY = vy < 0 ? 1 : -1;
      return '<g>' + line(originX - 88, originY, originX + 88, originY, '#496474', 1) +
        line(originX, originY - 91, originX, originY + 91, '#496474', 1) +
        label(originX, 29, heading, 'svg-label', 'middle') +
        label(originX + 86, originY - 7, 'x', 'tiny-label mono', 'end') +
        label(originX + 7, originY - 78, 'y', 'tiny-label mono') +
        arrow(originX, originY, hx, originY, colors.blue, 4, xAlpha) +
        arrow(hx, originY, hx, ty, colors.teal, 4, yAlpha) +
        line(originX, ty, hx, ty, '#7da1a7', 1, 'stroke-dasharray="3 4" opacity=".38"') +
        arrow(originX, originY, hx, ty, kind === 'force' ? colors.coral : colors.white, 3.6) +
        circle(originX, originY, 4, '#dff5ec') +
        label((originX + mx) / 2, originY + 18, kind === 'force' ? 'P' : 'dx', 'blue-label', 'middle') +
        label(hx + signX * 11, (originY + ty) / 2 - signY * 3, kind === 'force' ? 'Q' : 'dy', 'teal-label', signX < 0 ? 'end' : 'start') +
        label(hx + (vx < 0 ? -8 : 9), ty + (vy < 0 ? 19 : -9), kind === 'force' ? 'F' : 'dr', kind === 'force' ? 'force-label' : 'white-label', vx < 0 ? 'end' : 'start') +
        '<path d="M ' + n(hx - 8 * signX) + ' ' + n(originY) + ' L ' + n(hx - 8 * signX) + ' ' + n(originY + 8 * signY) + ' L ' + n(hx) + ' ' + n(originY + 8 * signY) + '" fill="none" stroke="#95b4b8" stroke-width="1" opacity=".7"/></g>';
    }
    const forceMax = Math.max(Math.abs(micro.P), Math.abs(micro.Q), 0.5);
    const forceScale = Math.min(64, 79 / forceMax);
    const displacementMax = Math.max(Math.abs(micro.dx), Math.abs(micro.dy), 0.05);
    const displacementScale = 78 / displacementMax;
    $('micro-svg').innerHTML = '<rect x="0" y="0" width="500" height="290" fill="transparent"/>' +
      plot(125, 151, micro.P, micro.Q, forceScale, '受力 F', 'force') +
      line(250, 28, 250, 249, '#3b5867', 1) +
      plot(375, 151, micro.dx, micro.dy, displacementScale, '微位移 dr', 'displacement') +
      label(125, 268, 'P = ' + signed(micro.P, 2) + '  Q = ' + signed(micro.Q, 2), 'tiny-label mono', 'middle') +
      label(375, 268, 'dx = ' + signed(micro.dx, 2) + '  dy = ' + signed(micro.dy, 2), 'tiny-label mono', 'middle');
  }
  function drawFlow() {
    flowValues = M.workBins(route, state.reverse, 72);
    const maximum = Math.max(0, ...flowValues.map(Math.abs));
    $('flow-bars').innerHTML = flowValues.map((value, i) => {
      const height = value === 0 ? 0 : 5 + 31 * Math.abs(value) / (maximum || 1);
      const sign = value === 0 ? 'zero' : value > 0 ? 'positive' : 'negative';
      return '<span class="flow-bar ' + sign + '" data-index="' + i + '" style="height:' + fixed(height, 1) + 'px" title="' + (sign === 'zero' ? '零功' : sign === 'positive' ? '正功 ' : '负功 ') + signed(value, 3) + ' J"></span>';
    }).join('');
  }
  function renderFlow() {
    const passed = Math.floor(state.progress * flowValues.length);
    $('flow-bars').querySelectorAll('.flow-bar').forEach((bar, i) => {
      bar.classList.toggle('passed', i < passed);
      bar.classList.toggle('current', i === Math.min(passed, flowValues.length - 1));
    });
  }
  function updateMeters(current, micro) {
    $('work-x').innerHTML = signed(current.wx) + ' <small>J</small>';
    $('work-y').innerHTML = signed(current.wy) + ' <small>J</small>';
    $('work-total').innerHTML = signed(current.work) + ' <small>J</small>';
    const maxX = Math.max(Math.abs(route.total.wx), Math.abs(current.wx), 0.5);
    const maxY = Math.max(Math.abs(route.total.wy), Math.abs(current.wy), 0.5);
    $('meter-x-fill').style.width = Math.min(100, Math.abs(current.wx) / maxX * 100) + '%';
    $('meter-y-fill').style.width = Math.min(100, Math.abs(current.wy) / maxY * 100) + '%';
    const totalSign = current.work < -0.0005 ? 'negative' : current.work > 0.0005 ? 'positive' : 'zero';
    $('total-card').classList.toggle('negative', totalSign === 'negative');
    $('total-caption').textContent = state.progress === 0 ? '从' + (state.reverse ? 'B' : 'A') + '出发，开始累加' :
      state.progress >= 1 ? '全程完成 · ' + (state.reverse ? 'B → A' : 'A → B') :
      '已走过 ' + Math.round(state.progress * 100) + '% 的路径';
    const localSign = state.progress === 0 ? 'zero' : micro.work < -0.0001 ? 'negative' : micro.work > 0.0001 ? 'positive' : 'zero';
    $('work-status').className = 'work-status ' + localSign;
    $('work-status').innerHTML = '<i></i>' + (localSign === 'negative' ? '此刻阻力 · 负功' : localSign === 'positive' ? '此刻推进 · 正功' : '等待运动');
  }
  function render() {
    const current = M.stateAt(route, state.progress, state.reverse);
    const micro = M.microAt(route, state.progress, state.reverse);
    drawDynamicField(current, micro);
    drawMicro(current, micro);
    updateMeters(current, micro);
    renderFlow();
    $('position-readout').textContent = '(' + fixed(current.x) + ', ' + fixed(current.y) + ')';
    $('force-readout').textContent = '(' + signed(current.P, 2) + ', ' + signed(current.Q, 2) + ')';
    $('micro-x').textContent = signed(micro.wx) + ' J';
    $('micro-y').textContent = signed(micro.wy) + ' J';
    const angle = micro.angle * 180 / Math.PI;
    const localSign = Math.abs(angle - 90) < 0.05 || Math.abs(micro.work) < 0.0001 ? 'zero' : micro.work < 0 ? 'negative' : 'positive';
    $('micro-status').className = 'micro-status ' + localSign;
    $('micro-status').textContent = localSign === 'zero' ? '力与位移近乎垂直，这一小步的功约为零。' :
      '力与位移夹角约 ' + angle.toFixed(1) + '°：' + (localSign === 'positive' ? '锐角，做正功，推动质点。' : '钝角，做负功，阻碍质点。');
    $('progress-input').value = String(Math.round(state.progress * 1000));
    $('progress-value').textContent = Math.round(state.progress * 100) + '%';
    $('progress-input').setAttribute('aria-valuetext', '已走完 ' + Math.round(state.progress * 100) + '%，累计功 ' + signed(current.work) + ' 焦耳');
  }
  function setStage(number) {
    state.stage = number;
    document.querySelectorAll('.stage-button').forEach(button => {
      const active = Number(button.dataset.stage) === number;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    const content = descriptions[number - 1];
    $('stage-kicker').textContent = content.kicker;
    $('stage-headline').textContent = content.headline;
    $('stage-copy').textContent = content.copy;
    $('field-note').textContent = content.note;
    $('direction-conclusion').hidden = !state.reverse;
    document.body.dataset.stage = number;
  }
  function updateDirection() {
    $('reverse-button').setAttribute('aria-pressed', String(state.reverse));
    $('reverse-label').textContent = state.reverse ? 'B → A 反向' : 'A → B 正向';
    $('trip-direction').textContent = state.reverse ? 'B → A' : 'A → B';
    $('direction-conclusion').hidden = !state.reverse;
    const statement = $('direction-conclusion').querySelector('p');
    statement.textContent = '力场保持原样；dx、dy 同时反向。正向总功 ' + signed(route.total.work) + ' J，反向总功 ' + signed(-route.total.work) + ' J。';
  }
  function updatePlayButton() {
    $('play-icon').textContent = state.playing ? 'Ⅱ' : '▶';
    $('play-label').textContent = state.playing ? '暂停巡航' : '巡航播放';
    $('play-button').setAttribute('aria-label', state.playing ? '暂停巡航' : '巡航播放');
  }
  function rebuild() {
    route = M.buildTrajectory(state.path, state.field);
    state.progress = 0;
    state.playing = false;
    drawStaticField();
    drawFlow();
    updateDirection();
    updatePlayButton();
    render();
  }
  function initMath() {
    if (!window.katex) return;
    const slash = String.fromCharCode(92);
    const tex = slash + 'mathrm{d}W=' + slash + 'vec F' + slash + 'cdot' + slash + 'mathrm{d}' + slash + 'vec r=' +
      '(P' + slash + 'vec i+Q' + slash + 'vec j)' + slash + 'cdot(' + slash + 'mathrm{d}x' + slash + 'vec i+' + slash + 'mathrm{d}y' + slash + 'vec j)=' +
      'P' + slash + 'mathrm{d}x+Q' + slash + 'mathrm{d}y';
    window.katex.render(tex, $('math-derivation'), { throwOnError: false });
  }
  function frame(time) {
    if (state.playing) {
      const elapsed = Math.min(64, time - (state.lastFrame || time));
      state.progress = clamp(state.progress + elapsed / (8500 / state.speed), 0, 1);
      render();
      if (state.progress >= 1) {
        state.playing = false;
        updatePlayButton();
      }
    }
    state.lastFrame = time;
    requestAnimationFrame(frame);
  }
  document.querySelectorAll('.stage-button').forEach(button => button.addEventListener('click', () => setStage(Number(button.dataset.stage))));
  document.querySelectorAll('.micro-focus button').forEach(button => button.addEventListener('click', () => {
    state.focus = button.dataset.focus;
    document.querySelectorAll('.micro-focus button').forEach(item => item.classList.toggle('active', item === button));
    render();
  }));
  $('path-select').addEventListener('change', event => { state.path = event.target.value; rebuild(); });
  $('field-select').addEventListener('change', event => { state.field = event.target.value; rebuild(); });
  $('reverse-button').addEventListener('click', () => {
    state.reverse = !state.reverse;
    state.progress = 0;
    state.playing = true;
    state.lastFrame = 0;
    drawStaticField();
    drawFlow();
    updateDirection();
    updatePlayButton();
    render();
  });
  $('play-button').addEventListener('click', () => {
    if (state.progress >= 1) state.progress = 0;
    state.playing = !state.playing;
    state.lastFrame = 0;
    updatePlayButton();
    render();
  });
  $('step-button').addEventListener('click', () => {
    state.playing = false;
    state.progress = state.progress >= 1 ? 0 : Math.min(1, state.progress + 1 / 24);
    updatePlayButton();
    render();
  });
  $('speed-input').addEventListener('input', event => {
    state.speed = Number(event.target.value);
    $('speed-value').textContent = fixed(state.speed, 2) + '×';
  });
  $('progress-input').addEventListener('input', event => {
    state.playing = false;
    state.progress = Number(event.target.value) / 1000;
    updatePlayButton();
    render();
  });
  setStage(1);
  rebuild();
  initMath();
  requestAnimationFrame(frame);
})();
