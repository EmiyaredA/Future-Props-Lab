# Agent Note: 知识库复用工坊项目卡片

Status: implemented

## Problem

个人库窄卡片把名称和更多操作放在彩色封面上，与其他工坊的项目列表差异明显。长名称也需要与封面图案争夺空间。

## Decision

替代[第一版窄卡片设计](2026-11-07-knowledge-library-cards.md)。知识库列表复用 `ProjectLibraryCard` 的封面、正文和底部操作栏。库名在正文区，底部直接提供打开、导出、重命名和移入回收站。简介和封面设置放在底部菜单内。网格按实际内容区宽度自动减列，宽屏最多五列。

## Alternatives considered

继续维护私人库专用的卡片外观，逐项仿照工坊列表，需要重复实现相同的布局和状态样式。

## Consequences

默认封面复用暖色网格纹样。已上传的封面覆盖默认视觉，加载失败时仍显示可打开的默认封面。卡片名称和简介各显示两行，文档数和更新时间位于正文顶部。

## Verification

`web/e2e/thought-library-layout.spec.ts` 检查五列布局、窄屏换列、明暗主题、长文本、菜单焦点、重命名入口和知识库导航。
