# Agent Note: 实时语音仅作为模型测试能力

Status: implemented

## Problem

实时语音容易扩展成 Bot、电话或持久会话系统，超出当前单机管理台范围。

## Decision

实时语音只用于模型测试；通话状态、转写和音频保留在浏览器与连接内存中，日志只保存时长、字符数、延迟、usage 和状态。

## Alternatives considered

- **持久化语音会话并提供 Bot 编排** — 能力更完整，但会引入长期会话和 Bot 运行时。
- **接入电话或本机采集设备** — 使用场景更广，但超出当前模型测试边界。

## Consequences

- **收益**：数据保留和隐私边界简单。
- **代价与上限**：无法恢复历史通话；未来扩展必须另立数据模型。

## Verification

运行实时语音页面、WebSocket 会话和 Mock 工具测试。

