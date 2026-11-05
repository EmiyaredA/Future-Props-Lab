# Agent Note: 素材存储与文件库归属收拢

Status: implemented

## Problem

素材记录、文件路径、账号布局升级和文件库归档散落在旧 capabilities 与 console 中，
消费者通过聚合导出加载其他业务 ORM。旧路径同时被镜像闭包和历史导入工具引用。

## Decision

素材记录、上传与账号布局适配归 `studio.apps.asset_library.storage`，归档归 `archives`，
协议投影与网站路由归 `transport`。素材预览辅助实现归 `previews`。
媒体元数据检测归无业务状态的 `studio.runtime.files.media_metadata`；本机打开目录归
`studio.host.project_files.folders`，通过目录定位接口接收已授权路径。
视觉素材引用模型由视觉工坊拥有，删除旧素材模型的延迟转发。消费者直接引用实际所有者。

保持表名、存储格式、权限、服务 ID 和迁移内容。部署清单只更新模块位置，不转移表的服务归属。

## Alternatives considered

- 保留旧包转发：仍会让新依赖回流到旧聚合入口，因此移除。
- 同时改写全部网站跨表事务：会混淆归属迁移和行为变更，改为后续逐项用例端口验收。

## Consequences

旧 `app.capabilities.asset_store` 与 `app.console.file_library` 无源码。
网站存储仍含视觉引用和跨表保留策略，部分上传接口仍返回 ORM；本批不代表这些用例已经解耦。
正式数据未切换，历史迁移未修改。

## Verification

- 素材、账号布局、媒体读取、文件预览与架构相关回归：148 passed。
- 23 个服务源码闭包通过；278 个表的服务和模型归属保持一致。
- OpenAPI stale check、Ruff、Agent Note 与文档保护检查随本批执行。

## Website configuration follow-up

The website file, folder archive, storage upgrade and local reveal adapters
receive the settings of the serving application. They no longer read a
process-global configuration when resolving file paths or enforcing limits.
The website upload regression uses a per-application limit and verifies that a
rejected upload does not create a library record. The asset and repository
checks passed 60 tests.
