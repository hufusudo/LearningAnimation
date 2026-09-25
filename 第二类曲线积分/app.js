(function () {
  'use strict';
  const M=window.LineIntegralModel, NS='http://www.w3.org/2000/svg';
  const $=id=>document.getElementById(id), reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C={ink:'#365b4c',orange:'#d97706',blue:'#2563eb',green:'#059669',red:'#b7473b',gray:'#b7c0b0'};
  const sizes=[4,8,16,32,64];
  const S={stage:1,angle:45,n:8,field:'mixed',selected:2,travel:0,focus:'all',speed:1,mode:null,clock:0,finished:false,motion:null};
  let segments=[], asideScene=null, lastTime=0, dragging=false, shownFormulaKey='';
  const sum=a=>a.reduce((s,d)=>s+d.work,0);
  const fmt=(x,d=3)=>Math.abs(x)<.5*Math.pow(10,-d)?(0).toFixed(d):(x<0?'−':'')+Math.abs(x).toFixed(d);
  const signed=(x,d=3)=>(x>.5*Math.pow(10,-d)?'+':'')+fmt(x,d);
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const stageNames=['一步的功','弯路切小','两个方向','沿路相加','反向再走'];
  const story=[
    ['先理解“功”','同样大小的力，换个方向，功就变了。','把橙色力箭头拖一拖。看它落在前进方向上的“影子”，这一部分才计入功。','把一个物体向右移动 1 m','拖橙色圆点，或用下方滑块'],
    ['把整条路变成许多小步','弯路切得足够小，就能一小步一小步算。','点击曲线上的一段，在右侧放大它。增加段数，观察弧线怎样越来越贴近直线。','每一小段，都用中点的力近似','点击一段 ↔ 右侧放大同一段'],
    ['点积为什么展开成两项','横着贡献一份，竖着贡献一份，再相加。','蓝色只配蓝色，绿色只配绿色。点击右侧算式，看对应的力和位移投影。','同一小步的位移和力，分别作正交分解','蓝色：x 分量　绿色：y 分量'],
    ['把每一小步的功收起来','每段对应一根功柱；有正有负，带着符号相加。','点击播放，看曲线上的小段与下方功柱逐一对应。观察红色功柱怎样扣回总功，也可以切换力场作比较。','走过一段，就把这一段的功加进来','绿色正功，红色负功；同一段 ↔ 同一柱'],
    ['同一条路，换一个方向','力场没变，位移掉头，所以每一份功都变号。','右侧比较的是同一小段、同一处的力。播放 B → A：反向总功等于原总功的相反数。','沿同一路径，从 B 返回 A','长度仍为正；改变的是位移方向']
  ];

  // Reuse keyed SVG elements during motion, so dragging does not rebuild the scene.
  class Drawing {
    constructor(root){this.root=root;this.nodes=new Map();this.used=new Set();}
    begin(){this.used.clear();}
    node(key,tag,attrs={},text){
      let el=this.nodes.get(key);
      if(!el){el=document.createElementNS(NS,tag);this.root.appendChild(el);this.nodes.set(key,el);}
      this.used.add(key);el.removeAttribute('display');
      Object.entries(attrs).forEach(([k,v])=>{if(el.getAttribute(k)!==String(v))el.setAttribute(k,String(v));});
      if(text!==undefined&&el.textContent!==String(text))el.textContent=String(text);
      return el;
    }
    text(key,x,y,text,cls='',anchor='start'){return this.node(key,'text',{x,y,class:cls,'text-anchor':anchor},text);}
    line(key,a,b,color,width=2,extra={}){return this.node(key,'line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:color,'stroke-width':width,'stroke-linecap':'round',...extra});}
    arrow(key,a,b,color,width=3,extra={}){
      this.line(key,a,b,color,width,extra);
      const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),ux=l?dx/l:1,uy=l?dy/l:0,h=Math.min(12,l*.35);
      const points=[[b.x,b.y],[b.x-h*ux-h*.42*uy,b.y-h*uy+h*.42*ux],[b.x-h*ux+h*.42*uy,b.y-h*uy-h*.42*ux]];
      this.node(key+'-head','polygon',{points:points.map(p=>p.join(',')).join(' '),fill:color,opacity:extra.opacity??1});
    }
    end(){this.nodes.forEach((el,k)=>{if(!this.used.has(k))el.setAttribute('display','none');});}
  }
  const scene=new Drawing($('scene'));
  function rebuild(){segments=M.partition(S.n,S.field,S.stage===5);S.selected=clamp(S.selected,0,S.n-1);}
  function current(){return segments[S.selected];}
  function value(id,text){const el=$(id);if(el&&el.textContent!==String(text))el.textContent=String(text);}
  function stop(){S.mode=null;S.motion=null;if(window.gsap)window.gsap.killTweensOf(S);updateButtons();}
  function updateButtons(){
    $('play').textContent=S.mode?'暂停':S.stage===2?'自动切细':S.stage===3?'依次看两个分量':S.stage===5?'播放 B → A':'播放这一幕';
    $('guide').textContent=S.mode==='guide'?'停止讲解':'自动讲一遍';
    $('previous').disabled=S.stage===1;$('next').disabled=S.stage===5;
    $('next').textContent=S.stage===5?'已经看完五步':'下一步：'+stageNames[S.stage]+' →';
    $('advance').hidden=S.stage===1;$('advance').textContent=S.stage<4?'换一小段':'只走一小段';
  }
  function showFormula(){
    const formulas=[
      ['这一小步','W=\\underbrace{|\\vec F|\\cos\\theta}_{\\text{沿位移的有向分力}}\\;\\Delta s','功 = 沿前进方向的有向分力 × 位移长度','cos θ 可以为负；力垂直于位移时，投影为 0。'],
      ['弧段近似','\\Delta W_i\\approx\\vec F(M_i)\\cdot\\Delta\\vec r_i','每段的功 ≈ 中点的力 · 这段的位移','取中点的力近似这一小段的变力；切得越细，局部直线近似越准确。'],
      ['同轴相乘','\\Delta W_i\\approx\\color{#2563eb}{P(M_i)\\,\\Delta x_i}+\\color{#059669}{Q(M_i)\\,\\Delta y_i}','这一小段的功 ≈ P Δx + Q Δy','x、y 方向互相垂直，交叉项为 0。切细后写成 dW = P dx + Q dy。'],
      ['从和到积分','\\underbrace{\\sum_i \\vec F(M_i)\\cdot\\Delta\\vec r_i}_{\\text{许多小段的功}}\\;\\xrightarrow{\\max\\Delta s_i\\to0}\\;\\int_L\\vec F\\cdot d\\vec r','各小段的功之和 → 切得无限细 → ∫L F · dr','积分号把“沿曲线逐段相加，并取极限”记成了一个符号。'],
      ['方向性','\\int_{L^-}(P\\,dx+Q\\,dy)=-\\int_L(P\\,dx+Q\\,dy)','∫L⁻ (P dx + Q dy) = − ∫L (P dx + Q dy)','同一个位置，P、Q 不变；dx、dy 同时反号，ds = |dr| 仍为正。']
    ][S.stage-1];
    shownFormulaKey=S.stage+':'+S.focus;
    let tex=formulas[1];
    if(S.stage===3&&S.focus==='x')tex=tex.replace('#059669','#b9c2b2');
    if(S.stage===3&&S.focus==='y')tex=tex.replace('#2563eb','#b9c2b2');
    value('formula-label',formulas[0]);
    if(window.katex)window.katex.render(tex,$('formula'),{throwOnError:false,strict:'ignore'});
    else value('formula',formulas[2]);
    value('formula-note',S.stage===3&&S.focus!=='all'?(S.focus==='x'?'先看蓝色：水平分力 P × 水平位移 Δx，得到水平方向的功。':'再看绿色：竖直分力 Q × 竖直位移 Δy，得到竖直方向的功。'):formulas[3]);
  }
  function buildAside(){
    const titles=[['只看顺着路的那部分力','箭头的影子，决定功的正负'],['同一小段的放大镜','弧段越短，越像直线'],['两种算法得到同一个功','把同颜色的两个量相乘'],['一根柱，就是一段的功','绿色加进来，红色扣回去'],['固定同一段，成对比较','F 不变，Δr 完全反号']][S.stage-1];
    value('insight-kicker',titles[0]);value('insight-title',titles[1]);
    const templates=[
      '<dl class="measure-list"><div><dt>力的大小</dt><dd>2.00 N</dd></div><div><dt>夹角 θ</dt><dd id="theta-number"></dd></div><div><dt>沿位移分力</dt><dd id="parallel-number"></dd></div><div><dt>位移长度</dt><dd>1.00 m</dd></div></dl><div id="one-result" class="work-result"><span>这一小步做的功</span><strong id="one-work"></strong></div><p id="sign-note" class="meaning"></p><div id="one-equation" class="number-equation"></div><p class="math-fine">这里先固定一段直路。下一步，再让这“一小步”沿着曲线发生。</p>',
      '<svg id="side-scene" class="side-svg" viewBox="0 0 380 235" role="img" aria-label="选中弧段及其位移弦的放大比较"></svg><dl class="measure-list"><div><dt>选中曲线小段</dt><dd id="segment-number"></dd></div><div><dt>弧长 Δs</dt><dd id="arc-length"></dd></div><div><dt>端点位移长度 |Δr|</dt><dd id="chord-length"></dd></div><div><dt>弧线最大偏离 / 弦长</dt><dd id="bend-error"></dd></div></dl><p class="meaning">这一段就回到了第一幕：取中点的力，向这一小步的方向投影，再乘位移长度。</p><div id="local-projection-equation" class="number-equation"></div>',
      '<button class="term blue" data-channel="x"><span>水平方向：P × Δx</span><strong id="x-equation"></strong></button><button class="term green" data-channel="y"><span>竖直方向：Q × Δy</span><strong id="y-equation"></strong></button><div class="side-actions"><button id="show-both">合起来看</button></div><div class="work-result"><span>两份贡献相加 ≈ 这一小段的功</span><strong id="coordinate-work"></strong></div><p class="meaning">质点沿橙色斜线移动。蓝、绿直角边只是它的投影，质点并没有先横走、再竖走。</p><p id="signed-components"></p>',
      '<div id="sum-result" class="work-result"><span id="collected"></span><strong id="sum-work"></strong></div><div class="sum-ledger"><div><span>已累加的正功</span><strong id="positive-work" class="green"></strong></div><div><span>已累加的负功</span><strong id="negative-work" class="red"></strong></div></div><p id="current-work" class="number-equation"></p><div class="reference"><div><span>全部小段的近似和</span><b id="approx-work"></b></div><div><span>精确积分值</span><b id="exact-work"></b></div><div><span>近似误差</span><b id="approx-error"></b></div></div><p class="meaning">柱宽是这段的位移长度，柱高是沿位移的分力。有向面积就是这段近似功。</p><p class="math-fine">本例的总功先增加、后减少。增加段数，看近似和接近积分值；切换力场，再作比较。</p>',
      '<svg id="side-scene" class="side-svg pair" viewBox="0 0 380 280" role="img" aria-label="同一小段的正向与反向位移比较，力保持不变"></svg><p id="pair-length" class="math-fine"></p><div class="pair-values"><div>正向这一步<strong id="forward-micro"></strong><span id="forward-components"></span></div><div>反向这一步<strong id="reverse-micro"></strong><span id="reverse-components"></span></div></div><div class="reference"><div><span>正向完整近似和</span><b id="forward-total"></b></div><div><span>反向完整近似和</span><b id="reverse-total"></b></div><div><span>现在从 B 累加到这里</span><b id="reverse-current"></b></div></div><p class="meaning">将同一小段的位移反过来，长度不变，两个坐标分量同时取负；力箭头仍保持原方向。</p>'
    ];
    $('insight').innerHTML=templates[S.stage-1];
    asideScene=$('side-scene')?new Drawing($('side-scene')):null;
  }
  function enterStage(stage,guide=false){
    const previousMid=S.stage===1?.3:current()?(current().a+current().b)/2:.3;
    stop();S.stage=clamp(stage,1,5);S.clock=0;S.finished=false;S.focus='all';S.travel=0;
    if(S.stage===2&&guide)S.n=4;
    S.selected=Math.min(S.n-1,Math.floor(S.n*previousMid));rebuild();
    if(S.stage>=4)S.selected=0;
    $('lesson').dataset.stage=String(S.stage);
    document.querySelectorAll('[data-stage]').forEach(el=>{if(el.tagName==='BUTTON'){if(Number(el.dataset.stage)===S.stage)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');}});
    const copy=story[S.stage-1];['chapter','headline','explanation','scene-title','scene-hint'].forEach((id,i)=>value(id,copy[i]));
    $('scene').setAttribute('aria-label',copy[1]+' '+copy[2]);
    $('angle-controls').hidden=S.stage!==1;$('curve-controls').hidden=S.stage===1;
    $('partition-label').hidden=S.stage===3;
    buildAside();showFormula();render();updateButtons();
    if(window.gsap&&!reduced)window.gsap.fromTo('.workspace',{opacity:.35,y:4},{opacity:1,y:0,duration:.3/S.speed,ease:'power2.out'});
    if(guide){S.mode='guide';updateButtons();}
  }

  function drawProjection(){
    const d=scene;d.begin();
    const origin={x:335,y:263},r=167,rad=S.angle*Math.PI/180;
    const tip={x:origin.x+r*Math.cos(rad),y:origin.y-r*Math.sin(rad)},foot={x:tip.x,y:origin.y};
    const parallel=2*Math.cos(rad),tone=Math.abs(parallel)<1e-8?'#7d8878':parallel>0?C.green:C.red;
    d.line('intro-axis',{x:100,y:origin.y},{x:680,y:origin.y},'#e0e6da',2);
    d.node('intro-floor','rect',{x:180,y:380,width:455,height:14,rx:3,fill:'#f0f2eb'});
    d.arrow('intro-move',{x:180,y:350},{x:635,y:350},C.ink,4);
    d.text('intro-move-label',410,373,'位移：向右走 1 m','label','middle');
    d.line('intro-shadow-drop',tip,foot,'#a9b5a0',2,{'stroke-dasharray':'6 6'});
    d.arrow('intro-shadow',origin,foot,tone,8);
    d.arrow('intro-force',origin,tip,C.orange,5);
    d.node('intro-origin','circle',{cx:origin.x,cy:origin.y,r:10,fill:'#fff',stroke:C.ink,'stroke-width':3});
    d.node('intro-handle','circle',{cx:tip.x,cy:tip.y,r:13,fill:'#fff4d9',stroke:C.orange,'stroke-width':3,'data-force':'true'});
    d.node('intro-hit','circle',{cx:tip.x,cy:tip.y,r:23,fill:'transparent','data-force':'true'});
    d.text('intro-force-label',tip.x,tip.y-24,'力 F = 2 N','label orange','middle');
    d.text('intro-shadow-label',(origin.x+foot.x)/2,origin.y+29,Math.abs(parallel)<1e-8?'投影为 0':'沿位移分力 '+signed(parallel,2)+' N','label '+(Math.abs(parallel)<1e-8?'':parallel<0?'red':'green'),'middle');
    if(S.angle>4){
      const a={x:origin.x+40*Math.cos(rad),y:origin.y-40*Math.sin(rad)};
      d.node('intro-angle','path',{d:'M375 263 A40 40 0 0 0 '+a.x+' '+a.y,fill:'none',stroke:'#8a9581','stroke-width':1.7});
      d.text('intro-angle-text',origin.x+67*Math.cos(rad/2),origin.y-67*Math.sin(rad/2),Math.round(S.angle)+'°','small','middle');
    }
    if(S.angle>12&&S.angle<168){
      d.text('intro-normal-label',Math.max(tip.x,origin.x)+65,167,'垂直于位移的部分','small');
      d.text('intro-normal-label2',Math.max(tip.x,origin.x)+65,188,'不计入这一步的功','small');
    }
    d.text('intro-instruction',390,437,'拖动力箭头，让它与位移垂直，再试试反着拉。','small','middle');
    d.end();
    const zero=Math.abs(parallel)<1e-8;
    value('theta-number',Math.round(S.angle)+'°');value('parallel-number',signed(parallel,2)+' N');value('one-work',signed(parallel,2)+' J');
    $('one-result').className='work-result '+(zero?'zero':parallel<0?'negative':'');
    $('sign-note').className='meaning '+(zero?'zero':parallel<0?'negative':'');
    value('sign-note',zero?'垂直拉：沿路投影为零，这一步做功为零。':parallel>0?'顺着拉：投影指向前方，力对这一步做正功。':'逆着拉：投影指向后方，力对这一步做负功。');
    value('one-equation','2 × cos '+Math.round(S.angle)+'° × 1 = '+signed(parallel,2)+' J');
    $('angle').value=String(S.angle);$('angle').setAttribute('aria-valuetext',Math.round(S.angle)+' 度，功 '+signed(parallel,2)+' 焦耳');value('angle-value',Math.round(S.angle)+'°');
    document.querySelectorAll('[data-angle]').forEach(el=>el.classList.toggle('is-active',Math.abs(Number(el.dataset.angle)-S.angle)<1));
  }
  function curvePoint(t,chart=false){const p=M.pointAt(t);return {x:390+150*p.x,y:(chart?194:280)-p.y*150};}
  function curvePath(a,b,chart=false){let path='';for(let i=0;i<=25;i++){const p=curvePoint(a+(b-a)*i/25,chart);path+=(i?'L':'M')+p.x+','+p.y;}return path;}
  function drawCurve(){
    const d=scene,chart=S.stage>=4;d.begin();
    const currentSegment=current(),direction=S.stage===5?-1:1;
    if(!chart){
      for(let x=-2;x<=2;x+=.5)for(let y=0;y<=1.2;y+=.4){
        const p={x:390+150*x,y:280-y*150},f=M.forceAt(x,y,S.field);
        const l=Math.hypot(f.P,f.Q);d.arrow('field-'+x+'-'+y,p,{x:p.x+f.P/l*18,y:p.y-f.Q/l*18},'#bac5b2',1.2,{opacity:.45});
      }
    }
    const acc=M.accumulation(segments,S.travel);
    segments.forEach((seg,i)=>{
      const active=i===S.selected,color=seg.work>=0?C.green:C.red;
      d.node('segment-'+i,'path',{d:curvePath(seg.a,seg.b,chart),stroke:active?C.orange:color,'stroke-width':active?9:5,'stroke-linecap':'round',fill:'none',opacity:chart&&i>acc.index?.25:1,'data-segment':i});
      const start=curvePoint(direction>0?seg.a:seg.b,chart);
      d.node('tick-'+i,'circle',{cx:start.x,cy:start.y,r:S.n>32?2:3,fill:'#fff','data-segment':i});
      if(S.n<=16){const mid=curvePoint((seg.a+seg.b)/2,chart);d.text('segment-label-'+i,mid.x,mid.y+24,String(i+1),'small','middle').setAttribute('data-segment',i);}
    });
    const a=curvePoint(0,chart),b=curvePoint(1,chart);
    d.text('A',a.x-16,a.y+6,'A','large','middle');d.text('B',b.x+17,b.y+6,'B','large','middle');
    [.19,.74].forEach((t,i)=>d.arrow('direction-'+i,curvePoint(t-direction*.027,chart),curvePoint(t+direction*.027,chart),C.ink,2));
    const activeMid=curvePoint((currentSegment.a+currentSegment.b)/2,chart);
    const fs=chart?37:57, tip={x:activeMid.x+currentSegment.P*fs,y:activeMid.y-currentSegment.Q*fs};
    d.arrow('curve-force',activeMid,tip,C.orange,3);
    d.text('curve-force-label',tip.x>650?tip.x-8:tip.x+7,tip.y-7,'F(Mᵢ)','label orange',tip.x>650?'end':'start');
    if(!chart){
      const along=currentSegment.along, length=currentSegment.length;
      const projected={x:activeMid.x+along*currentSegment.dx/length*fs,y:activeMid.y-along*currentSegment.dy/length*fs};
      d.line('local-normal',tip,projected,'#9aab91',1.5,{'stroke-dasharray':'4 5'});
      d.arrow('local-projection',activeMid,projected,along>=0?C.green:C.red,4);
      d.text('local-projection-label',projected.x>600?projected.x-8:projected.x+6,projected.y+35,'沿这一步的分力','label '+(along>=0?'green':'red'),projected.x>600?'end':'start');
    }
    d.node('curve-sample','circle',{cx:activeMid.x,cy:activeMid.y,r:6,fill:'#fff',stroke:C.orange,'stroke-width':2});
    if(!chart){
      const chord0=curvePoint(currentSegment.a),chord1=curvePoint(currentSegment.b);
      d.line('selected-chord',chord0,chord1,'#525d4a',2,{'stroke-dasharray':'5 5'});
      d.node('lens','circle',{cx:activeMid.x,cy:activeMid.y,r:30,fill:'none',stroke:C.orange,'stroke-width':1.5,'stroke-dasharray':'4 4'});
      d.line('lens-link',{x:activeMid.x+27,y:activeMid.y-21},{x:739,y:50},'#c5b492',1.5,{'stroke-dasharray':'4 7'});
      d.text('lens-copy',731,39,'同一小段，右侧放大 →','small','end');
      d.text('curve-foot',390,405,'全长分成 '+S.n+' 段；每段各取一个中点 Mᵢ。','label','middle');
      d.text('curve-foot2',390,435,'点击另一段，看看力和位移怎样一起改变。','small','middle');
    }else{
      const seg=currentSegment,t=direction>0?seg.a+(seg.b-seg.a)*acc.fraction:seg.b-(seg.b-seg.a)*acc.fraction;
      const moving=curvePoint(t,true);
      d.node('moving-point','circle',{cx:moving.x,cy:moving.y,r:8,fill:C.orange,stroke:'#fff','stroke-width':3});
      drawBars(d,acc,activeMid);
    }
    d.end();
  }
  function drawBars(d,acc,activeMid){
    const baseline=368,totalLength=segments.reduce((v,s)=>v+s.length,0);let x=80;
    d.text('chart-caption',80,285,'把每段的功摊开：柱宽 × 有向柱高 ≈ 这一段的功','small');
    d.line('chart-axis',{x:73,y:baseline},{x:710,y:baseline},'#87957d',1.3);
    d.text('chart-positive',60,318,'+','label green','middle');d.text('chart-negative',60,404,'−','label red','middle');
    segments.forEach((seg,i)=>{
      const width=620*seg.length/totalLength,h=seg.along*43,top=h>=0?baseline-h:baseline;
      const fraction=i<acc.index?1:i===acc.index?acc.fraction:0;
      d.node('bar-ghost-'+i,'rect',{x,y:top,width:Math.max(1,width-1),height:Math.max(1,Math.abs(h)),fill:seg.work>=0?C.green:C.red,opacity:.13,'data-segment':i});
      d.node('bar-'+i,'rect',{x,y:top,width:Math.max(0,(width-1)*fraction),height:Math.max(1,Math.abs(h)),fill:seg.work>=0?C.green:C.red,opacity:.8,'data-segment':i,class:'bar'});
      if(i===S.selected){
        d.node('bar-selection','rect',{x:x-1,y:top-2,width:width+1,height:Math.max(3,Math.abs(h))+4,fill:'none',stroke:C.orange,'stroke-width':2});
        d.node('bar-link','path',{d:'M'+activeMid.x+','+(activeMid.y+25)+' Q'+activeMid.x+',257 '+(x+width/2)+','+(top-6),fill:'none',stroke:C.orange,'stroke-width':1.3,'stroke-dasharray':'4 6',opacity:.65});
      }
      if(S.n<=16)d.text('bar-label-'+i,x+width/2,435,String(i+1),'small','middle');
      x+=width;
    });
    d.text('chart-bottom',390,462,'横向：按行走顺序排开的小段长度　　纵向：沿这一步位移的分力','tiny','middle');
  }
  function drawZoom(){
    const d=asideScene,s=current();d.begin();
    const center={x:(s.p0.x+s.p1.x)/2,y:(s.p0.y+s.p1.y)/2},scale=195/s.length;
    const project=p=>({x:190+(p.x-center.x)*scale,y:115-(p.y-center.y)*scale});
    let path='',maxDeviation=0;
    for(let i=0;i<=35;i++){
      const p=M.pointAt(s.a+(s.b-s.a)*i/35),q=project(p);path+=(i?'L':'M')+q.x+','+q.y;
      maxDeviation=Math.max(maxDeviation,Math.abs((p.x-s.p0.x)*s.dy-(p.y-s.p0.y)*s.dx)/s.length);
    }
    const p0=project(s.p0),p1=project(s.p1);
    d.node('zoom-arc','path',{d:path,fill:'none',stroke:C.orange,'stroke-width':5,'stroke-linecap':'round'});
    d.arrow('zoom-chord',p0,p1,C.ink,2,{'stroke-dasharray':'5 5'});
    [p0,p1].forEach((p,i)=>d.node('zoom-end-'+i,'circle',{cx:p.x,cy:p.y,r:4,fill:'#fff',stroke:C.ink,'stroke-width':1.5}));
    d.text('zoom-a',p0.x,p0.y+25,'起点','small','middle');d.text('zoom-b',p1.x,p1.y+25,'终点','small','middle');
    d.text('zoom-title',190,28,'第 '+(S.selected+1)+' 段 · 放大 '+fmt(scale/150,1)+' 倍','small','middle');
    d.text('zoom-delta',190,205,'虚线位移 Δr 连接两个端点','small','middle');d.end();
    value('segment-number',(S.selected+1)+' / '+S.n);value('arc-length',fmt(s.arc,4)+' m');value('chord-length',fmt(s.length,4)+' m');value('bend-error',fmt(maxDeviation/s.length*100,2)+'%');
    value('local-projection-equation','沿路分力 '+signed(s.along)+' N × 位移长 '+fmt(s.length)+' m ≈ '+signed(s.work)+' J');
  }
  function componentDiagram(d,key,origin,vx,vy,scale,kind){
    const h={x:origin.x+vx*scale,y:origin.y},tip={x:h.x,y:origin.y-vy*scale};
    const xAlpha=S.focus==='y'?.18:1,yAlpha=S.focus==='x'?.18:1;
    d.line(key+'-axis-x',{x:origin.x-30,y:origin.y},{x:origin.x+215,y:origin.y},'#d6ddd0',1);
    d.line(key+'-axis-y',{x:origin.x,y:origin.y+115},{x:origin.x,y:origin.y-180},'#d6ddd0',1);
    d.arrow(key+'-x',origin,h,C.blue,4,{opacity:xAlpha});
    d.arrow(key+'-y',h,tip,C.green,4,{opacity:yAlpha});
    d.arrow(key+'-vector',origin,tip,C.orange,4);
    const sy=vy>=0?-1:1;
    const square=Math.min(9,Math.abs(vy*scale)*.6,Math.abs(vx*scale)*.6);
    if(square>2)d.node(key+'-right','path',{d:'M'+(h.x-square)+' '+h.y+' v'+(sy*square)+' h'+square,fill:'none',stroke:'#8f9e84','stroke-width':1.5});
    d.text(key+'-x-name',(origin.x+h.x)/2,origin.y+24,kind==='displacement'?'Δx':'P','label blue','middle').setAttribute('opacity',xAlpha);
    d.text(key+'-y-name',h.x+12,(h.y+tip.y)/2,kind==='displacement'?'Δy':'Q','label green').setAttribute('opacity',yAlpha);
    d.text(key+'-v-name',tip.x+9,tip.y-10,kind==='displacement'?'Δr':'F','label orange');
    d.node(key+'-origin','circle',{cx:origin.x,cy:origin.y,r:5,fill:'#fff',stroke:C.ink,'stroke-width':2});
  }
  function drawComponents(){
    if(shownFormulaKey!==S.stage+':'+S.focus)showFormula();
    const d=scene,s=current();d.begin();
    value('scene-hint','第 '+(S.selected+1)+' / '+S.n+' 段 · 点击右侧同色算式');
    d.text('disp-title',205,43,'这一小步的位移','label','middle');d.text('force-title',557,43,'这一小段的力','label','middle');
    componentDiagram(d,'disp',{x:100,y:250},s.dx,s.dy,175/Math.max(Math.abs(s.dx),Math.abs(s.dy)),'displacement');
    componentDiagram(d,'force',{x:465,y:250},s.P,s.Q,150/Math.max(Math.abs(s.P),Math.abs(s.Q)),'force');
    d.line('component-divider',{x:393,y:40},{x:393,y:390},'#e8ece2',1);
    d.text('disp-readout',210,402,'Δr = ('+signed(s.dx)+', '+signed(s.dy)+')','small mono','middle');
    d.text('force-readout',565,402,'F = ('+signed(s.P)+', '+signed(s.Q)+')','small mono','middle');
    d.text('component-bottom',390,449,'两个图各用自己的比例尺；同一个图里的 x、y 比例相同。','small','middle');d.end();
    value('x-equation',fmt(s.P)+' × ('+signed(s.dx)+') = '+signed(s.wx));
    value('y-equation',fmt(s.Q)+' × ('+signed(s.dy)+') = '+signed(s.wy));
    value('coordinate-work',signed(s.work)+' J');
    value('signed-components',s.dy<0?'此处 Δy 为负：向下的投影带负号，不能只取投影长度。':'此处 Δx、Δy 都为正：位移分别向右、向上投影。');
    document.querySelectorAll('[data-channel]').forEach(el=>{
      el.classList.toggle('is-dim',S.focus!=='all'&&S.focus!==el.dataset.channel);
      el.classList.toggle('is-active',S.focus===el.dataset.channel);
    });
  }
  function fillSum(acc){
    let positive=0,negative=0;
    segments.forEach((s,i)=>{const fraction=i<acc.index?1:i===acc.index?acc.fraction:0;const w=s.work*fraction;if(w>=0)positive+=w;else negative+=w;});
    const approx=sum(segments),exactParts=M.workTo(1,S.field),exact=exactParts.x+exactParts.y;
    value('collected','已走 '+Math.round(S.travel*100)+'% · 当前累计功');value('sum-work',signed(acc.work)+' J');
    $('sum-result').className='work-result '+(acc.work<0?'negative':'');
    value('positive-work',signed(positive)+' J');value('negative-work',signed(negative)+' J');
    value('current-work','第 '+(acc.index+1)+' 段：'+signed(current().work)+' J。'+(current().work<0?'这段做负功，正在从总功中扣去。':'这段做正功，正在加入总功。'));
    value('approx-work',fmt(approx,5));value('exact-work',fmt(exact,5));value('approx-error',Math.abs(approx-exact).toFixed(6));
  }
  function drawReverse(acc){
    const d=asideScene,s=current();d.begin();
    const fMagnitude=Math.hypot(s.P,s.Q),length=s.length;
    // The reverse pair uses exactly the same midpoint force and endpoints.
    [1,-1].forEach((sign,i)=>{
      const o={x:185,y:85+i*140},dx=-s.dx/length*100*sign,dy=s.dy/length*100*sign;
      d.text('pair-title-'+i,18,25+i*140,i===0?'正向 Δr':'反向 −Δr','small');
      d.arrow('pair-move-'+i,o,{x:o.x+dx,y:o.y+dy},i===0?C.ink:C.red,4);
      d.arrow('pair-force-'+i,o,{x:o.x+s.P/fMagnitude*62,y:o.y-s.Q/fMagnitude*62},C.orange,3);
      d.node('pair-origin-'+i,'circle',{cx:o.x,cy:o.y,r:4,fill:'#fff',stroke:C.ink,'stroke-width':1.5});
      d.text('pair-force-label-'+i,o.x+69,o.y-33,'同一个 F','small orange');
    });d.end();
    value('pair-length','两种方向的位移长度均为 '+fmt(s.length)+' m，力均为 ('+fmt(s.P)+', '+fmt(s.Q)+') N。');
    value('forward-micro',signed(-s.work)+' J');value('reverse-micro',signed(s.work)+' J');
    value('forward-components','('+signed(-s.dx)+', '+signed(-s.dy)+')');value('reverse-components','('+signed(s.dx)+', '+signed(s.dy)+')');
    value('forward-total',signed(-sum(segments))+' J');value('reverse-total',signed(sum(segments))+' J');value('reverse-current',signed(acc.work)+' J');
  }
  function render(){
    if(S.stage===1){drawProjection();return;}
    let acc=null;
    if(S.stage>=4){acc=M.accumulation(segments,S.travel);S.selected=acc.index;}
    if(S.stage===3)drawComponents();else drawCurve();
    if(S.stage===2)drawZoom();if(S.stage===4)fillSum(acc);if(S.stage===5)drawReverse(acc);
    $('partitions').value=String(sizes.indexOf(S.n));value('partition-value',S.n+' 段');
    $('position').value=String(S.stage>=4?S.travel:(S.selected+.5)/S.n);
    value('position-title',S.stage>=4?'沿路累加':'选择一小段');
    value('position-value',S.stage>=4?Math.round(S.travel*100)+'%':'第 '+(S.selected+1)+' 段');
  }
  function changeN(n){const relative=(S.selected+.5)/S.n;S.n=n;S.selected=Math.min(n-1,Math.floor(relative*n));rebuild();}
  function animateValue(key,target){
    stop();S.finished=false;
    if(reduced){S[key]=target;render();return;}
    if(window.gsap)window.gsap.to(S,{[key]:target,duration:.55/S.speed,ease:'power2.inOut',onUpdate:render});
    else S.motion={key,from:S[key],to:target,elapsed:0};
  }
  function animateTravel(target){animateValue('travel',target);}
  function chooseSegment(index){
    stop();S.selected=clamp(index,0,S.n-1);
    if(S.stage>=4){const total=segments.reduce((a,s)=>a+s.length,0),prior=segments.slice(0,index).reduce((a,s)=>a+s.length,0);S.travel=(prior+segments[index].length*.5)/total;}
    render();
  }
  function startScene(){
    if(S.mode){stop();return;}
    stop();
    if(S.finished){S.clock=0;S.travel=0;S.finished=false;}
    if(S.stage>=4)S.clock=S.travel*10;
    S.mode='scene';updateButtons();
  }
  function frame(now){
    const dt=lastTime?Math.min(.07,(now-lastTime)/1000):0;lastTime=now;
    if(S.motion){const m=S.motion;m.elapsed+=dt*S.speed;let f=clamp(m.elapsed/.55,0,1);f=f*f*(3-2*f);S[m.key]=m.from+(m.to-m.from)*f;render();if(f>=1)S.motion=null;}
    if(S.mode){
      S.clock+=dt*S.speed;const time=S.clock;let duration=10;
      if(S.stage===1){
        duration=11;
        if(time<3)S.angle=45*(1-time/3);
        else if(time<6)S.angle=(time-3)/3*90;
        else if(time<7.5)S.angle=90;
        else S.angle=90+60*Math.min(1,(time-7.5)/2);
      }else if(S.stage===2){
        const levels=S.mode==='guide'?[4,8,16]:sizes;const n=levels[Math.min(levels.length-1,Math.floor(time/10*levels.length))];if(n!==S.n)changeN(n);
      }else if(S.stage===3){duration=8;S.focus=time<2.5?'x':time<5?'y':'all';}
      else S.travel=clamp(time/10,0,1);
      render();
      if(time>=duration){const guide=S.mode==='guide';stop();S.finished=true;if(guide&&S.stage<5)enterStage(S.stage+1,true);}
    }
    requestAnimationFrame(frame);
  }
  $('guide').addEventListener('click',()=>{if(S.mode==='guide'){stop();return;}S.n=8;S.field='mixed';$('field').value='mixed';S.angle=45;enterStage(1,true);});
  document.querySelectorAll('button[data-stage]').forEach(el=>el.addEventListener('click',()=>enterStage(Number(el.dataset.stage))));
  document.querySelectorAll('[data-angle]').forEach(el=>el.addEventListener('click',()=>{S.clock=0;animateValue('angle',Number(el.dataset.angle));}));
  $('angle').addEventListener('input',()=>{stop();S.clock=0;S.angle=Number($('angle').value);render();});
  $('partitions').addEventListener('input',()=>{stop();changeN(sizes[Number($('partitions').value)]);render();});
  $('field').addEventListener('change',()=>{stop();S.field=$('field').value;rebuild();render();});
  $('position').addEventListener('input',()=>{stop();S.finished=false;const p=Number($('position').value);if(S.stage>=4)S.travel=p;else S.selected=Math.min(S.n-1,Math.floor(p*S.n));render();});
  $('insight').addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;if(button.dataset.channel){stop();S.focus=button.dataset.channel;render();}if(button.id==='show-both'){stop();S.focus='all';render();}});
  $('previous').addEventListener('click',()=>enterStage(S.stage-1));$('next').addEventListener('click',()=>enterStage(S.stage+1));$('play').addEventListener('click',startScene);
  $('speed').addEventListener('change',()=>{S.speed=Number($('speed').value);});
  $('advance').addEventListener('click',()=>{
    if(S.stage<4){chooseSegment((S.selected+1)%S.n);return;}
    const total=segments.reduce((a,s)=>a+s.length,0),acc=M.accumulation(segments,S.travel);
    const end=segments.slice(0,acc.index+1).reduce((a,s)=>a+s.length,0)/total;
    const target=Math.abs(S.travel-end)<1e-6?segments.slice(0,acc.index+2).reduce((a,s)=>a+s.length,0)/total:end;
    animateTravel(clamp(target,0,1));
  });
  const plot=$('scene');
  plot.addEventListener('click',e=>{const el=e.target.closest('[data-segment]');if(el&&S.stage!==1)chooseSegment(Number(el.dataset.segment));});
  function dragAngle(e){const p=plot.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(plot.getScreenCTM().inverse());S.angle=clamp(Math.atan2(Math.max(0,263-q.y),q.x-335)*180/Math.PI,0,180);render();}
  plot.addEventListener('pointerdown',e=>{if(S.stage!==1||!e.target.dataset.force)return;stop();S.clock=0;dragging=true;plot.setPointerCapture(e.pointerId);dragAngle(e);});
  plot.addEventListener('pointermove',e=>{if(dragging)dragAngle(e);});
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>plot.addEventListener(type,()=>{dragging=false;}));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  rebuild();enterStage(1);requestAnimationFrame(frame);
})();
