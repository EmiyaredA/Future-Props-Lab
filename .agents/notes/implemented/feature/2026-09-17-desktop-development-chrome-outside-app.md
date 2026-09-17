# Agent Note: 桌面开发更新不进入 App 布局

Status: implemented

Superseded by: [新建窗口与开发更新入口在 App 顶栏](2026-09-17-desktop-chrome-in-app-header.md)

## Problem

桌面热加载在页面底部插入「开发模式」条，空闲时常驻，有更新时也覆盖内容区，使开发窗口
与正式打包 App 的页面布局不一致。

## Decision

页面内不再渲染任何开发更新 UI。`DesktopDevelopmentHost` 只处理查询刷新与未保存保护，
通过菜单动作或 `future-props:development-apply` 事件触发应用/重检。状态与「应用更新 /
重新检查」放在 Electron 窗口标题和「开发」菜单（`Cmd/Ctrl+Shift+U`）；打包 App 不启用
该菜单与开发桥。

## Alternatives considered

- **空闲隐藏、有更新再显示底栏** — 减少常驻干扰，但待应用时仍覆盖页面，布局与正式包不一致。
- **底栏改为 fixed 悬浮且不预留空间** — 不占文档流，但仍是页面内可见壳层，会挡住内容。

## Consequences

- **收益**：开发中的 Web 布局与正式打包一致；热加载操作走原生菜单/标题。
- **代价**：需从菜单或快捷键应用更新；自动化烟测通过页面事件触发同一守卫路径，不再点页面按钮。
- **后续**：入口发现成本过高，已由 superseding note 改为 App 顶栏（仍禁止底栏）。
