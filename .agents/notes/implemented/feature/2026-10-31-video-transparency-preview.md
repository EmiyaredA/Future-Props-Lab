# Agent Note: 视频格式与透明衬底检查

Status: implemented

## Problem

视觉工坊的固定深色预览难以检查透明素材边缘；GIF 视频上传仅保留黑底 MP4，透明信息无法用于后续预览。文件后缀和 FFprobe 普通像素格式不足以识别 WebM Alpha。

## Decision

只读媒体信息接口由 asset_store 校验 Workspace，media_rendering 在 30 秒内探测容器、编码与 Alpha 声明。WebM `alpha_mode=1` 优先于普通 `yuv420p`。通道存在只说明文件结构，不代表边缘质量。

GIF 上传在同一个 120 秒转换预算内生成黑底 MP4 与透明 VP9 WebM。完成所有转换、落盘和校验后，才将两个暂存素材、输出版本和画布 CAS 放入短事务。检查素材由可空 `inspection_asset_id` 关联，迁移只追加列；引用保护、导入导出保留关联，旧快照按空值处理。AssetLibrary 的延迟持久化选项让多文件用例能先完成 I/O 再统一写数据库。

Web 看板本地保存衬底颜色，播放器保持相同 source 与 DOM，换色不重置播放进度。现有透明视频直接播放；GIF 检查视频优先预览，失败后用户可显式查看 MP4。格式分别标明原输出与检查视频。下载、引用、取帧和自动验收仍使用 canonical `asset_id`。

## Alternatives considered

- 只改播放器 CSS：无法恢复旧 GIF 转成 MP4 时已丢失的透明信息。
- 用透明 WebM 替代原输出：会改变既有下载与下游视频格式。
- 直接播放原 GIF：无法暂停及拖动进度检查指定时刻。

## Consequences

GIF 上传增加一份检查视频及相应存储和编码成本；转换失败不会留下单份素材或不完整版本。旧黑底 MP4 无法逆向恢复透明信息，需重新上传原 GIF。预览背景不产生新输出或项目写入。

## Verification

- API／像素测试覆盖透明 GIF 双素材、帧延时、末帧、并发冲突、失败清理、检查素材引用保护和快照恢复。
- 媒体信息测试覆盖 WebM Alpha 优先级、无 Alpha、未知格式及跨 Workspace 404。
- Web 组件与浏览器旅程验证背景切换不重置播放、格式显示、失败回退、实际透明像素、明暗主题和全屏。
- 实现前只读检查样片项目的 29 个已通过节点最终输出，共 6,960 帧，全部含真实透明像素；检查未修改运行数据。
- 最终功能测试 52 项通过，SQLite／SDK／operation／节点状态兼容测试 31 项通过；Chrome 明暗主题旅程 2 项通过。全量 Web 2,973 项通过，3 项既有的面试助手文档覆盖测试失败。
- OpenAPI、Web 类型和 SDK 代码生成检查通过。完整 SDK 文档检查要求重写受保护的文件参考正文及配套覆盖清单；遵守保护规则保留该正文，接口说明维护在 `docs/reference/api.md`。全仓库另有既有跨 feature 导入、lint／格式和 Galgame CSS 预算门禁失败，未扩展修改范围。
