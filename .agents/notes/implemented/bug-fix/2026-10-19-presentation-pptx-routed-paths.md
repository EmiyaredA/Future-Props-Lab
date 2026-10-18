# Agent Note: PowerPoint 自由路径导出与空白页修复

Status: implemented

## Problem

带显式拐点的连接曾在 `p:cxnSp` 内写入 `a:custGeom`。该组合通过通用
PresentationML XSD 和 python-pptx 回读，但 PowerPoint 会修复并清空所在页面。
22 页实际文稿中的第 5—8 页因此丢失显示内容。此前的
[XML 顺序兼容修复](2026-10-19-presentation-pptx-compatibility.md)仍有必要，
但不能识别目标软件对对象类型的约束。

## Decision

普通直线和没有显式拐点的折线继续使用预设连接线及端点绑定。显式折线路径导出为
一个 `p:sp` 自由曲线形状，保留绝对坐标、正反方向、颜色、线宽、箭头、独立文字标签
与分组层级，不写入隐藏连接线。路径无填充、无闭合与主题阴影；退化为水平、垂直或
重合点时保留非零坐标框和原始路径点。

自由曲线仍可编辑，但没有随节点移动的端点绑定。这符合用户明确选择的外观与可编辑性
优先策略。应用内连接关系、文稿数据、数据库和 API 均保持原契约。

## Alternatives considered

- **仅重排 XML**：已有修复完成了顺序校正，实际文件仍被 PowerPoint 修复。
- **全部改为预设折线**：隔离对照实验确认不再修复，但会改变显式路由的拐点和走向。
- **整页栅格化**：会丢失原生文字和形状的编辑能力。
- **自由曲线加隐藏绑定连接线**：增加不可见对象与重复路径，不能保证编辑后的视觉一致性。

## Consequences

导出边界区分绑定连接与自由曲线，不再输出连接线内嵌自由路径的组合。
指南、技术正文、图形与简介同步说明两者的编辑边界；原有导入记录不自动覆盖。
兼容验收同时检查对象结构与 PowerPoint 实际显示，不把 XSD 通过等同于实际可用。

## Verification

- `uv run pytest -q tests/test_presentation*.py`：98 passed，1 skipped；跳过项为需显式
  QA 目录的百页性能测量。
- 回归覆盖正反路径、多拐点、水平／垂直／重合路径、箭头、嵌套分组、标签、混合页面、
  原生端点、备注、SVG 及归档图排除，确认导出不改变输入文稿。
- 通过已配对桌面 SDK 只读取得 22 页、revision 86 文稿与 84 个引用素材，使用实际
  `build_export` 链路生成隔离验收文件；全部 PresentationML 通过本地 XSD，备注保留，
  无 `p:cxnSp/a:custGeom` 组合。
- PowerPoint 实际打开最终文件，无修复提示或 Repaired 标题；幻灯片浏览确认 22 页均有
  内容，并展开第 18 页核对文字、素材与路径。对照样本恢复了原空白第 5 页。
- 本机 PowerPoint 未激活，实际编辑与保存受订阅限制；可编辑自由曲线类型、文字与
  分组结构通过 python-pptx 回读及 XML 断言验证。
- Ruff、修改内容的 Prettier／ESLint、正式 Web 构建、官方导入包、Agent Note 和文档
  保护检查通过。架构与官方发布测试合计 71 passed、1 failed；唯一失败是既有
  `HomeHeroPet.tsx` 跨 feature 导入桌宠内部文件，与本次导出修复无关，未修改该入口。
