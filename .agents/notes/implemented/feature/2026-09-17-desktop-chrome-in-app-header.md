# Agent Note: 新建窗口与开发更新入口在 App 顶栏

Status: implemented

## Problem

系统菜单栏上的「文件 → 新建窗口」和「开发 → 应用更新」用户在 App 内找不到，还容易和侧栏
「文件」混淆；开发操作藏在壳外也不符合本机日常用法。

## Decision

桌面壳仅保留不可见加速键（`Cmd/Ctrl+N`、`Cmd/Ctrl+Shift+U`）。「新建窗口」与开发状态/
应用更新/重新检查放在 App 全局顶栏；仅存在 `futurePropsDesktop`（及开发桥）时渲染。不恢复
常驻底栏。正式打包无开发桥，顶栏不含开发控件。

这翻转
[桌面开发更新不进入 App 布局](2026-09-17-desktop-development-chrome-outside-app.md)。

## Alternatives considered

- **继续只用系统菜单栏** — 发现成本高，已否决。
- **恢复页面底栏开发条** — 改变内容区布局、与正式包不一致，否决。

## Consequences

- **收益**：业务与开发入口都在 App 内可见；打包布局仍干净。
- **代价与已知上限**：开发顶栏占用横向空间；窄屏只留图标。视觉画布全屏页另有「新建窗口」
  （见 [visual-canvas-new-window](2026-09-17-visual-canvas-new-window.md)），不依赖本顶栏。

## Verification

桌面开发启动后顶栏可见「新建窗口」与开发控件；普通 Web 无这些按钮；
`desktop-development` 与顶栏相关测试通过。
