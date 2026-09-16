# Agent Note: 后端按功能能力组织并隔离路由协议层

Status: implemented

## Problem

模型、视觉、Galgame、音频和文件能力持续增加，通用服务层容易集中查询、事务和业务规则。

## Decision

后端采用功能模块优先结构。`routes/` 只处理认证、请求校验、功能调用和响应映射；查询、事务和业务规则留在所属能力包，不新增通用 `services/`、`domain/` 或 `product/` 层。

## Alternatives considered

- **通用 services/domain 层** — 能统一抽象，但会重新集中不同能力的事务和边界。
- **路由直接访问 ORM** — 初期代码少，但会让协议层持有持久化细节，难以复用离线命令和后台任务。

## Consequences

- **收益**：业务所有权和依赖方向可从目录判断。
- **代价与上限**：新抽象只有在出现真实跨模块消费者时才创建。

## Verification

架构测试检查路由与 ORM 边界；运行 `npm test` 与 `npm run lint`。

