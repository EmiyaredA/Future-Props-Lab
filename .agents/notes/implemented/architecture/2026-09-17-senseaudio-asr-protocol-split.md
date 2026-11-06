# Agent Note: SenseAudio ASR 按接入方式拆分协议类型

Status: implemented

## Problem

接入管理侧栏按 `provider.kind` 呈现协议类型（见
[access-management-by-kind](../feature/2026-09-17-access-management-by-kind.md)）。
SenseAudio 云端说话人识别（`/v1/audio/transcriptions`）与 ASR API Pro（`/api/v2/asr/pro`）
请求体、时间戳单位、文件上限与响应形状均不同，却共用 `senseaudio_asr`，靠 `base_url` /
`#pro-asr` fragment 启发式分支；侧栏因此把两种接入方式叠成一个协议节点。

## Decision

新增独立协议类型 `senseaudio_asr_pro`；`senseaudio_asr` 仅表示云端 `/v1/audio/transcriptions`。
运行时用 `provider.kind` 选择适配契约，不再用 URL 判别协议。存量 Pro 地址或 `#pro-asr`
连接经 migration `r0061_senseaudio_asr_pro_kind` 升级为新 kind；新 Workspace seed 同时写入两条
默认停用的连接。

## Alternatives considered

- **继续用 base_url / fragment 分支同一 kind** — 实现成本最低，但与「接入方式不同即独立协议类型」
  和侧栏按 kind 分组的产品规则冲突，参数能力与文件上限也会继续依赖启发式。
- **仅改 UI 展示名、底层仍合并** — 侧栏可读性略好，但契约与适配层仍耦合，新建连接无法在表单中
  明确选择 Pro 协议。

## Consequences

- **收益**：协议类型与接入契约一一对应；侧栏、转录参数能力、上传上限均按 kind 分流。
- **代价与已知上限**：OpenAPI / SDK / 转录任务 `provider_kind` CHECK 需同步扩展；历史任务与
  连接依赖 migration 回填，fragment URL 仅在 Pro kind 下作为地址归一化残留，不再充当协议开关。

## Verification

- `tests/integration/test_provider_adapters.py`、`tests/apps/model_service/test_model_test_transcription.py`、
  `tests/integration/test_catalog_seed.py`、`tests/runtime/test_sqlite_storage.py`、
  `tests/runtime/test_sqlite_migration_history.py`
- `npm run contracts:generate` / `contracts:check`
- `npm run verify-notes`
