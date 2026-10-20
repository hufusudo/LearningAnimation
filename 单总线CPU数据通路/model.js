/* 纯教学模型：动作被细分展示，不把演示步骤冒充实际时钟周期。 */
(function (root) {
  'use strict';
  const MODES = ['ADD_MEM', 'ADD_INDIRECT', 'ADD_REG', 'ADD_IMM'];
  const hex = (n, width = 8) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');
  function add32(a, b) {
    a >>>= 0; b >>>= 0;
    const result = (a + b) >>> 0;
    return { result, flags: { Z: +(result === 0), C: +(a + b > 0xFFFFFFFF), S: result >>> 31,
      V: +(((a >>> 31) === (b >>> 31)) && ((a >>> 31) !== (result >>> 31))) } };
  }
  function parseWord(raw) {
    const s = String(raw).trim();
    if (!/^(?:\d+|0x[\da-f]+)$/i.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n >= 0 && n <= 0xFFFFFFFF ? n : null;
  }
  function instruction(mode, b) {
    return ({ ADD_MEM: 'ADD [1008H]', ADD_INDIRECT: 'ADD (R0)', ADD_REG: 'ADD R1', ADD_IMM: `ADD #${b}` })[mode];
  }
  function buildSequence(mode = 'ADD_MEM', a = 21, b = 42) {
    if (!MODES.includes(mode)) mode = 'ADD_MEM';
    a >>>= 0; b >>>= 0;
    if (mode === 'ADD_IMM' && b > 0xFFFF) throw new RangeError('立即数采用16位无符号字段，范围为0～65535');
    const inst = instruction(mode, b), sum = add32(a, b);
    let state = { PC: 0x800, MAR: 0, MDR: 0, IR: null, ACC: a, R0: 0x1008, R1: b,
      Y: 0, Z: 0, decoded: false, selected: null, bus: null, aluA: null, aluB: null, resultReady: false,
      flags: { Z: 0, C: 0, S: 0, V: 0 } };
    const initial = structuredClone(state), steps = [];
    function push(spec, patch = {}) {
      const before = structuredClone(state);
      state = { ...state, ...patch };
      steps.push({ ...spec, index: steps.length, duration: 4, before, after: structuredClone(state) });
    }
    const common = (phase, title, source, target, route, kind, value, signals, why, tag) =>
      ({ phase, title, source, target, route, kind, value, signals, why, tag });
    push(common('取指', '把指令地址交给 MAR', 'PC', 'MAR', 'pc-mar', '指令地址', hex(0x800, 4), ['PC_out', 'MAR_in'], 'PC 给出指令地址；MAR 收到后才能访问主存。', '地址已锁存'), { MAR: 0x800 });
    push(common('取指', '按地址请求读取指令', 'MAR', 'MEM_INST', 'mar-memory', '地址 · Read', hex(0x800, 4), ['Read'], 'MAR 通过地址线选中主存中的指令。', '指令已选中'), { selected: 'MEM_INST' });
    push(common('取指', '主存把指令送入 MDR', 'MEM_INST', 'MDR', 'instruction-mdr', '指令', inst, ['Read', 'MDR_inE'], '主存经外部数据线返回指令，先由 MDR 接住。', '指令已锁存'), { MDR: inst, selected: null });
    push(common('取指', 'PC 指向下一条指令', 'PC', 'PC', 'pc-increment', '专用自增', '0x0800 + 4', ['PC_inc', 'PC_in'], '专用自增器把 PC 加 4，不占用内部单总线。', 'PC 指向下一条'), { PC: 0x804 });
    push(common('取指', '把指令装入 IR', 'MDR', 'IR', 'mdr-ir', '指令', inst, ['MDR_out', 'IR_in'], 'MDR 经内部单总线送出指令，IR 接收。', 'IR 已锁存'), { IR: inst });
    push(common('译码', '控制器识别本条指令', 'IR', 'CU', 'ir-cu', '操作码', 'ADD', ['Decode'], '控制器识别 ADD 和寻址方式，确定下一条数据路径。', '译码完成'), { decoded: true });
    if (mode === 'ADD_MEM' || mode === 'ADD_INDIRECT') {
      const indirect = mode === 'ADD_INDIRECT', src = indirect ? 'R0' : 'IR';
      push(common('取数', indirect ? 'R0 给出操作数地址' : '取出 IR 中的地址字段', src, 'MAR', indirect ? 'r0-mar' : 'ir-mar', '操作数地址', hex(0x1008, 4), [src + '_out', 'MAR_in'], indirect ? 'R0 存的是地址，不是加数；先把地址送入 MAR。' : 'IR 的地址字段是 0x1008，先送 MAR，不把地址当加数。', '地址已锁存'), { MAR: 0x1008, selected: null });
      push(common('取数', '按地址请求读取操作数', 'MAR', 'MEM_DATA', 'mar-memory', '地址 · Read', hex(0x1008, 4), ['Read'], 'MAR 通过地址线选中数据，而不是再次读取指令。', '数据已选中'), { selected: 'MEM_DATA' });
      push(common('取数', '主存把操作数送入 MDR', 'MEM_DATA', 'MDR', 'data-mdr', '操作数', String(b), ['Read', 'MDR_inE'], '数据经外部数据线进入 MDR，此时还没有做加法。', '操作数已锁存'), { MDR: b, selected: null });
      push(common('取数', '把操作数暂存在 Y', 'MDR', 'Y', 'mdr-y', '操作数', String(b), ['MDR_out', 'Y_in'], '先把一个加数存进 Y，让出单总线给 ACC。', '暂存让出总线'), { Y: b, selected: null });
    } else {
      const src = mode === 'ADD_REG' ? 'R1' : 'IR';
      push(common('取数', mode === 'ADD_REG' ? 'R1 直接给出操作数' : 'IR 直接给出立即数', src, 'Y', mode === 'ADD_REG' ? 'r1-y' : 'ir-y', '操作数', String(b), [src + '_out', 'Y_in'], mode === 'ADD_REG' ? 'R1 中已经是加数，经单总线存进 Y，不再访存。' : '立即数就在指令字段里，经单总线存进 Y，不再访存。', '暂存让出总线'), { Y: b });
    }
    push(common('计算', 'ACC 经总线提供原来的值', 'ACC', 'ALU', 'acc-alu', '原 ACC', String(a), ['ACC_out'], 'ACC 的原值沿单总线到达 ALU；此时传的不是结果。', '总线提供一端'), { bus: a, aluB: a });
    push(common('计算', 'Y 经专线提供另一加数', 'Y', 'ALU', 'y-alu', 'Y 中的加数', String(b), ['ACC_out'], 'Y 经专线提供另一端，ACC 继续独占单总线。', '两端输入就绪'), { aluA: b });
    push(common('计算', '相加后把结果存入 Z', 'ALU', 'Z', 'alu-z', '加法结果', String(sum.result), ['ACC_out', 'ALU_ADD', 'Z_in'], 'ALU 相加，结果沿专线进入 Z；ACC 此刻仍是旧值。', '结果先存 Z'), { Z: sum.result, flags: sum.flags, resultReady: true });
    push(common('写回', 'Z 经单总线写回 ACC', 'Z', 'ACC', 'z-acc', '加法结果', String(sum.result), ['Z_out', 'ACC_in'], 'Z 取得单总线使用权，再把结果写回 ACC。', '写回完成'), { ACC: sum.result, bus: null });
    return { mode, a, b, instruction: inst, initial, steps, duration: steps.length * 4, result: sum.result };
  }
  const api = { MODES, hex, add32, parseWord, instruction, buildSequence };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CpuModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
