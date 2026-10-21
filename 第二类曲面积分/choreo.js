// 动效选用：A1、C1、C2、C3、D1、E1、G1
// side 在线性过渡中从 1 到 -1；渲染器按 sign(side) 定箭头方向，并按 abs(side) 淡出旧方向。
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SurfaceFluxChoreo = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const CHAPTERS = Object.freeze(['水怎样穿过', '放大一小块', '为什么看影子', '把小块加起来']);
  const STARTS = Object.freeze([0, 5, 7, 12]);
  const LESSON = Object.freeze([
    { chapter:0,title:'通量，到底在数什么？',description:'想象一张薄网。我们只数单位时间内穿过它的水。',cue:'穿过去的才算。这里的“通量”是每单位时间穿过的水量。',theta:0,normal:0 },
    { chapter:0,title:'网变斜了，穿过的水会怎样？',description:'水流方向不变，慢慢把这张网倾斜。',cue:'网没有变小，但正对水流的有效截面变小了。',theta:55,xy:0.5 },
    { chapter:0,title:'如果水只是擦着网流过呢？',description:'继续转到 90°：水流现在平行于网。',cue:'擦边流过不算穿过。这时通量是 0。',theta:90,xy:0.5 },
    { chapter:0,title:'穿过还要分“正”和“负”？',description:'金箭头只做一件事：规定哪个穿过方向算正。',cue:'沿金箭头穿过记正；朝相反方向穿过记负。',theta:55,normal:1 },
    { chapter:0,title:'只翻转金箭头，水倒流了吗？',description:'盯住蓝色水流：它继续从下往上流。',cue:'水没有倒流。只是正方向翻转，同一份通量变成负数。',theta:55,side:-1,normal:1 },
    { chapter:1,title:'弯曲的网，每处倾斜都一样吗？',description:'不同位置朝向不同，不能用一个夹角描述整张网。',cue:'先选一小块，算它穿过的水；其余小块稍后用同样的方法算。',macro:0.42,micro:1,normal:0,cam:'macro',channel:'all' },
    { chapter:1,title:'把这一小块放大看',description:'小块取得足够小，就能近似看成一张平直的斜网。',cue:'下面只研究这一小块。有限小片用切平面近似，趋于微元时面积写 dS。',micro:1,normal:1,cam:'close',channel:'r' },
    { chapter:2,title:'先只看竖直方向的水',description:'暂时放下其他方向，盯住这一组蓝色水柱。',cue:'这组水沿 z 方向流，流速分量记作 R。',micro:1,cam:'projection',channel:'r' },
    { chapter:2,title:'为什么可以改看地上的影子？',description:'沿着水柱向底面投影，让影子对应这张小斜网。',cue:'穿过小片和底面影子的是同一组水柱，水量相同。',micro:1,xy:0.6,rays:1,cam:'projection',channel:'r' },
    { chapter:2,title:'横向来的水，要看哪一面影子？',description:'现在只看沿 x 方向流动的红色分量 P。',cue:'正对红色水流的是侧面影子 dy dz，而不是底面。',micro:1,yz:0.6,rays:1,cam:'red',channel:'p' },
    { chapter:2,title:'另一个横向方向，也用同样的方法',description:'换成沿 y 方向流动的绿色分量 Q。',cue:'正对绿色水流的影子是 dz dx。每个方向各看自己的影子。',micro:1,zx:0.6,rays:1,cam:'green',channel:'q' },
    { chapter:2,title:'把三个方向的贡献加在一起',description:'这是同一股水流的三个分量，分开看后再合并。',cue:'红色一份 + 绿色一份 + 蓝色一份 = 这一小块的净通量。',micro:1,xy:0.4,yz:0.4,zx:0.4,rays:0.4,cam:'projection',channel:'all' },
    { chapter:3,title:'回到整张网：每一块都这样算',description:'现在把整张网划成 64 个小块。',cue:'小块的朝向不同，各自计算穿过的水量。',macro:0.52,cam:'macro',channel:'all' },
    { chapter:3,title:'一份一份，把小块的通量加起来',description:'高亮走到哪一块，就把那一块的有符号通量加入总和。',cue:'沿正方向穿过的加上，反向穿过的减去。',macro:0.52,sum:1,cam:'macro',channel:'all',hold:10 },
    { chapter:3,title:'这就是第二类曲面积分',description:'让小块越来越细，近似和的极限，就是整张曲面的净通量。',cue:'先分小块，算每块穿过多少，再全部相加。公式就是这个过程的简写。',macro:0.52,sum:1,cam:'macro',channel:'all',hold:8 }
  ].map(lesson => Object.freeze({ ...lesson })));

  const V_KEYS = Object.freeze(['flat','macro','micro','theta','side','normal','xy','yz','zx','rays','sum','particles','pw','qw','rw']);
  const STEP_SECONDS = Object.freeze(LESSON.map((_, i) => i === 13 ? 8 : 4.5));
  const ENDS = Object.freeze(STEP_SECONDS.reduce((out, seconds) => {
    out.push((out.length ? out[out.length - 1] : 0) + seconds);
    return out;
  }, []));
  const DURATION = ENDS[ENDS.length - 1];
  const clamp01 = value => Math.max(0, Math.min(1, value));
  const lerp = (a, b, p) => a + (b - a) * p;
  const win = (p, a, b) => clamp01((p - a) / (b - a));
  const ease = p => p * p * (3 - 2 * p);

  function target(index) {
    const i = Math.max(0, Math.min(LESSON.length - 1, Math.trunc(Number(index) || 0)));
    const lesson = LESSON[i];
    const channel = lesson.channel || 'r';
    const weights = i < 5 ? { pw:0,qw:0,rw:1 } : {
      pw:channel === 'all' || channel === 'p' ? 1 : 0,
      qw:channel === 'all' || channel === 'q' ? 1 : 0,
      rw:channel === 'all' || channel === 'r' ? 1 : 0
    };
    const V = {
      flat:i < 5 ? 1 : 0, macro:lesson.macro || 0, micro:lesson.micro || 0,
      theta:(lesson.theta || 0) * Math.PI / 180, side:lesson.side || 1,
      normal:lesson.normal || 0, xy:lesson.xy || 0, yz:lesson.yz || 0,
      zx:lesson.zx || 0, rays:lesson.rays || 0,
      // index 13 is the beginning of the eight-second accumulation window.
      sum:i === 13 ? 0 : (i >= 14 ? 1 : 0), particles:1, ...weights
    };
    return Object.freeze({ ...V, cam:lesson.cam || 'default' });
  }

  function contentAlpha(p, outA, outB, inA, inB) {
    if (p < outA) return { old:true, alpha:1 };
    if (p < outB) return { old:true, alpha:1 - ease(win(p, outA, outB)) };
    if (p < inA) return { old:false, alpha:0 };
    return { old:false, alpha:ease(win(p, inA, inB)) };
  }

  function frame(index, progress) {
    const i = Math.max(0, Math.min(LESSON.length - 1, Math.trunc(Number(index) || 0)));
    const local = clamp01(Number(progress) || 0);
    // Motion occupies the first part of each step; the settled result stays readable.
    const p = i === 13 ? local : clamp01(local / 0.55);
    const from = target(i);
    if (i === LESSON.length - 1) {
      return {
        index:i, local, V:Object.fromEntries(V_KEYS.map(key => [key, from[key]])),
        camera:{ from:from.cam, to:from.cam, k:1 },
        caption:{ index:i, alpha:1 }, cue:{ index:i, alpha:1 }, labels:{ index:i, alpha:1 }, focus:0
      };
    }
    const to = target(i + 1);
    const changesCamera = from.cam !== to.cam;
    const cameraProgress = changesCamera ? win(p, 0.1, 0.3) : 1;
    const action = win(p, changesCamera ? 0.35 : 0.2, 0.65);
    const V = {};
    V_KEYS.forEach(key => { V[key] = lerp(from[key], to[key], action); });
    if (i === 13) V.sum = lerp(from.sum, to.sum, p);

    const caption = contentAlpha(p, 0.62, 0.72, 0.72, 0.86);
    const cue = contentAlpha(p, 0.76, 0.83, 0.83, 0.96);
    const labels = contentAlpha(p, 0, 0.1, 0.75, 0.9);
    const focus = p < 0.18 ? ease(win(p, 0, 0.18)) : p < 0.55 ? 1 : p < 0.8 ? 1 - ease(win(p, 0.55, 0.8)) : 0;
    return {
      index:i, local, V,
      camera:{ from:from.cam, to:to.cam, k:cameraProgress },
      caption:{ index:caption.old ? i : i + 1, alpha:caption.alpha },
      cue:{ index:cue.old ? i : i + 1, alpha:cue.alpha },
      labels:{ index:labels.old ? i : i + 1, alpha:labels.alpha },
      focus
    };
  }

  function sample(time) {
    const t = Math.max(0, Math.min(DURATION, Number.isFinite(Number(time)) ? Number(time) : 0));
    if (t >= DURATION) return frame(LESSON.length - 1, 1);
    const step = ENDS.findIndex(end => t < end);
    const start = step === 0 ? 0 : ENDS[step - 1];
    return frame(step, (t - start) / (ENDS[step] - start));
  }

  return Object.freeze({ LESSON, CHAPTERS, STARTS, ENDS, DURATION, target, sample, frame });
});
