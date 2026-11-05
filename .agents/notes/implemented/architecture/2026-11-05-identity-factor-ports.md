# Agent Note: Identity factor transaction ports

Status: implemented

## Problem

云控验证器仍位于旧 Console，协议层传入数据库 Session，规则直接读取全局加密配置和时间。
防重放、失败次数和轮换撤销必须一起提交，机械拆成多个保存方法会破坏这组原子性。

## Decision

验证器 ORM、授权查询和 TOTP 协议入口归 Identity；公开登记与验证 DTO 归 Identity 契约。
`CloudFactors` 接收存储、加密器、时钟和随机源，使用不可变快照决定事务结果。
`FactorRecords` 为每次操作创建短会话，取得写锁后复核活动管理员会话及公网密码重验前提。
错误验证码的计数也作为已提交结果返回；协议层在提交之后把领域错误映射为 HTTP。
验证器轮换、撤销原授权和创建新解锁记录同事务完成，网站与独立 Identity 共用该实现。

## Alternatives considered

仅移动原 SQL 函数不能解除协议对 Session 和全局加密器的依赖。
多个独立保存接口会让并发验证码重放或部分轮换状态可见，因此采用完整原子决策端口。

## Consequences

表名、历史迁移、HTTP 路径、权限、TOTP 时间窗和持久密文格式保持兼容。
取消和写入失败整体回滚；响应丢失可能意味着已提交，调用方不能自动重复登记或验证。
旧授权查询 `storage/cloud_access.py` 的配置读取、桌面适配和工作台消费者仍需后续解耦；
本批没有宣称全部 Identity 或云控迁移完成。

## Verification

- 内存、网站 SQLite 和独立 Identity SQLite 共用契约，覆盖并发重放、账号绑定、错误次数、
  登记过期、密码重验、撤销、轮换、取消、回滚和提交成功但响应丢失：21 passed。
- Studio 架构约束：22 passed，包含旧身份文件不得复建和纯用例不得加载适配器。
- 云控、Identity 授权、Remote、设置和原凭据迁入隔离回归：33 passed；
  使用临时协议监听器及受控 Mac 沙箱，无正式数据库或供应商调用。
- 23 个服务的镜像源码闭包中导入入口及 CLI 帮助通过；未执行实际 Docker 镜像构建。
- OpenAPI stale-check 通过，部署归属清单只更新模型模块位置。
