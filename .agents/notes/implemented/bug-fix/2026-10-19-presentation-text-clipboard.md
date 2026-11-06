# Agent Note: 演示工坊文字剪贴板保留纯文本

Status: implemented

## Problem

幻灯片文字编辑器通过清空 `transformPastedHTML` 的结果来阻止外部富文本格式。ProseMirror 在调用该转换前已经选择 HTML 解析分支，不会退回剪贴板的纯文本。同一文本框复制、网页或文档复制通常同时提供 HTML 和纯文本，因此粘贴无内容，甚至用空切片删除选中文字。

## Decision

`SlideTextEditor` 在原生 paste 事件入口读取 `text/plain`，阻止默认粘贴，并通过 `view.pasteText` 交给 ProseMirror 的纯文本解析与事务流程。换行、选区替换、当前位置样式和现有文稿保存/历史回调继续由编辑器负责。没有文字的剪贴板不修改选区；复制沿用 ProseMirror 的原生序列化。画布元素级剪贴板与系统平台快捷键不变。

纯文本解析仍会通过浏览器 DOM 往返当前位置的样式，浏览器将十六进制颜色序列化为 `rgb()`。`textAdapter.fromEditor` 将合法 RGB 颜色归一化为文稿约定的六位十六进制，无法识别的颜色沿用已校验的 fallback，避免粘贴后保存被 API 的颜色校验拒绝。

## Alternatives considered

- 直接移除 HTML 转换：可恢复文本，但同时引入原本不接受的外部格式和段落属性。
- 继续在 HTML 转换中置空：不能触发纯文本回退，仍会丢失内容。

## Consequences

普通粘贴与纯文本粘贴都插入剪贴板文字，不导入来源格式或图片。依赖浏览器提供的纯文本表示；仅有图片或 HTML 且没有纯文本时保持正文与选区。Mac 沿用系统的 Command 复制粘贴快捷键。

## Verification

`web/tests/features/presentation-clipboard.test.tsx` 覆盖纯文本与 HTML/纯文本双格式粘贴、换行、选区替换、同框复制再粘贴、一次更新回调以及无文字时不删除选区。修复前双格式、同框粘贴和无文字三个用例失败。

`web/tests/features/presentation-document.test.ts` 验证颜色归一化与非法值回退；`web/e2e/presentation-history.spec.ts` 使用实际键盘复制粘贴，验证撤销重做与保存后重开内容。
