# Agent Note: 原生角色制作工坊

Status: implemented

## Problem

FPL 缺少从分层素材制作参数化二维角色的完整编辑流程。视觉预览不代表已有 Cubism 编译能力。

## Decision

使用现有 React/PixiJS 与 Python/Pillow 构建原生角色项目。项目、素材和任务按 Workspace 隔离并通过 revision CAS 保存；确定性几何与渲染归属媒体能力。首版输出自有工程与透明 PNG 序列，参数关键形与时间关键帧使用独立模型。

## Alternatives considered

Stretchy Studio 提供现成编辑能力，但其骨骼和直接变形结构与已确认的参数关键形工作流不同。用户选择原生实现。Cubism SDK 可以播放已编译模型，但不能把项目保存视为 MOC3 编译；兼容导出后续独立验证。

## Consequences

从分层素材完成层级树、网格、嵌套变形器、参数关键形、表情与动作编辑，保存重开并导出独立序列。参数关键形从该参数的隔离插值形态初始化，避免混入其他参数的当前效果。导出预览与任务统一绑定已保存 revision，并记录组合、裁切、尺寸、帧率和帧范围。验证隔离、CAS、导入包路径、取消、中断和前后端求值一致。所有自动化使用临时数据。

## Risks

双实现求值需要共享夹具约束。PSD 不支持的效果必须报告；已有绑定的拓扑变更需要清除确认与撤销。Cubism、视频、物理和外部输入均不伪装为已支持。

## Verification

- 后端角色/权限测试 15 项通过，含临时迁移、共享几何夹具、alpha 遮罩、CAS、跨空间、只读、包路径与往返、进行中取消及失败恢复。
- Python SDK/历史迁移测试 15 项通过；新增迁移只在临时库验证。
- Web 参数/文档渲染测试 23 项通过；新工坊 Ruff、ESLint、Prettier 独立检查通过。
- Playwright 三个真实浏览器流程通过：冷缓存首次解析分层 PSD，实际制作微笑关键形与点头动画，保存重开、裁切预览并下载独立序列；不支持/损坏 PSD 错误及窄窗口面板操作；黑色纹理的 alpha 遮罩像素测试。
- `npm run test:desktop:live2d` 通过真实隔离 Electron 入口、导入与保存恢复。正式桌面数据库只读确认已包含 `r0071_live2d_workshop`；本轮自动化没有迁移或写入正式数据。
- OpenAPI、Web 契约、SDK/参考文档 stale check、资产物化和 Git LFS fsck 通过。
- 全库 build/lint/format/architecture 仍被其他模块既有或并行改动阻断：视频编辑器类型与 lint、导演台依赖环、Amadeus/视频编辑器/SQLite 测试文件体量及仓库格式问题。保留这些改动。文档中心保护检查报告本次必要的自动生成 API/SDK 文档更新；没有绕过或禁用保护脚本。

详细所有权与边界见 [Live2D 工坊说明](../../../../docs/architecture/live2d-workshop.md)。
