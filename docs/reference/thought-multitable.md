# 思绪工坊多维表格 API

多维表格是知识库文档的一种。`kind` 为 `note | multitable`，旧客户端未传 kind 时创建普通笔记；首页始终是普通笔记。创建多维表格时自动建立一张表、一个表格视图及名称、状态、截止日期、备注字段。目录、收藏、移动和回收站沿用文档用例。

## 输入、保存与查询

Workspace 请求使用当前 Principal，不接受 workspace_id。字段 ID 指向类型化 JSON 值：文本、数字、单选、多选、日期、复选框、链接、附件、笔记引用和人员。日期为 YYYY-MM-DD，选择字段保存选项 ID，附件和笔记引用保存 ID 列表。人员字段保存当前空间的用户 ID；允许多人时为列表，否则为单个 ID。名称字段位于第一列且保持文本，不可删除。

接口前缀：`/v1/thought-workshop/notes/{note_id}/multitable`。

| 方法与后缀 | 输入及结果 |
| --- | --- |
| GET 根路径 | 文档 revision、共享表/字段/视图结构、有效读写角色 |
| POST `/tables/{table_id}/query` | QueryIn：view_id、search、offset、limit；返回 items、total、groups、people、revision |
| POST `/operations` | expected_revision 与 operations；返回新结构及修改记录回执 |
| POST `/conversion-preview` | 完整 TableSpec；返回 valid、错误记录/字段、受影响数量及最多 20 条转换示例 |
| POST `/csv-preview` | CSV、是否含表头、可选 table/mapping；返回前 20 行、总数、行列类型错误 |
| POST `/tables/{table_id}/csv-import` | CSV、mapping、header、expected_revision；可携带新 table；整体校验后原子提交 |
| POST `/tables/{table_id}/csv-export` | QueryIn；不传 view_id 导出全部记录，传入则导出筛选结果；UTF-8 BOM CSV |
| GET `/history` | offset，最多 30 条差量版本摘要 |
| GET `/history/{revision}` | 从检查点重建表、字段、视图、记录 |
| POST `/history/{revision}/restore` | expected_revision；还原产生新版本 |

操作采用带 `op` 判别字段的 `table.put`、`table.delete`、`records.put`、`records.delete`。TableSpec 包含完整字段和视图配置；records.put 保存完整记录值，未传字段视为未设置。连续编辑由客户端合并，所有写入以文档 revision 执行 CAS。缺少 revision 为 422；冲突为 409，current 包含最新结构和记录。批次失败不部分写入，不能静默覆盖。

默认每页 100 条，上限 200；每张表最多 5,000 条记录、50 个字段，文档最多 30 张表，每表最多 30 个视图。筛选、排序、分组在 SQLite 中完成后分页。隐藏字段、筛选和视图不会限制访问权限。大小比较限数字/日期，包含条件按文字或数组成员处理；全部/任一满足由 filter_mode 控制。稳定次序最终回退 position、记录 ID。

## 生命周期、历史与交换

普通正文保存不得变更 kind，也不得覆盖多维表格正文；表格写入只由本接口执行。记录编辑、表配置、素材引用及差量历史在同一短事务完成。创建、CSV 导入、历史还原及每 100 个操作批次建立检查点。历史引用附件受删除保护，永久删除表格文档后一起释放。

迁移 `0083_thought_multitable` 追加实体表与模板快照字段，根文档拥有 Workspace，子实体通过根继承隔离。完整备份 version 9 保留结构、记录、配置、编组、填色条件、历史、附件与引用，读取 version 1–8；导入、复制和模板应用重映射内部 ID。模板保存当前快照，应用建立新文档；复制表格保留表格自己的差量历史。普通笔记导出只投影嵌入视图当前筛选后的静态数据，不包含源表历史或整个源文档；附件保留数量并提示从原表下载。人员静态导出和 CSV 使用用户 ID。

## 社区

社区接口前缀为 `/v1/thought-workshop/community/publications/{publication_id}/notes/{note_id}/multitable`。只开放结构、记录查询、操作批次和转换预览；仅浏览器 Session，不进入 SDK/桌面 Agent。读嵌入视图时带 parent_note_id，验证父文章实际引用和可读角色，再独立检查目标表格发布与角色。操作批次需要目标可编辑；没有源 Workspace、历史或私人文件库权限。附件逐次校验目标角色及当前实际引用，撤回后立即不可读。

SDK 的 `thought` 资源提供 `get_multitable`、`query_multitable_records`、`apply_multitable_operations`、转换/CSV 预览、CSV 导入导出及表格历史方法。相同普通 Workspace 接口在桌面 Agent 白名单显式登记，继续遵守配对授权和 Principal 权限。

## 参考

设计参考 [Teable](https://github.com/teableio/teable)、[Baserow](https://github.com/baserow/baserow) 的字段/记录/视图分离与交互，自行实现业务逻辑。Web 使用 [TanStack Table 的虚拟化集成](https://tanstack.com/table/v8/docs/guide/virtualization)，不接入参考应用的数据库或服务。

## 字段展示配置

`FieldSpec.config` 与字段一起经现有原子批次保存，缺省 `{}`。日期字段可设置 `date_format`：YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD、YYYY年M月D日、DD/MM/YYYY、MM/DD/YYYY。数字字段可设置 `decimal_places`（null 或 0–8）及 `use_grouping`（布尔值）。未知参数、越界值、非对应类型的非空配置返回 422。

展示格式不转换记录值；日期仍为 ISO 日期，数字保留完整精度。TSV 和 CSV 使用原始值，静态正文导出使用显示格式。选项仍通过 `options` 保存稳定 ID、名称与颜色，删除被记录或条件引用的选项会被校验阻止。配置修改遵守文档 CAS；名称字段仍为文本且不可删除。

迁移 `0085_thought_field_config` 为旧字段添加空配置。迁移 `0090_thought_field_groups` 为数据表添加空编组列表。完整备份 version 9 保留配置、编组、填色条件、历史和复制重映射；version 1–8 的缺省配置、编组和填色条件在读取时归一化，不修改旧历史。

## 人员、填色与编组

人员字段的 `config.allow_multiple` 为真时单元格保存用户 ID 列表，否则保存一个用户 ID。`default_user_ids` 是编辑器新增记录时写入的默认成员。新出现的用户 ID 必须是当前 Workspace 的有效成员；文档里已经保存的离开成员可以继续保留，查询页的 `people` 只包含本页仍在空间中的显示名。社区读取不返回成员目录。

视图 `color_rules` 最多 20 条，字段、运算符和值与筛选相同，并带有 `#RRGGBB` 颜色。表格和看板按保存顺序使用第一条命中的规则给整行上色。

`TableSpec.groups` 保存编组 id、名称和有序字段 ID。同一字段只能属于一个编组，引用已删除字段会返回 422。表头把当前视图里相邻的同组字段合成一条标题。
