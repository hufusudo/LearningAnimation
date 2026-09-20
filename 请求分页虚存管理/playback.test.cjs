const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function load() {
  const elements = new Map();
  function element(id='') {
    return {id, style:{setProperty(){}}, dataset:{}, children:[], classList:{add(){},remove(){},toggle(){}},
      setAttribute(){}, appendChild(x){this.children.push(x);}, remove(){},
      getBoundingClientRect(){return {left:0,top:0,width:200,height:100};},
      getTotalLength(){return 100;}, getPointAtLength(x){return {x,y:0};},
      querySelectorAll(){return [];}, textContent:'', innerText:'', innerHTML:''};
  }
  const context = vm.createContext({console, Math, performance:{now:()=>0}, requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    window:{addEventListener(){},matchMedia:()=>({matches:false})},
    document:{addEventListener(){},body:element(),hidden:false,querySelectorAll:()=>[],querySelector:()=>null,
      createElement:()=>element(), createElementNS:()=>element(), getElementById(id){if(!elements.has(id))elements.set(id,element(id));return elements.get(id);}}});
  vm.runInContext(fs.readFileSync(__dirname+'/app.js','utf8'),context);
  assert.equal(vm.runInContext('typeof advancePlayback',context),'function','需要可暂停、统一倍速的播放时钟');
  vm.runInContext(`function completeOneStep() { playNextStep(); for(let i=0; i<100 && singleStepping; i++) advancePlayback(80); }`,context);
  return code=>vm.runInContext(code,context,{timeout:2000});
}
test('暂停冻结步骤和数据包进度，倍速只作用一次',()=>{
  const run=load();
  run("runScenario('C'); advancePlayback(200)");
  const before=run('stepElapsed');
  run('toggleAutoLoop(); advancePlayback(500)');
  assert.equal(run('stepElapsed'),before);
  run('setSpeed(2); toggleAutoLoop(); advancePlayback(100)');
  assert.equal(run('stepElapsed'),before+200);
});
test('三条路径都完成正确读取，主存读取次数区分 TLB',()=>{
  for(const [key,value,reads] of [['A','0xCAFE',1],['B','0x5A5A',2],['C','0xBEEF',2]]) {
    const run=load(); run(`runScenario('${key}'); isAutoLooping=false`);
    run('while (!scenarioComplete) completeOneStep()');
    assert.match(run("document.getElementById('cpu-data-val').innerText"),new RegExp(value));
    assert.equal(run('memoryReads'),reads);
  }
});
test('缺页先调入页面再更新有效位，最后重执',()=>{
  const run=load(); run("runScenario('C'); isAutoLooping=false");
  run("while (!ramFrames[6].occupied) completeOneStep()");
  assert.equal(run('ptData[3].v'),0);
  run('completeOneStep()');
  assert.equal(run('ptData[3].v'),1);
  assert.equal(run('ptData[3].f'),6);
  run('while (!scenarioComplete) completeOneStep()');
  assert.equal(run('tlbData[3].f'),6);
});
test('中途切换场景清除旧步骤及缺页状态',()=>{
  const run=load(); run("runScenario('C'); completeOneStep(); completeOneStep(); completeOneStep(); completeOneStep(); runScenario('A')");
  assert.equal(run('stepElapsed'),0);
  assert.equal(run('stepIndex'),0);
  assert.equal(run('currentScenario'),'A');
  assert.equal(run("document.getElementById('cpu-mode-badge').innerText"),'用户态执行');
  assert.equal(run('ptData[3].v'),1);
});
test('所有倍速下自动播放均先完成当前场景，再进入下一个',()=>{
  for(const speed of [0.5,1,1.5,2]) {
    const run=load(); run(`runScenario('C'); setSpeed(${speed})`);
    run('for(let i=0;i<2000 && !scenarioComplete;i++) advancePlayback(80)');
    assert.equal(run('scenarioComplete'),true);
    assert.match(run("document.getElementById('cpu-data-val').innerText"),/0xBEEF/);
    assert.equal(run('memoryReads'),2);
    run('toggleAutoLoop(); for(let i=0;i<100;i++) advancePlayback(80)');
    assert.equal(run('currentScenario'),'C');
    run('toggleAutoLoop(); for(let i=0;i<100 && currentScenario === "C";i++) advancePlayback(80)');
    assert.equal(run('currentScenario'),'A');
  }
});
test('单步保留到达结果，暂停期间不提前读取或重复记账',()=>{
  const run=load(); run("runScenario('A'); completeOneStep(); completeOneStep()");
  assert.equal(run('stepIndex'),1);
  assert.equal(run('currentAccessCount'),1);
  run('for(let i=0;i<50;i++) advancePlayback(80)');
  assert.equal(run('stepIndex'),1);
  assert.equal(run('currentAccessCount'),1);
  assert.equal(run('memoryReads'),0);
  run('completeOneStep(); playNextStep(); advancePlayback(100)');
  assert.equal(run('memoryReads'),0);
  run('for(let i=0;i<40;i++) advancePlayback(80)');
  assert.equal(run('memoryReads'),1);
  assert.equal(run("document.getElementById('cpu-data-val').innerText"),'—');
});
