# Agent Note: 桌面端 Codex 模型源工具

Status: implemented

## Problem

桌面应用的工具目录缺少查看和调整本机 Codex 模型源的入口。手工修改用户目录中的 `config.toml` 容易覆盖其他设置，也难以确认配置是否在编辑期间被其他程序改动。

## Decision

工具目录向桌面版平台管理员提供 Codex 模型源页面。页面通过登记权限的 `/v1/tool-navigation/codex-source` 接口读取和修改当前进程的 `CODEX_HOME/config.toml`，默认位置为用户目录下的 `.codex/config.toml`。接口仅接受浏览器 Session，桌面私有传输继续校验启动凭据。

工具管理固定的 `fpl_custom` 供应商配置，支持 OpenAI 官方源和兼容 Responses API 的自定义基础地址与模型 ID。密钥只通过环境变量名引用，不经 Web 传输或保存。首次写入前以 0600 权限保存原始配置，写入采用 SHA256 修订校验、TOML 校验和同目录原子替换；用户可显式恢复原始文件。工具不终止 Codex 进程，不修改其桌面端内部状态，提示用户重启并为已有会话重新选模型。

## Alternatives considered

- **运行第三方配置脚本并重启 Codex** — 可复制 Codeyun 的一键效果，但会执行下载的代码，并可能中断正在运行的会话。
- **把 API Key 写入 `config.toml`** — 切换更省步骤，但会把明文凭据带入配置及备份；官方配置支持 `env_key` 引用环境变量。

## Consequences

- **收益**：本机配置改动可检查、可恢复，并保留与模型源无关的设置。
- **代价与已知上限**：环境变量必须由启动 Codex 的进程提供；自定义端点必须兼容 Responses API。切换只影响重启后的默认配置，已有会话可能保留原模型。恢复原始文件会覆盖其后的手工改动，页面在执行前明确提示，并用修订值阻止并发覆盖。

## Verification

运行 `UV_CACHE_DIR=.local/uv-cache uv run pytest -q tests/test_codex_source.py`、`npm run contracts:check`、Web 类型检查与工具页测试。所有配置写入测试只使用临时 `CODEX_HOME`。
