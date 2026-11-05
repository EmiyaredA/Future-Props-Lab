# Agent Note: 独立 Agent Runtime 就绪与租约恢复

Status: implemented

## Problem

Agent Runtime 能处理 Mac CLI 连接和视觉验收，但就绪探针固定失败。连接任务持久保存浏览器断言，使重启后的短请求仍携带原授权。

## Decision

就绪检查要求两个认证原生通道最近收到轮询或有效租约检查、清理协调器正常且自有 schema 匹配。CLI 连接请求仅在进程内保留断言。启动时结束旧的连接任务并清理历史断言，允许原 worker 补交既有租约的持久回执。

## Alternatives considered

只检查进程存在无法证明实际 Mac 通道连通。重启后重新派发不确定的连接启用任务可能重复写本机配置。

## Consequences

服务重启前未领取的连接请求失败，已领取的请求保持未知直至收到原回执。Visual 验收仍按独立长任务协议保持原有租约和附件恢复。

## Verification

隔离测试覆盖两路就绪门禁、失效通道、旧断言清理、撤权及丢失回执重放。
