# Agent Note: 桌宠联动按实际播放反应校验能力

Status: implemented

## Problem

完整隔离 Electron 复现当前选择“待机、无动作、无表情”也无法联动。资源更新保留配置后，未选点击／摸头事件仍含旧 happy／surprised 表情；validatePreview 对全部事件调用渲染能力校验，把已知但当前包缺素材的历史配置作为整份草稿错误。中央能显示当前有效帧，独立桌宠却退出联动，用户必须清空旧事件才能检查当前效果。

## Decision

预览先保持全量草稿的revision、项目／素材／服饰和已知动作／表情ID校验。Live2D仍检查快照资源ID，分层人物使用公开中文标签的own-key集合拒绝未知或继承属性ID。合法历史反应保留原数据，不因资源能力变化删改。

渲染能力通过公开reactionFor及能力函数，仅检查本次实际选择反应。调整与运行检查当前事件；完整事件同时检查结束后返回待机的反应。运动试玩先校验试玩能力，并覆盖事件动作，独立表情仍按实际反应检查。无表情／自然恢复不被其他事件拦住；当前缺素材仍反馈错误，既不降级到旧动作，也不自动保存配置。

## Alternatives considered

- 清空未选事件或上传时重写配置：破坏资源更新保留配置的契约，未采用。
- 完全移除表情／动作校验：会接受未知ID及实际不能展示的效果，未采用。
- 继续遍历全部事件的渲染能力：把合法草稿和本次展示能力混为一层，正是失败原因。

## Consequences

有效当前反应可临时联动，历史已知但缺素材的反应保留，选到它时明确反馈。完整事件返回待机和试玩独立表情仍受能力约束。私有宿主租户、单所有者、revision／序号与释放规则不变，无数据库迁移、公共接口或持久配置变更。

## Verification

新增20项回归覆盖inspect／runtime／event保留未选已知但缺素材反应、当前能力拒绝、无表情／自然、未知／空ID、试玩优先及独立表情、完整事件待机恢复、revision／服饰／素材和Live2D。真实hook delivery保留旧surprised／happy，idle成功、当前happy拒绝、恢复null后成功，保存基线不变。新增及相关5文件73项通过；root全桌宠48文件811项、全lint／format／build及类型、契约／SDK和官方导入包8项通过。

hook冻结SHA `430c18d46fe63ce746cb4aad182d6e21f1da02ba9e4113f70f506d9322500bd9`；独立完整隔离App以原默认events再次导入v8／CAS更新v9／v10诊断包，每版明暗当前idle/null开关true，实际privatepet显示“临时预览，尚未保存”。退出后每版config／revision严格保持，没有清空历史事件、自动保存或模型请求。source87文件按路径排序SHA `64be35210568a5dc2f56b9074712167afd121cb28290fe9b6e909460d8effaa7`，相比before仅该hook变化；历史联动失败报告保留，不把原基线视频改称成功。

新验收在 `.local/desktop-pet/full-app-sequence-check/after-link-fix/`，契约与源码冻结在 `.local/desktop-pet/preview-current-reaction/`。原图仍有上身跳变、接触与比例不一致，未批准正式资源。短点后缺clip被报告为支撑异常是单独发现，未用本Note宣称全部交互或自然动作通过。整体素材、三服饰／鲸鱼及完整物理验收仍受[完整帧提案](../../proposed/bug-fix/2026-10-04-pet-whole-frame-motion.md)约束。
