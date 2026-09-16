# Agent Note: 本机临时资产统一放入 .local

Status: implemented

## Problem

研究草稿、下载内容、截图和中间产物散落在仓库根目录，容易误提交。

## Decision

本机临时工作区统一使用 `.local/{scratch,output,tmp,downloads,research}` 并保持 git 忽略；`.runtime/` 只保存运行期状态，二者不作为代码或测试资产。

## Alternatives considered

- **继续使用根目录临时文件夹** — 路径少，但易与正式目录混淆。
- **把临时素材纳入 docs/assets** — 便于引用，但污染可再分发资产。

## Consequences

- **收益**：本地产物有稳定归属。
- **代价与上限**：脚本必须显式传入输入输出路径。

## Verification

检查 `.gitignore`、README 和目录索引；运行演示/验收脚本确认不产生根目录临时文件。

