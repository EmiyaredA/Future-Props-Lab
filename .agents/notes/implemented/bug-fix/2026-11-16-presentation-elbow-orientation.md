# Agent Note: 对齐 PPTX 默认折线的出发方向

Status: implemented

## Problem

演示工坊第十四页从浏览器示意框底部指向 DOM 检测和视觉审阅的分叉连接，在网页
按竖向、横向、竖向走线，而导出的 PowerPoint 原生 bentConnector3 预设默认按横向、
竖向、横向走线。端点坐标和绑定均存在，但中段与末端箭头的方向和画布不一致。

## Decision

`pptx_scene.py` 将无自定义路径、从 top/bottom 锚点出发的原生折线先反向旋转坐标框，
再旋转原生连接器 90 度。这样既保留原端点，又让预设的横向首段映射为画布的竖向首段。
原生节点绑定、箭头大小、样式与标签不变；水平出发、直线、自定义路径和非中点端点
继续使用既有映射。文稿数据和项目 revision 不因导出改变。

工程依据为 `docs/architecture/project-layout.md` 的演示工坊连接语义和
`docs/operations/development-workflow.md` 的验证矩阵。

## Alternatives considered

- 只设置旋转角：非正方形坐标框会使实际端点随旋转偏移。
- 一律使用自由形状路径：能够保留几何，但损失可移动节点的原生连接绑定。
- 修改项目添加中间点：仅掩盖当前页面问题，无法修复默认折线的通用导出行为。

## Consequences

- 原生连接器仍可编辑，且出发轴、末段方向与画布一致。
- 变更只涉及导出边界，不增加 schema、迁移、权限或持久状态。
- 办公软件在用户拖动节点后可能重新自动走线，当前验收覆盖初次打开的路径与绑定结构。
- 当前服务未部署；最新 revision 563 的验收副本同时包含此前的公式字号修复。

## Verification

- 新增 48 组原生几何测试：四种源锚点、四个象限及水平／竖直对齐、绑定和自由端点。
  从真实 DrawingML 预设路径解码翻转、坐标框与旋转，逐段对照画布坐标，并检查绑定及箭头。
- `uv run pytest -q tests/apps/presentation_workshop`：253 passed，1 skipped。
- `ruff check`、`ruff format --check` 及 `git diff --check` 通过。
- 官方 API 只读导出最新文稿，验收副本修正 5 条默认竖向折线，并保留 21 个公式上下标修复。
  ZIP 与 XML 对比确认其余内容不变；未修改项目。
- Microsoft PowerPoint 实际打开第十四页，左右分叉均向下接入目标，与网页示意一致，未提示修复文件。
  WPS 自动化点击遇到 noWindowsAvailable，未完成该软件的实际复验；原有视图已恢复。
