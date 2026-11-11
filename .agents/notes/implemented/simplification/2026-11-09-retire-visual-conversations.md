# Agent Note: 下线视觉工坊旧对话

Status: implemented

## Problem

视觉工坊和 Amadeus 同时维护项目对话、工具审批及模型执行链，用户面对重复入口，旧会话也继续占用素材引用。

## Decision

画布、看板和验收使用 Amadeus 项目入口；兼容网站和独立服务注销旧公开路由、私有执行接口和维护数据集。旧审批仅作为已入队生成任务发布成果时的来源凭据。追加四个所有者迁移，在同一事务先检查未结算状态，再移除历史和旧助手日志；Assets 只释放旧 Visual 对话的引用。

## Alternatives considered

仅隐藏入口会留下可调用的 SDK 和保留关系；把旧历史迁入 Amadeus 会混合不同审批语义和附件归属。

## Consequences

旧 URL 返回 404，旧历史和该来源的整条调用日志在迁移后不可恢复。生成任务、成果、素材原件和 Amadeus 会话由原所有者继续管理。正式切换需先在旧版本结算，停机备份受影响数据库，再统一切换网关、服务与前端。

## Verification

`tests/runtime/test_visual_conversation_retirement.py` 用隔离库覆盖四个所有者的全新安装、升级、未结算回滚和精确清理；视觉迁移与浏览器测试覆盖保留的项目数据和入口。
