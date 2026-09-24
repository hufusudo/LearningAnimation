(() => {
  'use strict';
  const { receiveRip, advertise, dijkstra, pathTo } = window.RoutingModel;
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const OSPF_NODES = ['A','B','C','D','E'];
  const OSPF_LINKS = [['A','B',2],['A','C',5],['B','C',1],['B','D',6],['C','D',1],['C','E',8],['D','E',2]];
  const metadata = {
    rip: { title:'只向邻居打听路', caption:'目的地是网络 N；每走一条链路，跳数加 1。', rule:'RIP 的指路规则', text:'邻居报告的距离 + 1，就是经过它的距离。更短就改走它；如果当前下一跳报告距离变长，也必须更新。这里仅展示到 N 的路由变化。' },
    bad: { title:'断了的路，为什么还在传？', caption:'跟踪到网络 N 的路线，比较 A 与 B 的小本子。', rule:'“慢”的根源：旧消息互相误导', text:'教学模式关闭水平分割与毒性逆转，并安排 B 的旧通告先到达。A 不知道 B 的旧路其实经过自己。真实 RIP 使用水平分割、毒性逆转和触发更新来减轻问题；本例不是每次故障都必然发生。' },
    ospf: { title:'先拼地图，再计算最短路', caption:'线上的数字是开销；以 A 为起点，目标是 E。', rule:'Dijkstra 的贪心选择', text:'从还没确认的节点中，选当前开销最小的一个，确认它；再试着经过它改善邻居的开销。重复这个过程。绿色是已确认，蓝色是本轮节点。' },
    repair: { title:'把断路告诉大家，再重新算', caption:'切断 C—D；观察变化传播，以及 A 的新路线。', rule:'变化先传开，路线再更新', text:'端点检测到断路后，生成更新的链路状态通告并可靠泛洪。收到后重新计算最短路。本演示聚焦收敛过程，不等于瞬时切换；实际检测、传播和计算均需要时间。' }
  };
  let scene = 'rip', frames = [], milestones = [], index = 0, playing = false, motion = null;
  let raf = 0, lastTime = 0, width = 800, height = 326, positions = {}, packetElements = [];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const copyRoutes = r => Object.fromEntries(Object.entries(r).map(([k,v]) => [k,{...v}]));
  const number = x => Number.isFinite(x) ? x : '∞';
  const edgeKey = (a,b) => [a,b].sort().join('-');
  const packet = (from,to,label,type='update') => ({from,to,label,type});
  const sequence = (path,label='数据包') => path.slice(1).map((n,i) => ({...packet(path[i],n,label,'data'),start:i/(path.length-1),end:(i+1)/(path.length-1)}));

  function ripFrames() {
    const out = [], routes = { A:{metric:1,via:'直连'}, B:{metric:16,via:null}, C:{metric:16,via:null}, D:{metric:16,via:null} };
    const push = f => out.push({routes:copyRoutes(routes),packets:[],path:[],...f});
    push({phase:'初始',title:'先认识指路员：A、B、C、D',description:'网络 N 是目的地。A 与 N 直接相连，距离记为 1；其他路由器还没学会到 N 的路，记为 16（不可达）。',formula:'路由表只记：目的地 N → 下一跳 → 跳数',focus:['A']});
    for (const [from,to] of [['A','B'],['B','C'],['C','D']]) {
      const reported = routes[from].metric;
      routes[to] = receiveRip(routes[to],from,reported);
      push({phase:'传递好消息',title:`${from} 告诉 ${to}：“我到 N 要 ${reported} 跳。”`,description:`${to} 把邻居的距离再加 1，学到一条可用路线。以后去 N，先把数据包交给 ${from}。消息到达后，右侧路由表更新。`,formula:`${to} 到 N：${reported} + 1 = ${routes[to].metric} 跳；下一跳 = ${from}`,packets:[packet(from,to,`到 N：${reported} 跳`)],changed:[to],focus:[to]});
    }
    push({phase:'已经收敛',title:'大家都学会了，数据包可以出发',description:'路由信息一站一站传开。D 并不需要保存完整路线，只要记住“去 N 先交给 C”，沿途每一站也照自己的路由表转发。',formula:'D → C → B → A → N，总计 4 跳',path:['D','C','B','A','N'],packets:sequence(['D','C','B','A','N'])});
    return {frames:out,milestones:[['初始状态',0],['邻居通告',1],['逐站学会',3],['数据转发',4]]};
  }

  function badFrames(poison) {
    const out = [], routes = { A:{metric:1,via:'直连'}, B:{metric:2,via:'A'} }, history = [];
    let broken = false;
    const push = f => { history.push({A:routes.A.metric,B:routes.B.metric}); out.push({routes:copyRoutes(routes),broken,history:history.map(x=>({...x})),packets:[],path:[],...f}); };
    push({phase:'故障之前',title:'B 的路，其实来自 A',description:'A 直连 N；B 通过 A 到 N。请记住：B 的“2 跳可达”，依赖的正是 A—N 这条链路。',formula:'B → A → N；A = 1 跳，B = 2 跳',path:['B','A','N']});
    broken = true; routes.A = {metric:16,via:null};
    push({phase:'发现断路',title:'A—N 断了，但 B 还不知道',description:'A 立刻把自己的距离改为 16。此时 B 仍保留旧路线“经 A，2 跳”。接下来故意让 B 的旧通告先于 A 的坏消息到达，观察会发生什么。',formula:'真实世界：N 已不可达；B 的记忆仍停在断路前',changed:['A'],focus:['A']});
    const advertised = advertise(routes.B,'A',poison);
    routes.A = receiveRip(routes.A,'B',advertised);
    if (poison) {
      push({phase:'毒性逆转',title:'B 对 A 说：“你不能靠我到 N。”',description:'B 的下一跳本来就是 A，所以向 A 报告这条路线时，把距离写成 16。B 向其他邻居通告时仍可报告 2；毒性逆转只改变发回来源邻居的内容。',formula:'B → A 通告 16；A 不会学到虚假的“3 跳路线”',packets:[packet('B','A','到 N：16（毒化）')],focus:['A']});
      routes.B = receiveRip(routes.B,'A',16);
      push({phase:'双方不可达',title:'A 的坏消息到达，B 也删除旧路线',description:'A 通告 N 不可达；B 当前经 A 转发，因此必须接受来自 A 的变坏信息。这个两路由器环路被阻止了。毒性逆转并不能消除所有多路由器环路。',formula:'A = 16，B = 16；不再把数据包交给对方',packets:[packet('A','B','到 N：16')],changed:['B']});
      return {frames:out,milestones:[['原来的路线',0],['链路断开',1],['毒化旧通告',2],['停止误导',3]]};
    }
    push({phase:'误信旧消息',title:'B：“我只要 2 跳。” A：“那我走你！”',description:'A 只听见 B 报的距离，却看不到 B 的完整路线。于是 A 以为经 B 可以 3 跳到 N，把下一跳改成 B。问题是，B 的下一跳还是 A。',formula:'A：2 + 1 = 3 跳，经 B；B：2 跳，经 A',packets:[packet('B','A','旧消息：2 跳')],changed:['A'],focus:['A'],loop:true});
    push({phase:'路由环路',title:'两个指路员，把包来回推给对方',description:'A 说“交给 B”，B 说“交给 A”。图上的数据包开始绕圈，却永远到不了 N。真实 IP 数据包最终会因 TTL 用尽而被丢弃，环路不会让同一个包永久转发。',formula:'A → B → A → B → A；目的地仍然不可达',packets:sequence(['A','B','A','B','A']),loop:true});
    let from = 'A', to = 'B';
    while (routes.A.metric < 16 || routes.B.metric < 16) {
      const reported = routes[from].metric;
      const before = routes[to].metric;
      routes[to] = receiveRip(routes[to],from,reported);
      const metric = routes[to].metric;
      push({phase:metric < 16?'数到无穷':'终于不可达',title:metric < 16 ? `${to} 又把距离从 ${before} 改成 ${metric} 跳` : `${to} 收到通告，终于把 N 标记为不可达`,description:metric < 16 ? `${from} 报告 ${reported} 跳，${to} 再加 1。虽然距离变长，但 ${from} 正是 ${to} 当前依赖的下一跳，所以 ${to} 必须更新；双方仍把旧信息当成可用路线。` : 'RIP 把 16 定义为“无穷大 / 不可达”，不是一条还能走的 16 跳路线。距离达到 16 后，这条路线停止用于转发。',formula:`${to}：min(16, ${reported} + 1) = ${metric}${metric===16?'，停止转发':` 跳；下一跳 = ${from}`}`,packets:[packet(from,to,`到 N：${reported} 跳`)],changed:[to],focus:[to],loop:routes.A.metric<16&&routes.B.metric<16});
      [from,to] = [to,from];
    }
    push({phase:'终于收敛',title:'坏消息终于传开：两边都知道走不通',description:'慢的不是报文移动速度，而是旧路线造成的反复误判。双方花了许多次更新，才把距离“数”到不可达。切换上方“毒性逆转对照”，重看同一次故障。',formula:'RIP：有效距离最多 15；16 表示不可达'});
    return {frames:out,milestones:[['原来的路线',0],['链路断开',1],['互相误导',3],['逐次加 1',7],['数到 16',out.length-1]]};
  }

  function ospfFrames(failure) {
    const out = [], original = dijkstra(OSPF_NODES,OSPF_LINKS,'A');
    const oldPath = pathTo(original.prev,'A','E');
    const links = failure ? OSPF_LINKS.filter(([a,b]) => edgeKey(a,b)!=='C-D') : OSPF_LINKS;
    let broken = false, known = [], mapReady = false;
    const push = f => out.push({broken,known:[...known],mapReady,packets:[],path:[],settled:[],dist:null,prev:{},...f});
    if (failure) {
      push({phase:'原来的路线',title:'原先，A 到 E 的最小开销是 6',description:'沿着绿色路线，开销相加是 2 + 1 + 1 + 2 = 6。现在切断其中的 C—D，看看 OSPF 怎样找到另一条路。',formula:'A → B → C → D → E，总开销 6',path:oldPath,dist:original.dist,prev:original.prev,settled:OSPF_NODES,mapReady:true,known:OSPF_NODES});
      broken = true; known = ['C','D'];
      push({phase:'检测到变化',title:'C 和 D 首先发现：这条链路断了',description:'端点生成更新的 LSA（链路状态通告），告诉邻居自己的连接发生了变化。其他路由器此时还没完成地图更新。',formula:'旧路线 A → B → C × D → E 已失效',focus:['C','D'],path:oldPath});
    } else {
      push({phase:'认识地图',title:'每台路由器，先认识自己身边的路',description:'路由器先通过 Hello 发现邻居，再建立邻接、同步链路状态。为看清接力过程，接下来只跟踪 A 的一份 LSA；其他路由器也会通告自己的链路。',formula:'A 的本地地图：A—B 开销 2，A—C 开销 5',focus:['A']});
      known = ['A'];
      push({phase:'生成通告',title:'A 把身边的连接写成一张“地图碎片”',description:'这份 LSA 介绍的是 A 连着谁、每条链路开销是多少，而不是“我离每个目的地有多远”。右侧小格跟踪哪些路由器已收到这份通告。',formula:'被跟踪的通告：LSA(A)，带有序列号供新旧判断',focus:['A']});
    }
    // Follow one origin's LSA using breadth-first forwarding; duplicate copies are omitted.
    // On failure C's updated LSA is tracked; D independently originates its own update.
    let holders = new Set([failure?'C':'A']), frontier = [...holders];
    while (holders.size < OSPF_NODES.length) {
      const transfers = [], next = [];
      for (const from of frontier) for (const [a,b] of links) {
        const to = a===from?b:b===from?a:null;
        if (!to || holders.has(to)) continue;
        holders.add(to); next.push(to); transfers.push(packet(from,to,failure?'C 的新 LSA':'A 的 LSA'));
      }
      if (!next.length) break;
      frontier = next;
      known = [...new Set([...holders,...(failure?['D']:[])])];
      push({phase:'泛洪接力',title:`${next.join('、')} 收到通告，再接力传给邻居`,description:failure?'蓝色消息沿仍可用的链路传播，逐步让区域内的路由器获知变化。这里跟踪 C 的新 LSA；D 同时也会通告自己的变化。重复收到的旧副本不会无限转发。':'每个接收者保存新通告，再转发给其他邻居。一份本地信息就这样扩散到整个区域。这里省略重复副本与确认报文，只展示首次到达。',formula:`已获知${failure?'故障':'A 的连接'}：${known.join('、')}`,packets:transfers,focus:next});
    }
    mapReady = true; known = [...OSPF_NODES];
    push({phase:'地图同步',title:failure?'大家在地图上删去断路，重新开始计算':'收齐所有人的通告，拼出同一张地图',description:failure?'同一区域内完成链路状态数据库同步后，每台路由器都基于新地图算路。接下来展示 A 的计算过程，C—D 不再参与。':'A、B、C、D、E 各自的 LSA 都完成传播后，同一区域的路由器具有一致的链路状态数据库。每台路由器独立算路；我们只跟踪 A。',formula:'初始化：到自己 A 的开销 = 0；到其他节点 = ∞',dist:{A:0,B:Infinity,C:Infinity,D:Infinity,E:Infinity}});
    const calcStart = out.length;
    const result = dijkstra(OSPF_NODES,links,'A');
    for (const step of result.steps) {
      const equations = step.relaxed.map(r=>`${r.to}：${number(r.old)} → ${number(step.dist[r.to])}（经 ${r.from}：${step.dist[r.from]} + ${r.cost}）`);
      push({phase:'Dijkstra 算路',title:`确认 ${step.node}：当前未确认节点里，开销 ${step.dist[step.node]} 最小`,description:step.node==='A'?'从 A 出发，把 A 标记为已确认。试着沿 A 的每一条可用链路，更新邻居的暂定开销。':`到 ${step.node} 的最小开销已经确定，再检查经过它能否改善尚未确认的邻居。${step.relaxed.length?'更小的候选值会替换旧值。':'所有节点均已确认，计算结束。'}`,formula:equations.join('；') || `确认完成：A 到 E 的最小总开销 = ${result.dist.E}`,dist:step.dist,prev:step.prev,settled:step.settled,focus:[step.node],changed:step.relaxed.filter(x=>x.improved).map(x=>x.to),packets:step.relaxed.map(r=>packet(r.from,r.to,`候选 ${r.candidate}`,'calc'))});
    }
    const path = pathTo(result.prev,'A','E');
    push({phase:failure?'切换到新路线':'按最短路转发',title:failure?'新路线找到了：绕过断路，到达 E':'最短，说的是总开销最小',description:failure?'新路线 A → B → D → E 的总开销是 10，虽然比原来的 6 更大，但它确实可以到达。链路状态变化传开后，就能据此重新选路。':'A → C → E 只经过 2 条链路，却花费 5 + 8 = 13。绿色路线经过 4 条链路，总开销只有 6，所以 OSPF 选择它。跳数少，不一定开销小。',formula:`${path.join(' → ')}；总开销 ${result.dist.E}${failure?'（原来 6）':''}`,dist:result.dist,prev:result.prev,settled:OSPF_NODES,path,packets:sequence(path),final:true});
    return {frames:out,milestones:[[failure?'原路线':'本地连接',0],[failure?'切断 C—D':'通告出发',1],['泛洪同步',2],['逐步算路',calcStart],['数据转发',out.length-1]]};
  }

  function isOspf() { return scene==='ospf'||scene==='repair'; }
  function topology() {
    if (isOspf()) return {nodes:OSPF_NODES,links:OSPF_LINKS};
    return scene==='bad'?{nodes:['N','A','B'],links:[['N','A',1],['A','B',1]]}:{nodes:['N','A','B','C','D'],links:[['N','A',1],['A','B',1],['B','C',1],['C','D',1]]};
  }
  function svgElement(name,attrs={},text) {
    const el = document.createElementNS(NS,name);
    for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
    if(text!==undefined) el.textContent=text;
    return el;
  }
  function layout() {
    width=$('network').clientWidth; height=$('network').clientHeight;
    $('graph').setAttribute('viewBox',`0 0 ${width} ${height}`);
    const narrow=width<480;
    if (isOspf()) {
      const x1=narrow?width*.13:width*.12,x2=narrow?width*.44:width*.37,x3=narrow?width*.76:width*.64,x4=narrow?width*.87:width*.88;
      positions = narrow ? {A:[x1,170],B:[x2,66],C:[x2,256],D:[x3,141],E:[x4,282]} : {A:[x1,162],B:[x2,70],C:[x2,245],D:[x3,90],E:[x4,217]};
    } else if(scene==='bad') {
      positions=narrow?{N:[width*.22,72],A:[width*.35,217],B:[width*.8,217]}:{N:[width*.17,147],A:[width*.5,147],B:[width*.83,147]};
    } else {
      positions=narrow?{N:[width*.17,73],A:[width*.5,73],B:[width*.83,73],C:[width*.7,239],D:[width*.25,239]}:Object.fromEntries(['N','A','B','C','D'].map((n,i)=>[n,[width*(.1+i*.2),145]]));
    }
    const {nodes,links}=topology();
    $('edges').replaceChildren(); $('nodes').replaceChildren();
    for(const [a,b,cost] of links){
      const [x1,y1]=positions[a],[x2,y2]=positions[b];
      const group=svgElement('g',{'data-edge':edgeKey(a,b)});
      group.append(svgElement('line',{x1,y1,x2,y2,class:'edge'}));
      if(isOspf()) group.append(svgElement('text',{x:(x1+x2)/2+(a==='B'&&b==='C'?14:0),y:(y1+y2)/2-10,class:'edge-label','text-anchor':'middle'},cost));
      group.append(svgElement('text',{x:(x1+x2)/2,y:(y1+y2)/2+7,class:'break-cross',visibility:'hidden'},'×'));
      $('edges').append(group);
    }
    for(const node of nodes){
      const [x,y]=positions[node];
      const group=svgElement('g',{class:'node','data-node':node,transform:`translate(${x} ${y})`});
      group.append(svgElement('circle',{r:28,class:'node-ring'}));
      group.append(node==='N'?svgElement('rect',{x:-26,y:-23,width:52,height:46,rx:8,class:'node-shell'}):svgElement('circle',{r:25,class:'node-shell'}));
      group.append(svgElement('text',{class:'node-name',y:-1},node));
      group.append(svgElement('text',{class:'node-detail',y:47},node==='N'?'目的网络':`路由器 ${node}`));
      group.append(svgElement('text',{class:'node-metric',y:66},''));
      $('nodes').append(group);
    }
  }

  function drawState(f) {
    const routeEdges=(f.path||[]).slice(1).map((n,i)=>edgeKey(f.path[i],n));
    for(const group of $('edges').children){
      const key=group.dataset.edge,broken=f.broken&&key===(isOspf()?'C-D':'A-N');
      group.querySelector('line').setAttribute('class',`edge${broken?' broken':routeEdges.includes(key)?' active':''}`);
      group.querySelector('.break-cross').setAttribute('visibility',broken?'visible':'hidden');
    }
    for(const group of $('nodes').children){
      const n=group.dataset.node,route=f.routes?.[n],d=f.dist?.[n];
      group.setAttribute('class',`node${f.settled?.includes(n)?' confirmed':''}${f.focus?.includes(n)?' focus':''}${route?.metric===16?' alert':''}`);
      group.querySelector('.node-metric').textContent=route?`${route.metric===16?'16 · 不可达':`${route.metric} 跳`}`:d!==undefined?`开销 ${number(d)}`:'';
    }
    $('route-arrows').replaceChildren();
    if(f.loop){
      for(const [from,to,offset] of [['A','B',-17],['B','A',17]]){
        const [x1,y1]=positions[from],[x2,y2]=positions[to];
        const direction=Math.sign(x2-x1);
        $('route-arrows').append(svgElement('path',{d:`M ${x1+direction*31} ${y1+offset} Q ${(x1+x2)/2} ${y1+offset*3} ${x2-direction*33} ${y2+offset}`,class:'forward-arrow'}));
      }
    }
    renderTable(f); renderExtra(f);
  }
  function renderTable(f) {
    const ospf=isOspf();
    $('table-title').textContent=ospf?'A 的最短路径计算表':'到目的网络 N 的路由表';
    $('table-hint').textContent=ospf?'暂定值可以变小；确认后不再改变':'下一跳 = 数据包先交给谁';
    let rows;
    if(ospf){
      rows=OSPF_NODES.map(n=>{
        const settled=f.settled?.includes(n),path=f.dist?pathTo(f.prev||{},'A',n):[];
        return `<tr class="${settled?'settled ':''}${f.changed?.includes(n)?'changed':''}"><td>${n}</td><td>${f.dist?number(f.dist[n]):'—'}</td><td>${n==='A'?'自己':path[1]||'—'}</td><td>${settled?'✓ 已确认':f.dist?'暂定':'待算路'}</td></tr>`;
      });
    } else rows=Object.entries(f.routes).map(([n,r])=>`<tr class="${r.metric===16?'invalid ':''}${f.changed?.includes(n)?'changed':''}"><td>${n}</td><td>${r.metric===16?'16（不可达）':`${r.metric} 跳`}</td><td>${r.via||'—'}</td></tr>`);
    $('route-table').innerHTML=`<table class="route-table"><thead><tr><th>${ospf?'目的节点':'路由器'}</th><th>${ospf?'总开销':'到 N 距离'}</th><th>下一跳</th>${ospf?'<th>状态</th>':''}</tr></thead><tbody>${rows.join('')}</tbody></table><p class="table-note">${ospf?'∞：暂时还没有找到路线。':'16 是 RIP 的不可达标记，有效距离最多为 15。'}</p>`;
  }
  function renderExtra(f) {
    $('state-extra').className='state-extra';
    if(scene==='bad'){
      const h=f.history||[], chartWidth=260, chartHeight=105;
      const points=key=>h.map((p,i)=>`${i?'L':'M'} ${14+i/Math.max(frames.length-1,1)*226} ${84-p[key]/16*66}`).join(' ');
      $('state-extra').innerHTML=`<div class="metric-strip"><span>RIP 的不可达标记</span><strong>16</strong></div><p class="table-note">${$('poison').checked?'已开启毒性逆转：阻止本例的双方误导。':'关闭防环机制：观察 A、B 的距离逐渐增大。'}</p><svg class="mini-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="A 与 B 到网络 N 的距离随通告变化，16 表示不可达"><path d="M14 18H244" stroke="#d9ba87" stroke-dasharray="3 4"/><text x="246" y="21">16</text><path d="${points('A')}" stroke="#2563eb"/><path d="${points('B')}" stroke="#059669"/><text x="14" y="102">最初</text><text x="207" y="102">更新过程</text></svg><p class="table-note">蓝线 A · 绿线 B<br>${f.loop?'当前下一跳：A → B，B → A，形成环路。':f.broken?'物理链路断开后，N 始终不可达。':'正常路线：B → A → N。'}</p>`;
    } else if(isOspf()) {
      $('state-extra').innerHTML=`<h3 style="font-size:12px">${f.mapReady?'链路状态数据库已同步':scene==='repair'?'哪些路由器已获知断路？':'哪些路由器收到 A 的 LSA？'}</h3><div class="lsa-row">${OSPF_NODES.map(n=>`<div class="lsa-cell ${f.known.includes(n)?'known':''}">${n}<br>${f.known.includes(n)?'✓':'待收'}</div>`).join('')}</div><p class="table-note">${f.mapReady?'大家拥有同一张地图，各自独立算路。':'这里只跟踪一份通告；完整地图需要所有路由器的通告。'}</p>${f.path?.length?`<div class="path-summary">${f.path.join(' → ')}<br>${f.dist?`总开销 ${f.dist.E}`:'旧路线已断开'}</div>`:''}<p class="table-note">Dijkstra 中移动的“候选”标记表示 A 内部的计算顺序，不是新的网络报文。</p>`;
    } else {
      $('state-extra').innerHTML=`<div class="path-summary">邻居报告的距离 + 1<br>= 经过邻居的距离</div><p class="table-note">好消息：有更短的路，就换过去。<br>坏消息：当前下一跳说变远了，也要跟着改。<br><br>蓝色是学习路线的通告，绿色是按路线转发的数据包。</p>`;
    }
  }

  function renderText() {
    const f=frames[index];
    $('phase').textContent=f.phase; $('step-kicker').textContent=`第 ${index+1} 步 / 共 ${frames.length} 步`;
    $('step-title').textContent=f.title; $('step-description').textContent=f.description; $('formula').textContent=f.formula||'';
    $('insight').className=`insight${scene==='bad'&&f.broken?' warning':''}`;
    $('seek').value=index; $('progress').textContent=`${index+1} / ${frames.length}`;
    $('prev').disabled=index===0; $('next').disabled=index===frames.length-1;
    $('play').textContent=playing?'Ⅱ 暂停':index===frames.length-1&&!motion?'↺ 重新播放':'▶ 自动播放';
    const active=milestones.reduce((best,entry,i)=>entry[1]<=index?i:best,0);
    [...$('milestones').children].forEach((el,i)=>el.classList.toggle('current',i===active));
  }
  function makePackets(f) {
    $('packets').replaceChildren();
    packetElements=(f.packets||[]).map(p=>{
      const group=svgElement('g',{opacity:0});
      group.append(svgElement('circle',{r:p.type==='data'?7:6,class:`packet-dot${p.type==='data'?' data':''}`}));
      group.append(svgElement('text',{y:-20,class:`packet-label${p.type==='data'?' data':''}`},p.label));
      $('packets').append(group); return {group,...p};
    });
  }
  function paintPackets(t) {
    for(const p of packetElements){
      const start=p.start||0,end=p.end||1;
      const progress=Math.max(0,Math.min(1,(t-start)/(end-start)));
      const ease=window.gsap?window.gsap.parseEase('power2.inOut'):x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
      const v=ease(progress), [x1,y1]=positions[p.from], [x2,y2]=positions[p.to];
      const offset=p.type==='data'&&frames[index].loop?(x2>x1?-28:28):0;
      p.group.setAttribute('transform',`translate(${x1+(x2-x1)*v} ${y1+(y2-y1)*v+Math.sin(v*Math.PI)*offset})`);
      p.group.setAttribute('opacity',t>=start&&t<end?1:0);
    }
  }
  function cancelMotion() {cancelAnimationFrame(raf);raf=0;motion=null;lastTime=0;$('packets').replaceChildren();packetElements=[];}
  function tick(now) {
    if(!motion) return;
    const delta=lastTime?Math.min(now-lastTime,100):0;lastTime=now;
    motion.elapsed+=delta*Number($('speed').value);
    const duration=reduced.matches?900:4600, progress=Math.min(1,motion.elapsed/duration);
    // Travel first, commit on arrival, then leave time to read the new state.
    const arrival=reduced.matches?.72:.42;
    if(!reduced.matches) paintPackets(Math.min(1,progress/arrival));
    if(progress>=arrival&&!motion.committed){motion.committed=true;drawState(frames[index]);}
    if(progress>=1){
      motion=null;lastTime=0;$('packets').replaceChildren();
      if(playing&&index<frames.length-1) go(index+1,true);
      else {playing=false;renderText();}
      return;
    }
    raf=requestAnimationFrame(tick);
  }
  function go(target,animate=false) {
    const before=frames[index];cancelMotion();index=Math.max(0,Math.min(frames.length-1,target));
    const current=frames[index];renderText();
    if(animate){
      drawState({...current,routes:before.routes||current.routes,dist:before.dist,prev:before.prev||{},settled:before.settled||[],known:before.known||[],mapReady:before.mapReady,changed:[],history:before.history,path:[],loop:before.loop});
      makePackets(current);motion={elapsed:0,committed:false};raf=requestAnimationFrame(tick);
    }else drawState(current);
  }
  function togglePlay(){
    if(playing){playing=false;cancelAnimationFrame(raf);raf=0;lastTime=0;}
    else{
      playing=true;
      if(motion)raf=requestAnimationFrame(tick);
      else if(index===frames.length-1){go(0);go(1,true);}
      else go(index+1,true);
    }
    renderText();
  }
  function selectScene(next){
    playing=false;cancelMotion();scene=next;index=0;
    const build=scene==='rip'?ripFrames():scene==='bad'?badFrames($('poison').checked):ospfFrames(scene==='repair');
    frames=build.frames;milestones=build.milestones;
    document.querySelectorAll('[data-scene]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scene===scene)));
    const meta=metadata[scene];$('scene-title').textContent=meta.title;$('graph-caption').textContent=meta.caption;
    $('protocol').textContent=isOspf()?'OSPF':'RIP';$('protocol').className=`protocol${isOspf()?' ospf':''}`;
    $('rule-title').textContent=meta.rule;$('rule-text').textContent=meta.text;$('poison-control').hidden=scene!=='bad';
    $('seek').max=frames.length-1;
    $('milestones').replaceChildren(...milestones.map(([label,step])=>{
      const b=document.createElement('button');b.textContent=label;b.addEventListener('click',()=>{playing=false;go(step);});return b;
    }));
    layout();go(0);
  }
  document.querySelectorAll('[data-scene]').forEach(b=>b.addEventListener('click',()=>selectScene(b.dataset.scene)));
  $('poison').addEventListener('change',()=>selectScene('bad'));
  $('play').addEventListener('click',togglePlay);
  $('next').addEventListener('click',()=>{playing=false;go(index+1,true);});
  $('prev').addEventListener('click',()=>{playing=false;go(index-1);});
  $('reset').addEventListener('click',()=>{playing=false;go(0);});
  $('seek').addEventListener('input',()=>{playing=false;go(Number($('seek').value));});
  document.addEventListener('keydown',e=>{
    if(e.target.closest('button,input,select,summary,a'))return;
    if(e.code==='Space'){e.preventDefault();togglePlay();}
    if(e.code==='ArrowRight'&&index<frames.length-1){e.preventDefault();playing=false;go(index+1,true);}
    if(e.code==='ArrowLeft'&&index>0){e.preventDefault();playing=false;go(index-1);}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){playing=false;cancelAnimationFrame(raf);raf=0;lastTime=0;renderText();}});
  new ResizeObserver(()=>{if(!frames.length)return;const wasPlaying=playing;playing=false;layout();go(index);if(wasPlaying)togglePlay();}).observe($('network'));
  selectScene('rip');
})();
