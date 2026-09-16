# Agent Note: Web 保持 app、features、shared、platform、generated 单向依赖

Status: implemented

## Problem

多工坊共享 API、缓存和 UI 时，复制查询键、Blob URL 或路由状态会造成生命周期泄漏。

## Decision

Web 保持 `app/ + features/ + shared/ + platform/ + generated/` 分层；查询键由功能 owner 维护，鉴权文件预览统一使用 `useApiBlobUrl`，生成契约不手工编辑。

## Alternatives considered

- **把复用逻辑放到 web/src 根目录** — 查找方便，但没有明确 owner。
- **每个消费者复制 query key 和 Object URL 管理** — 局部独立，但会造成缓存分叉和回收竞态。

## Consequences

- **收益**：业务所有权、缓存边界和资源生命周期可定位。
- **代价与上限**：跨功能复用必须先找到 owner。

## Verification

架构测试检查依赖方向；检查各功能 `queryKeys.ts` 和 `platform/api/useApiBlobUrl.ts`。

