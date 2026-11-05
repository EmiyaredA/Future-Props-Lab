# Agent Note: 创作目录与安装资源显式装配

Status: implemented

## Problem

创作目录已供两套入口共用，但作者、来源、归档器和安装器通过 Session 隐式查找，
文件适配在缺少设置时会读取全局配置。发布过滤接受 ORM 实例，不能独立复用规则。

## Decision

旧创作实现归 `studio.apps.creative_workshop`，数据协议及领域错误归所属 contracts。
`rules/publication.py` 接收明确的种类、标题、摘要、配置和 Skill 可用性，不依赖 ORM。
`CreativeResources` 显式提供现有 SQL 目录所需的作者、来源、归档和文件设置。
文件函数要求设置参数；Session 仅保留存储内部的账号上下文，不充当服务定位器。

`CreativeInstaller` 先验证调用者权限，再调用注入的安装端口。网站装配保留原有跨表
原子事务；独立装配继续使用安装 outbox、确认回执和取消围栏。作者显示的数据库适配由
Identity 拥有，网站来源由 Integrations 提供。删除旧目录及仅转发的来源、归档适配。

## Alternatives considered

- 继续从 Session 查找服务：依赖难以替换且生命周期不明确，因此改为构造时注入。
- 立即统一所有存储事务：网站跨表事务与独立持久投递有不同失败边界，本批保持兼容。
- 发布规则继续接受 ORM：会将存储对象泄露到纯规则，改为明确值参数。

## Consequences

业务配置不再回退读取全局设置，旧 `app.console.creative_workshop` 无源码。
现有 SQL 目录和网站安装适配仍需继续分解事务端口及规则，本批不表示整体迁移完成。
历史迁移、HTTP、表名、归属和正式数据未改变。

## Verification

- 两套入口、账号隔离、安装意图、取消围栏、文件提交确认丢失和架构回归：178 passed。
- 目录与安装依赖不再读写 Session 服务字段，架构测试约束配置查找和依赖方向。
- 23 个服务源码闭包、OpenAPI、Ruff、Agent Note 与文档保护检查随本批执行。
