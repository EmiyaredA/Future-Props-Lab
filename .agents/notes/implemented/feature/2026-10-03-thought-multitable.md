# Agent Note: 思绪工坊多维表格

Status: implemented

## Problem

富文本正文中的普通表格适合排版，但无法管理有类型的任务/创作资料、多种视图、独立保存或原子导入。把动态数据塞进正文会让嵌入编辑覆盖父笔记，并让发布引用隐含授予源内容权限。

## Decision

`ThoughtNote.kind` 区分普通笔记与多维表格，目录、Workspace 和回收站继续由文档根拥有。独立实体表保存表/字段/视图/记录，记录使用字段 ID 对应的受校验 JSON，不动态创建 SQL 表。根文档 revision 统一 CAS，批次完成验证、实体差异、素材引用和历史登记后一起提交。

后端 multitable 切片拥有查询、转换、CSV、历史与交换契约；TanStack Table/Virtual 配合自绘编辑器支持表格、看板和月历。嵌入节点只保存三类目标 ID，记录保存与父笔记正文相互独立。客户端合并 800ms 内连续编辑、按文档串行请求，并将失败操作持久保存在隔离的 IndexedDB 草稿中；冲突停止自动保存，用户明确处理后恢复。

历史保存前后差量，创建、导入、还原和每 100 个批次保存检查点。version 7 备份、复制及模板应用重映射表、字段、视图、记录和内部引用。表格附件历史通过独立引用表保护；社区只开放当前数据，并分别验证父文章与目标表格。

## Alternatives considered

- Teable、Baserow：参考字段/记录/视图与导入流程；其部署栈和应用许可不适合直接并入现有单机 SQLite 管理台，因此没有复制其业务源码。
- Glide Data Grid：Canvas 网格适合更大数据规模；当前 5,000 行、50 字段边界由服务端分页和 TanStack 虚拟化满足，暂不引入另一套单元格编辑体系。
- 整表 JSON 与每次完整历史快照：简单但增加正文耦合与编辑复制成本；改为实体存储和差量检查点，备份仍保留完整可恢复结构。

## Consequences

客户端不允许静默覆盖服务器冲突。共享视图过滤只控制展示，不能充当权限。历史附件保留到文档永久删除，删除列不会释放历史仍需的素材。社区仍为同一部署中的登录账号授权，不引入协同服务。首版不提供公式、关系、汇总、成员字段、Excel、自动化或实时共同编辑。

新增迁移只在隔离数据库验证；没有启动真实持久数据应用或执行正式迁移。目录职责和 API 见 [项目结构](../../../../docs/architecture/project-layout.md) 与 [接口参考](../../../../docs/reference/thought-multitable.md)。

## Verification

- `tests/test_thought_multitable.py`：批次/CAS、转换与 CSV 原子性、分页排序、类型筛选与分组、跨 100 批次检查点的历史重建及还原、备份/模板/复制重映射和 5,000 条记录/50 字段边界。
- `tests/test_multitable_history_assets.py`：删除附件字段后历史仍保护素材，完整备份重映射历史附件并可还原下载。
- `tests/test_multitable_community.py`、`tests/test_multitable_cross_publication.py`：跨空间隔离、跨库嵌入双重授权、当前附件访问及撤回。
- Web 组件与浏览器旅程覆盖 typed TSV、草稿冲突/恢复、三种视图、嵌入独立保存及窄屏明暗主题。
- 相关既有笔记、社区、迁移、架构、契约和 SDK 测试继续作为兼容门禁。SDK 产品引用由既有生成入口随 API 更新，受保护的产品文档变更须与本 Note 分开提交。
