/** Geometric constructions used by the two ordered animations. */
(function (root) {
  'use strict';

  const subtract = (a, b) => a.map((value, i) => value - b[i]);
  const add = (a, b) => a.map((value, i) => value + b[i]);
  const scale = (a, factor) => a.map(value => value === 0 ? 0 : value * factor);
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ].map(value => value === 0 ? 0 : value);
  const unit = (a, epsilon = 1e-8) => {
    const magnitude = Math.hypot(...a);
    return magnitude <= epsilon ? null : scale(a, 1 / magnitude);
  };

  function lineDistanceConstruction(point1, direction1, point2, direction2, parallelEpsilon = 1e-8) {
    const connector = subtract(point2, point1);
    const rawNormal = cross(direction1, direction2);
    const unitNormal = unit(rawNormal, parallelEpsilon);
    if (!unitNormal) return { connector, normal: null, unitNormal: null, foot: null, signedProjection: null, distance: null };
    const signedProjection = dot(connector, unitNormal);
    return {
      connector,
      normal: rawNormal,
      unitNormal,
      foot: add(point1, scale(unitNormal, signedProjection)),
      signedProjection,
      distance: Math.abs(signedProjection)
    };
  }

  function projectionPlaneConstruction(planeNormal, lineDirection, point, perpendicularEpsilon = 1e-8) {
    const normalSquared = dot(planeNormal, planeNormal);
    const projectedPoint = subtract(point, scale(planeNormal, dot(point, planeNormal) / normalSquared));
    const projectedDirection = subtract(lineDirection, scale(planeNormal, dot(lineDirection, planeNormal) / normalSquared));
    const rawAuxNormal = cross(planeNormal, lineDirection);
    const unitAuxNormal = unit(rawAuxNormal, perpendicularEpsilon);
    const auxNormal = unitAuxNormal ? rawAuxNormal : null;
    return {
      auxNormal,
      unitAuxNormal,
      auxOffset: auxNormal ? dot(auxNormal, point) : null,
      projectedPoint,
      projectedDirection
    };
  }

  const api = { lineDistanceConstruction, projectionPlaneConstruction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GeometryConstruction = api;
})(typeof window === 'undefined' ? globalThis : window);
