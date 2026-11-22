# Agent Note: 分镜与画布显示视频缩略图

Status: implemented

## Problem

视频输出已有素材，但分镜列表的 compact 预览不请求视频；画布也只在播放时读取视频内容。
因此两处长期显示视频图标，无法靠画面识别镜头，容易被误认为没有关联结果。

## Decision

复用正式 `/v1/files/{id}/thumbnail` 的既有视频抽帧、账号授权、尺寸限制与版本缓存。
分镜列表使用 320px 封面，非播放画布使用 640px 封面，通过既有可见性钩子按需读取。
用户点击播放后仍使用原视频内容与播放器；不以完整视频下载来填充静态列表。
已有关联输出优先于生成参考，没有输出的草稿可以显示其视频参考封面；两者使用不同辅助文字。

“纳入已有视频”和“关联已有视频”候选条目显式提供当前节点 asset_id 的缩略图路径，
复用 SearchablePickerDialog 的可见性延迟读取。已纳入而禁用的条目仍显示封面；无输出草稿保留视频图标，
不把参考输入当成已生成的视频输出，也不改变条目的可选状态、搜索、纳入或关联规则。

## Alternatives considered

- 在每张卡片挂视频播放器：会并发读取完整视频，资源使用随节点数量增长。
- 浏览器逐个下载视频并抽帧：重复已有后端能力，也无法复用服务端的版本化派生缓存。
- 新建封面字段或维护脚本补写素材：无需新增持久状态，既有接口已可按需生成。

## Consequences

只调整前端读取方式，不改变原视频、节点、输出版本或分镜文档。不新增接口和存储结构。
缩略图失败维持不可用反馈，不自动降级下载完整视频。Blob URL 与可见性继续由公共钩子管理。
遵循[能力实现契约](../../../../docs/architecture/capability-contracts.md)的账号和分镜引用约束、
[开发与验证流程](../../../../docs/operations/development-workflow.md)的相关行为验证规则。

## Verification

- `web/tests/features/visual-video-thumbnails.test.tsx` 覆盖可见性延迟、缩略图读取、播放切换、
  草稿参考、失败反馈及缺少输出，不允许静态预览请求完整视频。
- 既有画布视频测试继续覆盖拖动、播放控制与导出当前帧。
- `tests/apps/asset_library/test_file_content_previews.py` 验证现有视频封面、缓存、账号隔离和异常清理。
- 实际项目检查分镜列表七张封面及画布封面加载，确认十秒视频仍可加载到播放器。
  浏览器证据保存于忽略的 `.local/video-thumbnails/`。
- `web/tests/features/visual-storyboard.test.tsx` 覆盖纳入／关联弹窗的真实输出、禁用条目及无输出草稿，
  确认只请求128px封面，不因预览保存分镜；与选择器及既有封面回归共18项通过。
- `web/e2e/visual-storyboard-picker-thumbnails.spec.ts` 使用隔离上传的真实视频验证抽帧、图片解码、
  桌面／窄屏明暗主题及取消不保存，不读取完整视频；证据位于 `.local/storyboard-picker-thumbnails/`。
