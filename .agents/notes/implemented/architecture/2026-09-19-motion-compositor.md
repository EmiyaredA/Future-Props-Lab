# Agent Note: 独立动效合成项目与确定性透明交接

Status: implemented

## Problem

视频剪辑工坊适合排列成片，但缺少逐帧二维合成、贝塞尔路径遮罩和可复用的透明镜头。直接把这些状态塞入现有剪辑时间线，会让合成工程与成片剪辑共享不适用的编辑契约。

## Decision

`apps/motion_compositor/` 独立拥有项目、revisioned 文档、请求 ID 幂等批次、素材副本、工程包和导出任务。每个持久根资源保存 Workspace 归属；业务接口只从 `StudioPrincipal` 得到 Workspace。图层关键帧与遮罩关键帧记录相对于图层开始帧的局部帧，浏览器 PixiJS 画布负责流畅交互，`capabilities/media_rendering/motion_frames.py` 负责精确停帧和导出的同一 RGBA 画面。普通 MP4 将透明区域合成到画布底色；MOV 和 PNG 序列保留透明通道，用户放入的背景图层仍参与渲染。首版不含声音编辑，导出无声。

导出任务保存不可变文档快照，后台执行器从任务记录恢复 Workspace，并可将中断的运行任务重新排队。只有完成的 MP4 或 MOV 能通过 `apps/video_editor/motion_handoff.py` 公共入口交接；该入口复制媒体到剪辑项目并追加新的画面轨道。透明 MOV 的剪辑预览使用保留 Alpha 的 WebM 代理。这一交接是两个 App 之间明确登记的例外，与[共享媒体渲染决定](../architecture/2026-08-24-media-rendering-and-video-handoff.md)保持一致。

## Alternatives considered

- **扩展视频剪辑工坊时间线**：可复用现有媒体导入和轨道 UI，但遮罩控制点、逐帧路径和透明合成会污染剪辑文档及渲染职责。
- **由浏览器录屏导出**：所见即所得且实现快，但透明通道、精确停帧和任务恢复无法由服务端一致验证。

## Consequences

- **收益**：合成工程可以独立保存、打包、按 Workspace 隔离，并通过同一帧求值器生成三种输出；剪辑工坊只接收完成的媒体。
- **代价**：浏览器预览与服务端渲染要维护相同的图层语义；导出需要 FFmpeg 与额外磁盘空间，视频素材逐帧取样在长镜头中仍有性能上限。

## Verification

临时数据库测试覆盖 migration、Workspace 隔离、revision 冲突、幂等重放、遮罩动画、精确帧与 PNG 序列逐字节一致、透明 MOV 像素格式，以及透明 MOV 交接和剪辑代理生成。架构检查守住跨 App 边界，Web 构建与浏览器旅程验证可操作界面。
