# Agent Note: Codex app-server 专用登录

Status: implemented

## Problem

Codex 0.166.0 的 app-server 拒绝用于 exec 的隔离参数。进程提前退出后，连接检测异常中断整个编程智能体列表。

## Decision

app-server 使用独立的服务账号凭据目录和临时工作目录。启动只监听 stdio，关闭个人工具与技能发现，并在建立线程前校验只读沙箱、审批策略及 MCP 配置。云控工具依据已授权的项目记录访问选中的文件夹。单个检测异常由对应连接返回。

## Alternatives considered

切换稳定版并保留原 app-server 参数仍不能启动。沿用个人配置目录会重新引入个人规则与工具。

## Consequences

管理员在服务所在 Mac 单独登录一次。会话任务和模型探测共用该登录。独立的 exec 路径仍保留原来的隔离参数。

## Verification

隔离 API 测试覆盖 Codex 提前退出时返回完整列表、项目目录边界及审批写入。真实 CLI 只执行握手、策略检查和模型列表探测。
