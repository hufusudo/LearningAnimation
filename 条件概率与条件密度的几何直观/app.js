(() =>  {
  'use strict'; const $=id=>document.getElementById(id), M=window.ConditionalModel,C=window.ConditionalChoreo; const clamp=(n,a,b)=>Math.min(b,Math.max(a,n)); const defaults= {
    normal:[.5,-.5,1],triangle:[.6,.8,1.8],ramp:[.8,.4,1.6]
  }
  ; const names= {
    normal:'标准二维正态 · ρ 可调',triangle:'0 ≤ y ≤ x ≤ 2 · f = 1/2',ramp:'[0, 2]² · f = (x + y)/8'
  }
  ; const params=new URLSearchParams(location.hash.slice(1)); const num=(k,d,a,b)=>params.has(k)&&Number.isFinite(Number(params.get(k)))?clamp(Number(params.get(k)),a,b):d; const state= {
    model:['normal','triangle','ramp'].includes(params.get('m'))?params.get('m'):'normal',dir:params.get('d')==='x'?'x':'y',t:num('t',0,0,4),c:.5,r:num('r',.5,-.85,.85),a:-.5,b:1,delta:num('w',0,0,.5),yaw:-.62,pitch:.55,playing:false,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  ; const normal=()=>state.model==='normal'; let timeline=null,delay=null,hashAt=0; const setText=(el,v)=> {
    if(el.textContent!==v)el.textContent=v;
  }
  ; const fmt=n=>Number.isFinite(n)?n.toFixed(3):'—'; function writeHash(force=false) {
    if(!force&&performance.now()-hashAt<300)return;hashAt=performance.now();try {
      history.replaceState(null,'','#'+new URLSearchParams( {
        m:state.model,d:state.dir,t:state.t.toFixed(3),c:state.c,r:state.r,a:state.a,b:state.b,w:state.delta
      }
      ));
    }
    catch {
    }
  }
  function configure(read=false) {
    const def=defaults[state.model],lo=normal()?-4:0,hi=normal()?4:2;state.c=read?num('c',def[0],normal()?-2.4:0,normal()?2.4:2):def[0];state.a=read?num('a',def[1],lo,hi):def[1];state.b=read?num('b',def[2],lo,hi):def[2];if(state.a>state.b)[state.a,state.b]=[state.b,state.a];$('slice').min=normal()?-2.4:0;$('slice').max=normal()?2.4:2;for(const id of ['a','b']) {
      $(id).min=lo;$(id).max=hi;
    }
    syncInputs();
  }
  function syncInputs() {
    for(const [id,key] of [['slice','c'],['rho','r'],['a','a'],['b','b'],['delta','delta']])$(id).value=state[key];$('direction').value=state.dir;$('reduced').checked=state.reduced;$('rho-control').hidden=!normal();document.querySelectorAll('[data-model]').forEach(el=> {
      const active=el.dataset.model===state.model;el.classList.toggle('active',active);el.setAttribute('aria-pressed',active);
    }
    );
  }
  const pt=p=>p.map(v=>v.toFixed(2)).join(','); const path=points=>points.map((p,i)=>(i?'L':'M')+pt(p)).join(' '); const poly=(points,attrs)=>`<polygon points="${points.map(pt).join(' ')}" ${attrs}/>`; function drawJoint(s,slice) {
    const extent=normal()?4:2,center=normal()?0:1,scale=normal()?39:123,zscale=normal()?440:125;  const project=(x,y,z=0)=> {
      x=(x-center)*scale;y=(y-center)*scale;const xx=x*Math.cos(state.yaw)-y*Math.sin(state.yaw),yy=x*Math.sin(state.yaw)+y*Math.cos(state.yaw);return [283+xx,248+yy*Math.sin(state.pitch)-z*zscale*Math.cos(state.pitch)];
    }
    ;  const lo=normal()?-extent:0,hi=extent;  let html='';const line=(points,stroke,width=1,extra='')=>`<path d="${path(points)}" fill="none" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;  for(let i=0;i<=8;i++) {
      const v=lo+(hi-lo)*i/8;html+=line([project(v,lo),project(v,hi)],'#dce2d9',.65)+line([project(lo,v),project(hi,v)],'#dce2d9',.65);
    }
    const axis=(a,b,text)=>line([project(...a),project(...b)],'#929c92',1.1)+`<text x="${project(...b)[0]+7}" y="${project(...b)[1]+8}" class="math">${text}</text>`;  html+=axis([lo,lo,0],[hi+.3,lo,0],'x')+axis([lo,lo,0],[lo,hi+.3,0],'y')+axis([lo,lo,0],[lo,lo,normal()?.6:1.15],'f');  if($('surface').checked) {
      const faces=[],n=25;for(let i=0;i<n;i++)for(let j=0;j<n;j++) {
        const x=lo+(hi-lo)*i/n,y=lo+(hi-lo)*j/n,dx=(hi-lo)/n,dy=dx;const corners=state.model==='triangle'?null:[[x,y],[x+dx,y],[x+dx,y+dy],[x,y+dy]];if(!corners) {
          if(y>x)continue;const pts=y===x?[[x,y],[x+dx,y],[x+dx,y+dy]]:[[x,y],[x+dx,y],[x+dx,y+dy],[x,y+dy]];faces.push( {
            depth:((x-center)*Math.sin(state.yaw)+(y-center)*Math.cos(state.yaw)),pts:pts.map(([a,b])=>project(a,b,.5)),z:.5
          }
          );
        }
        else {
          const zs=corners.map(([a,b])=>M.joint(state.model,a,b,state.r));faces.push( {
            depth:(x-center)*Math.sin(state.yaw)+(y-center)*Math.cos(state.yaw),pts:corners.map(([a,b],k)=>project(a,b,zs[k])),z:zs.reduce((a,b)=>a+b)/4
          }
          );
        }
      }
      faces.sort((a,b)=>a.depth-b.depth);for(const f of faces) {
        const alpha=.2+Math.min(.55,f.z*(normal()?2:.6));html+=poly(f.pts,`fill="rgba(92,130,122,${alpha})" stroke="#5f827a" stroke-opacity=".19" stroke-width=".5"`);
      }
    }
    const coord=(u,c,z)=>state.dir==='y'?project(u,c,z):project(c,u,z);  if(state.delta>0) {
      const half=state.delta/2;html+=poly([coord(lo,state.c-half,0),coord(hi,state.c-half,0),coord(hi,state.c+half,0),coord(lo,state.c+half,0)],'fill="#9a6b21" fill-opacity=".15" stroke="#9a6b21" stroke-dasharray="4 4"');
    }
    if(state.delta>0) {
      const sides=[];   for(const c of [state.c-state.delta/2,state.c+state.delta/2]) {
        const slabSlice=M.slice(state.model,c,state.dir,state.r);     if(!slabSlice.valid)continue;     const pts=Array.from( {
          length:61
        }
        ,(_,i)=> {
          const u=slabSlice.lo+(slabSlice.hi-slabSlice.lo)*i/60;return coord(u,c,slabSlice.raw(u));
        }
        );     html+=poly([coord(slabSlice.lo,c,0),...pts,coord(slabSlice.hi,c,0)],'fill="#b68738" fill-opacity=".16" stroke="#9a6b21" stroke-opacity=".35"');     sides.push(pts);
      }
      if(sides.length===2)for(let i=0;i<60;i++)html+=poly([sides[0][i],sides[0][i+1],sides[1][i+1],sides[1][i]],'fill="#b68738" fill-opacity=".13"');
    }
    const height=normal()?.55:1.05;  html+=poly([coord(lo,state.c,0),coord(hi,state.c,0),coord(hi,state.c,height),coord(lo,state.c,height)],`fill="#2563a6" fill-opacity="${.065*s.cut}" stroke="#2563a6" stroke-opacity="${s.focus*.55}" stroke-dasharray="5 5"`);  if(slice.valid) {
      const pts=[];for(let i=0;i<=120;i++) {
        const u=slice.lo+(slice.hi-slice.lo)*i/120;pts.push(coord(u,state.c,slice.raw(u)));
      }
      html+=poly([coord(slice.lo,state.c,0),...pts,coord(slice.hi,state.c,0)],`fill="#d6ab5a" fill-opacity="${.7*s.cut}" stroke="#9a6b21" stroke-opacity="${s.cut}" stroke-width="2"`);
    }
    if($('regression').checked) {
      const pts=[];for(let i=0;i<=80;i++) {
        const c=(normal()?-2.4:0)+(normal()?4.8:2)*i/80,cs=M.slice(state.model,c,state.dir,state.r);if(cs.valid)pts.push(coord(cs.mean,c,0));
      }
      html+=line(pts,'#9b5364',2,'stroke-dasharray="5 3"');
    }
    const label=coord(hi,state.c,0);html+=`<text x="${label[0]-10}" y="${label[1]+24}" text-anchor="middle" fill="#2563a6">${state.dir==='y'?'y':'x'}₀ = ${state.c.toFixed(2)}</text>`;  html+=`<g opacity="${s.receipt[0]}"><rect x="18" y="21" width="86" height="25" rx="4" fill="#edf3f7"/><text x="61" y="38" text-anchor="middle">固定条件</text></g>`;  $('scene').innerHTML=html;
  }
  function drawChart(s,sl) {
    const xmin=normal()?-4:0,xmax=normal()?4:2,x=u=>48+(u-xmin)/(xmax-xmin)*420;  const ymax=Math.max(normal()?.9:.8,sl.valid?Math.max(sl.pdf(sl.mean),sl.pdf(sl.lo),sl.pdf(sl.hi))*1.2:.8),y=v=>313-v/ymax*230;  let h='';for(let i=0;i<=4;i++) {
      const val=ymax*i/4;h+=`<path d="M48 ${y(val)}H468" stroke="#e8ebe4"/><text x="39" y="${y(val)+4}" text-anchor="end" class="number">${val.toFixed(2)}</text>`;
    }
    h+=`<path d="M48 73V313H468" fill="none" stroke="#8c968b"/>`;  for(let i=0;i<=4;i++) {
      const val=xmin+(xmax-xmin)*i/4;h+=`<text x="${x(val)}" y="335" text-anchor="middle" class="number">${val.toFixed(1)}</text>`;
    }
    h+=`<text x="488" y="335" class="math">${state.dir==='y'?'x':'y'}</text>`;  if(sl.valid) {
      const points=(fn,l=sl.lo,r=sl.hi)=>Array.from( {
        length:181
      }
      ,(_,i)=> {
        const u=l+(r-l)*i/180;return [x(u),y(fn(u))];
      }
      );  const display=u=>sl.raw(u)*(1+s.normalize*(1/sl.area-1));  const raw=points(sl.raw),current=points(display),a=Math.max(state.a,sl.lo),b=Math.min(state.b,sl.hi);  h+=`<g opacity="${s.extract}">`;  h+=`<path d="${path(raw)}" fill="none" stroke="#9a6b21" stroke-width="2" stroke-dasharray="5 4"/>`;  h+=poly([[x(sl.lo),313],...current,[x(sl.hi),313]],'fill="#2563a6" fill-opacity=".07"');  if(b>a) {
        const end=a+(b-a)*s.interval;h+=poly([[x(a),313],...points(display,a,end),[x(end),313]],'fill="#26765a" fill-opacity=".3"');
      }
      h+=`<path d="${path(current)}" fill="none" stroke="#2563a6" stroke-width="2.5"/>`;  for(const [v,label] of [[state.a,'a'],[state.b,'b']])h+=`<g opacity="${s.interval}"><path d="M${x(v)} 313V${y(display(v))}" stroke="#26765a" stroke-dasharray="3 3"/><text x="${x(v)}" y="357" text-anchor="middle" class="math">${label}</text></g>`;  h+=`</g><g opacity="${s.receipt[1]*(1-s.normalize)}"><text x="260" y="38" text-anchor="middle" fill="#9a6b21">曲线下积分 = ${fmt(sl.area)}</text></g><g opacity="${s.receipt[2]}"><text x="260" y="38" text-anchor="middle" fill="#2563a6">归一化后总面积 = 1</text></g>`;  if($('regression').checked)h+=`<g opacity="${s.extract}"><path d="M${x(sl.mean)} 313V83" stroke="#9b5364" stroke-dasharray="4 4"/><text x="${x(sl.mean)}" y="375" text-anchor="middle">均值 ${sl.mean.toFixed(2)}</text></g>`;
    }
    else h+=`<text x="250" y="185" text-anchor="middle">边缘密度为 0，条件密度未定义</text>`;  // 连线先行，再显露截面；位置和显隐只依赖当前时刻。
    h+=`<path d="M4 185H40" stroke="#9a6b21" stroke-width="1.5" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1-clamp((state.t-1)/.2,0,1)}" opacity="${1-s.normalize}"/>`;  $('chart').innerHTML=h;
  }
  function render() {
    const s=C.sample(state.t),sl=M.slice(state.model,state.c,state.dir,state.r),given=state.dir==='y'?'Y':'X',target=state.dir==='y'?'X':'Y';  drawJoint(s,sl);drawChart(s,sl);  setText($('clock'),`t = ${state.t.toFixed(2)}`);setText($('phase'),['圈定切片','抽出截面','归一化','区间概率'][state.reduced?s.phase:s.textPhase]);setText($('model-caption'),names[state.model]);  $('curve-title').innerHTML=s.normalize>0?`归一化截面 <span>f<sub>${target}|${given}</sub></span>`:`截面轮廓 <span>f(${state.dir==='y'?'x, y₀':'x₀, y'})</span>`;  $('factor').previousElementSibling.innerHTML=`f<sub>${target}|${given}</sub> = f / f<sub>${given}</sub> · 高度倍率`;  $('area-label').innerHTML=`截面总面积 · f<sub>${given}</sub>(${given.toLowerCase()}₀)`;  setText($('area'),s.receipt[1]>0?fmt(sl.area):'待抽出');$('area').style.opacity=s.receipt[1]>.0?.3+.7*s.receipt[1]:1;  setText($('factor'),s.normalize>0&&sl.valid?`${(1+s.normalize*(1/sl.area-1)).toFixed(2)}×`:sl.valid?'待归一化':'未定义');  setText($('probability'),s.receipt[3]>0&&sl.valid?fmt(sl.probability(state.a,state.b)):!sl.valid?'未定义':'待积分');$('probability').style.opacity=s.receipt[3]>0?.3+.7*s.receipt[3]:1;  const stories=[`固定 ${given} = ${state.c.toFixed(2)}，先找到曲面上的对应截面。`,'抽出同一条截面，它的总积分就是边缘密度。','每一处高度除以截面总积分，使总面积变为 1。','归一化后，[a, b] 下方的面积就是条件概率。'];  setText($('narration'),sl.valid?stories[state.reduced?s.phase:s.textPhase]:'此处边缘密度为 0，不能相除；请移动条件位置。');  const textAlpha=s.textAlpha;  for(const id of ['phase','narration'])$(id).style.opacity=state.reduced?1:textAlpha;  $('slice-label').firstChild.textContent=`条件位置 ${given.toLowerCase()}₀ `;  for(const [id,key] of [['slice','c'],['rho','r'],['a','a'],['b','b'],['delta','delta']])setText($(id+'-value'),state[key].toFixed(2));  setText($('delta-symbol'),'Δ'+given.toLowerCase());  const slab=M.slab(state.model,state.c,state.dir,state.r,state.a,state.b,state.delta);  setText($('slab-result'),slab?`中心薄板 [${(state.c-state.delta/2).toFixed(2)}, ${(state.c+state.delta/2).toFixed(2)}]：概率质量 ${fmt(slab.mass)}；有限厚度体积比 ${fmt(slab.probability)} → 截面极限 ${sl.valid?fmt(sl.probability(state.a,state.b)):'未定义'}。`:'拖动薄板厚度，比较有限厚度体积比与截面极限。');  setText($('mean-result'),sl.valid?`E[${target} | ${given} = ${state.c.toFixed(2)}] = ${fmt(sl.mean)}；虚线轨迹标记各条件位置的均值。`:'边缘密度为零，条件均值不由密度比定义。');  setText($('footnote'),normal()?'示意：三维高度按固定比例放大；正态图截取 [−4, 4]，概率计算保留完整分布。':'示意：三维高度按固定比例放大；截面“面积”指曲线下的积分，图中面积以坐标刻度为准。');  $('progress').value=state.t;$('prev').disabled=state.t<=0;$('next').disabled=state.t>=4;  document.querySelectorAll('[data-time]').forEach(el=> {
      const active=Number(el.dataset.time)-1===Math.max(0,Math.ceil(state.t)-1);el.classList.toggle('active',active);el.setAttribute('aria-current',active?'step':'false');
    }
    );  document.body.dataset.reduced=state.reduced;
  }
  function stop() {
    state.playing=false;timeline?.pause();delay?.kill();delay=null;setText($('play'),'播放演示');$('lamp').classList.remove('running');writeHash(true);
  }
  function seek(t) {
    stop();state.t=clamp(t,0,4);timeline?.time(state.t);render();writeHash(true);
  }
  function reducedTick() {
    if(!state.playing)return;state.t=Math.min(4,Math.floor(state.t+1e-6)+1);render();if(state.t>=4) {
      stop();return;
    }
    delay=gsap.delayedCall(.9/Number($('speed').value),reducedTick);
  }
  function play() {
    if(state.playing) {
      stop();return;
    }
    if(!window.gsap)return;if(state.t>=4)seek(0);state.playing=true;setText($('play'),'暂停');$('lamp').classList.add('running');if(state.reduced)delay=gsap.delayedCall(.9/Number($('speed').value),reducedTick);else timeline.time(state.t).timeScale(Number($('speed').value)).play();
  }
  configure(true);render(); if(window.gsap) {
    timeline=gsap.timeline( {
      paused:true,onUpdate() {
        state.t=timeline.time();render();writeHash();
      }
      ,onComplete:stop
    }
    );timeline.to( {
    }
    ,  {
      duration:4,ease:'none'
    }
    );timeline.time(state.t);
  }
  else {
    $('engine-notice').hidden=false;$('play').disabled=true;
  }
  $('play').onclick=play;$('reset').onclick=()=>seek(0);$('prev').onclick=()=>seek(Math.max(0,Math.ceil(state.t-1e-6)-1));$('next').onclick=()=>seek(Math.floor(state.t+1e-6)+1); $('progress').oninput=e=>seek(Number(e.target.value));document.querySelectorAll('[data-time]').forEach(el=>el.onclick=()=>seek(Number(el.dataset.time))); document.querySelectorAll('[data-model]').forEach(el=>el.onclick=()=> {
    stop();state.model=el.dataset.model;configure();render();writeHash(true);
  }
  ); $('direction').onchange=e=> {
    stop();state.dir=e.target.value;render();writeHash(true);
  }
  ; for(const [id,key] of [['slice','c'],['rho','r'],['a','a'],['b','b'],['delta','delta']])$(id).oninput=e=> {
    stop();state[key]=Number(e.target.value);if(state.a>state.b) {
      if(id==='a')state.b=state.a;else state.a=state.b;syncInputs();
    }
    render();writeHash(true);
  }
  ; $('reduced').onchange=e=> {
    const was=state.playing;stop();state.reduced=e.target.checked;render();if(was)play();
  }
  ;$('speed').onchange=()=> {
    timeline?.timeScale(Number($('speed').value));if(state.playing&&state.reduced) {
      delay?.kill();delay=gsap.delayedCall(.9/Number($('speed').value),reducedTick);
    }
  }
  ; for(const id of ['surface','regression'])$(id).onchange=render; function camera(yaw=-.62,pitch=.55) {
    state.yaw=yaw;state.pitch=pitch;render();
  }
  $('camera').onclick=()=>camera();$('joint').ondblclick=()=>camera();$('front').onclick=()=>camera(state.dir==='y'?0:-Math.PI/2,0);$('top').onclick=()=>camera(0,1.5); let drag=null;$('joint').onpointerdown=e=> {
    drag= {
      x:e.clientX,y:e.clientY,yaw:state.yaw,pitch:state.pitch
    }
    ;$('joint').setPointerCapture(e.pointerId);
  }
  ;$('joint').onpointermove=e=> {
    if(!drag)return;state.yaw=drag.yaw+(e.clientX-drag.x)*.007;state.pitch=clamp(drag.pitch+(e.clientY-drag.y)*.005,.05,1.5);drawJoint(C.sample(state.t),M.slice(state.model,state.c,state.dir,state.r));
  }
  ;$('joint').onpointerup=$('joint').onpointercancel=()=>drag=null; document.addEventListener('visibilitychange',()=> {
    if(document.hidden)stop();
  }
  ); document.addEventListener('keydown',e=> {
    if(e.target.closest('input,select,textarea,button,a,summary')||e.ctrlKey||e.altKey||e.metaKey)return;if(e.code==='Space') {
      e.preventDefault();play();
    }
    if(e.code==='ArrowRight') {
      e.preventDefault();$('next').click();
    }
    if(e.code==='ArrowLeft') {
      e.preventDefault();$('prev').click();
    }
    if(e.code==='Home') {
      e.preventDefault();seek(0);
    }
  }
  );
}
)();
