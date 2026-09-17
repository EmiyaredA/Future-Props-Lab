---
name: workshop-project-library
description: Automates Future Props Lab workshop home project libraries—list, create, rename, delete, snapshots, open App pages. Use when managing workshop projects before in-document editing (visual, galgame, video, presentation, annotation).
---

# workshop-project-library

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. `fpl call` 的 `--input` 是 SDK 关键字 JSON；文件用 `--file`；下载用 `--output`。
3. 写入带 revision；409 时重新读取再写，禁止静默重试。
4. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

工坊**主页 / 项目库**管理（创建、查找、重命名、删除、快照、在 App 中打开）。不做画布/剧本/时间轴/笔记正文编辑。

## 不在范围

文档 `apply_*_operations`、项目内素材、生成/渲染/ASR → 各应用子 skill。思绪工坊 → `thought-knowledge-library`。

## 决策树（先选 resource）

| 产品面 | SDK resource | `fpl open` kind |
|--------|--------------|-----------------|
| 视觉创作工坊 | `visual` | `visual` |
| Galgame 工坊 | `galgame` | `galgame` |
| 视频剪辑工坊 | `video` | `video` |
| 演示工坊 | `presentation` | `presentation` |
| 录音标注 | `annotation` | `annotation` |
| 思绪工坊 | — | 用 `thought-knowledge-library` |

## 方法

- visual / galgame / video：`list_projects`、`create_project`、`get_project`、`patch_project`、`delete_project`；快照 `export_project_snapshot` / `import_project_snapshot`；桌面 `reveal_project_folder`
- 演示：`list_projects`、`create_project`、`get_project`、`put_project`、`delete_project`（无统一项目快照 API）
- 标注：`annotation.*` 同类 CRUD（创建通常先 `files.upload_file`）

## 工作流

1. 从表格确定 resource。
2. `fpl call <resource>.list_projects --input '{}'`。
3. 创建：`body` 至少含 `title`（视觉还需 `kind`，如 `"canvas"`）。
4. 保留返回的 `id` 与 `revision`。
5. 重命名：`patch_project` / 演示用 `put_project`（字段以 `fpl operations` 为准）。
6. 删除：用新鲜 `get_project` 的 `expected_revision`。
7. `fpl open <kind> <project_id>`。

## 最小可运行示例

```bash
echo '{"body":{"title":"新画布","kind":"canvas"}}' | fpl call visual.create_project --input -
fpl open visual <project_id>

echo '{"body":{"title":"新剧情"}}' | fpl call galgame.create_project --input -
echo '{"body":{"title":"新时间轴"}}' | fpl call video.create_project --input -

fpl call visual.export_project_snapshot --input '{"project_id":"<id>"}' --output ./project.snapshot.zip
```

## 失败处理

- capabilities 无方法 → App 未开放该工坊。
- 删除 409 → 重新 get revision 后再删。

## 相关 skill

`fpl-connect`、`fpl-contracts`；创建后进入对应编辑 skill。
