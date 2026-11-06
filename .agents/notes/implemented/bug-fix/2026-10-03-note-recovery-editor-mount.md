# Agent Note: 草稿检查完成后再挂载编辑器

Status: implemented

## Problem

官方图复制到个人笔记的浏览器回归暴露了加载竞态。NoteEditorPane 在本机草稿检查或恢复决策未完成时，把 RichEditor 暂时作为只读组件挂载。检查结束仅切换 Tiptap 的 editable 状态，正文可以输入，但初始化时未注册的斜杠菜单和选择扩展不会补回，已挂载图表节点也可能继续持有只读回调。热缓存下更容易出现 Mermaid 或画板没有编辑按钮的情况。

## Decision

将等待限制在拥有草稿恢复生命周期的 NoteEditorPane：检查未完成或尚有草稿待决时显示明确状态，不挂载 RichEditor；恢复或丢弃决定完成后，首次创建完整的可编辑实例。现有恢复面板仍可展示服务端文本与选择恢复方式。

正常保存、保存失败与版本冲突不会重新进入初始等待状态，因此不会为了保存而卸载编辑器或清除撤销状态。不修改通用 RichEditor 的重建策略，也不修改文档存储、权限、草稿查询和保存事务。

## Alternatives considered

- 只让 Mermaid 节点订阅 editable：无法补回初始化时缺失的 Slash、NodeRange 等扩展，也漏掉其他图形节点。
- 在每次 readOnly 变化时重建通用编辑器：扩大影响范围，并让其他入口的视口、输入法、选区与撤销历史承担额外风险。

## Consequences

本机检查短暂等待期间不展示富文本编辑器；有恢复冲突时先作出恢复决定。现有“查看服务端”入口提供对照内容。编辑器只在可编辑条件已经确定后初始化，个人笔记的图表、画板和插入菜单具有一致状态。

## Verification

`web/tests/features/thought-editor-recovery-lifecycle.test.tsx` 使用真实 Tiptap 验证延迟查询、恢复与丢弃两类决策后的图形编辑入口、Slash/NodeRange 扩展，以及同一文档成功保存不更换编辑器实例。官方图复制、画板创建与保存重开继续由 `web/e2e/technical-knowledge.spec.ts` 在隔离数据中回归。
