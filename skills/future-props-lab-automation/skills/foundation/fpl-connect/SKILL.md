---
name: fpl-connect
description: Connects Future Props Lab desktop CLI (fpl) or chooses Management API Key Client. Use when pairing, checking status, selecting data dir, opening App pages, or before any fpl automation.
---

# fpl-connect

## 前置（单独安装时必做）

- Future Props Lab **桌面 App 已运行**（正式数据或隔离开发数据）。
- 本机可执行 `fpl`（随 App 打包；PATH 中找不到则从 App 安装目录调用）。

## 何时使用

通过 `fpl` 做本机 App 自动化，或在「桌面 Agent 通道」与 `Client(api_key=...)` 之间选择。

## 不在范围

revision/CAS、call/wait 细节 → `fpl-contracts`。工坊文档编辑 → 各业务 skill。

## 工作流

1. 配对一次：`fpl connect --name "<代理名>"`（仅集成管理或付费模型调用再加 `--write`）。
2. 检查：`fpl status`。
3. 查看白名单：`fpl operations`（来自 App capabilities）。
4. 只打开 UI、不自动提交：`fpl open <kind> [resource_id]`。
5. 仅清除本机凭据：`fpl disconnect`（撤销授权仍在 App 设置中操作）。

## CLI 与 HTTP SDK

| 路径 | 适用 |
|------|------|
| `fpl`（桌面 Agent） | 本机 App、Unix Socket、白名单内工坊/文件/推理/集成/日志只读 |
| `Client(base_url=..., api_key=...)` | Management API Key 的 HTTP 自动化；账号治理不要走 Agent |

**不要**通过 Agent 通道做账号、工作区管理、密钥管理或模型目录改动。

## 常用参数

- `--data-dir` — 显式数据根（测试或独立实例）
- `--development` — 开发版数据
- `--profile` — 配置名（默认 `default`）

## `fpl open` 的 kind

`visual` | `galgame` | `video` | `presentation` | `annotation` | `note` | `knowledge` | `skill` | `tool-api` | `mcp`

## 最小可运行示例

```bash
fpl connect --name "cursor-agent"
fpl status
fpl operations | head
fpl open visual
```

## 失败处理

- 未配对 → 运行 `fpl connect` 并在 App 中批准。
- capabilities 无该操作 → App 未开放；不要臆造未登记的 `fpl call`。
- CLI/SDK 过旧 → 更新 App/SDK，使方法与 capabilities 一致。

## 相关 skill

`fpl-contracts`（写入约定）；各业务叶子 skill。
