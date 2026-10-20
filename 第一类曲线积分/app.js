(function () {
  'use strict';
  const M = window.CurveModel, C = window.CurveChoreo;
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const ids = ['curve','density','segments','selected','n-value','selected-value','scene','axes','wire','chords','selected-mark','selected-halo','selected-chord','point-a','point-b','selected-label','focus','rho-min','rho-max','length','density-legend','zoom-link','flying-chord','micro','micro-empty','micro-halo','micro-chord','triangle','dx-line','dy-line','right-angle','dx-label','dy-label','ds-label','micro-info','local-formula','event-tag','tag-text','mass-bars','mass-link','mass-token','sum-count','sum-value','sum-target','caption','error','limit-formula','phase','time','curve-domain','reset','prev','play','next','speed','reduce-motion','position','progress','duration','steps','notice'];
  const el = Object.fromEntries(ids.map(id => [id, $(id)]));
  const state = { curve:'parabola', density:'gradient', N:8, selected:3, t:0, speed:1, playing:false, reduced:matchMedia('(prefers-reduced-motion: reduce)').matches };
  let seq, stats, curve, density, rhoRange, wireNodes, chordNodes, barNodes, project, micro, timeline, delayed;
  const attr = (node, values) => { for (const [key, val] of Object.entries(values)) if (node.getAttribute(key) !== String(val)) node.setAttribute(key, val); };
  const text = (node, val) => { if (node.textContent !== val) node.textContent = val; };
  const alpha = (node, value) => { if (node.namespaceURI === NS) attr(node, { opacity:value, visibility:value > .00001 ? 'visible':'hidden' }); else { node.style.opacity=value; node.style.visibility=value>.00001?'visible':'hidden'; } };
  const svg = (tag, values, parent) => { const node = document.createElementNS(NS, tag); attr(node, values); parent.append(node); return node; };
  const f = (n, digits = 4) => n.toFixed(digits);
  const lerp = (a, b, p) => a + (b - a) * p;
  const path = (a, b) => `M${a.x},${a.y}L${b.x},${b.y}`;
  const mix = (a,b,p) => `rgb(${a.map((v,i)=>Math.round(lerp(v,b[i],p))).join(',')})`;
  const color = rho => { const range = rhoRange; return mix([217,181,112],[128,82,35], density.id === 'uniform' ? .55 : C.clamp((rho-range.min)/(range.max-range.min))); };
  const formula = (node, tex, fallback, key = tex) => {
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    if (window.katex) window.katex.render(tex,node,{throwOnError:false});
    else text(node,fallback);
  };
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (M.CURVES[q.get('c')]) state.curve=q.get('c');
    if (M.DENSITIES[q.get('d')]) state.density=q.get('d');
    const number = (key, fallback, a, b) => { const n=Number(q.get(key)); return q.has(key)&&Number.isFinite(n)?C.clamp(n,a,b):fallback; };
    state.N=Math.round(number('n',8,4,128)); state.selected=Math.round(number('i',3,0,state.N-1));
    state.t=number('t',0,0,10000); state.speed=number('speed',1,.5,2);
  }
  function save() {
    try { history.replaceState(null,'','#'+new URLSearchParams({c:state.curve,d:state.density,n:state.N,i:state.selected,t:state.t.toFixed(3),speed:state.speed})); } catch { /* 本地文件仍可正常浏览。 */ }
  }
  function rebuild() {
    curve=M.CURVES[state.curve]; density=M.DENSITIES[state.density];
    stats=M.stats(curve,density,state.N); rhoRange=M.densityRange(curve,density); seq=C.build(state.N); state.t=C.clamp(state.t,0,seq.duration);
    el.curve.value=state.curve; el.density.value=state.density; el.segments.value=state.N;
    el.selected.max=state.N; el.selected.value=state.selected+1;
    text(el['n-value'],String(state.N)); text(el['selected-value'],`${state.selected+1} / ${state.N}`);
    const pts=M.sample(curve,200), ymax=Math.max(...pts.map(p=>p.y));
    const scale=Math.min(435/curve.b,240/ymax), ox=65+(450-curve.b*scale)/2;
    project=p=>({x:ox+p.x*scale,y:310-p.y*scale});
    el.axes.replaceChildren();
    const origin=project({x:0,y:0}), xend=project({x:curve.b+.18,y:0}), yend=project({x:0,y:ymax+.15});
    svg('path',{d:`${path(origin,xend)}${path(origin,yend)}`,stroke:'#aab1a6','stroke-width':1,fill:'none','marker-end':'url(#arrow)'},el.axes);
    svg('text',{x:xend.x+8,y:origin.y+4,class:'small'},el.axes).textContent='x';
    svg('text',{x:origin.x-4,y:yend.y-9,class:'small'},el.axes).textContent='y';
    for(let x=0;x<=curve.b+.01;x+=.5){const p=project({x,y:0});svg('text',{x:p.x,y:p.y+20,'text-anchor':'middle',class:'small mono'},el.axes).textContent=f(x,1);}
    for(let y=.5;y<=ymax+.01;y+=.5){const p=project({x:0,y});svg('text',{x:p.x-12,y:p.y+4,'text-anchor':'end',class:'small mono'},el.axes).textContent=f(y,1);}
    text(el['curve-domain'],`x ∈ [${f(curve.a,3)}, ${f(curve.b,3)}] cm`);
    el.wire.replaceChildren(); wireNodes=[];
    for(let i=0;i<pts.length-1;i++){
      const rho=density.rho((pts[i].x+pts[i+1].x)/2,(pts[i].y+pts[i+1].y)/2);
      const node=svg('path',{d:path(project(pts[i]),project(pts[i+1])),fill:'none','stroke-width':7,'stroke-linecap':'round'},el.wire);
      wireNodes.push({node,rho});
    }
    el.chords.replaceChildren();
    chordNodes=stats.segs.map(s=>svg('path',{d:path(project({x:s.x0,y:s.y0}),project({x:s.x1,y:s.y1})),fill:'none',stroke:'#5d655f','stroke-width':1.5,'stroke-linecap':'round'},el.chords));
    el['mass-bars'].replaceChildren();
    barNodes=stats.segs.map((s,i)=>{
      const width=660/state.N, h=42*s.dm/stats.maxDm;
      const ghost=svg('rect',{x:56+i*width+1,y:506-h,width:Math.max(.5,width-2),height:h,fill:'#f1f0e9'},el['mass-bars']);
      const node=svg('rect',{x:56+i*width+1,y:506,width:Math.max(.5,width-2),height:0,fill:color(s.rho)},el['mass-bars']);
      return {node,ghost,h,x:56+(i+.5)*width};
    });
    const range=M.densityRange(curve,density);
    attr(el['density-legend'].querySelector('rect'),{fill:density.id==='uniform'?color(1):'url(#density-ramp)'});
    text(el['rho-min'],`ρ = ${f(range.min,2)}`);text(el['rho-max'],density.id==='uniform'?'处处相同 ρ = 1':`${f(range.max,2)} g/cm · 深色更密`);
    text(el.length,`Lₙ = ${f(stats.L)} cm · 弧长参考 ${f(stats.exactL)} cm`);
    text(el['sum-target'],`M 参考 ${f(stats.exactM)} g`);
    text(el.duration,`${f(seq.duration,1)} s`);
    buildMicro();
    timeline?.kill(); timeline=null;
    if(window.gsap){
      timeline=window.gsap.timeline({paused:true,onUpdate:()=>{state.t=timeline.time();render();},onComplete:()=>pause()});
      timeline.to({}, {duration:seq.duration,ease:'none'}).timeScale(state.speed).time(state.t,true);
    }
    el.steps.replaceChildren();
    C.titles.forEach((name,i)=>{const b=document.createElement('button');b.type='button';b.textContent=`${i+1} ${name}`;b.addEventListener('click',()=>seek(seq.starts[i+1]??seq.duration));el.steps.append(b);});
    render();
  }
  function buildMicro() {
    const s=stats.segs[state.selected];
    const scale=Math.min(230/s.dx,130/Math.max(Math.abs(s.dy),.00001));
    const dx=s.dx*scale, dy=s.dy*scale;
    const A={x:720+(240-dx)/2,y:dy>=0?265:125}, B={x:A.x+dx,y:A.y}, D={x:B.x,y:A.y-dy};
    micro={A,B,D,s,start:project({x:s.x0,y:s.y0}),end:project({x:s.x1,y:s.y1})};
    const d=path(A,D);
    attr(el['micro-halo'],{d});attr(el['micro-chord'],{d});
    attr(el['dx-line'],{d:path(A,B)});attr(el['dy-line'],{d:path(B,D)});
    const sign=dy>=0?-1:1;
    attr(el['right-angle'],{d:Math.abs(dy)<.00001?'':`M${B.x-10} ${B.y}v${10*sign}h10`});
    attr(el['dx-label'],{x:(A.x+B.x)/2,y:A.y+24,'text-anchor':'middle'});text(el['dx-label'],`Δx = ${f(s.dx,3)}`);
    attr(el['dy-label'],{x:B.x+13,y:(B.y+D.y)/2+4});text(el['dy-label'],`Δy = ${f(s.dy,3)}`);
    attr(el['ds-label'],{x:(A.x+D.x)/2-32,y:(A.y+D.y)/2-17,'text-anchor':'end'});text(el['ds-label'],`ℓᵢ = ${f(s.ds,3)}`);
    text(el['micro-info'],`第 ${state.selected+1} 段 · ρᵢ = ${f(s.rho,3)} g/cm`);
  }
  function render() {
    const frame=C.sample(seq,state.t),v=frame.view,s=micro.s;
    el.scene.dataset.time=f(state.t,3);el.scene.dataset.step=frame.step;
    for(const w of wireNodes){const c=color(w.rho).match(/\d+/g).map(Number);attr(w.node,{stroke:mix([139,149,141],c,v.density)});}
    alpha(el['density-legend'],v.density);
    alpha(el.chords,v.split*.65);
    // 选段到放大图的副本位置只依赖当前时刻。
    const selectedAlpha=v.split;
    alpha(el['selected-mark'],selectedAlpha);
    attr(el['selected-halo'],{d:path(micro.start,micro.end)});attr(el['selected-chord'],{d:path(micro.start,micro.end)});
    attr(el['point-a'],{cx:micro.start.x,cy:micro.start.y});attr(el['point-b'],{cx:micro.end.x,cy:micro.end.y});
    attr(el['selected-label'],{x:micro.start.x-12,y:micro.start.y-20,'text-anchor':'end'});text(el['selected-label'],`第 ${state.selected+1} 段`);
    attr(el.focus,{cx:(micro.start.x+micro.end.x)/2,cy:(micro.start.y+micro.end.y)/2,r:18+8*v.focus,opacity:v.focus});
    const from={x:(micro.start.x+micro.end.x)/2,y:(micro.start.y+micro.end.y)/2},to={x:(micro.A.x+micro.D.x)/2,y:(micro.A.y+micro.D.y)/2};
    attr(el['zoom-link'],{d:path(from,to)});alpha(el['zoom-link'],v.extract*.28);
    const q=v.extract;
    attr(el['flying-chord'],{x1:lerp(micro.start.x,micro.A.x,q),y1:lerp(micro.start.y,micro.A.y,q),x2:lerp(micro.end.x,micro.D.x,q),y2:lerp(micro.end.y,micro.D.y,q)});
    alpha(el['flying-chord'],q>0&&q<1?1:0);alpha(el.micro,C.ease(C.win(q,.82,1)));alpha(el['micro-empty'],1-C.ease(C.win(q,0,.3)));
    alpha(el.triangle,v.triangle);
    attr(el['dx-line'],{pathLength:1,'stroke-dasharray':1,'stroke-dashoffset':1-C.win(v.triangle,0,.5)});
    attr(el['dy-line'],{pathLength:1,'stroke-dasharray':1,'stroke-dashoffset':1-C.win(v.triangle,.5,1)});
    alpha(el['dx-label'],C.ease(C.win(v.triangle,.35,.55)));alpha(el['dy-label'],C.ease(C.win(v.triangle,.85,1)));alpha(el['right-angle'],C.ease(C.win(v.triangle,.85,1)));
    let texStep=Math.min(5,Math.max(2,frame.step));
    const change=texStep===5?v.mass:texStep===4?v.differential:texStep===3?v.triangle:1;
    const formulaAlpha=texStep>2?(change<.5?1-2*change:2*change-1):v.extract;
    if(texStep>2&&change<.5)texStep--;
    const local={
      2:[`\\ell_i \\approx \\Delta s_i`, 'ℓᵢ ≈ Δsᵢ'],
      3:[`\\ell_i = \\sqrt{(\\Delta x)^2+(\\Delta y)^2}`, 'ℓᵢ = √(Δx² + Δy²)'],
      4:[`\\mathrm ds=\\sqrt{1+[y'(x)]^2}\\,\\mathrm dx`, 'ds = √(1 + y′(x)²) dx'],
      5:[`m_i \\approx \\rho_i\\ell_i = ${f(s.rho,3)}\\times ${f(s.ds,3)} \\approx ${f(s.dm,4)}\\,\\mathrm g`, `mᵢ ≈ ρᵢℓᵢ = ${f(s.rho,3)} × ${f(s.ds,3)} ≈ ${f(s.dm,4)} g`]
    }[texStep];
    formula(el['local-formula'],local[0],local[1]);
    alpha(el['local-formula'],formulaAlpha);
    const tagTexts=['深色更密','弦长近似','同一小段','勾股求长','弧长微元','密度×长度','逐段累加','细分趋近'];
    text(el['tag-text'],state.density==='uniform'&&v.tagStep===0?'处处等密':v.tagStep===6&&v.fastSum?'余段快速累加':tagTexts[v.tagStep]);alpha(el['event-tag'],v.tagAlpha);
    let sum=0, count=0;
    barNodes.forEach((b,i)=>{const fill=v.fills[i];attr(b.node,{y:506-b.h*fill,height:b.h*fill});sum+=stats.segs[i].dm*fill;if(fill===1)count++;alpha(b.ghost,v.mass*.75);});
    text(el['sum-value'],f(sum)); text(el['sum-count'],`已累加 ${count} / ${state.N} 段`);
    const current=stats.segs[v.sumIndex], src=project({x:current.xm,y:current.ym}), dst={x:barNodes[v.sumIndex].x,y:506-barNodes[v.sumIndex].h-16};
    attr(el['mass-link'],{d:path(src,dst)});alpha(el['mass-link'],v.guide*.65);
    attr(el['mass-token'],{transform:`translate(${lerp(src.x,dst.x,v.flight)},${lerp(src.y,dst.y,v.flight)})`});alpha(el['mass-token'],v.moving&&v.flight>0&&v.flight<1?1:0);
    // 当前取样段的引导外环，不改变用户选择的放大段。
    if(v.moving){attr(el.focus,{cx:src.x,cy:src.y,r:11+4*v.guide,opacity:v.guide});}
    text(el.phase,v.title);el.phase.style.opacity=v.textAlpha;
    text(el.caption,state.density==='uniform'&&v.caption.startsWith('颜色')?'均匀线密度 ρ = 1，质量与长度的数值相同。':v.caption);el.caption.style.opacity=v.textAlpha;
    text(el.time,`${f(state.t,1)} s`);text(el.position,`${frame.step+1} / 8`);
    el.progress.value=Math.round(state.t/seq.duration*1000);
    el.prev.disabled=state.t<=0;el.next.disabled=state.t>=seq.duration;
    Array.from(el.steps.children).forEach((b,i)=>{if(i===frame.step)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
    text(el.error,`分割近似差 |Mₙ − M| = ${f(Math.abs(stats.M-stats.exactM),5)} g`);
    formula(el['limit-formula'],`M=\\lim_{\\max \\Delta s_i\\to0}\\sum_i\\rho(\\xi_i,\\eta_i)\\Delta s_i=\\int_L\\rho\\,\\mathrm ds`, 'M = lim（最大段长 → 0）Σ ρ(ξᵢ, ηᵢ)Δsᵢ = ∫ᴸ ρ ds');
    el['limit-formula'].style.opacity=v.result;
    el['limit-formula'].setAttribute('aria-hidden',v.result===0?'true':'false');
  }
  function pause() { state.playing=false;timeline?.pause();delayed?.kill();delayed=null;syncControls();save(); }
  function syncControls() { text(el.play,state.playing?'暂停':state.t>=seq.duration?'重播':'播放');document.body.dataset.playing=state.playing;document.body.dataset.motion=state.reduced?'reduced':'full';el['reduce-motion'].checked=state.reduced; }
  function seek(t) {pause();const target=C.clamp(t,0,seq.duration);state.t=state.reduced?(seq.boundaries.find(b=>b>=target-1e-7)??seq.duration):target;timeline?.time(state.t,true);render();syncControls();save();}
  function nextTime(dir) {return dir>0?(seq.boundaries.find(t=>t>state.t+.001)??seq.duration):([...seq.boundaries].reverse().find(t=>t<state.t-.001)??0);}
  function reducedTick() {if(!state.playing)return;state.t=nextTime(1);timeline?.time(state.t,true);render();if(state.t>=seq.duration){pause();return;}delayed=window.gsap.delayedCall(.9/state.speed,reducedTick);}
  function play() {if(!timeline)return;if(state.playing){pause();return;}if(state.t>=seq.duration)seek(0);state.playing=true;syncControls();if(state.reduced){reducedTick();}else timeline.time(state.t,true).play();}
  function changeParameters() {
    pause();const ratio=(state.selected+.5)/state.N;state.curve=el.curve.value;state.density=el.density.value;state.N=Number(el.segments.value);state.selected=Math.min(state.N-1,Math.floor(ratio*state.N));rebuild();save();
  }
  readHash();rebuild();syncControls();el.speed.value=state.speed;
  el.curve.addEventListener('change',changeParameters);el.density.addEventListener('change',changeParameters);el.segments.addEventListener('input',changeParameters);
  el.selected.addEventListener('input',()=>{pause();state.selected=Number(el.selected.value)-1;buildMicro();text(el['selected-value'],`${state.selected+1} / ${state.N}`);render();save();});
  el.scene.addEventListener('click',event=>{
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(el.scene.getScreenCTM().inverse());
    let best=-1,dist=30;
    stats.segs.forEach((s,i)=>{const p=project({x:s.xm,y:s.ym}),d=Math.hypot(p.x-point.x,p.y-point.y);if(d<dist){dist=d;best=i;}});
    if(best>=0){el.selected.value=best+1;el.selected.dispatchEvent(new Event('input'));}
  });
  el.reset.addEventListener('click',()=>seek(0));el.prev.addEventListener('click',()=>seek(nextTime(-1)));el.next.addEventListener('click',()=>seek(nextTime(1)));el.play.addEventListener('click',play);
  el.progress.addEventListener('input',()=>seek(Number(el.progress.value)/1000*seq.duration));
  el.speed.addEventListener('change',()=>{state.speed=Number(el.speed.value);timeline?.timeScale(state.speed);if(state.reduced&&state.playing){delayed?.kill();delayed=window.gsap.delayedCall(.9/state.speed,reducedTick);}save();});
  el['reduce-motion'].addEventListener('change',()=>{const resume=state.playing,reduced=el['reduce-motion'].checked;pause();state.reduced=reduced;if(state.reduced&&state.t>0)seek(state.t);syncControls();if(resume&&state.t<seq.duration)play();});
  document.addEventListener('keydown',event=>{if(event.target.closest?.('input,select,textarea,button,a')||event.ctrlKey||event.metaKey||event.altKey)return;const fn={Space:play,ArrowRight:()=>seek(nextTime(1)),ArrowLeft:()=>seek(nextTime(-1)),Home:()=>seek(0)}[event.code];if(fn){event.preventDefault();fn();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  window.addEventListener('pagehide',()=>{pause();timeline?.kill();});
  const notices=[];
  if(!window.gsap){el.play.disabled=true;notices.push('动画引擎未加载：仍可使用单步、进度条与全部参数。');}
  if(!window.katex)notices.push('公式排版未加载，已显示可读的文字公式。');
  if(notices.length){el.notice.hidden=false;text(el.notice,notices.join(' '));}
})();
