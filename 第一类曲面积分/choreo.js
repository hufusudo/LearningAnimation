// 动效选用：A3、B1、C3、D1、G1。
// 所有对象的位置、近似与投影只由（步，进度）决定；GSAP 仅推进 time。
(function (root) {
  'use strict';
  const clamp = v => Math.max(0, Math.min(1, v));
  const win = (p, a, b) => clamp((p - a) / (b - a));
  const ease = p => p * p * (3 - 2 * p);
  const base = { colorMix: 0, separate: 0, pickLift: 0, transfer: 0, tangent: 0, rays: 0, normals: 0, section: 0, factor: 0, weight: 0, fall: 0, limit: 0, board: 0.25 };
  const snapshots = [
    {}, { colorMix: 1 }, { separate: 1 }, { pickLift: 1 },
    { transfer: 1 }, { tangent: 1 }, { rays: 1 }, { section: 1 },
    { normals: 1, factor: 1 }, { weight: 1, normals: 0 },
    { fall: 1, board: 1 }, { limit: 1 }
  ];
  let cur = { ...base };
  const frames = snapshots.map(s => Object.freeze(cur = { ...cur, ...s }));
  const steps = [
    ['看整张曲面', '面密度乘面积，才能得到这张薄片的质量。', 1],
    ['先看面密度', '颜色越深，每单位面积的质量越大。', 1],
    ['沿网格切成小块', '每块分别算质量，再把所有小块相加。', 1],
    ['取出这一块', '沿着高亮边框，跟住这块有限曲面片 ΔSᵢ。', 2],
    ['移到旁边，放大看', '同一块移到右侧；放大显示不会改变真实面积。', 2],
    ['先用平面近似它', '小块足够小时，可用中心点的切平面近似。', 2],
    ['向下作竖直投影', '斜片和底面矩形，对应同一片 xy 区域。', 2],
    ['从侧面看，为什么要除余弦', '沿最陡方向看截面：影子短了 cos γ 倍。', 2],
    ['把倾斜程度写成面积因子', '两个偏导数确定法向量，也就确定了 cos γ。', 2],
    ['回到这一块的质量', '密度乘曲面面积；底面面积需先乘面积因子。', 3],
    ['把所有小块的贡献相加', '落到底面的是质量贡献，面积缩小不丢质量。', 3],
    ['分割趋细，得到面积微元', '有限小块取极限，得到 dS 和曲面积分。', 3]
  ].map(([title, note, capsule]) => Object.freeze({ title, note, capsule }));
  function sampleStep(step, progress) {
    const i = Math.max(0, Math.min(frames.length - 1, step));
    const before = frames[Math.max(0, i - 1)], after = frames[i];
    const p = clamp(progress);
    const q = ease(win(p, 0.15, 0.72));
    const move = win(p, 0.15, 0.72); // 数据位移线性，避免误导速度与面积变化。
    return Object.fromEntries(Object.keys(base).map(k => [k,
      before[k] + (after[k] - before[k]) * (k === 'transfer' || k === 'fall' ? move : q)
    ]));
  }
  function sample(time) {
    const t = Math.max(0, Math.min(frames.length - 1, Number(time) || 0));
    const step = Math.ceil(t), p = step === 0 ? 1 : t - step + 1;
    const textStep = p < 0.79 ? Math.max(0, step - 1) : step;
    const textAlpha = p < 0.72 ? 1 : p < 0.79 ? 1 - win(p, 0.72, 0.79) : ease(win(p, 0.79, 0.94));
    return { step, progress: p, textStep, textAlpha, values: sampleStep(step, p) };
  }
  root.SurfaceChoreo = Object.freeze({ frames, steps, sampleStep, sample, duration: frames.length - 1 });
})(typeof globalThis !== 'undefined' ? globalThis : window);
