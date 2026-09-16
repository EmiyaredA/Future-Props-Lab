# Agent Note: 桌面 live 开发使用受控正式数据租约

Status: implemented

## Problem

热加载需要复用正式数据，但源码更新不能直接覆盖或复制用户数据。

## Decision

普通开发使用独立开发数据；只有显式 `npm run dev:desktop:live` 才进入正式数据。启动器持有数据锁，首次进入前备份 runtime 与配置并校验完整性。

## Alternatives considered

- **所有热加载都使用正式数据** — 方便但可能污染用户数据。
- **把正式数据复制进仓库开发目录** — 隔离直观，但违反运行数据不进仓库的边界。

## Consequences

- **收益**：正式数据不会被默认开发流程触碰。
- **代价与上限**：live 流程更慢，自动化测试永远使用临时数据。

## Verification

运行 `npm run test:desktop:dev` 和桌面开发数据测试。

