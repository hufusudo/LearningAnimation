/* 只由（事件、进度）决定画面；浏览器与 Node 共用。 */
(function (root) {
  'use strict';
  const clamp = x => Math.max(0, Math.min(1, x));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const mix = (a, b, p) => a + (b - a) * p;
  const COLORS = {
    input: ['#ffffff', '#cbd0c4'], active: ['#e7f1e9', '#719b7b'],
    frozen: ['#f6e7e9', '#b77d88'], pending: ['#eaf0fc', '#6385c0'], output: ['#f7edce', '#bf9e51']
  };
  const tags = { select: '当前最小', emit: '追加本段', compare: '比较新记录', activate: '留在本段', freeze: '留到下段', close: '本段完成', thaw: '全部解冻', done: '全部生成', swap: '调整小顶堆', compact: '堆尾补位', load: '顺序装入', read: '读入下一数', 'new-run': '开始下一段', ready: '工作区就绪' };
  function heapPosition(i) {
    const level = Math.floor(Math.log2(i + 1));
    const count = 2 ** level;
    return { x: 350 + 400 * (i - count + 1 + .5) / count, y: 240 + level * 50 };
  }
  function inputPosition(i) { return { x: 52 + i * 42, y: 78 }; }
  function outputPosition(i) { return { x: 851 + i % 6 * 37, y: 242 + Math.floor(i / 6) * 52 }; }
  // 沿留白通道走折线，避免飞行数字穿过比较式、标签和已输出记录。
  function flightPoints(type, from, to) {
    const a = { x: from.x, y: from.y }, b = { x: to.x, y: to.y };
    if (type === 'freeze') return [a, { x: 100, y: 325 }, { x: 310, y: 325 }, { x: 310, y: 495 }, b];
    if (type === 'activate') return [a, { x: 100, y: 325 }, { x: 310, y: 325 }, { x: 310, y: 220 }, { x: 550, y: 220 }, b];
    if (type === 'read') return [a, { x: a.x, y: 131 }, { x: 18, y: 131 }, { x: 18, y: 290 }, b];
    if (type === 'load') return [a, { x: a.x, y: 131 }, { x: 795, y: 131 }, { x: 795, y: b.y - 25 }, { x: b.x, y: b.y - 25 }, b];
    if (type === 'emit') return [a, { x: 795, y: a.y }, { x: 795, y: b.y - 24 }, { x: b.x, y: b.y - 24 }, b];
    return [a, b];
  }
  function pointAlong(points, p) {
    if (p <= 0) return { ...points[0] };
    if (p >= 1) return { ...points.at(-1) };
    const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.y - points[i].y));
    let remaining = lengths.reduce((a, b) => a + b, 0) * clamp(p);
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] && lengths[i] > 0) {
        const q = remaining / lengths[i];
        return { x: mix(points[i].x, points[i + 1].x, q), y: mix(points[i].y, points[i + 1].y, q) };
      }
      remaining -= lengths[i];
    }
    return { ...points.at(-1) };
  }
  function colorMix(a, b, p) {
    const aa = a.slice(1).match(/../g).map(x => parseInt(x, 16));
    const bb = b.slice(1).match(/../g).map(x => parseInt(x, 16));
    return '#' + aa.map((x, i) => Math.round(mix(x, bb[i], p)).toString(16).padStart(2, '0')).join('');
  }
  function textView(a, b, p, start = .1, end = .38) {
    if (a === b) return { text: a, opacity: 1 };
    const q = win(p, start, end);
    return { text: q < .5 ? a : b, opacity: Math.abs(1 - 2 * q) };
  }
  function stateFrame(seq, state) {
    const tokens = {};
    function put(token, position, zone, opacity = 1, caption = '') {
      if (!token) return;
      tokens[token.id] = { id: token.id, value: token.value, ...position, opacity, fill: COLORS[zone][0], stroke: COLORS[zone][1], zone, caption };
    }
    seq.tokens.forEach((token, i) => { if (i >= state.inputIndex) put(token, inputPosition(i), 'input'); });
    state.active.forEach((token, i) => put(token, heapPosition(i), 'active', 1, `[${i}]`));
    state.frozen.forEach((token, i) => put(token, { x: 365 + i * 49, y: 495 }, 'frozen'));
    put(state.pending, { x: 100, y: 290 }, 'pending');
    state.runs.forEach((run, r) => run.forEach((token, i) => put(token, outputPosition(i), 'output', r === state.runIndex ? 1 : 0)));
    const edges = Array.from({ length: 7 }, (_, j) => {
      const child = j + 1, parent = Math.floor((child - 1) / 2);
      return { child, from: heapPosition(parent), to: heapPosition(child), opacity: state.active[child] && state.active[parent] ? 1 : 0 };
    });
    const active = state.active.filter(Boolean).length;
    const output = state.runs.reduce((n, run) => n + run.length, 0);
    const decision = state.pending ? (state.comparison === 'active' ? '可以接续本段' : state.comparison === 'frozen' ? '冻结，留到下段' : '等待比较') : '等待读入新记录';
    return {
      tokens: seq.tokens.map(token => tokens[token.id] || { id: token.id, value: token.value, ...inputPosition(seq.tokens.indexOf(token)), opacity: 0, fill: COLORS.input[0], stroke: COLORS.input[1], zone: 'input', caption: '' }),
      edges, counts: { read: state.inputIndex, active, frozen: state.frozen.length, occupied: active + state.frozen.length + (state.pending ? 1 : 0), output, runLength: (state.runs[state.runIndex] || []).length },
      countOpacity: { read: 1, active: 1, frozen: 1, occupied: 1, output: 1, runLength: 1 },
      runIndex: state.runIndex, lastKey: { text: state.lastKey === null ? '−∞' : String(state.lastKey), opacity: 1 },
      decision: { text: decision, opacity: 1 }, operator: { text: state.comparison === 'active' ? '≥' : state.comparison === 'frozen' ? '<' : '·', opacity: 1 },
      phase: { text: state.phase, opacity: 1 }, message: { text: state.message, opacity: 1 },
      runs: state.runs.map(run => run.map(t => ({ ...t }))), archiveOpacity: 1, archiveAlpha: {},
      focus: state.selected && tokens[state.selected] ? [{ id: state.selected, x: tokens[state.selected].x, y: tokens[state.selected].y, opacity: 1 }] : [],
      path: null, tag: { text: '', opacity: 0 }, selected: state.selected
    };
  }
  function sampleStep(seq, step, p) {
    if (p <= 0) return stateFrame(seq, step.before);
    if (p >= 1) return stateFrame(seq, step.after);
    const a = stateFrame(seq, step.before), b = stateFrame(seq, step.after);
    const move = win(p, .18, .68), receipt = win(p, .70, .94);
    const frame = { ...a };
    frame.tokens = a.tokens.map((from, i) => {
      const to = b.tokens[i];
      const position = from.id === step.tokenId ? pointAlong(flightPoints(step.type, from, to), move) : { x: mix(from.x, to.x, move), y: mix(from.y, to.y, move) };
      return { ...from, ...position, opacity: mix(from.opacity, to.opacity, move), fill: colorMix(from.fill, to.fill, move), stroke: colorMix(from.stroke, to.stroke, move), zone: move < .5 ? from.zone : to.zone, caption: move < .5 ? from.caption : to.caption };
    });
    frame.edges = a.edges.map((edge, i) => ({ ...edge, opacity: mix(edge.opacity, b.edges[i].opacity, move) }));
    frame.counts = Object.fromEntries(Object.keys(a.counts).map(k => [k, Math.round(mix(a.counts[k], b.counts[k], receipt))]));
    frame.countOpacity = Object.fromEntries(Object.keys(a.counts).map(k => [k, a.counts[k] === b.counts[k] ? 1 : Math.abs(1 - 2 * receipt)]));
    for (const key of ['phase', 'message', 'decision', 'operator']) frame[key] = textView(a[key].text, b[key].text, p);
    frame.lastKey = textView(a.lastKey.text, b.lastKey.text, p, .70, .94);
    const archiveChange = step.type === 'new-run' || step.type === 'thaw';
    const handoff = step.type === 'emit' ? .68 : .5;
    frame.runs = p < handoff ? a.runs : b.runs;
    frame.runIndex = p < .5 ? a.runIndex : b.runIndex;
    frame.archiveOpacity = archiveChange ? Math.abs(1 - 2 * move) : 1;
    frame.selected = p < .5 ? a.selected : b.selected;
    frame.archiveAlpha = step.type === 'emit' && step.tokenId ? { [step.tokenId]: win(p, .68, .88) } : {};
    const focusAlpha = win(p, 0, .12) * (1 - win(p, .70, 1));
    const focusIds = [...new Set([...(step.focusIds || []), a.selected, b.selected].filter(Boolean))];
    frame.focus = focusIds.map(id => {
      const token = frame.tokens.find(t => t.id === id);
      const selectedAlpha = mix(a.selected === id ? 1 : 0, b.selected === id ? 1 : 0, move);
      return token && { id, x: token.x, y: token.y, opacity: Math.max(selectedAlpha, focusAlpha * (step.focusIds || []).includes(id)) * token.opacity };
    }).filter(Boolean);
    const movingId = step.tokenId;
    if (movingId && ['load', 'emit', 'read', 'activate', 'freeze'].includes(step.type)) {
      const from = a.tokens.find(t => t.id === movingId), to = b.tokens.find(t => t.id === movingId);
      if (from && to) frame.path = { points: flightPoints(step.type, from, to), progress: move, opacity: focusAlpha * .55 };
    }
    frame.tag = { text: tags[step.type] || '', opacity: win(p, .70, .84) * (1 - win(p, .90, 1)) };
    return frame;
  }
  function sample(seq, time) {
    const t = Math.max(0, Math.min(seq.duration, Number(time) || 0));
    if (t >= seq.duration) return stateFrame(seq, seq.final);
    const index = Math.floor(t);
    return sampleStep(seq, seq.steps[index], t - index);
  }
  const api = { heapPosition, inputPosition, outputPosition, flightPoints, pointAlong, stateFrame, sampleStep, sample, colorMix, textView };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReplacementChoreo = api;
})(typeof window !== 'undefined' ? window : globalThis);
