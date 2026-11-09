# Agent Note: 工坊内页共用 Amadeus 分屏

Status: implemented

## Problem

独立工坊使用早于 Portal 的分屏构建，部分素材、任务和项目内页也缺少入口。导演台编辑器定位到浏览器视口，分屏时无法跟随左栏宽度。

## Decision

装配层为常规页提供公共工具栏，项目编辑器在现有工具栏中显示同一权限门控的入口。两个 Web 装配复用 Amadeus 分隔线。导演台随左栏重新计算内部布局，并向分屏声明 880 px 的最小可用宽度。

当前页面自动带入的项目随路由更新。手动选择按账号及对话保存于标签页会话，并从运行历史恢复已经明确带入的项目。页面上下文仍通过现有账号授权路径发送。

## Alternatives considered

逐工坊复制分隔线会让行为与 Portal 分叉。给导演台保留整个视口会挡住分隔线和 Amadeus 面板。

## Consequences

统一的分屏模式支持鼠标与键盘调整。窄屏和无法同时满足左右栏最小宽度的窗口使用弹窗。

## Verification

以 `web/e2e/workshop-entry-shell.spec.ts` 覆盖工坊首页、项目内页、只读入口、项目选择恢复和分屏边界。
