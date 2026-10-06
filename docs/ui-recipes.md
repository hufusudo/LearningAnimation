# 组件配方库

保留项目原有的纸质组件代码，按 [设计原则](../DESIGN_SYSTEM.md) 选择与调整。早期参考方向包括 21st.dev、Uiverse.io、Aceternity UI；以下是项目已有的本地配方，并非这些库的官方组件。无需安装它们。

HTML 示例使用项目现有 Tailwind CDN 的类名；CSS 写入目标模块的 `style.css`。本文不为每页规定布局。装饰层不拦截操作，动态效果须有减少动态效果的处理；阴影、纹理与圆角按需删减。按钮、滑块接入真实控制器后才能完成交互。

### 组件 1：浅色工程图纸微网格与环境双光晕舞台 (Blueprint Grid Stage)
> **适用场景**：演示主画布容器、算法执行区、三维模型观察区。

```html
<!-- 舞台外层容器 -->
<div class="relative w-full min-h-[320px] md:min-h-[480px] rounded-2xl border border-[#E5E4DC] bg-[#FAF9F5] overflow-hidden shadow-sm">

  <!-- 1. 顶部天青柔光晕 -->
  <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_650px_at_50%_0px,rgba(56,189,248,0.09),transparent)]"></div>

  <!-- 2. 右侧琥珀微光晕 -->
  <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_450px_at_85%_70%,rgba(245,158,11,0.06),transparent)]"></div>

  <!-- 3. 工程制图 18px 细线微网格 -->
  <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.035)_1px,transparent_1px)] bg-[size:18px_18px]"></div>

  <!-- 4. 真实交互层内容 (Canvas / SVG / DOM) -->
  <div id="interactive-viewport" class="relative z-10 w-full h-full flex items-center justify-center p-6">
    <!-- 图元与动效在此挂载 -->
  </div>
</div>
```

---

### 组件 2：浅色磨砂光束流光胶囊按钮 (Light Glassmorphic Border-Beam CTA)
> **适用场景**：核心主行动按键（如“开始演进”、“核心证明推演”、“全局执行”）。

#### HTML 结构：
```html
<button type="button" class="beam-cta group relative inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full overflow-hidden text-xs font-medium text-stone-800 bg-white/80 backdrop-blur-md shadow-[0_4px_16px_rgba(37,99,235,0.1)] hover:shadow-[0_6px_24px_rgba(37,99,235,0.18)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-300">

  <!-- 旋转光束轨道 (Conic Beam) -->
  <div class="absolute inset-[-150%] w-[400%] h-[400%] pointer-events-none [animation:beam-spin_4s_linear_infinite]">
    <div class="w-full h-full [background:conic-gradient(from_0deg,transparent_0_300deg,rgba(37,99,235,0.45)_340deg,transparent_360deg)]"></div>
  </div>

  <!-- 内衬白色背景遮罩 (形成 1px 细光边) -->
  <div class="absolute inset-[1px] rounded-full bg-white/90 backdrop-blur-sm pointer-events-none"></div>

  <!-- 按钮文字与图标内容 -->
  <span class="relative z-10 flex items-center justify-center w-5 h-5 rounded-full bg-blue-50 text-blue-600">
    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
  </span>
  <span class="relative z-10 font-sans tracking-wide">启动连续演进</span>
</button>
```

#### 必备 CSS（内嵌于模块的 `style.css`）：
```css
@keyframes beam-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

---

### 组件 3：陶瓷质感双层物理触感微按键 (Ceramic Tactile Micro-Button)
> **适用场景**：单步前进、后退、暂停、重置、视角复位等高频操作控件。

#### HTML 结构：
```html
<button type="button" class="tactile-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E4DC] bg-gradient-to-b from-white to-[#F7F6F0] text-xs font-mono font-medium text-stone-700 shadow-[0_1.5px_0_#D6D3CD] hover:bg-stone-50 hover:text-stone-900 active:shadow-none active:translate-y-[1.5px] transition-all duration-100 select-none">
  <span class="text-stone-400" aria-hidden="true">⏭</span>
  <span>单步节拍</span>
</button>
```

---

### 组件 4：非对称圆角与点阵微光卡片 (Asymmetric Dot-Glow Card)
> **适用场景**：状态监测看板、寄存器监视窗、协议报文解析框、定理几何直觉提炼卡。

#### HTML 结构：
```html
<div class="relative flex flex-col justify-between overflow-hidden rounded-2xl rounded-tl-3xl rounded-br-3xl border border-[#E5E4DC] bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.03]">

  <!-- 浅色工程点阵 + 中心径向渐淡蒙版 -->
  <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(#CBD5E1_1.2px,transparent_1.2px)] bg-[size:14px_14px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_50%,#000_60%,transparent_100%)]"></div>

  <!-- 卡片头部标题区 -->
  <div class="relative z-10 flex items-center justify-between pb-3 border-b border-stone-100">
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
      <h3 class="text-xs font-semibold uppercase tracking-wider text-stone-700">状态监测看板</h3>
    </div>
    <span class="text-[11px] font-mono text-stone-400">STEP #04</span>
  </div>

  <!-- 卡片主要数据或说明区 -->
  <div class="relative z-10 py-4 font-sans text-xs leading-relaxed text-stone-600">
    当前滑动窗口已满，发送端处于等待确认节拍，定时器持续监听 ACK 应答。
  </div>

  <!-- 底部磨砂玻璃浮层条 -->
  <div class="relative z-10 -mx-5 -mb-5 px-5 py-2.5 bg-white/70 backdrop-blur-md border-t border-stone-100 flex items-center justify-between text-[11px] font-mono text-stone-500">
    <span>RTT: 24ms</span>
    <span class="text-blue-600 font-medium">窗口饱和度 100%</span>
  </div>
</div>
```

---

### 组件 5：笔记式引用框 (Obsidian Callouts) 与呼吸脉冲指示灯 (Pulse LEDs)

```html
<!-- 核心考点提示 (Tip: 翡翠绿) -->
<div class="border border-emerald-200 bg-emerald-50/60 rounded-xl p-3.5 text-xs text-emerald-900 leading-relaxed flex items-start gap-2.5">
  <span class="text-emerald-600 font-bold shrink-0">💡 [!TIP]</span>
  <div><strong>本质理解：</strong>利用切片法求二重积分时，积分顺序直接决定了截面方程的代数复杂度。</div>
</div>

<!-- 硬件/协议状态指示灯 (纯 CSS 细微呼吸，仅用于真实活跃状态) -->
<div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-[11px] font-mono text-emerald-800">
  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
  <span>BUS_IDLE</span>
</div>
```

---

### 组件 6：纸质滑块 (Paper Slider)

旧规范提到了 `.taste-slider`，但没有给出代码。以下补齐细线轨道与白底黑边手柄，使用原生 range 保留键盘操作。接入时更新旁边的数值显示。

```html
<label for="speed">速度</label>
<input id="speed" class="taste-slider" type="range" min="0.5" max="2" step="0.1" value="1">
<output for="speed" id="speed-value">1.0×</output>
```

```css
.taste-slider {
  appearance: none;
  width: 100%;
  min-height: 32px;
  margin: 0;
  background: transparent;
  accent-color: var(--accent-blue, #2563EB);
  cursor: pointer;
}
.taste-slider::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 999px;
  background: var(--border-strong, #D6D3CD);
}
.taste-slider::-moz-range-track {
  height: 3px;
  border-radius: 999px;
  background: var(--border-strong, #D6D3CD);
}
.taste-slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6.5px;
  border: 1px solid var(--text-primary, #292524);
  border-radius: 50%;
  background: #FFFFFF;
}
.taste-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 1px solid var(--text-primary, #292524);
  border-radius: 50%;
  background: #FFFFFF;
}
.beam-cta:focus-visible, .tactile-btn:focus-visible, .taste-slider:focus-visible {
  outline: 2px solid var(--accent-blue, #2563EB);
  outline-offset: 3px;
}
.beam-cta:disabled, .tactile-btn:disabled, .taste-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.beam-cta:disabled, .tactile-btn:disabled {
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .beam-cta *, .animate-pulse { animation: none !important; }
  .beam-cta, .tactile-btn { transition: none !important; }
}
```

若只使用按钮或指示灯，也要复制上面的对应焦点、禁用与减少动态效果样式。

### 可选配方：整块视图的三阶段转场

适合旧视图退出、新视图进入且有明确中枢转换的场景，不用于每次数据更新。控制器传入自身的上一条时间线；取消后应根据数据状态重绘。`onPivotMidpoint` 负责更新视图内容，不依赖动画回调计算算法结果。回调不要替换此函数正在操作的容器节点。

```javascript
function runThreeStageTransition({
  oldContainer, newContainer, pivotElement, onPivotMidpoint,
  previousTimeline = null, speed = 1
}) {
  previousTimeline?.kill();
  const gsap = window.gsap;
  const update = () => onPivotMidpoint?.();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!gsap || reduced) {
    update();
    if (gsap) {
      if (oldContainer && oldContainer !== newContainer) gsap.set(oldContainer, { autoAlpha: 0 });
      if (newContainer) gsap.set(newContainer, { autoAlpha: 1, x: 0, y: 0, scale: 1 });
      if (pivotElement) gsap.set(pivotElement, { rotationY: 0 });
    } else {
      if (oldContainer && oldContainer !== newContainer) {
        Object.assign(oldContainer.style, { opacity: '0', visibility: 'hidden' });
      }
      if (newContainer) {
        Object.assign(newContainer.style, { opacity: '1', visibility: 'visible', transform: 'none' });
      }
      if (pivotElement) pivotElement.style.transform = 'none';
    }
    return null;
  }

  const tl = gsap.timeline({ paused: true });
  if (oldContainer) {
    tl.to(oldContainer, { autoAlpha: 0, y: -8, scale: 0.98, duration: 0.15, ease: 'power2.in' });
  }
  if (pivotElement) {
    tl.to(pivotElement, { rotationY: 90, duration: 0.15, ease: 'power2.in' });
  }
  // 不论是否有中枢元素，更新都安排在时间线内，避免提前执行。
  tl.call(update);
  if (pivotElement) {
    tl.to(pivotElement, { rotationY: 0, duration: 0.15, ease: 'expo.out' });
  }
  if (newContainer) {
    tl.fromTo(newContainer,
      { autoAlpha: 0, y: 12, scale: 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.35, ease: 'power4.out', immediateRender: false });
  }
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return tl.timeScale(rate).play();
}
```

控制器保存返回值，用 `.pause()` / `.play()` 暂停与恢复，用 `.timeScale()` 调速；切换与复位时 `.kill()` 并重绘。此示例只管理传入的视图转场，模块自己的 RAF、计时器、其他补间仍需控制器分别管理。
