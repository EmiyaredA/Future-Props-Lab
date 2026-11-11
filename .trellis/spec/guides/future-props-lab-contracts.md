# Future Props Lab 试点规范导航

## 开工前读哪些文档

先从 [AGENTS.md 的任务索引](../../../AGENTS.md#按任务阅读) 确定本次涉及的规则，再按改动范围读对应章节。

- [Studio 后端规范索引](../studio/backend/index.md) 汇集音频标注所需的契约和测试入口。
- [Web 前端规范索引](../future-props-lab-web/frontend/index.md) 汇集界面边界、可访问性和浏览器验证入口。
- [目录索引](../../../docs/architecture/project-layout.md) 用于确认工坊、契约和装配的代码归属。
- [身份与公共接口](../../../docs/architecture/studio-framework.md#身份与公共接口) 适用于账号、权限和 API 的改动。
- [数据与事务](../../../docs/architecture/studio-framework.md#数据与事务) 适用于保存、并发与重试。
- [文件暂存与数据库事务](../../../docs/operations/file-transactions.md) 适用于写入同时涉及文件与数据库的操作。
- [能力实现契约](../../../docs/architecture/capability-contracts.md) 维护各工坊的具体规则。

## 用音频标注保存任务演示

从 [音频标注契约](../../../docs/architecture/capability-contracts.md#音频标注) 确认版本检查、CAS 与回执同事务提交、并发处理和取消回滚。
在计划里写明受影响的入口和要验证的场景，再到 [音频标注测试目录](../../../tests/apps/audio_annotation) 查对应测试。
审查沿用同一组条款，重点核对失败路径是否有证据。

## 验证与收尾

- [验证矩阵](../../../docs/operations/development-workflow.md#验证矩阵) 定义按改动范围选择的检查。
- [公共契约与 SDK](../../../docs/operations/development-workflow.md#公共契约与-sdk) 说明 API 变更的同步范围。
- [Agent Note 规则](../../../docs/operations/agent-notes.md) 说明何时记录工程决策。

## 如何把规范交给 Codex

任务 PRD 写明要调查的入口和可验证的结果，计划引用原契约的章节。
需要上下文清单时，实现和审查都引用同一份规范导航和相关能力契约。
看到文档与代码不一致时，记录冲突的条款、实现和测试位置，由任务明确是否修改契约。
涉及用户可见文档时，遵循 [产品文档中心保护规则](../../../docs/operations/agent-notes.md#受保护的产品文档中心)。
