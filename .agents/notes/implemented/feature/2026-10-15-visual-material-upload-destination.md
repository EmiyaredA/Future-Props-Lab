# Agent Note: 视觉工坊上传时指定分类与分组

Status: implemented

## Problem

看板上传素材直接创建未分类节点。用户按人设、场景及自定义分组整理项目时，每次上传后都需要逐个移动节点，批量上传尤其难以管理。

## Decision

看板上传入口展开分类、分组选择，初始采用当前节点的归类；分类菜单提供预选目标分类的入口。切换分类清空分组，批量上传捕获同一目标并逐文件串行使用最新 revision。画布原有上传入口省略目标，继续创建未分类节点。

`node-uploads` 增加可选 multipart 字段 `category_id`、`group`，在当前 Workspace 项目与 revision 校验后验证目标，再暂存文件。分类信息与节点、首个输出版本在现有 CAS 事务内保存；不新增数据库结构。目标缺失返回 422，版本冲突返回 409，不自动重放上传或降级至其他分类。

## Alternatives considered

- 上传后逐个 patch 节点：会出现文件已上传但归类失败的中间状态，增加独立保存及恢复步骤。
- 仅在分类菜单直接打开文件选择器：无法统一覆盖顶层上传入口和分类下的可选分组。

## Consequences

- 多文件可直接归入目标分类或分组，刷新后沿用已有文档持久化结果。
- 分类是项目内逻辑整理，不改变素材文件物理目录；通用文件库上传和已有节点版本上传保持各自用途。
- 批量失败保留前面已完成的节点，后续文件不自动重试；并发目标变更由 revision 与目标校验阻止错误归类。

## Verification

- `tests/apps/visual_workshop/test_visual_node_outputs.py`：分类、分组、首版输出及重新读取；非法目标、跨分类分组与旧 revision 不创建文件或节点。
- `web/tests/features/visual-workshop-canvas-layout.test.tsx`：分类菜单预选、批量目标传递、revision 串行推进、重新打开后的树归类。
- `web/tests/features/visual-workshop-board-management.test.tsx`：顶层入口键盘展开、分类切换清空分组与未分类上传。
- 契约生成及 stale-check、Web lint/构建、Note 与官方导入包检查。

2026-10-15 验证结果：上传／输出 API 18 项通过，相关 Web 组件与画布测试 26 项通过，隔离真实浏览器明暗主题 2 项通过（含 390／768／1600 宽度、文件选择、批量上传和刷新后归类）。截图位于已忽略的 `.local/upload-folders/e2e/results/`，未使用正式运行数据或供应商调用。根 lint、契约／SDK stale-check、官方导入包生成与检查、变更文件格式及 Note 校验通过；Note 校验使用 `node --import tsx scripts/checks/verify-agent-note-tree.ts` 等三个入口，避开沙箱中 CLI IPC 创建限制。

全量检查仍存在范围外失败，保留原文件：

- `npm run build`：`web/src/features/thought-workshop/tableColumnResize.ts:466` 的编辑器 attributes 回调推断出可选 undefined 属性，违反字符串索引类型。
- 架构／视觉工坊／SDK 联合测试共 70 项通过、1 项失败：`HomeHeroPet.tsx` 已有两个 desktop-pet 内部导入违反跨 feature 公共入口规则。
- 根格式检查：`db/migrations/registry.py` 已有格式差异；Web 格式检查：`web/src/docs/styles-components.css` 和思绪工坊已有 `help.md` 格式差异。
- 文档保护检查识别到 `web/src/docs/articles/sdk/sdk-reference-visual.md` 变更。这是按公共 API 契约要求由现有 `contracts:generate` 生成的两个可选上传字段，未手工改写正文或生成器；检查器不区分 API 参考更新与工程决策整理，故仍报告该路径。
