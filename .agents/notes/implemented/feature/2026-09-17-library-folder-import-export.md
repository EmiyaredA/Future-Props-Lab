# Agent Note: 公共库文件夹导入导出

Status: implemented

## Problem

文件管理公共库需要把逻辑文件夹树带走或从本机目录/ZIP 批量带回，同时不能让用户误以为 `library/assets` 磁盘布局与页面树一致，也不能引入 Finder 双向同步。

## Decision

- 仅作用于公共库（`project_id is None`）；不覆盖各工坊项目素材夹。
- 导出 `GET /v1/file-library/folder-exports`：生成可读相对路径 ZIP（显示名 + 逻辑目录），包级上限复用 `project_snapshot_max_*`。
- 导入两条：`POST .../folder-archive-imports`（ZIP）与 `POST .../folder-entry-imports`（`files` + `relative_paths`，供 webkitdirectory）。
- 同名文件夹 merge；文件允许同名；超深度/不支持类型/不安全路径进入 `skipped`，允许部分成功。
- 磁盘仍按 `storage_key` 扁平落盘；实现位于 `files/library_folder_archive.py`，权限分别为 `content.read` / `content.write`；Agent 通道默认不开放。

## Alternatives considered

- **磁盘镜像双向同步** — 与引用、CAS、权限和「勿手工挪运行目录文件」冲突，复杂度过高。
- **复用 project-snapshot 专有 manifest** — 对「带走可读树」不友好；本能力优先 Finder 可打开的普通 ZIP。
- **打开本地文件夹即等于导出** — open-folder 只 reveal 扁平库根，不能表达逻辑树。

## Consequences

- **收益**：可批量备份/迁移公共库目录树；导入载体覆盖 ZIP 与本机选文件夹。
- **代价与已知上限**：部分成功需用户阅读 skipped；超大树受快照包级上限约束；空本机文件夹不会出现在 webkitdirectory 选择结果中。

## Verification

- `uv run pytest tests/test_library_folder_archive.py`
- `npm run contracts:generate` 后 `npm run contracts:check`
- `npm run verify-notes`
