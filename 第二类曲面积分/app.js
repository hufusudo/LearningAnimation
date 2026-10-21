(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const M = window.SurfaceFluxModel;
  const C = window.SurfaceFluxChoreo;
  const { CHAPTERS, STARTS, LESSON } = C;
  const BLUE = 0x2563eb, RED = 0xdc4b48, GREEN = 0x059669, GOLD = 0xb97519;
  const COLORS = { p:RED, q:GREEN, r:BLUE };
  const State = { index:0, t:0, playing:false, speed:1, model:'paraboloid', channel:'r',
    manualOrientation:false, reduced:window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  const V = {};
  let frame, customView=false, experiment=null, filter=null, lastScene=-1, lastLabel=-1;
  let reducedTimer, resizeObserver, hasThree=false, lastComponentKey='', disposed=false;
  const clock = { t:0 };
  let scene,camera,renderer,controls,timeline,viewTween,patchData,macroCells=[];
  let flat,flatEdge,flatGrid,flatShadow,patchMesh,patchEdge,macroGroup,macroWire;
  let normalArrow,flowArrows={},shadowMeshes={},shadowEdges={},connectors={};
  let points,pointPositions,pointColors,pipeLines,axesGroup,scanArrow;
  let labelItems=[],lastSum=-1,formulaKey='',latexKey='',viewportScale=0;
  const PARTICLE_COUNT=144;
  const vec = a => new THREE.Vector3(a[0],a[1],a[2]);

  function disposeGroup(group) {
    group.traverse(object => {
      if(object.geometry) object.geometry.dispose();
      if(object.material) {
        const materials=Array.isArray(object.material)?object.material:[object.material];
        materials.forEach(material=>{ if(material.map) material.map.dispose();material.dispose(); });
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
    controls.enableDamping=false;
    controls.minDistance=0.8; controls.maxDistance=12; controls.enablePan=false;
    controls.addEventListener('start',()=>{ pause(); customView=true; });
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
    resizeObserver=new ResizeObserver(resize); resizeObserver.observe($('stage'));
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
  function streamRoof(u,v) {
    const x=0.15+u,y=0.15+v;
    const macro=new THREE.Vector3(x,y,M.surface(x,y,State.model).z);
    return sampleRoof(u,v).lerp(macro,Math.min(1,V.macro/.52))
      .lerp(new THREE.Vector3(.3+u*1.4,.3+v*1.4,1),V.flat);
  }
  function streamMax(axis) {
    const micro=Math.max(...patchData.vertices.map(v=>v[axis]))+.28;
    const macro=axis===2?2.0:1.4,k=Math.min(1,V.macro/.52);
    return (micro*(1-k)+macro*k)*(1-V.flat)+2.25*V.flat;
  }
  function streamColor(channel,p) {
    const color=new THREE.Color(COLORS[channel]);
    if(channel==='r'&&Math.abs(p.x-1)>.7*Math.abs(Math.cos(V.theta))+1e-5)
      color.lerp(new THREE.Color(0xb6b3ad),V.flat);
    return color.lerp(new THREE.Color(0xf5f6f1),1-V[channel+'w']);
  }
  function rebuildStreams() {
    const positions=[],colors=[];
    ['p','q','r'].forEach((channel,axis)=>{
      for(let i=0;i<3;i++) for(let j=0;j<3;j++) {
        const p=streamRoof((i+.5)/3,(j+.5)/3),color=streamColor(channel,p);
        const a=p.clone().setComponent(axis,-.08),b=p.clone().setComponent(axis,streamMax(axis));
        positions.push(...a.toArray(),...b.toArray()); colors.push(color.r,color.g,color.b,color.r,color.g,color.b);
      }
    });
    writePositions(pipeLines.geometry,positions);
    const attribute=pipeLines.geometry.getAttribute('color');
    if(attribute) { attribute.array.set(colors); attribute.needsUpdate=true; }
    else pipeLines.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  }
  function updateParticles(time) {
    const particleClock=State.reduced?0:time*.55;
    for(let i=0;i<PARTICLE_COUNT;i++) {
      const type=['p','q','r'][i%3],axis=i%3,k=Math.floor(i/3);
      const p=streamRoof((k%3+.5)/3,(Math.floor(k/3)%3+.5)/3);
      p.setComponent(axis,((k*.317+particleClock*M.FIELD[type])%(streamMax(axis)+.08))-.08);
      const color=streamColor(type,p),offset=i*3;
      pointPositions[offset]=p.x;pointPositions[offset+1]=p.y;pointPositions[offset+2]=p.z;
      pointColors[offset]=color.r;pointColors[offset+1]=color.g;pointColors[offset+2]=color.b;
    }
    points.geometry.attributes.position.needsUpdate=true;points.geometry.attributes.color.needsUpdate=true;
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
      pause(); camera.position.sub(controls.target).multiplyScalar(scale/viewportScale).add(controls.target);
    }
    viewportScale=scale;
    camera.aspect=w/h; camera.setViewOffset(w,h,0,-32,w,h); camera.updateProjectionMatrix();
    renderer.setSize(w,h,false);
    if(hasThree&&frame) render(State.t);
  }
  function opacity(object,value) {
    object.visible=value>0.001;
    if(object.material) object.material.opacity=value;
  }
  function updateVisual() {
    const flatScene=V.flat>0.5;
    flat.rotation.y=V.theta;
    opacity(flat,V.flat*0.58); opacity(flatEdge,V.flat*0.95); opacity(flatGrid,V.flat*0.35);
    opacity(patchMesh,V.micro*0.8); opacity(patchEdge,V.micro*0.95);
    const roofColor=0x7dd3fc;
    flat.material.color.setHex(roofColor); patchMesh.material.color.setHex(roofColor);
    const normal=vec(patchData.normal).lerp(new THREE.Vector3(Math.sin(V.theta),0,Math.cos(V.theta)),V.flat).normalize();
    const center=vec(patchData.center).lerp(new THREE.Vector3(1,1,1),V.flat);
    normal.multiplyScalar(V.side>=0?1:-1);
    normalArrow.position.copy(center); normalArrow.setDirection(normal);
    normalArrow.setLength(0.6,0.12,0.06); normalArrow.visible=V.normal*Math.abs(V.side)>0.001;
    normalArrow.line.material.transparent=true; normalArrow.cone.material.transparent=true;
    normalArrow.line.material.opacity=V.normal*Math.abs(V.side); normalArrow.cone.material.opacity=V.normal*Math.abs(V.side);
    const flatVertices=[[-0.7,-0.7],[0.7,-0.7],[0.7,0.7],[-0.7,0.7]]
      .map(v=>[1+v[0]*Math.cos(V.theta),1+v[1],0.012]);
    writePositions(flatShadow.geometry,flatVertices.flat());
    opacity(flatShadow,V.flat*V.xy);
    for(const plane of ['xy','yz','zx']) {
      const alpha=(1-V.flat)*V[plane];
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
    const axisAlpha=Math.max(V.xy,V.yz,V.zx)*(1-V.flat);
    axesGroup.visible=axisAlpha>0.001;
    axesGroup.traverse(o=>{ if(o.material) {o.material.transparent=true;o.material.opacity=axisAlpha;} });
    axesGroup.position.set(0,0,0);
    for(const channel of ['p','q','r']) {
      const arrow=flowArrows[channel],axis=channel==='p'?0:channel==='q'?1:2;
      const weight=V[channel+'w'];
      arrow.visible=weight>0.001;
      arrow.line.material.transparent=arrow.cone.material.transparent=true;
      arrow.line.material.opacity=arrow.cone.material.opacity=weight;
      const origin=vec(patchData.center).setComponent(axis,-.04).lerp(new THREE.Vector3(.12,1,.2),V.flat);
      arrow.position.copy(origin);
      arrow.setLength(.62+.83*V.flat,0.13,0.06);
    }
    points.material.opacity=V.particles*0.95; pipeLines.material.opacity=V.particles*(.3-.12*V.flat);
    const completed=Math.floor(Math.min(1,V.sum)*macroCells.length+1e-8);
    macroCells.forEach((cell,i)=>{
      const entering=Math.max(0,Math.min(1,V.sum*64-i));
      opacity(cell.mesh,V.macro*(0.55+entering*0.25));
      cell.mesh.material.color.setHex(roofColor).lerp(new THREE.Color(0x34a583),entering);
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
      const oriented=frame.caption.index>=3||State.manualOrientation;
      $('quantityValue').textContent=oriented?(proportion>=0?'+':'−')+Math.round(Math.abs(proportion)*100)+'%':Math.round(amount)+'%';
      write('quantityLabel',oriented?'有方向的净通量':'穿过的水量');
      write('quantityActual','Φ = '+signed(M.planeFlux(V.theta,V.side>=0?1:-1)));
      $('quantityValue').style.opacity=String(Math.abs(V.side));
      $('quantityActual').style.opacity=String(Math.abs(V.side));
      $('quantityChip').classList.toggle('negative',proportion<-0.001);
    }
    const sumKey=completed+'|'+(V.side>=0?1:-1)+'|'+State.model+'|'+[V.pw,V.qw,V.rw].join(',');
    if(sumKey!==lastSum) {
      lastSum=sumKey;
      const sum=macroCells.slice(0,completed).reduce((n,cell)=>n+cell.values.p*V.pw+cell.values.q*V.qw+cell.values.r*V.rw,0)*(V.side>=0?1:-1);
      $('sumCount').textContent=completed+' / 64 块'; $('sumValue').textContent=sum.toFixed(3);
    }
    updateLabels();
  }
  function labelDefinitions(index) {
    if(index<3&&State.manualOrientation) return [
      {key:'normal',text:'规定正向',small:'沿箭头穿过记正',color:'#d97706',offset:[30,-30]},
      {key:'flow',text:'水流方向不变',color:'#2563eb',offset:[-145,0]}];
    if(index<3) return [{key:'roof',text:index===0?'这张薄网':'网的大小不变',color:'#0284c7',offset:[-155,10]},
      {key:'flow',text:'水流从下向上',color:'#2563eb',offset:[-125,-35]}].concat(index>0?[{key:'flatShadow',text:'有效截面',small:index===2?'退成一条线':'看它怎样收窄',color:'#2563eb',offset:[50,20]}]:[]);
    if(index<5) return [{key:'normal',text:'规定正向',small:'沿箭头穿过记正',color:'#d97706',offset:[30,-30]},
      {key:'flow',text:'水流方向不变',color:'#2563eb',offset:[-145,0]}];
    if(index===5||index===6) return [{key:'roof',text:index===5?'选中的这一小块':'小片近似看作平网',small:index===6?'ΔS：切平面片面积':'其余部分暂时淡去',color:'#0284c7',offset:[60,25]}]
      .concat(index===6?[{key:'normal',text:'这小片的正方向',color:'#d97706',offset:[30,-30]}]:[]);
    if(index===7) return [{key:'roof',text:'局部切平面片',color:'#0284c7',offset:[55,-20]},
      {key:'flow',text:'只看竖直水流 R',color:'#2563eb',offset:[-110,-30]}];
    if(index<11) {
      const plane=index===8?'xy':index===9?'yz':'zx';
      const areas=M.patch(State.model).areaVector;
      const axis=plane==='xy'?2:plane==='yz'?0:1;
      const words={xy:['底面影子','ΔA_xy = '+signed(areas[axis]*(V.side>=0?1:-1)),'#2563eb'],yz:['侧面影子','ΔA_yz = '+signed(areas[axis]*(V.side>=0?1:-1)),'#dc4b48'],zx:['侧面影子','ΔA_zx = '+signed(areas[axis]*(V.side>=0?1:-1)),'#059669']}[plane];
      return [{key:'roof',text:'还是这一小片',color:'#0284c7',offset:[55,-40]},
        {key:plane,text:words[0],small:words[1],color:words[2],offset:[plane==='xy'?-120:-140,28]}];
    }
    if(index===11) return [{key:'xy',text:'R 的投影',small:'底面 xOy',color:'#2563eb',offset:[40,25]},
      {key:'yz',text:'P 的投影',small:'侧面 yOz',color:'#dc4b48',offset:[-175,-25]},
      {key:'zx',text:'Q 的投影',small:'侧面 zOx',color:'#059669',offset:[65,-20]}];
    return [{key:'scan',text:index===12?'每块分别计算':index===13?'把这一块加入总和':'64 块的近似和',color:'#059669',offset:[50,10]}];
  }
  function makeLabels(index=frame.labels.index) {
    $('labels').replaceChildren(); $('labelLines').replaceChildren();
    labelItems=labelDefinitions(index).map(def=>{
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
      const channel=LESSON[frame.labels.index].channel||'r';
      const arrow=flowArrows[channel==='all'?'r':channel];
      return arrow.position.clone().add(new THREE.Vector3(0,1,0).applyQuaternion(arrow.quaternion).multiplyScalar(0.6));
    }
    if(key==='flatShadow') return new THREE.Vector3(1,1,0.012);
    if(key==='roof') return vec(patchData.center).lerp(new THREE.Vector3(1,1,1),V.flat);
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
      let y=Math.max(w<500?230:164,Math.min(h-height-150,py+item.def.offset[1]));
      // Keep labels away from the small readout and from one another.
      if(frame.labels.index<5&&x+width>w-155&&y<238) y=240;
      for(const box of occupied) if(x<box.x+box.w+6&&x+width+6>box.x&&y<box.y+box.h+6&&y+height+6>box.y)
        y=Math.min(h-height-150,box.y+box.h+10);
      occupied.push({x,y,w:width,h:height});
      item.element.style.opacity=String(frame.labels.alpha*Math.abs(V.side)); item.line.setAttribute('opacity',String(frame.labels.alpha*0.5*Math.abs(V.side)));
      item.element.style.transform='translate('+Math.round(x)+'px,'+Math.round(y)+'px)';
      item.line.setAttribute('x1',px); item.line.setAttribute('y1',py);
      item.line.setAttribute('x2',x+Math.min(width,Math.max(0,px-x))); item.line.setAttribute('y2',y+height/2);
    }
  }
  function signed(value) { return (value>=0?'+':'')+value.toFixed(3); }
  function renderFormula() {
    if(!$('mathDetails').open) return;
    const index=frame.caption.index;
    const side=V.side>=0?1:-1;
    const key=index+'|'+State.model+'|'+side+'|'+State.channel+'|'+V.theta.toFixed(3)+'|'+[V.pw,V.qw,V.rw].join(',');
    $('componentValues').style.opacity=String(Math.abs(V.side));
    if(key===formulaKey) return; formulaKey=key;
    let values,latex,explanation;
    if(index<5) {
      values={p:0,q:0,r:M.planeFlux(V.theta,side),net:M.planeFlux(V.theta,side)};
      latex='\\Phi=s R A\\cos\\alpha,\\quad s=\\pm1';
      explanation='第一章只有竖直水流。α 是网的倾斜角，A = 1.96；s 表示选取的正方向，翻转定向只改变 s。';
    } else if(index<12) {
      values=M.components(M.patch(State.model).areaVector.map(v=>v*side));
      latex='\\Delta\\Phi\\approx\\mathbf F\\cdot\\mathbf n\\,\\Delta S=P\\,\\Delta A_{yz}+Q\\,\\Delta A_{zx}+R\\,\\Delta A_{xy}';
      explanation='ΔA 是切平面片的有向投影面积（例如 ΔA_xy = n_z ΔS）。本片三项相加近似得到 ΔΦ；微元极限写 dΦ。';
    } else {
      values=M.total(State.model,8,side);
      latex='\\Phi=\\iint_S\\mathbf F\\cdot\\mathbf n\\,dS=\\lim\\sum_i\\mathbf F_i\\cdot\\mathbf n_i\\,\\Delta S_i';
      explanation='画面累计的是 64 块的中点近似值；曲面越细分，近似和越接近积分。本演示取 x、y ∈ [0.15,1.15]。';
    }
    if(index>=5) {
      for(const channel of ['p','q','r']) values[channel]*=V[channel+'w'];
      values.net=values.p+values.q+values.r;
      if(State.channel!=='all') explanation+=' 当前突出 '+State.channel.toUpperCase()+' 分量。';
    }
    $('formulaExplanation').textContent=explanation;
    if(latexKey!==latex) {
      latexKey=latex;
      if(window.katex) window.katex.render(latex,$('formula'),{throwOnError:false,displayMode:false});
      else $('formula').textContent=index<5?'Φ = s × 竖直流速 × 网面积 × cos α':index<12?'ΔΦ ≈ P nₓ ΔS + Q nᵧ ΔS + R n_z ΔS':'Φ = 曲面上各小片有符号通量之和的极限';
    }
    $('componentValues').replaceChildren();
    for(const [name,key] of [['P 项','p'],['Q 项','q'],['R 项','r'],['合计','net']]) {
      const span=document.createElement('span'); span.textContent=name+' '+signed(values[key]); $('componentValues').appendChild(span);
    }
  }
  function write(id,text) {
    const element=$(id); if(element.textContent!==text) element.textContent=text;
  }
  function startTime(index) { return index<=0?0:C.ENDS[Math.min(index,14)-1]; }
  function updateNavigation() {
    const index=State.index,current=LESSON[index];
    document.querySelectorAll('[data-chapter]').forEach(button=>{
      const active=Number(button.dataset.chapter)===current.chapter;
      button.classList.toggle('active',active); button.setAttribute('aria-current',active?'step':'false');
    });
    document.querySelectorAll('button[data-scene]').forEach(button=>{
      const i=Number(button.dataset.scene); button.classList.toggle('active',i===index); button.classList.toggle('done',i<index);
      button.setAttribute('aria-current',i===index?'step':'false');
    });
    $('btnPrevious').disabled=State.t<=0; $('btnNext').disabled=index===14;
    $('flatExperiment').hidden=index>=5; $('quantityChip').hidden=V.flat<.001;
    $('quantityChip').style.opacity=String(V.flat*Math.abs(V.side));
    $('sumChip').hidden=V.macro<.001||V.micro>.001;
    $('sumChip').style.opacity=String(Math.min(1,V.macro/.52)*Math.abs(V.side)); $('streamControl').hidden=index<5;
    $('componentStrip').hidden=Math.max(V.xy,V.yz,V.zx)*(1-V.flat)<.001;
    $('componentStrip').style.opacity=String(Math.min(1,Math.max(V.xy,V.yz,V.zx)*(1-V.flat)/.6)*Math.abs(V.side));
    $('btnFlipSurface').disabled=index<5;
    $('stage').dataset.scene=String(index); $('stage').dataset.playing=String(State.playing);
    $('stage').dataset.motion=State.playing?'running':'paused';
    $('stage').dataset.accumulated=String(Math.floor(V.sum*64+1e-8));
    $('stage').dataset.time=State.t.toFixed(4);
    document.body.dataset.playing=String(State.playing);
    document.body.dataset.motion=State.reduced?'reduced':'full';
    write('btnPlay',State.playing?'Ⅱ 暂停':State.t>=C.DURATION?'↻ 再看一遍':'▶ 播放讲解');
  }
  function setCamera() {
    if(customView||!hasThree) return;
    const a=goalCamera(frame.camera.from),b=goalCamera(frame.camera.to);
    camera.position.copy(a.position).lerp(b.position,frame.camera.k);
    controls.target.copy(a.target).lerp(b.target,frame.camera.k);
    controls.update();
    // Projection labels must use this frame's camera, including immediately after a seek.
    camera.updateMatrixWorld(true);
  }
  function render(time) {
    if(disposed) return;
    State.t=Math.max(0,Math.min(C.DURATION,time));
    frame=C.sample(State.t);
    State.index=frame.index;
    if(State.reduced) frame=C.frame(State.index,0);
    Object.assign(V,frame.V);
    if(experiment) Object.assign(V,experiment);
    if(filter) for(const key of ['p','q','r']) V[key+'w']=filter==='all'||filter===key?1:0;
    State.channel=V.pw>0.99&&V.qw>0.99&&V.rw>0.99?'all':V.pw>0.5?'p':V.qw>0.5?'q':'r';
    const step=LESSON[frame.caption.index];
    write('sceneCount','第 '+(frame.caption.index+1)+' / 15 步 · '+CHAPTERS[step.chapter]);
    write('sceneTitle',step.title); write('sceneDescription',step.description);
    $('sceneCount').style.opacity=String(frame.caption.alpha);
    $('sceneTitle').style.opacity=String(frame.caption.alpha);
    $('sceneDescription').style.opacity=String(frame.caption.alpha);
    write('stageTime','t = '+State.t.toFixed(1)+' s');
    write('lessonCue',LESSON[frame.cue.index].cue);
    document.querySelector('.lesson-cue').style.opacity=String(frame.cue.alpha);
    $('stage').setAttribute('aria-label',step.description+' '+LESSON[frame.cue.index].cue);
    $('timeSlider').value=State.t;
    write('timeValue',State.t.toFixed(1)+' / '+C.DURATION.toFixed(1)+' s');
    if(lastScene!==State.index) {
      lastScene=State.index; $('streamSelect').value=LESSON[State.index].channel||'r';
      formulaKey='';

    }
    setCamera();
    if(hasThree) {
      rebuildStreams();
      const labelKey=frame.labels.index+'|'+State.model+'|'+(V.side>=0?1:-1)+'|'+State.manualOrientation;
      if(lastLabel!==labelKey) { lastLabel=labelKey; makeLabels(); }
      updateParticles(State.t); updateVisual();
      patchEdge.material.color.setHex(0x0284c7).lerp(new THREE.Color(GOLD),frame.focus);
      renderer.render(scene,camera);
    } else drawStatic();
    updateComponents(); renderFormula(); updateNavigation();
  }
  function updateComponents() {
    const side=V.side>=0?1:-1;
    const patch=M.patch(State.model,0.45,0.45,0.5,0.5,side);
    const values=M.components(patch.areaVector);
    const symbols={p:'ΔA_yz',q:'ΔA_zx',r:'ΔA_xy'};
    const key=State.model+'|'+side+'|'+[V.pw,V.qw,V.rw].join(',');
    $('componentStrip').style.opacity=String(Math.min(1,Math.max(V.xy,V.yz,V.zx)*(1-V.flat)/.6)*Math.abs(V.side));
    if(key===lastComponentKey) return; lastComponentKey=key;
    ['p','q','r'].forEach((channel,i)=>{
      const element=document.querySelector('[data-component='+channel+']');
      element.textContent=channel.toUpperCase()+' · '+symbols[channel]+' = '+signed(values[channel]);
      element.style.opacity=String(V[channel+'w']);
    });
  }
  // A deterministic SVG fallback also shows the true projected parallelograms.
  function drawStatic() {
    const ns='http://www.w3.org/2000/svg',group=$('staticDrawing');
    group.replaceChildren();
    const project=p=>[410+135*(p[0]-p[1]),355+55*(p[0]+p[1])-145*p[2]];
    function node(tag,attrs,text) {
      const e=document.createElementNS(ns,tag); for(const [key,value] of Object.entries(attrs)) e.setAttribute(key,value);
      if(text) e.textContent=text; group.appendChild(e); return e;
    }
    function polygon(vertices,color,alpha) { node('polygon',{points:vertices.map(project).map(p=>p.join(',')).join(' '),fill:color,'fill-opacity':alpha,stroke:color,'stroke-width':1.5}); }
    function line(a,b,color,alpha=1,arrow=false) {
      const x=project(a),y=project(b); node('line',{x1:x[0],y1:x[1],x2:y[0],y2:y[1],stroke:color,'stroke-width':2,opacity:alpha});
      if(arrow) {
        const angle=Math.atan2(y[1]-x[1],y[0]-x[0]);
        const wings=[-.45,.45].map(d=>[y[0]-9*Math.cos(angle+d),y[1]-9*Math.sin(angle+d)]);
        node('polygon',{points:[y,...wings].map(p=>p.join(',')).join(' '),fill:color,opacity:alpha});
      }
    }
    const flatScene=V.flat>0.5;
    const patch=M.patch(State.model);
    const vertices=flatScene?[[-.7,-.7],[.7,-.7],[.7,.7],[-.7,.7]].map(p=>[1+p[0]*Math.cos(V.theta),1+p[1],1-p[0]*Math.sin(V.theta)]):patch.vertices;
    const colors=['#B43D3A','#047857','#2563EB'];
    const planes=['yz','zx','xy'];
    [0,1,2].forEach(axis=>{
      const alpha=flatScene?(axis===2?V.xy:0):V[planes[axis]];
      const projected=vertices.map(p=>p.map((v,i)=>i===axis?0:v));
      if(alpha>0) { polygon(projected,colors[axis],alpha); vertices.forEach((v,i)=>line(v,projected[i],colors[axis],alpha)); }
    });
    if(V.macro>0.01) M.cells(State.model).forEach((cell,i)=>{
      const corners=[[cell.x,cell.y],[cell.x+cell.width,cell.y],[cell.x+cell.width,cell.y+cell.width],[cell.x,cell.y+cell.width]].map(p=>[...p,M.surface(...p,State.model).z]);
      polygon(corners,i<V.sum*64?'#047857':'#5486A3',V.macro);
    });
    polygon(vertices,'#418DB6',flatScene?0.45:V.micro*0.5);
    const center=flatScene?[1,1,1]:patch.center;
    const normal=flatScene?[Math.sin(V.theta),0,Math.cos(V.theta)]:patch.normal;
    const side=V.side>=0?1:-1;
    if(V.normal>0.01) {
      const tip=center.map((v,i)=>v+normal[i]*0.65*side),point=project(tip);
      line(center,tip,'#965A12',V.normal*Math.abs(V.side),true); node('text',{x:point[0]+5,y:point[1],fill:'#965A12','font-size':15},'n');
    }
    ['p','q','r'].forEach((c,axis)=>{
      if(V[c+'w']<0.01) return;
      for(let i=0;i<3;i++) { const a=center.slice(),b=center.slice(); a[axis]=-0.1;b[axis]=2.2;a[(axis+1)%3]+=i*0.16;b[(axis+1)%3]+=i*0.16;line(a,b,colors[axis],V[c+'w']*.6,true); }
      const pos=project(center.map((v,i)=>i===axis?2.25:v));node('text',{x:pos[0],y:pos[1],fill:colors[axis],'font-size':15},c.toUpperCase());
    });
    if(flatScene) {
      const ratio=Math.cos(V.theta)*side;
      write('quantityValue',(ratio<0?'−':'')+Math.round(Math.abs(ratio)*100)+'%');
      write('quantityActual','Φ = '+signed(M.planeFlux(V.theta,side)));
      write('angleValue',Math.round(V.theta*180/Math.PI)+'°'); $('angleSlider').value=Math.round(V.theta*180/Math.PI);
    }
    const complete=Math.floor(V.sum*64+1e-8),cells=M.cells(State.model);
    write('sumCount',complete+' / 64 块');
    write('sumValue',(cells.slice(0,complete).reduce((n,c)=>n+c.values.p*V.pw+c.values.q*V.qw+c.values.r*V.rw,0)*side).toFixed(3));
  }
  function pause() {
    State.playing=false; if(timeline) timeline.pause();
    if(viewTween) viewTween.pause();
    if(reducedTimer) { reducedTimer.kill(); reducedTimer=null; }
    updateNavigation();
  }
  function clearExploration() {
    experiment=null; filter=null; customView=false; State.manualOrientation=false;
    if(viewTween) { viewTween.kill(); viewTween=null; }
  }
  function seek(time) {
    pause(); clearExploration();
    if(timeline) timeline.time(time,true);
    clock.t=time; render(time);
  }
  function showScene(index) { seek(startTime(Math.max(0,Math.min(14,index)))); }
  function reducedTick() {
    if(!State.playing) return;
    if(State.index>=14) { pause(); return; }
    render(startTime(State.index+1));
    reducedTimer=window.gsap.delayedCall(2.5,reducedTick).timeScale(State.speed);
  }
  function play() {
    if(State.playing) { pause(); return; }
    if(!timeline) return;
    if(State.t>=C.DURATION||State.index===14) seek(0);
    clearExploration(); render(State.t);
    State.playing=true; updateNavigation();
    if(State.reduced) reducedTimer=window.gsap.delayedCall(2.5,reducedTick).timeScale(State.speed);
    else timeline.time(State.t,true).play();
  }
  function reset() {
    State.model='paraboloid'; $('surfaceSelect').value=State.model;
    if(hasThree) rebuildSurface(); seek(0);
  }
  function changeView(view) {
    pause(); customView=true; if(!hasThree) return;
    if(viewTween) viewTween.kill();
    const goal=goalCamera(LESSON[State.index].cam);
    if(view==='top') goal.position=goal.target.clone().add(new THREE.Vector3(0.01,-0.01,5.2));
    if(view==='side') goal.position=goal.target.clone().add(new THREE.Vector3(4.3,0.01,0.7));
    if(!window.gsap||State.reduced) { camera.position.copy(goal.position);controls.target.copy(goal.target);controls.update(); render(State.t);return; }
    viewTween=window.gsap.timeline({onUpdate:()=>{controls.update();render(State.t);}})
      .to(camera.position,{x:goal.position.x,y:goal.position.y,z:goal.position.z,duration:.6,ease:p=>p*p*(3-2*p)},0)
      .to(controls.target,{x:goal.target.x,y:goal.target.y,z:goal.target.z,duration:.6,ease:p=>p*p*(3-2*p)},0);
  }
  function bindEvents() {
    $('btnPlay').addEventListener('click',play);
    $('btnNext').addEventListener('click',()=>showScene(State.index+1));
    $('btnPrevious').addEventListener('click',()=>showScene(State.index-1));
    $('btnReset').addEventListener('click',reset);
    $('timeSlider').max=C.DURATION;
    $('timeSlider').addEventListener('input',event=>seek(Number(event.target.value)));
    document.querySelectorAll('[data-chapter]').forEach(button=>button.addEventListener('click',()=>showScene(STARTS[Number(button.dataset.chapter)])));
    LESSON.forEach((lesson,index)=>{
      const button=document.createElement('button'); button.dataset.scene=index;
      button.title='第 '+(index+1)+' 步：'+lesson.title; button.setAttribute('aria-label',button.title);
      button.addEventListener('click',()=>showScene(index)); $('lessonProgress').appendChild(button);
    });
    $('speedSelect').addEventListener('change',event=>{
      State.speed=Number(event.target.value); if(timeline) timeline.timeScale(State.speed);
      if(reducedTimer) reducedTimer.timeScale(State.speed);
    });
    $('reducedMotion').checked=State.reduced;
    function setMotion(reduced) {
      const wasPlaying=State.playing; pause(); State.reduced=reduced; $('reducedMotion').checked=reduced;
      render(State.t); if(wasPlaying) play();
    }
    $('reducedMotion').addEventListener('change',event=>setMotion(event.target.checked));
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>setMotion(event.matches));
    $('angleSlider').addEventListener('input',event=>{
      pause(); State.manualOrientation=true;
      experiment={...V,theta:Number(event.target.value)*Math.PI/180,xy:.5,normal:1}; render(State.t);
    });
    function flip() {
      pause(); State.manualOrientation=State.index<5;
      const from={...V},side=V.side>=0?-1:1;
      if(viewTween) viewTween.kill();
      if(!window.gsap||State.reduced) { experiment={...V,normal:1,side}; render(State.t);return; }
      const cursor={p:0};
      viewTween=window.gsap.to(cursor,{p:1,duration:.8,ease:'none',onUpdate:()=>{
        experiment={...from,normal:1,side:from.side+(side-from.side)*cursor.p}; formulaKey='';render(State.t);
      }});
    }
    $('btnFlip').addEventListener('click',flip); $('btnFlipSurface').addEventListener('click',flip);
    $('surfaceSelect').addEventListener('change',event=>{
      pause(); State.model=event.target.value; if(hasThree) rebuildSurface(); lastComponentKey='';formulaKey='';render(State.t);
    });
    $('streamSelect').addEventListener('change',event=>{
      const channel=event.target.value;
      if(State.index<12) showScene({all:11,r:8,p:9,q:10}[channel]);
      else { pause(); filter=channel;formulaKey='';render(State.t); }
    });
    document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>changeView(button.dataset.view)));
    $('mathDetails').addEventListener('toggle',()=>{ formulaKey=''; renderFormula(); });
    document.addEventListener('visibilitychange',()=>{ if(document.hidden) pause(); });
    document.addEventListener('keydown',event=>{
      const el=event.target instanceof Element?event.target:null;
      if(el&&el.closest('input,select,textarea,button,a,summary')||event.ctrlKey||event.metaKey||event.altKey) return;
      if(event.code==='Space') { event.preventDefault();play(); }
      if(event.code==='ArrowRight') { event.preventDefault();showScene(State.index+1); }
      if(event.code==='ArrowLeft') { event.preventDefault();showScene(State.index-1); }
      if(event.code==='Home') { event.preventDefault();seek(0); }
    });
  }
  function init() {
    Object.assign(V,C.sample(0).V);
    const notices=[];
    try {
      if(!window.THREE||!THREE.OrbitControls) throw new Error('3D unavailable');
      initializeThree(); hasThree=true;
      controls.addEventListener('change',()=>{
        if(customView&&!State.playing) {updateLabels();renderer.render(scene,camera);}
      });
    } catch(error) {
      if(renderer) { renderer.dispose();renderer.domElement.remove(); }
      $('staticStage').removeAttribute('hidden');
      document.querySelectorAll('[data-view]').forEach(button=>button.disabled=true);
      document.querySelector('.orbit-hint').textContent='静态投影示意 · 使用单步或进度浏览';
      notices.push('三维资源或 WebGL 不可用，已切换静态投影图，仍可逐步浏览。');
    }
    bindEvents();
    if(window.gsap) {
      timeline=window.gsap.timeline({paused:true,onUpdate:()=>render(clock.t),onComplete:()=>pause()});
      timeline.to(clock,{t:C.DURATION,duration:C.DURATION,ease:'none'}).timeScale(State.speed);
    } else {
      $('btnPlay').disabled=true;
      notices.push('动画引擎未加载，播放已停用；单步、进度与参数仍可使用。');
    }
    if(notices.length) { $('engineNotice').hidden=false;write('engineNotice',notices.join(' ')); }
    render(0);
    window.addEventListener('pagehide',()=>{
      disposed=true;pause(); if(timeline) timeline.kill();if(viewTween) viewTween.kill();
      if(resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize',resize);
      if(controls) controls.dispose();if(scene) disposeGroup(scene);if(renderer) renderer.dispose();
    });
  }
  init();
})();
