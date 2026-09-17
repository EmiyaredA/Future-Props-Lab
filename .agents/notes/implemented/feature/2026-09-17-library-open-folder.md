# Agent Note: 文件管理打开文件库本地目录

Status: implemented

## Problem

文件管理页需要在运行 Studio 的本机打开当前 Workspace 的库级素材目录，与现有工坊「打开项目文件夹」一致；同时去掉页头无信息量的 eyebrow。

## Decision

- `POST /v1/file-storage/open-folder` 打开 `AssetStorage.target_root` 解析出的 `library/assets`（default Workspace 与非 default 路径规则不变）。
- 复用 `project_folders._open_folder`；目录缺失返回 `409 library_folder_missing`，不静默创建。
- 仅浏览器 Session 可用（`403 browser_session_required`），权限登记在 `content.write`。
- 文件管理页头右侧放「打开本地文件夹」按钮；去掉「工作空间」与集成中心「Workspace 能力目录」eyebrow。

## Alternatives considered

- **打开当前浏览的虚拟子文件夹** — 库内文件夹是 DB 逻辑树，磁盘不以同名目录镜像；打开子路径会误导用户并暴露存储键布局。
- **前端直接调 Electron/shell** — Web 与桌面共用后端 reveal 契约，避免双通道与权限绕过。
- **缺失时 mkdir 再打开** — 与项目 open-folder 不一致，会掩盖「库尚未落盘」状态。

## Consequences

- **收益**：用户可用系统文件管理器查看库根目录；契约与三个工坊 open-folder 对齐。
- **代价与已知上限**：空库或从未写入时目录可能不存在；只读成员无 `content.write` 时按钮会失败。逻辑文件夹树的可读 ZIP 导入导出见 [library-folder-import-export](2026-09-17-library-folder-import-export.md)，不由此按钮提供。

## Verification

- `uv run pytest tests/test_project_snapshots.py -k open_folder`
- `npm run test --workspace web -- file-storage-migration`
- `npm run contracts:check`、`npm run verify-notes`
