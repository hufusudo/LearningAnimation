/* Unit ball, coordinates in metres, density in kg/m³. Shared by animation and checks. */
(function (root) {
  'use strict';
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const density = (x, y, z) => 1 + z / 2 + (x * x + y * y) / 2;
  const sphericalPoint = (r, theta, phi) => ({
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.sin(phi) * Math.sin(theta),
    z: r * Math.cos(phi)
  });
  const slicePrimitive = z => Math.PI * (1.25 * z + 0.25 * z ** 2 - 0.5 * z ** 3 - 0.125 * z ** 4 + 0.05 * z ** 5);
  root.IntegralModel = Object.freeze({
    clamp, density, sphericalPoint,
    totalMass: 8 * Math.PI / 5,
    inside: (x, y, z) => x * x + y * y + z * z <= 1 + 1e-10,
    halfHeight: (x, y) => Math.sqrt(Math.max(0, 1 - x * x - y * y)),
    cylindricalIntegrand: (r, theta, z) => density(r * Math.cos(theta), r * Math.sin(theta), z) * r,
    sphericalIntegrand: (r, theta, phi) => {
      const p = sphericalPoint(r, theta, phi);
      return density(p.x, p.y, p.z) * r * r * Math.sin(phi);
    },
    sliceMass: z => {
      const a = Math.max(0, 1 - z * z);
      return Math.PI * ((1 + z / 2) * a + a * a / 4);
    },
    accumulatedMass(method, fraction) {
      const t = clamp(fraction);
      if (method === 'projection') {
        const u = Math.max(0, 1 - t * t);
        return 2 * Math.PI * (0.8 - u ** 1.5 + 0.2 * u ** 2.5);
      }
      if (method === 'spherical') {
        const u = Math.cos(Math.PI * t);
        return 2 * Math.PI * (13 / 30 * (1 - u) - (1 - u ** 3) / 30 + (1 - u * u) / 16);
      }
      return slicePrimitive(2 * t - 1) - slicePrimitive(-1);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
