'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('./model.js');
const G = require('./geometry.js');
const M = globalThis.PDModel;

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${actual} is not close to ${expected}`);
}

test('F1 mesh stays away from P and its 45 degree path preserves true height', () => {
  for (const k of [0, 7, 9]) {
    const data = G.sample('F1', 45, k);
    const { positions, indices } = data.mesh;
    for (let i = 0; i < positions.length; i += 3) {
      assert.ok(Number.isFinite(positions[i]));
      assert.ok(Number.isFinite(positions[i + 1]));
      assert.ok(Number.isFinite(positions[i + 2]));
      assert.ok(Math.hypot(positions[i], positions[i + 1]) >= 0.018 - 1e-7);
    }
    for (const index of indices) assert.ok(index >= 0 && index < positions.length / 3);
    for (const point of data.slice.positive) close(point[2], 0.5 / data.rho, 1e-7);
    close(data.probe.value, M.value('F1', data.rho * data.probe.point[0], data.rho * data.probe.point[1]));
  }
});

test('F2 probe and surface vertices preserve the cone values', () => {
  const data = G.sample('F2', 0, 7);
  close(data.probe.value, Math.hypot(data.rho * data.probe.point[0], data.rho * data.probe.point[1]));
  for (let i = 0; i < data.mesh.positions.length; i += 3) {
    const [x, y, z] = data.mesh.positions.slice(i, i + 3);
    close(z, M.value('F2', data.rho * x, data.rho * y) / data.rho, 2e-6);
  }
});

test('F3 geometric sample scales while the global model error ratio remains one half', () => {
  for (const k of [0, 7, 9]) {
    const data = G.sample('F3', 45, k);
    close(data.probe.ratio, 0.5, 1e-8);
    close(M.errorRatio('F3', data.rho), 0.5);
    close(data.probe.value / data.rho, 0.72 * Math.cos(Math.PI / 4) * Math.sin(Math.PI / 4));
  }
});

test('F4 nearby x-axis points expose opposite unit slopes with model values', () => {
  const data = G.sample('F4', 0, 9);
  assert.equal(data.nearby.length, 2);
  close(data.nearby[0].slope, -1);
  close(data.nearby[1].slope, 1);
  for (const nearby of data.nearby) {
    close(nearby.point[2], M.value('F4', nearby.r, 0) / data.rho);
    close(nearby.tangent[1][2] - nearby.tangent[0][2], 0.36 * nearby.slope);
  }
});

test('F0 gradient and probe linearization match the model candidate', () => {
  for (const theta of [0, 45, 90]) {
    const data = G.sample('F0', theta, 7);
    const grad = M.byId.F0.gradAtP;
    assert.deepEqual(data.gradient, [grad.x, grad.y]);
    close(data.probe.linearValue, grad.x * data.rho * data.probe.point[0] + grad.y * data.rho * data.probe.point[1]);
    close(data.probe.residual, data.probe.value - data.probe.linearValue);
    close(data.probe.ratio, Math.abs(data.probe.residual) / (0.72 * data.rho));
  }
});

test('all sample meshes and slices are finite and mesh indices stay in bounds', () => {
  for (const id of M.order) {
    for (const k of [0, 7, 9]) {
      const data = G.sample(id, 37, k);
      assert.equal(data.slice.positive.length, 160);
      assert.equal(data.slice.negative.length, 160);
      for (const point of [...data.slice.positive, ...data.slice.negative]) {
        assert.equal(point.length, 3);
        assert.ok(point.every(Number.isFinite));
      }
      for (const value of data.mesh.positions) assert.ok(Number.isFinite(value));
      for (const index of data.mesh.indices) assert.ok(index >= 0 && index < data.mesh.positions.length / 3);
    }
  }
});
