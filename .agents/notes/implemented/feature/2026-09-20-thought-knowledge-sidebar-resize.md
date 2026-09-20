# Agent Note: 思绪工坊知识库侧栏可拖拽调宽

Status: implemented

## Problem

知识库导航与正文之间的分界是固定 `236px`，长标题或深目录时侧栏过窄，宽屏写文档时又占掉过多正文；用户需要拖动边界调节宽度。

## Decision

在 `knowledge-sidebar-track` 右侧放置可聚焦的 `role="separator"` 拖拽条（`KnowledgeSidebarResize`），用 CSS 变量 `--knowledge-sidebar-width` 驱动轨道宽度；范围夹在 180–420px，默认 236px。拖动提交后写入 `localStorage` 键 `future_props_thought_knowledge_sidebar_width`，键盘左右箭头与双击恢复默认与视频剪辑分隔条行为对齐。`≤1200px` 抽屉模式下隐藏分隔条，不改变移动端遮罩布局。

实现留在 `thought-workshop` 内，不跨 App 引用 `VideoEditorSeparator`，也不抽到 `shared/`——当前只有思绪知识库壳需要这一条固定像素侧栏。

## Alternatives considered

- **复用 `VideoEditorSeparator`** — 行为成熟，但会形成 App 间依赖，架构测试禁止。
- **抽到 `shared/ui` 通用分隔条** — 过早抽象；剪辑工坊与思绪的视觉/布局约束不同。
- **按视口比例存宽** — 与现有视频剪辑像素偏好不一致，且知识库壳宽度更接近固定导航栏。

## Consequences

- **收益**：桌面宽屏可按目录深度调侧栏；刷新后保留偏好。
- **代价**：偏好只存本机，不跟账号同步；窄屏仍走抽屉，无拖拽。

## Verification

- `npm run test --workspace web -- --run tests/workshop-sidebar.test.tsx`
