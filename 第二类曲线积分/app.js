(function () {
  'use strict';
  const M = window.LineIntegralModel, C = window.LineIntegralChoreo;
  const $ = id => document.getElementById(id);
  const colors = { blue: '#285EC1', green: '#287B60', red: '#B54C41', negative: '#A36B23', ink: '#343C38', muted: '#6B7066' };
  const state = { path: 'parabola', field: 'vortex', count: 12, reverse: false, speed: 1, playing: false,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, focus: 'all', t: 0 };
  let experiment, timeline, delayed, limits;
  const clock = { t: 0 };
  const fixed = (v, places = 2) => (Math.abs(v) < .5 * 10 ** -places ? 0 : v).toFixed(places);
  const signed = (v, places = 3) => (v < -.5 * 10 ** -places ? '−' : '+') + fixed(Math.abs(v), places);
  const n = v => fixed(v, 2);
  const setText = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  const line = (x1, y1, x2, y2, color, width = 1, extra = '') => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" ${extra}/>`;
  const text = (x, y, value, cls = '', color = colors.ink, anchor = 'start') => `<text x="${n(x)}" y="${n(y)}" class="${cls}" style="fill:${color}" text-anchor="${anchor}">${value}</text>`;
  const circle = (x, y, r, fill, extra = '') => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" ${extra}/>`;
  const path = (d, color, width, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const pt = p => ({ x: 285 + p.x * 100, y: 229 - p.y * 100 });
  const mix = (a, b, p) => a + (b - a) * p;
  const barX = i => 58 + (i + .5) * 730 / state.count;
  function arrow(a, b, color, width = 2, alpha = 1) {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < .3) return '';
    const ux = dx / length, uy = dy / length, h = Math.min(8, length * .4), w = h * .48;
    return `<g opacity="${n(alpha)}">${line(a.x, a.y, b.x, b.y, color, width)}<path d="M${n(b.x)} ${n(b.y)} L${n(b.x - h * ux - w * uy)} ${n(b.y - h * uy + w * ux)} L${n(b.x - h * ux + w * uy)} ${n(b.y - h * uy - w * ux)} Z" fill="${color}"/></g>`;
  }
  function renderStatic() {
    let out = text(28, 25, '有向路径 L', 'subhead') + text(565, 25,
      { vortex: 'F = (−y, x)', radial: 'F = (x, y)', constant: 'F = (1.3, 0.7)' }[state.field], 'mono small', colors.muted, 'end');
    for (let x = -2; x <= 2; x += .5) out += line(pt({x,y:0}).x, 52, pt({x,y:0}).x, 355, '#EDF0EA');
    for (let y = -1; y <= 1.5; y += .5) out += line(45, pt({x:0,y}).y, 553, pt({x:0,y}).y, '#EDF0EA');
    out += line(45,229,555,229,'#CED4CC') + line(285,51,285,355,'#CED4CC');
    out += text(558,223,'x','axis') + text(292,53,'y','axis') + text(278,245,'0','axis',colors.muted,'end');
    for (const x of [-2,-1,1,2]) out += text(pt({x,y:0}).x,245,String(x),'axis',colors.muted,'middle');
    for (let x = -2.2; x <= 2.21; x += .55) for (let y = -1; y <= 1.51; y += .5) {
      const f = M.forceAt(state.field,x,y), norm = Math.hypot(f.P,f.Q);
      if (norm < .01) continue;
      const a = pt({x,y}), len = 7 + Math.min(norm * 4,12);
      out += arrow({x:a.x-f.P/norm*len/2,y:a.y+f.Q/norm*len/2}, {x:a.x+f.P/norm*len/2,y:a.y-f.Q/norm*len/2},'#A7B4A8',1.2,.65);
    }
    let d = '';
    for (let i = 0; i <= 180; i++) { const p = pt(M.pointAt(state.path,i/180)); d += `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)} `; }
    out += path(d,'#B2BAB2',2);
    experiment.segments.forEach(s => {
      const a=pt(s.start),b=pt(s.end);
      out += line(a.x,a.y,b.x,b.y,'#AABBD7',1,'stroke-dasharray="3 4"');
      out += circle(a.x,a.y,2.1,'#93A8C9');
    });
    const a = pt(M.pointAt(state.path,0)), b=pt(M.pointAt(state.path,1));
    out += circle(a.x,a.y,4,'white','stroke="#67766B" stroke-width="1.5"') + text(a.x-13,a.y+21,'A','plot-label',colors.ink,'end');
    out += circle(b.x,b.y,4,'white','stroke="#67766B" stroke-width="1.5"') + text(b.x+13,b.y+21,'B','plot-label');
    out += text(35,377,'灰色：原曲线', 'small',colors.muted) + text(153,377,'虚线：有向弦近似','small',colors.muted) + text(360,377,state.reverse?'B → A · 反向':'A → B · 正向','mono small',colors.blue);
    out += line(598,16,598,379,'#E5E4DC') + text(628,25,'局部放大 · 力与位移分别缩放','subhead');
    for (const x of [729,963]) {
      out += line(x-86,149,x+86,149,'#DCE1D9') + line(x,65,x,230,'#DCE1D9');
      out += text(x+82,164,'x','axis') + text(x+8,71,'y','axis');
    }
    out += text(729,51,'力 Fᵢ / N','small',colors.red,'middle') + text(963,51,'位移 Δrᵢ / m','small',colors.blue,'middle');
    out += line(28,395,1092,395,'#E5E4DC') + text(35,419,'沿程累加','subhead') + text(113,419,'每柱是一段功，向上为正、向下为负','small',colors.muted);
    out += line(55,467,792,467,'#ADB6AC') + text(43,471,'0','mono small',colors.muted,'end');
    out += line(826,414,826,523,'#E5E4DC') + text(859,423,'分段总和 Wₙ / J','subhead');
    $('static-scene').innerHTML = out;
  }
  function diagram(segment, reveal, originX, force) {
    const origin={x:originX,y:149}, vx=force?segment.P:segment.dx, vy=force?segment.Q:segment.dy;
    const k=73/Math.max(Math.abs(vx),Math.abs(vy), force?.6:.06);
    const tip={x:origin.x+vx*k,y:origin.y-vy*k};
    const xAlpha=state.focus==='y'?.18:1, yAlpha=state.focus==='x'?.18:1;
    let out=arrow(origin,tip,force?colors.red:colors.ink,2.6,.88);
    out+=circle(origin.x,origin.y,2.6,colors.ink);
    out+=line(tip.x,origin.y,tip.x,tip.y,'#AAB7A6',1,'stroke-dasharray="3 4" opacity=".55"');
    out+=line(origin.x,tip.y,tip.x,tip.y,'#AAB7A6',1,'stroke-dasharray="3 4" opacity=".55"');
    out+=arrow(origin,{x:origin.x+vx*k*reveal.x,y:origin.y},colors.blue,3,xAlpha);
    out+=arrow(origin,{x:origin.x,y:origin.y-vy*k*reveal.y},colors.green,3,yAlpha);
    out+=`<g opacity="${n(reveal.x*xAlpha)}">${text(origin.x+vx*k/2,origin.y+(vy<0?-12:21),force?'Pᵢ':'Δxᵢ','value',colors.blue,'middle')}</g>`;
    out+=`<g opacity="${n(reveal.y*yAlpha)}">${text(origin.x+(vx<0?12:-12),origin.y-vy*k/2,force?'Qᵢ':'Δyᵢ','value',colors.green,vx<0?'start':'end')}</g>`;
    if (Math.hypot(vx,vy)<1e-9) out+=text(origin.x,185,force?'零力向量':'零位移','small',colors.muted,'middle');
    out+=text(tip.x+(vx<0?-9:9),tip.y+(vy>0?-8:18),force?'Fᵢ':'Δrᵢ','value',force?colors.red:colors.ink,vx<0?'end':'start');
    return out;
  }
  function detailLayer(v) {
    const s=experiment.segments[v.index], forceScale=31/Math.max(1,Math.hypot(s.P,s.Q)), a=pt(s.midpoint);
    let out=arrow(a,{x:a.x+s.P*forceScale,y:a.y-s.Q*forceScale},colors.red,2.6);
    out+=circle(a.x,a.y,3.2,colors.red)+text(a.x+11,a.y-14,'中点取力','plot-label',colors.red);
    // The dashed bridge makes the source of the magnified vectors visible.
    out+=path(`M${n(a.x+12)} ${n(a.y)} L579 ${n(a.y)} L617 149`,'#A9B8D0',1,'stroke-dasharray="3 5"');
    out+=diagram(s,v,729,true)+diagram(s,v,963,false);
    const xAlpha=state.focus==='y'?.2:1, yAlpha=state.focus==='x'?.2:1;
    out+=`<g opacity="${n(v.x*xAlpha)}"><rect x="630" y="255" width="454" height="37" rx="6" fill="#F0F4FC"/>${text(642,279,'Pᵢ Δxᵢ','math',colors.blue)}${text(1080,279,`${signed(s.P,2)} × ${signed(s.dx,3)} = ${signed(s.wx)} J`,'mono value',colors.blue,'end')}</g>`;
    out+=`<g opacity="${n(v.y*yAlpha)}"><rect x="630" y="301" width="454" height="37" rx="6" fill="#EEF5F0"/>${text(642,325,'Qᵢ Δyᵢ','math',colors.green)}${text(1080,325,`${signed(s.Q,2)} × ${signed(s.dy,3)} = ${signed(s.wy)} J`,'mono value',colors.green,'end')}</g>`;
    const sign=s.work< -1e-9?'负功':s.work>1e-9?'正功':'零功', color=s.work< -1e-9?colors.negative:s.work>1e-9?colors.green:colors.muted;
    out+=`<g opacity="${n(v.result)}">${text(640,369,'ΔWᵢ = Pᵢ Δxᵢ + Qᵢ Δyᵢ','math')}${text(1014,369,`${signed(s.work)} J`,'mono value',color,'end')}<rect x="1035" y="348" width="49" height="27" rx="5" fill="${color}"/>${text(1059,367,sign,'small','#fff','middle')}</g>`;
    return `<g opacity="${n(v.alpha)}">${out}</g>`;
  }
  const captions=[
    '先沿有向路径取一小段，在该段中点取力。',
    '水平力只与水平位移相乘，得到这一段的水平功。',
    '竖直力只与竖直位移相乘，得到这一段的竖直功。',
    '两份功带符号相加，得到这一小段的总功。',
    '把这一段功送入总和；正功增加，负功扣回。'
  ];
  function render() {
    const view=C.sample(experiment,state.t), s=experiment.segments[view.index];
    let out='';
    experiment.segments.forEach((item,i)=>{
      const a=pt(item.start),b=pt(item.end);
      if (i<view.index) out+=line(a.x,a.y,b.x,b.y,'#6D8CBE',2);
      const selected=i===view.index?view.select:i===view.index-1?view.oldSelect:0;
      if(selected>0) out+=`<g opacity="${n(selected)}">${line(a.x,a.y,b.x,b.y,colors.blue,5)}${arrow({x:mix(a.x,b.x,.35),y:mix(a.y,b.y,.35)},{x:mix(a.x,b.x,.66),y:mix(a.y,b.y,.66)},'#fff',2)}</g>`;
    });
    const pos=pt(view.marker);
    out+=circle(pos.x,pos.y,9+7*view.focus,'none',`stroke="${colors.blue}" stroke-width="1.6" opacity="${n(view.focus)}"`);
    out+=circle(pos.x,pos.y,5.2,'#fff',`stroke="${colors.blue}" stroke-width="2.6"`);
    view.details.forEach(v=>out+=detailLayer(v));
    const max=Math.max(...experiment.segments.map(item=>Math.abs(item.work)),.05), width=Math.min(24,730/state.count-8);
    experiment.segments.forEach((item,i)=>{
      const ratio=i<view.index?1:i===view.index?view.receipt:0;
      const h=Math.abs(item.work)/max*32, color=item.work<0?colors.negative:colors.green;
      const bx=barX(i), top=item.work<0?467:467-h;
      if(h>.01) out+=`<rect x="${n(bx-width/2)}" y="${n(top)}" width="${width}" height="${n(h)}" fill="${color}" opacity=".11"/>`;
      if(h>.01&&ratio>0) out+=`<rect x="${n(bx-width/2)}" y="${n(item.work<0?467:467-h*ratio)}" width="${width}" height="${n(h*ratio)}" fill="${color}"/>`;
      if(h<=.01) out+=circle(bx,467,ratio?2.7:1.8,ratio?colors.muted:'#D5DCD2');
      if(i===view.index) out+=line(bx,510,bx,516,colors.blue,2);
      if(state.count<=12||i%2===0)out+=text(bx,532,String(i+1),'mono small',i===view.index?colors.blue:colors.muted,'middle');
    });
    const totalColor=view.cumulative.work<-.0005?colors.negative:colors.ink;
    out+=text(859,464,`${signed(view.cumulative.work)} J`,'mono total',totalColor);
    out+=text(859,489,`Wₓ ${signed(view.cumulative.wx)} J`,'mono small',colors.blue);
    out+=text(859,507,`Wᵧ ${signed(view.cumulative.wy)} J`,'mono small',colors.green);
    out+=text(859,528,view.done?'全程完成 · '+(state.reverse?'B → A':'A → B'):'等待当前段汇入','small',colors.muted);
    if(view.chip.visible){
      const q=view.chip.progress, x=mix(958,barX(view.index),q),y=mix(357,445,q);
      out+=path(`M958 357 L${n(barX(view.index))} 445`,'#B9C5B6',1,'stroke-dasharray="3 5"');
      out+=`<g transform="translate(${n(x)} ${n(y)})"><rect x="-48" y="-14" width="96" height="28" rx="6" fill="white" stroke="${colors.blue}"/>${text(0,4,`${signed(s.work)} J`,'mono small',colors.blue,'middle')}</g>`;
    }
    $('dynamic-scene').innerHTML=out;
    const svg=$('work-svg'); svg.dataset.time=state.t.toFixed(5);svg.dataset.step=view.step;svg.dataset.work=view.cumulative.work.toFixed(9);
    setText('clock',`t = ${fixed(state.t,1)} s`);
    const displayedIndex=Math.floor(view.textStep/5), displayedPhase=view.textStep%5;
    setText('segment-label',`第 ${displayedIndex+1} / ${state.count} 段`);
    setText('phase-label',view.done?'全程完成':C.phases[displayedPhase]);
    $('phase-label').style.opacity=String(view.done?1:view.textAlpha);
    setText('caption',view.done?`分段总和为 ${signed(experiment.total.work)} J；反向后等值变号。`:captions[displayedPhase]);
    $('caption').style.opacity=String(view.done?1:view.textAlpha);
    setText('completion',`已汇入 ${view.completed} / ${state.count} 段`);
    document.querySelectorAll('[data-phase]').forEach(button=>{
      const active=Number(button.dataset.phase)===(view.done?4:displayedPhase);
      if(active)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
    });
    $('progress-input').value=String(Math.round(state.t/C.duration(experiment)*10000));
    setText('progress-value',Math.round(state.t/C.duration(experiment)*100)+'%');
    $('progress-input').setAttribute('aria-valuetext',`第${displayedIndex+1}段，${view.done?"全程完成":C.phases[displayedPhase]}，已汇入${view.completed}段`);
    $('prev-button').disabled=state.t<=1e-6;$('next-button').disabled=view.done;
  }
  function updatePlaying(){
    setText('play-button',state.playing?'Ⅱ 暂停':'▶ 播放');
    $('play-button').setAttribute('aria-label',state.playing?'暂停':'播放');
    $('status-dot').classList.toggle('running',state.playing);
  }
  function pause(){
    state.playing=false;timeline?.pause();delayed?.kill();delayed=null;updatePlaying();
  }
  function seek(t){
    pause();state.t=C.clamp(t,0,C.duration(experiment));clock.t=state.t;
    timeline?.time(state.t,true);render();
  }
  function nextTime(){return limits.find(t=>t>state.t+1e-6)??C.duration(experiment);}
  function prevTime(){return [...limits].reverse().find(t=>t<state.t-1e-6)??0;}
  function reducedTick(){
    if(!state.playing)return;
    const target=nextTime();
    delayed=window.gsap.delayedCall(.9/state.speed,()=>{
      state.t=target;clock.t=target;timeline.time(target,true);render();
      if(target>=C.duration(experiment))pause();else reducedTick();
    });
  }
  function play(){
    if(!window.gsap)return;
    if(state.playing){pause();return;}
    if(state.t>=C.duration(experiment))seek(0);
    state.playing=true;updatePlaying();
    if(state.reduced)reducedTick();else timeline.timeScale(state.speed).play();
  }
  function rebuild(){
    pause();timeline?.kill();
    experiment=M.buildPartition(state.path,state.field,state.count,state.reverse);
    limits=Array.from({length:state.count*5+1},(_,i)=>C.boundary(i));
    state.t=Math.min(state.t,C.duration(experiment));clock.t=state.t;
    if(window.gsap){
      timeline=window.gsap.timeline({paused:true,onUpdate:()=>{state.t=clock.t;render();},onComplete:pause});
      timeline.fromTo(clock,{t:0},{t:C.duration(experiment),duration:C.duration(experiment),ease:'none',immediateRender:false});
      timeline.timeScale(state.speed).time(state.t,true);
    }
    renderStatic();render();
    setText('direction',state.reverse?'B → A':'A → B');$('reverse-button').setAttribute('aria-pressed',String(state.reverse));
  }
  function applyMotion(){
    document.body.dataset.motion=state.reduced?'reduce':'full';
    $('motion-notice').hidden=!state.reduced;
  }
  for(const [id,key] of [['path-select','path'],['field-select','field'],['partition-select','count']])$(id).addEventListener('change',e=>{
    state[key]=key==='count'?Number(e.target.value):e.target.value;rebuild();
  });
  $('reverse-button').addEventListener('click',()=>{state.reverse=!state.reverse;rebuild();});
  $('reset-button').addEventListener('click',()=>seek(0));
  $('prev-button').addEventListener('click',()=>seek(prevTime()));
  $('next-button').addEventListener('click',()=>seek(nextTime()));
  $('play-button').addEventListener('click',play);
  $('progress-input').addEventListener('input',e=>{
    let t=Number(e.target.value)/10000*C.duration(experiment);
    if(state.reduced&&t>0)t=limits.find(end=>end>=t-1e-6)??C.duration(experiment);
    seek(t);
  });
  document.querySelectorAll('[data-phase]').forEach(button=>button.addEventListener('click',()=>{
    const current=C.sample(experiment,state.t), phase=Number(button.dataset.phase);
    seek(C.boundary(Math.floor(current.textStep/5)*5+phase+1));
  }));
  document.querySelectorAll('[data-focus]').forEach(button=>button.addEventListener('click',()=>{
    state.focus=button.dataset.focus;
    document.querySelectorAll('[data-focus]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();
  }));
  $('speed-select').addEventListener('change',e=>{
    state.speed=Number(e.target.value);timeline?.timeScale(state.speed);
    if(state.playing&&state.reduced){delayed?.kill();reducedTick();}
  });
  $('reduced-motion').checked=state.reduced;
  $('reduced-motion').addEventListener('change',e=>{
    const resume=state.playing;pause();state.reduced=e.target.checked;
    if(state.reduced&&state.t>0)seek(limits.find(t=>t>=state.t-1e-6)??C.duration(experiment));
    applyMotion();render();if(resume)play();
  });
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea,button,a'))return;
    if(e.code==='Space'){e.preventDefault();play();}
    if(e.code==='ArrowLeft'){e.preventDefault();seek(prevTime());}
    if(e.code==='ArrowRight'){e.preventDefault();seek(nextTime());}
    if(e.code==='Home'){e.preventDefault();seek(0);}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  window.addEventListener('pagehide',pause);
  window.addEventListener('beforeunload',()=>{pause();timeline?.kill();});
  $('engine-notice').hidden=!!window.gsap;$('play-button').disabled=!window.gsap;
  applyMotion();rebuild();
})();
