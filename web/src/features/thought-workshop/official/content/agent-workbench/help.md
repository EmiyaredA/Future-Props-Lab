# Agent 工作台：来源不可达与能力边界

本篇说明Agent 工作台的实际操作、可验证结果和数据边界，帮助你在当前账号中完成操作后确认保存状态。

## 操作与核验

来源状态异常时先检查原工具路径和格式，再重新扫描。缺少默认 Pi 目录时使用实际宿主目录。OpenCode 可连接已运行的本机回环 HTTP 实例，SSE 只触发补读，不执行对话控制。

若应用列表没有 Agent 工作台，确认桌面启动的是当前源码而非旧快照；正式数据还需要先完成停机备份及登记迁移。刷新旧快照不能更新入口。若 OpenCode 实例返回 401，选择它实际使用的本机存储，不要关闭原实例认证或把凭据填入 URL。

## 保存与能力边界

会话消失、重写或轮转时保留已有副本，完成记录按原生身份同步。不要手工编辑 FPL 检查点或原生日志；来源格式升级在对应原工具完成。历史阅读、Amadeus 执行、账户授权是不同入口，不会互相授予权限。

Codex 的压缩记录可能仍使用 `.jsonl` 文件名，工作台按文件头识别 Zstandard，不需要解压或重命名原文件。Pi 尚未产生会话时显示空态；只有绑定真实宿主目录并产生记录后，才会出现可阅读内容。

> [!NOTE]
> 本机应用与公网浏览器访问同一部署时使用相同账号隔离规则。来源绑定等桌面私有能力只能在已验证的桌面传输中执行；公开地址不会扩大账号权限。

## 相关阅读

- [Agent 工作台：阅读现有会话](/apps/thought-workshop/official-knowledge-bases/agent-workbench/documents/overview)
- [Agent 工作台：绑定与持续同步](/apps/thought-workshop/official-knowledge-bases/agent-workbench/documents/workflow)
