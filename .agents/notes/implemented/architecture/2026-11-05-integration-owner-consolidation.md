# Agent Note: 集成目录归属与显式依赖

Status: implemented

## Problem

集成中心两套入口共用旧实现，但网站目录构造器会隐式读取全局配置并创建加密器、MCP
客户端和 Skill 存储。思绪同步也自行构造集成存储，导致替换配置时只有部分入口生效。
创作工坊为了验证归档而加载集成账号存储，协议和 ORM 的导入边界不清晰。

## Decision

目录实现归 `studio.apps.integrations`，协议归 `studio.contracts.integrations`，自有
记录及检查历史归 `storage`。公共归档校验和文档编码／结果验证是明确登记的客户端适配，
不包含账号存储。旧 `app.integrations` 源码和聚合转发移除。

网站和独立服务显式提供目录的加密器、MCP 客户端和 Skill 存储；构造器不提供全局回退。
`runtime.secrets.SecretCipher` 只接收密钥，不导入设置。旧其他业务的凭据读取函数仍待迁移。
Amadeus 工具执行消费网站已装配的目录，Skill 固定版本加载由执行器注入目录。

思绪同步声明 `ArticleConnections` 和 `ArticleDocumentClient`，装配绑定当前账号；
集成连接的公开读取返回不可变 `ConnectionSnapshot`，不把 ORM 或密文交给思绪。
原有同步持久状态、步骤确认和未知结果核对规则不变，不重新提交未知的外部写入。

## Alternatives considered

- 保留默认客户端：配置与密钥仍可能来自错误实例，因此必须显式提供。
- 放开整个集成应用的跨服务依赖：会加载其他账号存储，改为逐模块登记纯适配。
- 同时重写全部目录事务：本批保留原原子性，后续逐项抽出存储端口。

## Consequences

历史迁移、表名、服务 ID 和持久数据格式不变。目录类仍有 SQL 和规则共存，
本批不是整个架构提案的最终验收。正式数据未操作，产品文档中心未修改。

## Verification

- 隔离实例测试验证不同密钥、MCP 客户端与文件根目录，不调用全局配置。
- 迁移协议测试在临时 SQLite 和回环协议桩验证原密钥、账号归属、回执重放：1 passed。
- 23 个服务源码闭包通过；目录、思绪同步、Amadeus、创作与架构相关回归：222 passed，
  3 skipped（宿主禁止 sandbox-exec）；与迁移协议合计 223 passed。
- OpenAPI stale check 与 Ruff 通过；Agent Note 与受保护文档检查随本批执行。
