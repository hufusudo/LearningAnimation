const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('./model.js');
const choreo = require('./choreo.js');

const scenarios = ['basic/a', 'basic/b', 'basic/special', 'napt/a', 'napt/b', 'napt/special'];
const build = key => {
  const [mode, scenario] = key.split('/');
  return model.buildScenario(mode, scenario);
};

function normalized(value) {
  if (typeof value === 'number') return Math.round(value * 1e9) / 1e9;
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalized(item)]));
  }
  return value;
}

for (const key of scenarios) {
  test(`${key}: adjoining step frames have matching visible states`, () => {
    const sequence = build(key);
    const mismatches = [];
    for (let i = 0; i < sequence.steps.length - 1; i++) {
      const left = choreo.frame(sequence.steps[i], 1);
      const right = choreo.frame(sequence.steps[i + 1], 0);
      // Offset is not part of the visible state while the tag has zero opacity.
      if (left.tagAlpha === 0) delete left.tagOffset;
      if (right.tagAlpha === 0) delete right.tagOffset;
      if (JSON.stringify(normalized(left)) !== JSON.stringify(normalized(right))) {
        mismatches.push(`boundary ${i} -> ${i + 1}`);
      }
    }
    assert.deepEqual(mismatches, [], key);
  });
}

test('duration is slider-aligned without floating-point residue', () => {
  for (const key of scenarios) {
    const sequence = build(key);
    assert.equal(sequence.duration, Number(sequence.duration.toFixed(3)));
    assert.equal(model.sample(sequence, sequence.duration).progress, 1);
  }
});

test('SNAT changes only source fields; basic NAT preserves port', () => {
  for (const [mode, scenario] of [['basic', 'a'], ['basic', 'b'], ['napt', 'a'], ['napt', 'b']]) {
    const sequence = model.buildScenario(mode, scenario);
    const step = sequence.steps.find(item => item.type === 'snat');
    assert.ok(step);
    const changed = ['sip', 'sport', 'dip', 'dport'].filter(key => step.before.packet[key] !== step.after.packet[key]);
    assert.deepEqual(changed.sort(), mode === 'basic' ? ['sip'] : ['sip', 'sport']);
    assert.equal(step.after.packet.dip, step.before.packet.dip);
    assert.equal(step.after.packet.dport, step.before.packet.dport);
    if (mode === 'basic') assert.equal(step.after.packet.sport, step.before.packet.sport);
  }
});

test('DNAT changes only destination fields; basic NAT preserves port', () => {
  for (const mode of ['basic', 'napt']) {
    const sequence = model.buildScenario(mode, 'a');
    const step = sequence.steps.find(item => item.type === 'dnat');
    const changed = ['sip', 'sport', 'dip', 'dport'].filter(key => step.before.packet[key] !== step.after.packet[key]);
    assert.deepEqual(changed.sort(), mode === 'basic' ? ['dip'] : ['dip', 'dport']);
    assert.equal(step.after.packet.sip, step.before.packet.sip);
    assert.equal(step.after.packet.sport, step.before.packet.sport);
    if (mode === 'basic') assert.equal(step.after.packet.dport, step.before.packet.dport);
  }
});

test('NAT uses separate public IPs; NAPT shares IP and separates ports for same private port', () => {
  const natA = model.buildScenario('basic', 'a').steps.find(s => s.type === 'allocate').after.table[0];
  const natB = model.buildScenario('basic', 'b').steps.find(s => s.type === 'allocate').after.table[1];
  assert.notEqual(natA.publicIP, natB.publicIP);
  const naptA = model.buildScenario('napt', 'a').steps.find(s => s.type === 'allocate').after.table[0];
  const naptB = model.buildScenario('napt', 'b').steps.find(s => s.type === 'allocate').after.table[1];
  assert.equal(naptA.privatePort, '50001');
  assert.equal(naptB.privatePort, '50001');
  assert.equal(naptA.publicIP, naptB.publicIP);
  assert.notEqual(naptA.publicPort, naptB.publicPort);
});

test('basic special drops C without adding a mapping', () => {
  const sequence = model.buildScenario('basic', 'special');
  const drop = sequence.steps.find(s => s.type === 'drop');
  assert.equal(drop.before.table.length, 2);
  assert.deepEqual(drop.after.table, drop.before.table);
  assert.equal(drop.after.packet.visible, false);
  assert.equal(drop.after.packet.host, 'C');
});

test('NAPT special returns B then A using destination-port ownership; mappings remain', () => {
  const sequence = model.buildScenario('napt', 'special');
  const dnat = sequence.steps.filter(s => s.type === 'dnat');
  assert.deepEqual(dnat.map(s => s.host), ['B', 'A']);
  for (const step of dnat) {
    const row = step.before.table.find(item => item.host === step.host);
    assert.equal(step.before.packet.dport, row.publicPort);
    assert.equal(step.after.packet.dip, row.privateIP);
    assert.equal(step.after.packet.dport, row.privatePort);
    assert.equal(step.after.packet.sip, step.before.packet.sip);
    assert.equal(step.after.packet.sport, step.before.packet.sport);
  }
  assert.equal(sequence.steps.at(-1).after.table.length, 2);
});

test('sample clamps both boundaries deterministically without mutating sequence', () => {
  const sequence = model.buildScenario('napt', 'special');
  const snapshot = JSON.stringify(sequence);
  assert.equal(model.sample(sequence, -10).time, 0);
  assert.equal(model.sample(sequence, -10).index, 0);
  assert.equal(model.sample(sequence, sequence.duration + 10).time, sequence.duration);
  assert.equal(model.sample(sequence, sequence.duration + 10).index, sequence.steps.length - 1);
  assert.equal(model.sample(sequence, sequence.duration + 10).progress, 1);
  assert.equal(JSON.stringify(sequence), snapshot);
});

test('choreo is deterministic on arbitrary progress and after rewind/re-entry', () => {
  const sequence = build('napt/special');
  for (const step of sequence.steps) {
    const first = choreo.frame(step, 0.371);
    choreo.frame(step, 0.91);
    const reentered = choreo.frame(step, 0.371);
    assert.deepEqual(normalized(reentered), normalized(first));
    assert.deepEqual(normalized(choreo.frame(step, -1)), normalized(choreo.frame(step, 0)));
    assert.deepEqual(normalized(choreo.frame(step, 2)), normalized(choreo.frame(step, 1)));
  }
});

test('field labels switch only during the configured transition window', () => {
  const result = choreo.text('old', 'new', 0, 0.22, 0.68);
  assert.equal(result.value, 'old');
  assert.equal(choreo.text('old', 'new', 0.22, 0.22, 0.68).value, 'old');
  assert.equal(choreo.text('old', 'new', 0.68, 0.22, 0.68).value, 'new');
  assert.equal(choreo.text('old', 'new', 1, 0.22, 0.68).value, 'new');
});

test('visual hints hold at step end and fade into the next step without changing the model', () => {
  const sequence = build('napt/b');
  const snapshot = JSON.stringify(sequence);
  const t = 3 * sequence.stepSeconds;
  const end = choreo.hints(sequence, t);
  assert.equal(end.panel.title, '改写源端点');
  assert.equal(end.panel.alpha, 1);
  assert.equal(end.panel.from, '192.168.1.3:50001');
  assert.equal(end.panel.to, '198.51.100.1:30002');
  assert.equal(end.fields.sip, 1);
  assert.equal(end.fields.sport, 1);
  assert.equal(end.fields.dip, 0);
  assert.equal(end.fields.dport, 0);
  assert.ok(choreo.hints(sequence, t + .06).panel.alpha < 1);
  assert.equal(JSON.stringify(sequence), snapshot);
  assert.deepEqual(choreo.hints(sequence, t), end);
});

test('lookup hints distinguish NAT addresses from NAPT public TCP ports', () => {
  for (const mode of ['basic', 'napt']) {
    const sequence = model.buildScenario(mode, 'b');
    const index = sequence.steps.findIndex(step => step.type === 'lookup');
    const hint = choreo.hints(sequence, (index + 1) * sequence.stepSeconds);
    assert.equal(hint.panel.to, '主机 B');
    assert.equal(hint.match.host, 'B');
    assert.equal(hint.match.progress, 1);
    assert.equal(hint.fields.dip, 1);
    assert.equal(hint.fields.dport, mode === 'napt' ? 1 : 0);
    assert.equal(hint.panel.from, mode === 'napt' ? '198.51.100.1:30002' : '198.51.100.2');
  }
});

test('warning and transfer hints remain factual, local and rewindable', () => {
  const sequence = build('basic/special');
  const dropped = choreo.hints(sequence, sequence.duration);
  assert.equal(dropped.panel.title, '报文已丢弃');
  assert.equal(dropped.panel.warning, true);
  assert.equal(dropped.panel.alpha, 1);
  assert.equal(dropped.match, null);
  assert.equal(choreo.hints(sequence, 0).panel, null);
  const transfer = choreo.hints(sequence, sequence.stepSeconds * .5);
  assert.deepEqual(transfer.route.points, choreo.route('C', 'router'));
  assert.equal(transfer.route.alpha, 1);
  assert.equal(transfer.route.target, 'router');
  assert.equal(choreo.hints(sequence, sequence.stepSeconds).route.alpha, 0);
});

test('visual hint opacity and content are continuous on both sides of every boundary', () => {
  for (const key of scenarios) {
    const sequence = build(key);
    const visible = hint => ({
      panel: hint.panel && hint.panel.alpha > .0001 ? hint.panel : null,
      fields: hint.fields,
      match: hint.match && hint.match.alpha > .0001 ? hint.match : null,
      routeAlpha: hint.route.alpha, arrival: hint.route.arrival
    });
    function close(a, b) {
      if (typeof a === 'number') { assert.ok(Math.abs(a - b) < .0001, `${a} vs ${b}`); return; }
      if (!a || typeof a !== 'object') { assert.equal(a, b); return; }
      for (const key of Object.keys(a)) close(a[key], b[key]);
    }
    for (let i = 1; i < sequence.steps.length; i++) {
      const t = i * sequence.stepSeconds;
      const mid = visible(choreo.hints(sequence, t));
      close(visible(choreo.hints(sequence, t - 1e-7)), mid);
      close(visible(choreo.hints(sequence, t + 1e-7)), mid);
    }
  }
});

test('travel follows the route by arc length and drop fades out', () => {
  const points = [[0, 0], [3, 0], [3, 4]];
  assert.deepEqual(choreo.along(points, 0.5), [3, 0.5]);
  const sequence = model.buildScenario('basic', 'special');
  const drop = sequence.steps.find(s => s.type === 'drop');
  assert.equal(choreo.frame(drop, 0).packet.alpha, 1);
  assert.equal(choreo.frame(drop, 1).packet.alpha, 0);
  assert.ok(choreo.frame(drop, 0.5).packet.alpha > 0);
  assert.ok(choreo.frame(drop, 0.5).packet.alpha < 1);
});
