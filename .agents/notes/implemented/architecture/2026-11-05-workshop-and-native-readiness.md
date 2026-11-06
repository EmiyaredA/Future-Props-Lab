# Agent Note: 工坊和原生工具的就绪门禁

Status: implemented

## Problem

录音标注、演示工坊、面试助手和工具服务的就绪探针始终返回不可用，Gateway 无法识别完整部署。

## Decision

录音标注检查浏览器发布和素材引用恢复执行器。演示工坊也检查归档导入恢复。面试助手复用其可用 worker 的新鲜状态并检查租约维护任务。工具服务以已认证的领取请求和成功的任务心跳为联系证据。所有探针核对浏览器发布版本和数据库可读性。

## Alternatives considered

只检查进程会掩盖后台恢复不可用或原生执行器未连接。将所有依赖请求放进每个探针会重复 Gateway 已登记的状态聚合。

## Consequences

仅 API、后台恢复停止、原生 worker 失联的实例报告未就绪。迁移及整站联调继续作为切换门禁。

## Verification

`tests/integration/test_service_owner_readiness.py` 覆盖四个服务的正向启动、后台恢复停止、未经认证的 worker、过期联系和发布页面版本。

同一隔离快照的定向回归通过 89 项。真实 Compose 镜像的四个就绪探针均返回各自的浏览器构建版本，页面响应头与探针版本一致。面试助手和工具服务在发送签名的模拟 worker 心跳前均返回 503。
