# 三大抽样分布的上分位点

原生 HTML / CSS / JavaScript，直接打开 `index.html` 或通过静态服务器访问。GSAP 仅负责推进时刻；资源未加载时禁用播放，保留所有手动阶段与参数。

`model.js` 提供 PDF、生存函数与逆生存函数。`choreo.js` 从时刻计算阴影、边界移动和说明；`app.js` 只连接图形、控件与时钟。

六幕区分两个操作：同一个 qα 左右概率互补；随后移动至 q(1−α)，再用右侧补集求左尾 α。阶段按钮停在该幕完成态。

曲线使用线性坐标；数值和概率条按全域计算，并显示图外概率。极长尾或很窄的左尾使用独立线性局部窗口，两个窗口的屏幕面积不能直接比较。窄宽下曲线局部滚动，概率数值另行保持可读。

## 数学核对

上分位点采用逆生存函数约定 `SF(qα)=α`。定义与密度参考 SciPy 官方文档：[χ²](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.chi2.html)、[t](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.t.html)、[F](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.f.html)。常见值对照 NIST 的 [χ²表](https://www.itl.nist.gov/div898/handbook/eda/section3/eda3674.htm)、[t表](https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm)、[F表](https://www.itl.nist.gov/div898/handbook/eda/section3/eda3673.htm)。NIST表保留三位小数；更高精度通过闭式特例、逆函数关系与归一化数值积分交叉验证。

## 验证

```sh
node 三大抽样分布/model.test.cjs
node 三大抽样分布/choreo.test.cjs
python3 .agents/skills/webapp-testing/scripts/with_server.py --server "python3 -m http.server 8128 --bind 127.0.0.1" --port 8128 -- python3 三大抽样分布/browser.test.py
npm run check
```

浏览器测试覆盖三分布、同点互补与换点、极端自由度、F(2,1)/t₁长尾、六幕完成态、暂停/续播/速度、参数保持时刻、键盘、URL恢复、窄宽、file://、缺引擎及减少动效。截图保存到 `/tmp/sampling-qa/`。未验证 Firefox/Safari 或真实设备性能。
