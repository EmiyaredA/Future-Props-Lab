# Agent Note: 公网代理重载后验证入口

Status: implemented

## Problem

公网代理完成重载时，重载前建立的 HTTP 连接可能被关闭。正式切换的单次 HTML 探针把断连当成发布失败，触发了完整回滚。

## Decision

使用 `scripts.website.release_readiness.wait_for_release_pages` 检查最终 HTML 和已固定的浏览器构建。放行脚本在代理重载前检查本机页面，随后为公网检查使用无连接复用的客户端。只读探针在短期限内重试传输错误和代理的 502、503、504。构建不一致、错误媒体类型或其他 HTTP 错误立即失败。

## Alternatives considered

- 在重载后固定等待一段时间。等待不证明连接已恢复，也不核对目标页面与构建。

## Consequences

探针最多占用预留的 30 秒，并受发布总期限约束。应用写入与代理更新操作没有自动重试。持续失败仍由原切换流程回滚。

## Verification

`uv run pytest -q tests/integration/test_release_readiness.py` 验证断连后读回和错误构建拒绝。使用正式同版本 Caddy 镜像的本机隔离探针验证了真实 reload，从临时 503 恢复并读回两个正确的构建头。
