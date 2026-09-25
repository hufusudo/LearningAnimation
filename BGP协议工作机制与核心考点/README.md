# BGP 协议工作机制与考研核心考点

打开本目录的 `index.html`，或从总展厅的“计算机网络”进入。无需安装或构建。

四个考研核心场景：

1. **基础建邻与通告**：TCP 三次握手 → OPEN 协商 → KEEPALIVE 保活 → UPDATE 通告前缀，同步展示 BGP 会话状态机（Idle → Connect → OpenSent → OpenConfirm → Established）。
2. **路径向量与环路避免**：追踪一条 UPDATE，看 AS_PATH 逐跳写入 `100` → `[100]` → `[200, 100]`，绕回 AS100 时触发红叉，按「检测到本 AS 号，丢弃以防环」丢弃。
3. **eBGP 与 iBGP 差异**：NEXT_HOP 在 eBGP 通告时改写为发送方接口 IP，在 iBGP 通告时默认保持不变，并演示由此产生的可达性问题与两种解决办法（IGP 打通 / next-hop-self）。
4. **策略选路优先权**：两条候选路径（AS_PATH 2 段 vs 3 段），默认选短；把长路径的 LOCAL_PREF 提到 300 后，光流强行切换到长路径，直观展示「策略优于最短路径」。

播放、暂停、回退、单步、倍速、进度拖动、关键节点跳转均可用。空格播放/暂停，左右方向键切换步骤（在输入控件内操作时保留原生行为）。系统开启“减少动态效果”时，保留步骤与状态变化，省略移动动画。

## 教学简化

- 只展示一条前缀 `192.168.1.0/24` 与一台路由器的 BGP 路由表；省略团体属性、MED、路由反射器、联盟与 4 字节 AS 号。
- 选路过程只演示 LOCAL_PREF、AS_PATH 长度与 NEXT_HOP 三级判定，真实设备共有十余条判定顺序（LOCAL_PREF → 本地始发 → AS_PATH → 起源类型 → MED → eBGP 优于 iBGP → …）。
- **AS_PATH 段数说明**：三个自治系统的前提下，AS_PATH 段数最大为 2。场景 4 的“3 段”长路径来自 **AS 欺骗（AS prepend）**——AS100 在下方出口重复写入自身 AS 号两次。这是运营商影响上游选路的常用手段，不是拓扑自然产生的长度差，演示中已显式标注。
- NEXT_HOP 的 IP 地址为教学编号（`10.0.12.1` 等），不对应真实链路规划；动画步骤不等于真实秒数。
- KEEPALIVE 周期按 Hold Time / 3 = 60 秒、Hold Time 180 秒的常见缺省值展示。
- GSAP 可用时使用其缓动函数；无法联网时自动降级为本地缓动，教学功能完整可用。

## 验证

```bash
node model.test.cjs
```

14 项断言覆盖：eBGP/iBGP 的 AS_PATH 与 NEXT_HOP 变化、AS 欺骗（prependCount=2）、AS_PATH 环路检测与丢弃、三级选路规则（LOCAL_PREF 压过 AS_PATH 长度）、名次表排序与空候选兜底。

协议依据：[RFC 4271（BGP-4）](https://www.rfc-editor.org/rfc/rfc4271) · [RFC 1997（BGP Community）](https://www.rfc-editor.org/rfc/rfc1997)
