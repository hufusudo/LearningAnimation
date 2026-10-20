(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CauchyModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PRESETS = {
    cubic: { label: '典型多项式参数曲线', gText: 'g(t)=1.6t+0.4t²', fText: 'f(t)=2.4t−0.5t³+0.2t²', min: -1.9, max: 2.6, a: -1.8, b: 2, g: t => 1.6*t+0.4*t*t, dg: t => 1.6+0.8*t, f: t => 2.4*t-0.5*t*t*t+0.2*t*t, df: t => 2.4-1.5*t*t+0.4*t },
    elliptic: { label: '椭圆与三角参数曲线', gText: 'g(t)=3.6cos(0.9t)', fText: 'f(t)=2.6sin(1.1t)', min: -2.5, max: 2.5, a: -1.8, b: -0.25, g: t => 3.6*Math.cos(.9*t), dg: t => -3.24*Math.sin(.9*t), f: t => 2.6*Math.sin(1.1*t), df: t => 2.86*Math.cos(1.1*t) },
    'multi-xi': { label: 'S 型多中值点曲线', gText: 'g(t)=2.2t', fText: 'f(t)=0.7t³−3.2t', min: -2.6, max: 2.6, a: -2.2, b: 2.2, g: t => 2.2*t, dg: () => 2.2, f: t => .7*t*t*t-3.2*t, df: t => 2.1*t*t-3.2 },
    lagrange: { label: '拉格朗日退化特例（g(t)=t）', gText: 'g(t)=t', fText: 'f(t)=0.25t³−1.6t', min: -2.8, max: 2.8, a: -2, b: 2.2, g: t => t, dg: () => 1, f: t => .25*t*t*t-1.6*t, df: t => .75*t*t-1.6 },
    rolle: { label: '罗尔定理退化特例（f(a)=f(b)）', gText: 'g(t)=1.5t', fText: 'f(t)=3−0.75t²', min: -2.6, max: 2.6, a: -2, b: 2, g: t => 1.5*t, dg: () => 1.5, f: t => 3-.75*t*t, df: t => -1.5*t }
  };

  function normalize(key, a, b) {
    const preset = PRESETS[key] || PRESETS.cubic;
    let x = Number.isFinite(+a) ? +a : preset.a;
    let y = Number.isFinite(+b) ? +b : preset.b;
    x = Math.max(preset.min, Math.min(preset.max, x));
    y = Math.max(preset.min, Math.min(preset.max, y));
    if (y - x < .15) {
      if (x + .15 <= preset.max) y = x + .15;
      else { y = preset.max; x = y - .15; }
    }
    return { key: PRESETS[key] ? key : 'cubic', preset, a: x, b: y };
  }

  function analyze(key, a, b) {
    const n = normalize(key, a, b), { preset: p } = n;
    const A = { x: p.g(n.a), y: p.f(n.a) }, B = { x: p.g(n.b), y: p.f(n.b) };
    const dx = B.x - A.x, dy = B.y - A.y;
    const auxiliary = t => (p.f(t)-p.f(n.a))*dx-(p.g(t)-p.g(n.a))*dy;
    const residual = t => p.df(t)*dx-p.dg(t)*dy;
    const zeroTol = 1e-10, roots = [], steps = 8192;
    const add = t => {
      if (t <= n.a + 1e-8 || t >= n.b - 1e-8 || Math.hypot(p.dg(t),p.df(t)) < 1e-9) return;
      if (!roots.some(r => Math.abs(r-t) < 1e-7)) roots.push(t);
    };
    let x0=n.a, y0=residual(x0);
    for (let i=1;i<=steps;i++) {
      const x1=n.a+(n.b-n.a)*i/steps, y1=residual(x1);
      if (Math.abs(y0)<zeroTol) add(x0);
      if (y0*y1<0) {
        let lo=x0, hi=x1, flo=y0;
        for(let j=0;j<70;j++){ const mid=(lo+hi)/2, fm=residual(mid); if(Math.abs(fm)<1e-14){lo=hi=mid;break;} if(flo*fm<=0)hi=mid;else{lo=mid;flo=fm;} }
        add((lo+hi)/2);
      }
      x0=x1; y0=y1;
    }
    if(Math.abs(y0)<zeroTol)add(x0);
    roots.sort((u,v)=>u-v);
    // The only zero of g′ in the permitted trigonometric domain is 0.
    // The theorem requires g′≠0 on the open interval; an endpoint zero is allowed.
    const derivativeNonzero = n.key !== 'elliptic' || !(n.a < 0 && n.b > 0);
    const ratioValid = derivativeNonzero && Math.abs(dx)>1e-10;
    const condition = ratioValid ? 'f、g 连续可导，区间内部 g′(t) ≠ 0，斜率比形式适用。' : (!derivativeNonzero ? '区间内存在 g′(t)=0，柯西中值定理的条件不满足。' : '端点横坐标相同（Δx=0），无法用斜率比表示。');
    return { ...n, A, B, dx, dy, secantSlope: Math.abs(dx)<1e-10 ? null : dy/dx, roots, ratioValid, condition, auxiliary, residual };
  }

  function snapshot(analysis, t) {
    const { preset:p, a, b, A, dx, dy } = analysis;
    const u=Math.max(a,Math.min(b,+t)), P={x:p.g(u),y:p.f(u)}, vx=p.dg(u),vy=p.df(u);
    const tangentSlope=Math.abs(vx)<1e-10?null:vy/vx;
    const speed=Math.hypot(vx,vy), chord=Math.hypot(dx,dy);
    let angle=null;
    if(speed>1e-10&&chord>1e-10) angle=Math.atan2(Math.abs(vx*dy-vy*dx),Math.abs(vx*dx+vy*dy))*180/Math.PI;
    const matched = angle !== null && angle <= .02 && speed > 1e-10;
    const isMeanPoint = matched && u > a + 1e-8 && u < b - 1e-8;
    return {t:u,P,vx,vy,tangentSlope,angle,matched,isMeanPoint};
  }
  return { PRESETS, normalize, analyze, snapshot };
});
