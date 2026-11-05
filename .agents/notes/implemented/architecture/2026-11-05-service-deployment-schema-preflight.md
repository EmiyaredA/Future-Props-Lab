# Agent Note: 独立部署启动前的数据库检查

Status: implemented

## Problem

Mac 启动器已有只读 schema 核验，但新增服务的迁移登记未纳入检查，带连字符的服务也会查找错误的状态目录变量。

## Decision

将已有独立迁移注册表的 22 个服务纳入启动核验。镜像和状态目录使用同一变量名转换规则，未登记或缺失配置仍阻止 Compose 启动。

## Alternatives considered

按服务名猜测 Python 导入路径会把未登记的外部输入用于模块导入。启动时自动迁移会在正式启动前写入尚未验收的数据库。

## Consequences

新装配服务同时登记迁移和启动检查。启动检查继续只读取已显式选定的状态目录。

## Verification

测试覆盖全部 22 个注册表、Agent Runtime 变量名、未登记服务、缺失状态目录，以及发现旧 schema 后阻止 Compose。
