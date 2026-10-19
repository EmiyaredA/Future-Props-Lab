# Agent Note: 演示工坊段落列表

Status: implemented

## Problem

文本框仅有圆点开关，无法表达自动编号列表；编辑态圆点使用行内前缀，长行换行时与放映的悬挂缩进不一致。

## Decision

列表仍由原生文稿的平面段落表达。保留既有 `bullet` 布尔字段，增加缺省为 false 的 `numbered` 字段，后端拒绝两者同时启用。连续编号段落从 1 开始，中间遇到普通或圆点段落即重新计数；软换行不创建新列表项。

右侧面板和文字浮动栏使用同一组选项，整框选择作用于全框，文字编辑时作用于当前或所选段落。回车继承列表标记，空项回车清除标记。编辑态、静态画布共用悬挂缩进规则；PPTX 使用原生 `buAutoNum` 和 `buChar`，保持可编辑。迁移 0099 仅为旧段落补齐 false，不推进 revision、更新时间或修改已有项目符号；ORM 仍使用原有 JSON 列。

## Alternatives considered

- 将 Tiptap 列表树持久化：会引入第二套文稿结构，并使既有按段落保存的编辑、SDK 与 PPTX 契约复杂化。
- 手动给文字加数字前缀：无法随插入、删除及切换类型重新编号，导出后也缺少原生列表语义。

## Consequences

保留旧项目和调用者的圆点语义，三种列表状态有明确校验。当前仅支持单层十进制编号与圆点，不支持自定义起始值和多级列表。列表计数由段落顺序派生，不持久化显示数字。

## Verification

PPTX 仅在每组首段写入 `startAt=1`，后续项使用自动递增，避免将各项数字钉死；遵循 [DrawingML 自动编号契约](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.autonumberedbullet)。

- `tests/test_presentation_lists.py`：临时库迁移、幂等、API 保存与 CAS、原生 PPTX 编号和重启。
- `web/tests/presentation-lists.test.tsx`：编辑转换、显示编号、混合选择、权限与锁定、段落选区及回车行为。
- 契约生成与 stale-check、演示工坊回归、格式与 lint、Web 构建和官方导入包校验。
