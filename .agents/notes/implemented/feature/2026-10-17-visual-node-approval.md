# Agent Note: 视觉节点人工通过标记

Status: implemented

## Problem

生成完成只说明结果已保存，项目节点缺少表达人工认可的持久标记，无法在工作台、素材列表与画布中快速确认验收结果。

## Decision

节点共用契约增加严格布尔 `approved`，默认 false。工作台分类与标签行、素材菜单、状态卡和画布共用可切换的通过入口；素材行显示只读勾选。工作台和状态卡用轻量自绘开关及 switch/aria-checked 表达开关状态，标题行仅保留类型、运行状态和更多菜单，窄屏标题与这些信息可换行。标记经过现有画布保存队列、Workspace 写权限和 revision CAS，无新增路由或模型请求。省略字段的旧客户端保存保留当前值。

新输出登记、切换不同最终版本、删除最终版本和文本正文变化清除通过；标题、位置、提示词编辑保留。复制的新节点重新确认，项目包继续保留原标记。追加 r0094 迁移为旧节点补 false，不改已有迁移、布局、版本或 revision；ORM 继续使用节点 JSON，不新增列。

## Alternatives considered

- 将已完成视为已通过：任务完成与用户认可含义不同，无法表达审核意见。
- 使用普通标签：没有稳定语义与统一入口，旧客户端编辑标签容易覆盖标记。
- 对所有后续编辑保留通过：结果替换后会误显示旧确认，因此按结果变化清除。

## Consequences

人工通过与运行状态独立，不改变上下游引用或生成规则。历史预览仍独立，认可历史版本前需要先设为最终输出。标记记录当前节点决策，不提供账号审计或每个历史版本的审核状态。

## Verification

后端 test_visual_node_approval.py 覆盖持久化、取消、旧客户端、CAS、新输出、最终版本切换／删除、操作批和迁移幂等；Web board-management 与 canvas-persistence 测试覆盖键盘、入口一致性和立即保存；visual-workshop-node-management.spec.ts 在隔离数据中检查明暗主题、刷新、画布往返与窄屏。OpenAPI、Web 类型和 SDK 模型统一生成，官方指南与导入包同步更新。

验证结果：相关 Web 27 文件共 170 项通过；复制重置确认补充断言后该文件 12 项再次通过。新增后端 2 项通过；视觉工坊与 SDK 回归共 158 项通过、1 项跳过、1 项既存失败（test_visual_workshop.py 的旧预期缺少已有 workflow_parameters）；架构检查排除已有 HomeHeroPet 跨 feature 内部导入失败后 82 项通过。npm run build、lint、contracts:check、knowledge:seed:check、Note 校验和文档中心保护检查通过。全仓 format:check 的既存失败位于未改动的 web/src/docs/styles-components.css 与官方 thought-workshop/help.md，本次变更文件格式检查通过。

Chrome 明暗主题浏览器旅程共 2 项通过，包含键盘标记、真实保存、刷新、画布取消及 390px 窄屏点击。截图经检查，素材勾选不挤占名称空间，标题按钮在窄屏可见；产物位于 `.local/node-approval/e2e-final/`。未对正式运行数据执行迁移或写入。

呈现调整后，工作台使用分类与标签行的通过开关，不再向标题状态区追加操作按钮；标题在窄屏允许独立换行。相关组件测试 11 项、明暗主题浏览器旅程 2 项通过，长标题与手机截图经检查，保存在 `.local/node-approval-ui/e2e/`。保存逻辑和服务端契约保持一致。
