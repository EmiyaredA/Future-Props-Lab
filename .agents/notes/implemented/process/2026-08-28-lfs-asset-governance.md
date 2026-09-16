# Agent Note: 仓库二进制资产使用 Git LFS 与来源清单

Status: implemented

## Problem

固定字体、VAD 和演示图体积较大，来源与许可状态必须可核对。

## Decision

二进制资产按路径使用 Git LFS；`docs/assets/MANIFEST.md` 记录来源、许可、SHA256 和构建用途。缺少对象时按路径拉取，不把指针当资产。

## Alternatives considered

- **二进制直接提交 Git** — 使用简单，但会膨胀历史。
- **资产全部放外部下载地址** — 仓库轻，但构建依赖外部状态。

## Consequences

- **收益**：完整性和再分发边界可审计。
- **代价与上限**：新增资产必须同步清单和校验。

## Verification

运行 `npm run lfs:check:pointers`、`npm run lfs:check` 和 `git lfs fsck`。

