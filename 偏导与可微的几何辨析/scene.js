/* 同场三维：所有表面、交线和注记由同一份几何数据定位。
 * 只在数据、相机或容器变化时渲染，不运行空转帧循环。 */
(function (root) {
  'use strict';
  const CAP = 1.3;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const pointCap = p => [p[0], p[1], clamp(p[2], -CAP, CAP)];
  const f = v => Math.abs(v) < 0.0005 ? '0.000' : v.toFixed(3).replace('-', '−');
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };

  function create(host) {
    const T = root.THREE;
    const labels = Object.fromEntries(['origin', 'probe', 'plane', 'slopeA', 'slopeB', 'axisX', 'axisY', 'axisZ'].map(id => [id, document.getElementById('label-' + id)]));
    const layers = { surface: true, cut: true, plane: true };
    const pose = { yaw: -1.02, pitch: 0.57, zoom: 1 };
    let renderer, scene, camera, group, surface, wire, cutPlane, plane, residual;
    let cutR, cutL, origin, probe, foot, slopeA, slopeB, normalA, normalB;
    let available = false, width = 1, height = 1, current, data, geometryKey = '', pointer = null;
    let disposed = false;
    const fallback = document.getElementById('fallback3d');
    const notice = document.getElementById('graphicsNotice');
    const owned = [];
    const own = value => { owned.push(value); return value; };
    try {
      if (!T) throw new Error('Three.js未加载');
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
      renderer.setClearColor(0xfafbf7, 0);
      renderer.outputEncoding = T.sRGBEncoding;
      renderer.localClippingEnabled = true;
      renderer.domElement.setAttribute('aria-hidden', 'true');
      host.prepend(renderer.domElement);
      scene = new T.Scene();
      camera = new T.OrthographicCamera(-2, 2, 2, -2, 0.1, 50);
      camera.up.set(0, 0, 1);
      scene.add(new T.HemisphereLight(0xffffff, 0xc0cfc3, 1.1));
      const light = new T.DirectionalLight(0xffffff, 0.85); light.position.set(-3, -4, 7); scene.add(light);
      group = new T.Group(); scene.add(group);
      const clips = [new T.Plane(new T.Vector3(0, 0, -1), CAP), new T.Plane(new T.Vector3(0, 0, 1), CAP)];
      const lineMat = (color, opacity = 1) => own(new T.LineBasicMaterial({ color, transparent: true, opacity, clippingPlanes: clips, depthWrite: false }));
      const makeLine = (material, parent = group, segments = false) => {
        const geom = own(new T.BufferGeometry());
        const obj = segments ? new T.LineSegments(geom, material) : new T.Line(geom, material);
        parent.add(obj); return obj;
      };
      const surfaceMat = own(new T.MeshStandardMaterial({ color: 0x619783, roughness: 0.85, metalness: 0, side: T.DoubleSide, transparent: true, opacity: 0.78, clippingPlanes: clips, polygonOffset: true, polygonOffsetFactor: 1 }));
      surface = new T.Mesh(own(new T.BufferGeometry()), surfaceMat); group.add(surface); surface.renderOrder = 1;
      wire = makeLine(lineMat(0x315e52, 0.24), group, true); wire.renderOrder = 2;
      const gold = own(new T.MeshBasicMaterial({ color: 0xc69b45, transparent: true, opacity: 0.2, side: T.DoubleSide, depthWrite: false, clippingPlanes: clips }));
      plane = new T.Mesh(own(new T.BufferGeometry()), gold); group.add(plane);
      const blue = own(new T.MeshBasicMaterial({ color: 0x508ab7, transparent: true, opacity: 0.075, side: T.DoubleSide, depthWrite: false }));
      cutPlane = new T.Mesh(own(new T.BufferGeometry()), blue); group.add(cutPlane); cutPlane.renderOrder = 3;
      const blueLine = lineMat(0x24689b); blueLine.depthTest = false;
      cutR = makeLine(blueLine); cutL = makeLine(blueLine); cutR.renderOrder = cutL.renderOrder = 5;
      residual = makeLine(lineMat(0xb24635)); residual.material.depthTest = false; residual.renderOrder = 6;
      const tangentMat = lineMat(0x7b5142); tangentMat.depthTest = false;
      slopeA = makeLine(tangentMat); slopeB = makeLine(tangentMat);
      slopeA.renderOrder = slopeB.renderOrder = 7;
      const sphere = own(new T.SphereGeometry(0.026, 16, 12));
      const dot = color => {
        const material = own(new T.MeshBasicMaterial({ color, depthTest: false }));
        const obj = new T.Mesh(sphere, material); group.add(obj); obj.renderOrder = 8; return obj;
      };
      origin = dot(0x343c38); probe = dot(0x24689b); foot = dot(0xa07828); foot.scale.setScalar(0.72);
      normalA = dot(0x7b5142); normalB = dot(0x7b5142); normalA.scale.setScalar(0.65); normalB.scale.setScalar(0.65);
      const gridPoints = [];
      for (let n = -4; n <= 4; n++) {
        const q = n / 4;
        gridPoints.push([-1.15, q, 0], [1.15, q, 0], [q, -1.15, 0], [q, 1.15, 0]);
      }
      const gridLine = makeLine(lineMat(0x87968a, 0.16), scene, true); setPoints(gridLine, gridPoints);
      const axes = makeLine(lineMat(0x718077, 0.65), scene, true);
      setPoints(axes, [[-1.28, 0, 0], [1.42, 0, 0], [0, -1.28, 0], [0, 1.42, 0], [0, 0, -1.32], [0, 0, 1.44]]);
      renderer.domElement.addEventListener('webglcontextlost', onContextLost);
      available = true;
    } catch (_) {
      if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
    }
    host.dataset.renderer = available ? 'webgl' : 'fallback';
    notice.hidden = available;
    fallback.toggleAttribute('hidden', available);
    if (!available) {
      setText(notice, '三维渲染不可用：当前显示同一数据的静态线框投影，参数与单步仍可浏览。');
      setText(document.querySelector('.orbit-hint'), '静态线框投影 · 参数仍可调整');
    }

    function onContextLost(event) {
      event.preventDefault(); available = false;
      host.dataset.renderer = 'fallback'; renderer.domElement.hidden = true; fallback.removeAttribute('hidden');
      notice.hidden = false; setText(notice, '三维上下文已中断，切换到静态线框；刷新可重试。'); draw();
    }
    function putPositions(geometry, values) {
      const attribute = geometry.getAttribute('position');
      if (attribute && attribute.array.length === values.length) {
        attribute.array.set(values); attribute.needsUpdate = true;
      } else geometry.setAttribute('position', new T.Float32BufferAttribute(values, 3));
    }
    function setPoints(obj, points) {
      putPositions(obj.geometry, points.flat());
      obj.geometry.computeBoundingSphere();
    }
    function face(obj, points, indices) {
      putPositions(obj.geometry, points.flat());
      if (!obj.geometry.index) obj.geometry.setIndex(indices || [0, 1, 2, 0, 2, 3]); obj.geometry.computeVertexNormals(); obj.geometry.computeBoundingSphere();
    }
    function updateGeometry() {
      if (!available) return;
      putPositions(surface.geometry, data.mesh.positions);
      if (!surface.geometry.index) surface.geometry.setIndex(new T.BufferAttribute(new Uint32Array(data.mesh.indices), 1));
      surface.geometry.computeVertexNormals(); surface.geometry.computeBoundingSphere();
      // 稀疏经纬线解释形状，不显示密集三角剖分。
      const vertices = data.mesh.positions, linePoints = [], rings = 32, sectors = 96;
      const pos = (r, a) => { const i = (r * (sectors + 1) + a) * 3; return [vertices[i], vertices[i + 1], vertices[i + 2]]; };
      for (let r = 4; r <= rings; r += 4) for (let a = 0; a < sectors; a++) linePoints.push(pos(r, a), pos(r, a + 1));
      for (let a = 0; a < sectors; a += 8) for (let r = 0; r < rings; r++) linePoints.push(pos(r, a), pos(r + 1, a));
      setPoints(wire, linePoints);
      setPoints(cutR, data.slice.positive); setPoints(cutL, data.slice.negative);
      const th = current.theta * Math.PI / 180, x = Math.cos(th) * 1.14, y = Math.sin(th) * 1.14;
      face(cutPlane, [[-x, -y, -1.26], [x, y, -1.26], [x, y, 1.26], [-x, -y, 1.26]]);
      if (data.gradient) {
        const [gx, gy] = data.gradient;
        const corners = [[-1.06, -1.06], [1.06, -1.06], [1.06, 1.06], [-1.06, 1.06]].map(([px, py]) => [px, py, gx * px + gy * py]);
        face(plane, corners);
        setPoints(residual, [data.probe.point, data.probe.linear]);
        foot.position.fromArray(pointCap(data.probe.linear));
      }
      probe.position.fromArray(pointCap(data.probe.point));
      if (data.nearby.length) {
        setPoints(slopeA, data.nearby[0].tangent); setPoints(slopeB, data.nearby[1].tangent);
        normalA.position.fromArray(data.nearby[0].point); normalB.position.fromArray(data.nearby[1].point);
      }
    }
    function cameraUpdate() {
      if (!available) return;
      const aspect = width / height, scale = Math.max(1.45, 1.55 / aspect) / pose.zoom;
      const center = width < 650 ? 0.22 : 0.05;
      camera.left = -scale * aspect; camera.right = scale * aspect;
      camera.top = scale * (1 - center); camera.bottom = -scale * (1 + center);
      camera.position.set(7 * Math.cos(pose.pitch) * Math.cos(pose.yaw), 7 * Math.cos(pose.pitch) * Math.sin(pose.yaw), 7 * Math.sin(pose.pitch));
      camera.lookAt(0, 0, 0.1); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    }
    function project(point) {
      if (available) {
        const p = new T.Vector3(...point).project(camera);
        return [(p.x + 1) * width / 2, (1 - p.y) * height / 2];
      }
      const [x, y, z] = point, c = Math.cos(pose.yaw), s = Math.sin(pose.yaw), cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch);
      const right = -s * x + c * y, up = -sp * c * x - sp * s * y + cp * (z - 0.1);
      const unit = Math.min(height / 2.9, width / 3.1) * pose.zoom;
      return [width / 2 + right * unit, height * (width < 650 ? 0.39 : 0.475) - up * unit];
    }
    function label(node, point, offset, visible = true) {
      node.hidden = !visible;
      if (!visible) return;
      const p = project(point);
      const x = clamp(p[0] + offset[0], 12, width - node.offsetWidth - 12);
      const y = clamp(p[1] + offset[1], 72, height - node.offsetHeight - 112);
      node.style.transform = `translate(${x}px,${y}px)`;
    }
    function annotations() {
      const near = current.sample === 'F4' && current.focus === 'spark';
      label(labels.origin, [0, 0, 0], [-20, 12]);
      const outside = Math.abs(data.probe.point[2]) > CAP;
      setText(labels.probe, (outside ? data.probe.value > 0 ? '↑ 超出窗口 · ' : '↓ 超出窗口 · ' : 'Q · ') + 'f = ' + f(data.probe.value));
      label(labels.probe, pointCap(data.probe.point), [20, -31], !near && layers.cut);
      setText(labels.plane, data.gradient ? '候选平面 L' + (data.gradient[0] ? ' = 0.59x' : ' = 0') : '');
      const g = data.gradient;
      label(labels.plane, [-0.68, 0.4, g ? -0.68 * g[0] + 0.4 * g[1] : 0], [-80, 10], !!g && layers.plane && !near);
      labels.slopeA.textContent = '附近 fₓ = −1'; labels.slopeB.textContent = '附近 fₓ = +1';
      label(labels.slopeA, data.nearby[0] ? data.nearby[0].point : [0, 0, 0], [-135, -70], near);
      label(labels.slopeB, data.nearby[1] ? data.nearby[1].point : [0, 0, 0], [24, -30], near);
      label(labels.axisX, [1.44, 0, 0], [3, -6]); label(labels.axisY, [0, 1.44, 0], [3, -6]); label(labels.axisZ, [0, 0, 1.47], [8, -2]);
      // 解释的引线从舞台内文本出发，终点是当前几何对象。
      let anchor = current.focus === 'direction' ? [Math.cos(current.theta * Math.PI / 180) * 0.5, Math.sin(current.theta * Math.PI / 180) * 0.5, 0.65] : pointCap(data.probe.point);
      if (current.focus === 'error' && data.probe.linear) anchor = pointCap(data.probe.point.map((v, i) => (v + data.probe.linear[i]) / 2));
      if (near) anchor = data.nearby[0].point;
      const target = project(anchor), callout = document.getElementById('sceneGuide');
      const startX = Math.min(callout.offsetLeft + callout.offsetWidth - 18, width - 16), startY = callout.offsetTop + 14;
      const endX = clamp(target[0], 12, width - 12), endY = clamp(target[1], 80, height - 110);
      document.getElementById('guideLine').setAttribute('d', `M${startX},${startY} L${startX + 18},${startY - 18} L${endX},${endY}`);
      const dot = document.getElementById('guideDot'); dot.setAttribute('cx', endX); dot.setAttribute('cy', endY);
      document.getElementById('sceneLinks').setAttribute('viewBox', `0 0 ${width} ${height}`);
      host.dataset.yaw = pose.yaw.toFixed(3); host.dataset.pitch = pose.pitch.toFixed(3);
      host.dataset.geometry = current.sample + ':' + current.theta.toFixed(2) + ':' + current.k.toFixed(2);
    }
    function clipSegment(a, b) {
      let lo = 0, hi = 1;
      const dz = b[2] - a[2];
      if (Math.abs(dz) < 1e-10) { if (Math.abs(a[2]) > CAP) return null; }
      else { const p = (-CAP - a[2]) / dz, q = (CAP - a[2]) / dz; lo = Math.max(0, Math.min(p, q)); hi = Math.min(1, Math.max(p, q)); }
      if (lo > hi) return null;
      return [a.map((v, i) => v + lo * (b[i] - v)), a.map((v, i) => v + hi * (b[i] - v))];
    }
    function fallbackDraw() {
      const paths = [];
      const add = (points, color, opacity = 1) => {
        let path = '';
        for (let i = 1; i < points.length; i++) {
          const pair = clipSegment(points[i - 1], points[i]); if (!pair) continue;
          const a = project(pair[0]), b = project(pair[1]); path += `M${a[0]},${a[1]}L${b[0]},${b[1]}`;
        }
        paths.push(`<path d="${path}" fill="none" stroke="${color}" opacity="${opacity}"/>`);
      };
      const verts = data.mesh.positions;
      const pos = (r, a) => { const i = (r * 97 + a) * 3; return [verts[i], verts[i + 1], verts[i + 2]]; };
      if (layers.surface) for (let r = 2; r <= 32; r += 2) add(Array.from({ length: 97 }, (_, a) => pos(r, a)), '#6e9c89', 0.5);
      add([[-1.3, 0, 0], [1.4, 0, 0]], '#89958a'); add([[0, -1.3, 0], [0, 1.4, 0]], '#89958a'); add([[0, 0, -1.3], [0, 0, 1.4]], '#89958a');
      if (layers.cut) { add(data.slice.positive, '#24689b'); add(data.slice.negative, '#24689b'); }
      if (data.gradient && layers.plane) { const [x, y] = data.gradient; add([[-1, -1, -x - y], [1, -1, x - y], [1, 1, x + y], [-1, 1, -x + y], [-1, -1, -x - y]], '#a07828'); }
      fallback.innerHTML = paths.join(''); fallback.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
    function draw() {
      if (disposed || !current || !data) return;
      if (available) {
        cameraUpdate(); surface.visible = wire.visible = layers.surface;
        cutR.visible = cutL.visible = cutPlane.visible = probe.visible = layers.cut;
        plane.visible = !!data.gradient && layers.plane;
        residual.visible = foot.visible = !!data.gradient && layers.plane && layers.cut;
        const near = current.sample === 'F4' && current.focus === 'spark';
        slopeA.visible = slopeB.visible = normalA.visible = normalB.visible = near;
        renderer.render(scene, camera);
      } else fallbackDraw();
      annotations();
    }
    function update(v, flags) {
      current = v; Object.assign(layers, flags || {});
      const key = v.sample + '|' + v.theta.toFixed(6) + '|' + v.k.toFixed(6);
      if (key !== geometryKey) { data = root.PDGeometry.sample(v.sample, v.theta, v.k); geometryKey = key; updateGeometry(); }
      host.style.opacity = v.alpha;
      draw();
    }
    function resize() {
      width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight);
      if (available) renderer.setSize(width, height, false); draw();
    }
    function setCamera(mode) {
      pose.zoom = 1;
      if (mode === 'top') { pose.yaw = -Math.PI / 2; pose.pitch = 1.52; }
      else if (mode === 'slice') { pose.yaw = ((current ? current.theta : 0) - 90) * Math.PI / 180; pose.pitch = 0.12; }
      else { pose.yaw = -1.02; pose.pitch = 0.57; }
      draw();
    }
    function down(e) {
      if (!available || e.target.closest('button,input,a,select,#sceneGuide')) return;
      pointer = { x: e.clientX, y: e.clientY, yaw: pose.yaw, pitch: pose.pitch };
      host.setPointerCapture(e.pointerId); host.classList.add('is-dragging');
    }
    function move(e) {
      if (!pointer) return;
      document.querySelectorAll('[data-camera]').forEach(b => b.setAttribute('aria-pressed', 'false'));
      pose.yaw = pointer.yaw - (e.clientX - pointer.x) * 0.008;
      pose.pitch = clamp(pointer.pitch + (e.clientY - pointer.y) * 0.006, -0.35, 1.52); draw();
    }
    function up() { pointer = null; host.classList.remove('is-dragging'); }
    function wheel(e) { if (!available || !e.ctrlKey) return; e.preventDefault(); pose.zoom = clamp(pose.zoom * Math.exp(-e.deltaY * 0.001), 0.65, 1.7); draw(); }
    host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move); host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up); host.addEventListener('wheel', wheel, { passive: false });
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    function dispose() {
      disposed = true; observer.disconnect();
      host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up); host.removeEventListener('wheel', wheel);
      if (renderer) { renderer.domElement.removeEventListener('webglcontextlost', onContextLost); owned.forEach(v => v.dispose()); renderer.dispose(); renderer.domElement.remove(); }
    }
    return { update, setCamera, resize, dispose, get available() { return available; } };
  }
  root.PDScene = { create };
})(window);
