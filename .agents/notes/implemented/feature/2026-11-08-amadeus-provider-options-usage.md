# Agent Note: Amadeus 模型配置、用量与会话事件

Status: implemented

## Problem

同一模型在 OpenCode、DeepSeek Harness 和 Codex 有各自的运行选项。把 CLI 输出拼成一条消息会丢失文字和工具之间的顺序，也让用户难以核对当轮用量。

## Decision

选项来自已隔离的 CLI 目录，随每轮运行快照经网站执行器或独立 Mac Worker 传入 CLI。OpenCode 复核原始变体 ID，Harness 先确认 ACP 模型再确认推理档位，Codex 复核模型与专用登录。选项失效时在发出提示前停止。用量使用稀疏快照，步骤增量去重累加，累计值和上下文快照取最新。

Web 参考 Happier `a2c45c86804b` 的折叠思考行和连续工具组。持久事件能完整复原回复时按序分段，展开状态按账号、会话和事件标识保存。现有运行快照与整段回复提供历史和继续执行所需的数据。

## Alternatives considered

直接导入 Happier 会话协议会改变 FPL 的账号、权限和恢复边界。按现有 FPL 事件投影视图可以共用独立页面和工坊侧栏。根据文本估算 Token 无法还原提供方的缓存、工具输入和上下文占用。

## Consequences

当前变更无需数据库迁移。未提供用量的历史轮次仍可读。前端、Amadeus、Agent Runtime 及两套独立 Mac Worker 以同版切换，回退用对应的上一版构建和进程。

## Verification

假 CLI 覆盖目录、原生参数、过期选项、用量与独立 Worker 的运行快照。浏览器使用隔离账号和确定性事件验证独立页、分屏、窄屏、展开状态与刷新去重。
