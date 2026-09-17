---
name: visual-project-assets
description: Manages Visual Workshop project asset references—import_assets and create/patch/delete asset-reference. Use when attaching library files to a visual project before or after canvas editing.
---

# visual-project-assets

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 上传文件用 `--file FIELD=PATH`；写入遵守 revision；禁止静默重试。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`；上传常先用 `files-library`。

## 何时使用

把文件库素材挂进视觉项目，或维护 asset-reference。

## 不在范围

画布节点 → `visual-canvas-editing`。生成任务 → `visual-generation-tasks`。

## 方法

- `visual.import_assets`
- `visual.create_asset_reference` / `patch_asset_reference` / `delete_asset_reference`

## 工作流

1. 如需：`files.upload_file` / `files.list_files`。
2. `import_assets` 或 `create_asset_reference`（字段见 `fpl operations`）。
3. 在画布 operations 中使用返回的素材/引用 id。
4. 补丁/删除的 revision 以 schema 为准。

## 最小可运行示例

```bash
fpl call files.upload_file --input '{"body":{}}' --file upload=./image.png
fpl operations visual.import_assets
# 按 operations 输出组装 import_assets / create_asset_reference 的 JSON，再：
# fpl call visual.import_assets --input '{...}'
fpl call visual.get_canvas --input '{"project_id":"<id>"}'
```

## 失败处理

- 缺 asset_id → 先上传/列表文件库。
- 409 → 重新 get 项目/画布相关 revision。

## 相关 skill

`files-library`、`visual-canvas-editing`。
