# Agent Note: 手动选入素材的设定归属

Status: implemented

## Problem

[素材输入归属角标](../feature/2026-11-22-reference-kind-labels.md)覆盖设定引用和输入连线，但真实项目中的参考图也可仅通过素材 ID 手动选入。
这些素材在项目节点上已有 `design_card_id`，既不属于当前卡采用图，也没有进入当前制作节点的连线，导致角标缺失。
仅用带连线的隔离项目验收不能覆盖这个入口。

## Decision

关联映射遍历调用方已提供的项目节点，为图像节点的精确 `asset_id` 收集显式 `design_card_id`。
无需输入连线或改写草稿；手动加入的素材 ID 自然命中已有绑定。继续保留全部匹配以执行原冲突规则，不从标题、分类名或图像内容推断。
原有设定引用、固定输出连线及采用图路径保留。不存在已知设定关联的原视频不显示分类。

## Alternatives considered

- 要求用户为所有手动参考补连线：改变既有工作流，也会修改项目业务数据。
- 从三视图文件名补角色类型：没有可靠归属依据，违背用户明确要求。

## Consequences

仅补齐前端读取路径，不增加请求或持久字段，不更换采用图，不提交生成任务。
遵循[能力实现契约](../../../../docs/architecture/capability-contracts.md)和[开发与验证流程](../../../../docs/operations/development-workflow.md)。

## Verification

- 归属测试增加无输入连线的手动素材、明确绑定、缺失绑定及跨类冲突；固定输出映射继续保留。
- 本轮40项单元及回归、浏览器布局用例通过。全量构建受其他文件同期改动的类型错误阻塞：`creative/api.ts` 的 facts／voice_asset_id 契约及 `visual-previs-navigation.test.tsx` 的 exact 参数；未修改这些无关实现。
- 浏览器图片输入用例改为只有手动参考、没有输入连线，场景采用图为空但源节点绑定明确，仍显示三类归属。
- 在用户当前本机项目的独立核对页复现镜头22缺失，源码热更新后两张素材均显示角色标签，原编号保留。
  仅查看和切换展示节点，不改写项目或卡片；截图为忽略的 `.local/reference-kind-labels/actual-project-fixed.png`。
