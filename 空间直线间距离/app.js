/**
 * 空间直线间距离 · 界面与讲解控制（第二轮）
 * 状态只有：当前模块、各模块的进度 p、自由模式权重 w、参数与图层。画面由 model + choreo 每次算出。
 */
(function () {
  'use strict';

  const M = LineModel;
  const HAS_GSAP = typeof gsap !== 'undefined';
  const STEP_SEC = 1.3;   // 1× 下每章推进的秒数
  const DWELL = 0.35;     // 章节之间停留（减少动效时为 0.9 秒的逐章跳转）
  const CHAPTERS = { A: ['观察', '方向', '法向', '投影', '最短'], B: ['观察', '落下', '辅助', '平面', '交线'] };

  // 讲解文字：标题是章节的问题，解说讲机制（不讲考点），公式是本章的关键式
  const TEXT = {
    A: {
      skew: [
        ['怎么量两条异面直线的距离？', '两条直线既不平行也不相交，距离要沿它们的公共垂直方向去量。', ''],
        ['先看各自的走向', 's₁、s₂ 分别是两条直线的方向向量，决定它们的走向。', 's₁、s₂ 为单位方向向量'],
        ['找一个同时垂直两线的方向', 'n = s₁ × s₂ 与两条直线都垂直，是公共法向，只有一个。', 'n = s₁ × s₂'],
        ['任取两点，投影到 n 上', 'AB 在 n 方向上的投影长度就是 d，与 A、B 取在哪里无关。', 'd = |AB · n̂|'],
        ['滑到最近，AB 就是公垂线', '当 AB 与 n 同向时 |AB| 最短，恰好等于 d。', '|AB| ≥ d']
      ],
      parallel: [
        ['两条直线平行', '方向相同，没有唯一的公共法向，要换一种量法。', ''],
        ['先看方向', 's₁ ∥ s₂，两条直线的走向一致。', 's₁ ∥ s₂'],
        ['叉积为零', 's₁ × s₂ = 0，无法用叉积求公法向。', 's₁ × s₂ = 0'],
        ['过 P₂ 作 L₁ 的垂线', '垂足 H 与 P₂ 的连线，就是两平行线之间的距离。', 'd = |P₂H|'],
        ['距离处处相等', '平行线之间的距离处处相等，这条垂线就是答案。', '']
      ],
      coincident: [
        ['两条直线重合', '它们是同一条直线，距离为 0。', ''],
        ['先看方向', 's₁ ∥ s₂，且 P₂ 在 L₁ 上。', ''],
        ['叉积为零', 's₁ × s₂ = 0，同一条直线上没有公垂线。', ''],
        ['距离为 0', 'P₂ 到 L₁ 的垂线长为 0。', 'd = 0'],
        ['结论', '重合时任取两点，距离都是 0。', 'd = 0']
      ],
      intersect: [
        ['两条直线相交', '它们有一个公共点，距离为 0。', ''],
        ['先看方向', 's₁、s₂ 分别是两条直线的方向。', 's₁、s₂'],
        ['找公共法向', 'n = s₁ × s₂ 仍然存在，它垂直于两条直线所在的平面。', 'n = s₁ × s₂'],
        ['投影长度为 0', 'AB 沿 n 的投影为 0，所以 d = 0。', 'd = |AB · n̂| = 0'],
        ['交点处相遇', 'A、B 滑到交点，两点重合。', '|AB| = 0']
      ]
    },
    B: {
      normal: [
        ['直线怎样落到平面上？', '沿平面 π 的法向 n，把直线 L 上的每一点落到 π 上。', ''],
        ['沿法向 n 落下投影线', '每条投影线都平行于 n，落点连成的直线就是投影。', '投影方向 = n'],
        ['找出包含投影线的平面', 'n′ = n × v 同时垂直于 n 与 v，它是辅助平面 π′ 的法向。', 'n′ = n × v'],
        ['作辅助平面 π′', 'π′ 过 L 且平行于 n，所有投影线都落在 π′ 中。', 'π′ ∋ L，π′ ∥ n'],
        ['取两平面的交线', '落点连成的直线 L′ = π ∩ π′，就是 L 在 π 上的投影。', 'L′ = π ∩ π′']
      ],
      pend: [
        ['直线怎样落到平面上？', 'L 垂直于 π，每个点都沿 L 方向落到 π 上。', ''],
        ['沿法向 n 落下投影线', '投影线与 L 重合，所有落点都在同一位置。', '投影方向 = n = v'],
        ['辅助平面不唯一', 'L 与 n 平行，n′ = n × v = 0，π′ 无法唯一确定。', 'n′ = 0'],
        ['没有唯一的 π′', '投影线都重合在 L 上，不需要辅助平面。', ''],
        ['投影退化为一点', 'L 垂直于 π，所有落点重合，投影为一点。', 'L′ = 一点']
      ],
      parallel: [
        ['直线怎样落到平面上？', 'L 与 π 平行，每个点沿 n 落到 π 上，落点连成与 L 平行的直线。', ''],
        ['沿法向 n 落下投影线', '每条投影线都平行于 n，落点连成的直线就是投影。', '投影方向 = n'],
        ['找出包含投影线的平面', 'n′ = n × v 同时垂直于 n 与 v，它是辅助平面 π′ 的法向。', 'n′ = n × v'],
        ['作辅助平面 π′', 'π′ 过 L 且平行于 n，所有投影线都落在 π′ 中。', 'π′ ∋ L，π′ ∥ n'],
        ['投影与 L 平行等长', 'L′ 与 L 平行，且长度相同。', 'L′ ∥ L']
      ],
      inplane: [
        ['直线怎样落到平面上？', 'L 本身在 π 上，每个点落下后仍是它自己。', ''],
        ['沿法向 n 落下投影线', '投影线长度为 0，落点就是 L 上的点。', '投影线 = 0'],
        ['找出包含投影线的平面', 'n′ = n × v 仍然存在，但它不改变结果。', 'n′ = n × v'],
        ['作辅助平面 π′', 'π′ 过 L，它与 π 相交于 L 本身。', 'π′ ∩ π = L'],
        ['投影即自身', 'L′ = L，投影不改变直线。', 'L′ = L']
      ]
    }
  };
  const STATIC_TEXT = {
    common: ['公垂线：最短的那条线', '沿 n 方向的线段 PQ 与两条直线都垂直，它的长度就是 d。', 'd = |PQ|'],
    box: ['六面体：V / S = d', '以 P₁ 为顶点、s₁、s₂、P₁P₂ 为棱的平行六面体，体积除以底面积 S 恰是高 d。', 'd = V / S'],
    plane: ['平面法：过 L₁ 作平面 π ∥ L₂', 'L₂ 上每一点到 π 的距离都相同，所以 d 就是 P₂ 到 π 的距离。', 'd = |P₂ 到 π|']
  };

  // 相交：交点 I 处两条直线；重合：L₂ 取在 L₁ 上 2.4 处
  const I0 = [0, 0, 0.7], uI1 = M.unit([1, 0, 0.5]), uI2 = M.unit([0, 1, 0.5]);
  const PC = [-2.6, -1.2, 0.4], uC = M.unit([1, 0.85, 0.35]);
  const PRESET_A = {
    skew: { p1: [-3, 0, 1], d1: [1, 0, 0], p2: [1, -3, -1], d2: [0, 1, 0] },
    parallel: { p1: [-3, -1, 1.6], d1: [1, 1, 0], p2: [-1.4, -2.6, -0.9], d2: [1, 1, 0] },
    intersect: { p1: M.add(I0, M.mul(uI1, -3)), d1: uI1, p2: M.add(I0, M.mul(uI2, -3)), d2: uI2 },
    coincident: { p1: PC, d1: uC, p2: M.add(PC, M.mul(uC, 2.4)), d2: uC }
  };
  const PRESET_B = {
    oblique: { p: [0.2, 0, 3.4], d: [1, 0.65, -1.4] },
    parallel: { p: [-0.6, 0.4, 2.6], d: [1, 0.8, 0] },
    inside: { p: [-0.9, 0.4, 0], d: [1, 0.8, 0] },
    pendicular: { p: [0.9, 0.7, 3.2], d: [0, 0, -1] }
  };

  const state = {
    module: 'A',
    progress: { A: 0, B: 0 },
    speed: 1,
    motion: false,
    caseA: 'skew', modeA: 'vector',
    caseB: 'oblique', alpha: 0, tb: 0,
    layers: { aCommon: true, aBox: true, aPlane: true, aPoints: true, bProjPlane: true, bDrops: true, bProjLine: true, bPlane: true },
    L1: null, L2: null, LB: null,
    ta: 0, ub: 0,          // 自由模式的 A、B 位置（滑块）
    w: 0,                  // 0：讲解位置；1：滑块位置；之间为平滑过渡
    playing: false
  };
  let storyTimeline = null, storyTween = null, freeTween = null, tbTween = null;

  const applyPresetA = (name) => {
    const P = PRESET_A[name];
    state.caseA = name;
    state.L1 = { P: P.p1, d: M.unit(P.d1) };
    state.L2 = { P: P.p2, d: M.unit(P.d2) };
  };
  const applyPresetB = (name) => {
    const P = PRESET_B[name];
    state.caseB = name;
    state.LB = { C: P.p, d: M.unit(P.d) };
  };

  // ---------- 几何与位置 ----------
  const progress = () => state.progress[state.module];
  const setProgress = (p) => { state.progress[state.module] = Math.max(0, Math.min(STEPS, p)); };
  const STEPS = 4;
  const kindA = () => M.classify(state.L1.P, state.L1.d, state.L2.P, state.L2.d);

  // 讲解位置（只由进度决定）与自由位置（滑块）之间按 w 过渡
  function positionsA(p) {
    const kind = kindA();
    const view = StoryChoreo.viewA(p, kind);
    const story = M.slideParams(state.L1.P, state.L1.d, state.L2.P, state.L2.d, view.slide);
    return {
      ta: story.ta + (state.ta - story.ta) * state.w,
      ub: story.ub + (state.ub - story.ub) * state.w,
      kind, view
    };
  }

  function frameA(p) {
    const pos = positionsA(p);
    const frame = M.frameA(state.L1.P, state.L1.d, state.L2.P, state.L2.d, pos.ta, pos.ub);
    return { frame, view: pos.view, kind: pos.kind, pos };
  }

  function frameB(p) {
    const C = state.LB.C, d = state.LB.d, alpha = state.alpha * Math.PI / 180;
    const f = M.frameB(C, d, alpha, state.tb);
    return { f: Object.assign({ C, d, alpha: alpha }, f), view: StoryChoreo.viewB(p), kind: f.isPend ? 'pend' : (f.inPlane ? 'inplane' : (f.isPar ? 'parallel' : 'normal')) };
  }

  // ---------- 文字与数值 ----------
  const fmt = (x, n = 2) => (Math.abs(x) < 5e-3 ? 0 : x).toFixed(n);
  const vec = (v, n = 2) => `(${fmt(v[0], n)}, ${fmt(v[1], n)}, ${fmt(v[2], n)})`;
  const kv = (k, v) => `<div class="kv-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const REL = {
    skew: ['异面直线', 'bg-rose', '不共面 · 有唯一公垂线'],
    parallel: ['平行直线', 'bg-amber', '共面 · 方向相同'],
    intersect: ['相交直线', 'bg-blue', '共面 · 距离为 0'],
    coincident: ['重合直线', 'bg-green', '同一条直线']
  };

  function chapterText(p) {
    const c = Math.min(STEPS, Math.ceil(p - 1e-4));
    if (state.module === 'A') {
      if (state.modeA !== 'vector') return { c: 0, t: STATIC_TEXT[state.modeA] };
      return { c, t: TEXT.A[kindA()][c] };
    }
    const f = frameB(p).kind;
    return { c, t: TEXT.B[f][c] };
  }

  // 关键量：随章节出现，逐行给出
  function hudRows(p, frame) {
    if (state.module === 'A') {
      const f = frame;
      if (state.modeA !== 'vector') {
        if (state.modeA === 'box') return kv('V = |混合积|', fmt(f.box.V, 3)) + kv('S = |s₁ × s₂|', fmt(f.box.S, 3)) + kv('d = V / S', fmt(f.d, 3));
        if (state.modeA === 'plane') return kv('d = |P₂ 到 π|', fmt(f.d, 3));
        return kv('d = |PQ|', fmt(f.dCP, 3));
      }
      const step = Math.min(STEPS, Math.ceil(p - 1e-4));
      const rows = [];
      if (step < 1) rows.push(kv('当前章节', '观察两条直线'));
      if (step >= 1) rows.push(kv('s₁', vec(state.L1.d)), kv('s₂', vec(state.L2.d)));
      if (step >= 2 && f.n) rows.push(kv('n = s₁ × s₂', vec(M.cross(state.L1.d, state.L2.d))));
      if (step >= 2 && !f.n) rows.push(kv('s₁ × s₂', '0（平行）'));
      if (step >= 3 && f.kind !== 'parallel' && f.kind !== 'coincident') {
        rows.push(kv('AB', vec(f.AB)));
        rows.push(kv('AB · n̂', fmt(M.dot(f.AB, f.n), 3)));
        rows.push(kv('d = |AB · n̂|', `<span class="red">${fmt(f.d, 3)}</span>`));
      }
      if (step >= 3 && f.kind === 'parallel') rows.push(kv('d = |P₂H|', `<span class="red">${fmt(f.dCP, 3)}</span>`));
      if (step >= 4 && f.kind !== 'parallel') {
        rows.push(kv('|AB|', fmt(M.len(f.AB), 3)));
        rows.push(kv('|AB| − d', fmt(M.len(f.AB) - f.d, 3)));
      }
      if (step >= 4 && f.kind === 'parallel') rows.push(kv('d', `<span class="red">${fmt(f.d, 3)}</span>`));
      return rows.join('');
    }
    const f = frame;
    const step = Math.min(STEPS, Math.ceil(p - 1e-4));
    const rows = [];
    if (step < 1) rows.push(kv('当前章节', '观察 L 与 π'));
    if (step >= 1) rows.push(kv('平面法向 n', vec(f.n)), kv('直线方向 v', vec(f.d)));
    if (step >= 2) rows.push(kv('n′ = n × v', f.isPend ? '0' : vec(f.aux || [0, 0, 0])));
    if (step >= 3) rows.push(kv('π′', f.isPend ? '不唯一' : '过 L，且 ∥ n'));
    if (step >= 4) rows.push(kv('L′ 方向', f.isPend ? '一点' : vec(M.unit(f.dPerp) || [0, 0, 0])), kv('M′', vec(f.Mp)));
    return rows.join('');
  }

  // ---------- 渲染 ----------
  const setText = (id, t) => { const el = document.getElementById(id); if (el && el.textContent !== t) el.textContent = t; };
  let lastHud = '', lastCard = '';

  function render() {
    const p = progress();
    if (state.module === 'A') {
      const { frame, view, kind } = frameA(p);
      StageA.apply(
        { P1: state.L1.P, d1: state.L1.d, P2: state.L2.P, d2: state.L2.d },
        frame, view, { mode: state.modeA, layers: state.layers }
      );
      updateBadge(REL[kind]);
      paintHud(hudRows(p, frame));
      paintCard(p);
      syncSliders(frame, kind);
    } else {
      const { f, view, kind } = frameB(p);
      StageB.apply(f, view, { layers: state.layers });
      const pendLabel = f.isPend ? ['L ⊥ π', 'bg-rose', '投影退化为一点'] : (f.inPlane ? ['L ⊂ π', 'bg-green', '投影即自身'] : (f.isPar ? ['L ∥ π', 'bg-amber', "L′ ∥ L"] : ['L 与 π 斜交', 'bg-blue', 'L′ 是一般直线']));
      updateBadge(pendLabel);
      paintHud(hudRows(p, f));
      paintCard(p);
      syncSliders(null, null);
    }
    updateControls();
  }

  function updateBadge([text, cls, sub]) {
    const b = document.getElementById('hud-badge');
    b.className = 'badge ' + cls;
    b.textContent = text;
    setText('hud-subbadge', sub);
  }
  function paintHud(html) {
    if (html === lastHud) return;
    lastHud = html;
    document.getElementById('hud-body').innerHTML = html;
  }
  function paintCard(p) {
    const { c, t } = chapterText(p);
    const key = [state.module, state.modeA, c, t[0], p > 1e-6].join('|');
    if (key === lastCard) { updateStepper(p, c); return; }
    lastCard = key;
    setText('card-title', t[0]);
    setText('card-detail', t[1]);
    const f = document.getElementById('card-formula');
    f.textContent = t[2] || '';
    f.hidden = !t[2];
    updateStepper(p, c);
  }
  function updateStepper(p, c) {
    const staticMode = state.module === 'A' && state.modeA !== 'vector';
    document.getElementById('story-card').classList.toggle('is-static', staticMode);
    document.getElementById('stepper').hidden = staticMode;
    document.getElementById('story-track').hidden = staticMode;
    document.getElementById('story-controls').hidden = staticMode;
    if (staticMode) return;
    const names = CHAPTERS[state.module];
    const pills = document.querySelectorAll('#stepper button');
    pills.forEach((b, i) => {
      b.classList.toggle('active', i === c);
      b.classList.toggle('done', i < c);
      b.setAttribute('aria-current', i === c ? 'step' : 'false');
      if (b.textContent !== `${i}·${names[i]}`) b.textContent = `${i}·${names[i]}`;
    });
    document.getElementById('story-fill').style.width = `${(p / STEPS) * 100}%`;
    setText('story-count', `${c} / ${STEPS}`);
    document.getElementById('free-tag').hidden = !(state.w > 0.5);
  }

  // 滑块显示当前位置（不触发输入事件）
  function syncSliders(frame, kind) {
    if (state.module !== 'A') return;
    const ta = document.getElementById('slider-ta'), ub = document.getElementById('slider-ub');
    if (document.activeElement === ta || document.activeElement === ub) return;
    const p = progress();
    const pos = positionsA(p);
    ta.value = pos.ta.toFixed(2);
    ub.value = pos.ub.toFixed(2);
    setText('val-ta', pos.ta.toFixed(2));
    setText('val-ub', pos.ub.toFixed(2));
    ta.disabled = ub.disabled = kind === 'coincident';
  }

  // ---------- 讲解播放 ----------
  const storyActive = () => state.module === 'B' || state.modeA === 'vector';
  const storyEnd = () => progress() >= STEPS - 1e-6;
  const isPlaying = () => !!storyTimeline && storyTimeline.isActive();

  function buildStory(from) {
    const key = state.module;
    const jump = state.motion;
    const tl = gsap.timeline({ paused: true, onUpdate: render, onComplete: render });
    let at = from;
    while (at < STEPS - 1e-6) {
      const next = Math.min(STEPS, Math.floor(at + 1e-6) + 1);
      tl.to(state.progress, { [key]: next, duration: jump ? 0 : (next - at) * STEP_SEC, ease: 'sine.inOut' });
      at = next;
      if (at < STEPS - 1e-6) tl.to({}, { duration: jump ? 0.9 : DWELL });
    }
    tl.timeScale(state.speed);
    return tl;
  }

  function killMotion() {
    if (storyTimeline) { storyTimeline.kill(); storyTimeline = null; }
    if (storyTween) { storyTween.kill(); storyTween = null; }
  }

  function playStory() {
    if (!storyActive() || !HAS_GSAP) return;
    killMotion();
    leaveFree();
    if (storyEnd()) state.progress[state.module] = 0;
    storyTimeline = buildStory(progress());
    storyTimeline.play();
    render();
  }
  function pauseStory() {
    if (storyTimeline) storyTimeline.pause();
    render();
  }
  function togglePlay() {
    if (!storyActive() || !HAS_GSAP) return;
    if (isPlaying()) pauseStory();
    else if (storyTimeline && !storyEnd()) { leaveFree(); storyTimeline.play(); render(); }
    else playStory();
  }
  function seek(p, animate = true) {
    killMotion();
    const key = state.module;
    const target = Math.max(0, Math.min(STEPS, p));
    if (HAS_GSAP && animate && !state.motion) {
      storyTween = gsap.to(state.progress, { [key]: target, duration: 0.6, ease: 'sine.inOut', onUpdate: render, onComplete: render });
    } else {
      state.progress[key] = target;
      render();
    }
    leaveFree();
  }
  function restartStory() { seek(0, false); playStory(); }
  function stepBy(delta) {
    if (!storyActive()) return;
    seek(Math.ceil(progress() - 1e-4) + delta);
  }
  function setSpeed(x) {
    state.speed = x;
    if (storyTimeline) storyTimeline.timeScale(x);
    render();
  }
  function toggleMotion() {
    const playing = isPlaying();
    state.motion = !state.motion;
    if (storyTimeline) { storyTimeline.kill(); storyTimeline = null; }
    if (playing) playStory();
    render();
  }

  // ---------- 自由模式：拖动滑块 ----------
  function tweenW(to, dur) {
    if (freeTween) freeTween.kill();
    if (!HAS_GSAP) { state.w = to; return; }
    freeTween = gsap.to(state, { w: to, duration: dur, ease: 'sine.inOut', onUpdate: render, onComplete: render });
  }
  function enterFree() {
    if (state.w < 1 && (!freeTween || freeTween.progress() < 1)) tweenW(1, 0.25);
  }
  function leaveFree() {
    if (state.w > 0 && (!freeTween || freeTween.progress() < 1)) tweenW(0, 0.4);
  }

  function snapToClosest() {
    if (state.module !== 'A' || !HAS_GSAP) return;
    const cs = M.commonSegment(state.L1.P, state.L1.d, state.L2.P, state.L2.d);
    if (cs.t === null) return;
    killMotion();
    enterFree();
    gsap.to(state, { ta: cs.t, ub: cs.u, duration: 0.8, ease: 'power2.inOut', onUpdate: render, onComplete: render });
  }

  // ---------- 模块与控件 ----------
  function switchModule(m) {
    killMotion();
    state.module = m;
    state.w = 0;
    if (freeTween) freeTween.kill();
    document.getElementById('tab-module-A').classList.toggle('active', m === 'A');
    document.getElementById('tab-module-B').classList.toggle('active', m === 'B');
    document.getElementById('tab-module-A').setAttribute('aria-selected', String(m === 'A'));
    document.getElementById('tab-module-B').setAttribute('aria-selected', String(m === 'B'));
    document.getElementById('controls-A').hidden = m !== 'A';
    document.getElementById('controls-B').hidden = m !== 'B';
    document.getElementById('layers-A').hidden = m !== 'A';
    document.getElementById('layers-B').hidden = m !== 'B';
    Stage.setModule(m);
    Stage.setCurrentModule(m);
    Stage.resetCamera(m);
    renderStepper();
    lastHud = '';
    lastCard = '';
    playStory();
    render();
  }

  function renderStepper() {
    const host = document.getElementById('stepper');
    host.replaceChildren();
    CHAPTERS[state.module].forEach((name, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${i}·${name}`;
      b.addEventListener('click', () => seek(i));
      host.appendChild(b);
    });
  }

  function updateControls() {
    const playBtn = document.getElementById('story-play');
    const p = progress();
    const label = !HAS_GSAP ? '播放' : isPlaying() ? '暂停' : storyEnd() ? '重播' : p > 1e-6 ? '继续' : '播放';
    if (playBtn.textContent !== label) playBtn.textContent = label;
    playBtn.classList.toggle('is-live', isPlaying());
    playBtn.disabled = !HAS_GSAP || !storyActive();
    document.getElementById('story-prev').disabled = !storyActive() || Math.ceil(p - 1e-4) <= 0;
    document.getElementById('story-next').disabled = !storyActive() || storyEnd();
    document.getElementById('story-motion').setAttribute('aria-pressed', String(state.motion));
    document.body.dataset.motion = state.motion ? 'reduced' : 'full';
    document.querySelectorAll('#story-speed button').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.speed) === state.speed);
      b.disabled = !HAS_GSAP || !storyActive();
    });
    document.getElementById('story-notice').hidden = HAS_GSAP;
    document.getElementById('btn-min').disabled = !HAS_GSAP || (state.module === 'A' ? M.commonSegment(state.L1.P, state.L1.d, state.L2.P, state.L2.d).t === null : false);
    document.getElementById('btn-min-text').textContent = state.module === 'A' ? '滑到最近点' : '让 M 扫过 L';
    document.querySelectorAll('[data-mode-a]').forEach(b => b.classList.toggle('active', b.dataset.modeA === state.modeA));
    document.querySelectorAll('[data-case-a]').forEach(b => b.classList.toggle('active', b.dataset.caseA === state.caseA));
    document.querySelectorAll('[data-case-b]').forEach(b => b.classList.toggle('active', b.dataset.caseB === state.caseB));
    document.getElementById('story-status').classList.toggle('is-live', isPlaying());
    setText('val-alpha', state.alpha + '°');
    setText('val-tb', state.tb.toFixed(2));
    const tbs = document.getElementById('slider-tb');
    if (document.activeElement !== tbs) tbs.value = state.tb;
    const als = document.getElementById('slider-alpha');
    if (document.activeElement !== als) als.value = state.alpha;
  }

  function bindUI() {
    document.getElementById('story-prev').addEventListener('click', () => stepBy(-1));
    document.getElementById('story-next').addEventListener('click', () => stepBy(1));
    document.getElementById('story-play').addEventListener('click', togglePlay);
    const track = document.getElementById('story-track');
    track.addEventListener('click', e => {
      const r = track.getBoundingClientRect();
      seek(STEPS * (e.clientX - r.left) / r.width);
    });
    document.querySelectorAll('#story-speed button').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
    document.getElementById('story-motion').addEventListener('click', toggleMotion);
    document.getElementById('tab-module-A').addEventListener('click', () => switchModule('A'));
    document.getElementById('tab-module-B').addEventListener('click', () => switchModule('B'));
    document.querySelectorAll('[data-mode-a]').forEach(b => b.addEventListener('click', () => { state.modeA = b.dataset.modeA; state.w = 0; killMotion(); render(); if (state.modeA === 'vector') restartStory(); }));
    document.querySelectorAll('[data-case-a]').forEach(b => b.addEventListener('click', () => { applyPresetA(b.dataset.caseA); state.ta = state.ub = 0; state.w = 0; restartStory(); }));
    document.querySelectorAll('[data-case-b]').forEach(b => b.addEventListener('click', () => { applyPresetB(b.dataset.caseB); restartStory(); }));

    const ta = document.getElementById('slider-ta'), ub = document.getElementById('slider-ub');
    const freeInput = (el, key) => el.addEventListener('input', () => {
      state[key] = +el.value;
      killMotion();
      enterFree();
      render();
    });
    freeInput(ta, 'ta');
    freeInput(ub, 'ub');
    document.getElementById('slider-tb').addEventListener('input', e => { state.tb = +e.target.value; render(); });
    document.getElementById('slider-alpha').addEventListener('input', e => { state.alpha = +e.target.value; render(); });

    const KEY = { 'a-common': 'aCommon', 'a-box': 'aBox', 'a-plane': 'aPlane', 'a-points': 'aPoints', 'b-projplane': 'bProjPlane', 'b-drops': 'bDrops', 'b-projline': 'bProjLine', 'b-plane': 'bPlane' };
    document.querySelectorAll('input[data-layer]').forEach(cb => cb.addEventListener('change', () => { state.layers[KEY[cb.dataset.layer]] = cb.checked; render(); }));

    document.getElementById('btn-reset-cam').addEventListener('click', () => Stage.resetCamera(state.module));
    document.getElementById('btn-min').addEventListener('click', () => {
      if (state.module === 'A') snapToClosest();
      else if (HAS_GSAP) {
        if (tbTween) tbTween.kill();
        tbTween = gsap.fromTo(state, { tb: -M.HALF }, { tb: M.HALF, duration: 2.4, ease: 'sine.inOut', onUpdate: render });
      }
    });

    document.addEventListener('keydown', e => {
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.closest('input, select, textarea, button, a, [contenteditable]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); stepBy(1); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); stepBy(-1); }
      else if (e.code === 'Home') { e.preventDefault(); restartStory(); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseStory(); });
  }

  // ---------- 启动 ----------
  window.addEventListener('DOMContentLoaded', () => {
    applyPresetA('skew');
    applyPresetB('oblique');
    state.motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    Stage.init(document.getElementById('canvas-container'), (key, point) => onHandle(key, point));
    renderStepper();
    bindUI();
    Stage.setModule('A');
    render();
    window.setTimeout(playStory, 650);
  });

  // 拖动手柄：改变直线（A 的锚点与方向、B 的点与方向），或者在 A 中直接移动 A、B（这里不做）
  function onHandle(key, point) {
    const clampP = (v) => v.map(x => Math.max(-5.4, Math.min(5.4, x)));
    const toArr = (v) => [v.x, v.y, v.z];
    if (state.module === 'A') {
      if (key === 'P1') state.L1.P = clampP(toArr(point));
      else if (key === 'P2') state.L2.P = clampP(toArr(point));
      else {
        const L = key === 'D1' ? state.L1 : state.L2;
        const diff = M.sub(toArr(point), L.P);
        if (M.len(diff) > 0.35) L.d = M.unit(diff);
      }
    } else {
      if (key === 'C') state.LB.C = clampP(toArr(point));
      else {
        const diff = M.sub(toArr(point), state.LB.C);
        if (M.len(diff) > 0.35) state.LB.d = M.unit(diff);
      }
    }
    render();
  }
})();
