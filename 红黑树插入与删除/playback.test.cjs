const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { RBTree } = require('./model.js');

// Run the actual controller against a small DOM adapter and a deterministic frame clock.
function setup() {
  class Element {
    constructor() {
      this.listeners = {}; this.value = ''; this.attributes = {}; this.style = { setProperty() {} };
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    fire(type, extra = {}) { this.listeners[type]?.({ target: this, preventDefault() {}, ...extra }); }
    setAttribute(k, v) { this.attributes[k] = v; }
    toggleAttribute(k, v) { this.attributes[k] = v; }
    replaceChildren(...children) { this.children = children; }
    getBoundingClientRect() { return { left: 0, top: 0 }; }
    closest() { return null; }
    focus() {} select() {}
  }
  const elements = new Map(), doc = new Element(), win = new Element();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  let clock = 0, renderer, paints = 0, ticks = 0, nextRaf = 1, maxPending = 0;
  const callbacks = new Map();
  class Renderer {
    constructor() { renderer = this; this.reduced = false; this.hover = null; this.message = null; this.history = []; }
    setFrame(frame) { this.frame = frame; this.history.push(frame); }
    update(dt, progress) { this.progress = progress; paints++; }
    needsAnimation() { return false; }
    say(title, text) { this.message = { title, text }; }
    hit() { return null; }
  }
  doc.body = new Element(); doc.getElementById = el; doc.createElement = () => new Element(); doc.querySelector = el;
  win.RedBlack = { RBTree }; win.RedBlackVisual = { TreeRenderer: Renderer };
  const context = { window: win, document: doc, performance: { now: () => clock },
    requestAnimationFrame(fn) { const id = nextRaf++; callbacks.set(id, fn); maxPending = Math.max(maxPending, callbacks.size); return id; },
    cancelAnimationFrame(id) { callbacks.delete(id); } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/app.js`, 'utf8'), context);
  const advance = ms => { for (let i = 0; i < ms; i += 20) { clock += 20; const batch = [...callbacks.values()]; callbacks.clear(); for (const fn of batch) { ticks++; fn(clock); } } };
  const click = id => el(id).fire('click');
  const choose = key => { el('scenario').value = key; el('scenario').fire('change'); };
  const jump = index => { el('progress').value = index; el('progress').fire('input'); };
  const submit = value => { el('value-input').value = String(value); el('operation-form').fire('submit'); };
  const current = () => renderer.frame;
  const values = () => current().tree.nodes.map(n => n.value).sort((a, b) => a - b);
  return { el, click, choose, jump, submit, advance, current, values, renderer, doc, counts: () => ({ paints, ticks }), peakPending: () => maxPending };
}

test('all eight presets actually show the advertised repair', () => {
  const expected = { rotate: 'rotate', zigzag: 'rotate', recolor: 'recolor-up', borrow: 'borrow',
    near: 'borrow', sibling: 'rotate', push: 'push-black', successor: 'replace' };
  for (const [key, type] of Object.entries(expected)) {
    const app = setup(); app.choose(key); app.click('play'); app.advance(35000);
    assert.ok(app.renderer.history.some(f => f.type === type), `${key}: missing ${type}`);
    if (key === 'zigzag') assert.equal(app.renderer.history.filter(f => f.type === 'rotate').length, 2);
    assert.equal(app.current().type, 'settle');
    assert.equal(app.current().report.valid, true);
    assert.equal(app.el('play').attributes['aria-label'], '播放演示');
  }
});

test('pause freezes the current animation and resume completes without skipping frames', () => {
  const app = setup(); app.click('play'); app.advance(2100); app.click('play');
  const frame = app.current(), progress = app.renderer.progress;
  app.advance(2000);
  assert.equal(app.current(), frame); assert.equal(app.renderer.progress, progress);
  app.click('play'); app.advance(22000);
  assert.equal(app.current().type, 'settle');
  assert.equal(app.renderer.history.filter(f => f.type === 'rotate').length, 1);
});

test('rapid stepping, restart, and scenario changes leave one animation clock', () => {
  const app = setup();
  for (let i = 0; i < 6; i++) app.click('next');
  app.advance(1000); assert.equal(app.current().type, 'spawn');
  app.click('play'); app.advance(1000); app.click('restart'); app.advance(9000);
  assert.equal(app.current().type, 'ready'); assert.equal(app.el('progress').value, '0');
  app.click('play'); app.advance(500); app.choose('borrow'); app.advance(18000);
  assert.equal(app.current().type, 'ready'); assert.deepEqual(app.values(), [20, 40, 60, 70]);
});

test('changing speed midflight continues the current microstep', () => {
  const app = setup(); app.click('play'); app.advance(260); const frame = app.current();
  app.click('speed'); assert.equal(app.current(), frame);
  app.advance(4000); app.click('speed'); app.advance(12000);
  assert.equal(app.current().type, 'settle');
});

test('new operations use the displayed stable tree and reject incomplete fixups', () => {
  const app = setup();
  app.click('play'); app.advance(1100); app.submit(99);
  assert.equal(app.renderer.message.title, '先让当前操作完成');
  app.advance(18000); assert.ok(app.values().includes(5));
  app.submit(99); app.advance(20000); assert.ok(app.values().includes(99));
  app.choose('empty'); app.submit(7); app.advance(8000); assert.deepEqual(app.values(), [7]);
  app.click('mode-delete'); app.submit(7); app.advance(8000); assert.deepEqual(app.values(), []);
  assert.equal(app.el('empty-message').hidden, false);
});

test('invalid, duplicate, missing, and oversized inputs leave the tree intact', () => {
  const app = setup(), before = app.values();
  for (const value of ['', 'x', '1.5', '1e2', '1000']) {
    app.submit(value); assert.equal(app.renderer.message.title, '需要一个整数'); assert.deepEqual(app.values(), before);
  }
  app.submit(60); app.advance(8000); assert.equal(app.current().type, 'reject'); assert.deepEqual(app.values(), before);
  app.click('mode-delete'); app.submit(999); app.advance(8000); assert.equal(app.current().type, 'reject'); assert.deepEqual(app.values(), before);
  app.choose('empty');
  for (let n = 0; n < 31; n++) { app.submit(n); app.advance(25000); }
  app.submit(31); assert.equal(app.renderer.message.title, '舞台已有 31 个节点'); assert.equal(app.values().length, 31);
});

test('scrubbing backward restores colors and links from the corresponding snapshot', () => {
  const frames = RBTree.from([60, 30, 80, 20, 45, 70, 90, 10]).insert(5);
  const app = setup(); app.jump(frames.findIndex(f => f.type === 'rotate')); app.advance(2000);
  const rotated = app.current().tree;
  app.jump(7); app.advance(1500);
  const conflict = app.current().tree;
  assert.notDeepEqual(rotated, conflict);
  assert.equal(app.current().type, 'conflict');
  assert.equal(app.el('play').attributes['aria-label'], '播放演示');
  app.jump(0); app.advance(1500); assert.deepEqual(app.values(), [10, 20, 30, 45, 60, 70, 80, 90]);
});

test('hiding the page pauses playback instead of racing forward after resume', () => {
  const app = setup(); app.click('play'); app.advance(1000);
  app.doc.hidden = true; app.doc.fire('visibilitychange');
  const before = app.current(); app.advance(15000); assert.equal(app.current(), before);
  app.doc.hidden = false; app.doc.fire('visibilitychange');
  app.click('play'); app.advance(18000); assert.equal(app.current().type, 'settle');
});

test('idle and paused scenes stop requesting and painting frames, then resume on interaction', () => {
  const app = setup(); app.advance(1000);
  const idle = app.counts(); app.advance(10000); assert.deepEqual(app.counts(), idle);
  app.click('play'); app.advance(2100); app.click('play'); app.advance(1000);
  const paused = app.counts(); app.advance(10000); assert.deepEqual(app.counts(), paused);
  app.click('play'); app.advance(18000); assert.equal(app.current().type, 'settle');
  const done = app.counts(); app.advance(10000); assert.deepEqual(app.counts(), done);
});

test('transitions and repeated control input never fork the animation loop', () => {
  const app = setup(); app.click('play'); app.advance(20000);
  app.choose('sibling'); app.click('play'); app.advance(20000);
  for (let i = 0; i < 12; i++) app.click('next');
  app.click('restart'); app.click('play'); app.advance(20000);
  assert.equal(app.peakPending(), 1, 'more than one callback was scheduled for the same animation');
});
