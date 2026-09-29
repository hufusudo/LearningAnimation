# LearningAnimation 界面美学设计系统 (DESIGN_SYSTEM.md)

> 本文档基于 21st.dev、Uiverse.io、Aceternity UI 以及专业动效规格（refs），经**全面浅色化洗炼与工程级重构**沉淀而成。  
> 旨在为 AI 代理（Agent）与人类开发者提供一套**极易读取、即插即用、开箱零编译依赖**的浅色纸质美学设计规范与代码模板库。

---

## §1 核心美学哲学与浅色改造原则

原始参考中大量采用了 Dark Mode（暗黑流光、纯黑底色、高饱和霓虹），直接套用会造成视觉脏污并破坏纸质优雅感。为此，我们确立了**“现代学术纸质与工程极简赛博”（Modern Editorial Paper & Subtle Cybernetics）**改造原则：

| 维度 | 原始参考 (Dark/Neon) | 浅色化重构 (Light Editorial Cyber-Paper) | 设计意图 |
| :--- | :--- | :--- | :--- |
| **画布背景** | 纯黑 `#0a0b14` + 高亮蓝粉斑块 | 暖白纸质 `#FAF9F5` + 极微双色柔光晕 + 精细工程制图微网格 (18px) | 打造类似建筑制图与精密实验室的手稿质感，消除大白底的苍白与暗色底的压抑 |
| **主行动按键** | 黑色玻璃 + 荧光粉蓝旋转光束 | 温润牛奶玻璃 (`bg-white/85 backdrop-blur`) + 钴蓝/琥珀流光光束 (`border-beam`) | 保留旋转光束的科技律动感，底色转为通透的陶瓷白，文字保持高对比度深石墨色 |
| **微交互按键** | 黑灰双层径向凹陷 + 荧光光斑 | 浅象牙白微光径向渐变 + 物理机械键程下凹 (`tactile`) | 模拟真实微动开关与机械键盘的下沉触感，反馈干脆 |
| **展示卡片** | 对称暗黑卡片 + 纯黑点阵 | **非对称现代几何圆角** + 纯 CSS 灰阶点阵 + 中心径向淡出遮罩 | 破除千篇一律的圆角矩形，赋予学科卡片类似高端工业设计的雕塑感 |
| **动效编排** | 随意弹跳或瞬时刷新 | **严格 3 阶段时间线 (Outro → Pivot → Intro)**，`expo.out` + `power4.out`，**零回弹** | 追求高工业精密度的利落捕捉，消除轻浮晃动 |

---

## §2 全局设计令牌 (Design Tokens)

所有颜色与尺寸均为标准化纯 CSS / Tailwind 映射，AI 可直接选用：

### 2.1 色彩系统
```css
:root {
  /* 基底纸质色 */
  --bg-page: #FAF9F5;              /* 页面基底：温暖象牙白 */
  --bg-card: #FFFFFF;              /* 容器卡片：纯白透亮 */
  --bg-glass: rgba(255, 255, 255, 0.85); /* 磨砂玻璃底 */
  
  /* 轮廓与细线 */
  --border-subtle: #E5E4DC;        /* 1px 细线边框（石笔灰） */
  --border-strong: #D6D3CD;        /* 强调线条/按下阴影 */
  --grid-line: rgba(0, 0, 0, 0.035);/* 工程微网格辅助线 */
  
  /* 极低饱和环境柔光 (Ambient Tint) */
  --glow-sky: rgba(56, 189, 248, 0.08);   /* 顶部漫射天青蓝 */
  --glow-amber: rgba(245, 158, 11, 0.06); /* 右下漫射琥珀金 */
  --glow-rose: rgba(244, 114, 182, 0.05); /* 可选：晚霞微红 */

  /* 学科高亮色 (功能语义) */
  --accent-blue: #2563EB;          /* 钴蓝：主导状态、时钟脉冲、网络报文 */
  --accent-emerald: #059669;       /* 翡翠绿：命中、成功、递增、已分配 */
  --accent-amber: #D97706;         /* 琥珀金：警告、临界、待处理、指针激活 */
  --accent-stone: #57534E;         /* 石板灰：次级说明、边框、结构架 */
}
```

### 2.2 动画曲线 (Motion Easing)
```javascript
const MOTION_EASING = {
  // 核心翻转/矢量展开：指数快速刹车
  pivot: "expo.out",
  // 进场对撞入定：极陡速度曲线，高减速硬朗入定，严禁回弹 overshoot
  snap: "power4.out",
  // 退场平滑淡出：
  exit: "power2.in",
  // 微交错阶梯延迟 (毫秒)
  stagger: 0.05
};
```

---

## §3 五大核心原子组件配方 (Atomic UI Recipes)

> **原则**：零 npm 构建依赖，仅依靠标准 Tailwind 类名与轻量 CSS。AI 可直接整段复制。

### 组件 1：浅色工程图纸微网格与环境双光晕舞台 (Blueprint Grid Stage)
> **适用场景**：演示主画布容器、算法执行区、三维模型观察区。

```html
<!-- 舞台外层容器 -->
<div class="relative w-full min-h-[480px] rounded-2xl border border-[#E5E4DC] bg-[#FAF9F5] overflow-hidden shadow-sm">
  
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
<button class="beam-cta group relative inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full overflow-hidden text-xs font-medium text-stone-800 bg-white/80 backdrop-blur-md shadow-[0_4px_16px_rgba(37,99,235,0.1)] hover:shadow-[0_6px_24px_rgba(37,99,235,0.18)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-300">
  
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
<button class="tactile-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E4DC] bg-gradient-to-b from-white to-[#F7F6F0] text-xs font-mono font-medium text-stone-700 shadow-[0_1.5px_0_#D6D3CD] hover:bg-stone-50 hover:text-stone-900 active:shadow-none active:translate-y-[1.5px] transition-all duration-100 select-none">
  <span class="text-stone-400">⏭</span>
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

<!-- 硬件/协议状态指示灯 (纯 CSS 细微呼吸) -->
<div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-[11px] font-mono text-emerald-800">
  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
  <span>BUS_IDLE</span>
</div>
```

---

## §4 严格 3 阶段转场动效编排引擎 (The 3-Stage Motion Timeline)

> 来自专业动效规范（refs）：严禁生硬瞬时重绘，严禁多余回弹晃动。所有状态切换严格分为 3 个阶段：
> 1. **Outro（旧状态退场）**：微缩放 + 向上微移淡出。
> 2. **Pivot Action（核心枢纽转换）**：中央图元 Y 轴立体旋转或矢量边框绘制（`expo.out`）。
> 3. **Intro（新状态登场）**：对称反向对撞滑入（左从 -12px，右从 +12px），采用极陡速度捕捉（`power4.out`），错峰递进。

### 通用 JavaScript / GSAP 状态转场模板（AI 可直接调用）

```javascript
/**
 * 3阶段平滑状态切换控制器
 * @param {HTMLElement} oldContainer 旧元素容器
 * @param {HTMLElement} newContainer 新元素容器
 * @param {HTMLElement} pivotElement 居中核心枢纽图元
 * @param {Function} onPivotMidpoint 翻转正中时的状态数据更新回调
 */
function runThreeStageTransition({ oldContainer, newContainer, pivotElement, onPivotMidpoint }) {
  if (!window.gsap) return;

  // 防呆铁律：先彻底清除旧动画竞态
  gsap.killTweensOf([oldContainer, newContainer, pivotElement]);

  const tl = gsap.timeline();

  // 阶段 1: Outro (旧视图退场，150ms)
  if (oldContainer) {
    tl.to(oldContainer, {
      opacity: 0,
      y: -8,
      scale: 0.98,
      duration: 0.15,
      ease: "power2.in"
    });
  }

  // 阶段 2: Pivot Action (核心枢纽执行 Y 轴 3D 旋转翻转，300ms)
  if (pivotElement) {
    tl.to(pivotElement, {
      rotationY: 90,
      duration: 0.15,
      ease: "power2.in",
      onComplete: () => {
        if (typeof onPivotMidpoint === 'function') onPivotMidpoint();
      }
    }).to(pivotElement, {
      rotationY: 0,
      duration: 0.2,
      ease: "expo.out"
    });
  } else if (typeof onPivotMidpoint === 'function') {
    onPivotMidpoint();
  }

  // 阶段 3: Intro (新元素进场，对称滑入 + 强力刹车，350ms，零晃动)
  if (newContainer) {
    // 隐藏准备
    gsap.set(newContainer, { opacity: 0, y: 12, scale: 0.98 });
    
    tl.to(newContainer, {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.35,
      ease: "power4.out" // 极陡速度曲线，高减速硬朗入定，严禁 overshoot
    });

    // 子层级微交错级联 (40ms-80ms delay)
    const childLayers = newContainer.querySelectorAll('.stagger-layer');
    if (childLayers.length > 0) {
      tl.fromTo(childLayers, 
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.25, stagger: 0.05, ease: "power3.out" },
        "-=0.2"
      );
    }
  }

  return tl;
}
```

---

## §5 AI 模块开发速查核对清单 (AI Cheatsheet)

当您（AI）为该项目创建新模块或重构已有模块时，请严格按以下清单执行：

1. **背景是否符合浅色纸质？**
   - 必须使用 `#FAF9F5` 底色；
   - 舞台容器必须套用 `组件 1` 中的微网格（18px）与天青/琥珀双层极淡径向柔光。
2. **操作按钮是否具备物理触感与光束细节？**
   - 主要行动按键采用 `组件 2`（浅色磨砂 + 钴蓝旋转光束边框）；
   - 辅助单步/复位按钮采用 `组件 3`（浅象牙白双层微按键，带 1.5px 下凹反馈）；
   - 进度滑块使用统一的 `.taste-slider`（细线轨道 + 白底黑边圆点）。
3. **数据面板是否具备现代几何感？**
   - 重要说明框或状态面板采用 `组件 4`（非对称圆角 + 浅色工程点阵 + 底部磨砂条）。
4. **动效是否符合 3-Stage 规范与防呆铁律？**
   - 在触发任何动作前，先调用 `gsap.killTweensOf('*')` 预防竞态；
   - 步进转换按 `Outro -> Pivot -> Intro` 顺序驱动；
   - 进场缓动统一采用 `power4.out`，拒绝随意反弹。
5. **是否保持零 npm 构建便携性？**
   - 严禁引入任何需要打包编译的 npm 组件库；所有效果均由上述纯 Tailwind + 轻量 CSS + CDN GSAP 实现，直接双击 `index.html` 即可运行。
