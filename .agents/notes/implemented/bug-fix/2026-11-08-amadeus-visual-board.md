# Agent Note: 视觉项目看板接入 Amadeus

Status: implemented

## Problem

视觉项目的画布、看板共用同一路由。看板有独立顶栏，先前只有画布顶栏挂载 Amadeus，并在画布内部同步项目上下文。直接恢复到上次打开的看板时，入口和项目上下文都缺失。

## Decision

看板复用受账号权限约束的 Amadeus 按钮和既有分屏。画布与看板在共同的项目页面发布项目、节点和保存状态。看板的默认节点与当前显示节点一致。

## Alternatives considered

在看板里重复维护上下文发布会让两个视图的上下文更新规则分叉。

## Consequences

看板顶栏在窄栏中换行，Amadeus 随当前项目与节点打开。

## Verification

工坊浏览器回归从画布切换到看板并刷新，再验证按钮、分隔线和自动带入的项目。
