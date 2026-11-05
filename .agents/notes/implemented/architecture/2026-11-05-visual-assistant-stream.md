# Agent Note: Visual 独立助手的消息流与审批

Status: implemented

## Problem

Visual 独立进程需要保留已发布的流式事件、审批、画布与生成工具，并在服务重启和会话撤销时保留一致的用户消息与调用日志。

## Decision

Visual 用应用内审批队列运行原六个工具和原 SSE 封装。模型轮次和日志由 Models 持有。公开流持续复核当前会话，撤销后取消待执行动作。异常断开时提交本地消息决议，待确认的模型日志由源运行结算器重放。Visual 就绪检查要求全部登记路由、配套浏览器构建、私网配置和后台执行器。

## Alternatives considered

在网关将助手请求退回兼容站会把用户历史和正在写入的画布分到两处。由 Models 编排画布工具会跨越项目归属。

## Consequences

原消息与审批 URL、操作 ID 和事件版本保持兼容。流可直接呈现持久动作状态；模型日志回执中断后可继续恢复。

## Verification

隔离测试通过真实 SSE 帧和审批 HTTP 验证批准写入、错对话、陈旧画布、权限撤销和 Models 日志。旧站与服务目录的公共契约继续使用同一份 OpenAPI。

同一候选的六个服务镜像加封闭供应商夹具在独立 Compose 项目启动，Chromium 提交并批准画布写入，Visual、Models 与 Identity 重启后读回同一画布和历史。
