/* DOM 只呈现 CpuChoreo.sample(t)；GSAP 只推进唯一的时钟。 */
(function () {
  'use strict';
  const M = window.CpuModel, C = window.CpuChoreo;
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const nodes = {
    PC: [60,100,215,72,'PC · 程序计数器'], IR: [60,220,215,72,'IR · 指令寄存器'],
    ACC: [60,340,215,72,'ACC · 累加器'], R0: [60,460,140,72,'R0 · 地址指针'], R1: [235,460,140,72,'R1 · 通用寄存器'],
    MAR: [490,100,210,72,'MAR · 地址寄存器'], MDR: [490,220,210,72,'MDR · 数据缓冲'],
    Y: [490,340,135,72,'Y · 输入暂存'], ALU: [665,340,135,72,'ALU · 加法器'], Z: [665,460,135,72,'Z · 结果暂存'],
    CU: [300,170,90,72,'控制器'], MEM_INST: [900,130,155,100,'0x0800 · 指令'], MEM_DATA: [900,320,155,100,'0x1008 · 数据']
  };
  const nodeEls = {}, routeEls = {};
  const svg = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v); return el; };
  function text(el, value) { value = String(value); if (el.textContent !== value) el.textContent = value; }
  function alpha(el, a) { if (el instanceof SVGElement) el.setAttribute('opacity', a.toFixed(4)); else el.style.opacity = a.toFixed(4); }
  function initDiagram() {
    for (const [id, [x,y,w,h,name]] of Object.entries(nodes)) {
      const group = svg('g', { id: 'node-' + id, class: id.startsWith('MEM') ? 'memory-node' : '' });
      const halo = svg('rect', { x:x-5,y:y-5,width:w+10,height:h+10,rx:12,class:'node-halo',opacity:0 });
      const body = svg('rect', { x,y,width:w,height:h,rx:8,class:'node-body' });
      const label = svg('text', { x:x+10,y:y+20,class:'node-name' }); label.textContent = name;
      const value = svg('text', { x:x+10,y:y+45,class:'node-value' });
      const sub = svg('text', { x:x+10,y:y+61,class:'node-sub' });
      const role = svg('text', { x:x+w-8,y:y-10,'text-anchor':'end',class:'node-role' });
      group.append(halo,body,label,value,sub,role); $('nodes-layer').append(group);
      nodeEls[id] = { group,halo,body,value,sub,role };
    }
    for (const [id, points] of Object.entries(C.ROUTES)) {
      const d = points.map((p,i) => (i ? 'L' : 'M') + p.join(' ')).join(' ');
      const isAddress = id === 'mar-memory', isExternal = id.endsWith('-mdr');
      const base = svg('path', { d,class:'wire' + (isAddress ? ' address' : isExternal ? ' external' : '') });
      $('wire-layer').append(base);
      const line = svg('path', { d,class:'active-wire',opacity:0 });
      line.style.stroke = isAddress ? '#42678C' : isExternal ? '#2D7D62' : '#A45B20';
      $('active-wire-layer').append(line); routeEls[id] = line;
    }
  }
  function loadLink() {
    const h = new URLSearchParams(location.hash.slice(1));
    const mode = M.MODES.includes(h.get('mode')) ? h.get('mode') : 'ADD_MEM';
    const a = h.has('a') ? M.parseWord(h.get('a')) : 21;
    let b = h.has('b') ? M.parseWord(h.get('b')) : 42;
    if (mode === 'ADD_IMM' && b > 0xFFFF) b = 42;
    const t = Number(h.get('t'));
    return { mode, a:a ?? 21, b:b ?? 42, t:Number.isFinite(t) && t >= 0 ? t : 0 };
  }
  const link = loadLink();
  let seq = M.buildSequence(link.mode, link.a, link.b), clock = { t:Math.min(link.t, seq.duration) };
  let timeline = null, reducedTimer = null, playing = false, stepTarget = null, lastHash = 0;
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const engine = !!window.gsap;
    function writeLink(force = false) {
    if (!force && performance.now() - lastHash < 300) return;
    lastHash = performance.now();
    const hash = new URLSearchParams({ mode:seq.mode, a:String(seq.a), b:String(seq.b), t:clock.t.toFixed(3) });
    try { history.replaceState(null, '', '#' + hash); } catch { /* file:// 也保留可用操作。 */ }
  }
  function setMotion() { document.body.dataset.motion = reduced ? 'reduced' : 'full'; $('reduced-motion').checked = reduced; }
  function makeTimeline() {
    if (timeline) timeline.kill();
    if (!engine) return;
    const start = clock.t;
    timeline = gsap.timeline({ paused:true, onUpdate:() => { render(); writeLink(); }, onComplete:finish });
    timeline.to(clock, { t:seq.duration, duration:seq.duration, ease:'none', startAt:{ t:0 }, immediateRender:false });
    timeline.time(start, true).pause(); clock.t = start;
    timeline.timeScale(Number($('speed-select').value));
  }
  function initSteps() {
    $('progress').max = seq.duration;
    $('timeline-container').replaceChildren();
    seq.steps.forEach((s,i) => {
      const btn = document.createElement('button');
      btn.innerHTML = `<span>${String(i+1).padStart(2,'0')}</span>${s.phase}`;
      btn.title = `${s.title} · 点击查看完成状态`;
      btn.setAttribute('aria-label', `步骤 ${i+1}：${s.title}，查看完成状态`);
      btn.addEventListener('click', () => seek((i+1)*4));
      $('timeline-container').append(btn);
    });
    $('phase-nav').replaceChildren();
    [...new Set(seq.steps.map(s => s.phase))].forEach(phase => {
      const btn = document.createElement('button'); btn.textContent = phase;
      btn.addEventListener('click', () => seek(seq.steps.findIndex(s => s.phase === phase)*4));
      $('phase-nav').append(btn);
    });
    text(nodeEls.MEM_INST.value, seq.instruction);
    nodeEls.MEM_INST.value.setAttribute('class','node-value instruction-value');
    text(nodeEls.MEM_INST.sub, '32 位指令 · 字段示意');
    text(nodeEls.MEM_DATA.value, seq.b); text(nodeEls.MEM_DATA.sub, M.hex(seq.b));
  }
  function displayNode(id, view) {
    const el = nodeEls[id]; if (!el) return;
    let value = view.value, sub = '', small = false;
    if (id === 'PC' || id === 'MAR' || id === 'R0') { value = M.hex(value,4); sub = id === 'PC' ? '下一条待取指令的地址' : id === 'MAR' ? '送往主存的地址' : '指向主存 0x1008'; }
    else if (id === 'IR') { value = value ?? '—'; sub = value === '—' ? '等待装入指令' : '指令字段（非机器码）'; small = true; }
    else if (typeof value === 'string') { sub = '指令字段（非机器码）'; small = true; }
    else { sub = M.hex(value); }
    text(el.value,value); text(el.sub,sub);
    el.value.setAttribute('class','node-value' + (small ? ' instruction-value' : (id === 'Y' || id === 'Z' || id === 'R1') ? ' short-value' : ''));
    if (!small && String(value).length > 9 && (id === 'Y' || id === 'Z' || id === 'R1')) el.value.style.fontSize = '15px'; else el.value.style.fontSize = '';
    alpha(el.value,view.alpha); alpha(el.sub,view.alpha);
  }
  function blend(a,b,q) { const rgb = h => h.startsWith('rgb') ? h.match(/\d+/g).map(Number) : h.match(/\w\w/g).map(v=>parseInt(v,16)); const x=rgb(a),y=rgb(b); return 'rgb('+x.map((v,i)=>Math.round(v+(y[i]-v)*q)).join(',')+')'; }
  function render() {
    const s = C.sample(seq,clock.t,reduced || !engine);
    const { step,state }=s;
    for (const id of ['PC','MAR','MDR','IR','ACC','R0','R1','Y','Z']) displayNode(id,s.values[id]);
    text(nodeEls.CU.value,state.decoded ? 'ADD' : '—'); text(nodeEls.CU.sub,state.decoded ? '已译码' : '待译码');
    alpha(nodeEls.CU.value,s.values.decoded.alpha); alpha(nodeEls.CU.sub,s.values.decoded.alpha);
    const eq = `${state.aluA ?? '—'} + ${state.aluB ?? '—'}`;
    text(nodeEls.ALU.value,state.resultReady ? String(state.Z) : '＋');
    text(nodeEls.ALU.sub,state.resultReady ? '结果 → Z' : '等待两端输入');
    nodeEls.ALU.value.style.fontSize = state.resultReady && String(state.Z).length>9 ? '15px' : '19px';
    alpha(nodeEls.ALU.value,Math.min(s.values.resultReady.alpha,s.values.Z.alpha));
    alpha(nodeEls.ALU.sub,s.values.resultReady.alpha);
    text($('alu-b-label'),`${state.resultReady ? '已算原输入' : '总线输入'}：${state.aluB ?? '—'}`); alpha($('alu-b-label'),Math.min(s.values.aluB.alpha,s.values.resultReady.alpha));
    text($('alu-a-label'),state.aluA === null ? 'Y 输入：—' : eq); alpha($('alu-a-label'),s.values.aluA.alpha);
    for (const [id,el] of Object.entries(nodeEls)) {
      const source = step.source === id, target = step.target === id;
      const q = C.clamp((s.p-.65)/.15), selection = q*q*(3-2*q);
      const selected = ((step.before.selected===id ? 1 : 0)*(1-selection)+(step.after.selected===id ? 1 : 0)*selection)*.6;
      const baseFill = blend('FFFFFF','EBF5EF',selected*.8), baseStroke = blend('D7DDD3','2D7D62',selected);
      el.body.style.fill = blend(baseFill,target ? 'EBF5EF' : 'FFF2E4',(source || target ? s.activity : 0)*.8);
      el.body.style.stroke = blend(baseStroke,target ? '2D7D62' : 'A45B20',source || target ? s.activity : 0);
      alpha(el.halo,source ? s.activity * (1-C.clamp((s.p-.18)/.25)) : 0);
      text(el.role,source && target ? '专用自增' : source ? '送出' : target ? (s.p < .72 ? '等待接收' : '已接收') : '');
      alpha(el.role,s.activity);
    }
    for (const [route,el] of Object.entries(routeEls)) alpha(el,route===step.route ? s.activity : 0);
    const packet=$('data-packet'), p=s.packet;
    packet.setAttribute('visibility',p.alpha>.001 ? 'visible' : 'hidden');
    packet.setAttribute('transform',`translate(${p.x} ${p.y})`); alpha(packet,p.alpha);
    packet.querySelector('rect').style.fill = step.route==='mar-memory' ? '#42678C' : step.route.endsWith('-mdr') ? '#2D7D62' : '#A45B20';
    text($('packet-kind'),step.kind); text($('packet-value'),step.value);
    $('packet-value').style.fontSize = step.value.length>13 ? '11px' : '14px';
    const target=nodes[step.target], tag=$('event-tag');
    const tagX=['Y','ALU'].includes(step.target) ? 565 : Math.max(105,Math.min(985,target[0]+target[2]/2));
    const tagY=(['Y','ALU'].includes(step.target) ? 451 : target[1]+target[3]+19)+s.tag.dy;
    tag.setAttribute('transform',`translate(${tagX} ${tagY})`); alpha(tag,s.tag.alpha);
    tag.setAttribute('visibility',s.tag.alpha>.001 ? 'visible':'hidden'); text($('event-tag-text'),step.tag);
    const read=step.signals.includes('Read'); $('memory-read').setAttribute('visibility',read && s.activity>.001 ? 'visible':'hidden'); alpha($('memory-read'),s.activity);
    text($('action-title'),s.title.text); alpha($('action-title'),s.title.alpha);
    text($('narration'),s.why.text); alpha($('narration'),s.why.alpha);
    text($('phase-name'),s.phase.text); alpha($('phase-name'),s.phase.alpha);
    text($('step-number'),`${String(s.complete ? seq.steps.length : Math.ceil(clock.t/4)).padStart(2,'0')} / ${seq.steps.length}`);
    text($('action-status'),s.complete ? '演示完成' : s.status);
    const routeName=step.route==='mar-memory' ? '地址线' : step.route.endsWith('-mdr') ? '外部数据线' : ['y-alu','alu-z'].includes(step.route) ? '专用线路' : step.route==='pc-increment' ? '专用自增器' : step.route==='ir-cu' ? '译码线路' : '内部单总线';
    text($('transfer-source'),step.source.replace('MEM_INST','主存 · 指令').replace('MEM_DATA','主存 · 数据'));
    text($('transfer-target'),step.target.replace('MEM_INST','主存').replace('MEM_DATA','主存'));
    text($('transfer-kind'),`${routeName} · ${step.kind}`); alpha($('transfer-readout'),s.activity);
    text($('signals'),step.signals.join(' · ')); alpha($('signals'),s.activity);
    const holding=['y-alu','alu-z'].includes(step.route) && state.bus!==null;
    const internal=['pc-mar','mdr-ir','ir-mar','r0-mar','mdr-y','r1-y','ir-y','acc-alu','z-acc'].includes(step.route);
    text($('bus-owner'),holding ? `单总线：ACC 持续供数 ${seq.a}` : internal && s.activity>.02 ? `单总线：仅 ${step.source} 送出` : state.bus!==null ? `单总线：ACC 保持 ${seq.a}` : '单总线：空闲');
    text($('flags'),Object.entries(state.flags).map(([k,v])=>`${k}=${v}`).join('  ')); alpha($('flags'),s.values.flags.alpha);
    $('completion').hidden=!s.complete; text($('completion'),`ACC = ${seq.a} + ${seq.b} → ${seq.result}`);
    $('progress').value=clock.t; text($('time-readout'),`${clock.t.toFixed(1)} / ${seq.duration} s`);
    [...$('timeline-container').children].forEach((btn,i)=>{
      const current=clock.t>0 && i===Math.max(0,Math.ceil(clock.t/4)-1);
      btn.className=current ? 'current' : (i+1)*4<clock.t ? 'passed' : '';
      if(current) btn.setAttribute('aria-current','step'); else btn.removeAttribute('aria-current');
    });
    [...$('phase-nav').children].forEach(btn=>btn.classList.toggle('active',btn.textContent===s.phase.text));
    $('btn-step-prev').disabled=clock.t<=0;
    $('btn-step-next').disabled=clock.t>=seq.duration;
    if(stepTarget!==null && clock.t>=stepTarget-1e-6) { const targetTime=stepTarget; stepTarget=null; playing=false; timeline?.time(targetTime,true).pause(); clock.t=targetTime; render(); updatePlayback();writeLink(true); }
  }
  function updatePlayback() {
    text($('play-text'),playing ? '暂停' : clock.t>=seq.duration ? '重新播放' : '播放');
    $('status-led').classList.toggle('running',playing);
  }
  function stop() {
    playing=false;stepTarget=null;timeline?.pause(); if(reducedTimer) clearTimeout(reducedTimer);reducedTimer=null;
    updatePlayback();writeLink(true);
  }
  function finish() { stop();clock.t=seq.duration;render();updatePlayback();writeLink(true); }
  function seek(t) {
    stop();clock.t=C.clamp(t,0,seq.duration);
    if(reduced || !engine)clock.t=Math.min(seq.duration,Math.ceil(clock.t/4)*4);
    timeline?.time(clock.t,true).pause();render();updatePlayback();writeLink(true);
  }
  function reducedTick() {
    if(!playing)return;
    reducedTimer=setTimeout(()=>{
      clock.t=Math.min(seq.duration,(Math.floor(clock.t/4)+1)*4);timeline?.time(clock.t,true).pause();render();writeLink();
      if(clock.t>=seq.duration)finish();else reducedTick();
    },1400/Number($('speed-select').value));
  }
  function play() {
    if(!engine)return;
    if(clock.t>=seq.duration)seek(0);
    playing=true;stepTarget=null;updatePlayback();
    if(reduced)reducedTick();else timeline.play();
  }
  function advance() {
    stop(); const target=Math.min(seq.duration,(Math.floor((clock.t+1e-6)/4)+1)*4);
    if(!engine||reduced) { seek(target);return; }
    // 单步同样演示完整传送，结束在本步终态；再次点击则前进到下一个事件边界。
    stepTarget=target;playing=true;timeline.play();updatePlayback();
  }
  function back() { seek(Math.max(0,(Math.ceil((clock.t-1e-6)/4)-1)*4)); }
  function applyParameters() {
    const a=M.parseWord($('input-op-a').value),b=M.parseWord($('input-op-b').value);
    if($('instruction-select').value==='ADD_IMM' && b!==null && b>0xFFFF) {
      stop();$('input-error').hidden=false;text($('input-error'),'立即数采用16位无符号字段（0～65535），其余寻址支持32位加数；仍保留上次有效状态。');
      $('input-op-b').setAttribute('aria-invalid','true');$('instruction-select').value=seq.mode;return;
    }
    if(a===null||b===null) {
      stop(); $('input-error').hidden=false;text($('input-error'),'请输入 0～4294967295 的整数，或 0x 开头的十六进制；演示仍保留上次有效值。');
      $('input-op-a').setAttribute('aria-invalid',String(a===null));$('input-op-b').setAttribute('aria-invalid',String(b===null));return;
    }
    stop();$('input-error').hidden=true;$('input-op-a').removeAttribute('aria-invalid');$('input-op-b').removeAttribute('aria-invalid');
    const t=clock.t;seq=M.buildSequence($('instruction-select').value,a,b);clock.t=Math.min(t,seq.duration);
    if(reduced || !engine)clock.t=Math.min(seq.duration,Math.ceil(clock.t/4)*4);
    initSteps();makeTimeline();render();updatePlayback();writeLink(true);
  }
  initDiagram(); $('instruction-select').value=seq.mode;$('input-op-a').value=seq.a;$('input-op-b').value=seq.b;
  setMotion();
  if(reduced || !engine)clock.t=Math.min(seq.duration,Math.ceil(clock.t/4)*4);
  initSteps();makeTimeline();render();updatePlayback();
  $('btn-play-pause').disabled=!engine;$('engine-notice').hidden=engine;
  $('btn-play-pause').addEventListener('click',()=>playing ? stop() : play());
  $('btn-reset').addEventListener('click',()=>seek(0));$('btn-step-prev').addEventListener('click',back);$('btn-step-next').addEventListener('click',advance);
  $('progress').addEventListener('input',e=>seek(Number(e.target.value)));
  $('instruction-select').addEventListener('change',applyParameters);
  for(const id of ['input-op-a','input-op-b'])$(id).addEventListener('input',applyParameters);
  $('speed-select').addEventListener('change',()=>{
    timeline?.timeScale(Number($('speed-select').value));
    if(playing&&reduced){clearTimeout(reducedTimer);reducedTick();}
    text($('pace-hint'),reduced ? '减少动效：按步骤停留，无飞行与补间' : `每步 ${(4/Number($('speed-select').value)).toFixed(1)} 秒 · 到达后才改数值 · 结束后停留`);
  });
  $('reduced-motion').addEventListener('change',()=>{
    const resume=playing;stop();reduced=$('reduced-motion').checked;setMotion();
    if(reduced)clock.t=Math.min(seq.duration,Math.ceil(clock.t/4)*4);
    timeline?.time(clock.t,true).pause();render();updatePlayback();
    text($('pace-hint'),reduced ? '减少动效：按步骤停留，无飞行与补间' : `每步 ${(4/Number($('speed-select').value)).toFixed(1)} 秒 · 到达后才改数值 · 结束后停留`);
    if(resume&&clock.t<seq.duration)play();writeLink(true);
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  document.addEventListener('keydown',e=>{
    if(e.target instanceof Element&&e.target.closest('input,select,textarea,button,a,[tabindex]'))return;
    if(e.ctrlKey||e.altKey||e.metaKey)return;
    if(e.code==='Space'){e.preventDefault();playing ? stop():play();}
    if(e.code==='ArrowRight'){e.preventDefault();advance();}
    if(e.code==='ArrowLeft'){e.preventDefault();back();}
    if(e.code==='Home'){e.preventDefault();seek(0);}
  });
  window.addEventListener('pagehide',()=>{stop();timeline?.kill();});
  writeLink(true);
})();
