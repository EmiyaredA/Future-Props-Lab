# Agent Note: 视频剪辑素材重命名

Status: implemented

## Problem

素材列表沿用上传和导入名称，整理菜单只有排序与移动操作，用户不能为视频添加便于识别的名称。

## Decision

素材行的整理菜单提供重命名入口，视频、音频和图片共用弹窗。弹窗使用项目现有主题、键盘提交、焦点约束和取消行为；保存期间禁止重复提交与关闭，失败保留输入，冲突必须重新打开后再保存。

现有素材 PATCH 接口支持可选 displayName 和 defaultEffects，校验非空、255 字符和至少一个修改字段，拒绝显式 null。素材元数据 revision 的 CAS 成功后，在同一事务修改 VisualAsset.display_name；未提供的默认效果保持原值。Workspace 和工程归属沿用素材加载校验，不改变文件路径、原始文件名、素材 ID 或时间轴片段名称，不需要迁移。

弹窗固定打开时的版本，后台刷新不能隐式更新提交基线。成功或失败后失效 owner 的素材查询；素材监视器从该查询按 ID 派生名称。SDK 和 OpenAPI 生成契约同步更新，API 参考与官方素材管理指南说明行为。

## Alternatives considered

- 在每行增加改名图标：素材区较窄，继续增加按钮会挤压名称，采用已有整理菜单。
- 新增重命名路由：名称和默认效果属于同一素材版本，扩展既有 PATCH 可保持一致的并发边界。

## Consequences

名称修改保持引用稳定，可用于处理中素材；时间轴片段保留各自独立名称。默认效果修改与改名互相产生 revision 冲突，不能静默覆盖。

## Verification

- `web/tests/features/video-editor-assets.test.tsx`：整理菜单入口、修剪名称、缓存刷新、失败保留、取消与保存期间禁止重复提交、冲突和只读。
- `tests/apps/video_editor/test_video_editor_asset_rename.py`：持久读取、同事务 CAS、默认效果保留、输入校验、工程与 Workspace 隔离、文件读取与时间轴保持。
- OpenAPI／SDK stale-check、定向 lint／format、Web build、Agent Note 与文档中心保护检查。

## Follow-up

[直接可见的素材重命名入口](2026-10-06-video-editor-visible-rename-action.md) 增加常驻铅笔与文字按钮，调整本篇最初仅使用整理菜单的入口选择，继续沿用同一保存契约。
