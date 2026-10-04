# 日晖俱乐部 · Delta Force Club Hub 影像工程

一支 168 秒、1920×1080、60 fps 的中文产品纪录短片。画面由 Remotion 生成；其中的后台截图来自本仓库实际运行的页面，订单、结算数字来自新建的**本地隔离 D1 演示库**，不访问线上数据库。`video/video-plan.md` 记录了先行的故事板、源码依据和可核验的 Git 里程碑。

## 一键重新生成

在仓库根目录使用 Node.js 22+、Windows PowerShell、Chrome，并预先安装根目录和 `video/` 的依赖：

```powershell
npm install
cd video
pnpm install
cd ..
npm run video:render
```

脚本会重新构建现有产品、在全新本地 D1 中运行原有 migrations、通过实际界面下单和结单并截图，然后生成原创配乐／音效／中文旁白／字幕、渲染无旁白版，并混音导出正式版。不会改变本地产品的常用 D1 数据；录制产生的临时库留在已忽略的 `video/.local-state/`。

主要交付物：

- `output/Delta-Force-Club-Hub_documentary.mp4`：中文旁白、音乐、音效；
- `output/Delta-Force-Club-Hub_no-voice.mp4`：只有音乐、音效，便于重新配音；
- `subtitles.srt`：与旁白对齐的字幕；
- `narration.md`：全片逐段旁白与时间码；
- `public/data/demo-data.json`：本地演示订单与财务结果，供画面复核；
- `public/captures/`：真实界面截图。
- `qa-report.md` 与 `output/qa-contact-sheet.jpg`：最终编码、财务与画面抽样验收记录。

若系统没有 Chrome，可通过 `VIDEO_BROWSER_PATH` 指向兼容浏览器。Windows 内建中文 SAPI 声音用于离线旁白；可用 `VIDEO_VOICE_WAV` 替换为完整、44.1 kHz 单声道 WAV 的自录旁白。`VIDEO_CONCURRENCY` 默认 4；内存不足时设为 2。仅调试视频设计时，可执行 `node video/scripts/render.mjs --reuse-assets` 复用已有取景与音频，或分别设置 `VIDEO_SKIP_CAPTURE=1`、`VIDEO_SKIP_AUDIO=1`。

## 分镜与事实依据

| 时间 | 内容 | 素材依据 |
| --- | --- | --- |
| 00:00–00:10 | 一笔订单的路径 / 标题 | 设计动效 |
| 00:10–00:28 | 项目生长时间线 | 当前仓库的真实 Git 提交 |
| 00:28–00:42 | 六模块系统关系 | 当前页面结构 |
| 00:42–00:56 | 服务价格、分配与抽成规则 | 真实价格表截图与本地菜单配置 |
| 00:56–01:08 | 下单确认与价格快照 | 真实接单台、弹窗、订单数据 |
| 01:08–01:23 | 双人派单与忙碌锁 | 真实打手看板及订单 |
| 01:23–01:33 | 多页面同步 | 三张实际后台截图 |
| 01:33–01:59 | 逐人结算、工资、俱乐部抽成、即时打赏 | `lib/settlement.ts` 与本地 D1 结果 |
| 01:59–02:15 | 工资独立周期 | `lib/payroll-settlement.ts` 与真实结算记录 |
| 02:15–02:30 | 经营数据回流 | 实际总览截图与订单聚合 |
| 02:30–02:40 | 六模块快切 | 实际页面截图 |
| 02:40–02:48 | 品牌收束 | 设计动效 |

演示服务「护航双排」¥360，两人各占 50%、统一抽成 10%：每人订单工资 ¥162，俱乐部 ¥36。两名打手各自获得 ¥20 即时打赏，不进入工资周期。所有数字在采集脚本中会与实际本地订单结果断言核对。

## 工程文件

`src/film.tsx` 是十二幕分镜；`src/visual.tsx` 处理镜头、背景、线条与数字动画；`scripts/capture-site.mjs` 负责隔离库与真实 UI 取景；`scripts/generate-audio.mjs` 生成原创声音；`scripts/render.mjs` 是唯一入口。视频素材和构建输出均可重建，不需要提交大体积 MP4 到 Git。

渲染后执行 `cd video; npm run qa` 可检查两版视频的编码、时长与字幕数，并生成 `output/qa-contact-sheet.jpg` 供整片逐段目视检查。
