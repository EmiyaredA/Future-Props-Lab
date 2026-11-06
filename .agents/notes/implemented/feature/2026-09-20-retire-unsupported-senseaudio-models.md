# Agent Note: 硬删下架旧 SenseAudio 默认模型

Status: implemented

## Problem

`r0068` 只向已有库追加官方新模型，存量旧 slug（如 `sensenova-6.7-flash-lite`、`deepseek-v4-pro`）仍出现在模型服务与测试选择器中。产品决定正式下架这些已不在官方列表中的默认条目。

## Decision

以 `r0069_retire_unsupported_senseaudio_models` 在**所有 Workspace** 硬删固定旧 slug，并在删除前把 `workspace_defaults:{ws}` 中指向旧 `model_id` 的默认项重映射到同空间替代模型（无替代则去掉该键）。历史对话/任务经 FK `ON DELETE SET NULL` 清空 `model_id`，保留消息中的 `model_slug` 文案。这翻转了 [SenseAudio 默认模型目录同步](./2026-09-20-senseaudio-catalog-sync.md) 中「升级不删除存量旧模型」的约定，仅针对本清单中的官方下架项。

## Alternatives considered

- **仅 `enabled=false`** — 模型服务管理页仍可见「已停用」，不符合「从模型服务去掉」的产品意图。
- **只清本机正式数据、不加 migration** — 其他已有安装升级后仍残留旧条目。
- **删除时同步清调用日志** — 日志以 slug 字符串存档，无需也不应改写审计历史。

## Consequences

- **收益**：升级后目录与官方当前列表一致；默认模型自动落到替代项。
- **代价与已知上限**：用户曾手工保留的同名旧 slug 也会被删；画布草稿等无 FK 的 `model_id` 可能短暂孤儿，下次选择时需重选；升级时有进行中任务不阻断 migration。

## Verification

- `uv run pytest tests/runtime/test_sqlite_storage.py tests/integration/test_catalog_seed.py -q`
- `npm run verify-notes`
