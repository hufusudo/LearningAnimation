// 动效选用：A2、C2、C3、D1、E3、G1
// 扫描参数是右尾概率；边界位置由 ISF 求得，画面不依赖历史回调。
(function(root){
  'use strict';
  const boundaries=[0,2,4.5,7,10,12.5,15];
  const stops=[1.8,4.3,6.8,9.8,12.3,15];
  const names=['定位上点','右尾定义','同点互补','移向下点','转看补集','补回所求'];
  const captions=[
    '上分位点的下标，记的是它右侧留下的面积。',
    '固定这条竖线，右侧整条尾部的面积等于 α。',
    '竖线没有移动；同一点左侧的面积就是 1−α。',
    '换到另一个分位点，才能让左尾面积变成 α。',
    '新点右侧占 1−α，这一大块是所求左尾的补集。',
    '从总概率 1 减去右侧补集，剩下的左尾为 α。'
  ];
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const win=(t,a,b)=>clamp((t-a)/(b-a));
  const ease=p=>p*p*(3-2*p);
  function sample(t,alpha=.05){
    t=clamp(t,0,15);
    let phase=boundaries.findIndex((b,i)=>i>0&&t<b)-1;
    if(phase<0)phase=5;
    const toLeft=ease(win(t,4.7,6.3)),toRight=ease(win(t,10.25,11.95)),backLeft=ease(win(t,12.75,14.45));
    const move=win(t,7.35,9.6);
    const local=t-boundaries[phase];
    return {
      t,phase,name:names[phase],tailLevel:alpha+(1-2*alpha)*move,move,
      focus:win(t,0,1.25),rightReveal:win(t,2.25,3.8),leftReveal:win(t,4.7,6.3),
      leftWeight:toLeft-toRight+backLeft,
      rightWeight:(1-toLeft)*win(t,2.25,3.8)+toRight-backLeft,
      receipt:win(t,boundaries[phase]+.3,boundaries[phase]+.8),
      captionIndex:phase>0&&local<.15?phase-1:phase,
      captionAlpha:phase===0?1:clamp(Math.abs(local/.15-1))
    };
  }
  const api={boundaries,stops,names,captions,duration:15,sample,clamp,win};
  root.SamplingChoreo=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
