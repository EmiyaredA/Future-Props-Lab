# Agent Note: 本机模型安装状态与操作回执迁移

Status: implemented

## Problem

本机模型安装记录和操作回执归整个部署。旧站曾将清理失败写入错误回执，独立服务重放时只解析成功结构。旧站中断的安装也没有新版原生队列的对应命令。

## Decision

使用迁移运行分区传输安装和操作，按型号与请求标识分页并保留原回执。读取安装操作时保持原有成功或错误结果。启动恢复只结束找不到对应未结算原生命令的安装。

## Alternatives considered

为部署状态分配账号会改变数据归属。重试旧安装会缺少原生签名和当前用户授权。仅凭数据库安装状态也无法证明 Mac 权重可用。

## Consequences

安装状态和回执进入 Models 自有数据卷。模型原件和运行环境继续由 Mac 持有，文件校验与合成须在恢复目录验收。

## Verification

`tests/test_model_governance_transfer.py` 覆盖迁移运行分区、Unicode 请求标识分页、原错误回执及重启重放。`tests/test_native_models.py` 验证中断恢复、持久任务保留及旧错误回执重放。

在隔离模型副本用 Apple Silicon 实际合成 Qwen3 TTS 0.6B。核对权重及结果摘要，得到 24 kHz、2.16 秒 WAV。该演练直接运行 Mac 执行端，授权传输由协议回归覆盖。
