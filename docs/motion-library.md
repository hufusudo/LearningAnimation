# 小动效设计库

> 供新模块选用的小动效清单。每条都写成 `(步, 进度)` 下的纯函数，可拖动、倒退、暂停后精确重绘（[DESIGN_SYSTEM §8](../DESIGN_SYSTEM.md)）。**这是参考，不是模板**：选用后按题材改写参数与造型，美学细节由 AI 自行决定。
> 相关文档：[DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md)（底线与选择表）、[模式库](patterns.md)（P5 状态变化的引导与过渡）、[ui-recipes.md](ui-recipes.md)（组件代码）。

## 0. 怎么用

1. 先按 [DESIGN_SYSTEM §8](../DESIGN_SYSTEM.md) 的选择表，按"要表达什么"挑出 1–3 个编号，写进设计方案。
2. 每个编号写明它在哪一步、扮演什么角色：**引导**（先于变化）、**主动作**（这一步唯一的主动作）或**回执**（主动作之后）。
3. 公式里的 `t` 是本步进度（0–1）。每步的窗口划分写进 `choreo.js`，用 `win(t, a, b)` 切出局部进度；不在 DOM 回调里累积状态。
4. 同一模块的缓动规则保持一致（DESIGN_SYSTEM §2.2）。本库的公式统一用下面四个辅助函数：

```js
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const win = (t, a, b) => clamp01((t - a) / (b - a));  // 窗口 [a, b] 内的局部进度
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => k * k * (3 - 2 * k);               // smoothstep，与模式库 P5 的 ease 相同，起止速度为零
```

5. 编号写进 `choreo.js` 文件头：`// 动效选用：A1、B1、E1`。`verify.js` 检查编号都存在；文件头缺失时只给汇总警告。

## 1. 通用约定

- **一步的结构**：引导（可选）→ 唯一的主动作 → 回执（可选）。引导不算主动作，但同一步只指向一个对象。
- **时长**：步长约 1 秒，所以 0.4 步约 400 ms。主动作占前半（约 0–0.5），回执在后段（约 0.5–0.8），浮标淡入约 0.25 步（DESIGN_SYSTEM §8）。界面控件的过渡仍按 100–300 ms（§2.2）。NN/g 的经验是：简单反馈约 100 ms，较大的界面变化 200–300 ms，移动得越远越要平滑（见第 5 节）。
- **响应**：由用户操作触发的因果动效，应在 0.1 秒内开始（NN/g）。
- **控制**：学习者如何使用可视化，比它展示什么影响更大（Hundhausen 等，2002，见第 5 节）。因此每条动效都应能被单步、拖动和倒退地检查（DESIGN_SYSTEM §8）。
- **缓动**：位置与数量线性（DESIGN_SYSTEM §2.2）；界面的进出场与窗口内的淡入淡出用 `ease`（smoothstep，与模式库 P5 一致，起止速度为零）；不回弹，不过冲。Material 3 的空间弹簧会过冲，本项目不采用（见第 5 节）。
- **闪烁**：每秒不超过 3 次（WCAG 2.3.1）。本库没有闪烁类动效，脉冲只播一次。
- **属性**：SVG 的几何属性（`r`、`x`、`width`、`stroke-dashoffset`）与 `transform`、`opacity` 由脚本写入，不在 CSS 类里重复声明（DESIGN_SYSTEM §10）。
- **减少动效**：每条都直接到步末终态，静态信息与解说不变（DESIGN_SYSTEM §8）。MDN 对该偏好的说明是：界面应去掉、减弱或替换基于运动的动画（见第 5 节）。

## 2. 目录

| 编号 | 名称 | 表达什么 | 角色与窗口 |
|---|---|---|---|
| A1 | 焦点外环脉冲 | 指出下一个要变化的对象 | 引导，0–0.4 |
| A2 | 游标滑向目标 | 从哪里取、往哪里去 | 引导或主动作，0–0.5 |
| A3 | 轮廓圈定 | 圈出一片区域 | 引导，0–0.4 |
| B1 | 飞行芯片 | 数据沿路径或曲线走 | 主动作，0–0.6 |
| B2 | 原位换位 | 两个对象互换位置 | 主动作，0–0.5 |
| B3 | 推入与移出 | 栈、队列、链表的增删 | 主动作，0–0.4 |
| B4 | 区间框移动与收缩 | 窗口或区间的边界 | 主动作，0–0.5 |
| C1 | 数字滚动 | 计数、占用的变化 | 回执，0.5–0.8 |
| C2 | 填充与生长 | 容量、进度、柱、进度环 | 主动作或回执 |
| C3 | 颜色插值与文字淡变 | 状态切换 | 主动作，见模式库 P5 |
| D1 | 淡入上浮 | 浮标、注记 | 回执，0.5–0.75 |
| D2 | 淘汰淡出 | 被淘汰或移出的对象 | 主动作，0–0.4 |
| E1 | 描边生长 | 曲线、连线的形成 | 主动作，0–0.6 |
| E2 | 逐项显影 | 样本、序列逐个出现 | 主动作，0–0.8 |
| E3 | 擦除显影 | 结果、截面逐步露出 | 回执，0.5–0.8 |
| F1 | 涟漪扩散 | 广播、洪泛、事件源 | 主动作，0–0.6 |
| F2 | 访问波前 | 图上逐层亮起 | 主动作，每层一步 |
| G1 | 参数扫描 | 旋转、剖切、切线 | 主动作，整步 |

## 3. 条目

### A 引导（先于变化）

#### A1 焦点外环脉冲
- **用途**：指出下一个要变化的对象，让观众先看见"在哪里"。
- **题材**：节点、页框、数组元素、分区，例如时钟页面置换里的当前页框。
- **参数**：`k = win(t, 0, 0.4)`；外环半径 `r = r0 + 6 * ease(k)`，透明度 `1 - k`。窗口外不显示。
- **实现**：一个无填充的 `<circle>`，描边取本模块的当前动作色；`r` 与 `opacity` 由脚本写入。
- **减少动效**：外环直接出现在目标上，半径不变，步末撤下。
- **不要**：同一步多个对象同时脉冲；循环脉冲。
- **依据**：Mayer 的信号原则，用提示引导注意到关键元素（第 5 节，《Cambridge Handbook》第 17 章）；模式库 P5 的焦点外环。

#### A2 游标滑向目标
- **用途**：标出"从哪里取、往哪里去"，把因果在空间上连起来。
- **题材**：指针类过程，例如时钟页面置换的指针、取指位置。
- **参数**：`k = win(t, 0, 0.5)`；`x = lerp(x0, x1, k)`，`y = lerp(y0, y1, k)`，线性。到达后停在目标上，直到变化窗口开始。
- **实现**：一个小三角或括号形 `<path>`，朝向由位移方向算出。
- **减少动效**：游标直接停在目标上。
- **不要**：游标本身就是主动作时（如指针转动一格），不再叠加别的主动作；不用弹性。
- **依据**：Google Design 的《Implementing Motion》：功能性的动效适合线性路径（第 5 节）。

#### A3 轮廓圈定
- **用途**：圈出一片区域，例如一个分区、一组页框、一段数组，先定范围再看内容。
- **题材**：伙伴系统里的一块空闲区，回退 N 帧里的发送窗口边界，子网划分。
- **参数**：`k = win(t, 0, 0.4)`；`stroke-dashoffset = 1 - k`。
- **实现**：圆角矩形或闭合 `<path>` 设 `pathLength="1"` 与 `stroke-dasharray="1"`，脚本写入 `stroke-dashoffset`。
- **减少动效**：轮廓直接完整显示。
- **不要**：一步圈出多个区域；圈定后做循环闪烁。
- **依据**：MDN 的 `pathLength` 说明：`stroke-dasharray` 以 `pathLength` 作为路径总长（第 5 节）。

### B 移动（保持对象身份）

#### B1 飞行芯片
- **用途**：数据、报文、页号沿真实路径移动，移动本身就是因果。
- **题材**：报文沿链路，数据经总线，页号去外存（假脱机 SPOOLing），曲线上的动点。
- **参数**：`k = win(t, a, b)`；`[x, y] = path.getPointAtLength(k * path.getTotalLength())`，按弧长匀速。落地后芯片淡出，目标处的标签接替（模式库 P5：落地即交接）。
- **实现**：路径是一条 `<path>`，多段路由先拼成一条 `d`；芯片是一个小 `<g>`，脚本写 `transform`。
- **减少动效**：芯片直接出现在终点。
- **不要**：沿路径用缓动，同一段路径的速度会随位置变化，数量之间不再可比；用弹跳追逐。
- **依据**：MDN `getPointAtLength` 按距离取路径上的点（第 5 节）；Heer & Robertson 指出动画有助于对象身份的连续（第 5 节）。

#### B2 原位换位
- **用途**：两个对象互换位置（排序、交换），对象身份不变，观众能追踪是哪一个。
- **题材**：数组交换、堆的调整、两个节点互换位置。
- **参数**：`k = win(t, 0, 0.5)`；对象 A 的横坐标 `x = lerp(xA, xB, k)`，对象 B 为 `lerp(xB, xA, k)`，线性。移动中的对象移到同层最上方，结束后归位。
- **实现**：节点是同一个元素，只改坐标，不重建。起止坐标由 `(步, 进度)` 直接算出，因此不需要测量；FLIP 的 First 与 Last 就是这两组坐标。
- **减少动效**：窗口末直接换位。
- **不要**：两个对象同时穿过彼此却不分层级；换位后做回弹。
- **依据**：FLIP 技术由 Paul Lewis 提出，核心是只动 `transform` 与 `opacity`（第 5 节，CSS-Tricks）；Heer & Robertson 讨论了位置变化中的对象连续性（第 5 节）。

#### B3 推入与移出
- **用途**：栈、队列、链表的插入与删除。新元素从入口进入，其余元素平移让位。
- **题材**：栈的入栈与出栈，队列的入队与出队，链表的插入与删除。
- **参数**：推入 `k = win(t, 0, 0.4)`：`dy = lerp(-10, 0, ease(k))`，`opacity = ease(k)`。移出 `k = win(t, 0, 0.4)`：`opacity = 1 - ease(k)`，`scale = lerp(1, 0.92, ease(k))`，窗口末隐藏。让位的元素沿用 B2 的线性位移。
- **实现**：`transform` 写在 `<g>` 上，缩放以元素中心为原点。
- **减少动效**：窗口末直接到位或隐藏。
- **不要**：从 `scale(0)` 出现或消失；用回弹或过冲。
- **依据**：Emil Kowalski 的动效规则：入场不从 `scale(0)` 开始（第 5 节）。缓动统一为 `ease`，见 §0。

#### B4 区间框移动与收缩
- **用途**：窗口或区间的边界移动，表达"范围在变小"或"范围滑过去"。
- **题材**：回退 N 帧与选择重传的发送窗口，二分查找的区间，缺页时的工作集窗口。
- **参数**：`k = win(t, 0, 0.5)`；左边界 `l = lerp(l0, l1, k)`，右边界 `r = lerp(r0, r1, k)`，单位为格，允许小数。框的 `x` 与 `width` 由它们换算。
- **实现**：一个 `<rect>` 框；框内格子的高亮在窗口末才切换，即先移动、后回执。
- **减少动效**：框直接跳到终点。
- **不要**：一步里移动两个窗口；用弹性收缩。
- **依据**：Heer & Robertson 指出位置与大小的变化都需要对象连续性（第 5 节）。

### C 数值与状态

#### C1 数字滚动
- **用途**：计数、占用、累计的变化，作为回执出现。
- **题材**：页框占用数，已完成进程数，报文计数。
- **参数**：`k = win(t, 0.5, 0.8)`；`v = Math.round(lerp(v0, v1, k))`，线性。
- **实现**：数字用 `font-variant-numeric: tabular-nums`，只在整数变化时写入 DOM（DESIGN_SYSTEM §10）。需要"旧数上滑、新数下滑"时见模式库 P5 的计数。
- **减少动效**：直接显示终值。
- **不要**：用缓动加速或弹跳数字；数字宽度变化导致右侧跳动。
- **依据**：MDN 的 `tabular-nums` 让数字等宽，便于对齐（第 5 节）。

#### C2 填充与生长
- **用途**：容量、进度、柱状数据从基线长起，或环形进度被逐步填满。
- **题材**：缓冲区占用，甘特条，直方图的柱，节点内的进度环。
- **参数**：条 `w = W * lerp(0, ratio, k)`；柱 `h = H * lerp(0, value / max, k)`；环 `stroke-dashoffset = 1 - ratio * k`。`k` 为窗口内的线性进度。
- **实现**：环用 `<circle pathLength="1" stroke-dasharray="1">`，加 `transform="rotate(-90 cx cy)"` 从 12 点开始。SVG 的几何用属性（`width`、`height`、`y`）写入；只有 HTML 元素才用 `transform: scaleX()`（DESIGN_SYSTEM §2.2）。
- **减少动效**：直接到终值。
- **不要**：进度条用弹性过冲；用颜色渐变代替长度变化。
- **依据**：MDN `pathLength`（第 5 节）；daverupert 用 `stroke-dashoffset` 做径向进度条（第 5 节）。

#### C3 颜色插值与文字淡变
- **用途**：状态切换，例如选中、占用、完成。颜色从旧色插值到新色；文字先淡出旧字，再淡入新字。
- **题材**：页框选中，进程状态切换，计数的颜色变化。
- **参数**：颜色按 `win` 线性插值；文字在 `0–0.2` 内旧字 `opacity = 1 - t / 0.2`，在 `0.2–0.4` 内新字淡入（窗口划分与模式库 P5 的 `textView` 相同）。
- **实现**：见模式库 P5。翻牌（缩成一条线再展开）也在 P5，这里不重复。
- **减少动效**：窗口末直接切换。
- **依据**：DESIGN_SYSTEM §8 的"不做生硬跳变"。

### D 出现与消失

#### D1 淡入上浮
- **用途**：浮标、注记，作为回执出现，说明刚才发生了什么、为什么重要。
- **题材**：所有模块的事件标签。
- **参数**：`k = win(t, 0.5, 0.75)`；`opacity = ease(k)`，`dy = lerp(6, 0, ease(k))`，即向上轻微漂移。
- **实现**：`<g>` 的 `transform` 与 `opacity`；隐藏时用 `visibility`（DESIGN_SYSTEM §10）。
- **减少动效**：直接出现。
- **不要**：同一时刻超过 2–3 个浮标（DESIGN_SYSTEM §6）。
- **依据**：DESIGN_SYSTEM §6 与 §8（浮标淡入约 0.25 个节拍）。

#### D2 淘汰淡出
- **用途**：被淘汰、移出或失效的对象，作为主动作。
- **题材**：时钟页面置换里被淘汰的页，缓存失效，进程退出。
- **参数**：`k = win(t, 0, 0.4)`；`opacity = 1 - ease(k)`，`scale = lerp(1, 0.92, ease(k))`；窗口末改为 `visibility: hidden`，占位保留。
- **实现**：以元素中心为原点缩放。
- **减少动效**：窗口末直接隐藏。
- **不要**：缩到 0；淘汰与装入同时发生却没有先后。
- **依据**：Emil Kowalski 的规则：入场从 `scale(0.9–0.97)` 开始，不从 `scale(0)` 开始（第 5 节）。本库的离开动效同样只缩到 0.92，不缩到 0。

### E 显影（过程揭示）

#### E1 描边生长
- **用途**：曲线、连线、路径本身逐步画出，观众看见它是怎样形成的。
- **题材**：函数图像随自变量增长（高等数学），交换机学习路径的建立，路由轨迹。
- **参数**：`k = win(t, a, b)`；`stroke-dashoffset = 1 - k`（`pathLength="1"`，`stroke-dasharray="1"`），按弧长推进。若要按自变量 `x` 匀速推进，改为每帧生成到 `x(t)` 为止的采样点 `d`。
- **实现**：脚本每帧写 `stroke-dashoffset` 或 `d`。
- **减少动效**：完整显示。
- **不要**：一步里画多条线却没有先后；为了好看而让描边过冲。
- **依据**：MDN `stroke-dasharray` 与 `pathLength`（第 5 节）。按自变量推进的做法是本库的项目推导。

#### E2 逐项显影
- **用途**：一组样本或序列逐个出现，观众跟着顺序看。
- **题材**：概率抽样时点逐个落下，数组逐元素初始化，报文按序号依次到达。
- **参数**：共 `N` 项，第 `i` 项（从 0 起）`opacity_i = clamp01(t * N - i)`。每项在自己的时段内淡入，相邻两项之间没有空档。
- **实现**：每项是独立元素，脚本每帧按 `i` 写 `opacity`。
- **减少动效**：全部直接显示。
- **不要**：一步里放进很多项。约 10 项以内较稳妥（本库的建议值，不是文献规定），超过就拆成多步。
- **依据**：Mayer 的分段原则，学习者按段推进（第 5 节）。注意：Mayer & Chandler（2001）的复现记录里有一次未能复现，所以这里把分段当作设计倾向，不当作定律。Heer & Robertson 也用短延迟错峰以减少遮挡（第 5 节）。

#### E3 擦除显影
- **用途**：结果、截面、隐藏的一层在主动作之后逐步露出，作为回执。
- **题材**：算式结果行，剖切后露出的截面，隐藏的存储内容。
- **参数**：`k = win(t, a, b)`；一个 `<clipPath>` 的矩形宽度 `W * k`，线性。窗口不少于 0.3 步（本库的建议值）。
- **实现**：只裁剪显示，内容在窗口开始前已经写好。
- **减少动效**：直接全部显示。
- **不要**：用擦除代替对象的移动。
- **依据**：本库的项目推导，与模式库 P5 的文字揭示同类。

### F 传播

#### F1 涟漪扩散
- **用途**：一个源向外传播，观众看见范围在扩大。
- **题材**：以太网广播帧，ARP 请求，事件广播。
- **参数**：`k = win(t, 0, 0.6)`；半径 `r = R * k`，透明度 `1 - k`，描边宽度不变。
- **实现**：源点上的 `<circle>`，`r` 与 `opacity` 由脚本写入。
- **减少动效**：外圈以终态半径静态显示，步末撤下。
- **不要**：一步里多个源同时扩散；没有事件时循环涟漪。
- **依据**：Heer & Robertson 指出动态能有效吸引注意，并且在周边视觉中也容易被察觉（第 5 节）。

#### F2 访问波前
- **用途**：图上一层一层地亮起，表达"先到的先亮"。
- **题材**：迪杰斯特拉的逐层扩展，BFS 的层序，洪泛的层级。
- **参数**：每一步只点亮一层（第 `s` 层），该层节点颜色 `k = win(t, 0, 0.6)`，由旧色插值到新色。整个扩展由多步构成，每步一层。
- **实现**：同一层的节点同一时刻变色。
- **减少动效**：所有节点直接显示终态色。
- **不要**：一步里点亮多层；用颜色深浅表示距离却没有图例（DESIGN_SYSTEM §7）。
- **依据**：Mayer 的分段原则（第 5 节）；阶段条的做法见模式库 O4。

### G 参数（几何）

#### G1 参数扫描
- **用途**：旋转、剖切、切线随参数变化，表达"参数变了，图形跟着变"。
- **题材**：旋转曲面与锥面的角度 θ，剖切平面（截线），切线沿曲线移动。
- **参数**：`θ = lerp(θ0, θ1, t)`；剖切平面 `s = lerp(s0, s1, t)`。全程线性，窗口为整步。
- **实现**：每帧由参数重算几何，写成纯函数。
- **减少动效**：直接到终参数。
- **不要**：对参数做缓动，时间与参数的对应被扭曲，观众无法估计参数值；扫描中同时改视角。
- **依据**：DESIGN_SYSTEM §2.2 与 §8（定量轨迹线性）。通用 UI 规范多用缓动，例如 Carbon 称严格线性的运动显得不自然（第 5 节）；但参数扫描是数学量，线性更忠实。

## 4. 不推荐的做法

Tversky 等（2002）的综述认为，动画对学习的效果并不稳定；同一作者组（2000）指出，动画占优的情形往往是它展示了静态图难以表达的微步骤（第 5 节）。所以每条动效都要说得清它表达了什么，装饰性的动画不收录。

| 做法 | 不用的理由 | 依据 |
|---|---|---|
| 数量或轨迹用弹跳、过冲 | 读者无法从位置估计数量 | DESIGN_SYSTEM §2.2；Material 3 的弹簧过冲用于空间变换 |
| 从 `scale(0)` 出现或消失 | 看起来凭空出现或消失 | Emil Kowalski 的规则 |
| `transition: all` | 无法控制哪些属性在变化 | Emil Kowalski 的规则 |
| 循环的装饰动效（呼吸、流动、漂浮） | 与内容无关，分散注意 | DESIGN_SYSTEM §7、§8；WCAG 2.3.1 |
| 一步里多个主动作同时进行 | 观众跟不上 | DESIGN_SYSTEM §8；Mayer 的分段原则 |
| 逐字显示长解说 | 与"解说只在句子变化时更新"冲突 | DESIGN_SYSTEM §8 |
| 整块视图的翻牌转场 | 与因果关系无关 | DESIGN_SYSTEM §4 |

## 5. 来源

核对说明：2026-10-18 以搜索结果摘要核对，未逐页通读原文。Emil Kowalski 的规则来自第三方技能文档对《Animations on the Web》课程的转述，未直接读取原课程。

**认知与教学**
- Mayer, R. E., & Chandler, P. (2001). When learning is just a click away: Does simple user interaction foster deeper understanding of multimedia messages? *Journal of Educational Psychology*, 93(2), 390–397. https://eric.ed.gov/?id=EJ638751 ；复现记录（有一次未能复现）：https://forrt.org/flora-replication-atlas/doi/10.1037/0022-0663.93.2.390
- Mayer（主编）《The Cambridge Handbook of Multimedia Learning》第 19 章《Principles for Managing Essential Processing in Multimedia Learning》（分段原则）：https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/principles-for-managing-essential-processing-in-multimedia-learning/A9E77D0172F905AC957689D1771E2888
- 同上，第 17 章《The Signaling (or Cueing) Principle in Multimedia Learning》（信号原则）：https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/signaling-or-cueing-principle-in-multimedia-learning/3972D4ACC628D5B53F7B2B4785DB2B06
- Morrison, J. B., Tversky, B., & Betrancourt, M. (2000). Animation: Does it facilitate learning? *AAAI Spring Symposium, Smart Graphics*. https://aaai.org/papers/0009-SS00-04-009-animation-does-it-facilitate-learning
- Tversky, B., Morrison, J. B., & Betrancourt, M. (2002). Animation: can it facilitate? *International Journal of Human-Computer Studies*, 57(4), 247–262（文献综述页：https://serc.carleton.edu/resources/871.html ）
- Hundhausen, C. D., Douglas, S. A., & Stasko, J. T. (2002). A meta-study of algorithm visualization effectiveness. *Journal of Visual Languages and Computing*, 13(3), 259–290. https://www.semanticscholar.org/paper/A-Meta-Study-of-Algorithm-Visualization-Hundhausen-Douglas/753e90a9827481e3eea3725ee47393813df14ce2

**动画过渡与界面动效**
- Heer, J., & Robertson, G. (2007). Animated transitions in statistical data graphics. *IEEE Transactions on Visualization and Computer Graphics*, 13(6), 1240–1247. DOI 10.1109/TVCG.2007.70539 ；PDF：https://idl.cs.washington.edu/files/2007-AnimatedTransitions-InfoVis.pdf
- Nielsen Norman Group：Animation for Attention and Comprehension，https://www.nngroup.com/articles/animation-usability
- Nielsen Norman Group：Executing UX Animations: Duration and Motion Characteristics，https://www.nngroup.com/articles/animation-duration
- Carbon Design System：Motion，https://www.carbondesignsystem.com/building-blocks/foundations/motion
- Material Design 3：Motion，https://m3.material.io/styles/motion/overview/how-it-works
- Google Design：Implementing Motion，https://medium.com/google-design/implementing-motion-9f2839002016
- Ant Design：动效，https://ant.design/docs/spec/motion-cn
- Emil Kowalski 动效规则（第三方整理）：https://www.ui-skills.com/skills/emilkowalski/animate ；https://www.claudecodehq.com/playbooks/web-animation-design
- CSS-Tricks：Animating Layouts with the FLIP Technique，https://css-tricks.com/animating-layouts-with-the-flip-technique

**无障碍与 Web 技术**
- W3C：Understanding WCAG 2.1 SC 2.3.1 Three Flashes or Below Threshold，https://w3c.github.io/wcag21/understanding/three-flashes-or-below-threshold.html
- MDN：prefers-reduced-motion，https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- MDN：SVGGeometryElement.getPointAtLength()，https://developer.mozilla.org/en-US/docs/Web/API/SVGGeometryElement/getPointAtLength
- MDN：pathLength，https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/pathLength
- MDN：stroke-dasharray，https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke-dasharray
- MDN：font-variant-numeric，https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-variant-numeric
- daverupert.com（2018）：Animated SVG Radial Progress Bars，https://daverupert.com/2018/03/animated-svg-radial-progress-bars
