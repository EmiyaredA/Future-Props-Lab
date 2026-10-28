# Agent Note: AutoDL 视频工作流接入

Status: implemented

## Problem

AutoDL 的视频生成接口以固定工作流标识接收参数和参考素材。不同工作流对输入素材、提示词、时长、比例、分辨率及随机种子的要求并不相同，直接把它们当作通用视频模型会导致无效请求，也无法在模型目录、测试台和视觉创作工坊中一致地呈现能力。

## Decision

AutoDL 使用独立的 `autodl_video` provider kind。`autodl_workflows` 明确登记可用工作流及其能力，统一校验并规范化请求，再将参考素材和参数映射为 AutoDL 工作流请求。模型目录、模型测试和视觉创作工坊共用视频能力契约；任务提交和轮询由 generation runtime 路由到 AutoDL 适配器。SQLite 对 provider kind 的约束通过新增的 `0113_autodl_video` migration 演进。

## Alternatives considered

- **复用现有 Seedance 或 Zealman provider kind** — AutoDL 有独立的认证、请求格式、任务状态和工作流参数；复用会混淆供应商边界并使参数校验依赖隐式模型名判断。
- **运行时从 AutoDL 拉取工作流目录** — 当前支持集合按代码固定登记，运行时目录发现会令目录展示和已提交任务行为依赖外部目录变化。

## Consequences

- **收益**：不同入口使用同一组工作流约束；新增或调整工作流可在明确的适配边界内完成。
- **代价与已知上限**：支持的工作流标识和参数映射需要随 AutoDL 接口变化维护；参考素材请求体限制为 64 MB，素材合计限制为 45 MB。

## Verification

完成 OpenAPI 与 Python SDK 生成物更新，并通过 `git diff --check`。迁移行为及 provider 请求行为仍需由对应的隔离数据库和确定性测试覆盖；本次提交前未运行测试套件。
