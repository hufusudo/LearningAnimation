# 演示项目 Agent 开发规范 (AGENT.md)

> 本目录用于存放高等数学、概率论与数理统计、计算机专业基础（考研 408 全科）等学科的交互式可视化教学与几何直观系统。
> 所有在此目录下创建或维护演示项目的 Agent，必须严格遵循以下核心规范：

---

## §1 核心哲学与 AI 开发减负准则 (Core Principles & Workflow)

### 1.1 独立沙盒开发 · 严禁跨模块全量翻查
- **绝对的物理沙盒**：每个演示模块都是一个自包含、独立生命周期的单页 Web App（位于各自的独立目录下），模块间没有任何运行时代码依赖。
- **严禁无端跨模块检索**：严禁 AI 在接到新模块需求时全量扫描、检索或阅读其他已有模块的代码（如翻看其他目录下的 `app.js` 或 `style.css`）。这不仅严重消耗 Context Token、拖慢响应速度，还会将其他模块特定的布局结构刻板复制过来。

### 1.2 美学自主创新 · 拒绝千篇一律
- **拒绝模版固化**：本项目**绝不追求所有模块的界面与交互长得一模一样**！不同学科知识点拥有完全不同的逻辑维度（高数需要 3D 投影与微元剖分、计网需要双主机时序梯形图与报文显微镜、计组需要寄存器总线脉冲、数据结构需要节点裂变与指针变轨）。
- **底线原则下的自由创造**：AI 应当直接基于本规范中的**底线美学原则**（温暖纸白 `#FAF9F5`、纯白卡片 `#FFFFFF`、1px 细线边框 `#E5E4DC`、物理触感微按键、60fps GSAP 平滑过渡），结合自身对该学科知识点物理/数学本质的深刻理解，**自主构思最契合该考点的 UI 布局、状态机控制面板与视觉呈现**。

### 1.3 极简三步开发闭环 (The 3-Step Lifecycle)
为当前项目开发新模块，标准流程严格遵循以下三步：
1. **起步初始化**（可选使用原生脚手架）：
   在根目录下运行以下命令（自动创建目录、生成标准骨架、并在 `modules.js` 中自动登记）：
   ```bash
   node new.js "模块名称" <学科标识: math|prob|ds|co|os|net> [特性标签]
   # 示例: node new.js "TCP流量控制" net "滑动窗口 · 丢包重传"
   ```
   *（若手动创建，则在模块文件夹下编写 `index.html`, `style.css`, `app.js`，并在 `modules.js` 末尾追加一条对象记录）*
2. **沙盒创作**：
   AI 将 100% 的精力集中在当前模块目录下，编写交互动画、HUD 控件与数学/逻辑计算。
3. **极速自检交付**：
   在根目录下运行自检脚本，20 毫秒验证语法合规、路径存在与无死链：
   ```bash
   node verify.js
   ```
   **严禁直接修改根目录下的 `index.html`**！展示门厅全面采用数据驱动，全站统计、卡片网格与一级大厅胶囊清单均由 `modules.js` 自动响应式渲染。

---

## §2 界面与视觉设计规范 (Taste-Skill Light Editorial & Cyber-Paper)

> 完整设计令牌、原子组件代码配方与效果详见根目录 [DESIGN_SYSTEM.md](file:///home/hf/项目/show/DESIGN_SYSTEM.md)。新模块与重构开发请直接调用该规范。

### 2.1 严格浅色纸质与工程微网格底图
- **色彩基底**：全站严格采用暖白纸质主题（温暖纸白 `#FAF9F5` 底色，纯白 `#FFFFFF` 卡片容器，精致 1px 细线边框 `#E5E4DC`）；
- **舞台环境柔光与微网格**：演示主画布容器必须配备 `18px 细线工程微网格`（`rgba(0,0,0,0.035)`）与极低饱和的天青/琥珀双层径向柔光（`rgba(56,189,248,0.08)` / `rgba(245,158,11,0.06)`），营造类似精密工程图纸与手稿的纵深感；
- **严禁设计禁忌**：严禁深色暗黑模式（Dark Mode）、严禁泛滥的 generic AI 紫色/蓝粉渐变、严禁厚重模糊的大黑阴影。

### 2.2 排版与字体层级
- **界面常规 UI**：现代无衬线体（`-apple-system`, `SF Pro Display`, `Segoe UI`, `Roboto`）；
- **数学符号与定理**：经典衬线体（`Newsreader`, `Georgia`, `serif`）；
- **坐标、内存地址与数值**：等宽字体（`JetBrains Mono`, `monospace`）；
- **数学公式**：统一采用 KaTeX CDN 动态渲染。

### 2.3 笔记式引用排版 (Obsidian-Style Callouts)
用于核心考点提示、警示或关键原理解析，统一使用浅底色与细边框：
- `[!tip]`：翡翠绿（`bg-emerald-50 text-emerald-900 border-emerald-200`）；
- `[!note]`：湖水蓝（`bg-sky-50 text-sky-900 border-sky-200`）；
- `[!important]`：熏衣紫（`bg-purple-50 text-purple-900 border-purple-200`）；
- `[!warning]`：琥珀黄（`bg-amber-50 text-amber-900 border-amber-200`）。

### 2.4 核心微组件库规范 (Cyber-Paper Atomic UI)
外部参考经浅色脱敏后沉淀为以下四大核心原子组件（代码直接复用 `DESIGN_SYSTEM.md`）：
1. **浅色磨砂光束流光胶囊按钮 (Border-Beam CTA)**：
   核心行动按键采用温润牛奶玻璃（`bg-white/85 backdrop-blur-md`），内嵌深海钴蓝旋转光束（`conic-gradient` 顺时针旋转）与极淡环境光晕，保持高对比度深色文字；
2. **陶瓷双层物理触感微按键 (Ceramic Tactile Buttons)**：
   播放、单步、复位等操作按键采用象牙白双层微按键（外框 `border border-[#E5E4DC]`，表面微顶光渐变），必须具备真实的机械键程下凹反馈：
   ```css
   border border-[#E5E4DC] bg-gradient-to-b from-white to-[#F7F6F0] shadow-[0_1.5px_0_#D6D3CD] active:shadow-none active:translate-y-[1.5px] transition-all duration-100
   ```
3. **非对称圆角与点阵微光卡片 (Asymmetric Dot-Glow Card)**：
   重要状态监视窗或解析卡采用现代非对称曲率（`rounded-2xl rounded-tl-3xl rounded-br-3xl`），内衬纯 CSS 灰阶点阵（`radial-gradient(#CBD5E1 1.2px)`）与中心径向渐淡蒙版，底部搭配磨砂玻璃浮层条；
4. **定制纸质滑块 (Paper Sliders)**：
   统一使用 2px~3px 细线轨道与白底黑边圆点手柄（`.taste-slider`），滑动时具备微触觉阻尼感；
5. **状态呼吸脉冲指示灯 (Pulse Indicators)**：
   采用纯 CSS 细微呼吸脉冲（如 `.pulse-led-emerald`, `.pulse-led-amber`, `.pulse-led-rose`），禁止突兀生硬的跳闪。
- **零外部构建依赖**：所有微组件必须为纯 Tailwind CSS 类名或内嵌于模块的 `style.css`，严禁引入 npm 构建包或外部 UI 组件库。

---

## §3 核心交互、动画规范与防呆铁律 (Motion & Robustness)

### 3.1 60fps 连续性跟手交互
- 画布中的几何图元、切片平面、参数滑块、空间动点等，必须支持 60fps 原生 Pointer Events 跟手交互；
- 拖拽与滑动过程中，截交线、截面面积、辅助指示线与动态公式数值必须以 60fps 实时重算渲染，严禁离散帧卡顿跳转。

### 3.2 严格 3 阶段转场动效管线 (The 3-Stage Motion Timeline)
在任何算法执行、协议时序、节拍演进或定理证明切换中，**严禁无过渡的生硬跳变与突兀刷新**，必须遵循 3 阶段序列时间线：
1. **阶段 1：Outro（旧视图退场）**：
   旧元素向微上方浮动并轻微缩小淡出（`y: -8px`, `scale: 0.98`, `opacity: 0`），缓动使用 `power2.in`（约 150ms）；
2. **阶段 2：Pivot Action（核心枢纽转换）**：
   居中核心图元或算子执行 Y 轴 3D 旋转翻转（`rotationY: 0 -> 90 -> 0`），或矢量路径沿有向轨迹顺滑绘制展开（`strokeDashoffset`），缓动使用指数刹车 `expo.out`（约 300ms）；正中点触发状态数据更新；
3. **阶段 3：Intro（新视图对撞登场）**：
   新元素以对称反向滑入（左侧从 -12px，右侧从 +12px）入定，采用极陡高减速捕捉 `power4.out`（约 350ms），**零回弹（Zero Overshoot）、零晃动**；容器内多层级子元素施加 40ms~80ms 的微交错渐显（`stagger: 0.05`）；
*(通用实现函数可直接调用 `DESIGN_SYSTEM.md` 中的 `runThreeStageTransition`)*。

### 3.3 空间寻址与数据传递的动量轨迹
- 跨区域定位、指针寻址、数据报文传输、总线信号流动等，必须引入物理动量轨迹（如抛物线飞行探针 `flyProbe`、沿切线顺滑展开的有向矢量箭头 `strokeDashoffset` 等）；
- 视角重置、特征点捕捉、自动巡航等动效，统一使用 GSAP（如 `power2.out`, `power3.out`, `back.out`）进行平滑补间。

### 3.4 速率自适应连续性保障
- 动画持续时长必须与速度控制器（如 `0.5x` / `1.0x` / `2.0x`）精确联动动态缩放（`duration / State.speed`），杜绝因速率切换产生截断突变或动作丢失。

### 3.5 【防呆铁律 1】动画状态机竞态清理 (Clear Tweens on Reset)
- **AI 易犯 Bug**：在连续点击“自动播放”、“单步”或“复位”时，若旧的补间未清理，会导致多个计时器并发运行、动画速度失控叠加。
- **强制要求**：**在任何步骤切换、单步触发、复位重置或模式切换前，必须先彻底杀死前序补间或计时器**（如 `if (window.gsap) gsap.killTweensOf('*');` 或 `cancelAnimationFrame`）。

### 3.6 【防呆铁律 2】视口弹性自适应与杜绝横向滚动 (Fluid Viewport)
- **强制要求**：主容器必须采用弹性自适应宽度（如 `w-full max-w-7xl mx-auto`），严禁在根容器上写死绝对像素宽度（如 `width: 1200px`）；
- Canvas / Three.js 必须监听 `window.addEventListener('resize', ...)` 动态更新渲染尺寸与摄像机宽高比，**全站页面在任意屏幕分辨率下均严禁产生横向滚动条**。

### 3.7 【防呆铁律 3】动态公式响应式重绘 (KaTeX Reactivity)
- 数学演示中，若数值或参数随滑块实时变动，**严禁直接拼接原始 LaTeX 源码字符串在页面上裸奔**；必须调用 `katex.render(latexString, domElement)` 进行局部精细重绘。

---

## §4 学科分类与解说内容规范 (Taxonomy & Content)

### 4.1 学科分类矩阵 (Discipline Taxonomy)
所有模块必须归属于以下基石学科之一，学科代号与板块名称严格一致：
1. **高等数学 (`math`)**：
   - 板块名称严格定为**“高等数学”**；涵盖微积分中值定理、空间异面直线距离与投影、旋转曲面、多元积分（三重积分、第一/二类曲线与曲面积分、格林公式）等。
2. **概率论与数理统计 (`prob`)**：
   - 涵盖多维随机变量联合分布曲面、切片截面求边缘密度（祖暅原理）、条件分布、三大抽样分布上分位点等。
3. **数据结构 (`ds`)**：
   - 计算机考研 408 核心学科；涵盖排序算法（快排、堆排、归并裂变、直接/折半插入、希尔、简单选择）、树结构（哈夫曼树、败者树、置换选择）等。
4. **计算机组成原理 (`co`)**：
   - 计算机考研 408 核心学科；涵盖单总线 CPU 数据通路时钟微操作、顺序乘法移位器与 [ACC, MQ] 联合移位等硬件微架构。
5. **计算机操作系统 (`os`)**：
   - 计算机考研 408 核心学科；涵盖系统引导流程、动态分区（伙伴系统）、分页虚存与 Clock 算法、文件生命周期（open&rarr;read）、文件分配与软硬链接等。
6. **计算机网络 (`net`)**：
   - 计算机考研 408 核心学科；涵盖滑动窗口（GBN/SR）、交换机自学习与 VLAN 802.1Q、网络层路由（RIP/OSPF/BGP/NAT/ARP/DHCP）、传输层协议（TCP 三次握手四次挥手、TCP 拥塞控制）等。
7. **408 全科综合 (`cs`)**：
   - 聚合视图，包含上述 `ds`、`co`、`os`、`net` 的全部核心模块。

### 4.2 解说与内容详略规范
- **408 计算机考研演示**：**无需多余文字解说**。直接用生动的数据流动、状态机节拍演进、时空梯形图与硬件微操作直观表达机制本质；
- **数学演示**：**只需解说本质直觉即可**。重点展示几何投影、微元切割与物理意义，切忌大段堆砌死板的教科书推导公式。

---

## §5 工程架构与标准 CDN 配方 (Stack & CDN)

### 5.1 零编译便携架构标准
- **技术栈**：HTML5 + Tailwind CSS (CDN) + Three.js / Canvas (CDN) + GSAP (CDN) + KaTeX (CDN) + 原生 ES6+ JavaScript；
- **标准目录结构**：
  ```text
  学科项目名称/
  ├── index.html   # 页面骨架与 HUD 布局
  ├── style.css    # Taste-Skill 浅色与 Callout 样式
  └── app.js       # 核心交互、动画状态机与计算
  ```
- **零构建开箱即用**：严禁引入 Webpack / Vite / npm 等任何打包工具，确保双击 `index.html`（`file://` 协议）或轻量静态服务器（`python3 -m http.server`）即可零配置丝滑运行。

### 5.2 经过验证的稳定 CDN 黄金配方
编写新模块时，建议直接采用以下经过全站 43 个模块实测验证的 CDN 链接，避免版本冲突或外链失效：
```html
<!-- Tailwind CSS (推荐置于 head) -->
<script src="https://cdn.tailwindcss.com"></script>

<!-- GSAP 动画引擎 (核心必须) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>

<!-- KaTeX 数学公式渲染 (按需引入) -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>

<!-- Three.js 3D 渲染器与控制器 (按需引入，注意顺序) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
```

### 5.3 模块内返回导航规范
每个模块页面顶部的 Header 区域，必须配备清晰的返回链接，指向门厅对应学科锚点，例如：
```html
<a href="../index.html#net" class="text-xs font-mono text-stone-600 hover:text-stone-900 border border-[#E5E4DC] bg-white px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors shadow-sm">
  &larr; 返回计算机网络
</a>
```

### 5.4 modules.js 登记格式
模块在 `modules.js` 中的登记必须符合如下规范：
```javascript
{
  title: "模块完整中文名称",
  discipline: "net", // math | prob | ds | co | os | net
  path: "模块目录名/index.html",
  badge: "核心技术特性标签",
  desc: "1-2句精炼说明，直击本质与核心动效特质",
  formula: "底部公式或核心特征标识"
}
```

---

## §6 会话偏好与执行纪律

- **技能使用偏好**：除非用户在当前任务中明确要求使用 Superpowers，否则**不要主动调用 Superpowers 系列技能或流程**，按用户当前要求直接高效推进工作；
- **极速交付心态**：专注当前目标，写出高品质、丝滑且符合美学的交互系统，自检通过后即刻向用户汇报。
