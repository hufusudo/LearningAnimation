'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

test('四种寻址方式默认以 21 + 42 得到 63', () => {
  for (const mode of M.MODES) {
    const seq = M.buildSequence(mode);
    assert.equal(seq.mode, mode);
    assert.equal(seq.a, 21);
    assert.equal(seq.b, 42);
    assert.equal(seq.result, 63);
    assert.equal(seq.steps.at(-1).after.ACC, 63);
  }
});

test('各模式先取指再译码，内存寻址取数路径彼此区分', () => {
  for (const mode of M.MODES) {
    const { steps } = M.buildSequence(mode);
    assert.deepEqual(steps.slice(0, 6).map(s => s.phase), ['取指', '取指', '取指', '取指', '取指', '译码']);
    assert.equal(steps[4].after.IR, steps[2].after.MDR);
    assert.equal(steps[5].after.decoded, true);
    const dataReads = steps.filter(s => s.route === 'mar-memory' && s.target === 'MEM_DATA');
    assert.equal(dataReads.length, mode === 'ADD_MEM' || mode === 'ADD_INDIRECT' ? 1 : 0);
  }
});

test('立即数仅按概念字段呈现，不伪造 ISA 机器码', () => {
  const seq = M.buildSequence('ADD_IMM');
  assert.equal(seq.instruction, 'ADD #42');
  assert.equal(seq.steps[2].after.MDR, seq.instruction);
  assert.equal(seq.steps[4].after.IR, seq.instruction);
  assert.equal(seq.steps.find(s => s.route === 'ir-y').value, '42');
  assert.equal(seq.steps.some(s => /机器码|opcode/i.test(s.value)), false);
});

test('16位立即数字段边界与零扩展', () => {
  const seq = M.buildSequence('ADD_IMM', 1, 65535);
  assert.equal(seq.steps.find(s => s.target === 'Y').after.Y, 65535);
  assert.equal(seq.result, 65536);
  assert.throws(() => M.buildSequence('ADD_IMM', 1, 65536), RangeError);
});

test('Y、Z、ACC 按暂存、结果暂存、写回的时序更新', () => {
  for (const mode of M.MODES) {
    const { steps } = M.buildSequence(mode);
    const y = steps.find(s => s.target === 'Y');
    const calc = steps.find(s => s.target === 'Z');
    const writeback = steps.find(s => s.target === 'ACC' && s.source === 'Z');
    assert.equal(y.after.Y, 42);
    assert.equal(calc.before.ACC, 21);
    assert.equal(calc.after.Z, 63);
    assert.equal(calc.after.ACC, 21);
    assert.equal(writeback.before.ACC, 21);
    assert.equal(writeback.after.ACC, 63);
  }
});

test('add32 的 Z/C/S/V 边界', () => {
  assert.deepEqual(M.add32(0, 0), { result: 0, flags: { Z: 1, C: 0, S: 0, V: 0 } });
  assert.deepEqual(M.add32(0xFFFFFFFF, 1), { result: 0, flags: { Z: 1, C: 1, S: 0, V: 0 } });
  assert.deepEqual(M.add32(0x7FFFFFFF, 1), { result: 0x80000000, flags: { Z: 0, C: 0, S: 1, V: 1 } });
  assert.deepEqual(M.add32(0x80000000, 0x80000000), { result: 0, flags: { Z: 1, C: 1, S: 0, V: 1 } });
  assert.deepEqual(M.add32(0xFFFFFFFF, 0), { result: 0xFFFFFFFF, flags: { Z: 0, C: 0, S: 1, V: 0 } });
});

test('parseWord 严格接受十进制/十六进制范围内整数，拒绝格式与范围错误', () => {
  for (const [raw, expected] of [['0', 0], [' 42 ', 42], ['0xFF', 255], ['4294967295', 0xFFFFFFFF]]) {
    assert.equal(M.parseWord(raw), expected);
  }
  for (const raw of ['', '-1', '+1', '1.0', '1e2', '0b10', '0x', '0xGG', '12 3', '4294967296', '9007199254740992']) {
    assert.equal(M.parseWord(raw), null, String(raw));
  }
});
