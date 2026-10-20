const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, normalize, analyze, snapshot } = require('./model.js');

test('five legacy presets expose the complete model contract', () => {
  assert.deepEqual(Object.keys(PRESETS), ['cubic','elliptic','multi-xi','lagrange','rolle']);
  for (const p of Object.values(PRESETS)) {
    for (const field of ['label','gText','fText','min','max','a','b','g','dg','f','df']) assert.ok(field in p, field);
  }
  assert.equal(PRESETS.cubic.g(1), 2);
  assert.equal(PRESETS.multiXi, undefined);
  assert.equal(PRESETS['multi-xi'].df(0), -3.2);
});

test('normalization clamps both endpoints and enforces a 0.15 interval', () => {
  const low=normalize('cubic',-99,-99);
  assert.equal(low.a, -1.9); assert.equal(low.b, -1.75);
  const high=normalize('cubic',99,99);
  assert.equal(high.b, 2.6); assert.ok(high.a >= -1.9);
  const reversed=normalize('lagrange',2,1);
  assert.ok(reversed.a >= reversed.preset.min && reversed.b <= reversed.preset.max);
  assert.ok(reversed.b-reversed.a >= .15-1e-12);
  assert.equal(normalize('cubic',NaN,undefined).a, PRESETS.cubic.a);
});

test('analysis finds interior parallel-tangent roots, excludes endpoints, and keeps roots accurate', () => {
  for (const key of Object.keys(PRESETS)) {
    const p=PRESETS[key], m=analyze(key,p.a,p.b);
    assert.ok(m.roots.every(t => t>m.a && t<m.b));
    assert.ok(m.roots.every(t => Math.abs(m.residual(t))<1e-7), key);
    assert.ok(m.roots.every(t => snapshot(m,t).matched), key);
  }
  const many=analyze('multi-xi',-2.2,2.2);
  const expected=2.2/Math.sqrt(3);
  assert.equal(many.roots.length,2, `expected two roots; got ${many.roots}`);
  assert.ok(Math.abs(many.roots[0]+expected)<1e-7);
  assert.ok(Math.abs(many.roots[1]-expected)<1e-7);
  const rolle=analyze('rolle',-2,2);
  assert.equal(rolle.roots.length,1);
  assert.ok(Math.abs(rolle.roots[0])<1e-7);
  const exact=analyze('rolle',-2,2);
  assert.ok(exact.roots.some(t => Math.abs(t)<1e-7), 'root at a grid sample is retained');
  const ends=analyze('rolle',-2,2);
  assert.ok(!ends.roots.some(t => Math.abs(t+2)<1e-7 || Math.abs(t-2)<1e-7));
});

test('vertical chords and derivative-zero regions are reported as invalid ratios', () => {
  const vertical=analyze('elliptic',-1,1);
  assert.ok(Math.abs(vertical.dx)<1e-12);
  assert.equal(vertical.secantSlope,null);
  assert.equal(vertical.ratioValid,false);
  assert.ok(vertical.roots.some(t=>Math.abs(t)<1e-7));
  assert.equal(snapshot(vertical,0).matched,true);
  const bad=analyze('elliptic',-.5,1.8);
  assert.equal(bad.ratioValid,false);
  assert.match(bad.condition,/g′\(t\)=0/);
  const good=analyze('cubic',-1.8,2);
  assert.equal(good.ratioValid,true);
});

test('auxiliary vanishes at both ends and residual equals the derivative', () => {
  for (const key of Object.keys(PRESETS)) {
    const p=PRESETS[key], m=analyze(key,p.a,p.b);
    assert.ok(Math.abs(m.auxiliary(m.a))<1e-10);
    assert.ok(Math.abs(m.auxiliary(m.b))<1e-10);
    const t=(m.a+m.b)/2, h=1e-6;
    assert.ok(Math.abs((m.auxiliary(t+h)-m.auxiliary(t-h))/(2*h)-m.residual(t))<1e-6);
  }
});

test('snapshot angle is unoriented, detects parallel tangents, and handles vertical tangent', () => {
  const m=analyze('rolle',-2,2), s=snapshot(m,0);
  assert.equal(s.angle,0); assert.equal(s.matched,true);
  const vertical=snapshot(analyze('elliptic',-1,1),0);
  assert.equal(vertical.tangentSlope,null);
  assert.ok(vertical.angle>=0 && vertical.angle<=90);
  const clamped=snapshot(m,99);
  assert.equal(clamped.t,m.b);
  const zeroModel={ ...m, preset:{g:()=>0,dg:()=>0,f:()=>0,df:()=>0} };
  const zero=snapshot(zeroModel,0);
  assert.equal(zero.matched,false);
  assert.equal(zero.angle,null);
});


test('g derivative may vanish at an interval endpoint', () => {
  assert.equal(analyze('elliptic', -1, 0).ratioValid, true);
  assert.equal(analyze('elliptic', 0, 1).ratioValid, true);
  assert.equal(analyze('elliptic', -1, 1).ratioValid, false);
});


test('a parallel endpoint is not an interior mean-value point', () => {
  const m = analyze('multi-xi', -1, 2);
  assert.equal(m.roots.length, 1);
  assert.ok(Math.abs(m.roots[0] - 1) < 1e-7);
  const endpoint = snapshot(m, -1);
  assert.equal(endpoint.matched, true);
  assert.equal(endpoint.isMeanPoint, false);
  assert.equal(snapshot(m, 1).isMeanPoint, true);
});
