# Agent 工作台：阅读现有会话

本篇说明Agent 工作台的实际操作、可验证结果和数据边界，帮助你在当前账号中完成操作后确认保存状态。

## 操作与核验

在 FPL 网站打开「应用 → 开发辅助 → Agent 工作台」。先查看来源，再阅读会话；这里展示已有 Codex、Claude Code、OpenCode、DeepSeek Harness 和 Pi 记录。

完成后核对页面显示的账号、对象名称和最新状态；若状态仍为进行中或有错误提示，先保留当前内容并查看原因，不能把按钮点击本身视为操作成功。

## 保存与能力边界

来源只有经原生标记核验才显示 APP 或 CLI；没有可靠证据显示来源待确认。工作台不是云端 ChatGPT 聊天列表，也不要求历史来源具备 CLI 执行授权。

> [!NOTE]
> 本机与公网浏览器访问同一部署时使用相同账号隔离规则。新的来源绑定只能在运行 FPL 的 Mac 上，经后端确认的本机网站入口执行；公开地址不会扩大账号权限。

## 相关阅读

- [Agent 工作台：绑定与持续同步](/apps/thought-workshop/official-knowledge-bases/agent-workbench/documents/workflow)
- [Agent 工作台：原生记录与阅读副本](/apps/thought-workshop/official-knowledge-bases/agent-workbench/documents/storage)
