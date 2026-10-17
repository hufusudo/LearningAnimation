'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appPath = path.join(__dirname, 'app.js');
const source = fs.readFileSync(appPath, 'utf8');
const initRegistration = "  window.addEventListener('DOMContentLoaded', init);";
assert.equal(
  source.split(initRegistration).length - 1,
  1,
  'app.js must have one DOMContentLoaded registration point for isolated algorithm tests',
);

const instrumentedSource = source.replace(
  initRegistration,
  `  globalThis.__diskScanTestExports = { MAX: MAX, HEAD_START: HEAD_START, DIR_START: DIR_START, GROUPS: GROUPS, sweepPath: sweepPath, toSegments: toSegments, deriveData: deriveData };\n${initRegistration}`,
);
const sandbox = {
  window: { addEventListener() {} },
};
vm.runInNewContext(instrumentedSource, sandbox, { filename: appPath });
const { GROUPS, sweepPath, toSegments, deriveData } = sandbox.__diskScanTestExports;

const expected = {
  A: {
    scanDist: 331,
    cscanDist: 382,
    scanOrder: [65, 67, 98, 122, 124, 183, 37, 14],
    cscanOrder: [65, 67, 98, 122, 124, 183, 14, 37],
    jump: [199, 0],
    turns: 1,
  },
  B: {
    scanDist: 305,
    cscanDist: 396,
    scanOrder: [51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40],
    cscanOrder: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
    jump: [199, 0],
    turns: 1,
  },
  C: {
    scanDist: 125,
    cscanDist: 125,
    scanOrder: [178],
    cscanOrder: [178],
    jump: null,
    turns: 0,
  },
};

function plainArray(value) {
  return Array.from(value);
}

function pathDistance(path) {
  let distance = 0;
  for (let i = 1; i < path.length; i += 1) {
    distance += Math.abs(path[i] - path[i - 1]);
  }
  return distance;
}

function segmentDistance(segments) {
  return segments.reduce((distance, segment) => {
    // A turn marks the direction change; only its following move represents travel.
    if (segment.type === 'turn') return distance;
    return distance + Math.abs(segment.to - segment.from);
  }, 0);
}

function assertEachRequestServedOnce(order, requests, label) {
  const counts = new Map();
  for (const track of order) counts.set(track, (counts.get(track) || 0) + 1);
  assert.equal(order.length, requests.length, `${label}: service count`);
  for (const track of requests) {
    assert.equal(counts.get(track), 1, `${label}: track ${track} must be served exactly once`);
  }
  for (const track of counts.keys()) {
    assert.ok(requests.includes(track), `${label}: unexpected serviced track ${track}`);
  }
}

for (const group of GROUPS) {
  test(`group ${group.key}: SCAN/C-SCAN teaching results and segment accounting`, () => {
    const want = expected[group.key];
    assert.ok(want, `unexpected configured group ${group.key}`);
    const data = deriveData(group);

    assert.equal(data.scanDist, want.scanDist, 'SCAN total seek distance');
    assert.equal(data.cscanDist, want.cscanDist, 'C-SCAN total seek distance');
    assert.equal(data.cscanDist - data.scanDist, want.cscanDist - want.scanDist, 'distance delta');
    assert.deepEqual(plainArray(data.scanOrder), want.scanOrder, 'SCAN service order');
    assert.deepEqual(plainArray(data.cscanOrder), want.cscanOrder, 'C-SCAN service order');
    assertEachRequestServedOnce(data.scanOrder, group.reqs, 'SCAN');
    assertEachRequestServedOnce(data.cscanOrder, group.reqs, 'C-SCAN');

    assert.equal(pathDistance(data.scanPath), data.scanDist, 'SCAN path distance');
    assert.equal(pathDistance(data.cscanPath), data.cscanDist, 'C-SCAN path distance');
    assert.equal(segmentDistance(data.scanSegs), data.scanDist, 'SCAN turns add no seek distance');
    assert.equal(segmentDistance(data.cscanSegs), data.cscanDist, 'C-SCAN turns add no seek distance');

    const scanTurns = data.scanSegs.filter(segment => segment.type === 'turn');
    const cscanTurns = data.cscanSegs.filter(segment => segment.type === 'turn');
    assert.equal(scanTurns.length, want.turns, 'SCAN turn markers');
    assert.equal(cscanTurns.length, 0, 'C-SCAN has no turn markers');

    const jumps = data.cscanSegs.filter(segment => segment.type === 'jump');
    if (want.jump) {
      assert.deepEqual(
        plainArray(jumps.map(segment => [segment.from, segment.to])).map(plainArray),
        [want.jump],
        'C-SCAN jump is represented separately from service',
      );
      assert.equal(data.cscanOrder.includes(want.jump[1]), false, 'jump destination is not itself a request');
      assert.equal(segmentDistance(data.cscanSegs) - Math.abs(want.jump[1] - want.jump[0]), data.cscanDist - 199,
        'the 199→0 jump contributes 199 tracks to total seek distance');
    } else {
      assert.equal(jumps.length, 0, 'no wraparound when all requests are served on the initial sweep');
    }
  });
}

test('leftward sweep and endpoint transitions remain represented by the pure path/segment helpers', () => {
  const scanPath = sweepPath(53, -1, [10, 70], 'scan');
  const cscanPath = sweepPath(53, -1, [10, 70], 'cscan');
  assert.deepEqual(plainArray(scanPath), [53, 10, 0, 70]);
  assert.deepEqual(plainArray(cscanPath), [53, 10, 0, 199, 70]);

  const scanSegments = toSegments(scanPath, 'scan');
  const cscanSegments = toSegments(cscanPath, 'cscan');
  assert.equal(segmentDistance(scanSegments), pathDistance(scanPath));
  assert.equal(segmentDistance(cscanSegments), pathDistance(cscanPath));
  assert.deepEqual(
    plainArray(cscanSegments.filter(segment => segment.type === 'jump')
      .map(segment => [segment.from, segment.to])).map(plainArray),
    [[0, 199]],
  );
});
