# Agent Note: 视觉工坊素材库三 Tab 语义

Status: implemented

## Problem

画布与项目素材库把 Workspace「文件管理」公共库标成「跨项目」，而真正从其他视觉项目复制导入的能力只存在于生成侧 picker，导致用户无法从素材库进入正确的三层来源。

## Decision

视觉工坊素材库固定三个 Tab，顺序为 **本项目 / 跨项目 / 总文件**：

- **本项目**：浏览当前视觉项目文件（含引用视图），可上传与管理。
- **跨项目**：默认「全部」聚合其他视觉项目文件；筛选弹层可收窄到单一来源项目。「导入」走 `asset-imports`（`source_scope: project`）复制到本项目。
- **总文件**：浏览与 Studio「文件管理」相同的 Workspace 公共库，「导入」走 `asset-references` 建引用。

`AssetBrowser` 用 `importSource: "library" | "cross-project"` 区分导入语义；跨项目来源列表由视觉工坊父组件传入，避免 `files` 反向依赖 `visual-workshop`。compact 模式下来源项目选择放在筛选 popover，不单独占一行。画布抽屉与独立素材页共用同一套 Tab 语义。生成对话框 `ProjectMediaSourceDialog` 保持独立，不合并 UI。

## Alternatives considered

- **只改文案，把原「跨项目」改成「总文件」且不加第三 Tab** — 无法覆盖「从其他视觉项目复制」的用户意图，与生成侧已有能力分裂。
- **让 `AssetBrowser` 直接调用 `getVisualWorkshopProjects`** — 会让 `files` 依赖 `visual-workshop`，违反 feature 边界；改为父组件注入 `sourceProjects`。
- **把生成侧 picker 嵌进素材库代替第三 Tab** — 生成选图与素材管理交互模型不同（多选限额、按 media kind 过滤），复用 API 即可，不合并表面。

## Consequences

- **收益**：Tab 文案与数据源一致；公共库引用与跨项目复制不再混用同一标签。
- **代价与已知上限**：跨项目 Tab 需要额外加载项目列表；侧栏三 Tab 字号略缩以适应 336px 宽度。生成侧仍有「其他项目 / 公共库」子切换，与素材库三 Tab 并存。总文件写能力（建夹/上传公共库）见 [总文件 Tab 可管理公共库](2026-09-18-library-tab-manage.md)。

## Verification

- `web/tests/visual-workshop-canvas-assistant.test.tsx`：三 Tab 切换文案。
- `web/e2e/applications-workshop.spec.ts`：点「总文件」可见「添加素材」与公共库空态；素材页可见「跨项目」「总文件」。
- `npm run verify-notes`。
