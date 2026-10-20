(function () {
  'use strict';
  const M=window.LimitModel, C=window.LimitChoreo, $=id=>document.getElementById(id);
  const svgNS='http://www.w3.org/2000/svg';
  const params={key:'c-damped-sin',epsilon:.7,a:2};
  const clock={t:0}; let timeline=null, delay=null, playing=false, manualProbe=null, lastGeometry='', discretePoints=[];
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  $('reduce-motion').checked=reduced.matches;
  const text=(id,value)=>{const el=$(id);if(el.textContent!==String(value))el.textContent=value;};
  const attrs=(id,values)=>{const el=typeof id==='string'?$(id):id;for(const [key,val] of Object.entries(values))el.setAttribute(key,val);};
  const fmt=(n,d=2)=>{const s=Number(n).toFixed(d);return s.includes('.')?s.replace(/\.?0+$/,''):s;};
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const isDiscrete=()=>M.getModel(params.key).mode==='discrete';
  function node(name,attributes,parent){const n=document.createElementNS(svgNS,name);attrs(n,attributes);parent.append(n);return n;}
  function bounds(){return {max:M.extent(params.key,params.epsilon/2),span:$('view').value==='detail'?params.epsilon*1.8:3.8};}
  function coordinates(){const b=bounds();return {...b,x:x=>82+x/b.max*742,y:v=>216-(v-params.a)/b.span*170};}
  function pathFor(fn,x0,x1,co, count=750){let d='';for(let i=0;i<=count;i++){const x=x0+(x1-x0)*i/count;d+=(i?'L':'M')+co.x(x).toFixed(2)+','+co.y(fn(x)).toFixed(2);}return d;}
  function rebuildGeometry(co){
    const key=[params.key,params.a,co.max,co.span].join('|');if(lastGeometry===key)return;lastGeometry=key;
    const m=M.getModel(params.key), d=isDiscrete();
    $('grid').replaceChildren();
    for(let i=0;i<=5;i++){const x=82+i*742/5;node('line',{x1:x,x2:x,y1:46,y2:386,stroke:'#e8e9e1'},$('grid'));node('text',{x,y:410,'text-anchor':'middle',class:'small'},$('grid')).textContent=fmt(i*co.max/5,1);}
    for(let i=-2;i<=2;i++){const y=216-i*75;node('line',{x1:82,x2:824,y1:y,y2:y,stroke:'#e8e9e1'},$('grid'));if(i!==0)node('text',{x:70,y:y+4,'text-anchor':'end',class:'small'},$('grid')).textContent=fmt(params.a+i*75/170*co.span,2);}
    attrs('limit-line',{y1:216,y2:216});attrs('a-label',{y:220});text('a-label','a = '+fmt(params.a,1));
    attrs('curve',{d:d?'':pathFor(x=>m.fn(x,params.a),.05,co.max,co)});
    attrs('envelope',{d:pathFor(x=>params.a+m.bound(x),.05,co.max,co)+pathFor(x=>params.a-m.bound(x),.05,co.max,co)});
    $('sequence').replaceChildren();discretePoints=[];
    if(d){const stride=Math.max(1,Math.ceil(co.max/100));const indices=new Set();for(let n=1;n<=co.max;n+=stride){indices.add(n);if(stride>1&&n+1<=co.max)indices.add(n+1);}for(const n of [...indices].sort((a,b)=>a-b)){const circle=node('circle',{cx:co.x(n),cy:co.y(m.fn(n,params.a)),r:3.3,fill:'#286491'},$('sequence'));discretePoints.push({n,circle});}text('sampling-note',stride>1?'为保持可读，仅绘部分项；手动探针可逐项查看。':'数列只在正整数处取值；空隙不连线。');}
    else text('sampling-note','虚线为解析误差包络；图像采样只用于绘图。');
    text('expression',m.expression);text('x-axis-label',d?'n → ∞（正整数）':'x → +∞');
    $('probe-slider').min=d?1:.5;$('probe-slider').max=Math.floor(co.max);$('probe-slider').step=d?1:.01;
  }
  function transitionText(id,previous,current,p){const q=clamp(p,0,1);const early=q<.12; text(id,early?previous:current);$(id).style.opacity=previous===current?1:early?1-q/.12:clamp((q-.12)/.15,0,1);}
  function render(){
    const v=C.sample(params,clock.t), co=coordinates(), m=M.getModel(params.key), d=isDiscrete();rebuildGeometry(co);
    const probe=manualProbe===null?v.probe:manualProbe, px=d?Math.max(1,Math.round(probe)):probe;
    const value=m.fn(px,params.a), error=Math.abs(value-params.a), inside=error<v.epsilon-1e-10, equal=Math.abs(error-v.epsilon)<1e-10;
    const certified=v.safe>.999 && v.thresholdAlpha>.999, after=px>v.threshold;
    const threshName=d?'N':'X', variable=d?'n':'x', currentThreshold=M.threshold(params.key,v.epsilon);
    attrs('band',{opacity:v.band});attrs('band-fill',{y:co.y(params.a+v.epsilon),height:340*v.epsilon/co.span});
    attrs('band-lines',{d:`M82 ${co.y(params.a+v.epsilon)}H824M82 ${co.y(params.a-v.epsilon)}H824`});
    attrs('upper-label',{y:co.y(params.a+v.epsilon)-8,opacity:v.band});text('upper-label','a + ε');
    attrs('lower-label',{y:co.y(params.a-v.epsilon)+19,opacity:v.band});text('lower-label','a − ε');
    attrs('envelope',{opacity:v.envelope});
    const tx=co.x(v.threshold);attrs('threshold-mark',{opacity:v.thresholdAlpha});attrs('threshold-line',{x1:tx,x2:tx});attrs('threshold-open',{cx:tx});
    attrs('threshold-tag',{transform:`translate(${clamp(tx-79,95,650)} 4)`,opacity:v.thresholdAlpha});
    text('threshold-label',certified?`${threshName} = ${fmt(v.threshold,d?0:2)} · 充分`:v.step===4?`旧 ${threshName} · 待更新`:v.step===5?'门槛调整中':'建立门槛');
    attrs('safe-area',{x:tx+.8,width:Math.max(0,824-tx-.8),opacity:v.safe});
    attrs('tail-curve',{opacity:v.safe,d:d?'':pathFor(x=>m.fn(x,params.a),Math.max(.05,v.threshold),co.max,co,400)});
    discretePoints.forEach(({n,circle})=>{
      const mix=n>v.threshold?v.safe:0;
      attrs(circle,{fill:`rgb(${Math.round(40+5*mix)},${Math.round(100+25*mix)},${Math.round(145-47*mix)})`});
    });
    const x=co.x(px),y=co.y(value), alpha=manualProbe===null?v.probeAlpha:1;
    attrs('probe',{opacity:alpha});attrs('probe-point',{cx:x,cy:y});attrs('probe-ring',{cx:x,cy:y,opacity:v.focus});attrs('probe-error',{x1:x,x2:x,y1:216,y2:y});attrs('probe-drop',{x1:x,x2:x,y1:y});
    attrs('gauge-value',{y1:326-Math.min(1.15,error/v.epsilon)*190,y2:326-Math.min(1.15,error/v.epsilon)*190,opacity:alpha});
    text('probe-position',`${variable} = ${fmt(px,d?0:2)}`);text('error-value',`|误差| = ${fmt(error,4)}`);
    text('probe-status',equal?'在边界：不属于开邻域':inside?'当前点在带内':'当前点在带外');
    text('guarantee-status',!certified?'尾部保证待建立':after?'已越过充分门槛':'当前点未越过门槛');
    $('probe-slider').value=px;text('probe-output',`${variable} = ${fmt(px,d?0:2)}`);
    const targetStep=v.step, prevStep=Math.max(0,targetStep-1);
    const displayedStep=v.progress<.12?prevStep:targetStep;
    transitionText('phase',C.labels[prevStep],C.labels[targetStep],v.progress);
    transitionText('caption',C.captions[prevStep],C.captions[targetStep],v.progress);
    text('time',clock.t.toFixed(1).padStart(4,'0')+' s');text('progress-value',`${clock.t.toFixed(1)} / 18 s`);$('progress').value=clock.t;
    text('q-threshold',`存在 ${threshName} ${d?'∈ 正整数':'> 0'}`);text('q-tail',`对所有 ${variable} > ${threshName}，${d?'|uₙ − a|':'|f(x) − a|'} < ε`);
    const active=displayedStep===0||displayedStep===4?'q-epsilon':displayedStep===1||displayedStep===2||displayedStep===5?'q-threshold':'q-tail';
    ['q-epsilon','q-threshold','q-tail'].forEach(id=>$(id).classList.toggle('active',id===active));
    const proofVisible=v.envelope>.01;
    text('proof',proofVisible?(!certified?`|误差| ≤ ${m.envelope}；${v.step>=4?'精度调整中，待新门槛到位后建立尾部保证。':'包络单调递减，可控制整个尾部。'}`:M.proof(params.key,Number(v.epsilon.toFixed(6)))):'开邻域 (a − ε, a + ε)：边界不计入。');$('proof').style.opacity=proofVisible?v.envelope:1;
    text('epsilon-value',`ε = ${fmt(v.epsilon,3)}${certified?' · '+threshName+' = '+fmt(currentThreshold,d?0:2):''}`);
    text('epsilon-output',fmt(params.epsilon,2)+' → '+fmt(params.epsilon/2,2));text('target-output',fmt(params.a,1));
    Array.from($('steps').children).forEach((el,i)=>{el.classList.toggle('active',i===displayedStep);el.setAttribute('aria-current',i===displayedStep?'step':'false');});
    $('prev').disabled=clock.t<=0;$('next').disabled=clock.t>=18;
    document.body.dataset.motion=$('reduce-motion').checked?'reduce':'full';
    $('play').textContent=playing?'暂停':clock.t>=18?'再播放':'播放';document.body.classList.toggle('running',playing);
    $('follow-script').disabled=manualProbe===null;
  }
  function writeHash(){try{history.replaceState(null,'','#'+new URLSearchParams({t:clock.t.toFixed(2),model:params.key,e:params.epsilon,a:params.a,view:$('view').value}));}catch{/* file 环境可能禁止历史写入；操作照常可用。 */}}
  function pause(){playing=false;if(timeline)timeline.pause();if(delay){delay.kill();delay=null;}render();writeHash();}
  function seek(t){pause();manualProbe=null;const bounded=clamp(t,0,18);clock.t=$('reduce-motion').checked?(C.boundaries.find(b=>b>=bounded-1e-6)??18):bounded;if(timeline)timeline.time(clock.t,true);render();writeHash();}
  const nextBoundary=()=>C.boundaries.find(t=>t>clock.t+1e-6)??18;
  const prevBoundary=()=>[...C.boundaries].reverse().find(t=>t<clock.t-1e-6)??0;
  function reducedTick(){if(!playing)return;delay=window.gsap.delayedCall(.9/Number($('speed').value),()=>{delay=null;clock.t=nextBoundary();manualProbe=null;if(clock.t>=18)playing=false;render();if(playing)reducedTick();else writeHash();});}
  function play(){if(!window.gsap)return;if(playing){pause();return;}if(clock.t>=18)seek(0);manualProbe=null;playing=true;if($('reduce-motion').checked){clock.t=nextBoundary();render();if(clock.t>=18){pause();return;}reducedTick();}else{timeline.time(clock.t,true).timeScale(Number($('speed').value)).play();render();}}
  function parametersChanged(){pause();params.key=$('model').value;params.epsilon=Number($('epsilon').value);params.a=Number($('target').value);manualProbe=null;render();writeHash();}
  function setMode(mode){pause();const options=Object.entries(M.models).filter(([,m])=>m.mode===mode);$('model').replaceChildren(...options.map(([key,m])=>{const o=document.createElement('option');o.value=key;o.textContent=m.name;return o;}));params.key=options[0][0];$('mode-continuous').setAttribute('aria-pressed',mode==='continuous');$('mode-discrete').setAttribute('aria-pressed',mode==='discrete');manualProbe=null;render();writeHash();}
  C.labels.forEach((name,i)=>{const b=document.createElement('button');b.innerHTML=`<span>${String(i+1).padStart(2,'0')}</span>${name}`;b.addEventListener('click',()=>seek(C.boundaries[i+1]));$('steps').append(b);});
  $('mode-continuous').onclick=()=>setMode('continuous');$('mode-discrete').onclick=()=>setMode('discrete');
  $('model').onchange=parametersChanged;$('epsilon').oninput=parametersChanged;$('target').oninput=parametersChanged;
  $('view').onchange=()=>{pause();render();writeHash();};
  $('probe-slider').oninput=e=>{const value=Number(e.target.value);pause();manualProbe=value;render();};$('follow-script').onclick=()=>{manualProbe=null;render();};
  $('play').onclick=play;$('replay').onclick=()=>seek(0);$('prev').onclick=()=>seek(prevBoundary());$('next').onclick=()=>seek(nextBoundary());$('progress').oninput=()=>seek(Number($('progress').value));
  $('speed').onchange=()=>{if(timeline)timeline.timeScale(Number($('speed').value));if(playing&&$('reduce-motion').checked){delay?.kill();reducedTick();}};
  $('reduce-motion').onchange=()=>{const resume=playing;pause();if($('reduce-motion').checked)seek(clock.t);render();if(resume)play();};
  reduced.addEventListener('change',e=>{$('reduce-motion').checked=e.matches;$('reduce-motion').dispatchEvent(new Event('change'));});
  document.addEventListener('keydown',e=>{if(e.target instanceof Element&&e.target.closest('input,select,textarea,button,a'))return;if(e.ctrlKey||e.metaKey||e.altKey)return;const actions={Space:play,ArrowLeft:()=>seek(prevBoundary()),ArrowRight:()=>seek(nextBoundary()),Home:()=>seek(0)};if(actions[e.code]){e.preventDefault();actions[e.code]();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  window.addEventListener('pagehide',e=>{if(e.persisted)pause();else{timeline?.kill();delay?.kill();}});
  // 拖动舞台可移动探针，滑块提供等价的键盘操作。
  let dragging=false;const svg=$('limit-svg');
  function drag(e){const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const pos=pt.matrixTransform(svg.getScreenCTM().inverse());if(pos.x<82||pos.x>824)return;pause();manualProbe=clamp((pos.x-82)/742*bounds().max,isDiscrete()?1:.5,bounds().max);render();}
  svg.addEventListener('pointerdown',e=>{const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const pos=pt.matrixTransform(svg.getScreenCTM().inverse());if(pos.x<82||pos.x>824||pos.y<46||pos.y>386)return;dragging=true;svg.setPointerCapture(e.pointerId);drag(e);});svg.addEventListener('pointermove',e=>{if(dragging)drag(e);});svg.addEventListener('pointerup',()=>dragging=false);svg.addEventListener('pointercancel',()=>dragging=false);
  const saved=new URLSearchParams(location.hash.slice(1));
  const savedKey=saved.get('model');if(savedKey&&M.models[savedKey])params.key=savedKey;
  const savedE=Number(saved.get('e')),savedA=Number(saved.get('a')),savedT=Number(saved.get('t'));
  if(saved.has('e')&&Number.isFinite(savedE))params.epsilon=clamp(savedE,.16,1.2);
  if(saved.has('a')&&Number.isFinite(savedA))params.a=clamp(savedA,-.5,4);
  if(saved.has('t')&&Number.isFinite(savedT))clock.t=clamp(savedT,0,18);
  if(saved.get('view')==='detail')$('view').value='detail';
  const keep={...params};setMode(M.getModel(keep.key).mode);Object.assign(params,keep);$('model').value=params.key;$('epsilon').value=params.epsilon;$('target').value=params.a;
  const initialTime=clock.t;clock.t=0;
  if(window.gsap){timeline=window.gsap.timeline({paused:true,onUpdate:()=>{render();},onComplete:()=>{playing=false;render();writeHash();}});timeline.fromTo(clock,{t:0},{t:18,duration:18,ease:'none',immediateRender:false});timeline.time(initialTime,true);}else{$('play').disabled=true;$('engine-notice').hidden=false;}
  clock.t=initialTime;render();writeHash();
})();
