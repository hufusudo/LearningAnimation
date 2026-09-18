/**
 * 极限定义的几何直观 (Geometric Intuition of Limits)
 * 核心数学引擎与交互渲染：支持沿 x 轴渐进放大邻域 (Progressive Zoom) 与 趋向无穷演播
 */

(function () {
  'use strict';

  // ==================== 全局状态 ====================
  const state = {
    mode: 'continuous',     // 'continuous' | 'discrete' | 'compare'
    a: 2.0,                // 极限目标值 y = a
    c: 0.35,               // 邻域误差半径 ε = c
    xProbe: 11.5,          // 探针位置 x0 (连续) 或 n0 (离散)
    selectedContinuous: 'c-damped-sin',
    selectedDiscrete: 'd-alt-harmonic',

    // 核心创新：随着 x 增大渐进放大邻域（解决无穷远压缩难题）
    progressiveZoom: true, // 开启沿 x 轴渐进放大
    zoomIntensity: 3.0,     // x = 25 处的放大倍率 (1.0x ~ 4.5x)
    followZoom: false,      // 动点随动摄像机变焦

    toggles: {
      band: true,
      safeZone: true,
      errorBar: true,
      grid: true
    },

    // 数学显示区间
    xMin: 0,
    xMax: 25,
    yMin: -0.8,
    yMax: 4.8,

    // 画布像素尺寸
    svgWidth: 800,
    svgHeight: 500,
    padLeft: 80,
    padRight: 35,
    padTop: 35,
    padBottom: 65,

    isCruising: false,
    cruiseDirection: 1
  };

  // ==================== 数学模型集合 ====================
  const continuousModels = {
    'c-damped-sin': {
      name: '阻尼正弦振荡',
      katexExpr: 'f(x) = a + \\frac{2.5\\sin(2x)}{x^{0.85} + 0.4}',
      fn: (x, a) => a + (2.5 * Math.sin(2 * x)) / (Math.pow(x, 0.85) + 0.4)
    },
    'c-exp-decay': {
      name: '指数衰减余弦波',
      katexExpr: 'f(x) = a + 2.8 e^{-0.18x} \\cos(1.2x)',
      fn: (x, a) => a + 2.8 * Math.exp(-0.18 * x) * Math.cos(1.2 * x)
    },
    'c-monotone': {
      name: '单调双曲逼近',
      katexExpr: 'f(x) = a - \\frac{3.2}{x^{0.8} + 1}',
      fn: (x, a) => a - 3.2 / (Math.pow(x, 0.8) + 1)
    },
    'c-rational': {
      name: '有理波动衰减',
      katexExpr: 'f(x) = a + \\frac{3.5 \\cos(1.2x)}{x + 1}',
      fn: (x, a) => a + (3.5 * Math.cos(1.2 * x)) / (x + 1)
    }
  };

  const discreteModels = {
    'd-alt-harmonic': {
      name: '交错衰减数列',
      katexExpr: 'a_n = a + \\frac{3.5 (-1)^n}{n^{0.75}}',
      fn: (n, a) => a + (3.5 * Math.pow(-1, n)) / Math.pow(n, 0.75)
    },
    'd-sin-scatter': {
      name: '散点周期震荡',
      katexExpr: 'a_n = a + \\frac{3.0 \\sin(1.2n)}{n^{0.65}}',
      fn: (n, a) => a + (3.0 * Math.sin(1.2 * n)) / Math.pow(n, 0.65)
    },
    'd-monotone': {
      name: '单调递增数列',
      katexExpr: 'a_n = a - \\frac{3.2}{\\sqrt{n}}',
      fn: (n, a) => a - 3.2 / Math.sqrt(n)
    },
    'd-positive-decay': {
      name: '单边递减收敛',
      katexExpr: 'a_n = a + \\frac{3.6}{n^{0.8}}',
      fn: (n, a) => a + 3.6 / Math.pow(n, 0.8)
    }
  };

  // ==================== 渐进放大与动态坐标映射 ====================
  /**
   * 在自变量 x 处计算局部纵向放大系数
   * 使得随着 x 增大，邻域与振荡细节在视觉上按比例展开放大
   */
  function getZoomFactorAtX(x) {
    let factor = 1.0;
    if (state.progressiveZoom) {
      const t = Math.max(0, Math.min(1, (x - state.xMin) / (state.xMax - state.xMin)));
      factor *= (1.0 + (state.zoomIntensity - 1.0) * Math.pow(t, 1.15));
    }
    if (state.followZoom) {
      // 动点随动变焦：探针越往右，相机额外深度放大
      const tProbe = Math.max(0, Math.min(1, (state.xProbe - state.xMin) / (state.xMax - state.xMin)));
      factor *= (1.0 + 1.6 * Math.pow(tProbe, 1.2));
    }
    return factor;
  }

  /**
   * 考虑渐进放大后的等效 Y 坐标计算
   * 关键数学性质：y=a 中心线保持不变；所有纵向偏移 (y-a) 均乘以局部放大系数
   */
  function getEffectiveY(x, y) {
    const zoom = getZoomFactorAtX(x);
    return state.a + (y - state.a) * zoom;
  }

  function mathToSvgX(x) {
    const plotW = state.svgWidth - state.padLeft - state.padRight;
    return state.padLeft + ((x - state.xMin) / (state.xMax - state.xMin)) * plotW;
  }

  function mathToSvgY(y) {
    const plotH = state.svgHeight - state.padTop - state.padBottom;
    return state.svgHeight - state.padBottom - ((y - state.yMin) / (state.yMax - state.yMin)) * plotH;
  }

  function svgToMathX(px) {
    const plotW = state.svgWidth - state.padLeft - state.padRight;
    const clampedPx = Math.max(state.padLeft, Math.min(state.svgWidth - state.padRight, px));
    return state.xMin + ((clampedPx - state.padLeft) / plotW) * (state.xMax - state.xMin);
  }

  // ==================== 门槛点数值求解器 ====================
  /**
   * 求解连续函数门槛 X：对于所有 x > X，恒有 |f(x) - a| < c
   * 注：由于 getZoomFactorAtX(x) > 0，不等式 |(f(x)-a)*Zoom| < c*Zoom 与 |f(x)-a| < c 完全等价！
   * 渐进放大严格保持门槛点的不变性！
   */
  function solveContinuousThreshold(fn, a, c) {
    const samples = 1000;
    const step = (state.xMax - 0.1) / samples;
    let rightmostViolationX = null;

    for (let i = samples; i >= 1; i--) {
      const x = i * step;
      if (Math.abs(fn(x, a) - a) >= c - 1e-7) {
        rightmostViolationX = x;
        break;
      }
    }

    if (rightmostViolationX === null) {
      return 0.1;
    }

    if (rightmostViolationX >= state.xMax - step) {
      return state.xMax;
    }

    // 二分法精炼求根
    let xLeft = rightmostViolationX;
    let xRight = Math.min(state.xMax, rightmostViolationX + step * 2);
    for (let iter = 0; iter < 12; iter++) {
      const xMid = (xLeft + xRight) / 2;
      if (Math.abs(fn(xMid, a) - a) >= c) {
        xLeft = xMid;
      } else {
        xRight = xMid;
      }
    }

    return xRight;
  }

  /**
   * 求解离散数列门槛 N：对于所有正整数 n > N，恒有 |a_n - a| < c
   */
  function solveDiscreteThreshold(fn, a, c, maxN = 25) {
    let rightmostViolationN = 0;
    for (let n = maxN; n >= 1; n--) {
      if (Math.abs(fn(n, a) - a) >= c - 1e-7) {
        rightmostViolationN = n;
        break;
      }
    }
    return rightmostViolationN;
  }

  // ==================== DOM 元素缓存 ====================
  const dom = {
    svg: document.getElementById('limit-svg'),
    canvasContainer: document.getElementById('canvas-container'),
    layerGrid: document.getElementById('layer-grid'),
    layerContinuous: document.getElementById('layer-continuous'),
    layerDiscrete: document.getElementById('layer-discrete'),
    pathFunction: document.getElementById('path-function'),
    pathBand: document.getElementById('path-band'),
    pathBandTint: document.getElementById('path-band-tint'),
    pathSafeZone: document.getElementById('path-safe-zone'),
    pathUpperC: document.getElementById('path-upper-c'),
    pathLowerC: document.getElementById('path-lower-c'),
    textUpperC: document.getElementById('text-upper-c'),
    textLowerC: document.getElementById('text-lower-c'),
    textBandZoomNote: document.getElementById('text-band-zoom-note'),
    lineLimitA: document.getElementById('line-limit-a'),
    textLimitA: document.getElementById('text-limit-a'),
    tickA: document.getElementById('tick-a'),
    textTickA: document.getElementById('text-tick-a'),
    lineThresh: document.getElementById('line-thresh'),
    textThresh: document.getElementById('text-thresh'),
    textSafeLabel: document.getElementById('text-safe-label'),
    badgeValA: document.getElementById('badge-val-a'),
    badgeValC: document.getElementById('badge-val-c'),
    badgeInterval: document.getElementById('badge-interval'),
    badgeThreshLabel: document.getElementById('badge-thresh-label'),
    badgeThreshVal: document.getElementById('badge-thresh-val'),
    labelAxisX: document.getElementById('label-axis-x'),
    circleProbe: document.getElementById('circle-probe'),
    lineProbeError: document.getElementById('line-probe-error'),
    lineProbeDrop: document.getElementById('line-probe-drop'),
    rectProbeTag: document.getElementById('rect-probe-tag'),
    textProbeTag: document.getElementById('text-probe-tag'),
    canvasProbeStatus: document.getElementById('canvas-probe-status'),
    sliderA: document.getElementById('slider-a'),
    sliderC: document.getElementById('slider-c'),
    sliderProbe: document.getElementById('slider-probe'),
    sliderZoom: document.getElementById('slider-zoom'),
    textSliderA: document.getElementById('text-slider-a'),
    textSliderC: document.getElementById('text-slider-c'),
    textSliderProbe: document.getElementById('text-slider-probe'),
    textZoomIntensity: document.getElementById('text-zoom-intensity'),
    badgeZoomFactor: document.getElementById('badge-zoom-factor'),
    labelProbeSlider: document.getElementById('label-probe-slider'),
    inspectValF: document.getElementById('inspect-val-f'),
    inspectDiff: document.getElementById('inspect-diff'),
    inspectC: document.getElementById('inspect-c'),
    inspectThresh: document.getElementById('inspect-thresh'),
    boxVerification: document.getElementById('box-verification'),
    textVerifTitle: document.getElementById('text-verif-title'),
    textVerifDesc: document.getElementById('text-verif-desc'),
    katexDefinition: document.getElementById('katex-definition'),
    katexValuation: document.getElementById('katex-valuation'),
    tabContinuous: document.getElementById('tab-continuous'),
    tabDiscrete: document.getElementById('tab-discrete'),
    tabCompare: document.getElementById('tab-compare'),
    groupPresetsContinuous: document.getElementById('group-presets-continuous'),
    groupPresetsDiscrete: document.getElementById('group-presets-discrete'),
    btnAnimC: document.getElementById('btn-anim-c'),
    btnInfiniteJourney: document.getElementById('btn-infinite-journey'),
    btnAutoCruise: document.getElementById('btn-auto-cruise'),
    labelAutoCruise: document.getElementById('label-auto-cruise'),
    btnReset: document.getElementById('btn-reset'),
    toggleProgressiveZoom: document.getElementById('toggle-progressive-zoom'),
    toggleFollowZoom: document.getElementById('toggle-follow-zoom'),
    toggleBand: document.getElementById('toggle-band'),
    toggleSafeZone: document.getElementById('toggle-safe-zone'),
    toggleErrorBar: document.getElementById('toggle-error-bar'),
    toggleGrid: document.getElementById('toggle-grid')
  };

  // ==================== 渲染坐标网格与刻度 ====================
  function renderGrid() {
    if (!state.toggles.grid) {
      dom.layerGrid.innerHTML = '';
      return;
    }

    let html = '';
    // 垂直网格线 (x = 2, 4, ..., 24)
    for (let x = 2; x <= state.xMax; x += 2) {
      const sx = mathToSvgX(x);
      html += `<line x1="${sx}" y1="${state.padTop}" x2="${sx}" y2="${state.svgHeight - state.padBottom}" class="grid-line" />`;
      html += `<text x="${sx}" y="${state.svgHeight - state.padBottom + 16}" font-size="10" font-family="JetBrains Mono" fill="#A8A29E" text-anchor="middle">${x}</text>`;
    }

    // 水平网格线 (y = 0, 1, 2, 3, 4)
    for (let y = 0; y <= 4; y += 1) {
      const sy = mathToSvgY(y);
      html += `<line x1="${state.padLeft}" y1="${sy}" x2="${state.svgWidth - state.padRight}" y2="${sy}" class="grid-line" />`;
      html += `<text x="${state.padLeft - 10}" y="${sy + 3.5}" font-size="10" font-family="JetBrains Mono" fill="#A8A29E" text-anchor="end">${y.toFixed(0)}</text>`;
    }

    dom.layerGrid.innerHTML = html;
  }

  // ==================== 核心主渲染函数 ====================
  function render() {
    const { mode, a, c, xProbe, selectedContinuous, selectedDiscrete } = state;
    const curContModel = continuousModels[selectedContinuous];
    const curDiscModel = discreteModels[selectedDiscrete];

    // 1. 求解门槛点
    const threshX = solveContinuousThreshold(curContModel.fn, a, c);
    const threshN = solveDiscreteThreshold(curDiscModel.fn, a, c);

    const plotRight = state.svgWidth - state.padRight;
    const plotTop = state.padTop;
    const plotBottom = state.svgHeight - state.padBottom;

    // 2. 极限基准线 y = a (中心线严格恒定)
    const pyA = mathToSvgY(a);
    dom.lineLimitA.setAttribute('y1', pyA);
    dom.lineLimitA.setAttribute('y2', pyA);
    dom.textLimitA.setAttribute('y', pyA - 6);
    dom.textLimitA.textContent = `y = a = ${a.toFixed(2)}`;
    dom.tickA.setAttribute('cy', pyA);
    dom.textTickA.setAttribute('y', pyA + 4);
    dom.textTickA.textContent = `a`;

    // 3. 构建随 x 渐进放大的邻域带及上下边界
    const bandSamples = 60;
    const stepX = (state.xMax - state.xMin) / bandSamples;
    const upperPoints = [];
    const lowerPoints = [];
    let upperPathD = '';
    let lowerPathD = '';

    for (let i = 0; i <= bandSamples; i++) {
      const curX = state.xMin + i * stepX;
      const sx = mathToSvgX(curX);
      const syUpper = mathToSvgY(getEffectiveY(curX, a + c));
      const syLower = mathToSvgY(getEffectiveY(curX, a - c));

      upperPoints.push({ x: sx, y: syUpper });
      lowerPoints.push({ x: sx, y: syLower });

      if (i === 0) {
        upperPathD += `M ${sx.toFixed(1)} ${syUpper.toFixed(1)}`;
        lowerPathD += `M ${sx.toFixed(1)} ${syLower.toFixed(1)}`;
      } else {
        upperPathD += ` L ${sx.toFixed(1)} ${syUpper.toFixed(1)}`;
        lowerPathD += ` L ${sx.toFixed(1)} ${syLower.toFixed(1)}`;
      }
    }

    dom.pathUpperC.setAttribute('d', upperPathD);
    dom.pathLowerC.setAttribute('d', lowerPathD);

    // 走廊多边形闭合路径
    let bandPolyD = `M ${upperPoints[0].x.toFixed(1)} ${upperPoints[0].y.toFixed(1)}`;
    for (let i = 1; i < upperPoints.length; i++) {
      bandPolyD += ` L ${upperPoints[i].x.toFixed(1)} ${upperPoints[i].y.toFixed(1)}`;
    }
    for (let i = lowerPoints.length - 1; i >= 0; i--) {
      bandPolyD += ` L ${lowerPoints[i].x.toFixed(1)} ${lowerPoints[i].y.toFixed(1)}`;
    }
    bandPolyD += ' Z';

    if (state.toggles.band) {
      dom.pathBand.setAttribute('d', bandPolyD);
      dom.pathBandTint.setAttribute('d', bandPolyD);
      dom.pathBand.style.display = 'block';
      dom.pathBandTint.style.display = 'block';
      dom.pathUpperC.style.display = 'block';
      dom.pathLowerC.style.display = 'block';

      // 边界标签动态定位
      const lastUp = upperPoints[upperPoints.length - 1];
      const lastLo = lowerPoints[lowerPoints.length - 1];
      const maxZoom = getZoomFactorAtX(state.xMax);

      dom.textUpperC.setAttribute('x', Math.min(plotRight - 100, lastUp.x - 70));
      dom.textUpperC.setAttribute('y', lastUp.y - 6);
      dom.textUpperC.textContent = (state.progressiveZoom && state.zoomIntensity > 1.05)
        ? `y = a + c (${maxZoom.toFixed(1)}×放大)`
        : `y = a + c = ${(a + c).toFixed(2)}`;

      dom.textLowerC.setAttribute('x', Math.min(plotRight - 100, lastLo.x - 70));
      dom.textLowerC.setAttribute('y', lastLo.y + 14);
      dom.textLowerC.textContent = (state.progressiveZoom && state.zoomIntensity > 1.05)
        ? `y = a - c (${maxZoom.toFixed(1)}×放大)`
        : `y = a - c = ${(a - c).toFixed(2)}`;

      if (state.progressiveZoom && state.zoomIntensity > 1.05) {
        dom.textBandZoomNote.setAttribute('x', mathToSvgX(14));
        dom.textBandZoomNote.setAttribute('y', pyA - 12);
        dom.textBandZoomNote.textContent = `🔍 邻域随 x 增大展宽放大 →`;
      } else {
        dom.textBandZoomNote.textContent = ``;
      }
    } else {
      dom.pathBand.style.display = 'none';
      dom.pathBandTint.style.display = 'none';
      dom.pathUpperC.style.display = 'none';
      dom.pathLowerC.style.display = 'none';
      dom.textUpperC.textContent = '';
      dom.textLowerC.textContent = '';
      dom.textBandZoomNote.textContent = '';
    }

    // 4. 门槛线与安全区绘制
    const activeThresh = mode === 'discrete' ? threshN : threshX;
    const pxThresh = mathToSvgX(activeThresh);

    dom.lineThresh.setAttribute('x1', pxThresh);
    dom.lineThresh.setAttribute('x2', pxThresh);
    dom.lineThresh.setAttribute('y1', plotTop);
    dom.lineThresh.setAttribute('y2', plotBottom);

    const threshLabel = mode === 'discrete' ? `n = N = ${threshN}` : `x = X = ${threshX.toFixed(2)}`;
    const safeText = mode === 'discrete' ? `n > ${threshN} 全部落入邻域 →` : `x > ${threshX.toFixed(1)} 全部落入邻域 →`;

    dom.textThresh.setAttribute('x', pxThresh);
    dom.textThresh.textContent = threshLabel;

    dom.textSafeLabel.setAttribute('x', Math.min(plotRight - 130, pxThresh + 8));
    dom.textSafeLabel.textContent = safeText;

    // 安全区 (x > Threshold 内处于邻域管道中的高亮多边形)
    if (state.toggles.safeZone && activeThresh < state.xMax) {
      const safeStartX = Math.max(state.xMin, activeThresh);
      const safeSamples = 30;
      const safeStepX = (state.xMax - safeStartX) / safeSamples;
      const safeUp = [];
      const safeLo = [];

      for (let i = 0; i <= safeSamples; i++) {
        const curX = safeStartX + i * safeStepX;
        const sx = mathToSvgX(curX);
        safeUp.push({ x: sx, y: mathToSvgY(getEffectiveY(curX, a + c)) });
        safeLo.push({ x: sx, y: mathToSvgY(getEffectiveY(curX, a - c)) });
      }

      let safeD = `M ${safeUp[0].x.toFixed(1)} ${safeUp[0].y.toFixed(1)}`;
      for (let i = 1; i < safeUp.length; i++) {
        safeD += ` L ${safeUp[i].x.toFixed(1)} ${safeUp[i].y.toFixed(1)}`;
      }
      for (let i = safeLo.length - 1; i >= 0; i--) {
        safeD += ` L ${safeLo[i].x.toFixed(1)} ${safeLo[i].y.toFixed(1)}`;
      }
      safeD += ' Z';

      dom.pathSafeZone.setAttribute('d', safeD);
      dom.pathSafeZone.style.display = 'block';
    } else {
      dom.pathSafeZone.style.display = 'none';
    }

    // 5. 渲染连续曲线 (Continuous Curve)
    if (mode === 'continuous' || mode === 'compare') {
      const steps = 360;
      let pathD = '';
      for (let i = 0; i <= steps; i++) {
        const xVal = state.xMin + 0.15 + (i / steps) * (state.xMax - state.xMin - 0.15);
        const yVal = curContModel.fn(xVal, a);
        const effY = getEffectiveY(xVal, yVal);
        const sx = mathToSvgX(xVal);
        const sy = mathToSvgY(effY);
        pathD += (i === 0 ? `M ${sx.toFixed(1)} ${sy.toFixed(1)}` : ` L ${sx.toFixed(1)} ${sy.toFixed(1)}`);
      }
      dom.pathFunction.setAttribute('d', pathD);
      dom.pathFunction.style.display = 'block';
    } else {
      dom.pathFunction.style.display = 'none';
    }

    // 6. 渲染离散散点 (Discrete Sequence Dots)
    if (mode === 'discrete' || mode === 'compare') {
      let discHtml = '';
      const maxN = 25;
      for (let n = 1; n <= maxN; n++) {
        const rawVal = curDiscModel.fn(n, a);
        const effVal = getEffectiveY(n, rawVal);
        const sx = mathToSvgX(n);
        const sy = mathToSvgY(effVal);
        const isInside = Math.abs(rawVal - a) < c;
        const isAfterThresh = n > threshN;

        // 垂直虚线投影
        discHtml += `<line x1="${sx}" y1="${sy}" x2="${sx}" y2="${plotBottom}" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="2 2" />`;

        // 珍珠散点着色 (门槛后安全绿，门槛前在带内黄，在带外红)
        let fillCol = '#059669';
        let strokeCol = '#047857';
        if (!isAfterThresh) {
          if (isInside) {
            fillCol = '#D97706';
            strokeCol = '#B45309';
          } else {
            fillCol = '#E11D48';
            strokeCol = '#BE123C';
          }
        }

        const isCurrent = (n === Math.round(xProbe));
        discHtml += `<circle cx="${sx}" cy="${sy}" r="${isCurrent ? 7 : 4.8}" fill="${fillCol}" stroke="${strokeCol}" stroke-width="${isCurrent ? 2.5 : 1.8}" />`;
        discHtml += `<text x="${sx}" y="${plotBottom + 12}" font-size="9" font-family="JetBrains Mono" fill="#64748B" text-anchor="middle">${n}</text>`;
      }
      dom.layerDiscrete.innerHTML = discHtml;
      dom.layerDiscrete.style.display = 'block';
    } else {
      dom.layerDiscrete.innerHTML = '';
      dom.layerDiscrete.style.display = 'none';
    }

    // 7. 动态探针与误差测量
    let probeXVal = xProbe;
    let rawProbeY = 0;
    if (mode === 'discrete') {
      const nInt = Math.max(1, Math.min(25, Math.round(xProbe)));
      probeXVal = nInt;
      rawProbeY = curDiscModel.fn(nInt, a);
    } else {
      rawProbeY = curContModel.fn(probeXVal, a);
    }

    const effProbeY = getEffectiveY(probeXVal, rawProbeY);
    const sProbeX = mathToSvgX(probeXVal);
    const sProbeY = mathToSvgY(effProbeY);
    const absDiff = Math.abs(rawProbeY - a);
    const isProbeIn = absDiff < c;
    const isAfterThreshProbe = mode === 'discrete' ? (probeXVal > threshN) : (probeXVal > threshX);

    // 探针点与垂直指示线
    dom.circleProbe.setAttribute('cx', sProbeX);
    dom.circleProbe.setAttribute('cy', sProbeY);

    if (state.toggles.errorBar) {
      dom.lineProbeError.setAttribute('x1', sProbeX);
      dom.lineProbeError.setAttribute('y1', sProbeY);
      dom.lineProbeError.setAttribute('x2', sProbeX);
      dom.lineProbeError.setAttribute('y2', pyA);
      dom.lineProbeError.style.display = 'block';

      dom.lineProbeDrop.setAttribute('x1', sProbeX);
      dom.lineProbeDrop.setAttribute('y1', sProbeY);
      dom.lineProbeDrop.setAttribute('x2', sProbeX);
      dom.lineProbeDrop.setAttribute('y2', plotBottom);
      dom.lineProbeDrop.style.display = 'block';

      // 探针浮动标签
      const localZoom = getZoomFactorAtX(probeXVal);
      const tagW = (state.progressiveZoom && localZoom > 1.05) ? 96 : 76;
      const tagH = 18;
      const tagX = Math.min(plotRight - tagW - 4, Math.max(state.padLeft + 4, sProbeX + 8));
      const tagY = (sProbeY + pyA) / 2 - tagH / 2;

      dom.rectProbeTag.setAttribute('x', tagX);
      dom.rectProbeTag.setAttribute('y', tagY);
      dom.rectProbeTag.setAttribute('width', tagW);
      dom.rectProbeTag.setAttribute('height', tagH);
      dom.rectProbeTag.setAttribute('stroke', isProbeIn ? '#059669' : '#E11D48');

      dom.textProbeTag.setAttribute('x', tagX + tagW / 2);
      dom.textProbeTag.setAttribute('y', tagY + 12.5);
      dom.textProbeTag.setAttribute('fill', isProbeIn ? '#059669' : '#E11D48');
      dom.textProbeTag.textContent = (state.progressiveZoom && localZoom > 1.05)
        ? `|偏差|=${absDiff.toFixed(3)} [${localZoom.toFixed(1)}×]`
        : `|偏差|=${absDiff.toFixed(3)}`;

      dom.rectProbeTag.style.display = 'block';
      dom.textProbeTag.style.display = 'block';
    } else {
      dom.lineProbeError.style.display = 'none';
      dom.lineProbeDrop.style.display = 'none';
      dom.rectProbeTag.style.display = 'none';
      dom.textProbeTag.style.display = 'none';
    }

    // 8. 实时更新 HUD 徽章
    dom.badgeValA.textContent = a.toFixed(2);
    dom.badgeValC.textContent = c.toFixed(2);
    dom.badgeInterval.textContent = `[${(a - c).toFixed(2)}, ${(a + c).toFixed(2)}]`;

    if (mode === 'discrete') {
      dom.badgeThreshLabel.textContent = '门槛 N:';
      dom.badgeThreshVal.textContent = threshN >= 25 ? '> 25 (需更大项数)' : `${threshN}`;
      dom.labelProbeSlider.textContent = '动点项序号 n';
      dom.textSliderProbe.textContent = `${Math.round(probeXVal)}`;
    } else {
      dom.badgeThreshLabel.textContent = '门槛 X:';
      dom.badgeThreshVal.textContent = threshX >= state.xMax ? `> ${state.xMax}` : threshX.toFixed(2);
      dom.labelProbeSlider.textContent = '动点探针位置 x';
      dom.textSliderProbe.textContent = probeXVal.toFixed(2);
    }

    // 画布右下角胶囊
    const curZoomAtProbe = getZoomFactorAtX(probeXVal);
    if (isProbeIn) {
      dom.canvasProbeStatus.className = 'font-semibold text-emerald-600';
      dom.canvasProbeStatus.textContent = `✅ 落入邻域 |f-a|=${absDiff.toFixed(3)} < c=${c.toFixed(2)} (放大 ${curZoomAtProbe.toFixed(1)}×)`;
    } else {
      dom.canvasProbeStatus.className = 'font-semibold text-rose-600';
      dom.canvasProbeStatus.textContent = `❌ 逸出邻域 |f-a|=${absDiff.toFixed(3)} ≥ c=${c.toFixed(2)} (放大 ${curZoomAtProbe.toFixed(1)}×)`;
    }

    // 9. 更新右侧实时分析卡片
    dom.inspectValF.textContent = rawProbeY.toFixed(3);
    dom.inspectDiff.textContent = absDiff.toFixed(3);
    dom.inspectC.textContent = c.toFixed(3);
    dom.inspectThresh.textContent = mode === 'discrete' ? `N = ${threshN}` : `X = ${threshX.toFixed(2)}`;

    if (isProbeIn && isAfterThreshProbe) {
      dom.boxVerification.className = 'callout-box callout-note text-xs flex items-start gap-2.5';
      dom.textVerifTitle.textContent = mode === 'discrete'
        ? `当前项位于门槛之后 (n = ${probeXVal} > N = ${threshN})`
        : `当前位于门槛点之后 (x = ${probeXVal.toFixed(2)} > X = ${threshX.toFixed(2)})`;
      dom.textVerifDesc.textContent = `绝对偏差 ${absDiff.toFixed(3)} < ${c.toFixed(2)}，即使在放大 ${curZoomAtProbe.toFixed(1)}× 的开阔邻域管道内，函数值也严格被捕获在带内，永不逸出！`;
    } else if (isProbeIn && !isAfterThreshProbe) {
      dom.boxVerification.className = 'callout-box callout-amber text-xs flex items-start gap-2.5';
      dom.textVerifTitle.textContent = `当前恰好穿入邻域，但未跨越门槛`;
      dom.textVerifDesc.textContent = `虽然此处偏差 ${absDiff.toFixed(3)} < ${c.toFixed(2)}，但后续振荡依然会突破管道边界。必须越过门槛点后才能保证永久在带内。`;
    } else {
      dom.boxVerification.className = 'callout-box callout-rose text-xs flex items-start gap-2.5';
      dom.textVerifTitle.textContent = `当前逸出邻域 (|f-a| ≥ c)`;
      dom.textVerifDesc.textContent = `偏差 ${absDiff.toFixed(3)} 超出容限 c=${c.toFixed(2)}。需进一步向右增大自变量，向门槛点趋近。`;
    }

    // 10. KaTeX 动态公式更新
    updateKatexFormulas(a, c, threshX, threshN, probeXVal, rawProbeY, absDiff, curZoomAtProbe);
  }

  // ==================== KaTeX 动态公式渲染 ====================
  function updateKatexFormulas(a, c, threshX, threshN, px, py, diff, zoom) {
    if (typeof katex === 'undefined') return;

    let defTex = '';
    let valTex = '';

    if (state.mode === 'discrete') {
      defTex = `\\lim_{n \\to \\infty} a_n = a \\iff \\forall c > 0, \\; \\exists N \\in \\mathbb{N}^+, \\; \\forall n > N \\implies |a_n - a| < c`;
      valTex = `\\begin{aligned}
        &\\text{误差容限 } c = ${c.toFixed(2)}, \\quad \\text{求得门槛项数 } N = ${threshN} \\\\
        &\\forall n > ${threshN} \\implies |a_n - (${a.toFixed(2)})| < ${c.toFixed(2)} \\\\
        &\\text{当前序号 } n = ${px} : \\; |${py.toFixed(3)} - ${a.toFixed(2)}| = ${diff.toFixed(3)} \\; (${diff < c ? '<' : '\\ge'} ${c.toFixed(2)}) \\quad [\\text{局部放大 } ${zoom.toFixed(1)}\\times]
      \\end{aligned}`;
    } else {
      defTex = `\\lim_{x \\to +\\infty} f(x) = a \\iff \\forall c > 0, \\; \\exists X > 0, \\; \\forall x > X \\implies |f(x) - a| < c`;
      valTex = `\\begin{aligned}
        &\\text{误差容限 } c = ${c.toFixed(2)}, \\quad \\text{求得门槛点 } X = ${threshX.toFixed(2)} \\\\
        &\\forall x > ${threshX.toFixed(2)} \\implies |f(x) - (${a.toFixed(2)})| < ${c.toFixed(2)} \\\\
        &\\text{当前探针 } x = ${px.toFixed(2)} : \\; |${py.toFixed(3)} - ${a.toFixed(2)}| = ${diff.toFixed(3)} \\; (${diff < c ? '<' : '\\ge'} ${c.toFixed(2)}) \\quad [\\text{局部放大 } ${zoom.toFixed(1)}\\times]
      \\end{aligned}`;
    }

    try {
      dom.katexDefinition.innerHTML = katex.renderToString(defTex, { displayMode: true, throwOnError: false });
      dom.katexValuation.innerHTML = katex.renderToString(valTex, { displayMode: true, throwOnError: false });
    } catch (err) {
      console.warn('KaTeX render error:', err);
    }
  }

  // ==================== 交互与事件绑定 ====================
  function initEvents() {
    // 1. 滑块绑定 (极限值 a)
    dom.sliderA.addEventListener('input', (e) => {
      state.a = parseFloat(e.target.value);
      dom.textSliderA.textContent = state.a.toFixed(2);
      render();
    });

    // 2. 滑块绑定 (邻域半径 c)
    dom.sliderC.addEventListener('input', (e) => {
      state.c = parseFloat(e.target.value);
      dom.textSliderC.textContent = state.c.toFixed(2);
      render();
    });

    // 3. 滑块绑定 (动点探针位置)
    dom.sliderProbe.addEventListener('input', (e) => {
      state.xProbe = parseFloat(e.target.value);
      render();
    });

    // 4. 滑块绑定 (渐进放大倍率)
    dom.sliderZoom.addEventListener('input', (e) => {
      state.zoomIntensity = parseFloat(e.target.value);
      dom.badgeZoomFactor.textContent = `${state.zoomIntensity.toFixed(1)}×`;
      dom.textZoomIntensity.textContent = `${state.zoomIntensity.toFixed(1)}× 展开`;
      render();
    });

    // 5. 快速预设 c 按钮
    document.querySelectorAll('.btn-preset-c').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetC = parseFloat(btn.dataset.c);
        if (typeof gsap !== 'undefined') {
          gsap.to(state, {
            c: targetC,
            duration: 0.5,
            ease: 'power2.out',
            onUpdate: () => {
              dom.sliderC.value = state.c;
              dom.textSliderC.textContent = state.c.toFixed(2);
              render();
            }
          });
        } else {
          state.c = targetC;
          dom.sliderC.value = state.c;
          dom.textSliderC.textContent = state.c.toFixed(2);
          render();
        }
      });
    });

    // 6. 模式切换 Tabs
    function setMode(newMode) {
      state.mode = newMode;
      dom.tabContinuous.classList.toggle('active', newMode === 'continuous');
      dom.tabDiscrete.classList.toggle('active', newMode === 'discrete');
      dom.tabCompare.classList.toggle('active', newMode === 'compare');

      if (newMode === 'discrete') {
        dom.groupPresetsContinuous.classList.add('hidden');
        dom.groupPresetsDiscrete.classList.remove('hidden');
        dom.labelAxisX.textContent = 'n (项数序号) → ∞';
        dom.sliderProbe.min = "1";
        dom.sliderProbe.max = "25";
        dom.sliderProbe.step = "1";
        state.xProbe = Math.round(state.xProbe);
        dom.sliderProbe.value = state.xProbe;
      } else {
        dom.groupPresetsContinuous.classList.remove('hidden');
        dom.groupPresetsDiscrete.classList.add('hidden');
        dom.labelAxisX.textContent = 'x → +∞';
        dom.sliderProbe.min = "0.5";
        dom.sliderProbe.max = "24.5";
        dom.sliderProbe.step = "0.1";
      }

      render();
    }

    dom.tabContinuous.addEventListener('click', () => setMode('continuous'));
    dom.tabDiscrete.addEventListener('click', () => setMode('discrete'));
    dom.tabCompare.addEventListener('click', () => setMode('compare'));

    // 7. 模型预设切换
    document.querySelectorAll('#group-presets-continuous .btn-model').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#group-presets-continuous .btn-model').forEach(b => {
          b.classList.remove('active', 'border-blue-300', 'bg-blue-50', 'text-blue-900');
          b.classList.add('border-stone-200', 'bg-stone-50', 'text-stone-700');
        });
        btn.classList.add('active', 'border-blue-300', 'bg-blue-50', 'text-blue-900');
        btn.classList.remove('border-stone-200', 'bg-stone-50', 'text-stone-700');
        state.selectedContinuous = btn.dataset.preset;
        render();
      });
    });

    document.querySelectorAll('#group-presets-discrete .btn-model').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#group-presets-discrete .btn-model').forEach(b => {
          b.classList.remove('active', 'border-blue-300', 'bg-blue-50', 'text-blue-900');
          b.classList.add('border-stone-200', 'bg-stone-50', 'text-stone-700');
        });
        btn.classList.add('active', 'border-blue-300', 'bg-blue-50', 'text-blue-900');
        btn.classList.remove('border-stone-200', 'bg-stone-50', 'text-stone-700');
        state.selectedDiscrete = btn.dataset.preset;
        render();
      });
    });

    // 8. 图层与渐进放大开关绑定
    dom.toggleProgressiveZoom.addEventListener('change', (e) => {
      state.progressiveZoom = e.target.checked;
      render();
    });
    dom.toggleFollowZoom.addEventListener('change', (e) => {
      state.followZoom = e.target.checked;
      render();
    });
    dom.toggleBand.addEventListener('change', (e) => {
      state.toggles.band = e.target.checked;
      render();
    });
    dom.toggleSafeZone.addEventListener('change', (e) => {
      state.toggles.safeZone = e.target.checked;
      render();
    });
    dom.toggleErrorBar.addEventListener('change', (e) => {
      state.toggles.errorBar = e.target.checked;
      render();
    });
    dom.toggleGrid.addEventListener('change', (e) => {
      state.toggles.grid = e.target.checked;
      renderGrid();
    });

    // 9. GSAP 体验动效 1: c -> 0 动态收缩
    dom.btnAnimC.addEventListener('click', () => {
      if (typeof gsap === 'undefined') return;

      gsap.killTweensOf(state);
      state.c = 1.15;
      dom.sliderC.value = 1.15;
      dom.textSliderC.textContent = '1.15';
      render();

      gsap.to(state, {
        c: 0.08,
        duration: 4.0,
        ease: 'power1.inOut',
        onUpdate: () => {
          dom.sliderC.value = state.c;
          dom.textSliderC.textContent = state.c.toFixed(2);
          render();
        }
      });
    });

    // 10. GSAP 体验动效 2: 🚀 趋向无穷跃迁演播 (自变量增大 + 邻域逐渐展开 + 见证恒定捕获)
    dom.btnInfiniteJourney.addEventListener('click', () => {
      if (typeof gsap === 'undefined') return;

      gsap.killTweensOf(state);
      state.isCruising = false;
      dom.labelAutoCruise.textContent = '探针自动巡航';
      dom.btnAutoCruise.classList.remove('border-blue-300', 'bg-blue-50', 'text-blue-800');

      // 确保渐进放大开启，并将放大强度平滑提升至 3.6x
      state.progressiveZoom = true;
      dom.toggleProgressiveZoom.checked = true;

      state.xProbe = 1.0;
      state.zoomIntensity = 3.6;
      dom.sliderZoom.value = 3.6;
      dom.badgeZoomFactor.textContent = '3.6×';
      dom.textZoomIntensity.textContent = '3.6× 展开';
      dom.sliderProbe.value = 1.0;
      render();

      // 探针从 1.0 飞跃至 24.2
      gsap.to(state, {
        xProbe: 24.2,
        duration: 5.5,
        ease: 'power1.inOut',
        onUpdate: () => {
          dom.sliderProbe.value = state.xProbe;
          render();
        },
        onComplete: () => {
          render();
        }
      });
    });

    // 11. 探针自动巡航
    dom.btnAutoCruise.addEventListener('click', () => {
      state.isCruising = !state.isCruising;
      if (state.isCruising) {
        dom.labelAutoCruise.textContent = '停止巡航';
        dom.btnAutoCruise.classList.add('border-blue-300', 'bg-blue-50', 'text-blue-800');
        runCruiseLoop();
      } else {
        dom.labelAutoCruise.textContent = '探针自动巡航';
        dom.btnAutoCruise.classList.remove('border-blue-300', 'bg-blue-50', 'text-blue-800');
      }
    });

    function runCruiseLoop() {
      if (!state.isCruising) return;
      const speed = state.mode === 'discrete' ? 0.06 : 0.08;
      state.xProbe += speed * state.cruiseDirection;

      if (state.xProbe >= 24.2) {
        state.xProbe = 24.2;
        state.cruiseDirection = -1;
      } else if (state.xProbe <= 1.0) {
        state.xProbe = 1.0;
        state.cruiseDirection = 1;
      }

      dom.sliderProbe.value = state.xProbe;
      render();
      requestAnimationFrame(runCruiseLoop);
    }

    // 12. 重置按钮
    dom.btnReset.addEventListener('click', () => {
      if (typeof gsap !== 'undefined') gsap.killTweensOf(state);
      state.isCruising = false;
      dom.labelAutoCruise.textContent = '探针自动巡航';
      dom.btnAutoCruise.classList.remove('border-blue-300', 'bg-blue-50', 'text-blue-800');

      state.a = 2.0;
      state.c = 0.35;
      state.xProbe = 11.5;
      state.progressiveZoom = true;
      state.zoomIntensity = 3.0;
      state.followZoom = false;

      dom.sliderA.value = 2.0;
      dom.sliderC.value = 0.35;
      dom.sliderProbe.value = 11.5;
      dom.sliderZoom.value = 3.0;
      dom.badgeZoomFactor.textContent = '3.0×';
      dom.textZoomIntensity.textContent = '3.0× 展开';
      dom.toggleProgressiveZoom.checked = true;
      dom.toggleFollowZoom.checked = false;

      dom.textSliderA.textContent = '2.00';
      dom.textSliderC.textContent = '0.35';
      render();
    });

    // 13. 画布直接拖拽探针 (Pointer Events)
    let isDragging = false;

    function handlePointerDrag(e) {
      const rect = dom.svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * state.svgWidth;
      const mathX = svgToMathX(px);
      state.xProbe = Math.max(0.5, Math.min(24.5, mathX));
      dom.sliderProbe.value = state.xProbe;
      render();
    }

    dom.svg.addEventListener('pointerdown', (e) => {
      isDragging = true;
      dom.svg.setPointerCapture(e.pointerId);
      handlePointerDrag(e);
    });

    dom.svg.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      handlePointerDrag(e);
    });

    dom.svg.addEventListener('pointerup', (e) => {
      isDragging = false;
      try {
        dom.svg.releasePointerCapture(e.pointerId);
      } catch (err) {}
    });

    dom.svg.addEventListener('pointercancel', () => {
      isDragging = false;
    });
  }

  // ==================== 初始化入口 ====================
  function init() {
    renderGrid();
    initEvents();

    if (window.katex) {
      render();
    } else {
      window.addEventListener('load', () => {
        render();
      });
      setTimeout(render, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
