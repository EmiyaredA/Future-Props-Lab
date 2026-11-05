# Agent Note: 网站工厂与数据库生命周期

Status: implemented

## Problem

旧网站入口在导入时读取配置、创建引擎和装配应用。测试与 OpenAPI 导出依赖同一个生产模块单例，网站账号监听器还注册在 SQLAlchemy 全局 Session 上。

## Decision

网站装配归 `studio/assembly/website/`。工厂接收配置和可选数据库；HTTP 结构、路由、组件绑定、模型登记和生命周期分别拥有明确职责。`WebsiteDatabase` 显式创建引擎和会话工厂，关闭时结算 WAL；`WebsiteSession` 独占网站账号规则。

删除旧 `app/main.py`、`api.py`、`orm.py`、`deps.py` 与 `runtime/db.py`。兼容鉴权装配依赖在 `studio/assembly/http_dependencies.py`；独立服务的签名身份依赖保留原位置，避免改变其公开错误响应。入口、源码闭包、测试和 Playwright 同步改为工厂。

OpenAPI 导出只构造 HTTP 结构，不构造数据库。测试实例由明确要求隔离配置与数据库环境变量的测试支持模块持有。离线账号和 E2E 引导自行构造、关闭数据库；正式网站仍先检查迁移再创建应用。

## Alternatives considered

把旧全局对象搬到新包或保留转发模块，无法隔离实例及导入副作用。合并两种鉴权依赖会顺带改变独立服务错误契约，因此本批保留两者既有协议语义。

## Consequences

HTTP、数据表、权限与历史迁移不变。业务仍存在待迁移的全局配置读取和 Session 信息绑定；本批只完成网站构造与数据库归属，不表示整体端口化完成。

## Verification

装配、迁移、架构、闭包和网站组合检查先有 87 项通过，4 个网站用例因测试适配未传显式工厂失败；修正后完整网站文件 8 项通过。另有服务契约及独立服务检查 102 项通过，其两项旧路径断言在后续组合检查中通过。新增进程检查证明导入和 OpenAPI 不读取配置或构造引擎，两个应用实例的数据库与活动状态互不共享。OpenAPI 和服务归属清单保持一致。正式数据未操作。

## Presentation adapter follow-up

Website composition binds Presentation asset lookup and legacy archive import
to the current application's storage and configuration. The existing
session-scoped adapter keys still select the compatibility implementation.
Presentation exchange, media, scene, and website assembly checks passed 64
tests. The Thought attachment limit fixture now targets the serving app as
well. The ordered Models and Thought regression passed 36 tests.
