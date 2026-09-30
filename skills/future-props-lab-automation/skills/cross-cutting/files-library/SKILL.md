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
4. Amadeus 需要理解画布关联视频时，优先使用内置 `inspect_video_reference` 工具，让代表帧进入当前多模态上下文；它只接受当前 Workspace 的视频素材，不读取音轨，也不保存联系表。

需要在独立脚本或本地多模态流程中查看帧时，使用既有 SDK/CLI 抽帧接口输出 4 帧或 9 帧联系表；CLI 的 POST 操作需要先申请写作用途授权，但抽帧本身只生成临时文件，不修改库素材：

```bash
printf '%s' '{"asset_id":"<video-asset-id>","body":{"positions_ms":[0,1000,2000,3000],"max_width":640,"output":"grid"}}' \
  | fpl call files.extract_video_frames --input - \
  --output /path/to/video-frames.png
```

提示词 Skill 应先读取联系表和 Skill 中的参考文件，再描述动作、镜头节奏及场景变化；不能只根据文件名推断视频内容。

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
