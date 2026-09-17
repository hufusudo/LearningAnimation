/**
 * Single-Bus CPU Data Path Simulation Engine
 * 408 计组 · 内部单总线 + 外部系统总线 (ABUS/DBUS/CBUS)
 * 时钟节拍演进 · 控制信号矩阵 · GSAP 数据包流动
 */

// ==========================================================================
// 1. GLOBAL STATE & CONFIGURATION
// ==========================================================================

const State = {
  currentInstruction: 'ADD_MEM',
  currentStepIndex: 0,
  isPlaying: false,
  playbackSpeed: 1.0,
  playTimer: null,
  activeTween: null,

  operandA: 21,
  operandB: 42,

  registers: {
    PC: 0x0800,
    MAR: 0x0800,
    MDR: 0x00000000,
    IR: 0x00000000,
    Y: 0x00000000,
    Z: 0x00000000,
    ACC: 0x00000015,
    R0: 0x00001008,
    R1: 0x0000002A,
    FLAGS: { Z: 0, C: 0, S: 0, V: 0 }
  }
};

// 数据包颜色: 随所在总线变色 (内总线琥珀 / ABUS 蓝 / DBUS 绿)
const BUS_TOKEN_COLORS = {
  internal: '#F59E0B',
  abus: '#2563EB',
  dbus: '#059669'
};

// 全部微操作控制信号 (circuitId = 电路图上的高亮元素, 显式映射避免命名歧义)
const ALL_SIGNALS = [
  { id: 'PC_out',     label: 'PC_out',     circuitId: 'sig-pcout',     desc: 'PC 经三态门送内总线' },
  { id: 'PC_in',      label: 'PC_in',      circuitId: 'sig-pcin',      desc: '总线数据打入 PC' },
  { id: 'PC_MUX_SEL', label: 'PC_MUX_SEL', circuitId: 'sig-pcmuxsel',  desc: 'PC 多路选择器 (0:PC+4, 1:Bus)' },
  { id: 'MAR_in',     label: 'MAR_in',     circuitId: 'sig-marin',     desc: '内总线打入 MAR' },
  { id: 'MDR_in',     label: 'MDR_in',     circuitId: 'sig-mdrin',     desc: '内总线打入 MDR' },
  { id: 'MDR_out',    label: 'MDR_out',    circuitId: 'sig-mdrout',    desc: 'MDR 送内总线' },
  { id: 'MDR_inE',    label: 'MDR_inE',    circuitId: 'sig-mdrine',    desc: '外数据总线 (DBUS) 打入 MDR' },
  { id: 'MDR_outE',   label: 'MDR_outE',   circuitId: 'sig-mdroute',   desc: 'MDR 送外数据总线' },
  { id: 'IR_in',      label: 'IR_in',      circuitId: 'sig-irin',      desc: '内总线打入 IR' },
  { id: 'IR_out',     label: 'IR_out',     circuitId: 'sig-irout',     desc: 'IR 地址码/立即数送内总线' },
  { id: 'Y_in',       label: 'Y_in',       circuitId: 'sig-yin',       desc: '内总线打入暂存器 Y' },
  { id: 'Z_in',       label: 'Z_in',       circuitId: 'sig-zin',       desc: 'ALU 结果打入暂存器 Z' },
  { id: 'Z_out',      label: 'Z_out',      circuitId: 'sig-zout',      desc: '暂存器 Z 送内总线' },
  { id: 'ACC_in',     label: 'ACC_in',     circuitId: 'sig-accin',     desc: '内总线打入 ACC' },
  { id: 'ACC_out',    label: 'ACC_out',    circuitId: 'sig-accout',    desc: 'ACC 送内总线' },
  { id: 'R0_out',     label: 'R0_out',     circuitId: 'sig-r0out',     desc: 'R0 送内总线' },
  { id: 'R1_out',     label: 'R1_out',     circuitId: 'sig-r1out',     desc: 'R1 送内总线' },
  { id: 'ALU_ADD',    label: 'ALU_ADD',    circuitId: 'sig-aluadd',    desc: 'ALU 执行加法' },
  { id: 'MEM_Read',   label: 'MEM_Read',   circuitId: 'sig-memread',   desc: '主存读命令 (经 CBUS)' },
  { id: 'MEM_Write',  label: 'MEM_Write',  circuitId: 'sig-memwrite',  desc: '主存写命令 (经 CBUS)' }
];

const SIGNAL_CIRCUIT_MAP = Object.fromEntries(ALL_SIGNALS.map(s => [s.id, s.circuitId]));

function toHex32(val) {
  return '0x' + ((val >>> 0).toString(16).toUpperCase().padStart(8, '0'));
}
function toHex16(val) {
  return '0x' + ((val & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'));
}

// ==========================================================================
// 2. INSTRUCTION MICRO-STEP SPECIFICATIONS
//    flowPath: 数据包 GSAP 轨道 (与 index.html SVG 几何一致)
//    busType:  internal | abus | dbus (决定数据包颜色)
// ==========================================================================

function getInstructionSteps(instType, opA, opB) {
  const sum = (opA + opB) & 0xFFFFFFFF;
  const isZero = sum === 0 ? 1 : 0;
  const isNegative = (sum & 0x80000000) !== 0 ? 1 : 0;
  const carry = (opA + opB) > 0xFFFFFFFF ? 1 : 0;
  const signA = (opA >> 31) & 1;
  const signB = (opB >> 31) & 1;
  const signRes = (sum >> 31) & 1;
  const overflow = (signA === signB && signA !== signRes) ? 1 : 0;
  const flagsResult = { Z: isZero, C: carry, S: isNegative, V: overflow };

  // ---- 取指周期 T0-T3 (公共) ----
  const fetchSteps = [
    {
      id: 'T0',
      phase: '取指周期 (Fetch)',
      phaseBadgeClass: 'bg-blue-100 text-blue-800',
      rtl: '(PC) → MAR    ；PC_out = 1, MAR_in = 1',
      signals: ['PC_out', 'MAR_in'],
      action: 'PC 中的指令首地址经三态门送上内部单总线，MAR 输入门开启，在时钟上升沿将地址 0x0800 打入 MAR。',
      sourceComponent: 'box-pc',
      targetComponent: 'box-mar',
      activeGate: 'gate-pcout',
      activeWires: ['wire-pc-to-bus', 'bus-internal-trunk', 'wire-bus-to-mar'],
      flowPath: [{ x: 478, y: 130 }, { x: 622, y: 130 }],
      busType: 'internal',
      tokenVal: '0x0800',
      registersAfter: { PC: 0x0800, MAR: 0x0800 },
      memoryHighlight: null,
      memoryState: '空闲 (IDLE)'
    },
    {
      id: 'T1',
      phase: '取指周期 (Fetch)',
      phaseBadgeClass: 'bg-blue-100 text-blue-800',
      rtl: '1 → R (经 CBUS), (PC) + 4 → PC (经专用加法器与 MUX)',
      signals: ['MEM_Read', 'PC_MUX_SEL', 'PC_in'],
      action: 'CU 经控制总线 CBUS 向主存发出读命令 (MEM_Read)；MAR 中的地址经地址总线 ABUS 送入主存译码。同时专用 +4 加法器完成 PC 自增，经 PC-MUX 打入 PC，不占用内总线与 ALU。',
      sourceComponent: 'box-mar',
      targetComponent: 'comp-main-memory',
      activeGate: null,
      activeWires: ['wire-mar-to-abus', 'bus-abus-trunk', 'wire-cbus', 'bus-cbus-trunk', 'wire-pc-to-adder', 'wire-adder-to-mux', 'wire-mux-to-pc'],
      flowPath: [{ x: 762, y: 130 }, { x: 910, y: 130 }, { x: 1055, y: 105 }],
      busType: 'abus',
      tokenVal: '0x0800',
      registersAfter: { PC: 0x0804, MAR: 0x0800 },
      memoryHighlight: '0800',
      memoryState: '正在读取指令 (READING)'
    },
    {
      id: 'T2',
      phase: '取指周期 (Fetch)',
      phaseBadgeClass: 'bg-blue-100 text-blue-800',
      rtl: 'M(MAR) → MDR    ；MDR_inE = 1 (DBUS → MDR)',
      signals: ['MEM_Read', 'MDR_inE'],
      action: '主存将 0x0800 处的 32 位指令机器码 0x02001008 送上外部数据总线 DBUS，MDR 开启外总线输入门 (MDR_inE) 将其锁存 —— 主存数据经 DBUS 流入 CPU。',
      sourceComponent: 'comp-main-memory',
      targetComponent: 'box-mdr',
      activeGate: null,
      activeWires: ['bus-dbus-trunk', 'wire-mdr-to-dbus', 'wire-cbus', 'bus-cbus-trunk'],
      flowPath: [{ x: 1055, y: 400 }, { x: 1055, y: 330 }, { x: 910, y: 330 }, { x: 800, y: 330 }, { x: 778, y: 330 }],
      busType: 'dbus',
      tokenVal: '0x02001008',
      registersAfter: { MDR: 0x02001008 },
      memoryHighlight: '0800',
      memoryState: '指令已就绪 (READY)'
    },
    {
      id: 'T3',
      phase: '取指周期 (Fetch)',
      phaseBadgeClass: 'bg-blue-100 text-blue-800',
      rtl: '(MDR) → IR    ；MDR_out = 1, IR_in = 1，CU 译码',
      signals: ['MDR_out', 'IR_in'],
      action: 'MDR 开启内总线侧三态门，将指令机器码送上内部单总线，IR 输入门锁存指令，CU 随即完成操作码译码。取指周期结束。',
      sourceComponent: 'box-mdr',
      targetComponent: 'box-ir',
      activeGate: 'gate-mdrout',
      activeWires: ['wire-mdr-to-bus', 'bus-internal-trunk', 'wire-bus-to-ir'],
      flowPath: [{ x: 620, y: 350 }, { x: 560, y: 350 }, { x: 260, y: 345 }],
      busType: 'internal',
      tokenVal: '0x02001008',
      registersAfter: { IR: 0x02001008 },
      memoryHighlight: null,
      memoryState: '空闲 (IDLE)'
    }
  ];

  if (instType === 'ADD_MEM') {
    return [
      ...fetchSteps,
      {
        id: 'T4',
        phase: '取操作数周期 (Operand Fetch)',
        phaseBadgeClass: 'bg-amber-100 text-amber-800',
        rtl: 'Ad(IR) → MAR    ；IR_out = 1, MAR_in = 1',
        signals: ['IR_out', 'MAR_in'],
        action: 'IR 中的形式地址字段 0x1008 经三态门送上内部单总线，MAR 输入门接收该操作数主存地址。',
        sourceComponent: 'box-ir',
        targetComponent: 'box-mar',
        activeGate: 'gate-irout',
        activeWires: ['wire-ir-to-bus', 'bus-internal-trunk', 'wire-bus-to-mar'],
        flowPath: [{ x: 260, y: 310 }, { x: 560, y: 310 }, { x: 560, y: 130 }, { x: 622, y: 130 }],
        busType: 'internal',
        tokenVal: '0x1008',
        registersAfter: { MAR: 0x1008 },
        memoryHighlight: null,
        memoryState: '空闲 (IDLE)'
      },
      {
        id: 'T5',
        phase: '取操作数周期 (Operand Fetch)',
        phaseBadgeClass: 'bg-amber-100 text-amber-800',
        rtl: '1 → R, M(MAR) → MDR    ；MDR_inE = 1',
        signals: ['MEM_Read', 'MDR_inE'],
        action: 'MAR 地址 0x1008 经 ABUS 送主存译码 (绿色数据包为地址流向，随后主存读出操作数)；读出的操作数 B 经外部数据总线 DBUS 流入 MDR。',
        sourceComponent: 'comp-main-memory',
        targetComponent: 'box-mdr',
        activeGate: null,
        activeWires: ['wire-mar-to-abus', 'bus-abus-trunk', 'bus-dbus-trunk', 'wire-mdr-to-dbus', 'wire-cbus', 'bus-cbus-trunk'],
        flowPath: [{ x: 1055, y: 400 }, { x: 1055, y: 330 }, { x: 910, y: 330 }, { x: 800, y: 330 }, { x: 778, y: 330 }],
        busType: 'dbus',
        tokenVal: toHex32(opB),
        registersAfter: { MDR: opB },
        memoryHighlight: '1008',
        memoryState: '操作数读取完毕 (READY)'
      },
      {
        id: 'T6',
        phase: '准备操作数 (Operand Buffer)',
        phaseBadgeClass: 'bg-amber-100 text-amber-800',
        rtl: '(MDR) → Y    ；MDR_out = 1, Y_in = 1',
        signals: ['MDR_out', 'Y_in'],
        action: 'MDR 打开内总线三态门，将操作数 B 送上内部单总线，暂存器 Y 输入门将其锁存。单总线同一时刻只能传一个数，所以必须先缓存到 Y。',
        sourceComponent: 'box-mdr',
        targetComponent: 'box-y',
        activeGate: 'gate-mdrout',
        activeWires: ['wire-mdr-to-bus', 'bus-internal-trunk', 'wire-bus-to-y'],
        flowPath: [{ x: 620, y: 350 }, { x: 560, y: 350 }, { x: 560, y: 465 }, { x: 502, y: 465 }],
        busType: 'internal',
        tokenVal: toHex32(opB),
        registersAfter: { Y: opB },
        memoryHighlight: null,
        memoryState: '空闲 (IDLE)'
      },
      {
        id: 'T7',
        phase: '执行周期 (Execute ALU)',
        phaseBadgeClass: 'bg-emerald-100 text-emerald-800',
        rtl: '(ACC) + (Y) → Z    ；ACC_out = 1, ALU_ADD = 1, Z_in = 1',
        signals: ['ACC_out', 'ALU_ADD', 'Z_in'],
        action: 'ACC 经内总线提供操作数 (流入 ALU 端口 B)，Y 提供另一操作数 (端口 A)；ALU 执行加法，结果打入输出暂存器 Z，标志位 ZF/CF/SF/OF 同步生成。',
        sourceComponent: 'box-acc',
        targetComponent: 'box-z',
        activeGate: 'gate-accout',
        activeWires: ['wire-acc-to-bus', 'bus-internal-trunk', 'wire-bus-to-alu', 'wire-y-to-alu', 'wire-alu-to-z'],
        flowPath: [{ x: 180, y: 888 }, { x: 560, y: 888 }, { x: 560, y: 600 }, { x: 479, y: 600 }, { x: 425, y: 648 }],
        busType: 'internal',
        tokenVal: toHex32(sum),
        registersAfter: { Z: sum, FLAGS: flagsResult },
        memoryHighlight: null,
        memoryState: '空闲 (IDLE)'
      },
      {
        id: 'T8',
        phase: '写回周期 (Writeback)',
        phaseBadgeClass: 'bg-purple-100 text-purple-800',
        rtl: '(Z) → ACC    ；Z_out = 1, ACC_in = 1',
        signals: ['Z_out', 'ACC_in'],
        action: '暂存器 Z 打开三态门，将加法结果送上内部单总线，ACC 输入门打入新值。指令周期执行完毕。',
        sourceComponent: 'box-z',
        targetComponent: 'box-acc',
        activeGate: 'gate-zout',
        activeWires: ['wire-z-to-bus', 'bus-internal-trunk', 'wire-bus-to-acc'],
        flowPath: [{ x: 497, y: 678 }, { x: 560, y: 678 }, { x: 560, y: 868 }, { x: 182, y: 868 }],
        busType: 'internal',
        tokenVal: toHex32(sum),
        registersAfter: { ACC: sum },
        memoryHighlight: null,
        memoryState: '空闲 (IDLE)'
      }
    ];
  }

  if (instType === 'ADD_INDIRECT') {
    return [
      ...fetchSteps,
      {
        id: 'T4',
        phase: '间址周期 (Indirect)',
        phaseBadgeClass: 'bg-amber-100 text-amber-800',
        rtl: '(R0) → MAR    ；R0_out = 1, MAR_in = 1',
        signals: ['R0_out', 'MAR_in'],
        action: 'R0 中存放的操作数有效地址 0x1008 送上内总线，打入 MAR。寄存器间接寻址：寄存器内容是操作数的主存地址。',
        sourceComponent: 'box-r0',
        targetComponent: 'box-mar',
        activeGate: 'gate-r0out',
        activeWires: ['wire-r0-to-bus', 'bus-internal-trunk', 'wire-bus-to-mar'],
        flowPath: [{ x: 180, y: 728 }, { x: 560, y: 728 }, { x: 560, y: 130 }, { x: 622, y: 130 }],
        busType: 'internal',
        tokenVal: '0x1008',
        registersAfter: { MAR: 0x1008 },
        memoryHighlight: null,
        memoryState: '空闲 (IDLE)'
      },
      {
        id: 'T5',
        phase: '取操作数周期 (Operand Fetch)',
        phaseBadgeClass: 'bg-amber-100 text-amber-800',
        rtl: '1 → R, M(MAR) → MDR    ；MDR_inE = 1',
        signals: ['MEM_Read', 'MDR_inE'],
        action: 'CU 经 CBUS 发读命令，MAR 地址经 ABUS 送主存译码，读出的操作数 B 经 DBUS 流入 MDR。',
        sourceComponent: 'comp-main-memory',
        targetComponent: 'box-mdr',
        activeGate: null,
        activeWires: ['wire-mar-to-abus', 'bus-abus-trunk', 'bus-dbus-trunk', 'wire-mdr-to-dbus', 'wire-cbus', 'bus-cbus-trunk'],
        flowPath: [{ x: 1055, y: 400 }, { x: 1055, y: 330 }, { x: 910, y: 330 }, { x: 800, y: 330 }, { x: 778, y: 330 }],
        busType: 'dbus',
        tokenVal: toHex32(opB),
        registersAfter: { MDR: opB },
        memoryHighlight: '1008',
        memoryState: '操作数就绪 (READY)'
      },
      {
        id: 'T6',
        phase: '准备操作数 (Operand Buffer)',
        phaseBadgeClass: 'bg-amber-100 text-amber-800',
        rtl: '(MDR) → Y    ；MDR_out = 1, Y_in = 1',
        signals: ['MDR_out', 'Y_in'],
        action: 'MDR 经内总线将操作数 B 送入暂存器 Y 锁存，为 ALU 运算做准备。',
        sourceComponent: 'box-mdr',
        targetComponent: 'box-y',
        activeGate: 'gate-mdrout',
        activeWires: ['wire-mdr-to-bus', 'bus-internal-trunk', 'wire-bus-to-y'],
        flowPath: [{ x: 620, y: 350 }, { x: 560, y: 350 }, { x: 560, y: 465 }, { x: 502, y: 465 }],
        busType: 'internal',
        tokenVal: toHex32(opB),
        registersAfter: { Y: opB },
        memoryHighlight: null,
        memoryState: '空闲 (IDLE)'
      },
      {
        id: 'T7',
        phase: '执行周期 (Execute ALU)',
        phaseBadgeClass: 'bg-emerald-100 text-emerald-800',
        rtl: '(ACC) + (Y) → Z    ；ACC_out = 1, ALU_ADD = 1, Z_in = 1',
        signals: ['ACC_out', 'ALU_ADD', 'Z_in'],
        action: 'ACC 经内总线送入 ALU，与 Y 中操作数相加，结果锁存至 Z，标志位同步更新。',
        sourceComponent: 'box-acc',
        targetComponent: 'box-z',
        activeGate: 'gate-accout',
        activeWires: ['wire-acc-to-bus', 'bus-internal-trunk', 'wire-bus-to-alu', 'wire-y-to-alu', 'wire-alu-to-z'],
        flowPath: [{ x: 180, y: 888 }, { x: 560, y: 888 }, { x: 560, y: 600 }, { x: 479, y: 600 }, { x: 425, y: 648 }],
        busType: 'internal',
        tokenVal: toHex32(sum),
        registersAfter: { Z: sum, FLAGS: flagsResult },
        memoryHighlight: null,
        memoryState: '空闲 (IDLE)'
      },
      {
        id: 'T8',
        phase: '写回周期 (Writeback)',
        phaseBadgeClass: 'bg-purple-100 text-purple-800',
        rtl: '(Z) → ACC    ；Z_out = 1, ACC_in = 1',
        signals: ['Z_out', 'ACC_in'],
        action: '暂存器 Z 经内总线将结果写回 ACC，指令执行完成。',
        sourceComponent: 'box-z',
        targetComponent: 'box-acc',
        activeGate: 'gate-zout',
        activeWires: ['wire-z-to-bus', 'bus-internal-trunk', 'wire-bus-to-acc'],
        flowPath: [{ x: 497, y: 678 }, { x: 560, y: 678 }, { x: 560, y: 868 }, { x: 182, y: 868 }],
        busType: 'internal',
        tokenVal: toHex32(sum),
        registersAfter: { ACC: sum },
        memoryHighlight: null,
        memoryState: '空闲 (IDLE)'
      }
    ];
  }

  if (instType === 'ADD_REG') {
    return [
      ...fetchSteps,
      {
        id: 'T4',
        phase: '取操作数 (Register Fetch)',
        phaseBadgeClass: 'bg-amber-100 text-amber-800',
        rtl: '(R1) → Y    ；R1_out = 1, Y_in = 1',
        signals: ['R1_out', 'Y_in'],
        action: '寄存器 R1 中的操作数直接经内总线送入暂存器 Y 锁存，全程无需访问主存。',
        sourceComponent: 'box-r1',
        targetComponent: 'box-y',
        activeGate: 'gate-r1out',
        activeWires: ['wire-r1-to-bus', 'bus-internal-trunk', 'wire-bus-to-y'],
        flowPath: [{ x: 180, y: 802 }, { x: 560, y: 802 }, { x: 560, y: 465 }, { x: 502, y: 465 }],
        busType: 'internal',
        tokenVal: toHex32(opB),
        registersAfter: { Y: opB },
        memoryHighlight: null,
        memoryState: '空闲 (IDLE)'
      },
      {
        id: 'T5',
        phase: '执行周期 (Execute ALU)',
        phaseBadgeClass: 'bg-emerald-100 text-emerald-800',
        rtl: '(ACC) + (Y) → Z    ；ACC_out = 1, ALU_ADD = 1, Z_in = 1',
        signals: ['ACC_out', 'ALU_ADD', 'Z_in'],
        action: 'ACC 经内总线送入 ALU 与 Y 中操作数相加，结果锁存至 Z。',
        sourceComponent: 'box-acc',
        targetComponent: 'box-z',
        activeGate: 'gate-accout',
        activeWires: ['wire-acc-to-bus', 'bus-internal-trunk', 'wire-bus-to-alu', 'wire-y-to-alu', 'wire-alu-to-z'],
        flowPath: [{ x: 180, y: 888 }, { x: 560, y: 888 }, { x: 560, y: 600 }, { x: 479, y: 600 }, { x: 425, y: 648 }],
        busType: 'internal',
        tokenVal: toHex32(sum),
        registersAfter: { Z: sum, FLAGS: flagsResult },
        memoryHighlight: null,
        memoryState: '空闲 (IDLE)'
      },
      {
        id: 'T6',
        phase: '写回周期 (Writeback)',
        phaseBadgeClass: 'bg-purple-100 text-purple-800',
        rtl: '(Z) → ACC    ；Z_out = 1, ACC_in = 1',
        signals: ['Z_out', 'ACC_in'],
        action: '暂存器 Z 经内总线将结果写回 ACC，寄存器寻址加法指令完成（不访存，总节拍数最少）。',
        sourceComponent: 'box-z',
        targetComponent: 'box-acc',
        activeGate: 'gate-zout',
        activeWires: ['wire-z-to-bus', 'bus-internal-trunk', 'wire-bus-to-acc'],
        flowPath: [{ x: 497, y: 678 }, { x: 560, y: 678 }, { x: 560, y: 868 }, { x: 182, y: 868 }],
        busType: 'internal',
        tokenVal: toHex32(sum),
        registersAfter: { ACC: sum },
        memoryHighlight: null,
        memoryState: '空闲 (IDLE)'
      }
    ];
  }

  // ADD_IMM
  return [
    ...fetchSteps,
    {
      id: 'T4',
      phase: '取立即数 (Immediate)',
      phaseBadgeClass: 'bg-amber-100 text-amber-800',
      rtl: 'Ad(IR) → Y    ；IR_out = 1, Y_in = 1',
      signals: ['IR_out', 'Y_in'],
      action: 'IR 中的立即数字段直接经内总线送入暂存器 Y，操作数随指令一起取出，无需再次访存。',
      sourceComponent: 'box-ir',
      targetComponent: 'box-y',
      activeGate: 'gate-irout',
      activeWires: ['wire-ir-to-bus', 'bus-internal-trunk', 'wire-bus-to-y'],
      flowPath: [{ x: 260, y: 310 }, { x: 560, y: 310 }, { x: 560, y: 465 }, { x: 502, y: 465 }],
      busType: 'internal',
      tokenVal: toHex32(opB),
      registersAfter: { Y: opB },
      memoryHighlight: null,
      memoryState: '空闲 (IDLE)'
    },
    {
      id: 'T5',
      phase: '执行周期 (Execute ALU)',
      phaseBadgeClass: 'bg-emerald-100 text-emerald-800',
      rtl: '(ACC) + (Y) → Z    ；ACC_out = 1, ALU_ADD = 1, Z_in = 1',
      signals: ['ACC_out', 'ALU_ADD', 'Z_in'],
      action: 'ACC 经内总线送入 ALU 与立即数相加，结果锁存至 Z。',
      sourceComponent: 'box-acc',
      targetComponent: 'box-z',
      activeGate: 'gate-accout',
      activeWires: ['wire-acc-to-bus', 'bus-internal-trunk', 'wire-bus-to-alu', 'wire-y-to-alu', 'wire-alu-to-z'],
      flowPath: [{ x: 180, y: 888 }, { x: 560, y: 888 }, { x: 560, y: 600 }, { x: 479, y: 600 }, { x: 425, y: 648 }],
      busType: 'internal',
      tokenVal: toHex32(sum),
      registersAfter: { Z: sum, FLAGS: flagsResult },
      memoryHighlight: null,
      memoryState: '空闲 (IDLE)'
    },
    {
      id: 'T6',
      phase: '写回周期 (Writeback)',
      phaseBadgeClass: 'bg-purple-100 text-purple-800',
      rtl: '(Z) → ACC    ；Z_out = 1, ACC_in = 1',
      signals: ['Z_out', 'ACC_in'],
      action: '暂存器 Z 经内总线将结果写回 ACC，立即寻址加法指令完成。',
      sourceComponent: 'box-z',
      targetComponent: 'box-acc',
      activeGate: 'gate-zout',
      activeWires: ['wire-z-to-bus', 'bus-internal-trunk', 'wire-bus-to-acc'],
      flowPath: [{ x: 497, y: 678 }, { x: 560, y: 678 }, { x: 560, y: 868 }, { x: 182, y: 868 }],
      busType: 'internal',
      tokenVal: toHex32(sum),
      registersAfter: { ACC: sum },
      memoryHighlight: null,
      memoryState: '空闲 (IDLE)'
    }
  ];
}

// ==========================================================================
// 3. UI INITIALIZATION
// ==========================================================================

function initSignalMatrix() {
  const container = document.getElementById('signal-matrix-grid');
  container.innerHTML = '';
  ALL_SIGNALS.forEach(sig => {
    const badge = document.createElement('div');
    badge.id = `badge-sig-${sig.id}`;
    badge.className = 'signal-badge inactive flex items-center justify-between';
    badge.title = sig.desc;
    badge.innerHTML = `
      <span>${sig.label}</span>
      <span class="text-[9px] opacity-70 font-mono-num sig-val">0</span>
    `;
    container.appendChild(badge);
  });
}

function initTimeline() {
  const steps = getInstructionSteps(State.currentInstruction, State.operandA, State.operandB);
  const container = document.getElementById('timeline-container');
  container.innerHTML = '';

  steps.forEach((step, idx) => {
    const btn = document.createElement('button');
    btn.className = `timeline-node px-3 py-1.5 rounded-xl border text-xs font-mono font-bold flex flex-col items-center gap-0.5 min-w-[72px] transition ${idx === 0 ? 'current' : 'future'}`;
    btn.dataset.index = idx;
    btn.innerHTML = `
      <span>${step.id}</span>
      <span class="text-[9px] font-normal opacity-80">${step.phase.split(' ')[0]}</span>
    `;
    btn.addEventListener('click', () => {
      pausePlayback();
      goToStep(idx);
    });
    container.appendChild(btn);
  });
}

function updateTimelineView(currIdx) {
  document.querySelectorAll('.timeline-node').forEach((node, idx) => {
    node.classList.remove('current', 'passed', 'future');
    if (idx === currIdx) node.classList.add('current');
    else if (idx < currIdx) node.classList.add('passed');
    else node.classList.add('future');
  });
}

function updateRegisterTable() {
  const regs = [
    { name: 'PC', hex: toHex16(State.registers.PC), desc: '下一条指令地址' },
    { name: 'MAR', hex: toHex16(State.registers.MAR), desc: 'ABUS 地址输出源' },
    { name: 'MDR', hex: toHex32(State.registers.MDR), desc: 'DBUS 双向中继' },
    { name: 'IR', hex: toHex32(State.registers.IR), desc: '操作码 + 地址码' },
    { name: 'Y', hex: toHex32(State.registers.Y), desc: 'ALU 输入暂存' },
    { name: 'Z', hex: toHex32(State.registers.Z), desc: 'ALU 输出暂存' },
    { name: 'ACC', hex: toHex32(State.registers.ACC), desc: '累加器' },
    { name: 'R0', hex: toHex32(State.registers.R0), desc: '间址指针 0x1008' },
    { name: 'R1', hex: toHex32(State.registers.R1), desc: '通用寄存器' },
    { name: 'FLAGS', hex: `Z${State.registers.FLAGS.Z} C${State.registers.FLAGS.C} S${State.registers.FLAGS.S} V${State.registers.FLAGS.V}`, desc: '零/进位/符号/溢出' }
  ];

  document.getElementById('register-table-body').innerHTML = regs.map(r => `
    <tr>
      <td class="py-1 font-bold text-stone-900">${r.name}</td>
      <td class="py-1 font-mono-num text-amber-700 font-semibold">${r.hex}</td>
      <td class="py-1 text-stone-500 text-[11px]">${r.desc}</td>
    </tr>
  `).join('');

  // 同步电路图内数值
  document.getElementById('val-pc').textContent = toHex16(State.registers.PC);
  document.getElementById('val-mar').textContent = toHex16(State.registers.MAR);
  document.getElementById('val-mdr').textContent = toHex32(State.registers.MDR);
  document.getElementById('val-ir').textContent = toHex32(State.registers.IR);
  document.getElementById('val-y').textContent = toHex32(State.registers.Y);
  document.getElementById('val-z').textContent = toHex32(State.registers.Z);
  document.getElementById('val-acc').textContent = toHex32(State.registers.ACC);
  document.getElementById('val-r0').textContent = toHex32(State.registers.R0);
  document.getElementById('val-r1').textContent = toHex32(State.registers.R1);
  document.getElementById('flag-z').textContent = State.registers.FLAGS.Z;
  document.getElementById('flag-c').textContent = State.registers.FLAGS.C;
  document.getElementById('flag-s').textContent = State.registers.FLAGS.S;
  document.getElementById('flag-v').textContent = State.registers.FLAGS.V;
}

// ==========================================================================
// 4. STEP RENDERING (GSAP)
// ==========================================================================

function clearActiveVisuals() {
  document.querySelectorAll('.bus-internal-wire, .bus-abus-line, .bus-dbus-line, .bus-cbus-line, .bus-trunk').forEach(el => {
    el.classList.remove('active', 'flow-animating');
  });
  document.querySelectorAll('.component-box').forEach(el => {
    el.classList.remove('highlight-in', 'highlight-out', 'highlight-active');
  });
  document.querySelectorAll('.tristate-gate').forEach(el => el.classList.remove('open'));
  document.querySelectorAll('#cpu-svg .signal-badge, #cpu-svg .pin-label').forEach(el => {
    el.classList.remove('active');
    el.classList.add('inactive');
  });
  ALL_SIGNALS.forEach(sig => {
    const badge = document.getElementById(`badge-sig-${sig.id}`);
    if (badge) {
      badge.classList.remove('active');
      badge.classList.add('inactive');
      badge.querySelector('.sig-val').textContent = '0';
    }
  });
  gsap.set(document.getElementById('data-packet'), { opacity: 0 });
  document.querySelectorAll('.memory-svg-row rect').forEach(rect => {
    rect.setAttribute('fill', '#F8FAFC');
    rect.setAttribute('stroke', '#E2E8F0');
  });
}

function applyStep(step, animate = true) {
  clearActiveVisuals();

  // 1. 文本区
  document.getElementById('badge-phase').textContent = step.phase;
  document.getElementById('badge-phase').className = `px-2 py-0.5 rounded text-[11px] font-mono font-bold ${step.phaseBadgeClass}`;
  document.getElementById('badge-cycle-num').textContent = `${step.id} 时钟节拍`;
  document.getElementById('rtl-formula').textContent = step.rtl;
  document.getElementById('hardware-action-desc').textContent = step.action;
  document.getElementById('canvas-status-step').textContent = `时钟周期: ${step.id} (${step.phase.split(' ')[0]})`;
  document.getElementById('canvas-status-rtl').textContent = `微操作: ${step.rtl}`;

  // 2. 控制信号 (矩阵 + 电路图, 经显式 circuitId 映射)
  step.signals.forEach(sigId => {
    const matrixBadge = document.getElementById(`badge-sig-${sigId}`);
    if (matrixBadge) {
      matrixBadge.classList.remove('inactive');
      matrixBadge.classList.add('active');
      matrixBadge.querySelector('.sig-val').textContent = '1';
    }
    const circuitElId = SIGNAL_CIRCUIT_MAP[sigId];
    if (circuitElId) {
      const el = document.getElementById(circuitElId);
      if (el) {
        el.classList.remove('inactive');
        el.classList.add('active');
      }
    }
  });
  document.getElementById('active-signals-count').textContent = `有效: ${step.signals.length} 个`;

  // 3. 导线与总线高亮
  step.activeWires.forEach(wireId => {
    const el = document.getElementById(wireId);
    if (el) el.classList.add('active', 'flow-animating');
  });

  // 4. 三态门
  if (step.activeGate) {
    const gateEl = document.getElementById(step.activeGate);
    if (gateEl) gateEl.classList.add('open');
  }

  // 5. 源/目标部件高亮
  if (step.sourceComponent) {
    const src = document.getElementById(step.sourceComponent);
    if (src) src.classList.add('highlight-out');
  }
  if (step.targetComponent) {
    const tgt = document.getElementById(step.targetComponent);
    if (tgt) tgt.classList.add('highlight-in');
  }

  // 6. 寄存器状态
  if (step.registersAfter) {
    Object.assign(State.registers, step.registersAfter);
  }
  updateRegisterTable();

  // 7. 主存高亮 + 译码地址
  document.getElementById('mem-decoded-addr').textContent = `MAR = ${toHex16(State.registers.MAR)}`;
  if (step.memoryHighlight) {
    const memRow = document.getElementById(`mem-row-${step.memoryHighlight}`);
    if (memRow) {
      const rect = memRow.querySelector('rect');
      if (rect) {
        rect.setAttribute('fill', '#EFF6FF');
        rect.setAttribute('stroke', '#3B82F6');
      }
    }
    document.getElementById('mem-decoded-addr').textContent = `MAR = 0x${step.memoryHighlight}`;
  }
  const memLed = document.getElementById('mem-status-led');
  const memText = document.getElementById('mem-status-text');
  memText.textContent = `存储器状态: ${step.memoryState}`;
  if (step.signals.includes('MEM_Read')) memLed.setAttribute('fill', '#10B981');
  else if (step.signals.includes('MEM_Write')) memLed.setAttribute('fill', '#EF4444');
  else memLed.setAttribute('fill', '#94A3B8');

  // 8. GSAP 数据包流动 (颜色随所在总线变化)
  if (animate && step.flowPath && step.flowPath.length >= 2) {
    const packet = document.getElementById('data-packet');
    const packetBody = document.getElementById('packet-body');
    const packetText = document.getElementById('data-packet-text');
    packetText.textContent = step.tokenVal;
    packetBody.setAttribute('fill', BUS_TOKEN_COLORS[step.busType] || BUS_TOKEN_COLORS.internal);

    const dur = 1.0 / State.playbackSpeed;
    const path = step.flowPath;

    gsap.set(packet, { x: path[0].x, y: path[0].y, opacity: 0, scale: 0.6 });

    const tl = gsap.timeline();
    tl.to(packet, { opacity: 1, scale: 1, duration: 0.2 * dur, ease: 'back.out(1.5)' });
    for (let i = 1; i < path.length; i++) {
      tl.to(packet, {
        x: path[i].x,
        y: path[i].y,
        duration: (0.7 * dur) / (path.length - 1),
        ease: 'power1.inOut'
      });
    }
    tl.to(packet, {
      opacity: 0,
      scale: 0.5,
      duration: 0.2 * dur,
      ease: 'power2.in',
      onComplete: () => {
        if (step.targetComponent) {
          const tgt = document.getElementById(step.targetComponent);
          if (tgt) gsap.fromTo(tgt, { scale: 1.03 }, { scale: 1.0, duration: 0.3, ease: 'power2.out' });
        }
      }
    });

    if (State.activeTween) State.activeTween.kill();
    State.activeTween = tl;
  }
}

function goToStep(index, animate = true) {
  const steps = getInstructionSteps(State.currentInstruction, State.operandA, State.operandB);
  if (index < 0 || index >= steps.length) return;

  State.currentStepIndex = index;
  updateTimelineView(index);

  // 重放累积状态至当前节拍
  resetHardwareState();
  for (let i = 0; i <= index; i++) {
    if (steps[i].registersAfter) Object.assign(State.registers, steps[i].registersAfter);
  }

  applyStep(steps[index], animate);
}

function nextStep() {
  const steps = getInstructionSteps(State.currentInstruction, State.operandA, State.operandB);
  if (State.currentStepIndex < steps.length - 1) {
    goToStep(State.currentStepIndex + 1, true);
  } else if (State.isPlaying) {
    goToStep(0, true);
  }
}

function prevStep() {
  if (State.currentStepIndex > 0) goToStep(State.currentStepIndex - 1, true);
}

// ==========================================================================
// 5. PLAYBACK
// ==========================================================================

function startPlayback() {
  State.isPlaying = true;
  document.getElementById('play-icon').textContent = '⏸';
  document.getElementById('play-text').textContent = '暂停播放';

  function playLoop() {
    if (!State.isPlaying) return;
    const steps = getInstructionSteps(State.currentInstruction, State.operandA, State.operandB);
    const stepDurationMs = 1600 / State.playbackSpeed;

    if (State.currentStepIndex < steps.length - 1) {
      nextStep();
      State.playTimer = setTimeout(playLoop, stepDurationMs);
    } else {
      State.playTimer = setTimeout(() => {
        if (!State.isPlaying) return;
        goToStep(0, true);
        State.playTimer = setTimeout(playLoop, stepDurationMs);
      }, stepDurationMs * 1.5);
    }
  }
  playLoop();
}

function pausePlayback() {
  State.isPlaying = false;
  clearTimeout(State.playTimer);
  if (State.activeTween) State.activeTween.kill();
  document.getElementById('play-icon').textContent = '▶';
  document.getElementById('play-text').textContent = '自动播放';
}

function togglePlayback() {
  if (State.isPlaying) pausePlayback();
  else startPlayback();
}

// ==========================================================================
// 6. HARDWARE STATE & OPERANDS
// ==========================================================================

function resetHardwareState() {
  State.registers = {
    PC: 0x0800,
    MAR: 0x0800,
    MDR: 0x00000000,
    IR: 0x00000000,
    Y: 0x00000000,
    Z: 0x00000000,
    ACC: State.operandA,
    R0: 0x00001008,
    R1: State.operandB,
    FLAGS: { Z: 0, C: 0, S: 0, V: 0 }
  };
}

function updateOperandCalculations() {
  const rawA = document.getElementById('input-op-a').value.trim();
  const rawB = document.getElementById('input-op-b').value.trim();
  let valA = parseInt(rawA, rawA.startsWith('0x') ? 16 : 10);
  let valB = parseInt(rawB, rawB.startsWith('0x') ? 16 : 10);
  if (isNaN(valA)) valA = 21;
  if (isNaN(valB)) valB = 42;

  State.operandA = valA & 0xFFFFFFFF;
  State.operandB = valB & 0xFFFFFFFF;

  const b0 = (State.operandB >> 24) & 0xFF;
  const b1 = (State.operandB >> 16) & 0xFF;
  const b2 = (State.operandB >> 8) & 0xFF;
  const b3 = State.operandB & 0xFF;
  document.getElementById('mem-byte-1008-0').textContent = '0x' + b0.toString(16).padStart(2, '0').toUpperCase();
  document.getElementById('mem-byte-1008-1').textContent = '0x' + b1.toString(16).padStart(2, '0').toUpperCase();
  document.getElementById('mem-byte-1008-2').textContent = '0x' + b2.toString(16).padStart(2, '0').toUpperCase();
  document.getElementById('mem-byte-1008-3').textContent = '0x' + b3.toString(16).padStart(2, '0').toUpperCase();
  document.getElementById('mem-val-1008').textContent = `数值: ${toHex32(State.operandB)} (${State.operandB})`;

  initTimeline();
  resetHardwareState();
  goToStep(0, false);
}

// ==========================================================================
// 7. BOOTSTRAP
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initSignalMatrix();
  updateOperandCalculations();

  document.getElementById('instruction-select').addEventListener('change', (e) => {
    pausePlayback();
    State.currentInstruction = e.target.value;
    const titles = {
      ADD_MEM: '当前指令: ADD [1008H], ACC (主存直接寻址)',
      ADD_INDIRECT: '当前指令: ADD (R0), ACC (寄存器间接寻址)',
      ADD_REG: '当前指令: ADD R1, ACC (寄存器直接寻址)',
      ADD_IMM: '当前指令: ADD #42H, ACC (立即数寻址)'
    };
    document.getElementById('cu-op-desc').textContent = titles[State.currentInstruction] || '';
    initTimeline();
    resetHardwareState();
    goToStep(0, false);
  });

  document.getElementById('btn-play-pause').addEventListener('click', togglePlayback);
  document.getElementById('btn-step-next').addEventListener('click', () => { pausePlayback(); nextStep(); });
  document.getElementById('btn-step-prev').addEventListener('click', () => { pausePlayback(); prevStep(); });
  document.getElementById('btn-reset').addEventListener('click', () => { pausePlayback(); resetHardwareState(); goToStep(0, false); });

  document.getElementById('speed-slider').addEventListener('input', (e) => {
    State.playbackSpeed = parseFloat(e.target.value);
    document.getElementById('speed-val').textContent = State.playbackSpeed.toFixed(1) + 'x';
  });

  document.getElementById('input-op-a').addEventListener('input', updateOperandCalculations);
  document.getElementById('input-op-b').addEventListener('input', updateOperandCalculations);

  goToStep(0, false);
});
