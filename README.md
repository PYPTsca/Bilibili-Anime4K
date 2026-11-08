# Bilibili Anime4K

给 B 站普通视频、番剧，以及其他网站里可见的`<video>`播放器加一层 Anime4K WebGL实时画质增强。

![Tampermonkey](https://img.shields.io/badge/Tampermonkey-3.1.1-black)
![License](https://img.shields.io/badge/license-MIT-blue)

![预览效果](docs/panel.png)

## 功能

- **任意站点**：B站之外的页面只要存在可见的`<video>`播放器，就会按域名生成一套配置；默认关闭。
- **A/B/C 三种还原模式**：分别针对模糊/压缩伪影较多的视频源、中等伪影的视频源、以及本身干净的高质量视频源。
- **次要模式**：在A/B/C之上再叠一层滤镜。
- **S–UL质量档位**：以内部超采样倍率近似Anime4K的CNN变体，档位越高细节越干净、GPU开销越大。
- **分场景配置**：`普通视频`、`番剧`两套固定配置；其他网站配置独立，互不影响。
- **播放器内设置面板**：左上角悬浮按钮，鼠标移入播放器时亮起；B站站点按钮跟随控制栏，其他站点使用固定定位跟随视频。
- **统计条**：开启后在按钮右侧显示模式、内部渲染分辨率、源分辨率、fps和GPU耗时。
- **性能保护**：单帧超预算时自动降低内部渲染分辨率。
- **边界处理**：4K源自动按原生分辨率输出；HDR/杜比内容默认暂停；WebGL 上下文丢失后自动重建；SPA切集/换视频自动重新挂载；跨域视频源会提示并停用。

## 安装

前置条件：**Chrome 或 Edge**（Chromium 内核），并安装[Tampermonkey](https://www.tampermonkey.net/)插件。

### 一键安装

[点击安装 Bilibili-Anime4K.user.js](https://raw.githubusercontent.com/PYPTsca/Bilibili-Anime4K/main/Bilibili-Anime4K.user.js)

点击后会跳转Tampermonkey安装页，确认即可。脚本支持自动检查更新。

>[!NOTE]
> 3.1.0起脚本激活范围扩大到所有网站，Tampermonkey会提示“在所有网站运行”。脚本只在检测到可见视频时才注入 UI，但在意权限范围的话可以用 Tampermonkey 的“仅在特定站点运行”自行收紧。

## 使用

- 鼠标移到播放器左上角，点击打开设置面板。
- 番剧页面**默认开启**；普通视频页面、其他网站**默认关闭**。
- 每个域名、每个profile独立保存开关和全部参数；同一域名换视频/换页面仍沿用。
- 也可从Tampermonkey菜单里切换当前页面开关、打开面板、重置当前配置。

### 默认配置

| 参数           | 默认值   |
| -------------- | -------- |
| 主模式         | A        |
| 次要模式       | 无       |
| 质量档位       | UL       |
| 还原强度       | 80%      |
| 输出分辨率     | 2160P    |
| 帧率上限       | 30       |
| FXAA           | 关       |
| 放大算法       | Lanczos3 |
| 锐化           | 60%      |
| 线条检测灵敏度 | 85%      |
| 性能保护       | 关       |
| 显示统计       | 关       |

>[!NOTE]
> 这套默认值渲染压力较大。如果播放不流畅，优先把**质量档位**降到 M/S，或把**输出分辨率**降到 1440P/1080P。

## 参数说明

### 主模式

| 模式 | 优化对象                          | 项目实现                                     |
| ---- | --------------------------------- | -------------------------------------------- |
| A    | 高模糊、压缩伪影较多的 1080p 动画 | thin-lines + 线条检测 + refine，还原力度最强 |
| B    | 中等伪影的 720p / 部分 1080p      | 同样的管线，强度和检测阈值更克制             |
| C    | 本身干净的高质量源                | 跳过线条重建，只做边缘保留降噪 + 放大        |

### 次要模式

`无 / A / B / C`。第二层滤镜的独立选择；选“无”只加载一层。

### 质量档位

| 档位 | 内部超采样倍率 |
| ---- | -------------- |
| S    | 0.8×           |
| M    | 1.0×           |
| L    | 1.2×           |
| VL   | 1.45×          |
| UL   | 1.75×          |

> 这是**近似实现**：真正的 Anime4K v4 CNN 变体在 WebGL 里无法实时运行，本脚本用内部超采样倍率模拟“越高越清晰、越慢”的梯度。模式本身也是经典 WebGL 管线的近似，不是 v4 的 CNN 推理。

### 其它参数

| 参数             | 说明                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 还原强度         | 线条还原/细化总幅度。越高线条越细越亮，过高会发灰、振铃。                                                                            |
| 输出分辨率       | 自动：按播放器显示尺寸\*DPR，在1440P–2160P间取值；原生：跟源一致；1080/1440/2160P：指定内部目标高度。4K 源在“自动”下直接按原生输出。 |
| 帧率上限         | 自动：屏幕刷新率的一半，限制在 30–60；也可固定 30 或 60。                                                                            |
| FXAA             | 边缘抗锯齿。开更平滑，关更锐利。                                                                                                     |
| 放大算法         | 双线性最柔和、双三次平衡、Lanczos3最锐（可能产生白边）。                                                                             |
| 锐化             | 后处理unsharp，用于补偿还原造成的对比度下降。                                                                                        |
| 线条检测灵敏度   | 越高参与还原的线条越多，效果更明显，也更容易误伤纹理。                                                                               |
| 性能保护         | 单帧超预算时自动降低内部渲染分辨率，避免掉帧。                                                                                       |
| 显示统计         | 在按钮右侧显示模式、分辨率、fps、GPU耗时。                                                                                           |
| HDR 内容强制启用 | 检测到 HDR/杜比时默认暂停；强制开启可能偏色。                                                                                        |

## 性能建议

- 统计条里的`GPU xx ms`是单帧渲染耗时：30fps预算是33ms，60fps是16ms；长期贴近预算就降档。
- 默认值渲染压力很大，中低端GPU/核显建议先降到**M档+1440P**。
- 720P/低码率番剧的提升最明显；1080P高码率源本身干净，Anime4K的还原幅度天生较小。
- 觉得画面发灰：降低「还原强度」，把「锐化」提到 30–60，或改用C模式。

## 兼容性与已知限制

- 仅支持**Chrome/Edge**（Chromium 内核）；Firefox、Safari未适配。
- B站使用标准 `bpx` 播放器；B 站DOM大改时可能需要更新选择器。
- 其他站点按“页面中面积最大的可见视频”识别播放器，可能误选背景视频/广告视频；可关闭该域名配置。
- 原生`<video controls>`站点：滤镜会隐藏原视频画面，原生播放控件可能被一起遮住；面板会给出提示，建议此类站点使用自定义控件的播放器。
- 跨域视频源（未开启 CORS 的 CDN）无法被 WebGL 读取，脚本会提示“视频源跨域”并停用。
- 原生视频元素全屏（`video.requestFullscreen()`）时无法叠加滤镜；容器全屏可以。
- 不处理 DRM/EME 内容；HDR/杜比识别是清晰度文案启发式，可能漏判。
- 画中画、截图等原生能力使用隐藏后的`<video>`，可能拿到未滤镜画面。
- B 站小窗/迷你播放器不在支持范围内（脚本会跳过）。
- 嵌入 iframe 的播放器由 iframe 内的脚本实例处理，配置按iframe自身的域名保存。

## 配置作用域

| 页面                                  | profile           | 默认开关 |
| ------------------------------------- | ----------------- | -------- |
| `www.bilibili.com` （普通视频）       | `video`           | 关闭     |
| `www.bilibili.com/bangumi/*` （番剧） | `bangumi`         | 开启     |
| `player.bilibili.com` 嵌入播放器      | `video`/`bangumi` | 同上     |
| 其他任意站点                          | `site:<hostname>` | 关闭     |

## 开发与测试

脚本无构建步骤，直接编辑`Bilibili-Anime4K.user.js`即可。

本地验收需要Node 20+、Windows、Edge（测试工具通过 CDP 驱动无头 Edge）：

```powershell
node tools/test-runner.mjs
```

它会启动本地静态服务器，依次加载：

- `/video?...&bilia4k-test-profile=video`：B 站普通视频 profile（bpx 假播放器）
- `/bangumi/play/ep1?...&bilia4k-test-profile=bangumi`：番剧 profile
- `/video?...`：其他站点 profile（同一个 bpx 假播放器，验证域名配置）
- `/generic`：无 bpx 类的通用 `<video>`，验证任意站点路径、固定 UI、原生控件提示、滚动跟随
- 再次加载视频页与站点页，验证按 profile / 按域名持久化

覆盖：三种模式出帧、次要模式、S/M 档位、面板点击、tooltip、统计条、滚轮拦截、缩放重排、按钮命中、HDR 拦截、双 profile 与按域名隔离。

截图输出到 `test/out/`，终端打印 PASS/FAIL。Edge 不在默认路径时用环境变量覆盖：

```powershell
$env:EDGE_PATH = "D:\Edge\msedge.exe"
node tools/test-runner.mjs
```

测试视频由 ffmpeg 生成（仓库已有 `test/test.mp4`，需要重新生成时）：

```powershell
ffmpeg -y -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=6" `
  -vf "drawbox=x=0:y=0:w=256:h=144:color=red@1:t=fill" `
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart test/test.mp4
```

### 其它调试工具

- `node tools/inspect-bili.mjs [url]`：无头 Edge 打开页面并 dump 播放器 DOM；
- `node tools/debug-geom.mjs`：检查画布/播放器几何与重排结果。

## 致谢

- [bloc97/Anime4K](https://github.com/bloc97/Anime4K)：算法与 GLSL 管线（MIT）
- [NeuroWhAI](https://github.com/NeuroWhAI)：Anime4K WebGL 实现
- [net2cn/Bilibili_Anime4K](https://github.com/net2cn/Bilibili_Anime4K)：B 站用户脚本基线（MIT）
- [Tampermonkey](https://www.tampermonkey.net/)

## 许可证

[MIT](./LICENSE)

---

> [!WARNING]
> 本项目为非官方增强工具，与哔哩哔哩及 Anime4K 官方无隶属关系。仅对浏览器内已渲染画面做前端处理，不下载、不破解、不绕过付费或 DRM。使用产生的画质、性能与账号风险由使用者自行承担，请遵守目标站点服务条款及所在地法律。
