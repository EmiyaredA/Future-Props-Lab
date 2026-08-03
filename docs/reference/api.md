# API 参考

交互式 OpenAPI 位于后端 `/docs`。所有业务接口注册在 `/v1`；配置 `FPL_STUDIO_TOKEN` 后携带 `X-Studio-Token`。

## 模型目录

- `GET/POST /v1/model-providers`
- `PATCH/DELETE /v1/model-providers/{provider_id}`
- `POST /v1/model-providers/{provider_id}/enabled`
- `POST /v1/model-providers/{provider_id}/models`
- `PATCH/DELETE /v1/model-entries/{model_id}`
- `POST /v1/model-entries/{model_id}/test`

目录写入必须携带最后读取的 `expected_catalog_revision`。冲突返回 `409 revision_conflict` 和服务器当前快照。

测试调用使用固定提示词、16 个最大输出 Token 和 30 秒超时；无论上游成功、失败或超时均记录日志，API Key 不进入请求或日志 payload。

## 调用日志

- `GET /v1/llm-call-logs`：支持搜索、调用源、供应商、模型、状态、日期和分页。
- `GET /v1/llm-call-logs/stats`
- `GET/DELETE /v1/llm-call-logs/{log_id}`
- `POST /v1/llm-call-logs/batch-delete`

调用源 `model_diagnostic` 表示模型服务行内的固定 `OK` 快速诊断，`model_playground` 表示模型测试工作台。

## 模型测试

- `GET/POST /v1/model-test/conversations`
- `GET/PATCH/DELETE /v1/model-test/conversations/{conversation_id}`
- `POST /v1/model-test/conversations/{conversation_id}/messages/stream`
- `POST /v1/model-test/conversations/{conversation_id}/regenerate/stream`

修改、删除、发送和重新生成使用会话 `expected_revision` 做 CAS 保护。流式接口返回 SSE v2 envelope，事件为 `start / delta / done / error`；成功、失败、超时或取消都会保存消息状态并写入调用日志。

## 工具导航

- `GET /v1/tool-navigation/state`：读取工具收藏与最近使用状态。
- `PATCH /v1/tool-navigation/tools/{tool_id}`：通过 `is_favorite` 幂等更新收藏状态。
- `POST /v1/tool-navigation/tools/{tool_id}/use`：原子递增使用次数并更新最近使用时间。

工具目录本身由 Web 注册表维护，后端只保存由小写字母、数字和连字符组成的稳定工具 ID。
状态属于当前单机 Studio 全局数据，不建立用户或多租户归属。

## 健康与鉴权

- `GET /health`
- `GET /ready`
- `GET /v1/studio/auth/check`
