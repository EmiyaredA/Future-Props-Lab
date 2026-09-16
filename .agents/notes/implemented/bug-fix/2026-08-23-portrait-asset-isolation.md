# Agent Note: 角色立绘资产按角色身份隔离

Status: implemented

## Problem

共享图片缓存和角色外观复用可能让一个角色的立绘出现在另一个角色或导出中。

## Decision

角色资产解析、缓存和导出都以角色身份及已验证素材归属为边界；缺失或不匹配的立绘不进入视频导出。

## Alternatives considered

- **按图片 URL 或文件名共享缓存** — 命中率高，但无法表达角色语义。
- **导出阶段再临时修正** — 错误会晚到成片阶段才暴露。

## Consequences

- **收益**：编辑、预览和导出使用一致的角色资产身份。
- **代价与上限**：缓存键和素材解析更复杂，错误数据必须显式处理。

## Verification

运行角色隔离、Galgame 导出和 portrait audit 测试。

