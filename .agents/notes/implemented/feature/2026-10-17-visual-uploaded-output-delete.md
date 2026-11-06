# Agent Note: 删除人工上传的输出版本

Status: implemented

## Problem

看板输出版本卡片缺少删除入口，已有删除仅出现在非最终版本的详情中。人工上传默认成为最终输出，用户无法直接移除误上传的结果，只有一个版本时也无法通过切换最终输出来删除。

## Decision

来源为 uploaded 的版本卡片显示独立删除按钮，复用 ConfirmDialog 核对编号与影响。其他来源沿用历史版本删除入口。前端先等待画布保存取得最新 revision，再调用已有 DELETE API；成功后接收画布、刷新历史，删除当前预览时回到最终输出。失败保留版本与弹窗，不自动重试。

NodeOutputs 在 Workspace 和节点范围内检查输出及固定引用，再竞争画布 CAS。人工上传的最终版可删除，事务内将剩余最大版本标为最终版并更新节点的 final_output_id、final_version、asset_id；无剩余则清空这些字段。保留 output_sequence，避免版本号复用。删除历史版不影响最终输出，非上传来源的最终版仍受保护。

版本删除保留托管素材、生成任务与既有输入快照。固定引用继续阻止删除，跟随引用在下一次提交时解析最终版；无输出时仍按既有上游缺失规则拒绝生成。HTTP 参数、响应结构、权限登记与数据库结构不变，SDK 继续使用原方法。

## Alternatives considered

- 只显示原删除按钮：最终版仍被服务端拒绝，只有一个版本时不能清理误上传。
- 自动解除固定引用并删除：改变下游用户明确选择的版本，故保留引用保护。
- 随版本删除原文件：素材可能被其他节点或任务快照使用，故保留文件并沿用素材管理入口。

## Consequences

人工上传的最终版和历史版均能直接清理，编号及引用保持可解释。删除最终版会改变下次生成的跟随输入，弹窗和指南明确提示恢复最新剩余版本或清空输出。托管文件不会自动释放磁盘空间。

## Verification

- `tests/apps/visual_workshop/test_visual_node_outputs.py`：图片、视频、音频最终版删除、恢复／清空、刷新、编号递增、原文件保留、固定引用、CAS、Workspace 和节点隔离、生成来源保护。
- `web/tests/features/visual-output-delete.test.tsx`：独立删除入口、确认与取消、保存 revision、请求中禁用、清理预览、失败保留状态及原历史删除流程。
- `web/e2e/visual-output-delete.spec.ts`：隔离服务的明暗主题及窄屏删除、恢复最终版、刷新和删空输出。

2026-10-17：输出 API 专项 23 项与画布替换安全 1 项通过；扩展后端、迁移、SDK 与架构检查 102 项通过。相关 Web 回归 35 项通过，随后新增「删除其他版本保留历史预览」用例，删除组件专项共 7 项通过。隔离 Chrome 明暗主题 × 1600/390 宽度 4 项通过，截图在 `.local/visual-output-delete/results/`；窄屏可见操作截图在 `.local/visual-output-delete/mobile-results/`。

根 lint、生产构建（含类型与体积检查）、OpenAPI/Web/SDK 契约检查、官方导入包生成与校验、Note 和文档中心保护检查通过；变更文件格式检查通过。未运行真实供应商调用，正式 App 数据未改动。

范围外已有失败保留：`HomeHeroPet.tsx` 的两个 desktop-pet 内部导入导致跨 feature 架构检查失败；根格式检查报告 `web/src/docs/styles-components.css` 与思绪工坊 `help.md` 两处差异。本次不修改这些文件。
