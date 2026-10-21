// 动效选用：A3、E1、C2、D1。引导 → 主动作 → 回执，所有状态由 t 确定。
(function(root) {
  const win=(t,a,b)=>Math.min(1,Math.max(0,(t-a)/(b-a)));  function sample(t) {
    t=Math.min(4,Math.max(0,t));const phase=Math.min(3,Math.floor(t)),local=t-phase;const textPhase=phase>0&&local<.08?phase-1:phase;const textAlpha=phase===0||local>=.16?1:local<.08?1-local/.08:(local-.08)/.08;return  {
      t,phase,textPhase,textAlpha,focus:win(t,0,.25),cut:win(t,.25,.75),extract:win(t,1.2,1.7),normalize:win(t,2.2,2.7),interval:win(t,3.2,3.7),receipt:[win(t,.75,1),win(t,1.7,2),win(t,2.7,3),win(t,3.7,4)]
    }
    ;
  }
  const api= {
    sample
  }
  ;if(typeof module!=='undefined')module.exports=api;else root.ConditionalChoreo=api;
}
)(typeof window==='undefined'?globalThis:window);
