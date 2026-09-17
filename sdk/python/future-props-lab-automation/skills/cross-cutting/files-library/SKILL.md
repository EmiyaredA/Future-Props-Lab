---
name: files-library
description: Operates Future Props Lab workspace files library via files.*—folders, upload/list/patch/delete, download/preview, crop, and video frame extract. Use when managing shared media/docs before workshop imports.
---

# files-library

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. 上传：`--file upload=PATH`；下载：`--output`；禁止在 JSON 里塞文件字节。
3. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

在挂到各工坊之前管理共享工作区媒体/文档。

## 不在范围

工坊文档 operations；独立推理素材用 `inference.upload_asset`。

## 方法（桌面白名单）

- 文件夹：`list_file_folders`、`create_file_folder`、`patch_file_folder`、`delete_file_folder`
- 文件：`list_files`、`upload_file`、`patch_file`、`delete_file`、`download_file`、`preview_file`
- 辅助：`crop_file_image`、`extract_video_frames`、`preview_svg`、`reveal_library_folder`

## 桌面排除项

库归档导入导出与 `migrate_storage_layout` 仅全量 HTTP SDK（除非 capabilities 明确列出）。不要默认用 `fpl` 调用。

## 工作流

1. 上传或列表拿到 `id`。
2. 将 `id` 用于标注创建、视频 `import_assets`、视觉导入等。
3. 下载/预览加 `--output`（若适用）。

## 最小可运行示例

```bash
fpl call files.upload_file --input '{"body":{}}' --file upload=./clip.wav
fpl call files.list_files --input '{}'
fpl call files.download_file --input '{"file_id":"<id>"}' --output ./downloaded.bin
```

（`file_id` 字段名以 `fpl operations files.download_file` 为准。）

## 失败处理

- capabilities 无归档类方法 → 改用 HTTP SDK + API Key，不要臆造 `fpl call`。
- 上传失败 → 检查 MIME/大小；不要静默重复狂传。

## 相关 skill

各工坊素材 skill、`audio-annotation-project-and-document`。
