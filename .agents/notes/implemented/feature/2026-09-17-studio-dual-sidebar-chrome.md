# Agent Note: Studio 双栏壳与极简顶栏

Status: implemented

## Problem

Studio 全局壳原先是「展开全文侧栏 / 折叠图标轨」单栏两态，顶栏是浮动胶囊。要对齐现代生产力工具常见的「一级图标轨 + 二级上下文栏 + 贴边透明顶栏」气质时，继续在单栏两态上堆样式会把一级导航与分组子页挤在同一列，叶子页也没有稳定的二级信息架构。

## Decision

Studio 全局壳改为常驻一级图标轨（图标 + 下方短标签）加可选二级栏；`WorkshopShell` 与工坊内 `ResponsiveSidebar` 折叠语义保持不变。

- 一级轨数据源在 `web/src/app/layout/StudioSidebar.tsx`：首页 / AI应用 / 文件 / 工具 / 集成为叶子；仅基模型带 children。页内 Tab 负责集成中心子类切换。
- 二级栏仅在宽屏且当前一级分区有子页时显示；叶子页强制不挂空二级栏。偏好键 `future-props-sidebar-studio-secondary-collapsed`。
- 窄屏（≤1200px）或二级收起时，分组入口走 `StudioCollapsedRail` portal flyout。
- 顶栏在 `studio-global-header.css` 曾改为贴主区顶边透明右对齐；现已由 [Studio 三浮层 Chrome Panel](./2026-09-17-studio-floating-chrome-panels.md) 收成独立浮层 panel。
- 选中态使用 `accent-soft` 软底，不再使用 inset 左边条与重阴影；色板仍消费 `theme.css` 暖米/珊瑚 token。

相关视觉刷新见 [全局 UI 刷新](./2026-09-16-global-ui-refresh.md)；工坊侧栏折叠能力仍见 [紧凑化与侧栏状态](./2026-09-16-compact-ui-density.md)。

## Alternatives considered

- **只改样式、保留单栏展开/折叠** — 改动面最小，也更能复用既有折叠测试；但无法形成图1式双层导航，分组子页仍与一级入口抢同一列宽度。
- **Studio 与 Workshop 同步改成双栏** — 全局一致，但各工坊导航由模块配置驱动且已有独立折叠记忆，一并改造会扩大回归面；本次明确只改 Studio 全局壳。
- **叶子页也常驻空二级栏** — 视觉上更接近参考产品的双栏骨架，但会浪费主内容宽度且没有可点列表，故拒绝。

## Consequences

- **收益**：Studio 一级/二级导航分层清晰，基模型子页可从二级栏直达；集成中心改由页内 Tab 切换，避免与侧栏二级重复；顶栏不再以胶囊岛打断主内容；Workshop 折叠行为未被牵动。
- **代价与已知上限**：Studio 不再使用 `future-props-sidebar-studio-collapsed` 全文展开态；旧键失效。若日后要统一工坊壳，需另开决策并评估模块导航数据模型。

## Verification

- `npx vitest run tests/navigation.test.tsx`：Studio 双栏、二级折叠记忆、窄屏 flyout、集成中心子页用例通过；文档中心用例失败与本次壳层无关。
- 目视：宽屏叶子页为 `76px | main`；仅基模型在左侧 panel 内嵌二级；顶栏为独立浮层 panel；三块 panel 固定占位，滚动仅发生在各自内部（主区 / 二级列表 / 轨条目）。
