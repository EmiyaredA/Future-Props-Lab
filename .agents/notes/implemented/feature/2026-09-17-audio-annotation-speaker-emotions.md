# Agent Note: 音频标注情绪按说话人绑定

Status: implemented

## Problem

多说话人片段只能存一条 `emotion`，无法表达“同一时段不同角色不同情绪”；侧栏若继续写片段级情绪，标注时也无法明确作用对象。

## Decision

片段文档增加 `speaker_emotions: [{speaker_id, emotion}]`，情绪必须绑定到该片段已选说话人；保留 `emotion` 作兼容字段：仅有旧 `emotion` 时在校验阶段展开到全部 `speaker_ids`，多人情绪不一致时 `emotion` 置空。侧栏先勾选绑定说话人（含全选）再写入对应条目。

## Alternatives considered

- **只保留片段级 emotion，UI 勾选仅作确认** — 无法表达同片段多情绪，列表也无法按人展示。
- **用 `Record<speaker_id, emotion>` 对象** — 不如数组稳定且难做 OpenAPI 约束与重复校验。

## Consequences

- **收益**：广播剧叠音片段可按角色标注情绪；旧 JSON/文档仍可读。
- **代价与已知上限**：导入导出与搜索需同时看 `speaker_emotions`；删说话人时要剪掉对应情绪条目。
- **后续**：项目级自定义情绪词库见 [audio-annotation-custom-emotions](./2026-09-17-audio-annotation-custom-emotions.md)。

## Verification

`uv run pytest -q tests/apps/audio_annotation/test_audio_annotation.py`；`npm run test --workspace web -- tests/audio-annotation-emotion-field.test.tsx`；`npm run contracts:check`。
