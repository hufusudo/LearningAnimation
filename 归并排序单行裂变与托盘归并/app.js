/* DOM renderer and owned playback clock. Algorithm and choreography are pure. */
(function () {
  'use strict';
  const M = window.MergeModel, C = window.MergeChoreo, $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const presets = {
    classic: [49,38,65,97,76,13,27,49],
    reverse: [88,77,66,55,44,33,22,11],
    duplicates: [32,18,32,18,32,18,32,18]
  };
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let values = [...presets.classic], speed = 1, reduced = media.matches;
  let seq, bounds, timeline = null, timelineGoal = null, playing = false, nodes, milestoneNodes = [], lastWrite = 0;
  const clock = { t: 0 };
  const initialLink = new URLSearchParams(location.hash.slice(1));
  if (initialLink.has('a')) {
    const tokens = initialLink.get('a').split(',');
    if (tokens.length === 8 && tokens.every(v => /^\d{1,2}$/.test(v))) values = tokens.map(Number);
  }
  if (initialLink.has('s')) {
    const v = Number(initialLink.get('s'));
    if (Number.isFinite(v) && v >= .5 && v <= 3) speed = Math.round(v * 4) / 4;
  }
  if (initialLink.get('r') === '1' || initialLink.get('r') === '0') reduced = initialLink.get('r') === '1';

  function svg(tag, attrs, parent, text) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }
  function attr(el, key, value) {
    const val = typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : String(value);
    if (el.getAttribute(key) !== val) el.setAttribute(key, val);
  }
  function text(el, value) { if (el.textContent !== String(value)) el.textContent = value; }
  function alpha(el, value) { attr(el, 'opacity', value); attr(el, 'visibility', value > .001 ? 'visible' : 'hidden'); }
  function position(el, x, y) { attr(el, 'transform', `translate(${x.toFixed(3)} ${y.toFixed(3)})`); }
  function rgb(c) { return `rgb(${c.map(Math.round).join(',')})`; }
  function clear(layer) { $(layer).replaceChildren(); return $(layer); }

  function buildStage() {
    const trayLayer = clear('tray-layer'), holes = clear('holes-layer'), groups = clear('groups-layer');
    const focus = clear('focus-layer'), indices = clear('indices-layer'), cards = clear('cards-layer'), pointers = clear('pointers-layer');
    const tray = svg('g', {}, trayLayer);
    const trayRect = svg('rect', { class: 'tray-outline', rx: 13, height: C.CH + 32 }, tray);
    const trayLabel = svg('text', { class: 'tray-title', 'text-anchor': 'middle' }, tray);
    const traySlots = seq.cards.map(() => svg('rect', { class: 'tray-slot', y: C.TRAY_Y, width: C.CW, height: C.CH, rx: 11 }, tray));
    nodes = {
      tray, trayRect, trayLabel, traySlots,
      holes: seq.cards.map(() => svg('rect', { class: 'hole', width: C.CW, height: C.CH, rx: 11 }, holes)),
      indices: seq.cards.map(() => svg('text', { class: 'index', y: C.ROW_Y - 11, 'text-anchor': 'middle' }, indices)),
      groups: C.scene(seq.initial, seq.cards).groups.map(g => {
        const root = svg('g', {}, groups), path = svg('path', { class: 'segment-line' }, root);
        const label = svg('text', { class: 'segment-text', y: C.ROW_Y + C.CH + 39, 'text-anchor': 'middle' }, root);
        return { root, path, label, lo: g.lo, hi: g.hi };
      }),
      focus: ['L','R'].map((side, i) => {
        const root = svg('g', {}, focus), color = i ? '#9d6c23' : '#2563eb';
        const rect = svg('rect', { class: 'focus-box', y: C.ROW_Y - 6, height: C.CH + 12, rx: 15, stroke: color }, root);
        const label = svg('text', { class: 'focus-label', y: C.ROW_Y - 58, fill: color, 'text-anchor': 'middle' }, root);
        return { root, rect, label };
      }),
      cards: seq.cards.map(c => {
        const root = svg('g', { 'data-card': c.id }, cards);
        const ring = svg('rect', { class: 'card-ring', x: -4, y: -4, width: C.CW + 8, height: C.CH + 8, rx: 16 }, root);
        const rect = svg('rect', { class: 'card-rect', width: C.CW, height: C.CH, rx: 12 }, root);
        svg('text', { class: 'card-value', x: C.CW / 2, y: 43, 'text-anchor': 'middle' }, root, c.value);
        svg('text', { class: 'card-sub', x: C.CW - 10, y: 61, 'text-anchor': 'end' }, root, c.sub);
        svg('text', { class: 'card-origin', x: 9, y: 16 }, root, `#${c.id}`);
        return { root, ring, rect };
      }),
      pointers: ['L','R'].map((side, i) => {
        const color = i ? '#9d6c23' : '#2563eb', root = svg('g', {}, pointers);
        svg('text', { class: 'pointer-text', x: 0, y: -10, fill: color, 'text-anchor': 'middle' }, root, side);
        svg('path', { d: 'M -4 -5 L 0 0 L 4 -5', fill: 'none', stroke: color, 'stroke-width': 1.5 }, root);
        return root;
      })
    };
  }
  function render() {
    const sample = C.sample(seq, clock.t), v = sample.view;
    attr($('stage-svg'),'data-time',clock.t.toFixed(5));
    attr($('stage-svg'),'data-kind',sample.event ? sample.event.kind : 'ready');
    v.cards.forEach((c, i) => {
      const n = nodes.cards[i]; position(n.root, c.x, c.y); alpha(n.root, c.alpha);
      attr(n.rect, 'fill', rgb(c.fill)); attr(n.rect, 'stroke', rgb(c.stroke));
      attr(n.ring, 'stroke', rgb(c.stroke)); alpha(n.ring, c.ring * .5);
    });
    // The moving identity is drawn over resting cards, without creating a copy.
    if (sample.event && sample.event.kind === 'take' && sample.p > .22 && sample.p < .72) {
      const moving = nodes.cards.find((_, i) => seq.cards[i].id === sample.event.card).root;
      if (moving !== $('cards-layer').lastElementChild) $('cards-layer').appendChild(moving);
    }
    v.holes.forEach((h,i) => { position(nodes.holes[i], h.x,h.y); alpha(nodes.holes[i],h.alpha); });
    v.indices.forEach((item,i) => { attr(nodes.indices[i], 'x', item.x); text(nodes.indices[i], item.label); });
    v.groups.forEach((g,i) => {
      const n = nodes.groups[i], color = rgb([107,112,102].map((x,k) => x + ([45,125,98][k]-x)*g.ordered));
      alpha(n.root,g.alpha); attr(n.path,'d',`M ${g.x} ${C.ROW_Y+C.CH+16} v 6 h ${g.width} v -6`); attr(n.path,'stroke',color);
      attr(n.label,'x',g.x+g.width/2); attr(n.label,'fill',color);
      text(n.label, g.label); alpha(n.label,g.labelAlpha);
    });
    v.focus.forEach((f,i) => { const n=nodes.focus[i]; alpha(n.root,f.alpha); attr(n.rect,'x',f.x); attr(n.rect,'width',f.width); attr(n.label,'x',f.x+f.width/2); text(n.label,f.label); });
    v.pointers.forEach((p,i) => { position(nodes.pointers[i],p.x,C.ROW_Y-24); alpha(nodes.pointers[i],p.alpha); });
    alpha(nodes.tray,v.tray.alpha); attr(nodes.trayRect,'x',v.tray.x); attr(nodes.trayRect,'y',v.tray.y); attr(nodes.trayRect,'width',v.tray.width);
    attr(nodes.trayLabel,'x',v.tray.x+v.tray.width/2); attr(nodes.trayLabel,'y',C.TRAY_Y+C.CH+39); text(nodes.trayLabel,v.tray.text); alpha(nodes.trayLabel,v.tray.textAlpha);
    v.tray.slots.forEach((s,i) => { attr(nodes.traySlots[i],'x',s.x); alpha(nodes.traySlots[i],s.alpha); });
    text($('comparison'),v.comparison.text); alpha($('comparison-group'),v.comparison.alpha);
    const fx=v.effect;
    alpha($('cut-group'),fx.cutHeight ? fx.alpha : 0); attr($('cut-line'),'x1',fx.cutX); attr($('cut-line'),'x2',fx.cutX); attr($('cut-line'),'y1',C.ROW_Y-29); attr($('cut-line'),'y2',C.ROW_Y-29+fx.cutHeight);
    attr($('cut-label'),'x',fx.cutX); attr($('cut-label'),'y',C.ROW_Y-39); text($('cut-label'), sample.event && sample.event.mid !== undefined ? `mid ${sample.event.mid}` : '');
    alpha($('event-tag'),fx.tagAlpha); position($('event-tag'),fx.tagX,fx.tagY); text($('tag-text'),fx.tag);
    alpha($('guide-ring'),fx.guideAlpha); attr($('guide-ring'),'x',fx.guideX); attr($('guide-ring'),'y',fx.guideY);
    alpha($('flight-path'),fx.pathAlpha); ['x1','y1','x2','y2'].forEach(k => attr($('flight-path'),k,fx[k]));
    text($('phase'),v.phase.text); $('phase').style.opacity=v.phase.alpha;
    text($('caption'),v.caption.text); $('caption').style.opacity=v.caption.alpha;
    for(const k of ['cmp','mv']) {
      const el=$(`stat-${k}`), counter=v.counters[k]; text(el,counter.text);
      el.style.opacity=counter.alpha; el.style.transform=`translateY(${counter.dy}px)`;
    }
    text($('time-readout'),clock.t.toFixed(2));
    const completed = bounds.filter(b => b <= clock.t + 1e-6).length - 1;
    text($('step-readout'),`${completed} / ${seq.events.length}`);
    $('progress').value=String(clock.t); $('progress').setAttribute('aria-valuetext',`第${completed}步，共${seq.events.length}步，${v.phase.text}`);
    $('btn-prev').disabled=clock.t <= 1e-6; $('btn-next').disabled=clock.t >= seq.duration-1e-6;
    const active = milestoneNodes.filter(m => clock.t >= m.t-1e-6).at(-1);
    milestoneNodes.forEach(m => { if(m===active) m.button.setAttribute('aria-current','step'); else m.button.removeAttribute('aria-current'); });
    if (performance.now()-lastWrite > 300) writeLink();
  }
  function writeLink() {
    lastWrite=performance.now();
    try { history.replaceState(null,'','#'+new URLSearchParams({ t: clock.t.toFixed(2), a: values.join(','), s: String(speed), r: reduced?'1':'0' })); } catch { /* file:// may restrict history; controls still work. */ }
  }
  function setPlaying(value) {
    playing=value; document.body.dataset.playing=String(value);
    text($('play-label'),value?'暂停':'播放'); text($('play-icon'),value?'Ⅱ':'▶');
    $('btn-play').setAttribute('aria-label',value?'暂停演示':'播放演示');
  }
  function pause() { if(timeline) timeline.pause(); setPlaying(false); writeLink(); }
  function clearTimeline() { if(timeline) timeline.kill(); timeline=null; timelineGoal=null; }
  function seek(t) { pause(); clearTimeline(); clock.t=Math.max(0,Math.min(seq.duration,t)); render(); writeLink(); }
  function runTo(target) {
    clearTimeline();
    if(!window.gsap || reduced && target < clock.t) { seek(target); return; }
    timelineGoal=target;
    timeline=window.gsap.timeline({ paused:true, onUpdate:render, onComplete:() => { setPlaying(false); render(); writeLink(); } });
    if(reduced) {
      bounds.filter(b => b>clock.t+1e-6 && b<=target+1e-6).forEach(b => timeline.to(clock,{ t:b, duration:.9, ease:p=>p<1?0:1 }));
    } else timeline.to(clock,{ t:target, duration:Math.abs(target-clock.t), ease:'none' });
    timeline.timeScale(speed); setPlaying(true); timeline.play();
  }
  function play() {
    if(!window.gsap) return;
    if(timeline && timelineGoal===seq.duration && timeline.paused() && timeline.progress()<1) { setPlaying(true); timeline.resume(); return; }
    if(clock.t>=seq.duration-1e-6) seek(0);
    runTo(seq.duration);
  }
  function step(dir) {
    const target=dir>0 ? bounds.find(b=>b>clock.t+1e-6) : [...bounds].reverse().find(b=>b<clock.t-1e-6);
    if(target===undefined) return;
    if(reduced || !window.gsap) seek(target); else runTo(target);
  }
  function buildMilestones() {
    const host=$('milestones'); host.replaceChildren();
    const points=[{label:'单行裂变',t:0}];
    [2,4,8].forEach(size => { const i=seq.events.findIndex(e=>e.kind==='prepare' && e.after.tray.cards.length===size); if(i>=0) points.push({label:`${size/2} + ${size/2} → ${size}`,t:bounds[i+1]}); });
    points.push({label:'完整有序',t:seq.duration});
    milestoneNodes=points.map(point=>{
      const button=document.createElement('button'); button.type='button'; button.textContent=point.label; button.addEventListener('click',()=>seek(point.t)); host.appendChild(button); return {...point,button};
    });
  }
  function rebuild(next,keep) {
    pause(); clearTimeline(); values=[...next]; seq=M.build(values); bounds=[0]; seq.events.forEach(e=>bounds.push(bounds.at(-1)+e.duration));
    $('progress').max=String(seq.duration); buildStage(); buildMilestones(); clock.t=Math.min(keep,seq.duration);
    $('preset').value=Object.keys(presets).find(k=>presets[k].every((v,i)=>v===values[i])) || 'random';
    render(); writeLink();
  }
  $('btn-play').addEventListener('click',()=>playing?pause():play());
  $('btn-prev').addEventListener('click',()=>step(-1)); $('btn-next').addEventListener('click',()=>step(1));
  $('btn-reset').addEventListener('click',()=>seek(0));
  $('progress').addEventListener('input',e=>seek(Number(e.target.value)));
  $('speed').addEventListener('input',e=>{ speed=Number(e.target.value); text($('speed-readout'),`${speed}×`); if(timeline) timeline.timeScale(speed); writeLink(); });
  function setReduced(value) {
    const wasPlaying=playing; pause(); clearTimeline(); reduced=value; $('reduced-motion').checked=value;
    document.body.dataset.motion=value?'reduced':'full';
    if(value) clock.t=bounds.find(b=>b>=clock.t-1e-6) ?? seq.duration;
    render(); writeLink(); if(wasPlaying && clock.t<seq.duration) runTo(seq.duration);
  }
  $('reduced-motion').addEventListener('change',e=>setReduced(e.target.checked));
  media.addEventListener('change',e=>setReduced(e.matches));
  $('preset').addEventListener('change',e=>{ if(presets[e.target.value]) rebuild(presets[e.target.value],clock.t); });
  $('btn-random').addEventListener('click',()=>rebuild(Array.from({length:8},()=>10+Math.floor(Math.random()*80)),clock.t));
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea,button,a,[contenteditable="true"]')) return;
    if(e.code==='Space') {e.preventDefault(); playing?pause():play();}
    if(e.code==='ArrowRight'||e.code==='ArrowLeft') {e.preventDefault();step(e.code==='ArrowRight'?1:-1);}
    if(e.code==='Home') {e.preventDefault();seek(0);}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden) pause();});
  window.addEventListener('pagehide',()=>{pause();clearTimeline();});
  $('engine-notice').hidden=!!window.gsap; $('btn-play').disabled=!window.gsap;
  $('speed').value=String(speed); text($('speed-readout'),`${speed}×`); $('reduced-motion').checked=reduced; document.body.dataset.motion=reduced?'reduced':'full';
  const linkTime=Number(initialLink.get('t'));
  rebuild(values,Number.isFinite(linkTime) && linkTime>=0 ? linkTime : 0);
})();
