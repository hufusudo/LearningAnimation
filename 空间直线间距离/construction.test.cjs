const test = require('node:test');
const assert = require('node:assert/strict');
const { lineDistanceConstruction, projectionPlaneConstruction } = require('./construction.js');

test('异面直线距离是任意连线在叉积方向上的投影长度', () => {
  const first = lineDistanceConstruction([0, 0, 2], [1, 0, 0], [2, 1, -1], [0, 1, 0]);
  assert.deepEqual(first.normal, [0, 0, 1]);
  assert.deepEqual(first.connector, [2, 1, -3]);
  assert.deepEqual(first.foot, [0, 0, -1]);
  assert.equal(first.signedProjection, -3);
  assert.equal(first.distance, 3);

  const otherPoints = lineDistanceConstruction([4, 0, 2], [1, 0, 0], [2, -5, -1], [0, 1, 0]);
  assert.equal(otherPoints.distance, 3);
});

test('方向平行时不伪造叉积法向量', () => {
  const result = lineDistanceConstruction([0, 0, 0], [1, 0, 0], [0, 2, 0], [1, 0, 0]);
  assert.equal(result.normal, null);
  assert.equal(result.distance, null);
});

test('接近平行且落入画面判别阈值时不展示不稳定的叉积方向', () => {
  const result = lineDistanceConstruction([0, 0, 0], [1, 0, 0], [0, 2, 1], [1, 0.02, 0], 0.03);
  assert.equal(result.normal, null);
  assert.equal(result.distance, null);
});

test('非单位方向向量时展示真实叉积，但距离仍取沿其方向的投影', () => {
  const result = lineDistanceConstruction([0, 0, 0], [2, 0, 0], [1, 4, -3], [1, 1, 0]);
  assert.deepEqual(result.normal, [0, 0, 2]);
  assert.deepEqual(result.unitNormal, [0, 0, 1]);
  assert.deepEqual(result.foot, [0, 0, -3]);
  assert.equal(result.distance, 3);
});

test('法向量叉乘直线方向给出过直线的投影平面', () => {
  const result = projectionPlaneConstruction([0, 0, 1], [1, 0, -1], [0, 0, 2]);
  assert.deepEqual(result.auxNormal, [0, 1, 0]);
  assert.deepEqual(result.projectedPoint, [0, 0, 0]);
  assert.deepEqual(result.projectedDirection, [1, 0, 0]);
  assert.equal(result.auxOffset, 0);
});

test('直线垂直平面时辅助平面不唯一且投影退化为点', () => {
  const result = projectionPlaneConstruction([0, 0, 1], [0, 0, -1], [2, 3, 4]);
  assert.equal(result.auxNormal, null);
  assert.deepEqual(result.projectedPoint, [2, 3, 0]);
  assert.deepEqual(result.projectedDirection, [0, 0, 0]);
});

test('接近垂直时不展示随微小拖动剧烈转向的辅助平面法向量', () => {
  const result = projectionPlaneConstruction([0, 0, 1], [0.0005, 0, 1], [2, 3, 4], 0.001);
  assert.equal(result.auxNormal, null);
});

test('辅助平面法向量展示 n×v 的真实值', () => {
  const result = projectionPlaneConstruction([0, 0, 2], [2, 0, -2], [1, 3, 4]);
  assert.deepEqual(result.auxNormal, [0, 4, 0]);
  assert.deepEqual(result.unitAuxNormal, [0, 1, 0]);
  assert.equal(result.auxOffset, 12);
  assert.deepEqual(result.projectedPoint, [1, 3, 0]);
});
