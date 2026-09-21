# Agent Note: Amadeus 模型轮次不得在 rollback 后读 ORM

Status: implemented

## Problem

Amadeus 对话在流式返回文本后仍报「模型连接或调用失败」。`stream_model_turn` 在发起上游请求前对请求会话执行 `rollback()` 以释放长事务，但结算调用日志时再次读取已过期的 `provider.kind`，在异步生成器 `finally` 中触发 `MissingGreenlet`。该异常覆盖真实上游错误，并在成功轮次的 `end` 事件之后再次失败，使前端把本已完成的回复标成失败；调用日志也写不进去。

## Decision

在 `rollback()` 之前把结算所需的 ORM 标量（至少 `model.slug` 与 `provider.kind`）拷成普通 Python 值。调用日志结算失败只吞掉自身异常，不得替换已成功的 `end` 事件或上游异常。回归测试用真实 `SessionLocal` 加载模型后再流式结算，覆盖过期实例路径。Amadeus 桌面助手边界仍见 [Amadeus 桌面助手的可信边界](../feature/2026-09-20-amadeus-desktop-assistant.md)。

## Alternatives considered

- **结算前重新 `session.get` 加载 provider** — 仍依赖请求会话生命周期，流式期间会话状态不稳定，且多一次数据库往返。
- **去掉请求会话 `rollback`，保持 ORM 实例可用** — 会把上游 HTTP 等待留在已打开的请求事务里，违反短事务约定。
- **只捕获 `MissingGreenlet` 并重试结算** — 治标不治本，其他过期属性访问仍会以同样方式掩盖上游错误。

## Consequences

成功轮次在写出 `end` 后不再被日志结算拖成失败；失败轮次能保留上游异常语义，调用日志可按 `call_source=amadeus` 落盘。结算失败仍可能静默丢日志，需要后续观测，但不得再污染对话结果。

## Verification

- `uv run pytest tests/test_amadeus.py::test_amadeus_model_bridge_settles_after_request_session_rollback tests/test_amadeus.py::test_amadeus_model_bridge_streams_text_and_tool_calls -q`
- `npm run verify-notes`
