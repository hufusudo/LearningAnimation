(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const M = window.SurfaceFluxModel;
  const CHAPTERS = ['水怎样穿过','放大一小块','为什么看影子','把小块加起来'];
  const STARTS = [0,5,7,12];
  const BLUE = 0x2563eb, RED = 0xdc4b48, GREEN = 0x059669, GOLD = 0xd97706;
  const COLORS = { p:RED, q:GREEN, r:BLUE };
  const State = { index:0, playing:false, speed:1, model:'paraboloid', channel:'r', manualOrientation:false,
    reduced:window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  const V = { flat:1, macro:0, micro:0, theta:0, side:1, normal:0, xy:0, yz:0, zx:0, rays:0, sum:0, particles:1 };
  // Each scene has one question, one geometric change, and one observation.
  const LESSON = [
    { chapter:0,title:'通量，到底在数什么？',description:'想象一张薄网。我们只数单位时间内穿过它的水。',
      cue:'穿过去的才算。这里的“通量”是每单位时间穿过的水量。',theta:0,normal:0 },
    { chapter:0,title:'网变斜了，穿过的水会怎样？',description:'水流方向不变，慢慢把这张网倾斜。',
      cue:'网没有变小，但正对水流的有效截面变小了。',theta:55,xy:0.5 },
    { chapter:0,title:'如果水只是擦着网流过呢？',description:'继续转到 90°：水流现在平行于网。',
      cue:'擦边流过不算穿过。这时通量是 0。',theta:90,xy:0.5 },
    { chapter:0,title:'穿过还要分“正”和“负”？',description:'金箭头只做一件事：规定哪个穿过方向算正。',
      cue:'沿金箭头穿过记正；朝相反方向穿过记负。',theta:55,normal:1 },
    { chapter:0,title:'只翻转金箭头，水倒流了吗？',description:'盯住蓝色水流：它继续从下往上流。',
      cue:'水没有倒流。只是正方向翻转，同一份通量变成负数。',theta:55,side:-1,normal:1 },
    { chapter:1,title:'弯曲的网，每处倾斜都一样吗？',description:'不同位置朝向不同，不能用一个夹角描述整张网。',
      cue:'先选一小块，算它穿过的水；其余小块稍后用同样的方法算。',macro:0.42,micro:1,normal:0,cam:'macro',channel:'all' },
    { chapter:1,title:'把这一小块放大看',description:'小块取得足够小，就能近似看成一张平直的斜网。',
      cue:'下面只研究这一小块。dS 就是它的小片面积。',micro:1,normal:1,cam:'close',channel:'r' },
    { chapter:2,title:'先只看竖直方向的水',description:'暂时放下其他方向，盯住这一组蓝色水柱。',
      cue:'这组水沿 z 方向流，流速分量记作 R。',micro:1,cam:'projection',channel:'r' },
    { chapter:2,title:'为什么可以改看地上的影子？',description:'沿着水柱向底面投影，让影子对应这张小斜网。',
      cue:'穿过小片和底面影子的是同一组水柱，水量相同。',micro:1,xy:0.6,rays:1,cam:'projection',channel:'r' },
    { chapter:2,title:'横向来的水，要看哪一面影子？',description:'现在只看沿 x 方向流动的红色分量 P。',
      cue:'正对红色水流的是侧面影子 dy dz，而不是底面。',micro:1,yz:0.6,rays:1,cam:'red',channel:'p' },
    { chapter:2,title:'另一个横向方向，也用同样的方法',description:'换成沿 y 方向流动的绿色分量 Q。',
      cue:'正对绿色水流的影子是 dz dx。每个方向各看自己的影子。',micro:1,zx:0.6,rays:1,cam:'green',channel:'q' },
    { chapter:2,title:'把三个方向的贡献加在一起',description:'这是同一股水流的三个分量，分开看后再合并。',
      cue:'红色一份 + 绿色一份 + 蓝色一份 = 这一小块的净通量。',micro:1,xy:0.4,yz:0.4,zx:0.4,rays:0.4,cam:'projection',channel:'all' },
    { chapter:3,title:'回到整张网：每一块都这样算',description:'现在把整张网划成 64 个小块。',
      cue:'小块的朝向不同，各自计算穿过的水量。',macro:0.52,cam:'macro',channel:'all' },
    { chapter:3,title:'一份一份，把小块的通量加起来',description:'高亮走到哪一块，就把那一块的有符号通量加入总和。',
      cue:'沿正方向穿过的加上，反向穿过的减去。',macro:0.52,sum:1,cam:'macro',channel:'all',hold:10 },
    { chapter:3,title:'这就是第二类曲面积分',description:'让小块越来越细，近似和的极限，就是整张曲面的净通量。',
      cue:'先分小块，算每块穿过多少，再全部相加。公式就是这个过程的简写。',macro:0.52,sum:1,cam:'macro',channel:'all',hold:8 }
  ];
  let scene,camera,renderer,controls,timeline,viewTween,patchData,macroCells=[];
  let flat,flatEdge,flatGrid,flatShadow,patchMesh,patchEdge,macroGroup,macroWire;
  let normalArrow,flowArrows={},shadowMeshes={},shadowEdges={},connectors={};
  let points,pointPositions,pointColors,pipeLines,axesGroup,scanArrow;
  let labelItems=[],lastTime=0,lastSum=-1,formulaKey='',frameId,viewportScale=0;
  const PARTICLE_COUNT=144;
  const vec = a => new THREE.Vector3(a[0],a[1],a[2]);

  function disposeGroup(group) {
    group.traverse(object => {
      if(object.geometry) object.geometry.dispose();
      if(object.material) {
        const materials=Array.isArray(object.material)?object.material:[object.material];
        materials.forEach(material=>material.dispose());
      }
    });
    group.clear();
  }
  function geometry(vertices) {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flat(),3));
    g.setIndex([0,1,2,0,2,3]); g.computeVertexNormals(); return g;
  }
  function writePositions(g,values) {
    const existing=g.getAttribute('position');
    if(existing&&existing.array.length===values.length) {
      existing.array.set(values); existing.needsUpdate=true;
    } else g.setAttribute('position',new THREE.Float32BufferAttribute(values,3));
  }
  function face(vertices,color,opacity=0.6) {
    return new THREE.Mesh(geometry(vertices),new THREE.MeshBasicMaterial({
      color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false
    }));
  }
  function outline(vertices,color) {
    const g=new THREE.BufferGeometry().setFromPoints(vertices.concat([vertices[0]]).map(vec));
    return new THREE.Line(g,new THREE.LineBasicMaterial({color,transparent:true,opacity:0.8}));
  }
  function initializeThree() {
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(38,1,0.05,80);
    camera.up.set(0,0,1);
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    $('stage').appendChild(renderer.domElement);
    controls=new THREE.OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true; controls.dampingFactor=0.08;
    controls.minDistance=0.8; controls.maxDistance=12; controls.enablePan=false;
    controls.addEventListener('start',()=>pause(true));
    const corners=[[-0.7,-0.7,0],[0.7,-0.7,0],[0.7,0.7,0],[-0.7,0.7,0]];
    flat=face(corners,0x7dd3fc,0.65); flat.position.set(1,1,1);
    flatEdge=outline(corners,0x0284c7); flat.add(flatEdge);
    const gridPoints=[];
    for(let t=-0.7;t<=0.701;t+=0.175) gridPoints.push(-0.7,t,0,0.7,t,0,t,-0.7,0,t,0.7,0);
    flatGrid=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x0284c7,transparent:true,opacity:0.3}));
    flatGrid.geometry.setAttribute('position',new THREE.Float32BufferAttribute(gridPoints,3)); flat.add(flatGrid); scene.add(flat);
    flatShadow=face(corners,BLUE,0); flatShadow.frustumCulled=false; scene.add(flatShadow);
    patchMesh=face(corners,0x38bdf8,0); patchEdge=outline(corners,0x0284c7); scene.add(patchMesh,patchEdge);
    macroGroup=new THREE.Group(); scene.add(macroGroup);
    normalArrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),0.6,GOLD,0.13,0.065);
    scanArrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),0.24,GOLD,0.07,0.035);
    scene.add(normalArrow,scanArrow);
    for(const channel of ['p','q','r']) {
      const axis=channel==='p'?0:channel==='q'?1:2;
      const dir=new THREE.Vector3(); dir.setComponent(axis,1);
      const arrow=new THREE.ArrowHelper(dir,new THREE.Vector3(),0.75,COLORS[channel],0.14,0.065);
      flowArrows[channel]=arrow; scene.add(arrow);
      const name=channel==='p'?'yz':channel==='q'?'zx':'xy';
      shadowMeshes[name]=face(corners,COLORS[channel],0);
      shadowEdges[name]=outline(corners,COLORS[channel]);
      connectors[name]=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:COLORS[channel],transparent:true,opacity:0}));
      connectors[name].frustumCulled=false;
      scene.add(shadowMeshes[name],shadowEdges[name],connectors[name]);
    }
    axesGroup=new THREE.Group();
    [RED,GREEN,BLUE].forEach((color,i)=>{
      const direction=new THREE.Vector3(); direction.setComponent(i,1);
      axesGroup.add(new THREE.ArrowHelper(direction,new THREE.Vector3(),0.5,color,0.06,0.03));
    });
    scene.add(axesGroup);
    pointPositions=new Float32Array(PARTICLE_COUNT*3); pointColors=new Float32Array(PARTICLE_COUNT*3);
    const pointGeometry=new THREE.BufferGeometry();
    pointGeometry.setAttribute('position',new THREE.BufferAttribute(pointPositions,3));
    pointGeometry.setAttribute('color',new THREE.BufferAttribute(pointColors,3));
    const textureCanvas=document.createElement('canvas'); textureCanvas.width=32; textureCanvas.height=32;
    const ctx=textureCanvas.getContext('2d'); const gradient=ctx.createRadialGradient(16,16,0,16,16,15);
    gradient.addColorStop(0,'white'); gradient.addColorStop(0.55,'white'); gradient.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=gradient; ctx.fillRect(0,0,32,32);
    points=new THREE.Points(pointGeometry,new THREE.PointsMaterial({size:0.038,vertexColors:true,transparent:true,
      map:new THREE.CanvasTexture(textureCanvas),depthWrite:false,opacity:0.9}));
    points.frustumCulled=false; scene.add(points);
    pipeLines=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:0.24}));
    scene.add(pipeLines);
    rebuildSurface(); resize();
    new ResizeObserver(resize).observe($('stage'));
    window.addEventListener('resize',resize);
  }
  function rebuildSurface() {
    disposeGroup(macroGroup);
    patchData=M.patch(State.model);
    const vertices=patchData.vertices;
    patchMesh.geometry.dispose(); patchMesh.geometry=geometry(vertices);
    patchEdge.geometry.dispose(); patchEdge.geometry=new THREE.BufferGeometry().setFromPoints(vertices.concat([vertices[0]]).map(vec));
    for(const plane of ['xy','yz','zx']) {
      const axis=plane==='xy'?2:plane==='yz'?0:1;
      const projected=vertices.map(v=>v.map((value,i)=>i===axis?0.012:value));
      shadowMeshes[plane].geometry.dispose(); shadowMeshes[plane].geometry=geometry(projected);
      shadowEdges[plane].geometry.dispose(); shadowEdges[plane].geometry=new THREE.BufferGeometry().setFromPoints(projected.concat([projected[0]]).map(vec));
    }
    macroCells=M.cells(State.model);
    const edges=[];
    macroCells.forEach(cell=>{
      const x=cell.x,y=cell.y,d=cell.width;
      const vertices=[[x,y],[x+d,y],[x+d,y+d],[x,y+d]].map(v=>[v[0],v[1],M.surface(v[0],v[1],State.model).z]);
      cell.mesh=face(vertices,0x7dd3fc,0.4); macroGroup.add(cell.mesh);
      for(let i=0;i<4;i++) edges.push(...vertices[i],...vertices[(i+1)%4]);
    });
    macroWire=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x0284c7,transparent:true,opacity:0.3}));
    macroWire.geometry.setAttribute('position',new THREE.Float32BufferAttribute(edges,3));
    macroGroup.add(macroWire); lastSum=-1; formulaKey='';
    rebuildStreams();
  }
  function sampleRoof(u,v) {
    const origin=vec(patchData.vertices[0]);
    return origin.add(vec(patchData.vertices[1]).sub(vec(patchData.vertices[0])).multiplyScalar(u))
      .add(vec(patchData.vertices[3]).sub(vec(patchData.vertices[0])).multiplyScalar(v));
  }
  function streamMax(axis) {
    if(State.index<5) return 2.25;
    if(State.index>=12) return axis===2?2.0:1.4;
    return Math.max(...patchData.vertices.map(v=>v[axis]))+0.28;
  }
  function rebuildStreams() {
    const positions=[],colors=[];
    const flatScene=State.index<5,macroScene=State.index>=12;
    const channels=flatScene?['r']:State.channel==='all'?['p','q','r']:[State.channel];
    channels.forEach(channel=>{
      const axis=channel==='p'?0:channel==='q'?1:2,color=new THREE.Color(COLORS[channel]);
      const rows=flatScene?4:3;
      for(let i=0;i<rows;i++) for(let j=0;j<rows;j++) {
        let p;
        if(flatScene) p=new THREE.Vector3(0.3+(i+0.5)*0.35,0.3+(j+0.5)*0.35,1);
        else if(macroScene) {
          const x=0.15+(i+0.5)/rows,y=0.15+(j+0.5)/rows;
          p=new THREE.Vector3(x,y,M.surface(x,y,State.model).z);
        } else p=sampleRoof((i+0.5)/rows,(j+0.5)/rows);
        const a=p.clone().setComponent(axis,-0.08),b=p.clone().setComponent(axis,streamMax(axis));
        positions.push(a.x,a.y,a.z,b.x,b.y,b.z); colors.push(color.r,color.g,color.b,color.r,color.g,color.b);
      }
    });
    pipeLines.geometry.dispose(); pipeLines.geometry=new THREE.BufferGeometry();
    pipeLines.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    pipeLines.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    updateParticles(0,true);
  }
  let particleClock=0;
  function updateParticles(dt,reset=false) {
    if(reset) particleClock=0; else particleClock+=dt*State.speed*0.55;
    const flatScene=State.index<5,macroScene=State.index>=12;
    for(let i=0;i<PARTICLE_COUNT;i++) {
      const type=flatScene?'r':['p','q','r'][i%3];
      const axis=type==='p'?0:type==='q'?1:2;
      const active=flatScene||State.channel==='all'||State.channel===type;
      const k=flatScene?i:Math.floor(i/3);
      const rows=flatScene?4:3;
      const u=(k%rows+0.5)/rows,v=(Math.floor(k/rows)%rows+0.5)/rows;
      let p;
      if(flatScene) p=new THREE.Vector3(0.3+u*1.4,0.3+v*1.4,1);
      else if(macroScene) p=new THREE.Vector3(0.15+u,0.15+v,M.surface(0.15+u,0.15+v,State.model).z);
      else p=sampleRoof(u,v);
      p.setComponent(axis,((k*0.317+particleClock*M.FIELD[type])%(streamMax(axis)+0.08))-0.08);
      if(!active) p.set(0,0,-1000);
      const offset=i*3;
      pointPositions[offset]=p.x; pointPositions[offset+1]=p.y; pointPositions[offset+2]=p.z;
      const crosses=flatScene?Math.abs(p.x-1)<=0.7*Math.abs(Math.cos(V.theta))+1e-5:true;
      const color=new THREE.Color(crosses?COLORS[type]:0xb6b3ad);
      pointColors[offset]=color.r; pointColors[offset+1]=color.g; pointColors[offset+2]=color.b;
    }
    points.geometry.attributes.position.needsUpdate=true; points.geometry.attributes.color.needsUpdate=true;
  }
  function goalCamera(kind) {
    const center=vec(patchData.center);
    let target,position;
    if(kind==='close') { target=center.clone(); position=center.clone().add(new THREE.Vector3(1.05,1,0.95)); }
    else if(kind==='projection') { target=new THREE.Vector3(0.55,0.6,0.75); position=new THREE.Vector3(3.4,3.0,2.5); }
    else if(kind==='red') { target=new THREE.Vector3(0.45,0.7,1); position=new THREE.Vector3(3.6,2.4,2.8); }
    else if(kind==='green') { target=new THREE.Vector3(0.7,0.45,1); position=new THREE.Vector3(2.4,3.6,2.8); }
    else if(kind==='macro') { target=new THREE.Vector3(0.65,0.65,1.1); position=new THREE.Vector3(3.1,2.9,3.3); }
    else { target=new THREE.Vector3(1,1,1); position=new THREE.Vector3(3.25,-3.5,3.5); }
    const aspect=$('stage').clientWidth/$('stage').clientHeight;
    const scale=Math.max(1,Math.sqrt(0.95/aspect));
    if(kind==='projection') position.sub(target).multiplyScalar(1.15).add(target);
    position.sub(target).multiplyScalar(scale).add(target);
    return {target,position};
  }
  function resize() {
    if(!renderer) return;
    const w=$('stage').clientWidth,h=$('stage').clientHeight;
    const scale=Math.max(1,Math.sqrt(0.95/(w/h)));
    if(viewportScale&&Math.abs(scale-viewportScale)>0.01) {
      pause(true); camera.position.sub(controls.target).multiplyScalar(scale/viewportScale).add(controls.target);
    }
    viewportScale=scale;
    camera.aspect=w/h; camera.setViewOffset(w,h,0,-32,w,h); camera.updateProjectionMatrix();
    renderer.setSize(w,h,false);
  }
  function opacity(object,value) {
    object.visible=value>0.001;
    if(object.material) object.material.opacity=value;
  }
  function updateVisual() {
    const flatScene=State.index<5;
    if(flatScene) {
      const inside=new THREE.Color(BLUE),outside=new THREE.Color(0xb6b3ad);
      const limit=0.7*Math.abs(Math.cos(V.theta))+1e-5;
      for(let i=0;i<PARTICLE_COUNT;i++) {
        const color=Math.abs(pointPositions[i*3]-1)<=limit?inside:outside;
        pointColors[i*3]=color.r; pointColors[i*3+1]=color.g; pointColors[i*3+2]=color.b;
      }
      points.geometry.attributes.color.needsUpdate=true;
      const pipePositions=pipeLines.geometry.getAttribute('position'),pipeColors=pipeLines.geometry.getAttribute('color');
      for(let i=0;i<pipePositions.count;i++) {
        const color=Math.abs(pipePositions.getX(i)-1)<=limit?inside:outside;
        pipeColors.setXYZ(i,color.r,color.g,color.b);
      }
      pipeColors.needsUpdate=true;
    }
    flat.rotation.y=V.theta;
    opacity(flat,V.flat*0.58); opacity(flatEdge,V.flat*0.95); opacity(flatGrid,V.flat*0.35);
    opacity(patchMesh,V.micro*0.8); opacity(patchEdge,V.micro*0.95);
    const roofColor=V.side<0?0xfda4af:0x7dd3fc;
    flat.material.color.setHex(roofColor); patchMesh.material.color.setHex(roofColor);
    const normal=flatScene?new THREE.Vector3(Math.sin(V.theta),0,Math.cos(V.theta)):vec(patchData.normal);
    const center=flatScene?new THREE.Vector3(1,1,1):vec(patchData.center);
    normal.multiplyScalar(V.side>=0?1:-1);
    normalArrow.position.copy(center); normalArrow.setDirection(normal);
    normalArrow.setLength(0.6*Math.max(0.001,Math.abs(V.side)),0.12,0.06); normalArrow.visible=V.normal>0.02;
    normalArrow.line.material.transparent=true; normalArrow.cone.material.transparent=true;
    normalArrow.line.material.opacity=V.normal; normalArrow.cone.material.opacity=V.normal;
    const flatVertices=[[-0.7,-0.7],[0.7,-0.7],[0.7,0.7],[-0.7,0.7]]
      .map(v=>[1+v[0]*Math.cos(V.theta),1+v[1],0.012]);
    writePositions(flatShadow.geometry,flatVertices.flat());
    opacity(flatShadow,flatScene?V.xy:0);
    for(const plane of ['xy','yz','zx']) {
      const alpha=flatScene?0:V[plane];
      opacity(shadowMeshes[plane],alpha); opacity(shadowEdges[plane],alpha>0?Math.min(1,alpha*2):0);
      const axis=plane==='xy'?2:plane==='yz'?0:1;
      const endpoints=[];
      patchData.vertices.forEach(v=>{
        const end=v.slice(); end[axis]=v[axis]+(0.012-v[axis])*V.rays;
        endpoints.push(...v,...end);
      });
      writePositions(connectors[plane].geometry,endpoints);
      opacity(connectors[plane],alpha>0?V.rays*0.6:0);
    }
    axesGroup.visible=!flatScene&&State.index>=7&&State.index<12;
    axesGroup.position.set(0,0,0);
    for(const channel of ['p','q','r']) {
      const arrow=flowArrows[channel],axis=channel==='p'?0:channel==='q'?1:2;
      arrow.visible=(flatScene?channel==='r':State.channel==='all'||State.channel===channel)&&V.particles>0.05;
      const origin=flatScene?new THREE.Vector3(0.12,1.0,0.2):vec(patchData.center);
      if(!flatScene) origin.setComponent(axis,-0.04);
      arrow.position.copy(origin);
      arrow.setLength(flatScene?1.45:0.62,0.13,0.06);
    }
    points.material.opacity=V.particles*0.95; pipeLines.material.opacity=V.particles*(flatScene?0.18:0.3);
    const completed=State.index>=13?Math.floor(Math.min(1,V.sum)*macroCells.length):0;
    macroCells.forEach((cell,i)=>{
      opacity(cell.mesh,V.macro*(completed>i?0.8:0.55));
      cell.mesh.material.color.setHex(i<completed?0x34d399:roofColor);
    });
    opacity(macroWire,V.macro);
    scanArrow.visible=State.index===13&&V.sum>0&&V.sum<1;
    if(scanArrow.visible) {
      const cell=macroCells[Math.min(completed,63)],x=cell.x+cell.width/2,y=cell.y+cell.width/2;
      const at=M.surface(x,y,State.model);
      scanArrow.position.set(x,y,at.z); scanArrow.setDirection(new THREE.Vector3(-at.fx,-at.fy,1).normalize().multiplyScalar(V.side>=0?1:-1));
    }
    $('angleValue').textContent=Math.round(V.theta*180/Math.PI)+'°';
    $('angleSlider').value=Math.round(V.theta*180/Math.PI);
    if(flatScene) {
      const proportion=Math.cos(V.theta)*(V.side>=0?1:-1);
      const amount=Math.abs(Math.cos(V.theta))*100;
      const oriented=State.index>=3||State.manualOrientation;
      $('quantityValue').textContent=oriented?(proportion>=0?'+':'−')+Math.round(Math.abs(proportion)*100)+'%':Math.round(amount)+'%';
      $('quantityLabel').textContent=oriented?'有方向的净通量':'穿过的水量';
      $('quantityChip').classList.toggle('negative',proportion<-0.001);
    }
    const sumKey=completed+'|'+(V.side>=0?1:-1)+'|'+State.channel;
    if(sumKey!==lastSum) {
      lastSum=sumKey;
      const sum=macroCells.slice(0,completed).reduce((n,cell)=>n+(State.channel==='all'?cell.values.net:cell.values[State.channel]),0)*(V.side>=0?1:-1);
      $('sumCount').textContent=completed+' / 64 块'; $('sumValue').textContent=sum.toFixed(3);
    }
    updateLabels();
    if($('mathDetails').open) renderFormula();
  }
  function labelDefinitions() {
    const index=State.index;
    if(index<3&&State.manualOrientation) return [
      {key:'normal',text:'规定的正方向',small:'沿箭头穿过记正',color:'#d97706',offset:[30,-30]},
      {key:'flow',text:'水流方向不变',color:'#2563eb',offset:[-145,0]}];
    if(index<3) return [{key:'roof',text:index===0?'这张薄网':'网的大小不变',color:'#0284c7',offset:[-155,10]},
      {key:'flow',text:'水流从下向上',color:'#2563eb',offset:[-125,-35]}].concat(index>0?[{key:'flatShadow',text:'正对水流的有效截面',small:index===2?'退成一条线':'看它怎样收窄',color:'#2563eb',offset:[50,20]}]:[]);
    if(index<5) return [{key:'normal',text:'规定的正方向',small:'沿箭头穿过记正',color:'#d97706',offset:[30,-30]},
      {key:'flow',text:'水流方向不变',color:'#2563eb',offset:[-145,0]}];
    if(index===5||index===6) return [{key:'roof',text:index===5?'选中的这一小块':'小片近似看作平网',small:index===6?'小片面积记作 dS':'其余部分暂时淡去',color:'#0284c7',offset:[60,25]}]
      .concat(index===6?[{key:'normal',text:'这小片的正方向',color:'#d97706',offset:[30,-30]}]:[]);
    if(index===7) return [{key:'roof',text:'小斜网 dS',color:'#0284c7',offset:[55,-20]},
      {key:'flow',text:'只看竖直水流 R',color:'#2563eb',offset:[-110,-30]}];
    if(index<11) {
      const plane=index===8?'xy':index===9?'yz':'zx';
      const words={xy:['底面影子','dx dy','#2563eb'],yz:['侧面影子','dy dz','#dc4b48'],zx:['另一侧面影子','dz dx','#059669']}[plane];
      return [{key:'roof',text:'还是这一小片',color:'#0284c7',offset:[55,-40]},
        {key:plane,text:words[0],small:words[1],color:words[2],offset:[plane==='xy'?-120:-140,28]}];
    }
    if(index===11) return [{key:'xy',text:'蓝色一份',small:'R dx dy',color:'#2563eb',offset:[40,25]},
      {key:'yz',text:'红色一份',small:'P dy dz',color:'#dc4b48',offset:[-150,-25]},
      {key:'zx',text:'绿色一份',small:'Q dz dx',color:'#059669',offset:[40,-20]}];
    return [{key:'scan',text:index===12?'每块分别计算':index===13?'把这一块加入总和':'64 块的近似和',color:'#059669',offset:[50,10]}];
  }
  function makeLabels() {
    $('labels').replaceChildren(); $('labelLines').replaceChildren();
    labelItems=labelDefinitions().map(def=>{
      const element=document.createElement('div'); element.className='object-label';
      element.style.setProperty('--label-color',def.color); element.textContent=def.text;
      if(def.small) { const small=document.createElement('small'); small.textContent=def.small; element.appendChild(small); }
      $('labels').appendChild(element);
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('stroke',def.color); line.setAttribute('stroke-width','1'); line.setAttribute('opacity','0.5');
      $('labelLines').appendChild(line);
      return {def,element,line};
    });
  }
  function anchor(key) {
    if(key==='flow') {
      const arrow=flowArrows[State.index<5?'r':State.channel==='all'?'r':State.channel];
      return arrow.position.clone().add(new THREE.Vector3(0,1,0).applyQuaternion(arrow.quaternion).multiplyScalar(0.6));
    }
    if(key==='flatShadow') return new THREE.Vector3(1,1,0.012);
    if(key==='roof') return State.index<5?new THREE.Vector3(1,1,1):vec(patchData.center);
    if(key==='scan') {
      const cell=macroCells[Math.min(63,Math.floor(V.sum*64))];
      const x=cell.x+cell.width/2,y=cell.y+cell.width/2; return new THREE.Vector3(x,y,M.surface(x,y,State.model).z);
    }
    const p=vec(patchData.center);
    p.setComponent(key==='xy'?2:key==='yz'?0:1,0.012); return p;
  }
  function updateLabels() {
    const w=$('stage').clientWidth,h=$('stage').clientHeight,occupied=[];
    for(const item of labelItems) {
      let point;
      if(item.def.key==='normal') point=normalArrow.position.clone().add(new THREE.Vector3(0,1,0).applyQuaternion(normalArrow.quaternion).multiplyScalar(0.6));
      else point=anchor(item.def.key);
      point.project(camera);
      const visible=point.z>=-1&&point.z<=1;
      item.element.style.visibility=visible?'visible':'hidden'; item.line.style.visibility=visible?'visible':'hidden';
      if(!visible) continue;
      const px=(point.x+1)*w/2,py=(1-point.y)*h/2;
      const width=item.element.offsetWidth,height=item.element.offsetHeight;
      const shift=w<500?0.6:1;
      let x=Math.max(10,Math.min(w-width-10,px+item.def.offset[0]*shift));
      let y=Math.max(144,Math.min(h-height-115,py+item.def.offset[1]));
      // Keep labels away from the small readout and from one another.
      if(State.index<5&&x+width>w-155&&y<238) y=240;
      for(const box of occupied) if(x<box.x+box.w+6&&x+width+6>box.x&&y<box.y+box.h+6&&y+height+6>box.y)
        y=Math.min(h-height-112,box.y+box.h+10);
      occupied.push({x,y,w:width,h:height});
      item.element.style.transform='translate('+Math.round(x)+'px,'+Math.round(y)+'px)';
      item.line.setAttribute('x1',px); item.line.setAttribute('y1',py);
      item.line.setAttribute('x2',x+Math.min(width,Math.max(0,px-x))); item.line.setAttribute('y2',y+height/2);
    }
  }
  function signed(value) { return (value>=0?'+':'')+value.toFixed(3); }
  function renderFormula() {
    if(!$('mathDetails').open) return;
    const side=V.side>=0?1:-1;
    let values,latex,explanation;
    if(State.index<5) {
      values={p:0,q:0,r:M.planeFlux(V.theta,side),net:M.planeFlux(V.theta,side)};
      latex='\\Phi=|\\mathbf F|\\,A\\cos\\theta';
      explanation='第一章只有竖直水流。这里 θ 是水流与所选单位法向之间的夹角；翻转法向会改变 cos θ 的符号。';
    } else if(State.index<12) {
      values=M.components(patchData.areaVector.map(v=>v*side));
      latex='d\\Phi=\\mathbf F\\cdot\\mathbf n\\,dS=P\\,dy\\,dz+Q\\,dz\\,dx+R\\,dx\\,dy';
      explanation='小片上三项的有向投影贡献相加。这里 dy dz、dz dx、dx dy 都带定向符号，影子本身的几何面积不为负。';
    } else {
      values=M.total(State.model,8,side);
      latex='\\Phi=\\iint_S\\mathbf F\\cdot\\mathbf n\\,dS=\\lim\\sum_i\\mathbf F_i\\cdot\\mathbf n_i\\,\\Delta S_i';
      explanation='画面累计的是 64 块的中点近似值；曲面越细分，近似和越接近积分。本演示取 x、y ∈ [0.15,1.15]。';
    }
    if(State.index>=5&&State.channel!=='all') {
      for(const channel of ['p','q','r']) if(channel!==State.channel) values[channel]=0;
      values.net=values.p+values.q+values.r;
      explanation+=' 当前仅开启 '+State.channel.toUpperCase()+' 分量。';
    }
    const key=State.index+'|'+State.model+'|'+side+'|'+State.channel+'|'+V.theta.toFixed(3);
    if(key===formulaKey) return; formulaKey=key;
    $('formulaExplanation').textContent=explanation;
    if(window.katex) katex.render(latex,$('formula'),{throwOnError:false,displayMode:false});
    else $('formula').textContent=State.index<5?'通量 = 水速 × 网面积 × 方向余弦':'净通量 = 每个小片的有符号通量之和';
    $('componentValues').replaceChildren();
    for(const [name,key] of [['P 项','p'],['Q 项','q'],['R 项','r'],['合计','net']]) {
      const span=document.createElement('span'); span.textContent=name+' '+signed(values[key]); $('componentValues').appendChild(span);
    }
  }
  function updateNavigation() {
    const current=LESSON[State.index];
    document.querySelectorAll('[data-chapter]').forEach(button=>{
      const active=Number(button.dataset.chapter)===current.chapter;
      button.classList.toggle('active',active); button.setAttribute('aria-current',active?'step':'false');
    });
    document.querySelectorAll('[data-scene]').forEach(button=>{
      const index=Number(button.dataset.scene);
      button.classList.toggle('active',index===State.index); button.classList.toggle('done',index<State.index);
      button.setAttribute('aria-current',index===State.index?'step':'false');
    });
    $('btnPrevious').disabled=State.index===0; $('btnNext').disabled=State.index===14;
    $('flatExperiment').hidden=State.index>=5; $('quantityChip').hidden=State.index>=5;
    $('sumChip').hidden=State.index<13; $('streamControl').hidden=State.index<5;
    $('btnFlipSurface').disabled=State.index<5;
    $('stage').dataset.scene=String(State.index); $('stage').dataset.playing=String(State.playing);
    $('btnPlay').textContent=State.playing?'Ⅱ 暂停动画':State.index===14&&(!timeline||timeline.progress()===1)?'↻ 再看一遍':'▶ 播放讲解';
  }
  function cancelAnimations() {
    if(timeline) { timeline.kill(); timeline=null; }
    if(viewTween) { viewTween.kill(); viewTween=null; }
    if(window.gsap) gsap.killTweensOf([V,camera.position,controls.target,'.scene-caption','.lesson-cue']);
  }
  function showScene(index,autoplay=false,instant=false) {
    cancelAnimations();
    State.index=Math.max(0,Math.min(14,index)); State.playing=autoplay; State.manualOrientation=false;
    const lesson=LESSON[State.index];
    State.channel=lesson.channel||'r'; $('streamSelect').value=State.channel;
    const target={flat:State.index<5?1:0,macro:lesson.macro||0,micro:lesson.micro||0,
      theta:(lesson.theta||0)*Math.PI/180,side:lesson.side||1,normal:lesson.normal||0,
      xy:lesson.xy||0,yz:lesson.yz||0,zx:lesson.zx||0,rays:lesson.rays||0,particles:1};
    const goal=goalCamera(lesson.cam);
    const present=()=>{
      $('sceneCount').textContent='第 '+(State.index+1)+' / 15 步 · '+CHAPTERS[lesson.chapter];
      $('sceneTitle').textContent=lesson.title; $('sceneDescription').textContent=lesson.description;
      $('stage').setAttribute('aria-label',lesson.description+' '+lesson.cue);
      $('lessonCue').textContent=lesson.cue;
      makeLabels(); rebuildStreams(); formulaKey=''; renderFormula();
    };
    lastSum=-1;
    if(State.index===13) V.sum=0;
    const duration=State.reduced?0.01:1.5;
    const token=State.index;
    timeline=gsap.timeline({paused:true,onComplete:()=>{
      if(State.index!==token) return;
      if(State.playing&&State.index<14) showScene(State.index+1,true);
      else { State.playing=false; updateNavigation(); }
    }});
    if(instant) {
      Object.assign(V,target); V.sum=lesson.sum||0;
      camera.position.copy(goal.position); controls.target.copy(goal.target); controls.update();
      present(); gsap.set(['.scene-caption','.lesson-cue'],{opacity:1,y:0});
    } else {
      timeline.to(['.scene-caption','.lesson-cue'],{opacity:0,y:-5,duration:0.15,ease:'power2.in'},0);
      timeline.call(present,[],0.16);
      timeline.to(V,Object.assign({},target,{duration,ease:'power2.inOut'}),0.16);
      timeline.to(camera.position,{x:goal.position.x,y:goal.position.y,z:goal.position.z,duration,ease:'power2.inOut'},0.16);
      timeline.to(controls.target,{x:goal.target.x,y:goal.target.y,z:goal.target.z,duration,ease:'power2.inOut'},0.16);
      timeline.to('.scene-caption',{opacity:1,y:0,duration:0.35,ease:'power4.out'},0.4);
      timeline.to('.lesson-cue',{opacity:1,y:0,duration:0.35,ease:'power4.out'},duration+0.2);
    }
    if(State.index===13&&!instant) {
      timeline.to(V,{sum:1,duration:State.reduced?0.01:7,ease:'none'},duration+0.2);
    } else {
      timeline.to(V,{sum:lesson.sum||0,duration:instant?0:duration,ease:'power2.out'},instant?0:0.16);
    }
    // Reading time belongs to the scene timeline, so pausing and speed changes stay exact.
    const hold={clock:0};
    timeline.to(hold,{clock:1,duration:lesson.hold||6.5,ease:'none'},instant?0:duration+0.55);
    timeline.timeScale(State.speed);
    updateNavigation();
    if(!instant||autoplay) timeline.play();
    updateVisual();
  }
  function pause(kill=false) {
    State.playing=false;
    if(kill) cancelAnimations();
    else { if(timeline) timeline.pause(); if(viewTween) viewTween.pause(); }
    // Pausing during a transition must still leave the current explanation readable.
    gsap.set(['.scene-caption','.lesson-cue'],{opacity:1,y:0});
    updateNavigation();
  }
  function play() {
    if(State.playing) { pause(); return; }
    if(State.index===14&&(!timeline||timeline.progress()===1)) { reset(); State.playing=true; timeline.play(); }
    else if(!timeline||timeline.progress()===1) showScene(State.index,true);
    else { State.playing=true; timeline.play(); }
    updateNavigation();
  }
  function reset() {
    State.model='paraboloid'; $('surfaceSelect').value=State.model;
    rebuildSurface(); showScene(0,false,true);
  }
  function changeView(view) {
    pause(true);
    const goal=goalCamera(LESSON[State.index].cam);
    if(view==='top') goal.position=goal.target.clone().add(new THREE.Vector3(0.01,-0.01,5.2));
    if(view==='side') goal.position=goal.target.clone().add(new THREE.Vector3(4.3,0.01,0.7));
    viewTween=gsap.timeline();
    viewTween.to(camera.position,{x:goal.position.x,y:goal.position.y,z:goal.position.z,duration:State.reduced?0:0.8,ease:'power2.out'},0)
      .to(controls.target,{x:goal.target.x,y:goal.target.y,z:goal.target.z,duration:State.reduced?0:0.8,ease:'power2.out'},0).timeScale(State.speed);
  }
  function bindEvents() {
    $('btnPlay').addEventListener('click',play);
    $('btnNext').addEventListener('click',()=>showScene(State.index+1));
    $('btnPrevious').addEventListener('click',()=>showScene(State.index-1));
    $('btnReset').addEventListener('click',reset);
    document.querySelectorAll('[data-chapter]').forEach(button=>button.addEventListener('click',()=>showScene(STARTS[Number(button.dataset.chapter)])));
    LESSON.forEach((lesson,index)=>{
      const button=document.createElement('button'); button.dataset.scene=index;
      button.title='第 '+(index+1)+' 步：'+lesson.title; button.setAttribute('aria-label',button.title);
      button.addEventListener('click',()=>showScene(index)); $('lessonProgress').appendChild(button);
    });
    $('speedSelect').addEventListener('change',event=>{
      State.speed=Number(event.target.value); if(timeline) timeline.timeScale(State.speed);
      if(viewTween) viewTween.timeScale(State.speed);
    });
    $('angleSlider').addEventListener('input',event=>{
      pause(true); State.manualOrientation=true; V.theta=Number(event.target.value)*Math.PI/180; V.xy=0.5; V.normal=1;
      formulaKey=''; $('lessonCue').textContent=Math.abs(Math.cos(V.theta))<0.001?'水流只擦边流过，通量为 0。':'观察影子宽度：正对水流的有效截面随倾斜改变。';
      makeLabels(); updateVisual();
    });
    function flip() {
      pause(true); V.normal=1;
      if(State.index<5) State.manualOrientation=true;
      const next=V.side>=0?-1:1;
      viewTween=gsap.to(V,{side:next,duration:State.reduced?0:0.8,ease:'power2.inOut',onComplete:()=>{
        formulaKey=''; renderFormula();
      }}).timeScale(State.speed);
      $('lessonCue').textContent='水流保持原方向，翻转金箭头会让通量正负号一起翻转。';
      makeLabels();
    }
    $('btnFlip').addEventListener('click',flip); $('btnFlipSurface').addEventListener('click',flip);
    $('surfaceSelect').addEventListener('change',event=>{
      pause(true); State.model=event.target.value; rebuildSurface(); makeLabels(); updateVisual(); renderFormula();
    });
    $('streamSelect').addEventListener('change',event=>{
      pause(true); State.channel=event.target.value; lastSum=-1; formulaKey='';
      if(State.index>=5&&State.index<12) {
        showScene({all:11,r:8,p:9,q:10}[State.channel]);
        return;
      }
      rebuildStreams(); updateVisual(); renderFormula();
    });
    document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>changeView(button.dataset.view)));
    $('mathDetails').addEventListener('toggle',()=>{ formulaKey=''; renderFormula(); });
    document.addEventListener('visibilitychange',()=>{ if(document.hidden) pause(); });
  }
  function animate(time) {
    frameId=requestAnimationFrame(animate);
    const dt=Math.min(0.05,(time-lastTime)/1000)||0; lastTime=time;
    const moving=(timeline&&!timeline.paused()&&timeline.progress()<1)||(viewTween&&viewTween.isActive());
    if(moving&&!State.reduced) updateParticles(dt);
    controls.update(); updateVisual(); renderer.render(scene,camera);
    $('stage').dataset.motion=moving?'running':'paused';
    $('stage').dataset.accumulated=String(Math.floor(V.sum*64));
  }
  function init() {
    try {
      if(!M||!window.THREE||!window.gsap||!THREE.OrbitControls) throw new Error('Animation dependency unavailable');
      initializeThree(); bindEvents(); showScene(0,false,true); frameId=requestAnimationFrame(animate);
      window.addEventListener('pagehide',()=>{ cancelAnimations(); cancelAnimationFrame(frameId); });
    } catch(error) {
      $('loadError').hidden=false; $('btnPlay').disabled=true; $('btnNext').disabled=true;
      console.error(error);
    }
  }
  init();
})();
