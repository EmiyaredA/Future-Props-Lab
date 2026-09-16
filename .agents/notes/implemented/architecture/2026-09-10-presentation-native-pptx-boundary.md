# Agent Note: 演示工坊使用请求内原生 PPTX 导出

Status: implemented

## Problem

演示工坊需要产出可编辑 PPTX，又不希望引入 Office 或 LibreOffice 常驻依赖。

## Decision

演示文稿由 `presentation_workshop/` 持有，使用锁定版本的 `python-pptx`、受限 SVG 校验和 `resvg-py` PNG 兼容图完成请求内导出；不建立独立持久导出任务。

## Alternatives considered

- **只导出图片或 PDF** — 稳定但丢失 PowerPoint 编辑能力。
- **依赖 LibreOffice/Office 服务端转换** — 兼容面广，但引入外部服务和部署差异。

## Consequences

- **收益**：文本、形状和媒体仍可编辑，生产环境不需要 Office。
- **代价与上限**：DrawingML 和 SVG 能力需要受限映射。

## Verification

运行演示工坊导出、媒体和样式测试；参考现有演示验收记录。

