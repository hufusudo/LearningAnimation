(function () {
  'use strict';

  const model = window.CurveIntegralModel;
  const svgNS = 'http://www.w3.org/2000/svg';
  const app = document.getElementById('app');
  const scene = document.getElementById('scene');
  const sceneWrap = document.getElementById('scene-wrap');
  const layers = {
    grid: document.getElementById('scene-grid'),
    curtain: document.getElementById('curtain-layer'),
    wire: document.getElementById('wire-layer'),
    pieces: document.getElementById('piece-layer'),
    points: document.getElementById('point-layer'),
    sum: document.getElementById('sum-layer'),
    annotation: document.getElementById('annotation-layer'),
    intro: document.getElementById('intro-layer')
  };
  const ui = {
    stageKicker: document.getElementById('stage-kicker'),
    functionName: document.getElementById('function-name'),
    metrics: document.getElementById('metrics'),
    metricN: document.getElementById('metric-n'),
    metricSum: document.getElementById('metric-sum'),
    metricExact: document.getElementById('metric-exact'),
    metricError: document.getElementById('metric-error'),
    errorFill: document.getElementById('error-fill'),
    formula: document.getElementById('formula-reveal'),
    formulaIntegral: document.getElementById('formula-integral'),
    formulaLimit: document.getElementById('formula-limit'),
    formulaSigma: document.getElementById('formula-sigma'),
    formulaTerm: document.getElementById('formula-term'),
    logMark: document.getElementById('log-mark'),
    lessonMessage: document.getElementById('lesson-message'),
    curtainMessage: document.getElementById('curtain-message'),
    slider: document.getElementById('partition-slider'),
    partitionLabel: document.getElementById('partition-label'),
    autoButton: document.getElementById('auto-refine'),
    stepButton: document.getElementById('single-step'),
    reverseButton: document.getElementById('reverse-curve'),
    functionButton: document.getElementById('change-function'),
    resetButton: document.getElementById('reset'),
    view2d: document.getElementById('view-2d'),
    view3d: document.getElementById('view-3d'),
    hoverCard: document.getElementById('hover-card'),
    dragHint: document.getElementById('drag-hint')
  };

  const DEFAULT_DENSITY = 'onePlusY2';
  const densityOrder = Object.keys(model.DENSITIES);
  const START = model.CURVE.start;
  const END = model.CURVE.end;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = {
    n: 4,
    density: DEFAULT_DENSITY,
    reversed: false,
    view: '2d',
    stage: 1,
    hasRefined: false,
    refining: false,
    activeIndex: 0,
    cameraAngle: -0.42,
    drag: null,
    refineToken: 0,
    cameraPitch: .66,
    refineTween: null,
    partitionTween: null,
    formulaTypeset: false,
    logOverride: null
  };
  const numberState = { shownSum: 0, shownExact: 0, shownError: 0, targetSum: 0, targetExact: 0, targetError: 0, raf: 0, previousTime: 0 };

  function svg(name, attrs = {}, text = '') {
    const element = document.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    }
    if (text) element.textContent = text;
    return element;
  }

  function clear(element) {
    element.replaceChildren();
  }

  function orientedBounds() {
    return state.reversed ? { start: END, end: START, direction: -1 } : { start: START, end: END, direction: 1 };
  }

  function segmentAt(index, n = state.n) {
    const { start, end } = orientedBounds();
    const step = (end - start) / n;
    const t0 = start + index * step;
    const t1 = t0 + step;
    const midpoint = (t0 + t1) / 2;
    const ds = Math.abs(model.CURVE.radius * step);
    const density = model.densityAt(state.density, midpoint);
    return { index, t0, t1, midpoint, ds, density, product: density * ds };
  }

  function densityRange() {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let i = 0; i <= 180; i += 1) {
      const t = START + (END - START) * i / 180;
      const value = model.densityAt(state.density, t);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    return { minimum, maximum };
  }

  function mixColor(start, end, amount) {
    const a = start.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16));
    const b = end.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16));
    const parts = a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, '0'));
    return `#${parts.join('')}`;
  }

  function colorFor(value, range = densityRange()) {
    const span = range.maximum - range.minimum;
    const amount = span < 1e-8 ? 0.48 : Math.max(0, Math.min(1, (value - range.minimum) / span));
    return mixColor('#347a78', '#dfb64f', amount);
  }

  function point2d(t) {
    const point = model.pointAt(t);
    if (window.matchMedia('(max-width: 700px)').matches) {
      return { x: 205 + (point.x - model.CURVE.cx) * 76, y: 127 - point.y * 76 };
    }
    return { x: 270 + (point.x - model.CURVE.cx) * 103, y: 248 - point.y * 103 };
  }

  function point3d(t, z = 0) {
    const point = model.pointAt(t);
    const x = point.x - model.CURVE.cx;
    const y = point.y - model.CURVE.cy;
    const cos = Math.cos(state.cameraAngle);
    const sin = Math.sin(state.cameraAngle);
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;
    if (window.matchMedia('(max-width: 700px)').matches) {
      return { x: 205 + (rotatedX - rotatedY) * 76, y: 292 + (rotatedX + rotatedY) * 34 * Math.cos(state.cameraPitch) - z * 50 * Math.sin(state.cameraPitch), depth: rotatedY };
    }
    return { x: 600 + (rotatedX - rotatedY) * 164, y: 261 + (rotatedX + rotatedY) * 73 * Math.cos(state.cameraPitch) - z * 94 * Math.sin(state.cameraPitch), depth: rotatedY };
  }

  function pathBetween(t0, t1, project, steps = 12, z = 0) {
    const pieces = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = t0 + (t1 - t0) * i / steps;
      const point = project(t, z);
      pieces.push(`${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`);
    }
    return pieces.join(' ');
  }

  function orientedPath(project, z = 0, steps = 180) {
    const { start, end } = orientedBounds();
    return pathBetween(start, end, project, steps, z);
  }

  function drawGrid(is3d = false) {
    clear(layers.grid);
    if (is3d) {
      const floorCorners = [
        point3d(0, 0), point3d(Math.PI / 2, 0), point3d(Math.PI, 0), point3d(Math.PI * 1.5, 0)
      ];
      const floorPath = floorCorners.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ') + ' Z';
      layers.grid.append(svg('path', { d: floorPath, class: 'scene-axis', opacity: '.55' }));
      const front = point3d(Math.PI / 2, 0);
      const back = point3d(-Math.PI / 2, 0);
      layers.grid.append(svg('path', { d: `M${back.x},${back.y} L${front.x},${front.y}`, class: 'scene-axis', 'stroke-dasharray': '4 6', opacity: '.4' }));
      return;
    }

    if (window.matchMedia('(max-width: 700px)').matches) {
      for (const y of [46, 116, 186, 256, 326, 396, 466]) {
        layers.grid.append(svg('line', { x1: 18, y1: y, x2: 392, y2: y, class: 'scene-grid-line' }));
      }
      return;
    }

    for (const y of [112, 196, 280, 364, 448]) {
      layers.grid.append(svg('line', { x1: 45, y1: y, x2: 1150, y2: y, class: 'scene-grid-line' }));
    }
    layers.grid.append(svg('path', { d: 'M70 248 H488', class: 'scene-axis', opacity: '.45' }));
  }

  function makeSegmentData() {
    const result = [];
    for (let i = 0; i < state.n; i += 1) result.push(segmentAt(i));
    return result;
  }

  function drawWire2d(data, range) {
    clear(layers.wire);
    clear(layers.pieces);
    clear(layers.points);
    layers.wire.append(svg('path', { d: orientedPath(point2d, 0, 200), class: 'wire-shadow' }));

    const { start, end } = orientedBounds();
    const visualCount = 200;
    for (let i = 0; i < visualCount; i += 1) {
      const a = start + (end - start) * i / visualCount;
      const b = start + (end - start) * (i + 1) / visualCount;
      const midpoint = (a + b) / 2;
      const color = colorFor(model.densityAt(state.density, midpoint), range);
      layers.wire.append(svg('path', { d: pathBetween(a, b, point2d, 2), class: 'wire-piece', stroke: color, 'stroke-width': 7 }));
    }

    if (state.stage >= 2) {
      for (const item of data) {
        const selected = item.index === state.activeIndex;
        const segmentPath = pathBetween(item.t0, item.t1, point2d, Math.max(2, Math.ceil(12 / Math.sqrt(state.n))));
        const stroke = selected ? '#ffd34e' : colorFor(item.density, range);
        layers.pieces.append(svg('path', {
          d: segmentPath,
          class: `segment-stroke${selected ? ' is-selected' : ''}`,
          stroke,
          'stroke-width': selected ? 10 : 7,
          'data-index': item.index,
          'data-piece': 'curve'
        }));

        const middle = point2d(item.midpoint);
        layers.points.append(svg('circle', {
          cx: middle.x,
          cy: middle.y,
          r: selected ? 4.2 : Math.max(1.3, 2.1 - state.n / 105),
          class: `sample-point${selected ? ' is-selected' : ''}`,
          'data-index': item.index,
          'data-piece': 'curve'
        }));

        if (state.n <= 32) {
          const edge = point2d(item.t0);
          const next = point2d(item.t1);
          const dx = next.x - edge.x;
          const dy = next.y - edge.y;
          const length = Math.max(1, Math.hypot(dx, dy));
          const nx = -dy / length * 5;
          const ny = dx / length * 5;
          layers.pieces.append(svg('line', { x1: edge.x - nx, y1: edge.y - ny, x2: edge.x + nx, y2: edge.y + ny, class: 'segment-tick', 'pointer-events': 'none' }));
        }
      }
    }

    const arrowT = start + (end - start) * .46;
    const arrowEndT = arrowT + Math.sign(end - start) * .19;
    const arrowA = point2d(arrowT);
    const arrowB = point2d(arrowEndT);
    layers.annotation.append(svg('line', { x1: arrowA.x, y1: arrowA.y, x2: arrowB.x, y2: arrowB.y, class: 'direction-line', 'marker-end': 'url(#direction-arrow)' }));
    layers.annotation.append(svg('text', { x: 65, y: 82, class: 'direction-label' }, '弯曲金属丝'));

    if (state.stage >= 2) drawActiveMeasure2d();
  }

  function drawActiveMeasure2d() {
    const item = segmentAt(state.activeIndex);
    const geometry = model.segmentGeometry(state.n, state.activeIndex, state.reversed);
    drawZoomInset2d(item, geometry);
  }

  function drawZoomInset2d(item, geometry) {
    const mobile = window.matchMedia('(max-width: 700px)').matches;
    const panel = mobile
      ? { x: 18, y: 216, width: 374, height: 160 }
      : { x: 505, y: 78, width: 650, height: 270 };
    const targetChord = mobile ? 70 : 150;
    const maxScale = mobile ? 2200 : 3000;
    const scale = Math.min(maxScale, Math.max(70, targetChord / Math.max(geometry.chord, 1e-9)));
    const startPoint = model.pointAt(geometry.t0);
    const origin = {
      x: mobile ? 300 : 820,
      y: geometry.dy >= 0 ? (mobile ? 350 : 316) : (mobile ? 280 : 165)
    };
    const zoomPoint = t => {
      const point = model.pointAt(t);
      return { x: origin.x + (point.x - startPoint.x) * scale, y: origin.y - (point.y - startPoint.y) * scale };
    };
    const a = zoomPoint(geometry.t0);
    const b = zoomPoint(geometry.t1);
    const corner = { x: b.x, y: a.y };
    const formatChange = value => `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
    const sourceA = point2d(geometry.t0);
    const sourceB = point2d(geometry.t1);
    const targetA = mobile
      ? { x: panel.x + 90, y: panel.y }
      : { x: panel.x, y: Math.max(panel.y + 72, Math.min(panel.y + panel.height - 22, sourceA.y)) };
    const targetB = mobile
      ? { x: panel.x + panel.width - 90, y: panel.y }
      : { x: panel.x, y: Math.max(panel.y + 72, Math.min(panel.y + panel.height - 22, sourceB.y)) };

    layers.annotation.append(svg('line', { x1: sourceA.x, y1: sourceA.y, x2: targetA.x, y2: targetA.y, class: 'zoom-connector' }));
    layers.annotation.append(svg('line', { x1: sourceB.x, y1: sourceB.y, x2: targetB.x, y2: targetB.y, class: 'zoom-connector' }));
    layers.annotation.append(svg('rect', { x: panel.x, y: panel.y, width: panel.width, height: panel.height, rx: 9, class: 'zoom-panel' }));
    layers.annotation.append(svg('text', { x: panel.x + 17, y: panel.y + 23, class: 'zoom-heading' }, `放大同一段弧　Δs = ${item.ds.toFixed(3)}`));
    layers.annotation.append(svg('text', { x: panel.x + 17, y: panel.y + 48, class: 'zoom-formula' }, 'Δs ≈ √(dx² + dy²)'));
    layers.annotation.append(svg('text', { x: panel.x + (mobile ? 232 : 280), y: panel.y + 47, class: 'zoom-density-label' }, `f = ${item.density.toFixed(3)}`));
    layers.annotation.append(svg('text', { x: panel.x + 17, y: panel.y + 66, class: 'zoom-limit-label' }, '弧长趋于 0 时：ds = √(dx² + dy²)'));

    layers.annotation.append(svg('path', { d: pathBetween(geometry.t0, geometry.t1, zoomPoint, 24), class: 'zoom-arc' }));
    layers.annotation.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'zoom-chord' }));
    layers.annotation.append(svg('line', { x1: a.x, y1: a.y, x2: corner.x, y2: corner.y, class: 'zoom-component' }));
    layers.annotation.append(svg('line', { x1: corner.x, y1: corner.y, x2: b.x, y2: b.y, class: 'zoom-component' }));
    layers.annotation.append(svg('path', { d: `M${corner.x - 7},${corner.y} v${Math.sign(b.y - a.y) * 7} h${Math.sign(a.x - b.x) * 7}`, class: 'zoom-right-angle' }));
    layers.annotation.append(svg('circle', { cx: a.x, cy: a.y, r: 4, class: 'zoom-endpoint' }));
    layers.annotation.append(svg('circle', { cx: b.x, cy: b.y, r: 4, class: 'zoom-endpoint' }));

    const dxLabel = svg('text', { x: (a.x + corner.x) / 2, y: a.y - 8, class: 'zoom-axis-label', 'text-anchor': 'middle' }, `dx ${formatChange(geometry.dx)}`);
    const dyX = corner.x + (geometry.dx >= 0 ? 8 : -8);
    const dyAnchor = geometry.dx >= 0 ? 'start' : 'end';
    const dyLabel = svg('text', { x: dyX, y: (corner.y + b.y) / 2, class: 'zoom-axis-label', 'text-anchor': dyAnchor }, `dy ${formatChange(geometry.dy)}`);
    const arcMid = zoomPoint((geometry.t0 + geometry.t1) / 2);
    const arcLabel = svg('text', { x: arcMid.x + 7, y: arcMid.y + (geometry.dy >= 0 ? 17 : -9), class: 'zoom-arc-label' }, '弧长 Δs');
    layers.annotation.append(dxLabel, dyLabel, arcLabel);
  }

  function drawSum2d(data, range) {
    clear(layers.sum);
    if (state.stage < 3) return;

    const mobile = window.matchMedia('(max-width: 700px)').matches;
    const left = mobile ? 35 : 604;
    const width = mobile ? 340 : 528;
    const baseline = mobile ? 485 : 493;
    const maxHeight = mobile ? 95 : 128;
    const titleY = mobile ? 385 : 370;
    const captionY = mobile ? 405 : 389;
    layers.sum.append(svg('text', { x: left, y: titleY, class: 'chart-title' }, '每一小段对应一片小片'));
    layers.sum.append(svg('text', { x: left, y: captionY, class: 'chart-caption' }, '横向宽度表示 Δs　·　竖向高度表示 f　·　面积表示 f × Δs'));
    layers.sum.append(svg('line', { x1: left, y1: baseline, x2: left + width, y2: baseline, class: 'chart-baseline' }));

    const slotWidth = width / state.n;
    const gap = Math.min(1.5, slotWidth * .22);
    for (const item of data) {
      const barHeight = Math.max(3, item.density * maxHeight / 3.15);
      const x = left + item.index * slotWidth + gap / 2;
      const rect = svg('rect', {
        x,
        y: baseline - barHeight,
        width: Math.max(.8, slotWidth - gap),
        height: barHeight,
        rx: state.n < 24 ? 2 : .6,
        class: `sum-piece is-interactive${item.index === state.activeIndex ? ' is-selected' : ''}`,
        fill: colorFor(item.density, range),
        'data-index': item.index,
        'data-piece': 'sum'
      });
      layers.sum.append(rect);
      if (state.n <= 18) {
        layers.sum.append(svg('line', { x1: x + gap / 2, y1: baseline - barHeight, x2: x + gap / 2, y2: baseline, class: 'bar-mark' }));
      }
    }

    const active = data[state.activeIndex];
    if (active && state.n <= 24) {
      const center = left + (active.index + .5) * slotWidth;
      const barHeight = active.density * maxHeight / 3.15;
      const labelY = Math.max(128, baseline - barHeight - 13);
      layers.sum.append(svg('path', { d: `M${center - 13},${baseline + 15} v5 H${center + 13} v-5`, class: 'area-bracket' }));
      layers.sum.append(svg('text', { x: center, y: labelY, class: 'area-bracket-text', 'text-anchor': 'middle' }, `${active.product.toFixed(2)}`));
    }
  }

  function draw2d(data, range) {
    clear(layers.curtain);
    clear(layers.annotation);
    drawGrid(false);
    drawWire2d(data, range);
    drawSum2d(data, range);
  }

  function draw3d(data, range) {
    clear(layers.wire);
    clear(layers.pieces);
    clear(layers.points);
    clear(layers.sum);
    clear(layers.annotation);
    clear(layers.curtain);
    drawGrid(true);

    const showCurtain = state.hasRefined;
    if (showCurtain) {
      const patches = data.map(item => {
        const a = point3d(item.t0, 0);
        const b = point3d(item.t1, 0);
        const c = point3d(item.t1, model.densityAt(state.density, item.t1));
        const d = point3d(item.t0, model.densityAt(state.density, item.t0));
        const depth = (a.depth + b.depth + c.depth + d.depth) / 4;
        return { item, depth, corners: [a, b, c, d] };
      }).sort((a, b) => a.depth - b.depth);

      for (const patch of patches) {
        const { item, corners } = patch;
        const points = corners.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
        layers.curtain.append(svg('polygon', {
          points,
          class: `curtain-patch${item.index === state.activeIndex ? ' is-selected' : ''}`,
          fill: colorFor(item.density, range),
          'data-index': item.index,
          'data-piece': 'curtain'
        }));
      }

      layers.curtain.append(svg('path', { d: orientedPath((t) => point3d(t, 0), 0, 220), class: 'curtain-base' }));
      layers.curtain.append(svg('path', {
        d: pathBetween(orientedBounds().start, orientedBounds().end, (t) => point3d(t, model.densityAt(state.density, t)), 220),
        class: 'curtain-top'
      }));

      const labelPoint = point3d((orientedBounds().start + orientedBounds().end) / 2, model.densityAt(state.density, (START + END) / 2));
      layers.annotation.append(svg('text', { x: labelPoint.x + 10, y: labelPoint.y - 8, class: 'curtain-side-label' }, '高度 = f'));
      const baseLabelPoint = point3d(START + (END - START) * .23, 0);
      layers.annotation.append(svg('text', { x: baseLabelPoint.x - 40, y: baseLabelPoint.y + 28, class: 'curtain-side-label' }, '曲线 C'));

      const active = data[state.activeIndex];
      if (active) {
        const mid = point3d(active.midpoint, model.densityAt(state.density, active.midpoint) * .55);
        layers.annotation.append(svg('rect', { x: mid.x + 12, y: mid.y - 18, width: 150, height: 27, rx: 5, class: 'active-measure' }));
        layers.annotation.append(svg('text', { x: mid.x + 20, y: mid.y, class: 'active-measure-text' }, `这一片约 ${active.product.toFixed(3)}`));
      }
    } else {
      const { start, end } = orientedBounds();
      layers.wire.append(svg('path', { d: pathBetween(start, end, point3d, 200), class: 'wire-shadow' }));
      const count = state.stage >= 2 ? state.n : 150;
      for (let i = 0; i < count; i += 1) {
        const a = start + (end - start) * i / count;
        const b = start + (end - start) * (i + 1) / count;
        const color = colorFor(model.densityAt(state.density, (a + b) / 2), range);
        layers.wire.append(svg('path', { d: pathBetween(a, b, point3d, 2), class: 'wire-piece', stroke: color, 'stroke-width': state.stage >= 2 ? 7 : 6 }));
      }
    }

    const arrowBounds = orientedBounds();
    const arrowT = arrowBounds.start + (arrowBounds.end - arrowBounds.start) * .46;
    const arrowEndT = arrowT + Math.sign(arrowBounds.end - arrowBounds.start) * .19;
    const arrowA = point3d(arrowT, 0);
    const arrowB = point3d(arrowEndT, 0);
    layers.annotation.append(svg('line', { x1: arrowA.x, y1: arrowA.y, x2: arrowB.x, y2: arrowB.y, class: 'direction-line', 'marker-end': 'url(#direction-arrow)' }));

    if (state.stage >= 2 && !showCurtain) {
      for (const item of data) {
        const middle = point3d(item.midpoint, 0);
        layers.points.append(svg('circle', { cx: middle.x, cy: middle.y, r: item.index === state.activeIndex ? 4.5 : 2, class: `sample-point${item.index === state.activeIndex ? ' is-selected' : ''}`, 'data-index': item.index, 'data-piece': 'curve' }));
      }
      const active = data[state.activeIndex];
      if (active) {
        const center = point3d(active.midpoint, .16);
        layers.annotation.append(svg('rect', { x: center.x + 12, y: center.y - 14, width: 145, height: 27, rx: 5, class: 'active-measure' }));
        layers.annotation.append(svg('text', { x: center.x + 20, y: center.y + 4, class: 'active-measure-text' }, `Δs = ${active.ds.toFixed(3)}　f = ${active.density.toFixed(2)}`));
      }
    }
  }

  function formatSum(value) { return Number.isFinite(value) ? value.toFixed(4) : '—'; }
  function formatError(value) { return Number.isFinite(value) ? (value < .001 ? value.toFixed(5) : value.toFixed(4)) : '—'; }

  function typesetFormula() {
    if (state.formulaTypeset || !window.katex) return;
    const options = { throwOnError: false, output: 'htmlAndMathml' };
    window.katex.render('\\int_C f\\,ds', ui.formulaIntegral, options);
    window.katex.render('\\lim_{n\\to\\infty}', ui.formulaLimit, options);
    window.katex.render('\\sum_{i=1}^{n}', ui.formulaSigma, options);
    window.katex.render('f(P_i)\\,\\Delta s_i', ui.formulaTerm, options);
    state.formulaTypeset = true;
  }

  function tickNumbers(now) {
    numberState.raf = 0;
    const elapsed = numberState.previousTime ? Math.min(50, now - numberState.previousTime) : 16;
    numberState.previousTime = now;
    const factor = reduceMotion ? 1 : 1 - Math.exp(-elapsed / 190);
    let moving = false;
    for (const [shownKey, targetKey] of [['shownSum', 'targetSum'], ['shownExact', 'targetExact'], ['shownError', 'targetError']]) {
      const difference = numberState[targetKey] - numberState[shownKey];
      if (Math.abs(difference) > .00004) {
        numberState[shownKey] += difference * factor;
        moving = true;
      } else {
        numberState[shownKey] = numberState[targetKey];
      }
    }
    ui.metricSum.textContent = formatSum(numberState.shownSum);
    ui.metricExact.textContent = formatSum(numberState.shownExact);
    ui.metricError.textContent = formatError(numberState.shownError);
    if (moving) numberState.raf = requestAnimationFrame(tickNumbers);
    else numberState.previousTime = 0;
  }

  function setMetricTargets(result) {
    numberState.targetSum = result.sum;
    numberState.targetExact = result.exact;
    numberState.targetError = result.error;
    if (numberState.raf) return;
    numberState.raf = requestAnimationFrame(tickNumbers);
  }

  function syncMetrics() {
    const totalsVisible = state.stage >= 3;
    ui.metrics.hidden = state.stage === 1;
    ui.metricN.textContent = String(state.n);
    ui.partitionLabel.textContent = `${state.n} 段`;
    if (!totalsVisible) {
      if (numberState.raf) cancelAnimationFrame(numberState.raf);
      numberState.raf = 0;
      numberState.previousTime = 0;
      numberState.shownSum = 0;
      numberState.shownExact = 0;
      numberState.shownError = 0;
      ui.metricSum.textContent = '—';
      ui.metricExact.textContent = '—';
      ui.metricError.textContent = '—';
      ui.errorFill.style.width = '0%';
      return;
    }

    const result = model.integrate(state.density, state.n, state.reversed);
    setMetricTargets(result);
    const percent = Math.min(100, result.error / .02 * 100);
    ui.errorFill.style.width = `${percent}%`;
  }

  function sceneCopy() {
    if (state.stage === 1) return { kicker: '先看这根弯弯的金属丝', mark: '先想一想', message: '这根弯的金属丝，总质量是多少？' };
    if (state.stage === 2) return { kicker: '切一段，再放大看清它', mark: '弧长变直线', message: '弧长很小时，弧可近似看成直线。dx、dy 是直角边，斜边 √(dx²+dy²) 约等于 ds；密度 f 乘弧长，就是这一小段的质量。弧长趋于 0 时，ds = √(dx²+dy²)。' };
    if (state.stage === 3 && !state.hasRefined) return { kicker: '把每段的贡献排在一起', mark: '一片片相加', message: `每片的宽度是 Δs、高度是密度 f，面积 f × Δs 就代表这小段弯丝的质量；把 ${state.n} 片相加，就是整根弯丝的总质量。弧段越短，放大图里弧和直线越贴近。` };
    if (state.stage === 5) return { kicker: '把小片立起来，看看整张帘幕', mark: '帘幕面积', message: '沿着每一小段立起一片高为 f 的窄帘；每片面积约是 f × Δs。', curtain: true };
    if (state.stage === 6) return { kicker: '箭头反过来了，长度没有变负', mark: '方向无关', message: '走回头路时，每段的长度 Δs 仍然是正数，所以重新相加得到同一个结果。', curtain: state.view === '3d' };
    return { kicker: '切得更细，总和逐渐稳定', mark: '越细越准', message: '从 4 段一路加密到 128 段，小片越来越窄，总和慢慢稳定下来。', curtain: false };
  }

  function render() {
    state.activeIndex = Math.max(0, Math.min(state.n - 1, state.activeIndex));
    app.dataset.stage = String(state.stage);
    app.dataset.view = state.view;
    scene.classList.toggle('is-3d', state.view === '3d');
    scene.setAttribute('viewBox', window.matchMedia('(max-width: 700px)').matches ? '0 0 410 500' : '0 0 1200 520');
    scene.setAttribute('aria-label', state.view === '3d' && state.hasRefined
      ? '沿着弯曲曲线竖起的半透明帘幕，帘高表示密度，可拖动旋转'
      : state.stage >= 3
        ? `弯曲曲线分成 ${state.n} 段，右上放大框展示所选弧段的 dx、dy 和弧长，右下小片的面积表示密度乘以小段长度`
        : state.stage >= 2
          ? `变色金属丝分成 ${state.n} 段，黄色弧段和旁边放大框同步显示，框中标出 dx、dy 和 ds`
          : '一根颜色随密度改变的弯曲金属丝');
    ui.view2d.classList.toggle('is-active', state.view === '2d');
    ui.view3d.classList.toggle('is-active', state.view === '3d');
    ui.view2d.setAttribute('aria-pressed', String(state.view === '2d'));
    ui.view3d.setAttribute('aria-pressed', String(state.view === '3d'));
    ui.reverseButton.setAttribute('aria-pressed', String(state.reversed));
    ui.functionName.hidden = state.stage === 1;
    ui.functionName.textContent = model.DENSITIES[state.density].label;
    ui.stageKicker.textContent = state.view === '3d' && state.hasRefined ? '沿着曲线立起的半透明帘幕' : sceneCopy().kicker;
    ui.formula.hidden = !state.hasRefined;
    if (state.hasRefined) typesetFormula();
    const copy = sceneCopy();
    const showingCurtainCopy = state.view === '3d' && state.hasRefined && state.stage >= 5;
    ui.curtainMessage.hidden = !showingCurtainCopy;
    ui.lessonMessage.hidden = showingCurtainCopy;
    ui.curtainMessage.textContent = state.logOverride || copy.message;
    ui.logMark.textContent = copy.mark;
    ui.lessonMessage.textContent = state.logOverride || copy.message;
    ui.dragHint.hidden = state.view !== '3d';

    const data = makeSegmentData();
    const range = densityRange();
    if (state.view === '2d') draw2d(data, range);
    else draw3d(data, range);
    syncMetrics();
  }

  function activateSegmentation() {
    if (state.stage < 2) state.stage = 2;
    state.logOverride = null;
    render();
  }

  function showSummation() {
    if (state.stage < 2) state.stage = 2;
    state.stage = 3;
    state.logOverride = null;
    render();
  }

  function setPartition(value) {
    state.logOverride = null;
    state.n = Math.max(4, Math.min(128, Math.round(value)));
    state.activeIndex = Math.min(state.activeIndex, state.n - 1);
    if (state.stage < 2) state.stage = 2;
    if (!state.hasRefined && state.stage >= 3 && state.n > 4) state.stage = 3;
    render();
  }

  function singleStep() {
    if (state.refining) return;
    if (state.stage === 1) {
      activateSegmentation();
      return;
    }
    if (state.stage === 2) {
      showSummation();
      return;
    }
    if (state.n >= 128) {
      ui.logMark.textContent = '已经够细';
      ui.lessonMessage.textContent = '已经切到 128 段。按“自动加密”可以重播总和稳定下来的过程。';
      return;
    }
    const before = state.n;
    const target = Math.min(128, before * 2);
    state.stage = state.hasRefined ? (state.view === '3d' ? 5 : 4) : 3;
    state.logOverride = `再把每段各切一半：段数从 ${before} 增加到 ${target}，每一片也变得更窄。`;
    if (window.gsap && !reduceMotion) {
      const token = ++state.refineToken;
      const proxy = { n: before };
      state.partitionTween?.kill();
      state.partitionTween = window.gsap.to(proxy, {
        n: target,
        duration: .38,
        ease: 'power2.out',
        onUpdate: () => {
          if (token !== state.refineToken) return;
          const next = Math.round(proxy.n);
          if (next !== state.n) {
            state.n = next;
            state.activeIndex = Math.min(state.n - 1, Math.floor(state.n / 4));
            render();
          }
        },
        onComplete: () => { state.partitionTween = null; }
      });
      render();
      return;
    }
    state.n = target;
    state.activeIndex = Math.min(state.activeIndex * 2, state.n - 1);
    render();
  }

  function setBusy(isBusy) {
    state.refining = isBusy;
    ui.slider.disabled = isBusy;
    ui.stepButton.disabled = isBusy;
    ui.reverseButton.disabled = isBusy;
    ui.functionButton.disabled = isBusy;
    ui.autoButton.disabled = isBusy;
    ui.autoButton.textContent = isBusy ? '加密中…' : '自动加密';
  }

  function runRefinement() {
    const token = ++state.refineToken;
    state.partitionTween?.kill();
    state.partitionTween = null;
    state.refineTween?.kill();
    const startN = state.n;
    const targetN = 128;
    const duration = reduceMotion || startN >= targetN ? 0 : 4300;
    const startTime = performance.now();
    state.logOverride = null;
    state.stage = 3;
    setBusy(true);
    render();

    function finishRefinement() {
      if (token !== state.refineToken) return;
      state.n = targetN;
      state.hasRefined = true;
      state.stage = state.view === '3d' ? 5 : 4;
      state.refineTween = null;
      setBusy(false);
      render();
    }

    function updatePartition(value) {
      if (token !== state.refineToken) return;
      const nextN = Math.min(targetN, Math.max(startN, Math.round(value)));
      if (nextN !== state.n) {
        state.n = nextN;
        state.activeIndex = Math.min(state.n - 1, Math.floor(state.n / 4));
        render();
      }
    }

    if (window.gsap) {
      const proxy = { n: startN };
      state.refineTween = window.gsap.to(proxy, {
        n: targetN,
        duration: duration / 1000,
        ease: 'power2.inOut',
        onUpdate: () => updatePartition(proxy.n),
        onComplete: finishRefinement
      });
      return;
    }

    function frame(now) {
      if (token !== state.refineToken) return;
      const progress = duration === 0 ? 1 : Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 2.4);
      updatePartition(startN + (targetN - startN) * eased);
      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        finishRefinement();
      }
    }
    requestAnimationFrame(frame);
  }

  function autoRefine() {
    if (state.refining) return;
    const sequenceToken = ++state.refineToken;
    state.partitionTween?.kill();
    state.partitionTween = null;
    state.logOverride = null;
    if (state.n >= 128 && state.hasRefined) {
      state.n = 4;
      state.stage = 3;
      state.hasRefined = false;
      render();
    }
    if (state.stage < 2) {
      activateSegmentation();
      window.setTimeout(() => {
        if (sequenceToken === state.refineToken && !state.refining) {
          showSummation();
          window.setTimeout(() => {
            if (sequenceToken === state.refineToken && !state.refining) runRefinement();
          }, reduceMotion ? 0 : 320);
        }
      }, reduceMotion ? 0 : 320);
      return;
    }
    if (state.stage < 3) {
      showSummation();
      window.setTimeout(() => {
        if (sequenceToken === state.refineToken && !state.refining) runRefinement();
      }, reduceMotion ? 0 : 260);
      return;
    }
    runRefinement();
  }

  function reverseCurve() {
    state.reversed = !state.reversed;
    state.stage = state.hasRefined ? 6 : Math.max(state.stage, 2);
    state.logOverride = state.hasRefined ? null : '箭头换了方向。等会儿切段时，Δs 仍然是正的弧长。';
    render();
  }

  function changeFunction() {
    const old = densityOrder.indexOf(state.density);
    state.density = densityOrder[(old + 1) % densityOrder.length];
    state.stage = Math.max(state.stage, 2);
    state.logOverride = state.hasRefined ? `换成 ${model.DENSITIES[state.density].label}，同样的切段和相加方法仍然适用。` : null;
    render();
  }

  function changeView(view) {
    if (state.view === view) return;
    scene.classList.add('is-transitioning');
    state.view = view;
    state.logOverride = null;
    if (state.hasRefined) state.stage = view === '3d' ? 5 : (state.reversed ? 6 : 4);
    render();
    if (window.gsap) {
      window.gsap.fromTo(scene, { opacity: .38 }, { opacity: 1, duration: .24, ease: 'power2.out', onComplete: () => scene.classList.remove('is-transitioning') });
    } else {
      requestAnimationFrame(() => scene.classList.remove('is-transitioning'));
    }
  }

  function reset() {
    state.refineToken += 1;
    state.refineTween?.kill();
    state.partitionTween?.kill();
    state.refineTween = null;
    state.partitionTween = null;
    setBusy(false);
    state.n = 4;
    state.density = DEFAULT_DENSITY;
    state.reversed = false;
    state.view = '2d';
    state.stage = 1;
    state.hasRefined = false;
    state.activeIndex = 0;
    state.cameraAngle = -.42;
    state.cameraPitch = .66;
    state.drag = null;
    state.logOverride = null;
    ui.slider.value = '4';
    ui.hoverCard.hidden = true;
    render();
  }

  function tooltipFor(index) {
    const item = segmentAt(index);
    return `Δs：${item.ds.toFixed(4)}<br>f：${item.density.toFixed(4)}<br>f × Δs：${item.product.toFixed(4)}`;
  }

  function showTooltip(event, index) {
    if (state.stage < 2) return;
    if (state.activeIndex !== index) {
      state.activeIndex = index;
      render();
    }
    ui.hoverCard.innerHTML = tooltipFor(index);
    ui.hoverCard.hidden = false;
    const bounds = sceneWrap.getBoundingClientRect();
    const cardWidth = ui.hoverCard.offsetWidth || 160;
    const cardHeight = ui.hoverCard.offsetHeight || 64;
    const x = Math.max(8, Math.min(bounds.width - cardWidth - 8, event.clientX - bounds.left + 14));
    const y = Math.max(8, Math.min(bounds.height - cardHeight - 8, event.clientY - bounds.top + 14));
    ui.hoverCard.style.left = `${x}px`;
    ui.hoverCard.style.top = `${y}px`;
  }

  ui.slider.addEventListener('input', event => setPartition(Number(event.target.value)));
  ui.autoButton.addEventListener('click', autoRefine);
  ui.stepButton.addEventListener('click', singleStep);
  ui.reverseButton.addEventListener('click', reverseCurve);
  ui.functionButton.addEventListener('click', changeFunction);
  ui.resetButton.addEventListener('click', reset);
  ui.view2d.addEventListener('click', () => changeView('2d'));
  ui.view3d.addEventListener('click', () => changeView('3d'));

  scene.addEventListener('pointermove', event => {
    if (state.view === '3d' && state.drag) {
      const deltaX = event.clientX - state.drag.x;
      const deltaY = event.clientY - state.drag.y;
      state.drag.x = event.clientX;
      state.drag.y = event.clientY;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 0) {
        state.cameraAngle += deltaX * .009;
        state.cameraPitch = Math.max(.25, Math.min(1.18, state.cameraPitch + deltaY * .006));
        render();
      }
      return;
    }
    const target = event.target.closest('[data-index]');
    if (target && target.dataset.index !== undefined) {
      showTooltip(event, Number(target.dataset.index));
    } else if (!ui.hoverCard.hidden) {
      ui.hoverCard.hidden = true;
    }
  });

  scene.addEventListener('pointerdown', event => {
    if (state.view !== '3d') return;
    state.drag = { x: event.clientX, y: event.clientY };
    scene.setPointerCapture(event.pointerId);
  });
  scene.addEventListener('pointerup', event => {
    state.drag = null;
    if (scene.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
  });
  scene.addEventListener('pointercancel', () => { state.drag = null; });
  scene.addEventListener('pointerleave', () => {
    if (!state.drag) ui.hoverCard.hidden = true;
  });

  window.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
    if (event.key === 'ArrowLeft') {
      state.activeIndex = Math.max(0, state.activeIndex - 1);
      render();
    } else if (event.key === 'ArrowRight') {
      state.activeIndex = Math.min(state.n - 1, state.activeIndex + 1);
      render();
    }
  });

  window.addEventListener('resize', () => render());

  render();
})();
