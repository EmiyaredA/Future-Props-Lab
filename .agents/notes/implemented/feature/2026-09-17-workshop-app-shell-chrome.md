# Agent Note: AI 应用壳粘性顶栏与统一侧栏

Status: implemented

## Problem

进入 AI 应用后的项目列表层，顶栏（标题 / 主操作 / 外观）会随文档滚动离开视口；各工坊侧栏与门户一级轨视觉过于接近，且窄屏/收起时把 `.workshop-sidebar` 的 `padding-top` 清零，品牌标贴住视口顶边。演示工坊列表又游离在 `WorkshopShell` 之外，无法共享同一套壳契约。

## Decision

AI 应用项目列表层统一走应用壳交互约束，门户 Studio 轨不在本次范围：

- `WorkshopShell` 锁 `100dvh`，主区 `.workshop-main` 内滚动；列表页用共享 `WorkshopAppChrome`（粘性：标题 + 操作 + 外观）。
- 应用侧栏保持「展开为主」：品牌 + 返回应用中心 + 文字导航；收起态为方形图标按钮轨（无门户式图标下文案），并保留顶距。
- 窄屏不再对 `.workshop-sidebar` 施加 `padding-top: 0`；门户 `.studio-sidebar` 行为不变。
- 演示工坊项目列表接入 `WorkshopShell`；编辑器仍全屏脱离壳。思绪继续自管壳，但侧栏复用 `WorkshopSidebar`、顶栏/主区滚动与顶距对齐同一规范。
- 画布、Galgame/视频/演示编辑器等更深一层不受此约束。

相关 Studio 双栏决策见 [Studio 双栏壳与极简顶栏](./2026-09-17-studio-dual-sidebar-chrome.md)（该 Note 明确把工坊壳留给后续决策，本篇即该后续）。

## Alternatives considered

- **只钉住外观条（顶栏方案 A）** — 改动更小，但标题与新建等主操作仍会滚走，达不到「上边栏始终在上」的产品约束。
- **默认窄轨侧栏（侧栏方案 B）** — 更接近门户气质，但与「应用侧栏不要和最外层一致」冲突；用户选定展开为主。
- **门户轨一并加大顶距** — 同类贴顶感可一并缓解，但本次约束只针对进入应用后；用户明确只要修应用内。
- **演示工坊只做 sticky 顶栏、不加侧栏** — 少改路由，但五个 AI 应用壳不一致；用户要求补统一侧栏。

## Consequences

- **收益**：视觉 / Galgame / 视频 / 演示列表共享同一壳与粘性 chrome；应用侧栏与门户轨可区分；品牌标不再贴顶。
- **代价与已知上限**：思绪仍是平行壳实现，只做视觉/间距对齐；深度编辑器未统一。若以后要把思绪也挂到 `WorkshopShell`，需另评估知识库目录与移动抽屉。

## Verification

- `npx vitest run tests/presentation-ui.test.tsx`（web 目录）
- 目视：各应用项目列表滚动时 `WorkshopAppChrome` 固定；侧栏收起/≤1200px 品牌有顶距；演示列表有返回应用中心侧栏；门户轨顶距未改。
