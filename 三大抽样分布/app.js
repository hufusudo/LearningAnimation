(function(){
  'use strict';
  const M=SamplingModel,C=SamplingChoreo,$=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
  const setText=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
  const setHtml=(id,value)=>{if($(id).innerHTML!==value)$(id).innerHTML=value;};
  const attr=(el,key,value)=>{if(el.getAttribute(key)!==String(value))el.setAttribute(key,value);};
  const clamp=C.clamp,hash=new URLSearchParams(location.hash.slice(1));
  function num(key,fallback,min,max,integer=false){
    const raw=hash.get(key),v=raw===null||raw.trim()===''?NaN:Number(raw);
    return Number.isFinite(v)?clamp(integer?Math.round(v):v,min,max):fallback;
  }
  const state={
    key:['chi','t','f'].includes(hash.get('d'))?hash.get('d'):'chi',
    chiDf:num('chi',8,2,30,true),tDf:num('nu',8,1,30,true),df1:num('n1',5,2,20,true),df2:num('n2',10,1,30,true),
    alpha:[.1,.05,.01].includes(Number(hash.get('a')))?Number(hash.get('a')):.05,
    t:num('t',0,0,15),speed:[.5,1,1.5,2].includes(Number(hash.get('s')))?Number(hash.get('s')):1,
    reduced:hash.has('rm')?hash.get('rm')==='1':matchMedia('(prefers-reduced-motion: reduce)').matches,playing:false
  };
  const P={left:72,right:1002,top:45,bottom:292},PW=P.right-P.left,PH=P.bottom-P.top;
  let prepared,view,cacheKey='',timeline,reducedCall,linkTimer,frameRequest;
  const fmt=(v,n=4)=>{
    if(Math.abs(v)<.5*10**-n)v=0;
    return Math.abs(v)>=1000?v.toFixed(1):v.toFixed(n);
  };
  const tick=v=>v===0?'0':Math.abs(v)<.001?v.toExponential(1).replace('e-','e−'):Math.abs(v)>=1000?v.toFixed(0):Math.abs(v)>=10?v.toFixed(1):Number(v.toPrecision(3)).toString();
  const pct=v=>(100*v).toFixed(2)+'%';
  function params(){return state.key==='f'?{df1:state.df1,df2:state.df2}:{df:state.key==='chi'?state.chiDf:state.tDf};}
  function notation(){return state.key==='chi'?`X ∼ χ²(${state.chiDf})`:state.key==='t'?`T ∼ t(${state.tDf})`:`X ∼ F(${state.df1}, ${state.df2})`;}
  function saveLink(immediate=false){
    clearTimeout(linkTimer);
    const write=()=>{
      const h=new URLSearchParams({d:state.key,chi:state.chiDf,nu:state.tDf,n1:state.df1,n2:state.df2,a:state.alpha,t:state.t.toFixed(3),s:state.speed,rm:state.reduced?'1':'0'});
      try{history.replaceState(null,'','#'+h);}catch{/* 本地环境禁止修改地址时，演示仍可操作。 */}
    };
    if(immediate)write();else linkTimer=setTimeout(write,240);
  }
  function currentFrame(){
    const real=C.sample(state.t,state.alpha);
    if(!state.reduced)return real;
    const next=C.boundaries.find(t=>t>state.t+1e-7);
    const result=C.sample(next??15,state.alpha);
    result.phase=real.phase;result.name=real.name;result.captionIndex=real.phase;result.captionAlpha=1;
    return result;
  }
  function stop(){
    state.playing=false;timeline?.pause();reducedCall?.kill();reducedCall=undefined;
    setText('play','播放演示');$('status-dot').classList.remove('playing');saveLink(true);
  }
  function seek(t,user=true){
    if(user)stop();state.t=clamp(t,0,15);timeline?.time(state.t,true);render();saveLink(user);
  }
  function step(direction){
    const found=direction>0?C.stops.find(t=>t>state.t+.001):[...C.stops].reverse().find(t=>t<state.t-.001);
    seek(found??(direction>0?15:0));
  }
  function reducedTick(){
    reducedCall=gsap.delayedCall(.9/state.speed,()=>{
      if(!state.playing)return;
      const next=C.boundaries.find(t=>t>state.t+.001);
      if(next===undefined){stop();return;}
      seek(next,false);if(next>=15)stop();else reducedTick();
    });
  }
  function play(){
    if(!timeline)return;
    if(state.playing){stop();return;}
    if(state.t>=15)seek(0,false);
    state.playing=true;setText('play','暂停演示');$('status-dot').classList.add('playing');
    if(state.reduced)reducedTick();else timeline.timeScale(state.speed).play(state.t);
  }
  function change(fn){stop();fn();cacheKey='';render();saveLink(true);}
  function makeSvg(tag,attrs,label){
    const el=document.createElementNS(NS,tag);
    for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);
    if(label!==undefined)el.textContent=label;return el;
  }
  function grid(id,r,yMax,box=P,xticks=6,yticks=3){
    const g=$(id);g.replaceChildren();
    for(let i=0;i<=yticks;i++){
      const y=box.bottom-(box.bottom-box.top)*i/yticks;
      g.append(makeSvg('line',{x1:box.left,x2:box.right,y1:y,y2:y,class:'grid-line'}));
      g.append(makeSvg('text',{x:box.left-10,y:y+4,'text-anchor':'end'},tick(yMax*i/yticks)));
    }
    g.append(makeSvg('path',{d:`M${box.left} ${box.top}V${box.bottom}H${box.right+6}`,class:'axis-line'}));
    for(let i=0;i<=xticks;i++){
      const x=box.left+(box.right-box.left)*i/xticks;
      g.append(makeSvg('line',{x1:x,x2:x,y1:box.bottom,y2:box.bottom+4,class:'axis-line'}));
      g.append(makeSvg('text',{x,y:box.bottom+18,'text-anchor':'middle'},tick(r[0]+(r[1]-r[0])*i/xticks)));
    }
  }
  function prepare(){
    const key=JSON.stringify([state.key,params(),state.alpha]);if(key===cacheKey)return;
    cacheKey=key;prepared=M.prepare(state.key,params(),state.alpha);
    const bodyBase=Math.max(.5,M.upperQuantile(state.key,.25,params())*2);
    const tailEnd=M.upperQuantile(state.key,state.alpha*.05,params());
    const heavy=tailEnd>bodyBase*8;
    const xMax=heavy?Math.max(state.key==='t'?4.5:2,bodyBase):Math.max(prepared.xMax,tailEnd);
    const xMin=state.key==='t'?-xMax:0;
    const values=new Set([xMin,xMax,prepared.upper,prepared.lower,...prepared.points.map(p=>p.x)]);
    for(let i=0;i<=800;i++)values.add(xMin+(xMax-xMin)*i/800);
    const points=[...values].filter(v=>v>=xMin&&v<=xMax).sort((a,b)=>a-b).map(x=>({x,y:M.pdf(state.key,x,params())}));
    const x=v=>P.left+(v-xMin)/(xMax-xMin)*PW,y=v=>P.bottom-v/prepared.yMax*PH;
    const omittedLeft=state.key==='t'?1-M.survival(state.key,xMin,params()):0;
    const omittedRight=M.survival(state.key,xMax,params());
    view={xMin,xMax,x,y,points,heavy,omittedLeft,omittedRight};
    attr($('density-curve'),'d',points.map((p,i)=>`${i?'L':'M'}${x(p.x).toFixed(3)},${y(p.y).toFixed(3)}`).join(''));
    grid('plot-grid',[xMin,xMax],prepared.yMax);
    setText('window-note',`主图 x ∈ [${tick(xMin)}, ${tick(xMax)}] · 图外概率：左 ${pct(omittedLeft)}，右 ${pct(omittedRight)}`);
  }
  function areaPath(a,b,x,y,points,baseline,boxMin,boxMax){
    a=clamp(a,boxMin,boxMax);b=clamp(b,boxMin,boxMax);if(b<=a)return'';
    const values=[{x:a,y:M.pdf(state.key,a,params())},...points.filter(p=>p.x>a&&p.x<b),{x:b,y:M.pdf(state.key,b,params())}];
    return `M${x(a)},${baseline}`+values.map(p=>`L${x(p.x)},${y(p.y)}`).join('')+`L${x(b)},${baseline}Z`;
  }
  function drawMain(f,q){
    const {x,y,xMin,xMax,points}=view,qx=x(q),visible=q>=xMin&&q<=xMax;
    const boundary=clamp(qx,P.left,P.right);
    attr($('left-area'),'d',areaPath(xMin,q,x,y,points,P.bottom,xMin,xMax));
    attr($('right-area'),'d',areaPath(q,xMax,x,y,points,P.bottom,xMin,xMax));
    $('left-area').style.opacity=.7*f.leftWeight;$('right-area').style.opacity=.7*f.rightWeight;
    const leftReach=(boundary-P.left)*f.leftReveal,rightReach=(P.right-boundary)*f.rightReveal;
    for(const [k,v]of Object.entries({x:boundary-leftReach,y:P.top,width:leftReach,height:PH}))attr($('left-clip-rect'),k,v);
    for(const [k,v]of Object.entries({x:boundary,y:P.top,width:rightReach,height:PH}))attr($('right-clip-rect'),k,v);
    for(const[k,v]of Object.entries({x1:boundary,x2:boundary,y1:P.top+10,y2:P.bottom}))attr($('quantile-line'),k,v);
    $('quantile-line').style.opacity=visible?.45+.55*f.focus:0;
    attr($('quantile-point'),'cx',boundary);attr($('quantile-point'),'cy',y(M.pdf(state.key,q,params())));
    $('quantile-point').style.opacity=visible?f.focus:0;
    const ux=x(prepared.upper);
    for(const[k,v]of Object.entries({x1:ux,x2:ux,y1:P.top+10,y2:P.bottom}))attr($('upper-reference'),k,v);
    $('upper-reference').style.opacity=f.move*.5*(prepared.upper<=xMax?1:0);
    const labelX=clamp(boundary+9,P.left+8,P.right-169);
    attr($('quantile-label-bg'),'x',labelX);attr($('quantile-label-bg'),'y',P.top+7);
    attr($('quantile-label'),'x',labelX+8);attr($('quantile-label'),'y',P.top+25);
    const label=f.move===0?'qα':f.move===1?'q(1−α)':'移动边界 q';
    setText('quantile-label',`${label} = ${fmt(q)}`);
    $('quantile-label-group').style.opacity=visible?.7+.3*f.focus:0;
    setText('offscreen-point',visible?'':`${label} = ${fmt(q)} → 局部窗口`);
    const toLeft=f.leftWeight>=f.rightWeight,tagX=toLeft?(P.left+boundary)/2:(P.right+boundary)/2;
    attr($('region-tag'),'x',clamp(tagX,P.left+65,P.right-65));attr($('region-tag'),'y',P.bottom-23);
    attr($('region-tag'),'text-anchor','middle');
    $('region-tag').style.fill=toLeft?'#926522':'#256f60';
    const room=toLeft?boundary-P.left:P.right-boundary;
    $('region-tag').style.opacity=visible&&room>80?Math.max(f.leftWeight,f.rightWeight):0;
    setText('region-tag',f.move>0&&f.move<1?'边界移动中':toLeft?(f.move===1?'左尾 α':'左侧 1−α'):(f.move===1?'右侧 1−α':'右尾 α'));
    const arrowY=P.top+75,start=clamp(ux,P.left,P.right),end=boundary;
    attr($('direction-arrow'),'d',`M${start},${arrowY}H${end}m8,-5l-8,5l8,5`);
    $('direction-arrow').style.opacity=f.move>0&&f.move<1?.65:0;
    return boundary;
  }
  function drawDetail(f,q){
    const needLeft=state.key!=='t'&&(prepared.lower-view.xMin)/(view.xMax-view.xMin)<.035;
    const detail=view.heavy||(needLeft&&f.move>.8);
    $('tail-window').hidden=!detail;
    if(!detail)return;
    $('tail-window').style.opacity=view.heavy?1:C.win(f.move,.8,1);
    const span=view.xMax-view.xMin;
    let min,max;
    if(state.key==='t'){
      const radius=Math.max(.4,Math.abs(q)*.6);
      min=q-radius;max=q+radius;
    }else if(q<span*.25){min=0;max=Math.max(q*3,1e-6);}
    else{min=q*.4;max=q*1.6;}
    const box={left:43,right:280,top:28,bottom:112};
    const samples=Array.from({length:121},(_,i)=>{const x=min+(max-min)*i/120;return{x,y:M.pdf(state.key,x,params())};});
    const yMax=Math.max(...samples.map(p=>p.y))*1.15;
    const x=v=>box.left+(v-min)/(max-min)*(box.right-box.left),y=v=>box.bottom-v/yMax*(box.bottom-box.top);
    grid('tail-grid',[min,max],yMax,box,2,1);
    attr($('tail-curve'),'d',samples.map((p,i)=>`${i?'L':'M'}${x(p.x)},${y(p.y)}`).join(''));
    // 两个区域分别用两条路径呈现，局部图不以屏幕面积比较主图。
    const left=areaPath(min,q,x,y,samples,box.bottom,min,max),right=areaPath(q,max,x,y,samples,box.bottom,min,max);
    let localLeft=$('tail-left-area');
    if(!localLeft){localLeft=makeSvg('path',{id:'tail-left-area',class:'left-area'});$('tail-area').before(localLeft);}
    attr(localLeft,'d',left);localLeft.style.opacity=.7*f.leftWeight;
    attr($('tail-area'),'d',right);$('tail-area').style.opacity=.7*f.rightWeight;
    for(const[k,v]of Object.entries({x1:x(q),x2:x(q),y1:box.top,y2:box.bottom}))attr($('tail-quantile'),k,v);
    setText('tail-label',`${f.move===0?'qα':f.move===1?'q(1−α)':'q'} = ${fmt(q)}`);
    $('tail-window').querySelector('strong').textContent=state.key!=='t'&&q<span*.25?'左尾窗口':'远尾窗口';
    const outsideLeft=1-M.survival(state.key,min,params()),outsideRight=M.survival(state.key,max,params());
    setText('tail-note',`窗外概率：左 ${pct(outsideLeft)} · 右 ${pct(outsideRight)}`);
  }
  function drawProbability(f,q,sourceX){
    const left=1-f.tailLevel,right=f.tailLevel,split=P.left+PW*left;
    attr($('mass-left'),'width',PW*left);attr($('mass-right'),'x',split);attr($('mass-right'),'width',PW*right);
    $('mass-left').style.opacity=.3+.7*f.leftWeight;$('mass-right').style.opacity=.3+.7*f.rightWeight;
    attr($('mass-marker'),'x1',split);attr($('mass-marker'),'x2',split);
    attr($('mass-connector'),'d',`M${sourceX},-8 Q${sourceX},-1 ${split},7`);
    setText('left-probability',left.toFixed(4));setText('right-probability',right.toFixed(4));
    setText('left-probability-mobile',left.toFixed(4));setText('right-probability-mobile',right.toFixed(4));
    setText('mass-point-label',f.move>0&&f.move<1?'边界移动，两侧概率同步变化':'在同一个点 q 处分开');
    $('probability-bar').setAttribute('aria-label',`当前分位点${fmt(q)}；左侧概率${left.toFixed(4)}，右侧概率${right.toFixed(4)}，总和为1。`);
  }
  function equation(f,q){
    const a=state.alpha.toFixed(4),b=(1-state.alpha).toFixed(4),v=state.key==='t'?'T':'X';
    const qa='q<sub>α</sub>',ql='q<sub>1−α</sub>';
    const formulas=[
      `P(${v} &gt; ${qa}) = α`,
      `P(${v} &gt; ${qa}) = α = <span class="result">${a}</span>`,
      `P(${v} &lt; ${qa}) = 1 − α = <span class="result">${b}</span>`,
      f.move===1?`P(${v} &lt; ${ql}) = α = <span class="result">${a}</span>`:`${qa} → ${ql} <span class="moving-value">（当前右尾 ${f.tailLevel.toFixed(4)}）</span>`,
      `P(${v} &gt; ${ql}) = 1 − α = <span class="result">${b}</span>`,
      `P(${v} &lt; ${ql}) = 1 − P(${v} &gt; ${ql}) = <span class="result">${a}</span>`
    ];
    setHtml('equation',formulas[f.captionIndex]);
    setText('equation-kicker',['定义','右尾','同点补集','换点','右侧补集','回到左尾'][f.captionIndex]);
    $('equation').style.opacity=f.captionAlpha;
    const pointName=f.move===0?'q<sub>α</sub>':f.move===1?'q<sub>1−α</sub>':'q';
    setHtml('point-symbol',pointName);setText('point-value',fmt(q));
    setText('point-kicker',f.move===0?'上分位点':f.move===1?'左侧临界点':'边界移动中');
  }
  function controls(f,q){
    setText('clock',state.t.toFixed(1).padStart(4,'0')+' s');setText('phase',f.name);setText('time-value',state.t.toFixed(1)+' s');$('progress').value=state.t;
    setText('distribution-notation',notation());setText('caption',C.captions[f.captionIndex]);$('caption').style.opacity=f.captionAlpha;
    setText('caption-index',`0${f.phase+1} / 06`);setText('region-status',f.move>0&&f.move<1?'边界正在移动':'边界固定');
    $('single-df-control').hidden=state.key==='f';$('f-df-controls').hidden=state.key!=='f';$('shape-note').hidden=state.key==='f';
    $('single-df').min=state.key==='chi'?2:1;$('single-df').value=state.key==='chi'?state.chiDf:state.tDf;
    setText('single-df-output',String($('single-df').value));
    for(const id of ['f-df1','f-df2']){const value=id==='f-df1'?state.df1:state.df2;$(id).value=value;setText(id+'-output',String(value));}
    $('alpha-level').value=String(state.alpha);$('reduced-motion').checked=state.reduced;
    document.body.dataset.motion=state.reduced?'reduced':'full';
    setText('shape-note',state.key==='t'?'关于 0 对称 · 左右临界点互为相反数':'只取非负值 · 自由度决定曲线形状');
    document.querySelectorAll('[data-distribution]').forEach(b=>attr(b,'aria-pressed',b.dataset.distribution===state.key));
    document.querySelectorAll('[data-time]').forEach((b,i)=>attr(b,'aria-current',i===f.phase?'step':'false'));
    $('previous').disabled=state.t<=0;$('next').disabled=state.t>=15;
    setText('plot-title',notation()+'的概率密度曲线');
    setText('plot-desc',`活动分位点${fmt(q)}，全域右尾概率${f.tailLevel.toFixed(4)}，左侧概率${(1-f.tailLevel).toFixed(4)}。`);
    setText('footnote',view.heavy||!$('tail-window').hidden?'示意：主图与局部窗口各用独立线性坐标，屏幕面积不直接比较；概率条按全域概率计算。q 的下标始终表示右尾概率。':'示意：曲线仅绘有限区间，概率条与数值按全域计算；q 的下标始终表示右尾概率，连续分布的单点概率为 0。');
  }
  function currentQuantile(f){return f.move===0?prepared.upper:f.move===1?prepared.lower:M.upperQuantile(state.key,f.tailLevel,params());}
  function render(){
    prepare();const f=currentFrame(),q=currentQuantile(f);
    const boundary=drawMain(f,q);drawDetail(f,q);drawProbability(f,q,boundary);equation(f,q);controls(f,q);
  }
  if(window.gsap){
    timeline=gsap.timeline({paused:true,onUpdate:()=>{state.t=timeline.time();render();saveLink();},onComplete:stop});
    timeline.to({},{duration:15,ease:'none'});timeline.time(state.t,true);
  }else{$('play').disabled=true;$('engine-notice').hidden=false;}
  $('play').addEventListener('click',play);$('reset').addEventListener('click',()=>seek(0));
  $('previous').addEventListener('click',()=>step(-1));$('next').addEventListener('click',()=>step(1));
  $('progress').addEventListener('input',e=>seek(Number(e.target.value)));
  document.querySelectorAll('[data-time]').forEach(b=>b.addEventListener('click',()=>seek(Number(b.dataset.time))));
  document.querySelectorAll('[data-distribution]').forEach(b=>b.addEventListener('click',()=>change(()=>{state.key=b.dataset.distribution;})));
  $('single-df').addEventListener('input',e=>change(()=>{if(state.key==='chi')state.chiDf=Number(e.target.value);else state.tDf=Number(e.target.value);}));
  $('f-df1').addEventListener('input',e=>change(()=>{state.df1=Number(e.target.value);}));
  $('f-df2').addEventListener('input',e=>change(()=>{state.df2=Number(e.target.value);}));
  $('alpha-level').addEventListener('change',e=>change(()=>{state.alpha=Number(e.target.value);}));
  $('speed').value=String(state.speed);
  $('speed').addEventListener('change',e=>{state.speed=Number(e.target.value);timeline?.timeScale(state.speed);if(state.playing&&state.reduced){reducedCall?.kill();reducedTick();}saveLink(true);});
  $('reduced-motion').addEventListener('change',e=>{const resume=state.playing;stop();state.reduced=e.target.checked;render();if(resume)play();saveLink(true);});
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea,button,a'))return;
    if(e.code==='Space'){e.preventDefault();play();}
    if(e.code==='ArrowLeft'){e.preventDefault();step(-1);}if(e.code==='ArrowRight'){e.preventDefault();step(1);}
    if(e.code==='Home'){e.preventDefault();seek(0);}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  const resize=new ResizeObserver(()=>{cancelAnimationFrame(frameRequest);frameRequest=requestAnimationFrame(()=>render());});resize.observe($('distribution-plot'));
  window.addEventListener('pagehide',()=>{stop();resize.disconnect();cancelAnimationFrame(frameRequest);clearTimeout(linkTimer);timeline?.kill();},{once:true});
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
  render();
})();
