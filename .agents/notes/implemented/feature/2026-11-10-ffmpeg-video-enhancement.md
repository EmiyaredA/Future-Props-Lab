# Agent Note: FFmpeg 本地视频清晰增强

Status: implemented

## Problem

768p 影片只需轻度提高清晰度并交付 1080p 时，RelayVSR 的逐帧推理开销超过用户可接受范围。用户仍需要在本地模型页管理入口，在模型测试页查看分段结果。

## Decision

桌面模型目录提供 `ffmpeg-video-sharpen`，由管理员启用并按空间接入。宿主需提供 FFmpeg、ffprobe 和 VideoToolbox H.264 编码器，配置不含可下载权重。任务在已有视频增强队列中按固定配置运行，最长每 240 帧发布一段。单个滤镜图输出 Lanczos 等比放大和轻微锐化两份对比素材，整片从源文件封装音轨。

迁移 `0128_local_video_providers` 扩展模型连接类型约束，保留已存连接、索引及关联。两种视频增强均由桌面网站装配，沿用本机 Session 和账号媒体边界。

## Alternatives considered

单独处理整片能少做几次封装，但无法复用已完成片段的检查点与边处理边预览。RelayVSR 提供模型超分能力，保留其独立的 Metal 验收条件。

## Consequences

快版只做重采样和轻锐化，可使轮廓更清晰，实际细节受原始素材限制。暂停时丢弃当前未发布片段，继续从检查点开始。正式启用前需要按部署流程应用迁移。

## Verification

实机短样对比核对帧率、尺寸和音轨。合成视频经 VideoToolbox 验证跨片段合成。自动测试覆盖模型启用、接入、对比预览和旧目录迁移。
