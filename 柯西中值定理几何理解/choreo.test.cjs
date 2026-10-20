const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const C = require('./choreo.js');
const visual = f => ({ t: f.t, secant: f.secant, tangent: f.tangent, marks: f.marks, confirm: f.confirm, focus: f.focus, title: f.title, caption: f.caption, alpha: f.alpha });
test('every stage joins the next with exactly the same visual state', () => {
  for (const key of Object.keys(M.PRESETS)) {
    const p = M.PRESETS[key], sequence = C.build(M.analyze(key, p.a, p.b));
    for (let i = 0; i < sequence.steps.length - 1; i++) assert.deepEqual(visual(C.frameAt(sequence, i, 1)), visual(C.frameAt(sequence, i + 1, 0)), `${key}/${i}`);
  }
});
test('scrubbing forward and backward is deterministic and ends at real parallel points', () => {
  const s = C.build(M.analyze('multi-xi', -2.2, 2.2));
  const a = C.sample(s, 3.17); C.sample(s, s.duration); C.sample(s, 0);
  assert.deepEqual(C.sample(s, 3.17), a);
  const end = C.sample(s, s.duration);
  assert.equal(end.confirm, 1); assert.ok(end.marks.every(x => x === 1));
  assert.ok(M.snapshot(M.analyze('multi-xi', -2.2, 2.2), end.t).matched);
});
test('scan moves before the confirmation appears; captions have a zero-opacity handoff', () => {
  const s = C.build(M.analyze('rolle', -2, 2));
  const scan = C.frameAt(s, 1, .5);
  assert.equal(scan.confirm, 0); assert.equal(scan.marks[0], 0); assert.ok(scan.t > -2 && scan.t < 0);
  const confirm = C.frameAt(s, 2, .5);
  assert.equal(confirm.confirm, 0); assert.equal(confirm.t, 0);
  assert.equal(C.frameAt(s, 1, .12).alpha, 0);
});
