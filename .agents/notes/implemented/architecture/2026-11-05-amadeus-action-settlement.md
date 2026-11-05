# Agent Note: Amadeus 独立动作结算

Status: implemented

## Problem

浏览器已经审批的 Amadeus 动作需要与独立账号数据库一起完成一次性领取，并在执行进程中断后保留明确状态。

## Decision

核对审批时的参数摘要和账号归属，以 CAS 将动作从 approved 改为 running。原路径与 NDJSON 共用领取和结算。工作文件通过同属对话的 SHA256 写入规则落盘。取消或服务重启遇到未确认状态记为 unknown。

## Alternatives considered

在 HTTP 断开后重新领取相同动作会重复业务副作用。仅在内存标记运行会丢失恢复所需的领取信息。

## Consequences

只有抢占成功的请求执行动作。对话删除需要等活动动作结算。此批次可执行所属工作文件和脚本文件的保存，其他执行器仍需装配。

## Verification

80 项隔离定向测试通过，1 项跳过。并发测试用普通与 NDJSON 请求争用同一审批，验证恰有一个执行、文件字节一致以及错误摘要被拒绝。
