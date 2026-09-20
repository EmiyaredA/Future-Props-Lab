---
name: thought-writing-assistant
description: Runs Thought Workshop AI writing via thought.writing_models and thought.assistant event streams. Use when drafting with the writing assistant; persist accepted text via note-editing operations. In-app UI has no entry — Agent/SDK only.
---

# thought-writing-assistant

应用内无「AI 写作」入口；本 skill 与 SDK/`fpl` 是正式接入面。

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"`（付费模型调用常需 `--write`）→ `fpl status`。
2. 已有 `note_id`；流必须消费到结束并关闭。
3. **助手输出是草稿**——落盘走 `apply_note_operations` / `put_note`，不要假设已自动保存。
4. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

对笔记做 AI 辅助写作。

## 不在范围

知识库 CRUD；非 AI 的笔记编辑 → `thought-note-editing`。

## 方法

- `thought.writing_models`
- `thought.assistant`（SSE / 事件流）

## 工作流

1. `writing_models` → 选择允许的模型 id。
2. 按 `fpl operations thought.assistant` 调用 `assistant`。
3. 消费事件流至结束；勿让流悬挂。
4. 用户采纳后，用 `thought-note-editing` 写入。

## 最小可运行示例

```bash
fpl call thought.writing_models --input '{}'
fpl operations thought.assistant
```

流式在 `fpl call` 上可能不便；需要稳定消费时优先用 Python SDK 的流辅助，仍只用 SDK 方法。采纳后示例：

```bash
# 将助手文本写入笔记（N = 当前 revision）— 具体 operations 见 thought-note-editing
fpl call thought.get_note --input '{"note_id":"<id>"}'
```

## 失败处理

- 流中断 → 报告错误；不要静默重提供应商请求。
- 模型不在白名单 → 换 `writing_models` 返回的 id。

## 相关 skill

`thought-note-editing`、`thought-knowledge-library`、`fpl-contracts`。
