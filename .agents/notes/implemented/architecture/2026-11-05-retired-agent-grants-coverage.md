# Agent Note: 旧 Agent 授权分区的回滚归档

Status: implemented

## Problem

账号迁移会生成旧版 Agent 用途授权分区。现行应用已经通过部署 TOML 和当前业务权限判定连接可用性。迁移覆盖检查仍要求传输旧分区，并且未确认默认模型设置的账号是否在计划内。

## Decision

验证已登记的旧 Agent 记录形状，随封存数据库保留。覆盖报告只输出计数和保留位置。确认默认模型设置的账号属于迁移计划。未知键和不符合旧格式的记录继续阻止通过。

## Alternatives considered

将旧授权写进当前 TOML 会改变部署启用策略。无条件忽略该键会隐藏异常历史记录。

## Consequences

归档保留原旧站的回滚数据。现行授权仍由部署配置、账号状态和业务权限决定。

## Verification

`tests/test_website_legacy_snapshot.py` 核对有效旧授权、未知设置、计划外账号、快照覆盖报告及隔离旧站恢复。
