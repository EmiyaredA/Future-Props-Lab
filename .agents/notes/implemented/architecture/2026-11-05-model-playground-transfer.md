# Agent Note: 模型测试对话和附件原件迁移

Status: implemented

## Problem

模型测试消息和附件通过所属对话获得账号归属，附件可作为草稿或关联具体消息。既有附件下载与删除没有在同一查询中验证对话账号。

## Decision

依次迁移对话、消息和附件，导入时核对模型和所属对话，确认已发送附件的消息属于同一对话。附件原件沿用 Models 的持久回执流程，以独立清单校验原标识、大小和 SHA256。日常读写按附件、对话与账号同时查询。

## Alternatives considered

仅复制附件目录无法校验消息绑定和草稿归属。为附件重建消息关联会丢失历史位置。

## Consequences

保留对话版本、消息排序、已发送附件和草稿。启动恢复取消中断的回复并保留部分正文。已识别的上传暂存和可重建预览保留在回滚快照。

## Verification

`tests/apps/model_service/test_model_playground_transfer.py` 验证错误消息关联拒绝、跨账号下载和删除拒绝、附件摘要、重启续跑、重复导入及部分回复恢复。
