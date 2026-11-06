# Agent Note: 音频标注自定义情绪带颜色

Status: implemented

## Problem

自定义情绪词库只有名称，管理页色块只读，无法像说话人那样为词条指定主题色；下拉里自定义项也缺少可辨识颜色。

## Decision

`custom_emotions` 从 `string[]` 演进为 `{ name, color }[]`（最多 64；`name` 1–40 字符、按 casefold 去重；`color` 为 `#RRGGBB`）。读写与导入仍接受旧版纯字符串，并按索引分配默认色板后规范化为对象落盘。管理页自定义行与添加区使用 `CustomColorPicker`；内置预设仍只读，按 tone 着色。片段标注里的情绪文案仍是字符串，颜色只挂在词库项上。

相关：词库引入见 [audio-annotation-custom-emotions](./2026-09-17-audio-annotation-custom-emotions.md)。

## Alternatives considered

- **另增 `emotion_colors` 映射表** — 名称与颜色双源，重命名易漂移。
- **仅前端本地记颜色** — 刷新与导出丢失，无法跨端一致。

## Consequences

- **收益**：词库与说话人名单交互一致；下拉可显示自定义色。
- **代价与已知上限**：OpenAPI / 导出 JSON 形状变更；旧文档与字符串导入靠读时 coerce；已标注片段文案不随色变更。

## Verification

`uv run pytest -q tests/apps/audio_annotation/test_audio_annotation.py`；`npm run test --workspace web -- tests/audio-annotation-emotion-field.test.tsx`；`npm run contracts:generate` 后 `npm run contracts:check`。
