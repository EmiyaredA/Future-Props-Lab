# Agent Note: Agents 启动先绑定配置

Status: implemented

## Problem

完整 Compose 的 Agents 迁移容器挂载了有效的最小 TOML，但入口在解析启动参数之前加载了迁移模块及其配置依赖。配置模块因此记住默认路径，独立启动报缺少 Fernet 密钥。

## Decision

先解析命令，再为导出和导入按需加载维护装配。普通启动与 schema 迁移保持原配置绑定和数据锁，且继续拒绝维护专用参数。

## Alternatives considered

在 Compose 注入配置路径也能修正该容器，但直接运行 CLI 的显式 `--config` 仍可能失效。

## Consequences

每种入口按自身职责加载依赖。普通入口依然以挂载配置验证独有状态目录。

## Verification

无任何继承的 FPL 环境变量的真实 Python 子进程成功用指定 TOML 初始化 Agents schema。服务权限和迁移入口随同回归验证。
