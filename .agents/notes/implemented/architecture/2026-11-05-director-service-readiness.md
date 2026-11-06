# Agent Note: 导演台运行就绪检查

Status: implemented

## Problem

导演台的独立入口即使完成文件恢复、数据库核验和网页发布校验，就绪探针仍固定返回不可用。

## Decision

只有持锁启动恢复完成且挂载的网页发布与公开契约匹配时才报告就绪。探针复核数据库迁移和可读性，返回发布版本。退出和仅 API 启动保持未就绪。

## Alternatives considered

只检查进程会漏掉浏览器发布或数据库归属问题。把历史迁移验收写进探针会将一次性的迁移证据与持续运行状态混在一起。

## Consequences

Gateway 能识别导演台实际运行状态。全站切换仍以同版本的完整历史迁移和整站验证为门禁。

## Verification

`tests/integration/test_independent_director.py` 覆盖未启动、仅 API、恢复后发布版本、损坏程序拒绝和恢复后的项目文件读回。
