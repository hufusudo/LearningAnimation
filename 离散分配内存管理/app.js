/**
 * 离散分配存储管理 · 界面
 * 只负责：把 DiscreteChoreo.viewAt 给出的画面写成 SVG，以及播放、拖动、步骤与减少动效。
 * 所有时刻都经由 show(t)：播放时由 GSAP 时间线推进，拖动与单步直接定位。
 */
(() => {
  const DWELL = 0.9; // 减少动效：每步停留（秒，按速度缩放）
  const $ = (id) => document.getElementById(id);
  const layer = $('layer');
  const scrub = $('scrub');
  const f = (n) => Math.round(n * 100) / 100;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const grp = (a, inner) => (a <= 0.001 ? '' : a >= 0.999 ? inner : `<g opacity="${f(a)}">${inner}</g>`);
  const rect = (x, y, w, h, attr = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${attr}/>`;
  const txt = (x, y, s, attr = '') => `<text x="${f(x)}" y="${f(y)}" ${attr}>${esc(s)}</text>`;
  const clsOf = (owner) => DiscreteChoreo.ownerInfo(owner).cls;

  const st = {
    scn: null, t: 0, speed: 1, reduce: false, playing: false,
    tween: null, dummy: { x: 0 }, timer: null, svgKey: '', narr: null,
    engine: !!window.gsap,
  };

  // 列标题：左为逻辑空间，中为内核区的表，右为用户区的主存
  function headers(scn) {
    const leftSub = { paging: '逻辑页 · 4KB', seg: '逻辑段 · 按段长等比', segpage: '段 → 页 · 每页 4KB', twolevel: '逻辑页 · 目录号＋页号' }[scn.key];
    const hint = { paging: '下标 = 页号，内容 = 块号', seg: '段号 → 段长、基址', segpage: '段号 → 页表，页号 → 块号', twolevel: '目录号 → 页框号，页号 → 块号' }[scn.key];
    const rightSub = scn.key === 'seg' ? '128KB · 按 1KB 单元' : '8 个页框 · 4KB';
    return [
      txt(36, 24, '进程逻辑空间', 'class="h"'), txt(36, 42, leftSub, 'class="lbl-s"'),
      txt(360, 24, '内核区 · 表', 'class="h"'), txt(360, 42, `${scn.reg} · ${hint}`, 'class="lbl-s"'),
      txt(760, 24, '用户区 · 主存', 'class="h"'), txt(760, 42, rightSub, 'class="lbl-s"'),
    ].join('');
  }

  // 把一刻的画面写成 SVG 字符串：先画底层，再画过渡层，外环与芯片在最上
  function draw(v, scn) {
    const o = [headers(scn)];

    for (const L of v.logical) {
      o.push(rect(L.x, L.y, L.w, L.h, `class="blk ${L.cls}" rx="10"`));
      o.push(txt(L.x + 12, L.y + L.h / 2 + 5, L.label, 'class="lbl"'));
      o.push(grp(L.tagAlpha, txt(L.x + L.w - 12, L.y + L.h / 2 + 5, L.tag, 'class="num gold" text-anchor="end"')));
    }

    v.frames.forEach((F, j) => {
      o.push(rect(F.x, F.y, F.w, F.h, `class="frm ${F.base.cls}" rx="8"`));
      o.push(txt(F.x + F.w - 12, F.y + F.h / 2 + 4, F.base.label, 'class="lbl-s halo" text-anchor="end"'));
      if (F.top) {
        o.push(grp(F.topAlpha, rect(F.x, F.y, F.w, F.h, `class="frm ${F.top.cls}" rx="8"`) +
          txt(F.x + F.w - 12, F.y + F.h / 2 + 4, F.top.label, 'class="lbl-s halo" text-anchor="end"')));
      }
      o.push(txt(F.x + 12, F.y + F.h / 2 + 4, `块 ${j}`, 'class="num muted"'));
    });

    if (v.mem) {
      const m = v.mem;
      const run = (r, a) => grp(a, rect(m.x, m.y + r.a * m.k, m.w, (r.b - r.a) * m.k, `class="frm ${clsOf(r.owner)}"`));
      m.base.forEach((r) => o.push(run(r, 1)));
      m.top.forEach((r) => o.push(run(r, r.alpha)));
      m.labels.forEach((r) => o.push(grp(r.alpha, txt(m.x + 12, m.y + ((r.a + r.b) / 2) * m.k + 4, r.text, 'class="lbl-s halo"'))));
    }

    for (const tb of v.tables) {
      if (tb.box) {
        o.push(grp(tb.alpha, rect(tb.box.x, tb.box.y, tb.box.w, tb.box.h, 'class="box" rx="10"') +
          txt(tb.box.x + 10, tb.box.y + 16, tb.box.title, 'class="lbl-s"')));
      }
      for (const row of tb.rows) {
        const cy = row.y + tb.h / 2;
        for (const c of row.cells) {
          const inner = rect(c.x, row.y, c.w, tb.h, 'class="cell" rx="6"') + txt(c.x + c.w / 2, cy + 4, c.text, 'class="num" text-anchor="middle"');
          const sy = c.sy;
          o.push(grp(tb.alpha, sy >= 0.999 ? inner : `<g transform="matrix(1 0 0 ${f(sy)} 0 ${f(cy * (1 - sy))})">${inner}</g>`));
        }
      }
    }

    for (const ln of v.lines) {
      const len = Math.hypot(ln.b.x - ln.a.x, ln.b.y - ln.a.y);
      o.push(grp(ln.alpha, `<path class="conn" d="M${f(ln.a.x)} ${f(ln.a.y)} L${f(ln.b.x)} ${f(ln.b.y)}" ` +
        `stroke-dasharray="${f(len)} ${f(len)}" stroke-dashoffset="${f(len * (1 - ln.draw))}"/>`));
    }

    for (const r of v.rings) {
      o.push(grp(r.alpha, rect(r.x, r.y, r.w, r.h, `class="ring${r.dashed ? ' dash' : ''}" rx="10"`)));
    }

    for (const c of v.chips) {
      o.push(grp(c.alpha, rect(c.x, c.y, c.w, c.h, `class="chip ${c.cls}" rx="${f(c.h / 2)}"`) +
        txt(c.x + c.w / 2, c.y + c.h / 2 + 4, c.text, 'class="chip-t" text-anchor="middle"')));
    }

    if (v.bar) {
      o.push(grp(v.bar.whole.alpha, txt(v.bar.whole.x, v.bar.whole.y + 5, scn.whole, 'class="whole" text-anchor="middle"')));
      for (const fd of v.bar.fields) {
        o.push(grp(fd.alpha, rect(fd.x, fd.y, fd.w, fd.h, 'class="fld" rx="8"') +
          txt(fd.x + fd.w / 2, fd.y + fd.h / 2 + 5, fd.text, 'class="num" text-anchor="middle"')));
      }
    }

    if (v.formula) {
      const fm = v.formula;
      o.push(rect(fm.x, fm.y, fm.w, fm.h, 'class="fbox" rx="12"'));
      o.push(txt(fm.x + 12, fm.y + 18, fm.head, 'class="lbl-s"'));
      o.push(txt(fm.x + fm.w - 12, fm.y + 18, fm.count, 'class="lbl-s" text-anchor="end"'));
      o.push(txt(fm.joinAt.x, fm.joinAt.y + 4, fm.join, 'class="num muted" text-anchor="middle"'));
      for (const [k, s] of [['block', fm.block], ['off', fm.off], ['res', fm.res]]) {
        const res = k === 'res';
        o.push(rect(s.x, s.y, s.w, s.h, 'class="slot empty" rx="7"'));
        o.push(grp(s.alpha, rect(s.x, s.y, s.w, s.h, `class="slot${res ? ' res' : ''}" rx="7"`) +
          txt(s.x + s.w / 2, s.y + s.h / 2 + 4, s.text, `class="num${res ? ' gold' : ''}" text-anchor="middle"`)));
      }
    }

    if (v.compare) {
      const c = v.compare;
      o.push(grp(c.alpha, rect(c.x, c.y, c.w, c.h, 'class="chip in" rx="13"') +
        txt(c.x + c.w / 2, c.y + c.h / 2 + 4, c.text, 'class="num" text-anchor="middle"')));
      o.push(grp(c.okAlpha, txt(c.x + c.w + 12, c.y + c.h / 2 + 4, '未越界 ✓', 'class="lbl-s ok"')));
    }

    for (const fg of v.frags) o.push(grp(fg.alpha, txt(fg.x, fg.y, fg.text, 'class="lbl halo" text-anchor="end"')));

    return o.join('');
  }

  function commit(markup) {
    if (markup === st.svgKey) return;
    st.svgKey = markup;
    layer.innerHTML = markup;
  }

  function markPills(i) {
    $('steps').querySelectorAll('.pill').forEach((b) => {
      const k = Number(b.dataset.i);
      if (k === i) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.classList.toggle('done', k < i);
    });
  }

  function showStatus(v) {
    $('step-no').textContent = `第 ${v.i} 步 · 共 ${v.n - 1} 步`;
    $('phase').textContent = v.phase;
    $('action').textContent = v.action;
    if (st.narr !== v.narr) { $('narr').textContent = v.narr; st.narr = v.narr; }
    $('time').textContent = `${v.time.toFixed(1)} / ${v.total.toFixed(1)} 秒`;
    if (document.activeElement !== scrub) scrub.value = String(Math.round((v.time / v.total) * 1000));
    markPills(v.i);
  }

  // 唯一的画面入口：拖动、单步、播放与重播都经由这里
  function show(t) {
    const v = DiscreteChoreo.viewAt(st.scn, t, { reduce: st.reduce });
    commit(draw(v, st.scn));
    showStatus(v);
  }

  function seekTo(t) {
    const total = st.scn.total;
    const x = Math.min(Math.max(t, 0), total);
    // 减少动效时只停在步的起点，画面即该步的末状态
    st.t = st.reduce ? st.scn.steps[DiscreteChoreo.locate(st.scn, x).i].start : x;
    if (st.tween) { st.tween.pause(); st.tween.progress(st.t / total); }
    show(st.t);
  }

  function stepIndex() {
    return DiscreteChoreo.locate(st.scn, st.t).i;
  }

  function syncPlay() {
    $('play-text').textContent = st.playing ? '❚❚ 暂停' : '▶ 播放';
    $('lamp').classList.toggle('on', st.playing);
  }

  function pause() {
    st.playing = false;
    clearTimeout(st.timer);
    if (st.tween) st.tween.pause();
    syncPlay();
  }

  // 减少动效：不做补间，每步直接到末状态，停留约 0.9 秒
  function reducedTick() {
    if (!st.playing) return;
    const steps = st.scn.steps;
    const i = stepIndex();
    if (i >= steps.length - 1) { pause(); return; }
    st.timer = setTimeout(() => { seekTo(steps[i + 1].start); reducedTick(); }, (DWELL * 1000) / st.speed);
  }

  function play() {
    if (!st.engine && !st.reduce) return;
    if (st.t >= st.scn.total - 1e-6) seekTo(0);
    st.playing = true;
    syncPlay();
    if (st.reduce) reducedTick();
    else st.tween.play();
  }

  function togglePlay() {
    if (st.playing) pause();
    else play();
  }

  function next() {
    pause();
    const i = stepIndex();
    const steps = st.scn.steps;
    seekTo(i < steps.length - 1 ? steps[i + 1].start : st.scn.total);
  }

  // 上一步：若已走过本步的开头，先回到本步开头；否则回到上一步开头
  function prev() {
    pause();
    const steps = st.scn.steps;
    const i = stepIndex();
    const own = steps[i].start;
    seekTo(st.t - own > 0.05 ? own : (i > 0 ? steps[i - 1].start : 0));
  }

  function makeTween() {
    if (st.tween) st.tween.kill();
    st.tween = null;
    if (!st.engine) return;
    st.dummy = { x: 0 };
    st.tween = gsap.to(st.dummy, {
      x: 1,
      duration: st.scn.total,
      ease: 'none',
      paused: true,
      onUpdate: () => { st.t = st.dummy.x * st.scn.total; show(st.t); },
      onComplete: () => { st.t = st.scn.total; pause(); show(st.t); },
    });
    st.tween.timeScale(st.speed);
  }

  function renderPills(scn) {
    const ol = $('steps');
    ol.innerHTML = '';
    let phase = null;
    scn.steps.forEach((s, i) => {
      if (s.phase !== phase) {
        phase = s.phase;
        const tag = document.createElement('li');
        tag.className = 'tag';
        tag.textContent = s.phaseName;
        ol.appendChild(tag);
      }
      if (i === 0) return;
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" class="pill" data-i="${i}" title="跳到第 ${i} 步起点"><span class="n">${i}</span><span>${esc(s.action)}</span></button>`;
      li.querySelector('button').addEventListener('click', () => { pause(); seekTo(scn.steps[i].start); });
      ol.appendChild(li);
    });
  }

  function switchMode(key) {
    pause();
    st.scn = DiscreteModel.build(key);
    st.narr = null;
    st.svgKey = '';
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === key)));
    renderPills(st.scn);
    makeTween();
    seekTo(0);
  }

  function setSpeed(s) {
    st.speed = s;
    if (st.tween) st.tween.timeScale(s);
    document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s)));
  }

  function setReduce(on) {
    st.reduce = on;
    document.body.dataset.motion = on ? 'reduce' : '';
    $('btn-play').disabled = !st.engine && !on;
    const wasPlaying = st.playing;
    pause();
    seekTo(st.t);
    if (wasPlaying) play();
  }

  function onKey(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (el && el.closest('input, select, textarea, button, a')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.code === 'Home') { e.preventDefault(); pause(); seekTo(0); }
  }

  function init() {
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => switchMode(b.dataset.mode)));
    document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
    $('btn-play').addEventListener('click', togglePlay);
    $('btn-prev').addEventListener('click', prev);
    $('btn-next').addEventListener('click', next);
    $('btn-replay').addEventListener('click', () => { pause(); seekTo(0); });
    scrub.addEventListener('input', () => {
      pause();
      seekTo((Number(scrub.value) / 1000) * st.scn.total);
    });
    const reduce = $('reduce');
    reduce.checked = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reduce.addEventListener('change', () => setReduce(reduce.checked));
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

    if (!st.engine) {
      $('notice').hidden = false;
      $('notice').textContent = '动画引擎（GSAP）未能加载：自动播放不可用；可开启减少动效逐步播放，单步、上一步与进度条仍可用。';
    }
    switchMode('paging');
    setReduce(reduce.checked);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
