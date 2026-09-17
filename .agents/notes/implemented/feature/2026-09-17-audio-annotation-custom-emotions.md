# Agent Note: 音频标注自定义情绪词库

Status: implemented

## Problem

片段只能用静态预设或一次性自由文本写情绪；自定义值不进项目词库，侧栏也无法像说话人那样预建、复用和管理情绪名，快速输入还容易重复入库。

## Decision

标注文档顶层增加 `custom_emotions`（最初为 `string[]`，后演进为带颜色的对象列表，见 [audio-annotation-custom-emotion-colors](./2026-09-17-audio-annotation-custom-emotion-colors.md)；最多 64，名称 1–40 字符，按 casefold / `zh-CN` locale 键去重），与 `speakers`/`segments` 一并 CAS 保存与导出。内置 `EMOTION_PRESETS` 只读；侧栏「管理」维护自定义词库，自定义「使用」在写入 `speaker_emotions` 的同时尝试入库，与预设或词库冲突时不重复写入并给出内联警告。重命名自定义项时同步改写片段中同键情绪文案；删除仅移出词库，已标注值保留。

相关：按说话人绑定情绪见 [audio-annotation-speaker-emotions](./2026-09-17-audio-annotation-speaker-emotions.md)。

## Alternatives considered

- **仅从前端聚合片段已用情绪，不落库** — 刷新丢失，也无法预建尚未使用的词条。
- **把内置预设改成可编辑名单** — 破坏跨项目一致性，导入导出语义更重。

## Consequences

- **收益**：广播剧可维护项目级情绪词库；快速新增有明确去重警告。
- **代价与已知上限**：文档 JSON / OpenAPI 多一列；旧文档缺省 `[]`；删词库项不会清片段标注。

## Verification

`uv run pytest -q tests/test_audio_annotation.py`；`npm run test --workspace web -- tests/audio-annotation-emotion-field.test.tsx`；`npm run contracts:check`。
