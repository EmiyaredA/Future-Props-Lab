# Agent Note: 兼容设置分区与模型模板加密端口

Status: implemented

## Problem

模型设置仍经旧 console 包读取，原平台设置表按键分区但代码没有限定分区的存储入口。
模板输入和脱敏输出读取全局加密配置，两套服务实例无法明确使用不同部署密钥。

## Decision

兼容表记录与通用修订机制归 `studio.runtime.database.settings_*`；不决定业务归属或授权。
`contracts/management/setting_owners.py` 登记既有键和前缀，部署清单复用这份真源。
模型存储适配只接受 models 分区，账号默认模型仍额外核验 Session 中的账号上下文。

`SettingsPartition` 返回深复制快照，替换使用 SQL CAS，不自动提交。创建由调用者的
短写锁保护，授权、配置、账号初始化及审计继续使用原事务。取消或失败由该事务回滚。
设置模型搬迁不改变表名、历史迁移、键或清单中原表的兼容归属。

模板值转换声明 `TemplateCipher`；网站和独立 Models 从各自注入设置创建 SecretCipher。
只读模板快照不需要加密器，带秘密的写入和提示输出必须显式提供，不回退到全局配置。

## Alternatives considered

- 把旧表整体移交 Models：其中仍有其他所有者的已登记键，因此保留兼容表和原分区。
- 每个应用复制平台设置 ORM：容易形成多个映射和表结构事实源，改为共用无业务决策的机制。
- 通过 Session 字段查找加密器：属于隐式服务定位，改为明确参数。

## Consequences

原设置模块删除；权限与审计的既有 SQL 适配尚待后续拆成业务端口，本批不表示整个治理解耦完成。
迁移历史和持久格式不变，受保护产品文档未纳入本批。

## Verification

- 键分区拒绝、深复制、并发 CAS、跨设置事务回滚与取消在临时 SQLite 验证。
- 模板端口使用内存加密替身与 Fernet 运行相同契约；验证不同实例密钥互不混用。
- 平台治理、模板同步、额度、账号初始化、两种 Models 入口及架构检查随批次执行。
- 本批回归 188 passed；独立进程目录事件投递 1 passed。23 个服务源码闭包、OpenAPI 与 Ruff 检查随提交核对。
