# 思绪工坊存档

## 能力检查

本 skill 不持有应用连接或凭据。用当前环境已有 `fpl`；PATH 中没有时检查用户的 App 安装或可用 Python SDK，不硬编码安装路径。连接需要 App 正常运行并开放 Agent 接入；需要配对时 `fpl connect --name "research-to-document"` 并由用户在 App 批准，已授权连接直接复用。

```bash
fpl status
fpl operations thought.knowledge_bases
fpl operations thought.create_note
fpl operations thought.apply_note_operations
fpl operations thought.apply_multitable_operations
fpl operations thought.attachments
```

参数以运行中的 App 返回契约为准。无需额外调用模型写作接口，宿主 Agent 可以直接组织正文。缺少连接时继续本地调研、明确存档待完成；不要声称已保存。多维表格操作不可用时用普通笔记表格降级，恢复能力后再迁移。

## 项目树

用户指定知识库下创建普通父笔记「某主题调研」，它直接是报告草稿。其子文档包含「调研台账」（kind=multitable），必要时再创建「资料摘录」「阶段记录／实验记录」。不另建项目首页或第二篇报告，不为每次任务新建知识库，也不创建没有内容的子文档。

父笔记开头说明范围、当前判断与尚未验证的条件；主体是报告，末尾是未决问题、相关子文档与继续行动。阶段、审阅反馈是普通正文内容，修改沿用已有历史。JSON 记录按需作为附件保留，技术性的同步状态只供 Agent 处理。只有上传与正文引用回读成功才记录已存档。

## 正式操作顺序

1. `thought.knowledge_bases` 读取并核对用户目标；`thought.knowledge_base` / `thought.directory` 得到最新库 revision。续做先取现有文档，不靠标题反复创建。
2. 以 `thought.create_note` 创建父笔记及子文档，带 `expected_knowledge_revision`；每次结构写入后采用响应／回读得到的新 revision。记录真实 note ID，home_note_id 与 report_note_id 默认相同。
3. 用 `thought.convert_markdown` 转正文，检查 warnings。更新优先 `thought.apply_note_operations`，带 revision 与新的 request ID；只有读完当前内容、合并用户修改后才能整篇 `put_note`，并保留 title、tags、favorite、pinned、schema_version、parent_id 等现有元信息。
4. 多维文档先 `thought.get_multitable` 并分页查询当前记录，以 `thought.apply_multitable_operations` 写入 `table.put` / `records.put`。同一批次原子操作带 `expected_revision`。按 [多维表格组织](multitable.md) 使用 `assets/ledger-tables.json` 中需要的模板，不覆盖用户已有字段与视图；不能把 structure 响应当成完整记录。
5. 正式上传必要附件后，把 API 返回引用写入相关笔记。先保存台账与长篇资料，再更新父笔记报告与引用。跨文档不是一个事务，逐项确认，部分失败留在 pending。报告需要嵌入精简表格时使用已存在的 multitableView 节点，引用真实 noteId/tableId/viewId，不复制一份脱离原表的数据。
6. 回读文档、表结构与记录，检查业务 ID、正文、嵌入视图和附件引用。最后打开普通父笔记，不创建专用调研页面。

## 失败与恢复

- 409：读取最新状态，保留用户改动并显式合并；没有确定合并方案时保存草稿并报告冲突。不得只换 revision 后重放整篇内容。
- 创建请求超时：先读取目录定位真实结果，不能盲重试创建。表批次响应丢失先查询稳定记录 ID 与内容，再决定是否需要补写。
- 上传或保存部分失败：当前阶段仍 pending；保留已有资源 ID 与未完成操作，恢复时只补未确认部分。不得谎报 synced。
- 用户审阅意见是输入，保存在独立小节或记录。报告修订引用新证据，不自动清除用户意见、历史或旧附件。

上述全部复用既有 API 与笔记界面，没有新建调研 App、后台运行服务或专用 UI。v0.2 预览展示普通父笔记、多维台账与正文嵌入的内容组织方式。
