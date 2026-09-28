# Agent Note: 本机临时资产统一放入 .local

Status: implemented

## Problem

研究草稿、下载内容、截图和中间产物散落在仓库根目录，容易误提交。

## Decision

本机临时工作区统一使用 `.local/` 并保持 git 忽略；代理主动生成且需要落盘或保留的临时输入、诊断文件、截图、渲染中间结果、导出草稿和本地验收产物，按能力或任务放入清晰的子目录。不得在仓库根目录或受版本控制目录另建 `scene-output/`、`output/`、`tmp/` 等临时产物目录。`.runtime/` 只保存运行期状态，二者不作为代码或测试资产。

用户明确指定的正式交付路径不属于临时工作区；工具自身不可配置且不作为结果保留的短生命周期系统临时文件可以继续使用操作系统临时目录。

## Alternatives considered

- **继续使用根目录临时文件夹** — 路径少，但易与正式目录混淆。
- **把临时素材纳入 docs/assets** — 便于引用，但污染可再分发资产。

## Consequences

- **收益**：本地产物有稳定归属。
- **代价与上限**：脚本必须显式传入输入输出路径，代理在创建产物前需要确认目标路径确实被 Git 忽略。

## Verification

运行 `git check-ignore .local/<probe>`，并在演示、渲染或验收后检查 `git status --short --untracked-files=all`，确认没有产生根目录临时文件或未跟踪中间产物。
