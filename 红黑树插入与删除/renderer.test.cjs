const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { RBTree } = require('./model.js');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(`${__dirname}/renderer.js`, 'utf8'), context);
const { TreeRenderer, layout } = context.window.RedBlackVisual;

test('layout centers the root, keeps search order, and represents every NIL', () => {
  const tree = RBTree.from([60, 30, 80, 20, 45, 70, 90, 10]).snapshot();
  const stage = layout(tree);
  assert.equal(stage.points.get(tree.root).x, 0);
  assert.equal(stage.points.get(tree.root).y, 0);
  const real = [...stage.points.values()].filter(p => !p.nil).sort((a, b) => a.value - b.value);
  for (let i = 1; i < real.length; i++) assert.ok(real[i].x > real[i - 1].x);
  assert.equal([...stage.points.values()].filter(p => p.nil).length, tree.nodes.length + 1);
  for (const n of tree.nodes) for (const side of ['left', 'right']) {
    const child = stage.points.get(n[side] || `nil-${n.id}-${side}`);
    assert.ok(child.y > stage.points.get(n.id).y);
    assert.equal(child.parent, n.id);
  }
});

test('successor ghost travels from the successor up the original branch to the deleted position', () => {
  const tree = RBTree.from([60, 30, 80, 20, 45, 70, 90, 65, 75]);
  const frame = tree.delete(60).find(f => f.type === 'replace');
  const r = Object.create(TreeRenderer.prototype), calls = [];
  r.frame = frame; r.screen = layout(frame.tree).points; r.camera = { scale: 1 };
  r.ctx = { save() {}, restore() {} }; r.sphere = p => calls.push(p); r.dust = () => {};
  r.progress = 0; r.successor();
  const source = r.screen.get(frame.successor.source);
  assert.equal(calls.at(-1).x, source.x); assert.equal(calls.at(-1).y, source.y);
  r.progress = 1; r.successor();
  const target = r.screen.get(frame.successor.target);
  assert.equal(calls.at(-1).x, target.x); assert.equal(calls.at(-1).y, target.y);
});

test('empty layout supplies a focusable debt origin without fake real nodes', () => {
  const stage = layout({ root: null, nodes: [] });
  assert.equal(stage.points.size, 1);
  assert.equal(stage.points.get('nil-root').nil, true);
  assert.equal(stage.points.get('nil-root').x, 0);
});

function renderHarness() {
  const calls = { filter: 0, shadow: 0, blits: 0, surfaces: [] };
  function ctx(main = false) {
    return new Proxy({ createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
      measureText: text => ({ width: text.length * 6 }), drawImage() { if (main) calls.blits++; } }, {
      get(target, key) { return key in target ? target[key] : () => {}; },
      set(target, key, value) {
        if (main && key === 'filter' && value !== 'none') calls.filter++;
        if (main && key === 'shadowBlur' && value > 0) calls.shadow++;
        target[key] = value; return true;
      }
    });
  }
  const main = ctx(true), canvas = { width: 0, height: 0, getContext: () => main, getBoundingClientRect: () => ({ width: 1280, height: 720 }) };
  const document = { createElement() { const surface = { width: 0, height: 0, getContext: () => ctx() }; calls.surfaces.push(surface); return surface; } };
  const sandbox = { window: { devicePixelRatio: 2, addEventListener() {} }, document,
    matchMedia: () => ({ matches: false, addEventListener() {} }) };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/renderer.js`, 'utf8'), sandbox);
  const note = { style: {}, dataset: {}, classList: { add() {}, remove() {} } };
  const r = new sandbox.window.RedBlackVisual.TreeRenderer(canvas, note);
  r.updateNote = () => {};
  return { r, calls, canvas };
}

test('node blur and shadows are baked into small cached surfaces, never applied to the main canvas', () => {
  const { r, calls } = renderHarness();
  const tree = RBTree.from([60, 30, 80, 20, 45, 70, 90, 10]);
  r.setFrame(tree.insert(5).find(f => f.type === 'conflict'));
  for (let i = 0; i < 120; i++) r.update(1 / 60, 1, true);
  assert.equal(calls.filter, 0, 'full-stage blur was reapplied');
  assert.equal(calls.shadow, 0, 'per-frame shadows were reapplied');
  assert.ok(calls.blits > 0, 'nodes must use cached sprite blits');
  assert.ok(calls.surfaces.length > 0 && calls.surfaces.length <= 8);
  assert.ok(calls.surfaces.every(s => s.width <= 320 && s.height <= 320));
  const count = calls.surfaces.length;
  for (let i = 0; i < 120; i++) r.update(1 / 60, 1, true);
  assert.equal(calls.surfaces.length, count, 'cache grows while the tree is unchanged');
});

test('canvas pixel budget prevents high-DPI screens from multiplying frame work', () => {
  const { canvas } = renderHarness();
  assert.ok(canvas.width * canvas.height <= 2500000);
});

test('the real renderer finishes its camera and brightness settling, then requests no more idle animation', () => {
  const { r } = renderHarness();
  const tree = RBTree.from([60, 30, 80, 20, 45, 70, 90, 10]);
  const frames = tree.insert(5);
  for (const frame of [frames[0], frames.find(f => f.type === 'conflict'), frames.at(-1)]) {
    r.setFrame(frame);
    for (let i = 0; i < 300; i++) r.update(1 / 60, 1, false);
    assert.equal(r.needsAnimation(), false, `${frame.type} never became idle`);
  }
});

test('changed rotation links remain absent throughout movement and only reappear during reconnection', () => {
  const tree = RBTree.from([60, 30, 80, 20, 45, 70, 90, 10]);
  const frames = tree.insert(5), move = frames.findIndex(f => f.type === 'rotate');
  const detach = frames[move - 1], rotate = frames[move], attach = frames[move + 1];
  assert.equal(detach.type, 'rotation-detach');
  assert.equal(attach.type, 'rotation-attach');
  const { r } = renderHarness();
  const oldEdges = r.edgeList(rotate.rotation.beforeTree), newEdges = r.edgeList(rotate.rotation.afterTree);
  const oldKeys = new Set(oldEdges.map(e => e.key)), newKeys = new Set(newEdges.map(e => e.key));
  const changedOld = oldEdges.filter(e => !newKeys.has(e.key)).map(e => e.key);
  const changedNew = newEdges.filter(e => !oldKeys.has(e.key)).map(e => e.key);
  const stable = newEdges.filter(e => oldKeys.has(e.key)).map(e => e.key);
  let visible = [];
  r.edge = (e, alpha) => { if (alpha > .001) visible.push(e.key); };
  r.setFrame(detach, true); r.update(1 / 60, 1, false);
  assert.ok(changedOld.every(key => !visible.includes(key)));
  const oldPositions = [...r.display.values()].filter(p => !p.nil).map(p => [p.id, p.x, p.y]);
  r.update(1 / 60, .5, false);
  assert.deepEqual([...r.display.values()].filter(p => !p.nil).map(p => [p.id, p.x, p.y]), oldPositions);
  r.setFrame(rotate);
  const camera = { x: r.camera.x, y: r.camera.y, scale: r.camera.scale };
  for (const progress of [0, .25, .5, .75, 1]) {
    visible = []; r.update(1 / 60, progress, false);
    assert.ok([...changedOld, ...changedNew].every(key => !visible.includes(key)), `rewired too early at ${progress}`);
    assert.ok(stable.every(key => visible.includes(key)));
    assert.deepEqual({ x: r.camera.x, y: r.camera.y, scale: r.camera.scale }, camera);
  }
  r.setFrame(attach);
  visible = []; r.update(1 / 60, 0, false); assert.ok(changedNew.every(key => !visible.includes(key)));
  const newPositions = [...r.display.values()].filter(p => !p.nil).map(p => [p.id, p.x, p.y]);
  visible = []; r.update(1 / 60, 1, false);
  assert.ok(changedNew.every(key => visible.includes(key)));
  assert.deepEqual([...r.display.values()].filter(p => !p.nil).map(p => [p.id, p.x, p.y]), newPositions);
});

test('resizing a locked rotation view keeps both moving nodes on the smaller screen', () => {
  const tree = RBTree.from([60, 30, 80, 20, 45, 70, 90, 10]);
  const frame = tree.insert(5).find(f => f.type === 'rotation-detach'), { r, canvas } = renderHarness();
  r.setFrame(frame, true); r.update(1 / 60, 1, false);
  canvas.getBoundingClientRect = () => ({ width: 390, height: 844 });
  r.resize(); r.update(1 / 60, 1, false);
  const margin = 25 * r.camera.scale;
  for (const id of [frame.rotation.pivot, frame.rotation.up]) {
    const point = r.screen.get(id);
    assert.ok(point.x >= margin && point.x <= r.w - margin, `${id} clipped during resize`);
  }
});

test('a rotation turns the pivot and the rising node about one shared center and never lets them pass through each other', () => {
  const frames = RBTree.from([60, 30, 80, 20, 45, 70, 90, 10]).insert(5), i = frames.findIndex(f => f.type === 'rotate');
  const { pivot, up } = frames[i].rotation, { r } = renderHarness();
  r.setFrame(frames[i - 1], true); r.update(1 / 60, 1, false);
  r.setFrame(frames[i]);
  const c = r.spiral.c, at = id => { const p = r.rotationBefore.points.get(id); return [p.x, p.y]; };
  const P0 = at(pivot), Q0 = at(up);
  // ratio of (point − center) to its starting offset: a rigid turn gives the same ratio for every point on it
  const ratio = (p, o) => {
    const zr = p.x - c[0], zi = p.y - c[1], wr = o[0] - c[0], wi = o[1] - c[1], n = wr * wr + wi * wi;
    return [(zr * wr + zi * wi) / n, (zi * wr - zr * wi) / n];
  };
  let gap = Infinity;
  for (const progress of [0, .2, .4, .6, .8, 1]) {
    r.update(1 / 60, progress, false);
    const P = r.display.get(pivot), Q = r.display.get(up);
    if (progress > 0 && progress < 1) {
      const a = ratio(P, P0), b = ratio(Q, Q0);
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9, `pivot and rising node do not turn together at ${progress}`);
    }
    gap = Math.min(gap, Math.hypot(P.x - Q.x, P.y - Q.y));
  }
  assert.ok(gap > 60, `the two nodes came within ${gap} of each other`);
  r.update(1 / 60, 1, false);
  for (const [id, point] of r.rotationAfter.points) {
    if (point.nil) continue;
    const shown = r.display.get(id);
    assert.ok(Math.hypot(shown.x - point.x, shown.y - point.y) < 1e-6, `${id} did not arrive at its new place`);
  }
});
