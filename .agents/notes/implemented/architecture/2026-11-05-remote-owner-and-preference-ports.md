# Agent Note: Remote ownership and preference ports

Status: implemented

## Problem

旧云控目录混合身份、桌面协议、账号偏好、本机配置和网站装配。偏好 HTTP 层持有 Session，
网站协议符号通过装配文件转发，公网监听仍放在旧通用能力目录，职责与实际数据所有者不符。

## Decision

Remote Desktop 拥有偏好模型、Guacamole 传输与 VNC 探测，公开 DTO 归 Remote 契约。
`DesktopPreferences` 只依赖声明的存储端口；两种装配注入相同的 `PreferenceRecords`。
读取返回不可变快照，写入在一个短事务中校验账号与 revision 并提交完整更新。
HTTP 适配映射冲突快照，提交成功才通知连接重新读取策略，不直接接收 Session。

网站云控路由负责组合 Identity 与 Remote，装配连接器只注入能力而不转发协议符号。
本机配置探测与编辑在 Host，网站入口与 Mac worker 共用显式路径适配；Host 不导入网站。
公网监听和专用 SSH 生命周期在网站装配，凭据路径解析在 Host，状态和错误在 Gateway 契约。
删除旧 `app/console/cloud_control` 与 `app/capabilities/web_access` 源码目录。

## Alternatives considered

把全部云控代码搬到 Remote 会引入身份 ORM 和网站生命周期依赖，因此按实际所有者拆分。
保留旧偏好 SQL 函数仅能改变路径，不能证明相同用例可使用不同存储，因此引入原子 CAS 端口。

## Consequences

不改变表名、历史迁移、服务 ID、Cookie 路径、网络协议、配置键和持久凭据目录。
偏好取消或写入失败回滚，未知提交通过读取快照核对，不自动提交新的 revision。
业务权限仍由原入口复核；本批不代替剩余工作台与旧身份查询的后续解耦，也不执行正式上线。

## Verification

- 云控、Remote、配置、公网监听、SSH、Management Host 与架构回归：134 passed。
- 内存、网站 SQLite 和独立 Remote SQLite 同一契约：12 passed，覆盖并发 CAS、账号隔离、
  不可变快照、取消、写入后回滚、提交确认丢失及重新构造存储读取。
- 23 个服务镜像源码闭包中的入口与 CLI 帮助通过，未执行 Docker 镜像构建。
- OpenAPI stale-check 通过，部署归属清单更新模型位置而不改变数据表归属。
