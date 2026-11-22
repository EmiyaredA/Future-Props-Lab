# Agent Note: 素材输入归属角标

Status: implemented

## Problem

素材输入只展示缩略图与编号，无法直接区分其实际关联的角色、场景和道具。
原角标仅覆盖直接设定引用或采用图，对连线设定卡缺少身份映射，固定内边距也没有为紧凑编号和移除按钮预留位置。

## Decision

沿用 `ProjectMediaPicker` 的缩略图结构，在右上角显示统一 30×18px 的文本块，角色用紫色、场景用蓝色、道具用棕金色。
左上编号保持原位；图片输入的移除操作移至角标下方，视频引用继续使用原格下详情操作。

`referenceCardLinks.ts` 从已有 `design_references` 及已解析输入连线的源图像节点 `design_card_id` 收集关联。
同一素材保留所有显式关联，不因遍历顺序选中某张卡。标签从账号范围的设定卡目录读取 `kind`；存在显式关联时不回退其他卡的采用图。
没有显式卡 ID 时，只允许素材 ID 精确匹配 `adopted_asset_id`。归属缺失、目录不可读、显式卡无法解析或关联类型冲突时不显示分类；同类多个关联合并为一个标签。
文件名、标题、图像内容、主体标签和提示词均不参与分类。

## Alternatives considered

- 按缩略图或文件名判断：不符合实际归属要求，会制造错误关联。
- 只读取当前采用图：不能覆盖历史图、导入图及画布显式设定绑定。
- 冲突时选择第一个类型：会让标签随数组顺序变化，因此保留关联并隐藏不确定类型。

## Consequences

仅增加前端展示和显式数据映射，不新增接口或持久字段，不改写设定卡、引用顺序及生成请求。
紧凑素材条继续局部滚动，角标不增加格子高度。明暗主题均使用足够对比度的固定色块与白字。
依据[能力实现契约](../../../../docs/architecture/capability-contracts.md)与[开发与验证流程](../../../../docs/operations/development-workflow.md)验收。

## Verification

手动选入素材的项目节点设定绑定由[手动素材归属修复](../bug-fix/2026-11-22-manual-reference-kind-links.md)补齐；原分类与冲突规则保持有效。

- `web/tests/features/visual-reference-kind.test.tsx` 覆盖三类精确归属、显式优先、缺失、冲突、同类合并及固定输出连线映射。
- `web/e2e/visual-reference-layout.spec.ts` 在隔离项目验证三类角标、不同底色、文本容纳、编号避让及边界，并覆盖桌面、窄屏和明暗主题。
- 相关上传、引用拖放、生成器回归与构建结果记录在忽略的 `.local/reference-kind-labels/`。
