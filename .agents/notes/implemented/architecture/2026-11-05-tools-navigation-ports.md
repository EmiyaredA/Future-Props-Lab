# Agent Note: 工具导航归属与原子存储端口

Status: implemented

## Problem

工具导航仍从旧 `app.tool_navigation` 导入，HTTP 直接构造持有 Session 的业务对象。
本机视频下载、公开数据形状和账号收藏混在同一包，替换导航存储需要同时修改路由。

## Decision

收藏及最近使用归 `studio.apps.tools`，公开形状和来源规则归 `studio.contracts.tools`。
本机命令、依赖探测和抖音下载协议归 `studio.host.project_files`，父包不隐式导入业务。
两套装配都构造 `ToolNavigation(NavigationRecords(sessions), clock=...)`；路由仅传递
经身份验证的账号与操作。用例定义 `NavigationStore`，不接收数据库会话或读取全局配置。

存储按操作创建账号会话，写锁覆盖首次创建、字段更新与提交。收藏变更不覆盖使用次数，
使用增量不覆盖收藏。异常或取消关闭会话并回滚，已提交但确认丢失时不自动重试增量。
接口没有幂等请求 ID，保持既有每次成功调用计数语义，不承诺重复请求去重。

## Alternatives considered

- 保留路由构造 SQL 对象：无法替换实现，因此由装配持有无账号可变状态的用例实例。
- 在所有者外保存收藏规则：工具导航自己维护状态；Web 注册表继续拥有名称与分类。
- 修改公开请求以增加幂等 ID：超出路径迁移兼容基线，本批明确未知结果边界。

## Consequences

删除旧工具包，表名、历史迁移、服务 ID 和公开接口不变。
网站视频下载仍采用已有临时任务生命周期，独立服务继续采用持久任务和回执；两者的
状态与媒体句柄端口尚需后续统一，本批不将整个 Tools 业务标记为完成解耦。

## Verification

- 同一导航契约覆盖内存替身、网站 SQLite 与独立 SQLite：账号隔离、并发、字段保留和快照隔离。
- 两种 SQL 装配分别注入提交前失败、取消和提交确认丢失，核对回滚与已提交状态。
- 网站和独立入口、下载生命周期、迁移、依赖边界、源码闭包及 OpenAPI 随批次回归。
- 本批回归 136 passed；需要回环端口的隔离迁移测试在允许监听后 1 passed，总计 137 passed。
- Ruff 与格式检查通过；23 个服务闭包、OpenAPI、Agent Note 与受保护路径检查执行后核对提交范围。
