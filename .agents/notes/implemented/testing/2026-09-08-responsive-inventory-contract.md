# Agent Note: 响应式清单作为页面覆盖契约

Status: implemented

## Problem

页面和独立 HTML 入口持续增加，截图用例容易遗漏新路由或只覆盖桌面尺寸。

## Decision

`web/e2e/responsive-inventory.ts` 维护页面与适配用例的穷尽归属；旅程覆盖固定桌面、平板、手机、横屏和明暗主题矩阵。

## Alternatives considered

- **每页自行决定尺寸覆盖** — 无法发现新页面漏登记。
- **只依赖截图快照** — 不能证明键盘、焦点、错误状态和可操作边界。

## Consequences

- **收益**：新增路由需要显式登记，适配责任清楚。
- **代价与上限**：真实设备键盘、触控和系统缩放仍需真机验收。

## Verification

运行响应式 E2E 旅程和 `responsive-coverage` 测试。

