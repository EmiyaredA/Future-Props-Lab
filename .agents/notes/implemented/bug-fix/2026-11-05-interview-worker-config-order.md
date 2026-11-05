# Agent Note: Interview worker 显式配置绑定

Status: implemented

## Problem

Interview 的 Mac worker 导入 CLI 探测与执行适配器时提前读取了默认配置路径。独立启动传入 `--config` 时，探针仍可能使用默认连接配置。

## Decision

入口绑定配置后再加载 Codex 探测和执行适配器。任务文件准备也在需要时加载同一适配器。默认连接策略、租约授权和回执恢复保持原有行为。

## Alternatives considered

部署进程可以额外设置环境变量，但单独调用 worker 时显式参数仍会受导入顺序影响。

## Consequences

独立进程按命令行指定的配置选择连接。探测和执行共享已绑定的设置。

## Verification

无 FPL 环境变量的子进程模拟入口时序，核对构造 worker 后读到指定 TOML 的可执行路径。Interview 隔离传输、回执恢复和就绪门禁同批复测。
