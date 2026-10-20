/* 纯函数三维几何采样：所有坐标均以 rho 为统一长度单位。 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const SLICE_COUNT = 160;

  function model() {
    if (!root.PDModel) throw new Error('请先加载 PDModel');
    return root.PDModel;
  }

  function sample(id, theta, k, options = {}) {
    const M = model();
    if (!M.byId[id]) throw new RangeError(`未知样本: ${id}`);
    const rings = options.rings === undefined ? 32 : Math.floor(options.rings);
    const sectors = options.sectors === undefined ? 96 : Math.floor(options.sectors);
    if (rings < 1 || sectors < 3) throw new RangeError('rings 至少为 1，sectors 至少为 3');

    const rho = M.rho(k);
    if (!(rho > 0) || !Number.isFinite(rho)) throw new RangeError('k 必须产生有限正的 rho');
    const inner = id === 'F1' ? 0.018 : 0;
    const positions = new Float32Array((rings + 1) * (sectors + 1) * 3);
    const indices = [];
    let cursor = 0;

    for (let ring = 0; ring <= rings; ring += 1) {
      const rNorm = inner + (1 - inner) * ring / rings;
      for (let sector = 0; sector <= sectors; sector += 1) {
        const angle = TAU * sector / sectors;
        const xNorm = rNorm * Math.cos(angle);
        const yNorm = rNorm * Math.sin(angle);
        const zNorm = M.value(id, rho * xNorm, rho * yNorm) / rho;
        positions[cursor++] = xNorm;
        positions[cursor++] = yNorm;
        positions[cursor++] = zNorm;
      }
    }

    // F1 在 P 不连续。其内边界从非零半径起始，任何三角面都不触及 P。
    for (let ring = 0; ring < rings; ring += 1) {
      for (let sector = 0; sector < sectors; sector += 1) {
        const a = ring * (sectors + 1) + sector;
        const b = a + sectors + 1;
        const c = a + 1;
        const d = b + 1;
        indices.push(a, b, c, c, b, d);
      }
    }

    const direction = theta * Math.PI / 180;
    const ux = Math.cos(direction);
    const uy = Math.sin(direction);
    function normalizedPoint(radius, angle) {
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      return [x / rho, y / rho, M.value(id, x, y) / rho];
    }

    const slice = { positive: [], negative: [] };
    for (let i = 0; i < SLICE_COUNT; i += 1) {
      const distance = rho * (1e-6 + (1 - 1e-6) * i / (SLICE_COUNT - 1));
      slice.positive.push(normalizedPoint(distance, direction));
      slice.negative.push(normalizedPoint(distance, direction + Math.PI));
    }

    const probeRadius = 0.72 * rho;
    const px = probeRadius * ux;
    const py = probeRadius * uy;
    const value = M.value(id, px, py);
    const grad = M.byId[id].gradAtP;
    const linearValue = grad ? grad.x * px + grad.y * py : null;
    const residual = linearValue === null ? null : value - linearValue;
    const ratio = residual === null ? null : Math.abs(residual) / probeRadius;

    let nearby = [];
    if (id === 'F4') {
      const n = Math.max(1, Math.ceil(1 / (TAU * rho)));
      for (const denominator of [TAU * n, TAU * n + Math.PI]) {
        const r = 1 / denominator;
        const point = [r / rho, 0, M.value(id, r, 0) / rho];
        const slope = M.lineSlope(id, 0, r);
        nearby.push({
          point,
          slope,
          r,
          tangent: [
            [point[0] - 0.18, 0, point[2] - 0.18 * slope],
            [point[0] + 0.18, 0, point[2] + 0.18 * slope]
          ]
        });
      }
    }

    return {
      rho,
      mesh: { positions, indices },
      slice,
      probe: {
        point: [px / rho, py / rho, value / rho],
        linear: grad ? [px / rho, py / rho, linearValue / rho] : null,
        value,
        linearValue,
        residual,
        ratio
      },
      gradient: grad ? [grad.x, grad.y] : null,
      nearby
    };
  }

  const api = Object.freeze({ sample });
  root.PDGeometry = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
