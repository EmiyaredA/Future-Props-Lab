# Agent Note: Happier 嵌入页面及时显示

Status: implemented

## Problem

Happier 完成票据交换后，Studio 仍可能卡在“正在打开”。旧实现隐藏 iframe，直到整页及其资源触发 `load`。实际浏览器中，Happier 已可在新标签打开，内嵌区仍只显示加载提示。

## Decision

保留现有票据交换、来源限制和失败重试。交换成功后立即显示 iframe，由 Happier 显示自己的加载和登录状态。切换云控页签时继续保留同一个 iframe，权限或解锁到期时卸载它。

## Alternatives considered

- 等待 iframe 的 `load` 或加长等待时间。远端资源仍可拖延整页事件，Studio 无法用该事件判断跨来源应用是否可交互。
- 从跨来源 iframe 读取内部状态。Happier 没有提供双方约定的就绪协议。

## Consequences

首次渲染交给 Happier。Studio 继续显示授权交换期间的加载反馈，以及交换失败后的重试入口。

## Verification

`npm --workspace web run test -- tests/cloud-control.test.tsx` 覆盖票据交换失败重试、没有 `load` 事件时 iframe 可见和来回切换页签保留 iframe。
