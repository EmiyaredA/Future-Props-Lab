<!-- docs: {"group": "api-modules", "category": "api", "order": 20, "title": "模型目录方法参考", "lead": "client.models 的具名方法与 HTTP 接口。", "evidence": ["sdk/python/operations.json"], "related": ["sdk-auth", "sdk-errors"]} -->

# 模型目录方法参考

通过 `client.models` 访问这些业务操作。同步与异步方法名称和参数一致；异步调用增加 `await`。
所有方法均来自当前 OpenAPI 与稳定映射表。下表验证的是接口契约覆盖，完整业务流程另见工坊教程。

## 方法目录

| SDK 方法 | HTTP 操作 |
| --- | --- |
| [delete_model](#delete-model) | `DELETE /v1/model-entries/{model_id}` |
| [delete_provider](#delete-provider) | `DELETE /v1/model-providers/{provider_id}` |
| [delete_supplier](#delete-supplier) | `DELETE /v1/model-suppliers/{supplier_id}` |
| [list_local_models](#list-local-models) | `GET /v1/local-models` |
| [list_model_categories](#list-model-categories) | `GET /v1/model-categories` |
| [list_providers](#list-providers) | `GET /v1/model-providers` |
| [update_model](#update-model) | `PATCH /v1/model-entries/{model_id}` |
| [update_provider](#update-provider) | `PATCH /v1/model-providers/{provider_id}` |
| [update_supplier](#update-supplier) | `PATCH /v1/model-suppliers/{supplier_id}` |
| [attach_local_model](#attach-local-model) | `POST /v1/local-models/attach` |
| [run_model_test](#run-model-test) | `POST /v1/model-entries/{model_id}/test` |
| [create_provider](#create-provider) | `POST /v1/model-providers` |
| [set_provider_enabled](#set-provider-enabled) | `POST /v1/model-providers/{provider_id}/enabled` |
| [add_model](#add-model) | `POST /v1/model-providers/{provider_id}/models` |
| [create_supplier](#create-supplier) | `POST /v1/model-suppliers` |
| [local_model_action](#local-model-action) | `POST /v1/platform/local-models/{model_id}/actions` |
| [defaults](#defaults) | `PUT /v1/model-catalog/defaults` |

## delete_model {#delete-model}

`client.models.delete_model(...)`

**接口**：`DELETE /v1/model-entries/{model_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `model_id` | path | string | 是 |
| `expected_catalog_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `DeleteMutationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_provider {#delete-provider}

`client.models.delete_provider(...)`

**接口**：`DELETE /v1/model-providers/{provider_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `provider_id` | path | string | 是 |
| `expected_catalog_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `DeleteMutationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## delete_supplier {#delete-supplier}

`client.models.delete_supplier(...)`

**接口**：`DELETE /v1/model-suppliers/{supplier_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `supplier_id` | path | string | 是 |
| `expected_catalog_revision` | query | integer | 是 |

**响应**：
- `200` · `application/json` · `DeleteMutationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_local_models {#list-local-models}

`client.models.list_local_models(...)`

**接口**：`GET /v1/local-models`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `LocalModelsOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_model_categories {#list-model-categories}

`client.models.list_model_categories(...)`

**接口**：`GET /v1/model-categories`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ModelCategoryListOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## list_providers {#list-providers}

`client.models.list_providers(...)`

**接口**：`GET /v1/model-providers`。**鉴权**：Workspace API Key 或 Session。
**权限**：`content.read`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |

**响应**：
- `200` · `application/json` · `ModelCatalogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_model {#update-model}

`client.models.update_model(...)`

**接口**：`PATCH /v1/model-entries/{model_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `model_id` | path | string | 是 |
| `body` | application/json | ModelEntryIn | 是 |
| `body.capabilities` | 请求体 | array | 否 |
| `body.categories` | 请求体 | array | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.enabled` | 请求体 | boolean | 否 |
| `body.expected_catalog_revision` | 请求体 | integer | 是 |
| `body.label` | 请求体 | string | 否 |
| `body.slug` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ModelMutationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_provider {#update-provider}

`client.models.update_provider(...)`

**接口**：`PATCH /v1/model-providers/{provider_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `provider_id` | path | string | 是 |
| `body` | application/json | ProviderIn | 是 |
| `body.api_key` | 请求体 | string | 否 |
| `body.base_url` | 请求体 | string | 否 |
| `body.enabled` | 请求体 | boolean | 否 |
| `body.expected_catalog_revision` | 请求体 | integer | 是 |
| `body.kind` | 请求体 | local_qwen_tts / volcengine_image / openai / deepseek / anthropic / senseaudio_image / volcengine_video / senseaudio_video / zealman_video / autodl_video / senseaudio_asr / senseaudio_asr_pro / senseaudio_realtime / senseaudio_music / senseaudio_sfx | 是 |
| `body.name` | 请求体 | string | 是 |
| `body.supplier_id` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `ProviderMutationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## update_supplier {#update-supplier}

`client.models.update_supplier(...)`

**接口**：`PATCH /v1/model-suppliers/{supplier_id}`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `supplier_id` | path | string | 是 |
| `body` | application/json | ModelSupplierIn | 是 |
| `body.expected_catalog_revision` | 请求体 | integer | 是 |
| `body.name` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ModelSupplierMutationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## attach_local_model {#attach-local-model}

`client.models.attach_local_model(...)`

**接口**：`POST /v1/local-models/attach`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | LocalModelAttachIn | 是 |
| `body.expected_catalog_revision` | 请求体 | integer | 是 |
| `body.model_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ModelCatalogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## run_model_test {#run-model-test}

`client.models.run_model_test(...)`

**接口**：`POST /v1/model-entries/{model_id}/test`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `model_id` | path | string | 是 |

**响应**：
- `200` · `application/json` · `TestModelOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_provider {#create-provider}

`client.models.create_provider(...)`

**接口**：`POST /v1/model-providers`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ProviderIn | 是 |
| `body.api_key` | 请求体 | string | 否 |
| `body.base_url` | 请求体 | string | 否 |
| `body.enabled` | 请求体 | boolean | 否 |
| `body.expected_catalog_revision` | 请求体 | integer | 是 |
| `body.kind` | 请求体 | local_qwen_tts / volcengine_image / openai / deepseek / anthropic / senseaudio_image / volcengine_video / senseaudio_video / zealman_video / autodl_video / senseaudio_asr / senseaudio_asr_pro / senseaudio_realtime / senseaudio_music / senseaudio_sfx | 是 |
| `body.name` | 请求体 | string | 是 |
| `body.supplier_id` | 请求体 | string / null | 否 |

**响应**：
- `200` · `application/json` · `ProviderMutationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## set_provider_enabled {#set-provider-enabled}

`client.models.set_provider_enabled(...)`

**接口**：`POST /v1/model-providers/{provider_id}/enabled`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `provider_id` | path | string | 是 |
| `body` | application/json | ProviderEnabledIn | 是 |
| `body.enabled` | 请求体 | boolean | 是 |
| `body.expected_catalog_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `ProviderMutationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## add_model {#add-model}

`client.models.add_model(...)`

**接口**：`POST /v1/model-providers/{provider_id}/models`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `provider_id` | path | string | 是 |
| `body` | application/json | ModelEntryIn | 是 |
| `body.capabilities` | 请求体 | array | 否 |
| `body.categories` | 请求体 | array | 否 |
| `body.description` | 请求体 | string | 否 |
| `body.enabled` | 请求体 | boolean | 否 |
| `body.expected_catalog_revision` | 请求体 | integer | 是 |
| `body.label` | 请求体 | string | 否 |
| `body.slug` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ModelMutationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## create_supplier {#create-supplier}

`client.models.create_supplier(...)`

**接口**：`POST /v1/model-suppliers`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ModelSupplierIn | 是 |
| `body.expected_catalog_revision` | 请求体 | integer | 是 |
| `body.name` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `ModelSupplierMutationOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## local_model_action {#local-model-action}

`client.models.local_model_action(...)`

**接口**：`POST /v1/platform/local-models/{model_id}/actions`。**鉴权**：Session；敏感操作需要二次验证。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `model_id` | path | string | 是 |
| `body` | application/json | LocalModelActionIn | 是 |
| `body.action` | 请求体 | install / cancel / enable / stop / uninstall | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |
| `body.request_id` | 请求体 | string | 是 |

**响应**：
- `200` · `application/json` · `LocalModelOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。

## defaults {#defaults}

`client.models.defaults(...)`

**接口**：`PUT /v1/model-catalog/defaults`。**鉴权**：Workspace API Key 或 Session。
**权限**：`configuration.manage`。

写入仅在当前身份有相应业务权限时执行。需要 revision 的参数必须来自最近一次读取；409 冲突不会自动覆盖。
SDK 不自动重试此操作；仅标明 request_id／requestId 的操作可按服务端去重规则重放。

| 参数 | 位置 | 类型 | 必填 |
| --- | --- | --- | --- |
| `body` | application/json | ModelDefaultsIn | 是 |
| `body.default_model_ids` | 请求体 | object | 是 |
| `body.expected_revision` | 请求体 | integer | 是 |

**响应**：
- `200` · `application/json` · `ModelCatalogOut`

上传下载和流式事件需要关闭响应上下文；错误保留 status、code、errors 与 current。
