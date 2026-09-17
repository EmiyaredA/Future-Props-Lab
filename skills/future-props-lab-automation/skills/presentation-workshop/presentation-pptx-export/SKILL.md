---
name: presentation-pptx-export
description: Exports Future Props Lab presentation projects to PPTX via presentation.export_pptx. Use when downloading a .pptx file from presentation workshop (not in-app slideshow playback).
---

# presentation-pptx-export

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 下载必须加 `--output`；导出 body 带 `expected_revision`。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

需要从演示工坊项目得到 `.pptx` 文件。

## 不在范围

幻灯片内容编辑 → `presentation-slides-editing`。不要自动化 App 内放映引擎。

## 方法

- `presentation.get_project`（刷新 `revision`）
- `presentation.export_pptx`，body 含 `expected_revision`

## 工作流

1. `get_project` → `revision`。
2. `export_pptx` + `--output`。
3. 可选：`fpl open presentation <id>` 仅打开 UI。

## 最小可运行示例

```bash
fpl call presentation.get_project --input '{"project_id":"<id>"}'
fpl call presentation.export_pptx \
  --input '{"project_id":"<id>","body":{"expected_revision":N}}' \
  --output ./deck.pptx
```

## 失败处理

- revision 过期 → 重新 get 后再导出。
- 下载失败 → 检查路径权限；不要静默重提导出。

## 相关 skill

`presentation-slides-editing`、`workshop-project-library`。
