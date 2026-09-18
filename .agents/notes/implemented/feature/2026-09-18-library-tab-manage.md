# Agent Note: 总文件 Tab 可管理公共库

Status: implemented

## Problem

视觉工坊「总文件」Tab 与 Studio「文件管理」浏览同一 Workspace 公共库，但 `importSource="library"` 把 `AssetBrowser` 锁成只读导入，侧栏无法新建文件夹或上传文件，用户只能跳到 `/files` 才能写入。

## Decision

拆开 `AssetBrowser` 的「可管理」与「可导入」门控：

- `canManage = importSource !== "cross-project"`：本项目、总文件、文件管理可写；跨项目只读。
- `showImport = Boolean(importSource) && Boolean(projectId)`：总文件与跨项目仍显示「导入」。
- 总文件写入目标仍是公共库（`sourceProjectId=undefined`），与文件管理一致；上传后不自动进项目，仍靠 `asset-references` 导入。
- ZIP/文件夹归档仍仅 `libraryMode`（无 `projectId` 且无 `importSource`）露出，不在侧栏总文件 Tab 出现。

与 [视觉工坊素材库三 Tab 语义](2026-09-18-visual-workshop-asset-library-tabs.md) 互链：三 Tab 数据源与导入语义不变，本 Note 只扩展总文件的写能力。

## Alternatives considered

- **写入当前视觉项目** — 与「总文件 = 文件管理公共库」文案冲突，且与本项目 Tab 重复。
- **上传后自动引用进本项目** — 多一步隐式副作用，用户无法只往公共库落文件；保留显式「导入」。
- **侧栏总文件露出 ZIP/文件夹批量导入** — 压缩交互适合完整文件管理页宽度；侧栏只对齐本项目的建夹/上传。

## Consequences

- **收益**：总文件可在画布抽屉与素材页直接管理公共库，无需绕开到 `/files`。
- **代价**：总文件同时出现管理菜单与「导入」，控件略密；跨项目仍只读以免误改他项目。多源上传与上传前改名见 [总文件多源上传与上传前改名](2026-09-18-library-multi-source-upload.md)。

## Verification

- `web/tests/file-management.test.tsx`：`importSource="library"` 可建夹（`projectId` 为 `undefined`）且仍可「导入」。
- `web/e2e/applications-workshop.spec.ts`：点「总文件」可见「添加素材」与可管理空态。
- `npm run verify-notes`。
