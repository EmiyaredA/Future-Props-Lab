# Agent Note 维护规则

Agent Note 记录工程决策，不替代产品文档中心。它回答“为什么这样设计、考虑过什么、代价是什么、如何证明仍然成立”。

## 受保护的产品文档中心

以下路径是用户在应用内看到的文档中心内容，不能因为整理 Agent Note 而迁移、删除、改写或重新生成：

- `web/src/docs/articles/`：文章正文；
- `web/src/docs/content.ts`、`legacyLinks.json`、`rendering/` 和文档样式：导航、编译和展示；
- `web/public/docs/`：文档中心截图和配图；
- `docs/architecture/documentation-coverage.md`：文档中心覆盖清单；
- SDK/API 文档生成入口 `scripts/generate_sdk_docs.py` 及其生成的文档中心正文。

这些内容可以作为事实来源被 Note 引用，但 Note 不复制整篇产品说明。保护检查由
`npm run check-docs-center-protected` 执行。

## 何时写

行为、架构、跨文件契约、工具链、测试策略或落盘/网络/配置格式的非平凡改动需要 Note。纯格式化、样式调整、无歧义重命名、依赖补丁和局部机械修复免写。

## 目录和生命周期

Note 路径固定为 `.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md`。生命周期是 `proposed`、`implemented`、`rejected` 和 `archived`；分类是 `feature`、`bug-fix`、`simplification`、`architecture`、`process`、`testing`。可复用模板位于 `.agents/agent-note-templates/`。

首篇提案进入 `proposed`；落地时在同一次改动中转为 `implemented`。决定翻转时新建 Note 并与旧 Note 互链，不能把旧的 `Decision` 改写成相反结论。过时的 implemented 只有在失去当前约束价值时才归档；`rejected` 不归档。

## 文件结构

每篇 Note 必须包含：

- `## Problem`：脱离方案也成立的问题；
- `## Decision` 或 `## Proposal`；
- `## Alternatives considered`：只写真实考虑过的备选；
- `## Consequences` 或 `## Acceptance criteria` / `## Risks`；
- `## Verification`（implemented 建议填写）。

implemented Note 使用现在时，不保留 `## Proposal`、`## Plan` 或 `## Acceptance criteria` 等计划式标题。

## 常用命令

```sh
npm run verify-notes
npm run check-docs-center-protected
npm run check-anchors
npm run archive-agent-note -- .agents/notes/implemented/<class>/<note>.md
```

校验脚本位于 `scripts/`，不依赖外部 `/Users/tonghao/Projects/write-notes-like-deepseek` 目录。`check-anchors` 是软报告，不作为 CI 阻断条件。
