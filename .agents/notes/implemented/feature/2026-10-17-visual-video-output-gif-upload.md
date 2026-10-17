# Agent Note: 视频节点输出版本接受 GIF

Status: implemented

## Problem

视觉工坊看板的视频节点「上传版本」只允许视频 MIME，后端也按视频扩展名校验。用户已有的 GIF 动画无法作为该节点的输出版本保存；仅修改文件选择器仍会在服务端失败。

## Decision

视频版本上传额外接受 GIF，服务端在数据库写入前验证大小、签名和画布尺寸，通过公共 `media_rendering/animated_image.py` 转为单次无声 H.264 MP4。以 GIF 原生百分之一秒网格输出，重复显示同一原帧以保留各帧时长及最后一帧停留，不插值生成动作，不展开循环次数。透明区域使用黑底，奇数画布向右／下补齐至偶数。

视觉工坊 `outputs/video_uploads.py` 只拥有 IncomingFile 适配、有界临时文件及错误映射。转换结果继续走 AssetLibrary 和 NodeOutputs 的同一素材／版本 CAS 事务，保持 video 素材、输出与节点类型一致，预览、取帧、引用和快照沿用已有契约。图片节点保留原 GIF，音频节点继续拒绝 GIF。multipart 字段、响应 schema 与数据库结构不变。

输入和输出都受现有上传大小限制，画布最长边 8192、总像素 16777216，编码超时 120 秒。编码错误、超时与取消终止进程并清理临时文件；CAS 冲突回滚且清理本次托管文件，不自动重放上传。Web 显示格式转换提示、上传中禁用及错误反馈。

## Alternatives considered

- 只放宽 accept：后端仍拒绝，也不能让 video 元素解码 GIF。
- 将 GIF 原文件登记为视频：会破坏素材类型与节点、模型输入和取帧的契约，要求所有消费者理解特殊图片格式。
- 直接以可变帧率重封装：编码器丢失 GIF 最后一帧时长，三帧 600ms 样本缩短为 500ms；使用百分之一秒显示网格保留完整时长。

## Consequences

视频节点可直接上传 GIF 并沿用已有视频功能。代价是转换等待及不保留透明通道／循环元数据；界面与指南明确说明，保留原 GIF 可使用图片节点。转换不占用数据库写锁，用户并发编辑仍获优先保护。

## Verification

- `tests/test_visual_gif_uploads.py`：真实 GIF 解码、逐帧停留与末帧、单次时长、奇数画布、音轨缺失、图片原文件保留、损坏／超限／缺少工具／超时、转换中并发编辑和进程取消清理。
- `tests/test_visual_node_outputs.py`：原输出历史、最终选择、分页、CAS 与素材类型保护。
- `web/tests/visual-output-gif-upload.test.tsx`：GIF 文件选择、传递原文件及保存后的 revision、错误反馈与手动重试、其他类型的选择限制。
- `web/e2e/visual-output-gif-upload.spec.ts`：真实隔离服务的明暗主题文件选择、上传、视频时长与播放、刷新后最终版本保留，2 项通过。截图在 `.local/visual-gif-upload/e2e/results/`。

2026-10-17：GIF 专项后端 14 项、原输出 API 18 项、相关 Web 组件 19 项通过。原绿幕 GIF 实测转换后为 1344×768、7.29 秒，完整动作与绿幕保留。根 lint、生产构建、契约生成与 SDK stale-check、官方导入包生成与校验、Note 与文档中心保护检查通过；变更文件格式检查通过。

范围外已有失败保留：架构检查的 `HomeHeroPet.tsx` 两个 desktop-pet 内部导入，以及根格式检查中 `web/src/docs/styles-components.css`、思绪工坊 `help.md` 的格式差异。本次不修改这些文件。
