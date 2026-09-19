---
name: director-project-library
description: Lists, creates, renames, and opens Director Desk projects via fpl. Use when managing 导演台 projects before scene editing.
---

# director-project-library

## 前置（单独安装时必做）

1. `fpl connect --name "<代理名>"` → `fpl status`。
2. `fpl call` 的 `--input` 是 SDK 关键字 JSON；文件用 `--file`；下载用 `--output`。
3. 改名带 `expected_revision`；409 时重新读取再写，禁止静默重试。
4. 更全约定可另装 `fpl-connect` / `fpl-contracts`。

## 何时使用

管理导演台工程：列出、新建、改名、删除、打开页面。不改场景。

## 不在范围

场景读写、摆位、导出 → `director-scene-tools`。没有应用内模型，也不要另起 MCP。

## 方法

- `director.list_projects` / `create_project` / `get_project` / `patch_project` / `delete_project`
- 文件：`upload_project_file` / `download_project_file`；动作库：`list_motions` / `get_motion` / `save_motion` / `delete_motion`
- 打开页面：`fpl open director <project_id>`，只导航，不执行工具

## 工作流

1. `fpl call director.list_projects --input '{}'`。
2. 创建时 `body` 只含 `title`。不要在创建或改名时提交 `document` 来改场景。
3. 保留返回的 `id` 与 `revision`。
4. 改名：`patch_project` 只传 `title` 和 `expected_revision`。
5. 删除使用新鲜 `get_project` 的 `expected_revision`。
6. `fpl open director <project_id>`，等编辑器打开后再用场景工具。

## 最小可运行示例

```bash
echo '{"body":{"title":"夜街预演"}}' | fpl call director.create_project --input -
fpl open director <project_id>
fpl call director.patch_project --input '{"project_id":"<id>","body":{"title":"夜街","expected_revision":0}}'
```

## 失败处理

- capabilities 无方法 → 当前 App 未开放导演台。
- 删除或改名 409 → 重新 get revision 后再提交，换新请求，不要静默重试。

## 相关 skill

`fpl-connect`、`fpl-contracts`、`director-scene-tools`。
