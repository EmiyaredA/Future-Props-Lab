# Agent Note: AutoDL zealman 工作流接入

Status: implemented

## Problem

AutoDL 部署的 zealman 工作流使用独立的异步 HTTP 协议；已有 ZEALMAN 面板协议不能调用这些服务。
工作流包含纯文本、参考素材、首尾帧、音频同步和动作迁移，使用同一套固定表单会发送不支持的参数，
或拒绝供应商实际支持的无图、纯音频和无提示词输入。

## Decision

新增 `autodl_video` 协议。`llm/providers/autodl_workflows.py` 固定登记 2026-10-28 页面上署名
zealman 的 12 个工作流，拥有参数、素材、默认值、尺寸组合和种子范围；`autodl_video.py` 负责原始
Authorization Token、任务提交和轮询。它与已有自建 ZEALMAN 面板接入各自保留协议边界。

测试台、独立推理和视觉创作工坊通过统一视频能力与请求归一化契约接入，使用 Base64 直接发送素材，
并继续复用 GenerationTaskDriver 的提交中断、下载重试与任务恢复规则。任务和调用日志只保存素材 ID
与业务参数。种子在准入时生成一次并快照。首尾帧画布输入保留 CAS 与连线快照，并按明确角色或输入顺序装入两个槽位。

迁移 0113 只扩展连接和任务类型约束，保留索引、历史记录、外键与执行信息。视频提示词及其版本支持
20000 字符，图片和音频草稿保留原有限制。960p 横屏在官方枚举确认前不开放。

## Alternatives considered

- 复用自建 ZEALMAN 协议：上传接口、鉴权、提交字段和结果状态均不同，会破坏原协议的边界。
- 将原始工作流字段交给前端或允许任意 JSON：会使三个入口的权限、素材校验和模型能力发生分歧。
- 运行时抓取模型列表：网页不构成稳定 API，新增工作流需要显式核对和验收。

## Consequences

模型管理提供 12 个固定预设。FLAC、WebM 和无提示词工作流拥有对应输入校验；上游临时结果立即归档。
参考素材沿用应用大小限制；真实供应商联调需要有额度的 ComfyUI Token，确定性验收不产生供应商费用。
迁移不创建业务连接或模型；当前工作空间必须通过模型管理正式接口添加连接及预设，Token 由用户在应用内填写。
预设名称和说明沿用 AutoDL 工作流页面原文，选择预设会填入名称与说明，官方工作流 ID 保持独立且原样发送。
工坊模型菜单使用 320px 最小目标宽度并受可视边界约束，选项保留间距、左对齐和单行省略，避免看板按钮样式覆盖。
视频模型菜单第二行展示原始模型／工作流 ID，官方工作流描述保留在模型服务的说明字段。
视频参数使用模型能力限定的时长滑杆，保留自动时长、音频截取标签与草稿提交规则；动作迁移继续隐藏时长。比例与清晰度菜单按触发控件宽度定位，固定定位菜单不使用相对于视口的百分比最小宽度。
模型编辑弹窗按基本信息、支持能力、用途和启用状态分区；独立滚动容器承载表单，保留 fieldset 的保存期间禁用规则，标题和操作栏不随正文滚动。

## Verification

- `uv run pytest -q tests/test_autodl_video.py tests/test_autodl_migration.py`
- `npm run test --workspace web -- tests/autodl-generation.test.tsx tests/seedance-generation.test.tsx`
- `npm run contracts:check`、`npm run sdk:check`，以及仓库测试、lint、格式与构建门禁。
