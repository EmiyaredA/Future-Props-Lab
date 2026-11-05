# Agent Note: 自动化与文档入口组件化

Status: implemented

## Problem

自动化入口、开发者文档、额度和认证标记混在 Console 路由与治理目录。网站和独立 Gateway 重复维护资源链接规则，公开协议还依赖旧 Console 目录。文档读取通过全局仓库路径获取来源。

## Decision

Gateway 拥有自动化发现与资源链接，纯输入和白名单进入 `contracts/gateway`，SDK 与镜像读取同一份白名单。`ResourceLinks` 共用权限和链接规则，依赖调用方定义的资源读取接口：网站适配显式接收模型注册表与当前会话，独立适配向目标应用传递当前签名身份。查询前校验权限，跨账号、已删除与不存在返回相同业务错误。

Portal 的 `DeveloperDocuments` 先校验权限，再调用注入的文档源。安装文件适配只读取程序内的工程文档白名单；两个 HTTP 入口共用用例。文件根目录由装配构造，不由业务读取全局设置。

额度、文档和项目标记路由分别归 Model Service、Portal 和 Identity。兼容项目标记操作显式接收项目注册表，原 CAS 与审计事务不变。部署 TOML 的锁、原子发布和校验归 Management。

## Alternatives considered

只搬目录会保留两套导航规则。让业务直接依赖网站 ORM 或 HTTP 客户端会限制替换，所以用一个小型读取端口隔离适配。平台路由聚合不再保留转发入口。

## Consequences

HTTP 操作 ID、错误映射、账号隔离、白名单内容和配置格式保持不变。Portal 不修改受保护产品文档。此批只完成这些组件的替换边界；其余历史用例和兼容存储继续按整体提案迁移。

## Verification

治理、网站、独立 Gateway/Portal、源码闭包及端口契约 76 项通过；架构、自动化、配置和云控配置投影 74 项通过。资源读取以内存替身、隔离 SQLite 与受控客户端执行相同用例；文档读取验证授权先于 I/O。OpenAPI 和 SDK stale-check 通过，未改受保护文档。
