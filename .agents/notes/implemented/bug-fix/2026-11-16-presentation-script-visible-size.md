# Agent Note: 保持 PPTX 上下标的可见字号

Status: implemented

## Problem

演示工坊第九页的 pass@k 与 pass^k 使用可编辑富文本，上标已经指定 8px 字号。
导出直接把这个字号写入 DrawingML，并附加 baseline。PowerPoint 对非零 baseline
的字符再按 65% 显示，导致上标重复缩小，基线抬升也不足；原回归只检查上标标记存在。

## Decision

`pptx_text.py` 在 PPTX 边界换算可见字号与原生字号。导出按 0.65 的倒数补偿上下标，
保留原生 baseline；导入应用相反换算，再按现有文稿字号范围校验。普通文字的字号不变。
该变更不修改文稿持久数据或前端渲染语义，适用于文字框、带文字的形状与富文本备注。
职责与验收遵循 `docs/architecture/project-layout.md` 的演示工坊条款和
`docs/operations/development-workflow.md` 的验证矩阵。

## Alternatives considered

- 只增大 baseline：可以抬升字符，但无法修复重复缩小后的可读性。
- 拆成独立文本框或图片：可以控制位置，但损失行内编辑、换行或文字编辑能力。

## Consequences

- 上下标保留可编辑原生文本，导入和导出使用同一套可见字号语义。
- 不同办公软件的字体度量仍可能存在细微差异；这里采用实测的 PowerPoint 65% 比例。
  LibreOffice 的原生缩放策略不同，不宣称各软件像素完全一致。
- 已下载文件需重新导出；运行中的旧服务需要在获授权的部署时加载新代码。

## Verification

- `uv run pytest -q tests/apps/presentation_workshop`：205 passed，1 skipped。
- 新增 12 项回归：上下标、6/8/24/240px、换行、普通文字、三次连续导入导出及外部原生文字。
- 本机 Microsoft PowerPoint 打开隔离对照稿，确认旧参数重复缩小，65% 补偿后的脚本文字与
  同字号普通文字等大；保留 baseline 产生明确的上下标位置。
- 当前文稿经官方 API 导出为验收副本；仅修改非零 baseline 字符的 sz，并逐项确认其他 ZIP
  成员及 XML 内容不变。未更新项目 revision，未部署服务。
