# Agent Note: 剪辑工坊素材监视器

Status: implemented

## Problem

素材区只能双击上时间轴，无法先单独播放查看视频/音频内容。中间监视器固定为节目（时间轴合成）视图，用户缺少 Source 预览入口。

## Decision

单击就绪素材时，中间窗口切到「素材监视器」：用独立 playhead/playing 播放该素材（视频优先 `proxyUrl`），不改动时间轴 playhead。标题提供「素材监视器 / 节目监视器」切换；时间轴 scrub 或选中片段时退出素材模式。双击仍只负责添加到时间轴。

素材播放只在用户 scrub / 换素材时写 `currentTime`；播放中 playhead 只跟媒体时钟，禁止用 React playhead effect 回写 seek。否则 rAF 更新 playhead 会打断刚发起的 `play()`（AbortError 被吞），表现为要点好几下。片尾再点播放先回到 0。

## Alternatives considered

- **弹窗/模态预览** — 实现快，但挡住时间轴与剪辑控件，打断 NLE 节奏；中间区已是最大预览面。
- **永久双监视器（Source + Program 并排）** — 符合桌面 NLE，但当前工作区已挤，会压缩节目预览与属性面板；未做，可后续再开。
- **素材行内嵌迷你播放器** — 列表密度差、音视频控件难共用，且与节目画幅参考无关。
- **播放中用 playhead effect 双向同步 currentTime** — 与节目监视器 ProxyVideo 类似，但素材监视器没有 clip 源时间映射，rAF 写回 playhead 会立即 seek 打断 play。

## Consequences

- **收益**：选材时可先审片再上轨；节目 playhead 不被素材 scrub 打乱；播放按钮一次即可开始。
- **代价**：同一时刻只能看素材或节目其一；键盘 Space/逐帧在素材模式下由素材监视器 capture 接管。

## Verification

- `web/tests/video-editor-source-monitor.test.tsx`：单击进入素材监视器、切回节目、双击仍添加、隐藏节目专用控件；播放不回写 currentTime；片尾播放从 0 重来。
