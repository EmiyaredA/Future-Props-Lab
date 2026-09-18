# Agent Note: 视觉工坊画布素材拖放建节点

Status: implemented

## Problem

画布素材库抽屉（本项目 / 跨项目 / 总文件）只能预览或导入，不能把已有媒体直接放到画布。用户要得到带 `asset_id` 的节点，只能走上传、右键空节点再检查器绑定，或裁剪派生，路径绕且与「拖到落点」预期不符。

## Decision

画布素材抽屉启用 HTML5 DnD：`AssetBrowser` 仅在传入 `onAssetDragStart` 时对 image/video/audio 可拖；契约 MIME 为 `application/x-fpl-canvas-asset`，由 `canvasAssetDrag.ts` 读写。画布表面 `onDragOver`/`onDrop` 用 `screenToWorld` 落点，经 `createMediaNodeFromAsset` 写入与上传相同的媒体节点形状。

跨项目与总文件在 drop 时先走现有导入：总文件 `importFile`（引用，id 不变）；跨项目 `importManagedFiles`（复制，**必须用返回的新 id**）。本项目直接建节点。拖放成功不强制切回「本项目」tab，避免打断连续拖放；仍 `invalidateFileScope`。独立素材库页不启用拖源。

## Alternatives considered

- **仅本项目可拖，跨项目/总文件必须先点导入** — 实现更简单，但截图场景与用户预期都是从「总文件」直接拖到画布；额外一步导入与落点意图重复。
- **引入 @dnd-kit / react-dnd** — 能力更强，但项目已有 HTML5 DnD（`ProjectMediaPicker`），为单条跨面板拖放引入库不划算。
- **把 MIME 契约放进 `features/files`** — 会让共享浏览器知道画布语义；改为回调 `onAssetDragStart`，契约留在 visual-workshop，files 保持无业务拖放知识。

## Consequences

- **收益**：三 tab 媒体均可拖到落点成节点；保存校验所需的项目归属/引用在 drop 路径内满足。
- **代价与已知上限**：OS 本机文件仍走上传入口；font/document 不可拖；跨项目导入是复制，节点引用新 asset。相关：[`2026-09-18-visual-workshop-asset-library-tabs.md`](./2026-09-18-visual-workshop-asset-library-tabs.md)。

## Verification

- `web/tests`：本项目 drop 建节点；总文件先 `importFile`；跨项目用导入返回 id；非媒体不启用拖源。
- 手动：打开画布素材库，从三 tab 各拖一张图到空白处，确认节点带预览且能保存。
