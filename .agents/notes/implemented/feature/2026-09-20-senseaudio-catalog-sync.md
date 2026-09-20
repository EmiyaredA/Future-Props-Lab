# Agent Note: SenseAudio 默认模型目录同步

Status: implemented

## Problem

SenseAudio 官方模型列表持续更新，仓库默认目录仍保留已下架 slug（如 `sensenova-6.7-flash-lite`、`deepseek-v4-pro`），并缺少文档已上线的替换项。空库与已有库若不同步，新 Workspace 与升级实例会看到两套不一致的默认可选项。

## Decision

以 [SenseAudio 模型列表](https://docs.senseaudio.cn/guides/account/model-list) 为对照，只同步**已支持能力**的默认目录：更新 `SAYFLOW_TEXT_CATALOG`，并用 `r0068_senseaudio_catalog_sync` 对 default 固定 OpenAI / Music provider 幂等追加新 slug。默认 seed 移除文档已无项；升级**不删除**存量旧模型行。ASR 仍只挂 Pro 说话人识别与独立 `senseaudio_asr_pro`，不接入 TTS、同声传译、人声分离、`senseaudio-a1` 等未支持协议。图片尺寸白名单保留 `senseaudio-image-1.0`，避免存量生成失败。

## Alternatives considered

- **全量接入文档全部能力（含 TTS / 人声分离等）** — 需要新 `provider.kind`、适配层与产品入口，超出「更新支持列表」范围。
- **升级时 DELETE 文档已下架 slug** — 可能打断用户已选默认模型与历史任务引用；与既有「升级不覆盖用户目录」契约冲突。
- **只改 seed、不加 migration** — 已有库 `revision != 0` 时启动种子不会回填，升级实例永远看不到新默认模型。

## Consequences

- **收益**：新空库与 default 升级库的默认可选项与官方当前列表对齐；旧 slug 在已有库中仍可用。
- **代价与已知上限**：非 default Workspace 的固定 ID migration 不会自动追加（与 `r0004` 同类）；文档未标 VL 的 `qwen3.8-27b` 未声明 `vision`；官方 ASR 变体未进入产品目录。

## Verification

- `uv run pytest tests/test_catalog_seed.py tests/test_sqlite_storage.py -q`
- `npm run db:migrate:check`
- `npm run verify-notes`
