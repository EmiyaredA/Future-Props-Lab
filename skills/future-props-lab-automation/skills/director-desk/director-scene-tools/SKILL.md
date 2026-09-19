---
name: director-scene-tools
description: Runs Director Desk scene tools in the open WebGL editor via director.call_tool. Use when reading or editing a 导演台 scene, exporting, or checking geometry.
---

# director-scene-tools

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>" --write` → `fpl status`。只读授权不能改场景、导出或取消任务。
2. 先按 `director-project-library` 拿到项目 ID，并 `fpl open director <project_id>`。编辑器必须保持打开。
3. `fpl call` 的 `--input` 是 SDK 关键字 JSON。工具参数以 `fpl operations director.call_tool` 为准。
4. 409 或结果含 `REVISION_CONFLICT` 时先重新 `director_read`，用新的 `request_id` 再提交。禁止静默重试。

## 何时使用

在已经打开的导演台工程里查询或修改当前场景、预览、导出，或查询长任务。

## 不在范围

新建和改名 → `director-project-library`。不要用 `patch_project` 替换场景 JSON。不要用 `fpl wait`。没有应用内模型，也不要另起 MCP。

## 方法

只使用 `director.call_tool`。`body.name` 是工具名，`body.arguments` 是该工具的参数，`body.request_id` 是这一次调用的幂等键。

先读后写：`director_read`、`director_assets`、`director_motions`、`director_spatial`、`director_nodes`、`director_path_surface`、`director_stride`、`director_continuity`、`director_skill`、`director_help`。

改当前场景用 `director_apply`。独立戏段用 `director_scene`。撤销用 `director_history`。预览时间用 `director_view`。导入或查看画面素材用 `director_media`。

长任务：`director_scan` 或 `director_export` 返回任务后，用 `director_job` 查询；取消时 `arguments.cancel` 为 true。不要用 `fpl wait`。

## 工作流

1. 确认 `fpl open director <project_id>` 已经打开编辑器。
2. `director_read` 读取 `revision` 和当前戏段。
3. 需要目录时再调用 `director_assets` 或 `director_motions`，不要先扫全库。
4. `director_apply` 带上刚读到的 `revision`、工具自己的 `requestId`，以及新的 `body.request_id`。
5. 再 `director_read` 核对。导出或扫描则轮询 `director_job`。

## 最小可运行示例

```bash
fpl open director <project_id>
echo '{
  "project_id":"<id>",
  "body":{
    "name":"director_read",
    "arguments":{"sections":["scene"]},
    "request_id":"read-1"
  }
}' | fpl call director.call_tool --input -
```

## 失败处理

- `editor_not_open` 或 409 且工程未打开 → 先 `fpl open director <id>`，不要改 JSON 顶上。
- `REVISION_CONFLICT` → 重新 `director_read`，换新的 `request_id` 和工具 `requestId`。
- 未知工具 → `fpl operations director.call_tool`。
- 同一 `request_id` 成功后不要改参数再发；那次结果会被直接返回。

## 相关 skill

`director-project-library`、`fpl-connect`、`fpl-contracts`。
