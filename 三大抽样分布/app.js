(() => {
  'use strict';

  const plot = { left: 62, right: 727, top: 31, bottom: 355 };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const alphaInput = document.getElementById('alpha-level');
  const singleDf = document.getElementById('single-df');
  const fDf1 = document.getElementById('f-df1');
  const fDf2 = document.getElementById('f-df2');
  const backButton = document.getElementById('step-back');
  const nextButton = document.getElementById('step-next');
  const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 });

  const distributions = {
    chi: {
      title: 'χ² 分布曲线',
      context: 'χ² 分布只取非负值，由一个自由度决定形状。',
      notation: df => `X ~ χ²(${df})`,
      quantileSymbol: 'χ²<sub>α</sub>',
      minimumDf: 2,
      lowerBound: 0,
      parameters: () => ({ df: Number(singleDf.value) }),
      pdf: (x, { df }) => {
        if (x < 0) return 0;
        const a = df / 2;
        return Math.exp((a - 1) * Math.log(Math.max(x, 1e-12)) - x / 2 - a * Math.log(2) - logGamma(a));
      },
      survival: (x, { df }) => x <= 0 ? 1 : regularizedGammaQ(df / 2, x / 2),
      range(q, parameters, alpha) {
        let max = Math.max(5, q * 1.5);
        const tailTolerance = Math.min(alpha, 1 - alpha) * 0.01;
        while (this.survival(max, parameters) > tailTolerance && max < 1e12) max *= 2;
        return [0, max];
      }
    },
    t: {
      title: 't 分布曲线',
      context: 't 分布关于 0 对称；自由度越大，曲线越接近标准正态。',
      notation: df => `T ~ t(${df})`,
      quantileSymbol: 't<sub>α</sub>',
      minimumDf: 1,
      lowerBound: -Infinity,
      parameters: () => ({ df: Number(singleDf.value) }),
      pdf: (x, { df }) => Math.exp(logGamma((df + 1) / 2) - logGamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log1p(x * x / df)),
      survival: (x, { df }) => {
        if (x === 0) return 0.5;
        const halfTail = 0.5 * regularizedBeta(df / (df + x * x), df / 2, 0.5);
        return x > 0 ? halfTail : 1 - halfTail;
      },
      range(q, parameters, alpha) {
        let extent = Math.max(4.5, Math.abs(q) * 1.7 + 1.2);
        const tailTolerance = Math.min(alpha, 1 - alpha) * 0.01;
        while (this.survival(extent, parameters) > tailTolerance && extent < 1e12) extent *= 2;
        return [-extent, extent];
      }
    },
    f: {
      title: 'F 分布曲线',
      context: 'F 分布只取非负值；分子与分母各有一个自由度。',
      notation: (df1, df2) => `F ~ F(${df1}, ${df2})`,
      quantileSymbol: 'F<sub>α</sub>',
      minimumDf: 2,
      lowerBound: 0,
      parameters: () => ({ df1: Number(fDf1.value), df2: Number(fDf2.value) }),
      pdf: (x, { df1, df2 }) => {
        if (x < 0) return 0;
        const a = df1 / 2;
        const b = df2 / 2;
        const safeX = Math.max(x, 1e-12);
        return Math.exp(a * Math.log(df1 / df2) + (a - 1) * Math.log(safeX) - logBeta(a, b) - ((df1 + df2) / 2) * Math.log1p((df1 / df2) * safeX));
      },
      survival: (x, { df1, df2 }) => {
        if (x <= 0) return 1;
        const z = df2 / (df2 + df1 * x);
        return regularizedBeta(z, df2 / 2, df1 / 2);
      },
      range(q, parameters, alpha) {
        let max = Math.max(4, q * 1.5);
        const tailTolerance = Math.min(alpha, 1 - alpha) * 0.01;
        while (this.survival(max, parameters) > tailTolerance && max < 1e12) max *= 2;
        return [0, max];
      }
    }
  };

  let selected = 'chi';
  let step = 0;
  let transitionId = 0;

  function logGamma(z) {
    const coefficients = [
      676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    const shifted = z - 1;
    let sum = 0.99999999999980993;
    for (let i = 0; i < coefficients.length; i += 1) sum += coefficients[i] / (shifted + i + 1);
    const t = shifted + coefficients.length - 0.5;
    return 0.9189385332046727 + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
  }

  function logBeta(a, b) { return logGamma(a) + logGamma(b) - logGamma(a + b); }

  function regularizedGammaQ(a, x) {
    if (x <= 0) return 1;
    if (x < a + 1) {
      let term = 1 / a;
      let sum = term;
      let ap = a;
      for (let n = 1; n <= 200; n += 1) {
        ap += 1;
        term *= x / ap;
        sum += term;
        if (Math.abs(term) <= Math.abs(sum) * 3e-14) break;
      }
      const p = sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
      return Math.max(0, Math.min(1, 1 - p));
    }

    const tiny = 1e-300;
    let b = x + 1 - a;
    let c = 1 / tiny;
    let d = 1 / Math.max(Math.abs(b), tiny) * Math.sign(b || 1);
    let h = d;
    for (let i = 1; i <= 200; i += 1) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < 3e-14) break;
    }
    return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - logGamma(a)) * h));
  }

  function betaContinuedFraction(a, b, x) {
    const tiny = 1e-300;
    const maxIterations = 200;
    const epsilon = 3e-14;
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - qab * x / qap;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let h = d;

    for (let m = 1; m <= maxIterations; m += 1) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      h *= d * c;

      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < epsilon) break;
    }
    return h;
  }

  function regularizedBeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const front = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - logBeta(a, b));
    if (x < (a + 1) / (a + b + 2)) {
      return Math.max(0, Math.min(1, front * betaContinuedFraction(a, b, x) / a));
    }
    return Math.max(0, Math.min(1, 1 - front * betaContinuedFraction(b, a, 1 - x) / b));
  }

  function upperQuantile(alpha, distribution, parameters) {
    let low = Number.isFinite(distribution.lowerBound) ? distribution.lowerBound : -1;
    let high = 1;
    while (distribution.survival(high, parameters) > alpha && high < 1e12) high *= 2;
    while (distribution.survival(low, parameters) < alpha && low > -1e12) low = low * 2 - 1;
    for (let i = 0; i < 90; i += 1) {
      const mid = (low + high) / 2;
      if (distribution.survival(mid, parameters) > alpha) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) return '∞';
    if (Math.abs(value) >= 1000) return numberFormat.format(value);
    if (Math.abs(value) >= 100) return value.toFixed(1);
    if (Math.abs(value) >= 10) return value.toFixed(2);
    return value.toFixed(3);
  }

  function axisNumber(value) {
    const abs = Math.abs(value);
    if (abs >= 100) return String(Math.round(value));
    if (abs >= 10) return value.toFixed(0);
    if (abs >= 1) return value.toFixed(1).replace(/\.0$/, '');
    return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '0');
  }

  function coordinatesFor(quantile, distribution, parameters, alpha) {
    const [min, max] = distribution.range(quantile, parameters, alpha);
    return {
      min,
      max,
      x: value => plot.left + ((value - min) / (max - min)) * plotWidth,
      y: (value, maxDensity) => plot.bottom - (value / maxDensity) * plotHeight
    };
  }

  function sampleValues(start, end, quantile) {
    const values = new Set([start, end, quantile, 0]);
    const steps = 420;
    for (let i = 0; i <= steps; i += 1) values.add(start + (end - start) * i / steps);
    const focusRadius = Math.min(12, Math.max(2, Math.abs(quantile) * 0.22 + 1));
    [0, quantile].forEach(center => {
      const focusStart = Math.max(start, center - focusRadius);
      const focusEnd = Math.min(end, center + focusRadius);
      if (focusEnd <= focusStart) return;
      for (let i = 0; i <= 280; i += 1) values.add(focusStart + (focusEnd - focusStart) * i / 280);
    });
    return [...values].filter(value => value >= start && value <= end).sort((a, b) => a - b);
  }

  function buildAreaPath(start, end, xScale, yScale, pdf, parameters, quantile) {
    let path = `M ${xScale(start)} ${plot.bottom}`;
    for (const x of sampleValues(start, end, quantile)) {
      const density = Math.max(0, pdf(x, parameters));
      path += ` L ${xScale(x)} ${yScale(density)}`;
    }
    path += ` L ${xScale(end)} ${plot.bottom} Z`;
    return path;
  }

  function renderGrid(xScale, xMin, xMax, yMax) {
    const group = document.getElementById('plot-grid');
    const yTicks = 4;
    const xTicks = 6;
    const parts = [];
    for (let i = 0; i <= yTicks; i += 1) {
      const ratio = i / yTicks;
      const y = plot.bottom - ratio * plotHeight;
      const value = ratio * yMax;
      parts.push(`<line class="grid-line" x1="${plot.left}" x2="${plot.right}" y1="${y}" y2="${y}"></line>`);
      parts.push(`<text class="tick-label" x="${plot.left - 10}" y="${y + 3}" text-anchor="end">${axisNumber(value)}</text>`);
    }
    for (let i = 0; i <= xTicks; i += 1) {
      const value = xMin + (xMax - xMin) * i / xTicks;
      const x = xScale(value);
      parts.push(`<line class="grid-line" x1="${x}" x2="${x}" y1="${plot.top}" y2="${plot.bottom}" opacity="0.5"></line>`);
      parts.push(`<text class="tick-label" x="${x}" y="${plot.bottom + 17}" text-anchor="middle">${axisNumber(value)}</text>`);
    }
    parts.push(`<line class="axis-line" x1="${plot.left}" x2="${plot.right}" y1="${plot.bottom}" y2="${plot.bottom}"></line>`);
    parts.push(`<line class="axis-line" x1="${plot.left}" x2="${plot.left}" y1="${plot.top}" y2="${plot.bottom}"></line>`);
    group.innerHTML = parts.join('');
  }

  function formatLevel(value) { return value.toFixed(2); }

  function probabilitySymbol(level, parameters, isLower = false, alpha = Number(alphaInput.value)) {
    const levelText = formatLevel(level);
    if (selected === 't') {
      if (isLower) {
        return `−t<sub>${formatLevel(alpha)},${parameters.df}</sub> = t<sub>${levelText},${parameters.df}</sub>`;
      }
      return `t<sub>${levelText},${parameters.df}</sub>`;
    }
    if (selected === 'chi') return `χ²<sub>${levelText},${parameters.df}</sub>`;
    return `F<sub>${levelText};${parameters.df1},${parameters.df2}</sub>`;
  }

  function plainProbabilitySymbol(level, parameters, isLower = false, alpha = Number(alphaInput.value)) {
    const levelText = formatLevel(level);
    if (selected === 't') {
      if (isLower) return `−t_${formatLevel(alpha)},${parameters.df} = t_${levelText},${parameters.df}`;
      return `t_${levelText},${parameters.df}`;
    }
    if (selected === 'chi') return `χ²_${levelText},${parameters.df}`;
    return `F_${levelText};${parameters.df1},${parameters.df2}`;
  }

  function setSvgQuantileLabel(level, parameters, quantile, isLower) {
    const label = document.getElementById('quantile-label');
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const addPart = (text, subscript = false) => {
      const part = document.createElementNS(svgNamespace, 'tspan');
      if (subscript) {
        part.setAttribute('baseline-shift', 'sub');
        part.setAttribute('font-size', '9');
      }
      part.textContent = text;
      label.appendChild(part);
    };

    label.replaceChildren();
    if (selected === 't') {
      if (isLower) {
        addPart('−t');
        addPart(`${formatLevel(Number(alphaInput.value))},${parameters.df}`, true);
        addPart(' = t');
        addPart(`${formatLevel(level)},${parameters.df}`, true);
      } else {
        addPart('t');
        addPart(`${formatLevel(level)},${parameters.df}`, true);
      }
    } else if (selected === 'chi') {
      addPart('χ²');
      addPart(`${formatLevel(level)},${parameters.df}`, true);
    } else {
      addPart('F');
      addPart(`${formatLevel(level)};${parameters.df1},${parameters.df2}`, true);
    }
    addPart(` = ${formatNumber(quantile)}`);
    label.setAttribute('aria-label', `${plainProbabilitySymbol(level, parameters, isLower)} = ${formatNumber(quantile)}`);
  }

  function renderPlot(quantile, distribution, parameters, alpha, level, isLower) {
    const scale = coordinatesFor(quantile, distribution, parameters, alpha);
    let maxDensity = 0;
    const samples = sampleValues(scale.min, scale.max, quantile).map(x => {
      const y = Math.max(0, distribution.pdf(x, parameters));
      maxDensity = Math.max(maxDensity, y);
      return [x, y];
    });
    maxDensity = Math.max(maxDensity * 1.15, 0.01);
    const yScale = value => scale.y(value, maxDensity);
    const curvePath = samples.map(([x, density], index) => `${index === 0 ? 'M' : 'L'} ${scale.x(x)} ${yScale(density)}`).join(' ');
    document.getElementById('density-curve').setAttribute('d', curvePath);
    document.getElementById('left-area').setAttribute('d', buildAreaPath(scale.min, quantile, scale.x, yScale, distribution.pdf, parameters, quantile));
    document.getElementById('right-area').setAttribute('d', buildAreaPath(quantile, scale.max, scale.x, yScale, distribution.pdf, parameters, quantile));

    const quantileX = scale.x(quantile);
    const quantileY = yScale(distribution.pdf(quantile, parameters));
    document.getElementById('quantile-line').setAttribute('x1', quantileX);
    document.getElementById('quantile-line').setAttribute('x2', quantileX);
    document.getElementById('quantile-line').setAttribute('y1', plot.top);
    document.getElementById('quantile-line').setAttribute('y2', plot.bottom);
    document.getElementById('quantile-point').setAttribute('cx', quantileX);
    document.getElementById('quantile-point').setAttribute('cy', quantileY);
    const quantileLabel = document.getElementById('quantile-label');
    quantileLabel.setAttribute('x', quantileX > plot.right - 120 ? quantileX - 9 : quantileX + 9);
    quantileLabel.setAttribute('y', plot.top + 16);
    quantileLabel.setAttribute('text-anchor', quantileX > plot.right - 120 ? 'end' : 'start');
    setSvgQuantileLabel(level, parameters, quantile, isLower);

    renderGrid(scale.x, scale.min, scale.max, maxDensity);
    const leftClip = document.getElementById('left-clip-rect');
    const rightClip = document.getElementById('right-clip-rect');
    leftClip.setAttribute('x', plot.left);
    leftClip.setAttribute('y', plot.top);
    leftClip.setAttribute('width', 0);
    leftClip.setAttribute('height', plotHeight);
    rightClip.setAttribute('x', quantileX);
    rightClip.setAttribute('y', plot.top);
    rightClip.setAttribute('width', 0);
    rightClip.setAttribute('height', plotHeight);
    if (step === 1 || step === 3) {
      rightClip.setAttribute('width', Math.max(0, plot.right - quantileX));
    }
    if (step === 2 || step === 4) leftClip.setAttribute('width', Math.max(0, quantileX - plot.left));
  }

  function formatProbability(value) { return value.toFixed(4); }

  function lowerEventHtml(parameters, alpha) {
    if (selected === 't') return `P(T &lt; −t<sub>${formatLevel(alpha)},${parameters.df}</sub>)`;
    if (selected === 'chi') return `P(X &lt; χ²<sub>${formatLevel(1 - alpha)},${parameters.df}</sub>)`;
    return `P(X &lt; F<sub>${formatLevel(1 - alpha)};${parameters.df1},${parameters.df2}</sub>)`;
  }

  function lowerCutHtml(parameters, alpha) {
    if (selected === 't') return `t<sub>${formatLevel(1 - alpha)},${parameters.df}</sub>`;
    if (selected === 'chi') return `χ²<sub>${formatLevel(1 - alpha)},${parameters.df}</sub>`;
    return `F<sub>${formatLevel(1 - alpha)};${parameters.df1},${parameters.df2}</sub>`;
  }

  function updateCopy(quantile, level, parameters, alpha, isLower) {
    const dist = distributions[selected];
    const label = selected === 'f' ? dist.notation(parameters.df1, parameters.df2) : dist.notation(parameters.df);
    document.getElementById('distribution-context').textContent = dist.context;
    document.getElementById('chart-heading').textContent = dist.title;
    document.getElementById('distribution-notation').textContent = label;
    document.getElementById('quantile-symbol').innerHTML = probabilitySymbol(level, parameters, isLower, alpha);
    document.getElementById('quantile-value').textContent = formatNumber(quantile);
    document.getElementById('quantile-chip-value').textContent = formatNumber(quantile);
    document.getElementById('quantile-chip-label').textContent = isLower ? '下侧临界点' : '上分位点';
    document.getElementById('right-key-label').textContent = isLower ? `右侧 ${formatProbability(1 - alpha)}` : `右侧 ${formatProbability(alpha)}`;
    document.getElementById('left-key-label').textContent = isLower ? `左侧 ${formatProbability(alpha)}` : `左侧 ${formatProbability(1 - alpha)}`;
    document.getElementById('quantile-definition').textContent = isLower
      ? `左侧面积 α = ${formatProbability(alpha)}，对应上尾记号 ${plainProbabilitySymbol(level, parameters)}`
      : `P(X > xα) = α = ${formatProbability(alpha)}`;
    document.getElementById('plot-title').textContent = `${label} 的概率密度曲线与分位点`;
    document.getElementById('plot-desc').textContent = `${isLower ? '左侧' : '右侧'}分位点为 ${formatNumber(quantile)}，当前讨论的尾部概率为 ${formatProbability(alpha)}。`;
    updateStepContent(parameters, alpha);
  }

  function updateStepContent(parameters, alpha) {
    const resultLabel = document.getElementById('result-label');
    const resultFormula = document.getElementById('result-formula');
    const note = document.querySelector('#teaching-note p');
    const alphaText = formatProbability(alpha);
    const rightComplementText = formatProbability(1 - alpha);
    const upperSymbol = probabilitySymbol(alpha, parameters);
    const lowerEvent = lowerEventHtml(parameters, alpha);
    const lowerCut = lowerCutHtml(parameters, alpha);
    const variable = selected === 't' ? 'T' : 'X';

    document.body.dataset.step = ['idle', 'upper-right', 'lower-left', 'lower-right', 'lower-final'][step];
    document.getElementById('step-count').textContent = `${step} / 4`;
    document.getElementById('step-kicker').textContent = step === 0 ? '准备开始' : `第 ${step} 步`;
    document.getElementById('step-title').textContent = [
      '先看上分位点右侧',
      '高亮上分位点右侧',
      '圈出左侧所求区域',
      '改看左侧点的右方区域',
      '回到左侧所求区域'
    ][step];
    backButton.disabled = step === 0;
    nextButton.textContent = step === 0 ? '开始演示' : step === 4 ? '重新演示' : '下一步';

    if (step === 1) {
      resultLabel.textContent = '右侧面积就是所求概率';
      resultFormula.innerHTML = `P(${variable} &gt; ${upperSymbol}) = α = <span class="result-value">${alphaText}</span>`;
      note.textContent = `虚线右侧面积就是 P(${variable} > ${plainProbabilitySymbol(alpha, parameters)}) = ${alphaText}。`;
    } else if (step === 2) {
      resultLabel.textContent = '所求区域';
      resultFormula.innerHTML = lowerEvent;
      note.textContent = '所求区域';
    } else if (step === 3) {
      resultLabel.textContent = '可转化为求补事件';
      resultFormula.innerHTML = `${lowerEvent} = 1 − P(${variable} &gt; ${lowerCut})<br>= 1 − ${rightComplementText} = <span class="result-value">${alphaText}</span>`;
      note.textContent = `可转化为求 1−P(${variable}>${plainProbabilitySymbol(1 - alpha, parameters)})。`;
    } else if (step === 4) {
      resultLabel.textContent = '再次回到所求区域';
      resultFormula.innerHTML = `${lowerEvent} = 1 − P(${variable} &gt; ${lowerCut}) = <span class="result-value">${alphaText}</span>`;
      note.textContent = `再次高亮左侧所求区域，面积为 ${alphaText}。`;
    } else {
      resultLabel.textContent = '等你选择一步';
      resultFormula.innerHTML = `P(X &gt; ${upperSymbol}) = α`;
      note.textContent = '点击“开始演示”，先看上分位点右侧面积，再逐步推出左侧概率。';
    }
  }

  function animateClip(rect, kind, boundary, duration = 680) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const leftWidth = Math.max(0, boundary - plot.left);
    const rightWidth = Math.max(0, plot.right - boundary);
    const total = kind === 'left' ? leftWidth : rightWidth;
    const start = performance.now();
    const token = transitionId;
    rect.setAttribute('x', boundary);
    rect.setAttribute('width', 0);
    if (reducedMotion || total === 0) {
      rect.setAttribute('x', kind === 'left' ? plot.left : boundary);
      rect.setAttribute('width', total);
      return;
    }

    const frame = now => {
      if (token !== transitionId) return;
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      if (kind === 'left') {
        rect.setAttribute('x', boundary - leftWidth * eased);
        rect.setAttribute('width', leftWidth * eased);
      } else {
        rect.setAttribute('x', boundary);
        rect.setAttribute('width', rightWidth * eased);
      }
      if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function renderCurrentStep(animate = false) {
    const dist = distributions[selected];
    const parameters = dist.parameters();
    const alpha = Number(alphaInput.value);
    const isLower = step >= 2;
    const level = isLower ? 1 - alpha : alpha;
    const quantile = upperQuantile(level, dist, parameters);
    updateCopy(quantile, level, parameters, alpha, isLower);
    renderPlot(quantile, dist, parameters, alpha, level, isLower);
    if (animate) {
      const boundary = Number(document.getElementById('quantile-line').getAttribute('x1'));
      if (step === 1 || step === 3) {
        animateClip(document.getElementById('right-clip-rect'), 'right', boundary);
      } else if (step === 2 || step === 4) {
        animateClip(document.getElementById('left-clip-rect'), 'left', boundary, 820);
      }
    }
  }

  function refresh() {
    transitionId += 1;
    step = 0;
    renderCurrentStep();
  }

  function goToStep(nextStep) {
    transitionId += 1;
    step = nextStep;
    renderCurrentStep(true);
  }

  function chooseDistribution(key) {
    selected = key;
    document.querySelectorAll('.distribution-tab').forEach(button => {
      const active = button.dataset.distribution === key;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const isF = key === 'f';
    document.getElementById('single-df-control').hidden = isF;
    document.getElementById('f-df-controls').hidden = !isF;
    if (!isF) {
      const input = document.getElementById('single-df');
      const dist = distributions[key];
      input.min = String(dist.minimumDf);
      document.getElementById('single-df-min').textContent = String(dist.minimumDf);
      document.getElementById('single-df-label').textContent = '自由度 ν';
      if (Number(input.value) < dist.minimumDf) input.value = String(dist.minimumDf);
    }
    refresh();
  }

  document.querySelectorAll('.distribution-tab').forEach(button => {
    button.addEventListener('click', () => chooseDistribution(button.dataset.distribution));
  });
  [singleDf, fDf1, fDf2].forEach(input => input.addEventListener('input', () => {
    if (input === singleDf) document.getElementById('single-df-output').textContent = input.value;
    if (input === fDf1) document.getElementById('f-df1-output').textContent = input.value;
    if (input === fDf2) document.getElementById('f-df2-output').textContent = input.value;
    refresh();
  }));
  alphaInput.addEventListener('change', () => refresh());
  backButton.addEventListener('click', () => {
    if (step > 0) goToStep(step - 1);
  });
  nextButton.addEventListener('click', () => {
    goToStep(step === 4 ? 0 : step + 1);
  });

  refresh();
})();
