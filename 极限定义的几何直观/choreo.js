// 动效选用：A1、B4、C3、D1、E1、G1
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./model.js') : root.LimitModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LimitChoreo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const boundaries = [0, 2, 4, 6, 9, 11, 13, 16, 18];
  const labels = ['给定精度', '误差上界', '找到门槛', '检查尾部', '收紧精度', '移动门槛', '再次检验', '量词顺序'];
  const captions = ['先给定正误差 ε，画出 a 两侧的开邻域。', '用递减包络控制误差，不靠有限采样猜测尾部。', '给出充分门槛；它不必是最小门槛。', '探针越过门槛；尾部保证来自上界。', '将 ε 减半，原有保证需要重新检查。', '把门槛移远，让新的尾部满足更小误差。', '新门槛之后，所有后续值都严格落在带内。', '任给正误差，都能找到一个充分门槛。'];
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = p => p * p * (3 - 2 * p);
  const win = (p, a, b) => ease(clamp((p - a) / (b - a)));
  const lerp = (a, b, p) => a + (b - a) * p;
  function frames(params) {
    const e = params.epsilon, key = params.key, T = M.threshold(key, e), U = M.threshold(key, e / 2);
    const early = M.getModel(key).mode === 'discrete' ? 1 : .5;
    const base = {epsilon:e, band:0, envelope:0, thresholdAlpha:0, threshold:T, safe:0, probe:early, probeAlpha:0, focus:0, conclusion:0};
    const patches = [{band:1}, {envelope:1}, {thresholdAlpha:1,safe:1}, {probe:T*1.3+1,probeAlpha:1}, {epsilon:e/2,safe:0}, {threshold:U,safe:1}, {probe:U*1.3+1}, {conclusion:1}];
    const out=[base];
    patches.forEach(patch => out.push({...out[out.length-1],...patch}));
    return out;
  }
  function stepView(params, index, progress) {
    const list=frames(params), i=clamp(index,0,7), p=clamp(progress), before=list[i], after=list[i+1];
    const q=clamp((p-.16)/.52), view={};
    for (const k of Object.keys(before)) view[k]=lerp(before[k],after[k],q);
    // 先撤去旧保证，再收紧精度；新保证等新门槛到位后才出现。
    if(i===4) {view.safe=1-win(p,0,.15);view.epsilon=lerp(before.epsilon,after.epsilon,q);}
    if(i===5) view.safe=win(p,.72,.93);
    view.focus=Math.sin(Math.PI*p)*.8;
    view.step=i; view.progress=p;
    return view;
  }
  function sample(params,time) {
    const t=clamp(time,0,18);
    let i=boundaries.findIndex((b,j)=>j<8 && t<boundaries[j+1]);
    if(i<0)i=7;
    const p=(t-boundaries[i])/(boundaries[i+1]-boundaries[i]);
    return {...stepView(params,i,p),time:t};
  }
  return {boundaries,labels,captions,frames,stepView,sample};
});
