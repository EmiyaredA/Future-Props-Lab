# Agent Note: Creative 与 Agent 服务的就绪协议

Status: implemented

## Problem

Creative 装配了安装与作品认证路由，但就绪探针固定返回不可用。Gateway 的状态图也缺少 Creative 的项目认证依赖，三个 Agent 服务的成功探针响应与 Gateway 约定不同。

## Decision

Creative 在持锁初始化、安装凭据装配和网页发布校验完成后检查数据库并返回就绪版本。Gateway 依赖图登记 Creative 的 Visual 与 Galgame。Agent Runtime、Agent 工作台和 Amadeus 通过既有工作进程门禁后返回标准就绪状态。

## Alternatives considered

无条件报告就绪会掩盖缺少安装能力或网页发布的问题。让 Creative 探针直接调用全部服务会将 Gateway 的依赖聚合重复到业务服务。

## Consequences

Creative 本机就绪、依赖受限和整站切换验收分别有明确证据。原 API 鉴权、授权状态和正式数据迁移继续由各自门禁覆盖。

## Verification

`tests/apps/creative_workshop/test_creative_service_storage.py` 核对仅 API、完整装配和启动前后探针。`tests/integration/test_service_status.py` 核对作品认证依赖异常。原生 Agent 与 Amadeus 测试核对工作进程就绪后的响应。
