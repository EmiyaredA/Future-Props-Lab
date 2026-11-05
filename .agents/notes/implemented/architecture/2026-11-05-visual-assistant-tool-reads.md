# Agent Note: Visual 助手的工具契约和只读范围

Status: implemented

## Problem

Visual 独立进程无法沿用兼容站中直接读取素材与模型目录的工具处理器。两套入口仍需使用相同的工具参数、审批摘要和画布操作语义。

## Decision

共享与存储无关的工具定义和画布变换。独立工具从 Visual 自己读取画布和任务，由 Assets 返回有项目归属的素材，由 Models 返回有账号归属的生成选项。素材查询授权匹配请求项目、对话、查询类型和请求摘要。

## Alternatives considered

共享 ORM 会把素材和模型的存储结构变成 Visual 的内部依赖。另定义工具名称或参数会改变已有对话中的模型调用和审批反馈。

## Consequences

旧工具处理器继续使用兼容站的应用边界，独立处理器只读取所属服务或经 Identity 授权的投影。

## Verification

验证原助手、独立附件读取、项目素材筛选和跨项目拒绝、模型目录协议与架构门禁。
