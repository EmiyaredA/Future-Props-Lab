# 项目记录契约 v1

每次调研可维护一个 JSON 记录供 Agent 校验和恢复。它不是产品资源或用户必须查看的项目格式，不保存模型的隐式推理、密钥、会话或整份执行日志。用户阅读和编辑的普通笔记与多维表格是当前内容真源；JSON 记录只是最近已确认状态的快照，续做先读取应用内容及用户改动，再更新记录。没有必要时不在正文展示存档状态或完整 JSON。

## 根字段

`schema_version: 1`，`id`，`title`，`mode`（product / technical），`stage`（scoping / collecting / validating / drafting / reviewing / complete / paused），`updated_at`（带时区的 ISO 8601），`brief`（目标与边界），`questions`，`sources`，`evidence`，`claims`，`checkpoints`，`storage`。

`storage` 包含 `status`（local / pending / synced / conflict / blocked）、`knowledge_base_id`、`home_note_id`、`ledger_note_id`、`report_note_id`、`last_confirmed_at`（可空）。home_note_id 与 report_note_id 默认指向同一个普通父笔记；旧记录可保留两个 ID，不强制迁移。它们只能来自实际成功响应；本地草稿用 null，不能拿示例 ID 冒充。

## 问题 Q

`id`（Q1…）、`text`、`priority`（critical / supporting）、`status`（open / answered / disputed / blocked）、`claim_ids`（可空）、`next_action`。已回答的问题至少关联一项 verified 结论；争议问题记录下一步，允许报告在公开说明后带着争议完成。

## 来源 S

`id`（S1…）、`title`、`url`（网页／DOI URL／宿主可读本地文件引用）、`kind`（official / paper / code / experience / experiment）、`publisher`、`version`（未知可空）、`accessed_at`（带时区，可空）、`status`（inspected / metadata_only / inaccessible）、`independence_group`（转载和同源资料共享组）、`note`。

只有 inspected 来源可支撑 E。记录打不开、未读及版本不明的原因。原文引用只保留必要片段，遵守宿主的引用限制；附件保留需符合实际访问权。

## 证据 E

`id`（E1…）、`source_id`、`question_ids`、`locator`（章节／页码／行号／截图／实验文件）、`summary`、`basis`（documented / author_reported / observed / reproduced）、`conditions`（权限、版本、配置、数据集等）、`artifact`（可空）。

observed / reproduced 要有可读取的实验记录或附件；操作步骤、结果与失败记录写在对应实验笔记中。没有执行就不能标成实测或复现。

## 结论 C

`id`（C1…）、`text`、`question_ids`、`kind`（fact / inference / recommendation）、`status`（verified / provisional / disputed）、`evidence_ids`、`counter_evidence_ids`、`limitations`。

verified 表示“在明确条件下已核对”，不等于绝对正确。关键取舍核对原始来源和适用条件；若缺少独立来源或实测，写明限制，不用随意的百分比表达信心。disputed 必须同时关联支持和反对证据。provisional 可以无证据，但必须说明限制。

## 检查点

`id`、`at`（带时区）、`stage`、`summary`、`next_action`、`open_question_ids`。默认阶段切换时记录一次；相同结果不重复堆日志。暂停和恢复也记录。若 complete 仍有未决问题，最后检查点列全并说明后续行动。

## 思绪工坊中的投影

依照 [多维表格组织](multitable.md) 按内容选择来源、对比、验证、问题等表。不强制将每个内部 Q/S/E/C 集合各建一张表；少量证据可放来源记录的摘要与证据 ID 字段，较多摘录再增加证据表。稳定业务 ID 是文本，不等于可点击的跨表外键。长篇资料引用普通笔记，网页使用 URL 字段，附件保存经 Workspace 校验的真实素材 ID。

已有多维表格支持网格、筛选、排序、分组、看板和正文嵌入视图。默认保留完整网格，按需增加未读来源、待验证或关键对比的视图。显示只用普通笔记与多维表格组件，不引入调研专用导航、进度卡片或证据侧栏。
