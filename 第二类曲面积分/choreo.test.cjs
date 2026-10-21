'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Choreo = require('./choreo.js');

const V_KEYS = ['flat','macro','micro','theta','side','normal','xy','yz','zx','rays','sum','particles','pw','qw','rw'];
const close = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);

function cameraWeights(camera) {
  const weights = {};
  weights[camera.from] = (weights[camera.from] || 0) + 1 - camera.k;
  weights[camera.to] = (weights[camera.to] || 0) + camera.k;
  return Object.fromEntries(Object.entries(weights).filter(([, value]) => Math.abs(value) > 1e-10).sort());
}

test('exports a shared UMD object and keeps the four chapter 15-step lesson', () => {
  const source = fs.readFileSync(path.join(__dirname, 'choreo.js'), 'utf8');
  const sandbox = { window:{}, module:{ exports:{} } };
  vm.runInNewContext(source, sandbox);
  assert.equal(sandbox.window.SurfaceFluxChoreo, sandbox.module.exports);
  assert.equal(Choreo.LESSON.length, 15);
  assert.deepEqual([...Choreo.CHAPTERS], ['水怎样穿过','放大一小块','为什么看影子','把小块加起来']);
  assert.deepEqual([...Choreo.STARTS], [0,5,7,12]);
  assert.deepEqual(Choreo.LESSON.map(step => step.chapter), [0,0,0,0,0,1,1,2,2,2,2,2,3,3,3]);
  assert.ok(Choreo.LESSON.every(step => step.cue.length <= 40));
});

test('every target includes complete V and projection visibility follows the lesson', () => {
  for (let i = 0; i < Choreo.LESSON.length; i++) {
    const state = Choreo.target(i);
    assert.deepEqual(Object.keys(state).sort(), [...V_KEYS, 'cam'].sort());
    assert.ok(V_KEYS.every(key => Number.isFinite(state[key])), `missing numeric V at ${i}`);
    assert.equal(state.cam, Choreo.LESSON[i].cam || 'default');
  }
  for (let i = 0; i < 5; i++) assert.deepEqual([Choreo.target(i).pw, Choreo.target(i).qw, Choreo.target(i).rw], [0,0,1]);
  assert.deepEqual([Choreo.target(9).pw, Choreo.target(9).qw, Choreo.target(9).rw], [1,0,0]);
  assert.deepEqual([Choreo.target(10).pw, Choreo.target(10).qw, Choreo.target(10).rw], [0,1,0]);
  assert.deepEqual([Choreo.target(11).pw, Choreo.target(11).qw, Choreo.target(11).rw], [1,1,1]);
});

test('adjacent step endpoints are continuous in geometry, camera position, text opacity and labels', () => {
  for (let i = 0; i < Choreo.LESSON.length - 1; i++) {
    const end = Choreo.frame(i, 1);
    const start = Choreo.frame(i + 1, 0);
    for (const key of V_KEYS) close(end.V[key], start.V[key]);
    assert.deepEqual(cameraWeights(end.camera), cameraWeights(start.camera));
    for (const field of ['caption','cue','labels']) {
      assert.equal(end[field].index, start[field].index, `${field} content at ${i}/${i + 1}`);
      close(end[field].alpha, start[field].alpha);
    }
    close(end.focus, 0);
    close(start.focus, 0);
  }
});

test('sample is deterministic after arbitrary forward and backward seeks', () => {
  const times = [0, 12.4, 1, 4.75, 30, 8, Choreo.DURATION, 19.1, 0.1, 22.8, 1];
  const snapshots = new Map();
  for (const time of times) {
    const first = Choreo.sample(time);
    const second = Choreo.sample(time);
    assert.deepEqual(first, second);
    snapshots.set(time, first);
  }
  for (const time of times) assert.deepEqual(Choreo.sample(time), snapshots.get(time));
});

test('the 64-piece accumulation is linear for eight seconds and remains complete', () => {
  const begin = Choreo.ENDS[12];
  const end = Choreo.ENDS[13];
  close(end - begin, 8);
  close(Choreo.sample(begin).V.sum, 0);
  close(Choreo.sample(begin + 2).V.sum, 0.25);
  close(Choreo.sample(begin + 4).V.sum, 0.5);
  close(Choreo.sample(begin + 6).V.sum, 0.75);
  close(Choreo.sample(end).V.sum, 1);
  close(Choreo.sample(Choreo.DURATION).V.sum, 1);
  close(Choreo.frame(14, 0.5).V.sum, 1);
});

