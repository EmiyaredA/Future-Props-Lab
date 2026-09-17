# Agent Note: 视觉画布顶栏「新建窗口」

Status: implemented

## Problem

视觉创作工坊画布是全屏路由，不经过 `StudioShell`，用户看不到全局顶栏的「新建窗口」。
在画布上对照编辑或旁开同项目时，只能靠菜单/`Cmd+N`，发现成本高。

## Decision

在画布顶栏 `canvas-top-actions`（主题切换左侧）提供「新建窗口」：桌面调用既有
`futurePropsDesktop.openNewWindow()`（复制当前 SPA pathname）；浏览器 fallback 为
`window.open(location.href, "_blank", "noopener,noreferrer")`。同项目 pan/zoom 继续靠
`fpl_canvas_viewport_{projectId}` 的 localStorage，不写入 URL。不跨窗同步对话面板、选中
节点或未提交标题。

多窗基础设施仍由
[同工作区多 Studio 窗口](2026-09-17-studio-multi-window.md) 与
[新建窗口与开发更新入口在 App 顶栏](2026-09-17-desktop-chrome-in-app-header.md) 定义；
本决定只补画布全屏页的可见入口。

## Alternatives considered

- **只依赖全局顶栏 / 菜单 / `Cmd+N`** — 画布页无全局顶栏，发现成本不变，否决。
- **仅桌面渲染按钮（与 DesktopAppChrome 一致）** — 浏览器画布同样没有全局入口，否决；浏览器走
  `window.open`。
- **把视口 / 选中写入 URL query** — 与现有 localStorage 视口冲突且扩大契约，当前对照需求不需要，否决。
- **为本任务接入 `visual-canvas` BroadcastChannel 发布** — 双窗实时失效另议；对照打开不依赖它。

## Consequences

- **收益**：画布内可一键开同项目第二窗；桌面与浏览器都有入口；视口自然对齐。
- **代价与已知上限**：对话/选中/未保存标题不同步；Visual canvas 保存仍可能未发 revision 广播
  （见 multi-window Note）；浏览器受弹窗策略影响。

## Verification

- 画布顶栏可见「新建窗口」；桌面 mock bridge 调用 `openNewWindow`；无 bridge 时调用
  `window.open(href)`。
- `web/tests/visual-workshop-canvas.test.tsx` 相关用例；`npm run verify-notes`。
