/* 三维几何使用 Canvas 正交投影；二维图用真实密度坐标，屏幕缩放不参与积分。 */
(function () {
  'use strict';
  const M = DensityModel, C = DensityChoreo;
  const $ = id => document.getElementById(id);
  const clamp = C.clamp;
  const fmt = (v, n = 2) => (Math.abs(v) < .5 * 10 ** -n ? 0 : v).toFixed(n);
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  const attr = (el, key, value) => { if (el.getAttribute(key) !== String(value)) el.setAttribute(key, value); };
  const finite = (value, fallback, a, b) => Number.isFinite(Number(value)) && value !== null ? clamp(Number(value), a, b) : fallback;
  const hash = new URLSearchParams(location.hash.slice(1));
  const modelKey = Object.hasOwn(M.models, hash.get('m')) ? hash.get('m') : 'normal';
  const range = M.models[modelKey].range;
  const state = {
    model: modelKey, dir: hash.get('d') === 'y' ? 'y' : 'x',
    anchor: finite(hash.get('u'), .5, ...range), rho: finite(hash.get('r'), .4, -.8, .8),
    t: finite(hash.get('t'), 0, 0, 16), speed: finite(hash.get('s'), 1, .5, 2),
    surface: hash.get('surf') !== '0', conditional: hash.get('c') === '1',
    reduced: hash.has('rm') ? hash.get('rm') === '1' : matchMedia('(prefers-reduced-motion: reduce)').matches,
    yaw: finite(hash.get('yaw'), -.65, -Math.PI, Math.PI), pitch: finite(hash.get('pitch'), .6, .2, 1.48),
    explore: hash.get('e') === '1', playing: false
  };
  if (![.5,1,1.5,2].includes(state.speed)) state.speed=1;
  const canvas = $('joint-canvas'), ctx = canvas.getContext('2d');
  let width = 600, height = 350, mesh = [], timeline, reducedCall, linkTimer, resizeFrame;
  let bridgeSource, bridgeTarget;
  let currentFrame, currentSlice, lastAxes = '', lastMesh = '', drag;
  const svgNS = 'http://www.w3.org/2000/svg';
  const plot = { x: 48, y: 23, w: 326, h: 120, base: 143 };

  function saveLink(immediate = false) {
    clearTimeout(linkTimer);
    const save = () => {
      const params = new URLSearchParams({ m: state.model, d: state.dir, u: fmt(state.anchor, 3), r: fmt(state.rho),
        t: fmt(state.t), s: String(state.speed), surf: state.surface ? '1' : '0', c: state.conditional ? '1' : '0',
        rm: state.reduced ? '1' : '0', yaw: fmt(state.yaw, 3), pitch: fmt(state.pitch, 3), e: state.explore ? '1' : '0' });
      history.replaceState(null, '', '#' + params);
    };
    if (immediate) save(); else linkTimer = setTimeout(save, 250);
  }
  function sampleTime() {
    // 减少动效时，直接展示当前步骤终态；时钟仍停在用户选定边界。
    if (!state.reduced || state.t >= 16) return state.t;
    const next = C.boundaries.find(t => t > state.t + 1e-7);
    return next === undefined ? 16 : next;
  }
  function frame() {
    const result = C.sample(sampleTime(), state.anchor, M.models[state.model].range, state.explore);
    const phase = C.sample(state.t, state.anchor, M.models[state.model].range, state.explore);
    result.phase = phase.phase; result.name = phase.name;
    result.captionIndex = state.reduced ? phase.phase : result.captionIndex;
    result.captionAlpha = state.reduced ? 1 : result.captionAlpha;
    return result;
  }
  function stop() {
    state.playing = false;
    timeline?.pause(); reducedCall?.kill(); reducedCall = undefined;
    text('play', '播放演示'); $('status-dot').classList.remove('playing');
    saveLink(true);
  }
  function seek(t, user = true) {
    if (user) stop();
    state.t = clamp(t, 0, 16);
    timeline?.time(state.t, true);
    render(); saveLink(user);
  }
  function step(direction) {
    const target = direction > 0 ? C.boundaries.find(t => t > state.t + .001)
      : [...C.boundaries].reverse().find(t => t < state.t - .001);
    state.explore = false;
    seek(target === undefined ? (direction > 0 ? 16 : 0) : target);
  }
  function reducedTick() {
    reducedCall = gsap.delayedCall(.9 / state.speed, () => {
      if (!state.playing) return;
      const target = C.boundaries.find(t => t > state.t + .001);
      if (target === undefined) { stop(); return; }
      seek(target, false);
      if (target >= 16) stop(); else reducedTick();
    });
  }
  function togglePlay() {
    if (!timeline) return;
    if (state.playing) { stop(); return; }
    if (state.explore) {
      state.anchor = currentFrame.u; state.explore = false;
      // 探索后继续前面的教学，或从扫描起点重新扫描当前截面。
      if (state.t >= 10) seek(10, false);
    }
    if (state.t >= 16) seek(0, false);
    state.playing = true; text('play', '暂停演示'); $('status-dot').classList.add('playing');
    if (state.reduced) reducedTick(); else timeline.timeScale(state.speed).play(state.t);
  }
  function parameterChange(fn, geometry = false) {
    stop(); fn();
    if (geometry) lastMesh = '';
    render(); saveLink(true);
  }

  function buildMesh() {
    const cacheKey = `${state.model}/${state.rho}`;
    if (cacheKey === lastMesh) return;
    lastMesh = cacheKey; mesh = [];
    const model = M.models[state.model], [a, b] = model.range, n = 30;
    const make = (x, y) => [2 * (x - a) / (b - a) - 1, 2 * (y - a) / (b - a) - 1, model.joint(x, y, state.rho)];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = a + (b - a) * i / n, y = a + (b - a) * j / n, dx = (b - a) / n;
        if (state.model === 'triangle') {
          if (i + j >= n) continue;
          mesh.push([make(x, y), make(x + dx, y), make(x, y + dx)]);
          if (i + j < n - 1) mesh.push([make(x + dx, y), make(x + dx, y + dx), make(x, y + dx)]);
          // 三角形顶面恒高，不用浮点边界比较产生零高度顶点。
          for (const tri of mesh.slice(-((i + j < n - 1) ? 2 : 1))) for (const v of tri) v[2] = .5;
        } else {
          mesh.push([make(x, y), make(x + dx, y), make(x + dx, y + dx), make(x, y + dx)]);
        }
      }
    }
  }
  function draw3D(f, slice) {
    if (!ctx) return;
    buildMesh();
    ctx.clearRect(0, 0, width, height);
    const model = M.models[state.model], [a, b] = model.range;
    const norm = v => 2 * (v - a) / (b - a) - 1;
    // 所有模型使用固定密度纵向比例；数值标尺与形状不随 rho 自动拉伸。
    const zScale = state.model === 'normal' ? 4.6 : 2.6;
    const planeTop = state.model === 'normal' ? .32 : .58;
    const c = Math.cos(state.yaw), s = Math.sin(state.yaw), cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    const rawProject = ([x,y,z]) => {
      const depth=s*x+c*y;
      return [c*x-s*y,sp*depth-cp*z*zScale,cp*depth+sp*z*zScale];
    };
    // 包含所有切片位置的固定包围盒，扫描时不自动缩放；任意视角都留出轴标签空间。
    const corners=[];
    for(const x of [-1,1]) for(const y of [-1,1]) for(const z of [0,planeTop]) corners.push(rawProject([x,y,z]));
    const minX=Math.min(...corners.map(v=>v[0])),maxX=Math.max(...corners.map(v=>v[0]));
    const minY=Math.min(...corners.map(v=>v[1])),maxY=Math.max(...corners.map(v=>v[1]));
    const scale=Math.min((width-86)/(maxX-minX),(height-77)/(maxY-minY));
    const cx=width/2-scale*(minX+maxX)/2,cy=(height-31)/2-scale*(minY+maxY)/2;
    const project = v => {
      const raw=rawProject(v);
      return [cx+scale*raw[0],cy+scale*raw[1],raw[2]];
    };
    function path(points, fill, stroke, lineWidth = 1, alpha = 1) {
      ctx.globalAlpha = alpha; ctx.beginPath();
      points.forEach((v, i) => { const p = project(v); if (!i) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      if (fill) { ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    function label(value, v, color = '#6b7066', dx = 0, dy = 0) {
      const p = project(v); ctx.font = '11px -apple-system, "Microsoft YaHei", sans-serif'; ctx.fillStyle = color;
      ctx.textAlign = 'center'; ctx.fillText(value, p[0] + dx, p[1] + dy);
    }
    const domain = state.model === 'triangle' ? [[-1,-1,0],[1,-1,0],[-1,1,0]] : [[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]];
    path(domain, '#edf1e7', '#c5cec0');
    for (let i = 0; i <= 6; i++) {
      const v = -1 + 2 * i / 6;
      if (state.model === 'triangle') {
        path([[v,-1,0],[v,-v,0]], null, '#d8dfd1');
        path([[-1,v,0],[-v,v,0]], null, '#d8dfd1');
      } else {
        path([[v,-1,0],[v,1,0]], null, '#d8dfd1');
        path([[-1,v,0],[1,v,0]], null, '#d8dfd1');
      }
    }
    // 底座、边界竖壁表达有限域支持，三角形斜边保持真正竖直。
    const faces = [];
    const edges = state.model === 'triangle' ? [[ [a,a], [b,a] ],[ [b,a], [a,b] ],[ [a,b], [a,a] ]]
      : [[[a,a],[b,a]],[[b,a],[b,b]],[[b,b],[a,b]],[[a,b],[a,a]]];
    if (state.surface && state.model !== 'normal') {
      for (const [p, q] of edges) {
        const h1 = state.model === 'triangle' ? .5 : model.joint(...p), h2 = state.model === 'triangle' ? .5 : model.joint(...q);
        faces.push({ points: [[norm(p[0]),norm(p[1]),0],[norm(q[0]),norm(q[1]),0],[norm(q[0]),norm(q[1]),h2],[norm(p[0]),norm(p[1]),h1]], side: true });
      }
    }
    if (state.surface) mesh.forEach(points => faces.push({ points, side: false }));
    const u = norm(f.u), [v0, v1] = slice.bounds;
    // 切面、截面网格一起进行深度排序，前侧曲面降低透明度让截面可读。
    const cross = v => state.dir === 'x' ? [u, norm(v), 0] : [norm(v), u, 0];
    const plane = [cross(a),cross(b),cross(b),cross(a)].map((v,i) => [v[0],v[1],i >= 2 ? planeTop : 0]);
    faces.push({ points: plane, plane: true });
    for (let i = 1; i < slice.points.length; i++) {
      const p = slice.points[i-1], q = slice.points[i], b1 = cross(p.v), b2 = cross(q.v);
      faces.push({ points: [b1,b2,[b2[0],b2[1],q.density],[b1[0],b1[1],p.density]], slice: true });
    }
    faces.sort((f1, f2) => {
      const avg = face => face.points.reduce((sum, v) => sum + project(v)[2], 0) / face.points.length;
      return avg(f1) - avg(f2);
    });
    for (const face of faces) {
      if (face.plane) { path(face.points, '#c99a4d', '#b67b2d', .8, .08 + .08*f.focus); continue; }
      if (face.slice) { path(face.points, '#d2a14e', null, 1, .94); continue; }
      const h = face.points.reduce((sum, v) => sum + v[2], 0) / face.points.length;
      const tone = Math.min(1, h / model.peak(state.rho));
      const color = `rgb(${Math.round(188-70*tone)},${Math.round(209-50*tone)},${Math.round(189-49*tone)})`;
      path(face.points, face.side ? '#b8cbbb' : color, face.side ? '#a2bca8' : '#6f9b832e', .45, face.side ? .4 : .65);
    }
    path(plane.concat([plane[0]]), null, '#b47a2c', 1, .6);
    const ridge = slice.points.map(p => { const v = cross(p.v); return [v[0], v[1], p.density]; });
    if (ridge.length) {
      path(ridge, null, '#9b601c', 2.3);
      bridgeSource = project(ridge.reduce((best, v) => v[2] > best[2] ? v : best));
    } else bridgeSource = project(cross(a));
    path([cross(v0),cross(v1)], null, '#ac762b', 2);
    // 坐标标尺显示原始密度，绝不显示归一化的视觉高度。
    path([[-1,-1,0],[1.15,-1,0]], null, '#8b988c');
    path([[-1,-1,0],[-1,1.15,0]], null, '#8b988c');
    const axisHeight = state.model === 'normal' ? .3 : .5;
    path([[-1,-1,0],[-1,-1,axisHeight]], null, '#8b988c');
    label('x', [1.15,-1,0], '#343c38', 7, 0); label('y', [-1,1.15,0], '#343c38', -6, 12);
    label('f(x,y)', [-1,-1,axisHeight], '#343c38', 2, -12);
    label(String(a), [-1,-1,0], '#6b7066', -8, 15);
    label(String(b), [1,-1,0], '#6b7066', 0, 16); label(String(b), [-1,1,0], '#6b7066', 0, 16);
    label(fmt(axisHeight,1), [-1,-1,axisHeight], '#6b7066', -25, 2);
    const loc = cross(a), p = project(loc);
    ctx.fillStyle='#faf9f5'; ctx.strokeStyle='#b47a2c'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(p[0],p[1],4,0,Math.PI*2); ctx.fill();ctx.stroke();
    canvas.setAttribute('aria-label', `${model.name}；固定 ${state.dir}=${fmt(f.u)}，截面全域积分 ${fmt(slice.area,4)}。拖拽旋转或使用下方视角按钮。`);
  }

  function axes(id, xRange, yMax) {
    const group = $(id); group.replaceChildren();
    function el(tag, attrs, label) {
      const node = document.createElementNS(svgNS, tag);
      for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
      if (label !== undefined) node.textContent = label;
      group.append(node);
    }
    for (let i = 0; i <= 2; i++) {
      const y = plot.base - i/2*plot.h;
      el('line',{x1:plot.x,y1:y,x2:plot.x+plot.w,y2:y,class:'grid'});
      el('text',{x:plot.x-9,y:y+4,'text-anchor':'end'},fmt(yMax*i/2,yMax>=2?1:2));
    }
    el('path',{d:`M${plot.x} ${plot.y-3}V${plot.base}H${plot.x+plot.w+8}`,class:'axis'});
    const count = xRange[0] < 0 ? 6 : 4;
    for (let i = 0; i <= count; i++) {
      const x = plot.x + i/count*plot.w;
      el('line',{x1:x,y1:plot.base,x2:x,y2:plot.base+4,class:'axis'});
      el('text',{x,y:plot.base+18,'text-anchor':'middle'},fmt(xRange[0]+(xRange[1]-xRange[0])*i/count,1));
    }
  }
  function drawPlots(f, slice) {
    const model = M.models[state.model], r = model.range;
    const x = v => plot.x + (v-r[0])/(r[1]-r[0])*plot.w;
    const sectionMax = state.model === 'normal' ? .3 : .6;
    const condMax = slice.points.reduce((max,p)=>Math.max(max,p.conditional||0),0);
    const sectionYMax = state.conditional && slice.conditionalDefined ? Math.max(sectionMax, condMax*1.1) : sectionMax;
    const marginalMax = state.model === 'normal' ? .45 : (state.model === 'triangle' ? 1.1 : .85);
    const sy = v => plot.base - v/sectionYMax*plot.h, my = v => plot.base-v/marginalMax*plot.h;
    const key = `${state.model}/${sectionYMax}`;
    if (key !== lastAxes) { axes('section-axes',r,sectionYMax); axes('marginal-axes',r,marginalMax); lastAxes=key; }
    const pathFor = (points, value, y) => points.map((p,i)=>`${i?'L':'M'}${fmt(x(p.v),2)},${fmt(y(p[value]),2)}`).join('');
    const points = slice.points;
    const line = pathFor(points,'density',sy);
    attr($('section-line'),'d',line);attr($('section-reference'),'d',line);
    attr($('section-line'),'stroke-dashoffset',1-f.unfold);
    const fill = points.length ? `${line}L${x(points.at(-1).v)},${plot.base}L${x(points[0].v)},${plot.base}Z` : '';
    attr($('section-area-reference'),'d',fill);
    const upto=slice.bounds[0]+(slice.bounds[1]-slice.bounds[0])*f.integration;
    const accumulated=points.filter(p=>p.v<=upto);
    if(points.length && f.fill > 0 && f.fill < 1) {
      accumulated.push({v:upto,density:state.dir==='x'?model.joint(f.u,upto,state.rho):model.joint(upto,f.u,state.rho)});
    }
    const partial=accumulated.length>1 ? `${pathFor(accumulated,'density',sy)}L${x(accumulated.at(-1).v)},${plot.base}L${x(accumulated[0].v)},${plot.base}Z` : '';
    attr($('section-fill'),'d',f.fill>=1?fill:partial);
    $('section-line').style.opacity = .55 + .45*f.unfold;
    const stripValue = slice.bounds[0]+(slice.bounds[1]-slice.bounds[0])*f.integration;
    const stripDensity = state.dir === 'x' ? model.joint(f.u,stripValue,state.rho) : model.joint(stripValue,f.u,state.rho);
    attr($('integration-strip'),'x',x(stripValue)-3);
    attr($('integration-strip'),'y',sy(stripDensity)); attr($('integration-strip'),'height',plot.base-sy(stripDensity));
    $('integration-strip').style.opacity = state.t >= 4.2 && state.t < 6.5 && !state.reduced ? .6 : 0;
    attr($('conditional-line'),'d',state.conditional && slice.conditionalDefined ? pathFor(points,'conditional',sy) : '');
    $('conditional-readout').hidden = !state.conditional;
    text('conditional-readout',!slice.conditionalDefined ? 'A = 0：该截面不能由密度比定义条件密度。'
      : `蓝虚线：${state.dir === 'x' ? 'f(y | x₀)' : 'f(x | y₀)'} = f / A；全域积分 = 1${state.model === 'normal' ? '（图中省略尾部）' : ''}`);
    const peak = points.reduce((best,p) => !best || p.density > best.density ? p : best, null);
    bridgeTarget = peak ? [x(peak.v),sy(peak.density)] : [x(r[0]),plot.base];
    text('section-y-label',state.conditional ? '联合密度 / 条件密度（同数值标尺）' : (state.dir==='x'?'f(x₀,y)':'f(x,y₀)'));
    const samples = Array.from({length:161},(_,i)=>({v:r[0]+(r[1]-r[0])*i/160}));
    const marginalPath = arr => arr.map((p,i)=>`${i?'L':'M'}${fmt(x(p.v))},${fmt(my(model.marginal(p.v)))}`).join('');
    attr($('marginal-reference'),'d',marginalPath(samples));
    const traced = samples.filter(p=>p.v>f.traceMin && p.v<f.traceMax);
    if (f.traceVisible) traced.unshift({v:f.traceMin}),traced.push({v:f.traceMax});
    attr($('marginal-trace'),'d',f.traceVisible ? marginalPath(traced) : '');
    const postX=x(f.u),postY=my(slice.area*f.transfer);
    for(const [key,value] of Object.entries({x1:postX,x2:postX,y1:plot.base,y2:postY})) attr($('marginal-post'),key,value);
    attr($('marginal-point'),'cx',postX);attr($('marginal-point'),'cy',postY);
    $('marginal-point').style.opacity=f.receipt;
    $('marginal-post').style.opacity=.2+.8*f.transfer;
    attr($('point-label'),'x',clamp(postX+10,75,332));attr($('point-label'),'y',Math.max(24,postY-9));
    text('point-label', f.transfer > .99 ? `${state.dir}₀=${fmt(f.u)}` : '');
    text('visible-area',`可见积分 ≈ ${fmt(slice.visibleArea,4)}`);
    text('section-note',slice.area===0 ? '零面积截面' : state.model==='normal' ? 'A 还计入图外尾部' : `积分区间 [${fmt(slice.bounds[0],1)}, ${fmt(slice.bounds[1],2)}]`);
    text('area-value',fmt(slice.area,4));text('marginal-value',fmt(slice.area,4));
    $('transfer').style.setProperty('--transfer',f.transfer);
    $('transfer').querySelector('svg').style.opacity=.2+.8*f.transfer;
    $('transfer-tag').style.opacity=f.receipt;
    $('transfer-tag').style.transform=`translateY(${(1-f.receipt)*4}px)`;
    // 相关系数改变后，截面变形而全域边缘曲线保持不变。
    $('section-svg').setAttribute('aria-label',`${state.dir}=${fmt(f.u)}的截面；全域面积${fmt(slice.area,4)}，可见积分${fmt(slice.visibleArea,4)}`);
  }
  function drawBridge(f) {
    if (!bridgeSource || !bridgeTarget) return;
    const box=$('workspace').getBoundingClientRect(), cbox=canvas.getBoundingClientRect(), sbox=$('section-svg').getBoundingClientRect();
    const ratio=Math.min(sbox.width/420,sbox.height/184), dx=(sbox.width-420*ratio)/2, dy=(sbox.height-184*ratio)/2;
    const start=[cbox.x-box.x+bridgeSource[0],cbox.y-box.y+bridgeSource[1]];
    const end=[sbox.x-box.x+dx+bridgeTarget[0]*ratio,sbox.y-box.y+dy+bridgeTarget[1]*ratio];
    attr($('section-bridge'),'viewBox',`0 0 ${box.width} ${box.height}`);
    const d=`M${start[0]},${start[1]} C${start[0]+70},${start[1]-35} ${end[0]-70},${end[1]-35} ${end[0]},${end[1]}`;
    attr($('bridge-line'),'d',d);attr($('bridge-line'),'stroke-dashoffset',1-f.unfold);
    $('section-bridge').style.opacity=f.unfold*.48;
  }
  function render() {
    const f = frame();
    const slice = M.slice(state.model,state.dir,f.u,state.rho);
    currentFrame=f;currentSlice=slice;
    draw3D(f,slice);drawPlots(f,slice);drawBridge(f);
    const fixed=state.dir, other=fixed==='x'?'y':'x', sub=fixed==='x'?'ₓ':'ᵧ';
    text('clock',`${fmt(state.t,1).padStart(4,'0')} s`);text('phase',f.name);
    text('time-value',`${fmt(state.t,1)} s`);$('progress').value=state.t;
    text('cut-label',`${fixed}₀ = ${fmt(f.u)}`);text('slice-tag',`固定 ${fixed}₀ · 沿 ${other} 积分`);
    text('integral-formula',`A(${fixed}₀) = ∫ f(${fixed==='x'?'x₀,y':'x,y₀'}) d${other}`);
    text('transfer-symbol',`f${sub}(${fixed}₀)`);text('marginal-symbol',`f${sub}(${fixed}₀)`);
    text('marginal-y-label',`f${sub}(${fixed})`);text('section-axis-label',other);text('marginal-axis-label',fixed);
    text('slice-label',`切片位置 ${fixed}₀`);text('slice-output',fmt(f.u));
    const r=M.models[state.model].range;$('slice').min=r[0];$('slice').max=r[1];$('slice').value=f.u;
    text('rho-output',fmt(state.rho));$('rho').value=state.rho;
    $('rho-control').hidden=state.model!=='normal';
    $('conditional').checked=state.conditional;$('surface').checked=state.surface;$('reduced-motion').checked=state.reduced;
    document.body.dataset.motion=state.reduced?'reduced':'full';
    $('explore-note').hidden=!state.explore;
    text('caption',C.captions[f.captionIndex]);$('caption').style.opacity=f.captionAlpha;
    text('caption-index',`0${f.phase+1} / 05`);
    document.querySelectorAll('[data-model]').forEach(b=>attr(b,'aria-pressed',b.dataset.model===state.model));
    document.querySelectorAll('[data-dir]').forEach(b=>attr(b,'aria-pressed',b.dataset.dir===state.dir));
    document.querySelectorAll('[data-time]').forEach((b,i)=>attr(b,'aria-current',i===f.phase?'step':'false'));
    $('previous').disabled=state.t<=0;$('next').disabled=state.t>=16;
    text('model-formula',state.model==='normal'?`标准二元正态 · ρ = ${fmt(state.rho)}`:state.model==='triangle'?'f(x,y) = ½ · 0 ≤ x,y, x+y ≤ 2':'f(x,y) = (x+y)/8 · 0 ≤ x,y ≤ 2');
    text('domain-note',state.model==='normal'?'绘图区 [−3,3]²':state.model==='triangle'?'支撑域 x+y ≤ 2':'支撑域 [0,2]²');
    text('footnote',state.model==='normal'?'示意：正态曲面仅绘出 [−3,3]²；A 为全域解析积分。坐标显示比例经调整，截面面积表示密度积分而非概率。':'示意：曲面外密度为 0；坐标显示比例经调整。截面面积是边缘密度，区间下的面积才表示概率。');
  }

  if (window.gsap) {
    timeline=gsap.timeline({paused:true,onUpdate:()=>{state.t=timeline.time();render();saveLink();},onComplete:()=>stop()});
    timeline.to({}, {duration:16,ease:'none'});timeline.time(state.t,true);
  } else { $('play').disabled=true;$('engine-notice').hidden=false; }
  $('play').addEventListener('click',togglePlay);
  $('reset').addEventListener('click',()=>{state.explore=false;seek(0);});
  $('previous').addEventListener('click',()=>step(-1));$('next').addEventListener('click',()=>step(1));
  $('progress').addEventListener('input',e=>{state.explore=false;seek(Number(e.target.value));});
  document.querySelectorAll('[data-time]').forEach(button=>button.addEventListener('click',()=>{state.explore=false;seek(Number(button.dataset.time));}));
  document.querySelectorAll('[data-model]').forEach(button=>button.addEventListener('click',()=>parameterChange(()=>{
    const old=M.models[state.model].range, ratio=(currentFrame.u-old[0])/(old[1]-old[0]);
    state.model=button.dataset.model;const r=M.models[state.model].range;state.anchor=r[0]+ratio*(r[1]-r[0]);state.explore=true;
  },true)));
  document.querySelectorAll('[data-dir]').forEach(button=>button.addEventListener('click',()=>parameterChange(()=>{state.anchor=currentFrame.u;state.dir=button.dataset.dir;state.explore=true;})));
  $('slice').addEventListener('input',e=>parameterChange(()=>{state.anchor=Number(e.target.value);state.explore=true;}));
  $('rho').addEventListener('input',e=>parameterChange(()=>{state.rho=Number(e.target.value);},true));
  $('surface').addEventListener('change',e=>parameterChange(()=>{state.surface=e.target.checked;}));
  $('conditional').addEventListener('change',e=>parameterChange(()=>{state.conditional=e.target.checked;}));
  $('speed').value=String(state.speed);
  $('speed').addEventListener('change',e=>{
    state.speed=Number(e.target.value);timeline?.timeScale(state.speed);
    if(state.playing&&state.reduced){reducedCall?.kill();reducedTick();}saveLink(true);
  });
  $('reduced-motion').addEventListener('change',e=>{
    const resume=state.playing;stop();state.reduced=e.target.checked;render();if(resume)togglePlay();saveLink(true);
  });
  function setView(yaw,pitch,id) {
    parameterChange(()=>{state.yaw=yaw;state.pitch=pitch;});
    ['view-default','view-front','view-top'].forEach(v=>attr($(v),'aria-pressed',v===id));
  }
  $('view-default').addEventListener('click',()=>setView(-.65,.6,'view-default'));
  $('view-front').addEventListener('click',()=>setView(state.dir==='x'?-Math.PI/2:0,.22,'view-front'));
  $('view-top').addEventListener('click',()=>setView(-.65,1.48,'view-top'));
  canvas.addEventListener('pointerdown',e=>{stop();drag={x:e.clientX,y:e.clientY,yaw:state.yaw,pitch:state.pitch};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{
    if(!drag)return;state.yaw=((drag.yaw+(e.clientX-drag.x)*.008+Math.PI*3)%(Math.PI*2))-Math.PI;
    state.pitch=clamp(drag.pitch+(e.clientY-drag.y)*.006,.2,1.48);
    ['view-default','view-front','view-top'].forEach(v=>attr($(v),'aria-pressed','false'));
    draw3D(currentFrame,currentSlice);drawBridge(currentFrame);saveLink();
  });
  const endDrag=()=>{if(drag){drag=null;saveLink(true);}};
  canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('lostpointercapture',endDrag);
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea,button,a'))return;
    if(e.code==='Space'){e.preventDefault();togglePlay();}
    if(e.code==='ArrowLeft'){e.preventDefault();step(-1);}
    if(e.code==='ArrowRight'){e.preventDefault();step(1);}
    if(e.code==='Home'){e.preventDefault();state.explore=false;seek(0);}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  const observer=new ResizeObserver(()=>{
    cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{
      const box=$('canvas-wrap').getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
      width=box.width;height=box.height;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
      ctx?.setTransform(dpr,0,0,dpr,0,0);render();
    });
  });observer.observe($('canvas-wrap'));
  window.addEventListener('pagehide',()=>{stop();observer.disconnect();cancelAnimationFrame(resizeFrame);clearTimeout(linkTimer);timeline?.kill();},{once:true});
  // bfcache 恢复后重新观察容器与重建本模块时钟。
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
  render();
})();
