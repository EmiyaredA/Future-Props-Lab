# Agent Note: Studio 三浮层 Chrome Panel

Status: implemented

## Problem

Studio 双栏壳落地后，侧栏、顶栏与主内容仍贴边拼成一整块平面，缺少「侧栏 / 顶栏 / 主内容」三块独立浮层、细缝露浅亮橙底的产品壳层语言；若把首页 destination 卡片当成浮层，又会与用户框定的壳层三分法混淆。

## Decision

Studio 全局壳固定为三块 `.studio-panel` 浮层：左侧导航、顶栏、主内容。窗口背景用 `--studio-shell-bg`（浅亮橙；暗色为低饱和暖底），仅通过约 8px（窄屏 6px）的 padding/gap 露出。Panel 使用 `--studio-panel-radius` 与 `--studio-panel-shadow`（多层外阴影 + 顶部内高光）做克制 3D 浮起。壳层 `height: 100dvh` + `overflow: hidden`，三块 panel 位置固定；滚动只在主内容、二级列表或轨条目内部发生，不带动整页。

装配上 `web/src/app/layout/StudioSidebar.tsx` 的 `StudioShell` 内嵌 `StudioGlobalHeader`，`App` 不再把顶栏塞进 `studio-main`。有二级导航时，二级栏嵌在左侧 panel 内部（轨 | 二级），不另开第四块浮层。Workshop 壳层不跟进。

双栏导航语义仍见 [Studio 双栏壳与极简顶栏](./2026-09-17-studio-dual-sidebar-chrome.md)。

## Alternatives considered

- **首页三张 destination 卡片当浮层** — 视觉上容易出「浮卡」效果，但与标注的壳层三分法不符，也会把橙底推成大色块。
- **二级栏再开第四浮层** — 分组页信息更独立，但破坏「始终三块」的壳层节奏，缝隙语言变碎。
- **Workshop 同步浮层化** — 全局一致，但工坊仍走独立折叠侧栏，本次不扩大回归面。

## Consequences

- **收益**：Studio 壳层与标注图一致；顶栏成为独立 panel；二级仍可用且不增加浮层数量。
- **代价与已知上限**：`body` 背景与 shell 橙底并存时，全屏外边缘以 shell 为准；若日后要统一工坊，需另开决策。

## Verification

- `npx vitest run tests/navigation.test.tsx -t "floating chrome|integrations after tools|secondary|flyout"`：Studio 壳层与导航用例通过。
- `npm run verify-notes` 通过。
