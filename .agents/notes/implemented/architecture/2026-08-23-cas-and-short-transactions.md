# Agent Note: Revisioned 资源使用 CAS 与短事务

Status: implemented

## Problem

文档、画布、时间线和账号治理都允许并发编辑，静默覆盖会损坏内容和权限状态。

## Decision

整体 JSON、配置、会话和项目记录使用 revision CAS；缺少 revision 返回 422，冲突返回 409 和当前快照；外部网络、大文件 I/O 和模型请求不进入已经开始写入的长事务。

## Alternatives considered

- **最后写入者覆盖** — 实现简单，但会静默丢失并发编辑。
- **持有长事务等待外部操作** — 能保持单次提交语义，但会放大 SQLite 锁竞争和失败范围。

## Consequences

- **收益**：冲突可观察、可恢复，SQLite 写锁范围受控。
- **代价与上限**：调用方必须处理 409；复杂合并由各功能定义。

## Verification

`backend/app/runtime/` 拥有公共原语；账号、项目、画布和文档测试覆盖冲突行为。

