(function () {
  'use strict';
  const { PHASES, STEPS, IP, REQUEST, HTML, snapshot } = window.WebJourney;
  const $ = selector => document.querySelector(selector);
  const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const engine = window.gsap;
  const State = { index: 0, settled: true, playing: false, auto: false, speed: 1, tl: null };
  const scene = $('#scene');
  const resourceInfo = [ ['css','site.css',13,14], ['image','network.svg',15,16], ['js','app.js',17,18] ];
  const image = '<svg viewBox="0 0 240 80" aria-label="浏览器与服务器连接示意"><rect x="8" y="18" width="64" height="42" rx="5" fill="#eff6ff" stroke="#93c5fd"/><path d="M72 39h96" stroke="#2563eb" stroke-width="2"/><path d="m161 34 7 5-7 5" fill="none" stroke="#2563eb" stroke-width="2"/><rect x="168" y="18" width="64" height="42" rx="5" fill="#ecfdf5" stroke="#6ee7b7"/><text x="40" y="43" text-anchor="middle" fill="#2563eb" font-size="12">浏览器</text><text x="200" y="43" text-anchor="middle" fill="#047857" font-size="12">服务器</text></svg>';
  $('#phase-nav').innerHTML = PHASES.map((p,i) => `<button class="phase-button" data-phase="${i}"><span class="phase-num">${String(i+1).padStart(2,'0')}</span><b>${p.name}</b><small>${p.output}</small></button>`).join('');
  $('#step-seek').max = STEPS.length - 1;

  function message(s, index) {
    const response = s.from !== 'browser';
    const current = index === State.index;
    return `<div class="message ${s.phase===1?'dns-message':''} ${response?'is-response':''} ${current?'is-current':'is-past'}" data-message="${index}"><div class="message-track"><span class="message-label">${esc(s.label)}</span><div class="message-line"${current && !State.settled?' style="transform:scaleX(0)"':''}></div></div><p class="message-sub">${esc(s.sub)}</p></div>`;
  }
  function codePanel(label, code, waiting) {
    return `<div class="code-panel ${waiting?'is-waiting':''}"><div class="code-label"><span>${esc(label)}</span>${waiting?'<span>尚未到达</span>':''}</div><pre>${esc(code)}</pre></div>`;
  }
  function currentState() { return snapshot(State.index - (State.settled ? 0 : 1)); }

  function renderUrl() {
    return `<p class="scene-intro">同一个网址里，<strong>每一部分都有不同的去处</strong>。</p><div class="url-flow">
      <div class="url-route ${State.index===1?'is-current':''}"><code>https://</code><span class="route-arrow">→</span><div class="route-target"><b>选择通信方式</b><span>TLS + HTTP，目标端口 443</span></div></div>
      <div class="url-route ${State.index===1?'is-current':''}"><code>learn.example</code><span class="route-arrow">→</span><div class="route-target"><b>DNS 要找的主机名</b><span>先得到目标 IP 地址</span></div></div>
      <div class="url-route ${State.index===1?'is-current':''}"><code>/net/index.html<br>?chapter=4</code><span class="route-arrow">→</span><div class="route-target"><b>HTTP 要取的资源</b><span>路径与查询参数一起发送</span></div></div>
      <div class="url-route local-route"><code>#tcp</code><span class="route-arrow">↳</span><div class="route-target"><b>留在浏览器</b><span>定位页面元素，不随请求发送</span></div></div></div>${State.index===0?'<div class="initial-prompt"><b>从这里开始。</b> 点击“下一步”，逐个观察一次导航。</div>':''}`;
  }
  function renderNetwork(state, phase) {
    const first = PHASES[phase].start;
    let intro = '';
    if (phase===1) intro = 'DNS 只解决一件事：<strong>learn.example 对应哪个 IP？</strong>';
    if (phase===2) intro = `已知 IP <strong>${IP}</strong>，现在与网站建立可靠连接。`;
    if (phase===3) intro = 'TCP 已建立。HTTPS 还要<strong>确认网站身份，并保护后续内容</strong>。';
    if (phase===4) intro = '安全通道已就绪。现在才问网站：<strong>请给我这份文档</strong>。';
    const messages = STEPS.slice(first,State.index+1).map((s,j) => message(s,first+j)).join('');
    let end = '';
    if (phase===1) end = `<div class="connection-banner ${state.ip?'':'pending'}">${state.ip?`域名 → ${IP} · 下一步用它连接网站`:'等待 DNS 应答 · 此刻没有网页数据'}</div>`;
    if (phase===2) end = `<div class="sequence-caption"><span>客户端：<b>${state.client}</b></span><span>服务器：<b>${state.server}</b></span></div><div class="connection-banner ${state.tcp?'':'pending'}">${state.tcp?'可靠连接已建立 · 下一步建立 TLS 安全通道':'三次握手分别确认，不要跳过第三次 ACK'}</div>`;
    if (phase===3) end = `<div class="connection-banner ${state.tls?'':'pending'}">${state.tls?'身份验证通过 · 后续 HTTP 内容受 TLS 保护':'TLS 协商中 · 图中为消息组，省略协议细节'}</div>`;
    if (phase===4) end = `<div class="http-panels">${codePanel('请求 · 应用层视图',REQUEST,false)}${codePanel('响应 · 解密后的内容',state.html?'HTTP/1.1 200 OK\nContent-Type: text/html\n\n'+HTML:'HTTP/1.1 200 OK\nContent-Type: text/html\n\n（等待 HTML 正文）',!state.html)}</div><p class="wire-hint">面板展示应用层内容；网络上传输时受 TLS 保护。#tcp 不在请求里。</p>`;
    return `<p class="scene-intro">${intro}</p><div class="seq">${messages}</div>${end}`;
  }
  function renderResources(state) {
    return resourceInfo.map(([key,name,req]) => {
      const requesting = State.index===req || (State.index===req+1&&!State.settled);
      return `<div class="resource ${state[key]?'is-ready':requesting?'is-requesting':''}"><code>${name}</code><span>${state[key]?(key==='js'&&state.render!=='complete'?'已下载，待执行':'已收到'):requesting?'请求中':'待请求'}</span></div>`;
    }).join('');
  }
  function preview(state) {
    let content = '<div class="preview-empty">还没有页面像素</div>';
    let label = '未绘制';
    if (state.render==='style') label = '样式已确定，尚未绘制';
    if (state.render==='layout') {
      content = `<div class="preview-content styled layout-only"><h3>标题位置</h3><p>段落位置</p><div class="image-box"></div></div>`;
      label = '布局示意 · 不是屏幕画面';
    }
    if (state.render==='paint'||state.render==='complete') {
      content = `<div class="preview-content styled"><h3 id="preview-title">网络学习笔记</h3><p>一次访问，从域名走到页面。</p>${image}<p class="welcome">${state.render==='complete'?'欢迎回来，开始学习 TCP。':'页面已显示，脚本尚未更新提示。'}</p></div>`;
      label = state.render==='complete'?'脚本更新后的页面':'第一次绘制';
    }
    return `<div><div class="page-preview"><div class="preview-bar"><code>learn.example</code><span>浏览器视口</span></div><div class="preview-body">${content}</div></div><p class="preview-note">${label}</p></div>`;
  }
  function renderPage(state) {
    const step = STEPS[State.index];
    const arrow = step.from ? `<div class="render-message ${step.from==='server'?'is-response':''}"><span class="render-arrow">${step.from==='server'?'←':'→'}</span>${esc(step.label)}<p class="message-sub">${step.from==='server'?'网站 → 浏览器':'浏览器 → 网站'} · 复用已有连接</p></div>` : '';
    const pipeline = [['dom','DOM'],['css','CSSOM'],['style','样式'],['layout','布局'],['paint','绘制'],['complete','JS 更新']];
    const order = ['blank','style','layout','paint','complete'];
    const rank = order.indexOf(state.render);
    return `<p class="scene-intro"><strong>HTML 不是截图。</strong> 浏览器读取结构、补齐资源，再产生页面像素。</p>${arrow}<div class="render-view"><div class="render-work">${State.index===12?codePanel('已收到的 HTML · 继续发现资源',HTML,false):'<div class="dom-sketch"><b>DOM</b><span>html</span><span class="branch">↳</span><span>body</span><span class="branch">↳</span><span>h1 / p / img</span></div>'}<div class="resource-list">${renderResources(state)}</div><div class="render-pipeline">${pipeline.map(([key,label],i) => {
      const ready = key==='dom'||key==='css'?state[key]:rank>=order.indexOf(key);
      return `${i?'<i>→</i>':''}<span class="${ready?'is-ready':step.unlock===key?'is-current':''}">${label}</span>`;
    }).join('')}</div><p class="preview-note">DOM 与 CSSOM 共同参与样式计算。</p></div>${preview(state)}</div><p class="wire-hint">为看清分工，这里依次展开。真实下载、解析和渲染可以交叠。</p>`;
  }

  function updateEvidence(state) {
    const info = { ip:[IP,'等待 DNS'], tcp:['已建立','尚未建立'], tls:['已加密','尚未就绪'], html:['已收到','尚未收到'] };
    Object.entries(info).forEach(([key,[yes,no]]) => {
      const el=$('#evidence-'+key);
      el.classList.toggle('is-ready',state[key]);
      el.querySelector('b').textContent=state[key]?yes:no;
    });
  }
  function render() {
    const s = STEPS[State.index];
    const p = PHASES[s.phase];
    const state = currentState();
    $('#phase-label').textContent = `${String(s.phase+1).padStart(2,'0')} / ${p.name}`;
    $('#step-title').textContent=s.title;
    $('#step-count').textContent=`${State.index+1} / ${STEPS.length}`;
    $('#why').textContent=s.why;
    $('#result').textContent=State.settled?s.result:'观察当前动作，结果将在动作完成后保留。';
    $('#next-cause').textContent=State.settled?s.next:'当前动作完成后，再看下一步。';
    $('#result-state').textContent=State.settled?(State.index===STEPS.length-1?'✓ 本次访问演示完成':'✓ 结果已确认'):'● 当前动作进行中';
    $('#result-panel').classList.toggle('is-pending',!State.settled);
    $('#detail-body').textContent=p.detail;
    $('#detail-visual').innerHTML=s.phase===1?'<div class="detail-chain"><span>浏览器 / 系统缓存（本次未命中）</span><span>递归解析器</span><span>必要时：根 → 顶级域 → 权威服务器</span><span>应答回到客户端，暂存 IP</span></div>':'';
    document.querySelectorAll('.phase-button').forEach((b,i) => {
      b.classList.toggle('is-current',i===s.phase);
      b.classList.toggle('is-done',i<s.phase);
      if (i===s.phase) b.setAttribute('aria-current','step'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-url]').forEach(el => {
      const key=el.dataset.url;
      el.classList.toggle('url-active',s.phase===0 && State.index===1 || s.phase===1&&key==='host' || s.phase===4&&['path','query'].includes(key));
    });
    ['browser','dns','server'].forEach(key => {
      const el=$('#actor-'+key);
      const active = key==='browser'||key==='dns'&&s.phase===1||key==='server'&&s.phase>=2;
      el.classList.toggle('is-active',active);
      el.classList.toggle('is-ready',key==='server'&&state.tls);
    });
    $('#browser-status').textContent=s.phase===0?'正在处理网址':s.phase===1?'等待 / 接收地址':s.phase===2?state.client:s.phase===3?(state.tls?'TLS 就绪':'TLS 协商'):s.phase===4?'HTTP 客户端':'解析与渲染';
    $('#dns-status').textContent=state.ip?'地址已返回':'回答“地址是什么”';
    $('#server-status').textContent=state.ip?`${IP} : 443`:'地址尚未得到';
    scene.innerHTML=s.phase===0?renderUrl():s.phase===5?renderPage(state):renderNetwork(state,s.phase);
    updateEvidence(state);
    syncControls();
  }
  function syncControls() {
    $('#btn-prev').disabled=State.index===0;
    $('#btn-next').disabled=State.index===STEPS.length-1&&State.settled;
    $('#btn-play').disabled=!engine;
    $('#btn-play').textContent=State.playing?'Ⅱ 暂停':State.auto?'▶ 继续播放':State.index===STEPS.length-1&&State.settled?'▶ 从头播放':'▶ 自动播放';
    $('#step-seek').value=State.index;
    $('#play-status').textContent=State.playing?(State.auto?'自动播放中':'动作进行中'):State.auto?'已暂停':'单步观察';
  }
  function stop() {
    if (State.tl) { State.tl.kill(); State.tl=null; }
    if (engine) {
      engine.killTweensOf([scene,$('#result-panel'),...document.querySelectorAll('.evidence-item')]);
      engine.set([scene,$('#result-panel')],{clearProps:'opacity,transform'});
    }
    State.playing=false;
  }
  function goto(index, options={}) {
    const auto=options.auto===true;
    stop();
    State.index=Math.max(0,Math.min(STEPS.length-1,index));
    State.auto=auto;
    State.settled=false;
    if (!engine || options.instant) {
      State.settled=true;
      render();
      return;
    }
    State.playing=true;
    syncControls();
    const dur=reduced.matches ? .05 : .9;
    const outro=reduced.matches?0:.15;
    const arrival=outro+dur+.2;
    const rest=arrival+.35;
    const motion={progress:0};
    const hold={progress:0};
    const tl=engine.timeline({paused:true,onComplete:() => {
      State.playing=false;
      if(State.auto && State.index<STEPS.length-1) goto(State.index+1,{auto:true});
      else { State.auto=false; syncControls(); }
    }});
    State.tl=tl;
    tl.to(scene,{opacity:0,y:-6,scale:.99,duration:outro,ease:'power2.in'},0);
    tl.call(render,[],outro);
    tl.fromTo(scene,{opacity:0,y:8,scale:1},{opacity:1,y:0,scale:1,duration:reduced.matches?0:.35,ease:'power4.out',immediateRender:false},outro);
    tl.to(motion,{progress:1,duration:dur,ease:'expo.out',onUpdate:() => {
      const line=scene.querySelector('.message.is-current .message-line');
      if(line) line.style.transform=`scaleX(${motion.progress})`;
      const arrow=scene.querySelector('.render-arrow');
      if(arrow) arrow.style.transform=`translateX(${(1-motion.progress)*(STEPS[State.index].from==='server'?16:-16)}px)`;
    }},outro+.1);
    tl.call(() => { State.settled=true; render(); },[],arrival);
    tl.fromTo($('#result-panel'),{opacity:.4,y:5},{opacity:1,y:0,duration:reduced.matches?0:.3,ease:'power4.out',immediateRender:false},arrival);
    tl.call(() => {
      if(!State.auto) { tl.pause(); State.playing=false; syncControls(); }
    },[],rest);
    tl.to(hold,{progress:1,duration:2.7,ease:'none'},rest);
    tl.timeScale(State.speed).play();
  }
  function next() { goto(State.index+1); }
  function prev() { goto(State.index-1); }
  function reset() { goto(0,{instant:true}); if(engine) engine.set(scene,{clearProps:'opacity,transform'}); }
  function togglePlay() {
    if(!engine) return;
    if(State.playing) { State.tl.pause(); State.playing=false; syncControls(); return; }
    State.auto=true;
    State.playing=true;
    if(State.index===STEPS.length-1&&State.settled) goto(0,{auto:true});
    else if(State.tl) { State.tl.play(); syncControls(); }
    else goto(State.index,{auto:true});
  }
  $('#btn-next').addEventListener('click',next);
  $('#btn-prev').addEventListener('click',prev);
  $('#btn-play').addEventListener('click',togglePlay);
  $('#btn-replay').addEventListener('click',() => goto(State.index));
  $('#btn-reset').addEventListener('click',reset);
  $('#phase-nav').addEventListener('click',event => {
    const button=event.target.closest('[data-phase]');
    if(!button) return;
    $('#phase-detail').open=false;
    goto(PHASES[Number(button.dataset.phase)].start);
  });
  $('#step-seek').addEventListener('input',event => goto(Number(event.target.value),{instant:true}));
  $('#speed').addEventListener('change',event => {
    State.speed=Number(event.target.value);
    if(State.tl) State.tl.timeScale(State.speed);
  });
  document.addEventListener('keydown',event => {
    if(/INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY/.test(event.target.tagName)||event.ctrlKey||event.metaKey||event.altKey) return;
    if(event.key==='ArrowRight') { event.preventDefault(); next(); }
    if(event.key==='ArrowLeft') { event.preventDefault(); prev(); }
    if(event.code==='Space') { event.preventDefault(); togglePlay(); }
  });
  if(!engine) $('#engine-note').hidden=false;
  render();
  window.APP={State,STEPS,PHASES,snapshot,controller:{goto,next,prev,reset,play:togglePlay}};
})();
