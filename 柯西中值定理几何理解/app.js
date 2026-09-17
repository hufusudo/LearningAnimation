/**
 * Cauchy's Mean Value Theorem Geometric Visualizer
 * Core Application Engine & Interactive Controls
 */

document.addEventListener('DOMContentLoaded', () => {
  // ==========================================
  // 1. Math Presets & State Definitions
  // ==========================================
  const SCALE = 45; // 1 unit in math coordinate = 45px in SVG canvas

  const PRESETS = {
    cubic: {
      name: '🌸 典型多项式参数曲线',
      tMin: -2.6,
      tMax: 2.6,
      defaultA: -2.0,
      defaultB: 2.0,
      defaultT: 0.5,
      g: (t) => 1.6 * t + 0.4 * t * t,
      dg: (t) => 1.6 + 0.8 * t,
      f: (t) => 2.4 * t - 0.5 * t * t * t + 0.2 * t * t,
      df: (t) => 2.4 - 1.5 * t * t + 0.4 * t
    },
    elliptic: {
      name: '🔄 椭圆与三角参数曲线',
      tMin: -2.5,
      tMax: 2.5,
      defaultA: -1.8,
      defaultB: 1.8,
      defaultT: 0.2,
      g: (t) => 3.6 * Math.cos(0.9 * t),
      dg: (t) => -3.24 * Math.sin(0.9 * t),
      f: (t) => 2.6 * Math.sin(1.1 * t),
      df: (t) => 2.86 * Math.cos(1.1 * t)
    },
    'multi-xi': {
      name: '〰️ S型多中值点曲线',
      tMin: -2.6,
      tMax: 2.6,
      defaultA: -2.2,
      defaultB: 2.2,
      defaultT: 0.0,
      g: (t) => 2.2 * t,
      dg: (t) => 2.2,
      f: (t) => 0.7 * t * t * t - 3.2 * t,
      df: (t) => 2.1 * t * t - 3.2
    },
    lagrange: {
      name: '📐 拉格朗日退化特例 (g(t)=t)',
      tMin: -2.8,
      tMax: 2.8,
      defaultA: -2.0,
      defaultB: 2.2,
      defaultT: 0.8,
      g: (t) => t,
      dg: (t) => 1.0,
      f: (t) => 0.25 * t * t * t - 1.6 * t,
      df: (t) => 0.75 * t * t - 1.6
    },
    rolle: {
      name: '⚖️ 罗尔定理退化特例 (f(a)=f(b))',
      tMin: -2.6,
      tMax: 2.6,
      defaultA: -2.0,
      defaultB: 2.0,
      defaultT: 0.0,
      g: (t) => 1.5 * t,
      dg: (t) => 1.5,
      f: (t) => 3.0 - 0.75 * t * t,
      df: (t) => -1.5 * t
    }
  };

  // Application Global State
  const state = {
    currentPresetKey: 'cubic',
    a: PRESETS.cubic.defaultA,
    b: PRESETS.cubic.defaultB,
    t: PRESETS.cubic.defaultT,
    showGuideline: true,
    showShadowBand: true,
    showGrid: true,
    isCruising: false,
    cruiseDir: 1,
    cruiseSpeed: 0.012,
    activeTab: 'tab-parametric'
  };

  // Dragging interaction state
  let activeDragHandle = null; // 'a', 'b', 'p'

  // ==========================================
  // 2. DOM Elements
  // ==========================================
  const svg = document.getElementById('param-svg');
  const canvasContainer = document.getElementById('canvas-container');

  // Curve paths & lines
  const pathCurveFull = document.getElementById('path-curve-full');
  const pathCurveActive = document.getElementById('path-curve-active');
  const polyShadowBand = document.getElementById('poly-shadow-band');
  const lineSecant = document.getElementById('line-secant');
  const lineSecantExt = document.getElementById('line-secant-ext');
  const labelSecantSlope = document.getElementById('label-secant-slope');
  const lineTangent = document.getElementById('line-tangent');
  const lineParallelGuide = document.getElementById('line-parallel-guide');
  const labelTangentSlope = document.getElementById('label-tangent-slope');
  const layerXiPoints = document.getElementById('layer-xi-points');

  // Interactive handles
  const handleA = document.getElementById('handle-a');
  const handleB = document.getElementById('handle-b');
  const handleP = document.getElementById('handle-p');

  // Grid
  const layerGrid = document.getElementById('layer-grid');

  // Status badges & texts
  const badgeACoords = document.getElementById('badge-a-coords');
  const badgeBCoords = document.getElementById('badge-b-coords');
  const badgePCoords = document.getElementById('badge-p-coords');
  const textXiValues = document.getElementById('text-xi-values');
  const readoutTVal = document.getElementById('readout-t-val');
  const valAText = document.getElementById('val-a-text');
  const valBText = document.getElementById('val-b-text');

  // Sliders
  const sliderT = document.getElementById('slider-t');
  const sliderA = document.getElementById('slider-a');
  const sliderB = document.getElementById('slider-b');
  const sliderTMinLabel = document.getElementById('slider-t-min-label');
  const sliderTMaxLabel = document.getElementById('slider-t-max-label');

  // Metric cards
  const metricSecantVal = document.getElementById('metric-secant-val');
  const metricTangentVal = document.getElementById('metric-tangent-val');
  const metricAngleDiff = document.getElementById('metric-angle-diff');
  const metricParallelSymbol = document.getElementById('metric-parallel-symbol');
  const metricParallelPercent = document.getElementById('metric-parallel-percent');
  const barParallel = document.getElementById('bar-parallel');
  const badgeParallelMatch = document.getElementById('badge-parallel-match');
  const dotParallel = document.getElementById('dot-parallel');
  const textParallelStatus = document.getElementById('text-parallel-status');

  // Auxiliary chart elements
  const pathAuxCurve = document.getElementById('path-aux-curve');
  const auxPointA = document.getElementById('aux-point-a');
  const auxPointB = document.getElementById('aux-point-b');
  const auxTextA = document.getElementById('aux-text-a');
  const auxTextB = document.getElementById('aux-text-b');
  const layerAuxXi = document.getElementById('layer-aux-xi');
  const auxCurrentPoint = document.getElementById('aux-current-point');

  // Action buttons
  const btnSnapXi = document.getElementById('btn-snap-xi');
  const btnAutoCruise = document.getElementById('btn-auto-cruise');
  const iconPlay = document.getElementById('icon-play');
  const labelAutoCruise = document.getElementById('label-auto-cruise');
  const btnReset = document.getElementById('btn-reset');

  // Presets
  const presetCubic = document.getElementById('preset-cubic');
  const presetElliptic = document.getElementById('preset-elliptic');
  const presetMultiXi = document.getElementById('preset-multi-xi');
  const presetLagrange = document.getElementById('preset-lagrange');
  const presetRolle = document.getElementById('preset-rolle');
  const presetButtons = {
    cubic: presetCubic,
    elliptic: presetElliptic,
    'multi-xi': presetMultiXi,
    lagrange: presetLagrange,
    rolle: presetRolle
  };

  // Toggles
  const toggleGuideline = document.getElementById('toggle-guideline');
  const toggleShadowBand = document.getElementById('toggle-shadow-band');
  const toggleGrid = document.getElementById('toggle-grid');

  // Tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // ==========================================
  // 3. Coordinate Conversion
  // ==========================================
  function toSvgX(mathX) {
    return mathX * SCALE;
  }
  function toSvgY(mathY) {
    return -mathY * SCALE; // Invert Y in SVG
  }
  function toMathX(svgX) {
    return svgX / SCALE;
  }
  function toMathY(svgY) {
    return -svgY / SCALE;
  }

  function getSvgPoint(evt) {
    const pt = svg.createSVGPoint();
    if (evt.touches && evt.touches.length > 0) {
      pt.x = evt.touches[0].clientX;
      pt.y = evt.touches[0].clientY;
    } else {
      pt.x = evt.clientX;
      pt.y = evt.clientY;
    }
    const ctm = svg.getScreenCTM();
    if (ctm) {
      return pt.matrixTransform(ctm.inverse());
    }
    const rect = svg.getBoundingClientRect();
    return {
      x: ((pt.x - rect.left) / rect.width) * 640 - 320,
      y: ((pt.y - rect.top) / rect.height) * 480 - 240
    };
  }

  // ==========================================
  // 4. Background Coordinate Grid
  // ==========================================
  function initGrid() {
    layerGrid.innerHTML = '';
    const rangeX = 8;
    const rangeY = 6;

    // Vertical grid lines
    for (let x = -rangeX; x <= rangeX; x++) {
      if (x === 0) continue;
      const svgX = toSvgX(x);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', svgX);
      line.setAttribute('y1', -240);
      line.setAttribute('x2', svgX);
      line.setAttribute('y2', 240);
      line.setAttribute('class', x % 2 === 0 ? 'grid-line' : 'grid-line-subtle');
      layerGrid.appendChild(line);

      if (x % 2 === 0) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', svgX);
        text.setAttribute('y', 13);
        text.setAttribute('font-size', '9');
        text.setAttribute('font-family', 'JetBrains Mono');
        text.setAttribute('fill', '#A8A29E');
        text.setAttribute('text-anchor', 'middle');
        text.textContent = x;
        layerGrid.appendChild(text);
      }
    }

    // Horizontal grid lines
    for (let y = -rangeY; y <= rangeY; y++) {
      if (y === 0) continue;
      const svgY = toSvgY(y);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', -320);
      line.setAttribute('y1', svgY);
      line.setAttribute('x2', 320);
      line.setAttribute('y2', svgY);
      line.setAttribute('class', y % 2 === 0 ? 'grid-line' : 'grid-line-subtle');
      layerGrid.appendChild(line);

      if (y % 2 === 0) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', -8);
        text.setAttribute('y', svgY + 3);
        text.setAttribute('font-size', '9');
        text.setAttribute('font-family', 'JetBrains Mono');
        text.setAttribute('fill', '#A8A29E');
        text.setAttribute('text-anchor', 'end');
        text.textContent = y;
        layerGrid.appendChild(text);
      }
    }
  }

  // ==========================================
  // 5. Numerical Root Finder for Mean Value Point(s) \xi
  // ==========================================
  function findXiRoots(preset, a, b) {
    const { g, dg, f, df } = preset;
    const ga = g(a), gb = g(b);
    const fa = f(a), fb = f(b);

    const deltaF = fb - fa;
    const deltaG = gb - ga;

    // Target derivative function: F'(t) = deltaF * g'(t) - deltaG * f'(t) = 0
    function dF(t) {
      return deltaF * dg(t) - deltaG * df(t);
    }

    const roots = [];
    const numSamples = 240;
    const dt = (b - a) / numSamples;

    let prevT = a;
    let prevVal = dF(a);

    for (let i = 1; i <= numSamples; i++) {
      const curT = a + i * dt;
      const curVal = dF(curT);

      // Check for sign change across interval [prevT, curT]
      if (prevVal * curVal <= 0 && Math.abs(prevVal - curVal) > 1e-12) {
        // Refine root with bisection
        let low = prevT;
        let high = curT;
        for (let iter = 0; iter < 24; iter++) {
          const mid = (low + high) / 2;
          const midVal = dF(mid);
          if (Math.abs(midVal) < 1e-9) {
            low = mid;
            break;
          }
          if (midVal * dF(low) <= 0) {
            high = mid;
          } else {
            low = mid;
          }
        }
        const root = (low + high) / 2;
        // Verify root is strictly inside (a, b)
        if (root > a + 0.001 && root < b - 0.001) {
          // Avoid duplicates
          if (!roots.some(r => Math.abs(r - root) < 0.015)) {
            roots.push(root);
          }
        }
      }
      prevT = curT;
      prevVal = curVal;
    }

    return roots;
  }

  // ==========================================
  // 6. Comprehensive Math Calculations
  // ==========================================
  function computeMVTMath() {
    const preset = PRESETS[state.currentPresetKey];
    const { a, b, t } = state;
    const { g, dg, f, df, tMin, tMax } = preset;

    // Endpoints
    const ga = g(a), fa = f(a);
    const gb = g(b), fb = f(b);

    // Current point P(t)
    const gt = g(t), ft = f(t);
    const dgt = dg(t), dft = df(t);

    // Secant slope: k_secant = (fb - fa) / (gb - ga)
    const deltaG = gb - ga;
    const deltaF = fb - fa;
    let kSecant = 0;
    let isSecantVertical = false;
    if (Math.abs(deltaG) < 1e-5) {
      isSecantVertical = true;
      kSecant = deltaF >= 0 ? 9999 : -9999;
    } else {
      kSecant = deltaF / deltaG;
    }

    // Tangent slope at t: k_tangent = f'(t) / g'(t)
    let kTangent = 0;
    let isTangentVertical = false;
    if (Math.abs(dgt) < 1e-5) {
      isTangentVertical = true;
      kTangent = dft >= 0 ? 9999 : -9999;
    } else {
      kTangent = dft / dgt;
    }

    // Angle of secant and tangent lines in degrees [-90, 90]
    const thetaSecant = (Math.atan2(deltaF, deltaG) * 180) / Math.PI;
    const thetaTangent = (Math.atan2(dft, dgt) * 180) / Math.PI;

    // Angle deviation |Delta theta|
    let angleDiff = Math.abs(thetaTangent - thetaSecant);
    if (angleDiff > 180) angleDiff = 360 - angleDiff;
    if (angleDiff > 90) angleDiff = Math.abs(180 - angleDiff);

    // Parallel match check (less than 0.35 deg difference)
    const isParallel = angleDiff < 0.35;
    const parallelScore = Math.max(0, Math.min(100, 100 - (angleDiff / 45) * 100));

    // Find all xi roots
    const xiRoots = findXiRoots(preset, a, b);

    // Auxiliary Function F(t) values
    function getAuxVal(paramT) {
      return deltaF * g(paramT) - deltaG * f(paramT);
    }
    const auxBase = getAuxVal(a); // F(a) = F(b)
    const auxT = getAuxVal(t) - auxBase;

    return {
      preset,
      a, b, t,
      tMin, tMax,
      ga, fa, gb, fb,
      gt, ft, dgt, dft,
      deltaG, deltaF,
      kSecant, isSecantVertical,
      kTangent, isTangentVertical,
      thetaSecant, thetaTangent,
      angleDiff, isParallel, parallelScore,
      xiRoots,
      getAuxVal, auxBase, auxT
    };
  }

  // ==========================================
  // 7. Render Canvas & UI Engine
  // ==========================================
  function render() {
    const math = computeMVTMath();
    const {
      preset, a, b, t, tMin, tMax,
      ga, fa, gb, fb, gt, ft, dgt, dft,
      kSecant, kTangent, angleDiff, isParallel, parallelScore,
      xiRoots, getAuxVal, auxBase, auxT
    } = math;

    const { g, f } = preset;

    // SVG coordinates for A, B, P
    const aSvgX = toSvgX(ga), aSvgY = toSvgY(fa);
    const bSvgX = toSvgX(gb), bSvgY = toSvgY(fb);
    const pSvgX = toSvgX(gt), pSvgY = toSvgY(ft);

    // 1. Draw Full Parametric Curve Context
    let pathFullD = '';
    const fullSteps = 160;
    for (let i = 0; i <= fullSteps; i++) {
      const curT = tMin + (i / fullSteps) * (tMax - tMin);
      const curX = toSvgX(g(curT));
      const curY = toSvgY(f(curT));
      if (i === 0) pathFullD += `M ${curX.toFixed(1)} ${curY.toFixed(1)}`;
      else pathFullD += ` L ${curX.toFixed(1)} ${curY.toFixed(1)}`;
    }
    pathCurveFull.setAttribute('d', pathFullD);

    // 2. Draw Active Curve Segment [a, b]
    let pathActiveD = '';
    const activeSteps = 120;
    for (let i = 0; i <= activeSteps; i++) {
      const curT = a + (i / activeSteps) * (b - a);
      const curX = toSvgX(g(curT));
      const curY = toSvgY(f(curT));
      if (i === 0) pathActiveD += `M ${curX.toFixed(1)} ${curY.toFixed(1)}`;
      else pathActiveD += ` L ${curX.toFixed(1)} ${curY.toFixed(1)}`;
    }
    pathCurveActive.setAttribute('d', pathActiveD);

    // 3. Draw Secant Line AB
    lineSecant.setAttribute('x1', aSvgX);
    lineSecant.setAttribute('y1', aSvgY);
    lineSecant.setAttribute('x2', bSvgX);
    lineSecant.setAttribute('y2', bSvgY);

    // Extended dashed line for secant
    const secLen = Math.hypot(bSvgX - aSvgX, bSvgY - aSvgY) || 1;
    const secDirX = (bSvgX - aSvgX) / secLen;
    const secDirY = (bSvgY - aSvgY) / secLen;
    lineSecantExt.setAttribute('x1', aSvgX - secDirX * 120);
    lineSecantExt.setAttribute('y1', aSvgY - secDirY * 120);
    lineSecantExt.setAttribute('x2', bSvgX + secDirX * 120);
    lineSecantExt.setAttribute('y2', bSvgY + secDirY * 120);

    // Secant slope label
    const midSecX = (aSvgX + bSvgX) / 2;
    const midSecY = (aSvgY + bSvgY) / 2;
    labelSecantSlope.setAttribute('x', midSecX + secDirY * 14);
    labelSecantSlope.setAttribute('y', midSecY - secDirX * 14);
    labelSecantSlope.setAttribute('text-anchor', 'middle');
    labelSecantSlope.textContent = `割线 k_割 = ${math.isSecantVertical ? '∞' : kSecant.toFixed(3)}`;

    // 4. Draw Tangent Line at P(t)
    const tanLen = Math.hypot(dgt, dft) || 1;
    const tanUnitSvgX = toSvgX(dgt) / (tanLen * SCALE);
    const tanUnitSvgY = toSvgY(dft) / (tanLen * SCALE);

    const tangentSpan = 110;
    lineTangent.setAttribute('x1', pSvgX - tanUnitSvgX * tangentSpan);
    lineTangent.setAttribute('y1', pSvgY - tanUnitSvgY * tangentSpan);
    lineTangent.setAttribute('x2', pSvgX + tanUnitSvgX * tangentSpan);
    lineTangent.setAttribute('y2', pSvgY + tanUnitSvgY * tangentSpan);

    labelTangentSlope.setAttribute('x', pSvgX + tanUnitSvgX * (tangentSpan + 8));
    labelTangentSlope.setAttribute('y', pSvgY + tanUnitSvgY * (tangentSpan + 8) + 4);
    labelTangentSlope.textContent = `切线 k_切 = ${math.isTangentVertical ? '∞' : kTangent.toFixed(3)}`;

    // 5. Draw Parallel Guideline & Shadow Band
    if (state.showGuideline) {
      lineParallelGuide.style.display = 'inline';
      lineParallelGuide.setAttribute('x1', pSvgX - secDirX * tangentSpan);
      lineParallelGuide.setAttribute('y1', pSvgY - secDirY * tangentSpan);
      lineParallelGuide.setAttribute('x2', pSvgX + secDirX * tangentSpan);
      lineParallelGuide.setAttribute('y2', pSvgY + secDirY * tangentSpan);
    } else {
      lineParallelGuide.style.display = 'none';
    }

    if (state.showShadowBand) {
      polyShadowBand.style.display = 'inline';
      polyShadowBand.setAttribute('points', `${aSvgX},${aSvgY} ${bSvgX},${bSvgY} ${pSvgX},${pSvgY}`);
    } else {
      polyShadowBand.style.display = 'none';
    }

    // 6. Draw Mean Value Points Xi on Curve
    layerXiPoints.innerHTML = '';
    xiRoots.forEach((xi, idx) => {
      const xiX = toSvgX(g(xi));
      const xiY = toSvgY(f(xi));

      const gXi = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      gXi.setAttribute('class', 'pulse-parallel');

      // Outer gold aura
      const aura = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      aura.setAttribute('cx', xiX);
      aura.setAttribute('cy', xiY);
      aura.setAttribute('r', '11');
      aura.setAttribute('fill', '#EAB308');
      aura.setAttribute('fill-opacity', '0.25');

      // Inner dot
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', xiX);
      dot.setAttribute('cy', xiY);
      dot.setAttribute('r', '4.5');
      dot.setAttribute('fill', '#E11D48');
      dot.setAttribute('stroke', '#FFFFFF');
      dot.setAttribute('stroke-width', '1.5');

      // Text label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', xiX + 8);
      text.setAttribute('y', xiY - 8);
      text.setAttribute('font-size', '11');
      text.setAttribute('font-family', 'JetBrains Mono');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('fill', '#BE123C');
      text.textContent = `ξ${xiRoots.length > 1 ? idx + 1 : ''}=${xi.toFixed(2)}`;

      gXi.appendChild(aura);
      gXi.appendChild(dot);
      gXi.appendChild(text);
      layerXiPoints.appendChild(gXi);
    });

    // 7. Update Draggable Handles
    handleA.setAttribute('transform', `translate(${aSvgX}, ${aSvgY})`);
    handleB.setAttribute('transform', `translate(${bSvgX}, ${bSvgY})`);
    handleP.setAttribute('transform', `translate(${pSvgX}, ${pSvgY})`);

    // 8. Update Badges and Coordinate Displays
    badgeACoords.textContent = `(${ga.toFixed(2)}, ${fa.toFixed(2)})`;
    badgeBCoords.textContent = `(${gb.toFixed(2)}, ${fb.toFixed(2)})`;
    badgePCoords.textContent = `(${gt.toFixed(2)}, ${ft.toFixed(2)})`;

    if (xiRoots.length > 0) {
      textXiValues.textContent = xiRoots.map((r, i) => `ξ${xiRoots.length > 1 ? i + 1 : ''}=${r.toFixed(2)}`).join(', ');
    } else {
      textXiValues.textContent = '计算中...';
    }

    readoutTVal.textContent = `t = ${t.toFixed(3)}`;
    valAText.textContent = `a = ${a.toFixed(2)}`;
    valBText.textContent = `b = ${b.toFixed(2)}`;

    // Update Slider Ranges & Values
    sliderT.min = a;
    sliderT.max = b;
    sliderT.value = t;
    sliderTMinLabel.textContent = `a=${a.toFixed(1)}`;
    sliderTMaxLabel.textContent = `b=${b.toFixed(1)}`;

    sliderA.value = a;
    sliderB.value = b;

    // 9. Update Metrics and Parallelism Inspector
    metricSecantVal.textContent = math.isSecantVertical ? 'k = ∞' : `k = ${kSecant.toFixed(3)}`;
    metricTangentVal.textContent = math.isTangentVertical ? 'k = ∞' : `k = ${kTangent.toFixed(3)}`;
    metricAngleDiff.textContent = `Δθ = ${angleDiff.toFixed(1)}°`;

    metricParallelPercent.textContent = `${parallelScore.toFixed(1)}% (偏差 ${angleDiff.toFixed(1)}°)`;
    barParallel.style.width = `${parallelScore}%`;

    if (isParallel) {
      metricParallelSymbol.textContent = '∥';
      metricParallelSymbol.className = 'text-xl font-bold text-amber-600';
      badgeParallelMatch.className = 'px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold flex items-center gap-1.5 bg-amber-50 text-amber-900 border border-amber-300 pulse-parallel';
      dotParallel.className = 'w-2 h-2 rounded-full bg-amber-500';
      textParallelStatus.textContent = `⚡ 发现柯西中值点！切线与割线严格平行 (Δθ = ${angleDiff.toFixed(2)}°)`;
    } else {
      metricParallelSymbol.textContent = '∦';
      metricParallelSymbol.className = 'text-xl font-bold text-stone-400';
      badgeParallelMatch.className = 'px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold flex items-center gap-1.5 bg-stone-100 text-stone-700 border border-[#E5E4DC]';
      dotParallel.className = 'w-2 h-2 rounded-full bg-stone-400';
      textParallelStatus.textContent = `切线与割线夹角偏差: ${angleDiff.toFixed(1)}°`;
    }

    // 10. Update Auxiliary Function Plot F(t)
    renderAuxChart(math);
  }

  // ==========================================
  // 8. Auxiliary Function F(t) Chart Renderer
  // ==========================================
  function renderAuxChart(math) {
    if (!pathAuxCurve) return;
    const { a, b, t, xiRoots, getAuxVal, auxBase, auxT } = math;

    // Coordinate mapping: t in [a, b] -> SVG x in [-85, 85]
    function mapAuxX(paramT) {
      return -85 + ((paramT - a) / (b - a)) * 170;
    }

    // Find max amplitude of F(t) - auxBase across [a, b]
    let maxAmp = 0.1;
    const sampleSteps = 60;
    const vals = [];
    for (let i = 0; i <= sampleSteps; i++) {
      const curT = a + (i / sampleSteps) * (b - a);
      const v = getAuxVal(curT) - auxBase;
      vals.push(v);
      if (Math.abs(v) > maxAmp) maxAmp = Math.abs(v);
    }

    // Map F(t) value to SVG y: baseline at 50, scale up to 45px amplitude
    function mapAuxY(v) {
      return 50 - (v / maxAmp) * 38;
    }

    // Draw F(t) curve
    let pathD = '';
    for (let i = 0; i <= sampleSteps; i++) {
      const curT = a + (i / sampleSteps) * (b - a);
      const svgX = mapAuxX(curT);
      const svgY = mapAuxY(vals[i]);
      if (i === 0) pathD += `M ${svgX.toFixed(1)} ${svgY.toFixed(1)}`;
      else pathD += ` L ${svgX.toFixed(1)} ${svgY.toFixed(1)}`;
    }
    pathAuxCurve.setAttribute('d', pathD);

    // Endpoints A and B on baseline
    auxPointA.setAttribute('cx', -85);
    auxPointA.setAttribute('cy', 50);
    auxTextA.setAttribute('x', -85);
    auxTextA.textContent = `a=${a.toFixed(1)}`;

    auxPointB.setAttribute('cx', 85);
    auxPointB.setAttribute('cy', 50);
    auxTextB.setAttribute('x', 85);
    auxTextB.textContent = `b=${b.toFixed(1)}`;

    // Current point on F(t)
    auxCurrentPoint.setAttribute('cx', mapAuxX(t));
    auxCurrentPoint.setAttribute('cy', mapAuxY(auxT));

    // Xi Stationary points on F(t)
    layerAuxXi.innerHTML = '';
    xiRoots.forEach(xi => {
      const xiVal = getAuxVal(xi) - auxBase;
      const xiSvgX = mapAuxX(xi);
      const xiSvgY = mapAuxY(xiVal);

      // Tangent horizontal line at peak/valley
      const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hLine.setAttribute('x1', xiSvgX - 16);
      hLine.setAttribute('y1', xiSvgY);
      hLine.setAttribute('x2', xiSvgX + 16);
      hLine.setAttribute('y2', xiSvgY);
      hLine.setAttribute('stroke', '#E11D48');
      hLine.setAttribute('stroke-width', '1.5');
      hLine.setAttribute('stroke-dasharray', '2 2');

      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', xiSvgX);
      dot.setAttribute('cy', xiSvgY);
      dot.setAttribute('r', '3.5');
      dot.setAttribute('fill', '#E11D48');

      layerAuxXi.appendChild(hLine);
      layerAuxXi.appendChild(dot);
    });
  }

  // ==========================================
  // 9. Direct Canvas Dragging (Pointer Events)
  // ==========================================
  function onPointerDown(evt) {
    const pt = getSvgPoint(evt);
    const mathX = toMathX(pt.x);
    const mathY = toMathY(pt.y);

    const preset = PRESETS[state.currentPresetKey];
    const ga = preset.g(state.a), fa = preset.f(state.a);
    const gb = preset.g(state.b), fb = preset.f(state.b);
    const gp = preset.g(state.t), fp = preset.f(state.t);

    const distA = Math.hypot(mathX - ga, mathY - fa);
    const distB = Math.hypot(mathX - gb, mathY - fb);
    const distP = Math.hypot(mathX - gp, mathY - fp);

    const grabRadius = 0.85;

    if (distP < grabRadius && distP <= distA && distP <= distB) {
      activeDragHandle = 'p';
      handleP.classList.add('is-dragging');
      evt.preventDefault();
    } else if (distA < grabRadius && distA <= distB) {
      activeDragHandle = 'a';
      handleA.classList.add('is-dragging');
      evt.preventDefault();
    } else if (distB < grabRadius) {
      activeDragHandle = 'b';
      handleB.classList.add('is-dragging');
      evt.preventDefault();
    }
  }

  function onPointerMove(evt) {
    if (!activeDragHandle) return;

    const pt = getSvgPoint(evt);
    const mathX = toMathX(pt.x);
    const mathY = toMathY(pt.y);

    const preset = PRESETS[state.currentPresetKey];
    const { g, f, tMin, tMax } = preset;

    // Find parameter t closest to (mathX, mathY)
    function findClosestT(rangeStart, rangeEnd) {
      let bestT = rangeStart;
      let minDist = Infinity;
      const steps = 100;
      for (let i = 0; i <= steps; i++) {
        const curT = rangeStart + (i / steps) * (rangeEnd - rangeStart);
        const d = Math.hypot(mathX - g(curT), mathY - f(curT));
        if (d < minDist) {
          minDist = d;
          bestT = curT;
        }
      }
      return bestT;
    }

    if (activeDragHandle === 'p') {
      state.t = Math.max(state.a, Math.min(state.b, findClosestT(state.a, state.b)));
    } else if (activeDragHandle === 'a') {
      const newA = Math.max(tMin, Math.min(state.b - 0.2, findClosestT(tMin, state.b - 0.2)));
      state.a = Math.round(newA * 100) / 100;
      if (state.t < state.a) state.t = state.a;
    } else if (activeDragHandle === 'b') {
      const newB = Math.max(state.a + 0.2, Math.min(tMax, findClosestT(state.a + 0.2, tMax)));
      state.b = Math.round(newB * 100) / 100;
      if (state.t > state.b) state.t = state.b;
    }

    render();
  }

  function onPointerUp() {
    activeDragHandle = null;
    handleA.classList.remove('is-dragging');
    handleB.classList.remove('is-dragging');
    handleP.classList.remove('is-dragging');
  }

  canvasContainer.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  // ==========================================
  // 10. Slider Listeners
  // ==========================================
  sliderT.addEventListener('input', (e) => {
    state.t = parseFloat(e.target.value);
    render();
  });

  sliderA.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (val >= state.b - 0.1) {
      state.a = state.b - 0.1;
    } else {
      state.a = val;
    }
    if (state.t < state.a) state.t = state.a;
    render();
  });

  sliderB.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (val <= state.a + 0.1) {
      state.b = state.a + 0.1;
    } else {
      state.b = val;
    }
    if (state.t > state.b) state.t = state.b;
    render();
  });

  // Toggles
  toggleGuideline.addEventListener('change', (e) => {
    state.showGuideline = e.target.checked;
    render();
  });
  toggleShadowBand.addEventListener('change', (e) => {
    state.showShadowBand = e.target.checked;
    render();
  });
  toggleGrid.addEventListener('change', (e) => {
    state.showGrid = e.target.checked;
    layerGrid.style.display = state.showGrid ? 'inline' : 'none';
  });

  // ==========================================
  // 11. GSAP Snap to Mean Value Point \xi
  // ==========================================
  btnSnapXi.addEventListener('click', () => {
    const math = computeMVTMath();
    const { xiRoots, t } = math;

    if (!xiRoots || xiRoots.length === 0) return;

    // Find the closest xi to current t
    let targetXi = xiRoots[0];
    let minDist = Math.abs(t - targetXi);
    for (let i = 1; i < xiRoots.length; i++) {
      const d = Math.abs(t - xiRoots[i]);
      if (d < minDist) {
        minDist = d;
        targetXi = xiRoots[i];
      }
    }

    // GSAP tween t smoothly to targetXi
    if (typeof gsap !== 'undefined') {
      gsap.killTweensOf(state);
      gsap.to(state, {
        t: targetXi,
        duration: 0.65,
        ease: 'power3.out',
        onUpdate: render
      });
    } else {
      state.t = targetXi;
      render();
    }
  });

  // ==========================================
  // 12. Switch Presets with GSAP
  // ==========================================
  function switchPreset(key) {
    if (!PRESETS[key]) return;
    state.currentPresetKey = key;

    // Update preset button states
    Object.keys(presetButtons).forEach(k => {
      const btn = presetButtons[k];
      if (k === key) {
        btn.className = 'btn-action px-2.5 py-1 rounded bg-white font-medium text-stone-800 border border-[#E5E4DC] hover:border-stone-400 shadow-sm';
      } else {
        btn.className = 'btn-action px-2.5 py-1 rounded hover:bg-white text-stone-700 hover:text-stone-900 transition-colors';
      }
    });

    const preset = PRESETS[key];
    const targetA = preset.defaultA;
    const targetB = preset.defaultB;
    const targetT = preset.defaultT;

    if (typeof gsap !== 'undefined') {
      gsap.killTweensOf(state);
      gsap.to(state, {
        a: targetA,
        b: targetB,
        t: targetT,
        duration: 0.75,
        ease: 'power2.out',
        onUpdate: render
      });
    } else {
      state.a = targetA;
      state.b = targetB;
      state.t = targetT;
      render();
    }
  }

  presetCubic.addEventListener('click', () => switchPreset('cubic'));
  presetElliptic.addEventListener('click', () => switchPreset('elliptic'));
  presetMultiXi.addEventListener('click', () => switchPreset('multi-xi'));
  presetLagrange.addEventListener('click', () => switchPreset('lagrange'));
  presetRolle.addEventListener('click', () => switchPreset('rolle'));

  btnReset.addEventListener('click', () => {
    switchPreset(state.currentPresetKey);
  });

  // ==========================================
  // 13. Auto Cruise Along Parametric Curve
  // ==========================================
  let cruiseRafId = null;

  function toggleCruise() {
    state.isCruising = !state.isCruising;

    if (state.isCruising) {
      btnAutoCruise.classList.add('bg-emerald-50', 'border-emerald-300', 'text-emerald-800');
      iconPlay.innerHTML = '<rect x="4" y="4" width="4" height="12" /><rect x="12" y="4" width="4" height="12" />';
      labelAutoCruise.textContent = '暂停巡航';
      runCruise();
    } else {
      btnAutoCruise.classList.remove('bg-emerald-50', 'border-emerald-300', 'text-emerald-800');
      iconPlay.innerHTML = '<polygon points="5 3 19 10 5 17" />';
      labelAutoCruise.textContent = '自动巡航扫描';
      if (cruiseRafId) {
        cancelAnimationFrame(cruiseRafId);
        cruiseRafId = null;
      }
    }
  }

  function runCruise() {
    if (!state.isCruising) return;

    state.t += state.cruiseDir * state.cruiseSpeed;

    if (state.t >= state.b) {
      state.t = state.b;
      state.cruiseDir = -1;
    } else if (state.t <= state.a) {
      state.t = state.a;
      state.cruiseDir = 1;
    }

    render();
    cruiseRafId = requestAnimationFrame(runCruise);
  }

  btnAutoCruise.addEventListener('click', toggleCruise);

  // ==========================================
  // 14. Tab Switcher
  // ==========================================
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');

      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      tabContents.forEach(content => {
        if (content.id === targetId) {
          content.classList.remove('hidden');
          if (typeof gsap !== 'undefined') {
            gsap.fromTo(content, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' });
          }
        } else {
          content.classList.add('hidden');
        }
      });

      state.activeTab = targetId;
    });
  });

  // ==========================================
  // 15. KaTeX Formula Rendering
  // ==========================================
  function renderAllMath() {
    if (typeof renderMathInElement === 'function') {
      renderMathInElement(document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    }
  }

  // ==========================================
  // 16. Initialization
  // ==========================================
  initGrid();
  render();

  setTimeout(() => {
    renderAllMath();
  }, 100);
});
