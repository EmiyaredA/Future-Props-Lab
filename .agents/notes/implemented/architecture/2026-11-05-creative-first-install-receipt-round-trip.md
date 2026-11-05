# Agent Note: Creative 首次安装省去空回执查询

Status: implemented

## Problem

新安装在 Creative 持久化全新操作 ID 后，会调用 Integrations 查找该操作的回执。隔离 Compose 的 30 次分段样本显示，此查询全部返回无回执，p50 为 29.33 毫秒，p95 为 47.96 毫秒，包含 Integrations 对 Creative 的决策复核。

## Decision

只有完成本次新意图提交的调用才携带内存中的新建标记。它确认发布状态后直接进入目标的幂等安装。任何已存在的意图仍先读同一操作 ID 的回执，查询超时直接保留未确认状态。授权复核、目标原子幂等写入、Skill 文件校验和持久回执保持为安装条件。

## Alternatives considered

- 所有调用都直接重复安装。已存在的操作可能已提交或遇到撤回，必须先读原回执才能安全恢复。

## Consequences

首次安装减少一次跨服务请求。并发调用仍共用同一个持久操作 ID，任一进程中断后的重试先核对目标。新建标记不存入数据库。

## Verification

`tests/test_creative_installation_outbox.py` 验证首调直接提交、响应丢失后的恢复只读回执，以及回执查询失败禁止重新提交。Creative 定向测试和服务边界检查合计 125 项通过。分段基线见固定候选 `e25a2e0e` 的隔离 Compose 项目 `full-compose-3i8sodh_`。
