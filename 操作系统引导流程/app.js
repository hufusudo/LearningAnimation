/* ==========================================================================
   操作系统引导流程演示
   主线: 加电 → ROM(BIOS) 取指 POST → 读磁盘引导扇区 MBR → 扫描分区表
        → 读取活动分区引导记录 DBR → OS 内核调入主存 → 跳转内核
   规范: GSAP 时间轴驱动, 支持 60fps 双向 scrub, 浅色纸面风格
   ========================================================================== */

gsap.registerPlugin(MotionPathPlugin);

const SVG_NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("boot-svg");

/* ------------------------------------------------------------------ */
/* 步骤定义                                                            */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    title: "加电复位：控制权交给 ROM",
    desc: "按下电源后 CPU 被复位，硬件将 CS:IP 置为 F000:FFF0，该地址映射到主板 Flash 中的 BIOS ROM。此时主存(RAM)尚未初始化，CPU 只能执行固化在 ROM 中的固件代码。",
    micro: "RESET# 有效 → CS:IP = F000:FFF0 → 到 ROM 映射区取第一条指令",
  },
  {
    title: "BIOS POST 自检",
    desc: "ROM 中的 BIOS 程序执行加电自检 (POST)：检查 CPU、初始化内存、枚举外设，并在中断向量表中登记基本 I/O 服务例程（如 INT 13H 磁盘服务）。自检通过后按启动顺序寻找引导盘。",
    micro: "POST: 自检 CPU/内存/外设 → 建立 IVT → INT 13H 服务就绪",
  },
  {
    title: "读取磁盘引导扇区 (MBR)",
    desc: "BIOS 通过 INT 13H 将引导磁盘的 0 号扇区——主引导记录 MBR（512 字节：磁盘引导程序 446B + 分区表 64B + 结束魔数 0x55AA）——读入主存 0x7C00 处，校验魔数后跳转执行。",
    micro: "INT 13H · AH=02 → 读 0 柱面 0 磁头 1 扇区 → ES:BX = 0x7C00 · 校验 55 AA",
  },
  {
    title: "MBR 扫描分区表，定位活动分区",
    desc: "CPU 从 0x7C00 开始执行磁盘引导程序。它遍历分区表中 4 个 16 字节的表项，寻找活动标志为 0x80 的分区——它就是操作系统的家。",
    micro: "扫描分区表 4 × 16B → 命中活动标志 0x80 → 分区 1 (系统分区)",
  },
  {
    title: "读取分区引导记录 (DBR)",
    desc: "磁盘引导程序将活动分区的第一个扇区——分区引导记录 DBR（含该分区的引导程序与文件系统信息）——读入主存，然后把控制权跳转给它。引导接力棒正式从固件传给磁盘上的代码。",
    micro: "读活动分区第 1 扇区 (DBR) → 装入 0x7E00 → JMP 0x7E00 执行",
  },
  {
    title: "OS 内核调入主存",
    desc: "分区引导程序（或其加载器）解析文件系统，将 OS 内核镜像从磁盘分批读入主存高地址区（如 1MiB 以上），内核代码与数据在内存中就位。",
    micro: "loader: 解析文件系统 → vmlinuz 分批调入 0x100000+ (内核区)",
  },
  {
    title: "跳转内核：操作系统接管",
    desc: "加载完毕，CPU 执行远跳转进入内核入口，切换至保护模式。至此引导链条闭合：ROM → MBR → DBR → 内核，操作系统开始在主存中运行。",
    micro: "far JMP 内核入口 → 切换保护模式 → OS 已驻留主存并开始运行",
  },
];

/* ------------------------------------------------------------------ */
/* SVG 构件工具                                                        */
/* ------------------------------------------------------------------ */

function el(tag, attrs = {}, text = null) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== null) e.textContent = text;
  return e;
}

const layers = {
  wires: el("g"), zones: el("g"), disk: el("g"), paths: el("g"),
  packets: el("g"), overlays: el("g"),
};
Object.values(layers).forEach((l) => svg.appendChild(l));

function label(x, y, str, cls, anchor = "middle") {
  const t = el("text", { x, y, class: cls, "text-anchor": anchor }, str);
  layers.zones.appendChild(t);
  return t;
}

/* ------------------------------------------------------------------ */
/* 主存列 (高地址在上)                                                  */
/* ------------------------------------------------------------------ */

const MEM_X = 150, MEM_W = 200;

label(MEM_X + MEM_W / 2, 46, "主存 (Memory)", "zone-label");
label(MEM_X - 14, 76, "0xFFFFF", "addr-label key");
label(MEM_X - 14, 136, "0xF0000", "addr-label key");
label(MEM_X - 14, 196, "0x100000+", "addr-label");
label(MEM_X - 14, 346, "0x7E00", "addr-label key");
label(MEM_X - 14, 416, "0x7C00", "addr-label key");
label(MEM_X - 14, 556, "0x00000", "addr-label");

// ROM 区
layers.zones.appendChild(
  el("rect", { x: MEM_X, y: 70, width: MEM_W, height: 60, rx: 6, class: "mem-rom", id: "rom-zone" })
);
label(MEM_X + MEM_W / 2, 94, "ROM 区 · BIOS 固件", "sector-text");
label(MEM_X + MEM_W / 2, 110, "POST / INT 13H 服务", "sector-sub");

// 内核加载区 (初始为虚线空槽)
const kernZone = el("rect", { x: MEM_X, y: 170, width: MEM_W, height: 90, rx: 6, class: "mem-kernel", id: "kern-zone" });
layers.zones.appendChild(kernZone);
const kernText = label(MEM_X + MEM_W / 2, 208, "内核加载区", "slot-text");
const kernSub = label(MEM_X + MEM_W / 2, 226, "待装入…", "sector-sub");
label(MEM_X + MEM_W / 2, 246, "0x100000+", "zone-sub");

// DBR 槽位
const dbrSlot = el("rect", { x: MEM_X, y: 310, width: MEM_W, height: 48, rx: 6, class: "mem-slot", id: "dbr-slot" });
layers.zones.appendChild(dbrSlot);
const dbrText = label(MEM_X + MEM_W / 2, 339, "分区引导记录", "slot-text");

// MBR 槽位
const mbrSlot = el("rect", { x: MEM_X, y: 380, width: MEM_W, height: 48, rx: 6, class: "mem-slot", id: "mbr-slot" });
layers.zones.appendChild(mbrSlot);
const mbrText = label(MEM_X + MEM_W / 2, 409, "MBR 落位处", "slot-text");

// 空闲 RAM
layers.zones.appendChild(
  el("rect", { x: MEM_X, y: 450, width: MEM_W, height: 110, rx: 6, class: "mem-free" })
);
label(MEM_X + MEM_W / 2, 510, "空闲 RAM", "slot-text");

/* ------------------------------------------------------------------ */
/* CPU                                                                */
/* ------------------------------------------------------------------ */

layers.zones.appendChild(el("rect", { x: 430, y: 80, width: 190, height: 88, rx: 10, class: "cpu-box" }));
label(525, 110, "CPU", "cpu-title");
const pcText = label(525, 138, "PC  F000:FFF0", "pc-text");
label(525, 156, "取指 · 译码 · 执行", "sector-sub");

/* ------------------------------------------------------------------ */
/* 磁盘                                                               */
/* ------------------------------------------------------------------ */

label(840, 46, "引导磁盘 (Disk)", "zone-label");
layers.disk.appendChild(el("rect", { x: 720, y: 60, width: 240, height: 460, rx: 10, class: "disk-body" }));

// 扇区 0: MBR
layers.disk.appendChild(el("rect", { x: 736, y: 76, width: 208, height: 120, rx: 5, class: "sector-mbr", id: "sector-mbr" }));
label(840, 94, "扇区 0 · MBR (512B)", "sector-text");
label(748, 116, "磁盘引导程序 446B", "sector-sub");
label(748, 130, "分区表 64B →", "sector-sub");
// 分区表 4 个表项
for (let i = 0; i < 4; i++) {
  layers.disk.appendChild(el("rect", { x: 826 + i * 27, y: 118, width: 25, height: 30, rx: 2, class: "part-cell", id: `pt-cell-${i}` }));
  layers.disk.appendChild(el("text", { x: 838.5 + i * 27, y: 137, class: "cell-text" }, `P${i + 1}`));
}
label(748, 172, "结束魔数", "sector-sub");
layers.disk.appendChild(el("rect", { x: 826, y: 160, width: 60, height: 22, rx: 3, fill: "#FEF2F2", stroke: "#FCA5A5" }));
label(856, 175, "55 AA", "sector-text");

// 分区 1: 活动分区
layers.disk.appendChild(el("rect", { x: 736, y: 226, width: 208, height: 160, rx: 5, class: "partition", id: "part1" }));
label(848, 246, "分区 1 · 系统分区", "sector-text");
const partFlag = label(930, 246, "0x80", "sector-sub");
partFlag.setAttribute("text-anchor", "end");
label(752, 266, "DBR 分区引导记录", "sector-sub");
layers.disk.appendChild(el("rect", { x: 752, y: 274, width: 176, height: 30, rx: 3, fill: "#FFFFFF", stroke: "#CBD5E1", id: "sector-dbr" }));
label(840, 294, "第 1 扇区 · 引导程序", "sector-sub");
// 内核镜像文件
label(752, 326, "文件系统区", "sector-sub");
const kernFile = el("rect", { x: 752, y: 334, width: 176, height: 40, rx: 4, class: "file-kernel", id: "file-kernel" });
layers.disk.appendChild(kernFile);
label(840, 359, "OS 内核镜像 (vmlinuz)", "sector-text");

// 分区 2: 数据分区
layers.disk.appendChild(el("rect", { x: 736, y: 416, width: 208, height: 80, rx: 5, class: "partition" }));
label(840, 460, "分区 2 · 数据分区", "sector-text");

/* ------------------------------------------------------------------ */
/* 总线引线 + I/O 路径 + 执行路径                                       */
/* ------------------------------------------------------------------ */

// 系统总线引线 (CPU → 内存 / 磁盘)
layers.wires.appendChild(el("path", { d: "M 430 120 C 390 120 380 300 350 300", class: "wire" }));
layers.wires.appendChild(el("path", { d: "M 620 120 C 680 120 700 240 726 240", class: "wire" }));
label(378, 108, "系统总线", "zone-sub");

// I/O 数据流路径 (数据包沿其运动)
const ioPaths = {
  mbr: "M 730 140 C 600 140 480 380 356 404",
  dbr: "M 730 288 C 590 288 470 330 356 334",
  kern: "M 730 354 C 540 354 540 215 356 215",
};
const ioEls = {};
for (const [k, d] of Object.entries(ioPaths)) {
  ioEls[k] = el("path", { d, class: "io-path", id: `io-${k}` });
  layers.paths.appendChild(ioEls[k]);
}

// 控制流跳转路径 (虚线, 执行权转移时点亮)
const execPaths = {
  toMBR: "M 440 168 C 400 250 380 340 356 396",
  toDBR: "M 440 168 C 390 240 380 290 356 326",
  toKern: "M 440 168 C 390 200 380 205 356 208",
};
const execEls = {};
for (const [k, d] of Object.entries(execPaths)) {
  execEls[k] = el("path", { d, class: "exec-path", id: `exec-${k}` });
  layers.paths.appendChild(execEls[k]);
}

/* ------------------------------------------------------------------ */
/* 数据包 / 执行点                                                     */
/* ------------------------------------------------------------------ */

function makePacket(id, text) {
  const g = el("g", { id, opacity: 0 });
  g.appendChild(el("rect", { x: -46, y: -13, width: 92, height: 26, rx: 13, class: "pkt-rect" }));
  g.appendChild(el("text", { x: 0, y: 4.5, class: "pkt-text", "text-anchor": "middle" }, text));
  layers.packets.appendChild(g);
  return g;
}
const pktMBR = makePacket("pkt-mbr", "MBR 512B");
const pktDBR = makePacket("pkt-dbr", "DBR 512B");
const pktKern = makePacket("pkt-kern", "vmlinuz");

// 执行点 (紫色小圆, 标记 CPU 当前执行位置)
const pcDot = el("circle", { r: 6, class: "pc-dot", id: "pc-dot", opacity: 0 });
layers.overlays.appendChild(pcDot);

// 完成徽标
const doneBadge = el("g", { id: "done-badge", opacity: 0 });
doneBadge.appendChild(el("rect", { x: 444, y: 186, width: 162, height: 34, rx: 17, fill: "#ECFDF5", stroke: "#059669", "stroke-width": 1.8 }));
doneBadge.appendChild(el("text", { x: 525, y: 208, class: "pkt-text", "text-anchor": "middle", fill: "#065F46" }, "✔ OS 已接管"));
layers.overlays.appendChild(doneBadge);

/* ------------------------------------------------------------------ */
/* scrub 安全辅助: 文本切换 / 类切换 (代理对象 + onUpdate, 双向 scrub)   */
/* ------------------------------------------------------------------ */

function textSwap(target, fromText, toText, at) {
  const proxy = { v: 0 };
  tl.to(proxy, {
    v: 1, duration: 0.01, ease: "none", immediateRender: false,
    onUpdate: () => { target.textContent = proxy.v < 0.5 ? fromText : toText; },
  }, at);
}

function classSwap(target, fromCls, toCls, at) {
  const proxy = { v: 0 };
  tl.to(proxy, {
    v: 1, duration: 0.01, ease: "none", immediateRender: false,
    onUpdate: () => { target.setAttribute("class", proxy.v < 0.5 ? fromCls : toCls); },
  }, at);
}

/* ------------------------------------------------------------------ */
/* GSAP 主时间轴 (7 个阶段)                                             */
/* ------------------------------------------------------------------ */

const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.inOut" } });

/* S0 加电复位: ROM 点亮, 执行点落位 */
tl.addLabel("s0")
  .fromTo("#rom-zone", { opacity: 0.55 }, { opacity: 1, duration: 0.5, immediateRender: false }, "s0")
  .fromTo(pcDot, { autoAlpha: 0, cy: 124, cx: 525 }, { autoAlpha: 1, duration: 0.4, immediateRender: false }, "s0+=0.2");

/* S1 POST: ROM 轻微脉冲 */
tl.addLabel("s1")
  .fromTo("#rom-zone", { scale: 1 }, { scale: 1.015, transformOrigin: "50% 50%", duration: 0.35, yoyo: true, repeat: 1, immediateRender: false }, "s1");

/* S2 读 MBR: I/O 路径点亮 → 数据包飞行 → 0x7C00 槽位填充 */
tl.addLabel("s2")
  .fromTo("#io-mbr", { opacity: 0.4 }, { opacity: 1, duration: 0.2, immediateRender: false }, "s2");
classSwap(ioEls.mbr, "io-path", "io-path active io-animating", "s2");
tl.fromTo(pktMBR, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, immediateRender: false }, "s2+=0.15")
  .to(pktMBR, {
    motionPath: { path: "#io-mbr", align: "#io-mbr", alignOrigin: [0.5, 0.5] },
    duration: 1.5, ease: "power1.inOut",
  }, "s2+=0.15")
  .fromTo(pktMBR, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.3, immediateRender: false }, "s2+=1.5")
  .fromTo(mbrSlot, { fill: "#FFFFFF", stroke: "#D6D3CD" },
    { fill: "#EFF6FF", stroke: "#2563EB", duration: 0.35, immediateRender: false }, "s2+=1.55")
  .fromTo(mbrSlot, { scale: 1.03 }, { scale: 1, transformOrigin: "50% 50%", duration: 0.4, ease: "elastic.out(1,0.5)", immediateRender: false }, "s2+=1.55")
  .fromTo(mbrText, { fill: "#A8A29E" }, { fill: "#1D4ED8", duration: 0.35, immediateRender: false }, "s2+=1.55");
textSwap(mbrText, "MBR 落位处", "MBR 已装入 ▸", "s2+=1.6");
tl.fromTo(ioEls.mbr, { opacity: 1 }, { opacity: 0.4, duration: 0.3, immediateRender: false }, "s2+=2.0");
classSwap(ioEls.mbr, "io-path active io-animating", "io-path", "s2+=2.0");

/* S3 MBR 执行: 控制流跳到 0x7C00 → 逐项扫描分区表 → 活动分区点亮 */
tl.addLabel("s3");
classSwap(execEls.toMBR, "exec-path", "exec-path active", "s3");
tl.fromTo(pcText, {}, {
  duration: 0.01, immediateRender: false,
  onStart: () => { pcText.textContent = "PC  0x7C00"; },
}, "s3+=0.1")
  .fromTo(pcDot, { cx: 525, cy: 124 }, { motionPath: { path: "#exec-toMBR" }, duration: 0.9, immediateRender: false }, "s3+=0.1");

for (let i = 0; i < 4; i++) {
  classSwap(document.getElementById(`pt-cell-${i}`), "part-cell", "part-cell hot", `s3+=${1.2 + i * 0.3}`);
  classSwap(document.getElementById(`pt-cell-${i}`), "part-cell hot", "part-cell", `s3+=${1.5 + i * 0.3}`);
}
classSwap(document.getElementById("part1"), "partition", "partition active-part", "s3+=2.5");
tl.fromTo(document.getElementById("part1"), { scale: 1.02 }, { scale: 1, transformOrigin: "50% 50%", duration: 0.4, ease: "elastic.out(1,0.5)", immediateRender: false }, "s3+=2.5")
  .fromTo(partFlag, { fill: "#A8A29E" }, { fill: "#059669", duration: 0.2, immediateRender: false }, "s3+=2.6");
classSwap(execEls.toMBR, "exec-path active", "exec-path", "s3+=2.8");

/* S4 读 DBR: 分区引导扇区 → 0x7E00 槽位 → 跳转执行 */
tl.addLabel("s4")
  .fromTo("#io-dbr", { opacity: 0.4 }, { opacity: 1, duration: 0.2, immediateRender: false }, "s4");
classSwap(ioEls.dbr, "io-path", "io-path active io-animating", "s4");
tl.fromTo(pktDBR, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, immediateRender: false }, "s4+=0.15")
  .to(pktDBR, {
    motionPath: { path: "#io-dbr", align: "#io-dbr", alignOrigin: [0.5, 0.5] },
    duration: 1.4, ease: "power1.inOut",
  }, "s4+=0.15")
  .fromTo(pktDBR, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.3, immediateRender: false }, "s4+=1.4")
  .fromTo(dbrSlot, { fill: "#FFFFFF", stroke: "#D6D3CD" },
    { fill: "#EFF6FF", stroke: "#2563EB", duration: 0.35, immediateRender: false }, "s4+=1.45")
  .fromTo(dbrSlot, { scale: 1.03 }, { scale: 1, transformOrigin: "50% 50%", duration: 0.4, ease: "elastic.out(1,0.5)", immediateRender: false }, "s4+=1.45")
  .fromTo(dbrText, { fill: "#A8A29E" }, { fill: "#1D4ED8", duration: 0.35, immediateRender: false }, "s4+=1.45");
textSwap(dbrText, "分区引导记录", "DBR 已装入 ▸", "s4+=1.5");
classSwap(execEls.toDBR, "exec-path", "exec-path active", "s4+=1.7");
tl.fromTo(pcText, {}, {
  duration: 0.01, immediateRender: false,
  onStart: () => { pcText.textContent = "PC  0x7E00"; },
}, "s4+=1.8")
  .fromTo(pcDot, { cx: 525, cy: 124 }, { motionPath: { path: "#exec-toDBR" }, duration: 0.7, immediateRender: false }, "s4+=1.8")
  .fromTo(ioEls.dbr, { opacity: 1 }, { opacity: 0.4, duration: 0.3, immediateRender: false }, "s4+=1.9");
classSwap(ioEls.dbr, "io-path active io-animating", "io-path", "s4+=1.9");
classSwap(execEls.toDBR, "exec-path active", "exec-path", "s4+=2.3");

/* S5 内核调入主存: vmlinuz → 0x100000 内核区填充 */
tl.addLabel("s5")
  .fromTo("#io-kern", { opacity: 0.4 }, { opacity: 1, duration: 0.2, immediateRender: false }, "s5");
classSwap(ioEls.kern, "io-path", "io-path active io-animating", "s5");
tl.fromTo(pktKern, { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 1, scale: 1, duration: 0.3, immediateRender: false }, "s5+=0.15")
  .to(pktKern, {
    motionPath: { path: "#io-kern", align: "#io-kern", alignOrigin: [0.5, 0.5] },
    duration: 1.8, ease: "power1.inOut",
  }, "s5+=0.15")
  .fromTo(pktKern, { autoAlpha: 1, scale: 1 }, { autoAlpha: 0, scale: 1.4, duration: 0.35, immediateRender: false }, "s5+=1.8");
classSwap(kernFile, "file-kernel", "file-kernel sent", "s5+=0.2");
classSwap(kernZone, "mem-kernel", "mem-kernel filled", "s5+=1.85");
tl.fromTo(kernZone, { scale: 1.02 }, { scale: 1, transformOrigin: "50% 50%", duration: 0.45, ease: "elastic.out(1,0.5)", immediateRender: false }, "s5+=1.85")
  .fromTo(kernText, { fill: "#A8A29E" }, { fill: "#047857", duration: 0.35, immediateRender: false }, "s5+=1.85");
textSwap(kernText, "内核加载区", "内核已驻留 ▸", "s5+=1.9");
textSwap(kernSub, "待装入…", "0x100000+ 就绪", "s5+=1.9");
tl.fromTo(ioEls.kern, { opacity: 1 }, { opacity: 0.4, duration: 0.3, immediateRender: false }, "s5+=2.2");
classSwap(ioEls.kern, "io-path active io-animating", "io-path", "s5+=2.2");

/* S6 跳转内核: 控制流进入内核区, PC 更新, 完成徽标 */
tl.addLabel("s6");
classSwap(execEls.toKern, "exec-path", "exec-path active", "s6");
tl.fromTo(pcText, {}, {
  duration: 0.01, immediateRender: false,
  onStart: () => { pcText.textContent = "PC  0x100000"; },
}, "s6+=0.1")
  .fromTo(pcDot, { cx: 525, cy: 124 }, { motionPath: { path: "#exec-toKern" }, duration: 0.8, immediateRender: false }, "s6+=0.1")
  .fromTo(kernZone, { scale: 1 }, { scale: 1.01, transformOrigin: "50% 50%", duration: 0.35, yoyo: true, repeat: 1, immediateRender: false }, "s6+=0.8")
  .fromTo(doneBadge, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: "back.out(1.6)", immediateRender: false }, "s6+=1.1");
classSwap(execEls.toKern, "exec-path active", "exec-path", "s6+=1.3");

/* ------------------------------------------------------------------ */
/* UI: 步骤讲解 / 节点列表 / 进度同步                                   */
/* ------------------------------------------------------------------ */

const stepBadge = document.getElementById("step-badge");
const stepTitle = document.getElementById("step-title");
const stepDesc = document.getElementById("step-desc");
const stepMicro = document.getElementById("step-micro");
const stepList = document.getElementById("step-list");

const labelTimes = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"].map((n) => tl.labels[n]);
const STEP_SHORT = ["加电", "POST", "读MBR", "活动分区", "读DBR", "装内核", "接管"];

STEPS.forEach((_, i) => {
  const b = document.createElement("button");
  b.className = "timeline-node future";
  b.textContent = `S${i} · ${STEP_SHORT[i]}`;
  b.onclick = () => seekToStep(i);
  stepList.appendChild(b);
});

const stepBtns = [...stepList.children];
let currentStep = -1;

function setStepUI(i) {
  if (i === currentStep) return;
  currentStep = i;
  const s = STEPS[i];
  stepBadge.textContent = `STEP ${i} / ${STEPS.length - 1}`;
  stepTitle.textContent = s.title;
  stepDesc.textContent = s.desc;
  stepMicro.textContent = s.micro;
  stepBtns.forEach((b, k) => {
    b.className = "timeline-node " + (k === i ? "current" : k < i ? "passed" : "future");
  });
}

// PC 文本寄存器与 scrub 双向同步: 依据时间点直接计算
const PC_STATES = [
  { t: 0, v: "PC  F000:FFF0" },
  { t: () => tl.labels.s3 + 0.1, v: "PC  0x7C00" },
  { t: () => tl.labels.s4 + 1.8, v: "PC  0x7E00" },
  { t: () => tl.labels.s6 + 0.1, v: "PC  0x100000" },
];

tl.eventCallback("onUpdate", () => {
  const t = tl.time();
  let idx = 0;
  for (let k = 0; k < labelTimes.length; k++) if (t >= labelTimes[k] - 0.001) idx = k;
  setStepUI(idx);
  // 双向 scrub 时保证 PC 文本正确 (onStart 只在正向触发)
  let pcv = PC_STATES[0].v;
  for (const st of PC_STATES) if (t >= (typeof st.t === "function" ? st.t() : st.t)) pcv = st.v;
  if (pcText.textContent !== pcv) pcText.textContent = pcv;
  updateScrub();
});

tl.eventCallback("onComplete", () => {
  playing = false;
  btnPlay.textContent = "↻ 重新播放";
});

/* ------------------------------------------------------------------ */
/* 控制: 播放 / 步进 / 60fps 拖拽 scrub                                */
/* ------------------------------------------------------------------ */

const btnPlay = document.getElementById("btn-play");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const btnRestart = document.getElementById("btn-restart");
const scrubber = document.getElementById("scrubber");
const scrubFill = document.getElementById("scrub-fill");
const scrubKnob = document.getElementById("scrub-knob");
const timeLabel = document.getElementById("time-label");

let playing = false;

function updateScrub() {
  const p = tl.progress() * 100;
  scrubFill.style.width = p + "%";
  scrubKnob.style.left = p + "%";
  timeLabel.textContent = tl.time().toFixed(1) + "s";
  btnPrev.disabled = currentStep <= 0;
  btnNext.disabled = currentStep >= STEPS.length - 1;
}

function play() {
  if (tl.progress() >= 1) { tl.pause(0); currentStep = -1; }
  playing = true;
  btnPlay.textContent = "⏸ 暂停";
  tl.play();
}
function pause() {
  playing = false;
  btnPlay.textContent = "▶ 播放";
  tl.pause();
}

btnPlay.onclick = () => (playing ? pause() : play());

function seekToStep(i) {
  pause();
  gsap.to(tl, { time: labelTimes[i] + 0.01, duration: 0.7, ease: "power2.out" });
}

btnNext.onclick = () => currentStep < STEPS.length - 1 && seekToStep(currentStep + 1);
btnPrev.onclick = () => currentStep > 0 && seekToStep(currentStep - 1);
btnRestart.onclick = () => { pause(); gsap.to(tl, { time: 0, duration: 0.6, ease: "power2.out" }); };

// 60fps 连续拖拽 scrub (Pointer Events)
let scrubbing = false;
function scrubTo(clientX) {
  const rect = scrubber.getBoundingClientRect();
  const p = gsap.utils.clamp(0, 1, (clientX - rect.left) / rect.width);
  tl.progress(p).pause();
}
scrubber.addEventListener("pointerdown", (e) => {
  scrubbing = true;
  scrubber.setPointerCapture(e.pointerId);
  pause();
  scrubTo(e.clientX);
});
scrubber.addEventListener("pointermove", (e) => scrubbing && scrubTo(e.clientX));
scrubber.addEventListener("pointerup", () => (scrubbing = false));
scrubber.addEventListener("pointercancel", () => (scrubbing = false));

// 键盘快捷键
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); playing ? pause() : play(); }
  if (e.key === "ArrowRight") seekToStep(Math.min(currentStep + 1, STEPS.length - 1));
  if (e.key === "ArrowLeft") seekToStep(Math.max(currentStep - 1, 0));
  if (e.key.toLowerCase() === "r") btnRestart.onclick();
});

/* 初始渲染 */
setStepUI(0);
updateScrub();
