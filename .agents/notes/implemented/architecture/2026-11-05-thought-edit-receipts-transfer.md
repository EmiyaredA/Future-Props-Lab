# Agent Note: 思绪工坊文档编辑回执迁移

Status: implemented

## Problem

旧站的文档编辑回执与其他工坊回执存于同一表。切换后，重试旧请求需要返回当时结果，并能拒绝相同请求标识对应的不同操作。

## Decision

只迁移 `thought` 分区，保留请求标识、指纹、结果及记录时间。文档 ID 和按 UTF-8 字节编码的请求标识组成稳定分页游标。目标写入校验文档属于该账号并且历史回执的修订不超出文档当前修订。

## Alternatives considered

直接复制整张回执表会携带其他服务的数据。用冒号直接拼接请求标识会限制已有请求中的标点和 Unicode。

## Consequences

同一批次重放返回原迁移回执。应用重试同一编辑请求返回旧快照，不推进文档版本。服务归属覆盖按分区统计。

## Verification

`tests/test_thought_cutover_transfer.py` 从旧站 HTTP 创建带中文和标点的请求标识，并验证恢复旧站、跨账号拒绝、重启重放和同标识变更冲突。
