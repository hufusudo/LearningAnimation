(function(root) {
  const phi=x=>Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);   function cdf(x) {
    const z=Math.abs(x),t=1/(1+.2316419*z);const p=1-phi(z)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x<0?1-p:p;
  }
  function joint(id,x,y,r=.5) {
    if(id==='normal')return Math.exp(-(x*x-2*r*x*y+y*y)/(2*(1-r*r)))/(2*Math.PI*Math.sqrt(1-r*r));if(x<0||x>2||y<0||y>2)return 0;return id==='triangle'?(y<=x?.5:0):(x+y)/8;
  }
  function slice(id,c,dir='y',r=.5) {
    let lo=0,hi=2,area=0,mean=0;     if(id==='normal') {
      lo=-4;hi=4;area=phi(c);mean=r*c;
    }
    else if(id==='triangle') {
      lo=dir==='y'?c:0;hi=dir==='y'?2:c;area=c>=0&&c<=2?(hi-lo)/2:0;mean=(lo+hi)/2;
    }
    else  {
      area=c>=0&&c<=2?(1+c)/4:0;mean=(4/3+c)/(1+c);
    }
    const valid=area>0;     const raw=u=>dir==='y'?joint(id,u,c,r):joint(id,c,u,r);     const pdf=u=>valid?raw(u)/area:0;     function probability(a,b) {
      if(!valid)return null;if(id!=='normal') {
        a=Math.max(a,lo);b=Math.min(b,hi);
      }
      if(b<=a)return 0;if(id==='normal') {
        const sd=Math.sqrt(1-r*r);return cdf((b-mean)/sd)-cdf((a-mean)/sd);
      }
      if(id==='triangle')return (b-a)/(hi-lo);return ((b*b-a*a)/2+c*(b-a))/(2*(1+c));
    }
    return  {
      lo,hi,area,mean,valid,raw,pdf,probability
    }
    ;
  }
  function slab(id,c,dir,r,a,b,delta) {
    if(delta<=0)return null;let denominator=0,numerator=0;const n=120,h=delta/n;for(let i=0;i<n;i++) {
      const s=slice(id,c-delta/2+(i+.5)*h,dir,r);denominator+=s.area*h;numerator+=(s.probability(a,b)||0)*s.area*h;
    }
    return denominator>0? {
      mass:denominator,probability:numerator/denominator
    }
    :null;
  }
  const api= {
    joint,slice,slab,cdf
  }
  ;if(typeof module!=='undefined')module.exports=api;else root.ConditionalModel=api;
}
)(typeof window==='undefined'?globalThis:window);
