const test = require('node:test');
const assert = require('node:assert/strict');
const { RBTree, propertyFrames } = require('./model.js');

function check(tree, expected) {
  const report = tree.validate();
  assert.equal(report.valid, true, report.errors.join('; '));
  assert.deepEqual(tree.values(), [...expected].sort((a, b) => a - b));
  const snapshot = tree.snapshot();
  const byId = new Map(snapshot.nodes.map(n => [n.id, n]));
  function walk(id, lower = -Infinity, upper = Infinity, parent = null) {
    if (id === null) return 1;
    const n = byId.get(id);
    assert.ok(n.value > lower && n.value < upper);
    assert.equal(n.parent, parent);
    if (n.color === 'red') {
      assert.notEqual(byId.get(n.left)?.color, 'red');
      assert.notEqual(byId.get(n.right)?.color, 'red');
    }
    const l = walk(n.left, lower, n.value, id), r = walk(n.right, n.value, upper, id);
    assert.equal(l, r, `black height at ${n.value}`);
    return l + (n.color === 'black' ? 1 : 0);
  }
  if (snapshot.root !== null) assert.equal(byId.get(snapshot.root).color, 'black');
  walk(snapshot.root);
}

test('four insertion geometries rotate into a balanced ordered tree', () => {
  for (const values of [[30, 20, 10], [10, 20, 30], [30, 10, 20], [10, 30, 20]]) {
    const tree = new RBTree();
    let frames;
    for (const value of values) { frames = tree.insert(value); check(tree, tree.values()); }
    assert.equal(tree.snapshot().nodes.find(n => n.id === tree.snapshot().root).value, 20);
    assert.ok(frames.some(f => f.type === 'rotate'));
    assert.equal(frames.at(-1).type, 'settle');
  }
});

test('red uncle recolors upward, then the root cools to black', () => {
  const tree = RBTree.from([30, 20, 40]);
  const frames = tree.insert(10);
  assert.ok(frames.some(f => f.type === 'recolor-up'));
  assert.ok(frames.some(f => f.type === 'root-cool'));
  check(tree, [10, 20, 30, 40]);
});

test('successor replacement is visible and leaves a single successor key', () => {
  const tree = RBTree.from([60, 30, 80, 20, 45, 70, 90, 65, 75]);
  const frames = tree.delete(60);
  assert.ok(frames.some(f => f.type === 'successor'));
  assert.ok(frames.some(f => f.type === 'replace'));
  const replacement = frames.find(f => f.type === 'replace').successor;
  assert.equal(replacement.path[0], replacement.source);
  assert.equal(replacement.path.at(-1), replacement.target);
  assert.ok(frames.some(f => f.type === 'remove'));
  check(tree, [30, 80, 20, 45, 70, 90, 65, 75]);
});

test('rejected operations never mutate the tree or consume identifiers', () => {
  const tree = RBTree.from([5, -2, 9]);
  const before = tree.snapshot();
  assert.equal(tree.insert(5).at(-1).type, 'reject');
  assert.equal(tree.delete(100).at(-1).type, 'reject');
  assert.deepEqual(tree.snapshot(), before);
  for (const bad of [NaN, Infinity, 1.5, '4', null]) assert.throws(() => tree.insert(bad));
});

test('root, empty tree, and black node with a red replacement are handled', () => {
  const tree = RBTree.from([10, 5]);
  assert.ok(tree.delete(10).some(f => f.type === 'absorb'));
  check(tree, [5]);
  tree.delete(5);
  check(tree, []);
  assert.equal(tree.delete(5).at(-1).type, 'reject');
  tree.insert(8);
  check(tree, [8]);
});

test('random mixed operations preserve every invariant and exercise deletion cases on both sides', () => {
  const cases = new Set();
  let seed = 481516;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let run = 0; run < 30; run++) {
    const tree = new RBTree(), expected = new Set();
    for (let step = 0; step < 240; step++) {
      const value = Math.floor(random() * 65) - 32;
      const add = random() < 0.5;
      const frames = add ? tree.insert(value) : tree.delete(value);
      if (add) expected.add(value); else expected.delete(value);
      frames.forEach(f => { if (f.case) cases.add(`${f.case}:${f.side}`); });
      check(tree, expected);
    }
    for (const value of [...expected]) { tree.delete(value); expected.delete(value); check(tree, expected); }
  }
  for (const c of ['sibling-red', 'push-black', 'near-red', 'far-red']) {
    for (const side of ['left', 'right']) assert.ok(cases.has(`${c}:${side}`), `${c}:${side} not covered`);
  }
});

test('recorded snapshots stay immutable after subsequent changes', () => {
  const tree = RBTree.from([20, 10, 30]);
  const frames = tree.insert(5), before = JSON.stringify(frames);
  tree.delete(20);
  tree.insert(40);
  assert.equal(JSON.stringify(frames), before);
});

test('continuing from a stable snapshot preserves shape, colors, and unique IDs', () => {
  const original = RBTree.from([60, 30, 80, 20, 45, 70, 90, 10]);
  const copy = RBTree.fromSnapshot(original.snapshot());
  assert.deepEqual(copy.snapshot(), original.snapshot());
  copy.insert(5); copy.delete(60); copy.insert(99);
  check(copy, [5, 10, 20, 30, 45, 70, 80, 90, 99]);
  assert.equal(new Set(copy.snapshot().nodes.map(n => n.id)).size, 9);
});

test('each left/right rotation records a stationary disconnect, then movement, then reconnection', () => {
  for (const values of [[30, 20, 10], [10, 20, 30], [30, 10, 20], [10, 30, 20]]) {
    const tree = RBTree.from(values.slice(0, 2));
    const frames = tree.insert(values.at(-1));
    frames.forEach((f, i) => {
      if (f.type !== 'rotate') return;
      assert.equal(frames[i - 2].type, 'anticipate');
      assert.equal(frames[i - 1].type, 'rotation-detach');
      assert.equal(frames[i + 1].type, 'rotation-attach');
      assert.deepEqual(frames[i - 1].tree, f.rotation.beforeTree);
      assert.deepEqual(f.tree, f.rotation.afterTree);
      assert.deepEqual(frames[i + 1].tree, f.tree);
      assert.notDeepEqual(f.tree, frames[i - 1].tree);
      const up = f.tree.nodes.find(n => n.id === f.rotation.up);
      assert.equal(up[f.rotation.direction === 'left' ? 'left' : 'right'], f.rotation.pivot);
      assert.equal(f.duration, 1200);
    });
    check(tree, values);
  }
});

test('nonempty middle subtrees are detached from the rising node and reattached to the descending node on both sides', () => {
  for (const [values, removed] of [[[10, 5, 20, 15, 25, 13], 5], [[30, 35, 20, 25, 15, 27], 35]]) {
    const tree = RBTree.from(values), frames = tree.delete(removed);
    const rotation = frames.find(f => f.type === 'rotate' && f.rotation.transfer);
    assert.ok(rotation, 'missing middle subtree handoff');
    const meta = rotation.rotation, beforeUp = meta.beforeTree.nodes.find(n => n.id === meta.up);
    const afterPivot = meta.afterTree.nodes.find(n => n.id === meta.pivot);
    const afterTransfer = meta.afterTree.nodes.find(n => n.id === meta.transfer);
    assert.equal(beforeUp[meta.direction === 'left' ? 'left' : 'right'], meta.transfer);
    assert.equal(afterPivot[meta.direction === 'left' ? 'right' : 'left'], meta.transfer);
    assert.equal(afterTransfer.parent, meta.pivot);
    check(tree, values.filter(v => v !== removed));
  }
});

const PROPERTIES = ['root', 'redred', 'blackpath', 'nil', 'height', 'order'];

test('property checks read the stable tree, never change it, and pass on a balanced tree', () => {
  const tree = RBTree.from([60, 30, 80, 20, 45, 70, 90, 10]), snapshot = tree.snapshot(), before = JSON.stringify(snapshot);
  for (const key of PROPERTIES) {
    const frames = propertyFrames(snapshot, key);
    assert.ok(frames.length >= 1, key);
    assert.ok(frames.every(f => f.type === 'check' && f.tree === snapshot), key);
    assert.equal(frames.at(-1).verdict, true, `${key} did not pass`);
  }
  assert.equal(JSON.stringify(snapshot), before);
});

test('black-path frames count each root-to-NIL path exactly as the validator does', () => {
  const tree = RBTree.from([60, 30, 80, 20, 45, 70, 90, 10, 5]), snapshot = tree.snapshot();
  const byId = new Map(snapshot.nodes.map(n => [n.id, n]));
  const steps = propertyFrames(snapshot, 'blackpath').filter(f => f.flow.length === 1);
  assert.equal(steps.length, snapshot.nodes.length + 1, 'one step per NIL leaf');
  for (const step of steps) {
    const blacks = step.flow[0].filter(id => byId.get(id)?.color === 'black').length + 1;
    assert.equal(blacks, tree.validate().blackHeight);
  }
});

test('property checks reject broken trees instead of approving every snapshot', () => {
  const node = (id, value, color, left, right, parent) => ({ id, value, color, left, right, parent });
  const redRed = { root: 'a', nodes: [node('a', 5, 'black', 'b', null, null), node('b', 3, 'red', 'c', null, 'a'), node('c', 1, 'red', null, null, 'b')] };
  assert.equal(propertyFrames(redRed, 'redred').at(-1).verdict, false);
  const redRoot = { root: 'a', nodes: [node('a', 5, 'red', null, null, null)] };
  assert.equal(propertyFrames(redRoot, 'root').at(-1).verdict, false);
  const unequal = { root: 'a', nodes: [node('a', 5, 'black', 'b', 'c', null), node('b', 3, 'black', null, null, 'a'),
    node('c', 8, 'black', 'd', null, 'a'), node('d', 9, 'black', null, null, 'c')] };
  assert.equal(propertyFrames(unequal, 'blackpath').at(-1).verdict, false);
  const disordered = { root: 'a', nodes: [node('a', 5, 'black', 'b', null, null), node('b', 9, 'black', null, null, 'a')] };
  assert.equal(propertyFrames(disordered, 'order').at(-1).verdict, false);
});

test('random balanced trees pass every property check', () => {
  let seed = 90210;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let run = 0; run < 20; run++) {
    const tree = new RBTree();
    for (let step = 0; step < 60; step++) {
      const value = Math.floor(random() * 99) - 49;
      if (random() < 0.6) tree.insert(value); else tree.delete(value);
    }
    for (const key of PROPERTIES) assert.equal(propertyFrames(tree.snapshot(), key).at(-1).verdict, true, key);
  }
});

test('the empty tree satisfies every property trivially', () => {
  for (const key of PROPERTIES) {
    const frames = propertyFrames(new RBTree().snapshot(), key);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].verdict, true);
  }
});
