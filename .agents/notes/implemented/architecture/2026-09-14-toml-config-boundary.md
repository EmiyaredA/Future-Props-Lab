# Agent Note: 持久配置统一由 TOML 拥有

Status: implemented

## Problem

旧 `.env` 同时承载端口、密钥和认证变量，无法清晰区分持久配置与环境覆盖。

## Decision

后端持久配置只读取 `backend/config.toml`；`.env` 只允许一次性转换并保存 0600 备份，不作为运行时回退。桌面版在自己的数据根生成和继承配置。

## Alternatives considered

- **继续把 .env 作为主配置** — 工具普遍支持，但类型和桌面边界不清。
- **启动时自动合并 TOML 与 .env** — 兼容性高，但配置来源不确定并掩盖错误字段。

## Consequences

- **收益**：配置来源确定，错误字段和缺少密钥可以阻止启动。
- **代价与上限**：旧安装必须显式运行转换。

## Verification

运行 `npm run config:migrate -- --check` 和 `tests/integration/test_configuration.py`。

